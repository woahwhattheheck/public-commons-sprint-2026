#!/usr/bin/env node
/** Complete source-only comparison reproduction. Uses existing saved study input; owns no Workspace. */
import fs from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {calculateSedimentComparisonReference,sedimentComparisonRowsCSV} from './sediment_comparison_reference.mjs';
import {reopenSedimentComparison} from '../engine/sediment_comparison.mjs';
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
 for(let i=0;i<argv.length;i+=2){const key=argv[i];need(['--study','--output','--actor','--at','--reason'].includes(key)&&argv[i+1]&&!Object.hasOwn(result,key),'Use each documented option exactly once');result[key]=argv[i+1];}
 for(const key of ['--study','--output','--actor','--at','--reason'])need(result[key],'Missing '+key);
 need(path.isAbsolute(result['--output'])&&path.isAbsolute(result['--study']),'Use absolute study and output paths');return result;
}
export async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--help'){process.stdout.write('node reference/run-sediment-comparison.mjs --study /ABS/reference/service-study.json --output /ABS/COMPARISON --actor NAME --at ZONED_ISO --reason "Explicit public-source exercise rationale"\n');return;}
 const args=argumentsOf(argv),output=path.resolve(args['--output']);await directory(output);
 const originalBytes=await regular(path.resolve(args['--study']),128*1024*1024);
 const options={actor:args['--actor'],at:args['--at'],reason:args['--reason']};
 const input={schema:'upstate.sediment-comparison-reference-request/v1',study:{path:path.resolve(args['--study']),bytes:originalBytes.length,sha256:sha(originalBytes)},options};
 await publish(output,'input.json',encode(input));
 await publish(output,'original-service-study.json',originalBytes);
 const course=calculateSedimentComparisonReference(JSON.parse(originalBytes.toString('utf8')),options);
 const artifacts=[];
 for(const [name,value]of [
  ['source-exercise.json',encode(course.sourceExercise)],
  ['comparison-all.json',encode(course.all)],
  ['comparison-in-range.json',encode(course.inRange)],
  ['comparison-summary.json',encode(course.summary)],
  ['comparison-all-rows.csv',Buffer.from(sedimentComparisonRowsCSV(course.all))],
  ['comparison-in-range-rows.csv',Buffer.from(sedimentComparisonRowsCSV(course.inRange))]
 ])artifacts.push(await publish(output,name,value));
 // Read the actual delivered all-population file, then reconstruct its originals
 // through the same pure maintained service; no warm object identity is reused.
 const received=JSON.parse((await regular(path.join(output,'comparison-all.json'),128*1024*1024)).toString('utf8'));
 const reopened=reopenSedimentComparison(received);need(reopened.id===course.all.id,'Delivered comparison does not reopen to its original input/result');
 const sourcePaths=['../engine/parse.mjs','../engine/characteristics.mjs','../engine/normalise.mjs','../engine/sediment_pairs.mjs','../engine/sediment_surrogate.mjs','../engine/sediment_workspace.mjs','../engine/sediment_comparison.mjs','sediment-reference.mjs','sediment_comparison_reference.mjs','run-sediment-comparison.mjs','usgs_07144100_sediment_2004_2014.csv','usgs_07144100_sediment_2004_2014.json','usgs_07144100_sediment_table_extraction.txt'];
 const source=[];for(const name of sourcePaths){const b=await regular(path.resolve(HERE,name));source.push({path:name,bytes:b.length,sha256:sha(b)});}
 const receipt={schema:'upstate.sediment-comparison-reference-execution/v1',status:'COMPLETE',runtime:{kind:'Node.js',version:process.version,platform:process.platform},sourceExercise:course.sourceExercise,input,source,artifacts,
  comparisons:{all:{id:course.all.id,counts:course.all.result.counts},inRange:{id:course.inRange.id,counts:course.inRange.result.counts}},coldReopen:{artifact:'comparison-all.json',id:reopened.id,completeOriginalsRebuilt:true}};
 await publish(output,'execution.json',encode(receipt));
 process.stdout.write(JSON.stringify({status:'COMPLETE',output,artifacts:artifacts.length,comparisons:receipt.comparisons,executionSha256:sha(encode(receipt))})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
