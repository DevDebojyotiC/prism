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
    # speech transcript on a side thread, mirroring the graded pipeline
    # (main.py, PRISM_STT=1): overlapped with frame extraction, waited on
    # briefly at grounding time, and fed into ground() so what is SAID
    # genuinely shapes the captions
    import audio_intel
    from concurrent.futures import ThreadPoolExecutor as _TPE
    stt_via: dict = {}
    _stt_pool = _TPE(max_workers=1)
    stt_future = _stt_pool.submit(audio_intel.clip_transcript, vid_path, workdir, stt_via)
    _stt_pool.shutdown(wait=False)

    frames_dir = os.path.join(workdir, "frames")
    default_n = 25 if gc.kimi_available() else 5   # demo always uses flow-montage grounding
    n_frames = int(N_FRAMES_ENV) if N_FRAMES_ENV else default_n
    frames = video.extract_frames(vid_path, frames_dir, n_frames=n_frames)
    # the pipeline no longer needs a montage (individual high-res frames go to the
    # model); build one purely for the demo's visual strip
    montage_path = os.path.join(workdir, "montage.jpg")
    video.make_montage(frames, montage_path)
    t_frames = time.time() - t0

    transcript = ""
    try:
        # same 10s cap as the graded path; grounding proceeds without the
        # transcript if transcription is still running
        transcript = stt_future.result(timeout=10) or ""
    except Exception:
        pass

    t1 = time.time()
    description = caption.ground(frames, transcript)
    t_ground = time.time() - t1

    transcript_via = ""
    audio_via = {"v": ""}  # which engine actually served audio this run

    def _hear_any(path, prompt="", max_tokens=90):
        """Gemma 3n first; Gemini carries the feature when the 3n route flaps."""
        try:
            out = gc.hear(path, prompt, max_tokens=max_tokens)
            audio_via["v"] = audio_via["v"] or "Gemma 3n serverless"
            return out
        except Exception:
            out = gc.gemini_hear(path, prompt or (
                "This is the soundtrack of a short video clip. In one or two "
                "sentences, describe what you HEAR. Only report what is clearly "
                "audible."), max_tokens=max_tokens)
            audio_via["v"] = "Gemini (fallback; Gemma 3n hosting momentarily unavailable)"
            return out

    def _heard_row():
        """'Gemma hears': soundtrack description (AMD notebook when the tunnel
        is up, else serverless 3n with Gemini on flaps). Reuses the wav the
        transcript thread already extracted instead of decoding audio twice."""
        # prefer the first 28s segment the transcript thread already cut: 3n's
        # audio encoder ingests ~30s anyway, and the small payload uploads in
        # ~1s instead of shipping the full clip's audio
        wav = ""
        for cand in (os.path.join(workdir, "stt_00.wav"),
                     os.path.join(workdir, "stt.wav")):
            if os.path.exists(cand) and os.path.getsize(cand) > 1000:
                wav = cand
                break
        if not wav:
            try:
                wav = video.extract_audio(vid_path, os.path.join(workdir, "a.wav"))
            except Exception:
                wav = ""
        if not wav:
            return "", ""
        amd_audio = os.environ.get("AMD_AUDIO_BASE_URL", "").rstrip("/")
        if amd_audio:  # self-hosted on the AMD notebook, when the tunnel is up
            try:
                import base64 as _b64
                import requests as _rq
                b64 = _b64.b64encode(open(wav, "rb").read()).decode("ascii")
                rr = _rq.post(f"{amd_audio}/describe", json={"audio_b64": b64},
                              headers={"ngrok-skip-browser-warning": "true"}, timeout=45)
                if rr.ok and rr.json().get("text"):
                    return rr.json()["text"], "on AMD W7900"
            except Exception:
                pass
        try:
            return _hear_any(wav), audio_via["v"]
        except Exception:
            return "", ""

    # styling, the demo title, and the soundtrack row are mutually independent:
    # run them concurrently instead of one after another (~5s saved)
    t2 = time.time()
    _style_secs = {}

    def _style():
        s0 = time.time()
        out = caption.stylize(description, STYLE_ORDER)
        _style_secs["s"] = time.time() - s0
        return out

    from concurrent.futures import ThreadPoolExecutor as _XTPE
    with _XTPE(max_workers=3) as _ex:
        f_style = _ex.submit(_style)
        f_title = _ex.submit(caption.make_title, description)
        f_heard = _ex.submit(_heard_row)
        captions = f_style.result()
        try:
            title = f_title.result()
        except Exception:
            title = ""
        heard, heard_via = f_heard.result()
    t_style = _style_secs.get("s", time.time() - t2)

    # fact-anchor: EmbeddingGemma similarity of each caption to the grounded facts
    try:
        anchors = caption.fact_anchor(description, captions)
    except Exception:
        anchors = {}
    # transcript: reuse the side-thread result that already informed the
    # grounding (same text the graded pipeline uses). If it wasn't ready at
    # grounding time we finish waiting for it here, display-only, exactly as
    # the graded path would have proceeded caption-wise without it.
    if not transcript:
        try:
            transcript = stt_future.result(timeout=30) or ""
        except Exception:
            pass
    if transcript:
        engines = sorted(stt_via.get("engines", set()))
        if engines == ["Gemma 3n"]:
            transcript_via = "Gemma 3n serverless"
        elif engines == ["Gemini"]:
            transcript_via = "Gemini (fallback; Gemma 3n hosting momentarily unavailable)"
        elif engines:
            transcript_via = "Gemma 3n + Gemini (fallback on errored chunks)"
        else:
            transcript_via = "Gemma 3n"

    montage_uri = _b64_jpeg(montage_path) if os.path.exists(montage_path) else ""
    return {
        "captions": captions,
        "anchors": anchors,
        "heard": heard,
        "heard_via": heard_via,
        "audio_via": audio_via["v"],
        "transcript": transcript,
        "transcript_via": transcript_via,
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


class TTSReq(BaseModel):
    text: str


_tts = {"client": None}  # lazy; reused across requests


@app.post("/api/tts")
def tts(req: TTSReq):
    """Demo-only: synthesize speech with T5Gemma-TTS (a community TTS built on
    Google's T5Gemma weights) running on a HF ZeroGPU Space. The only live
    Gemma-family voice we found: none of the 35 Gemma-TTS models on the Hub has
    a serverless provider. The frontend falls back to the browser voice on any
    failure or quota exhaustion."""
    txt = " ".join(req.text.split())[:400]  # client sends sentence-chunks; hard safety cap only
    t0 = time.time()
    # host order: the AMD notebook (TTS_SPACE tunnel URL, no quota, Gemma voice
    # on AMD silicon) -> the public ZeroGPU Space (quota-capped). Same app, same
    # API; only the hardware differs. The frontend's browser voice covers total
    # failure.
    hosts = []
    if os.environ.get("TTS_SPACE"):
        hosts.append((os.environ["TTS_SPACE"], "T5Gemma-TTS on AMD W7900"))
    hosts.append(("Aratako/T5Gemma-TTS-Demo", "T5Gemma-TTS"))
    last_err = "no audio produced"
    from gradio_client import Client
    for name, label in hosts:
        try:
            if _tts.get(name) is None:
                _tts[name] = Client(name, token=os.environ.get("HF_TOKEN"), verbose=False)
            out = _tts[name].predict(
                reference_speech=None, reference_text=None, target_text=txt,
                target_duration="", top_k=30, top_p=0.9, min_p=0.0,
                temperature=0.8, seed="", num_samples=1,
                api_name="/gradio_inference")
            first = out[0] if isinstance(out, (list, tuple)) else out
            if isinstance(first, dict):
                first = first.get("value")
            if first and os.path.exists(first):
                b64 = base64.b64encode(open(first, "rb").read()).decode("ascii")
                return {"audio": "data:audio/wav;base64," + b64,
                        "engine": label, "seconds": round(time.time() - t0, 1)}
        except Exception as e:
            _tts[name] = None      # stale client (dead tunnel): rebuild next time
            last_err = str(e)[:200]
    return {"error": last_err}


@app.get("/api/health")
def health():
    return {"ok": True, "backends": gc.active_backends()}
