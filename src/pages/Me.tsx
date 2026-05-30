/**
 * /me — caller's profile page. Renders identity + team memberships +
 * accessible projects + the live permission set. Data is read from
 * AuthContext (auto-hydrated by AuthProvider's /users/me query).
 */

import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

export function Me() {
  const { identity, me, meStatus } = useAuth();

  if (!identity) {
    return (
      <div>
        <PageHeader title="Profile" description="" />
        <Card className="p-10 text-center text-muted text-sm">
          You're not signed in. <Link to="/login" className="text-accent underline">Go to login</Link>.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profile"
        description={
          meStatus === 'loading'
            ? 'Hydrating profile from /users/me…'
            : meStatus === 'error'
              ? 'Could not hydrate /users/me. Try signing out and back in.'
              : 'Who you are, which teams you belong to, and what you can do in this install.'
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        {/* identity */}
        <Card className="p-5 space-y-3">
          <h3 className="text-text font-semibold">Identity</h3>
          <ProfileRow label="Display name" value={identity.display_name} />
          <ProfileRow label="Email" value={identity.email} mono />
          <ProfileRow label="User ID" value={identity.id} mono />
        </Card>

        {/* permissions */}
        <Card className="p-5 space-y-3">
          <h3 className="text-text font-semibold">
            Permissions <span className="text-muted text-xs font-normal">({identity.permissions.length})</span>
          </h3>
          {identity.permissions.length === 0 ? (
            <div className="text-muted text-sm">
              {meStatus === 'loading' ? 'Loading…' : 'No permissions granted on this account.'}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {identity.permissions.map((p) => (
                <StatusPill key={p} variant="accent" tone="outline">
                  <span className="font-mono">{p}</span>
                </StatusPill>
              ))}
            </div>
          )}
          <p className="text-muted text-xs">
            Sidebar items + action buttons are gated by membership in this list.
          </p>
        </Card>

        {/* teams */}
        <Card className="p-5 space-y-3">
          <h3 className="text-text font-semibold">
            Teams <span className="text-muted text-xs font-normal">({me?.teams.length ?? 0})</span>
          </h3>
          {(me?.teams ?? []).length === 0 ? (
            <div className="text-muted text-sm">No direct team memberships.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {me!.teams.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-text font-mono text-sm truncate">{t.name}</div>
                    {t.parent_team_id && (
                      <div className="text-muted text-[11px] truncate">
                        under {t.parent_team_id}
                      </div>
                    )}
                  </div>
                  {t.status === 'archived' ? (
                    <StatusPill variant="warning" tone="outline">archived</StatusPill>
                  ) : (
                    <StatusPill variant="success" tone="outline">active</StatusPill>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted text-xs">
            Direct memberships only. Section heads see reports' work via team-scoped role grants; that subtree is computed server-side and not listed here.
          </p>
        </Card>

        {/* projects */}
        <Card className="p-5 space-y-3">
          <h3 className="text-text font-semibold">
            Accessible projects <span className="text-muted text-xs font-normal">({me?.projects.length ?? 0})</span>
          </h3>
          {(me?.projects ?? []).length === 0 ? (
            <div className="text-muted text-sm">No project access granted.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {me!.projects.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-text font-mono text-sm truncate">{p.name}</div>
                    <div className="text-muted text-[11px] truncate">{p.id}</div>
                  </div>
                  {p.status === 'archived' ? (
                    <StatusPill variant="warning" tone="outline">archived</StatusPill>
                  ) : (
                    <StatusPill variant="success" tone="outline">active</StatusPill>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted text-xs">
            Includes projects directly granted to you AND projects under any team subtree your role scope covers.
          </p>
        </Card>
      </div>
    </div>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted text-xs uppercase tracking-wider">{label}</div>
      <div className={'text-text text-sm mt-0.5 break-all ' + (mono ? 'font-mono' : '')}>{value}</div>
    </div>
  );
}
