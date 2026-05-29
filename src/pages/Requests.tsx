/**
 * Requests page (`/requests`) — matches Figma frame 27:2.
 *
 * Two stacked sections:
 *   1. **My requests** — table of the signed-in user's own requests
 *      with status pills + a filter pill row (All / Pending / Approved
 *      / Rejected / Executed) and a type toggle (patch / read).
 *   2. **Approver queue** — pending requests submitted by someone
 *      ELSE, with inline Approve / Reject buttons and an
 *      auto-rejects-on-TTL-expiry note. The eyebrow chip surfaces the
 *      permission gating (`secret.approve`).
 *
 * Data sourcing:
 *   - `useRequests({ requester_id: me })` hydrates the My-requests
 *     table.
 *   - `useRequests({ status: 'pending' })` hydrates the Approver
 *     queue, filtered client-side to exclude the signed-in user's own
 *     requests (the api doesn't have a `requester_id != me` filter
 *     today, so we trim locally — the list is small).
 *
 * Hard rules (UI-side):
 *   - NEVER display secret values; the request shape carries metadata
 *     only.
 *   - Self-approval is silently hidden — bob approving bob's own
 *     request would be rejected by the api with 403 anyway, but
 *     trimming it client-side keeps the queue clean.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  useApproveRequest,
  useRejectRequest,
  useRequests,
} from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

type StatusFilter = 'all' | AccessRequest['status'];
type TypeFilter = 'all' | AccessRequest['type'];

export function Requests() {
  const { identity } = useAuth();
  const me = identity?.id ?? '';

  const myRequests = useRequests({ requester_id: me });
  const allPending = useRequests({ status: 'pending' });

  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');

  const filteredMine = useMemo(() => {
    const rows = myRequests.data ?? [];
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (type !== 'all' && r.type !== type) return false;
      return true;
    });
  }, [myRequests.data, status, type]);

  const queue = useMemo(() => {
    const rows = allPending.data ?? [];
    return rows.filter((r) => r.requester_id !== me);
  }, [allPending.data, me]);

  return (
    <div>
      <PageHeader
        title="Requests"
        description="Track your own requests and act on those awaiting your decision."
        actions={
          <Button variant="primary" disabled title="Submit lands with the next slice">
            + New request
          </Button>
        }
      />

      <Card className="overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
          <h3 className="text-text font-semibold">My requests</h3>
        </div>
        <div className="px-5 py-4 flex items-center gap-3 flex-wrap border-b border-border/60">
          <FilterPills
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'executed', label: 'Executed' },
            ]}
          />
          <span className="text-muted text-xs ml-2">type:</span>
          <FilterPills
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'All' },
              { value: 'patch', label: 'patch' },
              { value: 'read', label: 'read' },
            ]}
          />
        </div>

        {myRequests.isError && (
          <ErrorRow title="Failed to load requests" err={myRequests.error} />
        )}
        {myRequests.isLoading && (
          <div className="px-5 py-8 text-muted text-sm">Loading…</div>
        )}
        {myRequests.data && filteredMine.length === 0 && (
          <div className="px-5 py-8 text-muted text-sm">
            {status === 'all' && type === 'all'
              ? 'You haven’t submitted any requests yet.'
              : 'No requests match the current filters.'}
          </div>
        )}
        {filteredMine.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>ID</Th>
                <Th>Target</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th className="text-right">Created</Th>
              </tr>
            </thead>
            <tbody>
              {filteredMine.map((r) => (
                <RequestRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-text text-base font-semibold">Approver queue</h2>
        <StatusPill variant="accent" tone="outline">
          secret.approve
        </StatusPill>
      </div>
      <p className="text-muted text-xs mb-4">
        Oldest first (FIFO). Reject requires a reason. Self-approval is
        blocked unless the workflow allows it.
      </p>

      {allPending.isError && (
        <ErrorBanner title="Failed to load approver queue" err={allPending.error} />
      )}
      {allPending.isLoading && (
        <div className="text-muted text-sm">Loading queue…</div>
      )}
      {allPending.data && queue.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          The queue is empty. No requests are awaiting your decision.
        </Card>
      )}

      <div className="space-y-4">
        {queue.map((r) => (
          <ApproverQueueCard key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}

// --- my requests row ------------------------------------------------

function RequestRow({ row: r }: { row: AccessRequest }) {
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-middle">
      <Td>
        <Link
          to={`/requests/${r.id}`}
          className="font-mono text-accent hover:text-accent-bright text-sm"
        >
          {shortId(r.id)}
        </Link>
      </Td>
      <Td>
        <span className="font-mono text-text text-sm break-all">
          {r.target_secret_ref}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-muted text-xs uppercase">{r.type}</span>
      </Td>
      <Td>
        <RequestStatusPill status={r.status} />
      </Td>
      <Td className="text-right text-muted text-xs whitespace-nowrap">
        {formatRelativeShort(r.created_at)}
      </Td>
    </tr>
  );
}

// --- approver queue card --------------------------------------------

function ApproverQueueCard({ row: r }: { row: AccessRequest }) {
  const { identity } = useAuth();
  const me = identity?.id ?? '';
  const approve = useApproveRequest(r.id);
  const reject = useRejectRequest(r.id);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-text text-sm">
              {r.requester_id}
            </span>
            <span className="text-muted text-xs">requests</span>
            <StatusPill
              variant={r.type === 'patch' ? 'accent' : 'pending'}
              tone="outline"
            >
              {r.type}
            </StatusPill>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted text-xs">target</span>
            <span className="font-mono text-accent text-sm break-all">
              {r.target_secret_ref}
            </span>
          </div>
          {r.justification && (
            <p className="text-muted text-xs italic">
              &ldquo;{r.justification}&rdquo;
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-3 min-w-[200px]">
          <div className="text-right">
            <div className="text-muted text-[11px] uppercase tracking-wider">
              Submitted
            </div>
            <div className="text-text font-mono text-sm mt-0.5">
              {formatRelativeShort(r.created_at)}
            </div>
            <div className="text-muted text-[10px] mt-0.5">
              auto-rejects on TTL expiry
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={approve.isPending}
              onClick={() => approve.mutate({ approver_id: me })}
            >
              {approve.isPending ? 'Working…' : 'Approve'}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={reject.isPending}
              onClick={() => setShowReason((v) => !v)}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>

      {showReason && (
        <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
          <label className="block text-xs text-muted font-medium uppercase tracking-wider">
            Reject reason
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong target / not approved by oncall / use the read flow instead"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          />
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowReason(false);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!reason.trim() || reject.isPending}
              onClick={() =>
                reject.mutate({ approver_id: me, reason: reason.trim() })
              }
            >
              {reject.isPending ? 'Working…' : 'Confirm reject'}
            </Button>
          </div>
        </div>
      )}

      {(approve.error || reject.error) && (
        <InlineApiError
          err={(approve.error ?? reject.error) as unknown}
          className="mt-3"
        />
      )}
    </Card>
  );
}

// --- status pill mapping -------------------------------------------

export function RequestStatusPill({
  status,
}: {
  status: AccessRequest['status'];
}) {
  const variant: React.ComponentProps<typeof StatusPill>['variant'] =
    status === 'pending'
      ? 'pending'
      : status === 'approved'
        ? 'approved'
        : status === 'executed'
          ? 'executed'
          : status === 'rejected' || status === 'failed' || status === 'expired'
            ? 'rejected'
            : 'cancelled';
  return (
    <StatusPill variant={variant} tone="filled">
      {status}
    </StatusPill>
  );
}

// --- filter pills ---------------------------------------------------

function FilterPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={
              'px-3.5 py-1 rounded-full text-xs font-medium transition-colors ' +
              (on
                ? 'bg-accent/20 text-accent-bright'
                : 'text-muted hover:text-text')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// --- shared bits ----------------------------------------------------

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
  return <td className={`px-5 py-3.5 align-middle ${className}`}>{children}</td>;
}

function ErrorRow({ title, err }: { title: string; err: unknown }) {
  return (
    <div className="px-5 py-4 border-b border-border/60 text-sm">
      <div className="text-red-300 font-medium">{title}</div>
      <div className="text-muted mt-1 text-xs">{stringifyError(err)}</div>
    </div>
  );
}

function ErrorBanner({ title, err }: { title: string; err: unknown }) {
  return (
    <Card className="border-red-500/40 p-5 text-sm mb-4">
      <div className="text-red-300 font-medium">{title}</div>
      <div className="text-muted mt-1">{stringifyError(err)}</div>
    </Card>
  );
}

function InlineApiError({ err, className = '' }: { err: unknown; className?: string }) {
  if (!(err instanceof ApiError)) return null;
  return (
    <div
      className={
        'text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 ' +
        className
      }
    >
      {err.status}: {err.message}
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function shortId(id: string): string {
  // REQ-style display: take the first 4 hex chars of the UUID and
  // upper-case them so the URL prefix is short + reader-friendly.
  if (!id) return '—';
  const head = id.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `REQ-${head}`;
}

export function formatRelativeShort(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
