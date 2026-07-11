"""Ground once, restyle four ways — both stages on Gemma-4.

Stage 1 (vision): Gemma-4 looks at the frames (+ audio transcript) and writes a
single specific, factual description of the clip. Grounding once keeps all four
captions consistent and faithful (accuracy score).

Stage 2 (style): Gemma-4 rewrites that description into each requested style in
one structured JSON call (style-match score), cheap and consistent.
"""
from __future__ import annotations
import json
import os
import re
import tempfile
from typing import List, Optional

import gemma_client as gc
import styles as S
import video as V

_GROUND_PROMPT = (
    "The image is a grid of evenly-sampled frames from ONE short video, read "
    "left-to-right, top-to-bottom in time order.\n"
    "Write a DETAILED, factual description of the video as a whole. Pack in "
    "concrete, verifiable detail:\n"
    "- the setting and location — if you recognize the specific city, country, or "
    "a famous landmark, name it; the time of day and lighting;\n"
    "- the main subject(s), specifically — count them, and note colors, types, "
    "posture/expression, gaze direction, and distinguishing features;\n"
    "- what happens across the clip: actions, movement and its direction, and "
    "camera behavior (static vs moving, panning, zooming);\n"
    "- the capture technique and any motion effects (e.g. time-lapse, slow motion, "
    "motion-blurred subjects);\n"
    "- notable objects — their SPECIFIC type and state/condition (e.g. a sliced "
    "pizza, an empty bench, an open door), not just generic terms like 'cars' or "
    "'boats'; background landmarks or buildings; and any text or signs you can "
    "read (even if partially legible); plus the overall mood;\n"
    "- notable ABSENCES when relevant (e.g. 'no people are visible').\n"
    "If you clearly recognize a place, product, animal, or franchise, name it. "
    "Only describe what is actually visible; if you are not sure what something "
    "is, describe it in general terms rather than guessing its identity. Do not "
    "call it a collage or separate images. Write 3-5 detailed sentences."
)


def ground(frame_paths: List[str], transcript: str = "",
           montage_out: Optional[str] = None) -> str:
    prompt = _GROUND_PROMPT
    if transcript:
        prompt += f"\n\nFor extra context, the audio transcript is:\n\"\"\"\n{transcript[:1500]}\n\"\"\""
    # Managed vision endpoints cap payload size — tile frames into ONE small
    # montage rather than sending many base64 images (which 413s). montage_out
    # lets a caller (the demo UI) keep the exact image the model saw.
    montage = None
    if frame_paths:
        dest = montage_out or os.path.join(tempfile.gettempdir(), f"prism_montage_{os.getpid()}.jpg")
        montage = V.make_montage(frame_paths, dest)
    images = [montage] if montage else frame_paths
    return gc.vision_describe(images, prompt)


def stylize(description: str, styles: List[str]) -> dict:
    ordered = [s for s in S.STYLE_ORDER if s in styles] or styles
    guide = S.guide_for(ordered)
    keys = ", ".join(f'"{s}"' for s in ordered)
    user = (
        f"Here is a factual description of a short video:\n\"\"\"\n{description}\n\"\"\"\n\n"
        f"Write ONE caption for the video in EACH of these styles. Every caption must stay "
        f"faithful to the description above (same subjects and actions) while nailing its style:\n"
        f"{guide}\n\n"
        f"Make the four captions clearly DISTINCT from each other — different wording, angle, "
        f"and rhythm, not four rephrasings of the same sentence. Pack in specific, concrete "
        f"detail from the description; vague captions score poorly.\n"
        f"Return ONLY a JSON object with exactly these keys: {keys}. Each value is a caption "
        f"of one to three sentences (Formal may be longer and detailed; keep the humorous "
        f"styles punchy). No extra text."
    )
    raw = gc.chat(
        # 800 tokens: richer multi-sentence captions across 4 styles; a smaller
        # budget truncated the LAST caption, dropping its key to the fallback.
        [{"role": "user", "content": user}],
        max_tokens=800, temperature=0.7,
        response_format={"type": "json_object"},
    )
    # Fallback is a SHORT grounded sentence, never the whole description — keeps
    # every card compact even when a style is missing.
    return _parse(raw, ordered, _short(description, 150))


def _short(text: str, limit: int) -> str:
    """First sentence of `text`, hard-capped at `limit` chars."""
    text = " ".join(text.split())
    first = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    if len(first) > limit:
        first = first[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return first


def _tidy(val: str, limit: int = 450) -> str:
    """Normalize whitespace; only trim a truly runaway caption (a fallback dump
    of the whole description). Rich multi-sentence captions pass through — the
    top-scoring agents are detailed, and detail drives the accuracy score."""
    val = " ".join(val.split())
    return val if len(val) <= limit else _short(val, limit)


def _parse(raw: str, styles: List[str], fallback: str) -> dict:
    try:
        obj = json.loads(raw)
    except Exception:
        # Salvage a JSON block if the model wrapped it in prose.
        m = re.search(r"\{.*\}", raw, re.S)
        obj = json.loads(m.group(0)) if m else {}
    out = {}
    for s in styles:
        val = obj.get(s)
        out[s] = _tidy(val) if isinstance(val, str) and val.strip() else fallback
    return out


def make_title(description: str) -> str:
    """A short, human-readable video name derived from the description (demo UI
    only — not part of the graded caption output)."""
    try:
        raw = gc.chat(
            [{"role": "user", "content":
              "Write a short, catchy title (3 to 6 words) for this video, like a "
              "headline or a filename. Reply with ONLY the title — no quotes, no "
              "trailing period.\n\n"
              f"Video: {description[:600]}"}],
            max_tokens=24, temperature=0.5,
        )
        t = " ".join(raw.split()).strip().strip('"').strip("'").rstrip(".")
        return t[:70] if t else "Untitled clip"
    except Exception:
        return "Untitled clip"
