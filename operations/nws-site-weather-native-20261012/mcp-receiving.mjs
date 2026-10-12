// Private continuation for the original NWS native operating journey.
import { readFile, writeFile, mkdir, rename, open, chmod } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const SCHEMA = 'stellar-forge.nws-merchant-receiving-journey.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
const original = value => {
  need(value && value.ok === true, 'The original NWS tool rejected this continuation: ' + JSON.stringify(value));
  return value.native;
};
async function savedJson(file, value) {
  const pending = file + '.next', handle = await open(pending, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(pending, file);
}
async function present(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function checkedFiles(directory, manifest) {
  const rows = [];
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.name));
    need(bytes.length === file.bytes && hash(bytes) === file.sha256,
      'The original received file differs from its selected byte/hash manifest: ' + file.name);
    rows.push({ name: file.name, originalName: file.originalName, bytes: bytes.length, sha256: file.sha256 });
  }
  return rows;
}

/**
 * Run inside the caller's one original native operation, against its live NWS server.
 * sourceRoot is the selected repository root; consoleUrl stays private.
 * closeWorkspace is supplied only at the end of the caller's browser workflow.
 */
export async function runNwsMerchantReceiving({
  sourceRoot, sourceCommit, artifactDirectory, workspaceId, consoleUrl, editionId, receiptId,
  table = 'forecast', sourcePackageFile, closeWorkspace,
} = {}) {
  sourceRoot = resolve(sourceRoot); artifactDirectory = resolve(artifactDirectory);
  need(/^[0-9a-f]{40}$/.test(sourceCommit ?? ''), 'Supply the caller\'s selected original source commit.');
  need(/^[0-9a-f-]{36}$/.test(workspaceId ?? '') && /^[0-9a-f]{64}$/.test(editionId ?? '') &&
    /^buyer-[0-9a-f]{24}$/.test(receiptId ?? ''), 'Supply the caller\'s original workspace, edition and completed customer receipt.');
  const source = join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/nws');
  const shared = join(sourceRoot, 'stellar-forge/mcp-merchant-operator');
  const load = async (directory, name) => import(pathToFileURL(join(directory, name)).href);
  const [{ initializeNwsWorkspaceMerchant }, { startMerchantMcp }, clientModule] = await Promise.all([
    load(source, 'merchant-setup.mjs'), load(shared, 'serve.mjs'), load(source, 'mcp-client.mjs'),
  ]);
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await chmod(artifactDirectory, 0o700);
  const journalFile = join(artifactDirectory, 'journal.json');
  const journal = await present(journalFile) ?? {
    schema: SCHEMA, workspaceId, editionId, receiptId, sourceRoot, sourceCommit, table,
    createdAt: new Date().toISOString(), steps: [], actions: {}, listenerPort: null,
  };
  need(journal.schema === SCHEMA && journal.workspaceId === workspaceId &&
    journal.editionId === editionId && journal.receiptId === receiptId && journal.sourceRoot === sourceRoot &&
    journal.table === table && journal.sourceCommit === sourceCommit, 'Resume the same original NWS receiving selection.');
  const completedResult = await present(join(artifactDirectory, 'result.json'));
  if (completedResult?.state === 'COMPLETE') {
    need(completedResult.workspaceId === workspaceId && completedResult.editionId === editionId &&
      completedResult.receiptId === receiptId && completedResult.sourceCommit === sourceCommit,
      'Reopen the completed original receiving result for this same selection.');
    if (closeWorkspace) await closeWorkspace();
    return { ...completedResult, reused: true };
  }
  const save = () => savedJson(journalFile, journal);
  const record = async (name, detail = {}) => {
    const row = { name, at: new Date().toISOString(), ...detail };
    journal.steps.push(row); await save(); process.stdout.write(JSON.stringify(row) + '\n');
  };
  const sessionFile = join(artifactDirectory, 'original-console-url');
  const parsedUrl = new URL(consoleUrl);
  need(parsedUrl.protocol === 'http:' && parsedUrl.hostname === '127.0.0.1' &&
    /^#[A-Za-z0-9_-]{43}$/.test(parsedUrl.hash), 'Use the caller\'s live original private NWS session.');
  await writeFile(sessionFile, consoleUrl + '\n', { mode: 0o600 }); await chmod(sessionFile, 0o600);
  const entry = { label: 'Original site weather operation', workspaceId, consoleUrlFile: sessionFile };
  if (sourcePackageFile) {
    const bytes = await readFile(resolve(sourcePackageFile));
    const selected = join(artifactDirectory, 'selected-original-source-package.json');
    await writeFile(selected, bytes, { mode: 0o600 }); await chmod(selected, 0o600);
    entry.sourcePackages = { weather_source: { path: selected, sha256: hash(bytes), label: 'Original selected provider source' } };
    journal.sourcePackage = { bytes: bytes.length, sha256: hash(bytes) };
  }
  const connection = join(artifactDirectory, 'connection.json');
  await savedJson(connection, { schema: 'stellar-forge.nws-workspace-connection.v1', workspaces: { operations: entry } });
  const merchantDirectory = join(artifactDirectory, 'merchant');
  const configPath = join(merchantDirectory, 'merchant-mcp.json');
  if (!await present(configPath))
    await initializeNwsWorkspaceMerchant({ directory: merchantDirectory, connection, name: 'Original NWS customer receiving' });
  const environment = { ...process.env, MCP_ACCESS_TOKEN: randomBytes(32).toString('base64url') };
  const sourceFetch = globalThis.fetch;
  let dropOperation = null, dropped = false, merchant;
  async function observedFetch(url, options) {
    const response = await sourceFetch(url, options);
    if (dropOperation && !dropped && options?.method === 'POST' && String(url).endsWith('/api/action') &&
      JSON.parse(options.body).operationId === dropOperation) {
      const bytes = Buffer.from(await response.arrayBuffer());
      need(response.ok, 'The original note must complete before its selected lost response.');
      dropped = true;
      journal.lostResponse = { operationId: dropOperation, responseBytes: bytes.length, responseSha256: hash(bytes), status: response.status };
      await save();
      throw new Error('The original completed local response was disconnected by this retained continuation.');
    }
    return response;
  }
  try {
    merchant = await startMerchantMcp({ configPath, port: 0, environment, providerOptions: { nws: { environment, fetchImpl: observedFetch } } });
    journal.listenerPort = Number(new URL(merchant.url).port || 80); await save();
    const options = { url: merchant.url, workspace: 'operations', environment, expectedWorkspaceId: workspaceId };
    let client = await clientModule.openNwsClient(options);
    const advertised = merchant.operator.tools.filter(tool => tool.name.startsWith('merchant_nws_'));
    need(advertised.length === 30 && new Set(advertised.map(tool => tool.name)).size === 30,
      'The full original NWS tool family must be advertised once.');
    const aliases = await client.call('workspaces');
    need(aliases.configured && aliases.workspaces.some(row => row.workspaceId === workspaceId), 'Original NWS alias/UUID changed.');
    const schema = original(await client.call('schema')), firstView = original(await client.call('view'));
    need(Object.keys(schema.actions).length === 21 && firstView.workspaceId === workspaceId,
      'The original action or workspace contract changed.');
    const selectedEdition = original(await client.call('edition', { editionId }));
    need(selectedEdition.pages.length > 0, 'The selected source edition must contain its actual retained provider responses.');
    const rowPage = original(await client.call('rows', { editionId, table, offset: 0, limit: 100 }));
    need(Array.isArray(rowPage.rows), 'The original normalized row page was not returned.');
    let archiveOffset = 0, archiveRevision, archived = 0;
    do {
      const page = original(await client.call('editions', { offset: archiveOffset, limit: 2,
        ...(archiveRevision === undefined ? {} : { expectedRevision: archiveRevision }) }));
      archiveRevision ??= page.revision; archived += page.editions.length;
      archiveOffset = page.nextOffset;
    } while (archiveOffset !== null);
    await record('original-tool-and-archive-read', { tools: advertised.length, actions: Object.keys(schema.actions).length,
      editionId, table, tableRows: rowPage.total, originalPages: selectedEdition.pages.length, archived });

    const callAction = async (key, action, payload, { dropReply = false } = {}) => {
      let request = journal.actions[key];
      if (!request) {
        const view = original(await client.call('view'));
        request = { action, payload, operationId: 'nws-mcp-' + key + '-' + randomUUID(),
          expectedRevision: view.revision };
        journal.actions[key] = request; await save();
      }
      need(request.action === action && JSON.stringify(request.payload) === JSON.stringify(payload),
        'Keep the exact original retained action request: ' + key);
      if (dropReply && !journal.lostResponse) dropOperation = request.operationId;
      let response = await client.action(action, payload, request);
      dropOperation = null;
      if (response.ok === false && response.state === 'OUTCOME_UNCERTAIN') {
        need(journal.lostResponse?.operationId === request.operationId, 'Only the selected original response may be interrupted.');
        response = await client.action(action, payload, request);
        need(response.ok === true && response.native.reused === true, 'The same original action must be recovered from the native journal.');
      }
      const completed = original(response);
      need(completed.result !== undefined, 'The original action is still running; preserve its retained request.');
      return completed;
    };
    const note = await callAction('source-note', 'annotation.save', {
      editionId, subject: 'Original merchant source receiving',
      note: 'Opened this retained NWS edition, original provider response receipts and declared table rows through the shared merchant tools.',
      status: 'reviewed',
    }, { dropReply: true });
    const noteOperation = journal.actions['source-note'].operationId;
    need(note.view.operations.filter(row => row.operationId === noteOperation).length === 1,
      'The recovered source note must retain one original operation.');
    await record('original-action-response-recovery', { operationId: noteOperation,
      recovered: Boolean(journal.lostResponse), currentRevision: note.view.revision });

    const exportResult = await callAction('source-package-export', 'export.create', { editionId, table, format: 'source-package' });
    const packageId = exportResult.result.id;
    need(/^export-[0-9a-f]{24}$/.test(packageId), 'The source package export must retain its original identity.');

    const receiptSelection = await clientModule.inspectNwsFiles({ ...options, kind: 'receipt', id: receiptId });
    need(receiptSelection.manifest.files.length === 5 &&
      ['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'].every(name =>
        receiptSelection.manifest.files.some(file => file.name === name)),
      'The original customer receipt must include all five files.');
    const receiverDirectory = join(artifactDirectory, 'customer-files');
    const partialTarget = [...receiptSelection.manifest.files].sort((a,b) => b.bytes - a.bytes)[0];
    need(partialTarget.bytes > 1, 'The original customer receipt must contain a nonempty receiving payload.');
    const partialChunk = Math.min(4096, Math.max(1, Math.floor(partialTarget.bytes / 2)));
    if (!journal.downloadInterrupted) {
      try {
        await clientModule.downloadNwsFiles({ ...options, kind: 'receipt', id: receiptId, directory: receiverDirectory,
          expectedManifestSha256: receiptSelection.manifestSha256, chunkSize: partialChunk,
          async onProgress(progress) {
            if (progress.file === partialTarget.name && progress.bytes > 0 && progress.bytes < progress.total) {
              journal.downloadInterrupted = { file: progress.file, bytes: progress.bytes, total: progress.total,
                manifestSha256: receiptSelection.manifestSha256 };
              await save();
              throw Object.assign(new Error('Retained after the first durable original-file prefix.'), { code: 'NWS_JOURNEY_SAVED_PREFIX' });
            }
          } });
      } catch (error) {
        if (error.code !== 'NWS_JOURNEY_SAVED_PREFIX') throw error;
      }
      need(journal.downloadInterrupted, 'The selected retained customer download must stop after a durable prefix.');
    }
    if (!journal.downloadHostChanged) {
      const previousPort = Number(new URL(merchant.url).port || 80);
      await merchant.close(); merchant = null;
      const previousPortGuard = createServer(socket => socket.destroy());
      let guarded = false;
      try {
        try {
          await new Promise((yes, no) => {
            previousPortGuard.once('error', no);
            previousPortGuard.listen(previousPort, '127.0.0.1', () => { previousPortGuard.off('error', no); yes(); });
          });
          guarded = true;
        } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
        merchant = await startMerchantMcp({ configPath, port: 0, environment, providerOptions: { nws: { environment, fetchImpl: observedFetch } } });
      } finally {
        if (guarded) await new Promise((yes, no) => previousPortGuard.close(error => error ? no(error) : yes()));
      }
      const currentPort = Number(new URL(merchant.url).port || 80);
      need(currentPort !== previousPort, 'The same customer download must reopen on a different MCP listener port.');
      options.url = merchant.url; client = await clientModule.openNwsClient(options);
      const reopenedView = original(await client.call('view'));
      need(reopenedView.workspaceId === workspaceId, 'The restarted authenticated host must serve the same original workspace.');
      journal.listenerPort = currentPort;
      journal.downloadHostChanged = { previousPort, currentPort, workspaceId, manifestSha256: receiptSelection.manifestSha256 };
      await record('same-workspace-download-reopened-on-new-port', journal.downloadHostChanged);
    }
    const downloaded = await clientModule.downloadNwsFiles({ ...options, kind: 'receipt', id: receiptId, directory: receiverDirectory,
      expectedManifestSha256: receiptSelection.manifestSha256, chunkSize: 65536 });
    need(downloaded.state === 'COMPLETE' && downloaded.resumed &&
      downloaded.resumedBytes >= journal.downloadInterrupted.bytes,
      'The same original customer files must resume from their retained bytes.');
    const customerFiles = await checkedFiles(receiverDirectory, receiptSelection.manifest);
    await record('complete-original-customer-files', { receiptId, intentIds: receiptSelection.manifest.intentIds,
      dataset: receiptSelection.manifest.dataset, resumedBytes: downloaded.resumedBytes, files: customerFiles });

    const received = [];
    for (const selection of [
      { kind: 'source', id: editionId, wire: false, name: 'source-bodies' },
      { kind: 'source', id: editionId, wire: true, name: 'source-wire' },
      { kind: 'export', id: packageId, name: 'source-package' },
    ]) {
      const { name, ...nativeSelection } = selection;
      const inspection = await clientModule.inspectNwsFiles({ ...options, ...nativeSelection });
      const directory = join(artifactDirectory, name);
      const result = await clientModule.downloadNwsFiles({ ...options, ...nativeSelection, directory,
        expectedManifestSha256: inspection.manifestSha256, chunkSize: 65536 });
      need(result.state === 'COMPLETE', 'Original source receiving is incomplete: ' + name);
      const files = await checkedFiles(directory, inspection.manifest);
      received.push({ name, directory, manifestSha256: inspection.manifestSha256, files });
    }
    await record('complete-original-source-receiving', { selections: received });

    let retainedRead = null;
    if (closeWorkspace && !journal.closedWorkspaceRead) {
      const files = original(await client.call('files', { kind: 'source', id: editionId }));
      const selected = files.files.find(file => file.bytes > 1);
      need(selected, 'Choose an actual nonempty original source response for retained-read completion.');
      const first = original(await client.call('file_read', { ...selected.selection, expectedSha256: selected.sha256, limit: 1 }));
      retainedRead = { selected, first };
      await closeWorkspace();
      const chunks = [Buffer.from(first.data, 'base64')];
      let offset = first.nextOffset;
      while (offset !== null) {
        const part = original(await client.call('file_read', { ...selected.selection,
          readId: first.readId, expectedSha256: selected.sha256, offset, limit: 196608 }));
        chunks.push(Buffer.from(part.data, 'base64')); offset = part.nextOffset;
      }
      const bytes = Buffer.concat(chunks);
      need(bytes.length === selected.bytes && hash(bytes) === selected.sha256,
        'The already retained original response must complete after its console closes.');
      await client.call('file_release', { readId: first.readId });
      journal.closedWorkspaceRead = { name: selected.name, bytes: bytes.length, sha256: selected.sha256 };
      await record('retained-source-completed-after-workspace-close', journal.closedWorkspaceRead);
    }
    await merchant.close(); merchant = null;
    const reopenedCustomer = await clientModule.reopenNwsFiles({ directory: receiverDirectory,
      expectedManifestSha256: receiptSelection.manifestSha256 });
    need(reopenedCustomer.state === 'COMPLETE', 'The complete original customer files must reopen offline.');
    const reopenedSource = [];
    for (const item of received) {
      const value = await clientModule.reopenNwsFiles({ directory: item.directory, expectedManifestSha256: item.manifestSha256 });
      need(value.state === 'COMPLETE', 'The original source selection must reopen offline.');
      reopenedSource.push({ name: item.name, ...value });
    }
    const result = { schema: SCHEMA, state: 'COMPLETE', workspaceId, editionId, receiptId, sourceRoot, sourceCommit,
      completedAt: new Date().toISOString(), tools: advertised.length, actions: Object.keys(schema.actions).length,
      noteOperation, packageId, sourcePackage: journal.sourcePackage ?? null, customer: reopenedCustomer,
      customerFiles, originalSource: reopenedSource, closedWorkspaceRead: journal.closedWorkspaceRead ?? null,
      journalFile, steps: journal.steps };
    await savedJson(join(artifactDirectory, 'result.json'), result);
    return result;
  } catch (error) {
    journal.lastError = { at: new Date().toISOString(), code: error.code ?? 'NWS_MERCHANT_RECEIVING_FAILED', message: error.message };
    await save(); throw error;
  } finally {
    if (merchant) await merchant.close();
  }
}
