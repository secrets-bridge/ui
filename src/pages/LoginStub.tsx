import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

/**
 * Login STUB — placeholder until api P0-1 (real OIDC).
 *
 * On submit, it fabricates an Identity locally and stores a fake
 * bearer in memory. The api side currently doesn't validate the
 * token (auth middleware is a no-op stub) so this is sufficient for
 * scaffold review.
 *
 * Replace with OIDC-PKCE on `<provider>/auth?...` when api P0-1
 * lands. Browser handoff stays the same: code → token exchange →
 * AuthContext.login(identity, token).
 */
export function LoginStub() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !name) return;
    login(
      {
        id: 'stub-' + email,
        email,
        display_name: name,
        permissions: ['*'],
      },
      'stub-bearer-token'
    );
    const to = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/agents';
    navigate(to, { replace: true });
  }

  return (
    <div className="h-full flex items-center justify-center">
      <form onSubmit={onSubmit} className="w-96 bg-surface border border-border rounded-lg p-6 space-y-4">
        <div>
          <div className="text-text text-lg font-semibold">Secrets Bridge</div>
          <div className="text-muted text-xs mt-1">
            Pre-v1.0 stub login — real OIDC lands with api #26.
          </div>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-muted">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
            placeholder="alice@example.com"
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-muted">Display name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
            placeholder="Alice"
            autoComplete="name"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-accent text-bg font-medium rounded py-2 hover:opacity-90 transition-opacity"
        >
          Continue
        </button>
        <div className="text-xs text-muted text-center pt-2 border-t border-border">
          Token stays in memory only — never localStorage / sessionStorage.
        </div>
      </form>
    </div>
  );
}
