/**
 * What Administration offers this person, grouped by what they came to
 * do. Gated by the live permission set like the sidebar; hiding a link
 * is not authorization, the api decides.
 *
 *   Accounts          → user_role.edit, global (a team-scoped holder gets
 *                       a 403 from the list, so there's no page for them)
 *   Teams, Projects   → team.edit
 *   Roles             → role.edit
 *   Role assignments  → user_role.edit
 *   Workflows         → workflow.edit
 *   Policies, Platform settings → policy.edit
 *   Provider connections → integration.edit
 *   Gateways          → gateway.list, global
 *   Sign-in methods   → auth.sso.edit
 *
 * Agents and the person's own second factor live elsewhere; they're
 * listed here because this is where an administrator looks for them, and
 * neither one makes someone an administrator.
 */

import { pendingForbidden, usePendingUsers } from '../api/pendingUsers';
import { useAuth } from '../auth/AuthContext';

export interface AdminLink {
  to: string;
  label: string;
  count?: number;
  countLabel?: string;
  tag?: string;
  /** Lives outside Administration. */
  outside?: boolean;
}

export interface AdminSection {
  label: string;
  note?: string;
  links: AdminLink[];
}

export function useAdminSections(): { sections: AdminSection[]; first?: string; waiting: number; isAdmin: boolean } {
  const { hasPermission, hasGlobalPermission } = useAuth();
  const canAssign = hasPermission('user_role.edit');
  const canTeams = hasPermission('team.edit');
  const pending = usePendingUsers({ enabled: canAssign });
  const canUsers = canAssign && !pendingForbidden(pending.error);
  const waiting = canUsers ? (pending.data?.total ?? 0) : 0;

  const link = (show: boolean, l: AdminLink) => (show ? [l] : []);
  const sections: AdminSection[] = [
    {
      label: 'People and access',
      links: [
        ...link(canUsers, { to: '/admin/users', label: 'Accounts', count: waiting, countLabel: `${waiting} waiting for approval` }),
        ...link(canTeams, { to: '/admin/teams', label: 'Teams' }),
        ...link(hasPermission('role.edit'), { to: '/admin/roles', label: 'Roles' }),
        ...link(canAssign, { to: '/admin/assignments', label: 'Role assignments' }),
      ],
    },
    {
      label: 'Projects and secrets',
      note: 'Environments and secret bindings live inside each project.',
      links: link(canTeams, { to: '/admin/projects', label: 'Projects' }),
    },
    {
      label: 'Approval rules',
      links: [
        ...link(hasPermission('workflow.edit'), { to: '/admin/workflows', label: 'Workflows' }),
        ...link(hasPermission('policy.edit'), { to: '/admin/policies', label: 'Policies' }),
        ...link(hasPermission('policy.edit'), { to: '/admin/platform-settings', label: 'Platform settings' }),
      ],
    },
    {
      label: 'Infrastructure',
      links: [
        ...link(hasPermission('integration.edit'), { to: '/admin/provider-connections', label: 'Provider connections' }),
        ...link(hasPermission('agent.list'), { to: '/agents', label: 'Agents', outside: true }),
        ...link(hasGlobalPermission('gateway.list'), { to: '/admin/gateways', label: 'Gateways', tag: 'Preview' }),
      ],
    },
    {
      label: 'Sign-in and security',
      links: [
        ...link(hasPermission('auth.sso.edit'), { to: '/admin/sign-in', label: 'Sign-in methods' }),
        { to: '/me/mfa', label: 'Your second factor', outside: true },
      ],
    },
  ].filter((s) => s.links.length > 0);

  const inside = sections.flatMap((s) => s.links).filter((l) => !l.outside);
  return { sections, first: inside[0]?.to, waiting, isAdmin: inside.length > 0 };
}
