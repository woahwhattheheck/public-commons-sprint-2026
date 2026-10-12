#!/usr/bin/env node
// MIT. Complete operator composition over the existing WebDAV source and receiver.
import { constants } from 'node:fs';
import { mkdir, open, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { privateSupportDirectory, writePrivate } from '../host-files.mjs';
import { createWebDavWorkspaceClient } from '../webdav-workspace-client.mjs';
import { prepareWebDavOperation, inspectWebDavOperation, runWebDavOperation } from '../webdav-workspace-receiving.mjs';
import { prepareWebDavReceiving, downloadWebDavReceiving, inspectWebDavReceiving } from '../webdav-workspace-download.mjs';
import { webDavUuid, webDavCanonical, webDavJson, webDavJsonBytes, webDavError } from '../webdav-workspace-contracts.mjs';

async function readPrivateJson(path, maximum = 1048576) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum || process.platform !== 'win32' && (stat.mode & 0o077))
      throw webDavError('WEBDAV_EXAMPLE_INPUT', 'Use the complete private reviewed input file.');
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw webDavError('WEBDAV_EXAMPLE_INPUT', 'The selected input exceeds its original limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function retain(path, value) {
  try {
    const current = await readPrivateJson(path, 8 * 1024 * 1024);
    if (webDavCanonical(current) !== webDavCanonical(value))
      throw webDavError('WEBDAV_EXAMPLE_SELECTION_CHANGED', 'Continue the same reviewed input, endpoint, workspace and file selection.');
    return current;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writePrivate(path, webDavJsonBytes(value)); return value;
  }
}
function originalArguments(value) {
  const { operationId, expectedRevision, ...args } = value;
  return args;
}
/**
 * The input is an operator's reviewed mapping, dataset and original merchant.
 * Local step records reuse the native intent UUIDs and complete receiving plans.
 */
export async function receiveReviewedWebDavEdition({
  client, input: supplied, directory, signal, onProgress
}) {
  const input = webDavJson(supplied, 1048576), root = resolve(directory);
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['workspace','mappingId','merchantId','reviewer','note','dataset','projection','title'].includes(key))
      || typeof input.workspace !== 'string' || typeof input.reviewer !== 'string' || !input.reviewer.trim()
      || !input.dataset || typeof input.dataset !== 'object' || Array.isArray(input.dataset))
    throw webDavError('WEBDAV_EXAMPLE_INPUT', 'Review workspace, mappingId, merchantId, reviewer and the full dataset contract.');
  webDavUuid(input.mappingId); webDavUuid(input.merchantId);
  try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(root);
  if (await realpath(root) !== root) throw webDavError('WEBDAV_EXAMPLE_DIRECTORY', 'Use the canonical private operation directory.');
  const lease = await acquireStateLease(root), options = { requestSignal: signal };
  let failure;
  try {
    const opened = await client.open({ workspace: input.workspace }, options);
    await retain(join(root, 'reviewed-input.json'), {
      schema: 'stellar-forge.webdav-reviewed-edition-input.v1',
      endpoint: client.endpoint, workspaceId: opened.native.id, input
    });
    async function step(name, tool, args) {
      lease.assertHeld(); const directory = join(root, name);
      let record;
      try { record = await inspectWebDavOperation({ directory }); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        record = await prepareWebDavOperation({ client, directory, tool, args }, options);
      }
      if (record.tool !== tool || webDavCanonical(originalArguments(record.args)) !== webDavCanonical(args))
        throw webDavError('WEBDAV_EXAMPLE_SELECTION_CHANGED', 'This saved step belongs to different reviewed input.');
      const result = await runWebDavOperation({ client, directory }, options);
      if (result.state !== 'COMPLETE') {
        const error = webDavError('WEBDAV_EXAMPLE_CONTINUE_ORIGINAL', 'Continue the returned original operation before this workflow advances.');
        error.operation = result; throw error;
      }
      return result.lastNative.result;
    }
    const selected = await client.operation({ workspace: input.workspace, kind: 'mapping', id: input.mappingId }, options);
    const projection = input.projection ?? selected.projection;
    await step('01-sample', 'merchant_webdav_capture', {
      workspace: input.workspace, action: 'sample', captureId: selected.captureId,
      format: projection.format, recordsPointer: projection.recordsPointer ?? '', limit: 10
    });
    const mapping = await step('02-mapping', 'merchant_webdav_mapping', {
      workspace: input.workspace, captureId: selected.captureId,
      expectedCaptureSha256: selected.captureSha256, projection
    });
    const edition = await step('03-edition', 'merchant_webdav_edition', {
      workspace: input.workspace, action: 'build', mappingId: mapping.id, dataset: input.dataset,
      review: { reviewer: input.reviewer, decision: 'approve', note: input.note ?? '',
        expectedCaptureSha256: mapping.captureSha256, projectionHash: mapping.projectionHash }
    });
    const preview = await client.preview({ workspace: input.workspace, editionId: edition.id, query: 'limit=5' }, options);
    const exported = await step('04-export', 'merchant_webdav_edition', {
      workspace: input.workspace, action: 'export', editionId: edition.id, merchantId: input.merchantId,
      reviewer: input.reviewer, note: input.note ?? ''
    });
    const publisher = await step('05-publisher', 'merchant_webdav_publisher', {
      workspace: input.workspace, action: 'publisher.prepare',
      payload: { exportId: exported.id, title: input.title ?? input.dataset.name }
    });
    const packet = await step('06-source-packet', 'merchant_webdav_packet', { workspace: input.workspace });
    const packetOperation = await inspectWebDavOperation({ directory: join(root, '06-source-packet') });
    async function receive(name, selection) {
      const path = join(root, name + '-plan.json');
      let manifest;
      try { manifest = await readPrivateJson(path, 8 * 1024 * 1024); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const prepared = await prepareWebDavReceiving({ client, workspace: input.workspace, ...selection }, options);
        manifest = await retain(path, prepared.manifest);
      }
      if (manifest.endpoint !== client.endpoint || manifest.workspaceId !== opened.native.id
          || manifest.workspace !== input.workspace
          || selection.exportId && (manifest.source.mode !== 'export' || manifest.source.id !== selection.exportId)
          || selection.files && (manifest.source.mode !== 'files' || manifest.files.length !== selection.files.length
            || manifest.files.some((file, index) => file.name !== selection.files[index].name
              || webDavCanonical(file.selector) !== webDavCanonical(selection.files[index].selector))))
        throw webDavError('WEBDAV_EXAMPLE_SELECTION_CHANGED', 'Reopen the original saved export or packet selection.');
      const result = await downloadWebDavReceiving({ client, manifest, directory: join(root, name),
        signal, onProgress });
      await inspectWebDavReceiving({ directory: result.directory, expectedManifestSha256: result.manifestSha256, signal });
      return result;
    }
    const exportReceiving = await receive('merchant-export', { exportId: exported.id });
    const sourceReceiving = await receive('source-packet', {
      files: [{ name: 'source-packet.zip', selector: { kind: 'packet', id: packetOperation.id } }]
    });
    const result = { schema: 'stellar-forge.webdav-reviewed-edition-result.v1', state: 'COMPLETE',
      directory: root, workspace: input.workspace, workspaceId: opened.native.id,
      mappingId: mapping.id, editionId: edition.id, exportId: exported.id, productId: publisher.productId,
      packetOperationId: packetOperation.id, packet, preview, exportReceiving, sourceReceiving };
    lease.assertHeld();
    // Current transport/replay metadata may change while the original source IDs remain fixed.
    // The complete result is returned; the source input and each native step stay retained.
    return result;
  } catch (error) { failure = error; throw error; }
  finally {
    try { await lease.close(); }
    catch (error) { if (!failure) throw error; failure.localLeaseError = { code: error.code, message: error.message }; }
  }
}

async function main(argv) {
  const values = Object.create(null);
  if (!argv.length || argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('webdav-reviewed-edition --url MCP_URL --input PRIVATE_REVIEW_JSON --directory PRIVATE_OPERATION [--token-env NAME]\n');
    return;
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--url','--input','--directory','--token-env'].includes(key) || values[key] || !value || value.startsWith('--'))
      throw webDavError('WEBDAV_EXAMPLE_ARGUMENT', 'Use the declared complete operator example arguments.');
    values[key] = value;
  }
  for (const key of ['--url','--input','--directory'])
    if (!values[key]) throw webDavError('WEBDAV_EXAMPLE_ARGUMENT', key + ' is required.');
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const input = await readPrivateJson(resolve(values['--input']));
    const client = await createWebDavWorkspaceClient({ url: values['--url'], tokenEnv: values['--token-env'] ?? 'MCP_ACCESS_TOKEN', signal: controller.signal });
    const result = await receiveReviewedWebDavEdition({ client, input, directory: values['--directory'],
      signal: controller.signal, onProgress: value => process.stderr.write(JSON.stringify(value) + '\n') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'WEBDAV_EXAMPLE_FAILED', message: error.message },
      ...(error.operation ? { operation: error.operation } : {}),
      ...(error.nativeResult ? { nativeResult: error.nativeResult } : {}),
      ...(error.nativeEnvelope ? { nativeEnvelope: error.nativeEnvelope } : {}) }) + '\n');
    process.exitCode = 2;
  });
