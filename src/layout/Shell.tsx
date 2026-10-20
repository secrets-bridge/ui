import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { useInboxCount } from '../api/crossTeam';
import { pendingForbidden, usePendingUsers } from '../api/pendingUsers';
import { useRequests } from '../api/requests';
import { needsMyDecision } from '../lib/requestQueues';
import { useRevealConditions } from '../requests/revealState';
import { ConfirmModal } from '../ui/ConfirmModal';
import {
  AgentIcon,
  AuditIcon,
  CatalogIcon,
  CloseIcon,
  InboxIcon,
  MenuIcon,
  OverviewIcon,
  RequestIcon,
} from '../ui/icons';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useModalFocus } from '../ui/useModalFocus';
import { VersionChip } from '../ui/VersionChip';

/**
 * Console shell: a 216px sidebar and the page. At 900px and below the
 * sidebar becomes a menu button in a top bar that opens the same
 * navigation in a modal panel.
 *
 * - Nav items are gated by the live permission set and stay hidden
 *   until /users/me resolves (fail-closed). Hiding a link is not
 *   authorization; the api decides.
 * - No organization switcher, no environment toggle and no search
 *   field: none of them exist behind the UI.
 * - A route change moves focus to the page h1 (#page-title), or to the
 *   main region while the page is still loading.
 */
export function Shell() {
  const { identity, logout } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the new page's heading on every route change, not on
  // the first load. Comparing paths (rather than a "first run" flag)
  // also holds when StrictMode runs the effect twice.
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    const raf = window.requestAnimationFrame(() => {
      const h1 = document.getElementById('page-title');
      (h1 ?? mainRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [location.pathname]);

  // Sign out asks first (it's easy to hit by accident) and then does a
  // HARD navigation to /login: logout() empties the query cache, and a
  // router navigate() in the same tick can be lost to React's batching
  // (UAT round 4, 2026-05-31). A full reload is the clean signed-out
  // state. If the api call fails, the session is still alive, so the
  // dialog stays open with the error and the user can retry or cancel.
  const confirmSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await logout();
      setSignOutOpen(false);
      window.location.assign('/login');
    } catch (err) {
      setSignOutError(err);
    } finally {
      setSigningOut(false);
    }
  };

  const cancelSignOut = () => {
    if (signingOut) return;
    setSignOutError(null);
    setSignOutOpen(false);
  };

  const openSignOut = () => {
    setNavOpen(false);
    setSignOutOpen(true);
  };

  return (
    <div className="flex min-h-full bg-bg">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-ui font-semibold text-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside
        aria-label="Console"
        className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col border-r border-border bg-bg px-2.5 pb-2.5 pt-3.5 max-[900px]:hidden"
      >
        <SidebarContent onSignOut={openSignOut} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 hidden h-[52px] items-center gap-1.5 border-b border-border bg-bg pl-1.5 pr-2.5 max-[900px]:flex">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-sunken"
          >
            <MenuIcon />
          </button>
          <NavLink to="/" aria-label="Secrets Bridge console, overview" className="px-1">
            <Logo size={20} textSize={15} />
          </NavLink>
          <span className="flex-1" />
          <ThemeToggle className="h-11 w-11" />
          {identity && <Avatar name={identity.display_name} />}
        </header>

        <main ref={mainRef} id="main" tabIndex={-1} className="flex-1 px-7 pb-12 pt-6 max-[900px]:px-4 max-[900px]:pt-5">
          <Outlet />
        </main>
      </div>

      {navOpen && <MobileNav onClose={() => setNavOpen(false)} onSignOut={openSignOut} />}

      {signOutOpen && (
        <ConfirmModal
          title="Sign out of Secrets Bridge?"
          body={
            signOutError
              ? "Sign out didn't go through, so your session is still active. Try again, or cancel to stay signed in."
              : "You'll need to sign in again to come back. Your requests, approvals and audit events stay on the server."
          }
          confirmText={signOutError ? 'Try again' : 'Sign out'}
          danger
          loading={signingOut}
          error={signOutError}
          onCancel={cancelSignOut}
          onConfirm={confirmSignOut}
        />
      )}
    </div>
  );
}

// --- navigation -----------------------------------------------------

function SidebarContent({ onSignOut }: { onSignOut: () => void }) {
  return (
    <>
      <NavLink to="/" aria-label="Secrets Bridge console, overview" className="mb-3.5 block px-2 pt-1">
        <Logo size={20} textSize={15} />
      </NavLink>
      <Navigation />
      <SidebarFooter onSignOut={onSignOut} />
    </>
  );
}

function Navigation() {
  const { identity, hasPermission, meStatus } = useAuth();
  const me = identity?.id ?? '';

  // Sidebar entries gated by the live permission set:
  //   Requests        → secret.request OR secret.approve
  //   Inbox           → secret.value.provide (at any scope)
  //   Agents          → agent.list
  //   Gateways        → gateway.list
  //   Secrets         → secret.list
  //   Audit           → audit.read
  //   Project / team policies → policy.author (never auto-shown for
  //                     policy.edit holders; they use /admin/policies)
  //   Admin pages     → team.edit, role.edit, user_role.edit,
  //                     workflow.edit, policy.edit, integration.edit
  const canApprove = hasPermission('secret.approve');
  const canRequest = hasPermission('secret.request');
  const showRequests = canRequest || canApprove;
  const showInbox = hasPermission('secret.value.provide');
  const showAgents = hasPermission('agent.list');
  const showSecrets = hasPermission('secret.list');
  const showAudit = hasPermission('audit.read');
  const showTeams = hasPermission('team.edit');
  const showRoles = hasPermission('role.edit');
  const showAssignments = hasPermission('user_role.edit');
  const showWorkflows = hasPermission('workflow.edit');
  const showPolicies = hasPermission('policy.edit');
  const showProviderConnections = hasPermission('integration.edit');
  const showSignIn = hasPermission('auth.sso.edit');
  const showScopedPolicies = hasPermission('policy.author');
  const showGateways = hasPermission('gateway.list');
  const anyAdmin =
    showTeams || showRoles || showAssignments || showWorkflows || showPolicies || showProviderConnections || showSignIn || showGateways;

  // Requests count, hidden at 0, from the same queries and rules as the
  // pages so the numbers never disagree: for approvers, the requests
  // waiting for their decision; for requesters, reveals that are ready.
  const pending = useRequests({ status: 'pending' }, { enabled: canApprove && !!me });
  const mine = useRequests({ requester_id: me }, { enabled: !canApprove && canRequest && !!me });
  const mineRows = useMemo(() => (mine.data ?? []).filter((r) => r.requester_id === me), [mine.data, me]);
  const reveal = useRevealConditions(canApprove ? [] : mineRows, me);
  const decisionCount = useMemo(
    () => (canApprove ? needsMyDecision(pending.data ?? [], me).length : 0),
    [canApprove, pending.data, me],
  );
  const readyCount = useMemo(
    () => [...reveal.values()].filter((c) => c.state === 'ready').length,
    [reveal],
  );
  const requestsCount = canApprove ? decisionCount : readyCount;
  const requestsCountLabel = canApprove
    ? `${decisionCount} waiting for your decision`
    : `${readyCount} ready to reveal`;

  const inboxCount = useInboxCount({ enabled: showInbox });
  const inboxBadge = showInbox ? inboxCount.data?.total : undefined;

  // People waiting for an admin's approval (api#266), for whoever can
  // approve them.
  // The list needs a global grant; a team-scoped one gets a 403, and
  // then there's no Users page for this admin to use.
  const waiting = usePendingUsers({ enabled: showAssignments });
  const showUsers = showAssignments && !pendingForbidden(waiting.error);
  const waitingBadge = showUsers ? waiting.data?.total : undefined;

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      <NavItem to="/" end label="Overview" icon={<OverviewIcon size={16} />} />
      {showRequests && (
        <NavItem
          to="/requests"
          label="Requests"
          icon={<RequestIcon size={16} />}
          count={requestsCount}
          countLabel={requestsCountLabel}
        />
      )}
      {showInbox && (
        <NavItem
          to="/inbox"
          label="Inbox"
          icon={<InboxIcon size={16} />}
          count={inboxBadge}
          countLabel={`${inboxBadge ?? 0} waiting for your team's values`}
        />
      )}
      {showSecrets && <NavItem to="/secrets" label="Secrets" icon={<CatalogIcon size={16} />} />}
      {showAgents && <NavItem to="/agents" label="Agents" icon={<AgentIcon size={16} />} />}
      {showAudit && <NavItem to="/audit" label="Audit" icon={<AuditIcon size={16} />} />}

      <NavGroup label="Projects">
        <NavItem to="/projects" end label="My projects" />
        {showScopedPolicies && <NavItem to="/projects/policies" label="Project policies" />}
        {showScopedPolicies && <NavItem to="/teams/policies" label="Team policies" />}
      </NavGroup>

      {anyAdmin && (
        <NavGroup label="Admin">
          {showTeams && <NavItem to="/admin/projects" label="Projects" />}
          {showTeams && <NavItem to="/admin/teams" label="Teams" />}
          {showRoles && <NavItem to="/admin/roles" label="Roles" />}
          {showUsers && (
            <NavItem
              to="/admin/users"
              label="Users"
              count={waitingBadge}
              countLabel={`${waitingBadge ?? 0} waiting for approval`}
            />
          )}
          {showAssignments && <NavItem to="/admin/assignments" label="Assignments" />}
          {showWorkflows && <NavItem to="/admin/workflows" label="Workflows" />}
          {showPolicies && <NavItem to="/admin/policies" label="Policies" />}
          {showPolicies && <NavItem to="/admin/platform-settings" label="Platform settings" />}
          {showProviderConnections && <NavItem to="/admin/provider-connections" label="Provider connections" />}
          {showGateways && <NavItem to="/admin/gateways" label="Gateways" />}
          {showSignIn && <NavItem to="/admin/sign-in" label="Sign-in" />}
        </NavGroup>
      )}

      {meStatus === 'loading' && (
        <p className="px-2 pt-3 text-caption text-muted" role="status">
          Loading your access…
        </p>
      )}
    </nav>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4 flex flex-col gap-0.5">
      <p className="px-2 pb-1 text-label text-muted">{label}</p>
      {children}
    </div>
  );
}

function NavItem({
  to,
  label,
  icon,
  count,
  countLabel,
  end,
}: {
  to: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  countLabel?: string;
  // NavLink matches by prefix; `end` keeps "/" from matching every route.
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'group flex h-8 shrink-0 items-center gap-[9px] rounded-sm px-2 text-body max-[900px]:h-11 ' +
        (isActive ? 'bg-sunken font-semibold text-ink' : 'font-medium text-ink hover:bg-sunken')
      }
    >
      {icon && (
        <span className="text-muted group-aria-[current=page]:text-accent">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          aria-label={countLabel}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-accent px-[5px] font-mono text-[11px] font-medium text-on-accent"
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}

function SidebarFooter({ onSignOut }: { onSignOut: () => void }) {
  const { identity } = useAuth();
  const navigate = useNavigate();
  if (!identity) return null;
  return (
    <div className="mt-2 border-t border-border pt-2.5">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 pl-1.5 pr-0.5">
        <Avatar name={identity.display_name} small />
        <button
          type="button"
          onClick={() => navigate('/me')}
          className="flex min-w-0 flex-col rounded-sm text-left leading-tight hover:underline"
          title="Your profile"
        >
          <span className="truncate text-ui font-medium text-ink">{identity.display_name}</span>
          <span className="truncate text-label font-normal text-muted">{roleLabelFor(identity.permissions)}</span>
        </button>
        <ThemeToggle />
      </div>

      {!identity.mfa_enrolled && (
        <button
          type="button"
          onClick={() => navigate('/me/mfa')}
          className="mt-2.5 w-full rounded-md border border-accent-line bg-accent-soft px-2.5 py-2 text-left text-caption text-ink hover:underline"
        >
          <span className="font-semibold">Add a second factor.</span> Approving and revealing need one.
        </button>
      )}

      <div className="mt-2 flex items-center gap-3 whitespace-nowrap px-1.5 text-caption">
        <button type="button" onClick={() => navigate('/me/mfa')} className="text-muted hover:text-ink hover:underline">
          Second factor
        </button>
        <button type="button" onClick={onSignOut} className="text-muted hover:text-ink hover:underline">
          Sign out
        </button>
      </div>
      <div className="mt-2 px-1.5">
        <VersionChip />
      </div>
    </div>
  );
}

function MobileNav({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const openedAt = useRef(location.pathname);
  // Following a link closes the menu, and the new page's heading takes
  // focus (the shell does that), so the menu doesn't hand focus back to
  // its button in that case.
  const navigated = useRef(false);
  useModalFocus(ref, onClose, undefined, () => !navigated.current);
  useEffect(() => {
    if (location.pathname !== openedAt.current) {
      navigated.current = true;
      onClose();
    }
  }, [location.pathname, onClose]);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="absolute bottom-0 left-0 top-0 flex w-[min(300px,86%)] flex-col bg-surface p-3 shadow-overlay"
      >
        <div className="flex items-center justify-between px-1 pb-3.5">
          <Logo size={20} textSize={15} product="Console" />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            data-autofocus
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-sunken"
          >
            <CloseIcon />
          </button>
        </div>
        <Navigation />
        <SidebarFooter onSignOut={onSignOut} />
      </div>
    </div>
  );
}

// --- people ---------------------------------------------------------

// The api has no "kind of user" field, so the subtitle is read from the
// permission set. "No role" is the honest label for a signed-in user
// with zero grants (e.g. an OIDC user not yet in any mapped group).
function roleLabelFor(perms: string[]): string {
  if (perms.includes('role.edit') || perms.includes('user_role.edit')) return 'Platform admin';
  if (perms.includes('secret.security.approve')) return 'Security approver';
  if (perms.includes('secret.approve')) return 'Approver';
  if (perms.includes('secret.value.provide')) return 'Value provider';
  if (perms.includes('secret.request')) return 'Requester';
  if (perms.length === 0) return 'No role';
  return 'Member';
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const second = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + second).toUpperCase();
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent ' +
        (small ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-[12px]')
      }
    >
      {initialsOf(name)}
    </span>
  );
}
