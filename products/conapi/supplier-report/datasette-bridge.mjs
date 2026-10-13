import { createEdition, reconcile, canonicalJSON, ReportError } from './supplier-report.mjs';

const NATIVE_EDITION = 'stellar-forge.datasette-edition.v1';
const NATIVE_CAPTURE = 'stellar-forge.datasette-capture.v1';
const BRIDGE = 'conapi.datasette-supplier-edition.v1';
const HASH = /^[a-f0-9]{64}$/;
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copy = value => JSON.parse(canonicalJSON(value));

function requireValue(condition, code, message, details = {}) {
  if (!condition) throw new ReportError(code, message, details);
}

function requiredText(value, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0,
    'NATIVE_BRIDGE_INPUT', label + ' must be nonempty text.');
  return value;
}

function optionsFor(value) {
  requireValue(plain(value), 'NATIVE_BRIDGE_INPUT', 'Provide a native edition input object.');
  const allowed = new Set([
    'editionFile', 'expectedSha256', 'id', 'sourceId', 'capturedAt', 'source', 'numericFormat'
  ]);
  for (const key of Object.keys(value)) {
    requireValue(allowed.has(key), 'NATIVE_BRIDGE_INPUT', 'Unknown native edition option: ' + key);
  }
  requiredText(value.editionFile, 'editionFile');
  if (value.expectedSha256 !== undefined) {
    requireValue(typeof value.expectedSha256 === 'string' && HASH.test(value.expectedSha256),
      'NATIVE_EDITION_HASH', 'expectedSha256 must be the retained lowercase SHA-256 of edition.json.');
  }
  for (const key of ['id', 'sourceId', 'capturedAt']) {
    if (value[key] !== undefined) requiredText(value[key], key);
  }
  requireValue(value.source === undefined || plain(value.source),
    'NATIVE_BRIDGE_INPUT', 'source must be a JSON metadata object.');
  const numericFormat = value.numericFormat === undefined ? 'source' : value.numericFormat;
  requireValue(numericFormat === 'source' || numericFormat === 'plain-decimal',
    'NATIVE_NUMERIC_FORMAT', 'numericFormat must be source or plain-decimal.');
  return {
    ...value,
    numericFormat,
    ...(value.source === undefined ? {} : { source: copy(value.source) })
  };
}

/**
 * Expand a reviewed numeric exponent into an exact decimal string.
 * The original token remains in nativeRowsJSON and projectionTransformations.
 * The 4096-character ceiling matches the supplier core's decimal input contract.
 */
function plainDecimal(token) {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  requireValue(match !== null, 'NATIVE_NUMERIC_TOKEN', 'A reviewed numeric projection must retain a valid JSON number token.');
  if (match[4] === undefined) return token;
  const fraction = match[3] || '';
  const digits = match[2] + fraction;
  const exponent = BigInt(match[4]);
  const point = BigInt(match[2].length) + exponent;
  const sign = match[1];
  let output;
  if (point <= 0n) {
    const zeroes = -point;
    requireValue(zeroes + BigInt(digits.length) + BigInt(sign.length + 2) <= 4096n,
      'NATIVE_DECIMAL_LENGTH', 'The expanded decimal exceeds the supplier core decimal representation.');
    output = sign + '0.' + '0'.repeat(Number(zeroes)) + digits;
  } else if (point >= BigInt(digits.length)) {
    const zeroes = point - BigInt(digits.length);
    requireValue(point + BigInt(sign.length) <= 4096n,
      'NATIVE_DECIMAL_LENGTH', 'The expanded decimal exceeds the supplier core decimal representation.');
    output = sign + digits + '0'.repeat(Number(zeroes));
  } else {
    const index = Number(point);
    output = sign + digits.slice(0, index) + '.' + digits.slice(index);
  }
  return output;
}

function captureTime(selected, options) {
  if (options.capturedAt !== undefined) return { value: options.capturedAt, basis: 'caller-supplied-capture-time' };
  const candidates = [
    [selected.capture.completedAt, 'native-capture-completedAt'],
    [selected.capture.observationWindow?.notAfter, 'native-observation-window-notAfter'],
    [selected.capture.committedAt, 'native-capture-committedAt'],
    [selected.edition.createdAt, 'native-edition-createdAt']
  ];
  for (const [value, basis] of candidates) {
    if (typeof value === 'string' && value.length) return { value, basis };
  }
  throw new ReportError('NATIVE_CAPTURE_TIME', 'Supply capturedAt when the retained native edition has no recorded capture or commitment time.');
}

function validateNative(selected, options) {
  requireValue(plain(selected) && plain(selected.edition) && plain(selected.capture) && plain(selected.review),
    'NATIVE_READER_CONTRACT', 'The original native reader must return its edition, capture, and review.');
  requireValue(selected.edition.schema === NATIVE_EDITION && selected.edition.state === 'REVIEWED' &&
    selected.capture.schema === NATIVE_CAPTURE && selected.capture.state === 'COMPLETE' &&
    selected.review.approved === true,
    'NATIVE_REVIEWED_EDITION', 'Use a complete original native capture with its reviewed edition.');
  requireValue(typeof selected.editionSha256 === 'string' && HASH.test(selected.editionSha256) &&
    typeof selected.captureSha256 === 'string' && HASH.test(selected.captureSha256) &&
    typeof selected.capture.selectionHash === 'string' && HASH.test(selected.capture.selectionHash) &&
    selected.edition.captureSha256 === selected.captureSha256,
    'NATIVE_READER_CONTRACT', 'The native reader must return original edition and capture hashes.');
  if (options.expectedSha256 !== undefined) {
    requireValue(selected.editionSha256 === options.expectedSha256,
      'NATIVE_EDITION_CHANGED', 'The received edition differs from the selected native edition.');
  }
  requiredText(selected.editionFile, 'Native editionFile');
  requiredText(selected.captureFile, 'Native captureFile');
  requireValue(Array.isArray(selected.columns) && selected.columns.length > 0 &&
    selected.columns.every(column => typeof column === 'string' && column.length) &&
    new Set(selected.columns).size === selected.columns.length &&
    Array.isArray(selected.rows) && Array.isArray(selected.pages),
    'NATIVE_READER_CONTRACT', 'The native reader must return original columns, rows, and page receipts.');
  requireValue(plain(selected.edition.projection) && Object.keys(selected.edition.projection).length > 0,
    'NATIVE_PROJECTION_REQUIRED', 'The native edition must retain its approved column projection.');
  requireValue(canonicalJSON(selected.edition.projection) === canonicalJSON(selected.review.projection) &&
    canonicalJSON(selected.columns) === canonicalJSON(selected.edition.columns) &&
    canonicalJSON(selected.columns) === canonicalJSON(selected.capture.columns) &&
    selected.edition.rowCount === selected.rows.length && selected.capture.rowCount === selected.rows.length &&
    selected.edition.pageCount === selected.pages.length && selected.capture.pageCount === selected.pages.length,
    'NATIVE_READER_CONTRACT', 'The native edition, approved projection, and original capture must agree.');
}

function pageRanges(selected) {
  let ordinal = 1;
  const ranges = selected.pages.map(page => {
    requireValue(plain(page) && Number.isSafeInteger(page.index) && page.index >= 0 &&
      Number.isSafeInteger(page.rowCount) && page.rowCount >= 0 && plain(page.body) &&
      typeof page.body.file === 'string' && typeof page.body.sha256 === 'string' && HASH.test(page.body.sha256),
      'NATIVE_PAGE_CONTRACT', 'A native page receipt must retain its index, row count, body member, and body hash.');
    const result = {
      nativePageIndex: page.index,
      rowCount: page.rowCount,
      firstRowNumber: page.rowCount ? ordinal : null,
      lastRowNumber: page.rowCount ? ordinal + page.rowCount - 1 : null,
      bodyFile: page.body.file,
      bodySha256: page.body.sha256
    };
    ordinal += page.rowCount;
    return result;
  });
  requireValue(ordinal - 1 === selected.rows.length,
    'NATIVE_PAGE_ROWS', 'Native page row counts must cover every retained source row exactly.');
  return ranges;
}

/**
 * Bind the maintained Datasette reader/projector/token serializer to supplier review.
 *
 * Obtain readDatasetteEdition and projectDatasetteRow from the installed
 * sf30-seller-sdk/datasette/editions.mjs, and exactJson from its json.mjs.
 * Their original file, page, projection and typed-number behavior stays authoritative.
 */
export function createDatasetteBridge({ readDatasetteEdition, projectDatasetteRow, exactJson } = {}) {
  for (const [name, value] of Object.entries({ readDatasetteEdition, projectDatasetteRow, exactJson })) {
    requireValue(typeof value === 'function', 'NATIVE_BRIDGE_DEPENDENCY', 'Provide the original Datasette function ' + name + '.');
  }

  async function readOriginal(options) {
    const selected = await readDatasetteEdition(options.editionFile,
      options.expectedSha256 === undefined ? {} : { expectedSha256: options.expectedSha256 });
    validateNative(selected, options);
    return selected;
  }

  function projectOriginal(selected, options) {
    validateNative(selected, options);
    const projection = selected.edition.projection;
    const columns = Object.keys(projection);
    const originalRowsJSON = exactJson(selected.rows);
    requireValue(typeof originalRowsJSON === 'string',
      'NATIVE_EXACT_JSON', 'The original exactJson serializer must return the complete original row JSON text.');
    const transformations = [];
    const rows = selected.rows.map((nativeRow, index) => {
      const projected = projectDatasetteRow(nativeRow, selected.columns, projection);
      requireValue(plain(projected) && Object.keys(projected).length === columns.length &&
        columns.every(column => own(projected, column) && (projected[column] === null || typeof projected[column] === 'string')),
        'NATIVE_PROJECTOR_CONTRACT', 'The original reviewed projection must return exact strings or null for every alias.');
      const raw = Object.fromEntries(columns.map(column => {
        let value = projected[column];
        const spec = projection[column];
        if (options.numericFormat === 'plain-decimal' && value !== null &&
            (spec.type === 'number' || spec.type === 'integer') && spec.representation !== 'json') {
          const expanded = plainDecimal(value);
          if (expanded !== value) {
            transformations.push({ rowNumber: index + 1, column, sourceToken: value, projectedValue: expanded });
            value = expanded;
          }
        }
        return [column, value];
      }));
      // Native JSON has ordinal rows; pageRanges records their original page/body.
      return { rowNumber: index + 1, lineNumber: index + 1, raw };
    });
    const time = captureTime(selected, options);
    const source = {
      kind: 'datasette-native-edition',
      bridge: BRIDGE,
      capturedAtBasis: time.basis,
      numericFormat: options.numericFormat,
      rowNumbering: {
        rowNumber: 'one-based ordinal in the complete native capture',
        lineNumber: 'same native row ordinal; native JSON responses have no CSV line numbering'
      },
      native: {
        editionFile: selected.editionFile,
        editionSha256: selected.editionSha256,
        captureFile: selected.captureFile,
        captureSha256: selected.captureSha256,
        edition: copy(selected.edition),
        review: copy(selected.review),
        capture: copy(selected.capture),
        sourceColumns: selected.columns.slice(),
        nativeRowsJSON: originalRowsJSON,
        projectedColumns: columns.slice(),
        projection: copy(projection),
        projectionTransformations: transformations,
        pageRanges: pageRanges(selected)
      }
    };
    if (options.source !== undefined) source.operator = copy(options.source);
    return createEdition({
      id: options.id === undefined ? 'datasette-edition:' + selected.editionSha256 : options.id,
      sourceId: options.sourceId === undefined ? 'datasette-selection:' + selected.capture.selectionHash : options.sourceId,
      capturedAt: time.value,
      columns,
      rows,
      source
    });
  }

  async function readEdition(input) {
    const options = optionsFor(input);
    return projectOriginal(await readOriginal(options), options);
  }

  async function compare({ requestId, baseline, candidate, rules, predecessor } = {}) {
    requiredText(requestId, 'requestId');
    requireValue(plain(baseline) && plain(candidate), 'NATIVE_BRIDGE_INPUT',
      'A comparison needs baseline and candidate native edition inputs.');
    const before = optionsFor({ ...baseline, id: baseline.id === undefined ? requestId + ':baseline' : baseline.id });
    const after = optionsFor({ ...candidate, id: candidate.id === undefined ? requestId + ':candidate' : candidate.id });
    const pending = new Map();
    const selectedFor = input => {
      const key = canonicalJSON([input.editionFile, input.expectedSha256 === undefined ? null : input.expectedSha256]);
      if (!pending.has(key)) pending.set(key, readOriginal(input));
      return pending.get(key);
    };
    const [left, right] = await Promise.all([selectedFor(before), selectedFor(after)]);
    return reconcile({
      requestId,
      baseline: projectOriginal(left, before),
      candidate: projectOriginal(right, after),
      rules,
      ...(predecessor === undefined ? {} : { predecessor })
    });
  }

  return Object.freeze({ readEdition, compare });
}
