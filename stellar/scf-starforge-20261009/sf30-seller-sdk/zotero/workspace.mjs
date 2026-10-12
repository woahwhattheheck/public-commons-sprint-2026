// MIT. Complete saved Zotero collection projects over the original Research dossier.
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {join,isAbsolute,resolve} from 'node:path';
import {openDossierStore} from '../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs';
import {SCHEMA,need,plain,clone,json,parse,sha256,profile as compileProfile,id,requestId,revision,text,now,key,collectionScope} from './contracts.mjs';
import {openZoteroStore} from './store.mjs';
import {createZoteroCapturer,newCapture,restartCaptureState} from './capture.mjs';
import {decodeDocumentSet,buildEdition,compareEditions,selectedItems,projectView,researchSourceBundle} from './source.mjs';
import {exportWorkspace,receiveWorkspace,resolveResearchTarget,receivedResearchDirectory} from './transfer.mjs';

const ref=(kind,value)=>({record:{kind,id:value.id,revision:value.revision}});
const researchIdentity=directory=>'research_'+sha256(Buffer.from(directory));
export async function openZoteroWorkspace({directory,researchDirectory=null,dossierStore=null,fetchImpl,environment,transport=null}={}) {
  const store=await openZoteroStore(directory);
  let dossiers,capturer,closing=false,closePromise;
  const pending=new Set(),handoffWork=new Map(),admission=new AsyncLocalStorage(),admittedToken={};
  try{
    need(researchDirectory===null||isAbsolute(researchDirectory)&&resolve(researchDirectory)===researchDirectory,
      'ZOTERO_RESEARCH_DIRECTORY_INVALID');
    const selectedResearchDirectory=researchDirectory??(!dossierStore?await receivedResearchDirectory(store):null);
    dossiers=dossierStore??(selectedResearchDirectory?await openDossierStore(selectedResearchDirectory):null);
    capturer=createZoteroCapturer(store,{...(fetchImpl?{fetchImpl}:{}),...(environment?{environment}: {}),transport});
    const live=()=>need(!closing||admission.getStore()===admittedToken,'ZOTERO_WORKSPACE_CLOSING');
    const track=promise=>{pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;};
    function admit(work){
      if(admission.getStore()===admittedToken)return Promise.resolve().then(work);
      need(!closing,'ZOTERO_WORKSPACE_CLOSING');
      return track(Promise.resolve().then(()=>admission.run(admittedToken,work)));
    }
    const publicCall=method=>(...args)=>admit(()=>method(...args));
    const resolveResult=result=>({...result,...(result.record?{value:store.get(result.record.kind,result.record.id,result.record.revision)}:{})});
    const action=(op,method,input,work)=>{live();return resolveResult(store.action(op,method,input,work));};
    async function edition(editionId) {
      const record=store.get('edition',editionId);
      const value=parse(await store.objectBytes(record.body));
      need(value.schema===SCHEMA.edition&&value.id===record.id,'ZOTERO_EDITION_IDENTITY_CHANGED');
      return value;
    }
    async function documentsFor(value) {
      const record=store.get('edition',value.id);
      const index=new Map(record.documents.map(d=>[d.name,d.object]));
      return Promise.all(value.documents.map(async d=>{
        const object=index.get(d.name);need(object,'ZOTERO_EDITION_SOURCE_MISSING');
        const bytes=await store.objectBytes(object);
        need(bytes.length===d.bytes&&sha256(bytes)===d.sha256,'ZOTERO_EDITION_SOURCE_CHANGED');
        return {...d,bytes};
      }));
    }
    function captureView(captureId) {
      const value=store.get('capture',captureId),active=capturer.live(captureId);
      return {...value,active,displayStatus:value.status==='RUNNING'&&!active?'INTERRUPTED':value.status};
    }
    function saveProfile(input,op) {
      need(plain(input),'ZOTERO_PROFILE_INPUT_REQUIRED');
      const definition=compileProfile(input.definition),recordId=input.id??'profile:'+requestId(op);
      const expected=input.expectedRevision??0;
      return action(op,'profile.save',{id:recordId,expectedRevision:expected,definition},()=>{
        return ref('profile',store.put('profile',recordId,expected,definition));
      });
    }
    function capture(input,op) {
      const p=store.get('profile',input.profileId,revision(input.profileRevision));
      const result=action(op,'capture.prepare',{profileId:p.id,profileRevision:p.revision},()=>{
        const record=store.put('capture','capture:'+requestId(op),0,newCapture(p,capturer.transport));return {...ref('capture',record),effect:{attempt:record.attempt,revision:record.revision}};
      });
      const current=store.get('capture',result.record.id),effect=result.effect;
      const runtime=!closing&&effect&&current.attempt===effect.attempt&&current.revision===effect.revision?
        capturer.start(result.record.id,{attempt:effect.attempt}):{active:capturer.live(result.record.id),reused:true,effectReconciled:true};
      return {...result,value:captureView(result.record.id),runtime};
    }
    function captureControl(input,op) {
      need(['resume','cancel','restart'].includes(input.operation),'ZOTERO_CAPTURE_CONTROL_INVALID');
      const result=action(op,'capture.'+input.operation,{id:id(input.id),operation:input.operation},()=>{
        const current=store.get('capture',input.id);
        let record;
        if(input.operation==='restart'){
          need(!capturer.live(input.id),'ZOTERO_CAPTURE_ALREADY_RUNNING');
          record=store.put('capture',input.id,current.revision,restartCaptureState(current));
        }else if(input.operation==='cancel'){
          if(['COMPLETE','SOURCE_CHANGED'].includes(current.status))return {...ref('capture',current),effect:null};
          record=store.put('capture',input.id,current.revision,{...current,cancelRequested:true,
            status:capturer.live(input.id)?current.status:'CANCELLED',stoppedAt:now()});
        }else{
          need(current.status!=='SOURCE_CHANGED','ZOTERO_CAPTURE_RESTART_REQUIRED');
          if(current.status==='COMPLETE')return {...ref('capture',current),effect:null};
          record=store.put('capture',input.id,current.revision,{...current,cancelRequested:false});
        }
        return {...ref('capture',record),effect:{attempt:record.attempt,revision:record.revision,operation:input.operation}};
      });
      const current=store.get('capture',input.id),effect=result.effect;
      if(effect&&current.attempt===effect.attempt&&current.revision===effect.revision){
        if(effect.operation==='cancel')capturer.cancel(input.id,{attempt:effect.attempt});
        else if(!closing)capturer.start(input.id,{attempt:effect.attempt});
      }
      return {...result,value:captureView(input.id)};
    }
    async function importDocuments(input,op) {
      live();const p=store.get('profile',input.profileId,revision(input.profileRevision));
      const prepared=decodeDocumentSet(input.bytes,p),source=await store.putObject(prepared.raw);
      const originals=[];
      for(const d of prepared.documents)originals.push({name:d.name,object:await store.putObject(d.bytes)});
      const value=buildEdition({profile:p,documents:prepared.documents,coverage:prepared.coverage,
        createdAt:input.createdAt??now()});
      let found=null;try{found=store.get('edition',value.id);}catch(e){if(e.code!=='ZOTERO_RECORD_NOT_FOUND')throw e;}
      const body=found?.body??await store.putObject(json(value));
      return action(op,'documents.import',{profileId:p.id,profileRevision:p.revision,source},()=>{
        let old=null;try{old=store.get('edition',value.id);}catch(e){if(e.code!=='ZOTERO_RECORD_NOT_FOUND')throw e;}
        if(old)return ref('edition',old);
        return ref('edition',store.put('edition',value.id,0,{schema:SCHEMA.edition,body,originalDocumentSet:source,
          counts:value.counts,library:value.library,coverage:value.coverage,label:value.label,documents:originals,
          profileId:p.id,profileRevision:p.revision,createdAt:value.createdAt}));
      });
    }
    async function saveProject(input,op) {
      live();need(plain(input),'ZOTERO_PROJECT_REQUIRED');
      const recordId=input.id??'project:'+requestId(op),expected=input.expectedRevision??0;
      const original=expected?store.get('project',recordId,expected):null;
      const e=await edition(input.editionId??original?.editionId);
      const scope=clone(input.scope??original?.scope??e.scope);
      need(plain(scope)&&Array.isArray(scope.collectionKeys)&&scope.collectionKeys.length<=1000&&
        typeof(scope.includeDescendants??true)==='boolean','ZOTERO_SCOPE_INVALID');
      scope.collectionKeys=[...new Set(scope.collectionKeys.map(key))];scope.includeDescendants??=true;
      collectionScope(scope,e.collections);
      const decisions=clone(input.decisions??original?.decisions??{});
      need(plain(decisions),'ZOTERO_DECISIONS_INVALID');
      const available=new Set(e.items.map(r=>r.key)),oldAvailable=original?new Set((await edition(original.editionId)).items.map(r=>r.key)):new Set();
      for(const [k,d]of Object.entries(decisions)){
        key(k);need(available.has(k)||oldAvailable.has(k)||Object.hasOwn(original?.decisions??{},k),'ZOTERO_DECISION_ITEM_NOT_IN_EDITION');
        need(plain(d)&&typeof d.selected==='boolean'&&['unreviewed','supports','contradicts','background'].includes(d.classification),
          'ZOTERO_DECISION_INVALID');text(d.note??'','ZOTERO_DECISION_NOTE_INVALID',100000,true);d.note??='';
      }
      const visible=new Set(selectedItems(e,scope).map(r=>r.key));
      const findings=clone(input.findings??original?.findings??[]);
      need(Array.isArray(findings)&&findings.length<=1000,'ZOTERO_FINDINGS_INVALID');
      const found=new Set();
      for(const f of findings){
        need(plain(f),'ZOTERO_FINDING_INVALID');id(f.id);need(!found.has(f.id),'ZOTERO_FINDING_DUPLICATE');found.add(f.id);
        text(f.title,'ZOTERO_FINDING_TITLE_REQUIRED',240);text(f.text,'ZOTERO_FINDING_TEXT_REQUIRED',100000);
        need(Array.isArray(f.itemKeys)&&f.itemKeys.length>0&&f.itemKeys.every(k=>visible.has(key(k))),'ZOTERO_FINDING_SOURCE_OUTSIDE_VIEW');
        f.itemKeys=[...new Set(f.itemKeys)];
      }
      const definition={schema:SCHEMA.project,title:text(input.title??original?.title,'ZOTERO_PROJECT_TITLE_REQUIRED',240),
        description:text(input.description??original?.description??'','ZOTERO_PROJECT_DESCRIPTION_INVALID',20000,true),
        editionId:e.id,libraryIdentity:e.libraryIdentity,scope,decisions,findings};
      return action(op,'project.save',{id:recordId,expectedRevision:expected,definition},()=>{
        return ref('project',store.put('project',recordId,expected,definition));
      });
    }
    async function decide(input,op) {
      live();const p=store.get('project',input.projectId,revision(input.expectedRevision)),decisions=clone(p.decisions);
      need(Array.isArray(input.changes)&&input.changes.length>0&&input.changes.length<=50000,'ZOTERO_DECISION_CHANGES_REQUIRED');
      for(const c of input.changes){need(plain(c),'ZOTERO_DECISION_INVALID');key(c.key);
        decisions[c.key]={selected:c.selected,classification:c.classification,note:c.note??''};}
      return saveProject({...p,id:p.id,expectedRevision:p.revision,decisions},op);
    }
    async function compare(input,op) {
      live();const before=await edition(input.before),after=await edition(input.after),value=compareEditions(before,after);
      const body=await store.putObject(json(value));
      return action(op,'edition.compare',{before:before.id,after:after.id},()=>{
        return ref('comparison',store.put('comparison','comparison:'+requestId(op),0,{
          schema:value.schema,before:before.id,after:after.id,summary:value.summary,body}));
      });
    }
    async function viewProject(recordId,at=null) {
      live();const p=store.get('project',recordId,at);return projectView(p,await edition(p.editionId));
    }
    async function pageProject(input) {
      live();const p=store.get('project',input.id,input.revision??null);
      return projectView(p,await edition(p.editionId),{offset:input.offset??0,limit:input.limit??50,
        query:input.query??'',includeOriginal:false});
    }
    async function prepareHandoff(input,op) {
      live();need(dossiers,'ZOTERO_RESEARCH_WORKSPACE_NOT_CONFIGURED');
      const p=store.get('project',input.projectId,revision(input.projectRevision)),e=await edition(p.editionId);
      const original=await documentsFor(e);
      const targetWorkspaceId=researchIdentity(dossiers.directory),target={workspaceId:targetWorkspaceId,dossierId:input.dossierId,questionId:input.questionId};
      const prepared=await researchSourceBundle({project:p,edition:e,documents:original,workspaceId:store.identity.workspaceId});
      const object=await store.putObject(prepared.bytes);
      const preview=await dossiers.previewSourceBundle(target.dossierId,{questionId:target.questionId,rawBytes:prepared.bytes});
      return action(op,'research.prepare',{projectId:p.id,projectRevision:p.revision,target,bundleSha256:object.sha256},()=>{
        return ref('handoff',store.put('handoff','handoff:'+requestId(op),0,{schema:'stellar-forge.zotero-research-handoff.v1',
          projectId:p.id,projectRevision:p.revision,editionId:e.id,target,object,preview,status:'PREPARED',receiveRequests:[],result:null}));
      });
    }
    function receiveHandoff(input,op) {
      live();need(dossiers,'ZOTERO_RESEARCH_WORKSPACE_NOT_CONFIGURED');requestId(op);
      const fingerprint=sha256(json({id:id(input.id),expectedDossierRevision:revision(input.expectedDossierRevision)}));
      const existing=handoffWork.get(op);if(existing){need(existing.fingerprint===fingerprint,'ZOTERO_REQUEST_INPUT_CHANGED');return existing.promise;}
      const promise=(async()=>{
        const initial=store.get('handoff',input.id);
        const originalTarget=await resolveResearchTarget(store,initial.target,{dossiers});
        const targetRevision=revision(input.expectedDossierRevision);
        action(op,'research.receive',{id:initial.id,expectedDossierRevision:targetRevision},()=>{
          const current=store.get('handoff',initial.id);
          if(current.status==='RECEIVED')return ref('handoff',current);
          return ref('handoff',store.put('handoff',current.id,current.revision,{...current,status:'RECEIVING',
            receiveRequests:[...current.receiveRequests,{requestId:op,expectedDossierRevision:targetRevision,startedAt:now()}]}));
        });
        const current=store.get('handoff',initial.id);if(current.status==='RECEIVED')return current;
        try{
          const bytes=await store.objectBytes(current.object);
          const result=await originalTarget.receiveSourceBundle(current.target.dossierId,{questionId:current.target.questionId,
            rawBytes:bytes,expectedBundleSha256:current.object.sha256,expectedRevision:targetRevision,projection:'metadata'});
          const adopted=result.editions.find(e=>e.questionId===current.target.questionId&&e.raw?.sha256===current.object.sha256);
          need(adopted,'ZOTERO_RESEARCH_RECEIPT_MISSING');
          return store.transaction(()=>{const latest=store.get('handoff',current.id);
            if(latest.status==='RECEIVED')return latest;
            return store.put('handoff',latest.id,latest.revision,{...latest,status:'RECEIVED',lastError:null,result:{
              workspaceId:latest.target.workspaceId,dossierId:result.id,dossierRevision:result.revision,
              questionId:latest.target.questionId,editionId:adopted.id,sourceBundleSha256:latest.object.sha256,receivedAt:now()}});
          });
        }catch(error){
          store.transaction(()=>{const latest=store.get('handoff',current.id);if(latest.status!=='RECEIVED')
            store.put('handoff',latest.id,latest.revision,{...latest,status:'RECEIVE_REQUIRED',
              lastError:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'RESEARCH_RECEIVE_FAILED'});});throw error;
        }
      })();
      handoffWork.set(op,{fingerprint,promise});promise.finally(()=>handoffWork.delete(op)).catch(()=>{});return promise;
    }
    async function download(input) {
      live();const record=store.get(input.kind,input.id,input.revision??null);
      let object,name;
      if(input.kind==='edition'&&input.role==='document'){
        const selected=record.documents.find(d=>d.name===input.name);need(selected,'ZOTERO_DOCUMENT_NOT_FOUND');
        object=selected.object;name=selected.name;
      }else if(input.kind==='edition'||input.kind==='comparison'){object=record.body;name=input.kind+'.json';}
      else if(input.kind==='handoff'){object=record.object;name='zotero-research-source-bundle.json';}
      else {return {bytes:json(record),filename:input.kind+'.json',mediaType:'application/json'};}
      return {bytes:await store.objectBytes(object),filename:name,mediaType:'application/json',sha256:object.sha256};
    }
    async function snapshot() {
      live();const kinds=['profile','capture','edition','project','comparison','handoff'],result={};
      for(const kind of kinds){
        const page=store.list(kind,{limit:100});
        result[kind]={...page,rows:page.rows.map(r=>kind==='capture'?captureView(r.id):
          kind==='profile'?r:kind==='project'?r:kind==='handoff'?r:r)};
      }
      return {schema:SCHEMA.api,workspaceId:store.identity.workspaceId,transport:capturer.transport,researchWorkspaceId:dossiers?researchIdentity(dossiers.directory):null,
        records:result,research:dossiers?await dossiers.list():[]};
    }
    async function invoke(method,input={},op=null) {
      live();
      if(method==='state')return snapshot();
      if(method==='record.get')return store.get(input.kind,input.id,input.revision??null);
      if(method==='record.list')return store.list(input.kind,input);
      if(method==='record.history')return store.history(input.kind,input.id);
      if(method==='edition.get')return edition(input.id);
      if(method==='project.get')return viewProject(input.id,input.revision??null);
      if(method==='project.page')return pageProject(input);
      if(method==='capture.get')return captureView(input.id);
      if(method==='research.get'){need(dossiers,'ZOTERO_RESEARCH_WORKSPACE_NOT_CONFIGURED');return dossiers.getMetadata(input.id);}
      if(method==='research.preview'){need(dossiers,'ZOTERO_RESEARCH_WORKSPACE_NOT_CONFIGURED');const h=store.get('handoff',input.id);
        const originalTarget=await resolveResearchTarget(store,h.target,{dossiers});
        return originalTarget.previewSourceBundle(h.target.dossierId,{questionId:h.target.questionId,rawBytes:await store.objectBytes(h.object)});}
      requestId(op);
      const methods={'profile.save':saveProfile,'capture.prepare':capture,'capture.control':captureControl,'documents.import':importDocuments,
        'project.save':saveProject,'project.decide':decide,'edition.compare':compare,'research.prepare':prepareHandoff,'research.receive':receiveHandoff};
      need(methods[method],'ZOTERO_METHOD_INVALID');
      return methods[method](input,op);
    }
    async function close() {
      if(closePromise)return closePromise;closing=true;
      closePromise=(async()=>{
        const errors=[];
        const stopCaptures=capturer.close();
        const settled=await Promise.allSettled([...pending,stopCaptures]);errors.push(...settled.filter(r=>r.status==='rejected').map(r=>r.reason));
        try{store.close();}catch(e){errors.push(e);}
        // Borrowed original Dossier stores have no owned listener/process to stop.
        if(errors.length)throw new AggregateError(errors,'ZOTERO_WORKSPACE_CLOSE_FAILED');
      })();return closePromise;
    }
    return {directory,get identity(){return store.identity;},
      invoke:publicCall(invoke),snapshot:publicCall(snapshot),saveProfile:publicCall(saveProfile),
      capture:publicCall(capture),captureControl:publicCall(captureControl),importDocuments:publicCall(importDocuments),
      saveProject:publicCall(saveProject),decide:publicCall(decide),compare:publicCall(compare),edition:publicCall(edition),
      documentsFor:publicCall(documentsFor),viewProject:publicCall(viewProject),pageProject:publicCall(pageProject),prepareHandoff:publicCall(prepareHandoff),
      receiveHandoff:publicCall(receiveHandoff),download:publicCall(download),captureView:publicCall(captureView),
      waitCapture:publicCall(capturer.wait),exportWorkspace:publicCall(op=>exportWorkspace(store,op,{dossiers})),close};

  }catch(error){try{await capturer?.close();}finally{store.close();}throw error;}
}
export {receiveWorkspace};
