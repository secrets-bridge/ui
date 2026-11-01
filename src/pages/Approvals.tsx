/**
 * Approvals (`/approvals`): requests waiting for this person's decision,
 * oldest first. The oldest gets the full context and the decision; the
 * rest sit under it as rows. Approving records a decision and never shows
 * a value.
 *
 * The list comes from GET /requests, which only returns other people's
 * requests to a company-wide approver, and approving needs that same
 * grant today. Someone whose approver role is limited to a team or
 * project gets a sentence saying so, not an empty page.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRequests } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useWorkflows } from '../api/workflows';
import { useAuth } from '../auth/AuthContext';
import { needsMyDecision } from '../lib/requestQueues';
import { requestRef } from '../lib/requestRef';
import { formatAge } from '../lib/time';
import { useNow } from '../lib/useNow';
import { askedFor, keysOf } from '../requests/describe';
import { pastDeadline } from '../requests/deadline';
import { inScope, useScope, useScopeDisplay } from '../requests/scope';
import { useRequestDetails } from '../requests/useRequestDetails';
import { Avatar } from '../ui/Avatar';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { EnvTag } from '../ui/EnvTag';
import { Keys } from '../ui/Keys';
import { PageHeader } from '../ui/PageHeader';
import { useToast } from '../ui/toastContext';
import { NextDecision, ThenList, ThenRow } from './focus/NextUp';
import { ApproveDialog, RejectDialog } from './request/DecisionDialogs';

export function Approvals() {
  const navigate = useNavigate();
  const toast = useToast();
  const { identity, hasPermission, hasGlobalPermission } = useAuth();
  const me = identity?.id ?? '';
  const canApprove = hasPermission('secret.approve');
  const { scope } = useScope();
  const display = useScopeDisplay();
  const now = useNow();
  const workflows = useWorkflows();

  const pendingQ = useRequests({ status: 'pending' }, { enabled: !!me && canApprove });
  const candidates = useMemo(() => needsMyDecision(pendingQ.data ?? [], me).filter((r) => inScope(r, scope)), [pendingQ.data, me, scope]);
  const details = useRequestDetails(useMemo(() => candidates.map((r) => r.id), [candidates]));
  const all = useMemo(
    () =>
      needsMyDecision(
        candidates.map((r) => details.get(r.id) ?? r),
        me,
      ).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    [candidates, details, me],
  );
  // A request past its deadline can't be approved, so it never takes the
  // Next up slot; it waits at the end of the list.
  const live = all.filter((r) => !pastDeadline(r, workflows.data, now));
  const overdue = all.filter((r) => pastDeadline(r, workflows.data, now));

  const [prodOnly, setProdOnly] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);
  const [decide, setDecide] = useState<{ kind: 'approve' | 'reject'; r: AccessRequest } | null>(null);

  const next = live[0];
  const rest = [...live.slice(1), ...overdue];
  const rows = rest.filter((r) => (!prodOnly || display(r).envKind === 'prod') && (!changesOnly || r.type === 'patch'));
  const inProd = all.filter((r) => display(r).envKind === 'prod').length;

  const done = (message: string) => {
    setDecide(null);
    toast(message);
  };

  return (
    <div>
      <PageHeader title="Approvals" description="Requests you can decide on, oldest first. Approving records your decision; it never shows you a value." />

      {pendingQ.isError && (
        <Banner
          tone="error"
          title="Couldn't load the requests."
          action={
            <Button variant="secondary" size="sm" onClick={() => void pendingQ.refetch()}>
              Try again
            </Button>
          }
          className="mb-6"
        >
          Nothing is counted until they load.
        </Banner>
      )}
      {pendingQ.isLoading && <p className="text-muted">Loading requests…</p>}

      {!pendingQ.isLoading && !pendingQ.isError && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-surface px-[18px] py-3.5">
            <p className="flex flex-wrap items-baseline gap-x-2.5">
              <span className={'text-count ' + (all.length === 0 ? 'text-muted' : 'text-ink')}>{all.length}</span>
              <span className="text-caption text-ink">Waiting for you{inProd > 0 ? ` · ${inProd} in production` : ''}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
              {next ? (
                <NextDecision
                  r={next}
                  display={display(next)}
                  now={now}
                  detailed
                  onApprove={() => setDecide({ kind: 'approve', r: next })}
                  onReject={() => setDecide({ kind: 'reject', r: next })}
                />
              ) : !hasGlobalPermission('secret.approve') ? (
                <Banner title="Nothing to show here yet.">
                  Deciding from this console needs a company-wide approver role. Yours is limited to a team or project.
                </Banner>
              ) : (
                <EmptyState title="Nothing is waiting for your decision.">Requests in your approval scope appear here, oldest first.</EmptyState>
              )}

              {rest.length > 0 && (
                <ThenList
                  title="Then"
                  id="approvals-then"
                  filters={
                    <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
                      <Chip on={prodOnly} onClick={() => setProdOnly((v) => !v)}>
                        Production only
                      </Chip>
                      <Chip on={changesOnly} onClick={() => setChangesOnly((v) => !v)}>
                        Changes only
                      </Chip>
                    </div>
                  }
                >
                  {rows.map((r) => {
                    const d = display(r);
                    const late = overdue.includes(r);
                    return (
                      <ThenRow
                        key={r.id}
                        mark={<Avatar name={r.requester_display ?? '?'} size="sm" />}
                        to={`/requests/${r.id}`}
                        title={
                          <>
                            <span className="font-semibold">{r.requester_display ?? requestRef(r.id)}</span>{' '}
                            <span className="text-caption text-muted">{askedFor(r, d)}</span>
                          </>
                        }
                        meta={late ? 'past its deadline' : formatAge(r.created_at, now)}
                        action={
                          <Button variant="secondary" size="sm" onClick={() => navigate(`/requests/${r.id}`)}>
                            Review<span className="sr-only"> {requestRef(r.id)}</span>
                          </Button>
                        }
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-caption text-ink">{d.project}</span>
                          {d.env && <EnvTag kind={d.envKind}>{d.env}</EnvTag>}
                          <Keys keys={keysOf(r)} variant="chips" />
                        </span>
                        <span className="text-caption text-muted">“{r.justification}”</span>
                      </ThenRow>
                    );
                  })}
                  {rows.length === 0 && <li className="px-3.5 py-3 text-caption text-muted">Nothing here matches these filters.</li>}
                </ThenList>
              )}
            </div>

            <aside aria-label="How deciding works" className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
              <Card>
                <CardHeader>
                  <h2 className="text-block-heading text-ink">How deciding works</h2>
                </CardHeader>
                <CardBody>
                  <ol className="m-0 flex list-none flex-col gap-3 p-0">
                    {[
                      'Approving records your decision. The agent acts only when every approval is in.',
                      'Rejecting needs a reason of 10 characters or more. One rejection ends the request.',
                      "You can't decide on your own requests; they never appear here.",
                    ].map((text, i) => (
                      <li key={text} className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className={
                            'inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-semibold ' +
                            (i === 0 ? 'bg-accent text-on-accent' : 'bg-ink text-bg')
                          }
                        >
                          {i + 1}
                        </span>
                        <span className="text-caption text-ink">{text}</span>
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            </aside>
          </div>
        </div>
      )}

      {decide?.kind === 'approve' && (
        <ApproveDialog request={decide.r} display={display(decide.r)} lastApproval={undefined} onClose={() => setDecide(null)} onDone={done} />
      )}
      {decide?.kind === 'reject' && <RejectDialog request={decide.r} display={display(decide.r)} onClose={() => setDecide(null)} onDone={done} />}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        'inline-flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-md border px-3 text-[13.5px] font-medium ' +
        (on ? 'border-ink bg-ink text-bg' : 'border-border text-muted hover:bg-hover hover:text-ink')
      }
    >
      {children}
    </button>
  );
}
