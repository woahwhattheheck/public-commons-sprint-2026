// MIT. Open an original SF100 data room with its reviewed native manifest identity.
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { scan } from '../../../sf100-buyer-dataset-delivery/deliver.mjs';
import { DatasetFile } from '../../../sf88-operator-buyer-cli/node/dataset.mjs';

const HASH = /^[a-f0-9]{64}$/;
const need = (condition, message) => {
  if (!condition) throw Object.assign(new Error(message), { code: 'NDJSON_SOURCE_DELIVERY_CHANGED' });
};
export async function inspectNdjsonDataRoom({ directory, expectedManifestSha256, snapshot } = {}) {
  need(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory &&
    HASH.test(expectedManifestSha256 ?? '') && HASH.test(snapshot ?? ''),
    'Select the original data room, reviewed manifest SHA256 and reviewed snapshot.');
  const state = await scan(directory, { retainPayload: false });
  need(state.finalized && state.pages.length > 0 && state.nextCursor === null &&
    state.count === state.total && state.snapshot === snapshot,
    'The original SF100 source delivery must be complete at the reviewed snapshot.');
  const manifestPath = join(directory, 'manifest.json'), info = await lstat(manifestPath);
  need(info.isFile() && !info.isSymbolicLink() && info.size <= 4 * 1024 * 1024,
    'Use the original bounded data room manifest.');
  const manifestFile = new DatasetFile({ name: 'manifest.json', path: manifestPath,
    bytes: info.size, sha256: expectedManifestSha256 }, directory);
  const manifest = await manifestFile.json({ limit: 4 * 1024 * 1024 });
  const dataset = { name: state.name, snapshot: state.snapshot, rows: state.count,
    projectedFields: state.fields, filters: state.filters, ranges: state.ranges,
    order: state.order ?? 'csv-record-order', originalQueryHash: state.queryHash,
    originalQuerySignature: state.pages[0].signature };
  const sourcePages = state.pages.map(page => ({ index: page.index, intent: page.intent,
    sourceSha256: page.sourceSha256, evidenceSha256: page.evidenceSha256,
    recordDigest: page.chain, rows: page.returned, requestedCursor: page.requestCursor }));
  need(manifest.schema === 'stellar-forge.buyer-delivery-manifest.v1' &&
    isDeepStrictEqual(manifest.dataset, dataset) && isDeepStrictEqual(manifest.sourcePages, sourcePages) &&
    manifest.chainDigest === state.chain &&
    Object.keys(manifest.outputs ?? {}).sort().join('\0') === ['dataset.csv','dataset.jsonl','review.html'].join('\0'),
    'The finalized data room differs from its original page archive.');
  const outputs = { 'manifest.json': { path: manifestPath, bytes: info.size, sha256: expectedManifestSha256 } };
  for (const name of ['dataset.jsonl', 'dataset.csv', 'review.html']) {
    const metadata = { name, path: join(directory, name), ...manifest.outputs[name] };
    const original = new DatasetFile(metadata, directory);
    for await (const chunk of original.chunks()) void chunk;
    outputs[name] = { path: metadata.path, bytes: metadata.bytes, sha256: metadata.sha256 };
  }
  return { schema: 'stellar-forge.ndjson-source-delivery.v1', directory,
    manifestSha256: expectedManifestSha256, snapshot, rows: state.count, fields: state.fields,
    pages: state.pages.length, complete: true, finalized: true,
    chainDigest: state.chain, sourcePages, outputs, paymentStatus: manifest.paymentStatus };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index += 2) {
      need(['--directory','--manifest-sha256','--snapshot'].includes(args[index]) &&
        typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--') &&
        !Object.hasOwn(options, args[index]), 'Supply the three original data room selectors.');
      options[args[index]] = args[index + 1];
    }
    console.log(JSON.stringify(await inspectNdjsonDataRoom({ directory: options['--directory'],
      expectedManifestSha256: options['--manifest-sha256'], snapshot: options['--snapshot'] }), null, 2));
  } catch (error) { console.error('NDJSON source delivery: ' + error.message); process.exitCode = 1; }
}
