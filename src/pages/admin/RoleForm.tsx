/**
 * Create / edit form for a Role.
 *
 * CRITICAL api constraint: name + description are IMMUTABLE after
 * create. The only mutation endpoint is `PUT /roles/:id/permissions`.
 * In edit mode (when `initial` is provided) the name + description
 * inputs are marked readOnly + visually dimmed so an operator can SEE
 * the current values without thinking they're editable.
 *
 * Permissions UX (interim — until the api ships a canonical catalog
 * endpoint per the design discussion):
 *   - We discover the "known" permission set client-side from the
 *     union of all permissions across existing roles.
 *   - Known permissions render as togglable chips grouped by their
 *     `<resource>.*` prefix.
 *   - A free-form add-input lives below the catalog so operators can
 *     still type a permission the platform doesn't ship yet — with a
 *     warning that the api doesn't enforce strings outside the catalog.
 *
 * When the api ships `GET /api/v1/permissions` (slice 1 of the
 * permission catalog work), swap `useRoles()` for the catalog hook —
 * the rest of this file stays put.
 *
 * On submit:
 * - create mode  → POST /roles  with { name, description?, permissions }
 * - edit mode    → PUT  /roles/:id/permissions  with { permissions }
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Role, RoleCreateInput, RolePermissionsInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { useRoles } from '../../api/roles';

const schema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).default([]),
});

type FormShape = z.infer<typeof schema>;

interface Props {
  initial?: Role;
  onCreate?: (body: RoleCreateInput) => Promise<unknown>;
  onUpdatePermissions?: (body: RolePermissionsInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
}

const defaults: FormShape = {
  name: '',
  description: '',
  permissions: [],
};

export function RoleForm({
  initial,
  onCreate,
  onUpdatePermissions,
  onCancel,
  submitting,
  submitError,
}: Props) {
  const editMode = !!initial;
  const roles = useRoles();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (initial) {
      reset({
        name: initial.name,
        description: initial.description ?? '',
        permissions: initial.permissions ?? [],
      });
    } else {
      reset(defaults);
    }
  }, [initial, reset]);

  const selected = watch('permissions') ?? [];
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Discover the known permission catalog from every role's `permissions`
  // field. This is an interim source until the api exposes
  // `GET /api/v1/permissions` directly. Union with the currently-selected
  // permissions so even custom strings render as togglable chips after
  // they've been added.
  const catalog = useMemo(() => {
    const set = new Set<string>();
    roles.data?.forEach((r) => r.permissions.forEach((p) => set.add(p)));
    selected.forEach((p) => set.add(p));
    return Array.from(set).sort();
  }, [roles.data, selected]);

  const groups = useMemo(() => groupByResource(catalog), [catalog]);

  const toggle = (p: string) => {
    const next = selectedSet.has(p) ? selected.filter((x) => x !== p) : [...selected, p].sort();
    setValue('permissions', next, { shouldDirty: true });
  };

  const addCustom = (raw: string) => {
    const v = raw.trim();
    if (!v || selectedSet.has(v)) return;
    setValue('permissions', [...selected, v].sort(), { shouldDirty: true });
  };

  const onValid: SubmitHandler<FormShape> = async (data) => {
    if (editMode) {
      if (!onUpdatePermissions) return;
      await onUpdatePermissions({ permissions: data.permissions });
    } else {
      if (!onCreate) return;
      await onCreate({
        name: data.name,
        description: data.description || undefined,
        permissions: data.permissions,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      {editMode && (
        <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2">
          Name and description are <strong>immutable</strong> after create — only the permission list can be changed.
          {initial?.is_system && (
            <>
              {' '}
              This is also a <strong>system seed</strong> role; it cannot be deleted.
            </>
          )}
        </div>
      )}

      <Field label="Name" error={errors.name?.message}>
        <input
          type="text"
          {...register('name')}
          readOnly={editMode}
          className={editMode ? inputClsReadonly : inputCls}
          placeholder="developer"
        />
      </Field>

      <Field label="Description" error={errors.description?.message}>
        <input
          type="text"
          {...register('description')}
          readOnly={editMode}
          className={editMode ? inputClsReadonly : inputCls}
        />
      </Field>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="block text-xs text-muted">Permissions</label>
          <span className="text-[11px] text-muted/70">{selected.length} selected</span>
        </div>

        {groups.length === 0 && roles.isLoading && (
          <div className="text-xs text-muted">Loading catalog…</div>
        )}

        {groups.length === 0 && !roles.isLoading && (
          <div className="text-xs text-muted italic">
            No catalog discovered yet. Add a custom permission below.
          </div>
        )}

        <div className="space-y-3 max-h-64 overflow-auto pr-1 -mr-1">
          {groups.map(({ resource, perms }) => (
            <div key={resource} className="space-y-1">
              <div className="text-[11px] uppercase text-muted/80 tracking-wide">{resource}</div>
              <div className="flex flex-wrap gap-1.5">
                {perms.map((p) => {
                  const on = selectedSet.has(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggle(p)}
                      className={
                        on
                          ? 'text-[11px] rounded px-2 py-1 bg-accent/20 border border-accent/60 text-accent'
                          : 'text-[11px] rounded px-2 py-1 bg-bg border border-border text-muted hover:text-text hover:border-border'
                      }
                    >
                      {on && <span className="mr-1">✓</span>}
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <CustomAdd onAdd={addCustom} />

        <div className="text-[11px] text-muted/80">
          The catalog above is discovered from existing roles. The api does not yet enforce permissions
          (<a className="underline" href="https://github.com/secrets-bridge/api/issues/27" target="_blank" rel="noreferrer">api#27</a>) — strings outside the platform's eventual catalog will not gate any handler.
        </div>
      </div>

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
          {submitting ? 'Saving…' : editMode ? 'Save permissions' : 'Create'}
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

function CustomAdd({ onAdd }: { onAdd: (raw: string) => void }) {
  const [val, setVal] = useState('');
  const submit = () => {
    onAdd(val);
    setVal('');
  };
  return (
    <div className="flex gap-2 pt-1">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="custom permission (e.g. secret.x.y) — Enter to add"
        className={inputCls + ' flex-1'}
      />
      <button
        type="button"
        onClick={submit}
        className="text-xs text-muted hover:text-text border border-border rounded px-3"
      >
        Add
      </button>
    </div>
  );
}

function groupByResource(catalog: string[]): { resource: string; perms: string[] }[] {
  const buckets = new Map<string, string[]>();
  catalog.forEach((p) => {
    const i = p.indexOf('.');
    const resource = i === -1 ? 'other' : p.slice(0, i);
    if (!buckets.has(resource)) buckets.set(resource, []);
    buckets.get(resource)!.push(p);
  });
  return Array.from(buckets.entries())
    .map(([resource, perms]) => ({ resource, perms: perms.sort() }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

const inputCls =
  'w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent';

const inputClsReadonly =
  'w-full bg-bg/40 border border-border/60 rounded px-3 py-2 text-muted text-sm cursor-not-allowed';

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
