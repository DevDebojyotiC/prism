# Demo API for Prism: a thin FastAPI wrapper around the SAME pipeline the graded
# batch container runs (video + caption + gemma_client). This only drives the demo
# frontend / recording; it is NOT part of the graded submission.
# Run:  uvicorn serve:app --reload --port 8000
from __future__ import annotations
import base64
import os
import tempfile
import time
import uuid

from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# load HF_TOKEN etc. from the local .env for dev
_ = load_dotenv(find_dotenv())

import video
import caption
import gemma_client as gc
from styles import STYLE_ORDER

app = FastAPI(title="Prism", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

N_FRAMES_ENV = os.environ.get("PRISM_FRAMES")  # fixed override; else adaptive by duration

SAMPLES = [
    {"id": "traffic", "label": "City traffic",     "url": "https://storage.googleapis.com/amd-hackathon-clips/1860079-uhd_2560_1440_25fps.mp4"},
    {"id": "kitten",  "label": "Kitten in woods",  "url": "https://storage.googleapis.com/amd-hackathon-clips/13825391-uhd_3840_2160_30fps.mp4"},
    {"id": "office",  "label": "Office worker",    "url": "https://storage.googleapis.com/amd-hackathon-clips/3044693-uhd_3840_2160_24fps.mp4"},
]


class LinkReq(BaseModel):
    video_url: str


class TranslateReq(BaseModel):
    captions: dict
    language: str


# demo language selector; Gemma-4 covers 140+ languages; this is a showcase
# list, not a limit
LANGUAGES = [
    "English", "Hindi", "Bengali", "Telugu", "Tamil", "Spanish", "French", "German",
    "Portuguese", "Italian", "Japanese", "Korean", "Chinese (Simplified)",
    "Arabic", "Indonesian", "Turkish", "Swahili",
]


def _b64_jpeg(path: str) -> str:
    with open(path, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")


def _run(vid_path: str, workdir: str) -> dict:
    t0 = time.time()
    frames_dir = os.path.join(workdir, "frames")
    default_n = 8 if gc.kimi_available() else 5
    n_frames = int(N_FRAMES_ENV) if N_FRAMES_ENV else default_n
    frames = video.extract_frames(vid_path, frames_dir, n_frames=n_frames)
    # the pipeline no longer needs a montage (individual high-res frames go to the
    # model); build one purely for the demo's visual strip
    montage_path = os.path.join(workdir, "montage.jpg")
    video.make_montage(frames, montage_path)
    t_frames = time.time() - t0

    t1 = time.time()
    description = caption.ground(frames)
    t_ground = time.time() - t1

    t2 = time.time()
    captions = caption.stylize(description, STYLE_ORDER)
    t_style = time.time() - t2

    title = caption.make_title(description)  # demo-only human-readable name

    # fact-anchor: EmbeddingGemma similarity of each caption to the grounded facts
    try:
        anchors = caption.fact_anchor(description, captions)
    except Exception:
        anchors = {}

    # "Gemma hears": optional audio description from a self-hosted Gemma 3n on the
    # AMD notebook (the hosted APIs don't serve Gemma's audio checkpoints). The
    # demo simply omits the row when the endpoint is not configured or down.
    heard, heard_via, transcript = "", "", ""
    try:
        wav = video.extract_audio(vid_path, os.path.join(workdir, "a.wav"))
    except Exception:
        wav = ""
    if wav:
        amd_audio = os.environ.get("AMD_AUDIO_BASE_URL", "").rstrip("/")
        if amd_audio:  # self-hosted on the AMD notebook, when the tunnel is up
            try:
                import base64 as _b64
                import requests as _rq
                b64 = _b64.b64encode(open(wav, "rb").read()).decode("ascii")
                rr = _rq.post(f"{amd_audio}/describe", json={"audio_b64": b64},
                              headers={"ngrok-skip-browser-warning": "true"}, timeout=45)
                if rr.ok and rr.json().get("text"):
                    heard, heard_via = rr.json()["text"], "on AMD W7900"
            except Exception:
                pass
        if not heard:  # serverless: HF router -> Together serves the same 3n E4B
            try:
                heard, heard_via = gc.hear(wav), "serverless"
            except Exception:
                pass
        # transcript: Gemma 3n's audio encoder ingests ~30s per input, so chunk
        # the soundtrack into 28s segments and transcribe them in parallel
        try:
            import subprocess as _sp
            from concurrent.futures import ThreadPoolExecutor as _TPE
            seg_pat = os.path.join(workdir, "seg_%02d.wav")
            _sp.run(["ffmpeg", "-y", "-i", wav, "-f", "segment", "-segment_time", "28",
                     "-ac", "1", "-ar", "16000", seg_pat], capture_output=True, timeout=60)
            segs = sorted(p for p in os.listdir(workdir) if p.startswith("seg_"))[:5]
            segs = [os.path.join(workdir, p) for p in segs] or [wav]

            def _tr_one(p):
                try:
                    return gc.hear(p, gc.TRANSCRIBE_PROMPT, max_tokens=512)
                except Exception:
                    return ""

            with _TPE(max_workers=len(segs)) as ex:
                parts = list(ex.map(_tr_one, segs))
            keep = []
            for tr in parts:
                words = tr.split()
                # degenerate-repetition guard: music beds sometimes "transcribe" as
                # one token repeated dozens of times; real speech has variety
                degenerate = len(words) >= 6 and len(set(w.lower() for w in words)) / len(words) < 0.3
                if tr and "NO_SPEECH" not in tr.upper() and not degenerate:
                    keep.append(tr.strip())
            transcript = " ".join(keep)
            if len(transcript) > 1400:  # trim at a sentence boundary, never mid-word
                cut = transcript[:1400]
                dot = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
                transcript = cut[:dot + 1] if dot > 300 else cut.rsplit(" ", 1)[0] + "…"
        except Exception:
            pass

    montage_uri = _b64_jpeg(montage_path) if os.path.exists(montage_path) else ""
    return {
        "captions": captions,
        "anchors": anchors,
        "heard": heard,
        "heard_via": heard_via,
        "transcript": transcript,
        "description": description,
        "title": title,
        "montage": montage_uri,
        "frame_count": len(frames),
        "backend": gc.LAST_BACKEND,
        "model": os.environ.get("HF_GEMMA_MODEL", "google/gemma-4-31B-it"),
        "timing": {
            "frames": round(t_frames, 2),
            "ground": round(t_ground, 2),
            "style": round(t_style, 2),
            "total": round(time.time() - t0, 2),
        },
    }


@app.get("/api/samples")
def samples():
    return {"samples": SAMPLES, "styles": STYLE_ORDER, "languages": LANGUAGES}


@app.post("/api/translate")
def translate(req: TranslateReq):
    """Transcreate the four captions into the chosen language (Gemma, one call).
    Tone must survive the language switch; that's the showcase."""
    if req.language.lower().startswith("english"):
        return {"captions": req.captions, "language": "English"}
    t0 = time.time()
    try:
        out = caption.translate_captions(req.captions, req.language)
    except Exception as e:
        return {"error": f"translation failed: {e}"}
    return {"captions": out, "language": req.language,
            "backend": gc.LAST_BACKEND, "seconds": round(time.time() - t0, 2)}


@app.post("/api/caption/link")
def caption_link(req: LinkReq):
    with tempfile.TemporaryDirectory() as wd:
        vid = os.path.join(wd, "clip.mp4")
        try:
            video.download_video(req.video_url, vid)
        except Exception as e:
            return {"error": f"could not download video: {e}"}
        return _run(vid, wd)


@app.post("/api/caption/upload")
async def caption_upload(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as wd:
        vid = os.path.join(wd, "clip.mp4")
        with open(vid, "wb") as f:
            f.write(await file.read())
        return _run(vid, wd)


@app.get("/api/health")
def health():
    return {"ok": True, "backends": gc.active_backends()}
