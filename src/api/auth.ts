/**
 * Auth API — wraps POST /api/v1/auth/login.
 *
 * Slice C: the api sets an HttpOnly session cookie on a successful
 * login; the SPA never needs the token value (see `src/api/client.ts`
 * for the cookie-based auth model). The api's response body may still
 * carry a legacy `token` field for the transition — TanStack Query
 * keeps mutation results (including this one) around in its
 * MutationCache after the call resolves, so that field is stripped
 * here before it ever lands in `useLogin()`'s cached result (ui#96 /
 * UI-03). The variables carry the password, so this is a sensitive
 * mutation (gcTime 0, reset on unmount, UI-N-02) and `Login.tsx` calls
 * `reset()` as soon as the submit settles.
 */

import { api } from './client';
import { useSensitiveMutation } from './sensitiveMutation';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginUser {
  id: string;
  email: string;
  display_name: string;
}

export interface LoginResponse {
  expires_at: string;
  user: LoginUser;
}

// Shape of the api's raw response — may still include the legacy
// `token` field during the Slice C transition. Never exposed past
// this module.
type RawLoginResponse = LoginResponse & { token?: string };

export function useLogin() {
  return useSensitiveMutation({
    mutationFn: async (body: LoginInput): Promise<LoginResponse> => {
      const raw = await api.post<RawLoginResponse>('/api/v1/auth/login', body);
      const { expires_at, user } = raw;
      return { expires_at, user };
    },
  });
}
