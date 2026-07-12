# Prism entrypoint: this is the file the Track 2 Docker harness runs.
# It reads /input/tasks.json  ([{task_id, video_url, styles}]), captions each clip
# in the requested styles, and writes /output/results.json  ([{task_id, captions}]).
# Every task is handled in isolation: if one clip fails we still emit all four
# styles for it (a missing style scores zero, so we always fill every key).
from __future__ import annotations
import json
import os
import sys
import tempfile
import time

from dotenv import load_dotenv, find_dotenv

import video
import caption
import gemma_client as gc
from styles import STYLE_ORDER

# load a local .env when running on my machine. Inside the Docker image there is
# no .env and the config is baked into the environment at build time, so this is
# just a no-op there (load_dotenv never overrides variables that already exist).
_ = load_dotenv(find_dotenv())

INPUT_PATH = os.environ.get("PRISM_INPUT", "/input/tasks.json")
OUTPUT_PATH = os.environ.get("PRISM_OUTPUT", "/output/results.json")
N_FRAMES_ENV = os.environ.get("PRISM_FRAMES")  # fixed override; else adaptive by duration
USE_AUDIO = os.environ.get("PRISM_AUDIO", "0").strip().lower() in {"1", "true", "yes"}
# second-look pass: re-check the grounding against the frames and add what changes
# over time (the full-video judge sees motion our static montage can under-describe)
USE_VERIFY = os.environ.get("PRISM_VERIFY", "1").strip().lower() in {"1", "true", "yes"}
# PRISM_STT=1: transcribe the clip's speech (Gemma 3n, Gemini on error) on a side
# thread and feed it to the grounding stage; hard-capped so it can't cost >10s
USE_STT = os.environ.get("PRISM_STT", "0").strip().lower() in {"1", "true", "yes"}
# Per-clip wall-clock budget. The harness allows 30s/request; we target 25 and
# derive every stage timeout from the time actually left, so a slow download or
# a congested model host degrades the clip instead of blowing the cap.
CLIP_BUDGET = float(os.environ.get("PRISM_CLIP_BUDGET", "25"))


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# When the pipeline fails outright (no description to ground from), emit four
# DISTINCT, in-style generic captions rather than the same string four times;
# identical captions score ~0 on style-match, distinct ones floor much higher.
_GENERIC_FALLBACK = {
    "formal": "A short video clip depicting a brief real-world scene.",
    "sarcastic": "Wow, an entire video clip, truly groundbreaking visual content.",
    "humorous_tech": "Just a short clip buffering its way through a few seconds of runtime.",
    "humorous_non_tech": "A little clip that's over before you can even grab the popcorn.",
}


def _fallback_captions(styles: list, note: str = "A short video clip.") -> dict:
    return {s: _GENERIC_FALLBACK.get(s, note) for s in styles}


def process_one(task: dict, workdir: str) -> dict:
    tid = task.get("task_id", "?")
    url = task.get("video_url", "")
    styles = task.get("styles") or STYLE_ORDER

    vid = os.path.join(workdir, f"{tid}.mp4")
    frames_dir = os.path.join(workdir, f"{tid}_frames")
    t_dl = time.time()
    left = lambda: CLIP_BUDGET - (time.time() - t_dl)  # noqa: E731
    try:
        # never let the download eat more than ~half the budget; a truncated
        # faststart mp4 still yields usable frames from its downloaded prefix
        video.download_video(url, vid, max_seconds=CLIP_BUDGET * 0.48)
    except Exception as e:
        print(f"[prism] {tid} download failed: {e}", file=sys.stderr)
        return _fallback_captions(styles, "A short video clip.")
    dl_secs = time.time() - t_dl
    print(f"[prism] {tid} downloaded {os.path.getsize(vid)>>20}MB in {dl_secs:.1f}s",
          file=sys.stderr)

    # speech transcript on a side thread, overlapped with frame extraction; the
    # grounding waits at most a few seconds for it and proceeds without it.
    # Skipped when the download was slow: its ffmpeg audio decode would fight
    # frame extraction for the 2 vCPUs exactly when time is scarcest.
    stt_future = None
    if USE_STT and dl_secs <= 6:
        from concurrent.futures import ThreadPoolExecutor
        import audio_intel
        _stt_pool = ThreadPoolExecutor(max_workers=1)
        stt_future = _stt_pool.submit(audio_intel.clip_transcript, vid, workdir)
        _stt_pool.shutdown(wait=False)

    # a few high-res individual frames beat a low-res montage; Kimi takes 8 in
    # one call (Fireworks' payload cap is far above the HF endpoint's ~5 images).
    # PRISM_FLOW=1 switches the Kimi path to the experimental flow-montage
    # grounding (25 frames: one hi-res montage + 15 stills): richer temporal
    # detail, but too slow for the graded 30s/clip budget on 4K, so OFF by
    # default; the graded image behavior stays exactly v10's
    use_flow = os.environ.get("PRISM_FLOW", "0").strip().lower() in {"1", "true", "yes"}
    if use_flow and dl_secs > 6:
        # slow (usually 4K/long) download already ate the budget: degrade to the
        # quick few-frame grounding so the clip stays inside the 30s cap
        use_flow = False
    # frame ladder keyed on download time (extraction cost at 2 vCPU in
    # parens): denser sampling catches brief events (a sprinter crossing in
    # ~1s) that sparse frames miss, so spend whatever the download left over.
    #   dl < 6s  -> 16 frames (~7s)     dl < 10s -> 12 frames (~5s)
    #   dl <= 12s -> 8 frames (~4s)     beyond   -> 6 frames (~3s)
    if N_FRAMES_ENV:
        default_n = 8
    elif use_flow:
        default_n = 25
    elif not gc.kimi_available():
        default_n = 5
    elif dl_secs < 6:
        default_n = 16
    elif dl_secs < 10:
        default_n = 12
    elif dl_secs <= 12:
        default_n = 8
    else:
        default_n = 6
    n_frames = int(N_FRAMES_ENV) if N_FRAMES_ENV else default_n
    frames = video.extract_frames(vid, frames_dir, n_frames=n_frames)
    transcript = ""
    if USE_AUDIO:
        import transcribe as tr  # imported lazily; only needed when audio is on
        audio = video.extract_audio(vid, os.path.join(workdir, f"{tid}.wav"))
        if audio:
            transcript = tr.transcribe(audio)

    print(f"[prism] {tid} timing: dl={dl_secs:.1f}s extract={time.time()-t_dl-dl_secs:.1f}s "
          f"frames={len(frames)} left={left():.1f}s", file=sys.stderr)
    if not frames:
        return _fallback_captions(styles, "A short video clip.")

    if stt_future is not None:
        try:
            # the transcript may only use time grounding doesn't need: the flow
            # grounding call wants ~16s, so the wait is whatever exceeds that
            stt_text = stt_future.result(timeout=_clamp(left() - 17, 0.1, 8))
            if stt_text:
                transcript = (transcript + " " + stt_text).strip() if transcript else stt_text
                print(f"[prism] {tid} transcript: {len(transcript)} chars | "
                      f"\"{transcript[:70]}...\"", file=sys.stderr)
        except Exception:
            pass
    if len(frames) >= 20 and left() < 15:
        # the 16-image flow grounding no longer fits the remaining budget;
        # thin to ~8 stills for the quick single-call grounding
        frames = frames[::3]
    # absolute deadlines: grounding leaves ~3s for styling (cerebras answers in
    # 1-2s); styling may run slightly past the soft budget (hard axe at +4)
    clip_deadline = t_dl + CLIP_BUDGET
    try:
        description = caption.ground(frames, transcript, deadline=clip_deadline - 3)
    except Exception:
        # never surrender a clip we can still caption: a real caption a couple
        # of seconds past the soft budget scores far better than a generic
        # fallback (the 0.32 run was exactly this trade made the wrong way).
        # 4 stills, tiny payload, bounded by the hard axe.
        step = max(1, len(frames) // 4)
        description = caption.ground(frames[::step][:4], transcript,
                                     deadline=max(clip_deadline + 2, time.time() + 5))
    # verify is a Gemma pass for pure-Gemma builds; when Kimi grounds (any
    # build with a Fireworks key), don't let the weaker model second-guess it
    # (the hedge thread can stomp LAST_BACKEND, so gate on the key instead)
    if USE_VERIFY and not gc.kimi_available() and left() > 12:
        try:
            description = caption.verify(frames, description)
        except Exception:
            pass  # the unverified description is still good
    # styling gets at least a small window even after a last-resort grounding
    return caption.stylize(description, styles,
                           deadline=max(clip_deadline + 2, time.time() + 2.5))


def main() -> int:
    started = time.time()
    try:
        tasks = json.load(open(INPUT_PATH, encoding="utf-8"))
    except Exception as e:
        print(f"[prism] FATAL: cannot read {INPUT_PATH}: {e}", file=sys.stderr)
        return 1

    results = []
    with tempfile.TemporaryDirectory() as workdir:
        for i, task in enumerate(tasks):
            tid = task.get("task_id", f"task-{i}")
            styles = task.get("styles") or STYLE_ORDER
            t0 = time.time()
            try:
                # hard wall: even if a library ignores its timeout, the clip is
                # cut off shortly after the budget and answered with fallbacks
                # (the worker thread is abandoned, never joined)
                from concurrent.futures import ThreadPoolExecutor
                _pool = ThreadPoolExecutor(max_workers=1)
                _fut = _pool.submit(process_one, task, workdir)
                _pool.shutdown(wait=False)
                caps = _fut.result(timeout=CLIP_BUDGET + 4)
            except Exception as e:
                print(f"[prism] {tid} ERROR: {e}", file=sys.stderr)
                caps = _fallback_captions(styles, "A short video clip.")
            # Guarantee every requested style is present.
            for s in styles:
                caps.setdefault(s, "A short video clip.")
            results.append({"task_id": tid, "captions": caps})
            # flag clips that fell back to a generic caption, the thing that
            # quietly drags the average down when the model call fails at grading
            fell_back = any(v in set(_GENERIC_FALLBACK.values()) for v in caps.values())
            print(f"[prism] {tid} done in {time.time()-t0:.1f}s "
                  f"(total {time.time()-started:.1f}s) | backend={gc.LAST_BACKEND}"
                  f"{' | FALLBACK' if fell_back else ''}", file=sys.stderr)

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(results, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[prism] wrote {len(results)} results in {time.time()-started:.1f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
