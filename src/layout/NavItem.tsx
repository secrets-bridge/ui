/**
 * One row of a navigation list, in the sidebar or in Administration.
 * The count is hidden at 0; `quiet` outlines it, for something that's
 * ready rather than waiting. `tag` marks a section, such as Preview.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export function NavItem({
  to,
  label,
  icon,
  count,
  countLabel,
  quiet,
  tag,
  end,
}: {
  to: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  countLabel?: string;
  quiet?: boolean;
  tag?: string;
  // NavLink matches by prefix; `end` keeps "/" from matching every route.
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'group flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-ui font-medium max-[900px]:h-11 ' +
        (isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-hover hover:text-ink')
      }
    >
      {icon && <span className="group-aria-[current=page]:text-accent-ink">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tag && (
        <span className="inline-flex h-5 items-center rounded-sm border border-dashed border-edge px-[7px] text-[11.5px] font-medium text-muted">
          {tag}
        </span>
      )}
      {count !== undefined && count > 0 && (
        <span
          aria-label={countLabel}
          className={
            'inline-flex h-5 min-w-[22px] items-center justify-center rounded-sm px-1.5 font-mono text-[11.5px] font-semibold ' +
            (quiet ? 'border border-border text-muted' : 'bg-accent text-on-accent')
          }
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}
