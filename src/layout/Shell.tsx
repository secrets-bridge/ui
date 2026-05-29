import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

const sectionLink =
  'block px-3 py-2 text-sm rounded transition-colors hover:bg-border [&.active]:bg-border [&.active]:text-text';

/**
 * Top-level chrome: sidebar + top bar + content slot. Routes render
 * inside <Outlet />.
 */
export function Shell() {
  const { identity, logout } = useAuth();

  return (
    <div className="h-full grid grid-cols-[260px_1fr] grid-rows-[56px_1fr]">
      <aside className="row-span-2 bg-surface border-r border-border p-4 flex flex-col">
        <div className="text-text font-semibold mb-6 px-3">Secrets Bridge</div>
        <nav className="space-y-1 flex-1">
          <div className="text-xs uppercase text-muted px-3 mb-2">Operate</div>
          <NavLink to="/agents" className={sectionLink}>
            Agents
          </NavLink>
          <NavLink to="/requests" className={sectionLink}>
            Requests
          </NavLink>
          <NavLink to="/secrets" className={sectionLink}>
            Discovered Secrets
          </NavLink>
          <NavLink to="/audit" className={sectionLink}>
            Audit Log
          </NavLink>

          <div className="text-xs uppercase text-muted px-3 mt-6 mb-2">Admin</div>
          <NavLink to="/admin/projects" className={sectionLink}>
            Projects
          </NavLink>
          <NavLink to="/admin/roles" className={sectionLink}>
            Roles
          </NavLink>
          <NavLink to="/admin/assignments" className={sectionLink}>
            Assignments
          </NavLink>
          <NavLink to="/admin/workflows" className={sectionLink}>
            Workflows
          </NavLink>
          <NavLink to="/admin/policies" className={sectionLink}>
            Policies
          </NavLink>
          <NavLink to="/admin/integrations" className={sectionLink}>
            Integrations
          </NavLink>
        </nav>
        <div className="text-xs text-muted px-3 mt-4">Pre-v1.0 build</div>
      </aside>

      <header className="bg-surface border-b border-border px-6 flex items-center justify-between">
        <div className="text-sm text-muted">Control Plane Dashboard</div>
        <div className="flex items-center gap-3">
          {identity && (
            <>
              <span className="text-sm text-text">{identity.display_name}</span>
              <button
                onClick={logout}
                className="text-xs text-muted hover:text-text px-2 py-1 rounded border border-border"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main className="overflow-auto p-6 bg-bg">
        <Outlet />
      </main>
    </div>
  );
}
