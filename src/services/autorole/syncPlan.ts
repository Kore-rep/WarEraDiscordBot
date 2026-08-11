import { AutoroleConfig, MilitaryUnitEntry } from '../../config/config';
import { analyzeUserBuild, pickBuildRoleId, SkillLevels } from './build';
import { getBestRoleForLevel } from './levelRoles';
import { timedRolesToRemove } from './timedRoles';
import { computeNickname } from './nickname';
import { isInactive } from '../userTracking/inactivity';

/** The slice of a WarEra user profile the sync needs. */
export interface SyncUserView {
  username: string;
  level: number;
  muId?: string;
  skills: SkillLevels;
  lastConnectionAt?: Date;
}

/** Everything the plan needs beyond the member's own state. */
export interface MemberSyncContext {
  cfg: AutoroleConfig;
  /** The shared MU list; entries with a roleId are the autorole mappings. */
  militaryUnits: MilitaryUnitEntry[];
  /** Whether OPSEC has already been revoked for this member (sync then leaves it alone). */
  opsecRevoked: boolean;
  now: Date;
}

export interface MemberSyncPlan {
  rolesToAdd: string[];
  rolesToRemove: string[];
  /** Set only when the nickname should change. */
  desiredNickname?: string;
  /** Member is not in any MU mapped to a role in config (candidate for the no-MU DM). */
  needsMuNotice: boolean;
  /** The mapped MU entry, if any (for status output). */
  muEntry?: MilitaryUnitEntry;
  /** OPSEC was just revoked for inactivity — persist LinkedUser.opsecRevoked = true. */
  revokeOpsec: boolean;
}

/**
 * Compute the full role/nickname diff for one linked member: level role
 * (highest qualifying minLevel wins), build role (eco/war/hybrid by skill
 * percentages), MU role (shared-list mapping by the user's MU id), timed
 * inactivity removals, and the OPSEC role. Roles in `protectedRoleIds` are
 * never removed, and a role that one facet wants to add is never simultaneously
 * removed by another.
 *
 * OPSEC is handled outside the generic managed/target sets: it is granted once
 * at `opsecMinLevel` unless the member holds `opsecExceptionRoleId`, removed on
 * inactivity, and — once revoked — left entirely to manual control
 * (`opsecRevoked`), so it is neither auto re-added nor auto-stripped again.
 */
export function computeMemberSyncPlan(
  user: SyncUserView,
  memberRoleIds: string[],
  currentNickname: string | null,
  ctx: MemberSyncContext
): MemberSyncPlan {
  const { cfg, militaryUnits, opsecRevoked, now } = ctx;
  const targets: (string | undefined)[] = [];
  const managed = new Set<string>();

  for (const entry of cfg.levelRoles) {
    managed.add(entry.roleId);
  }
  targets.push(getBestRoleForLevel(cfg.levelRoles, user.level));

  for (const roleId of [cfg.ecoRoleId, cfg.warRoleId, cfg.hybridRoleId]) {
    if (roleId) {
      managed.add(roleId);
    }
  }
  targets.push(pickBuildRoleId(cfg, analyzeUserBuild(user.skills)));

  // The "unlinked" role is only for members with no link — a member reaching
  // this plan is linked, so it is managed (removed) but never targeted.
  if (cfg.unlinkedRoleId) {
    managed.add(cfg.unlinkedRoleId);
  }
  // The "linked" role is the inverse: every member reaching this plan is linked,
  // so it is always a target (granted and kept). Removal happens on unlink.
  if (cfg.linkedRoleId) {
    targets.push(cfg.linkedRoleId);
  }

  const muEntry = user.muId ? militaryUnits.find(e => e.muId === user.muId && e.roleId) : undefined;
  for (const entry of militaryUnits) {
    if (entry.roleId) {
      managed.add(entry.roleId);
    }
  }
  targets.push(muEntry?.roleId);

  const targetSet = new Set(targets.filter((id): id is string => !!id));
  const protectedSet = new Set(cfg.protectedRoleIds);
  const memberSet = new Set(memberRoleIds);

  const timedRemovals = timedRolesToRemove(cfg.timedRoles, memberRoleIds, user.lastConnectionAt, now);

  const rolesToAdd = [...targetSet].filter(id => !memberSet.has(id));
  const rolesToRemove = [...new Set([...managed, ...timedRemovals])].filter(
    id => memberSet.has(id) && !targetSet.has(id) && !protectedSet.has(id)
  );

  // OPSEC is deliberately excluded from the generic sets above. It is granted
  // once at level, revoked on inactivity, and hands-off once revoked.
  let revokeOpsec = false;
  const opsecRoleId = cfg.opsecRoleId;
  if (opsecRoleId && !opsecRevoked) {
    const hasOpsec = memberSet.has(opsecRoleId);
    const hasOpsecException = !!cfg.opsecExceptionRoleId && memberSet.has(cfg.opsecExceptionRoleId);
    const inactive = isInactive(user.lastConnectionAt, cfg.opsecInactivityDays, now);
    if (hasOpsec && inactive) {
      if (!rolesToRemove.includes(opsecRoleId)) {
        rolesToRemove.push(opsecRoleId);
      }
      revokeOpsec = true;
    } else if (
      cfg.opsecAutoApply !== false &&
      !hasOpsecException &&
      !hasOpsec &&
      !inactive &&
      user.level >= cfg.opsecMinLevel
    ) {
      // Auto-application can be disabled globally or skipped for members holding
      // the exception role; inactivity revocation above remains unaffected.
      if (!rolesToAdd.includes(opsecRoleId)) {
        rolesToAdd.push(opsecRoleId);
      }
    }
  }

  const plan: MemberSyncPlan = {
    rolesToAdd,
    rolesToRemove,
    needsMuNotice: !muEntry,
    muEntry,
    revokeOpsec,
  };

  if (cfg.syncNicknames !== false) {
    const desired = computeNickname(user.username, muEntry?.muName);
    if (desired !== currentNickname) {
      plan.desiredNickname = desired;
    }
  }

  return plan;
}
