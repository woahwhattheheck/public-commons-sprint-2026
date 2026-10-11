// MIT. Process boundary for original SF100 appendMany; no alternate archive/export format.
import { isAbsolute, resolve } from 'node:path';
import { appendMany } from '../sf100-buyer-dataset-delivery/deliver.mjs';

const MAX_INPUT = 16 * 1024 * 1024;
const exactPath = value => typeof value === 'string' && isAbsolute(value) &&
  resolve(value) === value && !value.includes('\0');
try {
  if (process.argv.length !== 3 || !exactPath(process.argv[2])) throw new Error();
  const chunks = [];
  let size = 0;
  for await (const bytes of process.stdin) {
    size += bytes.length;
    if (size > MAX_INPUT) throw new Error();
    chunks.push(bytes);
  }
  const inputs = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4096) throw new Error();
  for (const item of inputs) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => !['page','intent','evidence','cursor'].includes(key)) ||
        !exactPath(item.page) || !exactPath(item.evidence) ||
        typeof item.intent !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(item.intent) ||
        (item.cursor !== undefined && (typeof item.cursor !== 'string' ||
          !/^[A-Za-z0-9_-]{1,512}$/.test(item.cursor)))) throw new Error();
  }
  const result = await appendMany(process.argv[2], inputs);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  // Native diagnostics can contain source data. The parent returns a stable local error.
  process.stderr.write('Original SF100 batch append did not complete. Existing files retained.\n');
  process.exitCode = 1;
}
