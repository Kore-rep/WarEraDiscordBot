import { computeDamagePotential } from '../../../src/services/muDirectory/damage';

/**
 * Golden values captured by running the fixtures through the original
 * MU-Directory-Python `compute_damage_potential` (with the default purple/all-pilled
 * inputs). These lock the TypeScript port to exact parity with the source bot.
 */
describe('computeDamagePotential', () => {
  it('matches the original bot for a typical member', () => {
    const user = {
      skills: {
        health: { value: 1500, currentBarValue: 1200 },
        hunger: { value: 100, currentBarValue: 80 },
        precision: { value: 60 },
        criticalChance: { value: 30 },
        criticalDamages: { value: 50 },
        armor: { value: 40 },
        dodge: { value: 20 },
        attack: { value: 200, militaryRankPercent: 25 },
      },
    };
    expect(computeDamagePotential(user)).toBe(68622334);
  });

  it('matches the original bot when precision/crit overflow spills over', () => {
    const user = {
      skills: {
        health: { value: 2000 },
        hunger: { value: 120 },
        precision: { value: 90 },
        criticalChance: { value: 95 },
        criticalDamages: { value: 40 },
        armor: { value: 100 },
        dodge: { value: 50 },
        attack: { value: 300, militaryRankPercent: 40 },
      },
    };
    expect(computeDamagePotential(user)).toBe(617252474);
  });

  it('falls back to defaults for empty skills, matching the original bot', () => {
    expect(computeDamagePotential({})).toBe(362349);
    expect(computeDamagePotential({ skills: {} })).toBe(362349);
  });

  it('tolerates null skill values like the source num() helper', () => {
    const user = {
      skills: {
        health: { value: null },
        hunger: { value: null },
        attack: { value: null, militaryRankPercent: null },
      },
    };
    // Same as the empty case: nulls coerce to the defaults (health/hunger 100, rest 0).
    expect(computeDamagePotential(user)).toBe(362349);
  });
});
