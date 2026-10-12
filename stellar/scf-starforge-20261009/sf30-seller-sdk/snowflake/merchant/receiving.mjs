#!/usr/bin/env node
// MIT. Complete native merchant receiving on the supplied original export and terms.
import assert from 'node:assert/strict';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { atomicJson, boundedFile, canonical } from '../../../sf46-release/release-core.mjs';
import { readReleaseState } from '../../../sf82-seller-pilot/releases.mjs';
import { openSnowflakeWorkspace } from '../workspace.mjs';
import { inspectSnowflakeWorkspace } from '../managed.mjs';
import { validateSnowflakeReceivingManifest } from '../transfer.mjs';
import { startMerchantMcp } from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import { snowflakeActions, openSnowflakeClient, uploadSnowflakeOriginals,
  downloadSnowflakeExport, reopenSnowflakeExport } from './client.mjs';
import { initializeSnowflakeWorkspaceMerchant } from './setup.mjs';
import { SNOWFLAKE_WORKSPACE_CONNECTION_SCHEMA } from './runtime.mjs';
import { privateDirectory, fail, alias, sha256 } from './files.mjs';

const SCHEMA = 'stellar-forge.snowflake-merchant-receiving.v1';
const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
async function inputFile(path, maximum) {
  path = resolve(path);
  return { path, bytes: await boundedFile(dirname(path), basename(path), maximum) };
}
/** One resumable receiving case. Supplied source bytes and terms stay unchanged. */
export async function runSnowflakeMerchantReceiving({
  directory, manifestFile, draftFile, publicationId, exportId = 'original-snowflake-delivery',
  workspace = 'warehouse', environment = process.env,
} = {}) {
  alias(workspace); alias(exportId);
  if (typeof directory !== 'string' || !directory || typeof manifestFile !== 'string' || typeof draftFile !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(publicationId ?? '')) throw fail('RECEIVING_SELECTION_REQUIRED');
  const root = await privateDirectory(directory), source = await inputFile(manifestFile, 2097152),
    terms = await inputFile(draftFile, 1048576), manifest = validateSnowflakeReceivingManifest(decode(source.bytes)),
    draft = decode(terms.bytes), statePath = join(root, 'merchant-receiving.json');
  if (!/^[a-f0-9]{64}$/.test(manifest.editionId ?? '')) throw fail('ORIGINAL_EDITION_REQUIRED');
  const selection = { manifestSha256: sha256(source.bytes), draftSha256: sha256(terms.bytes),
    publicationId, exportId, workspace, editionId: manifest.editionId };
  let state;
  try { state = decode(await boundedFile(root, basename(statePath), 1048576)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { schema: SCHEMA, selection, startedAt: new Date().toISOString(), steps: {}, state: 'PREPARED' };
    await atomicJson(statePath, state, { exclusive: true });
  }
  if (state.schema !== SCHEMA || canonical(state.selection) !== canonical(selection)) throw fail('RECEIVING_SELECTION_CHANGED');
  const save = () => atomicJson(statePath, state);
  const record = async (name, details) => {
    state.steps[name] = { at: new Date().toISOString(), ...details }; await save();
    process.stdout.write(JSON.stringify({ step: name, ...details }) + '\n');
  };
  const nativeDirectory = join(root, 'workspace'), hostDirectory = join(root, 'merchant-host'),
    connection = join(root, 'snowflake-connection.json'), downloadDirectory = join(root, 'complete-download');
  let host, receiver;
  const serverEnvironment = { ...environment, MCP_ACCESS_TOKEN: environment.MCP_ACCESS_TOKEN ?? randomBytes(32).toString('hex') };
  let client;
  const start = async configuration => {
    host = await startMerchantMcp({ configPath: configuration, port: 0, environment: serverEnvironment });
    client = await openSnowflakeClient({ url: host.url, environment: serverEnvironment });
  };
  try {
    state.state = 'RUNNING'; delete state.error; await save();
    if (!state.workspaceId) {
      const original = await openSnowflakeWorkspace({ directory: nativeDirectory, env: serverEnvironment });
      try { state.workspaceId = (await original.state()).id; } finally { await original.close(); }
      await save();
    }
    await inspectSnowflakeWorkspace(nativeDirectory, { expectedId: state.workspaceId });
    const hostConnection = { schema: SNOWFLAKE_WORKSPACE_CONNECTION_SCHEMA, workspaces: {
      [workspace]: { label: 'Original Snowflake receiving', directory: nativeDirectory, workspaceId: state.workspaceId } } };
    try {
      const existing = decode(await boundedFile(root, basename(connection), 1048576));
      assert.equal(canonical(existing), canonical(hostConnection));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicJson(connection, hostConnection, { exclusive: true });
    }
    const initialized = await initializeSnowflakeWorkspaceMerchant({
      directory: hostDirectory, connection, workspace, name: 'Original Snowflake merchant receiving' });
    assert.equal((await initializeSnowflakeWorkspaceMerchant({
      directory: hostDirectory, connection, workspace, name: 'Original Snowflake merchant receiving' })).reused, true);
    await start(initialized.configuration);
    const tools = host.operator.tools.filter(tool => tool.name.startsWith('merchant_snowflake_'));
    assert.deepEqual(tools.map(tool => tool.name).sort(), Object.values(snowflakeActions).map(tool => tool.name).sort());
    const inventory = await client.workspaces({});
    assert.equal(inventory.workspaces.find(item => item.workspace === workspace).open, false);
    let opened = await client.open({ workspace });
    assert.equal(opened.workspaceId, state.workspaceId);
    const browser = new URL(opened.url);
    const browserResponse = await fetch(browser.origin + '/api/state', {
      headers: { 'x-snowflake-workspace': browser.hash.slice(1) }, signal: AbortSignal.timeout(30000) });
    assert.equal(browserResponse.status, 200);
    assert.equal((await browserResponse.json()).id, state.workspaceId);
    await record('source-owned-provider-and-original-browser', { workspaceId: state.workspaceId, tools: tools.length,
      instanceId: opened.instanceId, commonReleaseStore: initialized.releaseStore });

    if (!state.steps['original-upload-checkpoint']) {
      let paused = false;
      try {
        await uploadSnowflakeOriginals({ client, workspace, manifestFile: source.path,
          expectedWorkspaceId: state.workspaceId, chunkSize: 257,
          onProgress: async progress => {
            if (!paused && progress.receivedBytes > 0) {
              paused = true; await record('original-upload-checkpoint', { transferId: progress.transferId,
                partition: progress.partition, receivedBytes: progress.receivedBytes, instanceId: opened.instanceId });
              throw fail('RECEIVING_PAUSE', 'Retained original receiving checkpoint.');
            }
          } });
      } catch (error) { if (error.code !== 'SNOWFLAKE_RECEIVING_PAUSE') throw error; }
      if (!paused) {
        const original = await client.receiveBegin({ workspace, manifest });
        await record('original-upload-checkpoint', { transferId: original.transfer.id, alreadyComplete: true, instanceId: opened.instanceId });
      }
    }
    const previousInstance = opened.instanceId;
    await host.close(); host = null;
    await start(initialized.configuration);
    opened = await client.open({ workspace });
    assert.equal(opened.workspaceId, state.workspaceId);
    assert.notEqual(opened.instanceId, previousInstance);
    const received = await uploadSnowflakeOriginals({ client, workspace, manifestFile: source.path,
      expectedWorkspaceId: state.workspaceId, chunkSize: 65536 });
    assert.equal(received.editionId, manifest.editionId);
    assert.equal(received.transferId, state.steps['original-upload-checkpoint'].transferId);
    const selected = await client.edition({ workspace, editionId: received.editionId });
    assert.equal(selected.edition.partitionCount, manifest.partitions.length);
    await record('same-transfer-recovery-and-native-edition', { workspaceId: state.workspaceId,
      transferId: received.transferId, editionId: received.editionId, partitions: received.partitions,
      resumedBytes: received.resumedBytes, rows: selected.edition.rowCount, instanceId: opened.instanceId });

    if (selected.review?.decision !== 'ACCEPTED') await client.review({ workspace, editionId: received.editionId,
      decision: 'ACCEPTED', actor: 'Original merchant receiving',
      note: 'Reviewed complete original partition identities and native retained edition before merchant preparation.' });
    const prepared = await client.prepare({ workspace, editionId: received.editionId, publicationId, draft, runtime: { port: 0 },
      label: 'Original retained Snowflake edition' });
    assert.equal(prepared.publication.status, 'PREPARED');
    const resumed = await client.resumePublication({ workspace, publicationId });
    assert.equal(resumed.publication.releaseId, prepared.publication.releaseId);
    const exported = await client.export({ workspace, editionId: received.editionId, publicationId, exportId });
    assert.equal((await client.export({ workspace, editionId: received.editionId, publicationId, exportId })).manifestSha256,
      exported.manifestSha256);
    await record('same-publication-and-complete-retained-export', { publicationId, releaseId: prepared.publication.releaseId,
      exportId, manifestSha256: exported.manifestSha256, files: exported.files, bytes: exported.bytes });

    if (!state.steps['original-download-checkpoint']) {
      let paused = false;
      try {
        await downloadSnowflakeExport({ client, exportId, directory: downloadDirectory,
          expectedManifestSha256: exported.manifestSha256, chunkSize: 257, onProgress: async progress => {
            if (!paused) {
              paused = true; await record('original-download-checkpoint', { file: progress.file, bytes: progress.bytes });
              throw fail('RECEIVING_PAUSE', 'Retained original file-download checkpoint.');
            }
          } });
      } catch (error) { if (error.code !== 'SNOWFLAKE_RECEIVING_PAUSE') throw error; }
      if (!paused) await record('original-download-checkpoint', { alreadyComplete: true });
    }
    const downloadInstance = opened.instanceId;
    await host.close(); host = null;
    await start(initialized.configuration);
    opened = await client.open({ workspace });
    assert.equal(opened.workspaceId, state.workspaceId); assert.notEqual(opened.instanceId, downloadInstance);
    assert.equal((await client.publication({ workspace, publicationId })).publication.releaseId, prepared.publication.releaseId);
    const downloaded = await downloadSnowflakeExport({ client, exportId, directory: downloadDirectory,
      expectedManifestSha256: exported.manifestSha256 });
    const reopened = await reopenSnowflakeExport({ directory: downloadDirectory, exportId,
      expectedManifestSha256: exported.manifestSha256 });
    assert.equal(reopened.manifestSha256, exported.manifestSha256);
    assert.equal(reopened.files, exported.files);
    const snapshot = new DatabaseSync(join(downloadDirectory, 'native-snapshot.sqlite'), { readOnly: true });
    let rowCount = 0, originalBodies = 0;
    try {
      for await (const page of client.pages('rows', { workspace, editionId: received.editionId, limit: 200 })) {
        const columns = page.columns.map(column => typeof column === 'string' ? column : column.name);
        const sql = 'SELECT ' + columns.map(name => '"' + name.replaceAll('"', '""') + '"').join(', ') +
          ' FROM records ORDER BY __sf30_row_number LIMIT ? OFFSET ?';
        const originalRows = snapshot.prepare(sql).all(page.rows.length, page.offset).map(row => ({ ...row }));
        assert.deepEqual(originalRows, page.rows); rowCount += page.rows.length;
      }
      for (const body of snapshot.prepare('SELECT partition_number,sha256,bytes,body FROM __sf30_snowflake_originals ORDER BY partition_number').iterate()) {
        const descriptor = manifest.partitions[body.partition_number];
        assert.ok(descriptor); assert.equal(body.sha256, descriptor.sha256); assert.equal(body.bytes, descriptor.bytes);
        assert.equal(sha256(body.body), descriptor.sha256); originalBodies++;
      }
    } finally { snapshot.close(); }
    assert.equal(rowCount, selected.edition.rowCount); assert.equal(originalBodies, manifest.partitions.length);
    receiver = await openSnowflakeWorkspace({ directory: join(root, 'receiving-workspace'), env: serverEnvironment });
    const imported = await receiver.receive(join(downloadDirectory, 'receiving.json'));
    assert.equal(imported.editionId, received.editionId);
    await receiver.close(); receiver = null;
    await record('complete-files-native-snapshot-and-customer-receiving', { workspaceId: state.workspaceId,
      exportId, manifestSha256: reopened.manifestSha256, files: reopened.files, bytes: reopened.bytes,
      resumedBytes: downloaded.resumedBytes, rows: rowCount, originalBodies, receivingEditionId: imported.editionId });

    const consoleSession = await client.releaseConsole({ workspace });
    const consoleUrl = new URL(consoleSession.url), releaseRoot = join(nativeDirectory, 'release-store');
    async function releaseApi(path, body) {
      const response = await fetch(consoleUrl.origin + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-release-token': consoleUrl.hash.slice(1), origin: consoleUrl.origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      const value = await response.json();
      if (!response.ok) throw fail('RELEASE_CONSOLE_FAILED', value.error ?? 'The original release console returned an error.');
      return value;
    }
    const release = await readReleaseState(releaseRoot);
    if (release.active !== prepared.publication.releaseId) await releaseApi('/api/activate', {
      id: prepared.publication.releaseId, expectedGeneration: release.generation, reason: 'Complete original Snowflake merchant receiving' });
    assert.equal((await readReleaseState(releaseRoot)).active, prepared.publication.releaseId);
    for (const asset of ['/', '/app.mjs', '/client.mjs', '/receiving.mjs', '/style.css'])
      assert.equal((await fetch(consoleUrl.origin + asset, { signal: AbortSignal.timeout(30000) })).status, 200);
    await record('original-release-and-customer-console', { releaseId: prepared.publication.releaseId,
      generation: (await readReleaseState(releaseRoot)).generation, assets: 5 });
    const closed = await client.close({ workspace, instanceId: opened.instanceId });
    assert.equal(closed.state, 'CLOSED');
    assert.equal((await client.workspaces({})).workspaces.find(item => item.workspace === workspace).open, false);
    state.state = 'COMPLETE'; state.completedAt = new Date().toISOString(); await save();
    return { schema: SCHEMA, state: state.state, directory: root, selection, workspaceId: state.workspaceId,
      steps: Object.keys(state.steps), files: exported.files, bytes: exported.bytes };
  } catch (error) {
    state.state = 'INTERRUPTED'; state.error = { code: error.code ?? error.name, message: error.message };
    await save(); throw error;
  } finally {
    try { await receiver?.close(); } finally { await host?.close(); }
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--config') throw fail('RECEIVING_SELECTION_REQUIRED',
    'Run merchant-snowflake-receive --config ORIGINAL_RECEIVING_CASE_JSON.');
  const file = await inputFile(argv[1], 1048576), raw = decode(file.bytes);
  const allowed = ['directory','manifestFile','draftFile','publicationId','exportId','workspace'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key)))
    throw fail('RECEIVING_SELECTION_REQUIRED');
  const selected = { ...raw };
  for (const key of ['directory','manifestFile','draftFile']) if (typeof selected[key] === 'string') selected[key] = resolve(dirname(file.path), selected[key]);
  const result = await runSnowflakeMerchantReceiving(selected);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });
