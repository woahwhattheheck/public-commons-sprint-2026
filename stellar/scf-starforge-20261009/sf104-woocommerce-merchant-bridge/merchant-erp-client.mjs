// MIT. ERP methods share the original merchant client's authenticated transport.
import {createHash} from 'node:crypto';

export const ERP_PROJECT_SCHEMA = 'stellar-forge.sf104.erp-project.v1';
export const ERP_VIEW_SCHEMA = 'stellar-forge.sf104.erp-order-view.v1';
export const ERP_MAX_BYTES = 16 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
function need(value, message) { if (!value) throw Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hash(value) { need(typeof value === 'string' && HASH.test(value), 'Select an exact retained ERP reference.'); return value; }
/** PHP's canonical encoder sorts UTF-8 keys, including integer-looking object keys. */
export function canonicalErpJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalErpJson).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)))
    .map(key => canonicalErpJson(key) + ':' + canonicalErpJson(value[key])).join(',') + '}';
  need(value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isSafeInteger(value), 'The ERP project contains an unsupported numeric value.');
  return JSON.stringify(value).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
}
export function verifyErpProject(value) {
  need(object(value) && value.schema === ERP_PROJECT_SCHEMA && HASH.test(value.sha256) &&
    object(value.operation) && Array.isArray(value.mappings), 'Select a complete native ERP project export.');
  const {sha256,...content} = value;
  need(createHash('sha256').update(canonicalErpJson(content)).digest('hex') === sha256, 'The complete ERP export digest does not match.');
  return value;
}
export function createErpMethods({requestUrl,siteUrl}) {
  const base = siteUrl + '/wp-json/stellar-forge/v1/merchant-erp';
  const call = (path,body) => requestUrl(base + path,body,{maxBytes:ERP_MAX_BYTES,timeoutMs:75000});
  const view = (value,id) => {
    need(object(value) && value.schema === ERP_VIEW_SCHEMA && object(value.record) && object(value.sourceStatus) &&
      (id === undefined || value.record.operationId === id) && HASH.test(value.record.operationId) &&
      /^[1-9][0-9]{0,17}$/.test(value.record.orderId) && Number.isSafeInteger(value.record.revision) && value.record.revision >= 1 &&
      Array.isArray(value.record.editions) && value.record.editions.some(e => e.id === value.record.currentEditionId), 'The native ERP order response is incomplete.');
    return value;
  };
  const mapping = value => {
    need(object(value) && HASH.test(value.id) && object(value.mapping) && value.mapping.schema === 'stellar-forge.sf104.erp-map.v1', 'The native ERP mapping response is incomplete.');
    return value;
  };
  const post = async (path,body,validate = value => value) => {
    need(object(body) && Buffer.byteLength(JSON.stringify(body)) <= ERP_MAX_BYTES, 'The selected ERP request exceeds its supported import size.');
    const result = await call(path,body);
    need(object(result) && Number.isInteger(result.httpStatus) && object(result.response), 'The native ERP operation response is invalid.');
    if (result.httpStatus === 200) validate(result.response);
    return result;
  };
  const action = (id,name,body) => {
    hash(id);
    need(object(body) && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 1, 'Select the current retained ERP order revision.');
    if (['approve','deliver'].includes(name)) hash(body.editionId);
    return post('/orders/' + id + '/' + name,body,value => view(value,id));
  };
  return Object.freeze({
    erpStatus:async () => {
      const value = await call('');
      need(object(value) && value.schema === 'stellar-forge.sf104.erp-status.v1' && Array.isArray(value.maps) &&
        typeof value.currentMapId === 'string', 'The native ERP workspace response is incomplete.');
      return value;
    },
    erpMap:async id => mapping(await call('/maps/' + hash(id))),
    erpSaveMap:(mapping,expectedCurrentMapId) => {
      need(expectedCurrentMapId === '' || typeof expectedCurrentMapId === 'string' && HASH.test(expectedCurrentMapId), 'Select the current mapping revision, or an empty initial selection.');
      return post('/maps',{mapping,expectedCurrentMapId},value => {
        need(object(value) && HASH.test(value.id), 'The saved mapping reference is missing.');
      });
    },
    erpCheckMap:id => post('/maps/' + hash(id) + '/check',{},mapping),
    erpOrders:async ({q='',state='',page=1,limit=25} = {}) => {
      need(typeof q === 'string' && q.length <= 100 && typeof state === 'string' && /^[A-Z_]{0,32}$/.test(state) &&
        Number.isSafeInteger(page) && page >= 1 && page <= 1000000 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'Select a valid ERP queue page.');
      const value = await call('/orders?' + new URLSearchParams({q,state,page:String(page),limit:String(limit)}));
      need(object(value) && Array.isArray(value.orders) && value.page === page && value.limit === limit &&
        Number.isSafeInteger(value.total) && value.total >= 0 && value.pages === Math.ceil(value.total / limit) &&
        value.orders.length <= limit && value.orders.every(row => object(row) && HASH.test(row.operationId)), 'The native ERP order queue response is invalid.');
      return value;
    },
    erpInspect:async id => view(await call('/orders/' + hash(id)),id),
    erpPrepare:body => {
      need(object(body) && /^[1-9][0-9]{0,17}$/.test(body.orderId), 'Select the original numeric Woo order ID.');
      if (body.mapId !== undefined) hash(body.mapId);
      need(Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0, 'Select revision zero for a new original order, or its current retained revision.');
      return post('/prepare',body,value => {
        view(value); need(value.record.orderId === body.orderId,'The prepared source refers to another Woo order.');
      });
    },
    erpApprove:(id,body) => action(id,'approve',body),
    erpDeliver:(id,body) => action(id,'deliver',body),
    erpReconcile:(id,body) => action(id,'reconcile',body),
    erpIdentifyTarget:(id,body) => action(id,'identify-target',body),
    erpAuthorizeRetry:(id,body) => action(id,'authorize-retry',body),
    erpBindImport:(id,body) => action(id,'bind-import',body),
    erpExport:async id => {
      const value = verifyErpProject(await call('/orders/' + hash(id) + '/export'));
      need(value.operation.operationId === id,'The exported project refers to another original order.');
      return value;
    },
    erpImport:project => post('/import',{project:verifyErpProject(project)},view),
  });
}
