/**
 * Small statistics shared by the analyser and the live filter.
 *
 * Its own module because journal.js needs it and learn.js already imports journal.js —
 * putting it in learn.js would make that cycle, and a cycle here would be resolved at
 * import time in whichever order the runtime happened to pick.
 */

/**
 * Wilson score interval — behaves sanely at small n, unlike the normal approximation.
 *
 * The reason it matters for a live filter rather than only for a report: "zero winners"
 * means nothing at two launches and a great deal at a hundred, and a point estimate
 * cannot tell those apart. The interval can.
 */
export function wilson(successes, n, z = 1.96) {
  if (n <= 0) return { p: 0, lo: 0, hi: 1, n: 0 }
  const p = successes / n
  const denom = 1 + (z * z) / n
  const centre = p + (z * z) / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return { p, lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom), n }
}
