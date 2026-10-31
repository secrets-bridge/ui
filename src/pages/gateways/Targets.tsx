/**
 * Argo CD targets (`/gateways`): what a team can bind, and the bindings
 * it already has. It is outside /admin because a team-scoped gateway.bind
 * holder uses it (ADR 0002 S5); every list is filtered by the server to
 * the caller's teams, before paging. A platform admin sees every target.
 *
 * Choosing a project narrows the targets to what that project can bind,
 * so the page never offers a target that answers target_team_mismatch.
 */

import { useSearchParams } from 'react-router-dom';

import { useProjects } from '../../api/tenancy';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { BindingsTab } from './BindingsTab';
import { CatalogTab } from './CatalogTab';

export function Targets() {
  const { hasPermission, hasGlobalPermission } = useAuth();
  const allowed = hasPermission('gateway.bind') || hasGlobalPermission('gateway.list');
  const [params, setParams] = useSearchParams();
  const projects = useProjects();

  const tab = params.get('tab') === 'bindings' ? 'bindings' : 'targets';
  const projectId = params.get('project') ?? '';
  const connectorId = params.get('connector') ?? '';

  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Argo CD targets" />
        <EmptyState title="You can't view Argo CD targets.">This needs gateway.bind for your team. Ask an administrator.</EmptyState>
      </div>
    );
  }

  const sorted = [...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Argo CD targets" description="The Applications your Gateways found, and which environments observe them." />
      <Tabs
        idPrefix="targets"
        label="Argo CD targets"
        value={tab}
        onChange={(t) => set('tab', t === 'bindings' ? t : '')}
        tabs={[
          { id: 'targets', label: 'Targets' },
          { id: 'bindings', label: 'Bindings' },
        ]}
      />
      <TabPanel idPrefix="targets" value={tab}>
        {tab === 'targets' ? (
          <CatalogTab
            projects={sorted}
            projectsLoaded={projects.isSuccess}
            projectId={projectId}
            onProject={(id) => set('project', id)}
            connectorId={connectorId}
            onClearConnector={() => set('connector', '')}
          />
        ) : (
          <BindingsTab projects={sorted} projectId={projectId} onProject={(id) => set('project', id)} />
        )}
      </TabPanel>
    </div>
  );
}
