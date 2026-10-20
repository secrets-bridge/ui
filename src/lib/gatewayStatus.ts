/**
 * Gateway and observation wording: the glyph tone, the exact word and
 * plain sentences for the api's codes. Release 1 observes Argo CD only,
 * and Argo CD state is operational state, never proof that a new secret
 * value reached the app (secrets-bridge/gateway#12).
 *
 * Pending, unverified and timed out are never shown as a failure: none
 * of them has the bad tone.
 */

import type { GatewayStatus, ObservationRollup, ObservationSource, ObservationTaskState } from '../api/gateways';
import type { Tone } from '../ui/Status';

export const GATEWAY_STATUS_TONE: Record<GatewayStatus, Tone> = {
  active: 'ok',
  pending: 'warn',
  stale: 'warn',
  disabled: 'neutral',
  revoked: 'neutral',
};

export const GATEWAY_STATUS_LABEL: Record<GatewayStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  stale: 'Stale',
  disabled: 'Disabled',
  revoked: 'Revoked',
};

export const GATEWAY_STATUS_MEANING: Record<GatewayStatus, string> = {
  active: 'Heartbeats are arriving.',
  pending: 'Created, waiting to enroll with a one-time token.',
  stale: 'No heartbeat for a while. Check the Gateway pods and their route to the control plane.',
  disabled: 'Disabled by an administrator. Its calls are refused and its leased tasks went back to the queue.',
  revoked: 'Its credential is refused for good. Create a new Gateway to replace it.',
};

export const CONNECTOR_STATUS_LABEL: Record<string, string> = {
  advertised: 'Advertised',
  approved: 'Approved',
  disabled: 'Disabled',
  missing: 'Missing',
};

export const CONNECTOR_STATUS_TONE: Record<string, Tone> = {
  advertised: 'warn',
  approved: 'ok',
  disabled: 'neutral',
  missing: 'neutral',
};

export const CONNECTOR_KIND_LABEL: Record<string, string> = {
  argocd: 'Argo CD',
  eso: 'External Secrets',
  rollout: 'Workload rollout',
};

export const TASK_STATE_LABEL: Record<ObservationTaskState, string> = {
  queued: 'Queued',
  leased: 'Leased',
  done: 'Done',
  dead: 'Dead',
  cancelled: 'Cancelled',
};

export const TASK_STATE_TONE: Record<ObservationTaskState, Tone> = {
  queued: 'warn',
  leased: 'warn',
  done: 'ok',
  dead: 'neutral',
  cancelled: 'neutral',
};

export const SOURCE_LABEL: Record<ObservationSource, string> = {
  gateway: 'Gateway',
  none: 'None',
};

export const SOURCE_MEANING: Record<ObservationSource, string> = {
  gateway: 'A Gateway in the workload boundary observes executed changes through its bindings.',
  none: 'Nothing observes executed changes in this environment.',
};

export const ROLLUP_LABEL: Record<ObservationRollup, string> = {
  none: 'No observation configured',
  pending: 'Pending',
  verified: 'Verified',
  partially_observed: 'Partially observed',
  unverified: 'Unverified',
  timed_out: 'Timed out',
};

export const ROLLUP_TONE: Record<ObservationRollup, Tone> = {
  none: 'neutral',
  pending: 'warn',
  verified: 'ok',
  partially_observed: 'warn',
  unverified: 'neutral',
  timed_out: 'neutral',
};

export const ROLLUP_MEANING: Record<ObservationRollup, string> = {
  none: 'No Gateway binding covers this change, so nothing is observed for it.',
  pending: 'The Gateway is still observing. This updates on its own.',
  verified: 'Every expected stage was observed after the change.',
  partially_observed: 'Some expected stages were observed, not all.',
  unverified: 'The evidence does not show that the change was picked up. This is not a failure of the request.',
  timed_out: 'No accepted evidence arrived before the deadline. This is not a failure of the request.',
};

/** Why a task ended where it did (verdict_reason). */
export const VERDICT_REASON: Record<string, string> = {
  no_provider_version: 'The provider reported no version to match the evidence against.',
  failure_observed: 'The Gateway saw a failure at one of the stages.',
  no_stage_observed: 'No expected stage was observed.',
  superseded_by_later_write: 'A later change to the same secret replaced this one.',
  source_changed: "The environment's observation source changed while the task was open.",
  connector_missing: 'The bound connector is no longer advertised by the Gateway.',
  gateway_errors: 'The Gateway reported errors at every attempt.',
  gateway_over_privileged: 'The Gateway holds more Argo CD rights than read-only, so its evidence was not used.',
  gateway_unavailable: 'The Gateway was not available.',
  deadline_reached: 'The deadline passed before the evidence was complete.',
  context_only:
    'Only Argo CD context was observed. Argo CD health and sync are operational state, never proof that the new value reached the app.',
  binding_removed: 'An administrator removed the binding while the task was open.',
};

export const STAGE_LABEL: Record<string, string> = {
  argocd_context: 'Argo CD',
  eso_sync: 'External Secrets sync',
  workload_rollout: 'Workload rollout',
};

export const OUTCOME_LABEL: Record<string, string> = {
  observed: 'Observed',
  not_observed: 'Not observed',
  not_applicable: 'Not applicable',
  unverifiable: 'Unverifiable',
  failed: 'Failed',
  error: 'Error',
};

export const OUTCOME_TONE: Record<string, Tone> = {
  observed: 'ok',
  not_observed: 'neutral',
  not_applicable: 'neutral',
  unverifiable: 'neutral',
  failed: 'bad',
  error: 'neutral',
};

export const ARGOCD_NOT_PROOF =
  'Argo CD reports Healthy and Synced. This is the operational state, not proof the new value reached the app.';

/** Caveats in plain words. Unknown codes fall back to the code itself. */
export const CAVEAT_TEXT: Record<string, string> = {
  argocd_health_not_proof: ARGOCD_NOT_PROOF,
  clock_skew_suspected: "The Gateway's clock may be off, so the times here are less certain.",
  eso_status_has_no_provider_version: 'External Secrets does not report which provider version it synced.',
  provider_version_missing: 'The provider version was not available.',
  temporal_inference_only: 'Matched by time only, not by version.',
  refresh_before_change: 'The last refresh happened before the change.',
  refresh_time_within_skew: 'The refresh time is too close to the change to tell them apart.',
  remote_ref_not_checked: 'The remote reference was not checked.',
  remote_ref_mismatch: 'The remote reference does not match the changed secret.',
  remote_version_pinned_other: 'The remote reference is pinned to another version.',
  multiple_externalsecrets_for_target: 'More than one ExternalSecret writes this target.',
  data_from_extract_or_find: 'The ExternalSecret reads keys by extract or find.',
  rollout_not_triggered_by_change: 'The rollout was not started by this change.',
  reload_mechanism_unknown: 'How the workload reloads the value is unknown.',
  rollout_in_progress: 'A rollout is still in progress.',
  generation_not_observed: 'The controller has not observed the latest generation yet.',
  argocd_operation_unrelated: 'The Argo CD operation seen is not related to this change.',
  argocd_app_has_multiple_sources: 'The Argo CD application has more than one source.',
  observed_before_not_before: 'Observed before the change could have taken effect.',
  resource_deleted_during_observation: 'The resource was deleted during the observation.',
  refresh_interval_exceeds_deadline: 'The refresh interval is longer than the observation deadline.',
  volume_refresh_not_observable: 'A mounted volume refresh cannot be observed.',
  subpath_mount_not_refreshed: 'A subPath mount is not refreshed by Kubernetes.',
  rollout_paused: 'The rollout is paused.',
  zero_replicas: 'The workload runs zero replicas.',
  replicaset_reused: 'An existing ReplicaSet was reused.',
};

export function caveatText(code: string): string {
  return CAVEAT_TEXT[code] ?? code.replace(/_/g, ' ');
}

export function words(code: string | undefined, map: Record<string, string>): string {
  if (!code) return '';
  return map[code] ?? code.replace(/_/g, ' ');
}
