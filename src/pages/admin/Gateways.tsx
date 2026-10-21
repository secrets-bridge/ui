/**
 * Gateways (`/admin/gateways`, gateway.list). Release 1 is Argo CD only
 * (secrets-bridge/gateway#12): a Gateway runs in the workload boundary,
 * reads Argo CD with read-only rights and reports what it saw for
 * executed changes. What it reports is operational state, never proof
 * that a new secret value reached the app.
 *
 * - The list shows each Gateway's status (glyph and word), replicas seen
 *   in the last 10 minutes, last heartbeat in UTC, whether a recent
 *   replica reported more Argo CD rights than read-only (over_privileged), and the
 *   connectors it advertises (the list's connector summary).
 * - "Create gateway" (gateway.mint) creates the record and goes straight
 *   to a one-time enrollment token.
 * - A row opens the Gateway: tokens, connectors (approve, gateway.bind),
 *   bindings (gateway.bind), recent tasks, and disable, enable or revoke
 *   (gateway.revoke). Every write asks for a fresh second factor.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import { missingFactorText } from '../../api/mfaErrors';
import { type CreateGatewayInput, type Gateway, type GatewayListItem, useCreateGateway, useGateways } from '../../api/gateways';
import { useEnvironments, useProjects } from '../../api/tenancy';
import { useAuth } from '../../auth/AuthContext';
import { CONNECTOR_KIND_LABEL, CONNECTOR_STATUS_LABEL, words } from '../../lib/gatewayStatus';
import { formatAgo, formatExact } from '../../lib/time';
import { useNow } from '../../lib/useNow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { Field, Input, Select } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';
import { GatewayDrawer } from './gateways/GatewayDrawer';
import { GatewayStatusWord } from './gateways/GatewayStatusWord';
import { TokenDrawer } from './gateways/TokenDrawer';

export function Gateways() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('gateway.list');
  const list = useGateways({ enabled: allowed });
  const now = useNow(15_000);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<Gateway | null>(null);

  const all = list.data ?? [];

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Gateways" />
        <EmptyState title="You can't view Gateways.">Listing Gateways needs gateway.list. Ask an administrator.</EmptyState>
      </div>
    );
  }

  const rows = [...all].sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked') || a.name.localeCompare(b.name));
  const count = (s: Gateway['status']) => all.filter((g) => g.status === s).length;
  const over = all.filter((g) => g.status !== 'revoked' && g.over_privileged).length;
  const facts = [
    `${all.length} ${all.length === 1 ? 'gateway' : 'gateways'}`,
    count('active') && `${count('active')} active`,
    count('stale') && `${count('stale')} stale`,
    count('pending') && `${count('pending')} pending`,
    over && `${over} over-privileged`,
  ].filter(Boolean);

  const connectors = (g: GatewayListItem) => {
    const cs = g.connectors ?? [];
    if (!cs.length) return <span className="text-muted">None advertised</span>;
    return (
      <span className="flex flex-col">
        {cs.map((c) => (
          <span key={c.id}>
            {words(c.kind, CONNECTOR_KIND_LABEL)} <span className="font-mono text-mono-small">{c.connector_id}</span>
            <span className="text-caption text-muted">
              {' '}
              · {words(c.status, CONNECTOR_STATUS_LABEL)} · {c.target_count} {c.target_count === 1 ? 'target' : 'targets'}
            </span>
          </span>
        ))}
      </span>
    );
  };

  const columns: Column<GatewayListItem>[] = [
    {
      key: 'name',
      header: 'Gateway',
      render: (g) => (
        <button type="button" onClick={() => setOpenId(g.id)} className="text-left font-medium text-accent hover:underline">
          {g.name}
          <span className="block text-caption font-normal text-muted">{g.boundary}</span>
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (g) => <GatewayStatusWord status={g.status} /> },
    {
      key: 'priv',
      header: 'Argo CD rights',
      render: (g) =>
        g.over_privileged ? <ToneStatus tone="bad">Over-privileged</ToneStatus> : <span className="text-muted">{g.last_seen_at ? 'Not flagged' : 'No heartbeat yet'}</span>,
    },
    { key: 'replicas', header: 'Replicas', render: (g) => `${g.replicas_seen} of ${g.max_replicas}`, className: 'whitespace-nowrap' },
    {
      key: 'seen',
      header: 'Last heartbeat',
      render: (g) =>
        g.last_seen_at ? (
          <span>
            {formatExact(g.last_seen_at)}
            <span className="block text-caption text-muted">{formatAgo(g.last_seen_at, now)}</span>
          </span>
        ) : (
          <span className="text-muted">Never</span>
        ),
      className: 'whitespace-nowrap',
    },
    { key: 'connectors', header: 'Connectors', render: connectors },
  ];

  return (
    <div>
      <PageHeader
        title="Gateways"
        description={
          list.data && all.length
            ? facts.join(' · ')
            : 'A Gateway observes Argo CD from inside the workload boundary, read-only, and reports what it saw for executed changes.'
        }
        actions={
          hasPermission('gateway.mint') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create gateway
            </Button>
          ) : undefined
        }
      />

      {list.isLoading && <p className="text-muted">Loading Gateways…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the Gateways."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : 'Network error.'}
        </Banner>
      )}
      {list.data &&
        (all.length === 0 ? (
          <EmptyState title="No Gateways yet.">
            Create one for each cluster or account whose Argo CD you want to observe. It enrolls with a one-time token and
            never needs inbound access.
          </EmptyState>
        ) : (
          <DataTable
            label="Gateways"
            columns={columns}
            rows={rows}
            rowKey={(g) => g.id}
            onRowClick={(g) => setOpenId(g.id)}
            minWidth={900}
            alignTop
            stacked={(g) => (
              <div className="flex flex-col gap-1">
                <p className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setOpenId(g.id)} className="text-left font-medium text-accent hover:underline">
                    {g.name}
                  </button>
                  <GatewayStatusWord status={g.status} />
                </p>
                {g.over_privileged && <ToneStatus tone="bad">Over-privileged</ToneStatus>}
                <p className="text-caption text-muted">
                  {g.boundary} · {g.replicas_seen} of {g.max_replicas} replicas ·{' '}
                  {g.last_seen_at ? `last heartbeat ${formatExact(g.last_seen_at)}` : 'never seen'}
                </p>
              </div>
            )}
          />
        ))}

      {openId && <GatewayDrawer id={openId} onClose={() => setOpenId(null)} onMintToken={(g) => setTokenFor(g)} />}
      {creating && (
        <CreateGatewayDrawer
          onClose={() => setCreating(false)}
          onCreated={(g) => {
            setCreating(false);
            setTokenFor(g);
          }}
        />
      )}
      {tokenFor && <TokenDrawer gateway={tokenFor} onClose={() => setTokenFor(null)} />}
    </div>
  );
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function CreateGatewayDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (g: Gateway) => void }) {
  const create = useCreateGateway();
  const projects = useProjects();
  const envs = useEnvironments();
  const toast = useToast();
  const [name, setName] = useState('');
  const [boundary, setBoundary] = useState('');
  const [envId, setEnvId] = useState('');
  const [maxReplicas, setMaxReplicas] = useState('');
  const [maxInflight, setMaxInflight] = useState('');
  const [tried, setTried] = useState(false);

  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const envOptions = [...(envs.data ?? [])].sort(
    (a, b) => (projectName.get(a.project_id) ?? '').localeCompare(projectName.get(b.project_id) ?? '') || a.name.localeCompare(b.name),
  );

  const errors: Record<string, string> = {};
  if (!NAME_RE.test(name)) errors.name = 'Use 1 to 63 lowercase letters, digits and hyphens, starting with a letter or digit.';
  if (!boundary.trim() || boundary.trim() !== boundary || boundary.length > 128) errors.boundary = 'Name the boundary, up to 128 characters, no leading or trailing spaces.';
  const intOk = (v: string) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 1000);
  if (!intOk(maxReplicas)) errors.maxReplicas = 'A whole number from 1 to 1000, or empty for 200.';
  if (!intOk(maxInflight)) errors.maxInflight = 'A whole number from 1 to 1000, or empty for 20.';
  const show = (k: string) => (tried ? errors[k] : undefined);

  const submit = async () => {
    setTried(true);
    const first = ['name', 'boundary', 'maxReplicas', 'maxInflight'].find((k) => errors[k]);
    if (first) {
      document.getElementById(`gw-${first}`)?.focus();
      return;
    }
    const body: CreateGatewayInput = { name, boundary };
    if (envId) body.environment_id = envId;
    if (maxReplicas) body.max_replicas = Number(maxReplicas);
    if (maxInflight) body.max_inflight_tasks = Number(maxInflight);
    try {
      const g = await create.mutateAsync(body);
      toast(`Created ${g.name}. Next, create its enrollment token.`);
      onCreated(g);
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Create gateway"
      subtitle="Creates a pending Gateway. It enrolls with a one-time token you create next."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-gateway" variant="primary" disabled={create.isPending} aria-busy={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create gateway'}
          </Button>
        </>
      }
    >
      <form
        id="create-gateway"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <Field id="gw-name" label="Name" hint="Lowercase letters, digits and hyphens. Unique." error={show('name')}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} placeholder="tenant-a-uat" data-autofocus />}
        </Field>
        <Field id="gw-boundary" label="Boundary" hint="Where it runs, such as a cluster or account name. For people reading this list." error={show('boundary')}>
          {(p) => <Input {...p} value={boundary} onChange={(e) => setBoundary(e.target.value)} autoComplete="off" placeholder="cluster tenant-a-uat" />}
        </Field>
        <Field id="gw-env" label="Environment (optional)" hint="Pins the Gateway to one environment: bindings in any other are refused.">
          {(p) => (
            <Select {...p} value={envId} onChange={(e) => setEnvId(e.target.value)}>
              <option value="">{envs.isLoading ? 'Loading environments…' : 'Any environment'}</option>
              {envOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {projectName.get(e.project_id) ?? 'Project'} · {e.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3 max-[600px]:grid-cols-1">
          <Field id="gw-maxReplicas" label="Max replicas" hint="Default 200." error={show('maxReplicas')}>
            {(p) => <Input {...p} inputMode="numeric" value={maxReplicas} onChange={(e) => setMaxReplicas(e.target.value.trim())} placeholder="200" />}
          </Field>
          <Field id="gw-maxInflight" label="Max tasks in flight" hint="Default 20." error={show('maxInflight')}>
            {(p) => <Input {...p} inputMode="numeric" value={maxInflight} onChange={(e) => setMaxInflight(e.target.value.trim())} placeholder="20" />}
          </Field>
        </div>
        {create.isError && (
          <Banner tone="error" title="No Gateway was created.">
            {createErrorText(create.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function createErrorText(err: unknown): string {
  const noFactor = missingFactorText(err, 'no Gateway was created');
  if (noFactor) return noFactor;
  if (!(err instanceof ApiError)) return 'Network error. Try again.';
  if (err.status === 409) return '409: A Gateway with this name already exists.';
  if (err.status === 403) return "403: You don't have permission to create Gateways (gateway.mint).";
  return `${err.status}: ${err.message}`;
}
