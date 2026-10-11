// MIT — Saved research selections in the original resource-library database.
import { digest, requireValue } from './files.mjs';

export const COLLECTION_SCHEMA = 'stellar-forge.sf88.resource-collection.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const HASH = /^[a-f0-9]{64}$/;
const encode = value => JSON.stringify(value);
const decode = row => row ? JSON.parse(row.content) : null;
function integer(value, minimum = 0) {
  requireValue(Number.isSafeInteger(value) && value >= minimum, 'COLLECTION_REVISION_REQUIRED');
}
export function validateCollection(value) {
  requireValue(value?.schema === COLLECTION_SCHEMA && ID.test(value.id ?? ''), 'COLLECTION_INVALID');
  integer(value.revision, 1);
  requireValue(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 200 &&
    typeof value.note === 'string' && Buffer.byteLength(value.note) <= 32768, 'COLLECTION_DESCRIPTION_INVALID');
  requireValue(Array.isArray(value.members) && value.members.length <= 10000, 'COLLECTION_MEMBERS_INVALID');
  const seen = new Set();
  for (const record of value.members) {
    requireValue(HASH.test(record?.id ?? '') && !seen.has(record.id) && HASH.test(record.sha256 ?? '') &&
      Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.deliveryStatus === 'SAVED' &&
      typeof record.name === 'string' && record.name.length <= 4096 && typeof record.path === 'string',
      'COLLECTION_MEMBER_INVALID');
    const a = record.annotation;
    requireValue(a && Number.isSafeInteger(a.revision) && a.revision >= 0 &&
      typeof a.note === 'string' && Buffer.byteLength(a.note) <= 32768 &&
      Array.isArray(a.tags) && a.tags.length <= 20 && a.tags.every(t => typeof t === 'string' && t.length <= 64) &&
      typeof a.starred === 'boolean', 'COLLECTION_ANNOTATION_INVALID');
    seen.add(record.id);
  }
  return value;
}

/** Share the existing index connection and native resource/annotation reader. */
export function collectionStore({db, transaction, resource, current}) {
  db.exec(`CREATE TABLE IF NOT EXISTS resource_collections(
      id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL,
      PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS collection_operations(
      operation TEXT PRIMARY KEY,digest TEXT NOT NULL,collection_id TEXT NOT NULL,revision INTEGER NOT NULL);`);
  function show(id, revision) {
    requireValue(ID.test(id ?? ''), 'COLLECTION_ID_INVALID');
    if (revision !== undefined) integer(revision, 1);
    const row = revision === undefined
      ? db.prepare('SELECT content FROM resource_collections WHERE id=? ORDER BY revision DESC LIMIT 1').get(id)
      : db.prepare('SELECT content FROM resource_collections WHERE id=? AND revision=?').get(id,revision);
    requireValue(row, 'COLLECTION_NOT_FOUND', 404);
    return decode(row);
  }
  function summary(value) {
    return {id:value.id,name:value.name,note:value.note,revision:value.revision,
      updatedAt:value.updatedAt,memberCount:value.members.length,
      bytes:value.members.reduce((sum,r) => sum + BigInt(r.bytes),0n).toString()};
  }
  function list({offset=0,limit=50} = {}) {
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200,
      'COLLECTION_PAGE_INVALID');
    const total = db.prepare('SELECT COUNT(DISTINCT id) AS count FROM resource_collections').get().count;
    const rows = db.prepare(`SELECT c.content FROM resource_collections c
      WHERE revision=(SELECT MAX(revision) FROM resource_collections WHERE id=c.id)
      ORDER BY c.id LIMIT ? OFFSET ?`).all(limit,offset);
    return {total,offset,limit,items:rows.map(r => summary(decode(r)))};
  }
  function history(id,{offset=0,limit=50} = {}) {
    requireValue(ID.test(id ?? '') && Number.isSafeInteger(offset) && offset>=0 &&
      Number.isSafeInteger(limit) && limit>=1 && limit<=200, 'COLLECTION_PAGE_INVALID');
    return {total:db.prepare('SELECT COUNT(*) AS count FROM resource_collections WHERE id=?').get(id).count,
      offset,limit,items:db.prepare('SELECT content FROM resource_collections WHERE id=? ORDER BY revision DESC LIMIT ? OFFSET ?')
        .all(id,limit,offset).map(r=>summary(decode(r)))};
  }
  function save({id,name,note='',members,expectedRevision,operationId} = {}) {
    requireValue(ID.test(id ?? ''), 'COLLECTION_ID_INVALID');
    requireValue(typeof operationId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(operationId),'OPERATION_ID_REQUIRED');
    integer(expectedRevision);
    requireValue(expectedRevision < Number.MAX_SAFE_INTEGER && typeof name === 'string' && name.trim() && name.length<=200 &&
      typeof note==='string' && Buffer.byteLength(note)<=32768, 'COLLECTION_DESCRIPTION_INVALID');
    requireValue(Array.isArray(members) && members.length<=10000, 'COLLECTION_MEMBERS_INVALID');
    const selectors=members.map(m => ({id:m?.id,mode:m?.mode ?? 'current',sha256:m?.sha256,
      annotationRevision:m?.annotationRevision}));
    const request={id,name,note,members:selectors,expectedRevision};
    const requestHash=digest(encode(request));
    return transaction(() => {
      const receipt=db.prepare('SELECT * FROM collection_operations WHERE operation=?').get(operationId);
      if(receipt) {
        requireValue(receipt.digest===requestHash,'OPERATION_ID_CONFLICT',409);
        return show(receipt.collection_id,receipt.revision);
      }
      const previous=decode(db.prepare('SELECT content FROM resource_collections WHERE id=? ORDER BY revision DESC LIMIT 1').get(id));
      requireValue((previous?.revision ?? 0)===expectedRevision,'COLLECTION_REVISION_CONFLICT',409);
      const retained=new Map(previous?.members.map(m=>[m.id,m]) ?? []), seen=new Set();
      const records=selectors.map(m=>{
        requireValue(HASH.test(m.id ?? '') && HASH.test(m.sha256 ?? '') && !seen.has(m.id) &&
          ['current','retain'].includes(m.mode), 'COLLECTION_MEMBER_SELECTION_INVALID');
        integer(m.annotationRevision); seen.add(m.id);
        const record=m.mode==='retain' ? retained.get(m.id) : resource(m.id);
        requireValue(record && record.deliveryStatus==='SAVED' && record.sha256===m.sha256 &&
          record.annotation.revision===m.annotationRevision,'COLLECTION_MEMBER_CHANGED',409);
        requireValue(m.mode==='retain' || record.status==='VERIFIED','COLLECTION_VERIFIED_MEMBER_REQUIRED',409);
        return record;
      });
      const value=validateCollection({schema:COLLECTION_SCHEMA,id,revision:expectedRevision+1,name,note,
        updatedAt:new Date().toISOString(),scan:current(),members:records});
      requireValue(Buffer.byteLength(encode(value)) <= 64*1024*1024, 'COLLECTION_METADATA_TOO_LARGE');
      db.prepare('INSERT INTO resource_collections VALUES(?,?,?)').run(id,value.revision,encode(value));
      db.prepare('INSERT INTO collection_operations VALUES(?,?,?,?)').run(operationId,requestHash,id,value.revision);
      return value;
    });
  }
  return Object.freeze({list,show,history,save});
}
