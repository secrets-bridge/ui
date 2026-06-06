/**
 * Slice L5 — env detail page rooted at /projects/:id/env/:env_id.
 *
 * Lists the secret keys bound to this (project, env) pair via
 * project_secrets.environment_id (Slice L3). Per-row CTAs:
 *
 *   non_prod env + caller has secret.reveal.direct + policy allows
 *     → "Reveal" (POST /direct-reveal); returns auto-approved request
 *       id; UI polls for wraps (Slice M will replace this with the
 *       bulk reveal session page)
 *   otherwise
 *     → "Request access" (POST /request); standard approval lifecycle
 *
 * The page doesn't pre-fetch the policy decision per row — instead
 * it sends BOTH attempts and surfaces the api's 403 with a useful
 * message when direct-reveal is denied (env.kind=prod, policy not
 * opt-in, or perm missing).
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  useDirectReveal,
  useEnvSecrets,
  useSubmitEnvRequest,
  type EnvSecretKey,
} from '../api/devSecrets';
import { useMe } from '../api/me';
import { useAuth } from '../auth/AuthContext';
import type { MyEnvironment, MyProject } from '../api/types';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';
import { CrossTeamSubmitDrawer } from './CrossTeamSubmitDrawer';

export function ProjectEnv() {
  const { id: projectId, env_id: envId } = useParams<{ id: string; env_id: string }>();
  const me = useMe();
  const secrets = useEnvSecrets(projectId, envId);
  const { hasPermission } = useAuth();
  const [crossTeamOpen, setCrossTeamOpen] = useState(false);

  const project = me.data?.projects.find((p) => p.id === projectId);
  const env = project?.environments?.find((e) => e.id === envId);

  // Slice N5 — third CTA shows when the caller can submit cross-team
  // requests. The permission is independent of the per-row Reveal /
  // Request access perms.
  const showCrossTeamCTA = hasPermission('secret.request');

  if (me.isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-muted text-sm">Loading…</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!project || !env) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <PageHeader title="Environment not found" />
        <Card>
          <CardBody>
            <p className="text-muted text-sm">
              The project or environment you're looking for isn't visible to
              this account.{' '}
              <Link to="/projects" className="text-accent underline">
                Back to My Projects
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const rows = secrets.data ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <PageHeader
        title={`${project.name} · ${env.name}`}
        actions={
          <span className="flex items-center gap-2">
            <KindBadge kind={env.kind} />
            <span className="text-muted text-xs">
              Risk level {env.risk_level}
            </span>
          </span>
        }
      />

      {showCrossTeamCTA && (
        <Card>
          <CardBody className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-text font-semibold text-sm">
                Need a value from another team?
              </h3>
              <p className="text-muted text-xs mt-0.5">
                Open a cross-team request: another team's value provider
                fills it, an approver verifies, then the agent writes it
                to your provider.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCrossTeamOpen(true)}
            >
              New cross-team request
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">Secrets</h3>
          <span className="text-muted text-xs">
            {rows.length} {rows.length === 1 ? 'binding' : 'bindings'}
          </span>
        </CardHeader>
        <CardBody className="space-y-3">
          {secrets.isLoading && (
            <p className="text-muted text-sm">Loading bindings…</p>
          )}
          {!secrets.isLoading && rows.length === 0 && (
            <p className="text-muted text-sm">
              No secrets bound to this environment yet. Ask your project admin
              to bind one via the Secrets admin page.
            </p>
          )}
          {rows.map((row, idx) => (
            <SecretRow
              key={`${row.secret_id}-${row.key_name}-${idx}`}
              projectId={projectId!}
              envId={envId!}
              env={env}
              row={row}
            />
          ))}
        </CardBody>
      </Card>

      {crossTeamOpen && (
        <CrossTeamSubmitDrawer
          sourceProject={project as MyProject}
          sourceEnvironmentID={envId}
          onClose={() => setCrossTeamOpen(false)}
        />
      )}
    </div>
  );
}

function SecretRow({
  projectId,
  envId,
  env,
  row,
}: {
  projectId: string;
  envId: string;
  env: MyEnvironment;
  row: EnvSecretKey;
}) {
  const navigate = useNavigate();
  const directReveal = useDirectReveal(projectId, envId);
  const submitRequest = useSubmitEnvRequest(projectId, envId);

  const [justification, setJustification] = useState('');
  const [open, setOpen] = useState<'reveal' | 'request' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // CTA pre-selection. PROD always routes through request flow.
  const defaultMode: 'reveal' | 'request' = env.kind === 'prod' ? 'request' : 'reveal';

  const targetKeys = row.key_name ? [row.key_name] : undefined;

  const submit = async (mode: 'reveal' | 'request') => {
    setSubmitError(null);
    const body = {
      target_provider_type: row.provider_type,
      target_secret_ref: row.secret_ref,
      target_keys: targetKeys,
      justification: justification.trim(),
    };
    try {
      const resp =
        mode === 'reveal'
          ? await directReveal.mutateAsync(body)
          : await submitRequest.mutateAsync(body);
      // Reveal (auto-approved) → bulk reveal session page (Slice M4).
      // Request (pending approval) → request detail page where the
      // user sees approval state + can come back later to reveal.
      if (mode === 'reveal') {
        navigate(`/projects/${projectId}/env/${envId}/reveal/${resp.request_id}`);
      } else {
        navigate(`/requests/${resp.request_id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.status} · ${err.message}`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError(String(err));
      }
    }
  };

  const busy = directReveal.isPending || submitRequest.isPending;

  return (
    <div className="bg-bg/40 border border-border/60 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-text text-sm truncate">
            {row.key_name || '(all keys)'}
          </div>
          <div className="text-muted text-xs truncate">
            {row.provider_type} · {row.secret_ref}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {env.kind !== 'prod' && row.allowed_ops.includes('read') && (
            <Button
              variant={defaultMode === 'reveal' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setOpen(open === 'reveal' ? null : 'reveal')}
              disabled={busy}
            >
              Reveal
            </Button>
          )}
          {row.allowed_ops.includes('read') && (
            <Button
              variant={defaultMode === 'request' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setOpen(open === 'request' ? null : 'request')}
              disabled={busy}
            >
              Request access
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
          <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
            Justification
          </label>
          <input
            type="text"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder={
              open === 'reveal'
                ? 'Why do you need to view this secret right now?'
                : 'Why are you requesting access? (visible to approvers)'
            }
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          />
          {submitError && (
            <p className="text-red-300 text-xs">{submitError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => submit(open)}
              disabled={busy || justification.trim().length < 3}
            >
              {busy ? 'Submitting…' : open === 'reveal' ? 'Reveal now' : 'Submit request'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: MyEnvironment['kind'] }) {
  if (kind === 'prod') {
    return (
      <StatusPill variant="accent" tone="outline">
        prod
      </StatusPill>
    );
  }
  return (
    <StatusPill variant="neutral" tone="outline">
      non_prod
    </StatusPill>
  );
}
