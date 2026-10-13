// MIT. Selected Alfresco bytes mapped into one original Flowable process programme.
import {createHash} from 'node:crypto';
import {inspectAlfrescoDocument,documentMember,documentBytes,documentLosslessJSON,exactDocumentInteger} from './alfresco-document.mjs';
import {parseInterfaceJSON,inspectMapping,prepareMappedVariables,typedVariablesText} from './interface-contract-v2.mjs';
import {stableRequest,memberText} from './event-case.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=(v,m)=>{if(!v)throw Object.assign(new Error(m),{code:'FLOWABLE_DOCUMENT_REVIEW_REQUIRED'});};
const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
const exact=(o,keys,label)=>{need(o&&typeof o==='object'&&!Array.isArray(o),label+' must be an object');for(const k of Object.keys(o))need(keys.includes(k),label+' unknown field '+k);};
function pointer(root,path){
 need(typeof path==='string'&&/^\/(?:version|content)(?:\/|$)/.test(path)&&path.length<=1000,'Bind an original version/content JSON pointer');
 let v=root;for(const raw of path.slice(1).split('/')){need(!/~(?:[^01]|$)/.test(raw),'Invalid JSON pointer escape');const k=raw.replace(/~1/g,'/').replace(/~0/g,'~');need(v&&typeof v==='object'&&Object.hasOwn(v,k),'Original document field is absent: '+path);v=v[k];}return v;
}
export function inspectDocumentProfile(profileText,captureText){
 const capture=inspectAlfrescoDocument(captureText),profile=parseInterfaceJSON(profileText,'document profile');
 exact(profile,['schema','namespace','repositoryId','repositoryBaseUrl','mapping','bindings'],'document profile');
 need(profile.schema==='stellar-forge.alfresco-process-profile.v1'&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(profile.namespace??''),'Select an original document mapping profile');
 need(profile.repositoryId===capture.repository.id&&profile.repositoryBaseUrl===capture.repository.baseUrl,'Document belongs to another selected repository');
 const mapping=inspectMapping(JSON.stringify(profile.mapping));exact(profile.bindings,mapping.mapping.fields.map(x=>x.external),'bindings');
 const reserved=new Set(['documentRepository','documentNodeId','documentVersionId','documentContentSha256','documentCaptureSha256','documentContentBytes','documentName']);
 need(mapping.mapping.fields.every(x=>!reserved.has(x.native)),'Mapped field collides with retained document identity');
 const values=Object.create(null),root={version:capture.version,content:{sha256:capture.content.sha256,bytes:String(capture.content.bytes),mimeType:capture.content.mediaType}};
 for(const field of mapping.mapping.fields){
  if(!Object.hasOwn(profile.bindings,field.external)){need(!field.required,'Missing required field binding '+field.external);continue;}
  let value=pointer(root,profile.bindings[field.external]);
  // Exact long/double inputs use the original mapping's decimal-text contract.
  if(typeof value==='number'){
   need(field.type==='integer','Long and double repository properties require original exact decimal strings');
   const packet=JSON.parse(captureText),source=packet.reads.find(x=>x.role==='selected-before');
   const exactRoot={version:documentLosslessJSON(source.body).entry,content:root.content};
   value=exactDocumentInteger(pointer(exactRoot,profile.bindings[field.external]),'Mapped '+field.external,-2147483648,2147483647);
  }
  values[field.external]=value;
 }
 const mapped=prepareMappedVariables({mappingText:JSON.stringify(profile.mapping),values}),variables=[...mapped.variables,
  ...Object.entries({documentRepository:capture.repository.baseUrl,documentNodeId:capture.selection.nodeId,documentVersionId:capture.selection.versionId,
   documentContentSha256:capture.content.sha256,documentCaptureSha256:capture.capture.sha256,documentName:capture.version.name})
   .map(([name,value])=>({name,type:'string',value})),{name:'documentContentBytes',type:'long',value:String(capture.content.bytes)}];
 const identity=JSON.stringify(['alfresco-document-process.v1',profile.namespace,capture.repository.baseUrl,capture.selection.nodeId,capture.selection.versionId]);
 return{capture,profile,identity,variables,variablesText:typedVariablesText(variables),profileSha256:hash(profileText)};
}
export function buildDocumentProcessProgramme({captureText,profileText,definition,resource}){
 const selected=inspectDocumentProfile(profileText,captureText),{capture}=selected;
 need(definition?.id&&definition.key&&definition.deploymentId,'Select the exact captured BPMN process definition');
 need(resource?.kind==='deployment-resource'&&resource.deploymentId===definition.deploymentId&&resource.definitionIds?.includes(definition.id)&&/\.bpmn(?:20)?\.xml$|\.bpmn$/i.test(resource.filename??''),'Select the original BPMN XML resource associated with that definition');
 const xml=documentBytes(resource,1024*1024),definitionSource={id:definition.id,key:definition.key,version:definition.version??null,deploymentId:definition.deploymentId,tenantId:definition.tenantId??'',filename:resource.filename,bytes:xml.length,sha256:resource.sha256};
 const businessKey='document-'+hash(selected.identity),label=('Document review: '+capture.version.name+' · '+capture.selection.versionId).slice(0,250);
 const bodyText='{"processDefinitionId":'+JSON.stringify(definition.id)+',"businessKey":'+JSON.stringify(businessKey)+',"name":'+JSON.stringify(label)+',"variables":'+selected.variablesText+'}';
 const programme={schema:'stellar-forge.flowable-programme.v1',key:'document-'+hash(selected.identity),label,
  note:'Review this selected complete document version and mapped fields, then dispatch its original process start. Continue native human work and preserve the result in the complete workspace handover.',
  sources:[documentMember('alfresco-capture.json',captureText),documentMember('document-profile.json',profileText),documentMember('selected-definition.json',JSON.stringify(definitionSource,null,2)+'\n'),
   documentMember('selected-definition.bpmn20.xml',xml,'application/xml'),
   {name:'document-content.bin',...capture.content}],
  steps:[{key:'start-document-process',label:'Start selected document process',kind:'process',selection:{action:'start',bodyText}}]};
 // Keep a portable, fixed source name; the original repository filename remains in the full capture.
 programme.sources[4].name='document-content.bin';
 const programmeText=JSON.stringify(programme,null,2)+'\n';need(Buffer.byteLength(programmeText)<=16*1024*1024,'The complete programme exceeds the original 16 MiB limit');
 return{schema:'stellar-forge.document-process-preview.v1',identity:selected.identity,requestId:stableRequest(selected.identity,'save'),businessKey,label,
  capture:{...capture.capture,repository:capture.repository,selection:capture.selection,name:capture.version.name,content:{bytes:capture.content.bytes,sha256:capture.content.sha256,mediaType:capture.content.mediaType},consistency:capture.consistency,history:capture.history},
  profileSha256:selected.profileSha256,definition:definitionSource,variables:selected.variables,nativeRequest:{bodyText,sha256:hash(bodyText)},programme,programmeText};
}
export function rebuildDocumentProgramme(programme){
 const spec=programme.programme??programme,definition=parseInterfaceJSON(memberText(spec,'selected-definition.json'),'selected BPMN definition'),xml=spec.sources.find(x=>x.name==='selected-definition.bpmn20.xml');
 const rebuilt=buildDocumentProcessProgramme({captureText:memberText(spec,'alfresco-capture.json'),profileText:memberText(spec,'document-profile.json'),definition,
  resource:{...xml,kind:'deployment-resource',filename:definition.filename,deploymentId:definition.deploymentId,definitionIds:[definition.id]}});
 const portable={...spec,steps:spec.steps.map(step=>{const {dependencies,...original}=step;need(dependencies===undefined||Array.isArray(dependencies)&&dependencies.length===0,'This original start has no derived dependencies');return original;})};
 need(canonical(portable)===canonical(rebuilt.programme),'Original document programme differs from its complete capture, profile or selected BPMN source');
 return rebuilt;
}
export async function verifyDocumentProcessOperation({client,programme,operation}){
 const rebuilt=rebuildDocumentProgramme(programme),selected=rebuilt.definition;
 need(operation.kind==='process','Select this original process operation');
 const selection=(await client.readSource({reference:operation.value.selection})).value;
 need(selection.action==='start'&&selection.bodyText===rebuilt.nativeRequest.bodyText,'Prepared start differs from the complete selected document and mapping');
 const before=(await client.readSource({reference:operation.value.before})).value,d=before.definitions?.find(x=>x.id===selected.id);
 need(d?.key===selected.key&&d.deploymentId===selected.deploymentId&&d.version===selected.version&&(d.tenantId??'')===selected.tenantId,'Prepared native definition differs from the selected edition');
 let resource=before.resources?.find(x=>x.kind==='deployment-resource'&&x.deploymentId===selected.deploymentId&&x.definitionIds?.includes(selected.id)&&x.filename===selected.filename);
 need(resource?.sha256===selected.sha256&&resource.bytes===selected.bytes,'Prepared BPMN source differs from the selected XML');
 if(resource.definitionRef)resource={...resource,...(await client.readSource({reference:resource.definitionRef})).value};
 documentBytes(resource,1024*1024);
 const result={schema:'stellar-forge.document-process-review.v1',preparedDefinition:selected,captureSha256:rebuilt.capture.sha256,contentSha256:rebuilt.capture.content.sha256,
  operation:{kind:operation.kind,id:operation.id,revision:operation.revision,sha256:operation.sha256},state:operation.value.state};
 if(operation.value.state==='CONFIRMED'){
  const reconciliation=(await client.readSource({reference:operation.value.reconciliation})).value,ids=reconciliation.evidence?.processInstanceIds;
  need(Array.isArray(ids)&&ids.length===1&&typeof ids[0]==='string','Original reconciliation must identify the one actual native process');
  const after=(await client.readSource({reference:operation.value.after})).value;
  const actual=[...(after.processes??[]),...(after.historicProcesses??[])].filter(x=>x.id===ids[0]);
  need(actual.length>0&&actual.every(x=>x.processDefinitionId===selected.id&&x.businessKey===rebuilt.businessKey),'Original selected native process does not match its reviewed document request');
  result.processInstanceId=ids[0];result.originalProcessRecords=actual;
 }
 return result;
}
