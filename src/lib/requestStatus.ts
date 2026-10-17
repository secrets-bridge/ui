/** "pending_values" -> "Pending values": the exact API status in sentence case. */
export function statusLabel(status: string): string {
  const s = status.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
