import { createHash } from 'node:crypto';
import { open, readFile, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_MANIFEST = 32 * 1024 * 1024;
const MAX_JSON = 64 * 1024 * 1024;
const MAX_ASSET = 1024 * 1024 * 1024;
const CHUNK = 2 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(value);
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class DestinationError extends Error {
  constructor(code, message, { status = 400, detail = null } = {}) { super(message); this.name = 'DestinationError'; this.code = code; this.status = status; this.detail = detail; }
}
const problem = (code,message,extra) => { throw new DestinationError(code,message,extra); };
export function normalizeDestinationConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) problem('destination_config','Configure one exact owned WordPress destination.');
  let url; try { url = new URL(value.baseUrl); } catch { problem('destination_url','Use the complete destination WordPress URL.'); }
  if (url.username || url.password || url.search || url.hash || !(['https:'].includes(url.protocol) || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) problem('destination_url','Use the exact HTTPS WordPress installation or an owned loopback runtime.');
  if (typeof value.username !== 'string' || !value.username.trim() || /[:\r\n\0]/.test(value.username)) problem('destination_user','Name the WordPress account authorized for this destination.');
  if (typeof value.credentialRef !== 'string' || !(/^(env:[A-Z_][A-Z0-9_]*|file:\/[^\0\r\n]+)$/.test(value.credentialRef))) problem('destination_credential','Use an env:NAME or file:/absolute/private/file credential reference.');
  const timeoutMs = value.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) problem('destination_timeout','Use a request timeout from 1 to 300 seconds.');
  return { baseUrl:url.href.replace(/\/$/,''),username:value.username.trim(),credentialRef:value.credentialRef,timeoutMs };
}
async function credential(config) {
  let secret;
  if (config.credentialRef.startsWith('env:')) secret = process.env[config.credentialRef.slice(4)];
  else {
    const path = config.credentialRef.slice(5);
    if (!isAbsolute(path)) problem('credential_file','Use an absolute private credential filename.');
    let handle; try { handle=await open(path,'r'); const stat=await handle.stat(); if(!stat.isFile()||stat.size>32768) problem('credential_file','The credential reference must name a small ordinary private file.'); secret=await handle.readFile('utf8'); } catch(error) { if(error instanceof DestinationError) throw error; problem('credential_unavailable','The selected private credential file could not be read.'); } finally { await handle?.close(); }
  }
  if (typeof secret !== 'string' || !secret.trim() || /[\0\r\n]/.test(secret.trim())) problem('credential_unavailable','Set the selected WordPress application-password reference before connecting.');
  return secret.trim();
}
async function boundedBytes(response,limit) {
  const pieces=[]; let size=0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) { size+=chunk.length; if(size>limit) problem('destination_response_size','The destination response exceeds its supported size.',{status:502}); pieces.push(Buffer.from(chunk)); }
  return Buffer.concat(pieces,size);
}
async function request(rawConfig,path,{method='GET',body,headers={}}={}) {
  const config=normalizeDestinationConfig(rawConfig),url=new URL(config.baseUrl+'/'); url.searchParams.set('rest_route','/cskt-migration/v1'+path);
  const password=await credential(config),auth=Buffer.from(config.username+':'+password).toString('base64');
  let response;
  try { response=await fetch(url,{method,redirect:'manual',headers:{Accept:'application/json',Authorization:'Basic '+auth,...headers,...(body!==undefined&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(config.timeoutMs)}); }
  catch { problem(method==='GET'?'destination_unreachable':'destination_response_interrupted',method==='GET'?'The selected WordPress destination could not be reached.':'The destination response was interrupted. Read the original release journal before repeating its stable operation.',{status:502,detail:{destination:config.baseUrl,path,method}}); }
  if(response.status>=300&&response.status<400) problem('destination_redirect','The WordPress destination redirected the authenticated request. Configure the exact installation URL before continuing.',{status:502,detail:{status:response.status}});
  const bytes=await boundedBytes(response,MAX_JSON); let result; try {result=JSON.parse(bytes.toString('utf8'));} catch {problem('destination_invalid_response','The selected URL did not return the WordPress migration plugin response.',{status:502,detail:{httpStatus:response.status,contentType:response.headers.get('content-type')}});}
  if(!response.ok)problem(result.code||'destination_rejected',result.message||'The destination rejected this request.',{status:response.status,detail:result.data?.detail??result.data??null});
  return result;
}
function originalManifest({manifestBytes,sha256}) {
  if(!(Buffer.isBuffer(manifestBytes)||manifestBytes instanceof Uint8Array)||manifestBytes.byteLength>MAX_MANIFEST||!validSha(sha256)||sha(manifestBytes)!==sha256)problem('manifest_identity','Provide the exact original release bytes and their SHA-256.');
  const bytes=Buffer.from(manifestBytes);let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{problem('manifest_json','The original release is not valid JSON.');}
  if(manifest.schema!=='cskt.migration.release.v1'||!validId(manifest.id)||!Array.isArray(manifest.items)||!Array.isArray(manifest.redirects))problem('manifest_schema','Use the complete reviewed CSKT migration release v1.');
  return {bytes,manifest,sha256};
}
export async function inspectDestination(config) { return request(config,'/inspect'); }
export async function previewRelease(config,input) { const {bytes,sha256}=originalManifest(input);return request(config,'/preview',{method:'POST',body:{manifestBase64:bytes.toString('base64'),sha256}}); }
export async function readbackRelease(config,{releaseId}) {if(!validId(releaseId))problem('release_id','Use the exact retained release ID.');return request(config,'/releases/'+encodeURIComponent(releaseId));}
export async function snapshotDestinationPost(config,{postId}) {if(!Number.isSafeInteger(postId)||postId<1)problem('native_post_id','Choose a positive native WordPress post ID.');return request(config,'/native/'+postId);}
export async function bindDestinationItem(config,input) {return request(config,'/bindings',{method:'POST',body:input});}

function privateAddress(address) {
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224;}
  const a=address.toLowerCase();if(a.startsWith('::ffff:')){const suffix=a.slice(7);if(isIP(suffix)===4)return privateAddress(suffix);const hex=suffix.split(':');if(hex.length===2&&hex.every(x=>/^[a-f0-9]{1,4}$/.test(x))){const n=parseInt(hex[0],16)*65536+parseInt(hex[1],16);return privateAddress([n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.'));}}return a==='::'||a==='::1'||a.startsWith('fc')||a.startsWith('fd')||/^fe[89ab]/.test(a)||a.startsWith('ff')||(a.startsWith('::ffff:')&&privateAddress(a.slice(7)));
}
async function sourceUrl(value) {
  let url;try{url=new URL(value);}catch{problem('asset_source_url','Use the complete reviewed source file URL.');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)problem('asset_source_url','The selected source asset must use its complete public HTTPS URL.');
  const host=url.hostname.replace(/^\[|\]$/g,'');let addresses;try{addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true});}catch{problem('asset_source_unreachable','The selected public source hostname could not be resolved.',{status:502,detail:{sourceUrl:url.href}});}
  if(!addresses.length||addresses.some(x=>privateAddress(x.address)))problem('asset_private_address','The reviewed source file resolves to a private or reserved network address. Select its observed public source URL.');
  return url;
}
async function downloadAsset(document,folder,timeoutMs) {
  let url=await sourceUrl(document.sourceUrl),response;
  for(let redirects=0;redirects<=5;redirects++){
    try{response=await fetch(url,{redirect:'manual',headers:{Accept:document.mimeType,'User-Agent':'CSKT-Reviewed-Migration/1.0'},signal:AbortSignal.timeout(Math.max(timeoutMs,120000))});}catch{problem('asset_source_unreachable','The selected original file response was interrupted.',{status:502,detail:{sourceUrl:document.sourceUrl}});}
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects===5)problem('asset_redirect','The original file redirect could not be resolved.',{status:502});url=await sourceUrl(new URL(location,url).href);continue;}break;
  }
  if(!response.ok) {await response.body?.cancel();problem('asset_source_http','The selected original file returned HTTP '+response.status+'.',{status:502,detail:{sourceUrl:document.sourceUrl,httpStatus:response.status}});}
  const contentType=response.headers.get('content-type')||'',mime=contentType.split(';')[0].trim().toLowerCase();
  if(mime!==document.mimeType.toLowerCase()){await response.body?.cancel();problem('asset_mime_mismatch','The actual file response type differs from the reviewed metadata. Select the captured original file URL.',{detail:{sourceUrl:document.sourceUrl,reviewed:document.mimeType,response:contentType}});}
  const sizeHeader=response.headers.get('content-length');if(sizeHeader&&Number(sizeHeader)>MAX_ASSET){await response.body?.cancel();problem('asset_too_large','The selected original file exceeds the 1 GiB destination limit.');}
  const file=join(folder,'source.asset'),handle=await open(file,'wx',0o600),hash=createHash('sha256');let bytes=0;
  try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX_ASSET)problem('asset_too_large','The selected original file exceeds the 1 GiB destination limit.');hash.update(chunk);let at=0;while(at<chunk.length){const written=await handle.write(chunk,at,chunk.length-at);if(!written.bytesWritten)problem('asset_spool_failed','The runtime could not retain the downloaded original file.');at+=written.bytesWritten;}}await handle.sync();}finally{await handle.close();}
  const digest=hash.digest('hex');if(!bytes)problem('asset_empty','The selected original file response was empty.');
  if(document.sha256&&digest!==document.sha256)problem('asset_capture_changed','The actual selected file differs from the approved source SHA-256.',{detail:{sourceUrl:document.sourceUrl,expectedSha256:document.sha256,actualSha256:digest}});
  if(document.bytes!==undefined&&bytes!==document.bytes)problem('asset_size_changed','The actual selected file byte count differs from the source capture.',{detail:{expectedBytes:document.bytes,actualBytes:bytes}});
  return {file,sha256:digest,bytes,sourceUrl:document.sourceUrl,finalUrl:url.href,responseContentType:contentType};
}
async function uploadAsset(config,releaseId,header,file) {
  const prefix='/releases/'+encodeURIComponent(releaseId)+'/assets';
  const staged=await request(config,prefix+'/begin',{method:'POST',body:header});
  if(staged.complete) return staged.asset;
  if(!Number.isSafeInteger(staged.offset)||staged.offset<0||staged.offset>header.bytes)problem('asset_upload_offset','The destination returned an invalid retained file offset.',{status:502});
  const handle=await open(file,'r');let position=0;const prefixHash=createHash('sha256');
  try{
    while(position<staged.offset){const block=Buffer.alloc(Math.min(CHUNK,staged.offset-position)),{bytesRead}=await handle.read(block,0,block.length,position);if(!bytesRead)problem('asset_spool_changed','The retained source file was truncated.');prefixHash.update(block.subarray(0,bytesRead));position+=bytesRead;}
    if(staged.offset&&prefixHash.digest('hex')!==staged.prefixSha256)problem('asset_upload_prefix_changed','The destination upload prefix differs from these exact original source bytes. Inspect its retained upload before continuing.',{status:409});
    while(position<header.bytes){const block=Buffer.alloc(Math.min(CHUNK,header.bytes-position)),{bytesRead}=await handle.read(block,0,block.length,position);if(!bytesRead)problem('asset_spool_changed','The retained source file was truncated.');const chunk=block.subarray(0,bytesRead),h={...header,offset:position,chunkSha256:sha(chunk)};const saved=await request(config,prefix+'/chunk',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-CSKT-Asset':Buffer.from(JSON.stringify(h)).toString('base64')},body:chunk});if(saved.offset!==position+bytesRead)problem('asset_upload_offset','The destination did not retain the expected complete file chunk.',{status:502});position=saved.offset;}
  }finally{await handle.close();}
  return request(config,prefix+'/commit',{method:'POST',body:header});
}
export async function applyRelease(rawConfig,input) {
  const config=normalizeDestinationConfig(rawConfig),{manifest,sha256}=originalManifest(input);
  if(!validId(input.operationId))problem('operation_id','Retain one stable operation ID before applying this release.');if(input.planSha256!==undefined&&!validSha(input.planSha256))problem('plan_hash','Use the exact displayed destination preview hash.');
  const state=await readbackRelease(config,{releaseId:manifest.id});
  if(state.sha256!==sha256)problem('release_hash_mismatch','The destination release ID belongs to different exact source bytes.',{status:409});
  if(!['APPLIED','ROLLED_BACK','PARTIALLY_ROLLED_BACK'].includes(state.status)){
    const existing=new Map(state.assets.map(x=>[x.itemId,x]));
    for(const item of manifest.items){
      if(!item.document||['remove','consolidate'].includes(item.disposition))continue;
      const retained=existing.get(item.id);if(retained){if(!retained.fileMatches)problem('native_asset_changed','The retained native attachment has changed. Restore its original bytes before applying.',{status:409,detail:{itemId:item.id,attachmentId:retained.attachmentId}});continue;}
      const folder=await mkdtemp(join(tmpdir(),'cskt-source-'));
      try{const downloaded=await downloadAsset(item.document,folder,config.timeoutMs);const header={manifestSha256:sha256,operationId:input.operationId,itemId:item.id,sourceUrl:downloaded.sourceUrl,finalUrl:downloaded.finalUrl,responseContentType:downloaded.responseContentType,sha256:downloaded.sha256,bytes:downloaded.bytes};await uploadAsset(config,manifest.id,header,downloaded.file);}finally{await rm(folder,{recursive:true,force:true});}
    }
  }
  return request(config,'/releases/'+encodeURIComponent(manifest.id)+'/apply',{method:'POST',body:{sha256,operationId:input.operationId,...(input.planSha256?{planSha256:input.planSha256}:{})}});
}
export async function rollbackRelease(config,{releaseId,operationId}) {if(!validId(releaseId)||!validId(operationId))problem('rollback_identity','Retain the exact release ID and a stable rollback operation ID.');return request(config,'/releases/'+encodeURIComponent(releaseId)+'/rollback',{method:'POST',body:{operationId}});}
