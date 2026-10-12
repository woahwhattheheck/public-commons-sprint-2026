// MIT. SDMX edition selections through the ORIGINAL SF88 buyer and receiving flow.
import { constants } from 'node:fs';
import { open, link, rm, mkdir, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSdmxMerchant } from './merchant.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../dataset-refresh/buyer-handoff.mjs';

const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function queryString(query) {
  if (!object(query) || Object.entries(query).some(([key, value]) =>
      typeof value !== 'string' || ['snapshot', 'cursor'].includes(key)))
    throw fault('SDMX_BUYER_QUERY_INVALID', 'Supply original first-page string query parameters; the selected edition supplies snapshot.');
  const value = new URLSearchParams(Object.entries(query)).toString();
  if (value.length > 8192) throw fault('SDMX_BUYER_QUERY_INVALID', 'The query exceeds the native buyer limit.');
  return value;
}
export async function reviewSdmxBuyer({ directory, seller, query = {} } = {}) {
  const release = await readSdmxMerchant(directory);
  const review = await readDatasetBuyerOffer({ seller, resource: release.manifest.resource,
    snapshot: release.manifest.snapshot, query: queryString(query) });
  return { ...review, edition: { release: release.manifest.id, project: release.manifest.project,
    snapshot: release.manifest.snapshot } };
}
async function saveExact(path, bytes) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw fault('SDMX_BUYER_DIRECTORY_INVALID', 'Select an original private buyer directory.');
  const temporary = join(directory, '.sdmx-buyer-' + randomUUID());
  let recovered = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const retained = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await retained.stat({ bigint: true });
        if (!before.isFile() || before.size !== BigInt(bytes.length))
          throw fault('SDMX_BUYER_CONFIG_CONFLICT', 'The selected output contains a different original buyer configuration.', 409);
        const existing = await retained.readFile();
        const after = await retained.stat({ bigint: true });
        if (!existing.equals(bytes) || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
          throw fault('SDMX_BUYER_CONFIG_CONFLICT', 'The selected output contains a different original buyer configuration.', 409);
        recovered = true;
      } finally { await retained.close(); }
    }
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally { await rm(temporary, { force: true }); }
  return { path, bytes: bytes.length, sha256: digest(bytes), recovered };
}
/** Reload the original live offer immediately before its reviewed preparation.
 * The result is the original SF88 draft. Existing operator setup supplies the
 * account, reservation policy and signer; this bridge never creates a signer. */
export async function prepareSdmxBuyer({ directory, seller, query = {}, intentId,
  acceptIndex, offerSha256, destination } = {}) {
  const review = await reviewSdmxBuyer({ directory, seller, query });
  const prepared = prepareDatasetBuyer(review, { intentId, acceptIndex, offerSha256 });
  const bytes = Buffer.from(prepared.configText, 'utf8');
  if (digest(bytes) !== prepared.configSha256)
    throw fault('SDMX_BUYER_CONFIG_CHANGED', 'The original buyer preparation returned inconsistent file identity.', 409);
  if (typeof destination !== 'string' || !destination)
    throw new TypeError('Choose a private output file for the original buyer configuration.');
  const saved = await saveExact(resolve(destination), bytes);
  return { ...prepared, edition: review.edition, saved };
}

const HELP = [
  'SDMX original buyer and receiving',
  'offer --release RELEASE_DIR --seller http://127.0.0.1:PORT [--query JSON_STRING_PARAMETERS]',
  'prepare --release RELEASE_DIR --seller http://127.0.0.1:PORT [--query JSON_STRING_PARAMETERS]',
  '        --intent ID --accept-index INDEX --offer-sha SHA256 --out PRIVATE_BUYER.json',
  '',
  'The following commands use the original SF88 dataset CLI unchanged:',
  'init --session PRIVATE_SESSION --config CONFIG --max-pages N --max-total-atomic AMOUNT',
  '     [--snapshot SHA256] [--max-rows N] [--max-page-bytes N]',
  '     Use --workspace ORIGINAL_OPERATOR_WORKSPACE instead of --config to reuse its account.',
  'status|run|recover --session PRIVATE_SESSION',
  'export|deliver --session PRIVATE_SESSION --out DESTINATION',
  'accounting|finalize --session PRIVATE_SESSION [original SF88 options]',
  '',
  'Each live offer is read from the original seller; preparation pins the selected SDMX snapshot.',
  'run retains original per-page quote review, operator reservation and native buyer execution.',
  'recover reads the original attempt; deliver retains the original dataset data-room files.',
].join('\n') + '\n';
function options(args) {
  const [action, ...tokens] = args;
  const allowed = action === 'offer' ? ['--release', '--seller', '--query']
    : ['--release', '--seller', '--query', '--intent', '--accept-index', '--offer-sha', '--out'];
  const flags = {};
  if (tokens.length % 2) throw new TypeError('Each buyer option requires its value.');
  for (let i = 0; i < tokens.length; i += 2) {
    if (!allowed.includes(tokens[i]) || Object.hasOwn(flags, tokens[i]) ||
        !tokens[i + 1] || tokens[i + 1].startsWith('--'))
      throw new TypeError('Unknown, repeated or missing SDMX buyer option.');
    flags[tokens[i]] = tokens[i + 1];
  }
  const required = name => {
    if (!flags[name]) throw new TypeError(name + ' is required.');
    return flags[name];
  };
  let query;
  try {
    if ((flags['--query'] ?? '{}').length > 8192) throw new Error();
    query = JSON.parse(flags['--query'] ?? '{}');
  } catch { throw fault('SDMX_BUYER_QUERY_INVALID', 'Use a JSON object of original string query parameters.'); }
  const result = { directory: required('--release'), seller: required('--seller'), query };
  if (action === 'prepare') {
    const index = required('--accept-index');
    if (!/^(0|[1-9][0-9]*)$/.test(index) || !Number.isSafeInteger(Number(index)))
      throw new TypeError('--accept-index must be the displayed zero-based payment alternative.');
    Object.assign(result, { intentId: required('--intent'), acceptIndex: Number(index),
      offerSha256: required('--offer-sha'), destination: required('--out') });
  }
  return { action, input: result };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['help', '--help'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  if (['init', 'status', 'run', 'recover', 'export', 'deliver', 'accounting', 'finalize'].includes(args[0]))
    return (await import('../../sf88-operator-buyer-cli/dataset-cli.mjs')).main(args);
  if (!['offer', 'prepare'].includes(args[0])) throw new TypeError(HELP);
  const { action, input } = options(args);
  const report = action === 'offer' ? await reviewSdmxBuyer(input) : await prepareSdmxBuyer(input);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'SDMX_BUYER', message: error.message }) + '\n'); process.exitCode = 1; });
