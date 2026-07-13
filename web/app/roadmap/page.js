"use client";
import { useEffect } from "react";

// Prism's own product evolution: deeper into the Gemma family, onto AMD silicon,
// then onto the device. Every item is grounded in what already ships or what we
// probed during the hackathon — no vaporware.
const PHASES = [
  {
    key: "shipped", label: "Shipped", sub: "live in the demo today", accent: "--tech", icon: "check_circle",
    items: [
      { t: "Four voices from one grounding", d: "A single clip becomes formal, sarcastic, humorous-tech, and humorous-non-tech captions, all authored by Gemma-4 in one structured-JSON call.", uses: "Gemma-4-31B" },
      { t: "Parallel grounding race", d: "Kimi, Qwen3-VL-235B, and Gemma-4 read the frames in parallel, ranked by a measured benchmark; a provider outage drops quality one rung instead of zeroing a clip.", uses: "Kimi · Qwen3-VL · Gemma-4" },
      { t: "16-language transcreation", d: "One call rewrites all four voices natively in the target language, tone preserved, Hindi/Bengali/Telugu/Tamil included.", uses: "Gemma-4-31B" },
      { t: "Fact-anchor verification", d: "Each caption is embedded and scored against the grounded facts so nothing drifts off what the video actually shows.", uses: "EmbeddingGemma" },
      { t: "A Gemma voice on AMD", d: "The listen button speaks with T5Gemma-TTS synthesized live on an AMD Radeon PRO W7900; the API names the silicon.", uses: "T5Gemma-TTS · AMD W7900" },
    ],
  },
  {
    key: "next", label: "Next", sub: "probed during the hackathon, buildable now", accent: "--formal", icon: "trending_flat",
    items: [
      { t: "Audio-input grounding", d: "Prism discards the soundtrack today. Grounding on commentary, crowd noise, and UI clicks is the extension most likely to lift accuracy; Gemma 3n already accepts audio through one hosted endpoint, and the demo's experimental soundtrack row uses it.", uses: "Gemma 3n E4B (audio)" },
      { t: "Self-hosted voice", d: "Move the T5Gemma voice off the shared ZeroGPU Space onto Prism's own AMD box, removing the one dependency that cost us the voice for hours during testing.", uses: "T5Gemma-TTS · AMD W7900" },
      { t: "Safety pass for brands", d: "A ShieldGemma 2 review over the humorous outputs before four-voice captions ship at scale, so a brand never publishes a joke it did not intend.", uses: "ShieldGemma 2" },
      { t: "Word-synced live captions", d: "Subtitles rendered over the source video in sync with playback. Utterance-level timing works today; word-level waits on a word-timestamp ASR from the Gemma family.", uses: "Gemma 3n + timing" },
      { t: "Indic-language depth", d: "Navarasa (a Gemma fine-tune for Indic languages) shows how far transcreation can go past the four Indic languages the selector already covers.", uses: "Gemma (Navarasa)" },
    ],
  },
  {
    key: "horizon", label: "Horizon", sub: "the version we would build on persistent AMD silicon", accent: "--sarcastic", icon: "rocket_launch",
    items: [
      { t: "The all-AMD Prism", d: "On a reserved W7900 instead of a time-gated session, every stage runs on one box: Gemma 3n hears, Gemma or Qwen-VL grounds, Gemma writes, EmbeddingGemma verifies, T5Gemma speaks. Four external providers collapse into one owned dependency, and the rationed levers — more frames, best-of-N groundings, longer context — come back.", uses: "one AMD W7900, whole pipeline" },
      { t: "On-device Prism", d: "Open Gemma weights make the endgame local and private: small checkpoints captioning on the very machine that recorded the video, no clip ever leaving it.", uses: "small Gemma checkpoints · edge" },
      { t: "Prism becomes products", d: "The same ground-once, refract-many engine hardens into vertical products, from video localization to insurance claims, several already reusing most of the shipped pipeline.", uses: "the refraction engine", link: "/grow" },
    ],
  },
];

export default function Roadmap() {
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("prism-theme", next); } catch {}
  }
  useEffect(() => {}, []);

  return (
    <>
      <div className="aurora"><div className="a3" /></div>
      <div className="grain" />

      <header className="wrap">
        <div className="top">
          <a className="brand" href="/">
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
            <div><h1>Prism</h1><div className="sub">The road ahead</div></div>
          </a>
          <div className="badges">
            <a className="badge" href="/grow"><span className="ms" aria-hidden="true">grid_view</span>&nbsp;Where Prism goes</a>
            <a className="badge" href="/"><span className="ms" aria-hidden="true">arrow_back</span>&nbsp;Back to the demo</a>
            <button className="theme" onClick={toggleTheme} aria-label="Switch color theme" title="Switch theme">
              <span className="ms i-sun" aria-hidden="true">light_mode</span>
              <span className="ms i-moon" aria-hidden="true">dark_mode</span>
            </button>
          </div>
        </div>
      </header>

      <main className="wrap road">
        <section className="road-hero">
          <div className="eyebrow"><span className="eb">Product roadmap</span></div>
          <h2>Deeper into the Gemmaverse. <span className="out">Onto AMD silicon. Then onto the device.</span></h2>
          <p>
            Prism ships today with five <b className="gm">Gemma</b>-family models and a Gemma voice on an
            <b className="amd-word"> AMD</b> Radeon W7900. The arc from here is not a feature wishlist, it is three
            moves we already have the pieces for: hear the soundtrack, bring the whole pipeline home to one AMD box,
            and shrink it onto the device that holds the camera. Every item below is either shipped or something we
            probed while building.
          </p>
        </section>

        <section className="road-line">
          {PHASES.map((p) => (
            <div key={p.key} className="road-phase" style={{ "--c": `var(${p.accent})` }}>
              <div className="rp-head">
                <span className="rp-node"><span className="ms" aria-hidden="true">{p.icon}</span></span>
                <div>
                  <div className="rp-label">{p.label}</div>
                  <div className="rp-sub">{p.sub}</div>
                </div>
                <span className="rp-count">{p.items.length}</span>
              </div>
              <div className="rp-items">
                {p.items.map((it, i) => (
                  <div key={i} className="rp-card">
                    <div className="rc-t">{it.t}</div>
                    <p className="rc-d">{it.d}</p>
                    <div className="rc-uses">
                      <span className="ms" aria-hidden="true">memory</span>{it.uses}
                      {it.link && <a className="rc-link" href={it.link}>see the verticals <span className="ms" aria-hidden="true">arrow_forward</span></a>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <a className="grow-cta" href="/grow" style={{ marginTop: 34 }}>
          <div>
            <div className="gc-eyebrow">One engine · many industries</div>
            <div className="gc-title">Where Prism goes next</div>
            <div className="gc-desc">Past the roadmap, the same refraction engine becomes vertical products across nine markets, with the market, technical, and business detail for each.</div>
          </div>
          <span className="ms" aria-hidden="true">arrow_forward</span>
        </a>

        <footer>
          <div className="rule" />
          <p>Prism · AMD Developer Hackathon ACT II · Track 2<br />
             every caption authored by <b className="gm4">Gemma-4</b> · Gemma voice on an <b>AMD</b> Radeon PRO W7900</p>
        </footer>
      </main>
    </>
  );
}
