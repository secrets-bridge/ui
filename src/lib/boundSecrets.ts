/**
 * The env-secrets list (`GET /projects/:id/environments/:env_id/secrets`)
 * returns one row per allowed key. Group them per secret: the key names
 * the binding allows, or `allKeys` when it allows every key (a row with
 * an empty key name). Names only, never values.
 */

import type { EnvSecretKey } from '../api/devSecrets';

export interface BoundSecret {
  ref: string;
  provider: string;
  /** Allowed key names; empty when the binding allows every key. */
  keys: string[];
  allKeys: boolean;
  /** Operations the binding allows, such as read and patch. */
  ops: string[];
}

export function groupBoundSecrets(rows: EnvSecretKey[]): BoundSecret[] {
  const by = new Map<string, BoundSecret>();
  for (const r of rows) {
    const s = by.get(r.secret_ref) ?? { ref: r.secret_ref, provider: r.provider_type, keys: [], allKeys: false, ops: [] };
    if (r.key_name) {
      if (!s.keys.includes(r.key_name)) s.keys.push(r.key_name);
    } else s.allKeys = true;
    for (const op of r.allowed_ops) if (!s.ops.includes(op)) s.ops.push(op);
    by.set(r.secret_ref, s);
  }
  return [...by.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}
