# Demo API for Prism — a thin FastAPI wrapper around the SAME pipeline the graded
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


def _b64_jpeg(path: str) -> str:
    with open(path, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")


def _run(vid_path: str, workdir: str) -> dict:
    t0 = time.time()
    frames_dir = os.path.join(workdir, "frames")
    dur = video.probe_duration(vid_path)
    n_frames = int(N_FRAMES_ENV) if N_FRAMES_ENV else video.frames_for_duration(dur)
    frames = video.extract_frames(vid_path, frames_dir, n_frames=n_frames)
    montage_path = os.path.join(workdir, "montage.jpg")
    t_frames = time.time() - t0

    t1 = time.time()
    description = caption.ground(frames, montage_out=montage_path)
    t_ground = time.time() - t1

    t2 = time.time()
    captions = caption.stylize(description, STYLE_ORDER)
    t_style = time.time() - t2

    title = caption.make_title(description)  # demo-only human-readable name

    montage_uri = _b64_jpeg(montage_path) if os.path.exists(montage_path) else ""
    return {
        "captions": captions,
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
    return {"samples": SAMPLES, "styles": STYLE_ORDER}


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
