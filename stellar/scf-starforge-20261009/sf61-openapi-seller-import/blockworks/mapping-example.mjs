// Runnable API design example; these records demonstrate wiring only.
// Run: node mapping-example.mjs. Real work uses retained acquisition/import bytes.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { reviewMapping, compareMappedResults } from './mapping.mjs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const at = '2026-10-11T21:30:00Z';
const legacyDocument = {
  data: { assetID: 'design-legacy-asset-a', points: [[1791676800000, 42], [1791763200000, null]] },
  metadata: { pointSchemas: [
    { name: 'Timestamp', slug: 'time', is_timestamp: true },
    { name: 'Closing price', slug: 'close', is_timestamp: false }
  ] }
};
const providerDocument = {
  error: null,
  data: {
    key: 'design-provider-asset-a', entity: { name: 'Design asset A', symbol: 'DEMO' },
    point_schema: [{ field: 'time', time: true, type: 'timestamp' }, { field: 'price', type: 'number', unit: 'usd' }],
    points: [[1791676800, 42], [1791763200, null]]
  },
  metadata: {}
};
export function exampleInputs() {
  const legacyBody = Buffer.from(JSON.stringify(legacyDocument));
  const providerBody = Buffer.from(JSON.stringify(providerDocument));
  const legacyCoverage = { kind: 'declared-export', complete: true, declaredBy: 'Design reviewer',
    declaredAt: at, reference: 'design-only:complete-export', note: 'Two original points in this design example.',
    window: { start: 1791676800, end: 1791849600 } };
  const legacyCapture = { id: 'design-legacy-file', status: null, headers: {}, capturedAt: null,
    bytes: legacyBody.length, sha256: sha256(legacyBody), accepted: true,
    provenance: { kind: 'file', name: 'design-legacy-response.json', importedAt: at } };
  const providerCapture = { id: 'design-provider-response', request: { method: 'GET',
    url: 'https://api.blockworks.com/query/timeseries/asset-price/1d/design-provider-asset-a?start=1791676800&end=1791849600' },
    status: 200, headers: { 'content-type': 'application/json' }, capturedAt: at,
    bytes: providerBody.length, sha256: sha256(providerBody), accepted: true };
  const providerCoverage = { complete: true, receivedRows: 2, seriesKeys: ['design-provider-asset-a'] };
  return {
    mapping: {
      schemaVersion: 'blockworks-mapping/v1', id: 'design-price-migration', family: 'assets',
      keys: [
        { id: 'asset', semantic: 'identity', baseline: { from: 'row', path: ['key'] },
          candidate: { from: 'row', path: ['key'] },
          aliases: [{ baseline: 'design-legacy-asset-a', candidate: 'design-provider-asset-a',
            canonical: 'design-customer-asset-a', decisionId: 'design-identity' }] },
        { id: 'observation-time', semantic: 'time',
          baseline: { from: 'point', path: ['time'], descriptorKey: 'slug', timeFormat: 'unix-ms' },
          candidate: { from: 'point', path: ['time'], descriptorKey: 'field', timeFormat: 'unix-s' } }
      ],
      measures: [
        { id: 'price', interpretation: 'numeric',
          baseline: { from: 'point', path: ['close'], descriptorKey: 'slug', unit: 'usd', dimensions: { basis: 'close' } },
          candidate: { from: 'point', path: ['price'], descriptorKey: 'field', unit: 'usd', dimensions: { basis: 'close' } },
          conversion: { factor: '1', offset: '0' }, tolerance: { absolute: '0', relative: '0' } }
      ],
      window: { timeKey: 'observation-time', start: 1791676800, end: 1791849600 },
      decisions: [{ id: 'design-identity', decision: 'approved', kind: 'identity', by: 'Design reviewer',
        at, reference: 'design-only:customer-identity-review', note: 'Explicit alias for this API design example.' }]
    },
    sources: {
      baseline: {
        manifest: { schema: 'customer-legacy-import/v1', id: 'design-legacy-file',
          request: { kind: 'legacy-import', format: 'json',
            projection: { schemaVersion: 'blockworks-legacy-projection/v1', format: 'json', kind: 'timeseries',
              pointsPointer: '/data/points', pointSchemaPointer: '/metadata/pointSchemas', descriptorKey: 'slug',
              seriesKey: 'design-legacy-asset-a', metadataPointer: '/metadata' } },
          coverage: legacyCoverage, captures: [legacyCapture] },
        result: { kind: 'timeseries', rows: [],
          series: [{ key: legacyDocument.data.assetID, points: legacyDocument.data.points }],
          pointSchema: legacyDocument.metadata.pointSchemas, metadata: legacyDocument.metadata,
          coverage: legacyCoverage, complete: true },
        captures: [{ body: legacyBody, metadata: legacyCapture }]
      },
      candidate: {
        manifest: { id: 'design-native-run', state: 'complete',
          request: { kind: 'timeseries', model: 'asset-price', paged: false,
            path: '/query/timeseries/asset-price/1d/design-provider-asset-a',
            pathParameters: { granularity: '1d', assetID: 'design-provider-asset-a' },
            query: { start: 1791676800, end: 1791849600 },
            window: { start: 1791676800, end: 1791849600 } },
          coverage: providerCoverage, captures: [providerCapture] },
        result: { kind: 'timeseries', rows: [], series: [providerDocument.data],
          pointSchema: providerDocument.data.point_schema, metadata: {},
          coverage: providerCoverage, complete: true },
        captures: [{ body: providerBody, metadata: providerCapture }]
      }
    }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = exampleInputs();
  const review = reviewMapping(input);
  const comparison = compareMappedResults({ ...input, reviewId: review.reviewId });
  process.stdout.write(JSON.stringify({ designOnly: true, review, comparison }, null, 2) + '\n');
}
