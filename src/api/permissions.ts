/**
 * Permission catalog API surface — wraps GET /api/v1/permissions.
 *
 * The catalog is a compile-time constant on the api side
 * (`internal/auth/permissions.go::Catalog`), so:
 *   - It's safe to cache aggressively. The api ships
 *     `Cache-Control: public, max-age=300`; we layer the same
 *     idea client-side with `staleTime: 5m`.
 *   - It never changes within a session unless the api is
 *     redeployed. No mutations exposed here.
 *
 * Forms hydrating their permission picker should use this hook
 * instead of unioning `useRoles().data[*].permissions` (the
 * interim pattern shipped in ui#6) — the catalog is the
 * authoritative source.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from './client';
import type { PermissionDescriptor } from './types';

export const permissionsKey = {
  all: ['permissions'] as const,
};

export function usePermissions() {
  return useQuery({
    queryKey: permissionsKey.all,
    queryFn: () => api.get<PermissionDescriptor[]>('/api/v1/permissions'),
    staleTime: 5 * 60 * 1000, // 5 minutes; matches the api's Cache-Control
  });
}
