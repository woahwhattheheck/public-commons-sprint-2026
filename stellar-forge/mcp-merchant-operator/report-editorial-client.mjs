// MIT. Durable agent calls, original return upload, and independent complete receiving.
import {join,resolve} from 'node:path';
import {workflowSeriesPrivateDirectory,readWorkflowSeriesPrivateFile} from './workflow-series-connection.mjs';
import {writeConsoleWorkflowFile} from './console/client-files.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {openMerchantFileClient,createRetainedDownload} from './retained-download.mjs';
import {need,plain,identity,encode,digest,REPORT_REVIEW_SHA,REPORT_REVIEW_MAX_RETURN} from './analysis-report-review-client.mjs';
import {REPORT_REVIEW_ALIAS} from './report-editorial-connection.mjs';
import {EDITORIAL_MANIFEST,EDITORIAL_FILE_BYTES,parseEditorialDelivery} from './report-editorial-contracts.mjs';
import {PREFIX,definitions,validateReportEditorialArguments} from './catalog/report-editorial.mjs';

const decode=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const same=(a,b)=>encode(a).equals(encode(b));
async function connected(options){
  const client=options.client??await openMerchantFileClient({...options,errorPrefix:'REPORT_REVIEW',clientName:'starforge-report-editorial',maximumResponseBytes:2*1024*1024});
  need(typeof client.endpoint==='string'&&client.endpoint&&typeof client.call==='function','Use the original Merchant client.');
  return client;
}
async function closed(client,supplied,lease,primary){
  const errors=[];
  if(!supplied&&client?.close)try{await client.close();}catch(e){errors.push(e);}
  if(lease)try{await lease.close();}catch(e){errors.push(e);}
  if(errors.length){if(primary)primary.cleanupErrors=errors;else throw new AggregateError(errors,'The original report editorial client cleanup needs continuation.');}
}
async function observation(directory,action,value){
  const raw=encode({action,value}),root=await workflowSeriesPrivateDirectory(join(directory,'observations'),true);
  await writeConsoleWorkflowFile(join(root,digest(raw)+'.json'),raw);return value;
}
/** One full immutable intent precedes the first provider write. */
export async function callReportEditorial({action,args,directory,...options}={}){
  const tool=PREFIX+action;validateReportEditorialArguments(tool,args);
  need(typeof directory==='string'&&resolve(directory)!=='/','Select the private original call directory.');
  const root=await workflowSeriesPrivateDirectory(resolve(directory),true),lease=await acquireStateLease(root);
  let upstream,primary,returned=false;
  try{
    upstream=await connected(options);
    const intent={schema:'stellar-forge.report-editorial-agent-call.v1',endpoint:upstream.endpoint,tool,args};
    lease.assertHeld();await writeConsoleWorkflowFile(join(root,'intent.json'),encode(intent));
    need(same(decode(await readWorkflowSeriesPrivateFile(join(root,'intent.json'),2*1024*1024)),intent),
      'The retained complete request changed.','REPORT_REVIEW_INTENT_CHANGED');
    options.signal?.throwIfAborted();lease.assertHeld();
    const value=await upstream.call(tool,args,{requestSignal:options.signal});returned=true;
    await observation(root,action,value);
    return{directory:root,tool,result:value};
  }catch(error){
    if(!definitions.find(x=>x.name===tool)?.readOnly&&!returned&&error.outcomeUnknown!==false&&error.applied!==false)error.outcomeUnknown=true;
    if(returned)error.resultReceived=true;
    await observation(root,action,{error:{code:error.code??'REPORT_REVIEW_CLIENT',message:error.message,outcomeUnknown:error.outcomeUnknown??false,
      resultReceived:returned}}).catch(e=>{error.preservationError=e;});
    primary=error;throw error;
  }finally{await closed(upstream,options.client,lease,primary);}
}
export function createReportEditorialDownload(){
  return createRetainedDownload({manifestName:EDITORIAL_MANIFEST,parseManifest:parseEditorialDelivery,
    maximumBytes:EDITORIAL_FILE_BYTES,stateSchema:'stellar-forge.report-editorial-download.v1',
    resultSchema:'stellar-forge.report-editorial-received.v1',toolPrefix:'merchant_report_editorial',
    errorPrefix:'REPORT_REVIEW',clientName:'starforge-report-editorial',
    validateExportId(value){need(typeof value==='string'&&REPORT_REVIEW_SHA.test(value),'Select the full original export SHA256.');return value;},
    describe:m=>({workspace:m.workspace,workspaceId:m.workspaceId,issueId:m.issueId,issueSha256:m.issueSha256,
      sourceSha256:m.sourceSha256,returnId:m.returnId,applyId:m.applyId})});
}
export async function downloadReportEditorial({workspace,...options}={}){
  need(typeof workspace==='string'&&REPORT_REVIEW_ALIAS.test(workspace),'Select the original Analysis alias.');
  const upstream=await connected(options),wrapped={endpoint:upstream.endpoint+'#report-editorial='+workspace,
    call:(name,args,requestOptions)=>upstream.call(name,{...args,workspace},requestOptions)};
  const{url,tokenEnv,environment,client,...rest}=options;let primary;
  try{
    const receiver=createReportEditorialDownload(),inspected=await receiver.inspect({client:wrapped,exportId:rest.exportId});
    need(inspected.manifest.workspace===workspace,'The complete delivery belongs to another workspace.','REPORT_REVIEW_SOURCE_CHANGED');
    const result=await receiver.download({...rest,client:wrapped}),m=inspected.manifest,root=result.directory;
    const pkg=decode(await readWorkflowSeriesPrivateFile(join(root,'package.json'),EDITORIAL_FILE_BYTES));
    need(pkg.issue?.id===m.issueId&&pkg.issue.workspace_id===m.workspaceId&&pkg.issue_sha256===m.issueSha256&&
      pkg.issue.source_sha256===m.sourceSha256&&typeof pkg.source_json==='string'&&digest(Buffer.from(pkg.source_json))===m.sourceSha256,
      'The received complete package differs from the original issue/source.','REPORT_REVIEW_SOURCE_CHANGED');
    if(m.returnId){
      const returned=decode(await readWorkflowSeriesPrivateFile(join(root,'returned-review.json'),EDITORIAL_FILE_BYTES));
      need(returned.id===m.returnId&&returned.issue_id===m.issueId&&returned.return?.issue_sha256===m.issueSha256&&
        returned.return.workspace_id===m.workspaceId&&returned.return.source_sha256===m.sourceSha256,
        'The received return belongs to another original issue.','REPORT_REVIEW_SOURCE_CHANGED');
    }
    if(m.applyId){
      const applied=decode(await readWorkflowSeriesPrivateFile(join(root,'application.json'),EDITORIAL_FILE_BYTES));
      need(applied.id===m.applyId&&applied.return_id===m.returnId,'The received application belongs to another return.','REPORT_REVIEW_SOURCE_CHANGED');
    }
    return{...result,sourceVerified:true};
  }catch(error){primary=error;throw error;}
  finally{await closed(upstream,client,null,primary);}
}
/**
 * ReturnedFile is the actual full recipient JSON. The first atomic intent holds
 * its complete bytes so interruption before the derived source write is safe.
 * Reuse this upload ID and directory; native return ID is retained in the file.
 */
export async function receiveReportEditorialReturn({workspace,uploadId,returnedFile,directory,...options}={}){
  need(typeof workspace==='string'&&REPORT_REVIEW_ALIAS.test(workspace),'Select the original workspace alias.');identity(uploadId);
  need(typeof directory==='string'&&resolve(directory)!=='/','Select the original private receiving directory.');
  const root=await workflowSeriesPrivateDirectory(resolve(directory),true),lease=await acquireStateLease(root);
  let upstream,primary;
  try{
    let saved;
    try{saved=decode(await readWorkflowSeriesPrivateFile(join(root,'return-intent.json'),24*1024*1024));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    let raw;
    if(returnedFile!==undefined)raw=await readWorkflowSeriesPrivateFile(resolve(returnedFile),REPORT_REVIEW_MAX_RETURN);
    else{need(saved&&typeof saved.originalBase64==='string','The first receiving call requires the complete original returned JSON.');raw=Buffer.from(saved.originalBase64,'base64');need(raw.toString('base64')===saved.originalBase64,'The retained original bytes changed.');}
    need(raw.length>=1&&raw.length<=REPORT_REVIEW_MAX_RETURN,'Retain the complete returned file within the original 16 MiB limit.');
    const request=decode(raw);identity(request?.id);identity(request?.issue_id);identity(request?.workspace_id);
    need(request.schema==='stellar-forge.report-editorial-return.v1'&&REPORT_REVIEW_SHA.test(request.issue_sha256)&&
      REPORT_REVIEW_SHA.test(request.source_sha256),'Select the complete original attributed return.');
    upstream=await connected(options);
    const state=await upstream.call(PREFIX+'state',{workspace},{requestSignal:options.signal});
    need(state.workspaceId===request.workspace_id,'The recipient return belongs to another original Analysis workspace.','REPORT_REVIEW_SOURCE_CHANGED');
    const intent={schema:'stellar-forge.report-editorial-return-client.v1',endpoint:upstream.endpoint,workspace,workspaceId:state.workspaceId,
      uploadId,returnId:request.id,issueId:request.issue_id,issueSha256:request.issue_sha256,sourceSha256:request.source_sha256,
      bytes:raw.length,sha256:digest(raw),originalBase64:raw.toString('base64')};
    if(saved)need(same(saved,intent),'Keep the complete original returned file and selected endpoint.','REPORT_REVIEW_INTENT_CHANGED');
    lease.assertHeld();await writeConsoleWorkflowFile(join(root,'return-intent.json'),encode(intent));
    const retained=decode(await readWorkflowSeriesPrivateFile(join(root,'return-intent.json'),24*1024*1024));
    need(same(retained,intent),'The complete returned-file intent changed.','REPORT_REVIEW_INTENT_CHANGED');
    await writeConsoleWorkflowFile(join(root,'returned-file.json'),raw);
    const call=async(action,args)=>{
      options.signal?.throwIfAborted();lease.assertHeld();
      try{return await observation(root,action,await upstream.call(PREFIX+action,{workspace,...args},{requestSignal:options.signal}));}
      catch(error){await observation(root,action,{error:{code:error.code??'REPORT_REVIEW_CLIENT',message:error.message,
        outcomeUnknown:error.outcomeUnknown??false}}).catch(e=>{error.preservationError=e;});throw error;}
    };
    const check=status=>{
      need(status.uploadId===uploadId&&status.workspaceId===intent.workspaceId&&status.issueId===intent.issueId&&
        status.issueSha256===intent.issueSha256&&status.sourceSha256===intent.sourceSha256&&
        status.bytes===intent.bytes&&status.sha256===intent.sha256&&status.chunkBytes===65536,
        'The retained original upload selection changed.','REPORT_REVIEW_UPLOAD_CHANGED');
      need(Number.isSafeInteger(status.availableBytes)&&status.availableBytes>=0&&status.availableBytes<=raw.length&&
        (status.availableBytes===raw.length||status.availableBytes%65536===0),'Read the verified available fragment prefix.','REPORT_REVIEW_UPLOAD_CHANGED');return status;
    };
    let status=check(await call('return_begin',{uploadId,issueId:intent.issueId,issueSha256:intent.issueSha256,bytes:raw.length,sha256:intent.sha256}));
    while(status.availableBytes<raw.length){
      const offset=status.availableBytes,part=raw.subarray(offset,Math.min(raw.length,offset+65536));
      await call('return_chunk',{uploadId,offset,base64:part.toString('base64'),sha256:digest(part)});
      status=check(await call('return_status',{uploadId}));
      need(status.availableBytes>=offset+part.length,'The original upload did not retain its complete fragment.','REPORT_REVIEW_UPLOAD_CHANGED');
    }
    const result=await call('return_receive',{uploadId}),delivery=result.delivery;
    need(result.state==='RECEIVED'&&result.returnId===intent.returnId&&delivery?.manifest?.workspaceId===intent.workspaceId&&
      delivery.manifest.issueId===intent.issueId&&delivery.manifest.issueSha256===intent.issueSha256&&
      delivery.manifest.sourceSha256===intent.sourceSha256&&delivery.manifest.returnId===intent.returnId,
      'Keep the exact native received return and source delivery.','REPORT_REVIEW_SOURCE_CHANGED');
    await workflowSeriesPrivateDirectory(join(root,'received'),true);
    const received=await downloadReportEditorial({client:upstream,workspace,exportId:delivery.exportId,
      expectedManifestSha256:delivery.manifestFile.sha256,directory:join(root,'received',delivery.exportId),signal:options.signal});
    const completion={schema:'stellar-forge.report-editorial-return-ready.v1',workspace,workspaceId:intent.workspaceId,uploadId,
      returnId:intent.returnId,issueId:intent.issueId,originalSha256:intent.sha256,exportId:delivery.exportId,
      manifestSha256:delivery.manifestFile.sha256,received};
    await writeConsoleWorkflowFile(join(root,'completed-'+digest(encode(completion))+'.json'),encode(completion));
    return{state:'RECEIVED',directory:root,...completion};
  }catch(error){primary=error;throw error;}
  finally{await closed(upstream,options.client,lease,primary);}
}
