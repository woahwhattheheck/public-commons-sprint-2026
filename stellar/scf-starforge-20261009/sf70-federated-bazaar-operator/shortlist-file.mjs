// MIT. Untrusted local review files are display data, never network destinations or approval.
import { SHORTLIST_LIMIT, selectionKey } from './shortlist.mjs';

export const SHORTLIST_FILE_MAX_BYTES = 1024 * 1024;
const SCHEMA = 'SCF-SF70/advertised-offer-shortlist-v1';
const NETWORKS = new Set(['stellar:testnet', 'stellar:pubnet']);
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function object(value, label) {
  if (!plain(value)) fail(label + ' must be a JSON object.');
  return value;
}

function string(value, label, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim()))
    fail(label + ' must be ' + (required ? 'a nonempty' : 'a') + ' string of at most ' + maximum + ' characters.');
  return value;
}

function integer(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail(label + ' must be a whole number from ' + minimum + ' to ' + maximum + '.');
  return value;
}

// Preserve bounded, unfamiliar optional metadata without giving it behavior. Construct
// fresh objects, rejecting special property names rather than merging arbitrary JSON.
function optionalValue(value, label, depth = 0) {
  if (depth > 8) fail(label + ' is nested too deeply.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return string(value, label, 1800);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(label + ' must be finite.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 40) fail(label + ' must contain at most 40 items.');
    return value.map((item, index) => optionalValue(item, label + '[' + index + ']', depth + 1));
  }
  object(value, label);
  const keys = Object.keys(value);
  if (keys.length > 40) fail(label + ' has too many fields.');
  const copy = {};
  for (const key of keys.sort()) {
    string(key, label + ' field name', 100, true);
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(label + ' contains an unsupported field name.');
    copy[key] = optionalValue(value[key], label + '.' + key, depth + 1);
  }
  return copy;
}

function copyFields(value, label, lengths, required = []) {
  object(value, label);
  const copy = optionalValue(value, label);
  for (const [key, maximum] of Object.entries(lengths)) {
    if (own(value, key) || required.includes(key)) copy[key] = string(value[key], label + '.' + key, maximum);
  }
  return copy;
}

function paymentOption(value, label) {
  // Empty strings and absent declarations (including an original empty {}) are
  // meaningful unknowns. In particular, do not coerce or normalize atomic amounts.
  const lengths = { network: 1800, scheme: 1800, asset: 1800, payTo: 1800, amount: 150 };
  const copy = copyFields(value, label, lengths);
  const option = {};
  // Match the server projection's tuple ordering so reordered JSON properties do
  // not create a second identity for the same indexed option.
  for (const key of [...Object.keys(lengths), ...Object.keys(copy).filter(key => !own(lengths, key)).sort()])
    if (own(copy, key)) option[key] = copy[key];
  return option;
}

function equal(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => own(right, key) && equal(left[key], right[key]));
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function selection(value, index) {
  const label = 'Selection ' + (index + 1);
  object(value, label);
  const capturedNetwork = string(value.capturedNetwork, label + ' capture network', 80, true);
  if (!NETWORKS.has(capturedNetwork)) fail(label + ' has an unsupported capture network.');
  const originalSource = object(value.source, label + ' source');
  const source = copyFields(originalSource, label + ' source', {
    provider: 80, name: 200, endpoint: 1800, status: 80, network: 80, observedAt: 40, coverage: 100,
  }, ['provider', 'endpoint', 'status', 'network', 'observedAt']);
  string(source.provider, label + ' provider', 80, true);
  if (source.status !== 'COMPLETE_GET_CAPTURE') fail(label + ' must retain a completed original source observation.');
  if (source.network !== capturedNetwork) fail(label + ' capture network does not match its original source.');
  // Current exports use an exact ISO UTC timestamp. Parsing it only validates the
  // saved representation; neither its age nor its authenticity is established here.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source.observedAt) ||
      !Number.isFinite(Date.parse(source.observedAt)) || new Date(source.observedAt).toISOString() !== source.observedAt)
    fail(label + ' must retain a valid original UTC capture timestamp.');
  let endpoint;
  try { endpoint = new URL(source.endpoint); }
  catch { fail(label + ' must retain an absolute original source endpoint.'); }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    fail(label + ' source endpoint must be an HTTP(S) address without credentials.');
  if (own(source, 'rows')) integer(source.rows, label + ' source row count', 1, 3000);
  if (own(source, 'pages')) integer(source.pages, label + ' source page count', 1, 30);
  if (own(source, 'declaredTotal') && source.declaredTotal !== null) {
    integer(source.declaredTotal, label + ' declared row count', 1, 3000);
    if (own(source, 'rows') && source.declaredTotal !== source.rows)
      fail(label + ' completed source row count does not match its declared total.');
  }

  const originalListing = object(value.listing, label + ' listing');
  const listing = copyFields(originalListing, label + ' listing', {
    source: 80, url: 1800, label: 1800, description: 500,
    kind: 40, method: 32, toolName: 150, routeTemplate: 240,
  }, ['source']);
  if (listing.source !== source.provider) fail(label + ' listing provider does not match its original source.');
  listing.sourceRow = integer(originalListing.sourceRow, label + ' original source row', 1, source.rows ?? 3000);
  if (!Array.isArray(originalListing.paymentOptions) || originalListing.paymentOptions.length < 1 || originalListing.paymentOptions.length > 40)
    fail(label + ' listing must retain between 1 and 40 payment options.');
  listing.paymentOptions = originalListing.paymentOptions.map((option, optionIndex) =>
    paymentOption(option, label + ' payment option ' + (optionIndex + 1)));
  if (own(listing, 'hiddenPaymentOptions')) integer(listing.hiddenPaymentOptions, label + ' undisplayed option count', 0);
  const optionIndex = integer(value.optionIndex, label + ' selected option index', 0, listing.paymentOptions.length - 1);
  const suppliedOption = paymentOption(value.option, label + ' selected option');
  const option = listing.paymentOptions[optionIndex];
  if (!equal(suppliedOption, option)) fail(label + ' selected option does not exactly match its original indexed payment option.');

  // Ignore the supplied key, saved freshness status, export time, and imported flag.
  // Imported means only that these immutable terms were read from a local file.
  const snapshot = { network: capturedNetwork, sources: [source] };
  return freeze({ key: selectionKey(snapshot, listing, optionIndex), capturedNetwork,
    source, listing, optionIndex, option, imported: true });
}

/** Parse an entire local Save review JSON document, or throw without partial results. */
export function parseShortlistFile(text) {
  if (typeof text !== 'string') fail('Open a UTF-8 review JSON text file.');
  if (text.length >= SHORTLIST_FILE_MAX_BYTES || new TextEncoder().encode(text).byteLength >= SHORTLIST_FILE_MAX_BYTES)
    fail('The review file must be smaller than 1 MiB.');
  let document;
  try { document = JSON.parse(text); }
  catch { fail('The review file is not valid JSON. Open a file created with Save review JSON.'); }
  object(document, 'The review file');
  if (document.schema !== SCHEMA) fail('This is not a supported SF70 saved review file.');
  if (!Array.isArray(document.selections) || document.selections.length > SHORTLIST_LIMIT)
    fail('A review file must contain a selections array with at most ' + SHORTLIST_LIMIT + ' options.');
  const selections = document.selections.map(selection);
  const keys = new Set();
  for (const selected of selections) {
    if (keys.has(selected.key)) fail('The review file contains the same original option more than once.');
    keys.add(selected.key);
  }
  return selections;
}
