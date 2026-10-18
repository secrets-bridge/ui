/**
 * Create or edit a role, in a drawer.
 *
 * api constraint: name and description can't change after create. The
 * only mutation is `PUT /roles/:id/permissions`, so in edit mode they
 * show as plain text and only the permission list is editable.
 *
 * Permissions come from the catalog (`GET /api/v1/permissions`,
 * api#32), grouped by the api's `group` field, each with its
 * description. Permissions a role holds that the catalog doesn't know
 * (typed before the catalog existed, or retired) show in a final
 * "Not in the catalog" group so they can be removed. A free-form input
 * still adds a string the catalog doesn't ship; the api stores it, but
 * no route checks it.
 *
 * Granting `secret.security.approve` asks the admin to type the
 * permission first (Slice N5): a holder can approve cross-team
 * requests on the security side.
 *
 * On submit:
 *   - create → POST /roles with { name, description?, permissions }
 *   - edit   → PUT /roles/:id/permissions with { permissions }
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { usePermissions } from '../../api/permissions';
import type { PermissionDescriptor, Role, RoleCreateInput, RolePermissionsInput } from '../../api/types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Drawer } from '../../ui/Drawer';
import { Field, Input } from '../../ui/Field';
import { errorText } from './roles/format';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the role.')
    .max(120, 'Keep the name under 120 characters.'),
  description: z.string().max(500, 'Keep the description under 500 characters.').optional(),
  permissions: z.array(z.string()).default([]),
});

// `permissions` has a `.default([])`, so the schema's input (what the
// form holds) and output (what onValid receives) differ; resolvers v5
// types both sides of useForm separately.
type FormInput = z.input<typeof schema>;
type FormShape = z.output<typeof schema>;

interface Props {
  initial?: Role;
  onCreate?: (body: RoleCreateInput) => Promise<unknown>;
  onUpdatePermissions?: (body: RolePermissionsInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
}

const defaults: FormShape = { name: '', description: '', permissions: [] };

const UNKNOWN_GROUP = 'Not in the catalog';
const UNKNOWN_HINT = 'Nothing in the platform checks this permission.';

// Granting one of these asks the admin to type it first. Removing is free.
const TYPE_TO_CONFIRM = new Set(['secret.security.approve']);

export function RoleForm({ initial, onCreate, onUpdatePermissions, onCancel, submitting, submitError }: Props) {
  const editMode = !!initial;
  const catalog = usePermissions();

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormInput, unknown, FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    reset(
      initial
        ? { name: initial.name, description: initial.description ?? '', permissions: initial.permissions ?? [] }
        : defaults,
    );
  }, [initial, reset]);

  const watched = useWatch({ control, name: 'permissions' });
  const selected = useMemo(() => watched ?? [], [watched]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const groups = useMemo(() => buildGroups(catalog.data ?? [], selected), [catalog.data, selected]);

  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  const commitToggle = (p: string) => {
    const next = selectedSet.has(p) ? selected.filter((x) => x !== p) : [...selected, p].sort();
    setValue('permissions', next, { shouldDirty: true });
  };

  const toggle = (p: string) => {
    if (TYPE_TO_CONFIRM.has(p) && !selectedSet.has(p)) {
      setPendingConfirm(p);
      return;
    }
    commitToggle(p);
  };

  const addCustom = (raw: string) => {
    const v = raw.trim();
    if (!v || selectedSet.has(v)) return;
    if (TYPE_TO_CONFIRM.has(v)) {
      setPendingConfirm(v);
      return;
    }
    setValue('permissions', [...selected, v].sort(), { shouldDirty: true });
  };

  const onValid: SubmitHandler<FormShape> = async (data) => {
    try {
      if (editMode) {
        await onUpdatePermissions?.({ permissions: data.permissions });
      } else {
        await onCreate?.({ name: data.name, description: data.description || undefined, permissions: data.permissions });
      }
    } catch {
      // The caller's mutation holds the error; it shows below the form.
    }
  };

  return (
    <Drawer
      title={initial ? `Edit ${initial.name}` : 'Create role'}
      subtitle={
        editMode
          ? "Only the permissions can change. A role's name and description are fixed when it is created."
          : 'A role is a named set of permissions. Assignments give it to people.'
      }
      onClose={onCancel}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" variant="primary" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Saving…' : editMode ? 'Save permissions' : 'Create role'}
          </Button>
        </>
      }
    >
      <form id="role-form" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        {initial ? (
          <dl className="m-0 rounded-md border border-border bg-sunken px-3.5 py-1">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal">
              <dt className="text-muted">Name</dt>
              <dd className="m-0 font-mono text-mono text-ink">{initial.name}</dd>
            </div>
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2.5 text-ui font-normal">
              <dt className="text-muted">Description</dt>
              <dd className="m-0 break-words text-ink">{initial.description || <span className="text-muted">None</span>}</dd>
            </div>
          </dl>
        ) : (
          <>
            <Field id="role-name" label="Name" hint="Lowercase with underscores reads best, like release_manager." error={errors.name?.message}>
              {(p) => (
                <Input {...p} {...register('name')} placeholder="release_manager" className="font-mono" autoComplete="off" spellCheck={false} data-autofocus />
              )}
            </Field>
            <Field id="role-description" label="Description (optional)" error={errors.description?.message}>
              {(p) => <Input {...p} {...register('description')} placeholder="Approves releases to production" />}
            </Field>
          </>
        )}
        {initial?.is_system && <Banner>This is a built-in role. You can change its permissions, but not delete it.</Banner>}

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 flex w-full items-baseline justify-between text-body font-semibold text-ink">
            Permissions
            <span className="font-mono text-mono-small font-normal text-muted">{selected.length} selected</span>
          </legend>
          {catalog.isLoading && <p className="text-muted">Loading the permission catalog…</p>}
          {catalog.isError && (
            <Banner tone="error" title="Couldn't load the permission catalog.">
              The permissions this role already has still show. You can add others by name below.
            </Banner>
          )}
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-1">
              <h3 className={'text-label ' + (g.name === UNKNOWN_GROUP ? 'text-bad' : 'text-muted')}>{g.name}</h3>
              <div className="flex flex-col rounded-md border border-border">
                {g.items.map((d) => {
                  const on = selectedSet.has(d.key);
                  return (
                    <label
                      key={d.key}
                      className="flex cursor-pointer items-start gap-2.5 border-t border-rule px-3 py-2 first:border-t-0 hover:bg-sunken max-md:min-h-(--control-touch)"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(d.key)}
                        className="mt-[3px] h-4 w-4 shrink-0 accent-accent"
                        data-perm={d.key}
                      />
                      <span className="min-w-0">
                        <span className="block break-all font-mono text-mono text-ink">{d.key}</span>
                        {d.description && <span className="block text-caption text-muted">{d.description}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <CustomAdd onAdd={addCustom} />
        </fieldset>

        {submitError != null && (
          <Banner tone="error" title={editMode ? 'Not saved.' : 'Not created.'}>
            {errorText(submitError)}
          </Banner>
        )}
      </form>

      {pendingConfirm && (
        <ConfirmGrant
          permission={pendingConfirm}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            commitToggle(pendingConfirm);
            setPendingConfirm(null);
          }}
        />
      )}
    </Drawer>
  );
}

function ConfirmGrant({ permission, onCancel, onConfirm }: { permission: string; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState('');
  const [tried, setTried] = useState(false);
  const ok = typed.trim() === permission;
  return (
    <Dialog
      title="Grant a security permission?"
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setTried(true);
              if (ok) onConfirm();
              else document.getElementById('confirm-perm')?.focus();
            }}
          >
            Grant permission
          </Button>
        </>
      }
    >
      <p className="text-muted">
        Anyone with this role can give the security approval on cross-team requests. Grant it only to people cleared to
        review security.
      </p>
      <Field
        id="confirm-perm"
        label={
          <>
            Type <span className="font-mono">{permission}</span> to confirm
          </>
        }
        error={tried && !ok ? "The text doesn't match the permission name." : undefined}
      >
        {(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} data-autofocus />}
      </Field>
    </Dialog>
  );
}

/**
 * Catalog groups in api order, plus any selected permission the catalog
 * doesn't know, in a last group so it can be seen and removed.
 */
function buildGroups(catalog: PermissionDescriptor[], selected: string[]): { name: string; items: PermissionDescriptor[] }[] {
  const groupMap = new Map<string, PermissionDescriptor[]>();
  const known = new Set<string>();
  for (const d of catalog) {
    known.add(d.key);
    const bucket = groupMap.get(d.group);
    if (bucket) bucket.push(d);
    else groupMap.set(d.group, [d]);
  }
  const groups = Array.from(groupMap.entries()).map(([name, items]) => ({ name, items }));
  const unknown = selected
    .filter((p) => !known.has(p))
    .sort()
    .map<PermissionDescriptor>((key) => ({ key, group: UNKNOWN_GROUP, description: UNKNOWN_HINT }));
  if (unknown.length > 0) groups.push({ name: UNKNOWN_GROUP, items: unknown });
  return groups;
}

function CustomAdd({ onAdd }: { onAdd: (raw: string) => void }) {
  const [val, setVal] = useState('');
  const submit = () => {
    onAdd(val);
    setVal('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="role-custom-perm" className="text-body font-semibold text-ink">
        Add a permission by name
      </label>
      <div className="flex gap-2">
        <Input
          id="role-custom-perm"
          aria-describedby="role-custom-perm-hint"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="secret.example.action"
          className="min-w-0 flex-1 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="button" variant="secondary" onClick={submit}>
          Add
        </Button>
      </div>
      <p id="role-custom-perm-hint" className="text-caption text-muted">
        For a permission the catalog doesn't list yet. It is saved with the role, but nothing in the platform checks it.
      </p>
    </div>
  );
}
