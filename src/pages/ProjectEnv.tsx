/**
 * Environment page (`/projects/:id/env/:env_id`): the secrets bound to
 * one project environment, and the provider connections that serve it.
 *
 * Each secret row offers what the person can do with it:
 *   - Reveal: non-production only, for holders of secret.reveal.direct.
 *     Opens the direct reveal drawer; policy approves it at once and
 *     the request page reveals the values behind the second factor.
 *   - Request: the Request access drawer, pre-filled with this secret.
 * The page header has one primary action, Request access, and a
 * secondary one for asking another team for a value (cross-team).
 *
 * Reads `/users/me` for the project and environment, and the
 * value-free env-secrets list (key names only).
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useEnvSecrets } from '../api/devSecrets';
import { useMe } from '../api/me';
import { useAuth } from '../auth/AuthContext';
import { groupBoundSecrets, type BoundSecret } from '../lib/boundSecrets';
import { providerLabel } from '../lib/providers';
import { requestRef } from '../lib/requestRef';
import { Banner } from '../ui/Banner';
import { Breadcrumb } from '../ui/Breadcrumb';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EntityMark } from '../ui/EntityMark';
import { EnvTag } from '../ui/EnvTag';
import { Keys } from '../ui/Keys';
import { Path } from '../ui/Path';
import { useToast } from '../ui/toastContext';
import { CrossTeamSubmitDrawer } from './CrossTeamSubmitDrawer';
import { DirectRevealDrawer } from './project/DirectRevealDrawer';
import { ProviderConnections } from './project/ProviderConnections';
import { RequestAccessDrawer, type RequestPrefill } from './RequestAccessDrawer';

type Open = { kind: 'reveal'; secret: BoundSecret } | { kind: 'request'; prefill: RequestPrefill } | { kind: 'cross-team' } | null;

const OPS: Record<string, string> = { read: 'Read', patch: 'Change' };

export function ProjectEnv() {
  const { id: projectId, env_id: envId } = useParams<{ id: string; env_id: string }>();
  const me = useMe();
  const secrets = useEnvSecrets(projectId, envId);
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);

  const project = me.data?.projects.find((p) => p.id === projectId);
  const env = project?.environments?.find((e) => e.id === envId);
  const title = project && env ? `${project.name} · ${env.name}` : 'Environment';

  // The h1 here carries an environment tag, so the page builds its own
  // header instead of PageHeader; keep the document title in step.
  useEffect(() => {
    document.title = `${title} · Secrets Bridge`;
  }, [title]);

  if (me.isLoading) {
    return (
      <div>
        <Breadcrumb items={[{ label: 'My projects', to: '/projects' }, { label: 'Environment' }]} />
        <p className="mt-4 text-muted">Loading…</p>
      </div>
    );
  }

  if (!project || !env) {
    return (
      <div>
        <Breadcrumb items={[{ label: 'My projects', to: '/projects' }, { label: 'Environment' }]} />
        <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
          You can't open this environment
        </h1>
        <Banner title="It doesn't exist, or your roles don't cover it.">
          <Link to="/projects" className="font-medium text-accent hover:underline">
            Back to My projects
          </Link>
        </Banner>
      </div>
    );
  }

  const prod = env.kind === 'prod';
  const canRequest = hasPermission('secret.request');
  const canReveal = !prod && hasPermission('secret.reveal.direct');
  const rows = groupBoundSecrets(secrets.data ?? []);
  const requestPrefill = (s?: BoundSecret): RequestPrefill => ({ projectId: project.id, envName: env.name, secretRef: s?.ref });

  const columns: Column<BoundSecret>[] = [
    {
      key: 'ref',
      header: 'Path',
      render: (s) => <Path value={s.ref} className="text-ink" />,
      className: 'max-w-[360px]',
    },
    { key: 'provider', header: 'Provider', render: (s) => providerLabel(s.provider), className: 'whitespace-nowrap' },
    { key: 'keys', header: 'Keys', render: (s) => <Keys keys={s.allKeys ? [] : s.keys} />, className: 'max-w-[240px]' },
    {
      key: 'ops',
      header: 'Allows',
      render: (s) => (s.ops.length ? s.ops.map((o) => OPS[o] ?? o).join(', ') : <span className="text-muted">Nothing</span>),
      className: 'whitespace-nowrap',
    },
  ];
  const actions = (s: BoundSecret) => (
    <span className="inline-flex gap-2">
      {canReveal && s.ops.includes('read') && (
        <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: 'reveal', secret: s })} aria-label={`Reveal ${s.ref}`}>
          Reveal
        </Button>
      )}
      {canRequest && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen({ kind: 'request', prefill: requestPrefill(s) })}
          aria-label={`Request access to ${s.ref}`}
        >
          Request
        </Button>
      )}
    </span>
  );
  if (canReveal || canRequest) {
    columns.push({ key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', className: 'whitespace-nowrap', render: actions });
  }

  const created = (id: string) => {
    setOpen(null);
    toast(`Request ${requestRef(id)} submitted.`, { to: `/requests/${id}`, label: 'Open it' });
  };

  return (
    <div>
      <Breadcrumb items={[{ label: 'My projects', to: '/projects' }, { label: project.name }, { label: env.name }]} />
      <div className="mb-6 mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 id="page-title" tabIndex={-1} className="flex flex-wrap items-center gap-x-3 gap-y-1 break-words text-console-title text-ink">
            <EntityMark name={project.name} size="lg" />
            <span>{project.name}</span> <EnvTag kind={env.kind}>{env.name}</EnvTag>
          </h1>
          <p className="mt-[3px] max-w-3xl text-ui font-normal text-muted">
            {prod
              ? 'Production. Values are read only through an approved request; direct reveal is blocked here.'
              : canReveal
                ? 'Non-production. Reveal a value directly when policy allows it, or request access for an approver to review.'
                : 'Non-production. Request access and an approver reviews it.'}{' '}
            Risk level {env.risk_level}.
          </p>
        </div>
        {canRequest && (
          <div className="flex flex-wrap items-center gap-2.5 max-[600px]:w-full max-[600px]:[&>button]:flex-1">
            <Button variant="secondary" onClick={() => setOpen({ kind: 'cross-team' })}>
              Ask another team
            </Button>
            <Button variant="primary" onClick={() => setOpen({ kind: 'request', prefill: requestPrefill() })}>
              Request access
            </Button>
          </div>
        )}
      </div>

      <section aria-labelledby="secrets-heading" className="mb-8">
        <h2 id="secrets-heading" className="mb-3 text-block-heading text-ink">
          Secrets
          <span className="ml-2 font-mono text-mono-small font-normal text-muted">{rows.length}</span>
        </h2>
        {secrets.isLoading && <p className="text-muted">Loading the secrets bound here…</p>}
        {secrets.isError && <Banner tone="error" title="Couldn't load the secrets bound here.">Try again in a moment.</Banner>}
        {secrets.data &&
          (rows.length > 0 ? (
            <DataTable
              label={`Secrets bound to ${title}`}
              columns={columns}
              rows={rows}
              rowKey={(s) => s.ref}
              minWidth={680}
              stacked={(s) => (
                <div className="flex flex-col gap-1.5">
                  <p><Path value={s.ref} className="text-ink" /></p>
                  <p className="text-caption text-muted">
                    {providerLabel(s.provider)} · {s.ops.map((o) => OPS[o] ?? o).join(', ') || 'Nothing allowed'}
                  </p>
                  <Keys keys={s.allKeys ? [] : s.keys} variant="chips" />
                  {(canReveal || canRequest) && <div className="mt-1">{actions(s)}</div>}
                </div>
              )}
            />
          ) : (
            <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">
              No secret is bound to this environment yet. A project admin binds them from the Secrets page.
            </p>
          ))}
        <p className="mt-2 text-caption text-muted">Paths and key names only. Values stay in the provider until an approved read runs.</p>
      </section>

      <ProviderConnections project={project} env={env} />

      {open?.kind === 'reveal' && (
        <DirectRevealDrawer
          project={project}
          env={env}
          secret={open.secret}
          onClose={() => setOpen(null)}
          onCreated={(id) => {
            setOpen(null);
            navigate(`/requests/${id}`);
          }}
          onRequestInstead={() => setOpen({ kind: 'request', prefill: requestPrefill(open.secret) })}
        />
      )}
      {open?.kind === 'request' && (
        <RequestAccessDrawer prefill={open.prefill} onClose={() => setOpen(null)} onCreated={created} />
      )}
      {open?.kind === 'cross-team' && (
        <CrossTeamSubmitDrawer sourceProject={project} sourceEnvironmentID={env.id} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
