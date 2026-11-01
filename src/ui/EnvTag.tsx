/**
 * Environment name as a small tag, placed after the project name.
 * Production is inverted with a hatch glyph, so it stands out without
 * relying on colour.
 */

import type { ReactNode } from 'react';

export function EnvTag({ kind, children }: { kind?: 'prod' | 'non_prod'; children: ReactNode }) {
  const prod = kind === 'prod';
  return (
    <span
      className={
        'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-sm border px-[7px] align-[1px] font-mono text-[11.5px] ' +
        (prod ? 'border-ink bg-ink font-semibold text-bg' : 'border-edge font-medium text-ink')
      }
    >
      {prod && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 bg-[repeating-linear-gradient(135deg,var(--bg)_0_1.5px,transparent_1.5px_3.5px)]"
        />
      )}
      {children}
    </span>
  );
}
