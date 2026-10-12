// MIT. Original document purchase and retained-edition review in the research operator.
const element=(tag,text,className)=>{
  const value=document.createElement(tag);if(text!==undefined)value.textContent=text;
  if(className)value.className=className;return value;
};
const array=value=>Array.isArray(value)?value:[];
const pretty=value=>JSON.stringify(value,null,2);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytes=value=>new Intl.NumberFormat().format(value)+' bytes';
const friendly=error=>({
  UNSTRUCTURED_RESPONSE_NOT_SAVED:'The original purchase has no completed saved document response yet. Open its existing buyer operation to inspect it.',
  UNSTRUCTURED_REVIEWED_EDITION_CHANGED:'The document edition changed. Refresh and review its current original record.',
  UNSTRUCTURED_RECEIVING_LABEL_CONFLICT:'This exact document is already received under a different label. Open that retained edition.',
  REVISION_CONFLICT:'The dossier changed after this decision was prepared. Refresh the dossier and review the receiving scope.',
})[error?.code]||error?.detail||error?.message||'The document operation could not complete.';

export function createUnstructuredPanel({root,tab,api,task,notify,getDossier,onReceived,isBusy}){
  root.innerHTML=`
    <div class="view-heading"><div><h2>Documents</h2><p class="muted">Review the original upload, processing profile and located document elements, then retain the edition with a research question.</p></div><button type="button" id="document-refresh">Refresh documents</button></div>
    <p id="document-source" class="muted small"></p>
    <div class="document-layout">
      <section class="document-history" aria-label="Document purchases and retained editions">
        <h3>Saved purchases</h3><div id="document-purchases"></div><button type="button" id="document-more" hidden>More purchases</button>
        <h3>Retained editions</h3><div id="document-editions"></div>
      </section>
      <section class="document-review" aria-label="Document review">
        <p id="document-empty" class="muted">Choose a completed purchase or an edition already retained in this dossier.</p>
        <div id="document-current" hidden>
          <h3 id="document-title"></h3><p id="document-summary" class="muted small"></p>
          <div class="document-status"><p><strong>Payment</strong><span id="document-payment"></span></p><p><strong>Output</strong><span id="document-output"></span></p></div>
          <div class="button-row"><button type="button" data-document-download="document">Original document</button><button type="button" data-document-download="response">Provider JSON</button><button type="button" data-document-download="edition">Research edition</button></div>
          <details class="original-record"><summary>Processing profile and original record</summary><pre id="document-profile"></pre></details>
          <p id="document-warnings" class="muted small"></p>
          <form id="document-receive-form" class="document-receive-form">
            <label>Research question<select id="document-question" required></select></label>
            <label>Edition label<input id="document-label" maxlength="240" required></label>
            <div class="button-row"><button type="submit" id="document-receive" class="primary">Retain reviewed document</button><button type="button" id="document-discard-pending" hidden>Review a new receiving decision</button></div>
            <p id="document-pending" class="muted small" role="status"></p><p class="form-error" hidden></p>
          </form>
          <p id="document-retained" class="muted small" hidden></p>
          <form id="document-filter" class="document-filter">
            <label>Page<select id="document-page"><option value="">All pages</option></select></label>
            <label>Element type<select id="document-type"><option value="">All types</option></select></label>
            <label>Text contains<input id="document-query" maxlength="2000" type="search"></label>
            <button type="submit">Filter elements</button>
          </form>
          <p id="document-element-count" class="muted small" role="status"></p>
          <div id="document-elements" class="document-elements"></div>
          <div class="pagination"><button type="button" id="document-prev">Previous</button><span id="document-page-label"></span><button type="button" id="document-next">Next</button></div>
          <section id="document-element-detail" class="document-element-detail" hidden></section>
        </div>
      </section>
    </div>
  `;
  const $=id=>root.querySelector('#'+id);
  const local={id:null,shown:false,configured:false,workspaceId:null,version:0,purchases:[],editions:[],
    next:null,current:null,records:null,offset:0,pending:null};
  const endpoint=suffix=>'/api/dossiers/'+encodeURIComponent(local.id)+'/unstructured'+(suffix||'');
  const pendingKey=()=> 'unstructured-receive:'+local.id;
  function savePending(value){
    local.pending=value;
    try {value?localStorage.setItem(pendingKey(),JSON.stringify(value)):localStorage.removeItem(pendingKey());}
    catch {notify('This browser could not retain the receiving decision across a restart. Keep this page open until its result returns.','error');}
  }
  function restorePending(){
    local.pending=null;
    try{const value=JSON.parse(localStorage.getItem(pendingKey())||'null');
      if(value&&value.dossierId===local.id&&value.input?.selection?.purchaseId)local.pending=value;
    }catch{}
  }
  async function withAction(action,form){
    return task(async()=>{try{return await action();}catch(error){error.detail=friendly(error);throw error;}},form);
  }
  function renderQuestions(){
    const selected=local.pending?.input?.questionId ?? $('document-question').value,view=getDossier();
    $('document-question').replaceChildren(...array(view?.questions).map(question=>{
      const option=element('option',question.text);option.value=question.id;return option;
    }));
    if(array(view?.questions).some(question=>question.id===selected))$('document-question').value=selected;
  }
  function renderList(){
    const button=(selection,title,subtitle)=>{
      const value=element('button',undefined,'document-item'+(same(selection,local.current?.selection)?' active':''));
      value.type='button';value.append(element('strong',title),element('span',subtitle,'muted small'));
      value.addEventListener('click',()=>withAction(()=>open(selection)));return value;
    };
    $('document-purchases').replaceChildren(...local.purchases.map(row=>button({purchaseId:row.id},
      row.intentId,row.profileId+' · '+row.state+' · '+row.outputStatus)));
    if(!local.purchases.length)$('document-purchases').append(element('p',local.configured?
      'Completed purchases from the configured original buyer appear here.':'Connect an original document buyer to receive new purchases.','muted small'));
    $('document-editions').replaceChildren(...local.editions.map(row=>button({editionId:row.id},
      row.label,(row.document?.filename||'Document')+' · '+row.elementCount+' elements')));
    if(!local.editions.length)$('document-editions').append(element('p','Retained document editions appear here.','muted small'));
    $('document-more').hidden=!local.next;
  }
  function renderCurrent(){
    const value=local.current;$('document-empty').hidden=!!value;$('document-current').hidden=!value;
    if(!value)return;
    $('document-title').textContent=value.document.filename;
    $('document-summary').textContent=bytes(value.document.bytes)+' · '+value.summary.elements+
      ' elements · '+value.summary.pages.length+' located pages · '+value.summary.withTableHtml+' table records';
    $('document-payment').textContent=value.native.status+
      (value.native.sellerReportedSettlement?' · '+value.native.sellerReportedSettlement:'');
    $('document-output').textContent=value.native.responseStatus+' · HTTP '+value.native.httpStatus;
    $('document-profile').textContent=pretty({profile:value.binding.profileId,parameters:value.parameters,
      document:value.document,originalPurchase:value.binding,editionSha256:value.editionSha256});
    $('document-warnings').textContent=array(value.warnings).join(' ');
    const retained=!!value.retained;$('document-receive-form').hidden=retained&&!local.pending;
    $('document-retained').hidden=!retained;
    $('document-retained').textContent=retained?'Retained as '+value.retained.label+
      '. Evidence selection, notes and findings remain in this dossier.':'';
    const pending=local.pending?.input;
    if(pending){
      $('document-label').value=pending.label;
      if(array(getDossier()?.questions).some(question=>question.id===pending.questionId))$('document-question').value=pending.questionId;
    }
    const pendingQuestion=pending&&array(getDossier()?.questions).find(question=>question.id===pending.questionId);
    $('document-pending').textContent=pending?'Saved decision: '+pending.label+' → '+
      (pendingQuestion?.text||pending.questionId)+'. Original purchase '+pending.selection.purchaseId+
      ', reviewed edition '+pending.expectedEditionSha256+'. Retry recovers this exact decision.':'';
    $('document-discard-pending').hidden=!local.pending;
    $('document-receive').textContent=local.pending?'Retry saved receiving decision':'Retain reviewed document';
    $('document-question').disabled=!!local.pending||isBusy();
    $('document-label').disabled=!!local.pending||isBusy();
    $('document-receive').disabled=isBusy()||(!local.pending&&!$('document-question').value);
    $('document-prev').disabled=isBusy()||local.offset===0;
    $('document-next').disabled=isBusy()||!local.records||local.records.nextOffset===null;
  }
  function showElement(row){
    const target=$('document-element-detail'),value=row.element;target.hidden=false;
    target.replaceChildren(element('h3',(value.type??'Element')+' '+row.position),
      element('p','Original ID: '+value.element_id,'muted small'),element('pre',value.text,'document-full-text'));
    const metadata=element('details',undefined,'original-record');metadata.append(element('summary','Page, coordinates and original metadata'),
      element('pre',pretty(value.metadata)));target.append(metadata);
    if(typeof value.metadata.text_as_html==='string'){
      const table=element('details',undefined,'original-record');
      table.append(element('summary','Original table HTML'),element('pre',value.metadata.text_as_html));target.append(table);
    }
  }
  function renderRecords(){
    const value=local.records;if(!value)return;
    $('document-element-count').textContent=value.filtered+' of '+value.total+' elements match the current filters.';
    $('document-elements').replaceChildren(...value.items.map(row=>{
      const button=element('button',undefined,'document-element');button.type='button';
      button.append(element('span','#'+row.position+' · '+(row.element.type??'Element')+
        (row.element.metadata.page_number===undefined?'':' · page '+row.element.metadata.page_number),'muted small'),
        element('span',row.element.text.length>480?row.element.text.slice(0,480)+'…':row.element.text));
      button.addEventListener('click',()=>showElement(row));return button;
    }));
    if(!value.items.length)$('document-elements').append(element('p','No document elements match these filters.','muted'));
    $('document-page-label').textContent='Page '+(Math.floor(local.offset/25)+1)+' of '+Math.max(1,Math.ceil(value.filtered/25));
    renderCurrent();
  }
  async function loadElements(){
    if(!local.current)return;
    const version=local.version,selection=local.current.selection,sha=local.current.editionSha256;
    const value=await api(endpoint('/elements'),{method:'POST',body:{selection,expectedEditionSha256:sha,
      offset:local.offset,limit:25,page:$('document-page').value,type:$('document-type').value,query:$('document-query').value}});
    if(version!==local.version||!same(selection,local.current?.selection)||sha!==local.current?.editionSha256)return;
    local.records=value;renderRecords();
  }
  async function open(selection){
    const version=++local.version;
    const value=await api(endpoint('/review'),{method:'POST',body:{selection}});
    if(version!==local.version)return;
    local.current=value;local.offset=0;local.records=null;
    $('document-element-detail').hidden=true;$('document-query').value='';
    $('document-page').replaceChildren(element('option','All pages'),...value.summary.pages.map(page=>{
      const option=element('option','Page '+page);option.value=page;return option;
    }));$('document-page').options[0].value='';
    $('document-type').replaceChildren(element('option','All types'),...Object.keys(value.summary.types).map(type=>{
      const option=element('option',type);option.value=type;return option;
    }));$('document-type').options[0].value='';
    $('document-label').value=value.retained?.label||(value.document.filename+' · '+value.binding.profileId).slice(0,240);
    renderQuestions();renderList();renderCurrent();await loadElements();
  }
  async function loadList(more=false){
    if(!local.id)return;
    const version=local.version,value=await api(endpoint('')+(more&&local.next?'?after='+encodeURIComponent(local.next):''));
    if(version!==local.version)return;
    local.purchases=more?[...local.purchases,...value.purchases]:value.purchases;local.editions=value.editions;
    local.next=value.nextAfter;local.configured=value.configured;local.workspaceId=value.workspaceId;
    $('document-source').textContent=value.configured?'Original buyer workspace: '+value.workspaceId:
      'Retained documents reopen from this dossier and its portable archive.';
    renderList();renderCurrent();
  }
  async function refresh(){const version=local.version;await loadList();if(version!==local.version)return;if(local.current)await open(local.current.selection);}
  $('document-refresh').addEventListener('click',()=>withAction(refresh));
  $('document-more').addEventListener('click',()=>withAction(()=>loadList(true)));
  $('document-filter').addEventListener('submit',event=>{event.preventDefault();withAction(async()=>{
    local.offset=0;$('document-element-detail').hidden=true;await loadElements();
  });});
  $('document-prev').addEventListener('click',()=>withAction(async()=>{local.offset=Math.max(0,local.offset-25);await loadElements();}));
  $('document-next').addEventListener('click',()=>withAction(async()=>{if(Number.isSafeInteger(local.records?.nextOffset)){local.offset=local.records.nextOffset;await loadElements();}}));
  $('document-question').addEventListener('change',renderCurrent);
  $('document-receive-form').addEventListener('submit',event=>{
    event.preventDefault();withAction(async()=>{
      if(!local.pending){
        const view=getDossier();
        savePending({dossierId:local.id,input:{selection:local.current.selection,
          expectedEditionSha256:local.current.editionSha256,questionId:$('document-question').value,
          label:$('document-label').value,expectedRevision:view.revision}});
      }
      const original=local.pending;
      const result=await api(endpoint('/receive'),{method:'POST',body:original.input});
      if(local.pending===original)savePending(null);
      await onReceived(result.dossier);await loadList();await open({editionId:result.editionId});
      notify((result.reused?'Recovered the original receiving result':'Document retained')+
        ' in dossier revision '+result.dossier.revision+'.');
    },event.currentTarget);
  });
  $('document-discard-pending').addEventListener('click',()=>withAction(async()=>{
    await loadList();savePending(null);
    if(local.current)$('document-label').value=local.current.retained?.label||
      (local.current.document.filename+' · '+local.current.binding.profileId).slice(0,240);
    renderQuestions();renderCurrent();
  }));
  root.querySelectorAll('[data-document-download]').forEach(button=>button.addEventListener('click',()=>withAction(async()=>{
    const value=local.current,response=await api(endpoint('/download'),{method:'POST',download:true,
      body:{selection:value.selection,expectedEditionSha256:value.editionSha256,file:button.dataset.documentDownload}});
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=element('a');
    link.href=url;const match=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'');
    link.download=match?.[1]||value.document.filename;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  })));
  return {
    configure(value){local.configured=value?.configured===true;local.workspaceId=value?.workspaceId??null;tab.hidden=false;},
    setDossier(view){
      if(view?.id!==local.id){local.id=view?.id??null;local.version++;local.purchases=[];local.editions=[];
        local.current=null;local.records=null;local.next=null;local.offset=0;restorePending();renderList();renderCurrent();}
      renderQuestions();renderCurrent();
    },
    show(visible){const changed=visible!==local.shown;local.shown=visible;
      if(visible&&changed&&local.id)refresh().catch(error=>notify(friendly(error),'error'));},
    updateBusy(){renderCurrent();}
  };
}
