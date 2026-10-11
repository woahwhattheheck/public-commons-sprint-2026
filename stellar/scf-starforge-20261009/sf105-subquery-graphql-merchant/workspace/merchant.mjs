// MIT. Browser composition of the maintained SF105 onboarding and seller runtime.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchemaSource, inspectSchema } from '../onboarding/schema.mjs';
import { compileSubQueryMerchantPlan, prepareSubQuerySeller } from '../onboarding/prepare.mjs';
import { readSubQueryMerchantBundle, compareSubQueryMerchantSchemas, prepareSubQueryRevision } from '../onboarding/revisions.mjs';
import { createSubQueryMerchantHandlers } from '../adapter.mjs';
import { startSellerService } from '../../sf30-seller-sdk/serve.mjs';
import { digest, draftInput, inputDigest, plain } from './store.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const launcher = fileURLToPath(new URL('../launch.mjs', import.meta.url));
const conflict = message => { throw Object.assign(new Error(message), { status: 409 }); };
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
function draftSources(value) {
  const input = draftInput(value);
  const schemaSource = compileSchemaSource(input.schemaText);
  const queries = parseObject(input.queriesText, 'Approved queries');
  const plan = parseObject(input.planText, 'Merchant plan');
  return { input, schemaSource, queries, plan };
}
function merchantReview(input, schemaSource, compiled) {
  return { inputDigest: inputDigest(input), sourceSha256: schemaSource.sourceSha256,
    format: schemaSource.format, review: compiled.review, service: compiled.service,
    queries: compiled.queries };
}
export async function reviewDraft(value) {
  const source = draftSources(value), compiled = compileSubQueryMerchantPlan(source);
  return { ...merchantReview(source.input, source.schemaSource, compiled), inspection: inspectSchema(source.schemaSource) };
}
export async function fingerprints(folder, prefix = '') {
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
async function freezeDraft(store, saved) {
  const exportId = randomUUID(), task = join(store.packages, saved.id + '-r' + saved.revision + '-' + exportId.slice(0, 8));
  await mkdir(task, { mode: 0o700 });
  const source = join(task, 'input');
  await mkdir(source, { mode: 0o700 });
  const schemaFile = join(source, 'schema-source.' + (saved.input.schemaText.trimStart().startsWith('{') ? 'json' : 'graphql'));
  const queriesFile = join(source, 'queries.json'), planFile = join(source, 'plan.json');
  for (const [path, text] of [[schemaFile, saved.input.schemaText], [queriesFile, saved.input.queriesText], [planFile, saved.input.planText]])
    await writeFile(path, text, { flag: 'wx', mode: 0o600 });
  return { exportId, task, schemaFile, queriesFile, planFile };
}
async function retainExport({ exportId, saved, prepared, reviewed, evolution }) {
  const directory = prepared.directory, files = await fingerprints(directory);
  // These are original exporter results, retained separately from the editable draft.
  const record = { id: exportId, createdAt: new Date().toISOString(), draftRevision: saved.revision,
    inputDigest: saved.inputDigest, directory, files, prepared,
    service: reviewed.service, queries: reviewed.queries, review: reviewed.review,
    ...(evolution ? { evolution } : {}) };
  const retained = json(record);
  if (Buffer.byteLength(retained) > 8 * 1024 * 1024) throw new TypeError('Saved export record exceeds 8 MiB.');
  await writeFile(join(dirname(directory), 'workspace-export.json'), retained, { flag: 'wx', mode: 0o600 });
  return { record, reference: { id: record.id, createdAt: record.createdAt,
    draftRevision: record.draftRevision, inputDigest: record.inputDigest,
    directory: record.directory, recordSha256: digest(retained) } };
}
/** The original exporter remains the only source of merchant package files. */
export async function exportDraft(store, saved) {
  const reviewed = await reviewDraft(saved.input), frozen = await freezeDraft(store, saved);
  const prepared = await prepareSubQuerySeller({ ...frozen, directory: join(frozen.task, 'merchant') });
  return retainExport({ exportId: frozen.exportId, saved, prepared, reviewed });
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
    prepared: record.prepared, review: record.review, ...(record.evolution ? { evolution: record.evolution } : {}),
    command: `node ${quote(record.prepared.launcher ?? launcher)} --seller ${quote(record.prepared.service)} --queries ${quote(record.prepared.queries)}` };
}
export async function verifyFiles(directory, files) {
  if (!isAbsolute(directory) || !Array.isArray(files)) throw new TypeError('Choose a saved merchant export.');
  if (!(await lstat(directory)).isDirectory()) throw new TypeError('Saved package must remain a regular directory.');
  for (const expected of files) {
    const path = join(directory, expected.name), rel = relative(directory, path);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new TypeError('Invalid exported file path.');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size !== expected.bytes || digest(await readFile(path)) !== expected.sha256)
      throw new TypeError('Exported merchant files changed. Create a fresh reviewed export.');
  }
}
export async function verifyExport(record) {
  if (!plain(record)) throw new TypeError('Choose a saved merchant export.');
  await verifyFiles(record.directory, record.files);
  if (record.evolution) await verifyFiles(record.evolution.directory, record.evolution.files);
}
/** Compare only a project's retained package, using the original revision API. */
export async function compareDraft(value, baselineReference) {
  const baseline = await readExport(baselineReference);
  await verifyExport(baseline);
  const previous = await readSubQueryMerchantBundle(baseline.directory), candidate = draftSources(value);
  const { review, prepared } = compareSubQueryMerchantSchemas({ previous, candidate });
  const candidateDigest = inputDigest(candidate.input);
  return { inputDigest: candidateDigest,
    baseline: { id: baseline.id, draftRevision: baseline.draftRevision, directory: baseline.directory },
    comparisonDigest: digest(json({ baseline: baselineReference.recordSha256, inputDigest: candidateDigest, review })),
    review, merchant: prepared ? merchantReview(candidate.input, candidate.schemaSource, prepared) : null };
}
/** Keep the revised merchant, exact baseline copy and native review together. */
export async function reviseDraft(store, saved, baselineReference, expectedComparisonDigest) {
  const compared = await compareDraft(saved.input, baselineReference);
  if (typeof expectedComparisonDigest !== 'string' || compared.comparisonDigest !== expectedComparisonDigest)
    conflict('The revision comparison changed. Compare this saved draft and baseline again.');
  if (!compared.review.ready) throw new TypeError(compared.review.candidateValidation.error.message);
  const frozen = await freezeDraft(store, saved);
  const revision = await prepareSubQueryRevision({ ...frozen,
    previousDirectory: baselineReference.directory, directory: join(frozen.task, 'revised') });
  const report = JSON.parse(await readFile(revision.report, 'utf8'));
  if (json(report) !== json(compared.review)) conflict('Prepared revision differs from its reviewed inputs. Compare again.');
  const evolution = { schema: 'stellar-forge.graphql-workspace-evolution.v1',
    baselineExportId: baselineReference.id, baselineDraftRevision: baselineReference.draftRevision,
    baselineDirectory: baselineReference.directory, comparisonDigest: compared.comparisonDigest,
    directory: revision.directory, previousDirectory: revision.previousDirectory,
    review: revision.review, report: revision.report, manifest: revision.manifest,
    summary: revision.summary, previous: report.previous, candidate: report.candidate,
    files: await fingerprints(revision.directory) };
  return retainExport({ exportId: frozen.exportId, saved, prepared: revision.prepared,
    reviewed: compared.merchant, evolution });
}
export async function readRevisionReport(reference) {
  const record = await readExport(reference);
  if (!record.evolution) throw new TypeError('This export has no retained schema revision report.');
  await verifyExport(record);
  return { retained: true, exportId: record.id, draftRevision: record.draftRevision, inputDigest: record.inputDigest,
    baseline: { id: record.evolution.baselineExportId, draftRevision: record.evolution.baselineDraftRevision,
      directory: record.evolution.baselineDirectory },
    review: JSON.parse(await readFile(record.evolution.report, 'utf8')) };
}
export async function startDraftMerchant(record, { allowLoopback = false, facilitator } = {}) {
  await verifyExport(record);
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
