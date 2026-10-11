// MIT. Existing release console ownership of the original discovery setup/writer.
import { lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readReleaseCatalogConfig } from './release-catalog.mjs';
import { reviewReleaseDiscoverySetup, createReleaseDiscoverySetup,
  inspectReleaseDiscoverySetup, openReleaseDiscoverySetup } from './release-discovery-setup.mjs';

const fail = message => { throw Object.assign(new Error(message), { code: 'DISCOVERY_CONSOLE_CONFLICT', status: 409 }); };
const identity = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The host selects a single directory. Browser requests never supply file paths. */
export function createReleaseDiscoveryConsole(root, { directory } = {}) {
  root = resolve(root);
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Supply a discovery setup directory.');
  directory = resolve(directory);
  let owned = null, reviewed = null;
  const status = async () => {
    const view = { enabled: true, directory, managesCatalog: Boolean(owned),
      instanceId: owned?.instanceId ?? null, discoveryOrigin: owned?.session.discoveryOrigin ?? null };
    try {
      try { await lstat(directory); }
      catch (error) {
        if (error.code === 'ENOENT') return { ...view, state: 'NEW' };
        throw error;
      }
      const setup = await inspectReleaseDiscoverySetup(root, { directory });
      return { ...view, state: owned ? 'RUNNING' : 'CONFIGURED', sellerId: setup.sellerId,
        publicKeySha256: setup.publicKeySha256, source: setup.source, permissions: setup.permissions,
        connectionFile: setup.connectionFile, policySha256: setup.policySha256 };
    } catch (error) {
      return { ...view, state: 'UNAVAILABLE', error: { code: error.code ?? 'DISCOVERY_SETUP_ERROR', message: error.message } };
    }
  };
  const review = async input => {
    reviewed = null;
    if ((await status()).state !== 'NEW') fail('This destination already contains a setup. Reopen its existing identity.');
    const value = { directory, ...await reviewReleaseDiscoverySetup(root, input) };
    reviewed = { id: identity(value), ...value };
    return structuredClone(reviewed);
  };
  const create = async ({ reviewId } = {}) => {
    if (!reviewed || reviewed.id !== reviewId) fail('Review the current release enrollment in this console first.');
    const accepted = reviewed; reviewed = null;
    const input = { releaseId: accepted.source.releaseId, sellerId: accepted.sellerId, sourceURL: accepted.source.sourceURL };
    const current = { directory, ...await reviewReleaseDiscoverySetup(root, input) };
    if (identity(current) !== accepted.id) fail('The retained release enrollment changed. Review it again.');
    await createReleaseDiscoverySetup(root, { directory, ...input });
    return status();
  };
  const start = async () => {
    if (owned) fail('This console already owns the discovery service.');
    const setup = await inspectReleaseDiscoverySetup(root, { directory });
    const config = await readReleaseCatalogConfig(setup.connectionFile);
    // Existing catalog publication stays in this console; no second browser or token.
    const session = await openReleaseDiscoverySetup(root, { directory, workspace: false, port: 0 });
    const instance = { session, config, instanceId: randomUUID() }; owned = instance;
    session.closed.then(() => { if (owned === instance) owned = null; });
    return status();
  };
  const closeOwned = async () => {
    const instance = owned;
    if (instance) {
      try { await instance.session.close(); }
      finally { if (owned === instance) owned = null; }
    }
  };
  const stop = async ({ instanceId } = {}) => {
    if (!owned || instanceId !== owned.instanceId) fail('This console does not own that discovery instance. Refresh.');
    await closeOwned();
    return status();
  };
  const enrollment = async () => (await inspectReleaseDiscoverySetup(root, { directory, includeEnrollment: true })).enrollment;
  return { status, review, create, start, stop, enrollment, close: closeOwned,
    get catalogConfig() { return owned?.config; } };
}
