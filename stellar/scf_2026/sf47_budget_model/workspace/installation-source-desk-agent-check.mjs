// MIT. Focused adapter protocol check; the original financial/source engines remain unchanged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  INSTALLATION_SOURCE_SCHEMA, installationSourceCanonical, installationSourceRequestSha256,
  prepareInstallationSourceCommand, prepareInstallationSourceUpload, prepareInstallationSourceReview,
  validateInstallationSourceOperation, planInstallationSourceOperation, performInstallationSourceOperation,
} from './installation-source-desk-agent.mjs';
import {grantInstallationSourceTools} from '../../../../stellar-forge/mcp-merchant-operator/catalog/grant-installation-sources.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function checkInstallationSourceAdapter({nativeDigest}={}){
  const caseId='operation-'+'1'.repeat(32),draftId='source-desk-'+'2'.repeat(32);
  const common={caseId,draftId},requestId='source-adapter-original-01';
  const bytes=Buffer.from('Complete original source \u00e9\n');
  const operation=prepareInstallationSourceUpload(caseId,draftId,bytes,{
    filename:'Original.json',mediaType:'application/json',sourceUrl:'https://example.invalid/original',
    observedAt:'2026-10-13T00:00:00Z',expectedSha256:hash(bytes),
  },{expectedRevision:1,actor:'Original operator',requestId});
  const before=operation.request.data.contentBase64;
  bytes[0]=0;
  assert.notEqual(Buffer.from(before,'base64')[0],bytes[0]);
  const nativePayload={schema:INSTALLATION_SOURCE_SCHEMA,caseId,draftId,body:operation.request};
  if(nativeDigest)assert.equal(nativeDigest(nativePayload),operation.requestSha256);
  assert.equal(installationSourceCanonical({'10':'ten','2':'two','\u{10000}':1,'\uE000':2}),
    '{"10":"ten","2":"two","\uE000":2,"\u{10000}":1}');
  const sparse=Array(2);sparse[1]='one';sparse.extra='extra';
  assert.throws(()=>installationSourceCanonical(sparse));
  assert.throws(()=>installationSourceCanonical({amount:0.1}));
  assert.throws(()=>installationSourceCanonical({text:'\uD800'}));
  const frozen=planInstallationSourceOperation('command',{...common,body:operation.request});
  operation.request.actor='Changed later';
  assert.equal(frozen.options.body.actor,'Original operator');
  const saved=prepareInstallationSourceCommand(caseId,draftId,frozen.options.body);
  assert.equal(installationSourceRequestSha256(caseId,draftId,saved.request),saved.requestSha256);
  const journal={schema:INSTALLATION_SOURCE_SCHEMA,requestId,state:'NOT_RECORDED'};
  let calls=0,committed=null,lost=true;
  const response=value=>({value,bytes:Buffer.from(JSON.stringify(value)),sha256:hash(JSON.stringify(value)),
    mediaType:'application/json',status:200});
  const send=async(route,options)=>{
    if(route.includes('/requests/'))return response(committed?{...journal,state:'RECORDED',result:committed}:journal);
    calls++;
    committed={schema:INSTALLATION_SOURCE_SCHEMA,requestId,requestSha256:saved.requestSha256,
      draft:{caseId,id:draftId,revision:2},result:{state:'ORIGINAL_RETAINED'}};
    assert.deepEqual(options.body,saved.request);
    if(lost){lost=false;throw Object.assign(new Error('Original reply interrupted'),{code:'GRANT_RESULT_UNCERTAIN',requestId});}
    return response(committed);
  };
  await assert.rejects(performInstallationSourceOperation(planInstallationSourceOperation('execute',{operation:saved}),send),
    error=>error.code==='GRANT_RESULT_UNCERTAIN'&&error.requestId===requestId);
  const recovered=await performInstallationSourceOperation(planInstallationSourceOperation('reconcile',{operation:saved}),send);
  assert.equal(recovered.state,'RECORDED');assert.equal(recovered.replayed,true);assert.equal(calls,1);
  const repeated=await performInstallationSourceOperation(planInstallationSourceOperation('execute',{operation:saved}),send);
  assert.equal(repeated.receipt.requestSha256,saved.requestSha256);assert.equal(calls,1);
  const preview={schema:'stellar-forge.installation-commissioning-archive.v1',caseId,draftId,draftRevision:2,
    ready:true,selection:{archiveFileId:'input-'+'3'.repeat(64),expectedArchiveSha256:'4'.repeat(64),replaceFileIds:[]}};
  preview.previewSha256=hash(installationSourceCanonical(preview));
  const reviewed=prepareInstallationSourceReview(preview,{actor:'Original operator',requestId:'archive-source-original-01'});
  assert.equal(reviewed.request.action,'commissioning.archive.receive');
  assert.equal(reviewed.request.data.expectedPreviewSha256,preview.previewSha256);
  if(nativeDigest){
    assert.equal(nativeDigest({schema:INSTALLATION_SOURCE_SCHEMA,caseId,draftId,body:reviewed.request}),reviewed.requestSha256);
    const unsealed={...reviewed};delete unsealed.operationSha256;
    assert.equal(nativeDigest(unsealed),reviewed.operationSha256);
  }
  assert.throws(()=>prepareInstallationSourceCommand(caseId,draftId,{...reviewed.request,expectedRevision:3},{review:preview}));
  const changed=JSON.parse(JSON.stringify(reviewed));changed.review.ready=false;
  assert.throws(()=>validateInstallationSourceOperation(changed));
  const file=Buffer.from('complete native preparation ZIP bytes'),fileSha=hash(file);
  const archivePlan=planInstallationSourceOperation('archive',{...common,preparationId:'preparation-'+'5'.repeat(64),expectedSha256:fileSha});
  const archiveCalls=[];
  const archive=await performInstallationSourceOperation(archivePlan,async(route,options)=>{
    archiveCalls.push({route,options});
    if(route.endsWith('describe=1'))return response({preparationId:archivePlan.input.preparationId,bytes:file.length,sha256:fileSha});
    assert.equal(options.maxResponseBytes,file.length);
    return {bytes:file,sha256:fileSha,status:200,mediaType:'application/zip'};
  });
  assert.equal(archive.bytes.length,file.length);assert.equal(archiveCalls.length,2);
  assert.equal(new Set(grantInstallationSourceTools.map(row=>row.name)).size,18);
  for(const action of ['commissioning-inspect','commissioning-preview','archive-inspect']){
    const plan=planInstallationSourceOperation(action,{...common,body:{expectedRevision:2}});
    assert.equal(plan.options.mutation,false);
  }
  return {schema:'stellar-forge.installation-source-agent-check.v1',status:'PASS',tools:18,
    originalRequestSha256:saved.requestSha256,originalReviewSha256:reviewed.requestSha256,
    outcomes:['Exact original source bytes remain frozen after caller mutation.',
      'Canonical Unicode keys, decimal strings and complete arrays retain native request identity.',
      'Lost original reply reconciles through its journal and never dispatches a second mutation.',
      'Full reviewed preview remains bound to the exact action, case, draft, revision and selected data.',
      'Complete archive receiving uses the original descriptor size and SHA.',
      'Read-only native previews retain read-only failure semantics.']};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const nativeDigest=value=>{
    const result=spawnSync(process.env.PYTHON??'python3',['-c',
      'import json,sys;sys.path.insert(0,sys.argv[1]);from model import digest;print(digest(json.load(sys.stdin)))',
      fileURLToPath(new URL('.',import.meta.url))],{input:JSON.stringify(value),encoding:'utf8'});
    if(result.status!==0)throw new Error(result.stderr||'The original native model digest did not complete.');
    return result.stdout.trim();
  };
  checkInstallationSourceAdapter({nativeDigest}).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n'))
    .catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1;});
}
