/**
 * A terse log of recent events, metadata only: the short time on its
 * own line (the exact UTC time in the title), then who, a short verb
 * and the request ref, which never breaks across lines.
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
        <li key={e.key} className="grid grid-cols-[6px_minmax(0,1fr)] gap-x-2.5 border-b border-rule py-2 text-caption">
          <span aria-hidden="true" className={'mt-[5px] h-1.5 w-1.5 ' + DOT[e.tone ?? 'neutral']} />
          <div className="min-w-0">
            <time title={e.exact} className="block whitespace-nowrap font-mono text-mono-small leading-4 text-muted">
              {e.time}
            </time>
            <p className="m-0 mt-0.5 min-w-0 text-ink">
              <span className={/^REQ-/.test(e.actor) ? 'whitespace-nowrap font-mono text-[12px]' : ''}>{e.actor}</span> {e.verb}
              {e.ref && e.to && (
                <>
                  {' '}
                  <Link to={e.to} className="whitespace-nowrap font-mono text-[12px] text-accent hover:underline">
                    {e.ref}
                  </Link>
                </>
              )}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
