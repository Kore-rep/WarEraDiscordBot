/**
 * Renders the MU directory as a single markdown string (INFO / MU's / LEADERBOARD).
 * Port of `render_directory_lines` from the original MU-Directory-Python bot, minus
 * the chunking — DiscordService owns splitting into ≤2000-char messages. The footer
 * line is adapted to the new slash-command controls.
 */

export interface MuDirectoryEntry {
  name: string;
  url: string;
  hqLevel: number;
  dormsLevel: number;
  commanders: string[];
  score: number;
  potentialDamage: number;
}

export function formatLevel(level: unknown): number {
  const n = typeof level === 'number' ? level : Number(level);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function formatScore(score: unknown): string {
  const n = typeof score === 'number' ? score : Number(score);
  return Number.isFinite(n) ? n.toFixed(1) : '0.0';
}

export function formatDamage(damage: unknown): string {
  const n = typeof damage === 'number' ? damage : Number(damage);
  return Number.isFinite(n) ? Math.trunc(n).toLocaleString('en-US') : '0';
}

export function formatCommanders(commanders: string[] | undefined): string {
  if (!Array.isArray(commanders) || commanders.length === 0) {
    return 'Unknown';
  }
  return commanders.map(c => String(c)).join(', ');
}

export function renderDirectory(entries: MuDirectoryEntry[]): string {
  const lines: string[] = [
    '**INFO**',
    '> Score: average ranking tier score across MU rankings. Bronze 0, Silver 2.5, Gold 5, Platinum 7.5, Diamond 10.',
    '> Potential Damage: estimated member damage using full/purple gear, all pilled, 18h window, fish food, 70% battle bonus, and a 0.9 safety margin.',
    '> Use `/mudirectory add` and `/mudirectory remove` to manage this list.',
    '',
    "**MU's**",
  ];

  if (entries.length === 0) {
    lines.push('No MUs saved yet.');
  }

  for (const mu of entries) {
    lines.push(
      '',
      `> **[${mu.name}](<${mu.url}>)**`,
      `> HQ: ${formatLevel(mu.hqLevel)}/4`,
      `> Dorms: ${formatLevel(mu.dormsLevel)}/5`,
      `> Commanders: ${formatCommanders(mu.commanders)}`
    );
  }

  lines.push('', '**LEADERBOARD + STATS**');

  if (entries.length === 0) {
    lines.push('No leaderboard entries yet.');
  }

  const leaderboard = [...entries].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.potentialDamage - a.potentialDamage;
  });

  lines.push('> MU NAME - Score - Potential Damage (Estimation. Check with commanders first)');

  leaderboard.forEach((mu, index) => {
    lines.push(
      `> ${index + 1}. **${mu.name}** - ${formatScore(mu.score)} - ${formatDamage(mu.potentialDamage)}`
    );
  });

  return lines.join('\n');
}
