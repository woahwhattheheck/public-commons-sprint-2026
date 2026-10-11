// MIT. Original-operation control on the existing private operations listener.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parseOperationResponse } from '../upstream-operation-response.mjs';

const BASE = '/api/merchant-operations';
const MAX_INPUT = 2 * 1024 * 1024;
const SCHEMA = 'stellar-forge.merchant-operation-desk.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail = (code,status=400) => Object.assign(new Error(code),{code,status});
// Same private-fragment capability pattern as the original SF61 workspace.
const constantEqual = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a),Buffer.from(b));
function query(url,allowed) {
  const names = [...url.searchParams.keys()];
  if (new Set(names).size !== names.length || names.some(name => !allowed.includes(name))) throw fail('OPERATION_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}
function integer(value,fallback) {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]{0,14})$/.test(value)) throw fail('OPERATION_QUERY_INVALID');
  return Number(value);
}
async function readInput(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw fail('OPERATION_JSON_REQUIRED',415);
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_INPUT)) throw fail('OPERATION_INPUT_TOO_LARGE',413);
  return new Promise((resolve,reject) => {
    let size = 0, done = false;
    const chunks = [];
    function finish(error,value) {
      if (done) return;
      done = true;
      chunks.length = 0;
      if (error) reject(error); else resolve(value);
    }
    req.on('data',chunk => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_INPUT) return finish(fail('OPERATION_INPUT_TOO_LARGE',413));
      chunks.push(chunk);
    });
    req.once('aborted',() => finish(fail('OPERATION_INPUT_INTERRUPTED')));
    req.once('error',() => finish(fail('OPERATION_INPUT_INTERRUPTED')));
    req.once('end',() => {
      if (done) return;
      try { finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))); }
      catch { finish(fail('OPERATION_JSON_INVALID')); }
    });
  });
}

/** Receives only the running session's control capability. Host/origin policy
 * stays in server.mjs; mutating calls additionally require an exact local Origin
 * and the random capability issued at startup. No query can issue a ticket. */
export function createMerchantOperationDesk(control,{enabled=false}={}) {
  if (typeof enabled !== 'boolean') throw new TypeError('operationControls must be boolean');
  const available = Boolean(control?.bindings?.length);
  if (enabled && !available) throw new TypeError('--operation-controls requires a running upstream binding with idempotency');
  const token = enabled ? randomBytes(32).toString('hex') : null;
  const pending = new Set();
  let closing = false;
  const inventory = () => ({schema:SCHEMA,available,controlsEnabled:enabled,
    bindings:control?.bindings ?? [],maxInputBytes:MAX_INPUT,
    semantics:{scope:'Merchant backend operations; independent of payment settlement',
      recovery:'Imports a verified backend result or permits a later original request; makes no backend or payment request'}});
  async function respond(req,localOrigins) {
    if (closing) throw fail('OPERATION_CONSOLE_CLOSING',503);
    const url = new URL(req.url,'http://127.0.0.1');
    if (url.pathname === BASE + '/recover') {
      if (req.method !== 'POST') return {status:405,body:{error:'OPERATION_POST_REQUIRED'},headers:{allow:'POST'}};
      if (!enabled) throw fail('OPERATION_CONTROLS_DISABLED',403);
      if (!localOrigins.has(req.headers.origin) || !constantEqual(req.headers['x-merchant-operation-token'],token))
        throw fail('OPERATION_CONTROL_TOKEN_REQUIRED',403);
      query(url,[]);
      const input = await readInput(req);
      if (!plain(input) || Object.keys(input).some(key => !['binding','operationKey','expectedGeneration','requestHash','action','reference','response'].includes(key)) ||
          !['complete','retry'].includes(input.action) ||
          (input.action === 'complete') !== Object.hasOwn(input,'response')) throw fail('OPERATION_RECOVERY_INPUT_INVALID');
      const {binding,...recovery} = input;
      if (recovery.action === 'complete') recovery.response = parseOperationResponse(recovery.response);
      const operation = await control.recover(binding,recovery);
      return {status:200,body:{schema:SCHEMA,binding,operation}};
    }
    if (!['GET','HEAD'].includes(req.method)) return {status:405,body:{error:'OPERATION_READ_ONLY'},headers:{allow:'GET, HEAD'}};
    if (url.pathname === BASE) { query(url,[]); return {status:200,body:inventory()}; }
    if (!available) throw fail('OPERATION_BINDINGS_UNAVAILABLE',404);
    if (url.pathname === BASE + '/list') {
      const options = query(url,['binding','state','cursor','limit']);
      const {binding,state,cursor} = options;
      const page = await control.list(binding,{state,cursor,limit:integer(options.limit,25)});
      return {status:200,body:{schema:SCHEMA,binding,...page}};
    }
    if (url.pathname === BASE + '/detail') {
      const {binding,operationKey,after} = query(url,['binding','operationKey','after']);
      const operation = await control.inspect(binding,operationKey);
      if (!operation) throw fail('OPERATION_NOT_FOUND',404);
      const audit = await control.audit(binding,operationKey,{after:integer(after,0)});
      return {status:200,body:{schema:SCHEMA,binding,operation,audit}};
    }
    throw fail('OPERATION_ROUTE_NOT_FOUND',404);
  }
  return Object.freeze({
    controlFragment:token,
    accepts:url => typeof url === 'string' && (url === BASE || url.startsWith(BASE + '/') || url.startsWith(BASE + '?')),
    dispatch(req,origins) {
      const operation = respond(req,origins).catch(error => ({
        status:Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
          error instanceof TypeError ? 400 : 503,
        body:{error:typeof error.code === 'string' && /^OPERATION_[A-Z_]+$/.test(error.code) ? error.code :
          error instanceof TypeError ? 'OPERATION_INPUT_OR_RESPONSE_CONTRACT_INVALID' : 'OPERATION_STATE_UNAVAILABLE'},
      }));
      pending.add(operation);
      operation.finally(() => pending.delete(operation));
      return operation;
    },
    async close() { closing = true; await Promise.allSettled([...pending]); },
  });
}
