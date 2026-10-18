/**
 * R-follow-up #5 §5 D7 — a platform policy rule's page (admin).
 *
 *   /admin/policies/:id
 *
 * Overview and History tabs. Editing and deleting stay on the Policies
 * list (OQ5-2); this page is for reading and deep links. History needs
 * policy.edit and stays readable after the rule is deleted, because the
 * api checks the audit chain rather than the rule (§4 C2/C4).
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { usePolicy } from '../../api/policies';
import { useAdminPolicyRuleHistory } from '../../api/policyRuleHistory';
import type { Policy } from '../../api/types';
import { useTeams } from '../../api/teams';
import { useProjects } from '../../api/tenancy';
import { useWorkflows } from '../../api/workflows';
import { useAuth } from '../../auth/AuthContext';
import { canViewPolicyRuleHistory } from '../../auth/capabilities';
import { formatExact } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { PolicyHistoryView } from '../PolicyHistoryTimeline';
import { ANCHOR_LABEL, anchorOf, formatSeconds, type SelectorNames } from '../policies/labels';
import { DetailRows, Loading, Panel, RuleDetailFrame, RuleStatus, Selector, type RuleTab } from '../policies/parts';

/** Reveal settings the api returns on a policy (not yet in `Policy`). */
type PolicyWithReveal = Policy & {
  direct_reveal_allowed?: boolean;
  requires_mfa?: boolean;
  reveal_ttl_seconds?: number;
};

export function AdminPolicyDetail() {
  const { id: ruleID } = useParams<{ id: string }>();
  const [tab, setTab] = useState<RuleTab>('overview');
  const auth = useAuth();
  const rule = usePolicy(ruleID);
  const workflows = useWorkflows();
  const projects = useProjects();
  const teams = useTeams();

  const historyAllowed = canViewPolicyRuleHistory({ kind: 'admin' }, { permissions: auth.identity?.permissions });

  if (rule.isLoading) return <Loading>Loading the rule…</Loading>;

  // A deleted rule still has a history (admin only).
  const missing = rule.isError || !rule.data;
  const r = rule.data as PolicyWithReveal | undefined;
  const crumbs = [{ label: 'Policies', to: '/admin/policies' }, { label: r?.name ?? 'Deleted rule' }];
  const names: SelectorNames = {
    project: (id) => projects.data?.find((p) => p.id === id)?.name,
    team: (id) => teams.data?.find((t) => t.id === id)?.name,
  };
  const workflow = r ? workflows.data?.find((w) => w.id === r.workflow_id)?.name : undefined;

  const overview = missing ? (
    <Banner
      title="This rule no longer exists."
      action={
        historyAllowed.allowed ? (
          <Button variant="secondary" size="sm" onClick={() => setTab('history')}>
            Show history
          </Button>
        ) : undefined
      }
    >
      It was deleted, or the id is wrong. Its history stays readable for administrators.
    </Banner>
  ) : (
    <Panel>
      <DetailRows
        rows={[
          ['Status', <RuleStatus key="s" enabled={r!.enabled} />],
          [
            'Applies to',
            anchorOf(r!) === 'project'
              ? `${ANCHOR_LABEL.project} · ${names.project?.(r!.project_id!) ?? r!.project_id}`
              : anchorOf(r!) === 'team'
                ? `${ANCHOR_LABEL.team} · ${names.team?.(r!.team_id!) ?? r!.team_id}`
                : 'The whole platform',
          ],
          ['Matches', <Selector key="m" selector={r!.selector ?? {}} names={names} />],
          ['Workflow', workflow ?? <span className="font-mono text-mono">{r!.workflow_id}</span>],
          ['Priority', <span key="p" className="font-mono text-mono">{r!.priority}</span>],
          ...revealRows(r!),
          ...(r!.is_system ? ([['Kind', 'System default. It can be edited but not deleted.']] as [string, string][]) : []),
          ...(r!.updated_at ? ([['Last changed', formatExact(r!.updated_at)]] as [string, string][]) : []),
          ['Rule id', <span key="id" className="break-all font-mono text-mono">{r!.id}</span>],
        ]}
      />
      <p className="border-t border-rule px-5 py-3 text-caption text-muted">Edit or delete this rule from the Policies list.</p>
    </Panel>
  );

  const history = historyAllowed.allowed ? (
    <AdminHistory ruleID={ruleID!} />
  ) : (
    <Banner title="History needs the policy.edit permission.">Ask an administrator if you need to see who changed this rule.</Banner>
  );

  return (
    <RuleDetailFrame
      crumbs={crumbs}
      title={r?.name ?? 'Deleted rule'}
      fact={
        missing
          ? `Rule ${ruleID?.slice(0, 8)} was deleted. Its history comes from the audit trail.`
          : `${anchorOf(r!) === 'platform' ? 'Platform rule' : `${ANCHOR_LABEL[anchorOf(r!)]} rule`} · priority ${r!.priority}${workflow ? ` · workflow ${workflow}` : ''}`
      }
      tab={tab}
      onTab={setTab}
      overview={overview}
      history={history}
    />
  );
}

/** What the rule says about revealing values, in words. */
function revealRows(r: PolicyWithReveal): [string, string][] {
  const rows: [string, string][] = [];
  if (r.direct_reveal_allowed !== undefined) {
    rows.push([
      'Direct reveal',
      r.direct_reveal_allowed
        ? 'Allowed on non-production environments. Production never allows it, whatever this rule says.'
        : 'Not allowed. Values are read through approved requests.',
    ]);
  }
  if (r.requires_mfa !== undefined) rows.push(['Second factor', r.requires_mfa ? 'Required before a value shows' : 'Not required by this rule']);
  if (r.reveal_ttl_seconds) rows.push(['Reveal window', formatSeconds(r.reveal_ttl_seconds)]);
  return rows;
}

function AdminHistory({ ruleID }: { ruleID: string }) {
  const [limit, setLimit] = useState(50);
  const q = useAdminPolicyRuleHistory(ruleID, limit);
  return (
    <PolicyHistoryView
      query={q}
      onLoadMore={() => setLimit((n) => Math.min(n + 50, 500))}
      pageScope={q.data && q.data.scope !== 'platform' ? q.data.scope : 'platform'}
    />
  );
}
