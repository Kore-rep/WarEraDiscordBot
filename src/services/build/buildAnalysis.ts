/**
 * Shared build analysis: turn a WarEra user's skill levels into eco vs war
 * skill-point totals and percentages. This is the single source of truth for
 * "is this player an eco / war / hybrid build" — used by both the autorole
 * build roles and the `/scanfor country builds` breakdown.
 */

/** Economic skills (production, trade, management). */
export const ECO_SKILLS = ['companies', 'entrepreneurship', 'production', 'management', 'energy'] as const;
/** Combat skills. */
export const WAR_SKILLS = [
  'attack',
  'armor',
  'precision',
  'dodge',
  'criticalChance',
  'criticalDamages',
  'lootChance',
  'health',
  'hunger'
] as const;

/** Minimal skill shape needed for build analysis (structural subset of SkillStatDTO). */
export type SkillLevels = Partial<Record<string, { level: number }>>;

export interface BuildAnalysis {
  /** Skill points invested in eco skills (not the raw level sum). */
  ecoPoints: number;
  /** Skill points invested in war skills. */
  warPoints: number;
  /** ecoPoints + warPoints (every categorized skill counts). */
  totalPoints: number;
  ecoPct: number;
  warPct: number;
}

/**
 * Skill points required to reach a level. WarEra charges 1 point for the first
 * level, 2 for the second, and so on, so reaching level L costs
 * 1 + 2 + … + L = L·(L+1)/2 points. Verified against the live API: summing this
 * over a user's skills equals `leveling.spentSkillPoints`.
 *
 * This is why raw levels must NOT be summed directly — a single level-10 skill
 * (55 points) represents far more investment than ten level-1 skills (10 points).
 */
export function skillPointCost(level: number): number {
  return (level * (level + 1)) / 2;
}

/**
 * Sum eco vs war skill *points invested* and express each as a percentage of the
 * two combined. A user with no eco/war points spent yields 0/0 percentages and
 * totalPoints 0.
 */
export function analyzeUserBuild(skills: SkillLevels): BuildAnalysis {
  const sum = (keys: readonly string[]) =>
    keys.reduce((acc, key) => acc + skillPointCost(skills[key]?.level ?? 0), 0);
  const ecoPoints = sum(ECO_SKILLS);
  const warPoints = sum(WAR_SKILLS);
  const totalPoints = ecoPoints + warPoints;
  return {
    ecoPoints,
    warPoints,
    totalPoints,
    ecoPct: totalPoints > 0 ? (ecoPoints / totalPoints) * 100 : 0,
    warPct: totalPoints > 0 ? (warPoints / totalPoints) * 100 : 0,
  };
}
