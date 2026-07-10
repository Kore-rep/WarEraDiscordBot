/**
 * Deterministic per-member "potential damage" estimate.
 *
 * Direct port of `compute_damage_potential` from the original MU-Directory-Python
 * bot (`src/bot.py`). The magic numbers below (gear stats, pill/battle multipliers,
 * safety margin, the 18h-window pool formula) are WarEra game-mechanics constants
 * and are preserved EXACTLY so leaderboard values match the original bot. Read via
 * `deepGet`/`num` on the raw user object to reproduce the source's null-tolerant
 * `num(deep_get(...), default)` behaviour field-for-field.
 */

export interface DamageInputs {
  pillMode: 'all' | 'sober' | string;
  hpMode: 'full' | 'real' | string;
  gearMode: 'purple' | string;
  timeframe: 'window18h' | string;
  food: 'bread' | 'steak' | 'fish';
  battleBonusPct: number;
}

export interface PurpleGear {
  weaponAttack: number;
  ammoPct: number;
  glovesPrecision: number;
  weaponCrit: number;
  helmetCritDmg: number;
  armorGear: number;
  bootsDodge: number;
}

export interface DamageConfig {
  safetyMargin: number;
  purpleGear: PurpleGear;
}

export const DEFAULT_DAMAGE_INPUTS: DamageInputs = {
  pillMode: 'all',
  hpMode: 'full',
  gearMode: 'purple',
  timeframe: 'window18h',
  food: 'fish',
  battleBonusPct: 70,
};

export const DEFAULT_DAMAGE_CONFIG: DamageConfig = {
  safetyMargin: 0.9,
  purpleGear: {
    weaponAttack: 120,
    ammoPct: 40,
    glovesPrecision: 23,
    weaponCrit: 0,
    helmetCritDmg: 85,
    armorGear: 56,
    bootsDodge: 23,
  },
};

export const FOOD_FACTOR: Record<string, number> = {
  bread: 0.1,
  steak: 0.15,
  fish: 0.2,
};

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Coerce to a finite number, mirroring the Python `num()` helper. */
export function num(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Dotted-path lookup over a plain object, mirroring the Python `deep_get()`. */
export function deepGet(source: unknown, dottedKey: string): unknown {
  let value: unknown = source;
  for (const part of dottedKey.split('.')) {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Estimate a single member's potential damage. `user` is a raw WarEra user object
 * (SDK `UserDTO`); only its `skills` are read.
 */
export function computeDamagePotential(
  user: unknown,
  inputs: DamageInputs = DEFAULT_DAMAGE_INPUTS,
  config: DamageConfig = DEFAULT_DAMAGE_CONFIG
): number {
  const skills = (deepGet(user, 'skills') as Record<string, unknown>) || {};
  const gear = config.purpleGear;
  const isPurple = inputs.gearMode === 'purple';

  const maxHealth = num(deepGet(skills, 'health.value'), 100);
  const maxHunger = Math.trunc(num(deepGet(skills, 'hunger.value'), 100));
  const currentHealth = num(deepGet(skills, 'health.currentBarValue'));
  const currentHunger = Math.trunc(num(deepGet(skills, 'hunger.currentBarValue')));

  const precisionValue = num(deepGet(skills, 'precision.value'));
  const precisionGear = isPurple ? gear.glovesPrecision : num(deepGet(skills, 'precision.equipment'));
  const precisionTotal = clamp(precisionValue + precisionGear, 0, 100);
  const precisionOverflow = Math.max(precisionValue + precisionGear - 100, 0);

  const critChanceValue = num(deepGet(skills, 'criticalChance.value'));
  const critChanceGear = isPurple ? gear.weaponCrit : num(deepGet(skills, 'criticalChance.weapon'));
  const critChanceTotal = clamp(critChanceValue + critChanceGear, 0, 100);
  const critChanceOverflow = Math.max(critChanceValue + critChanceGear - 100, 0);

  const critDamageValue = num(deepGet(skills, 'criticalDamages.value'));
  const critDamageGear = isPurple ? gear.helmetCritDmg : num(deepGet(skills, 'criticalDamages.equipment'));
  const critDamageTotal = critDamageValue + critDamageGear + critChanceOverflow * 4;

  let armorEff: number;
  let dodgeEff: number;
  if (isPurple) {
    const armorRaw = num(deepGet(skills, 'armor.value')) + gear.armorGear;
    armorEff = armorRaw + 40 ? armorRaw / (armorRaw + 40) : 0;
    const dodgeRaw = num(deepGet(skills, 'dodge.value')) + gear.bootsDodge;
    dodgeEff = dodgeRaw + 40 ? dodgeRaw / (dodgeRaw + 40) : 0;
  } else {
    armorEff = num(deepGet(skills, 'armor.totalAfterSoftCap')) / 100;
    dodgeEff = num(deepGet(skills, 'dodge.totalAfterSoftCap')) / 100;
  }

  const attackValue = num(deepGet(skills, 'attack.value'));
  const attackWeapon = isPurple ? gear.weaponAttack : num(deepGet(skills, 'attack.weapon'));
  const baseSum = attackValue + attackWeapon + precisionOverflow * 4;
  const ammoPct = isPurple ? gear.ammoPct : num(deepGet(skills, 'attack.ammoPercent'));
  const ammoMult = 1 + ammoPct / 100;
  const rankMult = 1 + num(deepGet(skills, 'attack.militaryRankPercent')) / 100;

  let pillMult: number;
  if (inputs.pillMode === 'all') {
    pillMult = 1.6;
  } else if (inputs.pillMode === 'sober') {
    pillMult = 1.0;
  } else {
    const buffsPct = num(deepGet(skills, 'attack.buffsPercent'));
    const debuffsPct = num(deepGet(skills, 'attack.debuffsPercent'));
    pillMult = (1 + buffsPct / 100) * (1 - debuffsPct / 100);
  }

  const bonusMult = 1 + num(inputs.battleBonusPct) / 100;
  const attack = baseSum * ammoMult * pillMult * rankMult * bonusMult;

  const critHit = attack * (1 + critDamageTotal / 100);
  const hitChance = precisionTotal / 100;
  const critChance = critChanceTotal / 100;
  const avgDamage =
    hitChance * (attack * (1 - critChance) + critHit * critChance) +
    (1 - hitChance) * (attack * 0.5);

  const foodFactor = FOOD_FACTOR[inputs.food];
  let pool: number;
  if (inputs.timeframe === 'window18h') {
    pool = maxHealth * 1.8 + maxHunger * 1.8 * foodFactor * maxHealth + 10;
  } else if (inputs.hpMode === 'real') {
    pool = currentHealth + currentHunger * foodFactor * maxHealth;
  } else {
    pool = maxHealth + maxHunger * foodFactor * maxHealth + 10;
  }

  const healthPerHit = (100 - clamp(armorEff * 100, 0, 99.99)) / 10;
  const totalHits = pool / healthPerHit / (1 - clamp(dodgeEff, 0, 0.9999));
  return Math.round(totalHits * avgDamage * config.safetyMargin);
}
