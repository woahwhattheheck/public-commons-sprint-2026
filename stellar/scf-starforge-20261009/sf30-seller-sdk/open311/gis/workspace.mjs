// MIT. Durable GIS source, handoff, analyst-return, decision and dispatch workspace.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, copy, digest, equal, fail, object, text, instant, parseJson, now, entityId, seal, verifySeal, page, rowSearch, originalBytes, MAX_PACKAGE_BYTES } from './shared.mjs';
import { GIS_SOURCE_SCHEMA, inspectSource, importSource as makeSource, sourceSummary, sourceVersions } from './source.mjs';
import { HANDOFF_SCHEMA, RETURN_SCHEMA, DECISION_SCHEMA, DISPATCH_SCHEMA, normalizeDefinition, createHandoff, analystReturn, applyDecision, createDispatch, handoffSummary, returnSummary, decisionSummary, dispatchSummary, DISPATCH_FIELDS, DEFAULT_DISPATCH_COLUMNS } from './domain.mjs';
import { decodeAnalystFile, exportAsset } from './formats.mjs';

export const WORKSPACE_SCHEMA='commons.open311.gis-workspace.v1';
const DATABASE_SCHEMA='commons.open311.gis-database.v1';
const KINDS=['source','handoff','return','decision','dispatch'];
const compactRecord=(kind,value)=>({source:sourceSummary,handoff:handoffSummary,return:returnSummary,decision:decisionSummary,dispatch:dispatchSummary})[kind](value);
const pickControl=input=>({requestId:input.requestId,expectedRevision:input.expectedRevision});
function control(input) {
  object(input,'Workspace action');text(input.requestId,'Stable request ID',200);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('EXPECTED_REVISION_REQUIRED','Supply the revision observed before this action.');
  return copy(input);
}
function decodedReturn(bytes,format,directory) {
  try{return decodeAnalystFile(bytes,format,{directory});}
  catch(error){if(error.status!==400)throw error;return {rows:[],metadata:null,problems:[{code:error.code??'INVALID_ANALYST_FILE',message:error.message}]};}
}
function savedOriginal(bytes){return {encoding:'base64',body:bytes.toString('base64'),bytes:bytes.length,sha256:digest(bytes)};}
function assertSame(actual,expected,code,message){if(!equal(actual,expected))fail(code,message);}
export function validateWorkspacePackage(originalText,{directory}={}) {
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive a complete GIS package of at most 256 MiB.',413);
  const bundle=verifySeal(parseJson(originalText,'GIS workspace package'),WORKSPACE_SCHEMA);
  text(bundle.workspaceId,'Original workspace identity',120);
  if(!Number.isSafeInteger(bundle.revision)||bundle.revision<0)fail('INVALID_PACKAGE_REVISION','The original workspace revision is invalid.');
  for(const key of ['createdAt','updatedAt','exportedAt'])instant(bundle[key],key);
  if(!Array.isArray(bundle.records)||!Array.isArray(bundle.operations)||!Array.isArray(bundle.receivedFrom)||bundle.operations.length!==bundle.revision)fail('INCOMPLETE_GIS_PACKAGE','The complete records, original operation history and receiving history are required.');
  const maps=Object.fromEntries(KINDS.map(kind=>[kind,new Map()]));
  for(const record of bundle.records){
    object(record,'Saved record');if(!KINDS.includes(record.kind))fail('UNSUPPORTED_PACKAGE_RECORD','A saved record kind is unsupported.');
    text(record.id,'Saved record identity',120);object(record.value,'Saved record');
    if(maps[record.kind].has(record.id)||record.value.id!==record.id)fail('DUPLICATE_PACKAGE_RECORD','The package repeats or changes a saved record identity.');
    maps[record.kind].set(record.id,record.value);
  }
  for(const source of maps.source.values()){
    const checked=makeSource(source.originalText,{reportId:source.reportId,name:source.name,importedAt:source.importedAt});
    assertSame(checked,source,'SOURCE_RECORD_MISMATCH','A GIS source differs from its complete original collection or report package.');
  }
  const checkedHandoffs=new Map(),checkedReturns=new Map(),checkedDecisions=[];
  const required=(map,id,kind)=>{const value=map.get(id);if(!value)fail('INCOMPLETE_GIS_PACKAGE','A '+kind+' predecessor or source record is missing.');return value;};
  function checkReturn(id) {
    if(checkedReturns.has(id))return checkedReturns.get(id);
    const value=required(maps.return,id,'return'),base=required(checkedHandoffs,value.handoffId,'handoff');
    verifySeal(value,RETURN_SCHEMA);
    const bytes=Buffer.from(value.original.body,'base64');
    const checked=analystReturn(base,decodedReturn(bytes,value.format,directory),{analyst:value.analyst,name:value.name,format:value.format,original:value.original},{id:value.id,createdAt:value.receivedAt});
    assertSame(checked,value,'RETURN_RECORD_MISMATCH','An analyst return differs from its complete original file or saved source comparison.');
    checkedReturns.set(id,checked);return checked;
  }
  const ordered=[...maps.handoff.values()].sort((a,b)=>String(a.seriesId).localeCompare(String(b.seriesId))||a.edition-b.edition||String(a.id).localeCompare(String(b.id)));
  const heads=new Map();
  for(const saved of ordered){
    verifySeal(saved,HANDOFF_SCHEMA);
    const previous=saved.predecessorId?required(checkedHandoffs,saved.predecessorId,'handoff'):null;
    const priorHead=heads.get(saved.seriesId);
    if(saved.edition!==(priorHead?.edition??0)+1||(saved.predecessorId??null)!==(priorHead?.id??null))fail('HANDOFF_LINEAGE_MISMATCH','A handoff series has a gap or a competing edition.');
    let checked;
    if(saved.creation?.kind==='decision'){
      const decision=required(maps.decision,saved.creation.decisionId,'decision');
      verifySeal(decision,DECISION_SCHEMA);
      const returned=checkReturn(decision.returnId),base=required(checkedHandoffs,decision.baseHandoffId,'handoff');
      if(!previous||decision.handoffId!==previous.id||decision.newHandoffId!==saved.id)fail('DECISION_LINEAGE_MISMATCH','A review decision does not link its original and new handoff editions.');
      const result=applyDecision(base,previous,returned,{returnId:decision.returnId,handoffId:decision.handoffId,reviewer:decision.reviewer,note:decision.note,accept:decision.accept,reject:decision.reject},{id:decision.id,createdAt:decision.createdAt},{previousDecisions:checkedDecisions});
      assertSame(result.decision,decision,'DECISION_RECORD_MISMATCH','A decision differs from its saved selected proposals.');
      checkedDecisions.push(result.decision);checked=result.handoff;
    }else{
      if(saved.creation!==undefined)fail('UNSUPPORTED_HANDOFF_CREATION','This handoff creation kind is unsupported.');
      checked=createHandoff(saved.definition,[...maps.source.values()],{id:saved.id,createdAt:saved.createdAt},{predecessor:previous});
    }
    assertSame(checked,saved,'HANDOFF_RECORD_MISMATCH','A handoff edition differs from its original sources or accepted analyst decisions.');
    checkedHandoffs.set(saved.id,checked);heads.set(saved.seriesId,checked);
  }
  for(const id of maps.return.keys())checkReturn(id);
  if(checkedDecisions.length!==maps.decision.size)fail('INCOMPLETE_DECISION_HISTORY','Every retained decision must produce its complete new handoff edition.');
  for(const value of maps.dispatch.values()){
    verifySeal(value,DISPATCH_SCHEMA);
    const handoff=required(checkedHandoffs,value.handoffId,'handoff');
    const checked=createDispatch(handoff,value.definition,{id:value.id,createdAt:value.createdAt});
    assertSame(checked,value,'DISPATCH_RECORD_MISMATCH','A dispatch differs from its reviewed original handoff and selected column mapping.');
  }
  const operationIds=new Set();
  for(const operation of bundle.operations){
    object(operation,'Original operation');const input=control(operation.input),{expectedRevision,...intent}=input;
    if(operationIds.has(operation.requestId)||operation.requestId!==input.requestId||operation.state!=='SUCCEEDED'||operation.inputSha256!==digest({kind:operation.kind,intent})||operation.result?.requestId!==input.requestId)fail('OPERATION_HISTORY_MISMATCH','An original operation differs from its retained input or result.');
    if(operation.kind==='workspace-receive'&&operation.input.originalFile){
      const file=operation.input.originalFile;
      if(!/^[a-f0-9]{64}$/.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_PACKAGE_BYTES||! /^[a-f0-9]{64}$/.test(operation.input.incomingPackageSha256??'')||operation.input.incomingPackageSha256!==operation.result.packageSha256)fail('RECEIVE_HISTORY_MISMATCH','The original receiving operation has inconsistent file or package identity.');
    }
    operationIds.add(operation.requestId);instant(operation.createdAt,'Operation time');
  }
  return bundle;
}
export function openWorkspace(suppliedDirectory,{create=true}={}) {
  let directory=resolve(text(suppliedDirectory,'Workspace directory',4096));
  if(!existsSync(directory)){if(!create)fail('WORKSPACE_NOT_FOUND','Initialize or receive a GIS workspace first.',404);mkdirSync(directory,{recursive:true,mode:0o700});}
  if(!lstatSync(directory).isDirectory())fail('INVALID_WORKSPACE_DIRECTORY','Choose a real directory for the private workspace.');
  directory=realpathSync(directory);
  const filename=join(directory,'open311-gis.sqlite');
  if(existsSync(filename)){const stat=lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())fail('INVALID_WORKSPACE_FILE','The GIS database must be a regular file in its selected directory.');}
  else if(!create)fail('WORKSPACE_NOT_FOUND','Initialize or receive a GIS workspace first.',404);
  const db=new DatabaseSync(filename);
  chmodSync(filename,0o600);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  let closed=false;
  function transaction(action,write=false){
    if(closed)fail('WORKSPACE_CLOSED','The GIS workspace is closed.',409);
    db.exec(write?'BEGIN IMMEDIATE':'BEGIN');
    try{const result=action();db.exec('COMMIT');return result;}
    catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  try{
    transaction(()=>{
      const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gis_meta'").get();
      if(!table){
        if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)fail('WRONG_WORKSPACE_DATABASE','This database belongs to a different application.');
        db.exec('CREATE TABLE gis_meta(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,summary TEXT NOT NULL,series_id TEXT,edition INTEGER,PRIMARY KEY(kind,id)); CREATE INDEX handoff_series_edition ON records(kind,series_id,edition); CREATE TABLE operations(request_id TEXT PRIMARY KEY,kind TEXT NOT NULL,input_sha TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);');
        const stamp=now();
        db.prepare('INSERT INTO gis_meta VALUES(1,?)').run(canonical({schema:DATABASE_SCHEMA,workspaceId:randomUUID(),revision:0,createdAt:stamp,updatedAt:stamp,receivedFrom:[]}));
      }
      const existingMeta=JSON.parse(db.prepare('SELECT value FROM gis_meta WHERE id=1').get().value);
      if(existingMeta.schema!==DATABASE_SCHEMA)fail('UNSUPPORTED_WORKSPACE','This GIS database edition is unsupported.');
      const columns=db.prepare('PRAGMA table_info(records)').all().map(column=>column.name);
      if(!columns.includes('summary')){
        db.exec('ALTER TABLE records ADD COLUMN summary TEXT; ALTER TABLE records ADD COLUMN series_id TEXT; ALTER TABLE records ADD COLUMN edition INTEGER; CREATE INDEX IF NOT EXISTS handoff_series_edition ON records(kind,series_id,edition);');
        const update=db.prepare('UPDATE records SET summary=?,series_id=?,edition=? WHERE kind=? AND id=?');
        for(const row of db.prepare('SELECT kind,id,value FROM records').iterate()){
          const value=JSON.parse(row.value);update.run(canonical(compactRecord(row.kind,value)),row.kind==='handoff'?value.seriesId:null,row.kind==='handoff'?value.edition:null,row.kind,row.id);
        }
      }
    },true);
  }catch(error){db.close();throw error;}
  const metadata=()=>JSON.parse(db.prepare('SELECT value FROM gis_meta WHERE id=1').get().value);
  if(metadata().schema!==DATABASE_SCHEMA){db.close();fail('UNSUPPORTED_WORKSPACE','This GIS database edition is unsupported.');}
  const all=kind=>db.prepare('SELECT value FROM records WHERE kind=? ORDER BY id').all(kind).map(row=>JSON.parse(row.value));
  const summaries=kind=>db.prepare('SELECT summary FROM records WHERE kind=? ORDER BY id').all(kind).map(row=>JSON.parse(row.summary));
  const find=(kind,id)=>{const row=db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.value):null;};
  const get=(kind,id)=>{text(id,kind+' identity',120);const value=find(kind,id);if(!value)fail('RECORD_NOT_FOUND','The selected '+kind+' was not found.',404);return value;};
  const save=(kind,value)=>db.prepare('INSERT INTO records(kind,id,value,summary,series_id,edition) VALUES(?,?,?,?,?,?)').run(kind,value.id,canonical(value),canonical(compactRecord(kind,value)),kind==='handoff'?value.seriesId:null,kind==='handoff'?value.edition:null);
  const saveMeta=value=>db.prepare('UPDATE gis_meta SET value=? WHERE id=1').run(canonical(value));
  const heads=()=>new Map(db.prepare("SELECT r.summary FROM records r WHERE r.kind='handoff' AND NOT EXISTS (SELECT 1 FROM records newer WHERE newer.kind='handoff' AND newer.series_id=r.series_id AND newer.edition>r.edition)").all().map(row=>{const value=JSON.parse(row.summary);return [value.seriesId,value];}));
  function stateInside(){
    const meta=metadata(),current=heads();
    return {schema:WORKSPACE_SCHEMA,directory,workspaceId:meta.workspaceId,revision:meta.revision,createdAt:meta.createdAt,updatedAt:meta.updatedAt,receivedFrom:copy(meta.receivedFrom),
      sources:summaries('source'),handoffs:summaries('handoff').map(value=>({...value,head:current.get(value.seriesId)?.id===value.id})),
      returns:summaries('return'),decisions:summaries('decision'),dispatches:summaries('dispatch'),
      dispatchFields:[...DISPATCH_FIELDS],defaultDispatchColumns:copy(DEFAULT_DISPATCH_COLUMNS),
      operations:db.prepare('SELECT request_id,kind,created_at FROM operations ORDER BY created_at DESC,request_id DESC LIMIT 30').all().map(row=>({requestId:row.request_id,kind:row.kind,state:'SUCCEEDED',createdAt:row.created_at}))};
  }
  function state(){return transaction(stateInside);}
  function operation(requestId){
    text(requestId,'Request ID',200);const row=db.prepare('SELECT * FROM operations WHERE request_id=?').get(requestId);
    return row?{requestId,kind:row.kind,state:'SUCCEEDED',inputSha256:row.input_sha,input:JSON.parse(row.input),result:JSON.parse(row.result),createdAt:row.created_at}:null;
  }
  function mutate(kind,supplied,action){
    const input=control(supplied),{expectedRevision,...intent}=input,inputSha256=digest({kind,intent});
    return transaction(()=>{
      const prior=operation(input.requestId);
      if(prior){if(prior.kind!==kind||prior.inputSha256!==inputSha256)fail('REQUEST_ID_CONFLICT','This request ID already names a different saved action.',409);return prior.result;}
      const meta=metadata();
      if(input.expectedRevision!==meta.revision)fail('REVISION_CONFLICT','The workspace changed. Refresh its current revision before choosing this action.',409,{expectedRevision:input.expectedRevision,actualRevision:meta.revision});
      const createdAt=now(),identity={id:entityId(kind,{workspaceId:meta.workspaceId,requestId:input.requestId}),createdAt};
      const result={workspaceId:meta.workspaceId,revision:meta.revision+1,requestId:input.requestId,...action(input,identity)};
      meta.revision++;meta.updatedAt=createdAt;saveMeta(meta);
      db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(input.requestId,kind,inputSha256,canonical(input),canonical(result),createdAt);
      return result;
    },true);
  }
  function importSource(input){return mutate('source-import',input,(value,identity)=>{
    const source=makeSource(value.originalText,{reportId:value.reportId,name:value.name,importedAt:identity.createdAt}),existing=find('source',source.id);
    if(existing)return {source:sourceSummary(existing),reused:true};
    save('source',source);return {source:sourceSummary(source),reused:false};
  });}
  function putHandoff(input){return mutate('handoff-create',input,(value,identity)=>{
    const definition=normalizeDefinition(value.definition),previous=definition.predecessorId?get('handoff',definition.predecessorId):null;
    if(previous&&heads().get(previous.seriesId)?.id!==previous.id)fail('HANDOFF_HEAD_CHANGED','Choose the current handoff edition before refreshing its source selection.',409,{currentHandoffId:heads().get(previous.seriesId)?.id??null});
    const handoff=createHandoff(definition,definition.sourceIds.map(id=>get('source',id)),identity,{predecessor:previous});save('handoff',handoff);
    return {handoff:handoffSummary(handoff,true)};
  });}
  function importReturn(input){return mutate('return-import',input,(value,identity)=>{
    const handoff=get('handoff',value.handoffId),bytes=originalBytes(value);
    const returned=analystReturn(handoff,decodedReturn(bytes,value.format,directory),{analyst:value.analyst,...(value.name!==undefined?{name:value.name}:{}),format:value.format,original:savedOriginal(bytes)},identity);
    save('return',returned);return {returned:returnSummary(returned)};
  });}
  function putDecision(input){return mutate('decision-save',input,(value,identity)=>{
    const selection=object(value.selection,'Review selection'),returned=get('return',selection.returnId),base=get('handoff',returned.handoffId),current=get('handoff',selection.handoffId),head=heads().get(base.seriesId);
    if(head?.id!==current.id)fail('HANDOFF_HEAD_CHANGED','Choose the current handoff edition for this analyst decision.',409,{currentHandoffId:head?.id??null});
    const result=applyDecision(base,current,returned,selection,identity,{previousDecisions:all('decision')});
    save('decision',result.decision);save('handoff',result.handoff);
    return {decision:decisionSummary(result.decision),handoff:handoffSummary(result.handoff,true)};
  });}
  function putDispatch(input){return mutate('dispatch-create',input,(value,identity)=>{
    const definition=object(value.definition,'Dispatch definition'),handoff=get('handoff',definition.handoffId);
    const dispatch=createDispatch(handoff,definition,identity);save('dispatch',dispatch);return {dispatch:dispatchSummary(dispatch)};
  });}
  function source(id){return transaction(()=>{const value=get('source',id);return {summary:sourceSummary(value),originalText:value.originalText,rows:value.rows};});}
  function sourceRows({id,q='',offset,limit}={}){return transaction(()=>page(rowSearch(get('source',id).rows,q),{offset,limit}));}
  function handoff({id,q='',offset,limit}={}){
    return transaction(()=>{const value=get('handoff',id),head=heads().get(value.seriesId);return {handoff:handoffSummary(value,head?.id===id),definition:value.definition,coverage:value.coverage,...page(rowSearch(value.rows,q),{offset,limit})};});
  }
  function row({handoffId,key}={}){
    return transaction(()=>{const value=get('handoff',handoffId),selected=value.rows.find(item=>item.key===key);if(!selected)fail('ROW_NOT_FOUND','The selected source request is absent from this handoff.',404);
      return {handoff:handoffSummary(value,heads().get(value.seriesId)?.id===value.id),row:selected,versions:value.sourceIds.flatMap(id=>sourceVersions(get('source',id),key))};});
  }
  function returned(id){return transaction(()=>{const value=get('return',id);return {summary:returnSummary(value),changes:value.changes,conflicts:value.conflicts,missingKeys:value.missingKeys,decisions:all('decision').filter(item=>item.returnId===id).map(decisionSummary)};});}
  function dispatch(id){return transaction(()=>{const value=get('dispatch',id);return {summary:dispatchSummary(value),definition:value.definition,rows:value.rows,coverage:value.coverage,decisionIds:value.decisionIds};});}
  function requireRevision(expectedRevision){if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision!==metadata().revision))fail('REVISION_CONFLICT','The selected export revision changed. Refresh before exporting.',409,{actualRevision:metadata().revision});}
  function packageInside(){
    const meta=metadata(),records=db.prepare('SELECT kind,id,value FROM records ORDER BY kind,id').all().map(row=>({kind:row.kind,id:row.id,value:JSON.parse(row.value)}));
    const operations=db.prepare('SELECT request_id FROM operations ORDER BY created_at,request_id').all().map(row=>operation(row.request_id));
    return seal({schema:WORKSPACE_SCHEMA,workspaceId:meta.workspaceId,revision:meta.revision,createdAt:meta.createdAt,updatedAt:meta.updatedAt,
      exportedAt:meta.updatedAt,records,operations,receivedFrom:copy(meta.receivedFrom)});
  }
  function workspaceExport({expectedRevision}={}){return transaction(()=>{requireRevision(expectedRevision);return packageInside();});}
  function exportFile({kind='workspace',handoffId,dispatchId,sourceId,returnId,expectedRevision}={}){
    return transaction(()=>{
      requireRevision(expectedRevision);
      const selectors=[handoffId,dispatchId,sourceId,returnId].filter(value=>value!==undefined&&value!==null&&value!=='');
      let file;
      if(kind==='workspace'){
        if(selectors.length)fail('EXPORT_SELECTION_CONFLICT','A complete workspace export does not use an item selection.');
        const bundle=packageInside();file={filename:'open311-gis-'+bundle.workspaceId+'.json',contentType:'application/json; charset=utf-8',body:canonical(bundle)+'\n'};
      }else if(kind==='source'){
        if(selectors.length!==1||!sourceId)fail('SOURCE_SELECTION_REQUIRED','Choose one complete original source file.');
        const source=get('source',sourceId);file={filename:source.id+'.json',contentType:'application/json; charset=utf-8',body:source.originalText};
      }else if(kind==='returned'){
        if(selectors.length!==1||!returnId)fail('RETURN_SELECTION_REQUIRED','Choose one original analyst return file.');
        const value=get('return',returnId),mime={gpkg:'application/geopackage+sqlite3',geojson:'application/geo+json',csv:'text/csv',json:'application/json'};
        file={filename:value.id+'.'+value.format,contentType:mime[value.format],body:Buffer.from(value.original.body,'base64')};
      }else{
        if(selectors.length!==1||(!handoffId&&!dispatchId))fail('HANDOFF_SELECTION_REQUIRED','Choose one retained handoff or dispatch edition.');
        const asset=get(handoffId?'handoff':'dispatch',handoffId??dispatchId),sourceHandoff=handoffId?asset:get('handoff',asset.handoffId);
        file=exportAsset(asset,sourceHandoff.sourceIds.map(id=>get('source',id)),kind,{directory});
      }
      const size=Buffer.byteLength(file.body);
      if(size>MAX_PACKAGE_BYTES)fail('EXPORT_SIZE','The complete export exceeds 256 MiB.',413);
      return {...file,bytes:size,sha256:digest(file.body)};
    });
  }
  function receive(supplied){
    object(supplied,'Receiving action');
    if(Object.keys(supplied).some(key=>!['requestId','expectedRevision','originalText','hostInput'].includes(key)))fail('UNKNOWN_RECEIVE_FIELD','The receiving action contains an unsupported field.');
    const inputControl=control(pickControl(supplied)),originalText=supplied.originalText;
    if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive a complete GIS package of at most 256 MiB.',413);
    const originalFile={sha256:digest(originalText),bytes:Buffer.byteLength(originalText)};
    const descriptor=packageSha256=>({...inputControl,originalFile,incomingPackageSha256:packageSha256,...(supplied.hostInput!==undefined?{hostInput:copy(supplied.hostInput)}:{})});
    const fingerprint=input=>{const {expectedRevision,...intent}=input;return digest({kind:'workspace-receive',intent});};
    const prior=operation(inputControl.requestId);
    if(prior){
      const candidate=descriptor(prior.input.incomingPackageSha256??'');
      if(prior.kind!=='workspace-receive'||prior.inputSha256!==fingerprint(candidate))fail('REQUEST_ID_CONFLICT','This receiving request ID already names another saved file or action.',409);
      return prior.result;
    }
    const bundle=validateWorkspacePackage(originalText,{directory}),input=descriptor(bundle.sha256),inputSha256=fingerprint(input);
    if(bundle.operations.some(operation=>operation.requestId===input.requestId))fail('REQUEST_ID_CONFLICT','Choose a new receiving request ID distinct from the original operations.',409);
    return transaction(()=>{
      const existing=operation(input.requestId);
      if(existing){if(existing.kind!=='workspace-receive'||existing.inputSha256!==inputSha256)fail('REQUEST_ID_CONFLICT','This receiving request ID names another action.',409);return existing.result;}
      const previous=metadata();
      if(input.expectedRevision!==previous.revision)fail('REVISION_CONFLICT','The receiving workspace changed. Refresh before receiving.',409,{actualRevision:previous.revision});
      if(previous.revision!==0||db.prepare('SELECT COUNT(*) AS count FROM records').get().count)fail('RECEIVING_WORKSPACE_NOT_EMPTY','Receive the complete package into an initialized empty GIS workspace.',409);
      for(const record of bundle.records)save(record.kind,record.value);
      for(const operation of bundle.operations)db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(operation.requestId,operation.kind,operation.inputSha256,canonical(operation.input),canonical(operation.result),operation.createdAt);
      const receivedAt=now(),meta={schema:DATABASE_SCHEMA,workspaceId:bundle.workspaceId,revision:bundle.revision+1,createdAt:bundle.createdAt,updatedAt:receivedAt,
        receivedFrom:[...copy(bundle.receivedFrom),{workspaceId:bundle.workspaceId,revision:bundle.revision,packageSha256:bundle.sha256,originalFile:copy(originalFile),receivedAt,destinationInitializationId:previous.workspaceId}]};
      saveMeta(meta);
      const result={workspaceId:meta.workspaceId,revision:meta.revision,requestId:input.requestId,originalWorkspaceId:bundle.workspaceId,originalRevision:bundle.revision,packageSha256:bundle.sha256,originalFile:copy(originalFile),records:bundle.records.length};
      db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(input.requestId,'workspace-receive',inputSha256,canonical(input),canonical(result),receivedAt);
      return result;
    },true);
  }
  return {directory,state,operation,inspectSource,importSource,putHandoff,importReturn,putDecision,putDispatch,source,sourceRows,handoff,row,returned,dispatch,
    workspaceExport,exportFile,receive,close(){if(!closed){closed=true;db.close();}}};
}
export function receiveWorkspace(directory,originalText,controlInput={}) {
  const workspace=openWorkspace(directory);
  try{return workspace.receive({requestId:controlInput.requestId??entityId('receive',{sha256:digest(originalText)}),expectedRevision:controlInput.expectedRevision??0,originalText});}
  finally{workspace.close();}
}
