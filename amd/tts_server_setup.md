# Gemma voice on AMD silicon: T5Gemma-TTS on the W7900 notebook

Prism's "listen" button speaks with T5Gemma-TTS (a community TTS built on
Google's T5Gemma weights). The only public host is a quota-capped ZeroGPU Space,
so we run the same app on our AMD Radeon W7900 (ROCm) instead: no quota, and the
voice is synthesized on AMD hardware.

The Space's code runs unmodified; the demo backend just points its client at the
tunnel URL.

## On the notebook (W7900, ROCm torch preinstalled)

```bash
git clone https://huggingface.co/spaces/Aratako/T5Gemma-TTS-Demo t5gemma-tts
cd t5gemma-tts

# keep the notebook's ROCm torch; strip CUDA-pinned packages from requirements
grep -viE "^(torch|flash|nvidia)" requirements.txt > req.txt
pip install -r req.txt
pip install "gradio>=4" spaces

export HF_TOKEN=hf_xxx        # model download (first run pulls ~10GB)
python app.py                 # serves the gradio app on :7860

# second terminal: expose it
ngrok http 7860
```

Sanity check in a browser: the ngrok URL should show the same UI as the public
Space. First synthesis warms the model (~1 min); after that a sentence takes a
few seconds on the W7900.

## On the Prism side

Add to `prism/.env` and restart the demo backend:

```
TTS_SPACE=https://<your-tunnel>.ngrok.app
```

Failover order at runtime: AMD notebook → public ZeroGPU Space (quota-capped) →
the browser's own voice. The demo never loses the button; it only loses the
Gemma voice when both hosts are down.

## One speaker per sentence, synthesized in parallel

The listen button splits the description into sentences and sends each as its own
`/api/tts` call with a distinct `seed`. T5Gemma-TTS has no reference audio here, so
it samples a fresh voice from its prior seeded by `seed` — a different seed is a
different speaker. That is deliberate: it showcases the voice range of the model
in one playback (each line is a new person). Seeds are fixed per sentence position
(`web/app/page.js` → `VOICE_SEEDS`), so the demo sounds the same each run.

Because the AMD host has no quota, the client fires every sentence at once (up to
`MAX_TTS_PARALLEL`, default 8) instead of two at a time. Synthesis then overlaps
playback and the next line is usually ready before its turn.

**To actually synthesize those sentences concurrently on the box** (not just queue
them), the app needs two changes — the stock Space runs `demo.launch()` with a
single global model and gradio's default queue admits one job at a time:

1. **Admit concurrent jobs.** Change the launch to
   `demo.queue(default_concurrency_limit=8).launch()`. This lets 8 requests enter
   the handler together instead of serializing in the queue.
2. **Give them separate GPUs.** One model instance on one card still contends, so
   for real 8-way throughput load one replica per W7900 and round-robin. Each
   T5Gemma-TTS instance is a few GB and each card has 48 GB, so eight replicas fit
   comfortably; pin them with `HIP_VISIBLE_DEVICES=0…7` (ROCm reads visible devices
   through the CUDA API, so `torch.cuda.set_device` works unmodified — see
   AMD_FINDINGS §5). A thin round-robin router in front (or gradio's own worker
   pool over the eight) turns the eight cards into eight parallel voices.

Step 1 is a one-line change and enough for the demo; step 2 is what makes "as many
sentences as speakers, all at once" literally true on the hardware.
