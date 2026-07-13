"use client";
import { useEffect, useState } from "react";

// Prism's DNA: ground a video once, refract it into whatever each audience needs,
// with a Gemma family (sees / hears / writes / verifies / speaks) and an AMD voice.
// Each entry is a market Prism's refraction engine extends into.
//
// Market figures below are firm-sourced category sizes (named research firm + year).
// SOM lines and any slice framing are explicitly labeled reasoned estimates, not
// company projections. Sources compiled from Grand View, MarketsandMarkets,
// Precedence, Fortune Business Insights, Mordor, Verified Market Research, Market.us,
// Research and Markets, DataIntelo, and the named incumbents' pricing.
const IDEAS = [
  {
    key: "insure", accent: "--nontech", icon: "policy", badge: "Unicorn-track pivot", flagship: true,
    name: "Prism Insure", alias: "ClaimLens", tag: "A damage walkthrough becomes a claim",
    one: "A claimant films a walkthrough of vehicle or property damage. Prism grounds it into an itemised damage report, a severity score, a repair estimate, a spoken summary, and fraud flags — self-hosted on the insurer's own AMD GPUs, so claim footage never leaves their cloud.",
    field: "Insurance · claims · fleet · property",
    market: {
      tam: { v: "$13.5B → $154B", meta: "AI in insurance · 35.7% CAGR to 2034", src: "Fortune Business Insights, 2025" },
      sam: { v: "$4.8B → $14.3B", meta: "AI claims automation · 13.2% CAGR to 2033", src: "Growth Market Reports, 2024" },
      som: { v: "$15–50M ARR", meta: "mid-tier carriers, 3–5 yr, low-single-digit share", est: true },
    },
    competitors: ["Tractable", "CCC Intelligent Solutions", "Solera / Audatex", "Snapsheet", "Verisk"],
    who: "Auto and property insurers, claims adjusters, and fleet operators triaging first-notice-of-loss at scale.",
    tech: "Prism's video grounding is the engine: sample the walkthrough, read damage and severity across frames, and refract into an adjuster report, a customer-facing spoken summary, and structured claim fields in one pass. Fact-anchoring backs every line to a specific frame, so each claim is auditable.",
    amd: "This is the pivot's core. Gemma self-hosted on the insurer's own AMD GPUs means claim footage never leaves their cloud — the data-residency story cloud-API incumbents (Tractable, CCC) structurally cannot match. AMD does the load-bearing work: private, owned inference on regulated data.",
    gtm: "Enterprise SaaS to carriers on multi-year contracts, priced per-claim/per-transaction over a platform fee (CCC earns ~$100M, ~10% of revenue, from AI modules). Land on FNOL triage, expand across lines.",
    proof: [
      { s: "$308.6B", l: "US insurance fraud a year (P&C $45B); fraud flags attack it directly", src: "Coalition Against Insurance Fraud, 2022" },
      { s: "25–30%", l: "claims-handling expense cut by AI + straight-through processing; cycle time down up to 50%", src: "McKinsey, 2024" },
      { s: "41%", l: "of US insurers had fully digitized claims as of early 2024 — the gap is the opening", src: "Everest Group, 2024" },
      { s: "23.9 → 15 days", l: "claims cycle: industry average vs digital-first carriers", src: "Assured, 2024" },
    ],
  },
  {
    key: "localize", accent: "--formal", icon: "language", badge: "≈70% built",
    name: "Prism Localize", tag: "Global video in every language",
    one: "Ground a clip once, then refract it into subtitles and a dubbed Gemma voice across 140+ languages, tone preserved.",
    field: "Creators · e-learning · global marketing · streaming",
    market: {
      tam: { v: "$2.7B → $33.4B", meta: "AI video translation · 28.7% CAGR to 2034", src: "Market.us, 2024" },
      sam: { v: "$1.35B → $2.56B", meta: "AI dubbing tools · 17.3% CAGR to 2030", src: "Research and Markets, 2026" },
      som: { v: "$8–40M ARR", meta: "0.5–2% of AI-dubbing SAM over 3–5 yr", est: true },
    },
    competitors: ["HeyGen", "ElevenLabs", "Rask AI", "Papercup", "Deepdub"],
    who: "Any team shipping video to more than one language market: creator studios, course platforms, global brand marketing, streamers.",
    tech: "Reuses Prism end to end. Gemma 3n transcribes the speech, Gemma-4 transcreates every caption style across the 16 live languages (140+ available), and T5Gemma re-voices in the target language on the AMD W7900. Subtitle-only ships today; full dubbing adds voice matching.",
    amd: "Gemma-4 transcreation keeps tone across languages (sarcasm stays dry in Hindi, the tech joke still lands in Japanese). Gemma 3n hears, T5Gemma speaks the target language, both on AMD Radeon.",
    gtm: "Per-minute credits (~$0.18/min, ElevenLabs) or per-seat SaaS ($24–39/seat, HeyGen); the field meters per target language, so a 10-min video into 3 languages bills 30 minutes.",
  },
  {
    key: "amplify", accent: "--tech", icon: "campaign", badge: "core DNA",
    name: "Prism Amplify", tag: "One clip, every channel's native voice",
    one: "The four-voices demo, productised: one upload becomes a LinkedIn-ready caption, a TikTok hook, a dev-community post, and a general-feed line, each on-brand.",
    field: "Social · marketing · agencies · creator tooling",
    market: {
      tam: { v: "$16.7B → $76B", meta: "social media management · 21.1% CAGR to 2030", src: "Fortune Business Insights, 2023" },
      sam: { v: "$8.2B → $51B", meta: "AI in media · 35.6% CAGR to 2030", src: "MarketsandMarkets, 2024" },
      som: { v: "$20–100M ARR", meta: "0.1–0.5% of the AI-media slice at scale", est: true },
    },
    competitors: ["Hootsuite", "Sprout Social", "Buffer", "Opus Clip", "Repurpose.io"],
    who: "Social and content teams, marketing agencies, and creators who post the same clip to five platforms in five voices.",
    tech: "This is literally Prism's shipped pipeline. Ground once, then stylize() writes distinct on-brand voices in one structured-JSON call; EmbeddingGemma scores each caption's faithfulness so nothing drifts off-brand. Add per-brand style contracts and platform length limits.",
    amd: "Every graded word is Gemma-4's, in one call that scales to six concurrent generations in about a second. Brand-tuned voices are new style contracts, not new models.",
    gtm: "Per-seat or per-channel SaaS ($5–399/mo across Buffer to Sprout); AI repurposing tools meter processing minutes (Opus Clip $15–29/mo). The multi-voice output is the wedge.",
  },
  {
    key: "access", accent: "--sarcastic", icon: "accessibility_new", badge: "compliance",
    name: "Prism Access", tag: "Captions and audio description, by law",
    one: "Auto-generate compliant closed captions and a spoken audio-description track for any video, so it meets ADA, WCAG, and Section 508.",
    field: "Media · government · higher-ed · enterprise video",
    market: {
      tam: { v: "$721M → $1.3B", meta: "digital accessibility software · 9.2% CAGR to 2030", src: "Grand View Research, 2024" },
      sam: { v: "$1.1B → $3.0B", meta: "captioning & subtitling · 16.5% CAGR to 2030", src: "Verified Market Research, 2024" },
      som: { v: "$5–30M ARR", meta: "0.3–1.5% of the captioning SAM near-to-mid term", est: true },
    },
    competitors: ["3Play Media", "Verbit", "Rev", "CaptionHub", "AudioEye"],
    who: "Broadcasters, universities, government sites, and any enterprise whose video must be accessible or face ADA liability.",
    tech: "Grounding already produces the factual scene description an audio-description track needs; Gemma 3n gives the verbatim transcript for captions; T5Gemma speaks the description between dialogue. The accessibility track is a repackaging of components Prism already runs.",
    amd: "The spoken audio-description voice is synthesized on the AMD W7900, the same shipped path as the demo's listen button. Private, in-house captioning for sensitive footage.",
    gtm: "Sold per media-minute (Rev ~$1.99/min, Verbit ~$0.95/min under contract), blending AI with human review; web-accessibility platforms layer annual SaaS. Demand is regulatory, not discretionary.",
  },
  {
    key: "commerce", accent: "--nontech", icon: "shopping_bag", badge: "vision core",
    name: "Prism Commerce", tag: "Product video into a full listing",
    one: "Point Prism at a product clip; it returns an SEO product description, ad copy, a social hook, and accessible alt-text, all grounded in what the video actually shows.",
    field: "E-commerce · marketplaces · D2C · retail media",
    market: {
      tam: { v: "$31.1B → $164.7B", meta: "AI in retail · 32.0% CAGR to 2030", src: "MarketsandMarkets, 2024" },
      sam: { v: "$962M → $3.95B", meta: "generative AI in e-commerce · 15.2% CAGR to 2035", src: "Precedence Research, 2025" },
      som: { v: "$6–9M ARR", meta: "~0.05% of 30M+ online merchants, near-term", est: true },
    },
    competitors: ["Jasper", "Copy.ai", "Describely", "Lily AI", "VidMob"],
    who: "Marketplace sellers, D2C brands, and retail-media teams turning one product shoot into every downstream asset.",
    tech: "The grounding race reads the product (materials, colour, on-screen text, use) and stylize() refracts it into listing, ad, and social voices in one pass. Fact-anchoring keeps claims tied to what is visible, which matters for advertising compliance.",
    amd: "Gemma-4 reads fine product detail and on-screen text (its strongest measured skill), then authors every downstream asset. Batch throughput on AMD suits catalogue-scale runs.",
    gtm: "Per-seat SaaS (Jasper $59–69/seat/mo) or per-asset usage (Describely ~$0.75/product, $0.05/image credit). ROI is one shoot becoming a dozen assets without a copywriter.",
  },
  {
    key: "learn", accent: "--formal", icon: "school", badge: "vision + audio",
    name: "Prism Learn", tag: "Lectures into notes, at every level",
    one: "Turn a lecture or training video into tiered notes (novice to expert), a clean transcript, a translated version, and a quick comprehension check.",
    field: "EdTech · corporate L&D · online courses",
    market: {
      tam: { v: "$104B → $335B", meta: "corporate e-learning · 21.7% CAGR to 2030", src: "Grand View Research, 2024" },
      sam: { v: "$2.2B → $5.8B+", meta: "AI in education · 17.5% CAGR to 2030 (firms diverge to 42%)", src: "MarketsandMarkets, 2024" },
      som: { v: "$5–7M ARR", meta: "~0.1% of the AI-in-education SAM near-term", est: true },
    },
    competitors: ["Synthesia", "Articulate 360", "Docebo", "Sana Labs", "Coursebox"],
    who: "Course platforms, university media teams, and corporate L&D turning recorded sessions into usable material.",
    tech: "Gemma 3n transcribes the lecture, grounding captures the on-screen slides and diagrams, and the refraction step writes the same content at different reading levels rather than different tones. Transcreation localizes it; a light prompt adds the quiz.",
    amd: "The whole lecture-to-notes pass is Gemma work that runs comfortably on AMD, and long recordings are exactly the batch-throughput regime the W7900 handles well.",
    gtm: "Per-author annual licenses dominate authoring (Articulate ~$1,449–1,749/user/yr); LMS delivery is per-user/mo (Docebo ~$7–10). Sells against the hours instructors spend making notes and translations by hand.",
  },
  {
    key: "watch", accent: "--formal", icon: "monitoring", badge: "vision + search",
    name: "Prism Watch", tag: "Video streams into a briefing",
    one: "Point Prism at broadcast, social, or camera feeds; it grounds every clip into a structured summary and searchable metadata, refracted for the exec brief and the analyst detail alike.",
    field: "Media intelligence · PR · newsrooms · brand safety",
    market: {
      tam: { v: "$5.46B → $12.0B", meta: "media monitoring tools · 14.1% CAGR to 2030", src: "Grand View Research, 2024" },
      sam: { v: "$10.2B → $43.3B", meta: "social media analytics · 27.2% CAGR to 2030", src: "Grand View Research, 2024" },
      som: { v: "$5–6M ARR", meta: "~0.1% of the media-monitoring TAM near-term", est: true },
    },
    competitors: ["Cision", "Meltwater", "Brandwatch", "TVEyes", "Onclusive"],
    who: "Media-intelligence firms, PR and comms teams, newsrooms, and brand-safety monitors watching more video than any human can.",
    tech: "The grounding race reads each clip, Gemma 3n transcribes the audio, and EmbeddingGemma turns both into vectors so a library becomes searchable. Refraction writes the same event as a one-line alert, an exec brief, and an analyst note in a single pass.",
    amd: "This is a throughput problem, and AMD is where throughput lives: vLLM sustained ~700 tokens/s across 32 streams on the W7900, so a feed can be grounded as one continuous batch on owned compute.",
    gtm: "Quote-based enterprise annual contracts ($10K–$150K+/yr; Meltwater median ~$25K, Brandwatch ~$50K). The moat is search over video no competitor has indexed.",
  },
  {
    key: "assist", accent: "--tech", icon: "visibility", badge: "edge · social good",
    name: "Prism Assist", tag: "A spoken world for low-vision users",
    one: "Point a phone camera; Prism narrates the scene, reads signs and text aloud, and warns of hazards, for blind and low-vision users.",
    field: "Accessibility · assistive tech · NGOs · edge devices",
    market: {
      tam: { v: "$6.3B → $11.2B", meta: "assistive tech for low-vision · 12.1% CAGR to 2030", src: "Mordor Intelligence, 2025" },
      sam: { v: "~14–18% CAGR", meta: "AI-narration & smart-wearable slice of that TAM", src: "derived, Mordor 2025", est: true },
      som: { v: "$5–25M ARR", meta: "consumer app or OEM-licensed narration engine", est: true },
    },
    competitors: ["Be My Eyes (+OpenAI)", "Seeing AI", "Envision", "OrCam", "Aira"],
    who: "Visually impaired users directly (250M+ globally, WHO), plus accessibility programs and device makers building it in.",
    tech: "This flips Prism from recorded clips to a live camera: the grounding race describes the scene, Gemma-4's strong OCR reads signs and labels, and T5Gemma speaks it back. The on-device endgame uses small Gemma checkpoints so it runs private and offline.",
    amd: "Open Gemma weights make the private, offline version real: small checkpoints narrating on the device that holds the camera. AMD hosts the heavier cloud tier.",
    gtm: "Bifurcated market: free grant-funded apps (Be My Eyes, Seeing AI), premium hardware (OrCam ~$3–5K), or subscription (Aira ~$600 device + per-minute). Impact-led; a memorable, defensible flagship for the accessibility mission.",
  },
  {
    key: "guard", accent: "--sarcastic", icon: "engineering", badge: "vision core",
    name: "Prism Guard", tag: "Site walkthrough into a safety report",
    one: "Upload a site or facility walkthrough; Prism flags PPE gaps, hazards, and violations, and produces an inspection report with spoken alerts.",
    field: "Construction · industrial · EHS · facilities",
    market: {
      tam: { v: "$7.9B → $11.5B", meta: "EHS software · 7.6% CAGR to 2029", src: "MarketsandMarkets, 2024" },
      sam: { v: "$2.1B → $11.0B", meta: "AI construction-safety analytics · 19.7% CAGR to 2033", src: "DataIntelo, 2024" },
      som: { v: "$10–40M ARR", meta: "site-by-site, low-single-digit share near-term", est: true },
    },
    competitors: ["Procore", "Intenseye", "Voxel", "Protex AI", "Cority"],
    who: "Construction firms, EHS and safety managers, and industrial operators inspecting sites continuously.",
    tech: "The grounding race reads the site for missing PPE, blocked exits, and hazards; refraction produces an inspector report and a plain-language spoken alert for the crew. The same ground-once, refract-many shape, aimed at safety instead of style.",
    amd: "Vision serving on AMD is verified (Gemma-3 and Qwen-VL read real images on the W7900), so continuous inspection runs on owned, private compute at the site's own throughput.",
    gtm: "Per-camera / per-site annual (enterprise ~$100K+/yr, mid-market ~$15–50K/yr). The pitch writes itself: US construction saw 1,075 fatalities in 2023 and safety spend returns $4–6 per $1 (BLS / NSC).",
  },
];

const SECTIONS = [
  ["Who it's for", "who", "group"],
  ["How Prism does it", "tech", "build"],
  ["Gemma + AMD", "amd", "memory"],
  ["Go-to-market & pricing", "gtm", "payments"],
];

function MarketStrip({ m }) {
  const cells = [["TAM", m.tam], ["SAM", m.sam], ["SOM", m.som]];
  return (
    <div className="mk-strip">
      {cells.map(([label, c]) => (
        <div key={label} className="mk-cell">
          <div className="mk-label">{label}{c.est && <span className="mk-est">est.</span>}</div>
          <div className="mk-val">{c.v}</div>
          <div className="mk-meta">{c.meta}</div>
          <div className="mk-src">{c.src}</div>
        </div>
      ))}
    </div>
  );
}

export default function Grow() {
  const [open, setOpen] = useState(null);
  const idea = IDEAS.find((i) => i.key === open);
  const flag = IDEAS.find((i) => i.flagship);
  const rest = IDEAS.filter((i) => !i.flagship);

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("prism-theme", next); } catch {}
  }
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = open ? "hidden" : "";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

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
            <div><h1>Prism</h1><div className="sub">Where the refraction engine goes next</div></div>
          </a>
          <div className="badges">
            <a className="badge" href="/roadmap"><span className="ms" aria-hidden="true">route</span>&nbsp;Roadmap</a>
            <a className="badge" href="/"><span className="ms" aria-hidden="true">arrow_back</span>&nbsp;Back to the demo</a>
            <button className="theme" onClick={toggleTheme} aria-label="Switch color theme" title="Switch theme">
              <span className="ms i-sun" aria-hidden="true">light_mode</span>
              <span className="ms i-moon" aria-hidden="true">dark_mode</span>
            </button>
          </div>
        </div>
      </header>

      <main className="wrap grow">
        <section className="grow-hero">
          <div className="eyebrow"><span className="eb">One engine · nine markets</span></div>
          <h2>Ground a video once. <span className="out">Refract it into a business.</span></h2>
          <p>
            Prism is not a captioner, it is a <b>refraction engine</b>: it grounds a clip once into facts, then
            refracts that one understanding into whatever an audience needs, with a <b className="gm">Gemma</b> family
            that sees, hears, writes, verifies, and speaks on <b className="amd-word">AMD</b> silicon. That shape
            extends past captions into nine markets below, each with firm-sourced <b>TAM / SAM / SOM</b>, the named
            incumbents, and the pricing model. Click any card for the full detail.
          </p>
        </section>

        {/* ── flagship: the Unicorn-track pivot ── */}
        {flag && (
          <section className="flagship" style={{ "--c": `var(${flag.accent})` }}>
            <div className="fl-tag"><span className="ms" aria-hidden="true">auto_awesome</span>{flag.badge}</div>
            <div className="fl-grid">
              <div className="fl-left">
                <div className="fl-name">{flag.name} <span className="fl-alias">“{flag.alias}”</span></div>
                <div className="fl-line">{flag.tag}</div>
                <p className="fl-one">{flag.one}</p>
                <div className="fl-privacy">
                  <span className="ms" aria-hidden="true">shield_lock</span>
                  <span>The AMD angle is the moat: Gemma runs on the insurer&apos;s <b>own AMD GPUs</b>, so claim footage never leaves their cloud — data residency the cloud-API incumbents cannot match.</span>
                </div>
                <button className="fl-cta" onClick={() => setOpen(flag.key)}>
                  Read the full pitch <span className="ms" aria-hidden="true">arrow_forward</span>
                </button>
              </div>
              <div className="fl-right">
                <MarketStrip m={flag.market} />
                <div className="fl-proof">
                  {flag.proof.slice(0, 3).map((p, i) => (
                    <div key={i} className="fl-pf"><b>{p.s}</b><span>{p.l.split(";")[0]}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="grow-sub">The other eight markets</div>
        <section className="grow-grid">
          {rest.map((i) => (
            <button key={i.key} className="grow-card" style={{ "--c": `var(${i.accent})` }} onClick={() => setOpen(i.key)}>
              <div className="gc-top">
                <span className="gc-ic"><span className="ms" aria-hidden="true">{i.icon}</span></span>
                <span className="gc-badge">{i.badge}</span>
              </div>
              <div className="gc-name">{i.name}</div>
              <div className="gc-tag">{i.tag}</div>
              <p className="gc-one">{i.one}</p>
              <div className="gc-mini">
                <span><b>TAM</b> {i.market.tam.v}</span>
                <span><b>SAM</b> {i.market.sam.v}</span>
              </div>
              <div className="gc-field">{i.field}</div>
              <div className="gc-open">open detail <span className="ms" aria-hidden="true">arrow_forward</span></div>
            </button>
          ))}
        </section>

        <p className="grow-note">
          Every $ figure is a firm-sourced category size (named research firm + year); SOM lines and slice framing are
          reasoned estimates, labeled <b>est.</b>, not company projections. Every &quot;how Prism does it&quot; line
          maps to components already running in the live demo: the grounding race, Gemma 3n transcription, the
          four-voice refraction, EmbeddingGemma fact-anchoring, and the T5Gemma voice on AMD.
        </p>

        <footer>
          <div className="rule" />
          <p>Prism · AMD Developer Hackathon ACT II · Track 2<br />
             every caption authored by <b className="gm4">Gemma-4</b> · Gemma voice on an <b>AMD</b> Radeon PRO W7900</p>
        </footer>
      </main>

      {idea && (
        <div className="modal-back" onClick={() => setOpen(null)}>
          <div className="modal" style={{ "--c": `var(${idea.accent})` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={idea.name}>
            <button className="modal-x" onClick={() => setOpen(null)} aria-label="Close"><span className="ms" aria-hidden="true">close</span></button>
            <div className="modal-head">
              <span className="gc-ic"><span className="ms" aria-hidden="true">{idea.icon}</span></span>
              <div>
                <div className="modal-name">{idea.name}{idea.alias && <span className="fl-alias">“{idea.alias}”</span>}</div>
                <div className="modal-tag">{idea.tag}</div>
              </div>
              <span className="gc-badge">{idea.badge}</span>
            </div>
            <p className="modal-one">{idea.one}</p>
            <div className="modal-field"><span className="ms" aria-hidden="true">sell</span>{idea.field}</div>

            <div className="modal-block">
              <div className="mb-h"><span className="ms" aria-hidden="true">trending_up</span>Market</div>
              <MarketStrip m={idea.market} />
            </div>

            <div className="modal-block">
              <div className="mb-h"><span className="ms" aria-hidden="true">groups</span>Competing with</div>
              <div className="comp-row">
                {idea.competitors.map((c) => <span key={c} className="comp">{c}</span>)}
              </div>
            </div>

            {idea.proof && (
              <div className="modal-block">
                <div className="mb-h"><span className="ms" aria-hidden="true">verified</span>Why now — the proof points</div>
                <div className="proof-grid">
                  {idea.proof.map((p, i) => (
                    <div key={i} className="proof-cell">
                      <b>{p.s}</b>
                      <span className="pc-l">{p.l}</span>
                      <span className="pc-s">{p.src}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-secs">
              {SECTIONS.map(([label, key, ic]) => (
                <div key={key} className="modal-sec">
                  <div className="ms-h"><span className="ms" aria-hidden="true">{ic}</span>{label}</div>
                  <p>{idea[key]}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
