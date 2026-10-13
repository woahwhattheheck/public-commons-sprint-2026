// MIT. Complete cash review in the original Operating forecast, with original native save.
import {signature} from './forecast-workbook.mjs';
import {zipWorkspace} from '../../../../stellar-forge/developer-site/dist/onboarding.mjs';
import {sha256} from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';
import {captureCashReview,validateCashReview,cashDateFields,prepareCashDraft,reconcileCashDraft,
  applyCashDraft,cashReviewReport,cashReviewCsv,emptyCashDesk,validateCashDesk} from './forecast-cash-reconciliation.mjs';
const cp=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=v=>JSON.stringify(v,null,2)+'\n',show=v=>v===null||v===undefined?'Not entered':typeof v==='object'?JSON.stringify(v):String(v);
const table=(headers,rows)=>'<div class="fcr-table"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const button=(title,action,extra='')=>'<button type="button" data-fcr-action="'+action+'" '+extra+'>'+esc(title)+'</button>';
const key=t=>JSON.stringify(t);
function retainReview(rows,entry){const result=cp(rows||[]);if(!result.some(r=>signature(r)===signature(entry)))result.push(cp(entry));if(result.length>100)throw Error('The complete review already retains 100 unfinished editions. Keep its working-file download and continue a separate current review.');return result;}
function download(content,name,mime='application/json'){const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function reportHtml(r){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forecast cash review</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem;color:#172431;background:#fff}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{border:1px solid #ccd4dc;padding:.5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}pre{white-space:pre-wrap}section{overflow:auto}@media print{body{max-width:none;margin:0}}</style><h1>Forecast cash review</h1><p>'+esc(r.baseline.id)+' · after '+esc(r.period.after)+' through '+esc(r.period.through)+' · case version '+r.caseVersion+'</p><p>'+esc(r.basis)+'</p><h2>Recorded cash and coverage</h2><pre>'+esc(json(r.totals))+'</pre><h2>Complete planned and attributed cash</h2>'+table(['Original scope','Planned USD','Recorded USD','Recorded difference USD','Unknown records'],r.groups.map(x=>[esc(x.key),esc(x.plannedUsd),esc(show(x.actualUsd)),esc(show(x.recordedDifferenceUsd)),esc(x.unvaluedCashIds.join(', '))]))+'<h2>Every original cash record</h2>'+table(['Record / reference','Date / state','Direction / amount','Attribution','Observations'],r.cash.map(x=>[esc(x.cash.id)+'<br>'+esc(x.cash.externalRef),esc(x.cash.date)+'<br>'+esc(x.cash.state),esc(x.cash.direction)+'<br>'+esc(show(x.cash.usdValue)),esc(json(x.parts)),esc(x.issues.join('; '))]))+'<h2>Changed original source records</h2><pre>'+esc(json(r.sourceCorrections))+'</pre></html>';}
export function mountForecastCashReview({container,getCurrent,getInputs,getRecoveryInputs=getInputs,api,available=()=>true,isBlocked=()=>false,onCurrent,onStateChange=()=>{},onApply,initialState=null}){
  const root=document.createElement('section');root.className='forecast-cash-review';container.replaceChildren(root);
  if(!document.querySelector('link[data-forecast-cash-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/forecast-cash-reconciliation.css';link.dataset.forecastCashStyle='';document.head.append(link);}
  let active=true,busy=false,generation=0,statusText='',isError=false,s=initialState?validateCashDesk(initialState,{caseId:getCurrent().program.id}):emptyCashDesk();
  const live=()=>active&&available()&&root.isConnected,blocked=()=>!live()||busy||isBlocked(),path=()=>'/api/operations/'+getCurrent().program.id;
  const inputs=()=>cp(getRecoveryInputs()),state=()=>cp(s),changed=()=>{generation++;onStateChange(state());};
  const status=(v,error=false)=>{statusText=v;isError=error;const n=root.querySelector('[data-fcr-status]');if(n){n.textContent=v;n.setAttribute('role',error?'alert':'status');}};
  const clearChoices=()=>{s.choices={};};
  const plan=()=>{if(!s.review)return null;if(s.forecastId!==s.review.baseline.id||s.asOfDate!==s.review.asOfDate)throw Error('Read the newly selected Forecast and review date before applying its inputs. The earlier complete review remains retained.');return reconcileCashDraft(inputs(),s.review,s.decisions,{choices:s.choices});};
  function currentReport(){if(!s.review)return null;let basis=s.review.beforeInputs;try{basis=prepareCashDraft(s.review,s.decisions).proposedInputs;}catch{}return cashReviewReport(s.review,basis);}
  function sync(){root.setAttribute('aria-busy',String(busy));root.querySelectorAll('button,input,select,textarea').forEach(n=>{n.disabled=blocked()||n.dataset.fcrDisabled==='true';});}
  async function run(task){if(blocked())return;busy=true;sync();try{await task();}catch(e){if(live())status(e.message,true);}finally{busy=false;if(live())sync();}}
  function preserveCapture(){return {generation,caseId:getCurrent().program.id,signature:signature(inputs())};}
  function check(c){if(!live()||generation!==c.generation||getCurrent().program.id!==c.caseId||signature(inputs())!==c.signature)throw Error('The selected source or current Forecast changed while loading. Current work remains intact; review again.');}
  function targets(row){
    const result=[{kind:'UNASSIGNED',id:null,label:'Leave unassigned'}],cash=row.cash;
    if(cash.state!=='OBSERVED'||cash.usdValue===null||/testnet/i.test(cash.network||'')||cash.date>s.review.asOfDate)return result;
    if(cash.direction==='OUT'&&!cash.allocations.length){
      for(const p of s.review.current.plan.scenario.future_costs)result.push({kind:'PACKAGE',id:p.id,label:'Package · '+p.id});
      for(const p of inputs().commercial)result.push({kind:'CUSTOMER_COST',id:p.id,label:'Customer cost · '+p.title});
    }else if(cash.direction==='IN'&&cash.category==='CUSTOMER'&&!cash.allocations.length){
      for(const p of inputs().commercial)result.push({kind:'CUSTOMER_RECEIPT',id:p.id,label:'Customer receipt · '+p.title});
    }
    return result;
  }
  function render(){
    if(!live())return;
    let report=null,p=null,problem='';try{report=currentReport();if(s.review&&s.decisions.note.trim())p=plan();}catch(e){problem=e.message;}
    const forecasts=getCurrent().forecasts||[],matches=(report?.cash||[]).filter(r=>!s.search||JSON.stringify(r).toLowerCase().includes(s.search.toLowerCase())),pages=Math.max(1,Math.ceil(matches.length/30));s.page=Math.min(s.page,pages-1);
    root.innerHTML='<header><div><h4>Forecast cash reconciliation</h4><p>Review a saved cash plan against original recorded payments, then prepare the next Forecast.</p></div></header>'
      +'<div class="fcr-fields"><label>Original saved Forecast<select data-fcr-field="forecastId"><option value="">Choose original edition</option>'+forecasts.map(f=>'<option value="'+esc(f.id)+'"'+(s.forecastId===f.id?' selected':'')+'>'+esc(f.name)+' · '+esc(f.asOfDate)+'</option>').join('')+'</select></label>'
      +'<label>Review through / next as-of date<input data-fcr-field="asOfDate" value="'+esc(s.asOfDate)+'" placeholder="YYYY-MM-DD"></label></div>'
      +'<div class="fcr-actions">'+button('Read original Forecast and current cash','capture')+button('Download complete review working file','working-export')+button('Reopen review working file','working-import')+'</div><input hidden type="file" accept=".json,application/json" data-fcr-file>'
      +'<p data-fcr-status role="'+(isError?'alert':'status')+'" aria-live="polite">'+esc(statusText)+'</p>'
      +(s.review?'<p class="fcr-source">Selected '+esc(s.review.baseline.id)+' · '+esc(s.review.baseline.sha256.slice(0,16))+' · captured case version '+s.review.current.program.version+'. Current dates and incomplete values remain in the original Forecast editor.</p>':'<p class="fcr-muted">Select an original immutable Forecast. Empty actual records remain empty; a plan is not evidence of a payment.</p>')
      +(problem?'<p role="alert" class="fcr-error">'+esc(problem)+'</p>':'')
      +(report?'<section><h5>Recorded cash and coverage</h5><div class="fcr-stats"><span>Recorded known net USD <b>'+esc(report.totals.actualKnownUsd)+'</b></span><span>Unassigned known USD <b>'+esc(report.totals.unassignedActualKnownUsd)+'</b></span><span>Unvalued records <b>'+report.totals.unvaluedCashIds.length+'</b></span></div><p>'+esc(report.basis)+'</p>'
        +table(['Original scope','Planned USD','Recorded attributed USD','Recorded difference USD'],report.groups.map(r=>[esc(r.title)+'<small>'+esc(r.key)+'</small>',esc(r.plannedUsd),esc(show(r.actualUsd)),esc(show(r.recordedDifferenceUsd))]))
        +'<details><summary>Original records changed since this Forecast ('+report.sourceCorrections.length+')</summary><pre>'+esc(json(report.sourceCorrections))+'</pre></details></section>'
        +'<section><h5>Review complete original cash</h5><label>Search every original row<input data-fcr-field="search" value="'+esc(s.search)+'"></label><p>'+matches.length+' matching records; page '+(s.page+1)+' of '+pages+'. Exports always retain every record.</p>'
        +table(['Original record','Actual source','Recorded attribution','Next Forecast assignment'],matches.slice(s.page*30,s.page*30+30).map(r=>{
          const editable=targets(r).length>1||['PACKAGE','CUSTOMER_COST','CUSTOMER_RECEIPT','CONFLICT'].includes(r.originalAssignment.kind),selected=s.decisions.assignments[r.cash.id];
          return [esc(r.cash.id)+'<small>'+esc(r.cash.externalRef)+'</small>',esc(r.cash.date)+' · '+esc(r.cash.direction)+' · '+esc(show(r.cash.usdValue))+' USD<small>'+esc(r.cash.state)+' · '+esc(r.cash.category)+' · '+esc(r.issues.join('; '))+'</small>',esc(json(r.parts)),
            editable?'<select data-fcr-cash="'+esc(r.cash.id)+'"><option value="">Keep current draft assignment</option>'+targets(r).map(t=>{const val=key({kind:t.kind,id:t.id});return '<option value="'+esc(val)+'"'+(selected&&key(selected)===val?' selected':'')+'>'+esc(t.label)+'</option>';}).join('')+'</select>':'<span class="fcr-muted">Original ledger allocation / source review required</span>'];}))
        +'<div class="fcr-actions">'+button('Previous records','previous',s.page===0?'data-fcr-disabled="true"':'')+button('Next records','next',s.page>=pages-1?'data-fcr-disabled="true"':'')+'</div></section>'
        +'<details><summary>Review next-Forecast dates ('+report.staleDates.length+' dates on/before selected as-of)</summary><p>Choose each changed date explicitly. Blank is allowed only where the original Forecast permits it. Past dates that remain entered are rejected by the native preview. An authored date does not record an actual receipt or start event.</p>'
        +table(['Original dated field','Retained value','Change this field','Proposed date'],cashDateFields(s.review.beforeInputs).filter(f=>f.path.length>1).map(f=>[esc(f.label),esc(show(f.value)),'<input type="checkbox" data-fcr-date-enable="'+esc(f.key)+'"'+(Object.hasOwn(s.decisions.dates,f.key)?' checked':'')+'>','<input data-fcr-date="'+esc(f.key)+'" '+(!Object.hasOwn(s.decisions.dates,f.key)?'data-fcr-disabled="true" ':'')+'value="'+esc(Object.hasOwn(s.decisions.dates,f.key)?s.decisions.dates[f.key]:f.value)+'" placeholder="'+(f.nullable?'YYYY-MM-DD or blank':'YYYY-MM-DD')+'">']))
        +'</details><label>Review basis and source context<textarea data-fcr-field="note" maxlength="12000" rows="3">'+esc(s.decisions.note)+'</textarea></label>'
        +'<div class="fcr-actions">'+button('Review all current / proposed changes','review')+button('Apply reviewed inputs and native preview','apply',!p||p.unresolved?'data-fcr-disabled="true"':'')+'</div>'
        +(p?'<section><h5>Complete draft reconciliation</h5><p>'+p.rows.length+' reviewed changes; '+p.unresolved+' unresolved. Applying preserves unrelated current inputs. The original native Forecast calculation must succeed before saving.</p>'
          +table(['Field / original cash','Original','Current','Proposed','Decision'],p.rows.map(r=>[esc(r.label),esc(show(r.before)),esc(show(r.current)),esc(show(r.proposed)),r.conflict?'<select data-fcr-choice="'+esc(r.key)+'" data-fcr-basis="'+esc(r.basis)+'"><option value="">Choose</option><option value="CURRENT"'+(r.decision==='CURRENT'?' selected':'')+'>Keep current</option><option value="PROPOSED"'+(r.decision==='PROPOSED'?' selected':'')+'>Use reviewed proposal</option></select>':'Preserve matching original / proposal']))+'</section>':'')
        +'<div class="fcr-actions">'+button('Download complete report JSON','json')+button('Download comparison CSV','csv')+button('Download readable report','html')+button('Export review and complete original case','case-export')+'</div>':'')
      +'<details><summary>Retained unfinished source reviews ('+(s.retainedReviews||[]).length+')</summary>'+(s.retainedReviews||[]).map((r,i)=>'<p>'+esc(r.review.baseline.id)+' · '+esc(r.review.asOfDate)+' '+button('Restore complete retained review','restore-review','data-review-index="'+i+'"')+'</p>').join('')+'</details>'
      +'<details><summary>Applied review history ('+s.history.length+')</summary>'+s.history.map(h=>'<p>'+esc(h.appliedAt)+' · '+esc(h.review.baseline.id)+' · '+esc(h.decisions.note)+'</p>').join('')+'</details>';
    sync();
  }
  root.addEventListener('input',event=>{
    const t=event.target;if(t.dataset.fcrField==='note'){s.decisions.note=t.value;clearChoices();changed();}
    else if(t.dataset.fcrField){s[t.dataset.fcrField]=t.value;if(t.dataset.fcrField==='search')s.page=0;changed();}
    else if(t.dataset.fcrDate){if(Object.hasOwn(s.decisions.dates,t.dataset.fcrDate)){s.decisions.dates[t.dataset.fcrDate]=t.value===''?null:t.value;clearChoices();changed();}}
  });
  root.addEventListener('change',event=>{
    const t=event.target;
    if(t.dataset.fcrCash){if(t.value)s.decisions.assignments[t.dataset.fcrCash]=JSON.parse(t.value);else delete s.decisions.assignments[t.dataset.fcrCash];clearChoices();changed();render();}
    else if(t.dataset.fcrDateEnable){const input=[...root.querySelectorAll('[data-fcr-date]')].find(n=>n.dataset.fcrDate===t.dataset.fcrDateEnable);if(t.checked)s.decisions.dates[t.dataset.fcrDateEnable]=input.value||null;else delete s.decisions.dates[t.dataset.fcrDateEnable];clearChoices();changed();render();}
    else if(t.dataset.fcrChoice){if(t.value)s.choices[t.dataset.fcrChoice]={value:t.value,basis:t.dataset.fcrBasis};else delete s.choices[t.dataset.fcrChoice];changed();render();}
    else if(t.dataset.fcrField==='forecastId'){s.forecastId=t.value||null;changed();}
    else if(t.dataset.fcrField==='search')render();
    else if(t.matches('[data-fcr-file]')){const file=t.files?.[0];if(!file)return;const guard=preserveCapture();void run(async()=>{if(file.size>256*1024*1024)throw Error('Keep the complete review within 256 MiB.');const raw=JSON.parse(await file.text());check(guard);const next=validateCashDesk(raw,{caseId:getCurrent().program.id});const originals=new Map;for(const review of [next.review,...next.history.map(h=>h.review),...(next.retainedReviews||[]).map(r=>r.review)].filter(Boolean)){if(!originals.has(review.baseline.id)){originals.set(review.baseline.id,await api(path()+'/forecasts/'+review.baseline.id));check(guard);}validateCashReview(review,{caseId:getCurrent().program.id,originalSaved:originals.get(review.baseline.id)});}s=next;changed();render();status('Reopened every original source record, decision, unfinished field and applied review.');});}
  });
  root.addEventListener('click',event=>{
    const t=event.target.closest('[data-fcr-action]');if(!t)return;const a=t.dataset.fcrAction;
    if(a==='working-export'&&!busy){download(json(state()),getCurrent().program.id+'-forecast-cash-working.json');return;}
    if(blocked())return;
    if(a==='working-import'){const input=root.querySelector('[data-fcr-file]');input.value='';input.click();return;}
    if(a==='restore-review'){const index=Number(t.dataset.reviewIndex),restored=s.retainedReviews[index];if(!restored)return;let retained=s.retainedReviews.filter((_,i)=>i!==index);const displaced=s.review?{review:cp(s.review),decisions:cp(s.decisions),choices:cp(s.choices)}:null;if(displaced&&signature(displaced)!==signature(restored))retained=retainReview(retained,displaced);s.retainedReviews=retained;s.review=cp(restored.review);s.decisions=cp(restored.decisions);s.choices=cp(restored.choices);s.forecastId=s.review.baseline.id;s.asOfDate=s.review.asOfDate;changed();render();return;}
    if(a==='previous'||a==='next'){s.page=Math.max(0,s.page+(a==='next'?1:-1));changed();render();return;}
    if(a==='review'){try{plan();render();status('Review every changed original, current and proposed value before applying.');}catch(e){status(e.message,true);}return;}
    const guard=preserveCapture();
    void run(async()=>{
      if(a==='capture'){
        if(!s.forecastId)throw Error('Choose an original saved Forecast.');
        const saved=await api(path()+'/forecasts/'+s.forecastId);check(guard);
        const current=await api(path());check(guard);const captured=captureCashReview(saved,current,inputs(),{asOfDate:s.asOfDate});
        const retained=s.review?retainReview(s.retainedReviews,{review:s.review,decisions:s.decisions,choices:s.choices}):cp(s.retainedReviews||[]);await onCurrent?.(current);check(guard);s.retainedReviews=retained;s.review=captured;s.decisions={assignments:{},dates:{},note:''};s.choices={};s.page=0;changed();render();status('Read the complete original Forecast and current case. Choose actual cash assignments and dated assumptions explicitly.');return;
      }
      if(a==='apply'){
        if(!s.review)throw Error('Read the original source first.');
        const before=inputs(),reviewed=plan();if(!reviewed||reviewed.unresolved)throw Error('Resolve every reviewed current-source choice.');
        const current=await api(path());check(guard);
        const original=await api(path()+'/forecasts/'+s.review.baseline.id);check(guard);validateCashReview(s.review,{caseId:current.program.id,originalSaved:original});
        const after=applyCashDraft(before,current,s.review,s.decisions,{choices:s.choices,expectedSignature:reviewed.currentSignature});
        const entry={review:cp(s.review),decisions:cp(s.decisions),choices:cp(s.choices),beforeInputs:before,afterInputs:cp(after),appliedAt:new Date().toISOString()};
        const next={...state(),choices:{},review:null,decisions:{assignments:{},dates:{},note:''},history:[...s.history,entry]};validateCashDesk(next,{caseId:current.program.id});
        const result=await onApply({inputs:after,beforeSignature:reviewed.currentSignature,current,desk:next,entry});if(result?.adopted===false)throw Error(result.message||'The current draft changed; reviewed source remains intact.');
        if(live()){s=next;changed();render();status('Applied only reviewed inputs. The original native preview and save controls retain this next Forecast.');}return;
      }
      const report=currentReport();if(!report)throw Error('Read the original cash review first.');
      if(a==='json'){download(json({review:state(),report}),'forecast-cash-review.json');return;}
      if(a==='csv'){download(cashReviewCsv(report),'forecast-cash-review.csv','text/csv;charset=utf-8');return;}
      if(a==='html'){download(reportHtml(report),'forecast-cash-review.html','text/html');return;}
      if(a==='case-export'){
        const before=await api(path());check(guard);if(before.program.version!==s.review.current.program.version)throw Error('The case changed after this source review. Refresh and review the current complete case before exporting.');
        if(signature({records:before.records,sources:before.sources,plan:before.plan.contentSha256})!==signature({records:s.review.current.records,sources:s.review.current.sources,plan:s.review.current.plan.contentSha256}))throw Error('The retained source differs from the complete original case. Read and review the native records before exporting.');
        const response=await api(path()+'/export.zip',undefined,{download:true}),data=new Uint8Array(await response.arrayBuffer());check(guard);
        const after=await api(path());check(guard);if(after.program.version!==before.program.version)throw Error('The case changed while exporting. Keep the retained review and refresh its source for a complete matching handover.');
        const files=[{path:'operations-case.zip',content:data},{path:'forecast-cash-working.json',content:json(state())},{path:'report.json',content:json(report)},{path:'report.html',content:reportHtml(report)},{path:'comparison.csv',content:cashReviewCsv(report)},
          {path:'README.txt',content:'Forecast cash review and complete original case\n\nOpen report.html and every original attachment. operations-case.zip is the unchanged native case with planning history, recorded payments, invoices and sources. Import that inner ZIP through the original Grant Operations receiver. The local working review remains bound to its original local case; retain it as the original issued comparison after receiving into a new case. Reopen a new cash review from the received original Forecast and current recorded cash for further work. This package records no payment and issues no invoice.\n'}];
        const manifest=[];for(const f of files){const b=typeof f.content==='string'?new TextEncoder().encode(f.content):f.content;manifest.push({path:f.path,bytes:b.length,sha256:await sha256(b)});check(guard);}
        files.push({path:'MANIFEST.json',content:json({schema:'stellar-forge.forecast-cash-delivery.v1',caseId:before.program.id,version:before.program.version,forecastId:s.review.baseline.id,forecastSha256:s.review.baseline.sha256,members:manifest})});
        download(zipWorkspace(files),'forecast-cash-complete-case.zip','application/zip');status('Exported the full review and exact complete original case, with every member identity.');return;
      }
    });
  });
  render();
  return {snapshot:state,setHostBusy:sync,refresh(){if(live())render();},dispose(){active=false;generation++;},root};
}
