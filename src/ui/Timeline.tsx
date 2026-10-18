/**
 * Everything that happened to one request, oldest first. Entries are
 * grouped under their UTC day, and each shows its time to the second
 * (the full timestamp is in the title). The icon follows the kind: request, approval
 * (accent), execution (ok), rejection or failure (bad), anything else
 * (audit lines). Metadata only.
 */

import { Fragment, type ReactNode } from 'react';

import type { TimelineEntry } from '../requests/timeline';
import { formatExact } from '../lib/time';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
import { AgentIcon, ApprovalIcon, AuditIcon, RequestIcon } from './icons';

const ICON: Record<TimelineEntry['kind'], { icon: (cls: string) => ReactNode; tone: string }> = {
  request: { icon: (c) => <RequestIcon size={20} className={c} />, tone: 'text-muted' },
  approval: { icon: (c) => <ApprovalIcon size={20} className={c} />, tone: 'text-accent' },
  reject: { icon: (c) => <ApprovalIcon size={20} className={c} />, tone: 'text-bad' },
  execution: { icon: (c) => <AgentIcon size={20} className={c} />, tone: 'text-ok' },
  'exec-fail': { icon: (c) => <AgentIcon size={20} className={c} />, tone: 'text-bad' },
  reveal: { icon: (c) => <AuditIcon size={20} className={c} />, tone: 'text-accent' },
  system: { icon: (c) => <AuditIcon size={20} className={c} />, tone: 'text-muted' },
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="m-0 list-none px-4 pb-3 pt-1">
      {entries.map((e, i) => {
        const day = dayOf(e.time);
        const newDay = i === 0 || dayOf(entries[i - 1].time) !== day;
        return (
          <Fragment key={e.key}>
            {newDay && day && (
              <li aria-hidden="true" className="pb-1 pl-[34px] pt-3 text-label text-muted">
                {day}
              </li>
            )}
            <li className="relative grid grid-cols-[22px_minmax(0,1fr)_auto] gap-x-3 py-2">
              {i < entries.length - 1 && dayOf(entries[i + 1].time) === day && (
                <span aria-hidden="true" className="absolute bottom-[-8px] left-[10px] top-[30px] w-px bg-border" />
              )}
              <span className="bg-surface">{ICON[e.kind].icon(ICON[e.kind].tone)}</span>
              <div className="min-w-0">
                {e.kind === 'system' ? (
                  // Steps the platform takes on its own: kept, but quieter
                  // than what people and agents did.
                  <p className="m-0 text-ui font-normal text-muted">
                    {e.actor} {e.action}
                  </p>
                ) : (
                  <p className="m-0 text-body text-ink">
                    <span className="font-medium">{e.actor}</span> {e.action}
                  </p>
                )}
                {e.note && <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-ui font-normal text-muted">“{e.note}”</p>}
              </div>
              <time dateTime={e.time} title={formatExact(e.time, true)} className="pt-0.5 font-mono text-mono-small text-muted">
                {timeOf(e.time)}
              </time>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
