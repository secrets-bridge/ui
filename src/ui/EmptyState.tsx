/**
 * What a list shows when it has nothing in it: what is missing in one
 * line and what to do next. Offer only actions this person can take.
 */

import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-edge px-6 py-9 text-center">
      <p className="text-block-heading text-ink">{title}</p>
      {children && <p className="max-w-[420px] text-ui leading-[21px] text-muted">{children}</p>}
      {action}
    </div>
  );
}
