import { PermissionFlagsBits } from 'discord.js';
import { canManageAutorole, AutoroleInteractionLike } from '../../../src/services/autorole/autoroleAuth';
import { OWNER_OVERRIDE_USER_ID } from '../../../src/utils/commandAuth';

const makeInteraction = (overrides: Partial<AutoroleInteractionLike> = {}): AutoroleInteractionLike => ({
  user: { id: 'user-1' },
  guild: { ownerId: 'owner-1' },
  member: { roles: ['role-a'] },
  memberPermissions: { has: () => false },
  ...overrides,
});

const config = { manageRoleIds: ['staff-role'], manageUserIds: ['staff-user'] };

describe('canManageAutorole', () => {
  it('allows administrators', () => {
    const interaction = makeInteraction({
      memberPermissions: { has: (p: bigint) => p === PermissionFlagsBits.Administrator },
    });
    expect(canManageAutorole(interaction, config)).toBe(true);
  });

  it('allows the guild owner', () => {
    const interaction = makeInteraction({ user: { id: 'owner-1' } });
    expect(canManageAutorole(interaction, config)).toBe(true);
  });

  it('allows configured manage users', () => {
    const interaction = makeInteraction({ user: { id: 'staff-user' } });
    expect(canManageAutorole(interaction, config)).toBe(true);
  });

  it('allows holders of a manage role (raw string[] member)', () => {
    const interaction = makeInteraction({ member: { roles: ['staff-role', 'other'] } });
    expect(canManageAutorole(interaction, config)).toBe(true);
  });

  it('denies everyone else, and everything without config', () => {
    expect(canManageAutorole(makeInteraction(), config)).toBe(false);
    expect(canManageAutorole(makeInteraction(), undefined)).toBe(false);
  });

  it('allows the hardcoded owner override even without config', () => {
    const interaction = makeInteraction({ user: { id: OWNER_OVERRIDE_USER_ID } });
    expect(canManageAutorole(interaction, undefined)).toBe(true);
  });
});
