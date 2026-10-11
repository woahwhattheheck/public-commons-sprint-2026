// MIT. Shared private operator handoff to the original PostgreSQL release adapter.
import { preparePostgresRelease } from './release-postgres.mjs';
import { stageRelease, inspectRelease } from './releases.mjs';

const fail = (code, message, status = 422) => Object.assign(new Error(message), { code, status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Supply only the declared PostgreSQL release fields.');
}
function runtimeSelection(value = {}) {
  exact(value, ['port', 'facilitator', 'allowLocalFacilitator']);
  const runtime = { port: value.port ?? 8423 };
  if (!Number.isInteger(runtime.port) || runtime.port < 0 || runtime.port > 65535)
    throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Seller port must be an integer from 0 to 65535.');
  if (value.allowLocalFacilitator !== undefined && typeof value.allowLocalFacilitator !== 'boolean')
    throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Local facilitator selection must be a boolean.');
  if (value.facilitator !== undefined) {
    let url;
    try { url = new URL(value.facilitator); } catch { throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Enter a complete facilitator URL.'); }
    const local = value.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Use a credential-free HTTPS facilitator URL, or explicitly enabled loopback HTTP.');
    runtime.facilitator = url.href.replace(/\/$/, '');
  }
  if (value.allowLocalFacilitator) {
    if (!runtime.facilitator) throw fail('POSTGRES_STAGE_INPUT_INVALID', 'A local facilitator selection requires its URL.');
    runtime.allowLocalFacilitator = true;
  }
  return runtime;
}

/** No SQL, connection address, database name, user name or secret values leave this view. */
export function postgresPreparationView(prepared) {
  const { postgres, service } = prepared;
  return { schema: 'stellar-forge.postgres-release-review.v1', sourceKind: 'POSTGRES_MERCHANT_PACKAGE',
    publicOrigin: service.publicOrigin, postgresPackage: prepared.directory, postgres,
    routes: service.routes.map(route => ({ id: route.id, path: route.path,
      method: route.offer.extensions.bazaar.info.input.method,
      resource: route.offer.resource, payment: route.offer.accepts })) };
}

export async function reviewPostgresSelection(input) {
  exact(input, ['postgresPackage']);
  if (typeof input.postgresPackage !== 'string' || !input.postgresPackage || input.postgresPackage.includes('\0'))
    throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Choose the prepared PostgreSQL package directory.');
  return postgresPreparationView(await preparePostgresRelease(input.postgresPackage));
}

/** An immutable release ID is the durable recovery key, including after a lost response. */
export async function stageReviewedPostgresRelease(root, input, { beforeCapture } = {}) {
  exact(input, ['id', 'label', 'postgresPackage', 'runtime', 'expectedInputManifestSha256']);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.id ?? ''))
    throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Release ID must use 1–64 lowercase letters, digits, underscores or hyphens.');
  const label = input.label ?? input.id;
  if (typeof label !== 'string' || !label.trim() || label.length > 240 || /[\x00-\x1f\x7f]/.test(label))
    throw fail('POSTGRES_STAGE_INPUT_INVALID', 'Use a nonempty, single-line release label up to 240 characters.');
  if (!/^[a-f0-9]{64}$/.test(input.expectedInputManifestSha256 ?? ''))
    throw fail('POSTGRES_PACKAGE_REVIEW_REQUIRED', 'Review this exact package before staging it.', 409);
  const runtime = runtimeSelection(input.runtime);
  const matches = release => release.postgres?.inputManifestSha256 === input.expectedInputManifestSha256 &&
    release.label === label.trim() &&
    release.runtime.port === runtime.port && release.runtime.facilitator === runtime.facilitator &&
    Boolean(release.runtime.allowLocalFacilitator) === Boolean(runtime.allowLocalFacilitator) &&
    !release.runtime.handlers && !release.runtime.upstreams && !release.runtime.allowLoopbackUpstream;
  const existing = async () => {
    let release;
    try { release = await inspectRelease(root, input.id); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!matches(release)) throw fail('POSTGRES_RELEASE_ID_CONFLICT',
      'That release ID already retains different source or launch choices. Inspect it or choose a new release ID.', 409);
    return { release, replayed: true };
  };
  const previous = await existing();
  if (previous) return previous;
  await beforeCapture?.();
  const prepared = await reviewPostgresSelection({ postgresPackage: input.postgresPackage });
  if (prepared.postgres.inputManifestSha256 !== input.expectedInputManifestSha256)
    throw fail('POSTGRES_PACKAGE_CHANGED', 'Package files changed after review. Review the current package before staging it.', 409);
  try {
    const release = await stageRelease(root, { id: input.id, label: label.trim(), postgresPackage: input.postgresPackage, runtime,
      postgresInputManifestSha256: input.expectedInputManifestSha256 });
    // A concurrent edit between the adapter's reads remains visible and cannot be selected silently.
    if (!matches(release)) throw fail('POSTGRES_PACKAGE_CHANGED_DURING_STAGE',
      'The package changed while it was being retained. Inspect this staged release; review a new package before selecting it.', 409);
    return { release, replayed: false };
  } catch (error) {
    if (error.code === 'EEXIST') return await existing();
    throw error;
  }
}
