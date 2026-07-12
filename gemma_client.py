"""Gemma client with a 3-tier failover chain (all Gemma, all OpenAI-compatible):

  1. HF Inference Providers (Novita et al.): Gemma-4, MANAGED/serverless, always
     up. Primary: handles grading reliably with nothing of ours to keep warm.
  2. Fireworks: Gemma-4 via our deployment. Fallback 1 (only if a Fireworks
     Gemma endpoint is live).
  3. AMD-hosted Gemma-3 on the W7900 via ngrok. Fallback 2 (only while the pod +
     tunnel are up; dev/demo).

Each backend is skipped if unconfigured. Tried in order; first success wins.
Gemma-4 defaults to a "thinking" mode that returns content=null, so we send
reasoning_effort=none for the Gemma-4 backends and are None-safe everywhere.
"""
from __future__ import annotations
import base64
import os
import time
from dataclasses import dataclass
from typing import List, Optional

import requests

# Name of the backend that served the most recent successful call (for the demo
# UI's "which Gemma served this" indicator). Not used by the batch harness.
LAST_BACKEND: Optional[str] = None


@dataclass
class Backend:
    name: str
    base_url: str
    model: str
    api_key: str
    disable_thinking: bool  # Gemma-4 needs reasoning_effort=none; Gemma-3 doesn't
    timeout: int
    extra_headers: Optional[dict] = None  # e.g. ngrok skip-warning for the pod tunnel

    @property
    def usable(self) -> bool:
        return bool(self.base_url and self.model and self.api_key)


def _backends() -> List[Backend]:
    out = []
    # 1) PRIMARY: HF Inference Providers (managed Gemma-4).
    hf = Backend(
        name="hf",
        base_url=os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1").rstrip("/"),
        model=os.environ.get("HF_GEMMA_MODEL", "google/gemma-4-31B-it"),
        api_key=os.environ.get("HF_TOKEN", ""),
        disable_thinking=True,
        timeout=int(os.environ.get("HF_TIMEOUT", "90")),
    )
    if hf.usable:
        out.append(hf)
    # same model, same token, DIFFERENT hosts: the HF router lets us pin a
    # provider with a "model:provider" suffix. Under deadline-hour congestion the
    # router's default (novita) throws 429s while other hosts answer instantly,
    # so these give Gemma styling real failover without leaving Gemma.
    for suffix in os.environ.get(
            "HF_GEMMA_PROVIDERS", "cerebras,together,deepinfra").split(","):
        suffix = suffix.strip()
        if not suffix or not hf.usable:
            continue
        out.append(Backend(
            name=f"hf-{suffix}",
            base_url=hf.base_url,
            model=f"{hf.model}:{suffix}",
            api_key=hf.api_key,
            disable_thinking=True,
            timeout=hf.timeout,
        ))
    # 2) FALLBACK 1: Fireworks Gemma-4 (our deployment).
    fw = Backend(
        name="fireworks",
        base_url=os.environ.get("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1").rstrip("/"),
        model=os.environ.get("PRISM_FW_MODEL", ""),  # deployment path; unset = skip
        api_key=os.environ.get("FIREWORKS_API_KEY", ""),
        disable_thinking=True,
        timeout=int(os.environ.get("FW_TIMEOUT", "90")),
    )
    if fw.usable:
        out.append(fw)
    # 3) FALLBACK 2: AMD-hosted Gemma-3 via ngrok (vLLM on the W7900).
    amd = Backend(
        name="amd",
        base_url=(os.environ.get("AMD_GEMMA_BASE_URL", "").rstrip("/")),
        model=os.environ.get("AMD_GEMMA_MODEL", "google/gemma-3-12b-it"),
        api_key=os.environ.get("AMD_GEMMA_API_KEY", "EMPTY"),  # vLLM ignores it
        disable_thinking=False,  # Gemma-3 has no thinking mode
        timeout=int(os.environ.get("AMD_TIMEOUT", "60")),
        extra_headers={"ngrok-skip-browser-warning": "true"},
    )
    if amd.usable:
        out.append(amd)
    return out


def _post_chat(b: Backend, messages: list, max_tokens: int, temperature: float,
               response_format: Optional[dict], timeout: Optional[float] = None) -> str:
    payload = {"model": b.model, "messages": messages,
               "max_tokens": max_tokens, "temperature": temperature}
    if b.disable_thinking:
        payload["reasoning_effort"] = "none"
    if response_format:
        payload["response_format"] = response_format
    headers = {"Authorization": f"Bearer {b.api_key}", "Content-Type": "application/json"}
    if b.extra_headers:
        headers.update(b.extra_headers)
    r = requests.post(
        f"{b.base_url}/chat/completions",
        headers=headers, json=payload, timeout=timeout or b.timeout,
    )
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    content = msg.get("content")
    if not content:  # thinking-only response fallback
        content = msg.get("reasoning_content") or ""
    return content.strip()


# Transient HTTP statuses worth retrying (rate limit / gateway / overload).
# 402 (payment) and 4xx like 400/401/413 are NOT transient; fail over instead.
_TRANSIENT_STATUS = {429, 500, 502, 503, 504}
_BACKOFF = (1.0,)  # one quick retry, then hop backends; with four Gemma hosts, failover beats waiting


def _is_transient(e: Exception) -> bool:
    code = getattr(getattr(e, "response", None), "status_code", None)
    if code in _TRANSIENT_STATUS:
        return True
    return isinstance(e, (requests.Timeout, requests.ConnectionError))


def chat(messages: list, max_tokens: int = 512, temperature: float = 0.4,
         response_format: Optional[dict] = None,
         timeout: Optional[float] = None,
         deadline: Optional[float] = None) -> str:
    """deadline (absolute time.time() value) bounds the WHOLE failover chain:
    each attempt's socket timeout shrinks to the time left, and no new attempt
    starts with under ~2s remaining. Without it a 4-backend chain can spend
    several times any single-call timeout."""
    backends = _backends()
    if not backends:
        raise RuntimeError("no Gemma backend configured (set HF_TOKEN, or FIREWORKS_API_KEY+PRISM_FW_MODEL, or AMD_GEMMA_BASE_URL)")
    global LAST_BACKEND
    last = None
    for b in backends:
        # Retry transient errors on THIS backend before failing over to the next.
        for attempt in range(len(_BACKOFF) + 1):
            eff_timeout = timeout
            if deadline is not None:
                remaining = deadline - time.time()
                if remaining < 2:
                    raise last or RuntimeError("chat deadline exhausted")
                eff_timeout = min(timeout or remaining, remaining)
            try:
                out = _post_chat(b, messages, max_tokens, temperature,
                                 response_format, timeout=eff_timeout)
                if out:
                    LAST_BACKEND = b.name
                    return out
                last = RuntimeError(f"{b.name} returned empty")
                break  # empty is not transient; move to next backend
            except Exception as e:  # noqa: BLE001
                last = e
                if _is_transient(e) and attempt < len(_BACKOFF):
                    time.sleep(_BACKOFF[attempt])
                    continue
                break  # non-transient or retries exhausted; next backend
    raise RuntimeError(f"all Gemma backends failed: {last}")


def _b64_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


# ── Kimi grounding (Fireworks serverless) ────────────────────────────────────
# The top Track-2 teams (incl. the #1 Gemma-prize contender) ground with a
# frontier VLM and keep Gemma as the language/styling brain. Kimi-k2p6 accepts
# 8+ images per call (Fireworks' payload cap is far above HF's ~5) and reads
# fine detail Gemma-4's vision encoder misses. Styling stays 100% Gemma.
KIMI_MODELS = ("accounts/fireworks/models/kimi-k2p6",
               "accounts/fireworks/models/kimi-k2p5")


def kimi_available() -> bool:
    return bool(os.environ.get("FIREWORKS_API_KEY", ""))


def kimi_describe(frame_paths: List[str], prompt: str,
                  max_tokens: int = 600, timeout: int = 60,
                  deadline: Optional[float] = None) -> str:
    """One Kimi vision call over individual frames. Raises on total failure so the
    caller can fall back to the pure-Gemma path."""
    key = os.environ.get("FIREWORKS_API_KEY", "")
    if not key:
        raise RuntimeError("no FIREWORKS_API_KEY for Kimi grounding")
    content = [{"type": "text", "text": prompt}]
    for p in frame_paths:
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{_b64_image(p)}"}})
    global LAST_BACKEND
    last = None
    for model in KIMI_MODELS:
        for attempt in range(len(_BACKOFF) + 1):
            eff_timeout = float(timeout)
            if deadline is not None:
                remaining = deadline - time.time()
                if remaining < 2:
                    raise last or RuntimeError("kimi deadline exhausted")
                eff_timeout = min(eff_timeout, remaining)
            try:
                r = requests.post(
                    "https://api.fireworks.ai/inference/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}",
                             "Content-Type": "application/json"},
                    json={"model": model, "max_tokens": max_tokens,
                          "temperature": 0.3, "reasoning_effort": "none",
                          "messages": [{"role": "user", "content": content}]},
                    timeout=eff_timeout,
                )
                r.raise_for_status()
                msg = r.json()["choices"][0]["message"]
                out = (msg.get("content") or "").strip()
                # Kimi is a reasoning model; strip any leaked thinking trace
                if "</think>" in out:
                    out = out.split("</think>", 1)[1].strip()
                if out:
                    LAST_BACKEND = "kimi"
                    return out
                last = RuntimeError(f"{model} returned empty")
                break
            except Exception as e:  # noqa: BLE001
                last = e
                if _is_transient(e) and attempt < len(_BACKOFF):
                    time.sleep(_BACKOFF[attempt])
                    continue
                break
    raise RuntimeError(f"kimi grounding failed: {last}")


def vision_describe(frame_paths: List[str], prompt: str,
                    max_tokens: int = 400, timeout: int = 120,
                    deadline: Optional[float] = None) -> str:
    content = [{"type": "text", "text": prompt}]
    for p in frame_paths:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{_b64_image(p)}"},
        })
    return chat([{"role": "user", "content": content}], max_tokens=max_tokens,
                temperature=0.2, timeout=timeout, deadline=deadline)


TS_TRANSCRIBE_PROMPT = (
    "Transcribe the speech in this audio with timestamps. Output ONE line per "
    "utterance in exactly this format:\n[M:SS] spoken words\n"
    "Use the audio's own timeline for the timestamps (when each utterance STARTS). "
    "Transcribe word for word. If a stretch has no speech, simply skip it. "
    "If there is no intelligible speech at all, reply with exactly NO_SPEECH.")

TRANSCRIBE_PROMPT = (
    "Transcribe the speech in this audio exactly, word for word. "
    "If there is no intelligible speech, reply with exactly NO_SPEECH.")


def hear(wav_path: str, prompt: str = "", timeout: int = 60, max_tokens: int = 90) -> str:
    """Audio description from Gemma 3n E4B, serverless via the HF router (served
    by Together). Note the format quirk: the endpoint rejects OpenAI-style
    input_audio but accepts an audio_url data URI. Experimental: the small
    checkpoint hears ambient/music soundtracks unreliably; treat output as a
    hint, never as graded fact."""
    import base64 as _b
    b64 = _b.b64encode(open(wav_path, "rb").read()).decode("ascii")
    r = requests.post(
        "https://router.huggingface.co/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ.get('HF_TOKEN', '')}"},
        json={"model": "google/gemma-3n-E4B-it", "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": [
                  {"type": "text", "text": prompt or (
                      "This is the soundtrack of a short video clip. In one or two "
                      "sentences, describe what you HEAR: speech (summarize it), "
                      "music, ambient noise, crowd or mechanical sounds. Only report "
                      "what is clearly audible; if it is just a music bed or "
                      "indistinct noise, say so plainly.")},
                  {"type": "audio_url", "audio_url": {"url": f"data:audio/wav;base64,{b64}"}}]}]},
        timeout=timeout,
    )
    r.raise_for_status()
    return (r.json()["choices"][0]["message"]["content"] or "").strip()


def gemini_hear(wav_path: str, prompt: str, timeout: int = 60,
                max_tokens: int = 90) -> str:
    """Demo-only audio fallback: when the hosted Gemma 3n route flaps (provider
    availability comes and goes), Gemini carries the soundtrack/transcript
    features so the demo never shows dead panels. Labeled as a fallback in the
    UI; Gemma 3n stays the primary."""
    import base64 as _b
    key = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GEMINI_KEY_1", "")
    if not key:
        raise RuntimeError("no GEMINI key for audio fallback")
    b64 = _b.b64encode(open(wav_path, "rb").read()).decode("ascii")
    r = requests.post(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": "gemini-flash-latest", "max_tokens": max_tokens,
              "reasoning_effort": "low",
              "messages": [{"role": "user", "content": [
                  {"type": "text", "text": prompt},
                  {"type": "input_audio", "input_audio": {"data": b64, "format": "wav"}}]}]},
        timeout=timeout,
    )
    r.raise_for_status()
    return (r.json()["choices"][0]["message"]["content"] or "").strip()


def embed(texts, timeout: int = 30):
    """Sentence embeddings via EmbeddingGemma (google/embeddinggemma-300m) on the
    HF router. Used by the demo's fact-anchor check: is each styled caption still
    semantically anchored to the grounded description? A check, not a rewrite."""
    r = requests.post(
        "https://router.huggingface.co/hf-inference/models/google/embeddinggemma-300m/pipeline/feature-extraction",
        headers={"Authorization": f"Bearer {os.environ.get('HF_TOKEN', '')}"},
        json={"inputs": texts}, timeout=timeout,
    )
    r.raise_for_status()
    vecs = r.json()
    if vecs and isinstance(vecs[0][0], list):  # token-level output: take first row
        vecs = [v[0] for v in vecs]
    return vecs


def active_backends() -> List[str]:
    return [b.name for b in _backends()]
