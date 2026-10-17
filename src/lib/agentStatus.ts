/** Agent statuses (api agents.status): the glyph tone, the word and what it means. */

import type { AgentStatus } from '../api/agents';
import type { Tone } from '../ui/Status';

export const AGENT_STATUS_TONE: Record<AgentStatus, Tone> = {
  active: 'ok',
  enrolled: 'warn',
  stale: 'warn',
  error: 'bad',
  revoked: 'neutral',
  disabled: 'neutral',
};

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'Active',
  enrolled: 'Enrolled',
  stale: 'Stale',
  error: 'Error',
  revoked: 'Revoked',
  disabled: 'Disabled',
};

export const AGENT_STATUS_MEANING: Record<AgentStatus, string> = {
  active: 'Heartbeats are arriving.',
  enrolled: 'Enrolled, waiting for its first heartbeat.',
  stale: 'No heartbeat for a while. Check the agent pod and its route to the control plane.',
  error: 'The agent reported an error in its last heartbeat.',
  revoked: 'Its credential is refused. Enroll a new agent to bring this capacity back.',
  disabled: 'Disabled by an administrator.',
};
