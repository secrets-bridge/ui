/**
 * Argo CD history for a request (GET /requests/:id/gitops, requester
 * only). Before the Gateway took over Argo CD (secrets-bridge/gateway#13)
 * the control plane polled Argo CD itself; the rows it wrote stay
 * readable, each labelled history_context_only.
 *
 * The card is context, never the request's current state and never a
 * failure: it is muted, has no status colours and reads history_status,
 * not the legacy status. Current state is the Gateway panel. Hidden when
 * there are no rows.
 */

import { type GitOpsHistoryStatus, useRequestGitOps } from '../../api/requests';
import { formatExact } from '../../lib/time';

const HISTORY_STATUS: Record<GitOpsHistoryStatus, string> = {
  argocd_healthy_synced_context_only: 'Argo CD reported healthy and synced',
  timed_out_unverified: 'Timed out before Argo CD settled',
  failed: 'Argo CD reported an operation error',
  not_completed_poller_removed: 'Not completed, the old poller was removed',
};

export function GitOpsCard({ query }: { query: ReturnType<typeof useRequestGitOps> }) {
  const rows = query.data ?? [];
  if (query.isLoading || query.isError || rows.length === 0) return null;
  return (
    <section className="rounded-md border border-border bg-sunken" aria-labelledby="argocd-history-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule px-5 py-3.5">
        <h2 id="argocd-history-heading" className="text-block-heading text-muted">
          Argo CD history (before the Gateway)
        </h2>
        <span className="text-caption text-muted">{rows.every((o) => o.label === 'history_context_only') ? 'context only' : 'history'}</span>
      </div>
      <p className="px-5 pt-3 text-caption text-muted">
        Recorded by the control plane before the Gateway observed Argo CD. It was never linked to this change and is not
        proof that the value reached the app. The Gateway panel shows the current state.
      </p>
      <ul className="m-0 list-none p-0">
        {rows.map((o) => {
          const when = o.terminal_at ?? o.last_polled_at;
          return (
            <li key={o.id} className="border-t border-rule px-5 py-3 first:border-t-0">
              <p className="font-mono text-mono text-muted">
                {o.application_namespace ? `${o.application_namespace}/` : ''}
                {o.application_name}
              </p>
              <p className="mt-1 text-caption text-muted">
                {HISTORY_STATUS[o.history_status] ?? o.history_status.replace(/_/g, ' ')}
                {when ? ` · ${formatExact(when)}` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
