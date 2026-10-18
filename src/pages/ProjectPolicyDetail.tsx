/**
 * R-follow-up #5 §5 D7 — a project policy rule's page.
 *
 *   /projects/:id/policies/:ruleID
 *
 * Overview and History tabs. Creating and deleting stay on the project's
 * policies page (OQ5-2); this page is for reading and deep links.
 * History is gated by `canViewPolicyRuleHistory`, the same permission as
 * the list page (OQ5-1).
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { useMe } from '../api/me';
import { useProjectPolicyRuleHistory } from '../api/policyRuleHistory';
import { useProjectPolicyRule } from '../api/projectPolicyRules';
import { useAuth } from '../auth/AuthContext';
import { canViewPolicyRuleHistory } from '../auth/capabilities';
import { formatExact } from '../lib/time';
import { Banner } from '../ui/Banner';
import { PolicyHistoryView } from './PolicyHistoryTimeline';
import type { SelectorNames } from './policies/labels';
import { DetailRows, Loading, Panel, RuleDetailFrame, RuleLoadProblem, RuleStatus, Selector, type RuleTab } from './policies/parts';

export function ProjectPolicyDetail() {
  const { id: projectID, ruleID } = useParams<{ id: string; ruleID: string }>();
  const [tab, setTab] = useState<RuleTab>('overview');
  const rule = useProjectPolicyRule(projectID, ruleID);
  const me = useMe();
  const auth = useAuth();

  const historyAllowed = canViewPolicyRuleHistory({ kind: 'project', projectID: projectID ?? '' }, { permissions: auth.identity?.permissions });
  const project = me.data?.projects.find((p) => p.id === projectID);
  const listPath = `/projects/${projectID}/policies`;
  const base = [
    { label: 'Project policies', to: '/projects/policies' },
    { label: project?.name ?? 'Project', to: listPath },
  ];

  if (rule.isLoading) return <Loading>Loading the rule…</Loading>;
  if (rule.isError || !rule.data) {
    return (
      <RuleLoadProblem
        crumbs={[...base, { label: 'Rule' }]}
        error={rule.error}
        back={{ to: listPath, label: "Back to the project's policies" }}
        onRetry={() => void rule.refetch()}
      />
    );
  }

  const r = rule.data;
  const inherited = r.is_platform_inherited || !!r.is_team_inherited;
  const names: SelectorNames = {
    project: (id) => (id === project?.id ? project?.name : undefined),
    environment: (id) => project?.environments?.find((e) => e.id === id)?.name,
  };
  const workflow = r.workflow_name ?? r.workflow_id.slice(0, 8);
  const kind = r.is_platform_inherited ? 'Platform rule' : r.is_team_inherited ? `Team rule${r.team_name ? ` from ${r.team_name}` : ''}` : 'Project rule';

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
              ['Applies to', inherited ? `${kind}, inherited by this project` : `This project${project ? ` · ${project.name}` : ''}`],
              [
                inherited ? 'Matches on' : 'Matches',
                inherited ? <Selector key="m" keys={r.selector_keys} /> : <Selector key="m" selector={r.selector ?? {}} names={names} />,
              ],
              ['Workflow', workflow],
              ['Priority', <span key="p" className="font-mono text-mono">{r.priority}</span>],
              ...(r.updated_at ? ([['Last changed', formatExact(r.updated_at)]] as [string, string][]) : []),
            ]}
          />
          <p className="border-t border-rule px-5 py-3 text-caption text-muted">
            {inherited ? "Read-only here. Its selector values aren't shown." : "Create or delete rules from the project's policies page."}
          </p>
        </Panel>
      }
      history={
        historyAllowed.allowed ? (
          <ProjectHistory projectID={projectID!} ruleID={ruleID!} />
        ) : (
          <Banner title="History needs the policy.author permission for this project.">Ask an administrator if you need to see who changed this rule.</Banner>
        )
      }
    />
  );
}

function ProjectHistory({ projectID, ruleID }: { projectID: string; ruleID: string }) {
  const [limit, setLimit] = useState(50);
  const q = useProjectPolicyRuleHistory(projectID, ruleID, limit);
  return <PolicyHistoryView query={q} onLoadMore={() => setLimit((n) => Math.min(n + 50, 500))} pageScope="project" />;
}
