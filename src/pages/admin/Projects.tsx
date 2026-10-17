/**
 * Projects (admin, `/admin/projects`).
 *
 * The list of projects, and `?project=<id>` for one project: its
 * environments and the secrets bound to it (see ./projects/ProjectDetail).
 * The query string keeps the detail linkable and the back button working
 * without a route of its own.
 *
 * Projects archive instead of being deleted: the status flips between
 * `active` and `archived` and every request, grant and mapping that
 * names the project stays valid. Environments are hard-deleted (role
 * grants name them by name, so recreating one restores the match).
 * Every environment created here appears in the Integrations and
 * Assignments pickers.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import { useTeams } from '../../api/teams';
import { useCreateProject, useProjects } from '../../api/tenancy';
import type { Project, ProjectInput } from '../../api/types';
import { formatExact } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { EntityMark } from '../../ui/EntityMark';
import { Field, Input } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';
import { ProjectDetail } from './projects/ProjectDetail';
import { projectTeamLabel } from './projects/projectTeam';

function errorText(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export function Projects() {
  const list = useProjects();
  const teams = useTeams();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('project');

  // The detail and the list share a path, so the shell doesn't move
  // focus between them; do it here, after the first render.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('page-title')?.focus();
  }, [selectedId]);

  const open = (id: string) => setParams({ project: id });

  if (selectedId) {
    return <ProjectDetail projectId={selectedId} projects={list} teams={teams.data ?? []} />;
  }

  const rows = [...(list.data ?? [])].sort(
    (a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.name.localeCompare(b.name),
  );
  const archived = rows.filter((p) => p.status === 'archived').length;
  const teamOf = (p: Project) => projectTeamLabel(p, teams.data ?? []);

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (p) => (
        <span className="inline-flex items-center gap-2.5">
          <EntityMark name={p.name} size="md" />
          <button type="button" onClick={() => open(p.id)} className="text-left font-medium text-accent hover:underline">
            {p.name}
          </button>
        </span>
      ),
    },
    { key: 'team', header: 'Team', render: (p) => teamOf(p) },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <ToneStatus tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Archived'}</ToneStatus>,
    },
    {
      key: 'created',
      header: 'Created',
      render: (p) => <span className="whitespace-nowrap">{p.created_at ? formatExact(p.created_at) : '—'}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Projects"
        description={
          list.data
            ? `${rows.length} ${rows.length === 1 ? 'project' : 'projects'}${archived ? ` · ${archived} archived` : ''}. Open one to manage its environments and bound secrets.`
            : 'Projects group environments and the secrets bound to them.'
        }
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Create project
          </Button>
        }
      />

      {list.isLoading && <p className="text-muted">Loading projects…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the projects."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorText(list.error)}
        </Banner>
      )}
      {list.data &&
        (rows.length === 0 ? (
          <EmptyState
            title="No projects yet."
            action={
              <Button variant="secondary" onClick={() => setCreating(true)}>
                Create project
              </Button>
            }
          >
            Create one, add its environments, then bind the secrets its members may request.
          </EmptyState>
        ) : (
          <DataTable
            label="Projects"
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            onRowClick={(p) => open(p.id)}
            minWidth={600}
            stacked={(p) => (
              <div className="flex flex-col gap-1">
                <p className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    <EntityMark name={p.name} />
                    <button type="button" onClick={() => open(p.id)} className="text-left font-medium text-accent hover:underline">
                      {p.name}
                    </button>
                  </span>
                  <ToneStatus tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Archived'}</ToneStatus>
                </p>
                <p className="text-caption text-muted">
                  {teamOf(p)}
                  {p.created_at ? ` · created ${formatExact(p.created_at)}` : ''}
                </p>
              </div>
            )}
          />
        ))}

      {creating && (
        <CreateProjectDrawer
          onCreated={(p) => {
            setCreating(false);
            toast(`Created project ${p.name}.`);
            open(p.id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}

const projectSchema = z.object({
  name: z.string().trim().min(1, 'Enter a project name.').max(120, 'Use 120 characters or fewer.'),
  owner_team_id: z.string().max(120, 'Use 120 characters or fewer.').optional(),
});

function CreateProjectDrawer({ onCreated, onCancel }: { onCreated: (p: Project) => void; onCancel: () => void }) {
  const create = useCreateProject();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: '', owner_team_id: '' },
  });

  const onValid: SubmitHandler<ProjectInput> = async (data) => {
    try {
      const created = await create.mutateAsync({ name: data.name.trim(), owner_team_id: data.owner_team_id?.trim() || undefined });
      onCreated(created);
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Create project"
      subtitle="Add its environments next, then bind the secrets its members may request."
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="create-project" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="create-project" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        <Field id="project-name" label="Name" error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="Payments" autoComplete="off" data-autofocus />}
        </Field>
        <Field
          id="project-owner"
          label="Owner label (optional)"
          hint="Free text shown in the project list. It doesn't put the project under a team, so team-scoped grants and cross-team requests don't use it."
          error={errors.owner_team_id?.message}
        >
          {(p) => <Input {...p} {...register('owner_team_id')} placeholder="team-payments" autoComplete="off" />}
        </Field>
        {create.isError && (
          <Banner tone="error" title="Not created.">
            {errorText(create.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
