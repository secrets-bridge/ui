/**
 * Inbox (`/inbox`, secret.value.provide): cross-team requests waiting
 * for values from one of your teams (GET /requests/inbox). One row per
 * request: who asked, which keys, where the values go and how long the
 * fill window has left. A row opens the fill page.
 *
 * The sidebar shows Inbox only to holders of secret.value.provide; the
 * page checks again so a typed URL lands on the overview instead.
 */

import { Link, Navigate, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useInbox } from '../api/crossTeam';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { requestRef } from '../lib/requestRef';
import { formatAgo, formatExact } from '../lib/time';
import { useNow } from '../lib/useNow';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { Keys } from '../ui/Keys';
import { PageHeader } from '../ui/PageHeader';
import { keysOf } from '../requests/crossTeam';
import { FillWindow } from './inbox/FillWindow';

export function Inbox() {
  const { hasPermission } = useAuth();
  if (!hasPermission('secret.value.provide')) return <Navigate to="/" replace />;
  return <InboxView />;
}

function InboxView() {
  const inbox = useInbox();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const rows = [...(inbox.data ?? [])].sort((a, b) => Date.parse(a.fill_expires_at ?? '') - Date.parse(b.fill_expires_at ?? ''));
  const open = (r: AccessRequest) => `/inbox/${r.id}`;
  const soon = rows.filter((r) => r.fill_expires_at && Date.parse(r.fill_expires_at) - now < 3_600_000).length;

  const columns: Column<AccessRequest>[] = [
    {
      key: 'ref',
      header: 'Request',
      render: (r) => (
        <Link to={open(r)} className="font-mono text-mono font-medium text-accent hover:underline">
          {requestRef(r.id)}
        </Link>
      ),
    },
    {
      key: 'from',
      header: 'From',
      render: (r) => (
        <span>
          {r.requester_display ?? 'Someone'}
          {r.source_project_name && <span className="block text-caption text-muted">{r.source_project_name}</span>}
        </span>
      ),
    },
    { key: 'keys', header: 'Keys needed', render: (r) => <Keys keys={keysOf(r)} />, className: 'max-w-[240px]' },
    {
      key: 'for',
      header: 'Your team and project',
      render: (r) => (
        <span>
          {r.target_team_name ?? 'Your team'}
          {(r.target_project_name || r.target_environment_name) && (
            <span className="block text-caption text-muted">
              {[r.target_project_name, r.target_environment_name].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Asked',
      render: (r) => <span title={formatExact(r.created_at)}>{formatAgo(r.created_at, now)}</span>,
      className: 'whitespace-nowrap',
    },
    { key: 'left', header: 'Time left', render: (r) => <FillWindow expiresAt={r.fill_expires_at} now={now} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Inbox"
        description={
          inbox.data
            ? rows.length === 0
              ? 'Cross-team requests for values from your teams show up here.'
              : `${rows.length} waiting for values${soon ? ` · ${soon} closing within the hour` : ''}. Oldest deadline first.`
            : 'Cross-team requests waiting for values from your teams.'
        }
      />
      {inbox.isLoading && <p className="text-muted">Loading your inbox…</p>}
      {inbox.isError && (
        <Banner
          tone="error"
          title="Couldn't load your inbox."
          action={
            <Button variant="secondary" size="sm" onClick={() => void inbox.refetch()}>
              Try again
            </Button>
          }
        >
          {inbox.error instanceof ApiError ? `${inbox.error.status}: ${inbox.error.message}` : 'Network error.'}
        </Banner>
      )}
      {inbox.data &&
        (rows.length === 0 ? (
          <EmptyState title="Nothing waiting for you.">
            When another team asks one of your teams for values, the request lands here. You fill it, or refuse it with a
            reason.
          </EmptyState>
        ) : (
          <DataTable
            label="Requests waiting for values"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(open(r))}
            minWidth={760}
            stacked={(r) => (
              <div className="flex flex-col gap-1">
                <p className="flex items-center justify-between gap-3">
                  <Link to={open(r)} className="font-mono text-mono font-medium text-accent hover:underline">
                    {requestRef(r.id)}
                  </Link>
                  <FillWindow expiresAt={r.fill_expires_at} now={now} />
                </p>
                <p className="text-caption text-muted">
                  {r.requester_display ?? 'Someone'}
                  {r.source_project_name ? ` · ${r.source_project_name}` : ''} · {formatAgo(r.created_at, now)}
                </p>
                <Keys keys={keysOf(r)} />
              </div>
            )}
          />
        ))}
    </div>
  );
}
