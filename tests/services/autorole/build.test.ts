import { analyzeUserBuild, pickBuildRoleId } from '../../../src/services/autorole/build';

const skillLevels = (levels: Record<string, number>) =>
  Object.fromEntries(Object.entries(levels).map(([k, level]) => [k, { level }]));

const config = {
  ecoRoleId: 'eco',
  warRoleId: 'war',
  hybridRoleId: 'hybrid',
  ecoThreshold: 60,
  warThreshold: 60,
};

describe('analyzeUserBuild', () => {
  it('weights skills by points invested, not raw level', () => {
    // eco: companies 3 -> 6 pts, production 3 -> 6 pts (12);
    // war: attack 2 -> 3 pts, dodge 2 -> 3 pts (6).
    const build = analyzeUserBuild(skillLevels({ companies: 3, production: 3, attack: 2, dodge: 2 }));
    expect(build.ecoPoints).toBe(12);
    expect(build.warPoints).toBe(6);
    expect(build.totalPoints).toBe(18);
    expect(build.ecoPct).toBeCloseTo((12 / 18) * 100);
    expect(build.warPct).toBeCloseTo((6 / 18) * 100);
  });

  it('counts energy as eco and health/hunger as war', () => {
    // energy 2 -> 3 pts eco; health 2 -> 3 and hunger 2 -> 3 (6) war.
    const build = analyzeUserBuild(skillLevels({ energy: 2, health: 2, hunger: 2 }));
    expect(build.ecoPoints).toBe(3);
    expect(build.warPoints).toBe(6);
    expect(build.totalPoints).toBe(9);
  });

  it('counts a high-level skill by its full point cost (nonlinear)', () => {
    // production 10 costs 55 points; a level-1 attack costs 1. The eco share is
    // 55/56 ~= 98%, not the 10/11 ~= 91% a raw-level sum would give.
    const build = analyzeUserBuild(skillLevels({ production: 10, attack: 1 }));
    expect(build.ecoPoints).toBe(55);
    expect(build.warPoints).toBe(1);
    expect(build.ecoPct).toBeCloseTo((55 / 56) * 100);
  });

  it('handles missing skills and zero totals', () => {
    const build = analyzeUserBuild({});
    expect(build.totalPoints).toBe(0);
    expect(build.ecoPct).toBe(0);
    expect(build.warPct).toBe(0);
    expect(build.companiesPoints).toBe(0);
    expect(build.companiesPct).toBe(0);
  });

  it('isolates companies spend as a subset of eco', () => {
    // companies 3 -> 6 pts, production 3 -> 6 pts (eco 12); attack 2 -> 3 war.
    const build = analyzeUserBuild(skillLevels({ companies: 3, production: 3, attack: 2 }));
    expect(build.companiesPoints).toBe(6);
    expect(build.ecoPoints).toBe(12);
    expect(build.companiesPct).toBeCloseTo((6 / 15) * 100);
  });
});

describe('pickBuildRoleId', () => {
  it('returns no role when no points are spent', () => {
    expect(pickBuildRoleId(config, analyzeUserBuild({}))).toBeUndefined();
  });

  it('picks eco at or above the threshold (boundary inclusive)', () => {
    // eco 6 pts, war 4 pts -> exactly 60%.
    const build = analyzeUserBuild(skillLevels({ companies: 3, attack: 2, dodge: 1 }));
    expect(build.ecoPct).toBe(60);
    expect(pickBuildRoleId(config, build)).toBe('eco');
  });

  it('picks war when eco misses but war meets its threshold', () => {
    const build = analyzeUserBuild(skillLevels({ companies: 3, attack: 7 }));
    expect(pickBuildRoleId(config, build)).toBe('war');
  });

  it('falls back to hybrid when neither threshold is met', () => {
    const build = analyzeUserBuild(skillLevels({ companies: 5, attack: 5 }));
    expect(pickBuildRoleId(config, build)).toBe('hybrid');
  });

  it('eco wins over war when both thresholds are met', () => {
    const loose = { ...config, ecoThreshold: 40, warThreshold: 40 };
    const build = analyzeUserBuild(skillLevels({ companies: 5, attack: 5 }));
    expect(pickBuildRoleId(loose, build)).toBe('eco');
  });
});
