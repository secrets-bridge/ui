/**
 * Slice N5 — cross-team request submit drawer.
 *
 * Hosted from ProjectEnv.tsx as the third CTA (alongside Reveal +
 * Request access). Form shape per §5 design:
 *
 *   - target: team → project → environment (cascading)
 *   - destination: provider_connection (from SOURCE project bindings)
 *                 + secret_ref + dynamic key chip list
 *   - justification (≥10 chars)
 *
 * Hard rules:
 *   - NO secret values in the body (key NAMES only).
 *   - Stable 403 codes routed through `crossTeamErrorMessage` to
 *     friendly toasts; falls through to api's own message otherwise.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  crossTeamErrorMessage,
  useProviderConnections,
  useSubmitCrossTeam,
  type SubmitCrossTeamInput,
} from '../api/crossTeam';
import { useEnvironmentsForProject, useProjects } from '../api/tenancy';
import { useTeams } from '../api/teams';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import type { MyProject } from '../api/types';

/** Canonical UUID matcher — every target/destination id must be one. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  sourceProject: MyProject;
  /**
   * Source environment id. Threaded through to the provider-connections
   * dropdown so the api returns env-specific + project-wide bindings
   * (EPIC P §4). Optional because the drawer can also be opened from
   * project-level surfaces that don't carry an env context.
   */
  sourceEnvironmentID?: string;
  onClose: () => void;
}

export function CrossTeamSubmitDrawer({
  sourceProject,
  sourceEnvironmentID,
  onClose,
}: Props) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const teams = useTeams();
  const projects = useProjects();

  // Target picker state. Cascading: team chosen → projects filtered to
  // that team's owner_team_id → environment list narrowed to the
  // chosen target project.
  const [targetTeamID, setTargetTeamID] = useState('');
  const [targetProjectID, setTargetProjectID] = useState('');
  const [targetEnvID, setTargetEnvID] = useState('');

  // Filter to the chosen team's projects. The authoritative binding is
  // the typed `team_id` FK; `owner_team_id` is the legacy free-text
  // field and is EMPTY on projects created through the team FK, so
  // filtering on it alone silently returns nothing (the ui#86 cascade
  // bug). Prefer team_id, fall back to owner_team_id for legacy rows.
  const targetProjects = useMemo(
    () =>
      (projects.data ?? []).filter(
        (p) =>
          (p.team_id ?? p.owner_team_id ?? '') === targetTeamID &&
          p.status === 'active',
      ),
    [projects.data, targetTeamID],
  );
  const targetEnvs = useEnvironmentsForProject(
    targetProjectID || undefined,
  );

  // Destination picker — provider connections come from the SOURCE
  // project + env (cross-team values land in source's workload, not the
  // target team's). EPIC P returns a sanitized {id, name, type}
  // projection scoped to (project, env); empty list triggers the §5
  // empty-state CTA below, branched by integration.edit permission.
  const provConns = useProviderConnections(
    sourceProject.id,
    sourceEnvironmentID,
  );
  const [destProvConnID, setDestProvConnID] = useState('');
  const [destSecretRef, setDestSecretRef] = useState('');
  const [destKeysInput, setDestKeysInput] = useState('');
  const destKeys = useMemo(
    () =>
      destKeysInput
        .split(/[\s,]+/)
        .map((k) => k.trim())
        .filter(Boolean),
    [destKeysInput],
  );

  const [justification, setJustification] = useState('');

  const submit = useSubmitCrossTeam();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fail-closed validation. Every required ID must be a real UUID (so a
  // half-loaded dropdown or a label leaking through as a value can never
  // reach the POST); destination_keys must be a non-empty list; the
  // justification keeps its 10-char floor. `errors` is surfaced as a
  // visible checklist so submit is never a silent no-op.
  const errors = useMemo(() => {
    const e: string[] = [];
    if (!UUID_RE.test(targetTeamID)) e.push('Select a target team.');
    if (!UUID_RE.test(targetProjectID)) e.push('Select a target project.');
    if (!UUID_RE.test(targetEnvID)) e.push('Select a target environment.');
    if (!UUID_RE.test(destProvConnID))
      e.push('Select a destination provider connection.');
    if (destSecretRef.trim().length === 0)
      e.push('Enter the destination secret reference.');
    if (destKeys.length === 0) e.push('Add at least one key to fill.');
    if (justification.trim().length < 10)
      e.push(
        `Justification needs ${10 - justification.trim().length} more character${
          10 - justification.trim().length === 1 ? '' : 's'
        }.`,
      );
    return e;
  }, [
    targetTeamID,
    targetProjectID,
    targetEnvID,
    destProvConnID,
    destSecretRef,
    destKeys,
    justification,
  ]);
  const valid = errors.length === 0;

  const onSubmit = async () => {
    setSubmitError(null);
    if (!valid) return;
    const body: SubmitCrossTeamInput = {
      target_team_id: targetTeamID,
      target_project_id: targetProjectID,
      target_environment_id: targetEnvID,
      destination_provider_connection_id: destProvConnID,
      destination_secret_ref: destSecretRef.trim(),
      destination_keys: destKeys,
      justification: justification.trim(),
    };
    try {
      const resp = await submit.mutateAsync(body);
      navigate(`/requests/${resp.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const code = extractErrorCode(err);
        setSubmitError(
          crossTeamErrorMessage(code) ?? `${err.status} · ${err.message}`,
        );
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError(String(err));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        className="flex-1 bg-bg/80 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <aside className="w-[520px] max-w-full h-full bg-surface border-l border-border overflow-y-auto p-6 space-y-5">
        <div>
          <h2 className="text-text text-xl font-bold tracking-tight">
            New cross-team request
          </h2>
          <p className="text-muted text-sm mt-1">
            Ask another team to provide values you don't have direct
            access to. Their value provider fills the form; an approver
            (and security, if the policy requires it) verifies before
            the values land in your provider.
          </p>
          <p className="text-muted text-xs mt-2">
            Source project: <span className="text-text">{sourceProject.name}</span>
          </p>
        </div>

        <section className="space-y-3">
          <h3 className="text-text font-semibold text-sm uppercase tracking-wider">
            Target
          </h3>
          <Select
            label="Team"
            value={targetTeamID}
            onChange={(v) => {
              setTargetTeamID(v);
              setTargetProjectID('');
              setTargetEnvID('');
            }}
            options={[
              { value: '', label: 'Select a team…' },
              ...(teams.data ?? [])
                .filter((t) => t.status === 'active')
                .map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Select
            label="Project"
            value={targetProjectID}
            onChange={(v) => {
              setTargetProjectID(v);
              setTargetEnvID('');
            }}
            disabled={!targetTeamID}
            options={[
              { value: '', label: 'Select a project…' },
              ...targetProjects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="Environment"
            value={targetEnvID}
            onChange={setTargetEnvID}
            disabled={!targetProjectID}
            options={[
              { value: '', label: 'Select an environment…' },
              ...(targetEnvs.data ?? []).map((e) => ({
                value: e.id,
                label: `${e.name} · ${e.kind ?? e.type}`,
              })),
            ]}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-text font-semibold text-sm uppercase tracking-wider">
            Destination
          </h3>
          <p className="text-muted text-xs">
            Values will be written by the agent to your workload's
            secret store. Pick the provider connection bound to your
            source project.
          </p>
          <Select
            label="Provider connection"
            value={destProvConnID}
            onChange={setDestProvConnID}
            options={[
              { value: '', label: 'Select a provider connection…' },
              ...(provConns.data ?? []).map((c) => ({
                value: c.id,
                label: `${c.name} · ${c.type}`,
              })),
            ]}
          />
          {provConns.data && provConns.data.length === 0 && (
            <div className="rounded-lg border border-border/60 bg-bg/40 px-3 py-2 text-xs text-muted space-y-1">
              <div className="text-text font-medium">
                No provider connections are bound to this project / environment.
              </div>
              {hasPermission('integration.edit') ? (
                <div>
                  <Link
                    to="/admin/provider-connections"
                    className="text-accent hover:text-accent-bright underline"
                  >
                    Manage provider connections
                  </Link>{' '}
                  and bind one to this project to enable cross-team writes.
                </div>
              ) : (
                <div>
                  Ask your platform / admin team to bind a provider
                  connection to this project.
                </div>
              )}
            </div>
          )}
          <Field label="Secret reference">
            <input
              type="text"
              value={destSecretRef}
              onChange={(e) => setDestSecretRef(e.target.value)}
              placeholder="e.g. billing/prod/db"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
          </Field>
          <Field
            label="Keys to fill"
            hint={`${destKeys.length} key${destKeys.length === 1 ? '' : 's'} • comma- or space-separated`}
          >
            <input
              type="text"
              value={destKeysInput}
              onChange={(e) => setDestKeysInput(e.target.value)}
              placeholder="DB_PASSWORD, DB_USER"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
            {destKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {destKeys.map((k) => (
                  <span
                    key={k}
                    className="bg-accent/15 text-accent text-[11px] rounded-full px-2 py-0.5 font-mono"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </Field>
        </section>

        <section className="space-y-2">
          <Field
            label="Justification"
            hint={`${justification.trim().length} / 10 minimum`}
          >
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why does your workload need these values? (visible to approvers + value provider)"
              rows={3}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
          </Field>
        </section>

        {submitError && (
          <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 text-sm text-red-200">
            {submitError}
          </div>
        )}

        {!valid && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1">
            <div className="font-medium text-amber-100">
              Complete these to submit:
            </div>
            <ul className="list-disc list-inside space-y-0.5">
              {errors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void onSubmit()}
            disabled={!valid || submit.isPending}
          >
            {submit.isPending ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
          {label}
        </label>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Pulls a stable error code from an ApiError's body when the api
 * returned `{"code": "<slug>", "error": "..."}`. Used by the cross-team
 * 403 routing per §6 design.
 */
export function extractErrorCode(err: ApiError): string | undefined {
  if (err.body && typeof err.body === 'object') {
    const obj = err.body as { code?: unknown };
    if (typeof obj.code === 'string') return obj.code;
  }
  return undefined;
}
