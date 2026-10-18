/**
 * Times in the console are UTC and say so (handoff: timeline and
 * activity must be exact and unambiguous). Short forms carry the exact
 * time in a title so a hover or a screen reader can get it.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

/** "17 Oct 2026, 11:02 UTC", with seconds when asked. */
export function formatExact(iso: string | null | undefined, seconds = false): string {
  const d = parse(iso);
  if (!d) return '—';
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${time} UTC`;
}

/** "11:20" today (UTC), else "16 Oct 11:20". */
export function formatShort(iso: string | null | undefined, now = Date.now()): string {
  const d = parse(iso);
  if (!d) return '—';
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const today = new Date(now);
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  return sameDay ? hm : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hm}`;
}

/** "12:17 UTC". */
export function formatClock(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return '—';
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Elapsed time: "now", "9m", "1h 49m", "2d". */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  const d = parse(iso);
  if (!d) return '—';
  const m = Math.max(0, Math.floor((now - d.getTime()) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Whole minutes until `iso`, never negative. */
export function minutesUntil(iso: string | null | undefined, now = Date.now()): number {
  const d = parse(iso);
  if (!d) return 0;
  return Math.max(0, Math.round((d.getTime() - now) / 60000));
}

/** True when `iso` is within the last `days` days. */
export function withinDays(iso: string | null | undefined, days: number, now = Date.now()): boolean {
  const d = parse(iso);
  return !!d && now - d.getTime() <= days * 86_400_000;
}

/** Time left until `iso`: "47m left", "3h 12m left", "6d 23h left". */
export function formatRemaining(iso: string | null | undefined, now = Date.now()): string {
  const m = minutesUntil(iso, now);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m left` : `${h}h left`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h left` : `${d}d left`;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  const age = formatAge(iso, now);
  if (age === 'now') return 'just now';
  return age === '—' ? age : `${age} ago`;
}
