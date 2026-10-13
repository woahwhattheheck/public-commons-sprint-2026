// MIT. Explicit original files shared by managed launch and distribution selection.
export const MANAGED_SOURCE_SCHEMA = 'stellar-forge.managed-source-manifest.v1';
export const MAX_MANAGED_SOURCE_BYTES = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => {
  if (!condition) throw Object.assign(new TypeError(message), {code:'MANAGED_SOURCE_MANIFEST_INVALID'});
};
function repositoryPath(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'),
  'Select an explicit repository source path.');
  return value;
}
function resolveName(basePath, name) {
  need(typeof name === 'string' && name.length > 0 && name.length <= 1024 &&
    /^[A-Za-z0-9._/-]+$/.test(name), 'Select an explicit managed source filename.');
  const parts = name.split('/'), root = basePath.split('/');
  let fileStarted = false;
  for (const part of parts) {
    need(part && part !== '.', 'Managed source paths must be normalized.');
    if (part === '..') {
      need(!fileStarted && root.length > 0, 'Managed source leaves its selected repository.');
      root.pop();
    } else { fileStarted = true; root.push(part); }
  }
  need(fileStarted, 'A managed source must name a file.');
  return repositoryPath(root.join('/'));
}
/** Pure validation; callers read the exact bytes from their own selected source. */
export function validateManagedSourceManifest(value, manifestPath) {
  repositoryPath(manifestPath);
  need(plain(value) && value.schema === MANAGED_SOURCE_SCHEMA &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every(key => ['schema', 'basePath', 'files'].includes(key)),
  'Unsupported managed source manifest.');
  const basePath = repositoryPath(value.basePath);
  need(manifestPath.slice(0, manifestPath.lastIndexOf('/')) === basePath,
    'The managed source manifest must reside beside its original source.');
  need(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 4096,
    'Select a bounded complete managed source inventory.');
  const seen = new Set(), paths = new Set(), entries = [];
  for (const name of value.files) {
    const path = resolveName(basePath, name);
    need(!seen.has(name) && !paths.has(path), 'Duplicate managed source: ' + name);
    seen.add(name); paths.add(path); entries.push({name, path});
  }
  need(paths.has(manifestPath), 'The managed source inventory must retain its own manifest.');
  return {schema:MANAGED_SOURCE_SCHEMA, basePath, files:[...value.files], entries};
}
