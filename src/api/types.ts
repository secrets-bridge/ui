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
