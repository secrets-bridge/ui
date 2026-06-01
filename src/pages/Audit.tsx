/**
 * Audit log page (`/audit`).
 *
 * Read-only view over the platform's append-only `audit_events` table
 * (NFR-07). The schema's triggers reject UPDATE / DELETE and the api's
 * repository interface deliberately omits those methods, so what shows
 * here is a faithful history — nothing can be silently rewritten.
 *
 * Two-pane layout:
 *
 *   ┌── filter strip ──────────────────────────────────────────────────┐
 *   │ actor · action · resource · correlation_id · since · until · ⨯  │
 *   ├── LEFT (table)            ┬── RIGHT (selected event details) ────┤
 *   │  occurred · actor · action │  full row + metadata JSON           │
 *   │  · resource · status      │  + a 'related events' link that      │
 *   │                            │  drills into the row's correlation  │
 *   └────────────────────────────┴──────────────────────────────────────┘
 *
 * Correlation drill-in: clicking a row's correlation_id chip filters
 * the entire page to that chain, so an operator triaging a request
 * can see every event (submit → policy → approve → enqueue → claim →
 * complete → transition → wrap.retrieve) in chronological order.
 *
 * Wire shape: `metadata` is opaque jsonb pre-stripped of any
 * value-bearing field by the api's service layer — safe to render.
 *
 * Actor column: api#62 enriches each row with `actor_display` — the
 * user's email (or display name), the agent's name, or a fixed
 * "System (…)" label. The raw `actor` string (`user:<uuid>`,
 * `agent:<uuid>`, `system:<kind>`) stays available as a forensic
 * anchor and is rendered underneath the display label + exposed as a
 * `title` tooltip on hover.
 */

import { useMemo, useState } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  type AuditEvent,
  type AuditFilter,
  useAuditEvents,
} from '../api/audit';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

export function Audit() {
  const { identity, hasPermission } = useAuth();
  const myActor = identity ? `user:${identity.id}` : '';
  // "Privileged" callers can see every event in the audit log:
  // admins (team.edit / role.edit / user_role.edit) and auditors who
  // hold audit.read at a global scope. For everyone else we default
  // the actor filter to their own user: prefix so they only see what
  // THEY did, and we disable the Actor input so they can't widen it.
  const isPrivileged = useMemo(
    () =>
      hasPermission('role.edit') ||
      hasPermission('user_role.edit') ||
      hasPermission('team.edit'),
    [hasPermission],
  );

  const initial: AuditFilter = useMemo(
    () => (isPrivileged ? { limit: 200 } : { limit: 200, actor: myActor }),
    [isPrivileged, myActor],
  );
  const [filter, setFilter] = useState<AuditFilter>(initial);
  const [draft, setDraft] = useState<AuditFilter>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useAuditEvents(filter);
  const rows = list.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const apply = () => {
    setFilter({
      ...draft,
      // Drop empty strings so URLSearchParams stays tidy.
      actor: draft.actor?.trim() || undefined,
      action: draft.action?.trim() || undefined,
      resource: draft.resource?.trim() || undefined,
      correlation_id: draft.correlation_id?.trim() || undefined,
      limit: draft.limit ?? 200,
    });
    setSelectedId(null);
  };

  const clear = () => {
    // Non-privileged users CAN'T widen the actor — clearing preserves
    // the "user:<me>" lock so a developer never sees other users'
    // events via this page.
    const fresh: AuditFilter = isPrivileged
      ? { limit: 200 }
      : { limit: 200, actor: myActor };
    setFilter(fresh);
    setDraft(fresh);
    setSelectedId(null);
  };

  const drillCorrelation = (id: string) => {
    const next = { ...filter, correlation_id: id };
    setFilter(next);
    setDraft(next);
    // Don't clear the selection — let the user keep reading the row
    // they clicked into while the table reshapes around it.
  };

  const hasFilter =
    !!filter.actor ||
    !!filter.action ||
    !!filter.resource ||
    !!filter.correlation_id ||
    !!filter.since ||
    !!filter.until;

  return (
    <div>
      <PageHeader
        title="Audit log"
        description={
          isPrivileged
            ? 'Immutable record of who did what to which resource. Append-only at the schema layer (NFR-07).'
            : 'Your audit events — every action you took or that happened to you. Append-only at the schema layer (NFR-07).'
        }
        actions={
          hasFilter ? (
            <Button variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          ) : undefined
        }
      />

      {/* Filter strip */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterField
            label="Actor"
            value={draft.actor ?? ''}
            onChange={(v) => setDraft({ ...draft, actor: v })}
            placeholder="user:alice / admin / agent:<id>"
            disabled={!isPrivileged}
            disabledHint="Locked to your own events. Ask an admin if you need to investigate someone else's actions."
          />
          <FilterField
            label="Action"
            value={draft.action ?? ''}
            onChange={(v) => setDraft({ ...draft, action: v })}
            placeholder="request.approve / wrap.retrieve"
          />
          <FilterField
            label="Resource"
            value={draft.resource ?? ''}
            onChange={(v) => setDraft({ ...draft, resource: v })}
            placeholder="request:<id> / agent:<id>"
          />
          <FilterField
            label="Correlation ID"
            value={draft.correlation_id ?? ''}
            onChange={(v) => setDraft({ ...draft, correlation_id: v })}
            placeholder="uuid (paste from a request)"
            mono
          />
        </div>
        <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border/60">
          <Button variant="secondary" size="sm" onClick={() => setDraft(filter)}>
            Reset
          </Button>
          <Button variant="primary" size="sm" onClick={apply}>
            Apply
          </Button>
        </div>
      </Card>

      {/* Active filter pills */}
      {hasFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="text-muted">filtering by:</span>
          {filter.actor && (
            <ActivePill label="actor" value={filter.actor} onClear={() => apply2(filter, setFilter, setDraft, 'actor')} />
          )}
          {filter.action && (
            <ActivePill label="action" value={filter.action} onClear={() => apply2(filter, setFilter, setDraft, 'action')} />
          )}
          {filter.resource && (
            <ActivePill label="resource" value={filter.resource} onClear={() => apply2(filter, setFilter, setDraft, 'resource')} />
          )}
          {filter.correlation_id && (
            <ActivePill label="correlation" value={shortenUuid(filter.correlation_id)} onClear={() => apply2(filter, setFilter, setDraft, 'correlation_id')} />
          )}
        </div>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}
      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load audit events</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.data && rows.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No audit events match. Adjust filters above or wait for activity.
        </Card>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
                <tr className="border-b border-border/60">
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Resource</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <AuditRow
                    key={e.id}
                    row={e}
                    selected={e.id === selectedId}
                    onSelect={() => setSelectedId(e.id)}
                    onDrillCorrelation={() => drillCorrelation(e.correlation_id)}
                  />
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-border/60 text-xs text-muted">
              Showing {rows.length} event{rows.length === 1 ? '' : 's'}
              {filter.limit ? ` (limit ${filter.limit})` : ''}
            </div>
          </Card>

          <DetailsPane
            event={selected}
            onDrillCorrelation={() =>
              selected && drillCorrelation(selected.correlation_id)
            }
          />
        </div>
      )}
    </div>
  );
}

// --- row ------------------------------------------------------------

function AuditRow({
  row: e,
  selected,
  onSelect,
  onDrillCorrelation,
}: {
  row: AuditEvent;
  selected: boolean;
  onSelect: () => void;
  onDrillCorrelation: () => void;
}) {
  const statusVariant: React.ComponentProps<typeof StatusPill>['variant'] =
    e.status === 'success'
      ? 'success'
      : e.status === 'denied'
        ? 'warning'
        : 'error';
  return (
    <tr
      onClick={onSelect}
      className={
        'border-b border-border/40 last:border-0 align-top cursor-pointer ' +
        (selected ? 'bg-accent/10' : 'hover:bg-bg/20')
      }
    >
      <Td className="text-muted text-xs whitespace-nowrap">
        <div className="font-mono">{formatTime(e.occurred_at)}</div>
        <div className="text-muted/70 mt-0.5">{formatDate(e.occurred_at)}</div>
      </Td>
      <Td>
        <ActorCell display={e.actor_display} raw={e.actor} />
      </Td>
      <Td>
        <span className="font-mono text-accent text-sm break-all">
          {e.action}
        </span>
      </Td>
      <Td>
        <div className="space-y-1">
          <span className="font-mono text-text text-xs break-all">
            {e.resource}
          </span>
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onDrillCorrelation();
            }}
            className="block text-[11px] font-mono text-muted hover:text-accent transition-colors"
            title="Drill into this event's correlation chain"
          >
            corr {shortenUuid(e.correlation_id)}
          </button>
        </div>
      </Td>
      <Td>
        <StatusPill variant={statusVariant} tone="outline">
          {e.status}
        </StatusPill>
      </Td>
    </tr>
  );
}

// --- details pane ---------------------------------------------------

function DetailsPane({
  event,
  onDrillCorrelation,
}: {
  event: AuditEvent | null;
  onDrillCorrelation: () => void;
}) {
  if (!event) {
    return (
      <Card className="p-6 text-center text-muted text-sm">
        Pick a row to inspect the full event + metadata.
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden sticky top-4">
      <div className="px-5 py-4 border-b border-border/60">
        <div className="text-text font-semibold">Event details</div>
        <div className="text-muted text-xs mt-1 font-mono">{event.id}</div>
      </div>
      <dl className="px-5 py-4 space-y-2.5 text-sm">
        <Row k="When" v={`${formatDate(event.occurred_at)} ${formatTime(event.occurred_at)}`} />
        <Row
          k="Actor"
          v={
            <div className="space-y-0.5">
              <div className="text-text text-sm break-all">
                {event.actor_display || event.actor}
              </div>
              <div className="text-muted/70 text-[11px] font-mono break-all">
                {event.actor}
              </div>
            </div>
          }
        />
        <Row k="Action" mono v={<span className="text-accent">{event.action}</span>} />
        <Row k="Resource" mono v={event.resource} />
        <Row
          k="Status"
          v={
            <StatusPill
              variant={
                event.status === 'success'
                  ? 'success'
                  : event.status === 'denied'
                    ? 'warning'
                    : 'error'
              }
              tone="outline"
            >
              {event.status}
            </StatusPill>
          }
        />
        <Row
          k="Correlation"
          v={
            <button
              onClick={onDrillCorrelation}
              className="font-mono text-accent hover:text-accent-bright text-xs underline-offset-2 hover:underline"
              title="Filter the page to this correlation chain"
            >
              {event.correlation_id}
            </button>
          }
        />
      </dl>
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <div className="px-5 py-4 border-t border-border/60">
          <div className="text-muted text-[11px] uppercase tracking-wider font-medium mb-2">
            Metadata
          </div>
          <pre className="text-[11px] text-muted bg-bg/40 border border-border/60 rounded-lg px-3 py-2 overflow-x-auto font-mono">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
}

// --- shared bits ----------------------------------------------------

function FilterField({
  label,
  value,
  onChange,
  placeholder,
  mono,
  disabled,
  disabledHint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        className={
          'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 ' +
          (mono ? 'font-mono ' : '') +
          (disabled ? 'opacity-60 cursor-not-allowed' : '')
        }
        autoComplete="off"
        spellCheck={false}
      />
      {disabled && disabledHint && (
        <div className="text-[11px] text-muted/80 italic">{disabledHint}</div>
      )}
    </div>
  );
}

function ActivePill({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border px-2.5 py-0.5 text-[11px] font-mono">
      <span className="text-muted">{label}</span>
      <span className="text-muted/50">=</span>
      <span className="text-accent">{value}</span>
      <button
        onClick={onClear}
        className="ml-1 text-muted hover:text-text"
        title="Clear"
      >
        ×
      </button>
    </span>
  );
}

// Renders the table cell for an audit row's actor: human label on top,
// raw `user:<uuid>` / `agent:<uuid>` / `system:<kind>` underneath in a
// dimmer font for forensic anchoring + copy-paste into the actor
// filter. The raw string is also exposed via `title` so hovering shows
// the full UUID even when truncated.
function ActorCell({ display, raw }: { display: string; raw: string }) {
  // api#62 always populates `actor_display`, but old records or test
  // fixtures might not — fall back to the raw string for the top line
  // so the column never goes blank.
  const top = display || raw;
  // Skip the second line when display IS the raw string (unknown
  // actor shape: e.g. `admin`, legacy seeded values), otherwise we'd
  // render the same text twice.
  const showRaw = display && display !== raw;
  return (
    <div className="space-y-0.5" title={raw}>
      <div className="text-text text-sm break-all">{top}</div>
      {showRaw && (
        <div className="text-muted/70 text-[11px] font-mono break-all">
          {raw}
        </div>
      )}
    </div>
  );
}

function Row({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 items-baseline">
      <dt className="text-muted text-xs uppercase tracking-wider">{k}</dt>
      <dd
        className={
          'text-sm break-all ' + (mono ? 'font-mono text-text' : 'text-text')
        }
      >
        {v}
      </dd>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-5 py-3.5 align-top ${className}`}>{children}</td>;
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}

function shortenUuid(id: string): string {
  if (!id || id.length < 8) return id;
  return `${id.slice(0, 8)}…`;
}

function apply2(
  current: AuditFilter,
  setFilter: (f: AuditFilter) => void,
  setDraft: (f: AuditFilter) => void,
  key: keyof AuditFilter,
) {
  const next = { ...current };
  delete next[key];
  setFilter(next);
  setDraft(next);
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
