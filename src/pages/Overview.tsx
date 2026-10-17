/**
 * Overview (`/`) — what the signed-in person can act on, first.
 *
 * Requester: Needs you (reveals ready, recent failures), Open, Closed in
 * the last 3 days. Approver: the queue of requests waiting for their
 * decision, oldest first. Someone with both sees the queue, then their
 * own requests. The right rail holds recent activity, the scopes the
 * person can request in and, for agent viewers, agent health.
 *
 * Every count comes from the same records the lists show, under the
 * same scope filter. Nothing here is sample data: where the api doesn't
 * report something yet (approval lanes, who decided, the reveal
 * condition), the page says less rather than guess. See
 * src/requests/revealState.ts and useRequestDetails.ts for the two
 * small lookups that fill gaps until the api reports them.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAdminAgents, type AgentStatus } from '../api/agents';
import { useMe } from '../api/me';
import { useRequests } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { isOpen, needsMyDecision } from '../lib/requestQueues';
import { requestRef } from '../lib/requestRef';
import { useNow } from '../lib/useNow';
import { formatAge, formatExact, formatRemaining, formatShort, withinDays } from '../lib/time';
import { closedDetail, keysOf, pathOf, waitingOn } from '../requests/describe';
import { useRevealConditions, type RevealCondition } from '../requests/revealState';
import {
  ALL_SCOPES,
  inScope,
  scopeOptions,
  useScope,
  useScopeDisplay,
  type ScopeDisplay,
} from '../requests/scope';
import { useRequestDetails } from '../requests/useRequestDetails';
import { ActivityLog, type ActivityEvent } from '../ui/ActivityLog';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { Keys } from '../ui/Keys';
import { NeedsYou, type NeedsYouItem } from '../ui/NeedsYou';
import { PageHeader } from '../ui/PageHeader';
import { Select } from '../ui/Field';
import { ScopeLabel } from '../ui/ScopeLabel';
import { Status } from '../ui/Status';
import { useToast } from '../ui/toastContext';
import { RequestAccessDrawer } from './RequestAccessDrawer';

const RECENT_DAYS = 3;
/** Rows per section; the overview is a summary, the Requests page has the rest. */
const SHOW = 5;

export function Overview() {
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAllNeeds, setShowAllNeeds] = useState(false);

  // Requester: my requests. Approver: everything pending (the api only
  // returns other people's requests to global approvers).
  const mineQ = useRequests({ requester_id: me }, { enabled: !!me && canRequest });
  const pendingQ = useRequests({ status: 'pending' }, { enabled: !!me && canApprove });

  const mine = useMemo(
    () => (mineQ.data ?? []).filter((r) => r.requester_id === me && inScope(r, scope)),
    [mineQ.data, me, scope],
  );
  const reveal = useRevealConditions(mine, me);

  // Approver queue: pending, someone else's, not yet voted on. The
  // detail lookup adds the requester's name and the votes.
  const queueCandidates = useMemo(
    () => needsMyDecision(pendingQ.data ?? [], me).filter((r) => inScope(r, scope)),
    [pendingQ.data, me, scope],
  );
  const details = useRequestDetails(useMemo(() => queueCandidates.map((r) => r.id), [queueCandidates]));
  const queue = useMemo(
    () =>
      needsMyDecision(
        queueCandidates.map((r) => details.get(r.id) ?? r),
        me,
      ).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    [queueCandidates, details, me],
  );

  const now = useNow();
  const readyToReveal = mine
    .filter((r) => reveal.get(r.id)?.state === 'ready')
    .sort((a, b) => deadlineOf(reveal.get(a.id)) - deadlineOf(reveal.get(b.id)));
  const recentFailures = mine.filter((r) => r.status === 'failed' && withinDays(r.updated_at, RECENT_DAYS, now));
  const open = mine.filter(isOpen).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // A reveal that is still ready isn't closed: it sits in Needs you.
  const closed = mine
    .filter(
      (r) =>
        !isOpen(r) &&
        reveal.get(r.id)?.state !== 'ready' &&
        withinDays(r.updated_at ?? r.created_at, RECENT_DAYS, now),
    )
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at));

  const loading = (canRequest && mineQ.isLoading) || (canApprove && pendingQ.isLoading);
  const failed = (canRequest && mineQ.isError) || (canApprove && pendingQ.isError);
  const retry = () => {
    void mineQ.refetch();
    void pendingQ.refetch();
  };

  const summary = failed || loading
    ? undefined
    : summaryLine({
        canApprove,
        canRequest,
        queue,
        open: open.length,
        ready: readyToReveal.length,
        closed: closed.length,
        now,
      });

  const oldest = queue[0];
  const primary =
    canApprove && oldest ? (
      <Button variant="primary" onClick={() => navigate(`/requests/${oldest.id}`)}>
        Review oldest
      </Button>
    ) : canRequest ? (
      <Button variant="primary" onClick={() => setDrawerOpen(true)}>
        New request
      </Button>
    ) : null;
  const secondary =
    canApprove && oldest && canRequest ? (
      <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
        New request
      </Button>
    ) : null;

  const needsYou: NeedsYouItem[] = [
    ...readyToReveal.map((r) => {
      const c = reveal.get(r.id) as Extract<RevealCondition, { state: 'ready' }>;
      const d = display(r);
      return {
        key: r.id,
        ref: requestRef(r.id),
        to: `/requests/${r.id}`,
        keys: keysOf(r).join(', ') || 'All keys',
        project: d.project,
        env: d.env,
        envKind: d.envKind,
        note: `Reveal closes ${formatShort(c.deadline, now)} UTC · ${formatRemaining(c.deadline, now)}`,
        tone: 'ok' as const,
        action: (
          <Button variant="secondary" size="sm" onClick={() => navigate(`/requests/${r.id}`)}>
            Reveal<span className="sr-only"> {requestRef(r.id)}</span>
          </Button>
        ),
      };
    }),
    ...recentFailures.map((r) => {
      const d = display(r);
      return {
        key: r.id,
        ref: requestRef(r.id),
        to: `/requests/${r.id}`,
        keys: keysOf(r).join(', ') || 'All keys',
        project: d.project,
        env: d.env,
        envKind: d.envKind,
        note: `Agent read failed ${formatShort(r.updated_at, now)}`,
        tone: 'bad' as const,
        action: (
          <Button variant="secondary" size="sm" onClick={() => navigate(`/requests/${r.id}`)}>
            Review<span className="sr-only"> {requestRef(r.id)}</span>
          </Button>
        ),
      };
    }),
  ];

  const nothingAtAll = !loading && !failed && open.length === 0 && closed.length === 0 && queue.length === 0 && needsYou.length === 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        description={summary}
        actions={
          <>
            {scopes.length > 0 && (
              <label className="flex items-center gap-2 text-ui font-normal text-muted max-[600px]:w-full">
                Scope
                <Select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="w-[230px] max-[600px]:flex-1"
                >
                  <option value={ALL_SCOPES}>All my scopes</option>
                  {scopes.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {secondary}
            {primary}
          </>
        }
      />

      {failed && (
        <Banner
          tone="error"
          title="Couldn't load requests."
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          }
          className="mb-6"
        >
          Nothing on this page is counted until they load.
        </Banner>
      )}

      {loading && <p className="text-muted">Loading requests…</p>}

      {!loading && !failed && (
        <div className="grid grid-cols-1 gap-7 min-[1361px]:grid-cols-[minmax(0,1fr)_var(--rail)]">
          <div className="flex min-w-0 flex-col gap-8">
            {nothingAtAll && (
              <EmptyState
                title={canRequest ? 'No requests yet.' : 'Nothing waits for your decision.'}
                action={
                  canRequest ? (
                    <Button variant="primary" onClick={() => setDrawerOpen(true)}>
                      New request
                    </Button>
                  ) : undefined
                }
              >
                {canRequest
                  ? 'Ask for access to a secret. Someone approves it, then the agent reads it for you.'
                  : 'Requests that need your approval appear here, oldest first.'}
              </EmptyState>
            )}

            {needsYou.length > 0 && (
              <Section title="Needs you" count={needsYou.length}>
                <NeedsYou items={showAllNeeds ? needsYou : needsYou.slice(0, SHOW)} />
                {needsYou.length > SHOW && (
                  <Button variant="quiet" size="sm" className="mt-1.5" onClick={() => setShowAllNeeds((v) => !v)} aria-expanded={showAllNeeds}>
                    {showAllNeeds ? 'Show fewer' : `Show ${needsYou.length - SHOW} more`}
                  </Button>
                )}
              </Section>
            )}

            {canApprove && queue.length > 0 && (
              <Section
                title="Your queue"
                count={queue.length}
                link={{ to: '/requests', label: queue.length > SHOW ? `All ${queue.length} waiting` : 'All requests' }}
              >
                <QueueTable rows={queue.slice(0, SHOW)} display={display} now={now} />
              </Section>
            )}

            {canRequest && open.length > 0 && (
              <Section
                title="Open"
                count={open.length}
                link={{ to: '/requests?tab=open', label: open.length > SHOW ? `All ${open.length} open requests` : 'Open requests' }}
              >
                <OpenTable rows={open.slice(0, SHOW)} display={display} now={now} />
              </Section>
            )}

            {canRequest && closed.length > 0 && (
              <Section title={`Closed · last ${RECENT_DAYS} days`} count={closed.length} link={{ to: '/requests?tab=closed', label: 'All closed requests' }}>
                <ClosedTable rows={closed.slice(0, SHOW)} display={display} reveal={reveal} now={now} />
              </Section>
            )}
          </div>

          <Rail
            mine={mine}
            queue={queue}
            me={me}
            canRequest={canRequest}
            now={now}
            scopes={scope === ALL_SCOPES ? scopes : scopes.filter((s) => s.value === scope)}
          />
        </div>
      )}

      {drawerOpen && identity && (
        <RequestAccessDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={(id) => {
            setDrawerOpen(false);
            toast(`Request ${requestRef(id)} submitted.`, { to: `/requests/${id}`, label: 'Open it' });
          }}
        />
      )}
    </div>
  );
}

// --- summary --------------------------------------------------------

function summaryLine(p: {
  canApprove: boolean;
  canRequest: boolean;
  queue: AccessRequest[];
  open: number;
  ready: number;
  closed: number;
  now: number;
}): string {
  const parts: string[] = [];
  if (p.canApprove) {
    parts.push(
      p.queue.length > 0
        ? `${p.queue.length} waiting for your decision · oldest ${formatAge(p.queue[0].created_at, p.now)}`
        : 'Nothing waits for your decision',
    );
  }
  if (p.canRequest) {
    parts.push(`${p.open} open`);
    if (p.ready > 0) parts.push(`${p.ready} ready to reveal`);
    parts.push(`${p.closed} closed in the last ${RECENT_DAYS} days`);
  }
  return parts.join(' · ');
}

function deadlineOf(c: RevealCondition | undefined): number {
  return c?.state === 'ready' ? Date.parse(c.deadline) : Number.POSITIVE_INFINITY;
}

// --- layout bits ----------------------------------------------------

function Section({
  title,
  count,
  link,
  children,
}: {
  title: string;
  count: number;
  link?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-block-heading text-ink">
          {title} <span className="ml-1 font-mono text-mono-small font-normal text-muted">{count}</span>
        </h2>
        {link && (
          <Link to={link.to} className="text-ui font-normal text-accent hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function ScopeCell({ d }: { d: ScopeDisplay }) {
  return (
    <ScopeLabel project={d.project} env={d.env} envKind={d.envKind} />
  );
}

function RefLink({ r }: { r: AccessRequest }) {
  return (
    <Link to={`/requests/${r.id}`} className="whitespace-nowrap font-mono text-mono font-medium text-accent hover:underline">
      {requestRef(r.id)}
    </Link>
  );
}

/** Keys first (what was asked for), the reference and path under them. */
function RequestCell({ r }: { r: AccessRequest }) {
  return (
    <div className="min-w-[160px] max-w-[250px]">
      <Link
        to={`/requests/${r.id}`}
        title={keysOf(r).join(', ') || 'All keys'}
        className="block truncate font-mono text-mono font-medium text-ink hover:text-accent hover:underline"
      >
        {keysOf(r).join(', ') || 'All keys'}
      </Link>
      <p className="mt-0.5 font-mono text-mono-small text-muted" title={pathOf(r)}>
        {requestRef(r.id)}
      </p>
    </div>
  );
}

function Age({ iso, now }: { iso?: string; now: number }) {
  return (
    <time title={formatExact(iso)} className="whitespace-nowrap font-mono text-mono text-muted">
      {formatAge(iso, now)}
    </time>
  );
}

// --- tables ---------------------------------------------------------

type Display = (r: AccessRequest) => ScopeDisplay;

function useOpenRow() {
  const navigate = useNavigate();
  return (r: AccessRequest) => navigate(`/requests/${r.id}`);
}

function Stacked({ r, d, right, children }: { r: AccessRequest; d: ScopeDisplay; right: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <RefLink r={r} />
        {right}
      </div>
      <Keys keys={keysOf(r)} className="whitespace-normal break-all" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
        <ScopeCell d={d} />
        <Status status={r.status} />
      </div>
      {children}
    </div>
  );
}

function OpenTable({ rows, display, now }: { rows: AccessRequest[]; display: Display; now: number }) {
  const open = useOpenRow();
  const columns: Column<AccessRequest>[] = [
    { key: 'request', header: 'Request', render: (r) => <RequestCell r={r} /> },
    { key: 'scope', header: 'Scope', render: (r) => <ScopeCell d={display(r)} /> },
    { key: 'state', header: 'State', render: (r) => <Status status={r.status} /> },
    { key: 'wait', header: 'Waiting on', render: (r) => <span className="whitespace-nowrap text-muted">{waitingOn(r)}</span> },
    { key: 'age', header: 'Opened', align: 'right', render: (r) => <Age iso={r.created_at} now={now} /> },
  ];
  return (
    <DataTable
      label="Open requests"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={open}
      alignTop
      stacked={(r) => (
        <Stacked r={r} d={display(r)} right={<Age iso={r.created_at} now={now} />}>
          <span className="text-caption text-muted">{waitingOn(r)}</span>
        </Stacked>
      )}
    />
  );
}

function ClosedTable({
  rows,
  display,
  reveal,
  now,
}: {
  rows: AccessRequest[];
  display: Display;
  reveal: Map<string, RevealCondition>;
  now: number;
}) {
  const open = useOpenRow();
  const columns: Column<AccessRequest>[] = [
    { key: 'request', header: 'Request', render: (r) => <RequestCell r={r} /> },
    { key: 'scope', header: 'Scope', render: (r) => <ScopeCell d={display(r)} /> },
    { key: 'state', header: 'Outcome', render: (r) => <Status status={r.status} /> },
    {
      key: 'detail',
      header: 'Detail',
      render: (r) => (
        <span title={closedDetail(r, reveal.get(r.id))} className="block max-w-[200px] truncate text-muted">
          {closedDetail(r, reveal.get(r.id))}
        </span>
      ),
    },
    { key: 'age', header: 'Closed', align: 'right', render: (r) => <Age iso={r.updated_at} now={now} /> },
  ];
  return (
    <DataTable
      label="Closed requests"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={open}
      alignTop
      stacked={(r) => (
        <Stacked r={r} d={display(r)} right={<Age iso={r.updated_at} now={now} />}>
          <span className="text-caption text-muted">{closedDetail(r, reveal.get(r.id))}</span>
        </Stacked>
      )}
    />
  );
}

function QueueTable({ rows, display, now }: { rows: AccessRequest[]; display: Display; now: number }) {
  const navigate = useNavigate();
  const open = useOpenRow();
  const review = (r: AccessRequest) => (
    <Button variant="secondary" size="sm" onClick={() => navigate(`/requests/${r.id}`)}>
      Review<span className="sr-only"> {requestRef(r.id)}</span>
    </Button>
  );
  const columns: Column<AccessRequest>[] = [
    { key: 'request', header: 'Request', render: (r) => <RequestCell r={r} /> },
    { key: 'who', header: 'Requester', render: (r) => <span className="whitespace-nowrap">{r.requester_display ?? 'Loading…'}</span> },
    {
      key: 'keys',
      header: 'Reason',
      render: (r) => (
        <p title={r.justification} className="m-0 max-w-[190px] truncate text-muted">
          {r.justification}
        </p>
      ),
    },
    { key: 'scope', header: 'Scope', render: (r) => <ScopeCell d={display(r)} /> },
    { key: 'age', header: 'Waiting', align: 'right', render: (r) => <Age iso={r.created_at} now={now} /> },
    { key: 'act', header: 'Action', hiddenHeader: true, align: 'right', render: review },
  ];
  return (
    <DataTable
      label="Your queue"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={open}
      alignTop
      stacked={(r) => (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <RefLink r={r} />
              <Age iso={r.created_at} now={now} />
            </div>
            <span className="text-ui">{r.requester_display ?? ''}</span>
            <Keys keys={keysOf(r)} className="whitespace-normal break-all" />
            <p className="text-caption text-muted">{r.justification}</p>
            <ScopeCell d={display(r)} />
          </div>
          {review(r)}
        </div>
      )}
    />
  );
}

// --- right rail -----------------------------------------------------

function Rail({
  mine,
  queue,
  me,
  canRequest,
  now,
  scopes,
}: {
  mine: AccessRequest[];
  queue: AccessRequest[];
  me: string;
  canRequest: boolean;
  now: number;
  scopes: ReturnType<typeof scopeOptions>;
}) {
  const { hasPermission } = useAuth();
  const events = useMemo(() => activityFrom(mine, queue, me, now), [mine, queue, me, now]);
  return (
    <aside
      aria-label="Activity and scopes"
      className="grid grid-cols-1 content-start gap-7 max-[1360px]:grid-cols-2 max-[700px]:grid-cols-1"
    >
      <section>
        <h2 className="mb-1 text-block-heading text-ink">Activity</h2>
        {events.length > 0 ? (
          <ActivityLog events={events} />
        ) : (
          <p className="text-caption text-muted">Nothing has happened in your requests yet.</p>
        )}
      </section>

      <div className="flex flex-col gap-7">
        {canRequest && (
          <section>
            <h2 className="mb-1 border-b border-border pb-2 text-block-heading text-ink">You can request in</h2>
            {scopes.length > 0 ? (
              <ul className="m-0 list-none p-0">
                {scopes.map((s) => (
                  <li key={s.value} className="border-b border-rule py-2.5 text-ui font-normal">
                    <ScopeLabel project={s.projectName} env={s.envName} envKind={s.envKind} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-caption text-muted">
                You aren't granted any project yet. Ask an administrator for access.
              </p>
            )}
          </section>
        )}
        {hasPermission('agent.list') && <AgentsBlock />}
      </div>
    </aside>
  );
}

function AgentsBlock() {
  const agents = useAdminAgents();
  const rows = agents.data ?? [];
  const count = (s: AgentStatus) => rows.filter((a) => a.status === s).length;
  const summary = [
    `${count('active')} active`,
    count('stale') && `${count('stale')} stale`,
    count('enrolled') && `${count('enrolled')} waiting for a heartbeat`,
    count('error') && `${count('error')} with errors`,
    count('revoked') && `${count('revoked')} revoked`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-block-heading text-ink">Agents</h2>
        <Link to="/agents" className="text-ui font-normal text-accent hover:underline">
          All agents
        </Link>
      </div>
      <p className="py-2.5 text-ui font-normal">
        {agents.isLoading
          ? 'Loading…'
          : agents.isError
            ? "Couldn't load agents."
            : rows.length === 0
              ? 'No agents are connected yet.'
              : summary}
      </p>
    </section>
  );
}

// Activity from the requests on this page: when each was opened and the
// state it reached last. The api has no per-request event list for
// requesters yet, so who approved isn't shown.
function activityFrom(mine: AccessRequest[], queue: AccessRequest[], me: string, now: number): ActivityEvent[] {
  const seen = new Set<string>();
  const events: (ActivityEvent & { at: number })[] = [];
  for (const r of [...mine, ...queue]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const ref = requestRef(r.id);
    const to = `/requests/${r.id}`;
    const who = r.requester_id === me ? 'You' : r.requester_display ?? 'Someone';
    events.push({
      key: `${r.id}:created`,
      at: Date.parse(r.created_at),
      time: formatShort(r.created_at, now),
      exact: formatExact(r.created_at, true),
      actor: who,
      verb: r.type === 'cross_team' ? 'requested values from another team' : 'requested',
      ref,
      to,
    });
    const verb = STATE_VERB[r.status];
    if (verb && r.updated_at) {
      events.push({
        key: `${r.id}:${r.status}`,
        at: Date.parse(r.updated_at),
        time: formatShort(r.updated_at, now),
        exact: formatExact(r.updated_at, true),
        actor: ref,
        verb: verb.text,
        tone: verb.tone,
      });
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, 9);
}

const STATE_VERB: Partial<Record<AccessRequest['status'], { text: string; tone: ActivityEvent['tone'] }>> = {
  approved: { text: 'approved, waiting for the agent', tone: 'ok' },
  executed: { text: 'executed by the agent', tone: 'ok' },
  rejected: { text: 'rejected', tone: 'bad' },
  refused: { text: 'refused by the supplying team', tone: 'bad' },
  failed: { text: 'failed at the agent', tone: 'bad' },
  cancelled: { text: 'cancelled', tone: 'neutral' },
  expired: { text: 'expired without a decision', tone: 'neutral' },
  pending_verification: { text: 'has values, waiting for verification', tone: 'neutral' },
};
