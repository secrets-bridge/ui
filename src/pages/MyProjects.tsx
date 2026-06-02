/**
 * Slice L5 — dev-facing "My Projects" landing page.
 *
 * Lists every project the caller has access to (filtered server-side
 * by team_members + perm scope on api/internal/handlers/me.go). Each
 * project card shows its environments as clickable nodes; clicking
 * an env navigates to ProjectEnv.tsx for the per-env actions.
 *
 * No mutation on this page — purely a discovery surface. Reveal /
 * Request actions live on the env detail page.
 */

import { Link } from 'react-router-dom';

import { useMe } from '../api/me';
import type { MyEnvironment } from '../api/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

export function MyProjects() {
  const me = useMe();
  const projects = me.data?.projects ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <PageHeader
        title="My Projects"
        description="Drill into a project's environment to request or reveal secrets."
      />

      {me.isLoading && (
        <Card>
          <CardBody>
            <p className="text-muted text-sm">Loading your projects…</p>
          </CardBody>
        </Card>
      )}

      {!me.isLoading && projects.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-muted text-sm">
              You are not currently a member of any project. Ask your team
              admin for a role assignment scoped to the project + environment
              you need.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <div className="min-w-0">
                <h3 className="text-text font-semibold text-base truncate">
                  {p.name}
                </h3>
                <p className="text-muted text-xs">{p.status}</p>
              </div>
            </CardHeader>
            <CardBody className="space-y-2">
              {(!p.environments || p.environments.length === 0) && (
                <p className="text-muted text-sm">
                  No environments configured yet.
                </p>
              )}
              {p.environments?.map((env) => (
                <EnvRow key={env.id} projectId={p.id} env={env} />
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EnvRow({ projectId, env }: { projectId: string; env: MyEnvironment }) {
  return (
    <Link
      to={`/projects/${projectId}/env/${env.id}`}
      className="flex items-center justify-between gap-3 bg-bg/40 hover:bg-bg/60 border border-border/60 rounded-lg px-3 py-2 transition-colors"
    >
      <div className="min-w-0">
        <div className="text-text text-sm font-medium truncate">{env.name}</div>
        <div className="text-muted text-xs">Risk level {env.risk_level}</div>
      </div>
      <KindBadge kind={env.kind} />
    </Link>
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
