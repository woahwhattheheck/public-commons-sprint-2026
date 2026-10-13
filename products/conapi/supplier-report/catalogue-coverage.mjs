import { parseCSV, sha256, canonicalJSON } from './supplier-report.mjs';

const FORMAT = 'supplier-catalogue-coverage/v1';
const STATUSES = new Set(['matched', 'unmatched', 'ambiguous', 'exception', 'unresolved']);

export class CatalogueCoverageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CatalogueCoverageError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CatalogueCoverageError(code, message, details);
}

function jsonCopy(value, label) {
  try {
    return JSON.parse(canonicalJSON(value));
  } catch (error) {
    fail('INVALID_METADATA', label + ' must contain serializable JSON values.', {
      cause: String(error.message || error)
    });
  }
}

/*
 * Deliberately restricted source URL grammar:
 *   HTTP(S) + ASCII DNS or canonical dotted-quad IPv4 host + optional decimal port;
 *   absolute paths use RFC 3986 pchar and valid percent-encoded octets.
 * Scheme/host case and default ports use standard HTTP origin equivalence.
 * Paths are never decoded, case-folded, slash-normalized or dot-resolved.
 * IDNA/IPv6/legacy numeric hosts and other rewriting forms require explicit review.
 * References: https://url.spec.whatwg.org/ and RFC 3986 sections 3.2 and 3.3.
 */
function exactHTTPURL(value, { allowSuffix = false } = {}) {
  if (typeof value !== 'string' || !value.length) {
    fail('MISSING_URL', 'Provide a non-empty source URL.', { value });
  }
  if (/[\u0000-\u0020\u007f\\]/.test(value)) {
    fail('INVALID_URL_CHARACTERS', 'The source URL contains whitespace, a control character or a backslash.', { value });
  }
  const parts = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value);
  if (!parts) fail('INVALID_HTTP_URL', 'Use an absolute HTTP or HTTPS URL with an explicit host.', { value });
  const [, schemeInput, authority, pathInput, query = '', fragment = ''] = parts;
  if (authority.includes('@')) {
    fail('URL_CREDENTIALS', 'The source URL contains embedded credentials.', { value });
  }
  const hostPort = /^([A-Za-z0-9.-]+)(?::([0-9]+))?$/.exec(authority);
  if (!hostPort) {
    fail('UNSUPPORTED_HOST_FORM', 'Use an ASCII DNS name or canonical dotted-quad IPv4 host with an optional decimal port.', { value });
  }
  const hostname = hostPort[1].toLowerCase();
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.some(label =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.startsWith('xn--'))) {
    fail('UNSUPPORTED_HOST_FORM', 'The host requires explicit DNS or IDNA normalization before an exact source join.', { value });
  }
  const canonicalIPv4 = labels.length === 4 && labels.every(label =>
    /^(?:0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255
  );
  if (!canonicalIPv4 && /^(?:[0-9]+|0x[0-9a-f]*)$/i.test(labels[labels.length - 1])) {
    fail('NONCANONICAL_NUMERIC_HOST', 'Numeric hosts must use four shortest decimal IPv4 octets from 0 through 255.', { value });
  }
  let port = hostPort[2] || '';
  if (port && (!/^(?:0|[1-9][0-9]{0,4})$/.test(port) || Number(port) > 65535)) {
    fail('INVALID_URL_PORT', 'The port must be a canonical decimal integer from 0 through 65535.', { value });
  }
  const scheme = schemeInput.toLowerCase();
  if (port === (scheme === 'http' ? '80' : '443')) port = '';
  if (!allowSuffix && (query || fragment)) {
    fail('URL_QUERY_OR_FRAGMENT', 'A query or fragment makes this service URL ambiguous for an exact path join.', { value, query, fragment });
  }
  const pathname = pathInput || '/';
  if (!/^(?:\/(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9A-Fa-f]{2})*)+$/.test(pathname)) {
    fail('UNSUPPORTED_PATH_FORM', 'Use an absolute ASCII URI path with valid percent-encoded octets.', { value, pathname });
  }
  for (const segment of pathname.split('/')) {
    const dots = segment.replace(/%2e/gi, '.');
    if (dots === '.' || dots === '..') {
      fail('URL_DOT_SEGMENT', 'The source path contains a literal or encoded dot segment that needs explicit review.', { value, pathname });
    }
  }
  if (allowSuffix) {
    const suffixPattern = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*$/;
    if (!suffixPattern.test(query.slice(1)) || !suffixPattern.test(fragment.slice(1))) {
      fail('UNSUPPORTED_URL_SUFFIX', 'The source query or fragment requires explicit URI encoding.', { value });
    }
  }
  const origin = scheme + '://' + hostname + (port ? ':' + port : '');
  return { input: value, protocol: scheme + ':', hostname, port, origin, pathname, query, fragment, key: origin + pathname };
}

function suppliedOrigin(value) {
  let parsed;
  try {
    parsed = exactHTTPURL(value);
  } catch (error) {
    fail('INVALID_ORIGIN', 'Provide an explicit origin in the supported HTTP or HTTPS source grammar.', {
      value, causeCode: error.code || null, cause: String(error.message || error)
    });
  }
  if (parsed.pathname !== '/') {
    fail('INVALID_ORIGIN', 'The supplied origin must contain only scheme, host and optional port.', { value });
  }
  return parsed.origin;
}

function readSource(kind, csv, required, url) {
  if (typeof csv !== 'string') {
    fail('INVALID_CSV_INPUT', kind + 'CSV must be the complete original CSV string.');
  }
  let parsed;
  try {
    parsed = parseCSV(csv, { delimiter: ',' });
  } catch (error) {
    fail('CSV_PARSE_ERROR', 'Could not parse the ' + kind + ' source: ' + String(error.message || error), {
      source: kind,
      causeCode: error.code || null
    });
  }
  if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
    fail('PARSER_CONTRACT', 'The shared CSV parser returned an unsupported result.', { source: kind });
  }
  const missing = required.filter(column => !parsed.columns.includes(column));
  if (missing.length) {
    fail('MISSING_COLUMNS', 'The ' + kind + ' source is missing required columns: ' + missing.join(', '), {
      source: kind, missing, columns: parsed.columns
    });
  }
  return {
    source: kind,
    sourceURL: url === undefined ? null : url,
    originalCSV: csv,
    sha256: sha256(csv),
    columns: parsed.columns.slice(),
    rows: parsed.rows.map(row => ({
      rowNumber: row.rowNumber,
      lineNumber: row.lineNumber,
      raw: Object.fromEntries(Object.entries(row.raw))
    }))
  };
}

function record(kind, row) {
  return {
    source: kind,
    rowNumber: row.rowNumber,
    lineNumber: row.lineNumber,
    raw: { ...row.raw },
    identity: kind === 'pricing' ? row.raw.name : row.raw.url,
    title: row.raw.title || (kind === 'pricing' ? row.raw.name : row.raw.slug) || '',
    join: null,
    status: 'unresolved',
    exceptionCodes: [],
    candidateRowNumbers: [],
    matchedRowNumbers: []
  };
}

function addIssue(exceptions, rows, code, message, details = {}) {
  const issue = {
    code,
    message,
    records: rows.map(row => ({
      source: row.source,
      rowNumber: row.rowNumber,
      lineNumber: row.lineNumber,
      identity: row.identity,
      raw: { ...row.raw }
    })),
    details
  };
  exceptions.push(issue);
  for (const row of rows) {
    if (!row.exceptionCodes.includes(code)) row.exceptionCodes.push(code);
  }
}

function sourcePath(row, origin, exceptions) {
  const value = row.source === 'pricing' ? row.raw.path : row.raw.url;
  const column = row.source === 'pricing' ? 'path' : 'url';
  const issue = (code, message, details = {}) => {
    addIssue(exceptions, [row], code, message, { column, value, ...details });
    return null;
  };
  if (typeof value !== 'string' || !value.length) {
    return issue('MISSING_URL', 'The source record has no ' + column + ' value.');
  }
  const absolute = /^https?:\/\//i.test(value);
  const rootRelative = value.startsWith('/') && !value.startsWith('//');
  if (row.source === 'catalogue' && !absolute) {
    return issue('CATALOGUE_URL_NOT_ABSOLUTE', 'A catalogue service needs its original absolute HTTP or HTTPS URL.');
  }
  if (!absolute && !rootRelative) {
    return issue('PRICING_PATH_NOT_ROOT_RELATIVE', 'A pricing path must be an absolute HTTP or HTTPS URL or an explicit root-relative path.');
  }
  let parsed;
  try {
    parsed = exactHTTPURL(absolute ? value : origin + value);
  } catch (error) {
    return issue(error.code || 'INVALID_URL', String(error.message || error), error.details || {});
  }
  if (parsed.origin !== origin) {
    return issue('FOREIGN_ORIGIN', 'The source URL belongs to a different origin.', { expectedOrigin: origin, actualOrigin: parsed.origin });
  }
  return { input: value, origin: parsed.origin, pathname: parsed.pathname, key: parsed.key };
}

function grouped(rows, keyFor) {
  const index = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (key === null || key === undefined) continue;
    const entries = index.get(key) || [];
    entries.push(row);
    index.set(key, entries);
  }
  return index;
}

function validateReport(report) {
  if (!report || report.format !== FORMAT || !Array.isArray(report.pricingRows) ||
      !Array.isArray(report.catalogueRows) || !Array.isArray(report.exceptions)) {
    fail('INVALID_COVERAGE_REPORT', 'Provide a report returned by catalogueCoverage().');
  }
  for (const row of [...report.pricingRows, ...report.catalogueRows]) {
    if (!STATUSES.has(row.status)) fail('INVALID_COVERAGE_STATUS', 'A coverage row has an unknown status.');
  }
  return report;
}

/**
 * Join the publisher's pricing CSV (name, path) to its service catalogue CSV (url).
 * Optional title, slug, amount_gbp, charity_amount_gbp, period, display,
 * source_url and capture_date are displayed exactly as supplied. All columns survive.
 *
 * sourceMetadata is retained as complete JSON. Its pricingURL and catalogueURL
 * members identify the original files; publisher, publisherEdition, acquiredAt,
 * metadataURL and license may describe their provenance.
 *
 * The caller supplies origin explicitly. The strict-http-path-v1 grammar runs
 * identically without host URL globals. It supports ASCII DNS and canonical IPv4,
 * valid decimal ports and encoded URI paths. Paths retain case and trailing slashes.
 * Relative paths need a leading slash. Unsupported forms remain complete exceptions.
 */
export function catalogueCoverage({ pricingCSV, catalogueCSV, origin, sourceMetadata = {} } = {}) {
  const joinOrigin = suppliedOrigin(origin);
  const metadata = jsonCopy(sourceMetadata, 'sourceMetadata');
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('INVALID_METADATA', 'sourceMetadata must be a JSON object.');
  }
  const pricing = readSource('pricing', pricingCSV, ['name', 'path'], metadata.pricingURL);
  const catalogue = readSource('catalogue', catalogueCSV, ['url'], metadata.catalogueURL);
  const pricingRows = pricing.rows.map(row => record('pricing', row));
  const catalogueRows = catalogue.rows.map(row => record('catalogue', row));
  const exceptions = [];

  for (const row of pricingRows) {
    if (!row.raw.name.length || row.raw.name !== row.raw.name.trim()) {
      addIssue(exceptions, [row], 'INVALID_PRICE_IDENTITY', 'The price name is empty or has surrounding whitespace.');
    }
    row.join = sourcePath(row, joinOrigin, exceptions);
  }
  for (const row of catalogueRows) row.join = sourcePath(row, joinOrigin, exceptions);

  const priceNames = grouped(pricingRows, row => row.raw.name || null);
  for (const [name, rows] of priceNames) {
    if (rows.length > 1) {
      addIssue(exceptions, rows, 'DUPLICATE_PRICE_IDENTITY', 'More than one price record uses the same name.', { name });
    }
  }

  const servicesByPath = grouped(catalogueRows, row => row.join?.key);
  const pricesByPath = grouped(pricingRows, row => row.join?.key);
  for (const [key, rows] of servicesByPath) {
    if (rows.length > 1) {
      addIssue(exceptions, rows, 'AMBIGUOUS_CATALOGUE_PATH', 'More than one catalogue record has the same exact origin and path.', { key });
    }
  }

  for (const row of pricingRows) {
    const candidates = row.join ? servicesByPath.get(row.join.key) || [] : [];
    row.candidateRowNumbers = candidates.map(candidate => candidate.rowNumber);
    if (row.exceptionCodes.length) {
      row.status = 'exception';
    } else if (candidates.length > 1) {
      row.status = 'ambiguous';
      addIssue(exceptions, [row], 'AMBIGUOUS_PRICE_MATCH', 'The price path points to multiple catalogue records.', {
        key: row.join.key,
        catalogueRowNumbers: row.candidateRowNumbers
      });
    } else if (candidates.length === 1) {
      row.status = 'matched';
      row.matchedRowNumbers = [candidates[0].rowNumber];
    } else {
      row.status = 'unmatched';
    }
  }

  for (const row of catalogueRows) {
    const candidates = row.join ? pricesByPath.get(row.join.key) || [] : [];
    row.candidateRowNumbers = candidates.map(candidate => candidate.rowNumber);
    row.matchedRowNumbers = candidates.filter(candidate =>
      candidate.status === 'matched' && candidate.matchedRowNumbers.includes(row.rowNumber)
    ).map(candidate => candidate.rowNumber);
    if (row.exceptionCodes.includes('AMBIGUOUS_CATALOGUE_PATH')) {
      row.status = 'ambiguous';
    } else if (row.exceptionCodes.length) {
      row.status = 'exception';
    } else if (row.matchedRowNumbers.length) {
      row.status = 'matched';
    } else if (candidates.length) {
      row.status = 'unresolved';
      addIssue(exceptions, [row], 'UNRESOLVED_PRICE_RECORDS', 'The service has candidate price records that need identity or URL review.', {
        pricingRowNumbers: row.candidateRowNumbers
      });
    } else {
      row.status = 'unmatched';
    }
  }

  const priceRowIndex = new Map(pricingRows.map(row => [row.rowNumber, row]));
  const matches = catalogueRows.filter(row => row.status === 'matched').map(service => ({
    service,
    prices: service.matchedRowNumbers.map(rowNumber => priceRowIndex.get(rowNumber))
  }));
  const unmatchedPricingRows = pricingRows.filter(row => row.status === 'unmatched');
  const unpricedCatalogueRows = catalogueRows.filter(row => row.status === 'unmatched');
  const unresolvedPricingRows = pricingRows.filter(row => !['matched', 'unmatched'].includes(row.status));
  const unresolvedCatalogueRows = catalogueRows.filter(row => !['matched', 'unmatched'].includes(row.status));
  const billingPeriods = Object.create(null);
  if (pricing.columns.includes('period')) {
    for (const row of pricingRows) {
      const period = row.raw.period;
      billingPeriods[period] = (billingPeriods[period] || 0) + 1;
    }
  }
  const summary = {
    pricingRows: pricingRows.length,
    catalogueRows: catalogueRows.length,
    matchedPriceRows: pricingRows.filter(row => row.status === 'matched').length,
    matchedServices: matches.length,
    multiTierServices: matches.filter(match => match.prices.length > 1).length,
    unmatchedPriceRows: unmatchedPricingRows.length,
    unpricedServices: unpricedCatalogueRows.length,
    unresolvedPriceRows: unresolvedPricingRows.length,
    unresolvedServices: unresolvedCatalogueRows.length,
    exceptionCount: exceptions.length,
    billingPeriods: { ...billingPeriods }
  };
  const joinPolicy = {
    origin: joinOrigin,
    originInput: origin,
    pricingIdentityColumn: 'name',
    pricingPathColumn: 'path',
    catalogueURLColumn: 'url',
    pathComparison: 'exact',
    cardinality: 'many price tiers to one service',
    queryAndFragmentPolicy: 'review exception',
    changedPathPolicy: 'review exception',
    urlGrammar: 'strict-http-path-v1',
    originEquivalence: 'ASCII scheme and host case; HTTP 80 and HTTPS 443 defaults',
    supportedHosts: 'ASCII DNS without IDNA labels; canonical dotted-quad IPv4'
  };
  return {
    format: FORMAT,
    coverageId: sha256(canonicalJSON({
      format: FORMAT,
      pricingSHA256: pricing.sha256,
      catalogueSHA256: catalogue.sha256,
      joinPolicy,
      sourceMetadata: metadata
    })),
    joinPolicy,
    sourceMetadata: metadata,
    sources: { pricing, catalogue },
    summary,
    pricingRows,
    catalogueRows,
    matches,
    unmatchedPricingRows,
    unpricedCatalogueRows,
    unresolvedPricingRows,
    unresolvedCatalogueRows,
    exceptions
  };
}

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/**
 * A single-header UTF-8 CSV. Each price tier has one row; catalogue entries without
 * an accepted price match have their own row. Full original records and every
 * candidate survive in JSON cells, together with original file URLs and hashes.
 */
export function coverageCSV(report) {
  validateReport(report);
  const headers = [
    'section', 'coverage_status', 'pricing_row', 'catalogue_rows', 'price_name',
    'service_slugs', 'price_title', 'service_titles', 'canonical_url', 'amount_gbp',
    'charity_amount_gbp', 'period', 'display', 'price_source_url', 'capture_date',
    'exception_codes', 'pricing_record_json', 'catalogue_records_json',
    'pricing_source_url', 'catalogue_source_url', 'pricing_sha256', 'catalogue_sha256'
  ];
  const serviceRows = new Map(report.catalogueRows.map(row => [row.rowNumber, row]));
  const sourceCells = [
    report.sources.pricing.sourceURL,
    report.sources.catalogue.sourceURL,
    report.sources.pricing.sha256,
    report.sources.catalogue.sha256
  ];
  const output = [headers];
  for (const price of report.pricingRows) {
    const candidates = price.candidateRowNumbers.map(rowNumber => serviceRows.get(rowNumber)).filter(Boolean);
    output.push([
      'pricing', price.status, price.rowNumber,
      candidates.map(row => row.rowNumber).join(' | '),
      price.raw.name,
      candidates.map(row => row.raw.slug || '').join(' | '),
      price.raw.title || '',
      candidates.map(row => row.raw.title || '').join(' | '),
      price.join?.key || price.raw.path,
      price.raw.amount_gbp, price.raw.charity_amount_gbp, price.raw.period,
      price.raw.display, price.raw.source_url, price.raw.capture_date,
      price.exceptionCodes.join(' | '),
      canonicalJSON(price.raw),
      canonicalJSON(candidates.map(row => row.raw)),
      ...sourceCells
    ]);
  }
  for (const service of report.catalogueRows.filter(row => row.status !== 'matched')) {
    output.push([
      'catalogue', service.status, '', service.rowNumber, '',
      service.raw.slug || '', '', service.raw.title || '',
      service.join?.key || service.raw.url, '', '', '', '', '', '',
      service.exceptionCodes.join(' | '), '', canonicalJSON([service.raw]), ...sourceCells
    ]);
  }
  return output.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

function escapeHTML(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function published(value) {
  return value === undefined || value === null || value === '' ?
    '<span class="muted">Not published</span>' : escapeHTML(value);
}

function link(value, label) {
  if (typeof value !== 'string') return published(value);
  try {
    exactHTTPURL(value, { allowSuffix: true });
    return '<a href="' + escapeHTML(value) + '" rel="noreferrer">' + escapeHTML(label || value) + '</a>';
  } catch {
    return escapeHTML(value);
  }
}

function table(headers, rows, emptyMessage) {
  if (!rows.length) return '<p class="muted">' + escapeHTML(emptyMessage) + '</p>';
  return '<div class="table-wrap"><table><thead><tr>' +
    headers.map(header => '<th scope="col">' + escapeHTML(header) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + row.map(value => '<td>' + value + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}

function identityBlock(title, identity) {
  return '<strong>' + escapeHTML(title || identity || 'Untitled source record') + '</strong>' +
    (identity && identity !== title ? '<span class="secondary">' + escapeHTML(identity) + '</span>' : '');
}

function priceCells(price) {
  return [
    identityBlock(price.raw.title, price.raw.name),
    published(price.raw.amount_gbp),
    published(price.raw.charity_amount_gbp),
    published(price.raw.period),
    published(price.raw.display),
    price.raw.source_url ? link(price.raw.source_url, 'Published source') : published(''),
    published(price.raw.capture_date)
  ];
}

function originalTable(source) {
  return table(
    ['CSV row', 'Source line', ...source.columns],
    source.rows.map(row => [
      escapeHTML(row.rowNumber),
      escapeHTML(row.lineNumber),
      ...source.columns.map(column => escapeHTML(row.raw[column]))
    ]),
    'The supplied source contains a header and no data rows.'
  );
}

/** Produce a complete standalone report with neutral industrial styling. */
export function coverageHTML(report) {
  validateReport(report);
  const m = report.sourceMetadata;
  const s = report.summary;
  const priceHeaders = ['Published price tier', 'Amount (GBP)', 'Charity amount (GBP)', 'Billing period', 'Published wording', 'Source page', 'Capture date'];
  const matchRows = report.matches.flatMap(match => match.prices.map(price => [
    identityBlock(match.service.raw.title, match.service.raw.slug) +
      '<span class="secondary">' + link(match.service.join.key, match.service.join.pathname) + '</span>',
    ...priceCells(price)
  ]));
  const unmatchedPriceRows = report.unmatchedPricingRows.map(price => [
    price.join ? link(price.join.key, price.join.pathname) : published(price.raw.path),
    ...priceCells(price)
  ]);
  const unpricedRows = report.unpricedCatalogueRows.map(service => [
    identityBlock(service.raw.title, service.raw.slug),
    published(service.raw.section),
    published(service.raw.short),
    link(service.raw.url)
  ]);
  const exceptionRows = report.exceptions.map(issue => [
    '<strong>' + escapeHTML(issue.message) + '</strong><span class="secondary">' + escapeHTML(issue.code) + '</span>',
    issue.records.map(row => escapeHTML(row.source === 'pricing' ? 'Pricing' : 'Catalogue') +
      ' row ' + escapeHTML(row.rowNumber) + ': ' + escapeHTML(row.identity || 'Empty identity')).join('<br>'),
    '<details><summary>Original records and details</summary><pre>' +
      escapeHTML(JSON.stringify({ records: issue.records, details: issue.details }, null, 2)) +
      '</pre></details>'
  ]);
  const stats = [
    ['Published price tiers', s.pricingRows],
    ['Catalogue services', s.catalogueRows],
    ['Matched price tiers', s.matchedPriceRows],
    ['Services with mapped prices', s.matchedServices],
    ['Prices outside the catalogue', s.unmatchedPriceRows],
    ['Services without mapped prices', s.unpricedServices]
  ];
  const sourceInfo = {
    coverageId: report.coverageId,
    joinPolicy: report.joinPolicy,
    sourceMetadata: report.sourceMetadata,
    sourceFiles: {
      pricing: { sourceURL: report.sources.pricing.sourceURL, sha256: report.sources.pricing.sha256, columns: report.sources.pricing.columns },
      catalogue: { sourceURL: report.sources.catalogue.sourceURL, sha256: report.sources.catalogue.sha256, columns: report.sources.catalogue.columns }
    },
    summary: report.summary
  };
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Supplier catalogue coverage</title>',
    '<style>',
    ':root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#202020;background:#f5f5f5;font-size:15px;line-height:1.5}',
    '*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}',
    'header,section{background:#fff;border:1px solid #c9c9c9;padding:24px;margin:0 0 20px}',
    'h1{font-size:28px;line-height:1.2;margin:0 0 12px}h2{font-size:20px;line-height:1.3;margin:0 0 12px}',
    'p{margin:0 0 14px}p:last-child{margin-bottom:0}a{color:inherit;text-underline-offset:3px;overflow-wrap:anywhere}',
    '.eyebrow{font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase}.muted,.secondary{color:#606060}',
    '.secondary{display:block;font-size:12px;margin-top:4px;overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}',
    '.stat{border:1px solid #d2d2d2;padding:14px}.stat strong{display:block;font-size:27px;line-height:1.2}.stat span{display:block;font-size:13px;margin-top:4px}',
    '.table-wrap{overflow:auto;border:1px solid #c9c9c9}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left}',
    'th,td{padding:10px 12px;border-bottom:1px solid #dedede;vertical-align:top;overflow-wrap:anywhere}th{background:#eeeeee;font-weight:bold}tbody tr:last-child td{border-bottom:0}',
    'dl{display:grid;grid-template-columns:170px minmax(0,1fr);gap:8px 16px;margin:0}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}',
    'details{margin-top:16px}summary{cursor:pointer;font-weight:bold}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;border:1px solid #dedede;padding:16px;font-size:12px}',
    'nav{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px;font-size:13px}.notice{border-left:3px solid #444;padding-left:12px}',
    '@media(max-width:700px){main{padding:12px}header,section{padding:16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}}',
    '@media print{:root{background:#fff;font-size:11px}main{padding:0;max-width:none}header,section{border:0;padding:0;margin-bottom:24px}.table-wrap{overflow:visible}table{font-size:9px}th,td{padding:5px}tr{break-inside:avoid}nav{display:none}a{text-decoration:none}.stats{grid-template-columns:repeat(3,1fr)}}',
    '</style></head><body><main>',
    '<header><p class="eyebrow">Supplier feed review</p><h1>Supplier catalogue coverage</h1>',
    '<p>Published price tiers linked to catalogue services by the exact origin and path supplied in the source files.</p>',
    '<p class="notice">Each price tier remains a separate record. Blank price fields display as “Not published”; published zero values remain zero. Price wording and billing periods retain the publisher’s terms.</p>',
    '<div class="stats">' + stats.map(([label, value]) => '<div class="stat"><strong>' + escapeHTML(value) + '</strong><span>' + escapeHTML(label) + '</span></div>').join('') + '</div>',
    '<nav aria-label="Report sections"><a href="#sources">Sources</a><a href="#mapped">Mapped prices</a><a href="#outside">Prices outside catalogue</a><a href="#unpriced">Services without prices</a><a href="#exceptions">Review exceptions</a><a href="#originals">Original rows</a></nav></header>',
    '<section id="sources"><h2>Sources and matching rule</h2><dl>',
    '<dt>Publisher</dt><dd>' + published(m.publisher) + '</dd>',
    '<dt>Publisher edition</dt><dd>' + published(m.publisherEdition) + '</dd>',
    '<dt>Acquired</dt><dd>' + published(m.acquiredAt) + '</dd>',
    '<dt>Pricing file</dt><dd>' + link(report.sources.pricing.sourceURL) + '</dd>',
    '<dt>Catalogue file</dt><dd>' + link(report.sources.catalogue.sourceURL) + '</dd>',
    '<dt>Publisher metadata</dt><dd>' + link(m.metadataURL) + '</dd>',
    '<dt>License</dt><dd>' + published(typeof m.license === 'string' ? m.license : m.license ? JSON.stringify(m.license) : '') + '</dd>',
    '<dt>Join origin</dt><dd>' + escapeHTML(report.joinPolicy.origin) + '</dd>',
    '<dt>Service relationship</dt><dd>Pricing path → catalogue URL pathname. Case and trailing slashes are retained. Multiple distinct price names may map to one service.</dd>',
    '</dl><details><summary>Complete metadata, file fingerprints and coverage counts</summary><pre>' +
      escapeHTML(JSON.stringify(sourceInfo, null, 2)) + '</pre></details></section>',
    '<section id="mapped"><h2>Mapped published prices</h2><p>' + escapeHTML(s.matchedPriceRows) +
      ' price tiers map to ' + escapeHTML(s.matchedServices) + ' services. ' + escapeHTML(s.multiTierServices) +
      ' services have multiple published price tiers.</p>' +
      table(['Catalogue service', ...priceHeaders], matchRows, 'No price rows have an unambiguous catalogue counterpart.') + '</section>',
    '<section id="outside"><h2>Published prices outside the supplied catalogue</h2><p>These original pricing paths have no service counterpart in the supplied catalogue. Keep the complete price records available for scope and catalogue review.</p>' +
      table(['Pricing path', ...priceHeaders], unmatchedPriceRows, 'Every usable price path has a catalogue counterpart.') + '</section>',
    '<section id="unpriced"><h2>Catalogue services without mapped published prices</h2><p>These source services have no price record at the same exact origin and path. They remain complete catalogue entries for commercial follow-up and catalogue maintenance.</p>' +
      table(['Catalogue service', 'Section', 'Published description', 'Canonical URL'], unpricedRows, 'Every usable catalogue service has at least one candidate price record.') + '</section>',
    '<section id="exceptions"><h2>Review exceptions</h2><p>' + escapeHTML(s.unresolvedPriceRows) +
      ' pricing records and ' + escapeHTML(s.unresolvedServices) + ' catalogue records need review. ' +
      escapeHTML(s.exceptionCount) + ' exception entries retain their complete source records.</p>' +
      table(['Reason', 'Affected source records', 'Details'], exceptionRows, 'All supplied identities and service paths support an unambiguous coverage result.') + '</section>',
    '<section id="originals"><h2>Complete original source rows</h2><p>Every original column and field is preserved below. CSV row and source line numbers refer to the original files.</p>',
    '<details><summary>Pricing source — ' + escapeHTML(s.pricingRows) + ' rows</summary>' + originalTable(report.sources.pricing) + '</details>',
    '<details><summary>Catalogue source — ' + escapeHTML(s.catalogueRows) + ' rows</summary>' + originalTable(report.sources.catalogue) + '</details>',
    '<details><summary>Original pricing CSV text</summary><pre>' + escapeHTML(report.sources.pricing.originalCSV) + '</pre></details>',
    '<details><summary>Original catalogue CSV text</summary><pre>' + escapeHTML(report.sources.catalogue.originalCSV) + '</pre></details>',
    '</section></main></body></html>'
  ].join('\n');
}
