import { randomInt } from 'crypto';

export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/** Six random digits (leading zeros allowed) for company-rename verification. */
export function generateLinkCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function isVerificationExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}
