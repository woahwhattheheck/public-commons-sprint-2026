// MIT. Released Central source through the original authenticated REST and workspace receiver.
import { mkdir, readFile, open, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { acquireReleaseLease } from '../../../sf82-seller-pilot/release-process.mjs';
import { atomic, digest, formatted, now, stable, writeNew } from '../../odata/state.mjs';
import { normalizeCentralUrl, formPath, formVersionPath, submissionPath, segment } from '../source.mjs';
import { receiveCentralWorkspace } from './receive.mjs';
import { RELEASED_FIXTURES } from './released-fixtures.mjs';
import { receiveReleasedCentralPeriods } from './receive-released-periods.mjs';

const SCHEMA='stellar-forge.central-released-fixture-operation.v1';
const DEFAULT_OPERATION='SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012';
const CENTRAL_COMMIT='7d6de621955c5bb6a68e098ca10c9cbb92285cdf';
const BACKEND_COMMIT='de0d2a07fd7c9ff698cbc312e550dd40ff058340';
const same=(a,b)=>stable(a)===stable(b);
const fail=(code,message,details={})=>{throw Object.assign(new Error(message),{code,...details});};
const requireValue=(value,code,message)=>{if(!value)fail(code,message);};
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function receipt(response){const {body,...value}=response;return value;}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
  requireValue(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path)&&
    (process.platform==='win32'||!(info.mode&0o077)),'CENTRAL_FIXTURE_DIRECTORY','Use a canonical private original operation directory.');
}
async function jsonFile(path){
  try{const info=await lstat(path);requireValue(info.isFile()&&!info.isSymbolicLink()&&info.size<=16*1024*1024,
    'CENTRAL_FIXTURE_FILE','Keep the original bounded regular operation record.');return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function exact(path,bytes){
  await privateDirectory(dirname(path));
  try{await writeNew(path,bytes);}catch(error){if(error.code!=='EEXIST')throw error;
    requireValue(digest(await readFile(path))===digest(bytes),'CENTRAL_FIXTURE_FILE_CHANGED','Preserve the different original fixture or response file.');}
}
function parseBody(response){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.body));}
  catch{fail('CENTRAL_FIXTURE_JSON','The original Central response is not valid UTF-8 JSON.',{response:receipt(response)});}
}
function providerError(response){
  let value;try{value=JSON.parse(response.body.toString('utf8'));}catch{}
  fail('CENTRAL_FIXTURE_PROVIDER','The original Central operation returned HTTP '+response.status+'.',
    {providerStatus:response.status,providerCode:value?.code??null,response:receipt(response)});
}
async function definitiveRejection(attempt){
  const response=attempt.response;
  if(!response||![400,401,403,404,405,409,415,422,429].includes(response.status))return false;
  const bytes=await readFile(response.path);
  requireValue(bytes.length===response.bytes&&digest(bytes)===response.sha256,
    'CENTRAL_FIXTURE_RESPONSE_CHANGED','Preserve the original provider response before reconciling its outcome.');
  let problem;try{problem=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return false;}
  return typeof problem?.code==='number'&&Math.floor(problem.code)===response.status&&
    typeof problem.message==='string'&&problem.message.length>0;
}
function known(response){if(response.status>=200&&response.status<300)return response;
  if(response.status===404)return null;providerError(response);}
function nativeXml(response,expected,label){
  const result=known(response);if(!result)return null;
  requireValue(response.sha256===digest(Buffer.from(expected,'utf8')),'CENTRAL_FIXTURE_NATIVE_SOURCE',
    label+' differs from the exact retained released-source XML.');
  return {kind:'xml',...receipt(response)};
}
function attachmentBytes(file){
  requireValue(file&&typeof file.name==='string'&&file.name&&typeof file.base64==='string',
    'CENTRAL_FIXTURE_MEDIA','Use a retained released-source attachment.');
  const bytes=Buffer.from(file.base64,'base64');
  requireValue(bytes.toString('base64')===file.base64&&(!file.sha256||digest(bytes)===file.sha256),
    'CENTRAL_FIXTURE_MEDIA','The original fixture attachment bytes differ.');return bytes;
}
function assertFixtures(){
  requireValue(RELEASED_FIXTURES.upstream.commit===BACKEND_COMMIT&&Array.isArray(RELEASED_FIXTURES.forms)&&RELEASED_FIXTURES.forms.length,
    'CENTRAL_FIXTURE_SOURCE','Use the exact released Central fixture module.');
  const ids=new Set();
  for(const form of RELEASED_FIXTURES.forms){
    requireValue(typeof form.formId==='string'&&!ids.has(form.formId)&&form.versions?.length&&form.submissions?.length,
      'CENTRAL_FIXTURE_SOURCE','Keep distinct original form IDs and complete versions/submissions.');
    ids.add(form.formId);
    for(const item of [...form.versions,...form.submissions.flatMap(value=>[value,...(value.updates??[])])]){
      const bytes=Buffer.from(item.xml,'utf8');
      requireValue((item.bytes===undefined||item.bytes===bytes.length)&&(!item.sha256||item.sha256===digest(bytes)),
        'CENTRAL_FIXTURE_SOURCE','The released original XML differs from its retained source hash or byte count.');
    }
    const versions=new Set();
    for(const version of form.versions){
      requireValue(typeof version.version==='string'&&typeof version.xml==='string'&&!versions.has(version.version),
        'CENTRAL_FIXTURE_SOURCE','Keep distinct native form version strings and original XML.');versions.add(version.version);
    }
    const submissions=new Set();
    for(const submission of form.submissions){
      requireValue(typeof submission.instanceId==='string'&&typeof submission.xml==='string'&&!submissions.has(submission.instanceId),
        'CENTRAL_FIXTURE_SOURCE','Keep the original unique submission instance IDs.');submissions.add(submission.instanceId);
      for(const item of [submission,...(submission.updates??[])])for(const media of item.attachments??[])attachmentBytes(media);
    }
  }
}
function createReceivingRequest(connection,operationId,projectId){
  const forms=RELEASED_FIXTURES.forms.map(form=>({projectId:String(projectId),formId:form.formId}));
  const tables=(RELEASED_FIXTURES.expectedTables??RELEASED_FIXTURES.forms.flatMap(form=>
    (form.expectedTables??[]).map(table=>({formId:form.formId,...table}))))
    .map(table=>({projectId:String(projectId),...table}));
  const configured=RELEASED_FIXTURES.datasets??(RELEASED_FIXTURES.dataset?[RELEASED_FIXTURES.dataset]:
    RELEASED_FIXTURES.forms.flatMap(form=>(form.datasets??(form.dataset?[form.dataset]:[])).map(item=>({formId:form.formId,...item}))));
  const selectors=configured.map(item=>({selector:{projectId:String(projectId),formId:item.formId,table:item.table},
    name:'Released Central / '+item.formId+' / '+item.table,...(item.configuration??{})}));
  const indicators=tables.map(item=>({name:item.formId+' / '+item.table+' rows',operation:'rows',
    selector:{projectId:String(projectId),formId:item.formId,table:item.table}}));
  if(RELEASED_FIXTURES.expectedSource?.simple?.ageMean!==undefined)
    indicators.push({name:'Released simple mean age',operation:'mean',field:'age',
      selector:{projectId:String(projectId),formId:'simple',table:'Submissions'}});
  requireValue(selectors.length,'CENTRAL_FIXTURE_DATASET','Keep at least one original native table projection.');
  const submissions=RELEASED_FIXTURES.forms.reduce((sum,form)=>sum+form.submissions.length,0);
  const versions=RELEASED_FIXTURES.forms.reduce((sum,form)=>sum+form.submissions.reduce((n,item)=>n+1+(item.updates?.length??0),0),0);
  const generations=RELEASED_FIXTURES.forms.reduce((sum,form)=>sum+form.versions.length,0);
  return {operationId,connection,plan:{name:'Released Central source and native receiving',
    forms,scope:{pageSize:RELEASED_FIXTURES.scope?.pageSize??RELEASED_FIXTURES.pageSize??2}},capture:{label:'Original released form, repeat, history and media cohort'},
    review:{reviewer:'Commons original Central receiving operator',
      note:'This edition contains the pinned Central v2026.3.1 upstream fixture forms, submission versions and explicitly labeled fixture media. Native API responses, exact input bytes, source hashes and original operation identifiers are retained with this receiving operation.',
      findings:[{title:'Released-source receiving',text:'Review the original root/repeat rows, published form versions, submission versions and media receipts together with their pinned fixture provenance.'}],
      indicators,acceptedIssueCodes:RELEASED_FIXTURES.acceptedIssueCodes??[]},
    datasets:selectors,report:{title:'Central released-source field workspace receiving'},
    expected:{tables,history:{submissions,versions,xmlRetained:versions,missingXml:0,missingAttachments:0,
      unavailableSubmissions:0,unavailableListings:0,
      ...(RELEASED_FIXTURES.expectedSource?.attachmentCount===undefined?{}:{
        expectedAttachments:RELEASED_FIXTURES.expectedSource.attachmentCount,presentAttachments:RELEASED_FIXTURES.expectedSource.attachmentCount}),
      ...(RELEASED_FIXTURES.expectedHistory??{})},
      formHistory:{generations,xmlRetained:generations,missingXml:0,missingFields:0,missingAttachments:0,unavailableListings:0,
        ...(RELEASED_FIXTURES.expectedFormHistory??{})}}};
}

/** One source-native provider operation; the same journal and native IDs resume after interruption. */
export async function runReleasedCentralFixture({connection,operationId=DEFAULT_OPERATION,directory,
  workspaceDirectory,outputDirectory,restoreDirectory,projectId=null,onStage=async()=>{}}={}){
  assertFixtures();
  requireValue(typeof operationId==='string'&&operationId.length>0&&operationId.length<=160,'CENTRAL_FIXTURE_INPUT','Retain the original host/receiving operation ID.');
  for(const value of [directory,workspaceDirectory,outputDirectory,restoreDirectory])
    requireValue(typeof value==='string'&&value.trim(),'CENTRAL_FIXTURE_PATHS','Supply the retained original operation and workspace paths.');
  const root=resolve(directory),workspace=resolve(workspaceDirectory),output=resolve(outputDirectory),restored=resolve(restoreDirectory);
  await privateDirectory(root);
  const lease=await acquireReleaseLease(root,'fixture.lock');
  requireValue(lease,'CENTRAL_FIXTURE_NATIVE_LEASE','Use the existing Linux native receiving host.');
  let journal;
  try{
    const base=normalizeCentralUrl(connection.url,{allowLoopback:connection.allowLoopback===true}),api=new URL('v1/',base);
    requireValue(/^[A-Z][A-Z0-9_]{0,127}$/.test(connection.authEnv??''),
      'CENTRAL_FIXTURE_AUTH','Name the retained complete Authorization header in the existing host environment.');
    const authorization=process.env[connection.authEnv];
    requireValue(authorization&&!/[\r\n]/.test(authorization),'CENTRAL_FIXTURE_AUTH','Load the original host credential into its selected environment reference before startup.');
    requireValue(Object.keys(connection).every(key=>['id','name','url','authEnv','allowLoopback'].includes(key)),
      'CENTRAL_FIXTURE_AUTH','Keep only the original connection reference and source endpoint.');
    connection={...connection,url:base};
    const request={operationId,connection,directory:root,workspaceDirectory:workspace,outputDirectory:output,
      restoreDirectory:restored,projectId:projectId===null?null:String(projectId),fixtureSha256:digest(stable(RELEASED_FIXTURES))};
    const requestSha256=digest(stable(request)),journalPath=join(root,'fixture-operation.json');
    journal=await jsonFile(journalPath);
    if(journal)requireValue(journal.schema===SCHEMA&&journal.requestSha256===requestSha256,
      'CENTRAL_FIXTURE_REQUEST','Resume the exact original fixture operation, source and directories.');
    else{
      journal={schema:SCHEMA,requestSha256,request,operationId,status:'PREPARING',createdAt:now(),
        projectName:'Commons released Central '+digest(operationId).slice(0,12)+' '+randomUUID(),project:null,
        operations:{},stages:[],source:RELEASED_FIXTURES.upstream};
      await exact(journalPath,formatted(journal));
    }
    const save=async(stage,values={})=>{
      lease.assertHeld();Object.assign(journal,values,{updatedAt:now()});
      if(stage)journal.stages.push({stage,at:journal.updatedAt});
      await atomic(journalPath,journal);if(stage)await onStage({stage,operationId,...values});
    };
    const finalPath=join(root,'result.json'),previousResult=await jsonFile(finalPath);
    if(previousResult){
      requireValue(previousResult.schema===SCHEMA&&previousResult.requestSha256===requestSha256&&
        previousResult.receivingRequest?.sha256===journal.receivingRequest?.sha256&&same(previousResult.project,journal.project),
        'CENTRAL_FIXTURE_RESULT','The retained completed native result differs.');
      await save(null,{status:'COMPLETE',completedAt:previousResult.completedAt});return previousResult;
    }
    const requestNative=async(path,{method='GET',body=null,contentType,rootPath=false}={})=>{
      const url=new URL(path,rootPath?base:api);
      requireValue(url.origin===api.origin&&(rootPath||url.pathname.startsWith(api.pathname))&&!url.username&&!url.password&&!url.hash,
        'CENTRAL_FIXTURE_BOUNDARY','Keep the native request on the selected original Central service.');
      const bytes=body===null?null:Buffer.isBuffer(body)?body:Buffer.from(body,'utf8'),headers={Accept:'application/json'};
      if(!rootPath)headers.Authorization=authorization;
      if(contentType)headers['Content-Type']=contentType;
      const requestId=randomUUID(),beganAt=now();let response;
      lease.assertHeld();
      try{response=await fetch(url,{method,headers,...(bytes===null?{}:{body:bytes}),
        redirect:'manual',signal:AbortSignal.timeout(120000)});}
      catch(error){fail('CENTRAL_FIXTURE_TRANSPORT','The native request did not return a complete response.',
        {dispatch:method==='GET'?'read':'unknown',request:{id:requestId,method,url:url.href,bodySha256:bytes?digest(bytes):null,beganAt},causeCode:error.code??error.name});}
      const chunks=[];let length=0;
      try{for await(const part of response.body??[]){length+=part.length;
        requireValue(length<=32*1024*1024,'CENTRAL_FIXTURE_RESPONSE_SIZE','Retain a native response within this fixture operation limit.');chunks.push(part);}}
      catch(error){fail(error.code??'CENTRAL_FIXTURE_RESPONSE','The native response body was incomplete.',
        {dispatch:method==='GET'?'read':'unknown',requestId,providerStatus:response.status});}
      const retained=Buffer.concat(chunks),sha256=digest(retained),pathName=join(root,'responses',sha256+'.body');
      await exact(pathName,retained);
      const keptHeaders={};for(const name of ['content-type','content-length','date','etag','last-modified','request-id','x-request-id','retry-after'])
        if(response.headers.has(name))keptHeaders[name]=response.headers.get(name);
      return {requestId,method,url:url.href,bodySha256:bytes?digest(bytes):null,beganAt,
        status:response.status,headers:keptHeaders,sha256,bytes:retained.length,path:pathName,receivedAt:now(),body:retained};
    };
    const ensure=async(key,definition,probe,{unique=true}={})=>{
      const body=definition.body===undefined||definition.body===null?null:
        Buffer.isBuffer(definition.body)?definition.body:Buffer.from(definition.body,'utf8');
      const intent={method:definition.method,path:definition.path,contentType:definition.contentType??null,
        bodySha256:body?digest(body):null,bytes:body?.length??0},fingerprint=digest(stable(intent));
      let record=journal.operations[key];
      if(record)requireValue(record.fingerprint===fingerprint,'CENTRAL_FIXTURE_INTENT','Preserve the exact native request body and target.');
      else{
        if(body)await exact(join(root,'inputs',intent.bodySha256+'.body'),body);
        record=journal.operations[key]={key,fingerprint,intent,status:'PREPARED',preparedAt:now(),attempts:[]};
        await save('prepared:'+key);
      }
      let found=await probe();
      if(found){
        record.status='COMPLETE';record.result=found;record.completedAt=record.completedAt??now();await save('reconciled:'+key);return found;
      }
      requireValue(record.status!=='COMPLETE','CENTRAL_FIXTURE_NATIVE_MISSING','An original completed native source is missing; preserve this operation.');
      const uncertainProject=!unique&&record.attempts.length>0&&
        !(await Promise.all(record.attempts.map(definitiveRejection))).every(Boolean);
      if(uncertainProject){
        for(let i=0;i<5&&!found;i++){await wait(1000);found=await probe();}
        if(found){record.status='COMPLETE';record.result=found;record.completedAt=now();await save('reconciled:'+key);return found;}
        fail('CENTRAL_FIXTURE_PROJECT_RECONCILE','The original project-create response remains uncertain. Reconcile this same unique project name and request; do not create a second project.',
          {projectName:journal.projectName,operation:key,dispatch:'unknown'});
      }
      const attempt={at:now(),status:'DISPATCHING'};record.attempts.push(attempt);record.status='DISPATCHING';await save('dispatching:'+key);
      let response;
      try{response=await requestNative(definition.path,{method:definition.method,body,contentType:definition.contentType});}
      catch(error){attempt.status='UNKNOWN';record.status='UNKNOWN';record.error={code:error.code,message:error.message};
        await save('uncertain:'+key);throw error;}
      attempt.response=receipt(response);attempt.status='RESPONDED';await save('response:'+key);
      for(let i=0;i<5&&!found;i++){found=await probe();if(!found&&i<4)await wait(500);}
      if(!found){if(response.status<200||response.status>=300)providerError(response);
        fail('CENTRAL_FIXTURE_NATIVE_READBACK','The original accepted operation is awaiting its exact native source readback.',
          {operation:key,response:receipt(response),dispatch:'unknown'});}
      record.status='COMPLETE';record.result=found;record.completedAt=now();record.error=null;await save('completed:'+key);return found;
    };
    const sourceVersion=await requestNative('version.txt',{rootPath:true});
    if(sourceVersion.status!==200)providerError(sourceVersion);
    const versionText=sourceVersion.body.toString('utf8');
    requireValue(versionText.includes(CENTRAL_COMMIT)&&versionText.includes(BACKEND_COMMIT),
      'CENTRAL_FIXTURE_RELEASE','The actual running Central source must match the selected released frontend and backend.');
    const actorResponse=await requestNative('users/current');if(actorResponse.status!==200)providerError(actorResponse);
    const actor=parseBody(actorResponse);await save('original-service',{service:{version:receipt(sourceVersion),actor:{id:actor.id,email:actor.email},actorReceipt:receipt(actorResponse)}});
    const findProject=async()=>{
      if(request.projectId!==null){
        const response=known(await requestNative('projects/'+segment(request.projectId)));if(!response)return null;
        const value=parseBody(response);requireValue(String(value.id)===request.projectId,'CENTRAL_FIXTURE_PROJECT','Keep the original selected project.');
        return {id:value.id,name:value.name,receipt:receipt(response)};
      }
      const response=await requestNative('projects');if(response.status!==200)providerError(response);
      const items=parseBody(response);requireValue(Array.isArray(items),'CENTRAL_FIXTURE_PROJECTS','Central returned an invalid project collection.');
      const matches=items.filter(item=>item.name===journal.projectName);
      requireValue(matches.length<=1,'CENTRAL_FIXTURE_PROJECT_COLLISION','Reconcile the duplicate native project identities before continuing.');
      return matches.length?{id:matches[0].id,name:matches[0].name,receipt:receipt(response)}:null;
    };
    let project;
    if(request.projectId!==null){
      project=await findProject();requireValue(project,'CENTRAL_FIXTURE_PROJECT','The selected existing project is unavailable.');
    }else project=await ensure('project-create',{method:'POST',path:'projects',
      contentType:'application/json',body:JSON.stringify({name:journal.projectName})},findProject,{unique:false});
    if(journal.project)requireValue(String(journal.project.id)===String(project.id),'CENTRAL_FIXTURE_PROJECT','The original operation selected a different project.');
    await save('project',{project:{id:project.id,name:project.name}});
    const completedForms=[];
    for(const form of RELEASED_FIXTURES.forms){
      const path=formPath(project.id,form.formId);
      for(let index=0;index<form.versions.length;index++){
        const version=form.versions[index],versionPath=formVersionPath(project.id,form.formId,version.version)+'.xml';
        const published=async()=>nativeXml(await requestNative(versionPath),version.xml,'Published '+form.formId+' '+version.version);
        if(index===0)await ensure('form:'+form.key+':'+index,{method:'POST',
          path:'projects/'+segment(project.id)+'/forms?publish=true',contentType:'application/xml',body:version.xml},published);
        else{
          const draftProbe=async()=>{
            const original=await published();if(original)return {...original,published:true};
            return nativeXml(await requestNative(path+'/draft.xml'),version.xml,'Original form draft');
          };
          await ensure('draft:'+form.key+':'+index,{method:'POST',path:path+'/draft',contentType:'application/xml',body:version.xml},draftProbe);
          await ensure('publish:'+form.key+':'+index,{method:'POST',path:path+'/draft/publish'},published);
        }
      }
      for(const submission of form.submissions){
        const pathInitial=submissionPath(project.id,form.formId,submission.instanceId);
        const all=[submission,...(submission.updates??[])];
        for(let index=0;index<all.length;index++){
          const version=all[index],versionPath=pathInitial+'/versions/'+segment(version.instanceId)+'.xml';
          const verify=async()=>nativeXml(await requestNative(versionPath),version.xml,'Original submission version');
          await ensure('submission:'+form.key+':'+submission.key+':'+index,
            {method:index?'PUT':'POST',path:index?pathInitial:path+'/submissions',contentType:'application/xml',body:version.xml},verify);
          for(const media of version.attachments??[]){
            const bytes=attachmentBytes(media),expected=digest(bytes),mediaPath=pathInitial+'/versions/'+segment(version.instanceId)+'/attachments/'+segment(media.name);
            const mediaProbe=async()=>{
              const response=known(await requestNative(mediaPath));
              if(!response){
                const currentResponse=await requestNative(pathInitial);if(currentResponse.status!==200)providerError(currentResponse);
                const current=parseBody(currentResponse);
                requireValue(current.currentVersion?.instanceId===version.instanceId,'CENTRAL_FIXTURE_MEDIA_VERSION',
                  'The missing attachment belongs to an older original submission version; preserve that history instead of uploading to another current version.');
                return null;
              }
              requireValue(response.sha256===expected&&response.bytes===bytes.length,'CENTRAL_FIXTURE_MEDIA_CHANGED','Preserve the different original native attachment.');
              return {name:media.name,version:version.instanceId,...receipt(response)};
            };
            await ensure('media:'+form.key+':'+submission.key+':'+index+':'+media.name,
              {method:'POST',path:pathInitial+'/attachments/'+segment(media.name),contentType:media.contentType??'application/octet-stream',body:bytes},mediaProbe);
          }
        }
      }
      const versionsResponse=await requestNative(path+'/versions');if(versionsResponse.status!==200)providerError(versionsResponse);
      const versions=parseBody(versionsResponse);
      requireValue(Array.isArray(versions)&&form.versions.every(item=>versions.some(value=>value.version===item.version)),
        'CENTRAL_FIXTURE_VERSIONS','Keep every original published form version in Central.');
      completedForms.push({projectId:String(project.id),formId:form.formId,versions:form.versions.map(item=>item.version),
        submissions:form.submissions.map(item=>({instanceId:item.instanceId,versions:[item,...(item.updates??[])].map(value=>value.instanceId)})),
        versionReceipt:receipt(versionsResponse)});
      await save('form-received',{forms:completedForms});
    }
    const specification=createReceivingRequest(connection,operationId,project.id),specificationPath=join(root,'receiving-request.json');
    await exact(specificationPath,formatted(specification));
    const receivingRequest={path:specificationPath,sha256:digest(formatted(specification))};
    if(journal.receivingRequest)requireValue(same(receivingRequest,journal.receivingRequest),'CENTRAL_FIXTURE_RECEIVING_REQUEST','Preserve the original final capture request.');
    await save('fixture-ready',{receivingRequest,status:'RECEIVING'});
    const result=await receiveCentralWorkspace({specification,directory:workspace,outputDirectory:output,restoreDirectory:restored,
      onStage:async stage=>onStage({fixtureOperation:operationId,...stage})});
    const originalReport=await jsonFile(join(workspace,'reports',result.ids.report,'report.json'));
    requireValue(originalReport,'CENTRAL_FIXTURE_REPORT','The completed original report is missing.');
    const mean=originalReport.indicators.find(item=>item.name==='Released simple mean age');
    if(RELEASED_FIXTURES.expectedSource?.simple?.ageMean!==undefined)
      requireValue(mean&&String(mean.value)===String(RELEASED_FIXTURES.expectedSource.simple.ageMean)&&mean.count===3,
        'CENTRAL_FIXTURE_REPORT','The original retained age source and exact mean differ from the released fixture.');
    const completed={schema:SCHEMA,operationId,requestSha256,fixtureSha256:request.fixtureSha256,source:RELEASED_FIXTURES.upstream,
      project:journal.project,forms:completedForms,service:journal.service,receivingRequest,
      indicators:originalReport.indicators,
      receivingResult:{path:join(output,'result.json'),sha256:digest(formatted(result)),workspaceId:result.workspaceId,
        captureId:result.ids.capture,archive:result.archive},completedAt:now()};
    await exact(finalPath,formatted(completed));await save('complete',{status:'COMPLETE',completedAt:completed.completedAt});
    return completed;
  }finally{await lease.close();}
}
/** Complete provider fixture, original full receiving and same-workspace commissioning. */
export async function runReleasedCentralProgramme(input={}){
  const fixture=await runReleasedCentralFixture(input);
  const whole=await jsonFile(fixture.receivingResult.path);
  requireValue(whole&&digest(formatted(whole))===fixture.receivingResult.sha256&&
    whole.workspaceId===fixture.receivingResult.workspaceId&&whole.ids.capture===fixture.receivingResult.captureId,
    'CENTRAL_FIXTURE_RECEIVING_RESULT','Keep the original whole capture and completed receiving result.');
  const root=resolve(input.directory),specification={
    operationId:fixture.operationId,connection:{...input.connection,id:whole.ids.connection},
    sourceCaptureId:whole.ids.capture,sourceReviewId:whole.reviewId,expectedWorkspaceId:whole.workspaceId,projectId:String(fixture.project.id)
  };
  await exact(join(root,'period-receiving-request.json'),formatted(specification));
  const outputDirectory=join(resolve(input.outputDirectory),'commissioning'),
    restoreDirectory=resolve(input.restoreDirectory)+'-commissioned';
  const commissioned=await receiveReleasedCentralPeriods({...specification,directory:input.workspaceDirectory,
    outputDirectory,restoreDirectory,onStage:input.onStage});
  const selected={schema:'stellar-forge.central-released-programme.v1',operationId:fixture.operationId,
    fixture:{path:join(root,'result.json'),sha256:digest(formatted(fixture))},
    commissioning:{path:join(outputDirectory,'result.json'),sha256:digest(formatted(commissioned)),
      commissionId:commissioned.commissionId,deliveryId:commissioned.deliveryId,workspaceId:commissioned.workspaceId,
      datasets:commissioned.datasets,archive:commissioned.archive,warehouseRequest:commissioned.warehouseRequest}};
  const path=join(root,'programme-result.json'),prior=await jsonFile(path);
  if(prior){
    requireValue(same({...prior,completedAt:null},{...selected,completedAt:null}),
      'CENTRAL_FIXTURE_PROGRAMME','Preserve the original completed programme result.');return prior;
  }
  const result={...selected,completedAt:now()};await exact(path,formatted(result));return result;
}
function argumentsFor(argv){
  const result={};for(let index=0;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];
    requireValue(['--connection','--directory','--workspace','--output','--restore','--operation','--project'].includes(key)&&value&&result[key]===undefined,
      'CENTRAL_FIXTURE_ARGUMENT','Use each documented original receiving path once.');result[key]=value;
  }
  for(const key of ['--connection','--directory','--workspace','--output','--restore'])
    requireValue(result[key],'CENTRAL_FIXTURE_ARGUMENT','Supply '+key+'.');
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=argumentsFor(process.argv.slice(2)),connection=await jsonFile(resolve(args['--connection']));
    const result=await runReleasedCentralProgramme({connection,operationId:args['--operation']??DEFAULT_OPERATION,
      directory:args['--directory'],workspaceDirectory:args['--workspace'],outputDirectory:args['--output'],
      restoreDirectory:args['--restore'],projectId:args['--project']??null,onStage:value=>process.stdout.write(JSON.stringify(value)+'\n')});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write(JSON.stringify({error:error.message,code:error.code??error.name,
    ...(error.providerStatus?{providerStatus:error.providerStatus}:{}),...(error.dispatch?{dispatch:error.dispatch}:{})})+'\n');process.exitCode=1;}
}
