"""Video I/O: download a clip, sample frames, extract audio.

Frames are downscaled hard (long side ~512px, JPEG); Gemma-4 doesn't need 4K,
and small frames cut both upload time and vision token cost, which matters for
the ≤30s/clip and $50-credit budgets. Audio is mono 16 kHz for Whisper.
"""
from __future__ import annotations
import json
import os
import subprocess
from typing import List, Optional


def download_video(url: str, dest: str, timeout: int = 120,
                   max_seconds: Optional[float] = None) -> str:
    """Stream the clip to disk. max_seconds is a WALL-CLOCK cap: when it expires
    we stop and keep the partial file (web-served mp4s are faststart, so the
    downloaded prefix is decodable and frames from it still describe the clip);
    a long/slow download must never eat the whole per-clip budget."""
    import time as _t
    import requests
    t0 = _t.time()
    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                if max_seconds is not None and _t.time() - t0 > max_seconds:
                    break
    return dest


def probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return 0.0


def extract_frames(path: str, out_dir: str, n_frames: int = 5,
                   max_side: int = 768) -> List[str]:
    """Sample n frames evenly, skipping the first/last 5% (black intro/outro), at
    full-ish resolution as INDIVIDUAL images. The strongest Track-2 agents feed
    the vision model a few HIGH-RES frames, not a low-res montage; Gemma reads
    text and fine detail far better this way."""
    os.makedirs(out_dir, exist_ok=True)
    dur = probe_duration(path)
    vf = f"scale='min({max_side},iw)':-2"
    if dur > 1.0:
        pad = 0.05 * dur                       # skip black intro/outro
        span = dur - 2 * pad

        def _grab(i):                          # fast input-seek, one frame each
            frac = i / (n_frames - 1) if n_frames > 1 else 0.5
            t = pad + span * frac
            # -threads 1: ffmpeg's auto-threading spawns a full decode pool PER
            # process; on the grader's 2 vCPUs six of those thrash (14.6s for
            # 8 frames of 4K). One decode thread each, few workers: 4.5s.
            subprocess.run(
                ["ffmpeg", "-y", "-threads", "1", "-ss", f"{t:.3f}", "-i", path,
                 "-frames:v", "1", "-vf", vf, "-q:v", "3",
                 os.path.join(out_dir, f"f_{i:03d}.jpg")],
                capture_output=True, timeout=30,
            )

        # seeks are independent; parallelize (I/O + one-GOP decode each)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(3, n_frames)) as ex:
            list(ex.map(_grab, range(n_frames)))
    else:
        subprocess.run(
            ["ffmpeg", "-y", "-i", path, "-vf", f"fps=1,{vf}", "-frames:v",
             str(n_frames), "-q:v", "3", os.path.join(out_dir, "f_%03d.jpg")],
            capture_output=True, timeout=120,
        )
    frames = sorted(
        os.path.join(out_dir, f) for f in os.listdir(out_dir)
        if f.startswith("f_") and f.endswith(".jpg")
    )
    return frames[:n_frames]


def frames_for_duration(dur: float) -> int:
    """Adaptive frame budget: longer clips get a denser montage grid so a
    2-minute video isn't summarized from the same 9 frames as a 20s one. The grid
    auto-derives square (√n) in make_montage: 9→3x3, 16→4x4, 25→5x5. Montage
    resolution scales with the grid, so bigger grids keep cells legible.
        ≤30s → 9 (3x3)   |   ≤90s → 16 (4x4)   |   >90s → 25 (5x5)
    """
    if dur <= 0:      # unknown duration → safe middle
        return 16
    if dur <= 30:
        return 9
    if dur <= 90:
        return 16
    return 25


def make_montage(frame_paths: List[str], dest: str, cols: Optional[int] = None,
                 cell: int = 380, max_side: Optional[int] = None, quality: int = 68) -> Optional[str]:
    """Tile frames into ONE grid image (row-major, time order).

    Managed vision endpoints cap request payload size, so sending many base64
    frames 413s. A single JPEG montage compresses well (~70-100KB even at 16-20
    frames) and stays far under the limit while giving the temporal coverage a
    30s-2min clip needs, calibrated on 1-3 min clips. cols defaults to a
    roughly-square grid so cells stay legible.
    """
    from PIL import Image
    imgs = []
    for p in frame_paths:
        try:
            im = Image.open(p).convert("RGB")
            im.thumbnail((cell, cell))
            imgs.append(im)
        except Exception:
            continue
    if not imgs:
        return None
    if cols is None:  # roughly-square grid: ceil(sqrt(n))
        cols = int(len(imgs) ** 0.5)
        if cols * cols < len(imgs):
            cols += 1
    cols = min(cols, len(imgs))
    if max_side is None:  # ~300px per cell so bigger grids stay legible
        max_side = min(1600, max(900, cols * 300))
    rows = (len(imgs) + cols - 1) // cols
    cw = max(i.width for i in imgs)
    ch = max(i.height for i in imgs)
    grid = Image.new("RGB", (cols * cw, rows * ch), (18, 18, 18))
    for i, im in enumerate(imgs):
        r, c = divmod(i, cols)
        grid.paste(im, (c * cw, r * ch))
    grid.thumbnail((max_side, max_side))
    grid.save(dest, "JPEG", quality=quality)
    return dest


def extract_audio(path: str, dest: str) -> str:
    """Extract mono 16 kHz audio for Whisper; returns '' if the clip has none."""
    res = subprocess.run(
        ["ffmpeg", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
         "-b:a", "64k", dest],
        capture_output=True, timeout=90,
    )
    return dest if res.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 1000 else ""
