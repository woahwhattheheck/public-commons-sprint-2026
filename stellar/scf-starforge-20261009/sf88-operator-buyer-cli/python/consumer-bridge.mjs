// MIT. Local Python consumers of the existing SF88 body and retained stream APIs.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), {code}); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const mode = 'ORIGINAL_PYTHON_STREAM_EXPORTED';
const schema = 'stellar-forge.python-stream-export.v1';
const runtimeDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

async function privateDirectory(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    'CONSUMER_PRIVATE_DIRECTORY_REQUIRED');
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 &&
    info.uid === process.getuid() && await realpath(path) === path,
    'CONSUMER_PRIVATE_DIRECTORY_REQUIRED');
}

async function input(path) {
  await privateDirectory(dirname(path));
  need(isAbsolute(path) && resolve(path) === path, 'CONSUMER_INPUT_PATH_INVALID');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.size <= 4194304 && (before.mode & 0o077) === 0 &&
      before.uid === process.getuid(), 'CONSUMER_INPUT_INVALID');
    const raw = await file.readFile(), after = await file.stat();
    need(raw.length === before.size && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
      'CONSUMER_INPUT_CHANGED');
    const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
    need(plain(value), 'CONSUMER_INPUT_INVALID');
    return {raw, value};
  } finally { await file.close(); }
}

async function write(path, raw) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(raw); await file.sync(); }
  finally { await file.close(); }
}

async function exportStream(request, destination) {
  const value = request.value;
  need(value.schema === 'stellar-forge.python-stream-request.v1' &&
    plain(value.record) && plain(value.record.native) && plain(value.responseFile) &&
    ['sse', 'ndjson'].includes(value.format) && plain(value.options) &&
    typeof value.options.allowPartial === 'boolean' &&
    Object.keys(value.options).every(key => ['allowPartial', 'maxRecordBytes', 'maxRecords'].includes(key)) &&
    Number.isSafeInteger(value.maxExportBytes) && value.maxExportBytes > 0 &&
    value.maxExportBytes <= 1073741824, 'CONSUMER_STREAM_OPTIONS_INVALID');
  await privateDirectory(destination);
  const {BuyerResult} = await import('../node/result.mjs');
  const original = new BuyerResult({...value.record, exitCode:value.record.returncode ?? value.record.exitCode},
    value.responseFile, runtimeDirectory);
  need(typeof original.events === 'function' && typeof original.ndjson === 'function',
    'ORIGINAL_STREAM_READER_REQUIRED');
  const records = original[value.format === 'sse' ? 'events' : 'ndjson'](value.options);
  const output = await open(join(destination, 'records.jsonl'), 'wx', 0o600);
  let count = 0, bytes = 0;
  const hash = createHash('sha256');
  try {
    // Exhaust the ORIGINAL reader before publishing a reusable export. It
    // verifies the entire saved/partial source both before and during parsing.
    for await (const item of records) {
      const record = value.format === 'sse' ? item : {index:count, format:'ndjson', value:item};
      need(record.index === count && record.format === value.format, 'ORIGINAL_STREAM_RECORD_INVALID');
      const raw = Buffer.from(JSON.stringify(record, (_key, value) => {
        need(typeof value !== 'number' || Number.isFinite(value), 'STREAM_EXPORT_NONFINITE_NUMBER');
        return value;
      }) + '\n', 'utf8');
      need(raw.length <= value.maxExportBytes - bytes, 'STREAM_EXPORT_BYTE_LIMIT');
      await output.writeFile(raw); hash.update(raw); bytes += raw.length; count++;
    }
    await output.sync();
  } finally { await output.close(); }
  const saved = original.delivery;
  const manifest = {schema, mode, requestSha256:sha(request.raw),
    format:value.format, records:count, complete:saved.status === 'SAVED',
    source:{intentId:value.record.intentId ?? value.record.native.intentId ?? null,
      configurationSha256:value.record.configSha256 ?? null,
      status:saved.status, path:saved.status === 'SAVED' ? saved.path : saved.partialPath,
      bytes:saved.bytes, sha256:saved.status === 'SAVED' ? saved.sha256 : saved.partialSha256,
      contentType:saved.contentType ?? null, stream:saved.stream ?? null},
    file:{path:'records.jsonl', bytes, sha256:hash.digest('hex'), contentType:'application/x-ndjson'},
    options:value.options, maxExportBytes:value.maxExportBytes,
    generatedAt:new Date().toISOString()};
  await write(join(destination, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  const directory = await open(destination, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); } finally { await directory.close(); }
  return manifest;
}

export async function main(args = process.argv.slice(2)) {
  const [action, inputFlag, inputPath, outputFlag, destination] = args;
  need(args.length === 5 && ['multipart', 'export-stream'].includes(action) &&
    inputFlag === '--input' && outputFlag === '--out', 'CONSUMER_COMMAND_INVALID');
  const request = await input(inputPath);
  let result;
  if (action === 'multipart') {
    const {prepareMultipartFile} = await import('../request-body.mjs');
    result = {mode:'ORIGINAL_PYTHON_MULTIPART_PREPARED',
      ...await prepareMultipartFile(request.value, destination)};
  } else result = await exportStream(request, destination);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'ORIGINAL_CONSUMER_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({error:code}) + '\n'); process.exitCode = 1;
  });
