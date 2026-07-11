# Prism — Track 2 video captioning agent (Gemma-4, managed via HF Inference Providers).
# Grading VM is linux/amd64. Build:
#   docker buildx build --platform linux/amd64 \
#     --build-arg HF_TOKEN=hf_xxx -t ghcr.io/<you>/prism:latest --push .
FROM --platform=linux/amd64 python:3.11-slim

WORKDIR /app

# ffmpeg for frame extraction.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# the app is a handful of flat modules (main.py is the entrypoint)
COPY *.py ./

# Track 2 injects NO credentials, so config is baked in at build. Public image —
# use the disposable hackathon token and rotate it after the event.
#   HF_TOKEN        : HuggingFace token (PRIMARY — managed Gemma-4, always up)
#   HF_GEMMA_MODEL  : e.g. google/gemma-4-31B-it
#   FIREWORKS_API_KEY + PRISM_FW_MODEL : optional fallback 1 (Gemma-4 deployment)
#   AMD_GEMMA_BASE_URL + AMD_GEMMA_MODEL : optional fallback 2 (AMD-hosted Gemma-3)
ARG HF_TOKEN=""
ARG HF_GEMMA_MODEL="google/gemma-4-31B-it"
ARG FIREWORKS_API_KEY=""
ARG PRISM_FW_MODEL=""
ARG AMD_GEMMA_BASE_URL=""
ARG AMD_GEMMA_MODEL="google/gemma-3-12b-it"
ENV HF_TOKEN=${HF_TOKEN} \
    HF_GEMMA_MODEL=${HF_GEMMA_MODEL} \
    FIREWORKS_API_KEY=${FIREWORKS_API_KEY} \
    PRISM_FW_MODEL=${PRISM_FW_MODEL} \
    AMD_GEMMA_BASE_URL=${AMD_GEMMA_BASE_URL} \
    AMD_GEMMA_MODEL=${AMD_GEMMA_MODEL} \
    PRISM_AUDIO=0 \
    PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "main.py"]
