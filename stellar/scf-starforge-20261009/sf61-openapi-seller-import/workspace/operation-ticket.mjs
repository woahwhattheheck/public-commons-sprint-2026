// MIT. Issue through the exact active original handler and its original request rules.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileServicePath, orderServiceRoutes, selectServiceRoute } from '../../sf30-seller-sdk/route-path.mjs';
import { createLiveRequestAdmission } from '../../sf89-live-request-admission/index.mjs';
import { canonicalOperationJSON } from '../../sf30-seller-sdk/upstream-idempotency.mjs';
import { writeTicket } from '../../sf30-seller-sdk/upstream-operation.mjs';
import { materializeSellerRequestOffer } from '../../sf30-seller-sdk/resource-server.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { loadOperationTicket } from '../../sf88-operator-buyer-cli/operation-ticket.mjs';
import { normalizeOperationHeaders } from '../../sf88-operator-buyer-cli/request-headers.mjs';
import { createOperationHandoff, OPERATION_HANDOFF_SCHEMA, OPERATION_HANDOFF_MAX_BYTES } from '../../sf88-operator-buyer-cli/operation-handoff.mjs';
import { merchantTicketDirectory } from './operation-plan.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new TypeError(message); };

export function createMerchantTicketIssuer({ service, upstreams, control }) {
  if (typeof control?.issue !== 'function') throw new TypeError('Original active operation issuer required');
  const routes = orderServiceRoutes(service.routes.map(route => ({ ...route,
    method: route.offer.extensions.bazaar.info.input.method,
    binding: compileServicePath(route.offer), admission: createLiveRequestAdmission(route.offer) })));
  const enabled = new Map(control.bindings.map(binding => [binding.name, binding]));
  const descriptors = routes.filter(route => enabled.has(route.handler)).map(route => {
    const policy = upstreams.bindings[route.handler].idempotency;
    const input = route.offer.extensions.bazaar.info.input;
    const url = new URL(route.offer.resource.url);
    for (const [name,value] of Object.entries(input.queryParams ?? {})) url.searchParams.set(name,String(value));
    return Object.freeze({ binding: route.handler, id: route.id, method: route.method,
      path: route.path, scope: policy.scope, requestHeader: policy.requestHeader ?? 'x-merchant-operation',
      forwardedHeaders:[...(upstreams.bindings[route.handler].requestHeaders ?? [])],
      maxTicketSeconds: policy.maxTicketSeconds ?? 86400,
      request: { method: route.method, url: url.href,
        pathParams: structuredClone(input.pathParams ?? {}), headers: {'content-type':'application/json'}, body: structuredClone(input.body ?? {}) } });
  });
  function issue(value) {
    if (!plain(value) || Object.keys(value).some(key => !['binding','request','id','subject','expiresAt'].includes(key)) ||
        !enabled.has(value.binding)) fail('Select an operation in the current merchant runtime');
    const input = value.request;
    if (!plain(input) || Object.keys(input).some(key => !['method','url','pathParams','headers','body'].includes(key)) ||
        input.method !== undefined && input.method !== 'POST' || !Object.hasOwn(input,'body'))
      fail('Operation request uses POST, its public URL, ordinary headers and a JSON body');
    let url;
    try { url = new URL(input.url); } catch { fail('A complete public request URL is required'); }
    if (typeof input.url !== 'string' || url.href !== input.url || url.origin !== service.publicOrigin ||
        url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 2048)
      fail('Use the exact public URL served by this merchant package');
    const selected = selectServiceRoute(routes, url.pathname, 'POST');
    if (!selected?.route || selected.route.handler !== value.binding) fail('The original seller routes this URL to a different operation');
    const pathParams = selected.pathParams;
    if (input.pathParams !== undefined && (!plain(input.pathParams) ||
        canonicalOperationJSON(input.pathParams) !== canonicalOperationJSON(pathParams)))
      fail('Named path parameters must match the original public request URL');
    const query = Object.create(null);
    for (const [key,item] of url.searchParams) {
      if (!Object.hasOwn(query,key)) query[key] = item;
      else query[key] = Array.isArray(query[key]) ? [...query[key],item] : [query[key],item];
    }
    const binding = upstreams.bindings[value.binding], allowed = new Set(['content-type','accept',...(binding.requestHeaders ?? []).map(name=>name.toLowerCase())]);
    const headers = Object.create(null);
    for (const [name,item] of Object.entries(normalizeOperationHeaders(input.headers ?? {}))) {
      const key = name.toLowerCase();
      if (!allowed.has(key))
        fail('Use only the ordinary request headers configured for this operation');
      headers[key] = item;
    }
    if (headers['content-type'] !== undefined && headers['content-type'].split(';',1)[0].trim().toLowerCase() !== 'application/json')
      fail('POST operation requests use application/json');
    const context = { method:'POST',url,pathParams,query,headers,body:structuredClone(input.body) };
    const decision = selected.route.admission(context);
    if (decision !== true) fail('Request violates the original input schema: ' +
      [decision?.body?.error,...(decision?.body?.issues ?? [])].filter(Boolean).join('; '));
    const result = control.issue(value.binding,context,{id:value.id,subject:value.subject,expiresAt:value.expiresAt});
    return { document:{schema:'stellar-forge.upstream-operation-ticket.v1',...result},
      request:{method:'POST',url:url.href,pathParams:{...pathParams},headers:{...headers},body:context.body},
      requestHeader:enabled.get(value.binding).requestHeader,
      offer:materializeSellerRequestOffer(selected.route,url,pathParams) };
  }
  return Object.freeze({ bindings:Object.freeze(descriptors),issue });
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{64}$/;
const shell = value => "'"+String(value).replaceAll("'","'\\''")+"'";

/** Keep the original envelope in a create-only private file, not API status. */
export async function saveMerchantTicket(project, runtimeId, issued) {
  const {document,request,offer,requestHeader}=issued;
  const directory = await merchantTicketDirectory(project);
  const bytes = Buffer.from(JSON.stringify(document,null,2)+'\n');
  const fileId = randomUUID()+'-'+digest(bytes);
  const filename = 'operation-'+runtimeId+'-'+fileId+'.json';
  const path = join(directory,filename), stem=path.slice(0,-5);
  const bodyPath=stem+'.body.json', headersPath=stem+'.headers.json', offersPath=stem+'.offers.json', reviewPath=stem+'.review.json';
  const headers=normalizeOperationHeaders(request.headers);
  const discovery={resources:[offer]}, raw=Buffer.from(JSON.stringify(discovery,null,2)+'\n');
  const intentId='merchant-'+document.operationKey;
  const {draft}=prepareReview(raw,{rowIndex:0,acceptIndex:0,intentId,url:request.url,
    method:'POST',bodyFile:bodyPath,headers,ticketFile:path,ticketHeader:requestHeader});
  await writeTicket(path,document);
  // The maintained buyer performs its own exact envelope/private-file import.
  await loadOperationTicket(draft.operation,{requireCurrent:true});
  await writeTicket(bodyPath,request.body);
  await writeTicket(headersPath,headers);
  await writeTicket(offersPath,discovery);
  await writeTicket(reviewPath,draft);
  const handoff=createOperationHandoff({draft,discoveryBytes:raw,ticketBytes:bytes,
    bodyBytes:Buffer.from(JSON.stringify(request.body,null,2)+'\n')});
  const handoffBytes=Buffer.from(JSON.stringify(handoff,null,2)+'\n');
  const handoffId=randomUUID()+'-'+digest(handoffBytes);
  const handoffFilename='operation-'+runtimeId+'-'+handoffId+'.handoff.json';
  const handoffPath=join(directory,handoffFilename);
  await writeTicket(handoffPath,handoff);
  return { fileId,filename,path,operationKey:document.operationKey,
    requestHash:document.requestHash,expiresAt:document.expiresAt,
    bodyPath,headersPath,offersPath,reviewPath,intentId,requestHeader,
    handoffId,handoffFilename,handoffPath,handoffSha256:digest(handoffBytes),
    reviewCommand:['node',fileURLToPath(new URL('../../sf88-operator-buyer-cli/cli.mjs',import.meta.url)),
      '--review','--config',reviewPath].map(shell).join(' ') };
}

/** The active runtime and a pinned file digest identify the exact issued bytes.
 * No growing in-memory ticket registry or arbitrary caller-supplied path. */
export async function readMerchantTicket(project, runtimeId, fileId) {
  return readIssuedDocument(project,runtimeId,fileId,{suffix:'.json',limit:16384,
    schema:'stellar-forge.upstream-operation-ticket.v1',keys:'expiresAt,operationKey,requestHash,schema,ticket'});
}

export async function readMerchantOperationHandoff(project, runtimeId, fileId) {
  return readIssuedDocument(project,runtimeId,fileId,{suffix:'.handoff.json',limit:OPERATION_HANDOFF_MAX_BYTES,
    schema:OPERATION_HANDOFF_SCHEMA,keys:'files,headers,intentId,rowIndex,schema,ticketHeader,url'});
}

async function readIssuedDocument(project,runtimeId,fileId,{suffix,limit,schema,keys}) {
  if (typeof fileId !== 'string' || !fileKey.test(fileId)) fail('Select a ticket file issued by this runtime');
  const directory = await merchantTicketDirectory(project);
  const path = join(directory,'operation-'+runtimeId+'-'+fileId+suffix);
  const file = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode&0o077)!==0 || info.size>limit ||
        typeof process.getuid==='function' && info.uid!==process.getuid() || await realpath(path)!==path)
      fail('Ticket must remain a private original file');
    const bytes = Buffer.alloc(limit+1);
    let size=0;
    while(size<bytes.length) {
      const {bytesRead}=await file.read(bytes,size,bytes.length-size,size);
      if(!bytesRead)break;
      size+=bytesRead;
    }
    const value = bytes.subarray(0,size);
    if (size>limit || digest(value)!==fileId.slice(-64)) fail('Issued ticket file changed');
    const document = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
    if (document?.schema!==schema || Object.keys(document).sort().join(',')!==keys)
      fail('Original operation ticket envelope required');
    return document;
  } finally { await file.close(); }
}
