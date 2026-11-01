/**
 * Overview (`/`): the one thing to do now, then the rest.
 *
 * Counters switch the page between what needs this person, their requests
 * in motion and what closed in the last 3 days. Under Needs you, the
 * first item is Next up with its context and action, and the rest sit
 * below it as rows: decisions oldest first, reveals that are ready,
 * people waiting for an account, agents gone stale, recent failures, and
 * last any decision past its deadline, which can no longer be approved.
 * The right rail holds system health or the person's own requests, recent
 * activity, and the scopes they can request in.
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

import { useAdminAgents, type AdminAgent } from '../api/agents';
import { useMe } from '../api/me';
import { usePendingUsers } from '../api/pendingUsers';
import { useRequests } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useWorkflows } from '../api/workflows';
import { useAuth } from '../auth/AuthContext';
import { roleLabelFor } from '../auth/roleLabel';
import { AGENT_STATUS_TONE } from '../lib/agentStatus';
import { isOpen, needsMyDecision } from '../lib/requestQueues';
import { requestRef } from '../lib/requestRef';
import { useNow } from '../lib/useNow';
import { formatAge, formatClock, formatDay, formatExact, formatRemaining, formatShort, withinDays } from '../lib/time';
import { pastDeadline } from '../requests/deadline';
import { askedFor, closedDetail, keysOf, pathOf, waitingOn } from '../requests/describe';
import { useRevealConditions, type RevealCondition } from '../requests/revealState';
import { ALL_SCOPES, inScope, scopeOptions, useScope, useScopeDisplay, type ScopeDisplay } from '../requests/scope';
import { useRequestDetails } from '../requests/useRequestDetails';
import { ActivityLog, type ActivityEvent } from '../ui/ActivityLog';
import { Avatar } from '../ui/Avatar';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Counters } from '../ui/Counters';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { EnvTag } from '../ui/EnvTag';
import { Keys } from '../ui/Keys';
import { PageHeader } from '../ui/PageHeader';
import { ScopeLabel } from '../ui/ScopeLabel';
import { Status, ToneStatus } from '../ui/Status';
import { TabPanel } from '../ui/Tabs';
import { useToast } from '../ui/toastContext';
import { NextDecision, NextPanel, NextTitle, StateMark, ThenList, ThenRow } from './focus/NextUp';
import { ApproveDialog, RejectDialog } from './request/DecisionDialogs';
import { RequestAgainDrawer } from './request/RequestAgainDrawer';
import { RequestAccessDrawer } from './RequestAccessDrawer';

const RECENT_DAYS = 3;
/** Rows per list; the overview is a summary, the Requests page has the rest. */
const SHOW = 5;

type Item =
  | { kind: 'decision'; r: AccessRequest }
  | { kind: 'reveal'; r: AccessRequest; deadline: string }
  | { kind: 'accounts'; count: number }
  | { kind: 'agent'; agent: AdminAgent }
  | { kind: 'failure'; r: AccessRequest }
  | { kind: 'overdue'; r: AccessRequest };

export function Overview() {
  const navigate = useNavigate();
  const toast = useToast();
  const { identity, hasPermission } = useAuth();
  const me = identity?.id ?? '';
  const canRequest = hasPermission('secret.request');
  const canApprove = hasPermission('secret.approve');
  const canSeeAgents = hasPermission('agent.list');
  // People waiting for an admin's approval (api#266), for whoever can
  // approve them.
  const canApproveUsers = hasPermission('user_role.edit');
  const waitingUsers = usePendingUsers({ enabled: canApproveUsers }).data?.total ?? 0;
  const agents = useAdminAgents({ enabled: canSeeAgents });
  const { scope } = useScope();
  const meQ = useMe();
  const scopes = useMemo(() => scopeOptions(meQ.data?.projects), [meQ.data]);
  const display = useScopeDisplay();
  const workflows = useWorkflows();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [again, setAgain] = useState<AccessRequest | null>(null);
  const [decide, setDecide] = useState<{ kind: 'approve' | 'reject'; r: AccessRequest } | null>(null);
  const [view, setView] = useState('needs');
  const [showAll, setShowAll] = useState(false);

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

  const staleAgents = (agents.data ?? []).filter((a) => a.status === 'stale');
  const liveQueue = queue.filter((r) => !pastDeadline(r, workflows.data, now));
  const overdue = queue.filter((r) => pastDeadline(r, workflows.data, now));

  const items: Item[] = [
    ...liveQueue.map((r): Item => ({ kind: 'decision', r })),
    ...readyToReveal.map((r): Item => {
      const c = reveal.get(r.id) as Extract<RevealCondition, { state: 'ready' }>;
      return { kind: 'reveal', r, deadline: c.deadline };
    }),
    ...(waitingUsers > 0 ? [{ kind: 'accounts', count: waitingUsers } as Item] : []),
    ...staleAgents.map((agent): Item => ({ kind: 'agent', agent })),
    ...recentFailures.map((r): Item => ({ kind: 'failure', r })),
    ...overdue.map((r): Item => ({ kind: 'overdue', r })),
  ];
  const [next, ...then] = items;

  const loading = (canRequest && mineQ.isLoading) || (canApprove && pendingQ.isLoading);
  const failed = (canRequest && mineQ.isError) || (canApprove && pendingQ.isError);
  const retry = () => {
    void mineQ.refetch();
    void pendingQ.refetch();
  };

  const counters = [
    { id: 'needs', count: items.length, label: needsLabel(items), short: 'Needs you' },
    ...(canRequest
      ? [
          { id: 'open', count: open.length, label: 'In motion · your requests', short: 'In motion' },
          { id: 'closed', count: closed.length, label: `Closed · last ${RECENT_DAYS} days`, short: 'Closed' },
        ]
      : []),
  ];

  const newRequest = canRequest ? (
    <Button variant={next ? 'secondary' : 'primary'} onClick={() => setDrawerOpen(true)}>
      New request
    </Button>
  ) : undefined;

  const openRequest = (r: AccessRequest) => navigate(`/requests/${r.id}`);
  const reviewButton = (r: AccessRequest) => (
    <Button variant="secondary" size="sm" onClick={() => openRequest(r)}>
      Review<span className="sr-only"> {requestRef(r.id)}</span>
    </Button>
  );
  const againButton = (r: AccessRequest, big?: boolean) => (
    <Button variant={big ? 'primary' : 'secondary'} size={big ? 'md' : 'sm'} onClick={() => setAgain(r)}>
      Request again<span className="sr-only"> {requestRef(r.id)}</span>
    </Button>
  );
  const failureTitle = (r: AccessRequest) => `A ${display(r).project} ${r.type === 'read' ? 'read' : 'write'} failed`;
  const failureLine = (r: AccessRequest) => (
    <>
      Nothing was {r.type === 'read' ? 'retrieved' : 'written'}.
      {r.job_id ? (
        <>
          {' '}
          Your platform team can look up job <span className="font-mono text-mono text-ink">{r.job_id.slice(0, 8)}</span>.
        </>
      ) : null}
    </>
  );
  const scopeRow = (d: ScopeDisplay) => (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-caption text-ink">{d.project}</span>
      {d.env && <EnvTag kind={d.envKind}>{d.env}</EnvTag>}
    </span>
  );

  const nextPanel = (item: Item): ReactNode => {
    switch (item.kind) {
      case 'decision':
        return (
          <NextDecision
            r={item.r}
            display={display(item.r)}
            now={now}
            onApprove={() => setDecide({ kind: 'approve', r: item.r })}
            onReject={() => setDecide({ kind: 'reject', r: item.r })}
          />
        );
      case 'reveal': {
        const d = display(item.r);
        return (
          <NextPanel
            id="next-reveal"
            soft
            eyebrow={`Next up · reveal before ${formatClock(item.deadline)}`}
            aside={
              <>
                <span className="font-mono text-mono">{requestRef(item.r.id)}</span>
                <Status status={item.r.status} />
              </>
            }
          >
            <NextTitle id="next-reveal">Your {d.env ?? d.project} values are ready</NextTitle>
            <div className="flex flex-wrap items-center gap-2">
              {scopeRow(d)}
              <Keys keys={keysOf(item.r)} variant="chips" />
            </div>
            <p className="m-0 text-caption text-ink">
              You can reveal each value once ({formatRemaining(item.deadline, now)}). You'll confirm with your second factor first.
            </p>
            <div>
              <Button variant="primary" className="h-11 px-[18px] text-[15px]" onClick={() => openRequest(item.r)}>
                Reveal values…
              </Button>
            </div>
          </NextPanel>
        );
      }
      case 'accounts':
        return (
          <NextPanel id="next-accounts" eyebrow="Next up · people waiting" aside={<ToneStatus tone="warn">{item.count} waiting</ToneStatus>}>
            <NextTitle id="next-accounts">{accountsTitle(item.count)}</NextTitle>
            <p className="m-0 text-caption text-ink">
              They signed in with Google and can't do anything until you give them a role. Declining disables the account.
            </p>
            <div>
              <Button variant="primary" className="h-11 px-[18px] text-[15px]" onClick={() => navigate('/admin/users')}>
                Review accounts
              </Button>
            </div>
          </NextPanel>
        );
      case 'agent':
        return (
          <NextPanel id="next-agent" eyebrow="Next up · agent stale" aside={<ToneStatus tone="bad">Stale</ToneStatus>}>
            <NextTitle id="next-agent">Agent {item.agent.name} is stale</NextTitle>
            <p className="m-0 text-caption text-ink">It stopped sending heartbeats. Check it on the Agents page.</p>
            <div>
              <Button variant="primary" className="h-11 px-[18px] text-[15px]" onClick={() => navigate('/agents')}>
                View agents
              </Button>
            </div>
          </NextPanel>
        );
      case 'failure':
      case 'overdue': {
        const isFailure = item.kind === 'failure';
        const d = display(item.r);
        return (
          <NextPanel id="next-failed" eyebrow={isFailure ? 'Next up · failed' : 'Next up · past its deadline'} aside={<span className="font-mono text-mono">{requestRef(item.r.id)}</span>}>
            <NextTitle id="next-failed">{isFailure ? failureTitle(item.r) : `${item.r.requester_display ?? 'Someone'} ${askedFor(item.r, d)}`}</NextTitle>
            <p className="m-0 text-caption text-ink">{isFailure ? failureLine(item.r) : "This request is past its deadline, so approving it would be refused."}</p>
            <div className="flex flex-wrap items-center gap-2.5">
              {isFailure ? againButton(item.r, true) : reviewButton(item.r)}
              <Link to={`/requests/${item.r.id}`} className="text-caption text-accent-ink underline underline-offset-[3px] hover:decoration-2">
                See full request
              </Link>
            </div>
          </NextPanel>
        );
      }
    }
  };

  const thenRow = (item: Item): ReactNode => {
    switch (item.kind) {
      case 'decision':
      case 'overdue': {
        const d = display(item.r);
        return (
          <ThenRow
            key={item.r.id}
            mark={<Avatar name={item.r.requester_display ?? '?'} size="sm" />}
            to={`/requests/${item.r.id}`}
            title={
              <>
                <span className="font-semibold">{item.r.requester_display ?? requestRef(item.r.id)}</span>{' '}
                <span className="text-caption text-muted">{askedFor(item.r, d)}</span>
              </>
            }
            meta={item.kind === 'overdue' ? 'past its deadline' : formatAge(item.r.created_at, now)}
            action={reviewButton(item.r)}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {scopeRow(d)}
              <Keys keys={keysOf(item.r)} variant="chips" />
            </span>
          </ThenRow>
        );
      }
      case 'reveal':
        return (
          <ThenRow
            key={item.r.id}
            mark={<StateMark tone="ready" />}
            to={`/requests/${item.r.id}`}
            title={<span className="font-semibold">Your {display(item.r).env ?? display(item.r).project} values are ready</span>}
            meta={formatRemaining(item.deadline, now)}
            metaTone="ready"
            action={
              <Button variant="primary" size="sm" onClick={() => openRequest(item.r)}>
                Reveal once<span className="sr-only"> {requestRef(item.r.id)}</span>
              </Button>
            }
          >
            <span className="font-mono text-mono-small text-muted">
              {requestRef(item.r.id)} · {display(item.r).project} · {keysOf(item.r).length || 'all'} keys
            </span>
          </ThenRow>
        );
      case 'accounts':
        return (
          <ThenRow
            key="accounts"
            mark={<StateMark tone="count">{item.count}</StateMark>}
            to="/admin/users"
            title={<span className="font-semibold">{accountsTitle(item.count)}</span>}
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/admin/users')}>
                Review accounts
              </Button>
            }
          >
            <span className="text-caption text-muted">They can't do anything until you give them a role.</span>
          </ThenRow>
        );
      case 'agent':
        return (
          <ThenRow
            key={item.agent.id}
            mark={<StateMark tone="bad" />}
            to="/agents"
            title={<span className="font-semibold">Agent {item.agent.name} is stale</span>}
            meta={item.agent.last_seen_at ? formatAge(item.agent.last_seen_at, now) : undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/agents')}>
                View agent<span className="sr-only"> {item.agent.name}</span>
              </Button>
            }
          >
            <span className="text-caption text-muted">It stopped sending heartbeats.</span>
          </ThenRow>
        );
      case 'failure':
        return (
          <ThenRow
            key={item.r.id}
            mark={<StateMark tone="bad" />}
            to={`/requests/${item.r.id}`}
            title={<span className="font-semibold">{failureTitle(item.r)}</span>}
            meta={formatAge(item.r.updated_at, now)}
            action={againButton(item.r)}
          >
            <span className="text-caption text-muted">{failureLine(item.r)}</span>
          </ThenRow>
        );
    }
  };

  const eyebrow = `${formatDay(now)} · ${identity?.display_name ?? ''}${identity ? `, ${roleLabelFor(identity.permissions).toLowerCase()}` : ''}`;
  const shownThen = showAll ? then : then.slice(0, SHOW);

  return (
    <div>
      <PageHeader title="Overview" eyebrow={eyebrow} actions={newRequest} />

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
        <div className="flex flex-col gap-6">
          {counters.length > 1 && <Counters counters={counters} value={view} onChange={setView} label="Show" idPrefix="overview" />}

          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
              <TabPanel idPrefix="overview" value={view}>
                {view === 'needs' && (
                  <div className="flex flex-col gap-5">
                    {next ? (
                      nextPanel(next)
                    ) : (
                      <EmptyState
                        title={canRequest ? 'Nothing needs you right now.' : 'Nothing waits for your decision.'}
                        action={newRequest}
                      >
                        {canRequest
                          ? 'Ask for access to a secret. Someone approves it, then the agent reads it for you.'
                          : 'Requests that need your approval appear here, oldest first.'}
                      </EmptyState>
                    )}
                    {then.length > 0 && (
                      <ThenList
                        title="Then"
                        id="overview-then"
                        link={
                          canApprove && liveQueue.length > 1 ? (
                            <Link to="/approvals" className="text-caption text-accent-ink hover:underline">
                              Open approvals
                            </Link>
                          ) : undefined
                        }
                      >
                        {shownThen.map(thenRow)}
                        {then.length > SHOW && (
                          <li className="px-3.5 py-1.5">
                            <Button variant="quiet" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                              {showAll ? 'Show fewer' : `Show ${then.length - SHOW} more`}
                            </Button>
                          </li>
                        )}
                      </ThenList>
                    )}
                  </div>
                )}
                {view === 'open' &&
                  (open.length > 0 ? (
                    <Section link={{ to: '/requests?tab=open', label: open.length > SHOW ? `All ${open.length} open requests` : 'Open requests' }}>
                      <OpenTable rows={open.slice(0, SHOW)} display={display} now={now} />
                    </Section>
                  ) : (
                    <EmptyState title="Nothing in motion right now." action={newRequest}>
                      Requests you make appear here while they wait for a decision or an agent.
                    </EmptyState>
                  ))}
                {view === 'closed' &&
                  (closed.length > 0 ? (
                    <Section link={{ to: '/requests?tab=closed', label: 'All closed requests' }}>
                      <ClosedTable rows={closed.slice(0, SHOW)} display={display} reveal={reveal} now={now} />
                    </Section>
                  ) : (
                    <EmptyState title={`Nothing closed in the last ${RECENT_DAYS} days.`}>Requests appear here once they are revealed, rejected, cancelled, expired or failed.</EmptyState>
                  ))}
              </TabPanel>
            </div>

            <Rail
              mine={mine}
              open={open}
              queue={queue}
              me={me}
              canRequest={canRequest}
              now={now}
              display={display}
              agents={canSeeAgents ? agents : undefined}
              scopes={scope === ALL_SCOPES ? scopes : scopes.filter((s) => s.value === scope)}
            />
          </div>
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
      {again && identity && (
        <RequestAgainDrawer
          request={again}
          onClose={() => setAgain(null)}
          onCreated={(id) => {
            setAgain(null);
            toast(`Request ${requestRef(id)} submitted.`, { to: `/requests/${id}`, label: 'Open it' });
          }}
        />
      )}
      {decide?.kind === 'approve' && (
        <ApproveDialog
          request={decide.r}
          display={display(decide.r)}
          lastApproval={undefined}
          onClose={() => setDecide(null)}
          onDone={(message) => {
            setDecide(null);
            toast(message);
          }}
        />
      )}
      {decide?.kind === 'reject' && (
        <RejectDialog
          request={decide.r}
          display={display(decide.r)}
          onClose={() => setDecide(null)}
          onDone={(message) => {
            setDecide(null);
            toast(message);
          }}
        />
      )}
    </div>
  );
}

// --- summary --------------------------------------------------------

function needsLabel(items: Item[]): string {
  const count = (kinds: Item['kind'][]) => items.filter((i) => kinds.includes(i.kind)).length;
  const part = (n: number, one: string, many: string) => (n > 0 ? `${n} ${n === 1 ? one : many}` : '');
  const accounts = items.find((i) => i.kind === 'accounts');
  const parts = [
    part(count(['decision', 'overdue']), 'decision', 'decisions'),
    part(count(['reveal']), 'reveal', 'reveals'),
    part(accounts?.kind === 'accounts' ? accounts.count : 0, 'account', 'accounts'),
    part(count(['agent']), 'agent', 'agents'),
    part(count(['failure']), 'failure', 'failures'),
  ].filter(Boolean);
  return parts.length > 0 ? `Needs you · ${parts.join(', ')}` : 'Needs you';
}

function accountsTitle(n: number): string {
  return n === 1 ? '1 person is waiting for account approval' : `${n} people are waiting for account approval`;
}

function deadlineOf(c: RevealCondition | undefined): number {
  return c?.state === 'ready' ? Date.parse(c.deadline) : Number.POSITIVE_INFINITY;
}

// --- layout bits ----------------------------------------------------

function Section({ link, children }: { link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section>
      {children}
      {link && (
        <p className="mt-2.5 text-right">
          <Link to={link.to} className="text-caption text-accent-ink hover:underline">
            {link.label}
          </Link>
        </p>
      )}
    </section>
  );
}

function ScopeCell({ d }: { d: ScopeDisplay }) {
  return (
    <ScopeLabel project={d.project} env={d.env} envKind={d.envKind} logo={d.logo} />
  );
}

function RefLink({ r }: { r: AccessRequest }) {
  return (
    <Link to={`/requests/${r.id}`} className="whitespace-nowrap font-mono text-mono font-medium text-accent-ink hover:underline">
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
        className="block truncate font-mono text-mono font-medium text-ink hover:text-accent-ink hover:underline"
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

// --- right rail -----------------------------------------------------

function RailPanel({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-block-heading text-ink">{title}</h2>
        {link && (
          <Link to={link.to} className="text-caption text-accent-ink hover:underline">
            {link.label}
          </Link>
        )}
      </CardHeader>
      {children}
    </Card>
  );
}

function Rail({
  mine,
  open,
  queue,
  me,
  canRequest,
  now,
  display,
  agents,
  scopes,
}: {
  mine: AccessRequest[];
  open: AccessRequest[];
  queue: AccessRequest[];
  me: string;
  canRequest: boolean;
  now: number;
  display: Display;
  agents?: ReturnType<typeof useAdminAgents>;
  scopes: ReturnType<typeof scopeOptions>;
}) {
  const { hasPermission } = useAuth();
  const events = useMemo(() => activityFrom(mine, queue, me, now), [mine, queue, me, now]);
  const projects = useMemo(() => {
    const by = new Map<string, typeof scopes>();
    for (const s of scopes) by.set(s.projectId, [...(by.get(s.projectId) ?? []), s]);
    return [...by.values()];
  }, [scopes]);
  return (
    <aside aria-label="Health, activity and scopes" className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
      {agents && <SystemHealth agents={agents} />}

      {!agents && canRequest && open.length > 0 && (
        <RailPanel title="Your requests" link={{ to: '/requests', label: 'All' }}>
          <ul className="m-0 list-none p-1.5">
            {open.slice(0, 3).map((r) => {
              const d = display(r);
              return (
                <li key={r.id} className="relative rounded-lg px-3.5 py-3 hover:bg-hover">
                  <div className="flex items-center justify-between gap-3">
                    <Link to={`/requests/${r.id}`} className="font-mono text-mono text-ink after:absolute after:inset-0 after:rounded-lg">
                      {requestRef(r.id)}
                    </Link>
                    <Status status={r.status} />
                  </div>
                  <p className="m-0 mt-[3px] truncate text-caption text-ink">
                    {r.type === 'patch' ? 'Change' : r.type === 'cross_team' ? 'Supply' : 'Read'} {keysOf(r).join(', ') || 'all keys'} · {d.project} {d.env}
                  </p>
                </li>
              );
            })}
          </ul>
        </RailPanel>
      )}

      <RailPanel title="Recent activity" link={hasPermission('audit.read') ? { to: '/audit', label: 'Audit log' } : undefined}>
        <div className="px-4 py-1">
          {events.length > 0 ? (
            <ActivityLog events={events} />
          ) : (
            <p className="py-3 text-caption text-muted">Nothing has happened in your requests yet.</p>
          )}
        </div>
      </RailPanel>

      {canRequest && (
        <RailPanel title="You can request in">
          <div className="flex flex-col gap-3 p-4">
            {projects.length > 0 ? (
              projects.map((list) => (
                <div key={list[0].projectId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <ScopeLabel project={list[0].projectName} logo={list[0].logo} />
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {list.map((s) => (
                      <EnvTag key={s.value} kind={s.envKind}>
                        {s.envName}
                      </EnvTag>
                    ))}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-caption text-muted">You aren't granted any project yet. Ask an administrator for access.</p>
            )}
            <p className="m-0 font-mono text-mono-small text-muted">Times in UTC.</p>
          </div>
        </RailPanel>
      )}
    </aside>
  );
}

function SystemHealth({ agents }: { agents: ReturnType<typeof useAdminAgents> }) {
  const rows = (agents.data ?? []).filter((a) => a.status !== 'revoked' && a.status !== 'disabled');
  const byConnection = new Map<string, typeof rows>();
  for (const a of rows) {
    const key = a.provider_connection_name ?? a.name;
    byConnection.set(key, [...(byConnection.get(key) ?? []), a]);
  }
  return (
    <RailPanel title="System health" link={{ to: '/agents', label: 'Agents' }}>
      <div className="flex flex-col gap-3 p-4">
        {agents.isLoading && <p className="text-caption text-muted">Loading…</p>}
        {agents.isError && <p className="text-caption text-muted">Couldn't load agents.</p>}
        {!agents.isLoading && !agents.isError && rows.length === 0 && <p className="text-caption text-muted">No agents are connected yet.</p>}
        {[...byConnection.entries()].map(([name, list]) => {
          const statuses = [...new Set(list.map((a) => a.status))];
          return (
            <div key={name} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-mono" title={name}>
                {name}
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-3">
                {statuses.map((s) => (
                  <ToneStatus key={s} tone={AGENT_STATUS_TONE[s] ?? 'neutral'}>
                    {list.filter((a) => a.status === s).length} {s}
                  </ToneStatus>
                ))}
              </span>
            </div>
          );
        })}
        <p className="m-0 font-mono text-mono-small text-muted">From heartbeats · updates every 15 s</p>
      </div>
    </RailPanel>
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
