#!/usr/bin/env node
// MIT. Standalone replay for the original native operations in an IRIS handoff.
import { open, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const SHA = /^[a-f0-9]{64}$/, LIMIT = 128 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const stable = value => value === null || typeof value !== 'object' ? value : Array.isArray(value)
  ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
async function bytes(path, maximum = LIMIT) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await f.stat(); need(s.isFile() && s.size > 0 && s.size <= maximum, 'REPLAY_FILE_INVALID');
    const data = await f.readFile(); need(data.length === s.size && data.length <= maximum, 'REPLAY_FILE_CHANGED'); return data;
  } finally { await f.close(); }
}
export async function replay({ directory, python = 'python3', manifestSha256 } = {}) {
  const root = resolve(directory ?? dirname(fileURLToPath(import.meta.url)));
  const raw = await bytes(join(root, 'handoff.json'), 16 * 1024 * 1024);
  if (manifestSha256 !== undefined) need(SHA.test(manifestSha256) && digest(raw) === manifestSha256, 'REPLAY_MANIFEST_CHANGED');
  const manifest = JSON.parse(raw);
  need(manifest.schema === 'ers-iris.handoff.v1' && Array.isArray(manifest.artifacts) && Array.isArray(manifest.operations), 'REPLAY_MANIFEST_INVALID');
  const pins = new Map();
  for (const pin of manifest.artifacts) {
    need(pin.artifact === true && SHA.test(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= LIMIT, 'REPLAY_ARTIFACT_INVALID');
    const data = await bytes(join(root, 'artifacts', pin.sha256));
    need(data.length === pin.bytes && digest(data) === pin.sha256, 'REPLAY_ARTIFACT_CHANGED'); pins.set(pin.sha256, pin);
  }
  const selected = pin => { need(pin?.artifact === true && pins.has(pin.sha256) && pins.get(pin.sha256).bytes === pin.bytes, 'REPLAY_REFERENCE_INVALID'); return join(root, 'artifacts', pin.sha256); };
  const outcomes = [];
  for (const operationId of manifest.operations) {
    need(SHA.test(operationId) && pins.has(operationId), 'REPLAY_OPERATION_INVALID');
    const operation = JSON.parse(await bytes(join(root, 'artifacts', operationId)));
    need(operation.schema === 'ers-iris.native-operation.v1' && ['transmission', 'extract', 'ack', 'failure', 'plan'].includes(operation.command), 'REPLAY_OPERATION_INVALID');
    const temporary = await mkdtemp(join(tmpdir(), 'iris-domain-replay-'));
    try {
      const args = [selected(operation.engine), operation.command, '--input', selected(operation.input)];
      for (const [key, flag] of [['utid', '--utid'], ['receiptId', '--receipt-id'], ['httpStatus', '--http-status'], ['operation', '--operation']])
        if (operation.parameters[key] !== undefined && operation.parameters[key] !== null) args.push(flag, String(operation.parameters[key]));
      if (operation.parameters.mapping) args.push('--mapping', selected(operation.parameters.mapping));
      const output = join(temporary, 'projection.csv');
      if (operation.command === 'extract') args.push('--output', output);
      const schema = operation.schemaPackage;
      if (schema?.mode === 'xsd') {
        const base = join(temporary, 'schema'); await mkdir(base, { mode: 0o700 });
        const safe = path => typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\') && path.split('/').every(part => part && part !== '..' && part !== '.');
        need(safe(schema.entry) && Array.isArray(schema.files), 'REPLAY_SCHEMA_INVALID');
        for (const file of schema.files) {
          need(safe(file.path), 'REPLAY_SCHEMA_INVALID'); const path = join(base, file.path);
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await writeFile(path, await bytes(selected(file.file)), { flag: 'wx', mode: 0o600 });
        }
        args.push('--xsd', join(base, schema.entry), '--schema-root', base);
      }
      const result = await new Promise((yes, no) => {
        const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'ignore'] }); const parts = [];
        let size = 0, failure;
        const timer = setTimeout(() => { failure = new Error('REPLAY_TIMEOUT'); child.kill('SIGKILL'); }, 60000);
        child.stdout.on('data', data => { size += data.length; if (size > LIMIT) { failure = new Error('REPLAY_OUTPUT_LIMIT'); child.kill('SIGKILL'); } else parts.push(data); });
        child.on('error', () => { failure = new Error('REPLAY_PYTHON_REQUIRED'); });
        child.on('close', code => { clearTimeout(timer); if (failure) return no(failure); if (code !== 0) return no(new Error('REPLAY_NATIVE_FAILED'));
          try { yes(JSON.parse(Buffer.concat(parts))); } catch { no(new Error('REPLAY_NATIVE_RESPONSE')); } });
      });
      const expected = JSON.parse(await bytes(selected(operation.result)));
      need(JSON.stringify(stable(result)) === JSON.stringify(stable(expected)), 'REPLAY_RESULT_CHANGED');
      if (operation.output) {
        const projected = await bytes(output);
        need(projected.length === operation.output.bytes && digest(projected) === operation.output.sha256, 'REPLAY_PROJECTION_CHANGED');
      }
      outcomes.push({ operationId, command: operation.command, matchesRetainedResult: true });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return { schema: 'ers-iris.replay-result.v1', familyId: manifest.familyId, manifestSha256: digest(raw),
    verifiedArtifacts: pins.size, operations: outcomes, matchesRetainedResults: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  try {
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = { '--directory': 'directory', '--python': 'python', '--manifest-sha256': 'manifestSha256' }[process.argv[index]];
      need(key && process.argv[index + 1] && !Object.hasOwn(options, key), 'REPLAY_ARGUMENT_INVALID'); options[key] = process.argv[index + 1];
    }
    process.stdout.write(JSON.stringify(await replay(options)) + '\n');
  } catch (error) { process.stderr.write(/^[A-Z_]+$/.test(error.message) ? error.message + '\n' : 'IRIS_REPLAY_FAILED\n'); process.exitCode = 1; }
}
