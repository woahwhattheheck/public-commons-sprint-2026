// MIT. QGIS handover over the original verified STAC customer receiver.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StacDelivery } from '../customer.mjs';
import { exportPortableStacDelivery, openPortableStacDelivery } from '../receiving/delivery.mjs';
import { stacRetain, stacMemberPath, StacFile, STAC_MAX_MANIFEST_BYTES } from '../merchant.mjs';
import { absolute, readBytes, parseJson, need, object } from '../../../sf88-operator-buyer-cli/node/store.mjs';

export const QGIS_RECEIVING_SCHEMA = 'starforge.stac-qgis-receiving.v1';
export const QGIS_RECEIVING_FILE = 'qgis-receiving.json';
const HASH = /^[a-f0-9]{64}$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const identity = delivery => Object.fromEntries(['schema', 'bundleSha256', 'selectionSha256',
  'editionId', 'editionDigest', 'snapshot', 'nativeBindingSha256'].map(key => [key, delivery.manifest[key]]));
const record = (path, value, kind) => ({path, bytes: value.bytes, sha256: value.sha256,
  contentType: value.contentType ?? value.mime ?? 'application/octet-stream', kind});

/** The original APIs verify the payment/dataset/asset binding before this desktop handover. */
export async function exportQgisReceiving({directory, out, signal, progress} = {}) {
  const source = await StacDelivery.open(absolute(directory), {signal});
  const exported = await exportPortableStacDelivery(source, absolute(out), {signal, progress});
  const portable = await openPortableStacDelivery(exported.directory,
    {signal, progress, expectedManifestSha256: exported.manifestFile.sha256});
  const originalBytes = await readBytes(join(portable.directory, 'manifest.json'), STAC_MAX_MANIFEST_BYTES);
  const files = [record('manifest.json', {bytes: originalBytes.length, sha256: digest(originalBytes), mime: 'application/json'}, 'original')];
  for (const [path, value] of Object.entries(portable.delivery.manifest.files))
    files.push(record(path, value, 'original'));
  for (const value of portable.manifest.files) files.push(record(value.path, value, 'portable'));
  files.push(record('scene-export.json', {...exported.manifestFile, mime: 'application/json'}, 'portable'));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  need(new Set(files.map(value => value.path)).size === files.length &&
    !files.some(value => value.path === QGIS_RECEIVING_FILE), 'STAC_QGIS_FILE_COLLISION');
  const manifest = {
    schema: QGIS_RECEIVING_SCHEMA,
    source: identity(portable.delivery),
    originalManifest: record('manifest.json', {bytes: originalBytes.length, sha256: digest(originalBytes), mime: 'application/json'}, 'original'),
    portableManifest: record('scene-export.json', {...exported.manifestFile, mime: 'application/json'}, 'portable'),
    paths: structuredClone(portable.paths),
    summary: structuredClone(portable.manifest.summary),
    files,
    authority: 'The retained original STAC customer delivery owns acquisition, selected data and native payment records. This document binds its verified local files for a QGIS project.'
  };
  const bytes = jsonBytes(manifest);
  await stacRetain(stacMemberPath(portable.directory, QGIS_RECEIVING_FILE), bytes);
  return {directory: portable.directory, source: manifest.source, summary: manifest.summary,
    manifest: {path: join(portable.directory, QGIS_RECEIVING_FILE), bytes: bytes.length, sha256: digest(bytes)},
    files: files.length};
}

/** Reopen by the same original receiver, including every native and derived file. */
export async function openQgisReceiving({directory, expectedManifestSha256, signal, progress} = {}) {
  directory = absolute(directory);
  need(expectedManifestSha256 === undefined || HASH.test(expectedManifestSha256),
    'STAC_QGIS_EXPECTED_MANIFEST_INVALID');
  const bytes = await readBytes(join(directory, QGIS_RECEIVING_FILE), STAC_MAX_MANIFEST_BYTES);
  const sha256 = digest(bytes);
  need(expectedManifestSha256 === undefined || sha256 === expectedManifestSha256,
    'STAC_QGIS_MANIFEST_CHANGED');
  const manifest = parseJson(bytes);
  need(object(manifest) && manifest.schema === QGIS_RECEIVING_SCHEMA &&
    Array.isArray(manifest.files) && manifest.files.length <= 66000 &&
    manifest.portableManifest?.path === 'scene-export.json' &&
    manifest.originalManifest?.path === 'manifest.json', 'STAC_QGIS_RECEIVING_INVALID');
  const portable = await openPortableStacDelivery(directory,
    {signal, progress, expectedManifestSha256: manifest.portableManifest.sha256});
  need(same(manifest.source, identity(portable.delivery)) && same(manifest.paths, portable.paths) &&
    same(manifest.summary, portable.manifest.summary), 'STAC_QGIS_SOURCE_CHANGED');
  const originals = new Map(Object.entries(portable.delivery.manifest.files).map(([path, value]) =>
    [path, record(path, value, 'original')]));
  const nativeBytes = await readBytes(join(directory, 'manifest.json'), STAC_MAX_MANIFEST_BYTES);
  originals.set('manifest.json', record('manifest.json',
    {bytes: nativeBytes.length, sha256: digest(nativeBytes), mime: 'application/json'}, 'original'));
  for (const value of portable.manifest.files) originals.set(value.path, record(value.path, value, 'portable'));
  originals.set('scene-export.json', record('scene-export.json', {...portable.manifestFile.record, mime: 'application/json'}, 'portable'));
  const expected = [...originals.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  need(same(expected, manifest.files) && same(manifest.originalManifest, originals.get('manifest.json')) &&
    same(manifest.portableManifest, originals.get('scene-export.json')), 'STAC_QGIS_FILE_SET_CHANGED');
  return Object.freeze({directory, portable, manifest: structuredClone(manifest),
    manifestFile: new StacFile(directory, {path: QGIS_RECEIVING_FILE, bytes: bytes.length, sha256, mime: 'application/json'})});
}
