// MIT. Reproduce and export the complete source-bound status report from retained originals.
import {resolve,isAbsolute,join,dirname,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {open,link,unlink,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readOwned,privateDirectory} from '../stellar-expert/store.mjs';
import {sha,identity,json,plain} from './contract.mjs';
import {analyzeStatusWindow,compareStatusWindows,statusWindowTables,STATUS_REQUEST_SCHEMA} from './operational.mjs';
import {renderStatusReport} from './operational-report.mjs';

const LIMIT=32*1024*1024,RECIPE='stellar-forge.sensorthings-status-report-recipe.v1';
const fail=(code,message,details=null)=>Object.assign(new Error(message),{code,details});
function relative(value){
 if(typeof value!=='string'||!value||value.length>600||value.includes('\\')||value.startsWith('/')||
    value.split('/').some(x=>!x||x==='.'||x==='..')||/[\u0000-\u001f\u007f]/.test(value))
  throw fail('STATUS_REPORT_PATH','Use a declared relative package path without traversal.');
 return value;
}
function decode(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
async function exact(root,item,max=LIMIT){
 if(!plain(item)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>max||!/^[a-f0-9]{64}$/.test(item.sha256??''))
  throw fail('STATUS_REPORT_IDENTITY','Retain a complete file byte count and SHA-256.');
 const path=relative(item.path),bytes=await readOwned(join(root,path),max);
 if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw fail('STATUS_REPORT_CHANGED','A retained original file differs: '+path);
 return bytes;
}
async function existing(path,max=LIMIT){try{return await readOwned(path,max);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function publish(root,path,data){
 const file=join(root,relative(path)),bytes=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
 if(bytes.length>LIMIT)throw fail('STATUS_REPORT_LIMIT','The complete file exceeds the declared export limit: '+path);
 await mkdir(dirname(file),{recursive:true,mode:0o700});await privateDirectory(dirname(file),{create:false});
 const before=await existing(file);
 if(before){if(before.length!==bytes.length||sha(before)!==sha(bytes))throw fail('STATUS_REPORT_OUTPUT_CHANGED','The existing output differs; keep its original directory and select a new one.',{path});}
 else{
  const temp=file+'.'+randomUUID()+'.pending',handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  let final=false;
  try{await link(temp,file);final=true;}
  catch(e){if(e.code!=='EEXIST')throw e;const original=await readOwned(file,LIMIT);
   if(original.length!==bytes.length||sha(original)!==sha(bytes))throw fail('STATUS_REPORT_OUTPUT_CHANGED','Another output occupies this exact path.',{path});final=true;}
  finally{if(final)await unlink(temp);}
  const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
 }
 return {path,bytes:bytes.length,sha256:sha(bytes)};
}
async function runtime(){
 const paths=['status-report.mjs','operational.mjs','operational-report.mjs','contract.mjs',
  '../stellar-expert/exact-json.mjs','../ogc/source.mjs'];
 const result=[];
 for(const path of paths){const bytes=await readOwned(fileURLToPath(new URL(path,import.meta.url)),4*1024*1024);result.push({path,bytes:bytes.length,sha256:sha(bytes)});}
 return result;
}
export async function generateStatusReports({sourceDirectory,recipeFile,outputDirectory,onProgress=()=>{}}={}){
 if(!isAbsolute(sourceDirectory??'')||!isAbsolute(recipeFile??'')||!isAbsolute(outputDirectory??''))
  throw fail('STATUS_REPORT_OPTIONS','Select absolute original-source, recipe and new output paths.');
 const source=resolve(sourceDirectory),out=resolve(outputDirectory);
 if(out===source||source.startsWith(out+sep)||out.startsWith(source+sep))
  throw fail('STATUS_REPORT_OUTPUT','Keep the complete received originals unchanged; use a separate output directory.');
 const recipeBytes=await readOwned(recipeFile,1024*1024),recipe=decode(recipeBytes);
 if(!plain(recipe)||recipe.schema!==RECIPE||!Array.isArray(recipe.windows)||recipe.windows.length!==2||
    new Set(recipe.windows.map(x=>x.id)).size!==2||recipe.windows.some(x=>!/^window-[12]$/.test(x.id))||
    typeof recipe.operationId!=='string'||!recipe.operationId)
  throw fail('STATUS_REPORT_RECIPE','Use the complete two-window source recipe.');
 const manifestPath=relative(recipe.sourceManifest),manifestBytes=await readOwned(join(source,manifestPath),2*1024*1024),manifest=decode(manifestBytes);
 if(manifest.schema!=='stellar-forge.sensorthings-public-source-capture.v1'||manifest.operationId!==recipe.operationId||
    !Array.isArray(manifest.sourceFiles)||!manifest.sourceFiles.length||manifest.sourceFiles.length>10000||
    new Set(manifest.sourceFiles.map(x=>x.path)).size!==manifest.sourceFiles.length)
  throw fail('STATUS_REPORT_MANIFEST','Retain the exact full source manifest for this operation.');
 const sourceFiles=new Map();
 for(const item of manifest.sourceFiles){
  if(!/^(originals|receipts)\//.test(relative(item.path)))throw fail('STATUS_REPORT_MANIFEST','Source members must remain inside originals/ or receipts/.');
  const bytes=await exact(source,item,1024*1024);sourceFiles.set(item.path,{item,bytes});
 }
 const sourceItem=async ref=>{
  const original=sourceFiles.get(relative(ref.path)),receipt=sourceFiles.get(relative(ref.receipt?.path));
  if(!original||!receipt||original.item.bytes!==ref.bytes||original.item.sha256!==ref.sha256||
     receipt.item.bytes!==ref.receipt.bytes||receipt.item.sha256!==ref.receipt.sha256)
   throw fail('STATUS_REPORT_RECIPE_BINDING','A recipe source or acquisition receipt differs from the complete source manifest.');
  if(ref.filename!==ref.path.split('/').at(-1)||ref.receipt.filename!==ref.receipt.path.split('/').at(-1))
   throw fail('STATUS_REPORT_RECIPE_BINDING','Original source and receipt filenames must remain exact.');
  return {...ref,text:new TextDecoder('utf-8',{fatal:true}).decode(original.bytes),
   receipt:{...ref.receipt,text:new TextDecoder('utf-8',{fatal:true}).decode(receipt.bytes)}};
 };
 const runtimeFiles=await runtime(),intent={
  schema:'stellar-forge.sensorthings-status-report-operation.v1',operationId:recipe.operationId,
  recipe:{bytes:recipeBytes.length,sha256:sha(recipeBytes)},sourceManifest:{path:manifestPath,bytes:manifestBytes.length,sha256:sha(manifestBytes)},runtime:runtimeFiles
 };
 intent.id=identity(intent);
 await privateDirectory(out,{create:true});await publish(out,'operation.json',json(intent));
 const completedBytes=await existing(join(out,'completed.json'),1024*1024);
 if(completedBytes){
  const completed=decode(completedBytes);
  if(completed.schema!=='stellar-forge.sensorthings-status-report-completion.v1'||completed.operationId!==intent.id||
     !Array.isArray(completed.files))throw fail('STATUS_REPORT_COMPLETION','The original completion differs from this operation.');
  for(const file of completed.files)await exact(out,file);
  return {...completed,reused:true};
 }
 // Copy the full declared original closure, including the original discovery/catalogue,
 // so the exported report's relative row/receipt links stay independently usable.
 const files=[];
 for(const {item,bytes}of sourceFiles.values())files.push(await publish(out,item.path,bytes));
 files.push(await publish(out,manifestPath,manifestBytes));
 files.push(await publish(out,'report-recipe.json',recipeBytes));
 const reports=[];
 for(const selected of [...recipe.windows].sort((a,b)=>a.id.localeCompare(b.id))){
  const input={schema:STATUS_REQUEST_SCHEMA,label:selected.label,window:selected.window,firstUrl:selected.firstUrl,
   definitions:selected.definitions,attentionCodes:selected.attentionCodes,pages:[]};
  for(const kind of ['stream','observedProperty','sensor','thing','locations','streamEnd'])input[kind]=await sourceItem(selected[kind]);
  for(const page of selected.pages)input.pages.push(await sourceItem(page));
  const report=analyzeStatusWindow(input);
  if(report.id!==selected.expectedAnalysisId||report.resultSha256!==selected.expectedResultSha256)
   throw fail('STATUS_REPORT_REPRODUCTION','The actual calculation differs from the selected published result.',{window:selected.id,analysisId:report.id,resultSha256:report.resultSha256});
  files.push(await publish(out,'reports/'+selected.id+'/status-report.json',JSON.stringify(report)+'\n'));
  for(const [name,text]of Object.entries(statusWindowTables(report)))files.push(await publish(out,'reports/'+selected.id+'/'+name,text));
  reports.push(report);onProgress({event:'report-calculated',window:selected.id,analysisId:report.id,rows:report.history.length});
 }
 const comparison=compareStatusWindows(reports[0],reports[1]);
 if(comparison.id!==recipe.expectedComparisonId)throw fail('STATUS_REPORT_REPRODUCTION','The comparison differs from the selected published result.');
 files.push(await publish(out,'reports/comparison.json',JSON.stringify(comparison,null,2)+'\n'));
 files.push(await publish(out,'reports/window-1/index.html',renderStatusReport(reports[0],{
  comparison,attribution:recipe.attribution??'',licenseUrl:recipe.licenseUrl??'',executionNote:'This report was calculated from the complete retained originals by the native Node report command. The calculation receipt pins the source, runtime and complete outputs. This calculation does not perform provider acquisition, native workspace intake, browser review or merchant/customer receiving.'})));
 const completed={
  schema:'stellar-forge.sensorthings-status-report-completion.v1',operationId:intent.id,
  sourceOperationId:recipe.operationId,completedAt:new Date().toISOString(),state:'COMPLETE',
  execution:'Native Node source calculation and complete file publication',
  recipe:intent.recipe,sourceManifest:intent.sourceManifest,runtime:runtimeFiles,
  analyses:reports.map(x=>({id:x.id,resultSha256:x.resultSha256,rows:x.history.length})),comparisonId:comparison.id,files,
  providerRequests:0,nativeWorkspaceMutation:false,
  scope:'This reproduces the retained-source calculation. It does not claim a new provider acquisition, browser review or merchant/customer operation.'
 };
 files.push(await publish(out,'calculation-receipt.json',JSON.stringify({...completed,files:[...files]},null,2)+'\n'));
 await publish(out,'completed.json',JSON.stringify(completed,null,2)+'\n');
 return {...completed,reused:false};
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('node status-report.mjs --sources ABSOLUTE_SOURCE_DIRECTORY --recipe ABSOLUTE_RECIPE_JSON --out ABSOLUTE_NEW_REPORT_DIRECTORY\nCalculate from the complete received originals, verify selected result identities and export all original sources, complete tables and the offline report. Reopen the same output to verify its completed receipt.');return;}
 const parsed={};
 for(let i=0;i<args.length;i+=2){const key=args[i];
  if(!['--sources','--recipe','--out'].includes(key)||Object.hasOwn(parsed,key)||!args[i+1]||!isAbsolute(args[i+1]))
   throw fail('STATUS_REPORT_CLI','Use each declared absolute path once.');parsed[key]=args[i+1];}
 if(Object.keys(parsed).length!==3)throw fail('STATUS_REPORT_CLI','Select sources, recipe and output.');
 const result=await generateStatusReports({sourceDirectory:parsed['--sources'],recipeFile:parsed['--recipe'],outputDirectory:parsed['--out'],
  onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')});
 console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
 console.error(JSON.stringify({error:error.code??'STATUS_REPORT_FAILED',message:error.message,details:error.details??null}));process.exitCode=1;
});
