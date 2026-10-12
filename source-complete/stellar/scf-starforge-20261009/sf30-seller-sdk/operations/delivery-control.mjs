// MIT. Existing private operations listener -> original SF98 event recovery.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { deliveryEvent, deliveryPage } from './delivery-view.mjs';
import { inspectDelivery, requeueDelivery } from '../../sf98-merchant-delivery/delivery-recovery.mjs';

const BASE = '/api/delivery';
const SCHEMA = 'stellar-forge.sf98.delivery-desk.v1';
const failure = (code,status=400) => Object.assign(new Error(code),{code,status});
const sameToken = (value,expected) => typeof value === 'string' && typeof expected === 'string' &&
  Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value),Buffer.from(expected));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));

function query(url,keys) {
  const actual = [...url.searchParams.keys()];
  if (actual.length !== new Set(actual).size || actual.some(key => !keys.includes(key)))
    throw failure('DELIVERY_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}

async function input(req,maxBytes=2048) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw failure('DELIVERY_JSON_REQUIRED',415);
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw failure('DELIVERY_INPUT_TOO_LARGE',413);
  return await new Promise((resolve,reject) => {
    let size = 0,done = false; const chunks = [];
    const finish = (error,value) => { if (done) return; done = true; chunks.length = 0; error ? reject(error) : resolve(value); };
    req.on('data',chunk => { if (done) return; size += chunk.length;
      if (size > maxBytes) return finish(failure('DELIVERY_INPUT_TOO_LARGE',413)); chunks.push(chunk); });
    req.once('aborted',() => finish(failure('DELIVERY_INPUT_INTERRUPTED')));
    req.once('error',() => finish(failure('DELIVERY_INPUT_INTERRUPTED')));
    req.once('end',() => { if (done) return;
      try { finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))); }
      catch { finish(failure('DELIVERY_JSON_INVALID')); } });
  });
}

/** A receiver-workspace owner can provide recovery(input), wrapping the SAME
 * requeueDelivery helper with owned pause/resume and pinned profile handling.
 * The default performs that helper directly when the original lease is free. */
export function createDeliveryDesk(outbox,{enabled=true,recovery=null,incidents=null,receiverWorkspace=null,clock=Date.now}={}) {
  if (typeof enabled !== 'boolean' || recovery !== null && typeof recovery !== 'function')
    throw new TypeError('Invalid native delivery controller');
  const available = typeof outbox?.rows === 'function' && typeof outbox?.requeue === 'function';
  const controlsEnabled = enabled && available;
  const token = controlsEnabled ? randomBytes(32).toString('hex') : null;
  const pending = new Set(); let closing = false;
  async function respond(req,origins) {
    if (closing) throw failure('DELIVERY_DESK_CLOSING',503);
    const url = new URL(req.url,'http://127.0.0.1');
    if ([BASE+'/requeue',BASE+'/incident/ack'].includes(url.pathname)) {
      if (req.method !== 'POST') return {status:405,body:{error:'DELIVERY_POST_REQUIRED'},headers:{allow:'POST'}};
      if (!controlsEnabled || !origins.has(req.headers.origin) || !sameToken(req.headers['x-delivery-control'],token))
        throw failure('DELIVERY_CONTROL_REQUIRED',403);
      query(url,[]);
      if(url.pathname===BASE+'/incident/ack') {
        if(!incidents)throw failure('DELIVERY_INCIDENTS_UNAVAILABLE',404);
        const command=await input(req,8192);
        if(!plain(command) || Object.keys(command).sort().join(',')!=='by,expectedRevision,id,notes')
          throw failure('DELIVERY_INCIDENT_ACK_INVALID');
        return {status:200,body:await incidents.acknowledge(command)};
      }
      const command = await input(req);
      if (!plain(command) || Object.keys(command).sort().join(',') !== 'expectedRevision,id' ||
          !/^[a-f0-9]{64}$/.test(command.id ?? '') || !/^[a-f0-9]{64}$/.test(command.expectedRevision ?? ''))
        throw failure('DELIVERY_RECOVERY_INPUT_INVALID');
      const result = await (recovery ? recovery(command) : requeueDelivery(outbox,command));
      return {status:200,body:{schema:SCHEMA,recovery:result}};
    }
    if (!['GET','HEAD'].includes(req.method)) return {status:405,body:{error:'DELIVERY_READ_ONLY'},headers:{allow:'GET, HEAD'}};
    if (url.pathname === BASE+'/control') {
      query(url,[]);
      return {status:200,body:{schema:SCHEMA,available,controlsEnabled,managedWorker:recovery !== null,
        receiverWorkspace,incidentMonitoring:incidents!==null,
        semantics:'Requeue the selected original notification after receiver repair; no payment or resource purchase.'}};
    }
    if(url.pathname===BASE+'/incidents') {
      const options=query(url,['state','cursor','limit']);
      if(!incidents)return {status:200,body:{schema:'stellar-forge.sf93.merchant-incident-view.v1',available:false}};
      if(options.limit!==undefined && !/^(?:[1-9]\d?|100)$/.test(options.limit))throw failure('DELIVERY_INCIDENT_QUERY_INVALID');
      return {status:200,body:await incidents.read({...options,limit:options.limit===undefined?25:Number(options.limit)})};
    }
    if(url.pathname===BASE+'/incident') {
      const {id}=query(url,['id']);
      if(!incidents)throw failure('DELIVERY_INCIDENTS_UNAVAILABLE',404);
      return {status:200,body:await incidents.detail(id)};
    }
    if (!available) throw failure('DELIVERY_OUTBOX_UNAVAILABLE',404);
    if (url.pathname === BASE+'/events') {
      const options = query(url,['state','cursor','limit','routeId']);
      if (options.limit !== undefined && !/^(?:[1-9]\d?|100)$/.test(options.limit)) throw failure('DELIVERY_QUERY_INVALID');
      return {status:200,body:deliveryPage(await outbox.rows(),{...options,
        limit:options.limit === undefined ? 25 : Number(options.limit),now:clock()})};
    }
    if (url.pathname === BASE+'/event') {
      const {id} = query(url,['id']);
      const original = await inspectDelivery(outbox,id);
      return {status:200,body:{schema:SCHEMA,event:deliveryEvent(original.row,{now:clock()}),
        revision:original.revision,requeueAvailable:controlsEnabled && original.row.state?.state === 'EXHAUSTED',
        managedWorker:recovery !== null}};
    }
    throw failure('DELIVERY_ROUTE_NOT_FOUND',404);
  }
  return Object.freeze({
    controlFragment:token ? 'control='+token : null,
    accepts:value => { try { return ['/control','/events','/event','/requeue','/incidents','/incident','/incident/ack'].some(tail =>
      new URL(value,'http://127.0.0.1').pathname === BASE+tail); } catch { return false; } },
    dispatch(req,origins) {
      const call = respond(req,origins).catch(error => ({
        status:Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
          error instanceof TypeError ? 400 : error instanceof RangeError ? 409 : 503,
        body:{error:error.code==='SF98_DELIVERY_BUSY'?'DELIVERY_WORKER_ACTIVE':
          typeof error.code === 'string' && /^DELIVERY_[A-Z_]+$/.test(error.code) ? error.code :
          error instanceof TypeError ? 'DELIVERY_QUERY_INVALID' : 'DELIVERY_STATE_UNAVAILABLE'},
      }));
      pending.add(call); call.finally(() => pending.delete(call)); return call;
    },
    async close() { closing = true; await Promise.allSettled([...pending]); },
  });
}
