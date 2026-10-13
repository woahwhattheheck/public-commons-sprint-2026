// MIT. Original document/process programme, complete native history and independent adoption.
import {createHash} from 'node:crypto';
import {receiveFlowableProgramme} from './native-programme-receiving.mjs';
import {rebuildDocumentProgramme,verifyDocumentProcessOperation} from './document-process.mjs';
import {readFlowableDocumentResult} from './document-intake.mjs';
import {stableRequest} from './event-case.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const methods=client=>new Proxy({}, {get:(_,name)=>args=>client.call(name,args)});
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function receiveFlowableDocument({client,receiver,programmeInput,archivePath,state,retain,signal}){
 need(state&&typeof retain==='function','Use the original durable document receiving checkpoint');
 const spec=JSON.parse(programmeInput.programmeText),preview=rebuildDocumentProgramme(spec),producer=methods(client);
 const before=await client.view(),destination=await receiver.view();
 need(typeof before.workspaceId==='string'&&before.workspaceId.length&&typeof destination.workspaceId==='string'&&destination.workspaceId.length&&before.workspaceId!==destination.workspaceId,'Select distinct actual producer and receiving workspaces');
 state.programme??={};state.document??={};await retain(state);
 const result=await receiveFlowableProgramme({client,receiver,programmeInput,archivePath,state:state.programme,retain:()=>retain(state),signal,
  reviewOperation:async({operation,phase})=>{
   const current=await client.call('readProgramme',{id:state.programme.results.programme.id});
   const review=await verifyDocumentProcessOperation({client:producer,programme:current,operation});
   if(phase!=='confirmed')return;
   const command=state.document.captureInput??{requestId:stableRequest(preview.identity,'result-capture'),connectionId:programmeInput.connectionId,label:preview.label+' · complete process/history'};
   if(!state.document.captureInput){state.document.captureInput=command;await retain(state);}
   const capture=state.document.capture??await client.call('capturePortfolio',command);
   need(capture.value.state==='CAPTURED','Complete the original process/history capture before exporting');
   if(!state.document.capture){state.document.capture={id:capture.id,revision:capture.revision,sha256:capture.sha256,value:{state:capture.value.state}};await retain(state);}
   const retained=await readFlowableDocumentResult({workspace:producer,input:{programmeId:current.record.id,operationId:operation.id,portfolioId:capture.id,revision:capture.revision}});
   need(retained.review.processInstanceId===review.processInstanceId,'Saved history differs from the selected actual process');
   const digest=hash(JSON.stringify(retained));
   if(state.document.resultSha256)need(state.document.resultSha256===digest,'The original selected result revision changed');
   else{state.document.result=retained;state.document.resultSha256=digest;await retain(state);}
  }});
 const received=await receiver.call('readProgramme',{id:result.programme}),receivedPreview=rebuildDocumentProgramme(received);
 need(receivedPreview.capture.sha256===preview.capture.sha256&&receivedPreview.capture.content.sha256===preview.capture.content.sha256,'Received source is another document edition');
 const original=state.document.result,adopted=await readFlowableDocumentResult({workspace:methods(receiver),input:{programmeId:result.programme,operationId:original.operation.id,portfolioId:original.portfolio.id,revision:original.portfolio.revision}});
 need(hash(JSON.stringify(adopted))===state.document.resultSha256,'Independent original process/history/source differs from the saved complete result');
 state.document.received={state:'ADOPTED',processInstanceId:adopted.review.processInstanceId,captureSha256:preview.capture.sha256,contentSha256:preview.capture.content.sha256,selectedResultSha256:state.document.resultSha256,workspaceId:destination.workspaceId};
 await retain(state);return{...result,document:state.document.received};
}
export async function reopenFlowableDocument({client,state}){
 const original=state.document.result,programme=await client.call('readProgramme',{id:original.programme.id});
 rebuildDocumentProgramme(programme);
 const reopened=await readFlowableDocumentResult({workspace:methods(client),input:{programmeId:original.programme.id,operationId:original.operation.id,portfolioId:original.portfolio.id,revision:original.portfolio.revision}});
 need(hash(JSON.stringify(reopened))===state.document.resultSha256,'Cold reopening changed original document/process/history');
 return{state:'REOPENED',processInstanceId:reopened.review.processInstanceId,resultSha256:state.document.resultSha256};
}
