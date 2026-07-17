import { BuildAnalysis } from '../build/buildAnalysis';

// Build analysis itself is shared with `/scanfor country builds`; this file only
// adds the autorole-specific mapping from an analysis to a configured role.
export { ECO_SKILLS, WAR_SKILLS, analyzeUserBuild, skillPointCost } from '../build/buildAnalysis';
export type { SkillLevels, BuildAnalysis } from '../build/buildAnalysis';

export interface BuildRoleConfig {
  ecoRoleId?: string;
  warRoleId?: string;
  hybridRoleId?: string;
  ecoThreshold: number;
  warThreshold: number;
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
