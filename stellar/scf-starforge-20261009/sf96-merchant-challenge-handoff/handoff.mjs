#!/usr/bin/env node
/**
 * SF96: original merchant 402 -> selected SF88 offline buyer review.
 * Imports original SF84 decoder and SF88 validator, never contacts a server or wallet.
 * SPDX-License-Identifier: MIT
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBytes } from '../sf84-mpp-market-intake/inspect.mjs';
import { parseHeaderTrace } from '../sf85-live-402-capture/header-trace.mjs';
import { operation } from '../sf88-operator-buyer-cli/config.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const files = ['original-capture.json', 'buyer-review.json', 'selection.json', 'review.txt'];
const headersFile = 'original-response.headers';
const importedSource = 'operator-exported-http-response-headers';
const MAX = 262144;
const I128 = 170141183460469231731687303715884105727n;

export class HandoffError extends Error {
  constructor(code) { super(code); this.name = 'HandoffError'; this.code = code; }
}
function check(ok, code) { if (!ok) throw new HandoffError(code); }
function absolute(value, code) {
  check(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), code);
  return value;
}
function dec(value, code, nonzero = false) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), code);
  const number = BigInt(value);
  check(number <= I128 && (!nonzero || number > 0n), code);
  return number;
}
async function fileBytes(path, max = MAX) {
  absolute(path, 'SOURCE_PATH_MUST_BE_ABSOLUTE');
  const metadata = await lstat(path);
  check(metadata.isFile() && metadata.size <= max, 'SOURCE_MUST_BE_REGULAR_BOUNDED_FILE');
  const bytes = await readFile(path);
  check(bytes.length > 0 && bytes.length <= max, 'SOURCE_SIZE_INVALID');
  return bytes;
}
function originalCapture(bytes) {
  let capture;
  try { capture = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new HandoffError('ORIGINAL_CAPTURE_JSON_INVALID'); }
  check(plain(capture) && capture.schema === 'scf.sf85.capture.v1', 'SF85_ORIGINAL_CAPTURE_REQUIRED');
  const imported = capture.captureSource === importedSource;
  const keys = ['schema','collectedAtUtc','url','method','status','headers'];
  if (imported) keys.push('captureSource','importedAtUtc','sourceHeaderSha256',
    'sourceHeaderBytes','discardedPreludeBlocks','requestMethodSource');
  check(Object.keys(capture).sort().join(',') ===
    keys.sort().join(','), 'SF85_CAPTURE_SHAPE_INVALID');
  if (imported) {
    check(capture.collectedAtUtc === null && capture.requestMethodSource === 'operator-declared',
      'SF85_IMPORTED_PROVENANCE_INVALID');
    check(typeof capture.importedAtUtc === 'string' && Number.isFinite(Date.parse(capture.importedAtUtc)) &&
      new Date(capture.importedAtUtc).toISOString() === capture.importedAtUtc,
      'SF85_IMPORT_TIME_INVALID');
    check(typeof capture.sourceHeaderSha256 === 'string' && /^[0-9a-f]{64}$/.test(capture.sourceHeaderSha256) &&
      Number.isSafeInteger(capture.sourceHeaderBytes) && capture.sourceHeaderBytes > 0 &&
      capture.sourceHeaderBytes <= 65536 && Number.isSafeInteger(capture.discardedPreludeBlocks) &&
      capture.discardedPreludeBlocks >= 0 && capture.discardedPreludeBlocks <= 3,
      'SF85_IMPORTED_HEADER_METADATA_INVALID');
  } else {
    check(typeof capture.collectedAtUtc === 'string' && Number.isFinite(Date.parse(capture.collectedAtUtc)),
      'SF85_CAPTURE_TIME_INVALID');
  }
  check(['GET', 'HEAD'].includes(capture.method) && capture.status === 402,
    'UNPAID_402_GET_OR_HEAD_REQUIRED');
  check(Array.isArray(capture.headers) && capture.headers.every(p =>
    Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' &&
    typeof p[1] === 'string' && ['payment-required','www-authenticate'].includes(p[0].toLowerCase())),
  'UNEXPECTED_SOURCE_HEADERS');
  return capture;
}
function sourceHeaders(capture, bytes) {
  if (capture.captureSource !== importedSource) {
    check(bytes === undefined, 'DIRECT_CAPTURE_DOES_NOT_ACCEPT_IMPORTED_HEADERS');
    return undefined;
  }
  check(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, 'IMPORTED_ORIGINAL_HEADERS_REQUIRED');
  let trace;
  try { trace = parseHeaderTrace(bytes); }
  catch { throw new HandoffError('IMPORTED_ORIGINAL_HEADERS_INVALID'); }
  check(trace.sourceHeaderSha256 === capture.sourceHeaderSha256 &&
    trace.sourceHeaderBytes === capture.sourceHeaderBytes &&
    trace.discardedPreludeBlocks === capture.discardedPreludeBlocks &&
    trace.status === capture.status && sha(canonical(trace.headers)) === sha(canonical(capture.headers)),
    'IMPORTED_HEADERS_CAPTURE_MISMATCH');
  return {
    method:importedSource,
    importedAtUtc:capture.importedAtUtc,
    requestMethodSource:capture.requestMethodSource,
    sourceHeaderSha256:trace.sourceHeaderSha256,
    sourceHeaderBytes:trace.sourceHeaderBytes,
    discardedPreludeBlocks:trace.discardedPreludeBlocks,
  };
}
function urlMatch(captured, advertised) {
  let source, offer;
  try { source = new URL(captured); offer = new URL(advertised); }
  catch { throw new HandoffError('CAPTURE_RESOURCE_URL_INVALID'); }
  check(source.protocol === 'https:' && offer.protocol === 'https:' &&
    !source.username && !source.password && !source.hash &&
    !offer.username && !offer.password && !offer.hash &&
    source.origin === offer.origin && source.pathname === offer.pathname &&
    (!offer.search || offer.search === source.search),
    'CAPTURE_AND_OFFER_RESOURCE_MISMATCH');
  return source.href;
}
function parseOffer(capture, offer, selected) {
  const values = capture.headers.filter(([name]) => name.toLowerCase() === 'payment-required');
  check(values.length === 1, 'ONE_ORIGINAL_X402_CHALLENGE_REQUIRED');
  let challenge;
  try { challenge = JSON.parse(Buffer.from(values[0][1], 'base64').toString('utf8')); }
  catch { throw new HandoffError('ORIGINAL_X402_DECODE_FAILED'); }
  check(plain(challenge) && Array.isArray(challenge.accepts) &&
    plain(challenge.accepts[selected]), 'ORIGINAL_X402_OPTION_MISSING');
  const raw = challenge.accepts[selected];
  check(sha(JSON.stringify(raw)) === offer.originalOfferSha256, 'ORIGINAL_OFFER_HASH_MISMATCH');
  check(raw.extra === undefined || plain(raw.extra), 'OFFER_EXTRA_INVALID');
  if (raw.extra?.paymentFlow !== undefined)
    check(raw.extra.paymentFlow === 'authorization', 'UNSUPPORTED_PAYMENT_FLOW');
  return raw.extra?.paymentFlow;
}

/** Build a deterministic reviewed offer from the genuine SF84 parser result. */
export function derive(bytes, { index, intentId, maxAtomic, originalHeaders }) {
  const capture = originalCapture(bytes);
  const acquisition = sourceHeaders(capture, originalHeaders);
  check(Number.isSafeInteger(index) && index >= 0, 'EXPLICIT_OFFER_INDEX_REQUIRED');
  const report = inspectBytes(bytes);
  check(['x402-v2-402','multi-protocol-402'].includes(report.classification) &&
    report.x402.status === 'parsed' &&
    ['absent','parsed'].includes(report.mpp.status), 'VALID_X402_RAIL_REQUIRED');
  const selected = report.x402.offer?.options[index];
  check(selected?.index === index && selected.stellar === true &&
    selected.scheme === 'exact' && ['stellar:testnet','stellar:pubnet'].includes(selected.network),
    'SELECTED_ORIGINAL_EXACT_STELLAR_OFFER_REQUIRED');
  const quote = dec(selected.amount, 'ORIGINAL_ATOMIC_AMOUNT_INVALID');
  const ceiling = dec(maxAtomic, 'OPERATOR_ATOMIC_CEILING_INVALID');
  check(ceiling >= quote, 'OPERATOR_CEILING_BELOW_QUOTED_AMOUNT');
  check(typeof intentId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(intentId),
    'STABLE_INTENT_ID_REQUIRED');
  const paymentFlow = parseOffer(capture, selected, index);
  const url = urlMatch(capture.url, report.x402.offer.resourceUrl);
  const seconds = Number(selected.maxTimeoutSeconds);
  check(Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86400,
    'ORIGINAL_TIMEOUT_UNSUPPORTED');
  const expect = {
    scheme:selected.scheme, network:selected.network,
    asset:selected.asset, payTo:selected.payTo,
    maxAtomic, maxTimeoutSeconds:seconds,
  };
  if (paymentFlow !== undefined) expect.paymentFlow = paymentFlow;
  const op = operation({ intentId, url, method:capture.method, expect });
  const config = { operation:op, captureBody:false };
  const selection = {
    schema:'scf.sf96.original-challenge-selection.v1',
    originalCaptureSha256:sha(bytes),
    originalChallengeSha256:report.x402.offer.wireSha256,
    originalOfferSha256:selected.originalOfferSha256,
    originalCaptureAtUtc:capture.collectedAtUtc,
    originalMethod:capture.method,
    originalResourceUrl:url,
    capturedRailClassification:report.classification,
    offerIndex:index, intentId, quotedAtomic:selected.amount, maxAtomic,
    network:selected.network, asset:selected.asset, recipient:selected.payTo,
  };
  if (acquisition) selection.sourceAcquisition = acquisition;
  return {config, selection};
}
function instructions(config, selection) {
  return [
    'SF96 / ORIGINAL MERCHANT CHALLENGE -> BUYER REVIEW',
    '------------------------------------------------',
    `Intent: ${config.operation.intentId}`,
    `Merchant URL: ${JSON.stringify(config.operation.url)}`,
    `HTTP method: ${config.operation.method}`,
    `Original capture (SHA-256): ${selection.originalCaptureSha256}`,
    `Raw x402 challenge (SHA-256): ${selection.originalChallengeSha256}`,
    ...(selection.sourceAcquisition ? [
      'Acquisition: operator-exported original HTTP response headers',
      'Original HTTP capture time: unknown; import time is recorded separately',
      `Imported at UTC: ${selection.sourceAcquisition.importedAtUtc}`,
      `Original header file (SHA-256): ${selection.sourceAcquisition.sourceHeaderSha256}`,
      `Original header file bytes: ${selection.sourceAcquisition.sourceHeaderBytes}`,
      'URL and request method: operator-declared; response headers do not authenticate them',
    ] : []),
    `Selected offer index: ${selection.offerIndex}`,
    `Selected offer (SHA-256): ${selection.originalOfferSha256}`,
    `Exact Stellar rail: ${selection.network}`,
    `Original quoted atomic units: ${selection.quotedAtomic}`,
    `Operator-selected maximum atomic units: ${selection.maxAtomic}`,
    '',
    'This bundle includes the original SF85 capture and a source-bound',
    'SF88-compatible OFFLINE review configuration. It contains no signer,',
    'operator reservation, keys, wallet, network request or payment approval.',
    '',
    '1. Reinspect the offer and source capture as an operator.',
    '2. Verify with: node handoff.mjs --verify /ABSOLUTE/BUNDLE_DIR',
    '3. Review with the original SF88 CLI:',
    '   node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs',
    '     --review --config /ABSOLUTE/BUNDLE_DIR/buyer-review.json',
    '4. If conducting an authorized paid pilot, compose a NEW private owner',
    '   execution config using existing SF88/SF36 policy, ledger and signer.',
    '   Review it separately and seek the original operator consent.',
    '',
    'A 402 header does not show issuer authority, settlement, delivery or cash.',
    'No network, hosted Actions or transactions are performed by SF96.',
    '',
  ].join('\n');
}
async function exclusive(path, bytes) {
  const h = await open(path, 'wx', 0o600);
  try { await h.writeFile(bytes); await h.sync(); }
  finally { await h.close(); }
}
export async function create({ capturePath, outDir, index, intentId, maxAtomic, headersPath }) {
  const raw = await fileBytes(capturePath);
  const originalHeaders = headersPath === undefined ? undefined : await fileBytes(headersPath,65536);
  const { config, selection } = derive(raw, {index, intentId, maxAtomic, originalHeaders});
  const draft = canonical(config);
  check(draft.byteLength <= 65536, 'SF88_CONFIG_TOO_LARGE');
  const dest = absolute(outDir, 'BUNDLE_DIR_MUST_BE_ABSOLUTE');
  check(resolve(dest) === dest, 'BUNDLE_DIR_MUST_BE_CANONICAL');
  await mkdir(dest, {mode:0o700}); // exclusive create: never replace any existing bundle
  const entries = {
    'original-capture.json':raw,
    'buyer-review.json':draft,
    'selection.json':canonical(selection),
    'review.txt':Buffer.from(instructions(config,selection)),
  };
  if (originalHeaders) entries[headersFile] = originalHeaders;
  const bundleFiles = Object.keys(entries);
  for (const file of bundleFiles) await exclusive(join(dest,file), entries[file]);
  const manifest = {
    schema:'scf.sf96.handoff-bundle.v1',
    createdAtUtc:new Date().toISOString(),
    files:Object.fromEntries(bundleFiles.map(f => [f, {sha256:sha(entries[f]), bytes:entries[f].length}])),
  };
  await exclusive(join(dest,'manifest.json'),canonical(manifest));
  return {bundle:dest, configPath:join(dest,'buyer-review.json'),
    originalCaptureSha256:selection.originalCaptureSha256, selectedOfferSha256:selection.originalOfferSha256,
    selectedIndex:index, quotedAtomic:selection.quotedAtomic, maxAtomic,
    ...(selection.sourceAcquisition ? {sourceHeaderSha256:selection.sourceAcquisition.sourceHeaderSha256} : {}),
    next:'Run SF96 --verify and original SF88 --review before any separately authorized operation'};
}
export async function verify(dir) {
  const root = absolute(dir, 'BUNDLE_DIR_MUST_BE_ABSOLUTE');
  let manifest;
  try { manifest = JSON.parse((await fileBytes(join(root,'manifest.json'),65536)).toString('utf8')); }
  catch { throw new HandoffError('BUNDLE_MANIFEST_INVALID'); }
  check(plain(manifest) && manifest.schema === 'scf.sf96.handoff-bundle.v1' && plain(manifest.files),
  'BUNDLE_MANIFEST_SHAPE_INVALID');
  const bundleFiles = Object.hasOwn(manifest.files,headersFile) ? [...files,headersFile] : files;
  check(Object.keys(manifest.files).sort().join(',') === bundleFiles.slice().sort().join(','),
    'BUNDLE_MANIFEST_SHAPE_INVALID');
  const records = {};
  for (const file of bundleFiles) {
    const content = await fileBytes(join(root,file),file === 'original-capture.json' ? MAX : 65536);
    check(manifest.files[file]?.bytes === content.length && manifest.files[file]?.sha256 === sha(content),
      'BUNDLE_FILE_HASH_MISMATCH');
    records[file] = content;
  }
  let selection, config;
  try { selection=JSON.parse(records['selection.json'].toString('utf8'));
    config=JSON.parse(records['buyer-review.json'].toString('utf8')); }
  catch { throw new HandoffError('BUNDLE_JSON_INVALID'); }
  check(plain(selection) && selection.schema === 'scf.sf96.original-challenge-selection.v1' &&
    plain(config) && Object.keys(config).sort().join(',') === 'captureBody,operation',
  'BUNDLE_SELECTION_INVALID');
  const expected = derive(records['original-capture.json'], {
    index:selection.offerIndex, intentId:selection.intentId, maxAtomic:selection.maxAtomic,
    originalHeaders:records[headersFile],
  });
  check(sha(canonical(expected.selection)) === sha(records['selection.json']) &&
    sha(canonical(expected.config)) === sha(records['buyer-review.json']) &&
    instructions(expected.config, expected.selection) === records['review.txt'].toString('utf8'),
    'BUNDLE_SOURCE_BINDING_MISMATCH');
  return {mode:'ORIGINAL_SOURCE_BOUND_REVIEW_VERIFIED', config:join(root,'buyer-review.json'),
    sourceSha256:expected.selection.originalCaptureSha256,
    selectedOfferSha256:expected.selection.originalOfferSha256,
    intentId:expected.selection.intentId, quotedAtomic:expected.selection.quotedAtomic,
    ...(expected.selection.sourceAcquisition ? {sourceAcquisition:expected.selection.sourceAcquisition} : {}),
    maxAtomic:expected.selection.maxAtomic, outcome:'OFFLINE_ONLY_NOT_A_PAYMENT'};
}
function parse(args) {
  if (args.length === 2 && args[0] === '--verify') return {verify:args[1]};
  const keys = ['--capture','--out','--offer-index','--intent-id','--max-atomic'];
  check(args.length === 10 || args.length === 12, 'REQUIRE_CAPTURE_OUT_OFFER_INDEX_INTENT_AND_MAX_ATOMIC');
  const f = new Map();
  for (let i = 0;i<args.length;i+=2) {
    check((keys.includes(args[i]) || args[i] === '--headers-file') && !f.has(args[i]),
      'UNEXPECTED_OR_DUPLICATE_FLAG');
    f.set(args[i],args[i+1]);
  }
  check(keys.every(k=>f.has(k)), 'MISSING_REQUIRED_FLAG');
  check(/^(0|[1-9][0-9]*)$/.test(f.get('--offer-index')) &&
    Number.isSafeInteger(Number(f.get('--offer-index'))), 'EXPLICIT_OFFER_INDEX_REQUIRED');
  return {capturePath:f.get('--capture'), outDir:f.get('--out'),
    headersPath:f.get('--headers-file'),
    index:Number(f.get('--offer-index')), intentId:f.get('--intent-id'),
    maxAtomic:f.get('--max-atomic')};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve().then(async () => {
    const flags = parse(process.argv.slice(2));
    return flags.verify === undefined ? create(flags) : verify(flags.verify);
  }).then(value => console.log(JSON.stringify(value,null,2)))
    .catch(error => {console.error(`SF96_HANDOFF_ERROR: ${error.code ?? 'FILE_OR_RUNTIME_ERROR'}`);process.exitCode=2;});
}
