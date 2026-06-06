/**
 * Create / edit form for a Role.
 *
 * CRITICAL api constraint: name + description are IMMUTABLE after
 * create. The only mutation endpoint is `PUT /roles/:id/permissions`.
 * In edit mode (when `initial` is provided) the name + description
 * inputs are marked readOnly + visually dimmed so an operator can SEE
 * the current values without thinking they're editable.
 *
 * Permissions UX — CANONICAL catalog (replaces ui#6's interim trick):
 *
 *   - The picker hydrates from `GET /api/v1/permissions`
 *     (api#32 — internal/auth/permissions.go::Catalog). Operators
 *     see every permission the platform actually understands, grouped
 *     by the api's `group` field (RBAC / Workflows / Agents /
 *     Secrets / Observability / Integrations), with descriptions
 *     surfaced as hover tooltips.
 *
 *   - Permissions a role currently holds that aren't in the catalog
 *     (e.g. custom strings typed before the catalog landed, or
 *     deprecated entries) render in a final "Custom / unknown" group
 *     with a warning style. Toggling removes them. This is the
 *     graceful-degradation path that keeps old roles editable.
 *
 *   - A free-form add-input below the catalog still lets operators
 *     type a string the platform doesn't ship yet. The warning beneath
 *     it calls out that strings outside the catalog won't gate any
 *     handler until api#27 (P0-2) lands.
 *
 * On submit:
 *   - create mode → POST /roles  with { name, description?, permissions }
 *   - edit mode   → PUT  /roles/:id/permissions  with { permissions }
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type {
  PermissionDescriptor,
  Role,
  RoleCreateInput,
  RolePermissionsInput,
} from '../../api/types';
import { ApiError } from '../../api/client';
import { usePermissions } from '../../api/permissions';

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

const UNKNOWN_GROUP = 'Custom / unknown';

export function RoleForm({
  initial,
  onCreate,
  onUpdatePermissions,
  onCancel,
  submitting,
  submitError,
}: Props) {
  const editMode = !!initial;
  const catalog = usePermissions();

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

  // Build the render list: every catalog descriptor (preserving the
  // api's order so the UI shape matches the source of truth), PLUS
  // synthetic descriptors for selected strings the catalog doesn't
  // know about (so we can render + toggle them).
  const groups = useMemo(
    () => buildGroups(catalog.data ?? [], selected),
    [catalog.data, selected],
  );

  // Slice N5 — type-to-confirm gate for high-blast-radius permissions.
  // Today only `secret.security.approve` triggers it (the security
  // approver bypasses the source-side workflow on cross-team rows).
  // Future high-blast perms can be added to the set without further UI.
  const TYPE_TO_CONFIRM_PERMS = new Set(['secret.security.approve']);
  const [pendingConfirmPerm, setPendingConfirmPerm] = useState<string | null>(null);
  const [confirmTyped, setConfirmTyped] = useState('');

  const commitToggle = (p: string) => {
    const next = selectedSet.has(p)
      ? selected.filter((x) => x !== p)
      : [...selected, p].sort();
    setValue('permissions', next, { shouldDirty: true });
  };

  const toggle = (p: string) => {
    // Removing a sensitive perm is free; granting it requires type-to-
    // confirm. The api still validates server-side.
    if (
      TYPE_TO_CONFIRM_PERMS.has(p) &&
      !selectedSet.has(p)
    ) {
      setPendingConfirmPerm(p);
      setConfirmTyped('');
      return;
    }
    commitToggle(p);
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

        {catalog.isLoading && (
          <div className="text-xs text-muted">Loading catalog…</div>
        )}

        {catalog.isError && (
          <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
            Failed to load permission catalog. Existing chips still work; new selections fall back to free-form.
          </div>
        )}

        <div className="space-y-3 max-h-72 overflow-auto pr-1 -mr-1">
          {groups.map((g) => (
            <div key={g.name} className="space-y-1">
              <div
                className={
                  g.name === UNKNOWN_GROUP
                    ? 'text-[11px] uppercase text-yellow-300/80 tracking-wide'
                    : 'text-[11px] uppercase text-muted/80 tracking-wide'
                }
              >
                {g.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((d) => {
                  const on = selectedSet.has(d.key);
                  const unknown = g.name === UNKNOWN_GROUP;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => toggle(d.key)}
                      title={d.description || (unknown ? 'Not in the platform catalog — will not gate any handler' : d.key)}
                      className={
                        on
                          ? unknown
                            ? 'text-[11px] rounded px-2 py-1 bg-yellow-400/15 border border-yellow-400/50 text-yellow-200'
                            : 'text-[11px] rounded px-2 py-1 bg-accent/20 border border-accent/60 text-accent'
                          : 'text-[11px] rounded px-2 py-1 bg-bg border border-border text-muted hover:text-text hover:border-border'
                      }
                    >
                      {on && <span className="mr-1">✓</span>}
                      {d.key}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <CustomAdd onAdd={addCustom} />

        <div className="text-[11px] text-muted/80">
          Catalog from <code>GET /api/v1/permissions</code>. The api does not yet enforce permissions
          (<a className="underline" href="https://github.com/secrets-bridge/api/issues/27" target="_blank" rel="noreferrer">api#27</a>) — strings outside the catalog will not gate any handler.
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
      {pendingConfirmPerm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
            onClick={() => setPendingConfirmPerm(null)}
            aria-label="Close"
          />
          <div className="relative bg-surface border border-border rounded-2xl w-[480px] max-w-full p-6 space-y-3 shadow-2xl">
            <div className="text-text font-bold text-lg tracking-tight">
              Add a high-blast-radius permission
            </div>
            <p className="text-muted text-sm">
              You're about to grant{' '}
              <span className="font-mono text-text">{pendingConfirmPerm}</span>{' '}
              to this role. A holder bypasses the source-side workflow on
              cross-team requests — only grant it to security-cleared
              reviewers.
            </p>
            <p className="text-muted text-xs">
              Type <span className="font-mono text-text">{pendingConfirmPerm}</span>{' '}
              to confirm.
            </p>
            <input
              type="text"
              autoFocus
              value={confirmTyped}
              onChange={(e) => setConfirmTyped(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => setPendingConfirmPerm(null)}
                className="text-muted hover:text-text px-3 py-2 rounded border border-border text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmTyped.trim() !== pendingConfirmPerm}
                onClick={() => {
                  if (confirmTyped.trim() === pendingConfirmPerm) {
                    commitToggle(pendingConfirmPerm);
                    setPendingConfirmPerm(null);
                    setConfirmTyped('');
                  }
                }}
                className="bg-red-500/90 hover:bg-red-500 text-bg disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded text-sm font-medium"
              >
                Grant {pendingConfirmPerm}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Build the rendered groups list:
 *   1. Iterate the catalog in API order; bucket by descriptor.group;
 *      preserve insertion order both for groups and within each group.
 *   2. Any currently-selected permission that the catalog DOESN'T
 *      know about → append to a synthetic "Custom / unknown" group
 *      at the bottom so operators can see + toggle it off.
 */
function buildGroups(
  catalog: PermissionDescriptor[],
  selected: string[],
): { name: string; items: PermissionDescriptor[] }[] {
  const groupMap = new Map<string, PermissionDescriptor[]>();
  const knownKeys = new Set<string>();

  for (const d of catalog) {
    knownKeys.add(d.key);
    const bucket = groupMap.get(d.group);
    if (bucket) bucket.push(d);
    else groupMap.set(d.group, [d]);
  }

  const groups = Array.from(groupMap.entries()).map(([name, items]) => ({ name, items }));

  const unknown = selected
    .filter((p) => !knownKeys.has(p))
    .sort()
    .map<PermissionDescriptor>((key) => ({
      key,
      group: UNKNOWN_GROUP,
      description: 'Not in the platform catalog — will not gate any handler',
    }));

  if (unknown.length > 0) {
    groups.push({ name: UNKNOWN_GROUP, items: unknown });
  }

  return groups;
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
