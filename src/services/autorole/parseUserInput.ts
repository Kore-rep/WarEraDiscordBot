const WARERA_PROFILE_HOSTS = new Set(['app.warera.io', 'warera.io', 'www.warera.io']);
const HEX24_RE = /^[0-9a-fA-F]{24}$/;

export type ParsedUserInput = { kind: 'id' | 'username'; value: string };

/**
 * Parse a user-supplied WarEra account reference: a username, a user id
 * (numeric or 24-char hex), or a profile URL (with optional locale prefix,
 * e.g. https://app.warera.io/en/user/<id>). Discord's <...> link wrapping is
 * stripped. Returns null for empty input.
 */
export function parseUserInput(raw: string): ParsedUserInput | null {
  let value = (raw || '').trim();
  if (!value) {
    return null;
  }

  if (value.startsWith('<') && value.endsWith('>')) {
    value = value.slice(1, -1).trim();
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value);
      if (WARERA_PROFILE_HOSTS.has(parsed.hostname.toLowerCase())) {
        const parts = parsed.pathname.split('/').filter(p => p.length > 0);
        if (parts.length >= 2 && parts[0].toLowerCase() === 'user' && parts[1].trim()) {
          return { kind: 'id', value: parts[1].trim() };
        }
        if (parts.length >= 3 && parts[1].toLowerCase() === 'user' && parts[2].trim()) {
          return { kind: 'id', value: parts[2].trim() };
        }
      }
    } catch {
      // fall through to id/username handling
    }
  }

  if (/^\d+$/.test(value) || HEX24_RE.test(value)) {
    return { kind: 'id', value };
  }

  return { kind: 'username', value };
}
