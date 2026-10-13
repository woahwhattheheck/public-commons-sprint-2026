// MIT. Capture edited companion trees through the original retained upload engine.
import {readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {initializationDirectory,retainInitializationRecord} from '../../sf88-operator-buyer-cli/initialization.mjs';
import {need,plain,operationId,readJSON,json,canonical,withWorkspaceWrite,operationLease} from './storage.mjs';
import {readApplicationInputSetDirectory,retainApplicationInputSetDirectory} from './application-input-set-sources.mjs';
import {applicationInputSetJSON,normalizeApplicationInputSet} from './public/application-input-set-format.mjs';

const REVIEW='stellar-forge.runtime-application-input-set-review.v1';
const CAPTURE='stellar-forge.runtime-application-input-set-edition.v1';
const HANDOFF='stellar-forge.runtime-application-input-set-handoff.v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>hash(json(canonical(value)));
const fields=(value,allowed)=>need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),
  'APPLICATION_INPUT_EDITION_ARGUMENTS_INVALID');
const same=(a,b)=>identity(a)===identity(b);
function changes(before,after) {
  const rows=[],old=new Map(before.files.map(file=>[file.path,file])),next=new Map(after.files.map(file=>[file.path,file]));
  for(const path of [...new Set([...old.keys(),...next.keys()])].sort()) {
    const a=old.get(path),b=next.get(path);
    const change=!a?'ADDED':!b?'REMOVED':a.sha256!==b.sha256||a.bytes!==b.bytes?'CHANGED':'UNCHANGED';
    rows.push({path,type:'file',change,before:a??null,after:b??null});
  }
  const a=new Set(before.directories),b=new Set(after.directories);
  for(const path of [...new Set([...a,...b])].sort())
    rows.push({path,type:'directory',change:!a.has(path)?'ADDED':!b.has(path)?'REMOVED':'UNCHANGED'});
  return rows;
}
function reviewValue(workspaceId,selection,manifest) {
  const value={schema:REVIEW,workspaceId,selectionRequestId:selection.requestId,
    parentSetId:selection.setId,parentManifest:selection.manifest,
    kind:selection.kind,field:selection.field,memberPath:selection.memberPath,
    manifest,setId:hash(applicationInputSetJSON(manifest)),
    changes:changes(selection.manifest,manifest)};
  return {...value,reviewSha256:identity(value)};
}
function validatedReview(value) {
  need(plain(value)&&value.schema===REVIEW,'APPLICATION_INPUT_EDITION_REVIEW_INVALID');
  const {reviewSha256,...body}=value;
  need(reviewSha256===identity(body),'APPLICATION_INPUT_EDITION_REVIEW_CHANGED');
  operationId(value.selectionRequestId);
  const parent=normalizeApplicationInputSet(value.parentManifest),manifest=normalizeApplicationInputSet(value.manifest);
  need(same(parent,value.parentManifest)&&same(manifest,value.manifest)&&
    value.parentSetId===hash(applicationInputSetJSON(parent))&&value.setId===hash(applicationInputSetJSON(manifest))&&
    same(value.changes,changes(parent,manifest)),'APPLICATION_INPUT_EDITION_REVIEW_CHANGED');
  return value;
}
function validatedCapture(value) {
  need(plain(value)&&value.schema===CAPTURE,'APPLICATION_INPUT_EDITION_REQUEST_CHANGED');
  operationId(value.requestId);const review=validatedReview(value.review),selection=value.selection;
  need(value.workspaceId===review.workspaceId&&plain(selection)&&
    selection.requestId===review.selectionRequestId&&selection.setId===review.parentSetId&&
    selection.kind===review.kind&&selection.field===review.field&&selection.memberPath===review.memberPath&&
    typeof selection.directory==='string'&&typeof selection.path==='string',
    'APPLICATION_INPUT_EDITION_ORIGIN_CHANGED');
  return value;
}
export function createApplicationInputSetEditionsAPI(root,workspaceId,model) {
  const directory=join(root,'application-input-sets','editions'),requests=join(directory,'requests'),imports=join(directory,'imports');
  async function live() {
    const value=await readJSON(join(root,'workspace.json'));
    need(value.workspaceId===workspaceId&&value.directory===root,'RUNTIME_WORKSPACE_IDENTITY_CHANGED',undefined,409);
  }
  async function mutate(fn) {
    return withWorkspaceWrite(root,async()=>{
      await live();await initializationDirectory(directory,{create:true});
      const lease=await operationLease(join(directory,'editions.lock'));
      try{return await fn();}finally{await lease.close();}
    });
  }
  async function current(review) {
    validatedReview(review);
    need(review.workspaceId===workspaceId,'APPLICATION_INPUT_EDITION_WORKSPACE_CHANGED');
    const selected=await model().applicationInputSetSelection({requestId:review.selectionRequestId});
    need(selected.phase==='PREPARED'&&selected.setId===review.parentSetId&&
      selected.kind===review.kind&&selected.field===review.field&&selected.memberPath===review.memberPath&&
      same(selected.manifest,review.parentManifest),'APPLICATION_INPUT_EDITION_SELECTION_CHANGED',undefined,409);
    const source=await readApplicationInputSetDirectory({directory:selected.directory,name:review.manifest.name});
    need(same(reviewValue(workspaceId,selected,source.manifest),review),
      'APPLICATION_INPUT_EDITION_WORKING_CHANGED','The working files changed. Review the complete current tree before saving another edition.',409);
    return {selected,source};
  }
  async function read(requestId) {
    operationId(requestId);const base=join(requests,requestId);
    await initializationDirectory(base);
    const intent=await readJSON(join(base,'intent.json')),complete=await readJSON(join(base,'complete.json'),true);
    need(intent?.schema===CAPTURE&&intent.workspaceId===workspaceId&&intent.requestId===requestId,
      'APPLICATION_INPUT_EDITION_REQUEST_CHANGED');
    validatedCapture(intent);
    if(complete)need(complete.requestId===requestId&&complete.intentSha256===identity(intent)&&
      complete.setId===intent.review.setId,'APPLICATION_INPUT_EDITION_RESULT_CHANGED');
    return {intent,complete,requestId,phase:complete?'CAPTURED':'CAPTURING',
      setId:intent.review.setId,parentSetId:intent.review.parentSetId};
  }
  async function ready(requestId) {
    const saved=await read(requestId);need(saved.complete,'APPLICATION_INPUT_EDITION_INCOMPLETE',undefined,409);
    const source=await model().applicationInputSetInspect({setId:saved.setId});
    need(source.phase==='READY'&&same(source.manifest,saved.intent.review.manifest),'APPLICATION_INPUT_EDITION_SOURCE_CHANGED');
    return {...saved,source};
  }
  async function imported(requestId) {
    operationId(requestId);const base=join(imports,requestId);
    await initializationDirectory(base);
    const intent=await readJSON(join(base,'intent.json')),complete=await readJSON(join(base,'complete.json'),true);
    need(intent?.schema===HANDOFF&&intent.workspaceId===workspaceId&&intent.requestId===requestId&&
      intent.documentSha256===identity(intent.document),'APPLICATION_INPUT_EDITION_RECEIVE_CHANGED');
    if(complete)need(complete.requestId===requestId&&complete.intentSha256===identity(intent)&&
      complete.setId===intent.document.current.setId,'APPLICATION_INPUT_EDITION_RECEIVE_CHANGED');
    return {requestId,phase:complete?'RECEIVED':'RECEIVING',documentSha256:intent.documentSha256,
      origin:intent.document,createdAt:intent.createdAt,setId:intent.document.current.setId};
  }
  async function records(where) {
    try{await initializationDirectory(where);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const found=[];
    for(const name of await readdir(where))if(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)&&
      await readJSON(join(where,name,'intent.json'),true))found.push(name);
    return found;
  }
  const api={
    async applicationInputSetEditionReview(input) {
      fields(input,['selectionRequestId','name']);await live();operationId(input.selectionRequestId);
      const selection=await model().applicationInputSetSelection({requestId:input.selectionRequestId});
      need(selection.phase==='PREPARED','APPLICATION_INPUT_EDITION_WORKING_REQUIRED',undefined,409);
      const source=await readApplicationInputSetDirectory({directory:selection.directory,name:input.name??selection.manifest.name});
      return reviewValue(workspaceId,selection,source.manifest);
    },
    async applicationInputSetEditionRead(input) {
      fields(input,['requestId']);await live();return read(input.requestId);
    },
    async applicationInputSetEditionReceived(input) {
      fields(input,['requestId']);await live();return imported(input.requestId);
    },
    async applicationInputSetEditionsState(input={}) {
      fields(input,['selectionRequestId','offset','limit']);await live();
      if(input.selectionRequestId)operationId(input.selectionRequestId);
      const offset=input.offset??0,limit=input.limit??20;
      need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'APPLICATION_INPUT_EDITION_PAGE_INVALID');
      const items=[];
      for(const id of await records(requests)) {
        const value=await read(id);
        if(!input.selectionRequestId||value.intent.review.selectionRequestId===input.selectionRequestId)items.push(value);
      }
      items.sort((a,b)=>b.intent.createdAt.localeCompare(a.intent.createdAt)||a.requestId.localeCompare(b.requestId));
      const received=[];
      if(!input.selectionRequestId)for(const id of await records(imports)) {
        const row=await imported(id);received.push({requestId:id,phase:row.phase,setId:row.setId,
          name:row.origin.current.manifest.name,originWorkspaceId:row.origin.originWorkspaceId,createdAt:row.createdAt});
      }
      received.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.requestId.localeCompare(b.requestId));
      return {workspaceId,items:items.slice(offset,offset+limit).map(row=>({requestId:row.requestId,
        phase:row.phase,setId:row.setId,parentSetId:row.parentSetId,name:row.intent.review.manifest.name,
        selectionRequestId:row.intent.review.selectionRequestId,createdAt:row.intent.createdAt,
        files:row.intent.review.manifest.files.length,changes:row.intent.review.changes.filter(item=>item.change!=='UNCHANGED').length})),
        received:{items:received.slice(offset,offset+limit),total:received.length},offset,limit,total:items.length};
    },
    async applicationInputSetEditionCapture(input) {
      fields(input,['requestId','review']);operationId(input.requestId);validatedReview(input.review);
      return mutate(async()=>{
        await initializationDirectory(requests,{create:true});const base=join(requests,input.requestId);
        await initializationDirectory(base,{create:true});
        const prior=await readJSON(join(base,'intent.json'),true);
        if(prior) {
          need(same(prior.review,input.review),'APPLICATION_INPUT_EDITION_REQUEST_REUSED',undefined,409);
          const saved=await read(input.requestId);if(saved.complete)return ready(input.requestId);
        }
        const inspected=await current(input.review);
        const intent=await retainInitializationRecord(join(base,'intent.json'),{
          schema:CAPTURE,workspaceId,requestId:input.requestId,review:input.review,
          selection:{requestId:inspected.selected.requestId,setId:inspected.selected.setId,
            directory:inspected.selected.directory,path:inspected.selected.path,memberPath:inspected.selected.memberPath,
            kind:inspected.selected.kind,field:inspected.selected.field},
          createdAt:new Date().toISOString()},{resume:true,ignore:['createdAt']});
        // The exact review is durable before any upload. Ordinary uploads keep
        // complete unchanged files and acknowledged chunks across interruption.
        const captured=await retainApplicationInputSetDirectory(model(),{
          directory:inspected.selected.directory,name:input.review.manifest.name,expectedManifest:input.review.manifest});
        need(captured.setId===input.review.setId&&same(captured.manifest,input.review.manifest),
          'APPLICATION_INPUT_EDITION_WORKING_CHANGED',undefined,409);
        await current(input.review);
        await retainInitializationRecord(join(base,'complete.json'),{
          requestId:input.requestId,intentSha256:identity(intent),setId:captured.setId},{resume:true});
        return ready(input.requestId);
      });
    },
    async applicationInputSetEditionExport(input) {
      fields(input,['requestId','directory']);const output=resolve(input.directory);
      return mutate(async()=>{
        const saved=await ready(input.requestId);
        const document={schema:HANDOFF,originWorkspaceId:workspaceId,capture:saved.intent,completion:saved.complete,
          parent:{setId:saved.parentSetId,manifest:saved.intent.review.parentManifest,path:'parent'},
          current:{setId:saved.setId,manifest:saved.intent.review.manifest,path:'current'}};
        await initializationDirectory(output,{create:true});
        const prior=await readJSON(join(output,'edition.json'),true);
        if(!prior)need((await readdir(output)).length===0,'APPLICATION_INPUT_EDITION_EXPORT_NOT_EMPTY');
        await retainInitializationRecord(join(output,'edition.json'),document,{resume:true});
        await model().applicationInputSetExport({setId:saved.parentSetId,directory:join(output,'parent')});
        await model().applicationInputSetExport({setId:saved.setId,directory:join(output,'current')});
        await retainInitializationRecord(join(output,'complete.json'),{
          schema:HANDOFF,documentSha256:identity(document),requestId:input.requestId},{resume:true});
        return {directory:output,documentSha256:identity(document),document};
      });
    },
    async applicationInputSetEditionReceive(input) {
      fields(input,['requestId','directory']);operationId(input.requestId);const sourceRoot=resolve(input.directory);
      return mutate(async()=>{
        await initializationDirectory(sourceRoot);
        const document=await readJSON(join(sourceRoot,'edition.json')),completion=await readJSON(join(sourceRoot,'complete.json'));
        need(document?.schema===HANDOFF&&document.capture?.schema===CAPTURE&&
          completion?.schema===HANDOFF&&completion.documentSha256===identity(document)&&
          completion.requestId===document.capture.requestId&&document.capture.workspaceId===document.originWorkspaceId,
          'APPLICATION_INPUT_EDITION_HANDOFF_CHANGED');
        validatedCapture(document.capture);
        const review=document.capture.review;
        need(document.completion?.requestId===document.capture.requestId&&
          document.completion.intentSha256===identity(document.capture)&&document.completion.setId===review.setId&&
          document.parent?.path==='parent'&&document.current?.path==='current'&&
          document.parent.setId===review.parentSetId&&document.current.setId===review.setId&&
          same(document.parent.manifest,review.parentManifest)&&same(document.current.manifest,review.manifest),
          'APPLICATION_INPUT_EDITION_HANDOFF_CHANGED');
        const sources=[];
        for(const key of ['parent','current']) {
          const expected=document[key],base=join(sourceRoot,key),manifest=await readJSON(join(base,'input-set.json')),
            done=await readJSON(join(base,'complete.json'));
          need(manifest?.schema==='stellar-forge.runtime-application-input-set-export.v1'&&
            manifest.workspaceId===document.originWorkspaceId&&manifest.setId===expected.setId&&same(manifest.manifest,expected.manifest)&&
            done?.setId===expected.setId&&done.manifestSha256===hash(json(manifest)),
            'APPLICATION_INPUT_EDITION_HANDOFF_CHANGED');
          const source=await readApplicationInputSetDirectory({directory:join(base,'originals'),name:expected.manifest.name});
          need(same(source.manifest,expected.manifest),'APPLICATION_INPUT_EDITION_HANDOFF_CHANGED');
          sources.push({key,source});
        }
        await initializationDirectory(imports,{create:true});const destination=join(imports,input.requestId);
        await initializationDirectory(destination,{create:true});
        const imported=await retainInitializationRecord(join(destination,'intent.json'),{
          schema:HANDOFF,workspaceId,requestId:input.requestId,documentSha256:identity(document),document,
          createdAt:new Date().toISOString()},{resume:true,ignore:['createdAt']});
        for(const {key,source} of sources) {
          const saved=await retainApplicationInputSetDirectory(model(),{directory:source.directory,name:source.manifest.name,expectedManifest:source.manifest});
          need(saved.setId===document[key].setId,'APPLICATION_INPUT_EDITION_HANDOFF_CHANGED');
        }
        // Reopen the complete source wrapper before acknowledging this receive.
        need(same(document,await readJSON(join(sourceRoot,'edition.json')))&&
          same(completion,await readJSON(join(sourceRoot,'complete.json'))),'APPLICATION_INPUT_EDITION_HANDOFF_CHANGED');
        await retainInitializationRecord(join(destination,'complete.json'),{
          requestId:input.requestId,intentSha256:identity(imported),setId:review.setId},{resume:true});
        return {schema:HANDOFF,workspaceId,requestId:input.requestId,phase:'RECEIVED',
          documentSha256:identity(document),origin:document,
          source:await model().applicationInputSetInspect({setId:review.setId})};
      });
    },
  };
  return api;
}
