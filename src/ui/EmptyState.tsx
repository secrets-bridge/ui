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
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-edge px-5 py-[22px]">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {children && <p className="max-w-[60ch] text-body text-muted">{children}</p>}
      {action}
    </div>
  );
}
