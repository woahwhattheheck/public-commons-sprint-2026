// MIT. Browser composition of the maintained SF105 onboarding and seller runtime.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchemaSource, inspectSchema } from '../onboarding/schema.mjs';
import { compileSubQueryMerchantPlan, prepareSubQuerySeller } from '../onboarding/prepare.mjs';
import { createSubQueryMerchantHandlers } from '../adapter.mjs';
import { startSellerService } from '../../sf30-seller-sdk/serve.mjs';
import { digest, draftInput, inputDigest, plain } from './store.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const launcher = fileURLToPath(new URL('../launch.mjs', import.meta.url));
function parseObject(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw new TypeError(label + ' must be valid JSON.'); }
  if (!plain(value)) throw new TypeError(label + ' must be a JSON object.');
  return value;
}
export async function inspectDraftSchema(schemaText) {
  if (typeof schemaText !== 'string' || Buffer.byteLength(schemaText) > 1024 * 1024)
    throw new TypeError('Schema source must be at most 1 MiB.');
  const compiled = await compileSchemaSource(schemaText);
  return { sourceSha256: compiled.sourceSha256, format: compiled.format,
    provenance: compiled.provenance, inspection: await inspectSchema(compiled) };
}
export async function reviewDraft(value) {
  const input = draftInput(value);
  const schemaSource = await compileSchemaSource(input.schemaText);
  const queries = parseObject(input.queriesText, 'Approved queries');
  const plan = parseObject(input.planText, 'Merchant plan');
  const compiled = await compileSubQueryMerchantPlan({ schemaSource, queries, plan });
  return { inputDigest: inputDigest(input), sourceSha256: schemaSource.sourceSha256,
    format: schemaSource.format, review: compiled.review, service: compiled.service,
    queries: compiled.queries, inspection: await inspectSchema(schemaSource) };
}
async function fingerprints(folder, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(folder, prefix), { withFileTypes: true })) {
    const name = join(prefix, entry.name), path = join(folder, name);
    if (entry.isDirectory()) files.push(...await fingerprints(folder, name));
    else if (entry.isFile()) {
      const stat = await lstat(path);
      if (stat.size > 8 * 1024 * 1024) throw new TypeError('Generated package file exceeds 8 MiB.');
      const bytes = await readFile(path);
      files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
    } else throw new TypeError('Generated package contains a nonregular file.');
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
/** The original exporter remains the only source of merchant package files. */
export async function exportDraft(store, saved) {
  const reviewed = await reviewDraft(saved.input);
  const exportId = randomUUID(), task = join(store.packages, saved.id + '-r' + saved.revision + '-' + exportId.slice(0, 8));
  await mkdir(task, { mode: 0o700 });
  const source = join(task, 'input');
  await mkdir(source, { mode: 0o700 });
  const schemaFile = join(source, 'schema-source.' + (saved.input.schemaText.trimStart().startsWith('{') ? 'json' : 'graphql'));
  const queriesFile = join(source, 'queries.json'), planFile = join(source, 'plan.json');
  for (const [path, text] of [[schemaFile, saved.input.schemaText], [queriesFile, saved.input.queriesText], [planFile, saved.input.planText]])
    await writeFile(path, text, { flag: 'wx', mode: 0o600 });
  const directory = join(task, 'merchant');
  const prepared = await prepareSubQuerySeller({ schemaFile, queriesFile, planFile, directory });
  const files = await fingerprints(directory);
  // These are original exporter results, retained separately from the editable draft.
  const record = { id: exportId, createdAt: new Date().toISOString(), draftRevision: saved.revision,
    inputDigest: saved.inputDigest, directory, files, prepared,
    service: reviewed.service, queries: reviewed.queries, review: reviewed.review };
  const retained = json(record);
  await writeFile(join(task, 'workspace-export.json'), retained, { flag: 'wx', mode: 0o600 });
  return { record, reference: { id: record.id, createdAt: record.createdAt,
    draftRevision: record.draftRevision, inputDigest: record.inputDigest,
    directory: record.directory, recordSha256: digest(retained) } };
}
export async function readExport(reference) {
  const path = join(dirname(reference.directory), 'workspace-export.json'), stat = await lstat(path);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new TypeError('Saved export record is unavailable.');
  const bytes = await readFile(path);
  if (digest(bytes) !== reference.recordSha256) throw new TypeError('Saved export record changed.');
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (record.id !== reference.id || record.directory !== reference.directory || record.inputDigest !== reference.inputDigest)
    throw new TypeError('Saved export does not match this project.');
  return record;
}
export function exportView(record) {
  return { id: record.id, createdAt: record.createdAt, draftRevision: record.draftRevision,
    inputDigest: record.inputDigest, directory: record.directory, files: record.files,
    prepared: record.prepared, review: record.review,
    command: `node ${quote(record.prepared.launcher ?? launcher)} --seller ${quote(record.prepared.service)} --queries ${quote(record.prepared.queries)}` };
}
export async function startDraftMerchant(record, { allowLoopback = false, facilitator } = {}) {
  if (!plain(record) || !isAbsolute(record.directory) || !Array.isArray(record.files)) throw new TypeError('Choose a saved merchant export.');
  for (const expected of record.files) {
    const path = join(record.directory, expected.name), rel = relative(record.directory, path);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new TypeError('Invalid exported file path.');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size !== expected.bytes || digest(await readFile(path)) !== expected.sha256)
      throw new TypeError('Exported merchant files changed. Create a fresh reviewed export.');
  }
  const handlers = createSubQueryMerchantHandlers(record.queries, { allowLoopback, env: { ...process.env } });
  let nativeFactory = null;
  if (facilitator) {
    const endpoint = new URL(facilitator);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new TypeError('Facilitator must use HTTPS without credentials, a query or a fragment.');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../../sf30-seller-sdk/native-factory.mjs'),
    ]);
    nativeFactory = routes => createNativeSellerServer(routes, {
      facilitatorClient: new HTTPFacilitatorClient({ url: endpoint.href.replace(/\/$/, '') }),
    });
  }
  return startSellerService({ config: record.service, handlers, nativeFactory, port: 0 });
}
