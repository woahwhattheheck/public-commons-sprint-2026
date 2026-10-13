// MIT. Complete local operator workflow composed into the original Merchant Applications lifecycle.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {jsonDocumentChunks} from './json-stream.mjs';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {readNativeDirectory} from '../stellarcarbon-statements/store.mjs';
import {GiveCreditWorkspace,MAX_INPUT_BYTES,MAX_WORKSPACE_BYTES} from './store.mjs';
import {need,copy,receiveRegistryFiles,receiveCarbon,sourceSummary} from './source.mjs';
import {editionFor,donationsPage,donationDetail,transfersPage,transferDetail,poolRegister,providerPayoutCandidates,nativePayments,
  prepareAllocation,prepareBridge,prepareStatement,statementVersion,compareEditions,transactionFor} from './engine.mjs';
import {statementFiles,comparisonCSV} from './exports.mjs';
import {captureRegistry} from './capture.mjs';
import {paymentFundingCapacity,paymentBeforePayout} from './funding.mjs';
import {captureLedger} from './ledger.mjs';
const assets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
export const STARTUP_SCHEMA='stellar-forge.givecredit-startup.v1';
function headers(response){
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function send(response,status,value){const bytes=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length});response.end(bytes);}
function download(response,name,type,content){
  const bytes=Buffer.from(content);response.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,
    'Content-Disposition':'attachment; filename="'+name.replace(/[^a-zA-Z0-9._-]/g,'_')+'"'});response.end(bytes);
}
async function downloadJSON(response,name,value){
  response.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition':'attachment; filename="'+name.replace(/[^a-zA-Z0-9._-]/g,'_')+'"'});
  await pipeline(Readable.from(jsonDocumentChunks(value,{pretty:true})),response);
}
async function body(request,maximum=MAX_INPUT_BYTES){
  need(/^application\/json(?:;|$)/i.test(request.headers['content-type']||''),'JSON_REQUIRED','Send an original JSON operation.',415);
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;need(size<=maximum,'REQUEST_TOO_LARGE','The complete request exceeds the native receiving limit.',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{throw Object.assign(new Error('The original JSON request is invalid.'),{code:'INVALID_JSON',status:400});}
}
function originalFiles(source){
  const files=Object.entries(source.files).map(([name,content])=>({name,content}));
  if(source.kind==='carbon'){
    for(const [name,content] of Object.entries(source.carbon.files))files.push({name:name+'.ndjson',content});
    for(const [index,response] of (source.carbon.responses||[]).entries())files.push({name:'carbon-response-'+index+'.json',content:response.content});
  }
  return files;
}
function choices(state,query){
  const registry=query.registryEditionId?editionFor(state,query.registryEditionId,'registry'):null;
  const ledger=query.ledgerEditionId?editionFor(state,query.ledgerEditionId,'ledger'):null;
  const carbon=query.carbonEditionId?editionFor(state,query.carbonEditionId,'carbon'):null;
  const payoutChoices=ledger?providerPayoutCandidates(ledger).filter(row=>row.classification!=='vendor-fee'):[];
  const selectedPayout=payoutChoices.find(row=>row.key===query.payoutKey)||payoutChoices[0];
  const brief=row=>({key:row.key,hash:row.hash,createdAt:row.createdAt,ledger:row.ledger,network:row.network,from:row.from,to:row.to,asset:copy(row.asset),amountAtoms:row.amountAtoms});
  return {organizations:registry?registry.tables.organizations.map(row=>({id:row.id,name:row.name})):[],
    initiatives:registry?registry.tables.initiatives.map(row=>({id:row.id,title:row.title,organizationId:row.organizationId})):[],
    donations:registry?registry.tables.donations.map(row=>({id:row.id,created:row.created,wallet:row.wallet,amount:row.amount,asset:row.asset,
      organizationId:row.organizationId,initiativeId:row.initiativeId,organizationName:row.organization?.name||null,initiativeName:row.initiative?.title||null})):[],
    transfers:ledger?ledger.tables.transfers.filter(row=>transactionFor(ledger,row.hash)?.successful===true).map(brief):[],
    donorPayments:ledger?nativePayments(ledger).map(row=>({...brief(row),funding:paymentFundingCapacity(ledger,row),beforePayout:selectedPayout?paymentBeforePayout(ledger,row,selectedPayout):null})):[],payouts:payoutChoices.map(row=>({...brief(row),classification:row.classification,classificationBasis:row.classificationBasis})),
    sinks:carbon?carbon.carbon.tables.sinking_txs.map(row=>({hash:row.hash,createdAt:row.created_at,recipient:row.recipient,funder:row.funder,carbon:row.carbon_amount})):[]};
}
export async function createGiveCreditServer({directory,port=0,expectedWorkspaceId}={}){
  port=Number(port);need(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT','Choose a local port from 0 to 65535.');
  const workspace=await GiveCreditWorkspace.open(directory,{expectedWorkspaceId});
  const captures={registry:{status:'IDLE'},ledger:{status:'IDLE'}},tasks={},controllers={},receivedServices=[],checkpointImports=new Set();
  try{for(const kind of ['registry','ledger']){const checkpoint=await workspace.captureStatus(kind);if(checkpoint)captures[kind]={status:'SAVED',checkpoint};}}
  catch(error){await workspace.close();throw error;}
  let closed=false;
  const server=createServer(async(request,response)=>{
    headers(response);
    try{
      const actual=server.address(),authority=new URL('http://'+String(request.headers.host||''));
      need(['127.0.0.1','localhost'].includes(authority.hostname)&&Number(authority.port||80)===actual.port&&authority.pathname==='/'&&!authority.username&&!authority.password,
        'LOCAL_HOST_REQUIRED','Open this request from the local GiveCredit workspace.',403);
      if(request.headers.origin)need(request.headers.origin===authority.origin,'LOCAL_ORIGIN_REQUIRED','Open this request from the local workspace.',403);
      const url=new URL(request.url||'/',authority),query=Object.fromEntries(url.searchParams);
      if(request.method==='GET'||request.method==='HEAD'){
        if(url.pathname==='/'){response.writeHead(302,{Location:'/givecredit/'});response.end();return;}
        const asset=assets.get(url.pathname);if(asset){const bytes=await readFile(asset.url);response.writeHead(200,{'Content-Type':asset.type,'Content-Length':bytes.length});response.end(request.method==='HEAD'?undefined:bytes);return;}
      }
      need(['GET','POST'].includes(request.method),'METHOD_NOT_ALLOWED','Choose a supported workspace action.',405);
      const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      need(parts[0]==='api','NOT_FOUND','Choose a GiveCredit workspace page.',404);
      if(request.method==='GET'){
        if(parts[1]==='health'){send(response,200,{schema:STARTUP_SCHEMA,workspaceId:workspace.state.workspaceId,directory:workspace.directory,capabilities:{customerAgent:'v1'}});return;}
        if(parts[1]==='operations'&&parts[2]){let value=await workspace.serial(()=>workspace.state.operations.find(row=>row.requestId===parts[2])||null);if(!value)for(const kind of ['registry','ledger']){value=await (await workspace.captureStore(kind)).operation(parts[2]);if(value)break;}send(response,200,{found:Boolean(value),operation:value,workspaceId:workspace.state.workspaceId,revision:workspace.state.revision});return;}
        if(parts[1]==='state'){send(response,200,{...await workspace.overview(),captures:copy(captures)});return;}
        if(parts[1]==='capture'){
          if(parts[2]){
            const kind=parts[2];need(['registry','ledger'].includes(kind),'CAPTURE_KIND','Choose registry or ledger capture.');
            if(parts[3]==='checkpoint'){
              const retained=await workspace.captureCheckpoint(kind);need(retained,'CAPTURE_CHECKPOINT_MISSING','No saved checkpoint is available.',404);
              await downloadJSON(response,'givecredit-'+kind+'-checkpoint.json',retained);return;
            }
            send(response,200,{...captures[kind],checkpoint:await workspace.captureStatus(kind)});return;
          }
          const current={};for(const kind of ['registry','ledger'])current[kind]={...captures[kind],checkpoint:await workspace.captureStatus(kind)};
          send(response,200,current);return;
        }
        if(parts[1]==='handover'){await downloadJSON(response,'givecredit-workspace.json',await workspace.readonlyHandover());return;}
        const state=await workspace.readonlySnapshot();
        if(parts[1]==='choices'){send(response,200,choices(state,query));return;}
        if(parts[1]==='donations'){send(response,200,parts[2]?donationDetail(state,query.editionId,parts[2],query.ledgerEditionId):donationsPage(state,query));return;}
        if(parts[1]==='transfers'){send(response,200,parts[2]?transferDetail(state,query.editionId,parts[2]):transfersPage(state,query));return;}
        if(parts[1]==='pools'){send(response,200,poolRegister(state,query.editionId,query));return;}
        if(parts[1]==='editions'&&parts[2]){
          const source=editionFor(state,parts[2]),tables=source.kind==='carbon'?source.carbon.tables:source.tables;
          if(parts[3]==='tables'&&parts[4]){
            need(Array.isArray(tables[parts[4]]),'SOURCE_TABLE_REQUIRED','Choose an original source table.',404);
            const rows=tables[parts[4]],offset=Number(query.offset||0),limit=Number(query.limit||100);
            need(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=500,'INVALID_PAGE','Choose a valid source page.');
            send(response,200,{table:parts[4],items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,nextOffset:offset+limit<rows.length?offset+limit:null});return;
          }
          if(parts[3]==='source'){await downloadJSON(response,'givecredit-'+source.kind+'-source.json',source);return;}
          if(parts[3]==='files'&&parts[4]){
            const file=originalFiles(source)[Number(parts[4])];need(file,'SOURCE_FILE_REQUIRED','Choose an original source file.',404);
            download(response,file.name.split('/').at(-1),file.name.endsWith('.ndjson')?'application/x-ndjson; charset=utf-8':'application/json; charset=utf-8',file.content);return;
          }
          send(response,200,{id:source.id,label:source.label,kind:source.kind,metadata:source.metadata,importedAt:source.importedAt,sha256:source.sha256,
            ...sourceSummary(source),files:originalFiles(source).map((file,index)=>({name:file.name,url:'/api/editions/'+source.id+'/files/'+index}))});return;
        }
        if(parts[1]==='statements'&&parts[2]){
          const report=statementVersion(state,parts[2],query.version);
          if(parts[3]==='files'&&parts[4]){const file=statementFiles(report)[parts[4]];need(file,'STATEMENT_FILE_REQUIRED','Choose a complete statement export.',404);download(response,parts[4],file.type,file.content);return;}
          send(response,200,{statementId:parts[2],...report});return;
        }
        if(parts[1]==='compare'){const result=compareEditions(state,query.beforeId,query.afterId);
          if(query.format==='csv')download(response,'givecredit-edition-comparison.csv','text/csv; charset=utf-8',comparisonCSV(result));else send(response,200,result);return;}
        throw Object.assign(new Error('The workspace route does not exist.'),{code:'NOT_FOUND',status:404});
      }
      need(request.headers['x-givecredit-workspace']===workspace.state.workspaceId,'WORKSPACE_REQUEST_REQUIRED','Refresh the current workspace before saving.',403);
      const value=await body(request,parts[1]==='receive'?MAX_WORKSPACE_BYTES:MAX_INPUT_BYTES);
      const options={revision:value.revision,requestId:value.requestId,actor:value.actor};
      if(parts[1]==='import'){
        let source=value.source;
        if(value.registryFiles)source=receiveRegistryFiles(value.registryFiles,value.metadata||{});
        if(value.carbonRetained)source=receiveCarbon(await readNativeDirectory(fileURLToPath(new URL('../stellarcarbon-statements/source-edition/',import.meta.url))),{network:value.network||'mainnet'});
        else if(value.carbonSource)source=receiveCarbon(value.carbonSource,{network:value.network});
        send(response,200,await workspace.import(source,value.label,options));return;
      }
      if(parts[1]==='receive'){
        need(typeof value.directory==='string'&&resolve(value.directory)===value.directory,'RECEIVING_DIRECTORY_REQUIRED','Choose an absolute new private directory.');
        const received=await GiveCreditWorkspace.create(value.directory,{handover:value.handover});await received.close();
        const service=await createGiveCreditServer({directory:value.directory,port:0});receivedServices.push(service);
        send(response,201,service.startup);return;
      }
      if(parts[1]==='preview'){
        const state=await workspace.readonlySnapshot(),kind=parts[2]||'statement';
        const result=kind==='allocation'?prepareAllocation(state,value.value):kind==='bridge'?prepareBridge(state,value.value):prepareStatement(state,value.value);
        send(response,200,result);return;
      }
      if(parts[1]==='operations'&&['payment-link','allocation','bridge','statement','settings','carry-payment-links'].includes(parts[2])){
        send(response,200,await workspace.apply(parts[2],value.value,options));return;
      }
      if(parts[1]==='capture'){
        const kind=parts[2];need(['registry','ledger'].includes(kind),'CAPTURE_KIND','Choose registry or ledger acquisition.');
        if(parts[3]==='stop'){controllers[kind]?.abort();send(response,202,captures[kind]);return;}
        if(parts[3]==='checkpoint'){
          need(value.source?.kind===kind,'CAPTURE_KIND','Receive a checkpoint of the selected source kind.');
          const store=await workspace.captureStore(kind),prior=options.requestId?await store.operation(options.requestId):null;
          if(!prior){
            need(!tasks[kind]&&!checkpointImports.has(kind),'CAPTURE_RUNNING','Pause the original acquisition before receiving a checkpoint.',409);
            need(options.revision===workspace.state.revision,'STALE_WORKSPACE','Refresh the current workspace before receiving.',409);
          }
          if(options.requestId){
            need(!workspace.state.operations.some(row=>row.requestId===options.requestId)&&
              !await(await workspace.captureStore(kind==='registry'?'ledger':'registry')).operation(options.requestId),
              'REQUEST_REUSED','This request ID belongs to another original operation.',409);
          }
          if(!prior)checkpointImports.add(kind);
          try{const checkpoint=await store.save(value.source,{phase:'operator-import',
            request:options.requestId?{requestId:options.requestId,actor:options.actor||'Local operator'}:null});
            if(!checkpoint.replayed)captures[kind]={status:'SAVED',checkpoint};
            send(response,200,{status:checkpoint.replayed?'REPLAYED':'SAVED',checkpoint});return;
          }finally{if(!prior)checkpointImports.delete(kind);}
        }
        need(!tasks[kind]&&!checkpointImports.has(kind),'CAPTURE_RUNNING','This source acquisition or checkpoint import is already running.',409);
        need(options.revision===workspace.state.revision,'STALE_WORKSPACE','Refresh the current workspace before acquisition.',409);
        const input={...(value.value||{})};
        if(kind==='ledger'&&input.registryEditionId){input.registrySource=editionFor(await workspace.readonlySnapshot(),input.registryEditionId,'registry');delete input.registryEditionId;}
        const checkpoint=(value.resume||input.resume)?await workspace.captureCheckpoint(kind):undefined,requestId=options.requestId||randomUUID();
        controllers[kind]=new AbortController();captures[kind]={status:'RUNNING',requestId,startedAt:new Date().toISOString(),records:0};
        const task=(async()=>{
          try{
            const onProgress=async progress=>{const checkpoint=progress.checkpoint?await workspace.saveCapture(kind,progress.checkpoint,{phase:progress.phase}):captures[kind].checkpoint;
              captures[kind]={...captures[kind],checkpoint,phase:progress.phase||kind,table:progress.table||null,records:progress.rows||null};};
            const source=await (kind==='registry'?captureRegistry:captureLedger)({...input,checkpoint,checkpointMode:'borrowed',onProgress,signal:controllers[kind].signal});
            const result=await workspace.serial(()=>workspace.importUnlocked(source,value.label,
              {...options,requestId,revision:workspace.state.revision}));
            captures[kind]={...captures[kind],status:'COMPLETE',completedAt:new Date().toISOString(),editionId:result.edition.id};
          }catch(error){let checkpointError=null;
            if(error.checkpoint)try{captures[kind].checkpoint=await workspace.saveCapture(kind,error.checkpoint,{phase:'interrupted'});}catch(failure){checkpointError={code:failure.code||'CHECKPOINT_SAVE_FAILED',message:failure.message};}
            captures[kind]={...captures[kind],status:'INTERRUPTED',error:{code:error.code||'CAPTURE_INTERRUPTED',message:error.message},checkpointError};
          }finally{await workspace.releaseCapture(kind);tasks[kind]=null;controllers[kind]=null;}
        })();
        tasks[kind]=task;send(response,202,captures[kind]);return;
      }
      throw Object.assign(new Error('Choose a supported operator action.'),{code:'NOT_FOUND',status:404});
    }catch(error){if(response.headersSent){response.end();return;}send(response,error.status||500,{error:{code:error.code||'WORKSPACE_ERROR',message:error.message}});}
  });
  server.requestTimeout=120000;server.headersTimeout=15000;
  async function close(){
    if(closed)return;closed=true;for(const controller of Object.values(controllers))controller?.abort();
    await Promise.allSettled(Object.values(tasks).filter(Boolean));
    if(server.listening)await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));
    for(const service of receivedServices)await service.close();await workspace.close();
  }
  try{await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});}
  catch(error){await close();throw error;}
  const url='http://127.0.0.1:'+server.address().port+'/givecredit/';
  return {schema:STARTUP_SCHEMA,server,workspace,url,close,startup:{schema:STARTUP_SCHEMA,directory:workspace.directory,workspaceId:workspace.state.workspaceId,url}};
}
