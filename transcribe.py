"""Local audio transcription via faster-whisper (CPU, int8).

Self-contained: no external API or credential. The model is baked into the
image at build. Transcription is a grounding aid: any failure returns "" and the
pipeline falls back to frames-only grounding.
"""
from __future__ import annotations
import os
from typing import Optional

_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        size = os.environ.get("PRISM_WHISPER_SIZE", "base.en")
        _model = WhisperModel(size, device="cpu", compute_type="int8",
                              cpu_threads=int(os.environ.get("PRISM_WHISPER_THREADS", "2")))
    return _model


def transcribe(audio_path: str) -> str:
    if not audio_path or not os.path.exists(audio_path):
        return ""
    try:
        segments, info = _get_model().transcribe(
            audio_path, beam_size=1, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        # Ignore near-empty/music-only results.
        return text if len(text) >= 4 else ""
    except Exception:
        return ""
