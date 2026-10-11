#!/usr/bin/env node
// MIT. File-to-original-SF73/SF95 operations on a running local SF60 owner.
import { constants as FS } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestCatalogOperator } from './operator.mjs';

const USAGE = [
  'Live catalog operator (Node 22+, same OS user as operator.mjs):',
  '  status --directory DIR',
  '  list --directory DIR [--query "limit=20&offset=0"]',
  '  search --directory DIR --query "q=weather&limit=20"',
  '  lookup --directory DIR --catalog-key KEY',
  '  history --directory DIR --lifecycle-id ID',
  '  admit --directory DIR --seller ID --sequence N --entry ORIGINAL.json --proofs PROOFS.json',
  '        --source-url HTTPS --observed-at ISO_TIME [--out RECEIPT.json]',
  '  prepare-withdrawal --directory DIR --seller ID --catalog-key KEY',
  '        --source-url HTTPS --reason TEXT --out REQUEST.json',
  '  apply-withdrawal --directory DIR --envelope SELLER_SIGNED.json [--out RECEIPT.json]',
  'All commands support --out NEW_FILE and --request-id ID. No command signs or pays.',
  'Seller signing remains the original sf95-signed-seller-withdrawal/cli.mjs sign command.',
].join('\n');
const definitions = {
  status: { required: [] },
  list: { required: [], optional: ['query'] },
  search: { required: ['query'] },
  lookup: { required: ['catalog-key'] },
  history: { required: ['lifecycle-id'] },
  admit: { required: ['seller', 'sequence', 'entry', 'proofs', 'source-url', 'observed-at'] },
  'prepare-withdrawal': { required: ['seller', 'catalog-key', 'source-url', 'reason', 'out'] },
  'apply-withdrawal': { required: ['envelope'] },
};
function parse(argv) {
  const [operation, ...args] = argv, definition = definitions[operation];
  if (!definition || args.length % 2) throw new Error(USAGE);
  const required = ['directory', ...definition.required];
  const allowed = new Set([...required, ...(definition.optional ?? []), 'out', 'request-id']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !allowed.has(key) || Object.hasOwn(options, key) ||
        !value || value.startsWith('--')) throw new Error(USAGE);
    options[key] = value;
  }
  if (required.some(key => !Object.hasOwn(options, key))) throw new Error(USAGE);
  return { operation, options };
}
async function bytes(filename, limit) {
  const handle = await open(filename, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat();
    if (!meta.isFile() || meta.size < 1 || meta.size > limit) throw new Error('LOCAL_INPUT_SIZE_INVALID');
    const content = await handle.readFile();
    if (content.length !== meta.size) throw new Error('LOCAL_INPUT_CHANGED_DURING_READ');
    return content;
  } finally { await handle.close(); }
}
const json = async (filename, limit) => JSON.parse((await bytes(filename, limit)).toString('utf8'));

export async function run(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { console.log(USAGE); return; }
  const { operation, options: o } = parse(argv);
  let input = {};
  if (operation === 'list' || operation === 'search') {
    const query = new URLSearchParams(o.query ?? '');
    if (new Set(query.keys()).size !== [...query.keys()].length) throw new Error('DUPLICATE_QUERY_PARAMETER');
    input = { params: Object.fromEntries(query) };
  } else if (operation === 'lookup') input = { catalogKey: o['catalog-key'] };
  else if (operation === 'history') input = { lifecycleId: o['lifecycle-id'] };
  else if (operation === 'admit') {
    if (!/^[1-9][0-9]*$/.test(o.sequence) || !Number.isSafeInteger(Number(o.sequence))) {
      throw new Error('POSITIVE_SAFE_SEQUENCE_REQUIRED');
    }
    const [source, proofs] = await Promise.all([bytes(o.entry, 65536), json(o.proofs, 384 * 1024)]);
    input = { sellerId: o.seller, sequence: Number(o.sequence), sourceURL: o['source-url'],
      observedAt: o['observed-at'], sourceBase64: source.toString('base64'), proofs };
  } else if (operation === 'prepare-withdrawal') {
    input = { sellerId: o.seller, catalogKey: o['catalog-key'], sourceURL: o['source-url'], reason: o.reason };
  } else if (operation === 'apply-withdrawal') {
    input = { envelope: await json(o.envelope, 128 * 1024) };
  }
  // Reserve any output name before sending a mutation. A typo/existing file
  // therefore cannot turn a successful remote commit into a local save error.
  let output;
  if (o.out) output = await open(o.out, 'wx', 0o600);
  let result, requested = false, persisted = false;
  try {
    requested = true;
    result = await requestCatalogOperator({ directory: o.directory, operation, input,
      ...(o['request-id'] ? { requestId: o['request-id'] } : {}) });
    const text = JSON.stringify(result, null, 2) + '\n';
    if (output) {
      await output.writeFile(text); await output.sync(); persisted = true;
      console.log(JSON.stringify({ saved: resolve(o.out), operation, result }));
    } else console.log(text.trimEnd());
    return result;
  } catch (error) {
    if (result !== undefined) {
      // Retain the actual successful result if the local output fsync failed.
      console.error(JSON.stringify({ error: 'COMMAND_SUCCEEDED_OUTPUT_SAVE_FAILED', operation, result }));
    } else if (requested && error.commandSent === true && ['admit', 'apply-withdrawal'].includes(operation) &&
        !Number.isInteger(error.statusCode)) {
      console.error(JSON.stringify({ error: 'TRANSPORT_OUTCOME_UNKNOWN_CHECK_CATALOG', operation,
        requestId: error.requestId ?? o['request-id'] ?? null,
        inspect: 'Use status, lookup and history before any retry.' }));
    }
    throw error;
  } finally {
    if (output) {
      await output.close();
      if (!persisted && result === undefined) await unlink(o.out).catch(() => {});
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error?.message ?? String(error)); process.exitCode = 1; });
}
