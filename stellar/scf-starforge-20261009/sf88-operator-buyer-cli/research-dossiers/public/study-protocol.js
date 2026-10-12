// MIT. Retained registered protocol, page-linked methods and original question import.
import {openProtocolDraftStore} from './study-protocol-storage.js';
const DRAFT='sf88-study-protocol-browser-draft/v1';
const REQUEST='sf88-study-protocol-receive-request/v1';
const INSPECTION='sf88-study-protocol-inspection/v1';
const PREPARED='sf88-study-protocol-prepared/v1';
const DEFINITE_REJECTIONS=new Set(['REVISION_CONFLICT','QUESTION_NOT_FOUND','SOURCE_BUNDLE_CHANGED',
  'AUTH_REQUIRED','ORIGIN_REFUSED','HOST_REFUSED','RESEARCH_WORKSPACE_CHANGED','RESEARCH_INSTANCE_CHANGED',
  'RESEARCH_PROJECTION_INVALID','ONE_RESEARCH_INPUT_REQUIRED']);
const MAX=64*1024*1024;
const node=(tag,text,className)=>{
  const out=document.createElement(tag);
  if(text!==undefined)out.textContent=String(text);
  if(className)out.className=className;
  return out;
};
const button=(text,action)=>{const out=node('button',text);out.type='button';out.addEventListener('click',action);return out;};
const bytes=text=>new TextEncoder().encode(text);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),x=>x.toString(16).padStart(2,'0')).join('');
const text=value=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);
const size=value=>value<1024*1024?(value/1024).toFixed(1)+' KiB':(value/1024/1024).toFixed(2)+' MiB';
const now=()=>new Date().toISOString();
const decode=file=>{
  if(file.encoding==='utf8')return bytes(file.content);
  if(file.encoding!=='base64')throw new Error('The original file encoding is not supported.');
  const raw=atob(file.content),out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
};
const saveFile=(data,filename,mediaType)=>{
  const url=URL.createObjectURL(new Blob([data],{type:mediaType})),link=node('a');
  link.href=url;link.download=filename;link.hidden=true;document.body.append(link);
  link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
const originalText=draft=>draft?.request?.rawText??draft?.rawText??null;
const cleanId=(id,label)=>{
  if(typeof id!=='string'||!id||id.length>160||/[\u0000-\u001f\u007f/\\]/.test(id))throw new Error('Choose the original '+label+'.');
  return id;
};
const stableSelection=request=>({workspaceId:request.workspaceId,dossierId:request.dossierId,
  questionId:request.questionId,bundleSha256:request.bundleSha256,bundleBytes:request.bundleBytes,
  expectedRevision:request.expectedRevision});
async function checkRequest(request){
  if(!request||request.schema!==REQUEST||typeof request.rawText!=='string'||
    !/^research_[a-f0-9]{64}$/.test(request.workspaceId??'')||
    !Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<1)
    throw new Error('Choose a complete original protocol import request.');
  cleanId(request.dossierId,'dossier');cleanId(request.questionId,'question');
  const raw=bytes(request.rawText);
  if(raw.length>MAX||raw.length!==request.bundleBytes||await digest(raw)!==request.bundleSha256||
    request.requestId!=='protocol_receive_'+await digest(bytes(JSON.stringify(stableSelection(request),null,2)+'\n')))
    throw new Error('The saved protocol request does not match its original bytes and selection.');
  if(Object.keys(request).some(key=>!['schema','requestId','workspaceId','dossierId','questionId',
    'bundleSha256','bundleBytes','expectedRevision','rawText'].includes(key)))
    throw new Error('The saved protocol request contains an unknown field.');
  return request;
}
export function createStudyProtocolPanel({openButton,api,task,notify,getDossier,isBusy,onReceived}){
  const root=node('dialog',undefined,'protocol-dialog');root.id='study-protocol-dialog';
  root.setAttribute('aria-labelledby','study-protocol-title');
  root.innerHTML='<header><div><p class="protocol-eyebrow">Registered study source</p><h2 id="study-protocol-title">Protocol and methods</h2></div><button type="button" data-close aria-label="Close protocol review">Close</button></header>'+
    '<p class="protocol-intro">Open the complete NCT03529110 capture from the installed Research command. Review the original protocol, its page-linked methods and the exact question changes before saving.</p>'+
    '<p class="form-error" hidden role="alert"></p><p data-storage-error hidden role="status"></p>'+
    '<section class="protocol-saved"><h3>Saved reviews</h3><div class="protocol-row"><select data-drafts aria-label="Saved protocol reviews"></select><button type="button" data-open-draft>Open saved review</button><button type="button" data-fork>Start another review</button></div><div data-unsaved></div></section>'+
    '<section><h3>Original source</h3><div class="protocol-grid"><label>Complete captured source or saved review<input type="file" data-file accept=".json,application/json"></label><label>Research question<select data-question></select></label></div>'+
    '<p class="protocol-hint">Use source-bundle.json from the original capture. A downloaded review or prepared request can resume its same workspace and question.</p>'+
    '<details><summary>Capture with the installed command</summary><p>The existing research-study-protocol command verifies the original registry, downloads the registered PDF, and keeps all 117 pages plus its extraction provenance. Use the same operation and capture directory after interruption.</p><pre>starforge research-study-protocol capture --study-file /ABS/original-registry.json --directory /ABS/original-capture --operation ORIGINAL_OPERATION</pre><p>Then open /ABS/original-capture/source-bundle.json here. Existing verified captures are reused by that command.</p></details>'+
    '<div class="protocol-actions"><button type="button" data-inspect>Inspect captured source</button><button type="button" data-preview>Preview question changes</button><button type="button" data-save-draft>Download complete review</button><button type="button" data-save-bundle>Download source bundle</button></div></section>'+
    '<section data-state aria-live="polite"></section><section data-methods></section><section data-preview-result></section>'+
    '<section class="protocol-submit"><h3>Save the reviewed source</h3><p>The complete original request is retained in this browser before submission. Recovery sends that same bundle and expected revision through the existing Research source operation.</p>'+
    '<div class="protocol-actions"><button type="button" data-receive>Save to this question</button><button type="button" data-reconcile>Read original import state</button><button type="button" data-save-request>Download exact request</button><button type="button" data-preserve>Preserve this draft separately</button></div></section>'+
    '<section data-delivery></section>';
  document.body.append(root);
  const $=selector=>root.querySelector(selector);
  let workspaceId=null,current=null,loading=0,localBusy=false,storageError=null,storePromise=null;
  let writer=Promise.resolve(),seenDossierId=null;
  const drafts=new Map(),diskDrafts=new Map(),diskRevisions=new Map(),unacknowledged=new Map(),parsed=new Map(),pdfUrls=new Map();
  const store=()=>storePromise??=openProtocolDraftStore().catch(error=>{storePromise=null;throw error;});
  const selectedApi=(path,options={})=>api(path,{...options,...(workspaceId?{workspaceId}:{})});
  const complain=error=>{
    storageError=error.message||String(error);renderStorage();updateBusy();
  };
  const ensureWorkspace=async()=>{
    const status=await api('/api/status');
    if(!/^research_[a-f0-9]{64}$/.test(status.workspaceId??'')||status.api?.studyProtocolInspection!==true)
      throw new Error('Open this source with the Research installation that includes protocol inspection.');
    if(workspaceId&&workspaceId!==status.workspaceId)throw new Error('The connected workspace changed. Keep the original review and reopen its original workspace.');
    workspaceId=status.workspaceId;return workspaceId;
  };
  function changed(value){
    const draft={...value,commitId:crypto.randomUUID(),updatedAt:now()};
    drafts.set(draft.id,draft);unacknowledged.set(draft.id,structuredClone(draft));
    current=draft;return draft;
  }
  function persist(draft){
    const snapshot=structuredClone(draft);
    unacknowledged.set(snapshot.id,snapshot);
    const work=writer.catch(()=>{}).then(async()=>{
      const storage=await store(),record=await storage.write(snapshot,diskRevisions.get(snapshot.id)??0);
      diskRevisions.set(record.id,record.revision);diskDrafts.set(record.id,record.snapshot);
      if(unacknowledged.get(snapshot.id)?.commitId===snapshot.commitId)unacknowledged.delete(snapshot.id);
      if(!unacknowledged.size)storageError=null;
      return record;
    });
    writer=work;work.catch(complain);
    return work.finally(()=>{renderStorage();renderDraftList();updateBusy();});
  }
  async function loadSaved(){
    try{
      const rows=await (await store()).list();
      for(const record of rows){
        if(record?.snapshot?.schema!==DRAFT)continue;
        diskDrafts.set(record.id,record.snapshot);
        const unsaved=unacknowledged.get(record.id);
        if(!unsaved){
          diskRevisions.set(record.id,record.revision);drafts.set(record.id,record.snapshot);
          if(current?.id===record.id)current=record.snapshot;
        }else if(unsaved.commitId===record.snapshot.commitId){
          if(JSON.stringify(unsaved)!==JSON.stringify(record.snapshot))throw new Error('The retained browser commit changed.');
          diskRevisions.set(record.id,record.revision);unacknowledged.delete(record.id);
        }
      }
      if(!unacknowledged.size)storageError=null;
    }catch(error){complain(error);}
    renderStorage();renderDraftList();
  }
  function renderStorage(){
    const warning=$('[data-storage-error]');warning.hidden=!storageError;
    warning.textContent=storageError?'This browser has not saved every review: '+storageError+
      '. The full unsaved copies remain available below. Save will wait for the exact request to be retained.':'';
    const box=$('[data-unsaved]');box.replaceChildren();
    for(const draft of unacknowledged.values()){
      const row=node('div',undefined,'protocol-unsaved');
      row.append(node('span',(draft.filename??'Protocol review')+' · '+draft.dossierId),
        button('Download unsaved review',()=>downloadDraft(draft)));
      box.append(row);
    }
  }
  function renderDraftList(){
    const select=$('[data-drafts]'),selected=select.value,view=getDossier();
    const rows=[...drafts.values()].filter(x=>x.workspaceId===workspaceId&&x.dossierId===view?.id)
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    select.replaceChildren(...rows.map(draft=>{
      const out=node('option',(draft.filename??'Protocol source')+' · '+draft.state+' · '+draft.updatedAt);
      out.value=draft.id;return out;
    }));
    if(rows.some(x=>x.id===(current?.id??selected)))select.value=current?.id??selected;
    if(!rows.length){const out=node('option','No saved reviews for this dossier');out.value='';select.append(out);}
  }
  function fillQuestions(){
    const select=$('[data-question]'),view=getDossier(),chosen=current?.questionId??select.value;
    select.replaceChildren(...(view?.questions??[]).map(question=>{
      const out=node('option',question.text);out.value=question.id;return out;
    }));
    if((view?.questions??[]).some(q=>q.id===chosen))select.value=chosen;
    else if(current?.request&&chosen){
      const missing=node('option','Original question unavailable · '+chosen);missing.value=chosen;
      select.prepend(missing);select.value=chosen;
    }
  }
  function bundle(draft=current){
    const raw=originalText(draft);
    if(!raw)throw new Error('Choose the original captured source first.');
    const key=draft.id+':'+draft.bundleSha256;
    if(!parsed.has(key)){
      const value=JSON.parse(raw);parsed.clear();parsed.set(key,value);
    }
    return parsed.get(key);
  }
  function file(name,draft=current){
    const selected=bundle(draft).files?.find(value=>value.name===name);
    if(!selected)throw new Error('The complete source is missing '+name);
    return selected;
  }
  function openPdf(page,draft=current){
    const identity=draft.inspection.protocol.sha256;
    if(!pdfUrls.has(identity))pdfUrls.set(identity,URL.createObjectURL(new Blob([decode(file(draft.inspection.protocol.name,draft))],{type:'application/pdf'})));
    const link=node('a');link.href=pdfUrls.get(identity)+'#page='+page;link.target='_blank';link.rel='noopener noreferrer';
    link.hidden=true;document.body.append(link);link.click();link.remove();
  }
  function downloadDraft(draft=current){
    if(draft)saveFile(bytes(JSON.stringify(draft,null,2)+'\n'),'NCT03529110_Protocol_Review_'+draft.id+'.json','application/json');
  }
  function renderMethods(){
    const target=$('[data-methods]');target.replaceChildren();
    if(!current?.inspection)return;
    const inspection=current.inspection,methods=inspection.methods;
    target.append(node('h3',inspection.nctId+' · '+methods.document.protocolId),
      node('p','Version '+methods.document.version+' · '+methods.document.versionDate+' · '+inspection.pdfPages+' PDF pages','protocol-meta'),
      node('p',methods.use),node('p','Retained source capture: '+inspection.provenance.http.completedAt,'protocol-meta'));
    const actions=node('div',undefined,'protocol-actions');
    actions.append(button('Open original PDF',()=>openPdf(1)));
    for(const name of ['protocol-pages.txt','protocol-pages.json','protocol-methods.json','index.html']){
      actions.append(button('Download '+name,()=>{
        const selected=file(name);saveFile(decode(selected),selected.name,selected.mediaType??'application/octet-stream');
      }));
    }
    target.append(actions);
    const pages=JSON.parse(text(decode(file('protocol-pages.json')))).pages;
    for(const method of methods.observations){
      const article=node('article',undefined,'protocol-method');
      article.append(node('h4',method.title),node('p',method.fact));
      const location=node('div',undefined,'protocol-location');
      location.append(button('Open PDF page '+method.pdfPage,()=>openPdf(method.pdfPage)),
        node('span','Section '+method.section,'protocol-meta'));
      const details=node('details');details.append(node('summary','Read complete page text'),
        node('pre',pages[method.pdfPage-1].text,'protocol-page-text'));
      article.append(location,details);target.append(article);
    }
    const boundary=methods.plannedBoundaries;
    target.append(node('h4','Planned analysis boundaries'),button('Open PDF page '+boundary.pdfPage,()=>openPdf(boundary.pdfPage)));
    const scroll=node('div',undefined,'protocol-table-scroll'),table=node('table'),head=node('thead'),body=node('tbody'),row=node('tr');
    for(const title of ['Endpoint','Look','Events','Two-sided p','Hazard ratio'])row.append(node('th',title));
    head.append(row);table.append(head);
    for(const value of boundary.rows){
      const row=node('tr');for(const field of ['endpoint','look','events','pValue','hazardRatio'])row.append(node('td',value[field]));
      body.append(row);
    }
    table.append(body);scroll.append(table);target.append(scroll);
    const originals=node('details');originals.append(node('summary','Complete original files and provenance'));
    for(const item of inspection.files){
      const row=node('div',undefined,'protocol-original');
      row.append(node('span',item.name+' · '+size(item.bytes)),
        button('Download',()=>{const selected=file(item.name);saveFile(decode(selected),selected.name,selected.mediaType??'application/octet-stream');}),
        node('code',item.sha256));originals.append(row);
    }
    originals.append(node('pre',JSON.stringify(inspection.provenance,null,2),'protocol-page-text'));
    target.append(originals);
  }
  function renderState(){
    const target=$('[data-state]');target.replaceChildren();
    if(!current){target.append(node('p','Choose a complete captured source, or open a saved review for this dossier.'));return;}
    target.append(node('h3',current.filename??'Protocol review'),
      node('p','State: '+current.state+' · '+size(current.bundleBytes??0)+' · '+(current.bundleSha256??''),'protocol-meta'));
    if(current.request)target.append(node('p','Original request '+current.request.requestId+
      ' · expected dossier revision '+current.request.expectedRevision,'protocol-request'));
    if(current.reconciliation)target.append(node('p',current.reconciliation.alreadyReceived
      ?'The existing Research store has already retained this exact bundle for the original question. Recover the original import to obtain its saved result.'
      :'The exact bundle is not currently received in the selected question. Original request revision '+
      current.request.expectedRevision+'; current preview revision '+current.reconciliation.expectedRevision+'.'));
    if(current.state==='outcome_unknown')target.append(node('p','The reply was interrupted. Read the original import state, then recover the same saved request. The request has not been replaced.'));
    if(current.state==='rejected')target.append(node('p','The original server rejected this request: '+(current.lastError?.message??'Request rejected')+'. Read its current import state, or start another explicit review while retaining this request.'));
    if(current.state==='received')target.append(node('p','The original question contains this complete source. The retained result is dossier revision '+current.result.revision+'.'));
  }
  function renderPreview(){
    const target=$('[data-preview-result]');target.replaceChildren();
    const preview=current?.preview;if(!preview)return;
    target.append(node('h3','Question changes'),node('p',preview.fileCount+' original files · '+preview.sources.length+
      ' source · '+preview.findings.length+' methods findings · expected revision '+preview.expectedRevision));
    for(const finding of preview.findings){
      const detail=node('details');detail.append(node('summary',finding.title),node('p',finding.text));target.append(detail);
    }
    const terms=node('details');terms.append(node('summary','Original source terms'),node('p',preview.sourceTerms));target.append(terms);
    if(preview.alreadyReceived)target.append(node('p','This exact complete source is already received. Saving recovers its original result.'));
  }
  async function report(format){
    const selected=current,revision=selected?.result?.revision;
    if(!Number.isSafeInteger(revision))throw new Error('Recover the original saved result first.');
    const response=await selectedApi('/api/dossiers/'+encodeURIComponent(selected.dossierId)+'/export?format='+encodeURIComponent(format)+
      '&revision='+revision,{download:true});
    const blob=await response.blob();
    if(blob.size>256*1024*1024)throw new Error('The complete native report exceeds this download limit.');
    saveFile(blob,'NCT03529110_Research_revision-'+revision+'.'+format,blob.type||'application/octet-stream');
  }
  function renderDelivery(){
    const target=$('[data-delivery]');target.replaceChildren();
    if(current?.state!=='received')return;
    target.append(node('h3','Original handover'),node('p','Download the complete source and reports from the retained receiving revision. The editable dossier uses the original Research portable receiver.'));
    const actions=node('div',undefined,'protocol-actions');
    for(const [format,label]of [['html','HTML report'],['md','Markdown report'],['json.gz','Editable dossier']])
      actions.append(button(label,()=>act(()=>report(format))));
    target.append(actions);
    target.append(node('details'));target.lastChild.append(node('summary','Complete engine and fresh customer handover'),
      node('p','Use the installed research-study-protocol receive command with this same capture, operation, dossier and question, and the original complete current-engine selection. Its source-inclusive receiving result and package-study-protocol.py retain the complete engine, original capture, reports and fresh reopen instructions. See STUDY-PROTOCOL-OPERATOR.md and STUDY-PROTOCOL-RECEIVING.md.'));
  }
  function render(){fillQuestions();renderDraftList();renderState();renderMethods();renderPreview();renderDelivery();renderStorage();updateBusy();}
  function updateBusy(){
    const busy=localBusy||isBusy(),source=Boolean(originalText(current)),pending=Boolean(current?.request);
    $('[data-file]').disabled=busy;
    $('[data-question]').disabled=busy||pending;
    $('[data-inspect]').disabled=busy||!source||pending;
    $('[data-preview]').disabled=busy||!current?.inspection||pending||!getDossier()?.questions?.length;
    $('[data-receive]').disabled=busy||!pending||current?.state==='received'||current?.state==='rejected'&&!current?.reconciliation?.alreadyReceived;
    $('[data-receive]').textContent=['outcome_unknown','sending'].includes(current?.state)||current?.reconciliation?.alreadyReceived
      ?'Recover original import':'Save to this question';
    $('[data-reconcile]').disabled=busy||!pending;
    $('[data-save-request]').disabled=!pending;
    $('[data-save-draft]').disabled=!current;
    $('[data-save-bundle]').disabled=!source;
    $('[data-fork]').disabled=busy||!current;
    $('[data-preserve]').disabled=busy||!current;
    $('[data-open-draft]').disabled=busy||!$('[data-drafts]').value;
    $('[data-close]').disabled=busy;
    openButton.disabled=busy||!getDossier();
  }
  function act(work){
    if(localBusy||isBusy())return;
    task(async()=>{
      localBusy=true;updateBusy();
      try{return await work();}
      finally{localBusy=false;updateBusy();}
    },root);
  }
  const remember=async draft=>{changed(draft);render();await persist(current);};
  async function newDraft(rawText,filename,{questionId,parentDraftId}={}){
    const view=getDossier();if(!view)throw new Error('Select the original research dossier first.');
    const raw=bytes(rawText);if(!raw.length||raw.length>MAX)throw new Error('Choose a complete captured source of at most 64 MiB.');
    const draft={schema:DRAFT,id:'protocol_draft_'+crypto.randomUUID(),commitId:crypto.randomUUID(),
      workspaceId,dossierId:view.id,questionId:questionId??$('[data-question]').value??null,
      filename,createdAt:now(),updatedAt:now(),state:'selected',rawText,
      bundleSha256:await digest(raw),bundleBytes:raw.length,inspection:null,preview:null,request:null,result:null,
      ...(parentDraftId?{parentDraftId}:{})};
    if(getDossier()?.id!==view.id)throw new Error('The selected dossier changed while reading the source.');
    changed(draft);render();await persist(current);
  }
  $('[data-file]').addEventListener('change',()=>{
    const selected=$('[data-file]').files[0],ticket=++loading,view=getDossier();
    if(!selected)return;
    act(async()=>{
      await ensureWorkspace();
      if(selected.size>MAX*2+1024*1024)throw new Error('The selected source or review exceeds the supported size.');
      const raw=text(await selected.arrayBuffer());let value=JSON.parse(raw);
      if(value.schema===PREPARED){
        if(!value.request)throw new Error('The prepared review omits its complete original request.');
        value=value.request;
      }
      if(ticket!==loading||getDossier()?.id!==view?.id)return;
      if(value.schema===DRAFT){
        if(value.workspaceId!==workspaceId||value.dossierId!==view.id)throw new Error('This review belongs to another workspace or dossier. Open its original attachment, or use its source bundle for a new explicit review.');
        if(value.request){
          await checkRequest(value.request);
          for(const key of ['workspaceId','dossierId','questionId','bundleSha256','bundleBytes'])
            if(value[key]!==value.request[key])throw new Error('The saved review selection differs from its original request.');
        }
        if(typeof originalText(value)!=='string')throw new Error('The saved review omits its complete source.');
        const original=bytes(originalText(value));
        if(original.length!==value.bundleBytes||await digest(original)!==value.bundleSha256)throw new Error('The saved review source changed.');
        if(drafts.has(value.id)&&JSON.stringify(drafts.get(value.id))!==JSON.stringify(value)){
          value.parentDraftId=value.id;value.id='protocol_draft_'+crypto.randomUUID();
        }
        // A retained UI snapshot is source input. Recheck it against this server
        // before enabling mutation; preserve its exact prepared request.
        value.inspection=null;value.preview=null;value.result=null;
        value.state=value.request?'outcome_unknown':'selected';
        await remember(value);notify('Complete original review retained. Inspect or reconcile its original request.');
      }else if(value.schema===REQUEST){
        await checkRequest(value);
        if(value.workspaceId!==workspaceId||value.dossierId!==view.id)throw new Error('This request belongs to another workspace or dossier.');
        const created={schema:DRAFT,id:'protocol_draft_'+crypto.randomUUID(),workspaceId,dossierId:value.dossierId,
          questionId:value.questionId,filename:selected.name,createdAt:now(),state:'outcome_unknown',
          rawText:null,bundleSha256:value.bundleSha256,bundleBytes:value.bundleBytes,
          inspection:null,preview:null,request:value,result:null};
        await remember(created);notify('Original prepared request retained. Read its import state before recovery.');
      }else{
        await newDraft(raw,selected.name);
        notify('Complete source retained locally. Inspect the protocol to review its methods.');
      }
    });
  });
  $('[data-question]').addEventListener('change',()=>{
    if(!current||current.request)return;
    const updated=changed({...current,questionId:$('[data-question]').value,preview:null,state:current.inspection?'inspected':'selected'});
    persist(updated).catch(()=>{});renderState();renderPreview();updateBusy();
  });
  async function inspectCurrent(){
    const selected=current,rawText=originalText(selected);
    if(!selected||!rawText)throw new Error('Choose the complete captured source first.');
    const result=await selectedApi('/api/study-protocol/inspect',{method:'POST',body:{rawText}});
    if(result.schema!==INSPECTION||result.bundleSha256!==selected.bundleSha256||result.bundleBytes!==selected.bundleBytes)
      throw new Error('The inspection differs from the selected original bytes.');
    if(current?.id!==selected.id)throw new Error('The selected review changed.');
    await remember({...current,inspection:result,state:current.request?current.state:'inspected'});
    return result;
  }
  $('[data-inspect]').addEventListener('click',()=>act(inspectCurrent));
  $('[data-preview]').addEventListener('click',()=>act(async()=>{
    await ensureWorkspace();
    const selected=current,view=getDossier(),questionId=$('[data-question]').value;
    if(!selected?.inspection||selected.request||view?.id!==selected.dossierId)throw new Error('Inspect the source for the selected original dossier first.');
    cleanId(questionId,'question');
    const rawText=originalText(selected),preview=await selectedApi('/api/dossiers/'+encodeURIComponent(selected.dossierId)+'/source-bundles/preview',
      {method:'POST',body:{questionId,rawText}});
    if(preview.dossierId!==selected.dossierId||preview.questionId!==questionId||
      preview.bundleSha256!==selected.bundleSha256||preview.bundleBytes!==selected.bundleBytes||
      !Number.isSafeInteger(preview.expectedRevision)||preview.expectedRevision<1)throw new Error('The original question preview changed.');
    if(current?.id!==selected.id||getDossier()?.id!==selected.dossierId)throw new Error('The selected review changed.');
    const identity={workspaceId,dossierId:selected.dossierId,questionId,bundleSha256:selected.bundleSha256,
      bundleBytes:selected.bundleBytes,expectedRevision:preview.expectedRevision};
    const request={schema:REQUEST,requestId:'protocol_receive_'+await digest(bytes(JSON.stringify(identity,null,2)+'\n')),...identity,rawText};
    await checkRequest(request);
    await remember({...current,questionId,preview,request,rawText:null,state:'prepared'});
    notify('Exact source and question changes prepared. Review the methods, then save.');
  }));
  async function checkOriginal(){
    await ensureWorkspace();
    if(!current?.request)throw new Error('Open the original prepared request first.');
    const request=await checkRequest(current.request);
    if(request.workspaceId!==workspaceId||getDossier()?.id!==request.dossierId)throw new Error('Open the original request’s workspace and dossier.');
    if(!current.inspection)await inspectCurrent();
    return request;
  }
  $('[data-reconcile]').addEventListener('click',()=>act(async()=>{
    const request=await checkOriginal(),preview=await selectedApi('/api/dossiers/'+encodeURIComponent(request.dossierId)+'/source-bundles/preview',
      {method:'POST',body:{questionId:request.questionId,rawText:request.rawText}});
    if(preview.bundleSha256!==request.bundleSha256||preview.bundleBytes!==request.bundleBytes||
      preview.dossierId!==request.dossierId||preview.questionId!==request.questionId)
      throw new Error('The original import state does not match its request.');
    await remember({...current,reconciliation:preview});
    notify(preview.alreadyReceived?'The exact source is already received. Recover its original saved result.':'Original source state read. The prepared request remains unchanged.');
  }));
  $('[data-receive]').addEventListener('click',()=>act(async()=>{
    const request=await checkOriginal();
    await remember({...current,state:'sending'});
    let result;
    try{
      result=await selectedApi('/api/dossiers/'+encodeURIComponent(request.dossierId)+'/source-bundles/receive?projection=metadata',
        {method:'POST',body:{questionId:request.questionId,rawText:request.rawText,
          expectedBundleSha256:request.bundleSha256,expectedRevision:request.expectedRevision}});
      if(result.id!==request.dossierId||!Number.isSafeInteger(result.revision)||
        result.revision<request.expectedRevision||!result.questions?.some(q=>q.id===request.questionId))
        throw new Error('The saved response does not match the original question.');
    }catch(error){
      const saved=changed({...current,state:Number.isInteger(error.status)&&error.status<500&&!result&&DEFINITE_REJECTIONS.has(error.code)?'rejected':'outcome_unknown',lastError:{code:error.code??'REPLY_INTERRUPTED',message:error.message},
        ...(result?{responseCandidate:result}:{})});
      render();await persist(saved).catch(()=>{});
      throw error;
    }
    const accepted=changed({...current,state:'received',result,lastError:null});
    render();
    await persist(accepted);
    await onReceived(result);
    notify('The complete protocol and page-linked methods are saved in the original question.');
  }));
  $('[data-open-draft]').addEventListener('click',()=>act(async()=>{
    const id=$('[data-drafts]').value,draft=drafts.get(id);
    if(!draft||draft.workspaceId!==workspaceId||draft.dossierId!==getDossier()?.id)throw new Error('Select an original saved review for this dossier.');
    current=draft;$('[data-file]').value='';render();
  }));
  $('[data-fork]').addEventListener('click',()=>act(async()=>{
    if(!current)return;
    const old=current;await newDraft(originalText(old),old.filename,{questionId:old.questionId,parentDraftId:old.id});
    notify('A separate review is ready. The previous original request and result remain saved.');
  }));
  $('[data-preserve]').addEventListener('click',()=>act(async()=>{
    if(!current)return;
    const old=current,copy={...structuredClone(old),id:'protocol_draft_'+crypto.randomUUID(),parentDraftId:old.id};
    await remember(copy);
    if(unacknowledged.get(old.id)?.commitId===old.commitId)unacknowledged.delete(old.id);
    renderStorage();notify('The complete current copy is saved separately; the original saved review remains intact.');
  }));
  $('[data-save-draft]').addEventListener('click',()=>downloadDraft());
  $('[data-save-bundle]').addEventListener('click',()=>{if(current)saveFile(bytes(originalText(current)),'NCT03529110_Protocol_Source_Bundle.json','application/json');});
  $('[data-save-request]').addEventListener('click',()=>{
    if(current?.request)saveFile(bytes(JSON.stringify(current.request,null,2)+'\n'),'NCT03529110_Original_Protocol_Request.json','application/json');
  });
  $('[data-close]').addEventListener('click',()=>{if(!localBusy&&!isBusy())root.close();});
  root.addEventListener('cancel',event=>{if(localBusy||isBusy())event.preventDefault();});
  openButton.addEventListener('click',()=>act(async()=>{
    await ensureWorkspace();await loadSaved();seenDossierId=getDossier()?.id??null;
    if(current?.dossierId!==seenDossierId)current=null;
    render();root.showModal();
  }));
  return {
    setDossier(view){
      if(view?.id!==seenDossierId){seenDossierId=view?.id??null;current=null;loading++;$('[data-file]').value='';}
      fillQuestions();renderDraftList();
      if(root.open)render();
      updateBusy();
    },
    updateBusy,
    hasUnsaved:()=>unacknowledged.size>0||localBusy,
    async drain(){await writer;},
  };
}
