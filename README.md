# Prism — One clip, four voices

Prism is a video-captioning agent built for the **AMD Developer Hackathon ACT II — Track 2**.
Give it a short video clip and it writes **four captions of the same clip in four different
styles** — formal, sarcastic, tech-humor, and everyday-humor — all powered by Google's
**Gemma-4** vision model.

> *"A whole, pre-sliced pizza with a golden-brown crust… a hand sprinkles parmesan across the surface."* — **formal**
> *"Applying a hotfix of parmesan to the production environment, hopefully without crashing the crust."* — **tech-humor**

---

## How it works

Prism follows a *ground once, restyle four ways* pipeline:

1. **Sample** — pull frames evenly across the clip (9 / 16 / 25, scaled to the clip's length).
2. **Montage** — tile those frames into a single grid image, so the vision model reads the
   whole clip in one small request.
3. **Ground** — Gemma-4 studies the montage and writes **one** detailed, factual description
   of what happens.
4. **Restyle** — that single description is rewritten into all four styles in one structured call.

Grounding once keeps every caption faithful to the same facts while each one nails its own
voice. Gemma-4 does **both** the vision and the styling — the pipeline is Gemma end to end,
which is the heart of the "best use of Gemma" story.

For reliability there's a three-tier failover — HuggingFace Inference Providers → Fireworks →
an AMD-hosted endpoint — with retries on transient errors, so the live output path never dies.

---

## Quick start

### Run the published image (exactly what the grader runs)
The container reads `/input/tasks.json` and writes `/output/results.json`:
```bash
# tasks.json: [{ "task_id": "v1", "video_url": "https://…mp4",
#                "styles": ["formal","sarcastic","humorous_tech","humorous_non_tech"] }]
docker run --rm -v "$PWD/input:/input" -v "$PWD/output:/output" devdebojyotic/prism:latest
```

### Run locally
```bash
pip install -r requirements.txt
# create a .env with your HuggingFace token:
#   HF_TOKEN=hf_xxx
#   HF_GEMMA_MODEL=google/gemma-4-31B-it
PRISM_INPUT=test/sample_tasks.json PRISM_OUTPUT=output/results.json python main.py
```

### Demo frontend (the interactive walkthrough)
```bash
uvicorn serve:app --port 8001          # backend API
cd web && npm install && npm run dev   # frontend at http://localhost:3000
```

---

## Project structure

| File | Purpose |
|---|---|
| `main.py` | Entry point — reads `/input/tasks.json`, writes `/output/results.json` |
| `video.py` | Download, frame sampling, montage building |
| `caption.py` | Ground-once-restyle-four + the demo title helper |
| `styles.py` | The four caption styles (definitions + examples) |
| `gemma_client.py` | Gemma-4 client with the 3-tier failover |
| `transcribe.py` | Optional local audio transcription (off by default) |
| `serve.py` | FastAPI demo backend |
| `web/` | Next.js demo frontend |
| `Dockerfile` | Builds the submission image (`python main.py`) |

See [`documentation.md`](documentation.md) for a function-level reference.

---

## Notes
- Track 2 injects no credentials, so the model token is baked into the public image at build
  time. If you fork this, use a disposable token and rotate it afterwards.
- Built for `linux/amd64`; CPU-only; well within the 30 s/clip and 10 min budgets.

## License
[MIT](LICENSE)
