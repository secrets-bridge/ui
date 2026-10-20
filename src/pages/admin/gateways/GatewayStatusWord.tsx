/** Gateway status as the square glyph and the exact word. */

import type { GatewayStatus } from '../../../api/gateways';
import { GATEWAY_STATUS_LABEL, GATEWAY_STATUS_TONE } from '../../../lib/gatewayStatus';
import { ToneStatus } from '../../../ui/Status';

export function GatewayStatusWord({ status }: { status: GatewayStatus }) {
  return <ToneStatus tone={GATEWAY_STATUS_TONE[status] ?? 'neutral'}>{GATEWAY_STATUS_LABEL[status] ?? status}</ToneStatus>;
}
