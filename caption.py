"""Ground once, restyle four ways. Both stages run on Gemma-4.

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
    "These are several frames sampled from ONE short video, in chronological "
    "order.\n"
    "Write a DETAILED, factual description of the video as a whole. Pack in "
    "concrete, verifiable detail:\n"
    "- the setting and location; if you recognize the specific city, country, or "
    "a famous landmark, name it; the time of day and lighting;\n"
    "- the main subject(s), specifically: count them, and note colors, types, "
    "posture/expression, gaze direction, and distinguishing features;\n"
    "- what happens across the clip: actions, movement and its direction, and "
    "camera behavior (static vs moving, panning, zooming);\n"
    "- the capture technique and any motion effects (e.g. time-lapse, slow motion, "
    "motion-blurred subjects);\n"
    "- notable objects: their SPECIFIC type and state/condition (e.g. a sliced "
    "pizza, an empty bench, an open door), not just generic terms like 'cars' or "
    "'boats'; background landmarks or buildings; and any text or signs you can "
    "read (even if partially legible); plus the overall mood;\n"
    "- notable ABSENCES when relevant (e.g. 'no people are visible').\n"
    "If you clearly recognize a place, product, animal, or franchise, name it. "
    "Only describe what is actually visible; if you are not sure what something "
    "is, describe it in general terms rather than guessing its identity. Write "
    "4-6 detailed sentences (roughly 150-250 words)."
)

# the HF Gemma endpoint caps a request at ~5 images; Kimi on Fireworks takes 16+.
_MAX_IMAGES = 5
_KIMI_STILLS = 15   # full-res individual frames (detail stream)
_FLOW_NOTE = (
    "\nThe FIRST image is a 5x5 montage of 25 frames spanning the WHOLE clip in "
    "time order (read left-to-right, top-to-bottom): use it to track the overall "
    "flow: what moves, what changes, the order of events. The remaining images "
    "are full-resolution stills from the same clip, in time order: use them for "
    "fine detail (text, faces, small objects). Do not describe the montage as a "
    "collage; it is one video."
)


def ground(frame_paths: List[str], transcript: str = "",
           montage_out: Optional[str] = None) -> str:
    """Grounding. Kimi path (when configured): one high-res 25-frame montage for
    the temporal flow + 15 full-res stills for detail, in a single call. Gemma
    path: 5 stills (endpoint image cap). Styling downstream is always Gemma; the
    grounding model only reports facts."""
    extra = (f"\n\nFor extra context, the audio transcript is:\n\"\"\"\n{transcript[:1500]}\n\"\"\""
             if transcript else "")
    if gc.kimi_available():
        try:
            imgs = list(frame_paths)
            prompt = _GROUND_PROMPT + extra
            if len(frame_paths) >= 20:  # enough for the flow montage + stills
                dest = montage_out or os.path.join(
                    tempfile.gettempdir(), f"prism_flow_{os.getpid()}.jpg")
                flow = V.make_montage(frame_paths[:25], dest, cell=440,
                                      max_side=1800, quality=80)
                n = len(frame_paths)
                idxs = sorted({round(i * (n - 1) / (_KIMI_STILLS - 1)) for i in range(_KIMI_STILLS)})
                if flow:
                    imgs = [flow] + [frame_paths[i] for i in idxs]
                    prompt = _GROUND_PROMPT + _FLOW_NOTE + extra
            return gc.kimi_describe(imgs[:16], prompt, max_tokens=600)
        except Exception:
            pass  # fall through to the pure-Gemma path
    return gc.vision_describe(frame_paths[:_MAX_IMAGES], _GROUND_PROMPT + extra, max_tokens=600)


_VERIFY_PROMPT = (
    "These are frames from ONE short video, in chronological order. Below is a "
    "DRAFT description of that video. Re-check the draft carefully against the "
    "frames and produce a corrected version:\n"
    "- remove or fix anything that is wrong or not actually visible;\n"
    "- add important detail that the draft missed, ESPECIALLY what HAPPENS across "
    "the clip: actions, motion and its direction, and how the scene changes from "
    "the first frames to the last;\n"
    "- keep it specific, factual, and 4-6 sentences.\n"
    "Return ONLY the corrected description.\n\nDraft:\n\"\"\"\n{desc}\n\"\"\""
)


def verify(frame_paths: List[str], description: str,
           montage_path: Optional[str] = None) -> str:
    """Second look: re-check the grounded description against the same frames and
    correct/enrich it (Raccoon's approach)."""
    prompt = _VERIFY_PROMPT.format(desc=description)
    return gc.vision_describe(frame_paths[:_MAX_IMAGES], prompt, max_tokens=560)


def stylize(description: str, styles: List[str]) -> dict:
    ordered = [s for s in S.STYLE_ORDER if s in styles] or styles
    guide = S.guide_for(ordered)
    keys = ", ".join(f'"{s}"' for s in ordered)
    user = (
        f"Here is a factual description of a short video:\n\"\"\"\n{description}\n\"\"\"\n\n"
        f"Write ONE caption for the video in EACH of these styles. Every caption must stay "
        f"faithful to the description above (same subjects and actions) while nailing its style:\n"
        f"{guide}\n\n"
        f"Make the four captions clearly DISTINCT from each other: different wording, angle, "
        f"and rhythm, not four rephrasings of the same sentence. Pack in specific, concrete "
        f"detail from the description; vague captions score poorly.\n"
        f"Return ONLY a JSON object with exactly these keys: {keys}. Each value is a caption "
        f"of 2 to 4 sentences (roughly 40-120 words), detailed and faithful to the "
        f"description. No extra text."
    )
    raw = gc.chat(
        # 800 tokens: richer multi-sentence captions across 4 styles; a smaller
        # budget truncated the LAST caption, dropping its key to the fallback.
        [{"role": "user", "content": user}],
        max_tokens=800, temperature=0.7,
        response_format={"type": "json_object"},
    )
    # Fallback is a SHORT grounded sentence, never the whole description; keeps
    # every card compact even when a style is missing.
    return _parse(raw, ordered, _short(description, 150))


def _short(text: str, limit: int) -> str:
    """First sentence of `text`, hard-capped at `limit` chars."""
    text = " ".join(text.split())
    first = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    if len(first) > limit:
        first = first[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return first


def _tidy(val: str, limit: int = 800) -> str:
    """Normalize whitespace; only trim a truly runaway caption (a fallback dump
    of the whole description). Rich multi-sentence captions pass through; the
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


def translate_captions(captions: dict, language: str) -> dict:
    """Demo-only: transcreate the four captions into another language with Gemma.
    Not translation but TRANSCREATION: each caption must keep its style's voice
    (sarcasm stays dry, the tech pun still lands, formal stays formal). Showcases
    Gemma's multilingual tone control; never part of the graded output."""
    keys = ", ".join(f'"{k}"' for k in captions)
    block = "\n".join(f"{k}: {v}" for k, v in captions.items())
    user = (
        f"Transcreate each of these video captions into {language}. Do NOT translate "
        f"word-for-word; rewrite each one the way a native {language} copywriter "
        f"would, PRESERVING its style: 'formal' stays professional and precise, "
        f"'sarcastic' stays dry and ironic, 'humorous_tech' keeps a tech joke that "
        f"lands in {language}, 'humorous_non_tech' keeps everyday humor with no tech "
        f"jargon. Keep proper nouns and readable on-screen text as-is. Keep each "
        f"caption about the same length as the original.\n\n{block}\n\n"
        f"Return ONLY a JSON object with exactly these keys: {keys}, each value the "
        f"{language} caption. No extra text."
    )
    raw = gc.chat([{"role": "user", "content": user}],
                  max_tokens=900, temperature=0.6,
                  response_format={"type": "json_object"})
    out = _parse(raw, list(captions.keys()), "")
    # any style that failed to translate falls back to its original
    return {k: (v if v else captions[k]) for k, v in out.items()}


def fact_anchor(description: str, captions: dict) -> dict:
    """Demo-only consistency check with EmbeddingGemma: cosine similarity between
    the grounded description and each styled caption. Prism's promise is four
    voices built on ONE set of facts; this makes that measurable per caption.
    Deliberately a read-only check (our best-of-N rewrite machinery scored worse
    on the live judge; a check can't hurt the captions)."""
    import math
    keys = list(captions.keys())
    vecs = gc.embed([description] + [captions[k] for k in keys])
    base = vecs[0]
    nb = math.sqrt(sum(x * x for x in base))
    out = {}
    for k, v in zip(keys, vecs[1:]):
        nv = math.sqrt(sum(x * x for x in v))
        out[k] = round(sum(a * b for a, b in zip(base, v)) / (nb * nv), 2)
    return out


def make_title(description: str) -> str:
    """A short, human-readable video name derived from the description (demo UI
    only, not part of the graded caption output)."""
    try:
        raw = gc.chat(
            [{"role": "user", "content":
              "Write a short, catchy title (3 to 6 words) for this video, like a "
              "headline or a filename. Reply with ONLY the title, with no quotes and no "
              "trailing period.\n\n"
              f"Video: {description[:600]}"}],
            max_tokens=24, temperature=0.5,
        )
        t = " ".join(raw.split()).strip().strip('"').strip("'").rstrip(".")
        return t[:70] if t else "Untitled clip"
    except Exception:
        return "Untitled clip"
