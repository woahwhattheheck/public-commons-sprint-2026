// MIT. Workflow reports through the original authenticated Console client and archive engine.
import { OpenApiWorkflowClient } from './openapi-workflow-client.mjs';
import { canonical, fail } from './records.mjs';
import { MAX_WORKFLOW_REPORT_REQUEST_BYTES, validateWorkflowReportPacket } from './workflow-reports.mjs';
import { captureWorkflowReport, writeWorkflowReportExports, reopenWorkflowReportExports,
  readWorkflowReportFile } from './workflow-report-files.mjs';

export { writeWorkflowReportExports, reopenWorkflowReportExports, readWorkflowReportFile };
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,message,code='CONSOLE_REPORT_CLIENT',status=400)=>{if(!value)throw fail(code,message,status);};
const same=(a,b)=>canonical(a)===canonical(b);
const identifier=value=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),
    'Select an original saved profile, workflow or run identifier.');
  return value;
};
function selection(input) {
  need(plain(input)&&Object.keys(input).every(key=>['runId','baselineRunId'].includes(key)),
    'Select one original run and an optional baseline run.');
  return {runId:identifier(input.runId),baselineRunId:input.baselineRunId==null?null:identifier(input.baselineRunId)};
}
async function reportResponse(response) {
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){
    bytes+=chunk.length;
    need(bytes<=MAX_WORKFLOW_REPORT_REQUEST_BYTES,
      'The complete report response exceeds its original capacity.','CONSOLE_REPORT_TOO_LARGE',413);
    chunks.push(chunk);
  }
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));}
  catch{throw fail('CONSOLE_REPORT_RESPONSE','Read the complete original report response.',400);}
}
export class MerchantWorkflowReportClient {
  constructor(options){this.console=new OpenApiWorkflowClient(options);}
  host(){return this.console.host();}
  profiles(){return this.console.profiles();}
  profile(id){return this.console.profile(identifier(id));}
  workflows(profileId){return this.console.json('workflows?'+new URLSearchParams({profile:identifier(profileId)}));}
  run(id){return this.console.run(identifier(id));}

  async build(input) {
    const selected=selection(input),query=new URLSearchParams({run:selected.runId});
    if(selected.baselineRunId!==null)query.set('baseline',selected.baselineRunId);
    const response=await this.console.response('workflow-report?'+query,{},reportResponse);
    const packet=validateWorkflowReportPacket(response?.packet);
    need(same(packet.selection,selected),'The returned report selected different original runs.',
      'CONSOLE_REPORT_RESPONSE',409);
    return packet;
  }
  async review(packet) {
    packet=JSON.parse(JSON.stringify(validateWorkflowReportPacket(packet)));
    const review=await this.console.json('workflow-report-review',{packet});
    need(review?.contentSha256===packet.contentSha256&&review.archiveSha256===packet.archive.contentSha256&&
      review.profile?.id===packet.archive.profile.id&&same(review.report,packet.report),
      'The returned review belongs to a different original report.','CONSOLE_REPORT_RESPONSE',409);
    return review;
  }
  async history(input) {
    const selected=selection(input),current=await this.run(selected.runId);
    const baseline=selected.baselineRunId===null?null:await this.run(selected.baselineRunId);
    need(current?.run?.id===selected.runId&&(!baseline||baseline.run?.id===selected.baselineRunId&&
      baseline.run.profileId===current.run.profileId&&baseline.run.workflowId===current.run.workflowId),
      'Reopen the original runs of the same workflow.','CONSOLE_REPORT_RESPONSE',409);
    const profile=await this.profile(current.run.profileId);
    need(profile?.profile?.id===current.run.profileId,
      'The reopened profile differs from the selected original history.','CONSOLE_REPORT_RESPONSE',409);
    return {selection:selected,profile,run:current.run,baseline:baseline?.run??null};
  }
  async receive(packet,{expectedContentSha256=packet?.contentSha256}={}) {
    packet=JSON.parse(JSON.stringify(validateWorkflowReportPacket(packet)));
    need(expectedContentSha256===packet.contentSha256,
      'Use the digest of this complete selected report.','CONSOLE_REPORT_REVIEW',409);
    const review=await this.review(packet);
    const received=await this.console.json('workflow-report-receive',{packet,expectedContentSha256});
    try{
      need(received?.reportSha256===packet.contentSha256&&received.profile?.id===packet.archive.profile.id&&
        same(received.selection,packet.selection),
        'The receiving response belongs to different original history.','CONSOLE_REPORT_RESPONSE',409);
    }catch(error){error.outcomeUnknown=true;throw error;}
    try{return {review,received,history:await this.history(packet.selection)};}
    catch(error){error.receivingCompleted=true;error.received=received;throw error;}
  }
  capture(input){return captureWorkflowReport(this,input);}
  close(){this.console.close();}
}
