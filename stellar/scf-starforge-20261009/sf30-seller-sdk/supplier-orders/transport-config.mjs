// MIT. Explicit negotiated supplier HTTPS channels; credentials stay in the native host.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { clone, identifier } from '../opensearch/workspace/store.mjs';
import { data, digest, fail, object, text } from './core.mjs';

export const SUPPLIER_HTTPS_CONFIG_SCHEMA='stellar-forge.supplier-order-https-config.v1';
const OUTGOING=new Set(['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']);
const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER=/^[a-z][a-z0-9-]{0,63}$/;
const FORBIDDEN=new Set(['authorization','proxy-authorization','cookie','set-cookie','host','content-length','content-type','connection','transfer-encoding']);
const SHA=/^[a-f0-9]{64}$/;
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
function keys(value,allowed,label){
  if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('ORDER_TRANSPORT_CONFIG_INVALID','Keep only the declared '+label+' fields.');
}
function integer(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)fail('ORDER_TRANSPORT_CONFIG_INVALID',label+' is outside its declared bounds.');return value;}
function url(value){
  text(value,'Negotiated HTTPS URL',2048);let parsed;try{parsed=new URL(value);}catch{fail('ORDER_TRANSPORT_ENDPOINT_INVALID','Use the exact negotiated HTTPS URL.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.href!==value)
    fail('ORDER_TRANSPORT_ENDPOINT_INVALID','Use a canonical HTTPS URL without credentials, query parameters or fragments.');
  return value;
}
function header(value,label){if(typeof value!=='string'||!HEADER.test(value)||FORBIDDEN.has(value))fail('ORDER_TRANSPORT_HEADER_INVALID','Use a lowercase dedicated '+label+' header.');return value;}
function auth(value){
  keys(value,['type','usernameEnv','passwordEnv','tokenEnv'],'authentication');
  if(!['basic','bearer'].includes(value.type))fail('ORDER_TRANSPORT_AUTH_INVALID','Select the Basic or Bearer authentication agreed for this channel.');
  const selected=value.type==='basic'?['usernameEnv','passwordEnv']:['tokenEnv'];
  for(const key of selected)if(!NAME.test(value[key]??''))fail('ORDER_TRANSPORT_AUTH_INVALID','Declare the existing environment credential reference for '+key+'.');
  if(Object.keys(value).some(key=>key!=='type'&&!selected.includes(key)))fail('ORDER_TRANSPORT_AUTH_INVALID','Do not mix authentication schemes.');
  return Object.fromEntries(['type',...selected].map(key=>[key,value[key]]));
}
function publicAuth(value){return{type:value.type,credentialRefs:Object.entries(value).filter(([key])=>key!=='type').map(([,v])=>v)};}
function statuses(value,label){
  if(!Array.isArray(value)||value.length>50||new Set(value).size!==value.length)fail('ORDER_TRANSPORT_ACK_INVALID','Declare unique negotiated '+label+' HTTP statuses.');
  for(const n of value)integer(n,200,599,label+' status');
  return [...value].sort((a,b)=>a-b);
}
function tls(value,base){
  if(value===undefined)return{};
  keys(value,['caFile','certFile','keyFile'],'TLS');
  if(Boolean(value.certFile)!==Boolean(value.keyFile))fail('ORDER_TRANSPORT_TLS_INVALID','Select both client certificate and private key.');
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(base,text(v,'TLS file',4096))]));
}
function normalizedChannel(value,base){
  keys(value,['id','title','mode','supplierId','agreement','incoming','outgoing'],'channel');
  const id=identifier(value.id,'Channel ID'),title=text(value.title,'Channel title',200),supplierId=text(value.supplierId,'Original supplier identity',250);
  if(!['test','live'].includes(value.mode))fail('ORDER_TRANSPORT_MODE_REQUIRED','Declare test or live for this exact channel.');
  keys(value.agreement,['reference'],'negotiated agreement');
  const agreement={reference:text(value.agreement.reference,'Connection sheet or onboarding reference',2048)};
  const internal={id,title,mode:value.mode,supplierId,agreement},visible={...internal};
  if(value.incoming){
    keys(value.incoming,['url','auth','messageIdHeader','acknowledgment'],'incoming channel');
    const incoming=value.incoming,authentication=auth(incoming.auth),ack=incoming.acknowledgment;
    keys(ack,['statusCode','contentType','body'],'incoming acknowledgment');
    integer(ack.statusCode,200,299,'Successful intake acknowledgment');if(ack.statusCode===204&&ack.body)fail('ORDER_TRANSPORT_ACK_INVALID','HTTP 204 must have an empty body.');
    if(!['text/plain; charset=utf-8','application/json; charset=utf-8','application/xml; charset=utf-8','text/plain','application/json','application/xml'].includes(ack.contentType))
      fail('ORDER_TRANSPORT_ACK_INVALID','Declare the exact supported acknowledgment media type.');
    if(typeof ack.body!=='string'||Buffer.byteLength(ack.body)>65536)fail('ORDER_TRANSPORT_ACK_INVALID','Keep the complete agreed acknowledgment within 64 KiB.');
    const common={url:url(incoming.url),...(incoming.messageIdHeader?{messageIdHeader:header(incoming.messageIdHeader,'message identity')}:{}),acknowledgment:clone(ack)};
    internal.incoming={...common,auth:authentication};visible.incoming={...common,authentication:publicAuth(authentication)};
  }
  if(value.outgoing){
    keys(value.outgoing,['endpoints','auth','acknowledgment','timeoutMs','maxResponseBytes','tls','contentType'],'outgoing channel');
    const outgoing=value.outgoing;
    if(!object(outgoing.endpoints)||!Object.keys(outgoing.endpoints).length||Object.keys(outgoing.endpoints).some(k=>!OUTGOING.has(k)))fail('ORDER_TRANSPORT_ENDPOINT_INVALID','Declare the negotiated confirmation, dispatch and invoice endpoints.');
    const endpoints=Object.fromEntries(Object.entries(outgoing.endpoints).map(([kind,v])=>[kind,url(v)])),authentication=auth(outgoing.auth),ack=outgoing.acknowledgment;
    keys(ack,['acceptedStatusCodes','rejectedStatusCodes','receiptHeader','exactBodySha256'],'outgoing acknowledgment');
    const accepted=statuses(ack.acceptedStatusCodes,'accepted'),rejected=statuses(ack.rejectedStatusCodes,'definitely not accepted');
    if(!accepted.length||accepted.some(n=>n<200||n>299)||rejected.some(n=>n<400)||accepted.some(n=>rejected.includes(n)))
      fail('ORDER_TRANSPORT_ACK_INVALID','Successful statuses must be 2xx; explicitly negotiated rejection statuses must be 4xx or 5xx.');
    if(ack.exactBodySha256!==undefined&&!SHA.test(ack.exactBodySha256))fail('ORDER_TRANSPORT_ACK_INVALID','Use the exact negotiated response body SHA-256.');
    const acknowledgment={acceptedStatusCodes:accepted,rejectedStatusCodes:rejected,...(ack.receiptHeader?{receiptHeader:header(ack.receiptHeader,'provider receipt')}:{}),...(ack.exactBodySha256?{exactBodySha256:ack.exactBodySha256}:{})};
    const contentType=outgoing.contentType??'application/xml';if(!['application/xml','text/xml'].includes(contentType))fail('ORDER_TRANSPORT_MEDIA_INVALID','Select the negotiated raw XML media type.');
    const common={endpoints,contentType,acknowledgment,timeoutMs:integer(outgoing.timeoutMs??30000,1000,120000,'HTTPS timeout'),maxResponseBytes:integer(outgoing.maxResponseBytes??1048576,1,8388608,'Complete response limit')};
    internal.outgoing={...common,auth:authentication,tls:tls(outgoing.tls,base)};visible.outgoing={...common,authentication:publicAuth(authentication)};
  }
  if(!internal.incoming&&!internal.outgoing)fail('ORDER_TRANSPORT_CONFIG_INVALID','Declare at least one incoming or outgoing document channel.');
  visible.sha256=digest(visible);internal.sha256=visible.sha256;internal.public=visible;return freeze(internal);
}
export function normalizeSupplierOrderTransportConfig(value,{baseDirectory=process.cwd()}={}){
  keys(value,['schema','channels','intake'],'HTTPS configuration');
  if(value.schema!==SUPPLIER_HTTPS_CONFIG_SCHEMA||!Array.isArray(value.channels)||value.channels.length>100)
    fail('ORDER_TRANSPORT_CONFIG_INVALID','Select supplier-order-https-config.v1 with at most 100 declared channels.');
  data(value);const channels=value.channels.map(v=>normalizedChannel(v,baseDirectory));
  if(new Set(channels.map(c=>c.id)).size!==channels.length||new Set(channels.filter(c=>c.incoming).map(c=>c.incoming.url)).size!==channels.filter(c=>c.incoming).length)
    fail('ORDER_TRANSPORT_CONFIG_DUPLICATE','Keep unique channel IDs and incoming URLs.');
  let intake=null;
  if(value.intake){
    keys(value.intake,['host','port','certFile','keyFile'],'intake listener');
    intake={host:text(value.intake.host,'Listener host',250),port:integer(value.intake.port,1,65535,'HTTPS listener port'),
      certFile:resolve(baseDirectory,text(value.intake.certFile,'Server certificate file',4096)),
      keyFile:resolve(baseDirectory,text(value.intake.keyFile,'Server private-key file',4096))};
  }
  return freeze({schema:SUPPLIER_HTTPS_CONFIG_SCHEMA,channels,intake});
}
export async function readTransportFile(path,maximum=1048576,{privateFile=false}={}){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const first=await handle.stat();if(!first.isFile()||first.size<1||first.size>maximum||privateFile&&(first.mode&0o077))
      fail('ORDER_TRANSPORT_FILE_INVALID','Select a complete regular transport file with appropriate private permissions.');
    const body=await handle.readFile(),last=await handle.stat();
    if(body.length!==first.size||last.dev!==first.dev||last.ino!==first.ino||last.size!==first.size||last.mtimeMs!==first.mtimeMs||last.ctimeMs!==first.ctimeMs)
      fail('ORDER_TRANSPORT_FILE_CHANGED','The selected transport file changed during reading.',409);
    return body;
  }finally{await handle.close();}
}
export async function loadSupplierOrderTransportConfig(path){
  const body=await readTransportFile(resolve(path),1048576);
  let value;try{value=JSON.parse(body.toString('utf8'));}catch{fail('ORDER_TRANSPORT_CONFIG_INVALID','Select complete JSON for the HTTPS configuration.');}
  return normalizeSupplierOrderTransportConfig(value,{baseDirectory:dirname(resolve(path))});
}
export function authorization(value,environment=process.env){
  const read=key=>{const raw=environment[value[key]];if(typeof raw!=='string'||!raw.length||raw.length>8192||/[\r\n\0]/.test(raw))fail('ORDER_TRANSPORT_CREDENTIAL_REQUIRED','The configured host credential is unavailable or invalid.',503);return raw;};
  if(value.type==='bearer'){const token=read('tokenEnv');if(!/^[A-Za-z0-9\-._~+/]+=*$/.test(token))fail('ORDER_TRANSPORT_CREDENTIAL_REQUIRED','The configured Bearer credential is invalid.',503);return'Bearer '+token;}
  const username=read('usernameEnv'),password=read('passwordEnv');if(username.includes(':'))fail('ORDER_TRANSPORT_CREDENTIAL_REQUIRED','The configured Basic username contains a colon.',503);
  return'Basic '+Buffer.from(username+':'+password,'utf8').toString('base64');
}
export function authenticateTransport(received,auth){
  const value=typeof received==='string'?received:'',match=/^(Basic|Bearer)[ \t]+(.+)$/i.exec(value);
  const normalized=match?(match[1].toLowerCase()==='basic'?'Basic':'Bearer')+' '+match[2]:value;
  const expected=Buffer.from(authorization(auth)),actual=Buffer.from(normalized);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export async function transportTlsFiles(configuration={}){
  const selected={};
  if(configuration.caFile)selected.ca=await readTransportFile(configuration.caFile);
  if(configuration.certFile)selected.cert=await readTransportFile(configuration.certFile);
  if(configuration.keyFile)selected.key=await readTransportFile(configuration.keyFile,1048576,{privateFile:true});
  return selected;
}
