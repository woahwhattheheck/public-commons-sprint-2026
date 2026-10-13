// MIT. Complete existing PDF intake and receiving in the original customer browser.
export function installPdfBundles({api,guard,onOpen}){
  const $=id=>document.getElementById(id),MiB=1048576,HASH=/^[a-f0-9]{64}$/;
  const state={files:[],fileEpoch:0,pending:0,submitting:false,selected:null,selectedId:null,selectionEpoch:0,
    sourceOffset:0,listOffset:0,listEpoch:0,operation:null,timer:null,followId:null,visible:false,restore:null,restoreEpoch:0,host:null};
  const labels={materialize:'Continuing original PDF sources',stage:'Saving complete PDF sources',restore:'Receiving complete bundle source',prepare:'Preparing the original assembly price',
    run:'Assembling at the saved price',receive:'Receiving original assembly jobs',export:'Exporting the complete PDF bundle'};
  const request=(path,options)=>api('bundles/'+path,options);
  function node(tag,text,className){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;
    if(className)value.className=className;return value;}
  const human=value=>String(value??'').replaceAll('_',' ').toLowerCase();
  const size=value=>Number(value).toLocaleString()+' bytes';
  function button(label,action){const value=node('button',label);value.type='button';value.addEventListener('click',()=>guard(action));return value;}
  function selection(kind,extra={}){
    if(!state.selected)throw Error('Select a saved PDF bundle first.');
    return {id:state.selected.id,sourceSha256:state.selected.sourceSha256,...(kind?{kind}:{}),...extra};
  }
  function downloadButton(label,input){return button(label,async()=>{
    const ticket=await request('download',{method:'POST',body:input}),target=new URL(ticket.url,location.origin);
    if(target.origin!==location.origin||!/^\/transfer\/[a-f0-9]{48}$/.test(target.pathname))
      throw Error('The original customer download is unavailable.');
    const link=node('a');link.href=target.href;link.download='';link.hidden=true;
    document.body.append(link);link.click();link.remove();
  });}
  async function hashBytes(raw){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');}
  function base64(raw){const bytes=new Uint8Array(raw),parts=[];
    for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    return btoa(parts.join(''));}
  async function uploaded(file,pdf){
    if(!file||file.size<1||file.size>28*MiB)throw Error('Select a complete file of at most 28 MiB.');
    const raw=await file.arrayBuffer();
    if(pdf&&String.fromCharCode(...new Uint8Array(raw).subarray(0,5))!=='%PDF-')
      throw Error('Select the complete PDF file: '+file.name);
    return {name:file.name,bytes:raw.byteLength,sha256:await hashBytes(raw),base64:base64(raw)};
  }
  function drawFiles(){
    $('pdf-bundle-file-order').replaceChildren();
    const total=state.files.reduce((sum,file)=>sum+file.bytes,0);
    $('pdf-bundle-file-count').textContent=state.files.length+' complete PDFs · '+size(total)+
      (state.pending?' · Reading the selected complete files':'');
    for(const [index,file]of state.files.entries()){
      const row=node('div',undefined,'export-card');row.append(node('strong',(index+1)+'. '+file.name),
        node('small',size(file.bytes)+' · '+file.sha256,'mono'));
      const actions=node('div',undefined,'action-row');
      const up=button('Move up',async()=>{[state.files[index-1],state.files[index]]=[state.files[index],state.files[index-1]];drawFiles();});
      const down=button('Move down',async()=>{[state.files[index],state.files[index+1]]=[state.files[index+1],state.files[index]];drawFiles();});
      up.disabled=index===0||state.pending>0;down.disabled=index===state.files.length-1||state.pending>0;
      const remove=button('Remove',async()=>{state.files.splice(index,1);drawFiles();});remove.disabled=state.pending>0;
      actions.append(up,down,remove);row.append(actions);$('pdf-bundle-file-order').append(row);
    }
    $('pdf-bundle-stage').disabled=state.pending>0||state.submitting||!state.files.length;
  }
  async function readFiles(){
    const incoming=[...$('pdf-bundle-files').files];$('pdf-bundle-files').value='';
    const epoch=++state.fileEpoch,existing=state.files.slice();
    if(existing.length+incoming.length>2000)throw Error('Select at most 2,000 complete PDFs in one bundle.');
    if(existing.reduce((n,x)=>n+x.bytes,0)+incoming.reduce((n,x)=>n+x.size,0)>28*MiB)
      throw Error('Browser PDF uploads can total 28 MiB. Receive a complete local assembly plan for a larger bundle.');
    state.pending++;drawFiles();
    try{
      const files=[];
      for(const file of incoming){
        const value=await uploaded(file,true);if(epoch!==state.fileEpoch)return;
        files.push({id:'pdf-'+crypto.randomUUID(),...value});
      }
      if(epoch===state.fileEpoch)state.files=[...existing,...files];
    }finally{state.pending--;drawFiles();}
  }
  async function refresh(){
    const epoch=++state.listEpoch,value=await request('state?offset='+state.listOffset+'&limit=20');
    if(epoch!==state.listEpoch)return;
    state.host=value;
    if(!$('pdf-bundle-origin').value&&value.merchantOrigin)$('pdf-bundle-origin').value=value.merchantOrigin;
    $('pdf-bundle-list').replaceChildren();
    for(const row of value.assemblies.items){
      const label=(row.name??row.id)+(row.counts?' · '+row.counts.originalFiles+' PDFs':' · '+human(row.state));
      $('pdf-bundle-list').append(button(label,()=>load(row.id,row.sourceSha256)));
    }
    if(!value.assemblies.items.length)$('pdf-bundle-list').append(node('p','No existing-PDF bundles have been saved yet.','muted'));
    const page=value.assemblies;
    $('pdf-bundle-page').textContent=page.total?(page.offset+1)+'–'+Math.min(page.offset+page.limit,page.total)+' of '+page.total:'0 saved';
    $('pdf-bundle-previous').disabled=page.offset===0;$('pdf-bundle-next').disabled=page.offset+page.limit>=page.total;
  }
  function drawSources(){
    const selected=state.selected;if(!selected)return;
    const rows=selected.originalFiles,offset=state.sourceOffset;$('pdf-bundle-originals').replaceChildren();
    for(const [index,file]of rows.slice(offset,offset+100).entries()){
      const row=node('tr'),info=node('td'),receive=node('td');
      info.append(node('strong',file.filename),node('small',file.id),node('small',size(file.bytes)));
      receive.append(downloadButton('Download original PDF',selection('original',{fileId:file.id})));
      row.append(node('td',offset+index+1),info,receive);$('pdf-bundle-originals').append(row);
    }
    $('pdf-bundle-source-page').textContent=(offset+1)+'–'+Math.min(offset+100,rows.length)+' of '+rows.length;
    $('pdf-bundle-source-previous').disabled=offset===0;$('pdf-bundle-source-next').disabled=offset+100>=rows.length;
  }
  function draw(selected){
    state.selected=selected;$('pdf-bundle-detail').hidden=false;
    $('pdf-bundle-current-name').textContent=selected.request.name;
    $('pdf-bundle-counts').textContent=selected.counts.originalFiles+' original PDFs · '+selected.counts.volumes+
      ' ordered volumes · '+selected.counts.paidMerges+' paid assemblies · '+selected.counts.unchangedVolumes+' unchanged PDF volumes';
    $('pdf-bundle-task-detail').textContent='Customer task: '+selected.request.taskReference+' · Merchant: '+selected.request.merchantOrigin;
    $('pdf-bundle-source-sha').textContent='Complete source SHA256 '+selected.sourceSha256;
    $('pdf-bundle-price').replaceChildren();
    for(const total of selected.native?.totals??[]){
      const box=node('div',undefined,'price-total'),details=node('dl');
      box.append(node('strong',total.maximumAtomic+' atomic units maximum · '+total.documents+' assembly requests'));
      for(const [name,key]of [['Network','network'],['Asset','asset'],['Recipient','payTo'],['Payment flow','paymentFlow']])
        details.append(node('dt',name),node('dd',total[key]));
      box.append(details);$('pdf-bundle-price').append(box);
    }
    if(!selected.counts.paidMerges)$('pdf-bundle-price').append(node('p','Every volume preserves one original PDF. These volumes are ready to export.'));
    else if(!selected.native)$('pdf-bundle-price').append(node('p','Prepare the actual assembly price before purchasing.'));
    $('pdf-bundle-price-sha').textContent=selected.native?'Exact native plan SHA256 '+selected.native.planSha256:'';
    const sourcePending=selected.sourceState==='CONTINUATION_REQUIRED';
    $('pdf-bundle-materialize').hidden=!sourcePending;
    const busy=state.operation?.state==='RUNNING'&&state.operation.assemblyId===selected.id||Boolean(selected.active);
    $('pdf-bundle-materialize').disabled=busy;
    $('pdf-bundle-prepare').disabled=busy||sourcePending||!selected.counts.paidMerges;
    $('pdf-bundle-run').disabled=busy||!selected.native||selected.complete;
    $('pdf-bundle-receive').disabled=busy||!selected.native;
    $('pdf-bundle-export').disabled=busy||!selected.complete;
    drawSources();$('pdf-bundle-volumes').replaceChildren();
    for(const volume of selected.volumes){
      const row=node('tr'),pdf=node('td');
      pdf.append(volume.received?downloadButton('Download volume',selection('pdf',{volumeId:volume.id})):
        node('span','Continue original receiving'));
      row.append(node('td',volume.index),node('td',volume.fileIds.join(', ')),node('td',human(volume.state)),pdf);
      $('pdf-bundle-volumes').append(row);
    }
    $('pdf-bundle-exports').replaceChildren();
    for(const saved of selected.exports){
      const card=node('div',undefined,'export-card');
      card.append(node('strong',saved.complete?'Complete customer PDF bundle':'Continue the original bundle export'));
      if(!saved.complete)card.append(node('p',saved.error?.message??saved.id),button('Continue this export',()=>action('export',{exportId:saved.id})));
      else{
        const links=node('div',undefined,'download-list');
        const files=[['Download complete PDF bundle','complete-pdf-bundle.tar'],['Readable bundle','index.html'],
          ['Complete original PDF sources','assembly-plan.json'],['Complete delivery JSON','assembly-delivery.json'],['Volume CSV','assembly-results.csv']];
        if(saved.native)files.push(['Original paid Collection','documents.tar']);
        for(const [label,file]of files)links.append(downloadButton(label,selection('export',{exportId:saved.id,file})));
        card.append(links);
      }
      $('pdf-bundle-exports').append(card);
    }
  }
  async function load(id,sha256){
    const epoch=++state.selectionEpoch;state.selectedId=id;state.followId=id;state.sourceOffset=0;
    const query=new URLSearchParams({id,...(sha256?{sourceSha256:sha256}:{})});
    const value=await request('assembly?'+query.toString());
    if(epoch!==state.selectionEpoch||state.selectedId!==id)return;
    draw(value);if(state.visible)history.replaceState(null,'','/documents/?pdf='+encodeURIComponent(id)+location.hash);
    if(value.active)watch(value.active);
  }
  function watch(operation){
    if(state.timer)clearTimeout(state.timer);
    state.operation=operation;$('pdf-bundle-operation').hidden=false;
    $('pdf-bundle-operation-title').textContent=labels[operation.kind]??human(operation.kind);
    $('pdf-bundle-operation-detail').textContent=operation.assemblyId+' · '+human(operation.state)+
      (operation.progress?' · '+human(operation.progress.stage)+(operation.progress.index===undefined?'':' '+operation.progress.index+' / '+operation.progress.total):'');
    $('pdf-bundle-operation-error').textContent=operation.error?.message??'';
    $('pdf-bundle-stop').hidden=operation.state!=='RUNNING';
    if(state.selected)draw({...state.selected,active:operation.assemblyId===state.selected.id&&operation.state==='RUNNING'?operation:null});
    if(operation.state==='RUNNING')state.timer=setTimeout(()=>poll(operation.id),1500);
  }
  async function poll(operationId){
    if(state.operation?.id!==operationId)return;
    try{
      const value=await request('operation?operationId='+encodeURIComponent(operationId));
      if(state.operation?.id!==operationId)return;watch(value);
      if(value.state!=='RUNNING'){
        await refresh();
        if(state.followId===value.assemblyId&&value.state!=='FAILED')await load(value.assemblyId,value.result?.sourceSha256);
        else if(state.visible&&state.selectedId===value.assemblyId)await load(value.assemblyId);
      }
    }catch(error){
      if(state.operation?.id!==operationId)return;
      if(error.status===404){
        state.operation=null;$('pdf-bundle-operation').hidden=true;await refresh();
        if(state.selectedId)await guard(()=>load(state.selectedId));return;
      }
      $('pdf-bundle-operation-error').textContent=error.message;
      state.timer=setTimeout(()=>poll(operationId),5000);
    }
  }
  async function start(kind,input){
    const operation=await request(kind,{method:'POST',body:input});state.followId=input.id;watch(operation);await refresh();
  }
  async function action(kind,extra={}){
    const input=selection(null,extra);
    if(kind==='run'){
      if(!HASH.test(state.selected.native?.planSha256??''))throw Error('Prepare and review the original saved price first.');
      input.planSha256=state.selected.native.planSha256;
    }
    await start(kind,input);
  }
  async function stage(){
    if(state.pending||state.submitting)throw Error('Wait for the complete PDF inputs to finish loading.');
    if(!state.files.length)throw Error('Select at least one complete PDF.');
    const request={schema:'stellar-forge.document-assembly.v1',id:$('pdf-bundle-id').value.trim(),
      name:$('pdf-bundle-name').value.trim(),title:$('pdf-bundle-title').value.trim(),
      taskReference:$('pdf-bundle-task').value.trim(),merchantOrigin:$('pdf-bundle-origin').value.trim(),
      maxVolumeBytes:10000000,settings:{strict:true}};
    state.submitting=true;drawFiles();
    try{await start('stage',{id:request.id,request,files:state.files.map(file=>({...file}))});}
    finally{state.submitting=false;drawFiles();}
  }
  async function readRestore(){
    const epoch=++state.restoreEpoch;state.restore=null;$('pdf-bundle-restore-file').disabled=false;
    $('pdf-bundle-restore-info').textContent='';
    if(!$('pdf-bundle-restore-upload').files.length)return;
    state.pending++;
    try{
      const file=await uploaded($('pdf-bundle-restore-upload').files[0],false);
      const raw=Uint8Array.from(atob(file.base64),x=>x.charCodeAt(0));
      const plan=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      if(plan.schema!=='stellar-forge.document-assembly-plan.v1'||typeof plan.request?.id!=='string')
        throw Error('Select the original complete assembly source plan.');
      if(epoch!==state.restoreEpoch)return;
      state.restore=file;$('pdf-bundle-restore-id').value=plan.request.id;$('pdf-bundle-restore-sha').value=file.sha256;
      $('pdf-bundle-restore-file').value='';$('pdf-bundle-restore-file').disabled=true;
      $('pdf-bundle-restore-info').textContent=file.name+' · '+size(file.bytes);
    }finally{state.pending--;drawFiles();}
  }
  async function open(id){
    state.visible=true;onOpen();$('pdf-bundles-panel').hidden=false;await refresh();
    if(id)await load(id);
    else if(!state.selected)history.replaceState(null,'','/documents/?pdf=#'+location.hash.slice(1));
    if(!state.operation&&state.host?.active.length)watch(state.host.active[0]);
  }
  function hide(){state.visible=false;state.followId=null;$('pdf-bundles-panel').hidden=true;state.selectionEpoch++;}
  $('pdf-bundle-form').addEventListener('submit',event=>{event.preventDefault();guard(stage);});
  $('pdf-bundle-files').addEventListener('change',()=>guard(readFiles));
  $('pdf-bundle-clear').addEventListener('click',()=>{state.fileEpoch++;state.files=[];drawFiles();});
  $('pdf-bundles-refresh').addEventListener('click',()=>guard(refresh));
  $('pdf-bundle-previous').addEventListener('click',()=>guard(async()=>{state.listOffset=Math.max(0,state.listOffset-20);await refresh();}));
  $('pdf-bundle-next').addEventListener('click',()=>guard(async()=>{state.listOffset+=20;await refresh();}));
  $('pdf-bundle-refresh').addEventListener('click',()=>guard(()=>load(state.selectedId)));
  $('pdf-bundle-source-previous').addEventListener('click',()=>{state.sourceOffset=Math.max(0,state.sourceOffset-100);drawSources();});
  $('pdf-bundle-source-next').addEventListener('click',()=>{state.sourceOffset+=100;drawSources();});
  for(const name of ['materialize','prepare','run','receive','export'])$('pdf-bundle-'+name).addEventListener('click',()=>guard(()=>action(name)));
  $('pdf-bundle-source').addEventListener('click',()=>{if(state.selected)downloadButton('',selection('source')).click();});
  $('pdf-bundle-stop').addEventListener('click',()=>guard(async()=>{
    if(state.operation)watch(await request('cancel',{method:'POST',body:{operationId:state.operation.id}}));}));
  $('pdf-bundle-restore-upload').addEventListener('change',()=>guard(readRestore));
  $('pdf-bundle-restore-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{
    if(state.pending)throw Error('Wait for the complete source to finish loading.');
    await start('restore',{id:$('pdf-bundle-restore-id').value.trim(),sourceSha256:$('pdf-bundle-restore-sha').value.trim().toLowerCase(),
      ...(state.restore?{source:state.restore}:{sourceFile:$('pdf-bundle-restore-file').value.trim()})});
  });});
  $('open-pdf-bundles').addEventListener('click',()=>guard(()=>open()));
  const suffix=new Date().toISOString().replaceAll('-','').replaceAll(':','').replace('T','-').slice(0,15);
  $('pdf-bundle-id').value='pdfs-'+suffix;$('pdf-bundle-name').value='Customer PDF bundle';
  $('pdf-bundle-title').value='Customer documents';
  drawFiles();
  return Object.freeze({open,hide,refresh});
}
