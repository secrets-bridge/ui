/**
 * Short reference for a request, for link text, breadcrumbs and search.
 *
 * The api has no human reference yet, so this is the first 6 hex
 * characters of the request id: "REQ-3F9A1C". Six characters keep a
 * collision unlikely for the request volumes we see (4 were too few:
 * two requests in a few hundred could share a ref). Search also matches
 * the full id. Replace with the api's reference once it has one.
 */
export function requestRef(id: string): string {
  if (!id) return '—';
  return `REQ-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}
