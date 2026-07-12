"""Staged, cost-efficient test run against the deployed Gemma-4 endpoint.

Warms the deployment once (absorbing cold start), then runs all example clips
back-to-back so we pay for the fewest serving-minutes. Frames-only grounding
(PRISM_AUDIO=0) since local whisper isn't installed here and the examples are
silent. Prints captions + timing so we can judge quality and burn rate.

Run:  python test/measure_run.py
"""
from __future__ import annotations
import os, sys, time, tempfile, json

from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

# load HF_TOKEN etc. from the project's .env, then force audio off for this run
load_dotenv(os.path.join(ROOT, ".env"))
os.environ["PRISM_AUDIO"] = "0"

import gemma_client as gc
import main as M

print("backends:", gc.active_backends())

# 1) Warm-up (absorbs cold start; generous timeout).
t = time.time()
try:
    r = gc.chat([{"role": "user", "content": "Reply with exactly: READY"}],
                max_tokens=8, temperature=0, timeout=300)
    print(f"[warmup] {time.time()-t:.1f}s -> {r!r}")
except Exception as e:
    print(f"[warmup] FAILED: {e!r}")
    print("If 404: the deployed model ID differs; use the exact model path "
          "from the deployment page and I'll set PRISM_FW_MODEL.")
    raise SystemExit(1)

CLIPS = [
    ("v1", "https://storage.googleapis.com/amd-hackathon-clips/1860079-uhd_2560_1440_25fps.mp4"),
    ("v2", "https://storage.googleapis.com/amd-hackathon-clips/13825391-uhd_3840_2160_30fps.mp4"),
    ("v3", "https://storage.googleapis.com/amd-hackathon-clips/3044693-uhd_3840_2160_24fps.mp4"),
]
STYLES = ["formal", "sarcastic", "humorous_tech", "humorous_non_tech"]

results = {}
with tempfile.TemporaryDirectory() as wd:
    for tid, url in CLIPS:
        t = time.time()
        caps = M.process_one({"task_id": tid, "video_url": url, "styles": STYLES}, wd)
        results[tid] = caps
        print(f"\n===== {tid}  ({time.time()-t:.1f}s) =====")
        for s in STYLES:
            print(f"  {s:18s}: {caps.get(s,'')}")

json.dump(results, open(os.path.join(ROOT, "output", "measure_results.json"), "w"),
          ensure_ascii=False, indent=2)
print("\n[done] saved output/measure_results.json; now DELETE the deployment to stop billing.")
