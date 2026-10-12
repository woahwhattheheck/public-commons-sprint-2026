#!/usr/bin/env node
// MIT. Retained Applications launch over the original water-quality workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, readPrivateJson, atomicJson, withPrivateLock } from '../routescan/quota.mjs';
import { openWaterQualityProject, operationId } from './project.mjs';
import { startWaterQualityWorkspace } from './workspace.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';

export const WQX_MANAGED_SCHEMA = 'stellar-forge.wqx-managed-startup.v1';
export const WQX_MANAGED_BINDING = 'managed-water-quality-binding.json';
export const WQX_MANAGED_LAUNCH = 'managed-water-quality-launch.json';
const STOP = 'managed-water-quality-stop.json';
const HERE = dirname(fileURLToPath(import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const MAX_BUNDLE = 128 * 1024 * 1024;
const SOURCE_FILES = [
  'managed.mjs', 'project.mjs', 'workspace.mjs', 'provider.mjs', 'samples.mjs',
  'analysis.mjs', 'openwaters.mjs', 'openwaters-contract.mjs', 'merchant.mjs',
  'ui/index.html', 'ui/app.mjs', 'ui/openwaters.mjs', 'ui/style.css', 'ui/review-sheet.mjs',
  'review-sheet/model.mjs', 'review-sheet/csv.mjs', 'review-sheet/workflow.mjs',
];
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(condition, code, message = code) {
  if (!condition) throw Object.assign(new Error(message), { code, status: 409 });
}
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' && !value.includes('\0'),
    'WQX_MANAGED_PATH_INVALID', 'Select an absolute project or input path.');
  return value;
}
function port(value) {
  need(Number.isSafeInteger(value) && value >= 0 && value <= 65535, 'WQX_MANAGED_PORT_INVALID');
  return value;
}
async function privateProjectDirectory(directory, { missing = false } = {}) {
  absolute(directory);
  need(await realpath(dirname(directory)) === dirname(directory), 'WQX_MANAGED_REAL_PARENT_REQUIRED');
  let info;
  try { info = await lstat(directory); }
  catch (error) {
    if (error.code !== 'ENOENT' || !missing) throw error;
    const parent = await lstat(dirname(directory));
    need(parent.isDirectory() && !(parent.mode & 0o077), 'WQX_MANAGED_PRIVATE_PARENT_REQUIRED');
    return;
  }
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(directory) === directory, 'WQX_MANAGED_PRIVATE_PROJECT_REQUIRED');
}
async function fileBinding(path, { max = 4 * 1024 * 1024, privateFile = false, content = false, optional = false } = {}) {
  absolute(path);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= max && await realpath(path) === path &&
      (!privateFile || before.nlink === 1 && !(before.mode & 0o077)),
    'WQX_MANAGED_FILE_INVALID', 'Select an original regular input file within the documented size limit.');
    const digest = createHash('sha256'), chunks = content ? [] : null;
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      bytes += chunk.length;
      need(bytes <= max, 'WQX_MANAGED_FILE_TOO_LARGE');
      digest.update(chunk); if (chunks) chunks.push(chunk);
    }
    const after = await handle.stat(), named = await lstat(path);
    need(bytes === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && before.dev === named.dev && before.ino === named.ino &&
      !named.isSymbolicLink(), 'WQX_MANAGED_INPUT_CHANGED');
    return { binding: { path, bytes, sha256: digest.digest('hex') },
      ...(chunks ? { bytes: Buffer.concat(chunks) } : {}) };
  } finally { await handle.close(); }
}
function parse(bytes) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function selectedRecord(path, type, id, bundleSelected) {
  if (!id) return null;
  operationId(id);
  const file = await fileBinding(path, { max: 64 * 1024 * 1024, privateFile: true, content: true, optional: bundleSelected });
  if (!file) return { id, pendingBundle: true };
  const value = parse(file.bytes);
  need(value[type === 'review' ? 'reviewId' : 'planId'] === id, 'WQX_MANAGED_RECORD_CHANGED');
  const sha256 = value[type === 'review' ? 'reviewSha256' : 'planSha256'];
  need(HASH.test(sha256 ?? ''), 'WQX_MANAGED_RECORD_CHANGED');
  return { id, sha256, file: file.binding };
}
function facilitatorUrl(raw, allowLocal) {
  if (!raw) return null;
  const url = new URL(raw);
  need(!url.username && !url.password && !url.search && !url.hash &&
    (url.protocol === 'https:' || allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1'),
  'WQX_MANAGED_FACILITATOR_INVALID', 'Select the existing HTTPS facilitator, or explicitly enable a loopback development facilitator.');
  return url.href.replace(/\/$/, '');
}
export async function reviewWaterQualityManaged({
  directory, bundleFile = null, buyerConfig = null, facilitator = null, allowLocalFacilitator = false,
  reviewId = null, planId = null, expectedSourceSha256, expectedSelectionSha256,
} = {}) {
  await privateProjectDirectory(directory, { missing: true });
  const files = [];
  for (const name of SOURCE_FILES) {
    const selected = await fileBinding(join(HERE, name));
    files.push({ path: name, bytes: selected.binding.bytes, sha256: selected.binding.sha256 });
  }
  const source = { files, sha256: hash(files) };
  if (expectedSourceSha256 !== undefined)
    need(HASH.test(expectedSourceSha256) && source.sha256 === expectedSourceSha256, 'WQX_MANAGED_SOURCE_CHANGED');
  const projectFile = await fileBinding(join(directory, 'project.json'),
    { max: 2 * 1024 * 1024, privateFile: true, content: true, optional: true });
  let project = null;
  if (projectFile) {
    const saved = parse(projectFile.bytes);
    need(saved.schema === 'starforge.wqx-water-quality-project.v1' &&
      Number.isSafeInteger(saved.revision) && saved.revision > 0 &&
      hash(JSON.stringify(saved.selection, null, 2) + '\n') === saved.selectionSha256,
    'WQX_MANAGED_PROJECT_CHANGED');
    project = { revision: saved.revision, title: saved.title, selectionSha256: saved.selectionSha256, file: projectFile.binding };
  }
  const bundle = bundleFile ? (await fileBinding(bundleFile, { max: MAX_BUNDLE })).binding : null;
  const buyer = buyerConfig ? await fileBinding(buyerConfig, { max: 1024 * 1024, privateFile: true, content: true }) : null;
  if (buyer) need(plain(parse(buyer.bytes)), 'WQX_MANAGED_BUYER_CONFIG_INVALID');
  const review = await selectedRecord(join(directory, 'reviews', (reviewId ?? 'unselected') + '.json'),
    'review', reviewId, Boolean(bundle));
  const plan = await selectedRecord(join(directory, 'open-waters', (planId ?? 'unselected') + '.json'),
    'plan', planId, Boolean(bundle));
  const selection = {
    directory, project, bundle, buyer: buyer?.binding ?? null,
    facilitator: facilitatorUrl(facilitator, allowLocalFacilitator), allowLocalFacilitator,
    review, plan,
  };
  const selectionSha256 = hash(selection);
  if (expectedSelectionSha256 !== undefined)
    need(HASH.test(expectedSelectionSha256) && selectionSha256 === expectedSelectionSha256,
      'WQX_MANAGED_SELECTION_CHANGED', 'Review the current project and selected original files before starting.');
  return { schema: 'stellar-forge.wqx-managed-review.v1', selection, selectionSha256, source };
}
function reviewArguments(review) {
  const value = review.selection;
  return { directory: value.directory, bundleFile: value.bundle?.path, buyerConfig: value.buyer?.path,
    facilitator: value.facilitator, allowLocalFacilitator: value.allowLocalFacilitator,
    reviewId: value.review?.id, planId: value.plan?.id,
    expectedSourceSha256: review.source.sha256, expectedSelectionSha256: review.selectionSha256 };
}
async function boundJson(binding, max, privateFile = false) {
  const selected = await fileBinding(binding.path, { max, privateFile, content: true });
  need(hash(selected.binding) === hash(binding), 'WQX_MANAGED_INPUT_CHANGED');
  return parse(selected.bytes);
}
function linksFor(url, reviewId, planId) {
  const links = [];
  if (reviewId) {
    for (const [format, label] of [['html', 'Scientific report'], ['json', 'Scientific review'], ['csv', 'Observation CSV'],
      ['geojson', 'Observation GeoJSON'], ['bundle', 'Complete source and review']])
      links.push({ label, url: url + '/api/reviews/' + reviewId + '/' + format });
  }
  if (planId) {
    for (const [format, label] of [['locations', 'Open Waters locations'], ['results', 'Open Waters results'],
      ['crosswalk', 'Source crosswalk'], ['report', 'Receiving report'], ['references', 'Reference data'],
      ['bundle', 'Complete Open Waters bundle']])
      links.push({ label, url: url + '/api/open-waters/' + planId + '/' + format });
  }
  return links;
}
export async function startManagedWaterQuality(review, {
  port: requestedPort = 0, merchantPort = 0, signal, onReady,
} = {}) {
  port(requestedPort); port(merchantPort);
  need(review?.schema === 'stellar-forge.wqx-managed-review.v1', 'WQX_MANAGED_REVIEW_REQUIRED');
  await reviewWaterQualityManaged(reviewArguments(review));
  await privateDirectory(review.selection.directory);
  let finish, resolveReady, rejectReady, workspace, closing;
  const stopRequested = new Promise(resolveStop => { finish = resolveStop; });
  const ready = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
  const stop = () => finish();
  signal?.addEventListener('abort', stop, { once: true });
  const done = withPrivateLock(review.selection.directory, 'managed-water-quality.lock', async () => {
    let launch;
    try {
      need(!signal?.aborted, 'WQX_MANAGED_STOP_REQUESTED');
      await reviewWaterQualityManaged(reviewArguments(review));
      let received = null;
      if (review.selection.bundle) {
        let bundle = await boundJson(review.selection.bundle, MAX_BUNDLE);
        const project = await openWaterQualityProject(review.selection.directory);
        try {
          if (bundle.schema === 'starforge.wqx-open-waters-bundle.v1') {
            await project.receiveOpenWaters({ bundle });
            received = { schema: bundle.schema, reviewId: bundle.plan.reviewId, planId: bundle.plan.planId,
              captureSha256: bundle.plan.captureSha256, bundleSha256: bundle.bundleSha256 };
          } else {
            need(bundle.schema === 'starforge.wqx-review-bundle.v1', 'WQX_MANAGED_NATIVE_BUNDLE_REQUIRED',
              'Select a complete native water-quality review or Open Waters receiving bundle.');
            const original = await project.receiveReviewBundle({ bundle });
            received = { schema: bundle.schema, reviewId: original.reviewId, planId: null,
              captureSha256: original.captureSha256, archiveSha256: original.archiveSha256 };
          }
        } finally { await project.close(); bundle = null; }
      }
      need(!signal?.aborted, 'WQX_MANAGED_STOP_REQUESTED');
      const buyer = review.selection.buyer
        ? await new Buyer(await boundJson(review.selection.buyer, 1024 * 1024, true)).ready() : null;
      workspace = await startWaterQualityWorkspace({
        directory: review.selection.directory, port: requestedPort, merchantPort,
        facilitator: review.selection.facilitator ?? undefined,
        allowLocalFacilitator: review.selection.allowLocalFacilitator, buyer,
      });
      const saved = await workspace.project.read();
      const selectedReviewId = review.selection.review?.id ?? received?.reviewId ?? null;
      const selectedPlanId = review.selection.plan?.id ?? received?.planId ?? null;
      const selectedReview = selectedReviewId ? await workspace.project.readReview(selectedReviewId) : null;
      const selectedPlan = selectedPlanId ? await workspace.project.readOpenWaters(selectedPlanId) : null;
      if (selectedPlan && selectedReview)
        need(selectedPlan.reviewId === selectedReview.reviewId && selectedPlan.reviewSha256 === selectedReview.reviewSha256,
          'WQX_MANAGED_REVIEW_PLAN_MISMATCH');
      let binding;
      try { binding = await readPrivateJson(join(review.selection.directory, WQX_MANAGED_BINDING)); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        binding = { schema: 'stellar-forge.wqx-managed-project.v1', id: randomUUID(),
          directory: review.selection.directory, createdAt: new Date().toISOString() };
        await atomicJson(review.selection.directory, WQX_MANAGED_BINDING, binding, { exclusive: true });
      }
      need(binding.schema === 'stellar-forge.wqx-managed-project.v1' && binding.directory === review.selection.directory,
        'WQX_MANAGED_PROJECT_BINDING_CHANGED');
      launch = {
        schema: WQX_MANAGED_SCHEMA, status: 'WQX_MANAGED_READY', launchId: randomUUID(),
        pid: process.pid, ppid: process.ppid, startedAt: new Date().toISOString(),
        directory: review.selection.directory, projectBindingId: binding.id,
        sourceSha256: review.source.sha256, selectionSha256: review.selectionSha256,
        projectRevision: saved?.revision ?? 0, projectSelectionSha256: saved?.selectionSha256 ?? null,
        reviewId: selectedReview?.reviewId ?? null, reviewSha256: selectedReview?.reviewSha256 ?? null,
        planId: selectedPlan?.planId ?? null, planSha256: selectedPlan?.planSha256 ?? null,
        received, buyerConfigured: Boolean(buyer), facilitator: review.selection.facilitator,
        allowLocalFacilitator: review.selection.allowLocalFacilitator,
        url: workspace.url, links: linksFor(workspace.url, selectedReview?.reviewId, selectedPlan?.planId),
      };
      await atomicJson(review.selection.directory, WQX_MANAGED_LAUNCH, launch);
      need(!signal?.aborted, 'WQX_MANAGED_STOP_REQUESTED');
      await onReady?.(launch);
      resolveReady({ launch, workspace, done, close });
      await stopRequested;
    } finally {
      await workspace?.close();
      signal?.removeEventListener('abort', stop);
      if (launch) await atomicJson(review.selection.directory, STOP, {
        schema: 'stellar-forge.wqx-managed-stop.v1', status: 'WQX_MANAGED_STOPPED',
        launchId: launch.launchId, projectBindingId: launch.projectBindingId,
        directory: review.selection.directory, stoppedAt: new Date().toISOString(),
      });
    }
    return { status: 'WQX_MANAGED_STOPPED', launchId: launch.launchId, directory: review.selection.directory };
  });
  function close() { return closing ??= (finish(), done); }
  done.catch(error => { signal?.removeEventListener('abort', stop); rejectReady(error); });
  return ready;
}
const HELP = [
  'Stellar Forge / managed water quality',
  '',
  'water-quality-managed inspect|serve --project /private/water-project [options]',
  '--bundle FILE                 Receive a full native review or Open Waters bundle.',
  '--review ID --plan ID         Reopen selected saved scientific decisions and their exports.',
  '--buyer-config FILE           Use the original private buyer configuration.',
  '--facilitator HTTPS_URL       Use the existing original native facilitator.',
  '--port 0 --merchant-port 0    Select loopback listeners.',
  '--allow-local-facilitator     Select an explicit loopback development facilitator.',
  '',
  'Applications records its reviewed source and selection SHA-256 values at start.',
  'Stop drains the original acquisitions, queued mutations and merchant before releasing the project.',
].join('\n');
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) { process.stdout.write(HELP + '\n'); return; }
  const [action, ...rest] = argv, values = new Map();
  need(['inspect', 'serve'].includes(action), 'WQX_MANAGED_ACTION_INVALID');
  const flags = new Set(['--project', '--bundle', '--buyer-config', '--facilitator', '--review', '--plan',
    '--port', '--merchant-port', '--expected-source-sha256', '--expected-selection-sha256']);
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    need(!values.has(name), 'WQX_MANAGED_DUPLICATE_OPTION');
    if (name === '--allow-local-facilitator') { values.set(name, true); continue; }
    need(flags.has(name) && typeof rest[i + 1] === 'string' && !rest[i + 1].startsWith('--'), 'WQX_MANAGED_OPTION_INVALID');
    values.set(name, rest[++i]);
  }
  const review = await reviewWaterQualityManaged({
    directory: values.get('--project'), bundleFile: values.get('--bundle'),
    buyerConfig: values.get('--buyer-config'), facilitator: values.get('--facilitator'),
    reviewId: values.get('--review'), planId: values.get('--plan'),
    allowLocalFacilitator: values.has('--allow-local-facilitator'),
    expectedSourceSha256: values.get('--expected-source-sha256'),
    expectedSelectionSha256: values.get('--expected-selection-sha256'),
  });
  if (action === 'inspect') { process.stdout.write(JSON.stringify(review, null, 2) + '\n'); return review; }
  const number = name => {
    const value = values.get(name) ?? '0';
    need(/^(0|[1-9][0-9]{0,4})$/.test(value), 'WQX_MANAGED_PORT_INVALID');
    return port(Number(value));
  };
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const session = await startManagedWaterQuality(review, {
      port: number('--port'), merchantPort: number('--merchant-port'), signal: controller.signal,
      onReady: value => process.stdout.write(JSON.stringify(value) + '\n'),
    });
    const result = await session.done;
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'WQX_MANAGED_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
