export const ECO_SKILLS = ['companies', 'entrepreneurship', 'production', 'management'] as const;
export const WAR_SKILLS = [
  'attack',
  'armor',
  'precision',
  'dodge',
  'criticalChance',
  'criticalDamages',
  'lootChance',
] as const;

/** Minimal skill shape needed for build analysis (structural subset of SkillStatDTO). */
export type SkillLevels = Partial<Record<string, { level: number }>>;

export interface BuildAnalysis {
  ecoPoints: number;
  warPoints: number;
  totalPoints: number;
  ecoPct: number;
  warPct: number;
}

export interface BuildRoleConfig {
  ecoRoleId?: string;
  warRoleId?: string;
  hybridRoleId?: string;
  ecoThreshold: number;
  warThreshold: number;
}

/** Sum eco vs war skill levels and express each as a percentage of the total. */
export function analyzeUserBuild(skills: SkillLevels): BuildAnalysis {
  const sum = (keys: readonly string[]) =>
    keys.reduce((acc, key) => acc + (skills[key]?.level ?? 0), 0);
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

/**
 * Pick the build role for a member: eco if ecoPct meets its threshold, else
 * war likewise, else hybrid. Members with no spent points get no build role.
 */
export function pickBuildRoleId(config: BuildRoleConfig, build: BuildAnalysis): string | undefined {
  if (build.totalPoints <= 0) {
    return undefined;
  }
  if (build.ecoPct >= config.ecoThreshold) {
    return config.ecoRoleId;
  }
  if (build.warPct >= config.warThreshold) {
    return config.warRoleId;
  }
  return config.hybridRoleId;
}
