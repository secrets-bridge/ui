/**
 * EPIC P — typed surface for the provider_connections admin API
 * (api#92, P1 / P2 / P3 merged).
 *
 *   POST   /api/v1/provider-connections                    create (admin)
 *   GET    /api/v1/provider-connections                    admin list  OR  developer dropdown
 *   GET    /api/v1/provider-connections/:id                get
 *   PUT    /api/v1/provider-connections/:id                update
 *   DELETE /api/v1/provider-connections/:id                delete
 *   POST   /api/v1/provider-connections/:id/discover-now   manual discover
 *   POST   /api/v1/provider-connections/:id/bindings       bind
 *   GET    /api/v1/provider-connections/:id/bindings       list bindings
 *   DELETE /api/v1/provider-connection-bindings/:bid       unbind
 *
 * Hard rules baked into the surface:
 *   - NO scope `value` field; the body is metadata only (handlers
 *     enforce credential + secret-shaped value refusal).
 *   - Shared GET branches inline on `project_id`. When absent the
 *     server runs the admin path; when present, the dropdown path
 *     (sanitized {id, name, type} only — see types.ts).
 *   - Every mutation invalidates `providerConnectionsKey.all` AND
 *     `['provider-connections']` (the cross-team dropdown's key).
 *     Binding ops also invalidate `providerConnectionsKey.bindings(id)`.
 *   - 19 stable error codes routed through
 *     `providerConnectionErrorMessage`; unknown codes fall through to
 *     the api's own message.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from './client';
import type {
  ProviderConnection,
  ProviderConnectionBinding,
  ProviderConnectionBindingInput,
  ProviderConnectionInput,
  ProviderConnectionSummary,
} from './types';

export const providerConnectionsKey = {
  all: ['provider-connections-admin'] as const,
  list: () => ['provider-connections-admin', 'list'] as const,
  one: (id: string) => ['provider-connections-admin', 'one', id] as const,
  bindings: (connectionID: string) =>
    ['provider-connections-admin', 'bindings', connectionID] as const,
};

const invalidateAfterMutation = (
  qc: ReturnType<typeof useQueryClient>,
  connectionID?: string,
) => {
  qc.invalidateQueries({ queryKey: providerConnectionsKey.all });
  // The cross-team dropdown uses the bare ['provider-connections']
  // key — keep them in sync on every mutation.
  qc.invalidateQueries({ queryKey: ['provider-connections'] });
  if (connectionID) {
    qc.invalidateQueries({
      queryKey: providerConnectionsKey.bindings(connectionID),
    });
  }
};

// --- Admin list + single ---------------------------------------------

/**
 * Admin list. Requires `integration.edit` per §4 sign-off. Returns the
 * FULL `ProviderConnection` projection (scope, auth_method, discovery
 * status). Without the permission the api returns 403 out_of_scope_project
 * — caller is expected to gate the route via `hasPermission`.
 */
export function useProviderConnectionsAdmin() {
  return useQuery({
    queryKey: providerConnectionsKey.list(),
    queryFn: () =>
      api.get<ProviderConnection[]>('/api/v1/provider-connections'),
    staleTime: 30_000,
  });
}

export function useProviderConnection(id: string | undefined) {
  return useQuery({
    queryKey: providerConnectionsKey.one(id ?? ''),
    queryFn: () =>
      api.get<ProviderConnection>(
        `/api/v1/provider-connections/${encodeURIComponent(id!)}`,
      ),
    enabled: !!id,
    staleTime: 30_000,
  });
}

// --- Create / Update / Delete ---------------------------------------

export function useCreateProviderConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProviderConnectionInput) =>
      api.post<ProviderConnection>('/api/v1/provider-connections', body),
    onSuccess: () => invalidateAfterMutation(qc),
  });
}

export function useUpdateProviderConnection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProviderConnectionInput) =>
      api.put<ProviderConnection>(
        `/api/v1/provider-connections/${encodeURIComponent(id)}`,
        body,
      ),
    onSuccess: () => invalidateAfterMutation(qc, id),
  });
}

export function useDeleteProviderConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(
        `/api/v1/provider-connections/${encodeURIComponent(id)}`,
      ),
    onSuccess: () => invalidateAfterMutation(qc),
  });
}

// --- Discovery -----------------------------------------------------

export interface DiscoverNowResponse {
  job_id: string;
  correlation_id: string;
}

export function useDiscoverNow(connectionID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<DiscoverNowResponse>(
        `/api/v1/provider-connections/${encodeURIComponent(connectionID)}/discover-now`,
      ),
    onSuccess: () => invalidateAfterMutation(qc, connectionID),
  });
}

// --- Bindings ------------------------------------------------------

export function useBindings(connectionID: string | undefined) {
  return useQuery({
    queryKey: providerConnectionsKey.bindings(connectionID ?? ''),
    queryFn: () =>
      api.get<ProviderConnectionBinding[]>(
        `/api/v1/provider-connections/${encodeURIComponent(connectionID!)}/bindings`,
      ),
    enabled: !!connectionID,
    staleTime: 30_000,
  });
}

export function useCreateBinding(connectionID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProviderConnectionBindingInput) =>
      api.post<ProviderConnectionBinding>(
        `/api/v1/provider-connections/${encodeURIComponent(connectionID)}/bindings`,
        body,
      ),
    onSuccess: () => invalidateAfterMutation(qc, connectionID),
  });
}

export function useDeleteBinding(connectionID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bindingID: string) =>
      api.delete<void>(
        `/api/v1/provider-connection-bindings/${encodeURIComponent(bindingID)}`,
      ),
    onSuccess: () => invalidateAfterMutation(qc, connectionID),
  });
}

// --- Developer dropdown (shared GET) -------------------------------

/**
 * Developer dropdown — calls the SAME `/provider-connections` URL as
 * `useProviderConnectionsAdmin`, but with `project_id` set so the api
 * branches to the sanitized projection (`{id, name, type}` only, see
 * §4 sign-off). When `environment_id` is also set, the api narrows to
 * env-specific + project-wide bindings; otherwise project-wide only.
 *
 * Per §6 envelope-error contract, calling this without
 * `secret.request` scoped to (project, env) returns
 * 403 out_of_scope_project. The N5 drawer renders the empty-state CTA
 * branched by caller permission.
 */
export function useProviderConnectionsForProject(
  projectID: string | undefined,
  environmentID?: string | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['provider-connections', projectID ?? 'none', environmentID ?? 'all'],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('project_id', projectID!);
      if (environmentID) qs.set('environment_id', environmentID);
      return api.get<ProviderConnectionSummary[]>(
        `/api/v1/provider-connections?${qs.toString()}`,
      );
    },
    enabled: opts?.enabled ?? !!projectID,
    staleTime: 30_000,
  });
}

// --- Stable error code router --------------------------------------

/**
 * 19 stable codes from EPIC P §6.A. Strings are user-facing.
 * Unknown codes fall through to `providerConnectionErrorMessage()`
 * returning undefined so the caller can use the api's own message.
 */
export const PROVIDER_CONNECTION_ERROR_MESSAGES: Record<string, string> = {
  connection_not_found: 'Provider connection not found.',
  connection_name_taken: 'A provider connection with this name already exists.',
  invalid_scope: 'Scope is invalid for this provider type.',
  invalid_auth_method:
    'Auth method is required and must be one of the values allowed for this provider type.',
  invalid_name: 'Name must match ^[a-z0-9][a-z0-9-]{0,119}$.',
  invalid_cluster_name: 'Cluster name is invalid.',
  credential_in_scope:
    'Scope contains a credential-shaped key. Use the agent’s workload identity instead.',
  secret_in_scope: 'Scope contains a value that looks like a secret.',
  invalid_provider_url: 'Provider URL is invalid.',
  invalid_role_arn: 'Role ARN is invalid.',
  description_too_long: 'Description is too long (500 character limit).',
  discover_requires_cluster:
    'Set a cluster_name before enabling discovery.',
  invalid_discover_interval:
    'Discover interval must be between 60 and 86400 seconds.',
  invalid_discover_status: 'Discovery status transition is not allowed.',
  connection_in_use:
    'Connection is in use by one or more projects or open requests.',
  connection_disabled: 'Connection is disabled.',
  binding_exists: 'This project/environment is already bound.',
  binding_not_found: 'Binding not found.',
  environment_not_in_project: 'Environment does not belong to this project.',
  project_id_required: 'A project_id is required.',
  discovery_already_running: 'Discovery is already running for this connection.',
  out_of_scope_project: "You don’t have access to this project.",
  // EPIC Q (api#99) — scoped binding codes.
  connection_not_self_service_bindable:
    'This connection is not enabled for self-service binding.',
  prod_binding_not_allowed_for_scope:
    'Production provider bindings are managed by the platform team.',
  out_of_scope_binding:
    "You don't have permission to bind on this project + environment.",
  environment_id_required: 'Pick an environment before binding.',
};

export function providerConnectionErrorMessage(
  code: string | undefined,
): string | undefined {
  if (!code) return undefined;
  return PROVIDER_CONNECTION_ERROR_MESSAGES[code];
}

/**
 * Extracts the stable `error_code` field from an EPIC P envelope
 * (`{error_code, message, ...}`), distinct from the legacy `code` field
 * the cross-team flow uses. Callers in P5 (admin page + form) read
 * THIS, not the cross-team `extractErrorCode`.
 */
export function extractProviderConnectionErrorCode(
  err: ApiError,
): string | undefined {
  if (err.body && typeof err.body === 'object') {
    const obj = err.body as { error_code?: unknown; code?: unknown };
    if (typeof obj.error_code === 'string') return obj.error_code;
    // Fall back to legacy `code` so endpoints not yet migrated to the
    // EPIC P envelope still route correctly.
    if (typeof obj.code === 'string') return obj.code;
  }
  return undefined;
}
