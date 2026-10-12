// MIT. Complete retained invoice, event and settlement workspace.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  STATE_SCHEMA,SOURCE_SCHEMA,EDITION_SCHEMA,TABLES,files,now,own,plain,clone,digest,canonical,jsonBytes,
  need,integer,text,identifier,selected,hash,privateDirectory,withLock,descriptor,publicError,randomUUID,
  sealed,verified,publicConnection,initialize,readState,recoverState,intent,replay,revision,commitState,
  mutate,retainJSON,readDescriptor,readRecord,html,safeFilename
} from './common.mjs';
import {openInvoiceSource,parseInvoiceJSON,prepareListenerDelivery,sendListenerDelivery,verifyCustomerWebhook,describeListenerBackend} from './native.mjs';
import {normalizeInvoiceProgramme,normalizeInvoiceRecords,reconcileInvoices,compareInvoiceReconciliations,buildInvoiceReport} from './reconciliation.mjs';
export const INVOICE_WORKSPACE_SCHEMA=STATE_SCHEMA;
const LIST_KINDS=new Set(['payments','operations','transactions']);
function versioned(table,id,version){
  const record=selected(table,id),number=version??record.currentVersion;
  integer(number,'version',1);
  const entry=record.versions.find(value=>value.version===number);
  need(entry,'VERSION_NOT_FOUND','Select a retained original version.',{id,version:number});return entry;
}
function unique(values,label){
  need(Array.isArray(values),'INVALID_ARGUMENT','Supply '+label+' as an array.');
  need(new Set(values).size===values.length,'INVALID_ARGUMENT','Select each '+label+' only once.');
  return values;
}
function sourceIdentity(connection){return digest(jsonBytes(connection));}
function numberLedger(value,label){
  if(typeof value==='string'&&/^\d+$/.test(value))value=Number(value);
  return integer(value,label,1,4294967295);
}
function selection(value={}){
  need(plain(value),'INVALID_SELECTION','Supply a ledger selection.');
  return {fromLedger:value.fromLedger==null?null:numberLedger(value.fromLedger,'fromLedger'),
    throughLedger:value.throughLedger==null?null:numberLedger(value.throughLedger,'throughLedger')};
}
function projectOriginal(value,recordsPath){
  if(recordsPath===null)return [value];
  need(typeof recordsPath==='string'&&(recordsPath===''||recordsPath.startsWith('/')),'INVALID_RECORDS_PATH','Select the original JSON pointer.');
  const segments=recordsPath===''?[]:recordsPath.slice(1).split('/');
  for(const segment of segments)need(!/~(?:[^01]|$)/.test(segment),'INVALID_RECORDS_PATH','The original JSON pointer is malformed.');
  const keys=segments.map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~'));
  let current=value;
  for(const key of keys){
    need((plain(current)||Array.isArray(current))&&own(current,key),'RECORDS_PATH_NOT_FOUND','The selected original record array was not found.',{recordsPath});
    current=current[key];
  }
  return Array.isArray(current)?current:[current];
}
function defaultRecordsPath(provider,kind){
  if(provider==='elementpay')return kind==='orders'?'/data':kind==='webhook'?null:'/data';
  if(provider==='evm')return '/result';
  if(provider==='horizon')return LIST_KINDS.has(kind)?'/_embedded/records':null;
  if(['payments','disbursements','disbursementReceivers','receivers'].includes(kind))return '/data';
  if(['assets','wallets','distributionWallets','distributionWalletAudit'].includes(kind))return '';
  return null;
}
function opaqueRequest(request){
  const value=clone(request??{});
  if(plain(value.headers))for(const key of Object.keys(value.headers))if(/authorization|cookie|api[-_]key|token/i.test(key))delete value.headers[key];
  return value;
}
function derivedId(value){
  const hex=digest(value);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
function privateSecrets(value,result=[]){
  if(!plain(value))return result;
  for(const [key,item] of Object.entries(value)){
    if(/authorization|cookie|api.?key|token|password|secret/i.test(key)&&typeof item==='string'&&item)result.push(item);
    else if(plain(item))privateSecrets(item,result);
  }
  return result;
}
function errorStatus(error){return {code:String(error?.code??'NATIVE_SOURCE_ERROR'),message:String(error?.message??'The source could not be read.'),details:clone(error?.details??{})};}
function summarizeState(state,connections){
  return {...clone(state),requests:undefined,connections:connections.map(clone),
    counts:Object.fromEntries(TABLES.map(table=>[table,Object.keys(state[table]).length]))};
}
async function originalVersion(directory,table,id,version){
  const selectedVersion=versioned(table,id,version);
  return verified(await readRecord(directory,selectedVersion),'Saved version');
}
async function recordsFor(directory,state,sourceIds){
  const records=[];
  for(const sourceId of sourceIds){
    const source=selected(state.sources,sourceId,'Source');
    if(source.projectionFile)records.push(...await readRecord(directory,source.projectionFile));
  }
  return records;
}
async function retainSource(directory,state,{
  id=randomUUID(),captureId=null,programmeId=null,programmeVersion=null,provider,kind,network,connection=null,label,
  request={},response={},body,originalBodyFile=null,records,recordsPath=null,sourceScope=null,observedAt=now(),selection:bounds=null,error=null,runtime=null,runtimeConfiguration=null,webhook=null,normalizationRequest=null
}){
  need(Buffer.isBuffer(body),'INVALID_SOURCE','Supply the complete original source bytes.');
  const root='sources/'+id,bodyFile=originalBodyFile??await files.writeNew(directory,root+'/original.body',body);
  need(bodyFile.bytes===body.length&&bodyFile.sha256===digest(body),'SOURCE_CHANGED','The original native response differs from its retained bytes.');
  const requestFile=await retainJSON(directory,root+'/request.json',opaqueRequest(request));
  const responseFile=await retainJSON(directory,root+'/response.json',{status:response.status??null,headers:response.headers??{},
    body:bodyFile,observedAt,bodyComplete:response.bodyComplete??true,startedAt:response.startedAt??null,elapsedMs:response.elapsedMs??null,error:error?errorStatus(error):null});
  let projected=[],projectionError=null,excludedCount=0,crossedBoundary=false;
  try{
    if(provider!=='document'&&!error){
      if(provider==='evm'&&['logs','receipt'].includes(kind))need(plain(runtimeConfiguration)&&typeof runtimeConfiguration.runtimeDirectory==='string','RUNTIME_CONNECTION_REQUIRED','Select a named EVM connection with its retained original runtime to interpret these original logs or receipt transfers.');
      projected=await normalizeInvoiceRecords({provider,kind,records,sourceId:id,captureId,sourceScope:sourceScope??id,observedAt,network,rawBody:body,recordsPath,runtime:runtimeConfiguration,webhook,request:normalizationRequest??request});
      const usedRuntimes=projected.map(row=>row.runtime??row.projection?.runtime).filter(Boolean);
      if(!runtime&&usedRuntimes.length)runtime=usedRuntimes[0];
      for(const used of usedRuntimes)need(canonical(used)===canonical(runtime),'RUNTIME_CHANGED','Original records must use one exact selected runtime per source.');
      need(Array.isArray(projected),'INVALID_NATIVE_PROJECTION','The native projection must retain a record array.');
      if(provider==='horizon'&&LIST_KINDS.has(kind)&&bounds){
        const order=bounds.order??request.filters?.order??request.order??'asc';
        projected=projected.filter(row=>{
          const original=row.original??{},raw=row.projection?.ledger??original.ledger??original.transaction?.ledger;
          const ledger=numberLedger(raw,'original joined transaction ledger');
          if(order==='asc'&&bounds.throughLedger!==null&&ledger>bounds.throughLedger)crossedBoundary=true;
          if(order==='desc'&&bounds.fromLedger!==null&&ledger<bounds.fromLedger)crossedBoundary=true;
          const include=(bounds.fromLedger===null||ledger>=bounds.fromLedger)&&(bounds.throughLedger===null||ledger<=bounds.throughLedger);
          if(!include)excludedCount++;return include;
        });
      }
    }
  }catch(problem){projectionError=errorStatus(problem);projected=[];}
  const projectionFile=await retainJSON(directory,root+'/projection.json',projected);
  const source=sealed({schema:SOURCE_SCHEMA,id,captureId,programmeId:programmeId??state.captures[captureId]?.programmeId??null,programmeVersion:programmeVersion??state.captures[captureId]?.programmeVersion??null,sourceScope:sourceScope??id,provider,kind,network,connection:clone(connection),label:label??kind,
    observedAt,requestFile,responseFile,bodyFile,projectionFile,recordsPath,projectionRequest:opaqueRequest(normalizationRequest??request),webhook:webhook?clone(webhook):null,runtime:runtime?clone(runtime):null,
    nativeRecords:Array.isArray(records)?records.length:0,selectedRecords:projected.length,
    selection:bounds?{...clone(bounds),excludedCount,crossedBoundary}:null,error:error?errorStatus(error):projectionError});
  const file=await retainJSON(directory,root+'/source.json',source);
  state.sources[id]={id,captureId,programmeId:source.programmeId,programmeVersion:source.programmeVersion,sourceScope:sourceScope??id,provider,kind,network,label:source.label,observedAt,
    bodyFile,projectionFile,file,sha256:source.sha256,nativeRecords:source.nativeRecords,
    selectedRecords:projected.length,selection:source.selection,error:source.error,runtime:source.runtime};
  return {source:state.sources[id],projected,crossedBoundary,error:source.error};
}
function defaultBody(name,data){return {name,...clone(data)};}
export async function inspectInvoiceWorkspace({directory,allowMissing=false}){
  try{const state=await readState(directory);return summarizeState(state,[]);}
  catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
}
export async function openInvoiceWorkspace({directory,connections={},profile={},signal,applicationDirectory}){
  await initialize(directory,profile);
  const connectionMap=new Map();
  for(const [alias,input] of Object.entries(connections)){
    const configuration=clone(input);
    if(configuration.provider==='evm'){
      const supplied=configuration.runtime??{};
      configuration.runtime={...supplied,
        installationDirectory:supplied.installationDirectory??configuration.installationDirectory??applicationDirectory??fileURLToPath(new URL('.',import.meta.url)),
        runtimeDirectory:supplied.runtimeDirectory??configuration.runtimeDirectory??join(directory+'.runtimes',derivedId(alias)),
        expectedManifestSha256:supplied.expectedManifestSha256??configuration.expectedManifestSha256
      };
    }
    const summary=publicConnection(alias,configuration),readable=['elementpay','sdp','horizon','evm'].includes(summary.provider);
    const adapter=readable?openInvoiceSource(configuration):null,native=adapter?.describe()??(summary.provider==='listener-backend'?describeListenerBackend(configuration):null);
    Object.assign(summary,{sourceScope:native?.id??digest(jsonBytes({provider:configuration.provider,baseUrl:configuration.baseUrl??null,network:configuration.network??null,tenant:configuration.accountScope??configuration.merchantId??configuration.tenantName??alias,wallet:configuration.walletId??null})),
      ...(native?{nativeSource:native,network:native.network??summary.network}:{})});
    connectionMap.set(alias,{summary,private:clone(configuration),adapter});
  }
  let closed=false;
  const check=()=>need(!closed,'WORKSPACE_CLOSED','Reopen the invoice and settlement workspace.');
  function connection(alias,expected){
    const result=connectionMap.get(alias);
    need(result,'CONNECTION_REQUIRED','Configure the original named private source connection.',{alias});
    if(expected)need(sourceIdentity(result.summary)===sourceIdentity(expected),'CONNECTION_CHANGED',
      'The selected source connection differs from this capture.',{alias});
    return result;
  }
  function sourceAdapter(alias,expected){
    const result=connection(alias,expected);need(result.adapter,'INVALID_CONNECTION','Select a readable original source connection.');return result.adapter;
  }
  async function describe(){
    check();const state=await readState(directory);
    return summarizeState(state,[...connectionMap.values()].map(value=>value.summary));
  }
  async function sourceCatalog(){
    check();return [...connectionMap.entries()].filter(([,value])=>value.adapter).map(([alias,value])=>({connection:value.summary,catalog:value.adapter.describe()}));
  }
  async function profileSave(args){
    check();return mutate(directory,'profile.save',args,async state=>{
      const value=clone(args.profile);need(plain(value),'INVALID_ARGUMENT','Supply the workspace profile.');
      text(value.name,'workspace name');if(value.organization!==undefined)need(typeof value.organization==='string','INVALID_ARGUMENT','Use an organization name.');
      state.profile=value;return {profile:clone(value)};
    });
  }

  async function programmeSave(args){
    check();return mutate(directory,'programme.save',args,async state=>{
      const id=args.programmeId??randomUUID();identifier(id);
      const previous=args.programmeId?selected(state.programmes,id,'Programme'):null,version=(previous?.currentVersion??0)+1;
      if(args.expectedVersion!==undefined)need(previous?.currentVersion===integer(args.expectedVersion,'expected programme version',1),
        'PROGRAMME_VERSION_CONFLICT','The programme advanced after it was opened.',{currentVersion:previous?.currentVersion,expectedVersion:args.expectedVersion});
      const definition=normalizeInvoiceProgramme(args.definition),name=text(args.name??definition.name,'programme name');
      const body=sealed({schema:'stellar-forge.invoice-settlement.programme.v1',id,version,name,definition,createdAt:now()});
      const file=await retainJSON(directory,'programmes/'+id+'/'+version+'.json',body);
      const entry={id,version,name,sha256:body.sha256,file,createdAt:body.createdAt,invoiceCount:definition.invoices.length,assetCount:definition.assets.length};
      state.programmes[id]={id,name,currentVersion:version,versions:[...(previous?.versions??[]),entry]};
      return {programmeId:id,version,programme:entry};
    });
  }
  async function programmeRead({programmeId,version}){
    check();const state=await readState(directory);return originalVersion(directory,state.programmes,programmeId,version);
  }

  async function sourceImport(args){
    check();return mutate(directory,'source.import',args,async state=>{
      need(['sdp','horizon','elementpay','evm','document'].includes(args.provider),'INVALID_SOURCE','Select an original ElementPay, chain, payout or document source.');
      text(args.kind??'document','source kind',100);text(args.label??args.kind??'Original document','source label');
      need(typeof args.bodyBase64==='string','INVALID_SOURCE','Supply the complete source as base64.');
      const body=Buffer.from(args.bodyBase64,'base64');
      need(body.toString('base64')===args.bodyBase64,'INVALID_SOURCE','Use complete canonical base64.');
      const recordsPath=args.recordsPath===undefined?defaultRecordsPath(args.provider,args.kind):args.recordsPath;
      let records=[],error=null;
      if(args.provider!=='document'){
        try{records=projectOriginal(parseInvoiceJSON(body).value,recordsPath);}catch(problem){error=errorStatus(problem);}
      }
      const programme=args.programmeId?await originalVersion(directory,state.programmes,args.programmeId,args.programmeVersion):null;
      const chosen=args.connectionAlias?connection(args.connectionAlias):null;
      if(chosen)need(chosen.summary.provider===args.provider,'INVALID_CONNECTION','Select a connection for this original source provider.');
      const result=await retainSource(directory,state,{programmeId:programme?.id??null,programmeVersion:programme?.version??null,provider:args.provider,kind:args.kind??'document',network:args.network??chosen?.summary.network??null,connection:chosen?.summary??null,runtimeConfiguration:chosen?.private.runtime??null,
        label:args.label,body,records,recordsPath,sourceScope:args.sourceScope??chosen?.summary.sourceScope??null,request:args.request??{source:'operator-file',filename:args.filename??null},
        response:{status:args.status??null,headers:{'content-type':args.contentType??'application/json'}},error});
      return {sourceId:result.source.id,source:result.source};
    });
  }
  async function sourceProject(args){
    check();return mutate(directory,'source.project',args,async state=>{
      const original=selected(state.sources,args.sourceId,'Original source');
      const body=await readDescriptor(directory,original.bodyFile),fullOriginal=await readRecord(directory,original);
      const normalizationRequest=fullOriginal.projectionRequest??await readRecord(directory,fullOriginal.requestFile);
      const records=projectOriginal(parseInvoiceJSON(body).value,args.recordsPath);
      const chosenAlias=args.connectionAlias??((args.provider??original.provider)===original.provider?fullOriginal.connection?.alias:null);
      const chosen=chosenAlias?connection(chosenAlias,args.connectionAlias?undefined:fullOriginal.connection):null;
      if(chosen)need(chosen.summary.provider===(args.provider??original.provider),'INVALID_CONNECTION','Select a connection for this original source provider.');
      const result=await retainSource(directory,state,{programmeId:original.programmeId,programmeVersion:original.programmeVersion,provider:args.provider??original.provider,kind:args.kind??original.kind,
        network:args.network??original.network,label:args.label??original.label,body,records,recordsPath:args.recordsPath,sourceScope:args.sourceScope??original.sourceScope,connection:chosen?.summary??null,runtimeConfiguration:chosen?.private.runtime??null,
        request:{source:'original-source-projection',sourceId:original.id,bodySha256:original.bodyFile.sha256},normalizationRequest,webhook:fullOriginal.webhook??null,
        observedAt:original.observedAt});
      return {sourceId:result.source.id,originalSourceId:original.id,source:result.source};
    });
  }
  async function sourceRead({sourceId}){
    check();const state=await readState(directory);const source=selected(state.sources,sourceId,'Source');
    return {source:await readRecord(directory,source),records:source.projectionFile?await readRecord(directory,source.projectionFile):[]};
  }
  async function sourceFile({sourceId,part='body',offset=0,length=1024*1024}){
    check();const state=await readState(directory),source=selected(state.sources,sourceId,'Source'),full=await readRecord(directory,source);
    const names={body:'bodyFile',request:'requestFile',response:'responseFile',projection:'projectionFile',manifest:'file'};
    need(own(names,part),'INVALID_ARGUMENT','Select body, request, response, projection or manifest.');
    const item=part==='manifest'?source.file:full[names[part]];
    integer(offset,'offset');integer(length,'length',1,4*1024*1024);
    const range=await files.sourceFileRange(directory,item,offset,length);
    return {sourceId,part,file:item,offset,bytes:range.content.length,eof:range.complete,base64:range.content.toString('base64')};
  }

  async function captureStart(args){
    check();return mutate(directory,'capture.start',args,async state=>{
      const selectedConnection=connection(args.connectionAlias),read=clone(args.read);
      need(selectedConnection.adapter,'INVALID_CONNECTION','Select a readable source connection.');
      const programme=await originalVersion(directory,state.programmes,args.programmeId,args.programmeVersion);
      need(plain(read)&&typeof read.kind==='string','INVALID_ARGUMENT','Select an original native read.');
      const id=randomUUID(),bounds=selection(args.selection);
      need(bounds.fromLedger===null||bounds.throughLedger===null||bounds.fromLedger<=bounds.throughLedger,
        'INVALID_SELECTION','The final ledger must include the first ledger.');
      const capture={id,programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,name:text(args.name??read.kind,'capture name'),provider:selectedConnection.summary.provider,
        connection:selectedConnection.summary,connectionAlias:args.connectionAlias,read,
        selection:bounds,status:'READY',createdAt:now(),updatedAt:now(),
        rootObserved:selectedConnection.summary.provider==='horizon'?read.kind==='root':selectedConnection.summary.provider==='evm'?read.kind==='chain':true,rootSourceId:null,
        nextRead:read,sources:[],attempts:[],inflight:null,run:null,lastError:null};
      state.captures[id]=capture;return {captureId:id,capture:clone(capture)};
    });
  }
  async function captureNext(args){
    check();identifier(args.captureId);
    return withLock(directory,'capture-'+args.captureId+'.lock',async()=>{
      const begun=await withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.next',args);
        if(prior)return {completed:prior};
        let capture=selected(before.captures,args.captureId,'Capture');
        if(capture.inflight){
          need(capture.inflight.args.requestId===args.requestId&&capture.inflight.intentSha256===intent('capture.next',args).intentSha256,
            'CAPTURE_INFLIGHT','Continue the original capture request.',{originalArguments:capture.inflight.args});
        }else{
          revision(before,args);
          need(['READY','RUNNING'].includes(capture.status),'CAPTURE_STATE','Resume a paused or failed capture before reading its next page.',{status:capture.status});
          const next=clone(before),working=next.captures[capture.id],attemptId=randomUUID();
          working.inflight={attemptId,args:clone(args),intentSha256:intent('capture.next',args).intentSha256,
            read:clone(working.rootObserved?working.nextRead:{kind:working.provider==='evm'?'chain':'root'}),startedAt:now(),rootObservation:!working.rootObserved};
          working.status='RUNNING';working.updatedAt=now();
          await commitState(directory,before,next,'capture.next.begin',args,{captureId:capture.id,attemptId},{recordRequest:false});
          capture=next.captures[capture.id];
        }
        return {capture:clone(capture),pending:clone(capture.inflight)};
      });
      if(begun.completed)return begun.completed;
      const {capture,pending}=begun,path='captures/'+capture.id+'/attempts/'+pending.attemptId;
      let saved;
      try{saved=await files.readJSON(directory,path+'/native-result.json');}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        let orphan=null;
        try{orphan=await descriptor(directory,path+'/response.body');}catch(problem){if(problem.code!=='ENOENT')throw problem;}
        if(orphan){
          // A process stopped after preserving the original bytes and before
          // acknowledging their HTTP metadata. Keep this attempt as observed;
          // its continuation gets a new attempt and never overwrites the body.
          saved={request:opaqueRequest(pending.read),response:{status:null,headers:{},bodyFile:orphan,bodyComplete:false,
              startedAt:pending.startedAt,observedAt:pending.startedAt,elapsedMs:null},
            recordsPath:defaultRecordsPath(capture.provider,pending.read.kind),continuation:{done:false,next:pending.read},
            error:{code:'NATIVE_ATTEMPT_RECOVERED',message:'The original response bytes survived an interrupted capture before its HTTP metadata was committed. The same original read continues in a new attempt.',details:{}},
            receivedAt:pending.startedAt};
        }else{
          let result;
          try{result=await sourceAdapter(capture.connectionAlias,capture.connection).read({...pending.read,signal});}
          catch(problem){
            result={request:pending.read,response:{status:null,headers:{},body:Buffer.alloc(0),bodyComplete:false},value:null,records:[],
              continuation:{done:false,next:pending.read},error:publicError(problem,[connectionMap.get(capture.connectionAlias)?.private?.apiKey,
                connectionMap.get(capture.connectionAlias)?.private?.token,connectionMap.get(capture.connectionAlias)?.private?.bearerToken])};
          }
          need(Buffer.isBuffer(result.response?.body),'INVALID_NATIVE_SOURCE','The native adapter must return its original response bytes.');
          const bodyFile=await files.writeNew(directory,path+'/response.body',result.response.body);
          const recordsFile=Array.isArray(result.records)?await retainJSON(directory,path+'/native-records.json',result.records):null;
          saved={request:opaqueRequest(result.request),runtime:result.runtime??null,recordsFile,response:{status:result.response.status,headers:result.response.headers,bodyFile,bodyComplete:result.response.bodyComplete,
              startedAt:result.response.startedAt??null,observedAt:result.response.observedAt??null,elapsedMs:result.response.elapsedMs??null},
            recordsPath:own(result,'recordsPath')?result.recordsPath:defaultRecordsPath(capture.provider,pending.read.kind),continuation:result.continuation,error:result.error??null,receivedAt:now()};
        }
        await retainJSON(directory,path+'/native-result.json',saved);
      }
      return withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.next',args);
        if(prior)return prior;
        const next=clone(before),working=selected(next.captures,capture.id,'Capture');
        need(working.inflight?.attemptId===pending.attemptId&&working.inflight.intentSha256===pending.intentSha256,
          'CAPTURE_INFLIGHT_CHANGED','The original capture intent changed while its source was being read.');
        const paused=working.status==='PAUSED',body=await readDescriptor(directory,saved.response.bodyFile);
        let nativeError=saved.error,parsedValue=null,originalRecords=[];
        if(!nativeError){try{parsedValue=parseInvoiceJSON(body).value;originalRecords=saved.recordsFile?await readRecord(directory,saved.recordsFile):projectOriginal(parsedValue,saved.recordsPath);}
          catch(problem){nativeError=errorStatus(problem);}}
        if(!nativeError&&!pending.rootObservation&&working.sources.some(id=>next.sources[id]?.kind===pending.read.kind&&
          next.sources[id]?.bodyFile.sha256===saved.response.bodyFile.sha256&&originalRecords.length>0))
          nativeError={code:'REPEATED_NATIVE_PAGE',message:'The original provider repeated a nonempty page.',details:{bodySha256:saved.response.bodyFile.sha256}};
        if(!nativeError&&!pending.rootObservation&&!saved.continuation?.done&&working.attempts.some(item=>canonical(item.read)===canonical(saved.continuation.next)))
          nativeError={code:'CYCLIC_NATIVE_CURSOR',message:'The original provider returned a previously captured continuation.',details:{next:saved.continuation.next}};
        if(pending.rootObservation&&!nativeError&&working.provider==='horizon'){
          try{
            const latest=numberLedger(parsedValue?.history_latest_ledger,'Horizon history_latest_ledger');
            const elder=integer(Number(parsedValue?.history_elder_ledger),'Horizon history_elder_ledger',0,4294967295);
            if(working.selection.throughLedger===null)working.selection.throughLedger=latest;
            need(working.selection.throughLedger<=latest,'LEDGER_NOT_AVAILABLE','The selected final ledger is newer than the original Horizon history.',{latest});
            need(working.selection.fromLedger===null||working.selection.fromLedger>=elder,
              'HISTORY_RANGE_UNAVAILABLE','The selected first ledger precedes this Horizon service’s original retained history.',{requestedFirstLedger:working.selection.fromLedger,oldestAvailableLedger:elder});
            need(working.selection.fromLedger===null||working.selection.fromLedger<=working.selection.throughLedger,
              'INVALID_SELECTION','The selected first ledger follows the retained Horizon boundary.');
            working.rootObserved=true;working.snapshotLedger=latest;working.oldestAvailableLedger=elder;
          }catch(error){nativeError=errorStatus(error);}
        }
        if(pending.rootObservation&&!nativeError&&working.provider==='evm')working.rootObserved=true;
        const retained=await retainSource(directory,next,{id:pending.attemptId,captureId:capture.id,provider:capture.provider,
          kind:pending.read.kind,network:capture.connection.network,connection:capture.connection,label:capture.name,recordsPath:saved.recordsPath,
          request:saved.request,response:saved.response,body,sourceScope:capture.connection.sourceScope,originalBodyFile:saved.response.bodyFile,records:originalRecords,
          observedAt:saved.response.observedAt??saved.receivedAt,selection:pending.rootObservation?null:{...working.selection,order:pending.read.filters?.order??'asc'},error:nativeError,
          runtime:saved.runtime??null,runtimeConfiguration:connectionMap.get(capture.connectionAlias)?.private.runtime??null});
        if(retained.source.runtime){working.runtime=clone(retained.source.runtime);}
        nativeError=retained.error;
        const attempt={id:pending.attemptId,requestId:pending.args.requestId,startedAt:pending.startedAt,
          receivedAt:saved.receivedAt,finishedAt:now(),sourceId:retained.source.id,
          read:pending.read,responseStatus:saved.response.status,error:nativeError};
        working.attempts.push(attempt);working.sources.push(retained.source.id);
        if(nativeError?.code==='NATIVE_ATTEMPT_RECOVERED'){working.status='READY';working.lastError=nativeError;}
        else if(pending.rootObservation&&!nativeError){working.rootSourceId=retained.source.id;working.status='READY';}
        else if(nativeError){working.status='FAILED';working.lastError=nativeError;}
        else if(saved.continuation?.done||retained.crossedBoundary){working.status='COMPLETE';working.nextRead=null;working.completedAt=now();working.lastError=null;}
        else{
          need(plain(saved.continuation?.next),'INVALID_NATIVE_CONTINUATION','The original source did not return its next request.');
          working.nextRead=clone(saved.continuation.next);working.status='READY';working.lastError=null;
        }
        if(paused&&working.status!=='COMPLETE')working.status='PAUSED';
        working.inflight=null;working.updatedAt=now();
        return commitState(directory,before,next,'capture.next',args,{captureId:capture.id,status:working.status,
          sourceId:retained.source.id,source:retained.source,attempt,error:nativeError});
      });
    });
  }
  async function capturePause(args){
    check();return mutate(directory,'capture.pause',args,async state=>{
      const capture=selected(state.captures,args.captureId,'Capture');
      if(capture.status!=='COMPLETE')capture.status='PAUSED';
      capture.updatedAt=now();return {captureId:capture.id,status:capture.status,originalRun:capture.run?.args??null};
    });
  }
  async function captureResume(args){
    check();return mutate(directory,'capture.resume',args,async state=>{
      const capture=selected(state.captures,args.captureId,'Capture');
      if(capture.status!=='COMPLETE'){connection(capture.connectionAlias,capture.connection);capture.status=capture.inflight?'RUNNING':'READY';capture.lastError=null;}
      capture.updatedAt=now();return {captureId:capture.id,status:capture.status,originalRun:capture.run?.args??null};
    });
  }
  async function captureRun(args){
    check();
    const start=await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory);
      const prior=replay(before,'capture.run',args);if(prior)return {completed:prior};
      const capture=selected(before.captures,args.captureId,'Capture');
      if(capture.run){
        need(capture.run.args.requestId===args.requestId&&capture.run.intentSha256===intent('capture.run',args).intentSha256,
          'CAPTURE_RUN_ACTIVE','Continue the original complete capture run.',{originalArguments:capture.run.args});
        return {};
      }
      revision(before,args);const next=clone(before);
      next.captures[capture.id].run={args:clone(args),intentSha256:intent('capture.run',args).intentSha256,startedAt:now()};
      await commitState(directory,before,next,'capture.run.begin',args,{captureId:capture.id},{recordRequest:false});return {};
    });
    if(start.completed)return start.completed;
    for(;;){
      check();const state=await readState(directory),capture=selected(state.captures,args.captureId,'Capture');
      if(signal?.aborted&&['READY','RUNNING'].includes(capture.status)){
        try{return await capturePause({captureId:capture.id,requestId:derivedId(args.requestId+':operator-drain:'+state.revision),expectedRevision:state.revision});}
        catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
      }
      if(capture.status==='COMPLETE'){
        return withLock(directory,'writer.lock',async()=>{
          await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.run',args);if(prior)return prior;
          const next=clone(before),current=selected(next.captures,args.captureId,'Capture');
          need(current.status==='COMPLETE','CAPTURE_STATE','The original capture state changed.');
          current.run={...current.run,finishedAt:now()};
          return commitState(directory,before,next,'capture.run',args,{captureId:current.id,status:current.status,
            sources:clone(current.sources),attempts:current.attempts.length,completedAt:current.completedAt});
        });
      }
      if(['PAUSED','FAILED'].includes(capture.status))return {workspaceId:state.workspaceId,revision:state.revision,
        requestId:args.requestId,captureId:capture.id,status:capture.status,error:capture.lastError,originalArguments:capture.run.args};
      const nextArgs=capture.inflight?.args??{captureId:capture.id,requestId:derivedId(args.requestId+':'+String(capture.attempts.length)),
        expectedRevision:state.revision};
      try{await captureNext(nextArgs);}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
    }
  }

  async function receiveWebhook({programmeId,programmeVersion,connectionAlias,rawBody,bodyBase64,headers={},receivedAt=now()}){
    check();identifier(programmeId);
    const selectedConnection=connection(connectionAlias);
    need(selectedConnection.summary.provider==='customer-webhook','INVALID_CONNECTION','Select the original customer webhook connection.');
    const body=Buffer.isBuffer(rawBody)?rawBody:typeof bodyBase64==='string'?Buffer.from(bodyBase64,'base64'):null;
    need(Buffer.isBuffer(body),'INVALID_SOURCE','Supply the complete original webhook bytes.');
    if(bodyBase64!==undefined)need(body.toString('base64')===bodyBase64,'INVALID_SOURCE','Use canonical complete webhook base64.');
    const verifiedBody=await verifyCustomerWebhook({rawBody:body,headers,secret:selectedConnection.private.secret,receivedAt,
      sourceScope:selectedConnection.summary.sourceScope,network:selectedConnection.summary.network});
    need(verifiedBody.bodySha256===digest(body),'SOURCE_CHANGED','The webhook verifier returned a different original body.');
    return withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory),next=clone(before);
      const programme=await originalVersion(directory,before.programmes,programmeId,programmeVersion);
      const receiptKey=digest(jsonBytes({programmeId,connectionAlias,nativeId:verifiedBody.id}));
      const current=Object.values(next.receipts).find(row=>row.receiptKey===receiptKey);
      const attemptId=randomUUID(),root='receipts/'+(current?.id??derivedId(receiptKey));
      const retainedBody=await files.writeNew(directory,root+'/attempts/'+attemptId+'/original.body',body);
      const attempt=sealed({schema:'stellar-forge.invoice-settlement.webhook-attempt.v1',id:attemptId,
        receivedAt,programmeId,programmeVersion:programme.version,connectionAlias,connection:selectedConnection.summary,
        nativeId:verifiedBody.id,event:verifiedBody.event,bodyFile:retainedBody,headers:clone(verifiedBody.headers),
        signatureTimestamp:verifiedBody.timestamp,bodySha256:verifiedBody.bodySha256});
      const attemptFile=await retainJSON(directory,root+'/attempts/'+attemptId+'/attempt.json',attempt);
      let sourceId=current?.sourceId??null;
      const conflict=Boolean(current&&current.bodySha256!==verifiedBody.bodySha256);
      if(!current||conflict){
        const retained=await retainSource(directory,next,{provider:'elementpay',kind:'webhook',network:selectedConnection.summary.network,
          programmeId,programmeVersion:programme.version,connection:selectedConnection.summary,label:verifiedBody.event,
          sourceScope:selectedConnection.summary.sourceScope,body,originalBodyFile:retainedBody,
          records:[verifiedBody.value],webhook:{id:verifiedBody.id,event:verifiedBody.event},recordsPath:null,observedAt:receivedAt,
          request:{source:'customer-webhook',nativeId:verifiedBody.id,event:verifiedBody.event,headers:clone(verifiedBody.headers)},
          response:{status:null,headers:{'content-type':'application/json'},bodyComplete:true}});
        sourceId=retained.source.id;
      }
      const receipt=current??{id:derivedId(receiptKey),receiptKey,programmeId,programmeVersion:programme.version,
        connectionAlias,nativeId:verifiedBody.id,event:verifiedBody.event,bodySha256:verifiedBody.bodySha256,
        sourceId,createdAt:receivedAt,status:'ACCEPTED',attempts:[]};
      receipt.attempts.push({id:attemptId,receivedAt,sourceId,bodySha256:verifiedBody.bodySha256,conflict,file:attemptFile});
      if(conflict)receipt.status='ID_CONFLICT';
      receipt.updatedAt=receivedAt;next.receipts[receipt.id]=receipt;
      const args={requestId:attemptId,expectedRevision:before.revision,programmeId,programmeVersion:programme.version,
        connectionAlias,nativeId:verifiedBody.id,bodySha256:verifiedBody.bodySha256};
      return commitState(directory,before,next,'webhook.receive',args,{receiptId:receipt.id,sourceId,nativeId:verifiedBody.id,
        event:verifiedBody.event,duplicate:Boolean(current&&!conflict),accepted:!conflict,status:conflict?'ID_CONFLICT':'ACCEPTED'});
    });
  }
  async function receiptRead({receiptId}){
    check();const state=await readState(directory),row=selected(state.receipts,receiptId,'Customer webhook receipt');
    const attempts=[];for(const item of row.attempts)attempts.push(await readRecord(directory,item));
    return {receipt:row,attempts};
  }

  async function prepareDeliveries(args){
    check();return mutate(directory,'delivery.prepare',args,async state=>{
      const programme=await originalVersion(directory,state.programmes,args.programmeId,args.programmeVersion);
      const backend=connection(args.connectionAlias);
      need(backend.summary.provider==='listener-backend','INVALID_CONNECTION','Select the existing original listener backend.');
      const sourceIds=unique(args.sourceIds??Object.values(state.sources).filter(row=>row.programmeId===programme.id&&row.provider==='evm').map(row=>row.id),'source IDs');
      for(const id of sourceIds){const source=selected(state.sources,id,'Original event source');
        need(source.programmeId===programme.id||source.programmeId===null,'PROGRAMME_SOURCE_MISMATCH','Select original sources from this invoice programme.',{sourceId:id,programmeId:programme.id});}
      const all=await recordsFor(directory,state,sourceIds),selectedIds=args.recordIds?new Set(unique(args.recordIds,'record IDs')):null;
      if(selectedIds)for(const id of selectedIds)need(all.some(row=>row.id===id),'NOT_FOUND','The selected original record is absent.',{recordId:id});
      const records=all.filter(row=>(!selectedIds||selectedIds.has(row.id))&&['OrderCreated','OrderSettled','OrderRefunded'].includes(row.projection?.event));
      const prepared=[],reused=[];
      for(const record of records){
        const source=selected(state.sources,record.sourceId,'Original event source'),originalSource=await readRecord(directory,source);
        const sourceAlias=originalSource.connection?.alias??(source.captureId?state.captures[source.captureId]?.connectionAlias:null);
        const runtime=sourceAlias?connection(sourceAlias).private.runtime:undefined;
        const native=await prepareListenerDelivery({record,backend:backend.private,runtime});
        need(plain(native)&&plain(native.request)&&Buffer.isBuffer(native.request.body),'INVALID_DELIVERY','The original listener preparation must return its complete request bytes.');
        need(native.request.bytes===native.request.body.length&&native.request.bodySha256===digest(native.request.body),
          'SOURCE_CHANGED','The prepared original listener body differs.');
        const old=Object.values(state.deliveries).find(row=>row.nativeDeliveryId===native.deliveryId);
        if(old){need(old.bodySha256===native.request.bodySha256&&old.connection.sourceScope===backend.summary.sourceScope,
            'DELIVERY_ID_CONFLICT','The original listener delivery identity names different bytes or a different backend.');
          reused.push(old.id);continue;}
        const id=randomUUID(),root='deliveries/'+id,bodyFile=await files.writeNew(directory,root+'/request.body',native.request.body);
        const request={...clone({...native.request,body:undefined}),bodyFile};
        const manifest=sealed({...clone({...native,request:undefined}),request,schema:'stellar-forge.invoice-settlement.listener-intent.v1',
          id,nativeDeliveryId:native.deliveryId,programmeId:programme.id,programmeVersion:programme.version,
          connectionAlias:args.connectionAlias,connection:backend.summary,createdAt:now()});
        const file=await retainJSON(directory,root+'/delivery.json',manifest);
        state.deliveries[id]={id,nativeDeliveryId:native.deliveryId,programmeId:programme.id,programmeVersion:programme.version,
          connectionAlias:args.connectionAlias,connection:clone(backend.summary),sourceRecordId:native.sourceRecordId,
          sourceOccurrenceKey:native.sourceOccurrenceKey,event:native.event,orderId:native.orderId,
          sourceBodySha256:native.sourceBodySha256,bodySha256:native.request.bodySha256,bodyFile,file,
          status:'READY',paused:false,attempts:[],inflight:null,createdAt:manifest.createdAt,updatedAt:manifest.createdAt};
        prepared.push(id);
      }
      return {programmeId:programme.id,deliveryIds:prepared,reusedDeliveryIds:reused,selectedRecords:records.length,sourceIds};
    });
  }
  async function deliveryRead({deliveryId}){
    check();const state=await readState(directory),row=selected(state.deliveries,deliveryId,'Listener delivery');
    const attempts=[];for(const item of row.attempts)attempts.push(await readRecord(directory,item.file));
    return {delivery:row,original:await readRecord(directory,row),attempts};
  }

  async function deliveryFile({deliveryId,attemptId,part='request',offset=0,length=1024*1024}){
    check();const state=await readState(directory),row=selected(state.deliveries,deliveryId,'Listener delivery');
    let file,contentType='application/octet-stream',filename='listener-'+deliveryId+'-'+part+'.bin';
    if(part==='request'){file=row.bodyFile;contentType='application/json';filename='listener-'+deliveryId+'-request.json';}
    else if(part==='manifest'){file=row.file;contentType='application/json';filename='listener-'+deliveryId+'.json';}
    else{
      need(['response','attempt'].includes(part),'INVALID_ARGUMENT','Select the original request, response, attempt or manifest.');
      const entry=row.attempts.find(item=>item.id===attemptId);need(entry,'NOT_FOUND','Select a retained original backend attempt.');
      if(part==='attempt'){file=entry.file;contentType='application/json';filename='listener-attempt-'+attemptId+'.json';}
      else{const attempt=verified(await readRecord(directory,entry.file));file=attempt.response.bodyFile;
        contentType=attempt.response.headers?.['content-type']??'application/octet-stream';filename='listener-response-'+attemptId+'.bin';}
    }
    integer(offset,'offset');integer(length,'length',1,4*1024*1024);
    const range=await files.sourceFileRange(directory,file,offset,length);
    return {deliveryId,attemptId:attemptId??null,part,filename,contentType,file,offset,bytes:range.content.length,eof:range.complete,base64:range.content.toString('base64')};
  }
  async function deliveryNext(args){
    check();identifier(args.deliveryId);
    return withLock(directory,'delivery-'+args.deliveryId+'.lock',async()=>{
      const begun=await withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'delivery.next',args);
        if(prior)return {completed:prior};
        let row=selected(before.deliveries,args.deliveryId,'Listener delivery'),created=false;
        if(row.inflight){
          need(row.inflight.args.requestId===args.requestId&&row.inflight.intentSha256===intent('delivery.next',args).intentSha256,
            'DELIVERY_INFLIGHT','Continue the original listener delivery attempt.',{originalArguments:row.inflight.args});
        }else{
          revision(before,args);
          need(row.status==='READY'&&!row.paused,'DELIVERY_STATE','Select a ready original listener delivery.',{status:row.status,paused:row.paused});
          const next=clone(before),working=next.deliveries[row.id];
          working.inflight={attemptId:randomUUID(),args:clone(args),intentSha256:intent('delivery.next',args).intentSha256,startedAt:now()};
          working.status='SENDING';working.updatedAt=now();
          await commitState(directory,before,next,'delivery.next.begin',args,{deliveryId:row.id,attemptId:working.inflight.attemptId},{recordRequest:false});
          row=working;created=true;
        }
        return {row:clone(row),pending:clone(row.inflight),created};
      });
      if(begun.completed)return begun.completed;
      const {row,pending,created}=begun,root='deliveries/'+row.id+'/attempts/'+pending.attemptId;
      let saved;
      try{saved=await files.readJSON(directory,root+'/native-result.json');}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        let originalResponse=null;
        try{originalResponse=await descriptor(directory,root+'/response.body');}catch(problem){if(problem.code!=='ENOENT')throw problem;}
        if(!created||originalResponse){
          const bodyFile=originalResponse??await files.writeNew(directory,root+'/response.body',Buffer.alloc(0));
          saved={request:{source:'original-interrupted-attempt',deliveryId:row.nativeDeliveryId,bodySha256:row.bodySha256},
            response:{status:null,headers:{},bodyFile,bodyComplete:false,startedAt:pending.startedAt,observedAt:now(),elapsedMs:null},
            acknowledged:false,error:{code:'DELIVERY_OUTCOME_UNKNOWN',message:'The original dispatch began before the process stopped; its final backend response is not retained.'},receivedAt:now()};
        }else{
          const backend=connection(row.connectionAlias,row.connection),original=verified(await readRecord(directory,row));
          const body=await readDescriptor(directory,original.request.bodyFile);
          const delivery={...original,deliveryId:original.nativeDeliveryId,request:{...original.request,body}};
          let result;
          try{result=await sendListenerDelivery({connection:backend.private,delivery,signal});}
          catch(problem){result={request:{method:original.request.method,path:original.request.path,bodySha256:row.bodySha256},
            response:{status:null,headers:{},body:Buffer.alloc(0),bodyComplete:false},acknowledged:false,error:publicError(problem,privateSecrets(backend.private))};}
          need(Buffer.isBuffer(result.response?.body),'INVALID_DELIVERY_RESPONSE','The listener adapter must return complete original response bytes.');
          const bodyFile=await files.writeNew(directory,root+'/response.body',result.response.body);
          saved={request:opaqueRequest(result.request),response:{status:result.response.status??null,headers:result.response.headers??{},bodyFile,
            bodyComplete:result.response.bodyComplete??false,startedAt:result.response.startedAt??pending.startedAt,
            observedAt:result.response.observedAt??now(),elapsedMs:result.response.elapsedMs??null},
            acknowledged:result.acknowledged===true,error:result.error??null,receivedAt:now()};
        }
        await retainJSON(directory,root+'/native-result.json',saved);
      }
      return withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'delivery.next',args);if(prior)return prior;
        const next=clone(before),working=selected(next.deliveries,row.id,'Listener delivery');
        need(working.inflight?.attemptId===pending.attemptId,'DELIVERY_INFLIGHT_CHANGED','The original delivery attempt changed.');
        const responseStatus=saved.response.status;
        const acknowledged=saved.acknowledged===true&&Number.isInteger(responseStatus)&&responseStatus>=200&&responseStatus<300;
        const status=acknowledged?'ACKNOWLEDGED':Number.isInteger(responseStatus)&&responseStatus>=400?'FAILED':'UNCERTAIN';
        const attempt=sealed({schema:'stellar-forge.invoice-settlement.listener-attempt.v1',id:pending.attemptId,deliveryId:row.id,
          nativeDeliveryId:row.nativeDeliveryId,requestId:pending.args.requestId,startedAt:pending.startedAt,finishedAt:now(),status,
          request:saved.request,response:saved.response,error:saved.error,acknowledged});
        const file=await retainJSON(directory,root+'/attempt.json',attempt);
        working.attempts.push({id:attempt.id,requestId:attempt.requestId,status,startedAt:attempt.startedAt,finishedAt:attempt.finishedAt,
          responseStatus,error:saved.error,file});working.status=status;working.inflight=null;working.updatedAt=now();
        working.lastError=saved.error;working.lastResponseStatus=responseStatus;
        if(acknowledged)working.acknowledgedAt=attempt.finishedAt;
        return commitState(directory,before,next,'delivery.next',args,{deliveryId:row.id,status,attemptId:attempt.id,
          acknowledged,responseStatus,error:saved.error,paused:working.paused});
      });
    });
  }
  async function deliveryPause(args){
    check();return mutate(directory,'delivery.pause',args,async state=>{
      const row=selected(state.deliveries,args.deliveryId,'Listener delivery');row.paused=true;row.updatedAt=now();
      return {deliveryId:row.id,status:row.status,paused:true,originalAttempt:row.inflight?.args??null};
    });
  }
  async function deliveryResume(args){
    check();return mutate(directory,'delivery.resume',args,async state=>{
      const row=selected(state.deliveries,args.deliveryId,'Listener delivery');connection(row.connectionAlias,row.connection);
      row.paused=false;row.updatedAt=now();return {deliveryId:row.id,status:row.status,paused:false,originalAttempt:row.inflight?.args??null};
    });
  }
  async function deliveryResolve(args){
    check();return mutate(directory,'delivery.resolve',args,async state=>{
      const row=selected(state.deliveries,args.deliveryId,'Listener delivery');
      need(!row.inflight,'DELIVERY_INFLIGHT','Finish recovering the original attempt before recording its outcome.');
      need(['acknowledged','retry','cancel'].includes(args.outcome),'INVALID_ARGUMENT','Select an acknowledged original outcome, retry or cancellation.');
      text(args.reason,'outcome reason',4000);text(args.actor,'outcome actor',255);
      const sourceReferences=clone(args.sourceReferences??[]);
      need(Array.isArray(sourceReferences),'INVALID_ARGUMENT','Supply the original outcome source references.');
      for(const ref of sourceReferences){
        const source=selected(state.sources,ref.sourceId,'Original outcome source');
        if(ref.recordId!==undefined){const records=source.projectionFile?await readRecord(directory,source.projectionFile):[];
          need(records.some(record=>record.id===ref.recordId),'NOT_FOUND','The original outcome record is absent.');}
      }
      if(args.outcome==='retry')need(['FAILED','UNCERTAIN','CANCELED'].includes(row.status),'DELIVERY_STATE','Retry a retained failed, unresolved or canceled delivery.');
      if(args.outcome==='cancel')need(['READY','FAILED','UNCERTAIN'].includes(row.status),'DELIVERY_STATE','Cancel an unfinished delivery.');
      if(args.outcome==='acknowledged'){
        need(['FAILED','UNCERTAIN'].includes(row.status),'DELIVERY_STATE','Resolve the original failed or unresolved attempt.');
        need(sourceReferences.length>0,'SOURCE_REFERENCE_REQUIRED','Select the original backend outcome source and record.');
        const original=verified(await readRecord(directory,row)),stage={OrderCreated:'creation',OrderSettled:'settlement',OrderRefunded:'refund'}[row.event];
        const canonicalId=value=>typeof value==='string'&&/^(?:0x)?[a-fA-F0-9]{64}$/.test(value)?'0x'+value.replace(/^0x/i,'').toLowerCase():value;
        const expectedOrder=canonicalId(row.orderId),expectedHash=canonicalId(original.payload?.transactionHash);
        need(expectedHash,'SOURCE_REFERENCE_REQUIRED','The original delivery lacks its transaction reference.');
        let matched=false;
        for(const ref of sourceReferences){
          if(!ref.recordId)continue;
          const source=selected(state.sources,ref.sourceId,'Original outcome source');
          const records=source.projectionFile?await readRecord(directory,source.projectionFile):[];
          const record=records.find(item=>item.id===ref.recordId),projection=record?.projection;
          if(record?.provider!=='elementpay'||!projection)continue;
          const order=canonicalId(projection.orderId??projection.nativeId);
          const observed=projection.transactionHashes?.[stage];
          const hashes=Array.isArray(observed)?observed:[observed];
          if(order===expectedOrder&&hashes.some(value=>canonicalId(value)===expectedHash))matched=true;
        }
        need(matched,'DELIVERY_OUTCOME_NOT_MATCHED','Select an original ElementPay order or authenticated webhook record with this order and event transaction hash.',
          {orderId:row.orderId,event:row.event,transactionHash:original.payload?.transactionHash});
      }
      const decision=sealed({schema:'stellar-forge.invoice-settlement.delivery-decision.v1',id:randomUUID(),deliveryId:row.id,
        previousStatus:row.status,outcome:args.outcome,reason:args.reason,actor:args.actor,sourceReferences,createdAt:now()});
      const file=await retainJSON(directory,'deliveries/'+row.id+'/decisions/'+decision.id+'.json',decision);
      row.decisions??=[];row.decisions.push({id:decision.id,file,outcome:decision.outcome,createdAt:decision.createdAt});
      row.status={acknowledged:'ACKNOWLEDGED',retry:'READY',cancel:'CANCELED'}[args.outcome];
      row.paused=args.outcome==='retry'?false:row.paused;row.updatedAt=now();
      if(args.outcome==='acknowledged')row.acknowledgedAt=decision.createdAt;
      return {deliveryId:row.id,status:row.status,decisionId:decision.id};
    });
  }


  async function deliveryRun(args){
    check();identifier(args.requestId);
    return withLock(directory,'delivery-run-'+args.requestId+'.lock',async()=>{
      const started=await withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'delivery.run',args);
        if(prior)return {completed:prior};
        const existing=before.deliveryRuns[args.requestId];
        if(existing){
          need(existing.intentSha256===intent('delivery.run',args).intentSha256,'REQUEST_ID_CONFLICT','Continue the original delivery selection.');
          return {runId:existing.id};
        }
        revision(before,args);
        if(args.programmeId)selected(before.programmes,args.programmeId,'Programme');
        const ids=unique(args.deliveryIds??Object.values(before.deliveries).filter(row=>
          (!args.programmeId||row.programmeId===args.programmeId)&&(!args.connectionAlias||row.connectionAlias===args.connectionAlias)&&
          row.status==='READY'&&!row.paused).map(row=>row.id),'delivery IDs');
        for(const id of ids){const row=selected(before.deliveries,id,'Listener delivery');
          if(args.programmeId)need(row.programmeId===args.programmeId,'PROGRAMME_MISMATCH','Select deliveries from the chosen programme.');
          if(args.connectionAlias)need(row.connectionAlias===args.connectionAlias,'CONNECTION_CHANGED','Select deliveries for the chosen backend.');
        }
        const next=clone(before),id=args.requestId;
        next.deliveryRuns[id]={id,args:clone(args),intentSha256:intent('delivery.run',args).intentSha256,
          programmeId:args.programmeId??null,connectionAlias:args.connectionAlias??null,deliveryIds:ids,
          index:0,outcomes:[],status:'RUNNING',createdAt:now(),updatedAt:now()};
        await commitState(directory,before,next,'delivery.run.begin',args,{runId:id,selected:ids.length},{recordRequest:false});
        return {runId:id};
      });
      if(started.completed)return started.completed;
      for(;;){
        check();const state=await readState(directory),run=selected(state.deliveryRuns,started.runId,'Delivery run');
        if(signal?.aborted&&run.status==='RUNNING'){
          try{await deliveryRunPause({runId:run.id,requestId:derivedId(args.requestId+':drain:'+state.revision),expectedRevision:state.revision});}
          catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
          continue;
        }
        if(run.status==='PAUSED')return {workspaceId:state.workspaceId,revision:state.revision,requestId:args.requestId,
          runId:run.id,status:run.status,completed:run.index,selected:run.deliveryIds.length,outcomes:clone(run.outcomes),originalArguments:clone(run.args)};
        if(run.index>=run.deliveryIds.length){
          return withLock(directory,'writer.lock',async()=>{
            await recoverState(directory);const before=await readState(directory),prior=replay(before,'delivery.run',args);
            if(prior)return prior;const next=clone(before),current=selected(next.deliveryRuns,run.id,'Delivery run');
            need(current.index===current.deliveryIds.length,'DELIVERY_RUN_CHANGED','Continue the original unfinished delivery run.');
            current.status='COMPLETE';current.completedAt=now();current.updatedAt=current.completedAt;
            const counts={};for(const outcome of current.outcomes)counts[outcome.status]=(counts[outcome.status]??0)+1;
            return commitState(directory,before,next,'delivery.run',args,{runId:current.id,status:'COMPLETE',
              selected:current.deliveryIds.length,outcomes:clone(current.outcomes),counts,completedAt:current.completedAt});
          });
        }
        const job=selected(state.deliveries,run.deliveryIds[run.index],'Listener delivery');
        let outcome;
        if(job.inflight||job.status==='READY'&&!job.paused){
          const nextArgs=job.inflight?.args??{deliveryId:job.id,requestId:derivedId(args.requestId+':'+run.index),expectedRevision:state.revision};
          try{outcome=await deliveryNext(nextArgs);}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
        }else outcome={deliveryId:job.id,status:job.paused&&job.status==='READY'?'PAUSED':job.status,acknowledged:job.status==='ACKNOWLEDGED',paused:job.paused};
        await withLock(directory,'writer.lock',async()=>{
          await recoverState(directory);const before=await readState(directory),next=clone(before),current=selected(next.deliveryRuns,run.id,'Delivery run');
          need(current.index===run.index,'DELIVERY_RUN_CHANGED','The selected delivery run advanced unexpectedly.');
          current.outcomes.push({deliveryId:job.id,status:outcome.status,attemptId:outcome.attemptId??null,
            acknowledged:outcome.acknowledged===true,responseStatus:outcome.responseStatus??null,finishedAt:now()});
          current.index++;current.updatedAt=now();
          await commitState(directory,before,next,'delivery.run.progress',args,{runId:run.id,index:current.index},{recordRequest:false});
        });
      }
    });
  }
  async function deliveryRunPause(args){
    check();return mutate(directory,'delivery.run.pause',args,async state=>{
      const run=selected(state.deliveryRuns,args.runId,'Delivery run');
      if(run.status!=='COMPLETE'){run.status='PAUSED';run.pausedAt=now();run.updatedAt=run.pausedAt;}
      return {runId:run.id,status:run.status,originalArguments:clone(run.args)};
    });
  }
  async function deliveryRunResume(args){
    check();return mutate(directory,'delivery.run.resume',args,async state=>{
      const run=selected(state.deliveryRuns,args.runId,'Delivery run');
      for(const id of run.deliveryIds.slice(run.index)){const job=selected(state.deliveries,id,'Listener delivery');connection(job.connectionAlias,job.connection);}
      if(run.status!=='COMPLETE'){run.status='RUNNING';run.updatedAt=now();}
      return {runId:run.id,status:run.status,originalArguments:clone(run.args)};
    });
  }


  async function decisionSave(args){
    check();return mutate(directory,'decision.save',args,async state=>{
      const programme=await originalVersion(directory,state.programmes,args.programmeId,args.programmeVersion);
      need(['link','unlink','exclude','include'].includes(args.action),'INVALID_ARGUMENT','Select a link, unlink, exclude or include decision.');
      text(args.recordId,'original record ID',1024);text(args.reason,'decision reason',4000);text(args.actor,'decision actor',255);
      const sourceIds=Object.values(state.sources).filter(source=>source.programmeId===programme.id||source.programmeId===null).map(source=>source.id);
      const records=await recordsFor(directory,state,sourceIds),record=records.find(row=>row.id===args.recordId);
      need(record,'NOT_FOUND','The selected original source record is absent.',{recordId:args.recordId});
      if(args.invoiceId!==undefined){text(args.invoiceId,'invoice ID',1024);
        need(programme.definition.invoices.some(row=>row.id===args.invoiceId),'NOT_FOUND','The invoice is absent from the selected programme version.');}
      if(args.orderId!==undefined)text(args.orderId,'original order ID',1024);
      if(args.action==='link')need(args.invoiceId!==undefined||args.orderId!==undefined,'INVALID_ARGUMENT','Select the invoice or order for this original record.');
      if(args.role!==undefined)need(['collection','settlement','refund','fee'].includes(args.role),'INVALID_ARGUMENT','Select the original amount role.');
      if(args.supersedes!==undefined){
        const previous=selected(state.decisions,args.supersedes,'Previous decision');
        need(previous.programmeId===programme.id&&previous.recordId===record.id,'DECISION_MISMATCH','A correction must supersede a decision for this programme and original record.');
      }
      const id=randomUUID(),decision=sealed({schema:'stellar-forge.invoice-settlement.decision.v1',id,
        programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,
        action:args.action,recordId:record.id,sourceId:record.sourceId,invoiceId:args.invoiceId,orderId:args.orderId,role:args.role,
        reason:args.reason,actor:args.actor,supersedes:args.supersedes,createdAt:now()});
      const file=await retainJSON(directory,'decisions/'+id+'.json',decision);
      state.decisions[id]={id,programmeId:programme.id,programmeVersion:programme.version,recordId:record.id,sourceId:record.sourceId,
        action:decision.action,invoiceId:decision.invoiceId,orderId:decision.orderId,role:decision.role,supersedes:decision.supersedes,
        reason:decision.reason,actor:decision.actor,createdAt:decision.createdAt,file,sha256:decision.sha256};
      return {decisionId:id,decision:clone(state.decisions[id])};
    });
  }
  async function decisionRead({decisionId}){
    check();const state=await readState(directory);return verified(await readRecord(directory,selected(state.decisions,decisionId,'Decision')));
  }
  async function reconcileCreate(args){
    check();return mutate(directory,'reconcile.create',args,async state=>{
      const programme=await originalVersion(directory,state.programmes,args.programmeId,args.programmeVersion);
      const sourceIds=unique(args.sourceIds??Object.values(state.sources).filter(row=>row.programmeId===programme.id).map(row=>row.id),'source IDs');
      for(const id of sourceIds){const source=selected(state.sources,id,'Original source');
        need(source.programmeId===null||source.programmeId===programme.id,'PROGRAMME_MISMATCH','Select sources belonging to this invoice programme.');}
      const records=await recordsFor(directory,state,sourceIds),selectedRecords=new Set(records.map(row=>row.id));
      const decisionIds=unique(args.decisionIds??Object.values(state.decisions).filter(row=>row.programmeId===programme.id&&selectedRecords.has(row.recordId)).map(row=>row.id),'decision IDs');
      const decisions=[];for(const id of decisionIds){const row=selected(state.decisions,id,'Decision');
        need(row.programmeId===programme.id,'PROGRAMME_MISMATCH','Select decisions from the original programme.');
        decisions.push(verified(await readRecord(directory,row)));}
      const asOf=args.asOf??now();
      need(typeof asOf==='string'&&Number.isFinite(Date.parse(asOf)),'INVALID_ARGUMENT','Supply an ISO date and time for the reconciliation.');
      const data=await reconcileInvoices({programme,records,decisions,asOf});
      need(plain(data)&&Array.isArray(data.invoices)&&Array.isArray(data.orders),'INVALID_RECONCILIATION','The original invoice reconciliation must return its complete data.');
      const id=randomUUID(),edition=sealed({schema:EDITION_SCHEMA,id,kind:'reconciliation',
        name:text(args.name??programme.name+' reconciliation','reconciliation name'),programme:{id:programme.id,version:programme.version,sha256:programme.sha256},
        sourceIds,decisionIds,sourceWarnings:sourceIds.filter(sourceId=>state.sources[sourceId].error).map(sourceId=>({sourceId,error:state.sources[sourceId].error})),
        asOf,createdAt:now(),data});
      const file=await retainJSON(directory,'reconciliations/'+id+'.json',edition);
      state.reconciliations[id]={id,name:edition.name,programmeId:programme.id,programmeVersion:programme.version,
        programmeSha256:programme.sha256,sourceIds,decisionIds,asOf,createdAt:edition.createdAt,summary:clone(data.summary),
        sourceWarnings:edition.sourceWarnings,file,sha256:edition.sha256};
      return {reconciliationId:id,reconciliation:clone(state.reconciliations[id])};
    });
  }
  async function editionRead({reconciliationId}){
    check();const state=await readState(directory);return verified(await readRecord(directory,selected(state.reconciliations,reconciliationId,'Reconciliation')));
  }
  async function compare({leftId,rightId}){
    check();const [left,right]=await Promise.all([editionRead({reconciliationId:leftId}),editionRead({reconciliationId:rightId})]);
    return {leftId,rightId,...await compareInvoiceReconciliations({left:left.data,right:right.data})};
  }
  async function reportCreate(args){
    check();return mutate(directory,'report.create',args,async state=>{
      const selectedEdition=selected(state.reconciliations,args.reconciliationId,'Reconciliation');
      const edition=verified(await readRecord(directory,selectedEdition));
      const programme=await originalVersion(directory,state.programmes,edition.programme.id,edition.programme.version);
      need(programme.sha256===edition.programme.sha256,'SOURCE_CHANGED','The original reconciliation programme differs.');
      const formats=unique(args.formats??['html','json','csv'],'report formats');
      need(formats.length>0&&formats.every(format=>['html','json','csv'].includes(format)),'INVALID_ARGUMENT','Select HTML, JSON or CSV reports.');
      if(args.partnerId!==undefined&&args.partnerId!==null)text(args.partnerId,'partner ID',1024);
      const id=randomUUID(),members=[];let scope=null;
      for(const format of formats){
        const artifact=await buildInvoiceReport({programme,reconciliation:edition.data,format,partnerId:args.partnerId??undefined});
        need(Buffer.isBuffer(artifact.body)&&artifact.bytes===artifact.body.length&&artifact.sha256===digest(artifact.body),
          'INVALID_REPORT','The report renderer must return its complete original artifact bytes.');
        const filename=safeFilename(artifact.filename),file=await files.writeNew(directory,'reports/'+id+'/files/'+filename,artifact.body);
        if(scope)need(canonical(scope)===canonical(artifact.scope),'REPORT_SCOPE_CHANGED','The report formats must describe the same selected original records.');
        scope=clone(artifact.scope);
        members.push({format,filename,contentType:artifact.contentType,file,bytes:artifact.bytes,sha256:artifact.sha256});
      }
      const report=sealed({schema:'stellar-forge.invoice-settlement.report.v1',id,name:text(args.name??edition.name+' report','report name'),
        programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,
        reconciliationId:edition.id,reconciliationSha256:edition.sha256,partnerId:args.partnerId??null,
        scope,formats,files:members,createdAt:now()});
      const file=await retainJSON(directory,'reports/'+id+'/report.json',report);
      state.reports[id]={id,name:report.name,programmeId:programme.id,programmeVersion:programme.version,reconciliationId:edition.id,
        partnerId:report.partnerId,scope,formats,files:members,createdAt:report.createdAt,file,sha256:report.sha256};
      return {reportId:id,report:clone(state.reports[id])};
    });
  }
  async function reportRead({reportId}){
    check();const state=await readState(directory);return verified(await readRecord(directory,selected(state.reports,reportId,'Report')));
  }
  async function reportFile({reportId,format='html',offset=0,length=1024*1024}){
    check();const report=await reportRead({reportId}),member=report.files.find(row=>row.format===format);
    need(member,'REPORT_FORMAT_NOT_FOUND','Select a retained original report format.',{formats:report.formats});
    integer(offset,'offset');integer(length,'length',1,4*1024*1024);
    const range=await files.sourceFileRange(directory,member.file,offset,length);
    return {reportId,format,filename:member.filename,contentType:member.contentType,file:member.file,offset,
      bytes:range.content.length,eof:range.complete,base64:range.content.toString('base64')};
  }


  async function runtimeSelections(){
    check();const state=await readState(directory),used=new Map();
    for(const row of [...Object.values(state.sources),...Object.values(state.captures)]){
      if(!row.runtime)continue;
      const known=used.get(row.runtime.id);
      need(!known||known.manifestSha256===row.runtime.manifestSha256,'RUNTIME_CHANGED','One retained runtime identity names different manifests.');
      used.set(row.runtime.id,row.runtime);
    }
    const selections=[];
    for(const runtime of used.values()){
      const aliases=new Set(Object.values(state.captures).filter(row=>row.runtime?.id===runtime.id).map(row=>row.connectionAlias));
      for(const row of Object.values(state.sources).filter(row=>row.runtime?.id===runtime.id)){
        const full=await readRecord(directory,row);if(full.connection?.alias)aliases.add(full.connection.alias);
      }
      let chosen=null;
      for(const alias of aliases){
        const configured=connectionMap.get(alias)?.private.runtime;
        if(!configured)continue;
        need(configured.retained===undefined||Array.isArray(configured.retained),'INVALID_RUNTIME_CONFIGURATION','Supply retained runtime generations as an array.');
        const retained=configured.retained?.find(item=>item.id===runtime.id&&
          (item.expectedManifestSha256??item.manifestSha256)===runtime.manifestSha256);
        if(retained){
          const selectedDirectory=retained.runtimeDirectory??retained.directory;
          need(typeof selectedDirectory==='string'&&selectedDirectory.length,'INVALID_RUNTIME_CONFIGURATION','Select the original retained runtime directory.');
          chosen={directory:selectedDirectory,expectedManifestSha256:runtime.manifestSha256};break;
        }
        if(configured.runtimeDirectory&&(!configured.expectedManifestSha256||configured.expectedManifestSha256===runtime.manifestSha256)){
          chosen={directory:configured.runtimeDirectory,expectedManifestSha256:runtime.manifestSha256};
        }
      }
      need(chosen,'RUNTIME_SOURCE_REQUIRED','Bind the complete original runtime for this retained EVM source.',{runtime,connectionAliases:[...aliases]});
      selections.push(chosen);
    }
    return selections;
  }
  async function close(){
    if(closed)return;closed=true;
    const results=await Promise.allSettled([...connectionMap.values()].filter(value=>value.adapter?.close).map(value=>value.adapter.close()));
    const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  }
  return {describe,sourceCatalog,profileSave,programmeSave,programmeRead,
    sourceImport,sourceProject,sourceRead,sourceFile,captureStart,captureNext,capturePause,captureResume,captureRun,
    receiveWebhook,receiptRead,prepareDeliveries,deliveryRead,deliveryFile,deliveryNext,deliveryPause,deliveryResume,deliveryResolve,
    deliveryRun,deliveryRunPause,deliveryRunResume,decisionSave,decisionRead,reconcileCreate,editionRead,compare,
    reportCreate,reportRead,reportFile,runtimeSelections,close};
}
