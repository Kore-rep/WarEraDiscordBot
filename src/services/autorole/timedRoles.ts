import { TimedRoleEntry } from '../../config/config';

const MS_PER_DAY = 86_400_000;

/**
 * Roles to strip from a member who has been inactive too long. Removal-only:
 * timed roles are never re-added by sync. An unknown lastConnectionAt means
 * no removals.
 */
export function timedRolesToRemove(
  entries: TimedRoleEntry[],
  memberRoleIds: string[],
  lastConnectionAt: Date | undefined,
  now: Date
): string[] {
  if (!lastConnectionAt) {
    return [];
  }
  const daysSince = (now.getTime() - lastConnectionAt.getTime()) / MS_PER_DAY;
  return entries
    .filter(e => e.timeoutDays > 0 && daysSince >= e.timeoutDays && memberRoleIds.includes(e.roleId))
    .map(e => e.roleId);
}
