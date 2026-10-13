/* Original-operator scenario desk. Uses the existing queue and file tickets. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=new Intl.NumberFormat(undefined,{maximumSignificantDigits:6});
const number=value=>typeof value==='number'&&Number.isFinite(value)?fmt.format(value):'—';
const short=value=>String(value||'').length>18?String(value).slice(0,12)+'…'+String(value).slice(-5):String(value||'—');
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const money=cents=>Number.isSafeInteger(cents)&&cents>=0?Math.floor(cents/100)+'.'+String(cents%100).padStart(2,'0'):'';
const objectiveKey=o=>String(o.spatial_unit_id??o.watershed_id)+'\u0000'+o.metric;
function readMoney(value,label){
  const text=String(value).trim();if(!text)return null;
  if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error(label+' needs a nonnegative amount with at most two decimal places.');
  const [whole,fraction='']=text.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(label+' is larger than the supported editable amount.');
  return Number(cents);
}
function stored(key,fallback){try{return JSON.parse(sessionStorage.getItem(key))??fallback;}catch{return fallback;}}
function remember(key,value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Current-tab state remains usable. */}}
function operationId(){if(globalThis.crypto?.randomUUID)return 'eco13-'+crypto.randomUUID();const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return 'eco13-'+[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');}
function errorMessage(error){return String(error?.message||error||'The request could not be completed.');}
function ticketURL(ticket){
  if(!ticket?.url)return null;
  const value=new URL(ticket.url,location.origin);
  if(value.origin!==location.origin||!/^\/api\/file\/[A-Za-z0-9_-]+$/.test(value.pathname))return null;
  value.searchParams.set('download','1');return value.pathname+value.search;
}
export function attachEco13(host){
  let node=null,workspace='',catalog=null,view=null,recordId='',kind='outcomes',offset=0,limit=100,total=0,nextOffset=null;
  let filter={scenario_id:'',metric:'',q:''},busy=0,recordToken=0,catalogToken=0,rowToken=0,debounce=null;
  let rowAbort=null,recordAbort=null,catalogAbort=null,recordLoadingId='',dirty=false,lastRows=[],issue='',uploadBusy=false;
  let economicState=null,economicBusy=false,economicToken=0,economicAbort=null,economicError='';
  const drafts=new Map(),pending=new Map(),taskMarks=new Map(),watched=new Map();
  const state=()=>host.getState();
  const activeWorkspace=()=>String(state()?.workspace_key||'');
  const slot=name=>node?.querySelector('[data-slot="'+name+'"]');
  const currentTasks=()=>Array.isArray(state()?.tasks)?state().tasks.filter(t=>t.workspace===workspace&&String(t.action||'').startsWith('eco13.')):[];
  function setIssue(message){issue=message||'';const target=slot('error');if(!target)return;target.hidden=!issue;target.textContent=issue;}
  function announce(message){const target=slot('notice');if(target)target.textContent=message;host.toast?.(message);}
  function setBusy(delta){busy=Math.max(0,busy+delta);if(node)for(const button of node.querySelectorAll('[data-queue]'))button.disabled=busy>0||uploadBusy;}
  function keepSelection(){remember('eco13:selected:'+workspace,recordId);}
  function captureDraft(){
    const form=node?.querySelector('[data-form="planning"]');if(!form||!view||!dirty)return;
    const costs={};for(const input of form.querySelectorAll('[data-cost-id]'))costs[input.dataset.costId]=input.value;
    drafts.set(recordId,{title:form.elements.title.value,budget:form.elements.budget.value,costs,
      objectives:[...form.querySelectorAll('[data-objective]:checked')].map(input=>objectiveKey(view.objectives[Number(input.dataset.objective)]))});
    remember('eco13:draft:'+workspace+':'+recordId,drafts.get(recordId));
  }
  function frame(){
    node.innerHTML='<div class="eco13-desk"><header class="eco13-head"><div><p class="eco13-eyebrow">Saved experiments and planning editions</p><h1>Scenario workbench</h1><p>Receive completed model results, compare explicit costs and outcomes, and transfer an editable edition.</p></div><div class="eco13-actions"><button type="button" data-action="eco13-refresh">Refresh</button><button type="button" data-action="eco13-import">Receive archive</button><input class="eco13-file-input" type="file" accept=".zip,application/zip" data-upload aria-label="Choose an exported comparison archive"></div></header><p class="eco13-notice" data-slot="notice" aria-live="polite"></p><p class="eco13-error" data-slot="error" role="alert" hidden></p><div class="eco13-layout"><aside class="eco13-sidebar"><section class="eco13-panel"><h2>Receive an original experiment</h2><div data-slot="receive"></div></section><section class="eco13-panel"><h2>Saved editions</h2><div data-slot="records"></div></section><section class="eco13-panel"><h2>Comparison reviews</h2><div data-slot="comparison-reviews"></div></section><section class="eco13-panel"><h2>Workspace jobs</h2><div data-slot="tasks"></div></section></aside><div class="eco13-main" data-slot="main"><section class="eco13-panel"><h2>Open a saved comparison</h2><p>Choose an edition or receive an experiment from this workspace. Original model work continues in the experiment queue.</p></section></div></div></div>';
  }
  function renderCatalog(){
    if(!node||!catalog)return;
    const list=(catalog.records||[]).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    slot('records').innerHTML=list.length?'<ul class="eco13-record-list">'+list.map(r=>'<li><button type="button" data-action="eco13-open" data-id="'+esc(r.id)+'"'+(r.id===recordId?' aria-current="true"':'')+'><strong>'+esc(r.title||r.id)+'</strong><span>'+esc(r.kind)+' · '+esc(r.status)+' · '+count(r.counts?.paired_records)+' outcomes</span><time>'+esc(r.created_at||'')+'</time></button></li>').join('')+'</ul>':'<p class="eco13-muted">No saved comparisons in this workspace.</p>';
    const retained=catalog.comparison_reviews||[];
    slot('comparison-reviews').innerHTML=retained.length?'<ul class="eco13-record-list">'+retained.map(item=>'<li><strong>'+esc(item.title)+'</strong><span>'+esc(item.disposition)+' · '+count(item.responses)+' responses</span><div class="eco13-actions"><button type="button" data-action="review-open" data-id="'+esc(item.review_id)+'">Open customer review</button><button type="button" data-action="eco13-review-receive" data-capture-id="'+esc(item.capture_id)+'" data-queue>Reopen editable comparison</button></div></li>').join('')+'</ul>':'<p class="eco13-muted">Capture a saved comparison below to retain its customer review and revision history.</p>';
    const issues=catalog.issues||[];
    if(issues.length)slot('records').innerHTML+='<details class="eco13-source"><summary>'+issues.length+' saved '+(issues.length===1?'record needs':'records need')+' attention</summary><ul>'+issues.map(x=>'<li>'+esc(typeof x==='string'?x:x.message||x.error||JSON.stringify(x))+'</li>').join('')+'</ul></details>';
    if(!slot('receive').querySelector('form')){
      const project=workspace.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,70)||'ecosystem-sciences';
      slot('receive').innerHTML='<form data-form="receive"><label>Saved experiment<select name="experiment_id" required><option value="">Select an experiment</option></select></label><label>Comparison title<input name="title" maxlength="180" required placeholder="Planning comparison"></label><details><summary>Project and edition details</summary><label>Project code<input name="project_id" maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{0,79}" value="'+esc(project)+'" required></label><label>Edition code<input name="setup_id" maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{0,79}" value="comparison-'+Date.now()+'" required></label><label>Currency<input name="currency" value="USD" maxlength="3" pattern="[A-Z]{3}" required></label></details><p class="eco13-muted">Existing results and original case states enter a new comparison. Costs can be added in its planning form.</p><button type="submit" data-queue>Receive experiment</button></form>';
    }
    const select=slot('receive').querySelector('[name="experiment_id"]'),selected=select.value;
    select.innerHTML='<option value="">Select an experiment</option>'+(catalog.experiments||[]).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.title||short(e.id))+' · '+esc(e.state||'saved')+'</option>').join('');
    if([...select.options].some(option=>option.value===selected))select.value=selected;
    const submit=slot('receive').querySelector('[type="submit"]');submit.disabled=busy>0||!(catalog.experiments||[]).length;
    renderTasks();
  }
  function renderTasks(){
    const target=slot('tasks');if(!target)return;const tasks=currentTasks().slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,12);
    target.innerHTML=tasks.length?'<ul class="eco13-job-list">'+tasks.map(t=>'<li><button type="button" data-action="eco13-task" data-id="'+esc(t.id)+'"><strong>'+esc(t._eco13?.title||t.action.replace(/^eco13\./,'').replaceAll('.',' '))+'</strong><span>'+esc(t.state)+'</span></button>'+taskActions(t)+'</li>').join('')+'</ul>':'<p class="eco13-muted">Receiving, report editions and exports use the original job queue.</p>';
    const awaiting=[...pending.values()].filter(body=>body.workspace===workspace);
    if(awaiting.length)target.innerHTML+='<h3>Requests awaiting a queue receipt</h3><p class="eco13-muted">Recover the saved request after a connection interruption. Its original queue identity is retained.</p><ul class="eco13-job-list">'+awaiting.map(body=>'<li><strong>'+esc(body.payload.title||body.action.replace(/^eco13\./,'').replaceAll('.',' '))+'</strong><button type="button" data-action="eco13-recover" data-operation-id="'+esc(body.operation_id)+'" data-queue'+(busy||uploadBusy?' disabled':'')+'>Recover original request</button></li>').join('')+'</ul>';
  }
  async function loadCatalog(){
    if(!node||!workspace)return;const token=++catalogToken;catalogAbort?.abort();catalogAbort=new AbortController();
    try{const result=await host.api(host.endpoint('/api/eco13/catalog'),{signal:catalogAbort.signal});
      if(token!==catalogToken||!node)return;catalog=result;renderCatalog();
      if(recordId&&!view&&recordLoadingId!==recordId)await loadRecord(recordId);
    }catch(error){if(error?.name!=='AbortError'&&token===catalogToken)setIssue(errorMessage(error));}
  }
  function renderDownloads(files){
    const links=(files||[]).map(file=>{const url=ticketURL(file);return url?'<a href="'+esc(url)+'" download="'+esc(file.filename||'')+'">'+esc(file.label||file.filename||'Download')+'</a>':'';}).filter(Boolean);
    return links.length?'<div class="eco13-downloads" aria-label="Saved edition files">'+links.join('')+'</div>':'';
  }
  function renderRanking(ranking){
    if(!ranking)return '<p class="eco13-muted">Choose costs and directed outcomes below to save a cost comparison.</p>';
    const groups=[...new Set((ranking.scenarios||[]).map(s=>s.comparison_group))].sort();
    const labels=new Map((view.scenarios||[]).map(s=>[s.id,s.label||s.id]));
    const reason={cost_not_set:'Cost remains unspecified',over_budget:'Above the selected budget',incomplete_objective_population:'A selected outcome is missing for a parameter set',selected_outcome_unavailable:'A selected outcome has no usable paired result',spatial_support_unavailable:'Paired spatial support is unavailable'};
    const rows=(ranking.scenarios||[]).map(r=>{
      const outcome=r.comparable_alternatives===1?'One complete alternative in this group':r.pareto?'Efficient for the selected costs and outcomes':'Dominated by '+(r.dominated_by||[]).map(id=>labels.get(id)||id).join(', ');
      const bounds=(r.bounds||[]).map(b=>esc(b.metric)+': '+number(b.minimum_benefit)+' to '+number(b.maximum_benefit)+' '+esc(b.unit)).join('<br>');
      return '<tr><th scope="row">'+esc(labels.get(r.scenario_id)||r.scenario_id)+'</th><td>'+esc(money(r.cost_cents))+'</td><td>'+String(groups.indexOf(r.comparison_group)+1)+'</td><td>'+esc(outcome)+'</td><td>'+bounds+'</td></tr>';
    }).join('');
    return '<p>'+esc(ranking.method||'Costs and physical outcomes are compared across the selected parameter population.')+'</p><p class="eco13-muted">'+(ranking.budget_cents==null?'No budget ceiling':esc(money(ranking.budget_cents))+' '+esc(ranking.currency)+' budget ceiling')+' · '+count(ranking.comparison_groups??groups.length)+' compatible groups</p><div class="eco13-scroll"><table><thead><tr><th>Alternative</th><th>Cost ('+esc(ranking.currency)+')</th><th>Coverage group</th><th>Saved comparison</th><th>Improvement across parameter sets</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+((ranking.excluded||[]).length?'<details><summary>Alternatives outside the saved cost screen</summary><ul>'+ranking.excluded.map(r=>'<li><strong>'+esc(labels.get(r.scenario_id)||r.scenario_id)+'</strong>: '+esc(reason[r.reason]||r.reason)+'</li>').join('')+'</ul></details>':'');
  }


  function clearEconomicSources(){
    economicAbort?.abort();economicToken++;economicState=null;economicBusy=false;economicError='';
  }
  function renderEconomicSources(){
    const target=slot('economic-sources');if(!target)return;
    const result=economicState,reports=result?.reports||[],canOpen=typeof host.openExtension==='function';
    let html='<div class="eco13-title-row"><div><h2>Decision reports from these model runs</h2><p>Find saved decision reports that use these original native run pairs. Choose an original reporting zone to continue with its costs, valuation and common-cell coverage.</p></div><button type="button" data-action="eco13-economic-load"'+(economicBusy?' disabled':'')+'>'+(result?'Refresh matching reports':'Find matching reports')+'</button></div>';
    if(economicError)html+='<p class="eco13-error" role="alert">'+esc(economicError)+'</p>';
    if(economicBusy)html+='<p class="eco13-status" role="status">Reading the saved report catalogue…</p>';
    if(!result){target.innerHTML=html;return;}
    if(!result.adapter_available){target.innerHTML=html+'<p>'+esc(result.availability_message||'The decision-report companion is unavailable in this application.')+'</p>';return;}
    html+='<p class="eco13-muted">'+count(result.scanned)+' of '+count(result.total_report_directories)+' saved reports checked · '+count(reports.length)+' matching reports.</p>';
    if(!canOpen)html+='<p class="eco13-error">The installed operator host needs its existing cross-desk navigation update to open these reports.</p>';
    if(!reports.length)html+='<p>'+(result.next_offset!==null?'No matching report in the pages read so far. Continue through the saved catalogue below.':'No saved decision report in this catalogue matches the original run pairs in this comparison.')+'</p>';
    for(const report of reports){
      const alternatives=(report.matched_alternatives||[]),zones=report.zones||[];
      html+='<article class="eco13-economic-report"><h3>'+esc(report.title||report.report_id)+'</h3><p>'+count(alternatives.length)+' original alternatives · '+esc((report.pollutants||[]).join(', '))+' · '+count(report.ready_zones)+' zones with common support</p><div class="eco13-scroll"><table><thead><tr><th>Original reporting zone</th><th>Area (ha)</th><th>Common valid support</th><th>Continue</th></tr></thead><tbody>';
      for(const zone of zones){
        const support=Object.entries(zone.coverage||{}).map(([metric,coverage])=>'<div><strong>'+esc(metric)+'</strong>: '+count(coverage.common_valid_cells)+' cells · '+number(coverage.common_valid_area_ha)+' ha</div>').join('');
        const reasons=(zone.reasons||[]).map(reason=>'<div>'+esc(reason)+'</div>').join('');
        html+='<tr><th scope="row">'+esc(zone.title||zone.zone_id)+'<small>'+esc(zone.scope||'')+'</small></th><td>'+number(zone.area_ha)+'</td><td>'+(support||'—')+reasons+'</td><td><button type="button" data-action="eco13-economic-zone" data-report-id="'+esc(report.report_id)+'" data-zone-id="'+esc(zone.zone_id)+'"'+(canOpen&&zone.common_support_available?'':' disabled')+'>Open decision analysis</button></td></tr>';
      }
      html+='</tbody></table></div><details class="eco13-source"><summary>Original report and model selections</summary><dl><dt>Report</dt><dd><code>'+esc(report.report_id)+'</code></dd><dt>Source SHA256</dt><dd><code>'+esc(report.report_sha256)+'</code></dd><dt>Baseline run</dt><dd><code>'+esc(report.baseline_run_id)+'</code></dd></dl><ul>'+alternatives.map(a=>'<li><strong>'+esc(a.label||a.scenario_id)+'</strong><br>Run <code>'+esc(a.run_id)+'</code><br>Profile <code>'+esc(a.profile_id)+'</code><br>Scenario <code>'+esc(a.scenario_id)+'</code></li>').join('')+'</ul></details></article>';
    }
    if(result.issues?.length)html+='<details class="eco13-source"><summary>'+count(result.issues.length)+' source reports need attention</summary><ul>'+result.issues.map(item=>'<li><code>'+esc(item.report_id)+'</code>: '+esc(item.message)+'</li>').join('')+'</ul></details>';
    const skipped=Object.entries(result.skipped||{});
    if(skipped.length)html+='<details class="eco13-source"><summary>Other source selections</summary><ul>'+skipped.map(([reason,n])=>'<li>'+esc(reason.replaceAll('_',' '))+': '+count(n)+'</li>').join('')+'</ul></details>';
    if(result.next_offset!==null)html+='<button type="button" data-action="eco13-economic-more"'+(economicBusy?' disabled':'')+'>Check next saved reports</button>';
    html+='<p class="eco13-muted">'+esc(result.interpretation||'')+'</p>';target.innerHTML=html;
  }
  async function loadEconomicSources(reset=false){
    if(!node||!view||(!reset&&economicBusy))return;
    const selectedId=recordId,workspaceKey=workspace;
    if(reset)clearEconomicSources();
    if(!reset&&economicState?.next_offset===null)return;
    const token=++economicToken;economicAbort?.abort();economicAbort=new AbortController();economicBusy=true;economicError='';renderEconomicSources();
    const query={record_id:selectedId,offset:reset?0:(economicState?.next_offset||0),limit:25};
    if(query.offset&&economicState?.listing_sha256)query.listing_sha256=economicState.listing_sha256;
    try{
      const result=await host.api(host.endpoint('/api/eco13/economic-sources',query),{signal:economicAbort.signal});
      if(token!==economicToken||!node||recordId!==selectedId||workspace!==workspaceKey)return;
      if(result.record_id!==selectedId)throw new Error('The returned decision sources belong to another comparison. Refresh matching reports.');
      const previous=reset?null:economicState;
      if(previous&&previous.listing_sha256!==result.listing_sha256)throw new Error('The saved report catalogue changed. Refresh matching reports to read its current population.');
      const reports=new Map((previous?.reports||[]).map(report=>[report.report_id,report]));
      for(const report of result.reports||[])reports.set(report.report_id,report);
      const skipped={...(previous?.skipped||{})};for(const [reason,n] of Object.entries(result.skipped||{}))skipped[reason]=(skipped[reason]||0)+n;
      economicState={...result,reports:[...reports.values()].sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''))||String(a.report_id).localeCompare(String(b.report_id))),scanned:(previous?.scanned||0)+(result.scanned||0),issues:[...(previous?.issues||[]),...(result.issues||[])],skipped};
    }catch(error){
      if(error?.name!=='AbortError'&&token===economicToken){
        economicError=errorMessage(error);
        if(error?.status===409||/SOURCE_COLLECTION_CHANGED|catalogue changed|collection changed/i.test(economicError)){economicState=null;economicError+=' Refresh matching reports to continue.';}
      }
    }finally{if(token===economicToken){economicBusy=false;renderEconomicSources();}}
  }


  function reviewDraftKey(ws=workspace,id=recordId){return 'eco13:review-draft:'+ws+':'+id;}
  function captureReviewDraft(form=node?.querySelector('[data-form="comparison-review"]')){
    if(!form)return null;
    const value={title:form.elements.title.value,purpose:form.elements.purpose.value,notes:form.elements.notes.value};
    remember(reviewDraftKey(form.dataset.workspace,form.dataset.recordId),value);return value;
  }
  function renderReviewSection(){
    const target=slot('review-selection');if(!target||!view)return;
    const r=view.record,draft=stored(reviewDraftKey(),null),retained=view.customer_reviews||[];
    target.innerHTML='<h2>Review this saved edition</h2><p>Create an ordinary Customer review containing this exact report, saved costs and objectives, source context and complete editable comparison. Unfinished scientific results stay visible. Unsaved planning changes are not included.</p>'+
      (retained.length?'<h3>Retained reviews of this exact edition</h3><ul class="eco13-record-list">'+retained.map(item=>'<li><strong>'+esc(item.title)+'</strong><span>'+esc(item.disposition)+' · '+count(item.responses)+' responses</span><div class="eco13-actions"><button type="button" data-action="review-open" data-id="'+esc(item.review_id)+'">Open customer review</button><button type="button" data-action="eco13-review-receive" data-capture-id="'+esc(item.capture_id)+'" data-queue>Reopen editable comparison</button></div></li>').join('')+'</ul>':'')+
      '<form data-form="comparison-review" data-workspace="'+esc(workspace)+'" data-record-id="'+esc(recordId)+'"><label>Review title<input name="title" maxlength="300" value="'+esc(draft?.title??r.title)+'" required></label><label>Decision purpose<textarea name="purpose" maxlength="20000" rows="4" required placeholder="What decision should the reviewer make from this saved comparison?">'+esc(draft?.purpose??'')+'</textarea></label><label>Review notes<textarea name="notes" maxlength="20000" rows="3" placeholder="Retain any context, uncertainty or question for the reviewer.">'+esc(draft?.notes??'')+'</textarea></label><p class="eco13-muted">The review includes the complete report, costs and budget choices, actual native identities and paired support, all unfinished cases, and the editable archive. Use Customer reviews → Engineering handbacks to address returned requests with an actual revised comparison review.</p><div class="eco13-actions"><button type="submit" data-queue>Create customer review</button><span class="eco13-muted" data-slot="review-draft-status"></span></div></form>';
  }
  async function submitReview(form){
    if(!form.reportValidity())return;
    if(!view||form.dataset.workspace!==workspace||form.dataset.recordId!==recordId||activeWorkspace()!==workspace)
      throw new Error('The selected workspace or comparison changed. Reopen the intended saved edition.');
    const draft=captureReviewDraft(form),sourceWorkspace=workspace,sourceId=recordId;
    const payload={record_id:sourceId,title:draft.title.trim(),purpose:draft.purpose.trim(),notes:draft.notes.trim()?[draft.notes.trim()]:[]};
    if(!payload.title||!payload.purpose)throw new Error('State the review title and decision purpose.');
    await submitAction('eco13.review.create',payload);
    if(workspace===sourceWorkspace&&recordId===sourceId){const label=slot('review-draft-status');if(label)label.textContent='Review queued; this draft remains available until its saved review is returned.';}
  }

  function renderView(){
    if(!node||!view)return;const r=view.record,c=r.counts||{},scenarios=view.scenarios||[],objectives=view.objectives||[];
    const draft=drafts.get(r.id),chosen=new Set(draft?.objectives||(view.settings?.objectives||[]).map(objectiveKey));
    const costInputs=scenarios.map(s=>{
      const value=draft?.costs?.[s.id]??money(s.cost_cents);
      return '<tr><th scope="row"><label for="eco13-cost-'+esc(s.id)+'">'+esc(s.label||s.id)+'</label></th><td><input id="eco13-cost-'+esc(s.id)+'" data-cost-id="'+esc(s.id)+'" inputmode="decimal" value="'+esc(value)+'" placeholder="Unspecified" aria-label="Cost for '+esc(s.label||s.id)+'"></td></tr>';
    }).join('');
    const checkboxes=objectives.map((o,i)=>'<label class="eco13-check"><input type="checkbox" data-objective="'+i+'"'+(chosen.has(objectiveKey(o))?' checked':'')+'><span><strong>'+esc(o.label||o.metric)+'</strong><small>'+esc(o.unit)+' · grid <span title="'+esc(o.spatial_unit_id??o.watershed_id)+'">'+esc(short(o.spatial_unit_id??o.watershed_id))+'</span></small></span></label>').join('');
    const origin=view.original_experiment;
    const originalButton=origin?.available?'<button type="button" data-action="experiment-show" data-id="'+esc(origin.id)+'">Open original experiment</button>':'';
    const economic=r.economic_report||view.economic_report;
    const economicButton=economic?.report_id&&typeof host.openExtension==='function'?'<button type="button" data-action="eco13-economic">Open decision analysis</button>':'';
    slot('main').innerHTML='<section class="eco13-panel eco13-record-head"><div class="eco13-title-row"><div><p class="eco13-eyebrow">'+esc(r.kind)+' edition · '+esc(r.status)+'</p><h2>'+esc(r.title||r.id)+'</h2><p class="eco13-muted">'+esc(r.created_at||'')+'</p></div><div class="eco13-actions">'+originalButton+economicButton+'<button type="button" data-action="eco13-export" data-queue>Export editable comparison</button></div></div><dl class="eco13-counts"><div><dt>Original cases</dt><dd>'+count(c.original_cases)+'</dd></div><div><dt>Native runs planned</dt><dd>'+count(c.planned_native_runs)+'</dd></div><div><dt>Alternative outcomes</dt><dd>'+count(c.paired_records)+'</dd></div><div><dt>Parameter outcomes</dt><dd>'+count(c.parameter_records)+'</dd></div><div><dt>Unfinished results</dt><dd>'+count(c.incomplete_records)+'</dd></div></dl><p>Selected models: '+esc((r.selected_models||[]).map(v=>String(v).toUpperCase()).join(', ')||'See original result')+' · Currency: '+esc(r.currency)+'</p>'+renderDownloads(view._downloads)+'<details class="eco13-source"><summary>Original source and edition identity</summary><dl><dt>Comparison</dt><dd><code>'+esc(r.id)+'</code></dd><dt>Original experiment</dt><dd><code>'+esc(r.original_experiment_id||'—')+'</code></dd><dt>Original workspace</dt><dd><code>'+esc(r.source_workspace_id||'—')+'</code></dd><dt>Source edition</dt><dd><code>'+esc(r.source_record_id||'—')+'</code></dd><dt>Retained plan</dt><dd><code>'+esc(r.plan_sha256||'—')+'</code></dd></dl></details></section><section class="eco13-panel"><h2>Native outcomes</h2><div class="eco13-tabs" role="tablist" aria-label="Result types">'+[['outcomes','Land-cover alternatives',c.paired_records],['parameters','Parameter sensitivity',c.parameter_records],['incomplete','Unfinished cases',c.incomplete_records]].map(([id,label,n])=>'<button type="button" role="tab" id="eco13-tab-'+id+'" data-action="eco13-kind" data-kind="'+id+'" aria-controls="eco13-outcome-panel" aria-selected="'+(kind===id)+'" tabindex="'+(kind===id?'0':'-1')+'">'+esc(label)+' <span>'+count(n)+'</span></button>').join('')+'</div><div class="eco13-filters"><label>Alternative<select data-filter="scenario_id"><option value="">All alternatives</option>'+scenarios.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.label||s.id)+'</option>').join('')+'</select></label><label>Outcome<select data-filter="metric"><option value="">All outcomes</option>'+[...new Set(objectives.map(o=>o.metric))].map(metric=>'<option value="'+esc(metric)+'">'+esc(metric.replaceAll('_',' '))+'</option>').join('')+'</select></label><label class="eco13-search">Search results<input type="search" data-filter="q" placeholder="Scenario, parameter or result" value="'+esc(filter.q)+'"></label><label>Rows<select data-page-size><option value="50">50</option><option value="100">100</option><option value="250">250</option></select></label><button type="button" data-action="eco13-clear-filters">Clear filters</button></div><div id="eco13-outcome-panel" role="tabpanel" aria-labelledby="eco13-tab-'+kind+'"><p class="eco13-status" data-slot="row-status" aria-live="polite"></p><div class="eco13-scroll" data-slot="rows" aria-label="Original result table" tabindex="0"></div></div><div class="eco13-pager"><button type="button" data-action="eco13-page" data-step="first">First</button><button type="button" data-action="eco13-page" data-step="previous">Previous</button><span data-slot="page"></span><button type="button" data-action="eco13-page" data-step="next">Next</button><button type="button" data-action="eco13-page" data-step="last">Last</button></div><p class="eco13-muted">Each outcome retains its native units and paired grid-cell coverage. Positive improvement means less exported nutrient or sediment mass. Parameter effects remain separate from land-cover alternatives.</p></section><section class="eco13-panel"><h2>Saved cost comparison</h2>'+renderRanking(view.ranking)+'</section><section class="eco13-panel"><h2>Save a planning edition</h2><p>Set intervention estimates and the outcomes that matter to this decision. Each save creates an independent edition of these retained model results.</p><form data-form="planning"><label>New edition title<input name="title" maxlength="180" value="'+esc(draft?.title||r.title+' — planning update')+'" required></label><div class="eco13-planning-grid"><div><h3>Intervention costs ('+esc(r.currency)+')</h3><div class="eco13-scroll"><table class="eco13-cost-inputs"><thead><tr><th>Alternative</th><th>Cost</th></tr></thead><tbody>'+costInputs+'</tbody></table></div><p class="eco13-muted">Leave a field empty to keep its current value. An unspecified cost remains unknown. Enter zero only for an intended zero-cost intervention.</p></div><div><h3>Selected outcomes</h3><div class="eco13-objectives">'+(checkboxes||'<p class="eco13-muted">Complete paired outcomes will become selectable when they are received.</p>')+'</div><label>Budget ceiling ('+esc(r.currency)+')<input name="budget" inputmode="decimal" value="'+esc(draft?.budget??money(view.settings?.budget_cents))+'" placeholder="No ceiling"'+(chosen.size?'':' disabled')+'></label><p class="eco13-muted">The cost screen compares every selected parameter set within compatible grid-cell and baseline groups. Leave the budget empty for no ceiling.</p></div></div><div class="eco13-actions"><button type="submit" data-queue>Save new edition</button><button type="button" data-action="eco13-reset-planning" data-queue>Restore original planning choices</button><span class="eco13-muted" data-slot="draft-status">'+(dirty?'Unsaved planning changes':'')+'</span></div></form></section>';
    const reviewSection=document.createElement('section');reviewSection.className='eco13-panel';reviewSection.dataset.slot='review-selection';
    slot('main').append(reviewSection);renderReviewSection();
    const economics=document.createElement('section');economics.className='eco13-panel';economics.dataset.slot='economic-sources';
    slot('main').insertBefore(economics,node.querySelector('[data-form="planning"]').closest('section'));renderEconomicSources();
    const scenario=node.querySelector('[data-filter="scenario_id"]'),metric=node.querySelector('[data-filter="metric"]');
    scenario.value=filter.scenario_id;metric.value=filter.metric;node.querySelector('[data-page-size]').value=String(limit);
    setBusy(0);
  }
  async function loadRecord(id,{retainResults=false}={}){
    if(!node||!workspace||!id)return;
    const selection=retainResults&&id===recordId&&view?{kind,offset,limit,filter:{...filter}}:null;
    clearTimeout(debounce);captureDraft();recordId=id;keepSelection();
    if(!drafts.has(id)){const saved=stored('eco13:draft:'+workspace+':'+id,null);if(saved&&Array.isArray(saved.objectives)&&saved.costs)drafts.set(id,saved);}
    dirty=drafts.has(id);view=null;recordLoadingId=id;clearEconomicSources();
    const token=++recordToken;recordAbort?.abort();recordAbort=new AbortController();rowAbort?.abort();rowToken++;
    slot('main').setAttribute('aria-busy','true');slot('main').inert=true;setIssue('');
    try{const result=await host.api(host.endpoint('/api/eco13/record',{record_id:id}),{signal:recordAbort.signal});
      if(token!==recordToken||!node)return;
      if(result.record?.id!==id||result.workspace_key!==workspace)throw new Error('The returned edition belongs to another selection. Refresh this workspace.');
      view=result;
      if(selection){kind=selection.kind;offset=selection.offset;limit=selection.limit;filter=selection.filter;}
      else{offset=0;filter={scenario_id:'',metric:'',q:''};kind='outcomes';}
      renderView();renderCatalog();await loadRows();
    }catch(error){if(error?.name!=='AbortError'&&token===recordToken){setIssue(errorMessage(error));if(node)slot('main').innerHTML='<section class="eco13-panel"><h2>Comparison could not be opened</h2><p>Select another saved edition or refresh this workspace.</p></section>';}}
    finally{if(token===recordToken&&node){recordLoadingId='';slot('main').removeAttribute('aria-busy');slot('main').inert=false;}}
  }
  function sourceDetails(row){
    const fields=[['Original case',row.original_case_id],['Case / parameter',row.case_id],['Model',row.model],['Original run',row.original_run_id||row.original_scenario_run_id||row.scenario_job],['Baseline run',row.original_baseline_run_id||row.baseline_job],['Reporting grid',row.grid_id||row.spatial_unit_id||row.watershed_id],['Paired cells',row.paired_cells],['Reporting cells',row.reporting_cells],['Spatial support',row.support_sha256],['Original state',row.native_status]];
    const summary=typeof row.paired_cells==='number'?number(row.paired_cells)+' paired cells'+(typeof row.coverage_fraction==='number'?' · '+number(row.coverage_fraction*100)+'% grid':''):'Original source';
    return '<details class="eco13-row-source"><summary>'+esc(summary)+'</summary><dl>'+fields.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl></details>';
  }
  function renderRows(response){
    if(!node)return;lastRows=response.rows||[];total=response.total;offset=response.offset;nextOffset=response.next_offset;
    const incomplete=kind==='incomplete';
    const headings=incomplete?['Alternative','Parameter set','Model','Original state','Source']:['Alternative','Parameter set','Outcome','Unit','Baseline','Alternative','Change','Change %','Improvement','Source'];
    let rows=lastRows.map(row=>{
      const first='<th scope="row">'+esc(row.scenario_label||row.scenario_title||short(row.scenario_id))+'</th><td>'+esc(row.case_label||row.profile_title||short(row.case_id))+'</td>';
      if(incomplete){let reason=row.reason||row.status||row.native_status||'Awaiting complete paired results';if(typeof reason==='object')reason=JSON.stringify(reason);return '<tr>'+first+'<td>'+esc(String(row.model||'').toUpperCase())+'</td><td>'+esc(String(reason).replace(/[_-]/g,' '))+(row.native_model_retained?'<small>Completed model files retained</small>':'')+'</td><td>'+sourceDetails(row)+'</td></tr>';}
      return '<tr>'+first+'<td>'+esc(String(row.metric||'').replaceAll('_',' '))+'</td><td>'+esc(row.unit)+'</td>'+['baseline','scenario','change','percent_change','benefit'].map(key=>'<td class="eco13-number">'+number(row[key])+'</td>').join('')+'<td>'+sourceDetails(row)+'</td></tr>';
    }).join('');
    if(!rows)rows='<tr><td colspan="'+headings.length+'" class="eco13-muted">No '+(incomplete?'unfinished records':'paired outcomes')+' match the current filters.</td></tr>';
    slot('rows').innerHTML='<table><thead><tr>'+headings.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>';
    slot('row-status').textContent=total?'Showing '+count(offset+1)+'–'+count(offset+lastRows.length)+' of '+count(total)+' records':'0 matching records';
    slot('page').textContent='Page '+(Math.floor(offset/limit)+1)+' of '+Math.max(1,Math.ceil(total/limit));
    for(const button of node.querySelectorAll('[data-action="eco13-page"]'))button.disabled=['first','previous'].includes(button.dataset.step)?offset===0:nextOffset===null||nextOffset===undefined;
  }
  function clearRows(message){
    lastRows=[];total=0;nextOffset=null;
    const rows=slot('rows');if(rows){rows.replaceChildren();rows.setAttribute('aria-busy','true');}
    const status=slot('row-status');if(status)status.textContent=message;
    const page=slot('page');if(page)page.textContent='Awaiting selected results';
    if(node)for(const button of node.querySelectorAll('[data-action="eco13-page"]'))button.disabled=true;
  }
  async function loadRows(){
    if(!view||!node)return;clearTimeout(debounce);
    const token=++rowToken,sourceWorkspace=workspace;rowAbort?.abort();rowAbort=new AbortController();
    const query={record_id:recordId,kind,offset,limit};for(const [key,value]of Object.entries(filter))if(value)query[key]=value;
    clearRows('Loading retained results…');
    try{
      const response=await host.api(host.endpoint('/api/eco13/rows',query),{signal:rowAbort.signal});
      if(token!==rowToken||!node||workspace!==sourceWorkspace)return;
      if(response.record_id!==query.record_id||response.kind!==query.kind||response.offset!==query.offset||response.limit!==query.limit)
        throw new Error('The returned results belong to another selection. Retry the selected results.');
      renderRows(response);
    }catch(error){
      if(error?.name!=='AbortError'&&token===rowToken&&node){
        slot('row-status').textContent='Selected results could not be loaded.';
        slot('rows').innerHTML='<p class="eco13-muted">'+esc(errorMessage(error))+'</p><button type="button" data-action="eco13-rows-retry">Retry selected results</button>';
        slot('page').textContent='Selected results unavailable';
      }
    }finally{if(token===rowToken&&node)slot('rows')?.removeAttribute('aria-busy');}
  }

  function savePending(key,body){
    pending.set(key,body);remember('eco13:pending:'+body.workspace,[...pending.entries()].filter(([,v])=>v.workspace===body.workspace));renderTasks();
  }
  function forgetPending(key,sourceWorkspace){
    pending.delete(key);
    const values=sourceWorkspace===workspace?[...pending.entries()].filter(([,v])=>v.workspace===sourceWorkspace):stored('eco13:pending:'+sourceWorkspace,[]).filter(([k])=>k!==key);
    remember('eco13:pending:'+sourceWorkspace,values);if(sourceWorkspace===workspace)renderTasks();
  }
  function watchTask(sourceWorkspace,id,sourceRecord){
    const values=new Map(stored('eco13:watched:'+sourceWorkspace,[]));values.set(id,sourceRecord||null);
    remember('eco13:watched:'+sourceWorkspace,[...values.entries()].slice(-30));if(sourceWorkspace===workspace)watched.set(id,sourceRecord||null);
  }
  async function submitAction(action,payload){
    if(!workspace||activeWorkspace()!==workspace)throw new Error('Reopen the intended original workspace before submitting this comparison operation.');
    const sourceWorkspace=workspace,key=JSON.stringify({workspace:sourceWorkspace,action,payload});
    const body=pending.get(key)||{workspace:sourceWorkspace,action,payload,operation_id:operationId()};
    savePending(key,body);setBusy(1);setIssue('');
    try{
      const task=await host.api('/api/actions',{method:'POST',body});
      if(!task?.id)throw new Error('The queue response did not include its job ID. Retry this same request to recover its receipt.');
      forgetPending(key,sourceWorkspace);watchTask(sourceWorkspace,task.id,payload.record_id);
      if(sourceWorkspace===workspace){
        announce('Queued in the original workspace: '+action.replace(/^eco13\./,'').replaceAll('.',' ')+'.');
        try{await host.showTask(task.id);}catch(error){setIssue('The job was queued. Its detail view could not be opened: '+errorMessage(error));}
        try{await host.refreshState({force:true});}catch(error){setIssue('The job was queued. Refresh its current state: '+errorMessage(error));}
      }
      return task;
    }catch(error){if(sourceWorkspace===workspace)setIssue(errorMessage(error)+' The same unchanged request keeps its queue identity when retried.');throw error;}
    finally{setBusy(-1);}
  }
  async function submitReceive(form){
    if(!form.reportValidity())return;
    const values=new FormData(form);
    await submitAction('eco13.experiment.receive',{experiment_id:String(values.get('experiment_id')),title:String(values.get('title')).trim(),project_id:String(values.get('project_id')).trim(),setup_id:String(values.get('setup_id')).trim(),currency:String(values.get('currency')).trim().toUpperCase(),page_size:250});
  }
  async function submitPlanning(form){
    if(!view||!form.reportValidity())return;captureDraft();
    const sourceId=recordId,costs={},scenarios=new Map((view.scenarios||[]).map(s=>[s.id,s]));
    for(const input of form.querySelectorAll('[data-cost-id]')){
      const scenario=scenarios.get(input.dataset.costId);if(!scenario)throw new Error('The current alternative list changed. Reopen this comparison.');
      const entered=readMoney(input.value,'Cost for '+(scenario.label||scenario.id));
      const value=entered===null?scenario.cost_cents:entered;if(value!==null&&value!==undefined)costs[scenario.id]=value;
    }
    const objectives=[...form.querySelectorAll('[data-objective]:checked')].map(input=>{
      const original=view.objectives[Number(input.dataset.objective)];return {spatial_unit_id:original.spatial_unit_id??original.watershed_id,metric:original.metric};
    });
    const budget=objectives.length?readMoney(form.elements.budget.value,'Budget ceiling'):null;
    const payload={record_id:sourceId,title:form.elements.title.value.trim(),reset_report_options:true,scenario_costs:costs};
    if(objectives.length)payload.objectives=objectives;
    if(budget===null)payload.clear_budget=true;else payload.budget_cents=budget;
    const sourceWorkspace=workspace,submittedDraft=JSON.stringify(drafts.get(sourceId));dirty=false;
    try{await submitAction('eco13.report.save',payload);}
    catch(error){if(recordId===sourceId&&workspace===sourceWorkspace)dirty=true;throw error;}
    if(JSON.stringify(drafts.get(sourceId))===submittedDraft&&recordId===sourceId&&workspace===sourceWorkspace){const status=slot('draft-status');if(status)status.textContent='Planning edition queued; draft retained until the saved edition is returned';}
  }
  async function receiveUpload(file){
    if(!file)return;const maximum=state()?.limits?.upload_bytes;
    if(Number.isFinite(maximum)&&file.size>maximum)throw new Error('This archive exceeds the workspace upload limit of '+count(maximum)+' bytes.');
    const sourceWorkspace=workspace;uploadBusy=true;setBusy(0);setIssue('');announce('Receiving '+file.name+'…');
    try{
      const uploaded=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
      if(sourceWorkspace!==workspace)throw new Error('The workspace changed during upload. Return to the original workspace before receiving this archive.');
      if(!uploaded?.id)throw new Error('The upload did not return its verified file ID.');
      await submitAction('eco13.archive.receive',{upload_id:uploaded.id,title:file.name.replace(/\.zip$/i,'')});
    }finally{uploadBusy=false;setBusy(0);const input=node?.querySelector('[data-upload]');if(input)input.value='';}
  }
  function taskActions(task){
    if(!String(task?.action||'').startsWith('eco13.'))return '';
    const id=task._eco13?.record_id||task.result?.record_id;if(!id)return '';
    const message=task._eco13?.archive_status==='export_from_saved_record'&&typeof task._eco13.archive_message==='string'?task._eco13.archive_message:'';
    const reviewId=task._review?.review_id||task._eco13?.review_id||task.result?.review_id;
    return (message?'<p class="eco13-muted">'+esc(message)+'</p>':'')+'<button type="button" data-action="eco13-open" data-id="'+esc(id)+'">Open comparison</button>'+(reviewId?'<button type="button" data-action="review-open" data-id="'+esc(reviewId)+'">Open customer review</button>':'');
  }
  async function dispatch(button){
    const action=button?.dataset?.action;if(!action?.startsWith('eco13-'))return false;
    if(action==='eco13-open'){
      host.closeDetail?.();
      const id=button.dataset.id;
      if(!node){recordId=id;remember('eco13:selected:'+activeWorkspace(),id);await host.navigate('eco13');}
      else await loadRecord(id);
    }else if(action==='eco13-recover'){
      const body=[...pending.values()].find(value=>value.workspace===workspace&&value.operation_id===button.dataset.operationId);
      if(body)await submitAction(body.action,body.payload);
    }else if(action==='eco13-refresh'){
      const selectedId=recordId,hadView=Boolean(view);await loadCatalog();
      if(hadView&&view&&recordId===selectedId)await loadRecord(selectedId,{retainResults:true});
    }
    else if(action==='eco13-rows-retry')await loadRows();
    else if(action==='eco13-import')node?.querySelector('[data-upload]')?.click();
    else if(action==='eco13-task')await host.showTask(button.dataset.id);
    else if(action==='eco13-kind'){
      kind=button.dataset.kind;offset=0;
      for(const tab of node.querySelectorAll('[role="tab"]')){const selected=tab.dataset.kind===kind;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
      node.querySelector('#eco13-outcome-panel').setAttribute('aria-labelledby','eco13-tab-'+kind);await loadRows();
    }else if(action==='eco13-page'){
      const step=button.dataset.step;
      if(step==='first')offset=0;else if(step==='previous')offset=Math.max(0,offset-limit);else if(step==='next')offset=nextOffset??offset;else offset=Math.floor(Math.max(0,total-1)/limit)*limit;
      await loadRows();
    }else if(action==='eco13-clear-filters'){
      filter={scenario_id:'',metric:'',q:''};offset=0;for(const input of node.querySelectorAll('[data-filter]'))input.value='';await loadRows();
    }else if(action==='eco13-export'){if(view)await submitAction('eco13.comparison.export',{record_id:recordId});}
    else if(action==='eco13-reset-planning'){if(view)await submitAction('eco13.report.save',{record_id:recordId,reset_report_options:true,clear_budget:true});}
    else if(action==='eco13-review-receive'){
      const captured=[...(catalog?.comparison_reviews||[]),...(view?.customer_reviews||[])].find(item=>item.capture_id===button.dataset.captureId);
      if(!captured)throw new Error('Refresh the retained review catalogue before reopening this comparison.');
      await submitAction('eco13.review.receive',{review_id:captured.review_id,source_collection_id:captured.source_collection_id});
    }
    else if(action==='eco13-economic-load')await loadEconomicSources(true);
    else if(action==='eco13-economic-more')await loadEconomicSources(false);
    else if(action==='eco13-economic-zone'){
      const report=economicState?.reports?.find(value=>value.report_id===button.dataset.reportId);
      const zone=report?.zones?.find(value=>value.zone_id===button.dataset.zoneId);
      if(!report||!zone?.common_support_available||typeof host.openExtension!=='function')throw new Error('Refresh the saved decision report sources before opening this zone.');
      captureDraft();await host.openExtension('economic-desk','openReport',{report_id:report.report_id,zone_id:zone.zone_id});
    }
    else if(action==='eco13-economic'){
      const report=view?.record?.economic_report||view?.economic_report;
      if(report?.report_id&&typeof host.openExtension==='function')await host.openExtension('economic-desk','openReport',{report_id:report.report_id,zone_id:report.zone_id});
    }
    return true;
  }
  function onClick(event){const button=event.target.closest('[data-action]');if(!button||!node?.contains(button)||!button.dataset.action.startsWith('eco13-'))return;event.preventDefault();event.stopPropagation();dispatch(button).catch(error=>setIssue(errorMessage(error)));}
  function onSubmit(event){const form=event.target.closest('form[data-form]');if(!form||!node?.contains(form))return;event.preventDefault();event.stopPropagation();const work=form.dataset.form==='receive'?submitReceive(form):form.dataset.form==='comparison-review'?submitReview(form):submitPlanning(form);Promise.resolve(work).catch(error=>setIssue(errorMessage(error)));}
  function onInput(event){
    const input=event.target;
    if(input.matches('[data-filter="q"]')){
      filter.q=input.value.trim();offset=0;clearTimeout(debounce);rowAbort?.abort();rowToken++;
      clearRows('Waiting for selected search results…');debounce=setTimeout(()=>loadRows(),300);
    }
    if(input.closest('[data-form="comparison-review"]')){captureReviewDraft(input.closest('form'));const label=slot('review-draft-status');if(label)label.textContent='Review draft retained in this browser';}
    if(input.closest('[data-form="planning"]')){dirty=true;captureDraft();const label=slot('draft-status');if(label)label.textContent='Unsaved planning changes';}
  }
  function onChange(event){
    const input=event.target;
    if(input.matches('[data-upload]')){receiveUpload(input.files?.[0]).catch(error=>setIssue(errorMessage(error)));return;}
    if(input.matches('[data-filter]')&&input.dataset.filter!=='q'){filter[input.dataset.filter]=input.value;offset=0;loadRows();}
    if(input.matches('[data-page-size]')){limit=Number(input.value);offset=0;loadRows();}
    if(input.matches('[data-objective]')){const form=input.closest('form');form.elements.budget.disabled=!form.querySelector('[data-objective]:checked');dirty=true;captureDraft();const label=slot('draft-status');if(label)label.textContent='Unsaved planning changes';}
    if(input.matches('[name="experiment_id"]')){const experiment=(catalog?.experiments||[]).find(e=>e.id===input.value),title=input.form.elements.title;if(experiment&&!title.value)title.value=(experiment.title||'Experiment')+' comparison';}
  }
  function onKeydown(event){
    const tab=event.target.closest('[role="tab"]');if(!tab||!node?.contains(tab))return;
    const tabs=[...node.querySelectorAll('[role="tab"]')],index=tabs.indexOf(tab);let target;
    if(event.key==='ArrowRight')target=tabs[(index+1)%tabs.length];else if(event.key==='ArrowLeft')target=tabs[(index+tabs.length-1)%tabs.length];else if(event.key==='Home')target=tabs[0];else if(event.key==='End')target=tabs[tabs.length-1];else return;
    event.preventDefault();event.stopPropagation();target.focus();target.click();
  }
  function restoreWorkspace(){
    clearTimeout(debounce);captureDraft();clearEconomicSources();workspace=activeWorkspace();catalog=null;view=null;recordLoadingId='';dirty=false;drafts.clear();pending.clear();watched.clear();taskMarks.clear();
    recordId=stored('eco13:selected:'+workspace,'');if(typeof recordId!=='string')recordId='';
    for(const item of stored('eco13:pending:'+workspace,[]))if(Array.isArray(item)&&item[1]?.workspace===workspace)pending.set(item[0],item[1]);
    for(const item of stored('eco13:watched:'+workspace,[]))if(Array.isArray(item))watched.set(item[0],item[1]);
    kind='outcomes';offset=0;filter={scenario_id:'',metric:'',q:''};recordToken++;catalogToken++;rowToken++;rowAbort?.abort();recordAbort?.abort();catalogAbort?.abort();
    frame();if(!workspace){slot('main').innerHTML='<section class="eco13-panel"><h2>Open a workspace</h2><p>Select the original project workspace to receive experiments and edit planning comparisons.</p></section>';return;}
    loadCatalog();renderTasks();
  }
  function update(nextState){
    if(!node)return;if(activeWorkspace()!==workspace){restoreWorkspace();return;}
    let changed=false,openId=null;
    for(const task of currentTasks()){
      const previous=taskMarks.get(task.id);taskMarks.set(task.id,task.state);
      if(previous!==task.state&&['complete','failed','interrupted','cancelled'].includes(task.state)){
        if(previous!==undefined||watched.has(task.id))changed=true;
        if(watched.has(task.id)){
          watched.delete(task.id);remember('eco13:watched:'+workspace,[...watched.entries()]);
          if(task.state==='complete'){
            const id=task._eco13?.record_id||task.result?.record_id;
            if(id&&!dirty)openId=id;
            else if(id)announce('A completed comparison is ready in Saved editions. Your planning changes are still here.');
          }else {
            if(task.action==='eco13.report.save'&&task.payload?.record_id===recordId&&drafts.has(recordId)){dirty=true;const label=slot('draft-status');if(label)label.textContent='Planning save '+task.state+'; your draft remains available';}
            announce('The '+task.action.replace(/^eco13\./,'').replaceAll('.',' ')+' job is '+task.state+'. Open its queue details to continue.');
          }
        }
      }
    }
    renderTasks();if(changed)loadCatalog();if(openId)loadRecord(openId);
  }
  function mount(element,nextState){
    if(node)detach();node=element;node.addEventListener('click',onClick);node.addEventListener('submit',onSubmit);node.addEventListener('input',onInput);node.addEventListener('change',onChange);node.addEventListener('keydown',onKeydown);restoreWorkspace();update(nextState);
  }
  function detach(){
    captureDraft();clearEconomicSources();clearTimeout(debounce);rowAbort?.abort();recordAbort?.abort();catalogAbort?.abort();recordToken++;catalogToken++;rowToken++;
    if(node){node.removeEventListener('click',onClick);node.removeEventListener('submit',onSubmit);node.removeEventListener('input',onInput);node.removeEventListener('change',onChange);node.removeEventListener('keydown',onKeydown);}node=null;
  }
  return {mount,update,detach,dispatch,taskActions};
}
