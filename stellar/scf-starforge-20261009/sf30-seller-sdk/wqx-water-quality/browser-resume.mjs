// MIT. Resume the original WQX browser arm from its retained native buyer and project.
import assert from 'node:assert/strict';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { privateDirectory, readPrivateJson, atomicJson, withPrivateLock } from '../routescan/quota.mjs';
import { canonicalJson, normalizeSelection } from './provider.mjs';
import { openWaterQualityProject } from './project.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';

const JOURNEY = 'starforge.wqx-water-quality-journey.v1';
const NATIVE = 'starforge.wqx-water-quality-native-complete.v1';
const CAPTURE = 'cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7';
const REVIEW = 'march-versus-january', EDITION = 'potomac-q1-water-quality';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const valueHash = value => hash(canonicalJson(value));
const equal = (left, right, message) => assert.equal(canonicalJson(left), canonicalJson(right), message);
const deniedSource = { async request() { throw new Error('Resume uses the original retained WQX source.'); } };
const publicError = error => ({ code: error?.code ?? error?.name ?? 'WQX_BROWSER_RESUME_FAILED',
  message: String(error?.message ?? error).slice(0, 1400) });

async function optionalJson(path, limit = 1048576) {
  try { return await readPrivateJson(path, limit); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function retainedRoot(directory) {
  const root = resolve(directory);
  assert((await lstat(root)).isDirectory() && await realpath(root) === root, 'Select the original retained journey directory.');
  return privateDirectory(root);
}
function nativeResult(value, root) {
  assert(value?.schema === JOURNEY && value.status === 'PASS' && value.directory === root,
    'The native checkpoint belongs to another journey.');
  assert(value.source?.captureSha256 === CAPTURE && value.source.observations === 1035 &&
    value.source.sourceRequests === 0 && value.source.authoringCaptureRestored === true,
    'Complete the original source and native reopen before the browser continuation.');
  assert(value.analysis?.reviewId === REVIEW && value.edition?.rowCount === 1035 &&
    value.commerce?.deliveredResults === 1035 && Array.isArray(value.commerce.pages) &&
    value.commerce.pages.length > 0 && value.commerce.purchases === value.commerce.pages.length + 2,
    'The saved native completion is incomplete.');
  return value;
}
async function buyerConfiguration(root) {
  const config = await readPrivateJson(join(root, 'local-fixture', 'buyer-config.json'));
  assert(config?.stateDirectory === join(root, 'buyer') && typeof config.runtimeDirectory === 'string' &&
    config.operatorProfile?.operator?.actor === 'wqx-journey' &&
    config.operatorProfile.operator.service === 'wqx-water-quality' &&
    config.operatorProfile.operator.ledger === join(root, 'local-fixture', 'ledger.sqlite'),
    'Use the original WQX buyer configuration and journal.');
  return config;
}

/** Persist the complete native outcome before any browser process is launched. */
export async function writeWaterQualityNativeCheckpoint({ directory, result, projectSnapshot }) {
  const root = await retainedRoot(directory), config = await buyerConfiguration(root);
  nativeResult(result, root);
  assert(projectSnapshot?.revision === 1 && projectSnapshot.selection, 'Retain the original project revision.');
  const checkpoint = { schema: NATIVE, status: 'NATIVE_COMPLETE', directory: root,
    completedAt: result.completedAt, buyerConfigurationSha256: valueHash(config),
    projectSnapshot, resultSha256: valueHash(result), result };
  await atomicJson(root, 'native-result.json', checkpoint, { exclusive: true });
  return checkpoint;
}

async function originalState(root, checkpoint) {
  const operation = await readPrivateJson(join(root, 'journey-operation.json'));
  assert(operation?.schema === JOURNEY && operation.commerce === 'ORIGINAL_LOCAL_PROTOCOL_FIXTURE',
    'Select the original WQX journey operation.');
  const projectSnapshot = await readPrivateJson(join(root, 'project', 'revisions', '1.json'));
  assert(projectSnapshot.revision === 1 && valueHash(projectSnapshot.selection) === projectSnapshot.selectionSha256,
    'The original saved project revision changed.');
  equal(projectSnapshot.selection, normalizeSelection(operation.selection), 'The original source selection changed.');
  if (checkpoint) equal(checkpoint.projectSnapshot, projectSnapshot, 'The native project snapshot changed.');
  const project = await openWaterQualityProject(join(root, 'project'), { transport: deniedSource });
  try {
    const review = await project.readReview(REVIEW), capture = await project.capture(review.captureId);
    const edition = await project.readEdition(EDITION);
    assert(capture.status === 'COMPLETE' && capture.captureSha256 === CAPTURE &&
      review.captureSha256 === CAPTURE && edition.captureSha256 === CAPTURE && edition.rowCount === 1035,
      'Reopen the original complete capture, saved review, and merchant edition.');
    if (checkpoint) {
      assert(checkpoint.result.analysis.reviewSha256 === review.reviewSha256 &&
        checkpoint.result.edition.snapshot === edition.snapshot &&
        checkpoint.result.edition.editionId === edition.editionId, 'The retained native review or edition changed.');
    }
    return { projectSnapshot, review, edition, current: await project.read() };
  } finally { await project.close(); }
}
async function retainedBrowser(root) {
  const directory = join(root, 'exports', 'browser');
  const result = await optionalJson(join(directory, 'browser-result.json'), 4 * 1048576);
  if (!result) return null;
  assert(result.status === 'PASS' && resolve(result.project) === join(root, 'project') &&
    result.originalCaptureSha256 === CAPTURE && result.editionRows === 1035 &&
    result.sourceSelectionPreserved === true && result.originalFieldsAndLimitsOpened === true &&
    Array.isArray(result.browserErrors) && result.browserErrors.length === 0,
    'The retained browser result belongs to another or incomplete operation.');
  assert(Array.isArray(result.downloads) && result.downloads.length === 4 &&
    Array.isArray(result.screenshots) && result.screenshots.length === 3, 'The retained browser outputs are incomplete.');
  for (const item of result.downloads) {
    assert(typeof item.file === 'string' && basename(item.file) === item.file &&
      Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 64 * 1048576,
      'A retained browser download changed.');
    const path = join(directory, item.file), info = await lstat(path);
    assert(info.isFile() && !info.isSymbolicLink() && info.size === item.bytes);
    assert.equal(hash(await readFile(path)), item.sha256, 'A retained browser download changed.');
  }
  for (const path of result.screenshots) {
    assert(typeof path === 'string' && join(directory, basename(path)) === path);
    const info = await lstat(path);
    assert(info.isFile() && !info.isSymbolicLink() && info.size > 8, 'A retained browser screenshot is missing.');
  }
  return result;
}

/** Continue the same run; all customer calls use the existing original Buyer. */
export async function resumeWaterQualityBrowser({ directory, playwrightModule, browserExecutable } = {}) {
  const root = await retainedRoot(directory);
  return withPrivateLock(root, 'browser-resume.lock', async () => {
    let stage = 'retained-native-state';
    try {
      const checkpoint = await optionalJson(join(root, 'native-result.json'), 16 * 1048576);
      const savedResult = await optionalJson(join(root, 'result.json'), 16 * 1048576);
      let native = null;
      if (checkpoint) {
        assert(checkpoint.schema === NATIVE && checkpoint.status === 'NATIVE_COMPLETE' && checkpoint.directory === root &&
          valueHash(checkpoint.result) === checkpoint.resultSha256, 'The native checkpoint changed.');
        native = nativeResult(checkpoint.result, root);
      } else if (savedResult) native = nativeResult(savedResult, root);
      const { projectSnapshot, edition, current } = await originalState(root, checkpoint);
      const config = await buyerConfiguration(root);
      if (checkpoint) assert.equal(valueHash(config), checkpoint.buyerConfigurationSha256, 'The original buyer configuration changed.');
      stage = 'retained-browser-result';
      let browser = await retainedBrowser(root);
      if (browser && (current.title !== projectSnapshot.title || valueHash(current.selection) !== projectSnapshot.selectionSha256)) browser = null;
      const reused = Boolean(browser);
      if (!browser) {
        stage = 'browser';
        const buyer = await new Buyer({ ...config, environment: { ...process.env, ...config.environment } }).ready();
        if (!native) {
          // Older interrupted journeys predate the native checkpoint. Reopen their
          // actual stored delivery intents before starting the browser.
          const { reopenQualityPurchase } = await import('./merchant.mjs');
          for (const intentId of ['wqx-journey-page-0001', 'wqx-journey-original-csv', 'wqx-journey-edition'])
            await reopenQualityPurchase({ buyer, intentId, editionDirectory: edition.directory });
        }
        const { inspectWaterQualityWorkspace } = await import('./browser-journey.mjs');
        browser = await inspectWaterQualityWorkspace({ directory: join(root, 'project'),
          outputDirectory: join(root, 'exports', 'browser'), buyer, reviewId: REVIEW, editionId: EDITION,
          originalIntent: 'wqx-journey-page-0001', projectSnapshot, playwrightModule, browserExecutable });
        await retainedBrowser(root);
      }
      stage = 'retain-completion';
      let result = null;
      if (native) {
        if (savedResult?.browser?.status === 'PASS') {
          equal(savedResult.browser, browser, 'The existing final result names another browser outcome.');
          result = nativeResult(savedResult, root);
        } else {
          result = { ...native, completedAt: new Date().toISOString(),
            nativeCompletedAt: native.nativeCompletedAt ?? native.completedAt, browser };
          await atomicJson(root, 'result.json', result);
        }
      }
      const output = { schema: 'starforge.wqx-water-quality-browser-resume.v1', status: 'PASS',
        completedAt: new Date().toISOString(), directory: root, reused,
        nativeResult: result ? join(root, 'result.json') : null,
        nativeCheckpoint: checkpoint ? join(root, 'native-result.json') : null,
        browserResult: join(root, 'exports', 'browser', 'browser-result.json'),
        originalCaptureSha256: browser.originalCaptureSha256,
        originalBuyerStateDirectory: config.stateDirectory,
        nativePurchases: result?.commerce.purchases ?? null, browser };
      await atomicJson(root, 'browser-resume.json', output);
      return output;
    } catch (error) {
      await atomicJson(root, 'browser-failure.json', { status: 'FAILED', stage,
        at: new Date().toISOString(), ...publicError(error) }).catch(() => {});
      throw error;
    }
  });
}
