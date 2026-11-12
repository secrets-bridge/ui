/**
 * When a pending request stops being decidable. The api has no
 * `expires_at` yet and nothing closes a request on schedule, so a request
 * past its deadline stays pending until someone acts and gets refused.
 * The console works the deadline out from the workflow, the same way the
 * request page does.
 */

import type { AccessRequest } from '../api/types';

interface Ttl {
  id: string;
  request_ttl_seconds: number;
}

export function requestDeadline(r: AccessRequest, workflows: Ttl[] | undefined): string | undefined {
  const ttl = workflows?.find((w) => w.id === r.workflow_id)?.request_ttl_seconds ?? 0;
  return ttl > 0 ? new Date(Date.parse(r.created_at) + ttl * 1000).toISOString() : undefined;
}

export function pastDeadline(r: AccessRequest, workflows: Ttl[] | undefined, now: number): boolean {
  const at = requestDeadline(r, workflows);
  return !!at && Date.parse(at) <= now;
}
