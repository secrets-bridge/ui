/**
 * Typed shapes of CP API responses. Hand-maintained for now; a future
 * PR can swap to OpenAPI codegen once the api repo publishes a spec.
 *
 * Hard rule: NO field on any type below may carry a secret value. The
 * types are metadata-only — `value` / `plaintext` / `token` are never
 * present in JSON shapes the UI consumes.
 */

export interface Agent {
  id: string;
  name: string;
  scope: Record<string, unknown>;
  status: 'active' | 'stale' | 'revoked';
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  owner_team_id: string | null;
  status: 'active' | 'archived';
}

export interface AccessRequest {
  id: string;
  requester_id: string;
  type: 'patch' | 'read';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'executed' | 'failed';
  justification: string;
  target_provider_type: string;
  target_secret_ref: string;
  target_keys: string[];
  workflow_id: string | null;
  created_at: string;
}

/**
 * Workflow definition — `workflow_definitions` table on the api side.
 * Mirrors `internal/handlers/admin.go::WorkflowBody`.
 *
 * `is_system` rows ship as seed data (e.g. the `standard` default
 * workflow). They are editable but NOT deletable — DELETE returns 409
 * and the UI surfaces that as a disabled action.
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  min_approvers: number;
  approver_role_id?: string | null;
  wrap_ttl_created_seconds: number;
  wrap_ttl_approved_seconds: number;
  wrap_ttl_claimed_seconds: number;
  request_ttl_seconds: number;
  require_justification: boolean;
  allow_self_approval: boolean;
  notification_channels: string[];
  is_default?: boolean;
  enabled: boolean;
  is_system?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Body shape for POST / PUT. The api accepts the same shape for both
 * (modulo `id`, which the URL carries on PUT). `is_default` and
 * `is_system` are server-managed — the form omits them.
 */
export interface WorkflowInput {
  name: string;
  description?: string;
  min_approvers: number;
  wrap_ttl_created_seconds: number;
  wrap_ttl_approved_seconds: number;
  wrap_ttl_claimed_seconds: number;
  request_ttl_seconds: number;
  require_justification: boolean;
  allow_self_approval: boolean;
  notification_channels: string[];
  enabled: boolean;
}

/**
 * Role — bundle of permission strings users can be granted.
 * Mirrors `api/internal/handlers/admin.go::RoleBody`.
 *
 * IMPORTANT api constraint: after create, ONLY `permissions` is
 * editable (via `PUT /roles/:id/permissions`). Name and description
 * are immutable. The form respects this by making those fields
 * read-only on edit.
 */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  is_system?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Body for POST /roles. */
export interface RoleCreateInput {
  name: string;
  description?: string;
  permissions: string[];
}

/** Body for PUT /roles/:id/permissions. */
export interface RolePermissionsInput {
  permissions: string[];
}

/**
 * Policy rule — `policy_rules` table on the api side. Mirrors
 * `internal/handlers/admin.go::PolicyBody`.
 *
 * Selector shape: keys present must match the incoming request; absent
 * keys are wildcards. The documented dimensions are `project_id`,
 * `environment`, `provider_type`, `secret_ref_prefix` (prefix-match for
 * the last, exact for the others).
 *
 * Higher `priority` wins on overlap. The seed `match-all` policy lives
 * at priority 0 with an empty selector + `is_system: true`; any
 * operator rule at priority ≥ 100 takes precedence.
 *
 * Unlike Roles, Policies are full-mutation: name + selector + workflow
 * + priority + enabled all editable via `PUT /policies/:id`. The form
 * mirrors that — no readOnly inputs in edit mode.
 */
export interface Policy {
  id: string;
  name: string;
  selector: Record<string, string>;
  workflow_id: string;
  priority: number;
  enabled: boolean;
  is_system?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Body shape for POST + PUT /policies. */
export interface PolicyInput {
  name: string;
  selector: Record<string, string>;
  workflow_id: string;
  priority: number;
  enabled: boolean;
}

/**
 * ArgoCD endpoint (BRD §26 — read-only GitOps visibility integration).
 * Mirrors `internal/handlers/gitops.go::argocdEndpointResponse`.
 *
 * Token handling: the plaintext ArgoCD account token is base64-encoded
 * + sent ONCE on create (POST body). The api envelope-encrypts it
 * before persisting; no response shape on the platform ever returns
 * it again. To rotate the token, delete + recreate the endpoint.
 *
 * Update endpoints are intentionally narrow:
 *   - PUT /argocd-endpoints/:id/enabled  → toggle the `enabled` flag
 *   - DELETE /argocd-endpoints/:id       → soft-delete
 * There is no PUT for the other fields. That keeps the token's
 * write-once posture honest — the only way to change connection
 * settings is to delete + recreate.
 */
export interface ArgoCDEndpoint {
  id: string;
  name: string;
  environment_id?: string;
  base_url: string;
  tls_server_name?: string;
  enabled: boolean;
  last_health_at?: string;
  health_error?: string;
  kms_key_id: string;
}

/** Body for POST /argocd-endpoints. */
export interface ArgoCDEndpointInput {
  name: string;
  environment_id?: string;
  base_url: string;
  /** Base64-encoded plaintext ArgoCD account token. Set ONCE, never returned. */
  token_b64: string;
  tls_ca_pem?: string;
  tls_server_name?: string;
}

/**
 * GitOps app mapping — binds an ArgoCD application to the platform's
 * notion of "this is the workload that consumes secret X". Used by
 * the worker's gitops-poller to know which app to query for sync
 * status after a request transitions to `executed`.
 *
 * Mirrors `internal/handlers/gitops.go::gitopsMappingResponse`. No
 * update endpoint exists; mappings are create-only + delete-only.
 */
export interface GitOpsAppMapping {
  id: string;
  secret_mapping_id?: string;
  provider_connection_id?: string;
  argocd_endpoint_id: string;
  application_name: string;
  application_namespace?: string;
  project_name?: string;
  cluster_name?: string;
  enabled: boolean;
}

/** Body for POST /gitops-app-mappings. */
export interface GitOpsAppMappingInput {
  argocd_endpoint_id: string;
  application_name: string;
  application_namespace?: string;
  project_name?: string;
  cluster_name?: string;
  secret_mapping_id?: string;
  provider_connection_id?: string;
}

/**
 * Permission descriptor — one row of the catalog returned by
 * GET /api/v1/permissions. The canonical source for "what permissions
 * exist on this platform" (curated in api/internal/auth/permissions.go).
 *
 * The Roles admin picker hydrates from this endpoint instead of
 * guessing from observed role data. Order in the response is
 * presentation-stable; respect it when rendering chips.
 *
 * Strings outside this catalog are accepted by the api today but
 * won't gate any handler until api#27 (P0-2 RBAC enforcement) lands.
 */
export interface PermissionDescriptor {
  key: string;
  group: string;        // "RBAC" | "Workflows" | "Agents" | "Secrets" | "Observability" | "Integrations"
  description: string;
}
