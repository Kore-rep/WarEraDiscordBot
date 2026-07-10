/**
 * Parse a WarEra MU reference (a full `app.warera.io/mu/<id>` link or a bare id)
 * into an id + canonical url. Port of `parse_mu_link` / `build_mu_url` from the
 * original bot, extended to also accept a raw id so the slash command can take
 * either form.
 */

const MU_LINK_PATTERN = /app\.warera\.io\/mu\/([A-Za-z0-9]+)/;
const BARE_ID_PATTERN = /^[A-Za-z0-9]+$/;

export function buildMuUrl(muId: string): string {
  return `https://app.warera.io/mu/${muId}`;
}

export interface ParsedMu {
  id: string;
  url: string;
}

/**
 * @throws Error if the input is neither a recognisable MU link nor a bare id.
 */
export function parseMuInput(input: string): ParsedMu {
  const trimmed = input.trim();

  const match = MU_LINK_PATTERN.exec(trimmed);
  if (match) {
    return { id: match[1], url: buildMuUrl(match[1]) };
  }

  if (BARE_ID_PATTERN.test(trimmed)) {
    return { id: trimmed, url: buildMuUrl(trimmed) };
  }

  throw new Error('That does not look like a WarEra MU link or id.');
}
