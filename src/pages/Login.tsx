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

import { useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useLogin } from '../api/auth';
import { useOidcAvailable } from '../api/oidc';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { LogoMark } from '../ui/LogoMark';

// We intentionally DON'T use z.email() — its regex rejects bare-host
// addresses like `admin@localhost` which are valid for local-dev
// bootstrap. The api enforces the real shape (lowercase + non-empty
// CHECK + DB unique) so the UI just needs a permissive sanity guard.
const schema = z.object({
  email: z
    .string()
    .min(3, 'enter your email or user id')
    .max(255)
    .refine((v) => v.includes('@'), {
      message: 'must contain an @',
    }),
  password: z.string().min(1, 'password required').max(255),
});

type FormShape = z.infer<typeof schema>;

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();
  const login = useLogin();
  const oidc = useOidcAvailable();

  const [serverError, setServerError] = useState<string | null>(null);

  // Where to send the user after sign-in. Preserved across the OIDC
  // round-trip via the `return_to` query param on /auth/oidc/start.
  const returnTo =
    (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

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
        // The api always returns generic "invalid credentials" on
        // any failure — no need for status-coded branches.
        setServerError(
          err.status === 401
            ? 'Invalid email or password.'
            : `${err.status}: ${err.message}`,
        );
      } else {
        setServerError(err instanceof Error ? err.message : String(err));
      }
      reset({ ...{ email: '' }, password: '' }, { keepValues: true });
    }
  };

  return (
    <div className="h-full bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <LogoMark className="w-10 h-10" />
          <div>
            <div className="text-text text-2xl font-bold tracking-tight">
              SecretsBridge
            </div>
            <div className="text-muted text-xs uppercase tracking-wider mt-0.5">
              Unified secrets control plane
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit(onValid)}
          className="bg-surface border border-border rounded-2xl p-6 space-y-5 shadow-2xl"
        >
          <div>
            <h1 className="text-text text-lg font-semibold">Sign in</h1>
            <p className="text-muted text-xs mt-1">
              {oidc.enabled
                ? 'Use single sign-on or the local-admin form below.'
                : 'Local-admin login.'}
            </p>
          </div>

          {oidc.enabled && (
            <>
              <a
                href={`/api/v1/auth/oidc/start?return_to=${encodeURIComponent(returnTo)}`}
                className="block w-full text-center bg-accent hover:bg-accent/90 text-bg font-semibold text-sm rounded-lg px-4 py-2.5"
              >
                Sign in with SSO
              </a>
              <div className="flex items-center gap-3 text-[10px] text-muted/80 uppercase tracking-wider">
                <div className="flex-1 h-px bg-border" />
                <span>or local admin</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          <div className="space-y-1">
            <label className="block text-xs text-muted font-medium uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              {...register('email')}
              autoComplete="email"
              spellCheck={false}
              autoCapitalize="off"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
              placeholder="admin@example.com"
              disabled={login.isPending}
            />
            {errors.email && (
              <div className="text-xs text-red-300">{errors.email.message}</div>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-muted font-medium uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              {...register('password')}
              autoComplete="current-password"
              spellCheck={false}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
              disabled={login.isPending}
            />
            {errors.password && (
              <div className="text-xs text-red-300">
                {errors.password.message}
              </div>
            )}
          </div>

          {serverError && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
              {serverError}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            disabled={login.isPending}
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="text-[11px] text-muted/80 text-center pt-3 border-t border-border/60">
            Sessions are server-side. The cookie is HttpOnly + SameSite=Strict.
            No token ever lives in JS storage.
          </p>
        </form>
      </div>
    </div>
  );
}
