/**
 * PageHeader — the title + muted subtitle + right-aligned CTA strip
 * that opens every page in the Figma frames. Reusable across all
 * admin pages so they stay visually identical.
 */

import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: Props) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-text font-bold tracking-tight text-3xl">
          {title}
        </h1>
        {description && (
          <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
