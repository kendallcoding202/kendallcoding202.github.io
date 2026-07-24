/* ============================================================
   BREACH — the cast, drawn in-code (inline SVG, no assets)
   HeroFace  = the masked operator (you). Cool cyan, determined.
   WatcherFace = the antagonist. Cold red surveillance visor.
   Both take a `state` that drives how agitated the glitch is, so
   the hero can visibly sweat as the trace closes in, and the
   watcher can loom harder when it's on top of you.
   ============================================================ */

type FaceState = "calm" | "tense" | "alarmed";

export function HeroFace({ state = "calm", talking = false, className = "" }: { state?: FaceState; talking?: boolean; className?: string }) {
    return (
        <svg className={`face heroface fx-${state}${talking ? " talking" : ""} ${className}`} viewBox="0 0 120 150" aria-hidden="true">
            <defs>
                <filter id="heroGlow"><feGaussianBlur stdDeviation="2.2" /></filter>
                <linearGradient id="heroHood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#12271f" /><stop offset="1" stopColor="#081511" /></linearGradient>
            </defs>
            {/* hood */}
            <path d="M60 8 C28 12 16 44 18 84 C19 108 28 132 40 146 L80 146 C92 132 101 108 102 84 C104 44 92 12 60 8 Z" fill="url(#heroHood)" stroke="#1e4536" strokeWidth="2" />
            <path d="M60 24 C38 27 30 54 31 82 C32 104 44 122 60 126 C76 122 88 104 89 82 C90 54 82 27 60 24 Z" fill="#0c1d18" />
            {/* mask: angular jaw + cheekbones */}
            <path d="M60 33 L74 40 L80 58 L78 80 L69 98 L60 110 L51 98 L42 80 L40 58 L46 40 Z" fill="#dff6ea" opacity="0.95" stroke="#4dffcf" strokeWidth="0.8" />
            <path d="M40 58 L46 40 L60 33 L74 40 L80 58 L72 60 L60 55 L48 60 Z" fill="#bfe6d6" opacity="0.6" />
            {/* recessed eye sockets */}
            <path d="M45 66 L58 61 L58 78 L46 80 Z" fill="#0f2a22" /><path d="M75 66 L62 61 L62 78 L74 80 Z" fill="#0f2a22" />
            {/* glowing eyes */}
            <g filter="url(#heroGlow)"><path className="eye" d="M47 70 L56 66 L56 74 L48 76 Z" fill="#3affd0" /><path className="eye" d="M73 70 L64 66 L64 74 L72 76 Z" fill="#3affd0" /></g>
            <path d="M47 70 L56 66 L56 74 L48 76 Z" fill="#e6fff8" /><path d="M73 70 L64 66 L64 74 L72 76 Z" fill="#e6fff8" />
            {/* respirator */}
            <path className="mouth" d="M52 88 L68 88 L65 100 L55 100 Z" fill="#b6dccd" opacity="0.5" stroke="#7fb2a1" strokeWidth="1" />
            <g stroke="#5f8f7e" strokeWidth="1"><line x1="55" y1="92" x2="65" y2="92" /><line x1="56" y1="96" x2="64" y2="96" /></g>
        </svg>
    );
}

export function WatcherFace({ state = "calm", talking = false, className = "" }: { state?: FaceState; talking?: boolean; className?: string }) {
    return (
        <svg className={`face watcherface fx-${state}${talking ? " talking" : ""} ${className}`} viewBox="0 0 120 150" aria-hidden="true">
            <defs><filter id="watchGlow"><feGaussianBlur stdDeviation="2.4" /></filter></defs>
            {/* helmet */}
            <path d="M60 8 L98 30 L100 96 L74 130 L46 130 L20 96 L22 30 Z" fill="#160708" stroke="#4a1618" strokeWidth="2" />
            <path d="M60 26 L86 42 L88 90 L60 110 L32 90 L34 42 Z" fill="#210b0d" />
            {/* side vents */}
            <path d="M36 52 L44 56 L44 82 L36 86 Z" fill="#330f11" /><path d="M84 52 L76 56 L76 82 L84 86 Z" fill="#330f11" />
            {/* scanning visor */}
            <g filter="url(#watchGlow)"><rect className="visor" x="34" y="58" width="52" height="11" rx="2" fill="#ff2d3a" /></g>
            <rect x="34" y="60" width="52" height="7" rx="1" fill="#ff5a63" />
            <circle className="scandot" cx="66" cy="63.5" r="3.2" fill="#fff" />
            {/* mouth grille */}
            <g stroke="#5a1a1c" strokeWidth="1.5"><line x1="48" y1="92" x2="72" y2="92" /><line x1="50" y1="97" x2="70" y2="97" /><line x1="53" y1="102" x2="67" y2="102" /></g>
        </svg>
    );
}
