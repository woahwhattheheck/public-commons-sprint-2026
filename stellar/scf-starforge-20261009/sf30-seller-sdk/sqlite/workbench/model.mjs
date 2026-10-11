// MIT. Operator onboarding for the original SF30 SQLite source; no payment engine.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink, readdir, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { compileQueries, bindParameters, record } from '../parameters.mjs';
import { createSqliteQuerySource } from '../source.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../../seller.mjs';
import { compileServicePath, orderServiceRoutes } from '../../route-path.mjs';

const FORMAT = 'stellar-forge.sqlite-workbench.v1';
const MAX_STATE = 1048576;
const SDK = fileURLToPath(new URL('../../', import.meta.url));
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = text => createHash('sha256').update(text).digest('hex');
const fault = (message, status = 422) => Object.assign(new Error(message), { status });
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fault('Choose a real private workspace directory, not a link.');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw fault('Workspace directory must have mode 0700.');
}
async function readPrivate(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_STATE || info.nlink !== 1) throw fault('Invalid workspace file.');
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw fault('Workspace files must have mode 0600.');
    const data = await file.readFile();
    if (data.length > MAX_STATE) throw fault('Workspace file exceeds 1 MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } finally { await file.close(); }
}
async function createFile(path, text) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
function draftShape(draft) {
  if (!record(draft) || !record(draft.merchant) || !Array.isArray(draft.queries) || draft.queries.length > 64)
    throw fault('A draft needs merchant settings and up to 64 queries.');
  if (Buffer.byteLength(json(draft)) > 900000) throw fault('Draft is too large.');
  // Incomplete SQL/payment settings are deliberately saveable. They must pass
  // the original compilers before export; saving is not a release operation.
  if (draft.queries.some(query => !record(query))) throw fault('Each query must be an object.');
  return structuredClone(draft);
}
function querySpec(query) {
  if (!record(query) || !NAME.test(query.name ?? '') || forbidden.has(query.name)) throw fault('Choose a unique SQL query name (letters, digits, underscore).');
  const { sql, columns, parameters, maxRows, maxBytes, timeoutMs } = query;
  const compiled = compileQueries({ [query.name]: { sql, columns, parameters, maxRows, maxBytes, timeoutMs } });
  if (Object.keys(compiled[query.name].parameters).some(name => forbidden.has(name))) throw fault('Reserved parameter name.');
  return compiled[query.name];
}

/** Compile public terms with the SAME seller compiler used by the service. */
export function compileDraft(draft, database) {
  draftShape(draft);
  if (!draft.queries.length) throw fault('Add at least one query before exporting.');
  const merchant = draft.merchant;
  let origin;
  try { origin = new URL(merchant.origin); } catch { throw fault('Enter the merchant HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      origin.origin !== merchant.origin.replace(/\/$/, '')) throw fault('Merchant origin must be canonical HTTPS, without a path or credentials.');
  const queries = Object.create(null), seen = new Set(), offers = [];
  const routes = draft.queries.map((query, index) => {
    if (Object.hasOwn(queries, query.name)) throw fault('Query names must be unique.');
    const spec = querySpec(query), method = query.method;
    if (!['GET', 'POST'].includes(method)) throw fault('SQLite routes support GET parameters or a JSON POST body.');
    const path = query.path;
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_.~/-]*$/.test(path) || path.startsWith('/_seller/') || path === '/_seller' ||
        path.includes('//') || new URL(path, origin).pathname !== path) throw fault('Use a fixed canonical route path outside /_seller.');
    const routeKey = method + ' ' + path;
    if (seen.has(routeKey)) throw fault('Each method/path pair must be unique.');
    seen.add(routeKey); queries[query.name] = spec;
    if (!record(query.publicInput)) throw fault('Public example input must be a JSON object.');
    bindParameters(spec, query.publicInput);
    const definition = {
      method, serviceName: merchant.name, description: query.description,
      tags: ['sqlite', 'data-api'],
      payment: { scheme: 'exact', network: merchant.network, asset: merchant.asset,
        payTo: merchant.payTo, amount: query.amount, maxTimeoutSeconds: merchant.maxTimeoutSeconds },
      // Never put private preview rows in publicly advertised discovery metadata.
      outputExample: { schema: 'stellar-forge.sqlite-result.v1', query: query.name, columns: spec.columns,
        rows: [], rowCount: 0, truncated: false, integerEncoding: 'decimal-string', blobEncoding: 'tagged-base64' },
    };
    if (method === 'POST') { definition.bodyType = 'json'; definition.body = structuredClone(query.publicInput); }
    else definition.queryParameters = Object.entries(spec.parameters).map(([name, parameter]) => {
      if (!Object.hasOwn(query.publicInput, name)) throw fault(`Supply a deliberately public GET example for ${name}; private defaults are never copied automatically.`);
      const example = query.publicInput[name];
      if (example === null || example === undefined || typeof example === 'object') throw fault(`GET public example needs a non-null scalar for ${name}.`);
      return { name, type: 'string', required: !Object.hasOwn(parameter, 'default'),
        description: `Bound ${parameter.type} parameter. Integer values are exact decimal strings.`, example: String(example) };
    });
    const offer = compileHttpSellerOffer({ ...definition, url: origin.origin + path });
    paymentRequiredResponse(offer); offers.push(offer);
    return { id: query.name, path, definition, handler: `query_${index}`, admit: `admit_${index}` };
  });
  orderServiceRoutes(offers.map(offer => ({ method: offer.extensions.bazaar.info.input.method,
    path: new URL(offer.resource.url).pathname, binding: compileServicePath(offer) })));
  const source = { schema: 'stellar-forge.sqlite-source.v1', database, queries };
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin.origin, routes };
  if (Buffer.byteLength(json(source)) > 262144) throw fault('Source export exceeds the original 256 KiB configuration limit.');
  if (Buffer.byteLength(json(service)) > MAX_STATE) throw fault('Seller export exceeds 1 MiB.');
  return { source, service, offers };
}

function handlersText(draft) {
  return `// Generated by the SF30 SQLite workbench. Operator-private; retain with source.json.\n` +
`import { readFile } from 'node:fs/promises';\nimport { resolve, dirname } from 'node:path';\nimport { pathToFileURL, fileURLToPath } from 'node:url';\n` +
`const sdk = resolve(process.env.SF30_SQLITE_SDK || ${JSON.stringify(SDK)});\n` +
`const { createSqliteQuerySource } = await import(pathToFileURL(resolve(sdk, 'sqlite/source.mjs')).href);\n` +
`const config = JSON.parse(await readFile(new URL('./source.json', import.meta.url), 'utf8'));\n` +
`if (config.schema !== 'stellar-forge.sqlite-source.v1') throw new TypeError('Invalid source configuration');\n` +
`export const source = await createSqliteQuerySource({ ...config, database: resolve(dirname(fileURLToPath(import.meta.url)), process.env.SF30_SQLITE_DATABASE || config.database) });\n` +
    draft.queries.map((query, index) => `const route_${index} = source.route(${JSON.stringify(query.name)}, { input: ${JSON.stringify(query.method === 'POST' ? 'body' : 'query')} });\nexport const query_${index} = route_${index}.handler;\nexport const admit_${index} = route_${index}.admit;\n`).join('');
}
function launcherText() {
  return `// Original seller CLI, unchanged payment and shutdown behavior.\n` +
`import { resolve } from 'node:path';\nimport { pathToFileURL, fileURLToPath } from 'node:url';\n` +
`const sdk = resolve(process.env.SF30_SQLITE_SDK || ${JSON.stringify(SDK)});\nlet handlers;\ntry {\n` +
`  handlers = await import('./handlers.mjs');\n  const { main } = await import(pathToFileURL(resolve(sdk, 'serve.mjs')).href);\n` +
`  const session = await main(['--config', fileURLToPath(new URL('./service.json', import.meta.url)), '--handlers', fileURLToPath(new URL('./handlers.mjs', import.meta.url)), ...process.argv.slice(2)]);\n` +
`  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().finally(() => handlers.source.close()).catch(() => { process.exitCode = 1; }));\n` +
`} catch (error) { await handlers?.source.close(); process.stderr.write(String(error.message) + '\\n'); process.exitCode = 1; }\n`;
}

export async function openWorkbench({ database, workspace }) {
  const dbPath = await realpath(resolve(database));
  if (!(await lstat(dbPath)).isFile()) throw fault('Choose an existing SQLite file.');
  const root = resolve(workspace);
  await privateDirectory(root, true);
  const exportsRoot = join(root, 'exports');
  await privateDirectory(exportsRoot, true);
  const statePath = join(root, 'draft.json');
  let tail = Promise.resolve(), closed = false, previewBusy = false;
  const exclusive = task => { const pending = tail.then(task); tail = pending.catch(() => {}); return pending; };
  async function load() {
    const saved = await readPrivate(statePath);
    if (saved.schema !== FORMAT || saved.database !== dbPath) throw fault('This workspace belongs to a different database.');
    draftShape(saved.draft);
    return { revision: digest(json(saved)), draft: saved.draft };
  }
  try { await load(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await createFile(statePath, json({ schema: FORMAT, database: dbPath, draft: {
      merchant: { name: 'SQLite API', origin: '', network: 'stellar:testnet', asset: '', payTo: '', maxTimeoutSeconds: 60 }, queries: [],
    } })).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await load();
  }
  const metadata = await createSqliteQuerySource({ database: dbPath, maxPending: 8, queries: {
    tables: { sql: "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name", columns: ['name', 'type'], parameters: {}, maxRows: 512 },
    columns: { sql: 'SELECT cid, name, type, "notnull" AS required, pk, hidden FROM pragma_table_xinfo($table)',
      columns: ['cid', 'name', 'type', 'required', 'pk', 'hidden'], parameters: { table: { type: 'string', maxLength: 1024 } }, maxRows: 1000 },
  } });
  async function schema(table) {
    const tables = await metadata.query('tables', {});
    if (table === undefined) return { tables: tables.rows, truncated: tables.truncated };
    if (!tables.rows.some(row => row.name === table)) throw fault('Choose a listed table or view.');
    const columns = await metadata.query('columns', { table });
    return { table, columns: columns.rows, truncated: columns.truncated };
  }
  async function exportsList() {
    const entries = await readdir(exportsRoot, { withFileTypes: true });
    const complete = [];
    for (const entry of entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))) {
      try {
        const manifest = await readPrivate(join(exportsRoot, entry.name, 'manifest.json'));
        if (manifest.schema !== 'stellar-forge.sqlite-workbench-release.v1') continue;
        complete.push({ name: entry.name, directory: join(exportsRoot, entry.name),
          command: 'node ' + quote(join(exportsRoot, entry.name, 'launch.mjs')) + ' --port 0' });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return complete.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function state() { return { ...await load(), databaseName: basename(dbPath), exports: await exportsList() }; }
  async function locked(task) {
    // A short filesystem lock covers read-revision/write/rename across processes.
    // A stale lock is left intact after a crash rather than silently losing edits.
    const lock = join(root, 'write.lock');
    let handle;
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw fault('Workspace write in progress. Retry; after a crashed writer, remove write.lock only when that process is stopped.', 409); throw error; }
    try { await handle.writeFile(String(process.pid)); return await task(); }
    finally { await handle.close(); await unlink(lock); }
  }
  async function save(draft, revision) {
    if (closed) throw fault('Workbench is closed.', 503);
    draftShape(draft);
    return exclusive(() => locked(async () => {
      if ((await load()).revision !== revision) throw fault('Draft changed in another tab. Reload before replacing it.', 409);
      const temp = join(root, '.draft-' + randomBytes(8).toString('hex'));
      try {
        await createFile(temp, json({ schema: FORMAT, database: dbPath, draft }));
        await rename(temp, statePath); await syncDirectory(root);
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return state();
    }));
  }
  async function preview(query, input, { signal } = {}) {
    if (closed) throw fault('Workbench is closed.', 503);
    if (previewBusy) throw fault('A preview is already running.', 429);
    previewBusy = true;
    let source;
    try {
      const spec = querySpec(query);
      source = await createSqliteQuerySource({ database: dbPath, queries: { [query.name]: spec }, maxPending: 1 });
      return await source.query(query.name, input, { signal });
    } finally { await source?.close(); previewBusy = false; }
  }
  async function inspectDraft(draft) {
    const compiled = compileDraft(draft, dbPath);
    const source = await createSqliteQuerySource(compiled.source);
    try { return { service: compiled.service, offers: compiled.offers, contracts: source.describe() }; }
    finally { await source.close(); }
  }
  async function exportPack(name, revision) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name ?? '')) throw fault('Export name must be 1–64 letters, digits, hyphens or underscores.');
    return exclusive(() => locked(async () => {
      const saved = await load();
      if (saved.revision !== revision) throw fault('Save the current draft before exporting.', 409);
      const checked = await inspectDraft(saved.draft), compiled = compileDraft(saved.draft, dbPath);
      const directory = join(exportsRoot, name);
      await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code === 'EEXIST') throw fault('Export already exists. Choose a new release name.', 409); throw error; });
      const command = 'node ' + quote(join(directory, 'launch.mjs')) + ' --port 0';
      const files = { 'source.json': json(compiled.source), 'service.json': json(compiled.service),
        'handlers.mjs': handlersText(saved.draft), 'launch.mjs': launcherText(),
        'RUN.md': `# SQLite merchant release\n\nRun from this machine:\n\n\`\`\`sh\n${command}\n\`\`\`\n\nThis starts the ORIGINAL SF30 seller in CHALLENGE_ONLY mode. It does not collect money. Use the original seller's --facilitator option and operator-managed HTTPS for native settlement.\n\nRelocation: set SF30_SQLITE_SDK to the original sf30-seller-sdk directory and SF30_SQLITE_DATABASE to the authorized database file. No database was copied. Source SQL and paths are private. Do not publish this directory. Public offers contain only the deliberately supplied example inputs and empty result structures, never preview rows.\n\nPayment addresses and ownership are not authenticated by schema validation. Existing SDK/facilitator behavior remains authoritative. SIGINT/SIGTERM close the original service and SQLite source. Each query reads its current database snapshot; separate requests do not share a snapshot.\n`,
      };
      try {
        for (const [filename, text] of Object.entries(files)) await createFile(join(directory, filename), text);
        await createFile(join(directory, 'manifest.json'), json({ schema: 'stellar-forge.sqlite-workbench-release.v1',
          draftRevision: saved.revision, databaseCopied: false, previewRowsIncluded: false,
          files: Object.fromEntries(Object.entries(files).map(([filename, text]) => [filename, digest(text)])) }));
        await syncDirectory(directory); await syncDirectory(exportsRoot);
      } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      return { name, directory, command, routes: checked.service.routes.map(route => ({ method: route.definition.method, path: route.path, amount: route.definition.payment.amount })), files: [...Object.keys(files), 'manifest.json'] };
    }));
  }
  async function close() { closed = true; await tail; await metadata.close(); }
  return Object.freeze({ state, schema, save, preview, inspectDraft, exportPack, close });
}
