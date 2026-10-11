// MIT. Merchant draft/review/publication UI using the ORIGINAL dataset controls.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { datasetQueryParameters } from '../dataset-cli.mjs';
import { datasetControl } from './service.mjs';
import { datasetBuyerEndpoint, readDatasetBuyerOffer, prepareDatasetBuyer } from './buyer-handoff.mjs';

const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const publicDraft = draft => draft ? { id: draft.id, filename: draft.filename,
  sourceBytes: draft.sourceBytes, csvHash: draft.csvHash, dataset: draft.dataset.describe(),
  expectedSnapshot: draft.expectedSnapshot, expectedRevision: draft.expectedRevision } : null;

async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077)))
    throw fault('PRIVATE_DIRECTORY_REQUIRED', 'Use the existing private dataset state directory.');
}

async function privateJson(path, expectedHash) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && (stat.mode & 0o077)))
      throw fault('INVALID_SOURCE_CONFIG', 'The original dataset configuration is not a private regular file.');
    const bytes = await file.readFile();
    if (bytes.length > 65536 || expectedHash && hash(bytes) !== expectedHash)
      throw fault('SOURCE_CONFIG_CHANGED', 'The original dataset configuration no longer matches its published version.', 409);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}

async function savePrivate(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}

async function smallBody(req) {
  if (req.headers['content-type'] !== 'application/json')
    throw fault('JSON_REQUIRED', 'Send an application/json request.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) { req.resume(); throw fault('REQUEST_TOO_LARGE', 'The request exceeds 16 KiB.', 413); }
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('INVALID_JSON', 'The request must contain valid JSON.'); }
}

function revisionFields(input) {
  if (!HASH.test(input.expectedSnapshot ?? '') || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    throw fault('REVIEW_REQUIRED', 'Refresh the displayed current version before this action.');
  return { expectedSnapshot: input.expectedSnapshot, expectedRevision: input.expectedRevision };
}

/** Attach to a running ORIGINAL versioned seller. This process owns only drafts;
 * it never opens a second version writer, edits state.json or touches payment. */
export async function startDatasetPublishingWorkspace({ directory, port = 8431,
  maxUploadBytes = 64 * 1024 * 1024, resource = null, seller = null } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    throw new TypeError('A normalized absolute dataset state directory is required');
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isSafeInteger(maxUploadBytes) ||
      maxUploadBytes < 1024 || maxUploadBytes > 256 * 1024 * 1024)
    throw new TypeError('Invalid workspace port or upload limit');
  if (resource !== null) {
    const url = new URL(resource);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== resource)
      throw new TypeError('Resource must be a canonical public HTTPS URL without query or credentials');
  }
  const buyerSource = seller === null ? null : datasetBuyerEndpoint(seller, resource);
  await privateDirectory(directory);
  let latest;
  const status = async () => {
    const next = await datasetControl(directory);
    if (!object(next) || !HASH.test(next.current ?? '') || !Number.isSafeInteger(next.revision) ||
        !Array.isArray(next.versions) || !next.versions.some(v => v.snapshot === next.current && HASH.test(v.configHash ?? '')))
      throw fault('INVALID_VERSION_STATUS', 'The original seller returned an unsupported version status.', 502);
    latest = next;
    return next;
  };
  await status();
  let draft = null, preview = null, running = null, closing = false, closePromise, origin;
  const token = randomBytes(32).toString('base64url');
  const expectedAuth = Buffer.from('Bearer ' + token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/workspace.js', 'workspace.js', 'text/javascript; charset=utf-8'],
    ['/workspace.css', 'workspace.css', 'text/css; charset=utf-8'],
  ].map(async ([route, file, type]) => [route, { bytes: await readFile(new URL('./workspace-ui/' + file, import.meta.url)), type }])));
  const working = await mkdtemp(join(directory, '.publisher-'));

  async function exclusive(operation) {
    if (closing || running) throw fault('WORKSPACE_BUSY', 'Another workspace action is still running. Wait for its result.', 409);
    running = Promise.resolve().then(operation);
    try { return await running; } finally { running = null; }
  }

  async function generation(snapshot, observed = latest) {
    const record = observed.versions.find(v => v.snapshot === snapshot);
    if (!HASH.test(snapshot ?? '') || !record || !HASH.test(record.configHash ?? ''))
      throw fault('VERSION_NOT_AVAILABLE', 'This version is no longer retained. Refresh the version list.', 410);
    const path = join(directory, 'versions', snapshot);
    await privateDirectory(path);
    const configPath = join(path, 'dataset.json');
    const config = await privateJson(configPath, record.configHash);
    if (config.file !== './data.csv')
      throw fault('UNSUPPORTED_GENERATION', 'This workspace requires the original immutable dataset generation layout.');
    return { config, configPath, record };
  }

  async function inspect(snapshot) {
    const source = await generation(snapshot);
    if (preview?.snapshot === snapshot) return preview.dataset;
    const dataset = await loadDatasetConfig(source.configPath);
    if (dataset.describe().snapshot !== snapshot)
      throw fault('VERSION_CONTENT_CHANGED', 'The dataset no longer matches the selected version.', 409);
    preview = { snapshot, dataset };
    return dataset;
  }

  async function upload(req) {
    const observed = await status(), source = await generation(observed.current, observed);
    const cap = Math.min(maxUploadBytes, source.config.maxBytes ?? 64 * 1024 * 1024);
    if (!/^text\/csv(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
      throw fault('CSV_REQUIRED', 'Choose a CSV file.', 415);
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > cap)) {
      req.resume(); throw fault('CSV_TOO_LARGE', `This dataset accepts at most ${cap} CSV bytes.`, 413);
    }
    const draftDir = join(working, randomUUID());
    await mkdir(draftDir, { mode: 0o700 });
    let adopted = false;
    try {
      const file = await open(join(draftDir, 'data.csv'), 'wx', 0o600), digest = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > cap) { req.resume(); throw fault('CSV_TOO_LARGE', `This dataset accepts at most ${cap} CSV bytes.`, 413); }
          digest.update(chunk);
          await file.writeFile(chunk);
        }
        if (!size) throw fault('EMPTY_CSV', 'Choose a CSV containing the declared header and data.');
        await file.sync();
      } finally { await file.close(); }
      const configPath = join(draftDir, 'dataset.json');
      await savePrivate(configPath, jsonBytes(source.config));
      let dataset;
      try { dataset = await loadDatasetConfig(configPath); }
      catch (error) {
        if (error.code) throw fault('CSV_VALIDATION_FAILED', 'The uploaded CSV could not be read with the published schema.', 422);
        throw fault('CSV_VALIDATION_FAILED', String(error.message).slice(0,320), 422);
      }
      const prior = draft;
      let filename;
      try { filename = decodeURIComponent(req.headers['x-upload-name'] ?? 'dataset.csv'); }
      catch { filename = 'dataset.csv'; }
      filename = filename.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, '').slice(0,160) || 'dataset.csv';
      draft = { id: randomUUID(), directory: draftDir, configPath, filename, dataset,
        csvHash: digest.digest('hex'), sourceBytes: size,
        expectedSnapshot: observed.current, expectedRevision: observed.revision };
      adopted = true;
      if (prior) await rm(prior.directory, { recursive: true, force: true });
      return { draft: publicDraft(draft), status: await status() };
    } finally { if (!adopted) await rm(draftDir, { recursive: true, force: true }); }
  }

  function selectedDraft(input) {
    if (!draft || input.id !== draft.id) throw fault('DRAFT_CHANGED', 'This draft is no longer current. Reload the workspace.', 409);
    return draft;
  }

  async function buyerSelection(input) {
    if (!buyerSource) throw fault('BUYER_SOURCE_REQUIRED', 'Start this workspace with --seller and --resource to prepare a buyer config.');
    if (!HASH.test(input.target ?? '') || typeof input.query !== 'string' || input.query.length > 8192)
      throw fault('BUYER_SELECTION_REQUIRED', 'Select a published version and run its query before preparing the buyer.');
    const observed = await status(), record = observed.versions.find(v => v.snapshot === input.target);
    if (!record || record.status === 'EXPIRED')
      throw fault('VERSION_NOT_AVAILABLE', 'This version is no longer available to new buyers. Select a current or retained version.', 410);
    const query = new URLSearchParams(input.query);
    if (query.has('cursor') || query.has('snapshot'))
      throw fault('BUYER_FIRST_PAGE_REQUIRED', 'Buyer acquisition starts at the first page of the selected version and query.');
    const schema = await datasetControl(directory, 'schema');
    if (!Array.isArray(schema.resources) || !schema.resources.some(route =>
      route.resource === buyerSource.resource && route.snapshotSelection === true))
      throw fault('SELLER_DATASET_OFFER_MISMATCH', 'This original dataset service must advertise the selected resource and snapshot selector.', 409);
    const selectedQuery = new URLSearchParams(query); selectedQuery.set('snapshot', input.target);
    // Use the original owner's private service preview: its actual generation,
    // admission, retention, request pin and parsed-cache budget remain authoritative.
    const response = await datasetControl(directory, 'preview', { query: selectedQuery.toString() });
    if (response.dataset?.snapshot !== input.target)
      throw fault('VERSION_CONTENT_CHANGED', 'The original service returned a different dataset snapshot.', 409);
    const review = await readDatasetBuyerOffer({ ...buyerSource, snapshot: input.target, query: query.toString() });
    const current = (await status()).versions.find(v => v.snapshot === input.target);
    if (!current || current.status === 'EXPIRED')
      throw fault('VERSION_NOT_AVAILABLE', 'This version expired while its offer was loaded. Select a current or retained version.', 410);
    return { review, selection: { snapshot: input.target, query: query.toString(),
      fields: response.fields, matchingRows: response.page.total,
      rowsPerPage: response.page.limit, expiresAt: current.expiresAt } };
  }

  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 60000,
    headersTimeout: 10000, keepAliveTimeout: 1000 }, (req, res) => {
    const reply = (code, body, type = 'application/json; charset=utf-8') => {
      const bytes = type.startsWith('application/json') ? Buffer.from(JSON.stringify(body)) : body;
      res.writeHead(code, { 'content-type': type, 'content-length': bytes.length,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      res.end(bytes);
    };
    const run = async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site')
        throw fault('LOCAL_ORIGIN_REQUIRED', 'Open the workspace on its original local address.', 403);
      const asset = assets.get(req.url);
      if (asset && req.method === 'GET') return reply(200, asset.bytes, asset.type);
      const auth = Buffer.from(req.headers.authorization ?? '');
      if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth))
        throw fault('SESSION_REQUIRED', 'Reopen the private session URL printed by the workspace command.', 401);
      if (req.method === 'GET' && req.url === '/api/status') {
        const observed = await status();
        return reply(200, { status: observed, draft: publicDraft(draft), resource,
          buyerSource, maxUploadBytes, busy: Boolean(running) });
      }
      if (req.method === 'PUT' && req.url === '/api/draft')
        return reply(200, await exclusive(() => upload(req)));
      if (req.method !== 'POST') throw fault('NOT_FOUND', 'Workspace action not found.', 404);
      const input = await smallBody(req);
      const result = await exclusive(async () => {
        if (req.url === '/api/buyer-offer' || req.url === '/api/buyer-prepare') {
          const preparing = req.url === '/api/buyer-prepare';
          if (!exact(input, preparing ? ['target','query','intentId','acceptIndex','offerSha256'] : ['target','query']))
            throw fault('BUYER_SELECTION_REQUIRED', 'Select the published query and an actual seller payment alternative.');
          const { review, selection } = await buyerSelection(input);
          return preparing ? { ...prepareDatasetBuyer(review, input), selection }
            : { ...review, selection };
        }
        if (req.url === '/api/preview') {
          if (!exact(input, ['target','query']) || typeof input.target !== 'string' || typeof input.query !== 'string' || input.query.length > 8192)
            throw fault('INVALID_PREVIEW', 'Select a draft or retained version and a query of at most 8192 characters.');
          await status();
          const isDraft = input.target.startsWith('draft:');
          const dataset = isDraft ? selectedDraft({ id: input.target.slice(6) }).dataset : await inspect(input.target);
          const query = new URLSearchParams(input.query), context = { query };
          const admitted = dataset.admit(context);
          const response = admitted === true ? dataset.handle(context) : admitted;
          if (response.status !== 200)
            throw fault(response.body?.error ?? 'QUERY_REJECTED', response.body?.message ?? 'The original dataset rejected this query.', response.status);
          return { mode: 'LOCAL_OPERATOR_PREVIEW', dataset: dataset.describe(),
            queryParameters: datasetQueryParameters(dataset.describe()), query: query.toString(),
            result: response.body, draftId: isDraft ? draft.id : null };
        }
        if (req.url === '/api/draft/review-current') {
          if (!exact(input, ['id'])) throw fault('INVALID_DRAFT_REVIEW', 'Select the current draft.');
          const selected = selectedDraft(input), observed = await status();
          // Refresh itself verifies the original full contract. The review keeps
          // the candidate unchanged and only records the displayed source revision.
          await generation(observed.current, observed);
          selected.expectedSnapshot = observed.current;
          selected.expectedRevision = observed.revision;
          return { draft: publicDraft(selected), status: observed };
        }
        if (req.url === '/api/publish') {
          if (!exact(input, ['id','expectedSnapshot','expectedRevision'])) throw fault('INVALID_PUBLICATION', 'Review the draft and current revision before publishing.');
          const selected = selectedDraft(input), expected = revisionFields(input);
          if (selected.expectedSnapshot !== expected.expectedSnapshot || selected.expectedRevision !== expected.expectedRevision)
            throw fault('DRAFT_REVIEW_CHANGED', 'The draft review changed. Inspect it again before publishing.', 409);
          const result = await datasetControl(directory, 'refresh', { configPath: selected.configPath, ...expected });
          if (result.current !== selected.dataset.describe().snapshot)
            throw fault('PUBLISHED_VERSION_DIFFERS', 'The seller returned a different current version. Inspect status before another publication.', 409);
          draft = null;
          await rm(selected.directory, { recursive: true, force: true });
          return { publication: result, status: await status(), draft: null };
        }
        if (req.url === '/api/draft/discard') {
          if (!exact(input, ['id'])) throw fault('INVALID_DRAFT', 'Select the current draft.');
          const selected = selectedDraft(input); draft = null;
          await rm(selected.directory, { recursive: true, force: true });
          return { draft: null, status: await status() };
        }
        if (req.url === '/api/activate') {
          if (!exact(input, ['snapshot','expectedSnapshot','expectedRevision']) || !HASH.test(input.snapshot ?? ''))
            throw fault('INVALID_ACTIVATION', 'Select a retained version and review the current revision.');
          const result = await datasetControl(directory, 'activate', { snapshot: input.snapshot, ...revisionFields(input) });
          return { activation: result, status: await status(), draft: publicDraft(draft) };
        }
        if (req.url === '/api/collect') {
          if (!exact(input, [])) throw fault('INVALID_COLLECTION', 'Collection takes no additional parameters.');
          preview = null;
          const result = await datasetControl(directory, 'collect', {});
          return { collection: result, status: await status(), draft: publicDraft(draft) };
        }
        throw fault('NOT_FOUND', 'Workspace action not found.', 404);
      });
      reply(200, result);
    };
    run().catch(error => {
      if (res.headersSent || res.destroyed) return;
      const known = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code) && Number.isInteger(error.status);
      reply(known && error.status >= 400 && error.status <= 599 ? error.status : 503,
        { error: known ? error.code : 'WORKSPACE_ACTION_FAILED', message: known ? error.message :
          'The action could not complete. Keep the draft, check the original seller, and refresh status before retrying.' });
    });
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try {
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); });
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  } catch (error) { await rm(working, { recursive: true, force: true }); throw error; }
  return { origin, url: `${origin}/#${token}`, token, server,
    close() {
      if (!closePromise) closePromise = (async () => {
        closing = true;
        await new Promise((done, fail) => {
          server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.();
        });
        if (running) await running.catch(() => {});
        preview = null; draft = null;
        await rm(working, { recursive: true, force: true });
      })();
      return closePromise;
    } };
}

const HELP = `Dataset publishing workspace (Node 22+)
  node workspace.mjs --state DIR [--port 8431] [--max-upload-bytes 67108864]
                    [--resource https://merchant.example/data]
                    [--seller http://127.0.0.1:8430]

Attach to the running original versioned seller. Open the private local session
URL, upload/review a CSV, then explicitly publish or activate a retained version.
Ctrl+C closes this workspace and removes its unpublished session drafts. The
original seller and its published generations keep running.`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--state','--port','--max-upload-bytes','--resource','--seller'].includes(args[i]) ||
        Object.hasOwn(options,args[i]) || !args[i+1] || args[i+1].startsWith('--'))
      throw new TypeError('Invalid options; use --help');
    options[args[i]] = args[i+1];
  }
  if (!options['--state']) throw new TypeError('--state is required');
  for (const name of ['--port','--max-upload-bytes'])
    if (options[name] !== undefined && !/^(0|[1-9][0-9]*)$/.test(options[name])) throw new TypeError('Invalid '+name);
  const app = await startDatasetPublishingWorkspace({ directory: resolve(options['--state']),
    port: options['--port'] === undefined ? 8431 : Number(options['--port']),
    maxUploadBytes: options['--max-upload-bytes'] === undefined ? undefined : Number(options['--max-upload-bytes']),
    resource: options['--resource'] ?? null, seller: options['--seller'] ?? null });
  console.log(`Dataset publishing workspace\n${app.url}\nKeep this session URL private. Ctrl+C closes unpublished drafts.`);
  const stop = () => app.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`Dataset publishing: ${error.message}`); process.exitCode = 1; });
