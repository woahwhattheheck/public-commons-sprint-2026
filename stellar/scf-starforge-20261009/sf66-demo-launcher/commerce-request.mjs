// MIT. Original private request intake and retained-input inspection for SF66.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { readOperationHandoffRequest } from '../sf88-operator-buyer-cli/operation-handoff.mjs';
import { operation } from '../sf88-operator-buyer-cli/config.mjs';
import { normalizeOperationHeaders } from '../sf88-operator-buyer-cli/request-headers.mjs';
import { readRequestBody, requestBodyPin, MAX_REQUEST_BODY_BYTES } from '../sf88-operator-buyer-cli/request-body.mjs';
import { readPrivateFile } from '../sf103-native-buyer-signer/operator.mjs';
import { buildUnpaidRequest } from '../sf30-seller-sdk/developer/request.mjs';
import { decodeMultipart } from '../sf30-seller-sdk/multipart.mjs';
import { selectServiceRoute } from '../sf30-seller-sdk/route-path.mjs';
import { createLiveRequestAdmission } from '../sf89-live-request-admission/index.mjs';
import { readUpstreamPurchaseTicket } from './commerce-upstream.mjs';

export const COMMERCE_REQUEST_TOTAL_BYTES = 64 * 1024 * 1024;
const sha = raw => createHash('sha256').update(raw).digest('hex');
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const need = (ok,code) => { if (!ok) throw Object.assign(new Error(code),{code}); };
const contentType = headers => Object.entries(headers ?? {}).find(([key])=>key.toLowerCase()==='content-type')?.[1];
function queryValues(url) {
  const values=Object.create(null);
  for(const [key,value] of url.searchParams) values[key]=own(values,key)
    ? Array.isArray(values[key]) ? [...values[key],value] : [values[key],value] : value;
  return values;
}
async function bodyContext(raw,headers,offer) {
  const bodyType=offer.extensions?.bazaar?.info?.input?.bodyType ?? 'json';
  if(raw===null) return {bodyPresent:false,bodyType};
  if(bodyType==='form-data') return decodeMultipart(raw,contentType(headers),
    offer.extensions?.bazaar?.schema?.properties?.input?.properties?.body);
  need(bodyType==='json','COMMERCE_REQUEST_BODY_TYPE_UNSUPPORTED');
  let body;
  try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); }
  catch { need(false,'COMMERCE_REQUEST_JSON_INVALID'); }
  return {bodyPresent:true,bodyType,body,rawBody:Uint8Array.from(raw)};
}
function projection(op,raw,context,source=null) {
  const fields=context.multipart?.fields ?? context.body;
  const text=fields===undefined ? '' : JSON.stringify(fields,null,2);
  return {intentId:op.intentId,bodyPresent:raw!==null,bodyBytes:raw?.length ?? 0,
    bodySha256:raw===null ? null : sha(raw),bodyType:context.bodyType,
    contentType:contentType(op.headers) ?? null,
    files:context.multipart?.files ?? [],fieldsText:text.slice(0,65536),fieldsTruncated:text.length>65536,
    ...(source ? {source:{sha256:source.sha256,bytes:source.bytes}} : {})};
}

/** Reads only host-selected private files. Native packet preparation supplies
 * its own intent, URL, headers, ticket and original discovery; none are rebuilt. */
export async function prepareCommerceRequest({selected,compiled,merchant,operations,directory,key,upstream}) {
  const packet=selected.requestFile===undefined ? null : await readOperationHandoffRequest({
    file:selected.requestFile,directory:join(directory,'requests',key),acceptIndex:selected.acceptIndex});
  if(packet) need(!['intentId','method','path','query','bodyFile','headers','ticketFile','ticketHeader']
    .some(name=>own(selected,name)),'COMMERCE_PACKET_INPUTS_CANNOT_BE_OVERRIDDEN');
  const packetOp=packet?.draft.operation;
  const targetRoute=packetOp ? selectServiceRoute(compiled.routes,new URL(packetOp.url).pathname,packetOp.method)?.route : null;
  const route=compiled.routes.find(route=>route.id===(selected.routeId ?? targetRoute?.id));
  need(route && (packetOp?.method ?? selected.method)===route.method,
    'COMMERCE_SETUP_EXPLICIT_ROUTE_METHOD_REQUIRED');
  need(Number.isInteger(selected.acceptIndex) && selected.acceptIndex>=0 && selected.acceptIndex<route.offer.accepts.length,
    'COMMERCE_SETUP_EXPLICIT_PAYMENT_OPTION_REQUIRED');
  const terms=route.offer.accepts[selected.acceptIndex];
  if(packet) need(same(packet.draft.preparedFrom.originalListing.accepts[selected.acceptIndex],terms),
    'COMMERCE_PACKET_MERCHANT_TERMS_CHANGED');
  const paymentFlow=selected.paymentFlow ?? 'authorization';
  need(['authorization','upfront'].includes(paymentFlow) && (terms.extra?.paymentFlow ?? 'authorization')===paymentFlow,
    'COMMERCE_SETUP_EXPLICIT_PAYMENT_FLOW_REQUIRED');
  const raw=packet ? packet.files.body : selected.bodyFile===undefined ? null :
    await readPrivateFile(selected.bodyFile,MAX_REQUEST_BODY_BYTES);
  need(['POST','PUT','PATCH'].includes(route.method) || raw===null,'COMMERCE_REQUEST_BODY_DISALLOWED');
  let headers,request;
  if(packet) {
    headers=packetOp.headers;
    request={publicUrl:packetOp.url};
  } else {
    const additional=normalizeOperationHeaders(selected.headers ?? {});
    const apiOperation=operations.find(item=>item.operationId===route.id);
    const form=route.offer.extensions?.bazaar?.info?.input?.bodyType==='form-data';
    const body=raw===null ? (['POST','PUT','PATCH'].includes(route.method) ? {omitBody:true} : {}) : form
      ? {multipart:{body:raw,contentType:contentType(additional)}}
      : {body:new TextDecoder('utf-8',{fatal:true}).decode(raw)};
    request=buildUnpaidRequest(apiOperation,{path:selected.path,query:selected.query,...body},merchant.publicOrigin);
    const defaults=normalizeOperationHeaders(request.init.headers);
    for(const name of ['Accept','Content-Type']) if(own(additional,name) && own(defaults,name))
      need(additional[name]===defaults[name],'COMMERCE_REQUEST_HEADER_CONFLICT');
    headers=normalizeOperationHeaders({...defaults,...additional});
  }
  const target=new URL(request.publicUrl),matched=selectServiceRoute(compiled.routes,target.pathname,route.method);
  need(target.origin===new URL(merchant.publicOrigin).origin && matched?.route?.id===route.id,
    'COMMERCE_SETUP_REQUEST_SELECTS_ANOTHER_ROUTE');
  const originalRoute=merchant.routes.find(item=>item.id===route.id);
  const maximum=upstream?.configuration.bindings[originalRoute.handler]?.maxRequestBytes ??
    originalRoute.maxRequestBytes ?? merchant.maxRequestBytes ?? 1048576;
  need(raw===null || raw.length<=maximum,'COMMERCE_REQUEST_EXCEEDS_MERCHANT_LIMIT');
  const context={method:route.method,url:target,query:queryValues(target),pathParams:matched.pathParams,
    ...await bodyContext(raw,headers,route.offer)};
  if(originalRoute.validateInput) {
    const valid=await createLiveRequestAdmission(route.offer)(context);
    need(valid===true,valid?.body?.error ?? 'COMMERCE_SETUP_REQUEST_SCHEMA_REJECTED');
  }
  const op=operation({intentId:packetOp?.intentId ?? selected.intentId,url:request.publicUrl,method:route.method,
    expect:{scheme:terms.scheme,network:terms.network,asset:terms.asset,payTo:terms.payTo,
      maxAtomic:terms.amount,maxTimeoutSeconds:terms.maxTimeoutSeconds,
      paymentFlow},headers,
    ...(packet || selected.ticketFile!==undefined ? {ticketFile:join(directory,'tickets',key+'.json')} : {}),
    ...((packetOp?.ticketHeader ?? selected.ticketHeader) ? {ticketHeader:packetOp?.ticketHeader ?? selected.ticketHeader} : {}),
    ...(raw===null ? {} : {bodyFile:join(directory,'bodies',key+'.bin'),...requestBodyPin(raw)})});
  let ticket=packet?.ticket;
  if(packet) {
    const idempotency=upstream?.review?.bindings?.[originalRoute.handler]?.idempotency;
    need(!idempotency || ticket.requestHeader===(idempotency.requestHeader ?? 'x-merchant-operation'),
      'COMMERCE_UPSTREAM_TICKET_HEADER_MISMATCH');
  } else ticket=await readUpstreamPurchaseTicket(selected,op,upstream,originalRoute);
  return {route,terms,op,body:raw,ticket,context,
    preparedFrom:packet?.draft.preparedFrom ?? null,
    packet:packet ? {bytes:packet.handoffBytes,source:packet.source,path:join(directory,'requests',key+'.json')} : null,
    input:projection(op,raw,context,packet?.source)};
}

/** Inspects the exact already-frozen inbox request. Never opens a path supplied
 * by the browser. Queue identity and body pins remain authoritative. */
export async function readCommerceRequestInput(job,offer) {
  const raw=job.operation.bodyFile===undefined ? null : await readRequestBody(job.operation);
  need((raw===null ? null : sha(raw))===job.bodySha256 && (raw?.length ?? 0)===job.bodyBytes,
    'COMMERCE_RETAINED_REQUEST_CHANGED');
  const context=await bodyContext(raw,job.operation.headers,offer);
  return {...projection(job.operation,raw,context),configSha256:job.configSha256,
    method:job.operation.method,url:job.operation.url,headers:job.operation.headers};
}
export async function readCommerceRequestBytes(job) {
  need(job.operation.bodyFile!==undefined,'COMMERCE_REQUEST_BODY_ABSENT');
  const raw=await readRequestBody(job.operation);
  need(sha(raw)===job.bodySha256 && raw.length===job.bodyBytes,'COMMERCE_RETAINED_REQUEST_CHANGED');
  return {bytes:raw,contentType:contentType(job.operation.headers) ?? 'application/octet-stream',
    sha256:job.bodySha256,configSha256:job.configSha256};
}
