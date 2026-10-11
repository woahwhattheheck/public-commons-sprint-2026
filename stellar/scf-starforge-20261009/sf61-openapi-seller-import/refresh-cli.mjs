#!/usr/bin/env node
// MIT. Retained source review and original merchant-package export.
import { readFile, lstat, open, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPackage, savePackage, privateParent, prepareMerchant, packageName } from './workspace/model.mjs';
import { reviewSourceRefresh, requireSourceRefresh } from './source-refresh.mjs';

export const REVIEW_FILE_SCHEMA = 'stellar-forge.api-source-refresh-file.v1';
const LIMIT = 32 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => canonical(a) === canonical(b);
const usage = `OpenAPI source refresh (original API merchant packages)
  review --parent PRIVATE --baseline NAME --spec CANDIDATE [--decisions JSON] --out NEW_JSON [--html NEW_HTML]
  show --review JSON [--html NEW_HTML]
  export --parent PRIVATE --review JSON --review-id SHA256 --name NEW_PACKAGE

Review and show only read source. Export requires the displayed review identity,
reopens the saved baseline, and creates the original merchant package. Repeating
export reopens only an exact completed match; it never overwrites a package.
Use the existing openapi-workspace console or SF82 release operator to run it.`;

async function regular(path, limit = LIMIT) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > limit) throw new TypeError('Use a regular file no larger than ' + limit + ' bytes: ' + path);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new RangeError('File grew beyond its input limit');
  return bytes;
}
const textFile = async (path, limit) => new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(await regular(path, limit));
async function writeNew(path, contents) {
  await privateParent(dirname(resolve(path)));
  if (Buffer.byteLength(contents) > LIMIT) throw new RangeError('Review output exceeds 32 MiB');
  const temporary = resolve(path) + '.tmp-' + randomUUID();
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
    // Hard-link installation is create-only and exposes complete bytes at once.
    await link(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function baselineIdentity(project) {
  return {name:project.name, packageId:project.manifest.id, manifestSha256:sha(canonical(project.manifest))};
}

/** A portable review contains exact inputs and a recomputable original-engine result. */
export async function createRefreshReview({parent, baselineName, candidateSpecText, decisions = {}}) {
  const project = await readPackage(parent, baselineName);
  const input = {baseline:{specText:project.specText, plan:project.plan}, candidateSpecText, decisions};
  return {schema:REVIEW_FILE_SCHEMA, baseline:baselineIdentity(project), input, report:reviewSourceRefresh(input)};
}
export function verifyRefreshReview(document) {
  if (!plain(document) || document.schema !== REVIEW_FILE_SCHEMA || !plain(document.baseline) || !plain(document.input) || !plain(document.report))
    throw new TypeError('Use an original source-refresh review file');
  packageName(document.baseline.name);
  const report = reviewSourceRefresh(document.input);
  if (!same(report, document.report)) throw new TypeError('Saved review differs from its inputs or current compiler; create a fresh review');
  return report;
}
export async function readRefreshReview(path) {
  const document = JSON.parse(await textFile(path));
  verifyRefreshReview(document);
  return document;
}

// Recover the original completed export only when its actual original compiled
// artifacts agree with the accepted source. Partial/changed packages stay intact.
async function completedExport(parent, name, input, report) {
  const project = await readPackage(parent, name);
  if (project.specText !== input.candidateSpecText || !same(project.plan, report.plan))
    throw new TypeError('Existing package differs from this source review; choose a new package name');
  const prepared = prepareMerchant(input.candidateSpecText, report.plan);
  const compiled = join(project.folder, 'compiled');
  const manifest = JSON.parse(await textFile(join(compiled, 'manifest.json')));
  for (const [file, expected, hashKey] of [
    ['offers.json', prepared.imported, 'offersSha256'],
    ['seller-service.json', prepared.service, 'serviceConfigSha256'],
  ]) {
    const bytes = await regular(join(compiled, file));
    if (sha(bytes) !== manifest[hashKey] || !same(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)), expected))
      throw new TypeError('Existing compiled export changed: ' + file + '. Preserve it and choose a new package name.');
  }
  for (const [file, expected] of [['facade-openapi.json', prepared.facade], ['selections.json', prepared.selections],
    ['route-bindings.json', prepared.bindings], ['upstreams.json', prepared.upstreams], ['operator-cases.json', prepared.cases]]) {
    if (!same(JSON.parse(await textFile(join(project.folder, file))), expected))
      throw new TypeError('Existing prepared export differs: ' + file + '. Preserve it and choose a new package name.');
  }
  return {name, folder:project.folder, manifest:project.manifest, preview:prepared.preview};
}

/** Save through the original writer; a lost reply can reopen the exact same output. */
export async function exportRefreshReview({parent, document, reviewId, name}) {
  const report = verifyRefreshReview(document);
  requireSourceRefresh(document.input, reviewId);
  const baseline = await readPackage(parent, document.baseline.name);
  if (!same(baselineIdentity(baseline), document.baseline) || baseline.specText !== document.input.baseline.specText ||
    !same(baseline.plan, document.input.baseline.plan)) throw new TypeError('The saved baseline changed; review its current package again');
  if (name === baseline.name) throw new TypeError('Use a new package name; the baseline is retained');
  packageName(name);
  let result, reopened = false;
  try {
    // A complete pre-existing output is a recovery; an incomplete one is never
    // overwritten or mistaken for a completed original save.
    await lstat(join(parent, name));
    result = await completedExport(parent, name, document.input, report);
    reopened = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // ENOENT from inside an existing directory is not permission to overwrite it.
    try { await lstat(join(parent, name)); throw new TypeError('Existing package is incomplete; preserve it and choose a new name'); }
    catch (check) { if (check.code !== 'ENOENT') throw check; }
    result = await savePackage({parent, name, specText:document.input.candidateSpecText, plan:report.plan});
  }
  const sidecar = join(result.folder, 'source-refresh.json');
  try { await writeNew(sidecar, json(document)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!same(JSON.parse(await textFile(sidecar)), document)) throw new TypeError('Existing source-refresh record differs; preserve this package');
  }
  return {name:result.name, folder:result.folder, reviewId:report.reviewId, reopened,
    baseline:document.baseline.name, sourceRefresh:sidecar, preview:result.preview,
    ...(result.command ? {command:result.command} : {})};
}

const htmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const pre = value => '<pre>' + htmlEscape(json(value)) + '</pre>';
/** Offline, script-free human review of the exact same CLI/browser engine report. */
export function renderRefreshReview(document) {
  const report = verifyRefreshReview(document);
  const rows = report.operations.map(row => `<article><h2>${htmlEscape(row.from ?? 'New selection')} → ${htmlEscape(row.to ?? 'Remove')}</h2>
<p><strong>${htmlEscape(row.state)}</strong> · Route ID <code>${htmlEscape(row.id ?? 'unassigned')}</code> · ${row.changes.length} effective changes</p>
${row.suggestions?.length ? '<p>Possible replacements (explicit selection required): ' + row.suggestions.map(htmlEscape).join(', ') + '</p>' : ''}
<details><summary>Changed offer, backend and source fields</summary>${pre(row.changes)}</details>
<details><summary>Complete before / after</summary>${pre({before:row.before, after:row.after})}</details></article>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>API source change review</title><style>
:root{font-family:system-ui,sans-serif;color:#202020;background:#f3f3f3}body{max-width:1100px;margin:auto;padding:32px;overflow-wrap:anywhere}header,article,section{background:#fff;border:1px solid #c9c9c9;padding:22px;margin:0 0 18px}h1{font-size:28px;margin:8px 0 16px}h2{font-size:17px;overflow-wrap:anywhere}p{line-height:1.55}code,pre{font-family:ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f5f5f5;border:1px solid #ddd;padding:14px;max-height:520px;overflow:auto;font-size:12px}summary{cursor:pointer;padding:12px 0}details+details{border-top:1px solid #ddd}.small{font-size:13px;color:#555}@media(max-width:640px){body{padding:12px}header,article,section{padding:16px}h1{font-size:24px}}@media print{body{padding:0;background:#fff}pre{max-height:none}article{break-inside:avoid}}
</style></head><body><header><p class="small">STELLAR FORGE / API MERCHANT</p><h1>API source change review</h1>
<p>Baseline <strong>${htmlEscape(document.baseline.name)}</strong> · ${report.ready ? 'Ready for explicit export' : 'Resolve selections before export'}</p>
<p class="small">Review identity</p><code>${report.reviewId}</code><p>Retained ${report.summary.retained} · Mapped ${report.summary.mapped} · Removed ${report.summary.removed} · Added ${report.summary.added}</p>
<p>The original merchant compiler generated these offers and backend bindings. Review changed URLs, request and response contracts, authentication references and runtime policies before exporting.</p></header>
${report.issues.length ? '<section><h2>Required decisions</h2>' + pre(report.issues) + '</section>' : ''}${rows}
<section><details><summary>Unselected source operations (${report.unselected.length})</summary>${pre(report.unselected)}</details>
<details><summary>All source-document changes (${report.sourceChanges.length})</summary>${pre(report.sourceChanges)}</details>
<details><summary>Resulting merchant plan</summary>${pre(report.plan)}</details>
<p class="small">Source SHA-256: ${report.baseline.sourceSha256} → ${report.candidate.sourceSha256}. Review files contain private API configuration and should stay with the operator.</p></section></body></html>\n`;
}
function argumentsOf(args) {
  const command = args[0];
  if (args.length === 0 || args.length === 1 && ['--help', 'help'].includes(command)) return {command:'help'};
  const allowed = {review:['parent','baseline','spec','decisions','out','html'], show:['review','html'], export:['parent','review','review-id','name']}[command];
  if (!allowed) throw new TypeError(usage);
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !allowed.includes(name) || Object.hasOwn(options, name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(usage);
    options[name] = args[i + 1];
  }
  const required = {review:['parent','baseline','spec','out'], show:['review'], export:['parent','review','review-id','name']}[command];
  if (required.some(name => !options[name])) throw new TypeError(usage);
  return {command, options};
}
export async function run(args = process.argv.slice(2)) {
  const {command, options:o} = argumentsOf(args);
  if (command === 'help') { console.log(usage); return; }
  if (command === 'export') {
    const result = await exportRefreshReview({parent:resolve(o.parent), document:await readRefreshReview(o.review), reviewId:o['review-id'], name:o.name});
    console.log(json(result));
    return result;
  }
  const document = command === 'show' ? await readRefreshReview(o.review) : await createRefreshReview({
    parent:resolve(o.parent), baselineName:o.baseline, candidateSpecText:await textFile(o.spec, 4 * 1024 * 1024),
    decisions:o.decisions ? JSON.parse(await textFile(o.decisions, 4 * 1024 * 1024)) : {},
  });
  if (command === 'review') await writeNew(o.out, json(document));
  if (o.html) await writeNew(o.html, renderRefreshReview(document));
  const result = {reviewId:document.report.reviewId, ready:document.report.ready, baseline:document.baseline.name,
    summary:document.report.summary, issues:document.report.issues,
    reviewFile:resolve(command === 'review' ? o.out : o.review), ...(o.html ? {html:resolve(o.html)} : {})};
  console.log(json(result));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
