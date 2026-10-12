// MIT. Complete xChange context joins on the original catalog's temporary SQLite state.
import { randomUUID } from 'node:crypto';
import { WorkspaceError, digest } from '../../../workspace/store.mjs';
import { readXChange } from './input.mjs';

export const XCHANGE_PRODUCT_SCHEMA = 'stellar-forge.xchange-product.v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = key => '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
const json = value => JSON.stringify(value);
function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function fail(code, message, status = 400) { throw new WorkspaceError('SUPPLIER_XCHANGE_' + code, message, status); }
function abort(signal) {
  if (signal?.aborted) throw signal.reason ?? new WorkspaceError('SUPPLIER_XCHANGE_ABORTED', 'Source intake was cancelled.', 499);
}
function originalString(value, tokens, path) {
  return typeof value === 'string' && value.length > 0 && !Object.hasOwn(tokens ?? {}, path) ? value : null;
}
function firstIdentifier(value, tokens, prefix, names) {
  for (const name of names) {
    const selected = originalString(value?.[name], tokens, prefix + pointer(name));
    if (selected !== null) return { field: name, value: selected };
  }
  return null;
}
function joinedRow(product, supplier, catalogue) {
  const supplierIdentity = firstIdentifier(supplier.header, supplier.numberTokens, '',
    ['SupplierIdGln', 'SupplierIdDuns', 'SupplierVatNo', 'SupplierName']);
  const identification = object(product.product.ProductIdentification) ? product.product.ProductIdentification : {};
  const manufacturer = firstIdentifier(identification, product.numberTokens, '/ProductIdentification',
    ['ManufacturerIdGln', 'ManufacturerIdDuns', 'ManufacturerName']);
  const productId = originalString(identification.ManufacturerProductNumber, product.numberTokens,
    '/ProductIdentification/ManufacturerProductNumber');
  const missing = [];
  if (supplierIdentity === null) missing.push('/Supplier/' + product.supplierIndex + '/SupplierName');
  if (manufacturer === null) missing.push('/ProductIdentification/ManufacturerName');
  if (productId === null) missing.push('/ProductIdentification/ManufacturerProductNumber');
  const supplierKey = supplierIdentity !== null ? digest(['xchange-supplier', supplierIdentity.field, supplierIdentity.value]) :
    digest(['xchange-supplier-index', catalogue.sha256, product.supplierIndex]);
  const materialId = manufacturer !== null && productId !== null ?
    digest(['xchange-product', supplierKey, manufacturer.field, manufacturer.value, productId]) :
    digest(['xchange-product-index', catalogue.sha256, product.supplierIndex, product.productIndex]);
  const descriptions = product.product.ProductDetails?.ProductDescriptions;
  const first = Array.isArray(descriptions) && object(descriptions[0]) ? descriptions[0] : {};
  const title = firstIdentifier(first, product.numberTokens, '/ProductDetails/ProductDescriptions/0',
    ['MinimalProductDescription', 'UniqueMainProductDescription'])?.value ?? productId ??
    ('Product at ' + product.source.path);
  return freeze({
    ordinal: product.ordinal,
    record: {
      materialId, title,
      xChange: {
        schema: XCHANGE_PRODUCT_SCHEMA,
        catalogue: { header: catalogue.header, numberTokens: catalogue.numberTokens, fieldOrder: catalogue.fieldOrder },
        supplier: { key: supplierKey, index: product.supplierIndex,
          header: supplier.header, numberTokens: supplier.numberTokens, fieldOrder: supplier.fieldOrder },
        product: product.product, numberTokens: product.numberTokens,
        identity: { strategy: missing.length ? 'source-index' : 'native-identifiers', missing,
          fields: { supplier: supplierIdentity?.field ?? null, manufacturer: manufacturer?.field ?? null,
            product: productId === null ? null : 'ManufacturerProductNumber' } },
        source: { ...product.source, document: { bytes: catalogue.bytes, sha256: catalogue.sha256 } }
      }
    }
  });
}

/**
 * Stage one original nested document completely before yielding catalog rows.
 * The caller retains the original SQLite connection and its lifetime. All tables
 * are per-call TEMP tables, and no transaction spans an asynchronous source read.
 * Break/return (including the upload's eight-row sample) drops this owned staging.
 */
export async function* readXChangeSourceRows(input, context = {}) {
  if (!object(context) || !context.db || typeof context.db.exec !== 'function' || typeof context.db.prepare !== 'function')
    fail('CATALOG_CONTEXT_REQUIRED', 'Read xChange through the original catalog SQLite workspace.', 500);
  const { db, signal, expectedBytes, expectedSha256, limits } = context;
  abort(signal);
  const namespace = 'catalog_xchange_' + randomUUID().replaceAll('-', '');
  const products = namespace + '_products', headers = namespace + '_headers', savepoint = namespace + '_batch';
  let createdProducts = false, createdHeaders = false, batch = [], batchBytes = 0, complete = null;
  try {
    db.exec('CREATE TEMP TABLE "' + products + '" (ordinal INTEGER PRIMARY KEY, supplier_index INTEGER NOT NULL, product_index INTEGER NOT NULL, record_json TEXT NOT NULL)');
    createdProducts = true;
    db.exec('CREATE TEMP TABLE "' + headers + '" (kind TEXT NOT NULL, source_index INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(kind,source_index))');
    createdHeaders = true;
    const putProduct = db.prepare('INSERT INTO temp."' + products + '" VALUES(?,?,?,?)');
    const putHeader = db.prepare('INSERT INTO temp."' + headers + '" VALUES(?,?,?)');
    const flush = () => {
      if (!batch.length) return;
      abort(signal);
      db.exec('SAVEPOINT "' + savepoint + '"');
      try {
        for (const row of batch) {
          if (row.type === 'product') putProduct.run(row.ordinal, row.supplierIndex, row.productIndex, row.json);
          else putHeader.run(row.type, row.type === 'supplier' ? row.supplierIndex : 0, row.json);
        }
        db.exec('RELEASE SAVEPOINT "' + savepoint + '"');
      } catch (error) {
        try { db.exec('ROLLBACK TO SAVEPOINT "' + savepoint + '"'); }
        finally { db.exec('RELEASE SAVEPOINT "' + savepoint + '"'); }
        throw error;
      }
      batch = []; batchBytes = 0;
    };
    for await (const event of readXChange(input, { signal, expectedBytes, expectedSha256, limits })) {
      abort(signal);
      if (complete) fail('EVENT_ORDER_INVALID', 'The original source emitted data after its complete receipt.', 500);
      if (!['product', 'supplier', 'complete'].includes(event.type)) fail('EVENT_INVALID', 'Unknown original xChange event.', 500);
      const encoded = json(event);
      batch.push({ type: event.type, ordinal: event.ordinal, supplierIndex: event.supplierIndex,
        productIndex: event.productIndex, json: encoded });
      batchBytes += Buffer.byteLength(encoded);
      if (event.type === 'complete') complete = event;
      if (batch.length >= 1000 || batchBytes >= 2 * 1024 * 1024) flush();
    }
    flush();
    if (!complete) fail('EOF_REQUIRED', 'The original xChange source did not return a complete verified receipt.');
    const productCount = db.prepare('SELECT COUNT(*) AS n FROM temp."' + products + '"').get().n;
    const supplierCount = db.prepare('SELECT COUNT(*) AS n FROM temp."' + headers + '" WHERE kind=?').get('supplier').n;
    if (productCount !== complete.productCount || supplierCount !== complete.supplierCount)
      fail('STAGE_CHANGED', 'The staged original product/header counts differ from the verified source.', 409);
    const orphan = db.prepare('SELECT p.ordinal FROM temp."' + products + '" p LEFT JOIN temp."' + headers +
      '" h ON h.kind=? AND h.source_index=p.supplier_index WHERE h.source_index IS NULL LIMIT 1').get('supplier');
    if (orphan) fail('HEADER_REQUIRED', 'An original product has no completed supplier header.', 409);
    const catalogueRow = db.prepare('SELECT record_json FROM temp."' + headers + '" WHERE kind=? AND source_index=0').get('complete');
    if (!catalogueRow) fail('EOF_REQUIRED', 'The staged source has no complete original catalogue receipt.', 409);
    const catalogue = freeze(JSON.parse(catalogueRow.record_json));
    const supplierQuery = db.prepare('SELECT record_json FROM temp."' + headers + '" WHERE kind=? AND source_index=?');
    const rows = db.prepare('SELECT ordinal,supplier_index,record_json FROM temp."' + products + '" ORDER BY ordinal').iterate();
    let supplier = null, supplierIndex = null;
    for (const row of rows) {
      abort(signal);
      if (supplierIndex !== row.supplier_index) {
        const selected = supplierQuery.get('supplier', row.supplier_index);
        if (!selected) fail('HEADER_REQUIRED', 'The completed original supplier header is absent.', 409);
        supplier = freeze(JSON.parse(selected.record_json)); supplierIndex = row.supplier_index;
      }
      yield joinedRow(JSON.parse(row.record_json), supplier, catalogue);
    }
  } finally {
    batch = [];
    let error = null;
    if (createdProducts) try { db.exec('DROP TABLE temp."' + products + '"'); } catch (failure) { error = failure; }
    if (createdHeaders) try { db.exec('DROP TABLE temp."' + headers + '"'); } catch (failure) { error ??= failure; }
    if (error) throw error;
  }
}
