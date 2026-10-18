/**
 * Run discovery (Secrets page, job.enqueue): queues a `discover` job
 * through POST /jobs. An agent for that provider type claims it, lists
 * the secrets' metadata and posts it to the catalog.
 *
 * The job carries the provider type, an optional label selector and,
 * for Vault, an optional KV mount. The agent takes its address, region
 * and credentials from its own configuration (the api strips those keys
 * from a job at claim, api#207). A KV mount, when given, has to equal
 * the agent's SB_VAULT_KV_MOUNT (default kv) or the agent refuses the
 * job, so the field is blank by default and blank means the agent's own
 * mount (same behaviour as ui#127). The old form defaulted the mount to
 * `secret`, which agents refused out of the box.
 *
 * Most people don't hold job.enqueue; scheduled discovery per provider
 * connection is the usual path.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useTriggerDiscovery } from '../api/secrets';
import { providerLabel } from '../lib/providers';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { Field, Input, Select } from '../ui/Field';

const PROVIDER_TYPES = ['vault', 'aws-sm', 'gcp-sm', 'azure-kv'];
const PAIR = /^[^\s:,]+:[^\s,]+$/;

export function DiscoverDrawer({ onClose }: { onClose: () => void }) {
  const trigger = useTriggerDiscovery();
  const [provider, setProvider] = useState('');
  const [labels, setLabels] = useState('');
  const [kvMount, setKvMount] = useState('');
  const [tried, setTried] = useState(false);
  const [queued, setQueued] = useState<{ id: string; correlation_id: string } | null>(null);

  const pairs = labels.split(',').map((s) => s.trim()).filter(Boolean);
  const badPair = pairs.find((p) => !PAIR.test(p));
  const errors: Record<string, string> = {};
  if (!provider) errors.provider = 'Choose the provider to discover.';
  if (badPair) errors.labels = `Write each label as key:value. "${badPair}" isn't.`;
  const show = (k: string) => (tried ? errors[k] : undefined);

  const submit = async () => {
    setTried(true);
    const first = ['provider', 'labels'].find((k) => errors[k]);
    if (first) {
      document.getElementById(`discover-${first}`)?.focus();
      return;
    }
    const label_selector = pairs.length
      ? Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)]))
      : undefined;
    try {
      const mount = kvMount.trim();
      const job = await trigger.mutateAsync({
        target_provider_type: provider,
        target_provider_config: provider === 'vault' && mount ? { kvMount: mount } : undefined,
        label_selector,
      });
      setQueued(job);
    } catch {
      // Shown below.
    }
  };

  if (queued) {
    return (
      <Drawer
        title="Discovery queued"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-body">
          <p>
            An agent for {providerLabel(provider)} picks the job up within a few seconds, lists the secrets' metadata and
            posts it to the catalog. The catalog refreshes on its own.
          </p>
          <p className="text-muted">
            Nothing after a minute? Check that an agent for this provider is active and that its role can list secrets.
          </p>
          <p>
            <Link to={`/audit?correlation_id=${queued.correlation_id}`} className="font-medium text-accent hover:underline">
              Follow the job in the audit log
            </Link>
          </p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title="Run discovery"
      subtitle="Asks an agent to list secret metadata into the catalog. Values are never read."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={trigger.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="discover" variant="primary" disabled={trigger.isPending} aria-busy={trigger.isPending}>
            {trigger.isPending ? 'Queuing…' : 'Run discovery'}
          </Button>
        </>
      }
    >
      <form
        id="discover"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <Field
          id="discover-provider"
          label="Provider"
          hint="The first active agent for this provider type runs it, with its own address, region and credentials."
          error={show('provider')}
        >
          {(p) => (
            <Select {...p} value={provider} onChange={(e) => setProvider(e.target.value)} data-autofocus>
              <option value="">Choose a provider</option>
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {providerLabel(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {provider === 'vault' && (
          <Field
            id="discover-mount"
            label="KV v2 mount (optional)"
            hint="Leave blank to use the agent's own mount. If set, it has to match the agent's SB_VAULT_KV_MOUNT (default kv), or the agent refuses the job."
          >
            {(p) => (
              <Input
                {...p}
                value={kvMount}
                onChange={(e) => setKvMount(e.target.value)}
                placeholder="the agent's mount"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
        )}
        <Field
          id="discover-labels"
          label="Only secrets with these labels (optional)"
          hint="Comma-separated key:value pairs, matched against provider tags or Vault custom metadata. A secret must have every one."
          error={show('labels')}
        >
          {(p) => (
            <Input
              {...p}
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="env:uat, team:payments"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        {trigger.isError && (
          <Banner tone="error" title="Not queued.">
            {trigger.error instanceof ApiError ? `${trigger.error.status}: ${trigger.error.message}` : 'Network error.'}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
