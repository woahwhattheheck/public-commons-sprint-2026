#!/usr/bin/env node
// MIT. Loopback operator interface for the maintained accounting workspace.
import {createServer} from 'node:http';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {openAccountingWorkspace,WorkspaceError} from './store.mjs';
import {accountingWorkspaceBinding} from './binding.mjs';
import {openCollectionWorkspace} from './collection-workspace.mjs';
import {handlePricingRequest,PRICING_REQUEST_BYTES} from './pricing-workspace.mjs';
import {handlePeriodRequest} from './period-workspace.mjs';
import {AccountantWorkspace,handleAccountantRequest,ACCOUNTANT_REQUEST_BYTES} from './accountant-workspace.mjs';
import {RECOVERY_COMMANDS,RECOVERY_HELP,recoveryMain} from './recovery-cli.mjs';
import {openAccountingMaintenance} from './recovery-controller.mjs';
import {BitwaveWorkspace,handleBitwaveRequest,BITWAVE_REQUEST_BYTES} from './bitwave-workspace.mjs';
import {handleAdjustmentRequest} from './adjustments-workspace.mjs';
import {CryptoworthWorkspace,handleCryptoworthRequest,CRYPTOWORTH_REQUEST_BYTES} from './cryptoworth-workspace.mjs';
import {CRYPTOWORTH_HELP,cryptoworthMain} from './cryptoworth-cli.mjs';
import {RunbookWorkspace,handleRunbookRequest,RUNBOOK_REQUEST_BYTES} from './runbooks-workspace.mjs';
import {RUNBOOK_HELP,runbooksMain} from './runbooks-cli.mjs';
import {ADJUSTMENTS_HELP,adjustmentsMain} from './adjustments-cli.mjs';
import {CustomerStatementWorkspace,STATEMENT_REQUEST_BYTES} from '../customer-statements/store.mjs';
import {handleCustomerStatementRequest,customerStatementAsset} from '../customer-statements/server.mjs';
import {XeroWorkspace,handleXeroRequest,XERO_REQUEST_BYTES} from './xero-workspace.mjs';
import {QboWorkspace,handleQboRequest,QBO_REQUEST_BYTES} from './qbo-workspace.mjs';
import {XERO_HELP,xeroMain} from './xero-cli.mjs';
import {handleAccountingConnections,ACCOUNTING_CONNECTION_REQUEST_BYTES} from './connections-workspace.mjs';
import {AccountingDeliveryWorkspace,SIGNED_NOTICE_PATH} from '../delivery/workspace.mjs';
import {readSignedNotice,handleDeliveryNoticeRequest,deliveryNoticeAsset} from '../delivery/server.mjs';

const STATIC=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
const TYPES={'.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.html':'text/html; charset=utf-8','.tar':'application/x-tar'};
const check=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
async function body(request,limit=600_000){
  check(request.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED','Send a JSON workspace request.');
  let length=0;const parts=[];
  for await(const part of request){length+=part.length;check(length<=limit,'BODY_TOO_LARGE','The upload exceeds the supported file size.',413);parts.push(part);}
  let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new WorkspaceError('INVALID_JSON','The request is not valid JSON.');}
  check(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_REQUEST','Send an object.');return value;
}
export async function startAccountingWorkspace({port=8446,host='127.0.0.1',rpcProxyEnv,bitwaveClient,xeroClient,qboClient,connectionsWorkspace,
  recoveryStateRoot,recoveryBackupRoot,recoveryPassEnv,recoveryStartPaused=false,deliverySecretEnv,...options}){
  check(host==='127.0.0.1'||host==='localhost','LOOPBACK_REQUIRED','This operator workspace binds to loopback.');
  check(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT','Choose a valid port.');
  const hosts=new Set();
  const closeRuntime=async({workspace,cryptoworth,bitwave,qbo,xero,collection})=>{
    await cryptoworth?.pendingMutation;
    const errors=[];for(const owned of [qbo,xero,bitwave,collection,workspace]){try{await owned?.close();}catch(error){errors.push(error);}await Promise.allSettled([...(owned?.tasks??[])]);}
    if(errors.length)throw Object.assign(new AggregateError(errors,'The original accounting controllers did not all close cleanly.'),{code:'ACCOUNTING_RUNTIME_CLOSE_FAILED'});
  };
  const openRuntime=async()=>{
    const workspace=await openAccountingWorkspace(options),accountant=new AccountantWorkspace(workspace),cryptoworth=new CryptoworthWorkspace(workspace,accountant),runbooks=new RunbookWorkspace(workspace,accountant);
    const bitwave=new BitwaveWorkspace(workspace,accountant,bitwaveClient?{client:bitwaveClient}:{}),xero=new XeroWorkspace(workspace,accountant,xeroClient?{client:xeroClient}:{});let collection;
    const qbo=new QboWorkspace(workspace,accountant,qboClient?{client:qboClient}:{});
    try{const statements=new CustomerStatementWorkspace(workspace);await statements.init();const delivery=new AccountingDeliveryWorkspace(workspace,{secretEnv:deliverySecretEnv});await delivery.init();workspace.adjustments.configureTransport({httpsProxyEnv:rpcProxyEnv});collection=await openCollectionWorkspace(workspace,{httpsProxyEnv:rpcProxyEnv});await bitwave.recover();await qbo.recover();await xero.init();return {workspace,accountant,cryptoworth,runbooks,bitwave,qbo,xero,collection,statements,delivery};}
    catch(error){await closeRuntime({workspace,cryptoworth,bitwave,qbo,xero,collection}).catch(()=>{});throw error;}
  };
  const maintenance=await openAccountingMaintenance({directory:options.directory,stateRoot:recoveryStateRoot,backupRoot:recoveryBackupRoot,
    passEnv:recoveryPassEnv,startPaused:recoveryStartPaused,openRuntime,closeRuntime});
  const send=(response,status,value,{type='application/json; charset=utf-8',name}={})=>{
    if(response.destroyed)return;
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
    response.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      ...(name?{'Content-Disposition':'attachment; filename="'+name+'"'}:{})});response.end(bytes);
  };
  const server=createServer(async(request,response)=>{
    let operation;
    try{
      const url=new URL(request.url,'http://'+request.headers.host),path=url.pathname;
      const nativeCallback=connectionsWorkspace?.oauth.acceptCallbackRequest(request,url)===true;
      check(hosts.has(request.headers.host)||nativeCallback,'INVALID_HOST','Open the printed local workspace address.',403);
      if(connectionsWorkspace){
        if(await connectionsWorkspace.oauth.callback(request,response,url))return;
        if(connectionsWorkspace.oauth.returned(response,url))return;
      }
      if(request.method==='GET'&&STATIC.has(path)){const asset=STATIC.get(path);send(response,200,await readFile(asset.url),{type:asset.type});return;}
      if(request.method==='GET'&&(path==='/customer-statements'||path.startsWith('/customer-statements/'))){
        const asset=await customerStatementAsset(path);if(asset){send(response,200,asset.bytes,{type:asset.type});return;}
      }
      if(request.method==='GET'&&(path==='/delivery-notices'||path.startsWith('/delivery-notices/'))){
        const asset=await deliveryNoticeAsset(path);if(asset){send(response,200,asset.bytes,{type:asset.type});return;}
      }
      const maintenancePath=path==='/api/maintenance'||path.startsWith('/api/maintenance/');
      const connectionsPath=path==='/api/oauth/connections'||path==='/api/oauth/connection'||path==='/api/oauth/command'||path==='/api/accounting-connections'||path.startsWith('/api/accounting-connections/');
      if(!maintenancePath&&!connectionsPath)operation=maintenance.enter();
      if(path===SIGNED_NOTICE_PATH){
        check(request.method==='POST'&&!url.search,'NOT_FOUND','This signed delivery endpoint accepts original POST notices only.',404);
        const accepted=await operation.delivery.acceptSigned(await readSignedNotice(request));
        send(response,accepted.duplicate?200:202,accepted);return;
      }
      let value;
      if(request.method==='POST'){
        check(request.headers['x-workspace-request']==='1','WORKSPACE_REQUEST_REQUIRED','Use the operator workspace form.',403);
        check(!request.headers.origin||request.headers.origin==='http://'+request.headers.host,'INVALID_ORIGIN','Use this local workspace address.',403);
        value=await body(request,connectionsPath?ACCOUNTING_CONNECTION_REQUEST_BYTES:path.startsWith('/api/runbooks/')?RUNBOOK_REQUEST_BYTES:path.startsWith('/api/cryptoworth/')?CRYPTOWORTH_REQUEST_BYTES:path.startsWith('/api/customer-statements/')?STATEMENT_REQUEST_BYTES:path.startsWith('/api/qbo/')?QBO_REQUEST_BYTES:path.startsWith('/api/xero/')?XERO_REQUEST_BYTES:path.startsWith('/api/bitwave/')?BITWAVE_REQUEST_BYTES:path.startsWith('/api/accountant/')?ACCOUNTANT_REQUEST_BYTES:path==='/api/collection/sources'?8_200_000:path==='/api/pricing/reviews'?PRICING_REQUEST_BYTES:600_000);
      }
      const parts=path.split('/').filter(Boolean),query=Object.fromEntries(url.searchParams);
      if(connectionsPath){
        check(connectionsWorkspace,'ACCOUNTING_CONNECTION_SETUP_REQUIRED','Use the reviewed managed accounting Application to configure provider connections.',409);
        const connected=await handleAccountingConnections(connectionsWorkspace,{method:request.method,path,value,query,scope:request.headers['x-accounting-connection-scope']});
        check(connected,'NOT_FOUND','This connection operation was not found.',404);
        if(connected.file)send(response,200,connected.file.bytes,{type:connected.file.type,name:connected.file.name});
        else send(response,200,connected.value);return;
      }
      if(maintenancePath){send(response,200,await maintenance.route({method:request.method,path,value}));return;}
      const {workspace,accountant,cryptoworth,runbooks,bitwave,qbo,xero,collection,statements,delivery}=operation;
      const runbookResult=await handleRunbookRequest(runbooks,{method:request.method,path,query,value});
      if(runbookResult){if(runbookResult.file)send(response,200,runbookResult.file.bytes,{type:runbookResult.file.type,name:runbookResult.file.name});else send(response,200,runbookResult.value);return;}
      const cryptoworthResult=await handleCryptoworthRequest(cryptoworth,{method:request.method,path,query,value});
      if(cryptoworthResult){if(cryptoworthResult.file)send(response,200,cryptoworthResult.file.bytes,{type:cryptoworthResult.file.type,name:cryptoworthResult.file.name});else send(response,200,cryptoworthResult.value);return;}
      const deliveryResult=await handleDeliveryNoticeRequest(delivery,{method:request.method,path,query,value});
      if(deliveryResult){send(response,200,deliveryResult.value);return;}
      const statement=await handleCustomerStatementRequest(statements,{method:request.method,path,query,value});
      if(statement){if(statement.file)send(response,200,statement.file.bytes,{type:statement.file.type,name:statement.file.name});else send(response,200,statement.value);return;}
      const adjustment=await handleAdjustmentRequest(workspace.adjustments,{method:request.method,path,query,value});
      if(adjustment){if(adjustment.file)send(response,200,adjustment.file.bytes,{type:adjustment.file.type,name:adjustment.file.name});else send(response,200,adjustment.value);return;}
      const bitwaveResult=await handleBitwaveRequest(bitwave,{method:request.method,path,query,value});
      if(bitwaveResult){if(bitwaveResult.file)send(response,200,bitwaveResult.file.bytes,{type:bitwaveResult.file.type,name:bitwaveResult.file.name});else send(response,200,bitwaveResult.value);return;}
      const qboResult=await handleQboRequest(qbo,{method:request.method,path,query,value});
      if(qboResult){if(qboResult.file)send(response,200,qboResult.file.bytes,{type:qboResult.file.type,name:qboResult.file.name});else send(response,200,qboResult.value);return;}
      const xeroResult=await handleXeroRequest(xero,{method:request.method,path,query,value});
      if(xeroResult){if(xeroResult.file)send(response,200,xeroResult.file.bytes,{type:xeroResult.file.type,name:xeroResult.file.name});else send(response,200,xeroResult.value);return;}
      const accountingHandoff=await handleAccountantRequest(accountant,{method:request.method,path,query,value});
      if(accountingHandoff){if(accountingHandoff.file)send(response,200,accountingHandoff.file.bytes,{type:accountingHandoff.file.type,name:accountingHandoff.file.name});else send(response,200,accountingHandoff.value);return;}
      const pricing=await handlePricingRequest(workspace,{method:request.method,path,query,value});
      if(pricing){if(pricing.file)send(response,200,pricing.file.bytes,{type:TYPES['.json'],name:pricing.file.name});else send(response,200,pricing.value);return;}
      const period=await handlePeriodRequest(workspace,{method:request.method,path,query,value});
      if(period){if(period.file)send(response,200,period.file.bytes,{type:period.type,name:period.file.name});else send(response,200,period.value);return;}
      let result;
      if(parts[0]==='api'&&parts[1]==='collection'){
        result=await collection.route(request.method,parts,value);
        if(result?.download){const file=result.download;send(response,200,file.bytes,{type:file.type,name:file.name});return;}
      }
      else if(path==='/api/state'&&request.method==='GET')result=workspace.view();
      else if(path==='/api/recovered/source'&&request.method==='POST')result=await workspace.connectRecovered(value);
      else if(path==='/api/recovered/refresh'&&request.method==='POST')result=await workspace.refreshRecovered(value);
      else if(path==='/api/recovered/review'&&request.method==='POST')result=await workspace.reviewRecovery(value);
      else if(path==='/api/recovered/import'&&request.method==='POST')result=await workspace.importRecovery(value);
      else if(parts.length===5&&parts[0]==='api'&&parts[1]==='recovered'&&parts[2]==='jobs'&&parts[4]==='cancel'&&request.method==='POST')result=await workspace.cancelRecovery(parts[3],value);
      else if(parts.length===4&&parts[0]==='api'&&parts[1]==='recovered'&&parts[3]==='response'&&request.method==='GET'){
        const file=await workspace.recoveredResponse(parts[2]);send(response,200,file.bytes,{type:file.type,name:file.name});return;
      }
      else if(path==='/api/proofs'&&request.method==='POST')result=await workspace.importProof(value);
      else if(parts.length===4&&parts[0]==='api'&&parts[1]==='proofs'&&parts[3]==='selection'&&request.method==='POST')result=await workspace.selectProof(parts[2],value);
      else if(path==='/api/terms'&&request.method==='POST')result=await workspace.importTerms(value);
      else if(path==='/api/terms/selection'&&request.method==='POST')result=await workspace.selectTerms(value);
      else if(path==='/api/runs'&&request.method==='POST')result=await workspace.begin(value);
      else if(parts[0]==='api'&&parts[1]==='runs'&&parts[2]){
        const id=parts[2];
        if(parts.length===3&&request.method==='GET')result=await workspace.run(id);
        else if(parts.length===4&&['ledger','options','exceptions','proofs','recovered'].includes(parts[3])&&request.method==='GET')result=await workspace.rows(id,parts[3],query);
        else if(parts.length===4&&parts[3]==='compare'&&request.method==='GET')result=await workspace.compare(id,query.baseline,query);
        else if(parts.length===6&&parts[3]==='exceptions'&&parts[5]==='review'&&request.method==='POST')result=await workspace.review(id,parts[4],value);
        else if(parts.length===4&&parts[3]==='exports'&&request.method==='POST')result=await workspace.exportRun(id,value);
        else if(parts.length===5&&parts[3]==='download'&&request.method==='GET'){
          const file=await workspace.download(id,parts[4]);send(response,200,file.bytes,{type:TYPES[file.name.slice(file.name.lastIndexOf('.'))]??'application/octet-stream',name:file.name});return;
        }
        else if(parts.length===6&&parts[3]==='recovered'&&parts[5]==='response'&&request.method==='GET'){
          const file=await workspace.recoveredResponse(parts[4],id);send(response,200,file.bytes,{type:file.type,name:file.name});return;
        }
      }else if(parts.length===4&&parts[0]==='api'&&parts[1]==='exports'&&parts[3]==='download'&&request.method==='GET'){
        const file=await workspace.archive(parts[2]);send(response,200,file.bytes,{type:TYPES['.tar'],name:file.name});return;
      }
      check(result!==undefined,'NOT_FOUND','This workspace operation was not found.',404);send(response,200,result);
    }catch(error){send(response,error.status??400,{error:error.code??'WORKSPACE_OPERATION_FAILED',message:String(error.message??error).slice(0,2000),...(error.applied===false?{applied:false}:{})});}
    finally{operation?.release();}
  });
  server.requestTimeout=30_000;server.headersTimeout=15_000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
  catch(error){await maintenance.close();throw error;}
  const actual=server.address().port,origin=new URL('http://127.0.0.1:'+actual).origin;
  hosts.add(new URL(origin).host);hosts.add(new URL('http://localhost:'+actual).host);
  let closing;
  return {get binding(){const value=maintenance.runtime?.workspace;return value?accountingWorkspaceBinding(value.directory,value.state):null;},get workspace(){return maintenance.runtime?.workspace;},get collection(){return maintenance.runtime?.collection;},
    get accountant(){return maintenance.runtime?.accountant;},get runbooks(){return maintenance.runtime?.runbooks;},get cryptoworth(){return maintenance.runtime?.cryptoworth;},get bitwave(){return maintenance.runtime?.bitwave;},get qbo(){return maintenance.runtime?.qbo;},get xero(){return maintenance.runtime?.xero;},get statements(){return maintenance.runtime?.statements;},get delivery(){return maintenance.runtime?.delivery;},maintenance,server,url:origin,
    close(){if(!closing)closing=(async()=>{
      const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      const results=await Promise.allSettled([stopped,maintenance.close()]);const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    })();return closing;}};
}

const HELP=`Merchant settlement workspace

Create:
  node workspace/server.mjs --workspace /private/accounting-workspace \\
    --outbox /private/merchant-outbox --proof-dir /private/sf86-results \\
    --terms /private/accounting-terms.json

Reopen:
  node workspace/server.mjs --workspace /private/accounting-workspace

Optional: --port 8446 and --recovered-dir /private/original-recovered-settlements.
Signed SF98 accounting intake: --delivery-secret-env ACCOUNTING_SF98_SECRET.
Expose only POST /sf98/accounting-events through the existing trusted HTTPS proxy.
Open /delivery-notices/ for received notices and original capture/recovery.
Browser backup and recovery: --recovery-state-root /private/state
  --recovery-backup-root /private/accounting-backups
  --recovery-pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE
Add --recovery-start-paused to restore an absent or unfinished original workspace.
For an explicitly configured cloud HTTPS proxy, add --rpc-proxy-env HTTPS_PROXY.
Requires Node22+, Linux flock, and tar for review downloads.
Uses the original accounting engine and report writer; all serving is loopback.
QuickBooks journals: open /qbo.html to fetch the configured company and post reviewed journals.
Native QuickBooks calls use STARFORGE_QBO_ACCESS_TOKEN, STARFORGE_QBO_REALM_ID,
and STARFORGE_QBO_ENVIRONMENT (sandbox by default) in this process environment.
Client procedures: open /runbooks.html or use the runbooks subcommand.
Cryptoworth imports: open /cryptoworth.html or use the cryptoworth subcommand.
Use the customer's original template and native Crypto IDs; retain the returned import.
Xero journals: open /xero.html or use the xero subcommand.
Native Xero calls use STARFORGE_XERO_ACCESS_TOKEN from this process environment.
Operating backup and recovery: backup | inspect-backup | verify-backup | restore | recovery-status.
Use a recovery subcommand with --help for the original encrypted workflow.
`;
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){process.stdout.write(HELP+'\n'+RECOVERY_HELP+'\n'+ADJUSTMENTS_HELP+'\n'+XERO_HELP+'\n'+CRYPTOWORTH_HELP+'\n'+RUNBOOK_HELP);return;}
  if(argv[0]==='runbooks')return runbooksMain(argv.slice(1));
  if(argv.includes('--managed-launch-sha256')){
    const {accountingManagedArguments,startManagedAccountingWorkspace}=await import('./managed-launch.mjs');
    const selected=accountingManagedArguments(argv);
    const app=await startManagedAccountingWorkspace(selected.settings,{expectedSha256:selected.expectedSha256,
      startWorkspace:startAccountingWorkspace});
    const stop=()=>app.close().then(()=>process.exit(0),error=>{console.error(error.message);process.exit(1);});
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  if(argv[0]==='cryptoworth')return cryptoworthMain(argv.slice(1));
  if(argv[0]==='xero')return xeroMain(argv.slice(1));
  if(argv[0]==='adjustments')return adjustmentsMain(argv.slice(1));
  if(RECOVERY_COMMANDS.has(argv[0])){
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{return await recoveryMain(argv,{signal:controller.signal});}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }
  const keys=new Set(['--workspace','--outbox','--proof-dir','--terms','--port','--recovered-dir','--rpc-proxy-env',
    '--recovery-state-root','--recovery-backup-root','--recovery-pass-env','--delivery-secret-env','--expected-workspace-id','--expected-sources-sha256','--desk']),values={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];check(!Object.hasOwn(values,key),'INVALID_ARGUMENTS',HELP);
    if(key==='--recovery-start-paused'){values[key]=true;continue;}
    check(keys.has(key)&&argv[i+1]&&!argv[i+1].startsWith('--'),'INVALID_ARGUMENTS',HELP);values[key]=argv[++i];
  }
  check(values['--workspace'],'WORKSPACE_REQUIRED',HELP);
  check(values['--desk']===undefined||['accounting','cryptoworth','runbooks'].includes(values['--desk']),'INVALID_DESK','Choose the original accounting, Cryptoworth or client-runbook desk.');
  const app=await startAccountingWorkspace({directory:resolve(values['--workspace']),
    expectedWorkspaceId:values['--expected-workspace-id'],expectedSourcesSha256:values['--expected-sources-sha256'],
    outboxDir:values['--outbox']&&resolve(values['--outbox']),proofDir:values['--proof-dir']&&resolve(values['--proof-dir']),termsFile:values['--terms']&&resolve(values['--terms']),
    recoveredDir:values['--recovered-dir']&&resolve(values['--recovered-dir']),
    recoveryStateRoot:values['--recovery-state-root']&&resolve(values['--recovery-state-root']),
    recoveryBackupRoot:values['--recovery-backup-root']&&resolve(values['--recovery-backup-root']),
    recoveryPassEnv:values['--recovery-pass-env'],recoveryStartPaused:values['--recovery-start-paused']??false,
    rpcProxyEnv:values['--rpc-proxy-env'],deliverySecretEnv:values['--delivery-secret-env'],
    port:values['--port']===undefined?8446:Number(values['--port'])});
  if(values['--expected-workspace-id']!==undefined){
    try{
      const binding=app.binding;
      check(binding,'ACCOUNTING_WORKSPACE_NOT_OPEN','Resume the original accounting workspace before starting its managed desk.');
      process.stdout.write(JSON.stringify({schema:'stellar-forge.accounting-workspace-startup.v1',status:'ACCOUNTING_WORKSPACE_READY',directory:binding.directory,
        workspaceId:binding.workspaceId,sourcesSha256:binding.sourcesSha256,revision:app.workspace.state.revision,
        operatorUrl:app.url+({cryptoworth:'/cryptoworth.html',runbooks:'/runbooks.html'}[values['--desk']]??'/')})+'\n');
    }catch(error){await app.close();throw error;}
  }
  process.stdout.write('Merchant accounting workspace: '+app.url+'\n');
  const close=()=>app.close().then(()=>process.exit(0),error=>{console.error(error.message);process.exit(1);});
  process.once('SIGINT',close);process.once('SIGTERM',close);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
