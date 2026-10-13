// MIT. Local operator desk with the original Merchant receivables and payment-plan handlers.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {prepareReceivablesServer} from '../../merchant-settlement-accounting/receivables/server.mjs';
import {accountingWorkspaceBinding} from '../../merchant-settlement-accounting/workspace/binding.mjs';
import {StellarcarbonWorkspace,MAX_INPUT_BYTES,sealSource,readNativeDirectory} from './store.mjs';
import {need,TABLES,receiveBackup,sourceSummary} from './source.mjs';
import {workspaceOverview,contributionsPage,contributionDetail,retirementsPage,retirementDetail,editionFor,
  statementVersion,prepareStatement,compareEditions} from './engine.mjs';
import {statementFiles,comparisonCSV} from './exports.mjs';
import {captureNativeApi} from './capture.mjs';
import {createStatementInvoice} from './accounting.mjs';
const assets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
const SCHEMA='stellar-forge.stellarcarbon-startup.v1';
function headers(response){
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function send(response,status,value){const bytes=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length});response.end(bytes);}
function file(response,name,type,content){
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);
  response.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Content-Disposition':'attachment; filename="'+name.replace(/[^a-zA-Z0-9._-]/g,'_')+'"'});
  response.end(bytes);
}
async function body(request){
  need(/^application\/json(?:;|$)/i.test(request.headers['content-type']||''),'JSON_REQUIRED','Send a JSON request.',415);
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;need(size<=MAX_INPUT_BYTES,'REQUEST_TOO_LARGE','The request exceeds 128 MB.',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch(error){throw Object.assign(new Error('The JSON request is invalid.'),{code:'INVALID_JSON',status:400});}
}
export async function createStellarcarbonServer({directory,port=0,expectedWorkspaceId,accountingDirectory,expectedAccountingWorkspaceId,expectedAccountingSourcesSha256}={}){
  port=Number(port);need(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT','Use a local port from 0 to 65535.');
  const workspace=await StellarcarbonWorkspace.open(directory,{expectedWorkspaceId});
  let accounting,accountingBinding,captureTask=null,captureController=null,captureStatus={status:'IDLE',pages:0},closed=false;
  const receivedServices=[];
  try{if(accountingDirectory){accounting=await prepareReceivablesServer({directory:accountingDirectory,port:0,expectedWorkspaceId:expectedAccountingWorkspaceId,expectedSourcesSha256:expectedAccountingSourcesSha256});accountingBinding=accountingWorkspaceBinding(accounting.workspace.directory,accounting.workspace.state);}}
  catch(error){await workspace.close();throw error;}
  const server=createServer(async(request,response)=>{
    headers(response);
    try{
      const actual=server.address(),authority=new URL('http://'+String(request.headers.host||''));
      need(['127.0.0.1','localhost'].includes(authority.hostname)&&Number(authority.port||80)===actual.port&&authority.pathname==='/'&&!authority.username&&!authority.password,
        'LOCAL_HOST_REQUIRED','Open this request from the local workspace.',403);
      if(request.headers.origin)need(request.headers.origin===authority.origin,'LOCAL_ORIGIN_REQUIRED','Open this request from the local workspace.',403);
      const url=new URL(request.url||'/',authority),query=Object.fromEntries(url.searchParams);
      if(accounting&&await accounting.handler(request,response))return;
      if(request.method==='GET'||request.method==='HEAD'){
        if(url.pathname==='/'){response.writeHead(302,{Location:'/stellarcarbon/'});response.end();return;}
        const asset=assets.get(url.pathname);
        if(asset){const bytes=await readFile(asset.url);response.writeHead(200,{'Content-Type':asset.type,'Content-Length':bytes.length});response.end(request.method==='HEAD'?undefined:bytes);return;}
      }
      need(['GET','POST'].includes(request.method),'METHOD_NOT_ALLOWED','Use a supported operator action.',405);
      const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      need(parts[0]==='api','NOT_FOUND','Choose a workspace page.',404);
      if(request.method==='GET'){
        if(parts[1]==='health'){send(response,200,{schema:SCHEMA,workspaceId:workspace.state.workspaceId,directory:workspace.directory,capabilities:{customerAgent:'v1'}});return;}
        if(parts[1]==='capture'){send(response,200,captureStatus);return;}
        if(parts[1]==='operations'&&parts[2]){const value=await workspace.serial(()=>workspace.state.operations.find(row=>row.requestId===parts[2])||null);send(response,200,{found:Boolean(value),operation:value,workspaceId:workspace.state.workspaceId,revision:workspace.state.revision});return;}
        if(parts[1]==='state'){
          const state=await workspace.overview();
          send(response,200,{...state,integration:{accounting:Boolean(accounting),accountingWorkspaceId:accountingBinding?.workspaceId||null,
            receivablesUrl:accounting?'/receivables/':null,paymentPlansUrl:accounting?'/payment-plans/':null,customersUrl:accounting?'/customer-statements/':null}});
          return;
        }
        if(parts[1]==='handover'){file(response,'stellarcarbon-workspace.json','application/json; charset=utf-8',JSON.stringify(await workspace.handover(),null,2)+'\n');return;}
        const state=await workspace.snapshot();
        if(parts[1]==='contributions'){
          send(response,200,parts[2]?contributionDetail(state,query.editionId,parts[2]):contributionsPage(state,query));return;
        }
        if(parts[1]==='retirements'){
          send(response,200,parts[2]?retirementDetail(state,query.editionId,parts[2]):retirementsPage(state,query));return;
        }
        if(parts[1]==='editions'&&parts[2]){
          const source=editionFor(state,parts[2]);
          if(parts[3]==='source'&&!parts[4]){file(response,'stellarcarbon-source.json','application/json; charset=utf-8',JSON.stringify(source,null,2)+'\n');return;}
          if(parts[3]==='source'&&parts[4]){
            const table=parts[4].endsWith('.ndjson')?parts[4].slice(0,-7):null;
            if(table&&Object.hasOwn(source.files,table)){file(response,parts[4],'application/x-ndjson; charset=utf-8',source.files[table]);return;}
            const match=/^response-(\d+)\.json$/.exec(parts[4]);
            const original=match?source.responses[Number(match[1])]:null;
            need(original,'SOURCE_FILE_NOT_FOUND','Choose an original retained source file.',404);
            file(response,parts[4],'application/json; charset=utf-8',original.content);return;
          }
          if(parts[3]==='tables'&&parts[4]){
            need(TABLES[parts[4]],'SOURCE_TABLE_NOT_FOUND','Choose a native source table.',404);
            const rows=source.tables[parts[4]],offset=Number(query.offset||0),limit=Number(query.limit||100);
            need(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=500,'INVALID_PAGE','Choose a valid table page.');
            send(response,200,{table:parts[4],columns:TABLES[parts[4]],items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,nextOffset:offset+limit<rows.length?offset+limit:null});return;
          }
          send(response,200,{id:source.id,label:source.label,format:source.format,importedAt:source.importedAt,sha256:source.sha256,metadata:source.metadata,...sourceSummary(source),
            files:Object.keys(source.files).map(table=>({name:table+'.ndjson',url:'/api/editions/'+source.id+'/source/'+table+'.ndjson'})),
            responses:source.responses.map((row,index)=>({url:row.url,retrievedAt:row.retrievedAt,file:'/api/editions/'+source.id+'/source/response-'+index+'.json'}))});return;
        }
        if(parts[1]==='statements'&&parts[2]){
          const report=statementVersion(state,parts[2],query.version);
          if(parts[3]==='files'&&parts[4]){
            const selected=statementFiles(report,{statementId:parts[2]})[parts[4]];
            need(selected,'STATEMENT_FILE_NOT_FOUND','Choose a complete statement file.',404);
            file(response,parts[4],selected.type,selected.content);return;
          }
          send(response,200,{statementId:parts[2],...report});return;
        }
        if(parts[1]==='compare'){
          const result=compareEditions(state,query.beforeId,query.afterId);
          if(query.format==='csv')file(response,'edition-comparison.csv','text/csv; charset=utf-8',comparisonCSV(result));
          else send(response,200,result);return;
        }
        throw Object.assign(new Error('The requested workspace route does not exist.'),{code:'NOT_FOUND',status:404});
      }
      need(request.headers['x-stellarcarbon-workspace']===workspace.state.workspaceId,'WORKSPACE_REQUEST_REQUIRED','Refresh this workspace before saving.',403);
      const value=await body(request),options={revision:value.revision,requestId:value.requestId,actor:value.actor};
      if(parts[1]==='import'){
        need([Boolean(value.retained),value.source!==undefined,value.files!==undefined].filter(Boolean).length===1,'SOURCE_SELECTION','Choose one complete retained source, original backup or bundled edition.');
        const source=value.source??(value.retained?await readNativeDirectory(fileURLToPath(new URL('./source-edition/',import.meta.url))):receiveBackup(value.files,value.metadata||{}));
        send(response,200,await workspace.import(source,value.label,options));return;
      }
      if(parts[1]==='receive'){
        need(typeof value.directory==='string'&&resolve(value.directory)===value.directory,'RECEIVING_DIRECTORY_REQUIRED','Choose an absolute new private directory.');
        const received=await StellarcarbonWorkspace.create(value.directory,{handover:value.handover});
        await received.close();
        const service=await createStellarcarbonServer({directory:value.directory,port:0});
        receivedServices.push(service);send(response,201,service.startup);return;
      }
      if(parts[1]==='preview'){
        send(response,200,prepareStatement(await workspace.snapshot(),value.value));return;
      }
      if(parts[1]==='operations'&&['customer','project','assignment','statement','settings'].includes(parts[2])){
        send(response,200,await workspace.apply(parts[2],value.value,options));return;
      }
      if(parts[1]==='capture'){
        need(!captureTask,'CAPTURE_RUNNING','The selected source acquisition is already running.',409);
        need(options.revision===workspace.state.revision,'STALE_WORKSPACE','Refresh the workspace before starting the acquisition.',409);
        const captureOptions=value.value||{};
        const checkpoint=(value.resume||captureOptions.resume)?await workspace.captureCheckpoint():undefined;
        captureController=new AbortController();
        captureStatus={status:'RUNNING',requestId:options.requestId||null,pages:checkpoint?.responses.length||0,startedAt:new Date().toISOString()};
        const id=options.requestId||randomUUID();
        captureTask=(async()=>{
          try{
            const source=await captureNativeApi({...captureOptions,checkpoint,signal:captureController.signal,
              retain:async progress=>{await workspace.saveCapture(progress);captureStatus={...captureStatus,pages:progress.responses.length,lastUrl:progress.responses.at(-1)?.url};}});
            const imported=await workspace.serial(()=>workspace.applyUnlocked('import',{source:sealSource(source),label:value.label},
              {...options,requestId:id,revision:workspace.state.revision}));
            captureStatus={...captureStatus,status:'COMPLETE',completedAt:new Date().toISOString(),editionId:imported.edition.id};
          }catch(error){captureStatus={...captureStatus,status:'INTERRUPTED',error:{code:error.code||'CAPTURE_INTERRUPTED',message:error.message}};}
          finally{captureTask=null;captureController=null;}
        })();
        send(response,202,captureStatus);return;
      }
      if(parts[1]==='statements'&&parts[2]&&parts[3]==='invoice'){
        need(accounting,'ACCOUNTING_CONNECTION_REQUIRED','Open this desk with the original accounting directory.');
        const result=await createStatementInvoice(workspace,accounting,{statementId:parts[2],value:value.value,...options});
        send(response,200,{...result,receivablesUrl:'/receivables/',paymentPlansUrl:'/payment-plans/'});return;
      }
      throw Object.assign(new Error('The requested operator action does not exist.'),{code:'NOT_FOUND',status:404});
    }catch(error){
      if(response.headersSent){response.end();return;}
      send(response,error.status||500,{error:{code:error.code||'WORKSPACE_ERROR',message:error.message}});
    }
  });
  server.requestTimeout=120000;server.headersTimeout=15000;
  async function close(){
    if(closed)return;closed=true;
    captureController?.abort();
    if(captureTask)await captureTask;
    if(server.listening)await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));
    for(const received of receivedServices)await received.close();
    if(accounting)await accounting.close();
    await workspace.close();
  }
  try{await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});}
  catch(error){await close();throw error;}
  return {schema:SCHEMA,server,workspace,accounting,url:'http://127.0.0.1:'+server.address().port+'/stellarcarbon/',close,
    startup:{schema:SCHEMA,directory:workspace.directory,workspaceId:workspace.state.workspaceId,
      accountingWorkspaceId:accountingBinding?.workspaceId||null,url:'http://127.0.0.1:'+server.address().port+'/stellarcarbon/'}};
}
