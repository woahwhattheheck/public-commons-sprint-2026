const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
/* MIT. Explicit customer portfolio refresh in the original Monitoring desk. */
export async function mountPortfolioRefresh({root,api,getState,refresh,inspectCase,message,escape}) {
  const e=escape,context=await api("cycle-context"),branch=context.workspace;
  const call=(path,body,options={})=>api(path,body,{...options,headers:{"X-Review-Workspace":encodeURIComponent(branch),...options.headers}});
  root.innerHTML='<div class="page-heading"><div><p class="eyebrow">Customer source changes</p><h1>Portfolio refresh</h1><p>Compare two retained editions of the same customer population. Review original counterparty changes and explicitly retain or continue each existing case.</p></div></div>'+
    '<article><h2>Choose original customer editions</h2><form data-refresh-pair><div class="form-grid"><label>Earlier selected portfolio<select name="before" required></select></label><label>Following selected portfolio<select name="after" required></select></label></div><button type="submit">Compare selected portfolios</button></form><label>Saved comparison<select data-refresh-saved><option value="">Choose a saved comparison</option></select></label></article>'+
    '<div data-refresh-pending aria-live="polite"></div><article data-refresh-results hidden><h2 data-refresh-title>Compared population</h2><p data-refresh-summary></p><div class="form-grid"><label>Change kind<select data-refresh-kind><option value="">All counterparties</option><option value="changed">Changed</option><option value="added">Added</option><option value="removed">Removed</option><option value="unchanged">Unchanged</option></select></label><label>Find counterparty<input data-refresh-search type="search"></label></div><div class="actions"><button data-refresh-filter type="button">Apply display filter</button><button data-refresh-json type="button">Download complete JSON report</button><button data-refresh-html type="button">Download complete HTML report</button><button data-refresh-before type="button">Download earlier original FtM</button><button data-refresh-after type="button">Download following original FtM</button></div><div data-refresh-rows class="table-wrap"></div><div class="actions"><button data-refresh-prev type="button">Previous counterparties</button><span data-refresh-page></span><button data-refresh-next type="button">Next counterparties</button></div></article>'+
    '<article data-refresh-detail hidden></article>';
  const q=selector=>root.querySelector(selector),pair=q('[data-refresh-pair]'),f=name=>pair.elements.namedItem(name);
  const slot='source-monitoring/portfolio-refresh/'+branch;
  let active=false,generation=0,busy=false,selected='',data=null,row=null,pending=null,history=[],drafts={},pairDraft={},offset=0;
  try{const saved=JSON.parse(localStorage.getItem(slot)||'null');if(saved){pending=saved.pending??null;history=saved.history??[];drafts=saved.drafts??{};pairDraft=saved.pair??{};selected=saved.selected??'';}}catch{}
  const save=()=>localStorage.setItem(slot,JSON.stringify({pending,history,drafts,pair:{before:f('before').value,after:f('after').value},selected}));
  const valid=turn=>active&&root.isConnected&&turn===generation;
  const changed=()=>{generation++;};
  function options(node,items,prior){
    node.replaceChildren(new Option('Choose an original portfolio',''),...items.map(item=>new Option(item.label+' · '+item.key+' · '+item.id.slice(0,12),item.id)));
    node.value=items.some(item=>item.id===prior)?prior:'';
  }
  function portfolios(){
    const list=getState()?.portfolios??[];
    options(f('before'),list,f('before').value||pairDraft.before);
    options(f('after'),list,f('after').value||pairDraft.after);
  }
  function pendingView(){
    q('[data-refresh-pending]').innerHTML=pending?'<article><h2>Original review request retained</h2><p>The response is unconfirmed. Continue these exact choices; no new request id will be created.</p><button data-refresh-resume type="button">Continue original review</button><button data-refresh-status type="button">Read original request status</button><details><summary>Retained choices</summary><pre>'+e(JSON.stringify(pending,null,2))+'</pre></details></article>':'';
    q('[data-refresh-resume]')?.addEventListener('click',()=>perform(pending));
    q('[data-refresh-status]')?.addEventListener('click',checkRequest);
    const submit=q('[data-refresh-review] button[type="submit"]');if(submit)submit.disabled=busy||!!pending;
    q('[data-refresh-resume]')?.toggleAttribute('disabled',busy);
  }
  async function lists(){
    const turn=generation;
    try{const value=await call('portfolio-refreshes');if(!valid(turn))return;
      const node=q('[data-refresh-saved]');node.replaceChildren(new Option('Choose a saved comparison',''),...value.rows.map(item=>new Option(item.portfolioKey+' · '+item.before.slice(0,8)+' → '+item.after.slice(0,8)+' · '+item.population,item.id)));
      node.value=value.rows.some(item=>item.id===selected)?selected:'';
    }catch(error){if(valid(turn))message(error.message,true);}
  }
  function render(){
    if(!data)return;
    q('[data-refresh-results]').hidden=false;
    q('[data-refresh-title]').textContent=data.comparison.portfolioKey+' · '+data.before.label+' → '+data.after.label;
    q('[data-refresh-summary]').textContent=data.comparison.population+' original counterparties; '+Object.entries(data.comparison.counts).map(([kind,count])=>count+' '+kind).join(', ')+'. '+data.eventCount+' attributed reviews. Cases remain on their original portfolio until explicitly continued.';
    q('[data-refresh-rows]').innerHTML=data.rows.length?'<table><thead><tr><th>Counterparty</th><th>Original change</th><th>Existing cases</th><th>Review</th></tr></thead><tbody>'+data.rows.map(item=>'<tr><td>'+e(item.caption)+'<br><code>'+e(item.entityId)+'</code></td><td>'+e(item.kind)+'<br>'+e(item.meaningfulProperties.join(', '))+'</td><td>'+item.cases.length+' · '+item.cases.filter(c=>c.eligible).length+' on earlier edition</td><td><button type="button" data-refresh-open="'+e(item.entityId)+'">Inspect and review</button></td></tr>').join('')+'</tbody></table>':'<p>No counterparties match this display filter. The complete report includes the whole original population.</p>';
    root.querySelectorAll('[data-refresh-open]').forEach(button=>button.addEventListener('click',()=>openRow(button.dataset.refreshOpen)));
    q('[data-refresh-page]').textContent=data.total?'Showing '+(data.offset+1)+'–'+(data.offset+data.rows.length)+' of '+data.total:'No displayed rows';
    q('[data-refresh-prev]').disabled=data.offset===0;q('[data-refresh-next]').disabled=data.offset+data.rows.length>=data.total;
  }
  async function load(){
    if(!selected)return;
    const turn=++generation,id=selected;
    try{const value=await call('portfolio-refresh?'+new URLSearchParams({id,offset:String(offset),limit:'50',kind:q('[data-refresh-kind]').value,query:q('[data-refresh-search]').value}));
      if(!valid(turn)||id!==selected)return;
      data=value;render();save();if(row){const next=value.rows.find(item=>item.entityId===row.entityId);if(next)openRow(next.entityId);else{row=null;q('[data-refresh-detail]').hidden=true;}}
    }catch(error){if(valid(turn))message(error.message,true);}
  }
  function draftKey(){return selected+'/'+row.entityId;}
  function storeForm(){
    const form=q('[data-refresh-review]');if(!row||!form)return;
    drafts[draftKey()]=Object.fromEntries(['caseId','decision','reviewer','reason','resolution','relevance','matchRequest'].map(name=>[name,form.elements.namedItem(name).value]));save();
  }
  function openRow(id){
    row=data.rows.find(item=>item.entityId===id);if(!row)return;generation++;
    const node=q('[data-refresh-detail]');node.hidden=false;
    node.innerHTML='<h2>'+e(row.caption)+'</h2><p><code>'+e(row.entityId)+'</code> · '+e(row.kind)+'</p>'+
      '<div class="actions">'+(row.before?'<button data-refresh-original="before" type="button">Read earlier original entity</button>':'')+(row.after?'<button data-refresh-original="after" type="button">Read following original entity</button>':'')+'</div><div data-refresh-original-detail></div>'+
      '<h3>Exact attribute changes</h3><div class="table-wrap"><table><thead><tr><th>Property</th><th>Earlier values</th><th>Following values</th><th>Meaning</th></tr></thead><tbody>'+row.properties.map(prop=>'<tr><td>'+e(prop.property)+'</td><td><pre>'+e(JSON.stringify(prop.before,null,2))+'</pre></td><td><pre>'+e(JSON.stringify(prop.after,null,2))+'</pre></td><td>'+e(prop.orderOnly?'Value order only':'Values added or removed')+'</td></tr>').join('')+'</tbody></table></div><details><summary>Other original fields and source positions</summary><pre>'+e(JSON.stringify({metadata:row.metadata,before:row.before,after:row.after},null,2))+'</pre></details>'+
      '<h3>Original cases</h3><div data-refresh-cases>'+row.cases.map(entry=>'<section class="refresh-case"><p><strong>'+e(entry.case.candidateId)+'</strong> · '+e(entry.case.resolution)+' / '+e(entry.case.relevance)+'</p><p>Portfolio '+e(entry.case.portfolio)+' · revision '+e(entry.case.revision)+'</p><p>'+e(entry.eligible?'Bound to the earlier selected portfolio.':entry.case.portfolio===data.comparison.after?'Already on the following portfolio.':'Bound to another retained portfolio edition; not eligible here.')+'</p><button type="button" data-refresh-case="'+e(entry.case.id)+'">Open original case</button>'+(entry.review?'<details><summary>'+e(entry.reviewCurrent?'Current attributed review':'Historical review; case has advanced')+'</summary><pre>'+e(JSON.stringify(entry.review,null,2))+'</pre></details>':'')+'</section>').join('')+(row.cases.length?'':'<p>No existing case is recorded for this original customer counterparty.</p>')+'</div>'+
      (row.sourceReview?'<details><summary>Latest source-only review</summary><pre>'+e(JSON.stringify(row.sourceReview,null,2))+'</pre></details>':'')+
      '<h3>Record an explicit review</h3><p>A removed record is not a legal conclusion or an instruction to close its case. Continuing preserves the selected candidate and source edition; it does not rerun matching. Any prior matching response stays in case history and is not represented as a response for new input.</p>'+
      '<form data-refresh-review><div class="form-grid"><label>Review target<select name="caseId"><option value="">Source only — no case change</option>'+row.cases.filter(entry=>entry.eligible).map(entry=>'<option value="'+e(entry.case.id)+'">'+e(entry.case.candidateId)+' · '+e(entry.case.revision.slice(0,12))+'</option>').join('')+'</select></label><label>Explicit decision<select name="decision" required><option value="">Choose a decision</option><option value="reviewed">Record source review only</option><option value="retain">Retain the original case and portfolio</option><option value="continue">Continue this case on the following portfolio</option></select></label><label>Reviewer<input name="reviewer" required maxlength="160"></label><label>Reason<textarea name="reason" rows="3" required maxlength="8000"></textarea></label></div>'+
      '<fieldset data-refresh-continuation><legend>Required only when continuing the selected case</legend><div class="form-grid"><label>Identity decision<select name="resolution"><option value="">Choose explicitly</option><option value="same_entity">Same entity</option><option value="different_entity">Different entity</option><option value="undecided">Undecided</option></select></label><label>Relevance decision<select name="relevance"><option value="">Choose explicitly</option><option value="in_scope">In scope</option><option value="out_of_scope">Out of scope</option><option value="undecided">Undecided</option></select></label><label>Optional actual following-portfolio match request<input name="matchRequest" maxlength="64" placeholder="Leave empty to retain manual review provenance"></label></div></fieldset><button type="submit">Save explicit portfolio review</button></form>';
    const form=q('[data-refresh-review]'),saved=drafts[draftKey()]??{};
    for(const [name,value] of Object.entries(saved)){const field=form.elements.namedItem(name);if(field)field.value=value;}
    const sync=()=>{const continuing=form.elements.namedItem('decision').value==='continue';q('[data-refresh-continuation]').hidden=!continuing;for(const name of ['resolution','relevance'])form.elements.namedItem(name).required=continuing;storeForm();};
    form.addEventListener('input',sync);form.addEventListener('change',sync);sync();
    form.addEventListener('submit',event=>{event.preventDefault();submit();});
    node.querySelectorAll('[data-refresh-case]').forEach(button=>button.addEventListener('click',async()=>{try{await inspectCase(button.dataset.refreshCase);}catch(error){message(error.message,true);}}));
    node.querySelectorAll('[data-refresh-original]').forEach(button=>button.addEventListener('click',async()=>{
      const turn=generation,id=row.entityId,scope=data.comparison[button.dataset.refreshOriginal];
      try{const original=await call('entity?'+new URLSearchParams({scope,id}));if(!valid(turn)||row?.entityId!==id)return;q('[data-refresh-original-detail]').innerHTML='<pre>'+e(JSON.stringify(original,null,2))+'</pre>';}catch(error){if(valid(turn))message(error.message,true);}
    }));
    pendingView();
  }
  async function submit(){
    if(busy||pending||!row)return;
    const form=q('[data-refresh-review]'),v=name=>form.elements.namedItem(name).value.trim();
    const request={requestId:crypto.randomUUID(),comparisonId:selected,entityId:row.entityId,decision:v('decision'),reviewer:v('reviewer'),reason:v('reason')};
    if(request.decision!=='reviewed'){
      const choice=row.cases.find(entry=>entry.case.id===v('caseId'));
      if(!choice?.eligible){message('Choose an original case still bound to the earlier portfolio.',true);return;}
      request.caseId=choice.case.id;request.expectedCaseRevision=choice.case.revision;
      if(request.decision==='continue'){
        if(!choice.canContinue){message('This counterparty is absent from the following portfolio; its original case is preserved.',true);return;}
        request.resolution=v('resolution');request.relevance=v('relevance');if(v('matchRequest'))request.matchRequest=v('matchRequest');
      }
    }else if(v('caseId')){message('Choose Source only for a source-only review. It does not review an existing case.',true);return;}
    try{pending=request;save();}catch(error){pending=null;message('The original request could not be retained locally: '+error.message,true);return;}
    pendingView();await perform(request);
  }
  async function perform(request){
    if(busy||!request)return;busy=true;pendingView();const turn=generation;
    try{
      const result=await call('portfolio-refresh-command',request);
      if(result.requestId!==request.requestId||result.comparisonId!==request.comparisonId||result.entityId!==request.entityId)throw Error('The returned review does not match the original request.');
      pending=null;history.push({request,result});save();
      if(valid(turn)){message('Original portfolio review saved. '+(result.caseChanged?'The explicitly selected case now uses the following portfolio.':'The original case has not been changed.'));await refresh();await load();}
    }catch(error){
      if(error.native?.notCommitted===true&&error.native.requestId===request.requestId){history.push({request,rejected:error.message});pending=null;save();}
      if(valid(turn))message(error.message+(pending?' The exact original request remains available to continue.':''),true);
    }finally{busy=false;pendingView();}
  }
  async function checkRequest(){
    if(busy||!pending)return;const request=pending,turn=generation;
    try{const answer=await call('portfolio-refresh-request?'+new URLSearchParams({requestId:request.requestId}));
      if(answer.committed){if(canonical(answer.event.request)!==canonical(request))throw Error('The original request id is bound to different choices.');pending=null;history.push({request,result:answer.result});save();if(valid(turn)){message('The original review was already committed.');await refresh();await load();}}
      else if(valid(turn))message('No committed result is present. Continue the retained request; its choices remain unchanged.');
    }catch(error){if(valid(turn))message(error.message,true);}finally{pendingView();}
  }
  async function downloadReport(format){
    if(!selected)return;const turn=generation,id=selected;
    try{const result=await call('portfolio-refresh-report'+(format==='html'?'-html':'')+'?'+new URLSearchParams({id}),undefined,{download:true});if(!valid(turn)||id!==selected)return;
      const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download='Portfolio_Refresh_'+id+'.'+format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){if(valid(turn))message(error.message,true);}
  }
  pair.addEventListener('input',()=>{changed();save();});pair.addEventListener('change',()=>{changed();save();});
  pair.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const before=f('before').value,after=f('after').value,turn=++generation;
    try{const result=await call('portfolio-refresh-prepare',{before,after});if(!valid(turn)||f('before').value!==before||f('after').value!==after)return;selected=result.id;row=null;offset=0;q('[data-refresh-detail]').hidden=true;save();await lists();await load();}
    catch(error){if(valid(turn))message(error.message,true);}
  });
  q('[data-refresh-saved]').addEventListener('change',async()=>{selected=q('[data-refresh-saved]').value;row=null;data=null;offset=0;q('[data-refresh-results]').hidden=true;q('[data-refresh-detail]').hidden=true;changed();save();await load();});
  q('[data-refresh-kind]').addEventListener('change',changed);
  q('[data-refresh-search]').addEventListener('input',changed);
  q('[data-refresh-filter]').addEventListener('click',()=>{offset=0;load();});
  q('[data-refresh-prev]').addEventListener('click',()=>{offset=Math.max(0,offset-50);load();});
  q('[data-refresh-next]').addEventListener('click',()=>{offset+=50;load();});
  q('[data-refresh-json]').addEventListener('click',()=>downloadReport('json'));q('[data-refresh-html]').addEventListener('click',()=>downloadReport('html'));
  for(const side of ['before','after'])q('[data-refresh-'+side+']').addEventListener('click',async()=>{
    if(!data)return;const turn=generation,id=data[side].source;
    try{const result=await call('source?'+new URLSearchParams({id}),undefined,{download:true});if(!valid(turn))return;const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download='Original_'+side+'_'+id+'.ftm.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){if(valid(turn))message(error.message,true);}
  });
  portfolios();pendingView();
  return {openComparison:async(id,entityId='')=>{
      if(!/^[a-f0-9]{64}$/.test(id))throw Error('Choose an original saved portfolio comparison.');
      active=true;generation++;selected=id;row=null;data=null;offset=0;
      q('[data-refresh-kind]').value='';q('[data-refresh-search]').value=entityId;
      q('[data-refresh-detail]').hidden=true;const turn=generation+1;await load();
      if(valid(turn)&&selected===id&&data?.rows.some(item=>item.entityId===entityId))openRow(entityId);
    },activate:async()=>{active=true;generation++;portfolios();pendingView();await lists();if(selected)await load();},
    deactivate:()=>{active=false;generation++;try{storeForm();}catch(error){message('Draft storage failed: '+error.message,true);}},refresh:()=>{portfolios();},
    dispose:()=>{active=false;generation++;try{storeForm();}catch(error){message('Draft storage failed: '+error.message,true);}}};
}
