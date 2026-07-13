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

// staged loading copy; Gemma names carry their lane colors
const LOAD_MSGS = [
  <>Sampling frames across the clip…</>,
  <><span className="gm3n">Gemma 3n</span> is listening to the soundtrack…</>,
  <>Grounding race is reading the frames…</>,
  <><span className="gm4">Gemma-4</span> is refracting into four voices…</>,
];

function basename(u) {
  try { return decodeURIComponent(u.split("/").pop().split("?")[0]) || u; }
  catch { return u; }
}

// served-by pill: color the Gemma-4 part of the backend label
function servedBy(label) {
  if (label?.startsWith("Gemma-4")) {
    return <b><span className="gm4">Gemma-4</span>{label.slice("Gemma-4".length)}</b>;
  }
  return <b>{label}</b>;
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
  const [copied, setCopied] = useState(null);
  const [languages, setLanguages] = useState(["English"]);
  const [lang, setLang] = useState("English");
  const [translated, setTranslated] = useState(null);   // captions in `lang`, or null for English
  const [translating, setTranslating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [voiceEngine, setVoiceEngine] = useState("");   // which host served the voice
  const [mTab, setMTab] = useState("desc");   // desc | sound | script
  const fileRef = useRef(null);

  // Drive the CSS state machine via body attributes (matches the design system).
  useEffect(() => { document.body.dataset.state = phase; }, [phase]);
  useEffect(() => { document.body.dataset.tab = tab; }, [tab]);

  useEffect(() => {
    fetch("/api/samples").then((r) => r.json())
      .then((d) => { setSamples(d.samples || []); setLanguages(d.languages || ["English"]); })
      .catch(() => {});
  }, []);

  // Staged progress while the real request is in flight; the fetch resolving
  // (phase change) ends it, never a fixed timer.
  useEffect(() => {
    if (phase !== "loading") return;
    setLoadStage(0);
    const t1 = setTimeout(() => setLoadStage(1), 800);
    const t2 = setTimeout(() => setLoadStage(2), 1600);
    const t3 = setTimeout(() => setLoadStage(3), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
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
    stopSpeaking();
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
    setVoiceEngine("browser voice");
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
      return d.audio ? { audio: d.audio, engine: d.engine } : { error: d.error || "no audio" };
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
    setVoiceEngine("");
    const chunks = ttsChunks(text);
    const jobs = new Array(chunks.length).fill(null);
    const fire = (i) => { if (i < chunks.length && !jobs[i] && !run.aborted) jobs[i] = fetchTTS(chunks[i]); };
    fire(0); fire(1);                              // batch 1: sentences 1+2 in parallel
    setVoiceLoading(true);
    const first = await jobs[0];
    if (run.aborted) return;
    if (!first.audio) { setVoiceLoading(false); browserSpeak(text); return; }
    if (first.engine) setVoiceEngine(first.engine);   // name the host that served the voice
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

  // per-run receipt numbers, computed from the response
  const captionWords = result
    ? STYLES.reduce((n, s) => n + ((result.captions?.[s.key] || "").trim().split(/\s+/).filter(Boolean).length), 0)
    : 0;
  const heardAudio = !!(result?.transcript || result?.heard);
  const scoredCount = result ? STYLES.filter((s) => result.anchors?.[s.key] != null).length : 0;

  return (
    <>
      <div className="aurora"><div className="a3" /></div>
      <div className="grain" />

      {/* ══════════ HEADER ══════════ */}
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
            <span className="badge gem"><span className="dot" /> Powered by&nbsp;<b className="gm">4 Gemma models</b></span>
            <span className="badge amd" title="The Gemma voice is synthesized on an AMD Radeon PRO W7900 (ROCm)"><span className="dot" /> Voice on&nbsp;<b className="amd-word">AMD</b>&nbsp;Radeon W7900</span>
            <button className="theme" onClick={toggleTheme} aria-label="Switch color theme" title="Switch theme">
              <span className="ms i-sun" aria-hidden="true">light_mode</span>
              <span className="ms i-moon" aria-hidden="true">dark_mode</span>
            </button>
          </div>
        </div>
      </header>

      <main className="wrap">
        {/* ══════════ HERO ══════════ */}
        <section className="hero">
          <div>
            <div className="eyebrow"><span className="eb">Four <span className="gm">Gemma</span> models · one agent · every graded word is <span className="gm">Gemma&apos;s</span></span></div>
            <h2>One clip in.<span className="out">Four voices out.</span></h2>
            <p>
              Prism samples high-res frames from your video and grounds them into one factual description.
              Then <b className="gm4">Gemma-4</b> writes every word of all four caption styles, while{" "}
              <b className="gm3n">Gemma&nbsp;3n</b> listens, <b className="gme">EmbeddingGemma</b> verifies,
              and <b className="gmt5">T5Gemma</b> speaks. You see <b>exactly what the models saw</b>.
            </p>
            <div className="swatches" aria-hidden="true">
              {STYLES.map((s) => (
                <span key={s.key} className="sw" style={{ "--c": `var(${s.cvar})` }}>
                  <i />{s.name.replace("Humorous · ", "")} <em>{s.lam}</em>
                </span>
              ))}
            </div>
          </div>

          <div className="scene" aria-hidden="true">
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

        {/* ══════════ INPUT ══════════ */}
        <section className="io">
          <div className="io-inner">
            <div className="tabs" role="tablist" aria-label="Input mode">
              <button role="tab" aria-selected={tab === "upload"} onClick={() => setTab("upload")}><span className="ms" aria-hidden="true">upload</span>Upload</button>
              <button role="tab" aria-selected={tab === "link"} onClick={() => setTab("link")}><span className="ms" aria-hidden="true">link</span>Paste link</button>
              <button role="tab" aria-selected={tab === "sample"} onClick={() => setTab("sample")}><span className="ms" aria-hidden="true">movie</span>Samples</button>
            </div>

            <div className="panel p-upload" role="tabpanel">
              <div className={"drop" + (hot ? " hot" : "")} tabIndex={0}
                   onClick={() => fileRef.current?.click()}
                   onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
                   onDragOver={(e) => { e.preventDefault(); setHot(true); }}
                   onDragLeave={() => setHot(false)}
                   onDrop={onDrop}>
                <span className="ms glyph" aria-hidden="true">cloud_upload</span>
                <div className="big">Drop a clip here, or click to choose</div>
                <div className="small"><b>MP4 · MOV · WebM</b>, same pipeline the grader runs</div>
                <input ref={fileRef} type="file" accept="video/*" hidden
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); runUpload(f); } }} />
              </div>
            </div>

            <div className="panel p-link" role="tabpanel">
              <div className="linkrow">
                <input type="url" placeholder="https://…/clip.mp4" aria-label="Video URL"
                       value={url} onChange={(e) => setUrl(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && url && runLink(url)} />
                <button className="btn" disabled={!url} onClick={() => url && runLink(url)}>
                  <span className="ms" aria-hidden="true">flare</span>Refract
                </button>
              </div>
            </div>

            <div className="panel p-sample" role="tabpanel">
              <div className="samples">
                {samples.map((s, i) => (
                  <button key={s.id} className="chip" style={{ "--c": `var(${CHIP_C[i % CHIP_C.length]})` }}
                          onClick={() => runLink(s.url)}>
                    <span className="thumb" />
                    <span><span className="lab">{s.label}</span><span className="sub">sample · click to refract</span></span>
                  </button>
                ))}
              </div>
            </div>

            <div className={"err" + (error ? " show" : "")} role="alert">
              <span className="ms" style={{ fontSize: 17 }} aria-hidden="true">warning</span>
              <span><b>Couldn&apos;t refract this clip.</b> <span>{error}</span></span>
            </div>

            <div className="loadingbox" aria-live="polite">
              <div className="lb-head">
                <h3>{LOAD_MSGS[loadStage]}</h3>
                {sourceLabel && <span className="lb-file">{sourceLabel}</span>}
              </div>
              <div className="track"><div className="fill" /></div>
              <div className="stages">
                <div className={"stage" + (loadStage >= 0 ? " on" : "")}>
                  <div className="st-k"><span className="ms" aria-hidden="true">photo_library</span>01 · Frames</div>
                  <div className="st-v">Sample frames across the clip</div>
                  <div className="st-m">up to sixteen high-res stills</div>
                </div>
                <div className={"stage" + (loadStage >= 1 ? " on" : "")}>
                  <div className="st-k"><span className="ms" aria-hidden="true">hearing</span>02 · Audio</div>
                  <div className="st-v"><span className="gm3n">Gemma 3n</span> hears the soundtrack</div>
                  <div className="st-m">28-second chunks on a side thread</div>
                </div>
                <div className={"stage" + (loadStage >= 2 ? " on" : "")}>
                  <div className="st-k"><span className="ms" aria-hidden="true">visibility</span>03 · Vision</div>
                  <div className="st-v">Grounding race reads the frames</div>
                  <div className="st-m"><b className="gm4">Gemma-4</b> runs the always-on last lane</div>
                </div>
                <div className={"stage" + (loadStage >= 3 ? " on" : "")}>
                  <div className="st-k"><span className="ms" aria-hidden="true">flare</span>04 · Refraction</div>
                  <div className="st-v">Split into four voices</div>
                  <div className="st-m"><b className="gm4">Gemma-4</b> writes · <b className="gme">EmbeddingGemma</b> verifies</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ RESULTS ══════════ */}
        {result && (
          <section className="results">
            <div className="res-head">
              <div>
                <div className="eyebrow"><span className="eb">Refraction complete{result.timing?.total ? <> · {result.timing.total}s</> : null} · every word below is <span className="gm">Gemma&apos;s</span></span></div>
                <h2>One clip, <span>four voices</span>.</h2>
              </div>
              <button className="again" onClick={reset}>
                <span className="ms" style={{ fontSize: 15 }} aria-hidden="true">refresh</span>
                Refract another
              </button>
            </div>

            <div className="res-grid">
              <aside className="evidence">
                <div className="ev-sec">
                  <div className="ev-k"><span className="ms" aria-hidden="true">movie</span>Source clip</div>
                  {videoSrc
                    ? <video className="video-el" src={videoSrc} controls autoPlay muted loop playsInline />
                    : <div className="video-ph"><span className="play" /><span className="fn">{sourceLabel}</span></div>}
                </div>
                <div className="ev-sec">
                  <div className="ev-k"><span className="ms" aria-hidden="true">visibility</span>What the models see</div>
                  <div className="montage">
                    {result.montage && <img src={result.montage} alt="frame montage" />}
                    <div className="scan" />
                  </div>
                  <p className="m-cap"><b>{result.frame_count} frames, one image.</b> Read left→right, top→bottom in time. These are the only pixels any model receives.</p>
                </div>
              </aside>

              <div>
                {/* description card: title, file, tabs (Gemma lanes), listen (T5Gemma) */}
                <article className="dcard">
                  <div className="d-top">
                    <div>
                      <div className="d-title">{result.title || "Untitled clip"}</div>
                      {sourceLabel && (
                        <div className="d-file">
                          <span className="ms" style={{ fontSize: 13 }} aria-hidden="true">video_file</span>
                          {sourceLabel}
                        </div>
                      )}
                    </div>
                    {mTab === "desc" && (
                      <button className="listen" onClick={() => speak(result.description)}
                              title="Hear the description in a Gemma voice: T5Gemma-TTS (built on Google's T5Gemma weights). First audio takes ~20s; your browser's voice covers failures.">
                        <span className="ms" aria-hidden="true">volume_up</span>
                        {voiceLoading ? "synthesizing" : buffering ? "next line" : speaking ? "stop" : "listen"}
                        {" "}<em>
                          {/AMD|W7900/i.test(voiceEngine)
                            ? <>· <span className="gmt5">T5Gemma</span> <span className="amd-chip">on AMD W7900</span></>
                            : /browser/i.test(voiceEngine)
                            ? <>· browser voice</>
                            : <>· <span className="gmt5">T5Gemma</span></>}
                        </em>
                      </button>
                    )}
                  </div>
                  <div className="d-tabs" role="tablist" aria-label="Evidence tabs">
                    <button className={mTab === "desc" ? "on" : ""} onClick={() => setMTab("desc")}>
                      <span className="ms" aria-hidden="true">subject</span>Description
                    </button>
                    {result.heard && (
                      <button className={mTab === "sound" ? "on" : ""} onClick={() => setMTab("sound")}>
                        <span className="ms" aria-hidden="true">graphic_eq</span>Soundtrack <span className="by">· <span className="gm3n">Gemma 3n</span></span>
                      </button>
                    )}
                    {result.transcript && (
                      <button className={mTab === "script" ? "on" : ""} onClick={() => setMTab("script")}>
                        <span className="ms" aria-hidden="true">speech_to_text</span>Transcript <span className="by">· <span className="gm3n">Gemma 3n</span></span>
                      </button>
                    )}
                  </div>
                  {mTab === "desc" && (
                    <>
                      <p className="d-text">{result.description}</p>
                      <div className="d-foot"><b>grounded description</b> · the facts all four captions are built from · verified per-caption by <span className="gme">EmbeddingGemma</span></div>
                    </>
                  )}
                  {mTab === "sound" && result.heard && (
                    <>
                      <p className="d-text">{result.heard}</p>
                      <div className="d-foot">soundtrack heard by <b>{result.audio_via || result.heard_via || "Gemma 3n"}</b> · experimental, never graded fact</div>
                    </>
                  )}
                  {mTab === "script" && result.transcript && (
                    <>
                      <p className="d-text">&quot;{result.transcript}&quot;</p>
                      <div className="d-foot">speech transcribed by <b>{result.transcript_via || result.audio_via || "Gemma 3n"}</b> · appears only when the clip contains speech</div>
                    </>
                  )}
                </article>

                {/* four voices bar */}
                <div className="v-bar">
                  <div className="ev-k"><span className="ms" aria-hidden="true">graphic_eq</span>Four voices</div>
                  <span className="ms" style={{ fontSize: 15, color: "var(--ink-faint)" }} aria-hidden="true">translate</span>
                  <select className="lang" value={lang} disabled={translating}
                          onChange={(e) => changeLang(e.target.value)} aria-label="Caption language">
                    {languages.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <span className="v-note">
                    {translating ? <><span className="gm">Gemma</span> is transcreating…</>
                      : lang !== "English" ? <>tone preserved in <b>{lang}</b>, by <span className="gm4">Gemma-4</span></>
                      : <><span className="gm">Gemma</span> speaks <b>140+ languages</b>.{" "}
                          <a onClick={() => languages[1] && changeLang(languages[1])}>Try one</a></>}
                  </span>
                </div>

                <div className="voices" style={translating ? { opacity: 0.45 } : undefined}>
                  {STYLES.map((st) => (
                    <article key={st.key} className="voice" style={{ "--c": `var(${st.cvar})`, "--d": st.d }}>
                      <div className="v-head">
                        <span className="lam">{st.lam}</span>
                        <div><div className="v-name">{st.name}</div><span className="v-sub">{st.sub}</span></div>
                        {!translated && result.anchors?.[st.key] != null && (
                          <span className="facts" title="EmbeddingGemma similarity to the grounded facts">
                            <span className="ms" aria-hidden="true">verified</span>facts {result.anchors[st.key].toFixed(2)}
                          </span>
                        )}
                        <button className={"copy" + (copied === st.key ? " ok" : "")}
                                onClick={() => copy(st.key, (translated || result.captions)?.[st.key])}>
                          <span className="ms" aria-hidden="true">{copied === st.key ? "check" : "content_copy"}</span>
                          <span className="lbl">{copied === st.key ? "copied" : "copy"}</span>
                        </button>
                      </div>
                      <p className="v-text">{(translated || result.captions)?.[st.key]}</p>
                    </article>
                  ))}
                </div>

                <div className="gm-receipt">
                  run receipt&nbsp;&nbsp;<b className="gm4">Gemma-4</b> wrote {captionWords} words <span>·</span>{" "}
                  <b className="gm3n">Gemma 3n</b> {heardAudio ? "heard the soundtrack" : "found no speech"} <span>·</span>{" "}
                  <b className="gme">EmbeddingGemma</b> scored {scoredCount}/4 captions <span>·</span>{" "}
                  <b className="gmt5">T5Gemma</b> standing by
                </div>
                <div className="meta">
                  <span className="pill"><span className="dot" />served by {servedBy(BACKENDS[result.backend] || result.backend)}</span>
                  <span className="pill">model <span className="sep">·</span> <b>{result.model}</b></span>
                  <span className="pill">total <b>{result.timing?.total}s</b></span>
                  <span className="pill">vision <b>{result.timing?.ground}s</b></span>
                  <span className="pill">style <b>{result.timing?.style}s</b></span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ══════════ THE GEMMA ENSEMBLE ══════════ */}
        <section className="section" id="ensemble">
          <div className="sec-head">
            <h3>Four <span className="gm">Gemma</span> models. One agent.</h3>
            <p className="sub">Most captioning agents call one model. Prism runs <b>four members of Google DeepMind&apos;s
              open <span className="gm">Gemma</span> family</b>, each doing the job it measures best at, and every one of them is visible in this demo.</p>
            <div className="flowline" aria-hidden="true">
              clip <span className="ar">→</span>
              <i style={{ "--c": "var(--tech)" }} /> <span className="gm3n">Gemma&nbsp;3n</span> hears <span className="ar">→</span>
              <i style={{ "--c": "var(--formal)" }} /> <span className="gm4">Gemma-4</span> writes <span className="ar">→</span>
              <i style={{ "--c": "var(--sarcastic)" }} /> <span className="gme">EmbeddingGemma</span> verifies <span className="ar">→</span>
              <i style={{ "--c": "var(--nontech)" }} /> <span className="gmt5">T5Gemma</span> speaks
            </div>
          </div>

          <div className="models">
            <article className="model" style={{ "--c": "var(--formal)" }}>
              <div className="m-head"><i /><span className="m-role"><span className="ms" aria-hidden="true">stylus_note</span>WRITES</span></div>
              <div className="m-name gm4">Gemma-4-31B</div>
              <p className="m-body">Authors every caption in every style, every clip, every mode, all in one structured JSON call. Also grounds as the always-on last lane of the vision race.</p>
              <p className="m-demo">in this demo: <b>the four caption cards</b></p>
            </article>
            <article className="model" style={{ "--c": "var(--tech)" }}>
              <div className="m-head"><i /><span className="m-role"><span className="ms" aria-hidden="true">hearing</span>HEARS</span></div>
              <div className="m-name gm3n">Gemma 3n E4B</div>
              <p className="m-body">Transcribes the soundtrack in 28-second chunks on a side thread, so what is said shapes the captions alongside what is shown.</p>
              <p className="m-demo">in this demo: <b>the Soundtrack and Transcript tabs</b></p>
            </article>
            <article className="model" style={{ "--c": "var(--sarcastic)" }}>
              <div className="m-head"><i /><span className="m-role"><span className="ms" aria-hidden="true">verified</span>VERIFY</span></div>
              <div className="m-name gme">EmbeddingGemma</div>
              <p className="m-body">Scores each styled caption&apos;s semantic anchor to the grounded facts. Read-only by design: checks can never hurt the captions.</p>
              <p className="m-demo">in this demo: <b>the facts chip on every card</b></p>
            </article>
            <article className="model" style={{ "--c": "var(--nontech)" }}>
              <div className="m-head"><i /><span className="m-role"><span className="ms" aria-hidden="true">record_voice_over</span>SPEAKS</span></div>
              <div className="m-name gmt5">T5Gemma-TTS</div>
              <p className="m-body">The listen button speaks with a community TTS built on <span className="gmt5">T5Gemma</span> weights, synthesized on an <b className="amd-word">AMD</b> Radeon PRO W7900 via ROCm.</p>
              <p className="m-demo">in this demo: <b>the listen button</b></p>
            </article>
          </div>

          <div className="meter" aria-label="Share of graded words authored by Gemma">
            <div className="meter-top">
              <span className="mt-label"><span className="ms" aria-hidden="true">workspace_premium</span>share of graded words authored by <span className="gm">Gemma</span></span>
              <b className="mt-num">100%</b>
            </div>
            <div className="meter-bar"><i /></div>
            <div className="meter-note">the frontier vision model contributes facts, never words</div>
          </div>

          <div className="stats">
            <div className="stat"><div className="k"><span className="ms" aria-hidden="true">document_scanner</span>Best signage OCR</div><div className="v">of every serverless VLM we benchmarked on the public validation clips, at 3 to 4 times their speed. Reproduced in GEMMA_FINDINGS, section 8.</div></div>
            <div className="stat"><div className="k"><span className="ms" aria-hidden="true">bolt</span>0.9s per call</div><div className="v">six parallel <span className="gm">Gemma</span> calls finish in about a second: the styling engine never waits.</div></div>
            <div className="stat"><div className="k"><span className="ms" aria-hidden="true">translate</span>140+ languages</div><div className="v">four voices transcreated with tone intact; sixteen live in the selector above.</div></div>
          </div>
          <div className="receipts">
            <span className="txt">Chosen by measurement, not branding. Every claim above is reproduced with evidence
              frames, alongside an honest section on what <span className="gm">Gemma</span> is <em>not</em> the right tool for.</span>
            <a className="findings" href="https://github.com/DevDebojyotiC/prism/blob/main/GEMMA_FINDINGS.md" target="_blank" rel="noreferrer">
              <span className="ms" aria-hidden="true">fact_check</span>
              GEMMA_FINDINGS.md <em>· every claim, reproduced</em>
            </a>
          </div>
        </section>

        {/* ══════════ STRAIGHT ANSWERS ══════════ */}
        <section className="section" id="faq">
          <div className="sec-head">
            <h3>Straight answers</h3>
            <p className="sub">what judges (and skeptics) ask us</p>
          </div>
          <div className="faq">
            <details open>
              <summary><span className="q">Is this really <span className="gm">Gemma</span>, or is <span className="gm">Gemma</span> just branding?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a"><b>Every graded word is generated by google/gemma-4-31B-it</b>: formal, sarcastic, tech, everyday,
                every language, every clip. The frontier vision model never writes a word of output; it only contributes
                neutral scene facts during grounding. The meta pills on every result name the exact model that served it.</p>
            </details>
            <details>
              <summary><span className="q">Then what does the frontier vision model do?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a">It races in the grounding stage, where its only job is turning pixels into a neutral factual
                description. That description is input, not output. The graded captions are authored entirely by <span className="gm4">Gemma-4</span>{" "}
                from those facts plus <span className="gm3n">Gemma 3n</span>&apos;s audio transcript.</p>
            </details>
            <details>
              <summary><span className="q">Why not use <span className="gm">Gemma</span> for vision too?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a">We do. <span className="gm4">Gemma-4</span> runs as the always-on last lane of the vision race, and it wins outright on
                signage OCR (GEMMA_FINDINGS, section 8). Where a bigger model reads a frame better, we let it, because the facts
                feed <span className="gm">Gemma</span> rather than replace it.</p>
            </details>
            <details>
              <summary><span className="q">How do the four styles stay genuinely different?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a">One structured-JSON call with per-style constraints, then <b className="gme">EmbeddingGemma</b> scores each
                caption&apos;s similarity to the grounded facts, shown as the facts chip on every card. Formal should score high;
                humor is allowed to drift, and the score shows you exactly how far.</p>
            </details>
            <details>
              <summary><span className="q">What happens when an API call fails mid-run?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a">The grounding lanes run in parallel, so a fallback answer is already in hand the moment the
                primary fails. Styling waterfalls across serverless hosts, and whichever lane serves the run is named in the
                meta pills; partial results are never shown as complete ones.</p>
            </details>
            <details>
              <summary><span className="q">Does Prism use anything from the wider <span className="gm">Gemma</span> family?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a">Four members: <b className="gm4">Gemma-4-31B</b> writes, <b className="gm3n">Gemma 3n E4B</b> hears, <b className="gme">EmbeddingGemma</b>{" "}
                verifies, and <b className="gmt5">T5Gemma</b> speaks. Each was chosen by measurement for its lane, and each is visible in
                the demo; nothing runs backstage.</p>
            </details>
            <details>
              <summary><span className="q">Can it caption in my language?</span><span className="pm"><span className="ms" aria-hidden="true">add</span></span></summary>
              <p className="a"><span className="gm4">Gemma-4</span> transcreates all four voices across 140+ languages: tone stays intact, rather than
                word-for-word translation. Sixteen are live in the selector above the caption cards; the rest are one config line away.</p>
            </details>
          </div>
        </section>

        {/* ══════════ ON AMD SILICON ══════════ */}
        <section className="section" id="amd">
          <div className="sec-head">
            <h3>Real work on <b className="amd-word">AMD</b> silicon.</h3>
            <p className="sub">Prism&apos;s Gemma voice is synthesized on an <b className="amd-word">AMD</b> Radeon PRO W7900,
              not a claim on a slide: the listen button above speaks from that GPU, and the API response names it.</p>
          </div>
          <div className="stats">
            <div className="stat"><div className="k"><span className="ms amd-ic" aria-hidden="true">memory</span>Radeon PRO W7900</div><div className="v">RDNA3, gfx1100, 48 GB, ROCm 7.2. The Gemma voice (T5Gemma-TTS) runs here; the engine label on the listen button proves it live.</div></div>
            <div className="stat"><div className="k"><span className="ms amd-ic" aria-hidden="true">visibility</span>Vision serves on RDNA3</div><div className="v">We ran Gemma-3-12B and Qwen-VL on the W7900 through vLLM; both read a real image accurately. RDNA3 multimodal serving is not just theoretical.</div></div>
            <div className="stat"><div className="k"><span className="ms amd-ic" aria-hidden="true">bolt</span>~700 tok/s at scale</div><div className="v">Qwen2.5-7B on the card: ~29 tok/s single, ~700 tok/s across 32 concurrent streams. Radeon earns its place under batch load.</div></div>
          </div>
          <div className="receipts">
            <span className="txt">Credited where it does real work and nowhere it does not: the graded captioning path uses serverless providers; the Gemma <em>voice</em> is genuinely <b className="amd-word">AMD</b>-hosted.</span>
            <a className="findings amd" href="https://github.com/DevDebojyotiC/prism/blob/main/AMD_FINDINGS.md" target="_blank" rel="noreferrer">
              <span className="ms" aria-hidden="true">fact_check</span>
              AMD_FINDINGS.md <em>· the Radeon build log</em>
            </a>
          </div>
        </section>

        {/* ══════════ FOOTER ══════════ */}
        <footer>
          <div className="rule" />
          <p>Prism · AMD Developer Hackathon ACT II · Track 2<br />
             every caption authored by <b className="gm4">Gemma-4</b> · built on Google DeepMind&apos;s open-weights <b className="gm">Gemma</b> family</p>
          <p className="amd-line">Gemma voice synthesized on an <b>AMD</b> Radeon PRO W7900 · ROCm 7.2 · gfx1100</p>
        </footer>
      </main>
    </>
  );
}
