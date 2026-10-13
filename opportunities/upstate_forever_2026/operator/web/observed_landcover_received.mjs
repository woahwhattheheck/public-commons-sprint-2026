/** Exact selected-watershed source cards in the original received Study view. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const quantity=(value,digits=3)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:digits}):'Not available';
const key=value=>JSON.stringify([value?.source_collection_id,value?.source_id]);
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="landcover-'+action+'" data-landcover-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
function downloads(rows,title){
  const items=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  return '<details class="st-details"><summary>'+esc(title)+'</summary><ul class="st-received-files">'+
    items.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+
      '</a><small> '+quantity(row.bytes,0)+' B</small></li>').join('')+'</ul></details>';
}
function measures(summary){
  return '<dl><dt>Paired-valid area</dt><dd>'+quantity(summary?.paired_valid_area_ha)+' ha</dd>'+
    '<dt>Changed land-cover class area</dt><dd>'+quantity(summary?.changed_area_ha)+' ha</dd>'+
    '<dt>Changed share of paired-valid cells</dt><dd>'+quantity(summary?.changed_percent_of_paired_valid)+
    (typeof summary?.changed_percent_of_paired_valid==='number'?'%':'')+'</dd>'+
    '<dt>Paired-valid cells</dt><dd>'+quantity(summary?.paired_valid_cells,0)+'</dd>'+
    '<dt>Changed-class cells</dt><dd>'+quantity(summary?.changed_class_cells,0)+'</dd></dl>';
}
const copyAction='received.landcover.copy';
const pendingCopies=new Map(),activeCopies=new Map();
const pendingKey=(workspace,study,source)=>'upstate-received-landcover-copy:'+JSON.stringify([workspace,study,key(source)]);
function retainedCopy(workspace,study,source){
  const storageKey=pendingKey(workspace,study,source);
  if(pendingCopies.has(storageKey))return pendingCopies.get(storageKey);
  try{
    const value=JSON.parse(globalThis.sessionStorage?.getItem(storageKey)||'null');
    if(value?.workspace===workspace&&value?.study_id===study&&key(value?.source)===key(source)&&
       value?.body?.action===copyAction&&typeof value.body.operation_id==='string'){
      pendingCopies.set(storageKey,value);return value;
    }
  }catch{}
  return null;
}
function keepCopy(storageKey,value){
  if(value)pendingCopies.set(storageKey,value);else pendingCopies.delete(storageKey);
  try{if(value)globalThis.sessionStorage?.setItem(storageKey,JSON.stringify(value));
      else globalThis.sessionStorage?.removeItem(storageKey);}catch{}
}
function operationID(){
  if(globalThis.crypto?.randomUUID)return 'received-lc-'+globalThis.crypto.randomUUID();
  throw Error('Use the maintained secure browser to create a local comparison.');
}
function localControls(detail,row,index,disabled){
  let html='';
  const local=list(row.local_copies);
  if(local.length)html+='<div class="st-local-copies"><h5>Local editable copies</h5><ul>'+
    local.map((copy,n)=>'<li><span>'+esc(copy.title)+' <small>'+esc(copy.created_at)+'</small></span>'+
      '<button type="button" data-received-action="landcover-local-open" data-landcover-source="'+index+
      '" data-landcover-copy="'+n+'" '+(disabled?'disabled':'')+'>Open local comparison</button></li>').join('')+'</ul></div>';
  if(row.native)return html;
  const pending=retainedCopy(detail.workspace_key,detail.id,row.source);
  const title=pending?.body?.payload?.title||('Local copy: '+row.title).slice(0,200);
  html+='<div class="st-local-copy"><label>Title for a new local editable comparison'+
    '<input data-landcover-copy-title="'+index+'" type="text" maxlength="200" value="'+esc(title)+'" '+
    (disabled||pending?'disabled':'')+'></label><p>The complete original analysis and both annual inventories are retained. Creating a local copy saves a new comparison in this project and links it to the original received report.</p>'+
    '<div class="st-actions">'+button('copy',pending?'Continue local copy':'Create local editable comparison',index,disabled)+
    (pending?.task_id?button('copy-task','Open copy task',index,disabled):'')+'</div>'+
    '<p data-landcover-copy-status="'+index+'" role="status" aria-live="polite"></p></div>';
  return html;
}
async function copyToLocal(host,detail,row,index,target,{workspace_key,current}){
  const storageKey=pendingKey(workspace_key,detail.id,row.source);
  const active=activeCopies.get(storageKey);
  if(active?.current())return active.promise;
  const work=(async()=>{
    const card=target.closest?.('.st-received-source');
    const status=card?.querySelector('[data-landcover-copy-status="'+index+'"]');
    const titleInput=card?.querySelector('[data-landcover-copy-title="'+index+'"]');
    const say=text=>{if(current()&&status?.isConnected!==false)status.textContent=text;};
    let retained=retainedCopy(workspace_key,detail.id,row.source);
    target.disabled=true;
    try{
      if(!retained){
        const title=String(titleInput?.value||'').trim();
        if(!title||title.length>200)throw Error('Enter a local comparison title of at most 200 characters.');
        const payload={study_id:detail.id,...row.source,source_body_sha256:row.source_body_sha256,title};
        say('Verifying all original analysis and annual input records…');
        const prepared=await host.api('/api/received-landcover-copy/preview?'+
          new URLSearchParams({workspace:workspace_key,...payload}));
        if(!current())return;
        if(!id(prepared.id)||prepared.project_id!==detail.project.id||
           key(prepared.source)!==key(row.source)||prepared.source_body_sha256!==row.source_body_sha256)
          throw Error('The local-copy preview returned another project or original source.');
        if(prepared.existing_copy){
          await openLocalCopy(host,prepared.existing_copy,detail,row,{workspace_key,current});
          return;
        }
        retained={workspace:workspace_key,study_id:detail.id,source:{...row.source},
          body:{workspace:workspace_key,action:copyAction,payload:{...payload,copy_id:prepared.id},
                operation_id:operationID()}};
        keepCopy(storageKey,retained);
      }
      if(retained.body.workspace!==workspace_key||retained.body.payload.study_id!==detail.id||
         key(retained.body.payload)!==key(row.source)||
         retained.body.payload.source_body_sha256!==row.source_body_sha256)
        throw Error('The retained local-copy request belongs to another original source.');
      if(titleInput)titleInput.disabled=true;
      say('Creating the local comparison through the original task queue…');
      let task=retained.task_id
        ?await host.api('/api/task?id='+encodeURIComponent(retained.task_id))
        :await host.api('/api/actions',{method:'POST',body:retained.body});
      const checkTask=value=>{
        const expected=retained.body.payload,actual=value?.payload;
        if(!id(value?.id)||value.workspace!==workspace_key||value.action!==copyAction||
           !actual||Object.keys(actual).length!==Object.keys(expected).length||
           Object.entries(expected).some(([name,value])=>actual[name]!==value))
          throw Error('The native queue returned another local-copy request.');
      };
      checkTask(task);
      retained={...retained,task_id:task.id,accepted_operation_id:task.operation_id,state:task.state};
      keepCopy(storageKey,retained);
      const deadline=Date.now()+120000;
      while(current()&&['queued','running'].includes(task.state)&&Date.now()<deadline){
        say(task.state==='queued'?'Local comparison is queued.':'Retaining original inputs and saving the local comparison…');
        await new Promise(resolve=>setTimeout(resolve,600));
        if(!current())return;
        task=await host.api('/api/task?id='+encodeURIComponent(retained.task_id));
        checkTask(task);
        retained={...retained,state:task.state};keepCopy(storageKey,retained);
      }
      if(!current())return;
      if(['queued','running'].includes(task.state)){
        say('The original copy task is still '+task.state+'. Continue this same request to reopen its result.');
        return;
      }
      if(task.state!=='complete'){
        say('The original task is '+task.state+'. Open its retained task to inspect or resume the same operation.');
        if(typeof host.showTask==='function')await host.showTask(task.id);
        throw Error(task.error?.message||'The original local-copy task is '+task.state+'.');
      }
      if(task.result?.id!==retained.body.payload.copy_id)throw Error('The completed task returned another local admission.');
      const result=await host.api('/api/received-landcover-copy/copy?'+new URLSearchParams({
        workspace:workspace_key,id:task.result.id}));
      if(!current())return;
      await openLocalCopy(host,result,detail,row,{workspace_key,current});
      keepCopy(storageKey,null);
    }catch(error){
      if(retained&&!retained.task_id&&error?.status>=400&&error.status<500)keepCopy(storageKey,null);
      if(current())say(error?.message||String(error));
      throw error;
    }finally{
      if(current()){target.disabled=false;if(titleInput)titleInput.disabled=!!retainedCopy(workspace_key,detail.id,row.source);}
    }
  })();
  const activeEntry={promise:work,current};activeCopies.set(storageKey,activeEntry);
  try{return await work;}finally{if(activeCopies.get(storageKey)===activeEntry)activeCopies.delete(storageKey);}
}
async function openLocalCopy(host,copy,detail,row,{workspace_key,current}){
  if(copy?.project_id!==detail.project.id||key(copy.original_source)!==key(row.source)||
     copy.original_selection_id!==row.selection_id||!id(copy.local_selection_id))
    throw Error('The local editable comparison differs from this received source.');
  if(typeof host.openExtension!=='function')throw Error('Use the maintained Observed watershed change desk.');
  if(!current())return;
  await host.openExtension('observed-landcover','openSaved',copy.local_selection_id);
}

export function receivedObservedLandcoverHTML(detail,disabled=false){
  const rows=list(detail?.observed_landcover_sources);
  if(!rows.length)return '';
  return '<section class="st-received-landcover" aria-label="Selected watershed land-cover sources"><h4>Selected watershed land-cover comparisons</h4>'+
    rows.map((row,index)=>{
      const years=row.source_binding?.rasters||{},summary=row.summary||{},hucs=list(row.selection?.huc12s);
      let html='<article class="st-received-source"><h4>'+esc(row.title)+'</h4>'+
        '<p>Original annual land cover '+esc(years.before?.year)+' → '+esc(years.after?.year)+
        ' · '+hucs.length+' selected watersheds</p>'+measures(summary)+
        '<p>Areas use original cell-centre counts and the source grid’s affine cell area. Counts from selected non-overlapping watersheds are added before percentages are computed. NoData and single-year-only support stay separate.</p>'+
        '<details class="st-details"><summary>Selected watersheds and original support</summary>'+
        '<div class="st-table-scroll" tabindex="0" role="region" aria-label="Selected watershed support table"><table class="st-table">'+
        '<thead><tr><th scope="col">Original HUC12</th><th scope="col">Name</th><th scope="col">Paired-valid cells</th>'+
        '<th scope="col">Changed-class cells</th><th scope="col">Changed share of paired-valid cells (%)</th></tr></thead><tbody>'+
        list(row.watersheds).map(item=>'<tr><th scope="row">'+esc(item.huc12)+'</th><td>'+esc(item.properties?.name||'')+
          '</td><td>'+quantity(item.summary?.paired_valid_cells,0)+'</td><td>'+quantity(item.summary?.changed_class_cells,0)+
          '</td><td>'+quantity(item.summary?.changed_percent_of_paired_valid)+'</td></tr>').join('')+'</tbody></table></div>'+
        '<dl><dt>Valid only in the earlier year</dt><dd>'+quantity(summary.valid_before_only_cells,0)+' cells</dd>'+
        '<dt>Valid only in the later year</dt><dd>'+quantity(summary.valid_after_only_cells,0)+' cells</dd>'+
        '<dt>NoData in both years</dt><dd>'+quantity(summary.both_nodata_cells,0)+' cells</dd></dl></details>';
      html+='<div class="st-actions">'+(row.native?button('open','Open saved watershed comparison',index,disabled):'')+
        button('compose','Add source to report',index,disabled)+button('source','Open original source edition',index,disabled)+'</div>';
      if(!row.native)html+='<p>This source comes from another original project. Its captured selection, matrices and original input documents are available below.</p>';
      html+=localControls(detail,row,index,disabled);
      html+='<details class="st-details"><summary>Source identities and interpretation</summary><p>'+esc(row.interpretation)+'</p><dl>'+
        '<dt>Original project</dt><dd><code>'+esc(row.source_project_id)+'</code></dd>'+
        '<dt>Saved comparison</dt><dd><code>'+esc(row.selection_id)+'</code></dd>'+
        '<dt>Analysis SHA256</dt><dd><code>'+esc(row.source_binding?.analysis_sha256)+'</code></dd>'+
        '<dt>Original domain SHA256</dt><dd><code>'+esc(row.source_binding?.source_domain_sha256)+'</code></dd>'+
        '<dt>Earlier raster SHA256</dt><dd><code>'+esc(years.before?.sha256)+'</code></dd>'+
        '<dt>Later raster SHA256</dt><dd><code>'+esc(years.after?.sha256)+'</code></dd>'+
        '<dt>Source report SHA256</dt><dd><code>'+esc(row.source_body_sha256)+'</code></dd></dl></details>';
      if(row.native)html+=downloads(row.native._downloads,'Complete saved comparison files');
      html+=downloads(row._downloads,'Captured source and original input documents');
      for(const report of list(detail.reports).filter(item=>list(row.report_ids).includes(item.id)))
        html+=downloads(report._downloads,'Saved scientific report: '+report.title);
      return html+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedObservedLandcover(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('landcover-'))return false;
  const index=Number(target.dataset.landcoverSource);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.observed_landcover_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its receiving Workspace.');
  const source=row.source,sourceKey=key(source);
  if(!id(source?.source_collection_id)||typeof source?.source_id!=='string'||!source.source_id)
    throw Error('Choose the retained original watershed source.');
  if(action==='landcover-copy'){
    if(row.native||row.relationship!=='external_project')throw Error('Open this project’s original saved comparison.');
    return await copyToLocal(host,detail,row,index,target,{workspace_key,current}),true;
  }
  if(action==='landcover-copy-task'){
    const retained=retainedCopy(workspace_key,detail.id,row.source);
    if(!id(retained?.task_id))throw Error('Queue this exact original local-copy request first.');
    if(typeof host.showTask!=='function')throw Error('Open the original task queue.');
    if(current())await host.showTask(retained.task_id);
    return true;
  }
  if(action==='landcover-local-open'){
    const n=Number(target.dataset.landcoverCopy);
    const copy=Number.isSafeInteger(n)&&n>=0?list(row.local_copies)[n]:null;
    await openLocalCopy(host,copy,detail,row,{workspace_key,current});
    return true;
  }
  if(action==='landcover-open'){
    if(!row.native||!id(row.native.id)||row.native.id!==row.selection_id)
      throw Error('Open the captured source files for this external original project.');
    if(typeof host.openExtension!=='function')throw Error('Use the maintained Observed watershed change desk.');
    if(!current()||key(row.source)!==sourceKey)return true;
    await host.openExtension('observed-landcover','openSaved',row.native.id);
    return true;
  }
  if(action==='landcover-compose'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained Scientific Reports composer.');
    if(!current()||key(row.source)!==sourceKey)return true;
    await host.openScientificReport({workspace_key,sources:[{...source}],title:row.title});
    return true;
  }
  if(action==='landcover-source'){
    if(typeof host.openItem!=='function')throw Error('Use the maintained original source catalogue.');
    if(!current()||key(row.source)!==sourceKey)return true;
    await host.openItem('sources',source.source_collection_id);
    return true;
  }
  throw Error('Choose an original selected-watershed source action.');
}
