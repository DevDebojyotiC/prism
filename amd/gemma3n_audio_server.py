# Gemma 3n audio server, for the AMD notebook (Radeon W7900, ROCm).
# Hosts google/gemma-3n-E4B-it (audio-capable) behind a tiny FastAPI app so the
# Prism demo can ask "what do you HEAR in this clip?". The hosted APIs don't
# serve Gemma's audio checkpoints (verified during the hackathon), so this is
# the genuine Gemma-audio path: self-hosted, on AMD silicon.
#
# Run on the notebook:
#   pip install -U "transformers>=4.53" timm accelerate soundfile librosa fastapi uvicorn python-multipart
#   export HF_TOKEN=hf_xxx          # account must have accepted the Gemma license
#   python gemma3n_audio_server.py  # serves on :8600
#   ngrok http 8600                 # expose; give Prism the URL as AMD_AUDIO_BASE_URL
import base64
import io
import os
import tempfile
import time

import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

MODEL_ID = os.environ.get("GEMMA_AUDIO_MODEL", "google/gemma-3n-E4B-it")

print(f"[load] {MODEL_ID} ...", flush=True)
t0 = time.time()
from transformers import AutoProcessor, AutoModelForImageTextToText

processor = AutoProcessor.from_pretrained(MODEL_ID, token=os.environ.get("HF_TOKEN"))
model = AutoModelForImageTextToText.from_pretrained(
    MODEL_ID, torch_dtype=torch.bfloat16, device_map="auto",
    token=os.environ.get("HF_TOKEN"),
)
print(f"[load] ready in {time.time()-t0:.0f}s on {model.device}", flush=True)

app = FastAPI(title="Prism Gemma-3n audio")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DEFAULT_PROMPT = (
    "This is the soundtrack of a short video clip. In one or two sentences, "
    "describe what you HEAR: speech (summarize it), music, ambient noise, "
    "crowd sounds, mechanical sounds. Only report what is actually audible."
)


class Req(BaseModel):
    audio_b64: str            # wav, mono, 16kHz preferred
    prompt: str = ""


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "device": str(model.device)}


@app.post("/describe")
def describe(req: Req):
    t0 = time.time()
    raw = base64.b64decode(req.audio_b64)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(raw)
        path = f.name
    try:
        messages = [{
            "role": "user",
            "content": [
                {"type": "audio", "audio": path},
                {"type": "text", "text": req.prompt or DEFAULT_PROMPT},
            ],
        }]
        inputs = processor.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=True,
            return_dict=True, return_tensors="pt",
        ).to(model.device)
        with torch.inference_mode():
            out = model.generate(**inputs, max_new_tokens=120, do_sample=False)
        text = processor.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        return {"text": text.strip(), "seconds": round(time.time() - t0, 2),
                "model": MODEL_ID, "hardware": "AMD Radeon W7900 / ROCm"}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:300]}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8600")))
