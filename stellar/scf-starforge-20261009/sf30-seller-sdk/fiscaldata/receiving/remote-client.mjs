// MIT. One original refresh workspace -> authenticated client -> complete portable receiving.
// The caller owns the admitted native operation and closes its model before this callback.
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, lstat, rename } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SCHEMA='stellar-forge.fiscaldata-remote-client-receiving.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code:'FISCALDATA_RECEIVING_'+code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const encode=x=>Buffer.from(JSON.stringify(canonical(x),null,2)+'\n');
const digest=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b)=>encode(a).equals(encode(b));
function check(value,message){if(!value)fail('ASSERTION',message);}
async function maybeJSON(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path){
  check(isAbsolute(path)&&resolve(path)===path&&path!=='/','Choose one canonical private receiving directory.');
  await mkdir(path,{recursive:true,mode:0o700});
  check(await realpath(path)===path,'Keep receiving directories free of symbolic links.');
  const st=await lstat(path);
  check(st.isDirectory()&&!st.isSymbolicLink()&&!(st.mode&0o077)&&
    (!process.getuid||st.uid===process.getuid()),'Keep original receiving directories owned and 0700.');
}
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
async function metadata(path,value,{immutable=false}={}){
  const data=encode(value);
  // Every call is beneath this receiving operation's held kernel lease.
  // Rename a complete private temporary so a terminated publication cannot leave
  // a second hard link on the original connection file's required nlink=1.
  if(immutable){
    let existing;try{existing=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing){check(existing.equals(data),'An immutable receiving record changed.');return;}
  }
  const tmp=join(dirname(path),'.receiving-'+randomUUID()+'.partial');
  const h=await open(tmp,'wx',0o600);try{await h.writeFile(data);await h.sync();}finally{await h.close();}
  check((await readFile(tmp)).equals(data),'A staged receiving record changed.');
  await rename(tmp,path);await syncDirectory(dirname(path));
}
async function fileIdentity(path){
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await h.stat({bigint:true});check(before.isFile(),'Select a regular original source file.');
    const hash=createHash('sha256'),git=createHash('sha1').update(Buffer.from('blob '+before.size+'\0'));
    let bytes=0;for await(const chunk of h.createReadStream({autoClose:false})){hash.update(chunk);git.update(chunk);bytes+=chunk.length;}
    const after=await h.stat({bigint:true});
    check(bytes===Number(before.size)&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k]),
      'An original file changed during its exact receiving read.');
    return{bytes,sha256:hash.digest('hex'),gitBlob:git.digest('hex')};
  }finally{await h.close();}
}
function sourcePath(root,path){return join(root,...path.split('/'));}
function collection(snapshot,name){
  const value=snapshot[name];return Array.isArray(value)?value:value?.items??[];
}
function record(snapshot,group,id){const item=collection(snapshot,group).find(v=>v.id===id);
  check(item,'The retained '+group+' record is missing: '+id);return item;}
function verifySnapshot(snapshot,expected){
  check(snapshot.schema==='stellar-forge.fiscaldata-workspace.v1','The received original model schema changed.');
  for(const [group,id,sha]of[
    ['editions',expected.editionId,expected.editionSha256],
    ['comparisons',expected.comparisonId,expected.comparisonSha256],
    ['exports',expected.exportId,expected.exportSha256],
    ['exports',expected.briefingExportId,expected.briefingSha256],
    ['refreshPlans',expected.planId,expected.planSha256],
    ['refreshRuns',expected.completedRunId,expected.completedRunSha256]
  ]){
    const item=record(snapshot,group,id);
    check(item.sha256===sha,'The exact retained '+group+' source binding changed.');
    if(['editions','comparisons','exports'].includes(group))check(item.status==='READY','A completed source record is no longer READY.');
  }
  const completed=record(snapshot,'refreshRuns',expected.completedRunId),paused=record(snapshot,'refreshRuns',expected.pausedRunId);
  check(completed.status==='COMPLETE','The original completed refresh run changed state.');
  check(paused.planId===expected.planId&&paused.desiredState==='PAUSED'&&
    ['PAUSED','REVIEW_REQUIRED'].includes(paused.status),'The next retained refresh run must stay paused.');
  check(same(paused.period,expected.pausedRunPeriod),'The selected next refresh period changed.');
  return{revision:snapshot.revision,editionId:expected.editionId,comparisonId:expected.comparisonId,
    completedRunId:completed.id,completedRunSha256:completed.sha256,planId:expected.planId,
    planSha256:expected.planSha256,pausedRunId:paused.id,pausedRunStatus:paused.status,pausedRunPeriod:paused.period};
}
function validateExpected(value){
  check(plain(value),'Pass the actual completed refresh selection.');
  for(const key of ['workspaceId','editionId','comparisonId','exportId','briefingExportId','planId','completedRunId','pausedRunId'])
    check(UUID.test(value[key]??''),'Pass the original '+key+'.');
  for(const key of ['editionSha256','comparisonSha256','exportSha256','briefingSha256','planSha256','completedRunSha256'])
    check(SHA.test(value[key]??''),'Pass the exact original '+key+'.');
  for(const key of ['deliveryFileSha256','briefingFileSha256'])
    if(value[key]!==undefined)check(SHA.test(value[key]),'Pass the exact original archive SHA-256.');
  check(plain(value.pausedRunPeriod),'Retain the original next-period selection.');
}
const OPERATOR='stellar-forge/mcp-merchant-operator/';
const FISCAL='stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/';
const REQUIRED=[
 OPERATOR+'fiscaldata-workspace-client.mjs',OPERATOR+'fiscaldata-workspace-download.mjs',
 OPERATOR+'fiscaldata-workspace-cli.mjs',OPERATOR+'fiscaldata-workspace.mjs',
 OPERATOR+'catalog/fiscaldata-workspace.mjs',OPERATOR+'retained-download.mjs',
 OPERATOR+'retained-file-reads.mjs',OPERATOR+'retained-file-contracts.mjs',OPERATOR+'host-files.mjs',
 'stellar-forge/mcp-paid-agent/http-tools.mjs',
 'stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs',
 'stellar/scf-starforge-20261009/sf33-failure-contract/contract.mjs',
 FISCAL+'workspace-model.mjs',FISCAL+'portable.mjs',FISCAL+'refresh.mjs',FISCAL+'briefing.mjs',
 FISCAL+'briefing-render.mjs',FISCAL+'capture.mjs',FISCAL+'decimal.mjs',FISCAL+'publishing.mjs'
];

/**
 * Run once after the original refresh/browser model is CLOSED.
 * Retries use the same arguments/output, retained endpoint, download selection and
 * native package/receiving operation IDs. No source/capture, buyer or payer runs.
 */
export async function runFiscalRemoteReceiving({directory,outputDirectory,sourceRoot,operationId,actor,expectedRefresh}={}){
  process.umask(0o077);validateExpected(expectedRefresh);
  check(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,109}$/.test(operationId),'Retain one receiving operation ID.');
  check(plain(actor)&&typeof actor.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(actor.id)&&
    typeof actor.label==='string'&&actor.label.trim(),'Retain the actual named operator.');
  for(const path of [directory,sourceRoot,outputDirectory])
    check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/','Select canonical original paths.');
  check(await realpath(directory)===directory&&await realpath(sourceRoot)===sourceRoot,'Select the original source and workspace paths.');
  check(outputDirectory!==directory&&!outputDirectory.startsWith(directory+'/')&&!directory.startsWith(outputDirectory+'/'),
    'Keep receiving outputs and its single detached workspace beside the original workspace.');
  await privateDirectory(outputDirectory);
  const modules=async path=>import(pathToFileURL(sourcePath(sourceRoot,path)).href);
  const {acquireStateLease}=await modules('stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs');
  const lease=await acquireStateLease(outputDirectory);
  let adapter,server,client,closing=false;const pending=new Set(),sockets=new Set();
  let result,error;
  try{
    const header=await maybeJSON(join(directory,'workspace.json')),st=await lstat(directory,{bigint:true});
    check(header?.id===expectedRefresh.workspaceId,'The source workspace is not the selected original UUID.');
    const source=[];for(const path of REQUIRED)source.push({path,...await fileIdentity(sourcePath(sourceRoot,path))});
    const callback=await fileIdentity(fileURLToPath(import.meta.url));
    const intent={schema:SCHEMA,operationId,directory,outputDirectory,sourceRoot,actor,expectedRefresh,
      workspace:{id:header.id,createdAt:header.createdAt,directoryIdentity:{dev:String(st.dev),ino:String(st.ino)}},source,callback};
    const intentPath=join(outputDirectory,'intent.json'),existingIntent=await maybeJSON(intentPath);
    if(existingIntent)check(same(existingIntent,intent),'Continue this exact source, actor and retained refresh selection.');
    else await metadata(intentPath,intent,{immutable:true});
    let progress=await maybeJSON(join(outputDirectory,'progress.json'))??{schema:SCHEMA,operationId,createdAt:new Date().toISOString(),endpoint:null,stages:{}};
    const save=async()=>{lease.assertHeld();await metadata(join(outputDirectory,'progress.json'),progress);};
    const stage=async(name,value)=>{progress.stages[name]=value;progress.updatedAt=new Date().toISOString();await save();};
    const {connectFiscalWorkspace}=await modules(OPERATOR+'fiscaldata-workspace-client.mjs');
    const downloads=await modules(OPERATOR+'fiscaldata-workspace-download.mjs');
    const prior=await maybeJSON(join(outputDirectory,'result.json'));
    if(prior){
      check(prior.state==='COMPLETE'&&prior.operationId===operationId,'Use the same complete receiving outcome.');
      for(const name of ['delivery','briefing','package']){
        const value=prior.downloads[name];await downloads.verifyFiscalDownload({directory:value.directory,expectedSelectionSha256:value.manifestSha256});
      }
      const reopened=await downloads.inspectReceivedFiscalWorkspace({directory:prior.receivedDirectory,expectedWorkspaceId:expectedRefresh.workspaceId});
      verifySnapshot(reopened.snapshot,expectedRefresh);return{...prior,reused:true};
    }

    const support=join(outputDirectory,'host');await privateDirectory(support);
    const connectionPath=join(outputDirectory,'connection.json');
    const connectionDocument={schema:'stellar-forge.fiscaldata-workspace-connection.v1',operator:actor,
      workspaces:{treasury:{label:'Original reviewed Treasury refresh',directory,imports:{},merchants:{},buyerWorkspaces:{},runtime:{port:0}}}};
    await metadata(connectionPath,connectionDocument,{immutable:true});
    const native=await modules(OPERATOR+'fiscaldata-workspace.mjs');
    const connection=await native.readFiscalDataWorkspaceConfiguration(connectionPath);
    connection.workspaces.treasury.expectedWorkspace=intent.workspace;
    adapter=new native.MerchantFiscalDataWorkspaces({fiscalDataWorkspaces:connection,exportsDirectory:support});
    const {fiscalDataWorkspaceTools}=await modules(OPERATOR+'catalog/fiscaldata-workspace.mjs');
    const {createMcpToolHandler}=await modules('stellar-forge/mcp-paid-agent/http-tools.mjs');
    const token=randomBytes(32).toString('hex'),tokenEnv='FISCAL_RECEIVING_ACCESS_TOKEN';
    const environment={...process.env,[tokenEnv]:token};
    const tools=fiscalDataWorkspaceTools((name,description,properties,required,flags={})=>({
      name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
      annotations:{readOnlyHint:flags.readOnly===true,idempotentHint:flags.idempotent===true,
        destructiveHint:flags.destructive===true,openWorldHint:flags.openWorld===true}
    }));
    const handler=createMcpToolHandler({tools,call:(name,args)=>adapter.call(name,args)},
      {bearerToken:token,maxRequestBytes:1024*1024,serverName:'Fiscal source receiving',serverVersion:'1.0.0',
        instructions:'Use the declared named Fiscal workspace. This receiving operation makes no purchase or publication.'});
    server=createServer((req,res)=>{
      if(closing){res.writeHead(503);res.end();return;}
      const task=handler(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
      pending.add(task);task.finally(()=>pending.delete(task));
    });
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    server.requestTimeout=120000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
    const port=progress.endpoint?Number(new URL(progress.endpoint).port):0;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    const endpoint='http://127.0.0.1:'+server.address().port+'/mcp';
    if(progress.endpoint)check(progress.endpoint===endpoint,'Resume the same retained download endpoint.');
    else{progress.endpoint=endpoint;await save();}
    const connect=()=>connectFiscalWorkspace({url:endpoint,tokenEnv,environment,workspace:'treasury',
      expectedWorkspaceId:expectedRefresh.workspaceId,timeoutMs:120000});
    client=await connect();
    const denied=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    check(denied.status===401,'The original HTTP endpoint must require its bearer token.');await denied.body?.cancel();
    const forbidden=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,
      origin:'https://unapproved.invalid','content-type':'application/json'},body:'{}'});
    check(forbidden.status===403,'The original HTTP endpoint must reject an unapproved browser origin.');await forbidden.body?.cancel();
    let opened=await client.open();check(same(opened.operator,actor),'The original host changed its named operator.');
    const before=verifySnapshot(opened.native,expectedRefresh);
    const fullPlan=await client.value('refresh.plans.get',{id:expectedRefresh.planId});
    const fullRun=await client.value('refresh.runs.get',{id:expectedRefresh.completedRunId});
    const nextRun=await client.value('refresh.runs.get',{id:expectedRefresh.pausedRunId});
    check(fullPlan.sha256===expectedRefresh.planSha256&&fullRun.sha256===expectedRefresh.completedRunSha256,
      'The full native refresh records changed.');
    check(nextRun.desiredState==='PAUSED'&&same(nextRun.period,expectedRefresh.pausedRunPeriod),'The next period must not start during receiving.');
    await stage('authenticatedSource',{endpoint,operator:opened.operator,workspaceId:opened.workspaceId,
      instanceId:opened.instanceId,httpWithoutToken:401,httpForeignOrigin:403,...before});

    const cliPath=sourcePath(sourceRoot,OPERATOR+'fiscaldata-workspace-cli.mjs');
    const cliRoot=join(outputDirectory,'cli');await privateDirectory(cliRoot);
    async function cli(label,args,{remote=true}={}){
      check(/^[a-z0-9-]+$/.test(label),'Use a stable CLI step label.');
      const attempt=join(cliRoot,label+'-'+randomUUID());await privateDirectory(attempt);
      const argv=['--max-old-space-size=128',cliPath,...args,...(remote?
        ['--url',endpoint,'--workspace','treasury','--workspace-id',expectedRefresh.workspaceId,'--token-env',tokenEnv]:[])];
      await metadata(join(attempt,'intent.json'),{schema:SCHEMA,operationId,label,executable:process.execPath,argv},{immutable:true});
      const out=await open(join(attempt,'stdout.json'),'wx',0o600),err=await open(join(attempt,'stderr.log'),'wx',0o600);
      let child,outcome;
      try{
        child=spawn(process.execPath,argv,{env:environment,stdio:['ignore',out.fd,err.fd]});
        outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
        await out.sync();await err.sync();
      }finally{await out.close();await err.close();}
      await metadata(join(attempt,'result.json'),{...outcome,endedAt:new Date().toISOString()},{immutable:true});
      check(outcome.code===0,'The original CLI '+label+' failed; retain its complete stdout and stderr at '+attempt+'.');
      const observed=await maybeJSON(join(attempt,'stdout.json'));
      await stage('cli-'+label,{directory:attempt,...outcome,stdout:await fileIdentity(join(attempt,'stdout.json')),
        stderr:await fileIdentity(join(attempt,'stderr.log'))});
      return observed;
    }
    const plans=await cli('plans',['list','--section','refreshPlans','--limit','1']);
    check(plans.items.some(p=>p.id===expectedRefresh.planId&&p.sha256===expectedRefresh.planSha256),'CLI pagination lost the reviewed plan.');
    const queried=await cli('query',['query','--id',expectedRefresh.editionId,'--query','limit=2']);
    check(queried.state?.schema==='stellar-forge.fiscaldata-workspace.v1'&&
      Array.isArray(queried.result?.rows)&&queried.result.rows.length===2,'The native CLI must retain the two queried rows in its original envelope.');
    await stage('query',{rows:queried.result.rows,query:'limit=2',editionId:expectedRefresh.editionId});

    async function selected(label,kind,id,expectedSha256){
      const result=await downloads.selectFiscalDownload({client,kind,id,expectedSha256});
      const path=join(outputDirectory,label+'-selection.json');
      await downloads.writeFiscalSelection(path,result.selection);
      await stage(label+'Selection',{path,...result});return result;
    }
    const delivery=await selected('delivery','export',expectedRefresh.exportId,expectedRefresh.exportSha256);
    const deliveryDirectory=join(outputDirectory,'delivery');
    if(!progress.stages.interruptedDownload){
      const controller=new AbortController();let stopped=false;
      try{
        await downloads.downloadFiscalSelection({client,selection:delivery.selection,directory:deliveryDirectory,
          expectedSelectionSha256:delivery.selectionSha256,chunkSize:1024,signal:controller.signal,
          onProgress:async value=>{
            if(!stopped&&value.bytes>0&&value.bytes<value.total){
              stopped=true;
              await stage('interruptedDownload',{...value,selectionSha256:delivery.selectionSha256,observedAt:new Date().toISOString()});
              controller.abort(Object.assign(new Error('Retain the original durable prefix before reconnecting.'),{code:'FISCAL_RECEIVING_INTERRUPTED'}));
            }
          }});
      }catch(failure){if(!controller.signal.aborted)throw failure;}
      check(stopped,'Select a complete delivery containing at least one original file larger than a chunk.');
    }
    const originalInstance=opened.instanceId;
    await client.dispose();client=null;
    check(adapter.summary.opened.includes('treasury'),'Disposing a local client must not close the borrowed source model.');
    client=await connect();opened=await client.assertOpen();
    check(opened.instanceId===originalInstance,'Reconnect must preserve the original owned model instance.');
    const resumed=await downloads.downloadFiscalSelection({client,selection:delivery.selection,directory:deliveryDirectory,
      expectedSelectionSha256:delivery.selectionSha256,chunkSize:196608});
    check(resumed.state==='COMPLETE'&&resumed.resumed&&resumed.resumedBytes>0,'Resume the same exact retained prefix and complete every delivery file.');
    await stage('deliveryDownload',resumed);
    const verifiedDelivery=await cli('verify-delivery',['verify','--directory',deliveryDirectory,
      '--selection-sha256',delivery.selectionSha256],{remote:false});
    check(verifiedDelivery.state==='VERIFIED','The actual CLI must verify all original delivery members.');
    const brief=await selected('briefing','export',expectedRefresh.briefingExportId,expectedRefresh.briefingSha256);
    const briefDirectory=join(outputDirectory,'briefing');
    const briefDownload=await cli('download-briefing',['download','--selection',join(outputDirectory,'briefing-selection.json'),
      '--selection-sha256',brief.selectionSha256,'--out',briefDirectory]);
    check(briefDownload.state==='COMPLETE','The complete original briefing must be downloaded by the installed CLI.');
    await downloads.verifyFiscalDownload({directory:briefDirectory,expectedSelectionSha256:brief.selectionSha256});

    async function archive(label,directory,selection,name,expected){
      const descriptor=selection.files.find(f=>f.name===name);check(descriptor,'The original '+label+' archive is missing.');
      if(expected)check(descriptor.sha256===expected,'The full archive differs from its original browser download.');
      const path=join(directory,name),actual=await fileIdentity(path);
      check(actual.sha256===descriptor.sha256&&actual.bytes===descriptor.bytes,'The returned archive bytes changed.');
      const attempt=join(outputDirectory,label+'-archive-members.txt'),tmp=attempt+'.'+randomUUID()+'.partial';
      const out=await open(tmp,'wx',0o600);let outcome;
      try{
        const child=spawn('tar',['-tzf',path],{stdio:['ignore',out.fd,'pipe']});const errors=[];
        child.stderr.on('data',chunk=>errors.push(chunk));
        outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stderr:Buffer.concat(errors).toString('utf8')}));});
        await out.sync();
      }finally{await out.close();}
      check(outcome.code===0,'The verified archive cannot be listed: '+label+'.');
      await rename(tmp,attempt);await syncDirectory(outputDirectory);
      const names=(await readFile(attempt,'utf8')).split('\n').filter(Boolean);
      check(names.length>0&&names.every(n=>!n.startsWith('/')&&!n.split('/').includes('..')),'The native archive must retain relative original members.');
      return{name,path,...actual,members:names.length,memberList:await fileIdentity(attempt)};
    }
    const archives={
      delivery:await archive('delivery',deliveryDirectory,delivery.selection,'delivery.tar.gz',expectedRefresh.deliveryFileSha256),
      briefing:await archive('briefing',briefDirectory,brief.selection,'briefing.tar.gz',expectedRefresh.briefingFileSha256)
    };
    await stage('completeArchives',archives);
    const checkpoint=await client.checkpoint(operationId+'.checkpoint');
    check(checkpoint.workspace.id===expectedRefresh.workspaceId,'The sealed package must belong to this original workspace.');
    await stage('checkpoint',checkpoint);
    const packaged=await selected('package','package',checkpoint.packageId,
      checkpoint.files.find(file=>file.name==='workspace.fiscal.gz')?.sha256);
    const current=await client.assertOpen();
    await client.closeWorkspace(current.instanceId);
    check((await client.status()).state==='CLOSED','Close the source before detached receiving.');
    const packageDirectory=join(outputDirectory,'package');
    const packageDownload=await cli('download-package',['download','--selection',join(outputDirectory,'package-selection.json'),
      '--selection-sha256',packaged.selectionSha256,'--out',packageDirectory]);
    check(packageDownload.state==='COMPLETE','Read every sealed package byte while the source alias is CLOSED.');
    await client.dispose();client=null;
    const receivedDirectory=join(outputDirectory,'received-workspace');
    const received=await cli('receive',['receive','--directory',packageDirectory,'--destination',receivedDirectory,
      '--operation-id',operationId+'.receive','--operator-id',actor.id,'--operator-label',actor.label,
      '--workspace-id',expectedRefresh.workspaceId,'--selection-sha256',packaged.selectionSha256],{remote:false});
    check(received.state==='RECEIVED','Receive this one original package through the installed portable CLI.');
    const receivingReplay=await cli('receive-retry',['receive','--directory',packageDirectory,'--destination',receivedDirectory,
      '--operation-id',operationId+'.receive','--operator-id',actor.id,'--operator-label',actor.label,
      '--workspace-id',expectedRefresh.workspaceId,'--selection-sha256',packaged.selectionSha256],{remote:false});
    check(receivingReplay.receiving?.reused===true,'The same receiving intent must reopen its original result.');
    const reopened=await cli('reopen',['reopen','--directory',receivedDirectory,'--workspace-id',expectedRefresh.workspaceId],{remote:false});
    check(reopened.workspaceId===expectedRefresh.workspaceId,'The reopened directory changed its original identity.');
    const retained=verifySnapshot(reopened.snapshot,expectedRefresh);
    check(reopened.snapshot.worker?.running===false,'Receiving must not start an unrequested capture or refresh worker.');
    await stage('receivedWorkspace',{directory:receivedDirectory,receiving:received.receiving,retained,retryReused:true});
    result={schema:SCHEMA,state:'COMPLETE',operationId,workspaceId:expectedRefresh.workspaceId,
      actor,source:directory,receivedDirectory,expectedRefresh,retained,archives,
      downloads:{delivery:resumed,briefing:briefDownload,package:packageDownload},
      checkpoint:{packageId:checkpoint.packageId,workspace:checkpoint.workspace,files:checkpoint.files},
      interruptedDownload:progress.stages.interruptedDownload,query:progress.stages.query,
      http:{endpoint,requiresBearer:true,rejectsForeignOrigin:true},sourceManifest:source,callback,
      cli: Object.fromEntries(Object.entries(progress.stages).filter(([key])=>key.startsWith('cli-'))),
      createdAt:progress.createdAt,completedAt:new Date().toISOString(),reused:false};
  }catch(failure){error=failure;}
  finally{
    closing=true;
    const failures=[];
    if(client)try{await client.dispose();}catch(e){failures.push(e);}
    server?.closeIdleConnections?.();
    await Promise.allSettled([...pending]);
    if(adapter)try{await adapter.close();}catch(e){failures.push(e);}
    if(server){
      const stopped=new Promise(resolve=>server.close(()=>resolve()));
      for(const socket of sockets)socket.destroy();await stopped;
    }
    if(!error&&failures.length)error=failures[0];
    if(!error&&result)try{await metadata(join(outputDirectory,'result.json'),result,{immutable:true});}catch(e){error=e;}
    await lease.close();
  }
  if(error)throw error;
  return result;
}
