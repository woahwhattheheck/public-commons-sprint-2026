// MIT. Original sealed-file job inputs into the existing exact-number dataset workspace.
import { constants } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function retain(files, slot, path, signal) {
  const descriptor = files.metadata(slot);
  const target = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of files.stream(slot)) {
      signal.throwIfAborted(); bytes += chunk.length; hash.update(chunk);
      need(bytes <= descriptor.bytes, 'JOB_INPUT_FILE_CHANGED');
      let offset = 0;
      while (offset < chunk.length) {
        const result = await target.write(chunk, offset, chunk.length - offset);
        need(result.bytesWritten > 0, 'JOB_INPUT_COPY_FAILED'); offset += result.bytesWritten;
      }
    }
    await target.sync();
  } finally { await target.close(); }
  need(bytes === descriptor.bytes && hash.digest('hex') === descriptor.sha256, 'JOB_INPUT_FILE_CHANGED');
  return { path, descriptor };
}

export async function prepareDataset(input, context) {
  need(context.files && context.processes, 'JOB_INPUT_RECEIVER_REQUIRED');
  need(typeof input.reportName === 'string' && input.reportName.trim() && input.reportName.length <= 120 &&
    input.reportName.isWellFormed(),
    'JOB_INPUT_REPORT_NAME_INVALID');
  const python = process.env.SF30_NDJSON_PYTHON;
  need(typeof python === 'string' && isAbsolute(python), 'JOB_NATIVE_PYTHON_REQUIRED');
  need(typeof process.env.SF30_XML_NODE === 'string' && isAbsolute(process.env.SF30_XML_NODE),
    'JOB_NATIVE_NODE_REQUIRED');
  const root = await context.processes.directory();
  const originals = join(root, 'originals');
  await mkdir(originals, { mode: 0o700 });
  const retained = {};
  for (const { slot } of context.files.list()) {
    need(['source', 'baseline', 'mapping'].includes(slot), 'JOB_INPUT_SLOT_NOT_ALLOWED');
    retained[slot] = await retain(context.files, slot, join(originals, slot + '.bin'), context.signal);
  }
  const request = { schema: 'stellar-forge.ndjson-file-job.v1', jobId: context.jobId,
    attemptId: context.attemptId, input, files: retained };
  const requestPath = join(root, 'request.json');
  await writeFile(requestPath, JSON.stringify(request) + '\n', { flag: 'wx', mode: 0o600 });
  const result = await context.processes.run({
    command: [python, '-B', '-I', fileURLToPath(new URL('./service.py', import.meta.url)),
      '--request', requestPath, '--directory', join(root, 'delivery')],
    cwd: root, maxStdoutBytes: 131072, maxStderrBytes: 65536,
  });
  context.signal.throwIfAborted();
  need(result.exitCode === 0 && result.signal === null, 'JOB_NATIVE_DATASET_FAILED');
  let outcome;
  try { outcome = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)); }
  catch { need(false, 'JOB_NATIVE_DATASET_RESULT_INVALID'); }
  need(outcome.schema === 'stellar-forge.ndjson-file-job-result.v1' &&
    outcome.jobId === context.jobId && outcome.file === join(root, 'result.zip') &&
    Number.isSafeInteger(outcome.bytes) && outcome.bytes <= 67108864, 'JOB_NATIVE_DATASET_RESULT_INVALID');
  const file = await open(outcome.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) &&
      before.size === outcome.bytes, 'JOB_NATIVE_DATASET_RESULT_INVALID');
    const body = await file.readFile(), after = await file.stat();
    need(body.length === outcome.bytes && sha256(body) === outcome.sha256 &&
      before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'JOB_NATIVE_DATASET_RESULT_CHANGED');
    return body;
  } finally { await file.close(); }
}
