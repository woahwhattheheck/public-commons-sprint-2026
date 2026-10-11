// MIT. Joined recovery composes the two original backup implementations.
import { constants } from 'node:fs';
import { copyFile, chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { FeedError, isRecord } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/model.mjs';
import { createSnapshot, restoreSnapshot, fileIdentity } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/snapshots.mjs';
import { readBundle, readJson, bundlePath, openBundleStore, privateWrite } from './plan.mjs';
import { callMercury, mercuryConfiguration } from './native.mjs';

export const RECOVERY_SCHEMA = 'stellar-forge.mercury-feed-recovery.v1';
const INVENTORY = ['bridge.json', 'bridge-secrets.env', 'mercury.zip', 'feed/events.sqlite', 'feed/snapshot.json'];
const shaPattern = /^[a-f0-9]{64}$/;
async function privateCopy(source, target) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new FeedError('REGULAR_RECOVERY_FILE_REQUIRED', 422);
  await copyFile(source, target, constants.COPYFILE_EXCL);
  await chmod(target, 0o600);
}
/** Snapshot source outcomes first, then the destination ledger. Any delivery
 * committed after the source cut is safe to replay against the retained ID.
 * Reversing this order can lose an event already marked delivered by Mercury. */
export async function snapshotMercuryFeedBundle({ directory, destination, python = 'python3' } = {}) {
  if (!directory || !destination) throw new FeedError('BUNDLE_AND_NEW_SNAPSHOT_REQUIRED', 422);
  const bundle = await readBundle(directory), native = await mercuryConfiguration(bundle);
  const target = resolve(destination);
  if (target === bundle.directory || target.startsWith(bundlePath(bundle.directory, bundle.config.stateDirectory) + '/'))
    throw new FeedError('SNAPSHOT_OUTSIDE_ACTIVE_FEED_REQUIRED', 422);
  await mkdir(target, { mode: 0o700 });
  let store;
  try {
    const source = await callMercury({ configPath: native.path, args: ['backup', '--out', resolve(target, 'mercury.zip')], python });
    store = await openBundleStore(bundle);
    const feed = await createSnapshot({ store, directory: resolve(target, 'feed') });
    store.close(); store = null;
    // Retain a fixed top-level descriptor; restored Mercury's config lives in
    // its own original workspace and is selected after native restoration.
    await privateWrite(resolve(target, 'bridge.json'), bundle.config);
    await privateCopy(bundlePath(bundle.directory, bundle.config.bridgeEnvFile), resolve(target, 'bridge-secrets.env'));
    const now = await fileIdentity(resolve(bundle.directory, 'bridge.json'));
    if (now.sha256 !== bundle.descriptorSha256 || now.bytes !== bundle.descriptorBytes)
      throw new FeedError('BRIDGE_CONFIGURATION_CHANGED_DURING_SNAPSHOT', 409);
    const entries = {};
    for (const name of INVENTORY) entries[name] = await fileIdentity(resolve(target, name));
    if (entries['mercury.zip'].sha256 !== source.sha256 || entries['mercury.zip'].bytes !== source.bytes)
      throw new FeedError('MERCURY_BACKUP_IDENTITY_CHANGED', 409);
    const manifest = { schema: RECOVERY_SCHEMA, createdAt: new Date().toISOString(),
      order: ['mercury', 'feed'], storeId: bundle.config.storeId, sourceId: bundle.config.sourceId,
      feedIds: bundle.config.feedIds, scope: bundle.config.scope,
      source: { sha256: source.sha256, bytes: source.bytes },
      feed: { highWatermark: feed.highWatermark, purgedThroughSequence: feed.purgedThroughSequence,
        retainedEvents: feed.retainedEvents, acceptedEvents: feed.acceptedEvents },
      files: entries };
    await privateWrite(resolve(target, 'recovery.json'), manifest);
    return { directory: target, ...manifest };
  } catch (error) {
    store?.close(); await rm(target, { recursive: true, force: true }); throw error;
  }
}
async function checkedRecovery(directory) {
  const source = resolve(directory), manifest = await readJson(resolve(source, 'recovery.json'), 65536);
  if (!isRecord(manifest) || manifest.schema !== RECOVERY_SCHEMA || !isRecord(manifest.files) ||
      JSON.stringify(manifest.order) !== JSON.stringify(['mercury', 'feed']) ||
      Object.keys(manifest.files).sort().join('\n') !== [...INVENTORY].sort().join('\n'))
    throw new FeedError('INVALID_JOINED_RECOVERY', 422);
  for (const name of INVENTORY) {
    const expected = manifest.files[name];
    if (!isRecord(expected) || !shaPattern.test(expected.sha256 ?? '') ||
        !Number.isSafeInteger(expected.bytes) || expected.bytes < 0)
      throw new FeedError('INVALID_RECOVERY_INVENTORY', 422);
    const actual = await fileIdentity(resolve(source, name));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new FeedError('RECOVERY_FILE_CHANGED', 409, { file: name });
  }
  const config = await readJson(resolve(source, 'bridge.json'), 262144);
  const snapshot = await readJson(resolve(source, 'feed/snapshot.json'), 65536);
  if (config.storeId !== manifest.storeId || config.sourceId !== manifest.sourceId ||
      JSON.stringify(config.feedIds) !== JSON.stringify(manifest.feedIds) ||
      JSON.stringify(config.scope) !== JSON.stringify(manifest.scope) ||
      snapshot.storeId !== manifest.storeId || Object.entries(manifest.feed ?? {}).some(([key, value]) => snapshot[key] !== value))
    throw new FeedError('RECOVERY_IDENTITY_MISMATCH', 409);
  return { source, manifest, config };
}
export async function restoreMercuryFeedBundle({ directory, destination, python = 'python3' } = {}) {
  if (!directory || !destination) throw new FeedError('SNAPSHOT_AND_NEW_BUNDLE_REQUIRED', 422);
  const { source, manifest, config } = await checkedRecovery(directory), target = resolve(destination);
  await mkdir(target, { mode: 0o700 });
  let store;
  try {
    // Stage the source archive inside the exclusive destination and recheck it
    // before invoking original native restoration. No provider call is made.
    const stagedArchive = resolve(target, 'source-recovery.zip');
    await privateCopy(resolve(source, 'mercury.zip'), stagedArchive);
    const copied = await fileIdentity(stagedArchive), expected = manifest.files['mercury.zip'];
    if (copied.bytes !== expected.bytes || copied.sha256 !== expected.sha256) throw new FeedError('RECOVERY_FILE_CHANGED', 409);
    const restoredSource = await callMercury({ args: ['restore', '--from', stagedArchive, '--into', resolve(target, 'mercury')], python });
    const restoredFeed = await restoreSnapshot({ directory: resolve(source, 'feed'), destination: resolve(target, 'feed') });
    if (restoredFeed.storeId !== manifest.storeId || restoredSource.archive_sha256 !== expected.sha256 ||
        restoredFeed.sha256 !== manifest.files['feed/events.sqlite'].sha256 || restoredFeed.highWatermark !== manifest.feed.highWatermark)
      throw new FeedError('RESTORED_IDENTITY_MISMATCH', 409);
    const envTarget = resolve(target, 'bridge-secrets.env');
    await privateCopy(resolve(source, 'bridge-secrets.env'), envTarget);
    const envIdentity = await fileIdentity(envTarget), expectedEnv = manifest.files['bridge-secrets.env'];
    if (envIdentity.bytes !== expectedEnv.bytes || envIdentity.sha256 !== expectedEnv.sha256)
      throw new FeedError('RECOVERY_CREDENTIAL_FILE_CHANGED', 409);
    const restored = { ...config, stateDirectory: 'feed', mercuryConfig: 'mercury/config.json', bridgeEnvFile: 'bridge-secrets.env' };
    // Validate binding against the original restored Mercury configuration
    // before publishing the descriptor that makes this a runnable bundle.
    const bundle = { directory: target, config: restored };
    const native = await mercuryConfiguration(bundle);
    if (resolve(native.path) !== resolve(restoredSource.config_path) ||
        relative(target, native.path).startsWith('..')) throw new FeedError('RESTORED_MERCURY_CONFIG_MISMATCH', 409);
    store = await openBundleStore(bundle);
    for (const id of restored.feedIds) store.definition('feed', id);
    store.definition('source', restored.sourceId);
    const plan = store.merchantPlan().plan;
    if (plan) {
      const { prepareWebhookFeedRelease } = await import('../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/merchant.mjs');
      await prepareWebhookFeedRelease({ store, plan, directory: resolve(target, 'seller-release') });
    }
    store.close(); store = null;
    await privateWrite(resolve(target, 'restored.json'), {
      schema: RECOVERY_SCHEMA, restoredAt: new Date().toISOString(), originalSnapshot: manifest,
      nativeConfig: restored.mercuryConfig, sourceArchiveSha256: expected.sha256,
    });
    await rm(stagedArchive);
    await privateWrite(resolve(target, 'bridge.json'), restored);
    return { directory: target, storeId: restored.storeId, sourceId: restored.sourceId, feedIds: restored.feedIds,
      highWatermark: restoredFeed.highWatermark, mercuryConfig: native.path,
      providerCredentialVariables: restoredSource.credential_variables, sourceArchiveSha256: expected.sha256 };
  } catch (error) {
    store?.close(); await rm(target, { recursive: true, force: true }); throw error;
  }
}
