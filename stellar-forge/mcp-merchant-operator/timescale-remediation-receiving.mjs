#!/usr/bin/env node
// MIT. One original Timescale desk, merchant client and complete portable receiving continuation.
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { openTimescaleClient } from './timescale-client.mjs';
import { runTimescaleClientCli } from './timescale-client-cli.mjs';
import { inspectTimescaleAgentBinding, startTimescaleAgentWorkspace } from './timescale-workspace-launcher.mjs';
import { inspectTimescaleRemediationReport } from './timescale-remediation-report.mjs';
import { REMEDIATION_MANIFEST } from './timescale-remediation-contract.mjs';
import { openTimescaleWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/model.mjs';
import { inspectTimescalePackage, receiveTimescaleWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/package.mjs';
import { loadDatasetConfig } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs';
import { acquireWorkspace, privateDirectory, bytes, digest, identity, readPrivate, readJson, hashPrivate,
  createFile, atomicJson, fault, stamp } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

const SCHEMA='stellar-forge.timescale-remediation-native-receiving.v1';
const TOKEN_ENV='TIMESCALE_REMEDIATION_RECEIVING_TOKEN';
const ACTOR='Native Timescale receiving engineer';
const active=new Set(['RUNNING','DISPATCHING']);
function need(value,code){if(!value)throw fault(code);}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function sourceRef(value){return{reviewId:value.reviewId,comparisonDigest:value.comparisonDigest,changeKey:value.changeKey,digest:value.digest};}
function itemPin(value){return{workItemId:value.item.id,itemRevision:value.item.revision,itemDigest:value.itemDigest};}
function next(page){return Object.hasOwn(page,'nextOffset')?page.nextOffset:page.next;}
function disjoint(left,right){return left!==right&&!left.startsWith(right+'/')&&!right.startsWith(left+'/');}
async function allPages(read){
  const rows=[];let offset=0,expectedTotal;
  do{
    const page=await read(offset);
    need(Array.isArray(page.rows)&&Number.isSafeInteger(page.total)&&page.offset===offset,'TIMESCALE_DESK_PAGE_INVALID');
    if(expectedTotal!==undefined)need(page.total===expectedTotal,'TIMESCALE_DESK_PAGE_CHANGED');
    expectedTotal=page.total;rows.push(...page.rows);const following=next(page);
    need(following===null||Number.isSafeInteger(following)&&following>offset,'TIMESCALE_DESK_PAGE_INVALID');
    offset=following;
  }while(offset!==null);
  need(rows.length===expectedTotal,'TIMESCALE_DESK_PAGE_INCOMPLETE');return rows;
}

/**
 * Follows the completed native-demo and original merchant/browser receiving.
 * It makes one later read-only capture in the SAME database, never another
 * refresh, job change, seller publication, cluster or scheduler.
 */
export async function runTimescaleRemediationReceiving({
  nativeResult,configPath,workspace='usage',directory,environment=process.env
}={}){
  nativeResult=resolve(nativeResult);configPath=resolve(configPath);directory=resolve(directory);
  const originalBytes=await readPrivate(nativeResult,16777216),native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(originalBytes));
  need(native.schema==='stellar-forge.timescale-native-demo.v1'&&native.complete===true&&
    native.phases?.publish?.state==='COMPLETE'&&native.phases?.after?.state==='COMPLETE'&&
    native.phases?.['apply-job']?.state==='COMPLETE','TIMESCALE_DESK_NATIVE_RESULT_REQUIRED');
  const originalDirectory=join(dirname(nativeResult),'workspace');
  const settings=await readJson(join(originalDirectory,'workspace.json'),16384);
  const workspaceId=settings.id,stateFile=join(settings.targetDirectory,'state.json');
  need(disjoint(directory,originalDirectory)&&disjoint(directory,settings.targetDirectory)&&
    disjoint(directory,dirname(configPath)),'TIMESCALE_DESK_PRIVATE_OUTPUT_REQUIRED');
  await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory);
  let host,received;
  try{
    const recordPath=join(directory,'receiving.json'),sourceDigest=digest(originalBytes);
    const datasetDigest=digest(await readPrivate(stateFile,262144));
    let record;
    if(await exists(recordPath)){
      record=await readJson(recordPath,32*1024*1024);
      need(record.schema===SCHEMA&&record.nativeResult===nativeResult&&record.nativeResultSha256===sourceDigest&&
        record.workspaceId===workspaceId&&record.workspace===workspace&&record.configPath===configPath&&
        record.datasetStateSha256===datasetDigest,'TIMESCALE_DESK_RECEIVING_BINDING_CHANGED');
    }else{
      record={schema:SCHEMA,id:randomUUID(),createdAt:stamp(),nativeResult,nativeResultSha256:sourceDigest,
        nativeOperationId:native.id,workspaceId,workspace,configPath,datasetStateSha256:datasetDigest,
        requests:{},phases:{},receiveId:randomUUID(),complete:false};
      await createFile(recordPath,bytes(record));
    }
    const save=()=>atomicJson(directory,'receiving.json',record);
    async function phase(name,work){
      if(record.phases[name]?.state==='COMPLETE')return record.phases[name].result;
      record.phases[name]={...record.phases[name],state:'RUNNING',startedAt:record.phases[name]?.startedAt??stamp()};await save();
      try{
        const result=await work();
        record.phases[name]={...record.phases[name],state:'COMPLETE',completedAt:stamp(),result};await save();
        process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE',record:recordPath})+'\n');return result;
      }catch(error){
        record.phases[name]={...record.phases[name],state:'FAILED',error:{code:error.code??'TIMESCALE_DESK_RECEIVING_FAILED'}};
        await save();throw error;
      }
    }
    async function verifyReportFiles(manifest,root,expectedSha256){
      const raw=await readPrivate(join(root,REMEDIATION_MANIFEST),65536);
      const found=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      need(digest(raw)===expectedSha256&&identity(found)===identity(manifest),'TIMESCALE_DESK_REPORT_MANIFEST_CHANGED');
      for(const file of manifest.files){
        const actual=await hashPrivate(join(root,file.name),256*1024*1024);
        need(actual.bytes===file.bytes&&actual.hash===file.sha256,'TIMESCALE_DESK_REPORT_FILE_CHANGED');
      }
    }
    if(record.complete){
      await verifyReportFiles(record.phases['report-inspection'].result.manifest,join(directory,'report'),
        record.phases['report-inspection'].result.manifestSha256);
      const originalPackage=record.phases['complete-package-download'].result;
      const local=await inspectTimescalePackage(join(directory,'download'),originalPackage.nativeManifestSha256);
      need(local.workspaceId===workspaceId,'TIMESCALE_DESK_PACKAGE_CHANGED');
      const receipt=await receiveTimescaleWorkspace({requestId:record.receiveId,packageDirectory:join(directory,'download'),
        expectedDigest:originalPackage.nativeManifestSha256,directory:join(directory,'customer-project')});
      need(receipt.complete&&receipt.workspaceId===workspaceId,'TIMESCALE_DESK_RECEIVE_CHANGED');
      return{complete:true,reused:true,record:recordPath,workspaceId,workItemId:record.workItemId,
        receiving:receipt,sourceOperationsThisReopen:0,allOwnedHandlesClosed:true};
    }

    const binding=await inspectTimescaleAgentBinding({configPath,workspace});
    need(binding.workspaceId===workspaceId&&binding.publisherDirectory===originalDirectory,'TIMESCALE_DESK_CONFIG_CHANGED');
    if(record.bindingSha256)need(record.bindingSha256===binding.bindingSha256,'TIMESCALE_DESK_CONFIG_CHANGED');
    record.bindingSha256=binding.bindingSha256;await save();
    const hostEnvironment={...environment,[TOKEN_ENV]:randomBytes(32).toString('hex')};
    let client;
    async function launch(){
      host=await startTimescaleAgentWorkspace({configPath,workspace,port:record.ports?.browser??0,
        mcpPort:record.ports?.mcp??0,tokenEnv:TOKEN_ENV,environment:hostEnvironment,expectedBindingSha256:binding.bindingSha256});
      record.ports={browser:Number(new URL(host.startup.operatorUrl).port),mcp:Number(new URL(host.startup.mcpUrl).port)};
      await save();
      client=await openTimescaleClient({url:host.startup.mcpUrl,workspace,workspaceId,tokenEnv:TOKEN_ENV,environment:hostEnvironment});
      const status=await client.status();need(status.workspaceId===workspaceId,'TIMESCALE_DESK_OWNER_CHANGED');
    }
    async function mutation(name,method,make){
      return phase(name,async()=>{
        let request=record.requests[name];
        if(!request){
          const body=await make(),state=await client.status();
          request={...body,requestId:randomUUID(),expectedVersion:state.native.version};
          record.requests[name]=request;await save(); // Persist before the first possible dispatch.
        }else{
          let old;
          try{old=await client.operation({action:'inspect',requestId:request.requestId});}
          catch(error){if(error.code!=='TIMESCALE_OPERATION_NOT_FOUND')throw error;}
          if(old?.state==='COMPLETE')return old;
          if(old&&active.has(old.state)){
            const result=await client.wait(request.requestId);need(result.state==='COMPLETE','TIMESCALE_DESK_OPERATION_INCOMPLETE');return result;
          }
          if(old){
            need(['FAILED','INTERRUPTED'].includes(old.state),'TIMESCALE_DESK_ORIGINAL_OUTCOME_REQUIRED');
            // Original read-style retry admits only its existing version allowance.
            request={...request,expectedVersion:(await client.status()).native.version};
            record.requests[name]=request;await save();
          }
        }
        const accepted=await client.call(method,request);
        need(accepted.id===request.requestId,'TIMESCALE_DESK_REQUEST_CHANGED');
        const operation=accepted.operation.state==='COMPLETE'?accepted.operation:await client.wait(request.requestId);
        need(operation.state==='COMPLETE','TIMESCALE_DESK_OPERATION_INCOMPLETE');return operation;
      });
    }
    async function detail(){return client.remediation.item({workItemId:record.workItemId});}
    async function command(name,action,make){
      return mutation(name,'remediation-command',async()=>{
        const input=await make();
        if(action==='create')return{...input,action,actor:ACTOR,note:input.note??'Assign the retained source to its explicit receiving work.'};
        const item=await detail();
        return{...input,action,actor:ACTOR,note:input.note??'Retain this source-bound receiving decision.',
          workItemId:record.workItemId,expectedRevision:item.item.revision};
      });
    }
    const beforeId=native.phases.before.result.editionId,afterId=native.phases.after.result.editionId;
    await launch();
    const baseline=await phase('original-source-and-publisher',async()=>{
      const before=await client.edition({editionId:beforeId}),after=await client.edition({editionId:afterId});
      need(before.digest===native.phases.before.result.digest&&after.digest===native.phases.after.result.digest,'TIMESCALE_DESK_EDITION_CHANGED');
      const changes=[];let comparisonDigest=null;
      await allPages(async offset=>{
        const value=await client.compare({beforeId,afterId,offset,limit:100});
        if(comparisonDigest)need(value.comparisonDigest===comparisonDigest,'TIMESCALE_DESK_COMPARISON_CHANGED');
        comparisonDigest=value.comparisonDigest;changes.push(...value.changes.rows);return value.changes;
      });
      const jobId=String(native.phases['native-source'].result.jobId);
      const job=changes.find(row=>row.kind==='jobs'&&row.after?.job_id===jobId);
      need(job&&job.fields.some(field=>field.name==='scheduled'||field.name==='schedule_interval'),'TIMESCALE_DESK_REAL_JOB_CHANGE_REQUIRED');
      const publication=await host.operator.call('merchant_publisher_inspect',{publisher:binding.publisher,
        runId:native.phases.extract.result.runId,query:'limit=50'});
      need(publication.run.state==='PUBLISHED'&&publication.run.data.publication.snapshot===native.phases.publish.result.snapshot,
        'TIMESCALE_DESK_PUBLICATION_CHANGED');
      return{before:{id:beforeId,digest:before.digest},after:{id:afterId,digest:after.digest},
        comparisonDigest,changes,job,originalPublishedSnapshot:native.phases.publish.result.snapshot};
    });
    const reviewInput=(decision,note)=>({beforeId,afterId,comparisonDigest:baseline.comparisonDigest,reviewer:ACTOR,note,
      decisions:baseline.changes.map(change=>({changeKey:change.key,decision:change.key===baseline.job.key?decision:'ACCEPT',
        owner:ACTOR,note:change.key===baseline.job.key?note:'Retain the original observed change within this explicit demonstration.'}))});
    async function assignedSource(reviewId){
      const rows=await allPages(async offset=>(await client.remediation.sources({offset,limit:100})).sources);
      const source=rows.find(row=>row.reviewId===reviewId&&row.changeKey===baseline.job.key);
      need(source,'TIMESCALE_DESK_SOURCE_REQUIRED');return sourceRef(source);
    }
    const reviewed=await mutation('assigned-original-review','review',async()=>reviewInput('REMEDIATE',
      'Assign the actual retained schedule change for a later current-state receiving assessment.'));
    const created=await command('create-work','create',async()=>({source:await assignedSource(reviewed.id),fields:{
      title:'Receive the original native job schedule',owner:ACTOR,dueDate:'',priority:'NORMAL',status:'OPEN',
      intent:'Assess the retained disabled native policy and its two-hour schedule without dispatching the job again.',
      acceptance:'Confirm the same selected job settings in a later read-only edition and retain an explicit current-state assessment.'}}));
    record.workItemId=created.result.workItemId;await save();
    await command('edit-assigned-work','edit',async()=>({fields:{
      title:'Receive the original native job schedule',owner:ACTOR,dueDate:'',priority:'HIGH',status:'DEFERRED',
      intent:'Inspect the original plan and actual outcome, then resolve only against a later retained current-state edition.',
      acceptance:'Retain the actual selected settings, source/plan/result identity, and explicit later-edition assessment; no aggregate coverage claim.'},
      note:'Defer resolution until the later retained edition has been received.'}));
    const plan=native.phases['prepare-job'].result;
    await command('link-original-plan','bind-plan',async()=>({planId:plan.planId,planDigest:plan.digest,
      relevance:'This is the exact native plan that changed the selected policy in the original completed operation.'}));
    async function originalObservation(){
      const item=await detail(),pin=itemPin(item),rows=await allPages(async offset=>
        (await client.remediation.context({...pin,offset,limit:100})).operations);
      const operation=rows.find(row=>row.id===native.requestIds['apply-job']);
      need(operation?.state==='COMPLETE'&&operation.kind==='job-change','TIMESCALE_DESK_ORIGINAL_OPERATION_REQUIRED');
      return{operationId:operation.id,operationDigest:operation.digest,
        relevance:'The retained native job-change completed once; this observation records it without repeating the database mutation.'};
    }
    await command('observe-original-outcome','observe',originalObservation);
    await phase('same-completed-create-request',async()=>{
      const before=await detail(),request=record.requests['create-work'];
      const replay=await client.remediation.command({...request,expectedVersion:(await client.status()).native.version});
      const after=await detail();
      need(replay.reused===true&&replay.id===request.requestId&&replay.operation.result.itemRevision===1&&
        after.itemDigest===before.itemDigest,'TIMESCALE_DESK_COMPLETED_REPLAY_CHANGED');
      return{requestId:replay.id,reused:true,currentItemDigest:after.itemDigest,currentRevision:after.item.revision};
    });
    const laterReview=await mutation('following-assignment-review','review',async()=>reviewInput('DEFER',
      'Keep the same native change assigned while the receiving engineer obtains the later edition.'));
    await command('adopt-following-review','rebase',async()=>({source:await assignedSource(laterReview.id),
      note:'Explicitly adopt the later completed review of the SAME database/job; preserve earlier source links and observations.'}));
    await command('link-current-plan','bind-plan',async()=>({planId:plan.planId,planDigest:plan.digest,
      relevance:'Retain the original plan under the explicitly adopted current assignment as well as its earlier assignment.'}));
    await command('observe-current-outcome','observe',originalObservation);
    const later=await mutation('later-read-only-edition','capture',async()=>({
      title:'Original job settings at receiving',note:'One later read-only native capture for the assigned current-state assessment; no refresh or job dispatch.'}));
    const assessment=await phase('later-edition-assessment',async()=>{
      const item=await detail(),pin=itemPin(item),editionId=later.result.editionId;
      const declaration=await client.edition({editionId});
      need(declaration.digest===later.result.digest,'TIMESCALE_DESK_LATER_EDITION_CHANGED');
      let columns;
      const rows=await allPages(async offset=>{
        const page=await client.edition({editionId,table:'jobs',offset,limit:100});
        columns=page.columns.map(column=>column.name);return page;
      });
      const index=columns.indexOf('job_id');need(index>=0,'TIMESCALE_DESK_JOB_ID_REQUIRED');
      const selected=rows.find(row=>row[index]===baseline.job.after.job_id);
      need(selected,'TIMESCALE_DESK_JOB_REQUIRED');
      const actual=Object.fromEntries(columns.map((name,i)=>[name,selected[i]]));
      for(const key of ['scheduled','schedule_interval','config','proc_schema','proc_name'])
        if(Object.hasOwn(baseline.job.after,key))need(actual[key]===baseline.job.after[key],'TIMESCALE_DESK_JOB_SETTING_CHANGED');
      const context=await client.remediation.context({...pin,editionId,limit:100,changeLimit:100});
      need(context.resolution?.editionDigest===later.result.digest,'TIMESCALE_DESK_ASSESSMENT_CHANGED');
      return{editionId,editionDigest:later.result.digest,comparisonDigest:context.resolution.comparisonDigest,
        exactNativeJob:actual,mode:'CURRENT_STATE_REVIEW',outcome:'ACCEPTED_CURRENT_STATE',
        statement:'The later original edition retains the selected disabled policy and the original two-hour schedule/configuration. The receiving engineer accepts that current catalog state; aggregate coverage is not asserted.'};
    });
    await command('resolve-current-state','resolve',async()=>({resolution:{
      editionId:assessment.editionId,editionDigest:assessment.editionDigest,comparisonDigest:assessment.comparisonDigest,
      mode:assessment.mode,outcome:assessment.outcome,statement:assessment.statement},
      note:'Record only the actual later current-state assessment with its complete original comparison identity.'}));
    await command('reopen-for-handover','reopen',async()=>({status:'IN_PROGRESS',
      note:'Reopen for customer handover, retaining the prior resolved revision and its exact later-edition assessment.'}));
    const selected=await phase('complete-pinned-work-history',async()=>{
      const item=await detail(),pin=itemPin(item),sections={};
      for(const section of ['plans','observations','history'])
        sections[section]=await allPages(async offset=>(await client.remediation.item({...pin,section,offset,limit:2})).page);
      need(item.item.status==='IN_PROGRESS'&&item.item.sourceRevision===2&&sections.history.length===item.historyCount&&
        sections.history.some(row=>row.action==='resolve')&&sections.history.some(row=>row.action==='reopen')&&
        sections.plans.some(row=>row.sourceDigest!==item.item.source.digest)&&
        sections.plans.some(row=>row.sourceDigest===item.item.source.digest)&&sections.observations.length===2,
        'TIMESCALE_DESK_HISTORY_INCOMPLETE');
      const listing=await client.remediation.list({q:record.workItemId,limit:100});
      need(listing.items.rows.some(row=>row.id===record.workItemId&&row.digest===item.itemDigest),'TIMESCALE_DESK_LIST_CHANGED');
      return{...pin,status:item.item.status,sourceRevision:item.item.sourceRevision,historyCount:item.historyCount,
        sections,originalJobOperation:native.requestIds['apply-job']};
    });
    const reported=await mutation('retain-complete-report','remediation-report',async()=>({
      workItemId:record.workItemId,itemRevision:selected.itemRevision,itemDigest:selected.itemDigest}));
    const reportId=reported.id;
    const inspected=await phase('report-inspection',async()=>{
      const result=await client.remediation.inspectReport({exportId:reportId});
      need(result.manifest.workItemId===record.workItemId&&result.manifest.itemDigest===selected.itemDigest&&
        result.manifest.files.length===2,'TIMESCALE_DESK_REPORT_CHANGED');return result;
    });
    const reportOptions={exportId:reportId,directory:join(directory,'report'),expectedManifestSha256:inspected.manifestSha256,chunkSize:4096};
    await phase('report-prefix-interruption',async()=>{
      const control=new AbortController();let prefix;
      try{
        await client.remediation.downloadReport({...reportOptions,signal:control.signal,onProgress:progress=>{
          if(!prefix){prefix=progress;control.abort(new Error('Pause the original retained report download.'));}
        }});
        throw fault('TIMESCALE_DESK_PAUSE_MISSING');
      }catch(error){
        if(!control.signal.aborted||error.code==='TIMESCALE_DESK_PAUSE_MISSING')throw error;
        need(prefix?.bytes>0,'TIMESCALE_DESK_PREFIX_MISSING');
        return{state:'PAUSED',file:prefix.file,bytes:prefix.bytes,total:prefix.total,manifestSha256:inspected.manifestSha256};
      }
    });
    await host.close();host=null;
    await launch();
    await phase('same-owner-report-reopen',async()=>{
      const current=await detail(),again=await client.remediation.inspectReport({exportId:reportId});
      need(current.itemDigest===selected.itemDigest&&again.manifestSha256===inspected.manifestSha256,'TIMESCALE_DESK_REOPEN_CHANGED');
      return{workspaceId,instanceId:host.startup.instanceId,publisherInstanceId:host.startup.publisherInstanceId,
        itemDigest:current.itemDigest,manifestSha256:again.manifestSha256};
    });
    const reportDownload=await phase('resumed-complete-report',async()=>{
      const result=await client.remediation.downloadReport(reportOptions);
      need(result.state==='COMPLETE'&&result.resumed&&result.resumedBytes>0&&result.files===2,'TIMESCALE_DESK_REPORT_DOWNLOAD_INCOMPLETE');
      await verifyReportFiles(inspected.manifest,reportOptions.directory,inspected.manifestSha256);
      const content=await readJson(join(reportOptions.directory,'report.json'),256*1024*1024);
      need(content.item.id===record.workItemId&&content.digest===selected.itemDigest&&content.history.length===selected.historyCount,
        'TIMESCALE_DESK_REPORT_HISTORY_CHANGED');return result;
    });
    await phase('installed-client-command',async()=>{
      const requestPath=join(directory,'cli-item.json'),input={...itemPin(await detail())};
      if(await exists(requestPath))need(identity(await readJson(requestPath,16384))===identity(input),'TIMESCALE_DESK_CLI_INPUT_CHANGED');
      else await createFile(requestPath,bytes(input));
      const argv=['remediation-item','--url',host.startup.mcpUrl,'--workspace',workspace,'--workspace-id',workspaceId,
        '--input',requestPath,'--input-sha256',digest(await readPrivate(requestPath,16384)),'--token-env',TOKEN_ENV];
      let text='';
      const result=await runTimescaleClientCli(argv,{environment:hostEnvironment,output:{write(value){text+=value;}}});
      need(result.itemDigest===selected.itemDigest&&JSON.parse(text).itemDigest===selected.itemDigest,'TIMESCALE_DESK_CLI_CHANGED');
      return{command:'timescale-client remediation-item',itemDigest:result.itemDigest,bytes:Buffer.byteLength(text),sha256:digest(text)};
    });
    const exported=await mutation('complete-project-export','export',async()=>({}));
    const inspectedPackage=await phase('complete-package-inspection',async()=>{
      const value=await client.exports.inspect({exportId:exported.id});
      for(const file of [{name:REMEDIATION_MANIFEST,bytes:Buffer.byteLength(JSON.stringify(inspected.manifest,null,2)+'\n'),
        sha256:inspected.manifestSha256},...inspected.manifest.files]){
        const expected='workspace/remediation-reports/'+reportId+'/'+file.name;
        const declared=value.manifest.files.find(row=>row.name===expected);
        need(declared?.bytes===file.bytes&&declared.sha256===file.sha256,'TIMESCALE_DESK_PACKAGE_REPORT_MISSING');
      }
      return value;
    });
    const downloaded=await phase('complete-package-download',async()=>{
      const result=await client.exports.download({exportId:exported.id,directory:join(directory,'download'),
        expectedManifestSha256:inspectedPackage.manifestSha256,chunkSize:65536});
      need(result.state==='COMPLETE'&&result.files===inspectedPackage.manifest.files.length,'TIMESCALE_DESK_PACKAGE_INCOMPLETE');
      const local=await inspectTimescalePackage(result.directory,result.nativeManifestSha256);
      need(local.workspaceId===workspaceId,'TIMESCALE_DESK_PACKAGE_CHANGED');
      return{...result,nativeManifestSha256:local.manifestDigest};
    });
    await host.close();host=null;
    const receipt=await phase('portable-receive',()=>receiveTimescaleWorkspace({requestId:record.receiveId,
      packageDirectory:downloaded.directory,expectedDigest:downloaded.nativeManifestSha256,directory:join(directory,'customer-project')}));
    received=await openTimescaleWorkspace({directory:receipt.directory});
    await phase('portable-project-reopen',async()=>{
      const detail=await received.remediation.item(record.workItemId);
      const first=await received.edition(beforeId),last=await received.edition(afterId),following=await received.edition(later.result.editionId);
      const report=await inspectTimescaleRemediationReport(received,reportId,inspected.manifestSha256);
      need(detail.digest===selected.itemDigest&&detail.history.length===selected.historyCount&&
        first.record.digest===native.phases.before.result.digest&&last.record.digest===native.phases.after.result.digest&&
        following.record.digest===later.result.digest&&report.manifest.itemDigest===selected.itemDigest,'TIMESCALE_DESK_PORTABLE_HISTORY_CHANGED');
      const dataset=await loadDatasetConfig(join(receipt.targetDirectory,'generations',native.phases.publish.result.snapshot,'dataset.json'));
      const page=dataset.handle({query:new URLSearchParams('limit=50')});
      need(page.status===200&&page.body.rows.length===4&&page.body.rows.some(row=>row.total==='9007199254740996.50'),
        'TIMESCALE_DESK_CUSTOMER_ROWS_CHANGED');
      return{workspaceId,workItemId:detail.item.id,itemDigest:detail.digest,historyCount:detail.history.length,
        originalBefore:first.record.digest,originalAfter:last.record.digest,laterEdition:following.record.digest,
        reportManifestSha256:report.manifestSha256,completeCustomerPage:page.body,editionCount:received.status().editions.total};
    });
    await received.close();received=null;
    need(digest(await readPrivate(nativeResult,16777216))===sourceDigest&&
      digest(await readPrivate(stateFile,262144))===datasetDigest,'TIMESCALE_DESK_ORIGINAL_INPUT_CHANGED');
    record.complete=true;record.completedAt=stamp();record.nativeCaptureOperations=1;record.nativeDatabaseMutations=0;
    record.allOwnedHandlesClosed=true;await save();
    return{complete:true,reused:false,record:recordPath,workspaceId,workItemId:record.workItemId,report:reportDownload,
      download:downloaded,receiving:receipt,nativeCaptureOperations:1,nativeDatabaseMutations:0,allOwnedHandlesClosed:true};
  }finally{
    const results=await Promise.allSettled([host?.close(),received?.close()]);
    await unlock();
    const failed=results.filter(value=>value.status==='rejected');
    if(failed.length)throw new AggregateError(failed.map(value=>value.reason),'The original receiving owner must finish closing.');
  }
}
export async function main(argv=process.argv.slice(2)){
  const options={},names=new Map([['--native-result','nativeResult'],['--config','configPath'],
    ['--workspace','workspace'],['--directory','directory']]);
  for(let i=0;i<argv.length;i+=2){
    const name=names.get(argv[i]),value=argv[i+1];
    if(!name||!value||options[name]!==undefined)throw fault('TIMESCALE_DESK_RECEIVING_USAGE',
      'Use --native-result ORIGINAL_NATIVE_DEMO_JSON --config ORIGINAL_MERCHANT_JSON --workspace usage --directory PRIVATE_OUTPUT.');
    options[name]=value;
  }
  need(options.nativeResult&&options.configPath&&options.directory,'TIMESCALE_DESK_RECEIVING_USAGE');
  const result=await runTimescaleRemediationReceiving(options);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'TIMESCALE_DESK_RECEIVING_FAILED'})+'\n');process.exitCode=1;});
