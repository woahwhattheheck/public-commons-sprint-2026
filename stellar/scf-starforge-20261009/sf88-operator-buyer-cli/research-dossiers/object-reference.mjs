// MIT. Portable identity of an original completed Object Buyer file.
import {basename,isAbsolute,resolve} from 'node:path';
import {need,object,digest} from '../node/store.mjs';

export const RESEARCH_OBJECT_REFERENCE = 'stellar-forge.research-object-acquisition.v1';
const HEX = /^[a-f0-9]{64}$/;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FIELDS = ['schema','workspaceId','session','sessionId','sourceIntentId',
  'configurationSha256','sourceUrl','snapshot','deliveryMode','bytes','sha256',
  'chunkCount','chunkManifestSha256','filename','contentType','objectId','descriptionSha256'];
const text = (value,max) => typeof value === 'string' && value.trim().length > 0 &&
  Buffer.byteLength(value) <= max && !/[\0-\x1f\x7f]/.test(value);

export function researchObjectWorkspaceId(directory) {
  need(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory&&
    directory!=='/'&&!directory.includes('\0'),'RESEARCH_OBJECT_ABSOLUTE_PATH_REQUIRED');
  return 'object_'+digest(Buffer.from(directory));
}

/** Validate retained provenance; it describes acquisition identity, not a new payment claim. */
export function validateResearchObjectReference(value,input = null) {
  need(object(value) && value.schema === RESEARCH_OBJECT_REFERENCE &&
    Object.keys(value).length === FIELDS.length && Object.keys(value).every(key => FIELDS.includes(key)),
  'RESEARCH_OBJECT_REFERENCE_INVALID');
  need(text(value.workspaceId,128) && SESSION.test(value.session ?? '') &&
    UUID.test(value.sessionId ?? '') && text(value.sourceIntentId,240),
  'RESEARCH_OBJECT_IDENTITY_INVALID');
  for (const field of ['configurationSha256','snapshot','sha256','chunkManifestSha256'])
    need(HEX.test(value[field] ?? ''),'RESEARCH_OBJECT_DIGEST_INVALID');
  let url;
  try { url = new URL(value.sourceUrl); } catch {}
  need(url && url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'RESEARCH_OBJECT_SOURCE_URL_INVALID');
  need(['whole','chunks'].includes(value.deliveryMode) &&
    Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
    Number.isSafeInteger(value.chunkCount) && value.chunkCount > 0,
  'RESEARCH_OBJECT_DELIVERY_INVALID');
  need(text(value.filename,512) && !/[\\/]/.test(value.filename) &&
    !['.','..'].includes(value.filename) && text(value.contentType,256) &&
    /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[ -~]+)?$/.test(value.contentType),
  'RESEARCH_OBJECT_FILE_METADATA_INVALID');
  need((value.objectId === null || text(value.objectId,160)) &&
    (value.descriptionSha256 === null || HEX.test(value.descriptionSha256)),
  'RESEARCH_OBJECT_DESCRIPTION_INVALID');
  if (input !== null) need(object(input) &&
    ['filename','contentType','bytes','sha256'].every(key => input[key] === value[key]),
  'RESEARCH_OBJECT_INPUT_BINDING_CHANGED');
  return structuredClone(value);
}

export function researchObjectReference(delivery,{workspaceId,session} = {}) {
  const report = delivery?.report?.native, assembly = delivery?.assembly;
  need(report?.status === 'COMPLETE' && assembly &&
    ['SAVED','RECORDED'].includes(assembly.status) &&
    assembly.sessionId === report.sessionId &&
    assembly.configurationSha256 === report.configurationSha256 &&
    assembly.snapshot === report.expectedSnapshot && assembly.bytes === report.bytes &&
    assembly.sha256 === report.objectSha256 && assembly.chunkCount === report.chunkCount,
  'RESEARCH_ORIGINAL_OBJECT_DELIVERY_REQUIRED');
  return validateResearchObjectReference({
    schema:RESEARCH_OBJECT_REFERENCE,workspaceId,session,sessionId:report.sessionId,
    sourceIntentId:report.sourceIntentId,configurationSha256:report.configurationSha256,
    sourceUrl:report.sourceUrl,snapshot:report.expectedSnapshot,
    deliveryMode:report.deliveryMode ?? 'chunks',bytes:assembly.bytes,sha256:assembly.sha256,
    chunkCount:assembly.chunkCount,chunkManifestSha256:assembly.chunkManifestSha256,
    filename:basename(assembly.destination),contentType:report.expectedContentType ?? 'application/octet-stream',
    objectId:report.selection?.objectId ?? null,
    descriptionSha256:report.selection?.descriptionSha256 ?? null,
  });
}
