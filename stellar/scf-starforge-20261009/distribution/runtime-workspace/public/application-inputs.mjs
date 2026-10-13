// MIT. Saved original files and separate application working copies.
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const n=node('button',text);n.type='button';n.addEventListener('click',fn);return n;};
const bytes=value=>new Intl.NumberFormat().format(value)+' bytes';
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(b=>b.toString(16).padStart(2,'0')).join('');
const CHUNK=1024*1024, MAX=16*1024*1024;
export function createApplicationInputsView({root,api,getToken,getWorkspaceId,onError,onMessage,readSaved,saveSaved}) {
  let workspace=null,epoch=0,listEpoch=0,busy=false,chooser=null,selectedFile=null,offset=0,workingOffset=0;
  const panel=node('details',undefined,'panel');panel.id='application-input-library';
  panel.append(node('summary','Original input files'));
  const intro=node('p','Save a complete file from this device, then prepare a separate working copy for an application file setting. Original files and partial uploads remain here after reopening.','note');
  const status=node('p','','note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const file=node('input');file.type='file';file.id='application-input-file';
  const fileLabel=node('label','Choose original file (up to 16 MiB)');fileLabel.append(file);
  const label=node('input');label.maxLength=180;label.autocomplete='off';
  const nameLabel=node('label','Saved filename');nameLabel.append(label);
  const progress=node('progress');progress.max=1;progress.value=0;progress.hidden=true;
  const upload=button('Save complete original',()=>perform(()=>uploadFile()));
  const recover=button('Continue prepared file selection',()=>perform(()=>prepare(null,true)));
  const controls=node('div',undefined,'actions');controls.append(upload,recover);
  const search=node('input');search.type='search';search.maxLength=180;search.placeholder='Find saved file';
  const searchLabel=node('label','Find an original file');searchLabel.append(search);
  const rows=node('div'),working=node('div');
  const previous=button('Previous files',()=>{offset=Math.max(0,offset-20);void refresh();});
  const next=button('Next files',()=>{offset+=20;void refresh();});
  const page=node('span','','note'),paging=node('div',undefined,'actions');paging.append(previous,next,page);
  const wp=button('Previous working copies',()=>{workingOffset=Math.max(0,workingOffset-10);void refresh();});
  const wn=button('Next working copies',()=>{workingOffset+=10;void refresh();});
  const workingPage=node('span','','note'),workingPaging=node('div',undefined,'actions');workingPaging.append(wp,wn,workingPage);
  const target=node('p','','note'),clearTarget=button('Close file setting selection',()=>{chooser=null;renderTarget();});
  const targetRow=node('div',undefined,'actions');targetRow.append(target,clearTarget);
  panel.append(intro,targetRow,fileLabel,nameLabel,controls,progress,status,searchLabel,
    button('Refresh saved files',()=>void refresh()),rows,paging,node('h3','Prepared working copies'),working,workingPaging);
  root.replaceChildren(panel);
  function scope(){return {epoch,workspace:getWorkspaceId()};}
  const current=s=>s.epoch===epoch&&s.workspace===workspace&&s.workspace===getWorkspaceId();
  function renderTarget() {
    const valid=chooser?.current();
    target.textContent=valid?'Choose a file for '+chooser.label+'. The existing application review checks whether this setting accepts the selected file.':
      'Open “Use saved file” beside the intended application file setting. Directory and executable settings retain their existing requirements.';
    clearTarget.hidden=!chooser;
  }
  function pending() {return readSaved('input-selection',workspace);}
  function remember(value){return saveSaved('input-selection',value,workspace);}
  function message(text){status.textContent=text;onMessage(text);}
  async function perform(task) {
    if(busy)return;const own=scope();busy=true;upload.disabled=recover.disabled=file.disabled=label.disabled=true;
    try {await task();}
    catch(error){if(current(own)){status.textContent=error.message;onError(error);}}
    finally{if(current(own)){busy=false;file.disabled=label.disabled=false;upload.disabled=!selectedFile;recover.disabled=false;progress.hidden=true;await refresh();}}
  }
  async function uploadFile() {
    const own=scope(),original=selectedFile,filename=label.value.trim()||original?.name;
    if(!original)throw Error('Choose the complete original file.');
    if(original.size>MAX)throw Error('This saved-file library accepts files up to 16 MiB. Existing absolute host paths remain available in application settings.');
    if(!filename||filename.length>180)throw Error('Choose a filename of at most 180 characters.');
    progress.hidden=false;progress.max=Math.max(original.size,1);progress.value=0;
    const hashes=[];
    for(let start=0;start<original.size;start+=CHUNK) {
      if(!current(own))return;
      hashes.push(await sha(await original.slice(start,start+CHUNK).arrayBuffer()));
      progress.value=Math.min(original.size,start+CHUNK);status.textContent='Reading original file '+bytes(progress.value)+' of '+bytes(original.size);
    }
    if(!current(own))return;
    const manifest={schema:'stellar-forge.sf88.collection-input-upload.v1',kind:'body',name:filename,bytes:original.size,chunkSha256:hashes};
    const retained=await api('/api/application-inputs/begin',{manifest});
    if(!current(own))return;
    saveSaved('input-upload',{workspaceId:workspace,uploadId:retained.uploadId,manifest},workspace);
    const received=new Set(retained.receivedChunks);progress.value=retained.receivedBytes;
    if(retained.phase!=='READY') {
      for(let index=0;index<hashes.length;index++) {
        if(!current(own))return;
        if(received.has(index))continue;
        const response=await fetch('/api/application-inputs/chunk?'+new URLSearchParams({uploadId:retained.uploadId,index}),{
          method:'POST',headers:{'x-runtime-workspace-token':getToken(),'content-type':'application/octet-stream'},
          body:original.slice(index*CHUNK,(index+1)*CHUNK)});
        const value=await response.json();
        if(!response.ok)throw Object.assign(new Error(value.message??value.error),{code:value.error,status:response.status});
        if(!current(own))return;
        progress.value=Math.min(original.size,progress.value+value.bytes);
        status.textContent='Saved '+bytes(progress.value)+' of '+bytes(original.size)+'.';
      }
      await api('/api/application-inputs/complete',{uploadId:retained.uploadId});
    }
    if(!current(own))return;
    saveSaved('input-upload',null,workspace);
    selectedFile=null;file.value='';label.value='';upload.disabled=true;
    message('Complete original saved. Select “Prepare working copy” to use it in the chosen setting.');
  }
  async function prepare(id,resume=false) {
    const own=scope();let value=resume?pending():null;
    const target=chooser;
    if(!value) {
      if(!target?.current())throw Error('Open the intended application file setting before preparing a working copy.');
      value={requestId:crypto.randomUUID(),uploadId:id,kind:target.kind,field:target.field};
      if(!remember(value))throw Error('The browser could not retain this selection request. Restore browser storage or prepare it through the CLI before continuing.');
    }
    const result=await api('/api/application-inputs/prepare',value);
    if(!current(own))return;
    if(pending()?.requestId===value.requestId)remember(null);
    if(target?.current()&&target===chooser&&target.kind===result.kind&&target.field===result.field) {
      target.apply(result.path);chooser=null;renderTarget();
      message('Working file selected for '+target.label+'. Review and save the application using its existing controls.');
    } else message('Working file prepared and retained below. Open the current application setting to select its path.');
  }
  function applyWorking(row) {
    const target=chooser;
    if(!target?.current()||target.kind!==row.kind||target.field!==row.field) {
      message('Open “Use saved file” for '+row.kind+' → '+row.field+' to select this existing working copy.');return;
    }
    target.apply(row.path);chooser=null;renderTarget();message('Retained working copy selected. Review and save the current application.');
  }
  async function download(id) {
    const own=scope(),result=await api('/api/application-inputs/download',{uploadId:id});
    if(!current(own))return;
    const link=node('a');link.href=result.url;link.download=result.filename;link.rel='noopener';root.append(link);link.click();link.remove();
  }
  async function refresh() {
    if(workspace!==getWorkspaceId())reset();
    if(!workspace)workspace=getWorkspaceId();
    if(!panel.open)return;
    const own=scope(),generation=++listEpoch;
    try {
      const value=await api('/api/application-inputs?'+new URLSearchParams({query:search.value,offset,limit:20,workingOffset,workingLimit:10}));
      if(!current(own)||generation!==listEpoch)return;
      recover.hidden=!pending();renderTarget();
      rows.replaceChildren(...value.files.inputs.map(item=>{
        const row=node('article',undefined,'operation'),actions=node('div',undefined,'actions');
        row.append(node('h4',item.name),node('p',bytes(item.bytes)+' · '+item.phase,'note'));
        if(item.sha256)row.append(node('code',item.sha256));
        if(item.phase==='READY')actions.append(button('Download original',()=>perform(()=>download(item.id))),
          button('Prepare working copy',()=>perform(()=>prepare(item.id))));
        else row.append(node('p',item.error??'Reselect the same complete file above to continue its original upload.','note'));
        row.append(actions);return row;
      }));
      if(!value.files.inputs.length)rows.append(node('p','No saved original files match this selection.','note'));
      previous.disabled=offset===0;next.disabled=offset+20>=value.files.total;
      page.textContent=value.files.total+' files · '+(offset+1)+'–'+Math.min(offset+20,value.files.total);
      working.replaceChildren(...value.working.items.map(item=>{
        const row=node('article',undefined,'operation');
        row.append(node('h4',item.original.name),node('p',item.kind+' → '+item.field+' · '+item.phase,'note'),
          node('code',item.path));
        if(item.current)row.append(node('p',item.current.changed?
          'The application working copy has changed. The original upload remains retained.':'Working copy matches its retained original.','note'));
        if(item.error)row.append(node('p',item.error.message,'note'));
        const actions=node('div',undefined,'actions');
        if(item.phase==='PREPARED'&&!item.error)actions.append(button('Use this working copy',()=>applyWorking(item)));
        if(item.phase==='PREPARING')actions.append(button('Continue this copy',()=>perform(async()=>{
          const request={requestId:item.requestId,uploadId:item.uploadId,kind:item.kind,field:item.field};
          if(!remember(request))throw Error('The browser could not retain the original request.');
          await prepare(null,true);
        })));
        actions.append(button('Copy path',()=>perform(async()=>{await navigator.clipboard.writeText(item.path);message('Working path copied.');})));
        row.append(actions);return row;
      }));
      wp.disabled=workingOffset===0;wn.disabled=workingOffset+10>=value.working.total;
      workingPage.textContent=value.working.total+' working copies';
    } catch(error){if(current(own)&&generation===listEpoch)onError(error);}
  }
  function reset() {
    epoch++;listEpoch++;workspace=getWorkspaceId();chooser=null;selectedFile=null;busy=false;offset=workingOffset=0;
    file.value='';label.value='';search.value='';status.textContent='';rows.replaceChildren();working.replaceChildren();progress.hidden=true;file.disabled=label.disabled=recover.disabled=false;recover.hidden=true;upload.disabled=true;renderTarget();
  }
  file.addEventListener('change',()=>{
    selectedFile=file.files?.[0]??null;label.value=selectedFile?.name??'';upload.disabled=!selectedFile||busy;
    if(selectedFile?.size>MAX)status.textContent='This original exceeds the 16 MiB library allowance. Use its absolute host path in the application.';
  });
  search.addEventListener('input',()=>{offset=0;void refresh();});
  panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});
  upload.disabled=true;recover.hidden=true;
  return {
    choose(value){if(workspace!==getWorkspaceId())reset();chooser=value;panel.open=true;renderTarget();panel.scrollIntoView({block:'nearest'});void refresh();},
    update(){if(workspace!==getWorkspaceId())reset();},
    reset,
  };
}
