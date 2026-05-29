/**
 * Create / edit form for a Role.
 *
 * CRITICAL api constraint: name + description are IMMUTABLE after
 * create. The only mutation endpoint is `PUT /roles/:id/permissions`.
 * In edit mode (when `initial` is provided) the name + description
 * inputs are marked readOnly + visually dimmed so an operator can SEE
 * the current values without thinking they're editable.
 *
 * Permissions are managed as a comma-separated string in the form for
 * editing ergonomics; the form splits + trims into the array shape
 * the api expects on submit.
 *
 * On submit:
 * - create mode  → POST /roles  with { name, description?, permissions }
 * - edit mode    → PUT  /roles/:id/permissions  with { permissions }
 *   (caller picks the right hook; we only emit the right BODY shape.)
 */

import { useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Role, RoleCreateInput, RolePermissionsInput } from '../../api/types';
import { ApiError } from '../../api/client';

const schema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  description: z.string().max(500).optional(),
  permissions_csv: z.string().optional(),
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
  permissions_csv: '',
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

  const {
    register,
    handleSubmit,
    reset,
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
        permissions_csv: (initial.permissions ?? []).join(', '),
      });
    } else {
      reset(defaults);
    }
  }, [initial, reset]);

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const permissions =
      data.permissions_csv
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];

    if (editMode) {
      if (!onUpdatePermissions) return;
      await onUpdatePermissions({ permissions });
    } else {
      if (!onCreate) return;
      await onCreate({
        name: data.name,
        description: data.description || undefined,
        permissions,
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

      <Field
        label="Permissions (comma-separated)"
        error={errors.permissions_csv?.message}
        hint="Free-form permission strings. Wildcards (e.g. secret.*) are a future addition; today exact match."
      >
        <textarea
          {...register('permissions_csv')}
          rows={5}
          className={inputCls}
          placeholder="request.submit, request.approve, secret.read"
        />
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
