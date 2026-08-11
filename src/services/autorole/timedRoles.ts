import { TimedRoleEntry } from '../../config/config';
import { isInactive } from '../userTracking/inactivity';

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
  return entries
    .filter(
      e => e.timeoutDays > 0 && isInactive(lastConnectionAt, e.timeoutDays, now) && memberRoleIds.includes(e.roleId)
    )
    .map(e => e.roleId);
}
