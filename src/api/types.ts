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
