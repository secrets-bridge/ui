/**
 * Projects admin page.
 *
 * Master-detail layout: projects list on the left, the selected
 * project's environments on the right. Mirrors the natural
 * parent-child relationship better than two stacked sections.
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
 * environment dropdown + the future Assignments form's scope picker.
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text text-xl font-semibold">Projects</h1>
          <p className="text-muted text-sm mt-1">
            Top-level tenancy boundaries. Projects archive instead of delete (historical references stay valid). Each project carries N environments.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90"
        >
          + New project
        </button>
      </div>

      {list.isError && (
        <div className="bg-surface border border-red-500/40 rounded p-4 text-sm">
          <div className="text-red-400 font-medium">Failed to load projects</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </div>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
          No projects yet. Create one to start scoping requests, assignments, and integrations.
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <ProjectsList
            projects={list.data}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected ? (
            <EnvironmentsPanel project={selected} />
          ) : (
            <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
              Pick a project to manage its environments.
            </div>
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
    <div className="bg-surface border border-border rounded overflow-hidden">
      <div className="px-4 py-2 border-b border-border text-xs uppercase text-muted">
        {projects.length} project{projects.length === 1 ? '' : 's'}
      </div>
      <ul className="max-h-[600px] overflow-auto">
        {projects.map((p) => {
          const on = p.id === selectedId;
          const archived = p.status === 'archived';
          return (
            <li key={p.id}>
              <button
                onClick={() => onSelect(p.id)}
                className={
                  'w-full text-left px-4 py-3 border-b border-border/40 last:border-0 ' +
                  (on ? 'bg-bg/40' : 'hover:bg-bg/20')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={archived ? 'text-muted line-through' : 'text-text'}>
                    {p.name}
                  </span>
                  {archived && (
                    <span className="text-[10px] bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 rounded px-1.5 py-0.5">
                      archived
                    </span>
                  )}
                </div>
                {p.owner_team_id && (
                  <div className="text-xs text-muted mt-0.5">{p.owner_team_id}</div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
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
    <div className="space-y-3">
      {/* Project header */}
      <div className="bg-surface border border-border rounded p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-text text-lg font-semibold">{project.name}</div>
            <div className="text-muted text-xs mt-1">
              {project.owner_team_id ? `owner: ${project.owner_team_id} · ` : ''}
              created {project.created_at?.slice(0, 10) ?? '—'}
            </div>
          </div>
          <button
            onClick={toggleStatus}
            disabled={status.isPending}
            className={
              project.status === 'active'
                ? 'text-xs text-yellow-300 border border-yellow-400/40 hover:bg-yellow-400/10 px-3 py-1.5 rounded'
                : 'text-xs text-green-300 border border-green-400/40 hover:bg-green-400/10 px-3 py-1.5 rounded'
            }
          >
            {status.isPending
              ? 'Working…'
              : project.status === 'active'
                ? 'Archive project'
                : 'Restore project'}
          </button>
        </div>
        {status.error instanceof ApiError && (
          <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2 mt-3">
            {status.error.status}: {status.error.message}
          </div>
        )}
      </div>

      {/* Environments table */}
      <div className="bg-surface border border-border rounded">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-text font-medium">Environments</div>
            <div className="text-muted text-xs">
              {envs.data?.length ?? 0} configured · names unique within this project
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="text-xs bg-accent text-bg font-medium px-3 py-1.5 rounded hover:opacity-90"
          >
            + New env
          </button>
        </div>

        {envs.isLoading && <div className="px-4 py-6 text-muted text-sm">Loading…</div>}

        {envs.data && envs.data.length === 0 && (
          <div className="px-4 py-6 text-muted text-sm">
            No environments yet. Add at least one (typically <code>uat</code> + <code>prod</code>).
          </div>
        )}

        {envs.data && envs.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Type</th>
                <th className="px-4 py-2 font-normal">Created</th>
                <th className="px-4 py-2 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {envs.data.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border/40 last:border-0 hover:bg-bg/30"
                >
                  <td className="px-4 py-2 text-text">{e.name}</td>
                  <td className="px-4 py-2">
                    <TypePill type={e.type} />
                  </td>
                  <td className="px-4 py-2 text-muted text-xs">
                    {e.created_at?.slice(0, 10) ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setConfirmDelete(e)}
                      className="text-xs text-red-400 hover:text-red-300 border border-border px-2 py-1 rounded"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <Drawer title={`New environment in ${project.name}`} onClose={() => setCreating(false)}>
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
            await deleteEnv.mutateAsync({ id: confirmDelete.id, projectId: project.id });
            setConfirmDelete(null);
          }}
          loading={deleteEnv.isPending}
          error={deleteEnv.error}
        />
      )}
    </div>
  );
}

function TypePill({ type }: { type: Environment['type'] }) {
  const cls =
    type === 'prod'
      ? 'bg-red-400/15 text-red-300 border-red-400/40'
      : type === 'uat'
        ? 'bg-yellow-400/15 text-yellow-300 border-yellow-400/40'
        : type === 'staging'
          ? 'bg-blue-400/15 text-blue-300 border-blue-400/40'
          : type === 'dev'
            ? 'bg-green-400/15 text-green-300 border-green-400/40'
            : 'bg-bg text-muted border-border';
  return (
    <span className={'text-[11px] uppercase border rounded px-2 py-0.5 ' + cls}>
      {type}
    </span>
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
        <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
          {create.error.status}: {create.error.message}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={create.isPending}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Create project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-text px-3 py-2 rounded border border-border"
        >
          Cancel
        </button>
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
    await onSubmit({ project_id: projectId, name: data.name, type: data.type });
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <Field
        label="Name"
        error={errors.name?.message}
        hint="Unique within this project. Conventionally lowercase: uat, prod, dev."
      >
        <input type="text" {...register('name')} className={inputCls} placeholder="uat" />
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
        <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
          {submitError.status}: {submitError.message}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Create environment'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-text px-3 py-2 rounded border border-border"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// --- shared bits ----------------------------------------------------

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close drawer" />
      <div className="relative w-[480px] max-w-full bg-surface border-l border-border h-full overflow-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-text font-semibold">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ×
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmText,
  danger,
  onCancel,
  onConfirm,
  loading,
  error,
}: {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<unknown>;
  loading: boolean;
  error?: unknown;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button className="absolute inset-0 bg-black/60" onClick={onCancel} aria-label="Close" />
      <div className="relative bg-surface border border-border rounded-lg w-[420px] p-5 space-y-3">
        <div className="text-text font-semibold">{title}</div>
        <div className="text-muted text-sm">{body}</div>
        {error instanceof ApiError && (
          <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
            {error.status}: {error.message}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => void onConfirm()}
            disabled={loading}
            className={`${
              danger ? 'bg-red-500 text-white' : 'bg-accent text-bg'
            } font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50`}
          >
            {loading ? 'Working…' : confirmText}
          </button>
          <button
            onClick={onCancel}
            className="text-muted hover:text-text px-3 py-2 rounded border border-border"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent';

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
      <label className="block text-xs text-muted">{label}</label>
      {children}
      {hint && !error && <div className="text-[11px] text-muted/80">{hint}</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
