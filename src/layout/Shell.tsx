import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { VersionChip } from '../ui/VersionChip';
import { LogoMark } from '../ui/LogoMark';

/**
 * Shell — sidebar + top bar + main content slot, matched against the
 * Figma frame on page 05 (Dashboard) and the 06 screens. Layout:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ ⬛ SecretsBridge          Roles  ┌ search ┐ ⊙ Acme Corp  ⨀  │
 *   ├──────────────┬──────────────────────────────────────────────┤
 *   │ ☐ Agents     │                                              │
 *   │ ☐ Requests 3 │   <Outlet />                                 │
 *   │ ...          │                                              │
 *   │ ADMIN        │                                              │
 *   │ ⬛ Roles      │                                              │
 *   │ ...          │                                              │
 *   │              │                                              │
 *   │ Haider       │                                              │
 *   │ Platform admin                                              │
 *   └──────────────┴──────────────────────────────────────────────┘
 *
 * Some bits are aspirational for v1 (the search field is decorative;
 * the env-switcher pill is a placeholder; pending-request badges land
 * when Requests does). The shell shape is real today.
 */
export function Shell() {
  const { identity, hasPermission, logout, meStatus } = useAuth();
  const navigate = useNavigate();

  // Sidebar entries gated by the live permission set. Each entry
  // can declare one or more required permissions; the item renders
  // only when the user holds all of them. Until /users/me hydrates
  // (meStatus !== 'ready') every gated item stays hidden — strict
  // fail-closed behaviour.
  //
  // Mapping:
  //   Requests        → secret.request OR secret.approve
  //   Agents          → agent.list
  //   Secrets         → secret.list
  //   Audit           → audit.read
  //   Admin/Teams     → team.edit
  //   Admin/Projects  → team.edit (admins curate projects + teams together)
  //   Admin/Roles     → role.edit
  //   Admin/Asgmts    → user_role.edit
  //   Admin/Wflows    → workflow.edit
  //   Admin/Policies  → policy.edit
  //   Admin/Intgrtns  → integration.edit
  //
  // Dashboard + /me are always visible (no gate).
  const showRequests = hasPermission('secret.request') || hasPermission('secret.approve');
  const showAgents = hasPermission('agent.list');
  const showSecrets = hasPermission('secret.list');
  const showAudit = hasPermission('audit.read');
  const showTeams = hasPermission('team.edit');
  const showRoles = hasPermission('role.edit');
  const showAssignments = hasPermission('user_role.edit');
  const showWorkflows = hasPermission('workflow.edit');
  const showPolicies = hasPermission('policy.edit');
  const showIntegrations = hasPermission('integration.edit');
  const anyAdmin = showTeams || showRoles || showAssignments || showWorkflows || showPolicies || showIntegrations;

  return (
    <div className="h-full grid grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-bg">
      {/* SIDEBAR: spans both rows */}
      <aside className="row-span-2 bg-surface border-r border-border flex flex-col">
        {/* brand mark */}
        <div className="px-5 py-4 flex items-center gap-2 border-b border-border/60">
          <LogoMark className="w-7 h-7" />
          <span className="text-text text-base font-semibold tracking-tight">
            SecretsBridge
          </span>
        </div>

        {/* nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavGroup>
            <NavItem to="/" label="Dashboard" end />
            {showRequests && <NavItem to="/requests" label="Requests" />}
            {showAgents && <NavItem to="/agents" label="Agents" />}
            {showSecrets && <NavItem to="/secrets" label="Secrets" />}
            {showAudit && <NavItem to="/audit" label="Audit" />}
          </NavGroup>

          {anyAdmin && (
            <>
              <SectionLabel>Admin</SectionLabel>
              <NavGroup>
                {showTeams && <NavItem to="/admin/projects" label="Projects" />}
                {showTeams && <NavItem to="/admin/teams" label="Teams" />}
                {showRoles && <NavItem to="/admin/roles" label="Roles" />}
                {showAssignments && <NavItem to="/admin/assignments" label="Assignments" />}
                {showWorkflows && <NavItem to="/admin/workflows" label="Workflows" />}
                {showPolicies && <NavItem to="/admin/policies" label="Policies" />}
                {showIntegrations && <NavItem to="/admin/integrations" label="Integrations" />}
              </NavGroup>
            </>
          )}

          {meStatus === 'loading' && (
            <div className="px-3 pt-4 text-[11px] text-muted/70 italic">
              Loading permissions…
            </div>
          )}
        </nav>

        {/* user profile pinned to bottom */}
        {identity && (
          <div className="px-3 py-3 border-t border-border/60 space-y-1">
            <button
              onClick={() => navigate('/me')}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bg/40 transition-colors text-left"
              title="View your profile"
            >
              <Avatar name={identity.display_name} />
              <div className="flex-1 min-w-0">
                <div className="text-text text-sm font-medium truncate">
                  {identity.display_name}
                </div>
                <div className="text-muted text-xs truncate">
                  {roleLabelFor(identity.permissions)}
                </div>
              </div>
            </button>
            <button
              onClick={logout}
              className="w-full text-[11px] text-muted hover:text-text px-2 py-1.5 rounded-lg hover:bg-bg/30 transition-colors text-left"
              title="Sign out"
            >
              Sign out
            </button>
            <div className="flex justify-center pt-1">
              <VersionChip />
            </div>
          </div>
        )}
      </aside>

      {/* TOP BAR */}
      <header className="bg-surface border-b border-border px-6 flex items-center gap-4">
        {/* page title is filled by per-page <PageHeader>; the bar
            itself just hosts global controls. */}
        <div className="flex-1" />
        <input
          type="text"
          placeholder="Search secrets, requests, agents…"
          className="hidden md:block w-80 bg-bg/60 border border-border rounded-full px-4 py-1.5 text-sm text-text placeholder-muted focus:outline-none focus:border-accent/40"
        />
        <EnvSwitcher value="Production" />
        {identity && <Avatar name={identity.display_name} />}
      </header>

      {/* MAIN */}
      <main className="overflow-auto bg-bg">
        <div className="px-8 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// --- sidebar bits ---------------------------------------------------

function NavGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0.5">{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-5 pb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-semibold">
      {children}
    </div>
  );
}

function NavItem({
  to,
  label,
  badge,
  end,
}: {
  to: string;
  label: string;
  badge?: number;
  // NavLink defaults to prefix matching — `/` would otherwise stay
  // active under every route. Pass `end` for the Dashboard root.
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
          isActive
            ? 'bg-accent/15 text-accent'
            : 'text-muted hover:text-text hover:bg-bg/30',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <NavDot active={isActive} />
          <span className="flex-1">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="bg-accent/20 text-accent text-[11px] rounded-full px-2 py-0.5 font-medium">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function NavDot({ active }: { active: boolean }) {
  // Small square indicator on the left of each nav item — the Figma
  // sidebar uses a filled square for the active item and a hollow
  // square for inactive ones. Reads as a checkbox-like affordance.
  return active ? (
    <span className="w-3 h-3 rounded-sm bg-accent" />
  ) : (
    <span className="w-3 h-3 rounded-sm border border-border" />
  );
}

// --- top bar bits ---------------------------------------------------

function EnvSwitcher({ value }: { value: string }) {
  return (
    <button
      className="hidden md:inline-flex items-center gap-2 rounded-full bg-bg/60 border border-border px-3 py-1.5 text-xs text-text hover:bg-bg"
      title="Environment context"
    >
      <span className="w-2 h-2 rounded-full bg-success" />
      {value}
    </button>
  );
}

// Heuristic label for the avatar's subtitle. The api doesn't return a
// canonical "what kind of user is this" string — we approximate from
// the permission set so the sidebar shows a reasonable label without
// flipping to the profile page.
function roleLabelFor(perms: string[]): string {
  if (perms.includes('role.edit') || perms.includes('user_role.edit')) return 'Platform admin';
  if (perms.includes('secret.approve')) return 'Approver';
  if (perms.includes('secret.request')) return 'Developer';
  if (perms.length === 0) return 'Loading…';
  return 'Member';
}

function Avatar({ name }: { name: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-gradient text-bg text-sm font-semibold">
      {initial}
    </span>
  );
}
