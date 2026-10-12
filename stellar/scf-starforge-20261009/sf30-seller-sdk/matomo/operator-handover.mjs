// MIT. Reviewed operator-owned dataset pages through ORIGINAL SF30 and SF100.
import {join,dirname,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {init,append,scan,finalize} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {privateDirectory,bytes,digest,hashPrivate,fault,stamp} from '../postgres/publisher/files.mjs';
import {identifier,only,text,integer} from './contract.mjs';
import {writeNew,readRetained,readRetainedJson} from './store.mjs';
import {parseNative,cell} from './values.mjs';
const HERE=fileURLToPath(new URL('.',import.meta.url));
const SDK=dirname(HERE),BUYER=fileURLToPath(new URL('../../sf88-operator-buyer-cli/python',import.meta.url));
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export function createMatomoHandover(store,merchant,editions,{environment=process.env,python=environment.MATOMO_PYTHON??'python3',node=process.execPath}={}) {
  store.db.exec('CREATE TABLE IF NOT EXISTS handovers(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS receivings(id TEXT PRIMARY KEY,handover_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);');
  const record=(table,id)=>{const row=store.db.prepare('SELECT * FROM '+table+' WHERE id=?').get(identifier(id));if(!row)throw fault('MATOMO_HANDOVER_NOT_FOUND',undefined,404);return {...row,data:JSON.parse(row.data)};};
  const handover=id=>record('handovers',id),receiving=id=>record('receivings',id);
  const change=(table,id,patch,event)=>store.transaction(()=>{const current=record(table,id);store.db.prepare('UPDATE '+table+' SET data=? WHERE id=?').run(JSON.stringify({...current.data,...patch}),id);store.event(event,id);return record(table,id);});
  function list(){return {handovers:store.db.prepare('SELECT id FROM handovers ORDER BY rowid DESC').all().map(x=>handover(x.id)),receivings:store.db.prepare('SELECT id FROM receivings ORDER BY rowid DESC').all().map(x=>receiving(x.id))};}
  async function customer(command,args,signal){
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const child=spawn(python,['-m','matomo.customer',command,...args,'--node',node],{shell:false,cwd:SDK,
        env:{...environment,PYTHONPATH:[SDK,BUYER,environment.PYTHONPATH].filter(Boolean).join(delimiter)},
        stdio:['ignore','pipe','pipe'],signal});
      const output=[];let size=0,failure,stderrBytes=0;
      const timeout=setTimeout(()=>{failure=fault('MATOMO_CUSTOMER_TIMEOUT');child.kill('SIGTERM');},180000);
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576){failure=fault('MATOMO_CUSTOMER_OUTPUT_LIMIT');child.kill('SIGTERM');}else output.push(chunk);});
      // Credentials and unrestricted tracebacks never enter a browser response.
      child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>1048576){failure=fault('MATOMO_CUSTOMER_ERROR_LIMIT');child.kill('SIGTERM');}});
      child.once('error',error=>{failure=signal?.aborted?fault('MATOMO_CUSTOMER_CANCELLED'):fault(error.code==='ENOENT'?'MATOMO_PYTHON_UNAVAILABLE':'MATOMO_CUSTOMER_FAILED');});
      child.once('close',code=>{
        clearTimeout(timeout);if(failure){reject(failure);return;}
        let value;try{value=JSON.parse(Buffer.concat(output));}catch{reject(fault('MATOMO_CUSTOMER_RESULT_INVALID'));return;}
        if(code!==0||value.error){reject(fault(/^MATOMO_[A-Z0-9_]+$/.test(value.error??'')?value.error:'MATOMO_CUSTOMER_FAILED'));return;}
        resolve(value);
      });
    });
  }
  async function finish(id,{signal}) {
    let current=handover(id),delivery=merchant.delivery(current.delivery_id);
    if(delivery.data.projection!=='source-files'||delivery.data.editionSha256!==current.data.editionSha256)throw fault('MATOMO_HANDOVER_SOURCE_CHANGED');
    const edition=await editions.manifest(delivery.data.editionId,{database:true});
    const config=await merchant.deliveryFile(delivery.id,'config'),csv=await merchant.deliveryFile(delivery.id,'csv');
    const configPin=await hashPrivate(config.path,65536),csvPin=await hashPrivate(csv.path,268435456);
    if(configPin.hash!==current.data.configSha256||csvPin.hash!==current.data.csvSha256)throw fault('MATOMO_HANDOVER_CANDIDATE_CHANGED');
    const folder=join(store.directory,'handovers',id),room=join(folder,'data-room');
    await privateDirectory(folder,true);await privateDirectory(join(folder,'source-pages'),true);
    if(!await exists(room))await init(room);
    let native=await scan(room,{retainPayload:false});
    if(!native.finalized) {
      const producer=await loadDatasetConfig(config.path);
      while(!native.pages.length||native.nextCursor!==null){
        signal.throwIfAborted();
        if(native.pages.length>=4096)throw fault('MATOMO_HANDOVER_PAGE_LIMIT');
        const index=native.pages.length,prefix=String(index).padStart(5,'0'),query={limit:String(current.data.limit)};
        if(index)query.cursor=native.nextCursor;
        const intent='matomo-operator-'+digest(Buffer.from(id)).slice(0,32)+'-'+index;
        const request={schema:'stellar-forge.matomo-operator-page.v1',id:intent,handoverId:id,deliveryId:delivery.id,
          configSha256:configPin.hash,csvSha256:csvPin.hash,query,
          authorization:{kind:'REVIEWED_LOCAL_DATASET_OPERATOR',reviewer:current.data.reviewer,note:current.data.note},
          providerRequest:false,paymentRequest:false};
        const requestFile=join(folder,'source-pages',prefix+'.request.json'),pageFile=join(folder,'source-pages',prefix+'.response.json');
        await writeNew(requestFile,bytes(request));
        let page;
        if(await exists(pageFile))page=await readRetained(pageFile,2097152);
        else {
          const response=producer.handle({query});
          page=bytes(response.body);await writeNew(pageFile,page);
          await writeNew(join(folder,'source-pages',prefix+'.receipt.json'),bytes({schema:'stellar-forge.matomo-operator-response.v1',
            requestId:intent,status:response.status,bodyBytes:page.length,bodySha256:digest(page),
            source:'ORIGINAL_SF30_LOCAL_DATASET_HANDLER',providerRequest:false,paymentRequest:false}));
          if(response.status!==200)throw fault('MATOMO_ORIGINAL_DATASET_PAGE_FAILED');
        }
        const value=JSON.parse(page);
        if(value.schema!=='stellar-forge.dataset-page.v1'||value.page?.total!==edition.value.sourceFiles.rows)throw fault('MATOMO_HANDOVER_POPULATION_CHANGED');
        const receiptFile=join(folder,'source-pages',prefix+'.receipt.json');
        if(!await exists(receiptFile))await writeNew(receiptFile,bytes({schema:'stellar-forge.matomo-operator-response.v1',requestId:intent,status:200,
          statusBasis:'ORIGINAL_DATASET_PAGE_RESPONSE_CONTRACT',bodyBytes:page.length,bodySha256:digest(page),
          source:'ORIGINAL_SF30_LOCAL_DATASET_HANDLER',providerRequest:false,paymentRequest:false,reconciledFromRetainedResponse:true}));
        await append(room,{page:pageFile,intent,cursor:index?native.nextCursor:undefined,evidence:requestFile});
        native=await scan(room,{retainPayload:false});
        change('handovers',id,{state:'PAGING',native:{pages:native.pages.length,rows:native.count,total:native.total,nextCursor:native.nextCursor,chain:native.chain}},'OPERATOR_PAGE_RETAINED');
      }
      if(native.count!==edition.value.sourceFiles.rows)throw fault('MATOMO_HANDOVER_POPULATION_CHANGED');
      signal.throwIfAborted();await finalize(room);native=await scan(room,{retainPayload:false});
    }
    if(native.count!==edition.value.sourceFiles.rows||!native.finalized)throw fault('MATOMO_HANDOVER_POPULATION_CHANGED');
    const scanFile=join(folder,'native-scan.json');await writeNew(scanFile,bytes(native));
    change('handovers',id,{state:'FINALIZED',native:{pages:native.pages.length,rows:native.count,total:native.total,snapshot:native.snapshot,
      chain:native.chain,finalized:true},room,scanFile},'NATIVE_HANDOVER_FINALIZED');
    const archive=await customer('pack',['--scan',scanFile,'--operator-evidence',join(folder,'source-pages'),'--out',join(folder,'handover.zip')],signal);
    change('handovers',id,{state:'COMPLETE',archive,error:null},'NATIVE_HANDOVER_PACKAGED');
    return {handover:handover(id)};
  }
  async function prepare(input) {
    only(input,['operationId','expectedRevision','deliveryId','reviewer','note','limit']);
    const id=identifier(input.operationId),delivery=merchant.delivery(input.deliveryId);
    if(delivery.data.projection!=='source-files')throw fault('MATOMO_SOURCE_FILES_DELIVERY_REQUIRED');
    if(!['REVIEWED','PUBLISHED'].includes(delivery.data.state))throw fault('MATOMO_REVIEWED_DELIVERY_REQUIRED');
    const reviewer=text(input.reviewer,'the operator reviewer',128),note=text(input.note,'the handover purpose and local-read authorization',4000),
      limit=integer(input.limit,8,1,12,'MATOMO_HANDOVER_PAGE_LIMIT');
    const config=await merchant.deliveryFile(delivery.id,'config'),csv=await merchant.deliveryFile(delivery.id,'csv');
    const configPin=await hashPrivate(config.path,65536),csvPin=await hashPrivate(csv.path,268435456);
    return store.perform('prepare-handover',input,async context=>{
      store.transaction(()=>{store.db.prepare('INSERT INTO handovers(id,delivery_id,data,created_at) VALUES(?,?,?,?)').run(id,delivery.id,JSON.stringify({
        state:'PREPARING',editionId:delivery.data.editionId,editionSha256:delivery.data.editionSha256,
        configSha256:configPin.hash,csvSha256:csvPin.hash,reviewer,note,limit}),stamp());store.event('HANDOVER_STARTED',id);});
      return finish(id,context);
    });
  }
  async function resume(input) {
    only(input,['operationId','expectedRevision','handoverId']);handover(input.handoverId);
    return store.perform('resume-handover',input,context=>finish(input.handoverId,context));
  }
  async function finishReceiving(id,{signal}){
    const current=receiving(id),original=handover(current.handover_id);
    if(original.data.state!=='COMPLETE'||original.data.archive.sha256!==current.data.archiveSha256)throw fault('MATOMO_RECEIVING_HANDOVER_CHANGED');
    const folder=join(store.directory,'receiving');await privateDirectory(folder,true);
    const destination=join(folder,id),result=await customer('receive',['--archive',original.data.archive.path,'--out',destination],signal);
    if(result.editionId!==original.data.editionId||result.archiveSha256!==original.data.archive.sha256)throw fault('MATOMO_RECEIVING_IDENTITY_CHANGED');
    change('receivings',id,{state:'COMPLETE',directory:destination,result,error:null},'CUSTOMER_SOURCE_RECEIVED');
    return {receiving:receiving(id)};
  }
  async function receive(input) {
    only(input,['operationId','expectedRevision','handoverId','label']);
    const id=identifier(input.operationId),original=handover(input.handoverId),label=text(input.label,'the receiving workspace label',160);
    if(original.data.state!=='COMPLETE')throw fault('MATOMO_COMPLETE_HANDOVER_REQUIRED');
    return store.perform('receive-handover',input,async context=>{
      store.transaction(()=>{store.db.prepare('INSERT INTO receivings(id,handover_id,data,created_at) VALUES(?,?,?,?)').run(id,original.id,
        JSON.stringify({state:'RECEIVING',label,archiveSha256:original.data.archive.sha256}),stamp());store.event('RECEIVING_STARTED',id);});
      return finishReceiving(id,context);
    });
  }
  async function resumeReceiving(input){
    only(input,['operationId','expectedRevision','receivingId']);receiving(input.receivingId);
    return store.perform('resume-receiving',input,context=>finishReceiving(input.receivingId,context));
  }
  async function reopen(input){
    only(input,['operationId','expectedRevision','receivingId']);
    return store.perform('reopen-receiving',input,async({signal})=>{
      const current=receiving(input.receivingId);if(current.data.state!=='COMPLETE')throw fault('MATOMO_COMPLETE_RECEIVING_REQUIRED');
      const result=await customer('reopen',['--out',current.data.directory],signal);
      if(result.archiveSha256!==current.data.archiveSha256)throw fault('MATOMO_RECEIVING_IDENTITY_CHANGED');
      change('receivings',current.id,{result,lastReopenedAt:stamp()},'CUSTOMER_SOURCE_REOPENED');return {receiving:receiving(current.id)};
    });
  }
  async function receivedRows(id,{offset=0,limit=25}={}) {
    offset=integer(offset,0,0,1000000,'MATOMO_ROW_OFFSET');limit=integer(limit,25,1,100,'MATOMO_ROW_LIMIT');
    const current=receiving(id);if(current.data.state!=='COMPLETE')throw fault('MATOMO_COMPLETE_RECEIVING_REQUIRED');
    const source=join(current.data.directory,'source'),manifest=await readRetainedJson(join(source,'source-files.json'),16777216);
    if(digest(await readRetained(join(source,'source-files.json'),16777216))!==current.data.result.captureId)throw fault('MATOMO_RECEIVED_SOURCE_CHANGED');
    const member=manifest.files.find(x=>x.path==='report-rows.jsonl'),path=join(source,'report-rows.jsonl'),pin=await hashPrivate(path,1073741824);
    if(!member||pin.hash!==member.sha256||pin.bytes!==member.bytes)throw fault('MATOMO_RECEIVED_SOURCE_CHANGED');
    const stream=createReadStream(path),lines=createInterface({input:stream,crlfDelay:Infinity});const rows=[];let index=0;
    try{for await(const line of lines){
      if(index++<offset)continue;if(rows.length>=limit)break;
      const row=parseNative(line);rows.push({id:row.id,tableId:row.tableId,index:row.sourceRow,sourceRequest:row.sourceRequest,sourceIndex:row.sourceIndex,context:row.context,
        cells:Object.fromEntries(Object.entries(row.data).map(([name,value])=>[name,cell(value)]))});
    }}finally{lines.close();stream.destroy();}
    return {receiving:current,rows,page:{offset,limit,total:manifest.rows,next:offset+rows.length<manifest.rows?offset+rows.length:null}};
  }
  async function file(id,kind='archive'){
    const current=handover(id);if(current.data.state!=='COMPLETE')throw fault('MATOMO_COMPLETE_HANDOVER_REQUIRED');
    if(kind==='archive')return {path:current.data.archive.path,sha256:current.data.archive.sha256,name:id+'.zip',mediaType:'application/zip'};
    if(kind==='scan')return {content:await readRetained(current.data.scanFile,16777216),name:id+'-native-scan.json',mediaType:'application/json'};
    throw fault('MATOMO_HANDOVER_FILE');
  }
  return Object.freeze({list,handover,receiving,prepare,resume,receive,resumeReceiving,reopen,receivedRows,file});
}
