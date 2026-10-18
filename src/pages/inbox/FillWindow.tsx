/** Time left in a cross-team fill window; "Expired" once it closed. */

import { formatExact, formatRemaining } from '../../lib/time';
import { ToneStatus } from '../../ui/Status';

export function FillWindow({ expiresAt, now }: { expiresAt?: string; now: number }) {
  if (!expiresAt) return <span className="text-muted">—</span>;
  if (Date.parse(expiresAt) <= now) return <ToneStatus tone="bad">Expired</ToneStatus>;
  const soon = Date.parse(expiresAt) - now < 3_600_000;
  return (
    <span title={`Closes ${formatExact(expiresAt)}`} className={'whitespace-nowrap ' + (soon ? 'font-medium text-ink' : '')}>
      {formatRemaining(expiresAt, now)}
    </span>
  );
}
