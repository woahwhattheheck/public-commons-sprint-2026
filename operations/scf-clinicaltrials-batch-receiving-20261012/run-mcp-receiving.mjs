// Complete read-only MCP receiving of an existing ClinicalTrials disclosure batch.
// The original Python console remains the sole workspace owner.
import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, open, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
});
async function save(path, value) {
  const temporary = path + '.next-' + randomUUID(), handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
}
async function jsonResponse(url, { token, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream',
      ...(origin ? { Origin: origin } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': String(encoded.length),
        'MCP-Protocol-Version': '2025-11-25' } : {}) };
    const request = httpRequest(url, { method: encoded ? 'POST' : 'GET', headers, agent: false }, response => {
      (async () => {
        requireValue(response.statusCode === 200, 'Original HTTP read returned ' + response.statusCode);
        const chunks = []; let count = 0;
        for await (const chunk of response) {
          count += chunk.length;
          requireValue(count <= 16 * 1024 * 1024, 'Original complete JSON exceeds its native response bound.');
          chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks, count).toString('utf8'));
      })().then(resolve, reject).finally(() => request.destroy());
    });
    request.once('error', reject);
    request.setTimeout(240000, () => request.destroy(new Error('Original console response timed out.')));
    request.end(encoded);
  });
}
function identity(state) {
  const keys = ['applicationSchema','revision','sources','plans','builds','comparisons','source','plan','build',
    'capture','captures','reviews','prs','prsPlans','prsPreviews','prsReconciliations',
    'batches','batchExports','lastQuery'];
  return Object.fromEntries(keys.map(key => [key, state[key] ?? null]));
}

export async function runClinicalTrialsBatchMcpJourney({
  sourceRoot, consoleUrl, outputDirectory, batchId, exportId,
  workspaceAlias = 'disclosure', expectedEntries, expectedRevision,
  sourceManifest = fileURLToPath(new URL('./source-manifest.json', import.meta.url))
} = {}) {
  requireValue(typeof sourceRoot === 'string' && typeof outputDirectory === 'string', 'Select the existing source and receiving directories.');
  requireValue(typeof batchId === 'string' && batchId && typeof exportId === 'string' && exportId,
    'Select the existing reviewed batch ID and its complete saved native export ID.');
  sourceRoot = resolve(sourceRoot); outputDirectory = resolve(outputDirectory);
  const url = new URL(consoleUrl);
  requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && /^#[A-Za-z0-9_-]{32,256}$/.test(url.hash),
    'Use the original loopback ClinicalTrials console URL and capability.');
  const secret = url.hash.slice(1);
  const originalState = () => jsonResponse(new URL('/api/state', url).href, { token: secret, origin: url.origin });
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const reportPath = join(outputDirectory, 'journey.json');
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (report) requireValue(report.batchId === batchId && report.nativeExportId === exportId,
    'Resume this receiving directory only with its original batch and export.');
  report ??= { schema: 'stellar-forge.clinicaltrials-batch-mcp-receiving.v1',
    batchId, nativeExportId: exportId, startedAt: new Date().toISOString(), downloads: [], entries: [] };
  const checkpoint = async phase => {
    report.phase = phase; report.updatedAt = new Date().toISOString(); await save(reportPath, report);
  };
  let owned, failure;
  try {
    const declared = typeof sourceManifest === 'string'
      ? JSON.parse(await readFile(sourceManifest, 'utf8')) : sourceManifest;
    requireValue(declared?.schema === 'stellar-forge.clinicaltrials-batch-mcp-source.v1',
      'Use the complete declared native source closure.');
    report.source = { commit: declared.sourceCommit, files: [] };
    for (const file of declared.files) {
      const bytes = await readFile(join(sourceRoot, file.path));
      requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256,
        'Original native source differs from its selected complete closure: ' + file.path);
      const blob = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
      requireValue(blob === file.gitBlob, 'Original source Git identity differs: ' + file.path);
      report.source.files.push({ path: file.path, bytes: bytes.length, sha256: file.sha256, gitBlob: blob });
    }
    const original = await originalState();
    requireValue(original.applicationSchema === 'stellar-forge.clinicaltrials-workspace.v1',
      'The borrowed listener is not the original ClinicalTrials console.');
    if (expectedRevision !== undefined) requireValue(original.revision === expectedRevision, 'The reviewed workspace revision changed.');
    const before = identity(original), beforeSha = digest(canonical(before));
    if (report.original) requireValue(report.original.identitySha256 === beforeSha,
      'The original source or reviewed batch changed since this receiving operation.');
    report.original = { revision: original.revision, identitySha256: beforeSha,
      captureId: original.capture?.id ?? null, reviews: (original.reviews ?? []).map(row => row.id),
      batchIds: (original.batches ?? []).map(row => row.id), nativeExportId: exportId };
    delete report.error; report.status = 'RUNNING';
    await checkpoint('ORIGINAL_BATCH_SOURCE_BOUND');

    const moduleRoot = join(sourceRoot, 'stellar-forge/mcp-merchant-operator');
    const { MerchantClinicalTrialsWorkspaces, clinicalTrialsWorkspaceTools, readClinicalTrialsWorkspaceConfiguration } =
      await import(pathToFileURL(join(moduleRoot, 'clinicaltrials-workspace.mjs')));
    const { openClinicalTrialsClient, downloadClinicalTrialsExport, reopenClinicalTrialsExport } =
      await import(pathToFileURL(join(moduleRoot, 'clinicaltrials-client.mjs')));
    const { createMcpToolHandler } =
      await import(pathToFileURL(join(sourceRoot, 'stellar-forge/mcp-paid-agent/http-tools.mjs')));
    const definition = (name, description, properties = {}, required = [], hints = {}) => ({
      name, description, annotations: { readOnlyHint: hints.readOnly ?? false,
        idempotentHint: hints.idempotent ?? false, destructiveHint: hints.destructive ?? false,
        openWorldHint: hints.openWorld ?? false },
      inputSchema: { type: 'object', properties, required, additionalProperties: false }
    });
    const tools = clinicalTrialsWorkspaceTools(definition);
    const actualNames = tools.map(tool => tool.name).sort();
    requireValue(new Set(actualNames).size === actualNames.length &&
      canonical(actualNames) === canonical([...declared.toolNames].sort()),
      'The actual source-owned ClinicalTrials tool names differ from the complete batch catalog.');
    const consoleFile = join(outputDirectory, 'clinical-console.url');
    await writeFile(consoleFile, consoleUrl + '\n', { mode: 0o600 });
    const connectionFile = join(outputDirectory, 'connection.json');
    await save(connectionFile, { schema: 'stellar-forge.clinicaltrials-workspace-connection.v1', workspaces: {
      [workspaceAlias]: { label: 'Original disclosure batch receiving', consoleUrlFile: consoleFile, files: {} }
    } });
    const exportsDirectory = join(outputDirectory, 'mcp-exports');
    await mkdir(exportsDirectory, { recursive: true, mode: 0o700 });
    const config = { clinicalTrialsWorkspaces: await readClinicalTrialsWorkspaceConfiguration(connectionFile), exportsDirectory };
    const environment = { CLINICAL_BATCH_MCP_TOKEN: randomBytes(32).toString('base64url') };
    async function attach() {
      const adapter = new MerchantClinicalTrialsWorkspaces(config);
      let server, closed;
      try {
        server = createServer(createMcpToolHandler({ tools, call: adapter.call.bind(adapter) }, {
          bearerToken: environment.CLINICAL_BATCH_MCP_TOKEN,
          serverName: 'starforge-clinicaltrials-batch-receiving', serverVersion: '0.1.0',
          instructions: 'Read the selected original reviewed disclosure batch and receive its declared complete files.'
        }));
        await new Promise((resolve, reject) => {
          server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
        const endpoint = 'http://127.0.0.1:' + server.address().port + '/mcp';
        const client = await openClinicalTrialsClient({ url: endpoint, tokenEnv: 'CLINICAL_BATCH_MCP_TOKEN', environment });
        return { adapter, server, client, endpoint, close() {
          closed ??= (async () => {
            await adapter.close();
            const done = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            server.closeIdleConnections?.(); await done;
          })(); return closed;
        } };
      } catch (error) {
        await adapter.close().catch(() => {});
        if (server?.listening) {
          const done = new Promise(resolve => server.close(resolve)); server.closeIdleConnections?.(); await done;
        }
        throw error;
      }
    }
    owned = await attach();
    const catalog = await jsonResponse(owned.endpoint, { token: environment.CLINICAL_BATCH_MCP_TOKEN,
      body: { jsonrpc: '2.0', id: 'batch-catalog', method: 'tools/list', params: {} } });
    const advertised = catalog.result?.tools?.map(tool => tool.name).sort();
    requireValue(Array.isArray(advertised) && canonical(advertised) === canonical(actualNames),
      'The authenticated MCP listener did not advertise its complete original catalog.');
    report.toolNames = advertised; report.toolCount = advertised.length;
    async function inventory(kind) {
      const items = []; let offset = 0, snapshot;
      do {
        const result = (await owned.client.inventory({ workspace: workspaceAlias, kind, offset, limit: 50,
          ...(snapshot ? { expectedSnapshot: snapshot } : {}) })).native;
        snapshot ??= result.snapshot;
        requireValue(result.snapshot === snapshot && result.revision === original.revision, 'Original inventory changed while receiving.');
        items.push(...result.items); offset = result.nextOffset;
      } while (offset !== null);
      return items;
    }
    const batches = await inventory('batches'), exports = await inventory('batchExports');
    requireValue(batches.some(value => value.id === batchId), 'The original selected batch is not retained in this workspace.');
    const exported = exports.find(value => value.id === exportId);
    requireValue(exported?.batchId === batchId && Array.isArray(exported.files) && exported.files.length,
      'Select the complete original native export for this batch.');
    const batch = (await owned.client.batch({ workspace: workspaceAlias, batchId })).native;
    requireValue(batch.id === batchId && Array.isArray(batch.entries), 'The original batch read changed its identity.');
    if (expectedEntries !== undefined) requireValue(batch.entries.length === expectedEntries, 'The reviewed entry count changed.');
    report.batchSha256 = digest(canonical(batch));
    report.batchSummary = batch.summary;
    report.nativeFiles = exported.files;
    await save(join(outputDirectory, 'original-batch.json'), batch);
    await save(join(outputDirectory, 'original-batch-export.json'), exported);
    report.entries = [];
    for (const entry of batch.entries) {
      const originalEntry = (await owned.client.batchEntry({ workspace: workspaceAlias, batchId, entryId: entry.id })).native;
      requireValue(originalEntry.batchId === batchId && originalEntry.entry.id === entry.id &&
        originalEntry.entry.documentId === entry.documentId && canonical(originalEntry.entry) === canonical(entry),
        'Original batch entry context changed during receiving.');
      await save(join(outputDirectory, 'entry-' + String(report.entries.length).padStart(4, '0') + '.json'), originalEntry);
      report.entries.push({ id: entry.id, inputDocumentId: entry.inputDocumentId, documentId: entry.documentId,
        previewId: entry.previewId ?? null, planId: entry.planId ?? null, reconciliationId: entry.reconciliationId ?? null,
        review: entry.review ?? null, findings: entry.findings?.length ?? 0, sourceLinks: entry.sourceLinks ?? [],
        originalContextSha256: digest(canonical(originalEntry)) });
    }
    await checkpoint('ORIGINAL_REVIEWED_BATCH_INSPECTED');

    const receivingRoot = join(outputDirectory, 'received');
    await mkdir(receivingRoot, { recursive: true, mode: 0o700 });
    for (let index = 0; index < exported.files.length; index++) {
      const file = exported.files[index];
      let saved = report.downloads.find(value => value.nativeName === file.name);
      if (!saved) {
        const prepared = await owned.client.filePrepare({ workspace: workspaceAlias, kind: 'batch',
          exportId, file: file.name, expectedSha256: file.sha256, expectedRevision: original.revision });
        requireValue(prepared.manifest.files.length === 1 &&
          prepared.manifest.files[0].sha256 === file.sha256 && prepared.manifest.files[0].bytes === file.bytes,
          'MCP preparation changed the original native file.');
        saved = { nativeName: file.name, nativeSha256: file.sha256, nativeBytes: file.bytes,
          exportId: prepared.exportId, manifestSha256: prepared.manifestSha256,
          directory: join(receivingRoot, 'file-' + String(index).padStart(4, '0')) };
        report.downloads.push(saved); await checkpoint('DECLARED_BATCH_FILE_' + index);
      }
      requireValue(saved.nativeSha256 === file.sha256 && saved.nativeBytes === file.bytes,
        'Original batch file differs from the saved receiving operation.');
      const received = await downloadClinicalTrialsExport({ url: owned.endpoint, tokenEnv: 'CLINICAL_BATCH_MCP_TOKEN',
        environment, exportId: saved.exportId, expectedManifestSha256: saved.manifestSha256, directory: saved.directory });
      requireValue(received.state === 'COMPLETE' && received.bytes === file.bytes, 'Complete original file receiving did not finish.');
      const manifest = JSON.parse(await readFile(join(saved.directory, 'clinicaltrials-export.json'), 'utf8'));
      const filePath = join(saved.directory, manifest.files[0].name), bytes = await readFile(filePath);
      requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256, 'Received bytes differ from the saved native export.');
      saved.path = filePath; saved.completed = true;
      await checkpoint('COMPLETE_BATCH_FILE_' + index);
    }
    await owned.close(); owned = null;
    for (const saved of report.downloads) {
      const reopened = await reopenClinicalTrialsExport({ directory: saved.directory, exportId: saved.exportId,
        expectedManifestSha256: saved.manifestSha256 });
      requireValue(reopened.state === 'REOPENED' && reopened.bytes === saved.nativeBytes,
        'The original downloaded batch file did not reopen with identical bytes.');
      saved.reopened = true;
    }
    const closedState = await originalState();
    requireValue(digest(canonical(identity(closedState))) === beforeSha,
      'Closing the MCP borrower changed the original reviewed workspace.');
    owned = await attach();
    const reopenedBatch = (await owned.client.batch({ workspace: workspaceAlias, batchId })).native;
    requireValue(digest(canonical(reopenedBatch)) === report.batchSha256,
      'Reattaching the MCP borrower changed the original batch or its reviews.');
    const reopenedExports = (await owned.client.inventory({ workspace: workspaceAlias, kind: 'batchExports', offset: 0, limit: 250 })).native;
    requireValue(reopenedExports.items.some(value => value.id === exportId), 'Reattached console lost the original batch export.');
    await owned.close(); owned = null;
    const final = await originalState();
    requireValue(digest(canonical(identity(final))) === beforeSha, 'The original workspace changed after the complete receiving operation.');
    report.ownerAvailable = true; report.ownerRevision = final.revision; report.closed = true;
    report.receivedFiles = report.downloads.length;
    report.receivedBytes = report.downloads.reduce((sum, item) => sum + item.nativeBytes, 0);
    report.finishedAt = new Date().toISOString(); report.status = 'PASS'; report.passed = true;
    await checkpoint('COMPLETE_ORIGINAL_BATCH_MCP_RECEIVING');
    return report;
  } catch (error) {
    failure = error; report.status = 'FAILED'; report.passed = false;
    report.error = { code: error.code ?? null, message: String(error.message ?? error).split(secret).join('[private capability]') };
    await checkpoint('ORIGINAL_BATCH_RECEIVING_RETAINED').catch(() => {});
    throw error;
  } finally {
    try { await owned?.close(); }
    catch (error) {
      if (!failure) throw error;
      report.closeError = String(error.message ?? error).split(secret).join('[private capability]');
      await save(reportPath, report).catch(() => {});
    }
  }
}
