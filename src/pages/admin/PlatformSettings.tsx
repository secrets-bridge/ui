/**
 * R-follow-up #2 (api#113) — Platform settings admin page.
 *
 * One card per whitelisted setting key. v1 ships exactly one card:
 * the scoped policy reserved priority band. Future keys land as
 * additional cards keyed off the value returned by
 * `usePlatformSettings()`.
 *
 * Auth: gated by `policy.edit` (same permission the api side gates
 * the GET / PUT routes on). The route entry in App.tsx + the sidebar
 * link in Shell.tsx both enforce the gate; this page is a
 * defense-in-depth fallback that renders an unauthorized notice if
 * an actor without `policy.edit` ever lands here directly.
 *
 * Confirm modal carries the §2 Q13 warning copy + inline triage SQL
 * so an operator who's about to lower the cap can sanity-check
 * existing scoped rules first — landing below the new cap is a
 * grandfathered state per the §3 locked design.
 */

import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import {
  KEY_PLATFORM_RESERVED_PRIORITY,
  usePlatformSettings,
  useUpdatePlatformSetting,
} from '../../api/platformSettings';
import {
  extractPolicyRuleError,
  toPolicyRuleErrorToast,
} from '../../api/policyErrors';
import type { PlatformSetting } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { canManagePlatformPolicy } from '../../auth/capabilities';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { PageHeader } from '../../ui/PageHeader';

const PRIORITY_MIN = 100;
const PRIORITY_MAX = 1_000_000;

export function PlatformSettings() {
  const { identity } = useAuth();
  const allowed = canManagePlatformPolicy(identity?.permissions);
  const list = usePlatformSettings({ enabled: allowed });
  const reservedPriority = useMemo(
    () =>
      list.data?.find(
        (s) => s.key === KEY_PLATFORM_RESERVED_PRIORITY,
      ) ?? null,
    [list.data],
  );

  if (!allowed) {
    return (
      <div>
        <PageHeader
          title="Platform settings"
          description="Cross-cutting platform configuration."
        />
        <Card className="p-8 text-sm text-muted">
          You need the <code className="font-mono">policy.edit</code>{' '}
          permission to view or change platform settings.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Platform settings"
        description="Cross-cutting platform configuration. Changes propagate to all pods within seconds via Redis pub/sub."
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">
            Failed to load platform settings
          </div>
          <div className="text-muted mt-1">
            {stringifyError(list.error)}
          </div>
        </Card>
      )}

      {list.isLoading && (
        <div className="text-muted text-sm">Loading…</div>
      )}

      {list.data && (
        <div className="space-y-4">
          <ReservedPriorityCard setting={reservedPriority} />
        </div>
      )}
    </div>
  );
}

// --- Reserved priority card ----------------------------------------

function ReservedPriorityCard({
  setting,
}: {
  setting: PlatformSetting | null;
}) {
  const current =
    setting && typeof setting.value === 'number' ? setting.value : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (current !== null && !editing) setDraft(String(current));
  }, [current, editing]);

  const update = useUpdatePlatformSetting(KEY_PLATFORM_RESERVED_PRIORITY);

  function validate(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setValidationError('Value is required.');
      return null;
    }
    if (!/^[0-9]+$/.test(trimmed)) {
      setValidationError(
        'Value must be a whole number (no decimals, no leading sign).',
      );
      return null;
    }
    const n = Number(trimmed);
    if (n < PRIORITY_MIN || n > PRIORITY_MAX) {
      setValidationError(
        `Value must be between ${PRIORITY_MIN} and ${PRIORITY_MAX}.`,
      );
      return null;
    }
    setValidationError(null);
    return n;
  }

  function onAttemptSubmit() {
    const n = validate(draft);
    if (n === null) return;
    if (current !== null && n === current) {
      // No-op — close edit, don't fire mutation.
      setEditing(false);
      return;
    }
    setConfirmOpen(true);
  }

  if (current === null) {
    return (
      <Card className="p-5 text-sm text-muted">
        Reserved priority setting not found on the server.
      </Card>
    );
  }

  return (
    <>
      <Card className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-text font-semibold tracking-tight">
              Scoped policy reserved priority
            </div>
            <div className="text-muted text-xs mt-1">
              Platform-global policy rules use priorities at or above
              this value. Scoped policy authors (project-anchored) must
              choose priorities strictly below it.
            </div>
          </div>
          {!editing && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setDraft(String(current));
                setValidationError(null);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
        </div>

        {!editing && (
          <div className="text-2xl font-bold tracking-tight tabular-nums">
            {current.toLocaleString()}
          </div>
        )}

        {editing && (
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider text-muted">
              New value (between {PRIORITY_MIN.toLocaleString()} and{' '}
              {PRIORITY_MAX.toLocaleString()})
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              className="w-48 bg-bg border border-border rounded-md px-3 py-2 text-text font-mono text-sm focus:outline-none focus:border-accent"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (validationError) validate(e.target.value);
              }}
            />
            {validationError && (
              <div className="text-red-400 text-xs">{validationError}</div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="primary"
                size="md"
                disabled={update.isPending}
                onClick={onAttemptSubmit}
              >
                Save…
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setEditing(false);
                  setValidationError(null);
                  setDraft(String(current));
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="text-muted text-[11px] pt-2 border-t border-border/60">
          Last updated{' '}
          {setting?.updated_at
            ? new Date(setting.updated_at).toLocaleString()
            : 'never'}
          {setting?.updated_by ? ` by ${setting.updated_by}` : ''}
        </div>
      </Card>

      {confirmOpen && current !== null && (
        <ChangeReservedPriorityModal
          currentValue={current}
          nextValue={Number(draft.trim())}
          isPending={update.isPending}
          error={update.error}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            try {
              await update.mutateAsync(Number(draft.trim()));
              setConfirmOpen(false);
              setEditing(false);
            } catch {
              // Error stays surfaced inside the modal; mutation
              // already captured it on `update.error`.
            }
          }}
        />
      )}
    </>
  );
}

// --- Confirm modal -------------------------------------------------

/**
 * Bespoke confirm modal (NOT the shared ui/ConfirmModal) because we
 * need: the §2 Q13 warning + the inline triage SQL block + a
 * structured error envelope path that renders `invalid_platform_setting`'s
 * min/max via `toPolicyRuleErrorToast`. The shared component is fine
 * for the role/policy/workflow delete flows but doesn't expose enough
 * surface for this one.
 */
function ChangeReservedPriorityModal({
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, isPending]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={() => !isPending && onCancel()}
        aria-label="Close"
      />
      <div className="relative bg-surface border border-border rounded-2xl w-[560px] max-w-full p-6 space-y-4 shadow-2xl">
        <div className="text-text font-bold text-xl tracking-tight">
          Change scoped policy reserved priority?
        </div>
        <div className="text-muted text-sm leading-relaxed">
          From <strong className="text-text">{currentValue.toLocaleString()}</strong>{' '}
          to <strong className="text-text">{nextValue.toLocaleString()}</strong>.
        </div>

        {lowering && (
          <div className="bg-amber-500/10 border border-amber-500/40 border-l-4 border-l-amber-500 rounded-lg px-4 py-3 text-sm space-y-2">
            <div className="text-amber-300 font-semibold">
              Lowering the cap is grandfathered
            </div>
            <div className="text-amber-200/90 text-xs leading-relaxed">
              Scoped rules already at or above {nextValue.toLocaleString()}{' '}
              keep working as-is — they are NOT auto-deleted. New scoped
              rules created from now on must use priorities strictly
              below {nextValue.toLocaleString()}, and any scoped Update
              that bumps priority into the band will be rejected.
            </div>
            <details className="text-amber-200/90 text-xs">
              <summary className="cursor-pointer select-none">
                Triage SQL — list scoped rules in the grandfathered band
              </summary>
              <pre className="mt-2 bg-black/30 rounded p-2 overflow-x-auto text-[11px] leading-snug">
{`SELECT id, name, priority, project_id
  FROM policy_rules
 WHERE is_platform_inherited = false
   AND priority >= ${nextValue}
 ORDER BY priority ASC;`}
              </pre>
            </details>
          </div>
        )}

        {error != null && (
          <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-4 py-3 text-sm">
            <div className="text-red-300 font-semibold mb-0.5">
              {modalErrorTitle(error)}
            </div>
            <div className="text-red-200/90 text-xs">
              {modalErrorBody(error)}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant={lowering ? 'danger' : 'primary'}
            size="md"
            disabled={isPending}
            onClick={() => void onConfirm()}
          >
            {isPending ? 'Saving…' : 'Confirm change'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function modalErrorTitle(err: unknown): string {
  if (err instanceof ApiError) {
    const { code } = extractPolicyRuleError(err);
    if (code === 'platform_setting_unavailable') return 'Service unavailable';
    if (code === 'invalid_platform_setting') return 'Invalid value';
    if (code === 'unknown_platform_setting') return 'Unknown setting';
    return `${err.status} · Save failed`;
  }
  return 'Save failed';
}

function modalErrorBody(err: unknown): string {
  if (err instanceof ApiError) return toPolicyRuleErrorToast(err);
  if (err instanceof Error) return err.message;
  return String(err);
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
