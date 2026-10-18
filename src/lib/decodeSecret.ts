/**
 * Turn a wrap's base64 payload into something a person can read.
 *
 * `atob()` alone returns one character per byte, so any value with
 * non-ASCII characters (accents, Arabic, emoji) showed and copied as
 * garbage. This decodes the bytes as UTF-8 and refuses invalid UTF-8
 * instead of guessing; such a value is binary and is shown as base64,
 * labelled as such.
 */

export type DecodedSecret = { kind: 'text'; text: string } | { kind: 'binary'; base64: string };

export function decodeSecret(base64: string): DecodedSecret {
  let bytes: Uint8Array;
  try {
    const raw = atob(base64);
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return { kind: 'binary', base64 };
  }
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { kind: 'binary', base64 };
  }
}

/**
 * The other direction, for values a person types: UTF-8 bytes as
 * base64. `btoa()` alone throws on anything outside Latin-1 and turns
 * Latin-1 accents into single bytes that aren't valid UTF-8.
 */
export function encodeSecret(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let raw = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(raw);
}
