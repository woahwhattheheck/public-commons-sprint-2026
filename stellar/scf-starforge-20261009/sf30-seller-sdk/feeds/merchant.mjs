// MIT. Retained feed editions in the original SF82 release and SF88 buyer lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease,
  stageDatasetRelease, inspectDatasetRelease, startDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../dataset-refresh/buyer-handoff.mjs';

const MiB = 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => hash(encode(canonical(value)));
const fail = message => { throw new TypeError(message); };
async function present(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function read(path, maximum = MiB) {
  path = resolve(path);
  if (await realpath(path) !== path) fail('Use canonical source files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail('Source file exceeds its supported size.');
    const bytes = await file.readFile(), after = await file.stat({ bigint: true });
    if (BigInt(bytes.length) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs) fail('Source file changed during capture.');
    return bytes;
  } finally { await file.close(); }
}
async function targetDirectory(path) {
  const target = resolve(path);
  if (join(await realpath(dirname(target)), basename(target)) !== target) fail('Use an existing canonical parent directory.');
  try { await mkdir(target, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(target);
  if (!info.isDirectory() || await realpath(target) !== target ||
      process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077)))
    fail('Use private operator-owned directories (mode 0700).');
  return target;
}
async function exactFile(path, bytes) {
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await read(path, bytes.length)).equals(bytes)) fail('The retained output differs; select a new output directory.');
    return;
  }
  const owned = await file.stat({ bigint:true });
  try { await file.writeFile(bytes); await file.sync(); }
  catch (error) {
    try {
      const current = await lstat(path, { bigint:true });
      if (current.dev === owned.dev && current.ino === owned.ino) await unlink(path);
    } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.cleanup = cleanupError.message; }
    throw error;
  } finally { await file.close(); }
}
const descriptor = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });

/** Exact feed export -> native dataset -> native version store -> original release.
 * The selected source package can be retried unchanged after an interrupted reply. */
export async function prepareFeedMerchant({ datasetExport, versionDirectory, packageDirectory, releaseDirectory,
  payment, origin, path = '/feed', retentionMs = 3600000, maxVersions = 4,
  maxRetainedBytes = 256 * MiB } = {}) {
  const input = resolve(datasetExport), out = resolve(packageDirectory), versionsPath = resolve(versionDirectory),
    releasePath = resolve(releaseDirectory);
  if (new Set([input, out, versionsPath, releasePath]).size !== 4)
    fail('Use separate export, package, version-store and release directories.');
  if (await realpath(input) !== input) fail('Use the canonical feed export directory.');
  const originalConfig = await read(join(input, 'dataset.json'));
  const config = parse(originalConfig);
  if (config.file !== 'data.csv') fail('Choose the original feed workspace dataset export.');
  const csv = await read(join(input, 'data.csv'), 256 * MiB);
  const feedBytes = await read(join(input, 'feed-lineage.json'), 256 * MiB);
  const xmlBytes = await read(join(input, 'xml-lineage.json'), 2 * MiB);
  const lineage = parse(feedBytes), xml = parse(xmlBytes);
  if (lineage.schema !== 'stellar-forge.feed-dataset-lineage.v1' ||
      !/^[a-f0-9]{64}$/.test(lineage.editionId ?? '') || lineage.buildId !== xml.id ||
      xml.files?.['data.csv']?.sha256 !== hash(csv) ||
      xml.files?.['dataset.json']?.sha256 !== hash(originalConfig))
    fail('The original feed edition, XML build and dataset export differ.');
  const dataset = await loadDatasetConfig(join(input, 'dataset.json')), description = dataset.describe();
  if (description.rowCount !== lineage.rowCount || !isDeepStrictEqual(description.columns.map(c => c.name), lineage.fields))
    fail('The native dataset differs from the selected feed projection.');
  const seller = await buildDatasetSellerConfig(dataset, { payment, origin, path });
  if (seller.routes[0].definition.queryParameters.length >= 32) fail('The original snapshot selector needs a native query slot.');
  seller.routes[0].definition.queryParameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
  const request = { schema:'stellar-forge.feed-merchant-request.v1', datasetExport:input, versionDirectory:versionsPath,
    packageDirectory:out, releaseDirectory:releasePath, editionId:lineage.editionId,
    csvSha256:hash(csv), configSha256:hash(originalConfig), feedLineageSha256:hash(feedBytes),
    xmlLineageSha256:hash(xmlBytes), payment, origin, path, retentionMs, maxVersions, maxRetainedBytes };
  await targetDirectory(out);
  await exactFile(join(out, 'feed-request.json'), encode({ ...request, requestSha256:fingerprint(request) }));
  await exactFile(join(out, 'dataset.csv'), csv);
  await exactFile(join(out, 'dataset.json'), encode({ ...config, file:'dataset.csv' }));
  await exactFile(join(out, 'seller.json'), encode(seller));
  await targetDirectory(join(out, 'provenance'));
  await exactFile(join(out, 'provenance', 'feed-lineage.json'), feedBytes);
  await exactFile(join(out, 'provenance', 'xml-lineage.json'), xmlBytes);
  const source = { schema:'stellar-forge.feed-merchant-source.v1', editionId:lineage.editionId, buildId:lineage.buildId,
    normalizedXmlSha256:xml.source, fields:lineage.fields, feedRevisions:lineage.revisions, rowCount:lineage.rowCount,
    sourceFiles:[descriptor('provenance/feed-lineage.json', feedBytes), descriptor('provenance/xml-lineage.json', xmlBytes)] };
  const sourceBytes = encode(source);
  await exactFile(join(out, 'source.json'), sourceBytes);
  await exactFile(join(out, 'binding.json'), encode({ schema:DATASET_BINDING_SCHEMA, datasetDirectory:versionsPath,
    contractSha256:datasetContractSha256(description), baselineSnapshot:description.snapshot, sourceSha256:hash(sourceBytes) }));
  const prepared = await prepareDatasetRelease(out);
  if (prepared.description.snapshot !== description.snapshot) fail('The original release changed the selected dataset snapshot.');
  // Input bytes are rechecked before the version writer is opened.
  if (!(await read(join(input, 'dataset.json'))).equals(originalConfig) ||
      !(await read(join(input, 'data.csv'), 256 * MiB)).equals(csv))
    fail('The original dataset export changed during preparation.');
  const existing = await present(join(versionsPath, 'state.json'));
  await targetDirectory(versionsPath);
  const versions = await openDatasetVersions({ directory:versionsPath, ...(existing ? {} :
    { initialConfig:join(out, 'dataset.json'), retentionMs, maxVersions, maxRetainedBytes }) });
  let status;
  try {
    status = versions.status();
    if (status.current !== description.snapshot || datasetContractSha256(versions.describe()) !== prepared.binding.contractSha256)
      fail('This version store currently serves another edition. Select a new store, or use the original guarded dataset refresh command.');
  } finally { await versions.close(); }
  let staged;
  if (await present(releasePath)) {
    staged = await inspectDatasetRelease(releasePath);
    if (!isDeepStrictEqual(staged.manifest.dataset, prepared.dataset) || !isDeepStrictEqual(staged.manifest.files, prepared.files))
      fail('The selected original release directory contains another source package.');
  } else {
    staged = await stageDatasetRelease(releasePath, out);
  }
  const result = { schema:'stellar-forge.feed-merchant-release.v1', editionId:lineage.editionId, buildId:lineage.buildId,
    snapshot:description.snapshot, rowCount:description.rowCount, versionDirectory:versionsPath,
    packageDirectory:out, releaseDirectory:releasePath, resource:seller.publicOrigin + path,
    offersSha256:staged.manifest.offersSha256, serviceConfigSha256:staged.manifest.serviceConfigSha256,
    sourceClosure:staged.manifest.dataset.sourceClosure, revision:status.revision, requestSha256:fingerprint(request) };
  await exactFile(join(out, 'feed-release.json'), encode(result));
  return result;
}

export async function reviewFeedBuyer(selection) {
  return readDatasetBuyerOffer(selection);
}

/** Re-read the actual original offer before preparing the selected SF88 config. */
export async function prepareFeedBuyer({ review, intentId, acceptIndex, outputDirectory }) {
  if (!review || typeof review !== 'object') fail('Select the retained original seller offer review.');
  const query = new URLSearchParams(review.query); query.delete('snapshot');
  const current = await readDatasetBuyerOffer({ seller:review.seller, resource:review.resource,
    snapshot:review.snapshot, query:query.toString() });
  const prepared = prepareDatasetBuyer(current, { intentId, acceptIndex, offerSha256:review.offerSha256 });
  const out = await targetDirectory(outputDirectory);
  await exactFile(join(out, 'offer-review.json'), encode(current));
  await exactFile(join(out, 'buyer.json'), Buffer.from(prepared.configText));
  const result = { schema:'stellar-forge.feed-buyer-handoff.v1', snapshot:current.snapshot, resource:current.resource,
    url:current.url, offerSha256:current.offerSha256, configSha256:prepared.configSha256,
    sellerMode:prepared.sellerMode, configuration:join(out, 'buyer.json'), review:join(out, 'offer-review.json') };
  await exactFile(join(out, 'handoff.json'), encode(result));
  return result;
}

const HELP = [
  'Original feed merchant and buyer handoff (Node 22+)',
  '',
  'merchant prepare --dataset-export DIR --state PRIVATE_VERSION_DIR --payment PUBLIC_TERMS.json',
  '  --origin https://api.example --path /feed --out NEW_PACKAGE_DIR --release NEW_RELEASE_DIR',
  '  [--retention-seconds 3600] [--max-versions 4] [--max-retained-bytes 268435456]',
  'merchant serve --release DIR [--port 8423] [--facilitator HTTPS_URL] [--allow-local-facilitator]',
  '',
  'buyer review --seller http://127.0.0.1:8423 --resource https://api.example/feed',
  '  --snapshot ORIGINAL_SNAPSHOT --query "fields=id,title&limit=25" --out NEW_REVIEW.json',
  'buyer prepare --review REVIEW.json --intent UNIQUE_INTENT --accept-index 0 --out NEW_BUYER_DIR',
  '',
  'Read public payment terms from a file. Preparation retains the original SF82 source files,',
  'version-store binding, offer and native CSV contract. Retry unchanged paths to recover a lost reply.',
  'Use the original dataset-refresh command with its current snapshot and revision for later live refresh.',
  'Buyer preparation reloads the actual seller offer and binds the original SF88 configuration to its digest.',
].join('\n');
function args(input) {
  const [family, verb, ...tokens] = input, command = family + ' ' + verb;
  const options = {
    'merchant prepare':['dataset-export','state','payment','origin','path','out','release','retention-seconds','max-versions','max-retained-bytes'],
    'merchant serve':['release','port','facilitator','allow-local-facilitator'],
    'buyer review':['seller','resource','snapshot','query','out'],
    'buyer prepare':['review','intent','accept-index','out'],
  };
  if (!options[command]) fail(HELP);
  const values = Object.create(null);
  for (let i=0;i<tokens.length;i++) {
    const key = tokens[i].startsWith('--') ? tokens[i].slice(2) : '';
    if (!options[command].includes(key) || Object.hasOwn(values,key)) fail('Unknown or duplicate option: ' + tokens[i]);
    if (key === 'allow-local-facilitator') { values[key]=true; continue; }
    if (tokens[i+1] === undefined || tokens[i+1].startsWith('--')) fail('Missing value for ' + tokens[i]);
    values[key] = tokens[++i];
  }
  return { command, values };
}
const need = (values,key) => values[key] || fail('--' + key + ' is required.');
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail('Choose a nonnegative safe integer.');
  return Number(value);
}
export async function main(input = process.argv.slice(2)) {
  if (input.includes('--help') || input.length < 2) { process.stdout.write(HELP + '\n'); return; }
  const { command, values:v } = args(input);
  let result;
  if (command === 'merchant prepare') result = await prepareFeedMerchant({
    datasetExport:need(v,'dataset-export'), versionDirectory:need(v,'state'), packageDirectory:need(v,'out'),
    releaseDirectory:need(v,'release'), payment:parse(await read(need(v,'payment'),16384)),
    origin:need(v,'origin'), path:v.path ?? '/feed', retentionMs:integer(v['retention-seconds'],3600)*1000,
    maxVersions:integer(v['max-versions'],4), maxRetainedBytes:integer(v['max-retained-bytes'],256*MiB) });
  else if (command === 'merchant serve') {
    const service = await startDatasetRelease(need(v,'release'), { runtime:{ port:integer(v.port,8423),
      ...(v.facilitator ? { facilitator:v.facilitator } : {}),
      ...(v['allow-local-facilitator'] ? { allowLocalFacilitator:true } : {}) } });
    result = { url:service.url, mode:service.mode, snapshot:service.versions.status().current,
      health:service.url + '/_seller/health', offers:service.url + '/_seller/offers', docs:service.url + '/_seller/docs' };
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
      void service.close().catch(error => { process.stderr.write(error.message+'\n'); process.exitCode=1; });
    });
  } else if (command === 'buyer review') {
    result = await reviewFeedBuyer({ seller:need(v,'seller'), resource:need(v,'resource'), snapshot:need(v,'snapshot'), query:v.query ?? '' });
    await exactFile(resolve(need(v,'out')),encode(result));
  } else result = await prepareFeedBuyer({ review:parse(await read(need(v,'review'),2*MiB)), intentId:need(v,'intent'),
    acceptIndex:integer(need(v,'accept-index')), outputDirectory:need(v,'out') });
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write('Feed handoff: '+error.message+'\n');process.exitCode=1;});
