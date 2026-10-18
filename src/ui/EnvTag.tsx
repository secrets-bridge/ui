/**
 * Environment name as a small tag, placed after the project name.
 * Production is outlined in ink so it always stands out.
 */

import type { ReactNode } from 'react';

export function EnvTag({ kind, children }: { kind?: 'prod' | 'non_prod'; children: ReactNode }) {
  return (
    <span
      className={
        'inline-flex h-[18px] items-center whitespace-nowrap rounded-sm border px-[5px] align-[1px] text-[11px] font-medium ' +
        (kind === 'prod' ? 'border-ink font-semibold text-ink' : 'border-border text-muted')
      }
    >
      {children}
    </span>
  );
}
