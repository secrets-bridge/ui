/**
 * The helm command the enroll drawer shows for a new agent token.
 *
 * It is pasted into a shell, and helm splits a `--set` on commas, so a
 * connection value like `kv,cp.endpoint=https://...` would add settings
 * of its own. Connection scope values are free text (the api only runs
 * the address and endpoint through a URL parse, which takes `$(...)` in
 * a path), so every value goes through `installValue` and anything
 * outside a plain character set becomes the placeholder.
 */

import type { ProviderConnection } from '../api/types';

export const AGENT_NAMESPACE = 'secrets-bridge';
export const AGENT_TOKEN_SECRET = 'secrets-bridge-agent-enroll';

const SAFE_VALUE = /^[A-Za-z0-9._:/@%+-]+$/;

/** True when `v` can go into the command as typed. */
export function isInstallSafe(v: string): boolean {
  return SAFE_VALUE.test(v);
}

/** `v` when it is safe to paste, else the placeholder. */
export function installValue(v: string | undefined, placeholder: string): string {
  return v && isInstallSafe(v) ? v : placeholder;
}

export function helmInstallCommand(connection: ProviderConnection, cluster: string, endpoint: string): string {
  const scope = connection.scope ?? {};
  const str = (k: string) => (typeof scope[k] === 'string' && scope[k] ? (scope[k] as string) : undefined);
  const opt = (key: string, k: string, placeholder: string) =>
    str(k) ? [`${key}=${installValue(str(k), placeholder)}`] : [];
  const provider: string[] =
    connection.type === 'vault'
      ? [
          'providers.vault.enabled=true',
          `providers.vault.addr=${installValue(str('address'), '<vault-address>')}`,
          ...opt('providers.vault.namespace', 'namespace', '<vault-namespace>'),
          ...opt('providers.vault.kvMount', 'mount', '<kv-mount>'),
          ...opt('providers.vault.kvPrefix', 'kvPrefix', '<kv-prefix>'),
          'providers.vault.kubernetesRole=<vault-role>',
        ]
      : connection.type === 'aws-sm'
        ? [
            'providers.awsSecretsManager.enabled=true',
            `providers.awsSecretsManager.region=${installValue(str('region'), '<aws-region>')}`,
            ...opt('providers.awsSecretsManager.endpoint', 'endpoint', '<aws-endpoint>'),
          ]
        : [];
  const sets = [
    `cp.endpoint=${installValue(endpoint, '<control-plane-url>')}`,
    `clusterName=${installValue(cluster, '<cluster-name>')}`,
    `agent.providerType=${installValue(connection.type, '<provider-type>')}`,
    'enrollment.enabled=true',
    `enrollment.tokenSecretName=${AGENT_TOKEN_SECRET}`,
    'identity.mode=file',
    'identity.persistence.enabled=true',
    'image.digest=sha256:<agent-image-digest>',
    ...provider,
  ];
  return [
    'helm upgrade --install secrets-bridge-agent oci://ghcr.io/secrets-bridge/charts/secrets-bridge-agent \\',
    '  --version <chart-version> \\',
    `  --namespace ${AGENT_NAMESPACE} \\`,
    ...sets.map((s, n) => `  --set ${s}${n < sets.length - 1 ? ' \\' : ''}`),
  ].join('\n');
}
