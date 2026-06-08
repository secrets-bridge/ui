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

/**
 * Project — top-level tenancy boundary (BRD §17). Mirrors
 * `api/internal/handlers/tenancy.go::projectBody`.
 *
 * Soft-delete model: there's no DELETE endpoint. Status flips between
 * `active` and `archived`. Archived projects stay in the list but are
 * visually de-emphasized; they remain referenced by historical
 * requests, role assignments, and gitops mappings.
 */
export interface Project {
  id: string;
  name: string;
  owner_team_id?: string;
  status: 'active' | 'archived';
  created_at?: string;
  updated_at?: string;
}

/** Body shape for POST /projects. */
export interface ProjectInput {
  name: string;
  owner_team_id?: string;
}

/**
 * Slice L4 — per-env shape returned alongside a project on
 * `/users/me/projects` (api#80). The SPA renders these as drilldown
 * nodes under each project in the sidebar tree and uses `kind` to
 * pick the right CTA on the project page (Reveal vs Request).
 */
export interface MyEnvironment {
  id: string;
  name: string;
  /** Hard safety classification from Slice L1. */
  kind: 'non_prod' | 'prod';
  risk_level: number;
}

/**
 * Caller-scoped project projection used by GET /users/me/projects.
 * Drives the UI's project switcher dropdown (admin sees all, scoped
 * callers see their granted set). See api#43 Slice D.
 *
 * Slice L4 added the `environments` field. The list is present when
 * the server is L4+ (always today); when absent, the SPA renders the
 * project as a leaf with no drilldown.
 */
export interface MyProject {
  id: string;
  name: string;
  status: 'active' | 'archived';
  environments?: MyEnvironment[];
}

/**
 * Slim team shape used by GET /users/me. Direct memberships only;
 * hierarchical access (section head seeing reports' subtree) is
 * computed server-side via the team-scope resolver and is NOT
 * enumerated here.
 */
export interface MeTeam {
  id: string;
  name: string;
  parent_team_id: string | null;
  status: 'active' | 'archived';
}

/**
 * Response shape of GET /api/v1/users/me. Single round-trip
 * post-login hydration: identity + nav-gating permissions + tenancy
 * boundaries. AuthProvider auto-fetches this whenever a token lands
 * (login or sessionStorage hydration on reload) and merges the result
 * into the Identity stored on context.
 *
 * `permissions` is the deduped set across every active role grant.
 * UI gates sidebar items + action buttons by membership in this set
 * via `useAuth().hasPermission(key)`.
 */
export interface MeResponse {
  id: string;
  email: string;
  display_name: string;
  permissions: string[];
  teams: MeTeam[];
  projects: MyProject[];
  // True when the user has at least one MFA factor (TOTP or
  // WebAuthn) enrolled. Slice H5 / api#67. SPA reads this after
  // login to decide whether to nudge the user toward /me/mfa;
  // the api's step-up middleware uses the same check to return
  // 412 mfa_enrollment_required on Tier-2 ops when the user has
  // no factor.
  mfa_enrolled: boolean;
}

/**
 * Project ↔ secret binding (api#43 Slices A + C). One project can be
 * bound to many secrets, and the same secret can be bound to many
 * projects. The pair (project_id, secret_id) is unique.
 *
 * `allowed_keys`:
 *   - `null`           → every key the secret exposes is allowed
 *   - non-null array   → explicit allowlist; submit refuses any key
 *                        outside this set with 403 `out_of_scope_key`
 *
 * `allowed_ops`:
 *   - subset of {`read`, `patch`, `discover`}; submit refuses any op
 *     outside this set with 403 `out_of_scope_op`
 *
 * `secret` is populated on List/Bind responses so the UI doesn't have
 * to do a second fetch per row.
 */
export interface ProjectSecretBinding {
  project_id: string;
  secret_id: string;
  allowed_keys: string[] | null;
  allowed_ops: string[];
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  secret?: {
    id: string;
    cluster_name: string;
    provider_type: string;
    secret_ref: string;
    status: string;
    labels?: Record<string, string>;
  };
}

/**
 * EPIC P — Provider Connection (admin projection).
 * Returned by GET /provider-connections (admin path) + GET /:id.
 * NEVER carries credentials in any field; `scope` is metadata only.
 */
export interface ProviderConnection {
  id: string;
  name: string;
  type: string;
  cluster_name?: string;
  description?: string;
  status: 'active' | 'disabled';
  scope: Record<string, unknown>;
  auth_method?: string;
  discover_enabled: boolean;
  discover_interval_seconds: number;
  last_discover_at?: string | null;
  last_discover_status?: 'success' | 'failure' | 'running' | null;
  last_discover_started_at?: string | null;
  last_discover_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Body shape for POST /provider-connections + PUT /:id.
 * `type` immutable post-create per §5 sign-off; the edit form
 * disables it. `name` editable. `scope` metadata only — handlers +
 * service enforce credential-shaped + secret-shaped value refusal.
 */
export interface ProviderConnectionInput {
  name: string;
  type: string;
  cluster_name?: string;
  description?: string;
  status?: 'active' | 'disabled';
  scope: Record<string, unknown>;
  auth_method?: string;
  discover_enabled?: boolean;
  discover_interval_seconds?: number;
}

/**
 * Sanitized projection returned by GET /provider-connections when
 * `project_id` is present (developer dropdown path). Per §4 lock the
 * projection includes ONLY {id, name, type} — no scope, no auth_method,
 * no discovery fields, no cluster_name. Powers the cross-team submit
 * drawer's destination dropdown.
 */
export interface ProviderConnectionSummary {
  id: string;
  name: string;
  type: string;
}

/**
 * Project/env binding for a provider connection. Listed under the
 * connection's "Bindings" sub-panel in the edit drawer. `environment_id`
 * absent (or null) means the binding covers every environment in the
 * project (project-wide binding); present means it's scoped to one env.
 */
export interface ProviderConnectionBinding {
  id: string;
  provider_connection_id: string;
  project_id: string;
  environment_id?: string | null;
  project_name?: string;
  environment_name?: string;
  created_at?: string;
}

/** Body shape for POST /provider-connections/:id/bindings. */
export interface ProviderConnectionBindingInput {
  project_id: string;
  environment_id?: string | null;
}

/**
 * EPIC Q (api#99) — joined binding response from
 * GET /projects/:id/provider-connection-bindings. The api joins to
 * environments + provider_connections server-side so the per-project
 * card renders in one round-trip. Sanitized projection: NO scope,
 * NO auth_method, NO discovery fields.
 */
export interface ProjectProviderConnectionBinding {
  id: string;
  provider_connection_id: string;
  project_id: string;
  environment_id: string | null;
  environment_name?: string;
  environment_kind?: 'non_prod' | 'prod';
  connection_name?: string;
  connection_type?: string;
  purpose?: string;
  created_at?: string;
}

/** Body shape for POST /projects/:id/provider-connection-bindings. */
export interface ProjectProviderConnectionBindingInput {
  provider_connection_id: string;
  environment_id: string; // REQUIRED — scoped binders never create project-wide bindings.
}

/**
 * Body returned with a 409 connection_in_use response. Drives the
 * "Delete anyway" disabled state in the delete confirm modal.
 */
export interface ConnectionInUseBody {
  error_code: 'connection_in_use';
  message: string;
  bindings_count: number;
  open_requests_count: number;
}

/** Body shape for POST /projects/:id/secrets. */
export interface ProjectSecretBindingInput {
  secret_id: string;
  allowed_keys?: string[] | null;
  allowed_ops?: string[];
  created_by?: string;
}

/** Body shape for PUT /projects/:id/secrets/:secret_id. */
export interface ProjectSecretBindingUpdate {
  allowed_keys?: string[] | null;
  allowed_ops?: string[];
}

/**
 * Environment — lifecycle boundary within a project (BRD §17). One
 * project carries N environments (`dev`, `uat`, `staging`, `prod`,
 * `other`). Mirrors `api/internal/handlers/tenancy.go::environmentBody`.
 *
 * Unique within a project: a project can't have two `uat`
 * environments, but two projects CAN each have their own `uat`.
 *
 * Hard-delete model (unlike Project). Cheap to recreate; no FK
 * ownership downstream. `user_roles.scope` jsonb references envs by
 * name, not FK.
 */
export interface Environment {
  id: string;
  project_id: string;
  name: string;
  type: 'dev' | 'staging' | 'uat' | 'prod' | 'other';
  created_at?: string;
  updated_at?: string;
}

/** Body shape for POST /environments. */
export interface EnvironmentInput {
  project_id: string;
  name: string;
  type: Environment['type'];
}

export interface AccessRequest {
  id: string;
  requester_id: string;
  type: 'patch' | 'read' | 'cross_team';
  status:
    | 'pending'
    | 'pending_values'
    | 'pending_verification'
    | 'approved'
    | 'rejected'
    | 'refused'
    | 'cancelled'
    | 'expired'
    | 'executed'
    | 'failed';
  justification: string;
  target_provider_type: string;
  target_secret_ref: string;
  target_keys: string[];
  target_provider_config?: Record<string, unknown>;
  target_scope?: Record<string, string>;
  workflow_id: string | null;
  reject_reason?: string;
  job_id?: string | null;
  created_at: string;
  updated_at?: string;
  approvals?: Approval[];

  // ---- Slice N: cross_team-only fields. Absent on patch/read rows.
  /** Team the request was assigned to for value provision. */
  target_team_id?: string;
  target_team_name?: string;
  /** Project the request was assigned to (within target team). */
  target_project_id?: string;
  target_project_name?: string;
  target_environment_id?: string;
  target_environment_name?: string;
  /** Where Team B's values will be written by the agent. */
  destination_provider_connection_id?: string;
  destination_provider_label?: string;
  destination_secret_ref?: string;
  destination_keys?: string[];
  /** Source project (the requester's project). */
  source_project_id?: string;
  source_project_name?: string;
  /** Workflow semantics frozen at submit. */
  snap_requires_security_approval?: boolean;
  snap_min_approvers?: number;
  /** Fill window. */
  fill_expires_at?: string;
  filled_by_user_id?: string;
  filled_at?: string;
  fill_comment?: string;
  refused_by_user_id?: string;
  refused_at?: string;
}

/**
 * Approval — a single vote on a request. Returned inline with the
 * request via GET /requests/:id. Append-only; one row per
 * (request_id, approver_id) pair.
 */
export interface Approval {
  id: string;
  request_id: string;
  approver_id: string;
  decision: 'approve' | 'reject';
  comment?: string;
  created_at: string;
}

/** Body shape for POST /requests/read. Values never leave the user. */
export interface ReadRequestInput {
  requester_id: string;
  project_id?: string;
  environment?: string;
  target_provider_type: string;
  target_provider_config?: Record<string, unknown>;
  target_secret_ref: string;
  target_keys?: string[];
  justification: string;
}

/**
 * Body shape for POST /requests (patch flow). `key_values` carries one
 * plaintext per key the user wants to write. The api wraps each value
 * before it touches Postgres — but on the wire it's a plain string
 * over TLS (with optional Piece 8b agent-side envelope when the agent
 * has a registered keypair).
 *
 * Hard rule: the form MUST clear key_values from local state
 * immediately after the submit promise settles.
 */
export interface PatchRequestInput {
  requester_id: string;
  project_id?: string;
  environment?: string;
  target_provider_type: string;
  target_provider_config?: Record<string, unknown>;
  target_secret_ref: string;
  key_values: Record<string, string>;
  justification: string;
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
  /**
   * R-follow-up #1 (api#118) — opt-in flag exposing this workflow to
   * scoped policy authors on `/projects/:id/policies`. Default `false`.
   * Optional for rolling-deploy safety: the api always returns the
   * field, but older api responses (pre-migration 0035) won't have
   * it. SPA reads it for the [scoped] chip on the admin Workflows
   * list + the WorkflowForm checkbox initial value.
   */
  scoped_policy_authorable?: boolean;
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
  /**
   * R-follow-up #1 (api#118) — explicit opt-in for the scoped policy
   * authoring surface. `true` / `false` flip the flag; `null` or
   * `undefined` PRESERVES the current value on PUT (the api does a
   * Get-then-merge when the field is omitted).
   *
   * §3 safety correction: the WorkflowForm MUST NOT default this to
   * `false` on edit when the loaded Workflow object has no
   * `scoped_policy_authorable` field (older api response during
   * rolling deploy). It must omit the field from the PUT body so the
   * api preserves whatever is in the DB. The form only sends an
   * explicit value when the admin TOUCHED the checkbox during edit.
   *
   * On Create, the form defaults to `false` (default-deny) and
   * always sends the value.
   */
  scoped_policy_authorable?: boolean | null;
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
 * UserRole — one RBAC assignment (BRD §17). Binds a user to a role,
 * optionally narrowed by `scope`. Mirrors
 * `api/internal/handlers/admin.go::UserRoleBody`.
 *
 * Scope shape (all keys optional; empty = global):
 *   - project_id          UUID — narrow to one project
 *   - environment         text — narrow to one env name (e.g. "prod")
 *   - secret_ref_prefix   text — narrow to a ref prefix
 *   - provider_type       text — narrow to one provider type
 *
 * When `auth.Require(perm, scopeFromRequest)` ships (api#27), the
 * middleware joins request scope vs. user-role scope: assignment
 * matches when every present key in user-role scope matches the
 * request's value (absent keys = wildcards).
 */
export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  scope?: Record<string, string>;
  granted_by?: string;
  granted_at: string;
}

/** Body shape for POST /user-roles. */
export interface UserRoleInput {
  user_id: string;
  role_id: string;
  scope?: Record<string, string>;
  granted_by?: string;
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
  /** R-follow-up #3 — anchor fields surfaced on the admin projection. */
  project_id?: string | null;
  team_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Body shape for POST + PUT /policies.
 *
 * R-follow-up #3 — admin form can target a specific anchor:
 *   - both nil → platform-global rule (legacy default)
 *   - project_id set → project-scoped rule
 *   - team_id set → team-scoped rule (cascades subtree-down)
 * Mutually exclusive; server-side validation enforces.
 */
export interface PolicyInput {
  name: string;
  selector: Record<string, string>;
  workflow_id: string;
  priority: number;
  enabled: boolean;
  project_id?: string | null;
  team_id?: string | null;
}

/**
 * EPIC R (api#108) Slice R3 — projection from
 * `GET /api/v1/projects/:projectID/policy-rules[/:ruleID]`.
 *
 * Mirrors `internal/handlers/project_policy_rules.go::policyRuleProjection`.
 *
 * §4 correction 1 sanitization:
 *   - Inherited platform rules (`is_platform_inherited=true`,
 *     `project_id=null`) carry `selector_keys` ONLY; the `selector`
 *     field is OMITTED server-side. Scoped users see WHICH selector
 *     keys constrain the platform rule, never the values.
 *   - Scoped rules (`is_platform_inherited=false`,
 *     `project_id=<this project>`) carry the full `selector` map.
 *
 * `workflow_name` is hydrated client-side from `useWorkflows()` (same
 * key as the admin page so navigation between them is cache-free).
 */
export interface PolicyRule {
  id: string;
  name: string;
  project_id: string | null;
  /**
   * R-follow-up #3 (api#114) — non-null when the rule is team-anchored
   * (cascading down into this project's view). Present on inherited
   * rows; null on own project-scoped rows + platform-inherited rows.
   */
  team_id?: string | null;
  /** R-follow-up #3 — populated for team-inherited rows via server-side JOIN. */
  team_name?: string;
  is_platform_inherited: boolean;
  /**
   * R-follow-up #3 — true when the rule is a team rule cascading into
   * this project's view (team_id is set + not the project's own).
   * Inherited rows (platform OR team) omit the `selector` field.
   */
  is_team_inherited?: boolean;
  selector_keys: string[];
  /** Present ONLY when the rule belongs to this project (not inherited). */
  selector?: Record<string, unknown>;
  priority: number;
  workflow_id: string;
  /** R-follow-up #3 — populated via server-side JOIN; SPA reads from envelope (no N+1). */
  workflow_name?: string;
  enabled: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * R-follow-up #3 (api#126) — team-anchored policy rule envelope.
 * Mirrors PolicyRule's project shape. Inherited rows (platform or
 * ancestor-team) omit `selector` for the same selector-leakage
 * defense.
 */
export interface TeamPolicyRule {
  id: string;
  name: string;
  team_id?: string | null;
  team_name?: string;
  workflow_id: string;
  workflow_name?: string;
  is_platform_inherited: boolean;
  /** True when the rule belongs to an ANCESTOR team of the URL teamID. */
  is_ancestor_inherited: boolean;
  selector_keys: string[];
  /** Present ONLY when the rule belongs to the URL team (own row). */
  selector?: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * R-follow-up #3 — single-rule response envelope.
 * Carries the live priority_cap (R-follow-up #2 §3 — SPA Author
 * drawer reads from envelope so a stale fallback never happens).
 */
export interface TeamPolicyRuleResponse {
  rule: TeamPolicyRule;
  priority_cap: number;
}

/**
 * R-follow-up #3 — list response envelope.
 */
export interface TeamPolicyRulesListResponse {
  rules: TeamPolicyRule[];
  priority_cap: number;
}

/** Body shape for POST /api/v1/teams/:teamID/policy-rules. */
export interface AuthorTeamPolicyRuleInput {
  name: string;
  selector: Record<string, unknown>;
  priority: number;
  workflow_id: string;
  enabled: boolean;
}

/** Body shape for PUT /api/v1/teams/:teamID/policy-rules/:ruleID. */
export interface UpdateTeamPolicyRuleInput {
  name?: string;
  selector?: Record<string, unknown>;
  priority?: number;
  workflow_id?: string;
  enabled?: boolean;
}

/**
 * R-follow-up #3 (api#126) — response shape for
 * GET /api/v1/users/me/policy-author-team-coverage.
 * SPA reads this to drive sidebar visibility + canAuthorTeamPolicy
 * without walking the team tree client-side.
 */
export interface MyPolicyAuthorTeamCoverage {
  global: boolean;
  team_ids: string[];
}

/**
 * Body shape for `POST /api/v1/projects/:projectID/policy-rules`.
 *
 * Selector is constrained by the guided form per §5 Q14: it carries
 * `project_id` (filled by the form), either `environment_kind=non_prod`
 * OR `environment_id`, and optional `secret_ref_prefix`. The api
 * re-validates every gate.
 */
export interface AuthorPolicyRuleInput {
  name: string;
  selector: Record<string, unknown>;
  priority: number;
  workflow_id: string;
  enabled: boolean;
}

/**
 * Body shape for `PUT /api/v1/projects/:projectID/policy-rules/:ruleID`.
 *
 * All fields optional (omitted = preserve). Per §3 Q9 lock, explicit
 * empty `{}` selector is REJECTED by the api with
 * `policy_scope_too_broad.reason=selector_empty`.
 */
export interface UpdatePolicyRuleInput {
  name?: string;
  selector?: Record<string, unknown>;
  priority?: number;
  workflow_id?: string;
  enabled?: boolean;
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
 * DiscoveredApp — one row returned by
 * GET /api/v1/argocd-endpoints/:id/discovered-apps. The api trims
 * ArgoCD's Application to just the metadata the bulk-create flow
 * needs. NEVER carries manifests.
 *
 * `namespace` is the ArgoCD Application CR's own namespace (usually
 * "argocd"); `destination_namespace` is where the app actually
 * deploys to — that's the value the gitops mapping form's
 * `application_namespace` column should mirror.
 */
export interface DiscoveredApp {
  name: string;
  namespace?: string;
  project?: string;
  destination_server?: string;
  destination_cluster?: string;
  destination_namespace?: string;
  health_status?: string;
  sync_status?: string;
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

/**
 * R-follow-up #2 (api#113) — wire shape from
 * GET /api/v1/platform-settings[/:key]. The `value` field is `unknown`
 * because the table is generic over a key/value JSONB schema; callers
 * narrow per-key (e.g. `value` is `number` for `platform_reserved_priority`).
 */
export interface PlatformSetting {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by: string | null;
}
