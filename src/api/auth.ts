/**
 * Auth API — wraps POST /api/v1/auth/login.
 *
 * The returned token is HS256-signed by the api. The UI keeps it in
 * memory only (BRD §15) — see `src/auth/AuthContext.tsx`. Never
 * persist to localStorage / sessionStorage / IndexedDB / cookies; page
 * reload deliberately signs the user out.
 */

import { useMutation } from '@tanstack/react-query';

import { api } from './client';

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
  token: string;
  expires_at: string;
  user: LoginUser;
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginInput) =>
      api.post<LoginResponse>('/api/v1/auth/login', body),
  });
}
