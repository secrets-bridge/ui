import type { AccessRequest } from '../api/types';

/** The key names a cross-team request asks for. Names only. */
export function keysOf(r: AccessRequest): string[] {
  return r.destination_keys ?? r.target_keys ?? [];
}
