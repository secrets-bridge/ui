/**
 * One person in a table: name and email, or the raw id when the lookup
 * can't name them (no permission, or an id from before local users).
 */

import type { ReactNode } from 'react';

import { personName, type UserSummary } from '../../../api/users';

/** `children` sits beside the name, such as a "You" tag. */
export function Person({ id, person, children }: { id: string; person?: UserSummary; children?: ReactNode }) {
  if (!person) {
    return (
      <span className="break-all font-mono text-mono text-ink">
        {id}
        {children}
      </span>
    );
  }
  return (
    <span title={id} className="inline-flex min-w-0 flex-col">
      <span className="break-words text-ink">
        {personName(id, person)}
        {person.disabled && <span className="ml-2 text-caption text-muted">Disabled</span>}
        {children}
      </span>
      {person.display_name && <span className="break-all text-caption text-muted">{person.email}</span>}
    </span>
  );
}
