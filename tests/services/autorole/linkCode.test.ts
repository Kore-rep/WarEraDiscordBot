import { generateLinkCode, isVerificationExpired, LINK_CODE_TTL_MS } from '../../../src/services/autorole/linkCode';

describe('generateLinkCode', () => {
  it('always produces six digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateLinkCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('isVerificationExpired', () => {
  const now = new Date('2026-07-11T00:00:00Z');

  it('is not expired before the deadline', () => {
    expect(isVerificationExpired(new Date(now.getTime() + 1000), now)).toBe(false);
  });

  it('is expired at and after the deadline', () => {
    expect(isVerificationExpired(now, now)).toBe(true);
    expect(isVerificationExpired(new Date(now.getTime() - 1), now)).toBe(true);
  });

  it('TTL constant is 15 minutes', () => {
    expect(LINK_CODE_TTL_MS).toBe(900_000);
  });
});
