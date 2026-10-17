/**
 * A terse log of recent events, metadata only: short time (the exact
 * UTC time in the title), who, a short verb and the request ref.
 * `ok` for approvals and successful execution, `bad` for rejections
 * and failures. Approval and execution are separate events.
 */

import { Link } from 'react-router-dom';

export interface ActivityEvent {
  key: string;
  time: string;
  exact: string;
  actor: string;
  verb: string;
  ref?: string;
  to?: string;
  tone?: 'ok' | 'bad' | 'neutral';
}

const DOT = { ok: 'bg-ok', bad: 'bg-bad', neutral: 'bg-edge' };

export function ActivityLog({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {events.map((e) => (
        <li
          key={e.key}
          className="grid grid-cols-[6px_auto_minmax(0,1fr)] items-baseline gap-2.5 border-b border-rule py-2 text-caption"
        >
          <span aria-hidden="true" className={'h-1.5 w-1.5 self-center ' + DOT[e.tone ?? 'neutral']} />
          <time title={e.exact} className="whitespace-nowrap font-mono text-mono-small text-muted">
            {e.time}
          </time>
          <p className="m-0 min-w-0">
            {e.actor} {e.verb}{' '}
            {e.ref && e.to && (
              <Link to={e.to} className="font-mono text-[12px] text-accent hover:underline">
                {e.ref}
              </Link>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
