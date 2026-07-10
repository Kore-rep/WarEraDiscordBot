/**
 * MU ranking-tier score. Direct port of `compute_mu_score` from the original
 * MU-Directory-Python bot: the average of the tier scores across all of the MU's
 * ranking entries. Iterates the rankings object's values dynamically, so any
 * ranking keys the API adds over time are folded in automatically.
 */

export const TIER_SCORES: Record<string, number> = {
  none: 0.0,
  unranked: 0.0,
  bronze: 0.0,
  silver: 2.5,
  gold: 5.0,
  platinum: 7.5,
  diamond: 10.0,
};

export function computeMuScore(mu: unknown): number {
  const rankings = (mu as { rankings?: unknown })?.rankings;
  if (rankings === null || typeof rankings !== 'object') {
    return 0.0;
  }

  const scores: number[] = [];
  for (const ranking of Object.values(rankings as Record<string, unknown>)) {
    if (ranking === null || typeof ranking !== 'object') {
      continue;
    }
    const tier = String((ranking as { tier?: unknown }).tier ?? '')
      .trim()
      .toLowerCase();
    scores.push(TIER_SCORES[tier] ?? 0.0);
  }

  if (scores.length === 0) {
    return 0.0;
  }

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
