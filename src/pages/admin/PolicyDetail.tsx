/**
 * R-follow-up #5 §5 D7 — Admin policy rule Detail page.
 *
 *   /admin/policies/:id
 *
 * Admin context: requires `policy.edit`. Per §4 C2/C4 the History tab
 * stays accessible even when the rule has been deleted — the api's
 * existence check looks at the audit chain instead of policyRepo.Get.
 * That post-delete forensic visibility is admin-only.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { canViewPolicyRuleHistory } from '../../auth/capabilities';
import { usePolicy } from '../../api/policies';
import { useAdminPolicyRuleHistory } from '../../api/policyRuleHistory';
import { Card, CardBody } from '../../ui/Card';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';
import { PolicyHistoryTimeline } from '../PolicyHistoryTimeline';

type Tab = 'overview' | 'history';

export function AdminPolicyDetail() {
  const { id: ruleID } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const auth = useAuth();
  const rule = usePolicy(ruleID);

  const historyAllowed = canViewPolicyRuleHistory(
    { kind: 'admin' },
    { permissions: auth.identity?.permissions },
  );

  if (rule.isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card><CardBody><p className="text-sm text-muted">Loading rule…</p></CardBody></Card>
      </div>
    );
  }
  const ruleMissing = rule.isError || !rule.data;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <PageHeader
        title={ruleMissing ? `Deleted rule · ${ruleID?.slice(0, 8)}…` : rule.data!.name}
        description={
          ruleMissing
            ? 'Rule has been deleted. History below loads from the audit chain (admin post-delete forensic visibility).'
            : `Platform rule · priority ${rule.data!.priority}`
        }
        actions={
          <Link to="/admin/policies" className="text-accent text-xs hover:underline">
            ← Back
          </Link>
        }
      />

      <TabBar tab={tab} onTab={setTab} historyDisabled={!historyAllowed.allowed} />

      {tab === 'overview' && (
        ruleMissing ? (
          <Card className="border-yellow-400/40">
            <CardBody>
              <p className="text-sm text-yellow-200">
                This rule no longer exists. Switch to the History tab to view
                its audit trail.
              </p>
            </CardBody>
          </Card>
        ) : (
          <OverviewBlock rule={rule.data!} />
        )
      )}
      {tab === 'history' && historyAllowed.allowed && (
        <AdminHistoryTabBody ruleID={ruleID!} />
      )}
    </div>
  );
}

function TabBar({
  tab,
  onTab,
  historyDisabled,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  historyDisabled: boolean;
}) {
  return (
    <div className="border-b border-border flex gap-4 text-sm">
      <button
        type="button"
        onClick={() => onTab('overview')}
        className={
          tab === 'overview'
            ? 'pb-2 border-b-2 border-accent text-text'
            : 'pb-2 text-muted hover:text-text'
        }
      >
        Overview
      </button>
      <button
        type="button"
        onClick={() => onTab('history')}
        disabled={historyDisabled}
        title={historyDisabled ? 'policy.edit required' : undefined}
        className={
          historyDisabled
            ? 'pb-2 text-muted/50 cursor-not-allowed'
            : tab === 'history'
              ? 'pb-2 border-b-2 border-accent text-text'
              : 'pb-2 text-muted hover:text-text'
        }
      >
        History
      </button>
    </div>
  );
}

function OverviewBlock({ rule }: { rule: { name: string; selector?: Record<string, unknown>; enabled: boolean; is_system?: boolean; team_id?: string | null; project_id?: string | null } }) {
  const anchor = rule.team_id ? 'team' : rule.project_id ? 'project' : 'platform';
  return (
    <Card>
      <CardBody className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          {rule.enabled ? (
            <StatusPill variant="success" tone="outline">enabled</StatusPill>
          ) : (
            <StatusPill variant="error" tone="outline">disabled</StatusPill>
          )}
          {rule.is_system && (
            <StatusPill variant="system" tone="outline">system</StatusPill>
          )}
          <span className="inline-flex items-center rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] font-mono uppercase text-muted">
            {anchor}
          </span>
        </div>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-muted">Selector:</dt>
          <dd className="flex flex-wrap gap-1">
            {Object.entries(rule.selector ?? {}).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] font-mono"
              >
                <span className="text-muted">{k}</span>
                <span className="text-muted/50">=</span>
                <span className="text-accent">{String(v)}</span>
              </span>
            ))}
          </dd>
        </dl>
        <p className="text-[11px] text-muted italic">
          Edit / delete via the parent list page's drawer. Detail page is
          read-only by design (R-follow-up #5 §5 OQ5-2).
        </p>
      </CardBody>
    </Card>
  );
}

function AdminHistoryTabBody({ ruleID }: { ruleID: string }) {
  const [limit, setLimit] = useState(50);
  const q = useAdminPolicyRuleHistory(ruleID, limit);
  if (q.isLoading) {
    return (
      <Card><CardBody><p className="text-sm text-muted">Loading history…</p></CardBody></Card>
    );
  }
  if (q.isError) {
    return (
      <Card className="border-red-500/40">
        <CardBody>
          <p className="text-sm text-red-300">Failed to load history.</p>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="text-accent text-xs hover:underline mt-1"
          >
            Retry
          </button>
        </CardBody>
      </Card>
    );
  }
  const data = q.data!;
  return (
    <PolicyHistoryTimeline
      entries={data.entries}
      hasMore={data.has_more}
      limit={data.limit}
      onLoadMore={() => setLimit((n) => Math.min(n + 50, 500))}
      pageScope={data.scope === 'platform' ? 'platform' : data.scope}
    />
  );
}
