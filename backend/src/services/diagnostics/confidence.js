/**
 * Confidence scoring for diagnostic findings (see docs/ARCHITECTURE.md §3).
 *
 *   confidence = 0.5 × persistence + 0.3 × margin + 0.2 × corroboration
 *
 * The score expresses how well the evidence supports the root-cause hypothesis,
 * not whether the threshold was crossed (that is an observed fact).
 */
export const WINDOW = 5;
export const WEIGHTS = { persistence: 0.5, margin: 0.3, corroboration: 0.2 };

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round2 = (n) => Math.round(n * 100) / 100;

/** Fraction of the last WINDOW samples (current included) at or above the warning threshold. */
export function persistence(values, warn) {
  const window = values.slice(-WINDOW);
  const breaching = window.filter((v) => typeof v === 'number' && v >= warn).length;
  return round2(breaching / WINDOW);
}

/** Distance past the warning threshold normalised to the remaining headroom. */
export function margin(value, warn, max = 100) {
  if (max <= warn) return 1;
  return round2(clamp01((value - warn) / (max - warn)));
}

export function score({ persistence: p, margin: m, corroboration: c }) {
  return round2(WEIGHTS.persistence * p + WEIGHTS.margin * m + WEIGHTS.corroboration * c);
}

export const CORROBORATION = { strong: 1, unknown: 0.5, weak: 0.25 };
