// MIT. Private retained upload requests inside the existing merchant package.
import { randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeMultipart, decodeMultipart, MAX_REQUEST_BODY_BYTES } from '../../sf30-seller-sdk/multipart.mjs';
import { compileServicePath, orderServiceRoutes, selectServiceRoute } from '../../sf30-seller-sdk/route-path.mjs';
import { createLiveRequestAdmission } from '../../sf89-live-request-admission/index.mjs';
import { normalizeOperationHeaders } from '../../sf88-operator-buyer-cli/request-headers.mjs';
import { readRequestFile, writeRequestFile, requestBodyPin } from '../../sf88-operator-buyer-cli/request-body.mjs';
import { merchantTicketDirectory } from './operation-plan.mjs';
const SCHEMA='stellar-forge.merchant-file-request.v1';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new TypeError(message);};
function selected(service,binding,request) {
  if (!plain(request)||Object.keys(request).some(k=>!['method','url','pathParams','headers','body'].includes(k))) fail('Upload request uses the public URL, ordinary headers and scalar form fields');
  const url=new URL(request.url);
  if (request.url!==url.href||url.origin!==service.publicOrigin||url.protocol!=='https:'||url.hash||url.username||url.password||url.href.length>2048) fail('Use this merchant package’s exact public request URL');
  const routes=orderServiceRoutes(service.routes.map(route=>({...route,method:route.offer.extensions.bazaar.info.input.method,binding:compileServicePath(route.offer)})));
  const match=selectServiceRoute(routes,url.pathname,request.method??'POST');
  if (!match?.route||match.route.handler!==binding||match.route.offer.extensions.bazaar.info.input.bodyType!=='form-data') fail('Select the matching multipart operation from this package');
  return {...match,url};
}
function requestHeaders(input,binding) {
  const headers=normalizeOperationHeaders(input??{}), allowed=new Set(['accept',...(binding.requestHeaders??[])].map(name=>name.toLowerCase()));
  if (Object.keys(headers).some(k=>!allowed.has(k.toLowerCase()))) fail('Use only this operation’s configured ordinary headers; multipart Content-Type is generated');
  return headers;
}
function queryOf(url) {
  const query=Object.create(null);
  for (const [key,value] of url.searchParams) query[key]=Object.hasOwn(query,key)?[].concat(query[key],value):value;
  return query;
}
export async function stageMerchantFileRequest(project,service,upstreams,{binding,request,files}) {
  const match=selected(service,binding,request), policy=upstreams.bindings[binding];
  if (!policy) fail('Upstream binding is unavailable');
  const headers=requestHeaders(request.headers,policy);
  const encoded=encodeMultipart({fields:request.body??{},files});
  if (encoded.bytes>(policy.maxRequestBytes??1048576)) fail('Upload exceeds this operation’s configured request-byte limit');
  const decoded=await decodeMultipart(encoded.raw,encoded.contentType,match.route.offer.extensions.bazaar.schema.properties.input.properties.body);
  const decision=createLiveRequestAdmission(match.route.offer)({...decoded,method:match.route.method,query:queryOf(match.url),pathParams:match.pathParams});
  if (decision!==true) fail('Upload fields violate the original source schema: '+[decision.body.error,...(decision.body.issues??[])].join('; '));
  const directory=await merchantTicketDirectory(project), uuid=randomUUID();
  const manifest={schema:SCHEMA,binding,createdAt:new Date().toISOString(),
    request:{method:match.route.method,url:match.url.href,pathParams:match.pathParams,headers:{...headers,'Content-Type':encoded.contentType}},
    ...requestBodyPin(encoded.raw),review:decoded.multipart};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  if (bytes.length>1048576) fail('Private request review exceeds 1 MiB');
  const fileId=uuid+'-'+hash(bytes);
  await writeRequestFile(join(directory,'file-request-'+uuid+'.bin'),encoded.raw);
  await writeRequestFile(join(directory,'file-request-'+fileId+'.json'),bytes);
  return {fileId,...manifest};
}
async function readManifest(project,fileId) {
  if (typeof fileId!=='string'||!ID.test(fileId)) fail('Select a retained file request from this package');
  const directory=await merchantTicketDirectory(project);
  const raw=await readRequestFile(join(directory,'file-request-'+fileId+'.json'),1048576,{privateFile:true});
  if (hash(raw)!==fileId.slice(-64)) fail('Retained file request review changed');
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if (manifest.schema!==SCHEMA||typeof manifest.binding!=='string'||!plain(manifest.request)||!plain(manifest.review)||
      !Number.isSafeInteger(manifest.bodyBytes)||manifest.bodyBytes<1||manifest.bodyBytes>MAX_REQUEST_BODY_BYTES||!/^[0-9a-f]{64}$/.test(manifest.bodySha256)) fail('Invalid retained file request');
  return {directory,manifest};
}
export async function loadMerchantFileRequest(project,service,fileId) {
  const {directory,manifest}=await readManifest(project,fileId);
  const match=selected(service,manifest.binding,manifest.request);
  const raw=await readRequestFile(join(directory,'file-request-'+fileId.slice(0,36)+'.bin'),MAX_REQUEST_BODY_BYTES,{privateFile:true});
  if (raw.length!==manifest.bodyBytes||hash(raw)!==manifest.bodySha256) fail('Retained upload bytes changed');
  const preparedBody=await decodeMultipart(raw,manifest.request.headers['Content-Type'],match.route.offer.extensions.bazaar.schema.properties.input.properties.body);
  return {fileId,...manifest,preparedBody};
}
export async function listMerchantFileRequests(project) {
  const directory=await merchantTicketDirectory(project), rows=[];
  const names=(await readdir(directory)).filter(name=>name.startsWith('file-request-')&&name.endsWith('.json')).slice(-200);
  for (const name of names) {
    const fileId=name.slice(13,-5);
    try {const {manifest}=await readManifest(project,fileId);rows.push({fileId,binding:manifest.binding,createdAt:manifest.createdAt,bodyBytes:manifest.bodyBytes,bodySha256:manifest.bodySha256,files:manifest.review.files});}
    catch { /* Changed or incomplete private requests cannot be selected. */ }
  }
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
