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
               response_format: Optional[dict]) -> str:
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
        headers=headers, json=payload, timeout=b.timeout,
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
_BACKOFF = (1.0, 3.0)  # sleeps between attempts; total <30s/request budget


def _is_transient(e: Exception) -> bool:
    code = getattr(getattr(e, "response", None), "status_code", None)
    if code in _TRANSIENT_STATUS:
        return True
    return isinstance(e, (requests.Timeout, requests.ConnectionError))


def chat(messages: list, max_tokens: int = 512, temperature: float = 0.4,
         response_format: Optional[dict] = None, timeout: int = 90) -> str:
    backends = _backends()
    if not backends:
        raise RuntimeError("no Gemma backend configured (set HF_TOKEN, or FIREWORKS_API_KEY+PRISM_FW_MODEL, or AMD_GEMMA_BASE_URL)")
    global LAST_BACKEND
    last = None
    for b in backends:
        # Retry transient errors on THIS backend before failing over to the next.
        for attempt in range(len(_BACKOFF) + 1):
            try:
                out = _post_chat(b, messages, max_tokens, temperature, response_format)
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
                  max_tokens: int = 600, timeout: int = 60) -> str:
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
            try:
                r = requests.post(
                    "https://api.fireworks.ai/inference/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}",
                             "Content-Type": "application/json"},
                    json={"model": model, "max_tokens": max_tokens,
                          "temperature": 0.3, "reasoning_effort": "none",
                          "messages": [{"role": "user", "content": content}]},
                    timeout=timeout,
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
                    max_tokens: int = 400, timeout: int = 120) -> str:
    content = [{"type": "text", "text": prompt}]
    for p in frame_paths:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{_b64_image(p)}"},
        })
    return chat([{"role": "user", "content": content}], max_tokens=max_tokens,
                temperature=0.2, timeout=timeout)


def active_backends() -> List[str]:
    return [b.name for b in _backends()]
