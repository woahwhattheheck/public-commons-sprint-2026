import {sourceHash,stable,copy,problem,decodeSource,inventoryFrom,createCollection,collectSource,ref,link} from './osf_source.mjs';
import {freezeReceivingRecords} from './osf_transfer.mjs';

export const OSF_KINDS=['osf_sources','osf_responses','osf_mappings','osf_reviews','osf_native_plans','osf_adoptions','osf_comparisons','osf_deliveries','osf_drafts'];
const text=(value,label,max=6000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)problem('OSF_TEXT_REQUIRED',label+' is required and must be at most '+max+' characters.');return value.trim();};
const id=(prefix,operation)=>prefix+'-'+sourceHash(operation).slice(0,32);
const at=()=>new Date().toISOString();
const safe=(value,max=220)=>String(value).replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(0,max)||'original';
const pathField=f=>f.replace(/~/g,'~0').replace(/\//g,'~1');
const value=v=>({value:String(v),language:null,authority:null,confidence:-1});
const jsonFile=(name,record)=>({filename:name,contentType:'application/json',bytes:Buffer.from(JSON.stringify(record,null,2)+'\n')});
function metadata(value){
 if(!value||typeof value!=='object'||Array.isArray(value))problem('OSF_METADATA','Use a metadata field object with complete value arrays.');
 const out={};for(const [field,entries]of Object.entries(value)){if(!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/.test(field)||!Array.isArray(entries)||entries.some(v=>!v||typeof v!=='object'||Array.isArray(v)||typeof v.value!=='string'))problem('OSF_METADATA','Each DSpace field must contain an array of original value objects.');out[field]=copy(entries);}
 return out;
}
function items(source,node){return source.inventory.versions.filter(f=>f.node_id===node);}
function nodeFingerprint(source,nodeId){
 const node=source.inventory.nodes.find(n=>n.id===nodeId);if(!node)problem('OSF_NODE_MISSING','The selected original component is absent.');
 return sourceHash({node,contributors:source.inventory.contributors.filter(c=>c.node_id===nodeId),relations:source.inventory.relations.filter(r=>r.from===nodeId),versions:items(source,nodeId)});
}
export function defaultMetadata(source,nodeId){
 const n=source.inventory.nodes.find(n=>n.id===nodeId);if(!n)problem('OSF_NODE_MISSING','Choose a captured original component.');
 const m={'dc.title':[value(n.title)],'dc.identifier.uri':[value('https://osf.io/'+n.id+'/')]};
 if(n.description)m['dc.description.abstract']=[value(n.description)];
 if(n.date_created)m['dc.date.created']=[value(n.date_created)];
 if(n.tags?.length)m['dc.subject']=n.tags.map(value);
 if(n.parent_id)m['dc.relation.ispartof']=[value('https://osf.io/'+n.parent_id+'/')];
 const children=source.inventory.relations.filter(r=>r.type==='child'&&r.from===nodeId);if(children.length)m['dc.relation.haspart']=children.map(r=>value('https://osf.io/'+r.to+'/'));
 const authors=source.inventory.contributors.filter(c=>c.node_id===nodeId&&c.bibliographic===true&&c.name).sort((a,b)=>(a.index??1e9)-(b.index??1e9));if(authors.length)m['dc.contributor.author']=authors.map(c=>value(c.name));
 m['dc.description.provenance']=[value('Original OSF project/component '+nodeId+'; source capture '+source.id+'. Full source responses, contributor permissions, license data, file versions and component relationships accompany the institutional handover.')];
 return m;
}
function summary(kind,v){
 const names={osf_sources:['id','name','status','created_at','finished_at','roots','counts','content_sha256','findings_count'],osf_mappings:['id','name','source_id','source_sha256','profile_id','created_at','previous_mapping_id','entry_count','continue_count','mapping_sha256'],osf_reviews:['id','mapping_id','mapping_sha256','decision','actor','created_at'],osf_native_plans:['id','mapping_id','phase','plan_id','created_at','step_count','remaining_steps'],osf_adoptions:['id','mapping_id','plan_id','execution_id','created_at','accepted_steps','pending_steps'],osf_comparisons:['id','mapping_id','source_id','incoming_source_id','created_at','conflict_count'],osf_deliveries:['id','mapping_id','name','state','created_at','manifest_sha256'],osf_drafts:['id','context','name','created_at','previous_draft_id']};
 const fields=names[kind];return fields?Object.fromEntries(fields.map(k=>[k,v[k]])):v;
}
export class OSFTransition {
 constructor(workspace){this.ws=workspace;this.store=workspace.store;}
 get(kind,key){return this.store.get(kind,key);}
 put(kind,v){this.store.put(kind,v.id,v,summary(kind,v));return v;}
 state(){return Object.fromEntries(OSF_KINDS.filter(k=>k!=='osf_responses').map(k=>[k,this.store.list(k)]));}
 commit(input,fn){return this.store.tx(()=>{const result=fn(),op=this.store.get('operations',input.operationId);op.osf_result=copy(result);this.store.put('operations',op.id,op);return result;});}
 resume(action,input,op){if(op.osf_result)return copy(op.osf_result);return this.perform(action,input);}
 async perform(action,input){
  switch(action){
   case 'osf-import-source':return this.importSource(input);
   case 'osf-capture':return this.capture(input);
   case 'osf-save-mapping':return this.saveMapping(input);
   case 'osf-review-mapping':return this.review(input);
   case 'osf-prepare-native':return this.prepareNative(input);
   case 'osf-adopt-execution':return this.adopt(input);
   case 'osf-compare':return this.compare(input);
   case 'osf-reconcile':return this.reconcile(input);
   case 'osf-freeze-delivery':return this.delivery(input);
   case 'osf-save-draft':return this.saveDraft(input);
   default:problem('OSF_ACTION','Unknown OSF transition action.',404);
  }
 }
 importSource(input){
  let raw;if(typeof input.content_b64==='string')raw=Buffer.from(input.content_b64,'base64');else if(typeof input.source_text==='string')raw=Buffer.from(input.source_text);else problem('OSF_SOURCE_REQUIRED','Select the complete original source JSON.');
  const decoded=decodeSource(raw,{readAsset:assetId=>{const asset=this.get('assets',assetId);return this.store.bytes(asset.sha256);}});
  const source={...decoded.source,id:id('osf-source',input.operationId),name:text(input.name||input.filename||'Imported OSF source','Source name',240),status:'CAPTURED',created_at:at(),original_created_at:decoded.source.created_at,previous_source_id:input.previous_source_id??null};
  if(source.previous_source_id){const old=this.get('osf_sources',source.previous_source_id);if(stable(old.roots)!==stable(source.roots))problem('OSF_ROOT_CHANGED','A successor capture must retain the selected original roots.');}
  return this.commit(input,()=>{
   source.raw_source=this.store.blob(raw);
   for(const d of source.documents){const bytes=decoded.bodies.get(d.id),response={...d,id:source.id+':'+d.id,original_response_id:d.id,source_id:source.id};if(bytes){const blob=this.store.blob(bytes);response.sha256=blob.sha256;response.bytes=blob.bytes;}this.put('osf_responses',response);d.response_id=response.id;}
   for(const f of source.files)this.store.blob(decoded.fileBodies.get(f.key));
   source.counts=source.inventory.counts;source.findings_count=source.inventory.findings.length+source.declared_findings.length;this.put('osf_sources',source);
   return {source_id:source.id,content_sha256:source.content_sha256,counts:source.counts,findings:source.findings_count};
  });
 }
 async capture(input){
  const sourceId=id('osf-capture',input.operationId);let capture=this.store.maybe('osf_sources',sourceId);
  if(!capture){capture=createCollection(input);if(input.previous_source_id){const old=this.get('osf_sources',input.previous_source_id);if(stable(old.roots)!==stable(capture.roots))problem('OSF_ROOT_CHANGED','A successor capture must retain its original roots.');}capture.previous_source_id=input.previous_source_id??null;this.store.tx(()=>this.put('osf_sources',capture));}
  const persist=(c,d,bytes)=>this.store.tx(()=>{
   if(d){const record={...copy(d),id:c.id+':'+d.id,original_response_id:d.id,source_id:c.id};if(bytes){const blob=this.store.blob(bytes);record.sha256=blob.sha256;record.bytes=blob.bytes;}this.put('osf_responses',record);}
   this.put('osf_sources',c);
  });
  const c=await collectSource(capture,{loadBody:responseId=>{const r=this.store.maybe('osf_responses',sourceId+':'+responseId);return r?.sha256?this.store.bytes(r.sha256):null;},save:persist,saveFile:(c,file,bytes)=>this.store.tx(()=>{this.store.blob(bytes);this.put('osf_sources',c);})});
  const documents=c.documents.map(d=>{const r=this.get('osf_responses',c.id+':'+d.id);let body=null;if(r.sha256&&d.role!=='wiki-content'){try{body=JSON.parse(this.store.bytes(r.sha256));}catch{}}return {...d,body};});
  const inventory=inventoryFrom(documents,c.roots),retained=new Set(c.files.map(f=>f.key));for(const v of inventory.versions)v.retained=retained.has(v.key);
  return this.commit(input,()=>{
   const source={...c,documents:c.documents.map(d=>({...d,response_id:c.id+':'+d.id})),inventory,counts:inventory.counts,declared_findings:c.findings,findings_count:inventory.findings.length+c.findings.length};
   source.content_sha256=sourceHash({roots:source.roots,documents:source.documents.map(d=>({id:d.id,role:d.role,node_id:d.node_id,owner_id:d.owner_id??null,url:d.url,status:d.status??null,sha256:d.sha256})),files:source.files});
   this.put('osf_sources',source);return {source_id:source.id,content_sha256:source.content_sha256,counts:source.counts,findings:source.findings_count};
  });
 }
 source(key,sha){const s=this.get('osf_sources',key);if(s.status!=='CAPTURED'||!s.inventory)problem('OSF_SOURCE_RECEIVING','Continue the original source capture before preparing a mapping.',409);if(sha&&s.content_sha256!==sha)problem('OSF_SOURCE_CHANGED','The selected source edition differs.',409);return s;}
 mapping(key,sha){const m=this.get('osf_mappings',key);if(sha&&m.mapping_sha256!==sha)problem('OSF_MAPPING_CHANGED','Use the exact selected mapping edition.',409);this.source(m.source_id,m.source_sha256);return m;}
 defaultMapping(sourceId,profileId=null){
  const source=this.source(sourceId);return {name:source.name+' transition',source_id:source.id,source_sha256:source.content_sha256,profile_id:profileId,entries:source.inventory.nodes.filter(n=>n.record).map(n=>({node_id:n.id,decision:'KEEP_OSF',reason:'Review whether this component contains continuing work.',mode:'CREATE_DRAFT',collection_capture_id:null,collection_uuid:null,target_capture_id:null,target_uuid:null,metadata:defaultMetadata(source,n.id),rights:{access:n.public===true?'PUBLIC':'RESTRICTED',statement:'',note:'',confirmed_by:''},files:items(source,n.id).map(f=>({key:f.key,action:f.retained?'COPY':'REFERENCE',note:f.retained?'':'Review the original provider or unavailable historical version.'}))}))};
 }
 validateMapping(input){
  const source=this.source(input.source_id,input.source_sha256),profile=input.profile_id?this.ws.profile(input.profile_id):null;
  if(!Array.isArray(input.entries)||!input.entries.length)problem('OSF_SELECTION_REQUIRED','Review the source components.');
  const nodes=new Set(),entries=[];
  for(const original of input.entries){
   const node=source.inventory.nodes.find(n=>n.id===original.node_id&&n.record);if(!node||nodes.has(node.id))problem('OSF_COMPONENT_SELECTION','Every mapping entry must identify one distinct captured original component.');nodes.add(node.id);
   if(!['CONTINUE','KEEP_OSF','EXCLUDE'].includes(original.decision))problem('OSF_COMPONENT_DECISION','Choose continuing work, keep on OSF, or exclude with a reason.');
   const entry={node_id:node.id,decision:original.decision,reason:text(original.reason,'Component decision note'),source_sha256:nodeFingerprint(source,node.id),mode:original.mode||'CREATE_DRAFT',collection_capture_id:original.collection_capture_id??null,collection_uuid:original.collection_uuid??null,target_capture_id:original.target_capture_id??null,target_uuid:original.target_uuid??null,metadata:metadata(original.metadata??defaultMetadata(source,node.id)),rights:copy(original.rights??{}),files:copy(original.files??[]),new_destination_reason:original.new_destination_reason?text(original.new_destination_reason,'New institutional destination decision'):null};
   if(!['CREATE_DRAFT','CREATE_ARCHIVE','UPDATE_ITEM'].includes(entry.mode))problem('OSF_DESTINATION_MODE','Choose a native draft, archived item, or existing item.');
   const seenFiles=new Set();for(const f of entry.files){if(!items(source,node.id).some(v=>v.key===f.key)||seenFiles.has(f.key))problem('OSF_FILE_SELECTION','File selections must identify distinct original versions in this component.');seenFiles.add(f.key);if(!['COPY','REFERENCE','EXCLUDE'].includes(f.action))problem('OSF_FILE_DECISION','Choose copy, retain reference, or exclude.');if(f.action!=='COPY')f.note=text(f.note,'Original file decision note');if(f.action==='COPY'&&!source.files.some(v=>v.key===f.key))problem('OSF_FILE_NOT_RECEIVED','Receive the exact original file version before selecting Copy.',409);}
   if(entry.decision==='CONTINUE'){
    if(!profile)problem('OSF_DESTINATION_PROFILE','Select the original institutional repository profile.');
    if(!['PUBLIC','RESTRICTED'].includes(entry.rights.access))problem('OSF_RIGHTS','Record the intended access classification.');
    entry.rights.note=text(entry.rights.note,'Rights and permission review');entry.rights.confirmed_by=text(entry.rights.confirmed_by,'Rights reviewer',160);
    if(node.public!==true&&entry.mode==='CREATE_ARCHIVE')problem('OSF_ACCESS_REVIEW','Use a native draft for nonpublic OSF material; complete its institutional access workflow before archival publication.',409);
    if(entry.mode==='CREATE_ARCHIVE'&&entry.rights.access!=='PUBLIC')problem('OSF_ACCESS_REVIEW','Immediate native archival creation requires a public destination decision.',409);
    if(seenFiles.size!==items(source,node.id).length)problem('OSF_FILE_SELECTION','Review every captured version in each continuing component; excluded and referenced files keep their original identity.');
    if(entry.mode==='UPDATE_ITEM'){
     const capture=this.get('captures',entry.target_capture_id),object=this.ws.sourceObject(capture.id,entry.target_uuid,'item');if(this.ws.profile(capture.profile_id).base_url!==profile.base_url)problem('OSF_TARGET_REPOSITORY','The selected item belongs to another repository.');entry.target_source_sha256=sourceHash(object);
    }else{
     const capture=this.get('captures',entry.collection_capture_id),collection=this.ws.sourceObject(capture.id,entry.collection_uuid,'collection');if(this.ws.profile(capture.profile_id).base_url!==profile.base_url)problem('OSF_TARGET_REPOSITORY','The selected collection belongs to another repository.');entry.collection_source_sha256=sourceHash(collection);
    }
   }
   entries.push(entry);
  }
  const all=source.inventory.nodes.filter(n=>n.record);if(nodes.size!==all.length)problem('OSF_COMPONENT_SELECTION','Retain an explicit decision for every captured component.');
  return {source,profile,entries};
 }
 saveMapping(input){
  input=copy(input);
  if(input.previous_mapping_id){
   const previous=this.mapping(input.previous_mapping_id),adopted=this.adopted(previous.id);
   if(previous.profile_id===input.profile_id)for(const entry of input.entries??[]){
    const old=previous.entries.find(e=>e.node_id===entry.node_id),target=old?this.target(previous,old,adopted):null;
    if(target&&entry.decision==='CONTINUE'&&entry.mode!=='UPDATE_ITEM'&&!entry.new_destination_reason){
     entry.mode='UPDATE_ITEM';entry.target_uuid=target.target_uuid;entry.target_capture_id=target.target_capture_id;
    }
   }
  }
  const {source,profile,entries}=this.validateMapping(input);
  const m={id:id('osf-mapping',input.operationId),name:text(input.name,'Transition name',240),source_id:source.id,source_sha256:source.content_sha256,profile_id:profile?.id??null,created_at:at(),actor:input.actor,previous_mapping_id:input.previous_mapping_id??null,entries,entry_count:entries.length,continue_count:entries.filter(e=>e.decision==='CONTINUE').length,reconciliation_id:input.reconciliation_id??null};
  m.mapping_sha256=sourceHash(m);return this.commit(input,()=>{this.put('osf_mappings',m);return {mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_id:m.source_id};});
 }
 review(input){
  const m=this.mapping(input.mapping_id,input.mapping_sha256);if(!['APPROVED','CHANGES_REQUESTED'].includes(input.decision))problem('OSF_REVIEW','Choose approve or request changes.');
  const source=this.source(m.source_id),acknowledged=[...new Set(input.acknowledged_findings??[])],findings=[...source.inventory.findings,...source.declared_findings];
  const findingIds=findings.map((f,i)=>sourceHash([i,f]));if(input.decision==='APPROVED'&&findingIds.some(k=>!acknowledged.includes(k)))problem('OSF_FINDING_REVIEW','Review each observed source exception before approving this exact mapping.',409,{finding_ids:findingIds});
  const review={id:id('osf-review',input.operationId),mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_id:source.id,source_sha256:source.content_sha256,decision:input.decision,actor:input.actor,note:text(input.note,'Transition review'),acknowledged_findings:acknowledged,created_at:at()};
  return this.commit(input,()=>{this.put('osf_reviews',review);return {review_id:review.id,mapping_id:m.id,decision:review.decision};});
 }
 approved(input){
  const m=this.mapping(input.mapping_id,input.mapping_sha256),r=this.get('osf_reviews',input.review_id);
  if(r.mapping_id!==m.id||r.mapping_sha256!==m.mapping_sha256||r.source_sha256!==m.source_sha256||r.decision!=='APPROVED')problem('OSF_REVIEW_CHANGED','Choose an approval of this exact source and mapping edition.',409);
  return {m,r,source:this.source(m.source_id)};
 }
 adopted(mappingId,seen=new Set()){
  if(seen.has(mappingId))problem('OSF_MAPPING_LINEAGE','The saved mapping lineage contains a cycle.');
  seen.add(mappingId);
  const mapping=this.mapping(mappingId),rows=this.store.all('osf_adoptions').filter(a=>a.mapping_id===mappingId),targets={},files=new Map(),metadata=new Map();
  if(mapping.previous_mapping_id){
   const prior=this.adopted(mapping.previous_mapping_id,seen),source=this.source(mapping.source_id);
   for(const entry of mapping.entries.filter(e=>e.decision==='CONTINUE'&&e.mode==='UPDATE_ITEM')){
    const target=prior.targets[entry.node_id]??this.target(this.mapping(mapping.previous_mapping_id),this.mapping(mapping.previous_mapping_id).entries.find(e=>e.node_id===entry.node_id)??{},prior);
    if(!target||target.target_uuid!==entry.target_uuid)continue;
    targets[entry.node_id]={...copy(target),target_capture_id:entry.target_capture_id,lineage_mapping_id:mapping.previous_mapping_id};
    for(const choice of entry.files){
     const accepted=prior.files.get(choice.key),original=source.files.find(f=>f.key===choice.key);
     if(choice.action==='COPY'&&accepted?.target_uuid===entry.target_uuid&&original&&accepted.sha256===original.sha256&&accepted.bytes===original.bytes)files.set(choice.key,{...copy(accepted),lineage_mapping_id:mapping.previous_mapping_id});
    }
   }
  }
  for(const adoption of rows)for(const row of adoption.rows){if(row.target_uuid&&row.phase!=='files')targets[row.node_id]=row;if(row.file_key)files.set(row.file_key,row);if(row.phase==='metadata')metadata.set(row.node_id,row);}
  return {targets,files,metadata};
 }
 target(m,entry,adopted){
  if(adopted.targets[entry.node_id])return adopted.targets[entry.node_id];
  if(entry.mode==='UPDATE_ITEM')return {node_id:entry.node_id,target_uuid:entry.target_uuid,target_capture_id:entry.target_capture_id,profile_id:m.profile_id};
  return null;
 }
 asset(source,file){
  const key=id('osf-asset',[source.id,file.key].join('|')),old=this.store.maybe('assets',key);
  if(old){if(old.sha256!==file.sha256||old.bytes!==file.bytes)problem('OSF_ASSET_CHANGED','The retained original file asset differs.');return old;}
  if(file.bytes>this.ws.state().limits.asset_bytes)problem('OSF_NATIVE_FILE_LIMIT','This exact version exceeds the original DSpace workspace file limit.',413);
  const bytes=this.store.bytes(file.sha256);if(bytes.length!==file.bytes)problem('OSF_FILE_CHANGED','The original file length differs.');
  const filename=safe('osf_'+file.node_id+'_'+file.file_id+'_v'+(file.version_id??'current')+'_'+file.name);
  const asset={id:key,name:filename,media_type:file.media_type,bytes:file.bytes,sha256:file.sha256,created_at:at(),osf_source_id:source.id,osf_file_key:file.key,original_name:file.name,original_path:file.path};
  this.store.tx(()=>this.ws.put('assets',asset));return asset;
 }
 async prepareNative(input){
  const {m,r,source}=this.approved(input),phase=input.phase;
  if(!['records','metadata','files'].includes(phase))problem('OSF_NATIVE_PHASE','Choose records, metadata or files.');
  const originalPlan=this.store.all('plans').find(p=>p.origin?.osf_operation_id===input.operationId);
  if(originalPlan){
   const origin=originalPlan.origin,op=this.get('operations',input.operationId);
   if(origin.operation_fingerprint!==op.fingerprint||origin.mapping_id!==m.id||origin.mapping_sha256!==m.mapping_sha256||origin.phase!==phase||origin.review_id!==r.id||!Array.isArray(origin.bindings))problem('OSF_NATIVE_INTENT_CHANGED','The retained native preparation differs from the original operation.',409);
   return this.commit(input,()=>{const record={id:id('osf-native-plan',input.operationId),mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_id:source.id,review_id:r.id,phase,plan_id:originalPlan.id,bindings:copy(origin.bindings),created_at:originalPlan.created_at,step_count:originalPlan.steps.length,remaining_steps:origin.remaining_steps??0,intent_sha256:origin.intent_sha256};this.put('osf_native_plans',record);return {native_plan_id:record.id,plan_id:originalPlan.id,mapping_id:m.id,phase,step_count:record.step_count,remaining_steps:record.remaining_steps};});
  }
  const adopted=this.adopted(m.id),steps=[],bindings=[];
  const isAccepted=(binding,state)=>binding.phase==='records'?Boolean(state.targets[binding.node_id]):binding.phase==='metadata'?state.metadata.has(binding.node_id):state.files.has(binding.file_key);
  for(const prior of this.store.all('osf_native_plans').filter(p=>p.mapping_id===m.id&&p.phase===phase)){
   if(prior.bindings.some(binding=>!isAccepted(binding,adopted)))return this.commit(input,()=>({native_plan_id:prior.id,plan_id:prior.plan_id,mapping_id:m.id,phase,step_count:prior.step_count,remaining_steps:prior.remaining_steps??0,reused_preparation:true,original_review_id:prior.review_id,original_operation_id:this.get('plans',prior.plan_id).origin?.osf_operation_id}));
  }
  if(['records','files'].includes(phase)){
   let previous=m.previous_mapping_id;const visited=new Set();
   while(previous&&!visited.has(previous)){
    visited.add(previous);const ancestor=this.mapping(previous),accepted=this.adopted(ancestor.id);
    if(ancestor.profile_id===m.profile_id)for(const prior of this.store.all('osf_native_plans').filter(p=>p.mapping_id===ancestor.id&&p.phase===phase)){
     const unresolved=prior.bindings.find(binding=>!isAccepted(binding,accepted)&&m.entries.some(entry=>entry.node_id===binding.node_id&&entry.decision==='CONTINUE'&&!entry.new_destination_reason&&(phase==='records'?!this.target(m,entry,adopted):entry.files.some(file=>file.key===binding.file_key&&file.action==='COPY')&&this.target(m,entry,adopted)?.target_uuid===binding.target_uuid)));
     if(unresolved)problem('OSF_ORIGINAL_NATIVE_PENDING','Continue and adopt original native plan '+prior.id+' ('+prior.plan_id+') before preparing the same original '+phase+' in this successor mapping.',409,{native_plan_id:prior.id,plan_id:prior.plan_id});
    }
    previous=ancestor.previous_mapping_id;
   }
  }
  for(const entry of m.entries.filter(e=>e.decision==='CONTINUE')){
   const target=this.target(m,entry,adopted);
   if(phase==='records'){
    if(target)continue;
    const tool=entry.mode==='CREATE_ARCHIVE'?'dspace_create_item':'dspace_create_workspace_item',args={owningCollectionUuid:entry.collection_uuid,metadata:tool==='dspace_create_item'?{'dc.title':entry.metadata['dc.title']?.map(v=>v.value)??[]}:{}};
    steps.push({tool,args});bindings.push({node_id:entry.node_id,phase,mode:entry.mode,collection_uuid:entry.collection_uuid});
   }else{
    if(!target)problem('OSF_NATIVE_TARGET_REQUIRED','Adopt the original accepted record-creation result first.',409);
    if(phase==='metadata'){
     if(adopted.metadata.has(entry.node_id))continue;
     const original=this.ws.sourceObject(target.target_capture_id,target.target_uuid,'item'),operations=Object.entries(entry.metadata).filter(([field,values])=>stable(original.metadata?.[field]??[])!==stable(values)).map(([field,values])=>({op:Object.hasOwn(original.metadata??{},field)?'replace':'add',path:'/metadata/'+pathField(field),value:copy(values)}));
     if(!operations.length)continue;
     steps.push({tool:'dspace_update_item_metadata',args:{uuid:target.target_uuid,operations},source_capture_id:target.target_capture_id,subject_id:target.target_uuid});bindings.push({node_id:entry.node_id,phase,target_uuid:target.target_uuid,metadata_sha256:sourceHash(entry.metadata)});
    }else for(const choice of entry.files.filter(f=>f.action==='COPY')){
     if(adopted.files.has(choice.key))continue;
     const file=source.files.find(f=>f.key===choice.key),asset=this.asset(source,file);
     steps.push({tool:'dspace_upload_bitstream',args:{itemUuid:target.target_uuid,bundleName:'ORIGINAL',name:asset.name,description:'Original OSF '+file.node_id+' '+file.path+'; version '+(file.version_id??'current; native version unavailable')+'; SHA256 '+file.sha256,mimeType:asset.media_type},source_capture_id:target.target_capture_id,subject_id:target.target_uuid,asset_id:asset.id});
     bindings.push({node_id:entry.node_id,phase,target_uuid:target.target_uuid,target_capture_id:target.target_capture_id,file_key:file.key,sha256:file.sha256,bytes:file.bytes,asset_id:asset.id});
    }
   }
  }
  if(!steps.length)problem('OSF_PHASE_COMPLETE','This selected phase has no remaining native changes. Inspect its adopted result.',409);
  const remaining_steps=Math.max(0,steps.length-100);steps.splice(100);bindings.splice(100);
  const intent={mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_sha256:source.content_sha256,review_id:r.id,phase,bindings,steps,remaining_steps};
  const intentSha=sourceHash(intent),existing=this.store.all('plans').find(p=>p.origin?.osf_operation_id===input.operationId);
  let planId;if(existing){if(existing.origin.intent_sha256!==intentSha)problem('OSF_NATIVE_INTENT_CHANGED','The original native preparation differs from this continuation.',409);planId=existing.id;}
  else {const result=await this.ws.prepare({actor:input.actor,operationId:input.operationId,name:m.name+' · '+phase,profile_id:m.profile_id,steps,origin:{osf_operation_id:input.operationId,operation_fingerprint:this.get('operations',input.operationId).fingerprint,mapping_id:m.id,mapping_sha256:m.mapping_sha256,review_id:r.id,phase,bindings:copy(bindings),remaining_steps,intent_sha256:intentSha}});planId=result.plan_id;}
  return this.commit(input,()=>{const record={id:id('osf-native-plan',input.operationId),mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_id:source.id,review_id:r.id,phase,plan_id:planId,bindings,created_at:at(),step_count:steps.length,remaining_steps,intent_sha256:intentSha};this.put('osf_native_plans',record);return {native_plan_id:record.id,plan_id:planId,mapping_id:m.id,phase,step_count:steps.length,remaining_steps};});
 }
 adopt(input){
  const binding=this.get('osf_native_plans',input.native_plan_id),m=this.mapping(binding.mapping_id,binding.mapping_sha256),execution=this.get('executions',input.execution_id);
  if(execution.plan_id!==binding.plan_id||execution.profile_id!==m.profile_id)problem('OSF_EXECUTION_SOURCE','Choose the original execution of this exact native plan.');
  const rows=[],pending=[];
  for(const [index,b]of binding.bindings.entries()){
   const step=execution.steps[index];if(!step||step.id!=='step-'+(index+1))problem('OSF_EXECUTION_STEPS','The original plan step identity differs.');
   if(!['APPLIED','RECOVERED'].includes(step.status)){pending.push({step_id:step.id,node_id:b.node_id,status:step.status,error:copy(step.error)});continue;}
   const observed=step.after_observed,target=step.tool==='dspace_create_workspace_item'?observed?._embedded?.item?.uuid:step.tool==='dspace_upload_bitstream'?b.target_uuid:step.observed_subject_id;
   if(!target||!step.result_capture_id)problem('OSF_NATIVE_RESULT','Retain the original native subject and complete result capture before adoption.',409);
   const targetCapture=b.phase==='files'?b.target_capture_id:step.result_capture_id;
   this.ws.sourceObject(targetCapture,target,'item');
   if(b.file_key&&step.asset?.sha256!==b.sha256)problem('OSF_FILE_BINDING','The accepted native upload differs from the selected original file.');
   rows.push({...copy(b),target_uuid:target,target_capture_id:targetCapture,profile_id:m.profile_id,execution_id:execution.id,step_id:step.id,native_file_uuid:b.file_key?step.observed_subject_id:null,workspace_item_id:step.tool==='dspace_create_workspace_item'?step.observed_subject_id:null,status:step.status});
  }
  const adoption={id:id('osf-adoption',input.operationId),mapping_id:m.id,plan_id:binding.plan_id,execution_id:execution.id,phase:binding.phase,created_at:at(),actor:input.actor,rows,pending,accepted_steps:rows.length,pending_steps:pending.length,execution:copy(execution)};
  return this.commit(input,()=>{this.put('osf_adoptions',adoption);return {adoption_id:adoption.id,mapping_id:m.id,accepted_steps:rows.length,pending_steps:pending.length};});
 }
 compare(input){
  const m=this.mapping(input.mapping_id,input.mapping_sha256),source=this.source(m.source_id),incoming=this.source(input.incoming_source_id);
  if(stable(source.roots)!==stable(incoming.roots))problem('OSF_COMPARISON_ROOTS','Compare captures of the same original roots.');
  const entries=[],conflicts=[];
  for(const entry of m.entries){
   const next=incoming.inventory.nodes.find(n=>n.id===entry.node_id&&n.record);if(!next){entries.push({node_id:entry.node_id,status:'SOURCE_ABSENT',previous:copy(entry)});continue;}
   const base=defaultMetadata(source,entry.node_id),remote=defaultMetadata(incoming,entry.node_id),fields=[];
   for(const field of new Set([...Object.keys(base),...Object.keys(remote),...Object.keys(entry.metadata)])){
    const before={present:Object.hasOwn(base,field),value:base[field]??null},local={present:Object.hasOwn(entry.metadata,field),value:entry.metadata[field]??null},after={present:Object.hasOwn(remote,field),value:remote[field]??null};
    const localChanged=stable(before)!==stable(local),sourceChanged=stable(before)!==stable(after),conflict=localChanged&&sourceChanged&&stable(local)!==stable(after),key=sourceHash([entry.node_id,field,before,local,after]);
    fields.push({key,field,before,local,incoming:after,local_changed:localChanged,source_changed:sourceChanged,conflict});if(conflict)conflicts.push({key,node_id:entry.node_id,field});
   }
   const oldFiles=new Map(entry.files.map(f=>[f.key,f])),fileChanges=items(incoming,entry.node_id).map(f=>({key:f.key,state:oldFiles.has(f.key)?'RETAINED':'NEW',received:f.retained,previous:oldFiles.get(f.key)??null}));
   for(const f of entry.files)if(!items(incoming,entry.node_id).some(x=>x.key===f.key))fileChanges.push({key:f.key,state:'SOURCE_ABSENT',previous:f});
   entries.push({node_id:entry.node_id,status:'PRESENT',fields,files:fileChanges,previous:copy(entry),incoming_source_sha256:nodeFingerprint(incoming,entry.node_id)});
  }
  for(const node of incoming.inventory.nodes.filter(n=>n.record&&!m.entries.some(e=>e.node_id===n.id)))entries.push({node_id:node.id,status:'NEW_COMPONENT',default_metadata:defaultMetadata(incoming,node.id)});
  const comparison={id:id('osf-comparison',input.operationId),mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_id:source.id,source_sha256:source.content_sha256,incoming_source_id:incoming.id,incoming_source_sha256:incoming.content_sha256,entries,conflicts,conflict_count:conflicts.length,created_at:at(),actor:input.actor};
  comparison.comparison_sha256=sourceHash(comparison);return this.commit(input,()=>{this.put('osf_comparisons',comparison);return {comparison_id:comparison.id,comparison_sha256:comparison.comparison_sha256,conflict_count:conflicts.length};});
 }
 reconcile(input){
  const c=this.get('osf_comparisons',input.comparison_id);if(c.comparison_sha256!==input.comparison_sha256)problem('OSF_COMPARISON_CHANGED','Use the exact opened comparison.');
  const m=this.mapping(c.mapping_id,c.mapping_sha256),incoming=this.source(c.incoming_source_id,c.incoming_source_sha256),choices=input.choices??{},entries=[];
  for(const row of c.entries){
   if(row.status==='SOURCE_ABSENT'){if(choices['node:'+row.node_id]!=='REMOVE_ABSENT')problem('OSF_ABSENT_COMPONENT','Explicitly reconcile the absent component; its prior source remains retained.');continue;}
   if(row.status==='NEW_COMPONENT'){
    const supplied=input.new_entries?.find(e=>e.node_id===row.node_id);if(!supplied)problem('OSF_NEW_COMPONENT','Review an explicit decision and destination for each new component.');entries.push(copy(supplied));continue;
   }
   const entry=copy(row.previous),md={};
   for(const f of row.fields){
    const choice=choices[f.key];if(f.conflict&&!['LOCAL','INCOMING','CUSTOM'].includes(choice?.side??choice))problem('OSF_FIELD_CONFLICT','Resolve every overlapping source and staff metadata edit.',409,{field:f.field,node_id:row.node_id});
    const side=choice?.side??choice;const selected=side==='CUSTOM'?{present:true,value:choice.value}:side==='LOCAL'?f.local:side==='INCOMING'?f.incoming:f.source_changed&&!f.local_changed?f.incoming:f.local;if(selected.present)md[f.field]=copy(selected.value);
   }
   entry.metadata=md;entry.files=[];
   for(const f of row.files){
    const choice=input.file_choices?.find(x=>x.key===f.key);
    if(f.state==='SOURCE_ABSENT'){if(choice?.action!=='REMOVE_ABSENT')problem('OSF_ABSENT_FILE','Explicitly reconcile each file version absent from the new capture.');continue;}
    if(f.state==='NEW'){if(!choice)problem('OSF_NEW_FILE','Review every newly observed file version.');entry.files.push({key:f.key,action:choice.action,note:choice.note??''});}
    else entry.files.push(choice?{key:f.key,action:choice.action,note:choice.note??''}:copy(f.previous));
   }
   entries.push(entry);
  }
  return this.saveMapping({...input,name:input.name||m.name+' · reconciled',source_id:incoming.id,source_sha256:incoming.content_sha256,profile_id:m.profile_id,previous_mapping_id:m.id,entries,reconciliation_id:c.id});
 }
 saveDraft(input){
  const draft={id:id('osf-draft',input.operationId),context:text(input.context,'Draft context',300),name:text(input.name||'Saved working draft','Draft name',240),body:copy(input.body),created_at:at(),actor:input.actor,previous_draft_id:input.previous_draft_id??null};
  if(draft.previous_draft_id)this.get('osf_drafts',draft.previous_draft_id);
  return this.commit(input,()=>{this.put('osf_drafts',draft);return {draft_id:draft.id,context:draft.context};});
 }
 delivery(input){
  const {m,r,source}=this.approved(input),adopted=this.adopted(m.id);
  if(!['WORKING_HANDOVER','CUTOVER_REVIEWED'].includes(input.state))problem('OSF_DELIVERY_STATE','Choose a working handover or reviewed cutover.');
  const entries=m.entries.map(entry=>{
   const target=this.target(m,entry,adopted),files=entry.files.map(f=>({...copy(f),source:copy(source.inventory.versions.find(v=>v.key===f.key)),retained:copy(source.files.find(v=>v.key===f.key)??null),native:copy(adopted.files.get(f.key)??null)}));
   const destination=input.destinations?.find(d=>d.node_id===entry.node_id)??null;
   if(destination?.url){const u=new URL(destination.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)problem('OSF_DESTINATION_URL','Use an institutional destination URL.');}
   if(input.state==='CUTOVER_REVIEWED'&&entry.decision==='CONTINUE'){
    if(!target||!destination?.url)problem('OSF_CUTOVER_TARGET','Retain the original native target and its institutional URL before cutover.');
    text(destination.access_review,'Destination access review');text(destination.accepted_by,'Receiving staff reviewer',160);
    if(files.some(f=>f.action==='COPY'&&!f.native))problem('OSF_CUTOVER_FILES','Adopt every selected original native upload result before cutover.');
    const current=this.ws.sourceObject(target.target_capture_id,target.target_uuid,'item');
    if(Object.entries(entry.metadata).some(([field,values])=>stable(current.metadata?.[field]??[])!==stable(values))&&!adopted.metadata.has(entry.node_id))problem('OSF_CUTOVER_METADATA','Retain the accepted exact mapped metadata before cutover.');
   }
   return {...copy(entry),target:copy(target),destination:copy(destination),files};
  });
  const payload={schema:'osf-dspace-transition-handover/v1',operation_id:input.operationId,id:id('osf-delivery',input.operationId),name:text(input.name||m.name,'Handover name',240),state:input.state,mapping_id:m.id,mapping_sha256:m.mapping_sha256,source_id:source.id,source_sha256:source.content_sha256,created_at:at(),actor:input.actor,note:text(input.note,'Receiving and cutover note'),mapping:copy(m),review:copy(r),entries,source:copy(source),native_plans:this.store.all('osf_native_plans').filter(p=>p.mapping_id===m.id),adoptions:this.store.all('osf_adoptions').filter(p=>p.mapping_id===m.id),redirects:entries.filter(e=>e.decision==='CONTINUE').map(e=>({node_id:e.node_id,original_url:'https://osf.io/'+e.node_id+'/',destination:e.destination?.url??null,process:'Original OSF administrator requests any redirect only after destination acceptance.'}))};
  payload.receiving_snapshot=freezeReceivingRecords(this.store,[m,r,source,payload.native_plans,payload.adoptions],{operationId:input.operationId,draftIds:input.draft_ids??[]});
  payload.manifest_sha256=sourceHash(payload);
  return this.commit(input,()=>{this.put('osf_deliveries',payload);return {delivery_id:payload.id,mapping_id:m.id,manifest_sha256:payload.manifest_sha256,state:payload.state};});
 }
 read(kind,key,{offset=0,limit=50}={}){
  offset=Math.max(0,Number(offset)||0);limit=Math.max(1,Math.min(100,Number(limit)||50));
  if(['osf_nodes','osf_files','osf_versions','osf_contributors','osf_relations','osf_logs','osf_wikis','osf_findings'].includes(kind)){
   const source=this.source(key),section=kind.slice(4),all=section==='findings'?[...source.inventory.findings,...source.declared_findings].map((f,i)=>({...f,id:sourceHash([i,f])})):source.inventory[section];
   return {source_id:source.id,source_sha256:source.content_sha256,items:all.slice(offset,offset+limit),offset,limit,total:all.length};
  }
  if(kind==='osf_default_mapping')return this.defaultMapping(key,this.store.meta('selected_profile_id'));
  const doc=this.get(kind,key);if(kind==='osf_sources')return {...summary(kind,doc),collector:doc.collector,previous_source_id:doc.previous_source_id??null,documents:doc.documents,files:doc.files,declared_findings:doc.declared_findings??[],pending:doc.tasks?.filter(t=>t.state==='PENDING').length??0};
  if(kind==='osf_responses')return {...doc,body:doc.sha256?this.store.bytes(doc.sha256).toString('utf8'):null};
  return doc;
 }
 file(kind,key){
  if(kind==='osf_file'){const parts=key.split(':'),source=this.source(parts.shift()),file=source.files.find(f=>sourceHash(f.key)===parts.join(':'));if(!file)problem('OSF_FILE_NOT_FOUND','Select a retained original file version.',404);return {filename:file.name,contentType:file.media_type,bytes:this.store.bytes(file.sha256)};}
  if(kind==='osf_response'){const r=this.get('osf_responses',key);if(!r.sha256)problem('OSF_BODY_ABSENT','This original request has no response body.',404);return {filename:safe(r.original_response_id)+(/json/.test(r.content_type??'')?'.json':'.bin'),contentType:r.content_type||'application/octet-stream',bytes:this.store.bytes(r.sha256)};}
  if(kind==='osf_source'){
   const source=this.source(key),packet={schema:'osf-project-source/v1',roots:source.roots,created_at:source.original_created_at??source.created_at,finished_at:source.finished_at,source_mode:source.source_mode,collector:source.collector,documents:source.documents.map(d=>{const r=this.get('osf_responses',d.response_id||source.id+':'+d.id),{response_id,...meta}=d;return {...meta,...(r.sha256?{body_base64:this.store.bytes(r.sha256).toString('base64')}:{} )};}),files:source.files.map(f=>({...copy(f),content_b64:this.store.bytes(f.sha256).toString('base64')})),findings:source.declared_findings};
   return jsonFile('OSF_'+source.id+'_original_source.json',packet);
  }
  if(kind==='osf_manifest')return jsonFile('OSF_Transition_'+key+'.json',this.get('osf_deliveries',key));
  return jsonFile(kind+'_'+key+'.json',this.get(kind,key));
 }
}
