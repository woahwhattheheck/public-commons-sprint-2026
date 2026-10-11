// MIT. Private exact-source HAR sessions; immutable reviews and create-only publication.
import { constants as C } from 'node:fs';
import { open, lstat, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectHar, newReview, buildDocument, canonical } from './model.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = o => Buffer.from(JSON.stringify(o, null, 2) + '\n');
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
const MAX_SOURCE = 128 * 1024 * 1024;
const MAX_REVIEW = 4 * 1024 * 1024;
async function syncDirectory(path) { const fd = await open(path, C.O_RDONLY); try { await fd.sync(); } finally { await fd.close(); } }
export async function readRegular(path, max = MAX_SOURCE, privateFile = false) {
  const fd = await open(path, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.size > max || before.size < 1) throw new Error('Expected a nonempty regular file within the input limit');
    if (privateFile && (before.mode & 0o077)) throw new Error(`Private file permissions required: ${basename(path)}`);
    // Bound the descriptor read even when another process appends during intake.
    const bytes = Buffer.alloc(before.size + 1); let n = 0;
    while (n < bytes.length) { const r = await fd.read(bytes, n, bytes.length - n, null); if (!r.bytesRead) break; n += r.bytesRead; }
    const after = await fd.stat();
    if (n !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error('Input changed during read; retry from one stable capture');
    return bytes.subarray(0, n);
  } finally { await fd.close(); }
}
async function writeNew(path, bytes) {
  const fd = await open(path, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
}
async function absent(path) { try { await lstat(path); throw new Error(`Destination already exists: ${path}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error(`Use a private nonsymlink directory: ${path}`);
}
async function newDirectory(destination, build) {
  destination = resolve(destination); await absent(destination);
  // Reserve the destination using exclusive mkdir, so another writer can never be replaced by rename.
  await mkdir(destination, { mode: 0o700 });
  const reservation = await lstat(destination);
  const stage = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.stage`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const result = await build(stage);
    await syncDirectory(stage);
    const now = await lstat(destination);
    if (now.ino !== reservation.ino || now.dev !== reservation.dev || (await readdir(destination)).length)
      throw new Error('Destination reservation changed');
    await rename(stage, destination); await syncDirectory(dirname(destination));
    return result;
  } catch (e) {
    await rm(stage, { recursive: true, force: true });
    try { const now = await lstat(destination); if (now.ino === reservation.ino && now.dev === reservation.dev && !(await readdir(destination)).length) await rm(destination, { recursive: true }); } catch {}
    throw e;
  }
}
export async function prepare(harFile, destination) {
  const source = await readRegular(harFile), sourceSha256 = digest(source);
  const inventory = inspectHar(json(source), sourceSha256), inventoryBytes = encode(inventory);
  const manifest = { schema: 'stellar.har-workspace.v1', sourceSha256, sourceBytes: source.length, inventorySha256: digest(inventoryBytes),
    captureFormat: 'HAR 1.2', privacy: 'Original capture may contain credentials and personal data; keep this entire workspace private.' };
  await newDirectory(destination, async stage => {
    await writeNew(join(stage, 'source.har'), source); await writeNew(join(stage, 'inventory.json'), inventoryBytes);
    await mkdir(join(stage, 'reviews'), { mode: 0o700 });
    await writeNew(join(stage, 'source.json'), encode(manifest));
  });
  return { workspace: resolve(destination), ...manifest, groups: inventory.groups.length, rejected: inventory.rejected.length };
}
export async function openWorkspace(directory) {
  const root = resolve(directory); await privateDirectory(root);
  const manifest = json(await readRegular(join(root, 'source.json'), MAX_REVIEW, true));
  if (manifest.schema !== 'stellar.har-workspace.v1' || !/^[a-f0-9]{64}$/.test(manifest.sourceSha256)) throw new Error('Invalid HAR workspace manifest');
  const source = await readRegular(join(root, 'source.har'), MAX_SOURCE, true);
  if (digest(source) !== manifest.sourceSha256 || source.length !== manifest.sourceBytes) throw new Error('Original HAR source identity changed');
  const bytes = await readRegular(join(root, 'inventory.json'), MAX_SOURCE, true);
  if (digest(bytes) !== manifest.inventorySha256) throw new Error('Inventory identity changed');
  const inventory = json(bytes);
  // Inventory always comes from the original decoder; a replaced manifest cannot inject a different inventory.
  if (canonical(inventory) !== canonical(inspectHar(json(source), manifest.sourceSha256))) throw new Error('Inventory disagrees with the retained HAR source');
  await privateDirectory(join(root, 'reviews'));
  return { root, manifest, inventory, newReview: () => newReview(inventory) };
}
export async function readRevision(workspace, revision) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Review revision must be a full SHA256');
  const bytes = await readRegular(join(workspace.root, 'reviews', revision + '.json'), MAX_REVIEW, true);
  if (digest(bytes) !== revision) throw new Error('Saved review identity changed');
  const review = json(bytes); buildDocument(workspace.inventory, review);
  return { bytes, review, revision };
}
export async function saveReview(directory, decisionFile) {
  const workspace = await openWorkspace(directory);
  const review = json(await readRegular(decisionFile, MAX_REVIEW));
  const document = buildDocument(workspace.inventory, review);
  const bytes = Buffer.from(canonical(review) + '\n'), revision = digest(bytes), target = join(workspace.root, 'reviews', revision + '.json');
  if (bytes.length > MAX_REVIEW) throw new Error('Review exceeds 4 MiB');
  const stage = target + '.' + randomUUID() + '.tmp';
  await writeNew(stage, bytes);
  try {
    // Exclusive hard-link publication makes concurrent equal saves idempotent without replacement.
    const { link } = await import('node:fs/promises');
    try { await link(stage, target); await syncDirectory(dirname(target)); }
    catch (e) { if (e.code !== 'EEXIST' || digest(await readRegular(target, MAX_REVIEW, true)) !== revision) throw e; }
  } finally { await rm(stage, { force: true }); }
  return { revision, operations: Object.values(document.paths).reduce((n, p) => n + Object.keys(p).length, 0), sourceSha256: workspace.manifest.sourceSha256 };
}
export async function exportReview(directory, revision, destination) {
  const workspace = await openWorkspace(directory), saved = await readRevision(workspace, revision);
  const document = buildDocument(workspace.inventory, saved.review);
  document['x-starforge-har'].reviewSha256 = revision;
  const spec = encode(document), decisions = saved.bytes;
  if (spec.length > MAX_REVIEW) throw new Error('Generated OpenAPI exceeds original importer 4 MiB source limit');
  const manifest = { schema: 'stellar.har-export.v1', sourceSha256: workspace.manifest.sourceSha256, reviewSha256: revision,
    files: { 'openapi.json': { sha256: digest(spec), bytes: spec.length }, 'review.json': { sha256: revision, bytes: decisions.length } },
    schemaAuthority: 'operator-reviewed-observations',
    nativeHandoff: 'Use openapi.json as the original backend source in the SF61 workspace. Configure the separate seller URL, payment terms and declared backend credential references there.' };
  await newDirectory(destination, async stage => {
    await writeNew(join(stage, 'openapi.json'), spec); await writeNew(join(stage, 'review.json'), decisions);
    await writeNew(join(stage, 'manifest.json'), encode(manifest));
  });
  return { output: resolve(destination), ...manifest };
}
export async function copyWorkspace(directory, destination) {
  const workspace = await openWorkspace(directory), revisions = (await readdir(join(workspace.root, 'reviews'))).filter(p => /^[a-f0-9]{64}\.json$/.test(p)).sort();
  // Read and verify every immutable revision before publishing the receiving directory.
  const selected = [];
  for (const filename of revisions) selected.push(await readRevision(workspace, filename.slice(0, -5)));
  await newDirectory(destination, async stage => {
    for (const f of ['source.har', 'inventory.json', 'source.json']) await writeNew(join(stage, f), await readRegular(join(workspace.root, f), MAX_SOURCE, true));
    await mkdir(join(stage, 'reviews'), { mode: 0o700 });
    for (const saved of selected) await writeNew(join(stage, 'reviews', saved.revision + '.json'), saved.bytes);
    await openWorkspace(stage);
  });
  return { workspace: resolve(destination), sourceSha256: workspace.manifest.sourceSha256, revisions: selected.map(x => x.revision) };
}
export async function inspectWorkspace(directory) {
  const w = await openWorkspace(directory), reviews = [];
  for (const filename of (await readdir(join(w.root, 'reviews'))).filter(p => /^[a-f0-9]{64}\.json$/.test(p)).sort()) {
    const r = await readRevision(w, filename.slice(0, -5));
    reviews.push({ revision: r.revision, operations: r.review.operations.filter(o => o.enabled).map(o => o.id) });
  }
  return { workspace: w.root, ...w.manifest, totalEntries: w.inventory.totalEntries, groups: w.inventory.groups.length, rejected: w.inventory.rejected, reviews };
}
export async function writeReviewPage(directory, destination, render, revision) {
  const w = await openWorkspace(directory), review = revision ? (await readRevision(w, revision)).review : w.newReview();
  const html = await render(w.inventory, review);
  await writeNew(resolve(destination), Buffer.from(html));
  return { reviewPage: resolve(destination), sourceSha256: w.manifest.sourceSha256, revision: revision || null };
}
