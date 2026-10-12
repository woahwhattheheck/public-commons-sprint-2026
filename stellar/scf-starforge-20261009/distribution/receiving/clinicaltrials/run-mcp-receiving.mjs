// Original ClinicalTrials console -> native MCP -> complete customer receiving.
// This operating continuation borrows an existing Python listener and keeps its owner alive.
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
async function save(path, value) {
  const temporary = path + '.next-' + randomUUID(), handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
}
async function copyTree(from, to) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const a = join(from, entry.name), b = join(to, entry.name);
    if (entry.isDirectory()) { await mkdir(b, { recursive: true, mode: 0o700 }); await copyTree(a, b); }
    else if (entry.isFile()) { await mkdir(dirname(b), { recursive: true, mode: 0o700 }); await writeFile(b, await readFile(a), { mode: 0o600 }); }
    else fail('The selected source closure contains an unexpected link: ' + a);
  }
}

export async function runClinicalTrialsMcpJourney({
  sourceRoot, consoleUrl, outputDirectory,
  overlayDirectory = '/dev/shm/1fb3-clinicaltrials-mcp/overlay',
  dependencyDirectory = '/dev/shm/1fb3-clinicaltrials-mcp/native-dependencies',
  installOverlay = true, workspaceAlias = 'portfolio', captureId,
  expectedStudies = 165, reviewedBy = '1FB3 internal customer receiving',
  portableReopen = false, resumeJournal
} = {}) {
  sourceRoot = resolve(sourceRoot); outputDirectory = resolve(outputDirectory);
  const url = new URL(consoleUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^#[A-Za-z0-9_-]{32,256}$/.test(url.hash))
    fail('Supply the exact existing private ClinicalTrials console URL.');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const reportPath = join(outputDirectory, 'journey.json');
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!report && resumeJournal !== undefined) report = structuredClone(resumeJournal);
  if (portableReopen && report?.continuation?.kind !== 'PORTABLE_RECEIVER') {
    if (report?.schema !== 'stellar-forge.clinicaltrials-mcp-native-journey.v1' ||
        !report.original?.captureId || !report.review?.id || !report.nativeExport?.id)
      fail('Continue a portable receiver with its exact saved native capture, review and export journal.');
    const previous = structuredClone(report);
    await save(join(outputDirectory, 'previous-owner-journey.json'), previous);
    report = { schema: previous.schema, startedAt: new Date().toISOString(), steps: {}, requests: {}, downloads: [],
      continuation: { kind: 'PORTABLE_RECEIVER', previousCapture: previous.original, previousReview: previous.review,
        previousExport: { id: previous.nativeExport.id, snapshot: previous.nativeExport.snapshot,
          rowCount: previous.nativeExport.rowCount, captureId: previous.nativeExport.captureId },
        previousRequestIds: Object.fromEntries(Object.entries(previous.requests ?? {}).map(([key,value]) => [key,value.requestId])),
        originalJournal: 'previous-owner-journey.json' } };
  }
  if (report?.status === 'PASS') return report;
  report ??= { schema: 'stellar-forge.clinicaltrials-mcp-native-journey.v1',
    startedAt: new Date().toISOString(), steps: {}, requests: {}, downloads: [] };
  delete report.error;
  const checkpoint = async phase => { report.phase = phase; report.updatedAt = new Date().toISOString(); await save(reportPath, report); };
  if (installOverlay) {
    if (!sourceRoot.startsWith('/dev/') || sourceRoot.startsWith('/dev/shm/'))
      fail('Overlay the exact native modules only into this invocation’s private /dev source copy.');
    await copyTree(dependencyDirectory, sourceRoot);
    for (const name of ['clinicaltrials-workspace.mjs','clinicaltrials-client.mjs','clinicaltrials-cli.mjs','CLINICALTRIALS_WORKSPACE.md','catalog/clinicaltrials-workspace.mjs']) {
      const relative = 'stellar-forge/mcp-merchant-operator/' + name;
      await mkdir(dirname(join(sourceRoot, relative)), { recursive: true, mode: 0o700 });
      await writeFile(join(sourceRoot, relative), await readFile(join(overlayDirectory, relative)), { mode: 0o600 });
    }
  }
  const moduleDirectory = join(sourceRoot, 'stellar-forge/mcp-merchant-operator');
  const { MerchantClinicalTrialsWorkspaces, clinicalTrialsWorkspaceTools,
    readClinicalTrialsWorkspaceConfiguration } = await import(pathToFileURL(join(moduleDirectory, 'clinicaltrials-workspace.mjs')));
  const { openClinicalTrialsClient, downloadClinicalTrialsExport,
    reopenClinicalTrialsExport } = await import(pathToFileURL(join(moduleDirectory, 'clinicaltrials-client.mjs')));
  const { createMcpToolHandler } = await import(pathToFileURL(join(sourceRoot, 'stellar-forge/mcp-paid-agent/http-tools.mjs')));
  const consoleFile = join(outputDirectory, 'clinical-console.url');
  await writeFile(consoleFile, consoleUrl + '\n', { mode: 0o600 });
  const connectionFile = join(outputDirectory, 'connection.json');
  await save(connectionFile, { schema: 'stellar-forge.clinicaltrials-workspace-connection.v1', workspaces: {
    [workspaceAlias]: { label: 'Original ClinicalTrials cohort receiving', consoleUrlFile: consoleFile, files: {} }
  } });
  const exportsDirectory = join(outputDirectory, 'customer-exports');
  await mkdir(exportsDirectory, { recursive: true, mode: 0o700 });
  const config = { clinicalTrialsWorkspaces: await readClinicalTrialsWorkspaceConfiguration(connectionFile), exportsDirectory };
  const environment = { CLINICAL_MCP_NATIVE_TOKEN: randomBytes(32).toString('base64url') };
  const toolDefinitions = clinicalTrialsWorkspaceTools((name, description, properties = {}, required = [], hints = {}) => ({
    name, description, annotations: { readOnlyHint: hints.readOnly ?? false,
      idempotentHint: hints.idempotent ?? false, destructiveHint: hints.destructive ?? false,
      openWorldHint: hints.openWorld ?? false },
    inputSchema: { type: 'object', properties, required, additionalProperties: false }
  }));
  let owned;
  async function start() {
    const adapter = new MerchantClinicalTrialsWorkspaces(config);
    const handler = createMcpToolHandler({ tools: toolDefinitions, call: adapter.call.bind(adapter) }, {
      bearerToken: environment.CLINICAL_MCP_NATIVE_TOKEN,
      serverName: 'starforge-clinicaltrials-operator', serverVersion: '0.1.0',
      instructions: 'Use the original retained ClinicalTrials console, exact request UUID and reviewed integer revision.'
    });
    const server = createServer(handler);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/mcp';
    const client = await openClinicalTrialsClient({ url: endpoint, tokenEnv: 'CLINICAL_MCP_NATIVE_TOKEN', environment });
    let closing;
    return { adapter, client, endpoint, close() {
      closing ??= (async () => {
        await adapter.close();
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeIdleConnections?.(); await closed;
      })();
      return closing;
    } };
  }
  const originalState = async () => {
    const state = await new Promise((resolve, reject) => {
      const request = httpRequest(url.origin + '/api/state', { method: 'GET', agent: false,
        headers: { Authorization: 'Bearer ' + url.hash.slice(1), Origin: url.origin } }, response => {
        (async () => {
          if (response.statusCode !== 200) fail('The borrowed original console did not remain available: HTTP ' + response.statusCode);
          const chunks = []; let size = 0;
          for await (const chunk of response) {
            size += chunk.length; if (size > 16 * 1024 * 1024) fail('Original state exceeds the declared complete-response limit.');
            chunks.push(chunk);
          }
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        })().then(resolve, reject).finally(() => request.destroy());
      });
      request.once('error', reject);
      request.setTimeout(240_000, () => request.destroy(new Error('Original console read timed out.')));
      request.end();
    });
    if (state.applicationSchema !== 'stellar-forge.clinicaltrials-workspace.v1') fail('Original ClinicalTrials application identity changed.');
    return state;
  };
  async function action(key, actionName, payload) {
    const before = (await owned.client.status({ workspace: workspaceAlias })).state;
    let request = report.requests[key];
    if (!request) {
      request = { workspace: workspaceAlias, action: actionName, payload,
        expectedRevision: before.revision, requestId: randomUUID() };
      report.requests[key] = request;
      await checkpoint('RETAINED_' + key.toUpperCase() + '_REQUEST');
    } else if (request.action !== actionName || JSON.stringify(request.payload) !== JSON.stringify(payload))
      fail('The retained intended action has different original input: ' + key);
    const prior = (await owned.client.operation({ workspace: workspaceAlias, requestId: request.requestId })).native;
    if (prior.status === 'COMPLETE') {
      report.steps[key] = { requestId: request.requestId, status: prior.status, result: prior.result, revision: prior.revision };
      await checkpoint('RECOVERED_' + key.toUpperCase()); return prior.result;
    }
    if (prior.status !== 'UNKNOWN') fail('The original ' + key + ' request is ' + prior.status + ': ' + (prior.error ?? 'inspect its retained native operation'));
    if (before.revision !== request.expectedRevision) fail('The original workspace revision changed before its retained ' + key + ' request was accepted.');
    await owned.client.action(request);
    const after = (await owned.client.operation({ workspace: workspaceAlias, requestId: request.requestId })).native;
    if (after.status !== 'COMPLETE') fail('The original ' + key + ' operation did not return its complete retained record.');
    report.steps[key] = { requestId: request.requestId, status: after.status, result: after.result, revision: after.revision };
    await checkpoint('COMPLETE_' + key.toUpperCase()); return after.result;
  }
  try {
    owned = await start();
    report.toolCount = toolDefinitions.length;
    report.source = [];
    for (const file of ['clinicaltrials-workspace.mjs','clinicaltrials-client.mjs','clinicaltrials-cli.mjs']) {
      const data = await readFile(join(moduleDirectory, file));
      report.source.push({ file, bytes: data.length, sha256: sha(data) });
    }
    const workspaces = await owned.client.workspaces({});
    if (!workspaces.workspaces.some(value => value.workspace === workspaceAlias)) fail('The original declared workspace alias is missing.');
    const first = (await owned.client.status({ workspace: workspaceAlias })).state;
    const capture = first.captures.find(value => value.id === (captureId ?? first.capture?.id)) ??
      first.captures.find(value => value.status === 'completed');
    if (!capture || capture.status !== 'completed') fail('Continue the original completed capture before customer receiving.');
    captureId = capture.id;
    if (report.continuation && (report.continuation.previousCapture.captureId !== captureId ||
        report.continuation.previousCapture.rowCount !== capture.rowCount ||
        report.continuation.previousCapture.sourceId !== capture.source ||
        report.continuation.previousCapture.buildId !== first.activeBuild))
      fail('The portable receiver differs from the exact saved cohort, native source or active edition.');
    if (expectedStudies !== undefined && capture.rowCount !== expectedStudies) fail('Original complete capture count differs from the selected cohort.');
    report.original = { captureId, rowCount: capture.rowCount, expectedRows: capture.expectedRows,
      pages: capture.pageCount, providerVersion: capture.version, sourceId: capture.source,
      buildId: first.activeBuild, initialRevision: report.original?.initialRevision ?? first.revision };
    await checkpoint('ATTACHED_ORIGINAL_COMPLETE_CAPTURE');

    const rows = []; let offset = 0;
    do {
      const result = (await owned.client.studies({ workspace: workspaceAlias, captureId, offset, limit: 50 })).native;
      if (result.captureId !== captureId || result.offset !== offset || result.total !== capture.rowCount) fail('Original study page identity changed.');
      rows.push(...result.rows); offset = result.nextOffset;
    } while (offset !== null);
    if (rows.length !== capture.rowCount || new Set(rows.map(row => row.nctId)).size !== rows.length) fail('Original retained cohort paging lost or duplicated an NCT identifier.');
    report.steps.cohort = { rows: rows.length, firstNctId: rows[0]?.nctId, lastNctId: rows.at(-1)?.nctId };

    for (const kind of ['captures','reviews','prs','prsPlans','prsReconciliations','prsPreviews','sources','plans','builds','comparisons']) {
      const result = await owned.client.inventory({ workspace: workspaceAlias, kind, offset: 0, limit: 50 });
      report.steps.inventories ??= {};
      report.steps.inventories[kind] = { total: result.native.total, snapshot: result.native.snapshot };
    }
    const record = rows[1]?.nctId !== 'NCT03529110' ? rows[1] : rows.find(row => row.nctId !== 'NCT03529110');
    if (!record) fail('A distinct original study for the receiving review was not available.');
    const study = (await owned.client.study({ workspace: workspaceAlias, captureId, nctId: record.nctId })).native;
    if (study.nctId !== record.nctId || study.captureId !== captureId || !/^[0-9a-f]{64}$/.test(study.sourceSha256) ||
        typeof study.json !== 'string' || !study.study?.protocolSection || !study.sectionJson)
      fail('The retained complete study response lost its original identity or nested source.');
    await save(join(outputDirectory, 'original-study.json'), study);
    const reviewInput = {
      captureId, nctId: study.nctId, expectedSha256: study.sourceSha256, decision: 'follow-up', reviewedBy,
      note: 'Internal customer receiving: the complete original protocol/results JSON, original NCT identity and source page were inspected through the authenticated MCP console. The complete original study and source SHA are retained with the customer delivery for protocol/results review.'
    };
    let review;
    if (report.continuation) {
      const expected = report.continuation.previousReview;
      review = first.reviews.find(value => value.id === expected.id);
      if (!review || review.nctId !== study.nctId || review.nctId !== expected.nctId ||
          review.sourceSha256 !== study.sourceSha256 || review.sourceSha256 !== expected.sourceSha256 ||
          review.decision !== expected.decision)
        fail('The original reviewed study and its exact source identity were not preserved in the portable receiver.');
      report.steps.receiving_review = { status: 'RETAINED_REVIEW_REUSED', result: review,
        originalRequestId: report.continuation.previousRequestIds.receiving_review };
      await checkpoint('REUSED_ORIGINAL_RECEIVING_REVIEW');
    } else review = await action('receiving_review', 'review.record', reviewInput);
    report.review = { id: review.id, nctId: review.nctId, sourceSha256: review.sourceSha256, decision: review.decision };

    const source = await owned.client.call('source_inspect', { workspace: workspaceAlias, source: capture.source });
    report.steps.originalSource = { sourceId: capture.source, schema: source.native?.schema ?? source.native?.inventory?.schema ?? null,
      records: source.native?.records ?? source.native?.inventory?.records ?? null };
    const sourceStatus = await owned.client.call('source_status', { workspace: workspaceAlias });
    report.steps.originalSourceCounts = sourceStatus.counts;
    const current = (await owned.client.status({ workspace: workspaceAlias })).state;
    if (!current.activeBuild) fail('The original active native dataset edition is missing.');
    const query = await action('customer_query', 'dataset.query', { buildId: current.activeBuild, query: { limit: '50' } });
    report.steps.customerQuery = { buildId: current.activeBuild, result: query };
    for (const document of current.prs) {
      const result = (await owned.client.prs({ workspace: workspaceAlias, documentId: document.id })).native;
      report.steps.prs ??= []; report.steps.prs.push({ documentId: document.id, schema: result.record?.report?.schemaKind ?? null });
    }
    for (const plan of current.prsPlans) await owned.client.prsPlan({ workspace: workspaceAlias, planId: plan.id });
    for (const reconciliation of current.prsReconciliations)
      await owned.client.prsReconciliation({ workspace: workspaceAlias, reportId: reconciliation.id });
    const catalog = (await owned.client.prsCatalog({ workspace: workspaceAlias })).native;
    report.steps.prsCatalog = { retained: true, keys: Object.keys(catalog) };
    for (const preview of current.prsPreviews) {
      const original = (await owned.client.prsPreview({ workspace: workspaceAlias, previewId: preview.id })).native;
      if (original.id !== preview.id) fail('Original PRS preview identity changed.');
      report.steps.prsPreviews ??= [];
      report.steps.prsPreviews.push({ previewId: original.id, candidateId: original.candidateId });
    }
    await checkpoint('ORIGINAL_STUDY_REVIEW_QUERY_AND_PRS_INSPECTION');

    await owned.close(); owned = null;
    const stillOpen = await originalState();
    if (!stillOpen.reviews.some(value => value.id === review.id)) fail('Original owner lost the receiving review after MCP close.');
    report.steps.borrowedOwner = { retainedAfterClose: true, captureId, reviewId: review.id, revision: stillOpen.revision };
    owned = await start();
    if (report.continuation) {
      const restored = (await owned.client.status({ workspace: workspaceAlias })).state;
      if (!restored.reviews.some(value => value.id === review.id && value.sourceSha256 === review.sourceSha256))
        fail('MCP reopen did not preserve the same original retained review.');
    } else {
      const recovered = await owned.client.operation({ workspace: workspaceAlias, requestId: report.requests.receiving_review.requestId });
      if (recovered.native.status !== 'COMPLETE' || recovered.native.result.id !== review.id) fail('MCP reopen did not recover the same original review.');
    }
    const exported = await action('customer_export', 'package.export', { buildId: current.activeBuild });
    if (exported.captureId !== captureId || exported.rowCount !== capture.rowCount || !Array.isArray(exported.files))
      fail('Original customer export did not retain the selected complete cohort.');
    if (report.continuation?.previousExport.snapshot && exported.snapshot !== report.continuation.previousExport.snapshot)
      fail('The restored receiver export changed the original native dataset snapshot.');
    report.nativeExport = exported;
    await checkpoint('ORIGINAL_COMPLETE_CUSTOMER_EXPORT');

    const receivingRoot = join(outputDirectory, 'received');
    await mkdir(receivingRoot, { recursive: true, mode: 0o700 });
    for (let index = 0; index < exported.files.length; index++) {
      const file = exported.files[index];
      let saved = report.downloads.find(value => value.nativeName === file.name);
      if (!saved) {
        const prepared = await owned.client.filePrepare({ workspace: workspaceAlias, kind: 'export',
          exportId: exported.id, file: file.name, expectedSha256: file.sha256 });
        if (prepared.manifest.files[0].sha256 !== file.sha256 || prepared.manifest.files[0].bytes !== file.bytes)
          fail('Native file preparation changed the original complete file.');
        saved = { nativeName: file.name, nativeSha256: file.sha256, nativeBytes: file.bytes,
          exportId: prepared.exportId, manifestSha256: prepared.manifestSha256,
          directory: join(receivingRoot, 'file-' + String(index).padStart(4, '0')) };
        report.downloads.push(saved); await checkpoint('RETAINED_CUSTOMER_FILE_' + index);
      }
      const result = await downloadClinicalTrialsExport({ url: owned.endpoint, tokenEnv: 'CLINICAL_MCP_NATIVE_TOKEN',
        environment, exportId: saved.exportId, expectedManifestSha256: saved.manifestSha256, directory: saved.directory });
      if (result.state !== 'COMPLETE' || result.bytes !== file.bytes) fail('Original complete customer file receiving did not finish.');
      const manifest = JSON.parse(await readFile(join(saved.directory, 'clinicaltrials-export.json'), 'utf8'));
      const receivedFile = join(saved.directory, manifest.files[0].name), received = await readFile(receivedFile);
      if (received.length !== file.bytes || sha(received) !== file.sha256) fail('Received customer bytes differ from their original native export.');
      saved.path = receivedFile; saved.completed = true;
      await checkpoint('COMPLETE_CUSTOMER_FILE_' + index);
    }
    report.steps.customerFiles = { count: report.downloads.length,
      bytes: report.downloads.reduce((sum, value) => sum + value.nativeBytes, 0) };
    const listing = await owned.client.exports({ workspace: workspaceAlias, offset: 0, limit: 250 });
    if (listing.total < report.downloads.length) fail('Retained MCP delivery inventory lost a complete native file.');
    await owned.close(); owned = null;

    for (const saved of report.downloads) {
      const reopened = await reopenClinicalTrialsExport({ directory: saved.directory, exportId: saved.exportId,
        expectedManifestSha256: saved.manifestSha256 });
      if (reopened.state !== 'REOPENED' || reopened.bytes !== saved.nativeBytes) fail('Original local customer file reopen did not retain its complete bytes.');
      saved.reopened = true;
    }
    const final = await originalState();
    if (final.capture?.id !== captureId || final.capture?.rowCount !== capture.rowCount ||
        !final.reviews.some(value => value.id === review.id) || !final.exports.some(value => value.id === exported.id))
      fail('Original borrowed workspace changed its completed capture/review/export identity.');
    report.steps.ownerAvailableAtEnd = { captureId, rowCount: final.capture.rowCount, reviewId: review.id,
      exportId: exported.id, revision: final.revision };
    report.status = 'PASS'; report.passed = true; report.closed = true; report.finishedAt = new Date().toISOString();
    await checkpoint('COMPLETE_ORIGINAL_MCP_CUSTOMER_RECEIVING');
    return report;
  } catch (error) {
    report.error = { code: error.code ?? null, message: String(error.message ?? error).split(url.hash.slice(1)).join('[private capability]') };
    report.status = 'FAILED'; report.passed = false;
    await checkpoint('ORIGINAL_OPERATION_RETAINED').catch(() => {});
    throw error;
  } finally {
    await owned?.close();
  }
}
