/**
 * Login page (`/login`).
 *
 * Slice C: cookie-only auth. The api sets an HttpOnly cookie on
 * successful login and the SPA never sees the token value. After a
 * successful submit we call `auth.refresh()` (re-fetches /users/me)
 * and navigate away.
 *
 * SSO button: when the api advertises an OIDC issuer (probe at
 * `useOidcAvailable`), a primary "Sign in with SSO" button appears
 * above the local form. Clicking it redirects to
 * `/api/v1/auth/oidc/start?return_to=<current url>`. After IdP +
 * callback land, the same cookie is set and the SPA boots normally.
 *
 * Hard rules retained from earlier slices:
 *   - The password field uses `type="password"` + autoComplete so
 *     the browser can autofill but the SPA never logs it.
 *   - Local form state cleared as soon as the submit promise
 *     settles (success OR failure).
 */

import { useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useLogin } from '../api/auth';
import { useOidcAvailable } from '../api/oidc';
import { useAuth } from '../auth/AuthContext';
import { loginReturnTarget } from '../auth/sessionExpiry';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
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
  const oidc = useOidcAvailable();

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
  useEffect(() => {
    if (meStatus === 'ready' && identity) {
      navigate(returnTo, { replace: true });
    }
  }, [meStatus, identity, navigate, returnTo]);

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
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Logo size={24} product="Console" />
        </div>

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
              {oidc.enabled
                ? "Use your organization's single sign-on, or a local account."
                : 'Use the local account an administrator gave you.'}
            </p>
          </div>

          {sessionEnded && !serverError && (
            <Banner>Your session ended. Sign in to continue where you were.</Banner>
          )}

          {oidc.enabled && (
            <>
              <a
                href={`/api/v1/auth/oidc/start?return_to=${encodeURIComponent(returnTo)}`}
                className="inline-flex h-(--control-touch) items-center justify-center rounded-md border border-accent bg-accent px-3 text-ui font-semibold text-on-accent hover:brightness-110"
              >
                Sign in with single sign-on
              </a>
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
            variant={oidc.enabled ? 'secondary' : 'primary'}
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
      </div>
    </div>
  );
}
