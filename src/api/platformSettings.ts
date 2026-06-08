/**
 * R-follow-up #2 (api#113) — platform_settings API surface.
 *
 * Wraps the three admin routes the api side landed in api#123:
 *   GET  /api/v1/platform-settings           list whitelisted rows
 *   GET  /api/v1/platform-settings/:key      get one row
 *   PUT  /api/v1/platform-settings/:key      update one row
 *
 * Auth: all three routes are gated by `policy.edit` server-side. The
 * SPA's PlatformSettings admin page mounts under the same capability
 * helper so the hook fires only for legitimate users in practice.
 *
 * Mutation strategy (§3 correction 1): every successful update MUST
 * invalidate BOTH `platformSettingsKey.all` AND
 * `platformSettingsKey.one(key)`. The admin list page reads the bulk
 * cache, the Author drawer's live-cap consumer reads the per-key
 * cache, and the consumed cache key matters per call site. Missing
 * either invalidation leaves a stale read on the page that didn't
 * mutate.
 *
 * Cache posture: 30s staleTime + refetch-on-window-focus so an
 * operator who flipped the value in another tab sees the new cap when
 * they re-focus the Author drawer. Lower than the api's 5-min TTL
 * backstop so the SPA reflects pub/sub-driven updates faster than the
 * service-layer fallback.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type { PlatformSetting } from './types';

export const platformSettingsKey = {
  all: ['platform-settings'] as const,
  one: (key: string) => ['platform-settings', key] as const,
};

/**
 * Whitelisted v1 keys. v1 only ships `platform_reserved_priority`;
 * future keys land here as additional rows + matching const exports.
 */
export const KEY_PLATFORM_RESERVED_PRIORITY = 'platform_reserved_priority';

export function usePlatformSettings(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: platformSettingsKey.all,
    queryFn: () =>
      api.get<PlatformSetting[]>('/api/v1/platform-settings'),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function usePlatformSetting(
  key: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: platformSettingsKey.one(key),
    queryFn: () =>
      api.get<PlatformSetting>(`/api/v1/platform-settings/${key}`),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Narrowing wrapper around `usePlatformSetting('platform_reserved_priority')`.
 *
 * The Author drawer (`ProjectPolicies.tsx`) reads the cap through this
 * helper so the type-narrowing logic ("value is number, not unknown")
 * lives in exactly one place. §3 correction 2 — callers must treat
 * `isLoading` and `isError` as FAIL CLOSED: disable submission, NEVER
 * fall back to the historical hardcode of 9000. The cap is the only
 * thing keeping scoped authors out of the platform-reserved band, and
 * a stale fallback would defeat that gate.
 */
export function usePlatformReservedPriority() {
  const q = usePlatformSetting(KEY_PLATFORM_RESERVED_PRIORITY);
  const value =
    q.data && typeof q.data.value === 'number' ? q.data.value : undefined;
  return { ...q, value };
}

export function useUpdatePlatformSetting(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: unknown) =>
      api.put<PlatformSetting>(`/api/v1/platform-settings/${key}`, {
        value,
      }),
    onSuccess: () => {
      // §3 correction 1 — invalidate BOTH the list cache AND the
      // per-key cache. The admin page reads the list; the Author
      // drawer reads the per-key entry through usePlatformSetting.
      // Skipping either leaves one of them stale.
      qc.invalidateQueries({ queryKey: platformSettingsKey.all });
      qc.invalidateQueries({ queryKey: platformSettingsKey.one(key) });
    },
  });
}
