/* Deterministic RNG (mulberry32). Seed lives in GameState so the whole
   engine is pure and reproducible — essential for headless balance sims. */

export function nextFloat(state: { rng: number }): number {
    state.rng = (state.rng + 0x6d2b79f5) | 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(state: { rng: number }, n: number): number {
    return Math.floor(nextFloat(state) * n);
}

export function shuffle<T>(state: { rng: number }, arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = rngInt(state, i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
