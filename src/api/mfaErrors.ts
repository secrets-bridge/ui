import { ApiError } from './client';

/**
 * The sentence for an action the api refused because the account has no
 * second factor yet (412 `mfa_enrollment_required`). The step-up modal
 * has already offered to add one, so this shows when the user cancelled,
 * either before adding a factor or before confirming with the new one.
 * `nothing` says what didn't happen ("nothing was sent"). Returns
 * undefined for any other error, so callers fall back to their own text.
 */
export function missingFactorText(err: unknown, nothing: string, again = 'Try again'): string | undefined {
  if (!(err instanceof ApiError) || err.status !== 412) return undefined;
  if (!(err.message ?? '').toLowerCase().includes('mfa_enrollment_required')) return undefined;
  return `This needs a second factor, so ${nothing}. ${again} to confirm with your second factor.`;
}
