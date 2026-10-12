#!/usr/bin/env node
// MIT. One receiving continuation over an already adopted native upgrade and preparation.
import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const required = (value, message) => { if (!value) throw new Error(message); return value; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** The original native owner supplies the same running workspace, adopted review and prepared customer. */
export async function runGrpcUpgradeAgentReceiving({ sourceRoot, sourceCommit, directory,
  consoleUrlFile, reviewId, preparationId, environment = process.env, applicationCalls,
  client: suppliedClient, workspaceAlias = 'upgrade' } = {}) {
  sourceRoot = resolve(required(sourceRoot, 'Supply the complete selected source root.'));
  directory = resolve(required(directory, 'Supply this original receiving output directory.'));
  consoleUrlFile = resolve(required(consoleUrlFile, 'Supply the original running workspace URL file.'));
  required(/^[a-f0-9]{40}$/.test(sourceCommit ?? ''), 'Supply the selected source commit.');
  const imported = path => import(pathToFileURL(join(sourceRoot, path)).href);
  const native = 'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/';
  const merchantPath = 'stellar-forge/mcp-merchant-operator/';
  const [{ canonical }, { atomicJson }, { upgradeMain }, { downloadGrpcUpgrade },
    { downloadGrpcExport }, { initializeGrpcWorkspaceMerchant }, { startMerchantMcp },
    { openMerchantFileClient }] = await Promise.all([
    imported(native + 'common.mjs'), imported('stellar/scf-starforge-20261009/sf46-release/release-core.mjs'),
    imported(native + 'upgrade-cli.mjs'), imported(merchantPath + 'grpc-upgrade-download.mjs'),
    imported(merchantPath + 'grpc-workspace-download.mjs'), imported(merchantPath + 'config.mjs'),
    imported(merchantPath + 'serve.mjs'), imported(merchantPath + 'retained-download.mjs'),
  ]);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const recordPath = join(directory, 'upgrade-agent-receiving.json');
  let record;
  try { record = JSON.parse(await readFile(recordPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (record) required(record.reviewId === reviewId && record.preparationId === preparationId,
    'Resume the same original review and preparation.');
  else record = { schema: 'stellar-forge.grpc-upgrade-agent-receiving.v1', operationId: randomUUID(),
    reviewId, preparationId, startedAt: new Date().toISOString(), sourceHistory: [] };
  if (record.state === 'COMPLETE') return record;
  if (record.sourceCommit && record.sourceCommit !== sourceCommit) record.sourceHistory.push(record.sourceCommit);
  record.sourceCommit = sourceCommit; record.state = 'STARTED';
  for (const field of ['error', 'closeError', 'applicationCallsError', 'checkpointError', 'completedAt', 'merchantClosed'])
    delete record[field];
  const checkpoint = () => atomicJson(recordPath, record);
  await checkpoint();
  const silent = { write() {} };
  const cli = args => upgradeMain([...args, '--console-url-file', consoleUrlFile], { stdout: silent });
  const exact = (a, b, message) => required(canonical(a) === canonical(b), message);
  let merchant, client = suppliedClient, failure, callsBefore, received = false;
  record.ownsMerchant = false;
  const failed = (error, field = 'error') => {
    record.state = 'INTERRUPTED'; record[field] = { code: error.code ?? error.message };
    record.error ??= record[field]; failure ??= error;
  };
  try {
    callsBefore = applicationCalls?.();
    const original = await cli(['open', '--id', reviewId, '--section', 'full']);
    required(original.adoption && original.planValidation.valid, 'Continue an original completed valid adoption.');
    const revision = original.adoption.revision;
    record.reviewSha256 = original.reviewSha256; record.revision = revision;
    record.sourceFiles = await Promise.all(['grpc-upgrades.mjs', 'grpc-workspace.mjs', 'grpc-upgrade-download.mjs']
      .map(async path => ({ path: merchantPath + path, sha256: hash(await readFile(join(sourceRoot, merchantPath, path))) })));
    required(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspaceAlias), 'Use the original configured workspace alias.');
    if (!client) {
      const connectionPath = join(directory, 'connection.json'), configPath = join(directory, 'merchant-agent', 'merchant-mcp.json');
      try { await access(connectionPath); }
      catch { await atomicJson(connectionPath, { schema: 'stellar-forge.grpc-workspace-connection.v1',
        workspaces: { [workspaceAlias]: { consoleUrlFile } } }, { exclusive: true }); }
      try { await access(configPath); }
      catch { await initializeGrpcWorkspaceMerchant({ directory: join(directory, 'merchant-agent'), connection: connectionPath }); }
      const env = { ...environment, GRPC_UPGRADE_MCP_TOKEN: randomBytes(32).toString('hex') };
      merchant = await startMerchantMcp({ configPath, port: record.mcpPort ?? 0,
        tokenEnv: 'GRPC_UPGRADE_MCP_TOKEN', environment: env });
      record.ownsMerchant = true; record.merchantClosed = false;
      record.mcpPort = Number(new URL(merchant.url).port); await checkpoint();
      client = await openMerchantFileClient({ url: merchant.url, tokenEnv: 'GRPC_UPGRADE_MCP_TOKEN', environment: env });
    }
    required(typeof client.call === 'function' && typeof client.endpoint === 'string', 'Use the original initialized retained-file MCP client.');
    record.workspaceAlias = workspaceAlias; record.ownsMerchant = Boolean(merchant);
    const call = (name, args = {}) => client.call('merchant_grpc_' + name, { workspace: workspaceAlias, ...args }, { timeoutMs: 60000 });
    const receiveFull = async (value, name) => {
      if (value.state !== 'COMPLETE_RESULT_RETAINED') return value;
      const delivery = value.delivery;
      const received = await downloadGrpcExport({ client, exportId: delivery.exportId,
        expectedManifestSha256: delivery.manifestFile.sha256, directory: join(directory, name + '-' + delivery.exportId) });
      return JSON.parse(await readFile(join(received.directory, 'grpc-result.json'), 'utf8'));
    };
    const initialSelection = await call('status');
    const repeated = await call('upgrade_review', { operationId: reviewId,
      baseRevision: original.request.baseRevision, candidate: original.request.candidate,
      plan: original.request.plan, title: original.request.title });
    required(repeated.reviewSha256 === original.reviewSha256, 'The original review changed during same-ID recovery.');
    let reviewOffset = 0, reviewSnapshot, found = false;
    do {
      const reviews = await call('upgrade_reviews', { limit: 250, offset: reviewOffset,
        ...(reviewSnapshot ? { expectedSnapshot: reviewSnapshot } : {}) });
      reviewSnapshot ??= reviews.snapshot; found ||= reviews.items.some(row => row.id === reviewId);
      reviewOffset = reviews.nextOffset;
    } while (reviewOffset !== null);
    required(found, 'The original upgrade index lost this retained review.');
    const receivedPlan = await receiveFull(await call('upgrade_open', { operationId: reviewId, section: 'plan' }), 'plan');
    exact(receivedPlan.plan, original.request.plan, 'Agent plan changed its original complete values.');
    const paged = {};
    for (const section of ['changes', 'methods', 'routes']) {
      let offset = 0, expectedSnapshot; const rows = [];
      do {
        const page = await receiveFull(await call('upgrade_open', { operationId: reviewId, section,
          offset, limit: 5, ...(expectedSnapshot ? { expectedSnapshot } : {}) }), section + '-' + offset);
        expectedSnapshot ??= page.snapshot; rows.push(...page.items); offset = page.nextOffset;
      } while (offset !== null);
      exact(rows, section === 'routes' ? original.routes.rows : original.comparison[section],
        'A complete native upgrade section changed during paging.');
      paged[section] = rows.length;
    }
    const method = original.request.plan.routes[0].grpcMethod;
    const candidateMethod = await receiveFull(await call('upgrade_method', { operationId: reviewId, method }), 'method');
    exact(candidateMethod, await cli(['method', '--id', reviewId, '--method', method]),
      'Agent and CLI read different native candidate schemas.');
    const adopted = await call('upgrade_adopt', { operationId: reviewId, expectedReviewSha256: original.reviewSha256 });
    required(adopted.adoption.revision === revision && adopted.revision.revision === revision,
      'Repeated native adoption selected another revision.');
    const cliAdopted = await cli(['adopt', '--id', reviewId, '--review-sha', original.reviewSha256]);
    required(cliAdopted.adoption.revision === revision, 'CLI adoption did not recover the same original result.');
    const afterSelection = await call('status');
    exact([afterSelection.currentRevision, afterSelection.generation],
      [initialSelection.currentRevision, initialSelection.generation], 'Recovering the completed adoption changed selection.');
    record.agent = { reviewSha256: original.reviewSha256, method, paged, recoveredRevision: revision };
    await checkpoint();

    record.upgradeExport ??= await call('upgrade_export', { operationId: reviewId, expectedReviewSha256: original.reviewSha256 });
    await checkpoint();
    const receiving = { client, exportId: record.upgradeExport.exportId,
      expectedManifestSha256: record.upgradeExport.manifestFile.sha256,
      expectedReviewSha256: original.reviewSha256, directory: join(directory, 'upgrade-received'),
      chunkSize: 1024, verifyNative: true };
    if (!record.interrupted) {
      try {
        await downloadGrpcUpgrade({ ...receiving, onProgress: () => {
          throw Object.assign(new Error('Intentional receiving interruption after a durable prefix.'), { code: 'GRPC_RECEIVING_INTERRUPTED_ONCE' });
        } });
      } catch (error) {
        if (error.code !== 'GRPC_RECEIVING_INTERRUPTED_ONCE') throw error;
        record.interrupted = true; await checkpoint();
      }
    }
    const resumed = await downloadGrpcUpgrade(receiving), repeatedReceiving = await downloadGrpcUpgrade(receiving);
    required(resumed.state === 'COMPLETE' && repeatedReceiving.state === 'COMPLETE' &&
      repeatedReceiving.files === 4 && repeatedReceiving.upgrade.targetRevision === revision &&
      resumed.resumedBytes > 0, 'Original four-file receiving did not resume and reopen.');
    record.receiving = { exportId: repeatedReceiving.exportId, manifestSha256: repeatedReceiving.manifestSha256,
      files: repeatedReceiving.nativeFiles, bytes: repeatedReceiving.bytes, resumedBytes: resumed.resumedBytes,
      nativeCompiled: repeatedReceiving.upgrade.nativeCompiled };
    const cliDirectory = join(directory, 'cli-received');
    const cliReceived = await cli(['export', '--id', reviewId, '--review-sha', original.reviewSha256, '--out', cliDirectory]);
    await cli(['export', '--id', reviewId, '--review-sha', original.reviewSha256, '--out', cliDirectory]);
    const inspected = await upgradeMain(['inspect', '--directory', cliDirectory, '--review-sha', original.reviewSha256], { stdout: silent });
    required(inspected.nativeCompiled && inspected.targetRevision === revision && cliReceived.files.length === 4,
      'CLI export and native reopening did not retain the same complete upgrade.');
    record.cli = { directory: cliDirectory, files: cliReceived.files, nativeCompiled: inspected.nativeCompiled };
    await checkpoint();

    record.customerExport ??= await call('export', { kind: 'customer', preparation: preparationId });
    await checkpoint();
    required(record.customerExport.original.revision === revision, 'Use the original customer prepared from this adopted revision.');
    const customerOptions = { client, exportId: record.customerExport.exportId,
      expectedManifestSha256: record.customerExport.manifestFile.sha256,
      directory: join(directory, 'customer'), chunkSize: 196608 };
    await downloadGrpcExport(customerOptions);
    const customer = await downloadGrpcExport(customerOptions);
    required(customer.files === 7 && customer.nativeFiles.includes('client/seller-client.mjs'),
      'The complete usable original seven-file customer layout was not received.');
    const sdk = await import(pathToFileURL(join(customer.directory, 'client/seller-client.mjs')).href);
    required(Object.keys(sdk).length > 0, 'The original received customer module did not load.');
    record.customer = { exportId: customer.exportId, manifestSha256: customer.manifestSha256,
      preparation: preparationId, revision, files: customer.nativeFiles, bytes: customer.bytes,
      exports: Object.keys(sdk) };
    received = true;
  } catch (error) {
    failed(error);
  } finally {
    if (merchant) {
      record.merchantClosed = false;
      try { await merchant.close(); record.merchantClosed = true; }
      catch (error) { failed(error, 'closeError'); }
    }
    if (applicationCalls) {
      try {
        record.applicationCalls = { before: callsBefore, after: applicationCalls() };
        required(record.applicationCalls.after === callsBefore, 'Review/receiving unexpectedly called an application method.');
      } catch (error) { failed(error, 'applicationCallsError'); }
    }
    if (received && !failure) {
      record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    }
    try { await checkpoint(); }
    catch (error) { failed(error, 'checkpointError'); }
  }
  if (failure) throw failure;
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = new Map(), args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    required(['--source-root', '--source-commit', '--out', '--console-url-file', '--review-id', '--preparation-id'].includes(args[index]) &&
      args[index + 1] && !values.has(args[index]), 'Use the declared original receiving arguments.');
    values.set(args[index], args[index + 1]);
  }
  runGrpcUpgradeAgentReceiving({ sourceRoot: values.get('--source-root'), sourceCommit: values.get('--source-commit'),
    directory: values.get('--out'), consoleUrlFile: values.get('--console-url-file'),
    reviewId: values.get('--review-id'), preparationId: values.get('--preparation-id') })
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { console.error(JSON.stringify({ error: error.code ?? error.message })); process.exitCode = 1; });
}
