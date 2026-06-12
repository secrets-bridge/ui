/**
 * Backend-owned mirror of the policy selector enums.
 *
 * Source of truth: `pkg/storage/provider_connections.go` in the api
 * repo. Specifically the `policySelectorProviderTypes` slice +
 * `storage.IsPolicySelectorProviderType` predicate (api#139).
 *
 * UPDATE TOGETHER. When the backend's enum changes — a new provider
 * type ships or one is sunset — this mirror moves in the same PR
 * sequence (or a coordinated pair of PRs). The service-layer validator
 * `services.ValidateProviderTypeSelector` hard-rejects unknown values
 * with `policy_scope_too_broad / provider_type_invalid`; this mirror
 * exists so the SPA can build the dropdown without a separate GET
 * endpoint.
 *
 * Why no `GET /policy-selector-enum` endpoint? Per the EPIC #139
 * design lock: 5 stable values, rare changes, review process catches
 * drift. Adding an endpoint would pull in caching + invalidation +
 * a TanStack hook + an entire failure-mode surface for product
 * metadata that doesn't need any of it.
 */

export const POLICY_SELECTOR_PROVIDER_TYPES = [
  'aws-sm',
  'vault',
  'gcp-sm',
  'azure-kv',
  'kubernetes',
] as const;

export type PolicySelectorProviderType =
  (typeof POLICY_SELECTOR_PROVIDER_TYPES)[number];
