/**
 * Assignments admin page (`/admin/assignments`).
 *
 * The third leg of the pattern-2 RBAC tripod (the first two being
 * Roles + Projects). Each row binds a user to a role with an optional
 * narrowing scope.
 *
 * Layout:
 *   - Table of every assignment in the system (one row per (user,
 *     role, scope) triple). Filter input on top narrows to a single
 *     user_id substring match. Role chip + scope chips per row.
 *   - "+ New assignment" drawer with a role dropdown + project +
 *     environment + secret_ref_prefix + provider_type inputs.
 *   - Per-row Revoke confirm.
 *
 * Hard rules:
 *   - The user_id field is free-form text today (no users table —
 *     identities come from the future OIDC flow, api#26).
 *   - Empty scope fields are stripped on submit so the api treats
 *     them as wildcards (matching the policy_rules.selector pattern).
 *   - Project_id input is a UUID dropdown hydrated from
 *     useProjects(); environment is a name input (not a UUID — the
 *     api scope keys are by name to match how user_roles.scope
 *     references envs).
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import type { UserRole, UserRoleInput } from '../../api/types';
import {
  useGrantUserRole,
  useRevokeUserRole,
  useUserRoles,
} from '../../api/assignments';
import { useRoles } from '../../api/roles';
import { useEnvironments, useProjects } from '../../api/tenancy';

export function Assignments() {
  const list = useUserRoles();
  const roles = useRoles();
  const projects = useProjects();
  const revoke = useRevokeUserRole();

  const [filter, setFilter] = useState('');
  const [granting, setGranting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<UserRole | null>(null);

  const filtered = useMemo(() => {
    if (!list.data) return [];
    if (!filter.trim()) return list.data;
    const f = filter.toLowerCase();
    return list.data.filter((r) => r.user_id.toLowerCase().includes(f));
  }, [list.data, filter]);

  const roleName = (id: string) =>
    roles.data?.find((r) => r.id === id)?.name ?? id.slice(0, 8) + '…';

  const projectName = (id: string) =>
    projects.data?.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text text-xl font-semibold">Assignments</h1>
          <p className="text-muted text-sm mt-1">
            User × role × scope bindings. Scope keys narrow the assignment to a single project / environment / ref prefix / provider type. Empty scope = global.
          </p>
        </div>
        <button
          onClick={() => setGranting(true)}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90"
        >
          + Grant role
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by user_id…"
          className="flex-1 bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="text-xs text-muted hover:text-text border border-border px-3 rounded"
          >
            Clear
          </button>
        )}
      </div>

      {list.isError && (
        <div className="bg-surface border border-red-500/40 rounded p-4 text-sm">
          <div className="text-red-400 font-medium">Failed to load assignments</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </div>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
          No assignments yet. Grant a role to start scoping access.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">User</th>
                <th className="px-4 py-3 font-normal">Role</th>
                <th className="px-4 py-3 font-normal">Scope</th>
                <th className="px-4 py-3 font-normal">Granted</th>
                <th className="px-4 py-3 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/50 last:border-0 hover:bg-bg/30 align-top"
                >
                  <td className="px-4 py-3 text-text font-mono text-xs">{r.user_id}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] bg-accent/20 text-accent border border-accent/60 rounded px-2 py-0.5">
                      {roleName(r.role_id)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {!r.scope || Object.keys(r.scope).length === 0 ? (
                      <span className="text-muted text-xs italic">global</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(r.scope).map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[11px] bg-bg border border-border text-muted rounded px-2 py-0.5"
                          >
                            <span className="text-text">{k}</span>
                            <span className="opacity-50 mx-1">=</span>
                            <span>{k === 'project_id' ? projectName(v) : v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">
                    {r.granted_at.slice(0, 10)}
                    {r.granted_by && <div>by {r.granted_by}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setConfirmRevoke(r)}
                      className="text-xs text-red-400 hover:text-red-300 border border-border px-2 py-1 rounded"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {granting && (
        <Drawer title="Grant role" onClose={() => setGranting(false)}>
          <AssignmentForm onDone={() => setGranting(false)} onCancel={() => setGranting(false)} />
        </Drawer>
      )}

      {confirmRevoke && (
        <ConfirmModal
          title={`Revoke ${roleName(confirmRevoke.role_id)} from ${confirmRevoke.user_id}?`}
          body="This assignment will be removed. Any in-flight requests already gated on this scope continue uninterrupted; new requests fall back to whatever other assignments the user has."
          confirmText="Revoke"
          danger
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            await revoke.mutateAsync(confirmRevoke.id);
            setConfirmRevoke(null);
          }}
          loading={revoke.isPending}
          error={revoke.error}
        />
      )}
    </div>
  );
}

// --- form -----------------------------------------------------------

const schema = z.object({
  user_id: z.string().min(1, 'user_id is required').max(255),
  role_id: z.string().uuid('pick a role'),
  // Scope inputs (all optional; empty stripped on submit)
  sc_project_id: z.string().uuid().optional().or(z.literal('')),
  sc_environment: z.string().max(120).optional(),
  sc_secret_ref_prefix: z.string().max(255).optional(),
  sc_provider_type: z.string().max(60).optional(),
});

type FormShape = z.infer<typeof schema>;

function AssignmentForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const grant = useGrantUserRole();
  const roles = useRoles();
  const projects = useProjects();
  const envs = useEnvironments();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      user_id: '',
      role_id: '',
      sc_project_id: '',
      sc_environment: '',
      sc_secret_ref_prefix: '',
      sc_provider_type: '',
    },
  });

  // Distinct environment names for the dropdown (the api scope key is
  // by name, not UUID; multiple projects can each have a "uat" env).
  const envNames = useMemo(() => {
    const set = new Set<string>();
    envs.data?.forEach((e) => set.add(e.name));
    return Array.from(set).sort();
  }, [envs.data]);

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const scope: Record<string, string> = {};
    if (data.sc_project_id) scope.project_id = data.sc_project_id;
    if (data.sc_environment) scope.environment = data.sc_environment;
    if (data.sc_secret_ref_prefix) scope.secret_ref_prefix = data.sc_secret_ref_prefix;
    if (data.sc_provider_type) scope.provider_type = data.sc_provider_type;

    const body: UserRoleInput = {
      user_id: data.user_id,
      role_id: data.role_id,
      scope: Object.keys(scope).length > 0 ? scope : undefined,
    };
    await grant.mutateAsync(body);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <Field
        label="User ID"
        error={errors.user_id?.message}
        hint="Free-form for now (no users table — identities come from the future OIDC flow). Use the same identifier your IdP issues as sub claim."
      >
        <input
          type="text"
          {...register('user_id')}
          className={inputCls}
          placeholder="alice"
        />
      </Field>

      <Field label="Role" error={errors.role_id?.message}>
        <select {...register('role_id')} className={inputCls}>
          <option value="">— pick a role —</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.is_system ? ' (system)' : ''}
            </option>
          ))}
        </select>
        {roles.isError && (
          <div className="text-xs text-red-400">failed to load roles</div>
        )}
      </Field>

      <fieldset className="border border-border rounded p-3 space-y-3">
        <legend className="text-xs text-muted px-1">
          Scope — narrow the assignment. All optional; empty = global.
        </legend>

        <Field label="Project" error={errors.sc_project_id?.message}>
          <select {...register('sc_project_id')} className={inputCls}>
            <option value="">(any project)</option>
            {projects.data
              ?.filter((p) => p.status === 'active')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Environment" hint="By NAME (not UUID) since multiple projects can each have `uat`.">
          <input
            list="env-options"
            {...register('sc_environment')}
            className={inputCls}
            placeholder="uat"
          />
          <datalist id="env-options">
            {envNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>

        <Field label="Secret ref prefix" hint="Prefix match (e.g. `billing/`).">
          <input
            type="text"
            {...register('sc_secret_ref_prefix')}
            className={inputCls}
            placeholder="billing/"
          />
        </Field>

        <Field label="Provider type" hint="exact: vault | aws-sm | gcp-sm | azure-kv">
          <input type="text" {...register('sc_provider_type')} className={inputCls} placeholder="vault" />
        </Field>
      </fieldset>

      {grant.error instanceof ApiError && (
        <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
          {grant.error.status}: {grant.error.message}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={grant.isPending}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
        >
          {grant.isPending ? 'Saving…' : 'Grant'}
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
      <div className="relative w-[520px] max-w-full bg-surface border-l border-border h-full overflow-auto">
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
