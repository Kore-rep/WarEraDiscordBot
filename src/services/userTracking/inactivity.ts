const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Shared WarEra inactivity math, computed from `user.dates.lastConnectionAt`.
 * Used by the `/user` tracking feature, the tracking scheduler, and autorole's
 * timed-role and OPSEC removals so there is a single definition of "inactive".
 */

/**
 * Fractional days elapsed since the user's last connection, or `undefined` when
 * the timestamp is missing/invalid. Callers that display "N days ago" should
 * `Math.floor` this value.
 */
export function daysSinceLastConnection(
  lastConnectionAt: Date | string | undefined,
  now: Date
): number | undefined {
  if (lastConnectionAt === undefined) {
    return undefined;
  }
  const last = lastConnectionAt instanceof Date ? lastConnectionAt : new Date(lastConnectionAt);
  if (isNaN(last.getTime())) {
    return undefined;
  }
  return (now.getTime() - last.getTime()) / MS_PER_DAY;
}

/**
 * Whether the user has been inactive for at least `thresholdDays`. An unknown
 * last-connection time counts as "not inactive" (we never act on missing data).
 */
export function isInactive(
  lastConnectionAt: Date | string | undefined,
  thresholdDays: number,
  now: Date
): boolean {
  const days = daysSinceLastConnection(lastConnectionAt, now);
  return days !== undefined && days >= thresholdDays;
}
