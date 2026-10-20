/**
 * One project in the admin console (`/admin/projects?project=<id>`):
 * archive or restore it, manage its environments, and the secrets bound
 * to it (`?tab=secrets`).
 *
 * Archive is a status flip, not a delete, so it happens at once and is
 * undone with Restore. Deleting an environment asks first.
 */

import { useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../../../api/client';
import { logoUrl } from '../../../api/logos';
import type { Team } from '../../../api/teams';
import {
  useCreateEnvironment,
  useDeleteEnvironment,
  useEnvironmentsForProject,
  useProjectSecrets,
  useUpdateProjectStatus,
} from '../../../api/tenancy';
import type { Environment, Project } from '../../../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { formatExact } from '../../../lib/time';
import { Banner } from '../../../ui/Banner';
import { Breadcrumb } from '../../../ui/Breadcrumb';
import { Button } from '../../../ui/Button';
import { ConfirmModal } from '../../../ui/ConfirmModal';
import { DataTable, type Column } from '../../../ui/DataTable';
import { Drawer } from '../../../ui/Drawer';
import { EmptyState } from '../../../ui/EmptyState';
import { EntityMark } from '../../../ui/EntityMark';
import { EnvTag } from '../../../ui/EnvTag';
import { Field, Input, Select } from '../../../ui/Field';
import { PageHeader } from '../../../ui/PageHeader';
import { TabPanel, Tabs } from '../../../ui/Tabs';
import { useToast } from '../../../ui/toastContext';
import { ProjectSecretsPanel } from '../ProjectSecretsPanel';
import { LogoDialog } from './LogoDialog';
import { ObservationSourceCell } from './ObservationSource';
import { projectTeamLabel } from './projectTeam';

const TYPE_LABEL: Record<Environment['type'], string> = {
  dev: 'Development',
  staging: 'Staging',
  uat: 'UAT',
  prod: 'Production',
  other: 'Other',
};

function errorText(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export function ProjectDetail({
  projectId,
  projects,
  teams,
}: {
  projectId: string;
  projects: UseQueryResult<Project[]>;
  teams: Team[];
}) {
  const [params, setParams] = useSearchParams();
  const project = projects.data?.find((p) => p.id === projectId);
  const crumbs = [{ label: 'Projects', to: '/admin/projects' }, { label: project?.name ?? 'Project' }];

  if (projects.isLoading) {
    return (
      <div>
        <Breadcrumb items={crumbs} />
        <p className="mt-4 text-muted">Loading the project…</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div>
        <Breadcrumb items={crumbs} />
        <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
          You can't open this project
        </h1>
        <Banner
          tone={projects.isError ? 'error' : 'note'}
          title={projects.isError ? "Couldn't load the projects." : "It doesn't exist any more, or the link is wrong."}
          action={
            projects.isError ? (
              <Button variant="secondary" size="sm" onClick={() => void projects.refetch()}>
                Try again
              </Button>
            ) : undefined
          }
        >
          <Link to="/admin/projects" className="font-medium text-accent hover:underline">
            Back to projects
          </Link>
        </Banner>
      </div>
    );
  }

  const tab = params.get('tab') === 'secrets' ? 'secrets' : 'environments';
  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    if (t === 'secrets') next.set('tab', 'secrets');
    else next.delete('tab');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <Breadcrumb items={crumbs} />
      <div className="mt-3">
        <Header project={project} teams={teams} />
      </div>
      <Counts project={project} tab={tab} setTab={setTab} />
      <div className="mt-5">
        <TabPanel idPrefix="project" value={tab}>
          {tab === 'environments' ? <EnvironmentsPanel project={project} /> : <ProjectSecretsPanel project={project} />}
        </TabPanel>
      </div>
    </div>
  );
}

function Header({ project, teams }: { project: Project; teams: Team[] }) {
  const status = useUpdateProjectStatus(project.id);
  const [logo, setLogo] = useState(false);
  const toast = useToast();
  const archived = project.status === 'archived';

  const toggle = async () => {
    try {
      await status.mutateAsync(archived ? 'active' : 'archived');
      toast(archived ? `Restored ${project.name}.` : `Archived ${project.name}. Restore it at any time.`);
    } catch {
      // Shown below.
    }
  };

  const facts = [
    `Team: ${projectTeamLabel(project, teams)}`,
    project.created_at ? `created ${formatExact(project.created_at)}` : null,
    archived ? 'Archived: kept for history, restore it to use it again' : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={project.name}
        mark={<EntityMark name={project.name} size="lg" src={logoUrl('project', project.id, project.logo_version)} />}
        description={facts.join(' · ')}
        actions={
          <>
            {/* Only when this api stores logos (its bodies carry logo_version). */}
            {'logo_version' in project && (
              <Button variant="secondary" onClick={() => setLogo(true)}>
                Change logo
              </Button>
            )}
            <Button variant="secondary" onClick={() => void toggle()} disabled={status.isPending} aria-busy={status.isPending}>
              {status.isPending ? 'Working…' : archived ? 'Restore project' : 'Archive project'}
            </Button>
          </>
        }
      />
      {logo && <LogoDialog kind="project" id={project.id} name={project.name} logoVersion={project.logo_version} onClose={() => setLogo(false)} />}
      {status.isError && (
        <Banner tone="error" title={archived ? 'Not restored.' : 'Not archived.'} className="mb-4">
          {errorText(status.error)}
        </Banner>
      )}
    </>
  );
}

function Counts({ project, tab, setTab }: { project: Project; tab: string; setTab: (t: string) => void }) {
  // Same query keys as the panels, so these are shared, not extra calls.
  const envs = useEnvironmentsForProject(project.id);
  const bindings = useProjectSecrets(project.id);
  return (
    <Tabs
      label={`${project.name} sections`}
      idPrefix="project"
      value={tab}
      onChange={setTab}
      tabs={[
        { id: 'environments', label: 'Environments', count: envs.data?.length },
        { id: 'secrets', label: 'Secrets', count: bindings.data?.length },
      ]}
    />
  );
}

// --- environments ----------------------------------------------------

function EnvironmentsPanel({ project }: { project: Project }) {
  const { hasPermission } = useAuth();
  // Observation source needs gateway.bind (api#294).
  const canObserve = hasPermission('gateway.bind');
  const envs = useEnvironmentsForProject(project.id);
  const createEnv = useCreateEnvironment();
  const deleteEnv = useDeleteEnvironment();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Environment | null>(null);

  const rows = [...(envs.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const kindOf = (e: Environment) => e.kind ?? (e.type === 'prod' ? 'prod' : 'non_prod');
  const del = (e: Environment) => (
    <Button variant="danger" size="sm" onClick={() => setConfirmDelete(e)} aria-label={`Delete ${e.name}`}>
      Delete…
    </Button>
  );

  const columns: Column<Environment>[] = [
    { key: 'name', header: 'Environment', render: (e) => <EnvTag kind={kindOf(e)}>{e.name}</EnvTag> },
    { key: 'type', header: 'Type', render: (e) => TYPE_LABEL[e.type] ?? e.type },
    {
      key: 'kind',
      header: 'Kind',
      render: (e) => (kindOf(e) === 'prod' ? 'Production · no direct reveal' : <span className="text-muted">Non-production</span>),
    },
    { key: 'created', header: 'Created', render: (e) => <span className="whitespace-nowrap">{e.created_at ? formatExact(e.created_at) : '—'}</span> },
    ...(canObserve ? [{ key: 'observation', header: 'Observation', render: (e: Environment) => <ObservationSourceCell env={e} /> }] : []),
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', render: del },
  ];

  return (
    <section aria-labelledby="envs-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="envs-heading" className="text-block-heading text-ink">
            Environments
            {envs.data && <span className="ml-2 font-mono text-mono-small font-normal text-muted">{rows.length}</span>}
          </h2>
          <p className="mt-0.5 text-caption text-muted">Names are unique within a project. Role grants refer to environments by name.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Add environment
        </Button>
      </div>

      {envs.isLoading && <p className="text-muted">Loading environments…</p>}
      {envs.isError && (
        <Banner
          tone="error"
          title="Couldn't load the environments."
          action={
            <Button variant="secondary" size="sm" onClick={() => void envs.refetch()}>
              Try again
            </Button>
          }
        >
          {errorText(envs.error)}
        </Banner>
      )}
      {envs.data &&
        (rows.length === 0 ? (
          <EmptyState
            title={`${project.name} has no environments yet.`}
            action={
              <Button variant="secondary" onClick={() => setCreating(true)}>
                Add environment
              </Button>
            }
          >
            Add one for each stage, such as uat and prod.
          </EmptyState>
        ) : (
          <DataTable
            label={`Environments of ${project.name}`}
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            minWidth={620}
            stacked={(e) => (
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p>
                    <EnvTag kind={kindOf(e)}>{e.name}</EnvTag>
                  </p>
                  <p className="text-caption text-muted">
                    {e.type === 'prod' ? 'Production' : `${TYPE_LABEL[e.type] ?? e.type} · ${kindOf(e) === 'prod' ? 'production' : 'non-production'}`}
                    {e.created_at ? ` · ${formatExact(e.created_at)}` : ''}
                  </p>
                  {canObserve && (
                    <p className="text-caption text-muted">
                      Observation: <ObservationSourceCell env={e} />
                    </p>
                  )}
                </div>
                {del(e)}
              </div>
            )}
          />
        ))}

      {creating && (
        <EnvironmentDrawer
          project={project}
          submitting={createEnv.isPending}
          submitError={createEnv.error}
          onSubmit={async (body) => {
            const created = await createEnv.mutateAsync(body);
            setCreating(false);
            toast(`Added ${created?.name ?? body.name} to ${project.name}.`);
          }}
          onCancel={() => {
            createEnv.reset();
            setCreating(false);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body="Role grants that name this environment stop matching anything. Create an environment with the same name later and they match it again."
          confirmText="Delete environment"
          danger
          loading={deleteEnv.isPending}
          error={deleteEnv.error}
          onCancel={() => {
            deleteEnv.reset();
            setConfirmDelete(null);
          }}
          onConfirm={async () => {
            try {
              await deleteEnv.mutateAsync({ id: confirmDelete.id, projectId: project.id });
              toast(`Deleted ${confirmDelete.name}.`);
              setConfirmDelete(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </section>
  );
}

const envSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter an environment name.')
    .max(120, 'Use 120 characters or fewer.'),
  type: z.enum(['dev', 'staging', 'uat', 'prod', 'other']),
});

type EnvFormShape = z.infer<typeof envSchema>;

function EnvironmentDrawer({
  project,
  onSubmit,
  onCancel,
  submitting,
  submitError,
}: {
  project: Project;
  onSubmit: (body: { project_id: string; name: string; type: Environment['type'] }) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
  submitError: unknown;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EnvFormShape>({
    resolver: zodResolver(envSchema),
    defaultValues: { name: '', type: 'uat' },
  });

  const onValid: SubmitHandler<EnvFormShape> = async (data) => {
    try {
      await onSubmit({ project_id: project.id, name: data.name.trim(), type: data.type });
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Add environment"
      subtitle={`A new environment in ${project.name}.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="add-environment" variant="primary" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Adding…' : 'Add environment'}
          </Button>
        </>
      }
    >
      <form id="add-environment" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        <Field id="env-name" label="Name" hint="Unique within this project, usually lowercase: dev, uat, prod." error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="uat" className="font-mono" autoComplete="off" spellCheck={false} data-autofocus />}
        </Field>
        <Field
          id="env-type"
          label="Type"
          hint="Production makes it a production environment: direct reveal is always blocked there, and that can't be changed later."
          error={errors.type?.message}
        >
          {(p) => (
            <Select {...p} {...register('type')}>
              {(Object.keys(TYPE_LABEL) as Environment['type'][]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {submitError != null && (
          <Banner tone="error" title="Not added.">
            {errorText(submitError)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
