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
  /** Small line above the title, such as the date and who is signed in. */
  eyebrow?: ReactNode;
  /** Short fact line built from the same records the page lists. */
  description?: ReactNode;
  actions?: ReactNode;
  /** A project's or team's mark, shown before the title. */
  mark?: ReactNode;
}

export function PageHeader({ title, eyebrow, description, actions, mark }: Props) {
  // The tab title names the page, so history and tabs are readable.
  useEffect(() => {
    document.title = `${title} · Secrets Bridge`;
  }, [title]);

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-label text-muted">{eyebrow}</p>}
        <h1 id="page-title" tabIndex={-1} className={'text-console-title text-ink' + (mark ? ' flex items-center gap-3' : '')}>
          {mark}
          {mark ? <span className="min-w-0 break-words">{title}</span> : title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-caption text-muted">{description}</p>
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
