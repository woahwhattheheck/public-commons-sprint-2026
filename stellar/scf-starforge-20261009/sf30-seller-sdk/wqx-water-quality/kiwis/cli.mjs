#!/usr/bin/env node
// MIT. Complete original KiWIS commissioning through the Water Quality project.
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {mkdir,lstat} from 'node:fs/promises';
import {readBytes,writeBytes} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {openWaterQualityProject} from '../project.mjs';
import {digest,canonical,importKiWISResponses} from './source.mjs';
import {COMMISSIONING_FORMATS} from './formats.mjs';
import {acquireCommissioningSource,importCommissioningCapture,readCommissioningCapture,saveCommissioningSource,readCommissioningSource,
  previewCommissioningReview,saveCommissioningReview,readCommissioningReview,listCommissioning,
  compareCommissioningEditions,exportCommissioningReview,receiveCommissioningReview} from './workflow.mjs';

const LIMIT=256*1024*1024;
const HELP=[
  'Stellar Forge / KiWIS commissioning','',
  'water-quality-kiwis COMMAND --project DIRECTORY [options]','',
  'acquire  --capture ID --selection FILE --out FILE: acquire the complete selected programme.',
  'capture  --capture ID --out FILE: reopen every original response of a retained capture.',
  'import   --capture ID --packet FILE --out FILE: retain original response files and exact request receipts.',
  'source   --source ID (--capture ID | --capture-file FILE) --kind KIND --counterpart FILE.',
  'preview  --source ID --decisions FILE --out FILE: review every candidate and original record.',
  'save     --source ID --review ID --title TITLE --decisions FILE --preview FILE.',
  'list     List complete original source pairs and saved review editions.',
  'read     --review ID: reopen and reproduce an original saved review.',
  'compare  (--review ID | --source ID) --previous-review ID --out FILE: compare saved reviews or source editions.',
  'export   --review ID --format FORMAT --out FILE: download a selected complete deliverable.',
  'receive  --bundle FILE: reopen a complete project in another private Water Quality project.','',
  'KIND: wqx-review, wqx-scientific, lab-edd-result, kiwis-wqm.',
  'FORMAT: '+COMMISSIONING_FORMATS.join(', ')+'.',
  'Selection JSON: endpoint, datasource, timezone, series:[{tsId,from,to,chunkSeconds?}].',
  'Select source dates with UTC offsets. Optional chunkSeconds covers the entire requested window.',
  'Every raw response and shared partition boundary row remains in the complete source edition.',
  'Retained packet JSON: selection and full responses, including original ZIP bytes and request provenance.',
  'source --capture-file also accepts that retained packet. KiWIS WQM counterpart is its exact response packet.',
  'Decision JSON records exact field mappings, UTC interpretations, quality use and correspondence reasons.',
  'Original observations remain exact strings. Saving a review does not modify either provider source.',
  'Changed mappings keep earlier choices visible as REVIEW_REQUIRED.',
  'Capture interruptions retain completed requests. Resume the same capture ID with the same selection.',
  'Changed sources or decisions use a new edition name. Existing output files are preserved.',
  'Outputs publish only after completion. The same command can reopen an exactly matching complete output.',
  'Errors stay on stderr; resume retained work with the same names after interruption.',''
].join('\n');
const names=['project','capture','selection','source','capture-file','kind','counterpart','decisions','preview','review','title','previous-review','format','bundle','packet','out'];
const options=Object.fromEntries(names.map(name=>[name,{type:'string'}]));
const need=(values,name)=>{if(!values[name])throw Error('Provide --'+name+'.');return values[name];};
async function readJson(path){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(path),LIMIT)));}
function outputError(message){return Object.assign(Error(message),{code:'KIWIS_OUTPUT_CHANGED'});}
async function inspectOutput(path){
  let stat;try{stat=await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
    process.platform!=='win32'&&((stat.mode&0o077)!==0||process.getuid&&stat.uid!==process.getuid()))
    throw outputError('The selected output must be one private original regular file.');
  return stat;
}
async function selectOutput(path){
  if(!path)return null;path=resolve(path);await mkdir(dirname(path),{recursive:true,mode:0o700});
  await inspectOutput(path);return path;
}
async function reopenOutput(path,bytes){
  const before=await inspectOutput(path);
  if(!before)return false;
  if(before.size!==bytes.length)throw outputError('This output already contains different work. Select a new output name.');
  const retained=await readBytes(path,bytes.length),after=await inspectOutput(path);
  if(!after||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||
    after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||!retained.equals(bytes))
    throw outputError('This output differs from the complete original result. The existing file is preserved.');
  return true;
}
async function publish(value,path){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(!path){process.stdout.write(bytes);return;}
  let reopened=await reopenOutput(path,bytes);
  if(!reopened){
    // The original SF88 writer holds a private temporary inode, fsyncs the full
    // body, then publishes exclusively. Interrupted work never occupies --out.
    try{await writeBytes(path,bytes,{exclusive:true});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      reopened=await reopenOutput(path,bytes);if(!reopened)throw error;
    }
  }
  process.stdout.write(JSON.stringify({output:path,bytes:bytes.length,sha256:digest(bytes),reopened})+'\n');
}
export async function main(argv=process.argv.slice(2)){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{...options,help:{type:'boolean'}}});
  const command=positionals[0]??'help';
  if(values.help||command==='help'){process.stdout.write(HELP);return;}
  if(positionals.length!==1||!['acquire','capture','import','source','preview','save','list','read','compare','export','receive'].includes(command))
    throw Error('Choose one commissioning command. Run water-quality-kiwis help.');
  if(['acquire','capture','import','preview','compare','export'].includes(command))need(values,'out');
  const output=await selectOutput(values.out),controller=new AbortController();
  const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  let project;
  try{
    project=await openWaterQualityProject(resolve(need(values,'project')));let result;
    if(command==='acquire')result=await acquireCommissioningSource({project,sourceId:need(values,'capture'),
      selection:await readJson(need(values,'selection')),signal:controller.signal,
      onProgress:progress=>process.stderr.write(JSON.stringify({capture:values.capture,...progress})+'\n')});
    else if(command==='capture')result=await readCommissioningCapture({project,sourceId:need(values,'capture')});
    else if(command==='import')result=await importCommissioningCapture({project,sourceId:need(values,'capture'),packet:await readJson(need(values,'packet'))});
    else if(command==='source'){
      if(Boolean(values.capture)===Boolean(values['capture-file']))throw Error('Select one --capture or --capture-file.');
      const kind=need(values,'kind'),file=need(values,'counterpart');
      let counterpart;
      if(kind==='lab-edd-result'){const bytes=await readBytes(resolve(file),LIMIT);counterpart={kind,bytes:bytes.length,sha256:digest(bytes),base64:bytes.toString('base64')};}
      else if(kind==='kiwis-wqm')counterpart={kind,response:await readJson(file)};
      else counterpart={kind,bundle:await readJson(file)};
      let capture=values.capture?await readCommissioningCapture({project,sourceId:values.capture}):await readJson(values['capture-file']);
      if(!capture.schema&&capture.selection&&Array.isArray(capture.responses))capture=importKiWISResponses(capture);
      result=await saveCommissioningSource({project,sourceId:need(values,'source'),counterpart,capture});
    }else if(command==='preview')result=await previewCommissioningReview({project,sourceId:need(values,'source'),document:await readJson(need(values,'decisions'))});
    else if(command==='save'){
      const preview=await readJson(need(values,'preview')),document=await readJson(need(values,'decisions'));
      const {reviewSha256,...body}=preview;
      if(digest(canonical(body))!==reviewSha256||canonical(preview.document)!==canonical(document))throw Error('Save the complete original preview and its unchanged decisions.');
      result=await saveCommissioningReview({project,sourceId:need(values,'source'),reviewId:need(values,'review'),title:need(values,'title'),document,expectedReviewSha256:reviewSha256});
    }else if(command==='list')result=await listCommissioning({project});
    else if(command==='read')result=await readCommissioningReview({project,reviewId:need(values,'review')});
    else if(command==='compare')result=await compareCommissioningEditions({project,sourceId:values.source??(values.review?undefined:need(values,'source')),reviewId:values.review,previousReviewId:need(values,'previous-review')});
    else if(command==='export')result=(await exportCommissioningReview({project,reviewId:need(values,'review'),format:need(values,'format')})).bytes;
    else result=await receiveCommissioningReview({project,bundle:await readJson(need(values,'bundle'))});
    await publish(result,output);return result;
  }finally{
    process.off('SIGINT',abort);process.off('SIGTERM',abort);
    await project?.close();
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'KIWIS_OPERATION',message:error.message,retryAfter:error.retryAfter??null})+'\n');process.exitCode=1;});
