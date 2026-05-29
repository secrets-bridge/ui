import { useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import type { Agent } from '../api/types';

/**
 * Agents list — smoke proof for GET /api/v1/agents. Real admin
 * actions (mint, revoke, view scope) land in a follow-up PR; this
 * page exists to verify the api client + auth + layout chain works
 * end-to-end against a live CP.
 */
export function Agents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api
      .get<Agent[]>('/api/v1/agents', { signal: ac.signal })
      .then(setAgents)
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof ApiError) setError(`${e.status}: ${e.message}`);
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, []);

  if (error) {
    return (
      <div className="bg-surface border border-red-500/40 rounded p-4 text-sm">
        <div className="text-red-400 font-medium">Failed to load agents</div>
        <div className="text-muted mt-1">{error}</div>
      </div>
    );
  }
  if (agents === null) {
    return <div className="text-muted text-sm">Loading…</div>;
  }
  if (agents.length === 0) {
    return (
      <div className="bg-surface border border-border rounded p-6 text-center">
        <div className="text-text font-medium">No agents registered</div>
        <div className="text-muted text-sm mt-2">
          Mint one with <code className="text-text">POST /api/v1/agents</code>.
        </div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded">
      <table className="w-full text-sm">
        <thead className="text-left text-muted text-xs uppercase">
          <tr className="border-b border-border">
            <th className="px-4 py-3 font-normal">Name</th>
            <th className="px-4 py-3 font-normal">Status</th>
            <th className="px-4 py-3 font-normal">Last seen</th>
            <th className="px-4 py-3 font-normal">Scope</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id} className="border-b border-border/50 last:border-0">
              <td className="px-4 py-3 text-text">{a.name}</td>
              <td className="px-4 py-3">
                <span
                  className={
                    a.status === 'active'
                      ? 'text-green-400'
                      : a.status === 'stale'
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }
                >
                  {a.status}
                </span>
              </td>
              <td className="px-4 py-3 text-muted">
                {a.last_seen_at ? new Date(a.last_seen_at).toLocaleString() : 'never'}
              </td>
              <td className="px-4 py-3 text-muted text-xs font-mono">
                {Object.entries(a.scope || {})
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
