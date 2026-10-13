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
    return '<section class="section community-section"><header class="section-header"><div><h2>Saved revision handovers</h2><p>Reopen original plan changes, receive a complete handover and download its original files.</p></div>'+
      button('receive','Receive revision handover')+'</header>'+
      (rows.length?table(['Comparison','Origin','Earlier revision','Later revision','Added / changed / removed',''],rows.map(row=>[
        esc(row.title),esc(row.received?'Received · '+short(row.source_project_id):'This project'),
        esc(row.before_plan?.title||short(row.selection?.before_plan_id)),
        esc(row.after_plan?.title||short(row.selection?.after_plan_id)),
        esc([row.counts?.added??0,row.counts?.changed??0,row.counts?.removed??0].join(' / ')),
        button(row.received?'open-received':'open','Open handover',row.id)])):
        '<p class="note">Receive a completed revision ZIP, or compare two saved plan editions to create a handover.</p>')+'</section>';
  }
  async function open(id,{received=false}={}){
    const w=workspace(),g=++generation;
    const result=await api(url('/api/community-revisions/'+(received?'received':'inspect'),{id}));
    if(workspace()!==w||g!==generation)return;
    if(result.workspace_key!==w||result.id!==id)throw Error('Open this saved comparison in its original project.');
    const comparison=result.comparison,nativePlans=new Set(list(data().community_plans).map(row=>row.id));
    const originalPlanButton=(plan,label)=>!received||nativePlans.has(plan.id)?button('plan',label,plan.id):'';
    const origin=received?'<p class="note">Original project <span class="mono">'+esc(result.source_project_id)+
      '</span> · retained in this project as a complete received comparison. The original ZIP and every archived source member are available below.</p>':'';
    detail(result.title,origin+'<div class="community-detail-actions">'+
      originalPlanButton(comparison.before_plan,'Open earlier plan')+originalPlanButton(comparison.after_plan,'Open later plan')+
      (!received&&typeof studyTransferButton==='function'?studyTransferButton('community-plan-comparisons',id):'')+
      '</div>'+communityRevisionSummary(comparison)+fileList(list(result._downloads))+
      '<details class="technical"><summary>Complete retained comparison</summary><pre class="json-view">'+
      esc(JSON.stringify(comparison,null,2))+'</pre></details>',
      {kind:received?'community_received_revisions':'community_plan_comparisons',id});
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
    let currentForm=null,currentDialog=null,currentAfter=null,preview=null,previewSequence=0;
    const valid=()=>workspace()===w&&generation===g&&currentForm&&currentDialog?.open&&
      document.getElementById('form-dialog')===currentDialog&&
      document.getElementById('operation-form')===currentForm&&
      currentForm.querySelector('[name="revision_after"]')===currentAfter;
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
        currentDialog=document.getElementById('form-dialog');
        currentAfter=currentForm?.querySelector('[name="revision_after"]');
        if(!currentAfter||!valid())return;
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
  async function receive(){
    const w=workspace(),g=++generation;
    if(!w)throw Error('Select the project that will retain this Community handover.');
    let currentForm=null,currentDialog=null,currentArchive=null,reviewed=null,sequence=0;
    const valid=()=>workspace()===w&&generation===g&&currentForm&&currentDialog?.open&&
      document.getElementById('form-dialog')===currentDialog&&
      document.getElementById('operation-form')===currentForm&&
      currentForm.querySelector('[name="revision_archive"]')===currentArchive;
    const selectedFile=()=>{
      if(!valid())throw Error('Reopen the receiving form in its selected project.');
      const file=currentForm.elements.namedItem('revision_archive').files?.[0];
      if(!file)throw Error('Choose the complete Community revision handover ZIP.');
      const limit=getState()?.limits?.upload_bytes;
      if(Number.isFinite(limit)&&file.size>limit)throw Error('The ZIP exceeds this operator’s selected upload capacity.');
      return file;
    };
    const preview=async()=>{
      const file=selectedFile(),read=++sequence;
      const status=currentForm.querySelector('[data-revision-receive-preview]');
      status.textContent='Retaining the original ZIP and reopening its saved plan editions…';
      try{
        const uploaded=await api('/api/upload',{method:'POST',raw:file,filename:file.name});
        if(!valid()||read!==sequence||selectedFile()!==file)return null;
        if(!/^[0-9a-f]{64}$/.test(uploaded.id||'')||!/^[0-9a-f]{64}$/.test(uploaded.sha256||'')||
          uploaded.bytes!==file.size)throw Error('The original upload returned a different file identity.');
        const result=await api(url('/api/community-revisions/receive-preview',{upload_id:uploaded.id}));
        if(!valid()||read!==sequence||selectedFile()!==file)return null;
        if(result.workspace_key!==w||result.archive?.sha256!==uploaded.sha256||
          result.archive?.bytes!==uploaded.bytes||result.identity!=='MATCH')
          throw Error('The receiving preview returned a different original handover.');
        reviewed={file,upload_id:uploaded.id,archive_sha256:uploaded.sha256,result};
        status.innerHTML='<h3>'+esc(result.selection.title)+'</h3>'+
          '<p class="note">Original project '+esc(result.source_project_id)+' · '+esc(result.original_plans)+
          ' saved plan editions · '+esc(result.member_count)+' original files · '+esc(result.archive.bytes)+' ZIP bytes</p>'+
          communityRevisionSummary(result.comparison);
        return reviewed;
      }catch(error){
        if(valid()&&read===sequence){reviewed=null;status.textContent=error.message;}
        throw error;
      }
    };
    document.getElementById('detail-dialog')?.close();
    openForm('Receive a Community revision handover',
      'Retain the complete original comparison, source records and editable report files in this project.',
      '<label><span>Complete revision handover ZIP</span><input type="file" name="revision_archive" accept=".zip,application/zip" required></label>'+
      '<button type="button" data-revision-receive-preview-button>Review original comparison</button>'+
      '<div data-revision-receive-preview role="status" aria-live="polite">Choose the ZIP exported from a saved Community revision comparison.</div>',
      'Receive complete handover',async()=>{
        const file=selectedFile();
        if(!reviewed||reviewed.file!==file)await preview();
        if(!valid()||selectedFile()!==file||!reviewed||reviewed.file!==file)
          throw Error('Review the currently selected original handover before receiving.');
        return submitAction('community.revision.receive',{
          upload_id:reviewed.upload_id,archive_sha256:reviewed.archive_sha256});
      },()=>{
        currentForm=document.getElementById('operation-form');
        currentDialog=document.getElementById('form-dialog');
        currentArchive=currentForm?.querySelector('[name="revision_archive"]');
        if(!currentArchive||!valid())return;
        currentForm.elements.namedItem('revision_archive').addEventListener('change',()=>{
          reviewed=null;++sequence;
          currentForm.querySelector('[data-revision-receive-preview]').textContent='Review this original handover before receiving.';
        });
        currentForm.querySelector('[data-revision-receive-preview-button]').addEventListener('click',()=>{preview().catch(()=>{});});
      });
  }
  function taskActions(task){
    if(task?.workspace!==workspace()||task.state!=='complete'||!task.result?.id)return '';
    const action=task.action==='community.plan.compare'?'open':task.action==='community.revision.receive'?'open-received':null;
    return action?'<div class="page-actions">'+button(action,'Open revision handover',task.result.id,'primary')+'</div>':'';
  }
  function dispatch(node){
    const action=node.dataset.action;
    if(action==='community-revision-new')return create(node.dataset.id);
    if(action==='community-revision-open')return open(node.dataset.id);
    if(action==='community-revision-open-received')return open(node.dataset.id,{received:true});
    if(action==='community-revision-receive')return receive();
    if(action==='community-revision-plan')return openPlan(node.dataset.id);
    throw Error('Choose an available Community revision action.');
  }
  return {planButton,renderList,open,create,receive,dispatch,taskActions};
}
