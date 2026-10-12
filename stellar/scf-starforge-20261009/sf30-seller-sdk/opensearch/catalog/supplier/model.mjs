// MIT. Explicit supplier projections and durable submission record shapes.
import { WorkspaceError, clone, canonical, digest } from '../../workspace/store.mjs';
import { reconcileXChangeCorrectionNumbers } from './xchange/corrections.mjs';

export const PLAN_SCHEMA = 'stellar-forge.supplier-submission.v1';
export const CORRECTION_SCHEMA = 'stellar-forge.supplier-correction.v1';
export const REVIEW_SCHEMA = 'stellar-forge.supplier-review.v1';
export const ROW_SCHEMA = 'stellar-forge.supplier-review-row.v1';
export const SUPPLIER_TABLES = {
  catalog_supplier_plans: ['id','catalog_id','revision','record_json'],
  catalog_supplier_plan_history: ['plan_id','revision','record_json'],
  catalog_supplier_corrections: ['id','plan_id','material_key','revision','record_json'],
  catalog_supplier_correction_history: ['correction_id','revision','record_json'],
  catalog_supplier_reviews: ['id','plan_id','created_at','record_json'],
  catalog_supplier_products: ['review_id','material_key','supplier_id','errors','warnings','record_json'],
  catalog_supplier_recipient: ['review_id','kind','record_key','supplier_key','identifier','action','record_json']
};
export const SUPPLIER_KEYS = {
  catalog_supplier_plans: ['id'], catalog_supplier_plan_history: ['plan_id','revision'],
  catalog_supplier_corrections: ['id'], catalog_supplier_correction_history: ['correction_id','revision'],
  catalog_supplier_reviews: ['id'], catalog_supplier_products: ['review_id','material_key'],
  catalog_supplier_recipient: ['review_id','kind','record_key']
};
export const SUPPLIER_MUTABLE = new Set(['catalog_supplier_plans','catalog_supplier_corrections']);
export const SUPPLIER_MERGE_ORDER = [
  'catalog_supplier_plan_history','catalog_supplier_correction_history',
  'catalog_supplier_reviews','catalog_supplier_products','catalog_supplier_recipient','catalog_supplier_corrections','catalog_supplier_plans'
];
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fail(code, message, status = 422) { throw new WorkspaceError(code, message, status); }
export function text(value, label, limit = 512) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > limit)
    fail('SUPPLIER_TEXT_INVALID', label + ' must be nonempty text, at most ' + limit + ' characters.');
  return value;
}
export function revision(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1000000)
    fail('SUPPLIER_REVISION_REQUIRED', 'Reopen the saved submission or correction before changing it.', 409);
  return value;
}
export function exactKeys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    fail('SUPPLIER_FIELDS_INVALID', label + ' has an unsupported field.');
}
export function seal(value) { return { ...value, sha256: digest(value) }; }
export function verifySealed(value, schema) {
  if (!object(value) || value.schema !== schema || !/^[a-f0-9]{64}$/.test(value.sha256 ?? ''))
    fail('SUPPLIER_RECORD_INVALID', 'A supplier record has an unsupported shape.');
  const { sha256, ...record } = value;
  if (digest(record) !== sha256) fail('SUPPLIER_RECORD_CHANGED', 'The supplier record differs from its saved content.', 409);
  return value;
}
export function pointer(value) {
  text(value, 'JSON pointer', 2048);
  if (!value.startsWith('/') || /~(?:[^01]|$)/.test(value))
    fail('SUPPLIER_POINTER_INVALID', 'Use a JSON pointer beginning with / and escaped ~0 or ~1.');
  const parts = value.slice(1).split('/').map(part => part.replaceAll('~1','/').replaceAll('~0','~'));
  if (parts.length > 16 || parts.some(part => !part.length || ['__proto__','prototype','constructor'].includes(part)))
    fail('SUPPLIER_POINTER_INVALID', 'Use a product field path with at most sixteen named levels.');
  return parts;
}
export function atPointer(value, path) {
  let current = value;
  for (const part of pointer(path)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}
function arrayIndex(part, length, append) {
  if (!/^(?:0|[1-9]\d{0,4})$/.test(part)) fail('SUPPLIER_ARRAY_PATH_INVALID', 'Select an existing array index or append the next item.');
  const selected = Number(part);
  if (selected > length || selected === length && !append)
    fail('SUPPLIER_ARRAY_PATH_INVALID', 'Sparse arrays are not supported. Replace the complete array to reorder it.');
  return selected;
}
export function putPointer(root, path, value) {
  const parts = pointer(path);
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i], key = Array.isArray(current) ? arrayIndex(part, current.length, true) : part;
    if (!object(current) && !Array.isArray(current))
      fail('SUPPLIER_POINTER_CONFLICT', 'A product field path overlaps a scalar value.');
    if (!Object.hasOwn(current, key) || current[key] === null)
      current[key] = /^(?:0|[1-9]\d{0,4})$/.test(parts[i + 1]) ? [] : {};
    if (!object(current[key]) && !Array.isArray(current[key]))
      fail('SUPPLIER_POINTER_CONFLICT', 'A product field path overlaps a scalar value.');
    current = current[key];
  }
  const final = parts.at(-1), key = Array.isArray(current) ? arrayIndex(final, current.length, true) : final;
  current[key] = clone(value);
}
function disjoint(paths) {
  const parsed = paths.map(path => ({ path, parts: pointer(path) }));
  for (let i = 0; i < parsed.length; i++) for (let j = i + 1; j < parsed.length; j++) {
    const a = parsed[i].parts, b = parsed[j].parts, count = Math.min(a.length,b.length);
    if (a.slice(0,count).every((part,index) => part === b[index]))
      fail('SUPPLIER_POINTER_OVERLAP', 'Choose either a whole object/array or its individual fields: ' + parsed[i].path + ' overlaps ' + parsed[j].path + '.');
  }
}
function data(value) {
  if (value === undefined) return null;
  let size;
  try { canonical(value); size = new TextEncoder().encode(JSON.stringify(value)).length; }
  catch { fail('SUPPLIER_VALUE_INVALID', 'Supplier values must be finite JSON data.'); }
  if (size > 2 * 1024 * 1024) fail('SUPPLIER_VALUE_TOO_LARGE', 'A supplier value exceeds the material record limit of 2 MiB.');
  return clone(value);
}
export function normalizeBindings(value) {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).length > 512)
    fail('SUPPLIER_BINDINGS_REQUIRED', 'Map between one and 512 explicit supplier fields.');
  disjoint(Object.keys(value));
  const result = {};
  // Numeric path components are compared numerically so explicitly mapped arrays
  // remain contiguous when binding keys arrive in a different JSON object order.
  const order = (a,b) => {
    const x=pointer(a),y=pointer(b);
    for(let i=0;i<Math.min(x.length,y.length);i++) if(x[i]!==y[i]) {
      if(/^\d+$/.test(x[i]) && /^\d+$/.test(y[i])) return Number(x[i])-Number(y[i]);
      return x[i]<y[i]?-1:1;
    }
    return x.length-y.length;
  };
  for (const path of Object.keys(value).sort(order)) {
    const selected = value[path];
    if (typeof selected === 'string') { pointer(selected); result[path] = selected; }
    else {
      exactKeys(selected, ['constant','reason'], 'Declared supplier constant');
      if (!Object.hasOwn(selected,'constant')) fail('SUPPLIER_CONSTANT_REQUIRED', 'Supply the actual constant value and its reason.');
      result[path] = { constant: data(selected.constant), reason: text(selected.reason, 'Reason for the declared value', 2000) };
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 262144)
    fail('SUPPLIER_BINDINGS_TOO_LARGE', 'The complete supplier mapping exceeds 256 KiB.');
  return result;
}
export function projectSupplier(material, bindings) {
  const product = {};
  for (const [path, selected] of Object.entries(bindings))
    putPointer(product, path, typeof selected === 'string' ? data(atPointer(material, selected)) : selected.constant);
  data(product);
  return product;
}
export function normalizePatches(value) {
  if (!Array.isArray(value) || value.length > 512)
    fail('SUPPLIER_PATCHES_INVALID', 'Use an array of up to 512 reasoned field corrections.');
  disjoint(value.map(item => item?.path));
  const patches = value.map(item => {
    exactKeys(item, ['path','value','reason'], 'Supplier correction');
    pointer(item.path);
    if (!Object.hasOwn(item,'value')) fail('SUPPLIER_PATCH_VALUE_REQUIRED', 'Supply a replacement value; null explicitly clears a field.');
    return { path: item.path, value: data(item.value), reason: text(item.reason, 'Reason for this correction', 2000) };
  });
  if (new TextEncoder().encode(JSON.stringify(patches)).length > 1048576)
    fail('SUPPLIER_PATCHES_TOO_LARGE', 'The complete correction exceeds 1 MiB.');
  return patches;
}
export function applyCorrections(base, patches) {
  const result = clone(base);
  for (const patch of patches) putPointer(result, patch.path, patch.value);
  reconcileXChangeCorrectionNumbers(base,result,patches);
  data(result);
  return result;
}
export function correctionFor(planId, materialKey) { return digest([planId,materialKey]); }
export function supplierId(product) { return typeof product?.supplierProductId === 'string' && !product.supplierProductId.includes('\0') ? product.supplierProductId : ''; }
export function rowCounts(findings) {
  if(!Array.isArray(findings)||findings.some(item=>!object(item)||!['error','warning','info'].includes(item.severity)||
    typeof item.code!=='string'||typeof item.path!=='string'||typeof item.message!=='string'))
    fail('SUPPLIER_FINDINGS_INVALID','A supplier review must contain the original structured findings.');
  return { errors: findings.filter(item => item.severity === 'error').length,
    warnings: findings.filter(item => item.severity === 'warning').length };
}
export function setupSupplierTables(db) {
  for (const [table, columns] of Object.entries(SUPPLIER_TABLES)) {
    const definition = columns.map(name => name + (['revision','errors','warnings'].includes(name) ? ' INTEGER NOT NULL' : ' TEXT NOT NULL')).join(',');
    db.exec('CREATE TABLE IF NOT EXISTS ' + table + '(' + definition + ',PRIMARY KEY(' + SUPPLIER_KEYS[table].join(',') + '));');
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS catalog_supplier_plan_catalog ON catalog_supplier_plans(catalog_id,id);' +
    'CREATE UNIQUE INDEX IF NOT EXISTS catalog_supplier_correction_material ON catalog_supplier_corrections(plan_id,material_key);' +
    'CREATE INDEX IF NOT EXISTS catalog_supplier_review_plan ON catalog_supplier_reviews(plan_id,created_at,id);' +
    'CREATE INDEX IF NOT EXISTS catalog_supplier_product_identity ON catalog_supplier_products(review_id,supplier_id);' +
    'CREATE INDEX IF NOT EXISTS catalog_supplier_product_errors ON catalog_supplier_products(review_id,errors,material_key);' +
    'CREATE INDEX IF NOT EXISTS catalog_supplier_recipient_scope ON catalog_supplier_recipient(review_id,supplier_key,kind,action,identifier);'
  );
}
