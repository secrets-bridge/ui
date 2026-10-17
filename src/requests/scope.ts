/**
 * Scope filter shared by Overview and Requests.
 *
 * A scope is a project and one of its environments, as the request's
 * `target_scope` names them. The filter lists only the scopes the
 * signed-in user has (from /users/me), plus "All my scopes". It is a
 * filter, not a context switch: it narrows what the pages show and
 * every count recomputes from the filtered records. The choice lives in
 * memory for the session and is never stored.
 */

import { createContext, useContext, useMemo } from 'react';

import { useMe } from '../api/me';
import type { AccessRequest, MyProject } from '../api/types';

export const ALL_SCOPES = 'all';

export interface ScopeOption {
  value: string;
  label: string;
  projectId: string;
  projectName: string;
  envName: string;
  envKind: 'prod' | 'non_prod';
}

const scopeValue = (projectId: string, envName: string) => `${projectId}::${envName}`;

export function scopeOptions(projects: MyProject[] | undefined): ScopeOption[] {
  const out: ScopeOption[] = [];
  for (const p of projects ?? []) {
    if (p.status !== 'active') continue;
    for (const e of p.environments ?? []) {
      out.push({
        value: scopeValue(p.id, e.name),
        label: `${p.name} · ${e.name}`,
        projectId: p.id,
        projectName: p.name,
        envName: e.name,
        envKind: e.kind,
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The project id and environment name a request targets, if any. */
export function requestScope(r: AccessRequest): { projectId?: string; envName?: string } {
  const s = r.target_scope ?? {};
  return {
    projectId: s.project_id || r.source_project_id || undefined,
    envName: s.environment || undefined,
  };
}

export function inScope(r: AccessRequest, scope: string): boolean {
  if (scope === ALL_SCOPES) return true;
  const { projectId, envName } = requestScope(r);
  return !!projectId && !!envName && scopeValue(projectId, envName) === scope;
}

/** Display parts for a request's scope, resolved against /users/me. */
export interface ScopeDisplay {
  project: string;
  env?: string;
  envKind?: 'prod' | 'non_prod';
}

export function useScopeDisplay(): (r: AccessRequest) => ScopeDisplay {
  const me = useMe();
  return useMemo(() => {
    const byId = new Map((me.data?.projects ?? []).map((p) => [p.id, p]));
    return (r: AccessRequest) => {
      const { projectId, envName } = requestScope(r);
      const p = projectId ? byId.get(projectId) : undefined;
      const env = p?.environments?.find((e) => e.name === envName);
      return {
        project: p?.name ?? r.target_project_name ?? r.source_project_name ?? 'No project',
        env: envName,
        envKind: env?.kind,
      };
    };
  }, [me.data]);
}

export interface ScopeState {
  scope: string;
  setScope: (s: string) => void;
}

export const ScopeContext = createContext<ScopeState>({ scope: ALL_SCOPES, setScope: () => {} });

export function useScope(): ScopeState {
  return useContext(ScopeContext);
}
