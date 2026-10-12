#!/usr/bin/env node
// MIT. Complete terminal entry for invoice commissioning and settlement operations.
import {promises as fs} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openInvoiceSettlementOperator,loadInvoiceSettlementConfiguration,INVOICE_SETTLEMENT_METHODS} from './operator.mjs';
import {inspectInvoiceDelivery,receiveInvoiceDelivery} from './receiving.mjs';
import {startInvoiceSettlementServer,startInvoiceWebhookServer} from './server.mjs';
import {retainInvoiceRuntime,verifyInvoiceRuntime,restoreInvoiceRuntime,bindInvoiceRuntime} from './runtime.mjs';
import {need,plain,integer,publicError} from './common.mjs';
const ALIASES={
  "state": "workspace.describe",
  "history": "workspace.history",
  "request-status": "request.status",
  "profile-save": "workspace.profile",
  "programme-save": "programme.save",
  "programme-read": "programme.read",
  "source-catalog": "source.catalog",
  "source-import": "source.import",
  "source-project": "source.project",
  "source-read": "source.read",
  "source-file": "source.file",
  "capture-start": "capture.start",
  "capture-next": "capture.next",
  "capture-run": "capture.run",
  "capture-pause": "capture.pause",
  "capture-resume": "capture.resume",
  "receipt-read": "receipt.read",
  "delivery-prepare": "delivery.prepare",
  "delivery-read": "delivery.read",
  "delivery-file": "delivery.file",
  "delivery-next": "delivery.next",
  "delivery-pause": "delivery.pause",
  "delivery-resume": "delivery.resume",
  "delivery-resolve": "delivery.resolve",
  "delivery-run": "delivery.run",
  "delivery-run-pause": "delivery.run.pause",
  "delivery-run-resume": "delivery.run.resume",
  "decision-save": "decision.save",
  "decision-read": "decision.read",
  "reconcile": "reconciliation.create",
  "edition": "edition.read",
  "compare": "reconciliation.compare",
  "report-create": "report.create",
  "report-read": "report.read",
  "report-file": "report.file",
  "workspace-export": "workspace.export",
  "report-export": "report.export",
  "package-inspect": "package.inspect",
  "package-receive": "package.receive"
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
  "receipt-id": "receiptId",
  "delivery-id": "deliveryId",
  "attempt-id": "attemptId",
  "run-id": "runId",
  "decision-id": "decisionId",
  "reconciliation-id": "reconciliationId",
  "partner-id": "partnerId",
  "connection-alias": "connectionAlias",
  "source-directory": "sourceDirectory",
  "expected-manifest-sha256": "expectedManifestSha256",
  "left-id": "leftId",
  "right-id": "rightId",
  "include-application": "includeApplication",
  "source-scope": "sourceScope",
  "invoice-id": "invoiceId",
  "order-id": "orderId",
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
  "supersedes": "supersedes"
};
const INTEGERS=new Set(['expectedRevision','expectedVersion','programmeVersion','version','offset','length','limit']);
const BOOL=new Set(['help','include-application','resume-original']);
const OPTION_NAMES=new Set(['workspace','connections-file','profile-file','expected-workspace-id','host','port','startup-format',
  'input','method','file','output','help','resume-original','installation-directory','runtime-directory','application-directory',...Object.keys(FIELDS)]);
export const INVOICE_SETTLEMENT_HELP="Stellar invoice and settlement workspace\n\nStart the local operator:\n  stellar-invoice-settlement serve --workspace /absolute/workspace --connections-file /private/connections.json\n  stellar-invoice-settlement programme-save --workspace /absolute/workspace --file /absolute/programme.json\n\nOperate the complete original programme:\n  stellar-invoice-settlement methods\n  stellar-invoice-settlement invoke --workspace /absolute/workspace --method capture.start --input /absolute/request.json\n  stellar-invoice-settlement capture-run --workspace /absolute/workspace --capture-id UUID --resume-original\n  stellar-invoice-settlement delivery-prepare --workspace /absolute/workspace --programme-id UUID --connection-alias listener\n  stellar-invoice-settlement delivery-run --workspace /absolute/workspace --programme-id UUID\n  stellar-invoice-settlement reconcile --workspace /absolute/workspace --programme-id UUID\n  stellar-invoice-settlement report-create --workspace /absolute/workspace --reconciliation-id UUID\n  stellar-invoice-settlement report-file --workspace /absolute/workspace --report-id UUID --format csv --output /absolute/report.csv\n\nReceive authenticated customer webhooks:\n  stellar-invoice-settlement webhook-serve --workspace /absolute/workspace --connections-file /private/connections.json --programme-id UUID --connection-alias customer-events --host 127.0.0.1 --port 8789\n\nComplete application and workspace transfer:\n  stellar-invoice-settlement workspace-export --workspace /absolute/workspace --connections-file /private/connections.json --destination /absolute/delivery\n  stellar-invoice-settlement package-inspect --source-directory /absolute/delivery\n  stellar-invoice-settlement package-receive --source-directory /absolute/delivery --destination /absolute/client --request-id UUID\n\nOriginal EVM runtime:\n  stellar-invoice-settlement runtime-retain --installation-directory /absolute/installed/application --destination /private/original-runtime\n  stellar-invoice-settlement runtime-verify --runtime-directory /private/original-runtime\n  stellar-invoice-settlement runtime-restore --source-directory /private/original-runtime --destination /private/restored-runtime\n\nEvery named operation is available through invoke. --input - reads complete JSON from stdin.\nMutating commands accept --request-id and --expected-revision. If omitted, the chosen UUID and current revision\nare printed to stderr before operating. Continue the same UUID and identical original arguments after interruption.\n--resume-original selects a retained capture or delivery request, including its original expected revision.\n--connections-file contains private named service configuration outside the workspace.\nSource/report --output writes the complete file; an explicit --offset or --length selects a byte range.\nserve uses loopback. webhook-serve exposes only authenticated ElementPay customer events and a health route.\n--startup-format json returns the complete host startup record.\n\nCommands: state, history, request-status, profile-save, programme-save, programme-read, source-catalog, source-import, source-project, source-read, source-file, capture-start, capture-next, capture-run, capture-pause, capture-resume, receipt-read, delivery-prepare, delivery-read, delivery-file, delivery-next, delivery-pause, delivery-resume, delivery-resolve, delivery-run, delivery-run-pause, delivery-run-resume, decision-save, decision-read, reconcile, edition, compare, report-create, report-read, report-file, workspace-export, report-export, package-inspect, package-receive\n";
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
export async function runInvoiceSettlementCLI(argv=process.argv.slice(2),io={}){
  const write=io.write??(value=>process.stdout.write(value)),errorWrite=io.errorWrite??(value=>process.stderr.write(value));
  const parsed=options(argv),command=parsed.command,opt=parsed.options;
  if(command==='help'||opt.help){write(INVOICE_SETTLEMENT_HELP);return {help:true};}
  if(command==='methods'){write(JSON.stringify(INVOICE_SETTLEMENT_METHODS,null,2)+'\n');return INVOICE_SETTLEMENT_METHODS;}
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Operator stopped')),external=()=>controller.abort(io.signal?.reason);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  if(io.signal?.aborted)external();else io.signal?.addEventListener('abort',external,{once:true});
  let host,server;
  try{
    if(command.startsWith('runtime-')){
      const expectedManifestSha256=opt['expected-manifest-sha256'];
      let result;
      if(command==='runtime-retain'){
        need(opt['installation-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --installation-directory and --destination.');
        result=await retainInvoiceRuntime({installationDirectory:resolve(opt['installation-directory']),directory:resolve(opt.destination)});
      }else if(command==='runtime-verify'){
        need(opt['runtime-directory'],'MISSING_ARGUMENT','Supply --runtime-directory.');
        result=await verifyInvoiceRuntime({directory:resolve(opt['runtime-directory']),expectedManifestSha256});
      }else if(command==='runtime-restore'){
        need(opt['source-directory']&&opt.destination,'MISSING_ARGUMENT','Supply --source-directory and --destination.');
        result=await restoreInvoiceRuntime({sourceDirectory:resolve(opt['source-directory']),destination:resolve(opt.destination),expectedManifestSha256});
      }else if(command==='runtime-bind'){
        need(opt['runtime-directory']&&opt['application-directory'],'MISSING_ARGUMENT','Supply --runtime-directory and --application-directory.');
        result=await bindInvoiceRuntime({directory:resolve(opt['runtime-directory']),applicationDirectory:resolve(opt['application-directory']),expectedManifestSha256});
      }else need(false,'UNKNOWN_COMMAND','Select a documented runtime command.');
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    if(command==='serve'||command==='webhook-serve'){
      need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
      const directory=resolve(opt.workspace),configuration=await loadInvoiceSettlementConfiguration({
        workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
      const common={workspaceDirectory:directory,...configuration,expectedWorkspaceId:opt['expected-workspace-id'],
        host:opt.host??'127.0.0.1',port:opt.port===undefined?0:numeric(opt.port,'port'),signal:controller.signal,
        connectionsFile:opt['connections-file']?resolve(opt['connections-file']):null,profileFile:opt['profile-file']?resolve(opt['profile-file']):null};
      if(command==='webhook-serve'){
        need(opt['programme-id']&&opt['connection-alias'],'MISSING_ARGUMENT','Supply --programme-id and --connection-alias.');
        server=await startInvoiceWebhookServer({...common,programmeId:opt['programme-id'],
          programmeVersion:opt['programme-version']?numeric(opt['programme-version'],'programme version'):undefined,connectionAlias:opt['connection-alias']});
      }else server=await startInvoiceSettlementServer(common);
      const startup=command==='webhook-serve'?server.startup:{schema:'stellar-forge.invoice-settlement-workspace-startup.v1',
        status:'INVOICE_SETTLEMENT_READY',...server.startup,sourceDirectory:dirname(fileURLToPath(import.meta.url)),
        connectionsFile:common.connectionsFile,profileFile:common.profileFile};
      if(opt['startup-format']==='json'||command==='webhook-serve')write(JSON.stringify(startup)+'\n');
      else write('Invoice and settlement workspace\n'+startup.url+'\n');
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
    const definition=INVOICE_SETTLEMENT_METHODS.find(row=>row.method===method);
    need(definition,'UNKNOWN_METHOD','Select an available invoice method.');
    if(['package.inspect','package.receive'].includes(method)){
      if(method==='package.receive'){args.requestId??=randomUUID();errorWrite(JSON.stringify({method,requestId:args.requestId})+'\n');}
      const result=await (method==='package.inspect'?inspectInvoiceDelivery(args):receiveInvoiceDelivery(args));
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
    const directory=resolve(opt.workspace),configuration=await loadInvoiceSettlementConfiguration({
      workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
    host=await openInvoiceSettlementOperator({workspaceDirectory:directory,...configuration,
      expectedWorkspaceId:opt['expected-workspace-id'],signal:controller.signal,
      applicationDirectory:opt['application-directory']?resolve(opt['application-directory']):undefined});
    if(opt.file){
      const path=resolve(opt.file),body=await fs.readFile(path);
      if(method==='source.import')args={...args,bodyBase64:body.toString('base64'),filename:args.filename??path.split(/[\\/]/).at(-1)};
      else if(method==='programme.save')args={...args,definition:JSON.parse(body.toString('utf8'))};
      else need(false,'INVALID_ARGUMENT','--file selects a complete original source or programme definition.');
    }
    if(opt['resume-original']){
      const state=await host.describe();
      if(method==='capture.run'||method==='capture.next'){
        const capture=state.captures[args.captureId];need(capture,'NOT_FOUND','Select a retained source capture.');
        const original=method==='capture.run'?capture.run?.args:capture.inflight?.args;if(original)args={...original};
      }else if(method==='delivery.next'){
        const delivery=state.deliveries[args.deliveryId];need(delivery,'NOT_FOUND','Select a retained listener job.');
        if(delivery.inflight?.args)args={...delivery.inflight.args};
      }else if(method==='delivery.run'){
        const run=state.deliveryRuns[args.runId??args.requestId];need(run,'NOT_FOUND','Select the original --run-id.');
        args={...run.args};
      }else need(false,'INVALID_ARGUMENT','Resume an original capture or delivery operation.');
    }
    if(definition.mutates){
      args.requestId??=randomUUID();args.expectedRevision??=(await host.describe()).revision;
      errorWrite(JSON.stringify({method,requestId:args.requestId,expectedRevision:args.expectedRevision})+'\n');
    }
    if(opt.output&&['source.file','report.file','delivery.file'].includes(method)){
      const result=await writeDownload(host,method,args,opt.output,{complete:opt.offset===undefined&&opt.length===undefined});
      write(JSON.stringify(result,null,2)+'\n');return result;
    }
    const result=await host.invoke({method,args});write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{
    process.off('SIGINT',stop);process.off('SIGTERM',stop);io.signal?.removeEventListener('abort',external);
    if(server)await server.close();else if(host)await host.close();
  }
}
export const main=runInvoiceSettlementCLI;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runInvoiceSettlementCLI().catch(error=>{process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;});
}
