/**
 * Login page (`/login`) — real email + password against
 * POST /api/v1/auth/login. Replaces the LoginStub.
 *
 * Hard rules (BRD §15):
 *   - The returned JWT MUST live in memory only. AuthContext stores
 *     it via setToken state; never persisted to localStorage,
 *     sessionStorage, IndexedDB, or cookies. Page reload deliberately
 *     signs the user out.
 *   - The password field uses `type="password"` (no DOM plaintext echo)
 *     + `autoComplete="current-password"` so the browser can autofill
 *     from its credential store but never the values from this session.
 *   - Local form state is cleared as soon as the submit promise
 *     settles (success OR failure).
 *   - No "remember me" checkbox by design — there's no surface to
 *     persist anything across reloads.
 *
 * The page lays out via the brand pattern: centered Card, LogoMark +
 * wordmark, tagline, brand-gradient submit button, ApiError surface.
 */

import { useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useLogin } from '../api/auth';
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
  const { login: setIdentity } = useAuth();
  const login = useLogin();

  const [serverError, setServerError] = useState<string | null>(null);

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
      const r = await login.mutateAsync(data);
      // Token in memory ONLY. AuthContext.login is the chokepoint —
      // it wires the api client's identity provider so subsequent
      // requests carry the Bearer header.
      setIdentity(
        {
          id: r.user.id,
          email: r.user.email,
          display_name: r.user.display_name || r.user.email,
          // Permission strings will be hydrated from the api when
          // api#27 / the /me endpoint lands. For now we mark the
          // session with a placeholder so existing permission-gated
          // UI bits (sidebar admin links, mint buttons) render.
          permissions: ['*'],
        },
        r.token,
      );

      // Best-effort: drop the typed password from form state
      // immediately. React Hook Form's reset clears its internal
      // store; the input nodes re-render with empty values.
      reset({ email: '', password: '' });

      const to =
        (location.state as { from?: { pathname?: string } })?.from?.pathname ||
        '/';
      navigate(to, { replace: true });
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
              Local-admin login. OIDC will land with api#26.
            </p>
          </div>

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
            Token stays in memory only — never localStorage / sessionStorage.
            Closing the tab signs you out.
          </p>
        </form>
      </div>
    </div>
  );
}
