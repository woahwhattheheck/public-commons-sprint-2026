// MIT. SF78: browser-local CSV projection of the exact SF70 native observations.
// Advertisements are not seller quotes, validated payment requests or receipts.
const HEADERS = Object.freeze([
  'record_type','federation_state','stellar_network','federation_observed_at_utc',
  'provider','provider_status','provider_observed_at_utc','provider_endpoint',
  'provider_coverage','provider_declared_total','selected_query','selected_provider','selected_operation',
  'native_source_row','service_label','resource_url','description','declared_method',
  'declared_input_type','declared_tool','route_template','option_number',
  'observed_option_count','additional_options_not_shown','option_network','option_scheme',
  'option_asset','option_pay_to','option_amount_atomic','interpretation'
]);
const safeText = value => value == null ? '' : String(value);
// Quoting is not enough for spreadsheet clients: prevent formulas even after whitespace.
function csvCell(value) {
  const raw = safeText(value);
  const safe = /^[\x00-\x20\uFEFF]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}
const serialize = cells => cells.map(csvCell).join(',');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function buildOfferCsv(snapshot, selectedRows = snapshot?.listings, selection = {}) {
  if (!plain(snapshot) || !Array.isArray(snapshot.sources) ||
      !Array.isArray(snapshot.listings) || !Array.isArray(selectedRows)) {
    throw new TypeError('EXPECTED_NATIVE_FEDERATION_SNAPSHOT');
  }
  if (selectedRows.some(row => !plain(row))) throw new TypeError('INVALID_SELECTED_ROW');
  const sources = new Map();
  for (const source of snapshot.sources) {
    if (!plain(source) || typeof source.provider !== 'string' || sources.has(source.provider)) {
      throw new TypeError('INVALID_NATIVE_SOURCE_ID');
    }
    sources.set(source.provider, source);
  }
  const csvRows = [serialize(HEADERS)];
  const output = (recordType, source, row = {}, option = {}, optionIndex = '', interpretation = '') => {
    const cells = [
      recordType, snapshot.state, snapshot.network, snapshot.observedAt,
      source.provider, source.status, source.observedAt, source.endpoint,
      source.coverage, source.declaredTotal, selection.query, selection.provider, selection.operation,
      row.sourceRow, row.label, row.url, row.description, row.method, row.kind,
      row.toolName, row.routeTemplate, optionIndex,
      row.paymentOptions?.length, row.hiddenPaymentOptions,
      option.network, option.scheme, option.asset, option.payTo, option.amount,
      interpretation,
    ];
    csvRows.push(serialize(cells));
  };
  // Always retain provider-level coverage, including an unavailable source with zero rows.
  for (const source of sources.values()) {
    output('PROVIDER_STATUS', source, {}, {}, '', source.status === 'COMPLETE_GET_CAPTURE' ?
      'Original native discovery observation; provider authority and seller terms unverified.' :
      'Source unavailable or incomplete: zero listing rows does NOT mean zero offered resources.');
  }
  for (const row of selectedRows) {
    const source = sources.get(row.source);
    if (!source || source.status !== 'COMPLETE_GET_CAPTURE') {
      throw new TypeError('SELECTED_ROW_SOURCE_NOT_COMPLETE');
    }
    if (!Array.isArray(row.paymentOptions) || row.paymentOptions.some(option => !plain(option))) {
      throw new TypeError('INVALID_NATIVE_OPTIONS');
    }
    const truncated = Number(row.hiddenPaymentOptions || 0);
    const note = truncated > 0 ?
      'Advertised alternative list truncated by SF70 projection: ' + truncated + ' undisplayed; do not infer all terms.' :
      'Observed provider advertisement only; not seller-verified, payment-authorized or settled.';
    if (row.paymentOptions.length === 0) output('RESOURCE_NO_OFFER', source, row, {}, '', note);
    else row.paymentOptions.forEach((option, index) => output('ADVERTISED_OPTION', source, row, option, index + 1, note));
  }
  // UTF-8 BOM improves Excel opening; CRLF and per-cell quote escaping preserve actual text.
  return '\uFEFF' + csvRows.join('\r\n') + '\r\n';
}