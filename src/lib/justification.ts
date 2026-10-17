/**
 * Does this justification look like it carries a secret value? A
 * heuristic for feedback only (the api never stores the text as a
 * secret, but approvers and the audit log see it): a PEM block, an
 * assignment such as `password=...`, or one long unbroken run of
 * key-like characters.
 */
export function looksLikeASecret(text: string): boolean {
  if (/-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/.test(text)) return true;
  if (/\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/i.test(text)) return true;
  return text
    .split(/\s+/)
    .some((w) => w.length >= 32 && /^[A-Za-z0-9+/=_\-.]+$/.test(w) && /\d/.test(w) && /[A-Za-z]/.test(w));
}
