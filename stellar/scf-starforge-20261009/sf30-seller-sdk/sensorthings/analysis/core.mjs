// MIT. Analysis actions composed into the original SensorThings operation journal.
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {identity,json,stable,sha,text,fields,plain,fault,WORKSPACE_SCHEMA} from '../contract.mjs';
import {validateSourceEdition,inspectRetainedFile} from '../portable.mjs';
import {ANALYSIS_SCHEMA,ANALYSIS_MEANING,ANALYSIS_LIMITS} from './schema.mjs';
import {hash,actor,project,versionRecord,readVersion,normalizeSelection,describeSelection,rowsPage,validateAnnotation,compareSelection} from './model.mjs';
import {retainedGraph,queryRetained} from './sta.mjs';
import {importViewer} from './viewer.mjs';
import {importEvidence,safeFile} from './artifacts.mjs';
import {preparePublication} from './publication.mjs';
import {exportProject,importProject} from './transfer.mjs';
import {preparePythonSource} from './python-document.mjs';

const clone=v=>structuredClone(v),find=(rows,id,label)=>{const v=(rows??[]).find(x=>x.id===id);if(!v)throw fault('ANALYSIS_SELECTION','Select an existing '+label+'.',404);return v;};
const collections=['analysisProjects','analysisVersions','analysisComparisons','analysisEvidence','analysisViewers','analysisPublications','analysisExports','analysisImports','analysisReceipts','analysisPythonSources'];
function list(state,name){return state[name]??[];}
function uniquePush(state,name,value){state[name]??=[];const old=state[name].find(x=>x.id===value.id);if(old&&stable(old)!==stable(value))throw fault('ANALYSIS_IDENTITY','A retained '+name+' identity has different content.',409);if(!old)state[name].push(clone(value));}
function note(value,label='the operator note'){if(typeof value!=='string'||!value.trim()||value.length>12000)throw fault('ANALYSIS_NOTE','Supply '+label+' of at most 12,000 characters.');return value;}
function headMatches(state,context){if(context.project&&project(state,context.project.id).headVersionId!==context.project.headVersionId)throw fault('ANALYSIS_HEAD_CHANGED','The project advanced while this operation was preparing. Keep the original attempt and review the current version.',409);}
function selectedReview(state,editionId){return [...state.reviews].reverse().find(r=>r.editionId===editionId)??null;}
function reviewed(state,editionId,expected){
  const latest=selectedReview(state,editionId);
  if(!expected||expected.decision!=='accept'||identity(latest)!==identity(expected))throw fault('ANALYSIS_REVIEW','The exact source review changed. Review this edition before preparing its publication.',409);
}
export function analysisContext(state,op,{inboxDirectory=null}={}){
  const p=op.payload,c={workspaceId:state.workspaceId};
  actor(p.actor);c.actor=p.actor;
  if(['analysis.viewer.import','analysis.evidence.import','analysis.import','analysis.receipt.import'].includes(op.action)){
    if(!inboxDirectory)throw fault('ANALYSIS_INBOX','Bind the existing host source inbox before receiving this original file.',409);
    c.inboxDirectory=inboxDirectory;
  }
  if(op.action==='analysis.python.prepare'){
    if(!state.editionIds.includes(hash(p.editionId,'source edition')))throw fault('ANALYSIS_EDITION','Select an immutable local source edition.',404);
    c.pythonExport=clone(find(state.exports,p.exportId,'completed original source export'));
    if(c.pythonExport.editionId!==p.editionId)throw fault('ANALYSIS_PYTHON_SOURCE','The selected source export belongs to another immutable edition.',409);
  }
  if(op.action==='analysis.create'){
    if(!state.editionIds.includes(hash(p.editionId,'source edition')))throw fault('ANALYSIS_EDITION','Select an immutable local source edition.',404);
  }else if(['analysis.revise','analysis.annotate','analysis.compare','analysis.evidence.import','analysis.publish','analysis.export'].includes(op.action)){
    c.project=clone(project(state,p.projectId));
    if(op.action!=='analysis.export'){
      const selected=versionRecord(state,hash(p.baseVersionId,'base version'));
      if(selected.projectId!==c.project.id)throw fault('ANALYSIS_VERSION','The selected version belongs to another project.',409);
      c.versionId=selected.id;
      if(['analysis.revise','analysis.annotate'].includes(op.action)&&selected.id!==c.project.headVersionId)
        throw fault('ANALYSIS_HEAD_CHANGED','Revise the exact current project version.',409);
      if(op.action==='analysis.publish'){
        c.review=clone(selectedReview(state,selected.editionId));
        if(c.review?.decision!=='accept')throw fault('ANALYSIS_REVIEW','Accept the selected original source edition before publication.',409);
      }
    }else{
      // Freeze the complete project history now; unrelated later workspace
      // revisions cannot silently change this exact export selection.
      c.snapshotSelection={project:clone(c.project),
        versions:clone(list(state,'analysisVersions').filter(x=>x.projectId===c.project.id)),
        comparisons:clone(list(state,'analysisComparisons').filter(x=>x.projectId===c.project.id)),
        evidence:clone(list(state,'analysisEvidence').filter(x=>x.projectId===c.project.id)),
        publications:clone(list(state,'analysisPublications').filter(x=>x.projectId===c.project.id)),
        receipts:clone(list(state,'analysisReceipts').filter(x=>x.projectId===c.project.id)),
        viewers:clone(list(state,'analysisViewers')),reviews:clone(state.reviews)};
    }
  }
  if(op.action==='analysis.receipt.import')c.publication=clone(find(state.analysisPublications,p.publicationId,'publication'));
  return c;
}
export function createAnalysisManager({store,edition,inboxDirectory=null}){
  let graphCache=null,closing=false;
  const initialized=()=>{if(closing)throw fault('ANALYSIS_CLOSED','This original analysis workspace is closed.',503);};
  async function readObject(reference){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await store.object(reference)));}
  async function viewer(id){const r=find(store.read().analysisViewers,hash(id,'viewer'),'installed viewer'),v=await readObject(r.sha256);
    const {id:claimed,...body}=v;if(claimed!==id||identity(body)!==id)throw fault('ANALYSIS_VIEWER','The retained viewer identity changed.',409);return v;}
  async function version(id){initialized();return readVersion(store,id);}
  async function summary(id){const v=await version(id),record=versionRecord(store.read(),id),s=await readObject(record.summarySha256);
    if(s.editionId!==v.editionId||stable(s.selection)!==stable(v.selection))throw fault('ANALYSIS_SUMMARY','The retained summary belongs to another selection.',409);return s;}
  async function projectRead(id){
    const s=store.read(),p=project(s,id);return {project:p,
      versions:list(s,'analysisVersions').filter(x=>x.projectId===id),
      comparisons:list(s,'analysisComparisons').filter(x=>x.projectId===id),
      evidence:list(s,'analysisEvidence').filter(x=>x.projectId===id),publications:list(s,'analysisPublications').filter(x=>x.projectId===id),
      receipts:list(s,'analysisReceipts').filter(x=>x.projectId===id),exports:list(s,'analysisExports').filter(x=>x.projectId===id)};
  }
  function overview(){initialized();const s=store.read();return {schema:'stellar-forge.sensorthings-analysis-view.v1',workspaceId:s.workspaceId,revision:s.revision,
    projects:list(s,'analysisProjects'),viewers:list(s,'analysisViewers'),exports:list(s,'analysisExports'),imports:list(s,'analysisImports'),
    sourceEditionIds:s.editionIds,pythonSources:list(s,'analysisPythonSources'),meaning:ANALYSIS_MEANING};}
  async function compareRead(id){const r=find(store.read().analysisComparisons,hash(id,'comparison'),'comparison'),value=await readObject(r.sha256);
    const {id:claimed,...body}=value;if(claimed!==id||identity(body)!==id)throw fault('ANALYSIS_COMPARISON','The comparison content changed.',409);return value;}
  async function publication(id){return find(store.read().analysisPublications,id,'publication');}
  async function pythonSource(id){initialized();return find(store.read().analysisPythonSources,id,'prepared Python source document');}
  async function fileRecord(id){
    const s=store.read();
    for(const name of ['analysisPublications','analysisEvidence','analysisExports','analysisReceipts']){
      const record=list(s,name).find(x=>x.id===id);if(record)return {record,files:record.files??(record.file?[record.file]:[])};
    }
    const prepared=list(s,'analysisPythonSources').find(x=>x.id===id);
    if(prepared)return {record:prepared,pythonSource:prepared};
    const r=list(s,'analysisViewers').find(x=>x.id===id);
    if(r){const v=await viewer(id);return {record:v,objects:[{name:v.upstream.filename,type:'application/zip',...v.archive},
      ...v.upstreamSources.map(x=>({name:'upstream-'+x.path.replaceAll('/','_'),type:'text/plain; charset=utf-8',bytes:x.bytes,sha256:x.sha256}))]};}
    throw fault('ANALYSIS_FILE','Choose an existing analysis publication, evidence, viewer, export or prepared Python source.',404);
  }
  async function inbox(){
    if(!inboxDirectory)return {bound:false,files:[]};
    const entries=await readdir(inboxDirectory,{withFileTypes:true}),files=[];
    for(const entry of entries){
      if(!entry.isFile())continue;
      try{safeFile(entry.name);const f=await inspectRetainedFile(join(inboxDirectory,entry.name),{maximum:2*1024*1024*1024});
        files.push({name:entry.name,bytes:f.bytes,sha256:f.sha256});}
      catch(e){if(e.code==='ENOENT')continue;files.push({name:entry.name,available:false,code:e.code??'FILE_UNAVAILABLE'});}
    }
    return {bound:true,files};
  }
  async function streams(editionId){
    const e=await edition(editionId),scalar=e.plan.streams.filter(s=>s.kind==='Datastreams');
    if(!scalar.length)return {editionId,streams:[],scope:e.scope,issues:e.issues};
    // The full source profile is the original stream catalogue, not a new capture.
    const all=[];
    for(let offset=0;offset<scalar.length;offset+=ANALYSIS_LIMITS.streams){
      const selection=normalizeSelection({streamKeys:scalar.slice(offset,offset+ANALYSIS_LIMITS.streams).map(s=>s.key),period:null,view:'events'},e);
      all.push(...(await describeSelection(store,e,selection)).streams);
    }
    return {editionId,streams:all,scope:e.scope,issues:e.issues,license:e.source.license};
  }
  async function rows(id,options){const v=await version(id);return rowsPage(store,await edition(v.editionId),v.selection,options);}
  async function sta(id,mode,request){
    const v=await version(id),cacheKey=id+':'+mode;
    if(graphCache?.key!==cacheKey)graphCache={key:cacheKey,value:await retainedGraph(store,await edition(v.editionId),v.selection,{mode})};
    return queryRetained(graphCache.value,request);
  }
  async function saveVersion(op,body,finish,{newProject=false}={}){
    const value={id:identity(body),...body},e=await edition(body.editionId);
    if(body.selection.viewerId)await viewer(body.selection.viewerId);
    const described=await describeSelection(store,e,body.selection),
      [saved,summaryObject]=await Promise.all([store.putObject(json(value)),store.putObject(json(described))]),
      record={id:value.id,projectId:value.projectId,parentId:value.parentId,editionId:value.editionId,sha256:saved.sha256,summarySha256:summaryObject.sha256,createdAt:value.createdAt,title:value.title};
    return finish({projectId:value.projectId,versionId:value.id,version:value,summary:described},state=>{
      if(!newProject)headMatches(state,op.context.analysis);
      if(list(state,'analysisVersions').length>=ANALYSIS_LIMITS.versions&&!list(state,'analysisVersions').some(r=>r.id===value.id))
        throw fault('ANALYSIS_CAPACITY','This workspace has reached the declared immutable analysis-version capacity.',413);
      uniquePush(state,'analysisVersions',record);
      state.analysisProjects??=[];
      let p=state.analysisProjects.find(x=>x.id===value.projectId);
      if(newProject&&!p){p={id:value.projectId,originWorkspaceId:op.context.analysis.workspaceId,createdAt:op.createdAt,title:value.title,headVersionId:value.id};state.analysisProjects.push(p);}
      else if(!p)throw fault('ANALYSIS_PROJECT','The original project disappeared.',409);
      else {p.headVersionId=value.id;p.title=value.title;}
    });
  }
  async function snapshot(selection){
    const versions=[],comparisons=[];
    for(const record of selection.versions)versions.push({record,version:await version(record.id),summary:await readObject(record.summarySha256)});
    for(const record of selection.comparisons)comparisons.push({record,comparison:await compareRead(record.id)});
    const needed=new Set(versions.map(x=>x.version.editionId));for(const x of comparisons){needed.add(x.comparison.leftEditionId);needed.add(x.comparison.rightEditionId);}
    const editions=[];for(const id of needed)editions.push({edition:await edition(id),reviews:selection.reviews.filter(r=>r.editionId===id)});
    const viewerIds=new Set(versions.map(x=>x.version.selection.viewerId).filter(Boolean));
    const viewers=[];for(const id of viewerIds)viewers.push(await viewer(id));
    return {schema:'stellar-forge.sensorthings-analysis-project-snapshot.v1',originalWorkspaceId:store.read().workspaceId,
      project:selection.project,versions,comparisons,evidence:selection.evidence,publications:selection.publications,receipts:selection.receipts,
      viewers,editions,analysisContract:ANALYSIS_MEANING};
  }
  async function execute(op,finish){
    initialized();const p=op.payload,c=op.context.analysis,s=store.read();
    if(op.action==='analysis.create'){
      const e=await edition(p.editionId),projectId='analysis-'+identity({workspaceId:c.workspaceId,operationId:op.operationId,requestSha256:op.requestSha256}).slice(0,24);
      return saveVersion(op,{schema:ANALYSIS_SCHEMA,projectId,parentId:null,editionId:e.id,title:text(p.title,'the analysis title',200),
        selection:normalizeSelection(p.selection,e),annotations:[],actor:actor(p.actor),changeReason:note(p.note),createdAt:op.createdAt},finish,{newProject:true});
    }
    if(op.action==='analysis.revise'||op.action==='analysis.annotate'){
      const prior=await version(c.versionId);let selection=prior.selection,annotations=prior.annotations,editionId=prior.editionId,title=prior.title;
      if(op.action==='analysis.revise'){
        if(p.editionId!==undefined)editionId=hash(p.editionId,'source edition');
        const e=await edition(editionId);
        if(p.selection!==undefined)selection=normalizeSelection(p.selection,e);
        else if(editionId!==prior.editionId)selection=normalizeSelection({streamKeys:prior.selection.streamKeys,period:prior.selection.period?
          {start:prior.selection.period.start,end:prior.selection.period.end}:null,view:prior.selection.view,viewerId:prior.selection.viewerId},e);
        if(p.title!==undefined)title=text(p.title,'the analysis title',200);
        // Prior annotations retain their original cited edition. They remain
        // visible history, never relabeled as evidence for this later edition.
      }else{
        const annotation=await validateAnnotation(store,p.annotation,await edition(editionId),annotations);
        annotations=[...annotations.filter(a=>a.id!==annotation.id),{...annotation,actor:actor(p.actor),recordedAt:op.createdAt}];
        if(annotations.length>ANALYSIS_LIMITS.annotations)throw fault('ANALYSIS_CAPACITY','This version exceeds the declared annotation capacity.',413);
      }
      return saveVersion(op,{schema:ANALYSIS_SCHEMA,projectId:prior.projectId,parentId:prior.id,editionId,title,selection,annotations,
        actor:actor(p.actor),changeReason:note(p.reason,'the revision reason'),createdAt:op.createdAt},finish);
    }
    if(op.action==='analysis.compare'){
      const v=await version(c.versionId),left=await edition(v.editionId),right=await edition(hash(p.rightEditionId,'later edition')),
        compared=await compareSelection(store,left,right,v.selection),
        body={...compared,projectId:v.projectId,versionId:v.id,actor:actor(p.actor),note:note(p.note),createdAt:op.createdAt},
        value={id:identity(body),...body},saved=await store.putObject(json(value)),
        record={id:value.id,projectId:v.projectId,versionId:v.id,leftEditionId:left.id,rightEditionId:right.id,sha256:saved.sha256,createdAt:op.createdAt,counts:compared.counts};
      return finish(value,state=>uniquePush(state,'analysisComparisons',record));
    }
    if(op.action==='analysis.python.prepare'){
      const selected=await edition(hash(p.editionId,'source edition')),
        value=await preparePythonSource(store,{edition:selected,exportReceipt:c.pythonExport,id:op.operationId,createdAt:op.createdAt});
      if(value.schema!=='stellar-forge.sensorthings-python-source.v1'||value.id!==op.operationId||value.editionId!==selected.id||
         value.exportId!==c.pythonExport.id||value.originalWorkspaceId!==c.workspaceId||!Array.isArray(value.files))
        throw fault('ANALYSIS_PYTHON_SOURCE','The Python document preparer returned another original source selection.',409);
      return finish(value,state=>uniquePush(state,'analysisPythonSources',value));
    }
    if(op.action==='analysis.viewer.import'){
      const value=await importViewer(store,{...p,inboxDirectory:c.inboxDirectory}),saved=await store.putObject(json(value)),
        record={id:value.id,sha256:saved.sha256,upstream:value.upstream,archive:value.archive,actor:actor(p.actor),createdAt:op.createdAt};
      const previous=list(s,'analysisViewers').find(x=>x.id===value.id);
      return finish(value,state=>{if(previous){if(previous.sha256!==saved.sha256)throw fault('ANALYSIS_VIEWER','This installed viewer ID has different content.',409);}
        else uniquePush(state,'analysisViewers',record);});
    }
    if(op.action==='analysis.evidence.import'||op.action==='analysis.receipt.import'){
      const file=await importEvidence(store,{...p,inboxDirectory:c.inboxDirectory,operationId:op.operationId,createdAt:op.createdAt}),
        versionId=c.versionId??c.publication.versionId,projectId=c.project?.id??c.publication.projectId;
      const body={projectId,versionId,file,title:p.title??'Original receiving receipt',actor:actor(p.actor),note:note(p.note),createdAt:op.createdAt,
        ...(op.action==='analysis.receipt.import'?{publicationId:c.publication.id,meaning:'Original received receipt file. Recipient assertions remain separate from local file verification.'}:{})},
        value={id:identity(body),...body};
      return finish(value,state=>uniquePush(state,op.action==='analysis.receipt.import'?'analysisReceipts':'analysisEvidence',value));
    }
    if(op.action==='analysis.publish'){
      const v=await version(c.versionId),e=await edition(v.editionId);reviewed(store.read(),e.id,c.review);
      if(!Array.isArray(p.comparisonIds)||new Set(p.comparisonIds).size!==p.comparisonIds.length||
         !Array.isArray(p.evidenceIds)||new Set(p.evidenceIds).size!==p.evidenceIds.length)throw fault('ANALYSIS_PUBLICATION','Choose explicit distinct comparison and actual-viewer evidence IDs.');
      const comparisons=[];for(const id of p.comparisonIds){const x=await compareRead(id);if(x.projectId!==v.projectId||x.versionId!==v.id)throw fault('ANALYSIS_PUBLICATION','This comparison belongs to another saved view.',409);comparisons.push(x);}
      const evidence=p.evidenceIds.map(id=>find(s.analysisEvidence,id,'viewer evidence'));
      if(evidence.some(x=>x.projectId!==v.projectId||x.versionId!==v.id))throw fault('ANALYSIS_PUBLICATION','Bind the actual viewer output to this exact saved version.',409);
      const value=await preparePublication(store,{version:v,edition:e,summary:await summary(v.id),comparisons,evidence,review:c.review,
        operationId:op.operationId,createdAt:op.createdAt,title:text(p.title,'the publication title',200),actor:actor(p.actor),note:note(p.note)});
      if(value.projectId!==v.projectId||value.versionId!==v.id||!Array.isArray(value.files))throw fault('ANALYSIS_PUBLICATION','The publication owner returned another source selection.',409);
      return finish(value,state=>{reviewed(state,e.id,c.review);uniquePush(state,'analysisPublications',value);});
    }
    if(op.action==='analysis.export'){
      const value=await exportProject(store,{snapshot:await snapshot(c.snapshotSelection),id:op.operationId,createdAt:op.createdAt}),
        result={...value,projectId:c.project.id};
      return finish(result,state=>uniquePush(state,'analysisExports',result));
    }
    if(op.action==='analysis.import'){
      const incoming=await importProject(store,{...p,inboxDirectory:c.inboxDirectory,id:op.operationId,createdAt:op.createdAt}),
        snap=incoming.snapshot;
      if(snap?.schema!=='stellar-forge.sensorthings-analysis-project-snapshot.v1'||!snap.project||!Array.isArray(snap.versions)||!Array.isArray(snap.editions))
        throw fault('ANALYSIS_RECEIVING','The native receiver did not return the complete original analysis snapshot.',409);
      for(const x of snap.editions)validateSourceEdition(x.edition);
      for(const x of snap.versions){const {id,...body}=x.version;
        if(identity(body)!==id||x.record.id!==id||x.record.projectId!==snap.project.id||body.projectId!==snap.project.id)
          throw fault('ANALYSIS_RECEIVING','An imported saved version differs from its original project identity.',409);}
      const receivedViewers=[];
      for(const x of snap.viewers){const saved=await store.putObject(json(x));receivedViewers.push({id:x.id,sha256:saved.sha256,upstream:x.upstream,archive:x.archive,actor:actor(p.actor),createdAt:op.createdAt});}
      const prior=list(store.read(),'analysisProjects').find(x=>x.id===snap.project.id),
        result={id:op.operationId,projectId:snap.project.id,originalWorkspaceId:snap.originalWorkspaceId,
          originalHeadVersionId:snap.project.headVersionId,preservedLocalHeadVersionId:prior?.headVersionId??null,receipt:incoming.receipt,
          sourceReviewRequired:snap.editions.filter(x=>selectedReview(store.read(),x.edition.id)?.decision!=='accept').map(x=>x.edition.id)};
      return finish(result,state=>{
        const existing=list(state,'analysisProjects').find(x=>x.id===snap.project.id);
        if(existing&&existing.originWorkspaceId!==snap.project.originWorkspaceId)throw fault('ANALYSIS_RECEIVING','The project ID belongs to another original workspace.',409);
        if(!existing)uniquePush(state,'analysisProjects',snap.project);
        for(const x of snap.versions)uniquePush(state,'analysisVersions',x.record);
        for(const x of snap.comparisons)uniquePush(state,'analysisComparisons',x.record);
        for(const x of snap.evidence)uniquePush(state,'analysisEvidence',x);
        for(const x of snap.publications)uniquePush(state,'analysisPublications',x);
        for(const x of snap.receipts)uniquePush(state,'analysisReceipts',x);
        for(const x of snap.viewers){const saved=receivedViewers.find(r=>r.id===x.id);
          const known=list(state,'analysisViewers').find(r=>r.id===x.id);if(known){if(known.sha256!==saved.sha256)throw fault('ANALYSIS_VIEWER','The imported viewer identity conflicts.',409);}
          else uniquePush(state,'analysisViewers',saved);}
        for(const x of snap.editions)if(!state.editionIds.includes(x.edition.id))state.editionIds.push(x.edition.id);
        uniquePush(state,'analysisImports',result);
      });
    }
    throw fault('ANALYSIS_ACTION','The analysis action is not implemented.');
  }
  return {overview,project:projectRead,version,summary,rows,streams,comparison:compareRead,publication,pythonSource,viewer,fileRecord,inbox,sta,execute,
    close(){closing=true;graphCache=null;}};
}
