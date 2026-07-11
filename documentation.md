## Title: Prism — Video Captioning Agent

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

Prism is a video-captioning agent built for **AMD Developer Hackathon ACT II — Track 2**.
Given a short video clip, it writes **four captions of the same clip in four different
styles** (formal, sarcastic, humorous-tech, humorous-everyday), all powered by Google's
**Gemma-4** vision model served through HuggingFace Inference Providers.

The pipeline is *ground once, restyle four ways*: it samples frames from the clip, tiles
them into a single montage image, lets Gemma-4 write one detailed factual description of
what happens, and then rewrites that one description into each requested style in a single
structured call. Grounding once keeps all four captions faithful to the same facts while
each one nails its own voice.

---

### Functions

1. **`video.download_video(url, dest)`**
    - **Arguments**: `url` (video link), `dest` (where to save it).
    - **Description**: Downloads the clip to a local file.

2. **`video.extract_frames(path, out_dir, n_frames)`**
    - **Arguments**: `path` (video file), `out_dir` (frames folder), `n_frames` (how many).
    - **Description**: Samples `n_frames` evenly across the clip, downscaled.

3. **`video.frames_for_duration(dur)`**
    - **Arguments**: `dur` (clip length in seconds).
    - **Description**: Picks the frame budget by length — 9 (3x3) up to 30s, 16 (4x4) up to 90s, 25 (5x5) beyond.

4. **`video.make_montage(frame_paths, dest)`**
    - **Arguments**: `frame_paths` (the sampled frames), `dest` (output image).
    - **Description**: Tiles the frames into ONE grid image so the vision endpoint gets a single small payload.

5. **`caption.ground(frame_paths)`**
    - **Arguments**: `frame_paths` (the sampled frames).
    - **Description**: Builds the montage and asks Gemma-4 for one detailed, factual description of the video.

6. **`caption.stylize(description, styles)`**
    - **Arguments**: `description` (the grounded text), `styles` (which styles to write).
    - **Description**: Rewrites the description into each style in one structured JSON call.

7. **`caption.make_title(description)`**
    - **Arguments**: `description` (the grounded text).
    - **Description**: Generates a short human-readable video name (demo UI only, not graded).

8. **`gemma_client.chat(messages)` / `gemma_client.vision_describe(frame_paths, prompt)`**
    - **Arguments**: OpenAI-style messages / image paths + a prompt.
    - **Description**: Talks to Gemma-4 with a 3-tier failover (HuggingFace -> Fireworks -> AMD-hosted) and retries transient errors.

9. **`main.process_one(task, workdir)` / `main.main()`**
    - **Arguments**: a single task dict / none.
    - **Description**: `process_one` captions one clip; `main` reads the input tasks, captions each clip, and writes the results file. If a clip fails it still emits all four styles.

---

### Additional Fields

#### Dependencies
- **Python Libraries**:
  - `requests`: HTTP calls to the video URLs and the model endpoints.
  - `Pillow`: builds the montage image from the sampled frames.
  - `python-dotenv`: loads the `.env` config for local runs.
  - `fastapi` + `uvicorn`: the demo API in `serve.py`.
- **System**: `ffmpeg` (frame extraction) — installed inside the Docker image.

---

### Project Structure
- **`main.py`**: The entry point — reads `/input/tasks.json`, writes `/output/results.json`.
- **`video.py`**: Download, frame sampling, and montage building.
- **`caption.py`**: Ground-once-restyle-four, plus the demo title helper.
- **`styles.py`**: The four caption styles (definitions + examples).
- **`gemma_client.py`**: Gemma-4 client with the 3-tier failover.
- **`transcribe.py`**: Optional local audio transcription (off by default).
- **`serve.py`**: FastAPI demo backend for the frontend.
- **`web/`**: Next.js demo frontend.
- **`test/`**: Local test / calibration scripts.
- **`Dockerfile`**: Builds the submission image (`python main.py`).
- **`.env`**: Environment variables like the HuggingFace token.
- **`requirements.txt`**: Python dependencies.

---
