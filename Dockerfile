# Prism: Track 2 video captioning agent (Gemma-4, managed via HF Inference Providers).
# Grading VM is linux/amd64. Build:
#   docker buildx build --platform linux/amd64 \
#     --build-arg HF_TOKEN=hf_xxx -t ghcr.io/<you>/prism:latest --push .
FROM --platform=linux/amd64 python:3.11-slim

WORKDIR /app

# compact static ffmpeg/ffprobe (single binaries) instead of the big apt install
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates xz-utils curl \
    && rm -rf /var/lib/apt/lists/* \
    && cd /tmp \
    && curl -fsSL -o ff.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar -xf ff.tar.xz \
    && mv ffmpeg-*-static/ffmpeg ffmpeg-*-static/ffprobe /usr/local/bin/ \
    && rm -rf /tmp/ff*

# runtime deps only (demo packages stay out of the graded image)
COPY requirements-runtime.txt .
RUN pip install --no-cache-dir -r requirements-runtime.txt

# the app is a handful of flat modules (main.py is the entrypoint)
COPY *.py ./

# Track 2 injects NO credentials, so config is baked in at build. Public image:
# use the disposable hackathon token and rotate it after the event.
#   HF_TOKEN        : HuggingFace token (PRIMARY: managed Gemma-4, always up)
#   HF_GEMMA_MODEL  : e.g. google/gemma-4-31B-it
#   FIREWORKS_API_KEY + PRISM_FW_MODEL : optional fallback 1 (Gemma-4 deployment)
#   AMD_GEMMA_BASE_URL + AMD_GEMMA_MODEL : optional fallback 2 (AMD-hosted Gemma-3)
ARG HF_TOKEN=""
ARG HF_GEMMA_MODEL="google/gemma-4-31B-it"
ARG FIREWORKS_API_KEY=""
ARG PRISM_FW_MODEL=""
ARG AMD_GEMMA_BASE_URL=""
ARG AMD_GEMMA_MODEL="google/gemma-3-12b-it"
# flow/STT default OFF: 25-frame extraction + the STT side-thread saturate the
# grader's 2 vCPUs (v14 scored 0.32 that way: extraction alone took 15-25s,
# the deadlines fired, and clips fell back to generic captions). The 8-frame
# quick path is the judge-proven 0.87 recipe; the deadline system stays as a
# safety net only.
ARG PRISM_FLOW=0
ARG PRISM_STT=0
ENV HF_TOKEN=${HF_TOKEN} \
    HF_GEMMA_MODEL=${HF_GEMMA_MODEL} \
    FIREWORKS_API_KEY=${FIREWORKS_API_KEY} \
    PRISM_FW_MODEL=${PRISM_FW_MODEL} \
    AMD_GEMMA_BASE_URL=${AMD_GEMMA_BASE_URL} \
    AMD_GEMMA_MODEL=${AMD_GEMMA_MODEL} \
    PRISM_AUDIO=0 \
    PRISM_VERIFY=1 \
    PRISM_FLOW=${PRISM_FLOW} \
    PRISM_STT=${PRISM_STT} \
    PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "main.py"]
