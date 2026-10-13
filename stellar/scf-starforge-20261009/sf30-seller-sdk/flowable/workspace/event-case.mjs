// MIT. CloudEvents structured JSON intake over the existing saved Flowable programme.
import {createHash} from 'node:crypto';
import {parseInterfaceJSON,inspectMapping,prepareMappedVariables,typedVariablesText} from './interface-contract-v2.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const requireValue=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'EVENT_INTAKE_REVIEW_REQUIRED'});};
const str=(v,max=2000)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);
const exact=(o,allowed,label)=>{requireValue(o&&typeof o==='object'&&!Array.isArray(o),label+' must be an object');for(const k of Object.keys(o))requireValue(allowed.includes(k),label+' has an unknown field '+k);};
export function stableRequest(identity,action){
 const h=hash(JSON.stringify(['commons.metadata-case-intake.v1',identity,action]));
 return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
export function sourceMember(name,text,mediaType='application/json'){
 const bytes=Buffer.from(text,'utf8');
 requireValue(bytes.length<=1024*1024,'Each source is limited to 1 MiB');
 return{name,bytes:bytes.length,sha256:hash(bytes),mediaType,contentBase64:bytes.toString('base64')};
}
function uri(value,absolute=false){
 requireValue(str(value)&&!/\s|[<>"{}|\\^`]/.test(value),'Use a nonempty URI reference');
 try{const u=absolute?new URL(value):new URL(value,'https://reference.invalid/');requireValue(!!u.protocol,'URI scheme missing');}catch{throw Error('Invalid URI reference');}
}
export function inspectEvent(eventText,profileText){
 const event=parseInterfaceJSON(eventText,'original event'),profile=parseInterfaceJSON(profileText,'event mapping profile');
 exact(profile,['schema','namespace','source','types','dataschema','mapping'],'profile');
 requireValue(profile.schema==='commons.metadata-case-event-profile.v1'&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(profile.namespace),'Select a named event profile');
 uri(profile.source);uri(profile.dataschema,true);
 requireValue(Array.isArray(profile.types)&&profile.types.length>0&&profile.types.length<=12&&new Set(profile.types).size===profile.types.length&&profile.types.every(x=>str(x,300)),'Select one to twelve exact event types');
 const inspected=inspectMapping(JSON.stringify(profile.mapping));
 const reserved=new Set(['eventId','eventSource','eventType','eventSha256','eventSchema','eventSubject','eventTime']);
 requireValue(inspected.mapping.fields.every(f=>!reserved.has(f.native)),'Mapped names collide with retained event identity');
 requireValue(event.specversion==='1.0'&&str(event.id,1000)&&str(event.type,300),'CloudEvents 1.0 requires id, source, type and specversion');
 uri(event.source);requireValue(event.source===profile.source&&profile.types.includes(event.type),'Event source/type differs from the selected profile');
 requireValue(event.dataschema===profile.dataschema,'Event data schema differs from the selected profile');
 requireValue(!own(event,'data_base64')&&(!own(event,'datacontenttype')||event.datacontenttype==='application/json'),'This adapter selects structured JSON object data');
 for(const key of Object.keys(event)){
  if(key==='data')continue;
  requireValue(/^[a-z0-9]+$/.test(key),'CloudEvent attribute names use lower-case letters and digits');
  const v=event[key];
  requireValue(typeof v==='boolean'||(Number.isInteger(v)&&v>=-2147483648&&v<=2147483647)||str(v,4000),'Unsupported context attribute '+key);
 }
 if(own(event,'subject'))requireValue(str(event.subject,4000),'CloudEvent subject must be a nonempty bounded string');
 if(own(event,'time')){
  const match=typeof event.time==='string'&&/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-](\d\d):(\d\d))$/.exec(event.time);
  const year=Number(match?.[1]),month=Number(match?.[2]),day=Number(match?.[3]),leap=year%4===0&&(year%100!==0||year%400===0),
   days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  requireValue(match&&month>=1&&month<=12&&day>=1&&day<=days[month-1]&&Number(match[4])<=23&&Number(match[5])<=59&&Number(match[6])<=59&&
   (match[7]===undefined||Number(match[7])<=23&&Number(match[8])<=59)&&Number.isFinite(Date.parse(event.time)),
   'Event time must be a valid RFC3339 calendar timestamp');
 }
 const mapped=prepareMappedVariables({mappingText:JSON.stringify(profile.mapping),values:event.data});
 const digest=hash(Buffer.from(eventText,'utf8')),identity=JSON.stringify([profile.namespace,event.source,event.id]);
 const variables=[...mapped.variables,{name:'eventId',type:'string',value:event.id},{name:'eventSource',type:'string',value:event.source},
  {name:'eventType',type:'string',value:event.type},{name:'eventSha256',type:'string',value:digest},{name:'eventSchema',type:'string',value:event.dataschema}];
 for(const [name,key]of [['eventSubject','subject'],['eventTime','time']])if(own(event,key))variables.push({name,type:'string',value:event[key]});
 return{event,profile,identity,eventSha256:digest,profileSha256:hash(profileText),variables,variablesText:typedVariablesText(variables)};
}
export function buildEventCaseProgramme({eventText,profileText,definition,resource}){
 const intake=inspectEvent(eventText,profileText);
 requireValue(definition&&str(definition.id)&&str(definition.key)&&str(definition.deploymentId),'Select a captured native case definition');
 requireValue(resource&&str(resource.filename)&&typeof resource.contentBase64==='string'&&/^[a-f0-9]{64}$/.test(resource.sha256??''),'Select its retained native XML resource');
 const bytes=Buffer.from(resource.contentBase64,'base64');
 requireValue(bytes.toString('base64')===resource.contentBase64&&bytes.length===resource.bytes&&hash(bytes)===resource.sha256&&bytes.length<=1024*1024,'Native source identity changed');
 requireValue(resource.deploymentId===definition.deploymentId&&(resource.definitionId===definition.id||resource.definitionIds?.includes(definition.id)||resource.filename===definition.resource||resource.filename===definition.resourceName),'Resource does not belong to the selected definition');
 const definitionSource={id:definition.id,key:definition.key,version:definition.version??null,deploymentId:definition.deploymentId,
  tenantId:definition.tenantId??'',filename:resource.filename,bytes:resource.bytes,sha256:resource.sha256};
 const businessKey='event-'+hash(intake.identity),name=('Metadata review: '+(intake.event.subject??intake.event.id)).slice(0,250);
 const bodyText='{"caseDefinitionId":'+JSON.stringify(definition.id)+',"businessKey":'+JSON.stringify(businessKey)+',"name":'+JSON.stringify(name)+',"variables":'+intake.variablesText+'}';
 const programme={schema:'stellar-forge.flowable-programme.v1',key:'metadata-'+hash(intake.identity),label:name,
  note:'Import the exact event into the selected case definition. Review the native start request before dispatch, then perform human case work in the original workspace.',
  sources:[sourceMember('event.json',eventText),sourceMember('event-profile.json',profileText),sourceMember('selected-definition.json',JSON.stringify(definitionSource,null,2)+'\n'),
   {name:'selected-definition.cmmn.xml',bytes:bytes.length,sha256:resource.sha256,mediaType:'application/xml',contentBase64:resource.contentBase64}],
  steps:[{key:'start-case',label:'Start the selected metadata review case',kind:'caseInstance',selection:{action:'startCase',bodyText}}]};
 return{schema:'commons.metadata-case-preview.v1',identity:intake.identity,eventSha256:intake.eventSha256,profileSha256:intake.profileSha256,
  requestId:stableRequest(intake.identity,'save'),businessKey,definition:definitionSource,variables:intake.variables,
  nativeRequest:{bodyText,sha256:hash(bodyText)},programme,programmeText:JSON.stringify(programme,null,2)+'\n'};
}
export function compareEventProgramme(original,eventText,profileText){
 const intake=inspectEvent(eventText,profileText),spec=original.programme??original;
 const source=Object.fromEntries(spec.sources.map(x=>[x.name,x]));
 requireValue(source['event.json']?.sha256===intake.eventSha256&&source['event-profile.json']?.sha256===intake.profileSha256,
  'This source/id already has different original event or mapping bytes; reopen the saved source for resolution');
 return intake;
}
export async function saveEventCase({client,eventText,profileText,connectionId,definition,resource}){
 const preview=buildEventCaseProgramme({eventText,profileText,definition,resource});
 const record=await client.saveProgramme({requestId:preview.requestId,connectionId,programmeText:preview.programmeText});
 const programme=await client.readProgramme({id:record.id});compareEventProgramme(programme,eventText,profileText);
 return{preview,programme};
}
export async function prepareEventCase({client,id}){
 const p=await client.readProgramme({id}),event=memberText(p,'event.json'),profile=memberText(p,'event-profile.json'),i=compareEventProgramme(p,event,profile);
 const prepared=await client.prepareProgrammeStep({requestId:stableRequest(i.identity,'prepare'),id,expectedRevision:1,stepKey:'start-case'});
 const sourceReview=prepared.operation.value.before?await verifyEventOperation({client,programme:p,operation:prepared.operation}):null;
 return{...prepared,sourceReview,review:await client.readReview({kind:'caseInstance',id:prepared.operation.id})};
}
export function memberText(p,name){
 const member=(p.programme??p).sources.find(x=>x.name===name);requireValue(member,'Missing complete original source '+name);
 const b=Buffer.from(member.contentBase64,'base64');requireValue(b.toString('base64')===member.contentBase64&&b.length===member.bytes&&hash(b)===member.sha256,'Changed source '+name);
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
}
export async function verifyEventOperation({client,programme,operation}){
 const spec=programme.programme??programme,selected=JSON.parse(memberText(spec,'selected-definition.json'));
 const originalXml=spec.sources.find(item=>item.name==='selected-definition.cmmn.xml');
 requireValue(spec.steps.length===1&&spec.steps[0].key==='start-case'&&spec.steps[0].kind==='caseInstance','Select the original single event-start programme');
 const rebuilt=buildEventCaseProgramme({eventText:memberText(spec,'event.json'),profileText:memberText(spec,'event-profile.json'),
  definition:selected,resource:{...originalXml,filename:selected.filename,deploymentId:selected.deploymentId,definitionIds:[selected.id]}});
 requireValue(spec.steps[0].selection.action==='startCase'&&spec.steps[0].selection.bodyText===rebuilt.nativeRequest.bodyText,'Saved native start differs from its complete event and mapping sources');
 const selection=(await client.readSource({reference:operation.value.selection})).value;
 requireValue(selection.action==='startCase'&&selection.bodyText===spec.steps[0].selection.bodyText,'Prepared native body differs from the retained original event programme');
 const before=(await client.readSource({reference:operation.value.before})).value;
 const definition=before.definitions?.find(x=>x.id===selected.id);
 requireValue(definition?.key===selected.key&&definition.deploymentId===selected.deploymentId,'Prepared native definition differs from the selected source edition');
 let resource=before.resources?.find(x=>x.kind==='cmmn-definition-resource'&&x.deploymentId===selected.deploymentId&&x.definitionIds?.includes(selected.id)&&x.filename===selected.filename);
 requireValue(resource&&resource.bytes===selected.bytes&&resource.sha256===selected.sha256,'Prepared definition XML changed; inspect the new edition');
 if(resource.definitionRef)resource={...resource,...(await client.readSource({reference:resource.definitionRef})).value};
 const b=Buffer.from(resource.contentBase64??'','base64');
 requireValue(b.length===selected.bytes&&hash(b)===selected.sha256,'Retained prepared XML does not match the selected full source');
 return{schema:'commons.metadata-case-native-source-review.v1',preparedDefinition:selected,operation:{kind:operation.kind,id:operation.id,revision:operation.revision,sha256:operation.sha256},sourceSha256:selected.sha256};
}
export async function dispatchEventCase({client,id,operationId,planSha256}){
 const p=await client.readProgramme({id}),i=compareEventProgramme(p,memberText(p,'event.json'),memberText(p,'event-profile.json'));
 const row=p.progress.rows.find(x=>x.key==='start-case');
 requireValue(row?.record?.id===operationId,'Dispatch must select this programme original child');
 let operation=await client.getRecord({kind:'caseInstance',id:operationId});
 requireValue(operation.value.planSha256===planSha256,'Review the exact current native request');
 await verifyEventOperation({client,programme:p,operation});
 if(['UNKNOWN','DISPATCHED','READBACK'].includes(operation.value.state)){
  operation=await client.reconcileOperation({requestId:stableRequest(i.identity,'reconcile'),kind:'caseInstance',id:operationId});
 }else if(operation.value.phase==='PREPARED'){
  operation=await client.dispatchCaseInstance({requestId:stableRequest(i.identity,'dispatch'),id:operationId,expectedRevision:operation.revision,planSha256});
 }
 return{operation,programme:await client.readProgramme({id}),review:await client.readReview({kind:'caseInstance',id:operationId})};
}
