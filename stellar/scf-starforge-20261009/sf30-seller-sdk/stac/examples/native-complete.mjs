// Complete the same retained live capture; never starts a replacement acquisition.
import { join, resolve } from 'node:path';
import { openStacWorkspace } from '../workspace.mjs';
import { stacItemKey, canonicalJson, sha256 } from '../provider.mjs';
import { readJson, writeJson, writeBytes, need } from '../../../sf88-operator-buyer-cli/node/store.mjs';
const root = resolve(process.env.STAC_NATIVE_DIRECTORY ?? './stac-native-operation');
const journalPath = join(root, 'operation.json'), journal = await readJson(journalPath);
need(journal.editionId && journal.assetReviewId, 'STAC_NATIVE_REVIEWED_CAPTURE_REQUIRED');
const origins = [...new Set(['https://earth-search.aws.element84.com', new URL(journal.assetReview.href).origin])];
const transport = process.env.HTTPS_PROXY ? origins.map(origin => ({ mode: 'explicit-connect', origin, proxyEnv: 'HTTPS_PROXY' })) : undefined;
const workspace = await openStacWorkspace({ directory: join(root, 'workspace'), create: false, transport });
async function checkpoint(stage, update = {}) { Object.assign(journal, update, { stage, updatedAt: new Date().toISOString() }); await writeJson(journalPath, journal); console.log(JSON.stringify({ stage, ...update })); }
try {
  const asset = await workspace.acquireAsset({ reviewId: journal.assetReviewId, operationId: 'b710-austin-preview-1' });
  await checkpoint('PUBLIC_ASSET_ACQUIRED', { assetId: asset.id, asset: { href: asset.href, mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256 } });
  const original = await workspace.getEdition(journal.editionId);
  const remaining = original.items.filter(item => stacItemKey(item) !== asset.itemId);
  for (const [index, item] of remaining.slice(0, 2).entries()) {
    await workspace.setDecision({ editionId: journal.editionId, itemId: stacItemKey(item), status: index ? 'REJECTED' : 'REVIEW',
      actor: 'Reidgardas', note: index ? 'Outside the selected single-scene preview handover; original scene remains available.' :
        'Retained candidate for the customer to review against the selected acquisition.', assetKeys: [] });
  }
  if (!journal.refreshReviewId) {
    const review = await workspace.reviewSearch({ queryId: journal.queryId });
    await checkpoint('REFRESH_REVIEWED', { refreshReviewId: review.id });
  }
  let refreshed = await workspace.acquire({ reviewId: journal.refreshReviewId, operationId: 'b710-austin-september-edition-2' });
  while (refreshed.status === 'PARTIAL') refreshed = await workspace.resume({ editionId: refreshed.id });
  need(refreshed.status === 'COMPLETE', 'STAC_NATIVE_REFRESH_INCOMPLETE');
  const comparison = await workspace.compare({ leftEditionId: journal.editionId, rightEditionId: refreshed.id });
  await writeJson(join(root, 'comparison.json'), comparison);
  await checkpoint('EDITIONS_COMPARED', { refreshEditionId: refreshed.id, comparison: {
    comparableQuery: comparison.comparableQuery, added: comparison.added.length, removed: comparison.removed.length,
    changed: comparison.changed.length, unchanged: comparison.unchanged.length } });
  for (const format of ['json', 'csv', 'html']) {
    const report = await workspace.exportReport({ editionId: journal.editionId, format });
    await writeBytes(join(root, 'scene-review.' + format), report.bytes);
  }
  const exported = await workspace.exportEdition({ editionId: journal.editionId, directory: join(root, 'edition-1') });
  const repeat = await workspace.exportEdition({ editionId: journal.editionId, directory: join(root, 'edition-1') });
  need(repeat.manifest.digest === exported.manifest.digest, 'STAC_NATIVE_EXPORT_CHANGED');
  const handover = await workspace.exportHandover({ editionIds: [journal.editionId, refreshed.id], includeAssets: true });
  await writeJson(join(root, 'handover.json'), handover);
  let receiver = await openStacWorkspace({ directory: join(root, 'receiver'), title: 'Austin imagery receiving', endpoint: handover.endpoint });
  const receipt = await receiver.importHandover(handover), state = await receiver.getState();
  const replay = await receiver.importHandover(handover);
  need(receipt.id === replay.id && state.revision === (await receiver.getState()).revision, 'STAC_NATIVE_IMPORT_REPLAY_CHANGED');
  await receiver.close();
  receiver = await openStacWorkspace({ directory: join(root, 'receiver'), create: false });
  const received = await receiver.getEdition(journal.editionId), receivedAsset = await receiver.getAsset(asset.id);
  need(sha256(canonicalJson(received.items)) === sha256(canonicalJson(original.items)), 'STAC_NATIVE_RECEIVED_ITEMS_CHANGED');
  need(receivedAsset.metadata.sha256 === asset.sha256 && sha256(receivedAsset.bytes) === asset.sha256, 'STAC_NATIVE_RECEIVED_ASSET_CHANGED');
  const receivedComparison = await receiver.compare({ leftEditionId: journal.editionId, rightEditionId: refreshed.id });
  need(sha256(canonicalJson(comparison)) === sha256(canonicalJson(receivedComparison)), 'STAC_NATIVE_RECEIVED_COMPARISON_CHANGED');
  await receiver.close();
  await checkpoint('COMPLETE', { completedAt: new Date().toISOString(), editionDirectory: exported.directory,
    manifestId: exported.manifest.id, manifestDigest: exported.manifest.digest, declaredFiles: exported.manifest.files.length,
    receivedItems: received.items.length, receivedDecisions: received.decisions.length, receivingWorkspaceId: state.id,
    handoverDigest: handover.digest, receiptId: receipt.id, importReplayRevision: state.revision });
  await writeJson(join(root, 'complete-result.json'), journal);
} catch (error) {
  await checkpoint('CONTINUATION_FAILED', { error: { code: error.code ?? 'STAC_NATIVE_CONTINUATION_FAILED', message: String(error.message).slice(0, 500) } });
  process.exitCode = 1;
} finally { await workspace.close(); }
