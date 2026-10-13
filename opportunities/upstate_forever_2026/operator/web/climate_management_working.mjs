/** Raw Climate Management controls and immutable native working-history interaction. */
export const DRAFT_SCHEMA='upstate.climate-management-working-draft/v1';
export const HISTORY_SCHEMA='upstate.climate-management-working-history/v1';
export const RECOVERY_SCHEMA='upstate.climate-management-working-recovery/v1';
const copy=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
export const sameWorking=(a,b)=>canonical(a)===canonical(b);
const text=value=>typeof value==='string';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const selectionFields=['title','purpose','reference_period_id','periods','reporting_areas','difference_maps'];
const uid=()=>crypto.randomUUID();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,attrs='')=>'<button type="button" data-cm="working-'+action+'" '+attrs+'>'+esc(label)+'</button>';
export function validateManagementDraft(value){
  if(!keys(value,['schema','selection'])||value.schema!==DRAFT_SCHEMA||!keys(value.selection,selectionFields))
    throw Error('Open a complete Management working design with every original raw control.');
  const s=value.selection;
  if(!['title','purpose','reference_period_id'].every(k=>text(s[k]))||typeof s.difference_maps!=='boolean'||!Array.isArray(s.periods)||!Array.isArray(s.reporting_areas))
    throw Error('The working design lost its raw fields.');
  for(const p of s.periods){
    if(!p||typeof p!=='object'||Array.isArray(p)||!['id','label','reference','treatment'].every(k=>Object.hasOwn(p,k))||
       Object.keys(p).some(k=>!['id','label','reference','treatment','control'].includes(k))||!text(p.id)||!text(p.label))
      throw Error('The working design lost an original period or role.');
    for(const role of ['reference','treatment','control'])if(Object.hasOwn(p,role))
      if(!keys(p[role],['study_id','case_id'])||!text(p[role].study_id)||!text(p[role].case_id))
        throw Error('Retain both original study and case controls for every role.');
  }
  for(const area of s.reporting_areas)
    if(!area||!['source_collection_id','source_id','name'].every(k=>text(area[k]))||
       Object.keys(area).some(k=>!['source_collection_id','source_id','name','layer','where'].includes(k))||
       (Object.hasOwn(area,'layer')&&!text(area.layer)))throw Error('The working design lost an original reporting-area field.');
  return copy(value);
}
function packetRecord(packet){
  if(!packet||packet.schema!==HISTORY_SCHEMA||!Array.isArray(packet.records)||!packet.records.length)
    throw Error('Open the complete original working history.');
  const row=packet.records.at(-1);
  if(row.id!==packet.revision_id||!text(row.series_id)||!text(row.name)||!text(row.author))
    throw Error('The history lost its selected original revision.');
  validateManagementDraft(row.draft);return row;
}
function fresh(raw){
  return {schema:RECOVERY_SCHEMA,series_id:uid(),parent_id:null,forked_from:null,
    name:'',author:'',note:'',raw:validateManagementDraft(raw),package:null,imported_package:null,request:null};
}
export function validateManagementRecovery(value,workspace){
  if(!value||value.schema!==RECOVERY_SCHEMA||!text(value.series_id)||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.series_id)||
      !['name','author','note'].every(k=>text(value[k])))throw Error('Open a complete unfinished Climate Management recovery file.');
  validateManagementDraft(value.raw);
  if(value.package)packetRecord(value.package);
  if(value.imported_package)packetRecord(value.imported_package);
  if(value.request){
    const r=value.request,p=r.payload;
    if(r.workspace!==workspace||r.action!=='climate-management.working.save'||!text(r.operation_id)||!r.operation_id||
       !p||p.series_id!==value.series_id||!text(p.request_id)||!p.request_id)
      throw Error('Recover the pending original save in its original workspace.');
    validateManagementDraft(p.draft);
  }
  return copy(value);
}
function download(filename,value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function createManagementWorking(host){
  let current=null,recoveries=[],heads=[],view=null,readVersion=0;
  const raw=()=>({schema:DRAFT_SCHEMA,selection:copy(host.getDraft())});
  function ensure(){if(!current)current=fresh(raw());return current;}
  function capture(){ensure().raw=validateManagementDraft(raw());return current;}
  function snapshot(){capture();return {current:copy(current),recoveries:copy(recoveries)};}
  function restore(value){
    current=null;recoveries=[];heads=[];view=null;readVersion++;
    if(!value)return;
    current=validateManagementRecovery(value.current,host.workspace());
    recoveries=(value.recoveries||[]).map(row=>validateManagementRecovery(row,host.workspace()));
    if(!sameWorking(current.raw,raw()))throw Error('The browser recovery and original raw controls differ.');
  }
  function stash(){
    const row=copy(capture()),at=recoveries.findIndex(x=>x.series_id===row.series_id);
    if(at<0)recoveries.push(row);else recoveries[at]=row;
  }
  function reset(retain=true){if(retain)stash();current=fresh(raw());view=null;readVersion++;}
  function clear(){current=null;recoveries=[];heads=[];view=null;readVersion++;}
  function origin(){
    const row=capture();
    if(row.imported_package)throw Error('Save this imported history as a new branch before scientific preview.');
    if(!row.package)return null;
    const original=packetRecord(row.package);
    if(!sameWorking(original.draft,row.raw))throw Error('Save the changed working revision before previewing its scientific design.');
    return {revision_id:original.id};
  }
  function changed(el){
    if(!el.matches('[data-working-field]'))return false;
    ensure()[el.dataset.workingField]=el.value;host.persist();return true;
  }
  function catalogue(rows){heads=Array.isArray(rows)?rows:[];}
  function markup(){
    const row=ensure(),original=row.package?packetRecord(row.package):null;
    const status=row.request?'An original save is retained. Reconcile it or inspect its task before continuing this branch.':
      original&&sameWorking(row.raw,raw())&&sameWorking(original.draft,raw())?'Current fields match saved revision '+original.revision+'.':
      'Unfinished raw values can be saved even when scientific preview is not yet valid.';
    return '<section><h2>Working design</h2><p>'+esc(status)+'</p>'+
      '<div class="cm-columns"><label>Design name<input data-working-field="name" value="'+esc(row.name)+'"></label>'+
      '<label>Author<input data-working-field="author" autocomplete="name" value="'+esc(row.author)+'"></label></div>'+
      '<label>Revision note<textarea data-working-field="note" rows="2">'+esc(row.note)+'</textarea></label>'+
      '<div class="cm-actions">'+button('save','Save working revision')+button('fork','Save as new branch')+
      button('recovery','Download unfinished recovery')+(row.request?button('retry','Reconcile original save'):'')+
      (original?button('export','Export complete saved history')+button('study','Export editable working Study'):'')+'</div>'+
      '<p class="cm-meta">A saved revision retains blank controls, exact original forcing studies, scenario-role mappings and reporting-source editions. Scientific preview still validates the completed design. Download a recovery before closing if browser storage is unavailable.</p>'+
      '<details'+(view?' open':'')+'><summary>Open saved designs, original revisions and browser recoveries</summary>'+
      (heads.length?'<ul>'+heads.map(x=>'<li>'+esc(x.name)+' · revision '+esc(x.revision)+' · '+esc(x.author)+' '+
        button('open','Open original revision','data-revision="'+esc(x.id)+'"')+
        button('history','Review complete history','data-revision="'+esc(x.id)+'"')+'</li>').join('')+'</ul>':'<p>No named working revisions have been retained in this workspace.</p>')+
      (view?'<h3>'+esc(view.record.name)+' — complete history</h3><ul>'+view.history.map(x=>'<li>'+esc(x.name)+' · '+esc(x.author)+' · revision '+esc(x.revision)+' · '+esc(x.note)+' '+
        button('open','Restore original revision','data-revision="'+esc(x.id)+'"')+'</li>').join('')+'</ul>':'')+
      (recoveries.length?'<h3>Unfinished browser recoveries</h3><ul>'+recoveries.map((x,index)=>'<li>'+esc(x.name||'Unnamed design')+(x.request?' · original save retained':'')+' '+
        button('restore','Restore raw fields','data-recovery="'+index+'"')+'</li>').join('')+'</ul>':'')+
      '<label>Open a working history or unfinished recovery<input type="file" data-working-import accept=".json,application/json"></label>'+
      '<p>Imported histories open as explicit new branches. Saving checks all original forcing-study and reporting-source bindings. A JSON history alone does not contain the raster sources; use editable Study delivery to carry them.</p></details></section>';
  }
  function apply(row){
    stash();current=copy(row);view=null;readVersion++;
    host.setDraft(validateManagementDraft(current.raw).selection);host.persist();host.render();
  }
  async function readRevision(revisionId,open){
    const token=host.token(),version=++readVersion,before=copy(raw()),selectedSeries=ensure().series_id,attribution=[current.name,current.author,current.note];
    const packet=await host.read('working-view',{id:revisionId});
    if(!host.current(token)||version!==readVersion)return null;
    if(!sameWorking(before,raw())||selectedSeries!==ensure().series_id||!sameWorking(attribution,[current.name,current.author,current.note]))throw Error('The unfinished design changed while history was loading. Open the revision again to restore it.');
    if(packet?.record?.id!==revisionId||packet?.workspace_key!==host.workspace()||packet.package?.revision_id!==revisionId)
      throw Error('The operator returned a different original working revision.');
    const original=packetRecord(packet.package);
    if(!sameWorking(original,packet.record))throw Error('The working record differs from its complete history.');
    if(open){
      const next={...fresh(original.draft),series_id:original.series_id,parent_id:original.id,
        name:original.name,author:original.author,package:packet.package};
      apply(next);
    }else {view=packet;host.render();}
    return packet;
  }
  function settle(task){
    if(task.action!=='climate-management.working.save'||task.state!=='complete')return false;
    const all=[ensure(),...recoveries],row=all.find(x=>x.request?.payload?.request_id===task.payload?.request_id);
    if(!row)return false;
    const request=row.request,payload=request.payload,packet=task.result,record=packet?.record;
    if(task.workspace!==request.workspace||!sameWorking(task.payload,payload)||packet?.workspace_key!==request.workspace||
       record?.request_id!==payload.request_id||record?.series_id!==payload.series_id||!sameWorking(record?.draft,payload.draft)||
       packet?.package?.revision_id!==record?.id||!sameWorking(packetRecord(packet.package),record))
      throw Error('The accepted working save differs from its original request.');
    row.package=copy(packet.package);row.parent_id=record.id;row.forked_from=null;row.imported_package=null;row.request=null;
    if(row===current)row.raw=validateManagementDraft(raw()); // Preserve edits made while the request was in flight.
    return true;
  }
  async function save(fork){
    capture();
    if(fork){
      const previous=copy(current);stash();
      current={...previous,series_id:uid(),parent_id:null,forked_from:previous.package?.revision_id||previous.forked_from,request:null};
    }else if(current.request)throw Error('Reconcile the retained original save before another save in this branch.');
    if(!current.name.trim()||!current.author.trim())throw Error('Enter a design name and author before saving.');
    const payload={request_id:uid(),series_id:current.series_id,parent_id:current.parent_id,forked_from:current.forked_from,
      name:current.name,author:current.author,note:current.note,draft:copy(current.raw),imported_package:copy(current.imported_package)};
    current.request={workspace:host.workspace(),action:'climate-management.working.save',payload,operation_id:uid()};
    host.persist();host.render();
    await host.send(copy(current.request));
  }
  async function importFile(file){
    const token=host.token(),version=++readVersion,before=copy(raw()),series=ensure().series_id,attribution=[current.name,current.author,current.note];
    const value=JSON.parse(await file.text());
    if(!host.current(token)||version!==readVersion)return;
    if(!sameWorking(before,raw())||series!==ensure().series_id||!sameWorking(attribution,[current.name,current.author,current.note]))throw Error('The unfinished design changed while the file was opening. Open the file again.');
    let row;
    if(value.schema===RECOVERY_SCHEMA)row=validateManagementRecovery(value,host.workspace());
    else if(value.schema===DRAFT_SCHEMA)row=fresh(validateManagementDraft(value));
    else {
      const original=packetRecord(value);
      row={...fresh(original.draft),name:original.name,author:original.author,package:copy(value),
        imported_package:copy(value),forked_from:original.id};
    }
    if(row.package&&!row.request)
      row={...row,series_id:uid(),parent_id:null,forked_from:row.package.revision_id,imported_package:copy(row.package)};
    apply(row);
  }
  async function action(action,el){
    if(!action.startsWith('working-'))return false;
    const name=action.slice(8);
    if(name==='save'||name==='fork')await save(name==='fork');
    else if(name==='retry'){if(!ensure().request)throw Error('No working save awaits reconciliation.');await host.send(copy(current.request));}
    else if(name==='recovery')download('climate-management-working-recovery-'+ensure().series_id+'.json',copy(capture()));
    else if(name==='open'||name==='history')await readRevision(el.dataset.revision,name==='open');
    else if(name==='restore'){const row=recoveries[Number(el.dataset.recovery)];if(!row)throw Error('Select an original browser recovery.');apply(copy(row));}
    else if(name==='export'){const row=packetRecord(ensure().package);await host.submit('climate-management.working.export',{revision_id:row.id});}
    else if(name==='study'){const row=packetRecord(ensure().package);await host.openStudy({kind:'climate-management-working',id:row.id,title:row.name,state:'working'});}
    else throw Error('Choose a working-design action.');
    return true;
  }
  return {snapshot,restore,clear,reset,stash,capture,origin,changed,catalogue,markup,settle,action,importFile,
    openRevision:id=>readRevision(id,true)};
}
