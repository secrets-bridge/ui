/**
 * Discovered-secrets page (`/secrets`).
 *
 * Browse what the agents have surfaced via discovery jobs. Filter by
 * cluster / provider / ref prefix / status, plus repeatable
 * label=key:value chips that match native provider tags (Vault
 * custom_metadata, AWS Tags, etc.).
 *
 * Two-pane layout matches the Audit page (ui#21):
 *
 *   ┌── filter strip ───────────────────────────────────────────────────┐
 *   │ cluster · provider · ref prefix · status · + label chip      │
 *   ├── LEFT (table)                  ┬── RIGHT (selected details) ────┤
 *   │  ref · provider · cluster ·     │  full row + label list +       │
 *   │  labels · last seen · status    │  provider_config + versions    │
 *   └────────────────────────────────┴────────────────────────────────┘
 *
 * Hard rules respected:
 *   - This is metadata only — no plaintext, no provider credentials.
 *     The page never offers a 'view value' shortcut; that's the
 *     /requests flow.
 *   - `labels` is rendered verbatim from the api (Vault
 *     custom_metadata / AWS Tags / GCP labels / Azure tags) so the
 *     operator's existing tag conventions surface unmodified.
 */

import { useState } from 'react';

import { ApiError } from '../api/client';
import {
  type Secret,
  type SecretsFilter,
  useSecrets,
} from '../api/secrets';
import { useMyProjects } from '../api/tenancy';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';
import { DiscoverDrawer } from './DiscoverDrawer';

const PROVIDER_LABELS: Record<string, string> = {
  vault: 'HashiCorp Vault',
  'aws-sm': 'AWS Secrets Manager',
  'gcp-sm': 'GCP Secret Manager',
  'azure-kv': 'Azure Key Vault',
  'kubernetes': 'Kubernetes Secret',
};

export function Secrets() {
  const [filter, setFilter] = useState<SecretsFilter>({ limit: 200 });
  const [draft, setDraft] = useState<SecretsFilter>(filter);
  const [labelInput, setLabelInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const myProjects = useMyProjects();
  const list = useSecrets(filter);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const apply = () => {
    setFilter({
      ...draft,
      cluster_name: draft.cluster_name?.trim() || undefined,
      provider: draft.provider || undefined,
      ref_prefix: draft.ref_prefix?.trim() || undefined,
      status: draft.status || undefined,
      labels: draft.labels?.length ? draft.labels : undefined,
      project_id: draft.project_id || undefined,
      limit: draft.limit ?? 200,
    });
    setSelectedId(null);
  };

  const clear = () => {
    const fresh: SecretsFilter = { limit: 200 };
    setFilter(fresh);
    setDraft(fresh);
    setLabelInput('');
    setSelectedId(null);
  };

  const addLabel = () => {
    const v = labelInput.trim();
    if (!v) return;
    if (!v.includes(':')) return;
    const next = {
      ...draft,
      labels: [...(draft.labels ?? []), v],
    };
    setDraft(next);
    setLabelInput('');
  };

  const removeDraftLabel = (i: number) => {
    setDraft({
      ...draft,
      labels: (draft.labels ?? []).filter((_, j) => j !== i),
    });
  };

  const hasFilter =
    !!filter.cluster_name ||
    !!filter.provider ||
    !!filter.ref_prefix ||
    !!filter.status ||
    !!filter.project_id ||
    (filter.labels?.length ?? 0) > 0;

  return (
    <div>
      <PageHeader
        title="Discovered secrets"
        description="What the agents have surfaced via discovery jobs. Native provider tags (Vault custom_metadata, AWS Tags, etc.) are preserved as filterable labels."
        actions={
          <div className="flex items-center gap-2">
            {hasFilter && (
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            )}
            <Button variant="primary" onClick={() => setDiscoverOpen(true)}>
              Discover…
            </Button>
          </div>
        }
      />

      {/* Filter strip */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
              Project
            </label>
            <select
              value={draft.project_id ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, project_id: e.target.value || undefined })
              }
              className={inputCls}
              disabled={myProjects.isLoading}
            >
              <option value="">
                {myProjects.isLoading
                  ? 'loading…'
                  : myProjects.data && myProjects.data.length > 1
                    ? '(all my projects)'
                    : '(all)'}
              </option>
              {(myProjects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.status === 'archived' ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </div>
          <FilterField
            label="Cluster"
            value={draft.cluster_name ?? ''}
            onChange={(v) => setDraft({ ...draft, cluster_name: v })}
            placeholder="prod-eu"
          />
          <div className="space-y-1">
            <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
              Provider
            </label>
            <select
              value={draft.provider ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, provider: e.target.value || undefined })
              }
              className={inputCls}
            >
              <option value="">(any)</option>
              {Object.entries(PROVIDER_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <FilterField
            label="Ref prefix"
            value={draft.ref_prefix ?? ''}
            onChange={(v) => setDraft({ ...draft, ref_prefix: v })}
            placeholder="billing/"
            mono
          />
          <div className="space-y-1">
            <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
              Status
            </label>
            <select
              value={draft.status ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status:
                    (e.target.value as SecretsFilter['status']) || undefined,
                })
              }
              className={inputCls}
            >
              <option value="">(any)</option>
              <option value="present">present</option>
              <option value="missing">missing</option>
            </select>
          </div>
        </div>

        {/* Label chip composer */}
        <div className="mt-3 space-y-2">
          <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
            Labels (key:value, repeatable — ANDed)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {(draft.labels ?? []).map((l, i) => (
              <DraftLabelChip key={i} value={l} onClear={() => removeDraftLabel(i)} />
            ))}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                placeholder="Team:billing"
                className={inputCls + ' font-mono w-48'}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addLabel}
              >
                + Add
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border/60">
          <Button variant="secondary" size="sm" onClick={() => setDraft(filter)}>
            Reset
          </Button>
          <Button variant="primary" size="sm" onClick={apply}>
            Apply
          </Button>
        </div>
      </Card>

      {list.isLoading && (
        <div className="text-muted text-sm">Loading…</div>
      )}
      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load secrets</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}
      {list.data && rows.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          {hasFilter
            ? 'No discovered secrets match the current filters.'
            : 'No discovered secrets yet. Run a discovery job on an agent to populate this view.'}
        </Card>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
                <tr className="border-b border-border/60">
                  <Th>Ref</Th>
                  <Th>Provider</Th>
                  <Th>Cluster</Th>
                  <Th>Labels</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Last seen</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <SecretRow
                    key={s.id}
                    row={s}
                    selected={s.id === selectedId}
                    onSelect={() => setSelectedId(s.id)}
                  />
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-border/60 text-xs text-muted">
              Showing {rows.length} of {total} secret{total === 1 ? '' : 's'}
              {filter.limit ? ` (limit ${filter.limit})` : ''}
            </div>
          </Card>

          <DetailsPane secret={selected} />
        </div>
      )}

      {discoverOpen && <DiscoverDrawer onClose={() => setDiscoverOpen(false)} />}
    </div>
  );
}

// --- row ------------------------------------------------------------

function SecretRow({
  row: s,
  selected,
  onSelect,
}: {
  row: Secret;
  selected: boolean;
  onSelect: () => void;
}) {
  const labelEntries = Object.entries(s.labels ?? {});
  const labelPreview = labelEntries.slice(0, 3);
  const extra = labelEntries.length - labelPreview.length;
  return (
    <tr
      onClick={onSelect}
      className={
        'border-b border-border/40 last:border-0 align-top cursor-pointer ' +
        (selected ? 'bg-accent/10' : 'hover:bg-bg/20')
      }
    >
      <Td>
        <span className="font-mono text-accent text-sm break-all">
          {s.secret_ref}
        </span>
      </Td>
      <Td>
        <span className="text-text text-sm">
          {PROVIDER_LABELS[s.provider_type] ?? s.provider_type}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-text text-sm">{s.cluster_name}</span>
      </Td>
      <Td>
        {labelEntries.length === 0 ? (
          <span className="text-muted text-xs italic">none</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {labelPreview.map(([k, v]) => (
              <LabelChip key={k} k={k} v={v} />
            ))}
            {extra > 0 && (
              <span className="text-muted text-[11px] font-mono pt-1">
                +{extra} more
              </span>
            )}
          </div>
        )}
      </Td>
      <Td>
        <StatusPill
          variant={s.status === 'present' ? 'success' : 'warning'}
          tone="outline"
        >
          {s.status}
        </StatusPill>
      </Td>
      <Td className="text-right text-muted text-xs whitespace-nowrap">
        {formatRelativePast(s.last_seen_at)}
      </Td>
    </tr>
  );
}

function LabelChip({ k, v }: { k: string; v: unknown }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[11px] font-mono">
      <span className="text-muted">{k}</span>
      <span className="text-muted/50">=</span>
      <span className="text-accent">{String(v)}</span>
    </span>
  );
}

function DraftLabelChip({
  value,
  onClear,
}: {
  value: string;
  onClear: () => void;
}) {
  const [k, v] = value.split(':');
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/40 px-2.5 py-0.5 text-[11px] font-mono">
      <span className="text-muted">{k}</span>
      <span className="text-muted/50">=</span>
      <span className="text-accent">{v}</span>
      <button onClick={onClear} className="ml-1 text-muted hover:text-text">
        ×
      </button>
    </span>
  );
}

// --- details pane ---------------------------------------------------

function DetailsPane({ secret }: { secret: Secret | null }) {
  if (!secret) {
    return (
      <Card className="p-6 text-center text-muted text-sm">
        Pick a row to inspect labels + provider config + versions.
      </Card>
    );
  }
  const labelEntries = Object.entries(secret.labels ?? {});
  return (
    <Card className="overflow-hidden sticky top-4">
      <div className="px-5 py-4 border-b border-border/60">
        <div className="text-text font-semibold">Secret details</div>
        <div className="text-muted text-xs mt-1 font-mono break-all">
          {secret.secret_ref}
        </div>
      </div>
      <dl className="px-5 py-4 space-y-2.5 text-sm">
        <Row k="Cluster" mono v={secret.cluster_name} />
        <Row
          k="Provider"
          v={
            <span className="text-text">
              {PROVIDER_LABELS[secret.provider_type] ?? secret.provider_type}
            </span>
          }
        />
        <Row
          k="Status"
          v={
            <StatusPill
              variant={secret.status === 'present' ? 'success' : 'warning'}
              tone="outline"
            >
              {secret.status}
            </StatusPill>
          }
        />
        {secret.version && <Row k="Version" mono v={secret.version} />}
        {secret.checksum && (
          <Row
            k="Checksum"
            v={
              <span className="font-mono text-muted text-xs break-all">
                {secret.checksum.slice(0, 16)}…
              </span>
            }
          />
        )}
        <Row k="First seen" mono v={formatAbs(secret.first_seen_at)} />
        <Row k="Last seen" mono v={formatAbs(secret.last_seen_at)} />
        {secret.updated_at_source && (
          <Row
            k="Provider updated"
            mono
            v={formatAbs(secret.updated_at_source)}
          />
        )}
      </dl>

      {labelEntries.length > 0 && (
        <div className="px-5 py-4 border-t border-border/60">
          <div className="text-muted text-[11px] uppercase tracking-wider font-medium mb-2">
            Labels ({labelEntries.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {labelEntries.map(([k, v]) => (
              <LabelChip key={k} k={k} v={v} />
            ))}
          </div>
        </div>
      )}

      {secret.provider_config && Object.keys(secret.provider_config).length > 0 && (
        <div className="px-5 py-4 border-t border-border/60">
          <div className="text-muted text-[11px] uppercase tracking-wider font-medium mb-2">
            Provider config
          </div>
          <pre className="text-[11px] text-muted bg-bg/40 border border-border/60 rounded-lg px-3 py-2 overflow-x-auto font-mono">
            {JSON.stringify(secret.provider_config, null, 2)}
          </pre>
        </div>
      )}

      <div className="px-5 py-3 border-t border-border/60 text-[11px] text-muted">
        Metadata only. To view the value, submit a Read request from{' '}
        <span className="font-mono text-text">/requests</span>.
      </div>
    </Card>
  );
}

// --- shared bits ----------------------------------------------------

function FilterField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls + (mono ? ' font-mono' : '')}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function Row({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 items-baseline">
      <dt className="text-muted text-xs uppercase tracking-wider">{k}</dt>
      <dd
        className={
          'text-sm break-all ' + (mono ? 'font-mono text-text' : 'text-text')
        }
      >
        {v}
      </dd>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-5 py-3.5 align-top ${className}`}>{children}</td>;
}

const inputCls =
  'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';

function formatRelativePast(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatAbs(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
