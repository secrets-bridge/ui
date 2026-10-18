/**
 * Path back from a detail page. The last item is the current page and
 * is not a link; set `mono` when it is an identifier.
 */

import { Fragment } from 'react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
  mono?: boolean;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-ui text-muted">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {last || !it.to ? (
              <span aria-current={last ? 'page' : undefined} className={it.mono ? 'font-mono text-mono' : ''}>
                {it.label}
              </span>
            ) : (
              <Link to={it.to} className="font-medium text-accent hover:underline">
                {it.label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
