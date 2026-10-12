#!/usr/bin/env node
// MIT. Complete terminal entry for Fuul commissioning and settlement operations.
import {promises as fs} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openFuulProgrammesOperator,loadFuulProgrammesConfiguration,FUUL_PROGRAMMES_METHODS} from './operator.mjs';
import {inspectFuulDelivery,receiveFuulDelivery} from './receiving.mjs';
import {startFuulProgrammesServer} from './server.mjs';
import {buildFuulRuntime,retainFuulRuntime,verifyFuulRuntime,restoreFuulRuntime,bindFuulRuntime} from './runtime.mjs';
import {need,plain,integer,publicError} from './common.mjs';
const ALIASES={
  "workspace-describe": "workspace.describe",
  "workspace-list": "workspace.list",
  "workspace-profile": "workspace.profile",
  "workspace-history": "workspace.history",
  "request-status": "request.status",
  "programme-save": "programme.save",
  "programme-read": "programme.read",
  "source-catalog": "source.catalog",
  "action-catalog": "action.catalog",
  "source-import": "source.import",
  "source-project": "source.project",
  "source-read": "source.read",
  "source-file": "source.file",
  "capture-start": "capture.start",
  "capture-read": "capture.read",
  "capture-next": "capture.next",
  "capture-run": "capture.run",
  "capture-pause": "capture.pause",
  "capture-resume": "capture.resume",
  "event-prepare": "event.prepare",
  "event-observe": "event.observe",
  "batch-prepare": "batch.prepare",
  "queue-read": "queue.read",
  "queue-file": "queue.file",
  "queue-next": "queue.next",
  "queue-pause": "queue.pause",
  "queue-resume": "queue.resume",
  "queue-resolve": "queue.resolve",
  "action-prepare": "action.prepare",
  "run-start": "run.start",
  "run-read": "run.read",
  "run-execute": "run.execute",
  "run-pause": "run.pause",
  "run-resume": "run.resume",
  "decision-save": "decision.save",
  "decision-read": "decision.read",
  "reconciliation-create": "reconciliation.create",
  "edition-read": "edition.read",
  "edition-file": "edition.file",
  "reconciliation-compare": "reconciliation.compare",
  "report-create": "report.create",
  "report-read": "report.read",
  "report-file": "report.file",
  "workspace-export": "workspace.export",
  "report-export": "report.export",
  "package-inspect": "package.inspect",
  "package-receive": "package.receive",
  "state": "workspace.describe",
  "history": "workspace.history",
  "profile-save": "workspace.profile",
  "reconcile": "reconciliation.create",
  "edition": "edition.read",
  "compare": "reconciliation.compare"
};

const FIELDS={
  "request-id": "requestId",
  "expected-revision": "expectedRevision",
  "expected-version": "expectedVersion",
  "programme-id": "programmeId",
  "programme-version": "programmeVersion",
  "capture-id": "captureId",
  "source-id": "sourceId",
  "report-id": "reportId",
  "record-id": "recordId",
  "event-id": "eventId",
  "batch-id": "batchId",
  "action-id": "actionId",
  "attempt-id": "attemptId",
  "run-id": "runId",
  "decision-id": "decisionId",
  "reconciliation-id": "reconciliationId",
  "project-id": "projectId",
  "user-identifier": "userIdentifier",
  "connection-alias": "connectionAlias",
  "source-directory": "sourceDirectory",
  "expected-manifest-sha256": "expectedManifestSha256",
  "left-id": "leftId",
  "right-id": "rightId",
  "include-application": "includeApplication",
  "source-scope": "sourceScope",
  "mapping-id": "mappingId",
  "batch-size": "batchSize",
  "records-path": "recordsPath",
  "id": "id",
  "table": "table",
  "section": "section",
  "version": "version",
  "name": "name",
  "kind": "kind",
  "destination": "destination",
  "filename": "filename",
  "provider": "provider",
  "part": "part",
  "offset": "offset",
  "length": "length",
  "limit": "limit",
  "network": "network",
  "format": "format",
  "action": "action",
  "actor": "actor",
  "reason": "reason",
  "outcome": "outcome",
  "supersedes": "supersedes",
  "operation": "operation",
  "query": "query",
  "status": "status"
};

const INTEGERS=new Set(['expectedRevision','expectedVersion','programmeVersion','version','offset','length','limit','batchSize']);
const BOOL=new Set(['help','include-application','resume-original']);
const OPTION_NAMES=new Set(['workspace','connections-file','profile-file','expected-workspace-id','host','port','startup-format',
  'input','method','file','output','help','resume-original','installation-directory','runtime-directory','application-directory','bun-executable','npm-executable',...Object.keys(FIELDS)]);
export const FUUL_PROGRAMMES_HELP="Stellar Fuul programme operator\n\nStart and keep the same browser origin when reopening:\n  stellar-fuul-programmes serve --workspace /absolute/workspace --connections-file /private/connections.json --port 8776\n  stellar-fuul-programmes programme-save --workspace /absolute/workspace --file /absolute/programme.json\n\nWhole programme operations:\n  stellar-fuul-programmes methods\n  stellar-fuul-programmes invoke --workspace /absolute/workspace --method capture.start --input /absolute/capture.json\n  stellar-fuul-programmes capture-run --workspace /absolute/workspace --capture-id UUID --resume-original\n  stellar-fuul-programmes event-prepare --workspace /absolute/workspace --input /absolute/mapping-request.json\n  stellar-fuul-programmes run-start --workspace /absolute/workspace --programme-id UUID --kind event-delivery\n  stellar-fuul-programmes run-execute --workspace /absolute/workspace --run-id UUID --resume-original\n  stellar-fuul-programmes run-start --workspace /absolute/workspace --programme-id UUID --kind event-observation\n  stellar-fuul-programmes action-prepare --workspace /absolute/workspace --input /absolute/original-action.json\n  stellar-fuul-programmes reconcile --workspace /absolute/workspace --programme-id UUID\n  stellar-fuul-programmes report-create --workspace /absolute/workspace --reconciliation-id UUID\n  stellar-fuul-programmes report-file --workspace /absolute/workspace --report-id UUID --format csv --output /absolute/report.csv\n\nComplete receiving:\n  stellar-fuul-programmes workspace-export --workspace /absolute/workspace --connections-file /private/connections.json --destination /absolute/delivery\n  stellar-fuul-programmes package-inspect --source-directory /absolute/delivery\n  stellar-fuul-programmes package-receive --source-directory /absolute/delivery --destination /absolute/client --request-id UUID\n\nOriginal source-built SDK:\n  stellar-fuul-programmes runtime-build --source-directory /absolute/original-sdk --installation-directory /absolute/installed --destination /absolute/retained-runtime\n  stellar-fuul-programmes runtime-verify --runtime-directory /absolute/retained-runtime\n  stellar-fuul-programmes runtime-restore --source-directory /absolute/retained-runtime --destination /absolute/restored\n  stellar-fuul-programmes runtime-bind --runtime-directory /absolute/retained-runtime --application-directory /absolute/application\n\nUse --input FILE or --input - for complete JSON arguments. Every mutation accepts an original --request-id UUID and --expected-revision.\n--resume-original restores a retained capture, dispatch or complete-run request.\n--startup-format json returns the full native startup record.\nFile --output streams the complete original file; an explicit offset or length selects a range.\nCommands: workspace-describe, workspace-list, workspace-profile, workspace-history, request-status, programme-save, programme-read, source-catalog, action-catalog, source-import, source-project, source-read, source-file, capture-start, capture-read, capture-next, capture-run, capture-pause, capture-resume, event-prepare, event-observe, batch-prepare, queue-read, queue-file, queue-next, queue-pause, queue-resume, queue-resolve, action-prepare, run-start, run-read, run-execute, run-pause, run-resume, decision-save, decision-read, reconciliation-create, edition-read, edition-file, reconciliation-compare, report-create, report-read, report-file, workspace-export, report-export, package-inspect, package-receive, state, history, profile-save, reconcile, edition, compare\n";

function options(argv){
  const args=[...argv],command=args.shift()??'help',out={};
  if(command==='--help'||command==='-h')return {command:'help',options:{}};
  while(args.length){
    const argument=args.shift();need(argument.startsWith('--'),'INVALID_ARGUMENT','Use named --options.');
    const equal=argument.indexOf('='),key=argument.slice(2,equal<0?undefined:equal);
    need(OPTION_NAMES.has(key),'UNKNOWN_OPTION','Unknown option --'+key+'.');
    need(!Object.hasOwn(out,key),'DUPLICATE_OPTION','Select --'+key+' once.');
    if(BOOL.has(key)){
      const value=equal<0?true:argument.slice(equal+1);
      need(value===true||value==='true'||value==='false','INVALID_ARGUMENT','Use true or false for --'+key+'.');
      out[key]=value===true||value==='true';
    }else{
      const value=equal<0?args.shift():argument.slice(equal+1);
      need(typeof value==='string'&&value&&!value.startsWith('--'),'MISSING_ARGUMENT','Supply a value for --'+key+'.');
      out[key]=value;
    }
  }
  return {command,options:out};
}
function numeric(value,name){
  need(/^\d+$/.test(String(value)),'INVALID_ARGUMENT',name+' must be a nonnegative integer.');
  const number=Number(value);integer(number,name);return number;
}
async function inputFile(path,stdin){
  if(!path)return {};
  const body=path==='-'?await (async()=>{const chunks=[];for await(const chunk of stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);})():await fs.readFile(resolve(path));
  const value=JSON.parse(body.toString('utf8'));need(plain(value),'INVALID_ARGUMENT','The input must contain a JSON argument object.');return value;
}

async function writeDownload(host,method,args,output,{complete=true}={}){
  const path=resolve(output),handle=await fs.open(path,'wx',0o600);let total=0,last=null,okay=false;
  try{
    let offset=args.offset??0,original=null;
    for(;;){
      const result=await host.invoke({method,args:{...args,offset,length:args.length??4*1024*1024}});
      need(typeof result.base64==='string','INVALID_FILE','The operator did not return original file bytes.');
      const body=Buffer.from(result.base64,'base64');
      need(body.toString('base64')===result.base64&&result.bytes===body.length&&result.offset===offset,'INVALID_FILE','The returned original file range differs.');
      if(original)need(result.file.sha256===original.sha256&&result.file.bytes===original.bytes,'SOURCE_CHANGED','The selected original file changed during download.');
      original??=result.file;await handle.writeFile(body);total+=body.length;last=result;
      if(!complete||result.eof)break;
      need(body.length>0,'INVALID_FILE','The original file range did not advance.');offset+=body.length;
    }
    await handle.sync();okay=true;
    return {...last,base64:undefined,output:path,writtenBytes:total,complete:complete&&last.eof===true};
  }finally{await handle.close();if(!okay)await fs.unlink(path).catch(()=>{});}
}
export async function runFuulProgrammesCLI(argv=process.argv.slice(2),io={}){
  const write=io.write??(value=>process.stdout.write(value)),errorWrite=io.errorWrite??(value=>process.stderr.write(value));
  const parsed=options(argv),command=parsed.command,opt=parsed.options;
  if(command==='help'||opt.help){write(FUUL_PROGRAMMES_HELP);return {help:true};}
  if(command==='methods'){write(JSON.stringify(FUUL_PROGRAMMES_METHODS,null,2)+'\n');return FUUL_PROGRAMMES_METHODS;}
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Operator stopped')),external=()=>controller.abort(io.signal?.reason);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  if(io.signal?.aborted)external();else io.signal?.addEventListener('abort',external,{once:true});
  let host,server;
  try{
    if(command.startsWith('runtime-')){
      const expectedManifestSha256=opt['expected-manifest-sha256'];
      let result;
      if(command==='runtime-build'){
        need(opt['installation-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --installation-directory and --destination.');
        result=await buildFuulRuntime({sourceDirectory:opt['source-directory']?resolve(opt['source-directory']):undefined,installationDirectory:resolve(opt['installation-directory']),directory:resolve(opt.destination),bunExecutable:opt['bun-executable']??'bun',npmExecutable:opt['npm-executable']??'npm',signal:controller.signal});
      }else if(command==='runtime-retain'){
        need(opt['installation-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --installation-directory and --destination.');
        result=await retainFuulRuntime({installationDirectory:resolve(opt['installation-directory']),directory:resolve(opt.destination)});
      }else if(command==='runtime-verify'){
        need(opt['runtime-directory'],'MISSING_ARGUMENT','Supply --runtime-directory.');
        result=await verifyFuulRuntime({directory:resolve(opt['runtime-directory']),expectedManifestSha256});
      }else if(command==='runtime-restore'){
        need(opt['source-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --source-directory and --destination.');
        result=await restoreFuulRuntime({sourceDirectory:resolve(opt['source-directory']),destination:resolve(opt.destination),expectedManifestSha256});
      }else if(command==='runtime-bind'){
        need(opt['runtime-directory']&&opt['application-directory'],'MISSING_ARGUMENT','Supply --runtime-directory and --application-directory.');
        result=await bindFuulRuntime({directory:resolve(opt['runtime-directory']),applicationDirectory:resolve(opt['application-directory']),expectedManifestSha256});
      }else need(false,'UNKNOWN_COMMAND','Select a documented runtime command.');
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    if(command==='serve'){
      need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
      const directory=resolve(opt.workspace),configuration=await loadFuulProgrammesConfiguration({workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
      const common={workspaceDirectory:directory,...configuration,expectedWorkspaceId:opt['expected-workspace-id'],host:opt.host??'127.0.0.1',
        port:opt.port===undefined?8776:numeric(opt.port,'port'),signal:controller.signal,
        connectionsFile:opt['connections-file']?resolve(opt['connections-file']):null,profileFile:opt['profile-file']?resolve(opt['profile-file']):null};
      server=await startFuulProgrammesServer(common);
      const startup={schema:'stellar-forge.fuul-programmes-workspace-startup.v1',status:'FUUL_PROGRAMMES_READY',...server.startup,
        sourceDirectory:dirname(fileURLToPath(import.meta.url)),connectionsFile:common.connectionsFile,profileFile:common.profileFile};
      if(opt['startup-format']==='json')write(JSON.stringify(startup)+'\n');else write('Fuul programme workspace\n'+startup.url+'\n');
      if(!controller.signal.aborted)await new Promise(done=>controller.signal.addEventListener('abort',done,{once:true}));
      return startup;
    }
    const method=command==='invoke'?opt.method:ALIASES[command];
    need(method,'UNKNOWN_COMMAND','Select a documented command or invoke --method.');
    let args=await inputFile(opt.input,io.stdin??process.stdin);
    for(const [flag,key] of Object.entries(FIELDS))if(Object.hasOwn(opt,flag)){
      let value=opt[flag];if(INTEGERS.has(key))value=numeric(value,flag);
      if(['sourceDirectory','destination'].includes(key))value=resolve(value);
      args[key]=value;
    }
    const definition=FUUL_PROGRAMMES_METHODS.find(row=>row.method===method);
    need(definition,'UNKNOWN_METHOD','Select an available Fuul method.');
    if(['package.inspect','package.receive'].includes(method)){
      if(method==='package.receive'){args.requestId??=randomUUID();errorWrite(JSON.stringify({method,requestId:args.requestId})+'\n');}
      const result=await (method==='package.inspect'?inspectFuulDelivery(args):receiveFuulDelivery(args));
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
    const directory=resolve(opt.workspace),configuration=await loadFuulProgrammesConfiguration({
      workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
    host=await openFuulProgrammesOperator({workspaceDirectory:directory,...configuration,
      expectedWorkspaceId:opt['expected-workspace-id'],signal:controller.signal,
      applicationDirectory:opt['application-directory']?resolve(opt['application-directory']):undefined});
    if(opt.file){
      const path=resolve(opt.file),body=await fs.readFile(path);
      if(method==='source.import')args={...args,bodyBase64:body.toString('base64'),filename:args.filename??path.split(/[\\/]/).at(-1)};
      else if(method==='programme.save')args={...args,definition:JSON.parse(body.toString('utf8'))};
      else need(false,'INVALID_ARGUMENT','--file selects a complete original source or programme definition.');
    }
    if(opt['resume-original']){
      if(method==='capture.run'||method==='capture.next'){
        const result=await host.invoke({method:'capture.read',args:{captureId:args.captureId}}),capture=result.capture;
        const original=method==='capture.run'?capture.run?.args:capture.inflight?.args;if(original)args={...original};
      }else if(method==='queue.next'){
        const result=await host.invoke({method:'queue.read',args:{table:args.table,id:args.id,limit:1}});
        const original=result.row.inflight?.args??result.row.prerequisiteRun?.args;if(original)args={...original};
      }else if(method==='run.execute'){
        const result=await host.invoke({method:'run.read',args:{runId:args.runId,limit:1}});
        if(result.run.execution?.args)args={...result.run.execution.args};
      }else need(false,'INVALID_ARGUMENT','Resume an original capture, dispatch or complete run.');
    }
    if(definition.mutates){
      args.requestId??=randomUUID();args.expectedRevision??=(await host.describe()).revision;
      errorWrite(JSON.stringify({method,requestId:args.requestId,expectedRevision:args.expectedRevision})+'\n');
    }
    if(opt.output&&['source.file','report.file','queue.file','edition.file'].includes(method)){
      const result=await writeDownload(host,method,args,opt.output,{complete:args.offset===undefined&&args.length===undefined});
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    const result=await host.invoke({method,args});write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{
    process.off('SIGINT',stop);process.off('SIGTERM',stop);io.signal?.removeEventListener('abort',external);
    if(server)await server.close();else if(host)await host.close();
  }
}
export const main=runFuulProgrammesCLI;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runFuulProgrammesCLI().catch(error=>{process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;});
}
