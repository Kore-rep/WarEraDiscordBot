import { analyzePlayerBuild, groupPlayersByMode } from '../../../../src/commands/scanFor/country/skillAnalyzer';
import type { ScanUserLite } from '../../../../src/services/scan/ScanService';

const user = (levels: Record<string, number>, level = 30): ScanUserLite =>
  ({
    skills: Object.fromEntries(Object.entries(levels).map(([k, l]) => [k, { level: l }])),
    leveling: { level },
  }) as unknown as ScanUserLite;

describe('analyzePlayerBuild mode classification', () => {
  it('classifies a near-pure war build as war', () => {
    // attack 10 -> 55 war pts, companies 1 -> 1 eco pt => war ~98%.
    expect(analyzePlayerBuild(user({ attack: 10, companies: 1 })).mode).toBe('war');
  });

  it('classifies a near-pure eco build as eco', () => {
    expect(analyzePlayerBuild(user({ production: 10, attack: 1 })).mode).toBe('eco');
  });

  it('classifies war-dominant with mostly-companies eco as soft war', () => {
    // attack 10 -> 55 war (~76%); eco all companies (companies 6 -> 21) => war-dominant,
    // companies is 100% of eco spend, below the 85% pure-war line -> soft war.
    const analysis = analyzePlayerBuild(user({ attack: 10, companies: 6 }));
    expect(analysis.mode).toBe('softwar');
    expect(analysis.dominantMode).toBe('war');
    expect(analysis.companiesPercentage).toBeGreaterThan(0);
  });

  it('classifies war-dominant with diversified eco as a true hybrid', () => {
    // Same war weight, but eco is split companies/production so companies is only
    // half the eco spend -> genuine hybrid, not soft war.
    const analysis = analyzePlayerBuild(user({ attack: 10, companies: 5, production: 5 }));
    expect(analysis.mode).toBe('hybrid');
    expect(analysis.dominantMode).toBe('war');
  });

  it('classifies eco-dominant middle builds as hybrid, never soft war', () => {
    // eco-dominant (companies 8 -> 36 vs attack 6 -> 21) but below pure-eco threshold.
    const analysis = analyzePlayerBuild(user({ companies: 8, attack: 6 }));
    expect(analysis.mode).toBe('hybrid');
    expect(analysis.dominantMode).toBe('eco');
  });
});

describe('groupPlayersByMode', () => {
  it('buckets users into the four build modes', () => {
    const groups = groupPlayersByMode([
      user({ attack: 10, companies: 1 }), // war
      user({ attack: 10, companies: 6 }), // soft war
      user({ attack: 10, companies: 5, production: 5 }), // hybrid
      user({ production: 10, attack: 1 }), // eco
    ]);
    expect(groups.war).toHaveLength(1);
    expect(groups.softwar).toHaveLength(1);
    expect(groups.hybrid).toHaveLength(1);
    expect(groups.eco).toHaveLength(1);
  });
});
