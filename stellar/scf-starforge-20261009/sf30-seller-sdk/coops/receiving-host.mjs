// MIT. Portable host for one original Coastal Source Operations receiving run.
// Use the selected native admission/controller. This command owns one console and
// one persistent browser; the business workflow remains in receiving.mjs.
import fs from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {startCoopsWorkspace} from './workspace.mjs';
import {runCoopsOperatorJourney} from './receiving.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(v).digest('hex');
const assert=(v,m)=>{if(!v)throw new Error(m);};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const safe=e=>String(e?.message??e).replace(/(https?:\/\/[^\s"'<>#]+)#[A-Za-z0-9_-]+/g,'$1#[private-session]').slice(0,4000);
function regular(file,max=4*1024*1024){
 const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'Use the selected bounded regular file: '+file);return s;
}
function json(file,max){regular(file,max);return JSON.parse(fs.readFileSync(file,'utf8'));}
function directory(path){
 fs.mkdirSync(path,{recursive:true,mode:0o700});const s=fs.lstatSync(path);
 assert(s.isDirectory()&&!s.isSymbolicLink(),'Use a physical selected directory: '+path);
 return fs.realpathSync(path);
}
function contains(parent,child){const p=relative(parent,child);return p===''||(!p.startsWith('..'+String.fromCharCode(47))&&p!=='..'&&!isAbsolute(p));}
function atomic(file,value){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(fs.existsSync(file))regular(file,128*1024*1024);
 const temporary=file+'.tmp-'+randomUUID();let fd;
 try{
  fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temporary,file);
  const parent=fs.openSync(dirname(file),fs.constants.O_RDONLY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }finally{if(fd!==undefined&&fd!==null)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
async function identity(file,max=1024*1024*1024){
 regular(file,max);const h=createHash('sha256');let bytes=0;
 for await(const part of fs.createReadStream(file)){bytes+=part.length;h.update(part);}
 return{path:file,bytes,sha256:h.digest('hex')};
}
function explicitFile(value,label){
 assert(typeof value==='string'&&isAbsolute(value),'Supply the selected absolute '+label+' path.');
 const file=fs.realpathSync(value);regular(file,1024*1024*1024);return file;
}
function paths(input){
 for(const key of ['workspace','output','browserProfile'])assert(typeof input[key]==='string'&&isAbsolute(input[key]),'Supply an absolute '+key+' path.');
 const selected={workspace:resolve(input.workspace),output:resolve(input.output),browserProfile:resolve(input.browserProfile)};
 const values=Object.values(selected);
 for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)assert(!contains(values[i],values[j])&&!contains(values[j],values[i]),'Keep the workspace, operator outputs and browser profile in separate selected directories.');
 for(const path of values)assert(!contains(here,path)&&!contains(path,here),'Keep receiving state outside the application source.');
 for(const key of Object.keys(selected))selected[key]=directory(selected[key]);
 const physical=Object.values(selected);for(let i=0;i<physical.length;i++)for(let j=i+1;j<physical.length;j++)assert(!contains(physical[i],physical[j])&&!contains(physical[j],physical[i]),'The physical receiving directories must remain separate.');
 for(const path of physical)assert(!contains(here,path)&&!contains(path,here),'Physical receiving state must stay outside application source.');
 return selected;
}
function selectionFile(input){
 if(!input.selectionFile)return{value:{},file:null};
 const file=explicitFile(input.selectionFile,'source selection'),value=json(file,65536);
 assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['capture','historical','study'].includes(k)),'Selection JSON accepts only capture, historical and an explicit optional study.');
 return{value,file};
}
export async function runCoopsReceivingHost(input={}){
 const selected=paths(input),playwrightModule=explicitFile(input.playwrightModule,'Playwright module'),chrome=explicitFile(input.chrome,'Chrome executable');
 const port=input.port===undefined?0:Number(input.port);
 assert(Number.isSafeInteger(port)&&port>=0&&port<=65535,'Choose a valid original listening port.');
 const configuration=selectionFile(input),mappingFile=explicitFile(input.mappingFile??join(here,'examples/model-input-columns.json'),'original mapping');
 const reviewResponse=resolve(input.reviewResponse??join(selected.output,'independent-source-review.json'));
 assert(!contains(selected.workspace,reviewResponse)&&!contains(selected.browserProfile,reviewResponse),'Keep the independent review response outside the application data and browser profile.');
 const studyReviewResponse=configuration.value.study?resolve(input.studyReviewResponse??join(selected.output,'independent-study-review.json')):null;
 if(studyReviewResponse)assert(!contains(selected.workspace,studyReviewResponse)&&!contains(selected.browserProfile,studyReviewResponse),'Keep the study decision outside the native data and browser profile.');
 const operator=String(input.operator??'Internal coastal source receiving'),selection={...selected,playwrightModule,chrome,selection:configuration.value,mappingFile,operator,reviewResponse,userAgent:input.userAgent??null};
 if(studyReviewResponse)selection.studyReviewResponse=studyReviewResponse;
 if(input.operationId!==undefined)assert(typeof input.operationId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.operationId),'Use the original stable receiving operation ID.');
 const intentSha256=sha(stable(selection)),recordPath=join(selected.output,'coops-receiving-host.json');
 let record=fs.existsSync(recordPath)?json(recordPath):{schema:'stellar-forge.coops-receiving-host.v1',operationId:input.operationId??randomUUID(),selection,intentSha256,createdAt:new Date().toISOString(),state:'PREPARED',workspaceId:null,origin:null,port:port||null,restarts:{},runs:[],sourceHistory:[],result:null};
 assert(record.schema==='stellar-forge.coops-receiving-host.v1'&&record.intentSha256===intentSha256,'Continue the same original receiving paths, input selection and native runtime.');
 if(input.operationId)assert(record.operationId===input.operationId,'Keep the original receiving operation ID.');
 if(port&&record.port)assert(port===record.port,'Reopen the original positive port; browser drafts are bound to that origin.');
 if(record.state==='COMPLETE'){
  const exact=await identity(record.result.path);assert(exact.sha256===record.result.sha256&&exact.bytes===record.result.bytes,'The completed original receiving result changed.');
  return{...json(exact.path,128*1024*1024),hostRecordPath:recordPath,runtimeClosure:record.closure};
 }
 const sourceFiles=['receiving-host.mjs','receiving.mjs','workspace.mjs','core.mjs','provider.mjs','domain.mjs','schema.mjs','history.mjs','exports.mjs','dataset.mjs','web/app.js','study.mjs','study-exchange.mjs','web/study.js','web/index.html','web/style.css','browser-assets.json','analysis/retained.mjs','analysis/core.mjs','analysis/bundle.mjs'];
 const source=await Promise.all(sourceFiles.map(async path=>({path,...await identity(join(here,path),8*1024*1024)})));
 const sourceSha256=sha(stable(source.map(({path,bytes,sha256})=>({path:relative(here,path),bytes,sha256}))));
 if(record.sourceHistory.length&&record.sourceHistory.at(-1).sha256!==sourceSha256)assert(String(input.continuationNote??'').trim(),'Record the concrete source correction before continuing this incomplete operation.');
 const privateRoot=directory(join(selected.output,'private')),startupPath=join(privateRoot,'coops-session.json');
 let service=null,context=null,closingService=null,closingBrowser=null,aborted=null,result=null,problem=null,owned=false;
 const epoch=randomUUID(),persist=()=>atomic(recordPath,record);
 const progress=(message,extra={})=>{console.log(JSON.stringify({schema:'stellar-forge.coops-receiving-progress.v1',operationId:record.operationId,at:new Date().toISOString(),message,...extra}));};
 async function closeService(){
  if(closingService)return closingService;const current=service;if(!current)return;
  service=null;closingService=current.close();try{await closingService;}finally{closingService=null;}
 }
 async function closeBrowser(){
  if(closingBrowser)return closingBrowser;const current=context;if(!current)return;
  context=null;closingBrowser=current.close();try{await closingBrowser;}finally{closingBrowser=null;}
 }
 async function openService(){
  service=await startCoopsWorkspace({directory:selected.workspace,port:record.port??port,userAgent:input.userAgent,expectedWorkspaceId:record.workspaceId??undefined});
  owned=true;const actual=service.app.schema(),actualPort=Number(new URL(service.origin).port);
  assert(!record.workspaceId||actual.workspaceId===record.workspaceId,'The native workspace identity changed.');
  assert(!record.origin||service.origin===record.origin,'The original browser origin changed.');
  record.workspaceId=actual.workspaceId;record.origin=service.origin;record.port=actualPort;
  atomic(startupPath,{schema:'stellar-forge.coops-workspace-startup.v1',status:'COOPS_READY',directory:selected.workspace,workspaceId:actual.workspaceId,url:service.url,sourceDirectory:here,pid:process.pid,hostRunId:epoch});
  return service;
 }
 const interrupt=signal=>{aborted=new Error('The original receiving process was interrupted by '+signal+'.');void closeBrowser().catch(()=>{});void closeService().catch(()=>{});};
 const onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM');
 process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
 try{
  // The original workspace acquires its own native writer lease before this
  // host records a new live run or opens a browser.
  await openService();
  record.runs.push({id:epoch,pid:process.pid,startedAt:new Date().toISOString(),origin:record.origin});
  if(!record.sourceHistory.length||record.sourceHistory.at(-1).sha256!==sourceSha256)record.sourceHistory.push({sha256:sourceSha256,files:source,note:input.continuationNote??'Original selected receiving source',at:new Date().toISOString()});
  record.state='RUNNING';record.error=null;persist();
  const loaded=await import(pathToFileURL(playwrightModule).href),chromium=loaded.chromium??loaded.default?.chromium;
  assert(chromium&&typeof chromium.launchPersistentContext==='function','The selected original module must expose Playwright Chromium.');
  context=await chromium.launchPersistentContext(selected.browserProfile,{executablePath:chrome,headless:true,viewport:{width:1365,height:1000},acceptDownloads:true,args:['--no-sandbox','--disable-gpu']});
  const page=context.pages().find(p=>p.url().startsWith(record.origin+'/'))??context.pages()[0]??await context.newPage();

  async function independentReview(packet,kind){
   if(aborted)throw aborted;
   const study=kind==='study',requestPath=join(selected.output,'independent-'+kind+'-review-request.json'),responsePath=study?studyReviewResponse:reviewResponse,
    nativeSchema=study?'stellar-forge.coops-independent-study-review-request.v1':'stellar-forge.coops-independent-review-request.v1',
    recordKey=study?'studyReview':'review',pins=study?{studyId:packet.studyId,studyRevision:packet.studyRevision,studySha256:packet.studySha256}:{editionId:packet.editionId,sourceSha256:packet.sourceSha256},
    exact=value=>value.packetSha256===packet.packetSha256&&Object.entries(pins).every(([key,v])=>value[key]===v),
    request={schema:nativeSchema,hostOperationId:record.operationId,...packet};
   if(fs.existsSync(requestPath))assert(exact(json(requestPath,128*1024*1024)),'The original independent '+kind+' review packet changed.');
   else atomic(requestPath,request);
   record[recordKey]={state:'AWAITING_ACTUAL_DECISION',packetSha256:packet.packetSha256,...pins,requestPath,responsePath};persist();
   const waitMs=Number(input.reviewTimeoutMs??1800000);assert(Number.isSafeInteger(waitMs)&&waitMs>0,'Choose a positive independent-review waiting limit.');
   const until=Date.now()+waitMs;let next=0;
   while(Date.now()<until){
    if(aborted)throw aborted;
    if(fs.existsSync(responsePath)){
     const response=json(responsePath,65536);assert(exact(response),'The actual '+kind+' review must bind this exact original packet.');
     assert(['reviewed','follow_up'].includes(response.status)&&typeof response.reviewer==='string'&&response.reviewer.trim()&&typeof response.note==='string'&&response.note.trim()&&typeof response.performedAt==='string'&&Number.isFinite(Date.parse(response.performedAt)),'The independent reviewer must supply their actual decision, note, identity and time.');
     if(study)assert(Array.isArray(response.acknowledgedWarnings)&&response.acknowledgedWarnings.every(id=>typeof id==='string'),'The actual study review must retain its explicit warning acknowledgements.');
     record[recordKey]={...record[recordKey],state:'DECISION_RETAINED',response:await identity(responsePath,65536),decision:response.status,reviewer:response.reviewer};persist();return response;
    }
    if(Date.now()>=next){next=Date.now()+15000;progress('Awaiting the independent decision on actual retained '+kind+' sources',{requestPath,responsePath,packetSha256:packet.packetSha256});}
    await delay(500);
   }
   throw new Error('The actual independent '+kind+' review is still pending. Preserve its packet and original response path for continuation.');
  }
  async function restart(request){
   if(aborted)throw aborted;
   assert(request.workspaceId===record.workspaceId&&request.baseURL===record.origin&&typeof request.phaseKey==='string','Reopen only this original workspace and origin.');
   let intent=record.restarts[request.phaseKey];
   if(intent){
    assert(intent.workspaceId===request.workspaceId&&intent.origin===request.baseURL,'The retained restart identity changed.');
    if(intent.state==='REOPENED'||intent.requestedIn!==epoch){
     assert(service?.app.schema().workspaceId===record.workspaceId&&service.origin===record.origin,'The original restart must already have a current native listener.');
     intent.state='REOPENED';intent.reconciledAt=new Date().toISOString();intent.reconciledIn=epoch;persist();return{workspaceUrl:service.url,page:request.page};
    }
   }else{
    intent={phaseKey:request.phaseKey,workspaceId:request.workspaceId,origin:request.baseURL,state:'REQUESTED',requestedIn:epoch,requestedAt:new Date().toISOString()};record.restarts[request.phaseKey]=intent;persist();
   }
   await closeService();intent.state='CLOSED';intent.closedAt=new Date().toISOString();persist();
   await openService();intent.state='REOPENED';intent.reopenedAt=new Date().toISOString();persist();return{workspaceUrl:service.url,page:request.page};
  }
  progress('Original console and persistent browser are open',{workspaceId:record.workspaceId,origin:record.origin,hostRecordPath:recordPath});
  result=await runCoopsOperatorJourney(page,{workspaceUrl:service.url,outputDirectory:selected.output,operator,mappingFile,...configuration.value,continuationNote:input.continuationNote,operationTimeoutMs:input.operationTimeoutMs,captureTimeoutMs:input.captureTimeoutMs,reviewEdition:packet=>independentReview(packet,'source'),reviewStudy:configuration.value.study?packet=>independentReview(packet,'study'):undefined,restart,onProgress:async event=>{if(aborted)throw aborted;progress(event.message,{phase:event.phase??null,journeyOperationId:event.operationId});}});
  assert(result.status==='PASS'&&result.workspaceId===record.workspaceId,'The original receiving function must return its complete same-workspace result.');
  record.result=await identity(result.resultPath);record.state='RESULT_RETAINED';record.completedAt=new Date().toISOString();persist();
 }catch(error){
  problem=error;record.state='INCOMPLETE';record.error={message:safe(error),at:new Date().toISOString()};
  if(owned)try{persist();}catch(writeError){progress('The original runtime could not retain its final host update',{error:safe(writeError)});}
 }finally{
  const errors=[];try{await closeBrowser();}catch(error){errors.push({component:'browser',message:safe(error)});}
  try{await closeService();}catch(error){errors.push({component:'workspace',message:safe(error)});}
  record.closure={at:new Date().toISOString(),browserClosed:!errors.some(e=>e.component==='browser'),workspaceClosed:!errors.some(e=>e.component==='workspace'),errors};
  const run=record.runs.find(r=>r.id===epoch);if(run)run.closedAt=record.closure.at;
  if(!problem&&!errors.length&&result)record.state='COMPLETE';
  if(errors.length&&!problem)problem=new Error('The receiving result is retained, but normal runtime closure needs reconciliation.');
  if(owned)try{persist();}catch(error){problem??=error;}
  if(owned)try{if(fs.existsSync(startupPath)&&json(startupPath).hostRunId===epoch)fs.unlinkSync(startupPath);}catch(error){problem??=error;}
  process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);
 }
 if(problem)throw problem;
 return{...result,hostRecordPath:recordPath,runtimeClosure:record.closure};
}
export async function main(args=process.argv.slice(2)){
 if(args.includes('--help')){
  console.log('node coops/receiving-host.mjs --workspace PRIVATE_DIR --output OPERATOR_DIR --browser-profile PRIVATE_PROFILE --playwright-module ORIGINAL_MODULE_FILE --chrome ORIGINAL_CHROME [--operation-id ORIGINAL_ID] [--port 0] [--selection ORIGINAL_SELECTION_JSON] [--mapping-file ORIGINAL_MAPPING_JSON] [--review-response ACTUAL_SOURCE_REVIEW_JSON] [--study-review-response ACTUAL_STUDY_REVIEW_JSON] [--operator TEAM] [--continuation-note REASON]');return;
 }
 const fields={'--workspace':'workspace','--output':'output','--browser-profile':'browserProfile','--playwright-module':'playwrightModule','--chrome':'chrome','--operation-id':'operationId','--port':'port','--selection':'selectionFile','--mapping-file':'mappingFile','--review-response':'reviewResponse','--study-review-response':'studyReviewResponse','--operator':'operator','--continuation-note':'continuationNote','--review-timeout-ms':'reviewTimeoutMs','--operation-timeout-ms':'operationTimeoutMs','--capture-timeout-ms':'captureTimeoutMs','--user-agent':'userAgent'},options={};
 for(let i=0;i<args.length;i+=2){const key=fields[args[i]];assert(key&&!Object.hasOwn(options,key)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'Use paired documented arguments; see --help.');options[key]=args[i+1];}
 const result=await runCoopsReceivingHost(options);console.log(JSON.stringify({schema:'stellar-forge.coops-receiving-host-result.v1',status:result.status,operationId:result.operationId,workspaceId:result.workspaceId,resultPath:result.resultPath,hostRecordPath:result.hostRecordPath,runtimeClosure:result.runtimeClosure}));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({schema:'stellar-forge.coops-receiving-host-error.v1',message:safe(error)}));process.exitCode=1;});
