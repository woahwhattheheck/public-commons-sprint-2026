// MIT. Durable request/work-order editions, source-linked decisions and complete receiving.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, copy, digest, equal, fail, object, text, instant, parseJson, now, entityId, seal, verifySeal, page, MAX_PACKAGE_BYTES, MAX_SOURCE_BYTES } from '../gis/shared.mjs';
import { SOURCE_SCHEMA, inspectSource, importSource as makeSource, sourceSummary, sourceDetail, originalRows, sourceOriginalFile } from './source.mjs';
import { PROFILE_SCHEMA, EDITION_SCHEMA, LINK_SCHEMA, WORK_SCHEMA, RETURN_SCHEMA, DECISION_SCHEMA, DISPATCH_SCHEMA,
  normalizeProfile, normalizeDefinition, buildEdition, editionSummary, requestRow, orderRow, createLink, effectiveLinks, createWork, currentWork, workView, projectRequest, compareEditions,
  reviewTemplate, createReturn, proposalConflicts, applyReview, returnSummary, workSummary, createDispatch, dispatchSummary, DEFAULT_DISPATCH_COLUMNS } from './domain.mjs';
import { requestCsv, dispatchCsv, dispatchGeoJson, htmlReport, fileResult } from './formats.mjs';

export const WORKSPACE_SCHEMA='commons.open311.follow-through-workspace.v1';
const DATABASE_SCHEMA='commons.open311.follow-through-database.v1';
const KINDS=['source','profile','edition','link','work','return','decision','dispatch'];
const schemas={source:SOURCE_SCHEMA,profile:PROFILE_SCHEMA,edition:EDITION_SCHEMA,link:LINK_SCHEMA,work:WORK_SCHEMA,return:RETURN_SCHEMA,decision:DECISION_SCHEMA,dispatch:DISPATCH_SCHEMA};
const recordId=(kind,value)=>kind==='profile'?value.key:value.id;
const summary=(kind,value)=>kind==='source'?sourceSummary(value):kind==='edition'?editionSummary(value):kind==='work'?workSummary(value):kind==='return'?returnSummary(value):kind==='dispatch'?dispatchSummary(value):copy(value);
function control(input){
  object(input,'Workspace action');text(input.requestId,'Stable request ID',200);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('EXPECTED_REVISION_REQUIRED','Supply the revision observed before this action.');
  return copy(input);
}
function fingerprint(kind,input){const {expectedRevision,...intent}=input;return digest({kind,intent});}
function assertSame(a,b,code,message){if(!equal(a,b))fail(code,message);}
function search(rows,q,values){
  if(typeof q!=='string')fail('INVALID_SEARCH','Search must be text.');
  const terms=q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return rows;
  return rows.filter(row=>{const value=values(row).map(v=>typeof v==='string'?v:canonical(v??null)).join(' ').toLocaleLowerCase();return terms.every(term=>value.includes(term));});
}
function compactRequest(row){
  const out={};for(const key of ['key','serviceRequestId','sourceSha256','sourceId','title','description','sourceStatus','workNeeded','createdAt','updatedAt','closedAt','referenceValues','geometry','originalGeometry','candidateCount','linkCount','discrepancies'])out[key]=copy(row[key]);
  out.work=row.work?{...workSummary(row.work),sourceChanged:row.work.sourceChanged,orderChanged:row.work.orderChanged,coordinateChanged:row.work.coordinateChanged,approvalCurrent:row.work.approvalCurrent}:null;return out;
}
function sourceIdentity(source){
  return {role:source.role,kind:source.kind,endpoints:[...new Set(source.coverage.pages.map(p=>{try{const u=new URL(p.sourceUrl);return u.origin+u.pathname;}catch{return null;}}).filter(Boolean))].sort()};
}
export function validateWorkspacePackage(originalText){
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive one complete follow-through workspace of at most 256 MiB.',413);
  const bundle=verifySeal(parseJson(originalText,'Follow-through workspace package'),WORKSPACE_SCHEMA);
  text(bundle.workspaceId,'Original workspace ID',120);
  if(!Number.isSafeInteger(bundle.revision)||bundle.revision<0||!Array.isArray(bundle.records)||!Array.isArray(bundle.operations)||!Array.isArray(bundle.receivedFrom)||bundle.operations.length!==bundle.revision)fail('INCOMPLETE_WORKSPACE','The package needs its complete source, decision and operation history.');
  for(const key of ['createdAt','updatedAt','exportedAt'])instant(bundle[key],key);
  const maps=Object.fromEntries(KINDS.map(kind=>[kind,new Map()])),ordered=Object.fromEntries(KINDS.map(kind=>[kind,[]])),expectedChildren=new Map();
  const need=(kind,id)=>{const value=maps[kind].get(id);if(!value)fail('MISSING_PACKAGE_RECORD','An original '+kind+' predecessor is missing.',400,{id});return value;};
  const context=()=>({links:ordered.link,work:ordered.work,decisions:ordered.decision});
  for(const record of bundle.records){
    object(record,'Saved record');if(!KINDS.includes(record.kind))fail('UNKNOWN_PACKAGE_RECORD','A saved record kind is unsupported.');
    const {kind,id,value}=record;text(id,'Record ID',150);verifySeal(value,schemas[kind]);if(recordId(kind,value)!==id||maps[kind].has(id))fail('DUPLICATE_PACKAGE_RECORD','The package repeats or changes a record identity.');
    let checked;
    if(kind==='source')checked=makeSource(value.originalText,value.options,{createdAt:value.createdAt});
    else if(kind==='profile')checked=normalizeProfile(value);
    else if(kind==='edition')checked=buildEdition(value.definition,need('source',value.requestSourceId),value.orderSourceId?need('source',value.orderSourceId):null,need('profile',value.profileId),{id:value.id,createdAt:value.createdAt});
    else if(expectedChildren.has(id)){checked=expectedChildren.get(id);expectedChildren.delete(id);}
    else if(kind==='link')checked=createLink(need('edition',value.editionId),value,{id:value.id,createdAt:value.createdAt});
    else if(kind==='work'){
      const edition=need('edition',value.editionId),previous=currentWork(edition,value.key,ordered.work);
      if((previous?.id??null)!==value.previousWorkId)fail('WORK_HISTORY_MISMATCH','A work record does not continue the saved request work history.');
      checked=createWork(edition,value,{id:value.id,createdAt:value.createdAt},{previous,links:ordered.link});
    }else if(kind==='return'){
      const base=need('edition',value.baseEditionId);
      checked=createReturn(value.originalText,base,need('profile',base.profileId),context(),{id:value.id,createdAt:value.createdAt});
    }else if(kind==='decision'){
      const result=applyReview(need('return',value.returnId),need('edition',value.targetEditionId),value,{id:value.id,createdAt:value.createdAt},context());checked=result.decision;
      for(const child of [...result.links,...result.work])expectedChildren.set(child.id,child);
    }else if(kind==='dispatch')checked=createDispatch(need('edition',value.editionId),value.definition,{id:value.id,createdAt:value.createdAt},context());
    assertSame(checked,value,'SAVED_RECORD_MISMATCH','A saved '+kind+' differs from its complete original source or reviewed predecessors.');
    maps[kind].set(id,value);ordered[kind].push(value);
  }
  if(expectedChildren.size)fail('INCOMPLETE_REVIEW_DECISION','A saved decision is missing its derived relationships or work records.');
  const sourceSeries=new Map();for(const source of ordered.source){const identity=sourceIdentity(source),previous=sourceSeries.get(source.seriesId);if(previous&&!equal(previous,identity))fail('SOURCE_SERIES_MISMATCH','A source series changed role, format or endpoint.');sourceSeries.set(source.seriesId,identity);}
  const ids=new Set();
  for(let index=0;index<bundle.operations.length;index++){
    const op=bundle.operations[index];object(op,'Original operation');control(op.input);
    if(op.state!=='SUCCEEDED'||ids.has(op.requestId)||op.requestId!==op.input.requestId||op.inputSha256!==fingerprint(op.kind,op.input)||op.result.revision!==index+1||op.result.requestId!==op.requestId||op.result.workspaceId!==bundle.workspaceId)fail('OPERATION_HISTORY_MISMATCH','The complete original operation identity or revision history differs.');
    if(op.kind==='workspace-receive'){
      const file=op.input.originalFile;if(!file||!/^[a-f0-9]{64}$/.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_PACKAGE_BYTES||op.input.incomingPackageSha256!==op.result.packageSha256)fail('RECEIVE_HISTORY_MISMATCH','A prior receiving file descriptor is inconsistent.');
    }
    ids.add(op.requestId);instant(op.createdAt,'Operation time');
  }
  return bundle;
}
export function openWorkspace(suppliedDirectory,{create=true}={}){
  let directory=resolve(text(suppliedDirectory,'Workspace directory',4096));
  if(!existsSync(directory)){if(!create)fail('WORKSPACE_NOT_FOUND','Initialize or receive the follow-through workspace first.',404);mkdirSync(directory,{recursive:true,mode:0o700});}
  if(!lstatSync(directory).isDirectory())fail('INVALID_WORKSPACE_DIRECTORY','Choose a real private workspace directory.');
  directory=realpathSync(directory);const filename=join(directory,'open311-follow-through.sqlite');
  if(existsSync(filename)){const stat=lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())fail('INVALID_WORKSPACE_FILE','The selected database must be a regular file.');}else if(!create)fail('WORKSPACE_NOT_FOUND','Initialize or receive the follow-through workspace first.',404);
  const db=new DatabaseSync(filename);chmodSync(filename,0o600);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');let closed=false;
  function transaction(action,write=false){if(closed)fail('WORKSPACE_CLOSED','The follow-through workspace is closed.',409);db.exec(write?'BEGIN IMMEDIATE':'BEGIN');try{const result=action();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
  try{transaction(()=>{
    const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='follow_meta'").get();
    if(!table){
      if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)fail('WRONG_WORKSPACE_DATABASE','This database belongs to another application.');
      db.exec('CREATE TABLE follow_meta(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE records(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,summary TEXT NOT NULL,series_id TEXT,request_key TEXT,UNIQUE(kind,id)); CREATE INDEX records_series ON records(kind,series_id,seq); CREATE INDEX work_request ON records(kind,series_id,request_key,seq); CREATE TABLE operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,input_sha TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);');
      const stamp=now();db.prepare('INSERT INTO follow_meta VALUES(1,?)').run(canonical({schema:DATABASE_SCHEMA,workspaceId:randomUUID(),revision:0,createdAt:stamp,updatedAt:stamp,receivedFrom:[]}));
    }
    const meta=JSON.parse(db.prepare('SELECT value FROM follow_meta WHERE id=1').get().value);if(meta.schema!==DATABASE_SCHEMA)fail('UNSUPPORTED_WORKSPACE','This follow-through database edition is unsupported.');
  },true);}catch(error){db.close();throw error;}
  const metadata=()=>JSON.parse(db.prepare('SELECT value FROM follow_meta WHERE id=1').get().value);
  const saveMeta=value=>db.prepare('UPDATE follow_meta SET value=? WHERE id=1').run(canonical(value));
  const find=(kind,id)=>{const row=db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.value):null;};
  const get=(kind,id)=>{text(id,kind+' ID',150);const value=find(kind,id);if(!value)fail('RECORD_NOT_FOUND','The selected '+kind+' was not found.',404,{id});return value;};
  const all=(kind,seriesId)=>db.prepare('SELECT value FROM records WHERE kind=?'+(seriesId?' AND series_id=?':'')+' ORDER BY seq').all(...(seriesId?[kind,seriesId]:[kind])).map(row=>JSON.parse(row.value));
  const summaries=kind=>db.prepare('SELECT summary FROM records WHERE kind=? ORDER BY seq DESC').all(kind).map(row=>JSON.parse(row.summary));
  const save=(kind,value)=>db.prepare('INSERT INTO records(kind,id,value,summary,series_id,request_key) VALUES(?,?,?,?,?,?)').run(kind,recordId(kind,value),canonical(value),canonical(summary(kind,value)),value.seriesId??null,value.key??null);
  const context=edition=>({links:all('link',edition.seriesId),work:all('work',edition.seriesId),decisions:all('decision')});
  function stateInside(){
    const meta=metadata(),decisions=all('decision'),decidedByReturn=new Map();for(const value of decisions){const set=decidedByReturn.get(value.returnId)??new Set();for(const id of [...value.accept,...value.reject])set.add(id);decidedByReturn.set(value.returnId,set);}
    const work=db.prepare("SELECT r.summary FROM records r WHERE r.kind='work' AND NOT EXISTS(SELECT 1 FROM records n WHERE n.kind='work' AND n.series_id=r.series_id AND n.request_key=r.request_key AND n.seq>r.seq) ORDER BY r.seq DESC").all().map(row=>JSON.parse(row.summary));
    return {schema:WORKSPACE_SCHEMA,directory,workspaceId:meta.workspaceId,revision:meta.revision,createdAt:meta.createdAt,updatedAt:meta.updatedAt,receivedFrom:copy(meta.receivedFrom),sources:summaries('source'),profiles:summaries('profile'),editions:summaries('edition'),work,
      returns:summaries('return').map(row=>({...row,pending:row.proposals-(decidedByReturn.get(row.id)?.size??0)})),dispatches:summaries('dispatch'),defaultDispatchColumns:copy(DEFAULT_DISPATCH_COLUMNS),
      operations:db.prepare('SELECT request_id,kind,created_at FROM operations ORDER BY seq DESC LIMIT 30').all().map(row=>({requestId:row.request_id,kind:row.kind,state:'SUCCEEDED',createdAt:row.created_at}))};
  }
  function state(){return transaction(stateInside);}
  function operation(requestId){text(requestId,'Request ID',200);const row=db.prepare('SELECT * FROM operations WHERE request_id=?').get(requestId);return row?{requestId,kind:row.kind,state:'SUCCEEDED',inputSha256:row.input_sha,input:JSON.parse(row.input),result:JSON.parse(row.result),createdAt:row.created_at}:null;}
  function mutate(kind,supplied,action){
    const input=control(supplied),inputSha256=fingerprint(kind,input);
    return transaction(()=>{
      const prior=operation(input.requestId);if(prior){if(prior.kind!==kind||prior.inputSha256!==inputSha256)fail('REQUEST_ID_CONFLICT','This request ID already names a different saved action.',409);return prior.result;}
      const meta=metadata();if(input.expectedRevision!==meta.revision)fail('REVISION_CONFLICT','The workspace changed. Refresh before choosing a new action.',409,{expectedRevision:input.expectedRevision,actualRevision:meta.revision});
      const createdAt=now(),identity={id:entityId(kind,{workspaceId:meta.workspaceId,requestId:input.requestId}),createdAt};
      const result={workspaceId:meta.workspaceId,revision:meta.revision+1,requestId:input.requestId,...action(input,identity)};
      meta.revision++;meta.updatedAt=createdAt;saveMeta(meta);db.prepare('INSERT INTO operations(request_id,kind,input_sha,input,result,created_at) VALUES(?,?,?,?,?,?)').run(input.requestId,kind,inputSha256,canonical(input),canonical(result),createdAt);return result;
    },true);
  }
  function importSource(input){return mutate('source-import',input,(value,identity)=>{
    const source=makeSource(value.originalText,value,identity),existing=find('source',source.id);if(existing)return {source:sourceSummary(existing),reused:true};
    const prior=summaries('source').find(s=>s.seriesId===source.seriesId);if(prior&&!equal(sourceIdentity(get('source',prior.id)),sourceIdentity(source)))fail('SOURCE_SERIES_MISMATCH','Use a new source series when role, format or original endpoint changes.',409);
    save('source',source);return {source:sourceSummary(source),reused:false};
  });}
  function putProfile(input){return mutate('profile-save',input,(value)=>{
    const profile=normalizeProfile(value.profile),existing=find('profile',profile.key);
    if(existing){assertSame(existing,profile,'PROFILE_REVISION_CONFLICT','This immutable profile revision already has different mappings.');return {profile:copy(existing),reused:true};}
    const revisions=summaries('profile').filter(p=>p.id===profile.id),maximum=Math.max(0,...revisions.map(p=>p.revision));
    if(profile.revision!==maximum+1)fail('PROFILE_REVISION_GAP','Save the next consecutive revision of this profile.',409,{nextRevision:maximum+1});
    save('profile',profile);return {profile:copy(profile),reused:false};
  });}
  function build(input){return mutate('edition-build',input,(value,identity)=>{
    const definition=normalizeDefinition(value.definition),edition=buildEdition(definition,get('source',definition.requestSourceId),definition.orderSourceId?get('source',definition.orderSourceId):null,get('profile',definition.profileId),identity);
    const prior=summaries('edition').find(e=>e.seriesId===edition.seriesId);
    if(prior){const previous=get('edition',prior.id),source=get('source',edition.requestSourceId),oldSource=get('source',previous.requestSourceId);if(source.seriesId!==oldSource.seriesId)fail('EDITION_SOURCE_SERIES_CHANGED','Use a new follow-through series for a different request source identity.',409);}
    save('edition',edition);return {edition:editionSummary(edition)};
  });}
  function putLink(input){return mutate('link-review',input,(value,identity)=>{const selection=object(value.selection,'Relationship selection'),edition=get('edition',selection.editionId),link=createLink(edition,selection,identity);save('link',link);return {link:copy(link)};});}
  function putWork(input){return mutate('work-save',input,(value,identity)=>{
    const supplied=object(value.work,'Follow-up work'),edition=get('edition',supplied.editionId),ctx=context(edition),work=createWork(edition,supplied,identity,{previous:currentWork(edition,supplied.key,ctx.work),links:ctx.links});save('work',work);return {work:workSummary(work)};
  });}
  function importReview(input){return mutate('review-import',input,(value,identity)=>{
    if(typeof value.originalText!=='string'||Buffer.byteLength(value.originalText)>MAX_SOURCE_BYTES)fail('REVIEW_FILE_SIZE','Use the complete reviewer file of at most 128 MiB.',413);
    const parsed=parseJson(value.originalText,'Reviewer file'),base=get('edition',parsed.baseEditionId),returned=createReturn(value.originalText,base,get('profile',base.profileId),context(base),identity);save('return',returned);return {returned:returnSummary(returned)};
  });}
  function applyReviewSelection(input){return mutate('review-apply',input,(value,identity)=>{
    const selection=object(value.selection,'Reviewer selection'),returned=get('return',selection.returnId),edition=get('edition',selection.targetEditionId),result=applyReview(returned,edition,selection,identity,context(edition));
    save('decision',result.decision);for(const link of result.links)save('link',link);for(const work of result.work)save('work',work);
    return {decision:copy(result.decision),returned:returnSummary(returned,all('decision')),work:result.work.map(workSummary),links:result.links.map(copy)};
  });}
  function putDispatch(input){return mutate('dispatch-create',input,(value,identity)=>{const definition=object(value.definition,'Reviewed dispatch definition'),edition=get('edition',definition.editionId),dispatch=createDispatch(edition,definition,identity,context(edition));save('dispatch',dispatch);return {dispatch:dispatchSummary(dispatch)};});}
  function source(id){return transaction(()=>sourceDetail(get('source',id)));}
  function sourceRows({id,q='',offset,limit}={}){return transaction(()=>page(search(originalRows(get('source',id)),q,row=>[row.attributes]),{offset,limit}));}
  function profile(id){return transaction(()=>get('profile',id));}
  function edition(id){return transaction(()=>{const value=get('edition',id);return {...editionSummary(value),definition:copy(value.definition),coverage:copy(value.coverage)};});}
  function projections(value){const profile=get('profile',value.profileId),ctx=context(value),byRequest=new Map();for(const link of ctx.links){const list=byRequest.get(link.key)??[];list.push(link);byRequest.set(link.key,list);}const workByRequest=new Map();for(const work of ctx.work){const list=workByRequest.get(work.key)??[];list.push(work);workByRequest.set(work.key,list);}
    return value.requests.map(row=>projectRequest(value,profile,row,{links:byRequest.get(row.key)??[],work:workByRequest.get(row.key)??[]}));}
  function requests({editionId,q='',discrepancy='',assignee='',workStatus='',offset,limit}={}){
    return transaction(()=>{const value=get('edition',editionId);let rows=search(projections(value),q,row=>[row.serviceRequestId,row.title,row.description,row.sourceStatus,row.referenceValues,row.work?.assignee??'']);
      if(discrepancy)rows=rows.filter(row=>row.discrepancies.some(d=>d.code===discrepancy));if(assignee)rows=rows.filter(row=>row.work?.assignee===assignee);if(workStatus)rows=rows.filter(row=>(row.work?.status??'new')===workStatus);
      const result=page(rows,{offset,limit});return {...result,items:result.items.map(compactRequest)};});
  }
  function orders({editionId,q='',offset,limit}={}){return transaction(()=>page(search(get('edition',editionId).orders,q,row=>[row.workOrderId,row.title,row.description,row.sourceStatus,row.referenceValues]),{offset,limit}));}
  function request({editionId,key}={}){
    return transaction(()=>{const edition=get('edition',editionId),row=requestRow(edition,key),ctx=context(edition),selected=projectRequest(edition,get('profile',edition.profileId),row,ctx);
      return {edition:editionSummary(edition),request:selected,candidates:(edition.candidateLinks.find(r=>r.key===key)?.candidates??[]).map(c=>({order:copy(orderRow(edition,c.orderKey)),matches:copy(c.matches)})),
        links:effectiveLinks(edition,row,ctx.links),discrepancies:copy(selected.discrepancies),work:selected.work,history:ctx.work.filter(w=>w.key===key).map(copy)};});
  }
  function changes({before,after,entity='requests',offset,limit}={}){
    return transaction(()=>{
      const previous=get('edition',before),current=get('edition',after),sourceKey=entity==='orders'?'orderSourceId':'requestSourceId';
      const metadataNames=edition=>{if(!edition[sourceKey])return [];const source=get('source',edition[sourceKey]),metadata=source.metadata;
        if(metadata?.uniqueIdInfo?.OIDFieldContainsHashValue!==true)return [];
        return source.fields.filter(field=>field.type==='esriFieldTypeOID').map(field=>field.name);};
      const left=new Set(metadataNames(previous)),sourceMetadataFields=metadataNames(current).filter(name=>left.has(name));
      const result=compareEditions(previous,current,{entity,sourceMetadataFields});
      return {...page(result.items,{offset,limit}),entity:result.entity,summary:result.summary,before:result.before,after:result.after,scope:result.scope};
    });
  }
  function work(id){return transaction(()=>{const value=get('work',id);return {work:copy(value),history:all('work',value.seriesId).filter(w=>w.key===value.key).map(copy)};});}
  function workQueue({editionId,approval='',assignee='',status='',q='',offset,limit}={}){
    return transaction(()=>{const edition=get('edition',editionId);let rows=projections(edition).filter(row=>row.work).map(row=>({...workSummary(row.work),serviceRequestId:row.serviceRequestId,title:row.title,actionNote:row.work.actionNote,sourceChanged:row.work.sourceChanged,orderChanged:row.work.orderChanged,coordinateChanged:row.work.coordinateChanged,approvalCurrent:row.work.approvalCurrent,selectedEditionId:edition.id,geometry:copy(row.geometry)}));
      if(approval==='approved')rows=rows.filter(row=>row.approvalCurrent&&!['done','dismissed'].includes(row.status));else if(approval)rows=rows.filter(row=>row.approval===approval);
      if(assignee)rows=rows.filter(row=>row.assignee===assignee);if(status)rows=rows.filter(row=>row.status===status);
      return page(search(rows,q,row=>[row.serviceRequestId,row.title,row.assignee,row.action,row.actionNote]),{offset,limit});});
  }
  function returned(id,{targetEditionId}={}){
    return transaction(()=>{const value=get('return',id);if(targetEditionId&&get('edition',targetEditionId).seriesId!==value.seriesId)fail('REVIEW_TARGET_MISMATCH','Choose a target edition of the original reviewer series.');const decisions=all('decision').filter(d=>d.returnId===id),head=summaries('edition').find(e=>e.seriesId===value.seriesId),target=get('edition',targetEditionId??head?.id??value.baseEditionId),ctx=context(target),byProposal=new Map();for(const decision of decisions){for(const id of decision.accept)byProposal.set(id,{status:'accepted',decision});for(const id of decision.reject)byProposal.set(id,{status:'rejected',decision});}
      return {...returnSummary(value,decisions),originalFile:copy(value.originalFile),baseEditionSha256:value.baseEditionSha256,notes:value.notes,targetEditionId:target.id,
        proposals:value.proposals.map(p=>({...copy(p),conflicts:proposalConflicts(p,target,ctx),status:byProposal.get(p.id)?.status??'pending',decision:byProposal.get(p.id)?.decision??null})),decisions:copy(decisions)};});
  }
  function dispatch(id){return transaction(()=>{const value=get('dispatch',id);return {dispatch:dispatchSummary(value),definition:copy(value.definition),rows:copy(value.rows),coverage:copy(value.coverage)};});}
  function requireRevision(value){if(value!==undefined&&(!Number.isSafeInteger(value)||value!==metadata().revision))fail('REVISION_CONFLICT','The selected export revision changed. Refresh before exporting.',409,{actualRevision:metadata().revision});}
  function packageInside(){
    const meta=metadata(),records=db.prepare('SELECT kind,id,value FROM records ORDER BY seq').all().map(row=>({kind:row.kind,id:row.id,value:JSON.parse(row.value)}));
    const operations=db.prepare('SELECT request_id FROM operations ORDER BY seq').all().map(row=>operation(row.request_id));
    return seal({schema:WORKSPACE_SCHEMA,workspaceId:meta.workspaceId,revision:meta.revision,createdAt:meta.createdAt,updatedAt:meta.updatedAt,exportedAt:meta.updatedAt,records,operations,receivedFrom:copy(meta.receivedFrom)});
  }
  function workspaceExport({expectedRevision}={}){return transaction(()=>{requireRevision(expectedRevision);return packageInside();});}
  function exportFile({kind='workspace',sourceId,editionId,dispatchId,fileId,returnId,expectedRevision}={}){
    return transaction(()=>{
      requireRevision(expectedRevision);const selected=[sourceId,editionId,dispatchId,returnId].filter(v=>v!==undefined&&v!==null&&v!=='');let file;
      if(kind==='workspace'){if(selected.length||fileId)fail('EXPORT_SELECTION_CONFLICT','A complete workspace export does not select an item.');const bundle=packageInside();file=fileResult('open311-follow-through-'+bundle.workspaceId+'.json','application/json; charset=utf-8',canonical(bundle)+'\n');}
      else if(kind==='source'){if(selected.length!==1||!sourceId)fail('SOURCE_SELECTION_REQUIRED','Choose the complete original source file.');const original=sourceOriginalFile(get('source',sourceId),fileId);file=fileResult(original.filename,original.contentType,original.body);}
      else if(kind==='returned'){if(selected.length!==1||!returnId)fail('RETURN_SELECTION_REQUIRED','Choose an original reviewer file.');file=fileResult(returnId+'.json','application/json; charset=utf-8',get('return',returnId).originalText);}
      else if(kind.startsWith('dispatch-')){
        if(selected.length!==1||!dispatchId)fail('DISPATCH_SELECTION_REQUIRED','Choose one complete saved dispatch.');const value=get('dispatch',dispatchId),format=kind.slice(9);
        if(format==='json')file=fileResult(value.id+'.json','application/json; charset=utf-8',canonical(value)+'\n');
        else if(format==='csv')file=fileResult(value.id+'.csv','text/csv; charset=utf-8',dispatchCsv(value));
        else if(format==='geojson')file=fileResult(value.id+'.geojson','application/geo+json; charset=utf-8',canonical(dispatchGeoJson(value))+'\n');
        else fail('INVALID_EXPORT_KIND','Choose dispatch-json, dispatch-csv or dispatch-geojson.');
      }else{
        if(selected.length!==1||!editionId)fail('EDITION_SELECTION_REQUIRED','Choose one saved follow-through edition.');const value=get('edition',editionId),profile=get('profile',value.profileId),ctx=context(value),sources=[get('source',value.requestSourceId),...(value.orderSourceId?[get('source',value.orderSourceId)]:[])];
        if(kind==='edition')file=fileResult(value.id+'.json','application/json; charset=utf-8',canonical(seal({schema:'commons.open311.follow-through-edition-export.v1',edition:value,profile,sources,links:ctx.links,work:ctx.work,decisions:ctx.decisions}))+'\n');
        else if(kind==='review')file=fileResult(value.id+'-review.json','application/json; charset=utf-8',JSON.stringify(reviewTemplate(value,profile,ctx),null,2)+'\n');
        else if(kind==='requests-csv')file=fileResult(value.id+'-requests.csv','text/csv; charset=utf-8',requestCsv(projections(value)));
        else if(kind==='report')file=fileResult(value.id+'.html','text/html; charset=utf-8',htmlReport(value,profile,projections(value),{sources,dispatches:all('dispatch',value.seriesId)}));
        else fail('INVALID_EXPORT_KIND','Choose source, edition, requests-csv, review, dispatch-json, dispatch-csv, dispatch-geojson, report or workspace.');
      }
      if(file.bytes>MAX_PACKAGE_BYTES)fail('EXPORT_SIZE','The complete export exceeds 256 MiB.',413);return file;
    });
  }
  function receive(supplied){
    object(supplied,'Receiving action');const inputControl=control({requestId:supplied.requestId,expectedRevision:supplied.expectedRevision}),originalText=supplied.originalText;
    if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive a complete follow-through package of at most 256 MiB.',413);
    const originalFile={sha256:digest(originalText),bytes:Buffer.byteLength(originalText)},descriptor=sha256=>({...inputControl,originalFile,incomingPackageSha256:sha256,...(supplied.hostInput!==undefined?{hostInput:copy(supplied.hostInput)}:{})});
    const prior=operation(inputControl.requestId);if(prior){const candidate=descriptor(prior.input.incomingPackageSha256??'');if(prior.kind!=='workspace-receive'||prior.inputSha256!==fingerprint('workspace-receive',candidate))fail('REQUEST_ID_CONFLICT','This receiving request ID names another original file or action.',409);return prior.result;}
    const bundle=validateWorkspacePackage(originalText),input=descriptor(bundle.sha256),inputSha256=fingerprint('workspace-receive',input);
    if(bundle.operations.some(op=>op.requestId===input.requestId))fail('REQUEST_ID_CONFLICT','Use a receiving request ID distinct from the imported original operations.',409);
    return transaction(()=>{
      const existing=operation(input.requestId);if(existing){if(existing.kind!=='workspace-receive'||existing.inputSha256!==inputSha256)fail('REQUEST_ID_CONFLICT','This receiving ID names another action.',409);return existing.result;}
      const previous=metadata();if(input.expectedRevision!==previous.revision)fail('REVISION_CONFLICT','The receiving workspace changed.',409,{actualRevision:previous.revision});
      if(previous.revision!==0||db.prepare('SELECT COUNT(*) AS count FROM records').get().count)fail('RECEIVING_WORKSPACE_NOT_EMPTY','Receive into an initialized empty follow-through workspace.',409);
      for(const record of bundle.records)save(record.kind,record.value);
      const insert=db.prepare('INSERT INTO operations(request_id,kind,input_sha,input,result,created_at) VALUES(?,?,?,?,?,?)');for(const op of bundle.operations)insert.run(op.requestId,op.kind,op.inputSha256,canonical(op.input),canonical(op.result),op.createdAt);
      const receivedAt=now(),meta={schema:DATABASE_SCHEMA,workspaceId:bundle.workspaceId,revision:bundle.revision+1,createdAt:bundle.createdAt,updatedAt:receivedAt,receivedFrom:[...copy(bundle.receivedFrom),{workspaceId:bundle.workspaceId,revision:bundle.revision,packageSha256:bundle.sha256,originalFile:copy(originalFile),receivedAt,destinationInitializationId:previous.workspaceId}]};saveMeta(meta);
      const result={workspaceId:meta.workspaceId,revision:meta.revision,requestId:input.requestId,originalWorkspaceId:bundle.workspaceId,originalRevision:bundle.revision,packageSha256:bundle.sha256,originalFile:copy(originalFile),records:bundle.records.length};
      insert.run(input.requestId,'workspace-receive',inputSha256,canonical(input),canonical(result),receivedAt);return result;
    },true);
  }
  return {directory,state,operation,inspectSource,importSource,putProfile,build,putLink,putWork,importReview,applyReview:applyReviewSelection,putDispatch,source,sourceRows,profile,edition,requests,request,orders,changes,work,workQueue,returned,dispatch,workspaceExport,exportFile,receive,close(){if(!closed){closed=true;db.close();}}};
}
export function receiveWorkspace(directory,originalText,input={}){const workspace=openWorkspace(directory);try{return workspace.receive({requestId:input.requestId??entityId('receive',{sha256:digest(originalText)}),expectedRevision:input.expectedRevision??0,originalText});}finally{workspace.close();}}
