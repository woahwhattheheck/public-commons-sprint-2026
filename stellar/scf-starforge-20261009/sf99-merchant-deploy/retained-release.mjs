// MIT. Bind the original SF82 selection and discovery identity to an SF99 host.
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { readReleaseState, inspectRelease, releaseStatus } from '../sf82-seller-pilot/releases.mjs';
import { inspectReleaseDiscoverySetup } from '../sf82-seller-pilot/release-discovery-setup.mjs';

export const DISCOVERY_PATHS = Object.freeze(['/discovery/resources', '/discovery/search']);
const need = (value, message) => { if (!value) throw new Error(message); };
const inside = (root, file) => file === root || file.startsWith(root + '/');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names, label) => need(object(value) && Object.keys(value).every(key => names.includes(key)),
  'Unknown or invalid ' + label + ' field');

async function directory(value, stateRoot, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !/[\\\x00-\x1f\x7f]/.test(value) && inside(stateRoot, value) && value !== stateRoot,
    label + ' must be a separate descendant of privateRoot');
  const meta = await lstat(value);
  need(meta.isDirectory() && !meta.isSymbolicLink() && await realpath(value) === value && !(meta.mode & 0o077),
    'Use the original private real ' + label + ' directory');
  return meta;
}

/** Read original immutable source; this never imports applications or starts a writer. */
export async function prepareRetainedRelease(raw, { stateRoot, sourceRoot }) {
  fields(raw.release, ['store', 'expectedGeneration'], 'retained release');
  const { store, expectedGeneration } = raw.release;
  await directory(store, stateRoot, 'release store');
  need(Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0,
    'release.expectedGeneration must be the current original release status generation');
  const state = await readReleaseState(store);
  need(state.active && state.generation === expectedGeneration,
    'The active release selection changed; inspect original release status and regenerate the host plan');
  const release = await inspectRelease(store, state.active);
  need((release.runtime.facilitator ? 'native' : 'challenge') === raw.mode,
    'Host mode must match the immutable release runtime');
  need(Number.isInteger(release.runtime.port) && release.runtime.port >= 1024 && release.runtime.port <= 65535,
    'Stage the original release with its actual fixed host port (1024–65535), then activate it');
  need(!release.runtime.allowLocalFacilitator, 'Production retained releases use their original HTTPS facilitator');
  const sourceFiles = [];
  if (release.handlerEntry) {
    need(inside(sourceRoot, release.handlerEntry.path),
      'Retained trusted handlers must belong to the selected immutable source release; stage its host path before deployment');
    sourceFiles.push(release.handlerEntry.path);
  }
  // These native journals name an absolute writable directory inside the frozen
  // binding. The existing API host owns their path-rebasing recovery. Do not
  // silently move an immutable release while leaving it writing previous state.
  need(!release.routes.some(route => route.upstream?.idempotency),
    'Absolute upstream idempotency journals use the original kind:api host and its restored-path workflow');
  const releaseDirectory = join(store, 'releases', release.id);
  const inputPaths = [join(store, 'state.json'), join(releaseDirectory, 'release.json'),
    join(releaseDirectory, 'manifest.json'), join(releaseDirectory, 'offers.json')];
  let discovery = null;
  if (raw.discovery !== undefined) {
    fields(raw.discovery, ['setup'], 'discovery');
    const meta = await directory(raw.discovery.setup, stateRoot, 'discovery setup');
    need(!inside(store, raw.discovery.setup) && !inside(raw.discovery.setup, store),
      'Keep the original discovery setup separate from the release store');
    // Root maintenance inspects the same service-owned files. Actual catalog-run
    // still requires the launching account to own every original private file.
    const setup = await inspectReleaseDiscoverySetup(store, { directory: raw.discovery.setup, ownerUid: meta.uid });
    need(setup.source.publicOrigin === release.publicOrigin,
      'Retained merchant and existing discovery setup must use the same public origin');
    const source = new URL(setup.source.sourceURL);
    let sourceMatchPath;
    try { sourceMatchPath = decodeURIComponent(source.pathname); }
    catch { throw new Error('Discovery offer export has an invalid escaped path'); }
    need(!source.search && !source.hash && !DISCOVERY_PATHS.includes(sourceMatchPath) &&
      !/[\\\x00-\x1f\x7f]/.test(sourceMatchPath),
      'The generated public offer export requires its own exact path without a query or fragment');
    discovery = { directory: setup.directory, catalogDirectory: setup.catalogDirectory,
      connectionFile: setup.connectionFile, policyFile: setup.policyFile,
      enrollmentFile: setup.enrollmentFile, sellerId: setup.sellerId,
      publicKeySha256: setup.publicKeySha256, policySha256: setup.policySha256,
      sourceReleaseId: setup.source.releaseId, sourceURL: setup.source.sourceURL,
      sourcePath: source.pathname, sourceMatchPath, paths: [...DISCOVERY_PATHS] };
    inputPaths.push(...['setup.json', 'connection.json', 'policy.json', 'seller-public.pem', 'seller-enrollment.json']
      .map(file => join(setup.directory, file)));
  }
  const after = await readReleaseState(store);
  need(after.active === release.id && after.generation === expectedGeneration,
    'The release selection changed while preparing this host; refresh original status');
  return { configPath: join(releaseDirectory, 'seller-service.json'), port: release.runtime.port,
    facilitator: release.runtime.facilitator ?? null, inputPaths, sourceFiles, discovery,
    release: { store, id: release.id, digest: release.digest, expectedGeneration,
      source: release.source, publicOrigin: release.publicOrigin } };
}

/** Every service preflight reuses the source owner's complete verifier. */
export async function checkRetainedRelease(p) {
  const prepared = await prepareRetainedRelease({ mode: p.mode,
    release: { store: p.release.store, expectedGeneration: p.release.expectedGeneration },
    ...(p.discovery ? { discovery: { setup: p.discovery.directory } } : {}) }, p);
  need(JSON.stringify(prepared.release) === JSON.stringify(p.release) &&
    JSON.stringify(prepared.discovery) === JSON.stringify(p.discovery),
    'Retained release or discovery identity changed; regenerate the host bundle');
  need(prepared.port === p.sellerPort, 'Retained listener port changed');
  return prepared;
}

export async function retainedRuntimeCheck(p) {
  const status = await releaseStatus(p.release.store), observed = status.runtime.observed;
  return { name: 'original retained process and source', expected: p.release.id,
    actual: observed?.releaseId ?? null, state: status.runtime.state,
    passed: status.runtime.state === 'RUNNING' && observed?.releaseId === p.release.id &&
      observed.releaseDigest === p.release.digest && observed.listener === `http://127.0.0.1:${p.sellerPort}` };
}

/** Rebase only host selections, retaining original release, key and journal bytes. */
export function restoreRetainedSelections(raw, previous, mapped) {
  const result = structuredClone(raw);
  result.release.store = mapped(previous.release.store, 'release.store');
  if (previous.discovery) result.discovery.setup = mapped(previous.discovery.directory, 'discovery.setup');
  return result;
}
