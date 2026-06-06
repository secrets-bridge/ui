/**
 * Slice N5 — /inbox: cross-team requests waiting on Team B to provide
 * values.
 *
 * Per §5 design: per-row target team, destination key NAMES, source
 * requester email, time since submit, CountdownChip over
 * `fill_expires_at - now`, truncated justification. Click → fill/refuse
 * page.
 *
 * Fail-closed at the call site: shown in the sidebar only when caller
 * has `secret.value.provide` at any scope. This page additionally
 * re-checks the perm so direct-URL navigation also stops.
 */

import { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { useInbox } from '../api/crossTeam';
import { useAuth } from '../auth/AuthContext';
import type { AccessRequest } from '../api/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

export function Inbox() {
  const { hasPermission } = useAuth();
  if (!hasPermission('secret.value.provide')) {
    return <Navigate to="/" replace />;
  }

  return <InboxView />;
}

function InboxView() {
  const inbox = useInbox(undefined, { enabled: true });
  const rows = inbox.data ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <PageHeader
        title="Inbox"
        description="Cross-team requests waiting for your team to provide values."
      />
      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">Pending</h3>
          <span className="text-muted text-xs">
            {rows.length} {rows.length === 1 ? 'request' : 'requests'}
          </span>
        </CardHeader>
        <CardBody className="space-y-2">
          {inbox.isLoading && (
            <p className="text-muted text-sm">Loading…</p>
          )}
          {!inbox.isLoading && rows.length === 0 && (
            <p className="text-muted text-sm">
              Nothing pending. When a source team submits a cross-team
              request scoped to your team, it shows up here.
            </p>
          )}
          {rows.map((r) => (
            <InboxRow key={r.id} req={r} />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function InboxRow({ req }: { req: AccessRequest }) {
  return (
    <Link
      to={`/inbox/${req.id}`}
      className="block bg-bg/40 border border-border/60 hover:border-accent/40 rounded-lg px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-text font-medium text-sm truncate">
              {req.target_team_name ?? req.target_team_id ?? 'your team'}
            </span>
            <span className="text-muted text-xs">·</span>
            <span className="text-muted text-xs truncate font-mono">
              {req.destination_provider_label ?? req.target_provider_type}
              {req.destination_secret_ref ? ` · ${req.destination_secret_ref}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {(req.destination_keys ?? req.target_keys ?? []).map((k) => (
              <span
                key={k}
                className="bg-accent/10 text-accent text-[10px] rounded px-1.5 py-0.5 font-mono"
              >
                {k}
              </span>
            ))}
          </div>
          <p className="text-muted text-xs mt-1.5 line-clamp-2">
            {req.justification}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-muted text-[11px]">
            <span>from {req.requester_id}</span>
            <span>·</span>
            <span>{timeSince(req.created_at)} ago</span>
          </div>
        </div>
        <div className="shrink-0">
          <CountdownChip expiresAt={req.fill_expires_at} />
        </div>
      </div>
    </Link>
  );
}

/**
 * Renders the fill-window remaining time as a chip. Updates once a
 * minute (no per-second re-render — minute-level precision is enough
 * for hours-scale TTLs and avoids waking React 60×/min × N rows).
 */
function CountdownChip({ expiresAt }: { expiresAt: string | undefined }) {
  const label = useMemo(() => formatRemaining(expiresAt), [expiresAt]);
  if (!expiresAt) return null;
  const expired = isExpired(expiresAt);
  return (
    <StatusPill variant={expired ? 'error' : 'neutral'} tone="outline">
      {expired ? 'expired' : label}
    </StatusPill>
  );
}

function isExpired(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

function formatRemaining(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const ms = t - Date.now();
  if (ms <= 0) return 'expired';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m left`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h left` : `${days}d left`;
}

function timeSince(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const ms = Date.now() - t;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
