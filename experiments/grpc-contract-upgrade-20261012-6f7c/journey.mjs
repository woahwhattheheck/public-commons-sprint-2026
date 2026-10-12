#!/usr/bin/env node
// MIT. One original Contract upgrade operator journey over the source-owned workspace.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, readdir, lstat, realpath, rename, symlink} from 'node:fs/promises';
import {join, resolve, relative, dirname, sep} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1] || flags.has(process.argv[i])) throw Error('Expected unique --name value arguments.');
  flags.set(process.argv[i], process.argv[i + 1]);
}
const required = name => { const value = flags.get(name); if (!value) throw Error('Missing ' + name); return resolve(value); };
const sourceRoot = required('--source'), patches = required('--patches'), workRoot = required('--work-root');
const nodeModules = required('--node-modules'), chrome = required('--chrome'), playwrightPath = required('--playwright');
const OPERATION = 'SCF-GRPC-CONTRACT-UPGRADE-20261012-6F7C';
const PREFIX = 'stellar/scf-starforge-20261009/';
const GRPC = PREFIX + 'sf30-seller-sdk/grpc/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const plain = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) :
  Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
    '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const now = () => new Date().toISOString();
const result = {operation: OPERATION, startedAt: now(), state: 'RUNNING', phases: [], source: null,
  applicationCalls: 0, paymentRequests: 0, chainTransactions: 0, closed: {}, checkpoint: null};
let browser, context, workspace, upstream, acceptedSource = false;
const outputPaths = [];
const errors = [];
const child = (command, args, options = {}) => new Promise((done, reject) => {
  const process = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], ...options});
  let stdout = '', stderr = '';
  process.stdout.on('data', bytes => { stdout += bytes; });
  process.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
  process.once('error', reject);
  process.once('close', code => code === 0 ? done({stdout, stderr}) : reject(Object.assign(Error(command + ' exited ' + code + ': ' + stderr), {code})));
});
async function regular(path, limit = 32 * 1024 * 1024) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= limit, 'Expected a bounded original regular file: ' + path);
  const bytes = await readFile(path), after = await lstat(path);
  assert(info.dev === after.dev && info.ino === after.ino && info.size === after.size &&
    info.mtimeMs === after.mtimeMs && info.ctimeMs === after.ctimeMs && bytes.length === info.size, 'Source changed during read.');
  return bytes;
}
async function save(name, value) {
  const path = join(workRoot, name); await mkdir(dirname(path), {recursive: true, mode: 0o700});
  await writeFile(path, Buffer.isBuffer(value) ? value : plain(value), {mode: 0o600});
  if (!outputPaths.includes(name)) outputPaths.push(name);
  return path;
}
async function mark(name, details) {
  result.phases.push({name, completedAt: now(), ...details});
  await save('result.json', result);
  console.log(JSON.stringify({phase: name, ...details}));
}
async function sourceSelection() {
  const record = process.env.SWARM_NATIVE_RECORD, host = process.env.SWARM_NATIVE_HOST_ROOT;
  assert(record && host, 'Use the original checkpoint-capable native supervisor.');
  const request = JSON.parse(await regular(join(record, 'request.json')));
  assert.equal(request.intent?.operation_id, OPERATION);
  assert.equal(await realpath(request.intent.project), await realpath(workRoot));
  assert.equal(dirname(sourceRoot), dirname(workRoot), 'Keep the complete source in the same original private placement lifetime.');
  assert(!resolve(record).startsWith(workRoot + sep), 'Retain the native operation record outside its private project.');
  const selection = JSON.parse(await regular(join(patches, 'selection.json'), 4 * 1024 * 1024));
  assert.equal(selection.operation, OPERATION);
  assert(sourceRoot !== patches && !sourceRoot.startsWith(patches + sep) && !patches.startsWith(sourceRoot + sep));
  assert(workRoot !== sourceRoot && !sourceRoot.startsWith(workRoot + sep) && !workRoot.startsWith(sourceRoot + sep));
  for (const entry of selection.patches) {
    assert(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
    const bytes = await regular(join(patches, 'files', entry.path));
    assert.equal(blob(bytes), entry.sha, entry.path);
    const target = join(sourceRoot, entry.path);
    let old;
    try { old = await regular(target); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    if (old) assert(entry.before === blob(old) || entry.sha === blob(old), 'Keep the selected source before patching: ' + entry.path);
    else assert.equal(entry.before, null, 'A selected original file is missing: ' + entry.path);
    if (!old || blob(old) !== entry.sha) {
      await mkdir(dirname(target), {recursive: true, mode: 0o700});
      await writeFile(target, bytes, {mode: 0o644});
    }
  }
  const inventory = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), key = relative(sourceRoot, path).split(sep).join('/');
      if (key === 'node_modules' || key === '.git') continue;
      const info = await lstat(path);
      if (info.isDirectory()) await walk(path);
      else {
        const bytes = await regular(path);
        assert.equal(blob(bytes), selection.files[key], 'Select the exact published file: ' + key);
        inventory.push({path: key, sha: blob(bytes), bytes: bytes.length, sha256: hash(bytes)});
      }
    }
  }
  await walk(sourceRoot);
  for (const entry of selection.patches) assert(inventory.some(row => row.path === entry.path && row.sha === entry.sha));
  const moduleLink = join(sourceRoot, 'node_modules');
  try { assert.equal(await realpath(moduleLink), await realpath(nodeModules)); }
  catch (issue) { if (issue.code !== 'ENOENT') throw issue; await symlink(nodeModules, moduleLink, 'dir'); }
  result.source = {commit: selection.commit, files: inventory.length, bytes: inventory.reduce((sum, row) => sum + row.bytes, 0),
    inventorySha256: hash(canonical(inventory))};
  await save('executed-source.json', {...result.source, inventory, patches: selection.patches});
  return selection;
}
async function checkpoint(label) {
  const record = process.env.SWARM_NATIVE_RECORD, host = process.env.SWARM_NATIVE_HOST_ROOT;
  assert(record && host, 'Use the original checkpoint-capable native supervisor.');
  const paths = ['result.json', 'executed-source.json'];
  for (const name of ['inputs', 'workspace', 'downloads', 'captures', 'operator']) {
    try { if ((await lstat(join(workRoot, name))).isDirectory()) paths.push(name); }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  }
  const code = 'import json,os,sys\nfrom pathlib import Path\nsys.path.insert(0,os.environ["SWARM_NATIVE_HOST_ROOT"])\nfrom native_artifact_checkpoints import capture\nvalue=capture(Path(os.environ["SWARM_NATIVE_RECORD"]),sys.argv[1],json.loads(sys.argv[2]),label=sys.argv[3])\nprint(json.dumps(value),flush=True)\n';
  const response = await child('python3', ['-B', '-c', code, label + '-' + randomUUID(), JSON.stringify(paths), label], {cwd: workRoot});
  const value = JSON.parse(response.stdout.trim().split('\n').at(-1));
  assert.equal(value.state, 'complete', 'Retain the complete private result before ending its native lifetime.');
  return value;
}
try {
  const selection = await sourceSelection(); acceptedSource = true;
  await mkdir(join(workRoot, 'inputs'), {recursive: true, mode: 0o700});
  await mkdir(join(workRoot, 'downloads'), {recursive: true, mode: 0o700});
  await mkdir(join(workRoot, 'captures'), {recursive: true, mode: 0o700});
  const load = path => import(pathToFileURL(join(sourceRoot, path)).href);
  const {captureProtoSource, compileProtoSource} = await load(GRPC + 'proto.mjs');
  const {compareGrpcContracts} = await load(GRPC + 'contract-upgrade.mjs');
  const {startGrpcWorkspace} = await load(GRPC + 'workspace/server.mjs');
  const {readGrpcPrepared, CUSTOMER_FILES} = await load(GRPC + 'prepare.mjs');
  const {inspectRelease} = await load(PREFIX + 'sf82-seller-pilot/releases.mjs');
  const grpc = (await import(pathToFileURL(join(nodeModules, '@grpc/grpc-js/build/src/index.js')).href)).default;
  const playwright = await import(pathToFileURL(join(playwrightPath, 'index.mjs')).href);

  const originalText = (await regular(join(sourceRoot, GRPC + 'examples/proto/analytics.proto'))).toString('utf8');
  const candidateText = originalText
    .replace('string day = 2;', 'string business_day = 2;')
    .replace('optional string cursor = 5;', 'oneof continuation { string cursor = 5; string page_token = 6; }')
    .replace('int64 observed_sequence = 4;', 'int64 ledger_sequence = 4;')
    .replace('optional string note = 7;', 'optional string note = 7;\n  optional string source_release = 8;\n  Rollout rollout = 9;') +
    '\nenum Rollout { ROLLOUT_UNSPECIFIED = 0; CANARY = 1; ACTIVE = 2; }\n';
  assert.notEqual(candidateText, originalText);
  await mkdir(join(workRoot, 'inputs/candidate-proto'), {recursive: true, mode: 0o700});
  await writeFile(join(workRoot, 'inputs/candidate-proto/analytics.proto'), candidateText, {mode: 0o600});
  const oldProto = await captureProtoSource({directory: join(sourceRoot, GRPC + 'examples/proto'), entrypoints: ['analytics.proto']});
  const newProto = await captureProtoSource({directory: join(workRoot, 'inputs/candidate-proto'), entrypoints: ['analytics.proto']});
  const oldContract = compileProtoSource(oldProto), newContract = compileProtoSource(newProto);
  const comparison = compareGrpcContracts(oldContract, newContract);
  assert.equal(canonical(comparison), canonical(compareGrpcContracts(oldContract, newContract)));
  const renamedInput = comparison.changes.find(row => row.kind === 'field_name_changed' && row.before === 'day' && row.after === 'business_day');
  const renamedOutput = comparison.changes.find(row => row.kind === 'field_name_changed' && row.before === 'observed_sequence' && row.after === 'ledger_sequence');
  assert(renamedInput && renamedOutput);
  const methodPath = '/stellarforge.analytics.v1.Analytics/Summary';
  const affected = comparison.methods.find(row => row.path === methodPath);
  assert(affected.requestChanges.includes(renamedInput.id) && !affected.responseChanges.includes(renamedInput.id));
  assert(affected.responseChanges.includes(renamedOutput.id) && !affected.requestChanges.includes(renamedOutput.id));
  assert(comparison.changes.some(row => row.kind === 'oneof_constraints_changed'));
  await save('inputs/original-proto.json', oldProto); await save('inputs/candidate-proto.json', newProto);
  await save('inputs/native-comparison.json', comparison);

  const nativeServer = new grpc.Server();
  const calls = [];
  nativeServer.addService(grpc.loadPackageDefinition(newContract.definition).stellarforge.analytics.v1.Analytics.service, {
    summary(call, callback) {
      if (call.metadata.get('authorization')[0] !== 'included-contract-upgrade-example')
        return callback({code: grpc.status.UNAUTHENTICATED, details: 'Original example authorization mismatch.'});
      calls.push(structuredClone(call.request));
      callback(null, {record_id: call.request.account_id, amount: '42.0000001',
        evidence: Buffer.from('actual-native-contract-upgrade').toString('base64'),
        ledger_sequence: '-9223372036854775808',
        attributes: {business_day: call.request.business_day}, items: [],
        source_release: 'candidate-v2', rollout: 'ACTIVE'});
    },
    watch(call) { call.destroy(Object.assign(Error('This upgrade journey selects the unary route only.'), {code: grpc.status.UNIMPLEMENTED})); },
  });
  const port = await new Promise((done, reject) => nativeServer.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
    (issue, value) => issue ? reject(issue) : done(value)));
  upstream = {close: () => new Promise(done => nativeServer.tryShutdown(done)), calls};
  const source = JSON.parse(await regular(join(sourceRoot, GRPC + 'examples/source.json')));
  source.target = '127.0.0.1:' + port;
  const originalPlan = JSON.parse(await regular(join(sourceRoot, GRPC + 'examples/merchant-plan.json')));
  const firstTerms = originalPlan.payment;
  delete originalPlan.payment;
  originalPlan.paymentOptions = [firstTerms, {...firstTerms, amount: '9007199254740993',
    asset: 'UNVERIFIED_DEMO_SECOND_ASSET', maxTimeoutSeconds: 90, extra: {purpose: 'documentation-only-upgrade'}}];
  const candidatePlan = structuredClone(originalPlan);
  candidatePlan.routes[0].example.business_day = candidatePlan.routes[0].example.day;
  delete candidatePlan.routes[0].example.day;
  await save('inputs/original-plan.json', originalPlan); await save('inputs/candidate-plan.json', candidatePlan);
  const workspaceOptions = {stateDirectory: join(workRoot, 'workspace'), port: 0, sellerPort: 0,
    operationsPort: 0, env: {...process.env, GRPC_DEMO_AUTHORIZATION: 'included-contract-upgrade-example'}};
  workspace = await startGrpcWorkspace(workspaceOptions);
  const model = workspace.model;
  const oldRevision = await model.save({source, protoSource: oldProto, plan: originalPlan, title: 'Original merchant', baseRevision: null});
  const candidate = await model.save({source, protoSource: newProto, plan: {...candidatePlan, routes: []},
    title: 'Retained candidate contract', baseRevision: oldRevision.id});
  await model.checkout({revision: oldRevision.id, baseRevision: candidate.id});
  assert.equal(calls.length, 0);
  await mark('native_contract_and_saved_candidate', {before: oldProto.sha256, candidate: newProto.sha256,
    changes: comparison.changes.length, requestChanges: affected.requestChanges.length, responseChanges: affected.responseChanges.length,
    nativeApplicationCalls: calls.length});

  browser = await playwright.chromium.launch({executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process',
      '--renderer-process-limit=1', '--js-flags=--max-old-space-size=128']});
  context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  const page = await context.newPage(), peer = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', issue => pageErrors.push(issue.message)); peer.on('pageerror', issue => pageErrors.push(issue.message));
  page.on('dialog', dialog => dialog.accept()); peer.on('dialog', dialog => dialog.accept());
  const idle = async selected => {
    await selected.waitForFunction(() => document.body.dataset.busy === 'false');
    const message = await selected.locator('#notice').textContent();
    assert.notEqual(await selected.locator('#notice').getAttribute('data-kind'), 'error', message);
  };
  await page.goto(workspace.url); await idle(page);
  await peer.goto(workspace.url); await idle(peer);
  await page.locator('nav button[data-view="upgrades"]').click();
  await page.getByRole('button', {name: 'Use current saved revision', exact: true}).click(); await idle(page);
  await page.locator('#upgrade-candidate').selectOption('revision:' + candidate.id);
  await page.locator('#upgrade-review').click(); await idle(page);
  const invalidId = await page.evaluate(origin => sessionStorage.getItem('stellar-forge.grpc-workspace:' + origin + ':last-upgrade'), workspace.origin);
  const invalidReview = await model.upgradeOpen({id: invalidId});
  assert.equal(invalidReview.planValidation.valid, false);
  assert.equal(invalidReview.routes.rows[0].sourceExampleOnCandidate.accepted, false);
  assert.equal(await page.locator('#upgrade-adopt').isDisabled(), true);
  assert.equal(calls.length, 0);
  await page.locator('#upgrade-plan').fill(plain(candidatePlan));
  await page.locator('nav button[data-view="source"]').click();
  await page.locator('nav button[data-view="upgrades"]').click();
  assert.equal(JSON.parse(await page.locator('#upgrade-plan').inputValue()).routes[0].example.business_day, '2026-10-11');
  await page.locator('#upgrade-review').click(); await idle(page);
  const staleId = await page.evaluate(origin => sessionStorage.getItem('stellar-forge.grpc-workspace:' + origin + ':last-upgrade'), workspace.origin);
  const stale = await model.upgradeOpen({id: staleId});
  assert.equal(stale.planValidation.valid, true);
  assert.equal(stale.routes.rows[0].paymentChanged, false);
  assert.equal(canonical(stale.routes.rows[0].before.paymentOptions), canonical(originalPlan.paymentOptions));
  assert.equal(canonical(stale.routes.rows[0].after.paymentOptions), canonical(originalPlan.paymentOptions));
  assert.equal(stale.routes.rows[0].selectedExample.accepted, true);
  await peer.locator('#title').fill('Second operator source title');
  await peer.locator('#save').click(); await idle(peer);
  const intervening = await model.state();
  await page.locator('#refresh').click(); await idle(page);
  assert.equal(await page.locator('#upgrade-adopt').isDisabled(), true);
  const beforeConflictGeneration = intervening.generation;
  await assert.rejects(model.upgradeAdopt({id: stale.id, expectedReviewSha256: stale.reviewSha256}),
    issue => issue.code === 'GRPC_WORKSPACE_REVISION_CONFLICT');
  assert.equal((await model.state()).generation, beforeConflictGeneration);
  await mark('real_two_window_review_and_conflict', {invalidReview: invalidId, reviewed: stale.id,
    interveningRevision: intervening.currentRevision, generation: intervening.generation, completeTermsPreserved: true, nativeApplicationCalls: calls.length});

  await page.getByRole('button', {name: 'Use current saved revision', exact: true}).click(); await idle(page);
  await page.locator('#upgrade-plan').fill(plain(candidatePlan));
  await page.locator('#upgrade-title').fill('Reviewed candidate merchant');
  await page.locator('#upgrade-review').click(); await idle(page);
  const finalId = await page.evaluate(origin => sessionStorage.getItem('stellar-forge.grpc-workspace:' + origin + ':last-upgrade'), workspace.origin);
  const finalReview = await model.upgradeOpen({id: finalId});
  assert.equal(finalReview.planValidation.valid, true);
  let droppedReply = false, adoptPosts = 0;
  await page.route('**/api/upgrade-adopt', async route => {
    adoptPosts++;
    const response = await route.fetch();
    if (!droppedReply) {
      assert.equal(response.status(), 200);
      assert.equal(route.request().postDataJSON().id, finalId);
      droppedReply = true; await route.abort('failed');
    } else await route.fulfill({response});
  });
  await page.locator('#upgrade-adopt').click(); await idle(page);
  assert(droppedReply);
  const afterSave = await model.state(), savedReview = await model.upgradeOpen({id: finalId});
  assert.equal(afterSave.generation, finalReview.baseSelection.generation + 1);
  assert(savedReview.adoption && savedReview.adoption.revision === afterSave.currentRevision);
  await page.locator('#refresh').click(); await idle(page);
  assert.equal(await page.locator('#upgrade-adopt').textContent(), 'Open saved upgrade');
  assert.equal(await page.locator('#upgrade-adopt').isDisabled(), false);
  await page.locator('#upgrade-reconcile').click(); await idle(page);
  assert.equal(adoptPosts, 1, 'A retained-outcome read sends no Save.');
  await page.locator('#upgrade-adopt').click(); await idle(page);
  assert.equal((await model.state()).generation, afterSave.generation, 'Completed reopening must not advance selection.');
  await page.unroute('**/api/upgrade-adopt');
  await page.locator('nav button[data-view="upgrades"]').click();
  await page.screenshot({path: await save('captures/upgrade-desktop.png', Buffer.alloc(0)), fullPage: true});
  const reviewDownload = page.waitForEvent('download');
  await page.locator('#upgrade-download').click();
  const reviewFile = await reviewDownload;
  await reviewFile.saveAs(join(workRoot, 'downloads/retained-upgrade.json'));
  const downloadedReview = JSON.parse(await regular(join(workRoot, 'downloads/retained-upgrade.json')));
  assert.equal(downloadedReview.reviewSha256, finalReview.reviewSha256);
  await save('inputs/final-reviewed-upgrade.json', savedReview);
  await mark('lost_save_reply_same_review_recovery', {review: finalId, reviewSha256: finalReview.reviewSha256,
    revision: afterSave.currentRevision, generation: afterSave.generation, nativeSaveTransitions: 1,
    readOnlyReconciliation: true, completeReportDownloaded: true});

  await page.locator('nav button[data-view="methods"]').click();
  await page.locator('#route-list').getByRole('button', {name: 'Edit route', exact: true}).click(); await idle(page);
  await page.locator('#call').click(); await idle(page);
  const operated = await model.state();
  assert.equal(operated.attempts.length, 1); assert.equal(calls.length, 1);
  const attempt = await model.readAttempt({id: operated.attempts[0].id});
  assert.equal(attempt.phase, 'COMPLETED');
  assert.equal(attempt.output.ledger_sequence, '-9223372036854775808');
  assert.equal(attempt.output.source_release, 'candidate-v2');
  assert.equal(attempt.output.rollout, 'ACTIVE');
  assert.equal(attempt.output.attributes.business_day, candidatePlan.routes[0].example.business_day);
  assert(!Object.hasOwn(attempt.output, 'observed_sequence'));
  assert.equal(canonical(attempt.input), canonical(candidatePlan.routes[0].example));
  await page.locator('#review').click(); await idle(page);
  await page.locator('#prepare').click(); await idle(page);
  const preparedState = await model.state();
  assert.equal(preparedState.prepared.length, 1);
  const retained = preparedState.prepared[0];
  const prepared = await readGrpcPrepared(join(workRoot, 'workspace/prepared', retained.id));
  assert.equal(prepared.manifest.protoSha256, newProto.sha256);
  assert.equal(canonical(prepared.plan.paymentOptions), canonical(originalPlan.paymentOptions));
  assert(prepared.methods.routes.summary.response.$defs);
  for (const filename of CUSTOMER_FILES) {
    const download = await model.download({id: retained.id, file: filename});
    assert.equal(hash(download.bytes), download.sha256);
    await save('downloads/customer/' + filename, download.bytes);
  }
  const archiveDownload = page.waitForEvent('download');
  await page.locator('#prepared').getByRole('button', {name: 'Customer client archive', exact: true}).click();
  const archiveFile = await archiveDownload; await archiveFile.saveAs(join(workRoot, 'downloads/grpc-customer-client.tar.gz')); await idle(page);
  const listed = await child('tar', ['-tzf', join(workRoot, 'downloads/grpc-customer-client.tar.gz')]);
  assert.deepEqual(listed.stdout.trim().split('\n').sort(), [...CUSTOMER_FILES].sort());
  await page.locator('#prepared').getByRole('textbox', {name: 'Release name', exact: true}).fill('reviewed-upgrade-v2');
  await page.locator('#prepared').getByRole('button', {name: 'Stage in release control', exact: true}).click(); await idle(page);
  const staged = await inspectRelease(join(workRoot, 'workspace/merchant-releases'), 'reviewed-upgrade-v2');
  assert.equal(staged.source.kind, 'GRPC_MERCHANT_PACKAGE');
  assert.equal(staged.grpc.protoSha256, newProto.sha256);
  await save('inputs/native-upgraded-call.json', attempt); await save('inputs/staged-release.json', staged);
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('nav button[data-view="upgrades"]').click();
  await page.screenshot({path: await save('captures/upgrade-mobile.png', Buffer.alloc(0)), fullPage: true});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The original industrial workspace must fit a narrow viewport.');
  assert.deepEqual(pageErrors, []);
  result.applicationCalls = calls.length;
  await mark('native_upgraded_method_customer_and_retained_release', {attempt: attempt.id, responseSha256: attempt.responseSha256,
    prepared: retained.id, customerFiles: CUSTOMER_FILES.length, release: staged.id, protoSha256: newProto.sha256,
    nativeApplicationCalls: calls.length, pageErrors: pageErrors.length});

  const {runGrpcUpgradeAgentReceiving} = await load('experiments/grpc-upgrade-agent-phase-20261012-9b23.mjs');
  const consoleUrlFile = join(workRoot, 'inputs/workspace.url');
  await writeFile(consoleUrlFile, workspace.url + '\n', {mode: 0o600});
  const receiving = await runGrpcUpgradeAgentReceiving({sourceRoot, sourceCommit: selection.commit,
    directory: join(workRoot, 'operator'), consoleUrlFile, reviewId: finalId, preparationId: retained.id,
    environment: workspaceOptions.env, applicationCalls: () => calls.length});
  assert.equal(receiving.state, 'COMPLETE');
  assert.equal(receiving.reviewSha256, finalReview.reviewSha256);
  assert.equal(receiving.revision, afterSave.currentRevision);
  assert.equal((await model.state()).generation, afterSave.generation);
  assert.equal(calls.length, 1);
  await mark('original_agent_cli_and_complete_upgrade_receiving', {review: finalId,
    reviewSha256: finalReview.reviewSha256, receivingOperation: receiving.operationId,
    exportId: receiving.receiving.exportId, nativeCompilerVerified: receiving.receiving.nativeCompiled,
    completeCustomer: receiving.customer, unchangedGeneration: afterSave.generation, nativeApplicationCalls: calls.length});

  await browser.close(); result.closed.browser = true; browser = null;
  await workspace.close(); result.closed.workspace = true; workspace = null;
  workspace = await startGrpcWorkspace(workspaceOptions);
  const reopened = await workspace.model.upgradeOpen({id: finalId});
  assert.equal(reopened.reviewSha256, finalReview.reviewSha256);
  assert.equal(reopened.adoption.revision, afterSave.currentRevision);
  assert.equal((await workspace.model.state()).generation, afterSave.generation);
  await workspace.model.upgradeAdopt({id: finalId, expectedReviewSha256: finalReview.reviewSha256});
  assert.equal((await workspace.model.state()).generation, afterSave.generation);
  assert.equal(upstream.calls.length, 1);
  await mark('original_workspace_reopen', {review: finalId, revision: afterSave.currentRevision,
    unchangedGeneration: afterSave.generation, nativeApplicationCalls: upstream.calls.length});
  result.state = 'COMPLETED';
} catch (issue) {
  errors.push({message: issue.message, code: issue.code ?? null, stack: issue.stack});
  result.state = 'FAILED';
} finally {
  for (const [name, resource] of [['browser', browser], ['workspace', workspace], ['upstream', upstream]]) {
    if (!resource) continue;
    try { await resource.close(); result.closed[name] = true; }
    catch (issue) { result.closed[name] = false; errors.push({stage: name + '_close', message: issue.message, code: issue.code ?? null}); }
  }
  if (upstream) result.applicationCalls = upstream.calls.length;
  if (errors.length) result.state = 'FAILED';
  result.errors = errors; result.finishedAt = now();
  if (acceptedSource) {
    try {
      await save('result.json', result);
      const retained = await checkpoint(result.state === 'COMPLETED' ? 'upgrade-completed' : 'upgrade-interrupted');
      result.checkpoint = retained;
      await save('checkpoint-receipt.json', retained);
      await save('result.json', result);
      // The exact checkpoint itself is durable under the original native record.
      console.log(JSON.stringify({operation: OPERATION, state: result.state, result, checkpoint: retained}));
    } catch (issue) {
      result.state = 'FAILED'; result.errors.push({stage: 'checkpoint', message: issue.message});
      console.error(JSON.stringify(result));
    }
  } else console.error(JSON.stringify(result));
  if (result.state !== 'COMPLETED') process.exitCode = 1;
}
