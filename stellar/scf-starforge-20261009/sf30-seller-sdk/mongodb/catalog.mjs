// MIT. Review actual authorized collection metadata and sampled BSON fields.
import { BSON } from 'mongodb';
import { readMongoSourceFile, resolveMongoConnection } from './config.mjs';
import { connectMongoClient, canonicalEjson, bsonType } from './source.mjs';
import { collectionName } from './declaration.mjs';
import { integer, fail } from './common.mjs';

export async function inspectMongoDatabase({ connection, collections, sampleSize = 200 } = {}) {
  integer(sampleSize, 1, 2000, 'MONGODB_SAMPLE_SIZE_INVALID');
  if (collections !== undefined && (!Array.isArray(collections) || !collections.length || collections.length > 64))
    fail('MONGODB_CATALOG_SELECT_1_TO_64_COLLECTIONS');
  if (collections) collections.forEach(collectionName);
  const { client, database, metadata } = await connectMongoClient(connection, { maxConnections: 1 });
  const output = { schema: 'stellar-forge.mongodb-catalog.v1', capturedAt: new Date().toISOString(),
    database: connection.database, ...metadata, collections: [], sampleMethod: 'first-documents-in-id-order',
    fieldSemantics: 'observed BSON types from this sample; collection validators are retained separately' };
  let listing;
  try {
    listing = database.listCollections(collections ? { name: { $in: collections } } : {}, { maxTimeMS: 10000 });
    const definitions = [];
    for await (const definition of listing) {
      if (definition.name.startsWith('system.')) continue;
      if (definitions.length === 64) fail('MONGODB_SELECT_COLLECTIONS_FOR_LARGE_DATABASE');
      definitions.push(definition);
    }
    if (collections?.some(name => !definitions.some(value => value.name === name))) fail('MONGODB_COLLECTION_NOT_FOUND');
    for (const definition of definitions.sort((a, b) => a.name.localeCompare(b.name))) {
      const fields = new Map(), samples = []; let sampled = 0, sampleBytes = 0;
      const cursor = database.collection(definition.name).find({}, {
        limit: sampleSize, sort: { _id: 1 }, maxTimeMS: 10000, batchSize: Math.min(20, sampleSize),
        promoteValues: false, promoteLongs: false, bsonRegExp: true,
      });
      try {
        for await (const document of cursor) {
          sampled++;
          const seen = new Set();
          function visit(value, prefix = '', depth = 0) {
            if (depth > 3 || value === null || typeof value !== 'object' || value._bsontype || value instanceof Date) return;
            for (const [key, item] of Object.entries(value)) {
              const path = prefix ? prefix + '.' + key : key;
              if (fields.size >= 2048 && !fields.has(path)) continue;
              const field = fields.get(path) ?? { path, types: {}, present: 0 };
              const type = bsonType(item); field.types[type] = (field.types[type] ?? 0) + 1;
              if (!seen.has(path)) { field.present++; seen.add(path); }
              fields.set(path, field);
              if (!Array.isArray(item)) visit(item, path, depth + 1);
            }
          }
          visit(document);
          if (samples.length < 5) {
            const value = canonicalEjson(document), bytes = Buffer.byteLength(JSON.stringify(value));
            if (sampleBytes + bytes <= 131072) { samples.push(value); sampleBytes += bytes; }
          }
        }
      } finally { await cursor.close(); }
      let indexes = [], indexAvailability = 'available';
      if (definition.type === 'collection') {
        const indexCursor = database.collection(definition.name).listIndexes({ maxTimeMS: 10000 });
        try { for await (const index of indexCursor) { if (indexes.length < 128) indexes.push(canonicalEjson(index)); } }
        catch (issue) { if (Number(issue?.code) !== 13) throw issue; indexAvailability = 'account-does-not-have-list-indexes'; }
        finally { await indexCursor.close().catch(() => {}); }
      }
      output.collections.push({ name: definition.name, type: definition.type, options: canonicalEjson(definition.options ?? {}),
        ...(definition.info?.uuid ? { uuid: canonicalEjson(definition.info.uuid) } : {}), sampled,
        fields: [...fields.values()].map(field => ({ ...field, missing: sampled - field.present })).sort((a, b) => a.path.localeCompare(b.path)),
        samples, indexes, indexAvailability });
    }
    return output;
  } catch (issue) {
    if (issue?.code && typeof issue.code === 'string') throw issue;
    fail(Number(issue?.code) === 13 ? 'MONGODB_CATALOG_ACCESS_DENIED' : 'MONGODB_CATALOG_UNAVAILABLE', 503);
  } finally { await listing?.close().catch(() => {}); await client.close(); }
}
export async function inspectMongoSourceFile(sourceFile, { environment = process.env, ...options } = {}) {
  const declaration = await readMongoSourceFile(sourceFile);
  return inspectMongoDatabase({ connection: await resolveMongoConnection(declaration, environment), ...options });
}
