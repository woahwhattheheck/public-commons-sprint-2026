import fs from 'node:fs/promises';
import path from 'node:path';
import {
  fault, fingerprint, integer, now, sourceUrl, fetchSource, retainSource,
  readVerifiedSource, maybeJson, writeJson, writeProjection, withCaptureLock, reopenCapture
} from './common.mjs';

export const BURBANK_PAVEMENT_2025 = 'https://mobilegis.burbankca.gov/burgis/rest/services/Planning/Core_Transportation/MapServer/4';
export const BURBANK_CITY_BOUNDARY = 'https://mobilegis.burbankca.gov/burgis/rest/services/Land/Burbank_Border/MapServer/0';
export const ARCGIS_QUERY_SOURCE = 'https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/';
const idText = value => {
  if (!/^-?\d+$/.test(String(value))) throw fault('INVALID_OBJECT_ID', 'ArcGIS returned a non-integer object ID');
  return BigInt(value).toString();
};
function orderedIds(values) {
  if (!Array.isArray(values)) throw fault('MISSING_ID_CENSUS', 'ArcGIS did not return its objectIds array');
  const ids = values.map(idText).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  if (new Set(ids).size !== ids.length) throw fault('DUPLICATE_OBJECT_IDS', 'Source ID census contains duplicates');
  return ids;
}
function fieldsFor(metadata, requested) {
  const fields = metadata.fields;
  if (!Array.isArray(fields)) throw fault('MISSING_FIELD_SCHEMA', 'ArcGIS layer has no field schema');
  const oid = metadata.objectIdField || metadata.objectIdFieldName || fields.find(f => ['esriFieldTypeOID', 'esriFieldTypeObjectID'].includes(f.type))?.name;
  if (!oid) throw fault('MISSING_OBJECT_ID_FIELD', 'Layer has no declared object ID field');
  const available = fields.filter(f => f.type !== 'esriFieldTypeGeometry').map(f => f.name);
  const selected = requested === '*' ? available : [...new Set([oid, ...requested])];
  for (const name of selected) if (!available.includes(name)) throw fault('UNKNOWN_SOURCE_FIELD', `Layer does not declare field ${name}`);
  return { oid, columns: selected, fields: fields.filter(f => selected.includes(f.name)) };
}
async function* captureRows(directory, manifest, columns) {
  for (const page of manifest.pages) {
    const body = await readVerifiedSource(directory, page);
    const byId = new Map(body.features.map(feature => [idText(feature.attributes[manifest.objectIdField]), feature]));
    for (const id of page.objectIds) {
      const attributes = byId.get(id).attributes;
      yield { record: Object.fromEntries(columns.map(key => [key, attributes[key] ?? null])), source: { objectId: id, page: page.file, pageSha256: page.sha256 } };
    }
  }
}
export async function projectCaptureCsv({ directory, columns, csvFile = 'records.csv', jsonlFile = 'records.jsonl.gz' }) {
  const manifest = await reopenCapture(directory);
  if (!['complete', 'review_required'].includes(manifest.status)) throw fault('CAPTURE_INCOMPLETE', 'Finish the source capture before projecting it');
  const selected = columns || manifest.columns;
  for (const name of selected) if (!manifest.columns.includes(name)) throw fault('UNKNOWN_SOURCE_FIELD', `Capture does not contain ${name}`);
  return writeProjection({ directory, columns: selected, rows: captureRows(directory, manifest, selected), csvFile, jsonlFile });
}
export async function captureArcGis({
  directory, layerUrl = BURBANK_PAVEMENT_2025, approvedOrigin,
  where = '1=1', fields = '*', returnGeometry = true, outSR,
  pageSize = 200, maxRecords = 1000000, maxResponseBytes = 32 * 1024 * 1024,
  resume = true, signal, onProgress = () => {}, fetchImpl = fetch
}) {
  const layer = sourceUrl(layerUrl, approvedOrigin);
  if (layer.search || !/\/(?:MapServer|FeatureServer)\/\d+\/?$/.test(layer.pathname)) throw fault('INVALID_ARCGIS_LAYER', 'Use the exact ArcGIS layer URL, without query parameters');
  layer.pathname = layer.pathname.replace(/\/$/, '');
  if (fields !== '*' && (!Array.isArray(fields) || !fields.length || fields.some(f => typeof f !== 'string'))) throw fault('INVALID_FIELDS', 'fields must be * or a nonempty list of native field names');
  if (typeof where !== 'string' || !where.trim()) throw fault('INVALID_FILTER', 'where must be an explicit ArcGIS SQL predicate');
  pageSize = integer(pageSize, 'pageSize', 1, 500);
  maxRecords = integer(maxRecords, 'maxRecords', 1, 10000000);
  if (outSR !== undefined) integer(outSR, 'outSR', 1);
  const config = { layerUrl: String(layer), where, fields, returnGeometry: Boolean(returnGeometry), ...(outSR === undefined ? {} : { outSR: String(outSR) }), pageSize, maxRecords };
  const configSha256 = fingerprint(config);
  const request = async (parameters, file) => {
    const url = new URL(parameters ? String(layer) + '/query' : String(layer));
    url.search = new URLSearchParams({ f: 'json', ...(parameters || {}) }).toString();
    return retainSource(directory, file, await fetchSource(url, { signal, fetchImpl, maxBytes: maxResponseBytes }));
  };
  return withCaptureLock(directory, async () => {
    const manifestFile = path.join(directory, 'capture.json');
    let manifest = await maybeJson(manifestFile);
    if (manifest && (!resume || manifest.configSha256 !== configSha256)) throw fault('CAPTURE_CONFIG_MISMATCH', 'Use a new capture directory for a different source selection');
    if (manifest && ['complete', 'review_required'].includes(manifest.status)) return reopenCapture(directory);
    if (!manifest) manifest = { schema: 'tjl.arcgis-capture.v1', config, configSha256, startedAt: now(), status: 'capturing', pages: [], documentation: ARCGIS_QUERY_SOURCE };
    const checkpoint = async () => { manifest.updatedAt = now(); await writeJson(manifestFile, manifest); };
    try {
      manifest.status = 'capturing'; delete manifest.error; await checkpoint();
      if (!manifest.metadata) {
        const source = await request(null, 'source/layer.json');
        const schema = fieldsFor(source.body, fields);
        if (!(source.body.capabilities || '').split(',').map(x => x.trim()).some(x => ['Query', 'Data'].includes(x))) throw fault('LAYER_NOT_QUERYABLE', 'This layer does not advertise query/data capability');
        manifest.metadata = { file: source.file, sha256: source.receipt.sha256 };
        manifest.objectIdField = schema.oid; manifest.columns = schema.columns; manifest.fields = schema.fields;
        manifest.spatialReference = source.body.extent?.spatialReference || source.body.spatialReference || null;
        manifest.geometryType = source.body.geometryType || null;
        manifest.pageSize = Math.min(pageSize, integer(source.body.maxRecordCount || pageSize, 'layer maxRecordCount', 1));
        await checkpoint();
      } else await readVerifiedSource(directory, manifest.metadata);
      let ids;
      if (!manifest.ids) {
        const source = await request({ where, returnIdsOnly: 'true' }, 'source/object-ids.json');
        ids = orderedIds(source.body.objectIds);
        if (ids.length > maxRecords) throw fault('SOURCE_RECORD_LIMIT', `Source has ${ids.length} records; reviewed maxRecords is ${maxRecords}`);
        if (source.body.objectIdFieldName && source.body.objectIdFieldName !== manifest.objectIdField) throw fault('OBJECT_ID_SCHEMA_CHANGED', 'Layer metadata and ID census use different object ID fields');
        manifest.ids = { file: source.file, sha256: source.receipt.sha256, count: ids.length, setSha256: fingerprint(ids) };
        await checkpoint();
      } else ids = orderedIds((await readVerifiedSource(directory, manifest.ids)).objectIds);
      const completed = new Set();
      for (const page of manifest.pages) {
        await readVerifiedSource(directory, page);
        for (const id of page.objectIds) {
          if (completed.has(id)) throw fault('DUPLICATE_CAPTURE_PAGE', 'A retained object ID occurs in multiple pages');
          completed.add(id);
        }
      }
      await onProgress({ stage: 'capture', completed: completed.size, total: ids.length });
      const captureBatch = async batch => {
        signal?.throwIfAborted();
        const file = `source/page-${String(manifest.pages.length).padStart(6, '0')}.json`;
        const source = await request({
          objectIds: batch.join(','), outFields: fields === '*' ? '*' : manifest.columns.join(','),
          returnGeometry: String(Boolean(returnGeometry)), ...(outSR === undefined ? {} : { outSR: String(outSR) })
        }, file);
        if (!Array.isArray(source.body.features)) throw fault('MISSING_FEATURES', 'ArcGIS response did not contain features', { file });
        if (source.body.exceededTransferLimit === true) {
          if (batch.length === 1) throw fault('SINGLE_FEATURE_TRANSFER_LIMIT', 'One feature exceeds the service transfer limit', { objectId: batch[0], file });
          // Preserve this response independently; smaller ID selections then replace
          // the unfinished page slot and never discard an accepted capture page.
          const attempt = `source/transfer-limit-${fingerprint(batch).slice(0, 20)}.json${source.encoding === 'gzip' ? '.gz' : ''}`;
          await fs.copyFile(path.join(directory, source.file), path.join(directory, attempt));
          await fs.copyFile(path.join(directory, source.file + '.receipt.json'), path.join(directory, attempt + '.receipt.json'));
          const middle = Math.ceil(batch.length / 2);
          await captureBatch(batch.slice(0, middle)); await captureBatch(batch.slice(middle)); return;
        }
        const returned = orderedIds(source.body.features.map(feature => feature.attributes?.[manifest.objectIdField]));
        if (fingerprint(returned) !== fingerprint(orderedIds(batch))) throw fault('SOURCE_ID_SET_CHANGED', 'Returned features do not match the requested ID selection; retain this partial capture and start a new capture after review', { requested: batch, returned, file });
        manifest.pages.push({ file: source.file, encoding: source.encoding, sha256: source.receipt.sha256, bytes: source.receipt.bytes, objectIds: batch, retrievedAt: source.receipt.retrievedAt });
        for (const id of batch) completed.add(id);
        await checkpoint(); await onProgress({ stage: 'capture', completed: completed.size, total: ids.length, lastPageBytes: source.receipt.bytes });
      };
      const remaining = ids.filter(id => !completed.has(id));
      for (let offset = 0; offset < remaining.length; offset += manifest.pageSize) await captureBatch(remaining.slice(offset, offset + manifest.pageSize));
      const finalIds = manifest.finalSources?.length ? { body: await readVerifiedSource(directory, manifest.finalSources[0]) } : await request({ where, returnIdsOnly: 'true' }, 'source/object-ids-final.json');
      const finalSet = orderedIds(finalIds.body.objectIds), finalSetSha256 = fingerprint(finalSet);
      if (!manifest.finalSources?.length) manifest.finalSources = [{ file: finalIds.file, sha256: finalIds.receipt.sha256 }];
      const first = new Set(ids), last = new Set(finalSet);
      manifest.consistency = {
        kind: 'start-and-end-object-id-census', startSetSha256: manifest.ids.setSha256, endSetSha256: finalSetSha256,
        sameIdSet: finalSetSha256 === manifest.ids.setSha256,
        addedIds: finalSet.filter(id => !first.has(id)), removedIds: ids.filter(id => !last.has(id)),
        transactionalSnapshot: false,
        limitation: 'Matching ID sets do not rule out attribute or geometry edits during capture. Raw responses and individual capture times are retained.'
      };
      manifest.projection = await writeProjection({ directory, columns: manifest.columns, rows: captureRows(directory, manifest, manifest.columns) });
      manifest.status = manifest.consistency.sameIdSet ? 'complete' : 'review_required';
      manifest.completedAt = now(); await checkpoint();
      await onProgress({ stage: 'complete', status: manifest.status, completed: ids.length, total: ids.length });
      return manifest;
    } catch (error) {
      manifest.status = signal?.aborted ? 'cancelled' : 'interrupted';
      manifest.error = { code: error.code || error.name || 'CAPTURE_FAILED', message: error.message, details: error.details || {} };
      await checkpoint(); throw error;
    }
  });
}
