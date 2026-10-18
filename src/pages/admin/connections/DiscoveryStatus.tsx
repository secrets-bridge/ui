/**
 * Discovery state of a provider connection: the glyph and word, with
 * when it last ran underneath.
 *
 * "Possibly stale" is derived client-side (EPIC P §5): a run still
 * marked running after twice the interval since it started. The worker
 * sweeper reconciles it; the connection stays usable.
 */

import type { ProviderConnection } from '../../../api/types';
import { formatAge, formatAgo, formatExact } from '../../../lib/time';
import { ToneStatus } from '../../../ui/Status';

export function DiscoveryStatus({ connection: c, now }: { connection: ProviderConnection; now: number }) {
  if (c.status === 'disabled') return <span className="text-muted">Connection disabled</span>;
  if (!c.discover_enabled) return <span className="text-muted">Off</span>;
  const status = c.last_discover_status;

  if (status === 'running') {
    const started = c.last_discover_started_at ? Date.parse(c.last_discover_started_at) : NaN;
    const limitMs = 2 * (c.discover_interval_seconds ?? 0) * 1000;
    const stale = !Number.isNaN(started) && limitMs > 0 && started + limitMs < now;
    return (
      <span className="flex flex-col">
        <ToneStatus tone="warn">{stale ? 'Possibly stale' : 'Running'}</ToneStatus>
        {c.last_discover_started_at && (
          <span
            className="text-caption text-muted"
            title={
              stale
                ? 'Running longer than twice the interval. The worker will reconcile it; the connection is safe to use.'
                : formatExact(c.last_discover_started_at)
            }
          >
            {stale ? 'over 2× the interval' : `for ${formatAge(c.last_discover_started_at, now)}`}
          </span>
        )}
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="flex flex-col">
        <ToneStatus tone="ok">Success</ToneStatus>
        {c.last_discover_at && (
          <span className="text-caption text-muted" title={formatExact(c.last_discover_at)}>
            {formatAgo(c.last_discover_at, now)}
          </span>
        )}
      </span>
    );
  }
  if (status === 'failure') {
    return (
      <span className="flex flex-col">
        <ToneStatus tone="bad">Failure</ToneStatus>
        <span className="max-w-[24ch] truncate text-caption text-muted" title={c.last_discover_error ?? undefined}>
          {c.last_discover_at ? formatAgo(c.last_discover_at, now) : 'recently'}
        </span>
      </span>
    );
  }
  return <span className="text-muted">Not run yet</span>;
}
