'use strict';
const {createConnectedModuleHost, commonJsNamespace, ConnectedModuleError} = require('./connected_esm.cjs');

const SOURCE_FAMILY_PATHS = Object.freeze({
  viewer: 'tools/revenue_owner_console_20261010/lead_customer_package_portable.mjs',
  family: 'tools/revenue_owner_console_20261010/native_source_family_core.mjs',
  inline: 'host/connected_inline_payload.mjs',
  archive: 'tools/revenue_owner_console_20261010/lead_customer_archive_core.cjs',
  hashes: 'host/connected_sha256.cjs',
  zip: 'host/connected_zip.cjs',
  gzip: 'host/connected_gzip.cjs'
});

/**
 * Bind the existing complete source-family composer to the shared ESM host.
 * files: original {path,content} source rows, a Map, or a path-to-source object.
 * loadCommonJS({id,source,sources}): the caller's existing CommonJS loader.
 * No customer source, document, archive or runtime capability is fetched here.
 */
async function createSourceFamilyReceiver({files, loadCommonJS, globals = {}} = {}) {
  if (typeof loadCommonJS !== 'function')
    throw new ConnectedModuleError('SOURCE_FAMILY_LOADER', 'Supply the existing original CommonJS loader.');
  const entries = files instanceof Map ? [...files] : Array.isArray(files) ?
    files.map(file => [file.path, file.content]) : Object.entries(files || {});
  const sources = Object.create(null);
  for (const [id, source] of entries) {
    if (typeof id !== 'string' || typeof source !== 'string' || Object.prototype.hasOwnProperty.call(sources, id))
      throw new ConnectedModuleError('SOURCE_FAMILY_SOURCE', 'Retain distinct complete source files.', {id});
    sources[id] = source;
  }
  for (const id of Object.values(SOURCE_FAMILY_PATHS)) if (!Object.prototype.hasOwnProperty.call(sources, id))
    throw new ConnectedModuleError('SOURCE_FAMILY_SOURCE', 'A complete original dependency is missing.', {id});
  Object.freeze(sources);
  const modules = Object.create(null), externals = Object.create(null);
  for (const key of ['viewer', 'family', 'inline']) modules[SOURCE_FAMILY_PATHS[key]] = sources[SOURCE_FAMILY_PATHS[key]];
  const values = Object.create(null);
  // Preserve dependency order and the caller's original loader cache.
  for (const key of ['hashes', 'zip', 'gzip', 'archive']) {
    const id = SOURCE_FAMILY_PATHS[key];
    values[key] = await loadCommonJS({id, source: sources[id], sources});
    externals[id] = commonJsNamespace(values[key]);
  }
  const host = createConnectedModuleHost({modules, externals, globals});
  const viewer = await host.import(SOURCE_FAMILY_PATHS.viewer);
  const family = await host.import(SOURCE_FAMILY_PATHS.family);
  return Object.freeze({
    open(input) { return viewer.selectPortableSourceFamilies(input, {archiveCore: values.archive}); },
    render(input, options = {}) {
      return viewer.renderPortableSourceFamilies(input, {...options,
        zipSource: sources[SOURCE_FAMILY_PATHS.zip], gzipSource: sources[SOURCE_FAMILY_PATHS.gzip],
        archiveSource: sources[SOURCE_FAMILY_PATHS.archive], hashSource: sources[SOURCE_FAMILY_PATHS.hashes]});
    },
    prepareFamily(input) { return family.prepareNativeSourceFamily(input,
      {hashText: values.hashes.sha256Utf8, hashBytes: values.hashes.sha256Bytes}); },
    prepareFamilies(input) { return family.prepareNativeSourceFamilies(input,
      {hashText: values.hashes.sha256Utf8, hashBytes: values.hashes.sha256Bytes}); },
    readFamily(input) { return family.readNativeSourceFamily(input,
      {hashText: values.hashes.sha256Utf8, hashBytes: values.hashes.sha256Bytes}); },
    source(id) { return Object.prototype.hasOwnProperty.call(sources, id) ? sources[id] : null; },
    describe() { return host.describe(); }
  });
}
module.exports = {SOURCE_FAMILY_PATHS, createSourceFamilyReceiver};
