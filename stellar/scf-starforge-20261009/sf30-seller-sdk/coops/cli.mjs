// MIT. Coastal actions use the same native writer as the staff console.
import {constants} from 'node:fs';
import {readFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openCoopsWorkspace} from './core.mjs';
import {readReleaseRuntime} from './workspace.mjs';
const json=async p=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(resolve(p))));
const HELP=[
 'node coops/cli.mjs --workspace PRIVATE_DIR COMMAND [options]',
 'node coops/cli.mjs --session PRIVATE_STARTUP_JSON COMMAND [options]',
 '',
 'schema | view | stations',
 'action --request ORIGINAL_ACTION_JSON',
 'analyse --operation-id ORIGINAL_ID --request COASTAL_ANALYSIS_SELECTION_JSON',
 'collect | backfill --profile-id ID --operation-id ID --begin YYYY-MM-DD --end YYYY-MM-DD --products water_level[,predictions] --units metric|english --time-zone gmt|lst|lst_ldt --datum MLLW [--prediction-interval 6|h|hilo] [--label NAME]',
 'import-source --profile-id ID --operation-id ID --file ORIGINAL_SOURCE_PACKAGE',
 'rows --edition-id ID --table observations|predictions|metadata|coverage [--offset 0] [--limit 100] [--begin YYYY-MM-DD] [--end YYYY-MM-DD]',
 'study-preview --file STUDY_SELECTION_JSON',
 'study-dataset --study-release-id ORIGINAL_RELEASE --name DATASET_NAME --operation-id ORIGINAL_ID',
 'study-rows --study-id ID --study-revision N [--offset 0] [--limit 100]',
 'study-return --study-release-id ID --format csv|jsonl --file ORIGINAL_RETURN --operation-id ORIGINAL_PREFIX [--note ACTUAL_SOURCE_NOTE]',
 'inspect-mapping --file ORIGINAL_MAPPING_JSON',
 'mapping-source --mapping-id ID --mapping-revision N --output NEW_FILE',
 'source --edition-id ID --page INDEX --output NEW_FILE',
 'capture-source --capture-id ID --page INDEX --output NEW_FILE',
 'download --export-id ID --output NEW_FILE',
 'receive-file --receipt-id ID --name NAME --output NEW_FILE',
 '',
 'Analysis selection: observationsEditionId, predictionsEditionId, optional options and analyst objects.',
 'Analyse retains the complete offline HTML, editable workbook, every analysis/source file and manifest.',
 'Its original request is reusable. Download any returned files[].id with the existing download command.',
 'Private runtime: --inbox ORIGINAL_PRIVATE_INBOX --release-runtime PRIVATE_JSON --user-agent IDENTIFIER.',
 'A running console owns the original workspace. Use its startup JSON with --session.',
 'Collect/import/backfill wait for the original capture or backfill; a stopped source remains explicitly partial.',
 'Every write needs its original operationId. The native journal reconciles exact replay before revision checks.',
 'study-dataset uses the exact complete released CSV, recorded review and source provenance; native capacity is 250000 rows / 256 MiB. Narrower data requires a separately reviewed release.',
 'dataset.prepare action payload may include mappingId; its exact saved revision and original file stay with native query/release provenance.',
 'Download files are created exclusively and streamed; an existing or partial selected path is preserved.'
].join('\n');
function argumentsOf(args){
 const values={};let command;
 for(let i=0;i<args.length;i++){
  const a=args[i];if(a==='--help')return{help:true};
  if(a.startsWith('--')){if(values[a]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new TypeError('Use paired unique options.');values[a]=args[++i];}
  else if(command)throw new TypeError('Choose one command.');else command=a;
 }
 const fields=['--workspace','--session','--inbox','--release-runtime','--user-agent','--request','--profile-id','--capture-id','--operation-id','--begin','--end','--products','--units','--time-zone','--datum','--prediction-interval','--label','--file','--edition-id','--table','--offset','--limit','--page','--output','--export-id','--receipt-id','--name','--mapping-id','--mapping-revision','--study-id','--study-revision','--study-release-id','--format','--note'];
 if(Object.keys(values).some(k=>!fields.includes(k)))throw new TypeError('An option is not supported; see --help.');
 if(Boolean(values['--workspace'])===Boolean(values['--session']))throw new TypeError('Choose one private workspace or original session file.');
 return{values,command};
}
async function sessionClient(filename){
 const file=await json(filename);if(file.schema!=='stellar-forge.coops-workspace-startup.v1'||file.status!=='COOPS_READY')throw new TypeError('Choose an original coastal startup descriptor.');
 const session=new URL(file.url),token=session.hash.slice(1);
 if(session.protocol!=='http:'||session.hostname!=='127.0.0.1'||!/^[-_A-Za-z0-9]{43}$/.test(token)||session.pathname!=='/'||session.search||session.username||session.password)throw new TypeError('The private coastal session URL is invalid.');
 async function request(path,options={}){
  const r=await fetch(session.origin+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!r.ok){let detail;try{detail=await r.json();}catch{}throw Object.assign(new Error(detail?.message??'Workspace HTTP '+r.status),detail??{},{status:r.status});}return r;
 }
 const query=(path,v)=>path+'?'+new URLSearchParams(Object.entries(v).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
 const original=async path=>{const response=await request(path);return{stream:()=>response.body};};
 return{schema:async()=>(await request('/api/schema')).json(),view:async()=>(await request('/api/view')).json(),
  operation:async id=>(await request(query('/api/operation',{operationId:id}))).json(),
  studyPreview:async value=>(await request('/api/study-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json(),
  studyRows:async(id,revision,options)=>(await request(query('/api/study-rows',{studyId:id,revision,...options}))).json(),
  action:async value=>(await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json(),
  rows:async(id,o)=>(await request(query('/api/rows',{editionId:id,...o}))).json(),
  inspectMappingFile:async value=>(await request('/api/mapping-file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json(),
  mappingRaw:async(id,revision)=>original(query('/api/mapping-source',{mappingId:id,revision})),
  raw:async(id,page)=>original(query('/api/raw',{editionId:id,page})),
  captureRaw:async(id,page)=>original(query('/api/capture-source',{captureId:id,page})),
  exported:async id=>original('/api/exports/'+encodeURIComponent(id)),
  received:async(id,name)=>original('/api/receipts/'+encodeURIComponent(id)+'/'+encodeURIComponent(name)),
  close:async()=>{},remote:true};
}
async function writeOutput(filename,selected){
 if(!filename)throw new TypeError('--output is required for a file download.');
 const path=resolve(filename),file=await open(path,'wx',0o600),digest=createHash('sha256');let bytes=0;
 try{const source=selected.stream?selected.stream():[selected.bytes];for await(const part of source){const chunk=Buffer.from(part);bytes+=chunk.length;digest.update(chunk);let offset=0;while(offset<chunk.length){const r=await file.write(chunk,offset,chunk.length-offset);if(!r.bytesWritten)throw new Error('The output writer stopped.');offset+=r.bytesWritten;}}await file.sync();}
 finally{await file.close();}
 return{file:path,bytes,sha256:digest.digest('hex')};
}
async function waitOriginal(app,result){
 const id=result.result?.backfillId??result.result?.captureId;if(!id)return result;
 if(!app.remote)await app.waitForCaptures();
 for(;;){
  const view=await app.view(),item=(result.result?.backfillId?view.backfills:view.captures).find(x=>x.id===id);
  if(!item)throw new TypeError('The original selected source operation is missing.');
  if(!['QUEUED','RUNNING'].includes(item.state)){result.sourceOperation=item;return result;}
  await new Promise(done=>setTimeout(done,750));
 }
}

async function studyAction(app,action,payload,operationId){
 let response=await app.action({action,payload,operationId,expectedRevision:(await app.view()).revision});
 if(response.state!=='RUNNING')return response;
 for(;;){const operation=await app.operation(operationId);
  if(operation.state==='COMPLETE')return{operationId,reused:true,result:operation.result,view:await app.view()};
  if(operation.state==='FAILED')throw Object.assign(new Error(operation.error?.message??'The original study operation did not complete.'),operation.error,{operationId});
  await new Promise(resolve=>setTimeout(resolve,750));
 }
}
async function returnStudyFile(app,v){
 const prefix=v['--operation-id'],filename=v['--file'],releaseId=v['--study-release-id'],format=v['--format'];
 if(!/^[A-Za-z0-9_-]{8,64}$/.test(prefix??'')||!filename||!releaseId||!['csv','jsonl'].includes(format))throw new TypeError('Use --operation-id (8–64 original characters), --study-release-id, --format csv|jsonl and --file.');
 const path=resolve(filename),file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),before=await file.stat({bigint:true});
 const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
 try{
  if(!before.isFile()||before.size>1073741824n)throw new TypeError('Select one regular returned file up to 1 GiB.');
  const started=await studyAction(app,'study.return.start',{releaseId,filename:basename(path),format,bytes:Number(before.size),note:v['--note']??''},prefix+'-start');
  let upload=started.result;
  if(upload.state==='COMPLETE')return{reused:true,result:(await app.view()).studyReturns.find(r=>r.id===upload.returnId)};
  upload=(await app.view()).studyUploads.find(u=>u.id===upload.id);
  if(!upload)throw new TypeError('The original returned-file intake is unavailable.');
  if(upload.state==='COMPLETE')return{reused:true,result:(await app.view()).studyReturns.find(r=>r.id===upload.returnId)};
  if(upload.state==='COMPARING'){
   const op=await app.operation(upload.finishingOperationId);
   if(!op.resumeRequest||op.resumeRequest.payload.uploadId!==upload.id)throw new TypeError('The original comparison request is unavailable; preserve this intake.');
   return studyAction(app,'study.return.finish',op.resumeRequest.payload,op.operationId);
  }
  const digest=createHash('sha256');let offset=0;
  while(offset<Number(before.size)){
   const buffer=Buffer.alloc(Math.min(1048576,Number(before.size)-offset));let count=0;
   while(count<buffer.length){const r=await file.read(buffer,count,buffer.length-count,offset+count);if(!r.bytesRead)throw new TypeError('The selected original file became shorter. Preserve its retained chunks.');count+=r.bytesRead;}
   digest.update(buffer);const hash=createHash('sha256').update(buffer).digest('hex'),existing=upload.chunks.find(c=>c.offset===offset);
   if(existing){if(existing.bytes!==buffer.length||existing.sha256!==hash)throw new TypeError('The reselected file differs from its retained prefix. Start a separate intake for changed bytes.');}
   else{
    await studyAction(app,'study.return.chunk',{uploadId:upload.id,offset,base64:buffer.toString('base64')},prefix+'-chunk-'+Math.floor(offset/1048576));
    upload=(await app.view()).studyUploads.find(u=>u.id===upload.id);
   }
   offset+=buffer.length;
  }
  if(stamp(before)!==stamp(await file.stat({bigint:true})))throw new TypeError('The original file changed during intake. Its chunks remain unsealed for inspection.');
  const result=await studyAction(app,'study.return.finish',{uploadId:upload.id},prefix+'-finish');
  if(result.result.original.sha256!==digest.digest('hex')||result.result.original.bytes!==Number(before.size))throw new TypeError('The retained returned bytes differ from the selected complete file.');
  return result;
 }finally{await file.close();}
}

export async function main(args=process.argv.slice(2)){
 const parsed=argumentsOf(args);if(parsed.help){console.log(HELP);return;}
 const {values:v,command}=parsed;
 if(!['schema','view','stations','action','analyse','collect','backfill','import-source','rows','source','capture-source','download','receive-file','inspect-mapping','mapping-source','study-preview','study-rows','study-return','study-dataset'].includes(command))throw new TypeError('Choose a listed command; see --help.');
 const app=v['--session']?await sessionClient(v['--session']):await openCoopsWorkspace({directory:resolve(v['--workspace']),inboxDirectory:v['--inbox']?resolve(v['--inbox']):undefined,userAgent:v['--user-agent'],releaseRuntime:v['--release-runtime']?await readReleaseRuntime(v['--release-runtime']):undefined});
 try{
  let result;
  if(command==='schema')result=await app.schema();
  else if(command==='view')result=await app.view();
  else if(command==='stations')result=(await app.view()).stations;
  else if(command==='study-preview'){if(!v['--file'])throw new TypeError('--file is required.');result=await app.studyPreview(await json(v['--file']));}
  else if(command==='study-rows'){const revision=Number(v['--study-revision']);if(!v['--study-id']||!Number.isSafeInteger(revision)||revision<1)throw new TypeError('Choose the exact study ID and revision.');result=await app.studyRows(v['--study-id'],revision,{offset:Number(v['--offset']??0),limit:Number(v['--limit']??100)});}
  else if(command==='study-return')result=await returnStudyFile(app,v);
  else if(command==='study-dataset'){
   if(!v['--study-release-id']||!v['--name']||!v['--operation-id'])throw new TypeError('Choose an original reviewed study release, dataset name and stable operation ID.');
   const current=await app.view();
   result=await app.action({action:'study.dataset.prepare',payload:{releaseId:v['--study-release-id'],name:v['--name']},operationId:v['--operation-id'],expectedRevision:current.revision});
  }
  else if(command==='inspect-mapping'){if(!v['--file'])throw new TypeError('--file is required.');const file=await open(resolve(v['--file']),'r');let bytes;try{const info=await file.stat();if(!info.isFile()||info.size>65536)throw new TypeError('Select an original mapping JSON file up to 64 KiB.');bytes=await file.readFile();}finally{await file.close();}result=await app.inspectMappingFile({filename:basename(v['--file']),base64:bytes.toString('base64')});}
  else if(command==='action'){
   if(!v['--request'])throw new TypeError('--request is required.');const request=await json(v['--request']);
   if(request.action==='release.start'&&!app.remote)throw new TypeError('Start a retained publisher through --session so its original process remains alive.');
   result=await app.action(request);if(['capture.start','capture.resume','capture.import','backfill.start','backfill.resume'].includes(request.action))result=await waitOriginal(app,result);
  }else if(command==='analyse'){
   if(!v['--request']||!v['--operation-id'])throw new TypeError('--request and the original --operation-id are required.');
   const payload=await json(v['--request']),current=await app.view();
   result=await app.action({action:'analysis.export',payload,operationId:v['--operation-id'],expectedRevision:current.revision});
  }else if(['collect','backfill','import-source'].includes(command)){
   if(!v['--profile-id']||!v['--operation-id'])throw new TypeError('--profile-id and a stable --operation-id are required.');
   const current=await app.view(),payload={profileId:v['--profile-id']};
   if(v['--label'])payload.label=v['--label'];
   if(command==='import-source'){if(!v['--file'])throw new TypeError('--file is required.');payload.bundle=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(resolve(v['--file'])));}
   else{
    for(const key of ['--begin','--end','--products','--units','--time-zone','--datum'])if(!v[key])throw new TypeError(key+' is required for an explicit original source query.');
    Object.assign(payload,{beginDate:v['--begin'],endDate:v['--end'],products:v['--products'].split(','),units:v['--units'],timeZone:v['--time-zone'],datum:v['--datum'],predictionInterval:v['--prediction-interval']??'6'});
   }
   result=await waitOriginal(app,await app.action({action:command==='collect'?'capture.start':command==='backfill'?'backfill.start':'capture.import',payload,operationId:v['--operation-id'],expectedRevision:current.revision}));
  }else if(command==='rows')result=await app.rows(v['--edition-id'],{table:v['--table']??'observations',offset:Number(v['--offset']??0),limit:Number(v['--limit']??100),beginDate:v['--begin'],endDate:v['--end']});
  else if(command==='source')result=await writeOutput(v['--output'],await app.raw(v['--edition-id'],Number(v['--page'])));
  else if(command==='mapping-source'){const revision=Number(v['--mapping-revision']);if(!v['--mapping-id']||!Number.isSafeInteger(revision)||revision<1)throw new TypeError('Select the original mapping ID and exact positive revision.');result=await writeOutput(v['--output'],await app.mappingRaw(v['--mapping-id'],revision));}
  else if(command==='capture-source')result=await writeOutput(v['--output'],await app.captureRaw(v['--capture-id'],Number(v['--page'])));
  else if(command==='download')result=await writeOutput(v['--output'],await app.exported(v['--export-id']));
  else result=await writeOutput(v['--output'],await app.received(v['--receipt-id'],v['--name']));
  console.log(JSON.stringify(result,null,2));return result;
 }finally{await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:error.code??'COOPS_CLI_ERROR',message:error.message,operationId:error.operationId??null},null,2));process.exitCode=1;});
