#!/usr/bin/env node
/**
 * Reproduce the complete historical USGS source exercise through the original
 * Measurements CSV parser, explicit source interpretation/pairing and science core.
 * Does not open a SQLite workspace or claim that a native review was committed.
 */
import fs from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareSedimentReference,buildSedimentReferenceInputs} from './sediment-reference.mjs';
import {calculateSedimentReference} from './sediment_reference_course.mjs';
import {parseSource} from '../engine/normalise.mjs';
import {rebuildSedimentStudy} from '../engine/sediment_workspace.mjs';
import {sedimentHTML,sedimentCSV} from '../engine/sediment_reports.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function need(value,message){if(!value)throw new Error(message);}
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
async function regular(file,limit=64*1024*1024){
 const before=await fs.lstat(file);need(before.isFile()&&!before.isSymbolicLink()&&before.size<=limit,'Select a bounded original regular file: '+file);
 const handle=await fs.open(file,FS.O_RDONLY|FS.O_NONBLOCK|FS.O_NOFOLLOW);
 try{
  const opened=await handle.stat();need(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size,'Original file changed during selection');
  const bytes=await handle.readFile(),after=await handle.stat();need(after.size===opened.size&&after.mtimeMs===opened.mtimeMs&&bytes.length===opened.size,'Original file changed during reading');
  return bytes;
 }finally{await handle.close();}
}
async function directory(file){
 const present=await fs.lstat(file).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
 if(!present)await fs.mkdir(file,{mode:0o700});
 const stat=await fs.lstat(file);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Output must be a real directory');
 need(await fs.realpath(file)===file,'Use an absolute canonical output directory');
}
async function syncDirectory(file){const h=await fs.open(file,'r');try{await h.sync();}finally{await h.close();}}
async function publish(directory,name,bytes){
 need(!name.includes('/')&&!name.includes('\\')&&!name.startsWith('.'),'Use a plain artifact basename');
 const final=path.join(directory,name),digest=sha(bytes),temporary=path.join(directory,'.'+name+'.'+digest+'.partial');
 const matches=async file=>{const value=await regular(file);need(value.length===bytes.length&&sha(value)===digest,'Existing artifact differs from the original result: '+file);};
 const settled=async()=>{
  const f=await fs.lstat(final);
  const t=await fs.lstat(temporary).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
  if(t&&f.dev===t.dev&&f.ino===t.ino){await matches(temporary);await syncDirectory(directory);await fs.unlink(temporary);await syncDirectory(directory);}
  need((await fs.lstat(final)).nlink===1,'Artifact publication has an unresolved link alias');
 };
 const exists=await fs.lstat(final).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
 if(exists){await matches(final);await settled();return {path:name,bytes:bytes.length,sha256:digest};}
 const pending=await fs.lstat(temporary).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
 if(pending)await matches(temporary);
 else{
  const h=await fs.open(temporary,'wx',0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
 }
 try{await fs.link(temporary,final);}catch(error){if(error.code!=='EEXIST')throw error;await matches(final);}
 await syncDirectory(directory);await settled();
 return {path:name,bytes:bytes.length,sha256:digest};
}
function argumentsOf(argv){
 const result={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i];need(['--output','--reviewer','--review-at','--reason'].includes(key)&&argv[i+1]&&!Object.hasOwn(result,key),'Use each documented option exactly once');result[key]=argv[i+1];}
 for(const key of ['--output','--reviewer','--review-at','--reason'])need(result[key],'Missing '+key);
 need(path.isAbsolute(result['--output']),'--output must be an absolute directory');
 return result;
}

export async function runPublishedSedimentReference(options){
 const csv=await regular(path.join(HERE,'usgs_07144100_sediment_2004_2014.csv'));
 const provenanceBytes=await regular(path.join(HERE,'usgs_07144100_sediment_2004_2014.json'));
 const extraction=await regular(path.join(HERE,'usgs_07144100_sediment_table_extraction.txt'));
 const provenance=JSON.parse(provenanceBytes.toString('utf8'));
 need(sha(csv)===provenance.csv_sha256&&sha(csv)==='7783717d890ffc902096823a626b080cbaa457bc82977ebe97961abc74881e26','Published CSV hash differs from the complete retained source');
 const prepared=prepareSedimentReference({csv:csv.toString('utf8'),provenance:provenanceBytes.toString('utf8'),extraction:extraction.toString('utf8'),reviewer:options.reviewer,reason:options.reason});
 need(typeof options.reviewAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.reviewAt)&&Number.isFinite(Date.parse(options.reviewAt)),'Select an explicit UTC source-exercise review time');
 need(new Date(options.reviewAt).toISOString()===options.reviewAt.replace(/Z$/,options.reviewAt.includes('.')?'Z':'.000Z'),'Use a real calendar date for the explicit source-exercise review time');
 const review={state:'include',reviewer:options.reviewer,reason:options.reason,updatedAt:options.reviewAt,selectVersion:false};
 const records=prepared.pairingBeforeNativeReview.sourceRecords.map(row=>({...row,review:{...review}}));
 const inputs=buildSedimentReferenceInputs(prepared,records),results=calculateSedimentReference(inputs);
 const sourceExercise={schema:'upstate.sediment-source-exercise/v1',sourceOnly:true,nativeReviewCommitted:false,nativeWorkspaceRun:false,browserRun:false,
  reviewContext:review,interpretation:'Explicitly authored context for this public scientific source exercise. No original workspace review receipt or field approval is fabricated.',
  originalStatus:prepared.input.origin.constants.status,beforeReview:prepared.pairingBeforeNativeReview.counts,afterAuthoredContext:inputs.pairing.counts};

 const parsed=parseSource(prepared.input),summary={rows:parsed.rows.length,rejectedCount:parsed.rejected.length,stationCount:new Set(parsed.rows.map(x=>x.row.stationId||x.row.id)).size,censored:parsed.rows.filter(x=>x.row.censor&&x.row.censor!=='none').length,parameters:{},issues:{}};
 for(const {row} of parsed.rows){if(row.parameter)summary.parameters[row.parameter]=(summary.parameters[row.parameter]||0)+1;for(const issue of row.issues||[])summary.issues[issue]=(summary.issues[issue]||0)+1;}
 const serviceInput={
  definition:{study_id:'5c0e2e52-c484-4557-8f9c-c323606665a8',parent_id:null,title:'SOURCE EXERCISE — USGS07144100 temporal SSC surrogate',actor:options.reviewer,at:options.reviewAt,
   note:'Pure service rebuild using the genuine published120-row table and explicitly authored source-only review context. workspace_revision0 and created_at are proposed input metadata for this source exercise, not a claim of an imported native workspace, native review, field approval or rendered application.',
   selection:prepared.selection,model:inputs.temporalModel,deployment:inputs.deploymentSelections.flag,source_basis:null},
  workspace_revision:0,
  sources:[{id:prepared.importIdentity.id,kind:prepared.input.kind,label:prepared.input.label,created_at:options.reviewAt,sha:prepared.importIdentity.sha256,content:prepared.input.text,mapping:parsed.mapping,origin:prepared.input.origin,summary,rejected:parsed.rejected}],
  contexts:records.map(row=>({id:row.id,review:row.review,selectedVersion:row.selectedVersion,variants:row.variants}))
 };
 const study=rebuildSedimentStudy(serviceInput);
 return {prepared,inputs,results,sourceExercise,study,provenance,csv,provenanceBytes,extraction};

}

export async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--help'){process.stdout.write('node reference/run-sediment-reference.mjs --output /ABS/OUTPUT --reviewer NAME --review-at YYYY-MM-DDTHH:MM:SSZ --reason "Explicit historical source review rationale"\n');return;}
 const args=argumentsOf(argv);
 const original=await runPublishedSedimentReference({reviewer:args['--reviewer'],reviewAt:args['--review-at'],reason:args['--reason']});
 const output=path.resolve(args['--output']);await directory(output);
 const files=[
  ['source-exercise.json',encode(original.sourceExercise)],
  ['reference-preparation.json',encode(original.prepared)],
  ['reference-inputs.json',encode(original.inputs)],
  ['reference-summary.json',encode(original.results.summary)],
  ['service-study.json',encode(original.study)],
  ['report.html',Buffer.from(sedimentHTML(original.study))],
  ...['pairs','residuals','predictions','coefficients'].map(kind=>[kind+'.csv',Buffer.from(sedimentCSV(original.study,kind))]),
  ...Object.entries(original.results.fits).map(([name,value])=>[name+'.json',encode(value)]),
  ...Object.entries(original.results.predictions).map(([name,value])=>[name+'.json',encode(value)]),
  ['usgs_07144100_sediment_2004_2014.csv',original.csv],
  ['usgs_07144100_sediment_2004_2014.json',original.provenanceBytes],
  ['usgs_07144100_sediment_table_extraction.txt',original.extraction]
 ];
 const artifacts=[];for(const [name,value]of files)artifacts.push(await publish(output,name,value));
 const sourceFiles=['../engine/parse.mjs','../engine/characteristics.mjs','../engine/normalise.mjs','../engine/sediment_pairs.mjs','../engine/sediment_surrogate.mjs','../engine/sediment_workspace.mjs','../engine/sediment_reports.mjs','sediment-reference.mjs','sediment_reference_course.mjs','run-sediment-reference.mjs'];
 const source=[];for(const name of sourceFiles){const value=await regular(path.resolve(HERE,name));source.push({path:name,bytes:value.length,sha256:sha(value)});}
 const receipt={schema:'upstate.sediment-reference-execution/v1',status:'COMPLETE',runtime:{kind:'Node.js',version:process.version,platform:process.platform},sourceExercise:original.sourceExercise,source,artifacts,
  counts:original.results.summary.candidates.temporalLogLog.counts,roundedPublishedCoefficientsMatch:original.results.summary.publicationComparison.roundedCoefficientsMatch};
 await publish(output,'execution.json',encode(receipt));
 process.stdout.write(JSON.stringify({status:'COMPLETE',output,artifacts:artifacts.length,counts:receipt.counts,executionSha256:sha(encode(receipt))})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
