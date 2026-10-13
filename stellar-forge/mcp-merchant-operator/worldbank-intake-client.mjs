// MIT. Approved ZIP -> original registration -> full receiving -> optional programme review.
import { basename, join, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { workflowSeriesPrivateDirectory, readWorkflowSeriesPrivateFile } from './workflow-series-connection.mjs';
import { writeConsoleWorkflowFile } from './console/client-files.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
import { WORLDBANK_ALIAS, WORLDBANK_ID, WORLDBANK_NAME, WORLDBANK_SHA, encodeWorldBank, digest,
  worldBankNeed as need } from './worldbank-programme-contracts.mjs';
import { INTAKE_MAX_BYTES, INTAKE_CHUNK_BYTES, INTAKE_MANIFEST, INTAKE_ORIGINAL,
  intakeIdentity, parseIntakeDelivery } from './worldbank-intake-contracts.mjs';
const PREFIX='merchant_worldbank_programme_';
const readJSON=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readWorkflowSeriesPrivateFile(path,128*1024*1024)));
const same=(a,b)=>encodeWorldBank(a).equals(encodeWorldBank(b));
export function createWorldBankIntakeDownload() {
  return createRetainedDownload({manifestName:INTAKE_MANIFEST,parseManifest:parseIntakeDelivery,
    maximumBytes:128*1024*1024,stateSchema:'stellar-forge.worldbank-intake-download.v1',
    resultSchema:'stellar-forge.worldbank-intake-received.v1',toolPrefix:PREFIX+'intake',
    errorPrefix:'WORLDBANK',clientName:'starforge-worldbank-source-intake',
    validateExportId(value){need(typeof value==='string'&&WORLDBANK_SHA.test(value),'Select the complete source export hash.');return value;},
    describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,intakeId:value.intakeId,source:value.source})});
}
export async function downloadWorldBankIntake({workspace,client,...options}) {
  need(WORLDBANK_ALIAS.test(workspace),'Select a declared Analysis workspace.');
  const upstream=client??await openMerchantFileClient({...options,errorPrefix:'WORLDBANK',clientName:'starforge-worldbank-source-intake'});
  const wrapped={endpoint:upstream.endpoint+'#worldbank-intake='+workspace,
    call:(name,args,requestOptions)=>upstream.call(name,{...args,workspace},requestOptions)};
  const {url,tokenEnv,environment,...rest}=options;
  let primary;
  try {
    const receiver=createWorldBankIntakeDownload();
    const inspected=await receiver.inspect({client:wrapped,exportId:rest.exportId});
    need(inspected.manifest.workspace===workspace,'Keep the selected original workspace.','WORLDBANK_INTAKE_CHANGED');
    return await receiver.download({...rest,client:wrapped});
  }catch(error){primary=error;throw error;}
  finally{if(!client&&upstream.close)try{await upstream.close();}catch(error){if(!primary)throw error;primary.cleanupError=error;}}
}
/**
 * directory is a durable private operation, not a temporary download directory.
 * Reuse id/directory after every interruption. Original bytes are retained before
 * begin/chunk/register. A registered source never changes the accepted data view.
 * prepare explicitly selects an existing programme and creates its native review.
 */
export async function registerWorldBankSource({client,url,tokenEnv,environment,signal,workspace,intakeId,
  handover,directory,resume=false,waitMs=120000,prepare}={}) {
  need(WORLDBANK_ALIAS.test(workspace)&&WORLDBANK_ID.test(intakeId)&&typeof resume==='boolean'&&
    typeof directory==='string'&&directory&&resolve(directory)!=='/'&&
    Number.isSafeInteger(waitMs)&&waitMs>=1&&waitMs<=120000,'Choose the original workspace, intake ID and private operation directory.');
  if(prepare!==undefined)need(prepare&&Object.keys(prepare).every(k=>['programme','operationId','expectedRevision'].includes(k))&&
    WORLDBANK_NAME.test(prepare.programme)&&WORLDBANK_ID.test(prepare.operationId)&&prepare.operationId!==intakeId&&
    Number.isSafeInteger(prepare.expectedRevision)&&prepare.expectedRevision>=1,
    'Choose the exact existing programme, current revision and distinct review operation ID.');
  const root=await workflowSeriesPrivateDirectory(directory,true);
  const entries=await readdir(root);
  need(entries.length===0||entries.includes('intake-client-intent.json')||entries.every(n=>n==='lease.lock'||/^\.intake-client-intent\.json\.pending-[a-f0-9-]{36}$/.test(n)),
    'Use an empty private directory or the original intake operation directory.');
  const lease=await acquireStateLease(root);let upstream,primary;
  try {
    let original,retained;
    try{retained=await readJSON(join(root,'intake-client-intent.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(handover!==undefined) {
      need(typeof handover==='string'&&handover,'Select the complete private approved handover ZIP.');
      original=await readWorkflowSeriesPrivateFile(resolve(handover),INTAKE_MAX_BYTES);
    }else{
      need(retained,'The first intake requires the complete approved handover ZIP.');
      original=await readWorkflowSeriesPrivateFile(join(root,INTAKE_ORIGINAL),INTAKE_MAX_BYTES);
    }
    need(original.length>0&&original.length<=INTAKE_MAX_BYTES,'Use the complete approved ZIP within the original 32 MiB capacity.');
    const intent={bytes:original.length,sha256:digest(original),filename:retained?.intent?.filename??basename(handover)};
    need(Buffer.byteLength(intent.filename)<=240&&!/[\\/\x00-\x1f\x7f]/.test(intent.filename),'Retain the original simple ZIP filename.');
    if(retained)need(retained.schema==='stellar-forge.worldbank-intake-client.v1'&&retained.workspace===workspace&&
      retained.intakeId===intakeId&&same(retained.intent,intent)&&same(retained.prepare??null,prepare??null),
      'Continue the exact original source, workspace and programme selection.','WORLDBANK_INTAKE_CHANGED');
    upstream=client??await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'WORLDBANK',
      maximumResponseBytes:128*1024*1024,clientName:'starforge-worldbank-source-intake'});
    need(typeof upstream.endpoint==='string'&&upstream.endpoint&&typeof upstream.call==='function','Use the existing original MCP client.');
    const state=await upstream.call(PREFIX+'state',{workspace});
    const workspaceId=state.native?.workspace_id;
    need(WORLDBANK_ID.test(workspaceId),'Read the original declared Analysis workspace identity.');
    const selected={schema:'stellar-forge.worldbank-intake-client.v1',endpoint:upstream.endpoint,workspace,workspaceId,
      intakeId,intent,prepare:prepare??null};
    if(retained)need(same(retained,selected),'This operation belongs to another original endpoint or workspace.','WORLDBANK_INTAKE_CHANGED');
    lease.assertHeld();
    await writeConsoleWorkflowFile(join(root,'intake-client-intent.json'),encodeWorldBank(selected));
    await writeConsoleWorkflowFile(join(root,INTAKE_ORIGINAL),original);
    const observations=await workflowSeriesPrivateDirectory(join(root,'observations'),true);
    const observe=async(action,value)=>{
      const bytes=encodeWorldBank({action,value});lease.assertHeld();
      await writeConsoleWorkflowFile(join(observations,digest(bytes)+'.json'),bytes);return value;
    };
    const call=async(action,args={})=>{
      signal?.throwIfAborted();lease.assertHeld();
      try{return await observe(action,await upstream.call(PREFIX+action,{workspace,...args}));}
      catch(error){
        await observe(action,{error:{code:error.code??'WORLDBANK_CLIENT',message:error.message,
          outcomeUnknown:error.outcomeUnknown??false,status:error.status??null}}).catch(saveError=>{error.preservationError=saveError;});
        throw error;
      }
    };
    const check=value=>intakeIdentity(value,{id:intakeId,workspaceId,intent});
    // begin is an exact idempotent intent replay, including after a lost reply.
    let status=check(await call('intake_begin',{request:{id:intakeId,...intent}}));
    const interrupted=['ERROR','INTERRUPTED'].includes(status.status);
    need(!interrupted||resume,'Explicitly continue the same failed/interrupted registration with resume=true.','WORLDBANK_INTAKE_CONTINUATION_REQUIRED');
    if(!['REGISTERED','REGISTERING'].includes(status.status)) {
      for(;;) {
        const offset=status.available_bytes;
        need(Number.isSafeInteger(offset)&&offset>=0&&offset<=original.length&&
          (offset===original.length||offset%INTAKE_CHUNK_BYTES===0)&&status.chunk_bytes===INTAKE_CHUNK_BYTES,
          'Read the original locally available upload prefix.','WORLDBANK_INTAKE_CHANGED');
        if(offset===original.length)break;
        const chunk=original.subarray(offset,Math.min(original.length,offset+INTAKE_CHUNK_BYTES));
        await call('intake_chunk',{intakeId,request:{offset,sha256:digest(chunk),content:chunk.toString('base64')}});
        status=check(await call('intake_status',{intakeId}));
        need(status.available_bytes>=offset+chunk.length,'The original upload did not retain its accepted chunk.','WORLDBANK_INTAKE_CHANGED');
        if(['REGISTERED','REGISTERING'].includes(status.status))break;
      }
      if(!['REGISTERED','REGISTERING'].includes(status.status))
        status=check(await call('intake_register',{intakeId,resume}));
    }
    if(status.status==='REGISTERING')status=check(await call('intake_wait',{intakeId,timeoutMs:waitMs,pollMs:500}));
    if(status.status!=='REGISTERED')return {state:status.status,directory:root,workspace,workspaceId,intakeId,
      source:null,registration:status,recovery:'Continue this same intake ID and directory; use resume only for an ERROR or INTERRUPTED registration.'};
    const captured=await call('intake_export',{intakeId,expectedSha256:intent.sha256});
    need(captured.state==='EXPORTED'&&captured.intakeId===intakeId&&captured.manifest?.workspace===workspace&&
      captured.manifest.workspaceId===workspaceId&&captured.manifest.intakeId===intakeId&&
      captured.manifest.originalSha256===intent.sha256&&same(captured.source,status.result.source)&&
      same(captured.manifest.source,status.result.source),
      'Keep the exact completed native registration export.','WORLDBANK_INTAKE_CHANGED');
    const received=await downloadWorldBankIntake({client:upstream,workspace,exportId:captured.exportId,
      expectedManifestSha256:captured.manifestFile.sha256,directory:join(root,'registered-source'),signal});
    const source={name:status.result.source.name,revision:status.result.source.revision};
    const completion={schema:'stellar-forge.worldbank-source-ready.v1',workspace,workspaceId,intakeId,
      original:intent,source:status.result.source,exportId:captured.exportId,manifestSha256:captured.manifestFile.sha256};
    await writeConsoleWorkflowFile(join(root,'source-selection.json'),encodeWorldBank(completion));
    let programme=null;
    if(prepare) {
      const request={id:prepare.operationId,expected_revision:prepare.expectedRevision,source};
      await writeConsoleWorkflowFile(join(root,'programme-review-intent.json'),encodeWorldBank({workspace,programme:prepare.programme,request}));
      programme=await call('prepare',{programme:prepare.programme,request:{...request,...(resume?{resume:true}:{})}});
      // Every original native review state is retained. Publication remains an
      // explicit reviewed operation through the existing programme interface.
    }
    return {state:'REGISTERED',directory:root,...completion,received,programme};
  }catch(error){primary=error;throw error;}
  finally{
    const errors=[];
    if(!client&&upstream?.close)try{await upstream.close();}catch(error){errors.push(error);}
    try{await lease.close();}catch(error){errors.push(error);}
    if(errors.length){if(primary){primary.cleanupErrors=errors;}else throw new AggregateError(errors,'The original intake client cleanup needs continuation.');}
  }
}
