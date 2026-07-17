import type { ScanUserLite } from '../../../services/scan/ScanService';
import { analyzeUserBuild, SkillLevels } from '../../../services/build/buildAnalysis';

type UserDTO = ScanUserLite;

export interface PlayerAnalysis {
  mode: 'eco' | 'war' | 'hybrid';
  ecoPercentage: number;
  warPercentage: number;
  totalSkillPoints: number;
  ecoSkillPoints: number;
  warSkillPoints: number;
  dominantMode: 'eco' | 'war';
  dominantPercentage: number;
}

/** A player counts as pure eco/war only above this share of their eco+war points. */
const MODE_THRESHOLD = 85;

/**
 * Analyze a player's skill point distribution and determine their build mode.
 * The eco/war point split comes from the shared `analyzeUserBuild`; this adds the
 * `/scanfor`-specific 85% mode classification on top.
 */
export function analyzePlayerBuild(user: UserDTO): PlayerAnalysis {
  const build = analyzeUserBuild((user.skills ?? {}) as SkillLevels);
  const ecoPercentage = build.ecoPct;
  const warPercentage = build.warPct;

  // Determine mode based on the threshold
  let mode: 'eco' | 'war' | 'hybrid';
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
  } else {
    mode = 'hybrid';
    if (ecoPercentage >= warPercentage) {
      dominantMode = 'eco';
      dominantPercentage = ecoPercentage;
    } else {
      dominantMode = 'war';
      dominantPercentage = warPercentage;
    }
  }

  return {
    mode,
    ecoPercentage: Math.round(ecoPercentage),
    warPercentage: Math.round(warPercentage),
    totalSkillPoints: build.totalPoints,
    ecoSkillPoints: build.ecoPoints,
    warSkillPoints: build.warPoints,
    dominantMode,
    dominantPercentage: Math.round(dominantPercentage),
  };
}

/**
 * Group players by their build mode
 */
export function groupPlayersByMode(users: UserDTO[]): {
  eco: UserDTO[];
  war: UserDTO[];
  hybrid: UserDTO[];
} {
  const groups = {
    eco: [] as UserDTO[],
    war: [] as UserDTO[],
    hybrid: [] as UserDTO[],
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