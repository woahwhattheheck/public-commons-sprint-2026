// MIT. Receive original merchant support files in the existing grant delivery case.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const MAX_FILE=8*1024*1024;
const button=(label,action,attributes='')=>'<button type="button" data-support-action="'+action+'" '+attributes+'>'+esc(label)+'</button>';
const table=(heads,rows)=>'<div class="ops-table"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const choices=(values,selected)=>values.map(value=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(title(value))+'</option>').join('');
function base64(buffer){const bytes=new Uint8Array(buffer);let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
function download(raw,name,type='application/json'){const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const supportSource=row=>row.supportHandoff?.sourceSha256===row.sha256&&Array.isArray(row.supportHandoff.reports);
const label=(text,input)=>'<label>'+esc(text)+input+'</label>';
const input=(name,value='',required=false,type='text',maximum=4000)=>'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" maxlength="'+maximum+'"'+(required?' required':'')+'>';

export function mountSupportDelivery({container,current,api,saveApi=api,mutationId,recordingActor,onSaved,onReload,session={}}) {
  const root=document.createElement('section');root.className='support-delivery';root.setAttribute('aria-label','Merchant support receiving');container.replaceChildren(root);
  let active=true,busy=false,hostBusy=false;
  const $=selector=>root.querySelector(selector);
  const available=()=>active&&root.isConnected;
  const requireActive=()=>{if(!available())throw new Error('This support view is closed. Reopen the original case.');};
  const changeable=()=>current.program.state==='OPEN'&&!session.pending&&!session.accepted&&!session.sending;
  const acceptedSource=session.accepted&&current.records.deployments.find(row=>row.id===session.accepted.recordId);
  if(session.accepted&&current.program.version>=session.accepted.version&&
      acceptedSource&&session.accepted.sourceIds.every(id=>acceptedSource.sourceIds.includes(id))) {
    session.message='Reopened the received support source at operations version '+session.accepted.version+'.';
    for(const key of ['selected','review','pending','accepted','draft','rejected'])session[key]=null;
    session.readOnly=false;session.error=false;
  }
  function captureDraft(){
    const form=$('[data-support-form]');if(!form)return;
    const draft={};for(const el of form.elements)if(el.name)
      draft[el.name]=el.multiple?[...el.selectedOptions].map(option=>option.value):el.value;
    session.draft=draft;
  }
  function restoreDraft(){
    if(!session.draft)return;
    for(const el of $('[data-support-form]')?.elements??[])if(el.name in session.draft){
      const value=session.draft[el.name];
      if(el.multiple){for(const option of el.options)option.selected=Array.isArray(value)&&value.includes(option.value);}
      else if(el.tagName==='SELECT'){
        if([...el.options].some(option=>option.value===value))el.value=value;
        else if(el.name==='deploymentId')el.value='__select__';
      }else el.value=String(value??'');
    }
  }
  function syncBusy(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy||Boolean(session.sending)));
    root.querySelectorAll('button,input,select,textarea').forEach(el=>{
      const fixed=el.dataset.supportFixed==='true',draft=el.closest('[data-support-draft]');
      const newFields=el.closest('[data-support-new]');
      const needsSelection=el.matches('[data-support-save]')&&$('[name=deploymentId]')?.value==='__select__';
      const changesPreview=['saved-open','preview'].includes(el.dataset.supportAction)&&(session.pending||session.accepted);
      el.disabled=busy||hostBusy||Boolean(session.sending)||fixed||Boolean(draft&&(session.pending||session.accepted))||
        Boolean(newFields?.hidden)||Boolean(needsSelection)||Boolean(changesPreview);
    });
  }
  const setHostBusy=value=>{hostBusy=value;syncBusy();};
  function tell(value,isError=false){session.message=value;session.error=isError;if(available()){
    const node=$('[data-support-message]');if(node){node.textContent=value;node.setAttribute('role',isError?'alert':'status');}}}
  async function run(action){
    if(!available()||busy||hostBusy||session.sending)return;
    busy=true;syncBusy();
    try{await action();}catch(err){if(available())tell(err.message||String(err),true);}
    finally{busy=false;if(available())syncBusy();}
  }
  async function call(...args){requireActive();const result=await api(...args);requireActive();return result;}
  const sourceById=id=>current.sources.find(row=>row.id===id);
  function savedFiles(){
    const sources=current.sources.filter(supportSource);
    if(!sources.length)return '<p class="ops-empty">This case has no received merchant support file.</p>';
    return table(['Original file','Linked deployments','Source identity','Open'],sources.map(source=>{
      const deployments=current.records.deployments.filter(row=>row.sourceIds.includes(source.id));
      const reports=source.supportHandoff.reports.filter(item=>item&&typeof item.sourceId==='string'&&typeof item.sha256==='string')
        .map(item=>current.sources.find(row=>row.id===item.sourceId&&row.sha256===item.sha256)).filter(Boolean);
      return [esc(source.supportHandoff.originalFilename||source.filename),
        deployments.map(row=>esc(row.name)+'<small>'+esc(row.operator)+' · '+esc(title(row.state))+'</small>').join('')||'Retained source',
        '<code>'+esc(source.sha256)+'</code><small>'+source.bytes.toLocaleString()+' bytes</small>',
        '<div class="ops-actions">'+button('Open review','saved-open','data-source="'+source.id+'"')+
        button('Download handoff','source-download','data-source="'+source.id+'"')+
        reports.map((report,i)=>button(reports.length>1?'Runtime report '+(i+1):'Download runtime report','report-download','data-source="'+report.id+'"')).join('')+'</div>'];
    }));
  }
  function captures(){
    const r=session.review.report;
    const rows=['before','after'].flatMap(side=>{
      const c=r[side];if(!c)return [];
      return [[esc(title(side))+'<small>'+esc(c.capturedAt)+'</small>',
        esc(c.route.method)+' '+esc(c.route.id)+(c.route.path?'<small>'+esc(c.route.path)+'</small>':''),
        esc(c.mode)+'<small>'+esc(c.kind||'Session packet')+'</small>',
        esc(c.route.completed),esc(c.route.success),esc(c.route.serverError),esc(c.route.disconnected)]];
    });
    return '<h4>Original runtime captures</h4>'+table(['Capture','Selected route','Runtime','Completed','2xx','5xx','Disconnected'],rows)+
      '<p class="ops-note">'+esc(r.comparison.detail)+'</p>'+
      (r.queue.length?'<h4>Retained follow-up work</h4><ul>'+r.queue.map(row=>'<li><strong>'+esc(row.source)+' · '+esc(row.routeId)+'</strong>: '+esc(row.action)+'</li>').join('')+'</ul>':'')+
      '<details><summary>Complete native review</summary><pre data-support-review-json></pre></details>';
  }
  function deploymentForm(){
    if(!session.review||session.readOnly)return '';
    const prior=current.records.deployments.filter(row=>row.sourceIds.some(id=>session.review.retainedSourceIds.includes(id)));
    const selection=prior[0]?.id||(current.records.deployments.length?'__select__':'__new__');
    return '<form data-support-form><div data-support-draft><h4>Associate this support file</h4>'+
      label('Deployment','<select name="deploymentId" required><option value="__select__" disabled'+(selection==='__select__'?' selected':'')+'>Choose a deployment</option><option value="__new__"'+(selection==='__new__'?' selected':'')+'>Create a deployment</option>'+
        current.records.deployments.map(row=>'<option value="'+row.id+'"'+(row.id===selection?' selected':'')+'>'+esc(row.name)+' · '+esc(row.operator)+'</option>').join('')+'</select>')+
      '<div data-support-existing></div><fieldset data-support-new><legend>New deployment</legend><div class="ops-fields">'+
      label('Deployment name',input('name',session.review.metadata.merchant||session.review.workspace.name,true,'text',500))+
      label('Accountable operator',input('operator','',true,'text',500))+
      label('Stable operator identity',input('operatorId','',false,'text',500))+
      label('Role','<select name="role">'+choices(['MERCHANT','BUYER','BOTH'],'MERCHANT')+'</select>')+
      label('Participation','<select name="participantClass">'+choices(['TEAM_OPERATED','INDEPENDENT_OPERATOR','CUSTOMER'],'TEAM_OPERATED')+'</select>')+
      label('Environment','<select name="environment">'+choices(['LOCAL','TESTNET','MAINNET','OTHER'],'LOCAL')+'</select>')+
      label('Current deployment state','<select name="state">'+choices(['PLANNED','INSTALLED','OPERATING','HANDED_OVER','RETIRED'],'PLANNED')+'</select>')+
      label('Tranche','<select name="tranche"><option value="">Not assigned</option>'+choices(['1','2','3'],'')+'</select>')+
      label('Original endpoint',input('endpoint',/^https?:\/\//.test(session.review.workspace.inputs.resource||'')?session.review.workspace.inputs.resource:'',false,'url'))+
      label('Original source or release',input('releaseRef'))+
      label('Original case or work order',input('caseRef'))+
      label('Receiving operator',input('acceptedBy','',false,'text',300))+
      label('Actual handover date',input('acceptedAt','',false,'date',10))+
      label('Original work packages','<select name="costIds" multiple size="4">'+current.plan.scenario.future_costs.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.id)+'</option>').join('')+'</select>')+
      '</div></fieldset>'+
      label('Receiving note','<textarea name="note" rows="3" maxlength="12000" placeholder="Retain the source and intended follow-up."></textarea>')+
      '<p>The selected deployment keeps its existing operator, state, cash and purchase records. The source and runtime report are attached together.</p></div>'+
      '<div class="ops-actions"><button type="submit" data-support-save'+(!changeable()?' data-support-fixed="true"':'')+'>Receive support into this case</button></div></form>';
  }
  function configureDeployment(){
    const select=$('[name=deploymentId]'),fresh=$('[data-support-new]'),existing=$('[data-support-existing]');
    if(!select||!fresh)return;
    const row=current.records.deployments.find(item=>item.id===select.value);
    const creating=select.value==='__new__';
    fresh.hidden=!creating;
    fresh.querySelectorAll('input,select,textarea').forEach(el=>{
      el.disabled=!creating||busy||hostBusy||Boolean(session.pending||session.accepted);
      if(el.name==='name'||el.name==='operator')el.required=creating;
      if(el.name==='acceptedBy'||el.name==='acceptedAt')el.required=creating&&$('[name=state]').value==='HANDED_OVER';
    });
    existing.textContent=row?row.operator+' · '+title(row.participantClass)+' · '+title(row.environment)+' · '+title(row.state):'';
    syncBusy();
  }
  function render(){
    if(!available())return;
    const {review,pending,accepted}=session;
    root.innerHTML='<div class="ops-heading"><div><h3>Merchant support</h3><p>Receive the original support export, review its captured routes and recovery, and retain it with the deployment in this delivery case.</p></div></div>'+
      '<p data-support-message role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.message||'')+'</p>'+
      '<div data-support-draft class="support-file-selection">'+label('Original SF74 support handoff','<input type="file" data-support-file accept=".json,application/json"'+(!changeable()?' data-support-fixed="true"':'')+'>'+
      (session.selected?'<small>Retained selection: '+esc(session.selected.filename)+'</small>':''))+
      '<p>Choose the JSON file from Merchant Support → Export portable handoff. Maximum 8 MiB per original attachment.</p></div>'+
      (session.selected&&!review&&!pending&&!accepted?button('Review retained selection','preview'):'')+
      (review?'<div class="support-review"><div class="ops-heading"><div><h4>'+esc(review.workspace.name)+'</h4><p>'+esc(review.metadata.merchant)+' · Support owner '+esc(review.metadata.owner||'Unassigned')+'</p></div><div class="ops-actions">'+button('Download original runtime report','review-download')+'</div></div>'+
        '<p>'+esc(review.source.filename)+' · '+review.source.bytes.toLocaleString()+' bytes · Exported '+esc(review.source.generatedAt)+'</p><code class="ops-break">'+esc(review.source.sha256)+'</code>'+
        captures()+(session.readOnly?'<p>This is the retained source already attached to this case.</p>':deploymentForm())+'</div>':'')+
      (pending?'<p class="ops-note">'+(session.sending?'The original save request is running.':'The save request is retained. Recover that same request to read its original result.')+'</p><div class="ops-actions">'+button('Retry same save','retry')+button('Refresh original case','reload')+'</div>':'')+
      (accepted?'<p class="ops-note">The support source was saved at operations version '+accepted.version+'.</p>'+button('Refresh saved case','reload'):'')+
      '<h4>Received support files</h4>'+savedFiles()+
      (current.program.state!=='OPEN'?'<p class="ops-note">This case is closed. Use the original Reopen review action to receive additional source.</p>':'');
    if(review)$('[data-support-review-json]').textContent=JSON.stringify(review.report,null,2);
    restoreDraft();configureDeployment();syncBusy();
  }
  async function previewSelected(){
    if(session.pending||session.accepted||session.sending)throw new Error('Recover the retained save request before selecting another review.');
    if(!session.selected)throw new Error('Select the original support handoff.');
    const selected=session.selected;
    session.review=null;render();
    const result=await call('/api/operations/'+current.program.id+'/support-preview',{expectedVersion:current.program.version,...selected});
    if(session.selected!==selected)return;
    session.review=result;session.rejected=null;
    tell('Opened the original support captures and runtime review.');render();
  }
  async function previewFile(name,buffer,saved=false){
    if(buffer.byteLength===0||buffer.byteLength>MAX_FILE)throw new Error('Select an original support handoff up to 8 MiB.');
    session.selected={filename:name,contentBase64:base64(buffer)};session.readOnly=saved;
    session.draft=null;session.review=null;session.accepted=null;session.rejected=null;
    await previewSelected();
  }
  const definitelyRejected=error=>[400,404,409,413,422].includes(error.status)&&
    typeof error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code);
  async function settleResult(){
    if(!available())return;
    if(session.accepted){
      const result=session.accepted;
      try{await onSaved(result);}catch(err){if(available()){render();tell('Saved support at version '+result.version+'. Refresh the original case to reopen it. '+err.message,true);}}
    }else if(session.rejected){
      try{await onReload();}catch(err){if(available()){render();tell(session.rejected.message+' Refresh the original case, then review the retained selection. '+err.message,true);}}
    }
  }
  async function sendPending(){
    if(!session.pending)throw new Error('No original support save is retained.');
    const request=session.pending;
    if(!session.sending){
      session.sending=(async()=>{
        await Promise.resolve();
        try{
          // This transport is deliberately independent of a disposable browser view.
          const result=await saveApi('/api/operations/'+current.program.id+'/command',request);
          session.accepted=result;session.pending=null;session.rejected=null;
          session.message=result.unchanged?'This source and runtime report are already attached to the selected deployment.':'Received the original support file and runtime report.';
          session.error=false;
          return result;
        }catch(err){
          if(definitelyRejected(err)){
            session.pending=null;session.review=null;
            session.rejected={requestId:request.requestId,code:err.code,status:err.status,message:err.message};
            session.message=err.message+' The original file and deployment draft are retained for review against the current case.';
          }else session.message=err.message||'The save result is unavailable. Recover this same request.';
          session.error=true;throw err;
        }finally{session.sending=null;session.notify?.();}
      })();
    }
    try{await session.sending;}catch(err){if(!session.rejected)throw err;}
    await settleResult();
  }
  root.addEventListener('input',event=>{if(event.target.closest('[data-support-form]'))captureDraft();});
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-support-file]')){
      if(!changeable())return;
      const file=event.target.files?.[0];
      if(file)run(async()=>{if(file.size>MAX_FILE)throw new Error('Select an original support handoff up to 8 MiB.');const bytes=await file.arrayBuffer();requireActive();await previewFile(file.name,bytes);});
    }
    if(event.target.closest('[data-support-form]'))captureDraft();
    if(event.target.name==='deploymentId'||event.target.name==='state')configureDeployment();
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-support-action]');if(!target)return;
    run(async()=>{
      const action=target.dataset.supportAction;
      if(action==='saved-open'&&(session.pending||session.accepted||session.sending))return;
      if(action==='reload'){captureDraft();return onReload();}
      if(action==='retry')return sendPending();
      if(action==='preview')return previewSelected();
      if(action==='review-download'){if(session.review)download(session.review.html,'merchant-support-runtime.html','text/html');return;}
      const source=sourceById(target.dataset.source);if(!source)throw new Error('The retained source is unavailable in this case.');
      const response=await call('/api/operations/'+current.program.id+'/sources/'+source.id,undefined,{download:true});
      const bytes=await response.arrayBuffer();requireActive();
      if(action==='source-download')download(bytes,source.supportHandoff?.originalFilename||source.filename,source.supportHandoff?'application/json':source.mediaType);
      else if(action==='report-download')download(bytes,'merchant-support-runtime.html','text/html');
      else if(action==='saved-open')await previewFile(source.supportHandoff?.originalFilename||source.filename,bytes,true);
    });
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-support-form]'))return;event.preventDefault();
    if(!session.review||!session.selected||!changeable())return;
    captureDraft();
    const form=event.target,data=new FormData(form),choice=String(data.get('deploymentId')||'__select__');
    if(choice==='__select__')return;
    const deploymentId=choice==='__new__'?'':choice;
    let deployment=null;
    if(!deploymentId){
      deployment=Object.fromEntries(['name','operator','operatorId','role','participantClass','environment','state',
        'endpoint','releaseRef','caseRef','acceptedBy'].map(key=>[key,String(data.get(key)||'')]));
      deployment.tranche=data.get('tranche')?Number(data.get('tranche')):null;
      deployment.acceptedAt=data.get('acceptedAt')||null;
      deployment.costIds=data.getAll('costIds').map(String);
      deployment.sourceNote='';
    }
    const note=String(data.get('note')||'');
    run(async()=>{
      const payload={expectedVersion:current.program.version,actor:recordingActor(),note,action:'support.receive',
        data:{...session.selected,expectedPreviewSha256:session.review.previewSha256,deploymentId:deploymentId||null,...(deployment?{deployment}:{})}};
      payload.requestId=await mutationId('operations:'+current.program.id,payload);requireActive();
      session.pending=structuredClone(payload);render();await sendPending();
    });
  });
  function dispose(){captureDraft();active=false;if(session.notify===render)session.notify=null;}
  session.notify=render;
  render();
  const ready=(async()=>{
    const sending=session.sending;
    if(sending){try{await sending;}catch{}if(available())await settleResult();return;}
    if(session.accepted){await settleResult();return;}
    if(session.selected&&!session.pending&&(!session.review||session.review.version!==current.program.version)){
      busy=true;syncBusy();
      try{await previewSelected();}catch(err){if(available())tell(err.message||String(err),true);}
      finally{busy=false;if(available())syncBusy();}
    }
  })();
  return {ready,dispose,setHostBusy,root};
}
