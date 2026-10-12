#!/usr/bin/env node
// MIT. Complete terminal entry point for the institutional settlement client.
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openSettlementAuditOperator, loadSettlementAuditConfiguration, SETTLEMENT_AUDIT_METHODS } from './operator.mjs';
import { inspectSettlementDelivery, receiveSettlementDelivery } from './receiving.mjs';
import { serveSettlementAudit } from './server.mjs';
import { need, plain, integer, publicError } from './common.mjs';

const ALIASES={
  state:'workspace.describe',history:'workspace.history','request-status':'request.status',
  'profile-save':'workspace.profile','policy-reference':'policy.reference','policy-save':'policy.save','policy-read':'policy.read',
  'batch-save':'batch.save','batch-read':'batch.read','source-catalog':'source.catalog',
  'source-import':'source.import','source-project':'source.project','source-read':'source.read','source-file':'source.file',
  'capture-start':'capture.start','capture-next':'capture.next','capture-run':'capture.run',
  'capture-pause':'capture.pause','capture-resume':'capture.resume','plan-create':'plan.create',
  'correction-add':'correction.add',reconcile:'reconciliation.create',edition:'edition.read',compare:'reconciliation.compare',
  'report-create':'report.create','report-file':'report.file','workspace-export':'workspace.export',
  'report-export':'report.export','delivery-inspect':'delivery.inspect','delivery-receive':'delivery.receive',
};
const FIELDS={
  'request-id':'requestId','expected-revision':'expectedRevision','expected-version':'expectedVersion','policy-id':'policyId','batch-id':'batchId',
  'batch-version':'batchVersion','plan-id':'planId','capture-id':'captureId','source-id':'sourceId','report-id':'reportId',
  'reconciliation-id':'reconciliationId','partner-id':'partnerId','connection-alias':'connectionAlias',
  'source-directory':'sourceDirectory','expected-manifest-sha256':'expectedManifestSha256',
  'left-id':'leftId','right-id':'rightId','include-application':'includeApplication',
  version:'version',name:'name',kind:'kind',id:'id',destination:'destination',filename:'filename',
  provider:'provider',part:'part',offset:'offset',length:'length',limit:'limit',network:'network','source-scope':'sourceScope',
};
const INTEGERS=new Set(['expectedRevision','expectedVersion','batchVersion','version','offset','length','limit']);
const BOOL=new Set(['help','include-application','resume-original']);
const OPTION_NAMES=new Set(['workspace','connections-file','profile-file','expected-workspace-id','host','port','startup-format',
  'input','method','file','output','help','resume-original',...Object.keys(FIELDS)]);
export const SETTLEMENT_AUDIT_HELP=[
  'Stellar settlement audit workspace','',
  'Start the operator interface:',
  '  stellar-settlement-audit serve --workspace /absolute/workspace --connections-file /private/connections.json',
  '',
  'Inspect and operate:',
  '  stellar-settlement-audit state --workspace /absolute/workspace',
  '  stellar-settlement-audit methods',
  '  stellar-settlement-audit invoke --workspace /absolute/workspace --method policy.save --input /absolute/policy-request.json',
  '  stellar-settlement-audit capture-run --workspace /absolute/workspace --capture-id UUID --resume-original',
  '  stellar-settlement-audit source-import --workspace /absolute/workspace --file /absolute/original.json --provider sdp --kind payments',
  '  stellar-settlement-audit report-file --workspace /absolute/workspace --report-id UUID --filename NAME --output /absolute/report.csv',
  '  stellar-settlement-audit workspace-export --workspace /absolute/workspace --destination /absolute/delivery',
  '  stellar-settlement-audit delivery-inspect --source-directory /absolute/delivery',
  '  stellar-settlement-audit delivery-receive --source-directory /absolute/delivery --destination /absolute/client --request-id UUID',
  '',
  'Every named method is also available through invoke. --input - reads complete JSON from stdin.',
  'Mutating commands accept --request-id and --expected-revision. If omitted, the command prints its chosen',
  'request UUID and observed revision to stderr before operating. Reuse that UUID and identical arguments to recover its result.',
  '--connections-file holds named original SDP/Horizon endpoints and private credentials outside the workspace.',
  '--profile-file supplies the initial institutional profile. --expected-workspace-id verifies an existing workspace.',
  'serve accepts --host 127.0.0.1 or ::1, --port 0..65535 and --startup-format json.',
  '',
  'Commands: '+Object.keys(ALIASES).join(', '),
].join('\n')+'\n';
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
export async function runSettlementAuditCLI(argv=process.argv.slice(2),io={}){
  const write=io.write??(value=>process.stdout.write(value)),errorWrite=io.errorWrite??(value=>process.stderr.write(value));
  const parsed=options(argv),command=parsed.command,opt=parsed.options;
  if(command==='help'||opt.help){write(SETTLEMENT_AUDIT_HELP);return {help:true};}
  if(command==='methods'){write(JSON.stringify(SETTLEMENT_AUDIT_METHODS,null,2)+'\n');return SETTLEMENT_AUDIT_METHODS;}
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Operator stopped')),external=()=>controller.abort(io.signal?.reason);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  if(io.signal?.aborted)external();else io.signal?.addEventListener('abort',external,{once:true});
  let host,server;
  try{
    if(command==='serve'){
      need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
      const directory=resolve(opt.workspace),configuration=await loadSettlementAuditConfiguration({
        workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
      server=await serveSettlementAudit({workspaceDirectory:directory,...configuration,expectedWorkspaceId:opt['expected-workspace-id'],
        host:opt.host??'127.0.0.1',port:opt.port===undefined?0:numeric(opt.port,'port'),signal:controller.signal,
        connectionsFile:opt['connections-file']?resolve(opt['connections-file']):null,profileFile:opt['profile-file']?resolve(opt['profile-file']):null});
      const startup={schema:'stellar-forge.settlement-audit-workspace-startup.v1',status:'SETTLEMENT_AUDIT_READY',
        ...server.startup,sourceDirectory:dirname(fileURLToPath(import.meta.url)),
        connectionsFile:opt['connections-file']?resolve(opt['connections-file']):null,
        profileFile:opt['profile-file']?resolve(opt['profile-file']):null};
      if(opt['startup-format']==='json')write(JSON.stringify(startup)+'\n');else write('Stellar settlement workspace\n'+startup.url+'\n');
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
    const definition=SETTLEMENT_AUDIT_METHODS.find(item=>item.method===method);
    need(definition,'UNKNOWN_METHOD','Select an available settlement method.');
    if(['delivery.inspect','delivery.receive'].includes(method)){
      if(method==='delivery.receive'&&!args.requestId)args.requestId=randomUUID();
      if(method==='delivery.receive')errorWrite(JSON.stringify({method,requestId:args.requestId})+'\n');
      const result=await (method==='delivery.inspect'?inspectSettlementDelivery(args):receiveSettlementDelivery(args));
      write(JSON.stringify(result,(key,value)=>Buffer.isBuffer(value)?undefined:value,2)+'\n');return result;
    }
    need(opt.workspace,'MISSING_ARGUMENT','Supply --workspace.');
    const directory=resolve(opt.workspace),configuration=await loadSettlementAuditConfiguration({
      workspaceDirectory:directory,connectionsFile:opt['connections-file'],profileFile:opt['profile-file']});
    host=await openSettlementAuditOperator({workspaceDirectory:directory,...configuration,
      expectedWorkspaceId:opt['expected-workspace-id'],signal:controller.signal});
    if(method==='source.import'&&opt.file){
      const path=resolve(opt.file),body=await fs.readFile(path);
      args={...args,bodyBase64:body.toString('base64'),filename:args.filename??path.split(/[\\/]/).at(-1)};
    }
    if(method==='capture.run'&&opt['resume-original']){
      const state=await host.describe(),capture=state.captures[args.captureId];
      need(capture,'NOT_FOUND','Select a retained source capture.');
      if(capture.run?.args)args={...capture.run.args};
    }
    if(definition.mutates){
      args.requestId??=randomUUID();args.expectedRevision??=(await host.describe()).revision;
      errorWrite(JSON.stringify({method,requestId:args.requestId,expectedRevision:args.expectedRevision})+'\n');
    }
    const result=await host.invoke({method,args});
    if(opt.output&&['source.file','report.file'].includes(method)){
      need(typeof result.base64==='string','INVALID_FILE','The operator did not return file bytes.');
      await fs.writeFile(resolve(opt.output),Buffer.from(result.base64,'base64'),{flag:'wx',mode:0o600});
      const written={...result,base64:undefined,output:resolve(opt.output)};write(JSON.stringify(written,null,2)+'\n');return written;
    }
    write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{
    process.off('SIGINT',stop);process.off('SIGTERM',stop);io.signal?.removeEventListener('abort',external);
    if(server)await server.close();else if(host)await host.close();
  }
}
export const main=runSettlementAuditCLI;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runSettlementAuditCLI().catch(error=>{process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;});
}
