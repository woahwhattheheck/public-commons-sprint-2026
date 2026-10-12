#!/usr/bin/env node
// MIT. Continue the original transaction receiving operation through its native merchant owner.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MerchantUSASpendingWorkspaces,readUSASpendingWorkspaceConfiguration} from '../usaspending-workspace.mjs';
import {sha,canonical,requireThat} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/core.mjs';
import {analyzeTransactions} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/transactions/core.mjs';

const help='node examples/usaspending-transactions-native.mjs --received ORIGINAL_NATIVE_OUTPUT --out PRIVATE_DIRECTORY --operation ORIGINAL_OPERATION_ID';
function options(args){const value={};for(let i=0;i<args.length;i+=2){requireThat(['--received','--out','--operation'].includes(args[i])&&args[i+1]&&!value[args[i]],'ARGUMENT_INVALID',help);value[args[i]]=args[i+1];}requireThat(value['--received']&&value['--out']&&value['--operation'],'ARGUMENT_REQUIRED',help);return {received:resolve(value['--received']),out:resolve(value['--out']),operationId:value['--operation']};}
const exists=async path=>{try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
export async function run({received,out,operationId}){
  received=resolve(received);out=resolve(out);
  const originalBytes=await readFile(join(received,'receiving-result.json')),original=JSON.parse(originalBytes);
  requireThat(original.schema==='usaspending-transactions.native-receiving.v1','ORIGINAL_NATIVE_RECEIVING_REQUIRED');
  async function source(name){
    const matches=original.artifacts.filter(item=>basename(item.path)===name);
    requireThat(matches.length===1,'ORIGINAL_ARTIFACT_REQUIRED',name);
    const bytes=await readFile(join(received,name)),expected=matches[0];
    requireThat(bytes.length===expected.bytes&&sha(bytes)===expected.sha256,'ORIGINAL_ARTIFACT_CHANGED',name);
    return bytes;
  }
  const awardBytes=await source('award-only-workspace.json'),captureBytes=await source('transaction-capture.json'),packet=JSON.parse(captureBytes);
  requireThat(packet.awardKey===original.awardKey&&packet.sha256===original.portableCaptureSha256,'ORIGINAL_CAPTURE_CHANGED');
  await mkdir(out,{recursive:true,mode:0o700});
  const journalPath=join(out,'operation.json'),prior=await exists(journalPath);
  const binding={result:sha(originalBytes),award:sha(awardBytes),capture:sha(captureBytes)};
  const journal=prior?JSON.parse(prior):{schema:'stellar-forge.usaspending-transactions-native.v1',operationId,source:binding,startedAt:new Date().toISOString(),steps:{},exports:{},continuations:{}};
  requireThat(journal.operationId===operationId&&canonical(journal.source)===canonical(binding),'ORIGINAL_OPERATION_CHANGED');
  async function checkpoint(){const temporary=journalPath+'.next';await writeFile(temporary,JSON.stringify(journal,null,2)+'\n',{mode:0o600});await rename(temporary,journalPath);}
  async function retain(path,value){
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'),saved=await exists(path);
    if(saved)requireThat(sha(saved)===sha(bytes),'RETAINED_OUTPUT_CHANGED',path);
    else await writeFile(path,bytes,{flag:'wx',mode:0o600});
    return {file:path,bytes:bytes.length,sha256:sha(bytes)};
  }
  async function step(name,fn){if(journal.steps[name])return journal.steps[name];journal.currentStep=name;await checkpoint();const value=await fn();journal.steps[name]=value;await checkpoint();process.stdout.write(JSON.stringify({operationId,step:name,state:'complete'})+'\n');return value;}
  for(const name of ['research','dossiers','exports','downloads','receiving','receiving-dossiers'])await mkdir(join(out,name),{recursive:true,mode:0o700});
  const retainedAward=await retain(join(out,'award-only-workspace.json'),awardBytes);
  const retainedPages=await retain(join(out,'original-transaction-pages.json'),{pages:packet.pages});
  const connectionPath=join(out,'connection.json');
  await retain(connectionPath,{schema:'stellar-forge.usaspending-workspace-connection.v1',workspaces:{federal:{
    label:'Original award transaction research',directory:join(out,'research'),dossierDirectory:join(out,'dossiers'),operator:'Federal research operator',
    sources:{award:{kind:'workspace',file:retainedAward.file,sha256:retainedAward.sha256},pages:{kind:'transaction-pages',file:retainedPages.file,sha256:retainedPages.sha256}}
  }}});
  let owner,opened;
  const start=async(path=connectionPath,workspace='federal')=>{
    owner=new MerchantUSASpendingWorkspaces({usaSpendingWorkspaces:await readUSASpendingWorkspaceConfiguration(path),exportsDirectory:join(out,'exports')});
    opened=await owner.call('merchant_usaspending_open',{workspace});return opened;
  };
  const call=async(name,args={},workspace='federal')=>{const value=await owner.call('merchant_usaspending_'+name,{workspace,...args});return Object.hasOwn(value,'native')?value.native:value;};
  async function close(workspace='federal'){if(!owner)return;await call('close',{instanceId:opened.instanceId},workspace);await owner.close();owner=null;}
  async function keepExport(kind,selection){
    if(journal.exports[kind])return journal.exports[kind];
    const result=await call('export',{kind,...selection});journal.exports[kind]=result;await checkpoint();return result;
  }
  async function download(record,{reopen=false}={}){
    const path=join(out,'downloads',record.file.name),saved=await exists(path);
    if(saved){requireThat(saved.length===record.file.bytes&&sha(saved)===record.exportId,'RETAINED_EXPORT_CHANGED');return {file:path,bytes:saved.length,sha256:record.exportId};}
    const chunks=[];let offset=0,readId,didReopen=false;
    const limit=reopen?Math.min(4096,Math.max(1,Math.floor(record.file.bytes/2))):65536;
    do{
      const result=await call('file_read',{kind:record.kind,exportId:record.exportId,offset,limit,...(readId?{readId}:{})});
      const bytes=Buffer.from(result.data,'base64');
      requireThat(result.offset===offset&&result.file.sha256===record.exportId&&result.file.bytes===record.file.bytes&&bytes.length===result.bytesRead,'RETAINED_CHUNK_CHANGED');
      chunks.push(bytes);offset+=bytes.length;readId=result.readId;
      requireThat(result.nextOffset===(offset<record.file.bytes?offset:null),'RETAINED_CHUNK_SEQUENCE_CHANGED');
      if(reopen&&!didReopen&&offset<record.file.bytes){
        const previous={workspaceId:opened.workspaceId,instanceId:opened.instanceId};
        journal.continuations[record.kind]={exportId:record.exportId,offset,closedInstance:previous.instanceId};await checkpoint();
        await close();await start();
        requireThat(opened.workspaceId===previous.workspaceId&&opened.instanceId!==previous.instanceId,'ORIGINAL_WORKSPACE_REOPEN_CHANGED');
        journal.continuations[record.kind].reopenedInstance=opened.instanceId;await checkpoint();
        readId=undefined;didReopen=true;
      }
    }while(offset<record.file.bytes);
    const bytes=Buffer.concat(chunks);
    requireThat(bytes.length===record.file.bytes&&sha(bytes)===record.exportId,'COMPLETE_EXPORT_CHANGED');
    return retain(path,bytes);
  }
  try{
    await start();
    await step('award_receiving',async()=>{
      if(!opened.counts.editions)await call('source_import',{source:'award'});
      const row=await call('award',{editionId:original.editionId,awardKey:original.awardKey});
      requireThat(row.row_sha256===packet.awardRowSha256,'ORIGINAL_AWARD_CHANGED');
      return {editionId:original.editionId,awardKey:original.awardKey,rowSha256:row.row_sha256};
    });
    const capture=await step('original_transaction_pages',async()=>call('source_import',{source:'pages',editionId:original.editionId,awardKey:original.awardKey,maxRows:packet.maxRows}));
    const captureId=capture.captureId;
    await step('native_timeline',async()=>{
      const summary=await call('transaction_summary',{captureId});
      requireThat(summary.capture.status==='complete'&&summary.analysis.net_obligation_usd===original.netObligationUsd&&summary.analysis.unique_transactions===original.transactions,'ORIGINAL_TRANSACTION_TOTAL_CHANGED');
      const rows=[];let snapshot;
      for(let page=1;;page++){
        const value=await call('transaction_rows',{captureId,page,limit:1,...(snapshot?{expectedSnapshot:snapshot}:{})});
        rows.push(...value.rows);snapshot=value.snapshot;
        if(!value.hasNext)break;
        requireThat(value.rows.length>0&&rows.length<value.total,'ORIGINAL_TIMELINE_PAGING_CHANGED');
      }
      requireThat(canonical(rows)===canonical(analyzeTransactions(packet.rows,{coverage:packet.coverage}).timeline),'ORIGINAL_TRANSACTION_ROWS_CHANGED');
      await retain(join(out,'native-timeline.json'),rows);await retain(join(out,'native-summary.json'),summary);
      return {captureId,transactions:rows.length,netObligationUsd:summary.analysis.net_obligation_usd,snapshot};
    });
    await step('native_workshare',async()=>{
      const keys=['status','fit','fundingChange','proposedWorkshare','deliverables','acceptance','owner','caseUrl','nextAction','notes'];
      requireThat(packet.review?.data,'ORIGINAL_WORKSHARE_REQUIRED');
      const review=Object.fromEntries(keys.filter(key=>packet.review.data[key]!==undefined).map(key=>[key,packet.review.data[key]]));
      const current=await call('transaction_summary',{captureId}),saved=current.review??await call('transaction_review_save',{captureId,expectedRevision:0,review});
      requireThat(keys.every(key=>(saved.data[key]??'')===(review[key]??''))&&saved.data.sourceFingerprint===current.capture.fingerprint,'ORIGINAL_WORKSHARE_CHANGED');
      return {revision:saved.revision,sourceFingerprint:saved.data.sourceFingerprint};
    });
    await step('original_browser_job',async()=>{
      let job;
      if(journal.jobId){const state=await call('status');if(state.jobs.some(item=>item.id===journal.jobId))job=await call('job',{jobId:journal.jobId});}
      if(!job){job=await call('transaction_capture',{captureId});journal.jobId=job.id;await checkpoint();}
      const deadline=Date.now()+30000;
      while(job.status==='running'){requireThat(Date.now()<deadline,'ORIGINAL_JOB_WAIT_EXPIRED');await new Promise(resolve=>setTimeout(resolve,50));job=await call('job',{jobId:job.id});}
      requireThat(job.status==='complete','ORIGINAL_TRANSACTION_JOB_FAILED');
      return {jobId:job.id,captureId,status:job.status};
    });
    await step('native_source_comparison',async()=>{
      const source=await call('transaction_source',{captureId,page:1}),comparison=await call('transaction_compare',{before:captureId,after:captureId});
      requireThat(source.response.sha256===original.originalResponseSha256&&Object.values(comparison.counts).every(value=>value===0),'ORIGINAL_SOURCE_COMPARISON_CHANGED');
      await retain(join(out,'native-source-receipt.json'),source);return {responseSha256:source.response.sha256,comparison:comparison.counts};
    });
    for(const [kind,selection] of [
      ['transaction-json',{captureId,includeReviews:true}],['transaction-csv',{captureId}],
      ['transaction-source',{captureId,page:1}],['transaction-source-receipt',{captureId,page:1}],
      ['transaction-comparison',{before:captureId,after:captureId}],['transaction-brief',{captureId}],
    ]){
      const record=await keepExport(kind,selection);
      await step('download_'+kind,()=>download(record,{reopen:kind==='transaction-json'}));
    }
    await step('portable_capture_receiving',async()=>{
      const receivedCapture=journal.steps['download_transaction-json'],connection=join(out,'receiving-connection.json');
      await retain(connection,{schema:'stellar-forge.usaspending-workspace-connection.v1',workspaces:{receiving:{
        label:'Original transaction receiving',directory:join(out,'receiving'),dossierDirectory:join(out,'receiving-dossiers'),
        sources:{award:{kind:'workspace',file:retainedAward.file,sha256:retainedAward.sha256},transactions:{kind:'transactions',file:receivedCapture.file,sha256:receivedCapture.sha256}}
      }}});
      await close();await start(connection,'receiving');
      if(!opened.counts.editions)await call('source_import',{source:'award'},'receiving');
      const result=await call('source_import',{source:'transactions',includeReview:true},'receiving');
      const summary=await call('transaction_summary',{captureId:result.captureId},'receiving');
      const exported=JSON.parse(await readFile(receivedCapture.file));
      requireThat(summary.analysis.net_obligation_usd===original.netObligationUsd&&summary.review?.data.receivedFrom?.packetSha256===exported.sha256,'NATIVE_CAPTURE_RECEIVING_CHANGED');
      await call('source_import',{source:'transactions',includeReview:true},'receiving');
      const identity={workspaceId:opened.workspaceId,instanceId:opened.instanceId};
      await close('receiving');await start(connection,'receiving');
      const reopened=await call('transaction_summary',{captureId:result.captureId},'receiving');
      requireThat(opened.workspaceId===identity.workspaceId&&opened.instanceId!==identity.instanceId&&reopened.review?.revision===summary.review.revision,'NATIVE_RECEIVING_REOPEN_CHANGED');
      const resultView={captureId:result.captureId,transactions:reopened.analysis.unique_transactions,netObligationUsd:reopened.analysis.net_obligation_usd,reviewRevision:reopened.review.revision,sourcePacketSha256:exported.sha256};
      await close('receiving');return resultView;
    });
    journal.status='complete';journal.completedAt??=new Date().toISOString();delete journal.currentStep;delete journal.error;await checkpoint();
    process.stdout.write(JSON.stringify({operationId,status:journal.status,source:binding,transactions:original.transactions,netObligationUsd:original.netObligationUsd,exports:Object.keys(journal.exports).length,receiving:journal.steps.portable_capture_receiving,journal:journalPath})+'\n');
    return journal;
  }catch(error){journal.status='interrupted';journal.error={code:error.code??'NATIVE_RECEIVING_FAILED',message:error.message};await checkpoint().catch(()=>{});throw error;}
  finally{await owner?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run(options(process.argv.slice(2))).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'NATIVE_RECEIVING_FAILED',message:error.message})+'\n');process.exitCode=1;});
