/**
 * /me — the signed-in person's profile: who they are, their second
 * factor, the projects and environments they can work in, their direct
 * teams and their permissions. Read from AuthContext (/users/me).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { logoUrl } from '../api/logos';
import {
  takeTicketFromHash,
  useConnectProvider,
  useDisconnectProvider,
  useFinishSSO,
  useMyIdentities,
  useSignInOptions,
} from '../api/sso';
import { ssoErrorText } from '../api/ssoErrors';
import { useAuth } from '../auth/AuthContext';
import { formatShort } from '../lib/time';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/toastContext';
import { EntityMark } from '../ui/EntityMark';
import { EnvTag } from '../ui/EnvTag';
import { PageHeader } from '../ui/PageHeader';

export function Me() {
  const { identity, me, meStatus } = useAuth();

  if (!identity) {
    return (
      <div>
        <PageHeader title="Profile" />
        <p className="text-muted">
          You're not signed in.{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  const teams = me?.teams ?? [];
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name;
  const projects = me?.projects ?? [];

  return (
    <div>
      <PageHeader
        title="Profile"
        description="Who you are, where you can work and what you can do here."
      />
      {meStatus === 'error' && (
        <Banner tone="error" title="Couldn't load your profile." className="mb-6">
          Try signing out and back in.
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-6 min-[1100px]:grid-cols-2">
        <Panel title="You">
          <Rows
            rows={[
              ['Name', identity.display_name],
              ['Email', identity.email],
              ['User id', <span key="id" className="break-all font-mono text-mono">{identity.id}</span>],
            ]}
          />
        </Panel>

        <Panel title="Second factor">
          <div className="px-5 py-4">
            <p className="text-body">
              {identity.mfa_enrolled
                ? 'You have a second factor. Approving, rejecting and revealing ask for it.'
                : "You haven't added a second factor yet. You need one to approve, reject or reveal."}
            </p>
            <Link
              to="/me/mfa"
              className={
                'mt-3 inline-flex h-(--control-md) items-center rounded-md border px-3 text-ui font-medium max-md:h-(--control-touch) ' +
                (identity.mfa_enrolled
                  ? 'border-edge bg-surface text-ink hover:bg-sunken'
                  : 'border-accent bg-accent font-semibold text-on-accent hover:brightness-110')
              }
            >
              {identity.mfa_enrolled ? 'Manage factors' : 'Add a second factor'}
            </Link>
          </div>
        </Panel>

        <GooglePanel />

        <Panel title="Projects you can work in" count={projects.length}>
          {projects.length === 0 ? (
            <p className="px-5 py-4 text-muted">No project access yet. Ask an administrator for access.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {projects.map((p) => (
                <li key={p.id} className="border-t border-rule px-5 py-3 first:border-t-0">
                  <p className="flex items-center gap-2 text-body font-medium text-ink">
                    <EntityMark name={p.name} src={logoUrl('project', p.id, p.logo_version)} />
                    {p.name}
                    {p.status === 'archived' && <span className="text-caption font-normal text-muted">archived</span>}
                  </p>
                  {(p.environments ?? []).length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {(p.environments ?? []).map((e) => (
                        <Link key={e.id} to={`/projects/${p.id}/env/${e.id}`} className="hover:underline" title={`Open ${p.name} · ${e.name}`}>
                          <EnvTag kind={e.kind}>{e.name}</EnvTag>
                        </Link>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-rule px-5 py-3 text-caption text-muted">
            Projects granted to you directly, and projects under any team your role covers.
          </p>
        </Panel>

        <Panel title="Teams" count={teams.length}>
          {teams.length === 0 ? (
            <p className="px-5 py-4 text-muted">You aren't a direct member of any team.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {teams.map((t) => (
                <li key={t.id} className="border-t border-rule px-5 py-3 first:border-t-0">
                  <p className="flex items-center gap-2 text-body font-medium text-ink">
                    <EntityMark name={t.name} kind="team" src={logoUrl('team', t.id, t.logo_version)} />
                    {t.name}
                    {t.status === 'archived' && <span className="text-caption font-normal text-muted">archived</span>}
                  </p>
                  {t.parent_team_id && teamName(t.parent_team_id) && (
                    <p className="text-caption text-muted">Part of {teamName(t.parent_team_id)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-rule px-5 py-3 text-caption text-muted">
            Direct memberships only. Access through a parent team comes from team-scoped grants.
          </p>
        </Panel>

        <div className="min-[1100px]:col-span-2">
          <Panel title="Permissions" count={identity.permissions.length}>
            <div className="px-5 py-4">
              {identity.permissions.length === 0 ? (
                <p className="text-muted">{meStatus === 'loading' ? 'Loading…' : 'No permissions on this account yet.'}</p>
              ) : (
                <p className="flex flex-wrap gap-1.5">
                  {[...identity.permissions].sort().map((p) => (
                    <span key={p} className="inline-flex h-[22px] items-center rounded-sm border border-border bg-sunken px-[7px] font-mono text-[12px]">
                      {p}
                    </span>
                  ))}
                </p>
              )}
              <p className="mt-3 text-caption text-muted">
                The sidebar and buttons follow this list. The api still checks every action, and a permission may only
                apply to some projects.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * Connect Google to this account, so the owner can sign in with it
 * (api#267). Accounts are never linked by email: the owner connects it
 * here, on their own session and after a fresh second factor. Google
 * sends the browser back with a one-time ticket in the URL fragment,
 * which this panel redeems on the same session.
 */
function GooglePanel() {
  const options = useSignInOptions();
  const identities = useMyIdentities();
  const connect = useConnectProvider('google');
  const disconnect = useDisconnectProvider('google');
  const finish = useFinishSSO('google');
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const ticket = takeTicketFromHash();
    if (!ticket) return;
    finish.mutate(ticket, { onSuccess: () => toast('Google is connected. You can sign in with it now.') });
    // Redeem once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linked = identities.data?.find((i) => i.provider_type === 'google');
  const offered = options.data?.some((o) => o.type === 'google') ?? false;
  if (!linked && !offered && !finish.isError) return null;

  return (
    <Panel title="Google">
      <div className="px-5 py-4">
        {linked ? (
          <p className="text-body">
            Connected to <span className="font-medium text-ink">{linked.email}</span> since {formatShort(linked.linked_at)}. You can
            sign in with Google instead of your password.
          </p>
        ) : (
          <p className="text-body">Connect your Google account to sign in with it instead of your password.</p>
        )}
        {finish.isError && (
          <Banner tone="error" className="mt-3" title="Google wasn't connected.">
            {ssoErrorText(finish.error)}
          </Banner>
        )}
        {connect.isError && (
          <Banner tone="error" className="mt-3">
            {ssoErrorText(connect.error)}
          </Banner>
        )}
        <div className="mt-3">
          {linked ? (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Disconnect…
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={connect.isPending}
              aria-busy={connect.isPending}
              onClick={async () => {
                try {
                  const { redirect_url } = await connect.mutateAsync();
                  window.location.assign(redirect_url);
                } catch {
                  // Shown above.
                }
              }}
            >
              {connect.isPending ? 'Connecting…' : 'Connect Google'}
            </Button>
          )}
        </div>
      </div>
      {confirming && linked && (
        <ConfirmModal
          title="Disconnect Google?"
          body={`You won't be able to sign in with ${linked.email} any more. Sign in with your password instead, or connect Google again later.`}
          confirmText="Disconnect"
          danger
          onCancel={() => {
            disconnect.reset();
            setConfirming(false);
          }}
          onConfirm={async () => {
            try {
              await disconnect.mutateAsync();
              toast('Google is disconnected.');
              setConfirming(false);
            } catch {
              // Shown in the dialog.
            }
          }}
          loading={disconnect.isPending}
          error={disconnect.error}
        />
      )}
    </Panel>
  );
}

function Panel({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <h2 className="border-b border-rule px-5 py-3.5 text-block-heading text-ink">
        {title}
        {count !== undefined && <span className="ml-2 font-mono text-mono-small font-normal text-muted">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 px-5 py-1">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
