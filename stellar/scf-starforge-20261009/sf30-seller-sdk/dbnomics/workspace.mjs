// MIT. One DBnomics analyst workbench around the maintained dataset publisher.
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {lstat,readdir} from 'node:fs/promises';
import {bytes as coreBytes,identity as coreIdentity,readJson,readPrivate,createFile,privateDirectory,atomicJson,syncDirectory} from '../postgres/publisher/files.mjs';
import {openDbnomicsPublisher} from './publisher.mjs';
import {need,text,isRecord,clone,canonical,hash,digest,jsonBytes,operationId,MAX_CAPTURE_BYTES,
  compareModels,reportSpec,calculateReport,rowsCsv,observationRows,OBSERVATION_COLUMNS,reportHtml} from './model.mjs';
import {now,optionalJson,exactFile,storeDbnomicsCapture,inspectDbnomicsCapture,captureDbnomics,discoverDbnomics} from './provider.mjs';
import {SOURCE_SCHEMA,HASH,QUERY_NAME,readDbnomicsSource,readDbnomicsCapture,normalizeSourceQuery,queryColumns,selectedObservationRows} from './source.mjs';
const PROJECT='stellar-forge.dbnomics-project.v1',BUNDLE='stellar-forge.dbnomics-source-handover.v1';
const NOTES='stellar-forge.dbnomics-notes.v1';
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const uint=(value,fallback,max)=>{value??=fallback;need(Number.isSafeInteger(value)&&value>=0&&value<=max,'Use a supported nonnegative page or revision.');return value;};
const page=(items,input={})=>{const offset=uint(input.offset,0,10000000),limit=uint(input.limit,100,1000);need(limit>0,'Use a positive page limit.');
  return {items:items.slice(offset,offset+limit),page:{offset,limit,total:items.length,returned:Math.min(limit,Math.max(0,items.length-offset)),next:offset+limit<items.length?offset+limit:null}};};
export async function openDbnomicsWorkspace({directory,create=false,targetDirectory,seller=null,resource=null,environment=process.env,fetchImpl=fetch}={}){
  need(typeof directory==='string'&&directory.startsWith('/'),'Use an absolute DBnomics project directory.');
  directory=resolve(directory);await privateDirectory(directory,create);
  const settingsFile=join(directory,'project.json'),sourceFile=join(directory,'source.json');
  if(!await exists(settingsFile)){
    need(create,'The DBnomics project does not exist.','DBNOMICS_PROJECT_NOT_FOUND',404);
    await exactFile(directory,'project.json',jsonBytes({schema:PROJECT,id:randomUUID(),directory,sourceFile,publisherDirectory:join(directory,'publisher'),
      targetDirectory:resolve(targetDirectory??join(directory,'dataset')),createdAt:now()}));
  }
  const settings=await readJson(settingsFile,16384);
  need(settings.schema===PROJECT&&settings.directory===directory&&settings.sourceFile===sourceFile&&settings.publisherDirectory===join(directory,'publisher')&&
    (!targetDirectory||resolve(targetDirectory)===settings.targetDirectory),'Reopen this project with its original directory and dataset target.','DBNOMICS_PROJECT_BINDING_CHANGED',409);
  if(!await exists(sourceFile)){need(create,'The original source declaration is missing.');await exactFile(directory,'source.json',jsonBytes({schema:SOURCE_SCHEMA,captures:{},queries:{}}));}
  for(const name of ['captures','acquisitions','operations','notes','reports','exports'])await privateDirectory(join(directory,name),true);
  const core=await openDbnomicsPublisher({directory:settings.publisherDirectory,create:!await exists(join(settings.publisherDirectory,'workspace.json')),
    sourceFile,targetDirectory:settings.targetDirectory,seller,resource,environment});
  let closed=false,closing=null,active=null;
  const available=()=>{need(!closed&&!closing,'This DBnomics workspace is closing.','DBNOMICS_WORKSPACE_CLOSED',409);
    need(!active&&!core.status().active,'Another original workspace operation is running.','DBNOMICS_WORKSPACE_BUSY',409);};
  const saveSource=async config=>{need(jsonBytes(config).length<=2*1024*1024,'The source declaration exceeds its retained capacity.');await atomicJson(directory,'source.json',config);};
  async function operation(id){
    operationId(id);const intent=await optionalJson(join(directory,'operations',id+'.intent.json'),2*1024*1024);
    need(intent,'The operation is absent.','DBNOMICS_OPERATION_NOT_FOUND',404);
    const result=await optionalJson(join(directory,'operations',id+'.result.json'),MAX_CAPTURE_BYTES);
    const error=await optionalJson(join(directory,'operations',id+'.error.json'),262144);
    return {id,kind:intent.kind,createdAt:intent.createdAt,inputHash:intent.inputHash,state:result?'COMPLETE':error?'RETURNED_ERROR':'PREPARED',
      result:result?.result??null,error:error??null,active:active?.id===id};
  }
  async function mutate(id,kind,input,action){
    operationId(id);available();const op={id,kind,promise:null,controller:new AbortController()};active=op;
    op.promise=(async()=>{
      const name=id+'.intent.json',inputHash=digest(input),previous=await optionalJson(join(directory,'operations',name),2*1024*1024);
      if(previous)need(previous.kind===kind&&previous.inputHash===inputHash,'This operation ID already belongs to another exact input.','DBNOMICS_OPERATION_CONFLICT',409);
      const intent=previous??{schema:'stellar-forge.dbnomics-operation.v1',id,kind,inputHash,input:clone(input),createdAt:now()};
      if(!previous)await exactFile(join(directory,'operations'),name,jsonBytes(intent));
      const completed=await optionalJson(join(directory,'operations',id+'.result.json'),MAX_CAPTURE_BYTES);
      if(completed)return {...completed.result,replayed:true};
      try{
        const result=await action(intent,op.controller.signal);
        await exactFile(join(directory,'operations'),id+'.result.json',jsonBytes({completedAt:now(),result}));
        return {...result,replayed:false};
      }catch(error){
        await atomicJson(join(directory,'operations'),id+'.error.json',{returnedAt:now(),code:error.code??'DBNOMICS_OPERATION_FAILED',
          message:String(error.message??error).slice(0,3000),providerStatus:error.providerStatus??null,retryAt:error.retryAt??null});
        throw error;
      }
    })();
    try{return await op.promise;}finally{if(active===op)active=null;}
  }
  async function putCapture(capture){
    const model=inspectDbnomicsCapture(capture),id=capture.captureId,folder=join(directory,'captures',id);
    await privateDirectory(folder,true);await storeDbnomicsCapture(folder,capture);
    const current=await readDbnomicsSource(sourceFile),captureBytes=jsonBytes(capture);
    const summary={captureId:id,title:model.selection.title,rowCount:model.rowCount,missing:model.missing,retrievedAt:model.retrievedAt,
      retrievalWindow:model.retrievalWindow,sourceMode:model.sourceMode,series:model.series.map(row=>({id:row.id,name:row.name,frequency:row.frequency,
        rowCount:row.rowCount,missing:row.missing,sourceUpdatedAt:row.sourceUpdatedAt})),terms:model.terms};
    const ref={file:'captures/'+id+'/capture.json',sha256:hash(captureBytes),summary};
    const existing=current.config.captures[id];if(existing)need(canonical(existing)===canonical(ref),'The existing source declaration differs.','DBNOMICS_CAPTURE_CONFLICT',409);
    current.config.captures[id]=ref;await saveSource(current.config);
    return {...summary,captureSha256:ref.sha256,sourceHash:hash(jsonBytes(current.config)),captureFile:join(folder,'capture.json')};
  }
  async function capture(id){
    need(HASH.test(id??''),'Choose a retained source capture.');
    const selected=await readDbnomicsSource(sourceFile,{captureId:id});
    return selected.retained;
  }
  const importCapture=({id,capture:input}={})=>{
    const model=inspectDbnomicsCapture(input);
    return mutate(id,'IMPORT_CAPTURE',{captureId:input.captureId,captureSha256:hash(jsonBytes(input))},()=>putCapture(input));
  };
  const acquire=({id,selection,rights,timeoutMs=45000}={})=>mutate(id,'ACQUIRE',{selection,rights:rights??null,timeoutMs},async(_intent,signal)=>{
    const result=await captureDbnomics({directory:join(directory,'acquisitions',operationId(id)),selection,rights,timeoutMs,signal,fetchImpl});
    return {...await putCapture(result.capture),acquisitionId:id,sourceReplayed:result.replayed};
  });
  const refresh=({id,captureId,timeoutMs=45000}={})=>mutate(id,'REFRESH',{captureId,timeoutMs},async(_intent,signal)=>{
    const previous=await capture(captureId),terms=previous.capture.terms;
    const result=await captureDbnomics({directory:join(directory,'acquisitions',operationId(id)),selection:previous.capture.selection,
      rights:{providers:terms.providers,...(terms.note===undefined?{}:{note:terms.note})},timeoutMs,signal,fetchImpl});
    const retained=await putCapture(result.capture),comparison=compareModels(previous.model,result.model);
    return {...retained,previousCaptureId:captureId,acquisitionId:id,comparison:{...comparison,changes:undefined,metadataChanges:comparison.metadataChanges.map(row=>({seriesId:row.seriesId}))}};
  });
  async function observations(captureId,input={}){
    const retained=await capture(captureId),chosen=input.seriesId??null,search=String(input.search??'').toLowerCase();
    const rows=retained.model.rows.filter(row=>(chosen===null||row.seriesId===chosen)&&(!search||[row.period,row.seriesName,row.valueText,canonical(row.attributes)].some(v=>v.toLowerCase().includes(search))));
    const result=page(rows,input);return {captureId,captureSha256:retained.captureSha256,records:result.items,page:result.page};
  }
  async function facets(captureId,{field='seriesId',limit=100}={}){
    need(['seriesId','frequency','missingReason','provider','dataset'].includes(field),'Choose a source facet.');
    limit=uint(limit,100,1000);need(limit>0,'Use a positive facet limit.');
    const retained=await capture(captureId),counts=new Map();
    for(const row of retained.model.rows){const value=row[field]??null,key=canonical(value);const old=counts.get(key);counts.set(key,{value,count:(old?.count??0)+1});}
    const values=[...counts.values()].sort((a,b)=>b.count-a.count||String(a.value).localeCompare(String(b.value)));
    return {captureId,field,totalRows:retained.model.rowCount,distinct:values.length,values:values.slice(0,limit),complete:values.length<=limit};
  }
  async function compare(beforeCapture,afterCapture,input={}){
    const before=await capture(beforeCapture),after=await capture(afterCapture),comparison=compareModels(before.model,after.model),changes=page(comparison.changes,input);
    return {...comparison,changes:changes.items,page:changes.page};
  }
  async function notes(captureId,revision=null){
    need(HASH.test(captureId??''),'Choose the source for these analyst notes.');
    const pointer=await optionalJson(join(directory,'notes',captureId+'.current.json'),16384);
    revision??=pointer?.revision??0;revision=uint(revision,0,1000000);
    if(revision===0)return {schema:NOTES,captureId,revision:0,entries:[],sha256:null};
    const value=await readJson(join(directory,'notes',captureId+'-'+String(revision).padStart(6,'0')+'.json'),4*1024*1024);
    need(value.schema===NOTES&&value.captureId===captureId&&value.revision===revision,'The retained notes identity changed.');
    return {...value,sha256:hash(jsonBytes(value))};
  }
  const saveNotes=({id,captureId,expectedRevision,entries}={})=>mutate(id,'SAVE_NOTES',{captureId,expectedRevision,entries},async intent=>{
    const retained=await capture(captureId),current=await notes(captureId),revision=uint(expectedRevision,0,1000000)+1;
    const name=captureId+'-'+String(revision).padStart(6,'0')+'.json',old=await optionalJson(join(directory,'notes',name),4*1024*1024);
    if(old){need(old.operationId===id,'The note revision already belongs to another edit.','DBNOMICS_NOTES_CONFLICT',409);
      if(current.revision<revision)await atomicJson(join(directory,'notes'),captureId+'.current.json',{revision,sha256:hash(jsonBytes(old))});
      return {...old,sha256:hash(jsonBytes(old))};}
    need(current.revision===expectedRevision,'Reload the current notes before saving this edit.','DBNOMICS_NOTES_CONFLICT',409);
    need(Array.isArray(entries)&&entries.length<=5000,'Use at most 5,000 retained analyst notes.');
    const seen=new Set(),population=new Set(retained.model.rows.map(row=>row.observationId));
    const normalized=entries.map(row=>{
      need(isRecord(row)&&Object.keys(row).every(key=>['id','observationId','author','tag','text'].includes(key)),'Use the documented analyst note fields.');
      const noteId=operationId(row.id);need(!seen.has(noteId),'Keep note IDs unique.');seen.add(noteId);
      need(row.observationId===null||population.has(row.observationId),'Bind each row note to its exact source observation.');
      return {id:noteId,observationId:row.observationId,author:text(row.author,'analyst',160),tag:text(row.tag??'','note tag',80,true),text:text(row.text,'analyst note',16000)};
    });
    const saved={schema:NOTES,captureId,captureSha256:retained.captureSha256,revision,previousRevision:expectedRevision,operationId:id,createdAt:intent.createdAt,entries:normalized};
    need(jsonBytes(saved).length<=4*1024*1024,'The complete notes revision exceeds four MiB.');
    await exactFile(join(directory,'notes'),name,jsonBytes(saved));await atomicJson(join(directory,'notes'),captureId+'.current.json',{revision,sha256:hash(jsonBytes(saved))});
    return {...saved,sha256:hash(jsonBytes(saved))};
  });
  async function report(id){
    operationId(id);const value=await readJson(join(directory,'reports',id+'.json'),MAX_CAPTURE_BYTES);
    need(value.reportId===id&&value.schema==='stellar-forge.dbnomics-report.v1','The saved report identity changed.');
    const retained=await capture(value.captureId);need(value.captureSha256===retained.captureSha256,'The saved report source changed.');
    return {...value,sha256:hash(jsonBytes(value))};
  }
  const saveReport=({id,captureId,spec,notesRevision=0}={})=>mutate(id,'SAVE_REPORT',{captureId,spec,notesRevision},async intent=>{
    const retained=await capture(captureId),selected=reportSpec(spec,retained.model),noteEdition=await notes(captureId,notesRevision);
    const value={...calculateReport(retained.model,selected),reportId:id,createdAt:intent.createdAt,captureSha256:retained.captureSha256,
      notesRevision:noteEdition.revision,notesSha256:noteEdition.sha256,analystNotes:noteEdition.entries,sourceReceipts:retained.capture.responses.map(row=>row.receipt)};
    await exactFile(join(directory,'reports'),id+'.json',jsonBytes(value));
    return {id,reportId:id,captureId,captureSha256:retained.captureSha256,title:selected.title,method:selected.method,rows:value.rowCount,
      unavailable:value.missingCalculations,notesRevision:noteEdition.revision,createdAt:value.createdAt,sha256:hash(jsonBytes(value))};
  });
  async function reportSummaries(){
    const result=[];
    for(const name of (await readdir(join(directory,'reports'))).filter(name=>name.endsWith('.json')).sort()){
      const value=await readJson(join(directory,'reports',name),MAX_CAPTURE_BYTES);
      result.push({id:value.reportId,captureId:value.captureId,title:value.spec.title,method:value.spec.method,rowCount:value.rowCount,createdAt:value.createdAt,notesRevision:value.notesRevision});
    }
    return result;
  }
  async function exportReport(id,format='json'){
    need(['json','csv','html'].includes(format),'Choose JSON, CSV or HTML for the complete report.');
    const selected=await report(id),{sha256,...value}=selected;
    const content=format==='json'?jsonBytes(value):format==='html'?Buffer.from(reportHtml(value)):Buffer.from(rowsCsv(value.rows.map(row=>({...row,reportId:id,captureSha256:value.captureSha256,notesRevision:value.notesRevision,
      analystNotes:value.analystNotes.filter(note=>note.observationId===null||note.observationId===row.observationId)})),
      ['reportId','captureSha256','notesRevision','analystNotes','seriesId','seriesName','frequency','period','periodStartDay','valueText','missing','attributes','calculatedValue','calculation','calculationReason','basePeriod','baseValue','baseObservationId','precision','captureId','responseSha256']));
    const filename=id+'.'+format;const file=await exactFile(join(directory,'exports'),filename,content);
    return {...file,path:join(directory,'exports',filename),filename,mediaType:{json:'application/json',csv:'text/csv',html:'text/html'}[format]+'; charset=utf-8',reportId:id};
  }
  const saveQuery=({id,name,query,expectedHash}={})=>mutate(id,'SAVE_QUERY',{name,query,expectedHash},async()=>{
    need(QUERY_NAME.test(name??''),'Use a lowercase query name.');
    const source=await readDbnomicsSource(sourceFile),retained=await capture(query.captureId),normalized=normalizeSourceQuery(query,retained.model);
    if(canonical(source.config.queries[name])===canonical(normalized))return {name,query:normalized,sourceHash:source.hash};
    need(source.hash===expectedHash,'The source declaration changed; review its current edition.','DBNOMICS_SOURCE_CONFLICT',409);
    source.config.queries[name]=normalized;await saveSource(source.config);return {name,query:normalized,sourceHash:hash(jsonBytes(source.config))};
  });
  async function planTemplate(name){
    const source=await readDbnomicsSource(sourceFile),query=source.config.queries[name];need(query,'Choose a saved source query.','QUERY_NOT_FOUND',404);
    const retained=await capture(query.captureId),rows=selectedObservationRows(retained.model,query).length;
    return {title:(name+' — '+retained.model.selection.title).slice(0,128),query:name,input:{},sourceHash:source.hash,
      dataset:{name,columns:Object.fromEntries(queryColumns(query).map(row=>[row.name,{type:row.type,nullable:false}])),
        filters:['series_id','provider','dataset','frequency','period','missing'],ranges:[],sorts:['series_id','period'],
        maxCellChars:65536,defaultLimit:50,maxLimit:250,maxPageBytes:921600},
      extraction:{maxRows:Math.max(1,rows),maxBytes:64*1024*1024,maxRowBytes:1024*1024,timeoutMs:30000,
        order:[{column:'series_id',direction:'asc'},{column:'period',direction:'asc'}]}};
  }
  async function status(input={}){
    const source=await readDbnomicsSource(sourceFile),reports=await reportSummaries();
    const captures=Object.entries(source.config.captures).map(([id,ref])=>({...ref.summary,captureId:id,captureSha256:ref.sha256}));
    const names=(await readdir(join(directory,'operations'))).filter(name=>name.endsWith('.intent.json')).sort();
    const operations=[];
    for(const name of names.slice(-100)){const value=await operation(name.slice(0,-12));operations.push({...value,result:undefined});}
    return {schema:'stellar-forge.dbnomics-workspace-status.v1',project:settings,sourceHash:source.hash,captures,queries:source.queries,reports,
      active:active?{id:active.id,kind:active.kind}:null,operations,publisher:core.status(input),sourceTerms:captures.map(row=>({captureId:row.captureId,terms:row.terms}))};
  }
  async function exportSources(){
    available();const op={id:'source-export',kind:'EXPORT_SOURCES',promise:null};active=op;
    op.promise=(async()=>{
      const source=await readDbnomicsSource(sourceFile),captures=[];
      for(const id of Object.keys(source.config.captures)){const retained=await capture(id);captures.push(retained.capture);}
      const notes=[];
      for(const name of (await readdir(join(directory,'notes'))).filter(name=>/^[a-f0-9]{64}-[0-9]{6}\.json$/.test(name)).sort())
        notes.push(await readJson(join(directory,'notes',name),4*1024*1024));
      const reports=[];for(const name of (await readdir(join(directory,'reports'))).filter(name=>name.endsWith('.json')).sort())reports.push(await readJson(join(directory,'reports',name),MAX_CAPTURE_BYTES));
      const content={schema:BUNDLE,project:{id:settings.id,createdAt:settings.createdAt},sourceConfig:source.config,captures,notes,reports};
      return {...content,bundleSha256:digest(content)};
    })();
    try{return await op.promise;}finally{if(active===op)active=null;}
  }
  const importSources=({id,bundle}={})=>{
    const {bundleSha256,...content}=bundle??{};
    need(content.schema===BUNDLE&&bundleSha256===digest(content),'The complete source handover hash differs.','DBNOMICS_HANDOVER_CHANGED',409);
    need(Array.isArray(content.captures)&&Array.isArray(content.notes)&&Array.isArray(content.reports),'The handover is incomplete.');
    return mutate(id,'IMPORT_SOURCES',{bundleSha256},async()=>{
      for(const capture of content.captures)await putCapture(capture);
      const current=await readDbnomicsSource(sourceFile);
      for(const [name,query] of Object.entries(content.sourceConfig.queries)){
        need(QUERY_NAME.test(name),'The received query name is invalid.');const retained=await capture(query.captureId),normalized=normalizeSourceQuery(query,retained.model);
        need(!current.config.queries[name]||canonical(current.config.queries[name])===canonical(normalized),'A local saved query already has another selection.','DBNOMICS_HANDOVER_QUERY_CONFLICT',409);
        current.config.queries[name]=normalized;
      }
      await saveSource(current.config);
      for(const note of content.notes){
        need(note.schema===NOTES&&HASH.test(note.captureId??'')&&Number.isSafeInteger(note.revision)&&note.revision>0&&Array.isArray(note.entries),'The received note revision is invalid.');
        const retained=await capture(note.captureId);need(note.captureSha256===retained.captureSha256,'The received notes belong to another source.');
        const population=new Set(retained.model.rows.map(row=>row.observationId));need(note.entries.every(row=>row.observationId===null||population.has(row.observationId)),'A received note points outside its source.');
        const name=note.captureId+'-'+String(note.revision).padStart(6,'0')+'.json';await exactFile(join(directory,'notes'),name,jsonBytes(note));
        const old=await notes(note.captureId);if(old.revision<note.revision)await atomicJson(join(directory,'notes'),note.captureId+'.current.json',{revision:note.revision,sha256:hash(jsonBytes(note))});
      }
      for(const value of content.reports){
        operationId(value.reportId);const retained=await capture(value.captureId),rebuilt=calculateReport(retained.model,value.spec);
        need(value.schema===rebuilt.schema&&value.captureSha256===retained.captureSha256&&canonical(value.rows)===canonical(rebuilt.rows)&&
          canonical(value.series)===canonical(rebuilt.series)&&value.rowCount===rebuilt.rowCount,'The received report differs from its original calculation.','DBNOMICS_REPORT_CHANGED',409);
        const noteEdition=await notes(value.captureId,value.notesRevision);
        need(value.notesSha256===noteEdition.sha256&&canonical(value.analystNotes)===canonical(noteEdition.entries),'The received report has another notes edition.');
        await exactFile(join(directory,'reports'),value.reportId+'.json',jsonBytes(value));
      }
      return {bundleSha256,originalProject:content.project,receivingProject:settings.id,captures:content.captures.length,notes:content.notes.length,reports:content.reports.length};
    });
  };
  const savePublicationPlan=({id,plan}={})=>mutate(id,'SAVE_PUBLICATION_PLAN',{plan},async()=>{
    const selected={...plan,operationId:id};
    let offset=0;
    while(true){
      const state=core.status({limit:100,plansOffset:offset}),old=state.plans.find(row=>row.data.operationId===id);
      if(old){need(old.data.originalInputHash===coreIdentity(selected),'The original plan operation input changed.','DBNOMICS_PLAN_CONFLICT',409);return {plan:old};}
      if(state.pages.plans.next===null)break;offset=state.pages.plans.next;
    }
    return {plan:await core.savePlan(selected)};
  });
  function startPublication({id,planId}={}){
    need(!closed&&!closing,'The workbench is closing.');need(typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id),'Retain one UUID for the original extraction.');
    let previous;try{previous=core.run(id);}catch(error){if(error.code!=='RUN_NOT_FOUND')throw error;}
    if(previous){need(previous.plan===planId,'This extraction ID belongs to another plan.','DBNOMICS_EXTRACTION_CONFLICT',409);return {id,state:previous.state,replayed:true};}
    available();const started=core.startExtraction(planId,{id});started.completion.catch(()=>{});
    return {id,state:core.run(id).state,replayed:false};
  }
  const close=()=>closing??=(async()=>{if(active?.controller)active.controller.abort();if(active?.promise)try{await active.promise;}catch{}closed=true;await core.close();})();
  const writes=new Set(['savePlan','startExtraction','review','publish','recover','prepareBuyer']);
  const publisher=Object.freeze(Object.fromEntries(Object.entries(core).map(([name,value])=>[name,name==='close'?close:
    writes.has(name)?(...args)=>{need(!active&&!closed&&!closing,'An analyst workspace operation is active.','DBNOMICS_WORKSPACE_BUSY',409);return value(...args);}:value])));
  return Object.freeze({directory,settings,sourceFile,publisher,status,operation,discover:input=>discoverDbnomics(input,{fetchImpl}),
    acquire,refresh,importCapture,capture,observations,facets,compare,notes,saveNotes,saveReport,report,exportReport,saveQuery,planTemplate,
    exportSources,importSources,savePublicationPlan,startPublication,close});
}
