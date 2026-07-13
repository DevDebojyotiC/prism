# AMD Radeon Findings, measured while building Prism

Everything below was **measured by us on the actual AMD hardware** provisioned for
the hackathon, while getting Prism's Gemma voice to run on it. Where a finding
shaped Prism, the consequence is stated. This is the companion to
[GEMMA_FINDINGS](GEMMA_FINDINGS.md): that one is about the models, this one is
about the silicon they can run on.

**Scope.** Prism's *graded* captioning path uses serverless providers, not AMD.
AMD compute does one shipped job: it **synthesizes Prism's Gemma voice**
(T5Gemma-TTS), live in the demo, with the hardware named in the API response.
Everything below is either that shipped path or capability we verified on the box.

---

## 1. The hardware, characterized

The provisioned pod, read straight off `rocm-smi`, `rocminfo`, and the running
stack:

| | |
|---|---|
| GPU | **AMD Radeon PRO W7900** ×8 (PCI `0x744b`, **Navi 31 / gfx1100**, RDNA3) |
| VRAM | ~48 GB per card (51.5 GB reported) |
| Host CPU | AMD EPYC 9334, 32-core |
| Runtime | **ROCm 7.2.1** |
| Framework | **PyTorch 2.9.1** (HIP 7.2), **vLLM 0.16** (pre-installed in `/opt/venv`) |
| Raw compute | ~31 TFLOP/s fp16 (measured) |

RDNA3 is a workstation/desktop architecture, not a datacenter Instinct part. The
practical question we cared about was not peak FLOPs but **whether real model
serving works on it** — the answer, below, is yes.

---

## 2. Text inference: healthy throughput, excellent concurrency

`Qwen2.5-7B-Instruct` served through the pod's vLLM:

| Load | Throughput |
|---|---|
| Single request | ~29 tokens/s |
| 32 concurrent requests | **~700 tokens/s** aggregate |

The ~24× scaling from 1 to 32 concurrent streams is the headline: RDNA3 + vLLM's
paged attention keeps the card busy under batch, which is exactly the regime a
hosted endpoint runs in. Single-stream latency is modest; concurrent throughput is
where the W7900 earns its place.

---

## 3. Vision serving works on RDNA3 (this surprised us)

A common assumption is that multimodal serving on RDNA3 is immature. We tested it
directly through vLLM on the W7900:

| Model | Result |
|---|---|
| `Qwen2.5-VL-7B-Instruct` | Loaded and served; **accurately described a real photo** |
| **`google/gemma-3-12b-it`** | Loaded and served; **accurately described the same photo** |

Both correctly read a standard test image (a cat on a couch), naming subject,
setting, and detail. **Gemma-3 vision runs on AMD Radeon silicon.** The one limit
we found is version, not capability: the pod's vLLM build predates Gemma-4's
release, so its model registry has Gemma / 2 / 3 / 3n but no Gemma-4 class. That
is a build-date gap, not a licensing or hardware restriction.

Consequence for Prism: this is why the pipeline's Gemma styling ships an
**AMD-hosted failover tier** (`AMD_GEMMA_BASE_URL`, labelled *Gemma-3 · AMD W7900*
in the demo's meta pills). The language brain can run on Radeon when configured.

---

## 4. The Gemma voice, synthesized on AMD (what Prism ships)

The one AMD path that is live in the demo, not just verified.

- **Model:** T5Gemma-TTS (`Aratako/T5Gemma-TTS-2b-2b`, built on Google's T5Gemma
  weights) plus an XCodec2 neural codec.
- **Where:** the Radeon PRO W7900, through ROCm 7.2 / PyTorch 2.9.
- **Proof:** the demo's *listen* button calls this endpoint; the API returns
  `engine: "T5Gemma-TTS on AMD W7900"`, rendered live on the button as an AMD-red
  badge. First synthesis ~20 s (model warm-up), faster thereafter.

This is the "one clip, four voices, one Gemma brain" story extended to sound:
Gemma-4 writes the words, and a Gemma-family TTS speaks them **on AMD silicon**.

---

## 5. ROCm engineering: the gotchas we solved

Porting a CUDA/ZeroGPU-targeted TTS Space to this Radeon pod surfaced real ROCm
lessons worth recording, because each one cost us hours and each has a clean fix.

1. **ROCm reports through the CUDA API.** `torch.cuda.is_available()` returns
   `True` on ROCm, and the device string is `"cuda"`. Code written for NVIDIA runs
   unmodified; the W7900 is driven through the same calls.
2. **Do not `pip install torch` on a ROCm box.** The default wheel bundles a
   ROCm 6.2.4 runtime that mismatches the system's ROCm 7.2.1. Triton then fails
   to initialize its HIP backend (`cannot get address for 'hipDrvLaunchKernelEx'
   from libamdhip64.so`) the moment anything compiles an attention kernel. The fix
   is not a workaround: **use the pod's matched PyTorch 2.9 / ROCm 7.2 environment**
   (`/opt/venv`) and install everything else *around* it, never over it.
3. **Version-matched Triton just works.** Once torch matched the system ROCm, the
   same flex-attention compile that had been crashing completed silently. The
   error was never the GPU; it was a bundled-vs-system ROCm version skew.
4. **gfx1100 is well supported.** RDNA3 has been in ROCm since 5.7; nothing here
   needed `HSA_OVERRIDE_GFX_VERSION` or other coercion. The W7900 is a
   first-class ROCm target.

Reproducibility: the exact commands, the failing traceback, and the fix are in the
project's AMD setup notes (`amd/tts_server_setup.md`).

---

## 6. What else this pod could host in Prism's pipeline

Prism is five model stages. Today four run on serverless providers and one (the
voice) runs on the W7900 — but the pod can host **every one of them**. What each
stage would gain and give up on Radeon:

| Stage | Runs today on | AMD-hostable model | If it moved to the W7900 |
|---|---|---|---|
| **Speech transcript** | Gemma 3n E4B (HF router) | Gemma 3n E4B | **+** no router 429s or `audio_url` format quirks · **−** model load + warm-up |
| **Grounding (vision)** | Kimi / Qwen3-VL / Gemma-4 (APIs) | **Gemma-3-12B or Qwen2.5-VL** (both verified, §3) | **+** zero per-call cost, no rate limits, batch throughput · **−** Gemma-3 reads fine detail a notch below Kimi / Qwen3-VL-235B |
| **Caption authorship** | Gemma-4-31B (HF) | Gemma-3 (Gemma-4 absent, §3) | **+** zero cost/limits · **−** a quality regression, or a risky vLLM upgrade to reach Gemma-4 |
| **Fact anchor** | EmbeddingGemma (HF) | EmbeddingGemma | **+** fully local, trivial to serve · **−** negligible either way |
| **Voice (TTS)** | **the W7900** | T5Gemma-TTS | already here — the shipped path |

Two things stand out. **Four of five stages already have a working AMD model** — the
only real gap is Gemma-4, and that is a vLLM build-date gap (§3), not a hardware
one. And a single W7900 has the VRAM and throughput (§1, §2) to hold several of
these at once, which is what makes the "one box, whole pipeline" idea in §8 realistic
rather than aspirational.

## 7. Why the graded pipeline stays on serverless APIs (and the voice does not)

A deliberate design choice, driven by how the scoring works.

**The hackathon GPU is time-gated.** The pod is a time-limited session; the
leaderboard, by contrast, **re-scores submissions repeatedly over days**. If Prism's
*graded* captioning called a self-hosted endpoint on this pod, the moment the
session expired every later scoring run would hit a dead endpoint — the container
would error and the score would collapse toward zero. Availability during an unknown
future scoring window is worth more than any per-call saving, so the graded path
uses **always-on serverless providers on purpose**.

**The voice is the exception precisely because it is not graded.** The listen button
is a demo feature with a browser-speech fallback; if the pod expires it degrades
gracefully to the browser voice and **nothing about the score changes**. That is the
one place where the time-gate risk is free — so that is exactly where we put the AMD
compute. The choice of *what* to self-host was driven by *what can tolerate the GPU
going away*. Time-gated GPUs are excellent for everything except the one thing that
must answer a call at an unpredictable later moment.

## 8. If the GPU weren't time-gated: the all-AMD Prism

Lift the time gate — a reserved or dedicated W7900 instead of a session — and the
calculus inverts. Self-hosting stops being a liability and becomes the better
architecture. This is the Prism we would build on persistent AMD silicon.

**One box, the whole Gemma family.** Every stage collapses onto a single W7900:
Gemma 3n *hears* → Gemma-3 / Qwen-VL *grounds* → Gemma *writes* → EmbeddingGemma
*verifies* → T5Gemma *speaks*. Four external providers become one dependency; "four
Gemma models, one agent" becomes "four Gemma models, one GPU."

**What that unlocks, concretely:**
- **Zero marginal cost per clip.** No Fireworks tokens, no HF Inference bills.
  Captioning at scale shifts from per-call pricing to flat owned compute.
- **No rate limits, no quota, no third-party outage.** The exact failure that cost
  us the ZeroGPU voice for hours cannot happen on owned compute.
- **Batch throughput as the design centre.** vLLM sustained ~700 tok/s across 32
  streams (§2). The whole grading set could be captioned in one concurrent batch
  instead of serial API calls — plausibly *faster* wall-clock than the API path.
- **Spend the freed budget on quality.** With no per-call cost, the levers we
  rationed for the API path return: more frames per clip, a real best-of-N over
  several groundings, longer context, larger models. The pipeline can be more
  thorough because thoroughness is no longer metered.
- **Privacy and on-prem.** Clips never leave the machine. For a brand captioning
  unreleased footage, an all-AMD Prism is a self-contained appliance that runs where
  the video already lives.

**How the architecture would actually change.** Today the grounding race hedges
across providers to survive rate limits and outages; on a dedicated GPU that race
becomes a local batch, and the hedge budget converts into *depth* (best-of-N, verify
passes) instead of *redundancy*. The per-clip time-budget system that guards the 30s
cap against congested APIs relaxes, because local inference latency is predictable.
And the AMD story stops being a footnote about the voice and becomes the substrate of
the whole agent.

The time gate is the only thing standing between Prism-on-APIs and an all-AMD Prism
that is cheaper, faster under batch, private, and unmetered. On persistent Radeon
compute, self-hosting is not the compromise — it is the upgrade.

---

## Summary: what AMD Radeon is the right tool for

| Capability | Measured verdict on the W7900 |
|---|---|
| Concurrent text serving | Excellent: ~700 tok/s at 32 streams (Qwen2.5-7B) |
| Vision-language serving | Works, including **Gemma-3-12B** and Qwen-VL |
| Neural TTS (T5Gemma + XCodec2) | Works; **Prism's shipped Gemma voice runs here** |
| Drop-in CUDA code | Runs unmodified (ROCm masquerades as CUDA) |
| Newest-model support | Gated by the pre-installed vLLM build date, not the hardware |

Prism uses AMD compute for exactly one thing and is transparent about it: the Gemma
voice is genuinely synthesized on a Radeon PRO W7900. Every number above is
reproducible on the same pod with the commands in this repo.
