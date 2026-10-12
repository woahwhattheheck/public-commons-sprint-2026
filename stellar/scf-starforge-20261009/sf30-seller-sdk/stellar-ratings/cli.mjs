#!/usr/bin/env node
// MIT. Complete terminal entry for Stellar wallet ratings and daily activity.
import {promises as fs} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openStellarRatingsOperator,loadStellarRatingsConfiguration,RATINGS_METHODS} from './operator.mjs';
import {inspectRatingsDelivery,receiveRatingsDelivery} from './receiving.mjs';
import {startStellarRatingsServer} from './server.mjs';
import {installRatingsRuntime,retainRatingsRuntime,verifyRatingsRuntime,restoreRatingsRuntime,bindRatingsRuntime} from './runtime.mjs';
import {need,plain,integer,publicError} from './common.mjs';
const ALIASES={
 "workspace-describe": "workspace.describe",
 "workspace-list": "workspace.list",
 "workspace-profile": "workspace.profile",
 "workspace-history": "workspace.history",
 "request-status": "request.status",
 "registry-save": "registry.save",
 "registry-read": "registry.read",
 "policy-save": "policy.save",
 "policy-read": "policy.read",
 "source-catalog": "source.catalog",
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
 "wallet-review": "wallet.review",
 "activity-collect": "activity.collect",
 "run-start": "run.start",
 "run-read": "run.read",
 "run-next": "run.next",
 "run-continue": "run.continue",
 "run-pause": "run.pause",
 "run-resume": "run.resume",
 "collection-save": "collection.save",
 "collection-read": "collection.read",
 "collection-run": "collection.run",
 "collection-pause": "collection.pause",
 "collection-resume": "collection.resume",
 "decision-save": "decision.save",
 "decision-read": "decision.read",
 "edition-read": "edition.read",
 "edition-file": "edition.file",
 "edition-compare": "edition.compare",
 "report-create": "report.create",
 "report-read": "report.read",
 "report-file": "report.file",
 "lookup-read": "lookup.read",
 "wallet-popular": "wallet.popular",
 "workspace-export": "workspace.export",
 "report-export": "report.export",
 "package-inspect": "package.inspect",
 "package-receive": "package.receive",
 "state": "workspace.describe",
 "history": "workspace.history",
 "edition": "edition.read",
 "compare": "edition.compare"
};
const FIELDS={
 "request-id": "requestId",
 "expected-revision": "expectedRevision",
 "registry-id": "registryId",
 "registry-version": "registryVersion",
 "policy-id": "policyId",
 "policy-version": "policyVersion",
 "collection-id": "collectionId",
 "collection-version": "collectionVersion",
 "run-id": "runId",
 "capture-id": "captureId",
 "source-id": "sourceId",
 "record-id": "recordId",
 "edition-id": "editionId",
 "left-edition-id": "leftEditionId",
 "right-edition-id": "rightEditionId",
 "report-id": "reportId",
 "decision-id": "decisionId",
 "connection-alias": "connectionAlias",
 "expected-version": "expectedVersion",
 "version": "version",
 "provider": "provider",
 "kind": "kind",
 "network": "network",
 "mode": "mode",
 "name": "name",
 "label": "label",
 "source-scope": "sourceScope",
 "records-path": "recordsPath",
 "format": "format",
 "part": "part",
 "table": "table",
 "query": "query",
 "status": "status",
 "asset-id": "assetId",
 "account": "account",
 "actor": "actor",
 "reason": "reason",
 "action": "action",
 "supersedes": "supersedes",
 "offset": "offset",
 "limit": "limit",
 "length": "length",
 "from": "from",
 "to": "to",
 "as-of": "asOf",
 "repair": "repair",
 "source-directory": "sourceDirectory",
 "destination": "destination",
 "expected-manifest-sha256": "expectedManifestSha256"
};
const INTEGERS=new Set(['expectedRevision','registryVersion','policyVersion','collectionVersion','expectedVersion','version','offset','limit','length']);
const BOOL=new Set(['help','resume-original','repair','collect-daily']);
const OPTION_NAMES=new Set([...Object.keys(FIELDS),...BOOL,'workspace','connections-file','profile-file','expected-workspace-id','host','port','input','file','output','method','startup-format','installation-directory','runtime-directory','application-directory','npm-executable']);
export const RATINGS_HELP="Stellar ratings workspace\n\n  stellar-ratings serve --workspace /absolute/workspace --connections-file /private/connections.json --collect-daily\n  stellar-ratings registry-save --workspace /absolute/workspace --file /absolute/registry.json\n  stellar-ratings policy-save --workspace /absolute/workspace --file /absolute/wallet-policy.json\n  stellar-ratings wallet-review --workspace /absolute/workspace --connections-file /private/connections.json --input /absolute/review.json\n  stellar-ratings collection-run --workspace /absolute/workspace --connections-file /private/connections.json --collection-id UUID\n  stellar-ratings runtime-install --installation-directory /absolute/packages --destination /absolute/runtime\n  stellar-ratings runtime-retain --installation-directory /absolute/installed-packages --destination /absolute/runtime\n  stellar-ratings runtime-verify --runtime-directory /absolute/runtime\n  stellar-ratings runtime-restore --source-directory /absolute/runtime --destination /absolute/restored\n  stellar-ratings runtime-bind --runtime-directory /absolute/runtime --application-directory /absolute/application\n\nUse --input FILE or --input - for complete JSON arguments. Mutations preserve an original requestId and expectedRevision.\n--resume-original restores the original capture, review or daily collection.\nFile --output streams every original byte; an explicit offset or length selects a range.\n--startup-format json returns STELLAR_RATINGS_READY and the original workspace identity.\nThe server uses port 8777 by default and a private browser URL.\n--collect-daily continually collects closed UTC days for enabled collections.\n\nCommands: workspace-describe, workspace-list, workspace-profile, workspace-history, request-status, registry-save, registry-read, policy-save, policy-read, source-catalog, source-import, source-project, source-read, source-file, capture-start, capture-read, capture-next, capture-run, capture-pause, capture-resume, wallet-review, activity-collect, run-start, run-read, run-next, run-continue, run-pause, run-resume, collection-save, collection-read, collection-run, collection-pause, collection-resume, decision-save, decision-read, edition-read, edition-file, edition-compare, report-create, report-read, report-file, lookup-read, wallet-popular, workspace-export, report-export, package-inspect, package-receive, state, history, edition, compare\n";
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
export async function runStellarRatingsCLI(argv=process.argv.slice(2),io={}){
  const write=io.write??(value=>process.stdout.write(value)),errorWrite=io.errorWrite??(value=>process.stderr.write(value));
  const parsed=options(argv),command=parsed.command,opt=parsed.options;
  if(command==='help'||opt.help){write(RATINGS_HELP);return {help:true};}
  if(command==='methods'){write(JSON.stringify(RATINGS_METHODS,null,2)+'\n');return RATINGS_METHODS;}
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Operator stopped')),external=()=>controller.abort(io.signal?.reason);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  if(io.signal?.aborted)external();else io.signal?.addEventListener('abort',external,{once:true});
  let host,server;
  try{
    if(command.startsWith('runtime-')){
      const expectedManifestSha256=opt['expected-manifest-sha256'];
      let result;
      if(command==='runtime-install'){
        need(opt['installation-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --installation-directory and --destination.');
        result=await installRatingsRuntime({installationDirectory:resolve(opt['installation-directory']),directory:resolve(opt.destination),npmExecutable:opt['npm-executable']??'npm',signal:controller.signal});
      }else if(command==='runtime-retain'){
        need(opt['installation-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --installation-directory and --destination.');
        result=await retainRatingsRuntime({installationDirectory:resolve(opt['installation-directory']),directory:resolve(opt.destination)});
      }else if(command==='runtime-verify'){
        need(opt['runtime-directory'],'MISSING_ARGUMENT','Supply --runtime-directory.');
        result=await verifyRatingsRuntime({directory:resolve(opt['runtime-directory']),expectedManifestSha256});
      }else if(command==='runtime-restore'){
        need(opt['source-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --source-directory and --destination.');
        result=await restoreRatingsRuntime({sourceDirectory:resolve(opt['source-directory']),destination:resolve(opt.destination),expectedManifestSha256});
      }else if(command==='runtime-bind'){
        need(opt['runtime-directory']&&opt['application-directory'],'MISSING_ARGUMENT','Supply --runtime-directory and --application-directory.');
        result=await bindRatingsRuntime({directory:resolve(opt['runtime-directory']),applicationDirectory:resolve(opt['application-directory']),expectedManifestSha256});
      }else need(false,'UNKNOWN_COMMAND','Select a documented runtime command.');
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    if(command==='serve'){
      need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
      const directory=resolve(opt.workspace),configuration=await loadStellarRatingsConfiguration({workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
      const common={workspaceDirectory:directory,...configuration,collectDaily:opt['collect-daily']===true,runtime:{...(opt['runtime-directory']?{runtimeDirectory:resolve(opt['runtime-directory'])}:{}),...(opt['expected-manifest-sha256']?{expectedManifestSha256:opt['expected-manifest-sha256']}:{}),...(opt['installation-directory']?{installationDirectory:resolve(opt['installation-directory'])}:{})},expectedWorkspaceId:opt['expected-workspace-id'],host:opt.host??'127.0.0.1',
        port:opt.port===undefined?8777:numeric(opt.port,'port'),signal:controller.signal,
        connectionsFile:opt['connections-file']?resolve(opt['connections-file']):null,profileFile:opt['profile-file']?resolve(opt['profile-file']):null,
        applicationDirectory:opt['application-directory']?resolve(opt['application-directory']):undefined};
      server=await startStellarRatingsServer(common);
      const startup={schema:'stellar-forge.stellar-ratings-workspace-startup.v1',status:'STELLAR_RATINGS_READY',...server.startup,
        sourceDirectory:dirname(fileURLToPath(import.meta.url)),connectionsFile:common.connectionsFile,profileFile:common.profileFile,
        collectDaily:common.collectDaily,runtimeDirectory:common.runtime.runtimeDirectory??null,
        expectedManifestSha256:common.runtime.expectedManifestSha256??null,installationDirectory:common.runtime.installationDirectory??null};
      if(opt['startup-format']==='json')write(JSON.stringify(startup)+'\n');else write('Stellar ratings workspace\n'+startup.url+'\n');
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
    const definition=RATINGS_METHODS.find(row=>row.method===method);
    need(definition,'UNKNOWN_METHOD','Select an available Stellar ratings method.');
    if(['package.inspect','package.receive'].includes(method)){
      if(method==='package.receive'){args.requestId??=randomUUID();errorWrite(JSON.stringify({method,requestId:args.requestId})+'\n');}
      const result=await (method==='package.inspect'?inspectRatingsDelivery(args):receiveRatingsDelivery(args));
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
    const directory=resolve(opt.workspace),configuration=await loadStellarRatingsConfiguration({
      workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
    host=await openStellarRatingsOperator({workspaceDirectory:directory,...configuration,runtime:{...(opt['runtime-directory']?{runtimeDirectory:resolve(opt['runtime-directory'])}:{}),...(opt['expected-manifest-sha256']?{expectedManifestSha256:opt['expected-manifest-sha256']}:{}),...(opt['installation-directory']?{installationDirectory:resolve(opt['installation-directory'])}:{})},
      expectedWorkspaceId:opt['expected-workspace-id'],signal:controller.signal,
      applicationDirectory:opt['application-directory']?resolve(opt['application-directory']):undefined});
    if(opt.file){
      const path=resolve(opt.file),body=await fs.readFile(path);
      if(method==='source.import')args={...args,bodyBase64:body.toString('base64'),filename:args.filename??path.split(/[\\/]/).at(-1)};
      else if(['registry.save','policy.save','collection.save'].includes(method))args={...args,definition:JSON.parse(body.toString('utf8'))};
      else need(false,'INVALID_ARGUMENT','--file selects a complete original source, registry, policy or collection definition.');
    }
    if(opt['resume-original']){
      if(method==='capture.run'||method==='capture.next'){
        const result=await host.invoke({method:'capture.read',args:{captureId:args.captureId}}),capture=result.capture;
        const original=method==='capture.run'?capture.run?.args:capture.inflight?.args;if(original)args={...original};
      }else if(method==='run.continue'||method==='run.next'){
        const result=await host.invoke({method:'run.read',args:{runId:args.runId,limit:1}});
        const original=method==='run.next'?result.run.inflight?.args:result.run.execution?.args;if(original)args={...original};
      }else if(method==='collection.run'){
        const result=await host.invoke({method:'collection.read',args:{collectionId:args.collectionId,limit:1}});
        if(result.execution?.args)args={...result.execution.args};
      }else need(false,'INVALID_ARGUMENT','Resume an original capture, review or daily collection.');
    }
    if(definition.mutates){
      args.requestId??=randomUUID();args.expectedRevision??=(await host.describe()).revision;
      errorWrite(JSON.stringify({method,requestId:args.requestId,expectedRevision:args.expectedRevision})+'\n');
    }
    if(opt.output&&['source.file','report.file','edition.file'].includes(method)){
      const result=await writeDownload(host,method,args,opt.output,{complete:args.offset===undefined&&args.length===undefined});
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    const result=await host.invoke({method,args});write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{
    process.off('SIGINT',stop);process.off('SIGTERM',stop);io.signal?.removeEventListener('abort',external);
    if(server)await server.close();else if(host)await host.close();
  }
}
export const main=runStellarRatingsCLI;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runStellarRatingsCLI().catch(error=>{process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;});
}
