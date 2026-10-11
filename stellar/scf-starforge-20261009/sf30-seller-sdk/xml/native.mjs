// MIT. Private pipe to the ORIGINAL immutable SF30 dataset engine; no alternate query implementation.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadDatasetConfig } from '../dataset-handler.mjs';
const source = await readFile(new URL('../dataset-handler.mjs', import.meta.url));
const engineBlob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
let loadedPath, dataset;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let input;
  try {
    if (Buffer.byteLength(line) > 65536) throw new TypeError('Native request exceeds 64 KiB');
    input = JSON.parse(line);
    if (!input || typeof input.config !== 'string' || !Number.isSafeInteger(input.id)) throw new TypeError('Invalid private request');
    if (input.config !== loadedPath) {
      // Retain only the selected immutable dataset, not a cache of every edition.
      dataset = undefined; loadedPath = undefined;
      dataset = await loadDatasetConfig(input.config); loadedPath = input.config;
    }
    const context = { query: input.query ?? {} };
    const admission = dataset.admit(context);
    const response = admission === true ? dataset.handle(context) : admission;
    process.stdout.write(JSON.stringify({ id: input.id, ok: true, engineBlob,
      dataset: dataset.describe(), response }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: input?.id ?? null, ok: false,
      error: error.message, code: error.code ?? 'DATASET_ERROR' }) + '\n');
  }
}
