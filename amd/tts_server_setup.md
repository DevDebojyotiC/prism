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
