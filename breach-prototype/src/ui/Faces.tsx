/* ============================================================
   BREACH — the cast, drawn in-code (inline SVG, no assets)
   HeroFace: the masked operator — one distinct mask per operator
     WRAITH (spectral) · TORCH (molten) · HEX (plague) · BYTE (cyber)
   WatcherFace: the antagonist — a cold red surveillance visor.
   ============================================================ */

type FaceState = "calm" | "tense" | "alarmed";

/** Build the raw SVG innards for one operator's mask (shared skull + signature). */
function heroSvg(op: string, acc: string, mask: string, h1: string, h2: string, eyeCore: string, defs: string, under: string, over: string, maskOp = 0.95): string {
    const b = `bloom-${op}`;
    return `
    <defs>
      <filter id="${b}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3"/></filter>
      <linearGradient id="hood-${op}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h1}"/><stop offset="1" stop-color="${h2}"/></linearGradient>
      ${defs}
    </defs>
    <path d="M60 8 C28 12 16 44 18 84 C19 108 28 132 40 146 L80 146 C92 132 101 108 102 84 C104 44 92 12 60 8 Z" fill="url(#hood-${op})" stroke="${acc}" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M60 12 C34 16 22 46 24 84" fill="none" stroke="${acc}" stroke-opacity="0.25" stroke-width="1.4"/>
    <path d="M60 24 C38 27 30 54 31 82 C32 104 44 122 60 126 C76 122 88 104 89 82 C90 54 82 27 60 24 Z" fill="#0b1a15" fill-opacity="0.92"/>
    <path d="M60 33 L74 40 L80 58 L78 80 L69 98 L60 110 L51 98 L42 80 L40 58 L46 40 Z" fill="${mask}" opacity="${maskOp}" stroke="${acc}" stroke-width="0.9"/>
    <path d="M40 58 L46 40 L60 33 L74 40 L80 58 L72 60 L60 55 L48 60 Z" fill="#ffffff" opacity="0.14"/>
    <line x1="60" y1="35" x2="60" y2="55" stroke="${acc}" stroke-width="0.6" opacity="0.3"/>
    <path d="M45 63 Q60 57 75 63" fill="none" stroke="${acc}" stroke-width="1.1" opacity="0.5"/>
    <circle cx="46" cy="43" r="1.3" fill="${acc}" opacity="0.65"/><circle cx="74" cy="43" r="1.3" fill="${acc}" opacity="0.65"/>
    ${under}
    <path d="M45 66 L58 61 L58 78 L46 80 Z" fill="#000" fill-opacity="0.55"/><path d="M75 66 L62 61 L62 78 L74 80 Z" fill="#000" fill-opacity="0.55"/>
    <g filter="url(#${b})" opacity="0.9"><path class="eye" d="M47 70 L56 66 L56 74 L48 76 Z" fill="${acc}"/><path class="eye" d="M73 70 L64 66 L64 74 L72 76 Z" fill="${acc}"/></g>
    <path d="M47 70 L56 66 L56 74 L48 76 Z" fill="${eyeCore}"/><path d="M73 70 L64 66 L64 74 L72 76 Z" fill="${eyeCore}"/>
    ${over}`;
}

const HERO_SVG: Record<string, string> = {
    // WRAITH — spectral: lower face dissolves into shadow, ghost-echo eyes, rising vapor
    wraith: heroSvg("wraith", "#3affd0", "#dff6ea", "#12271f", "#081511", "#eafffb",
        `<linearGradient id="fade-wraith" x1="0" y1="0" x2="0" y2="1"><stop offset="0.4" stop-color="#dff6ea" stop-opacity="0"/><stop offset="1" stop-color="#05080a" stop-opacity="0.9"/></linearGradient>`,
        ``,
        `<path d="M42 80 L69 98 L60 110 L51 98 Z" fill="url(#fade-wraith)"/>
         <g stroke="#3affd0" stroke-width="0.8" opacity="0.28" fill="none"><path d="M40 120 q-4 -14 2 -26"/><path d="M80 120 q4 -14 -2 -26"/><path d="M60 122 q0 -16 0 -30"/></g>
         <g filter="url(#bloom-wraith)" opacity="0.4"><path d="M47 70 L56 66 L56 74 L48 76 Z" fill="#3affd0" transform="translate(2.5,1.5)"/><path d="M73 70 L64 66 L64 74 L72 76 Z" fill="#3affd0" transform="translate(-2.5,1.5)"/></g>
         <line x1="44" y1="72" x2="76" y2="72" stroke="#3affd0" stroke-width="0.5" opacity="0.35"/>`),
    // TORCH — molten cracks glowing hot + embers + scorch
    torch: heroSvg("torch", "#ff9d3c", "#f0dcc7", "#2a1608", "#160a04", "#fff0d6",
        `<radialGradient id="ember-torch" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#fff2c0"/><stop offset="0.5" stop-color="#ff8a1a"/><stop offset="1" stop-color="#ff4a0a"/></radialGradient>`,
        ``,
        `<g opacity="0.4"><ellipse cx="70" cy="88" rx="11" ry="7" fill="#160702"/><ellipse cx="47" cy="52" rx="7" ry="5" fill="#160702"/></g>
         <g stroke="#3a1403" stroke-width="3" stroke-linecap="round" fill="none"><path d="M46 50 L54 45 L60 51 L69 44 L77 51"/><path d="M60 51 L58 62 L61 79 L58 90"/><path d="M69 44 L74 36"/><path d="M46 50 L40 47"/></g>
         <g stroke="url(#ember-torch)" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M46 50 L54 45 L60 51 L69 44 L77 51"/><path d="M60 51 L58 62 L61 79 L58 90"/><path d="M69 44 L74 36"/><path d="M46 50 L40 47"/></g>
         <g fill="#ffe08a"><circle cx="80" cy="40" r="1.3"/><circle cx="41" cy="60" r="1.1"/><circle cx="84" cy="58" r="1"/><circle cx="44" cy="30" r="1.1"/></g>
         <path d="M44 63 L56 60" stroke="#7a2f0a" stroke-width="1.6" opacity="0.7"/><path d="M76 63 L64 60" stroke="#7a2f0a" stroke-width="1.6" opacity="0.7"/>`),
    // HEX — plague-doctor: beak + filters + hoses + green corrosion
    hex: heroSvg("hex", "#7be24a", "#cfe6bd", "#14210a", "#0a1305", "#eaffd6", ``, ``,
        `<g stroke="#7be24a" stroke-width="1.4" fill="#0e1d08"><path d="M53 86 L67 86 L63 112 L60 118 L57 112 Z"/></g>
         <line x1="56" y1="94" x2="64" y2="94" stroke="#7be24a" stroke-width="0.8" opacity="0.7"/><line x1="57" y1="100" x2="63" y2="100" stroke="#7be24a" stroke-width="0.8" opacity="0.7"/>
         <circle cx="44" cy="92" r="6.5" fill="#0e1d08" stroke="#7be24a" stroke-width="1.4"/><circle cx="76" cy="92" r="6.5" fill="#0e1d08" stroke="#7be24a" stroke-width="1.4"/>
         <circle cx="44" cy="92" r="2.3" fill="#7be24a" opacity="0.85"/><circle cx="76" cy="92" r="2.3" fill="#7be24a" opacity="0.85"/>
         <path d="M44 86 Q40 70 30 60" fill="none" stroke="#7be24a" stroke-width="1.5" opacity="0.55" stroke-dasharray="3 2"/><path d="M76 86 Q80 70 90 60" fill="none" stroke="#7be24a" stroke-width="1.5" opacity="0.55" stroke-dasharray="3 2"/>
         <g stroke="#8bf05a" stroke-width="0.9" opacity="0.6" fill="none"><path d="M50 79 q-1 8 1 13"/><path d="M70 79 q1 8 -1 13"/></g>
         <g fill="#7be24a" opacity="0.5"><circle cx="52" cy="52" r="1.4"/><circle cx="66" cy="47" r="1"/><circle cx="60" cy="45" r="1.6"/></g>`),
    // BYTE — cyber: ocular HUD visor + circuitry + antenna + data port
    byte: heroSvg("byte", "#ffd24a", "#eae3cf", "#1a1608", "#0d0b04", "#fff3c8", ``, ``,
        `<g stroke="#ffd24a" stroke-width="1.4" fill="#0d0b04" opacity="0.95"><path d="M61 63 L79 61 L79 79 L61 78 Z"/></g>
         <g stroke="#ffd24a" stroke-width="0.7" opacity="0.9"><line x1="63" y1="67" x2="77" y2="66.5"/><line x1="63" y1="71" x2="74" y2="70.5"/><line x1="63" y1="75" x2="76" y2="74.5"/></g>
         <g filter="url(#bloom-byte)"><path d="M64 70 L72 68 L72 73 L65 74 Z" fill="#ffe58a"/></g>
         <g stroke="#ffd24a" stroke-width="0.9" opacity="0.75" fill="none"><path d="M44 62 L38 62 L38 78 L44 78"/><path d="M60 106 L60 114 L52 120"/><path d="M46 84 L42 84 L42 92"/><path d="M52 40 L52 30 L58 26"/></g>
         <g fill="#ffd24a"><circle cx="38" cy="70" r="1.6"/><circle cx="52" cy="120" r="1.6"/><circle cx="58" cy="26" r="2"/><circle cx="42" cy="92" r="1.3"/></g>
         <rect x="34" y="66" width="5" height="8" rx="1" fill="#0d0b04" stroke="#ffd24a" stroke-width="0.7"/><line x1="35" y1="68" x2="38" y2="68" stroke="#ffd24a" stroke-width="0.6"/><line x1="35" y1="72" x2="38" y2="72" stroke="#ffd24a" stroke-width="0.6"/>`),
};

export function HeroFace({ op = "wraith", state = "calm", talking = false, className = "" }: { op?: string; state?: FaceState; talking?: boolean; className?: string }) {
    return (
        <svg
            className={`face heroface fx-${state}${talking ? " talking" : ""} ${className}`}
            viewBox="0 0 120 155" aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: HERO_SVG[op] || HERO_SVG.wraith }}
        />
    );
}

export function WatcherFace({ state = "calm", talking = false, className = "" }: { state?: FaceState; talking?: boolean; className?: string }) {
    return (
        <svg className={`face watcherface fx-${state}${talking ? " talking" : ""} ${className}`} viewBox="0 0 120 150" aria-hidden="true">
            <defs><filter id="watchGlow"><feGaussianBlur stdDeviation="2.4" /></filter></defs>
            <path d="M60 8 L98 30 L100 96 L74 130 L46 130 L20 96 L22 30 Z" fill="#160708" stroke="#4a1618" strokeWidth="2" />
            <path d="M60 26 L86 42 L88 90 L60 110 L32 90 L34 42 Z" fill="#210b0d" />
            <path d="M36 52 L44 56 L44 82 L36 86 Z" fill="#330f11" /><path d="M84 52 L76 56 L76 82 L84 86 Z" fill="#330f11" />
            <g filter="url(#watchGlow)"><rect className="visor" x="34" y="58" width="52" height="11" rx="2" fill="#ff2d3a" /></g>
            <rect x="34" y="60" width="52" height="7" rx="1" fill="#ff5a63" />
            <circle className="scandot" cx="66" cy="63.5" r="3.2" fill="#fff" />
            <g stroke="#5a1a1c" strokeWidth="1.5"><line x1="48" y1="92" x2="72" y2="92" /><line x1="50" y1="97" x2="70" y2="97" /><line x1="53" y1="102" x2="67" y2="102" /></g>
        </svg>
    );
}
