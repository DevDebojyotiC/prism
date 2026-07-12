## Title: Prism - Video Captioning Agent

### Language
**Python** (agent + backend) · **JavaScript / Next.js** (demo frontend)

---

### Installation and Running Steps

1. **Clone the repository**:
    ```bash
    git clone <repository_url>
    cd prism
    ```

2. **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3. **Set up environment variables**:
    - Create a `.env` file in the root directory.
    - Add your HuggingFace token (used to reach Gemma-4 through HuggingFace Inference Providers):
      ```
      HF_TOKEN=your_hf_token_here
      HF_GEMMA_MODEL=google/gemma-4-31B-it
      ```

4. **Run the agent against a task file** (the grading harness contract):
    ```bash
    PRISM_INPUT=test/sample_tasks.json PRISM_OUTPUT=output/results.json python main.py
    ```

5. **Run the demo API + frontend** (optional, for the walkthrough video):
    ```bash
    uvicorn serve:app --port 8001          # backend
    cd web && npm install && npm run dev   # frontend on http://localhost:3000
    ```

---

### Description

Prism is a video-captioning agent built for **AMD Developer Hackathon ACT II, Track 2**.
Given a short video clip, it writes **four captions of the same clip in four different
styles** (formal, sarcastic, humorous-tech, humorous-everyday). Every graded word is
authored by Google's **Gemma-4-31B** served through HuggingFace Inference Providers.

The pipeline is *ground once, restyle four ways*: it samples up to 16 individual frames
across the clip (a ladder keyed on how long the download took), runs a **parallel grounding
race** (Kimi-k2p6 primary, Qwen3-VL-235B hedge, Gemma-4 last resort) to produce one detailed
factual description, optionally enriched by a Gemma 3n speech transcript, and then Gemma-4
rewrites that one description into each requested style in a single structured call.
Grounding once keeps all four captions faithful to the same facts while each one nails its
own voice. A per-clip time budget wall-caps the download, threads an absolute deadline
through every model call, and degrades to fewer, smaller frames before ever surrendering a
clip; a hard cutoff guarantees the 30s/clip limit on any input.

---

### Functions

1. **`video.download_video(url, dest, max_seconds)`**
    - **Arguments**: `url` (video link), `dest` (where to save it), `max_seconds` (wall-clock cap).
    - **Description**: Streams the clip to a local file; stops at the cap and keeps the decodable prefix so a slow download can never eat the whole clip budget.

2. **`video.extract_frames(path, out_dir, n_frames)`**
    - **Arguments**: `path` (video file), `out_dir` (frames folder), `n_frames` (how many).
    - **Description**: Samples `n_frames` evenly across the clip at 768px via parallel single-decode-thread ffmpeg seeks (tuned for 2-vCPU graders); short high-bitrate encodes take a single-pass decode instead.

3. **`video.make_montage(frame_paths, dest)`**
    - **Arguments**: `frame_paths` (the sampled frames), `dest` (output image).
    - **Description**: Tiles frames into one grid image (the demo's visual strip and the optional flow-grounding mode).

4. **`caption.ground(frame_paths, transcript, deadline)`**
    - **Arguments**: `frame_paths` (the sampled frames), `transcript` (optional speech text), `deadline` (absolute per-clip cutoff).
    - **Description**: The parallel grounding race: Kimi-k2p6 (all frames), Qwen3-VL-235B and Gemma-4 (5 frames spread across the clip) fire at once and the best-ranked success wins. Frame count and JPEG size shrink automatically as the deadline approaches.

5. **`caption.stylize(description, styles, deadline)`**
    - **Arguments**: `description` (the grounded text), `styles` (which styles to write), `deadline`.
    - **Description**: Gemma-4 rewrites the description into each style in one structured JSON call.

6. **`caption.make_title(...)` / `caption.fact_anchor(...)` / `caption.translate_captions(...)`**
    - **Description**: Demo-only helpers: a display title, EmbeddingGemma fact-anchor scores, and Gemma transcreation into 16 languages. None touch the graded output.

7. **`gemma_client.chat(messages, deadline)`**
    - **Arguments**: OpenAI-style messages, optional absolute deadline.
    - **Description**: Gemma-4 with failover across four serverless hosts; the deadline bounds the WHOLE chain, and an attempt with a fallback behind it leaves that fallback a real window.

8. **`gemma_client.kimi_describe(...)` / `gemma_client.hedge_vlm_describe(...)` / `gemma_client.vision_describe(...)`**
    - **Description**: The three grounding lanes (Kimi via Fireworks, Qwen3-VL via the HF router, Gemma-4 via the HF router), all deadline-aware.

9. **`gemma_client.hear(...)` / `audio_intel.clip_transcript(vid, workdir)`**
    - **Description**: Gemma 3n E4B speech transcription in 28s chunks on a side thread (Gemini only when a Gemma call errors); the result feeds the grounding when it arrives inside the budget, and music-only clips return empty.

10. **`main.process_one(task, workdir)` / `main.main()`**
    - **Arguments**: a single task dict / none.
    - **Description**: `process_one` captions one clip under the time budget (frame ladder keyed on download speed, STT gate, deadline arithmetic, hard cutoff under 30s); `main` reads the input tasks, captions each clip on a watchdog thread, and writes the results file. If a clip fails it still emits four distinct in-style captions.

---

### Additional Fields

#### Dependencies
- **Python Libraries**:
  - `requests`: HTTP calls to the video URLs and the model endpoints.
  - `Pillow`: builds the montage image from the sampled frames.
  - `python-dotenv`: loads the `.env` config for local runs.
  - `fastapi` + `uvicorn`: the demo API in `serve.py`.
- **System**: `ffmpeg` (frame extraction), installed inside the Docker image.

---

### Project Structure
- **`main.py`**: The entry point: reads `/input/tasks.json`, writes `/output/results.json`.
- **`video.py`**: Download, frame sampling, and montage building.
- **`caption.py`**: Ground-once-restyle-four, plus the demo title helper.
- **`styles.py`**: The four caption styles (definitions + examples).
- **`gemma_client.py`**: Gemma-4 client (multi-host failover) plus the three grounding lanes and Gemma 3n audio.
- **`audio_intel.py`**: Speech transcript for the graded pipeline (side thread, budget-gated).
- **`transcribe.py`**: Optional local audio transcription (off by default).
- **`serve.py`**: FastAPI demo backend for the frontend.
- **`web/`**: Next.js demo frontend.
- **`test/`**: Local test / calibration scripts.
- **`Dockerfile`**: Builds the submission image (`python main.py`).
- **`.env`**: Environment variables like the HuggingFace token.
- **`requirements.txt`**: Python dependencies.

---
