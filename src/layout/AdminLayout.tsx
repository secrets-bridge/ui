/**
 * Administration: one entry in the sidebar, with its own navigation here,
 * so the sidebar stays short and each kind of work has a heading. Below
 * 1360px it becomes a select above the page: admin tables are wide, and a
 * second column of links would squeeze them into scrolling.
 */

import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Banner } from '../ui/Banner';
import { Select } from '../ui/Field';
import { NavItem } from './NavItem';
import { useAdminSections } from './useAdminSections';

export function AdminLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { sections, waiting, isAdmin } = useAdminSections();
  const current = sections.flatMap((s) => s.links).find((l) => pathname === l.to || pathname.startsWith(`${l.to}/`));

  // Someone with no admin section still reaches the page, and it says why
  // it can't help them. The api decides either way.
  if (!isAdmin) return <Outlet />;

  return (
    <div className="flex flex-col gap-6">
      {waiting > 0 && pathname !== '/admin/users' && (
        <Banner
          tone="warn"
          title={waiting === 1 ? '1 person is waiting for account approval.' : `${waiting} people are waiting for account approval.`}
          action={
            <Link to="/admin/users" className="inline-flex h-(--control-sm) items-center self-center whitespace-nowrap rounded-md border border-edge px-[11px] text-[13px] font-semibold leading-5 text-ink hover:bg-hover">
              Review accounts
            </Link>
          }
        >
          They signed in with Google and can't do anything until you give them a role.
        </Banner>
      )}

      <div className="flex items-start gap-7 max-[1360px]:flex-col max-[1360px]:gap-4">
        <nav aria-label="Administration" className="flex w-[232px] shrink-0 flex-col gap-5 max-[1360px]:hidden">
          {sections.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <p className="px-2.5 pb-1.5 text-[12px] font-medium leading-4 text-muted">{s.label}</p>
              {s.links.map((l) => (
                <NavItem key={l.to} to={l.to} label={l.label} count={l.count} countLabel={l.countLabel} tag={l.tag} />
              ))}
              {s.note && <p className="px-2.5 pt-0.5 text-[13px] leading-[19px] text-muted">{s.note}</p>}
            </div>
          ))}
        </nav>

        <label className="hidden w-full max-w-[360px] max-[1360px]:block max-[600px]:max-w-none">
          <span className="sr-only">Administration section</span>
          <Select value={current?.to ?? ''} onChange={(e) => navigate(e.target.value)} className="w-full">
            {!current && <option value="">Choose a section</option>}
            {sections.map((s) => (
              <optgroup key={s.label} label={s.label}>
                {s.links.map((l) => (
                  <option key={l.to} value={l.to}>
                    {l.label}
                    {l.count ? ` (${l.count})` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>

        <div className="w-full min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** `/admin` opens the first section this person has. */
export function AdminIndex() {
  const { first } = useAdminSections();
  return <Navigate to={first ?? '/'} replace />;
}
