const escape=value=>String(value??'').replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>typeof value==='string'?value:JSON.stringify(value??null);
const tableDefinitions={
volume:{label:'Protocol volume',columns:['protocol','side','asset','atomic','decimal','count','executionIds']},
selectionDistribution:{label:'Selection distribution',columns:['protocol','count','denominator','outcomes','selectionIds']},
routeAttempts:{label:'Route attempts',columns:['id','protocol','accountId','selectedAt','quoteId','outcome']},
balanceObservations:{label:'Observed balances',columns:['id','accountId','amount','observedAt','authority']},
vaultActivities:{label:'Vault activity',columns:['id','vault','accountId','economicAt','state','sourceStatus','sourceReasons','operation','shareChangeAtomic','flows','unresolvedContracts','basis']},
positions:{label:'Vault positions',columns:['id','vault','accountId','status','observedAt','sharesAtomic','underlying','basis','reasons']},
quality:{label:'Execution quality',columns:['executionId','quoteId','protocol','economicAt','status','mode','asset','expectedAtomic','expectedDecimal','actualAtomic','actualDecimal','favorableAtomic','favorableDecimal','quality','limit','reasons']},
executions:{label:'Executions',columns:['id','protocol','accountId','economicAt','observedAt','state','input','output','selectedQuoteId','confirmedIdentity']},
movements:{label:'Confirmed movements',columns:['id','accountId','economicAt','observedAt','role','amount','confirmedIdentity','authority']},
accountReconciliation:{label:'Account reconciliation',columns:['accountId','asset','status','opening','closing','knownMovementTotals','derivedClosing','difference','reasons']},
fallbacks:{label:'Fallback events',columns:['id','occurredAt','fromProtocol','toProtocol','reason','status','fromSelectionId','toSelectionId','reasons']},
lifecycle:{label:'Settlement timeline',columns:['id','provider','providerIdentity','accountId','state','sourceConfirmed','destinationConfirmed','cashPaidOut','refundConfirmed','economicAt','observedAt']},
coverage:{label:'Source coverage',columns:['id','accountId','asset','rangeFrom','rangeThrough','status','authority','sourceRefs']},
exceptions:{label:'Exceptions and review',columns:['id','kind','recordId','message','sourceRefs']},
inventory:{label:'Original inventory',columns:['id','kind','bytes','sha256','path']}
};
const fileNames=['report.json','complete-source.json','volume.csv','selections.csv','route-attempts.csv','balance-observations.csv','vault-activities.csv','positions.csv','execution-quality.csv','movements.csv','reconciliation.csv','fallbacks.csv','lifecycle.csv','exceptions.csv','report.html','manifest.json'];
const styles=String.raw`
.bim-accountant{font:14px system-ui,sans-serif;color:#191919;background:#fff;line-height:1.5}.bim-accountant *{box-sizing:border-box}.bim-accountant header,.bim-accountant section{padding:18px;border:1px solid #c5c5c5;margin:0 0 16px}.bim-accountant h1{font-size:24px;font-weight:600;margin:0 0 8px}.bim-accountant h2{font-size:18px;font-weight:600;margin:0 0 12px}.bim-accountant p{margin:8px 0}.bim-accountant label{display:block;margin:10px 0}.bim-accountant input,.bim-accountant select,.bim-accountant textarea,.bim-accountant button{font:inherit;color:inherit;border:1px solid #777;border-radius:0;background:#fff;padding:8px;max-width:100%}.bim-accountant input[type=text],.bim-accountant textarea{width:100%}.bim-accountant button{cursor:pointer}.bim-accountant button:disabled{cursor:default;opacity:.55}.bim-accountant button[aria-pressed=true]{background:#252525;color:#fff}.bim-accountant .controls,.bim-accountant nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bim-accountant .selection{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.bim-accountant .full{grid-column:1/-1}.bim-accountant .table-scroll{overflow:auto;max-height:65vh}.bim-accountant table{border-collapse:collapse;min-width:100%;width:max-content;max-width:8000px}.bim-accountant th,.bim-accountant td{padding:8px;border:1px solid #bbb;text-align:left;vertical-align:top;max-width:420px;overflow-wrap:anywhere;white-space:pre-wrap}.bim-accountant th{background:#eee;position:sticky;top:0}.bim-accountant pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.bim-accountant details{margin:10px 0}.bim-accountant .notice{border-left:4px solid #333;padding:10px;background:#f3f3f3}.bim-accountant .pager{display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap}.bim-accountant dialog{width:min(1000px,95vw);max-height:90vh;border:1px solid #555;padding:20px;color:#191919}.bim-accountant dialog::backdrop{background:#0008}.bim-accountant dialog pre{max-height:65vh}.bim-accountant .downloads{display:flex;flex-wrap:wrap;gap:8px}.bim-accountant .status{min-height:24px;font-weight:600}.bim-accountant .mono{font:12px ui-monospace,monospace;overflow-wrap:anywhere}@media(max-width:600px){.bim-accountant header,.bim-accountant section{padding:12px}.bim-accountant .selection{grid-template-columns:1fr}.bim-accountant .controls>*{width:100%}.bim-accountant table{font-size:12px}.bim-accountant .downloads button{flex:1 1 140px}}
`;
/**
 * Controller methods are bound by the original backend integration:
 * build(selection,{signal}); source({sourceSha256,ref},{signal});
 * file({sourceSha256,selection,name},{signal}) => Blob;
 * receive(File,{signal}) => {report}; reviews({sourceSha256,reportSha256},{signal});
 * review({sourceSha256,reportSha256,exceptionId,decision,reason,evidenceIds},{signal}).
 * Caller supplies the current workspace session key; a changed session clears all state.
 */
export function mountSettlementOperator(root,controller){
  if(!root||!controller||typeof controller.build!=='function'||typeof controller.sessionKey!=='function')throw Error('Original accountant controller and session are required.');
  const state={session:controller.sessionKey(),report:null,section:'volume',filter:'',page:0,pageSize:50,busy:false,status:'Choose an economic range and build a report from the current original workspace.',generation:0,abort:null,reviews:[],selection:{from:null,through:null,accounts:[],includeUndated:false},disposed:false};
  const emptyDraft=()=>({schema:'bim.settlement-operator-draft.v1',selection:{from:'',through:'',accounts:'',includeUndated:false},reviews:{}});
  state.draft=emptyDraft();state.draftVersion=0;state.draftTimer=null;state.activeReview=null;state.draftSave=Promise.resolve();
  function saveDraft(){
    if(state.draftTimer)clearTimeout(state.draftTimer);state.draftTimer=null;
    if(typeof controller.saveDraft!=='function')return state.draftSave;
    const draft=JSON.parse(JSON.stringify(state.draft)),session=state.session;
    state.draftSave=state.draftSave.catch(()=>{}).then(()=>controller.saveDraft(draft,{sessionKey:session})).catch(error=>{if(controller.sessionKey()===session&&!state.disposed){state.status='Draft save: '+(error.message||String(error));const status=root.querySelector('[role="status"]');if(status)status.textContent=state.status;}});
    return state.draftSave;
  }
  function draftChanged(){state.draftVersion++;if(state.draftTimer)clearTimeout(state.draftTimer);state.draftTimer=setTimeout(saveDraft,250);}
  function loadDraft(){
    if(typeof controller.loadDraft!=='function')return;
    const session=state.session,version=state.draftVersion;
    Promise.resolve(controller.loadDraft({sessionKey:session})).then(value=>{
      if(state.disposed||session!==state.session||controller.sessionKey()!==session||version!==state.draftVersion||!value)return;
      if(value.schema!=='bim.settlement-operator-draft.v1'||!value.selection||!value.reviews||typeof value.reviews!=='object')throw Error('Original operator draft has another schema.');
      for(const key of ['from','through','accounts'])if(typeof value.selection[key]!=='string')throw Error('Original selection draft is incomplete.');
      state.draft={schema:value.schema,selection:{...value.selection,includeUndated:value.selection.includeUndated===true},reviews:JSON.parse(JSON.stringify(value.reviews))};render();
    }).catch(error=>{if(!state.disposed&&session===state.session){state.status='Draft reopen: '+(error.message||String(error));render();}});
  }
  root.classList.add('bim-accountant');
  function alive(generation,session){return !state.disposed&&generation===state.generation&&session===state.session&&controller.sessionKey()===session;}
  function captureSelection(form){
    const data=new FormData(form),from=String(data.get('from')||'').trim(),through=String(data.get('through')||'').trim();
    const accounts=String(data.get('accounts')||'').split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
    return {from:from||null,through:through||null,accounts,includeUndated:data.get('includeUndated')==='on'};
  }
  function rows(){
    const full=state.report?.[state.section]||[],query=state.filter.trim().toLowerCase();
    return query?full.filter(row=>JSON.stringify(row).toLowerCase().includes(query)):full;
  }
  function render(){
    if(state.disposed)return;
    const report=state.report,definition=tableDefinitions[state.section],all=rows(),maxPage=Math.max(0,Math.ceil(all.length/state.pageSize)-1);
    state.page=Math.min(state.page,maxPage);
    const start=state.page*state.pageSize,page=all.slice(start,start+state.pageSize);
    root.innerHTML='<style>'+styles+'</style><header><h1>Settlement and execution accounting</h1><p>Inspect original quotes, confirmed movements, settlement and source coverage. Every total retains exact network and asset identity.</p><div class="status" role="status" aria-live="polite">'+escape(state.status)+'</div></header>'+
      '<section><h2>Original workspace report</h2><form data-form="selection"><div class="selection">'+
      '<label>First economic time, inclusive<input name="from" type="text" placeholder="2026-10-01T00:00:00Z" value="'+escape(state.draft.selection.from)+'"></label>'+
      '<label>Final economic time, inclusive<input name="through" type="text" placeholder="2026-10-31T23:59:59Z" value="'+escape(state.draft.selection.through)+'"></label>'+
      '<label class="full">Exact account IDs, one per line; blank means all retained accounts<textarea name="accounts" rows="3">'+escape(state.draft.selection.accounts)+'</textarea></label>'+
      '<label class="full"><input name="includeUndated" type="checkbox" '+(state.draft.selection.includeUndated?'checked':'')+'> Include undated original facts in the selected population; their time remains unknown</label></div>'+
      '<div class="controls"><button type="submit" '+(state.busy?'disabled':'')+'>Build complete report</button><button type="button" data-action="choose-package" '+(state.busy?'disabled':'')+'>Open complete source package</button><input type="file" data-package hidden accept=".json,application/json"></div></form>'+
      '<p>Use an explicit UTC or offset timestamp. Empty range endpoints retain all original dates; completeness still depends on the source coverage.</p></section>'+
      (report?'<section><h2>Selected original basis</h2><p>Workspace '+escape(report.source.workspaceId)+'</p><p class="mono">Source '+escape(report.source.sha256)+'<br>Report '+escape(report.sha256)+'</p><pre>'+escape(JSON.stringify(report.counts,null,2))+'</pre><details><summary>Calculation and coverage policy</summary><pre>'+escape(JSON.stringify(report.policy,null,2))+'</pre></details><details><summary>Undated original population</summary><pre>'+escape(JSON.stringify(report.undated,null,2))+'</pre></details></section>'+
      '<section><nav aria-label="Report sections">'+Object.entries(tableDefinitions).map(([key,value])=>'<button data-action="section" data-section="'+key+'" aria-pressed="'+(state.section===key)+'">'+escape(value.label)+' ('+(report[key]?.length||0)+')</button>').join('')+'</nav></section>'+
      '<section><h2>'+escape(definition.label)+'</h2><label>Filter this complete population<input data-filter type="text" value="'+escape(state.filter)+'"></label><div class="pager"><button data-action="previous" '+(state.page===0?'disabled':'')+'>Previous</button><span>'+all.length+' matched · '+(all.length?start+1:0)+'–'+Math.min(start+page.length,all.length)+'</span><button data-action="next" '+(state.page>=maxPage?'disabled':'')+'>Next</button><label>Rows <select data-page-size>'+[25,50,100,250].map(n=>'<option '+(state.pageSize===n?'selected':'')+'>'+n+'</option>').join('')+'</select></label></div>'+
      '<div class="table-scroll" tabindex="0"><table><thead><tr>'+definition.columns.map(name=>'<th scope="col">'+escape(name)+'</th>').join('')+'<th scope="col">Original detail</th></tr></thead><tbody>'+page.map((row,i)=>'<tr>'+definition.columns.map(name=>'<td>'+escape(text(row[name]))+'</td>').join('')+'<td><button data-action="detail" data-index="'+(start+i)+'">Open row</button>'+(state.section==='exceptions'&&typeof controller.review==='function'?'<button data-action="review" data-index="'+(start+i)+'">Review exception</button>':'')+'</td></tr>').join('')+'</tbody></table></div></section>'+
      '<section><h2>Complete files</h2><p>Each download uses the report’s exact selected source. The source package reopens and recomputes the full report.</p><div class="downloads">'+fileNames.map(name=>'<button data-action="download" data-name="'+name+'" '+(state.busy?'disabled':'')+'>'+escape(name)+'</button>').join('')+'</div></section>'+
      '<section><h2>Saved exception decisions</h2><p>Decisions remain tied to their exact report/source basis.</p><pre>'+escape(JSON.stringify(state.reviews,null,2))+'</pre></section>':'')+
      '<dialog data-dialog><div class="controls"><button data-action="close-dialog">Close</button></div><div data-dialog-body></div></dialog>';
    if(state.activeReview&&state.report){const row=state.report.exceptions.find(x=>x.id===state.activeReview);if(row)reviewDialog(row);}
  }
  async function run(label,fn,{retainReport=true}={}){
    if(state.busy||state.disposed)return;
    if(controller.sessionKey()!==state.session){clear();return;}
    const session=state.session,generation=++state.generation;
    state.abort?.abort();state.abort=new AbortController();state.busy=true;state.status=label;render();
    try{const result=await fn({signal:state.abort.signal,isCurrent:()=>alive(generation,session)});if(!alive(generation,session))return;if(result?.report){state.report=result.report;state.selection={...result.report.selection};state.page=0;state.filter='';}if(result?.reviews)state.reviews=result.reviews;state.status=result?.message||'Complete.';}
    catch(error){if(!alive(generation,session))return;state.status=error.name==='AbortError'?'Operation cancelled.':error.message||String(error);if(!retainReport)state.report=null;}
    finally{if(alive(generation,session)){state.busy=false;state.abort=null;render();}else if(!state.disposed&&controller.sessionKey()!==state.session)clear();}
  }
  async function refreshReviews(report,signal){
    if(typeof controller.reviews!=='function')return[];
    const value=await controller.reviews({sourceSha256:report.source.sha256,reportSha256:report.sha256},{signal});
    if(!Array.isArray(value))throw Error('Original review reader returned an invalid population.');
    return value;
  }
  function dialog(html){
    const element=root.querySelector('[data-dialog]');element.querySelector('[data-dialog-body]').innerHTML=html;element.addEventListener('cancel',()=>{state.activeReview=null;},{once:true});element.showModal();return element;
  }
  function rowDialog(row){
    const refs=state.section==='inventory'?[{id:row.id,pointer:'',sha256:row.sha256}]:(row.sourceRefs||[]);
    const content='<h2>Original row</h2><pre>'+escape(JSON.stringify(row,null,2))+'</pre><h3>Retained source</h3>'+refs.map((ref,i)=>'<button data-action="source" data-ref="'+i+'">'+escape(ref.id+' '+ref.pointer)+'</button>').join('');
    const element=dialog(content);element._originalRefs=refs;
  }
  async function openSource(ref){
    const report=state.report,session=state.session,generation=state.generation;
    const element=root.querySelector('[data-dialog]');element.querySelector('[data-dialog-body]').innerHTML='<p>Reading the exact retained source…</p>';
    try{const source=await controller.source({sourceSha256:report.source.sha256,ref},{});if(!alive(generation,session)||!element.isConnected||!element.open)return;element.querySelector('[data-dialog-body]').innerHTML='<h2>'+escape(ref.id+' '+ref.pointer)+'</h2><pre>'+escape(typeof source==='string'?source:JSON.stringify(source,null,2))+'</pre>';}
    catch(error){if(alive(generation,session)&&element.isConnected)element.querySelector('[data-dialog-body]').textContent=error.message||String(error);}
  }
  function reviewDialog(row){
    state.activeReview=row.id;
    const key=state.report.sha256+'\n'+row.id,draft=state.draft.reviews[key]??{decision:'ACKNOWLEDGED',reason:'',evidenceIds:''};
    dialog('<h2>Review original exception</h2><pre>'+escape(JSON.stringify(row,null,2))+'</pre><form data-form="review" data-exception="'+escape(row.id)+'" data-draft-key="'+escape(key)+'"><label>Decision<select name="decision">'+['ACKNOWLEDGED','RESOLVED_WITH_SOURCE','EXCLUDED_FROM_SELECTED_SCOPE'].map(v=>'<option '+(draft.decision===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label>Reason<textarea name="reason" required rows="4">'+escape(draft.reason)+'</textarea></label><label>Supporting retained source IDs, one per line<textarea name="evidenceIds" rows="3">'+escape(draft.evidenceIds)+'</textarea></label><button type="submit" '+(state.busy?'disabled':'')+'>Save against this original report</button></form>');
  }
  function click(event){
    const button=event.target.closest('button[data-action]');if(!button||!root.contains(button))return;
    const action=button.dataset.action;
    if(action==='choose-package'){root.querySelector('[data-package]').click();return;}
    if(action==='close-dialog'){state.activeReview=null;root.querySelector('[data-dialog]').close();return;}
    if(action==='source'){state.activeReview=null;const dialog=root.querySelector('[data-dialog]');void openSource(dialog._originalRefs[Number(button.dataset.ref)]);return;}
    if(state.busy)return;
    if(action==='section'){state.section=button.dataset.section;state.filter='';state.page=0;render();return;}
    if(action==='previous'){state.page--;render();return;}
    if(action==='next'){state.page++;render();return;}
    if(action==='detail'){state.activeReview=null;rowDialog(rows()[Number(button.dataset.index)]);return;}
    if(action==='review'){reviewDialog(rows()[Number(button.dataset.index)]);return;}
    if(action==='download'){
      const report=state.report,name=button.dataset.name;
      void run('Preparing '+name+'…',async({signal,isCurrent})=>{
        const blob=await controller.file({sourceSha256:report.source.sha256,reportSha256:report.sha256,selection:report.selection,name},{signal});
        if(!(blob instanceof Blob))throw Error('Original file reader did not return the complete file.');
        if(!isCurrent())return;
        const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
        return {message:'Downloaded '+name+' from the selected original report.'};
      });
    }
  }
  function captureDraft(target){
    const form=target.closest('form[data-form]');if(!form||!root.contains(form))return;
    const data=new FormData(form);
    if(form.dataset.form==='selection'){
      state.draft.selection={from:String(data.get('from')||''),through:String(data.get('through')||''),accounts:String(data.get('accounts')||''),includeUndated:data.get('includeUndated')==='on'};draftChanged();
    }else if(form.dataset.form==='review'){
      state.draft.reviews[form.dataset.draftKey]={decision:String(data.get('decision')||'ACKNOWLEDGED'),reason:String(data.get('reason')||''),evidenceIds:String(data.get('evidenceIds')||'')};draftChanged();
    }
  }
  function input(event){captureDraft(event.target);if(event.target.matches('[data-filter]')){const start=event.target.selectionStart;state.filter=event.target.value;state.page=0;render();const target=root.querySelector('[data-filter]');target.focus();target.setSelectionRange(start,start);}}
  function change(event){
    captureDraft(event.target);
    if(event.target.matches('[data-page-size]')){state.pageSize=Number(event.target.value);state.page=0;render();}
    if(event.target.matches('[data-package]')&&event.target.files?.[0]){
      const file=event.target.files[0];
      void run('Receiving the complete original source package…',async({signal})=>{
        const result=await controller.receive(file,{signal});const reviews=await refreshReviews(result.report,signal);return {...result,reviews,message:'Complete original source received and the report reproduced.'};
      });
    }
  }
  function submit(event){
    const form=event.target;if(!form.matches('form[data-form]'))return;event.preventDefault();captureDraft(form);void saveDraft();
    if(form.dataset.form==='selection'){
      const selection=captureSelection(form);
      void run('Building the complete source-bound report…',async({signal})=>{
        const report=await controller.build(selection,{signal});const reviews=await refreshReviews(report,signal);return {report,reviews,message:'Complete source-bound report ready.'};
      });
    }else if(form.dataset.form==='review'){
      const data=new FormData(form),report=state.report;
      const request={sourceSha256:report.source.sha256,reportSha256:report.sha256,exceptionId:form.dataset.exception,decision:data.get('decision'),reason:String(data.get('reason')||'').trim(),evidenceIds:String(data.get('evidenceIds')||'').split(/\r?\n/u).map(x=>x.trim()).filter(Boolean)};
      void run('Saving the original exception review…',async({signal})=>{await controller.review(request,{signal});const reviews=await refreshReviews(report,signal);return {reviews,message:'Exception decision saved against the selected original report.'};});
    }
  }
  function clear(){
    void saveDraft();++state.generation;state.abort?.abort();state.abort=null;state.busy=false;state.draft=emptyDraft();state.draftVersion++;state.activeReview=null;state.report=null;state.reviews=[];state.filter='';state.page=0;state.session=controller.sessionKey();state.status='Workspace changed. Build a report from the current original source.';state.selection={from:null,through:null,accounts:[],includeUndated:false};root.querySelector('[data-dialog]')?.close();render();loadDraft();
  }
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',change);root.addEventListener('submit',submit);render();loadDraft();
  return {clear,connect(){if(controller.sessionKey()!==state.session)clear();},refresh(){if(controller.sessionKey()!==state.session)clear();else render();},dispose(){const saved=saveDraft();state.disposed=true;++state.generation;state.abort?.abort();root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',change);root.removeEventListener('submit',submit);root.querySelector('[data-dialog]')?.close();root.replaceChildren();return saved;}};
}
