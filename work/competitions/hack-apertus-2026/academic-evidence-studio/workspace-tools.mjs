#!/usr/bin/env node
/** Offline inspection and selected-citation export for the published workspace/v1 format. */
import { createHash } from 'node:crypto';
import { open, lstat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { restoreWorkspace, exportReport } from './workspace.mjs';
export const MAX_BYTES = 2 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const invalid = (code, message) => Object.assign(Error(message), { code });

export function inspectBytes(bytes) {
  if (bytes.byteLength > MAX_BYTES) throw invalid('TOO_LARGE', 'Workspace file exceeds 2 MiB');
  let saved;
  try { saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw invalid('INVALID_JSON', 'Workspace must be valid UTF-8 JSON'); }
  const workspace = restoreWorkspace(saved);
  // UI restore intentionally repairs imported evidence. A verifier must instead report
  // a mismatch: otherwise a damaged file would misleadingly receive an integrity pass.
  if (!isDeepStrictEqual(saved, workspace)) throw invalid('NON_CANONICAL_ARCHIVE', 'Saved fields or citation records differ from their reconstructed values');
  const claims = workspace.claims;
  return { workspace, receipt: {
    schema: 'academic-evidence-workspace-inspection/v1', status: 'INTEGRITY_VALID',
    archive_sha256: hash(bytes), workspace_sha256: hash(canonical(workspace)),
    sources: workspace.sources.length, claims: claims.length,
    reviewed_claims: claims.filter(c => c.review.decision !== 'pending').length,
    selected_citations: claims.reduce((n, c) => n + c.review.evidence_ids.length, 0),
    reviewer_authenticated: false, model_execution_verified: false, organizer_submission_verified: false,
    notice: 'Source and citation consistency checked. Reviewer labels and decisions are self-declared; hashes do not authenticate authors or establish scientific truth.',
  } };
}
export async function inspectFile(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw invalid('NOT_REGULAR_FILE', 'Workspace input must be a regular file');
    if (stat.size > MAX_BYTES) throw invalid('TOO_LARGE', 'Workspace file exceeds 2 MiB');
    const chunks = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > MAX_BYTES) throw invalid('TOO_LARGE', 'Workspace file exceeds 2 MiB');
      chunks.push(chunk);
    }
    return inspectBytes(Buffer.concat(chunks));
  } finally { await handle.close(); }
}
export function selectedCitations(workspace, workspaceHash) {
  const rows = [];
  for (const claim of workspace.claims) for (const id of claim.review.evidence_ids) {
    const e = claim.evidence.find(item => item.id === id);
    const source = workspace.sources.find(s => s.id === e.source_id);
    rows.push({
      schema: 'academic-selected-citation/v1', workspace_sha256: workspaceHash,
      claim_id: claim.id, claim: claim.text, decision: claim.review.decision,
      reviewer: claim.review.reviewer, review_note: claim.review.note, review_origin: 'user-entered',
      evidence_id: id, source_id: source.id, source_title: source.title,
      start: e.start, end: e.end, offset_unit: 'UTF-16', quote: source.body.slice(e.start, e.end),
      source_sha256: source.sha256, quote_sha256: e.quote_sha256,
    });
  }
  return rows;
}
export async function exportFiles(inputPath, options) {
  const { workspace, receipt } = await inspectFile(inputPath);
  const rows = selectedCitations(workspace, receipt.workspace_sha256);
  const outputs = [];
  if (options.report) outputs.push({ kind: 'markdown-report', path: resolve(options.report), body: exportReport(workspace) });
  if (options.citations) outputs.push({ kind: 'selected-citations-jsonl', path: resolve(options.citations), body: rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '') });
  if (!outputs.length) throw invalid('USAGE', 'Export requires --report or --citations');
  const names = new Set([resolve(inputPath)]);
  // Preflight every destination, then use exclusive creation as the race-safe guard.
  for (const output of outputs) {
    if (names.has(output.path)) throw invalid('OUTPUT_COLLISION', 'Input and output paths must be distinct');
    names.add(output.path);
    try { await lstat(output.path); throw invalid('OUTPUT_EXISTS', 'An output file already exists; no existing file will be overwritten'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const written = [];
  for (const output of outputs) {
    try { await writeFile(output.path, output.body, { flag: 'wx', mode: 0o600 }); }
    catch (error) { error.written_artifacts = written; throw error; }
    written.push({ kind: output.kind, filename: basename(output.path), sha256: hash(output.body), bytes: Buffer.byteLength(output.body) });
  }
  return { ...receipt, artifacts: written };
}
const usage = 'Usage:\n  node workspace-tools.mjs inspect WORKSPACE.json\n  node workspace-tools.mjs export WORKSPACE.json [--report REPORT.md] [--citations CITATIONS.jsonl]\nNo model calls. No network requests. Existing files are never overwritten.\n';
export async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return 0; }
  const [command, path, ...rest] = args;
  if (!['inspect', 'export'].includes(command) || !path) throw invalid('USAGE', usage);
  let result;
  if (command === 'inspect') {
    if (rest.length) throw invalid('USAGE', usage);
    result = (await inspectFile(path)).receipt;
  } else {
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      const option = rest[i]; const value = rest[i + 1];
      if (!['--report', '--citations'].includes(option) || !value || Object.hasOwn(options, option.slice(2))) throw invalid('USAGE', usage);
      options[option.slice(2)] = value;
    }
    result = await exportFiles(path, options);
  }
  console.log(JSON.stringify(result, null, 2)); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    const filesystem = ['EACCES', 'EPERM', 'ENOENT', 'EISDIR', 'EEXIST', 'ENOTDIR', 'ENOSPC'].includes(error.code);
    console.log(JSON.stringify({ status: 'INVALID_WORKSPACE', code: error.code || 'VALIDATION_FAILED',
      error: filesystem ? `File operation failed (${error.code})` : error.message,
      ...(error.written_artifacts ? { written_artifacts: error.written_artifacts } : {}),
    }, null, 2));
    process.exitCode = error.code === 'USAGE' ? 64 : 2;
  }
}
