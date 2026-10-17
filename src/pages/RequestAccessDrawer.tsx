/**
 * Request access drawer (handoff, slice 1). Fields in order:
 *
 *   - Project and environment: only the scopes the person has.
 *   - Secret: the secrets bound to that environment (path, provider,
 *     what the binding allows). Never a value.
 *   - Keys: checkboxes, at least one. When the binding allows every key
 *     and the catalog doesn't know the names, "All keys in this secret"
 *     or a list of names.
 *   - For a change request only, the new value of each chosen key
 *     (password inputs, cleared after submit).
 *   - Justification: at least 15 characters, and nothing that looks
 *     like a pasted secret.
 *
 * After a scope is chosen the drawer shows the provider and, for a
 * production environment, that direct reveal is blocked there. On
 * submit, each error shows under its field and focus moves to the
 * first. On success the drawer closes and the caller shows a toast
 * with a link to the new request; every count refreshes.
 *
 * "Request again" opens it pre-filled, as long as the secret is still
 * bound to that environment.
 */

import { useMemo, useState } from 'react';

import { ApiError } from '../api/client';
import { useEnvSecrets, type EnvSecretKey } from '../api/devSecrets';
import { useMe } from '../api/me';
import { useSubmitPatchRequest, useSubmitReadRequest } from '../api/requests';
import { revealErrorMessage } from '../api/revealErrors';
import { looksLikeASecret } from '../lib/justification';
import { providerLabel } from '../lib/providers';
import { scopeOptions } from '../requests/scope';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { EnvTag } from '../ui/EnvTag';
import { Field, Input, Select, Textarea } from '../ui/Field';
import { KeyPicker } from '../ui/KeyPicker';

const WHY_MIN = 15;

export interface RequestPrefill {
  projectId?: string;
  envName?: string;
  secretRef?: string;
  keys?: string[];
}

interface Props {
  prefill?: RequestPrefill;
  onClose: () => void;
  onCreated: (id: string) => void;
}

type Op = 'read' | 'patch';

interface SecretOption {
  ref: string;
  provider: string;
  /** Allowed key names; empty when the binding allows every key. */
  keys: string[];
  allKeys: boolean;
  ops: string[];
}

function groupSecrets(rows: EnvSecretKey[]): SecretOption[] {
  const by = new Map<string, SecretOption>();
  for (const r of rows) {
    const s = by.get(r.secret_ref) ?? { ref: r.secret_ref, provider: r.provider_type, keys: [], allKeys: false, ops: r.allowed_ops };
    if (r.key_name) s.keys.push(r.key_name);
    else s.allKeys = true;
    by.set(r.secret_ref, s);
  }
  return [...by.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

export function RequestAccessDrawer({ prefill, onClose, onCreated }: Props) {
  const me = useMe();
  const scopes = useMemo(() => scopeOptions(me.data?.projects), [me.data]);
  const envIdOf = (value: string) => {
    const s = scopes.find((x) => x.value === value);
    const env = me.data?.projects.find((p) => p.id === s?.projectId)?.environments?.find((e) => e.name === s?.envName);
    return env?.id;
  };

  const [op, setOp] = useState<Op>('read');
  const [scope, setScope] = useState(() =>
    prefill?.projectId && prefill.envName ? `${prefill.projectId}::${prefill.envName}` : '',
  );
  const [secretRef, setSecretRef] = useState(prefill?.secretRef ?? '');
  const [picked, setPicked] = useState<string[]>(prefill?.keys ?? []);
  const [allKeys, setAllKeys] = useState(true);
  const [typedKeys, setTypedKeys] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [why, setWhy] = useState('');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<{ field?: string; text: string } | null>(null);

  const scopeOpt = scopes.find((s) => s.value === scope);
  const envId = scope ? envIdOf(scope) : undefined;
  const envSecrets = useEnvSecrets(scopeOpt?.projectId, envId);
  const secrets = useMemo(
    () => groupSecrets(envSecrets.data ?? []).filter((s) => s.ops.includes(op)),
    [envSecrets.data, op],
  );
  // A secret that is no longer offered (scope or operation changed, or a
  // pre-filled one that was unbound) counts as not chosen.
  const secret = secrets.find((s) => s.ref === secretRef);
  const effectiveRef = secret ? secretRef : '';
  const knownKeys = secret && !secret.allKeys ? secret.keys : [];

  const submitRead = useSubmitReadRequest();
  const submitPatch = useSubmitPatchRequest();
  const pending = submitRead.isPending || submitPatch.isPending;

  // Plaintext hygiene: typed values live only in this component's state,
  // are blanked after submit, and go away when the drawer closes.

  const keysForSubmit: string[] | undefined = secret
    ? secret.allKeys
      ? allKeys
        ? undefined
        : typedKeys.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean)
      : picked.filter((k) => knownKeys.includes(k))
    : [];

  // --- validation ---------------------------------------------------
  const whyLen = why.trim().length;
  const errors: Record<string, string> = {};
  if (!scope) errors.scope = 'Choose a project and environment.';
  else if (!effectiveRef) errors.secret = 'Choose a secret.';
  if (secret) {
    if (keysForSubmit !== undefined && keysForSubmit.length === 0) {
      errors.keys = secret.allKeys ? 'Name at least one key, or choose all keys.' : 'Pick at least one key.';
    }
    if (op === 'patch') {
      const ks = keysForSubmit ?? [];
      if (secret.allKeys && allKeys) errors.keys = 'Name the keys you want to change.';
      else if (ks.some((k) => !values[k])) errors.values = 'Enter a new value for every key you picked.';
    }
  }
  if (whyLen < WHY_MIN) errors.why = `Explain the task in at least ${WHY_MIN} characters (${whyLen} so far).`;
  else if (looksLikeASecret(why)) errors.why = "This looks like it contains a secret value. Describe the task instead; don't paste values here.";
  const show = (k: string) => (tried ? errors[k] : undefined) ?? (serverError?.field === k ? serverError.text : undefined);

  const firstInvalid = ['scope', 'secret', 'keys', 'values', 'why'].find((k) => errors[k]);
  const focusField = (k: string) => {
    const id = { scope: 'ra-scope', secret: 'ra-secret', keys: 'ra-keys', values: 'ra-values', why: 'ra-why' }[k];
    if (id) document.getElementById(id)?.focus();
  };

  const submit = async () => {
    setTried(true);
    setServerError(null);
    if (firstInvalid || !scopeOpt || !secret) {
      if (firstInvalid) focusField(firstInvalid);
      return;
    }
    const base = {
      project_id: scopeOpt.projectId,
      environment: scopeOpt.envName,
      target_provider_type: secret.provider,
      target_secret_ref: secret.ref,
      justification: why.trim(),
    };
    try {
      if (op === 'read') {
        const created = await submitRead.mutateAsync({ ...base, target_keys: keysForSubmit });
        onCreated(created.id);
      } else {
        const key_values: Record<string, string> = {};
        for (const k of keysForSubmit ?? []) key_values[k] = values[k];
        try {
          const created = await submitPatch.mutateAsync({ ...base, key_values });
          submitPatch.reset();
          onCreated(created.id);
        } finally {
          for (const k of Object.keys(key_values)) key_values[k] = '';
          setValues({});
        }
      }
    } catch (err) {
      const e = mapSubmitError(err);
      setServerError(e);
      if (e.field) focusField(e.field);
    }
  };

  return (
    <Drawer
      title="Request access"
      subtitle={
        op === 'read'
          ? 'Read request · values stay in the provider until an approved read runs.'
          : 'Change request · the agent writes the new values after approval.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="request-access" variant="primary" disabled={pending} aria-busy={pending}>
            {pending ? 'Submitting…' : 'Submit request'}
          </Button>
        </>
      }
    >
      <form
        id="request-access"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-body font-semibold text-ink">What do you need?</legend>
          <div className="flex flex-wrap gap-4 text-ui font-normal">
            <label className="flex items-center gap-2">
              <input type="radio" name="ra-op" checked={op === 'read'} onChange={() => setOp('read')} className="accent-accent" />
              Read values
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="ra-op" checked={op === 'patch'} onChange={() => setOp('patch')} className="accent-accent" />
              Change values
            </label>
          </div>
        </fieldset>

        <Field
          id="ra-scope"
          label="Project and environment"
          hint="Only the projects and environments you have access to are listed."
          error={show('scope')}
        >
          {(p) => (
            <Select
              {...p}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setSecretRef('');
                setPicked([]);
              }}
              data-autofocus
            >
              <option value="">Choose where you need access</option>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                  {s.envKind === 'prod' ? ' (production)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {scopeOpt && (
          <Field
            id="ra-secret"
            label="Secret"
            hint={
              envSecrets.isLoading
                ? 'Loading the secrets bound to this environment…'
                : secrets.length === 0
                  ? `No secret in ${scopeOpt.label} allows ${op === 'read' ? 'reading' : 'changes'}. Ask an administrator to bind one.`
                  : 'Secrets bound to this environment. Paths and key names only.'
            }
            error={show('secret')}
          >
            {(p) => (
              <Select
                {...p}
                value={effectiveRef}
                onChange={(e) => {
                  setSecretRef(e.target.value);
                  setPicked([]);
                }}
                disabled={secrets.length === 0}
                className="font-mono"
              >
                <option value="">Choose a secret</option>
                {secrets.map((s) => (
                  <option key={s.ref} value={s.ref}>
                    {s.ref} · {s.allKeys ? 'all keys' : `${s.keys.length} key${s.keys.length === 1 ? '' : 's'}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {scopeOpt && secret && (
          <div className="rounded-md border border-border bg-sunken px-3.5 py-3 text-ui font-normal">
            <p>
              {scopeOpt.projectName} <EnvTag kind={scopeOpt.envKind}>{scopeOpt.envName}</EnvTag> ·{' '}
              {providerLabel(secret.provider)}
            </p>
            <p className="mt-1 text-caption text-muted">
              An approver decides before the agent {op === 'read' ? 'reads' : 'writes'} anything. The policy for this
              project and environment sets how many approvals it needs.
            </p>
          </div>
        )}
        {scopeOpt?.envKind === 'prod' && op === 'read' && (
          <Banner>Direct reveal is blocked in Production. This creates an approved-read request instead.</Banner>
        )}

        {secret &&
          (secret.allKeys ? (
            <fieldset id="ra-keys" tabIndex={-1} className="flex flex-col gap-1.5" aria-describedby={show('keys') ? 'ra-keys-error' : undefined}>
              <legend className="mb-1.5 text-body font-semibold text-ink">Keys</legend>
              <p className="text-caption text-muted">This binding allows every key. Pick only what the task needs.</p>
              <label className="flex items-center gap-2.5 text-ui font-normal">
                <input type="radio" name="ra-keymode" checked={allKeys} onChange={() => setAllKeys(true)} className="accent-accent" />
                All keys in this secret
              </label>
              <label className="flex items-center gap-2.5 text-ui font-normal">
                <input type="radio" name="ra-keymode" checked={!allKeys} onChange={() => setAllKeys(false)} className="accent-accent" />
                Only these keys
              </label>
              {!allKeys && (
                <Input
                  aria-label="Key names, separated by commas"
                  value={typedKeys}
                  onChange={(e) => setTypedKeys(e.target.value)}
                  placeholder="DB_USERNAME, DB_PASSWORD"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
              {show('keys') && (
                <p id="ra-keys-error" className="text-caption font-medium text-bad">
                  {show('keys')}
                </p>
              )}
            </fieldset>
          ) : (
            <KeyPicker
              id="ra-keys"
              keys={knownKeys}
              selected={picked.filter((k) => knownKeys.includes(k))}
              onToggle={(k) => setPicked((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))}
              error={show('keys')}
            />
          ))}

        {secret && op === 'patch' && (keysForSubmit ?? []).length > 0 && (
          <fieldset id="ra-values" tabIndex={-1} className="flex flex-col gap-2.5">
            <legend className="mb-1.5 text-body font-semibold text-ink">New values</legend>
            <p className="text-caption text-muted">
              Sent over TLS and wrapped on the server before it stores them. The agent writes them after approval.
              They are cleared from this page when you submit or close.
            </p>
            {(keysForSubmit ?? []).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-ui font-normal">
                <span className="font-mono text-mono">{k}</span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={values[k] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
                  className="font-mono"
                />
              </label>
            ))}
            {show('values') && <p className="text-caption font-medium text-bad">{show('values')}</p>}
          </fieldset>
        )}

        <Field
          id="ra-why"
          label="Justification"
          hint={`Approvers see this. At least ${WHY_MIN} characters. Don't paste secret values here.`}
          error={show('why')}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="What are you doing, and why do you need these keys?"
              maxLength={1000}
            />
          )}
        </Field>

        {serverError && !serverError.field && <Banner tone="error" title="Not submitted.">{serverError.text}</Banner>}
      </form>
    </Drawer>
  );
}

function mapSubmitError(err: unknown): { field?: string; text: string } {
  if (!(err instanceof ApiError)) return { text: err instanceof Error ? err.message : String(err) };
  const friendly = revealErrorMessage(err);
  if (err.message === 'out_of_scope_key') return { field: 'keys', text: friendly ?? err.message };
  if (err.message === 'out_of_scope_project') return { field: 'secret', text: friendly ?? err.message };
  if (err.message === 'out_of_scope_op') return { field: 'secret', text: friendly ?? err.message };
  return { text: `${err.status}: ${friendly ?? err.message}` };
}
