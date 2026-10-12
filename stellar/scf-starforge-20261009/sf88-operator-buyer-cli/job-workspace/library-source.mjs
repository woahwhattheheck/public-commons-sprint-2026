// MIT. Project original buyer receipts into the existing resource-library verifier.
import { openJobBuyer } from '../../sf30-seller-sdk/jobs/buyer.mjs';
import { digest, jsonBytes } from '../node/store.mjs';
import { readCatalog, buyerId, resourceId, delivered, failure, requireValue } from './state.mjs';

export async function readJobLibrarySource(config) {
  const { catalog, bytes } = await readCatalog(config.source);
  const resources = [], rejected = [], sources = [];
  let withoutFile = 0;
  for (const entry of catalog.entries) {
    try {
      const buyer = await openJobBuyer({ directory: entry.directory });
      const receipt = await buyer.receipt();
      requireValue(buyerId(receipt) === entry.id, 'JOB_WORKSPACE_IDENTITY_CHANGED', 409);
      sources.push({ id: entry.id, receipt });
      const saved = delivered(receipt);
      if (!saved) { withoutFile++; continue; }
      const accepted = receipt.acceptance;
      resources.push({
        id: resourceId(config.source, entry.id, saved.sha256),
        intentId: null, inboxId: null, configSha256: null,
        createdAt: receipt.retainedAt, queueState: null,
        method: 'GET', url: saved.sourceUrl, name: saved.filename,
        path: saved.path, bytes: saved.bytes, sha256: saved.sha256,
        contentType: saved.contentType, deliveryStatus: 'SAVED',
        buyerStatus: receipt.purchase.status ?? null, httpStatus: receipt.purchase.httpStatus ?? null,
        paymentTerms: { scheme: null, network: null, asset: null, payTo: null, maxAtomic: null },
        source: { kind: 'paid-jobs', path: config.source }, status: 'UNVERIFIED',
        job: {
          workspaceEntryId: entry.id, jobId: accepted.jobId, functionId: accepted.functionId,
          label: entry.label, inputSha256: accepted.inputSha256,
          acceptanceSha256: receipt.acceptanceSha256, completedRevision: saved.completedRevision,
          nativeSettlement: saved.nativeSettlement, purchaseKind: receipt.purchase.kind,
          statusUrl: accepted.statusUrl, resultUrl: accepted.resultUrl, deliveredAt: saved.deliveredAt,
        },
      });
    } catch (error) { rejected.push({ id: entry.id, code: failure(error) }); }
  }
  // The source fingerprint covers the exact catalog and the public receipts read
  // from each original buyer. Capability files never enter the derived source.
  const projection = jsonBytes({ catalogSha256: digest(bytes), sources, rejected });
  return { resources, details: { sourceSha256: digest(projection), sourceBytes: projection.length,
    jobCount: catalog.entries.length, resourceCount: resources.length, withoutFile, rejected } };
}
