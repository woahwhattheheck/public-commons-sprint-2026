/** Read-only impact of original Source Updates on retained Receiving studies. */
const VIEW='receiving-source-impact',API='/api/receiving-source-impact';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>/^[0-9a-f]{64}$/.test(value||'');
const code=value=>'<code>'+esc(value||'Unmapped')+'</code>';
const label=value=>String(value||'').replaceAll('_',' ');
const note=(value,cls='')=>'<p class="rw-impact-note '+cls+'">'+esc(value)+'</p>';
const button=(action,text,attrs='')=>'<button type="button" data-rwi-action="'+action+'" '+attrs+'>'+esc(text)+'</button>';
const count=value=>Number.isSafeInteger(value)?value:0;

export function attachReceivingSourceImpact(context){
  const {getState,api,endpoint,openExtension,navigate}=context;
  let root=null,workspace=null,epoch=0,pageRequest=0,detailRequest=0,catalogRequest=0,openRequest=0;
  let refreshId=null,kind='plans',catalog=[],catalogNext=null,catalogTotal=0,catalogBusy=false;
  let page=null,pageBusy=false,pageHistory=[0],detail=null,detailId=null,detailBusy=false;
  let error='',catalogError='',detailError='',visibleBindings=50,visibleRuns=8,pendingOpen=null;
  const currentWorkspace=()=>getState()?.workspace_key??null;
  const live=(token,ws)=>root&&epoch===token&&workspace===ws&&currentWorkspace()===ws;
  const key=()=> 'upstate.receiving-source-impact/'+workspace;
  function remember(){
    if(!workspace)return;
    try{sessionStorage.setItem(key(),JSON.stringify({refresh_plan_id:refreshId,kind,detail_id:detailId}));}catch{}
  }
  function restore(){
    refreshId=null;kind='plans';detailId=null;
    try{const saved=JSON.parse(sessionStorage.getItem(key())||'null');
      if(id(saved?.refresh_plan_id))refreshId=saved.refresh_plan_id;
      if(['plans','analyses'].includes(saved?.kind))kind=saved.kind;
      if(id(saved?.detail_id))detailId=saved.detail_id;
    }catch{}
  }
  function reset(){
    epoch++;pageRequest++;detailRequest++;catalogRequest++;
    catalog=[];catalogNext=null;catalogTotal=0;page=null;detail=null;
    error='';catalogError='';detailError='';pageHistory=[0];visibleBindings=50;
    catalogBusy=false;pageBusy=false;detailBusy=false;
  }
  async function read(action,values={}){
    const ws=workspace;
    const response=await api(endpoint(API,{workspace:ws,action,...values}));
    if(response?.workspace_key!==ws)throw Error('The response belongs to a different workspace. Reopen this desk.');
    return response;
  }
  function options(){
    const values=[...catalog];
    if(refreshId&&!values.some(row=>row.id===refreshId))values.push({
      id:refreshId,title:page?.refresh?.title||'Selected saved refresh '+refreshId.slice(0,12),state:'selected'
    });
    return '<option value="">Choose a saved Source Updates plan</option>'+values.map(row=>
      '<option value="'+esc(row.id)+'" '+(row.id===refreshId?'selected ':'')+
      (row.error?'disabled ':'')+'>'+esc((row.title||row.id)+' · '+label(row.state))+'</option>').join('');
  }
  function sourceHeader(){
    if(!page)return '';
    const row=page.refresh;
    return '<section class="rw-impact-snapshot"><h3>'+esc(row.title)+'</h3>'+
      '<div class="rw-impact-columns"><div><strong>Original source collection</strong>'+code(row.from_collection_id)+
      esc(row.from_collection?.title||'')+'</div><div><strong>Replacement source collection</strong>'+code(row.to_collection_id)+
      esc(row.to_collection?.title||'')+'</div></div>'+
      note(label(row.engine)+' refresh · '+label(row.state)+(row.phase?' · '+label(row.phase):'')+
           '. Saved reasons and mappings are read as one snapshot; reload to inspect new progress.')+
      ((row.problems||[]).length?'<details><summary>'+row.problems.length+' original refresh issue(s)</summary><ul>'+
        row.problems.map(x=>'<li>'+esc(x.message||JSON.stringify(x))+'</li>').join('')+'</ul></details>':'')+
      ((row.warnings||[]).length?'<details><summary>Original refresh scope</summary><ul>'+
        row.warnings.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>':'')+'</section>';
  }
  function listRows(){
    if(!page)return note(refreshId?'Load the saved impact page to inspect original studies.':'Choose a retained refresh plan to begin.');
    const rows=page.rows||[],errors=page.errors||[];
    const table=rows.length?'<div class="rw-impact-scroll"><table><thead><tr><th>Original study</th><th>Geometry inputs</th><th>Context</th>'+
      (kind==='analyses'?'<th>Native source bindings</th>':'')+'<th>Review</th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong>'+code(row.id)+'<span>'+esc(label(row.state))+'</span></td>'+
        '<td>'+count(row.counts?.consumed_bindings)+' binding(s)<small>'+count(row.counts?.changed_consumed_bindings)+' with saved changes</small></td>'+
        '<td>'+count(row.counts?.context_bindings)+' reference(s)<small>'+count(row.counts?.changed_context_bindings)+' with saved changes</small></td>'+
        (kind==='analyses'?'<td>'+count(row.native_source_bindings)+'<small>'+count(row.recorded_successors)+' recorded successor(s); inspect to check current completion</small></td>':'')+
        '<td>'+button('detail','Inspect','data-id="'+esc(row.id)+'" '+(pageBusy?'disabled':''))+'</td></tr>').join('')+
      '</tbody></table></div>':note('No related studies were found in these '+page.scanned+' inspected records. Continue to the next page when available.');
    return note('Inspected records '+(page.scanned?page.offset+1:0)+'–'+(page.offset+page.scanned)+' of '+page.total_saved+
      ' saved '+kind+'. '+rows.length+' related on this page. These are binding counts, not geographic or numerical effects.')+
      table+(errors.length?'<section class="rw-impact-errors"><h4>Records needing attention</h4>'+note('These records could not be inspected; they are not counted as unrelated.')+
        errors.map(row=>'<p>'+code(row.id)+' '+esc(row.error)+'</p>').join('')+'</section>':'')+
      '<div class="rw-impact-toolbar">'+button('previous','Previous records',pageHistory.length<2||pageBusy?'disabled':'')+
      button('next','Next records',page.next_offset===null||pageBusy?'disabled':'')+'</div>';
  }
  function bindingTable(rows){
    if(!rows.length)return note('No matching original source bindings in this category.');
    const shown=rows.slice(0,visibleBindings);
    return '<div class="rw-impact-scroll"><table><thead><tr><th>Original binding</th><th>Replacement</th><th>Saved change reasons</th></tr></thead><tbody>'+
      shown.map(row=>{
        const change=row.change||{};
        const flags=[['body_changed','Source body'],['companions_changed','Companions'],['native_reader_layout_changed','Native reader layout'],
          ['semantic_metadata_changed','Computational metadata'],['lineage_metadata_changed','Lineage metadata']]
          .filter(([field])=>change[field]).map(([,title])=>title);
        return '<tr><td><strong>'+esc(label(row.role))+'</strong>'+code(row.source_id)+
          '<small>'+esc(row.path)+(row.receptor_id?' · water '+esc(row.receptor_id):'')+'</small></td>'+
          '<td>'+code(row.replacement_source_id)+(row.replacement_source_id===null?'<strong class="rw-impact-unmapped">No replacement selected</strong>':'')+'</td>'+
          '<td><strong>'+esc(label(change.status))+'</strong>'+
          (flags.length?'<p>'+esc(flags.join(' · '))+'</p>':'')+
          '<ul>'+((change.reasons||[]).map(x=>'<li>'+esc(x)+'</li>').join('')||'<li>No additional saved reason</li>')+'</ul>'+
          ((change.changed_metadata_fields||[]).length?'<small>Metadata fields: '+esc(change.changed_metadata_fields.join(', '))+'</small>':'')+
          (change.legacy_reason?'<small>Original roots interpretation: '+esc(change.legacy_reason)+'</small>':'')+
          '<details><summary>Retained source fingerprints and interpretation</summary>'+note(row.interpretation)+
          '<pre>'+esc(JSON.stringify({from:change.from_fingerprint,to:change.to_fingerprint,
            saved_requires_native_rerun:change.requires_native_rerun,
            engine_interpretation:change.engine_interpretation},null,2))+'</pre></details></td></tr>';
      }).join('')+'</tbody></table></div>'+
      (rows.length>shown.length?note('Showing '+shown.length+' of '+rows.length+' bindings in this category.'):'');
  }
  function nativeRuns(record){
    if(kind!=='analyses')return '';
    const check=record.successor_check||{};
    return '<section><h4>Original native runs and recorded successors</h4>'+
      note('Each original run remains attached to this saved analysis. A recorded mapping alone is not completion.')+
      (record.runs||[]).slice(0,visibleRuns).map(run=>'<details><summary>'+esc(label(run.role))+' · '+esc(run.id.slice(0,16))+' · '+
        run.bindings.length+' native source binding(s)</summary>'+code(run.id)+
        note(run.captured_by_refresh?'Included in the saved refresh dependency snapshot.':'This run was not marked affected in the saved refresh snapshot; its current retained dependencies were inspected directly.')+
        bindingTable(run.bindings)+'</details>').join('')+
      ((record.runs||[]).length>visibleRuns?button('more-runs','Show 8 more original run dependencies'):'')+
      '<h4>Current run-selection check</h4>'+note(check.message||'No current check',check.compatible?'rw-impact-pass':'rw-impact-review')+
      note(check.scope||'')+
      '<div class="rw-impact-scroll"><table><thead><tr><th>Original run</th><th>Recorded target / original reuse</th><th>Current record</th></tr></thead><tbody>'+
      (check.runs||[]).map(run=>'<tr><td>'+code(run.original_id)+'</td><td>'+code(run.successor_id)+'</td><td>'+
        '<strong>'+esc(label(run.state))+'</strong>'+note(run.message||(run.reused_original?'Original unchanged run retained.':'Saved refresh target inspected.'))+
        (run.selection?'<details><summary>Exact run selection</summary><pre>'+esc(JSON.stringify(run.selection,null,2))+'</pre></details>':'')+'</td></tr>').join('')+'</tbody></table></div>'+
      note('Open the original analysis to revise its explicit plan, cohort and accounting in Receiving waters. This view does not substitute any run or source.')+'</section>';
  }
  function detailPanel(){
    if(detailBusy)return '<section data-rwi-detail aria-busy="true">'+note('Inspecting the original study and current retained run records…')+'</section>';
    if(detailError)return '<section data-rwi-detail role="alert">'+note(detailError,'rw-impact-error')+button('retry-detail','Retry study inspection')+'</section>';
    if(!detail)return '';
    const record=detail.record,plan=kind==='plans'?record:record.plan,rows=plan.bindings||[];
    const consumed=rows.filter(row=>row.role!=='retained_context'),contextRows=rows.filter(row=>row.role==='retained_context');
    const more=Math.max(consumed.length,contextRows.length,...(record.runs||[]).map(run=>run.bindings.length))>visibleBindings;
    return '<section class="rw-impact-detail" data-rwi-detail data-id="'+esc(record.id)+'" aria-busy="false"><div class="rw-impact-toolbar"><h3>'+esc(record.title)+'</h3>'+
      button('download','Download this impact record')+button('close-detail','Close details')+'</div>'+code(record.id)+
      note('Original '+(kind==='plans'?'plan':'analysis')+' · '+label(record.state)+' · record '+record.record_sha256)+
      '<div class="rw-impact-toolbar">'+button('open-original',kind==='plans'?'Open original plan':'Open original analysis',record.state==='complete'?'':'disabled')+
      (kind==='analyses'?button('open-plan','Open original source plan',plan.state==='complete'?'':'disabled'):'')+'</div>'+
      '<h4>Consumed Receiving geometry sources</h4>'+
      note('Receptor geometry and a HUC network actually used by an upstream relationship. Source changes are review prompts; feature IDs and geographic effects are not inferred across editions.')+
      bindingTable(consumed)+
      '<h4>Retained context and provenance references</h4>'+
      note('Intake, classification, evidence or other nested source references retained by the original selection. A change here is not by itself a requirement to rerun native models.')+
      bindingTable(contextRows)+
      '<details><summary>'+plan.consumed_identities.length+' matching compiled source identity record(s)</summary><pre>'+
      esc(JSON.stringify(plan.consumed_identities,null,2))+'</pre></details>'+
      nativeRuns(record)+(more?button('more-bindings','Show 50 more bindings per category'):'')+'</section>';
  }
  function render(){
    if(!root)return;
    root.innerHTML='<section class="rw-impact" data-receiving-source-impact data-refresh="'+esc(refreshId||'')+'" aria-busy="'+(pageBusy||catalogBusy)+'">'+
      '<header><p class="rw-impact-eyebrow">Source Updates · Receiving waters</p><h2>Receiving source impact</h2>'+
      '<p>Review which saved water studies reference an original source edition before choosing changes in Receiving waters.</p></header>'+
      (!workspace?note('Open an existing workspace to inspect its retained source editions.'):
      '<div class="rw-impact-controls"><label>Saved Source Updates plan<select data-rwi-refresh '+(catalogBusy?'aria-busy="true"':'')+'>'+options()+'</select></label>'+
      button('reload','Reload current records',pageBusy?'disabled':'')+
      (catalogNext!==null?button('more-refresh','Load more saved refresh plans',catalogBusy?'disabled':''):'')+'</div>'+
      (catalogBusy?note('Loading retained refresh plans…'):'')+
      (catalogError?'<div role="alert">'+note(catalogError,'rw-impact-error')+'</div>':'')+
      (!catalogBusy&&!catalog.length&&!refreshId?note('No saved Source Updates plan is available. Save an original/replacement source mapping in Source Updates, then reload here.'):'')+
      '<div class="rw-impact-toolbar" role="group" aria-label="Study kind">'+button('plans','Saved plans','aria-pressed="'+(kind==='plans')+'"')+
      button('analyses','Saved analyses','aria-pressed="'+(kind==='analyses')+'"')+'</div>'+
      (error?'<div role="alert">'+note(error,'rw-impact-error')+button('retry-page','Reload impact page')+'</div>':'')+
      (pageBusy?'<p data-rwi-loading role="status">Reading this bounded page of original studies…</p>':'')+
      sourceHeader()+listRows()+detailPanel())+'</section>';
  }
  async function loadCatalog(append=false){
    if(!workspace||!root)return;
    const token=epoch,ws=workspace,serial=++catalogRequest,offset=append?catalogNext:0;
    if(offset===null)return;
    catalogBusy=true;catalogError='';render();
    try{
      const value=await read('catalog',{offset,limit:25});
      if(!live(token,ws)||serial!==catalogRequest)return;
      const previous=append?catalog:[];
      catalog=[...new Map([...previous,...value.refresh_plans].map(row=>[row.id,row])).values()];
      catalogNext=value.next_offset;catalogTotal=value.total_saved;
    }catch(error){if(live(token,ws)&&serial===catalogRequest)catalogError=error.message||String(error);}
    finally{if(live(token,ws)&&serial===catalogRequest){catalogBusy=false;render();}}
  }
  async function loadPage(offset=0,{fresh=false,keepDetail=false}={}){
    if(!root||!workspace||!refreshId)return;
    const token=epoch,ws=workspace,serial=++pageRequest,selected=refreshId,selectedKind=kind;
    const retained=keepDetail?detailId:null;
    detailRequest++;detail=null;detailId=null;detailError='';detailBusy=false;
    pageBusy=true;error='';render();
    const values={refresh_plan_id:selected,kind:selectedKind,offset,limit:10};
    if(!fresh&&page?.refresh?.id===selected&&page.kind===selectedKind){
      values.snapshot=page.refresh.snapshot;values.index_snapshot=page.index_snapshot;
    }
    try{
      const value=await read('page',values);
      if(!live(token,ws)||serial!==pageRequest||refreshId!==selected||kind!==selectedKind)return;
      page=value;pageBusy=false;remember();render();
      if(retained)await loadDetail(retained);
    }catch(e){
      if(live(token,ws)&&serial===pageRequest){error=e.message||String(e);page=null;}
    }finally{if(live(token,ws)&&serial===pageRequest){pageBusy=false;render();}}
  }
  async function loadDetail(key){
    if(!id(key)||!page||pageBusy)return;
    const token=epoch,ws=workspace,serial=++detailRequest,selected=refreshId,selectedKind=kind,snapshot=page.refresh.snapshot;
    detailId=key;detail=null;detailError='';detailBusy=true;visibleBindings=50;visibleRuns=8;remember();render();
    try{
      const value=await read('detail',{refresh_plan_id:selected,kind:selectedKind,id:key,snapshot});
      if(!live(token,ws)||serial!==detailRequest||refreshId!==selected||kind!==selectedKind)return;
      detail=value;
    }catch(e){if(live(token,ws)&&serial===detailRequest)detailError=e.message||String(e);}
    finally{if(live(token,ws)&&serial===detailRequest){detailBusy=false;render();}}
  }
  async function download(){
    if(!detail||!page||pageBusy)return;
    const token=epoch,ws=workspace,selected=detail,serial=detailRequest;
    const value=await read('download',{refresh_plan_id:refreshId,kind,id:selected.record.id,snapshot:selected.refresh_snapshot});
    if(!live(token,ws)||detail!==selected||serial!==detailRequest)return;
    if(typeof value.content!=='string')throw Error('The retained impact download is unavailable.');
    const url=URL.createObjectURL(new Blob([value.content],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=value.filename;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function dispatch(action,node){
    if(currentWorkspace()!==workspace)return;
    if(action==='reload'){pageHistory=[0];await loadCatalog();await loadPage(0,{fresh:true,keepDetail:true});}
    else if(action==='more-refresh')await loadCatalog(true);
    else if(action==='retry-page'){pageHistory=[0];await loadPage(0,{fresh:true});}
    else if(action==='plans'||action==='analyses'){
      if(kind===action)return;kind=action;page=null;pageHistory=[0];detail=null;detailId=null;detailRequest++;remember();render();
      await loadPage(0,{fresh:true});
    }else if(action==='next'&&page?.next_offset!==null&&!pageBusy){pageHistory.push(page.next_offset);await loadPage(page.next_offset);}
    else if(action==='previous'&&pageHistory.length>1&&!pageBusy){pageHistory.pop();await loadPage(pageHistory.at(-1));}
    else if(action==='detail')await loadDetail(node.dataset.id);
    else if(action==='retry-detail')await loadDetail(detailId);
    else if(action==='close-detail'){detailRequest++;detail=null;detailId=null;detailError='';detailBusy=false;remember();render();}
    else if(action==='more-bindings'){visibleBindings+=50;render();}
    else if(action==='more-runs'){visibleRuns+=8;render();}
    else if(action==='download')await download();
    else if((action==='open-original'||action==='open-plan')&&detail){
      const record=detail.record,plan=kind==='plans'?record:record.plan;
      const method=action==='open-plan'||kind==='plans'?'openPlan':'openAnalysis';
      const chosen=action==='open-plan'?plan:record;
      if(chosen.state!=='complete')throw Error('Complete the original study before opening its revision workflow.');
      await openExtension('receiving-waters',method,{workspace_key:workspace,id:chosen.id});
    }
  }
  function click(event){
    const button=event.target.closest('[data-rwi-action]');
    if(!button||!root?.contains(button)||button.disabled)return;
    event.preventDefault();event.stopPropagation();
    const token=epoch,ws=workspace;
    Promise.resolve(dispatch(button.dataset.rwiAction,button)).catch(e=>{
      if(live(token,ws)){error=e.message||String(e);render();}
    });
  }
  function change(event){
    if(!event.target.matches('[data-rwi-refresh]'))return;
    openRequest++;pendingOpen=null;
    refreshId=id(event.target.value)?event.target.value:null;
    pageRequest++;detailRequest++;page=null;detail=null;detailId=null;pageHistory=[0];error='';detailError='';pageBusy=false;detailBusy=false;
    remember();render();if(refreshId)void loadPage(0,{fresh:true});
  }
  async function mount(target){
    if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);}
    reset();root=target;workspace=currentWorkspace();restore();
    const token=epoch,ws=workspace;
    if(pendingOpen?.workspace_key===ws){refreshId=pendingOpen.refresh_plan_id;kind='plans';detailId=null;remember();}
    root.addEventListener('click',click);root.addEventListener('change',change);render();
    await loadCatalog();
    if(live(token,ws)&&refreshId)await loadPage(0,{fresh:true,keepDetail:true});
  }
  function update(){
    if(!root||currentWorkspace()===workspace)return;
    void mount(root);
  }
  function detach(){
    if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);}
    reset();root=null;
  }
  async function openForRefresh(value){
    const ws=currentWorkspace(),opening=++openRequest;
    if(!ws||value?.workspace_key!==ws||!id(value?.refresh_plan_id))throw Error('Open the saved refresh in its original workspace.');
    // openExtension instantiates a controller but does not itself navigate.
    if(workspace!==ws){workspace=ws;reset();}
    pendingOpen={workspace_key:ws,refresh_plan_id:value.refresh_plan_id};
    refreshId=value.refresh_plan_id;kind='plans';detailId=null;page=null;pageHistory=[0];remember();
    await navigate(VIEW);
    if(currentWorkspace()!==ws)throw Error('The workspace changed while opening source impact.');
    if(opening!==openRequest||refreshId!==value.refresh_plan_id)return {abandoned:true};
    if(root&&(!page||page.refresh.id!==refreshId))await loadPage(0,{fresh:true});
    pendingOpen=null;
    return {workspace_key:ws,refresh_plan_id:refreshId};
  }
  return {mount,update,detach,openForRefresh};
}
