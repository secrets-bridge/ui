/**
 * Plain-language labels for policy rules: selector keys, their values,
 * and where a rule applies. Raw keys stay available (in a title) for
 * people who work with the api directly.
 */

import { providerLabel } from '../../lib/providers';

export type Anchor = 'platform' | 'project' | 'team';

const KEY_LABEL: Record<string, string> = {
  project_id: 'Project',
  environment: 'Environment',
  environment_id: 'Environment',
  environment_kind: 'Environment kind',
  provider_type: 'Provider',
  operation: 'Operation',
  secret_ref_prefix: 'Path starts with',
  team_id: 'Team',
};

const OPERATION_LABEL: Record<string, string> = {
  read: 'Read',
  patch: 'Change',
  reveal: 'Direct reveal',
};

export const ANCHOR_LABEL: Record<Anchor, string> = {
  platform: 'Platform',
  project: 'Project',
  team: 'Team',
};

export function selectorKeyLabel(key: string): string {
  return KEY_LABEL[key] ?? key;
}

export function envKindLabel(kind: string): string {
  if (kind === 'non_prod') return 'Non-production';
  if (kind === 'prod') return 'Production';
  return kind;
}

export function operationLabel(op: string): string {
  return OPERATION_LABEL[op] ?? op;
}

/** Ways to turn an id in a selector into a name, when the page knows it. */
export interface SelectorNames {
  project?: (id: string) => string | undefined;
  environment?: (id: string) => string | undefined;
  team?: (id: string) => string | undefined;
}

/** A selector value in words, and whether it is an identifier (shown in mono). */
export function selectorValue(key: string, value: unknown, names: SelectorNames = {}): { text: string; mono: boolean } {
  const raw = String(value);
  switch (key) {
    case 'environment_kind':
      return { text: envKindLabel(raw), mono: false };
    case 'provider_type':
      return { text: providerLabel(raw), mono: false };
    case 'operation':
      return { text: operationLabel(raw), mono: false };
    case 'project_id': {
      const name = names.project?.(raw);
      return name ? { text: name, mono: false } : { text: raw, mono: true };
    }
    case 'environment_id': {
      const name = names.environment?.(raw);
      return name ? { text: name, mono: false } : { text: raw, mono: true };
    }
    case 'team_id': {
      const name = names.team?.(raw);
      return name ? { text: name, mono: false } : { text: raw, mono: true };
    }
    case 'environment':
      return { text: raw, mono: false };
    default:
      return { text: raw, mono: true };
  }
}

export function anchorOf(rule: { team_id?: string | null; project_id?: string | null }): Anchor {
  if (rule.team_id) return 'team';
  if (rule.project_id) return 'project';
  return 'platform';
}

/** "5 minutes", "45 seconds". */
export function formatSeconds(s: number): string {
  if (s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  return `${s} seconds`;
}
