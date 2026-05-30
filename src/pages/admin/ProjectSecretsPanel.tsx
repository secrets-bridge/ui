/**
 * Project Secrets panel (ui#26 Slice G).
 *
 * Lists every secret bound to the project + per-binding allowed_keys
 * + allowed_ops. Lets an admin bind a discovered catalog row, update
 * its allowlist / ops, or unbind it.
 *
 * Backed by the api endpoints from api#43 Slice A:
 *
 *   GET    /api/v1/projects/:id/secrets             list
 *   POST   /api/v1/projects/:id/secrets             bind
 *   PUT    /api/v1/projects/:id/secrets/:secret_id  update
 *   DELETE /api/v1/projects/:id/secrets/:secret_id  unbind
 *
 * Conventions match the rest of the admin pages:
 *   - card-wrapped sections, font-mono cyan for identifiers
 *   - Drawer for create / edit forms
 *   - ConfirmModal for unbind
 *   - inline red banner on API errors (never alert())
 *   - allowed_keys: empty array UI is forbidden; null means "all keys"
 *     and is rendered as a single "all keys" StatusPill
 */

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  useBindProjectSecret,
  useProjectSecrets,
  useUnbindProjectSecret,
  useUpdateProjectSecret,
} from '../../api/tenancy';
import { useSecrets, type Secret } from '../../api/secrets';
import type {
  Project,
  ProjectSecretBinding,
  ProjectSecretBindingInput,
  ProjectSecretBindingUpdate,
} from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Drawer } from '../../ui/Drawer';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { StatusPill } from '../../ui/StatusPill';

const OP_OPTIONS: readonly string[] = ['read', 'patch', 'discover'];

export function ProjectSecretsPanel({ project }: { project: Project }) {
  const bindings = useProjectSecrets(project.id);
  const unbind = useUnbindProjectSecret(project.id);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectSecretBinding | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState<ProjectSecretBinding | null>(null);

  if (bindings.isLoading) {
    return <Card className="p-10 text-center text-muted text-sm">Loading bindings…</Card>;
  }
  if (bindings.error) {
    return (
      <Card className="border-red-500/40 p-5 text-sm">
        <span className="text-red-300">Failed to load bindings:</span>{' '}
        <span className="text-muted">{(bindings.error as Error).message}</span>
      </Card>
    );
  }

  const rows = bindings.data ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-text font-semibold">Bound secrets</h3>
            <p className="text-muted text-xs mt-1">
              Which discovered catalog rows members of{' '}
              <span className="font-mono text-accent">{project.name}</span> can
              request, plus the per-binding key allowlist + allowed ops.
              Submit-time gate (api#43 Slice C) refuses anything outside the
              binding.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            Bind a secret
          </Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-muted text-sm">
          No bindings yet. Members of this project see no secrets and any
          submit returns <span className="font-mono">out_of_scope_project</span>.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg/40 text-left text-muted text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-2 font-medium">Secret ref</th>
                <th className="px-5 py-2 font-medium">Cluster</th>
                <th className="px-5 py-2 font-medium">Allowed keys</th>
                <th className="px-5 py-2 font-medium">Ops</th>
                <th className="px-5 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <BindingRow
                  key={`${b.project_id}:${b.secret_id}`}
                  binding={b}
                  onEdit={() => setEditing(b)}
                  onUnbind={() => setConfirmUnbind(b)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {adding && (
        <Drawer title="Bind a secret" onClose={() => setAdding(false)}>
          <BindForm
            project={project}
            existingSecretIds={new Set(rows.map((b) => b.secret_id))}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </Drawer>
      )}

      {editing && (
        <Drawer
          title={`Edit binding · ${editing.secret?.secret_ref ?? editing.secret_id}`}
          onClose={() => setEditing(null)}
        >
          <EditForm
            project={project}
            binding={editing}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Drawer>
      )}

      {confirmUnbind && (
        <ConfirmModal
          title="Unbind this secret?"
          body={`Members of ${project.name} will no longer see ${
            confirmUnbind.secret?.secret_ref ?? confirmUnbind.secret_id
          } in their catalog. Existing requests against it stay in the audit log.`}
          confirmText="Unbind"
          danger
          loading={unbind.isPending}
          error={unbind.error}
          onConfirm={async () => {
            await unbind.mutateAsync({ secretId: confirmUnbind.secret_id });
            setConfirmUnbind(null);
          }}
          onCancel={() => setConfirmUnbind(null)}
        />
      )}
    </div>
  );
}

// --- one row in the bindings table ----------------------------------

function BindingRow({
  binding,
  onEdit,
  onUnbind,
}: {
  binding: ProjectSecretBinding;
  onEdit: () => void;
  onUnbind: () => void;
}) {
  const allKeys = binding.allowed_keys === null;
  return (
    <tr className="border-t border-border/40">
      <td className="px-5 py-3 align-top">
        <span className="font-mono text-accent text-sm">
          {binding.secret?.secret_ref ?? binding.secret_id}
        </span>
        {binding.secret?.provider_type && (
          <span className="ml-2 text-muted text-xs">
            {binding.secret.provider_type}
          </span>
        )}
      </td>
      <td className="px-5 py-3 align-top text-muted text-xs">
        {binding.secret?.cluster_name ?? '—'}
      </td>
      <td className="px-5 py-3 align-top">
        {allKeys ? (
          <StatusPill variant="accent" tone="outline">
            all keys
          </StatusPill>
        ) : (
          <div className="flex flex-wrap gap-1">
            {binding.allowed_keys!.map((k) => (
              <StatusPill key={k} variant="neutral" tone="filled">
                {k}
              </StatusPill>
            ))}
          </div>
        )}
      </td>
      <td className="px-5 py-3 align-top">
        <div className="flex flex-wrap gap-1">
          {binding.allowed_ops.map((op) => (
            <StatusPill key={op} variant="accent" tone="filled">
              {op}
            </StatusPill>
          ))}
        </div>
      </td>
      <td className="px-5 py-3 align-top text-right">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <button
            type="button"
            onClick={onUnbind}
            className="text-red-300 hover:text-red-200 text-sm font-medium"
          >
            Unbind
          </button>
        </div>
      </td>
    </tr>
  );
}

// --- bind form (new binding) ----------------------------------------

const bindSchema = z
  .object({
    secret_id: z.string().uuid('pick a secret from the list'),
    allow_all_keys: z.boolean(),
    allowed_keys_csv: z.string(),
    allowed_ops: z.array(z.enum(['read', 'patch', 'discover'])).min(1, 'at least one op'),
  })
  .refine(
    (v) =>
      v.allow_all_keys ||
      v.allowed_keys_csv
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean).length > 0,
    { message: 'either allow all keys or list at least one', path: ['allowed_keys_csv'] },
  );

type BindFormValues = z.infer<typeof bindSchema>;

function BindForm({
  project,
  existingSecretIds,
  onDone,
  onCancel,
}: {
  project: Project;
  existingSecretIds: Set<string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const catalog = useSecrets({ limit: 500 });
  const bind = useBindProjectSecret(project.id);

  const candidates = useMemo<Secret[]>(() => {
    const items = catalog.data?.items ?? [];
    return items.filter((s) => !existingSecretIds.has(s.id));
  }, [catalog.data, existingSecretIds]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<BindFormValues>({
    resolver: zodResolver(bindSchema),
    defaultValues: {
      secret_id: '',
      allow_all_keys: true,
      allowed_keys_csv: '',
      allowed_ops: ['read'],
    },
  });

  const allowAll = watch('allow_all_keys');

  const onSubmit = async (v: BindFormValues) => {
    const body: ProjectSecretBindingInput = {
      secret_id: v.secret_id,
      allowed_ops: v.allowed_ops,
      allowed_keys: v.allow_all_keys
        ? null
        : v.allowed_keys_csv
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
    };
    try {
      await bind.mutateAsync(body);
      onDone();
    } catch (e) {
      setError('root', { message: (e as Error).message });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field label="Secret" error={errors.secret_id?.message}>
        <select
          {...register('secret_id')}
          className="w-full bg-bg/40 border border-border/60 rounded px-3 py-2 text-sm font-mono"
        >
          <option value="">— choose a discovered secret —</option>
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.secret_ref} · {s.cluster_name} · {s.provider_type}
            </option>
          ))}
        </select>
        {catalog.data && candidates.length === 0 && (
          <p className="text-xs text-muted mt-1">
            Every discovered secret is already bound to this project.
          </p>
        )}
      </Field>

      <KeyPolicyFields
        registerAllowAll={register('allow_all_keys')}
        registerKeysCsv={register('allowed_keys_csv')}
        keysError={errors.allowed_keys_csv?.message}
        allowAll={allowAll}
      />

      <OpsField
        register={register('allowed_ops')}
        error={errors.allowed_ops?.message as string | undefined}
      />

      {errors.root?.message && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {errors.root.message}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Binding…' : 'Bind'}
        </Button>
      </div>
    </form>
  );
}

// --- edit form (existing binding) -----------------------------------

const editSchema = z.object({
  allow_all_keys: z.boolean(),
  allowed_keys_csv: z.string(),
  allowed_ops: z.array(z.enum(['read', 'patch', 'discover'])).min(1, 'at least one op'),
});

type EditFormValues = z.infer<typeof editSchema>;

function EditForm({
  project,
  binding,
  onDone,
  onCancel,
}: {
  project: Project;
  binding: ProjectSecretBinding;
  onDone: () => void;
  onCancel: () => void;
}) {
  const update = useUpdateProjectSecret(project.id);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      allow_all_keys: binding.allowed_keys === null,
      allowed_keys_csv: (binding.allowed_keys ?? []).join(', '),
      allowed_ops: binding.allowed_ops as EditFormValues['allowed_ops'],
    },
  });

  const allowAll = watch('allow_all_keys');

  const onSubmit = async (v: EditFormValues) => {
    const body: ProjectSecretBindingUpdate = {
      allowed_ops: v.allowed_ops,
      allowed_keys: v.allow_all_keys
        ? null
        : v.allowed_keys_csv
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
    };
    try {
      await update.mutateAsync({ secretId: binding.secret_id, body });
      onDone();
    } catch (e) {
      setError('root', { message: (e as Error).message });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <KeyPolicyFields
        registerAllowAll={register('allow_all_keys')}
        registerKeysCsv={register('allowed_keys_csv')}
        keysError={errors.allowed_keys_csv?.message}
        allowAll={allowAll}
      />

      <OpsField
        register={register('allowed_ops')}
        error={errors.allowed_ops?.message as string | undefined}
      />

      {errors.root?.message && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {errors.root.message}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

// --- shared form fields ---------------------------------------------

type Reg = ReturnType<ReturnType<typeof useForm>['register']>;

function KeyPolicyFields({
  registerAllowAll,
  registerKeysCsv,
  keysError,
  allowAll,
}: {
  registerAllowAll: Reg;
  registerKeysCsv: Reg;
  keysError?: string;
  allowAll: boolean;
}) {
  return (
    <Field
      label="Allowed keys"
      hint="Tick to allow every key the secret exposes. Otherwise list the allowed keys, comma-separated."
    >
      <label className="flex items-center gap-2 text-sm text-text mb-2">
        <input type="checkbox" {...registerAllowAll} className="rounded" />
        Allow all keys
      </label>
      {!allowAll && (
        <input
          type="text"
          {...registerKeysCsv}
          placeholder="DB_HOST, DB_PORT, REDIS_PASSWORD"
          className="w-full bg-bg/40 border border-border/60 rounded px-3 py-2 text-sm font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {keysError && (
        <p className="text-xs text-red-300 mt-1">{keysError}</p>
      )}
    </Field>
  );
}

function OpsField({
  register,
  error,
}: {
  register: Reg;
  error?: string;
}) {
  return (
    <Field
      label="Allowed operations"
      hint="Which request types members of this project can submit against the bound secret."
      error={error}
    >
      <div className="flex flex-wrap gap-3">
        {OP_OPTIONS.map((op) => (
          <label key={op} className="flex items-center gap-2 text-sm">
            <input type="checkbox" value={op} {...register} className="rounded" />
            <span className="text-text font-mono">{op}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {hint && <p className="text-xs text-muted mb-1">{hint}</p>}
      {children}
      {error && <p className="text-xs text-red-300 mt-1">{error}</p>}
    </div>
  );
}
