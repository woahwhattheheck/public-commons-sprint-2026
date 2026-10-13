#!/usr/bin/env node
// MIT. Original capture, immutable CASE comparison and complete cold receiving.
import {mkdir,open,lstat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {captureCASEFile,captureCASEHTTP,readOriginalFile,sha256,utf8} from './case-http.mjs';
import {compareCASEEditions,createCASEDelivery,inspectCASEDelivery,inspectCASESource,caseChangeCSV} from './case-source.mjs';
import {readCASEEnvelope} from './source-json.mjs';
import {renderCASEReport} from './case-report.mjs';
const MIB=1024*1024,CONTROL_LIMIT=32*MIB;
const json=v=>JSON.stringify(v,null,2)+'\n';
const bytes=s=>Buffer.from(s,'utf8');
const fail=m=>{throw Object.assign(Error(m),{code:'CASE_RECEIVING_INVALID'});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const FILES=['case-cli.mjs','case-http.mjs','case-report.mjs','case-source.mjs','source-json.mjs'];
const ARTIFACTS=['case-edition-delivery.json','case-edition-report.html','case-edition-changes.csv','comparison.json','review.json','framework-before.json','framework-after.json'];
async function identity(text){return {bytes:bytes(text).length,sha256:await sha256(bytes(text))};}
async function readText(path,limit=CONTROL_LIMIT){return utf8((await readOriginalFile(path,limit)).bytes);}
async function readJSON(path,limit=CONTROL_LIMIT){return readCASEEnvelope(await readText(path,limit),limit).value;}
async function toolEdition(){
 const files=[];
 for(const name of FILES){const b=await readOriginalFile(fileURLToPath(new URL('./'+name,import.meta.url)),2*MIB);files.push({name,bytes:b.bytes.length,sha256:await sha256(b.bytes)});}
 return {schema:'commons.case-tool-edition.v1',files};
}
async function requireNewOutput(path){
 if(typeof path!=='string'||!path.length)fail('Select a new output directory.');
 try{await lstat(resolve(path));}catch(error){if(error.code==='ENOENT')return;throw error;}
 fail('Output already exists. Reproduce the complete result or recover into a separate new directory.');
}
async function ownDirectory(path){
 if(typeof path!=='string'||!path.length)fail('Select a new output directory.');
 const directory=resolve(path);
 try{await mkdir(directory,{mode:0o700});}
 catch(e){if(e.code==='EEXIST')fail('Output already exists. Reproduce the complete result or recover into a separate new directory.');throw e;}
 return directory;
}
async function writeNew(directory,name,text){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))fail('Invalid owned output member.');
 let handle;
 try{handle=await open(join(directory,name),'wx',0o600);await handle.writeFile(text,{encoding:'utf8'});await handle.sync();}
 finally{if(handle)await handle.close();}
}
async function directoryMembers(directory,expected){
 const stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())fail('Select an ordinary captured/output directory.');
 const actual=(await readdir(directory)).sort(),names=expected.slice().sort();
 if(JSON.stringify(actual)!==JSON.stringify(names))fail('Saved directory members differ from its complete selected manifest.');
}
async function manifestFor(schema,files,extra={}){
 const rows=[];for(const name of Object.keys(files).sort())rows.push({name,...await identity(files[name])});
 return {schema,...extra,files:rows};
}
async function verifyManifest(directory,manifest,expectedSchema){
 if(manifest?.schema!==expectedSchema||!Array.isArray(manifest.files)||manifest.files.length>32)fail('Unsupported complete output manifest.');
 const names=new Set();
 for(const row of manifest.files){
  if(!plain(row)||typeof row.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(row.name)||row.name==='manifest.json'||names.has(row.name)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>CONTROL_LIMIT||!/^[a-f0-9]{64}$/.test(row.sha256))fail('Invalid or repeated saved output member.');
  names.add(row.name);
  const text=await readText(join(directory,row.name)),actual=await identity(text);
  if(actual.bytes!==row.bytes||actual.sha256!==row.sha256)fail('Saved member differs: '+row.name);
 }
 await directoryMembers(directory,[...names,'manifest.json']);
 return names;
}
export async function captureCASESource(options){
 if(!plain(options)||!!options.file===!!options.url)fail('Select exactly one complete source file or CASE package URL.');
 await requireNewOutput(options.out);
 let capture;
 try{capture=options.file?await captureCASEFile(options.file,{label:options.label}):await captureCASEHTTP(options.url,options);}
 catch(error){
  if(error.caseCaptureFailure){
   const failure=error.caseCaptureFailure;
   const files={'source.json':failure.source.text,'capture-failure.json':json(failure)};
   const manifest=await manifestFor('commons.case-capture-failure-files.v1',files);
   const directory=await ownDirectory(options.out);
   for(const name of Object.keys(files))await writeNew(directory,name,files[name]);
   await writeNew(directory,'manifest.json',json(manifest));
   await verifyManifest(directory,manifest,'commons.case-capture-failure-files.v1');
   error.savedFailure={directory,manifest};
   error.message+=' Complete original response and rejection are retained at '+directory+'.';
  }
  throw error;
 }
 const inspectionText=json(capture.inspection);
 const metadata={schema:capture.schema,origin:capture.source.origin,source:{bytes:capture.source.bytes,sha256:capture.source.sha256},inspection:await identity(inspectionText)};
 const files={'source.json':capture.source.text,'inspection.json':inspectionText,'capture.json':json(metadata)};
 const manifest=await manifestFor('commons.case-capture-files.v1',files);
 const directory=await ownDirectory(options.out);
 // The complete original source is the first retained file. A partial capture remains available.
 for(const name of Object.keys(files))await writeNew(directory,name,files[name]);
 await writeNew(directory,'manifest.json',json(manifest));
 await readCASECapture(directory);
 return {directory,manifest,capture};
}
export async function readCASECapture(directory){
 directory=resolve(directory);
 const manifest=await readJSON(join(directory,'manifest.json'),MIB);
 const names=await verifyManifest(directory,manifest,'commons.case-capture-files.v1');
 if(JSON.stringify([...names].sort())!==JSON.stringify(['capture.json','inspection.json','source.json']))fail('Capture is missing its complete original members.');
 const metadata=await readJSON(join(directory,'capture.json'),2*MIB),text=await readText(join(directory,'source.json'),MIB);
 if(metadata.schema!=='commons.case-capture.v1')fail('Unsupported selected capture.');
 if(!plain(metadata.source)||!plain(metadata.origin))fail('Capture source metadata is incomplete.');
 const inspection=await inspectCASESource({text,origin:metadata.origin,bytes:metadata.source.bytes,sha256:metadata.source.sha256},{hash:sha256});
 const actual=json(inspection),saved=await readText(join(directory,'inspection.json'));
 if(saved!==actual||JSON.stringify(await identity(saved))!==JSON.stringify(metadata.inspection))fail('Selected capture inspection no longer reproduces. Use its original complete tool source.');
 return {schema:metadata.schema,source:inspection.source,inspection};
}
async function selectedCapture(value){
 const capture=typeof value==='string'?await readCASECapture(value):value;
 if(capture?.schema!=='commons.case-capture.v1'||!capture.source)fail('Select a complete original capture.');
 const inspection=await inspectCASESource(capture.source,{hash:sha256});
 if(capture.inspection&&JSON.stringify(capture.inspection)!==JSON.stringify(inspection))fail('Original capture inspection differs from its source.');
 return {source:inspection.source,inspection};
}
async function renderArtifacts(delivery){
 return {
  'case-edition-delivery.json':json(delivery),
  'case-edition-report.html':renderCASEReport(delivery),
  'case-edition-changes.csv':caseChangeCSV(delivery.report,delivery.review),
  'comparison.json':json(delivery.report),
  'review.json':json(delivery.review),
  'framework-before.json':delivery.before.text,
  'framework-after.json':delivery.after.text
 };
}
async function receiveText(deliveryText,out){
 await requireNewOutput(out);
 if(typeof deliveryText!=='string'||bytes(deliveryText).length>CONTROL_LIMIT)fail('A complete selected delivery within 32 MiB is required.');
 const selected=readCASEEnvelope(deliveryText,CONTROL_LIMIT).value,delivery=await inspectCASEDelivery(selected,{hash:sha256});
 const editionText=json(await toolEdition()),artifacts=await renderArtifacts(delivery);
 for(const [name,text]of Object.entries(artifacts))if(bytes(text).length>CONTROL_LIMIT)fail('Complete generated member exceeds 32 MiB: '+name);
 const operation={schema:'commons.case-receiving-operation.v1',selectedDelivery:await identity(deliveryText),sourceEdition:await identity(editionText),basisSha256:delivery.report.basisSha256,artifacts:ARTIFACTS};
 const files={'operation.json':json(operation),'source-edition.json':editionText,'selected-delivery.json':deliveryText,...artifacts};
 const manifest=await manifestFor('commons.case-received-files.v1',files,{basisSha256:delivery.report.basisSha256});
 const directory=await ownDirectory(out);
 // Pins precede materialized outputs. Never delete or overwrite interrupted originals.
 for(const name of Object.keys(files))await writeNew(directory,name,files[name]);
 await writeNew(directory,'manifest.json',json(manifest));
 const reproduced=await reproduceCASEResult(directory);
 return {directory,manifest,delivery,reproduced};
}
export async function receiveCASEDelivery({delivery,deliveryText,out}){
 if(delivery!==undefined&&deliveryText!==undefined)fail('Select delivery object or original delivery text, not both.');
 if(deliveryText===undefined){if(!plain(delivery))fail('Select a complete original delivery.');deliveryText=json(delivery);}
 return receiveText(deliveryText,out);
}
export async function compareCASECaptures({before,after,review,reviewer,out}){
 const a=await selectedCapture(before),b=await selectedCapture(after);
 if(review!==undefined&&reviewer!==undefined)fail('Select an existing full review or a name for a new unreviewed comparison.');
 const report=await compareCASEEditions(a.source,b.source,{hash:sha256});
 if(review===undefined)review={basisSha256:report.basisSha256,reviewer,notes:'',decisions:{}};
 const delivery=await createCASEDelivery({before:a.source,after:b.source,review},{hash:sha256});
 return receiveCASEDelivery({delivery,out});
}
async function pinnedInputs(directory){
 const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('Select an ordinary original output directory.');
 const operation=await readJSON(join(directory,'operation.json'),MIB);
 if(operation?.schema!=='commons.case-receiving-operation.v1'||JSON.stringify(operation.artifacts)!==JSON.stringify(ARTIFACTS))fail('Unsupported original receiving operation.');
 const selectedText=await readText(join(directory,'selected-delivery.json')),editionText=await readText(join(directory,'source-edition.json'),MIB);
 if(JSON.stringify(await identity(selectedText))!==JSON.stringify(operation.selectedDelivery)||JSON.stringify(await identity(editionText))!==JSON.stringify(operation.sourceEdition))fail('Original receiving inputs differ from their saved identities.');
 if(editionText!==json(await toolEdition()))fail('Current tool edition differs. Reopen with the complete original five modules named in source-edition.json.');
 const delivery=await inspectCASEDelivery(readCASEEnvelope(selectedText,CONTROL_LIMIT).value,{hash:sha256});
 if(delivery.report.basisSha256!==operation.basisSha256)fail('Original operation comparison differs from its retained inputs.');
 return {operation,delivery,selectedText,editionText};
}
export async function reproduceCASEResult(directory){
 directory=resolve(directory);
 const manifest=await readJSON(join(directory,'manifest.json'),MIB);
 const names=await verifyManifest(directory,manifest,'commons.case-received-files.v1');
 const expected=['operation.json','source-edition.json','selected-delivery.json',...ARTIFACTS].sort();
 if(JSON.stringify([...names].sort())!==JSON.stringify(expected))fail('Complete receiving output members differ.');
 const inputs=await pinnedInputs(directory),generated=await renderArtifacts(inputs.delivery);
 for(const [name,text]of Object.entries(generated))if(await readText(join(directory,name))!==text)fail('Saved output does not reproduce from the original sources: '+name);
 if(manifest.basisSha256!==inputs.operation.basisSha256)fail('Manifest comparison differs.');
 return {schema:'commons.case-cold-reproduction.v1',basisSha256:manifest.basisSha256,files:manifest.files,sourceEdition:inputs.operation.sourceEdition,selectedDelivery:inputs.operation.selectedDelivery};
}
export async function recoverCASEResult({directory,out}){
 const inputs=await pinnedInputs(resolve(directory));
 return receiveText(inputs.selectedText,out);
}
const HELP='CASE complete source and edition workflow\n\n'+
 'capture --file <source.json> --label <name> --out <new-directory>\n'+
 'capture --url <https://host/ims/case/v1p1/CFPackages/uuid> --label <name> --out <new-directory> [--authorization-env NAME] [--timeout-ms 30000]\n'+
 'compare --before <capture-directory> --after <capture-directory> --reviewer <name> --out <new-directory>\n'+
 'compare --before <capture-directory> --after <capture-directory> --review <complete-review.json> --out <new-directory>\n'+
 'receive --delivery <complete-delivery.json> --out <new-directory>\n'+
 'reproduce --case <complete-output-directory>\n'+
 'recover --case <interrupted-output-directory> --out <new-directory>\n\n'+
 'No publisher writes. Each source is limited to 1 MiB; complete generated/control files to 32 MiB.\n'+
 'HTTP loopback exercises require --allow-http-loopback. Authorization values come only from the named environment variable.\n';
function options(argv){
 const result={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!/^--[a-z][a-z-]*$/.test(key)||Object.hasOwn(result,key))fail('Unknown or repeated option.');
  if(key==='--allow-http-loopback'){result[key]=true;continue;}
  if(i+1===argv.length||argv[i+1].startsWith('--'))fail('Option requires a value: '+key);
  result[key]=argv[++i];
 }
 return result;
}
function exactOptions(o,allowed){for(const k of Object.keys(o))if(!allowed.includes(k))fail('Option does not apply: '+k);}
function required(o,k){if(typeof o[k]!=='string'||!o[k])fail('Required option: '+k);return o[k];}
export async function runCASECLI(argv){
 if(!argv.length||argv[0]==='help'||argv[0]==='--help'){process.stdout.write(HELP);return;}
 const [command,...rest]=argv,o=options(rest);let result;
 if(command==='capture'){
  exactOptions(o,['--file','--url','--label','--out','--authorization-env','--timeout-ms','--allow-http-loopback']);
  if(o['--file']&&(o['--authorization-env']||o['--timeout-ms']||o['--allow-http-loopback']))fail('HTTP options require a URL source.');
  result=await captureCASESource({file:o['--file'],url:o['--url'],label:required(o,'--label'),out:required(o,'--out'),authorizationEnv:o['--authorization-env'],timeoutMs:o['--timeout-ms']===undefined?undefined:Number(o['--timeout-ms']),allowHttpLoopback:!!o['--allow-http-loopback']});
 }else if(command==='compare'){
  exactOptions(o,['--before','--after','--review','--reviewer','--out']);
  result=await compareCASECaptures({before:required(o,'--before'),after:required(o,'--after'),review:o['--review']?await readJSON(o['--review'],16*MIB):undefined,reviewer:o['--reviewer'],out:required(o,'--out')});
 }else if(command==='receive'){
  exactOptions(o,['--delivery','--out']);
  result=await receiveCASEDelivery({deliveryText:await readText(required(o,'--delivery')),out:required(o,'--out')});
 }else if(command==='reproduce'){
  exactOptions(o,['--case']);result=await reproduceCASEResult(required(o,'--case'));
 }else if(command==='recover'){
  exactOptions(o,['--case','--out']);result=await recoverCASEResult({directory:required(o,'--case'),out:required(o,'--out')});
 }else fail('Unknown CASE command. Use --help.');
 process.stdout.write(json(result.directory?{directory:result.directory,manifest:result.manifest}:result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 runCASECLI(process.argv.slice(2)).catch(error=>{process.stderr.write(json({error:error.code??'CASE_OPERATION_FAILED',message:error.message}));process.exitCode=1;});
}
