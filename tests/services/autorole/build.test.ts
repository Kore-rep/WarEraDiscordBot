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
  it('sums eco and war skill levels into percentages', () => {
    const build = analyzeUserBuild(
      skillLevels({ companies: 3, production: 3, attack: 2, dodge: 2, energy: 99 })
    );
    expect(build.ecoPoints).toBe(6);
    expect(build.warPoints).toBe(4);
    expect(build.totalPoints).toBe(10);
    expect(build.ecoPct).toBe(60);
    expect(build.warPct).toBe(40);
  });

  it('handles missing skills and zero totals', () => {
    const build = analyzeUserBuild({});
    expect(build.totalPoints).toBe(0);
    expect(build.ecoPct).toBe(0);
    expect(build.warPct).toBe(0);
  });
});

describe('pickBuildRoleId', () => {
  it('returns no role when no points are spent', () => {
    expect(pickBuildRoleId(config, analyzeUserBuild({}))).toBeUndefined();
  });

  it('picks eco at or above the threshold (boundary inclusive)', () => {
    const build = analyzeUserBuild(skillLevels({ companies: 6, attack: 4 }));
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
