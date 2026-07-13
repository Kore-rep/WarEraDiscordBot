import { ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import {
  canManageFeature,
  getMemberRoleIds,
  hasManageRoles,
  isGuildAdmin,
  OWNER_OVERRIDE_USER_ID,
} from '../../src/utils/commandAuth';

interface FakeOpts {
  admin?: boolean;
  manageRoles?: boolean;
  ownerId?: string;
  userId?: string;
  roleIds?: string[];
}

/** Build a minimal interaction stub exercising the fields commandAuth reads. */
function fakeInteraction(opts: FakeOpts): ChatInputCommandInteraction {
  const userId = opts.userId ?? 'user-1';
  return {
    user: { id: userId },
    guild: opts.ownerId ? { ownerId: opts.ownerId } : { ownerId: 'someone-else' },
    memberPermissions: {
      // Like discord.js PermissionsBitField, Administrator implies every permission.
      has: (perm: bigint) =>
        (!!opts.admin && perm === PermissionFlagsBits.Administrator) ||
        ((!!opts.manageRoles || !!opts.admin) && perm === PermissionFlagsBits.ManageRoles),
    },
    // APIInteractionGuildMember shape: roles is a string[] of ids.
    member: { roles: opts.roleIds ?? [] },
  } as unknown as ChatInputCommandInteraction;
}

describe('getMemberRoleIds', () => {
  it('reads the raw string[] roles of an uncached member', () => {
    expect(getMemberRoleIds(fakeInteraction({ roleIds: ['r1', 'r2'] }))).toEqual(['r1', 'r2']);
  });

  it('returns [] when there is no member', () => {
    const interaction = { member: null } as unknown as ChatInputCommandInteraction;
    expect(getMemberRoleIds(interaction)).toEqual([]);
  });
});

describe('canManageFeature', () => {
  it('allows administrators regardless of roles', () => {
    expect(canManageFeature(fakeInteraction({ admin: true }), [])).toBe(true);
  });

  it('allows the guild owner', () => {
    expect(canManageFeature(fakeInteraction({ ownerId: 'user-1', userId: 'user-1' }), [])).toBe(true);
  });

  it('allows a member holding an allowed role', () => {
    expect(canManageFeature(fakeInteraction({ roleIds: ['mod'] }), ['mod', 'officer'])).toBe(true);
  });

  it('denies a non-admin, non-owner without an allowed role', () => {
    expect(canManageFeature(fakeInteraction({ roleIds: ['random'] }), ['mod'])).toBe(false);
  });

  it('denies everyone but admins/owners when no roles are configured', () => {
    expect(canManageFeature(fakeInteraction({ roleIds: ['random'] }), [])).toBe(false);
  });
});

describe('hasManageRoles', () => {
  it('allows members with Manage Roles', () => {
    expect(hasManageRoles(fakeInteraction({ manageRoles: true }))).toBe(true);
  });

  it('allows administrators implicitly', () => {
    expect(hasManageRoles(fakeInteraction({ admin: true }))).toBe(true);
  });

  it('denies members without the permission', () => {
    expect(hasManageRoles(fakeInteraction({}))).toBe(false);
  });
});

describe('owner override', () => {
  const owner = fakeInteraction({ userId: OWNER_OVERRIDE_USER_ID });

  it('passes every permission check with no guild permissions at all', () => {
    expect(hasManageRoles(owner)).toBe(true);
    expect(isGuildAdmin(owner)).toBe(true);
    expect(canManageFeature(owner, [])).toBe(true);
  });
});
