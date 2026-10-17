/**
 * Requests (`/requests`).
 *
 * A requester sees "My requests", newest first. An approver sees tabs:
 * "Needs my decision" (pending, someone else's, not yet voted on;
 * oldest first) and, when they also request, "My requests". The api
 * doesn't report approval lanes or who decided yet, so the handoff's
 * "Coming to me" and "Decided by me" tabs wait for it (api#228,
 * api#232).
 *
 * Filters work together: search (ref, id, key, path, reason, requester,
 * project, environment, status), a status select with the real status
 * names and their counts, the shared scope filter and Reset filters.
 * "Showing n of m" updates live. The whole row opens the request and
 * the ref is a real link. The table scrolls inside its own box.
 *
 * Filtering runs in the browser over what GET /requests returns (the
 * newest 100); server-side paging and search are api#232.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useRequests } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { needsMyDecision } from '../lib/requestQueues';
import { requestRef } from '../lib/requestRef';
import { statusLabel } from '../lib/requestStatus';
import { formatAge, formatExact, formatRemaining } from '../lib/time';
import { useNow } from '../lib/useNow';
import { conditionLine, keysOf, nextAction, operationTitle, pathOf } from '../requests/describe';
import { useRevealConditions, type RevealCondition } from '../requests/revealState';
import { ALL_SCOPES, inScope, scopeOptions, useScope, useScopeDisplay, type ScopeDisplay } from '../requests/scope';
import { useRequestDetails } from '../requests/useRequestDetails';
import { useMe } from '../api/me';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { EnvTag } from '../ui/EnvTag';
import { Input, Select } from '../ui/Field';
import { SearchIcon } from '../ui/icons';
import { PageHeader } from '../ui/PageHeader';
import { Status } from '../ui/Status';
import { TabPanel, Tabs } from '../ui/Tabs';
import { useToast } from '../ui/toastContext';
import { RequestAccessDrawer } from './RequestAccessDrawer';

type Tab = 'decide' | 'mine';
type StatusFilter = 'all' | 'reveal_ready' | 'closed' | AccessRequest['status'];

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
  const { scope, setScope } = useScope();
  const meQ = useMe();
  const scopes = useMemo(() => scopeOptions(meQ.data?.projects), [meQ.data]);
  const display = useScopeDisplay();
  const now = useNow();

  const [tab, setTab] = useState<Tab>(canApprove ? 'decide' : 'mine');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mineQ = useRequests({ requester_id: me }, { enabled: !!me && canRequest });
  const pendingQ = useRequests({ status: 'pending' }, { enabled: !!me && canApprove });

  const mineAll = useMemo(() => (mineQ.data ?? []).filter((r) => r.requester_id === me), [mineQ.data, me]);
  const reveal = useRevealConditions(mineAll, me);

  // Needs my decision: the queue rule plus each row's detail, for the
  // requester's name and the votes already cast.
  const candidates = useMemo(() => needsMyDecision(pendingQ.data ?? [], me), [pendingQ.data, me]);
  const details = useRequestDetails(useMemo(() => candidates.map((r) => r.id), [candidates]));
  const decideAll = useMemo(
    () => needsMyDecision(candidates.map((r) => details.get(r.id) ?? r), me),
    [candidates, details, me],
  );

  const activeTab: Tab = canApprove && (tab === 'decide' || !canRequest) ? 'decide' : 'mine';
  const tabAll = activeTab === 'decide' ? decideAll : mineAll;
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
        r.requester_display ?? '',
        d.project,
        d.env ?? '',
        r.status,
        statusLabel(r.status),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
    const byNew = (a: AccessRequest, b: AccessRequest) => Date.parse(b.created_at) - Date.parse(a.created_at);
    return filtered.sort(activeTab === 'decide' ? (a, b) => -byNew(a, b) : byNew);
  }, [base, status, q, reveal, display, activeTab]);

  const filtered = q.trim() !== '' || status !== 'all' || scope !== ALL_SCOPES;
  const reset = () => {
    setQ('');
    setStatus('all');
    setScope(ALL_SCOPES);
  };

  const query = activeTab === 'decide' ? pendingQ : mineQ;
  const isApproverView = canApprove;

  const tabs = [
    ...(canApprove ? [{ id: 'decide', label: 'Needs my decision', count: decideAll.filter((r) => inScope(r, scope)).length }] : []),
    ...(canApprove && canRequest ? [{ id: 'mine', label: 'My requests', count: mineAll.filter((r) => inScope(r, scope)).length }] : []),
  ];

  const statusCount = (s: StatusFilter) => base.filter((r) => matchesStatus(r, s, reveal.get(r.id))).length;

  const table = (
    <RequestTable
      rows={rows}
      me={me}
      decide={activeTab === 'decide'}
      showRequester={isApproverView}
      reveal={reveal}
      display={display}
      now={now}
    />
  );

  return (
    <div>
      <PageHeader
        title={isApproverView ? 'Requests' : 'My requests'}
        description={
          isApproverView
            ? 'Requests waiting for your decision, and your own requests. Values never appear in this list.'
            : 'Every request you made, newest first. Values never appear in this list.'
        }
        actions={
          canRequest ? (
            <Button variant="primary" onClick={() => setDrawerOpen(true)}>
              New request
            </Button>
          ) : undefined
        }
      />

      {tabs.length > 1 && (
        <div className="mb-4">
          <Tabs
            label="Request queues"
            idPrefix="requests"
            tabs={tabs}
            value={activeTab}
            onChange={(id) => {
              setTab(id as Tab);
              setStatus('all');
            }}
          />
        </div>
      )}

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
            {activeTab === 'mine' && <option value="reveal_ready">Reveal ready ({statusCount('reveal_ready')})</option>}
            <option value="closed">Closed ({statusCount('closed')})</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)} ({statusCount(s)})
              </option>
            ))}
          </Select>
        </label>
        {scopes.length > 0 && (
          <label className="flex-[0_1_220px] max-[600px]:flex-[1_1_140px]">
            <span className="sr-only">Scope</span>
            <Select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full">
              <option value={ALL_SCOPES}>All my scopes</option>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
        )}
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
        <TabPanel idPrefix="requests" value={activeTab}>
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
          ) : activeTab === 'decide' ? (
            <EmptyState title="Nothing is waiting for your decision.">
              Requests in your approval scope appear here, oldest first.
            </EmptyState>
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
            if (canApprove) setTab('mine');
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
  if (s === 'closed') return isClosed(r, reveal);
  if (s === 'reveal_ready') return r.status === 'executed' && reveal?.state === 'ready';
  return r.status === s;
}

// --- table ----------------------------------------------------------

function RequestTable({
  rows,
  me,
  decide,
  showRequester,
  reveal,
  display,
  now,
}: {
  rows: AccessRequest[];
  me: string;
  decide: boolean;
  showRequester: boolean;
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
        <div className="min-w-[220px] max-w-[360px]">
          <Link to={`/requests/${r.id}`} className="font-mono text-mono font-medium text-accent hover:underline">
            {requestRef(r.id)}
          </Link>
          <p className="mt-0.5 truncate font-mono text-mono text-ink" title={operationTitle(r)}>
            {keysOf(r).join(', ') || 'All keys'}
          </p>
          <p className="truncate font-mono text-mono-small text-muted" title={pathOf(r)}>
            {pathOf(r)}
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
          <div className="whitespace-nowrap">
            <p>{d.project}</p>
            {d.env && (
              <p className="mt-0.5">
                <EnvTag kind={d.envKind}>{d.env}</EnvTag>
              </p>
            )}
          </div>
        );
      },
    },
    ...(showRequester
      ? [
          {
            key: 'requester',
            header: 'Requester',
            render: (r: AccessRequest) => (
              <span className="whitespace-nowrap">
                {r.requester_id === me ? 'You' : (r.requester_display ?? 'Loading…')}
              </span>
            ),
          },
        ]
      : []),
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
        const c = reveal.get(r.id);
        if (c?.state === 'ready') {
          return (
            <time title={`Reveal deadline ${formatExact(c.deadline)}`} className="whitespace-nowrap font-mono text-mono text-ok">
              {formatRemaining(c.deadline, now)}
            </time>
          );
        }
        const at = ['pending', 'pending_values', 'pending_verification', 'approved'].includes(r.status)
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
        const n = nextAction(r, me, reveal.get(r.id), decide);
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
      label={decide ? 'Requests waiting for your decision' : 'Your requests'}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={open}
      minWidth={860}
    />
  );
}
