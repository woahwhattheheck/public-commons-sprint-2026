#!/usr/bin/env node
// MIT. Turbolong original runtime, operating periods and complete receiving CLI.
import {promises as fs,createReadStream,createWriteStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {openTurbolongOperationsOperator,loadTurbolongOperationsConfiguration,TURBOLONG_OPERATIONS_METHODS} from './operator.mjs';
import {startTurbolongOperationsServer} from './server.mjs';
import {runTurbolongAcquisitionsWorker} from './worker.mjs';
import {buildTurbolongRuntime,retainTurbolongRuntime,verifyTurbolongRuntime,restoreTurbolongRuntime,bindTurbolongRuntime} from './runtime.mjs';
import {inspectTurbolongDelivery,receiveTurbolongDelivery} from './receiving.mjs';
import {streamTurbolongDelivery,unpackTurbolongDelivery} from './archive.mjs';
import {need,plain,integer,publicError} from './common.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const METHODS=new Map(TURBOLONG_OPERATIONS_METHODS.map(item=>[item.name.replace(/\./g,'-'),item.name]));
METHODS.set('state','workspace.describe');METHODS.set('methods','methods');
const FLAGS=new Set(['help']);
const HOST_OPTIONS=new Set(['workspace','connections-file','profile-file','host','port','expected-workspace-id','input','output','method','startup-format','file',
 'runtime-directory','expected-manifest-sha256','installation-directory','application-directory','source-directory','destination',
 'build-directory','source-capsule-file','build-targets','node-executable','npm-executable','cargo-executable','rustc-executable','stellar-executable',
 'node-heap-mb','cargo-jobs','include-rust-toolchain','include-tools','delivery-directory']);
const FIELDS={
 'request-id':'requestId','expected-revision':'expectedRevision','period-id':'periodId','period-version':'periodVersion',
 'vault-id':'vaultId','vault-version':'vaultVersion','acquisition-id':'acquisitionId','operation-id':'operationId','attempt-id':'attemptId',
 'source-id':'sourceId','incident-id':'incidentId','correction-id':'correctionId','analysis-id':'analysisId','report-id':'reportId',
 'runtime-id':'runtimeId','connection':'connection','action':'action','name':'name','kind':'kind','table':'table','after':'after',
 'limit':'limit','max-pages':'maxPages','version':'version','format':'format','filename':'filename','path':'path',
 'part':'part','index':'index','offset':'offset','length':'length','expected-sha256':'expectedSha256','observed-at':'observedAt',
 'source-directory':'sourceDirectory','destination':'destination','runtime-directory':'runtimeDirectory','expected-manifest-sha256':'expectedManifestSha256'
};
const NUMBERS=new Set(['expectedRevision','periodVersion','vaultVersion','version','limit','maxPages','index','offset','length']);
export const TURBOLONG_OPERATIONS_HELP="Turbolong operations\n\n  stellar-turbolong-operations serve --workspace /private/turbolong --connections-file /private/turbolong-connections.json --port 8779\n  stellar-turbolong-operations period-save --workspace /private/turbolong --file /private/period.json\n  stellar-turbolong-operations vault-save --workspace /private/turbolong --file /private/vault.json\n  stellar-turbolong-operations acquisition-save --workspace /private/turbolong --connections-file /private/turbolong-connections.json --file /private/acquisition.json\n  stellar-turbolong-operations acquisition-run --workspace /private/turbolong --connections-file /private/turbolong-connections.json --acquisition-id UUID --request-id UUID\n  stellar-turbolong-operations operation-prepare --workspace /private/turbolong --connections-file /private/turbolong-connections.json --input /private/operation.json\n  stellar-turbolong-operations operation-run --workspace /private/turbolong --connections-file /private/turbolong-connections.json --operation-id UUID --request-id UUID\n  stellar-turbolong-operations operation-reconcile --workspace /private/turbolong --connections-file /private/turbolong-connections.json --operation-id UUID\n  stellar-turbolong-operations source-import --workspace /private/turbolong --period-id UUID --kind keeper.harvest --name harvest.jsonl --file /private/keeper/harvest.jsonl\n  stellar-turbolong-operations analysis-create --workspace /private/turbolong --period-id UUID --name \"Operating period\"\n  stellar-turbolong-operations report-create --workspace /private/turbolong --analysis-id UUID --name \"Period report\"\n  stellar-turbolong-operations report-file --workspace /private/turbolong --report-id UUID --filename rate-snapshots.csv --output /private/rates.csv\n  stellar-turbolong-operations workspace-export --workspace /private/turbolong --connections-file /private/turbolong-connections.json --destination /private/delivery\n  stellar-turbolong-operations package-archive --source-directory /private/delivery --output /private/delivery.tar.gz\n  stellar-turbolong-operations package-unpack --file /private/delivery.tar.gz --destination /private/received-source\n  stellar-turbolong-operations package-receive --source-directory /private/received-source --destination /private/independent-operations --request-id UUID\n\nOriginal runtime:\n  stellar-turbolong-operations runtime-build --installation-directory /private/turbolong-source --source-capsule-file /private/turbolong-original-source.json --runtime-directory /private/turbolong-runtime --node-heap-mb 512 --cargo-jobs 1\n  stellar-turbolong-operations runtime-retain --installation-directory /private/turbolong-source --runtime-directory /private/turbolong-runtime\n  stellar-turbolong-operations runtime-restore --source-directory /private/runtime-source --destination /private/runtime-restored --expected-manifest-sha256 SHA256\n  stellar-turbolong-operations runtime-bind --runtime-directory /private/runtime-restored --application-directory /private/received-application\n\nCommands:\n  methods, catalogue, state, records-page, profile-save\n  period-save, period-read, vault-save, vault-read\n  acquisition-save, acquisition-read, acquisition-start, acquisition-pause, acquisition-run, worker\n  operation-prepare, operation-read, operation-run, operation-collect, operation-reconcile\n  operation-pause, operation-resume, operation-cancel\n  source-import, source-read, source-file\n  incident-save, incident-read, correction-save, correction-read\n  analysis-create, analysis-read, analysis-file, report-create, report-read, report-file\n  workspace-export, report-export, package-inspect, package-receive, package-archive, package-unpack\n  runtime-build, runtime-retain, runtime-verify, runtime-inspect, runtime-restore, runtime-bind\n\nEvery method is also available with invoke --method NAME --input /private/request.json.\n--input reads the complete JSON argument body; a lone \"-\" reads standard input.\nFor period/vault/acquisition-save, --file reads the definition. For incident/correction-save,\n--file reads that complete entry. For source-import, --file retains the complete raw file.\nProfile settings use profile-save --file. JSON arrays and native arguments remain in --input.\n\nWrites retain --request-id and --expected-revision. The CLI fills only missing values and\nprints their selection to stderr before dispatch. Keep that UUID/body for an uncertain retry.\noperation-collect follows every provider page unless --max-pages is explicitly supplied.\nacquisition-start schedules saved read-only queries; serve or worker carries the schedule.\nPause preserves the full cursor. Received schedules and unresolved native operations are paused.\nAn uncertain keeper write is reconciled through its original execution custody; it is not sent again.\n\nRuntime builds use the selected original source and its existing scripts, Cargo manifests and locks.\nSelect --build-targets scripts,binaries,contracts,frontend,alerts,cargo-sources when needed.\nTool paths can be supplied with --node-executable, --npm-executable, --cargo-executable,\n--rustc-executable and --stellar-executable. --node-heap-mb defaults to 512 and --cargo-jobs to 1.\nruntime-retain supports --include-rust-toolchain true|false and full options via --input.\nThe operator link printed by serve contains a private access token. Keep the link with the operator.\nPrivate keys, history roots, execution directories and runtime paths belong in private connection files.\n";
function parse(argv){
 const result={command:null,options:{}};for(let i=0;i<argv.length;i++){
  const token=argv[i];if(token==='-h'){result.options.help=true;continue;}
  if(!token.startsWith('--')){need(!result.command,'INVALID_OPTION','Use a single native command.');result.command=token;continue;}
  const equals=token.indexOf('='),key=token.slice(2,equals<0?undefined:equals);
  need(FLAGS.has(key)||HOST_OPTIONS.has(key)||Object.hasOwn(FIELDS,key),'INVALID_OPTION','Unknown option --'+key+'.');
  need(!Object.hasOwn(result.options,key),'INVALID_OPTION','Supply --'+key+' once.');
  if(FLAGS.has(key)){need(equals<0,'INVALID_OPTION','This option has no value.');result.options[key]=true;continue;}
  const value=equals>=0?token.slice(equals+1):argv[++i];need(typeof value==='string'&&value.length>0,'INVALID_OPTION','Supply a value for --'+key+'.');
  result.options[key]=value;
 }return result;
}
async function inputJSON(file){
 const body=file==='-'?await new Promise((done,reject)=>{const chunks=[];process.stdin.on('data',part=>chunks.push(part));process.stdin.once('end',()=>done(Buffer.concat(chunks).toString('utf8')));process.stdin.once('error',reject);}):await fs.readFile(resolve(file),'utf8');
 const value=JSON.parse(body);need(plain(value),'INVALID_ARGUMENT','Supply a complete original JSON object.');return value;
}
function number(value,name,min=0,max=Number.MAX_SAFE_INTEGER){need(/^\d+$/.test(String(value)),'INVALID_OPTION','Use an integer for '+name+'.');const n=Number(value);integer(n,name,min,max);return n;}
async function writeJSON(filename,value){
 const body=Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(!filename){process.stdout.write(body);return;}
 const path=resolve(filename);await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
 const handle=await fs.open(path,'wx',0o600);try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
 process.stdout.write(JSON.stringify({file:path,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')})+'\n');
}
async function download(operator,method,args,destination){
 const path=resolve(destination);await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
 const handle=await fs.open(path,'wx',0o600);let first=null,offset=0;const digest=createHash('sha256');
 try{
  while(true){
   const page=await operator.invoke({method,args:{...args,offset,length:196608}});
   if(!first)first=page;
   need(page.sha256===first.sha256&&page.bytes===first.bytes,'SOURCE_CHANGED','The original file selection changed during transfer.');
   const bytes=Buffer.from(page.contentBase64,'base64');need(bytes.length>0||offset===first.bytes,'SOURCE_CHANGED','The original file stopped before its declared end.');
   if(bytes.length){await handle.writeFile(bytes);digest.update(bytes);offset+=bytes.length;}
   if(offset===first.bytes)break;need(offset<first.bytes,'SOURCE_CHANGED','The original transfer exceeded its declared size.');
  }
  need(digest.digest('hex')===first.sha256,'SOURCE_CHANGED','The complete downloaded file differs from its original descriptor.');
  await handle.sync();return {path,bytes:offset,sha256:first.sha256,contentType:first.contentType};
 }finally{await handle.close();}
}

async function fileDigest(file){
 const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'INVALID_SOURCE','Select a regular original file.');
 const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex');
}
function put(target,key,value){if(value===undefined)return;need(target[key]===undefined||JSON.stringify(target[key])===JSON.stringify(value),'INVALID_OPTION','The '+key+' selection is supplied differently twice.');target[key]=value;}
export async function runTurbolongOperationsCLI(argv=process.argv.slice(2)){
 const {command,options:o}=parse(argv);
 if(o.help||!command||command==='help'){process.stdout.write(TURBOLONG_OPERATIONS_HELP);return {help:true};}
 const controller=new AbortController(),stop=()=>controller.abort(new Error('Operator interrupted'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  if(command.startsWith('runtime-')){
   const selected=o.input?await inputJSON(o.input):{};
   for(const [flag,key]of Object.entries({'installation-directory':'installationDirectory','runtime-directory':'directory','source-directory':'sourceDirectory',
    'destination':'destination','application-directory':'applicationDirectory','build-directory':'buildDirectory','source-capsule-file':'sourceCapsuleFile'}))
    if(o[flag])put(selected,key,resolve(o[flag]));
   if(o['expected-manifest-sha256'])put(selected,'expectedManifestSha256',o['expected-manifest-sha256']);
   for(const [flag,key]of Object.entries({'node-executable':'nodeExecutable','npm-executable':'npmExecutable','cargo-executable':'cargoExecutable',
    'rustc-executable':'rustcExecutable','stellar-executable':'stellarExecutable'}))if(o[flag])put(selected,key,o[flag]);
   if(o['build-targets'])put(selected,'buildTargets',o['build-targets'].split(',').map(item=>item.trim()).filter(Boolean));
   if(o['include-tools'])put(selected,'includeTools',o['include-tools'].split(',').map(item=>item.trim()).filter(Boolean));
   if(o['node-heap-mb'])put(selected,'nodeHeapMB',number(o['node-heap-mb'],'node-heap-mb',256,65536));
   if(o['cargo-jobs'])put(selected,'cargoJobs',number(o['cargo-jobs'],'cargo-jobs',1,256));
   if(o['include-rust-toolchain']){need(['true','false'].includes(o['include-rust-toolchain']),'INVALID_OPTION','Use true or false for --include-rust-toolchain.');put(selected,'includeRustToolchain',o['include-rust-toolchain']==='true');}
   selected.signal=controller.signal;selected.progress=event=>process.stderr.write(JSON.stringify(event)+'\n');
   let result;
   if(command==='runtime-build'){
    need(selected.installationDirectory,'INVALID_OPTION','Select --installation-directory.');selected.nodeHeapMB??=512;selected.cargoJobs??=1;
    result=await buildTurbolongRuntime(selected);
   }else if(command==='runtime-retain')result=await retainTurbolongRuntime(selected);
   else if(['runtime-verify','runtime-inspect'].includes(command))result=await verifyTurbolongRuntime(selected);
   else if(command==='runtime-restore')result=await restoreTurbolongRuntime(selected);
   else if(command==='runtime-bind')result=await bindTurbolongRuntime(selected);
   else need(false,'INVALID_COMMAND','Choose a declared runtime command.');
   await writeJSON(o.output,result);return result;
  }
  if(command==='package-archive'){
   need(o['source-directory']&&o.output,'INVALID_OPTION','Select the source directory and output archive.');
   const stream=await streamTurbolongDelivery({sourceDirectory:resolve(o['source-directory']),expectedManifestSha256:o['expected-manifest-sha256'],signal:controller.signal});
   await fs.mkdir(dirname(resolve(o.output)),{recursive:true,mode:0o700});
   await pipeline(stream,createWriteStream(resolve(o.output),{flags:'wx',mode:0o600}),{signal:controller.signal});
   const result={path:resolve(o.output),bytes:(await fs.stat(resolve(o.output))).size};process.stdout.write(JSON.stringify(result)+'\n');return result;
  }
  if(command==='package-unpack'){
   need(o.file&&o.destination,'INVALID_OPTION','Select the archive and source destination.');
   const result=await unpackTurbolongDelivery({input:createReadStream(resolve(o.file)),destination:resolve(o.destination),expectedManifestSha256:o['expected-manifest-sha256'],signal:controller.signal});
   await writeJSON(o.output,result);return result;
  }
  let args=o.input?await inputJSON(o.input):{};
  for(const [flag,field]of Object.entries(FIELDS))if(Object.hasOwn(o,flag)){
   const value=NUMBERS.has(field)?number(o[flag],flag):o[flag];
   put(args,field,['sourceDirectory','destination','runtimeDirectory'].includes(field)?resolve(value):value);
  }
  const method=command==='invoke'?o.method:METHODS.get(command);
  if(method==='package.inspect'||method==='package.receive'){
   if(method==='package.receive')args.requestId??=randomUUID();
   const result=method==='package.inspect'?await inspectTurbolongDelivery(args):await receiveTurbolongDelivery(args);await writeJSON(o.output,result);return result;
  }
  need(o.workspace,'WORKSPACE_REQUIRED','Select --workspace.');
  const workspaceDirectory=resolve(o.workspace);
  const configuration=await loadTurbolongOperationsConfiguration({workspaceDirectory,
   connectionsFile:o['connections-file']?resolve(o['connections-file']):undefined,profileFile:o['profile-file']?resolve(o['profile-file']):undefined,
   runtimeDirectory:o['runtime-directory']?resolve(o['runtime-directory']):undefined,expectedManifestSha256:o['expected-manifest-sha256'],
   installationDirectory:o['installation-directory']?resolve(o['installation-directory']):undefined});
  if(command==='serve'){
   need(!o['startup-format']||o['startup-format']==='json','INVALID_OPTION','Use --startup-format json.');
   const application=await startTurbolongOperationsServer({workspaceDirectory,configuration,expectedWorkspaceId:o['expected-workspace-id'],
    host:o.host??'127.0.0.1',port:number(o.port??8779,'port',0,65535),signal:controller.signal,
    connectionsFile:o['connections-file']?resolve(o['connections-file']):null,profileFile:o['profile-file']?resolve(o['profile-file']):null,
    deliveryDirectory:o['delivery-directory']?resolve(o['delivery-directory']):undefined,
    runtimeDirectory:o['runtime-directory']?resolve(o['runtime-directory']):undefined,expectedManifestSha256:o['expected-manifest-sha256'],
    installationDirectory:o['installation-directory']?resolve(o['installation-directory']):undefined,
    applicationDirectory:o['application-directory']?resolve(o['application-directory']):HERE});
   process.stdout.write(JSON.stringify(application.startup)+'\n');
   await new Promise(done=>{if(controller.signal.aborted)done();else controller.signal.addEventListener('abort',done,{once:true});});
   await application.close();return application.startup;
  }
  const operator=await openTurbolongOperationsOperator({workspaceDirectory,configuration,expectedWorkspaceId:o['expected-workspace-id'],signal:controller.signal,
   applicationDirectory:o['application-directory']?resolve(o['application-directory']):HERE});
  try{
   if(command==='worker'){await runTurbolongAcquisitionsWorker({workspace:operator.workspace,signal:controller.signal,
    onProgress:event=>process.stdout.write(JSON.stringify(event)+'\n')});return {stopped:true};}
   if(method==='methods'){const result=await operator.methods();await writeJSON(o.output,result);return result;}
   need(method,'INVALID_COMMAND','Choose a declared command or invoke --method.');
   const spec=TURBOLONG_OPERATIONS_METHODS.find(row=>row.name===method);need(spec,'INVALID_COMMAND','The operator method is unavailable.');
   if(o.file&&method!=='source.import'){
    const value=await inputJSON(o.file);
    if(['period.save','vault.save','acquisition.save'].includes(method))put(args,'definition',value);
    else if(method==='profile.save')put(args,'profile',value);
    else if(method==='incident.save')put(args,'incident',value);
    else if(method==='correction.save')put(args,'correction',value);
    else need(false,'INVALID_OPTION','Use --input for a complete method argument body.');
   }
   if(spec.mutates){args.requestId??=randomUUID();if(spec.required.includes('expectedRevision'))args.expectedRevision??=(await operator.workspace.readState()).revision;
    process.stderr.write(JSON.stringify({method,requestId:args.requestId,expectedRevision:args.expectedRevision})+'\n');}
   const isFile=['source.file','analysis.file','report.file'].includes(method);
   let result;
   if(method==='source.import'&&o.file){
    const file=resolve(o.file),sha256=await fileDigest(file);put(args,'expectedSha256',sha256);
    result=await operator.importSource(args,{file});
   }else result=o.output&&isFile?await download(operator,method,args,o.output):await operator.invoke({method,args});
   await writeJSON(o.output&&isFile?undefined:o.output,result);return result;
  }finally{await operator.close();}
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
export async function main(argv=process.argv.slice(2)){
 try{return await runTurbolongOperationsCLI(argv);}catch(error){process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;return null;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
