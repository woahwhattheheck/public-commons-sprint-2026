// MIT. Supplier document preparation shared by the original catalog UI and CLI.
// Original source cells and operator decisions remain separate throughout export.
export const DOCUMENT_SOURCE_SCHEMA = 'commons.supplier-document-observations.v1';
export const DOCUMENT_PREPARATION_SCHEMA = 'stellar-forge.document-preparation.v1';
export const PREPARED_CATALOG_SCHEMA = 'stellar-forge.prepared-document-catalog.v1';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const clone = x => JSON.parse(JSON.stringify(x));
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : object(x)
  ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
const has = (x, k) => Object.hasOwn(x, k);
const DECISION_KEYS = ['include', 'title', 'description', 'unit', 'salesUnit', 'numerator',
  'denominator', 'priceAmount', 'currency', 'priceBasis', 'note', 'sourceUrl'];
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function str(x, label, optional = false, limit = 65536) {
  if (optional && (x === null || x === undefined || x === '')) return '';
  if (typeof x !== 'string' || !x.trim() || x.length > limit || x.includes('\0'))
    fail('DOCUMENT_TEXT_INVALID', label + ' must contain original text.');
  return x;
}
function url(x, label, optional = false) {
  const s = str(x, label, optional, 4096); if (!s) return '';
  if (!/^https?:\/\/[^/?#\s@]+(?:[/?#][^\s]*)?$/.test(s))
    fail('DOCUMENT_URL_INVALID', label + ' must be an HTTP or HTTPS URL without credentials.');
  return s;
}
function decimal(x, label, positive = false) {
  if (typeof x !== 'string' || !/^(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/.test(x) ||
      positive && !/[1-9]/.test(x))
    fail('DOCUMENT_DECIMAL_INVALID', label + ' must be ' + (positive ? 'positive' : 'nonnegative') + ' plain decimal text.');
  return x;
}
function sameDecimal(a, b) {
  const normalize = x => { const p = x.split('.'); return p[0] + '.' + (p[1] || '').replace(/0+$/, ''); };
  return normalize(a) === normalize(b);
}
function basis(x, label) {
  if (!object(x)) fail('DOCUMENT_QUANTITY_INVALID', label + ' must be an object.');
  const unit = str(x.unit, label + ' base unit', true, 80);
  const salesUnit = str(x.salesUnit, label + ' sales unit', true, 80);
  const numerator = str(x.numerator, label + ' numerator', true, 80);
  const denominator = str(x.denominator, label + ' denominator', true, 80);
  if (Boolean(numerator) !== Boolean(denominator) || (numerator || denominator) && (!unit || !salesUnit))
    fail('DOCUMENT_QUANTITY_INCOMPLETE', 'Select both units and both ratio terms, or leave the ratio empty.');
  if (numerator) {
    decimal(numerator, 'Quantity numerator', true); decimal(denominator, 'Quantity denominator', true);
    if (unit === salesUnit && !sameDecimal(numerator, denominator))
      fail('DOCUMENT_QUANTITY_CONFLICT', 'Equal units need a one-to-one ratio.');
  }
  return { unit, salesUnit, numerator, denominator };
}
export function validateDocumentSource(source) {
  if (!object(source) || source.schema !== DOCUMENT_SOURCE_SCHEMA || !object(source.source_document))
    fail('DOCUMENT_SOURCE_REQUIRED', 'Open a complete supplier document observation bundle.');
  const doc = source.source_document;
  str(doc.id, 'Source document identifier', false, 1024); str(doc.title, 'Source title');
  url(doc.url, 'Original document URL'); str(doc.publisher, 'Source publisher');
  if (!Array.isArray(source.products) || !source.products.length || source.products.length > 10000)
    fail('DOCUMENT_PRODUCTS_INVALID', 'Keep between one and 10,000 complete source product rows.');
  const seen = new Set();
  for (const p of source.products) {
    if (!object(p)) fail('DOCUMENT_PRODUCT_INVALID', 'A source product must be an object.');
    const sku = str(p.supplier_sku, 'Exact supplier SKU', false, 1024);
    if (seen.has(sku)) fail('DOCUMENT_SKU_DUPLICATE', 'Repeated supplier SKU: ' + sku);
    seen.add(sku);
    if (!object(p.raw) || Object.keys(p.raw).length > 512 ||
        Object.entries(p.raw).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string'))
      fail('DOCUMENT_CELLS_INVALID', 'Retain each original sales-table value as text.');
    if (p.observed_price?.amount_decimal !== null && p.observed_price?.amount_decimal !== undefined)
      decimal(p.observed_price.amount_decimal, 'Printed price');
    if (p.quantity_basis) {
      basis(p.quantity_basis, 'Source-supported quantity');
      url(p.quantity_basis.source_url, 'Quantity source URL');
      str(p.quantity_basis.source_text, 'Quantity source text');
    }
    if (p.product_page_price_observation?.amount_decimal)
      decimal(p.product_page_price_observation.amount_decimal, 'Observed product-page price');
  }
  for (const name of ['tables', 'compatibility_cells', 'review_notes'])
    if (source[name] !== undefined && !Array.isArray(source[name]))
      fail('DOCUMENT_SOURCE_INVALID', name + ' must be an array.');
  return source;
}
function validateDecision(patch) {
  if (!object(patch) || Object.keys(patch).some(k => !DECISION_KEYS.includes(k)))
    fail('DOCUMENT_DECISION_INVALID', 'Use the declared product decision fields.');
  if (has(patch, 'include') && typeof patch.include !== 'boolean')
    fail('DOCUMENT_DECISION_INVALID', 'Include must be true or false.');
  for (const k of DECISION_KEYS.filter(k => k !== 'include'))
    if (has(patch, k)) str(patch[k], 'Decision ' + k, true, k === 'description' ? 65536 : 8192);
  if (patch.priceAmount) decimal(patch.priceAmount, 'Selected price');
  if (patch.currency && !/^[A-Z]{3}$/.test(patch.currency))
    fail('DOCUMENT_CURRENCY_INVALID', 'Use the explicitly sourced three-letter currency.');
  if (patch.sourceUrl) url(patch.sourceUrl, 'Decision source URL');
  return patch;
}
function effective(product, decision = {}) {
  const b = product.quantity_basis || {}, page = product.product_page_price_observation || {};
  const choose = (key, initial) => has(decision, key) ? decision[key] : initial;
  const selected = {
    include: choose('include', true),
    title: choose('title', [product.family, product.supplier_sku].filter(Boolean).join(' — ')),
    description: choose('description', [...Object.entries(product.raw).filter(([key]) => !['Part Number', 'Drawing Link'].includes(key))
      .map(([key, value]) => key + ': ' + value), ...(product.specification_observations || [])
      .map(row => [row.context, row.label].filter(Boolean).join(' / ') + ': ' + row.value)].join('; ')),
    unit: choose('unit', b.unit || ''), salesUnit: choose('salesUnit', b.salesUnit || ''),
    numerator: choose('numerator', b.numerator || ''), denominator: choose('denominator', b.denominator || ''),
    priceAmount: choose('priceAmount', product.observed_price?.amount_decimal || ''),
    currency: choose('currency', page.currency || ''),
    priceBasis: choose('priceBasis', page.price_basis || ''),
    note: decision.note || '', sourceUrl: decision.sourceUrl || '',
  };
  basis(selected, 'Selected quantity');
  if (selected.priceAmount) decimal(selected.priceAmount, 'Selected price');
  return selected;
}
export function createDocumentWorkingRecord(source) {
  validateDocumentSource(source);
  return { schema: DOCUMENT_PREPARATION_SCHEMA, source: clone(source), decisions: {}, history: [], revision: 0 };
}
export function openDocumentWorkingRecord(value) {
  const input = typeof value === 'string' ? JSON.parse(value) : value;
  if (input?.schema === DOCUMENT_SOURCE_SCHEMA) return createDocumentWorkingRecord(input);
  if (!object(input) || input.schema !== DOCUMENT_PREPARATION_SCHEMA || !object(input.decisions) ||
      !Array.isArray(input.history) || !Number.isSafeInteger(input.revision) || input.revision < 0)
    fail('DOCUMENT_WORKING_RECORD_INVALID', 'Open a complete document preparation working record.');
  validateDocumentSource(input.source);
  const skus = new Map(input.source.products.map(p => [p.supplier_sku, p]));
  for (const [sku, decision] of Object.entries(input.decisions)) {
    if (!skus.has(sku)) fail('DOCUMENT_DECISION_ORPHAN', 'A decision has no original source product: ' + sku);
    validateDecision(decision); str(decision.note, 'Operator decision reason');
    effective(skus.get(sku), decision);
  }
  if (input.history.length !== input.revision)
    fail('DOCUMENT_HISTORY_INVALID', 'Keep the complete preparation revision history.');
  let previous = {};
  for (let i = 0; i < input.history.length; i++) {
    const h = input.history[i];
    if (!object(h) || h.revision !== i + 1 || !skus.has(h.supplier_sku) ||
        !['decision', 'restore-source'].includes(h.action))
      fail('DOCUMENT_HISTORY_INVALID', 'A preparation revision is incomplete.');
    const before = has(previous, h.supplier_sku) ? previous[h.supplier_sku] : null;
    if (canonical(before) !== canonical(h.before))
      fail('DOCUMENT_HISTORY_INVALID', 'The preparation history no longer matches its earlier decision.');
    if (h.action === 'restore-source') {
      if (h.after !== null) fail('DOCUMENT_HISTORY_INVALID', 'A restored source must clear its decision.');
      delete previous[h.supplier_sku];
    } else {
      validateDecision(h.after); str(h.after.note, 'Operator decision reason');
      effective(skus.get(h.supplier_sku), h.after);
      previous = Object.fromEntries([...Object.entries(previous).filter(([k]) => k !== h.supplier_sku),
        [h.supplier_sku, h.after]]);
    }
  }
  if (canonical(previous) !== canonical(input.decisions))
    fail('DOCUMENT_HISTORY_INVALID', 'Current decisions differ from the retained revision history.');
  return clone(input);
}
export function applyDocumentDecision(record, sku, patch) {
  const next = openDocumentWorkingRecord(record), product = next.source.products.find(p => p.supplier_sku === sku);
  if (!product) fail('DOCUMENT_PRODUCT_MISSING', 'Select an original supplier SKU.');
  validateDecision(patch);
  const before = has(next.decisions, sku) ? next.decisions[sku] : null;
  const after = { ...(before || {}), ...clone(patch) };
  str(after.note, 'Operator decision reason'); effective(product, after);
  if (canonical(before) === canonical(after)) return next;
  next.decisions = Object.fromEntries([...Object.entries(next.decisions).filter(([k]) => k !== sku), [sku, after]]);
  next.revision++;
  next.history.push({ revision: next.revision, supplier_sku: sku, action: 'decision', before, after: clone(after) });
  return next;
}
export function resetDocumentDecision(record, sku) {
  const next = openDocumentWorkingRecord(record);
  if (!next.source.products.some(p => p.supplier_sku === sku)) fail('DOCUMENT_PRODUCT_MISSING', 'Select an original supplier SKU.');
  if (!has(next.decisions, sku)) return next;
  const before = clone(next.decisions[sku]); delete next.decisions[sku]; next.revision++;
  next.history.push({ revision: next.revision, supplier_sku: sku, action: 'restore-source', before, after: null });
  return next;
}
export function documentCatalogMapping() {
  const columns = { materialId: 'material_id', title: 'title', description: 'description',
    partNumber: 'part_number', manufacturer: 'manufacturer', category: 'category',
    unit: 'unit', salesUnit: 'sales_unit', numerator: 'unit_numerator', denominator: 'unit_denominator' };
  return { schema: 'stellar-forge.material-catalog-mapping.v1', fields: columns,
    identifierPolicy: 'exact', references: [{ kind: 'supplier-sku', value: 'material_id' }],
    attributes: {
      source_document: '/attributes/source_document', source_cells: '/attributes/source_cells',
      source_cell_origins: '/attributes/source_cell_origins', source_location: '/attributes/source_location',
      printed_price: '/attributes/printed_price', supplier_page_price: '/attributes/supplier_page_price',
      selected_price: '/attributes/selected_price', quantity_basis: '/attributes/quantity_basis',
      published_quantity: '/attributes/published_quantity', compatibility: '/attributes/compatibility',
      specifications: '/attributes/specifications', operator_decision: '/attributes/operator_decision',
    }, unitAliases: {}, delta: null };
}
export function prepareDocument(input) {
  const record = openDocumentWorkingRecord(input), source = record.source, doc = source.source_document;
  const compatibility = [], byPair = new Map(), review = (source.review_notes || []).map(clone);
  for (const cell of source.compatibility_cells || []) {
    if (!object(cell)) fail('DOCUMENT_COMPATIBILITY_INVALID', 'Compatibility observations must be objects.');
    if (cell.published_capacity === null || cell.published_capacity === undefined) continue;
    const count = decimal(cell.published_capacity, 'Published connector capacity', true);
    const from = str(cell.from_supplier_sku, 'Enclosure part number'), to = str(cell.to_part_number, 'Connector part number');
    const key = JSON.stringify([from, to]), existing = byPair.get(key);
    if (!existing) {
      const relationship = { from_supplier_sku: from, to_part_number: to, capacity: count, observations: [clone(cell)] };
      byPair.set(key, relationship); compatibility.push(relationship);
    } else {
      existing.observations.push(clone(cell));
      if (existing.capacity !== null && !sameDecimal(existing.capacity, count)) {
        existing.capacity = null;
        review.push({ id: 'compatibility-conflict-' + from + '-' + to, scope: from,
          note: 'Published connector capacities disagree. Review each original observation before selecting a capacity.' });
      }
    }
  }
  let excluded = 0, withUnits = 0, withConversions = 0, withPrices = 0;
  const rows = [], products = [];
  for (const p of source.products) {
    const decision = has(record.decisions, p.supplier_sku) ? record.decisions[p.supplier_sku] : {};
    const selected = effective(p, decision), relations = compatibility.filter(c =>
      c.from_supplier_sku === p.supplier_sku || c.to_part_number === p.supplier_sku);
    products.push({ supplier_sku: p.supplier_sku, source: clone(p), selected: clone(selected),
      decision: clone(decision), compatibility: clone(relations) });
    if (!selected.include) { excluded++; continue; }
    if (selected.unit) withUnits++;
    else review.push({ id: 'unit-' + p.supplier_sku, scope: p.supplier_sku, note: 'Select the base unit from its supplier source before quantity conversion.' });
    if (selected.unit && selected.salesUnit && (selected.numerator || selected.unit === selected.salesUnit)) withConversions++;
    if (selected.priceAmount) withPrices++;
    rows.push({
      material_id: p.supplier_sku, title: selected.title || p.supplier_sku,
      description: selected.description || selected.title || p.supplier_sku,
      // A supplier SKU is not silently promoted to a manufacturer part identifier.
      part_number: p.manufacturer_part_number || '',
      manufacturer: p.manufacturer || doc.manufacturer || '', category: p.family || '',
      unit: selected.unit, sales_unit: selected.salesUnit,
      unit_numerator: selected.numerator, unit_denominator: selected.denominator,
      attributes: {
        source_document: clone(doc), source_cells: clone(p.raw), source_cell_origins: clone(p.cell_origins || {}),
        source_location: { document_id: doc.id, page: p.source_page, table_id: p.table_id,
          row: p.source_row, footer: p.source_footer || '' },
        printed_price: clone(p.observed_price || {}), supplier_page_price: clone(p.product_page_price_observation || {}),
        selected_price: { amount_decimal: selected.priceAmount, currency: selected.currency, basis: selected.priceBasis,
          origin: has(decision, 'priceAmount') || has(decision, 'currency') || has(decision, 'priceBasis')
            ? 'operator-decision' : 'printed-document-with-supplier-page-basis',
          source_url: selected.sourceUrl || doc.url, operator_note: selected.note },
        quantity_basis: { ...basis(selected, 'Selected quantity'), source_observation: clone(p.quantity_basis || {}),
          operator_note: selected.note },
        published_quantity: clone(p.quantity_interpretation || {}),
        compatibility: clone(relations),
        specifications: clone(p.specification_observations || []),
        operator_decision: clone(decision),
      },
    });
  }
  return { rows, mapping: documentCatalogMapping(), products, review, compatibility,
    summary: { sourceProducts: source.products.length, includedProducts: rows.length, excludedProducts: excluded,
      productsWithUnits: withUnits, productsWithConversions: withConversions, productsWithPrices: withPrices,
      compatibilityObservations: (source.compatibility_cells || []).length,
      positiveCompatibilityObservations: compatibility.reduce((n, c) => n + c.observations.length, 0),
      compatibilityRelationships: compatibility.length, decisionCount: Object.keys(record.decisions).length,
      revision: record.revision } };
}
function csv(columns, rows) {
  const cell = value => {
    let s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [columns, ...rows.map(row => columns.map(k => row[k]))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function documentPreparationFiles(input) {
  const record = openDocumentWorkingRecord(input), prepared = prepareDocument(record);
  const document = { schema: PREPARED_CATALOG_SCHEMA, source_document: clone(record.source.source_document),
    products: prepared.rows, preparation: record };
  const json = (name, value) => ({ name, type: 'application/json; charset=utf-8', content: JSON.stringify(value, null, 2) + '\n' });
  const products = prepared.products.map(p => ({
    'Supplier SKU': p.supplier_sku, Include: p.selected.include ? 'yes' : 'no', Title: p.selected.title,
    'Base unit': p.selected.unit, 'Sales unit': p.selected.salesUnit,
    Numerator: p.selected.numerator, Denominator: p.selected.denominator,
    'Published Qty': p.source.raw.Qty || '', 'Printed price': p.source.observed_price?.raw || '',
    'Selected price': p.selected.priceAmount, Currency: p.selected.currency, 'Price basis': p.selected.priceBasis,
    'Source page': p.source.source_page, 'Source table': p.source.table_id, 'Operator note': p.selected.note,
  }));
  const compatibility = (record.source.compatibility_cells || []).map(c => ({
    'Enclosure SKU': c.from_supplier_sku, 'Connector part': c.to_part_number,
    'Published cell': c.raw, 'Connector capacity': c.published_capacity,
    Page: c.source_page, Table: c.table_id, Row: c.source_row, Column: c.source_column,
  }));
  return [
    json('Prepared_Catalogue.json', document), json('Mapping.json', prepared.mapping),
    json('Working_Record.json', record), json('Source_Observations.json', record.source),
    { name: 'Products.csv', type: 'text/csv; charset=utf-8',
      content: csv(['Supplier SKU', 'Include', 'Title', 'Base unit', 'Sales unit', 'Numerator', 'Denominator',
        'Published Qty', 'Printed price', 'Selected price', 'Currency', 'Price basis', 'Source page', 'Source table', 'Operator note'], products) },
    { name: 'Compatibility.csv', type: 'text/csv; charset=utf-8',
      content: csv(['Enclosure SKU', 'Connector part', 'Published cell', 'Connector capacity', 'Page', 'Table', 'Row', 'Column'], compatibility) },
  ];
}
