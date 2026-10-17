/**
 * Everything that happened to one request, oldest first, with the exact
 * UTC time on each entry. The icon follows the kind: request, approval
 * (accent), execution (ok), rejection or failure (bad), anything else
 * (audit lines). Metadata only.
 */

import type { ReactNode } from 'react';

import type { TimelineEntry } from '../requests/timeline';
import { formatExact } from '../lib/time';
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
    <ol className="m-0 list-none px-4 pb-3 pt-2">
      {entries.map((e, i) => (
        <li key={e.key} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-3 py-2">
          {i < entries.length - 1 && (
            <span aria-hidden="true" className="absolute bottom-[-8px] left-[10px] top-[30px] w-px bg-border" />
          )}
          <span className="bg-surface">{ICON[e.kind].icon(ICON[e.kind].tone)}</span>
          <div className="min-w-0">
            <p className="m-0 text-body font-medium text-ink">
              {e.actor} <span className="font-normal">{e.action}</span>
            </p>
            {e.note && <p className="m-0 text-ui font-normal text-muted">“{e.note}”</p>}
            <time className="mt-0.5 block font-mono text-mono-small text-muted">{formatExact(e.time, true)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
