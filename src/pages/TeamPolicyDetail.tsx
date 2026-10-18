/**
 * R-follow-up #5 §5 D7 — a team policy rule's page.
 *
 *   /teams/:id/policies/:ruleID
 *
 * Fail-closed on team coverage (§5 C4): until
 * `useMyPolicyAuthorTeamCoverage` has loaded, History says it is
 * checking access and never loads. Mirrors R-follow-up #3 §5 C3.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { useMyPolicyAuthorTeamCoverage } from '../api/myPolicyAuthorTeamCoverage';
import { useTeamPolicyRuleHistory } from '../api/policyRuleHistory';
import { useTeamPolicyRule } from '../api/teamPolicyRules';
import { useTeams } from '../api/teams';
import { useAuth } from '../auth/AuthContext';
import { canViewPolicyRuleHistory } from '../auth/capabilities';
import { formatExact } from '../lib/time';
import { Banner } from '../ui/Banner';
import { PolicyHistoryView } from './PolicyHistoryTimeline';
import { DetailRows, Loading, Panel, RuleDetailFrame, RuleLoadProblem, RuleStatus, Selector, type RuleTab } from './policies/parts';

export function TeamPolicyDetail() {
  const { id: teamID, ruleID } = useParams<{ id: string; ruleID: string }>();
  const [tab, setTab] = useState<RuleTab>('overview');
  const rule = useTeamPolicyRule(teamID, ruleID);
  const coverage = useMyPolicyAuthorTeamCoverage();
  const teams = useTeams();
  const auth = useAuth();

  // Fail closed while coverage loads: never fall back to allowed.
  const coverageReady = coverage.data !== undefined;
  const historyAllowed = coverageReady
    ? canViewPolicyRuleHistory({ kind: 'team', teamID: teamID ?? '' }, { permissions: auth.identity?.permissions, teamCoverage: coverage.data })
    : ({ allowed: false, reason: 'no_perm' } as const);

  const team = teams.data?.find((t) => t.id === teamID);
  const listPath = `/teams/${teamID}/policies`;
  const base = [
    { label: 'Team policies', to: '/teams/policies' },
    { label: team?.name ?? 'Team', to: listPath },
  ];

  if (rule.isLoading) return <Loading>Loading the rule…</Loading>;
  if (rule.isError || !rule.data) {
    return (
      <RuleLoadProblem
        crumbs={[...base, { label: 'Rule' }]}
        error={rule.error}
        back={{ to: listPath, label: "Back to the team's policies" }}
        onRetry={() => void rule.refetch()}
      />
    );
  }

  const r = rule.data.rule;
  const inherited = r.is_platform_inherited || r.is_ancestor_inherited;
  const kind = r.is_platform_inherited ? 'Platform rule' : r.is_ancestor_inherited ? `Parent team rule${r.team_name ? ` from ${r.team_name}` : ''}` : 'Team rule';
  const workflow = r.workflow_name ?? r.workflow_id.slice(0, 8);

  return (
    <RuleDetailFrame
      crumbs={[...base, { label: r.name }]}
      title={r.name}
      fact={`${kind} · priority ${r.priority} · workflow ${workflow}`}
      tab={tab}
      onTab={setTab}
      overview={
        <Panel>
          <DetailRows
            rows={[
              ['Status', <RuleStatus key="s" enabled={r.enabled} />],
              ['Applies to', inherited ? `${kind}, inherited by this team` : `${r.team_name ?? team?.name ?? 'This team'} and its sub-teams, non-production only`],
              [
                inherited ? 'Matches on' : 'Matches',
                inherited || !r.selector ? <Selector key="m" keys={r.selector_keys} /> : <Selector key="m" selector={r.selector} />,
              ],
              ['Workflow', workflow],
              ['Priority', <span key="p" className="font-mono text-mono">{r.priority}</span>],
              ...(r.updated_at ? ([['Last changed', formatExact(r.updated_at)]] as [string, string][]) : []),
            ]}
          />
          <p className="border-t border-rule px-5 py-3 text-caption text-muted">
            {inherited ? "Read-only here. Its selector values aren't shown." : "Create or delete rules from the team's policies page."}
          </p>
        </Panel>
      }
      history={
        historyAllowed.allowed ? (
          <TeamHistory teamID={teamID!} ruleID={ruleID!} />
        ) : !coverageReady ? (
          <p className="text-muted">Checking your access to this team…</p>
        ) : (
          <Banner title="History needs the policy.author permission for this team.">Ask an administrator if you need to see who changed this rule.</Banner>
        )
      }
    />
  );
}

function TeamHistory({ teamID, ruleID }: { teamID: string; ruleID: string }) {
  const [limit, setLimit] = useState(50);
  const q = useTeamPolicyRuleHistory(teamID, ruleID, limit);
  return <PolicyHistoryView query={q} onLoadMore={() => setLimit((n) => Math.min(n + 50, 500))} pageScope="team" />;
}
