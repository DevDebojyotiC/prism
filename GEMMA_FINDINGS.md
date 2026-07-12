# Gemma-4 Capability Findings — measured while building Prism

Everything below was **measured by us, on live endpoints, during this hackathon** —
not quoted from documentation. Where a finding changed Prism's design, the design
consequence is stated. Model under test: `google/gemma-4-31B-it` via HF Inference
Providers (OpenAI-compatible), unless noted. Test scripts live in `test/`.

---

## 1. Vision: OCR is genuinely strong — and saturates by ~896px

**Method.** We rendered an "eye chart": seven rows of unique text at decreasing font
sizes (64px down to 9px) on a 1600×1000 canvas, then asked Gemma-4 to transcribe
every legible row at six different input resolutions.

| Input size (long edge) | Rows read (A=64px … G=9px) |
|---|---|
| 384px | A–F (missed only the 9px microtext) |
| **512px** | **A–G — everything, including 9px microtext** |
| 768px / 896px / 1152px / 1600px | A–G (no further improvement) |

**Findings.**
- Gemma-4 reads text down to **~1% of image height** once the input is ≥512px.
- Detail extraction **saturates around 512–896px** (consistent with a SigLIP-class
  encoder at ~896px, ~256 tokens/image). Sending larger images wastes payload and
  buys nothing.

**Design consequence.** Prism samples frames at 768px — comfortably above the
saturation knee, cheap to ship. Feeding Gemma *fewer, bigger* frames beats feeding
it many small ones: our original 9-frame montage (~300px per cell) blinded the
model to signage, jewelry, and facial detail that individual 768px frames recover
(it went from "a city street" to reading the actual shop signs on the same clip).

## 2. Speed: sub-second calls, near-perfect parallel scaling

**Method.** Timed identical vision requests sequentially and concurrently.

| Configuration | Wall-clock |
|---|---|
| 1 call | ~0.9s |
| 4 sequential calls | 3.5s |
| 4 parallel calls | **1.2s** |
| 6 parallel calls | **1.0s** |

**Finding.** The managed Gemma endpoint scales concurrency almost perfectly — six
simultaneous calls cost barely more than one. Latency budgets should be designed
around *parallel fan-out*, not call-count.

**Design consequence.** Prism's experimental "wide grounding" mode covers a whole
clip at full resolution by fanning out parallel segment calls (the payload cap is
per-call), all inside ~2s of wall-clock.

## 3. Payload: the real constraint is images-per-call, not bytes

**Method.** Binary-searched the request size on the managed endpoint with realistic
JPEG frames.

| Request | Result |
|---|---|
| 5 × 768px frames (~220KB) | ✅ accepted |
| 6 × 768px frames (~264KB) | ❌ HTTP 413 |
| 6 × 640px frames (~198KB) | ❌ HTTP 413 — *fewer bytes than the accepted request* |
| 1 × 1600px image (~128KB) | ✅ accepted |
| 1 montage + 4 × 768px frames (5 images, ~215KB) | ✅ accepted |

**Finding.** The managed endpoint enforces an **image-count cap (~5/call)**, not
just a byte cap — 6 images fail even when the total payload is *smaller* than an
accepted 5-image request.

**Design consequence.** Prism's pure-Gemma modes are built around ≤5 images per
call; whole-clip coverage comes from parallel calls (§2), not bigger requests.

## 4. Generation: reasoning mode, JSON compliance, token budgets, degeneracy

- **Thinking mode default.** Gemma-4 defaults to a reasoning mode that can return
  `content: null` (thinking-only responses). Production calls need
  `reasoning_effort: "none"` plus a None-safe reader. Prism sends both.
- **Structured JSON is rock-solid** with `response_format: {"type":"json_object"}` —
  all four styled captions arrive as one valid JSON object per call. The one trap
  is the **token budget**: at `max_tokens=500` the *last* JSON key gets truncated
  and silently lost; 800 is reliably safe for four 40–120-word captions.
- **Repetition degeneracy.** Small Gemma-4 checkpoints (e.g. 26B-A4B class) can
  fall into repetition loops ("too many too many too many…") at temperature ≥0.7
  with multi-image context. We built a lexical-variety/repeated-n-gram guard;
  another Track-2 team (SEV-Cap) independently documented the same failure. The
  31B dense model at ≤0.7 was stable throughout our runs.

## 5. Style writing: the underrated strength

Gemma-4-31B writes **four genuinely distinct voices in one call** — formal,
sarcastic, humorous-tech, humorous-non-tech — holding tone without drifting off
the supplied facts. Sampled outputs (full sets in the repo demo):

> *sarcastic:* "She is typing on that white keyboard with a level of neutrality
> that makes the potted plant look charismatic."

> *humorous_tech:* "The city's traffic pipeline is experiencing some serious
> latency — a massive merge conflict between the red buses and the blue ones, and
> the throughput is definitely not scaling."

This is why Gemma is Prism's **load-bearing language brain**: every graded word in
every Prism mode is authored by Gemma.

## 6. The honest limit: perception, not language

Gemma-4's vision encoder compresses each image to ~256 tokens. On fine-grained
perception it makes errors that **no prompt can fix**, because the information is
lost before any instruction is read. Failure cases we reproduced repeatedly:

- an afro puff hairstyle consistently described as a "high bun";
- a plain pizza confidently given a "chicken topping";
- a partially-visible billboard "read" as a brand name that isn't there.

We tried to prompt our way out — anti-hallucination "discipline" blocks, claim-by-
claim verification, generic-wording fallbacks. Measured on the competition's real
judge, **every prompting intervention made the score worse** (see §7): hedging
trades away the specific, correct detail the judge rewards, without fixing the
misperceptions.

**Design consequence — the intentional split.** In Prism's accuracy mode (v10) a
frontier VLM handles *perception only* (one grounding call), while **Gemma authors
100% of the caption text**. In pure-Gemma modes (v8/v9), Gemma does both jobs and
lands ~0.80–0.82 on the live judge — respectable, and the gap to ~0.9 is almost
entirely §6, not language quality. That is a measured, documented reason for the
model split — not brand decoration.

## 7. A/B on the real judge: simplicity wins

All scores from the competition's live leaderboard, same team, same harness:

| Variant | Change vs baseline | Real score |
|---|---|---|
| v2 | simple: ground → verify → style | **0.82** |
| v3 | + per-style rubrics, word caps, anti-hallucination discipline, few-shot | 0.74 |
| v4 | + best-of-N candidates with a grounded selector, scene-detect sampling | 0.72 |
| v2 (resubmitted unchanged) | — | 0.80 |

**Findings.**
- **Prompt sophistication regressed the score monotonically** (0.82 → 0.74 → 0.72).
  The judge rewards specific, correct, detailed captions; machinery that constrains
  or hedges the model costs more than it saves.
- Resubmitting the **identical image** scored 0.82 then 0.80: the judging pipeline
  has **±0.02+ run-to-run noise on unchanged code** (we observed ±0.1 swings on
  other teams). Deltas smaller than ~0.04 are not measurable on this leaderboard.
- Offline proxy judges (a Gemini-based scorer, and frontier-model self-review)
  **over-predicted by ~0.07–0.11** and ranked variants in the wrong order. The only
  evaluator that counts is the real one.

---

## Summary: what Gemma-4 is the right tool for

| Capability | Measured verdict |
|---|---|
| Styled, tone-controlled writing | Excellent — four distinct voices, one call |
| Structured JSON output | Excellent (mind the token budget) |
| OCR / on-screen text | Excellent at ≥512px input |
| Latency & parallel scaling | ~0.9s/call; 6 parallel ≈ 1s |
| Fine-grained visual perception | Real limits — pair with a frontier VLM when accuracy is graded |
| Robustness knobs | `reasoning_effort:"none"`, temp ≤0.7 multi-image, ≤5 images/call |

Prism uses Gemma for exactly what it measured best at — and is transparent about
the rest. Every number above is reproducible with the scripts in this repo.
