// MIT. Complete companion-file sets use the same original upload and Applications selection.
import {createApplicationInputSetEditionsView} from './application-input-set-editions.mjs';
import {APPLICATION_INPUT_SET_SCHEMA,APPLICATION_INPUT_SET_LIMITS as LIMITS,
  normalizeApplicationInputSet,applicationInputSetPath} from './application-input-set-format.mjs';
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const n=node('button',text);n.type='button';n.addEventListener('click',fn);return n;};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const human=value=>new Intl.NumberFormat().format(value);
export function createApplicationInputSetsView({root,api,getToken,getWorkspaceId,getTarget,clearTarget,onError,onMessage,readSaved,saveSaved}) {
  if(!document.querySelector('link[data-application-input-sets]')) {
    const css=document.createElement('link');css.rel='stylesheet';css.href='/application-input-sets.css';
    css.setAttribute('data-application-input-sets','');document.head.append(css);
  }
  let workspace=getWorkspaceId(),epoch=0,listing=0,busy=false,selected=[],directories=[],offset=0,workingOffset=0,opened=null,sourceChoice=0;
  const panel=node('details',undefined,'panel');panel.id='application-input-sets';
  panel.append(node('summary','Companion file sets'));
  const intro=node('p','Keep an entry file and every companion in one original source set. Prepare one editable working folder, then select its entry file or folder in the normal application review.','note');
  const name=node('input');name.maxLength=180;
  const nameLabel=node('label','Source set name');nameLabel.append(name);
  const folder=node('input');folder.type='file';folder.multiple=true;folder.setAttribute('webkitdirectory','');
  const folderLabel=node('label','Choose a source folder');folderLabel.append(folder);
  const files=node('input');files.type='file';files.multiple=true;
  const filesLabel=node('label','Or select companion files from one folder');filesLabel.append(files);
  const sourceSummary=node('p','','note'),status=node('p','','note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const upload=button('Save complete source set',()=>perform(uploadSelected));
  const recover=button('Continue working-set selection',()=>perform(()=>prepare(true)));
  const controls=node('div',undefined,'actions');controls.append(upload,recover);
  const search=node('input');search.type='search';search.placeholder='Find source set';search.maxLength=180;
  const list=node('div'),details=node('div'),copies=node('div'),page=node('span','','note');
  const back=button('Previous sets',()=>{offset=Math.max(0,offset-20);void refresh();});
  const next=button('Next sets',()=>{offset+=20;void refresh();});
  const pageControls=node('div',undefined,'actions');pageControls.append(back,next,page);
  const workingBack=button('Previous working sets',()=>{workingOffset=Math.max(0,workingOffset-10);void refresh();});
  const workingNext=button('Next working sets',()=>{workingOffset+=10;void refresh();});
  const workingControls=node('div',undefined,'actions');workingControls.append(workingBack,workingNext);
  const member=node('select');
  const pathLabel=node('label','Application entry');pathLabel.append(member);
  const prepareButton=button('Prepare working set for this setting',()=>perform(()=>prepare(false)));
  panel.append(intro,nameLabel,folderLabel,filesLabel,sourceSummary,controls,status,search,
    button('Refresh source sets',()=>void refresh()),list,pageControls,details,pathLabel,prepareButton,
    node('h3','Retained working sets'),copies,workingControls);
  const editionRoot=node('section',undefined,'application-input-set-editions');panel.append(editionRoot);
  root.replaceChildren(panel);
  const editions=createApplicationInputSetEditionsView({root:editionRoot,api,getWorkspaceId,readSaved,saveSaved,onError,onMessage,openSet,getSourceChoice:()=>sourceChoice});
  const scope=()=>({epoch,workspace:getWorkspaceId()});
  const current=s=>s.epoch===epoch&&s.workspace===workspace&&s.workspace===getWorkspaceId();
  function notice(text){status.textContent=text;onMessage(text);}
  function target(){const value=getTarget();return value?.current()?value:null;}
  function pending(){return readSaved('input-set-selection',workspace);}
  function remember(value){return saveSaved('input-set-selection',value,workspace);}
  function enabled() {
    folder.disabled=files.disabled=name.disabled=busy;
    upload.disabled=busy||!selected.length;
    recover.disabled=busy;recover.hidden=!pending();
    prepareButton.disabled=busy||opened?.phase!=='READY'||!target();
  }
  async function perform(work) {
    if(busy)return;const own=scope();busy=true;enabled();
    try{await work();}catch(error){if(current(own)){status.textContent=error.message;onError(error);}}
    finally{if(current(own)){busy=false;enabled();await refresh();}}
  }
  function acceptSelection(items,label) {
    sourceChoice++;selected=items;directories=[];opened=null;details.replaceChildren();member.replaceChildren();name.value=label;
    sourceSummary.textContent=items.length+' complete file(s), '+human(items.reduce((sum,x)=>sum+x.file.size,0))+' bytes.';
    status.textContent='Relative names are retained exactly. Select every required companion; use CLI directory intake when empty directories are part of the source.';
    enabled();
  }
  folder.addEventListener('change',()=>{
    const chosen=[...(folder.files??[])],roots=new Set(chosen.map(f=>f.webkitRelativePath.split('/')[0]));
    if(!chosen.length){acceptSelection([],'');return;}
    if(roots.size!==1||chosen.some(f=>!f.webkitRelativePath.includes('/'))){acceptSelection([],'');onError(new Error('Choose one original source folder.'));return;}
    files.value='';acceptSelection(chosen.map(file=>({path:file.webkitRelativePath.split('/').slice(1).join('/'),file})),[...roots][0]);
  });
  files.addEventListener('change',()=>{folder.value='';acceptSelection([...(files.files??[])].map(file=>({path:file.name,file})),name.value||'Companion files');});
  async function uploadSelected() {
    const own=scope(),selection=[...selected],label=name.value.trim();
    if(!selection.length)throw Error('Choose the complete original source files.');
    if(selection.length>LIMITS.files||selection.reduce((sum,x)=>sum+x.file.size,0)>LIMITS.bytes||
      selection.some(x=>x.file.size>LIMITS.fileBytes))throw Error('A source set supports up to 1,024 files, 16 MiB per file and 64 MiB total. Existing host paths remain available for larger sources.');
    for(const item of selection)applicationInputSetPath(item.path);
    const manifest={schema:APPLICATION_INPUT_SET_SCHEMA,name:label,directories:[...directories],files:[]};
    for(const item of selection) {
      if(!current(own))return;status.textContent='Reading complete original '+item.path;
      const body=await item.file.arrayBuffer();
      if(!current(own))return;
      const chunks=[];
      for(let start=0;start<body.byteLength;start+=LIMITS.chunkBytes)chunks.push(await digest(body.slice(start,start+LIMITS.chunkBytes)));
      manifest.files.push({path:item.path,bytes:body.byteLength,sha256:await digest(body),chunkSha256:chunks});
    }
    const normalized=normalizeApplicationInputSet(manifest);
    if(!current(own))return;
    const retained=await api('/api/application-input-sets/begin',{manifest:normalized});
    if(!current(own))return;
    const lookup=new Map(selection.map(x=>[x.path,x.file]));
    for(const item of retained.files) {
      if(!current(own))return;if(item.phase==='READY')continue;
      const source=lookup.get(item.path),received=new Set(item.receivedChunks);
      for(let index=0;index<item.chunkSha256.length;index++) {
        if(received.has(index))continue;if(!current(own))return;
        status.textContent='Saving '+item.path+' · part '+(index+1)+' of '+item.chunkSha256.length;
        const body=await source.slice(index*LIMITS.chunkBytes,(index+1)*LIMITS.chunkBytes).arrayBuffer();
        if(await digest(body)!==item.chunkSha256[index])throw Error('An original file changed while uploading. Reselect the same complete source.');
        if(!current(own))return;
        const response=await fetch('/api/application-inputs/chunk?'+new URLSearchParams({uploadId:item.uploadId,index}),{
          method:'POST',headers:{'x-runtime-workspace-token':getToken(),'content-type':'application/octet-stream'},body});
        const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message??value.error),{code:value.error});
      }
      if(!current(own))return;
      await api('/api/application-inputs/complete',{uploadId:item.uploadId});
    }
    if(!current(own))return;
    const completed=await api('/api/application-input-sets/complete',{setId:retained.setId});
    if(!current(own))return;
    selected=[];folder.value=files.value='';sourceSummary.textContent='';show(completed);enabled();
    notice('Complete original source set saved. Select its entry file or folder for the intended application setting.');
  }
  function downloadJSON(value,filename) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
    const a=node('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function show(value) {
    opened=value;const previous=member.value;
    member.replaceChildren(new Option('Whole working folder',''),...value.files.map(f=>new Option(f.path,f.path)));
    if(value.files.some(f=>f.path===previous))member.value=previous;
    const rows=value.files.map(file=>{
      const row=node('article',undefined,'operation');row.append(node('h4',file.path),
        node('p',human(file.bytes)+' bytes · '+file.phase,'note'),node('code',file.sha256));
      if(file.phase==='READY')row.append(button('Download original file',()=>perform(async()=>{
        const own=scope(),result=await api('/api/application-inputs/download',{uploadId:file.uploadId});
        if(!current(own))return;const a=node('a');a.href=result.url;a.download=result.filename;a.click();
      })));
      return row;
    });
    details.replaceChildren(node('h3',value.manifest.name),node('p',value.setId,'note'),
      node('p',value.phase==='READY'?'Every original is retained. Relative file paths stay together in the working folder.':
        'Reselect the same complete folder/files and source set name to resume the original transfer.','note'),
      button('Download source manifest',()=>downloadJSON(value.manifest,'application-source-set-'+value.setId+'.json')),...rows);
    enabled();
  }
  async function openSet(setId) {
    const own=scope(),choice=++sourceChoice,value=await api('/api/application-input-sets/inspect?'+new URLSearchParams({setId}));
    if(current(own)&&choice===sourceChoice)show(value);
  }
  async function prepare(resume) {
    const own=scope(),chosen=target();let request=resume?pending():null;
    if(!request) {
      if(!chosen||opened?.phase!=='READY')throw Error('Choose the intended application setting and a complete source set.');
      request={requestId:crypto.randomUUID(),setId:opened.setId,kind:chosen.kind,field:chosen.field,memberPath:member.value};
      if(!remember(request))throw Error('Retain this original selection request in browser storage or use the CLI before continuing.');
    }
    const result=await api('/api/application-input-sets/prepare',request);
    if(!current(own))return;
    if(pending()?.requestId===request.requestId)remember(null);
    if(chosen&&chosen===target()&&chosen.kind===result.kind&&chosen.field===result.field&&!result.error) {
      chosen.apply(result.path);clearTarget(chosen);notice('The complete working set is selected. Review and save the application using its existing controls.');
    }else notice('The complete working set is retained below. Open the intended setting to reuse its current path.');
  }
  async function useWorking(requestId) {
    const own=scope(),chosen=target(),value=await api('/api/application-input-sets/selection?'+new URLSearchParams({requestId}));
    if(!current(own))return;
    if(value.error)throw Error(value.error.message);
    if(!chosen||chosen!==target()||chosen.kind!==value.kind||chosen.field!==value.field)throw Error('Open the original application setting before reusing this working set.');
    chosen.apply(value.path);clearTarget(chosen);notice('Current working set selected. Its application edits and original source remain retained.');
  }
  async function refresh() {
    if(workspace!==getWorkspaceId())reset();if(!panel.open)return;
    const own=scope(),version=++listing;
    try{
      const result=await api('/api/application-input-sets?'+new URLSearchParams({query:search.value,offset,limit:20,workingOffset,workingLimit:10}));
      if(!current(own)||version!==listing)return;
      list.replaceChildren(...result.sets.items.map(item=>{
        const row=node('article',undefined,'operation');row.append(node('h4',item.name),node('p',item.files+' files · '+human(item.bytes)+' bytes','note'),
          button('Open original source set',()=>perform(()=>openSet(item.setId))));return row;
      }));
      back.disabled=offset===0;next.disabled=offset+20>=result.sets.total;page.textContent=result.sets.total+' source sets';
      copies.replaceChildren(...result.working.items.map(item=>{
        const row=node('article',undefined,'operation');row.append(node('h4',item.manifest.name),
          node('p',item.kind+' → '+item.field+' · '+item.phase,'note'),node('code',item.path));
        if(item.phase==='PREPARED')row.append(button('Use current working set',()=>perform(()=>useWorking(item.requestId))),
          button('Review edited source edition',()=>perform(()=>editions.open(item))));
        else row.append(button('Continue original working set',()=>perform(async()=>{
          if(!remember({requestId:item.requestId,setId:item.setId,kind:item.kind,field:item.field,memberPath:item.memberPath}))
            throw Error('Retain the original selection request before continuing.');
          await prepare(true);
        })));
        row.append(button('Inspect complete retained selection',()=>perform(async()=>{
          const own=scope(),value=await api('/api/application-input-sets/selection?'+new URLSearchParams({requestId:item.requestId}));
          if(current(own))downloadJSON(value,'application-working-set-'+item.requestId+'.json');
        })));return row;
      }));
      workingBack.disabled=workingOffset===0;workingNext.disabled=workingOffset+10>=result.working.total;enabled();await editions.refresh();
    }catch(error){if(current(own)&&version===listing)onError(error);}
  }
  function reset() {
    epoch++;listing++;sourceChoice++;workspace=getWorkspaceId();busy=false;selected=[];directories=[];offset=workingOffset=0;opened=null;
    folder.value=files.value=name.value=search.value='';sourceSummary.textContent=status.textContent='';list.replaceChildren();
    details.replaceChildren();copies.replaceChildren();member.replaceChildren();editions.reset();enabled();
  }
  search.addEventListener('input',()=>{offset=0;void refresh();});
  panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});enabled();
  return {refresh,reset,update(){if(workspace!==getWorkspaceId())reset();enabled();editions.update();},
    show(){panel.open=true;enabled();void refresh();}};
}
