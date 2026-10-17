/**
 * Audit log (`/audit`, audit.read): the append-only `audit_events`
 * table, newest first. Rows can't be edited or deleted (schema
 * triggers, and the repository has no such methods), and metadata is
 * stripped of values before it is written, so everything here is safe
 * to show.
 *
 * - Filters (actor, action, resource, correlation, period) apply as you
 *   type and live in the URL, so `/audit?correlation_id=<id>` is a
 *   shareable link to one request's trail.
 * - 50 events per page; "Load older events" fetches the next page
 *   (see `useAuditPages` for how pages are cut without a cursor).
 * - A row opens the event: who, what, which resource, the outcome, the
 *   correlation chain and the metadata.
 *
 * People without an administrative permission see only their own
 * events: the actor filter is fixed to them. The api still decides
 * what audit.read covers.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { type AuditEvent, flattenAuditPages, useAuditPages } from '../api/audit';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { requestRef } from '../lib/requestRef';
import { formatExact, formatShort } from '../lib/time';
import { useNow } from '../lib/useNow';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Input, Select } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { ToneStatus, type Tone } from '../ui/Status';

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS: { value: string; label: string; ms?: number }[] = [
  { value: '', label: 'Any time' },
  { value: '1h', label: 'Last hour', ms: 3_600_000 },
  { value: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
];
const TONE: Record<AuditEvent['status'], Tone> = { success: 'ok', denied: 'warn', failure: 'bad' };
const WORD: Record<AuditEvent['status'], string> = { success: 'Success', denied: 'Denied', failure: 'Failure' };

/** The value of `text` once it has stopped changing for `ms`. */
function useDebounced(text: string, ms = 350): string {
  const [value, setValue] = useState(text);
  useEffect(() => {
    const t = window.setTimeout(() => setValue(text), ms);
    return () => window.clearTimeout(t);
  }, [text, ms]);
  return value;
}

export function Audit() {
  const { identity, hasPermission } = useAuth();
  const myActor = identity ? `user:${identity.id}` : '';
  // Administrators can read every event; everyone else sees only what
  // they did, and can't widen the actor.
  const privileged = hasPermission('role.edit') || hasPermission('user_role.edit') || hasPermission('team.edit');
  const [params, setParams] = useSearchParams();
  const now = useNow(60_000);

  // Typed text lives here; the URL gets it once typing pauses.
  const [typed, setTyped] = useState(() => ({
    actor: params.get('actor') ?? '',
    action: params.get('action') ?? '',
    resource: params.get('resource') ?? '',
    correlation_id: params.get('correlation_id') ?? '',
  }));
  const period = params.get('period') ?? '';
  const debounced = {
    actor: useDebounced(typed.actor),
    action: useDebounced(typed.action),
    resource: useDebounced(typed.resource),
    correlation_id: useDebounced(typed.correlation_id),
  };
  const corrValid = !debounced.correlation_id.trim() || UUID.test(debounced.correlation_id.trim());

  useEffect(() => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(debounced)) if (v.trim()) next.set(k, v.trim());
    if (period) next.set('period', period);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // Only typing and the period move the URL; reading it back is above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced.actor, debounced.action, debounced.resource, debounced.correlation_id, period]);

  // The period counts back from when it was picked (or the page opened),
  // so the query, and the pages already loaded, stay put as time passes.
  const [anchor, setAnchor] = useState(() => Date.now());
  const periodMs = PERIODS.find((p) => p.value === period)?.ms;
  const since = periodMs ? new Date(anchor - periodMs).toISOString() : undefined;
  const filter = {
    actor: privileged ? params.get('actor') || undefined : myActor || undefined,
    action: params.get('action') || undefined,
    resource: params.get('resource') || undefined,
    correlation_id: corrValid ? params.get('correlation_id') || undefined : undefined,
    since,
  };
  const pages = useAuditPages(filter, PAGE);
  const rows = flattenAuditPages(pages.data?.pages);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((e) => e.id === openId) ?? null;

  // Anything in the URL counts, even an id still being typed, so Reset is always there to clear it.
  const filtered = [...params.keys()].some((k) => k !== 'actor' || privileged);
  const reset = () => {
    setTyped({ actor: '', action: '', resource: '', correlation_id: '' });
    setParams({}, { replace: true });
  };
  const followChain = (id: string) => {
    setTyped((t) => ({ ...t, correlation_id: id }));
    const next = new URLSearchParams(params);
    next.set('correlation_id', id);
    setParams(next, { replace: true });
    setOpenId(null);
  };

  const columns: Column<AuditEvent>[] = [
    {
      key: 'when',
      header: 'When (UTC)',
      render: (e) => (
        <time dateTime={e.occurred_at} title={formatExact(e.occurred_at, true)} className="whitespace-nowrap font-mono text-mono">
          {formatShort(e.occurred_at, now)}
        </time>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (e) => (
        <span title={e.actor} className="block max-w-[220px] truncate">
          {e.actor_display || e.actor}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (e) => (
        <button type="button" onClick={() => setOpenId(e.id)} className="text-left font-mono text-mono text-accent hover:underline">
          {e.action}
        </button>
      ),
    },
    {
      key: 'resource',
      header: 'Resource',
      render: (e) => (
        <span title={e.resource} className="block max-w-[280px] truncate font-mono text-mono">
          {e.resource || '—'}
        </span>
      ),
    },
    { key: 'status', header: 'Outcome', render: (e) => <ToneStatus tone={TONE[e.status] ?? 'neutral'}>{WORD[e.status] ?? e.status}</ToneStatus> },
  ];

  const fact = privileged
    ? 'Every action the control plane recorded. Append-only: nothing here can be changed or deleted.'
    : 'The actions you took. Append-only: nothing here can be changed or deleted.';

  return (
    <div>
      <PageHeader title="Audit log" description={fact} />

      <div className="mb-4 grid grid-cols-1 gap-2.5 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-[repeat(4,minmax(0,1fr))_minmax(150px,auto)]">
        <FilterInput
          label="Actor"
          value={privileged ? typed.actor : 'Only you'}
          onChange={(v) => setTyped((t) => ({ ...t, actor: v }))}
          placeholder="user:<id> or agent:<id>"
          disabled={!privileged}
        />
        <FilterInput label="Action" value={typed.action} onChange={(v) => setTyped((t) => ({ ...t, action: v }))} placeholder="request.approve" />
        <FilterInput label="Resource" value={typed.resource} onChange={(v) => setTyped((t) => ({ ...t, resource: v }))} placeholder="request:<id>" />
        <FilterInput
          label="Correlation id"
          value={typed.correlation_id}
          onChange={(v) => setTyped((t) => ({ ...t, correlation_id: v }))}
          placeholder="Request id or other chain id"
          invalid={!corrValid}
        />
        <label>
          <span className="sr-only">Period</span>
          <Select
            value={period}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              setAnchor(Date.now());
              if (e.target.value) next.set('period', e.target.value);
              else next.delete('period');
              setParams(next, { replace: true });
            }}
            className="w-full"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="mb-3 flex min-h-[28px] flex-wrap items-center gap-x-4 gap-y-1 text-ui font-normal text-muted">
        <span aria-live="polite">
          {pages.data ? `${rows.length} ${rows.length === 1 ? 'event' : 'events'}${pages.hasNextPage ? ' loaded' : ''}` : ''}
          {!corrValid && <span className="ml-2 text-bad">A correlation id is a UUID; this filter is ignored until it is one.</span>}
          {!privileged && <span className="ml-2">Only your own events are shown.</span>}
        </span>
        {filtered && (
          <Button variant="quiet" size="sm" onClick={reset}>
            Reset filters
          </Button>
        )}
      </div>

      {pages.isLoading && <p className="text-muted">Loading events…</p>}
      {pages.isError && (
        <Banner
          tone="error"
          title="Couldn't load the audit log."
          action={
            <Button variant="secondary" size="sm" onClick={() => void pages.refetch()}>
              Try again
            </Button>
          }
        >
          {pages.error instanceof ApiError ? `${pages.error.status}: ${pages.error.message}` : 'Network error.'}
        </Banner>
      )}
      {pages.data &&
        (rows.length === 0 ? (
          <EmptyState title={filtered ? 'No events match these filters.' : 'No events yet.'}>
            {filtered ? 'Widen the period or clear a filter.' : 'Events appear here as people and agents use the control plane.'}
          </EmptyState>
        ) : (
          <>
            <DataTable
              label="Audit events"
              columns={columns}
              rows={rows}
              rowKey={(e) => e.id}
              onRowClick={(e) => setOpenId(e.id)}
              minWidth={760}
              stacked={(e) => (
                <div className="flex flex-col gap-1">
                  <p className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setOpenId(e.id)} className="text-left font-mono text-mono text-accent hover:underline">
                      {e.action}
                    </button>
                    <ToneStatus tone={TONE[e.status] ?? 'neutral'}>{WORD[e.status] ?? e.status}</ToneStatus>
                  </p>
                  <p className="text-caption text-muted">
                    {formatShort(e.occurred_at, now)} UTC · {e.actor_display || e.actor}
                  </p>
                  {e.resource && <p className="truncate font-mono text-mono-small text-muted">{e.resource}</p>}
                </div>
              )}
            />
            <div className="mt-3 flex items-center gap-3">
              {pages.hasNextPage ? (
                <Button variant="secondary" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage} aria-busy={pages.isFetchingNextPage}>
                  {pages.isFetchingNextPage ? 'Loading…' : 'Load older events'}
                </Button>
              ) : (
                <p className="text-caption text-muted">That's the oldest event{filtered ? ' that matches' : ''}.</p>
              )}
              {pages.isFetchNextPageError && <p className="text-caption text-bad">Couldn't load older events. Try again.</p>}
            </div>
          </>
        ))}

      {open && <EventDrawer event={open} onClose={() => setOpenId(null)} onFollow={followChain} following={filter.correlation_id === open.correlation_id} />}
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-caption font-medium text-muted">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="font-mono"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

function EventDrawer({
  event: e,
  onClose,
  onFollow,
  following,
}: {
  event: AuditEvent;
  onClose: () => void;
  onFollow: (correlationId: string) => void;
  following: boolean;
}) {
  const requestId = /^request:([0-9a-f-]{36})$/i.exec(e.resource)?.[1];
  const meta = e.metadata && Object.keys(e.metadata).length > 0 ? e.metadata : null;
  const rows: [string, ReactNode][] = [
    ['When', formatExact(e.occurred_at, true)],
    [
      'Actor',
      <span key="a">
        {e.actor_display || e.actor}
        {e.actor_display && e.actor_display !== e.actor && <span className="block break-all font-mono text-mono-small text-muted">{e.actor}</span>}
      </span>,
    ],
    ['Action', <span key="ac" className="font-mono text-mono">{e.action}</span>],
    [
      'Resource',
      <span key="r" className="break-all font-mono text-mono">
        {e.resource || '—'}
        {requestId && (
          <Link to={`/requests/${requestId}`} className="mt-1 block font-sans text-ui font-medium text-accent hover:underline">
            Open request {requestRef(requestId)}
          </Link>
        )}
      </span>,
    ],
    ['Outcome', <ToneStatus key="o" tone={TONE[e.status] ?? 'neutral'}>{WORD[e.status] ?? e.status}</ToneStatus>],
    ['Correlation', <span key="c" className="break-all font-mono text-mono">{e.correlation_id}</span>],
    ['Event id', <span key="i" className="break-all font-mono text-mono">{e.id}</span>],
  ];

  return (
    <Drawer
      title="Audit event"
      subtitle={e.action}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {!following && (
            <Button variant="primary" onClick={() => onFollow(e.correlation_id)}>
              Show the whole chain
            </Button>
          )}
        </>
      }
    >
      <dl className="m-0">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mb-2 mt-5 text-body font-semibold text-ink">Metadata</h3>
      {meta ? (
        <pre className="overflow-x-auto rounded-md border border-border bg-sunken px-3 py-2.5 font-mono text-mono-small leading-relaxed text-ink">
          {JSON.stringify(meta, null, 2)}
        </pre>
      ) : (
        <p className="text-muted">None recorded.</p>
      )}
      <p className="mt-2 text-caption text-muted">Metadata never holds secret values, tokens or wrap bodies.</p>
    </Drawer>
  );
}
