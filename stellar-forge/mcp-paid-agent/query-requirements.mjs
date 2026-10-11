// MIT. Read only the native, direct required-query declaration; not a schema engine.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsupported = () => Object.assign(new Error(
  'Required query names must be a direct list of up to 30 unique, nonempty names of at most 100 characters without control characters.'
), { code: 'INPUT_SCHEMA_UNSUPPORTED' });

export function requiredQueryKeys(bazaarSchema) {
  let query = bazaarSchema;
  for (const key of ['properties', 'input', 'properties', 'queryParams']) {
    if (!record(query) || !Object.hasOwn(query, key)) return [];
    query = query[key];
  }
  if (!record(query) || !Object.hasOwn(query, 'required')) return [];
  const required = query.required;
  if (!Array.isArray(required) || required.length > 30) throw unsupported();
  const keys = [];
  const seen = new Set();
  for (const key of required) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(key) || seen.has(key)) throw unsupported();
    seen.add(key);
    keys.push(key);
  }
  return keys;
}
