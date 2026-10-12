import path from 'node:path';
import {readdir,readFile} from 'node:fs/promises';
import {check,readJson,saveJson,fileIdentity,digest,inside,optional} from './files.mjs';
export async function records(nativeDirectory,operation){
 const out=[],attempts=await readdir(path.join(nativeDirectory,'attempts'),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return[];throw e;});
 for(const a of attempts.filter(e=>e.isDirectory()&&/^\d{6}$/.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name))){
  const base=path.join(nativeDirectory,'attempts',a.name,'protocol');
  const phases=await readdir(base,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return[];throw e;});
  for(const phase of phases.filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
   const entries=await readdir(path.join(base,phase.name),{withFileTypes:true});
   for(const e of entries.filter(e=>e.isDirectory()&&/^\d{6}$/.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name))){
    const dir=path.join(base,phase.name,e.name),requestFile=path.join(dir,'request.json'),requestBytes=await optional(requestFile);
    if(!requestBytes)continue;const request=JSON.parse(requestBytes);
    check(request.operationId===operation.operationId&&request.digest===operation.digest,'LIGHTDASH_NATIVE_EVIDENCE','Native request belongs to a different operation.');
    const responseFile=path.join(dir,'response.json'),response=await readJson(responseFile,{optional:true}),receipt=await readJson(path.join(dir,'receipt.json'),{optional:true}),failure=await readJson(path.join(dir,'failure.json'),{optional:true});
    let responseIdentity=null;
    if(response){check(response.operationId===operation.operationId&&response.digest===operation.digest&&response.requestSha256===digest(requestBytes),'LIGHTDASH_NATIVE_EVIDENCE','Native response does not match its original request.');responseIdentity={path:responseFile,...await fileIdentity(responseFile)};}
    if(receipt){check(responseIdentity&&receipt.state==='COMPLETE'&&receipt.requestSha256===digest(requestBytes)&&receipt.response.path===responseFile&&receipt.response.bytes===responseIdentity.bytes&&receipt.response.sha256===responseIdentity.sha256,'LIGHTDASH_NATIVE_EVIDENCE','Native response receipt changed.');}
    out.push({attempt:a.name,phase:phase.name,request,response,responseIdentity,receiptPublished:!!receipt,failure,directory:dir});
   }
  }
 }
 return out;
}
export function nativeReferences(entries){
 const out=[];
 for(const e of entries){if(!e.response)continue;const r=e.response.results,uri=new URL(e.request.path,'https://selected.invalid'),proof={requestFile:path.join(e.directory,'request.json'),response:e.responseIdentity,receiptPublished:e.receiptPublished};
  const submitted=uri.pathname.match(/^\/api\/v2\/projects\/([^/]+)\/query\/metric-query$/);
  if(e.request.method==='POST'&&submitted&&typeof r?.queryUuid==='string')out.push({kind:'chart-query',queryUuid:r.queryUuid,projectUuid:submitted[1],...proof});
  const validation=uri.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/validate$/);
  if(e.request.method==='POST'&&validation&&typeof r?.jobId==='string')out.push({kind:'validation-job',jobId:r.jobId,projectUuid:validation[1],...proof});
  const deploy=uri.pathname.match(/^\/api\/v2\/projects\/([^/]+)\/deploy$/);
  if(e.request.method==='POST'&&deploy&&typeof r?.deploySessionUuid==='string')out.push({kind:'deploy-session',sessionUuid:r.deploySessionUuid,projectUuid:deploy[1],readbackAvailable:false,...proof});
  const finalized=uri.pathname.match(/^\/api\/v2\/projects\/([^/]+)\/deploy\/([^/]+)\/finalize$/);
  if(e.request.method==='POST'&&finalized)out.push({kind:'deploy-finalize',sessionUuid:finalized[2],projectUuid:finalized[1],result:r,completed:e.response.nativeCompleted===true,...proof});
  if(e.request.method==='PUT'&&/^\/api\/v[12]\/projects\/[^/]+\/(?:deploy|explores)$/.test(uri.pathname))out.push({kind:'legacy-deploy-response',projectUuid:uri.pathname.split('/')[4],result:r,...proof});
  if(e.request.method==='POST'&&uri.pathname.replace(/\/$/,'')==='/api/v1/org/projects'&&r?.project){out.push({kind:'preview-created',projectUuid:r.project.projectUuid,project:r.project,hasContentCopy:r.hasContentCopy??null,contentCopyError:r.contentCopyError??null,...proof});if(r.contentCopyJobUuid)out.push({kind:'content-copy-job',jobId:r.contentCopyJobUuid,projectUuid:r.project.projectUuid,...proof});}
  if(e.request.method==='DELETE'&&/^\/api\/v1\/org\/projects\/[^/]+$/.test(uri.pathname))out.push({kind:'preview-delete-response',projectUuid:uri.pathname.split('/').at(-1),...proof});
 }
 return out;
}
export async function restorePreviewOwner(nativeDirectory,operation){
 if(operation.action!=='start-preview')return null;
 const file=path.join(nativeDirectory,'owned-preview.json'),old=await readJson(file,{optional:true});
 const entries=await records(nativeDirectory,operation),created=nativeReferences(entries).filter(e=>e.kind==='preview-created');
 check(created.length<=1,'LIGHTDASH_PREVIEW_OWNER','The operation retained multiple native preview creation results.');
 if(!created.length){check(!old,'LIGHTDASH_PREVIEW_OWNER','Preview ownership has no retained native creation response.');return null;}
 const ref=created[0],p=ref.project;
 check(p.type==='PREVIEW'&&p.name===operation.input.name&&p.upstreamProjectUuid===operation.connection.projectUuid&&/^[a-f0-9-]{36}$/i.test(p.projectUuid),'LIGHTDASH_PREVIEW_OWNER','Native creation result differs from the reviewed preview.');
 const expected={schema:'lightdash-commissioning.preview-owner.v1',operationId:operation.operationId,digest:operation.digest,projectUuid:p.projectUuid,name:p.name,organizationUuid:p.organizationUuid,upstreamProjectUuid:p.upstreamProjectUuid,createdByUserUuid:p.createdByUserUuid??null,createResponse:ref.response};
 if(old){check(JSON.stringify(old)===JSON.stringify(expected),'LIGHTDASH_PREVIEW_OWNER','Retained preview identity changed.');return old;}
 await saveJson(file,expected,{createOnly:true});return expected;
}
export async function selectedOperation(workspaceDirectory,id){
 check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id),'LIGHTDASH_OPERATION_ID','Invalid retained operation ID.');
 const locator=await readJson(path.join(workspaceDirectory,'native-state','operations',id+'.json'));
 check(locator.operationId===id&&typeof locator.nativeDirectory==='string'&&locator.nativeDirectory.startsWith(path.resolve(workspaceDirectory)+path.sep),'LIGHTDASH_OPERATION_SCOPE','Retained operation is outside its workspace.');
 const operation=await readJson(path.join(locator.nativeDirectory,'plan.json'));
 check(operation.operationId===id&&operation.digest===locator.digest,'LIGHTDASH_OPERATION_SCOPE','Retained operation location changed.');
 return {nativeDirectory:locator.nativeDirectory,operation,result:await readJson(path.join(locator.nativeDirectory,'result.json'),{optional:true})};
}
