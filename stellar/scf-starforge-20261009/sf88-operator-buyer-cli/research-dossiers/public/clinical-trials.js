// MIT. Registry-specific review on the existing Research dossiers session and Store.
export function createClinicalTrialsPanel({root,tab,api,task,notify,getDossier,onReceived,isBusy}){
 const local={configured:false,shown:false,dossierId:null,generation:0,current:null,items:[],next:null,offset:0,poll:null,pending:null,loading:false,retained:[],retainedCurrent:null,retainedOffset:0,inputs:[],inputsNext:null};
 const $=id=>root.querySelector('#ct-'+id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const array=value=>Array.isArray(value)?value:[],date=value=>value?.date?value.date+(value.type?' · '+value.type:''):'—';
 root.innerHTML='<div class="view-heading"><div><h2>Trial registry</h2><p class="muted">Receive an original ClinicalTrials cohort into a research question, review full studies, and preserve the evidence in the dossier.</p></div><button id="ct-refresh" data-ct="refresh">Refresh retained work</button></div>'+
 '<section><h3>Original provider source</h3><p class="muted">Choose the clinicaltrials-workspace.zip saved by the existing ClinicalTrials operator or customer package. Its full source, native builds and reviewed records stay together.</p>'+
 '<label>Source packet<input id="ct-packet-file" type="file" accept=".zip,application/zip"></label><button data-ct="import-packet" id="ct-import-packet">Receive source packet</button>'+
 '<p id="ct-source-status" class="muted"></p><label>Captured cohort<select id="ct-source-select"></select></label><button data-ct="more-inputs" id="ct-more-inputs" hidden>More source packets</button>'+
 '<button data-ct="input-packet" id="ct-input-packet">Download original source packet</button><details><summary>Selected original source and native dataset</summary><pre id="ct-input-detail"></pre></details></section>'+
 '<form id="ct-form" class="ct-form"><label>Research question<select id="ct-question" required></select></label><label>Edition label<input id="ct-label" maxlength="200" value="ClinicalTrials.gov retained cohort" required></label>'+
 '<label class="ct-wide"><input id="ct-allow-partial" type="checkbox"> Include this retained partial capture after reviewing its original status and coverage.</label>'+
 '<p class="muted small ct-wide">The prepared receiving plan binds this exact source packet and capture to the current question. All registry requests, projection, PRS operations and merchant delivery remain with the original ClinicalTrials operator.</p>'+
 '<p class="form-error ct-wide" hidden></p><div class="ct-wide"><button type="submit">Prepare cohort review</button></div></form>'+
 '<section id="ct-retained-section"><h3>Original dossier registry editions</h3><p class="muted small">These complete native editions remain available after original dossier export and reopen, including when no source connection is configured.</p>'+
 '<label>Retained registry edition<select id="ct-retained-select"></select></label><button data-ct="retained-open" id="ct-retained-open">Review original edition</button>'+
 '<div id="ct-retained-review" hidden><h4 id="ct-retained-title"></h4><p id="ct-retained-coverage"></p><div class="ct-actions"><button data-ct="retained-download">Download original registry edition</button><button data-ct="retained-packet">Download complete provider source packet</button><button data-ct="retained-prev" id="ct-retained-prev">Previous records</button><span id="ct-retained-page"></span><button data-ct="retained-next" id="ct-retained-next">Next records</button></div>'+
 '<div class="table-wrap"><table><thead><tr><th>Study</th><th>Registry status</th><th>Protocol / results</th><th></th></tr></thead><tbody id="ct-retained-rows"></tbody></table></div>'+
 '<details><summary>Original cohort scope and source references</summary><pre id="ct-retained-provenance"></pre></details>'+
 '<details id="ct-retained-record" hidden><summary>Complete native record</summary><pre id="ct-retained-record-body"></pre></details>'+
 '<label>Earlier original edition for this question<select id="ct-retained-before"></select></label><button data-ct="retained-compare">Compare original editions</button>'+
 '<pre id="ct-retained-comparison" hidden></pre></div></section>'+
 '<section><h3>Saved cohort receiving</h3><div class="table-wrap"><table><thead><tr><th>Edition</th><th>State</th><th>Pages / records</th><th></th></tr></thead><tbody id="ct-list"></tbody></table></div><button id="ct-more" data-ct="more" hidden>More receiving operations</button></section>'+
 '<section id="ct-current" hidden><div class="view-heading"><div><h3 id="ct-title"></h3><p id="ct-status"></p></div></div><p id="ct-warning" class="muted"></p>'+
 '<details><summary>Exact prepared scope</summary><pre id="ct-scope"></pre></details><div class="ct-actions">'+
 '<button data-ct="start" id="ct-start">Read retained source into review</button><button data-ct="stop" id="ct-stop">Stop local receiving</button>'+
 '<button data-ct="receive" id="ct-receive">Retain reviewed edition</button>'+
 '<button data-ct="download" id="ct-download">Download complete registry edition</button></div>'+
 '<div id="ct-cohort" hidden><p id="ct-coverage"></p><details><summary>Source pages and version observations</summary><pre id="ct-provenance"></pre></details>'+
 '<div class="table-wrap"><table><thead><tr><th>Study</th><th>Registry status</th><th>Design / enrollment</th><th>Source dates</th><th>Posted results</th><th></th></tr></thead><tbody id="ct-studies"></tbody></table></div>'+
 '<div class="ct-actions"><button data-ct="previous" id="ct-previous">Previous records</button><span id="ct-page"></span><button data-ct="next" id="ct-next">Next records</button></div>'+
 '<details id="ct-record" hidden><summary>Complete retained native study record</summary><pre id="ct-record-body"></pre></details>'+
 '<label>Compare with a prior retained acquisition<select id="ct-compare-with"></select></label><button data-ct="compare" id="ct-compare">Compare selected cohorts</button>'+
 '<div id="ct-comparison" hidden><h4>Retained cohort changes</h4><pre id="ct-comparison-body"></pre></div></div></section>';
 const endpoint=suffix=>'/api/dossiers/'+encodeURIComponent(local.dossierId)+'/clinical-trials'+suffix;
 const operation=suffix=>endpoint('/operations/'+local.current.plan.id+suffix);
 const key=()=> 'clinicaltrials-preparation:'+location.origin+':'+local.dossierId;
 function stopPoll(){clearTimeout(local.poll);local.poll=null;}
 function pending(value){local.pending=value;try{if(value)sessionStorage.setItem(key(),JSON.stringify(value));else sessionStorage.removeItem(key());}catch{}}
 function questions(){
  const previous=$('question').value;
  $('question').innerHTML=array(getDossier()?.questions).map(q=>'<option value="'+escape(q.id)+'">'+escape(q.text)+'</option>').join('');
  if(array(getDossier()?.questions).some(q=>q.id===previous))$('question').value=previous;
 }
 function renderList(){
  $('list').innerHTML=local.items.map(row=>'<tr><td>'+escape(row.plan.payload.request.label)+'<br><small>'+escape(row.plan.preparedAt)+'</small></td><td>'+escape(row.operation.phase)+'</td><td>'+row.operation.pages.length+' / '+row.operation.occurrences+'</td><td><button data-ct="open" data-id="'+escape(row.plan.id)+'">Review</button></td></tr>').join('');
  $('more').hidden=!local.next;
  const current=local.current,selected=$('compare-with').value;
  $('compare-with').innerHTML='<option value="">Select an earlier acquisition</option>'+local.items.filter(row=>
   row.operation.editionSha256&&row.plan.id!==current?.plan.id&&row.plan.payload.request.questionId===current?.plan?.payload?.request?.questionId).map(row=>
    '<option value="'+escape(row.plan.id)+'">'+escape(row.plan.payload.request.label)+' · '+escape(row.plan.preparedAt)+'</option>').join('');
  if(local.items.some(row=>row.plan.id===selected))$('compare-with').value=selected;
 }
 function schedule(){
  stopPoll();if(local.shown&&local.current?.running&&!local.loading&&!isBusy())local.poll=setTimeout(()=>loadCurrent().catch(error=>notify(error.code||error.message,'error')),1800);
 }
 function renderCurrent(){
  const value=local.current;$('current').hidden=!value?.operation;if(!value?.operation)return;
  const op=value.operation,request=value.plan.payload.request,cohort=value.cohort;
  $('title').textContent=request.label;
  $('status').textContent=op.phase+' · '+op.pages.length+' retained pages · '+op.occurrences+' study occurrences'+(value.interrupted?' · interrupted owner; retained inputs are available':'');
  const questionMatches=array(getDossier()?.questions).find(q=>q.id===request.questionId)?.text===value.plan.payload.question;
  const warnings=[op.error,...array(cohort?.warnings),value.sourceMatches===false?'The prepared original source packet is unavailable. Its already received dossier edition remains readable.':null,
   !questionMatches?'The original research question changed; prepare receiving for its new wording.':null].filter(Boolean);
  $('warning').textContent=warnings.join(' ');
  $('scope').textContent=JSON.stringify({question:value.plan.payload.question,source:value.plan.payload.source,selection:{sourceId:request.sourceId,captureId:request.captureId,allowPartial:request.allowPartial},planSha256:value.plan.sha256},null,2);
  $('start').hidden=!(['PREPARED','STOPPED','FAILED'].includes(op.phase)||value.interrupted);
  $('start').disabled=isBusy()||!local.configured||value.sourceMatches===false;
  $('start').textContent=op.phase==='PREPARED'?'Read retained source into review':'Resume original receiving';
  $('stop').hidden=!value.running;$('stop').disabled=isBusy();
  $('receive').hidden=op.phase!=='READY';$('receive').disabled=isBusy()||!questionMatches;
  $('download').hidden=!op.editionSha256;$('download').disabled=isBusy();
  $('cohort').hidden=!cohort;
  if(cohort){
   const u=cohort.usage;
   $('coverage').textContent=u.coverage+' · '+u.uniqueStudies+' distinct NCT records / '+u.occurrences+' native occurrences · first-page registry total '+(u.providerTotal??'not supplied')+'.';
   $('provenance').textContent=JSON.stringify({usage:u,pages:cohort.sourcePages},null,2);
   $('studies').innerHTML=cohort.studies.map((row,index)=>'<tr><td><a href="https://clinicaltrials.gov/study/'+escape(row.nctId)+'" target="_blank" rel="noreferrer">'+escape(row.nctId)+'</a><br>'+escape(row.title)+'</td><td>'+escape(row.status)+'<br><small>Verified '+escape(row.statusVerifiedDate??'not supplied')+'</small></td><td>'+escape(row.studyType)+' '+escape(array(row.phases).join(', '))+'<br>'+escape(row.enrollment?.count??'—')+' '+escape(row.enrollment?.type??'')+'</td><td>Start '+escape(date(row.start))+'<br>Primary completion '+escape(date(row.primaryCompletion))+'<br>Updated '+escape(date(row.lastUpdatePosted))+'</td><td>'+escape(row.hasResults===true?'Results posted':row.hasResults===false?'No results flag':'Not supplied')+'</td><td><button data-ct="record" data-index="'+(cohort.offset+index)+'">Native record</button></td></tr>').join('');
   $('page').textContent=(cohort.total?cohort.offset+1:0)+'–'+Math.min(cohort.offset+cohort.limit,cohort.total)+' of '+cohort.total;
   $('previous').disabled=cohort.offset===0||isBusy();$('next').disabled=cohort.offset+cohort.limit>=cohort.total||isBusy();
  }
  schedule();
 }
 async function loadList(more=false){
  const generation=local.generation,dossierId=local.dossierId;
  const answer=await api(endpoint('/operations')+(more&&local.next?'?after='+encodeURIComponent(local.next):''));
  if(generation!==local.generation||dossierId!==local.dossierId)return;
  local.items=more?[...local.items,...answer.items]:answer.items;local.next=answer.next;renderList();
 }
 async function loadCurrent(){
  if(!local.current)return;
  const id=local.current.plan.id,generation=local.generation;local.loading=true;stopPoll();
  try{
   const answer=await api(operation('')+'?offset='+local.offset+'&limit=50');
   if(generation===local.generation&&local.current?.plan.id===id)local.current=answer;
  }finally{local.loading=false;}
  renderCurrent();
 }

 function renderRetained(){
  const selected=$('retained-select').value;
  $('retained-select').innerHTML='<option value="">Select an original registry edition</option>'+local.retained.map(row=>'<option value="'+escape(row.id)+'">'+escape(row.label)+' · '+escape(row.receivedAt??row.id)+'</option>').join('');
  if(local.retained.some(row=>row.id===selected))$('retained-select').value=selected;
  $('retained-open').disabled=isBusy()||!local.retained.length;
  const value=local.retainedCurrent;$('retained-review').hidden=!value;if(!value)return;
  const c=value.cohort,u=c.usage;
  $('retained-title').textContent=value.label;
  $('retained-coverage').textContent=u.coverage+' · '+u.uniqueStudies+' distinct studies · '+u.occurrences+' original occurrences. '+array(c.warnings).join(' ');
  $('retained-rows').innerHTML=c.studies.map((row,index)=>'<tr><td>'+escape(row.nctId)+'<br>'+escape(row.title)+'</td><td>'+escape(row.status)+'</td><td>'+escape(row.studyType)+' · '+escape(row.hasResults===true?'Posted results':row.hasResults===false?'No results flag':'Results not supplied')+'<br>Start '+escape(date(row.start))+' · Updated '+escape(date(row.lastUpdatePosted))+'</td><td><button data-ct="retained-record" data-index="'+(c.offset+index)+'">Native record</button></td></tr>').join('');
  $('retained-provenance').textContent=JSON.stringify({edition:value.edition,question:value.question,usage:u,sourcePages:c.sourcePages},null,2);
  $('retained-page').textContent=(c.total?c.offset+1:0)+'–'+Math.min(c.offset+c.limit,c.total)+' of '+c.total;
  $('retained-prev').disabled=c.offset===0||isBusy();$('retained-next').disabled=c.offset+c.limit>=c.total||isBusy();
  const prior=$('retained-before').value;
  $('retained-before').innerHTML='<option value="">Select an earlier retained edition</option>'+local.retained.filter(row=>row.id!==value.edition.id&&row.questionId===value.edition.questionId).map(row=>'<option value="'+escape(row.id)+'">'+escape(row.label)+' · '+escape(row.receivedAt??row.id)+'</option>').join('');
  if(local.retained.some(row=>row.id===prior))$('retained-before').value=prior;
 }
 async function loadRetained(){
  const generation=local.generation;
  const result=await api(endpoint('/retained'));
  if(generation!==local.generation)return;
  local.retained=result.items;renderRetained();tab.hidden=!local.configured&&!local.retained.length;
 }
 async function openRetained(id){
  const generation=local.generation;
  const result=await api(endpoint('/retained/'+encodeURIComponent(id))+'?offset='+local.retainedOffset+'&limit=50');
  if(generation!==local.generation)return;
  local.retainedCurrent=result;renderRetained();
 }
 async function download(path,name){
  const response=await api(path,{download:true}),url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }

 function selectedInput(){
  const [sourceId,captureId]=($('source-select').value||'').split(':');
  const input=local.inputs.find(row=>row.sourceId===sourceId),capture=input?.captures.find(row=>row.id===captureId);
  return input&&capture?{input,capture}:null;
 }
 function renderInputs(){
  const previous=$('source-select').value;
  $('source-select').innerHTML='<option value="">Select a retained source capture</option>'+local.inputs.flatMap(input=>
   input.captures.map(capture=>'<option value="'+escape(input.sourceId+':'+capture.id)+'">'+escape(capture.configuration?.name??capture.id)+' · '+escape(capture.status)+' · '+capture.rowCount+' studies · '+escape(capture.version?.dataTimestamp??'no version')+'</option>')).join('');
  if([...$('source-select').options].some(option=>option.value===previous))$('source-select').value=previous;
  else if($('source-select').options.length===2)$('source-select').selectedIndex=1;
  const selected=selectedInput();
  $('input-detail').textContent=selected?JSON.stringify({sourcePacket:{sha256:selected.input.packetSha256,bytes:selected.input.packetBytes,
   manifestSha256:selected.input.manifestSha256},capture:selected.capture,nativeBuilds:selected.input.nativeBuilds},null,2):'Select an original source capture.';
  $('input-packet').disabled=isBusy()||!selected;$('more-inputs').hidden=!local.inputsNext;
 }
 async function loadInputs(more=false){
  const generation=local.generation;
  const result=await api(endpoint('/inputs')+(more&&local.inputsNext?'?after='+encodeURIComponent(local.inputsNext):''));
  if(generation!==local.generation)return;
  local.inputs=more?[...local.inputs,...result.items]:result.items;local.inputsNext=result.next;renderInputs();
 }
 function sourceText(value){
  const raw=value.record.content;let result='',depth=0,string=false,escapeNext=false;
  for(const character of raw){
   if(string){result+=character;if(escapeNext)escapeNext=false;else if(character==='\\')escapeNext=true;else if(character==='"')string=false;continue;}
   if(character==='"'){string=true;result+=character;}
   else if(character==='{'||character==='['){depth++;result+=character+'\n'+'  '.repeat(depth);}
   else if(character==='}'||character===']'){depth--;result+='\n'+'  '.repeat(Math.max(0,depth))+character;}
   else if(character===',')result+=',\n'+'  '.repeat(depth);
   else if(character===':')result+=': ';
   else if(!/\s/.test(character))result+=character;
  }
  return JSON.stringify({editionSha256:value.editionSha256,index:value.index,source:value.record.metadata},null,2)+
   '\n\nComplete original study (display indentation only; numeric tokens are unchanged):\n'+result;
 }
 async function refresh(){if(!local.dossierId)return;await loadInputs();await loadRetained();await loadList();await loadCurrent();}
 $('source-select').addEventListener('change',renderInputs);

 const action=(fn,form=null)=>task(async()=>{stopPoll();await fn();},form);
 $('form').addEventListener('submit',event=>{
  event.preventDefault();action(async()=>{
   const view=getDossier(),selected=selectedInput();
   if(!selected){notify('Receive and select an original source capture first.');return;}
   const input={questionId:$('question').value,expectedRevision:view.revision,label:$('label').value,
    sourceId:selected.input.sourceId,captureId:selected.capture.id,allowPartial:$('allow-partial').checked};
   if(!local.pending||JSON.stringify(local.pending.input)!==JSON.stringify(input))pending({requestId:crypto.randomUUID(),input});
   const generation=local.generation;
   const result=await api(endpoint('/prepare'),{method:'POST',body:{...local.pending.input,requestId:local.pending.requestId}});
   if(generation!==local.generation)return;
   local.current=result;local.offset=0;pending(null);await loadList();await loadCurrent();notify('The original source and question are bound. Read the retained cohort into review.');
  },event.currentTarget);
 });
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-ct]');if(!button||button.disabled)return;
  const name=button.dataset.ct;
  action(async()=>{
   if(name==='refresh')return refresh();
   if(name==='more-inputs')return loadInputs(true);
   if(name==='input-packet'){const selected=selectedInput();if(!selected)return;
    return download(endpoint('/inputs/'+selected.input.sourceId+'/packet'),'clinicaltrials-workspace-'+selected.input.packetSha256.slice(0,12)+'.zip');}
   if(name==='import-packet'){
    const file=$('packet-file').files?.[0];if(!file){notify('Choose the original ClinicalTrials source ZIP.');return;}
    if(!file.size||file.size>128*1024*1024){notify('Choose an original source packet up to 128 MiB.');return;}
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const generation=local.generation;
    notify('Receiving and reading the original source packet…');
    const received=await api(endpoint('/inputs')+'?sha256='+sha256+'&bytes='+file.size,{method:'POST',file});
    if(generation!==local.generation)return;
    await loadInputs();if(received.captures.length)$('source-select').value=received.sourceId+':'+received.captures[0].id;
    renderInputs();notify('Original source packet retained with '+received.captures.length+' captured cohort(s).');return;
   }
   if(name==='more')return loadList(true);
   if(name==='retained-open'){
    const id=$('retained-select').value;if(!id){notify('Select the original retained edition.');return;}
    local.retainedOffset=0;$('retained-record').hidden=true;$('retained-comparison').hidden=true;return openRetained(id);
   }
   if(name.startsWith('retained-')){
    const selected=local.retainedCurrent;if(!selected)return;
    if(name==='retained-prev'||name==='retained-next'){local.retainedOffset=Math.max(0,local.retainedOffset+(name==='retained-next'?50:-50));return openRetained(selected.edition.id);}
    const path=endpoint('/retained/'+encodeURIComponent(selected.edition.id));
    if(name==='retained-download')return download(path+'/edition',selected.edition.id+'.clinicaltrials.json');
    if(name==='retained-packet')return download(path+'/packet','clinicaltrials-workspace.zip');
    if(name==='retained-record'){
     const value=await api(path+'/record?index='+encodeURIComponent(button.dataset.index));
     $('retained-record-body').textContent=sourceText(value);$('retained-record').hidden=false;$('retained-record').open=true;return;
    }
    if(name==='retained-compare'){
     const before=$('retained-before').value;if(!before){notify('Select an earlier original edition.');return;}
     const value=await api(endpoint('/retained/compare')+'?before='+encodeURIComponent(before)+'&after='+encodeURIComponent(selected.edition.id));
     $('retained-comparison').textContent=JSON.stringify(value,null,2);$('retained-comparison').hidden=false;return;
    }
   }
   if(name==='open'){local.current={plan:{id:button.dataset.id}};local.offset=0;$('record').hidden=true;$('comparison').hidden=true;return loadCurrent();}
   if(!local.current)return;
   if(name==='previous'||name==='next'){local.offset=Math.max(0,local.offset+(name==='next'?50:-50));return loadCurrent();}
   if(name==='start'||name==='stop'){
    local.current=await api(operation('/'+name),{method:'POST',body:name==='stop'?{}:{expectedPlanSha256:local.current.plan.sha256}});
    await loadCurrent();await loadList();return;
   }
   if(name==='receive'){
    const result=await api(operation('/receive'),{method:'POST',body:{expectedRevision:getDossier().revision,
     expectedPlanSha256:local.current.plan.sha256,expectedEditionSha256:local.current.operation.editionSha256}});
    await onReceived(result.dossier);await loadCurrent();await loadList();await loadRetained();notify('Original registry edition retained at dossier revision '+result.receipt.revision+'.');return;
   }
   if(name==='download'){
    const response=await api(operation('/edition'),{download:true}),url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
    link.href=url;link.download=local.current.plan.id+'.clinicaltrials.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return;
   }
   if(name==='record'){
    const value=await api(operation('/record')+'?index='+encodeURIComponent(button.dataset.index));
    $('record-body').textContent=sourceText(value);$('record').hidden=false;$('record').open=true;return;
   }
   if(name==='compare'){
    if(!$('compare-with').value){notify('Select the original prior acquisition.');return;}
    const value=await api(operation('/compare')+'?before='+encodeURIComponent($('compare-with').value));
    $('comparison-body').textContent=JSON.stringify(value,null,2);$('comparison').hidden=false;
   }
  });
 });
 window.addEventListener('beforeunload',stopPoll);
 return {
  configure(value){local.configured=value?.configured===true;tab.hidden=!local.configured&&!local.retained.length;
   $('form').hidden=!local.configured;$('source-status').textContent=local.configured?'The original packet reader is available. Source acquisition and merchant operation stay in the existing ClinicalTrials console.':'Original received registry editions remain readable.';
  },
  setDossier(view){
   if(view?.id!==local.dossierId){stopPoll();local.generation++;local.dossierId=view?.id??null;local.items=[];local.current=null;local.next=null;local.offset=0;local.retained=[];local.retainedCurrent=null;local.retainedOffset=0;local.inputs=[];local.inputsNext=null;
    try{local.pending=JSON.parse(sessionStorage.getItem(key())||'null');}catch{local.pending=null;}
    renderList();renderCurrent();renderRetained();renderInputs();
   }
   questions();local.retained=array(view?.editions).filter(row=>row.provider==='clinicaltrials-gov'&&row.mode==='retained');renderRetained();tab.hidden=!local.configured&&!local.retained.length;
  },
  show(visible){const changed=visible!==local.shown;local.shown=visible;if(!visible)stopPoll();else if(changed)refresh().catch(error=>notify(error.code||error.message,'error'));else schedule();},
  updateBusy(){for(const element of $('form').querySelectorAll('input,textarea,select,button'))element.disabled=isBusy()||!local.configured||!getDossier()?.questions?.length;renderCurrent();renderRetained();$('import-packet').disabled=isBusy();$('packet-file').disabled=isBusy();renderInputs();}
 };
}
