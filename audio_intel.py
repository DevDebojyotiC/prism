# Soundtrack intelligence for the graded pipeline (PRISM_STT=1): transcribe the
# clip's speech with Gemma 3n (Gemini only when a Gemma call errors) and hand the
# text to the grounding stage, so captions can draw on what is SAID as well as
# what is shown. Built to be harmless: every failure path returns "", music-only
# clips return "", and the caller runs it on a side thread with a hard join
# timeout so it can never blow the 30s/clip budget.
from __future__ import annotations
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

import gemma_client as gc
import video


def _usable(tr: str) -> bool:
    words = tr.split()
    up = tr.upper().strip()
    # the model sometimes writes the sentinel loosely ("No speech.")
    if not tr or "NO_SPEECH" in up or up.startswith("NO SPEECH"):
        return False
    # degenerate-repetition guard: music beds sometimes "transcribe" as one token
    # repeated dozens of times; real speech has lexical variety
    if len(words) >= 6 and len(set(w.lower() for w in words)) / len(words) < 0.3:
        return False
    return True


def clip_transcript(vid_path: str, workdir: str, via: dict | None = None) -> str:
    """Best-effort transcript of the clip's speech, '' when there is none.
    When a dict is passed as `via`, the engines that actually served chunks are
    recorded under via['engines'] (demo display; the graded caller omits it)."""
    try:
        wav = video.extract_audio(vid_path, os.path.join(workdir, "stt.wav"))
        if not wav:
            return ""
        seg_pat = os.path.join(workdir, "stt_%02d.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav, "-f", "segment", "-segment_time", "28",
             "-ac", "1", "-ar", "16000", seg_pat],
            capture_output=True, timeout=60,
        )
        segs = sorted(p for p in os.listdir(workdir)
                      if p.startswith("stt_") and p.endswith(".wav"))[:5]
        segs = [os.path.join(workdir, p) for p in segs] or [wav]

        def _one(p):
            try:
                out = gc.hear(p, gc.TRANSCRIBE_PROMPT, max_tokens=400)
                if via is not None:
                    via.setdefault("engines", set()).add("Gemma 3n")
                return out
            except Exception:
                try:
                    out = gc.gemini_hear(p, gc.TRANSCRIBE_PROMPT, max_tokens=400)
                    if via is not None:
                        via.setdefault("engines", set()).add("Gemini")
                    return out
                except Exception:
                    return ""

        with ThreadPoolExecutor(max_workers=len(segs)) as ex:
            parts = list(ex.map(_one, segs))
        keep = [tr.strip() for tr in parts if _usable(tr)]
        out = " ".join(keep)
        return out[:1400]
    except Exception:
        return ""
