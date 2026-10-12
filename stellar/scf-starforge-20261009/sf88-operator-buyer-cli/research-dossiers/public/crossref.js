// MIT. Crossref review controls use the original research workspace's session and dossier state.
export function createCrossrefPanel({root,tab,api,task,notify,getDossier,onReceived,isBusy}){
  const local={configured:false,identity:null,dossierId:null,revision:null,shown:false,current:null,items:[],
    next:null,page:0,poll:null,loading:false,loadVersion:0,pending:null};
  root.innerHTML=`
    <div class="view-heading"><div><h2>DOI metadata</h2><p class="muted">Review publication metadata and registered updates for the evidence in a saved question.</p></div><button type="button" id="crossref-refresh">Refresh operations</button></div>
    <p id="crossref-account" class="muted small"></p>
    <form id="crossref-plan-form" class="crossref-form">
      <label>Research question<select id="crossref-question" required></select></label>
      <label>Edition label<input id="crossref-label" maxlength="200" value="Crossref DOI enrichment" required></label>
      <div class="crossref-options">
        <label><input type="checkbox" id="crossref-selected" checked>Selected evidence only</label>
        <label><input type="checkbox" id="crossref-updates" checked>Include registered updates</label>
        <label><input type="checkbox" id="crossref-fresh">Refresh provider responses</label>
      </div>
      <p class="muted small">The review records the exact DOI scope. Existing response captures are reused unless you request a refresh. Acquisition progress remains saved when this window closes.</p>
      <div class="crossref-form-footer"><p id="crossref-scope" class="muted small"></p><button type="submit" class="primary" id="crossref-prepare">Review acquisition</button></div>
      <p class="form-error" hidden></p>
    </form>
    <div class="crossref-layout">
      <section class="crossref-history" aria-label="Saved Crossref operations"><h3>Saved operations</h3><div id="crossref-operation-list"></div><button type="button" id="crossref-more" hidden>More operations</button></section>
      <section class="crossref-review" aria-label="Crossref operation review">
        <p id="crossref-empty" class="muted">Choose a saved operation or review a new acquisition.</p>
        <div id="crossref-review-content" hidden>
          <div class="crossref-review-heading"><div><h3 id="crossref-plan-title"></h3><p id="crossref-plan-state" role="status"></p></div><span class="tag" id="crossref-coverage"></span></div>
          <p id="crossref-plan-question"></p><p id="crossref-plan-meta" class="muted small"></p>
          <details class="original-record"><summary>Reviewed DOI scope</summary><pre id="crossref-dois"></pre></details>
          <div id="crossref-progress" class="provider-outcome" role="status"></div>
          <p id="crossref-problem" class="form-error" role="alert" hidden></p>
          <div class="button-row crossref-actions">
            <button type="button" class="primary" id="crossref-start">Acquire metadata</button>
            <button type="button" id="crossref-stop" hidden>Stop acquisition</button>
            <button type="button" class="primary" id="crossref-receive" hidden>Retain reviewed edition</button>
            <button type="button" id="crossref-download" hidden>Download original edition</button>
          </div>
          <div id="crossref-result" hidden>
            <h3>Received metadata</h3><p id="crossref-result-summary" class="muted small"></p>
            <div class="table-wrap"><table><thead><tr><th>Publication</th><th>Publication dates</th><th>Review</th></tr></thead><tbody id="crossref-records"></tbody></table></div>
            <div class="pagination"><button type="button" id="crossref-prev" class="quiet compact">Previous</button><span id="crossref-page"></span><button type="button" id="crossref-next" class="quiet compact">Next</button></div>
            <section id="crossref-record-detail" class="crossref-record-detail" hidden></section>
            <details class="original-record"><summary>Acquisition coverage and provider responses</summary><pre id="crossref-usage"></pre></details>
          </div>
        </div>
      </section>
    </div>`;
  const $=id=>root.querySelector('#'+id),nodes={};
  for(const element of root.querySelectorAll('[id]'))nodes[element.id]=element;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const array=value=>Array.isArray(value)?value:[];
  const stringify=value=>JSON.stringify(value,null,2);
  const endpoint=(suffix='',id=local.dossierId)=>'/api/dossiers/'+encodeURIComponent(id)+'/crossref'+suffix;
  const operationPath=(suffix='',current=local.current)=>endpoint('/operations/'+current.plan.id+suffix,current.plan.request.dossierId);
  const friendly=code=>String(code||'Operation failed').toLowerCase().replaceAll('_',' ');
  const date=value=>value?new Date(value).toLocaleString():'';
  const dateParts=value=>array(value?.['date-parts']).map(parts=>parts.join('-')).join('; ')||value?.['date-time']||'Not supplied';
  function stopPoll(){if(local.poll!==null)clearTimeout(local.poll);local.poll=null;}
  function schedule(){
    stopPoll();
    if(!local.shown||!local.current?.running)return;
    local.poll=setTimeout(()=>loadCurrent().catch(error=>problem(error.message)),1500);
  }
  function problem(message){$('crossref-problem').textContent=message;$('crossref-problem').hidden=!message;}
  function withAction(work,form=null){
    return task(async()=>{try{await work();}catch(error){
      if(error.code==='REVISION_CONFLICT'&&local.current)await loadCurrent().catch(()=>{});
      throw error;
    }finally{renderCurrent();renderScope();}},form);
  }
  function pendingKey(){return 'crossref-prepared-request:'+location.origin+':'+local.dossierId;}
  function restorePending(){try{local.pending=JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{local.pending=null;}}
  function savePending(value){local.pending=value;try{if(value)sessionStorage.setItem(pendingKey(),JSON.stringify(value));else sessionStorage.removeItem(pendingKey());}catch{}}
  function scope(){
    const view=getDossier(),questionId=$('crossref-question').value,selectedOnly=$('crossref-selected').checked;
    return array(view?.sources).filter(source=>source.doi&&(!selectedOnly||source.selected)&&
      array(source.citations).some(citation=>citation.questionId===questionId));
  }
  function renderScope(){
    const count=new Set(scope().map(source=>String(source.doi).toLowerCase())).size;
    $('crossref-scope').textContent=count+' DOI source'+(count===1?'':'s')+' in the current question selection.';
    $('crossref-prepare').disabled=!local.configured||count===0||isBusy();
  }
  function renderQuestions(){
    const view=getDossier(),previous=$('crossref-question').value;
    $('crossref-question').replaceChildren(...array(view?.questions).map(question=>{const option=el('option',question.text);option.value=question.id;return option;}));
    if(array(view?.questions).some(question=>question.id===previous))$('crossref-question').value=previous;
    renderScope();
  }
  function renderList(){
    $('crossref-operation-list').replaceChildren(...local.items.map(item=>{
      const button=el('button',undefined,'crossref-operation'+(item.plan.id===local.current?.plan.id?' active':''));
      button.type='button';button.append(el('strong',item.plan.request.label),el('span',item.operation.phase+' · '+item.plan.payload.dois.length+' DOIs'),
        el('span',date(item.plan.preparedAt)));
      button.addEventListener('click',()=>withAction(async()=>{local.current=item;local.page=0;await loadCurrent();renderList();}));
      return button;
    }));
    if(!local.items.length)$('crossref-operation-list').append(el('p','Prepared scopes and results appear here.','muted small'));
    $('crossref-more').hidden=!local.next;
  }
  async function loadList({more=false}={}){
    const id=local.dossierId,version=local.loadVersion;if(!id||!local.configured)return;
    const data=await api(endpoint('/operations?limit=30'+(more&&local.next?'&after='+encodeURIComponent(local.next):''),id));
    if(version!==local.loadVersion||id!==local.dossierId)return;
    local.items=more?[...local.items,...data.items]:data.items;local.next=data.next;
    renderList();
  }
  async function loadCurrent(){
    if(!local.current||local.loading)return;
    const id=local.current.plan.id,dossierId=local.dossierId,version=local.loadVersion;local.loading=true;
    try{
      const value=await api(operationPath());
      if(version!==local.loadVersion||dossierId!==local.dossierId||id!==local.current?.plan.id)return;
      local.current=value;
      const index=local.items.findIndex(item=>item.plan.id===id);
      if(index>=0)local.items[index]={plan:value.plan,operation:value.operation};else local.items.unshift({plan:value.plan,operation:value.operation});
      renderCurrent();renderList();
    }finally{local.loading=false;schedule();}
  }
  async function refresh(){
    if(!local.configured||!local.dossierId)return;
    await loadList();
    if(local.current)await loadCurrent();
  }
  function fieldComparison(doi){
    const comparison=local.current?.review?.comparison;
    if(!comparison)return {label:'Retained record',fields:[]};
    const changed=array(comparison.changed).find(row=>row.doi===doi);
    if(changed)return {label:changed.fields.length+' changed field'+(changed.fields.length===1?'':'s'),fields:changed.fields};
    if(array(comparison.added).some(row=>row.doi===doi))return {label:'First Crossref metadata',fields:[]};
    return {label:'No saved Crossref field changes',fields:[]};
  }
  function displayRecord(record){
    const target=$('crossref-record-detail');target.hidden=false;target.replaceChildren(el('h3',record.title));
    const link=el('a',record.doi);link.href='https://doi.org/'+encodeURIComponent(record.doi);link.target='_blank';link.rel='noopener noreferrer';target.append(link);
    target.append(el('p',array(record.authors).join('; '),'muted small'));
    const table=el('table'),body=el('tbody');
    for(const [label,value] of Object.entries(record.dates||{})){const row=el('tr');row.append(el('th',label),el('td',dateParts(value)));body.append(row);}
    table.append(body);target.append(table);
    const comparison=fieldComparison(record.doi);
    target.append(el('h3',comparison.label));
    for(const field of comparison.fields){
      const details=el('details',undefined,'original-record');details.append(el('summary',field.field??field.key??'Changed field'));
      const pre=el('pre',stringify(field));details.append(pre);target.append(details);
    }
    for(const [title,value] of [['Funders',record.funders],['Licences',record.licenses],['Registered relations',record.relations],['Original source occurrences',record.sourceOccurrences]]){
      const details=el('details',undefined,'original-record');details.append(el('summary',title),el('pre',stringify(value)));target.append(details);
    }
    target.append(el('p','Deposited reference count: '+(record.referenceCount??'Not supplied'),'muted small'));
    target.scrollIntoView({block:'nearest'});
  }
  function renderRecords(){
    const records=array(local.current?.review?.records),pages=Math.max(1,Math.ceil(records.length/20));
    local.page=Math.min(local.page,pages-1);
    $('crossref-records').replaceChildren(...records.slice(local.page*20,local.page*20+20).map(record=>{
      const row=el('tr'),publication=el('td'),button=el('button',record.title,'source-title');
      button.type='button';button.addEventListener('click',()=>displayRecord(record));
      publication.append(button,el('p',record.doi,'muted small'));
      const dates=el('td');
      for(const name of ['published-online','published-print','issued'])if(record.dates?.[name])dates.append(el('div',name.replace('published-','')+': '+dateParts(record.dates[name])));
      row.append(publication,dates,el('td',fieldComparison(record.doi).label));return row;
    }));
    $('crossref-page').textContent=records.length+' records · Page '+(local.page+1)+' of '+pages;
    $('crossref-prev').disabled=local.page===0||isBusy();$('crossref-next').disabled=local.page+1===pages||isBusy();
  }
  function renderCurrent(){
    const value=local.current;$('crossref-empty').hidden=!!value;$('crossref-review-content').hidden=!value;
    if(!value)return;
    const {plan,operation}=value,review=value.review;
    $('crossref-plan-title').textContent=plan.request.label;
    $('crossref-plan-state').textContent=value.interrupted?'Interrupted — retained responses are ready to resume':operation.phase==='IMPORTED'?'Retained in dossier revision '+operation.received.revision:operation.phase;
    $('crossref-plan-question').textContent=plan.payload.question;
    $('crossref-plan-meta').textContent='Reviewed from revision '+plan.request.expectedRevision+' · '+date(plan.preparedAt)+
      ' · '+plan.payload.metadataRequests+' metadata requests'+(plan.request.includeUpdates?' and at least '+plan.payload.minimumUpdateRequests+' update requests':'')+
      ' · '+(plan.request.refresh?'Fresh provider responses':'Retained response cache enabled');
    $('crossref-dois').textContent=plan.payload.dois.join('\n');
    $('crossref-coverage').textContent=review?.coverage??'Awaiting acquisition';
    $('crossref-progress').textContent=operation.responses+' original response'+(operation.responses===1?'':'s')+' retained.'+
      (operation.lastCapture?' Latest: HTTP '+operation.lastCapture.status+' · '+operation.lastCapture.url:'')+
      (operation.received?' Edition received at '+date(operation.received.receivedAt)+'.':'');
    const warnings=[];
    if(operation.error)warnings.push(friendly(operation.error)+'.');
    if(value.sourceMatches===false)warnings.push('This operation was prepared for a different source configuration. Its retained edition remains available; create a new scope to acquire through the current configuration.');
    if(value.questionMatches===false)warnings.push('The saved question has changed. Review a new acquisition scope for that question.');
    if(review?.warnings?.length)warnings.push(...review.warnings.map(row=>friendly(row.code)+(row.dois?.length?' ('+row.dois.join(', ')+')':'')+'.'));
    problem(warnings.join(' '));
    const canStart=['PREPARED','STOPPED','FAILED'].includes(operation.phase)||value.interrupted;
    $('crossref-start').hidden=!canStart;$('crossref-start').disabled=value.sourceMatches===false||isBusy();
    $('crossref-start').textContent=operation.responses?'Resume acquisition':'Acquire metadata';
    $('crossref-stop').hidden=!value.running;$('crossref-stop').disabled=isBusy();
    $('crossref-receive').hidden=operation.phase!=='READY';
    $('crossref-receive').disabled=value.questionMatches!==true||isBusy();
    $('crossref-receive').textContent=review?.records?.length?'Retain reviewed edition':'Retain provider outcome';
    $('crossref-download').hidden=!['READY','IMPORTED'].includes(operation.phase);$('crossref-download').disabled=isBusy();
    $('crossref-result').hidden=!review;
    if(review){
      $('crossref-result-summary').textContent=review.records.length+' metadata records; '+array(review.usage.updates).length+' update collections. The comparison uses saved dossier revision '+value.currentRevision+'.';
      $('crossref-usage').textContent=stringify({coverage:review.coverage,usage:review.usage,warnings:review.warnings});
      renderRecords();
    }
    schedule();
  }
  $('crossref-plan-form').addEventListener('submit',event=>{
    event.preventDefault();withAction(async()=>{
      const view=getDossier();
      const input={questionId:$('crossref-question').value,expectedRevision:view.revision,selectedOnly:$('crossref-selected').checked,
        includeUpdates:$('crossref-updates').checked,refresh:$('crossref-fresh').checked,label:$('crossref-label').value};
      if(!local.pending||stringify(local.pending.input)!==stringify(input))savePending({requestId:crypto.randomUUID(),input});
      const result=await api(endpoint('/prepare'),{method:'POST',body:{...local.pending.input,requestId:local.pending.requestId}});
      local.current=result;local.page=0;savePending(null);$('crossref-record-detail').hidden=true;
      await loadList();await loadCurrent();notify('Review the saved DOI scope before starting acquisition.');
    },event.currentTarget);
  });
  for(const id of ['crossref-question','crossref-selected'])$(id).addEventListener('change',renderScope);
  $('crossref-refresh').addEventListener('click',()=>withAction(refresh));
  $('crossref-more').addEventListener('click',()=>withAction(()=>loadList({more:true})));
  $('crossref-start').addEventListener('click',()=>withAction(async()=>{
    local.current=await api(operationPath('/start'),{method:'POST',body:{expectedPlanSha256:local.current.plan.sha256}});
    await loadCurrent();notify('Crossref acquisition is running. Its original responses and progress are retained.');
  }));
  $('crossref-stop').addEventListener('click',()=>withAction(async()=>{
    local.current=await api(operationPath('/stop'),{method:'POST',body:{}});await loadCurrent();
    notify('Acquisition stopped. Resume this saved operation to reuse its original responses.');
  }));
  $('crossref-receive').addEventListener('click',()=>withAction(async()=>{
    const current=local.current;
    const result=await api(operationPath('/receive'),{method:'POST',body:{expectedRevision:current.currentRevision,
      expectedPlanSha256:current.plan.sha256,expectedEditionSha256:current.operation.editionSha256}});
    await onReceived(result.dossier);await loadCurrent();await loadList();
    notify('Reviewed Crossref edition retained in dossier revision '+result.receipt.revision+'.');
  }));
  $('crossref-download').addEventListener('click',()=>withAction(async()=>{
    const response=await api(operationPath('/edition'),{download:true}),blob=await response.blob(),url=URL.createObjectURL(blob);
    const link=el('a');link.href=url;link.download=local.current.plan.id+'.crossref.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }));
  $('crossref-prev').addEventListener('click',()=>{if(local.page>0){local.page--;renderRecords();}});
  $('crossref-next').addEventListener('click',()=>{local.page++;renderRecords();});
  window.addEventListener('beforeunload',stopPoll);
  return {
    configure(value){local.configured=value?.configured===true;local.identity=value?.identity??null;tab.hidden=!local.configured;
      $('crossref-account').textContent=local.identity?'Source account: '+local.identity.account+' · '+local.identity.mode+' provider pool':'';
      renderScope();},
    setDossier(view){
      if(view?.id!==local.dossierId){stopPoll();local.shown=false;local.dossierId=view?.id??null;local.loadVersion++;local.items=[];local.current=null;local.page=0;local.next=null;restorePending();renderList();renderCurrent();}
      local.revision=view?.revision??null;renderQuestions();
    },
    show(visible){const changed=visible!==local.shown;local.shown=visible;if(!visible)stopPoll();
      else if(changed)refresh().catch(error=>notify(friendly(error.code||error.message),'error'));else schedule();},
    updateBusy(){renderScope();renderCurrent();}
  };
}
