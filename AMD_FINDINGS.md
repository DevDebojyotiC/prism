<img src="assets/brand/amd-logo-red.png" alt="AMD" height="30" />

# AMD Radeon Findings, measured while building Prism

Everything below was measured on the AMD hardware provisioned for the hackathon,
while getting Prism's Gemma voice to run on it. Where a finding shaped Prism, the
consequence is stated. This is the companion to [GEMMA_FINDINGS](GEMMA_FINDINGS.md):
that file covers the models, this one covers the silicon they run on.

**Scope.** Prism's graded captioning path uses serverless providers, not AMD. AMD
compute does one shipped job: it synthesizes Prism's Gemma voice (T5Gemma-TTS),
live in the demo, with the hardware named in the API response. Everything below is
either that shipped path or capability we verified on the box.

---

## 1. The hardware

The provisioned pod, read off `rocm-smi`, `rocminfo`, and the running stack:

| | |
|---|---|
| GPU | AMD Radeon PRO W7900 ×8 (PCI `0x744b`, Navi 31 / gfx1100, RDNA3) |
| VRAM | ~48 GB per card (51.5 GB reported) |
| Host CPU | AMD EPYC 9334, 32-core |
| Runtime | ROCm 7.2.1 |
| Framework | PyTorch 2.9.1 (HIP 7.2), vLLM 0.16 (pre-installed in `/opt/venv`) |
| Raw compute | ~31 TFLOP/s fp16 (measured) |

RDNA3 is a workstation architecture, not a datacenter Instinct part. The question
we cared about was whether real model serving works on it. The sections below show
that it does.

---

## 2. Text inference

`Qwen2.5-7B-Instruct` served through the pod's vLLM:

| Load | Throughput |
|---|---|
| Single request | ~29 tokens/s |
| 32 concurrent requests | ~700 tokens/s aggregate |

Single-stream latency is modest; the useful number is the ~24× scaling to 700
tokens/s under 32 concurrent streams, which is the regime a hosted endpoint runs in.

---

## 3. Vision serving on RDNA3

Multimodal serving on RDNA3 is sometimes assumed to be immature. We tested it
through vLLM on the W7900:

| Model | Result |
|---|---|
| `Qwen2.5-VL-7B-Instruct` | Loaded and served; described a real photo accurately |
| `google/gemma-3-12b-it` | Loaded and served; described the same photo accurately |

Both correctly read a standard test image (a cat on a couch), naming subject,
setting, and detail. Gemma-3 vision runs on AMD Radeon silicon. The one limit is
version: the pod's vLLM build predates Gemma-4's release, so its model registry has
Gemma / 2 / 3 / 3n but no Gemma-4 class. That is a build-date gap, not a licensing
or hardware restriction.

Consequence for Prism: the pipeline's Gemma styling ships an AMD-hosted failover
tier (`AMD_GEMMA_BASE_URL`, labelled *Gemma-3 · AMD W7900* in the demo's meta
pills). The language brain can run on Radeon when configured.

---

## 4. The Gemma voice, synthesized on AMD (what Prism ships)

The one AMD path that is live in the demo.

- **Model:** T5Gemma-TTS (`Aratako/T5Gemma-TTS-2b-2b`, built on Google's T5Gemma
  weights) plus an XCodec2 neural codec.
- **Where:** the Radeon PRO W7900, through ROCm 7.2 / PyTorch 2.9.
- **Proof:** the demo's listen button calls this endpoint; the API returns
  `engine: "T5Gemma-TTS on AMD W7900"`, rendered live on the button as an AMD-red
  badge. First synthesis takes ~20 s (model warm-up), faster thereafter.

Gemma-4 writes the words, and a Gemma-family TTS speaks them on AMD silicon.

---

## 5. ROCm engineering notes

Porting a CUDA/ZeroGPU-targeted TTS Space to this Radeon pod surfaced four ROCm
lessons, each of which cost us time and each of which has a clean fix.

1. **ROCm reports through the CUDA API.** `torch.cuda.is_available()` returns
   `True` on ROCm, and the device string is `"cuda"`. Code written for NVIDIA runs
   unmodified; the W7900 is driven through the same calls.
2. **Do not `pip install torch` on a ROCm box.** The default wheel bundles a
   ROCm 6.2.4 runtime that mismatches the system's ROCm 7.2.1. Triton then fails to
   initialize its HIP backend (`cannot get address for 'hipDrvLaunchKernelEx' from
   libamdhip64.so`) the moment anything compiles an attention kernel. The fix is to
   use the pod's matched PyTorch 2.9 / ROCm 7.2 environment (`/opt/venv`) and
   install everything else around it, never over it.
3. **Version-matched Triton works.** Once torch matched the system ROCm, the same
   flex-attention compile that had been crashing completed without error. The cause
   was a bundled-vs-system ROCm version skew, not the GPU.
4. **gfx1100 is well supported.** RDNA3 has been in ROCm since 5.7; nothing here
   needed `HSA_OVERRIDE_GFX_VERSION` or other coercion. The W7900 is a first-class
   ROCm target.

The exact commands, the failing traceback, and the fix are in the project's AMD
setup notes (`amd/tts_server_setup.md`).

---

## 6. What else the pod could host in Prism's pipeline

Prism is five model stages. Today four run on serverless providers and one (the
voice) runs on the W7900. The pod can host every one of them. What each stage would
gain and give up on Radeon:

| Stage | Runs today on | AMD-hostable model | If it moved to the W7900 |
|---|---|---|---|
| Speech transcript | Gemma 3n E4B (HF router) | Gemma 3n E4B | **+** no router 429s or `audio_url` format quirks; **−** model load and warm-up |
| Grounding (vision) | Kimi / Qwen3-VL / Gemma-4 (APIs) | Gemma-3-12B or Qwen2.5-VL (both verified, §3) | **+** zero per-call cost, no rate limits, batch throughput; **−** Gemma-3 reads fine detail a notch below Kimi and Qwen3-VL-235B |
| Caption authorship | Gemma-4-31B (HF) | Gemma-3 (Gemma-4 absent, §3) | **+** zero cost and limits; **−** a quality regression, or a risky vLLM upgrade to reach Gemma-4 |
| Fact anchor | EmbeddingGemma (HF) | EmbeddingGemma | **+** fully local, trivial to serve; **−** negligible either way |
| Voice (TTS) | the W7900 | T5Gemma-TTS | already here, the shipped path |

Four of the five stages already have a working AMD model; the only gap is Gemma-4,
which is a vLLM build-date gap (§3), not a hardware one. A single W7900 has the VRAM
and throughput (§1, §2) to hold several of these at once, which is what makes the
one-box pipeline in §8 practical.

## 7. Why the graded pipeline stays on serverless APIs (and the voice does not)

A design choice driven by how the scoring works.

The hackathon GPU is time-gated: the pod is a time-limited session, while the
leaderboard re-scores submissions repeatedly over days. If Prism's graded
captioning called a self-hosted endpoint on this pod, every scoring run after the
session expired would hit a dead endpoint and the container would error out.
Availability during an unknown future scoring window is worth more than any
per-call saving, so the graded path uses always-on serverless providers.

The voice is the exception because it is not graded. The listen button is a demo
feature with a browser-speech fallback; if the pod expires it degrades to the
browser voice and the score is unaffected. That is the one place where the
time-gate risk carries no cost, so that is where the AMD compute went. The choice
of what to self-host followed from what can tolerate the GPU going away.

## 8. If the GPU were not time-gated: the all-AMD Prism

With a reserved or dedicated W7900 instead of a session, self-hosting becomes the
better option. This is the version of Prism we would build on persistent AMD
silicon.

Every stage would run on a single W7900: Gemma 3n hears, Gemma-3 or Qwen-VL
grounds, Gemma writes, EmbeddingGemma verifies, T5Gemma speaks. Four external
providers become one dependency.

What that changes:
- **Cost.** No Fireworks tokens, no HF Inference bills. Captioning at scale moves
  from per-call pricing to flat owned compute.
- **Reliability.** No rate limits or quota; the ZeroGPU outage that cost us the
  voice for hours cannot happen on owned compute.
- **Throughput.** vLLM sustained ~700 tokens/s across 32 streams (§2). The grading
  set could be captioned as one concurrent batch instead of serial API calls.
- **Quality headroom.** With no per-call cost, the levers we rationed on the API
  path return: more frames per clip, best-of-N over several groundings, longer
  context, larger models.
- **Privacy.** Clips never leave the machine. For a brand captioning unreleased
  footage, an all-AMD Prism runs where the video already lives.

The architecture shifts with it. Today the grounding race hedges across providers
to survive rate limits and outages; on a dedicated GPU that race becomes a local
batch, and the hedge budget goes to depth (best-of-N, verify passes) instead of
redundancy. The per-clip time-budget that guards the 30 s cap against congested APIs
relaxes, because local inference latency is predictable. On persistent Radeon
compute, self-hosting is the stronger design rather than a fallback.

---

## Summary

| Capability | Measured verdict on the W7900 |
|---|---|
| Concurrent text serving | ~700 tokens/s at 32 streams (Qwen2.5-7B) |
| Vision-language serving | Works, including Gemma-3-12B and Qwen-VL |
| Neural TTS (T5Gemma + XCodec2) | Works; Prism's shipped Gemma voice runs here |
| Drop-in CUDA code | Runs unmodified (ROCm presents as CUDA) |
| Newest-model support | Gated by the pre-installed vLLM build date, not the hardware |

Prism uses AMD compute for one thing: the Gemma voice is synthesized on a Radeon
PRO W7900. Every number above is reproducible on the same pod with the commands in
this repo.
