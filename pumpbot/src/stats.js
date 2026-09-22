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

/**
 * Inverse normal CDF (Acklam's rational approximation, ~1e-9 absolute error).
 *
 * Needed because a sweep tests many alternatives against the same data, and at the usual
 * 1.96 the best of sixteen coin flips looks like a discovery. The critical value has to
 * move with the number of comparisons.
 */
function probit(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) return -probit(1 - p)
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** Two-sided critical value at 5%, Bonferroni-corrected for k comparisons. */
export function criticalZ(k, alpha = 0.05) {
  return probit(1 - alpha / (2 * Math.max(1, k)))
}

