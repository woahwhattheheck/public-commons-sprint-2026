/** Original Community plan revisions, retained queue operations and portable handovers. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>String(value??'').slice(0,12);
const clone=value=>JSON.parse(JSON.stringify(value));
const button=(action,label,id='',style='small')=>'<button type="button" class="'+esc(style)+'" data-action="community-revision-'+esc(action)+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';
const table=(headers,rows)=>'<div class="table-scroll"><table class="community-table"><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const valueText=(value,present=true)=>!present?'Absent':value===null?'Unknown / unspecified':value===''?'Empty text':typeof value==='object'?JSON.stringify(value):String(value);
const fieldRows=changes=>list(changes).map(row=>[esc(row.field),esc(valueText(row.before,row.before_present)),esc(valueText(row.after,row.after_present))]);
const scope='Community figures describe selected whole original block groups. Scientific changes identify retained native selections and outputs; they do not allocate whole-run model results to selected communities or interventions.';

export function communityRevisionSummary(value){
  const counts=value.counts||{},costs=value.costs||{},before=costs.before||{},after=costs.after||{};
  return '<div class="community-metrics">'+[
    ['Added interventions',counts.added??0],['Removed interventions',counts.removed??0],
    ['Changed interventions',counts.changed??0],['Changed positions',counts.position_changed??0]
  ].map(([label,n])=>'<div class="community-metric"><span>'+esc(label)+'</span><strong>'+esc(n)+'</strong></div>').join('')+'</div>'+
  '<p class="note">'+esc(scope)+'</p>'+
  table(['Planning estimates (USD)','Earlier','Later','Change'],[
    ['Known-estimate subtotal',esc(before.known_subtotal??'Unknown'),esc(after.known_subtotal??'Unknown'),esc(costs.known_subtotal_delta??'Unknown')],
    ['Complete total estimate',esc(before.complete?before.known_subtotal:'Unknown'),esc(after.complete?after.known_subtotal:'Unknown'),esc(costs.total_estimate_delta??'Unknown')],
    ['Unestimated intervention IDs',esc(list(before.missing_ids).join(', ')||'None'),esc(list(after.missing_ids).join(', ')||'None'),'']
  ])+'<p class="note">'+esc(costs.basis||'')+'</p>'+
  table(['Original intervention','Change','Earlier position','Later position','Earlier title','Later title'],
    list(value.interventions).map(row=>[esc(row.id),esc(row.status),esc(row.before_position??'—'),esc(row.after_position??'—'),
      esc(row.before?.title||''),esc(row.after?.title||'')]))+
  '<details><summary>Field-level intervention changes</summary>'+table(['Original intervention','Field','Earlier value','Later value'],
    list(value.interventions).flatMap(row=>list(row.changes).map(change=>[esc(row.id),...fieldRows([change])[0]])))+'</details>'+
  '<details><summary>Complete added and removed rows</summary>'+table(['Change','Original ID','Retained original row'],
    list(value.interventions).filter(row=>['added','removed'].includes(row.status)).map(row=>[
      esc(row.status),esc(row.id),'<pre>'+esc(JSON.stringify(row.status==='added'?row.after:row.before,null,2))+'</pre>']))+'</details>'+
  '<details><summary>Plan title, purpose and notes</summary>'+table(['Field','Earlier value','Later value'],fieldRows(value.plan_changes))+'</details>'+
  '<details><summary>Original community selections</summary>'+table(['Field','Earlier value','Later value'],fieldRows(value.selection_changes))+
    table(['Membership change','Original GEOIDs'],[['Added',esc(list(value.geography?.added_geoids).join(', ')||'None')],['Removed',esc(list(value.geography?.removed_geoids).join(', ')||'None')]])+'</details>'+
  '<details><summary>Saved scientific context</summary>'+table(['Field','Earlier value','Later value'],fieldRows(value.scientific_context?.selection_changes))+
    table(['Changed native family','Earlier snapshot SHA256','Later snapshot SHA256'],
      list(value.scientific_context?.changed_snapshot_families).map(row=>[esc(row.family),esc(row.before_sha256||'Absent'),esc(row.after_sha256||'Absent')]))+'</details>'+
  '<details><summary>Original source and metadata changes</summary>'+table(['Field','Earlier value','Later value'],fieldRows(value.source_changes))+'</details>';
}

export function attachCommunityRevisions({getState,api,endpoint,openForm,submitAction,detail,fileList,openPlan,studyTransferButton}){
  let generation=0;
  const workspace=()=>getState()?.workspace_key||'';
  const data=()=>getState()?.data||{};
  const url=(path,value={})=>endpoint(path,value);
  const pairs=selection=>selection.before_plan_id+'|'+selection.after_plan_id;
  function planButton(plan){return plan?.previous_plan_id?button('new','Compare revisions',plan.id):'';}
  function renderList(){
    const rows=list(data().community_plan_comparisons);
    if(!rows.length)return '';
    return '<section class="section community-section"><header class="section-header"><div><h2>Saved revision handovers</h2><p>Reopen original plan changes and download their complete source-bound handover.</p></div></header>'+
      table(['Comparison','Earlier revision','Later revision','Added / changed / removed',''],rows.map(row=>[
        esc(row.title),esc(row.before_plan?.title||short(row.selection?.before_plan_id)),
        esc(row.after_plan?.title||short(row.selection?.after_plan_id)),
        esc([row.counts?.added??0,row.counts?.changed??0,row.counts?.removed??0].join(' / ')),
        button('open','Open handover',row.id)]))+'</section>';
  }
  async function open(id){
    const w=workspace(),g=++generation;
    const result=await api(url('/api/community-revisions/inspect',{id}));
    if(workspace()!==w||g!==generation)return;
    if(result.workspace_key!==w||result.id!==id)throw Error('Open this saved comparison in its original project.');
    const comparison=result.comparison;
    detail(result.title,'<div class="community-detail-actions">'+
      button('plan','Open earlier plan',comparison.before_plan.id)+button('plan','Open later plan',comparison.after_plan.id)+
      (typeof studyTransferButton==='function'?studyTransferButton('community-plan-comparisons',id):'')+
      '</div>'+communityRevisionSummary(comparison)+fileList(list(result._downloads))+
      '<details class="technical"><summary>Complete retained comparison</summary><pre class="json-view">'+
      esc(JSON.stringify(comparison,null,2))+'</pre></details>',
      {kind:'community_plan_comparisons',id});
  }
  async function create(afterId){
    const w=workspace(),g=++generation;
    if(!w)throw Error('Select the original Community workspace.');
    const fresh=await api('/api/state?workspace='+encodeURIComponent(w));
    if(workspace()!==w||g!==generation)return;
    if(fresh.workspace_key!==w||fresh.data?.project?.id!==data().project?.id)
      throw Error('The original Community project changed while opening revisions.');
    const plans=list(fresh.data?.community_plans),reports=list(fresh.data?.community_reports);
    const index=new Map(plans.map(plan=>[plan.id,plan]));
    const later=plans.filter(plan=>plan.previous_plan_id&&index.has(plan.previous_plan_id));
    const chosen=later.find(plan=>plan.id===afterId)||later[0];
    if(!chosen)throw Error('Save a revised Community plan before comparing original editions.');
    const options=(rows,selected)=>rows.map(plan=>'<option value="'+esc(plan.id)+'"'+(plan.id===selected?' selected':'')+'>'+
      esc(plan.title)+' · revision '+esc(plan.revision_number)+' · '+esc(short(plan.id))+'</option>').join('');
    const ancestors=id=>{
      const rows=[],seen=new Set();let plan=index.get(id);
      while(plan?.previous_plan_id){
        if(seen.has(plan.id))throw Error('The original revision lineage repeats.');
        seen.add(plan.id);plan=index.get(plan.previous_plan_id);
        if(!plan)break;rows.push(plan);
      }
      return rows;
    };
    let currentForm=null,preview=null,previewSequence=0;
    const valid=()=>workspace()===w&&generation===g&&currentForm&&
      document.getElementById('operation-form')===currentForm&&currentForm.querySelector('[name="revision_after"]');
    const read=()=>{
      if(!valid())throw Error('Reopen the comparison form in its original workspace.');
      const before=currentForm.elements.namedItem('revision_before').value;
      const after=currentForm.elements.namedItem('revision_after').value;
      if(!ancestors(after).some(plan=>plan.id===before))
        throw Error('Select an earlier ancestor of the chosen later revision.');
      const reportIds=[...currentForm.querySelectorAll('[name="revision_report"]:checked')].map(node=>node.value);
      if(reportIds.some(id=>!reports.some(report=>report.id===id&&[before,after].includes(report.plan_id))))
        throw Error('Select retained reports from the two original plan editions.');
      const title=currentForm.elements.namedItem('revision_title').value.trim();
      if(!title)throw Error('Name the revision handover.');
      return {before_plan_id:before,after_plan_id:after,report_ids:reportIds,title};
    };
    const readPreview=async()=>{
      const selected=read(),sequence=++previewSequence;
      const target=currentForm.querySelector('[data-revision-preview]');
      target.textContent='Reading the two original saved plans…';
      try{
        const result=await api(url('/api/community-revisions/preview',{
          before_plan_id:selected.before_plan_id,after_plan_id:selected.after_plan_id}));
        if(!valid()||sequence!==previewSequence||pairs(read())!==pairs(selected))return null;
        if(result.workspace_key!==w||result.comparison?.before_plan?.id!==selected.before_plan_id||
          result.comparison?.after_plan?.id!==selected.after_plan_id)
          throw Error('The original comparison returned a different plan selection.');
        preview={key:pairs(selected),comparison:result.comparison};
        target.innerHTML=communityRevisionSummary(result.comparison);
        return preview;
      }catch(error){
        if(valid()&&sequence===previewSequence){preview=null;target.textContent=error.message;}
        throw error;
      }
    };
    const refreshReports=()=>{
      preview=null;++previewSequence;
      const before=currentForm.elements.namedItem('revision_before').value;
      const after=currentForm.elements.namedItem('revision_after').value;
      const selected=reports.filter(report=>[before,after].includes(report.plan_id));
      currentForm.querySelector('[data-revision-reports]').innerHTML=selected.length?selected.map(report=>
        '<label class="check"><input type="checkbox" name="revision_report" value="'+esc(report.id)+'" checked><span>'+
        esc(report.title||report.id)+'<small>'+esc(short(report.plan_id))+'</small></span></label>').join(''):
        '<p class="note">The complete original plans, table and received CSV revisions travel with this handover. Add a saved report later through a new comparison selection.</p>';
      currentForm.querySelector('[data-revision-preview]').textContent='Review the selected original revisions before saving.';
    };
    document.getElementById('detail-dialog')?.close();
    openForm('Compare saved Community revisions',
      'Review what changed in the original programme and retain a complete editable handover with both plan editions.',
      '<div class="form-grid">'+
      '<label><span>Later revised plan</span><select name="revision_after" required>'+options(later,chosen.id)+'</select></label>'+
      '<label><span>Earlier original plan</span><select name="revision_before" required>'+options(ancestors(chosen.id),chosen.previous_plan_id)+'</select></label>'+
      '<label class="full"><span>Handover title</span><input name="revision_title" maxlength="300" required value="'+
      esc((chosen.title+' — revision comparison').slice(0,300))+'"></label></div>'+
      '<fieldset><legend>Include complete retained reports</legend><div data-revision-reports></div></fieldset>'+
      '<button type="button" data-revision-preview-button>Review original changes</button>'+
      '<div data-revision-preview role="status" aria-live="polite"></div>',
      'Save complete revision handover',async()=>{
        const selected=read();
        if(!preview||preview.key!==pairs(selected))await readPreview();
        if(!valid()||!preview||preview.key!==pairs(selected)||JSON.stringify(read())!==JSON.stringify(selected))
          throw Error('Review the current original plan and report selection before saving.');
        return submitAction('community.plan.compare',clone(selected));
      },()=>{
        currentForm=document.getElementById('operation-form');
        if(workspace()!==w||generation!==g)return;
        refreshReports();
        currentForm.elements.namedItem('revision_after').addEventListener('change',()=>{
          const after=currentForm.elements.namedItem('revision_after').value;
          const rows=ancestors(after);
          currentForm.elements.namedItem('revision_before').innerHTML=options(rows,rows[0]?.id);
          refreshReports();
        });
        currentForm.elements.namedItem('revision_before').addEventListener('change',refreshReports);
        currentForm.querySelector('[data-revision-preview-button]').addEventListener('click',()=>{readPreview().catch(()=>{});});
      });
  }
  function taskActions(task){
    return task?.workspace===workspace()&&task.action==='community.plan.compare'&&task.state==='complete'&&task.result?.id?
      '<div class="page-actions">'+button('open','Open revision handover',task.result.id,'primary')+'</div>':'';
  }
  function dispatch(node){
    const action=node.dataset.action;
    if(action==='community-revision-new')return create(node.dataset.id);
    if(action==='community-revision-open')return open(node.dataset.id);
    if(action==='community-revision-plan')return openPlan(node.dataset.id);
    throw Error('Choose an available Community revision action.');
  }
  return {planButton,renderList,open,create,dispatch,taskActions};
}
