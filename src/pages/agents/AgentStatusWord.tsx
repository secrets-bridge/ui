/** Agent status as the square glyph and the exact word. */

import type { AgentStatus } from '../../api/agents';
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE } from '../../lib/agentStatus';
import { ToneStatus } from '../../ui/Status';

export function AgentStatusWord({ status }: { status: AgentStatus }) {
  return <ToneStatus tone={AGENT_STATUS_TONE[status] ?? 'neutral'}>{AGENT_STATUS_LABEL[status] ?? status}</ToneStatus>;
}
