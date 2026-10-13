// SPDX-License-Identifier: MIT
// One original research→portfolio→full cold receiving course. No source acquisition or screening.
import {spawn} from 'node:child_process';
import {receiveReviewerExchange} from '../../../../../products/source-monitoring/receiving/reviewer-exchange.mjs';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {lstat,readFile,rename} from 'node:fs/promises';
import {openGleifWorkspace,receiveGleifWorkspace} from '../workspace.mjs';
import {privateDirectory,readPrivate,createFile,bytes,identity,digest,atomicJson} from '../../postgres/publisher/files.mjs';
import {need,stable,label} from '../core.mjs';

const SCHEMA='stellar-forge.gleif-monitoring-receiving.v1';
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function retained(path,raw){
  if(await exists(path))need((await readPrivate(path,256*1024*1024)).equals(raw),'GLEIF_RECEIVING_CHANGED','The original receiving file differs: '+path);
  else await createFile(path,raw);
}
async function python(command,args){
  return new Promise((resolve_,reject)=>{
    const child=spawn(command,['-B',...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const out=[],err=[];let count=0;
    child.stdout.on('data',data=>{count+=data.length;if(count>64*1024*1024){child.kill();reject(Error('The native receiving response exceeded its complete output limit.'));}else out.push(data);});
    child.stderr.on('data',data=>{if(Buffer.concat(err).length<1024*1024)err.push(data);});
    child.on('error',reject);child.on('close',code=>{
      if(code!==0){reject(Error('Original Monitoring command exited '+code+': '+Buffer.concat(err).toString('utf8')));return;}
      try{resolve_(JSON.parse(Buffer.concat(out).toString('utf8')));}catch(error){reject(Error('The original Monitoring response was not complete JSON: '+error.message));}
    });
  });
}

async function followingReviewer(receipt, configuration, pythonCommand, originalOutput) {
  need(configuration&&typeof configuration==='object'&&!Array.isArray(configuration)&&
    ['connectionFile','output','selection'].every(key=>Object.hasOwn(configuration,key))&&
    Object.keys(configuration).every(key=>['connectionFile','output','selection'].includes(key)),
    'GLEIF_REVIEWER_CONTINUATION','Select the complete original reviewer continuation configuration.');
  const followingOutput=resolve(configuration.output),relativeOutput=relative(originalOutput,followingOutput);
  need(relativeOutput!==''&&!isAbsolute(relativeOutput)&&relativeOutput!=='..'&&!relativeOutput.startsWith('../'),
    'GLEIF_REVIEWER_OUTPUT','Use a separate named following directory inside the original receiving output.');
  need(configuration.selection?.workspace===receipt.originalMonitoringWorkspace,
    'GLEIF_REVIEWER_WORKSPACE','Continue the original Monitoring workspace in this same programme.');
  const following=await receiveReviewerExchange({connectionFile:configuration.connectionFile,pythonCommand,
    output:followingOutput,selection:configuration.selection});
  return {...receipt,followingReviewerExchange:following};
}
async function retainedBaseline(output, basis) {
  const receiptPath=join(output,'gleif-monitoring-receiving.json');
  if(!await exists(receiptPath))return null;
  const receipt=JSON.parse(await readPrivate(receiptPath,256*1024*1024));
  need(receipt.schema===SCHEMA&&receipt.state==='COMPLETE'&&
    receipt.originalResearchWorkspace===basis.gleifWorkspace&&receipt.originalMonitoringWorkspace===basis.monitoringWorkspace,
    'GLEIF_REVIEWER_BASELINE','Select the original complete receiving result.');
  const intent=JSON.parse(await readPrivate(join(output,'receiving-intent.json')));
  const expected={schema:SCHEMA,workspaceId:intent.basis.workspaceId,selection:basis.selection,
    monitoringWorkspace:basis.monitoringWorkspace,reviewer:basis.reviewer,note:basis.note,
    ...(basis.refreshSelection===null?{}:{refreshSelection:basis.refreshSelection})};
  need(stable(intent.basis)===stable(expected),'GLEIF_REVIEWER_BASELINE','The original complete baseline selection changed.');
  const hash=createHash('sha256');let size=0;
  for await(const part of createReadStream(receipt.archive.path)){size+=part.length;hash.update(part);}
  need(size===receipt.archive.bytes&&hash.digest('hex')===receipt.archive.sha256,'GLEIF_REVIEWER_BASELINE','The original complete baseline archive changed.');
  for(const file of receipt.files){
    const raw=await readPrivate(join(output,file.name),256*1024*1024);
    need(raw.length===file.bytes&&digest(raw)===(file.sha256??file.id),'GLEIF_REVIEWER_BASELINE','A complete original baseline file changed.');
  }
  return receipt;
}

export async function receiveMonitoring({gleifWorkspace,monitoringWorkspace,selection,pythonCommand,output,reviewer,note='',refreshSelection=null,reviewerExchange=null}) {
  for(const value of [gleifWorkspace,monitoringWorkspace,pythonCommand,output])need(typeof value==='string'&&isAbsolute(value),'GLEIF_RECEIVING_PATH','Use explicit absolute application, workspace, Python and output paths.');
  for(const workspace of [gleifWorkspace,monitoringWorkspace]){
    const below=relative(workspace,output);
    need(below!==''&&(below==='..'||below.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(below)),'GLEIF_RECEIVING_OUTPUT','Keep the receiving output outside either original workspace.');
  }
  reviewer=label(reviewer,'receiving reviewer',160);need(typeof note==='string'&&note.length<=4000,'GLEIF_RECEIVING_NOTE');
  if(refreshSelection!==null){
    need(refreshSelection&&typeof refreshSelection==='object'&&!Array.isArray(refreshSelection)&&
      Object.keys(refreshSelection).every(key=>['beforePortfolio','reviews','cycle'].includes(key))&&
      /^[a-f0-9]{64}$/.test(refreshSelection.beforePortfolio)&&Array.isArray(refreshSelection.reviews),
      'GLEIF_REFRESH_SELECTION','Choose an original earlier portfolio and explicit review requests.');
    need(refreshSelection.reviews.every(value=>value&&typeof value==='object'&&!Array.isArray(value)&&
      !Object.hasOwn(value,'comparisonId')&&!Object.hasOwn(value,'requestId')),
      'GLEIF_REFRESH_SELECTION','Supply the native authored review fields; the retained course binds original request and comparison IDs.');
  }
  await privateDirectory(output,true);
  if(reviewerExchange!==null){
    const completed=await retainedBaseline(output,{gleifWorkspace,monitoringWorkspace,selection,reviewer,note,refreshSelection});
    if(completed)return followingReviewer(completed,reviewerExchange,pythonCommand,output);
  }
  const cli=fileURLToPath(new URL('../../ndjson/opensanctions/cli.py',import.meta.url));
  const source=await openGleifWorkspace({directory:gleifWorkspace});
  let intent,result;
  try{
    const basis={schema:SCHEMA,workspaceId:source.metadata.id,selection,monitoringWorkspace,reviewer,note,...(refreshSelection===null?{}:{refreshSelection})};
    const path=join(output,'receiving-intent.json');
    if(await exists(path)){
      intent=JSON.parse(await readPrivate(path));
      need(stable(intent.basis)===stable(basis),'GLEIF_RECEIVING_SELECTION_CHANGED','Continue the original exact receiving selection or choose a new output directory.');
    }else{
      const preview=await source.monitoringPreview(selection);
      const request={id:'monitoring-'+identity(basis).slice(0,64),action:'monitoring.prepare',
        input:{...selection,expectedPreviewSha256:preview.previewSha256}};
      intent={schema:SCHEMA,basis,request,intakeRequestId:'gleif-'+identity({basis,previewSha256:preview.previewSha256})};
      await retained(path,bytes(intent));
    }
    await source.start(intent.request);const operation=await source.wait(intent.request.id);
    need(operation.state==='COMPLETE','GLEIF_RECEIVING_OPERATION',operation.error?.message??'The original handover operation is incomplete.');
    result=operation.result;
    const names=['gleif-monitoring-portfolio.json','portfolio.ftm.json','mapping.json','gleif-project.json','research-report.json','research-report.html','entities.csv','entities.spreadsheet.csv','original-records.jsonl'];
    need(result.files.length===names.length&&new Set(result.files.map(file=>file.name)).size===names.length&&result.files.every(file=>names.includes(file.name)),'GLEIF_RECEIVING_FILES');
    for(const file of result.files){const raw=await source.object(file.sha256);need(raw.length===file.bytes,'GLEIF_RECEIVING_FILE');await retained(join(output,file.name),raw);}
  }finally{await source.close();}
  const handover=join(output,'gleif-monitoring-portfolio.json');
  const preview=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'gleif-preview','--input',handover]);
  const request={requestId:intent.intakeRequestId,original:preview.original,expectedPreviewSha256:preview.previewSha256,reviewer,note};
  const requestPath=join(output,'monitoring-intake-request.json');await retained(requestPath,bytes(request));
  const received=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'gleif-receive','--request',requestPath]);
  need(received.receipt?.requestId===request.requestId&&received.receipt.original===preview.original,'GLEIF_RECEIVING_IDENTITY');
  let refreshResult=null;
  if(refreshSelection!==null){
    const comparison=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'portfolio-refresh-prepare',
      '--before',refreshSelection.beforePortfolio,'--after',received.portfolio.id]);
    await retained(join(output,'portfolio-refresh-comparison.json'),bytes(comparison));
    const decisions=[];
    for(const [index,choice] of refreshSelection.reviews.entries()){
      const decision={...choice,comparisonId:comparison.id,
        requestId:'portfolio-refresh-'+identity({basis:intent.basis,comparisonId:comparison.id,index,choice})};
      const filename=join(output,'portfolio-refresh-request-'+index+'.json');await retained(filename,bytes(decision));
      const result=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'portfolio-refresh-command','--request',filename]);
      need(result.comparisonId===comparison.id&&result.requestId===decision.requestId&&result.entityId===decision.entityId,
        'GLEIF_REFRESH_IDENTITY','The original case review returned a different request identity.');
      decisions.push({request:decision,result});
    }
    const reports={};
    for(const format of ['json','html']){
      const filename=join(output,'Portfolio_Refresh.'+format);
      reports[format]=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'portfolio-refresh-report',
        '--id',comparison.id,'--output',filename,...(format==='html'?['--html']:[])]);
    }
    refreshResult={comparisonId:comparison.id,beforePortfolio:comparison.before,afterPortfolio:comparison.after,decisions,reports};
  }
  if(refreshSelection?.cycle){
    const specification=refreshSelection.cycle;
    need(specification&&typeof specification==='object'&&!Array.isArray(specification)&&
      Object.keys(specification).every(key=>['create','commands'].includes(key))&&
      specification.create&&Array.isArray(specification.commands),
      'GLEIF_REFRESH_CYCLE','Supply the original attributed create command and complete command sequence.');
    const definitions=[{...specification.create,action:'create'},...specification.commands];
    const cycleResults=[];let current=null;
    for(const [index,definition] of definitions.entries()){
      need(definition&&typeof definition==='object'&&!Array.isArray(definition)&&
        Object.keys(definition).every(key=>['requestId','action','actor','body','reviewIndex'].includes(key))&&
        definition.body&&typeof definition.body==='object'&&!Array.isArray(definition.body),
        'GLEIF_REFRESH_CYCLE','Use the original authored cycle actor/body and optional explicit review index.');
      let body={...definition.body};
      if(index===0){
        need(!Object.hasOwn(body,'comparison')&&!Object.hasOwn(body,'sourceKind')&&
          !Object.hasOwn(definition,'reviewIndex'),'GLEIF_REFRESH_CYCLE','Creation binds this exact customer comparison.');
        body={...body,comparison:refreshResult.comparisonId,sourceKind:'portfolio_refresh'};
      }else{
        need(['assign','complete','reopen','signoff'].includes(definition.action),'GLEIF_REFRESH_CYCLE','Choose an original cycle action.');
        if(definition.action==='complete'&&Object.hasOwn(definition,'reviewIndex')){
          const selected=refreshResult.decisions[definition.reviewIndex];
          need(Number.isSafeInteger(definition.reviewIndex)&&definition.reviewIndex>=0&&selected?.result.case&&
            !Object.hasOwn(body,'caseId')&&!Object.hasOwn(body,'caseRevision')&&!Object.hasOwn(body,'portfolioReviewRequestId'),
            'GLEIF_REFRESH_CYCLE','Select one actual retained retain/continue request; do not replace its case binding.');
          body={...body,caseId:selected.result.case.id,caseRevision:selected.result.case.revision,
            portfolioReviewRequestId:selected.request.requestId};
        }else{
          need(!Object.hasOwn(definition,'reviewIndex'),'GLEIF_REFRESH_CYCLE','A review index belongs only to completion.');
          if(definition.action==='complete')body={...body,portfolioReviewRequestId:body.portfolioReviewRequestId??null};
        }
      }
      const filename=join(output,'portfolio-cycle-command-'+index+'.json');
      const basis={requestId:definition.requestId,cycleId:current?.cycleId??null,expectedVersion:current?.version??0,
        action:definition.action,actor:definition.actor,body};
      let command;
      if(await exists(filename)){
        command=JSON.parse(await readPrivate(filename));
        const {at,...retainedBasis}=command;
        need(stable(retainedBasis)===stable(basis),'GLEIF_REFRESH_CYCLE_CHANGED','The exact original cycle command changed.');
      }else{
        command={...basis,at:new Date().toISOString()};await retained(filename,bytes(command));
      }
      current=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'cycle-command','--input',filename]);
      need(current.requestId===command.requestId,'GLEIF_REFRESH_CYCLE_IDENTITY');cycleResults.push({command,result:current});
    }
    const originalCycle=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'cycle','--id',current.cycleId]);
    const cycleSnapshotPath=join(output,'Portfolio_Review_Cycle.json');
    if(await exists(cycleSnapshotPath)){
      const priorCycle=JSON.parse(await readPrivate(cycleSnapshotPath,128*1024*1024));
      need(priorCycle.id===originalCycle.id&&priorCycle.version===originalCycle.version&&priorCycle.revision===originalCycle.revision,
        'GLEIF_REFRESH_CYCLE_CHANGED','The original cycle progressed beyond this receiving course; preserve its snapshot and choose a new output.');
    }else await retained(cycleSnapshotPath,bytes(originalCycle));
    const reports=[];
    for(const report of originalCycle.reports)for(const format of ['json','html']){
      const filename=join(output,'Portfolio_Review_Cycle_v'+report.version+'.'+format);
      const file=await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'cycle-report','--id',current.cycleId,
        '--version',String(report.version),'--output',filename,...(format==='html'?['--html']:[])]);
      reports.push({version:report.version,format,file});
    }
    refreshResult.cycle={cycleId:current.cycleId,version:originalCycle.version,revision:originalCycle.revision,commands:cycleResults,reports};
  }
  const archive=join(output,'Monitoring_Research_Receiving.zip');
  if(!await exists(archive)){
    const temporary=join(output,'Monitoring_Research_Receiving.pending.zip');
    // Original exporter removes incomplete output on failure. A completed pending archive can be resumed.
    if(!await exists(temporary))await python(pythonCommand,[cli,'--workspace',monitoringWorkspace,'export','--output',temporary]);
    await rename(temporary,archive);
  }
  const restored=join(output,'received-monitoring');
  const create=!await exists(restored);
  await python(pythonCommand,[cli,'--workspace',restored,...(create?['--create']:[]),'import','--input',archive]);
  const reopened=await python(pythonCommand,[cli,'--workspace',restored,'gleif-intake','--request-id',request.requestId]);
  need(reopened.committed&&stable(reopened.receipt)===stable(received.receipt)&&reopened.portfolio.id===received.portfolio.id,'GLEIF_RECEIVING_COLD_IDENTITY','The complete cold workspace did not retain the original portfolio and research custody.');
  if(refreshResult){
    for(const decision of refreshResult.decisions){
      const operation=await python(pythonCommand,[cli,'--workspace',restored,'portfolio-refresh-request','--request-id',decision.request.requestId]);
      need(operation.committed&&stable(operation.event.request)===stable(decision.request)&&stable(operation.result)===stable(decision.result),
        'GLEIF_REFRESH_COLD_IDENTITY','The received workspace lost an original refresh choice or case revision.');
    }
    for(const format of ['json','html']){
      const outputPath=join(output,'Received_Portfolio_Refresh.'+format);
      const report=await python(pythonCommand,[cli,'--workspace',restored,'portfolio-refresh-report','--id',refreshResult.comparisonId,
        '--output',outputPath,...(format==='html'?['--html']:[])]);
      need(report.sha256===refreshResult.reports[format].sha256&&report.bytes===refreshResult.reports[format].bytes,
        'GLEIF_REFRESH_COLD_REPORT','The received complete population, attributed decisions or original case history differs.');
    }
    if(refreshResult.cycle){
      const cycle=refreshResult.cycle;
      const reopenedCycle=await python(pythonCommand,[cli,'--workspace',restored,'cycle','--id',cycle.cycleId]);
      need(reopenedCycle.id===cycle.cycleId&&reopenedCycle.version===cycle.version&&reopenedCycle.revision===cycle.revision,
        'GLEIF_REFRESH_CYCLE_COLD','The original customer review cycle did not reopen at its captured revision.');
      for(const event of cycle.commands){
        const replay=await python(pythonCommand,[cli,'--workspace',restored,'cycle-command','--input',
          join(output,'portfolio-cycle-command-'+cycle.commands.indexOf(event)+'.json')]);
        need(stable(replay)===stable(event.result),'GLEIF_REFRESH_CYCLE_REPLAY','The original receiving request result changed.');
      }
      for(const report of cycle.reports){
        const filename=join(output,'Received_Portfolio_Review_Cycle_v'+report.version+'.'+report.format);
        const actual=await python(pythonCommand,[cli,'--workspace',restored,'cycle-report','--id',cycle.cycleId,
          '--version',String(report.version),'--output',filename,...(report.format==='html'?['--html']:[])]);
        need(actual.bytes===report.file.bytes&&actual.sha256===report.file.sha256,'GLEIF_REFRESH_CYCLE_REPORT','The complete signed report changed on receiving.');
      }
      cycle.coldReopened=true;
    }
    refreshResult.coldReopened=true;
  }
  const research=join(output,'received-gleif'),pkg=JSON.parse(await readPrivate(join(output,'gleif-project.json'),256*1024*1024));
  if(!await exists(join(research,'workspace.json')))await receiveGleifWorkspace({directory:research,package:pkg});
  const reopenedResearch=await openGleifWorkspace({directory:research});
  let researchStatus;
  try{
    researchStatus=reopenedResearch.status();
    need(researchStatus.workspace.id===pkg.metadata.id,'GLEIF_RECEIVING_RESEARCH_IDENTITY');
    for(const captureId of result.captureIds)need((await reopenedResearch.entities(captureId)).complete,'GLEIF_RECEIVING_RESEARCH_SOURCE');
  }finally{await reopenedResearch.close();}
  const archiveDigest=createHash('sha256');let archiveBytes=0;for await(const part of createReadStream(archive)){archiveBytes+=part.length;archiveDigest.update(part);}
  const receipt={schema:SCHEMA,state:'COMPLETE',originalResearchWorkspace:gleifWorkspace,
    originalMonitoringWorkspace:monitoringWorkspace,receivedMonitoringWorkspace:restored,receivedResearchWorkspace:research,
    handoverOperationId:result.id,handoverId:result.handoverId,portfolioId:received.portfolio.id,
    intakeRequestId:request.requestId,originalProjectSha256:pkg.sha256,sourceCaptures:result.captureIds,
    archive:{path:archive,bytes:archiveBytes,sha256:archiveDigest.digest('hex')},files:result.files,
    nativeReopening:{monitoring:reopened.committed,researchRevision:researchStatus.revision},
    ...(refreshResult?{portfolioRefresh:refreshResult}:{}),
    visualAcceptance:'Pending original operator observation of both applications and every outgoing attachment.'};
  await atomicJson(output,'gleif-monitoring-receiving.json',receipt);
  return reviewerExchange===null?receipt:followingReviewer(receipt,reviewerExchange,pythonCommand,output);
}
export async function main(args=process.argv.slice(2)){
  const opts={};for(let i=0;i<args.length;i++){need(args[i].startsWith('--')&&!Object.hasOwn(opts,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'GLEIF_RECEIVING_ARGUMENT');opts[args[i]]=args[++i];}
  const selection=JSON.parse(await readPrivate(resolve(opts['--selection'])));
  const refreshSelection=opts['--refresh-selection']?JSON.parse(await readPrivate(resolve(opts['--refresh-selection']))):null;
  const reviewerExchange=opts['--reviewer-exchange-selection']?JSON.parse(await readPrivate(resolve(opts['--reviewer-exchange-selection']))):null;
  const result=await receiveMonitoring({gleifWorkspace:resolve(opts['--gleif-workspace']),monitoringWorkspace:resolve(opts['--monitoring-workspace']),
    selection,pythonCommand:resolve(opts['--python']),output:resolve(opts['--output']),reviewer:opts['--reviewer'],note:opts['--note']??'',refreshSelection,reviewerExchange});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'GLEIF_MONITORING_RECEIVING',message:error.message})+'\n');process.exitCode=1;});
