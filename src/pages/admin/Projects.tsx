/**
 * Projects admin page.
 *
 * Master-detail layout: projects list on the left, the selected
 * project's environments on the right. Mirrors the natural
 * parent-child relationship better than two stacked sections.
 *
 * Polished in ui#16 to match the design pattern from ui#13/14/15:
 * PageHeader, Card-wrapped panels, shared `src/ui/` primitives,
 * StatusPill for env types + archived flag, font-mono cyan for project
 * + environment identifiers.
 *
 * Projects use SOFT-DELETE: the status toggle flips between `active`
 * and `archived` (no hard-delete endpoint). Archived projects stay
 * in the list but dimmed; they remain referenced by historical
 * requests, role assignments, and gitops mappings.
 *
 * Environments hard-delete (cheap to recreate; `user_roles.scope`
 * jsonb references envs by name, not FK).
 *
 * Pattern-2 wiring (the reason this page exists): every env created
 * here becomes an available value in the Integrations form's
 * environment dropdown + the Assignments form's scope picker.
 */

import { useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import type {
  Environment,
  EnvironmentInput,
  Project,
  ProjectInput,
} from '../../api/types';
import {
  useCreateEnvironment,
  useCreateProject,
  useDeleteEnvironment,
  useEnvironmentsForProject,
  useProjects,
  useUpdateProjectStatus,
} from '../../api/tenancy';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';

import { ProjectSecretsPanel } from './ProjectSecretsPanel';

export function Projects() {
  const list = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Auto-select the first active project once the list loads.
  useEffect(() => {
    if (!selectedId && list.data && list.data.length > 0) {
      const firstActive = list.data.find((p) => p.status === 'active');
      setSelectedId((firstActive ?? list.data[0]).id);
    }
  }, [list.data, selectedId]);

  const selected = list.data?.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Top-level tenancy boundaries. Projects archive instead of delete (historical references stay valid). Each project carries N environments."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New project
          </Button>
        }
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load projects</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No projects yet. Create one to start scoping requests,
          assignments, and integrations.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <ProjectsList
            projects={list.data}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected ? (
            <ProjectDetailTabs project={selected} />
          ) : (
            <Card className="p-10 text-center text-muted text-sm">
              Pick a project to manage its environments and bindings.
            </Card>
          )}
        </div>
      )}

      {creating && (
        <Drawer title="New project" onClose={() => setCreating(false)}>
          <ProjectForm
            onCreated={(newId) => {
              setCreating(false);
              setSelectedId(newId);
            }}
            onCancel={() => setCreating(false)}
          />
        </Drawer>
      )}
    </div>
  );
}

// --- left rail: project list ----------------------------------------

function ProjectsList({
  projects,
  selectedId,
  onSelect,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-border/60 text-[11px] uppercase tracking-wider text-muted">
        {projects.length} project{projects.length === 1 ? '' : 's'}
      </div>
      <ul className="max-h-[640px] overflow-auto">
        {projects.map((p) => {
          const on = p.id === selectedId;
          const archived = p.status === 'archived';
          return (
            <li key={p.id}>
              <button
                onClick={() => onSelect(p.id)}
                className={
                  'w-full text-left px-5 py-3 border-b border-border/40 last:border-0 transition-colors ' +
                  (on
                    ? 'bg-accent/10 border-l-2 border-l-accent'
                    : 'hover:bg-bg/30')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={
                      'font-mono text-sm ' +
                      (archived
                        ? 'text-muted line-through'
                        : on
                          ? 'text-accent-bright'
                          : 'text-text')
                    }
                  >
                    {p.name}
                  </span>
                  {archived && (
                    <StatusPill variant="warning" tone="outline">
                      archived
                    </StatusPill>
                  )}
                </div>
                {p.owner_team_id && (
                  <div className="text-xs text-muted mt-1">
                    {p.owner_team_id}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- right pane: tabbed detail (Environments + Secrets) --------------

type DetailTab = 'environments' | 'secrets';

function ProjectDetailTabs({ project }: { project: Project }) {
  const [tab, setTab] = useState<DetailTab>('environments');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 border-b border-border/60">
        <TabButton active={tab === 'environments'} onClick={() => setTab('environments')}>
          Environments
        </TabButton>
        <TabButton active={tab === 'secrets'} onClick={() => setTab('secrets')}>
          Secrets
        </TabButton>
      </div>
      {tab === 'environments' && <EnvironmentsPanel project={project} />}
      {tab === 'secrets' && <ProjectSecretsPanel project={project} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
        (active
          ? 'text-accent border-accent'
          : 'text-muted border-transparent hover:text-text')
      }
    >
      {children}
    </button>
  );
}

// --- right pane: environments + status toggle -----------------------

function EnvironmentsPanel({ project }: { project: Project }) {
  const envs = useEnvironmentsForProject(project.id);
  const status = useUpdateProjectStatus(project.id);
  const createEnv = useCreateEnvironment();
  const deleteEnv = useDeleteEnvironment();

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Environment | null>(null);

  const toggleStatus = async () => {
    const next = project.status === 'active' ? 'archived' : 'active';
    await status.mutateAsync(next).catch(() => {});
  };

  return (
    <div className="space-y-4">
      {/* Project header */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-accent text-lg">
                {project.name}
              </span>
              {project.status === 'archived' && (
                <StatusPill variant="warning" tone="outline">
                  archived
                </StatusPill>
              )}
            </div>
            <div className="text-muted text-xs mt-1">
              {project.owner_team_id ? `owner: ${project.owner_team_id} · ` : ''}
              created {project.created_at?.slice(0, 10) ?? '—'}
            </div>
          </div>
          <Button
            variant={project.status === 'active' ? 'secondary' : 'primary'}
            size="sm"
            onClick={toggleStatus}
            disabled={status.isPending}
          >
            {status.isPending
              ? 'Working…'
              : project.status === 'active'
                ? 'Archive project'
                : 'Restore project'}
          </Button>
        </div>
        {status.error instanceof ApiError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 mt-3">
            {status.error.status}: {status.error.message}
          </div>
        )}
      </Card>

      {/* Environments table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
          <div>
            <div className="text-text font-medium">Environments</div>
            <div className="text-muted text-xs mt-0.5">
              {envs.data?.length ?? 0} configured · names unique within this
              project
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            + New env
          </Button>
        </div>

        {envs.isLoading && (
          <div className="px-5 py-8 text-muted text-sm">Loading…</div>
        )}

        {envs.data && envs.data.length === 0 && (
          <div className="px-5 py-8 text-muted text-sm">
            No environments yet. Add at least one (typically{' '}
            <code className="font-mono">uat</code> +{' '}
            <code className="font-mono">prod</code>).
          </div>
        )}

        {envs.data && envs.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Created</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {envs.data.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top"
                >
                  <Td>
                    <span className="font-mono text-accent text-sm">
                      {e.name}
                    </span>
                  </Td>
                  <Td>
                    <EnvTypePill type={e.type} />
                  </Td>
                  <Td className="text-muted text-xs">
                    {e.created_at?.slice(0, 10) ?? '—'}
                  </Td>
                  <Td className="text-right">
                    <button
                      onClick={() => setConfirmDelete(e)}
                      className="text-red-300 hover:text-red-200 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <Drawer
          title={`New environment in ${project.name}`}
          onClose={() => setCreating(false)}
        >
          <EnvironmentForm
            projectId={project.id}
            onSubmit={async (body) => {
              await createEnv.mutateAsync(body);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            submitting={createEnv.isPending}
            submitError={createEnv.error}
          />
        </Drawer>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete environment "${confirmDelete.name}"?`}
          body="Stale assignments referencing this environment by name will no longer match. Recreating an env with the same name restores the binding."
          confirmText="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await deleteEnv.mutateAsync({
              id: confirmDelete.id,
              projectId: project.id,
            });
            setConfirmDelete(null);
          }}
          loading={deleteEnv.isPending}
          error={deleteEnv.error}
        />
      )}
    </div>
  );
}

function EnvTypePill({ type }: { type: Environment['type'] }) {
  const variant: React.ComponentProps<typeof StatusPill>['variant'] =
    type === 'prod'
      ? 'error'
      : type === 'uat'
        ? 'warning'
        : type === 'staging'
          ? 'accent'
          : type === 'dev'
            ? 'success'
            : 'neutral';
  return (
    <StatusPill variant={variant} tone="outline" className="uppercase">
      {type}
    </StatusPill>
  );
}

// --- forms ----------------------------------------------------------

const projectSchema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  owner_team_id: z.string().max(120).optional(),
});

function ProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (newId: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateProject();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: '', owner_team_id: '' },
  });

  const onValid: SubmitHandler<ProjectInput> = async (data) => {
    const body: ProjectInput = {
      name: data.name,
      owner_team_id: data.owner_team_id || undefined,
    };
    const result = await create.mutateAsync(body);
    onCreated(result.id);
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <Field label="Name" error={errors.name?.message}>
        <input
          type="text"
          {...register('name')}
          className={inputCls}
          placeholder="archive"
        />
      </Field>

      <Field
        label="Owner team"
        error={errors.owner_team_id?.message}
        hint="Optional free-text label; surfaced in the project list for context."
      >
        <input
          type="text"
          {...register('owner_team_id')}
          className={inputCls}
          placeholder="team-archive"
        />
      </Field>

      {create.error instanceof ApiError && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
          {create.error.status}: {create.error.message}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border/60">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={create.isPending}
        >
          {create.isPending ? 'Saving…' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}

const envSchema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  type: z.enum(['dev', 'staging', 'uat', 'prod', 'other']),
});

type EnvFormShape = z.infer<typeof envSchema>;

function EnvironmentForm({
  projectId,
  onSubmit,
  onCancel,
  submitting,
  submitError,
}: {
  projectId: string;
  onSubmit: (body: EnvironmentInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
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
    await onSubmit({
      project_id: projectId,
      name: data.name,
      type: data.type,
    });
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <Field
        label="Name"
        error={errors.name?.message}
        hint="Unique within this project. Conventionally lowercase: uat, prod, dev."
      >
        <input
          type="text"
          {...register('name')}
          className={inputCls}
          placeholder="uat"
        />
      </Field>

      <Field label="Type" error={errors.type?.message}>
        <select {...register('type')} className={inputCls}>
          <option value="dev">dev</option>
          <option value="staging">staging</option>
          <option value="uat">uat</option>
          <option value="prod">prod</option>
          <option value="other">other</option>
        </select>
      </Field>

      {submitError instanceof ApiError && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
          {submitError.status}: {submitError.message}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border/60">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={submitting}
        >
          {submitting ? 'Saving…' : 'Create environment'}
        </Button>
      </div>
    </form>
  );
}

// --- shared bits ----------------------------------------------------

const inputCls =
  'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && !error && (
        <div className="text-[11px] text-muted/80">{hint}</div>
      )}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-5 py-3.5 align-top ${className}`}>{children}</td>;
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
