#!/usr/bin/env node
// MIT. Whole ClinicalTrials source receiving in the maintained Research dossiers Store.
import {open,realpath,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {openDossierStore} from './dossier.mjs';
import {openClinicalTrialsWorkspace} from './clinical-trials-workspace.mjs';
import {need,sha,object} from './clinical-trials-model.mjs';
const HELP=[
 'Research trial registry receiving',
 '',
 'workspace --dir DIR [--port 8846] [--python python3]',
 'import --dir DIR --file ORIGINAL_CLINICALTRIALS_WORKSPACE.zip --sha256 HEX',
 'inputs --dir DIR',
 'prepare --dir DIR --dossier ID --question ID --revision N --source ctsrc_HEX --capture capture-UUID --request-id UUID [--label TITLE] [--allow-partial]',
 'stage --dir DIR --operation ct_HEX --plan-sha256 HEX',
 'review --dir DIR --operation ct_HEX [--offset N] [--limit 50]',
 'receive --dir DIR --operation ct_HEX --plan-sha256 HEX --edition-sha256 HEX --revision N',
 'retained --dir DIR --dossier ID',
 'retained-review --dir DIR --dossier ID --edition ID [--offset N] [--limit 50]',
 'record --dir DIR --operation ct_HEX --index N',
 'retained-record --dir DIR --dossier ID --edition ID --index N',
 'compare --dir DIR --operation ct_HEX --before ct_HEX',
 'compare-retained --dir DIR --dossier ID --before EDITION_ID --after EDITION_ID',
 'analysis --dir DIR --operation ct_HEX [--criteria JSON] [--offset N] [--limit 50]',
 'retained-analysis --dir DIR --dossier ID --edition ID [--criteria JSON] [--offset N] [--limit 50]',
 'export-analysis --dir DIR --operation ct_HEX --format csv|json|html|md --output FILE [--criteria JSON]',
 'export-retained-analysis --dir DIR --dossier ID --edition ID --format csv|json|html|md --output FILE [--criteria JSON]',
 'download --dir DIR --operation ct_HEX --output FILE',
 'download-packet --dir DIR --dossier ID --edition ID --output FILE.zip',
 'export-dossier --dir DIR --dossier ID --format json.gz|json|md|html --output FILE',
 'reopen --dir DIR --file PORTABLE_DOSSIER.json.gz',
 '',
 'Acquire or resume registry source, prepare native projections, PRS and merchant releases through the original clinicaltrials command.',
 'No registry request or payment runs through this Research receiving command.',
 ''].join('\n');
const flags={
 workspace:['dir','port','python'],import:['dir','python','file','sha256'],inputs:['dir','python','after','limit'],
 prepare:['dir','python','dossier','question','revision','source','capture','request-id','label','allow-partial'],
 stage:['dir','python','operation','plan-sha256'],review:['dir','python','operation','offset','limit'],
 receive:['dir','python','operation','plan-sha256','edition-sha256','revision'],
 retained:['dir','python','dossier'],'retained-review':['dir','python','dossier','edition','offset','limit'],
 record:['dir','python','operation','index'],'retained-record':['dir','python','dossier','edition','index'],
 compare:['dir','python','operation','before'],'compare-retained':['dir','python','dossier','before','after'],
 analysis:['dir','python','operation','criteria','offset','limit'],'retained-analysis':['dir','python','dossier','edition','criteria','offset','limit'],
 'export-analysis':['dir','python','operation','criteria','format','output'],'export-retained-analysis':['dir','python','dossier','edition','criteria','format','output'],
 download:['dir','python','operation','output'],'download-packet':['dir','python','dossier','edition','output'],
 'export-dossier':['dir','python','dossier','format','output'],reopen:['dir','python','file']
};
function args(argv){
 const command=argv[0];if(!command||['help','--help','-h'].includes(command))return {command:'help',options:{}};
 need(Object.hasOwn(flags,command),'CLINICALTRIALS_COMMAND_INVALID');
 const options={};for(let at=1;at<argv.length;at++){
  const key=argv[at];need(key.startsWith('--')&&flags[command].includes(key.slice(2))&&!Object.hasOwn(options,key.slice(2)),
   'CLINICALTRIALS_OPTION_INVALID');const name=key.slice(2);
  if(name==='allow-partial')options[name]=true;
  else{need(typeof argv[at+1]==='string'&&!argv[at+1].startsWith('--'),'CLINICALTRIALS_OPTION_VALUE_REQUIRED');options[name]=argv[++at];}
 }
 return {command,options};
}
function required(options,key){need(typeof options[key]==='string'&&options[key].length>0,'CLINICALTRIALS_OPTION_REQUIRED');return options[key];}
function absolute(options,key){const path=required(options,key);need(path===resolve(path),'CLINICALTRIALS_ABSOLUTE_PATH_REQUIRED');return path;}
function integer(options,key,fallback){if(options[key]===undefined&&fallback!==undefined)return fallback;
 const value=required(options,key);need(/^[0-9]+$/.test(value)&&Number.isSafeInteger(Number(value)),'CLINICALTRIALS_INTEGER_INVALID');return Number(value);}
function criteria(options){
 const raw=options.criteria??'{}';need(raw.length<=16384,'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 let value;try{value=JSON.parse(raw);}catch{need(false,'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');}
 need(object(value),'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');return value;
}
async function saveFile(path,bytes){
 const handle=await open(path,'wx',0o600);let complete=false;
 try{await handle.writeFile(bytes);await handle.sync();complete=true;}finally{await handle.close();if(!complete)await unlink(path).catch(()=>{});}
 return {path,bytes:bytes.length,sha256:sha(bytes)};
}
export async function runClinicalTrialsResearch(argv=process.argv.slice(2)){
 const {command,options:o}=args(argv);if(command==='help'){process.stdout.write(HELP);return;}
 const directory=absolute(o,'dir');
 if(command==='workspace'){
  const {startDossierWorkspace}=await import('./server.mjs');
  const app=await startDossierWorkspace({directory,port:integer(o,'port',8846),clinicalTrialsPython:o.python??'python3'});
  process.stdout.write(JSON.stringify({status:'RESEARCH_WORKSPACE_READY',url:app.url})+'\n');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);return app;
 }
 const dossiers=await openDossierStore(directory),clinical=await openClinicalTrialsWorkspace({directory:join(directory,'clinical-trials'),
  dossiers,python:o.python??'python3'});let active=null,interrupted=false;
 const stop=()=>{interrupted=true;if(active)clinical.stop(active).catch(()=>{});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  let result;const page=()=>({offset:integer(o,'offset',0),limit:integer(o,'limit',50)});
  if(command==='import')result=await clinical.importFile(absolute(o,'file'),{expectedSha256:required(o,'sha256')});
  else if(command==='inputs')result=await clinical.inputs({after:o.after??'',limit:integer(o,'limit',30)});
  else if(command==='prepare')result=await clinical.prepare(required(o,'dossier'),{
   questionId:required(o,'question'),expectedRevision:integer(o,'revision'),sourceId:required(o,'source'),
   captureId:required(o,'capture'),requestId:required(o,'request-id'),label:o.label??'ClinicalTrials.gov retained cohort',
   allowPartial:o['allow-partial']??false});
  else if(command==='stage'){
   active=required(o,'operation');await clinical.start(active,{expectedPlanSha256:required(o,'plan-sha256')});
   if(interrupted)await clinical.stop(active);result=await clinical.wait(active);
  }else if(command==='review')result=await clinical.review(required(o,'operation'),page());
  else if(command==='receive'){
   const received=await clinical.receive(required(o,'operation'),{expectedPlanSha256:required(o,'plan-sha256'),
    expectedEditionSha256:required(o,'edition-sha256'),expectedRevision:integer(o,'revision')});
   result={operation:received.operation,receipt:received.receipt,dossierId:received.dossier.id,revision:received.dossier.revision};
  }else if(command==='retained')result=await clinical.retainedList(required(o,'dossier'));
  else if(command==='retained-review')result=await clinical.retainedReview(required(o,'dossier'),required(o,'edition'),page());
  else if(command==='record')result=await clinical.record(required(o,'operation'),integer(o,'index'));
  else if(command==='retained-record')result=await clinical.retainedRecord(required(o,'dossier'),required(o,'edition'),integer(o,'index'));
  else if(command==='compare')result=await clinical.compare(required(o,'operation'),required(o,'before'));
  else if(command==='compare-retained')result=await clinical.compareRetained(required(o,'dossier'),required(o,'before'),required(o,'after'));
  else if(command==='analysis')result=await clinical.analysis(required(o,'operation'),{criteria:criteria(o),...page()});
  else if(command==='retained-analysis')result=await clinical.retainedAnalysis(required(o,'dossier'),required(o,'edition'),{criteria:criteria(o),...page()});
  else if(command==='export-analysis'||command==='export-retained-analysis'){
   const options={criteria:criteria(o),format:required(o,'format')};
   const saved=command==='export-analysis'?await clinical.exportAnalysis(required(o,'operation'),options):
    await clinical.exportRetainedAnalysis(required(o,'dossier'),required(o,'edition'),options);
   result={...await saveFile(absolute(o,'output'),saved.bytes),editionSha256:saved.editionSha256,contentType:saved.contentType};
  }
  else if(command==='download')result=await saveFile(absolute(o,'output'),(await clinical.edition(required(o,'operation'))).bytes);
  else if(command==='download-packet')result=await saveFile(absolute(o,'output'),(await clinical.retainedPacket(required(o,'dossier'),required(o,'edition'))).bytes);
  else if(command==='export-dossier'){
   const format=o.format??'json.gz',output=absolute(o,'output');
   if(['json','json.gz'].includes(format)){
    const saved=await dossiers.exportStream(required(o,'dossier'),{compression:format==='json.gz'?'gzip':'none'});
    const file=await open(output,'wx',0o600);let complete=false;
    try{await pipeline(saved.body,file.createWriteStream({autoClose:false}));await file.sync();complete=true;
     const stat=await file.stat();result={path:output,bytes:stat.size,contentType:saved.contentType};
    }finally{await file.close();if(!complete)await unlink(output).catch(()=>{});}
   }else{need(['md','html'].includes(format),'EXPORT_FORMAT_INVALID');const saved=await dossiers.exportDossier(required(o,'dossier'),{format});
    result=await saveFile(output,Buffer.from(saved.content??saved.body??''));}
  }else if(command==='reopen'){
   const file=await open(absolute(o,'file'),'r');try{const received=await dossiers.reopenStream(file.createReadStream({autoClose:false}),{projection:'metadata'});
    result={dossierId:received.id,revision:received.revision};}finally{await file.close();}
  }
  process.stdout.write(JSON.stringify(result)+'\n');return result;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await clinical.close();}
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
 runClinicalTrialsResearch().catch(error=>{const code=/^[A-Z][A-Z0-9_]+$/.test(error?.code??'')?error.code:'CLINICALTRIALS_COMMAND_FAILED';
  process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;});
}
