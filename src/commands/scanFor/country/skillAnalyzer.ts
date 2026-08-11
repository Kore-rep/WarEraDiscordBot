import type { ScanUserLite } from '../../../services/scan/ScanService';
import { analyzeUserBuild, SkillLevels } from '../../../services/build/buildAnalysis';

type UserDTO = ScanUserLite;

export type BuildMode = 'eco' | 'war' | 'softwar' | 'hybrid';

export interface PlayerAnalysis {
  mode: BuildMode;
  ecoPercentage: number;
  warPercentage: number;
  /** `companies` skill spend as a percentage of the whole build. */
  companiesPercentage: number;
  totalSkillPoints: number;
  ecoSkillPoints: number;
  warSkillPoints: number;
  dominantMode: 'eco' | 'war';
  dominantPercentage: number;
}

/** A player counts as pure eco/war only above this share of their eco+war points. */
const MODE_THRESHOLD = 85;

/**
 * When a war-dominant player falls short of the pure-war threshold, they are a
 * "soft war" build (war + companies for income) rather than a true hybrid if
 * `companies` accounts for at least this share of their eco spend. Anything more
 * diversified across the other eco skills is a genuine hybrid.
 */
const SOFT_WAR_COMPANIES_ECO_SHARE = 0.85;

/**
 * Analyze a player's skill point distribution and determine their build mode.
 * The eco/war point split comes from the shared `analyzeUserBuild`; this adds the
 * `/scanfor`-specific 85% mode classification, plus the soft-war refinement that
 * separates war+companies builds from true hybrids.
 */
export function analyzePlayerBuild(user: UserDTO): PlayerAnalysis {
  const build = analyzeUserBuild((user.skills ?? {}) as SkillLevels);
  const ecoPercentage = build.ecoPct;
  const warPercentage = build.warPct;

  // Determine mode based on the threshold
  let mode: BuildMode;
  let dominantMode: 'eco' | 'war';
  let dominantPercentage: number;

  if (ecoPercentage >= MODE_THRESHOLD) {
    mode = 'eco';
    dominantMode = 'eco';
    dominantPercentage = ecoPercentage;
  } else if (warPercentage >= MODE_THRESHOLD) {
    mode = 'war';
    dominantMode = 'war';
    dominantPercentage = warPercentage;
  } else if (warPercentage >= ecoPercentage) {
    // War-dominant but not pure war: soft war if the eco spend is mostly
    // companies, otherwise a genuine hybrid.
    dominantMode = 'war';
    dominantPercentage = warPercentage;
    const companiesShareOfEco = build.ecoPoints > 0 ? build.companiesPoints / build.ecoPoints : 0;
    mode = companiesShareOfEco >= SOFT_WAR_COMPANIES_ECO_SHARE ? 'softwar' : 'hybrid';
  } else {
    mode = 'hybrid';
    dominantMode = 'eco';
    dominantPercentage = ecoPercentage;
  }

  return {
    mode,
    ecoPercentage: Math.round(ecoPercentage),
    warPercentage: Math.round(warPercentage),
    companiesPercentage: Math.round(build.companiesPct),
    totalSkillPoints: build.totalPoints,
    ecoSkillPoints: build.ecoPoints,
    warSkillPoints: build.warPoints,
    dominantMode,
    dominantPercentage: Math.round(dominantPercentage),
  };
}

export type GroupedUsers = Record<BuildMode, UserDTO[]>;

/**
 * Group players by their build mode
 */
export function groupPlayersByMode(users: UserDTO[]): GroupedUsers {
  const groups: GroupedUsers = {
    eco: [],
    war: [],
    softwar: [],
    hybrid: [],
  };

  users.forEach(user => {
    // Only analyze users with valid data
    if (user && user.skills && user.leveling) {
      const analysis = analyzePlayerBuild(user);
      groups[analysis.mode].push(user);
    }
  });

  return groups;
}

/**
 * Sort users by level in descending order
 */
export function sortUsersByLevel(users: UserDTO[]): UserDTO[] {
  return [...users].sort((a, b) => {
    // Handle nullable leveling data
    const levelA = a.leveling?.level || 0;
    const levelB = b.leveling?.level || 0;
    return levelB - levelA;
  });
}