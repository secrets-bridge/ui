/**
 * Read-only ArgoCD observations for a request. Shown only when the
 * GitOps integration is on (SB_GITOPS_ENABLED; the endpoint answers 404
 * when it is off) and the request has observations.
 */

import { useRequestGitOps } from '../../api/requests';
import { StatusPill } from '../../ui/StatusPill';

export function GitOpsCard({ query }: { query: ReturnType<typeof useRequestGitOps> }) {
  const rows = query.data ?? [];
  if (query.isLoading || query.isError || rows.length === 0) return null;
  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule px-5 py-3.5">
        <h2 className="text-block-heading text-ink">GitOps observations</h2>
        <span className="text-caption text-muted">read-only</span>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map((o) => (
          <li key={o.id} className="border-t border-rule px-5 py-3 first:border-t-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-mono">{o.application_name}</span>
              <StatusPill
                variant={
                  o.status === 'applied'
                    ? 'approved'
                    : o.status === 'failed'
                      ? 'rejected'
                      : o.status === 'applied_unverified'
                        ? 'warning'
                        : 'pending'
                }
                tone="outline"
              >
                {o.status.replace(/_/g, ' ')}
              </StatusPill>
            </div>
            <p className="mt-1 font-mono text-mono-small text-muted">
              ArgoCD project {o.project_name ?? '—'} · cluster {o.cluster_name ?? '—'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
