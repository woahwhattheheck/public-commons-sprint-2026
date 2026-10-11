// MIT. Stream a reviewed native aggregation through the original source lifetime.
import { BSON } from 'mongodb';
import { performance } from 'node:perf_hooks';
import { datasetExtractionOptions } from '../../postgres/publisher/stream.mjs';
import { canonicalEjson, bsonType } from '../values.mjs';

export class MongoDatasetError extends Error {
  constructor(code) { super(code); this.name = 'MongoDatasetError'; this.code = code; }
}
const fail = code => new MongoDatasetError(code);

export function mongoDatasetExtractionOptions(query, supplied = {}) {
  try {
    const options = datasetExtractionOptions(query, supplied);
    // Each reviewed key uses its value plus an explicit null-last key.
    if (options.order.length > 16) throw fail('DATASET_EXTRACTION_ORDER_MAXIMUM_16');
    return options;
  }
  catch (issue) { throw fail(issue.code ?? 'DATASET_EXTRACTION_OPTIONS_INVALID'); }
}

export function mongoDatasetPipeline(query, options) {
  const occupied = new Set(query.columns);
  function internal(name) { while (occupied.has(name)) name += '_'; occupied.add(name); return name; }
  const oversize = internal('__sf30_export_oversized');
  const projection = Object.fromEntries(query.columns.map(name => [name, 1]));
  if (!query.columns.includes('_id')) projection._id = 0;
  const nullFlags = {}, sorting = {}, removed = {};
  for (const item of options.order) {
    const flag = internal('__sf30_export_null_' + item.column);
    nullFlags[flag] = { $in: [{ $type: '$' + item.column }, ['missing', 'null']] };
    sorting[flag] = 1; sorting[item.column] = item.direction === 'asc' ? 1 : -1; removed[flag] = 0;
  }
  // Authored stages, including any authored limit, stay byte-bound in the plan.
  // The outer limit is the extraction budget, not the live report's page limit.
  // Suppress oversized projected BSON documents on the server before delivery.
  const pipeline = [...BSON.EJSON.deserialize(query.pipeline, { relaxed: false }), { $project: projection },
    { $set: nullFlags }, { $sort: sorting }, { $limit: options.maxRows + 1 }, { $project: removed },
    { $replaceWith: { $cond: [{ $lte: [{ $bsonSize: '$$ROOT' }, options.maxRowBytes] },
      '$$ROOT', { $literal: { [oversize]: true } }] } }];
  return { pipeline, oversize };
}

/** A single original client session and cursor, with awaited consumer writes.
 * Completion requires exhausting the reviewed aggregation inside every budget.
 * MongoDB's declared read concern is retained without inventing a transaction. */
export async function readMongoDataset(database, client, query, { name, values, signal, deadline, options, onRow }) {
  const session = client.startSession({ snapshot: query.readConcern === 'snapshot', causalConsistency: false });
  const { pipeline, oversize } = mongoDatasetPipeline(query, options);
  const columnTypes = Object.fromEntries(query.columns.map(column => [column, {}]));
  const startedAt = new Date().toISOString();
  let cursor, rowCount = 0, sourceTextBytes = 0, sourceBsonBytes = 0;
  const read = { concern: query.readConcern, preference: 'primary', session: 'one-extraction',
    consistency: query.readConcern === 'snapshot' ? 'one-majority-committed-point-in-time' :
      query.readConcern === 'majority' ? 'majority-committed-read-without-point-in-time-guarantee' :
        'local-read-without-majority-or-point-in-time-guarantee' };
  try {
    signal.throwIfAborted();
    cursor = database.collection(query.collection).aggregate(pipeline, {
      session, let: values, readConcern: { level: query.readConcern }, readPreference: 'primary',
      maxTimeMS: Math.max(1, Math.floor(deadline - performance.now())), signal,
      batchSize: Math.min(8, options.maxRows + 1), allowDiskUse: false,
      promoteValues: false, promoteLongs: false, bsonRegExp: true,
      comment: 'stellar-forge:dataset:' + name,
    });
    for await (const document of cursor) {
      signal.throwIfAborted();
      if (rowCount >= options.maxRows) throw fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
      if (Object.hasOwn(document, oversize)) throw fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
      const bsonBytes = BSON.calculateObjectSize(document);
      const textBytes = Buffer.byteLength(JSON.stringify(canonicalEjson(document)));
      if (bsonBytes > options.maxRowBytes || textBytes > options.maxRowBytes)
        throw fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
      sourceBsonBytes += bsonBytes; sourceTextBytes += textBytes;
      if (sourceTextBytes > options.maxBytes) throw fail('DATASET_EXTRACTION_TOO_MANY_BYTES');
      for (const field of query.columns) {
        const type = Object.hasOwn(document, field) ? bsonType(document[field]) : 'missing';
        columnTypes[field][type] = (columnTypes[field][type] ?? 0) + 1;
      }
      await onRow(document, columnTypes, { rowCount: rowCount + 1, sourceTextBytes, sourceBsonBytes });
      signal.throwIfAborted(); rowCount++;
    }
    if (session.operationTime) read.operationTime = canonicalEjson(session.operationTime);
    if (session.clusterTime?.clusterTime) read.clusterTime = canonicalEjson(session.clusterTime.clusterTime);
    // These public session values are observed server times; neither is relabeled
    // as the snapshot timestamp. The driver owns the snapshot session internally.
    await cursor.close(); cursor = null; signal.throwIfAborted();
    return { schema: 'stellar-forge.mongodb-dataset-extraction.v1', query: name,
      collection: query.collection, referencedCollections: [...query.referencedCollections],
      rowCount, sourceTextBytes, sourceBsonBytes, columns: [...query.columns], columnTypes,
      complete: true, readOnly: true, startedAt, completedAt: new Date().toISOString(), read,
      valueEncoding: 'mongodb-native-bson', csvEncoding: 'reviewed-typed-scalars-and-canonical-ejson-v2',
      nullEncoding: 'csv-empty-only-for-nullable-columns', missingFieldEncoding: 'rejected-for-published-columns',
      order: options.order, ordering: 'mongodb-source-collation-null-and-missing-last', limits: options };
  } finally {
    await cursor?.close().catch(() => {});
    await session.endSession();
  }
}
