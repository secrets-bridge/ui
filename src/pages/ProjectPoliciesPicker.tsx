/**
 * EPIC R (api#108) Slice R3 — project picker behind the sidebar's
 * "Project policies" entry.
 *
 *   /projects/policies
 *
 * §5 Q13: one project goes straight to its policies page; several show
 * this list; none says so.
 */

import { Link, Navigate, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useMe } from '../api/me';
import type { MyProject } from '../api/types';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { EntityMark } from '../ui/EntityMark';
import { EnvTag } from '../ui/EnvTag';
import { PageHeader } from '../ui/PageHeader';
import { Loading } from './policies/parts';

export function ProjectPoliciesPicker() {
  const me = useMe();
  const navigate = useNavigate();

  if (me.isLoading) return <Loading>Loading your projects…</Loading>;

  const projects = [...(me.data?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (projects.length === 1) return <Navigate to={`/projects/${projects[0].id}/policies`} replace />;

  const to = (p: MyProject) => `/projects/${p.id}/policies`;
  const columns: Column<MyProject>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (p) => (
        <span className="inline-flex items-center gap-2.5">
          <EntityMark name={p.name} size="md" />
          <Link to={to(p)} className="font-medium text-accent hover:underline">
            {p.name}
          </Link>
        </span>
      ),
    },
    {
      key: 'envs',
      header: 'Environments',
      render: (p) =>
        (p.environments ?? []).length ? (
          <span className="inline-flex flex-wrap gap-1.5">
            {(p.environments ?? []).map((e) => (
              <EnvTag key={e.id} kind={e.kind}>
                {e.name}
              </EnvTag>
            ))}
          </span>
        ) : (
          <span className="text-muted">None yet</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="Project policies" description="Choose a project to see its rules and author rules for its non-production environments." />
      {me.isError && (
        <Banner
          tone="error"
          title="Couldn't load your projects."
          action={
            <Button variant="secondary" size="sm" onClick={() => void me.refetch()}>
              Try again
            </Button>
          }
        >
          {me.error instanceof ApiError ? `${me.error.status}: ${me.error.message}` : 'Network error.'}
        </Banner>
      )}
      {me.data &&
        (projects.length === 0 ? (
          <EmptyState title="No projects to show.">You don't have access to a project yet. Ask an administrator for a role on one.</EmptyState>
        ) : (
          <DataTable label="Your projects" columns={columns} rows={projects} rowKey={(p) => p.id} onRowClick={(p) => navigate(to(p))} minWidth={420} />
        ))}
    </div>
  );
}
