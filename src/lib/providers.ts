/** Human names for provider types; the type itself for anything unknown. */
const LABELS: Record<string, string> = {
  vault: 'HashiCorp Vault',
  'aws-sm': 'AWS Secrets Manager',
  'gcp-sm': 'GCP Secret Manager',
  'azure-kv': 'Azure Key Vault',
};

export function providerLabel(type: string | undefined): string {
  if (!type) return '—';
  return LABELS[type] ?? type;
}
