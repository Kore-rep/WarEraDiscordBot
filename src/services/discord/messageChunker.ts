/** Discord's hard limit on a single message's content length. */
export const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Split content so each piece fits within Discord's message limit, breaking on
 * line boundaries where possible and hard-splitting any single line that is itself
 * too long. Empty input yields an empty array (nothing to send).
 *
 * This is the single source of truth for message chunking — services should send
 * full content through DiscordService and let it chunk, rather than rolling their own.
 */
export function splitMessage(content: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (content.length === 0) {
    return [];
  }
  if (content.length <= limit) {
    return [content];
  }

  const chunks: string[] = [];
  let current = '';

  for (const line of content.split('\n')) {
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}
