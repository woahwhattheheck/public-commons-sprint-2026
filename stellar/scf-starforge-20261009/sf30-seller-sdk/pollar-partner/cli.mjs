#!/usr/bin/env node
// MIT. Complete Pollar partner source build, operating workspace and receiving CLI.
import {promises as fs} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {openPollarPartnerOperator,loadPollarPartnerConfiguration,POLLAR_PARTNER_METHODS,readPollarPrivateJSON} from './operator.mjs';
import {startPollarPartnerServer} from './server.mjs';
import {buildPollarRuntime,retainPollarRuntime,verifyPollarRuntime,restorePollarRuntime,bindPollarRuntime} from './runtime.mjs';
import {inspectPollarDelivery,receivePollarDelivery} from './receiving.mjs';
import {streamPollarDelivery,unpackPollarDelivery} from './archive.mjs';
import {pipeline} from 'node:stream/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {need,plain,integer,publicError} from './common.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const METHODS=new Map(POLLAR_PARTNER_METHODS.map(item=>[item.name.replace(/\./g,'-'),item.name]));
METHODS.set('state','workspace.describe');METHODS.set('catalogue','catalogue');METHODS.set('methods','methods');
const FLAGS=new Set(['help']);
const HOST_OPTIONS=new Set(['workspace','connections-file','profile-file','host','port','expected-workspace-id','input','output','method','startup-format','file',
 'runtime-directory','expected-manifest-sha256','installation-directory','application-directory','source-directory','destination','npm-executable','node-heap-mb','access-token-file']);
const FIELDS={
 'request-id':'requestId','expected-revision':'expectedRevision','application-id':'applicationId','application-version':'applicationVersion',
 'participant-id':'participantId','operation-id':'operationId','attempt-id':'attemptId','source-id':'sourceId','snapshot-id':'snapshotId','report-id':'reportId',
 'runtime-id':'runtimeId','connection':'connection','action':'action','mode':'mode','name':'name','table':'table','after':'after','limit':'limit','max-pages':'maxPages',
 'version':'version','format':'format','part':'part','offset':'offset','length':'length','decision':'decision','note':'note',
 'source-directory':'sourceDirectory','destination':'destination','runtime-directory':'runtimeDirectory','expected-manifest-sha256':'expectedManifestSha256'
};
const NUMBERS=new Set(['expectedRevision','applicationVersion','version','limit','maxPages','offset','length']);
export const POLLAR_PARTNER_HELP="Pollar partner workspace\n\n  stellar-pollar-partner runtime-build --installation-directory /private/pollar-sdk --runtime-directory /private/pollar-runtime --node-heap-mb 512\n  stellar-pollar-partner serve --workspace /private/partner-workspace --connections-file /private/partner-connections.json --port 8778\n  stellar-pollar-partner application-save --workspace /private/partner-workspace --connections-file /private/partner-connections.json --input /private/application.json\n  stellar-pollar-partner operation-prepare --workspace /private/partner-workspace --connections-file /private/partner-connections.json --input /private/operation.json\n  stellar-pollar-partner operation-run --workspace /private/partner-workspace --connections-file /private/partner-connections.json --operation-id UUID\n  stellar-pollar-partner operation-collect --workspace /private/partner-workspace --connections-file /private/partner-connections.json --operation-id UUID --request-id UUID\n  stellar-pollar-partner operation-reconcile --workspace /private/partner-workspace --connections-file /private/partner-connections.json --operation-id UUID\n  stellar-pollar-partner source-file --workspace /private/partner-workspace --source-id UUID --part response --output /private/provider-response.bin\n  stellar-pollar-partner workspace-export --workspace /private/partner-workspace --connections-file /private/partner-connections.json --destination /private/delivery\n  stellar-pollar-partner package-archive --source-directory /private/delivery --output /private/delivery.tar.gz\n  stellar-pollar-partner package-unpack --file /private/delivery.tar.gz --destination /private/received-source\n  stellar-pollar-partner package-receive --source-directory /private/received-source --destination /private/independent-partner --request-id UUID\n\nNative commands:\n  methods, catalogue, state, records-page, profile-save\n  application-save, application-read, participant-verify\n  operation-prepare, operation-read, operation-run, operation-collect\n  operation-reconcile, operation-pause, operation-resume, operation-cancel\n  browser-start, browser-outcome, browser-observed\n  source-read, source-file, snapshot-create, snapshot-read, decision-save\n  report-create, report-read, report-file, workspace-export, report-export\n  package-inspect, package-receive, package-archive, package-unpack\n  runtime-build, runtime-retain, runtime-verify, runtime-restore, runtime-bind\n\nEvery original operator method is also available as:\n  stellar-pollar-partner invoke --workspace /private/partner-workspace --method operation.prepare --input /private/request.json\n\n--input reads a complete original JSON body. A lone \"-\" reads standard input.\nUse --file for a public application configuration, complete profile or original archive.\nA write request retains --request-id; --expected-revision selects the original workspace revision.\nThe CLI fills those fields only when omitted. Retrying the same request preserves its native identity.\noperation-collect follows every original page unless --max-pages is explicitly supplied.\nCustomer sign-in, wallet signing, passkeys and payments run in /portal through the original browser SDK.\nThe operator link printed by serve contains its private token. Keep it with the operator.\nPrivate server keys, MCP PATs and original runtime paths belong in the owner-readable connection file.\nparticipant-verify accepts --access-token-file for an ephemeral SDK token; no token value is stored in its request.\nRuntime build executes the unchanged original npm lock and selected SDK build scripts, then retains the complete graph.\n";
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
export async function runPollarPartnerCLI(argv=process.argv.slice(2)){
 const {command,options:o}=parse(argv);
 if(o.help||!command||command==='help'){process.stdout.write(POLLAR_PARTNER_HELP);return {help:true};}
 const controller=new AbortController(),stop=()=>controller.abort(new Error('Operator interrupted'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  if(command.startsWith('runtime-')){
   const common={...(o['installation-directory']?{installationDirectory:resolve(o['installation-directory'])}:{}),
    ...(o['runtime-directory']?{directory:resolve(o['runtime-directory'])}:{}),
    ...(o['expected-manifest-sha256']?{expectedManifestSha256:o['expected-manifest-sha256']}:{}),
    ...(o['source-directory']?{sourceDirectory:resolve(o['source-directory'])}:{}),
    ...(o.destination?{destination:resolve(o.destination)}:{}),
    ...(o['application-directory']?{applicationDirectory:resolve(o['application-directory'])}:{})};
   let result;
   if(command==='runtime-build'){
    need(common.installationDirectory&&common.directory,'INVALID_OPTION','Select --installation-directory and --runtime-directory.');
    result=await buildPollarRuntime({...common,npmExecutable:o['npm-executable']??'npm',nodeHeapMB:number(o['node-heap-mb']??512,'node-heap-mb',128,32768),
     signal:controller.signal,progress:event=>process.stderr.write(JSON.stringify(event)+'\n')});
   }else if(command==='runtime-retain')result=await retainPollarRuntime(common);
   else if(['runtime-verify','runtime-inspect'].includes(command))result=await verifyPollarRuntime(common);
   else if(command==='runtime-restore')result=await restorePollarRuntime(common);
   else if(command==='runtime-bind')result=await bindPollarRuntime(common);
   else need(false,'INVALID_COMMAND','Choose a declared original runtime command.');
   await writeJSON(o.output,result);return result;
  }
  if(command==='package-archive'){
   need(o['source-directory']&&o.output,'INVALID_OPTION','Select the original source directory and output archive.');
   const stream=await streamPollarDelivery({sourceDirectory:resolve(o['source-directory']),expectedManifestSha256:o['expected-manifest-sha256'],signal:controller.signal});
   await fs.mkdir(dirname(resolve(o.output)),{recursive:true,mode:0o700});
   await pipeline(stream,createWriteStream(resolve(o.output),{flags:'wx',mode:0o600}),{signal:controller.signal});
   const result={path:resolve(o.output),bytes:(await fs.stat(resolve(o.output))).size};process.stdout.write(JSON.stringify(result)+'\n');return result;
  }
  if(command==='package-unpack'){
   need(o.file&&o.destination,'INVALID_OPTION','Select the original archive and independent source destination.');
   const result=await unpackPollarDelivery({input:createReadStream(resolve(o.file)),destination:resolve(o.destination),expectedManifestSha256:o['expected-manifest-sha256'],signal:controller.signal});
   await writeJSON(o.output,result);return result;
  }
  let args=o.input?await inputJSON(o.input):{};
  for(const [flag,field]of Object.entries(FIELDS))if(Object.hasOwn(o,flag)){
   const value=NUMBERS.has(field)?number(o[flag],flag):o[flag];
   need(args[field]===undefined||JSON.stringify(args[field])===JSON.stringify(value),'INVALID_OPTION','The original '+field+' is supplied differently twice.');
   args[field]=['sourceDirectory','destination','runtimeDirectory'].includes(field)?resolve(value):value;
  }
  const method=command==='invoke'?o.method:METHODS.get(command);
  if(method==='package.inspect'||method==='package.receive'){
   if(method==='package.receive')args.requestId??=randomUUID();
   const result=method==='package.inspect'?await inspectPollarDelivery(args):await receivePollarDelivery(args);await writeJSON(o.output,result);return result;
  }
  need(o.workspace,'WORKSPACE_REQUIRED','Select --workspace for the complete original operating workspace.');
  const workspaceDirectory=resolve(o.workspace);
  const configuration=await loadPollarPartnerConfiguration({workspaceDirectory,
   connectionsFile:o['connections-file']?resolve(o['connections-file']):undefined,profileFile:o['profile-file']?resolve(o['profile-file']):undefined,
   runtimeDirectory:o['runtime-directory']?resolve(o['runtime-directory']):undefined,expectedManifestSha256:o['expected-manifest-sha256'],
   installationDirectory:o['installation-directory']?resolve(o['installation-directory']):undefined});
  if(command==='serve'){
   need(!o['startup-format']||o['startup-format']==='json','INVALID_OPTION','Use --startup-format json.');
   const application=await startPollarPartnerServer({workspaceDirectory,configuration,expectedWorkspaceId:o['expected-workspace-id'],
    host:o.host??'127.0.0.1',port:number(o.port??8778,'port',0,65535),signal:controller.signal,
    connectionsFile:o['connections-file']?resolve(o['connections-file']):null,profileFile:o['profile-file']?resolve(o['profile-file']):null,
    applicationDirectory:o['application-directory']?resolve(o['application-directory']):HERE});
   process.stdout.write(JSON.stringify(application.startup)+'\n');
   await new Promise(done=>{if(controller.signal.aborted)done();else controller.signal.addEventListener('abort',done,{once:true});});
   await application.close();return application.startup;
  }
  const operator=await openPollarPartnerOperator({workspaceDirectory,configuration,expectedWorkspaceId:o['expected-workspace-id'],signal:controller.signal,
   applicationDirectory:o['application-directory']?resolve(o['application-directory']):HERE});
  try{
   if(method==='methods'){const result=await operator.methods();await writeJSON(o.output,result);return result;}
   need(method,'INVALID_COMMAND','Choose a declared native command or invoke --method.');
   const spec=POLLAR_PARTNER_METHODS.find(row=>row.name===method);need(spec,'INVALID_COMMAND','The operator method is unavailable.');
   if(o.file){
    const file=await inputJSON(o.file);
    if(method==='application.save')args.configuration??=file;
    else if(method==='profile.save')args.profile??=file;
    else need(false,'INVALID_OPTION','Use --input for complete original operation arguments.');
   }
   if(spec.mutates){args.requestId??=randomUUID();args.expectedRevision??=(await operator.workspace.readState()).revision;}
   const ephemeral={};
   if(o['access-token-file']){
    need(method==='participant.verify','INVALID_OPTION','An ephemeral SDK access token is used only by participant-verify.');
    const privateToken=await readPollarPrivateJSON(resolve(o['access-token-file']),{workspaceDirectory});
    need(typeof privateToken.accessToken==='string','INVALID_ARGUMENT','The private token file must contain accessToken.');ephemeral.accessToken=privateToken.accessToken;
   }
   const result=o.output&&['source.file','report.file'].includes(method)?await download(operator,method,args,o.output):await operator.invoke({method,args,ephemeral});
   await writeJSON(o.output&&['source.file','report.file'].includes(method)?undefined:o.output,result);return result;
  }finally{await operator.close();}
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
export async function main(argv=process.argv.slice(2)){
 try{return await runPollarPartnerCLI(argv);}catch(error){process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;return null;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
