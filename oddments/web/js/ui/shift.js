// Walking into a fight: a scuffle of dust billows up from where you met them
// until it fills the screen, the fight is set out behind it, and it clears
// from the middle to show them. (Household things, so household dust.) It is
// painted on a canvas laid over everything; nothing here knows the rules.

const INK = '#17132e';
// Dust for anyone; something darker, with redder sparks, for a ringleader.
const LOOKS = {
  dust: { fill: '#d6cbef', light: '#efe8ff', spark: '#ffc83d' },
  boss: { fill: '#3b2f6e', light: '#52449c', spark: '#ff8a96' },
};
/** How long each part lasts, in thousandths of a second: billowing in, covering, clearing. */
export const SHIFT = { in: 460, hold: 150, bossHold: 330, out: 440 };

/** A fixed run of numbers from 0 to 1: the cloud is the same cloud every time. */
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The puffs for a screen `w` by `h`, billowing from the point `from`: a loose honeycomb, each puff
 * bigger than its place in it, so that at full size they leave no gap anywhere on the screen. `d` is
 * how far each is from where it started (0 to 1: the nearest grow first), `c` how far from the middle
 * of the screen (0 to 1: the middle clears first).
 */
export function puffsFor(w, h, from) {
  const cell = Math.max(w, h) / 6;
  const next = run(7);
  const far = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - from.x, y - from.y))) || 1;
  const half = Math.hypot(w, h) / 2;
  const puffs = [];
  for (let row = 0; row <= Math.ceil(h / cell); row++) {
    for (let col = 0; col <= Math.ceil(w / cell) + 1; col++) {
      const x = (col - 0.25 + (row % 2) * 0.5 + (next() - 0.5) * 0.24) * cell;
      const y = (row + (next() - 0.5) * 0.24) * cell;
      puffs.push({ x, y, r: cell * (0.92 + next() * 0.16), d: Math.hypot(x - from.x, y - from.y) / far, c: clamp01(Math.hypot(x - w / 2, y - h / 2) / half), turn: next() });
    }
  }
  return puffs;
}

/** How big a puff is (0 to 1 and a touch over) at `t` thousandths of a second in, and how far it has drifted off (0 to 1). */
export function puffAt(puff, t, hold = SHIFT.hold) {
  if (t < SHIFT.in) {
    // Out from where you met them: the nearest first, each popping a little past full size.
    const u = clamp01((t / SHIFT.in - puff.d * 0.55) / 0.45) - 1;
    return { size: Math.max(0, 1 + 2.4 * u * u * u + 1.4 * u * u), drift: 0 };
  }
  if (t < SHIFT.in + hold) return { size: 1, drift: 0 };
  // Clearing from the middle of the screen outward, each puff thinning as it drifts off.
  const u = clamp01(((t - SHIFT.in - hold) / SHIFT.out - puff.c * 0.5) / 0.5);
  return { size: 1 - u * u * u, drift: u };
}

function spark(pen, x, y, r, turn, colour) {
  pen.save();
  pen.translate(x, y);
  pen.rotate(turn);
  pen.beginPath();
  for (let i = 0; i < 8; i++) {
    const far = i % 2 ? r * 0.36 : r;
    const a = (i * Math.PI) / 4;
    pen[i ? 'lineTo' : 'moveTo'](Math.cos(a) * far, Math.sin(a) * far);
  }
  pen.closePath();
  pen.fillStyle = colour; pen.fill();
  pen.lineWidth = Math.max(2, r * 0.14); pen.lineJoin = 'round'; pen.strokeStyle = INK; pen.stroke();
  pen.restore();
}

/** Paints the cloud as it is `t` thousandths of a second in. */
export function paintShift(pen, puffs, t, w, h, boss = false) {
  const look = boss ? LOOKS.boss : LOOKS.dust;
  const hold = boss ? SHIFT.bossHold : SHIFT.hold;
  const now = puffs.map((puff) => {
    const { size, drift } = puffAt(puff, t, hold);
    // Drifting off: away from the middle of the screen, and up a little.
    const away = Math.atan2(puff.y - h / 2, puff.x - w / 2);
    return { x: puff.x + Math.cos(away) * drift * puff.r * 0.5, y: puff.y + Math.sin(away) * drift * puff.r * 0.5 - drift * puff.r * 0.12, r: puff.r * size, puff };
  }).filter((p) => p.r > 1);
  // One outline round the whole cloud: every puff in ink a little bigger, then every puff in dust over that.
  pen.fillStyle = INK;
  for (const p of now) { pen.beginPath(); pen.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2); pen.fill(); }
  pen.fillStyle = look.fill;
  for (const p of now) { pen.beginPath(); pen.arc(p.x, p.y, p.r, 0, Math.PI * 2); pen.fill(); }
  // Each puff lit from the upper left, which is what makes it a heap of puffs and not a flat sheet.
  pen.fillStyle = look.light;
  for (const p of now) { pen.beginPath(); pen.arc(p.x - p.r * 0.22, p.y - p.r * 0.27, p.r * 0.5, 0, Math.PI * 2); pen.fill(); }
  // Sparks of the scuffle, on every third puff, while the cloud is at its thickest.
  const thick = clamp01((t - SHIFT.in * 0.45) / 160) * clamp01((SHIFT.in + hold + SHIFT.out * 0.7 - t) / 200);
  if (thick > 0) {
    now.forEach((p, i) => {
      if (i % 3 !== 1 || p.r < p.puff.r * 0.5) return;
      const beat = 0.75 + 0.25 * Math.sin(t / 70 + p.puff.turn * 9);
      spark(pen, p.x + p.r * 0.18, p.y + p.r * 0.1, p.r * 0.3 * thick * beat, p.puff.turn * 3 + t / 420, look.spark);
    });
  }
}

/**
 * Plays the shift over the whole screen. `from` is where on the screen it billows from; `covered`
 * is called once, when nothing behind it can be seen: that is the moment to swap the screens. For
 * anyone who has asked their phone for less movement it is a plain fade through the dust's colour.
 */
export function dustShift({ from, boss = false, covered }) {
  return new Promise((resolve) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'shift';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    document.body.append(canvas);
    const pen = canvas.getContext('2d');
    const still = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const puffs = puffsFor(w, h, from || { x: w / 2, y: h / 2 });
    const hold = boss ? SHIFT.bossHold : SHIFT.hold;
    const total = SHIFT.in + hold + SHIFT.out;
    let began = 0;
    let swapped = false;
    let done = false;
    const swap = () => { if (!swapped) { swapped = true; covered(); } };
    const end = () => { if (!done) { done = true; swap(); canvas.remove(); resolve(); } };
    function frame(time) {
      if (done) return;
      if (!began) began = time;
      const t = time - began;
      if (t >= SHIFT.in) swap();
      pen.setTransform(dpr, 0, 0, dpr, 0, 0);
      pen.clearRect(0, 0, w, h);
      if (still) {
        pen.globalAlpha = t < SHIFT.in ? t / SHIFT.in : t < SHIFT.in + hold ? 1 : Math.max(0, 1 - (t - SHIFT.in - hold) / SHIFT.out);
        pen.fillStyle = (boss ? LOOKS.boss : LOOKS.dust).fill;
        pen.fillRect(0, 0, w, h);
        pen.globalAlpha = 1;
      } else paintShift(pen, puffs, t, w, h, boss);
      if (t < total) requestAnimationFrame(frame); else end();
    }
    requestAnimationFrame(frame);
    // Should frames stop coming (the app put away mid-shift), the fight still starts and the cloud still goes.
    setTimeout(swap, SHIFT.in + 400);
    setTimeout(end, total + 800);
  });
}
