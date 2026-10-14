// MIT. Bind source-owned byte inventories to one unchanged distribution selection.
export const PINNED_SOURCE_SCHEMA = 'stellar-forge.measurement-workspace-source.v1';
export const MAX_PINNED_SOURCE_BYTES = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function fail(message, manifestPath, sourcePath) {
  throw Object.assign(new TypeError(message + ': ' + manifestPath +
    (sourcePath ? ' -> ' + sourcePath : '') +
    '. Select the original coherent source ref, or refresh and commit this inventory with the intended source before building.'),
  {code:'DISTRIBUTION_SOURCE_PIN_MISMATCH', manifestPath, ...(sourcePath ? {sourcePath} : {})});
}
function path(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
/** The producer commit is provenance; later commits may retain these exact members. */
export function validatePinnedSourceManifest(value, manifestPath) {
  const invalid = message => fail(message, manifestPath);
  if (!path(manifestPath) || !plain(value) || value.schema !== PINNED_SOURCE_SCHEMA ||
      Object.keys(value).some(key => !['schema','repository','sourceCommit','description','files'].includes(key)) ||
      typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) ||
      !oid(value.sourceCommit) || typeof value.description !== 'string' || value.description.length > 4096 ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 4096)
    invalid('Invalid pinned source inventory');
  const seen = new Set(), entries = [];
  for (const member of value.files) {
    if (!plain(member) || Object.keys(member).length !== 4 ||
        Object.keys(member).some(key => !['path','gitBlob','bytes','sha256'].includes(key)) ||
        !path(member.path) || member.path === manifestPath || seen.has(member.path) ||
        !oid(member.gitBlob) || !Number.isSafeInteger(member.bytes) || member.bytes < 0 ||
        member.bytes > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(member.sha256 ?? ''))
      invalid('Invalid or duplicate pinned source member');
    seen.add(member.path);
    entries.push({...member});
  }
  return {schema:value.schema, manifestPath, repository:value.repository,
    sourceCommit:value.sourceCommit, entries};
}
/** describe reads the selected source bytes, or an authenticated installed inventory. */
export function validatePinnedSourceFiles(inventory, describe) {
  for (const expected of inventory.entries) {
    const actual = describe(expected.path);
    if (!actual || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 ||
        actual.gitBlob !== expected.gitBlob)
      fail('Pinned source member differs from the selected distribution', inventory.manifestPath, expected.path);
  }
  return inventory.entries.length;
}
