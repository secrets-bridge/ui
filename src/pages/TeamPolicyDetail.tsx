/**
 * R-follow-up #5 §5 D7 — Team policy rule Detail page.
 *
 *   /teams/:id/policies/:ruleID
 *
 * Fail-closed for team coverage per §5 C4: when
 * `useMyPolicyAuthorTeamCoverage` returns undefined (network failure /
 * not yet loaded), the History tab renders disabled with a "Loading
 * authorization context…" label. NEVER auto-allows. Mirrors
 * R-follow-up #3 §5 C3.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { canViewPolicyRuleHistory } from '../auth/capabilities';
import { useMyPolicyAuthorTeamCoverage } from '../api/myPolicyAuthorTeamCoverage';
import { useTeamPolicyRule } from '../api/teamPolicyRules';
import { Card, CardBody } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';
import { useTeamPolicyRuleHistory } from '../api/policyRuleHistory';
import { PolicyHistoryTimeline } from './PolicyHistoryTimeline';

type Tab = 'overview' | 'history';

export function TeamPolicyDetail() {
  const { id: teamID, ruleID } = useParams<{ id: string; ruleID: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const rule = useTeamPolicyRule(teamID, ruleID);
  const coverage = useMyPolicyAuthorTeamCoverage();
  const auth = useAuth();

  // Fail-closed: when coverage is still loading, the History tab is
  // disabled with a clear label. NEVER fall back to allowed.
  const coverageReady = coverage.data !== undefined;
  const historyAllowed = coverageReady
    ? canViewPolicyRuleHistory(
        { kind: 'team', teamID: teamID ?? '' },
        {
          permissions: auth.identity?.permissions,
          teamCoverage: coverage.data,
        },
      )
    : ({ allowed: false, reason: 'no_perm' } as const);

  if (rule.isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card><CardBody><p className="text-sm text-muted">Loading rule…</p></CardBody></Card>
      </div>
    );
  }
  if (rule.isError || !rule.data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card className="border-red-500/40">
          <CardBody>
            <h3 className="text-red-300 font-medium text-sm">Failed to load rule</h3>
            <p className="text-muted text-xs mt-1">{String(rule.error ?? 'Unknown error')}</p>
            <Link
              to={`/teams/${teamID}/policies`}
              className="text-accent text-xs hover:underline inline-block mt-2"
            >
              ← Back to team policies
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  const r = rule.data.rule;
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <PageHeader
        title={r.name}
        description={`Team rule · workflow ${r.workflow_name ?? r.workflow_id.slice(0, 8) + '…'} · priority ${r.priority}`}
        actions={
          <Link
            to={`/teams/${teamID}/policies`}
            className="text-accent text-xs hover:underline"
          >
            ← Back
          </Link>
        }
      />

      <TabBar
        tab={tab}
        onTab={setTab}
        historyDisabled={!historyAllowed.allowed}
        historyLabel={
          !coverageReady
            ? 'Loading authorization context…'
            : historyAllowed.allowed
              ? undefined
              : 'You need policy.author on this team to view history'
        }
      />

      {tab === 'overview' && <OverviewBlock rule={r} />}
      {tab === 'history' && historyAllowed.allowed && (
        <TeamHistoryTabBody teamID={teamID!} ruleID={ruleID!} />
      )}
    </div>
  );
}

function TabBar({
  tab,
  onTab,
  historyDisabled,
  historyLabel,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  historyDisabled: boolean;
  historyLabel?: string;
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
        title={historyLabel}
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

function OverviewBlock({ rule }: { rule: { name: string; selector_keys?: string[]; selector?: Record<string, unknown>; enabled: boolean; is_system?: boolean; team_name?: string } }) {
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
        </div>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-[12px]">
          {rule.team_name && (
            <>
              <dt className="text-muted">Team:</dt>
              <dd className="font-mono text-text">{rule.team_name}</dd>
            </>
          )}
          <dt className="text-muted">Selector keys:</dt>
          <dd className="flex flex-wrap gap-1">
            {(rule.selector_keys ?? Object.keys(rule.selector ?? {})).map((k) => (
              <span
                key={k}
                className="inline-flex items-center rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[10px] font-mono"
              >
                {k}
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

function TeamHistoryTabBody({ teamID, ruleID }: { teamID: string; ruleID: string }) {
  const [limit, setLimit] = useState(50);
  const q = useTeamPolicyRuleHistory(teamID, ruleID, limit);
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
      pageScope="team"
    />
  );
}
