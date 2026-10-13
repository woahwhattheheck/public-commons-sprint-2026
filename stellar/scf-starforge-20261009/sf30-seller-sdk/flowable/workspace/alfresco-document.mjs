// MIT. Original Alfresco selected-version reads and complete byte custody.
import {createHash} from 'node:crypto';
import {readFlowableLosslessJSON} from '../native.mjs';
import {parseInterfaceJSON} from './interface-contract-v2.mjs';
export const ALFRESCO_DOCUMENT_SCHEMA='stellar-forge.alfresco-document-capture.v1';
export const ALFRESCO_LIMITS=Object.freeze({content:4*1024*1024,metadata:1024*1024,historyPage:256*1024,pages:32,packet:16*1024*1024});
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'ALFRESCO_DOCUMENT_REVIEW_REQUIRED'});};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const str=(x,n=2000)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\u0000-\u001f\u007f]/.test(x);
const canon=x=>JSON.stringify(x&&typeof x==='object'?(Array.isArray(x)?x.map(v=>JSON.parse(canon(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canon(x[k]))]))):x);
export function documentMember(name,bytes,mediaType='application/json'){
 const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8');
 need(b.length<=ALFRESCO_LIMITS.packet,'Complete source exceeds 16 MiB');
 return{name,bytes:b.length,sha256:sha(b),mediaType,contentBase64:b.toString('base64')};
}
export function documentBytes(member,maximum=ALFRESCO_LIMITS.packet){
 need(plain(member)&&Number.isSafeInteger(member.bytes)&&member.bytes>=0&&member.bytes<=maximum&&/^[a-f0-9]{64}$/.test(member.sha256??'')&&typeof member.contentBase64==='string'&&member.contentBase64.length<=Math.ceil(maximum/3)*4,'Invalid bounded full source');
 const b=Buffer.from(member.contentBase64,'base64');
 need(b.toString('base64')===member.contentBase64&&b.length===member.bytes&&sha(b)===member.sha256,'Complete source byte identity changed');
 return b;
}
export function documentJSON(member,maximum=ALFRESCO_LIMITS.metadata){
 return parseInterfaceJSON(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(documentBytes(member,maximum)),'Alfresco original JSON');
}

export function exactDocumentInteger(value,label,minimum=0,maximum=Number.MAX_SAFE_INTEGER){
 need(plain(value)&&typeof value.number==='string'&&/^(?:0|-?[1-9][0-9]{0,15})$/.test(value.number)&&typeof value.exponent==='string'&&/^(?:0|[1-9][0-9]?)$/.test(value.exponent),label+' must be an exact bounded integer');
 const exponent=Number(value.exponent);need(exponent<=16,label+' exponent exceeds integer bound');
 const n=BigInt(value.number)*10n**BigInt(exponent);need(n>=BigInt(minimum)&&n<=BigInt(maximum),label+' is outside the exact supported range');return Number(n);
}
export function documentLosslessJSON(member,maximum=ALFRESCO_LIMITS.metadata){
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(documentBytes(member,maximum));
 parseInterfaceJSON(text,'Alfresco original JSON');
 return readFlowableLosslessJSON(text);
}

export function normalizeAlfrescoRepository(value){
 need(plain(value)&&Object.keys(value).every(k=>['id','baseUrl','usernameEnv','passwordEnv'].includes(k)),'Supply the selected repository and credential environment names');
 need(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(value.id??''),'Select a named repository');
 const u=new URL(value.baseUrl);need(!u.username&&!u.password&&!u.search&&!u.hash,'Repository URL cannot contain credentials/query/fragment');
 need(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname),'Use HTTPS or an explicit loopback repository');
 u.pathname=u.pathname.replace(/\/+$/,'');
 need(u.pathname.endsWith('/alfresco/api/-default-/public/alfresco/versions/1'),'Select the original Alfresco REST v1 base URL');
 for(const k of ['usernameEnv','passwordEnv'])need(/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(value[k]??''),'Select '+k);
 return{...value,baseUrl:u.href};
}
function component(value,label){need(str(value,200)&&!['.','..'].includes(value)&&!/[\/\\]/.test(value),label+' must be one original path component');return encodeURIComponent(value);}
function repositoryIdentity(v){const c=normalizeAlfrescoRepository({...v,usernameEnv:'SELECTED_USER',passwordEnv:'SELECTED_PASSWORD'});return{id:c.id,baseUrl:c.baseUrl};}
function metadata(read,nodeId,versionId){
 const j=documentJSON(read.body),v=j.entry;
 need(plain(v)&&v.id===versionId&&v.isFile===true&&v.isFolder===false&&str(v.name)&&str(v.nodeType)&&str(v.modifiedAt),'Select a file version with the exact original label');
 need(plain(v.modifiedByUser),'Selected version lacks original modifying-user metadata');
 if(v.content?.sizeInBytes!==undefined)need(exactDocumentInteger(documentLosslessJSON(read.body).entry.content.sizeInBytes,'Selected content size')===v.content.sizeInBytes,'Content size lost original precision');
 return v;
}
export function inspectAlfrescoDocument(packetText){
 need(typeof packetText==='string'&&Buffer.byteLength(packetText)<=ALFRESCO_LIMITS.packet,'Document capture exceeds 16 MiB');
 const p=JSON.parse(packetText);need(p.schema===ALFRESCO_DOCUMENT_SCHEMA&&p.state==='CAPTURED'&&plain(p.selection),'Select a completed original document capture');
 const repository=repositoryIdentity(p.repository),{nodeId,versionId}=p.selection,nodePath='/nodes/'+component(nodeId,'nodeId'),versionPath=nodePath+'/versions/'+component(versionId,'versionId');
 need(Array.isArray(p.reads)&&p.reads.length>=4&&p.reads.length<=ALFRESCO_LIMITS.pages+4,'Invalid retained request count');
 const roles=new Map();for(const r of p.reads){
  need(str(r.role)&&!roles.has(r.role)&&r.status===200&&plain(r.headers)&&str(r.startedAt)&&str(r.completedAt),'Each source read must be a unique complete HTTP 200');
  need(!r.headers['content-range'],'Partial content cannot be received as a complete original');
  documentBytes(r.body,r.role==='content'?ALFRESCO_LIMITS.content:r.role.startsWith('versions:')?ALFRESCO_LIMITS.historyPage:ALFRESCO_LIMITS.metadata);
  roles.set(r.role,r);
 }
 for(const [role,path]of [['node',nodePath+'?include=properties%2CaspectNames'],['selected-before',versionPath],['content',versionPath+'/content?attachment=true'],['selected-after',versionPath]]){
  need(roles.has(role)&&roles.get(role).url===repository.baseUrl+path,'Original selected request differs: '+role);
 }
 const node=documentJSON(roles.get('node').body).entry;need(node?.id===nodeId&&node.isFile===true,'Original node differs from the selected file');
 const before=metadata(roles.get('selected-before'),nodeId,versionId),after=metadata(roles.get('selected-after'),nodeId,versionId);
 // Exact retained response bytes avoid silently treating rounded numeric metadata as equal.
 need(roles.get('selected-before').body.sha256===roles.get('selected-after').body.sha256,'Selected version metadata changed during pickup; retain the failed capture and select a fresh attempt');
 const content=documentBytes(roles.get('content').body,ALFRESCO_LIMITS.content);
 if(before.content?.sizeInBytes!==undefined)need(before.content.sizeInBytes===content.length,'Selected version size differs from the complete content');
 let offset=0,total=null,selectedSeen=false,terminal=false;const seen=new Set(),pages=[];
 for(let i=0;i<ALFRESCO_LIMITS.pages;i++){
  const role='versions:'+i,r=roles.get(role);if(!r)break;
  need(!terminal&&r.url===repository.baseUrl+nodePath+'/versions?include=properties%2CaspectNames&skipCount='+offset+'&maxItems=100','History page order or original request changed');
  const list=documentJSON(r.body,ALFRESCO_LIMITS.historyPage).list,q=list?.pagination,exactPagination=documentLosslessJSON(r.body,ALFRESCO_LIMITS.historyPage).list?.pagination;
  for(const field of ['count','skipCount','maxItems','totalItems'])if(q?.[field]!==undefined)need(exactDocumentInteger(exactPagination?.[field],'History '+field)===q[field],'History number lost original precision');
  need(Array.isArray(list?.entries)&&plain(q)&&q.count===list.entries.length&&q.skipCount===offset&&q.maxItems===100&&typeof q.hasMoreItems==='boolean','Invalid original history pagination');
  need(q.count<=100&&Number.isSafeInteger(q.count),'Invalid history page count');
  if(q.totalItems!==undefined){need(Number.isSafeInteger(q.totalItems)&&q.totalItems>=0,'Invalid exact history total');if(total!==null)need(q.totalItems===total,'History total changed while paging');total=q.totalItems;}
  for(const row of list.entries){need(str(row.entry?.id)&&!seen.has(row.entry.id),'History moved or repeats a version label; select a new capture');seen.add(row.entry.id);if(row.entry.id===versionId)selectedSeen=true;}
  pages.push({role,offset,count:q.count,hasMoreItems:q.hasMoreItems,totalItems:q.totalItems??null,sha256:r.body.sha256});offset+=q.count;
  if(!q.hasMoreItems){terminal=true;break;}need(q.count>0,'Nonadvancing history pagination');
 }
 need(terminal&&selectedSeen&&roles.size===4+pages.length,'Selected version must be present in the complete observed page sequence');
 if(total!==null)need(offset===total,'Observed history count differs from its original total');
 return{schema:ALFRESCO_DOCUMENT_SCHEMA,repository,selection:{nodeId,versionId},node,version:before,content:roles.get('content').body,
  capture:{bytes:Buffer.byteLength(packetText),sha256:sha(packetText)},history:{pages,observedVersions:offset,consistency:'Observed offset pages; not an atomic history snapshot'},
  consistency:'Exact selected metadata matched before and after content pickup. This does not prove an atomic server snapshot or prevent an intervening replacement.'};
}
export async function captureAlfrescoDocument({repository,nodeId,versionId,environment=process.env,fetch:fetcher=globalThis.fetch,signal}){
 const c=normalizeAlfrescoRepository(repository),nodePath='/nodes/'+component(nodeId,'nodeId'),versionPath=nodePath+'/versions/'+component(versionId,'versionId');
 need(typeof fetcher==='function','Supply the existing fetch transport');
 const username=environment[c.usernameEnv],password=environment[c.passwordEnv];need(typeof username==='string'&&username.length&&typeof password==='string'&&password.length&&!username.includes(':'),'Selected repository credentials are absent');
 const packet={schema:ALFRESCO_DOCUMENT_SCHEMA,state:'READING',repository:{id:c.id,baseUrl:c.baseUrl},selection:{nodeId,versionId},reads:[]};
 async function read(role,path,maximum){
  signal?.throwIfAborted();const startedAt=new Date().toISOString(),url=c.baseUrl+path;
  const response=await fetcher(url,{method:'GET',redirect:'error',headers:{authorization:'Basic '+Buffer.from(username+':'+password).toString('base64'),accept:role==='content'?'*/*':'application/json','accept-encoding':'identity'},signal});
  const parts=[];let length=0;for await(const chunk of response.body??[]){signal?.throwIfAborted();const b=Buffer.from(chunk);length+=b.length;if(length>maximum){await response.body?.cancel?.().catch(()=>{});throw Error('Original '+role+' exceeds its declared byte limit');}parts.push(b);}
  const headers={};for(const key of ['content-type','content-range','content-length','etag','last-modified']){const v=response.headers.get(key);if(v!==null)headers[key]=v;}
  const result={role,url,status:response.status,headers,startedAt,completedAt:new Date().toISOString(),body:documentMember(role,Buffer.concat(parts),headers['content-type']??'application/octet-stream')};packet.reads.push(result);
  need(response.status===200&&!headers['content-range'],'Alfresco '+role+' returned '+response.status+'; full 200 required, no fallback to current content');
  need(Buffer.byteLength(JSON.stringify(packet))<=ALFRESCO_LIMITS.packet,'Complete source capture exceeds 16 MiB');
  return result;
 }
 try{
  await read('node',nodePath+'?include=properties%2CaspectNames',ALFRESCO_LIMITS.metadata);
  let offset=0,terminal=false;
  for(let i=0;i<ALFRESCO_LIMITS.pages;i++){
   const r=await read('versions:'+i,nodePath+'/versions?include=properties%2CaspectNames&skipCount='+offset+'&maxItems=100',ALFRESCO_LIMITS.historyPage),j=documentJSON(r.body,ALFRESCO_LIMITS.historyPage),q=j.list?.pagination;
   need(Number.isSafeInteger(q?.count)&&q.count===j.list?.entries?.length&&q.skipCount===offset&&typeof q.hasMoreItems==='boolean','Original history page is incomplete');
   offset+=q.count;if(!q.hasMoreItems){terminal=true;break;}need(q.count>0,'Original history page did not advance');
  }
  need(terminal,'History exceeds the 32-page selected capture bound');
  await read('selected-before',versionPath,ALFRESCO_LIMITS.metadata);
  await read('content',versionPath+'/content?attachment=true',ALFRESCO_LIMITS.content);
  await read('selected-after',versionPath,ALFRESCO_LIMITS.metadata);
  packet.state='CAPTURED';const text=JSON.stringify(packet,null,2)+'\n';inspectAlfrescoDocument(text);return{packet,text,bytes:Buffer.byteLength(text),sha256:sha(text)};
 }catch(error){packet.state='CAPTURE_FAILED';packet.failure={message:error.message,code:error.code??'ALFRESCO_CAPTURE_FAILED'};error.capture=packet;throw error;}
}
