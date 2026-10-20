/**
 * Request detail (`/requests/:id`).
 *
 * Breadcrumb, the operation and key names as the title, then the state:
 * the exact status, the reveal condition and the project and
 * environment. The main card says what is going on in one heading and
 * one sentence and offers the single next action for this person:
 * Approve… and Reject… for an approver whose decision is open, Cancel
 * request… for the requester while it waits, Check status (a re-fetch,
 * nothing more) while the agent works, Request again once it is closed.
 * Then the timeline. The side column has the approvals, the details and
 * the collapsed technical ids.
 *
 * A request the person can't read answers 404 from the api; the page
 * says so and shows nothing else about it.
 *
 * Values never appear here except inside the reveal (request/Reveal.tsx),
 * which only starts on the requester's click and an MFA step-up.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { AuditEvent } from '../api/audit';
import { api, ApiError } from '../api/client';
import { useRequestObservations } from '../api/gateways';
import { requestsKey, useRequest, useRequestGitOps } from '../api/requests';
import type { AccessRequest, Workflow } from '../api/types';
import { useWorkflows } from '../api/workflows';
import { useAuth } from '../auth/AuthContext';
import { crossTeamVerifyCapability } from '../auth/capabilities';
import { providerLabel } from '../lib/providers';
import { requestRef } from '../lib/requestRef';
import { formatAge, formatExact, formatRemaining } from '../lib/time';
import { useNow } from '../lib/useNow';
import { conditionLine, keysOf, operationTitle, pathOf } from '../requests/describe';
import { lifecycleSteps } from '../requests/lifecycle';
import { useRevealConditions, type RevealCondition } from '../requests/revealState';
import { requestScope, useScopeDisplay, type ScopeDisplay } from '../requests/scope';
import { timelineFromAudit, timelineFromRequest, voterNames } from '../requests/timeline';
import { ApprovalLanes, type Lane } from '../ui/ApprovalLanes';
import { Banner } from '../ui/Banner';
import { Breadcrumb } from '../ui/Breadcrumb';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Keys } from '../ui/Keys';
import { Path } from '../ui/Path';
import { ScopeLabel } from '../ui/ScopeLabel';
import { Status } from '../ui/Status';
import { Lifecycle } from '../ui/Lifecycle';
import { Timeline } from '../ui/Timeline';
import { useToast } from '../ui/toastContext';
import { CrossTeamApprovalChainCard, CrossTeamVerifyCard } from './request/CrossTeamVerify';
import { ApproveDialog, CancelDialog, RejectDialog } from './request/DecisionDialogs';
import { GitOpsCard } from './request/GitOps';
import { ObservationPanel } from './request/Observation';
import { Reveal } from './request/Reveal';
import { RequestAccessDrawer } from './RequestAccessDrawer';

type DialogKind = 'approve' | 'reject' | 'cancel' | null;

export function RequestDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const req = useRequest(id);

  if (req.isLoading) return <p className="text-muted">Loading the request…</p>;
  if (req.error instanceof ApiError && [400, 403, 404].includes(req.error.status)) return <NoAccess />;
  if (req.isError || !req.data) {
    return (
      <Banner
        tone="error"
        title="Couldn't load this request."
        action={
          <Button variant="secondary" size="sm" onClick={() => void req.refetch()}>
            Try again
          </Button>
        }
      >
        {req.error instanceof Error ? req.error.message : 'The api did not answer.'}
      </Banner>
    );
  }
  // Keyed by id: a different request gets a fresh view, so a reveal that
  // is open on one request unmounts (expiring its session and dropping its
  // values) instead of carrying over to the next request's page.
  return <RequestView key={req.data.id} r={req.data} refetch={() => void req.refetch()} refetching={req.isFetching} />;
}

function NoAccess() {
  useDocumentTitle("Request · Secrets Bridge");
  return (
    <div className="max-w-2xl">
      <Breadcrumb items={[{ label: 'Requests', to: '/requests' }, { label: 'Request' }]} />
      <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
        You can't open this request
      </h1>
      <EmptyState title="It doesn't exist, or it's outside the projects you have access to.">
        If you need it, ask an administrator who manages access to that project. Nothing about the request is shown
        here.
      </EmptyState>
    </div>
  );
}

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

function RequestView({ r, refetch, refetching }: { r: AccessRequest; refetch: () => void; refetching: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { identity, hasPermission } = useAuth();
  const me = identity?.id ?? '';
  const now = useNow();
  const display = useScopeDisplay()(r);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useDocumentTitle(`${requestRef(r.id)} · ${operationTitle(r)} · Secrets Bridge`);

  const isMine = r.requester_id === me;
  const reveal = useRevealConditions(useMemo(() => [r], [r]), me).get(r.id);
  const workflows = useWorkflows();
  const workflow = workflows.data?.find((w) => w.id === r.workflow_id);

  // The real trail with names, for people who can read the audit log.
  const audit = useQuery({
    queryKey: ['audit-events', 'request', r.id],
    queryFn: () => api.get<AuditEvent[]>(`/api/v1/audit-events?correlation_id=${encodeURIComponent(r.id)}&limit=200`),
    enabled: hasPermission('audit.read'),
    retry: false,
    staleTime: 15_000,
  });
  const names = useMemo(() => voterNames(audit.data ?? []), [audit.data]);
  const timeline = useMemo(
    () => (audit.data?.length ? timelineFromAudit(audit.data, r, me) : timelineFromRequest(r, me)),
    [audit.data, r, me],
  );

  // After a decision the card changes under the closing dialog. Once the
  // refreshed request arrives, focus its new state heading (handoff:
  // focus goes to the state heading when the trigger is gone).
  const focusStateOnUpdate = useRef(false);
  useEffect(() => {
    if (!focusStateOnUpdate.current) return;
    focusStateOnUpdate.current = false;
    const raf = window.requestAnimationFrame(() => document.getElementById('state-heading')?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [r.status, r.updated_at, reveal?.state]);

  const myVote = (r.approvals ?? []).find((a) => a.approver_id === me);
  const decisionOpen =
    r.type !== 'cross_team' && r.status === 'pending' && !isMine && hasPermission('secret.approve') && !myVote;
  const approves = (r.approvals ?? []).filter((a) => a.decision === 'approve').length;
  const lastApproval = workflow ? approves + 1 >= workflow.min_approvers : undefined;
  const crossVerify =
    r.type === 'cross_team' && r.status === 'pending_verification'
      ? crossTeamVerifyCapability(r, me, identity?.permissions)
      : null;

  // The reveal stays mounted while values may be on screen, even after
  // the wrap summaries say "consumed", so a refresh can't cut it short.
  const [revealing, setRevealing] = useState(false);
  const revealDeadline = reveal?.state === 'ready' ? reveal.deadline : undefined;
  const [lastDeadline, setLastDeadline] = useState<string | undefined>(revealDeadline);
  if (revealDeadline && revealDeadline !== lastDeadline) setLastDeadline(revealDeadline);
  // Once a reveal ends on this page, don't offer it again while the
  // summaries catch up: the values are gone.
  const [revealDone, setRevealDone] = useState(false);
  // Why the reveal ended, when that needs saying (e.g. 410: nothing left).
  // Kept here because <Reveal> unmounts once the reveal is done.
  const [revealNotice, setRevealNotice] = useState<{ title: string; text: string } | null>(null);
  const showReveal = r.type === 'read' && isMine && (revealing || (!!revealDeadline && !revealDone));
  const gitops = useRequestGitOps(r.id, isMine);
  // Only a change is observed (patch and cross-team); a read writes nothing.
  const observable = r.type === 'patch' || r.type === 'cross_team';
  const observations = useRequestObservations(r.id, observable);

  // While approved, follow the request until the agent reports back
  // (a direct reveal lands here at once). Read-only: it never starts or
  // repeats anything.
  useEffect(() => {
    if (r.status !== 'approved') return;
    let n = 0;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (++n > 60) return window.clearInterval(t);
      refetch();
    }, 3000);
    return () => window.clearInterval(t);
  }, [r.status, refetch]);

  const revealFinished = (notice?: { title: string; text: string }) => {
    setRevealing(false);
    setRevealDone(true);
    setRevealNotice(notice ?? null);
    focusStateOnUpdate.current = true;
    void qc.invalidateQueries({ queryKey: requestsKey.one(r.id) });
    void qc.invalidateQueries({ queryKey: ['audit-events'] });
  };

  const done = (message: string) => {
    focusStateOnUpdate.current = true;
    setDialog(null);
    toast(message);
    void qc.invalidateQueries({ queryKey: requestsKey.all });
    void qc.invalidateQueries({ queryKey: ['audit-events'] });
  };

  // Opening the values consumes the reveal, so say so while they show.
  const line = revealing ? { text: 'Reveal consumed', tone: 'muted' as const } : conditionLine(r, reveal);
  const steps = lifecycleSteps(r, {
    minApprovers: workflow?.min_approvers,
    reveal: revealing || revealDone ? { state: 'consumed' } : reveal,
    timeline,
    isMine,
  });

  return (
    <div>
      <Breadcrumb items={[{ label: 'Requests', to: '/requests' }, { label: requestRef(r.id), mono: true }]} />
      <h1 id="page-title" tabIndex={-1} className="mt-3 break-words text-console-title text-ink">
        {operationTitle(r)}
      </h1>
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ui">
        <Status status={r.status} />
        {line && <span className={line.tone === 'ok' ? 'text-ok' : 'text-muted'}>{line.text}</span>}
        {/* The separator travels with the scope, so it never dangles at
            the end of a line when the scope wraps on a phone. */}
        <span className="inline-flex max-w-full items-center gap-x-2.5">
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <ScopeLabel project={display.project} env={display.env} envKind={display.envKind} logo={display.logo} />
        </span>
      </div>
      <Lifecycle steps={steps} now={now} />

      <div className="grid grid-cols-1 gap-6 min-[1181px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <Situation
              r={r}
              me={me}
              now={now}
              display={display}
              reveal={reveal}
              workflow={workflow}
              decisionOpen={decisionOpen}
              myVote={myVote?.decision}
              crossVerifying={!!crossVerify}
              refetching={refetching}
              revealSlot={
                showReveal && lastDeadline ? (
                  <Reveal
                    request={r}
                    deadline={lastDeadline}
                    now={now}
                    onActiveChange={setRevealing}
                    onFinished={revealFinished}
                  />
                ) : revealNotice ? (
                  <Banner tone="error" title={revealNotice.title}>
                    {revealNotice.text}
                  </Banner>
                ) : undefined
              }
              onApprove={() => setDialog('approve')}
              onReject={() => setDialog('reject')}
              onCancel={() => setDialog('cancel')}
              onCheck={refetch}
              onRequestAgain={() => setDrawerOpen(true)}
            />
          </Panel>

          {crossVerify && <CrossTeamVerifyCard request={r} actorId={me} />}

          <Panel
            title="Timeline"
            aside={
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-mono-small text-muted">times in UTC</span>
                {!!audit.data?.length && (
                  <Link to={`/audit?correlation_id=${r.id}`} className="text-ui font-normal text-accent hover:underline">
                    Audit log
                  </Link>
                )}
              </span>
            }
          >
            <Timeline entries={timeline} />
          </Panel>

          {observable && (
            <ObservationPanel
              data={observations.data}
              error={observations.error}
              loading={observations.isLoading}
              requestStatus={r.status}
            />
          )}
          <GitOpsCard query={gitops} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {r.type === 'cross_team' ? (
            <CrossTeamApprovalChainCard request={r} />
          ) : (
            <Panel title="Approvals" aside={workflow && <span className="text-caption text-muted">{workflow.name}</span>}>
              <ApprovalLanes lanes={lanesFor(r, workflow, names, me)} />
            </Panel>
          )}
          <DetailsPanel r={r} display={display} reasonShown={decisionOpen && !revealing} />
        </div>
      </div>

      {dialog === 'approve' && (
        <ApproveDialog request={r} display={display} lastApproval={lastApproval} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'reject' && <RejectDialog request={r} display={display} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'cancel' && <CancelDialog request={r} onClose={() => setDialog(null)} onDone={done} />}

      {drawerOpen && identity && (
        <RequestAccessDrawer
          prefill={{ projectId: requestScope(r).projectId, envName: requestScope(r).envName, secretRef: pathOf(r), keys: keysOf(r) }}
          onClose={() => setDrawerOpen(false)}
          onCreated={(newId) => {
            setDrawerOpen(false);
            toast(`Request ${requestRef(newId)} submitted.`, { to: `/requests/${newId}`, label: 'Open it' });
            navigate(`/requests/${newId}`);
          }}
        />
      )}
    </div>
  );
}

// --- the situation card ---------------------------------------------

function Situation(p: {
  r: AccessRequest;
  me: string;
  now: number;
  display: ScopeDisplay;
  reveal?: RevealCondition;
  workflow?: Workflow;
  decisionOpen: boolean;
  myVote?: 'approve' | 'reject';
  crossVerifying: boolean;
  refetching: boolean;
  revealSlot?: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onCheck: () => void;
  onRequestAgain: () => void;
}) {
  const { r, workflow, reveal, now } = p;
  const isMine = r.requester_id === p.me;
  const keys = keysOf(r);
  const approves = (r.approvals ?? []).filter((a) => a.decision === 'approve').length;
  const deadline =
    workflow && workflow.request_ttl_seconds > 0
      ? new Date(Date.parse(r.created_at) + workflow.request_ttl_seconds * 1000).toISOString()
      : undefined;
  const needed = workflow
    ? `It needs ${workflow.min_approvers} approval${workflow.min_approvers === 1 ? '' : 's'}; ${approves} recorded so far.`
    : 'It needs an approver to decide.';
  const deadlineText = deadline
    ? ` If no one decides by ${formatExact(deadline)} (${formatRemaining(deadline, now)}), it expires.`
    : '';
  const where = `${p.display.project}${p.display.env ? ` · ${p.display.env}` : ''}`;

  const again = (
    <Button variant="secondary" onClick={p.onRequestAgain}>
      Request again
    </Button>
  );
  const cancel = (
    <Button variant="danger" onClick={p.onCancel}>
      Cancel request…
    </Button>
  );

  if (p.revealSlot) return <>{p.revealSlot}</>;

  if (p.decisionOpen) {
    return (
      <Card
        heading="Your decision is needed"
        sentence={`${r.requester_display ?? 'The requester'} wants to ${r.type === 'patch' ? 'change' : 'read'} ${keys.length ? keys.join(', ') : 'every key'} in ${where} (${providerLabel(r.target_provider_type)}). Read the reason before you decide.`}
        actions={
          <>
            <Button variant="primary" onClick={p.onApprove}>
              Approve…
            </Button>
            <Button variant="danger" onClick={p.onReject}>
              Reject…
            </Button>
          </>
        }
        footnote="Approving records your decision. It doesn't run anything; the agent acts only once every approval is in."
      >
        <blockquote className="m-0 border-l-2 border-edge py-0.5 pl-3.5 text-body text-ink">
          <p className="whitespace-pre-wrap break-words">{r.justification || 'No reason given.'}</p>
          <footer className="mt-1 text-caption text-muted">{r.requester_display ?? 'The requester'}'s reason</footer>
        </blockquote>
        <p className="mt-3 flex flex-wrap gap-x-2 gap-y-0.5 text-ui font-normal text-muted">
          <span title={`Since ${formatExact(r.created_at)}`}>Waiting {formatAge(r.created_at, now)}</span>
          {workflow && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {approves} of {workflow.min_approvers} approval{workflow.min_approvers === 1 ? '' : 's'} recorded
              </span>
            </>
          )}
          {deadline && (
            <>
              <span aria-hidden="true">·</span>
              <span title={formatExact(deadline)}>Expires in {formatRemaining(deadline, now).replace(/ left$/, '')}</span>
            </>
          )}
        </p>
      </Card>
    );
  }

  if (p.crossVerifying) {
    return (
      <Card
        heading="Verification is needed"
        sentence="The supplying team filled the values. Check the details below and vote in your lane."
      />
    );
  }

  switch (r.status) {
    case 'pending':
      return isMine ? (
        <Card heading="Waiting for approval" sentence={`${needed}${deadlineText} You can cancel it while it waits.`} actions={cancel} />
      ) : (
        <Card
          heading={p.myVote === 'approve' ? 'You approved · waiting for other approvals' : 'Waiting for approval'}
          sentence={`${needed}${deadlineText}`}
        />
      );
    case 'pending_values':
      return (
        <Card
          heading={`Waiting for ${r.target_team_name ?? 'the supplying team'} to supply values`}
          sentence={
            r.fill_expires_at
              ? `They have until ${formatExact(r.fill_expires_at)} to fill or refuse it.`
              : 'They fill the values or refuse the request.'
          }
          actions={isMine ? cancel : undefined}
        />
      );
    case 'pending_verification':
      return (
        <Card
          heading="Values supplied · waiting for verification"
          sentence="Approvers in the requesting team check the request before the agent writes the values."
          actions={isMine ? cancel : undefined}
        />
      );
    case 'approved':
      return (
        <Card
          heading="Approved · no execution event yet"
          sentence="An agent picks up the job next. This page changes when the agent reports back."
          actions={
            <Button variant="secondary" onClick={p.onCheck} disabled={p.refetching} aria-busy={p.refetching}>
              {p.refetching ? 'Checking…' : 'Check status'}
            </Button>
          }
          footnote="Checking only reloads this page. It never starts or repeats anything."
        />
      );
    case 'executed':
      if (r.type !== 'read') {
        return <Card heading="Done" sentence="The agent wrote the new values to the provider." actions={isMine ? again : undefined} />;
      }
      if (reveal?.state === 'consumed') {
        return (
          <Card
            heading="Values were revealed"
            sentence="They were retrieved once and can't be shown again. If you need them again, request access again."
            actions={isMine ? again : undefined}
          />
        );
      }
      if (reveal?.state === 'expired') {
        return (
          <Card
            heading="The reveal window closed"
            sentence="Nothing was shown. Request again if you still need the values."
            actions={isMine ? again : undefined}
          />
        );
      }
      return <Card heading="Executed" sentence="The agent read the values and stored them for the requester to reveal once." />;
    case 'rejected':
      return (
        <Card
          heading="Rejected"
          sentence={r.reject_reason ? `“${r.reject_reason}”` : 'An approver rejected this request.'}
          actions={isMine ? again : undefined}
        />
      );
    case 'refused':
      return (
        <Card
          heading={`Refused by ${r.target_team_name ?? 'the supplying team'}`}
          sentence={r.refuse_reason ? `“${r.refuse_reason}”` : 'The supplying team refused to supply values.'}
          actions={isMine ? again : undefined}
        />
      );
    case 'failed':
      return (
        <Card
          heading="Execution failed"
          sentence={`The agent couldn't complete the ${r.type === 'patch' ? 'write' : 'read'}, so nothing was retrieved. Your platform team can look up the reason in the agent log${r.job_id ? ` for job ${r.job_id.slice(0, 8)}` : ''}.`}
          actions={isMine ? again : undefined}
        />
      );
    case 'expired':
      return (
        <Card
          heading="No decision before the deadline"
          sentence="The request expired without a decision. Nothing was approved."
          actions={isMine ? again : undefined}
        />
      );
    case 'cancelled':
      return (
        <Card
          heading={isMine ? 'You cancelled this request' : 'The requester cancelled this request'}
          sentence="Nothing was approved or retrieved."
          actions={isMine ? again : undefined}
        />
      );
    default:
      return <Card heading={r.status} sentence="" />;
  }
}

function Card({
  heading,
  sentence,
  actions,
  footnote,
  children,
}: {
  heading: string;
  sentence: string;
  actions?: ReactNode;
  footnote?: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-5 py-[18px]">
      <h2 id="state-heading" tabIndex={-1} className="text-[17px] font-semibold leading-[22px] text-ink">
        {heading}
      </h2>
      {sentence && <p className="mt-1.5 max-w-[68ch] text-body text-muted">{sentence}</p>}
      {children && <div className="mt-4">{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap gap-2.5 max-[600px]:[&>button]:flex-1">{actions}</div>}
      {footnote && <p className="mt-3 text-caption text-muted">{footnote}</p>}
    </div>
  );
}

// --- side panels ----------------------------------------------------

function Panel({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface">
      {title && (
        <div className="flex items-baseline justify-between gap-3 border-b border-rule px-5 py-3.5">
          <h2 className="text-block-heading text-ink">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

// One lane per required approval from the request's workflow. The api
// doesn't report lanes yet (api#228), so who may act on an open lane is
// described rather than named.
function lanesFor(r: AccessRequest, wf: Workflow | undefined, names: Map<string, string>, me: string): Lane[] {
  const votes = [...(r.approvals ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const nameOf = (id: string) => (id === me ? 'You' : (names.get(id) ?? 'An approver'));
  const required = wf ? wf.min_approvers : Math.max(votes.length, 1);
  const open = r.status === 'pending';
  const lanes: Lane[] = [];
  for (let i = 0; i < Math.max(required, votes.length); i++) {
    const v = votes[i];
    const label = required === 1 ? 'Approval' : `Approval ${i + 1} of ${required}`;
    if (v) {
      lanes.push({
        key: v.id,
        label,
        who: nameOf(v.approver_id),
        when: formatExact(v.created_at),
        state: v.decision === 'approve' ? 'approved' : 'rejected',
        stateLabel: v.decision === 'approve' ? 'Approved' : 'Rejected',
        note: v.comment,
      });
    } else if (open) {
      const first = i === votes.length;
      lanes.push({
        key: `slot-${i}`,
        label,
        who: 'An approver with access to this project',
        state: first ? 'waiting' : 'queued',
        stateLabel: first ? 'Waiting' : 'After previous',
      });
    } else {
      lanes.push({ key: `slot-${i}`, label, who: '—', state: 'closed', stateLabel: 'No decision' });
    }
  }
  if (lanes.length === 0) {
    lanes.push({
      key: 'none',
      label: 'Approval',
      who: 'No approval was needed for this request.',
      state: 'closed',
      stateLabel: 'Not needed',
    });
  }
  return lanes;
}

function DetailsPanel({ r, display, reasonShown }: { r: AccessRequest; display: ScopeDisplay; reasonShown: boolean }) {
  const keys = keysOf(r);
  const rows: [string, ReactNode][] = [
    ['Requester', r.requester_display ?? '—'],
    [
      'Operation',
      `${r.type === 'patch' ? 'Change' : r.type === 'cross_team' ? 'Supply' : 'Read'} · ${keys.length || 'all'} key${keys.length === 1 ? '' : 's'}`,
    ],
    [
      'Where',
      <span key="w" className="inline-flex flex-wrap items-center gap-x-1">
        <ScopeLabel project={display.project} env={display.env} envKind={display.envKind} logo={display.logo} />
        {display.env && <span className="sr-only">{display.envKind === 'prod' ? ' (production)' : ' (non-production)'}</span>}
      </span>,
    ],
    ['Provider', r.type === 'cross_team' ? (r.destination_provider_label ?? '—') : providerLabel(r.target_provider_type)],
    ['Secret path', pathOf(r) ? <Path key="p" value={pathOf(r)} /> : '—'],
    ['Keys', <Keys key="k" keys={keys} variant="chips" />],
    // The decision card quotes the reason in full; don't repeat it here.
    ...(reasonShown ? [] : [['Reason', <span key="r" className="whitespace-pre-wrap">“{r.justification}”</span>] as [string, ReactNode]]),
    ['Created', formatExact(r.created_at, true)],
  ];
  const tech: [string, string | null | undefined][] = [
    ['Request id', r.id],
    ['Status', r.status],
    ['Correlation id', r.id],
    ['Type', r.type],
    ['Workflow id', r.workflow_id],
    ['Job id', r.job_id],
    ['Provider connection id', r.destination_provider_connection_id],
  ];
  return (
    <Panel title="Details">
      <dl className="m-0 px-5 py-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="border-t border-rule px-5 py-3 text-ui">
        <summary className="cursor-pointer text-muted hover:text-ink">Technical details</summary>
        <dl className="m-0 mt-2">
          {tech
            .filter(([, v]) => !!v)
            .map(([k, v]) => (
              <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-1">
                <dt className="font-normal text-muted">{k}</dt>
                <dd className="m-0 break-all font-mono text-mono-small text-ink">{v}</dd>
              </div>
            ))}
        </dl>
      </details>
    </Panel>
  );
}
