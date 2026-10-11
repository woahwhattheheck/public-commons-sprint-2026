#!/usr/bin/env node
// MIT. Portable request import and recovery through the original SF88 Node Buyer.
import { readFile, lstat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const need = (ok, code) => { if (!ok) throw new Error(code); };
async function read(file) {
  const stat = await lstat(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576, 'CHAINSTACK_REQUEST_FILE_INVALID');
  const raw = await readFile(file); need(raw.length === stat.size, 'CHAINSTACK_REQUEST_FILE_CHANGED'); return raw;
}
const json = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(file)));
const optionsFor = {
  review: [['runtime', 'state', 'request', 'review-file'], ['profile']],
  execute: [['runtime', 'state', 'intent', 'review-file'], ['output']],
  recover: [['runtime', 'state', 'intent'], ['output']],
  inspect: [['runtime', 'state', 'intent'], []],
};
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') {
    process.stdout.write('buyer.mjs review --runtime SF88_DIRECTORY --state PRIVATE_STATE --request PREPARED_REQUEST_DIRECTORY --review-file NEW_REVIEW.json [--profile ORIGINAL_PROFILE.json]\n' +
      'buyer.mjs execute --runtime SF88_DIRECTORY --state PRIVATE_STATE --intent PURCHASE_ID --review-file SAVED_REVIEW.json [--output NEW_RESPONSE_FILE]\n' +
      'buyer.mjs recover|inspect --runtime SF88_DIRECTORY --state PRIVATE_STATE --intent PURCHASE_ID [--output NEW_RESPONSE_FILE]\n'); return;
  }
  const [command, ...tail] = args, definition = optionsFor[command], o = {};
  need(definition && tail.length % 2 === 0, 'CHAINSTACK_BUYER_COMMAND_INVALID');
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i].slice(2);
    need(tail[i].startsWith('--') && definition.flat().includes(key) && !Object.hasOwn(o, key) &&
      tail[i + 1] && !tail[i + 1].startsWith('--'), 'CHAINSTACK_BUYER_OPTIONS_INVALID'); o[key] = tail[i + 1];
  }
  need(definition[0].every(key => o[key]), 'CHAINSTACK_BUYER_OPTION_REQUIRED');
  const { Buyer } = await import(pathToFileURL(join(resolve(o.runtime), 'node', 'index.mjs')).href);
  const buyer = new Buyer({ runtimeDirectory: resolve(o.runtime), stateDirectory: resolve(o.state),
    ...(o.profile ? { operatorProfile: resolve(o.profile) } : {}) });
  if (command === 'review') {
    const folder = resolve(o.request), manifest = await json(join(folder, 'request.json'));
    need(manifest.schema === 'stellar-forge.chainstack-request.v1' && manifest.bodyFile === 'request.body.json' &&
      manifest.configFile === 'buyer-config.json', 'CHAINSTACK_REQUEST_MANIFEST_INVALID');
    const body = await read(join(folder, manifest.bodyFile)), config = await read(join(folder, manifest.configFile));
    need(body.length === manifest.bodyBytes && hash(body) === manifest.bodySha256 &&
      config.length === manifest.configBytes && hash(config) === manifest.configSha256, 'CHAINSTACK_REQUEST_CHANGED');
    const source = JSON.parse(config);
    need(source.operation.intentId === manifest.intentId, 'CHAINSTACK_REQUEST_INTENT_CHANGED');
    const operation = await buyer.fromConfig(source, { body, responseFile: { maxBytes: 1048576 } });
    const review = await operation.review();
    await writeFile(resolve(o['review-file']), JSON.stringify(review, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify(review, null, 2) + '\n'); return review;
  }
  const operation = buyer.operation(o.intent);
  if (command === 'inspect') {
    const state = await operation.inspect(); process.stdout.write(JSON.stringify(state, null, 2) + '\n'); return state;
  }
  const result = command === 'execute' ? await operation.execute({ review: await json(resolve(o['review-file'])) }) : await operation.recover();
  const summary = { intentId: o.intent, status: result.status, delivery: result.delivery };
  if (o.output) summary.exported = await result.saveAs(resolve(o.output));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n'); return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  const code = error.code ?? error.message;
  process.stderr.write((typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : 'CHAINSTACK_BUYER_FAILED') + '\n');
  process.exitCode = 1;
});
