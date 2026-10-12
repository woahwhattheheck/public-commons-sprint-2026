#!/usr/bin/env node
// MIT. Complete native concentration source -> original merchant MCP receiving.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, readFile, lstat } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { privateDirectory, readPrivateJson, withPrivateLock } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/routescan/quota.mjs';
import { writeBytes } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import { openWaterQualityProject } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/project.mjs';
import { openWatersHash, openWatersCanonical } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/openwaters.mjs';
import { normalizeReviewSheetDocument } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/model.mjs';
import { previewReviewSheet } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/workflow.mjs';
import { reviewWaterQualityManaged } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/managed.mjs';
import { CONCENTRATION_RECEIVING_SCHEMA } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/concentrations-receiving.mjs';

export const WQX_CONCENTRATION_MCP_RECEIVING_SCHEMA = 'stellar-forge.wqx-concentration-mcp-receiving.v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DRIVER = resolve(HERE, '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/concentrations-receiving.mjs');
const SHA = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b, message) => assert.equal(openWatersCanonical(a), openWatersCanonical(b), message);
const gc = () => globalThis.gc?.();
const retainedTransport = { request: async () => { throw new Error('Use the retained original Potomac source.'); } };
async function boundFile(path, maximum = 128 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum) && !(Number(before.mode) & 0o077),
      'Select a complete private regular operation member: ' + path);
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'The retained input changed.');
    assert(!named.isSymbolicLink() && named.dev === before.dev && named.ino === before.ino);
    return { path, bytes: bytes.length, sha256: digest(bytes), content: bytes };
  } finally { await handle.close(); }
}
async function maybe(path) {
  try { return await readPrivateJson(path, 128 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function immutable(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  await privateDirectory(dirname(path));
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const retained = await boundFile(path);
    assert.equal(retained.bytes, bytes.length); assert.equal(retained.sha256, digest(bytes),
      'This original operation member already contains different bytes.');
  }
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}
async function child(path, args, heap) {
  await new Promise((yes, no) => {
    const process = spawn(globalThis.process.execPath, ['--expose-gc', '--max-old-space-size=' + heap, path, ...args],
      { env: globalThis.process.env, stdio: 'inherit' });
    process.once('error', no); process.once('exit', (code, signal) => code === 0 ? yes() :
      no(new Error('The original receiving child ended: ' + (signal ?? code))));
  });
}
async function selected(configFile, expectedConfigSha256) {
  assert(SHA.test(expectedConfigSha256 ?? ''), 'Bind the exact retained original configuration SHA-256.');
  const file = await boundFile(configFile, 2 * 1024 * 1024);
  assert.equal(file.sha256, expectedConfigSha256, 'The original receiving configuration changed.');
  const raw = JSON.parse(file.content.toString('utf8'));
  assert.equal(raw.schema, CONCENTRATION_RECEIVING_SCHEMA);
  assert(ID.test(raw.operationId) && ID.test(raw.operationId + '-MCP'));
  assert(isAbsolute(raw.directory) && resolve(raw.directory) === raw.directory && raw.directory !== '/');
  const config = { ...raw, nodeHeapMiB: raw.nodeHeapMiB ?? 768 };
  const request = { schema: CONCENTRATION_RECEIVING_SCHEMA, configuration: config };
  const root = join(config.directory, 'mcp-receiving');
  await privateDirectory(root);
  const selection = { schema: WQX_CONCENTRATION_MCP_RECEIVING_SCHEMA, operationId: config.operationId,
    sourceRequestSha256: openWatersHash(request), configurationFile: configFile, configurationSha256: file.sha256,
    sourcePlanSha256: config.sourcePlanSha256, reviewSha256: config.reviewSha256, captureSha256: config.captureSha256 };
  await immutable(join(root, 'selection.json'), json(selection));
  return { config, configFile, expectedConfigSha256, root, selection };
}
async function prepare(value) {
  const { config, configFile, root, selection } = value;
  // This is the original source phase. Its bound SOURCE_PREPARED receipt is reused.
  await child(SOURCE_DRIVER, ['--config', configFile, '--phase', 'source'], config.nodeHeapMiB);
  const prepared = await maybe(join(config.directory, 'source-ready.json'));
  assert.equal(prepared?.status, 'SOURCE_PREPARED'); assert.equal(prepared.requestSha256, selection.sourceRequestSha256);
  assert.equal(prepared.sourcePlanSha256, config.sourcePlanSha256);
  assert.equal(prepared.reviewSha256, config.reviewSha256); assert.equal(prepared.captureSha256, config.captureSha256);
  const finalFile = await boundFile(join(config.directory, 'cli', 'decisions.json'));
  const published = prepared.files.find(row => row.file === finalFile.path);
  assert(published); assert.equal(published.bytes, finalFile.bytes); assert.equal(published.sha256, finalFile.sha256);
  const document = normalizeReviewSheetDocument(JSON.parse(finalFile.content.toString('utf8')));
  assert.equal(openWatersHash(document), prepared.documentSha256);
  const initialSource = await boundFile(join(config.directory, 'cli', 'draft-0.json'));
  const initial = normalizeReviewSheetDocument(JSON.parse(initialSource.content.toString('utf8')));
  assert.equal(initial.decisions.length, 0, 'Begin the exact original native CLI draft chain.');
  assert.equal(initial.sourcePlanSha256, config.sourcePlanSha256);
  const proposedFile = await boundFile(join(config.directory, 'cli', 'draft-4.json'));
  const proposed = normalizeReviewSheetDocument(JSON.parse(proposedFile.content.toString('utf8')));
  const kept = document.decisions.filter(row => row.action === 'keep');
  assert.equal(kept.length, 1); assert(kept[0].reason.includes('NTRU'));
  equal(normalizeReviewSheetDocument({ ...document, decisions: document.decisions.filter(row => row.action !== 'keep') }),
    proposed, 'The final reviewed table adds only the original optical Keep reason.');
  const tableFile = await boundFile(join(config.directory, 'cli', 'decisions.csv'));
  const publishedTable = prepared.files.find(row => row.file === tableFile.path);
  assert(publishedTable); assert.equal(publishedTable.sha256, tableFile.sha256); assert.equal(publishedTable.bytes, tableFile.bytes);
  const initialFile = await immutable(join(root, 'initial-document.json'), json(initial));
  let summary = prepared.newPlanSummary, bundle;
  const project = await openWaterQualityProject(join(config.directory, 'project'), { transport: retainedTransport });
  try {
    const plan = await project.readOpenWaters(config.sourcePlanId);
    assert.equal(plan.planSha256, config.sourcePlanSha256);
    assert.equal(plan.captureSha256, config.captureSha256); assert.equal(plan.reviewSha256, config.reviewSha256);
    if (!summary) {
      // An earlier accepted source receipt did not carry summary counts. Read the
      // same native preview to add those counts to this new child configuration.
      const preview = await previewReviewSheet({ project, document, newPlanId: config.newPlanId });
      assert.equal(preview.previewSha256, prepared.previewSha256);
      assert.equal(preview.newPlanSha256, prepared.newPlanSha256); summary = preview.plan.summary;
    }
    const output = await project.exportOpenWaters({ planId: config.sourcePlanId, format: 'bundle' });
    bundle = await immutable(join(root, 'source-bundle.json'), output.bytes);
  } finally { await project.close(); }
  gc();
  const operatorDirectory = join(root, 'operator');
  await privateDirectory(operatorDirectory); await privateDirectory(join(operatorDirectory, 'source-project'));
  const managed = await reviewWaterQualityManaged({ directory: join(operatorDirectory, 'source-project'), bundleFile: bundle.path });
  const operator = {
    schema: 'stellar-forge.wqx-operator-receiving.v1', operationId: config.operationId + '-MCP', directory: operatorDirectory,
    sourceBundle: bundle.path, expectedSourceBundleSha256: bundle.sha256,
    documentFile: finalFile.path, expectedDocumentFileSha256: finalFile.sha256, expectedDocumentSha256: prepared.documentSha256,
    sourcePlanId: config.sourcePlanId, expectedSourcePlanSha256: config.sourcePlanSha256,
    expectedReviewSha256: config.reviewSha256, expectedCaptureSha256: config.captureSha256,
    expectedManagedSourceSha256: managed.source.sha256,
    newPlanId: config.newPlanId, reviewId: config.reviewId, expectedNewPlanSha256: prepared.newPlanSha256,
    expectedPreviewSha256: prepared.previewSha256, expectedResults: config.sourceResults,
    expectedReadyResults: summary.readyResults, expectedReviewResults: summary.reviewResults,
    expectedLimits: config.originalLimits, expectedCensoredResults: config.limitOnlyCount,
    concentrations: {
      initialDocumentFile: initialFile.path, expectedInitialDocumentFileSha256: initialFile.sha256,
      expectedInitialDocumentSha256: openWatersHash(initial), targetUnit: config.targetUnit, reason: config.reason,
      selections: [...config.sourceGroups.map(row => ({ fromUnit: row.unit, expectedResults: row.count })),
        { reportedLimitsOnly: true, expectedResults: config.supportedLimitOnlyCount }],
      expectedSelectedResults: config.selectedResults, expectedLimitOnlyResults: config.supportedLimitOnlyCount,
      expectedLimitOnlySourceResults: config.limitOnlyCount, expectedReportedLimits: prepared.scientific.convertedReportedLimits,
      expectedReportSha256: prepared.reportSha256, expectedPreparedDocumentSha256: openWatersHash(proposed),
      finalTableFile: tableFile.path, expectedFinalTableFileSha256: tableFile.sha256,
    },
  };
  const file = await immutable(join(root, 'operator.json'), json(operator));
  const result = { ...selection, status: 'PREPARED', sourcePreparedAt: prepared.completedAt,
    sourceReportSha256: prepared.reportSha256, configuration: file, sourceBundle: bundle,
    expectedReadyResults: summary.readyResults, expectedReviewResults: summary.reviewResults };
  await immutable(join(root, 'prepared.json'), json(result)); return result;
}
async function receive(value) {
  const prepared = await maybe(join(value.root, 'prepared.json'));
  assert.equal(prepared?.status, 'PREPARED'); assert.equal(prepared.sourceRequestSha256, value.selection.sourceRequestSha256);
  const file = await boundFile(join(value.root, 'operator.json'));
  assert.equal(file.sha256, prepared.configuration.sha256); assert.equal(file.bytes, prepared.configuration.bytes);
  const configuration = JSON.parse(file.content.toString('utf8'));
  equal({ sourcePlanSha256: configuration.expectedSourcePlanSha256, reviewSha256: configuration.expectedReviewSha256,
    captureSha256: configuration.expectedCaptureSha256 }, {
    sourcePlanSha256: value.config.sourcePlanSha256, reviewSha256: value.config.reviewSha256, captureSha256: value.config.captureSha256 });
  const existing = await maybe(join(configuration.directory, 'receiving-result.json'));
  if (existing?.status === 'COMPLETE') {
    assert.equal(existing.operationId, configuration.operationId);
    assert.equal(existing.sourceBundle.sha256, configuration.expectedSourceBundleSha256);
    assert.equal(existing.documentSha256, configuration.expectedDocumentSha256);
    assert.equal(existing.newPlanSha256, configuration.expectedNewPlanSha256);
    assert.equal(existing.scientific.concentration.reportSha256, configuration.concentrations.expectedReportSha256);
    return { ...existing, reused: true };
  }
  const { receiveWqxOperator } = await import('./wqx-workspace-receiving.mjs');
  return receiveWqxOperator(configuration, { onProgress: stage => process.stderr.write(json(stage)) });
}
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    config: { type: 'string' }, 'expected-config-sha256': { type: 'string' },
    phase: { type: 'string', default: 'all' }, help: { type: 'boolean' },
  } });
  if (values.help || !values.config) {
    process.stdout.write('node wqx-concentrations-receiving.mjs --config ORIGINAL.json --expected-config-sha256 SHA256 [--phase prepare|receive|all]\n'); return;
  }
  const value = await selected(resolve(values.config), values['expected-config-sha256']);
  if (values.phase === 'all') {
    for (const phase of ['prepare', 'receive'])
      await child(fileURLToPath(import.meta.url), ['--config', value.configFile,
        '--expected-config-sha256', value.expectedConfigSha256, '--phase', phase], value.config.nodeHeapMiB);
    const result = await maybe(join(value.root, 'operator', 'receiving-result.json'));
    assert.equal(result?.status, 'COMPLETE');
    process.stdout.write(json({ status: result.status, operationId: value.config.operationId,
      result: join(value.root, 'operator', 'receiving-result.json'), scientific: result.scientific })); return result;
  }
  const phase = { prepare, receive }[values.phase]; assert(phase, 'Choose prepare, receive or all.');
  const result = await withPrivateLock(value.root, 'mcp-receiving.lock', () => phase(value));
  process.stdout.write(json({ status: result.status, operationId: value.config.operationId,
    phase: values.phase, sourceRequestSha256: value.selection.sourceRequestSha256 })); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(json({ error: error.code ?? 'WQX_CONCENTRATION_MCP_RECEIVING', message: error.message })); process.exitCode = 1; });
