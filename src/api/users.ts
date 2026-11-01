/**
 * The admin user lookup (api#240).
 *
 *   GET /api/v1/users?ids=<id>,<id>   the named users, at most 100 a call
 *   GET /api/v1/users?q=<text>        email or display name contains the
 *                                     text (2+ characters, 20 results)
 *
 * Both need a global user_role.edit or team.edit. Anyone else keeps
 * seeing and typing raw user ids.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../auth/AuthContext';
import { api } from './client';

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  disabled: boolean;
}

export const USER_SEARCH_MIN = 2;
export const USER_SEARCH_MAX = 20;
const IDS_PER_CALL = 100;

export const usersKey = {
  search: (text: string) => ['users', 'search', text] as const,
  byIds: (ids: string[]) => ['users', 'by-ids', ids] as const,
};

export function useCanLookUpUsers(): boolean {
  const { hasGlobalPermission } = useAuth();
  return hasGlobalPermission('user_role.edit') || hasGlobalPermission('team.edit');
}

/** People whose name or email contains `text`. Waits for USER_SEARCH_MIN characters. */
export function useUserSearch(text: string) {
  return useQuery({
    queryKey: usersKey.search(text),
    queryFn: async () => (await api.get<{ users: UserSummary[] }>(`/api/v1/users?q=${encodeURIComponent(text)}`)).users,
    enabled: [...text].length >= USER_SEARCH_MIN,
  });
}

/** The people behind these ids, by id. An id it can't name is left out. */
export function useUsersByIds(ids: string[]): Map<string, UserSummary> {
  const canLookUp = useCanLookUpUsers();
  const wanted = [...new Set(ids)].sort();
  const found = useQuery({
    queryKey: usersKey.byIds(wanted),
    queryFn: async () => {
      const calls = [];
      for (let i = 0; i < wanted.length; i += IDS_PER_CALL) {
        const part = wanted.slice(i, i + IDS_PER_CALL).map(encodeURIComponent).join(',');
        calls.push(api.get<{ users: UserSummary[] }>(`/api/v1/users?ids=${part}`));
      }
      return (await Promise.all(calls)).flatMap((r) => r.users);
    },
    enabled: canLookUp && wanted.length > 0,
  });
  return useMemo(() => new Map((found.data ?? []).map((u) => [u.id, u])), [found.data]);
}

/** A person's name for a sentence: display name, then email, then the raw id. */
export function personName(id: string, person?: UserSummary): string {
  return person?.display_name || person?.email || id;
}
