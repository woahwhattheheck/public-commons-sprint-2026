// MIT. Receive original retained support files in the existing merchant case desk.
const add=(parent,tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;parent.append(node);return node;};
const button=(parent,label,run,style='secondary')=>{const node=add(parent,'button',label,style);node.type='button';node.addEventListener('click',run);return node;};
const bytes=value=>Number(value).toLocaleString()+' bytes';
const stateLabel={NOT_DOWNLOADED:'Not downloaded',DOWNLOADING:'Downloading',STOPPING:'Stopping',PAUSED:'Ready to resume',COMPLETE:'Complete',NEEDS_ATTENTION:'Needs attention'};

export function mountHandoffDesk({root,onOpenCase}) {
  const abort=new AbortController();let generation=0,busy=false,review=null,current=null,timer=null,offset=0,nextOffset=null,listSequence=0;
  let destroyed=false,sourceRows=[],lastList=null;
  root.id='handoffs';root.className='card handoff-desk';root.hidden=true;
  const heading=add(root,'div',undefined,'section-heading'),copy=add(heading,'div');
  add(copy,'p','Merchant handoffs','eyebrow');add(copy,'h2','Receive a saved handoff');
  add(copy,'p','Review the original files, resume a transfer and continue the received work in the case desk.');
  const badge=add(heading,'span','Retained files','stage-hint');
  const form=add(root,'form',undefined,'form-grid handoff-selection');form.setAttribute('aria-label','Select a merchant handoff');
  const sourceLabel=add(form,'label','Source'),source=add(sourceLabel,'select');source.id='handoff-source';
  const idLabel=add(form,'label','Export ID'),exportId=add(idLabel,'input');
  exportId.id='handoff-export-id';exportId.required=true;exportId.maxLength=64;exportId.pattern='[a-z0-9][a-z0-9_-]{0,63}';exportId.autocomplete='off';exportId.spellcheck=false;
  exportId.placeholder='Export ID supplied by the merchant';
  const selectionActions=add(form,'div',undefined,'actions full');
  const inspect=add(selectionActions,'button','Inspect source handoff');inspect.type='submit';
  const local=button(selectionActions,'View saved transfer',()=>select(source.value,exportId.value));
  const status=add(root,'p','Choose a source and the merchant’s export ID.','status');
  status.id='handoff-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const detail=add(root,'div');detail.hidden=true;
  const facts=add(detail,'div',undefined,'scope');
  const progressRow=add(detail,'div',undefined,'handoff-progress');
  const progress=add(progressRow,'progress');progress.setAttribute('aria-label','Retained handoff bytes');
  const progressText=add(progressRow,'p','','hint');
  const commands=add(detail,'div',undefined,'actions handoff-commands');
  const receive=button(commands,'Download reviewed handoff',()=>perform('receive'),'');receive.id='handoff-receive';
  const stop=button(commands,'Stop transfer',()=>perform('stop'));stop.id='handoff-stop';
  const open=button(commands,'Open received case',()=>perform('open'));open.id='handoff-open';
  const fileWrap=add(detail,'div',undefined,'case-table-wrap');
  const fileTable=add(fileWrap,'table',undefined,'case-table handoff-files');fileTable.setAttribute('aria-label','Original handoff files');
  const fileHeader=add(add(fileTable,'thead'),'tr');for(const title of ['Original file','Size','Saved','Use'])add(fileHeader,'th',title).scope='col';
  const fileRows=add(fileTable,'tbody');
  const sourceDetails=add(detail,'details',undefined,'source-details');add(sourceDetails,'summary','Original handoff identity');
  const sourceText=add(sourceDetails,'p','');sourceText.className='handoff-digest';
  const historyTitle=add(root,'h3','Saved transfers');
  const historyCount=add(root,'p','','hint');
  const historyWrap=add(root,'div',undefined,'case-table-wrap');
  const historyTable=add(historyWrap,'table',undefined,'case-table');historyTable.setAttribute('aria-label','Saved handoff transfers');
  const historyHeader=add(add(historyTable,'thead'),'tr');for(const title of ['Handoff','State','Saved files','Retained bytes'])add(historyHeader,'th',title).scope='col';
  const historyRows=add(historyTable,'tbody');
  const pages=add(root,'div',undefined,'actions case-pagination');
  const previous=button(pages,'Previous',()=>{offset=Math.max(0,offset-20);refresh();});
  const next=button(pages,'Next',()=>{if(nextOffset!==null){offset=nextOffset;refresh();}});
  const refreshButton=button(pages,'Refresh transfers',()=>refresh());

  const key=()=>source.value+'\0'+exportId.value;
  const route=action=>'/api/handoffs/'+encodeURIComponent(source.value)+'/'+encodeURIComponent(exportId.value)+(action?'/'+action:'');
  function say(message,error=false){status.textContent=message;status.className=error?'status error':'status';}
  function controls(){
    const valid=Boolean(source.value)&&exportId.checkValidity(),running=['DOWNLOADING','STOPPING'].includes(current?.state);
    inspect.disabled=busy||!valid;local.disabled=busy||!valid;source.disabled=busy;exportId.disabled=busy;
    receive.disabled=busy||running||!(review?.manifestSha256||current?.manifestSha256);
    receive.textContent=current?.state==='COMPLETE'?'Recheck source handoff':current?.manifestSha256?'Resume transfer':'Download reviewed handoff';
    stop.disabled=busy||!running||current?.state==='STOPPING';open.disabled=busy||current?.state!=='COMPLETE';
    previous.disabled=busy||!offset;next.disabled=busy||nextOffset===null;refreshButton.disabled=busy;
  }
  async function api(path,payload){
    const response=await fetch(path,{method:payload===undefined?'GET':'POST',credentials:'omit',cache:'no-store',signal:abort.signal,
      ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})});
    const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||'The handoff operation is unavailable.');return data;
  }
  function fact(title,value){const row=add(facts,'div',undefined,'scope-row');add(row,'b',title);add(row,'span',value);}
  function draw(){
    detail.hidden=!review&&!current;if(detail.hidden){badge.textContent='Retained files';controls();return;}
    const manifest=review?.manifest,currentFiles=current?.files??[],files=manifest?.files??currentFiles;
    facts.replaceChildren();
    fact('Handoff',exportId.value);fact('State',stateLabel[current?.state]||'Ready to download');
    fact('Original files',String(files.length));fact('Saved files',String(current?.progress.completeFiles??0));
    progress.max=Math.max(1,current?.progress.bytes??files.reduce((sum,file)=>sum+file.bytes,0));progress.value=current?.progress.savedBytes??0;
    progressText.textContent=bytes(progress.value)+' of '+bytes(progress.max===1&&!files.length?0:progress.max)+' retained'+(current?.active?.file?' · '+current.active.file:'');
    const items=files.map(file=>({...file,...currentFiles.find(saved=>saved.name===file.name)}));
    if(current?.state==='COMPLETE')items.push({name:'support-export.json',manifest:true});
    fileRows.replaceChildren();
    for(const file of items){
      const row=add(fileRows,'tr');add(row,'td',file.name);add(row,'td',file.manifest?'Completion manifest':bytes(file.bytes));
      add(row,'td',file.manifest||file.complete?'Complete':file.savedBytes?bytes(file.savedBytes):'Pending');const action=add(row,'td');
      if(current?.state==='COMPLETE'){
        const link=add(action,'a','Download','handoff-file-link');link.href=route('files/'+encodeURIComponent(file.name));link.download=file.name;
      }else add(action,'span','—');
    }
    const origin=manifest?.case??current?.sourceCase;
    sourceText.textContent='Manifest SHA-256: '+(review?.manifestSha256||current?.manifestSha256||'not received')+
      ((manifest?.createdAt??current?.exportedAt)?'\nExported at: '+(manifest?.createdAt??current?.exportedAt):'')+
      (origin?'\nExported case: '+origin.id+'\nExported revision: '+origin.revision:'')+
      (current?.localCase?'\nLocal case: '+current.localCase.id:'');
    badge.textContent=stateLabel[current?.state]||'Reviewed handoff';controls();
  }
  function schedule(){clearTimeout(timer);if(!destroyed&&!document.hidden&&(['DOWNLOADING','STOPPING'].includes(current?.state)||lastList?.transfers.some(row=>['DOWNLOADING','STOPPING'].includes(row.state))))timer=setTimeout(()=>refresh(),1000);}
  async function refresh(){
    if(!source.value||destroyed)return;const stamp=++listSequence,selected=key(),epoch=generation;
    try{
      const data=await api('/api/handoffs?'+new URLSearchParams({source:source.value,offset:String(offset),limit:'20'}));
      if(destroyed||stamp!==listSequence)return;lastList=data;nextOffset=data.nextOffset;
      historyCount.textContent=data.total+' retained handoff'+(data.total===1?'':'s')+(data.total?' · showing '+(data.offset+1)+'–'+(data.offset+data.transfers.length):'');
      historyRows.replaceChildren();
      for(const item of data.transfers){
        const row=add(historyRows,'tr'),first=add(row,'td');
        button(first,item.exportId,()=>select(item.source,item.exportId),'case-link');
        if(item.localCase)add(first,'small','Saved case '+item.localCase.id.slice(0,8));
        add(row,'td',stateLabel[item.state]||item.state);add(row,'td',item.progress.completeFiles+' / '+item.progress.files);add(row,'td',bytes(item.progress.savedBytes));
      }
      if(!data.transfers.length)add(add(historyRows,'tr'),'td','No saved transfers for this source. Inspect the merchant’s export ID to begin.').colSpan=4;
      if(exportId.checkValidity()&&exportId.value){
        const value=data.transfers.find(row=>row.exportId===exportId.value)??await api(route());
        if(epoch===generation&&selected===key()){
          const wasActive=['DOWNLOADING','STOPPING'].includes(current?.state);current=value;draw();
          if(current.problem)say(current.problem.detail,true);
          else if(wasActive&&current.state==='COMPLETE')say('All original files are saved. Open the received case to continue the merchant work.');
          else if(wasActive&&current.state==='PAUSED')say('Transfer stopped. The saved prefix is ready to resume.');
        }
      }
      controls();schedule();
    }catch(error){if(!destroyed&&stamp===listSequence)say(error.message,true);}
  }
  async function select(sourceKey,id){
    if(busy)return;generation++;source.value=sourceKey;exportId.value=id;review=null;current=null;const epoch=generation,selected=key();
    if(!exportId.checkValidity()){exportId.reportValidity();draw();return;}
    try{
      const value=await api(route());if(epoch!==generation||selected!==key())return;current=value;draw();
      say(value.problem?.detail??(value.state==='NOT_DOWNLOADED'?'Inspect the original source handoff before receiving it.':
        value.state==='COMPLETE'?'The original completion manifest is retained. Opening the case or downloading a file verifies its saved bytes.':'Resume continues the same saved handoff.'),Boolean(value.problem));
    }catch(error){say(error.message,true);}
    await refresh();
  }
  async function inspectSource(event){
    event.preventDefault();if(busy||!form.reportValidity())return;busy=true;controls();const epoch=generation,selected=key();say('Reading the original retained handoff manifest…');
    try{
      const value=await api(route('inspect'),{});if(epoch!==generation||selected!==key())return;review=value;
      current=await api(route());
      if(current.manifestSha256&&current.manifestSha256!==review.manifestSha256){review=null;throw new Error('This source manifest differs from the saved handoff. Keep its existing files and select the intended original export.');}
      draw();say('Original handoff reviewed. Download its exact files or resume the saved transfer.');
    }catch(error){say(error.message,true);}finally{busy=false;controls();}
  }
  async function perform(action){
    if(busy||!form.reportValidity())return;busy=true;controls();const epoch=generation,selected=key();
    try{
      const payload=action==='receive'?{expectedManifestSha256:review?.manifestSha256||current?.manifestSha256}:{};
      const value=await api(route(action),payload);if(epoch!==generation||selected!==key())return;
      if(action==='open'){
        current=await api(route());draw();say('The received case is saved. Opening it in the existing case desk…');
        document.getElementById('cases')?.scrollIntoView({block:'start'});
        const opened=await onOpenCase(value.case.id);say(opened?'Received case opened. Later edits and original sources remain in its saved history.':'The received case is saved; your current draft remains open.');
      }else{current=value;draw();say(action==='stop'?'Stopping this transfer after its saved byte checkpoint…':'Receiving the reviewed original handoff. You can leave this view and resume after reopening.');}
      await refresh();
    }catch(error){say(error.message,true);}finally{busy=false;controls();}
  }
  source.addEventListener('change',()=>{generation++;listSequence++;review=null;current=null;exportId.value='';offset=0;draw();say('Enter the merchant’s export ID or select a saved transfer.');refresh();},{signal:abort.signal});
  exportId.addEventListener('input',()=>{generation++;review=null;current=null;draw();},{signal:abort.signal});
  form.addEventListener('submit',inspectSource,{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();else clearTimeout(timer);},{signal:abort.signal});
  api('/api/handoffs/profiles').then(data=>{
    if(destroyed||!data.enabled||!data.sources.length)return;sourceRows=data.sources;
    for(const item of sourceRows)add(source,'option',item.label+(item.credentialConfigured?'':' · host credential missing')).value=item.key;
    root.hidden=false;const navigation=document.querySelector('[data-handoff-navigation]');
    if(navigation){navigation.hidden=false;navigation.closest('.workflow').classList.add('has-handoffs');}
    controls();refresh();
  }).catch(error=>{if(!destroyed){root.hidden=false;say(error.message,true);}});
  return {destroy(){destroyed=true;clearTimeout(timer);abort.abort();root.replaceChildren();}};
}
