/**
 * Requests (`/requests`): "My requests", newest first, split into open
 * and closed. Decisions live on Approvals; someone who only approves
 * lands there.
 *
 * Filters work together: search (ref, id, key, path, reason, project,
 * environment, status), a status select with the real status names and
 * their counts, the scope from the top bar and Reset filters.
 * "Showing n of m" updates live. The whole row opens the request and
 * the ref is a real link. The table scrolls inside its own box.
 *
 * Filtering runs in the browser over what GET /requests returns (the
 * newest 100); server-side paging and search are api#232.
 */

import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { useRequests } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { requestRef } from '../lib/requestRef';
import { statusLabel } from '../lib/requestStatus';
import { formatAge, formatExact } from '../lib/time';
import { useNow } from '../lib/useNow';
import { conditionLine, keysOf, nextAction, operationTitle, pathOf } from '../requests/describe';
import { useRevealConditions, type RevealCondition } from '../requests/revealState';
import { inScope, useScope, useScopeDisplay, type ScopeDisplay } from '../requests/scope';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { Input, Select } from '../ui/Field';
import { ScopeLabel } from '../ui/ScopeLabel';
import { SearchIcon } from '../ui/icons';
import { PageHeader } from '../ui/PageHeader';
import { Status } from '../ui/Status';
import { TabPanel, Tabs } from '../ui/Tabs';
import { useToast } from '../ui/toastContext';
import { RequestAccessDrawer } from './RequestAccessDrawer';

type Tab = 'open' | 'closed';
type StatusFilter = 'all' | 'reveal_ready' | AccessRequest['status'];

const STATUSES: AccessRequest['status'][] = [
  'pending',
  'pending_values',
  'pending_verification',
  'approved',
  'executed',
  'rejected',
  'refused',
  'cancelled',
  'expired',
  'failed',
];

export function Requests() {
  const navigate = useNavigate();
  const toast = useToast();
  const { identity, hasPermission } = useAuth();
  const me = identity?.id ?? '';
  const canRequest = hasPermission('secret.request');
  const canApprove = hasPermission('secret.approve');
  const { scope } = useScope();
  const display = useScopeDisplay();
  const now = useNow();

  const [params] = useSearchParams();
  const asked = params.get('tab');
  const [tab, setTab] = useState<Tab>(asked === 'closed' ? 'closed' : 'open');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mineQ = useRequests({ requester_id: me }, { enabled: !!me && canRequest });

  const mineAll = useMemo(() => (mineQ.data ?? []).filter((r) => r.requester_id === me), [mineQ.data, me]);
  const reveal = useRevealConditions(mineAll, me);

  const mineOpen = useMemo(() => mineAll.filter((r) => !isClosed(r, reveal.get(r.id))), [mineAll, reveal]);
  const mineClosed = useMemo(() => mineAll.filter((r) => isClosed(r, reveal.get(r.id))), [mineAll, reveal]);
  const tabAll = tab === 'open' ? mineOpen : mineClosed;
  const base = useMemo(() => tabAll.filter((r) => inScope(r, scope)), [tabAll, scope]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = base.filter((r) => {
      if (!matchesStatus(r, status, reveal.get(r.id))) return false;
      if (!needle) return true;
      const d = display(r);
      const hay = [
        requestRef(r.id),
        r.id,
        pathOf(r),
        keysOf(r).join(' '),
        r.justification,
        d.project,
        d.env ?? '',
        r.status,
        statusLabel(r.status),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
    return filtered.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [base, status, q, reveal, display]);

  const filtered = q.trim() !== '' || status !== 'all';
  const reset = () => {
    setQ('');
    setStatus('all');
  };

  const query = mineQ;

  const tabs = [
    { id: 'open', label: 'Open', count: mineOpen.filter((r) => inScope(r, scope)).length },
    { id: 'closed', label: 'Closed', count: mineClosed.filter((r) => inScope(r, scope)).length },
  ];

  const statusCount = (s: StatusFilter) => base.filter((r) => matchesStatus(r, s, reveal.get(r.id))).length;

  if (!canRequest && canApprove) return <Navigate to="/approvals" replace />;

  const table = <RequestTable rows={rows} me={me} reveal={reveal} display={display} now={now} />;

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Every request you made, newest first. Values never appear in this list."
        actions={
          canRequest ? (
            <Button variant="primary" onClick={() => setDrawerOpen(true)}>
              New request
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Tabs
          label="Request queues"
          idPrefix="requests"
          tabs={tabs}
          value={tab}
          onChange={(id) => {
            setTab(id as Tab);
            setStatus('all');
          }}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <label className="relative min-w-0 flex-[1_1_280px] max-w-[380px] max-[600px]:max-w-none max-[600px]:basis-full">
          <span className="sr-only">Search requests</span>
          <SearchIcon size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search key, path, reason or ID"
            className="w-full pl-8"
          />
        </label>
        <label className="flex-[0_1_200px] max-[600px]:flex-[1_1_140px]">
          <span className="sr-only">Status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-full">
            <option value="all">All statuses ({base.length})</option>
            {tab === 'open' && <option value="reveal_ready">Reveal ready ({statusCount('reveal_ready')})</option>}
            {STATUSES.filter((s) => statusCount(s) > 0).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)} ({statusCount(s)})
              </option>
            ))}
          </Select>
        </label>
        <Button variant="quiet" onClick={reset} disabled={!filtered}>
          Reset filters
        </Button>
        {!query.isLoading && !query.isError && (
          <p role="status" className="ml-auto whitespace-nowrap text-caption text-muted max-[600px]:ml-0 max-[600px]:w-full">
            Showing {rows.length} of {tabAll.length}
          </p>
        )}
      </div>

      {query.isError && (
        <Banner
          tone="error"
          title="Couldn't load requests."
          action={
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing is counted until they load.
        </Banner>
      )}
      {query.isLoading && <p className="text-muted">Loading requests…</p>}

      {!query.isLoading && !query.isError && (
        <TabPanel idPrefix="requests" value={tab}>
          {rows.length > 0 ? (
            table
          ) : filtered ? (
            <EmptyState
              title="No requests match these filters."
              action={
                <Button variant="secondary" onClick={reset}>
                  Reset filters
                </Button>
              }
            >
              Try a different search or status, or reset the filters to see everything in your scopes.
            </EmptyState>
          ) : tab === 'open' && mineAll.length > 0 ? (
            <EmptyState
              title="Nothing open right now."
              action={
                <Button variant="secondary" onClick={() => setTab('closed')}>
                  See closed requests
                </Button>
              }
            >
              Open requests are the ones waiting for a decision, an agent or your reveal.
            </EmptyState>
          ) : tab === 'closed' ? (
            <EmptyState title="No closed requests yet.">Requests appear here once they are revealed, rejected, cancelled, expired or failed.</EmptyState>
          ) : (
            <EmptyState
              title="You haven't requested access yet."
              action={
                canRequest ? (
                  <Button variant="primary" onClick={() => setDrawerOpen(true)}>
                    New request
                  </Button>
                ) : undefined
              }
            >
              Requests you make appear here with their status and next step.
            </EmptyState>
          )}
        </TabPanel>
      )}

      {drawerOpen && identity && (
        <RequestAccessDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={(id) => {
            setDrawerOpen(false);
            toast(`Request ${requestRef(id)} submitted.`, { to: `/requests/${id}`, label: 'Open it' });
            setTab('open');
            navigate('/requests', { replace: true });
          }}
        />
      )}
    </div>
  );
}

function isClosed(r: AccessRequest, reveal?: RevealCondition): boolean {
  if (r.status === 'executed') return reveal?.state !== 'ready';
  return ['rejected', 'refused', 'cancelled', 'expired', 'failed'].includes(r.status);
}

function matchesStatus(r: AccessRequest, s: StatusFilter, reveal?: RevealCondition): boolean {
  if (s === 'all') return true;
  if (s === 'reveal_ready') return r.status === 'executed' && reveal?.state === 'ready';
  return r.status === s;
}

// --- table ----------------------------------------------------------

function RequestTable({
  rows,
  me,
  reveal,
  display,
  now,
}: {
  rows: AccessRequest[];
  me: string;
  reveal: Map<string, RevealCondition>;
  display: (r: AccessRequest) => ScopeDisplay;
  now: number;
}) {
  const navigate = useNavigate();
  const open = (r: AccessRequest) => navigate(`/requests/${r.id}`);

  const columns: Column<AccessRequest>[] = [
    {
      key: 'request',
      header: 'Request',
      render: (r) => (
        <div className="min-w-[220px] max-w-[380px]">
          <Link
            to={`/requests/${r.id}`}
            title={operationTitle(r)}
            className="block truncate font-mono text-mono font-medium text-ink hover:text-accent-ink hover:underline"
          >
            {keysOf(r).join(', ') || 'All keys'}
          </Link>
          <p className="mt-0.5 truncate font-mono text-mono-small text-muted" title={pathOf(r)}>
            {requestRef(r.id)} · {pathOf(r)}
          </p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Project · environment',
      render: (r) => {
        const d = display(r);
        return (
          <ScopeLabel project={d.project} env={d.env} envKind={d.envKind} logo={d.logo} />
        );
      },
    },
    {
      key: 'state',
      header: 'State',
      render: (r) => {
        const line = conditionLine(r, reveal.get(r.id));
        return (
          <div>
            <Status status={r.status} />
            {line && (
              <p className={'mt-0.5 whitespace-nowrap text-caption ' + (line.tone === 'ok' ? 'text-ok' : 'text-muted')}>
                {line.text}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'age',
      header: 'Age',
      align: 'right',
      render: (r) => {
        const at = ['pending', 'pending_values', 'pending_verification', 'approved'].includes(r.status) || reveal.get(r.id)?.state === 'ready'
          ? r.created_at
          : (r.updated_at ?? r.created_at);
        return (
          <time title={formatExact(at)} className="whitespace-nowrap font-mono text-mono text-muted">
            {formatAge(at, now)}
          </time>
        );
      },
    },
    {
      key: 'next',
      header: 'Next action',
      render: (r) => {
        const n = nextAction(r, me, reveal.get(r.id));
        if (n.cta) {
          return (
            <Button variant="secondary" size="sm" onClick={() => open(r)}>
              {n.cta}
              <span className="sr-only"> {requestRef(r.id)}</span>
            </Button>
          );
        }
        return <span className="text-caption text-muted">{n.text}</span>;
      },
    },
  ];

  return (
    <DataTable
      label="Your requests"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={open}
      minWidth={860}
      alignTop
      stacked={(r) => {
        // On phones a row is a block, so the state and the next step stay
        // in view instead of sitting off to the right of a scrolled table.
        const cell = (key: string) => columns.find((c) => c.key === key)?.render(r);
        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 [&>div]:min-w-0">{cell('request')}</div>
              {cell('age')}
            </div>
            {cell('scope')}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              {cell('state')}
              {cell('next')}
            </div>
          </div>
        );
      }}
    />
  );
}
