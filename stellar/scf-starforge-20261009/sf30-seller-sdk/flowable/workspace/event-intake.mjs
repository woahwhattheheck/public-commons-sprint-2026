// MIT. CloudEvents source intake on the existing Flowable workspace; all mutations remain original actions.
import {readFile} from 'node:fs/promises';
import {buildEventCaseProgramme,verifyEventOperation,stableRequest,compareEventProgramme,memberText} from './event-case.mjs';
const need=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'FLOWABLE_EVENT_INTAKE_REQUIRED',status:400});};
export async function previewFlowableEventIntake({workspace,input}){
 need(input&&typeof input==='object'&&typeof input.eventText==='string'&&typeof input.profileText==='string','Supply the complete original event and profile');
 need(Buffer.byteLength(input.eventText)<=1048576&&Buffer.byteLength(input.profileText)<=1048576,'Each original JSON source is limited to 1 MiB');
 need(Number.isSafeInteger(input.revision)&&input.revision>0&&typeof input.portfolioId==='string'&&typeof input.definitionId==='string'&&typeof input.connectionId==='string','Select the exact captured case revision and definition');
 const captured=await workspace.getRecord({kind:'casePortfolio',id:input.portfolioId,revision:input.revision});
 need(captured.value.connectionId===input.connectionId&&captured.value.state==='CAPTURED','Select a complete case capture from this connection');
 const selected=await workspace.readCaseDefinition({portfolioId:captured.id,revision:captured.revision,definitionId:input.definitionId});
 const resources=selected.resources.filter(resource=>resource.kind==='cmmn-definition-resource'&&
  resource.definitionIds?.includes(selected.definition.id)&&resource.deploymentId===selected.definition.deploymentId&&
  /\.(?:cmmn|cmmn\.xml|xml)$/i.test(resource.filename));
 need(resources.length===1,'Select the one original XML source associated with this case definition');
 return buildEventCaseProgramme({...input,definition:selected.definition,resource:resources[0]});
}
export async function readFlowableEventExample(name){
 need(['classification-change','missing-owner','schema-change'].includes(name),'Select a supplied metadata reference');
 return {eventText:await readFile(new URL('./examples/events/'+name+'.json',import.meta.url),'utf8'),
  profileText:await readFile(new URL('./examples/events/event-profile.json',import.meta.url),'utf8')};
}
export async function reviewFlowableEventIntake({workspace,input}){
 const programme=await workspace.readProgramme({id:input.programmeId});
 const row=programme.progress.rows.find(item=>item.key==='start-case');
 need(row?.record?.kind==='caseInstance'&&row.record.id===input.operationId,'Select this event programme original native operation');
 const operation=await workspace.getRecord({kind:'caseInstance',id:row.record.id,revision:row.record.revision});
 need(operation.sha256===row.record.sha256,'The selected operation revision changed');
 return verifyEventOperation({client:workspace,programme,operation});
}

export async function describeFlowableEventPreparation({workspace,input}){
 need(input&&typeof input.programmeId==='string','Select the saved event programme');
 const programme=await workspace.readProgramme({id:input.programmeId});
 const identity=compareEventProgramme(programme,memberText(programme,'event.json'),memberText(programme,'event-profile.json')).identity;
 return {method:'prepareProgrammeStep',args:{requestId:stableRequest(identity,'prepare'),id:programme.record.id,expectedRevision:1,stepKey:'start-case'}};
}
