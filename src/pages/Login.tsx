/**
 * Login page (`/login`).
 *
 * Slice C: cookie-only auth. The api sets an HttpOnly cookie on
 * successful login and the SPA never sees the token value. After a
 * successful submit we call `auth.refresh()` (re-fetches /users/me)
 * and navigate away.
 *
 * Sign-in buttons: one per option from GET /api/v1/auth/providers
 * (Google set from the console, the env-var SSO), above the local
 * form. Each links to its start URL with `return_to=<current url>`.
 * After the provider and the callback, the same cookie is set and the
 * SPA boots normally. A refused Google sign-in comes back with
 * ?error=sso and gets one message, whatever the reason. An older api
 * without the list falls back to probing the env-var SSO.
 *
 * Hard rules retained from earlier slices:
 *   - The password field uses `type="password"` + autoComplete so
 *     the browser can autofill but the SPA never logs it.
 *   - Local form state cleared as soon as the submit promise
 *     settles (success OR failure).
 */

import { useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useLogin } from '../api/auth';
import { useOidcAvailable } from '../api/oidc';
import { useSignInOptions, type SignInOption } from '../api/sso';
import { useAuth } from '../auth/AuthContext';
import { loginReturnTarget } from '../auth/sessionExpiry';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { AgentIcon, ApprovalIcon, AuditIcon, RequestIcon } from '../ui/icons';
import { Logo } from '../ui/Logo';

// We intentionally DON'T use z.email() — its regex rejects bare-host
// addresses like `admin@localhost` which are valid for local-dev
// bootstrap. The api enforces the real shape (lowercase + non-empty
// CHECK + DB unique) so the UI just needs a permissive sanity guard.
const schema = z.object({
  email: z
    .string()
    .min(3, 'Enter your email address.')
    .max(255)
    .refine((v) => v.includes('@'), {
      message: 'Enter your email address, with an @.',
    }),
  password: z.string().min(1, 'Enter your password.').max(255),
});

type FormShape = z.infer<typeof schema>;

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { identity, meStatus, refresh } = useAuth();
  const login = useLogin();
  // The api lists its sign-in options (Google set from the console, the
  // env-var SSO). An older api has no list; then fall back to probing
  // the env-var SSO.
  const options = useSignInOptions();
  const oidc = useOidcAvailable({ enabled: options.isError });
  const providers: SignInOption[] = options.data
    ?? (oidc.enabled ? [{ type: 'oidc', display_name: 'single sign-on', start_url: '/api/v1/auth/oidc/start' }] : []);

  const [serverError, setServerError] = useState<string | null>(null);

  // Where to send the user after sign-in. Preserved across the OIDC
  // round-trip via the `return_to` query param on /auth/oidc/start.
  // Comes from RequireAuth's router state, or from `?return_to=` when
  // an expired session hard-navigated here (UI-N-05). Either way it's
  // normalized to a strict same-origin relative path (ui#96 / UI-02),
  // since it flows into a URL query param the api stores and redirects
  // to verbatim.
  const returnTo = loginReturnTarget(
    (location.state as { from?: { pathname?: string } })?.from?.pathname,
    location.search,
  );

  // Bounce away from /login as soon as identity hydrates. Covers
  // two cases:
  //   1. User completed OIDC callback → api set the cookie → browser
  //      landed back on /login somehow (browser-back or operator
  //      manually typed /login while signed in) → identity flips to
  //      ready → we redirect to dashboard.
  //   2. User had a live session in another tab and opened /login;
  //      same flip, same redirect.
  // Gated on meStatus===ready so we never preempt the loading phase.
  // A refused Google sign-in lands here with ?error=sso. The api sends
  // the same answer whatever the reason, so the message can't say more.
  // A signed-in user can land here too, when a Connect or Test round
  // trip failed before the api knew which one it was (another browser,
  // or it took too long): they get a way back instead of a silent bounce.
  const ssoRefused = new URLSearchParams(location.search).get('error') === 'sso';
  const signedIn = meStatus === 'ready' && !!identity;

  useEffect(() => {
    if (signedIn && !ssoRefused) {
      navigate(returnTo, { replace: true });
    }
  }, [signedIn, ssoRefused, navigate, returnTo]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    setServerError(null);
    try {
      await login.mutateAsync(data);
      // The api set the HttpOnly session cookie on its 200 response.
      // The SPA never sees the token value. Refresh /users/me so
      // AuthContext flips to `meStatus === 'ready'`, then navigate.
      refresh();

      // Best-effort: drop the typed password from form state
      // immediately. React Hook Form's reset clears its internal
      // store; the input nodes re-render with empty values.
      reset({ email: '', password: '' });

      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // The api answers a generic 401 for any wrong email or
        // password, and 429 while an account or address is locked out
        // after repeated failures.
        setServerError(
          err.status === 401
            ? "That email and password didn't match. Check them and try again."
            : err.status === 429
              ? 'Too many attempts. Wait 15 minutes before you try again, or ask an administrator.'
              : `${err.status}: ${err.message}`,
        );
      } else {
        setServerError(err instanceof Error ? err.message : String(err));
      }
      reset({ ...{ email: '' }, password: '' }, { keepValues: true });
    } finally {
      // Drop the mutation (its variables hold the password) from the
      // MutationCache on success AND failure (ui#96 / UI-03, UI-N-02).
      // The error banner reads `serverError`, not the mutation.
      login.reset();
    }
  };

  // A session that ended (expired, revoked, signed out elsewhere) sends
  // the tab here with ?return_to=, so say why.
  const sessionEnded = new URLSearchParams(location.search).has('return_to');

  useEffect(() => {
    document.title = 'Sign in · Secrets Bridge';
  }, []);

  return (
    <div className="grid min-h-full bg-bg min-[1000px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center min-[1000px]:hidden">
            <Logo size={24} product="Console" />
          </div>

          {signedIn && ssoRefused ? (
            <div className="flex flex-col gap-[18px] rounded-md border border-border bg-surface px-6 py-6">
              <h1 id="page-title" className="text-console-title text-ink">
                Google didn’t finish
              </h1>
              <Banner tone="error">
                The round trip to Google took too long, or it finished in another browser. Start it again from the page
                you were on.
              </Banner>
              <Link
                to="/"
                replace
                className="inline-flex h-(--control-touch) items-center justify-center rounded-md border border-accent bg-accent px-3 text-ui font-semibold text-on-accent hover:brightness-110"
              >
                Back to the console
              </Link>
            </div>
          ) : (
          <form
            onSubmit={handleSubmit(onValid)}
            noValidate
            className="flex flex-col gap-[18px] rounded-md border border-border bg-surface px-6 py-6"
          >
            <div>
              <h1 id="page-title" className="text-console-title text-ink">
                Sign in
              </h1>
              <p className="mt-1 text-body text-muted">
                {providers.length > 0
                  ? 'Use your organization’s account, or a local account.'
                  : 'Use the local account an administrator gave you.'}
              </p>
            </div>

            {ssoRefused && (
              <Banner tone="error" title="You couldn’t be signed in with that account.">
                Use your organization’s account, or ask an administrator.
              </Banner>
            )}

            {sessionEnded && !serverError && !ssoRefused && (
              <Banner>Your session ended. Sign in to continue where you were.</Banner>
            )}

            {providers.length > 0 && (
              <>
                {providers.map((p, i) => (
                  <a
                    key={p.type}
                    href={`${p.start_url}?return_to=${encodeURIComponent(returnTo)}`}
                    className={
                      i === 0
                        ? 'inline-flex h-(--control-touch) items-center justify-center rounded-md border border-accent bg-accent px-3 text-ui font-semibold text-on-accent hover:brightness-110'
                        : 'inline-flex h-(--control-touch) items-center justify-center rounded-md border border-border bg-surface px-3 text-ui font-semibold text-ink hover:bg-sunken'
                    }
                  >
                    {signInLabel(p)}
                  </a>
                ))}
                <div className="flex items-center gap-3 text-caption text-muted">
                  <div className="h-px flex-1 bg-rule" />
                  <span>or with a local account</span>
                  <div className="h-px flex-1 bg-rule" />
                </div>
              </>
            )}

            <Field id="login-email" label="Email" error={errors.email?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  {...register('email')}
                  autoComplete="email"
                  spellCheck={false}
                  autoCapitalize="off"
                  placeholder="you@example.com"
                  disabled={login.isPending}
                  className="w-full"
                />
              )}
            </Field>

            <Field id="login-password" label="Password" error={errors.password?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  {...register('password')}
                  autoComplete="current-password"
                  spellCheck={false}
                  disabled={login.isPending}
                  className="w-full"
                />
              )}
            </Field>

            {serverError && <Banner tone="error">{serverError}</Banner>}

            <Button
              type="submit"
              variant={providers.length > 0 ? 'secondary' : 'primary'}
              className="h-(--control-touch) w-full"
              disabled={login.isPending}
              aria-busy={login.isPending}
            >
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="border-t border-rule pt-3 text-center text-caption text-muted">
              Your session lives on the server. This page never stores a token or a secret value.
            </p>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

function signInLabel(p: SignInOption): string {
  if (p.type === 'oidc') return 'Sign in with single sign-on';
  return `Sign in with ${p.display_name || p.type}`;
}

const FLOW = [
  { icon: RequestIcon, title: 'Ask for access', line: 'Name the secret, the keys and why. Never a value.' },
  { icon: ApprovalIcon, title: 'Someone approves', line: 'The policy decides how many approvals, and from whom.' },
  { icon: AgentIcon, title: 'The agent reads it', line: 'Inside your boundary. It only ever calls out.' },
  { icon: AuditIcon, title: 'Reveal once', line: 'Behind your second factor, and on the record.' },
];

/** What the console is for, beside the form on wide screens. */
export function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between border-r border-border bg-surface px-14 py-12 min-[1000px]:flex">
      <Logo size={24} product="Console" />
      <div className="max-w-[520px]">
        <p className="text-[44px] font-semibold leading-[48px] tracking-[-0.025em] text-ink">Govern who uses your secrets.</p>
        <p className="mt-4 text-[17px] leading-[27px] text-muted">
          We keep requests, approvals and audit metadata. Your secret values stay in your provider.
        </p>
        <ol className="mt-10 grid list-none grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border p-0">
          {FLOW.map(({ icon: Icon, title, line }) => (
            <li key={title} className="bg-surface px-4 py-4">
              <Icon size={20} className="text-accent" />
              <p className="mt-3 text-body font-semibold text-ink">{title}</p>
              <p className="mt-1 text-caption text-muted">{line}</p>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-caption text-muted">Values never pass through this page. Each one is revealed once, on the request it belongs to.</p>
    </aside>
  );
}
