/**
 * Direct reveal drawer, opened from a secret row on a non-production
 * environment page. It creates a request that the policy approves at
 * once (POST /projects/:id/environments/:env_id/direct-reveal); the
 * agent then reads the keys and the person reveals them on the request
 * page, behind their second factor. Nothing here shows a value.
 *
 * The api refuses production before it looks at policy, and refuses
 * when the matching policy doesn't allow direct reveal; both answers
 * show inline with what to do instead.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useDirectReveal } from '../../api/devSecrets';
import { revealErrorMessage } from '../../api/revealErrors';
import type { MyEnvironment, MyProject } from '../../api/types';
import type { BoundSecret } from '../../lib/boundSecrets';
import { looksLikeASecret } from '../../lib/justification';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { EnvTag } from '../../ui/EnvTag';
import { Field, Input, Textarea } from '../../ui/Field';
import { KeyPicker } from '../../ui/KeyPicker';
import { Path } from '../../ui/Path';

const WHY_MIN = 15;

interface Props {
  project: MyProject;
  env: MyEnvironment;
  secret: BoundSecret;
  onClose: () => void;
  /** The request was created; the caller opens it. */
  onCreated: (requestId: string) => void;
  /** Policy refused direct reveal; the caller offers a normal request. */
  onRequestInstead: () => void;
}

export function DirectRevealDrawer({ project, env, secret, onClose, onCreated, onRequestInstead }: Props) {
  const reveal = useDirectReveal(project.id, env.id);
  const [picked, setPicked] = useState<string[]>(secret.keys.length === 1 ? secret.keys : []);
  const [allKeys, setAllKeys] = useState(true);
  const [typedKeys, setTypedKeys] = useState('');
  const [why, setWhy] = useState('');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<{ field?: string; text: string; policy?: boolean } | null>(null);

  const keys: string[] | undefined = secret.allKeys
    ? allKeys
      ? undefined
      : typedKeys.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean)
    : picked;

  const whyLen = why.trim().length;
  const errors: Record<string, string> = {};
  if (keys !== undefined && keys.length === 0) {
    errors.keys = secret.allKeys ? 'Name at least one key, or choose all keys.' : 'Pick at least one key.';
  }
  if (whyLen < WHY_MIN) errors.why = `Explain the task in at least ${WHY_MIN} characters (${whyLen} so far).`;
  else if (looksLikeASecret(why)) errors.why = "This looks like it contains a secret value. Describe the task instead; don't paste values here.";
  const show = (k: string) => (tried ? errors[k] : undefined) ?? (serverError?.field === k ? serverError.text : undefined);

  const submit = async () => {
    setTried(true);
    setServerError(null);
    const first = ['keys', 'why'].find((k) => errors[k]);
    if (first) {
      document.getElementById(first === 'keys' ? 'dr-keys' : 'dr-why')?.focus();
      return;
    }
    try {
      const resp = await reveal.mutateAsync({
        target_provider_type: secret.provider,
        target_secret_ref: secret.ref,
        target_keys: keys,
        justification: why.trim(),
      });
      onCreated(resp.request_id);
    } catch (err) {
      const e = mapError(err);
      setServerError(e);
      if (e.field) document.getElementById(e.field === 'keys' ? 'dr-keys' : 'dr-why')?.focus();
    }
  };

  const pending = reveal.isPending;

  return (
    <Drawer
      title="Reveal directly"
      subtitle="Policy approves this at once. The agent reads the keys, then you reveal them on the request page."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="direct-reveal" variant="primary" disabled={pending} aria-busy={pending}>
            {pending ? 'Submitting…' : 'Reveal directly'}
          </Button>
        </>
      }
    >
      <form
        id="direct-reveal"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <div className="rounded-md border border-border bg-sunken px-3.5 py-3 text-ui font-normal">
          <p><Path value={secret.ref} className="text-ink" /></p>
          <p className="mt-1">
            {project.name} <EnvTag kind={env.kind}>{env.name}</EnvTag> · {providerLabel(secret.provider)}
          </p>
          <p className="mt-1 text-caption text-muted">
            You confirm with your second factor before a value shows. Each value can be revealed once, for a few minutes.
          </p>
        </div>

        {secret.allKeys ? (
          <fieldset id="dr-keys" tabIndex={-1} className="flex flex-col gap-1.5" aria-describedby={show('keys') ? 'dr-keys-error' : undefined}>
            <legend className="mb-1.5 text-body font-semibold text-ink">Keys</legend>
            <p className="text-caption text-muted">This binding allows every key. Pick only what the task needs.</p>
            <label className="flex items-center gap-2.5 text-ui font-normal">
              <input type="radio" name="dr-keymode" checked={allKeys} onChange={() => setAllKeys(true)} className="accent-accent" />
              All keys in this secret
            </label>
            <label className="flex items-center gap-2.5 text-ui font-normal">
              <input type="radio" name="dr-keymode" checked={!allKeys} onChange={() => setAllKeys(false)} className="accent-accent" />
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
              <p id="dr-keys-error" className="text-caption font-medium text-bad">
                {show('keys')}
              </p>
            )}
          </fieldset>
        ) : (
          <KeyPicker
            id="dr-keys"
            keys={secret.keys}
            selected={picked}
            onToggle={(k) => setPicked((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))}
            error={show('keys')}
            autoFocus={secret.keys.length > 1}
          />
        )}

        <Field
          id="dr-why"
          label="Justification"
          hint={`Recorded in the audit log. At least ${WHY_MIN} characters. Don't paste secret values here.`}
          error={show('why')}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="What are you doing that needs these keys now?"
              maxLength={1000}
              data-autofocus={secret.allKeys || secret.keys.length <= 1 ? true : undefined}
            />
          )}
        </Field>

        {serverError && !serverError.field && (
          <Banner
            tone="error"
            title="Not revealed."
            action={
              serverError.policy ? (
                <Button variant="secondary" size="sm" onClick={onRequestInstead}>
                  Request access instead
                </Button>
              ) : undefined
            }
          >
            {serverError.text}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function mapError(err: unknown): { field?: string; text: string; policy?: boolean } {
  if (!(err instanceof ApiError)) return { text: err instanceof Error ? err.message : String(err) };
  const friendly = revealErrorMessage(err);
  if (err.message === 'requested key is not permitted by the binding allowlist') return { field: 'keys', text: friendly ?? err.message };
  if (err.message === 'matched policy does not permit direct reveal' || err.message === 'direct reveal is not permitted on prod environments') {
    return { text: friendly ?? err.message, policy: true };
  }
  return { text: `${err.status}: ${friendly ?? err.message}` };
}
