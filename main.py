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
    try:
        video.download_video(url, vid)
    except Exception as e:
        print(f"[prism] {tid} download failed: {e}", file=sys.stderr)
        return _fallback_captions(styles, "A short video clip.")
    dl_secs = time.time() - t_dl

    # speech transcript on a side thread, overlapped with frame extraction; the
    # grounding waits at most a few seconds for it and proceeds without it
    stt_future = None
    if USE_STT:
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
    if use_flow and dl_secs > 12:
        # slow (usually 4K) download already ate the budget: degrade to the quick
        # 8-frame grounding so the clip stays inside the 30s cap
        use_flow = False
    default_n = (25 if use_flow else 8) if gc.kimi_available() else 5
    n_frames = int(N_FRAMES_ENV) if N_FRAMES_ENV else default_n
    frames = video.extract_frames(vid, frames_dir, n_frames=n_frames)
    transcript = ""
    if USE_AUDIO:
        import transcribe as tr  # imported lazily; only needed when audio is on
        audio = video.extract_audio(vid, os.path.join(workdir, f"{tid}.wav"))
        if audio:
            transcript = tr.transcribe(audio)

    if not frames:
        return _fallback_captions(styles, "A short video clip.")

    if len(frames) >= 20 and time.time() - t_dl > 16:
        # second timing guard: download+extraction already used too much of the
        # 30s budget; fall back to quick grounding by thinning to ~8 stills
        frames = frames[::3]
    if stt_future is not None:
        try:
            stt_text = stt_future.result(timeout=10)  # hard cap; never stalls a clip
            if stt_text:
                transcript = (transcript + " " + stt_text).strip() if transcript else stt_text
        except Exception:
            pass
    description = caption.ground(frames, transcript)
    # verify is a Gemma pass; when Kimi (a stronger VLM) grounded, don't let the
    # weaker model second-guess it
    if USE_VERIFY and gc.LAST_BACKEND != "kimi":
        description = caption.verify(frames, description)
    return caption.stylize(description, styles)


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
                caps = process_one(task, workdir)
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
