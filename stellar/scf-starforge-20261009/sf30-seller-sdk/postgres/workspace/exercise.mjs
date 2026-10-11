#!/usr/bin/env node
// MIT. One actual PostgreSQL metadata → merchant package → original SF30 flow.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Client } from 'pg';
import { main } from './server.mjs';
import { openPostgresSourceFile, readPostgresSourceFile, resolvePostgresConnection } from '../config.mjs';
import { readSellerConfig } from '../../serve.mjs';
import { startPostgresMerchant } from '../merchant.mjs';

const directory = await mkdtemp(join(tmpdir(), 'sf30-pg-workspace-'));
const previous = process.env.SF30_WORKSPACE_EXERCISE_URL;
const child = fork(fileURLToPath(new URL('../demo-database.mjs', import.meta.url)), [], {
  execArgv: [], env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
let workspace, source, seller, client, browser;
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DEMO_POSTGRES_START_TIMEOUT')), 30000);
    child.once('error', issue => { clearTimeout(timer); reject(issue); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('DEMO_POSTGRES_EXIT_' + code)); });
    child.on('message', message => { if (message?.event === 'ready') { clearTimeout(timer); resolve(message); } });
  });
  const uri = new URL(ready.uri); uri.password = 'workspace-exercise-private-value';
  process.env.SF30_WORKSPACE_EXERCISE_URL = uri.href;
  const base = JSON.parse(await readFile(new URL('../example-source.json', import.meta.url), 'utf8'));
  base.connectionEnv = 'SF30_WORKSPACE_EXERCISE_URL'; base.tls = 'local-plaintext'; base.maxConnections = 1;
  const filename = join(directory, 'existing-source.json');
  await writeFile(filename, JSON.stringify(base), { mode: 0o600, flag: 'wx' });
  workspace = await main(['--source', filename, '--output', join(directory, 'exports'), '--port', '0']);
  const session = await (await fetch(workspace.url + '/api/session')).json();
  const request = async (path, body) => {
    const response = await fetch(workspace.url + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-token': session.token }, body: JSON.stringify(body) });
    const text = await response.text();
    assert.ok(!text.includes(uri.password) && !text.includes('900719925474099312345'));
    return { status: response.status, data: JSON.parse(text) };
  };
  assert.equal((await fetch(workspace.url)).status, 200);
  assert.equal((await fetch(workspace.url + '/app.mjs')).status, 200);
  assert.equal((await fetch(workspace.url + '/api/session', { headers: { origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(workspace.url + '/api/export', { method: 'POST' })).status, 403);
  const catalog = (await request('/api/catalog?schema=sf30_demo')).data;
  const table = catalog.relations.find(relation => relation.name === 'products'); assert.ok(table);
  const relation = (await request('/api/relation?id=' + table.id)).data;
  const choices = { relationId: relation.id, fingerprint: relation.fingerprint,
    queryName: 'catalog_workspace', routePath: '/data/catalog', columns: ['id', 'title', 'price_cents'], orderBy: ['id'],
    filters: [{ column: 'region', operator: 'eq', name: 'region' }, { column: 'id', operator: 'min', name: 'minimum_id' }],
    maxRows: 2, timeoutMs: 1500, payment: basePayment() };
  let preview, exported;
  if (process.env.SF30_WORKSPACE_CHROMIUM) {
    const { chromium } = createRequire(import.meta.url)('playwright');
    browser = await chromium.launch({ headless: true, executablePath: process.env.SF30_WORKSPACE_CHROMIUM,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const browserErrors = []; page.on('pageerror', error => browserErrors.push(error.message));
    await page.goto(workspace.url);
    await page.locator('#sources button').filter({ hasText: 'products' }).click();
    for (const field of choices.columns) await page.getByRole('checkbox', { name: 'Include ' + field, exact: true }).check();
    await page.locator('#order').selectOption('id');
    for (const [index, filter] of choices.filters.entries()) {
      await page.locator('#add-filter').click();
      const row = page.locator('.filter-row').nth(index);
      await row.getByLabel('Column', { exact: true }).selectOption(filter.column);
      await row.getByLabel('Match', { exact: true }).selectOption(filter.operator);
      await row.getByLabel('Request parameter', { exact: true }).fill(filter.name);
    }
    for (const [id, value] of Object.entries({ 'query-name': choices.queryName, 'route-path': choices.routePath,
      'max-rows': '2', amount: choices.payment.amount, asset: choices.payment.asset, 'pay-to': choices.payment.payTo }))
      await page.locator('#' + id).fill(value);
    const pending = page.waitForResponse(response => response.url().endsWith('/api/preview'));
    await page.locator('#preview').click(); const response = await pending;
    preview = { status: response.status(), data: await response.json() };
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const saving = page.waitForResponse(response => response.url().endsWith('/api/export'));
    await page.locator('#export').click(); const saved = await saving;
    exported = { status: saved.status(), data: await saved.json() };
    await page.locator('#saved').waitFor({ state: 'visible' });
    if (process.env.SF30_WORKSPACE_SCREENSHOT) {
      await page.locator('#relation-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.SF30_WORKSPACE_SCREENSHOT, fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(browserErrors, []); await browser.close(); browser = null;
  } else preview = await request('/api/preview', choices);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.deepEqual(preview.data.source.queries.catalog_workspace.parameterOrder, ['region', 'minimum_id']);
  assert.equal(preview.data.source.tls, 'local-plaintext');
  // Browser uses the table's default description; replay exactly those same choices.
  const accepted = { ...choices, description: 'products data query', expectedPlanId: preview.data.planId };
  exported ??= await request('/api/export', accepted); assert.equal(exported.status, 201);
  const files = exported.data.directory;
  assert.equal((await stat(files)).mode & 0o777, 0o700);
  const original = await readFile(join(files, 'source.json'), 'utf8');
  assert.equal((await stat(join(files, 'source.json'))).mode & 0o777, 0o600);
  assert.ok(!original.includes(uri.password));
  const second = await request('/api/export', accepted); assert.equal(second.status, 201);
  assert.notEqual(second.data.directory, files); assert.equal(await readFile(join(files, 'source.json'), 'utf8'), original);
  const declaration = await readPostgresSourceFile(join(files, 'source.json'));
  ({ source } = await openPostgresSourceFile(join(files, 'source.json')));
  const data = await source.query('catalog_workspace', { region: 'north', minimum_id: '3' });
  assert.equal(data.rowCount, 2); assert.equal(data.rows[0].price_cents, '900719925474099312345');
  assert.equal(data.rows[0].title, '東京 demo'); assert.ok(!Object.hasOwn(data.rows[0], 'internal_note'));
  const service = await readSellerConfig(join(files, 'service.json'));
  seller = await startPostgresMerchant({ source, config: service, bindings: declaration.config.bindings, port: 0 });
  const before = source.status().completed;
  const unpaid = await fetch(seller.url + '/data/catalog?region=north');
  assert.equal(unpaid.status, 402); assert.ok(unpaid.headers.get('payment-required'));
  assert.equal(source.status().completed, before);
  assert.equal((await fetch(seller.url + '/_seller/docs')).status, 200);
  // A real catalog change makes an already-reviewed browser plan obsolete.
  client = new Client(await resolvePostgresConnection(declaration, process.env)); await client.connect();
  await client.query('ALTER TABLE sf30_demo.products ADD COLUMN workspace_schema_change boolean');
  await client.end(); client = null;
  const stale = await request('/api/export', accepted);
  assert.equal(stale.status, 409); assert.equal(stale.data.error, 'SOURCE_SCHEMA_CHANGED');
  console.log(JSON.stringify({ result: 'PASS', workflow: 'actual PostgreSQL catalog → workspace HTTP → canonical files → original SF30',
    engine: ready.engine, version: ready.version, chromium: Boolean(process.env.SF30_WORKSPACE_CHROMIUM),
    metadataOnlyPreview: true, privateCreateOnlyExports: true,
    canonicalParameterizedQuery: true, exactNumeric: true, originalUnsignedStatus: 402,
    noQueryOnUnsignedRequest: true, schemaDriftRejected: true, sourceQueries: source.status().completed,
    paymentOperations: 0, hostedActions: 0 }));
} finally {
  await browser?.close().catch(() => {});
  await client?.end().catch(() => {}); await seller?.close().catch(() => {});
  await source?.close().catch(() => {}); await workspace?.close().catch(() => {});
  if (previous === undefined) delete process.env.SF30_WORKSPACE_EXERCISE_URL; else process.env.SF30_WORKSPACE_EXERCISE_URL = previous;
  if (child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit').catch(() => {});
    if (child.connected) child.send({ event: 'stop' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000); await stopped; clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
function basePayment() { return { network: 'stellar:testnet', asset: 'UNVERIFIED_DEMO_ASSET',
  payTo: 'UNVERIFIED_DEMO_RECIPIENT', amount: '10000' }; }
