// MIT. Reproduce a complete read-only component report from the retained original package.
// This command never opens a SensorThings workspace and never contacts a provider.
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,open,lstat} from 'node:fs/promises';
import {readOwned,syncDir} from '../stellar-expert/store.mjs';
import {sha,plain,identity} from './contract.mjs';
import {IOTLAB_COMPONENT_OPERATION,IOTLAB_COMPONENT_ORIGINALS} from './record-multicomponent.mjs';
import {analyseComponentOriginals} from './analysis/component-source-report.mjs';
import {renderComponentSourceReport} from './analysis/component-report.mjs';

const OP=/^[A-Za-z0-9_-]{8,100}$/;
const SOURCE_MODULES=[
 ['sensorthings/report-multicomponent.mjs','./report-multicomponent.mjs'],
 ['sensorthings/record-multicomponent.mjs','./record-multicomponent.mjs'],
 ['sensorthings/analysis/components.mjs','./analysis/components.mjs'],
 ['sensorthings/analysis/component-source-report.mjs','./analysis/component-source-report.mjs'],
 ['sensorthings/analysis/component-report.mjs','./analysis/component-report.mjs'],
 ['sensorthings/contract.mjs','./contract.mjs'],
 ['sensorthings/schema.mjs','./schema.mjs'],
 ['sensorthings/domain.mjs','./domain.mjs'],
 ['ogc/source.mjs','../ogc/source.mjs'],
 ['stellar-expert/exact-json.mjs','../stellar-expert/exact-json.mjs']
];
const fail=(code,message,details=null)=>Object.assign(new Error(message),{code:'SENSORTHINGS_COMPONENT_REPORT_'+code,details});
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
function safeRelative(path){
 if(typeof path!=='string'||!path||isAbsolute(path)||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'))
  throw fail('PATH','Use the complete declared relative original file name.');
 return path;
}
async function newFile(directory,name,bytes){
 const file=await open(join(directory,safeRelative(name)),'wx',0o600);
 try{await file.writeFile(bytes);await file.sync();await file.chmod(0o400);}finally{await file.close();}
 return {path:name,bytes:bytes.length,sha256:sha(bytes)};
}
async function ownDirectory(path){
 const st=await lstat(path);
 if(!st.isDirectory()||st.isSymbolicLink()||(typeof process.getuid==='function'&&st.uid!==process.getuid()))
  throw fail('DIRECTORY','The report output must be the caller-owned original directory.');
}
async function reopen(directory,expected){
 await ownDirectory(directory);
 let bytes;
 try{bytes=await readOwned(join(directory,'report-manifest.json'),8*1024*1024);}
 catch(error){throw fail('INCOMPLETE_OUTPUT','The original directory has no completed report manifest. Preserve its exact partial files and request a separate explicit output location for a new calculation.',{cause:error.code});}
 const manifest=parse(bytes);
 if(!plain(manifest)||manifest.schema!=='stellar-forge.sensorthings-component-file-report.v1'||manifest.status!=='COMPLETE'||
    manifest.operationId!==expected.operationId||manifest.requestSha256!==identity(expected)||
    !Array.isArray(manifest.files)||!manifest.files.length)
  throw fail('REOPEN_BINDING','The completed report belongs to different original input, plan or operation.');
 const seen=new Set();
 for(const file of manifest.files){
  safeRelative(file.path);
  if(seen.has(file.path)||file.path==='report-manifest.json')throw fail('MANIFEST','The complete report lists a duplicate or circular member.');
  seen.add(file.path);
  if(!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>128*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256??''))
   throw fail('MANIFEST','The report member identity is invalid.');
  const body=await readOwned(join(directory,file.path),file.bytes);
  if(body.length!==file.bytes||sha(body)!==file.sha256)throw fail('MEMBER_CHANGED','A completed report member differs: '+file.path);
 }
 return {reopened:true,directory,manifest:{path:'report-manifest.json',bytes:bytes.length,sha256:sha(bytes)},report:manifest};
}
export async function reportIotlabComponents({originalsDirectory,planFile,outputDirectory,
 operationId=IOTLAB_COMPONENT_OPERATION+'_REPORT'}={}){
 if(![originalsDirectory,planFile,outputDirectory].every(x=>isAbsolute(x??''))||!OP.test(operationId))
  throw fail('ARGUMENT','Select absolute original-source, explicit plan and output paths plus one stable operation ID.');
 const manifestBytes=await readOwned(join(originalsDirectory,IOTLAB_COMPONENT_ORIGINALS.filename),1024*1024),
   planBytes=await readOwned(planFile,1024*1024),plan=parse(planBytes);
 if(manifestBytes.length!==IOTLAB_COMPONENT_ORIGINALS.bytes||sha(manifestBytes)!==IOTLAB_COMPONENT_ORIGINALS.sha256)
  throw fail('SOURCE_IDENTITY','Use the full frozen 51-file original IoTLab/BGS qualification package.');
 const request={operationId,originals:IOTLAB_COMPONENT_ORIGINALS,plan:{bytes:planBytes.length,sha256:sha(planBytes)}};
 try{await mkdir(outputDirectory,{recursive:false,mode:0o700});}
 catch(error){if(error.code==='EEXIST')return reopen(outputDirectory,request);throw error;}
 const startedAt=new Date().toISOString(),requestSha256=identity(request);
 const written=[];
 written.push(await newFile(outputDirectory,'report-intent.json',json({schema:'stellar-forge.sensorthings-component-file-report-intent.v1',
  operationId,requestSha256,request,startedAt,nativeWorkspace:null,nativeEdition:null})));
 written.push(await newFile(outputDirectory,'source-manifest.json',manifestBytes));
 written.push(await newFile(outputDirectory,'component-analysis-plan.json',planBytes));
 await mkdir(join(outputDirectory,'source-modules'),{mode:0o700});
 const runtimeModules=[];
 for(let i=0;i<SOURCE_MODULES.length;i++){
  const [sourcePath,relative]=SOURCE_MODULES[i],body=await readOwned(fileURLToPath(new URL(relative,import.meta.url)),1024*1024),
    saved=await newFile(outputDirectory,'source-modules/'+String(i+1).padStart(2,'0')+'-'+sourcePath.split('/').at(-1),body);
  runtimeModules.push({sourcePath,...saved});written.push(saved);
 }
 const result=await analyseComponentOriginals({manifestBytes,expectedSha256:IOTLAB_COMPONENT_ORIGINALS.sha256,
  expectedBytes:IOTLAB_COMPONENT_ORIGINALS.bytes,plan,calculatedAt:startedAt,
  readFile:async path=>readOwned(join(originalsDirectory,safeRelative(path)),1024*1024)});
 const rendered=renderComponentSourceReport(result.report),
  outputs=[['component-report.json',json(result.report)],['component-report.html',Buffer.from(rendered.html,'utf8')],
   ['selected-components.csv',Buffer.from(rendered.componentCSV,'utf8')],['daily-sample-summary.csv',Buffer.from(rendered.dailyCSV,'utf8')],
   ['duplicate-instants.csv',Buffer.from(rendered.duplicateTimesCSV,'utf8')],['observed-gaps.csv',Buffer.from(rendered.gapsCSV,'utf8')],
   ...rendered.figures.map(f=>[f.filename,Buffer.from(f.svg,'utf8')])];
 for(const [name,bytes] of outputs)written.push(await newFile(outputDirectory,name,bytes));
 const completedAt=new Date().toISOString(),manifest={schema:'stellar-forge.sensorthings-component-file-report.v1',
  status:'COMPLETE',operationId,requestSha256,request,startedAt,completedAt,
  execution:{runtime:'Node '+process.version,kind:'read-only retained-original calculation',
   sourceModuleCopies:runtimeModules,nativeWorkspace:null,nativeCapture:null,nativeEdition:null,nativePublication:null,
   providerRequests:0,browserRun:null},
  summary:{originalObservations:result.report.sourceRows,selectedComponentOccurrences:result.report.selectedComponentRows,
   distinctInstants:result.report.timeAudit.distinctInstants,duplicateInstants:result.report.timeAudit.duplicateInstants.length,
   maximumObservedGaps:result.report.timeAudit.maximumGaps.length},
  originalSourceClosure:result.report.originalClosure,files:written};
 await syncDir(join(outputDirectory,'source-modules'));await syncDir(outputDirectory);
 const saved=await newFile(outputDirectory,'report-manifest.json',json(manifest));await syncDir(outputDirectory);
 return {reopened:false,directory:outputDirectory,manifest:saved,report:manifest};
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('node report-multicomponent.mjs --originals ABS --plan ABS --output ABS [--operation-id ID]\nCalculate the complete source-bound component report with the original decoder and exact decimal model. Repeating the same completed output verifies and reopens its files without another calculation. No network or native workspace.');return;}
 const p={},allowed=new Set(['--originals','--plan','--output','--operation-id']);
 for(let i=0;i<args.length;i++){
  const key=args[i];if(!allowed.has(key)||Object.hasOwn(p,key)||!args[i+1]||args[i+1].startsWith('--'))throw fail('CLI','Use each declared option once.');
  p[key]=args[++i];
 }
 if(!p['--originals']||!p['--plan']||!p['--output'])throw fail('CLI','The original source package, explicit component plan and report output are required.');
 console.log(JSON.stringify(await reportIotlabComponents({originalsDirectory:p['--originals'],planFile:p['--plan'],outputDirectory:p['--output'],
  operationId:p['--operation-id']??IOTLAB_COMPONENT_OPERATION+'_REPORT'}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
 console.error(JSON.stringify({error:error.code??'SENSORTHINGS_COMPONENT_REPORT',message:error.message,details:error.details??null}));process.exitCode=1;
});
