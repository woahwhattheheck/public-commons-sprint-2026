// MIT. Retained federal opportunities, analyst workshares and original dataset publishing.
import { mkdir, rename, lstat, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile,
  atomicJson, bytes, digest, identity, fault, object, absolute } from '../postgres/publisher/files.mjs';
import { normalizeQuery, DATASET_COLUMNS, ATTRIBUTION } from './source.mjs';
import { captureGrants, readCapture, exportCapture, importCapture, readCaptureExport } from './capture.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.grantsgov-workspace.v1';
export const REVIEW_FIELDS = Object.freeze(['status','owner','fit','eligibilityAssessment',
  'partner','workshare','deliverables','acceptance','schedule','fee','nextAction','notes']);
export const REVIEW_STATUSES = Object.freeze(['researching','qualified','preparing','ready','passed']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const MiB = 1024 * 1024;
const stamp = () => new Date().toISOString();
const clone = value => structuredClone(value);
const compareFields = DATASET_COLUMNS.filter(name => !['source_observed_at','source_data_sha256'].includes(name))
  .concat(['description','eligibility','funding','dates','attachment_manifest','package_manifest','revision_history']);
const csvCell = value => value === null || value === undefined ? '' :
  /[",\r\n]/.test(String(value)) ? '"' + String(value).replaceAll('"','""') + '"' : String(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function requireId(value, name = 'saved item') {
  if (typeof value !== 'string' || !ID.test(value)) throw fault('SAVED_ID_REQUIRED','Choose an original '+name+'.');
  return value;
}
function title(value, maximum = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw fault('TITLE_REQUIRED','Enter a title of at most '+maximum+' characters.');
  return value.trim();
}
function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw fault('INTEGER_REQUIRED', name+' must be from '+minimum+' to '+maximum+'.');
  return value;
}
function record(map, id, name) {
  requireId(id,name); const value = map[id];
  if (!value) throw fault('SAVED_ITEM_MISSING','The selected '+name+' is not in this workspace.',404);
  return value;
}
function expected(value, revision) {
  if (value.revision !== revision)
    throw fault('REVISION_CHANGED','This saved record changed. Refresh it before saving your edits.',409);
}
function signed(value) { const result=clone(value); result.sha256=identity(value); return result; }
function verified(value, schema) {
  if (!object(value) || value.schema !== schema || !HASH.test(value.sha256 ?? ''))
    throw fault('PORTABLE_FORMAT_INVALID','Choose a complete original portable file.');
  const unsigned={...value}; delete unsigned.sha256;
  if (identity(unsigned) !== value.sha256) throw fault('PORTABLE_CONTENT_CHANGED','The retained content differs from its original digest.',409);
  return value;
}
async function immutable(path, data) {
  try { await createFile(path,data); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readPrivate(path,Math.max(data.length+1,MiB))).equals(data))
      throw fault('RETAINED_FILE_CHANGED','The existing retained file has different bytes.',409);
  }
}
async function absent(path) {
  try { await lstat(path); return false; } catch (error) { if(error.code==='ENOENT')return true; throw error; }
}
function captureView(capture) {
  return {captureId:capture.captureId,operationId:capture.operationId,status:capture.status,
    startedAt:capture.startedAt,completedAt:capture.completedAt ?? null,
    coverage:capture.coverage,sourceSignature:capture.sourceSignature,
    pages:capture.pages?.length ?? 0,details:capture.details?.length ?? 0,
    opportunities:capture.opportunities?.length ?? 0};
}
function editionView(edition) { const {rows,...summary}=edition; return {...summary,rowCount:rows.length}; }
function rowSummary(row) {
  return Object.fromEntries(DATASET_COLUMNS.map(name=>[name,row[name] ?? null]));
}
function page(items,{offset=0,limit=50,expectedSnapshot}={}) {
  integer(offset,0,10000000,'Offset'); integer(limit,1,250,'Page size');
  const snapshot=identity(items);
  if (expectedSnapshot !== undefined && expectedSnapshot !== snapshot)
    throw fault('PAGE_CHANGED','The saved list changed. Start again from its first page.',409);
  return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,snapshot,
    nextOffset:offset+limit<items.length?offset+limit:null};
}

/** The original kernel file lock owns one metadata writer. Provider capture keeps
 * its original page/detail journal; native dataset and buyer engines own publishing. */
export async function openGrantsWorkspace({directory,transport,buyerWorkspaces=[]}={}) {
  directory=absolute(directory,'private Grants.gov workspace directory');
  await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory);
  const roots=Object.fromEntries(['captures','editions','edition-sources','exports','merchants'].map(name=>[name,join(directory,name)]));
  let state,tail=Promise.resolve(),closing=false,closed=false,closePromise,publisher;
  const jobs=new Map();
  const buyers=new Map(buyerWorkspaces.map(binding=>[requireId(binding.id,'buyer workspace'),binding.directory]));
  try {
    for(const path of Object.values(roots))await privateDirectory(path,true);
    const statePath=join(directory,'workspace.json');
    if(await absent(statePath)) {
      state={schema:WORKSPACE_SCHEMA,id:'GW-'+randomUUID(),revision:1,name:'Federal Grant Opportunities',
        createdAt:stamp(),updatedAt:stamp(),queries:{},captures:{},editions:{},reviews:{},
        exports:{},merchants:{},requests:{},restoreSha256:null};
      await atomicJson(directory,'workspace.json',state);
    } else state=await readJson(statePath,32*MiB);
    if(state.schema!==WORKSPACE_SCHEMA || !ID.test(state.id) || !Number.isSafeInteger(state.revision) ||
      ['queries','captures','editions','reviews','exports','merchants','requests'].some(key=>!object(state[key])))
      throw fault('WORKSPACE_FORMAT_INVALID','Open the original Grants.gov workspace.');
    let recovered=false;
    for(const entry of Object.values(state.captures)) if(entry.status==='running') {
      entry.status='interrupted'; entry.updatedAt=stamp(); recovered=true;
    }
    if(recovered){state.revision++;state.updatedAt=stamp();await atomicJson(directory,'workspace.json',state);}
  } catch(error) {await unlock();throw error;}
  function serial(fn,internal=false) {
    if(closed || closing&&!internal)return Promise.reject(fault('WORKSPACE_CLOSED','Reopen the original workspace.',409));
    const next=tail.catch(()=>{}).then(fn);tail=next;return next;
  }
  function update(fn) {
    return serial(async()=>{
      const next=clone(state), result=await fn(next);
      next.revision++;next.updatedAt=stamp();
      await atomicJson(directory,'workspace.json',next);state=next;return clone(result);
    },true);
  }
  function mutate(action,input,fn) {
    if(!object(input))return Promise.reject(fault('ACTION_INPUT_REQUIRED'));
    const requestId=requireId(input.requestId,'request ID'),key=action+':'+requestId,inputSha256=identity(input);
    return serial(async()=>{
      const prior=state.requests[key];
      if(prior) {
        if(prior.inputSha256!==inputSha256)throw fault('REQUEST_ID_REUSED','This request ID belongs to different saved input.',409);
        return clone(prior.result);
      }
      const next=clone(state),result=await fn(next);
      next.requests[key]={inputSha256,result,at:stamp()};next.revision++;next.updatedAt=stamp();
      await atomicJson(directory,'workspace.json',next);state=next;return clone(result);
    });
  }
  const captureDirectory=id=>join(roots.captures,requireId(id,'capture'));
  async function edition(id) {
    const summary=record(state.editions,id,'edition');
    const value=verified(await readJson(join(roots.editions,id+'.json'),128*MiB),WORKSPACE_SCHEMA+'.edition');
    if(value.id!==id || value.sha256!==summary.sha256)throw fault('EDITION_CHANGED','The original edition differs.',409);
    return value;
  }
  async function nativeCapture(id) {
    const binding=record(state.captures,id,'capture'),value=await readCapture(captureDirectory(id));
    if(binding.nativeCaptureId && binding.nativeCaptureId!==value.captureId)
      throw fault('CAPTURE_ID_CHANGED','The original provider capture differs.',409);
    if(binding.status==='complete' && binding.sourceSignature && binding.sourceSignature!==value.sourceSignature)
      throw fault('CAPTURE_SOURCE_CHANGED','The completed capture differs from its saved source.',409);
    return value;
  }
  async function editionSource(value) {
    const source=await readJson(join(roots['edition-sources'],value.sourcePacketSha256+'.json'),256*MiB);
    if(source.sha256!==value.sourcePacketSha256)throw fault('EDITION_SOURCE_CHANGED');
    const capture=readCaptureExport(source);
    if(capture.captureId!==value.nativeCaptureId||capture.sourceSignature!==value.sourceSignature)
      throw fault('EDITION_SOURCE_BINDING_CHANGED');
    return source;
  }
  function verifyEditionSource(value,packet) {
    verified(value,WORKSPACE_SCHEMA+'.edition');requireId(value.id,'edition');requireId(value.captureId,'capture');
    if(!HASH.test(value.sourcePacketSha256??'')||packet.sha256!==value.sourcePacketSha256||
      !Array.isArray(value.rows)||!value.rows.length||identity(value.columns)!==identity(DATASET_COLUMNS))
      throw fault('EDITION_SOURCE_INVALID');
    const source=readCaptureExport(packet),rows=new Map(source.opportunities.map(row=>[row.opportunity_id,row]));
    if(value.nativeCaptureId!==source.captureId||value.sourceSignature!==source.sourceSignature)
      throw fault('EDITION_SOURCE_BINDING_CHANGED');
    const ids=new Set();
    for(const row of value.rows){
      if(ids.has(row.opportunity_id)||!rows.has(row.opportunity_id)||identity(rows.get(row.opportunity_id))!==identity(row))
        throw fault('EDITION_OPPORTUNITY_CHANGED','Every saved opportunity must match its exact original source.');
      ids.add(row.opportunity_id);
    }
    const coverage={...source.coverage,selectedOpportunities:ids.size,
      currentEditionCompleteCohort:ids.size===source.opportunities.length&&source.coverage.searchComplete};
    if(identity(value.coverage)!==identity(coverage))throw fault('EDITION_COVERAGE_CHANGED');
    return source;
  }
  async function retainSource(packet) {
    readCaptureExport(packet);
    await immutable(join(roots['edition-sources'],packet.sha256+'.json'),bytes(packet));
    return packet;
  }
  async function capturePacket(id) {
    const source=await nativeCapture(id),manifest=await readPrivate(join(captureDirectory(id),'capture.json'),32*MiB);
    for(const value of Object.values(state.editions).filter(value=>value.captureId===id&&value.sourceSignature===source.sourceSignature)) {
      const packet=await editionSource(value);
      if(packet.manifest.sha256===digest(manifest))return packet;
    }
    return retainSource(await exportCapture(captureDirectory(id)));
  }
  async function createEdition(input) {
    return mutate('edition.create',input,async next=>{
      let packet,all,captureId=input.captureId;
      if(input.sourceEditionId){
        const original=await edition(input.sourceEditionId);packet=await editionSource(original);all=original.rows;
        if(captureId!==undefined&&captureId!==original.captureId)throw fault('EDITION_CAPTURE_DIFFERS');
        captureId=original.captureId;
      }else{packet=await capturePacket(captureId);all=readCaptureExport(packet).opportunities;}
      const capture=readCaptureExport(packet),ids=input.opportunityIds;
      if(ids!==undefined&&(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length))
        throw fault('OPPORTUNITY_SELECTION_REQUIRED','Select distinct original opportunity IDs.');
      const selected=ids?all.filter(row=>ids.includes(row.opportunity_id)):all;
      if(!selected.length||ids&&selected.length!==ids.length)
        throw fault('OPPORTUNITY_SELECTION_MISSING','Every selected opportunity must belong to this original source edition.');
      const value=signed({schema:WORKSPACE_SCHEMA+'.edition',id:'GE-'+randomUUID(),
        name:title(input.name??'Grant opportunities'),createdAt:stamp(),kind:ids?'selection':'capture',
        parentId:input.parentId??input.sourceEditionId??null,captureId,nativeCaptureId:capture.captureId,
        sourceSignature:capture.sourceSignature,sourcePacketSha256:packet.sha256,
        coverage:{...capture.coverage,selectedOpportunities:selected.length,
          currentEditionCompleteCohort:selected.length===capture.opportunities.length&&capture.coverage.searchComplete},
        columns:DATASET_COLUMNS,rows:selected});
      if(value.parentId)await edition(value.parentId);
      verifyEditionSource(value,packet);await retainSource(packet);
      await immutable(join(roots.editions,value.id+'.json'),bytes(value));
      next.editions[value.id]=editionView(value);return editionView(value);
    });
  }
  async function captureStatus(id) {
    const binding=clone(record(state.captures,id,'capture'));
    const job=jobs.get(id);if(job?.progress)return {...binding,running:true,progress:clone(job.progress)};
    try{return {...binding,native:captureView(await nativeCapture(id)),running:jobs.has(id)};}
    catch(error){if(binding.status==='queued'||error.code==='ENOENT')return {...binding,running:jobs.has(id)};
      return {...binding,running:jobs.has(id),readError:{code:error.code ?? 'CAPTURE_READ_FAILED',message:error.message}};}
  }
  async function startCapture(input) {
    const selected=await mutate('capture.start',input,async next=>{
      if(input.captureId) {
        const previous=record(next.captures,input.captureId,'capture');
        if(jobs.has(previous.id)||previous.status==='complete')return previous;
        previous.status='running';previous.updatedAt=stamp();delete previous.error;return previous;
      }
      const query=record(next.queries,input.queryId,'query');expected(query,input.expectedRevision);
      const id='GC-'+randomUUID(),operationId=input.operationId ?? input.requestId;
      requireId(operationId,'capture operation');
      const previous=Object.values(next.captures).find(c=>c.operationId===operationId);
      if(previous)throw fault('CAPTURE_OPERATION_EXISTS','Resume the original capture '+previous.id+'.',409);
      const value={id,operationId,queryId:query.id,queryRevision:query.revision,query:query.definition,
        name:query.name,status:'running',createdAt:stamp(),updatedAt:stamp(),nativeCaptureId:null,sourceSignature:null,
        includeDetails:input.includeDetails!==false,maxPages:input.maxPages ?? 10000,maxOpportunities:input.maxOpportunities ?? 250000};
      integer(value.maxPages,1,10000,'Page capacity');integer(value.maxOpportunities,query.definition.pageSize,250000,'Opportunity capacity');
      next.captures[id]=value;return value;
    });
    const current=record(state.captures,selected.id,'capture');
    if(jobs.has(current.id)||current.status==='complete')return captureStatus(current.id);
    const controller=new AbortController(),job={id:current.id,startedAt:stamp(),controller,promise:null};
    jobs.set(current.id,job);
    job.promise=(async()=>{
      try {
        const result=await captureGrants({directory:captureDirectory(current.id),query:current.query,
          operationId:current.operationId,transport,signal:controller.signal,includeDetails:current.includeDetails,
          maxPages:current.maxPages,maxOpportunities:current.maxOpportunities,
          onProgress:progress=>{job.progress=clone(progress);}});
        await update(next=>{
          const c=next.captures[current.id];Object.assign(c,{status:'captured',updatedAt:stamp(),
            nativeCaptureId:result.captureId,sourceSignature:result.sourceSignature,native:captureView(result)});return c;
        });
        const saved=await createEdition({requestId:current.id+':complete-edition',captureId:current.id,name:current.name});
        await update(next=>{
          const c=next.captures[current.id];Object.assign(c,{status:result.status==='completed'?'complete':'partial',editionId:saved.id,updatedAt:stamp()});
          delete c.error;return c;
        });
      } catch(error) {
        let retained;try{retained=await readCapture(captureDirectory(current.id));}catch{}
        await update(next=>{
          const c=next.captures[current.id];
          if(retained)Object.assign(c,{nativeCaptureId:retained.captureId,sourceSignature:retained.sourceSignature,native:captureView(retained)});
          c.status=controller.signal.aborted?'paused':'interrupted';
          c.error={code:error.code??'GRANTS_CAPTURE_FAILED',message:error.message,at:stamp()};c.updatedAt=stamp();return c;
        });
      } finally {jobs.delete(current.id);}
    })();
    job.promise.catch(()=>{});
    return {...clone(current),running:true};
  }
  async function waitCapture(id) {
    requireId(id,'capture');const job=jobs.get(id);if(job)await job.promise;
    return captureStatus(id);
  }
  async function pauseCapture(id) {
    const job=jobs.get(requireId(id,'capture'));
    if(job){job.controller.abort(fault('CAPTURE_PAUSED','The operator paused this original capture.'));await job.promise;}
    return captureStatus(id);
  }
  async function importOriginal(input) {
    return mutate('capture.import',input,async next=>{
      if(!input.packet)throw fault('SOURCE_PACKET_REQUIRED','Choose the complete original grant capture.');
      const source=readCaptureExport(input.packet);
      const prior=Object.values(next.captures).find(c=>c.sourceSignature===source.sourceSignature);
      if(prior)return prior;
      const id='GC-'+randomUUID();await importCapture(captureDirectory(id),input.packet);
      const value={id,name:title(input.name??'Imported grant source'),status:source.status==='completed'?'complete':'partial',
        createdAt:stamp(),updatedAt:stamp(),operationId:source.operationId,nativeCaptureId:source.captureId,
        sourceSignature:source.sourceSignature,query:source.query,queryId:null,queryRevision:null,
        includeDetails:source.includeDetails,maxPages:10000,maxOpportunities:250000,native:captureView(source)};
      await retainSource(input.packet);next.captures[id]=value;return value;
    });
  }
  function verifyReview(review,editions) {
    if(!object(review)||!object(review.data)||!Number.isSafeInteger(review.revision)||review.revision<1||
      !Array.isArray(review.history)||!REVIEW_STATUSES.includes(review.data.status)||
      Object.keys(review.data).some(key=>!REVIEW_FIELDS.includes(key))||
      REVIEW_FIELDS.some(key=>typeof review.data[key]!=='string'||review.data[key].length>32000))
      throw fault('RECEIVING_REVIEW_INVALID');
    for(const value of [...review.history,review]){
      const edition=editions.get(value.editionId);
      const row=edition?.rows.find(row=>row.opportunity_id===review.opportunityId);
      if(!row||edition.sha256!==value.editionSha256||!Number.isSafeInteger(value.revision)||value.revision<1||
        !object(value.data)||REVIEW_FIELDS.some(key=>typeof value.data[key]!=='string')||
        !REVIEW_STATUSES.includes(value.data.status))
        throw fault('RECEIVING_REVIEW_BINDING');
      if(value.sourceDataSha256!==undefined&&row.source_data_sha256!==value.sourceDataSha256)
        throw fault('RECEIVING_REVIEW_SOURCE_CHANGED');
    }
  }
  async function receiveEdition(input) {
    const packet=verified(input.packet,WORKSPACE_SCHEMA+'.edition-package');
    return mutate('edition.receive',input,async next=>{
      if(!Array.isArray(packet.editions)||!object(packet.sourcePackets)||!Array.isArray(packet.reviews))
        throw fault('EDITION_PACKAGE_INVALID');
      const editions=new Map(),sources=new Map();
      for(const item of packet.editions){
        if(editions.has(item.id))throw fault('EDITION_PACKAGE_DUPLICATE');
        const original=packet.sourcePackets[item.sourcePacketSha256];
        if(!original)throw fault('EDITION_SOURCE_MISSING');
        const source=verifyEditionSource(item,original);editions.set(item.id,item);sources.set(item.sourcePacketSha256,source);
        const existing=next.editions[item.id];
        if(existing&&existing.sha256!==item.sha256)throw fault('RECEIVING_EDITION_CONFLICT');
      }
      if(!editions.has(packet.editionId))throw fault('EDITION_PACKAGE_SELECTION_MISSING');
      for(const item of editions.values())if(item.parentId&&!editions.has(item.parentId)&&!next.editions[item.parentId])
        throw fault('EDITION_PARENT_MISSING');
      const reviews=new Set();
      for(const review of packet.reviews){
        verifyReview(review,editions);
        if(reviews.has(review.opportunityId))throw fault('RECEIVING_REVIEW_DUPLICATE');
        reviews.add(review.opportunityId);
        if(next.reviews[review.opportunityId]&&identity(next.reviews[review.opportunityId])!==identity(review))
          throw fault('RECEIVING_REVIEW_CONFLICT','Preserve the receiving workspace’s saved qualification or receive this edition into a new workspace.',409);
      }
      for(const item of editions.values()){
        const source=sources.get(item.sourcePacketSha256),original=packet.sourcePackets[item.sourcePacketSha256];
        await retainSource(original);
        const existing=next.captures[item.captureId];
        if(existing&&existing.nativeCaptureId!==source.captureId)throw fault('RECEIVING_CAPTURE_CONFLICT');
        if(!existing){
          await importCapture(captureDirectory(item.captureId),original);
          next.captures[item.captureId]={id:item.captureId,name:item.name,status:source.status==='completed'?'complete':'partial',
            createdAt:stamp(),updatedAt:stamp(),operationId:source.operationId,nativeCaptureId:source.captureId,
            sourceSignature:source.sourceSignature,query:source.query,queryId:null,queryRevision:null,
            includeDetails:source.includeDetails,maxPages:10000,maxOpportunities:250000,native:captureView(source)};
        }
        await immutable(join(roots.editions,item.id+'.json'),bytes(item));next.editions[item.id]=editionView(item);
      }
      for(const review of packet.reviews)next.reviews[review.opportunityId]=clone(review);
      return {...editionView(editions.get(packet.editionId)),received:true,editions:editions.size,reviews:reviews.size};
    });
  }
  async function querySave(input) {
    return mutate('query.save',input,async next=>{
      const id=input.id??'GQ-'+randomUUID(),prior=next.queries[id];
      requireId(id,'query');
      if(prior)expected(prior,input.expectedRevision);
      else if(input.expectedRevision!==0)throw fault('NEW_QUERY_REVISION','A new query uses revision zero.');
      const value={id,name:title(input.name),definition:normalizeQuery(input.definition),revision:(prior?.revision??0)+1,
        createdAt:prior?.createdAt??stamp(),updatedAt:stamp()};
      next.queries[id]=value;return value;
    });
  }
  async function reviewSave(input) {
    return mutate('review.save',input,async next=>{
      const source=await edition(input.editionId),row=source.rows.find(r=>r.opportunity_id===input.opportunityId);
      if(!row)throw fault('OPPORTUNITY_MISSING','Select an original opportunity from this edition.',404);
      const prior=next.reviews[row.opportunity_id];
      if(prior)expected(prior,input.expectedRevision);
      else if(input.expectedRevision!==0)throw fault('NEW_REVIEW_REVISION','A new review uses revision zero.');
      if(!object(input.review)||Object.keys(input.review).some(key=>!REVIEW_FIELDS.includes(key)))
        throw fault('REVIEW_FIELDS_INVALID','Use the displayed qualification and workshare fields.');
      const data={};
      for(const field of REVIEW_FIELDS) {
        const value=input.review[field]??'';
        if(typeof value!=='string'||value.length>32000)throw fault('REVIEW_TEXT_INVALID','Review fields accept up to 32,000 characters.');
        data[field]=value;
      }
      if(!REVIEW_STATUSES.includes(data.status))throw fault('REVIEW_STATUS_INVALID','Choose a qualification status.');
      const previous=prior?{revision:prior.revision,editionId:prior.editionId,editionSha256:prior.editionSha256,
        data:prior.data,updatedAt:prior.updatedAt,sourceDataSha256:prior.sourceDataSha256}:null;
      const value={opportunityId:row.opportunity_id,editionId:source.id,editionSha256:source.sha256,
        sourceDataSha256:row.source_data_sha256,revision:(prior?.revision??0)+1,data,updatedAt:stamp(),
        history:[...(prior?.history??[]),...(previous?[previous]:[])]};
      next.reviews[row.opportunity_id]=value;return value;
    });
  }
  async function rows(id,input={}) {
    const original=await edition(id),text=String(input.search??'').trim().toLowerCase();
    let selected=original.rows.filter(row=>(!input.status||row.status===input.status)&&
      (!input.agency||row.agency_code===input.agency)&&(!text||
        [row.title,row.opportunity_number,row.agency_name,row.description].some(value=>String(value??'').toLowerCase().includes(text))));
    if(input.closingFrom)selected=selected.filter(row=>row.closing_date&&row.closing_date>=input.closingFrom);
    if(input.closingTo)selected=selected.filter(row=>row.closing_date&&row.closing_date<=input.closingTo);
    const sort=input.sort??'closing_date';
    if(!['closing_date','posting_date','title','agency_name','opportunity_number'].includes(sort))
      throw fault('SORT_INVALID','Choose a supported opportunity sort.');
    const direction=input.direction==='desc'?-1:1;
    selected=selected.slice().sort((a,b)=>{
      const left=a[sort],right=b[sort];if(!left&&!right)return String(a.opportunity_id).localeCompare(String(b.opportunity_id));
      if(!left)return 1;if(!right)return -1;return String(left).localeCompare(String(right))*direction;
    });
    return {...page(selected.map(row=>({...rowSummary(row),review:state.reviews[row.opportunity_id]?
      {status:state.reviews[row.opportunity_id].data.status,owner:state.reviews[row.opportunity_id].data.owner,
        revision:state.reviews[row.opportunity_id].revision}:null})),input),edition:editionView(original)};
  }
  async function opportunity(id,opportunityId) {
    const original=await edition(id),row=original.rows.find(value=>value.opportunity_id===opportunityId);
    if(!row)throw fault('OPPORTUNITY_MISSING','This opportunity is not in the selected original edition.',404);
    return {edition:editionView(original),opportunity:row,review:clone(state.reviews[opportunityId]??null)};
  }
  async function compare(beforeId,afterId,input={}) {
    const [before,after]=await Promise.all([edition(beforeId),edition(afterId)]);
    const old=new Map(before.rows.map(row=>[row.opportunity_id,row])),fresh=new Map(after.rows.map(row=>[row.opportunity_id,row]));
    const changes=[];
    for(const [id,row]of fresh) {
      const previous=old.get(id);
      if(!previous){changes.push({opportunityId:id,kind:'added_to_edition',title:row.title,after:rowSummary(row)});continue;}
      const fields=compareFields.filter(field=>identity(previous[field]??null)!==identity(row[field]??null))
        .map(field=>({field,before:previous[field]??null,after:row[field]??null}));
      if(fields.length)changes.push({opportunityId:id,kind:'changed',title:row.title,fields,
        requiresReview:fields.some(value=>/clos|due|status|eligib|award|funding|cost_sharing|document_type/.test(value.field))});
    }
    for(const [id,row]of old)if(!fresh.has(id))changes.push({opportunityId:id,kind:'absent_from_later_edition',title:row.title,before:rowSummary(row)});
    return {before:editionView(before),after:editionView(after),changes:page(changes,input),
      interpretation:'Absence describes these retained editions. Provider status and deadline fields describe the notice.',
      counts:{added:changes.filter(c=>c.kind==='added_to_edition').length,
        changed:changes.filter(c=>c.kind==='changed').length,absent:changes.filter(c=>c.kind==='absent_from_later_edition').length}};
  }
  async function retainExport(kind,content,extension,selection={}) {
    const data=Buffer.isBuffer(content)?content:bytes(content),id=digest(data),name=kind+'-'+id+'.'+extension;
    await immutable(join(roots.exports,name),data);
    return update(next=>{
      const value=next.exports[id]??{id,kind,name,bytes:data.length,sha256:id,createdAt:stamp(),selection};
      next.exports[id]=value;return value;
    });
  }
  async function exportEdition(id,{includeReviews=false}={}) {
    const selected=await edition(id);
    const reviews=includeReviews?Object.values(state.reviews).filter(review=>selected.rows.some(row=>row.opportunity_id===review.opportunityId)):[];
    const queue=[id,...reviews.flatMap(review=>[review.editionId,...review.history.map(value=>value.editionId)])];
    const editions=new Map(),sourcePackets={};
    while(queue.length){
      const key=queue.shift();if(editions.has(key))continue;
      const value=await edition(key);editions.set(key,value);
      sourcePackets[value.sourcePacketSha256]??=await editionSource(value);
      if(value.parentId)queue.push(value.parentId);
    }
    return signed({schema:WORKSPACE_SCHEMA+'.edition-package',createdAt:stamp(),editionId:id,
      editions:[...editions.values()],sourcePackets,reviews:clone(reviews),attribution:ATTRIBUTION});
  }
  async function exportWorkspace() {
    return serial(async()=>{
      if(jobs.size)throw fault('CAPTURE_RUNNING','Finish or pause the current capture before taking its complete backup.',409);
      const frozen=clone(state),captures=[],editions=[],sourcePackets={};
      for(const c of Object.values(frozen.captures)){
        const packet=await capturePacket(c.id),source=readCaptureExport(packet);
        sourcePackets[packet.sha256]=packet;captures.push({id:c.id,sourcePacketSha256:packet.sha256});
        Object.assign(c,{nativeCaptureId:source.captureId,sourceSignature:source.sourceSignature,native:captureView(source)});
      }
      for(const e of Object.values(frozen.editions)){
        const value=await edition(e.id);editions.push(value);
        sourcePackets[value.sourcePacketSha256]??=await editionSource(value);
      }
      // Research state and original source travel together. Download and merchant
      // caches stay separate, so successive backups never embed earlier backups.
      frozen.exports={};frozen.merchants={};frozen.requests={};
      return signed({schema:WORKSPACE_SCHEMA+'.backup',createdAt:stamp(),state:frozen,captures,editions,sourcePackets,attribution:ATTRIBUTION});
    });
  }
  async function restore(input) {
    const packet=verified(input.packet,WORKSPACE_SCHEMA+'.backup');
    return mutate('workspace.restore',input,async next=>{
      if(next.restoreSha256===packet.sha256)return {restored:true,replayed:true,workspaceId:next.id};
      if(Object.values(next.queries).length||Object.values(next.captures).length||Object.values(next.editions).length)
        throw fault('EMPTY_RECEIVING_WORKSPACE_REQUIRED','Receive the backup into a new private workspace.',409);
      const incoming=clone(packet.state);
      if(incoming.schema!==WORKSPACE_SCHEMA||!ID.test(incoming.id)||!Number.isSafeInteger(incoming.revision)||
        ['queries','captures','editions','reviews','exports','merchants','requests'].some(key=>!object(incoming[key]))||
        !Array.isArray(packet.captures)||!Array.isArray(packet.editions)||!object(packet.sourcePackets))
        throw fault('BACKUP_STATE_INVALID');
      const sources=new Map(),captures=new Map(),editions=new Map();
      for(const [key,value]of Object.entries(packet.sourcePackets)){
        if(key!==value.sha256)throw fault('BACKUP_SOURCE_BINDING');
        sources.set(key,readCaptureExport(value));
      }
      for(const item of packet.captures){
        requireId(item.id,'capture');const binding=record(incoming.captures,item.id,'capture');
        const observed=sources.get(item.sourcePacketSha256);
        if(captures.has(item.id)||!observed)throw fault('BACKUP_CAPTURE_BINDING');
        captures.set(item.id,item);
        if(binding.nativeCaptureId!==observed.captureId||binding.sourceSignature!==observed.sourceSignature)
          throw fault('BACKUP_CAPTURE_CHANGED');
      }
      if(captures.size!==Object.keys(incoming.captures).length)throw fault('BACKUP_CAPTURE_MISSING');
      for(const item of packet.editions){
        if(editions.has(item.id)||!captures.has(item.captureId))throw fault('BACKUP_EDITION_BINDING');
        const original=packet.sourcePackets[item.sourcePacketSha256];
        if(!original)throw fault('BACKUP_EDITION_SOURCE_MISSING');
        verifyEditionSource(item,original);editions.set(item.id,item);
        const header=record(incoming.editions,item.id,'edition');
        if(header.sha256!==item.sha256||identity(header)!==identity(editionView(item)))throw fault('BACKUP_EDITION_CHANGED');
      }
      if(editions.size!==Object.keys(incoming.editions).length)throw fault('BACKUP_EDITION_MISSING');
      for(const item of editions.values())if(item.parentId&&!editions.has(item.parentId))throw fault('BACKUP_EDITION_PARENT_MISSING');
      for(const [id,review]of Object.entries(incoming.reviews)){
        if(id!==review.opportunityId)throw fault('BACKUP_REVIEW_ID');verifyReview(review,editions);
      }
      for(const [id,query]of Object.entries(incoming.queries))
        if(id!==query.id||!ID.test(id)||!Number.isSafeInteger(query.revision)||query.revision<1||
          identity(normalizeQuery(query.definition))!==identity(query.definition))throw fault('BACKUP_QUERY_INVALID');
      for(const source of Object.values(packet.sourcePackets))await retainSource(source);
      for(const item of captures.values())await importCapture(captureDirectory(item.id),packet.sourcePackets[item.sourcePacketSha256]);
      for(const item of editions.values())await immutable(join(roots.editions,item.id+'.json'),bytes(item));
      Object.assign(next,incoming,{restoreSha256:packet.sha256,exports:{},merchants:{},requests:{}});
      return {restored:true,workspaceId:next.id,captures:captures.size,editions:editions.size,reviews:Object.keys(next.reviews).length};
    });
  }
  async function workshare(editionId,opportunityId,{format='md'}={}) {
    const selected=await opportunity(editionId,opportunityId),row=selected.opportunity,review=selected.review?.data;
    if(!review)throw fault('WORKSHARE_REVIEW_REQUIRED','Save the opportunity qualification and workshare first.');
    const details=[['Opportunity',row.opportunity_number],['Agency',row.agency_name],['Published status',row.status],
      ['Notice type',row.document_type],['Published closing date',row.closing_date_raw??row.closing_date],
      ['Closing instructions',row.closing_date_description],['Forecast response',row.forecast_response_date_raw],
      ['Reported award floor',row.award_floor_raw],['Reported award ceiling',row.award_ceiling_raw],
      ['Reported total funding',row.estimated_funding_raw],['Cost sharing',row.cost_sharing],
      ['Official notice',row.source_url],['Original observation',row.source_observed_at]];
    const sections=[['Fit and opportunity',review.fit],['Eligibility assessment',review.eligibilityAssessment],
      ['Partner and owner',[review.partner,review.owner].filter(Boolean).join('\n')],
      ['Proposed workshare',review.workshare],['Deliverables',review.deliverables],['Acceptance',review.acceptance],
      ['Delivery schedule',review.schedule],['Service fee',review.fee],['Next action',review.nextAction],['Working notes',review.notes]];
    const eligibility=typeof row.eligibility==='string'?row.eligibility:JSON.stringify(row.eligibility,null,2);
    if(format==='html')return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escape(row.title)+'</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#202328;max-width:920px;margin:36px auto;padding:0 24px}h1{font-size:27px}h2{font-size:19px;border-top:1px solid #ddd;padding-top:20px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #ddd}th{width:26%}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}footer{border-top:1px solid #ddd;margin-top:28px;padding-top:16px;color:#555}</style>'+
      '<h1>'+escape(row.title)+'</h1><p>Opportunity qualification and implementation workshare</p><table>'+
      details.map(([key,value])=>'<tr><th>'+escape(key)+'</th><td>'+escape(value??'Unreported')+'</td></tr>').join('')+'</table>'+
      sections.filter(([,value])=>value).map(([name,value])=>'<h2>'+escape(name)+'</h2><pre>'+escape(value)+'</pre>').join('')+
      '<h2>Original eligibility text</h2><pre>'+escape(eligibility)+'</pre><footer>'+escape(ATTRIBUTION)+
      '<br>Edition '+escape(selected.edition.id)+' · Review revision '+selected.review.revision+'</footer></html>';
    const cell=value=>String(value??'Unreported').replaceAll('|','\\|').replaceAll('\n',' ');
    return '# '+row.title+'\n\nOpportunity qualification and implementation workshare\n\n| Source field | Reported value |\n| --- | --- |\n'+
      details.map(([key,value])=>'| '+cell(key)+' | '+cell(value)+' |').join('\n')+'\n\n'+
      sections.filter(([,value])=>value).map(([name,value])=>'## '+name+'\n\n'+value+'\n').join('\n')+
      '\n## Original eligibility text\n\n'+eligibility+'\n\n'+String(ATTRIBUTION)+'\n\nEdition '+selected.edition.id+
      ' · Review revision '+selected.review.revision+'\n';
  }
  async function merchant(input) {
    return mutate('merchant.create',input,async next=>{
      const selected=await edition(input.editionId),fields=input.fields??DATASET_COLUMNS;
      if(!Array.isArray(fields)||!fields.length||new Set(fields).size!==fields.length||
        fields.some(field=>!DATASET_COLUMNS.includes(field))||!fields.includes('opportunity_id'))
        throw fault('DATASET_FIELDS_INVALID','Choose original scalar fields including opportunity_id.');
      const id='GM-'+randomUUID(),target=join(roots.merchants,id),staged=target+'.stage';
      await privateDirectory(staged,true);await privateDirectory(join(staged,'source'),true);
      const csv=Buffer.from(fields.map(csvCell).join(',')+'\r\n'+selected.rows.map(row=>
        fields.map(field=>csvCell(row[field])).join(',')+'\r\n').join(''));
      const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name:selected.name,
        columns:Object.fromEntries(fields.map(field=>[field,{type:'string',nullable:field!=='opportunity_id'}])),
        filters:['status','document_type','agency_code','eligibility_codes'].filter(field=>fields.includes(field)),
        ranges:['closing_date','posting_date','forecast_response_date'].filter(field=>fields.includes(field)),
        sorts:['title','closing_date','posting_date','agency_name'].filter(field=>fields.includes(field)),
        defaultLimit:input.defaultLimit??25,maxLimit:input.maxLimit??100,maxRows:1000000,maxBytes:256*MiB,maxCellChars:65536};
      await immutable(join(staged,'dataset.csv'),csv);await immutable(join(staged,'dataset.json'),bytes(config));
      const captureBytes=bytes(await editionSource(selected)),editionBytes=bytes(selected);
      await immutable(join(staged,'source','capture.json'),captureBytes);
      await immutable(join(staged,'source','edition.json'),editionBytes);
      const provenance={schema:WORKSPACE_SCHEMA+'.dataset-source',editionId:selected.id,editionSha256:selected.sha256,
        sourceSignature:selected.sourceSignature,coverage:selected.coverage,columns:fields,attribution:ATTRIBUTION,
        sourceFiles:[{path:'source/capture.json',bytes:captureBytes.length,sha256:digest(captureBytes)},
          {path:'source/edition.json',bytes:editionBytes.length,sha256:digest(editionBytes)}]};
      await immutable(join(staged,'source.json'),bytes(provenance));
      const {loadDatasetConfig}=await import('../dataset-handler.mjs');
      const dataset=await loadDatasetConfig(join(staged,'dataset.json'));
      if((input.payment===undefined)!==(input.origin===undefined))
        throw fault('PAYMENT_AND_ORIGIN_REQUIRED','Configure the original public merchant terms and origin together.');
      if(input.payment!==undefined){
        const {buildDatasetSellerConfig}=await import('../dataset-cli.mjs');
        const seller=await buildDatasetSellerConfig(dataset,{payment:input.payment,origin:input.origin,path:input.path??'/grant-opportunities'});
        await immutable(join(staged,'seller.json'),bytes(seller));
      }
      const files=[];
      for(const name of ['dataset.csv','dataset.json','source.json','source/capture.json','source/edition.json',
        ...(input.payment!==undefined?['seller.json']:[])]){
        const data=await readPrivate(join(staged,name),256*MiB);files.push({path:name,bytes:data.length,sha256:digest(data)});
      }
      const summary={id,editionId:selected.id,editionSha256:selected.sha256,sourceSignature:selected.sourceSignature,
        createdAt:stamp(),configured:input.payment!==undefined,dataset:dataset.describe(),files};
      await immutable(join(staged,'manifest.json'),bytes(signed({schema:WORKSPACE_SCHEMA+'.merchant',...summary})));
      await rename(staged,target);next.merchants[id]=summary;return summary;
    });
  }
  async function merchantFiles(id) {
    const selected=record(state.merchants,id,'merchant'),root=join(roots.merchants,id),files=[];
    for(const file of selected.files) {
      const data=await readPrivate(join(root,file.path),256*MiB);
      if(data.length!==file.bytes||digest(data)!==file.sha256)throw fault('MERCHANT_SOURCE_CHANGED');
      files.push({...file,dataBase64:data.toString('base64')});
    }
    return signed({schema:WORKSPACE_SCHEMA+'.merchant-package',merchant:selected,files,attribution:ATTRIBUTION});
  }
  async function merchantPreview(id,query={}) {
    await merchantFiles(id);
    const {loadDatasetConfig}=await import('../dataset-handler.mjs');
    const dataset=await loadDatasetConfig(join(roots.merchants,id,'dataset.json')),context={query};
    const admission=await dataset.admit(context);
    if(admission!==true)throw fault('DATASET_QUERY_REJECTED',admission?.body?.message??'Choose a supported dataset query.');
    return {mode:'local_dataset_read',...(await dataset.handle(context))};
  }
  async function nativePublisher() {
    if(!publisher){const {openSocrataPublisher}=await import('../socrata/publisher.mjs');
      publisher=await openSocrataPublisher({directory:join(directory,'publisher')});}
    return publisher;
  }
  async function publisherAction(action,input={}) {
    if(!action.startsWith('publisher.'))throw fault('PUBLISHER_ACTION_REQUIRED');
    let payload=clone(input);
    if(action==='publisher.prepare'){
      const selected=record(state.merchants,payload.merchantId,'merchant');
      if(!selected.configured)throw fault('CONFIGURED_MERCHANT_REQUIRED','Save the merchant with its public payment terms and origin.');
      await merchantFiles(selected.id);payload={exportDirectory:join(roots.merchants,selected.id)};
    }
    if(action==='publisher.buyer.session'){
      const selected=buyers.get(payload.workspaceId);
      if(!selected||Object.hasOwn(payload,'workspaceDirectory'))throw fault('BUYER_WORKSPACE_REQUIRED','Choose a host-configured buyer workspace.');
      delete payload.workspaceId;payload.workspaceDirectory=selected;
    }
    return (await nativePublisher()).act(action,payload);
  }
  async function publisherExport(kind,id) {
    const file=await (await nativePublisher()).readExport(kind,id);
    const extension=file.filename.split('.').at(-1);
    return retainExport('publisher-'+kind,file.bytes,extension,{kind,id});
  }
  async function exportFile(input) {
    const kind=input.kind;let value,extension='json',selection={};
    if(kind==='workspace')value=await exportWorkspace();
    else if(kind==='edition'){value=await exportEdition(input.editionId,{includeReviews:input.includeReviews===true});selection={editionId:input.editionId};}
    else if(kind==='capture'){value=await capturePacket(input.captureId);selection={captureId:input.captureId};}
    else if(kind==='merchant'){value=await merchantFiles(input.merchantId);selection={merchantId:input.merchantId};}
    else if(kind==='comparison'){value=await compare(input.before,input.after,{limit:250});const total=value.changes.total;
      for(let offset=250;offset<total;offset+=250){const more=await compare(input.before,input.after,{offset,limit:250});
        value.changes.items.push(...more.changes.items);}value.changes.nextOffset=null;value.changes.limit=total;
      selection={before:input.before,after:input.after};}
    else if(kind==='workshare-md'||kind==='workshare-html'){
      extension=kind==='workshare-md'?'md':'html';value=Buffer.from(await workshare(input.editionId,input.opportunityId,{format:extension}));
      selection={editionId:input.editionId,opportunityId:input.opportunityId};
    } else throw fault('EXPORT_KIND_INVALID','Choose workspace, edition, capture, merchant, comparison or a workshare.');
    return retainExport(kind,value,extension,selection);
  }
  async function readExport(id,{offset=0,limit=1024*1024}={}) {
    if(!HASH.test(id??''))throw fault('EXPORT_ID_INVALID');
    const file=record(state.exports,id,'export'),data=await readPrivate(join(roots.exports,file.name),256*MiB);
    if(data.length!==file.bytes||digest(data)!==file.sha256)throw fault('EXPORT_CHANGED','The original export differs.',409);
    integer(offset,0,data.length,'Byte offset');integer(limit,1,8*MiB,'Chunk size');
    const selected=data.subarray(offset,Math.min(offset+limit,data.length));
    return {file,offset,bytesRead:selected.length,data:selected.toString('base64'),
      nextOffset:offset+selected.length<data.length?offset+selected.length:null};
  }
  async function snapshot() {
    return clone({schema:state.schema,id:state.id,name:state.name,revision:state.revision,createdAt:state.createdAt,updatedAt:state.updatedAt,
      queries:Object.values(state.queries),captures:Object.values(state.captures).map(value=>({...value,
        running:jobs.has(value.id),progress:jobs.get(value.id)?.progress??null})),editions:Object.values(state.editions),
      reviews:Object.values(state.reviews).map(({history,...review})=>({...review,historyCount:history.length})),
      exports:Object.values(state.exports),merchants:Object.values(state.merchants),
      jobs:[...jobs.values()].map(job=>({id:job.id,startedAt:job.startedAt})),columns:DATASET_COLUMNS,attribution:ATTRIBUTION,
      buyerWorkspaces:[...buyers.keys()]});
  }
  const close=()=>closePromise??=(async()=>{
    closing=true;
    for(const job of jobs.values())job.controller.abort(fault('WORKSPACE_CLOSING','The original workspace is closing.'));
    await Promise.allSettled([...jobs.values()].map(job=>job.promise));await tail.catch(()=>{});
    try {await publisher?.close();}finally{closed=true;await unlock();}
  })();
  return {directory,snapshot,querySave,startCapture,waitCapture,pauseCapture,captureStatus,importOriginal,
    edition,createEdition,rows,opportunity,reviewSave,compare,workshare,merchant,merchantFiles,merchantPreview,
    publisherAction,publisherExport,publisherState:async()=>(await nativePublisher()).state(),exportEdition,exportWorkspace,receiveEdition,
    restore,exportFile,readExport,close};
}
