import {createHash,randomUUID} from 'node:crypto';

export const OSF_RECORD_KINDS=['osf_sources','osf_responses','osf_mappings','osf_reviews','osf_native_plans','osf_adoptions','osf_comparisons','osf_deliveries','osf_drafts'];
export const OSF_SOURCE_SCHEMA='osf-project-source/v1';
export const OSF_API='https://api.osf.io/v2/';
export const sourceHash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:stable(value)).digest('hex');
export function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';}
export function problem(code,message,status=400,extra={}){throw Object.assign(new Error(message),{code,status,...extra});}
export const copy=value=>structuredClone(value);
export const link=value=>typeof value==='string'?value:value?.href??null;
export const guid=value=>{if(typeof value!=='string'||!/^[a-z0-9]{5,32}$/i.test(value))problem('OSF_ID_REQUIRED','Use the original OSF identifier.');return value;};
export const ref=(node,provider,file,version)=>[node,provider,file,version??'current-unversioned'].map(encodeURIComponent).join('/');
const cleanUrl=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)problem('OSF_SOURCE_URL','Use an original HTTPS source URL without embedded credentials.');if([...u.searchParams.keys()].some(k=>/token|authorization|view_only/i.test(k)))problem('OSF_SECRET_URL','Use an environment credential reference instead of a credential-bearing URL.');return u.href;};
const roles=new Set(['node','node-check','metadata','children','contributors','user','identifiers','addons','providers','files','file','file-check','versions','wiki-list','wiki','wiki-versions','wiki-content','logs','linked-nodes','registrations','preprints','license']);
const contentRoles=new Set(['wiki-content']);
function apiUrl(value){const u=new URL(cleanUrl(value));if(u.origin!=='https://api.osf.io'||!u.pathname.startsWith('/v2/'))problem('OSF_SOURCE_URL','JSON API responses must use the original production OSF API.');return u.href;}
function descriptor(value){
 const d=copy(value);if(!roles.has(d.role))problem('OSF_SOURCE_ROLE','Unknown source-response role.');
 d.node_id=guid(d.node_id);d.url=d.role==='metadata'?cleanUrl(d.url):apiUrl(d.url);
 const u=new URL(d.url);if(d.role==='metadata'&&(u.hostname!=='osf.io'||u.pathname!=='/metadata/'+d.node_id+'/'))problem('OSF_SOURCE_ID','Metadata URL and original project identity differ.');
 const nodeMatch=u.pathname.match(/^\/v2\/nodes\/([^/]+)\//);if(nodeMatch&&nodeMatch[1]!==d.node_id)problem('OSF_SOURCE_ID','Response URL and original component identity differ.');
 if(['node','node-check'].includes(d.role)&&u.pathname!=='/v2/nodes/'+d.node_id+'/')problem('OSF_SOURCE_ID','The original node response URL differs.');
 if(['versions','file','file-check'].includes(d.role)){if(!d.owner_id)problem('OSF_SOURCE_ID','Retain the original file identifier.');if(!u.pathname.startsWith('/v2/files/'+encodeURIComponent(d.owner_id)+'/'))problem('OSF_SOURCE_ID','File response and original file identity differ.');}
 d.id=d.id||'osf-response-'+sourceHash([d.role,d.node_id,d.owner_id??null,d.url,d.phase??null]).slice(0,32);
 return d;
}
function decodeBody(d,readAsset){
 if(d.body_base64!==undefined){if(typeof d.body_base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(d.body_base64))problem('OSF_INVALID_BYTES','A source body has invalid base64.');return Buffer.from(d.body_base64,'base64');}
 if(typeof d.body_text==='string')return Buffer.from(d.body_text);
 if(d.asset_id&&readAsset)return Buffer.from(readAsset(d.asset_id));
 if(d.body===undefined){if(d.error)return null;problem('OSF_ORIGINAL_BODY_REQUIRED','Supply the complete original response bytes.');}
 problem('OSF_ORIGINAL_BODY_REQUIRED','Use body_text or body_base64 so the captured response has exact original bytes.');
}
function checked(raw,meta,label){if(raw===null)return;if(meta.sha256&&sourceHash(raw)!==meta.sha256)problem('OSF_SOURCE_DIGEST',label+' differs from its recorded SHA256.');if(meta.bytes!==undefined&&meta.bytes!==null&&raw.length!==meta.bytes)problem('OSF_SOURCE_LENGTH',label+' differs from its recorded length.');}
function values(body){return Array.isArray(body?.data)?body.data:body?.data?[body.data]:[];}
function scalar(value){return value===null||value===undefined?null:typeof value==='string'?value:String(value);}
const meaning=r=>({id:r.id,type:r.type,attributes:r.attributes??{},relationships:r.relationships??{},links:r.links??{}});
function declaredTotal(body){const value=body?.meta?.total??body?.links?.meta?.total;return Number.isInteger(value)&&value>=0?value:null;}
function dataId(resource){if(!resource||typeof resource.id!=='string'||!resource.type)problem('OSF_RESOURCE_ID','An original API resource lacks its typed identity.');return resource.type+':'+resource.id;}
function listKey(d){const u=new URL(d.url);u.searchParams.delete('page');u.searchParams.delete('page[size]');return [d.role,d.node_id,d.owner_id??'',d.provider??'',u.href].join('|');}
export function decodeSource(input,{readAsset}={}){
 let raw,packet;
 if(typeof input==='string'||Buffer.isBuffer(input)){raw=Buffer.from(input);try{packet=JSON.parse(raw.toString('utf8'));}catch{problem('OSF_INVALID_SOURCE','Select a complete OSF source JSON document.');}}
 else {packet=copy(input);raw=Buffer.from(JSON.stringify(packet));}
 if(packet?.schema!==OSF_SOURCE_SCHEMA||!Array.isArray(packet.roots)||!packet.roots.length||!Array.isArray(packet.documents)||!Array.isArray(packet.files??[]))problem('OSF_INVALID_SOURCE','Use osf-project-source/v1 with original root IDs, documents and file entries.');
 const roots=[...new Set(packet.roots.map(guid))],documents=[],bodies=new Map(),seen=new Set();
 for(const value of packet.documents){
  const d=descriptor(value);if(seen.has(d.id))problem('OSF_DUPLICATE_RESPONSE','Original response identifiers must be unique.');seen.add(d.id);
  if(d.status!==null&&d.status!==undefined&&(!Number.isInteger(d.status)||d.status<100||d.status>599))problem('OSF_HTTP_STATUS','Retain the actual status or null when unavailable.');
  const bytes=decodeBody(d,readAsset);checked(bytes,d,'Original API response');
  let body=null;if(bytes&&!contentRoles.has(d.role)){try{body=JSON.parse(bytes.toString('utf8'));}catch{if(d.status>=200&&d.status<300)problem('OSF_INVALID_JSON','A successful metadata response is not complete JSON.');}}
  const {body_base64,body_text,asset_id,...metadata}=d;metadata.sha256=bytes?sourceHash(bytes):null;metadata.bytes=bytes?.length??null;
  documents.push({...metadata,body});if(bytes)bodies.set(d.id,bytes);
 }
 const inventory=inventoryFrom(documents,roots);
 const files=[],fileBodies=new Map(),fileKeys=new Set();
 for(const f of packet.files??[]){
  const key=ref(guid(f.node_id),String(f.provider),String(f.file_id),f.version_id??null);if(fileKeys.has(key))problem('OSF_DUPLICATE_FILE','The same original file version occurs twice.');fileKeys.add(key);
  const original=inventory.versions.find(x=>x.key===key);
  if(!original)problem('OSF_FILE_SOURCE_REQUIRED','A received file must match an original captured file/version record.');
  if(f.source_response_id&&f.source_response_id!==original.response_id)problem('OSF_FILE_SOURCE_ID','File bytes refer to a different original response.');
  let bytes;if(f.content_b64!==undefined)bytes=decodeBody({body_base64:f.content_b64});else if(f.asset_id&&readAsset)bytes=Buffer.from(readAsset(f.asset_id));else problem('OSF_FILE_BYTES_REQUIRED','Retain the complete selected file version.');
  checked(bytes,f,'Original file version');
  if(original.size!==null&&bytes.length!==original.size)problem('OSF_FILE_SIZE','The received file differs from its native version size.');
  const expected=original.hashes??{};
  for(const [algorithm,digest]of Object.entries(expected))if(['sha256','sha512','sha1','md5'].includes(algorithm.toLowerCase())&&typeof digest==='string'&&digest&&createHash(algorithm.toLowerCase()).update(bytes).digest('hex').toLowerCase()!==digest.toLowerCase())problem('OSF_FILE_DIGEST','The received file differs from the native '+algorithm+' digest.');
  const retained={key,node_id:original.node_id,provider:original.provider,file_id:original.file_id,version_id:original.version_id,name:original.name,path:original.path,media_type:f.media_type||'application/octet-stream',sha256:sourceHash(bytes),bytes:bytes.length,source_response_id:original.response_id,download_url:original.download_url};
  files.push(retained);fileBodies.set(key,bytes);
 }
 const supplied=new Set(files.map(x=>x.key));for(const version of inventory.versions)version.retained=supplied.has(version.key);
 const source={schema:OSF_SOURCE_SCHEMA,roots,created_at:packet.created_at??null,finished_at:packet.finished_at??null,source_mode:packet.source_mode??'original-response-import',collector:packet.collector??null,documents:documents.map(({body,...d})=>d),files,inventory,declared_findings:copy(packet.findings??[])};
 source.content_sha256=sourceHash({roots,documents:source.documents.map(d=>({id:d.id,role:d.role,node_id:d.node_id,owner_id:d.owner_id??null,url:d.url,status:d.status??null,sha256:d.sha256})),files});
 return {source,raw,bodies,fileBodies};
}
function versionDownload(file,record){
 const direct=link(record.links?.download);
 if(direct)return {download_url:cleanUrl(direct),download_basis:{type:'original-version-link',version_id:record.id}};
 if(!file.download_url)return {download_url:null,download_basis:null};
 const url=new URL(cleanUrl(file.download_url));
 // OSF documents the parent file link as WaterButler. Its singular version
 // parameter selects a historical body; plural versions is only metadata.
 if(url.origin!=='https://files.osf.io'||!url.pathname.startsWith('/v1/'))return {download_url:null,download_basis:null};
 for(const name of ['versions','revisions','meta','revision'])url.searchParams.delete(name);
 url.searchParams.set('version',String(record.id));
 return {download_url:url.href,download_basis:{type:'original-waterbutler-file-link',file_response_id:file.response_id,original_url:file.download_url,version_id:record.id}};
}
export function inventoryFrom(documents,roots){
 const nodes=new Map(),files=new Map(),versions=new Map(),wikis=new Map(),contributors=[],relations=[],logs=[],findings=[],listGroups=new Map(),beforeNodes=new Map(),afterNodes=new Map(),beforeFiles=new Map(),afterFiles=new Map(),userNames=new Map();
 const addFinding=(code,message,context={})=>findings.push({code,message,...context});
 for(const d of documents){
  if(d.error||d.status!==null&&d.status!==undefined&&(d.status<200||d.status>=300)){addFinding('SOURCE_RESPONSE_UNAVAILABLE','The original '+d.role+' response was unavailable.',{response_id:d.id,node_id:d.node_id,status:d.status??null,error:d.error??null});continue;}
  if(contentRoles.has(d.role))continue;
  const body=d.body;if(d.role==='metadata'){const n=nodes.get(d.node_id)??{id:d.node_id};n.datacite=copy(body);n.metadata_response_id=d.id;nodes.set(d.node_id,n);continue;}
  if(!body||(!Array.isArray(body.data)&&(!body.data||typeof body.data!=='object'))){addFinding('SOURCE_SHAPE','The original response has no JSON API data.',{response_id:d.id,node_id:d.node_id});continue;}
  if(Array.isArray(body.data)){
   const k=listKey(d),group=listGroups.get(k)??{role:d.role,node_id:d.node_id,pages:[],seen:new Set(),count:0,total:declaredTotal(body)};
   const total=declaredTotal(body);if(total!==null&&group.total!==null&&total!==group.total)addFinding('INVENTORY_CHANGED','The native total changed while paging.',{response_id:d.id,node_id:d.node_id});
   for(const r of body.data){const k=dataId(r);if(group.seen.has(k))addFinding('REPEATED_NATIVE_ID','A native identity occurs on more than one source page.',{response_id:d.id,native_id:k,node_id:d.node_id});group.seen.add(k);group.count++;}
   group.pages.push({id:d.id,url:d.url,next:link(body.links?.next),has_next:Object.hasOwn(body.links??{},'next')});listGroups.set(k,group);
  }
  for(const r of [...values(body),...(body.included??[])]){
   if(!r?.id||!r.type)continue;const a=r.attributes??{};
   if(r.type==='users'){userNames.set(r.id,a.full_name??a.name??null);}
  }
  for(const r of values(body)){
   const a=r.attributes??{};
   if(d.role==='node'||d.role==='node-check'){
    if(r.id!==d.node_id)problem('OSF_SOURCE_ID','The captured node body differs from its original URL.');
    if(d.role==='node-check'){afterNodes.set(r.id,r);continue;}
    beforeNodes.set(r.id,r);nodes.set(r.id,{...(nodes.get(r.id)??{}),id:r.id,title:a.title??r.id,description:a.description??'',public:a.public??null,category:a.category??null,date_created:a.date_created??null,date_modified:a.date_modified??null,current_user_permissions:copy(a.current_user_permissions??[]),tags:copy(a.tags??[]),license:copy(a.node_license??a.license??null),root:roots.includes(r.id),record:copy(r),response_id:d.id,parent_id:r.relationships?.parent?.data?.id??null});
   }else if(d.role==='children'){relations.push({type:'child',from:d.node_id,to:r.id,record:copy(r),response_id:d.id});}
   else if(d.role==='contributors'){contributors.push({node_id:d.node_id,id:r.id,user_id:r.relationships?.users?.data?.id??r.relationships?.user?.data?.id??null,bibliographic:a.bibliographic??null,permission:a.permission??null,index:a.index??null,unregistered_name:a.unregistered_contributor??null,record:copy(r),response_id:d.id});}
   else if(d.role==='files'||d.role==='file'){
    const provider=d.provider??a.provider??'osfstorage',key=ref(d.node_id,provider,r.id,null);
    beforeFiles.set(key,r);const prior=files.get(key);if(prior&&sourceHash(prior.record)!==sourceHash(r))addFinding('FILE_METADATA_CHANGED','Original file metadata changed during source capture.',{node_id:d.node_id,file_id:r.id,response_id:d.id});
    files.set(key,{node_id:d.node_id,provider,file_id:r.id,name:a.name??r.id,path:a.materialized_path??a.path??'',kind:a.kind??'file',size:Number.isSafeInteger(a.size)?a.size:null,current_version:a.current_version??null,date_modified:a.date_modified??null,hashes:copy(a.extra?.hashes??{}),download_url:link(r.links?.download),record:copy(r),response_id:d.id});
   }else if(d.role==='file-check'){afterFiles.set(ref(d.node_id,d.provider??a.provider??'osfstorage',r.id,null),r);
   }else if(d.role==='versions'){
    const f=[...files.values()].find(v=>v.node_id===d.node_id&&v.file_id===d.owner_id&&(d.provider?d.provider===v.provider:true));
    if(!f){addFinding('FILE_PARENT_MISSING','Version metadata has no original file entry.',{response_id:d.id,node_id:d.node_id,file_id:d.owner_id});continue;}
    const key=ref(f.node_id,f.provider,f.file_id,r.id);if(versions.has(key))problem('OSF_DUPLICATE_VERSION','An original file version identity occurs twice.');
    versions.set(key,{key,node_id:f.node_id,provider:f.provider,file_id:f.file_id,version_id:r.id,name:f.name,path:f.path,size:Number.isSafeInteger(a.size)?a.size:null,hashes:copy(a.extra?.hashes??a.hashes??{}),...versionDownload(f,r),record:copy(r),response_id:d.id,date_created:a.date_created??null});
   }else if(d.role==='wiki-list'||d.role==='wiki'){wikis.set(d.node_id+'/'+r.id,{node_id:d.node_id,id:r.id,name:a.name??r.id,record:copy(r),response_id:d.id});}
   else if(['wiki-versions','identifiers','addons','providers','linked-nodes','registrations','preprints','license'].includes(d.role))relations.push({type:d.role,from:d.node_id,owner_id:d.owner_id??null,to:r.id,record:copy(r),response_id:d.id});
   else if(d.role==='logs')logs.push({node_id:d.node_id,id:r.id,record:copy(r),response_id:d.id});
  }
 }
 for(const f of files.values())if(f.kind==='file'&&![...versions.values()].some(v=>v.node_id===f.node_id&&v.provider===f.provider&&v.file_id===f.file_id)){
  const key=ref(f.node_id,f.provider,f.file_id,null);versions.set(key,{...copy(f),key,version_id:null,version_basis:'current-file-response',retained:false});
  addFinding('VERSION_HISTORY_UNAVAILABLE','Only the captured current file has a source version basis.',{node_id:f.node_id,file_id:f.file_id,response_id:f.response_id});
 }
 for(const c of contributors)c.name=c.user_id?userNames.get(c.user_id)??c.unregistered_name??null:c.unregistered_name??null;
 for(const root of roots)if(!beforeNodes.has(root))addFinding('ROOT_NOT_CAPTURED','The selected original root metadata is absent.',{node_id:root});
 for(const relation of relations.filter(x=>x.type==='child')){const child=nodes.get(relation.to);if(child){if(child.parent_id&&child.parent_id!==relation.from)addFinding('PARENT_CHANGED','The component parent differs across source responses.',{node_id:relation.to});else child.parent_id=relation.from;}else addFinding('COMPONENT_NOT_CAPTURED','An original child component has no complete node capture.',{node_id:relation.to,parent_id:relation.from});}
 for(const [key,g]of listGroups){const urls=new Set(g.pages.map(p=>p.url));for(const p of g.pages){if(!p.has_next)addFinding('PAGE_TERMINATION_UNAVAILABLE','The original collection response does not declare its next page.',{response_id:p.id,node_id:g.node_id});if(p.next&&!urls.has(p.next))addFinding('NEXT_PAGE_MISSING','The original next-page response is absent.',{response_id:p.id,node_id:g.node_id,url:p.next});}if(g.total!==null&&g.total!==g.count)addFinding('INVENTORY_COUNT','Captured rows differ from the original declared total.',{node_id:g.node_id,role:g.role,expected:g.total,actual:g.count});}
 for(const [node,r]of beforeNodes){const last=afterNodes.get(node);if(!last)addFinding('FINAL_SOURCE_CHECK_ABSENT','No final node metadata observation was captured.',{node_id:node});else if(sourceHash(meaning(r))!==sourceHash(meaning(last)))addFinding('SOURCE_CHANGED_DURING_CAPTURE','The project metadata changed during capture.',{node_id:node});}
 for(const [key,r]of beforeFiles){if(r.attributes?.kind==='folder')continue;const last=afterFiles.get(key);const fingerprint=x=>Object.fromEntries(['name','path','materialized_path','size','date_modified','current_version'].map(k=>[k,x.attributes?.[k]??null]).concat([['hashes',x.attributes?.extra?.hashes??null]]));if(!last)addFinding('FINAL_FILE_CHECK_ABSENT','No final original file metadata was captured.',{file_id:r.id});else if(sourceHash(fingerprint(r))!==sourceHash(fingerprint(last)))addFinding('FILE_CHANGED_DURING_CAPTURE','The original file metadata changed while receiving.',{file_id:r.id});}
 return {nodes:[...nodes.values()],files:[...files.values()],versions:[...versions.values()],wikis:[...wikis.values()],contributors,relations,logs,findings,counts:{roots:roots.length,nodes:beforeNodes.size,files:[...files.values()].filter(f=>f.kind==='file').length,versions:versions.size,contributors:contributors.length,wikis:wikis.size,logs:logs.length},stable:!findings.some(x=>/CHANGED|REPEATED|COUNT|MISSING|NOT_CAPTURED|UNAVAILABLE|SHAPE|ABSENT/.test(x.code))};
}

export function createCollection(input){
 if(!Array.isArray(input.root_ids)||!input.root_ids.length)problem('OSF_ROOTS_REQUIRED','Select at least one original project or component.');
 const roots=[...new Set(input.root_ids.map(guid))],token_env=input.token_env??'';
 if(token_env&&!/^OSF_[A-Z0-9_]+$/.test(token_env))problem('OSF_CREDENTIAL_REFERENCE','Use an OSF_ environment variable name.');
 return {schema:OSF_SOURCE_SCHEMA,id:'osf-capture-'+sourceHash(input.operationId).slice(0,32),name:input.name||'OSF project capture',roots,created_at:new Date().toISOString(),finished_at:null,source_mode:'native-osf-jsonapi',collector:{version:1,api:OSF_API,recursive:input.recursive!==false,include_versions:input.include_versions!==false,download_files:input.download_files!==false,token_env,download_file_keys:Array.isArray(input.download_file_keys)?[...new Set(input.download_file_keys)]:null},tasks:roots.map(node_id=>({id:'node:'+node_id,role:'node',node_id,url:OSF_API+'nodes/'+node_id+'/',state:'PENDING'})),documents:[],files:[],findings:[],status:'RECEIVING'};
}
function queue(c,t){if(!c.tasks.some(x=>x.id===t.id))c.tasks.push({...t,state:'PENDING'});}
function queueRelationship(c,d,r,relationship,role,extra={}){
 const url=link(r.relationships?.[relationship]?.links?.related);if(url)queue(c,{id:role+':'+d.node_id+':'+(extra.owner_id??r.id),role,node_id:d.node_id,url,...extra});
}
function taskRecord(t){const {state,error,...d}=t;return d;}
function planAfter(c,t,body){
 if(Array.isArray(body?.data)&&link(body.links?.next))queue(c,{...taskRecord(t),id:t.id+':next:'+sourceHash(link(body.links.next)).slice(0,16),url:link(body.links.next),list_id:t.list_id??t.id});
 for(const r of values(body)){
  if(t.role==='node'){
   for(const [relationship,role]of [['children','children'],['contributors','contributors'],['files','providers'],['identifiers','identifiers'],['addons','addons'],['wikis','wiki-list'],['logs','logs'],['linked_nodes','linked-nodes'],['registrations','registrations'],['preprints','preprints']])queueRelationship(c,t,r,relationship,role);
   queue(c,{id:'metadata:'+r.id,role:'metadata',node_id:r.id,url:'https://osf.io/metadata/'+r.id+'/'});
   const license=link(r.relationships?.license?.links?.related);if(license)queue(c,{id:'license:'+r.id,role:'license',node_id:r.id,url:license});
  }else if(t.role==='children'&&c.collector.recursive)queue(c,{id:'node:'+r.id,role:'node',node_id:r.id,url:link(r.links?.self)||OSF_API+'nodes/'+r.id+'/'});
  else if(t.role==='contributors')for(const relationship of ['users','user'])queueRelationship(c,t,r,relationship,'user',{owner_id:r.id});
  else if(t.role==='providers'){
   const provider=r.attributes?.provider??r.id;
   const url=link(r.relationships?.files?.links?.related)||link(r.links?.storage);
   if(url)queue(c,{id:'files:'+t.node_id+':'+provider,role:'files',node_id:t.node_id,provider,url});
   else c.findings.push({code:'PROVIDER_FILES_LINK_ABSENT',node_id:t.node_id,provider,message:'The original provider has no readable file-list link.'});
  }else if(t.role==='files'||t.role==='file'){
   const provider=t.provider??r.attributes?.provider??'osfstorage';
   if(r.attributes?.kind==='folder'){
    const url=link(r.relationships?.files?.links?.related)||link(r.links?.self);if(url)queue(c,{id:'folder:'+t.node_id+':'+provider+':'+r.id,role:'files',node_id:t.node_id,provider,owner_id:r.id,url});
   }else if(c.collector.include_versions){
    const url=link(r.relationships?.versions?.links?.related);if(url)queue(c,{id:'versions:'+t.node_id+':'+provider+':'+r.id,role:'versions',node_id:t.node_id,provider,owner_id:r.id,url});
   }
  }else if(t.role==='wiki-list'){
   queue(c,{id:'wiki-content:'+t.node_id+':'+r.id,role:'wiki-content',node_id:t.node_id,owner_id:r.id,url:link(r.links?.download)||OSF_API+'wikis/'+r.id+'/content/'});
   if(c.collector.include_versions)queue(c,{id:'wiki-versions:'+t.node_id+':'+r.id,role:'wiki-versions',node_id:t.node_id,owner_id:r.id,url:link(r.relationships?.versions?.links?.related)||OSF_API+'wikis/'+r.id+'/versions/'});
  }else if(t.role==='wiki-versions')queue(c,{id:'wiki-content:'+t.node_id+':'+t.owner_id+':'+r.id,role:'wiki-content',node_id:t.node_id,owner_id:t.owner_id,version_id:r.id,url:link(r.links?.download)||OSF_API+'wikis/'+t.owner_id+'/versions/'+r.id+'/content/'});
 }
}
async function fetchBytes(url,{token='',maxBytes=32*1024*1024,fetchImpl=fetch}={}){
 let current=cleanUrl(url),result;
 const started_at=new Date().toISOString();
 for(let redirect=0;redirect<8;redirect++){
  const u=new URL(current),headers={Accept:'application/vnd.api+json, application/json, */*'};
  if(token&&u.origin==='https://api.osf.io')headers.Authorization='Bearer '+token;
  result=await fetchImpl(current,{headers,redirect:'manual',signal:AbortSignal.timeout(120000)});
  if([301,302,303,307,308].includes(result.status)&&result.headers.get('location')){const next=new URL(result.headers.get('location'),current);if(next.protocol!=='https:'||next.username||next.password)problem('OSF_REDIRECT','An original download redirected to an unsupported destination.');await result.body?.cancel();current=next.href;continue;}
  const declared=Number(result.headers.get('content-length')||0);if(declared>maxBytes){await result.body?.cancel();problem('OSF_FILE_LIMIT','Original file exceeds the current native receiving limit.',413,{declared_bytes:declared});}
  const chunks=[];let count=0;for await(const chunk of result.body??[]){count+=chunk.length;if(count>maxBytes){await result.body?.cancel().catch(()=>{});problem('OSF_FILE_LIMIT','Original response exceeds the selected native receiving limit.',413);}chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks,count),headersOut=Object.fromEntries(['content-type','content-length','etag','last-modified','date','content-disposition'].map(k=>[k,result.headers.get(k)]));
  return {bytes,status:result.status,started_at,received_at:new Date().toISOString(),response_url:current,headers:headersOut,media_type:result.headers.get('content-type')||'application/octet-stream'};
 }
 problem('OSF_REDIRECT','The original download exceeded its redirect limit.',502);
}
export async function collectSource(collection,{loadBody,save,saveFile,fetchImpl=fetch,maxFileBytes=20*1024*1024,onProgress=()=>{}}){
 const c=copy(collection),token=c.collector.token_env?process.env[c.collector.token_env]??'':'';
 if(c.collector.token_env&&!token)problem('OSF_CREDENTIAL_MISSING','Set the selected existing OSF credential in the server environment.',401);
 for(;;){
  const task=c.tasks.find(t=>t.state==='PENDING');if(!task)break;
  const d=descriptor(task);let received;
  try{
   received=await fetchBytes(d.url,{token,fetchImpl});
   d.status=received.status;d.started_at=received.started_at;d.received_at=received.received_at;d.response_url=received.response_url;d.response_headers=received.headers;d.sha256=sourceHash(received.bytes);d.bytes=received.bytes.length;d.content_type=received.media_type;
   if(d.status<200||d.status>=300)d.error='Original source returned HTTP '+d.status;
   else if(!contentRoles.has(d.role)){let body;try{body=JSON.parse(received.bytes.toString('utf8'));}catch{problem('OSF_INVALID_JSON','Original JSON API response was not JSON.',502);}if(d.role!=='metadata')planAfter(c,task,body);}
   c.documents.push(d);task.state=d.error?'FAILED':'COMPLETE';
   await save(c,d,received.bytes);
  }catch(error){
   if(c.documents.some(x=>x.id===d.id))throw error;
   d.status=received?.status??null;d.error=String(error.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]');task.state='FAILED';task.error=d.error;c.documents.push(d);await save(c,d,received?.bytes??null);
  }
  await onProgress({capture_id:c.id,pending:c.tasks.filter(x=>x.state==='PENDING').length,responses:c.documents.length,files:c.files.length});
 }
 if(!c.checked_nodes){
  for(const t of c.tasks.filter(x=>x.role==='node'&&x.state==='COMPLETE'))queue(c,{id:'node-check:'+t.node_id,role:'node-check',node_id:t.node_id,url:OSF_API+'nodes/'+t.node_id+'/'});
  c.checked_nodes=true;await save(c);return collectSource(c,{loadBody,save,saveFile,fetchImpl,maxFileBytes,onProgress});
 }
 const documents=c.documents.map(d=>{let body=null;const raw=loadBody(d.id);if(raw&&!contentRoles.has(d.role)){try{body=JSON.parse(raw.toString('utf8'));}catch{}}return {...d,body};});
 const inv=inventoryFrom(documents,c.roots);
 if(c.collector.download_file_keys?.some(k=>!inv.versions.some(v=>v.key===k)))c.findings.push({code:'SELECTED_VERSION_ABSENT',message:'A selected original file-version identity is absent from this capture.'});
 if(c.collector.download_files)for(const version of inv.versions){
  if(c.collector.download_file_keys&&!c.collector.download_file_keys.includes(version.key))continue;
  if(c.files.some(f=>f.key===version.key)||c.findings.some(f=>f.code==='FILE_RECEIVING_FAILED'&&f.key===version.key))continue;
  let committingFile=false;
  try{
   if(!version.download_url)problem('OSF_DOWNLOAD_LINK','The original version has no download link.');
   const response=await fetchBytes(version.download_url,{token,fetchImpl,maxBytes:maxFileBytes});
   if(response.status<200||response.status>=300)problem('OSF_DOWNLOAD_FAILED','Original file returned HTTP '+response.status,502);
   checked(response.bytes,{bytes:version.size},'Original version');
   for(const [algorithm,expected]of Object.entries(version.hashes??{}))if(['sha256','sha512','sha1','md5'].includes(algorithm.toLowerCase())&&expected&&createHash(algorithm.toLowerCase()).update(response.bytes).digest('hex').toLowerCase()!==String(expected).toLowerCase())problem('OSF_FILE_DIGEST','The native file-version hash differs.');
   const file={key:version.key,node_id:version.node_id,provider:version.provider,file_id:version.file_id,version_id:version.version_id,name:version.name,path:version.path,source_response_id:version.response_id,download_url:version.download_url,sha256:sourceHash(response.bytes),bytes:response.bytes.length,media_type:response.media_type,started_at:response.started_at,received_at:response.received_at};
   const candidate=copy(c);candidate.files.push(file);committingFile=true;
   await saveFile(candidate,file,response.bytes);c.files.push(file);
  }catch(error){if(committingFile)throw error;c.findings.push({code:'FILE_RECEIVING_FAILED',key:version.key,node_id:version.node_id,message:String(error.message||error)});await save(c);}
  await onProgress({capture_id:c.id,pending:0,responses:c.documents.length,files:c.files.length});
 }
 // A final node observation is made after file receiving, not just after metadata enumeration.
 if(!c.final_checks_after_files){
  c.final_checks_after_files=true;
  for(const t of c.tasks.filter(x=>x.role==='node'&&x.state==='COMPLETE')){
   queue(c,{id:'node-check:'+t.node_id+':final',role:'node-check',node_id:t.node_id,url:OSF_API+'nodes/'+t.node_id+'/'});
  }
  for(const f of inv.files.filter(x=>x.kind==='file')){const url=link(f.record.links?.self);if(url&&new URL(url).origin==='https://api.osf.io')queue(c,{id:'file-check:'+f.node_id+':'+f.provider+':'+f.file_id,role:'file-check',node_id:f.node_id,provider:f.provider,owner_id:f.file_id,url});}
  await save(c);return collectSource(c,{loadBody,save,saveFile,fetchImpl,maxFileBytes,onProgress});
 }
 c.finished_at=new Date().toISOString();c.status='CAPTURED';await save(c);return c;
}

export function osfBlobReferences(kind,value){
 if(kind==='osf_sources')return [value.raw_source?.sha256,...(value.documents??[]).map(d=>d.sha256),...(value.files??[]).map(f=>f.sha256)].filter(Boolean);
 if(kind==='osf_responses')return value.sha256?[value.sha256]:[];
 if(kind==='osf_deliveries')return (value.receiving_snapshot?.blobs??[]).map(b=>b.sha256);
 return [];
}
export function validateStoredOSFSource(source,readResponse){
 if(!Array.isArray(source.roots)||!source.roots.length)problem('OSF_HANDOVER_SOURCE','The original root selection is absent.');source.roots.forEach(guid);
 if(source.collector?.token_env&&!/^OSF_[A-Z0-9_]+$/.test(source.collector.token_env))problem('OSF_CREDENTIAL_REFERENCE','A retained source requires an OSF_ environment reference.');
 if(source.status!=='CAPTURED')return;
 const documents=(source.documents??[]).map(d=>{
  const r=readResponse(d.response_id||source.id+':'+d.id);
  if(r.record.source_id!==source.id||r.record.original_response_id!==d.id||r.record.sha256!==d.sha256)problem('OSF_HANDOVER_SOURCE','The retained original response and source identity differ.');
  let body=null;if(r.bytes&&d.role!=='wiki-content'){try{body=JSON.parse(r.bytes.toString('utf8'));}catch{}}
  return {...d,body};
 });
 const inventory=inventoryFrom(documents,source.roots),retained=new Set(source.files.map(f=>f.key));for(const v of inventory.versions)v.retained=retained.has(v.key);
 if(sourceHash(inventory)!==sourceHash(source.inventory))problem('OSF_HANDOVER_INVENTORY','The source inventory differs from its complete original responses.');
 const fingerprint=sourceHash({roots:source.roots,documents:source.documents.map(d=>({id:d.id,role:d.role,node_id:d.node_id,owner_id:d.owner_id??null,url:d.url,status:d.status??null,sha256:d.sha256})),files:source.files});
 if(fingerprint!==source.content_sha256)problem('OSF_HANDOVER_SOURCE','The original source content identity differs.');
 for(const f of source.files){const original=inventory.versions.find(v=>v.key===f.key);if(!original||f.source_response_id!==original.response_id||f.node_id!==original.node_id||f.file_id!==original.file_id||f.version_id!==original.version_id||f.provider!==original.provider||original.size!==null&&f.bytes!==original.size)problem('OSF_HANDOVER_FILE','A retained original file version differs from its source record.');}
}
