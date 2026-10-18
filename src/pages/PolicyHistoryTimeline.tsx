/**
 * R-follow-up #5 §5 D4-D6 — the audit history of one policy rule, shared
 * by the three rule detail pages (project, team, admin).
 *
 * One entry per change, laid out like the request timeline: who did it
 * and with which permission, the exact UTC time, what changed, the
 * state after the change (collapsed), and the correlation id with a
 * copy button. Admin pages also show which kind of rule changed.
 *
 *   - `policy.delete` reads "deleted the rule" and keeps the last state.
 *   - `reconstructed` entries (a rule with no recorded create event,
 *     M6/api#143) read as an initial state, gated on the flag, not on
 *     being the oldest entry (L7).
 *   - Selector keys show as an added/removed set; values never (§6).
 */

import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '../api/client';
import type {
  PolicyRuleFieldChange,
  PolicyRuleHistoryEntry,
  PolicyRuleHistoryResponse,
  PolicyRuleSnapshot,
} from '../api/types';
import { formatExact } from '../lib/time';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { AuditIcon } from '../ui/icons';
import { ANCHOR_LABEL, selectorKeyLabel } from './policies/labels';

interface Props {
  entries: readonly PolicyRuleHistoryEntry[];
  hasMore: boolean;
  limit: number;
  onLoadMore: () => void;
  /** Anchor of the page showing the timeline. Only the admin page
   *  ('platform') labels each entry with the kind of rule. */
  pageScope: 'platform' | 'project' | 'team';
  loadingMore?: boolean;
}

export function PolicyHistoryTimeline({ entries, hasMore, limit, onLoadMore, pageScope, loadingMore }: Props) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">
        No changes recorded yet. Each change to this rule will show here.
      </p>
    );
  }
  return (
    <div>
      <section className="rounded-md border border-border bg-surface" aria-label="Rule history">
        <ol className="m-0 list-none px-4 pb-3 pt-2">
          {entries.map((e, i) => (
            <HistoryRow key={e.event_id} entry={e} showScope={pageScope === 'platform'} last={i === entries.length - 1} />
          ))}
        </ol>
      </section>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {hasMore ? (
          <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore} aria-busy={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load older changes'}
          </Button>
        ) : null}
        <span className="text-caption text-muted">
          {hasMore ? `Showing the latest ${limit}.` : `${entries.length} ${entries.length === 1 ? 'change' : 'changes'}, oldest included.`}
        </span>
      </div>
    </div>
  );
}

/** A history query on a detail page: loading, error with retry, or the timeline. */
export function PolicyHistoryView({
  query,
  onLoadMore,
  pageScope,
}: {
  query: UseQueryResult<PolicyRuleHistoryResponse>;
  onLoadMore: () => void;
  pageScope: 'platform' | 'project' | 'team';
}) {
  if (query.isLoading) return <p className="text-muted">Loading history…</p>;
  if (query.isError || !query.data) {
    return (
      <Banner
        tone="error"
        title="Couldn't load the history."
        action={
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      >
        {query.error instanceof ApiError ? `${query.error.status}: ${query.error.message}` : 'Network error.'}
      </Banner>
    );
  }
  const d = query.data;
  return (
    <PolicyHistoryTimeline
      entries={d.entries}
      hasMore={d.has_more}
      limit={d.limit}
      onLoadMore={onLoadMore}
      pageScope={pageScope}
      loadingMore={query.isFetching}
    />
  );
}

const TONE: Record<PolicyRuleHistoryEntry['action'], string> = {
  'policy.create': 'text-ok',
  'policy.update': 'text-accent',
  'policy.delete': 'text-bad',
};

function verb(e: PolicyRuleHistoryEntry): string {
  if (e.action === 'policy.create') return 'created the rule';
  if (e.action === 'policy.delete') return 'deleted the rule';
  return 'changed the rule';
}

function HistoryRow({ entry: e, showScope, last }: { entry: PolicyRuleHistoryEntry; showScope: boolean; last: boolean }) {
  return (
    <li className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-3 py-2.5">
      {!last && <span aria-hidden="true" className="absolute bottom-[-10px] left-[10px] top-[32px] w-px bg-border" />}
      <span className="bg-surface pt-0.5">
        <AuditIcon size={20} className={TONE[e.action]} />
      </span>
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body font-medium text-ink">
          {e.reconstructed ? (
            <span>Initial state</span>
          ) : (
            <span>
              {e.actor_display} <span className="font-normal">{verb(e)}</span>
            </span>
          )}
          {e.actor_permission_used && (
            <span className="font-mono text-mono-small font-normal text-muted">with {e.actor_permission_used}</span>
          )}
          {showScope && e.scope && (
            <span className="inline-flex h-[18px] items-center rounded-sm border border-border px-[5px] text-[11px] font-medium text-muted">
              {ANCHOR_LABEL[e.scope]} rule
            </span>
          )}
        </p>
        <time dateTime={e.occurred_at} className="mt-0.5 block font-mono text-mono-small text-muted">
          {formatExact(e.occurred_at, true)}
        </time>

        {e.action === 'policy.delete' && (
          <p className="mt-1.5 text-ui font-normal text-muted">The state below is the last one before it was deleted.</p>
        )}
        {e.reconstructed && (
          <p className="mt-1.5 text-ui font-normal text-muted">
            No create event was recorded for this rule (it was seeded or predates the audit trail), so this state comes
            from the rule as it is now.
          </p>
        )}

        {e.changes.length > 0 && (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-ui font-normal">
            {e.changes.map((c) => (
              <ChangeLine key={c.key} change={c} />
            ))}
          </ul>
        )}

        <details className="mt-2 text-ui font-normal">
          <summary className="cursor-pointer text-accent hover:underline">State after this change</summary>
          <Snapshot snapshot={e.snapshot_after} />
        </details>

        <CopyCorrelation id={e.correlation_id} />
      </div>
    </li>
  );
}

function ChangeLine({ change }: { change: PolicyRuleFieldChange }) {
  switch (change.key) {
    case 'priority':
      return <Scalar label="Priority" before={str(change.before)} after={str(change.after)} mono />;
    case 'enabled':
      return <Scalar label="Enabled" before={yesNo(change.before)} after={yesNo(change.after)} />;
    case 'name':
      return <Scalar label="Name" before={str(change.before)} after={str(change.after)} />;
    case 'workflow_id':
      return (
        <Scalar
          label="Workflow"
          before={(change.before_workflow_name as string | undefined) ?? 'a deleted workflow'}
          after={(change.after_workflow_name as string | undefined) ?? 'a deleted workflow'}
        />
      );
    case 'selector_keys':
      return <SelectorKeysChange change={change} />;
  }
}

function Scalar({ label, before, after, mono }: { label: string; before: string; after: string; mono?: boolean }) {
  return (
    <li className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words">
        <del className={'text-muted ' + (mono ? 'font-mono' : '')}>{before}</del>
        <span aria-hidden="true" className="mx-1.5 text-muted">
          →
        </span>
        <span className="sr-only"> changed to </span>
        <span className={'font-medium text-ink ' + (mono ? 'font-mono' : '')}>{after}</span>
      </span>
    </li>
  );
}

function SelectorKeysChange({ change }: { change: PolicyRuleFieldChange }) {
  const before = Array.isArray(change.before) ? (change.before as string[]) : [];
  const after = Array.isArray(change.after) ? (change.after as string[]) : [];
  const removed = before.filter((k) => !after.includes(k));
  const added = after.filter((k) => !before.includes(k));
  const kept = before.filter((k) => after.includes(k));
  const chip = 'inline-flex h-[22px] items-center rounded-sm border px-[7px] text-[12px]';
  return (
    <li className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <span className="text-muted">Matches on</span>
      <span className="flex flex-wrap gap-1.5">
        {kept.map((k) => (
          <span key={`k-${k}`} title={k} className={chip + ' border-border bg-sunken text-ink'}>
            {selectorKeyLabel(k)}
          </span>
        ))}
        {added.map((k) => (
          <span key={`a-${k}`} title={k} className={chip + ' border-ok-line bg-ok-bg text-ok'}>
            <span className="sr-only">Added: </span>+ {selectorKeyLabel(k)}
          </span>
        ))}
        {removed.map((k) => (
          <span key={`r-${k}`} title={k} className={chip + ' border-bad-line bg-bad-bg text-bad line-through'}>
            <span className="sr-only">Removed: </span>
            {selectorKeyLabel(k)}
          </span>
        ))}
        {kept.length + added.length + removed.length === 0 && <span className="text-muted">Every request</span>}
      </span>
    </li>
  );
}

function Snapshot({ snapshot: s }: { snapshot: PolicyRuleSnapshot }) {
  const rows: [string, string][] = [
    ['Name', s.name ?? 'Not recorded'],
    ['Enabled', s.enabled === undefined ? 'Not recorded' : s.enabled ? 'Yes' : 'No'],
    ['Priority', String(s.priority)],
    ['Workflow', s.workflow_name ?? 'A deleted workflow'],
    ['Matches on', s.selector_keys.length ? s.selector_keys.map(selectorKeyLabel).join(', ') : 'Every request'],
  ];
  return (
    <dl className="m-0 mt-2 rounded-md border border-border bg-sunken px-3 py-1">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-1.5 last:border-0">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyCorrelation({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted">
      <span>
        Correlation <span className="font-mono">{id.slice(0, 8)}</span>
      </span>
      <Button
        variant="quiet"
        size="sm"
        aria-label={`Copy correlation id ${id}`}
        onClick={async () => {
          // A correlation id, not a secret: the plain clipboard is fine.
          try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy id'}
      </Button>
    </p>
  );
}

function str(v: unknown): string {
  return v === undefined || v === null ? 'not recorded' : String(v);
}

function yesNo(v: unknown): string {
  if (v === undefined || v === null) return 'not recorded';
  return v ? 'Yes' : 'No';
}
