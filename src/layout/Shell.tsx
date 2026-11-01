import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { roleLabelFor } from '../auth/roleLabel';
import { useInboxCount } from '../api/crossTeam';
import { useMe } from '../api/me';
import { useRequests } from '../api/requests';
import { needsMyDecision } from '../lib/requestQueues';
import { useRevealConditions } from '../requests/revealState';
import { ALL_SCOPES, scopeOptions, useScope } from '../requests/scope';
import { useRequestDetails } from '../requests/useRequestDetails';
import { Avatar } from '../ui/Avatar';
import { ConfirmModal } from '../ui/ConfirmModal';
import {
  AdminIcon,
  AgentIcon,
  ApprovalIcon,
  AuditIcon,
  CatalogIcon,
  CloseIcon,
  FolderIcon,
  InboxIcon,
  MenuIcon,
  OverviewIcon,
  PolicyIcon,
  RequestIcon,
  TargetIcon,
} from '../ui/icons';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useModalFocus } from '../ui/useModalFocus';
import { VersionChip } from '../ui/VersionChip';
import { NavItem } from './NavItem';
import { useAdminSections } from './useAdminSections';

/**
 * Console shell: a 240px sidebar and the page. At 900px and below the
 * sidebar becomes a menu button in a top bar that opens the same
 * navigation in a modal panel.
 *
 * - Nav items are gated by the live permission set and stay hidden
 *   until /users/me resolves (fail-closed). Hiding a link is not
 *   authorization; the api decides.
 * - No organization switcher, no environment toggle and no search
 *   field: none of them exist behind the UI.
 * - The top bar holds the scope for the pages that follow it, and Docs.
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
        className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-ui font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside
        aria-label="Console"
        className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col border-r border-border bg-side px-3 pb-3.5 pt-[18px] max-[900px]:hidden"
      >
        <SidebarContent onSignOut={openSignOut} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 hidden h-14 items-center gap-1.5 border-b border-border bg-side pl-1.5 pr-2.5 max-[900px]:flex">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-hover"
          >
            <MenuIcon />
          </button>
          <NavLink to="/" aria-label="Secrets Bridge console, overview" className="px-1">
            <Logo size={22} textSize={17} />
          </NavLink>
          <span className="flex-1" />
          <ThemeToggle className="h-11 w-11" />
          {identity && <Avatar name={identity.display_name} />}
        </header>

        <TopBar />

        <main ref={mainRef} id="main" tabIndex={-1} className="flex-1 px-8 pb-14 pt-7 max-[900px]:px-4 max-[900px]:pb-10 max-[900px]:pt-5">
          <div className="w-full max-w-[1240px]">
            <Outlet />
          </div>
        </main>

        <BottomTabs />
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

// --- top bar --------------------------------------------------------

// The pages the scope filters. Everything else shows only Docs.
const SCOPED_PATHS = ['/', '/approvals', '/requests'];

function TopBar() {
  const { pathname } = useLocation();
  const { scope, setScope } = useScope();
  const me = useMe();
  const scopes = useMemo(() => scopeOptions(me.data?.projects), [me.data]);
  const scoped = SCOPED_PATHS.includes(pathname) && scopes.length > 0;
  return (
    <div
      className={
        'flex min-h-[60px] flex-wrap items-center gap-3 border-b border-border px-8 py-2.5 max-[900px]:min-h-0 max-[900px]:px-4 max-[900px]:py-2 ' +
        (scoped ? '' : 'max-[900px]:hidden')
      }
    >
      {scoped && (
        <>
          <label className="inline-flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface pl-3 text-[13.5px] font-medium text-ink">
            <span className="text-muted">Scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="select-chevron h-full min-w-0 max-w-[260px] rounded-md bg-transparent pr-8 font-medium text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent-ink"
            >
              <option value={ALL_SCOPES}>All my scopes</option>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-caption text-muted max-[1100px]:hidden">Overview, Approvals and Requests follow this scope.</span>
        </>
      )}
      <span className="flex-1" />
      <a
        href="https://secrets-bridge.io"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-(--control-sm) items-center rounded-md px-[11px] text-[13px] font-semibold text-ink hover:bg-hover"
      >
        Docs
      </a>
    </div>
  );
}

// --- navigation -----------------------------------------------------

function SidebarContent({ onSignOut }: { onSignOut: () => void }) {
  return (
    <>
      <NavLink to="/" aria-label="Secrets Bridge console, overview" className="mb-[22px] block px-2 pt-0.5">
        <Logo size={24} textSize={18} />
      </NavLink>
      <Navigation />
      <SidebarFooter onSignOut={onSignOut} />
    </>
  );
}

// Counts, hidden at 0, from the same queries and rules as the pages so
// the numbers never disagree: on Approvals, the requests waiting for
// this person's decision; on Requests, reveals that are ready. The
// detail lookup adds the votes the list rows don't carry.
function useNavCounts() {
  const { identity, hasPermission } = useAuth();
  const me = identity?.id ?? '';
  const canApprove = hasPermission('secret.approve');
  const canRequest = hasPermission('secret.request');
  const showInbox = hasPermission('secret.value.provide');
  const pending = useRequests({ status: 'pending' }, { enabled: canApprove && !!me });
  const mine = useRequests({ requester_id: me }, { enabled: canRequest && !!me });
  const mineRows = useMemo(() => (mine.data ?? []).filter((r) => r.requester_id === me), [mine.data, me]);
  const reveal = useRevealConditions(mineRows, me);
  const candidates = useMemo(() => (canApprove ? needsMyDecision(pending.data ?? [], me) : []), [canApprove, pending.data, me]);
  const details = useRequestDetails(useMemo(() => candidates.map((r) => r.id), [candidates]));
  const decisionCount = useMemo(
    () =>
      needsMyDecision(
        candidates.map((r) => details.get(r.id) ?? r),
        me,
      ).length,
    [candidates, details, me],
  );
  const readyCount = useMemo(
    () => [...reveal.values()].filter((c) => c.state === 'ready').length,
    [reveal],
  );

  const inboxCount = useInboxCount({ enabled: showInbox });
  return { decisionCount, readyCount, inboxBadge: showInbox ? inboxCount.data?.total : undefined };
}

function Navigation() {
  const { hasPermission, hasGlobalPermission, meStatus } = useAuth();

  // Sidebar entries gated by the live permission set:
  //   Approvals       → secret.approve
  //   Requests        → secret.request
  //   Inbox           → secret.value.provide (at any scope)
  //   Agents          → agent.list
  //   Gateways        → gateway.list, global (every /admin/gateways read
  //                     is global-only)
  //   Argo CD targets → gateway.bind at any scope, or global gateway.list
  //   Secrets         → secret.list
  //   Audit           → audit.read
  //   Project / team policies → policy.author (never auto-shown for
  //                     policy.edit holders; they use /admin/policies)
  //   Administration  → any section this person has (useAdminSections)
  const canApprove = hasPermission('secret.approve');
  const canRequest = hasPermission('secret.request');
  const showInbox = hasPermission('secret.value.provide');
  const showAgents = hasPermission('agent.list');
  const showSecrets = hasPermission('secret.list');
  const showAudit = hasPermission('audit.read');
  const showScopedPolicies = hasPermission('policy.author');
  const showGateways = hasGlobalPermission('gateway.list');
  const showTargets = hasPermission('gateway.bind') || showGateways;
  const admin = useAdminSections();

  const { decisionCount, readyCount, inboxBadge } = useNavCounts();

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-3">
      <NavItem to="/" end label="Overview" icon={<OverviewIcon />} />
      {canApprove && (
        <NavItem
          to="/approvals"
          label="Approvals"
          icon={<ApprovalIcon />}
          count={decisionCount}
          countLabel={`${decisionCount} waiting for your decision`}
        />
      )}
      {canRequest && (
        <NavItem
          to="/requests"
          label="Requests"
          icon={<RequestIcon />}
          count={readyCount}
          countLabel={`${readyCount} ready to reveal`}
          quiet
        />
      )}
      {showInbox && (
        <NavItem
          to="/inbox"
          label="Inbox"
          icon={<InboxIcon />}
          count={inboxBadge}
          countLabel={`${inboxBadge ?? 0} waiting for your team's values`}
        />
      )}

      {(showSecrets || showAgents || showAudit) && (
        <NavGroup label="Catalog and records">
          {showSecrets && <NavItem to="/secrets" label="Secrets" icon={<CatalogIcon />} />}
          {showAgents && <NavItem to="/agents" label="Agents" icon={<AgentIcon />} />}
          {showAudit && <NavItem to="/audit" label="Audit log" icon={<AuditIcon />} />}
        </NavGroup>
      )}

      <NavGroup label="Projects">
        <NavItem to="/projects" end label="My projects" icon={<FolderIcon />} />
        {showScopedPolicies && <NavItem to="/projects/policies" label="Project policies" icon={<PolicyIcon />} />}
        {showScopedPolicies && <NavItem to="/teams/policies" label="Team policies" icon={<PolicyIcon />} />}
        {showTargets && <NavItem to="/gateways" label="Argo CD targets" icon={<TargetIcon />} />}
        {admin.isAdmin && (
          <NavItem
            to="/admin"
            label="Administration"
            icon={<AdminIcon />}
            count={admin.waiting}
            countLabel={`${admin.waiting} waiting for approval`}
          />
        )}
      </NavGroup>

      {meStatus === 'loading' && (
        <p className="px-2 pt-3 text-caption text-muted" role="status">
          Loading your access…
        </p>
      )}
    </nav>
  );
}

/**
 * The phone's bottom tabs: the four places this person goes most, picked
 * from what they can open. Everything else is in the menu.
 */
function BottomTabs() {
  const { hasPermission } = useAuth();
  const { decisionCount, readyCount, inboxBadge } = useNavCounts();
  const tabs = [
    { to: '/', end: true, label: 'Overview', icon: <OverviewIcon />, show: true },
    { to: '/approvals', label: 'Approvals', icon: <ApprovalIcon />, show: hasPermission('secret.approve'), count: decisionCount, countLabel: `${decisionCount} waiting for your decision` },
    { to: '/requests', label: 'Requests', icon: <RequestIcon />, show: hasPermission('secret.request'), count: readyCount, countLabel: `${readyCount} ready to reveal` },
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon />, show: hasPermission('secret.value.provide'), count: inboxBadge, countLabel: `${inboxBadge ?? 0} waiting for your team's values` },
    { to: '/audit', label: 'Activity', icon: <AuditIcon />, show: hasPermission('audit.read') },
    { to: '/secrets', label: 'Secrets', icon: <CatalogIcon />, show: hasPermission('secret.list') },
  ]
    .filter((t) => t.show)
    .slice(0, 4);
  return (
    <nav aria-label="Quick links" className="sticky bottom-0 z-10 hidden border-t border-border bg-side max-[900px]:flex">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            'group relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-[3px] text-[11.5px] font-medium ' + (isActive ? 'text-ink' : 'text-muted')
          }
        >
          <span aria-hidden="true" className="absolute inset-x-[32%] top-0 h-0.5 group-aria-[current=page]:bg-accent-ink" />
          <span className="group-aria-[current=page]:text-accent-ink">{t.icon}</span>
          {t.label}
          {!!t.count && (
            <span aria-label={t.countLabel} className="absolute left-[calc(50%+6px)] top-[7px] min-w-[18px] rounded-sm bg-accent px-[5px] text-center font-mono text-[11px] font-semibold leading-[18px] text-on-accent">
              {t.count}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-[22px] flex flex-col gap-0.5">
      <p className="px-2.5 pb-1.5 text-[12px] font-medium leading-4 text-muted">{label}</p>
      {children}
    </div>
  );
}

function SidebarFooter({ onSignOut }: { onSignOut: () => void }) {
  const { identity } = useAuth();
  const navigate = useNavigate();
  if (!identity) return null;
  return (
    <div className="flex flex-col gap-2.5 pt-2">
      {identity.mfa_enrolled ? (
        <button
          type="button"
          onClick={() => navigate('/me/mfa')}
          className="flex items-center gap-2 rounded-sm px-2.5 text-left text-caption text-muted hover:text-ink hover:underline"
        >
          <span aria-hidden="true" className="h-[9px] w-[9px] shrink-0 bg-ok" />
          Second factor on
        </button>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/me/mfa')}
          className="w-full rounded-lg border border-accent-line bg-accent-soft px-2.5 py-2 text-left text-[13px] leading-[19px] text-ink hover:underline"
        >
          <span className="font-semibold">Add a second factor.</span> Approving and revealing need one.
        </button>
      )}

      <div className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border p-2.5">
        <Avatar name={identity.display_name} size="sm" />
        <button
          type="button"
          onClick={() => navigate('/me')}
          className="flex min-w-0 flex-col rounded-sm text-left hover:underline"
          title="Your profile"
        >
          <span className="truncate text-[13.5px] font-semibold leading-[18px] text-ink">{identity.display_name}</span>
          <span className="truncate font-mono text-mono-small text-muted">{roleLabelFor(identity.permissions)}</span>
        </button>
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between gap-3 whitespace-nowrap px-2.5">
        <VersionChip />
        <button type="button" onClick={onSignOut} className="text-caption text-muted hover:text-ink hover:underline">
          Sign out
        </button>
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
        className="absolute bottom-0 left-0 top-0 flex w-[min(300px,86%)] flex-col bg-side p-3 shadow-overlay"
      >
        <div className="flex items-center justify-between px-1 pb-3.5">
          <Logo size={22} textSize={17} product="Console" />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            data-autofocus
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-hover"
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
