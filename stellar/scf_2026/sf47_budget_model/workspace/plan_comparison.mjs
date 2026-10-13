const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const shown = value => value === null || value === undefined ? '—' : esc(value);
const views = [['impact','Funding and capacity'],['workPackages','Work packages'],['milestones','Milestones'],['contributors','Contributors'],['delivery','Delivery scope'],['changes','All field changes'],['daily','Daily cash']];
const pageSize = 80;

function original(value, present = true) {
  return present ? '<details><summary>Complete saved value</summary><pre>' + esc(JSON.stringify(value,null,2)) + '</pre></details>' : '<span class="cmp-muted">Absent</span>';
}
function table(headers, rows) {
  return '<div class="cmp-scroll"><table><thead><tr>' + headers.map(item=>'<th scope="col">'+esc(item)+'</th>').join('') +
    '</tr></thead><tbody>' + (rows.length ? rows.map(row=>'<tr>'+row.map(item=>'<td>'+item+'</td>').join('')+'</tr>').join('') : '<tr><td colspan="'+headers.length+'">No rows match this selection.</td></tr>') + '</tbody></table></div>';
}
function signed(value) {
  return value === null ? '—' : esc((/^[0-9]/.test(String(value)) && !/^0(?:\.0*)?$/.test(String(value)) ? '+' : '') + value);
}
function revisionOptions(rows, selected) {
  return rows.map(row=>'<option value="'+row.revision+'"'+(row.revision===selected?' selected':'')+'>Revision '+row.revision+' · '+esc(row.savedAt)+' · '+esc(row.note || 'Saved plan')+'</option>').join('');
}

/** Mount a saved-revision comparison. The caller retains selection across tab changes. */
export function mountPlanComparison({container, api, plan, plans, history, inform, selection = {}}) {
  if(!document.querySelector('link[data-plan-comparison-style]')) {
    const stylesheet=document.createElement('link');
    stylesheet.rel='stylesheet';stylesheet.href='/plan_comparison.css';stylesheet.dataset.planComparisonStyle='true';
    document.head.append(stylesheet);
  }
  const root=document.createElement('section');root.className='plan-comparison';container.replaceChildren(root);
  let disposed=false, pending=false, hostBusy=false, serial=0, report=null, targetHistory=[], view='impact', page=0, filter='', area='', changedOnly=false;
  selection.toPlanId = plans.some(item=>item.id===selection.toPlanId) ? selection.toPlanId : plan.id;
  selection.fromRevision = history.some(item=>item.revision===selection.fromRevision) ? selection.fromRevision : (history[1]?.revision ?? history[0]?.revision ?? plan.revision);
  function status(message, error=false) {
    const node=root.querySelector('[data-cmp-status]');
    if(node){node.textContent=message;node.dataset.error=String(error);node.setAttribute('role',error?'alert':'status');}
  }
  function disabled() {
    root.setAttribute('aria-busy',String(pending || hostBusy));
    for(const control of root.querySelectorAll('button,input,select')) {
      control.disabled=pending || hostBusy || (control.hasAttribute('data-cmp-export') && !report) ||
        (control.dataset.cmp==='compare' && (!Number.isInteger(selection.fromRevision) || !Number.isInteger(selection.toRevision))) ||
        (control.dataset.cmp==='previous' && page===0) ||
        (control.dataset.cmp==='next' && (page+1)*pageSize>=selectedRows().length);
    }
  }
  function controls() {
    root.innerHTML='<header class="cmp-heading"><div><h2>Compare saved plans</h2><p>Select two retained revisions to inspect scope, payment timing, staffing, and funding changes.</p></div></header>'+
      '<div class="cmp-selectors"><label>Before plan<span class="cmp-static">'+esc(plan.name)+'</span></label>'+
      '<label>Before revision<select data-cmp-field="fromRevision">'+revisionOptions(history,selection.fromRevision)+'</select></label>'+
      '<label>After plan<select data-cmp-field="toPlanId">'+plans.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===selection.toPlanId?' selected':'')+'>'+esc(item.name)+'</option>').join('')+'</select></label>'+
      '<label>After revision<select data-cmp-field="toRevision">'+revisionOptions(targetHistory,selection.toRevision)+'</select></label></div>'+
      '<div class="cmp-toolbar"><button type="button" data-cmp="compare">Compare selected revisions</button><span class="cmp-muted">Saved source and reports are used for both selections.</span></div>'+
      '<p data-cmp-status role="status"></p><div data-cmp-result></div>';
    disabled();
  }
  function selectedRows() {
    if(!report)return [];
    let rows=view==='changes'?report.changes:view==='daily'?report.days:view==='impact'?report.metrics:(report.groups[view] || []);
    if(changedOnly && report.groups[view])rows=rows.filter(row=>row.state!=='unchanged');
    if(area && view==='changes')rows=rows.filter(row=>row.area===area);
    if(filter.trim()) {const search=filter.trim().toLowerCase();rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(search));}
    return rows;
  }
  function identity(side) {
    const value=report[side];
    return '<section><h3>'+esc(side==='before'?'Before':'After')+' · '+esc(value.name)+' · revision '+value.revision+'</h3>'+
      '<p>'+esc(value.savedAt)+' · '+esc(value.note)+'</p><dl><dt>Plan</dt><dd><code>'+esc(value.id)+'</code></dd>'+
      '<dt>Saved inputs</dt><dd><code>'+esc(value.contentSha256)+'</code></dd><dt>Retained report</dt><dd><code>'+esc(value.reportSha256)+'</code></dd>'+
      '<dt>Original source</dt><dd><code>'+esc(value.source.sha256)+'</code></dd><dt>Calculator</dt><dd><code>'+shown(value.calculatorSha256)+'</code></dd></dl></section>';
  }
  function renderResult() {
    const panel=root.querySelector('[data-cmp-result]');
    if(!report){panel.replaceChildren();return;}
    panel.innerHTML='<div class="cmp-summary"><strong>'+report.summary.inputChanges+' input changes</strong><span>'+report.summary.reportChanges+' retained report changes</span>'+
      '<span>'+report.summary.modeledDaysBefore+' → '+report.summary.modeledDaysAfter+' modeled days</span></div>'+
      '<p class="cmp-basis">Deltas are after minus before. Unset values and days outside a selected model have no numeric delta.</p>'+
      (!report.basis.sameOriginalSource?'<p class="cmp-note">These plans retain different original source documents. The original sources travel with the comparison package.</p>':'')+
      (!report.basis.sameCalculator?'<p class="cmp-note">These revisions retain results from different calculator versions. The comparison preserves each version’s saved output.</p>':'')+
      '<details class="cmp-source"><summary>Selected source and retained report identity</summary><div class="cmp-identities">'+identity('before')+identity('after')+'</div>'+
      '<p>Comparison SHA-256: <code>'+esc(report.comparisonSha256)+'</code></p></details>'+
      '<div class="cmp-toolbar cmp-downloads" aria-label="Export complete comparison">'+
      [['export.zip','Download receiving package'],['report.html','Full HTML report'],['changes.csv','All field changes CSV'],['impact.csv','Impact CSV'],['daily.csv','Daily cash CSV']].map(([kind,label])=>'<button type="button" data-cmp-export="'+kind+'">'+label+'</button>').join('')+'</div>'+
      '<nav class="cmp-tabs" aria-label="Comparison views">'+views.map(([key,label])=>'<button type="button" data-cmp-view="'+key+'" aria-pressed="'+(view===key)+'">'+label+'</button>').join('')+'</nav>'+
      '<div class="cmp-filters"><label>Search this view<input type="search" data-cmp-filter value="'+esc(filter)+'"></label>'+
      (view==='changes'?'<label>Saved section<select data-cmp-area>'+[['','All sections'],['scenario','Scenario inputs'],['planning','Planning inputs'],['report','Retained report']].map(([key,label])=>'<option value="'+key+'"'+(area===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>':'')+
      (report.groups[view]?'<label class="cmp-check"><input type="checkbox" data-cmp-changed'+(changedOnly?' checked':'')+'>Changed rows only</label>':'')+'</div>'+
      '<div data-cmp-table></div><div class="cmp-pagination"><button type="button" data-cmp="previous">Previous</button><span data-cmp-count></span><button type="button" data-cmp="next">Next</button></div>';
    renderRows();
  }
  function renderRows() {
    const rows=selectedRows();page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
    const shownRows=rows.slice(page*pageSize,(page+1)*pageSize);
    let headers, cells;
    if(view==='impact') {
      headers=['Measure','Unit','Before','After','Change'];
      cells=shownRows.map(row=>[esc(row.label),esc(row.unit),shown(row.before),shown(row.after),signed(row.delta)]);
    } else if(view==='changes') {
      headers=['Saved section','JSON path','Change','Before','After'];
      cells=shownRows.map(row=>[esc(row.area),'<code>'+esc(row.path)+'</code>',esc(row.kind),original(row.before,row.beforePresent),original(row.after,row.afterPresent)]);
    } else if(view==='daily') {
      headers=['Project day','Before date','After date','Before cash gap (USD)','After cash gap (USD)','Change (USD)','Complete before day','Complete after day'];
      cells=shownRows.map(row=>[shown(row.day),shown(row.before?.date),shown(row.after?.date),shown(row.before?.cashGapUsd),shown(row.after?.cashGapUsd),signed(row.delta.cashGapUsd),original(row.before,row.before!==null),original(row.after,row.after!==null)]);
    } else {
      headers=['ID','Change','Before','After'];
      cells=shownRows.map(row=>['<code>'+esc(row.id)+'</code>',esc(row.state),original(row.before,row.state!=='added'),original(row.after,row.state!=='removed')]);
    }
    root.querySelector('[data-cmp-table]').innerHTML=table(headers,cells);
    root.querySelector('[data-cmp-count]').textContent=rows.length ? (page*pageSize+1)+'–'+Math.min((page+1)*pageSize,rows.length)+' of '+rows.length+' rows · exports contain the complete comparison' : '0 rows';
    disabled();
  }
  function query(expected) {
    const value=new URLSearchParams({fromRevision:String(selection.fromRevision),toRevision:String(selection.toRevision),toPlanId:selection.toPlanId});
    if(expected)value.set('expectedComparisonSha256',expected);
    return '?'+value.toString();
  }
  async function loadTarget() {
    targetHistory=selection.toPlanId===plan.id?history:(await api('/api/plans/'+encodeURIComponent(selection.toPlanId)+'/history')).revisions;
    selection.toRevision=targetHistory.some(row=>row.revision===selection.toRevision)?selection.toRevision:targetHistory[0]?.revision;
  }
  async function compareSelected() {
    const operation=++serial;pending=true;report=null;renderResult();disabled();status('Reading the selected saved revisions…');
    try {
      const value=await api('/api/plans/'+encodeURIComponent(plan.id)+'/comparison'+query());
      if(disposed || operation!==serial)return;
      report=value;page=0;renderResult();status('Loaded the complete comparison of revision '+value.before.revision+' and revision '+value.after.revision+'.');
    } catch(error) {if(!disposed && operation===serial)status(error.message,true);}
    finally {if(!disposed && operation===serial){pending=false;disabled();}}
  }
  async function exportSelected(kind) {
    if(!report)return;
    const operation=++serial;pending=true;disabled();status('Preparing the complete '+(kind==='export.zip'?'receiving package':'export')+'…');
    try {
      const response=await api('/api/plans/'+encodeURIComponent(plan.id)+'/comparison/'+kind+query(report.comparisonSha256),undefined,{download:true});
      const blob=await response.blob();if(disposed || operation!==serial)return;
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='sf47-comparison-'+report.comparisonSha256.slice(0,12)+'-'+kind;
      document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status(kind==='export.zip'?'Receiving package downloaded. CONTENTS.json identifies the original plan ZIPs and selected revisions.':'Complete export downloaded.');
    } catch(error) {if(!disposed && operation===serial)status(error.message,true);}
    finally {if(!disposed && operation===serial){pending=false;disabled();}}
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button || button.disabled || !root.contains(button))return;
    if(button.dataset.cmp==='compare')void compareSelected();
    else if(button.dataset.cmpExport)void exportSelected(button.dataset.cmpExport);
    else if(button.dataset.cmpView){view=button.dataset.cmpView;page=0;filter='';renderResult();}
    else if(button.dataset.cmp==='previous'){page--;renderRows();}
    else if(button.dataset.cmp==='next'){page++;renderRows();}
  });
  root.addEventListener('input',event=>{
    if(event.target.hasAttribute('data-cmp-filter')){filter=event.target.value;page=0;renderRows();}
  });
  root.addEventListener('change',async event=>{
    const control=event.target, field=control.dataset.cmpField;
    if(control.hasAttribute('data-cmp-area')){area=control.value;page=0;renderRows();return;}
    if(control.hasAttribute('data-cmp-changed')){changedOnly=control.checked;page=0;renderRows();return;}
    if(!field)return;
    selection[field]=field==='toPlanId'?control.value:Number(control.value);
    report=null;renderResult();status('Selection changed. Compare the selected saved revisions.');
    if(field!=='toPlanId')return;
    targetHistory=[];selection.toRevision=undefined;
    const operation=++serial;pending=true;controls();status('Loading the selected plan’s saved revisions…');
    try {await loadTarget();if(disposed || operation!==serial)return;controls();}
    catch(error){if(!disposed && operation===serial)status(error.message,true);}
    finally{if(!disposed && operation===serial){pending=false;disabled();}}
  });
  controls();
  const ready=(async()=>{
    pending=true;disabled();status('Loading saved revision history…');
    try {await loadTarget();if(disposed)return;controls();pending=false;await compareSelected();}
    catch(error){if(!disposed){pending=false;status(error.message,true);disabled();}}
  })();
  return {root,ready,dispose(){disposed=true;serial++;root.remove();},setHostBusy(value){hostBusy=Boolean(value);disabled();}};
}
