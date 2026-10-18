/**
 * Platform settings (`/admin/platform-settings`, api#113).
 *
 * One panel per whitelisted setting key. v1 has one: the scoped policy
 * reserved priority band. Future keys land as more panels keyed off
 * `usePlatformSettings()`.
 *
 * Gated by policy.edit (the api gates GET and PUT the same way); the
 * route and sidebar check it too, so this page's notice is a fallback
 * for a typed URL.
 *
 * Saving asks first. Lowering the cap is grandfathered (§2 Q13, §3):
 * scoped rules already in the band keep working, so the dialog says so
 * and offers a query to list them before the change.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import { KEY_PLATFORM_RESERVED_PRIORITY, usePlatformSettings, useUpdatePlatformSetting } from '../../api/platformSettings';
import { extractPolicyRuleError, toPolicyRuleErrorToast } from '../../api/policyErrors';
import type { PlatformSetting } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { canManagePlatformPolicy } from '../../auth/capabilities';
import { formatExact } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Input } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { useToast } from '../../ui/toastContext';

const PRIORITY_MIN = 100;
const PRIORITY_MAX = 1_000_000;

export function PlatformSettings() {
  const { identity } = useAuth();
  const allowed = canManagePlatformPolicy(identity?.permissions);
  const list = usePlatformSettings({ enabled: allowed });
  const reservedPriority = list.data?.find((s) => s.key === KEY_PLATFORM_RESERVED_PRIORITY) ?? null;

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Platform settings" description="Settings that apply to the whole platform." />
        <Banner title="You can't change platform settings.">
          It needs the <code className="font-mono text-mono">policy.edit</code> permission. Ask an administrator.
        </Banner>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Platform settings"
        description="Settings that apply to the whole platform. A saved change reaches every api instance within seconds."
      />
      {list.isLoading && <p className="text-muted">Loading settings…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the platform settings."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : 'Network error.'}
        </Banner>
      )}
      {list.data && <ReservedPriorityPanel setting={reservedPriority} />}
    </div>
  );
}

function ReservedPriorityPanel({ setting }: { setting: PlatformSetting | null }) {
  const current = setting && typeof setting.value === 'number' ? setting.value : null;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdatePlatformSetting(KEY_PLATFORM_RESERVED_PRIORITY);

  function validate(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return fail('Enter a value.');
    if (!/^[0-9]+$/.test(trimmed)) return fail('Use a whole number, without decimals or a sign.');
    const n = Number(trimmed);
    if (n < PRIORITY_MIN || n > PRIORITY_MAX) {
      return fail(`Use a value between ${PRIORITY_MIN.toLocaleString('en-US')} and ${PRIORITY_MAX.toLocaleString('en-US')}.`);
    }
    setError(null);
    return n;
  }
  function fail(msg: string): null {
    setError(msg);
    document.getElementById('reserved-priority')?.focus();
    return null;
  }

  function attemptSave() {
    const n = validate(draft);
    if (n === null) return;
    if (current !== null && n === current) {
      // Nothing changed: close without a request.
      setEditing(false);
      return;
    }
    setConfirming(true);
  }

  if (current === null) {
    return <Banner title="The reserved priority setting isn't on the server.">The api didn't return it. Check the api version.</Banner>;
  }

  return (
    <section aria-labelledby="reserved-heading" className="max-w-3xl rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule px-5 py-3.5">
        <div className="min-w-0 flex-1 basis-[280px]">
          <h2 id="reserved-heading" className="text-block-heading text-ink">
            Scoped policy reserved priority
          </h2>
          <p className="mt-0.5 text-caption text-muted">
            Platform-wide policy rules use priorities at or above this value. Rules written for one project or team must stay below
            it.
          </p>
        </div>
        {!editing && (
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(String(current));
              setError(null);
              setEditing(true);
            }}
          >
            Change
          </Button>
        )}
      </div>

      <div className="px-5 py-4">
        {!editing ? (
          <p className="font-mono text-[22px] font-semibold tabular-nums text-ink">{current.toLocaleString('en-US')}</p>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              attemptSave();
            }}
            className="flex flex-col gap-3"
          >
            <Field
              id="reserved-priority"
              label="New value"
              hint={`A whole number between ${PRIORITY_MIN.toLocaleString('en-US')} and ${PRIORITY_MAX.toLocaleString('en-US')}.`}
              error={error ?? undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-48 font-mono"
                  autoFocus
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <Button type="submit" variant="primary" disabled={update.isPending}>
                Save…
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setDraft(String(current));
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <p className="border-t border-rule px-5 py-3 text-caption text-muted">
        Last changed {setting?.updated_at ? formatExact(setting.updated_at) : 'never'}
        {setting?.updated_by ? (
          <>
            {' '}by <span className="font-mono text-mono-small">{setting.updated_by}</span>
          </>
        ) : null}
      </p>

      {confirming && (
        <ChangeDialog
          currentValue={current}
          nextValue={Number(draft.trim())}
          isPending={update.isPending}
          error={update.error}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const next = Number(draft.trim());
            try {
              await update.mutateAsync(next);
              toast(`Reserved priority set to ${next.toLocaleString('en-US')}.`);
              setConfirming(false);
              setEditing(false);
            } catch {
              // Shown in the dialog from `update.error`.
            }
          }}
        />
      )}
    </section>
  );
}

/**
 * Its own dialog rather than ConfirmModal: it needs the grandfathering
 * warning, the triage query and the structured `invalid_platform_setting`
 * error (min and max) from `toPolicyRuleErrorToast`.
 */
function ChangeDialog({
  currentValue,
  nextValue,
  isPending,
  error,
  onCancel,
  onConfirm,
}: {
  currentValue: number;
  nextValue: number;
  isPending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => Promise<unknown>;
}) {
  const lowering = nextValue < currentValue;
  return (
    <Dialog
      title="Change the reserved priority?"
      onClose={onCancel}
      dismissible={!isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant={lowering ? 'danger' : 'primary'} onClick={() => void onConfirm()} disabled={isPending} aria-busy={isPending}>
            {isPending ? 'Saving…' : 'Change priority'}
          </Button>
        </>
      }
    >
      <p>
        From <strong className="font-mono">{currentValue.toLocaleString('en-US')}</strong> to{' '}
        <strong className="font-mono">{nextValue.toLocaleString('en-US')}</strong>.
      </p>
      {lowering && (
        <Banner title="Existing scoped rules keep working.">
          <p>
            Scoped rules already at or above {nextValue.toLocaleString('en-US')} are not deleted and still apply. From now on, new scoped
            rules must stay below {nextValue.toLocaleString('en-US')}, and an edit that moves one into the band is refused.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer select-none font-medium">Query to list the scoped rules in the band</summary>
            <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-mono-small leading-snug">
              {`SELECT id, name, priority, project_id
  FROM policy_rules
 WHERE is_platform_inherited = false
   AND priority >= ${nextValue}
 ORDER BY priority ASC;`}
            </pre>
          </details>
        </Banner>
      )}
      {error != null && (
        <Banner tone="error" title={errorTitle(error)}>
          {error instanceof ApiError ? toPolicyRuleErrorToast(error) : error instanceof Error ? error.message : String(error)}
        </Banner>
      )}
    </Dialog>
  );
}

function errorTitle(err: unknown): string {
  if (err instanceof ApiError) {
    const { code } = extractPolicyRuleError(err);
    if (code === 'platform_setting_unavailable') return 'Settings are unavailable right now.';
    if (code === 'invalid_platform_setting') return 'That value is out of range.';
    if (code === 'unknown_platform_setting') return 'The api doesn\'t know this setting.';
    return `Not saved (${err.status}).`;
  }
  return 'Not saved.';
}
