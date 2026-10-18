/**
 * PageHeader — the page h1, a one-line fact line under it, and the page
 * actions (filters and at most one primary button).
 *
 * The h1 has `id="page-title"` and tabIndex -1 so the shell can move
 * focus to it on every route change. The document title follows it.
 */

import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Short fact line built from the same records the page lists. */
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: Props) {
  // The tab title names the page, so history and tabs are readable.
  useEffect(() => {
    document.title = `${title} · Secrets Bridge`;
  }, [title]);

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 id="page-title" tabIndex={-1} className="text-console-title text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-[3px] max-w-3xl text-ui font-normal text-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 max-[600px]:w-full max-[600px]:[&>button]:flex-1">
          {actions}
        </div>
      )}
    </div>
  );
}
