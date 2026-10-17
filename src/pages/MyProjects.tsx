/**
 * My projects (`/projects`): every project and environment the
 * signed-in person can work in, one row each. A row opens the
 * environment page, where its secrets are listed and access is asked
 * for. Reads `/users/me` (projects with their environments).
 */

import { useNavigate, Link } from 'react-router-dom';

import { useMe } from '../api/me';
import type { MyEnvironment, MyProject } from '../api/types';
import { Banner } from '../ui/Banner';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { EnvTag } from '../ui/EnvTag';
import { PageHeader } from '../ui/PageHeader';

interface Row {
  project: MyProject;
  env: MyEnvironment;
}

export function MyProjects() {
  const me = useMe();
  const navigate = useNavigate();
  const projects = me.data?.projects ?? [];
  const rows: Row[] = projects
    .flatMap((project) => (project.environments ?? []).map((env) => ({ project, env })))
    .sort((a, b) => a.project.name.localeCompare(b.project.name) || a.env.name.localeCompare(b.env.name));
  const withoutEnvs = projects.filter((p) => (p.environments ?? []).length === 0);
  const to = (r: Row) => `/projects/${r.project.id}/env/${r.env.id}`;

  const columns: Column<Row>[] = [
    {
      key: 'project',
      header: 'Project',
      render: (r) => (
        <Link to={to(r)} className="font-medium text-accent hover:underline">
          {r.project.name}
          {r.project.status === 'archived' && <span className="ml-2 text-caption font-normal text-muted">archived</span>}
        </Link>
      ),
    },
    { key: 'env', header: 'Environment', render: (r) => <EnvTag kind={r.env.kind}>{r.env.name}</EnvTag> },
    {
      key: 'kind',
      header: 'Kind',
      render: (r) =>
        r.env.kind === 'prod' ? (
          <span>Production · approved reads only</span>
        ) : (
          <span className="text-muted">Non-production</span>
        ),
    },
    { key: 'risk', header: 'Risk level', align: 'right', render: (r) => <span className="font-mono text-mono">{r.env.risk_level}</span> },
  ];

  return (
    <div>
      <PageHeader title="My projects" description="Open an environment to see the secrets bound to it and ask for access." />
      {me.isLoading && <p className="text-muted">Loading your projects…</p>}
      {me.isError && <Banner tone="error" title="Couldn't load your projects.">Try again in a moment.</Banner>}
      {me.data &&
        (rows.length > 0 ? (
          <DataTable
            label="Your projects and environments"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.env.id}
            onRowClick={(r) => navigate(to(r))}
            minWidth={560}
            stacked={(r) => (
              <div className="flex flex-col gap-1">
                <p>
                  <Link to={to(r)} className="font-medium text-accent hover:underline">
                    {r.project.name}
                  </Link>{' '}
                  <EnvTag kind={r.env.kind}>{r.env.name}</EnvTag>
                </p>
                <p className="text-caption text-muted">
                  {r.env.kind === 'prod' ? 'Production · approved reads only' : 'Non-production'} · risk level {r.env.risk_level}
                </p>
              </div>
            )}
          />
        ) : (
          <EmptyState title="You don't have access to a project yet.">
            Ask an administrator for a role on the project and environment you need.
          </EmptyState>
        ))}
      {withoutEnvs.length > 0 && (
        <p className="mt-3 text-caption text-muted">
          No environments yet in {withoutEnvs.map((p) => p.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
