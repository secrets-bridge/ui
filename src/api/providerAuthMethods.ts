/**
 * Backend-owned mirror of the allowed provider `auth_method` values.
 *
 * Source of truth: `internal/services/provider_connections.go` in the
 * api repo — the `authMethodsByType` map, whose own doc comment states
 * the intent plainly: "the metadata here gates what the admin form
 * accepts".
 *
 * UPDATE TOGETHER. When the backend map changes — a new provider type
 * ships, or an auth method is added or sunset — this mirror moves in
 * the same PR sequence (or a coordinated pair). `validateAuthMethod`
 * hard-rejects anything outside the per-type set with
 * `invalid_auth_method`; this mirror exists so the SPA can build the
 * dropdown without a separate GET endpoint.
 *
 * Why no endpoint? Same reasoning as `policySelectorEnums.ts`: a small
 * set of stable values, changing rarely, with review catching drift.
 * An endpoint would pull in caching and invalidation for data that
 * changes less often than the build.
 *
 * `auth_method` is REQUIRED by the backend — an empty string is
 * rejected, not treated as "unset". The form previously offered it as
 * an optional free-text field, so leaving it blank produced a 400 that
 * read "auth_method is not allowed for this provider type", which was
 * doubly confusing: the field was required, not disallowed.
 */

export const PROVIDER_AUTH_METHODS: Record<string, readonly string[]> = {
  'aws-sm': ['default', 'assume_role'],
  vault: ['token', 'kubernetes'],
  'gcp-sm': ['default', 'service_account'],
  'azure-kv': ['default', 'service_principal'],
  kubernetes: ['in_cluster', 'kubeconfig'],
};

/** Allowed auth methods for a provider type; empty when unknown. */
export function authMethodsFor(type: string): readonly string[] {
  return PROVIDER_AUTH_METHODS[type] ?? [];
}

/** The value the form should preselect when the provider type changes. */
export function defaultAuthMethodFor(type: string): string {
  return authMethodsFor(type)[0] ?? '';
}

/** Human-readable labels; falls back to the raw value. */
export const AUTH_METHOD_LABELS: Record<string, string> = {
  default: 'default (ambient workload identity)',
  assume_role: 'assume_role (STS AssumeRole)',
  token: 'token',
  kubernetes: 'kubernetes (in-cluster auth)',
  service_account: 'service_account',
  service_principal: 'service_principal',
  in_cluster: 'in_cluster',
  kubeconfig: 'kubeconfig',
};

export function authMethodLabel(value: string): string {
  return AUTH_METHOD_LABELS[value] ?? value;
}
