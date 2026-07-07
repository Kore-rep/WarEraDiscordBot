import type { APIClient } from 'warera-sdk';
import type { RegionResistanceSnapshot } from './spectreBuildingStateStore';

type RegionDTO = Awaited<
  ReturnType<APIClient['region']['getRegionsObject']>
>['result']['data'][string];

export const RESISTANCE_ALERT_RATIO = 0.9;
/** Minimum absolute ratio change (0..1) between polls to report, e.g. 0.1 = 10 percentage points */
export const RESISTANCE_LARGE_CHANGE_DELTA = 0.1;
const RATIO_EPS = 1e-5;

function ratioNear(a: number, b: number): boolean {
  return Math.abs(a - b) < RATIO_EPS;
}

export function buildResistanceSnapshot(region: RegionDTO): RegionResistanceSnapshot | null {
  const max = region.resistanceMax;
  if (max === undefined || max === null || max <= 0) {
    return null;
  }
  const ratio = region.resistance / max;
  return {
    resistance: region.resistance,
    resistanceMax: max,
    ratio,
  };
}

/**
 * Snapshots for all regions owned by `countryId` that have a valid resistance max.
 */
export function buildCountryResistanceSnapshots(
  regions: Map<string, RegionDTO>,
  countryId: string
): Record<string, RegionResistanceSnapshot> {
  const out: Record<string, RegionResistanceSnapshot> = {};
  for (const region of regions.values()) {
    if (region.country !== countryId) {
      continue;
    }
    const snap = buildResistanceSnapshot(region);
    if (snap) {
      out[region._id] = snap;
    }
  }
  return out;
}

/**
 * Human-readable diff lines for resistance monitoring (empty if nothing to report).
 */
export function diffResistanceCountry(
  prev: Record<string, RegionResistanceSnapshot>,
  next: Record<string, RegionResistanceSnapshot>,
  regionNames: Map<string, string>
): string[] {
  const lines: string[] = [];
  const allIds = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const rid of [...allIds].sort()) {
    const p = prev[rid];
    const n = next[rid];
    const name = regionNames.get(rid) || rid;

    if (!n) {
      if (p && p.ratio >= RESISTANCE_ALERT_RATIO) {
        lines.push(
          `**${name}** (\`${rid}\`) — no longer tracked (region lost or resistance max became zero).`
        );
      }
      continue;
    }

    const prevR = p?.ratio ?? -1;
    const curR = n.ratio;
    const hasPrevRatio = p !== undefined;
    const delta = hasPrevRatio ? Math.abs(curR - prevR) : 0;

    const crossed90 = prevR < RESISTANCE_ALERT_RATIO - RATIO_EPS;
    const changedWhileHigh =
      curR >= RESISTANCE_ALERT_RATIO &&
      prevR >= RESISTANCE_ALERT_RATIO - RATIO_EPS &&
      !ratioNear(prevR, curR);
    const report90High = curR >= RESISTANCE_ALERT_RATIO && (crossed90 || changedWhileHigh);

    const reportBelow90 =
      prevR >= RESISTANCE_ALERT_RATIO - RATIO_EPS && curR < RESISTANCE_ALERT_RATIO;

    const reportLargeDelta =
      hasPrevRatio &&
      delta > RESISTANCE_LARGE_CHANGE_DELTA &&
      !reportBelow90 &&
      !report90High;

    if (report90High) {
      const pct = (curR * 100).toFixed(1);
      lines.push(
        `**${name}** (\`${rid}\`) — resistance **${pct}%** (${n.resistance}/${n.resistanceMax})`
      );
    } else if (reportBelow90) {
      const pct = (curR * 100).toFixed(1);
      lines.push(
        `**${name}** (\`${rid}\`) — dropped below 90% (**${pct}%**, ${n.resistance}/${n.resistanceMax})`
      );
    } else if (reportLargeDelta) {
      const prevPct = (prevR * 100).toFixed(1);
      const curPct = (curR * 100).toFixed(1);
      lines.push(
        `**${name}** (\`${rid}\`) — resistance moved **>${(RESISTANCE_LARGE_CHANGE_DELTA * 100).toFixed(0)}%** between polls (${prevPct}% → ${curPct}%, ${n.resistance}/${n.resistanceMax})`
      );
    }
  }

  return lines;
}

/**
 * Human-readable lines for `/spectre snapshot resistance` (latest stored poll per region).
 */
export function formatResistanceSnapshotLines(
  snapshots: Record<string, RegionResistanceSnapshot>,
  regionNames: Map<string, string>
): string[] {
  const lines: string[] = [];
  for (const rid of Object.keys(snapshots).sort()) {
    const s = snapshots[rid];
    const name = regionNames.get(rid) || rid;
    const pct = (s.ratio * 100).toFixed(1);
    lines.push(`**${name}** (\`${rid}\`) — **${pct}%** (${s.resistance}/${s.resistanceMax})`);
  }
  return lines;
}
