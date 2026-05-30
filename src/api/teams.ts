/**
 * Team admin hooks. Wraps the api#49 endpoints:
 *
 *   POST   /teams                       create
 *   GET    /teams                       list
 *   GET    /teams/:id                   get
 *   PUT    /teams/:id                   update (name + parent + description)
 *   PUT    /teams/:id/status            archive ↔ activate
 *   DELETE /teams/:id                   hard-delete (409 if children)
 *   POST   /teams/:id/members           add member
 *   GET    /teams/:id/members           list members
 *   DELETE /teams/:id/members/:user_id  remove member
 *
 * Teams form an N-level hierarchy via parent_team_id; the api returns
 * a flat list and the UI assembles the tree client-side. Cache key is
 * shared across hooks so a mutation invalidates every view.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';

export interface Team {
  id: string;
  name: string;
  parent_team_id: string | null;
  status: 'active' | 'archived';
  description: string;
  created_at?: string;
  updated_at?: string;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  created_at: string;
  created_by?: string | null;
}

export interface CreateTeamInput {
  name: string;
  parent_team_id?: string | null;
  description?: string;
}

export interface UpdateTeamInput {
  name: string;
  description?: string;
  parent_team_id?: string | null;
}

export const teamsKey = {
  all: ['teams'] as const,
  one: (id: string) => ['teams', id] as const,
  members: (id: string) => ['teams', id, 'members'] as const,
};

export function useTeams() {
  return useQuery({
    queryKey: teamsKey.all,
    queryFn: () => api.get<Team[]>('/api/v1/teams'),
    staleTime: 30_000,
  });
}

export function useTeam(id: string | undefined) {
  return useQuery({
    queryKey: id ? teamsKey.one(id) : ['teams', 'unknown'],
    queryFn: () => api.get<Team>(`/api/v1/teams/${id}`),
    enabled: !!id,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTeamInput) => api.post<Team>('/api/v1/teams', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey.all }),
  });
}

export function useUpdateTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTeamInput) => api.put<Team>(`/api/v1/teams/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamsKey.all });
      qc.invalidateQueries({ queryKey: teamsKey.one(id) });
    },
  });
}

export function useUpdateTeamStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      api.put<void>(`/api/v1/teams/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamsKey.all });
      qc.invalidateQueries({ queryKey: teamsKey.one(id) });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/teams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey.all }),
  });
}

export function useTeamMembers(id: string | undefined) {
  return useQuery({
    queryKey: id ? teamsKey.members(id) : ['teams', 'unknown', 'members'],
    queryFn: () => api.get<TeamMember[]>(`/api/v1/teams/${id}/members`),
    enabled: !!id,
  });
}

export function useAddTeamMember(teamID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (user_id: string) =>
      api.post<void>(`/api/v1/teams/${teamID}/members`, { user_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey.members(teamID) }),
  });
}

export function useRemoveTeamMember(teamID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (user_id: string) =>
      api.delete<void>(`/api/v1/teams/${teamID}/members/${user_id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey.members(teamID) }),
  });
}

/**
 * buildTeamTree groups a flat list of teams into a parent → children
 * adjacency list. Used by the tree-style picker + Teams admin page.
 * Detached subtrees (parent points at a missing team) become root-level
 * for display so they remain editable.
 */
export interface TeamNode {
  team: Team;
  children: TeamNode[];
  depth: number;
}

export function buildTeamTree(teams: Team[]): TeamNode[] {
  const byParent = new Map<string | null, Team[]>();
  const ids = new Set(teams.map((t) => t.id));
  for (const t of teams) {
    // Treat orphan-parent rows as roots so they remain editable.
    const parent = t.parent_team_id && ids.has(t.parent_team_id) ? t.parent_team_id : null;
    const bucket = byParent.get(parent) ?? [];
    bucket.push(t);
    byParent.set(parent, bucket);
  }
  const sorted = (arr: Team[]) => [...arr].sort((a, b) => a.name.localeCompare(b.name));
  const walk = (parent: string | null, depth: number): TeamNode[] =>
    sorted(byParent.get(parent) ?? []).map((team) => ({
      team,
      children: walk(team.id, depth + 1),
      depth,
    }));
  return walk(null, 0);
}
