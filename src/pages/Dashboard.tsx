/**
 * Dashboard — operator landing page. Matches the Figma frame
 * `Dashboard · /` on page 05 of the brand file.
 *
 * Layout:
 *   ┌── KPI row ──────────────────────────────────────────────────┐
 *   │ Pending  · Providers · Agents online · Secrets synced (24h) │
 *   ├── two columns ──────────────────────────────────────────────┤
 *   │ LEFT (≈ 60%):                       RIGHT (≈ 40%):          │
 *   │   Pending Approvals (table)           Providers Health      │
 *   │   Recent Audit Activity (timeline)    Agents                │
 *   │                                       Requests this week    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Data wiring strategy:
 *   - Agents card + "Agents online" KPI: REAL — hydrated from
 *     `GET /api/v1/agents` (same shape the existing Agents page uses).
 *   - Pending Approvals: PREVIEW — the requests list endpoint
 *     (api#37 follow-up) and the per-row approve/deny actions land
 *     with the Requests page slice. Rows shown are demo data.
 *   - Recent Audit Activity: PREVIEW — same shape as the future
 *     `/audit` page; placeholder rows for now.
 *   - Providers Health, Secrets synced, Requests-this-week chart:
 *     PREVIEW — depend on the BRD §16 metrics endpoints that aren't
 *     scaffolded yet. Placeholders keep the visual.
 *
 * Sections fed by demo data are tagged with a small `preview` chip in
 * their header so operators don't mistake them for live data.
 */

import { useEffect, useState } from 'react';

import { api } from '../api/client';
import type { Agent } from '../api/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

export function Dashboard() {
  const agents = useAgentsSnapshot();

  return (
    <div>
      <PageHeader title="Dashboard" description="" />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="Pending Requests"
          value="4"
          accent={<DotLabel tone="warning">2 need review</DotLabel>}
          preview
        />
        <Kpi
          label="Providers Connected"
          value="6"
          accent={<span className="text-muted text-xs">Vault, AWS, Azure +3</span>}
          preview
        />
        <Kpi
          label="Agents Online"
          value={
            agents.loading
              ? '…'
              : `${agents.online} / ${agents.total}`
          }
          accent={
            <DotLabel
              tone={
                agents.loading
                  ? 'neutral'
                  : agents.online === agents.total && agents.total > 0
                    ? 'success'
                    : 'warning'
              }
            >
              {agents.loading
                ? 'loading…'
                : agents.total === 0
                  ? 'no agents minted'
                  : agents.online === agents.total
                    ? 'all healthy'
                    : `${agents.total - agents.online} stale`}
            </DotLabel>
          }
        />
        <Kpi
          label="Secrets Synced · 24h"
          value="1,284"
          accent={<DotLabel tone="success">+0.6% vs prev</DotLabel>}
          preview
        />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        <div className="space-y-6">
          <PendingApprovalsCard />
          <RecentAuditCard />
        </div>
        <div className="space-y-6">
          <ProvidersHealthCard />
          <AgentsSummaryCard agents={agents} />
          <RequestsWeekCard />
        </div>
      </div>
    </div>
  );
}

// --- KPI card -------------------------------------------------------

function Kpi({
  label,
  value,
  accent,
  preview,
}: {
  label: string;
  value: string;
  accent: React.ReactNode;
  preview?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-muted text-xs uppercase tracking-wider font-medium">
          {label}
        </div>
        {preview && (
          <StatusPill variant="neutral" tone="outline">
            preview
          </StatusPill>
        )}
      </div>
      <div className="text-text text-3xl font-bold mt-2 tracking-tight">
        {value}
      </div>
      <div className="mt-2 text-xs">{accent}</div>
    </Card>
  );
}

function DotLabel({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'error' | 'neutral';
  children: React.ReactNode;
}) {
  const dot =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warning'
        ? 'bg-yellow-400'
        : tone === 'error'
          ? 'bg-red-400'
          : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

// --- Pending Approvals ----------------------------------------------

interface ApprovalRow {
  secret: string;
  requester: string;
  provider: 'Vault' | 'AWS' | 'Azure' | 'GCP';
  ttl: string;
}

const APPROVAL_DEMO_ROWS: ApprovalRow[] = [
  { secret: 'prod/db/password', requester: 'alice@corp', provider: 'Vault', ttl: '1h' },
  { secret: 'prod/payments/stripe', requester: 'bob@corp', provider: 'AWS', ttl: '30m' },
  { secret: 'prod/app/config', requester: 'carol@corp', provider: 'Azure', ttl: '2h' },
  { secret: 'staging/api/key', requester: 'dave@corp', provider: 'GCP', ttl: '4h' },
];

const PROVIDER_DOT: Record<ApprovalRow['provider'], string> = {
  Vault: 'bg-yellow-400',
  AWS: 'bg-orange-400',
  Azure: 'bg-blue-400',
  GCP: 'bg-cyan-400',
};

function PendingApprovalsCard() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <h3 className="text-text font-semibold">Pending Approvals</h3>
          <StatusPill variant="neutral" tone="outline">
            preview
          </StatusPill>
        </div>
        <a
          href="/requests"
          className="text-accent hover:text-accent-bright text-sm font-medium"
        >
          View all
        </a>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
          <tr className="border-b border-border/60">
            <Th>Secret</Th>
            <Th>Requester</Th>
            <Th>Provider</Th>
            <Th>TTL</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {APPROVAL_DEMO_ROWS.map((r) => (
            <tr
              key={r.secret}
              className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-middle"
            >
              <Td>
                <span className="font-mono text-accent text-sm">
                  {r.secret}
                </span>
              </Td>
              <Td className="text-muted">{r.requester}</Td>
              <Td>
                <span className="inline-flex items-center gap-2 text-text">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${PROVIDER_DOT[r.provider]}`}
                  />
                  {r.provider}
                </span>
              </Td>
              <Td className="text-text font-mono">{r.ttl}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="primary" size="sm" disabled>
                    Approve
                  </Button>
                  <button
                    disabled
                    className="text-red-300/50 cursor-not-allowed text-sm font-medium"
                  >
                    Deny
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// --- Recent Audit Activity ------------------------------------------

interface AuditRow {
  time: string;
  actor: string;
  action: 'approved' | 'synced' | 'submitted' | 'denied';
  resource: string;
}

const AUDIT_DEMO_ROWS: AuditRow[] = [
  { time: '09:42', actor: 'alice@corp', action: 'approved', resource: 'REQ-1042 · prod/db/password' },
  { time: '09:31', actor: 'agent/prod-eu', action: 'synced', resource: 'Vault → Kubernetes (app-config)' },
  { time: '09:18', actor: 'bob@corp', action: 'submitted', resource: 'prod/payments/stripe' },
  { time: '08:57', actor: 'carol@corp', action: 'denied', resource: 'REQ-1039 · prod/root-token' },
  { time: '08:40', actor: 'agent/prod-us', action: 'synced', resource: 'aws:prod/payments/stripe' },
];

const AUDIT_VARIANT: Record<
  AuditRow['action'],
  React.ComponentProps<typeof StatusPill>['variant']
> = {
  approved: 'success',
  synced: 'accent',
  submitted: 'pending',
  denied: 'error',
};

function RecentAuditCard() {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-text font-semibold">Recent Audit Activity</h3>
        <StatusPill variant="neutral" tone="outline">
          preview
        </StatusPill>
      </div>
      <ul>
        {AUDIT_DEMO_ROWS.map((r) => (
          <li
            key={`${r.time}-${r.resource}`}
            className="flex items-center gap-4 px-5 py-3 border-b border-border/40 last:border-0"
          >
            <span className="font-mono text-muted text-xs w-12 shrink-0">
              {r.time}
            </span>
            <span className="font-mono text-text text-sm w-36 shrink-0 truncate">
              {r.actor}
            </span>
            <span className="w-24 shrink-0">
              <StatusPill variant={AUDIT_VARIANT[r.action]} tone="outline">
                {r.action}
              </StatusPill>
            </span>
            <span className="text-muted text-sm font-mono truncate flex-1 min-w-0">
              {r.resource}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Providers Health -----------------------------------------------

interface ProviderHealth {
  name: string;
  latency: string;
  status: 'healthy' | 'sync';
}

const PROVIDER_HEALTH_DEMO: ProviderHealth[] = [
  { name: 'HashiCorp Vault', latency: '12ms', status: 'healthy' },
  { name: 'AWS Secrets Manager', latency: '28ms', status: 'healthy' },
  { name: 'Azure Key Vault', latency: '41ms', status: 'healthy' },
  { name: 'GCP Secret Manager', latency: '19ms', status: 'healthy' },
  { name: 'Kubernetes ESO', latency: '8ms', status: 'healthy' },
  { name: 'ArgoCD', latency: 'sync', status: 'sync' },
];

function ProvidersHealthCard() {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-text font-semibold">Providers Health</h3>
        <StatusPill variant="neutral" tone="outline">
          preview
        </StatusPill>
      </div>
      <ul>
        {PROVIDER_HEALTH_DEMO.map((p) => (
          <li
            key={p.name}
            className="flex items-center justify-between px-5 py-3 border-b border-border/40 last:border-0"
          >
            <span className="flex items-center gap-2.5 text-text text-sm">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  p.status === 'sync' ? 'bg-accent' : 'bg-success'
                }`}
              />
              {p.name}
            </span>
            <span className="text-muted text-xs font-mono">{p.latency}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Agents card (REAL data) ----------------------------------------

function AgentsSummaryCard({ agents }: { agents: AgentsSnapshot }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-text font-semibold">Agents</h3>
      </div>
      {agents.loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : agents.error ? (
        <div className="text-red-300 text-sm">{agents.error}</div>
      ) : (
        <>
          <div className="text-text text-2xl font-bold">
            {agents.total === 0
              ? '0 / 0'
              : `${agents.online} / ${agents.total}`}{' '}
            <span className="text-accent text-base font-semibold">
              {agents.total > 0 ? 'online' : 'agents'}
            </span>
          </div>
          {agents.scopes.length > 0 ? (
            <div className="text-muted text-xs mt-1">
              {agents.scopes.slice(0, 4).join(' · ')}
              {agents.scopes.length > 4 ? ' · …' : ''}
            </div>
          ) : agents.total > 0 ? (
            <div className="text-muted text-xs mt-1">unscoped</div>
          ) : (
            <div className="text-muted text-xs mt-1">
              Mint one with{' '}
              <code className="font-mono">POST /api/v1/agents</code>.
            </div>
          )}
          {agents.lastSeenAgo && (
            <div className="text-muted/70 text-xs mt-2">
              last check-in {agents.lastSeenAgo}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// --- Requests this week (placeholder bar chart) ---------------------

const WEEK_DEMO = [
  { d: 'M', v: 0.55 },
  { d: 'T', v: 0.45 },
  { d: 'W', v: 0.7 },
  { d: 'T', v: 0.5 },
  { d: 'F', v: 0.95 },
  { d: 'S', v: 0.15 },
  { d: 'S', v: 0.12 },
];

function RequestsWeekCard() {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-text font-semibold">Requests this week</h3>
        <StatusPill variant="neutral" tone="outline">
          preview
        </StatusPill>
      </div>
      <div className="px-5 py-5">
        <div className="flex items-end justify-between gap-2 h-32">
          {WEEK_DEMO.map((b, i) => (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end gap-2 h-full"
            >
              <div
                className="w-full rounded-md bg-brand-gradient"
                style={{ height: `${Math.round(b.v * 100)}%` }}
              />
              <div className="text-muted text-[11px]">{b.d}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// --- helpers --------------------------------------------------------

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
  return <td className={`px-5 py-3 align-middle ${className}`}>{children}</td>;
}

interface AgentsSnapshot {
  loading: boolean;
  error?: string;
  total: number;
  online: number;
  scopes: string[];
  lastSeenAgo?: string;
}

function useAgentsSnapshot(): AgentsSnapshot {
  const [state, setState] = useState<AgentsSnapshot>({
    loading: true,
    total: 0,
    online: 0,
    scopes: [],
  });

  useEffect(() => {
    const ac = new AbortController();
    api
      .get<Agent[]>('/api/v1/agents', { signal: ac.signal })
      .then((rows) => {
        const total = rows.length;
        const online = rows.filter((a) => a.status === 'active').length;
        const scopes = Array.from(
          new Set(
            rows
              .map((a) => {
                if (!a.scope) return null;
                const s = a.scope as Record<string, unknown>;
                return (
                  (s.cluster as string) ??
                  (s.cluster_name as string) ??
                  (s.region as string) ??
                  null
                );
              })
              .filter((x): x is string => !!x),
          ),
        );
        const lastSeen = rows
          .map((a) => (a.last_seen_at ? new Date(a.last_seen_at) : null))
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        setState({
          loading: false,
          total,
          online,
          scopes,
          lastSeenAgo: lastSeen ? formatAgo(lastSeen) : undefined,
        });
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setState({
          loading: false,
          total: 0,
          online: 0,
          scopes: [],
          error:
            err instanceof Error
              ? err.message
              : 'failed to load agents',
        });
      });
    return () => ac.abort();
  }, []);

  return state;
}

function formatAgo(d: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
