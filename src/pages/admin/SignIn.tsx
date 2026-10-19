/**
 * Sign-in (`/admin/sign-in`): connect Google from the console (api#267).
 *
 * Two sections:
 *   - Public address: this install's address. Google sends people back
 *     to it, so redirect URIs are built from it (never from request
 *     headers). Saved here unless SB_PUBLIC_URL sets it; then it's
 *     read-only. The cap on accounts waiting for approval sits here too.
 *   - Google: the OAuth client from Google Cloud Console (type Internal),
 *     the allowed Workspace domains, and whether new people need
 *     approval. It starts off; Test runs a real round trip with your own
 *     Google account, then Turn on shows "Sign in with Google" on the
 *     login page.
 *
 * Every change asks for a fresh second factor (client.ts runs the
 * step-up). The client secret is write-only: it goes up once in a
 * sensitive mutation and is never shown again.
 */

import { useEffect, useMemo, useState } from 'react';

import { useRoles } from '../../api/roles';
import {
  NON_PRIVILEGED_PERMISSIONS,
  takeTicketFromHash,
  useCreateSSOProvider,
  useDeleteSSOProvider,
  useFinishSSO,
  useReplaceSSOSecret,
  useSetSSOProviderEnabled,
  useSSOProviders,
  useSSOSettings,
  useStartSSOTest,
  useUpdateSSOProvider,
  useUpdateSSOSettings,
  type FinishResult,
  type SSOProvider,
  type SSOProviderInput,
  type SSOSettings,
} from '../../api/sso';
import { ssoErrorDetail, ssoErrorText, ssoReasonText } from '../../api/ssoErrors';
import type { Role } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Dialog } from '../../ui/Dialog';
import { Drawer } from '../../ui/Drawer';
import { Field, Input, Select, Textarea } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';

export function SignIn() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('auth.sso.edit');
  const settings = useSSOSettings({ enabled: allowed });
  const providers = useSSOProviders({ enabled: allowed });
  const finish = useFinishSSO('google');
  const [testResult, setTestResult] = useState<FinishResult | null>(null);

  // Back from a Test round trip: redeem the ticket on this session.
  useEffect(() => {
    if (!allowed) return;
    const ticket = takeTicketFromHash();
    if (!ticket) return;
    finish.mutate(ticket, { onSuccess: setTestResult });
    // finish is stable for this page's lifetime; run once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Sign-in" />
        <Banner title="You can't change how people sign in.">
          It needs the <code className="font-mono text-mono">auth.sso.edit</code> permission. Ask an administrator.
        </Banner>
      </div>
    );
  }

  const google = providers.data?.find((p) => p.type === 'google');

  return (
    <div>
      <PageHeader
        title="Sign-in"
        description="Let people sign in with their Google Workspace account. New accounts wait for your approval on the Users page."
      />
      <div className="flex flex-col gap-6">
        {finish.isError && (
          <Banner tone="error" title="The test result couldn't be read.">
            {ssoErrorText(finish.error)} Run the test again from this browser tab.
          </Banner>
        )}
        {testResult && testResult.result === 'ok' && (
          <Banner title="Google sign-in works.">Your Google account passed every check. Turn it on when you're ready.</Banner>
        )}
        {testResult && testResult.result === 'failed' && (
          <Banner tone="error" title="The test didn't pass.">
            {ssoReasonText(testResult.reason)}
          </Banner>
        )}

        {(settings.isError || providers.isError) && (
          <Banner tone="error">{ssoErrorText(settings.error ?? providers.error)}</Banner>
        )}

        {settings.data && <AddressSection settings={settings.data} />}

        {providers.isSuccess && settings.data && (
          google ? <GoogleSection provider={google} settings={settings.data} /> : <GoogleSetup settings={settings.data} />
        )}
      </div>
    </div>
  );
}

function Section({ id, title, description, action, children }: { id: string; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="max-w-3xl rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule px-5 py-3.5">
        <div className="min-w-0 flex-1 basis-[280px]">
          <h2 id={id} className="text-block-heading text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-caption text-muted">{description}</p>
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function addressWarning(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.hostname === 'localhost' || /^[0-9.]+$/.test(u.hostname) || u.hostname.includes(':')) {
      return 'This looks like an internal address. Use the address people open the console with.';
    }
    if (u.protocol !== 'https:') return 'Google needs https, except for localhost.';
  } catch {
    return null;
  }
  return null;
}

function AddressSection({ settings }: { settings: SSOSettings }) {
  const update = useUpdateSSOSettings();
  const toast = useToast();
  const [editing, setEditing] = useState<'address' | 'cap' | null>(null);
  const [draft, setDraft] = useState('');
  const fromEnv = settings.public_url_source === 'env';
  const warning = editing === 'address' ? addressWarning(draft) : null;

  const save = async () => {
    try {
      if (editing === 'address') {
        await update.mutateAsync({ public_url: draft.trim() });
        toast('Saved the public address.');
      } else {
        await update.mutateAsync({ pending_cap: Number(draft) });
        toast('Saved the waiting limit.');
      }
      setEditing(null);
      update.reset();
    } catch {
      // Shown below the field.
    }
  };

  return (
    <Section
      id="address-heading"
      title="Public address"
      description="The address people open this console with. Google sends them back to it after they sign in."
    >
      {editing ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-3"
        >
          {editing === 'address' ? (
            <Field
              id="public-url"
              label="Public address"
              hint={
                <>
                  Like https://secrets.example.com. Filled in from the address you're using now.
                  {/* A caution, not an error: it can still be saved. */}
                  {warning && <span className="mt-1 block font-medium text-warn">{warning}</span>}
                </>
              }
              error={update.isError ? ssoErrorText(update.error) : undefined}
            >
              {(p) => <Input {...p} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full font-mono" autoComplete="off" spellCheck={false} data-autofocus />}
            </Field>
          ) : (
            <Field
              id="pending-cap"
              label="Most accounts that can wait at once"
              hint="Past this, new Google sign-ins are turned away until you approve or decline some. Between 1 and 10,000."
              error={update.isError ? ssoErrorText(update.error) : undefined}
            >
              {(p) => <Input {...p} type="number" min={1} max={10000} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-32 font-mono" data-autofocus />}
            </Field>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={update.isPending} aria-busy={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => { setEditing(null); update.reset(); }} disabled={update.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-3 text-ui max-sm:grid-cols-1 max-sm:gap-y-0.5 max-sm:[&>dd]:mb-3">
          <dt className="text-muted">Address</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {settings.public_url ? (
              <span className="break-all font-mono text-mono text-ink">{settings.public_url}</span>
            ) : (
              <span className="text-muted">Not set</span>
            )}
            {fromEnv ? (
              <span className="text-caption text-muted">Set by SB_PUBLIC_URL on this install</span>
            ) : (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  setDraft(settings.public_url || window.location.origin);
                  setEditing('address');
                }}
              >
                {settings.public_url ? 'Change' : 'Set'}
              </Button>
            )}
          </dd>
          <dt className="text-muted">Waiting limit</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink">{settings.pending_cap.toLocaleString('en-US')} accounts at once</span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setDraft(String(settings.pending_cap));
                setEditing('cap');
              }}
            >
              Change
            </Button>
          </dd>
        </dl>
      )}
    </Section>
  );
}

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="break-all font-mono text-mono text-ink">{value}</span>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}

function GoogleSetup({ settings }: { settings: SSOSettings }) {
  const [open, setOpen] = useState(false);
  return (
    <Section
      id="google-heading"
      title="Google"
      description="Not set up. People sign in with a local account until you connect Google."
      action={
        <Button variant="primary" onClick={() => setOpen(true)}>
          Set up Google
        </Button>
      }
    >
      <ol className="ml-5 flex list-decimal flex-col gap-1.5 text-ui text-ink">
        <li>{settings.public_url ? 'Check the public address above.' : 'Set the public address above.'}</li>
        <li>In Google Cloud Console, create an OAuth client of type Internal, for a web application.</li>
        <li>Paste the redirect URL this page gives you, and copy back the client ID and secret.</li>
        <li>Test it with your own Google account, then turn it on.</li>
      </ol>
      {open && <ProviderDrawer settings={settings} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function GoogleSection({ provider, settings }: { provider: SSOProvider; settings: SSOSettings }) {
  const toast = useToast();
  const roles = useRoles();
  const setEnabled = useSetSSOProviderEnabled(provider.id);
  const startTest = useStartSSOTest(provider.id);
  const remove = useDeleteSSOProvider(provider.id);
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const defaultRole = roles.data?.find((r) => r.id === provider.default_role_id);

  const toggle = async () => {
    try {
      await setEnabled.mutateAsync(!provider.enabled);
      toast(provider.enabled ? 'Google sign-in is off.' : 'Google sign-in is on. The login page shows it now.');
      setEnabled.reset();
    } catch {
      // Shown below.
    }
  };
  const test = async () => {
    try {
      const { redirect_url } = await startTest.mutateAsync();
      window.location.assign(redirect_url);
    } catch {
      // Shown below.
    }
  };

  return (
    <Section
      id="google-heading"
      title="Google"
      description={provider.enabled ? 'People can sign in with Google on the login page.' : 'Set up, but off. Test it, then turn it on.'}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void test()} disabled={startTest.isPending} aria-busy={startTest.isPending}>
            {startTest.isPending ? 'Starting…' : 'Test'}
          </Button>
          <Button variant={provider.enabled ? 'secondary' : 'primary'} onClick={() => void toggle()} disabled={setEnabled.isPending} aria-busy={setEnabled.isPending}>
            {provider.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      }
    >
      {(setEnabled.isError || startTest.isError) && (
        <Banner tone="error" className="mb-4">
          {ssoErrorText(setEnabled.error ?? startTest.error)}
        </Banner>
      )}
      <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-3 text-ui max-sm:grid-cols-1 max-sm:gap-y-0.5 max-sm:[&>dd]:mb-3">
        <dt className="text-muted">Status</dt>
        <dd>
          <ToneStatus tone={provider.enabled ? 'ok' : 'neutral'}>{provider.enabled ? 'On' : 'Off'}</ToneStatus>
        </dd>
        <dt className="text-muted">Redirect URL</dt>
        <dd className="min-w-0">
          {provider.redirect_url ? <CopyLine value={provider.redirect_url} /> : <span className="text-muted">Set the public address first.</span>}
        </dd>
        <dt className="text-muted">Client ID</dt>
        <dd className="break-all font-mono text-mono text-ink">{provider.client_id}</dd>
        <dt className="text-muted">Client secret</dt>
        <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink">{provider.client_secret_set ? 'Saved' : 'Missing'}</span>
          <Button size="sm" variant="quiet" onClick={() => setReplacing(true)}>
            Replace…
          </Button>
        </dd>
        <dt className="text-muted">Workspace domains</dt>
        <dd className="text-ink">{provider.allowed_domains.join(', ')}</dd>
        <dt className="text-muted">New people</dt>
        <dd className="text-ink">
          {provider.require_approval
            ? 'Wait for your approval on the Users page'
            : defaultRole
              ? `Get the ${defaultRole.name} role right away`
              : 'Get in right away, with no role'}
        </dd>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Edit…
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setRemoving(true)}>
          Remove Google…
        </Button>
      </div>

      {editing && <ProviderDrawer settings={settings} provider={provider} onClose={() => setEditing(false)} />}
      {replacing && <ReplaceSecretDialog provider={provider} onClose={() => setReplacing(false)} />}
      {removing && (
        <ConfirmModal
          title="Remove Google?"
          body="People can't sign in with Google any more. Their accounts stay; they can sign in again if you set Google up again."
          confirmText="Remove Google"
          danger
          onCancel={() => {
            remove.reset();
            setRemoving(false);
          }}
          onConfirm={async () => {
            try {
              await remove.mutateAsync();
              toast('Removed Google sign-in.');
              setRemoving(false);
            } catch {
              // Shown in the dialog.
            }
          }}
          loading={remove.isPending}
          error={remove.error}
        />
      )}
    </Section>
  );
}

function eligibleDefaultRoles(roles: Role[] | undefined): Role[] {
  return (roles ?? []).filter((r) => r.permissions.length > 0 && r.permissions.every((p) => NON_PRIVILEGED_PERMISSIONS.includes(p)));
}

function ProviderDrawer({ settings, provider, onClose }: { settings: SSOSettings; provider?: SSOProvider; onClose: () => void }) {
  const toast = useToast();
  const roles = useRoles();
  const create = useCreateSSOProvider();
  const update = useUpdateSSOProvider(provider?.id ?? '');
  const mutation = provider ? update : create;
  const eligible = useMemo(() => eligibleDefaultRoles(roles.data), [roles.data]);

  const [clientID, setClientID] = useState(provider?.client_id ?? '');
  const [secret, setSecret] = useState('');
  const [domains, setDomains] = useState((provider?.allowed_domains ?? []).join('\n'));
  const [requireApproval, setRequireApproval] = useState(provider?.require_approval ?? true);
  const [defaultRole, setDefaultRole] = useState(provider?.default_role_id ?? '');
  const [tried, setTried] = useState(false);

  const domainList = domains.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean);
  const errors = {
    client_id: !clientID.trim() ? 'Paste the client ID from Google Cloud Console.' : undefined,
    client_secret: !provider && !secret.trim() ? 'Paste the client secret from Google Cloud Console.' : undefined,
    allowed_domains: domainList.length === 0 ? 'Add at least one Workspace domain, like example.com.' : undefined,
  };
  const detail = ssoErrorDetail(mutation.error);
  const fieldError = (name: keyof typeof errors) =>
    (tried ? errors[name] : undefined) ?? (detail.field === name ? ssoErrorText(mutation.error) : undefined);

  const submit = async () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const body: SSOProviderInput = {
      client_id: clientID.trim(),
      allowed_domains: domainList,
      require_approval: requireApproval,
      default_role_id: requireApproval || !defaultRole ? null : defaultRole,
      ...(provider ? {} : { client_secret: secret }),
    };
    try {
      await mutation.mutateAsync(body);
      setSecret('');
      mutation.reset();
      toast(provider ? 'Saved the Google settings.' : 'Google is set up. Test it, then turn it on.');
      onClose();
    } catch {
      // Shown below.
    }
  };

  return (
    <Drawer
      title={provider ? 'Edit Google' : 'Set up Google'}
      subtitle="From an OAuth client of type Internal in your Google Cloud project."
      onClose={() => {
        setSecret('');
        mutation.reset();
        onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="google-provider" variant="primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : provider ? 'Save' : 'Set up Google'}
          </Button>
        </>
      }
    >
      <form
        id="google-provider"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <div className="rounded-md border border-border bg-sunken px-3.5 py-3 text-ui">
          <p className="font-semibold text-ink">Redirect URL for Google Cloud Console</p>
          {provider?.redirect_url || settings.public_url ? (
            <div className="mt-1">
              <CopyLine value={provider?.redirect_url || `${settings.public_url}/api/v1/auth/sso/google/callback`} />
            </div>
          ) : (
            <p className="mt-1 text-muted">Set the public address on this page first; the redirect URL is built from it.</p>
          )}
        </div>

        <Field id="google-client-id" label="Client ID" error={fieldError('client_id')}>
          {(p) => (
            <Input {...p} value={clientID} onChange={(e) => setClientID(e.target.value)} className="w-full font-mono" autoComplete="off" spellCheck={false} placeholder="123456789-abc.apps.googleusercontent.com" data-autofocus />
          )}
        </Field>

        {!provider && (
          <Field id="google-client-secret" label="Client secret" hint="Saved encrypted and never shown again." error={fieldError('client_secret')}>
            {(p) => <Input {...p} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="w-full font-mono" autoComplete="new-password" spellCheck={false} />}
          </Field>
        )}

        <Field
          id="google-domains"
          label="Workspace domains"
          hint="One per line. Only accounts in these Google Workspace domains can sign in."
          error={fieldError('allowed_domains')}
        >
          {(p) => <Textarea {...p} rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} className="w-full font-mono" spellCheck={false} placeholder="example.com" />}
        </Field>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1.5 text-body font-semibold text-ink">New people</legend>
          <label className="flex items-start gap-2.5 text-ui font-normal">
            <input type="radio" name="google-approval" checked={requireApproval} onChange={() => setRequireApproval(true)} className="mt-1 accent-accent" />
            <span>
              Wait for approval <span className="text-muted">(recommended)</span>
              <span className="block text-caption text-muted">You give each new person a role on the Users page.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-ui font-normal">
            <input type="radio" name="google-approval" checked={!requireApproval} onChange={() => setRequireApproval(false)} className="mt-1 accent-accent" />
            <span>
              Let them in right away
              <span className="block text-caption text-muted">Optionally with a basic role that can only list and request secrets.</span>
            </span>
          </label>
        </fieldset>

        {!requireApproval && (
          <Field
            id="google-default-role"
            label="Role for new people"
            hint="Only roles limited to secret.list, secret.request and audit.read are offered. The built-in developer role can reveal directly, so it isn't one of them."
            error={detail.code === 'default_role_privileged' ? ssoErrorText(mutation.error) : undefined}
          >
            {(p) => (
              <Select {...p} value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
                <option value="">No role</option>
                {eligible.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {mutation.isError && !detail.field && detail.code !== 'default_role_privileged' && (
          <Banner tone="error" title="Not saved.">
            {ssoErrorText(mutation.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function ReplaceSecretDialog({ provider, onClose }: { provider: SSOProvider; onClose: () => void }) {
  const replace = useReplaceSSOSecret(provider.id);
  const toast = useToast();
  const [secret, setSecret] = useState('');
  const close = () => {
    setSecret('');
    replace.reset();
    onClose();
  };
  return (
    <Dialog
      title="Replace the client secret"
      onClose={close}
      dismissible={!replace.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={replace.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={replace.isPending || !secret.trim()}
            aria-busy={replace.isPending}
            onClick={async () => {
              try {
                await replace.mutateAsync(secret);
                toast('Replaced the client secret.');
                close();
              } catch {
                // Shown below.
              }
            }}
          >
            {replace.isPending ? 'Replacing…' : 'Replace secret'}
          </Button>
        </>
      }
    >
      <Field id="google-new-secret" label="New client secret" hint="From the same OAuth client in Google Cloud Console.">
        {(p) => <Input {...p} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="w-full font-mono" autoComplete="new-password" spellCheck={false} data-autofocus />}
      </Field>
      {replace.isError && (
        <Banner tone="error" className="mt-3">
          {ssoErrorText(replace.error)}
        </Banner>
      )}
    </Dialog>
  );
}
