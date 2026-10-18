/**
 * Secrets catalog (`/secrets`).
 *
 * What discovery found in the providers: path, provider, cluster, the
 * provider's own labels (Vault custom_metadata, AWS tags) and whether
 * the secret is still there. Metadata only: no values, no hashes and no
 * "view value" shortcut; values only ever come through an approved
 * request.
 *
 * Filters apply as you type (path prefix, project, provider, status,
 * cluster and key:value labels, all ANDed) and Reset clears them. A row
 * opens the secret's details in a drawer. Labels are operator-supplied
 * text from the provider, so they are shown as plain text only.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import { type Secret, type SecretsFilter, useSecrets } from '../api/secrets';
import { useMyProjects } from '../api/tenancy';
import { useAuth } from '../auth/AuthContext';
import { providerLabel } from '../lib/providers';
import { formatAge, formatExact } from '../lib/time';
import { useNow } from '../lib/useNow';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Input, Select } from '../ui/Field';
import { Path } from '../ui/Path';
import { SearchIcon } from '../ui/icons';
import { PageHeader } from '../ui/PageHeader';
import { ToneStatus } from '../ui/Status';
import { DiscoverDrawer } from './DiscoverDrawer';

const LIMIT = 200;
const PROVIDERS = ['vault', 'aws-sm', 'gcp-sm', 'azure-kv'];

/** The value of `text` once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Secrets() {
  const { hasPermission } = useAuth();
  const now = useNow();
  const myProjects = useMyProjects();

  const [prefix, setPrefix] = useState('');
  const [cluster, setCluster] = useState('');
  const [projectId, setProjectId] = useState('');
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState<'' | 'present' | 'missing'>('');
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Secret | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);

  const filter: SecretsFilter = {
    ref_prefix: useDebounced(prefix.trim()) || undefined,
    cluster_name: useDebounced(cluster.trim()) || undefined,
    project_id: projectId || undefined,
    provider: provider || undefined,
    status: status || undefined,
    labels: labels.length ? labels : undefined,
    limit: LIMIT,
  };
  const list = useSecrets(filter);
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const filtered = !!(prefix || cluster || projectId || provider || status || labels.length);
  const reset = () => {
    setPrefix('');
    setCluster('');
    setProjectId('');
    setProvider('');
    setStatus('');
    setLabels([]);
    setLabelInput('');
    setLabelError(null);
  };

  const addLabel = () => {
    const v = labelInput.trim();
    if (!v) return;
    const i = v.indexOf(':');
    if (i <= 0 || i === v.length - 1) {
      setLabelError('Write a label as key:value, for example team:payments.');
      return;
    }
    setLabelError(null);
    if (!labels.includes(v)) setLabels([...labels, v]);
    setLabelInput('');
  };

  const columns: Column<Secret>[] = [
    {
      key: 'path',
      header: 'Path',
      render: (s) => (
        <button
          type="button"
          onClick={() => setSelected(s)}
          className="min-w-[260px] max-w-[420px] break-all text-left font-mono text-mono font-medium text-accent hover:underline"
        >
          {s.secret_ref}
        </button>
      ),
    },
    { key: 'provider', header: 'Provider', render: (s) => <span className="whitespace-nowrap">{providerLabel(s.provider_type)}</span> },
    { key: 'cluster', header: 'Cluster', render: (s) => <span className="whitespace-nowrap font-mono text-mono">{s.cluster_name}</span> },
    {
      key: 'labels',
      header: 'Labels',
      render: (s) => {
        const entries = Object.entries(s.labels ?? {});
        if (entries.length === 0) return <span className="text-muted">None</span>;
        return (
          <span className="flex max-w-[360px] flex-wrap gap-1">
            {entries.slice(0, 3).map(([k, v]) => (
              <LabelChip key={k} k={k} v={v} />
            ))}
            {entries.length > 3 && <span className="text-caption text-muted">+{entries.length - 3} more</span>}
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', render: (s) => <CatalogStatus status={s.status} /> },
    {
      key: 'seen',
      header: 'Last seen',
      align: 'right',
      render: (s) => (
        <time title={formatExact(s.last_seen_at)} className="whitespace-nowrap font-mono text-mono text-muted">
          {formatAge(s.last_seen_at, now)}
        </time>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Secrets"
        description="What discovery found in your providers: paths, labels and whether each secret is still there. Never values."
        actions={
          // Free-form discovery jobs (POST /jobs) need job.enqueue, which
          // no seeded role has. Admins run discovery per provider
          // connection instead ("Discover now").
          hasPermission('job.enqueue') ? (
            <Button variant="primary" onClick={() => setDiscoverOpen(true)}>
              Run discovery…
            </Button>
          ) : hasPermission('integration.edit') ? (
            <Link
              to="/admin/provider-connections"
              className="inline-flex h-(--control-md) items-center rounded-md border border-edge bg-surface px-3 text-ui font-medium text-ink hover:bg-sunken max-md:h-(--control-touch)"
            >
              Run discovery from a connection
            </Link>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <label className="relative min-w-0 flex-[1_1_260px] max-w-[340px] max-[600px]:max-w-none max-[600px]:basis-full">
          <span className="sr-only">Path starts with</span>
          <SearchIcon size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="Path starts with…"
            className="w-full pl-8 font-mono"
            spellCheck={false}
          />
        </label>
        <label className="flex-[0_1_200px] max-[600px]:flex-[1_1_140px]">
          <span className="sr-only">Project</span>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full">
            <option value="">All my projects</option>
            {(myProjects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status === 'archived' ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex-[0_1_190px] max-[600px]:flex-[1_1_140px]">
          <span className="sr-only">Provider</span>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full">
            <option value="">All providers</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex-[0_1_150px] max-[600px]:flex-[1_1_140px]">
          <span className="sr-only">Status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-full">
            <option value="">Any status</option>
            <option value="present">Present</option>
            <option value="missing">Missing</option>
          </Select>
        </label>
        <label className="flex-[0_1_160px] max-[600px]:flex-[1_1_140px]">
          <span className="sr-only">Cluster</span>
          <Input value={cluster} onChange={(e) => setCluster(e.target.value)} placeholder="Cluster" className="w-full font-mono" />
        </label>
        <Button variant="quiet" onClick={reset} disabled={!filtered}>
          Reset filters
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-caption text-muted">Label</span>
          <Input
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLabel();
              }
            }}
            placeholder="team:payments"
            className="w-48 font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={labelError ? 'label-error' : undefined}
            aria-invalid={labelError ? true : undefined}
          />
        </label>
        <Button variant="secondary" size="sm" onClick={addLabel}>
          Add label filter
        </Button>
        {labels.map((l) => {
          const [k, ...rest] = l.split(':');
          return (
            <span key={l} className="inline-flex items-center gap-1 rounded-sm border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-[12px]">
              <span className="text-muted">{k}</span>=<span>{rest.join(':')}</span>
              <button
                type="button"
                onClick={() => setLabels(labels.filter((x) => x !== l))}
                aria-label={`Remove label filter ${l}`}
                className="ml-1 text-muted hover:text-ink"
              >
                ×
              </button>
            </span>
          );
        })}
        {labelError && (
          <p id="label-error" className="w-full text-caption font-medium text-bad">
            {labelError}
          </p>
        )}
        {list.data && (
          <p role="status" className="ml-auto text-caption text-muted">
            Showing {rows.length} of {total}
            {total > LIMIT ? ` (the first ${LIMIT})` : ''}
          </p>
        )}
      </div>

      {list.isLoading && <p className="text-muted">Loading the catalog…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the catalog."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : String(list.error)}
        </Banner>
      )}

      {list.data &&
        (rows.length > 0 ? (
          <DataTable
            label="Discovered secrets"
            columns={columns}
            rows={rows}
            rowKey={(s) => s.id}
            onRowClick={setSelected}
            minWidth={880}
          />
        ) : filtered ? (
          <EmptyState
            title="No secrets match these filters."
            action={
              <Button variant="secondary" onClick={reset}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <EmptyState title="Discovery hasn't found any secrets yet.">
            Secrets appear here once an agent runs discovery on a provider connection.
          </EmptyState>
        ))}

      {selected && <SecretDrawer secret={selected} onClose={() => setSelected(null)} />}
      {discoverOpen && <DiscoverDrawer onClose={() => setDiscoverOpen(false)} />}
    </div>
  );
}

function CatalogStatus({ status }: { status: Secret['status'] }) {
  return <ToneStatus tone={status === 'present' ? 'ok' : 'warn'}>{status === 'present' ? 'Present' : 'Missing'}</ToneStatus>;
}

function LabelChip({ k, v }: { k: string; v: unknown }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-sunken px-1.5 py-0.5 font-mono text-[11.5px]">
      <span className="text-muted">{k}</span>
      <span className="text-muted">=</span>
      <span className="text-ink">{String(v)}</span>
    </span>
  );
}

function SecretDrawer({ secret: s, onClose }: { secret: Secret; onClose: () => void }) {
  const labels = Object.entries(s.labels ?? {});
  const rows: [string, React.ReactNode][] = [
    ['Provider', providerLabel(s.provider_type)],
    ['Cluster', <span key="c" className="font-mono text-mono">{s.cluster_name}</span>],
    ['Status', <CatalogStatus key="s" status={s.status} />],
    ...(s.version ? [['Version', <span key="v" className="font-mono text-mono">{s.version}</span>] as [string, React.ReactNode]] : []),
    ['First seen', formatExact(s.first_seen_at)],
    ['Last seen', formatExact(s.last_seen_at)],
    ...(s.updated_at_source ? [['Changed in provider', formatExact(s.updated_at_source)] as [string, React.ReactNode]] : []),
  ];
  return (
    <Drawer title="Secret details" subtitle={<Path value={s.secret_ref} />} onClose={onClose}>
      <dl className="m-0">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mb-2 mt-5 text-block-heading text-ink">Labels {labels.length > 0 && <span className="font-mono text-mono-small font-normal text-muted">{labels.length}</span>}</h3>
      {labels.length === 0 ? (
        <p className="text-muted">The provider has no labels on this secret.</p>
      ) : (
        <p className="flex flex-wrap gap-1.5">
          {labels.map(([k, v]) => (
            <LabelChip key={k} k={k} v={v} />
          ))}
        </p>
      )}
      {s.provider_config && Object.keys(s.provider_config).length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-block-heading text-ink">Provider settings</h3>
          <pre className="overflow-x-auto rounded-md border border-border bg-sunken px-3 py-2 font-mono text-mono-small text-ink">
            {JSON.stringify(s.provider_config, null, 2)}
          </pre>
        </>
      )}
      <Banner className="mt-5">Metadata only. To see a value, request access to it from the project that uses it.</Banner>
    </Drawer>
  );
}
