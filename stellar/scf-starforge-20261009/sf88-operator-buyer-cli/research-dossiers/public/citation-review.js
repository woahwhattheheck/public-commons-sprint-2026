// MIT. Citation-update review UI over the original Research dossier API.
import {renderOriginalRecordControl} from './source-inspection.js';

const SCHEMA='sf88-citation-update-review.v1';
const CACHE='research-citation-review-browser-v1';
const PAGE_SIZE=30;
const MAX_REVIEW_BYTES=16*1024*1024;
const CLASSIFICATIONS=['unreviewed','supports','contradicts','background'];
const DECISIONS=[['','Choose a review decision'],['retain','Retain'],['revise','Revise'],['exclude','Exclude'],['follow-up','Follow up']];
const DISPOSITIONS=[['','Choose a finding disposition'],['unchanged','Unchanged'],['revised','Revised'],['citation-removed','Affected citations removed'],['follow-up','Follow up']];
const arr=value=>Array.isArray(value)?value:[];
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const now=()=>new Date().toISOString();
const uid=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const error=(code,message)=>Object.assign(new Error(message),{code,detail:message});
const need=(condition,code,message)=>{if(!condition)throw error(code,message);};
const labelDate=value=>{if(!value)return 'Date unavailable';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString();};
const node=(tag,value,className)=>{const el=document.createElement(tag);if(value!==undefined&&value!==null)el.textContent=String(value);if(className)el.className=className;return el;};
const option=(value,title)=>{const item=node('option',title);item.value=value;return item;};
const formatStatus=value=>({PENDING:'Pending review',REVIEW_AGAIN:'Review again',REVIEWED:'Reviewed',FOLLOW_UP:'Follow up'}[value]||String(value||'Pending review'));
const safeUrl=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}};
const scope=(dossierId,noticeId)=>JSON.stringify([dossierId,noticeId]);
const selectedEvidence=item=>({selected:!!item.selected,classification:item.classification||'unreviewed',note:item.note||''});
const selectedFinding=item=>({title:item.title||'',text:item.text||'',occurrenceIds:[...arr(item.occurrenceIds)]});
const bodySize=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const downloadBytes=(bytes,name,type)=>{
  const url=URL.createObjectURL(new Blob([bytes],{type})),link=node('a');
  link.href=url;link.download=name;link.hidden=true;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
};

/** Browser drafts and original unsatisfied requests; saved reviews remain in the dossier. */
async function openCache(){
  need(globalThis.indexedDB,'CITATION_BROWSER_STORAGE','This browser cannot reopen citation-review drafts. Use the original local workspace in a browser with IndexedDB enabled.');
  const db=await new Promise((resolve,reject)=>{
    let settled=false;
    const request=indexedDB.open(CACHE,1);
    request.onupgradeneeded=()=>{
      for(const name of ['drafts','pending']){
        const store=request.result.createObjectStore(name,{keyPath:'id'});
        store.createIndex('dossierId','dossierId');
        store.createIndex('scope','scope');
      }
    };
    request.onerror=()=>{if(!settled){settled=true;reject(request.error);}};
    request.onblocked=()=>{if(!settled){settled=true;reject(error('CITATION_BROWSER_STORAGE','Close an older citation-review tab so this browser can reopen its draft database.'));}};
    request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;resolve(request.result);};
  });
  let closed=false;db.onversionchange=()=>{closed=true;db.close();};db.onclose=()=>{closed=true;};
  const transaction=(name,mode,work)=>new Promise((resolve,reject)=>{
    if(closed){reject(error('CITATION_BROWSER_STORAGE','Reload the original workspace to reopen its browser drafts.'));return;}
    let tx,value,failure;
    try{tx=db.transaction(name,mode,mode==='readwrite'?{durability:'strict'}:undefined);}
    catch(cause){reject(cause);return;}
    const stop=cause=>{failure=cause;try{tx.abort();}catch{}};
    const read=(request,callback)=>{request.onsuccess=()=>{try{callback(request.result);}catch(cause){stop(cause);}};};
    tx.oncomplete=()=>resolve(value);
    tx.onabort=()=>reject(failure||tx.error||error('CITATION_BROWSER_STORAGE','The browser did not commit this draft.'));
    try{work(tx.objectStore(name),read,result=>{value=result;},stop);}catch(cause){stop(cause);}
  });
  return {
    drafts:(dossierId,noticeId)=>transaction('drafts','readonly',(store,read,done)=>
      read(store.index('scope').getAll(scope(dossierId,noticeId)),rows=>done(rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))))),
    putDraft:draft=>transaction('drafts','readwrite',(store,read,done)=>{
      const value={...clone(draft),scope:scope(draft.dossierId,draft.noticeId)};
      read(store.get(value.id),old=>{
        need(!old||old.writer===value.writer&&(old.editVersion<value.editVersion||same(old,value)),
          'CITATION_DRAFT_CHANGED','This browser draft changed in another window. Your open edit remains available to download.');
        if(!old||!same(old,value))store.put(value);done(value);
      });
    }),
    removeDraft:(id,expected)=>transaction('drafts','readwrite',(store,read,done)=>{
      read(store.get(id),old=>{const matches=!!old&&same(old,expected);if(matches)store.delete(id);done(matches);});
    }),
    pending:dossierId=>transaction('pending','readonly',(store,read,done)=>
      read(store.index('dossierId').getAll(dossierId),rows=>done(rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))))),
    putPending:entry=>transaction('pending','readwrite',(store,read,done)=>{
      read(store.get(entry.id),old=>{
        need(!old||old.dossierId===entry.dossierId&&same(old.payload,entry.payload),
          'CITATION_REQUEST_CHANGED','Keep the original complete input for this saved request.');
        if(old){done(old);return;}
        read(store.index('dossierId').getAll(entry.dossierId),rows=>{
          need(!rows.some(item=>['READY','UNCERTAIN'].includes(item.state)),
            'CITATION_SAVE_UNRESOLVED','Retry the original pending save before starting another review in this dossier.');
          store.add(clone(entry));done(clone(entry));
        });
      });
    }),
    pendingState:(id,changes)=>transaction('pending','readwrite',(store,read,done)=>{
      read(store.get(id),old=>{need(old,'CITATION_REQUEST_MISSING','The original browser request is unavailable.');
        need(!Object.keys(changes).some(key=>['id','payload','dossierId','noticeId','scope','createdAt','draft'].includes(key)),
          'CITATION_REQUEST_CHANGED','The original request input is immutable.');
        if(old.state==='COMPLETE'){
          if(changes.state==='COMPLETE')need(changes.reply?.review?.id===old.reply?.review?.id&&
            changes.reply?.review?.revision===old.reply?.review?.revision&&
            changes.reply?.review?.requestId===old.id,'CITATION_REVIEW_RECEIPT','This saved request returned a different review.');
          done(old);return;
        }
        const next={...old,...clone(changes),updatedAt:now()};store.put(next);done(next);
      });
    }),
    close(){closed=true;db.close();}
  };
}

export function createCitationReviewPanel({root,tab,api,task,notify,getDossier,isBusy,onReceived}){
  const writer=uid('window_');
  const state={dossier:null,visible:false,loadedRevision:null,page:null,offset:0,status:'all',noticeId:null,
    detail:null,draft:null,drafts:[],pending:[],busy:false,loading:false,loadId:0,detailId:0,
    cache:null,cachePromise:null,persist:Promise.resolve(),storageError:null,conflict:null,lastReply:null};
  const controls={},unacknowledged=new Map(),failedDrafts=new Set();
  const base=(id=state.dossier?.id)=>'/api/dossiers/'+encodeURIComponent(id);
  const busy=()=>state.busy||isBusy();
  const message=(text,kind='info')=>{controls.message.textContent=text;controls.message.dataset.kind=kind;controls.message.hidden=!text;};
  const reportError=cause=>{const value=cause?.detail||cause?.message||String(cause);message(value,'error');notify(value,'error');};
  const cache=async()=>{if(!state.cachePromise)state.cachePromise=openCache().then(value=>state.cache=value)
    .catch(cause=>{state.cachePromise=null;throw cause;});return state.cachePromise;};
  const activity=action=>task(async()=>{
    if(state.busy)return;state.busy=true;updateBusy();
    try{return await action();}catch(cause){reportError(cause);}
    finally{state.busy=false;updateBusy();}
  });
  function button(title,action,className=''){
    const value=node('button',title,className);value.type='button';value.dataset.crAction='1';value.disabled=busy();
    value.addEventListener('click',()=>{if(!busy())activity(action);});return value;
  }
  function hint(title,value){
    const row=node('div',undefined,'cr-meta-row');row.append(node('dt',title),node('dd',value??'Unavailable'));return row;
  }
  function field(title,input){const value=node('label',undefined,'cr-field');value.append(node('span',title),input);return value;}
  function check(title,checked,change){
    const label=node('label',undefined,'cr-check'),input=node('input');input.type='checkbox';input.checked=checked;
    input.addEventListener('change',()=>change(input.checked));label.append(input,node('span',title));return label;
  }
  function textInput(value,max,change,{rows=4,area=true}={}){
    const input=node(area?'textarea':'input');if(area)input.rows=rows;
    input.value=value||'';input.maxLength=max;input.addEventListener('input',()=>change(input.value));return input;
  }
  function selectInput(values,current,change){
    const input=node('select');input.append(...values.map(([value,title])=>option(value,title)));input.value=current||'';
    input.addEventListener('change',()=>change(input.value));return input;
  }
  function question(id){return arr(state.dossier?.questions).find(value=>value.id===id)?.text||id||'Research question';}
  function touch(change){
    need(state.draft,'CITATION_DRAFT_MISSING','Open a citation notice first.');
    if(state.draft.writer!==writer){
      const previous=state.draft.id;
      state.draft={...clone(state.draft),id:uid('draft_'),writer,editVersion:0,derivedFrom:previous,createdAt:now()};
    }
    change(state.draft);state.draft.editVersion++;state.draft.updatedAt=now();
    state.conflict=null;persistDraft();updateDraftStatus();renderConflict();updateBusy();
  }
  function acknowledgeDraft(saved){
    if(same(unacknowledged.get(saved.id),saved)){unacknowledged.delete(saved.id);failedDrafts.delete(saved.id);}
  }
  function retainedDrafts(rows,dossierId,noticeId){
    const selected=new Map(rows.map(value=>[value.id,value]));
    for(const draft of unacknowledged.values())if(draft.dossierId===dossierId&&draft.noticeId===noticeId){
      const old=selected.get(draft.id);
      if(!old||draft.editVersion>=old.editVersion)selected.set(draft.id,clone(draft));
    }
    return [...selected.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  function persistDraft(){
    const snapshot={...clone(state.draft),scope:scope(state.draft.dossierId,state.draft.noticeId)};
    unacknowledged.set(snapshot.id,snapshot);
    state.persist=state.persist.catch(()=>{}).then(async()=>{
      const store=await cache();const saved=await store.putDraft(snapshot);acknowledgeDraft(saved);state.storageError=null;
      if(state.draft?.id===saved.id&&state.draft.editVersion===saved.editVersion)updateDraftStatus('Draft saved in this browser.');
      renderPending();return saved;
    }).catch(cause=>{
      failedDrafts.add(snapshot.id);state.storageError=cause;
      updateDraftStatus('Draft is still open; browser storage could not save it. Download the draft before leaving.');
      renderPending();throw cause;
    });
    state.persist.catch(()=>{});
  }
  function initialDraft(detail){
    const source=detail.detail;
    return {id:uid('draft_'),writer,editVersion:0,createdAt:now(),updatedAt:now(),
      dossierId:detail.dossier.id,noticeId:source.noticeId,scope:scope(detail.dossier.id,source.noticeId),
      baseRevision:detail.dossier.revision,baseFingerprint:source.fingerprint,base:clone(source),
      actor:'',decision:'',reason:'',
      evidence:Object.fromEntries(arr(source.evidence).map(item=>[item.occurrenceId,selectedEvidence(item)])),
      findings:Object.fromEntries(arr(source.findings).map(item=>[item.id,{...selectedFinding(item),disposition:'',dispositionReason:''}]))};
  }
  function updateDraftStatus(text){
    if(!controls.draftStatus)return;
    controls.draftStatus.textContent=text||(state.draft?
      'Draft based on dossier revision '+state.draft.baseRevision+'. Changes remain editable until the review is saved.':'');
  }
  async function readPending(){
    const id=state.dossier?.id;if(!id)return;
    try{const rows=await(await cache()).pending(id);if(state.dossier?.id===id){state.pending=rows;renderPending();updateBusy();}}
    catch(cause){state.storageError=cause;message('The original records are open. Browser draft storage is unavailable: '+(cause.message||cause),'error');}
  }
  function loadPage(){
    const key=JSON.stringify([state.dossier?.id,state.dossier?.revision,state.offset,state.status]);
    if(state.pagePromise&&state.pageKey===key)return state.pagePromise;
    state.pageKey=key;
    const pending=performLoadPage();state.pagePromise=pending;
    pending.finally(()=>{if(state.pagePromise===pending)state.pagePromise=null;});
    return pending;
  }
  async function performLoadPage(){
    const dossier=state.dossier;if(!dossier||!state.visible)return;
    const token=++state.loadId;state.loading=true;updateBusy();
    try{
      const query=new URLSearchParams({revision:String(dossier.revision),offset:String(state.offset),limit:String(PAGE_SIZE),status:state.status});
      const result=await api(base(dossier.id)+'/citation-updates?'+query);
      if(token!==state.loadId||state.dossier?.id!==dossier.id||state.dossier?.revision!==dossier.revision)return;
      need(result.schema===SCHEMA&&result.dossier.id===dossier.id&&result.dossier.revision===dossier.revision,
        'CITATION_PAGE_CHANGED','The selected review page belongs to another dossier revision.');
      state.page=result;state.loadedRevision=dossier.revision;renderList();renderCoverage();
      if(state.noticeId)await loadDetail(state.noticeId);
    }catch(cause){if(token===state.loadId)reportError(cause);}
    finally{if(token===state.loadId){state.loading=false;updateBusy();}}
  }
  async function loadDetail(noticeId,{reset=false}={}){
    const dossier=state.dossier;if(!dossier)return;
    const token=++state.detailId;state.noticeId=noticeId;
    controls.detail.setAttribute('aria-busy','true');
    try{
      const result=await api(base(dossier.id)+'/citation-updates?'+new URLSearchParams({revision:String(dossier.revision),noticeId}));
      need(result.schema===SCHEMA&&result.dossier.id===dossier.id&&result.dossier.revision===dossier.revision&&result.detail.noticeId===noticeId,
        'CITATION_DETAIL_CHANGED','The selected original notice identity changed.');
      let drafts=[];try{drafts=await(await cache()).drafts(dossier.id,noticeId);}catch(cause){state.storageError=cause;}
      if(token!==state.detailId||state.dossier?.id!==dossier.id||state.dossier?.revision!==dossier.revision||state.noticeId!==noticeId)return;
      drafts=retainedDrafts(drafts,dossier.id,noticeId);
      state.detail=result;state.drafts=drafts;
      if(reset||state.draft?.dossierId!==dossier.id||state.draft?.noticeId!==noticeId)state.draft=drafts[0]||initialDraft(result);
      if(state.conflict&&!(state.conflict.originalDraftId===state.draft?.id&&
        state.conflict.originalEditVersion===state.draft?.editVersion&&
        state.conflict.latest.dossier.revision===result.dossier.revision&&
        state.conflict.latest.detail.fingerprint===result.detail.fingerprint))state.conflict=null;
      renderList();renderDetail();
    }catch(cause){if(token===state.detailId){reportError(cause);renderDetail();}}
    finally{if(token===state.detailId)controls.detail.removeAttribute('aria-busy');updateBusy();}
  }
  async function refreshCurrent(){
    const id=state.dossier?.id;if(!id)return;
    await state.persist.catch(()=>{});
    const view=await api(base(id));
    if(state.dossier?.id!==id)return;
    state.dossier=view;await onReceived(view);state.loadedRevision=null;
    await readPending();await loadPage();
    message('Current dossier revision '+view.revision+' is open. Your review draft keeps its original base revision.');
  }
  function setDossier(view){
    const changed=view?.id!==state.dossier?.id,revisionChanged=view?.revision!==state.dossier?.revision;
    state.dossier=view;
    if(changed){state.loadId++;state.detailId++;state.page=null;state.loadedRevision=null;state.offset=0;
      state.noticeId=null;state.detail=null;state.draft=null;state.drafts=[];state.pending=[];state.conflict=null;state.lastReply=null;
      renderList();renderDetail();renderPending();if(view)readPending();}
    else if(revisionChanged){state.loadedRevision=null;updateDraftStatus();renderConflict();}
    root.hidden=!state.visible||!view;
    if(state.visible&&view&&state.loadedRevision!==view.revision)queueMicrotask(()=>loadPage());
  }
  function show(visible){
    state.visible=visible;root.hidden=!visible||!state.dossier;
    if(visible&&state.dossier&&state.loadedRevision!==state.dossier.revision)loadPage();
  }
  function updateBusy(){
    for(const el of root.querySelectorAll('[data-cr-edit], [data-cr-action]'))el.disabled=busy();
    controls.refresh.disabled=busy()||state.loading||!state.dossier;
    controls.filter.disabled=busy()||state.loading;
    controls.previous.disabled=busy()||state.loading||state.offset===0;
    controls.next.disabled=busy()||state.loading||state.page?.nextOffset===null||!state.page;
    updateRebaseButton();
    if(controls.save)controls.save.disabled=busy()||!state.draft||!state.detail||
      state.pending.some(item=>['READY','UNCERTAIN'].includes(item.state))||
      state.draft.baseRevision!==state.dossier?.revision||state.draft.baseFingerprint!==state.detail.detail.fingerprint;
  }
  function renderList(){
    const page=state.page;
    controls.counts.replaceChildren(...[['Total',page?.counts?.total],['Pending',page?.counts?.pending],
      ['Reviewed',page?.counts?.reviewed],['Follow up',page?.counts?.followUp]].map(([title,count])=>{
        const item=node('div');item.append(node('strong',count??'—'),node('span',title));return item;
      }));
    controls.list.replaceChildren();
    if(!page){controls.list.append(node('p',state.dossier?'Open Update review to read the retained notices.':'Choose a saved dossier.','muted'));return;}
    if(!page.items.length)controls.list.append(node('p','No registered update notices appear in this selected set of retained editions.','muted'));
    for(const notice of page.items){
      const row=button('',()=>loadDetail(notice.noticeId),'cr-notice'+(state.noticeId===notice.noticeId?' active':''));
      row.dataset.noticeId=notice.noticeId;row.setAttribute('aria-pressed',String(state.noticeId===notice.noticeId));
      row.append(node('span',formatStatus(notice.status),'cr-status'),node('strong',notice.title||notice.noticeDoi),
        node('span',notice.type+' · '+(notice.date||'Date unavailable'),'muted small'),
        node('span',notice.selectedEvidenceCount+' selected evidence · '+notice.findingCount+' affected findings','small'),
        node('span','Updates '+notice.targetDoi,'cr-doi'));
      controls.list.append(row);
    }
    controls.pageStatus.textContent=page.total?
      (page.offset+1)+'–'+(page.offset+page.items.length)+' of '+page.total:'0 notices';
    updateBusy();
  }
  function renderCoverage(){
    controls.coverage.replaceChildren();
    const coverage=arr(state.page?.coverage);
    const details=node('details');details.append(node('summary','Retained lookup coverage · '+coverage.length+' Crossref edition'+(coverage.length===1?'':'s')));
    if(!coverage.length)details.append(node('p','Import an original retained Crossref edition to inspect its registered update notices.','muted small'));
    for(const item of coverage){
      const section=node('section',undefined,'cr-coverage-row');
      section.append(node('strong',item.label||item.editionId),
        node('p','Coverage: '+item.coverage+' · Update lookup: '+item.updatesLookup,'small'),
        node('p','Source representation: '+(item.sourceKind==='retained-document'?'Retained source documents':item.sourceKind==='http-capture'?'Original HTTP captures':'Original retained edition'),'small'),
        node('p','Requested DOIs: '+arr(item.requestedDois).join(', '),'small cr-wrap'));
      if(arr(item.missingUpdates).length)section.append(node('p','Missing update results: '+JSON.stringify(item.missingUpdates),'small cr-wrap'));
      if(arr(item.issues).length)section.append(node('p','Retained issues: '+item.issues.join(', '),'small cr-wrap'));
      details.append(section);
    }
    controls.coverage.append(details);
  }
  function renderPending(){
    controls.pending.replaceChildren();
    const pending=state.pending.filter(value=>['READY','UNCERTAIN'].includes(value.state));
    const unsaved=[...unacknowledged.values()].filter(value=>failedDrafts.has(value.id));
    if(!pending.length&&!unsaved.length){controls.pending.hidden=true;return;}controls.pending.hidden=false;
    if(unsaved.length){
      controls.pending.append(node('h3','Drafts awaiting browser storage'),
        node('p','These complete edits remain in this open page. Download them before closing it.','small'));
      for(const draft of unsaved){
        const row=node('div',undefined,'cr-pending-row');
        row.append(node('span','Dossier '+draft.dossierId+' · base revision '+draft.baseRevision),
          node('code',draft.noticeId),button('Download unsaved draft',async()=>{
            downloadBytes(JSON.stringify({schema:'sf88-citation-review-browser-draft.v1',draft},null,2)+'\n',
              'citation-review-draft-'+draft.id+'.json','application/json');
          },'compact'));
        controls.pending.append(row);
      }
    }
    if(pending.length)controls.pending.append(node('h3','Original saves to reconcile'));
    for(const item of pending){
      const row=node('div',undefined,'cr-pending-row');
      row.append(node('span',(item.state==='UNCERTAIN'?'Reply not retained':'Ready to send')+' · '+labelDate(item.createdAt)),
        node('code',item.id),button('Retry original save',()=>sendPending(item),'compact'));
      controls.pending.append(row);
    }
    if(pending.length)controls.pending.append(node('p','Retry keeps the exact saved request ID and complete input. A review already accepted by the server is reopened.','small muted'));
  }
  async function downloadReport(revision,format){
    const dossierId=state.dossier.id;
    const response=await api(base(dossierId)+'/export?'+new URLSearchParams({format,revision:String(revision)}),{download:true});
    need(response.headers.get('X-Research-Dossier-Revision')===String(revision),
      'CITATION_REPORT_REVISION','The report did not return the selected original dossier revision.');
    const filename=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||
      'research-dossier-revision-'+revision+'.'+format;
    downloadBytes(await response.arrayBuffer(),filename,response.headers.get('content-type')||'application/octet-stream');
    notify('Downloaded dossier revision '+revision+'.');
  }
  function reports(revision,title){
    const box=node('div',undefined,'cr-report-row');box.append(node('span',title+' · revision '+revision));
    for(const [format,label]of [['html','HTML'],['md','Markdown'],['json.gz','Portable dossier']])
      box.append(button(label,()=>downloadReport(revision,format),'compact'));
    return box;
  }
  async function inspectNoticeSource(source,target){
    const dossierId=state.detail.dossier.id,revision=state.detail.dossier.revision;
    const path=base(dossierId)+'/retained-editions/'+encodeURIComponent(source.editionId)+
      '/occurrences/'+encodeURIComponent(source.key)+'?revision='+revision;
    const value=await api(path);
    need(value.edition?.id===source.editionId&&value.edition?.raw?.sha256===source.sourceSha256,
      'CITATION_NOTICE_SOURCE_CHANGED','The inspected source differs from the retained notice binding.');
    target.replaceChildren(node('p',value.source.title||'Original notice result','small'));
    const citation=arr(value.source.citations).find(item=>item.editionId===source.editionId&&String(item.key)===String(source.key));
    need(citation,'CITATION_NOTICE_RECORD','The selected original result record is not present in this source inspection.');
    renderOriginalRecordControl({root:target,citation,dossierId,revision,api,task,notify});
    const original=node('details');original.append(node('summary','Original source inspection'));
    original.addEventListener('toggle',()=>{if(original.open&&!original.querySelector('pre'))
      original.append(node('pre',JSON.stringify(value,null,2),'cr-source-json'));});
    target.append(original);
  }
  async function downloadNoticeEdition(source){
    const response=await api(base(state.detail.dossier.id)+'/retained-editions/'+encodeURIComponent(source.editionId)+
      '?revision='+state.detail.dossier.revision,{download:true});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    need(bytes.byteLength===source.sourceBytes&&hash===source.sourceSha256,
      'CITATION_NOTICE_SOURCE_CHANGED','The original retained notice edition differs from its saved bytes.');
    downloadBytes(bytes,source.editionId+'.research-source.json','application/json');
    notify('Original notice edition downloaded.');
  }
  function renderSources(detail){
    const section=node('details',undefined,'cr-source-section');section.append(node('summary','Original notice assertions and source records'));
    for(const assertion of arr(detail.registeredUpdates).length?detail.registeredUpdates:[detail.registeredUpdate]){
      if(!assertion)continue;const record=node('pre',JSON.stringify(assertion,null,2),'cr-source-json');section.append(record);
    }
    for(const source of arr(detail.noticeSources)){
      const row=node('article',undefined,'cr-source-row');
      row.append(node('h3',source.editionLabel||source.editionId));
      const meta=node('dl',undefined,'cr-meta');
      meta.append(hint('Edition',source.editionId),hint('Record key',source.key),hint('Original source SHA-256',source.sourceSha256),
        hint('Record content SHA-256',source.recordSha256),hint('Question',question(source.questionId)));
      meta.append(hint('Source representation',source.sourceKind==='retained-document'?'Retained source documents':source.sourceKind==='http-capture'?'Original HTTP captures':'Original retained edition'));
      row.append(meta);
      for(const document of arr(source.documents)){
        const entry=node('section',undefined,'cr-document-binding');
        entry.append(node('h4','Original document · '+(document.role||'Source')));
        const fields=node('dl',undefined,'cr-meta');
        fields.append(hint('Document identity',document.documentId),hint('Document SHA-256',document.documentSha256),
          hint('Original body SHA-256',document.bodySha256),hint('Original body bytes',document.bodyBytes));
        if(document.retrievedAt)fields.append(hint('Source retrieval time',labelDate(document.retrievedAt)));
        entry.append(fields);
        const url=safeUrl(document.sourceUrl);if(url){const link=node('a',document.sourceUrl);link.href=url;link.target='_blank';link.rel='noopener noreferrer';entry.append(link);}
        if(arr(document.requestedDois).length)entry.append(node('p','Selected DOI references: '+document.requestedDois.join(', '),'small cr-wrap'));
        if(document.provenance){const provenance=node('details');provenance.append(node('summary','Retained document provenance'));
          provenance.addEventListener('toggle',()=>{if(provenance.open&&!provenance.querySelector('pre'))provenance.append(node('pre',JSON.stringify(document.provenance,null,2),'cr-source-json'));});
          entry.append(provenance);}
        row.append(entry);
      }
      for(const capture of arr(source.captures)){
        const line=node('div',undefined,'cr-capture-line');
        line.append(node('span',(capture.role||'Original capture')+' · '+labelDate(capture.retrievedAt)));
        const url=safeUrl(capture.sourceUrl);if(url){const link=node('a',capture.sourceUrl);link.href=url;link.target='_blank';link.rel='noopener noreferrer';line.append(link);}
        line.append(node('code',capture.captureSha256));row.append(line);
      }
      const actions=node('div',undefined,'cr-actions'),inspection=node('div',undefined,'cr-original-record');
      actions.append(button('Inspect original record',()=>inspectNoticeSource(source,inspection),'compact'),
        button('Download original edition',()=>downloadNoticeEdition(source),'compact'));
      row.append(actions,inspection);section.append(row);
    }
    return section;
  }
  function draftChoices(){
    const choices=state.drafts.filter(item=>item.id!==state.draft?.id);
    if(!choices.length)return null;
    const box=node('details',undefined,'cr-draft-versions');box.append(node('summary',choices.length+' other retained draft version'+(choices.length===1?'':'s')));
    for(const draft of choices){
      box.append(button('Open draft from '+labelDate(draft.updatedAt)+' · revision '+draft.baseRevision,async()=>{
        await state.persist.catch(()=>{});state.draft=clone(draft);state.conflict=null;renderDetail();
      },'compact'));
    }
    return box;
  }
  function renderEvidence(baseDetail,draft){
    const section=node('section',undefined,'cr-evidence');section.append(node('h3','Affected evidence'));
    if(!arr(baseDetail.evidence).length)section.append(node('p','This notice has no matching evidence occurrences in the selected dossier revision.','muted small'));
    for(const item of arr(baseDetail.evidence)){
      const value=draft.evidence[item.occurrenceId]||selectedEvidence(item);
      const row=node('article',undefined,'cr-evidence-row');row.dataset.evidenceId=item.occurrenceId;
      row.append(node('h4',item.title||item.doi||'Original evidence'),
        node('p',question(item.questionId)+' · '+(item.retained?'Retained source':'Saved provider reference'),'small muted'),
        node('code',item.occurrenceId,'cr-record-id'));
      const selected=check('Include this occurrence in selected evidence',!!value.selected,next=>touch(d=>{d.evidence[item.occurrenceId].selected=next;}));
      selected.querySelector('input').dataset.crEdit='1';
      const classification=selectInput(CLASSIFICATIONS.map(label=>[label,label[0].toUpperCase()+label.slice(1)]),value.classification,
        next=>touch(d=>{d.evidence[item.occurrenceId].classification=next;}));classification.dataset.crEdit='1';
      const note=textInput(value.note,100000,next=>touch(d=>{d.evidence[item.occurrenceId].note=next;}),{rows:4});note.dataset.crEdit='1';
      row.append(selected,field('Evidence classification',classification),field('Evidence note',note));section.append(row);
    }
    return section;
  }
  function renderFindings(baseDetail,draft){
    const section=node('section',undefined,'cr-findings');section.append(node('h3','Affected findings'));
    if(!arr(baseDetail.findings).length)section.append(node('p','No saved finding currently cites this notice’s affected evidence.','muted small'));
    for(const original of arr(baseDetail.findings)){
      const value=draft.findings[original.id];
      const row=node('article',undefined,'cr-finding');row.dataset.findingId=original.id;
      row.append(node('h4',original.title||'Saved finding'),node('p',question(original.questionId),'small muted'));
      const title=textInput(value.title,240,next=>touch(d=>{d.findings[original.id].title=next;}),{area:false});title.dataset.crEdit='1';title.required=true;
      const text=textInput(value.text,100000,next=>touch(d=>{d.findings[original.id].text=next;}),{rows:8});text.dataset.crEdit='1';text.required=true;
      row.append(field('Finding title',title),field('Full finding text',text));
      const citations=node('fieldset',undefined,'cr-citations');citations.append(node('legend','Citations for this finding'));
      const options=arr(baseDetail.citationOptions).filter(item=>item.questionId===original.questionId);
      const byId=new Map(options.map(item=>[item.occurrenceId,item]));
      for(const id of value.occurrenceIds)if(!byId.has(id))byId.set(id,{occurrenceId:id,title:'Original citation without a current source projection',retained:false});
      for(const item of byId.values()){
        const label=check(item.title||item.doi||'Source occurrence',value.occurrenceIds.includes(item.occurrenceId),checked=>{
          touch(d=>{const finding=d.findings[original.id];finding.occurrenceIds=checked?
            [...finding.occurrenceIds.filter(id=>id!==item.occurrenceId),item.occurrenceId]:
            finding.occurrenceIds.filter(id=>id!==item.occurrenceId);});
        });
        label.querySelector('input').dataset.crEdit='1';label.querySelector('input').dataset.occurrenceId=item.occurrenceId;
        label.append(node('small',(arr(original.affectedOccurrenceIds).includes(item.occurrenceId)?'Affected citation · ':'')+
          (item.doi||item.occurrenceId),'cr-wrap'));citations.append(label);
      }
      if(!byId.size)citations.append(node('p','This question has no current citation choices.','small muted'));
      const disposition=selectInput(DISPOSITIONS,value.disposition,next=>touch(d=>{d.findings[original.id].disposition=next;}));
      disposition.dataset.crEdit='1';disposition.required=true;disposition.dataset.findingDisposition=original.id;
      const reason=textInput(value.dispositionReason,20000,next=>touch(d=>{d.findings[original.id].dispositionReason=next;}),{rows:3});
      reason.dataset.crEdit='1';reason.required=true;reason.dataset.findingReason=original.id;
      row.append(citations,field('Explicit finding disposition',disposition),field('Reason for this finding’s disposition',reason));section.append(row);
    }
    return section;
  }
  function renderHistory(detail){
    const section=node('section',undefined,'cr-history');section.append(node('h3','Saved review history'));
    if(!arr(detail.reviews).length)section.append(node('p','The selected notice has no saved citation review yet.','muted small'));
    for(const review of [...arr(detail.reviews)].reverse()){
      const entry=node('article',undefined,'cr-history-row');
      entry.append(node('h4',review.decision+' · '+labelDate(review.createdAt)),
        node('p',(review.actor||'Original operator')+' · revision '+review.originalRevision+' → '+review.revision,'small'),
        node('p',review.reason,'cr-full-text'),node('code',review.id,'cr-record-id'));
      entry.append(reports(review.originalRevision,'Previous report'),reports(review.revision,'Reviewed report'));
      const changes=node('details');changes.append(node('summary','Saved evidence, finding and source changes'));
      changes.addEventListener('toggle',()=>{if(changes.open&&!changes.querySelector('pre'))
        changes.append(node('pre',JSON.stringify({notice:review.notice,changes:review.changes,findingDispositions:review.findingDispositions},null,2),'cr-source-json'));});
      entry.append(changes);section.append(entry);
    }
    return section;
  }
  function renderDetail(){
    controls.detail.replaceChildren();controls.save=null;controls.conflict=null;controls.draftStatus=null;
    if(!state.detail||state.detail.detail.noticeId!==state.noticeId||!state.draft){
      controls.detail.append(node('h3','Choose an update notice'),node('p','Review its original assertions, affected evidence and saved findings together.','muted'));
      return;
    }
    const detail=state.detail.detail,draft=state.draft,heading=node('header',undefined,'cr-detail-heading');
    heading.append(node('span',formatStatus(detail.status),'cr-status'),node('h2',detail.title||detail.noticeDoi));
    const metadata=node('dl',undefined,'cr-meta');
    for(const [name,value]of [['Notice DOI',detail.noticeDoi],['Updates DOI',detail.targetDoi],['Registered type',detail.type],
      ['Registered date',detail.date],['Current dossier revision',state.detail.dossier.revision]])metadata.append(hint(name,value));
    heading.append(metadata);controls.detail.append(heading,renderSources(detail));
    const versions=draftChoices();if(versions)controls.detail.append(versions);
    controls.conflict=node('section',undefined,'cr-conflict');controls.conflict.id='citation-review-conflict';controls.detail.append(controls.conflict);
    const editor=node('form',undefined,'cr-editor');editor.id='citation-review-form';
    editor.addEventListener('submit',event=>{event.preventDefault();if(!busy())activity(saveReview);});
    controls.draftStatus=node('p',undefined,'cr-draft-status');controls.draftStatus.setAttribute('role','status');editor.append(controls.draftStatus);
    const identity=node('div',undefined,'cr-review-identity');
    const actor=textInput(draft.actor,200,next=>touch(d=>{d.actor=next;}),{area:false});actor.id='citation-review-actor';actor.dataset.crEdit='1';actor.required=true;
    const decision=selectInput(DECISIONS,draft.decision,next=>touch(d=>{d.decision=next;}));decision.id='citation-review-decision';decision.dataset.crEdit='1';decision.required=true;
    const reason=textInput(draft.reason,20000,next=>touch(d=>{d.reason=next;}),{rows:5});reason.id='citation-review-reason';reason.dataset.crEdit='1';reason.required=true;
    identity.append(field('Reviewer',actor),field('Overall review decision',decision));
    editor.append(identity,field('Review reason',reason),node('p','The decision records your conclusion. Evidence and finding controls below specify the exact content changes saved in the same revision.','small muted'),
      renderEvidence(draft.base,draft),renderFindings(draft.base,draft));
    const actions=node('div',undefined,'cr-actions');
    controls.save=node('button','Save complete review','primary');controls.save.type='submit';controls.save.id='citation-save-review';
    actions.append(controls.save,button('Download draft',async()=>{
      await state.persist.catch(()=>{});
      downloadBytes(JSON.stringify({schema:'sf88-citation-review-browser-draft.v1',draft:state.draft},null,2)+'\n',
        'citation-review-draft-'+state.draft.id+'.json','application/json');
    }),button('Discard this draft',async()=>{
      await state.persist.catch(()=>{});const old=clone(state.draft);
      await(await cache()).removeDraft(old.id,old);acknowledgeDraft(old);state.draft=initialDraft(state.detail);
      state.drafts=state.drafts.filter(item=>item.id!==old.id);state.conflict=null;renderDetail();message('This browser draft was discarded. The saved dossier and review history are unchanged.');
    },'quiet'));
    editor.append(actions);controls.detail.append(editor,reports(state.detail.dossier.revision,'Current report'),renderHistory(detail));
    renderConflict();updateDraftStatus();updateBusy();
  }
  function rebasePlan(draft,latest){
    const candidate=initialDraft(latest);candidate.actor=draft.actor;candidate.decision=draft.decision;candidate.reason=draft.reason;
    candidate.derivedFrom=draft.id;candidate.editVersion=1;
    const conflicts=[],source=latest.detail;
    const oldEvidence=new Map(arr(draft.base.evidence).map(item=>[item.occurrenceId,item]));
    const newEvidence=new Map(arr(source.evidence).map(item=>[item.occurrenceId,item]));
    const oldFindings=new Map(arr(draft.base.findings).map(item=>[item.id,item]));
    const newFindings=new Map(arr(source.findings).map(item=>[item.id,item]));
    const merge=(path,title,before,current,working)=>{
      if(same(working,before))return clone(current);
      if(same(current,before)||same(current,working))return clone(working);
      conflicts.push({id:'conflict_'+conflicts.length,path,title,before:clone(before),current:clone(current),working:clone(working),choice:''});
      return clone(current);
    };
    for(const [id,working]of Object.entries(draft.evidence)){
      const original=oldEvidence.get(id),current=newEvidence.get(id);
      if(!original)continue;
      if(!current){
        if(!same(working,selectedEvidence(original)))conflicts.push({id:'conflict_'+conflicts.length,path:null,
          title:'This evidence is no longer affected: '+(original.title||id),before:selectedEvidence(original),current:null,working:clone(working),choice:''});
        continue;
      }
      for(const key of ['selected','classification','note'])
        candidate.evidence[id][key]=merge(['evidence',id,key],(current.title||id)+' — '+key,
          selectedEvidence(original)[key],selectedEvidence(current)[key],working[key]);
    }
    for(const [id,working]of Object.entries(draft.findings)){
      const original=oldFindings.get(id),current=newFindings.get(id);
      if(!original)continue;
      if(!current){
        if(!same(selectedFinding(working),selectedFinding(original))||working.disposition||working.dispositionReason)
          conflicts.push({id:'conflict_'+conflicts.length,path:null,title:'This finding no longer cites affected evidence: '+original.title,
            before:selectedFinding(original),current:null,working:clone(working),choice:''});
        continue;
      }
      for(const key of ['title','text','occurrenceIds'])
        candidate.findings[id][key]=merge(['findings',id,key],current.title+' — '+(key==='occurrenceIds'?'citations':key),
          selectedFinding(original)[key],selectedFinding(current)[key],working[key]);
      candidate.findings[id].disposition=working.disposition;candidate.findings[id].dispositionReason=working.dispositionReason;
    }
    return {candidate,conflicts,latest,originalDraftId:draft.id,originalEditVersion:draft.editVersion};
  }
  async function prepareRebase(){
    await state.persist.catch(()=>{});
    const id=state.dossier.id,noticeId=state.noticeId;
    const view=await api(base(id));
    need(state.dossier?.id===id&&state.noticeId===noticeId,'CITATION_REBASE_SELECTION','The selected dossier changed while reading its current revision.');
    const latest=await api(base(id)+'/citation-updates?'+new URLSearchParams({revision:String(view.revision),noticeId}));
    state.dossier=view;state.detail=latest;
    const plan=rebasePlan(state.draft,latest);state.conflict=plan;
    await onReceived(view);
    // The parent may schedule its normal metadata refresh. Preserve this explicit
    // current-state comparison unless the operator edits the underlying draft.
    state.conflict=plan;renderConflict();updateBusy();
  }
  function renderConflict(){
    const box=controls.conflict;controls.rebase=null;if(!box)return;box.replaceChildren();
    const draft=state.draft,detail=state.detail?.detail;
    if(!draft||!detail){box.hidden=true;return;}
    const changed=draft.baseRevision!==state.dossier?.revision||draft.baseFingerprint!==detail.fingerprint;
    if(!changed&&!state.conflict){box.hidden=true;return;}box.hidden=false;
    box.append(node('h3','Review the current dossier before saving'),
      node('p','Your full draft is based on revision '+draft.baseRevision+'. The current dossier is revision '+state.dossier.revision+'.','small'));
    if(!state.conflict){
      box.append(button('Compare draft with current revision',prepareRebase));return;
    }
    const plan=state.conflict;
    box.append(node('p','Untouched fields use the current saved values. Your edits remain selected where the original value is unchanged. Resolve any field edited in both versions.','small'));
    const source=node('details');source.append(node('summary','Current notice and affected source selection'));
    source.append(node('pre',JSON.stringify({noticeDoi:plan.latest.detail.noticeDoi,targetDoi:plan.latest.detail.targetDoi,
      registeredUpdates:plan.latest.detail.registeredUpdates||[plan.latest.detail.registeredUpdate],
      evidence:plan.latest.detail.evidence,findings:plan.latest.detail.findings},null,2),'cr-source-json'));box.append(source);
    for(const conflict of plan.conflicts){
      const row=node('article',undefined,'cr-merge-field');row.append(node('h4',conflict.title));
      const sides=node('div',undefined,'cr-merge-values');
      for(const [title,value]of [['Original',conflict.before],['Current',conflict.current],['Your draft',conflict.working]]){
        const side=node('div');side.append(node('strong',title),node('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));sides.append(side);
      }
      const choices=conflict.path?[['','Choose a value'],['current','Use current value'],['working','Keep my draft value']]:
        [['','Choose how to carry this earlier edit'],['retained','Keep in the retained draft; omit from current review']];
      const select=selectInput(choices,conflict.choice,value=>{conflict.choice=value;updateRebaseButton();});
      select.dataset.crEdit='1';select.dataset.rebaseConflict=conflict.id;row.append(sides,field('Resolution',select));box.append(row);
    }
    controls.rebase=button('Use resolved draft on revision '+plan.latest.dossier.revision,async()=>{
      await state.persist;
      need(state.conflict===plan&&state.draft.id===plan.originalDraftId&&state.draft.editVersion===plan.originalEditVersion,
        'CITATION_DRAFT_CHANGED','Your draft changed during this comparison. Compare its current edits again.');
      need(plan.conflicts.every(item=>item.choice),'CITATION_REBASE_CHOICES','Choose a value for each concurrent edit.');
      const next=clone(plan.candidate);
      for(const item of plan.conflicts)if(item.path){
        const [section,id,key]=item.path;next[section][id][key]=clone(item.choice==='working'?item.working:item.current);
      }
      const previous=clone(state.draft);
      const store=await cache();acknowledgeDraft(await store.putDraft({...previous,scope:scope(previous.dossierId,previous.noticeId)}));
      next.updatedAt=now();acknowledgeDraft(await store.putDraft(next));
      state.draft=next;state.conflict=null;state.drafts=retainedDrafts(await store.drafts(next.dossierId,next.noticeId),next.dossierId,next.noticeId);
      renderDetail();message('Your resolved draft now uses revision '+next.baseRevision+'. The previous complete draft remains available under retained draft versions.');
    },'primary');
    box.append(controls.rebase);updateRebaseButton();
  }
  function updateRebaseButton(){if(controls.rebase)controls.rebase.disabled=busy()||!state.conflict||
    state.conflict.conflicts.some(item=>!item.choice);}
  function buildRequest(draft){
    need(draft.actor.trim()&&draft.actor.length<=200,'CITATION_REVIEW_ACTOR_REQUIRED','Enter the reviewer name.');
    need(DECISIONS.some(([value])=>value&&value===draft.decision),'CITATION_REVIEW_DECISION_REQUIRED','Choose the overall review decision.');
    need(draft.reason.trim()&&draft.reason.length<=20000,'CITATION_REVIEW_REASON_REQUIRED','Record the reason for this review.');
    const evidenceChanges=[],findingChanges=[],findingDispositions=[];
    const evidenceIds=new Set(arr(draft.base.evidence).map(value=>value.occurrenceId));
    for(const original of arr(draft.base.evidence)){
      const value=draft.evidence[original.occurrenceId];
      need(value&&typeof value.selected==='boolean'&&CLASSIFICATIONS.includes(value.classification)&&
        typeof value.note==='string'&&value.note.length<=100000,'CITATION_EVIDENCE_CHANGE_INVALID','Review the full evidence selection and note.');
      if(!same(value,selectedEvidence(original)))evidenceChanges.push({occurrenceId:original.occurrenceId,...clone(value)});
    }
    for(const original of arr(draft.base.findings)){
      const value=draft.findings[original.id];
      need(value&&value.title.trim()&&value.title.length<=240&&value.text.trim()&&value.text.length<=100000,
        'CITATION_FINDING_TEXT_REQUIRED','Each affected finding needs its complete title and text.');
      need(DISPOSITIONS.some(([key])=>key&&key===value.disposition)&&value.dispositionReason.trim()&&value.dispositionReason.length<=20000,
        'CITATION_FINDING_DISPOSITION_REQUIRED','Choose a disposition and reason for every affected finding.');
      need(Array.isArray(value.occurrenceIds)&&new Set(value.occurrenceIds).size===value.occurrenceIds.length,
        'CITATION_FINDING_CITATIONS','Keep the finding’s distinct original citation occurrences.');
      const changed=!same(selectedFinding(value),selectedFinding(original));
      if(value.disposition==='unchanged')need(!changed,'CITATION_FINDING_DISPOSITION_MISMATCH','Choose Revised for an edited finding, or restore its original text and citations.');
      if(value.disposition==='revised')need(changed,'CITATION_FINDING_DISPOSITION_MISMATCH','The Revised disposition needs an actual text, title or citation change.');
      if(value.disposition==='citation-removed')need(changed&&value.occurrenceIds.every(id=>!evidenceIds.has(id)),
        'CITATION_FINDING_DISPOSITION_MISMATCH','Remove every affected citation from this finding before selecting Affected citations removed.');
      if(changed)findingChanges.push({id:original.id,...selectedFinding(value)});
      findingDispositions.push({findingId:original.id,disposition:value.disposition,reason:value.dispositionReason});
    }
    const value={requestId:uid('citation_'),noticeId:draft.noticeId,expectedFingerprint:draft.baseFingerprint,
      expectedRevision:draft.baseRevision,actor:draft.actor,decision:draft.decision,reason:draft.reason,
      evidenceChanges,findingChanges,findingDispositions};
    need(bodySize(value)<=MAX_REVIEW_BYTES,'CITATION_REVIEW_BODY_LIMIT','The complete review exceeds this endpoint’s 16 MiB input limit. Your full draft remains available to download.');
    return value;
  }
  async function saveReview(){
    need(state.detail&&state.draft.baseRevision===state.dossier.revision&&state.draft.baseFingerprint===state.detail.detail.fingerprint,
      'CITATION_REVIEW_CHANGED','Compare this complete draft with the current dossier revision before saving.');
    await state.persist;need(!state.storageError,'CITATION_BROWSER_STORAGE','The browser could not retain the original request. Download your draft and reopen its browser storage.');
    const draft={...clone(state.draft),scope:scope(state.draft.dossierId,state.draft.noticeId)};
    const payload=buildRequest(draft),store=await cache();
    acknowledgeDraft(await store.putDraft(draft));
    let entry;
    try{entry=await store.putPending({id:payload.requestId,scope:scope(draft.dossierId,draft.noticeId),
      dossierId:draft.dossierId,noticeId:draft.noticeId,payload,draft,createdAt:now(),state:'READY'});}
    catch(cause){await readPending();throw cause;}
    await readPending();await sendPending(entry);
  }
  async function sendPending(entry){
    const store=await cache();
    let result;
    try{
      result=await api(base(entry.dossierId)+'/citation-updates/reviews?projection=metadata',{method:'POST',body:entry.payload});
      need(result.review?.requestId===entry.id&&result.review.noticeId===entry.noticeId&&result.review.originalRevision===entry.payload.expectedRevision,
        'CITATION_REVIEW_RECEIPT','The returned review does not match the original saved request.');
      await store.pendingState(entry.id,{state:'COMPLETE',reply:result});
    }catch(cause){
      const definite=Number.isInteger(cause.status)&&cause.status>=400&&cause.status<500;
      await store.pendingState(entry.id,{state:definite?'REJECTED':'UNCERTAIN',
        error:{code:cause.code||'REPLY_UNAVAILABLE',message:cause.detail||cause.message||String(cause)}}).catch(storage=>{state.storageError=storage;});
      if(state.dossier?.id===entry.dossierId)await readPending();
      if(definite&&['REVISION_CONFLICT','CITATION_REVIEW_CHANGED'].includes(cause.code)){
        message('The dossier changed before this review was saved. Your complete draft and original rejected request are retained. Compare with the current revision.','error');
        if(state.dossier?.id===entry.dossierId)await refreshCurrent();
      }else if(!definite){
        message('The original save has no retained reply. Retry original save to reopen its exact result before another submission.','error');
      }else reportError(cause);
      return;
    }
    try{await store.removeDraft(entry.draft.id,entry.draft);acknowledgeDraft(entry.draft);}
    catch(cause){state.storageError=cause;} // The real server receipt remains complete even if browser cleanup fails.
    if(state.dossier?.id!==entry.dossierId)return;
    state.lastReply=result;
    if(state.draft?.id===entry.draft.id&&same({...state.draft,scope:scope(state.draft.dossierId,state.draft.noticeId)},entry.draft))state.draft=null;
    await readPending();
    try{
      const view=await api(base(entry.dossierId));state.dossier=view;await onReceived(view);
      state.loadedRevision=null;await loadPage();await loadDetail(entry.noticeId);
      message('Review saved in dossier revision '+result.review.revision+(result.duplicate?' · original request reopened.':'.')+
        (view.revision!==result.review.revision?' Current dossier revision: '+view.revision+'.':''));
      notify('Citation review '+result.review.id+' saved in revision '+result.review.revision+'.');
    }catch(cause){
      message('Review '+result.review.id+' was saved in revision '+result.review.revision+'. Refresh the dossier to reopen its current view. '+(cause.message||cause),'error');
    }
  }
  function build(){
    root.classList.add('citation-review');
    const header=node('div',undefined,'view-heading');
    const title=node('div');title.append(node('h2','Update review'),node('p','Review retained registered notices against the evidence and findings they affect.','muted'));
    controls.refresh=button('Refresh current revision',refreshCurrent);header.append(title,controls.refresh);
    controls.message=node('p',undefined,'cr-message');controls.message.hidden=true;controls.message.setAttribute('role','status');
    controls.counts=node('div',undefined,'cr-counts');controls.counts.setAttribute('aria-label','Citation review summary');
    controls.pending=node('section',undefined,'cr-pending');controls.pending.hidden=true;
    controls.coverage=node('section',undefined,'cr-coverage');
    const layout=node('div',undefined,'cr-layout'),aside=node('aside',undefined,'cr-notice-area');
    controls.filter=selectInput([['all','All notices'],['pending','Pending and follow up'],['reviewed','Reviewed']],state.status,value=>{
      state.status=value;state.offset=0;state.loadedRevision=null;loadPage();
    });controls.filter.id='citation-review-filter';
    controls.list=node('div',undefined,'cr-notice-list');controls.list.id='citation-notice-list';
    controls.list.setAttribute('aria-label','Retained update notices');
    const pagination=node('div',undefined,'cr-pagination');
    controls.previous=button('Previous',async()=>{state.offset=Math.max(0,state.offset-PAGE_SIZE);await loadPage();},'compact');
    controls.next=button('Next',async()=>{if(state.page?.nextOffset!==null){state.offset=state.page.nextOffset;await loadPage();}},'compact');
    controls.pageStatus=node('span','0 notices','small muted');pagination.append(controls.previous,controls.pageStatus,controls.next);
    aside.append(field('Notice filter',controls.filter),controls.list,pagination);
    controls.detail=node('section',undefined,'cr-detail');controls.detail.id='citation-notice-detail';
    controls.detail.setAttribute('aria-label','Citation notice review');layout.append(aside,controls.detail);
    root.append(header,controls.message,controls.counts,controls.pending,controls.coverage,layout);
    renderList();renderDetail();updateBusy();
  }
  build();
  return {setDossier,show,updateBusy,hasUnsaved:()=>unacknowledged.size>0,
    close(){state.cache?.close();}};
}
