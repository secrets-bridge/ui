/**
 * R-follow-up #5 §5 D4-D6 — Shared timeline component for the policy
 * rule audit history view. Used by all 3 Detail pages
 * (project / team / admin).
 *
 * Renders one card per `PolicyRuleHistoryEntry`:
 *   - Header line: actor_display · occurred_at · action pill
 *   - Permission badge (`via policy.author` | `via policy.edit`)
 *   - Scope badge (only when ruleScope='platform' — i.e. admin context
 *     looking at a per-anchor rule)
 *   - Changes block (only on update events)
 *   - Collapsed snapshot expander
 *   - Correlation footer with copy-clipboard
 *
 * `policy.delete` → terminal "Deleted on T by X" row with the prior
 * snapshot inlined (services.PolicyHistoryService already carries the
 * last-known snapshot for delete events per §3 D3 step 5).
 *
 * `reconstructed` entries (the synthesized initial snapshot for rules
 * with zero audit events — M6/api#143) → "Initial snapshot observed" UX.
 * Gated on the `reconstructed` flag, NOT on chain-head position, so a
 * genuine `policy.create` event keeps its normal "created" copy (L7).
 *
 * §6 selector lock preserved — `selector_keys` rendered as set-diff
 * chips; values NEVER displayed.
 */

import { useState } from 'react';

import type {
  PolicyRuleFieldChange,
  PolicyRuleHistoryEntry,
  PolicyRuleSnapshot,
} from '../api/types';
import { Card, CardBody } from '../ui/Card';

interface Props {
  entries: readonly PolicyRuleHistoryEntry[];
  hasMore: boolean;
  limit: number;
  onLoadMore: () => void;
  /** Anchor of the page rendering this timeline. Drives whether the
   *  per-entry `scope` badge is shown (admin needs it; scoped pages
   *  already know the anchor from their URL). */
  pageScope: 'platform' | 'project' | 'team';
}

export function PolicyHistoryTimeline({
  entries,
  hasMore,
  limit,
  onLoadMore,
  pageScope,
}: Props) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted">
            No recorded history. Audit events for this rule will appear
            here after future mutations.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {entries.map((e) => (
          <HistoryRow
            key={e.event_id}
            entry={e}
            showScopeBadge={pageScope === 'platform'}
          />
        ))}
      </ol>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full text-sm text-accent hover:underline border border-border rounded px-3 py-2"
        >
          Load more (currently showing {limit})
        </button>
      )}
    </div>
  );
}

interface RowProps {
  entry: PolicyRuleHistoryEntry;
  showScopeBadge: boolean;
}

function HistoryRow({ entry, showScopeBadge }: RowProps) {
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <ActionPill action={entry.action} />
            <span className="text-sm text-text">{entry.actor_display}</span>
            <span className="text-[11px] text-muted">·</span>
            <time className="text-[11px] text-muted" dateTime={entry.occurred_at}>
              {formatOccurredAt(entry.occurred_at)}
            </time>
            {entry.actor_permission_used && (
              <PermissionChip via={entry.actor_permission_used} />
            )}
            {showScopeBadge && entry.scope && <ScopeBadge scope={entry.scope} />}
          </div>
        </div>

        {entry.action === 'policy.delete' && (
          <p className="text-[12px] text-muted italic">
            Rule deleted at this point. Snapshot below is the last-known
            state before deletion.
          </p>
        )}
        {entry.reconstructed && (
          <p className="text-[12px] text-muted italic">
            Initial snapshot observed. This rule has no recorded create
            event (migration-seeded or pre-cutover); the state below is
            reconstructed from the current rule.
          </p>
        )}

        {entry.changes.length > 0 && (
          <ul className="space-y-1.5 text-[12px]">
            {entry.changes.map((c) => (
              <ChangeLine key={c.key} change={c} />
            ))}
          </ul>
        )}

        <details
          open={snapshotOpen}
          onToggle={(ev) => setSnapshotOpen((ev.target as HTMLDetailsElement).open)}
          className="text-[11px]"
        >
          <summary className="cursor-pointer text-muted hover:text-text">
            Snapshot after this event
          </summary>
          <SnapshotBlock snapshot={entry.snapshot_after} />
        </details>

        <CorrelationFooter correlationID={entry.correlation_id} />
      </CardBody>
    </Card>
  );
}

function ActionPill({ action }: { action: PolicyRuleHistoryEntry['action'] }) {
  const label =
    action === 'policy.create' ? 'created' : action === 'policy.update' ? 'updated' : 'deleted';
  const cls =
    action === 'policy.create'
      ? 'bg-green-400/10 border-green-400/30 text-green-300'
      : action === 'policy.update'
        ? 'bg-blue-400/10 border-blue-400/30 text-blue-300'
        : 'bg-red-400/10 border-red-400/30 text-red-300';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function PermissionChip({ via }: { via: 'policy.author' | 'policy.edit' }) {
  return (
    <span className="inline-flex items-center rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] font-mono text-muted">
      via {via}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: 'platform' | 'project' | 'team' }) {
  return (
    <span className="inline-flex items-center rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
      {scope}
    </span>
  );
}

function ChangeLine({ change }: { change: PolicyRuleFieldChange }) {
  switch (change.key) {
    case 'priority':
      return (
        <ScalarChangeRow
          label="Priority"
          before={change.before}
          after={change.after}
        />
      );
    case 'enabled':
      return (
        <ScalarChangeRow
          label="Enabled"
          before={renderBool(change.before)}
          after={renderBool(change.after)}
        />
      );
    case 'name':
      return (
        <ScalarChangeRow
          label="Name"
          before={renderStr(change.before)}
          after={renderStr(change.after)}
        />
      );
    case 'workflow_id':
      return <WorkflowChangeRow change={change} />;
    case 'selector_keys':
      return <SelectorKeysChangeRow change={change} />;
  }
}

function ScalarChangeRow({
  label,
  before,
  after,
}: {
  label: string;
  before: unknown;
  after: unknown;
}) {
  return (
    <li className="flex items-center gap-2 text-text">
      <span className="text-muted w-24 shrink-0">{label}:</span>
      <span className="font-mono text-red-300/80 line-through">
        {String(before ?? '(unknown)')}
      </span>
      <span className="text-muted">→</span>
      <span className="font-mono text-green-300">{String(after ?? '(unknown)')}</span>
    </li>
  );
}

function WorkflowChangeRow({ change }: { change: PolicyRuleFieldChange }) {
  const before = (change.before_workflow_name as string | undefined) ?? '(deleted)';
  const after = (change.after_workflow_name as string | undefined) ?? '(deleted)';
  return (
    <li className="flex items-center gap-2 text-text">
      <span className="text-muted w-24 shrink-0">Workflow:</span>
      <span className="font-mono text-red-300/80 line-through">{before}</span>
      <span className="text-muted">→</span>
      <span className="font-mono text-green-300">{after}</span>
    </li>
  );
}

function SelectorKeysChangeRow({ change }: { change: PolicyRuleFieldChange }) {
  const before = Array.isArray(change.before) ? (change.before as string[]) : [];
  const after = Array.isArray(change.after) ? (change.after as string[]) : [];
  const removed = before.filter((k) => !after.includes(k));
  const added = after.filter((k) => !before.includes(k));
  const kept = before.filter((k) => after.includes(k));
  return (
    <li className="flex items-start gap-2 text-text">
      <span className="text-muted w-24 shrink-0">Selector keys:</span>
      <div className="flex flex-wrap gap-1">
        {kept.map((k) => (
          <span
            key={`k-${k}`}
            className="inline-flex items-center rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] font-mono text-muted"
          >
            {k}
          </span>
        ))}
        {removed.map((k) => (
          <span
            key={`r-${k}`}
            className="inline-flex items-center rounded-full bg-red-400/10 border border-red-400/30 px-2 py-0.5 text-[10px] font-mono text-red-300 line-through"
          >
            {k}
          </span>
        ))}
        {added.map((k) => (
          <span
            key={`a-${k}`}
            className="inline-flex items-center rounded-full bg-green-400/10 border border-green-400/30 px-2 py-0.5 text-[10px] font-mono text-green-300"
          >
            +{k}
          </span>
        ))}
      </div>
    </li>
  );
}

function SnapshotBlock({ snapshot }: { snapshot: PolicyRuleSnapshot }) {
  return (
    <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-[11px]">
      <dt className="text-muted">Name:</dt>
      <dd className="font-mono text-text">{snapshot.name ?? '(unknown)'}</dd>
      <dt className="text-muted">Enabled:</dt>
      <dd className="font-mono text-text">
        {snapshot.enabled === undefined ? '(unknown)' : String(snapshot.enabled)}
      </dd>
      <dt className="text-muted">Priority:</dt>
      <dd className="font-mono text-text">{snapshot.priority}</dd>
      <dt className="text-muted">Workflow:</dt>
      <dd className="font-mono text-text">
        {snapshot.workflow_name ?? '(deleted)'}
      </dd>
      <dt className="text-muted">Selector keys:</dt>
      <dd className="flex flex-wrap gap-1">
        {snapshot.selector_keys.length === 0 ? (
          <span className="text-muted italic">none</span>
        ) : (
          snapshot.selector_keys.map((k) => (
            <span
              key={k}
              className="inline-flex items-center rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] font-mono"
            >
              {k}
            </span>
          ))
        )}
      </dd>
    </dl>
  );
}

function CorrelationFooter({ correlationID }: { correlationID: string }) {
  const short = correlationID.slice(0, 8) + '…';
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(correlationID)}
      title="Click to copy full correlation ID"
      className="text-[10px] text-muted hover:text-text font-mono"
    >
      Correlation: {short} (copy)
    </button>
  );
}

function renderBool(v: unknown): string {
  if (v === undefined || v === null) return '(unknown)';
  return String(v);
}

function renderStr(v: unknown): string {
  if (v === undefined || v === null) return '(unknown)';
  return String(v);
}

function formatOccurredAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
