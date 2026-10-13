// MIT. Operate the source-owned Applications and MCP interfaces on one existing customer case.
import { mkdir, mkdtemp, readFile, writeFile, open, stat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    child.once('exit', done);
    child.kill('SIGTERM');
    timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
  });
}

/**
 * Continue an actual completed operator case. Every write uses its existing SQLite workspace.
 * The case-result.json identifies the original source, saved workshare and merchant publication.
 */
export async function operateCanadaBuysTools({ sourceDirectory, caseDirectory, outputDirectory } = {}) {
  sourceDirectory = resolve(sourceDirectory);
  caseDirectory = resolve(caseDirectory);
  const original = JSON.parse(await readFile(join(caseDirectory, 'case-result.json'), 'utf8'));
  need(original.status === 'complete', 'Continue the completed original operator case.');
  const operator = original.operator || original.browser;
  need(operator?.status === 'completed' && operator.saved?.workshare, 'Retain the completed browser or HTTP operator journey.');
  const workspaceDirectory = join(caseDirectory, 'operator-workspace');
  const receivingDirectory = join(caseDirectory, 'receiving-workspace');
  for (const directory of [workspaceDirectory, receivingDirectory]) {
    const db = await stat(join(directory, 'workspace.sqlite'));
    need(db.isFile() && db.size > 0, 'The original saved customer database is required.');
  }
  const parent = resolve(outputDirectory || join(caseDirectory, 'tool-journey'));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'operating-'));
  const result = { operation: original.operation, operatorInterface: operator.interface || 'browser', status: 'running', startedAt: new Date().toISOString(), directory, stages: [] };
  const save = async () => { await writeFile(join(directory, 'result.json'), json(result), { mode: 0o600 }); };
  const moduleAt = path => import(pathToFileURL(join(sourceDirectory, path)));
  const prefix = 'stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/';
  const mcpPrefix = 'stellar-forge/mcp-merchant-operator/';
  const savedWorkshare = operator.saved.workshare;
  const noticeId = savedWorkshare.noticeId;
  const originalWorkspace = original.stages.find(stage => stage.stage === 'cold-reopen').operator;
  let owner, child;
  try {
    result.stage = 'applications-provider';
    const distribution = JSON.parse(await readFile(join(sourceDirectory, 'stellar/scf-starforge-20261009/distribution/contributions/canadabuys.json'), 'utf8'));
    const providerContribution = JSON.parse(await readFile(join(sourceDirectory, 'stellar/scf-starforge-20261009/distribution/contributions/merchant-provider-canadabuys-workspaces.json'), 'utf8'));
    const applicationModule = await moduleAt(distribution.applicationProviders.canadabuys);
    const application = applicationModule.default;
    const startupReader = applicationModule.readCanadaBuysStartup;
    const sharedApplication = await moduleAt('stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs');
    const types = application.catalog({ common: sharedApplication.applicationCommonFields });
    const type = types.find(item => item.id === 'canadabuys');
    need(type && type.command === 'canadabuys' && type.terminal === false, 'The registered procurement application changed.');
    const prepared = await sharedApplication.prepareProviderApplication(application, type,
      { workspaceDirectory, operator: 'TJLabs tool continuation', port: 0 }, {
        async inputPath(path, kind, missing, privateOnly) {
          const absolute = resolve(path), info = await stat(absolute);
          need(await realpath(absolute) === absolute, 'The application input must keep its canonical path.');
          need(kind === 'directory' ? info.isDirectory() : info.isFile(), 'The application input kind differs.');
          if (privateOnly) need((info.mode & 0o077) === 0, 'The original application workspace is private.');
          return { path: absolute, kind, exists: true };
        },
        async applicationEnvironment(file) { need(file === undefined, 'This original case uses the current process environment.'); return {}; }
      });
    const request = { ...prepared, applicationId: originalWorkspace.id };
    const observer = application.createObserver(request, directory, {});
    const cli = join(sourceDirectory, distribution.commands.canadabuys);
    const stdout = [], stderr = [];
    child = spawn(process.execPath, [cli, ...prepared.args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const announced = await new Promise((resolve, reject) => {
      let buffer = '', settled = false;
      const timer = setTimeout(() => finish(new Error('The original application did not announce its workspace within 30 seconds.')), 30000);
      function finish(error, value) {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      }
      child.on('error', error => finish(error));
      child.on('exit', (code, signal) => finish(new Error('The application exited before startup: ' + code + '/' + signal)));
      child.stderr.on('data', bytes => { if (stderr.reduce((n, part) => n + part.length, 0) < 65536) stderr.push(bytes); });
      child.stdout.on('data', bytes => {
        observer.write(bytes); stdout.push(bytes); buffer += bytes.toString('utf8');
        const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        for (const line of lines) {
          try {
            const found = application.matchRequest(request) ? startupReader(request, line, { pid: child.pid }) : null;
            if (found) finish(null, found);
          } catch (error) { finish(error); }
        }
      });
    });
    await observer.close();
    const health = await fetch(new URL('/health', announced.url), { signal: AbortSignal.timeout(15000) });
    need(health.status === 200, 'The original Applications URL did not serve its workspace.');
    const healthBody = await health.json();
    need(healthBody.workspace.id === originalWorkspace.id, 'Applications opened a different customer workspace.');
    await writeFile(join(directory, 'application-stdout.log'), Buffer.concat(stdout), { mode: 0o600 });
    await writeFile(join(directory, 'application-stderr.log'), Buffer.concat(stderr), { mode: 0o600 });
    result.application = { id: type.id, command: request.command, args: request.args, resourceKey: prepared.resourceKey, startup: announced, health: healthBody };
    await stop(child); child = null;
    result.stages.push({ stage: result.stage, workspaceId: originalWorkspace.id });
    await save();

    result.stage = 'original-mcp-provider';
    const provider = (await moduleAt(providerContribution.merchantProviders['canadabuys-workspaces'])).default;
    const toolCatalog = provider.tools((name, description, properties, required, annotations) =>
      ({ name, description, inputSchema: { type: 'object', properties, required }, annotations }));
    need(toolCatalog.length === 37 && new Set(toolCatalog.map(tool => tool.name)).size === 37,
      'The registered native tool catalog changed.');
    const exportsDirectory = join(directory, 'exports');
    await mkdir(exportsDirectory, { mode: 0o700 });
    const connectionPath = join(directory, 'canadabuys-connection.json');
    const connection = { schema: 'starforge.canadabuys.workspace-connection.v1', workspaces: {
      original: { directory: workspaceDirectory, label: 'Original CanadaBuys customer case', operator: 'TJLabs tool continuation', inputs: {}, deliveries: {} }
    } };
    await writeFile(connectionPath, json(connection), { mode: 0o600 });
    const configuration = await provider.configuration.read(connectionPath, { hostPath: path => path });
    owner = provider.create(await provider.load(), { canadabuysWorkspaces: configuration, exportsDirectory });
    const call = (name, input = {}) => owner.call('merchant_canadabuys_' + name, { workspace: 'original', ...input });
    const opened = await call('open');
    need(opened.native.id === originalWorkspace.id, 'MCP opened another customer workspace.');
    const ids = new Set();
    let offset = 0, pageCount = 0;
    do {
      const page = await call('status', { collection: 'notices', offset, limit: 500 });
      for (const notice of page.items) { need(!ids.has(notice.id), 'A notice repeated across collection pages.'); ids.add(notice.id); }
      offset = page.page.nextOffset; pageCount++;
    } while (offset !== null);
    need(ids.size === original.source.records, 'The complete original notice collection changed.');
    const notice = (await call('notice', { noticeId })).notice;
    const workshare = (await call('workshare', { workshareId: savedWorkshare.id })).workshare;
    need(notice.currentEntry.sourceId === original.source.sourceId, 'MCP changed the original notice source.');
    need(workshare.id === savedWorkshare.id && workshare.feeCents === savedWorkshare.feeCents,
      'MCP changed the saved customer workshare.');
    result.provider = { id: provider.id, family: provider.family, toolCount: toolCatalog.length,
      noticePages: pageCount, notices: ids.size, workspace: opened.native, workshare: savedWorkshare };
    result.stages.push({ stage: result.stage, notices: ids.size, toolCount: toolCatalog.length });
    await save();

    result.stage = 'full-original-source-chunks';
    const current = await call('status', { collection: 'sources', limit: 500 });
    const exported = await call('export', { expectedRevision: current.native.revision, format: 'source', sourceId: original.source.sourceId });
    const files = (await call('files', { publicationId: exported.publication.id })).files;
    const sourceFile = files.find(file => file.sha256 === original.source.sha256);
    need(sourceFile && sourceFile.bytes === original.source.bytes, 'The original source export changed.');
    const { MAX_RETAINED_CHUNK_BYTES } = await moduleAt(mcpPrefix + 'retained-file-contracts.mjs');
    const output = await open(join(directory, 'original-source-via-tools.csv'), 'wx', 0o600);
    const hash = createHash('sha256'); let position = 0, readId, chunks = 0;
    try {
      do {
        const chunk = await call('file_read', { publicationId: exported.publication.id, file: sourceFile.file,
          expectedSha256: sourceFile.sha256, offset: position, limit: MAX_RETAINED_CHUNK_BYTES, ...(readId ? { readId } : {}) });
        need(chunk.encoding === 'base64' && chunk.offset === position && chunk.file.sha256 === sourceFile.sha256,
          'The retained file reader changed the source selection.');
        const bytes = Buffer.from(chunk.data, 'base64');
        need(bytes.toString('base64') === chunk.data && bytes.length === chunk.bytesRead, 'The original chunk encoding changed.');
        if (readId) need(chunk.readId === readId, 'The original read session changed.');
        readId = chunk.readId;
        let written = 0;
        while (written < bytes.length) {
          const count = await output.write(bytes, written, bytes.length - written, position + written);
          need(count.bytesWritten > 0, 'The original source download could not be retained.');
          written += count.bytesWritten;
        }
        hash.update(bytes); position += bytes.length; chunks++;
        need(chunk.nextOffset === (position < sourceFile.bytes ? position : null), 'The next original byte offset changed.');
      } while (position < sourceFile.bytes);
      await output.sync();
    } finally { await output.close(); if (readId) await call('file_release', { readId }); }
    const downloadedSha256 = hash.digest('hex');
    need(position === original.source.bytes && downloadedSha256 === original.source.sha256,
      'The complete tool download differs from the original federal capture.');
    result.sourceDownload = { publicationId: exported.publication.id, chunks, bytes: position, sha256: downloadedSha256, readId };
    result.stages.push({ stage: result.stage, chunks, bytes: position });
    await save();

    result.stage = 'complete-original-merchant-payload';
    const publication = original.merchant.prepared.publication;
    const payloadFile = join(directory, 'original-merchant-package.json');
    const payloadHandle = await open(payloadFile, 'wx', 0o600), payloadHash = createHash('sha256');
    const query = { where_notice_id: noticeId, limit: '20', sort: 'part_index' };
    let cursor = null, count = 0, pages = 0, payloadBytes = 0, identity = null, snapshot = null;
    try {
      do {
        const response = await call('merchant_preview', { publicationId: publication.id, query: { ...query, ...(cursor ? { cursor } : {}) } });
        need(response.result.status === 200 && response.result.body.schema === 'stellar-forge.dataset-page.v1', 'The original dataset page changed.');
        const body = response.result.body;
        if (snapshot) need(response.snapshot === snapshot, 'The source dataset snapshot changed during transfer.');
        snapshot = response.snapshot;
        for (const row of body.rows) {
          need(Number.isSafeInteger(row.part_index) && row.part_index === count && Number.isSafeInteger(row.part_count),
            'An original merchant payload part is missing or out of order.');
          const rowIdentity = { packageId: row.package_id, sha256: row.payload_sha256, bytes: row.payload_bytes, parts: row.part_count };
          if (!identity) identity = rowIdentity;
          need(JSON.stringify(identity) === JSON.stringify(rowIdentity), 'The payload identity changed across pages.');
          const part = Buffer.from(row.payload_base64, 'base64');
          need(part.toString('base64') === row.payload_base64 && digest(part) === row.part_sha256, 'An original merchant part changed.');
          let written = 0;
          while (written < part.length) {
            const done = await payloadHandle.write(part, written, part.length - written, payloadBytes + written);
            need(done.bytesWritten > 0, 'The original merchant payload could not be retained.'); written += done.bytesWritten;
          }
          payloadHash.update(part); payloadBytes += part.length; count++;
        }
        cursor = body.page.nextCursor; pages++;
        need(identity && body.page.total === identity.parts, 'The complete native dataset row count changed.');
      } while (cursor !== null);
      await payloadHandle.sync();
    } finally { await payloadHandle.close(); }
    need(identity && count === identity.parts && payloadBytes === identity.bytes && payloadHash.digest('hex') === identity.sha256,
      'The complete original merchant payload changed.');
    const pkg = JSON.parse(await readFile(payloadFile, 'utf8'));
    const { canonical } = await moduleAt(prefix + 'workspace.mjs');
    const { packageId, ...body } = pkg;
    need(packageId === identity.packageId && digest(canonical(body)) === packageId, 'The original workspace package digest changed.');
    const transportedSource = pkg.sources.find(source => source.id === original.source.sourceId);
    need(transportedSource && digest(Buffer.from(transportedSource.rawText, 'utf8')) === original.source.sha256,
      'The merchant transport changed the original federal source.');
    const transportedWorkshare = pkg.workshares.find(record => record.id === savedWorkshare.id);
    need(transportedWorkshare && transportedWorkshare.feeCents === savedWorkshare.feeCents,
      'The merchant transport omitted or changed the saved partner workshare.');
    result.merchant = { publicationId: publication.id, snapshot, pages, parts: count, bytes: payloadBytes,
      packageId, sha256: identity.sha256, sourceSha256: original.source.sha256, workshareId: savedWorkshare.id };
    result.stages.push({ stage: result.stage, pages, parts: count, bytes: payloadBytes });
    result.closing = await call('close', { instanceId: opened.instanceId });
    await owner.close(); owner = null;
    result.status = 'completed'; result.stage = 'complete'; result.completedAt = new Date().toISOString();
    await save();
    return result;
  } catch (error) {
    result.status = 'failed'; result.failedAt = new Date().toISOString();
    result.error = { name: error.name, code: error.code, message: error.message, stack: error.stack };
    await save(); error.operatorToolsDirectory = directory; throw error;
  } finally {
    await stop(child);
    if (owner) await owner.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'source-root': { type: 'string' }, 'case-root': { type: 'string' }, output: { type: 'string' } } });
  operateCanadaBuysTools({ sourceDirectory: values['source-root'], caseDirectory: values['case-root'], outputDirectory: values.output })
    .then(result => process.stdout.write(json({ status: result.status, directory: result.directory, stages: result.stages })))
    .catch(error => { process.stderr.write(json({ error: error.message, code: error.code, directory: error.operatorToolsDirectory })); process.exitCode = 1; });
}
