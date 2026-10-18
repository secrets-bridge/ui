/**
 * The approvals a request needs, in order, and where each stands. Each
 * lane names who decided (when known), when, and the decider's note.
 */

export interface Lane {
  key: string;
  label: string;
  who: string;
  /** When the decision was made, on its own line under who. */
  when?: string;
  state: 'waiting' | 'approved' | 'rejected' | 'queued' | 'closed';
  stateLabel: string;
  note?: string;
}

const DOT: Record<Lane['state'], { cls: string; mark: string }> = {
  approved: { cls: 'border-ok bg-ok text-surface', mark: '✓' },
  rejected: { cls: 'border-bad bg-bad text-surface', mark: '✕' },
  waiting: { cls: 'border-2 border-warn', mark: '' },
  queued: { cls: 'border-[1.5px] border-edge', mark: '' },
  closed: { cls: 'border-[1.5px] border-edge', mark: '' },
};

export function ApprovalLanes({ lanes }: { lanes: Lane[] }) {
  return (
    <ul className="m-0 list-none py-1.5">
      {lanes.map((l) => (
        <li key={l.key} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 border-t border-rule px-4 py-2.5 text-ui first:border-t-0">
          <span
            aria-hidden="true"
            className={'mt-px box-border inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-semibold ' + DOT[l.state].cls}
          >
            {DOT[l.state].mark}
          </span>
          <div className="min-w-0">
            <p className="m-0 font-semibold text-ink">{l.label}</p>
            <p className="m-0 mt-0.5 break-words font-normal text-muted">{l.who}</p>
            {l.when && <p className="m-0 font-mono text-mono-small text-muted">{l.when}</p>}
            {l.note && <p className="m-0 mt-0.5 font-normal text-ink">“{l.note}”</p>}
          </div>
          <span className="whitespace-nowrap font-normal text-muted">{l.stateLabel}</span>
        </li>
      ))}
    </ul>
  );
}
