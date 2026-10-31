import { expect, test, type Page } from '@playwright/test';
import { adminPassword, as, call, fx, keepOutOfArtifacts } from '../support/stack';
import { secondFactor, stepUp } from '../support/totp';

// Discovered Argo CD targets and team-scoped binding (ui#173, ADR 0002
// S5). Nothing here runs the Gateway binary: the spec plays one over its
// machine routes (enroll, catalog, heartbeat, discovery upload), which is
// all the console ever sees of it.

test.describe.configure({ mode: 'serial' });

const ENDPOINT_DIGEST = 'sha256:9508006565bb8a9beb9bb68e3984a5350e7e0320f55945cad5aeddbdd71115ce';
const ALLOWED = ['alpha-apps', 'alpha-tools', 'beta-apps'];
const SNAPSHOT = { alg: 'A256GCM+HKDF-SHA256/v1', nonce: 'oKGio6Slpqeoqaqr', ciphertext: btoa('opaque sealed bytes') };

// Sorted by target id, as the api requires. "shared" exists three times:
// twice for team alpha, so a team admin sees it flagged, and once for
// team beta, so that row must never reach alpha.
const ENTRIES = [
  { target_id: 'd-aaaaaaaaaaaaaaaaaaaaaaaaaa', app_project: 'alpha-apps', namespace: 'argocd', name: 'payments-api' },
  { target_id: 'd-bbbbbbbbbbbbbbbbbbbbbbbbbb', app_project: 'alpha-apps', namespace: 'argocd', name: 'shared' },
  { target_id: 'd-cccccccccccccccccccccccccc', app_project: 'alpha-tools', namespace: 'tools', name: 'shared' },
  { target_id: 'd-dddddddddddddddddddddddddd', app_project: 'beta-apps', namespace: 'argocd', name: 'orders-api' },
  { target_id: 'd-eeeeeeeeeeeeeeeeeeeeeeeeee', app_project: 'beta-apps', namespace: 'argocd', name: 'shared' },
];

/** services.GatewayScopeDigest: keys sorted, no whitespace. */
async function scopeDigest(projects: string[]): Promise<string> {
  const doc = JSON.stringify({
    allowed_projects: projects,
    discovery_enabled: true,
    endpoint_digest: ENDPOINT_DIGEST,
    identity_mode: 'names',
    kind: 'argocd',
    v: 'sb-argocd-scope/v1',
  });
  const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(doc));
  return 'sha256:' + Array.from(new Uint8Array(sum), (b) => b.toString(16).padStart(2, '0')).join('');
}

function heartbeat(replica: string, digest: string) {
  return {
    replica_id: replica,
    gateway_version: '0.4.0',
    contract_versions: ['1', '2'],
    status: 'ok',
    in_flight: 0,
    bound_targets_version: '',
    connectors: [{ connector_id: 'argocd-main', kind: 'argocd', status: 'ok', scope_digest: digest, discovery_enabled: true, discovery_interval_seconds: 60 }],
  };
}

const replica = crypto.randomUUID();
const gatewayName = `e2e-discovery-${replica.slice(0, 6)}`;
let gatewayId = '';
let connectorId = '';
let bindingId = '';
let gwHeaders: Record<string, string> = {};

async function admin(browser: Parameters<typeof as>[0]): Promise<Page> {
  const page = await as(browser, fx.users.admin, adminPassword);
  await stepUp(page, await secondFactor(page, fx.users.admin));
  return page;
}

async function teamAdmin(browser: Parameters<typeof as>[0], email: string): Promise<Page> {
  const page = await as(browser, email);
  await stepUp(page, await secondFactor(page, email));
  return page;
}

async function openConnector(page: Page) {
  await page.goto('/admin/gateways');
  await page.getByRole('button', { name: new RegExp(gatewayName) }).click();
  return page.getByRole('dialog', { name: gatewayName });
}

test('a platform admin maps the AppProjects, then approves the scope', async ({ browser }) => {
  const page = await admin(browser);

  const gw = await call(page, 'POST', '/api/v1/admin/gateways', { name: gatewayName, boundary: 'cluster e2e-cluster' });
  expect(gw.status, 'create the Gateway').toBe(201);
  gatewayId = String(gw.body.id);
  const mint = await call(page, 'POST', `/api/v1/admin/gateways/${gatewayId}/enrollment-token`, {});
  expect(mint.status, 'mint a token').toBe(201);
  keepOutOfArtifacts(String(mint.body.enrollment_token));
  const enrolled = await call(page, 'POST', '/api/v1/gateways/enroll', { enrollment_token: mint.body.enrollment_token });
  expect(enrolled.status, 'enroll').toBe(201);
  keepOutOfArtifacts(String(enrolled.body.gateway_secret));
  gwHeaders = { 'X-Gateway-Secret': String(enrolled.body.gateway_secret) };

  const machine = `/api/v1/gateways/${gatewayId}`;
  const e3 = await call(page, 'PUT', `${machine}/catalog`, { connectors: [{ connector_id: 'argocd-main', kind: 'argocd', targets: [] }] }, gwHeaders);
  expect(e3.status, 'advertise the connector').toBe(200);
  const digest = await scopeDigest(ALLOWED);
  const hb = await call(page, 'POST', `${machine}/heartbeat`, heartbeat(replica, digest), gwHeaders);
  expect(hb.status, 'heartbeat').toBe(200);
  const lease = (hb.body.discovery_leases as Array<{ lease_id: string; generation: number }>)[0];
  const upload = await call(
    page,
    'PUT',
    `${machine}/connectors/argocd-main/discovery`,
    {
      schema_version: 'gateway.discovery-catalog/v1',
      replica_id: replica,
      lease_id: lease.lease_id,
      generation: lease.generation,
      discovered_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      scope_digest: digest,
      endpoint_digest: ENDPOINT_DIGEST,
      identity_mode: 'names',
      allowed_projects: ALLOWED,
      entries: ENTRIES,
      entries_rejected: 0,
      entries_deferred: 0,
      snapshot: SNAPSHOT,
    },
    gwHeaders,
  );
  expect(upload.status, 'upload the catalog').toBe(200);

  const detail = await call(page, 'GET', `/api/v1/admin/gateways/${gatewayId}`);
  connectorId = (detail.body.connectors as Array<{ id: string }>)[0].id;

  // Approve is held back until every AppProject has a team.
  const drawer = await openConnector(page);
  await expect(drawer.getByText('Discovery on')).toBeVisible();
  await drawer.getByRole('button', { name: 'Approve…' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve argocd-main?' });
  await expect(approve.getByText('Every AppProject needs a team first.')).toBeVisible();
  await expect(approve.getByRole('button', { name: 'Approve connector' })).toBeDisabled();
  await expect(approve.getByText(digest)).toBeVisible();

  await approve.getByRole('button', { name: 'Map teams…' }).click();
  const map = page.getByRole('dialog', { name: 'Map teams: argocd-main' });
  await map.getByLabel('Add a team to alpha-apps').selectOption({ label: 'e2e-alpha' });
  await map.getByLabel('Add a team to alpha-tools').selectOption({ label: 'e2e-alpha' });
  await expect(map.getByText('1 AppProject has no team.')).toBeVisible();
  await map.getByLabel('Add a team to beta-apps').selectOption({ label: 'e2e-beta' });
  await map.getByRole('button', { name: 'Save mapping' }).click();
  await expect(map).toBeHidden();

  await drawer.getByRole('button', { name: 'Approve…' }).click();
  await approve.getByRole('button', { name: 'Approve connector' }).click();
  await expect(approve).toBeHidden();
  await expect(drawer.getByText('Approved', { exact: true })).toBeVisible();

  // A platform admin sees every target, with the look-alikes flagged.
  await page.goto(`/gateways?connector=${connectorId}`);
  const table = page.getByRole('region', { name: 'Argo CD targets' });
  await expect(table.getByRole('row')).toHaveCount(ENTRIES.length + 1);
  await expect(table.getByRole('row', { name: /beta-apps/ }).filter({ hasText: 'shared' }).getByText('Look-alike')).toBeVisible();
});

test('a team admin sees only its own targets, never by name alone', async ({ browser }) => {
  const page = await as(browser, fx.users.alphaAdmin);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Argo CD targets' })).toBeVisible();
  // Team-scoped, so the global admin page isn't offered.
  await expect(nav.getByRole('link', { name: 'Gateways' })).toHaveCount(0);

  await nav.getByRole('link', { name: 'Argo CD targets' }).click();
  const table = page.getByRole('region', { name: 'Argo CD targets' });
  await expect(table.getByText('payments-api')).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByText('beta-apps')).toHaveCount(0);
  await expect(table.getByText('orders-api')).toHaveCount(0);

  for (const e of ENTRIES.slice(0, 3)) {
    const row = table.getByRole('row').filter({ hasText: e.target_id });
    await expect(row.getByText(`AppProject ${e.app_project} · namespace ${e.namespace}`)).toBeVisible();
    await expect(row.getByText(e.name, { exact: true })).toBeVisible();
    await expect(row.getByText('New', { exact: true })).toBeVisible();
  }
  await expect(table.getByRole('row').filter({ hasText: ENTRIES[1].target_id }).getByText('Look-alike')).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: ENTRIES[0].target_id }).getByText('Look-alike')).toHaveCount(0);

  // The server filters, so asking for the other team's rows gets nothing.
  const other = await call(page, 'GET', '/api/v1/gateway-catalog?app_project=beta-apps');
  expect(other.status).toBe(200);
  expect(other.body.items ?? []).toEqual([]);
  expect((await call(page, 'GET', '/api/v1/admin/gateways')).status, 'the admin read').toBe(403);
});

test('a team admin binds into a non-production environment, and production stays out of reach', async ({ browser }) => {
  const page = await teamAdmin(browser, fx.users.alphaAdmin);
  await page.goto('/gateways');
  // No project chosen, nothing to bind into.
  await expect(page.getByRole('button', { name: /^Bind / })).toHaveCount(0);
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'e2e-app' });
  const table = page.getByRole('region', { name: 'Argo CD targets' });
  await table.getByRole('row').filter({ hasText: ENTRIES[1].target_id }).getByRole('button', { name: 'Bind shared' }).click();

  const drawer = page.getByRole('dialog', { name: 'Bind a target' });
  await expect(drawer.getByText('Another target has this name.')).toBeVisible();
  await expect(drawer.getByText(`AppProject ${ENTRIES[1].app_project} · namespace ${ENTRIES[1].namespace}`)).toBeVisible();
  await expect(drawer.getByLabel('Environment').getByRole('option', { name: 'prod' })).toHaveCount(0);
  await expect(drawer.getByText('Production and other environments need a platform admin.')).toBeVisible();
  // Listing provider connections is global.
  await expect(drawer.getByText('A provider connection and a secret path')).toHaveCount(0);

  await drawer.getByLabel('Environment').selectOption({ label: 'dev' });
  await drawer.getByLabel('Secret', { exact: true }).selectOption({ index: 1 });
  await drawer.getByRole('button', { name: 'Create binding' }).click();
  await expect(drawer).toBeHidden();

  // The api is the authority: the same bind into prod is refused.
  const refused = await call(page, 'POST', '/api/v1/admin/gateway-bindings', {
    gateway_id: gatewayId,
    environment_id: fx.envProd,
    secret_id: fx.secretId,
    argocd_connector_id: connectorId,
    argocd_target_id: ENTRIES[0].target_id,
  });
  expect(refused.status).toBe(403);
  expect(refused.body.error).toBe('production_binding_platform_only');

  await page.getByRole('tab', { name: 'Bindings' }).click();
  const bindings = page.getByRole('region', { name: 'Bindings' });
  const row = bindings.getByRole('row').filter({ hasText: ENTRIES[1].target_id });
  await expect(row.getByText('Active')).toBeVisible();
  await expect(row.getByText(`AppProject ${ENTRIES[1].app_project} · namespace ${ENTRIES[1].namespace}`)).toBeVisible();
  const list = await call(page, 'GET', '/api/v1/gateway-bindings');
  bindingId = (list.body.items as Array<{ id: string }>)[0].id;
});

test("another team can't see that binding, or a project outside its teams", async ({ browser }) => {
  const page = await as(browser, fx.users.betaAdmin);
  await page.goto('/gateways?tab=bindings');
  await expect(page.getByText('No bindings yet.')).toBeVisible();
  const asked = await call(page, 'GET', `/api/v1/gateway-catalog?project_id=${fx.project}`);
  expect(asked.status).toBe(200);
  expect(asked.body.items ?? []).toEqual([]);
  await page.goto('/gateways');
  await expect(page.getByRole('region', { name: 'Argo CD targets' }).getByText('orders-api')).toBeVisible();
  await expect(page.getByText('payments-api')).toHaveCount(0);
});

test('a mapping change hides the target but the team still sees why its binding stopped', async ({ browser }) => {
  const page = await admin(browser);
  const mapped = await call(page, 'PUT', `/api/v1/admin/gateways/${gatewayId}/connectors/${connectorId}/project-teams`, {
    mappings: [
      { app_project: 'alpha-apps', team_ids: [fx.otherTeam] },
      { app_project: 'alpha-tools', team_ids: [fx.team] },
      { app_project: 'beta-apps', team_ids: [fx.otherTeam] },
    ],
  });
  expect(mapped.status, 'remap').toBe(200);

  const team = await as(browser, fx.users.alphaAdmin);
  await team.goto('/gateways?tab=bindings');
  const row = team.getByRole('region', { name: 'Bindings' }).getByRole('row').filter({ hasText: ENTRIES[1].target_id });
  await expect(row.getByText('Mapping removed')).toBeVisible();
  await expect(row.getByText('a platform admin has to delete the binding')).toBeVisible();
  await expect(row.getByText('Target details hidden')).toBeVisible();
  await expect(row.getByText('alpha-apps')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Delete…' })).toHaveCount(0);

  // The platform admin can clean up.
  await page.goto('/gateways?tab=bindings');
  const adminRow = page.getByRole('region', { name: 'Bindings' }).getByRole('row').filter({ hasText: ENTRIES[1].target_id });
  await expect(adminRow.getByText('Mapping removed')).toBeVisible();
  await adminRow.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete this binding?' }).getByRole('button', { name: 'Delete binding' }).click();
  await expect(page.getByText('Deleted the binding.')).toBeVisible();
  expect((await call(page, 'GET', `/api/v1/gateway-bindings?gateway_id=${gatewayId}`)).body.items ?? []).toEqual([]);
  expect(bindingId).not.toBe('');
});

test('a scope change holds approval until the next catalog arrives', async ({ browser }) => {
  const page = await admin(browser);
  const changed = await scopeDigest([...ALLOWED, 'gamma-apps'].sort());
  const hb = await call(page, 'POST', `/api/v1/gateways/${gatewayId}/heartbeat`, heartbeat(replica, changed), gwHeaders);
  expect(hb.status, 'heartbeat with a new scope').toBe(200);

  const drawer = await openConnector(page);
  await expect(drawer.getByText("The Gateway's scope changed.", { exact: false })).toBeVisible();
  await drawer.getByRole('button', { name: 'Approve…' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve argocd-main?' });
  await expect(approve.getByText("Waiting for the Gateway's next catalog.")).toBeVisible();
  await expect(approve.getByRole('button', { name: 'Approve connector' })).toBeDisabled();
});
