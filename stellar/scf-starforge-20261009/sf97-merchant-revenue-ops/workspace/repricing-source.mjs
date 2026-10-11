// MIT. Original API merchant packages and retained SF82 releases for pricing.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readPackage, savePackage } from '../../sf61-openapi-seller-import/workspace/model.mjs';
import { readReleaseWorkspace } from '../../sf82-seller-pilot/release-upstreams.mjs';
import { inspectRelease, readReleaseState, stageRelease,
  normalizeReleaseRuntime } from '../../sf82-seller-pilot/releases.mjs';
import { prepareMerchantPlanRepricing } from './repricing.mjs';

const LIMIT = 4 * 1024 * 1024, MANIFEST_LIMIT = 1024 * 1024;
const PACKAGE_NAME = 'source-package';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (left, right) => canonical(left) === canonical(right);
const fail = (code, message, status = 422) => { throw Object.assign(new Error(message), {code, status}); };

function absolute(path, name) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path === '/')
    fail('ABSOLUTE_SOURCE_PATH_REQUIRED', `${name} requires an absolute normalized path.`);
  return path;
}
async function realDirectory(path, name) {
  absolute(path, name);
  if (!(await lstat(path)).isDirectory() || await realpath(path) !== path)
    fail('ORIGINAL_SOURCE_DIRECTORY_REQUIRED', `${name} must name its real original directory.`);
  return path;
}
async function bytesAt(path, maximum = LIMIT) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum)
      fail('SOURCE_FILE_REQUIRED', 'An original source file exceeds its native size or file-type limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) fail('SOURCE_FILE_TOO_LARGE', 'An original source file grew beyond its native size limit.');
    return bytes;
  } finally { await handle.close(); }
}
function json(bytes) { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
async function writeOnce(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Capture through the original reader, then bind the exact original bytes. */
async function originalPackage(path) {
  const folder = await realDirectory(path, 'API merchant package');
  const value = await readPackage(dirname(folder), basename(folder));
  const sourceFile = value.manifest.sourceFile ?? 'original-openapi.json';
  const [manifestBytes, sourceBytes, planBytes] = await Promise.all([
    bytesAt(join(folder, 'merchant-package.json'), MANIFEST_LIMIT),
    bytesAt(join(folder, sourceFile)), bytesAt(join(folder, 'merchant-plan.json')),
  ]);
  const manifest = json(manifestBytes), specText = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(sourceBytes);
  if (!same(manifest, value.manifest) || specText !== value.specText || !same(json(planBytes), value.plan) ||
      digest(sourceBytes) !== manifest.files[sourceFile] || digest(planBytes) !== manifest.files['merchant-plan.json'])
    fail('SOURCE_PACKAGE_CHANGED', 'The original API package changed during capture. Reopen its saved version.', 409);
  return {value, sourceFile, manifestBytes, sourceBytes, planBytes, specText};
}

/** The pricing workspace includes this review in its original save identity. */
export async function prepareRepricingSource(sourcePackage, coreReview) {
  if (sourcePackage === undefined || sourcePackage === null) return null;
  const source = await originalPackage(sourcePackage);
  const repriced = prepareMerchantPlanRepricing({specText:source.specText, plan:source.value.plan, review:coreReview});
  const planBytes = encode(repriced.plan);
  return {review:{kind:'API_MERCHANT_PACKAGE', inputManifestSha256:digest(source.manifestBytes),
    sourceFile:source.sourceFile, originalSourceSha256:digest(source.sourceBytes),
    originalPlanSha256:digest(source.planBytes), proposedPlanSha256:digest(planBytes)},
    specText:source.specText, plan:repriced.plan,
    originalManifestBytes:source.manifestBytes, originalPlanBytes:source.planBytes};
}

// These are the original RUN.md's generated package arguments. Replace only
// these complete shell-quoted tokens when the pricing workspace commits its
// pending directory; source text, environment references and runtime paths stay.
const shell = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
async function finalizeRunGuide(folder, finalFolder) {
  if (folder === finalFolder) return;
  const path = join(folder, 'RUN.md'), original = await bytesAt(path), text = original.toString('utf8');
  let updated = text;
  for (const suffix of ['support', 'compiled', 'upstreams.json', 'operator-cases.json', 'support/route-review-001'])
    updated = updated.split(shell(join(folder, suffix))).join(shell(join(finalFolder, suffix)));
  if (updated === text) fail('SOURCE_GUIDE_PATHS_CHANGED', 'The original package guide no longer contains its expected package arguments.');
  const handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.readFile();
    if (!current.equals(original)) fail('SOURCE_GUIDE_CHANGED', 'The newly generated source guide changed before publication.', 409);
    const bytes = Buffer.from(updated);
    for (let offset = 0; offset < bytes.length;) {
      const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (!bytesWritten) fail('SOURCE_GUIDE_WRITE_FAILED', 'The original package guide could not be fully retained.');
      offset += bytesWritten;
    }
    await handle.truncate(bytes.length); await handle.sync();
  } finally { await handle.close(); }
}

/** Save through the original package writer inside one uncommitted decision. */
export async function writeRepricingSource(prepared, parent, finalParent = parent) {
  if (prepared === null || prepared === undefined) return null;
  await realDirectory(parent, 'Pending pricing decision'); absolute(finalParent, 'Committed pricing decision');
  if (prepared.review?.kind !== 'API_MERCHANT_PACKAGE' ||
      !Buffer.isBuffer(prepared.originalManifestBytes) || !Buffer.isBuffer(prepared.originalPlanBytes) ||
      digest(prepared.originalManifestBytes) !== prepared.review.inputManifestSha256 ||
      digest(prepared.originalPlanBytes) !== prepared.review.originalPlanSha256 ||
      digest(Buffer.from(prepared.specText)) !== prepared.review.originalSourceSha256 ||
      digest(encode(prepared.plan)) !== prepared.review.proposedPlanSha256)
    fail('PREPARED_SOURCE_CHANGED', 'The prepared API source differs from its reviewed original and proposed plan.', 409);
  const originalManifest = json(prepared.originalManifestBytes);
  if ((originalManifest.sourceFile ?? 'original-openapi.json') !== prepared.review.sourceFile ||
      originalManifest.files?.[prepared.review.sourceFile] !== prepared.review.originalSourceSha256 ||
      originalManifest.files?.['merchant-plan.json'] !== prepared.review.originalPlanSha256)
    fail('PREPARED_SOURCE_CHANGED', 'The retained source manifest differs from its original source and plan.', 409);
  await writeOnce(join(parent, 'source-manifest.json'), prepared.originalManifestBytes);
  await writeOnce(join(parent, 'source-plan.json'), prepared.originalPlanBytes);
  const saved = await savePackage({specText:prepared.specText, plan:prepared.plan, parent, name:PACKAGE_NAME});
  const finalFolder = join(finalParent, PACKAGE_NAME);
  await finalizeRunGuide(saved.folder, finalFolder);
  const readback = await originalPackage(saved.folder);
  if (digest(readback.planBytes) !== prepared.review.proposedPlanSha256 ||
      digest(readback.sourceBytes) !== prepared.review.originalSourceSha256)
    fail('SAVED_SOURCE_CHANGED', 'The original package writer returned source different from the reviewed price decision.');
  await syncDirectory(saved.folder); await syncDirectory(parent);
  return {review:prepared.review, sourcePackage:finalFolder,
    package:{name:PACKAGE_NAME, id:readback.value.manifest.id,
      manifestSha256:digest(readback.manifestBytes), sourceFile:readback.sourceFile,
      originalSourceSha256:digest(readback.sourceBytes), planSha256:digest(readback.planBytes)}};
}

async function runtimeValue(runtime) {
  if (typeof runtime === 'string') return json(await bytesAt(absolute(runtime, 'Release runtime'), MANIFEST_LIMIT));
  return runtime;
}
function releaseLabel(value, id) {
  const label = value ?? id;
  if (typeof label !== 'string' || !label.trim() || label.length > 240 || /[\u0000-\u001f\u007f]/.test(label))
    fail('RELEASE_LABEL_REQUIRED', 'Use a nonempty, single-line release label up to 240 characters.');
  return label.trim();
}

/** Build the same immutable inputs and runtime that original staging uses. */
async function stagedExpectation(directory, runtime, id, label) {
  const folder = join(await realDirectory(directory, 'Saved pricing decision'), PACKAGE_NAME);
  const source = await originalPackage(folder), workspace = await readReleaseWorkspace(folder);
  if (workspace.provenance.manifestSha256 !== digest(source.manifestBytes))
    fail('SOURCE_PACKAGE_CHANGED', 'The retained API package changed while preparing its release.', 409);
  const suppliedRuntime = await runtimeValue(runtime), normalized = normalizeReleaseRuntime(suppliedRuntime);
  if (normalized.handlers || normalized.upstreams)
    fail('SOURCE_OWNS_RELEASE_BINDINGS', 'The retained API package already contains its original upstream bindings.');
  if (workspace.allowLoopbackUpstream) normalized.allowLoopbackUpstream = true;
  const upstreamSha256 = workspace.hashes['upstreams.json'];
  normalized.upstreams = {file:`pilot-upstreams-${upstreamSha256}.json`, sha256:upstreamSha256};
  const [manifestBytes, serviceBytes, offersBytes] = await Promise.all([
    bytesAt(join(folder, 'compiled', 'manifest.json'), MANIFEST_LIMIT),
    bytesAt(join(folder, 'compiled', 'seller-service.json'), MANIFEST_LIMIT),
    bytesAt(join(folder, 'compiled', 'offers.json')),
  ]);
  const compiled = json(manifestBytes), service = json(serviceBytes);
  if (compiled.schema !== 'stellar.open-api-seller-manifest.v1' ||
      compiled.specSha256 !== workspace.hashes['facade-openapi.json'] ||
      compiled.selectionsSha256 !== workspace.hashes['selections.json'] ||
      compiled.serviceBindingsSha256 !== workspace.hashes['route-bindings.json'] ||
      compiled.serviceConfigSha256 !== digest(serviceBytes) || compiled.offersSha256 !== digest(offersBytes))
    fail('SAVED_COMPILER_OUTPUT_CHANGED', 'The retained original compiler output differs from its API package source.', 409);
  return {folder, suppliedRuntime, expected:{id, label:releaseLabel(label, id),
    inputPackage:workspace.provenance, runtime:normalized, publicOrigin:service.publicOrigin,
    source:{offersSha256:compiled.offersSha256, serviceConfigSha256:compiled.serviceConfigSha256,
      specSha256:compiled.specSha256, selectionsSha256:compiled.selectionsSha256,
      serviceBindingsSha256:compiled.serviceBindingsSha256}}};
}

function matchingRelease(release, expected) {
  if (!same(release.inputPackage, expected.inputPackage) || !same(release.runtime, expected.runtime) ||
      release.id !== expected.id || release.label !== expected.label || release.publicOrigin !== expected.publicOrigin ||
      Object.entries(expected.source).some(([key, value]) => release.source?.[key] !== value))
    fail('REPRICING_RELEASE_CONFLICT', 'That release ID already belongs to a different source package, runtime or label.', 409);
  return release;
}
async function existingRelease(root, id) {
  try { await lstat(join(root, 'releases', id)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  // A damaged existing release is an error, not permission to replace its ID.
  return inspectRelease(root, id);
}

/** Stage or recover the same original release; activation stays with SF82. */
export async function stageRepricingSource({directory, releaseStore, runtime, id, label} = {}) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))
    fail('RELEASE_ID_REQUIRED', 'Use the original release ID format: 1–64 lowercase letters, digits, underscores or hyphens.');
  const root = await realDirectory(releaseStore, 'Original release store');
  await readReleaseState(root);
  const {folder, suppliedRuntime, expected} = await stagedExpectation(directory, runtime, id, label);
  const old = await existingRelease(root, id);
  if (old) return {status:'RELEASE_STAGED', release:matchingRelease(old, expected), recovered:true};
  try {
    await stageRelease(root, {id, label:expected.label, workspace:folder, runtime:suppliedRuntime});
  } catch (error) {
    // A completed rename followed by a lost/error reply is resolved by its same
    // stable release ID. No second stage ID or duplicate release is generated.
    const observed = await existingRelease(root, id);
    if (observed) return {status:'RELEASE_STAGED', release:matchingRelease(observed, expected), recovered:true};
    throw error;
  }
  const release = matchingRelease(await inspectRelease(root, id), expected);
  return {status:'RELEASE_STAGED', release, recovered:false};
}
