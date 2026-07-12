"use client";
import { useEffect, useRef, useState } from "react";

const STYLES = [
  { key: "formal",            name: "Formal",              cvar: "--formal",    lam: "λ470", sub: "documentary voiceover", d: ".05s" },
  { key: "sarcastic",         name: "Sarcastic",           cvar: "--sarcastic", lam: "λ405", sub: "dry & deadpan",         d: ".16s" },
  { key: "humorous_tech",     name: "Humorous · Tech",     cvar: "--tech",      lam: "λ505", sub: "programmer humor",      d: ".27s" },
  { key: "humorous_non_tech", name: "Humorous · Everyday", cvar: "--nontech",   lam: "λ590", sub: "universal humor",       d: ".38s" },
];

const BACKENDS = {
  hf: "Gemma-4 · HF Inference",
  fireworks: "Gemma-4 · Fireworks",
  amd: "Gemma-3 · AMD W7900",
};

const CHIP_C = ["--formal", "--tech", "--sarcastic", "--nontech"];
const LOAD_MSGS = ["Sampling frames…", "Vision race is grounding the clip…", "Refracting into four voices…"];

function basename(u) {
  try { return decodeURIComponent(u.split("/").pop().split("?")[0]) || u; }
  catch { return u; }
}

export default function Page() {
  const [tab, setTab] = useState("upload");        // upload | link | sample
  const [phase, setPhase] = useState("input");     // input | loading | results
  const [samples, setSamples] = useState([]);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [hot, setHot] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [videoSrc, setVideoSrc] = useState(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [loadStage, setLoadStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(null);
  const [languages, setLanguages] = useState(["English"]);
  const [lang, setLang] = useState("English");
  const [translated, setTranslated] = useState(null);   // captions in `lang`, or null for English
  const [translating, setTranslating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [mTab, setMTab] = useState("desc");   // description | sound | transcript
  const fileRef = useRef(null);
  const sceneRef = useRef(null);
  const outRef = useRef(null);

  // Drive the CSS state machine via body attributes (matches the design system).
  useEffect(() => { document.body.dataset.state = phase; }, [phase]);
  useEffect(() => { document.body.dataset.tab = tab; }, [tab]);

  // Lock the optical axis (incoming beam → prism → output rays) to the vertical
  // center of the word "out" so the single beam cuts cleanly through it. The two
  // are in separate grid columns, so this can't be done with static CSS; measure
  // and re-measure on resize, font load, and layout changes.
  useEffect(() => {
    const align = () => {
      const scene = sceneRef.current, out = outRef.current;
      if (!scene) return;
      // Side-by-side layout only; stacked mobile layout keeps the beam centered.
      if (!out || window.matchMedia("(max-width:980px)").matches) {
        scene.style.setProperty("--axis", "50%"); return;
      }
      const sr = scene.getBoundingClientRect();
      if (sr.height === 0) return; // hero hidden (results view)
      // "Four voices out." can wrap; target the LAST visual line (where "out."
      // sits), not the span's overall center, otherwise the beam lands in the
      // gap between lines. A Range gives one rect per line box.
      const range = document.createRange();
      range.selectNodeContents(out);
      const rects = range.getClientRects();
      const line = rects.length ? rects[rects.length - 1] : out.getBoundingClientRect();
      scene.style.setProperty("--axis", `${(line.top + line.height / 2) - sr.top}px`);
    };
    align();
    const raf = requestAnimationFrame(align);
    const ro = new ResizeObserver(align);
    ro.observe(document.documentElement);
    window.addEventListener("resize", align);
    document.fonts?.ready?.then(align).catch(() => {});
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", align); };
  }, [phase]);

  useEffect(() => {
    fetch("/api/samples").then((r) => r.json())
      .then((d) => { setSamples(d.samples || []); setLanguages(d.languages || ["English"]); })
      .catch(() => {});
  }, []);

  // Cosmetic staged progress while the real request is in flight.
  useEffect(() => {
    if (phase !== "loading") return;
    setLoadStage(0);
    const t1 = setTimeout(() => setLoadStage(1), 1000);
    const t2 = setTimeout(() => setLoadStage(2), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

  // Indeterminate bar: eases asymptotically toward 92% and holds; it never
  // completes on its own or loops. Driven per-frame (no CSS transition, which
  // wedges when triggered by the display:none→block reveal). The results view
  // replaces it the moment content arrives; resets to 0 for each new run.
  useEffect(() => {
    if (phase !== "loading") { setProgress(0); return; }
    const start = performance.now();
    const id = setInterval(() => {
      const t = (performance.now() - start) / 1000;  // seconds elapsed
      setProgress(92 * (1 - Math.exp(-t / 5)));       // asymptote to 92%, never reaches it
    }, 60);
    return () => clearInterval(id);
  }, [phase]);

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("prism-theme", next); } catch {}
  }

  function copy(key, text) {
    navigator.clipboard?.writeText(text || "");
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1200);
  }

  function reset() {
    setResult(null); setError(""); setVideoSrc(null); setFile(null); setUrl("");
    setPhase("input");
  }

  const gemmaAudio = useRef(null);
  const voiceRun = useRef(null);   // current playback session (for cancel)

  function stopSpeaking() {
    if (voiceRun.current) voiceRun.current.aborted = true;
    window.speechSynthesis?.cancel();
    if (gemmaAudio.current) { gemmaAudio.current.pause(); gemmaAudio.current = null; }
    setSpeaking(false); setVoiceLoading(false); setBuffering(false);
  }

  function browserSpeak(text) {
    const synth = window.speechSynthesis;
    if (!synth) { setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  // pack sentences into ~260-char chunks the TTS Space can turn around quickly
  function ttsChunks(text) {
    const sentences = text.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) || [text];
    const chunks = [];
    let cur = "";
    for (const s of sentences) {
      if ((cur + s).length > 260 && cur) { chunks.push(cur.trim()); cur = s; }
      else cur += s;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }

  async function fetchTTS(text) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 120000);
      const r = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }), signal: ctl.signal,
      });
      clearTimeout(timer);
      const d = await r.json();
      return d.audio ? { audio: d.audio } : { error: d.error || "no audio" };
    } catch { return { error: "network" }; }
  }

  function playUri(uri) {
    return new Promise((res) => {
      const a = new Audio(uri);
      gemmaAudio.current = a;
      a.onended = () => { gemmaAudio.current = null; res(); };
      a.onerror = () => { gemmaAudio.current = null; res(); };
      a.play().catch(res);
    });
  }

  // Gemma voice, paired batches: chunks are synthesized two at a time, and the
  // next pair is fired the moment the current pair starts playing, so synthesis
  // hides behind playback while never committing more than ~2 calls of ZeroGPU
  // quota ahead (each call bills a flat GPU window, so an early "stop" wastes at
  // most one pair). If the next chunk isn't ready when its turn comes we WAIT
  // (button shows "next line"); the browser voice takes over the remaining text
  // only on a real error.
  async function speak(text) {
    if (speaking || voiceLoading) { stopSpeaking(); return; }
    const run = { aborted: false };
    voiceRun.current = run;
    const chunks = ttsChunks(text);
    const jobs = new Array(chunks.length).fill(null);
    const fire = (i) => { if (i < chunks.length && !jobs[i] && !run.aborted) jobs[i] = fetchTTS(chunks[i]); };
    fire(0); fire(1);                              // batch 1: sentences 1+2 in parallel
    setVoiceLoading(true);
    const first = await jobs[0];
    if (run.aborted) return;
    if (!first.audio) { setVoiceLoading(false); browserSpeak(text); return; }
    setVoiceLoading(false);
    setSpeaking(true);
    let res = first;
    for (let i = 0; !run.aborted; i++) {
      if (i % 2 === 0) { fire(i + 2); fire(i + 3); }  // next pair, while this pair plays
      await playUri(res.audio);
      if (run.aborted || i + 1 >= chunks.length) break;
      setBuffering(true);                          // waiting on the next line ≠ failure
      res = await jobs[i + 1];
      setBuffering(false);
      if (run.aborted) return;
      if (!res.audio) {                            // real error: browser finishes the rest
        browserSpeak(chunks.slice(i + 1).join(" "));
        return;
      }
    }
    setBuffering(false);
    if (!run.aborted) setSpeaking(false);
  }

  async function changeLang(l) {
    setLang(l);
    if (l === "English" || !result?.captions) { setTranslated(null); return; }
    setTranslating(true);
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captions: result.captions, language: l }),
      });
      const d = await r.json();
      setTranslated(d.captions || null);
    } catch { setTranslated(null); setLang("English"); }
    setTranslating(false);
  }

  async function run(promise, label) {
    stopSpeaking(); setMTab("desc");
    setError(""); setResult(null); setTranslated(null); setLang("English");
    setSourceLabel(label || ""); setPhase("loading");
    try {
      const res = await promise;
      const data = await res.json();
      if (data.error) { setError(data.error); setPhase("input"); }
      else { setResult(data); setPhase("results"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    } catch {
      setError("Couldn't reach the Prism API. Check the server is running, then refract again.");
      setPhase("input");
    }
  }

  const runLink = (u) => {
    setVideoSrc(u);
    run(fetch("/api/caption/link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_url: u }),
    }), basename(u));
  };

  const runUpload = (f) => {
    setVideoSrc(URL.createObjectURL(f));
    const fd = new FormData(); fd.append("file", f);
    run(fetch("/api/caption/upload", { method: "POST", body: fd }),
        `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`);
  };

  function onDrop(e) {
    e.preventDefault(); setHot(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); runUpload(f); }
  }

  return (
    <>
      <div className="aurora"><div className="a3" /></div>
      <div className="grain" />

      {/* ══════ HEADER ══════ */}
      <header className="wrap">
        <div className="top">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); reset(); }}>
            <svg className="mark" viewBox="0 0 38 38" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="38" y2="38">
                  <stop stopColor="#b06bf9" /><stop offset=".38" stopColor="#5b8bf7" />
                  <stop offset=".7" stopColor="#2dd4bf" /><stop offset="1" stopColor="#f5a524" />
                </linearGradient>
              </defs>
              <polygon points="19,4 34,30 4,30" stroke="url(#lg)" strokeWidth="2.6" fill="rgba(255,255,255,.03)" strokeLinejoin="round" />
              <line x1="4" y1="17" x2="15" y2="17" stroke="#f4f5fa" strokeWidth="1.8" strokeLinecap="round" opacity=".85" />
            </svg>
            <div>
              <h1>Prism</h1>
              <div className="sub">One clip, refracted into four voices</div>
            </div>
          </a>
          <div className="badges">
            <span className="badge"><span className="dot" /> Powered by&nbsp;<b>Gemma-4</b></span>
            <button className="theme" onClick={toggleTheme} aria-label="Switch color theme" title="Switch theme">
              <svg className="i-sun" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.95 3.05l-1.27 1.27M4.32 11.68l-1.27 1.27M12.95 12.95l-1.27-1.27M4.32 4.32 3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <svg className="i-moon" width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M13 9.2A5.8 5.8 0 0 1 5.8 2 5.9 5.9 0 1 0 13 9.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="wrap">
        {/* ══════ HERO ══════ */}
        <section className="hero">
          <div>
            <div className="eyebrow">Gemma-4 captioning · one clip, four voices</div>
            <h2>One clip in.<span className="out" ref={outRef}>Four voices out.</span></h2>
            <p>
              Prism samples high-res frames from your video, grounds them into one
              factual description, then <b>Gemma-4</b> refracts that one understanding
              into four caption styles. You see <b>exactly what the model saw</b>.
            </p>
            <div className="swatches" aria-hidden="true">
              {STYLES.map((s) => (
                <span key={s.key} className="sw" style={{ "--c": `var(${s.cvar})` }}>
                  <i />{s.name.replace("Humorous · ", "")} <em>{s.lam}</em>
                </span>
              ))}
            </div>
          </div>

          <div className="scene" aria-hidden="true" ref={sceneRef}>
            <div className="optic">
              <div className="ray-in" />
              <div className="glass">
                <svg viewBox="0 0 150 170" fill="none">
                  <defs>
                    <linearGradient id="pFront" x1="20" y1="20" x2="110" y2="165" gradientUnits="userSpaceOnUse">
                      <stop className="gA" /><stop className="gB" offset=".45" /><stop className="gC" offset="1" />
                    </linearGradient>
                    <linearGradient id="pSide" x1="83" y1="12" x2="150" y2="155" gradientUnits="userSpaceOnUse">
                      <stop className="gD" /><stop className="gE" offset=".55" /><stop className="gV" offset="1" />
                    </linearGradient>
                    <linearGradient id="pEdgeF" x1="70" y1="18" x2="70" y2="156" gradientUnits="userSpaceOnUse">
                      <stop className="gF" /><stop className="gG" offset="1" />
                    </linearGradient>
                    <linearGradient id="pEdgeS" x1="96" y1="6" x2="158" y2="144" gradientUnits="userSpaceOnUse">
                      <stop className="gH" /><stop className="gI" offset="1" />
                    </linearGradient>
                    <linearGradient id="pInner" x1="40" y1="85" x2="106" y2="85" gradientUnits="userSpaceOnUse">
                      <stop className="gJ" /><stop className="gK" offset=".55" /><stop className="gL" offset="1" />
                    </linearGradient>
                    <radialGradient id="pEntry" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
                                    gradientTransform="translate(40 85) scale(16)">
                      <stop className="gM" /><stop className="gN" offset="1" />
                    </radialGradient>
                    <filter id="pBlur1" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.4" /></filter>
                    <filter id="pBlur3" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" /></filter>
                  </defs>
                  <path className="kBack" d="M96 6 L34 144" strokeWidth="1" />
                  <polygon points="70,18 132,156 158,144 96,6" fill="url(#pSide)" stroke="url(#pEdgeS)" strokeWidth="1.1" strokeLinejoin="round" />
                  <polygon className="kSliver" points="132,156 158,144 150,141 126,152" />
                  <polygon points="70,18 8,156 132,156" fill="url(#pFront)" stroke="url(#pEdgeF)" strokeWidth="1.4" strokeLinejoin="round" />
                  <line className="kTop" x1="70" y1="18" x2="96" y2="6" strokeWidth="1.4" strokeLinecap="round" />
                  <circle className="kApex" cx="70" cy="18" r="2.2" filter="url(#pBlur1)" />
                  <polygon className="kSpec" points="60,42 67,38 33,132 26,129" filter="url(#pBlur3)" />
                  <g filter="url(#pBlur1)">
                    <line x1="40" y1="85" x2="105" y2="76" style={{ stroke: "var(--formal)" }} strokeOpacity=".45" strokeWidth="1.6" />
                    <line x1="40" y1="85" x2="106" y2="81" style={{ stroke: "var(--sarcastic)" }} strokeOpacity=".45" strokeWidth="1.6" />
                    <line x1="40" y1="85" x2="106" y2="87" style={{ stroke: "var(--tech)" }} strokeOpacity=".45" strokeWidth="1.6" />
                    <line x1="40" y1="85" x2="105" y2="92" style={{ stroke: "var(--nontech)" }} strokeOpacity=".45" strokeWidth="1.6" />
                  </g>
                  <line x1="40" y1="85" x2="104" y2="84" stroke="url(#pInner)" strokeWidth="2" />
                  <circle cx="40" cy="85" r="16" fill="url(#pEntry)" />
                  <g filter="url(#pBlur3)">
                    <circle cx="106" cy="77" r="5" style={{ fill: "var(--formal)" }} fillOpacity=".35" />
                    <circle cx="107" cy="82" r="5" style={{ fill: "var(--sarcastic)" }} fillOpacity=".35" />
                    <circle cx="107" cy="87" r="5" style={{ fill: "var(--tech)" }} fillOpacity=".35" />
                    <circle cx="106" cy="92" r="5" style={{ fill: "var(--nontech)" }} fillOpacity=".35" />
                  </g>
                </svg>
              </div>
              <div className="beams">
                <div className="beam" style={{ "--c": "var(--formal)", "--r": "-16deg", "--d": "1.05s" }}><span className="tag"><i />Formal <em>λ470</em></span></div>
                <div className="beam" style={{ "--c": "var(--sarcastic)", "--r": "-5.5deg", "--d": "1.17s" }}><span className="tag"><i />Sarcastic <em>λ405</em></span></div>
                <div className="beam" style={{ "--c": "var(--tech)", "--r": "5.5deg", "--d": "1.29s" }}><span className="tag"><i />Tech <em>λ505</em></span></div>
                <div className="beam" style={{ "--c": "var(--nontech)", "--r": "16deg", "--d": "1.41s" }}><span className="tag"><i />Everyday <em>λ590</em></span></div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════ INPUT CARD ══════ */}
        <section className="io">
          <div className="io-inner">
            <div className="tabs" role="tablist" aria-label="Input mode">
              <button role="tab" aria-selected={tab === "upload"} onClick={() => setTab("upload")}>Upload</button>
              <button role="tab" aria-selected={tab === "link"} onClick={() => setTab("link")}>Paste link</button>
              <button role="tab" aria-selected={tab === "sample"} onClick={() => setTab("sample")}>Samples</button>
            </div>

            <div className="panel p-upload" role="tabpanel">
              <div className={"drop" + (hot ? " hot" : "")} tabIndex={0}
                   onClick={() => fileRef.current?.click()}
                   onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
                   onDragOver={(e) => { e.preventDefault(); setHot(true); }}
                   onDragLeave={() => setHot(false)}
                   onDrop={onDrop}>
                <svg className="glyph" viewBox="0 0 44 44" fill="none" aria-hidden="true">
                  <rect className="glyph-frame" x="6" y="10" width="32" height="24" rx="4" strokeWidth="1.6" />
                  <path d="M22 28V17m0 0-5 5m5-5 5 5" stroke="url(#lg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="big">Drop a clip here, or click to choose</div>
                <div className="small"><b>MP4 · MOV · WebM</b>, same pipeline the grader runs</div>
                <input ref={fileRef} type="file" accept="video/*" hidden
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); runUpload(f); } }} />
              </div>
              {file && <div className="fileline">▶ {file.name}</div>}
            </div>

            <div className="panel p-link" role="tabpanel">
              <div className="linkrow">
                <input type="url" placeholder="https://…/clip.mp4" aria-label="Video URL"
                       value={url} onChange={(e) => setUrl(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && url && runLink(url)} />
                <button className="btn" disabled={!url} onClick={() => url && runLink(url)}>Refract</button>
              </div>
            </div>

            <div className="panel p-sample" role="tabpanel">
              <div className="samples">
                {samples.map((s, i) => (
                  <button key={s.id} className="chip" style={{ "--c": `var(${CHIP_C[i % CHIP_C.length]})` }}
                          onClick={() => runLink(s.url)}>
                    <span className="thumb" />
                    <span><span className="lab">{s.label}</span><span className="csub">sample · click to refract</span></span>
                  </button>
                ))}
              </div>
            </div>

            <div className={"err" + (error ? " show" : "")} role="alert">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 15 14H1L8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 6v3.4M8 11.6v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              <span><b>Couldn't refract this clip.</b> {error}</span>
            </div>

            <div className="loadingbox" aria-live="polite">
              <div className="lb-head">
                <h3>{LOAD_MSGS[loadStage]}</h3>
                {sourceLabel && <span className="lb-file">{sourceLabel}</span>}
              </div>
              <div className="track"><div className="fill" style={{ transform: `scaleX(${progress / 100})` }} /></div>
              <div className="stages">
                <div className={"stage" + (loadStage >= 0 ? " on" : "")}><div className="st-k"><i />01 · Frames</div><div className="st-v">Sample frames across the clip</div></div>
                <div className={"stage" + (loadStage >= 1 ? " on" : "")}><div className="st-k"><i />02 · Vision</div><div className="st-v">Grounding race reads the frames</div></div>
                <div className={"stage" + (loadStage >= 2 ? " on" : "")}><div className="st-k"><i />03 · Refraction</div><div className="st-v">Split into four voices</div></div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════ RESULTS ══════ */}
        {result && (
          <section className="results">
            <div className="res-head">
              <div>
                <div className="eyebrow">Refraction complete{result.timing?.total ? ` · ${result.timing.total}s` : ""}</div>
                <h2>One clip, <span>four voices</span>.</h2>
              </div>
              <button className="again" onClick={reset}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7A5 5 0 1 1 7 2c1.7 0 3.2.85 4.1 2.14M11.5 1.5v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Refract another
              </button>
            </div>

            <div className="res-grid">
              <aside className="evidence">
                <div className="ev-sec">
                  <div className="ev-k">Source clip</div>
                  {videoSrc
                    ? <video className="video-el" src={videoSrc} controls autoPlay muted loop playsInline />
                    : <div className="video-ph"><span className="fn">{sourceLabel}</span></div>}
                </div>
                <div className="ev-sec">
                  <div className="ev-k">What the model sees</div>
                  <div className="montage">
                    {result.montage && <img className="montage-img" src={result.montage} alt="frame montage" />}
                    <div className="scan" />
                  </div>
                  <p className="m-cap"><b>{result.frame_count} frames, sampled across the clip</b> (shown tiled here), sent to the vision model at full resolution, in time order.</p>
                </div>
              </aside>

              <div>
                <div className="ground">
                  <div className="gtitle">{result.title || "Untitled clip"}</div>
                  {sourceLabel && (
                    <div className="gsource" title={sourceLabel}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M6.4 6.3l3.6 1.9-3.6 1.9z" fill="currentColor" />
                      </svg>
                      <span>{sourceLabel}</span>
                    </div>
                  )}
                  <div className="gk-row">
                    <div className="tabs mini" role="tablist" aria-label="What the model understood">
                      <button role="tab" aria-selected={mTab === "desc"} onClick={() => setMTab("desc")}>Description</button>
                      {result.heard && (
                        <button role="tab" aria-selected={mTab === "sound"} onClick={() => setMTab("sound")}>Soundtrack</button>
                      )}
                      {result.transcript && (
                        <button role="tab" aria-selected={mTab === "transcript"} onClick={() => setMTab("transcript")}>Transcript</button>
                      )}
                    </div>
                    {mTab === "desc" && (
                      <button className={"listen" + (speaking ? " on" : "") + (voiceLoading || buffering ? " load" : "")}
                              onClick={() => speak(result.description)}
                              title="Hear the description in a Gemma voice: T5Gemma-TTS (built on Google's T5Gemma weights) on a HF ZeroGPU Space. First audio takes ~20s; your browser's voice covers failures.">
                        {voiceLoading ? "synthesizing" : buffering ? "next line" : speaking ? "stop" : "listen"}
                      </button>
                    )}
                  </div>
                  {mTab === "desc" && (
                    <>
                      <p className="desc">{result.description}</p>
                      <p className="tab-meta"><b>grounded description</b> · the facts all four captions are built from</p>
                    </>
                  )}
                  {mTab === "sound" && result.heard && (
                    <>
                      <p className="desc">{result.heard}</p>
                      <p className="tab-meta">soundtrack heard by <b>{result.audio_via || result.heard_via || "Gemma 3n"}</b> · experimental, never graded fact</p>
                    </>
                  )}
                  {mTab === "transcript" && result.transcript && (
                    <>
                      <p className="desc">"{result.transcript}"</p>
                      <p className="tab-meta">speech transcribed by <b>{result.transcript_via || result.audio_via || "Gemma 3n"}</b> · appears only when the clip contains speech</p>
                    </>
                  )}
                </div>
                <div className="langbar">
                  <span className="ev-k">Four voices</span>
                  <select className="langsel" value={lang} disabled={translating}
                          onChange={(e) => changeLang(e.target.value)}
                          aria-label="Caption language">
                    {languages.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <span className="langnote">
                    {translating ? "Gemma is transcreating…"
                      : lang !== "English" ? <>tone preserved in <b>{lang}</b>, by Gemma-4</>
                      : <>Gemma speaks <b>140+ languages</b>. Try one</>}
                  </span>
                </div>
                <div className="voices" style={translating ? { opacity: 0.45 } : undefined}>
                  {STYLES.map((st) => (
                    <article key={st.key} className="voice" style={{ "--c": `var(${st.cvar})`, "--d": st.d }}>
                      <div className="v-head">
                        <span className="lam">{st.lam}</span>
                        <div><div className="v-name">{st.name}</div><span className="v-sub">{st.sub}</span></div>
                        {!translated && result.anchors?.[st.key] != null && (
                          <span className="anchor"
                                title="Fact anchor: EmbeddingGemma cosine similarity between this caption and the grounded description. A read-only consistency check.">
                            facts {result.anchors[st.key].toFixed(2)}
                          </span>
                        )}
                        <button className={"copy" + (copied === st.key ? " ok" : "")}
                                onClick={() => copy(st.key, (translated || result.captions)?.[st.key])}>
                          {copied === st.key ? "✓ copied" : "copy"}
                        </button>
                      </div>
                      <p className="v-text">{(translated || result.captions)?.[st.key]}</p>
                    </article>
                  ))}
                </div>

                <div className="meta">
                  <span className="pill"><span className="dot" />served by <b>{BACKENDS[result.backend] || result.backend}</b></span>
                  <span className="pill">model <span className="sep">·</span> <b>{result.model}</b></span>
                  <span className="pill">total <b>{result.timing?.total}s</b></span>
                  <span className="pill">vision <b>{result.timing?.ground}s</b></span>
                  <span className="pill">style <b>{result.timing?.style}s</b></span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="faq">
          <div className="rule" />
          <h2 className="faq-title">Straight answers <span className="faq-sub">· what judges (and skeptics) ask us</span></h2>
          {[
            {
              q: "Is this really Gemma, or is Gemma just branding?",
              a: "Really Gemma. Every graded word, all four caption styles on every clip, is authored by Gemma-4-31B in one structured-JSON call. The code path is public: gemma_client.py (the 3-tier Gemma failover) and caption.py stylize(). No other model writes a single word the judge sees.",
            },
            {
              q: "Then what does the frontier vision model do?",
              a: "Perception only: one grounding call turns up to 16 frames into a factual description, and that's where its job ends. Three vision lanes race in parallel (Kimi-k2p6, Qwen3-VL, and Gemma itself as the last resort) and the best-ranked answer that succeeds wins; Gemma then turns those facts into all four voices. Remove the FIREWORKS_API_KEY and Prism runs pure-Gemma end to end: same pipeline, Gemma does both jobs.",
            },
            {
              q: "Why not use Gemma for vision too?",
              a: "We did, and we measured why it costs accuracy. Gemma-4's encoder compresses each image to ~256 tokens and makes reproducible fine-grained errors (it read an afro puff as a 'high bun'; it names unverifiable pizza toppings with full confidence). No prompt can recover what the encoder never extracted. The full evidence, frames included, is in GEMMA_FINDINGS.md.",
            },
            {
              q: "How do the four styles stay genuinely different?",
              a: "One factual description, one Gemma call, four contracts: each style ships a definition, a good example, and an anti-example. Grounding once keeps every voice faithful to the same facts; the structured-JSON output keeps them separable and machine-checkable.",
            },
            {
              q: "What happens when an API call fails mid-run?",
              a: "Nothing visible. The grounding lanes run in parallel, so a fallback answer is already in hand the moment the primary fails instead of starting on an exhausted clock. Every call carries a per-clip deadline, the frame count degrades gracefully before anything surrenders, results are pre-seeded and rewritten atomically after every clip, and Gemma styling fails over across four serverless hosts. A crash, timeout, or rate-limit can never zero the run.",
            },
            {
              q: "Does Prism use anything from the wider Gemma family?",
              a: "Yes. The small 'facts' chip on every caption card is EmbeddingGemma: a cosine-similarity check that each styled caption stays semantically anchored to the grounded description. It's read-only by design; checks can't hurt the captions. On the roadmap: audio-input Gemma to ground on the soundtrack, and ShieldGemma 2 as a safety pass for brand use.",
            },
            {
              q: "Can it caption in my language?",
              a: "Yes: pick one from the selector above the caption cards. Gemma transcreates all four captions in one call, preserving each voice: the sarcasm stays dry in Hindi, the tech joke still lands in Japanese. Gemma covers 140+ languages; we surface sixteen in the demo.",
            },
          ].map((f, i) => (
            <details key={i} className="faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>

        <footer>
          <div className="rule" />
          <p>Prism · AMD Developer Hackathon ACT II · Track 2 · every caption authored by Gemma-4</p>
        </footer>
      </main>
    </>
  );
}
