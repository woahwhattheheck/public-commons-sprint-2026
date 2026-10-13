/** Lossless unfinished Parameter controls and native named working revisions. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const schema='upstate.parameter-working-draft/v1';
const recoverySchema='upstate.parameter-working-recovery/v1';
const fields=['experiment_title','experiment_purpose','experiment_design','baseline_run_id'];
const axisFields=['axis_name','axis_values','axis_reason','axis_references'];
const areaFields=['area_name','area_collection','area_source','area_layer','area_where'];
const button=(action,label,extra='')=>'<button type="button" data-action="parameter-study-working-'+action+'" '+extra+'>'+esc(label)+'</button>';
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=()=>crypto.randomUUID();

export function captureParameterWorking(root,calibrationOrigin=null){
  const values=(node,names)=>Object.fromEntries(names.map(name=>[name,node.querySelector('[name="'+name+'"]').value]));
  return {schema,fields:values(root,fields),
    axes:[...root.querySelectorAll('.parameter-study-axis')].map(node=>({...values(node,axisFields),
      axis_parameters:[...node.querySelector('[name="axis_parameters"]').selectedOptions].map(item=>item.value)})),
    areas:[...root.querySelectorAll('.parameter-study-area')].map(node=>values(node,areaFields)),
    difference_maps:root.querySelector('[name="difference_maps"]').checked,
    calibration_origin:copy(calibrationOrigin)};
}

export function validateParameterWorking(value){
  if(!value||value.schema!==schema||!value.fields||!Array.isArray(value.axes)||!Array.isArray(value.areas)||
      typeof value.difference_maps!=='boolean'||!(value.calibration_origin===null||typeof value.calibration_origin==='object'&&!Array.isArray(value.calibration_origin)))
    throw Error('Open a complete Parameter working design.');
  const textFields=(row,names)=>names.every(name=>typeof row?.[name]==='string');
  if(!textFields(value.fields,fields)||value.axes.some(row=>!textFields(row,axisFields)||
      !Array.isArray(row.axis_parameters)||row.axis_parameters.some(item=>typeof item!=='string'))||
      value.areas.some(row=>!textFields(row,areaFields)))throw Error('The working file lost an original raw field.');
  return copy(value);
}

export function applyParameterWorking(root,value){
  value=validateParameterWorking(value);
  const set=(node,name,text)=>{
    const control=node.querySelector('[name="'+name+'"]');
    if(control.tagName==='SELECT'&&![...control.options].some(item=>item.value===text)){
      control.add(new Option(text?'Retained choice: '+text:'No selection',text));
    }
    control.value=text;
  };
  for(const name of fields)set(root,name,value.fields[name]);
  const axes=[...root.querySelectorAll('.parameter-study-axis')],areas=[...root.querySelectorAll('.parameter-study-area')];
  if(axes.length!==value.axes.length||areas.length!==value.areas.length)throw Error('Reopen all original working rows before restoring their controls.');
  axes.forEach((node,index)=>{
    const row=value.axes[index];for(const name of axisFields)set(node,name,row[name]);
    const control=node.querySelector('[name="axis_parameters"]');
    for(const text of row.axis_parameters)if(![...control.options].some(item=>item.value===text))control.add(new Option('Retained parameter: '+text,text));
    for(const option of control.options)option.selected=row.axis_parameters.includes(option.value);
  });
  areas.forEach((node,index)=>{for(const name of areaFields)set(node,name,value.areas[index][name]);});
  root.querySelector('[name="difference_maps"]').checked=value.difference_maps;
}

function validateRecovery(value,selectedWorkspace){
  if(!value||value.schema!==recoverySchema||typeof value.series_id!=='string'||
     !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.series_id))
    throw Error('The recovery file lost its original working series.');
  validateParameterWorking(value.raw);
  for(const name of ['name','author','note'])if(typeof value[name]!=='string')throw Error('The recovery file lost its original attribution.');
  if(value.pending){
    const request=value.pending,payload=request.payload;
    if(request.workspace!==selectedWorkspace||request.action!=='parameter-study.working.save'||
       typeof request.operation_id!=='string'||!request.operation_id||
       !payload||payload.series_id!==value.series_id||typeof payload.request_id!=='string'||!payload.request_id)
      throw Error('The pending request is not this original Parameter working save.');
    validateParameterWorking(payload.draft);
  }
  return copy(value);
}

function download(name,value){
  const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function createParameterWorking(host,{workspace,open,getFrame,formRequest}){
  let session=null,listEpoch=0;
  const prefix=key=>'upstate-parameter-working:'+key+':';
  const read=key=>{const text=localStorage.getItem(key);return text?JSON.parse(text):null;};
  const write=(key,value)=>{localStorage.setItem(key,JSON.stringify(value));};
  const request=(operation,values={})=>host.api(host.endpoint('/api/parameter-studies/'+operation,values));
  function toolbar(){
    return '<section class="section" data-working-controls><header class="section-header"><div><h3>Working design</h3>'+
      '<p>Retain unfinished values and the complete revision history before preparing scientific cases.</p></div></header>'+
      '<div class="section-body"><div class="form-grid"><label>Name<input name="working_name"></label>'+
      '<label>Author<input name="working_author" autocomplete="name"></label>'+
      '<label>Revision note<textarea name="working_note" rows="2"></textarea></label></div>'+
      '<div class="page-actions">'+button('save','Save working revision')+button('fork','Save as new branch')+
      button('download','Download unfinished form and history')+button('browse','Open working designs')+
      '<span data-working-pending hidden>'+button('retry','Recover original save')+'</span></div>'+
      '<p class="note" data-working-status aria-live="polite"></p></div></section>';
  }
  function journal(){
    if(!session?.current())return null;
    const root=session.root;
    return {...session.value,raw:getFrame().capture(),
      name:root.querySelector('[name="working_name"]').value,
      author:root.querySelector('[name="working_author"]').value,
      note:root.querySelector('[name="working_note"]').value};
  }
  function status(text,error=false){
    if(!session?.current())return;
    const node=session.root.querySelector('[data-working-status]');node.textContent=text;
    node.className=error?'notice error':'note';
    session.root.querySelector('[data-working-pending]').hidden=!session.value.pending;
  }
  function capture(){
    if(!session?.current())return;
    try{session.value=journal();write(session.key,session.value);
      status(session.value.pending?'Original save retained. Recover it before another save.':
        session.value.package&&same(session.value.raw,session.value.package.records.at(-1).draft)?
          'This form matches saved revision '+session.value.package.records.at(-1).revision+'.':
          'Unfinished fields retained in this browser. Save a working revision for portable Workspace history.');
    }catch(error){status('Browser recovery could not be stored: '+error.message+'. Download the unfinished form before closing.',true);}
  }
  function attach(root,current,packet=null){
    const selectedWorkspace=workspace(),original=packet?.record,restore=packet?.recovery;
    let value=restore?validateRecovery(restore,selectedWorkspace):{
      schema:recoverySchema,workspace_key:selectedWorkspace,series_id:original?.series_id||uuid(),
      parent_id:original?.id||null,forked_from:null,package:packet?.package||null,imported_package:null,
      name:original?.name||'',author:original?.author||'',note:'',raw:getFrame().capture(),pending:null};
    if(restore)value.workspace_key=selectedWorkspace;
    const key=prefix(selectedWorkspace)+value.series_id;
    session={root,current:()=>workspace()===selectedWorkspace&&current(),value,key,busy:false};
    for(const name of ['name','author','note'])root.querySelector('[name="working_'+name+'"]').value=value[name]||'';
    root.addEventListener('input',capture);root.addEventListener('change',capture);
    capture();
  }
  function origin(raw){
    if(!session?.current()||!session.value.package)return null;
    if(session.value.imported_package)throw Error('Save the imported working branch before previewing. Its original native sources and history will be verified first.');
    const original=session.value.package.records.at(-1);
    if(!same(raw,original.draft))throw Error("Save the changed working revision before previewing its scientific design. This keeps the prepared study linked to its exact working history.");
    return {revision_id:original.id};
  }
  async function settle(original,task){
    const pending=original.value.pending;
    if(!task||task.workspace!==pending.workspace||task.action!==pending.action||
       !same(task.payload,pending.payload))throw Error('The accepted operation belongs to another working save.');
    while(['queued','running'].includes(task.state)){
      if(!original.current())return task;
      await new Promise(resolve=>setTimeout(resolve,700));
      task=await host.api(host.endpoint('/api/task',{workspace:pending.workspace,id:task.id}));
      if(task.workspace!==pending.workspace||task.action!==pending.action||!same(task.payload,pending.payload))
        throw Error('The retained save operation changed its original request.');
    }
    if(task.state!=='complete')throw Error(task.error?.message||'The original save '+task.state+'. Its request remains retained; inspect it in Operations, or explicitly start a new branch.');
    const packet=task.result;
    if(packet?.record?.request_id!==pending.payload.request_id||packet?.record?.series_id!==pending.payload.series_id||
       !same(packet.record.draft,pending.payload.draft)||packet.package?.revision_id!==packet.record.id)
      throw Error('The completed save differs from its original working request.');
    const retained=read(original.key)||original.value;
    if(retained.pending?.operation_id!==pending.operation_id)throw Error('The recovery journal changed before this save completed.');
    retained.package=packet.package;retained.parent_id=packet.record.id;retained.forked_from=null;
    retained.imported_package=null;retained.pending=null;
    write(original.key,retained);
    if(original.current()&&session===original){
      original.value={...retained,raw:getFrame().capture()};
      capture();status('Saved working revision '+packet.record.revision+'. Unfinished changes made while saving remain in the form.');
    }
    return packet;
  }
  async function save(fork=false){
    if(!session?.current()||session.busy)return;
    const original=session;
    capture();
    if(original.value.pending){
      if(!fork)throw Error('Recover the original save before creating another operation.');
    }
    if(fork){
      const previous=original.value;
      const next={...copy(previous),series_id:uuid(),parent_id:null,
        forked_from:previous.package?.revision_id||previous.forked_from,pending:null};
      original.key=prefix(workspace())+next.series_id;original.value=next;
    }
    const value=original.value;
    const payload={request_id:uuid(),series_id:value.series_id,parent_id:value.parent_id,
      forked_from:value.forked_from,name:value.name,author:value.author,note:value.note,
      draft:value.raw,imported_package:value.imported_package};
    const pending={workspace:workspace(),action:'parameter-study.working.save',payload,operation_id:uuid()};
    original.value={...value,pending};write(original.key,original.value);status('Saving the original working revision…');
    original.busy=true;
    try{const task=await host.api('/api/actions',{method:'POST',body:pending});return await settle(original,task);}
    finally{original.busy=false;}
  }
  async function retry(){
    if(!session?.current()||session.busy||!session.value.pending)return;
    const original=session,pending=validateRecovery(session.value,workspace()).pending;
    if(pending.workspace!==workspace())throw Error('Recover this request in its original Workspace.');
    original.busy=true;
    try{const task=await host.api('/api/actions',{method:'POST',body:pending});return await settle(original,task);}
    finally{original.busy=false;}
  }
  function recoveries(key){
    const rows=[];
    for(let index=0;index<localStorage.length;index++){
      const item=localStorage.key(index);
      if(item?.startsWith(prefix(key))){try{const value=read(item);if(value?.schema===recoverySchema)rows.push({key:item,value});}catch{}}
    }
    return rows;
  }
  async function browse(){
    capture();
    const opening=formRequest(),selectedWorkspace=opening.workspace,epoch=++listEpoch;
    const packet=await opening.read(()=>request('working-list'));
    if(!opening.current()||!packet||workspace()!==selectedWorkspace||epoch!==listEpoch)return;
    const local=recoveries(selectedWorkspace);
    const rows=packet.items||[];
    const html='<div data-working-browser><p>Saved revisions retain raw inputs and original sources. Preparing a scientific study still requires its ordinary preview.</p>'+
      '<h3>Named native working designs</h3>'+
      (rows.length?'<div class="table-scroll"><table><thead><tr><th>Design</th><th>Revision</th><th>Author</th><th></th></tr></thead><tbody>'+
        rows.map(row=>'<tr><td>'+esc(row.name)+'<small>'+esc(row.note)+'</small></td><td>'+row.revision+'</td><td>'+esc(row.author)+
          '</td><td>'+button('open','Open revision','data-id="'+esc(row.id)+'"')+button('history','Review history','data-id="'+esc(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No named working designs saved yet.</p>')+
      '<h3>Unfinished browser recovery</h3>'+local.map((row,index)=>'<p>'+esc(row.value.name||'Unnamed working design')+
        (row.value.pending?' · original save pending':'')+' '+button('local','Restore unfinished form','data-local="'+index+'"')+'</p>').join('')+
      '<h3>Reopen a complete working file</h3><p>An imported history opens as a new branch. Original native inputs must be present before its first save; its original records are kept intact.</p>'+
      '<label>Working history or unfinished recovery<input type="file" accept=".json,application/json" data-working-import></label>'+
      '<p data-working-list-status aria-live="polite"></p></div>';
    host.openForm('Parameter working designs','Native revisions and lossless unfinished recovery',html,'Close',async()=>{document.querySelector('[data-working-browser]')?.closest('dialog')?.close();},()=>{
      const panel=document.querySelector('[data-working-browser]');
      panel.addEventListener('click',event=>{
        const target=event.target.closest('[data-action]');
        if(!target)return;
        if(target.dataset.action==='parameter-study-working-local'){
          event.preventDefault();const item=local[Number(target.dataset.local)];
          if(item&&workspace()===selectedWorkspace&&panel.isConnected)open({recovery:copy(item.value)});
        }
      });
      panel.querySelector('[data-working-import]').addEventListener('change',async event=>{
        const file=event.target.files?.[0];if(!file)return;
        try{
          const parsed=JSON.parse(await file.text());
          if(workspace()!==selectedWorkspace||!panel.isConnected)return;
          let value;
          if(parsed.schema===recoverySchema){
            value=validateRecovery(parsed,selectedWorkspace);
            if(value.pending&&value.workspace_key!==selectedWorkspace)throw Error('Recover the pending original request in its original Workspace before importing this file.');
          }else if(parsed.schema==='upstate.parameter-working-history/v1'&&Array.isArray(parsed.records)&&parsed.records.length){
            const original=parsed.records.at(-1);
            if(original.id!==parsed.revision_id)throw Error('The history lost its selected revision.');
            validateParameterWorking(original.draft);
            value={schema:recoverySchema,workspace_key:selectedWorkspace,series_id:uuid(),parent_id:null,
              forked_from:original.id,package:parsed,imported_package:parsed,name:original.name,author:original.author,note:'',
              raw:original.draft,pending:null};
          }else throw Error('Open a complete Parameter history or unfinished recovery file.');
          if(value.package&&!value.pending){
            value={...value,series_id:uuid(),parent_id:null,forked_from:value.package.revision_id,
              imported_package:value.package,workspace_key:selectedWorkspace};
          }
          await open({recovery:value});
        }catch(error){if(panel.isConnected)panel.querySelector('[data-working-list-status]').textContent=error.message;}
      });
    });
  }
  async function openRevision(id,{current=()=>true}={}){
    const opening=formRequest(),selectedWorkspace=opening.workspace,epoch=++listEpoch;
    const packet=await opening.read(()=>request('working-view',{id}));
    if(!current()||!opening.current()||!packet||workspace()!==selectedWorkspace||epoch!==listEpoch)return;
    if(packet.record?.id!==id)throw Error('The working response belongs to another revision.');
    return open(packet);
  }
  async function history(id){
    const opening=formRequest(),selectedWorkspace=opening.workspace,epoch=++listEpoch;
    const packet=await opening.read(()=>request('working-view',{id}));
    if(!opening.current()||!packet||workspace()!==selectedWorkspace||epoch!==listEpoch)return;
    const html='<div data-working-history><h3>'+esc(packet.record.name)+'</h3><p>Every original ancestor remains available, including the revision where a new branch began.</p>'+
      '<div class="table-scroll"><table><thead><tr><th>Revision</th><th>Name and note</th><th>Author</th><th>Saved</th><th></th></tr></thead><tbody>'+
      packet.history.map(row=>'<tr><td>'+row.revision+(row.forked_from?' · branch':'')+'</td><td>'+esc(row.name)+'<small>'+esc(row.note)+
        '</small></td><td>'+esc(row.author)+'</td><td>'+esc(row.created_at)+'</td><td>'+button('open','Open original revision','data-id="'+esc(row.id)+'"')+'</td></tr>').join('')+
      '</tbody></table></div><div class="page-actions"><button type="button" data-working-download-history>Download complete history</button></div>'+
      '<details class="technical"><summary>Original source bindings and raw fields</summary><pre>'+esc(JSON.stringify({bindings:packet.record.bindings,draft:packet.record.draft},null,2))+'</pre></details></div>';
    host.openForm('Working revision history','Original raw controls and exact native sources',html,'Close',async()=>{document.querySelector('[data-working-history]')?.closest('dialog')?.close();},()=>{
      document.querySelector('[data-working-download-history]').addEventListener('click',()=>download('parameter-working-history-'+id+'.json',packet.package));
    });
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace('parameter-study-working-','');
    if(!node.dataset.action?.startsWith('parameter-study-working-'))return false;
    if(node.dataset.workspace&&node.dataset.workspace!==workspace())throw Error('Open this original working save in its own Workspace.');
    if(action==='browse'){await browse();return true;}
    if(action==='open'){await openRevision(node.dataset.id);return true;}
    if(action==='history'){await history(node.dataset.id);return true;}
    if(action==='local')return true; // Bound to the exact list snapshot.
    if(!session?.current()||!session.root.contains(node))throw Error('Reopen this unfinished working form.');
    try{
      if(action==='save'||action==='fork')await save(action==='fork');
      else if(action==='retry')await retry();
      else if(action==='download'){capture();download('parameter-working-recovery-'+session.value.series_id+'.json',journal());}
      else throw Error('Choose a working design action.');
    }catch(error){status(error.message,true);throw error;}
    return true;
  }
  return {toolbar,attach,capture,origin,browse,openRevision,dispatch};
}
