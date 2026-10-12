// MIT. Complete agent receiving through the original saved publisher Applications.
import {constants} from 'node:fs';
import {open,mkdir,lstat,readdir,realpath,rename,unlink,link} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {runManagedPublisherReceiving} from './360giving-receiving.mjs';

export const AGENT_PUBLISHER_RECEIVING_INPUT='stellar-forge.360giving-agent-receiving-input.v1';
const SCHEMA='stellar-forge.360giving-agent-receiving.v1';
const WORKFLOW='360giving-sdk-and-merchant-v1', MAX_JSON=128*1024*1024;
const SHA=/^[a-f0-9]{64}$/, STAGES=['source-original','source-reopened','receiver-original','receiver-reopened'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const order=value=>Array.isArray(value)?value.map(order):value!==null&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(order(value),null,2)+'\n');
const identity=value=>hash(encode(value));
const need=(value,code,message=code)=>{if(!value)throw Object.assign(new Error(message),{code});};
const timestamp=()=>new Date().toISOString();
const safeError=error=>({code:error.code??'AGENT_RECEIVING_FAILED',
  message:String(error.message??error).replace(/#[A-Za-z0-9_-]{43}/g,'#[private]').slice(0,1600)});
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const sorted=(values,key='id')=>[...values].sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
function count(value,label){
  if(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value))value=Number(value);
  need(Number.isSafeInteger(value)&&value>=0,'AGENT_RECEIVING_COUNTER_INVALID',label+' must remain an exact bounded counter.');
  return value;
}
function absolute(value){
  need(typeof value==='string'&&value===resolve(value)&&!value.includes('\0'),'AGENT_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  return value;
}
async function privateDirectory(path,{create=false}={}){
  absolute(path);
  if(create){need(await realpath(dirname(path))===dirname(path),'AGENT_RECEIVING_REAL_PARENT_REQUIRED');
    try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}}
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(!(stat.mode&0o077)&&(!process.getuid||stat.uid===process.getuid()))),
    'AGENT_RECEIVING_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
async function syncDirectory(path){
  if(process.platform==='win32')return;
  const file=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try{await file.sync();}finally{await file.close();}
}
const stamp=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join('/');
async function regular(path,maximum=MAX_JSON){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum),'AGENT_RECEIVING_REGULAR_FILE_REQUIRED');
    return {file,before};
  }catch(error){await file.close();throw error;}
}
async function unchanged(path,file,before){
  need(stamp(await file.stat({bigint:true}))===stamp(before)&&stamp(await lstat(path,{bigint:true}))===stamp(before),
    'AGENT_RECEIVING_FILE_CHANGED');
}
async function bytesAt(path,maximum=MAX_JSON){
  const {file,before}=await regular(path,maximum);
  try{const bytes=await file.readFile();await unchanged(path,file,before);
    need(BigInt(bytes.length)===before.size,'AGENT_RECEIVING_FILE_CHANGED');return bytes;}
  finally{await file.close();}
}
const readJSON=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytesAt(path)));
async function atomicJSON(path,value){
  const temporary=path+'.pending-'+randomUUID(),file=await open(temporary,'wx',0o600);
  try{await file.writeFile(encode(value));await file.sync();}
  catch(error){await file.close();await unlink(temporary).catch(()=>{});throw error;}
  await file.close();await rename(temporary,path);await syncDirectory(dirname(path));
}
async function retain(path,bytes){
  if(await exists(path)){need((await bytesAt(path,bytes.length)).equals(bytes),'AGENT_RECEIVING_OUTPUT_CHANGED');return;}
  const temporary=path+'.pending-'+randomUUID(),file=await open(temporary,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  try{await link(temporary,path);}finally{await unlink(temporary);}
  await syncDirectory(dirname(path));
}
async function fileIdentity(path){
  const {file,before}=await regular(path,1024**3),digest=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  let bytes=0;
  try{
    for(;;){const read=await file.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;
      digest.update(buffer.subarray(0,read.bytesRead));bytes+=read.bytesRead;}
    await unchanged(path,file,before);need(BigInt(bytes)===before.size,'AGENT_RECEIVING_FILE_CHANGED');
    return {bytes,sha256:digest.digest('hex')};
  }finally{await file.close();}
}
async function finishRows(temporary,output,file,digest,bytes){
  await file.sync();await file.close();const value={bytes,sha256:digest.digest('hex')};
  if(await exists(output)){
    need(identity(await fileIdentity(output))===identity(value),'AGENT_RECEIVING_ROWS_CHANGED');
    await unlink(temporary);
  }else{await link(temporary,output);await unlink(temporary);await syncDirectory(dirname(output));}
  return value;
}
function metadata(state){
  need(state?.schema==='stellar-forge.360giving-operator.v1'&&
    ['datasets','editions','decisions','candidates','requests'].every(key=>Array.isArray(state[key])),
    'AGENT_RECEIVING_SOURCE_CONTRACT_CHANGED');
  return {datasets:sorted(state.datasets,'key'),editions:sorted(state.editions),
    decisions:[...state.decisions].sort((a,b)=>(a.editionId+'/'+a.id).localeCompare(b.editionId+'/'+b.id)),
    candidates:sorted(state.candidates)};
}
function declaredObjects(state,workspace){
  const files={};
  for(const request of state.requests.filter(value=>value.status==='complete')){
    const fields=request.action==='intake'?['source','registry','capture','transport']:
      request.action==='decisions'?['object']:[];
    for(const field of fields){
      const id=request.input[field];if(id==null)continue;
      need(SHA.test(id),'AGENT_RECEIVING_OBJECT_CHANGED');
      const kind=field==='object'?'decisions':field;
      files[id]??={path:join(workspace,'objects',id),kind,sha256:id};
    }
  }
  need(Object.keys(files).length<=256,'AGENT_RECEIVING_DECLARED_FILE_LIMIT');
  return files;
}
async function inventory(client,kind,dataset){
  let offset=0,snapshot,items=[],total;
  for(;;){
    const page=await client.inventory({kind,...(dataset?{dataset}:{}),offset,limit:50,
      ...(snapshot?{expectedSnapshot:snapshot}:{})});
    need(Array.isArray(page.items)&&page.offset===offset&&SHA.test(page.snapshot),'AGENT_RECEIVING_INVENTORY_CHANGED');
    total??=count(page.total,'Inventory total');snapshot??=page.snapshot;
    need(page.snapshot===snapshot&&page.total===total,'AGENT_RECEIVING_INVENTORY_CHANGED');
    items.push(...page.items);
    if(page.nextOffset===null)break;
    need(page.nextOffset===offset+page.items.length&&page.items.length>0,'AGENT_RECEIVING_INVENTORY_CURSOR_CHANGED');
    offset=page.nextOffset;
  }
  need(items.length===total,'AGENT_RECEIVING_INVENTORY_INCOMPLETE');return items;
}
async function completeQuery(sdk,client,dataset,build,output,pageSize){
  const temporary=output+'.pending-'+randomUUID(),file=await open(temporary,'wx',0o600),digest=createHash('sha256');
  let cursor=null,total,fields,first,rows=0,bytes=0,pages=0;const seen=new Set();
  try{
    for(;;){
      const query={limit:String(pageSize),...(cursor?{cursor}:{})};
      const direct=await sdk.query({dataset,build:build.id,query});
      const remote=(await client.query({dataset,build:build.id,query})).result;
      need(identity(direct)===identity(remote),'AGENT_RECEIVING_CLIENT_QUERY_CHANGED');
      need(count(direct.response?.status,'Native query status')===200,'AGENT_RECEIVING_QUERY_FAILED');
      const body=direct.response.body;
      need(Array.isArray(body.rows)&&body.page,'AGENT_RECEIVING_QUERY_CONTRACT_CHANGED');
      const selectedTotal=count(body.page.total,'Native query total');
      total??=selectedTotal;fields??=body.fields;
      need(selectedTotal===total&&count(body.page.returned,'Returned rows')===body.rows.length&&
        identity(body.fields)===identity(fields),'AGENT_RECEIVING_QUERY_SELECTION_CHANGED');
      for(const row of body.rows){
        first??=row;const line=Buffer.from(JSON.stringify(order(row))+'\n');
        await file.writeFile(line);digest.update(line);bytes+=line.length;rows++;
      }
      pages++;cursor=body.page.nextCursor;
      if(cursor===null)break;
      need(typeof cursor==='string'&&cursor&&!seen.has(cursor)&&body.rows.length,'AGENT_RECEIVING_QUERY_CURSOR_CHANGED');
      seen.add(cursor);
    }
    need(rows===total&&rows===count(build.rowCount,'Build rows'),'AGENT_RECEIVING_QUERY_INCOMPLETE');
    if(first&&typeof first.grant_id==='string'){
      const query={limit:'2',where_grant_id:first.grant_id};
      const direct=await sdk.query({dataset,build:build.id,query}),remote=(await client.query({dataset,build:build.id,query})).result;
      need(identity(direct)===identity(remote)&&count(direct.response?.status,'Filtered status')===200&&
        direct.response.body.rows.length===1&&identity(direct.response.body.rows[0])===identity(first),
        'AGENT_RECEIVING_NATIVE_FILTER_CHANGED');
    }
    return {fields,rowCount:rows,pages,...await finishRows(temporary,output,file,digest,bytes)};
  }catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
async function completeChanges(sdk,client,dataset,comparison,output){
  const temporary=output+'.pending-'+randomUUID(),file=await open(temporary,'wx',0o600),digest=createHash('sha256');
  let offset=0,rows=0,bytes=0,pages=0;
  try{
    for(;;){
      const selection={dataset,comparison:comparison.id,offset,limit:50};
      const direct=await sdk.changes(selection),remote=(await client.changes(selection)).result;
      need(identity(direct)===identity(remote)&&Array.isArray(direct.rows)&&count(direct.offset,'Changes offset')===offset,
        'AGENT_RECEIVING_CHANGES_PAGE_CHANGED');
      for(const row of direct.rows){const line=Buffer.from(JSON.stringify(order(row))+'\n');
        await file.writeFile(line);digest.update(line);bytes+=line.length;rows++;}
      pages++;
      if(direct.nextOffset===null)break;
      const next=count(direct.nextOffset,'Next changes offset');
      need(next===offset+direct.rows.length&&next>offset,'AGENT_RECEIVING_CHANGES_CURSOR_CHANGED');offset=next;
    }
    return {rowCount:rows,pages,...await finishRows(temporary,output,file,digest,bytes)};
  }catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
async function semanticLines(path,parseExactJSON){
  const {file,before}=await regular(path,1024**3),digest=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true});
  const buffer=Buffer.allocUnsafe(65536);let pending='',rows=0,bytes=0;
  const line=value=>{
    if(value.endsWith('\r'))value=value.slice(0,-1);
    need(value.length>0,'AGENT_RECEIVING_CHANGES_BLANK_ROW');
    const encoded=Buffer.from(JSON.stringify(order(parseExactJSON(value)))+'\n');
    digest.update(encoded);bytes+=encoded.length;rows++;
  };
  try{
    for(;;){const read=await file.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;
      pending+=decoder.decode(buffer.subarray(0,read.bytesRead),{stream:true});
      let end;while((end=pending.indexOf('\n'))!==-1){line(pending.slice(0,end));pending=pending.slice(end+1);}
      need(pending.length<=16*1024*1024,'AGENT_RECEIVING_CHANGES_LINE_TOO_LARGE');
    }
    pending+=decoder.decode();if(pending)line(pending);await unchanged(path,file,before);
    return {rowCount:rows,bytes,sha256:digest.digest('hex')};
  }finally{await file.close();}
}

/** This owner adds the typed clients and merchant receiving to one complete managed lifecycle. */
export async function runPublisherAgentReceiving({
  runtimeDirectory,sourceWorkspace,pythonExecutable,directory,label='360Giving complete agent receiving',
  timeoutMs=240000,pollMs=500,queryPageSize=250,onStage=()=>{},
}={}){
  let activeHost=null,activeSdk=null,activeClients=new Map();
  const agentDirectory=join(absolute(directory),'agent'),journalPath=join(agentDirectory,'agent-journal.json');
  async function closeHost(){
    const results=await Promise.allSettled([...activeClients.values()].map(client=>client.close()));
    activeClients.clear();
    if(activeHost){await activeHost.close();activeHost=null;}
    const failed=results.find(value=>value.status==='rejected');if(failed)throw failed.reason;
  }
  const managed=await runManagedPublisherReceiving({
    runtimeDirectory,sourceWorkspace,pythonExecutable,directory,label,timeoutMs,pollMs,queryPageSize,onStage,
    connectionWorkflow:WORKFLOW,
    onConnected:async context=>{
      await privateDirectory(agentDirectory,{create:true});
      if(!await exists(journalPath))need((await readdir(agentDirectory)).length===0,'AGENT_RECEIVING_ORIGINAL_JOURNAL_REQUIRED');
      const journal=await exists(journalPath)?await readJSON(journalPath):{
        schema:SCHEMA,directory,sourceWorkspaceId:context.applications.source.workspaceId,createdAt:timestamp(),
        sourceFiles:{},deliveries:{},downloads:{},stages:{},events:[]};
      need(journal.schema===SCHEMA&&journal.directory===directory&&journal.sourceWorkspaceId===context.applications.source.workspaceId,
        'AGENT_RECEIVING_ORIGINAL_OPERATION_CHANGED');
      const checkpoint=async(event,details={})=>{
        journal.updatedAt=timestamp();journal.events.push({event,at:journal.updatedAt,...details});
        await atomicJSON(journalPath,journal);await onStage({stage:'AGENT_'+event,at:journal.updatedAt,...details});
      };
      await checkpoint('CONNECTED',{phase:context.stage,workspaceId:context.workspaceId});
      const packageRoot=join(context.runtime.sourceRoot,'stellar','scf-starforge-20261009');
      const merchantRoot=join(context.runtime.sourceRoot,'stellar-forge','mcp-merchant-operator');
      const module=path=>import(pathToFileURL(path).href);
      const {connect360GivingPublisher}=await module(join(packageRoot,'sf30-seller-sdk','ndjson','360giving','operator','client.mjs'));
      const {parseExactJSON}=await module(join(packageRoot,'sf30-seller-sdk','stellar-expert','exact-json.mjs'));
      const {initialize360GivingPublisherMerchant}=await module(join(merchantRoot,'360giving-setup.mjs'));
      const {startMerchantMcp}=await module(join(merchantRoot,'serve.mjs'));
      const {open360GivingMerchantClient,download360GivingExport,inspect360GivingExport}=
        await module(join(merchantRoot,'360giving-download.mjs'));
      const connection=join(agentDirectory,'publisher-workspaces.json');
      const merchantDirectory=join(agentDirectory,'merchant');
      const downloads=await privateDirectory(join(agentDirectory,'downloads'),{create:true});
      const observations=await privateDirectory(join(agentDirectory,'observations'),{create:true});
      const phaseDirectory=await privateDirectory(join(observations,context.stage),{create:true});
      let originalError;
      try{
        activeSdk=await connect360GivingPublisher({connectionFile:context.connectionFile,
          expectedWorkspaceId:context.workspaceId,timeoutMs});
        const state=await activeSdk.state();need(state.id===context.workspaceId,'AGENT_RECEIVING_PUBLISHER_CHANGED');
        if(context.role==='source'){
          const files=declaredObjects(state,context.workspace);
          if(Object.keys(journal.sourceFiles).length)need(identity(journal.sourceFiles)===identity(files),'AGENT_RECEIVING_SOURCE_FILES_CHANGED');
          else journal.sourceFiles=files;
        }
        const workspaces={};
        for(const [role,application] of Object.entries(context.applications)){
          const files=role==='source'?journal.sourceFiles:Object.fromEntries(context.exports.map((value,index)=>{
            const delivery=journal.deliveries[value.requestId];
            need(delivery?.kind==='handoff','AGENT_RECEIVING_COMPLETE_DELIVERY_REQUIRED');
            return ['handoff-'+String(index+1).padStart(4,'0'),{
              path:join(downloads,delivery.exportId,'360giving-complete-handoff.zip'),kind:'handoff',sha256:value.sha256}];
          }));
          workspaces[role]={label:'360Giving '+role,connectionFile:application.connectionFile,
            expectedWorkspaceId:application.workspaceId,files};
        }
        await atomicJSON(connection,{schema:'stellar-forge.360giving-merchant-connection.v1',workspaces});
        const setup=await initialize360GivingPublisherMerchant({directory:merchantDirectory,connection,
          name:'Starforge complete 360Giving receiving'});
        const tokenEnv='STARFORGE_360GIVING_RECEIVING_TOKEN';
        const environment={...process.env,[tokenEnv]:randomBytes(32).toString('base64url')};
        delete environment.MCP_OAUTH_CONFIG;
        const openHost=async()=>{
          activeHost=await startMerchantMcp({configPath:setup.configuration,port:journal.merchantPort??0,tokenEnv,environment,
            providerOptions:{publisher360Giving:{timeoutMs}}});
          const port=count(new URL(activeHost.url).port,'Original merchant port');
          if(journal.merchantPort!==undefined)need(journal.merchantPort===port,'AGENT_RECEIVING_MERCHANT_ENDPOINT_CHANGED');
          else{journal.merchantPort=port;journal.merchantUrl=activeHost.url;await checkpoint('MERCHANT_ENDPOINT_RETAINED',{port});}
        };
        const clientFor=async alias=>{
          if(!activeClients.has(alias))activeClients.set(alias,await open360GivingMerchantClient({
            workspace:alias,url:activeHost.url,tokenEnv,environment}));
          return activeClients.get(alias);
        };
        await openHost();
        const configured=await (await clientFor(context.role)).workspaces();
        need(configured.workspaces.some(value=>value.workspace===context.role&&value.expectedWorkspaceId===context.workspaceId),
          'AGENT_RECEIVING_MERCHANT_SELECTION_CHANGED');
        const report={schema:SCHEMA,phase:context.stage,workspaceId:context.workspaceId,
          sdk:'original-saved-publisher',merchantUrl:journal.merchantUrl,requests:{},uploads:0,reviews:0,deliveries:0};
        const client=()=>clientFor(context.role);
        const status=await (await client()).status();
        need(status.workspaceId===state.id&&status.numericEncoding==='original-json-number-tokens-as-strings',
          'AGENT_RECEIVING_EXACT_NUMBER_CONTRACT_CHANGED');
        for(const kind of ['datasets','editions','decisions','candidates','requests']){
          const remote=await inventory(await client(),kind);
          need(identity(remote)===identity(state[kind]),'AGENT_RECEIVING_INVENTORY_CONTENT_CHANGED');
        }
        for(const edition of state.editions){
          const decisions=[null,...state.decisions.filter(value=>value.editionId===edition.id).map(value=>value.id)];
          for(const decision of decisions){
            const selected={edition:edition.id,...(decision?{decision}:{})};
            need(identity(await activeSdk.review(selected))===identity((await (await client()).review(selected)).result),
              'AGENT_RECEIVING_NAMED_REVIEW_CHANGED');report.reviews++;
          }
        }
        if(context.stage==='source-original'){
          for(const [file,selected] of Object.entries(journal.sourceFiles)){
            const direct=await activeSdk.upload(selected.path,{expectedSha256:selected.sha256});
            const remote=(await (await client()).upload({file})).result;
            need(direct.id===selected.sha256&&remote.id===selected.sha256&&
              count(direct.bytes,'Uploaded bytes')===count(remote.bytes,'Merchant uploaded bytes'),'AGENT_RECEIVING_COMPLETE_UPLOAD_CHANGED');
            report.uploads++;
          }
          const textFile=Object.values(journal.sourceFiles).find(value=>value.kind==='decisions');
          if(textFile){
            const info=await fileIdentity(textFile.path);
            if(info.bytes<=65536){
              const text=new TextDecoder('utf-8',{fatal:true}).decode(await bytesAt(textFile.path,65536));
              const direct=await activeSdk.uploadText(text),remote=(await (await client()).uploadText({text})).result;
              need(direct.id===textFile.sha256&&remote.id===textFile.sha256,'AGENT_RECEIVING_EXACT_DOCUMENT_CHANGED');
              report.uploadTextSha256=textFile.sha256;
            }
          }
          for(const request of state.requests.filter(value=>value.status==='complete'&&
            ['intake','decisions','candidate','build','compare'].includes(value.action))){
            const direct=await activeSdk.submit({id:request.id,action:request.action,input:request.input});
            const input=Object.fromEntries(Object.entries(request.input).filter(([,value])=>value!==null));
            const remote=(await (await client())[request.action]({requestId:request.id,...input})).request;
            need(identity(direct)===identity(request)&&identity(remote)===identity(request),'AGENT_RECEIVING_ORIGINAL_REQUEST_CHANGED');
            report.requests[request.action]=(report.requests[request.action]??0)+1;
          }
          for(const selected of context.exports){
            const input={requestId:selected.requestId,edition:selected.edition,
              ...(selected.decision?{decision:selected.decision}:{}),...(selected.candidate?{candidate:selected.candidate}:{})};
            const result=await (await client()).export(input);
            need(result.request.id===selected.requestId&&result.request.status==='complete'&&result.delivery?.state==='FILES_RETAINED'&&
              result.delivery.files[0].sha256===selected.sha256&&result.delivery.files[0].bytes===selected.bytes,
              'AGENT_RECEIVING_COMPLETE_EXPORT_CHANGED');
            const delivery=result.delivery,previous=journal.deliveries[selected.requestId];
            if(previous)need(identity(previous)===identity(delivery),'AGENT_RECEIVING_RETAINED_EXPORT_CHANGED');
            else{journal.deliveries[selected.requestId]=delivery;await checkpoint('HANDOFF_RETAINED',{requestId:selected.requestId,exportId:delivery.exportId});}
          }
          for(const selected of context.comparisons){
            const delivery=await (await client()).changesExport({dataset:selected.dataset,comparison:selected.comparison.id});
            need(delivery.files[0].sha256===selected.comparison.changesSha256,'AGENT_RECEIVING_COMPLETE_CHANGES_CHANGED');
            const key='changes/'+selected.dataset+'/'+selected.comparison.id,previous=journal.deliveries[key];
            if(previous)need(identity(previous)===identity(delivery),'AGENT_RECEIVING_RETAINED_CHANGES_CHANGED');
            else{journal.deliveries[key]=delivery;await checkpoint('CHANGES_RETAINED',{dataset:selected.dataset,exportId:delivery.exportId});}
          }
        }
        const deliveries=Object.values(journal.deliveries);
        need(deliveries.length>=context.exports.length,'AGENT_RECEIVING_COMPLETE_DELIVERIES_REQUIRED');
        const retained=await (async()=>{
          const result=[];let offset=0,snapshot,total;
          for(;;){const page=await (await clientFor('source')).exports({offset,limit:50,...(snapshot?{expectedSnapshot:snapshot}:{})});
            total??=page.total;snapshot??=page.snapshot;
            need(page.total===total&&page.snapshot===snapshot&&page.offset===offset,'AGENT_RECEIVING_EXPORT_INVENTORY_CHANGED');
            result.push(...page.items);if(page.nextOffset===null)break;
            need(page.nextOffset===offset+page.items.length&&page.items.length>0,'AGENT_RECEIVING_EXPORT_CURSOR_CHANGED');offset=page.nextOffset;}
          need(result.length===total,'AGENT_RECEIVING_EXPORT_INVENTORY_INCOMPLETE');return result;
        })();
        for(const delivery of deliveries){
          need(retained.some(value=>identity(value)===identity(delivery)),'AGENT_RECEIVING_RETAINED_DELIVERY_MISSING');
          const inspected=await inspect360GivingExport({client:await clientFor('source'),exportId:delivery.exportId});
          need(inspected.manifestSha256===delivery.manifestSha256&&identity(inspected.manifest.files)===identity(delivery.files),
            'AGENT_RECEIVING_MANIFEST_CHANGED');
          const destination=join(downloads,delivery.exportId),options={
            exportId:delivery.exportId,directory:destination,expectedManifestSha256:delivery.manifestSha256};
          if(context.stage==='source-original'&&!journal.transfer&&delivery.kind==='handoff'){
            journal.transfer={exportId:delivery.exportId,directory:destination,manifestSha256:delivery.manifestSha256,status:'PREPARED'};
            await checkpoint('TRANSFER_INTERRUPTION_PREPARED',{exportId:delivery.exportId});
          }
          if(context.stage==='source-original'&&journal.transfer?.exportId===delivery.exportId&&journal.transfer.status==='PREPARED'){
            try{
              await download360GivingExport({...options,client:await clientFor('source'),
                chunkSize:Math.min(65536,Math.max(1,Math.floor(delivery.files[0].bytes/3))),
                onProgress:async progress=>{
                  if(progress.bytes>0&&progress.bytes<progress.total){
                    journal.transfer.status='INTERRUPTED';journal.transfer.bytes=progress.bytes;
                    await checkpoint('TRANSFER_PREFIX_RETAINED',{exportId:delivery.exportId,bytes:progress.bytes});
                    throw Object.assign(new Error('Continue the original complete-file checkpoint.'),{code:'AGENT_RECEIVING_TRANSFER_INTERRUPTED'});
                  }
                }});
              need(false,'AGENT_RECEIVING_TRANSFER_INTERRUPTION_MISSING');
            }catch(error){if(error.code!=='AGENT_RECEIVING_TRANSFER_INTERRUPTED')throw error;}
          }
          if(context.stage==='source-original'&&journal.transfer?.exportId===delivery.exportId&&journal.transfer.status==='INTERRUPTED'){
            await closeHost();await openHost();
            await checkpoint('MERCHANT_REOPENED_FOR_TRANSFER',{exportId:delivery.exportId});
          }
          const result=await download360GivingExport({...options,client:await clientFor('source')});
          need(result.state==='COMPLETE'&&result.bytes===delivery.files[0].bytes&&result.manifestSha256===delivery.manifestSha256,
            'AGENT_RECEIVING_DOWNLOAD_INCOMPLETE');
          const file=join(destination,delivery.files[0].name);
          need(identity(await fileIdentity(file))===identity({bytes:delivery.files[0].bytes,sha256:delivery.files[0].sha256}),
            'AGENT_RECEIVING_DOWNLOADED_FILE_CHANGED');
          if(journal.transfer?.exportId===delivery.exportId&&journal.transfer.status==='INTERRUPTED'){
            need(result.resumed&&result.resumedBytes>=journal.transfer.bytes&&journal.transfer.bytes>0,
              'AGENT_RECEIVING_ORIGINAL_PREFIX_NOT_RESUMED');
            journal.transfer.status='COMPLETE';journal.transfer.resumedBytes=result.resumedBytes;
            await checkpoint('TRANSFER_COMPLETE',{exportId:delivery.exportId,resumedBytes:result.resumedBytes});
          }
          journal.downloads[delivery.exportId]={...result,file};report.deliveries++;
        }
        if(context.role==='receiver'){
          for(let index=0;index<context.exports.length;index++){
            const selected=context.exports[index],delivery=journal.deliveries[selected.requestId];
            const original=await activeSdk.request(selected.receiveRequestId);
            need(original.action==='receive'&&original.status==='complete'&&original.input.object===selected.sha256,
              'AGENT_RECEIVING_ORIGINAL_RECEIVE_CHANGED');
            const direct=await activeSdk.submit({id:original.id,action:original.action,input:original.input});
            need(identity(direct)===identity(original),'AGENT_RECEIVING_SDK_RECEIVE_CHANGED');
            for(const input of [{exportId:delivery.exportId,fromWorkspace:'source'},
              {file:'handoff-'+String(index+1).padStart(4,'0')}]){
              const result=(await (await client()).receive({requestId:selected.receiveRequestId,...input})).request;
              need(identity(result)===identity(original)&&result.result.archiveSha256===selected.sha256&&
                result.result.sourceWorkspaceId===journal.sourceWorkspaceId&&result.result.workspaceId===context.workspaceId,
                'AGENT_RECEIVING_MERCHANT_RECEIVE_CHANGED');
            }
            report.requests.receive=(report.requests.receive??0)+1;
          }
          for(const selected of context.comparisons){
            const result=(await (await client()).compare({requestId:selected.requestId,dataset:selected.dataset,
              before:selected.comparison.before,after:selected.comparison.after})).request;
            need(result.id===selected.requestId&&result.status==='complete'&&result.result.comparison.id===selected.comparison.id,
              'AGENT_RECEIVING_ORIGINAL_COMPARISON_CHANGED');
          }
        }
        const finalState=await activeSdk.state(),meta=metadata(finalState),datasets=[];
        await retain(join(phaseDirectory,'publisher-state.json'),encode(finalState));
        for(const dataset of meta.datasets){
          const folder=await privateDirectory(join(phaseDirectory,dataset.key),{create:true});
          const native=await activeSdk.nativeState(dataset.key),builds=[],comparisons=[];
          for(const [kind,values] of [['native-builds',native.builds],['native-comparisons',native.comparisons]])
            need(identity(await inventory(await client(),kind,dataset.key))===identity(values),'AGENT_RECEIVING_NATIVE_INVENTORY_CHANGED');
          for(const build of sorted(native.builds)){
            const query=await completeQuery(activeSdk,await client(),dataset.key,build,join(folder,build.id+'-rows.jsonl'),queryPageSize);
            builds.push({build,query});
          }
          for(const comparison of sorted(native.comparisons)){
            const pages=await completeChanges(activeSdk,await client(),dataset.key,comparison,join(folder,comparison.id+'-paged-changes.jsonl'));
            const output=join(folder,comparison.id+'-complete-changes.jsonl');
            const complete=await activeSdk.downloadChanges({dataset:dataset.key,comparison:comparison.id,output});
            need(complete.sha256===comparison.changesSha256,'AGENT_RECEIVING_NATIVE_CHANGES_CHANGED');
            const semantic=await semanticLines(output,parseExactJSON);
            need(identity(semantic)===identity({rowCount:pages.rowCount,bytes:pages.bytes,sha256:pages.sha256}),
              'AGENT_RECEIVING_CHANGES_PAGES_INCOMPLETE');
            comparisons.push({comparison,pages,file:{bytes:complete.bytes,sha256:complete.sha256}});
          }
          datasets.push({key:dataset.key,builds,comparisons});
        }
        const observation={metadata:meta,datasets,sha256:identity({metadata:meta,datasets})};
        if(journal.baseline)need(journal.baseline.sha256===observation.sha256,'AGENT_RECEIVING_COMPLETE_CONTENT_CHANGED');
        else{
          need(context.stage==='source-original','AGENT_RECEIVING_SOURCE_BASELINE_REQUIRED');
          journal.baseline=observation;
        }
        await retain(join(phaseDirectory,'complete-observation.json'),encode(observation));
        report.completeContentSha256=observation.sha256;report.datasets=datasets.length;
        report.builds=datasets.reduce((sum,value)=>sum+value.builds.length,0);
        report.comparisons=datasets.reduce((sum,value)=>sum+value.comparisons.length,0);
        report.rows=datasets.reduce((sum,value)=>sum+value.builds.reduce((all,build)=>all+build.query.rowCount,0),0);
        report.observation=join(phaseDirectory,'complete-observation.json');
        report.completedAt=timestamp();journal.stages[context.stage]=report;
        await checkpoint('PHASE_COMPLETE',{phase:context.stage,completeContentSha256:observation.sha256});
        return report;
      }catch(error){originalError=error;journal.error={...safeError(error),at:timestamp()};
        await atomicJSON(journalPath,journal).catch(()=>{});throw error;}
      finally{
        try{await closeHost();}catch(error){if(originalError)originalError.closeError=safeError(error);else throw error;}
        finally{if(activeSdk){await activeSdk.close();activeSdk=null;}}
      }
    }
  });
  const journal=await readJSON(journalPath);
  need(managed.connectionWorkflow===WORKFLOW&&STAGES.every(stage=>journal.stages[stage]&&managed.connectedStages[stage])&&
    journal.transfer?.status==='COMPLETE','AGENT_RECEIVING_COMPLETE_WORKFLOW_REQUIRED');
  const result={schema:SCHEMA,status:'COMPLETE',completedAt:timestamp(),directory,
    sourceWorkspaceId:managed.sourceWorkspaceId,receiverWorkspaceId:managed.receiverWorkspaceId,
    runtime:managed.runtime,applications:managed.applications,runs:managed.runs,stages:journal.stages,
    transfer:journal.transfer,completeContentSha256:journal.baseline.sha256,
    deliveries:Object.values(journal.deliveries),downloads:Object.values(journal.downloads),
    managedResult:join(directory,'managed-publisher-result.json'),journal:journalPath};
  await atomicJSON(join(directory,'agent-publisher-result.json'),result);return result;
}
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&args[0]==='--help'){
    process.stdout.write('starforge dataset-360giving-agent-receiving --input /absolute/private-agent-receiving-input.json\n'+
      'Reuse this original receiving directory for saved Applications, client calls and complete download checkpoints.\n');
    return;
  }
  need(args.length===2&&args[0]==='--input','AGENT_RECEIVING_ARGUMENT_INVALID');
  const path=absolute(args[1]),stat=await lstat(path);
  need(stat.isFile()&&!stat.isSymbolicLink()&&await realpath(dirname(path))===dirname(path)&&
    !(stat.mode&0o077)&&(!process.getuid||stat.uid===process.getuid()),'AGENT_RECEIVING_PRIVATE_INPUT_REQUIRED');
  const value=await readJSON(path),allowed=new Set(['schema','runtimeDirectory','sourceWorkspace','pythonExecutable',
    'directory','label','timeoutMs','pollMs','queryPageSize']);
  need(value?.schema===AGENT_PUBLISHER_RECEIVING_INPUT&&Object.keys(value).every(key=>allowed.has(key)),
    'AGENT_RECEIVING_INPUT_SCHEMA_INVALID');
  const {schema,...input}=value;
  const result=await runPublisherAgentReceiving({...input,onStage:stage=>process.stdout.write(JSON.stringify({agentReceiving:stage})+'\n')});
  process.stdout.write(JSON.stringify(result)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}
  catch(error){process.stderr.write(JSON.stringify({error:safeError(error)})+'\n');process.exitCode=1;}
}
