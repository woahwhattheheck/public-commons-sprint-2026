// SPDX-License-Identifier: MIT
// Native OTOBO capture -> complete reviewed import plan -> independent returned configuration.
import {createSHA256} from '../../workbench/web/sha256.mjs';
export const CAPTURE_SCHEMA='otobo.capture.v1',PLAN_SCHEMA='otobo.handover-plan.v1';
export const FAMILIES=['Groups','Roles','Types','Templates','Services','SLAs','Queues','QueueTemplates','RoleGroups','GenericAgents'];
const SHARED_KINDS=['Salutation','Signature','SystemAddress'];
const SHARED_LOOKUPS={Salutation:'Salutations',Signature:'Signatures',SystemAddress:'SystemAddresses'};
const familySet=new Set(FAMILIES),sha=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_-]{1,160}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const clone=x=>JSON.parse(JSON.stringify(x));
export function need(ok,message){if(!ok)throw Error(message);}
export function canonical(v){
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 need(object(v),'Retain JSON values without undefined or nonfinite numbers.');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
export const hash=v=>createSHA256().update(canonical(v)).hex();
export const textPin=s=>({bytes:new TextEncoder().encode(s).length,sha256:createSHA256().update(s).hex()});
export const json=v=>JSON.stringify(v,null,2)+'\n';
export const file=(path,content)=>({path,content,...textPin(content)});
const named=(x,label)=>{need(typeof x==='string'&&x.trim(),label+' is required.');return x;};
const key=(family,name)=>canonical([family,name]);
const compareText=(a,b)=>a<b?-1:a>b?1:0;
const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x));
function decode64(text){
 need(typeof text==='string'&&text.length%4===0&&!/[^A-Za-z0-9+/=]/.test(text),'Retain canonical Base64 original bytes.');
 const pad=text.endsWith('==')?2:text.endsWith('=')?1:0,first=text.indexOf('=');
 need(first===-1||first===text.length-pad,'Original Base64 padding differs.');
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=new Uint8Array(text.length/4*3-pad);let n=0;
 for(let i=0;i<text.length;i+=4){const a=chars.indexOf(text[i]),b=chars.indexOf(text[i+1]),c=text[i+2]==='='?0:chars.indexOf(text[i+2]),d=text[i+3]==='='?0:chars.indexOf(text[i+3]);need(a>=0&&b>=0,'Original Base64 has a short quartet.');out[n++]=(a<<2)|(b>>4);if(n<out.length)out[n++]=((b&15)<<4)|(c>>2);if(n<out.length)out[n++]=((c&3)<<6)|d;if(i+4===text.length)need(pad===2?(b&15)===0:pad===1?(c&3)===0:true,'Original Base64 has noncanonical pad bits.');}
 return out;
}
export function semanticNode(node,depth=0,budget={count:0}){
 need(++budget.count<=250000&&depth<=64&&object(node),'Selected native tree exceeds supported complete capacity.');
 if(node.kind==='map'){need(object(node.value),'Native map needs all named entries.');return {kind:'map',value:Object.fromEntries(Object.keys(node.value).sort().map(k=>[k,semanticNode(node.value[k],depth+1,budget)]))};}
 if(node.kind==='array'){need(Array.isArray(node.value),'Native array needs all original entries.');return {kind:'array',value:node.value.map(v=>semanticNode(v,depth+1,budget))};}
 need(['null','string','integer','float','boolean'].includes(node.kind),'Unsupported native scalar kind.');
 if(node.kind==='null')return {kind:'null',value:null};
 need(typeof node.value==='string','Native scalar values must remain textual; JSON numbers lose native precision.');
 if(node.kind==='integer')need(/^[+-]?\d+$/.test(node.value),'Retain the native integer text.');
 if(node.kind==='boolean')need(['true','false','1','0',''].includes(node.value),'Retain the native boolean text.');
 need(typeof node.yamlToken==='string','Retain the native scalar serialization alongside its display value.');
 return {kind:node.kind,value:node.value};
}
export function nodeAt(node,path){
 let current=node;
 for(const part of path){if(current?.kind==='map'&&own(current.value,String(part)))current=current.value[String(part)];else if(current?.kind==='array'&&/^(0|[1-9]\d*)$/.test(String(part))&&Number(part)<current.value.length)current=current.value[Number(part)];else return undefined;}
 return current;
}
const scalar=(node,label)=>{need(node&&['string','integer','float','boolean'].includes(node.kind),label+' must be a native scalar.');return node.value;};
const strings=(node,label)=>{need(node?.kind==='array',label+' must be an array.');return node.value.map(n=>scalar(n,label));};
const maps=node=>node?.kind==='map'?node.value:{};
function replaceAt(node,path,value){need(Array.isArray(path)&&path.length>0&&path.every(p=>typeof p==='string'),'Select a nonempty exact native field path.');const parent=nodeAt(node,path.slice(0,-1)),last=path.at(-1);need(parent&&nodeAt(node,path)!==undefined,'Native reference override path is absent.');if(parent.kind==='map')parent.value[last]=clone(value);else if(parent.kind==='array'&&/^(0|[1-9]\d*)$/.test(last))parent.value[Number(last)]=clone(value);else throw Error('Invalid native reference override path.');}
function verifyFile(f,seen){
 need(object(f)&&id.test(f.id)&&!seen.has(f.id),'Original file identity is invalid or repeated.');seen.add(f.id);named(f.filename,'Original filename');need(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&sha.test(f.sha256),'Retain original file size and SHA.');
 const bytes=decode64(f.body_base64);need(bytes.length===f.bytes&&createSHA256().update(bytes).hex()===f.sha256,'Original file bytes changed: '+f.filename);return bytes.length;
}
export function inspectConfigurationCapture(capture){
 need(object(capture)&&capture.schema===CAPTURE_SCHEMA&&sha.test(capture.captureId),'Open a complete native configuration capture.');
 const body={...capture};delete body.captureId;need(hash(body)===capture.captureId,'Complete native capture identity differs.');
 need(id.test(capture.caseId)&&['source','target'].includes(capture.side)&&date(capture.observedAt),'Retain original case, side and capture time.');
 named(capture.workspaceReference,'Original workspace');need(['provider-export','authored-reference'].includes(capture.evidenceKind),'Label the original export evidence.');
 need(object(capture.environment)&&object(capture.environment.parser),'Retain actual native parser environment and profile.');
 need(Array.isArray(capture.files)&&Array.isArray(capture.evidenceFiles??[])&&object(capture.completeness),'Retain full files, evidence and family scope.');
 const files=new Map(),entries=new Map(),seen=new Set();let bytes=0;
 for(const f of [...capture.files,...(capture.evidenceFiles??[])]){bytes+=verifyFile(f,seen);files.set(f.id,f);}
 need(bytes<=512*1024*1024,'Complete original capture exceeds 512 MiB.');
 for(const f of capture.files){
  need(familySet.has(f.family)&&Array.isArray(f.entries),'Select one native standard-object family per original file.');
  for(const entry of f.entries){
   named(entry.name,'Native identity');semanticNode(entry.value);
   const k=key(f.family,entry.name);need(!entries.has(k),'Multiple originals provide the same family/name. Resolve their original selection: '+entry.name);
   if(!['RoleGroups','QueueTemplates'].includes(f.family))need(scalar(nodeAt(entry.value,['Name']),'Native Name')===entry.name,'Original family key and Name differ.');
   if(f.family==='Services'){const short=scalar(nodeAt(entry.value,['NameShort']),'Native service short name'),parent=nodeAt(entry.value,['Parent']),prefix=parent&&parent.kind!=='null'?scalar(parent,'Native service parent'):'';need((prefix?prefix+'::':'')+short===entry.name,'Native service Parent/NameShort compose a different original identity.');}
   entries.set(k,{...entry,family:f.family,fileId:f.id,fileSha256:f.sha256});
  }
 }
 for(const [family,complete]of Object.entries(capture.completeness))need(familySet.has(family)&&typeof complete==='boolean','Declare family completeness explicitly.');
 const context=capture.externalContext??{};
 const evidence=declaration=>{need(object(declaration)&&Array.isArray(declaration.evidenceFileIds)&&declaration.evidenceFileIds.length>0&&declaration.evidenceFileIds.every(k=>files.has(k)),'Target lookup or setting lacks its retained original evidence.');};
 for(const d of Object.values(context.lookupSets??{})){evidence(d);need(Array.isArray(d.values)&&d.values.every(x=>typeof x==='string')&&new Set(d.values).size===d.values.length,'Retain exact unique native lookup names.');}
 if(context.permissionTypes){evidence(context.permissionTypes);need(Array.isArray(context.permissionTypes.values)&&context.permissionTypes.values.every(x=>typeof x==='string')&&new Set(context.permissionTypes.values).size===context.permissionTypes.values.length,'Retain native permission types.');}
 if(context.maxQueueLevel){evidence(context.maxQueueLevel);need(Number.isSafeInteger(context.maxQueueLevel.value)&&context.maxQueueLevel.value>0,'Retain actual maximum queue depth.');}
 if(context.sharedObjects!==undefined){
  need(object(context.sharedObjects),'Retain the complete shared-object context.');
  const evidenceIds=new Set((capture.evidenceFiles??[]).map(f=>f.id));
  for(const [kind,declaration]of Object.entries(context.sharedObjects)){
   need(SHARED_KINDS.includes(kind),'Select a supported native shared-object family.');
   evidence(declaration);
   need(declaration.evidenceFileIds.every(id=>evidenceIds.has(id)),'Shared objects require their retained original target-context evidence.');
   need(typeof declaration.complete==='boolean'&&Array.isArray(declaration.entries),'Declare shared-object scope and complete retained entries.');
   const names=new Set();
   for(const entry of declaration.entries){
    need(object(entry),'Retain the exact named shared-object entry.');named(entry.name,'Shared-object name');
    need(!names.has(entry.name),'A shared-object inventory repeats one native name.');names.add(entry.name);
    need(entry.value?.kind==='map','Retain the shared-object exported map.');semanticNode(entry.value);
    need(scalar(nodeAt(entry.value,['Name']),'Shared-object Name')===entry.name,'Shared-object inventory name differs from its native value.');
   }
   const lookup=context.lookupSets?.[SHARED_LOOKUPS[kind]];
   if(declaration.complete&&lookup)need(canonical([...names].sort())===canonical([...lookup.values].sort()),'Complete shared-object names differ from their selected native lookup.');
  }
 }
 return {capture,files,entries,context,bytes};
}
const imported=d=>['create','overwrite','replace-pair-permissions','add-links'].includes(d.action);
const row=(family,identity,value)=>({family,identity_json:canonical(identity),value_json:canonical(value)});
const rowKey=r=>canonical([r.family,r.identity_json]);
const sortRows=rows=>rows.sort((a,b)=>compareText(rowKey(a),rowKey(b)));
function permissions(node,allowed){
 const result=new Map();for(const [permission,groups]of Object.entries(maps(node))){if(allowed&&!allowed.has(permission))continue;for(const group of strings(groups,'Native permission group list')){if(!result.has(group))result.set(group,new Set());result.get(group).add(permission);}}
 return new Map([...result].map(([group,set])=>[group,set.has('rw')?['rw']:[...set].sort()]));
}
function normalizedObject(family,node){
 const n=semanticNode(node);
 if(family==='SLAs'&&n.kind==='map'&&n.value.Services?.kind==='array')n.value.Services.value.sort((a,b)=>compareText(canonical(a),canonical(b)));
 return n;
}
export function evaluateConfigurationPlan({source,before,plan}){
 const s=inspectConfigurationCapture(source),t=inspectConfigurationCapture(before);
 need(source.side==='source'&&before.side==='target'&&source.caseId===before.caseId,'Retain independently selected source and target captures in one case.');
 need(object(plan)&&plan.schema===PLAN_SCHEMA&&plan.caseId===source.caseId&&plan.sourceCaptureId===source.captureId&&plan.targetCaptureId===before.captureId,'Select the exact original configuration plan and capture identities.');
 const pbody={...plan};delete pbody.planId;need(sha.test(plan.planId)&&hash(pbody)===plan.planId,'Reviewed plan identity differs.');
 need(canonical(plan.expectedParser)===canonical(source.environment.parser),'Native source parser selection differs from the reviewed plan.');
 named(plan.reviewer,'Plan reviewer');need(date(plan.reviewedAt)&&Array.isArray(plan.decisions),'Retain review time and every original decision.');
 const findings=[],decisions=[],chosen=new Map(),expectedRows=[],scope=[],dependencies=new Map();
 const issue=(code,message,entry,severity='error',details={})=>findings.push({severity,code,message,family:entry?.family??null,name:entry?.name??null,...details});
 for(const decision of plan.decisions){
  need(object(decision)&&familySet.has(decision.family),'Review a native standard family.');named(decision.name,'Selected native name');named(decision.reason,'Decision reason');
  const k=key(decision.family,decision.name),entry=s.entries.get(k);need(entry&&entry.fileId===decision.sourceFileId&&!chosen.has(k),'Select each original family/name exactly once.');
  const target=t.entries.get(k),d={...clone(decision),source:entry,target:target??null,proposed:clone(entry.value),key:k};chosen.set(k,d);decisions.push(d);dependencies.set(k,new Set());
  const allowed=['keep-target','exclude',...(decision.family==='RoleGroups'?['replace-pair-permissions']:decision.family==='QueueTemplates'?['add-links']:['create','overwrite'])];
  need(allowed.includes(d.action),'Use the native family-specific action.');
  if(d.action==='create'&&target)issue('target-already-exists','Create would skip this existing native object; select its explicit treatment.',d);
  if(d.action==='overwrite'&&!target)issue('target-not-observed','Overwrite requires this original target object to be captured.',d);
  if(d.action==='keep-target'&&!target)issue('keep-target-unknown','Keep-target needs the selected target object.',d);
  if(d.action==='create'&&!target&&before.completeness[d.family]!==true)issue('target-absence-unknown','Partial target capture does not establish that the object is new.',d);
  if(!imported(d)&&d.referenceOverrides?.length)issue('unused-override','Reference overrides apply only to imported entries.',d);
  for(const override of d.referenceOverrides??[]){
   named(override.reason,'Reference override reason');need(Array.isArray(override.path)&&override.path.length&&override.path[0]!=='Name','Keep the original object identity.');
   const targetFile=t.files.get(override.targetFileId),referenced=targetFile?.entries?.find(e=>e.name===override.targetName),value=referenced&&nodeAt(referenced.value,override.targetPath);
   need(value&&!['map','array'].includes(value.kind),'Copy a scalar from an independently captured target entry.');
   const originalValue=nodeAt(d.proposed,override.path);need(originalValue&&!['map','array'].includes(originalValue.kind),'Reference overrides replace only an original native scalar.');
   replaceAt(d.proposed,override.path,value);
  }
 }
 need(chosen.size===s.entries.size,'Keep an explicit decision for every original source object, including excluded objects.');
 const lookup=(set,name,d,path)=>{const observed=t.context.lookupSets?.[set];if(!observed)issue('lookup-unobserved','Capture the target '+set+' lookup for this native reference.',d,'error',{path,lookup:set,value:name});else if(!observed.values.includes(name))issue('lookup-missing','The exact native '+set+' name is absent.',d,'error',{path,lookup:set,value:name});};
 const dependency=(family,name,d,path)=>{
  if(name===undefined||name===null||name==='')return;
  const k=key(family,name),candidate=chosen.get(k),target=t.entries.get(k);
  if(candidate&&imported(candidate)){if(k===d.key&&path[0]!=='SystemAddress')issue('self-dependency','An object cannot create its own native parent.',d);else if(path[0]!=='SystemAddress')dependencies.get(d.key).add(k);return;}
  if(target)return;
  issue('dependency-unresolved','Native import cannot resolve '+family+' / '+name+'.',d,'error',{path,dependencyFamily:family,dependencyName:name,targetComplete:before.completeness[family]===true});
 };
 const fieldName=(node,path)=>{const value=nodeAt(node,path);return value&&value.kind!=='null'?scalar(value,path.join('.')):null;};
 const embedded=new Map(),targetShared=new Map(),plannedSharedOverwrites=new Map();
 for(const d of decisions)if(d.family==='Queues'&&d.action==='overwrite')for(const kind of SHARED_KINDS){
  const value=nodeAt(d.proposed,[kind]);if(value?.kind!=='map')continue;
  const name=fieldName(value,['Name']);named(name,'Selected overwrite shared '+kind+' name');
  const k=key(kind,name),writers=plannedSharedOverwrites.get(k)??[];writers.push({queue:d.name,semantic:canonical(semanticNode(value))});plannedSharedOverwrites.set(k,writers);
 }
 const recordShared=(kind,name,value,origin)=>{
  const k=key(kind,name);let selected=targetShared.get(k);
  if(!selected){selected={records:[],queues:[]};targetShared.set(k,selected);}
  const semantic=canonical(semanticNode(value));
  selected.records.push({semantic,value,origin});
  if(origin.kind==='queue')selected.queues.push({name:origin.name,semantic,value,fileId:origin.fileId});
 };
 for(const kind of SHARED_KINDS)for(const entry of t.context.sharedObjects?.[kind]?.entries??[])recordShared(kind,entry.name,entry.value,{kind:'inventory',evidenceFileIds:t.context.sharedObjects[kind].evidenceFileIds});
 for(const entry of t.entries.values())if(entry.family==='Queues')for(const kind of SHARED_KINDS){
  const value=nodeAt(entry.value,[kind]);
  if(value?.kind==='map'){const name=fieldName(value,['Name']);named(name,'Captured shared '+kind+' name');recordShared(kind,name,value,{kind:'queue',name:entry.name,fileId:entry.fileId});}
 }
 function reviewShared(kind,name,proposed,d){
  const selected=targetShared.get(key(kind,name)),semantic=canonical(semanticNode(proposed)),inventory=t.context.sharedObjects?.[kind];
  if(selected&&new Set(selected.records.map(r=>r.semantic)).size>1)issue('shared-target-context-conflict','The selected target inventory and queue exports disagree about this shared object. Retain a consistent target observation before emission.',d,'error',{sharedKind:kind,sharedName:name,observations:selected.records.map(r=>({origin:r.origin,value:r.value}))});
  if(d.action==='create'){
   const retained=selected?.records.find(r=>r.semantic!==semantic),absenceUnknown=!selected&&inventory?.complete!==true;
   const writer=plannedSharedOverwrites.get(key(kind,name))?.find(r=>r.semantic===semantic);
   if((retained||absenceUnknown)&&writer)issue('planned-later-shared-overwrite','The later selected queue-overwrite phase establishes this complete shared object after the create phase retains or creates its initial value.',d,'review',{sharedKind:kind,sharedName:name,laterQueue:writer.queue,retained:retained?.value??null,initialAbsenceUnknown:absenceUnknown,proposed});
   else if(retained)issue('shared-create-retains-target','Creating this queue retains the same-named existing '+kind+' instead of importing the proposed contents. Resolve the selected configuration before emission.',d,'error',{sharedKind:kind,sharedName:name,retained:retained.value,proposed,observedThrough:retained.origin});
   else if(absenceUnknown)issue('shared-create-absence-unknown','Capture the complete target '+kind+' inventory, including unused objects, to establish that this shared name is absent.',d,'error',{sharedKind:kind,sharedName:name,targetQueueScopeComplete:before.completeness.Queues===true});
  }
  const affected=[];
  if(d.action==='overwrite')for(const other of selected?.queues??[]){
   if(other.name===d.name||other.semantic===semantic)continue;
   const otherDecision=chosen.get(key('Queues',other.name));
   const row={name:other.name,sourceFileId:other.fileId,selection:otherDecision?.action??'outside-plan',before:other.value,after:proposed};
   if(otherDecision?.action==='keep-target')issue('retained-queue-shared-change','This shared-object overwrite changes another queue whose full configuration is selected as keep-target. Resolve both explicit decisions before emission.',d,'error',{sharedKind:kind,sharedName:name,retainedQueue:other.name,affectedQueue:row});
   else affected.push(row);
  }
  if(affected.length)issue('shared-object-affected-queues','This shared-object overwrite also changes the named captured target queues. Their full captures remain retained and comparison scope stays as explicitly selected.',d,'review',{sharedKind:kind,sharedName:name,affectedQueues:affected,targetQueueScopeComplete:before.completeness.Queues===true});
 }
 for(const d of decisions){
  if(!imported(d))continue;
  const value=d.proposed,fields=maps(value);
  if(d.family==='Services'){const short=fieldName(value,['NameShort']),parent=fieldName(value,['Parent']);if(typeof short!=='string'||(parent?parent+'::':'')+short!==d.name)issue('service-identity-changed','Native service Parent and NameShort would write a different full service name.',d);}
  if(d.family!=='GenericAgents'&&fields.Valid)lookup('Valid',scalar(fields.Valid,'Valid'),d,['Valid']);
  if(d.family==='Queues'||d.family==='Services'){
   const parts=d.name.split('::');
   for(let i=1;i<parts.length;i++)dependency(d.family,parts.slice(0,i).join('::'),d,['Name']);
   if(d.family==='Queues'){
    if(!t.context.maxQueueLevel)issue('queue-depth-unobserved','Retain the actual target maximum queue depth.',d);
    else if(parts.length>t.context.maxQueueLevel.value)issue('queue-depth-exceeded','Native queue import skips this hierarchy depth.',d);
    dependency('Groups',fieldName(value,['Group']),d,['Group']);
    if(fields.FollowUp)lookup('FollowUp',scalar(fields.FollowUp,'FollowUp'),d,['FollowUp']);
    for(const kind of SHARED_KINDS)if(fields[kind]?.kind==='map'){
     const name=fieldName(value,[kind,'Name']);named(name,'Embedded '+kind+' name');
     const ek=key(kind,name),prior=embedded.get(ek),sem=canonical(semanticNode(fields[kind]));
     if(prior&&prior.value!==sem)issue('shared-object-conflict','Selected queues provide different contents for the same '+kind+'.',d,'error',{sharedName:name,otherQueue:prior.queue});
     else embedded.set(ek,{value:sem,queue:d.name,action:d.action});
     const valid=fieldName(value,[kind,'Valid']);if(valid!==null)lookup('Valid',valid,d,[kind,'Valid']);
     if(kind==='SystemAddress')dependency('Queues',fieldName(value,[kind,'Queue']),d,[kind,'Queue']);
     reviewShared(kind,name,fields[kind],d);
     issue('shared-object-effect',d.action==='overwrite'?'This queue overwrite can update its shared '+kind+'.':'Native create retains a same-named existing '+kind+' when present.',d,'review',{sharedKind:kind,sharedName:name,targetQueueScopeComplete:before.completeness.Queues===true});
    }
   }else dependency('Services',fieldName(value,['Parent']),d,['Parent']);
  }
  if(d.family==='SLAs'&&fields.Services?.kind==='array')for(const name of strings(fields.Services,'SLA Services'))dependency('Services',name,d,['Services']);
  if(d.family==='Templates'){
   const state=fields.PreSelectedTicketStateID;
   if(state&&state.kind!=='null'&&state.value!==''&&state.value!=='0'){
    if(d.action==='create')issue('native-template-create-state','The native create path does not preserve PreSelectedTicketStateID; this selected value needs a separately supported operation.',d);
    else if(!(d.referenceOverrides??[]).some(o=>canonical(o.path)===canonical(['PreSelectedTicketStateID'])))issue('source-state-id','Reference the actual target state scalar before overwriting this source-bound numeric state ID.',d);
   }
  }
  if(d.family==='GenericAgents'){
   if(d.genericAgentReviewed!==true)issue('job-execution-review','Review this complete job action, schedule and activation before native import.',d);
   const pairs={Lock:['Locks',null],Owner:['Owners',null],Priority:['Priorities',null],Queue:[null,'Queues'],Service:[null,'Services'],SLA:[null,'SLAs'],State:['States',null],Type:[null,'Types']};
   for(const [stem,[set,family]]of Object.entries(pairs)){
    const single=fields['New'+stem];if(single&&single.kind!=='null'&&single.value!==''&&single.value!=='0'){const name=scalar(single,'New'+stem);if(family)dependency(family,name,d,['New'+stem]);else lookup(set,name,d,['New'+stem]);}
    const plural=fields[stem==='Priority'?'Priorities':stem==='SLA'?'SLAs':stem+'s'];if(plural?.kind==='array')for(const name of strings(plural,stem+'s')){if(family)dependency(family,name,d,[stem+'s']);else lookup(set,name,d,[stem+'s']);}
   }
  }
  if(d.family==='RoleGroups'){
   dependency('Roles',d.name,d,[]);
   const permissionList=t.context.permissionTypes?.values;
   if(!permissionList)issue('permission-types-unobserved','Capture the target System::Permission list.',d);
   else for(const permission of Object.keys(fields))if(!permissionList.includes(permission)&&strings(fields[permission],'Permission groups').length)issue('unsupported-permission','Native import ignores this permission type on the selected target.',d,'error',{permission});
   const resulting=permissions(value,permissionList?new Set(permissionList):null);
   for(const [group,perms]of resulting){dependency('Groups',group,d,[]);expectedRows.push(row(d.family,{role:d.name,group},{kind:'permission-set',permissions:perms}));scope.push({family:d.family,identity:{role:d.name,group},sourceFileId:d.sourceFileId,action:d.action});}
   issue('permission-replacement','Each mentioned role/group pair receives this complete permission set; unmentioned pairs remain unchanged.',d,'review',{pairs:[...resulting].map(([group,permissions])=>({group,permissions}))});
  }else if(d.family==='QueueTemplates'){
   dependency('Queues',d.name,d,[]);
   for(const template of new Set(strings(value,'Queue template list'))){dependency('Templates',template,d,[]);expectedRows.push(row(d.family,{queue:d.name,template},true));scope.push({family:d.family,identity:{queue:d.name,template},sourceFileId:d.sourceFileId,action:d.action});}
  }
 }
 for(const d of decisions)if(!['RoleGroups','QueueTemplates'].includes(d.family)&&d.action!=='exclude'){
  const value=d.action==='keep-target'?d.target?.value:d.proposed;
  if(value){expectedRows.push(row(d.family,{name:d.name},normalizedObject(d.family,value)));scope.push({family:d.family,identity:{name:d.name},sourceFileId:d.sourceFileId,action:d.action});}
 }
 for(const d of decisions)if(d.action==='keep-target'&&d.target){
  if(d.family==='RoleGroups')for(const [group,perms]of permissions(d.target.value,t.context.permissionTypes?new Set(t.context.permissionTypes.values):null)){expectedRows.push(row(d.family,{role:d.name,group},{kind:'permission-set',permissions:perms}));scope.push({family:d.family,identity:{role:d.name,group},sourceFileId:d.sourceFileId,action:d.action});}
  if(d.family==='QueueTemplates')for(const template of new Set(strings(d.target.value,'Retained target queue templates'))){expectedRows.push(row(d.family,{queue:d.name,template},true));scope.push({family:d.family,identity:{queue:d.name,template},sourceFileId:d.sourceFileId,action:d.action});}
 }
 const importOrder=[],visiting=new Set(),visited=new Set();
 function visit(k){if(visited.has(k))return;if(visiting.has(k)){issue('dependency-cycle','Selected native imports contain a dependency cycle.',chosen.get(k));return;}visiting.add(k);for(const dep of dependencies.get(k)??[])if(dep!==k)visit(dep);visiting.delete(k);visited.add(k);if(imported(chosen.get(k)))importOrder.push({family:chosen.get(k).family,name:chosen.get(k).name,sourceFileId:chosen.get(k).sourceFileId,action:chosen.get(k).action});}
 for(const d of decisions)if(imported(d))visit(d.key);
 importOrder.sort((a,b)=>FAMILIES.indexOf(a.family)-FAMILIES.indexOf(b.family)||(a.family==='Queues'?(a.action==='create'?0:1)-(b.action==='create'?0:1):0));
 if(plan.importOrder)need(canonical(plan.importOrder)===canonical(importOrder),'Reviewed native import order differs from the selected dependencies.');
 return {schema:'otobo.plan-review.v1',ready:!findings.some(f=>f.severity==='error'),sourceCaptureId:source.captureId,beforeCaptureId:before.captureId,planId:plan.planId,findings,decisions:decisions.map(d=>({family:d.family,name:d.name,action:d.action,sourceFileId:d.sourceFileId,reason:d.reason,before:d.target?.value??null,proposed:d.proposed,dependencies:[...dependencies.get(d.key)].map(x=>JSON.parse(x))})),expectedRows:sortRows(expectedRows),comparisonScope:scope,importOrder};
}
export function prepareConfigurationComparison({source,before,plan,after}){
 const review=evaluateConfigurationPlan({source,before,plan}),a=inspectConfigurationCapture(after);
 need(after.side==='target'&&after.caseId===source.caseId&&after.workspaceReference===before.workspaceReference,'Compare the independently returned original destination.');
 need(after.captureId!==before.captureId,'Retain a separately observed returned target capture.');
 need(Date.parse(after.observedAt)>=Date.parse(before.observedAt),'Returned target capture precedes its baseline.');
 const observedRows=[],coverage=[],findings=[...review.findings];
 for(const wanted of review.comparisonScope){
  const identity=wanted.identity;let found=false,observedContainer=false,value;
  if(wanted.family==='RoleGroups'){
   const entry=a.entries.get(key('RoleGroups',identity.role)),allowed=a.context.permissionTypes?.values;
   if(entry){observedContainer=true;const all=permissions(entry.value,allowed?new Set(allowed):null);if(all.has(identity.group)){found=true;value={kind:'permission-set',permissions:all.get(identity.group)};}}
  }else if(wanted.family==='QueueTemplates'){
   const entry=a.entries.get(key('QueueTemplates',identity.queue));
   observedContainer=!!entry;
   if(entry&&strings(entry.value,'Returned queue templates').includes(identity.template)){found=true;value=true;}
  }else{
   const entry=a.entries.get(key(wanted.family,identity.name));if(entry){found=true;value=normalizedObject(wanted.family,entry.value);}
  }
  const status=found?'observed':observedContainer||after.completeness[wanted.family]===true?'missing':'unknown';
  coverage.push({...wanted,status});
  if(found)observedRows.push(row(wanted.family,identity,value));
  if(status==='unknown')findings.push({severity:'error',code:'returned-coverage-unknown',family:wanted.family,identity,message:'The partial returned capture does not establish whether this selected entry exists.'});
 }
 sortRows(observedRows);
 const seen=new Map(observedRows.map(r=>[rowKey(r),r])),differences=review.expectedRows.flatMap(r=>{const observed=seen.get(rowKey(r));return observed?.value_json===r.value_json?[]:[{family:r.family,identity_json:r.identity_json,expected:r.value_json,observed:observed?.value_json??null,status:coverage.find(c=>c.family===r.family&&canonical(c.identity)===r.identity_json)?.status??'unknown'}];});
 return {schema:'otobo.configuration-comparison.v1',sourceCaptureId:source.captureId,beforeCaptureId:before.captureId,afterCaptureId:after.captureId,planId:plan.planId,ready:review.ready&&!coverage.some(c=>c.status==='unknown'),expectedRows:review.expectedRows,observedRows,coverage,findings,differences,importOrder:review.importOrder};
}

export function sealConfigurationPlan({source,before,reviewer,reviewedAt,decisions}){
 const body={schema:PLAN_SCHEMA,caseId:source.caseId,sourceCaptureId:source.captureId,targetCaptureId:before.captureId,expectedParser:clone(source.environment.parser),reviewer,reviewedAt,decisions:clone(decisions)};
 const draft={...body,planId:hash(body)},review=evaluateConfigurationPlan({source,before,plan:draft});
 const complete={...body,importOrder:review.importOrder};return {...complete,planId:hash(complete)};
}
