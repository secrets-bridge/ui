/**
 * The commands the agent onboarding and key rotation panels show
 * (enrollment v2, skills#116).
 *
 * The operator runs `secrets-bridge-agent enroll` (or `rotate-key`) on a
 * machine inside their own boundary. It creates the X25519 private key
 * there, proves it holds it to the control plane, and writes the bundle
 * (`agent_id`, `agent_secret`, `private_key`, `public_key_fingerprint`)
 * to stdout, which the command pipes straight into the operator's secret
 * store. The private key and the agent secret never reach this browser
 * or the control plane.
 *
 * Token handling: no command carries a token. Each one starts with a
 * silent prompt (`read -rs`), hands the token to the CLI on stdin with
 * the `printf` builtin (`--token-file -`) and unsets it, so the token
 * stays out of shell history and the process list.
 *
 * Everything else in a command is pasted into a shell, and helm splits a
 * `--set` on commas, so every value goes through `installValue`: anything
 * outside a plain character set becomes a placeholder.
 */

import type { ProviderConnection } from '../api/types';

export const AGENT_NAMESPACE = 'secrets-bridge';
/** The Kubernetes Secret the agent chart reads (`identity.existingSecret`). */
export const AGENT_IDENTITY_SECRET = 'secrets-bridge-agent-identity';
export const AGENT_CLI = 'secrets-bridge-agent';

/** Where the operator keeps the agent's credential and private key. */
export type CredentialStore = 'aws-sm' | 'vault' | 'kubectl' | 'manifest';

export const CREDENTIAL_STORES: { id: CredentialStore; label: string }[] = [
  { id: 'aws-sm', label: 'AWS Secrets Manager' },
  { id: 'vault', label: 'Vault' },
  { id: 'kubectl', label: 'Kubernetes Secret' },
  { id: 'manifest', label: 'Secret manifest' },
];

/** True when the credential lands in an external store that ESO (or a manual copy) syncs into the cluster. */
export function isExternalStore(store: CredentialStore): boolean {
  return store === 'aws-sm' || store === 'vault';
}

const SAFE_VALUE = /^[A-Za-z0-9._:/@%+-]+$/;

/** True when `v` can go into a command as typed. */
export function isInstallSafe(v: string): boolean {
  return SAFE_VALUE.test(v);
}

/** `v` when it is safe to paste, else the placeholder. */
export function installValue(v: string | undefined, placeholder: string): string {
  return v && isInstallSafe(v) ? v : placeholder;
}

function scopeString(connection: ProviderConnection | undefined, k: string): string | undefined {
  const v = connection?.scope?.[k];
  return typeof v === 'string' && v ? v : undefined;
}

/** The default name for the credential in an external store. */
export function defaultStorePath(cluster: string): string {
  return `secrets-bridge/agents/${installValue(cluster, 'cluster')}`;
}

/** The KV mount the Vault variant writes to: the connection's own mount, else a placeholder. */
function vaultMount(connection: ProviderConnection | undefined): string {
  return installValue(scopeString(connection, 'mount'), '<kv-mount>');
}

/**
 * The tail of the pipe: what the CLI's stdout goes into. JSON for the
 * external stores, an env file for kubectl, a manifest for apply.
 */
function sink(store: CredentialStore, path: string, connection?: ProviderConnection): { format: string; into: string[] } {
  const p = installValue(path, '<secret-name>');
  switch (store) {
    case 'aws-sm':
      return {
        format: 'json',
        into: ['  | aws secretsmanager put-secret-value \\', `      --secret-id ${p} --secret-string file:///dev/stdin`],
      };
    case 'vault':
      return { format: 'json', into: [`  | vault kv put -mount=${vaultMount(connection)} ${p} -`] };
    case 'kubectl':
      return {
        format: 'env',
        into: [`  | kubectl -n ${AGENT_NAMESPACE} create secret generic ${AGENT_IDENTITY_SECRET} \\`, '      --from-env-file=/dev/stdin'],
      };
    case 'manifest':
      return { format: 'k8s-secret', into: [`  | kubectl -n ${AGENT_NAMESPACE} apply -f -`] };
  }
}

export interface EnrollCommandInput {
  endpoint: string;
  connection: ProviderConnection;
  cluster: string;
  name: string;
  store: CredentialStore;
  path: string;
}

/** `secrets-bridge-agent enroll`, token on stdin, bundle piped into the chosen store. */
export function enrollCommand({ endpoint, connection, cluster, name, store, path }: EnrollCommandInput): string {
  const out = sink(store, path, connection);
  const region = connection.type === 'aws-sm' ? scopeString(connection, 'region') : undefined;
  const flags = [
    `--cp-endpoint ${installValue(endpoint, '<control-plane-url>')}`,
    '--token-file -',
    `--name ${installValue(name, '<agent-name>')}`,
    `--cluster-name ${installValue(cluster, '<cluster-name>')}`,
    `--provider-type ${installValue(connection.type, '<provider-type>')}`,
    ...(region ? [`--region ${installValue(region, '<aws-region>')}`] : []),
    '--output -',
    `--format ${out.format}`,
  ];
  return [
    'read -rs SB_ENROLL_TOKEN',
    `printf '%s' "$SB_ENROLL_TOKEN" | ${AGENT_CLI} enroll \\`,
    ...flags.map((f) => `  ${f} \\`),
    ...out.into,
    'unset SB_ENROLL_TOKEN',
  ].join('\n');
}

export interface RotateCommandInput {
  endpoint: string;
  store: CredentialStore;
  path: string;
  connection?: ProviderConnection;
}

/** `secrets-bridge-agent rotate-key`, rotation token on stdin, the new bundle piped into the store. */
export function rotateCommand({ endpoint, store, path, connection }: RotateCommandInput): string {
  const out = sink(store, path, connection);
  // kubectl create refuses an existing Secret; replace it in place.
  const into =
    store === 'kubectl'
      ? [
          `  | kubectl -n ${AGENT_NAMESPACE} create secret generic ${AGENT_IDENTITY_SECRET} \\`,
          '      --from-env-file=/dev/stdin --dry-run=client -o yaml \\',
          `  | kubectl -n ${AGENT_NAMESPACE} apply -f -`,
        ]
      : out.into;
  const flags = [
    `--cp-endpoint ${installValue(endpoint, '<control-plane-url>')}`,
    '--credentials-dir <credentials-dir>',
    '--rotation-token-file -',
    '--output -',
    `--format ${out.format}`,
  ];
  return [
    'read -rs SB_ROTATION_TOKEN',
    `printf '%s' "$SB_ROTATION_TOKEN" | ${AGENT_CLI} rotate-key \\`,
    ...flags.map((f) => `  ${f} \\`),
    ...into,
    'unset SB_ROTATION_TOKEN',
  ].join('\n');
}

/**
 * External Secrets Operator: syncs the bundle from AWS Secrets Manager or
 * Vault into the Secret the chart mounts. It holds names only, no value,
 * so it is safe to keep in Git.
 */
export function externalSecretManifest(path: string): string {
  const p = installValue(path, '<secret-name>');
  const key = (k: string) => [`    - secretKey: ${k}`, '      remoteRef:', `        key: ${p}`, `        property: ${k}`];
  return [
    'apiVersion: external-secrets.io/v1',
    'kind: ExternalSecret',
    'metadata:',
    `  name: ${AGENT_IDENTITY_SECRET}`,
    `  namespace: ${AGENT_NAMESPACE}`,
    'spec:',
    '  refreshInterval: 1h',
    '  secretStoreRef:',
    '    kind: SecretStore',
    '    name: <secret-store>',
    '  target:',
    `    name: ${AGENT_IDENTITY_SECRET}`,
    '    creationPolicy: Owner',
    '  data:',
    ...key('agent_id'),
    ...key('agent_secret'),
    ...key('private_key'),
  ].join('\n');
}

/** The agent chart, reading its identity from the existing Secret. No token, key or credential in any value. */
export function helmInstallCommand(connection: ProviderConnection, cluster: string, endpoint: string): string {
  const str = (k: string) => scopeString(connection, k);
  const opt = (key: string, k: string, placeholder: string) => (str(k) ? [`${key}=${installValue(str(k), placeholder)}`] : []);
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
    `identity.existingSecret=${AGENT_IDENTITY_SECRET}`,
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

/** Restarts the agent so it reads the rotated Secret. */
export function restartCommand(): string {
  return `kubectl -n ${AGENT_NAMESPACE} rollout restart deployment/secrets-bridge-agent`;
}
