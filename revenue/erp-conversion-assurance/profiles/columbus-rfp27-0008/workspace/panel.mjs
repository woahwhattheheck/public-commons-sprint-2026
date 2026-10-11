// MIT. An additive Columbus panel inside the original conversion operator.
import {procurement,sources,domains,phases} from './profile.mjs';
import {normalizePlan,newColumbusPlan,withPlan,compareTrials,phaseView} from './acceptance.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=(items,id)=>items.find(item=>item.id===id)?.title??id;
const option=(value,title,selected)=>`<option value="${escape(value)}"${value===selected?' selected':''}>${escape(title)}</option>`;
const showJson=value=>`<pre>${escape(JSON.stringify(value,null,2))}</pre>`;
const short=value=>value?String(value).slice(0,12):'—';
const sameDisposition=(a,b)=>a.jobId===b.jobId&&a.reportSha256===b.reportSha256&&a.collection===b.collection&&a.index===b.index;

/** The host supplies its authenticated api(path, options) and original controls.
 * onDraftChange receives the plain City plan for draft.columbus. The existing
 * stage action retains it in spec.workspace.columbus; this panel has no store.
 * updateDraft is called on deliberate open/stage/cohort changes, never a poll. */
export function mountColumbusPanel({element,api,draft={},onDraftChange=()=>{},onOpenJob,onOpenBundle,download,
  stylesheet='/columbus/panel.css'}={}) {
  if(!element||typeof api!=='function')throw new Error('The Columbus panel needs the original host element and API');
  let plan=structuredClone(draft.columbus??newColumbusPlan(draft));
  let lastPublished=JSON.stringify(plan);
  let tab='plan',project=null,loading=false,error='',generation=0,disposed=false;
  let compareBefore='',compareAfter='',jobPage=0,selectedJob='',findingKind='records',findingOffset=0,findingPage=null;
  const pageSize=25;
  if(stylesheet&&!document.querySelector('link[data-columbus-style]')) {
    const link=document.createElement('link');link.rel='stylesheet';link.href=stylesheet;link.dataset.columbusStyle='true';document.head.append(link);
  }
  element.classList.add('columbus-panel');

  function changed() {const value=JSON.stringify(plan);if(value!==lastPublished){lastPublished=value;onDraftChange(structuredClone(plan));}}
  function readFields() {
    const previousProject=plan.projectId;
    for(const field of element.querySelectorAll('[data-plan-field]')) {
      const key=field.dataset.planField;
      plan[key]=field.type==='number'?(field.value===''?null:Number(field.value)):field.value;
    }
    for(const field of element.querySelectorAll('[data-interface-field]')) {
      const row=plan.interfaces[Number(field.dataset.interfaceIndex)];
      if(row)row[field.dataset.interfaceField]=field.value;
    }
    if(plan.projectId!==previousProject){generation++;project=null;findingPage=null;selectedJob='';loading=false;compareBefore='';compareAfter='';}
  }
  function input(key,title,{area=false,type='text',hint='',options=null}={}) {
    const value=plan[key]??'';
    const control=options?`<select data-plan-field="${key}">${options.map(i=>option(i.id,i.title,value)).join('')}</select>`:
      area?`<textarea data-plan-field="${key}" rows="3" maxlength="4000">${escape(value)}</textarea>`:
      `<input data-plan-field="${key}" type="${type}" value="${escape(value)}"${type==='number'?` min="${key==='historicalYears'?0:1}" step="1" max="10000"`:' maxlength="240"'}>`;
    return `<label class="columbus-field">${escape(title)}${control}${hint?`<small>${escape(hint)}</small>`:''}</label>`;
  }
  function planFields() {
    return `<p class="columbus-note">Changes are retained with the original <strong>Stage bundle</strong> action. Each correction keeps its preceding bundle and run.</p>
      <div class="columbus-grid">${input('projectId','Project ID')}${input('title','Project title')}
      ${input('cohortId','Trial cohort ID',{hint:'Use the same ID for repeated runs of the same population.'})}
      ${input('domain','Business domain',{options:domains})}${input('phase','Phase',{options:phases})}
      ${input('trialNumber','Trial number',{type:'number'})}${input('plannedConversions','Proposed conversion count',{type:'number'})}
      ${input('historicalYears','Years of history',{type:'number'})}${input('period','Fiscal or pay period')}
      ${input('sourceSystem','Source system')}${input('targetSystem','Target system')}
      ${input('scope','Active and historical scope',{area:true})}${input('mappingDecision','Key, amount and crosswalk decisions',{area:true})}</div>
      <details open data-plan-section="responsibility"><summary>Responsibility and acceptance</summary><div class="columbus-grid">
      ${input('sourceOwner','Source extraction owner')}${input('targetOwner','Target loading owner')}
      ${input('primeOwner','Prime conversion owner')}${input('cityOwner','City acceptance owner')}
      ${input('responsibilities','Extraction, cleansing, mapping, loading and validation responsibilities',{area:true})}
      ${input('phaseCriteria','Phase criteria',{area:true})}${input('balanceEvidence','Independent financial / payroll control reference',{area:true})}
      </div></details>
      <details data-plan-section="cutover"><summary>Cutover and first year-ends</summary><div class="columbus-grid">
      ${input('freeze','Source freeze',{area:true})}${input('cutoverWindow','Cutover window',{area:true})}
      ${input('support','Cutover support and ownership',{area:true})}${input('rollback','Rollback contingency',{area:true})}
      ${input('fiscalClose','First fiscal close continuation',{area:true})}${input('payrollYearEnd','First payroll / tax year-end continuation',{area:true})}
      </div></details>
      <details data-plan-section="interfaces"><summary>Interface checks (${plan.interfaces?.length??0})</summary>
      ${(plan.interfaces??[]).map((row,index)=>`<fieldset class="columbus-interface"><legend>Interface ${index+1}</legend><div class="columbus-grid">
        ${['id','name','owner','result','reference'].map(key=>`<label class="columbus-field">${escape({id:'Stable ID',name:'Interface',owner:'Owner',result:'Recorded result',reference:'Original evidence reference'}[key])}
        <input data-interface-index="${index}" data-interface-field="${key}" value="${escape(row[key])}" maxlength="${['result','reference'].includes(key)?4000:240}"></label>`).join('')}
        </div><button type="button" data-action="remove-interface" data-index="${index}">Remove interface</button></fieldset>`).join('')}
      <button type="button" data-action="add-interface">Add interface</button></details>
      <details data-plan-section="sources"><summary>Retained procurement source versions</summary><ul>${(plan.sourceVersions??[]).map(pin=>{
        const source=sources.find(s=>s.id===pin.id);return `<li>${source?`<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a>`:escape(pin.id)}<code>${escape(pin.sha256)}</code></li>`;
      }).join('')}</ul></details>`;
  }
  function projectTools() {
    return `<div class="columbus-toolbar"><strong>Project ${escape(plan.projectId)}</strong>
      <button type="button" data-action="refresh-project"${loading?' disabled':''}>${loading?'Reading retained runs…':'Refresh retained runs'}</button>
      ${download?`<button type="button" data-action="project-handoff"${loading||!project?.completed?' disabled':''}>Download project handoff</button>`:''}</div>`;
  }
  function jobsTable() {
    if(!project)return '<p>Read the retained runs to compare this project’s trials.</p>';
    const rows=project.jobs.slice(jobPage*pageSize,(jobPage+1)*pageSize);
    return `<p>${project.completed} completed runs · ${project.comparisonPass} comparison PASS · ${project.comparisonFail} comparison FAIL · ${project.reviewed} reviewed</p>
      <div class="columbus-scroll"><table><thead><tr><th>Run</th><th>Cohort / trial</th><th>Phase</th><th>Original result</th><th>Latest recorded review</th><th>Open</th></tr></thead>
      <tbody>${rows.map(row=>`<tr><td><code>${escape(row.jobId)}</code><small>${escape(row.createdAt)}</small></td>
      <td>${escape(label(domains,row.plan.domain))}<br>${escape(row.plan.cohortId)} · ${row.plan.trialNumber??'—'}</td>
      <td>${escape(label(phases,row.plan.phase))}</td><td>${escape(row.status??row.state)}<small>Report ${short(row.report?.sha256)}</small></td>
      <td>${row.review?`${escape(row.review.decision)}<small>${escape(row.review.reviewer)} · ${escape(row.review.createdAt)}</small>`:'No review recorded'}</td>
      <td><button type="button" data-action="open-job" data-job="${escape(row.jobId)}">Original run</button>
      <button type="button" data-action="open-bundle" data-bundle="${row.bundleId}" data-job="${escape(row.jobId)}">Correction</button></td></tr>`).join('')||'<tr><td colspan="6">No retained runs for this project.</td></tr>'}</tbody></table></div>
      <div class="columbus-toolbar"><button type="button" data-action="previous-jobs"${jobPage===0?' disabled':''}>Previous</button>
      <span>Page ${jobPage+1} of ${Math.max(1,Math.ceil(project.jobs.length/pageSize))}</span>
      <button type="button" data-action="next-jobs"${(jobPage+1)*pageSize>=project.jobs.length?' disabled':''}>Next</button></div>
      ${(project.bundles??[]).some(b=>!b.jobIds.length)?`<details><summary>Saved plan revisions without a run</summary>
        ${(project.bundles??[]).filter(b=>!b.jobIds.length).map(b=>`<p>${escape(b.plan.cohortId)} · ${escape(label(phases,b.plan.phase))}
        <code>${b.bundle.bundleId}</code> <button type="button" data-action="open-bundle" data-bundle="${b.bundle.bundleId}">Open saved plan</button></p>`).join('')}</details>`:''}`;
  }
  function comparisonView() {
    if(!project)return '';
    const completed=project.jobs.filter(j=>j.report);
    let result='';
    if(compareBefore&&compareAfter)try {
      const before=project.jobs.find(j=>j.jobId===compareBefore),after=project.jobs.find(j=>j.jobId===compareAfter);
      const comparison=compareTrials(before,after);
      result=`<p>${escape(comparison.beforeStatus)} → ${escape(comparison.afterStatus)}. Changed: ${[
        ['source',comparison.sourceChanged],['target',comparison.targetChanged],['mapping / bundle',comparison.bundleChanged],['engine',comparison.engineChanged]
      ].filter(([,yes])=>yes).map(([name])=>name).join(', ')||'none'}.</p><div class="columbus-scroll"><table><thead><tr><th>Original count</th><th>Earlier run</th><th>Later run</th></tr></thead><tbody>
      ${Object.entries(comparison.counts).map(([name,count])=>`<tr><th>${escape(name)}</th><td>${count.before??'—'}</td><td>${count.after??'—'}</td></tr>`).join('')}</tbody></table></div>`;
    }catch(e){result=`<p class="columbus-error">${escape(e.message)}</p>`;}
    return `<h4>Compare retained trials</h4><div class="columbus-grid">${[['before','Earlier run',compareBefore],['after','Later run',compareAfter]].map(([id,title,value])=>
      `<label class="columbus-field">${title}<select data-compare="${id}">${option('','Choose a completed run',value)}${completed.map(j=>option(j.jobId,`${j.jobId} · ${j.plan.cohortId} / ${j.plan.trialNumber??'—'}`,value)).join('')}</select></label>`).join('')}</div>${result}`;
  }
  function phasePanel() {
    if(!project)return '<p>Read retained runs before selecting the exact reports and reviewer records for this phase.</p>';
    let view;
    try {view=phaseView(plan,project);}catch(e){return `<p class="columbus-error">${escape(e.message)}</p>`;}
    const selected=new Map((plan.phaseSelection??[]).map(pin=>[pin.jobId,pin]));
    return `<p><strong>${escape(view.preparation)}</strong> · ${escape(label(phases,plan.phase))}</p>
      <p>Choose the original reports and specific business reviews for this phase. A later review or rerun does not replace this saved selection.</p>
      <div class="columbus-scroll"><table><thead><tr><th>Use</th><th>Original run / report</th><th>Result</th><th>Business review to retain</th></tr></thead><tbody>
      ${project.jobs.filter(j=>j.report).map(job=>{
        const pin=selected.get(job.jobId),reviewId=pin?.reviewId??job.review?.reviewId??'';
        return `<tr><td><input type="checkbox" data-phase-job="${escape(job.jobId)}" aria-label="Select ${escape(job.jobId)}"${pin?' checked':''}></td>
        <td>${escape(job.jobId)}<small>${escape(job.plan.cohortId)} · ${escape(label(phases,job.plan.phase))}</small><code>${escape(job.report.sha256)}</code></td>
        <td>${escape(job.status)}</td><td><select data-phase-review="${escape(job.jobId)}">${option('','No review selected',reviewId)}
        ${job.reviews.map(r=>option(r.reviewId,`${r.decision} · ${r.reviewer} · ${r.createdAt}`,reviewId)).join('')}</select></td></tr>`;
      }).join('')||'<tr><td colspan="4">No completed reports.</td></tr>'}</tbody></table></div>
      <h4>Preparation findings</h4>${view.findings.length?`<ul>${view.findings.map(f=>`<li>${escape(f.message)}</li>`).join('')}</ul>`:'<p>All recorded preparation fields and selected reviews are complete.</p>'}
      <details><summary>Original City requirements</summary>${view.criteria.map(c=>`<p><strong>${escape(c.title)}</strong> · ${escape(c.section)}, p${c.page}<br>${escape(c.detail)}</p>`).join('')}</details>`;
  }
  function dispositionPanel() {
    if(!project)return '<p>Read retained runs to assign and document their exact original discrepancies.</p>';
    const page=findingPage,rows=page?.comparison?.page?.rows??[];
    const descriptor=page?.job?.result?.report;
    const collection=findingKind==='groups'?'group_discrepancies':'discrepancies';
    return `<p>Assignments are saved with the next original mapping revision. The selected report and its comparison result remain unchanged.</p>
      <div class="columbus-grid"><label class="columbus-field">Original completed run<select data-finding-job>${option('','Choose a run',selectedJob)}
      ${project.jobs.filter(j=>j.report).map(j=>option(j.jobId,`${j.jobId} · ${j.status}`,selectedJob)).join('')}</select></label>
      <label class="columbus-field">Findings<select data-finding-kind>${option('records','Record discrepancies',findingKind)}${option('groups','Group totals',findingKind)}</select></label></div>
      ${page?`<p>${page.comparison?.page.total??0} original findings · report <code>${escape(descriptor?.sha256)}</code></p>`:''}
      ${rows.map((finding,index)=>{
        const identity={jobId:selectedJob,reportSha256:descriptor.sha256,collection,index:findingOffset+index};
        const saved=plan.dispositions.find(d=>sameDisposition(d,identity))??{owner:'',status:'open',note:'',reference:''};
        return `<fieldset class="columbus-finding" data-finding-index="${index}"><legend>${collection==='discrepancies'?'Record':'Group'} ${identity.index+1}</legend>
        <details><summary>Original discrepancy</summary>${showJson(finding)}</details><div class="columbus-grid">
        <label class="columbus-field">Assigned owner<input data-disposition="owner" maxlength="240" value="${escape(saved.owner)}"></label>
        <label class="columbus-field">Disposition<select data-disposition="status">${['open','investigating','corrected','accepted_exception'].map(s=>option(s,s.replaceAll('_',' '),saved.status)).join('')}</select></label>
        <label class="columbus-field">Reason / correction<textarea data-disposition="note" maxlength="4000">${escape(saved.note)}</textarea></label>
        <label class="columbus-field">Original correction or exception reference<textarea data-disposition="reference" maxlength="4000">${escape(saved.reference)}</textarea></label></div></fieldset>`;
      }).join('')}
      ${page?`<div class="columbus-toolbar"><button type="button" data-action="previous-findings"${findingOffset===0?' disabled':''}>Previous findings</button>
      <span>${rows.length?findingOffset+1:0}–${findingOffset+rows.length}</span><button type="button" data-action="next-findings"${page.comparison?.page.nextOffset===null?' disabled':''}>Next findings</button></div>`:''}
      <p>${plan.dispositions.length} report-bound dispositions retained in the current draft.</p>`;
  }
  function render() {
    if(disposed)return;
    const expanded=new Map([...element.querySelectorAll('details[data-plan-section]')]
      .map(section=>[section.dataset.planSection,section.open]));
    element.innerHTML=`<header><div><h3>Columbus conversion and cutover</h3><p>RFP 27-0008 · October 28, 2026, 5:00 PM Eastern · Addendum 2</p></div>
      <a href="${escape(procurement.listing)}" target="_blank" rel="noopener noreferrer">Original procurement</a></header>
      <nav aria-label="Columbus acceptance views">${[['plan','Plan'],['trials','Trials'],['dispositions','Dispositions'],['phase','Phase and cutover']].map(([id,title])=>
        `<button type="button" data-tab="${id}" aria-pressed="${tab===id}">${title}</button>`).join('')}</nav>
      ${error?`<p class="columbus-error" role="alert">${escape(error)}</p>`:''}
      ${tab==='plan'?planFields():projectTools()+(tab==='trials'?jobsTable()+comparisonView():tab==='phase'?phasePanel():dispositionPanel())}`;
    for(const section of element.querySelectorAll('details[data-plan-section]'))
      if(expanded.has(section.dataset.planSection))section.open=expanded.get(section.dataset.planSection);
  }

  async function loadProject() {
    readFields();changed();loading=true;error='';const attempt=++generation;render();
    const projectId=plan.projectId;
    try {
      const retained=await api('/api/columbus/project?projectId='+encodeURIComponent(projectId));
      if(retained?.projectId!==projectId||!Array.isArray(retained.jobs)||!Array.isArray(retained.cohorts))
        throw new Error('The original project projection changed');
      if(attempt!==generation||disposed)return;
      project=retained;jobPage=0;
    }catch(e){if(attempt===generation)error=e.message??'The retained project could not be read';}
    finally{if(attempt===generation){loading=false;render();}}
  }
  async function loadFindings() {
    if(!selectedJob){findingPage=null;render();return;}
    const attempt=++generation;loading=true;error='';render();
    try {
      const detail=await api('/api/jobs/'+encodeURIComponent(selectedJob)+'?kind='+findingKind+'&offset='+findingOffset+'&limit=25');
      const known=project.jobs.find(j=>j.jobId===selectedJob);
      if(detail.job.jobId!==selectedJob||detail.job.bundleId!==known?.bundleId||detail.job.result?.report?.sha256!==known?.report?.sha256)
        throw new Error('Refresh the project because the selected original report changed');
      if(detail.comparison&&detail.comparison.page.offset!==findingOffset)throw new Error('The original discrepancy page changed');
      if(attempt===generation)findingPage=detail;
    }catch(e){if(attempt===generation){error=e.message;findingPage=null;}}
    finally{if(attempt===generation){loading=false;render();}}
  }
  function dispositionChange(field) {
    const container=field.closest('[data-finding-index]'),index=Number(container?.dataset.findingIndex);
    if(!Number.isSafeInteger(index)||!findingPage?.job?.result?.report)return;
    const identity={jobId:findingPage.job.jobId,reportSha256:findingPage.job.result.report.sha256,
      collection:findingKind==='groups'?'group_discrepancies':'discrepancies',index:findingOffset+index};
    const row={...identity};for(const input of container.querySelectorAll('[data-disposition]'))row[input.dataset.disposition]=input.value;
    const existing=plan.dispositions.findIndex(d=>sameDisposition(d,identity));
    if(existing<0)plan.dispositions.push(row);else plan.dispositions[existing]=row;changed();
  }
  function phaseChange(jobId) {
    const job=project?.jobs.find(j=>j.jobId===jobId);if(!job?.report)return;
    const check=element.querySelector(`[data-phase-job="${CSS.escape(jobId)}"]`);
    const review=element.querySelector(`[data-phase-review="${CSS.escape(jobId)}"]`);
    plan.phaseSelection=plan.phaseSelection.filter(p=>p.jobId!==jobId);
    if(check?.checked)plan.phaseSelection.push({jobId,bundleId:job.bundleId,reportSha256:job.report.sha256,reviewId:review.value||null});
    changed();render();
  }
  function onInput(event) {
    if(event.target.matches('[data-plan-field],[data-interface-field]')){readFields();changed();}
    if(event.target.matches('[data-disposition]'))dispositionChange(event.target);
  }
  async function onChange(event) {
    const target=event.target;
    if(target.dataset.compare){if(target.dataset.compare==='before')compareBefore=target.value;else compareAfter=target.value;render();}
    if(target.matches('[data-finding-job]')){selectedJob=target.value;findingOffset=0;findingPage=null;await loadFindings();}
    if(target.matches('[data-finding-kind]')){findingKind=target.value;findingOffset=0;findingPage=null;await loadFindings();}
    if(target.dataset.phaseJob||target.dataset.phaseReview)phaseChange(target.dataset.phaseJob??target.dataset.phaseReview);
  }
  async function onClick(event) {
    const button=event.target.closest('button');if(!button||!element.contains(button))return;
    if(button.dataset.tab){readFields();changed();tab=button.dataset.tab;render();return;}
    const action=button.dataset.action;
    if(action==='refresh-project')return loadProject();
    if(action==='project-handoff'&&download){
      loading=true;error='';render();
      try{await download('/api/columbus/handoff?projectId='+encodeURIComponent(plan.projectId));}
      catch(e){error=e.message??'The original project handoff could not be downloaded';}
      finally{loading=false;render();}return;
    }
    if(action==='add-interface'){readFields();plan.interfaces??=[];const used=new Set(plan.interfaces.map(i=>i.id));let n=1;while(used.has('interface-'+n))n++;
      plan.interfaces.push({id:'interface-'+n,name:'',owner:'',result:'',reference:''});changed();render();}
    if(action==='remove-interface'){readFields();plan.interfaces.splice(Number(button.dataset.index),1);changed();render();}
    if(action==='previous-jobs'){jobPage=Math.max(0,jobPage-1);render();}
    if(action==='next-jobs'){jobPage++;render();}
    if(action==='previous-findings'){findingOffset=Math.max(0,findingOffset-25);return loadFindings();}
    if(action==='next-findings'){const next=findingPage?.comparison?.page.nextOffset;if(next!==null&&next!==undefined){findingOffset=next;return loadFindings();}}
    if(action==='open-job'&&onOpenJob){readFields();changed();return onOpenJob(button.dataset.job);}
    if(action==='open-bundle'&&onOpenBundle){readFields();changed();return onOpenBundle(button.dataset.bundle,button.dataset.job);}
  }
  const clickListener=event=>Promise.resolve(onClick(event)).catch(e=>{error=e.message??'The original operation failed';render();});
  element.addEventListener('input',onInput);element.addEventListener('change',onChange);element.addEventListener('click',clickListener);
  render();
  return Object.freeze({
    currentPlan(){readFields();return normalizePlan(plan);},
    updateDraft(next){readFields();generation++;loading=false;error='';plan=structuredClone(next.columbus??newColumbusPlan(next));lastPublished=JSON.stringify(plan);project=null;findingPage=null;render();},
    refresh:loadProject,
    destroy(){disposed=true;generation++;element.removeEventListener('input',onInput);element.removeEventListener('change',onChange);element.removeEventListener('click',clickListener);element.replaceChildren();},
  });
}

export const mountProfilePanel=mountColumbusPanel;
export const panelTitle='Project and phases';
export const applyPlan=(draft,plan)=>({...draft,columbus:plan});
export const decorateSpec=(spec,draft)=>withPlan(spec,draft.columbus??newColumbusPlan(draft));
export function changeCohort(draft,previous) {
  const fresh=newColumbusPlan(draft),old=previous.columbus;
  return {...draft,scope:previous.scope,correctionReason:previous.correctionReason,
    columbus:old?{...old,cohortId:fresh.cohortId,domain:fresh.domain,phase:fresh.phase,trialNumber:1}:fresh};
}
