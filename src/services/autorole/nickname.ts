const DISCORD_NICKNAME_LIMIT = 32;

/**
 * Desired nickname for a linked member: "<username> (<MU name>)", or
 * "<username> (TBD)" when they're not in a mapped MU, clamped to Discord's
 * 32-character nickname limit.
 */
export function computeNickname(username: string, muName: string | undefined): string {
  return `${username} (${muName ?? 'TBD'})`.slice(0, DISCORD_NICKNAME_LIMIT);
}
