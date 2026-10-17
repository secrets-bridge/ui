/**
 * Small formatters shared by the roles, assignments and workflows admin
 * pages.
 */

import { ApiError } from '../../../api/client';
import type { Team } from '../../../api/teams';

/** Seconds as words: "5 minutes", "1 hour", "7 days", "1 day 6 hours". */
export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  const units: [number, string][] = [
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  const parts: string[] = [];
  let rest = s;
  for (const [size, name] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${name}${n === 1 ? '' : 's'}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

export interface IndentedTeamOption {
  team: Team;
  indentedLabel: string;
}

/**
 * The flat team list in tree order, each label prefixed by its depth,
 * so a plain <select> shows the hierarchy. Teams whose parent is
 * missing become roots so they stay pickable.
 */
export function buildIndentedTeams(all: Team[]): IndentedTeamOption[] {
  const ids = new Set(all.map((t) => t.id));
  const byParent = new Map<string | null, Team[]>();
  for (const t of all) {
    const parent = t.parent_team_id && ids.has(t.parent_team_id) ? t.parent_team_id : null;
    const bucket = byParent.get(parent) ?? [];
    bucket.push(t);
    byParent.set(parent, bucket);
  }
  const sorted = (arr: Team[]) => [...arr].sort((a, b) => a.name.localeCompare(b.name));
  const out: IndentedTeamOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of sorted(byParent.get(parent) ?? [])) {
      const prefix = depth === 0 ? '' : '· '.repeat(depth);
      const archived = t.status === 'archived' ? ' (archived)' : '';
      out.push({ team: t, indentedLabel: `${prefix}${t.name}${archived}` });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** "401: message" for an api error, the message otherwise. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
