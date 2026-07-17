import { AutoroleConfig, MuRoleEntry } from '../../config/config';
import { analyzeUserBuild, pickBuildRoleId, SkillLevels } from './build';
import { getBestRoleForLevel } from './levelRoles';
import { timedRolesToRemove } from './timedRoles';
import { computeNickname } from './nickname';

/** The slice of a WarEra user profile the sync needs. */
export interface SyncUserView {
  username: string;
  level: number;
  muId?: string;
  skills: SkillLevels;
  lastConnectionAt?: Date;
}

export interface MemberSyncPlan {
  rolesToAdd: string[];
  rolesToRemove: string[];
  /** Set only when the nickname should change. */
  desiredNickname?: string;
  /** Member is not in any MU mapped in config (candidate for the no-MU DM). */
  needsMuNotice: boolean;
  /** The mapped MU entry, if any (for status output). */
  muEntry?: MuRoleEntry;
}

/**
 * Compute the full role/nickname diff for one linked member: level role
 * (highest qualifying minLevel wins), build role (eco/war/hybrid by skill
 * percentages), MU role (config mapping by the user's MU id), and timed
 * inactivity removals. Roles in `protectedRoleIds` are never removed, and a
 * role that one facet wants to add is never simultaneously removed by another.
 */
export function computeMemberSyncPlan(
  user: SyncUserView,
  memberRoleIds: string[],
  currentNickname: string | null,
  cfg: AutoroleConfig,
  now: Date
): MemberSyncPlan {
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

  const muEntry = user.muId ? cfg.muRoles.find(e => e.muId === user.muId) : undefined;
  for (const entry of cfg.muRoles) {
    managed.add(entry.roleId);
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

  const plan: MemberSyncPlan = {
    rolesToAdd,
    rolesToRemove,
    needsMuNotice: !muEntry,
    muEntry,
  };

  if (cfg.syncNicknames !== false) {
    const desired = computeNickname(user.username, muEntry?.muName);
    if (desired !== currentNickname) {
      plan.desiredNickname = desired;
    }
  }

  return plan;
}
