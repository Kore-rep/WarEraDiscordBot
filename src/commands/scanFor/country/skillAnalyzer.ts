import type { ScanUserLite } from '../../../services/scan/ScanService';

type UserDTO = ScanUserLite;
type SkillStatDTO = UserDTO['skills'][keyof UserDTO['skills']];

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

/**
 * Skill categorization based on their primary use
 * Note: 'management' skill mentioned in requirements doesn't exist in API
 */
export const SKILL_CATEGORIES = {
  eco: ['energy', 'companies', 'entrepreneurship', 'production'] as const,
  war: ['attack', 'criticalChance', 'criticalDamages', 'armor', 'precision', 'dodge', 'lootChance'] as const,
  utility: ['health', 'hunger'] as const,
} as const;

/**
 * Calculate skill points required for a given skill level
 * Formula: Sum from 1 to level = level * (level + 1) / 2
 * Example: Level 7 = 1+2+3+4+5+6+7 = 28 points
 */
export function calculateSkillPoints(level: number): number {
  return level * (level + 1) / 2;
}

/**
 * Get the skill category for a given skill name
 */
export function getSkillCategory(skillName: string): 'eco' | 'war' | 'utility' | null {
  if (SKILL_CATEGORIES.eco.includes(skillName as any)) return 'eco';
  if (SKILL_CATEGORIES.war.includes(skillName as any)) return 'war';
  if (SKILL_CATEGORIES.utility.includes(skillName as any)) return 'utility';
  return null;
}

/**
 * Analyze a player's skill point distribution and determine their build mode
 */
export function analyzePlayerBuild(user: UserDTO): PlayerAnalysis {
  let ecoSkillPoints = 0;
  let warSkillPoints = 0;
  let totalRelevantPoints = 0;

  // Handle nullable skills object
  if (user.skills) {
    // Calculate skill points for each skill category
    Object.entries(user.skills).forEach(([skillName, skillData]: [string, SkillStatDTO]) => {
      // Handle nullable skill data and level
      if (skillData && typeof skillData.level === 'number') {
        const category = getSkillCategory(skillName);
        const skillPoints = calculateSkillPoints(skillData.level);

        if (category === 'eco') {
          ecoSkillPoints += skillPoints;
          totalRelevantPoints += skillPoints;
        } else if (category === 'war') {
          warSkillPoints += skillPoints;
          totalRelevantPoints += skillPoints;
        }
        // Utility skills are excluded from mode calculation
      }
    });
  }

  // Calculate percentages
  const ecoPercentage = totalRelevantPoints > 0 ? (ecoSkillPoints / totalRelevantPoints) * 100 : 0;
  const warPercentage = totalRelevantPoints > 0 ? (warSkillPoints / totalRelevantPoints) * 100 : 0;

  // Determine mode based on 85% threshold
  let mode: 'eco' | 'war' | 'hybrid';
  let dominantMode: 'eco' | 'war';
  let dominantPercentage: number;

  if (ecoPercentage >= 85) {
    mode = 'eco';
    dominantMode = 'eco';
    dominantPercentage = ecoPercentage;
  } else if (warPercentage >= 85) {
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
    totalSkillPoints: totalRelevantPoints,
    ecoSkillPoints,
    warSkillPoints,
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