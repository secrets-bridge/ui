/**
 * Waiting for approval (`/pending`).
 *
 * An account created by a Google sign-in waits until an admin approves
 * it with a role (api#266). Until then the api answers everything but
 * /users/me and sign-out with 403 account_pending_approval, so this
 * page is all the console shows: who you are, that an admin has to
 * approve you, and a way to check again or sign out. RequireAuth sends
 * waiting accounts here; an approved account is sent on to Overview.
 */

import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { BrandPanel } from './Login';

export function Pending() {
  const { identity, meStatus, refresh, logout } = useAuth();

  useEffect(() => {
    document.title = 'Waiting for approval · Secrets Bridge';
  }, []);

  if (meStatus === 'loading') return null;
  if (!identity) return <Navigate to="/login" replace />;
  if (!identity.pending_approval) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-full bg-bg min-[1000px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center min-[1000px]:hidden">
            <Logo size={24} product="Console" />
          </div>
          <section className="flex flex-col gap-[18px] rounded-md border border-border bg-surface px-6 py-6">
            <div>
              <h1 id="page-title" className="text-console-title text-ink">
                Waiting for approval
              </h1>
              <p className="mt-2 text-body text-muted">
                You’re signed in as <span className="font-medium text-ink">{identity.email}</span>. An administrator
                needs to approve your account and give you a role before you can use Secrets Bridge.
              </p>
              <p className="mt-2 text-body text-muted">You’ll get access as soon as they do. There’s nothing else to set up.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={refresh}>
                Check again
              </Button>
              <Button variant="secondary" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
