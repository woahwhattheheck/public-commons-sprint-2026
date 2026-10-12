#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { buildTransfer, renderMarkdown, renderReview } from './transfer.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function parseArguments(argv) {
  const args = {};
  const accepted = new Set(['source', 'profile', 'out', 'source-ref']);
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--help') return { help: true };
    if (!item.startsWith('--') || !accepted.has(item.slice(2))) throw new Error('Unknown argument: ' + item);
    const key = item.slice(2);
    if (args[key] !== undefined) throw new Error('Repeated argument: ' + item);
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Missing value for ' + item);
    args[key] = argv[++index];
  }
  for (const key of ['source', 'profile', 'out']) {
    if (!args[key]) throw new Error('Required: --' + key);
  }
  return args;
}

/** Read once, render completely, then create a new private output directory. */
export async function writeTransfer({ sourcePath, profilePath, outputDirectory, sourceReference = null }) {
  const [sourceBytes, profileBytes] = await Promise.all([readFile(sourcePath), readFile(profilePath)]);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const source = decoder.decode(sourceBytes);
  const profile = JSON.parse(decoder.decode(profileBytes));
  const transfer = buildTransfer(source, profile, {
    filename: path.basename(sourcePath),
    sha256: digest(sourceBytes),
    sizeBytes: sourceBytes.length,
    ...(sourceReference ? { reference: sourceReference } : {}),
  });
  const files = new Map();
  for (const field of transfer.fields) files.set('fields/' + field.filename, field.value);
  files.set('fields.json', JSON.stringify(transfer, null, 2) + '\n');
  files.set('application.md', renderMarkdown(transfer));
  files.set('review.html', renderReview(transfer));
  const manifest = {
    schema: 'starforge.application-transfer-manifest.v1',
    generatedAt: new Date().toISOString(),
    source: transfer.source,
    profile: { filename: path.basename(profilePath), sha256: digest(profileBytes) },
    summary: transfer.summary,
    fields: transfer.fields.map(field => ({
      id: field.id, filename: 'fields/' + field.filename, counts: field.counts,
      status: field.status, limits: field.limits, overages: field.overages,
      sourceRanges: field.sourceRanges,
    })),
    files: Array.from(files, ([filename, content]) => ({
      filename, sizeBytes: Buffer.byteLength(content), sha256: digest(content),
    })),
  };
  files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  const output = path.resolve(outputDirectory);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  await mkdir(path.join(output, 'fields'), { mode: 0o700 });
  // The manifest is written last. A failed write leaves an identifiable incomplete
  // new directory; the original source and existing output directories are untouched.
  for (const [filename, content] of files) {
    await writeFile(path.join(output, filename), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  return {
    status: 'exported',
    outputDirectory: output,
    sourceSha256: transfer.source.sha256,
    fileCount: files.size,
    fieldCount: transfer.fields.length,
    fieldsExceedingLimits: transfer.summary.fieldsExceedingLimits,
    fieldsWithoutLimits: transfer.summary.fieldsWithoutLimits,
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node cli.mjs --source MANUSCRIPT.md --profile FIELD-MAP.json --out NEW-DIRECTORY [--source-ref REFERENCE]\n');
    return;
  }
  const result = await writeTransfer({
    sourcePath: path.resolve(args.source),
    profilePath: path.resolve(args.profile),
    outputDirectory: args.out,
    sourceReference: args['source-ref'],
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.fieldsExceedingLimits.length) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({
      status: 'error', code: error.code ?? 'APPLICATION_TRANSFER_FAILED',
      message: error.message, ...(error.details ? { details: error.details } : {}),
    }) + '\n');
    process.exitCode = 1;
  });
}
