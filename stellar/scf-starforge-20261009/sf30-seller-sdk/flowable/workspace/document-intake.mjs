import {readFile} from 'node:fs/promises';
// MIT. Read-only document preparation/review helpers over the existing workspace.
import {buildDocumentProcessProgramme,rebuildDocumentProgramme,verifyDocumentProcessOperation} from './document-process.mjs';
import {stableRequest} from './event-case.mjs';
const need=(ok,m)=>{if(!ok)throw Object.assign(new Error(m),{code:'FLOWABLE_DOCUMENT_REVIEW_REQUIRED'});};
export async function previewFlowableDocumentIntake({workspace,input}){
 need(input&&Number.isSafeInteger(input.revision)&&input.revision>0,'Select a complete saved BPMN capture revision');
 const captured=await workspace.getRecord({kind:'portfolio',id:input.portfolioId,revision:input.revision});
 need(captured.value.state==='CAPTURED'&&captured.value.connectionId===input.connectionId,'The saved process capture belongs to another selected connection');
 const selected=await workspace.readDefinition({portfolioId:captured.id,revision:captured.revision,definitionId:input.definitionId});
 const resources=selected.resources.filter(x=>x.kind==='deployment-resource'&&x.deploymentId===selected.definition.deploymentId&&x.definitionIds?.includes(selected.definition.id)&&/\.bpmn(?:20)?\.xml$|\.bpmn$/i.test(x.filename??''));
 need(resources.length===1,'Select a definition with one exact original BPMN XML resource');
 return buildDocumentProcessProgramme({captureText:input.captureText,profileText:input.profileText,definition:selected.definition,resource:resources[0]});
}
export async function describeFlowableDocumentPreparation({workspace,input}){
 const programme=await workspace.readProgramme({id:input.programmeId}),preview=rebuildDocumentProgramme(programme);
 return{method:'prepareProgrammeStep',args:{requestId:stableRequest(preview.identity,'prepare'),id:programme.record.id,expectedRevision:1,stepKey:'start-document-process'}};
}
export async function reviewFlowableDocumentIntake({workspace,input}){
 const programme=await workspace.readProgramme({id:input.programmeId}),row=programme.progress.rows.find(x=>x.key==='start-document-process');
 need(row?.record?.id===input.operationId,'Select this programme original process operation');
 const operation=await workspace.getRecord({kind:'process',id:row.record.id,revision:row.record.revision});
 need(operation.sha256===row.record.sha256,'The exact selected native process revision changed');
 return verifyDocumentProcessOperation({client:workspace,programme,operation});
}
export async function readFlowableDocumentResult({workspace,input}){
 const review=await reviewFlowableDocumentIntake({workspace,input});need(review.processInstanceId,'The original process start remains unresolved');
 const p=await workspace.readProgramme({id:input.programmeId}),child=p.progress.rows.find(x=>x.key==='start-document-process').record,
  original=await workspace.getRecord({kind:'process',id:child.id,revision:child.revision}),capture=await workspace.getRecord({kind:'portfolio',id:input.portfolioId,revision:input.revision});
 need(capture.value.state==='CAPTURED'&&capture.value.connectionId===original.value.connectionId,'Select a result capture from the same original connection');
 const collections={};
 for(const collection of ['processes','tasks','historicProcesses','historicTasks','historicActivities','historicVariables']){
  let offset=0,rows=[];do{const page=await workspace.readPortfolio({id:capture.id,revision:capture.revision,collection,offset,limit:500});need(page.complete,'Original result capture is incomplete');rows.push(...page.items.filter(x=>(['processes','historicProcesses'].includes(collection)?x.id:x.processInstanceId)===review.processInstanceId));offset=page.nextOffset;}while(offset!==null);
  collections[collection]=rows;
 }
 need(collections.processes.length+collections.historicProcesses.length>0,'The selected saved capture does not contain this actual process; refresh native history');
 return{schema:'stellar-forge.document-process-result.v1',programme:p.record,operation:child,review,portfolio:{id:capture.id,revision:capture.revision,sha256:capture.sha256},collections};
}

export async function readFlowableDocumentExample(){
 const root=new URL('./examples/documents/',import.meta.url);
 return{captureText:await readFile(new URL('authored-capture.json',root),'utf8'),profileText:await readFile(new URL('document-profile.json',root),'utf8')};
}
