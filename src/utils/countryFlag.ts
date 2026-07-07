const REGIONAL_INDICATOR_BASE = 0x1f1e6;

/**
 * Convert an ISO 3166-1 alpha-2 country code to a flag emoji (e.g. "us" -> 🇺🇸).
 */
export function countryCodeToFlagEmoji(code: string | undefined): string {
  if (!code) {
    return '';
  }

  const normalized = code.trim().toUpperCase();
  if (normalized.length !== 2 || !/^[A-Z]{2}$/.test(normalized)) {
    return '';
  }

  return String.fromCodePoint(
    ...normalized.split('').map(char => REGIONAL_INDICATOR_BASE + char.charCodeAt(0) - 65)
  );
}
