#!/usr/bin/env node
// MIT. Local-only source-document intake; this command never fetches a URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildCrossrefDocumentEdition, validateCrossrefDocumentEdition} from './crossref-documents.mjs';
import {sha256, need, object} from '../../sf30-seller-sdk/crossref/metadata.mjs';

const HELP = 'Usage: node crossref-document-cli.mjs --provenance FILE --source-dir DIRECTORY --query TEXT --output FILE\n' +
  '  [--label TEXT] [--doi DOI ...] [--updates-doi DOI ...] [--supporting RELATIVE_FILE ...]\n' +
  'The provenance JSON supplies sources[{filename,source_url,bytes,sha256}]. Original source and provenance bytes are retained.\n' +
  'Optional per-source retrieved_at and provenance preserve observed information; an absent upstream timestamp stays null.\n';

function options(argv) {
  const result = {dois:[], updatesDois:[], supporting:[]};
  const singular = new Set(['provenance','source-dir','query','output','label']);
  const multiple = new Set(['doi','updates-doi','supporting']);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { result.help = true; continue; }
    need(argument.startsWith('--'), 'CROSSREF_DOCUMENT_CLI_ARGUMENT_INVALID');
    const key = argument.slice(2);
    need(singular.has(key) || multiple.has(key), 'CROSSREF_DOCUMENT_CLI_OPTION_UNKNOWN');
    const value = argv[++index];
    need(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'CROSSREF_DOCUMENT_CLI_VALUE_REQUIRED');
    if (singular.has(key)) {
      need(result[key] === undefined, 'CROSSREF_DOCUMENT_CLI_OPTION_DUPLICATED');
      result[key] = value;
    } else result[key === 'doi' ? 'dois' : key === 'updates-doi' ? 'updatesDois' : 'supporting'].push(value);
  }
  if (!result.help) for (const key of ['provenance','source-dir','query','output'])
    need(typeof result[key] === 'string', 'CROSSREF_DOCUMENT_CLI_REQUIRED_OPTION');
  return result;
}
async function boundedFile(file, maxBytes) {
  const handle = await fs.open(file, 'r');
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size > 0 && info.size <= maxBytes, 'CROSSREF_DOCUMENT_FILE_SIZE_INVALID');
    const parts = [], buffer = Buffer.alloc(Math.min(64 * 1024, info.size + 1));
    let total = 0;
    while (true) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      need(total <= maxBytes, 'CROSSREF_DOCUMENT_FILE_SIZE_INVALID');
      parts.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    need(total === info.size, 'CROSSREF_DOCUMENT_FILE_CHANGED');
    return Buffer.concat(parts, total);
  } finally { await handle.close(); }
}
async function sourceFile(root, relative) {
  need(typeof relative === 'string' && relative && !path.isAbsolute(relative) &&
    !/^[A-Za-z]:|[\\\u0000-\u001f\u007f]/.test(relative) &&
    relative.split('/').every(part => part && part !== '.' && part !== '..'), 'CROSSREF_DOCUMENT_SOURCE_PATH_INVALID');
  const actual = await fs.realpath(path.resolve(root, relative));
  const within = path.relative(root, actual);
  need(within && !within.startsWith('..' + path.sep) && within !== '..' && !path.isAbsolute(within),
    'CROSSREF_DOCUMENT_SOURCE_PATH_OUTSIDE_ROOT');
  return actual;
}
async function saveExact(file, bytes) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  let previous;
  try { previous = await boundedFile(file, 64 * 1024 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    need(previous.equals(bytes), 'CROSSREF_DOCUMENT_OUTPUT_EXISTS_DIFFERENT');
    return {reused:true};
  }
  const temporary = file + '.pending-' + randomUUID();
  const handle = await fs.open(temporary, 'wx', 0o600);
  let linked = false;
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    try { await fs.link(temporary, file); linked = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const concurrent = await boundedFile(file, 64 * 1024 * 1024);
      need(concurrent.equals(bytes), 'CROSSREF_DOCUMENT_OUTPUT_EXISTS_DIFFERENT');
    }
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return {reused:!linked};
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function main() {
  const input = options(process.argv.slice(2));
  if (input.help) { process.stdout.write(HELP); return; }
  const root = await fs.realpath(input['source-dir']);
  const manifestPath = await fs.realpath(input.provenance);
  const manifestBytes = await boundedFile(manifestPath, 16 * 1024 * 1024);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(manifestBytes)); }
  catch { need(false, 'CROSSREF_DOCUMENT_MANIFEST_JSON_INVALID'); }
  need(object(manifest) && Array.isArray(manifest.sources) && manifest.sources.length > 0 &&
    manifest.sources.length <= 1998, 'CROSSREF_DOCUMENT_MANIFEST_INVALID');
  const manifestSha256 = sha256(manifestBytes);
  const documents = [];
  for (const source of manifest.sources) {
    need(object(source) && typeof source.filename === 'string' && typeof source.source_url === 'string' &&
      Number.isSafeInteger(source.bytes) && source.bytes > 0 &&
      typeof source.sha256 === 'string' && /^[0-9a-f]{64}$/.test(source.sha256),
      'CROSSREF_DOCUMENT_MANIFEST_SOURCE_INVALID');
    const file = await sourceFile(root, source.filename);
    const body = await boundedFile(file, 16 * 1024 * 1024);
    need(body.length === source.bytes && sha256(body) === source.sha256, 'CROSSREF_DOCUMENT_MANIFEST_BYTES_MISMATCH');
    documents.push({
      filename:source.filename, body, sourceUrl:source.source_url, role:'source',
      retrievedAt:source.retrieved_at ?? source.retrievedAt ?? null,
      provenance:{
        manifestSha256, sourceEntry:source, transfer:manifest.transport ?? null,
        retainedAt:manifest.retained_at ?? null, originalProvenance:source.provenance ?? null
      }
    });
  }
  const manifestRelative = path.relative(root, manifestPath);
  const manifestName = manifestRelative && !manifestRelative.startsWith('..' + path.sep) &&
    manifestRelative !== '..' && !path.isAbsolute(manifestRelative)
    ? manifestRelative.split(path.sep).join('/') : path.basename(manifestPath);
  documents.push({filename:manifestName, body:manifestBytes, role:'provenance',
    provenance:{kind:'original-source-manifest', schema:manifest.schema ?? null}});
  for (const relative of input.supporting) {
    const body = await boundedFile(await sourceFile(root, relative), 16 * 1024 * 1024);
    documents.push({filename:relative, body, role:'supporting-document', provenance:{kind:'supplied-supporting-document'}});
  }
  const envelope = buildCrossrefDocumentEdition({
    documents, query:input.query, ...(input.label ? {label:input.label} : {}),
    ...(input.dois.length ? {dois:input.dois} : {}),
    ...(input.updatesDois.length ? {updatesDois:input.updatesDois} : {})
  });
  validateCrossrefDocumentEdition(envelope);
  const bytes = Buffer.from(JSON.stringify(envelope, null, 2) + '\n');
  need(bytes.length <= 64 * 1024 * 1024, 'RESEARCH_RESPONSE_TOO_LARGE');
  const output = path.resolve(input.output);
  const saved = await saveExact(output, bytes);
  const readback = await boundedFile(output, 64 * 1024 * 1024);
  need(readback.equals(bytes), 'CROSSREF_DOCUMENT_OUTPUT_READBACK_MISMATCH');
  process.stdout.write(JSON.stringify({
    schema:'stellar-forge.crossref-document-intake-receipt.v1', provider:envelope.provider,
    output, bytes:bytes.length, sha256:sha256(bytes), reused:saved.reused,
    sourceDocuments:envelope.usage.sourcePages, originalDocuments:envelope.originalDocuments.length,
    results:envelope.results.length, coverage:envelope.usage.coverage,
    requestedDois:envelope.usage.requestedDois, updateRequestedDois:envelope.usage.updateRequestedDois,
    updates:envelope.usage.updates.map(({documents,...row}) => row),
    warnings:envelope.warnings
  }, null, 2) + '\n');
}
main().catch(error => {
  process.stderr.write(JSON.stringify({code:error.code ?? 'CROSSREF_DOCUMENT_INTAKE_FAILED', message:error.message}) + '\n');
  process.exitCode = 1;
});
