import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  buildMuWeeklyDamageCsv,
  buildUserWeeklyDamageCsv,
  formatWeekEndingDate,
  getCurrentWeekEndingDate,
  listAvailableWeeks,
  parseWeekEndingDate,
  readWeeklySnapshot,
  writeWeeklySnapshot,
} from '../../../src/services/leaderboard/weeklyDamageSnapshotStore';

describe('weeklyDamageSnapshotStore', () => {
  describe('getCurrentWeekEndingDate', () => {
    it('returns today when it is Sunday before 11:02 PM', () => {
      const from = new Date(2026, 5, 28, 22, 0, 0); // Sunday Jun 28 2026 10:00 PM
      expect(getCurrentWeekEndingDate(from)).toBe('2026-06-28');
    });

    it('returns next Sunday when it is Sunday after 11:02 PM', () => {
      const from = new Date(2026, 5, 28, 23, 5, 0); // Sunday Jun 28 2026 11:05 PM
      expect(getCurrentWeekEndingDate(from)).toBe('2026-07-05');
    });

    it('returns coming Sunday when it is mid-week', () => {
      const from = new Date(2026, 5, 24, 12, 0, 0); // Wednesday Jun 24 2026
      expect(getCurrentWeekEndingDate(from)).toBe('2026-06-28');
    });
  });

  describe('formatWeekEndingDate', () => {
    it('formats as YYYY-MM-DD', () => {
      expect(formatWeekEndingDate(new Date(2026, 5, 29, 23, 2, 0))).toBe('2026-06-29');
    });
  });

  describe('parseWeekEndingDate', () => {
    it('accepts valid Sunday dates', () => {
      expect(parseWeekEndingDate('2026-06-29')).not.toBeNull();
    });

    it('rejects invalid dates', () => {
      expect(parseWeekEndingDate('2026-02-30')).toBeNull();
      expect(parseWeekEndingDate('06-29-2026')).toBeNull();
    });
  });

  describe('buildUserWeeklyDamageCsv', () => {
    it('sorts entries by rank and escapes usernames', () => {
      const csv = buildUserWeeklyDamageCsv([
        { id: 'u1', name: 'Alpha', value: 100, level: 25, countryCode: 'US' },
        { id: 'u2', name: 'Beta, Jr.', value: 50, level: 30, countryCode: 'CA' },
      ]);

      expect(csv).toBe(
        [
          'rank,user_id,username,level,country_code,weekly_damage',
          '1,u1,Alpha,25,US,100',
          '2,u2,"Beta, Jr.",30,CA,50',
        ].join('\n')
      );
    });
  });

  describe('buildMuWeeklyDamageCsv', () => {
    it('includes MU columns and escapes names', () => {
      const csv = buildMuWeeklyDamageCsv([
        { id: 'mu1', name: 'Alpha Unit', value: 5000 },
        { id: 'mu2', name: 'Beta, Inc.', value: 2500 },
      ]);

      expect(csv).toBe(
        [
          'rank,mu_id,mu_name,weekly_damage',
          '1,mu1,Alpha Unit,5000',
          '2,mu2,"Beta, Inc.",2500',
        ].join('\n')
      );
    });
  });

  describe('snapshot file storage', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      tempDirs.length = 0;
    });

    it('writes and reads user and MU snapshots separately', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-damage-test-'));
      tempDirs.push(tempRoot);
      const originalCwd = process.cwd();
      process.chdir(tempRoot);

      try {
        const serverId = 'server-1';
        const week = '2026-06-28';

        writeWeeklySnapshot(serverId, 'users', week, 'user,data');
        writeWeeklySnapshot(serverId, 'mu', week, 'mu,data');

        expect(readWeeklySnapshot(serverId, 'users', week)).toBe('user,data');
        expect(readWeeklySnapshot(serverId, 'mu', week)).toBe('mu,data');
        expect(listAvailableWeeks(serverId)).toEqual(['2026-06-28']);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
