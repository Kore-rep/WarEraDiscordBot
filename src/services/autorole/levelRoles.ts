import { LevelRoleEntry } from '../../config/config';

/** Pick the level role with the highest minLevel the member qualifies for. */
export function getBestRoleForLevel(entries: LevelRoleEntry[], level: number): string | undefined {
  let best: LevelRoleEntry | undefined;
  for (const entry of entries) {
    if (entry.minLevel <= level && (!best || entry.minLevel > best.minLevel)) {
      best = entry;
    }
  }
  return best?.roleId;
}
