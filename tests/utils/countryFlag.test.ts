import { countryCodeToFlagEmoji } from '../../src/utils/countryFlag';

describe('countryCodeToFlagEmoji', () => {
  it('converts lowercase ISO codes to flag emojis', () => {
    expect(countryCodeToFlagEmoji('us')).toBe('🇺🇸');
    expect(countryCodeToFlagEmoji('gb')).toBe('🇬🇧');
    expect(countryCodeToFlagEmoji('fr')).toBe('🇫🇷');
  });

  it('returns empty string for invalid codes', () => {
    expect(countryCodeToFlagEmoji(undefined)).toBe('');
    expect(countryCodeToFlagEmoji('')).toBe('');
    expect(countryCodeToFlagEmoji('usa')).toBe('');
  });
});
