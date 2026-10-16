/**
 * `useSensitiveMutation` is `useMutation` for calls whose variables or
 * response carry a secret: a password, a provider value, a token, a
 * TOTP seed or code, an agent secret (UI-N-02).
 *
 * TanStack Query keeps every mutation, with its variables AND its
 * response data, in the MutationCache until `gcTime` after the last
 * observer lets go (5 minutes by default). Wiping the page's own state
 * does not touch that copy, and `reset()` only detaches the observer
 * and starts the timer. This wrapper:
 *
 *   - pins `gcTime` to 0, so a detached mutation is dropped on the next
 *     tick (callers can't raise it);
 *   - calls `reset()` on unmount, so navigating away mid-flow detaches
 *     even when the page never reached its own `reset()`.
 *
 * Callers still call `reset()` once they have what they need from the
 * result. A mounted observer keeps its mutation alive whatever the
 * `gcTime` is.
 */

import { useEffect } from 'react';
import {
  useMutation,
  type DefaultError,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

export function useSensitiveMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const mutation = useMutation({ ...options, gcTime: 0 });
  // `reset` is bound once per observer, so this runs on unmount only.
  const { reset } = mutation;
  useEffect(() => reset, [reset]);
  return mutation;
}
