// Original OpenCage CSV intake, retained row review and joined customer delivery.
export function createBatchWorkbench({api,download,readBytes,notify,action,perform,node,empty,getWorkspace,isBusy,openRequest,outcomeText}){
  const $=id=>document.getElementById(id),json=value=>JSON.stringify(value,null,2);
  const qs=values=>new URLSearchParams(values).toString();
  const S={workspace:null,identity:null,readOnly:false,visible:false,source:null,review:null,reviewInput:null,
    addressColumns:[''],batches:[],batchId:null,live:null,mode:'live',offset:0,filter:'',row:null,rowOrdinal:null,
    rowSummary:null,chosen:null,deliveries:[],delivery:null,deliveryPage:null,exportId:null,
    batchEpoch:0,rowEpoch:0,deliveryEpoch:0,pollTimer:null,polling:false,closed:false};
  const terminalRuns=new Set(['COMPLETE','STOPPED','NEEDS_RECONCILIATION','PAUSED_QUOTA','PAUSED_RATE','PAUSED_AUTH','PAUSED_SOURCE','PAUSED_ERROR']);
  const retryStatuses=new Set(['EXCEPTION','NEEDS_RECONCILIATION']);
  const product=()=>S.workspace?.configuration?.plan.products.find(item=>item.id===$('batch-product').value);
  const currentPage=()=>S.mode==='delivery'?S.deliveryPage:S.live;
  const currentReview=()=>S.mode==='delivery'?S.deliveryPage?.review:S.live?.review;
  const currentRow=()=>S.row?.result;
  const mutable=()=>!S.readOnly&&S.mode==='live';
  const active=()=>S.live?.active??null;
  const anyActive=()=>Boolean(active()||S.batches.some(item=>item.active));
  const storageKey=name=>'geocode-csv-'+name+':'+S.identity;
  const batchKey=id=>storageKey('run')+':'+id;
  const setSession=(key,value)=>{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,value);};
  function facts(id,items){
    const target=$(id);empty(target);
    for(const [label,value] of items)target.append(node('dt',label),node('dd',value==null?'—':value));
  }
  function dynamicButton(label,callback,className='text-button'){
    const button=node('button',label,className);button.type='button';
    button.addEventListener('click',event=>perform(callback,event));return button;
  }
  function option(value,label){const result=node('option',label);result.value=value;return result;}
  function chooseOptions(select,values,chosen='',placeholder='Choose a column'){
    empty(select);select.append(option('',placeholder));
    for(const value of values)select.append(option(value,value));
    if(values.includes(chosen))select.value=chosen;
  }
  function clearRow(){
    S.row=null;S.rowOrdinal=null;S.rowSummary=null;S.chosen=null;S.rowEpoch++;
    $('batch-row-empty').hidden=false;$('batch-row-content').hidden=true;
  }
  function invalidateReview(){
    S.review=null;S.reviewInput=null;$('batch-review-panel').hidden=true;syncButtons();
  }
  function sourcePreview(value){
    $('batch-source-summary').textContent=value.rowCount+' data rows · '+value.sourceBytes.toLocaleString()+' bytes · SHA-256 '+value.sourceSha256;
    $('batch-source-details').hidden=false;
    empty($('batch-source-head'));empty($('batch-source-preview'));
    const heading=node('tr');heading.append(node('th','Row'));
    for(const header of value.headers)heading.append(node('th',header));
    $('batch-source-head').append(heading);
    for(const item of value.preview){
      const row=node('tr');row.append(node('th',item.ordinal));
      for(const cell of item.values)row.append(node('td',cell,'wrap'));
      $('batch-source-preview').append(row);
    }
  }
  function renderAddressColumns(){
    const target=$('batch-address-columns');empty(target);
    for(const [index,value] of S.addressColumns.entries()){
      const row=node('div',null,'batch-address-row'),select=node('select');
      select.setAttribute('aria-label','Address column '+(index+1));
      chooseOptions(select,S.source?.headers??[],value);
      select.addEventListener('change',()=>{S.addressColumns[index]=select.value;invalidateReview();});
      const up=dynamicButton('↑',()=>{[S.addressColumns[index-1],S.addressColumns[index]]=[S.addressColumns[index],S.addressColumns[index-1]];renderAddressColumns();invalidateReview();});
      const down=dynamicButton('↓',()=>{[S.addressColumns[index+1],S.addressColumns[index]]=[S.addressColumns[index],S.addressColumns[index+1]];renderAddressColumns();invalidateReview();});
      const remove=dynamicButton('Remove',()=>{S.addressColumns.splice(index,1);renderAddressColumns();invalidateReview();});
      up.setAttribute('aria-label','Move address column '+(index+1)+' up');up.dataset.addressUp=String(index);
      down.setAttribute('aria-label','Move address column '+(index+1)+' down');down.dataset.addressDown=String(index);
      remove.dataset.addressRemove=String(index);row.append(select,up,down,remove);target.append(row);
    }
    syncButtons();
  }
  function renderOptionColumns(saved={}){
    const target=$('batch-option-columns');empty(target);
    for(const name of product()?.options??[]){
      const row=node('div',null,'batch-option-row'),label=node('label',name),select=node('select');
      select.id='batch-option-'+name;label.htmlFor=select.id;select.dataset.option=name;
      chooseOptions(select,S.source?.headers??[],saved[name]??'','Use fixed value or default');
      select.addEventListener('change',invalidateReview);row.append(label,select);target.append(row);
    }
    const selected=product();
    $('batch-option-help').textContent=selected
      ?'Allowed options: '+(selected.options.join(', ')||'none')+'. Product defaults: '+json(selected.defaults??{})
      :'Choose a product to review its provider options.';
  }
  function renderMapping(mapping=null){
    const headers=S.source?.headers??[];
    chooseOptions($('batch-id-column'),headers,mapping?.idColumn??'','Use source row number');
    chooseOptions($('batch-query-column'),headers,mapping?.queryColumn??'');
    chooseOptions($('batch-latitude'),headers,mapping?.latitudeColumn??'');
    chooseOptions($('batch-longitude'),headers,mapping?.longitudeColumn??'');
    S.addressColumns=mapping?.addressColumns?[...mapping.addressColumns]:[''];
    if(mapping){
      $('batch-query-mode').value=mapping.queryColumn!==undefined?'query':mapping.addressColumns?'address':'coordinates';
      $('batch-separator').value=mapping.separator??', ';$('batch-options').value=json(mapping.options??{});
    }
    renderAddressColumns();renderOptionColumns(mapping?.optionColumns??{});queryMode();
  }
  function queryMode(){
    const reverse=product()?.mode==='reverse',select=$('batch-query-mode');
    for(const item of select.options)item.disabled=item.value==='address'?reverse:item.value==='coordinates'?!reverse:false;
    if((reverse&&select.value==='address')||(!reverse&&select.value==='coordinates'))select.value='query';
    $('batch-query-fields').hidden=select.value!=='query';
    $('batch-address-fields').hidden=select.value!=='address';
    $('batch-coordinate-fields').hidden=select.value!=='coordinates';
    syncButtons();
  }
  function encode(bytes){
    let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    return btoa(binary);
  }
  async function readSource(bytes,fileName,mapping=null){
    if(!bytes.byteLength||bytes.byteLength>2097152)throw Error('Choose a nonempty CSV file no larger than 2 MiB.');
    const csvBase64=encode(new Uint8Array(bytes)),parsed=await api('/api/batch/source',{csvBase64});
    S.source={...parsed,csvBase64,fileName};invalidateReview();sourcePreview(parsed);renderMapping(mapping);
    notify('Read '+parsed.rowCount+' original CSV rows. Review the product and column mapping before preparing.');
  }
  function reviewedInput(){
    if(!S.source)throw Error('Read the original CSV columns first.');
    const selected=product();if(!selected)throw Error('Choose a geocoding product.');
    const fixed=JSON.parse($('batch-options').value||'{}');
    if(!fixed||typeof fixed!=='object'||Array.isArray(fixed))throw Error('Fixed options must be a JSON object.');
    const mapping={idColumn:$('batch-id-column').value||null,options:fixed,optionColumns:{}};
    const mode=$('batch-query-mode').value;
    if(mode==='query')mapping.queryColumn=$('batch-query-column').value;
    else if(mode==='address'){mapping.addressColumns=[...S.addressColumns];mapping.separator=$('batch-separator').value;}
    else {mapping.latitudeColumn=$('batch-latitude').value;mapping.longitudeColumn=$('batch-longitude').value;}
    for(const select of $('batch-option-columns').querySelectorAll('select'))if(select.value)mapping.optionColumns[select.dataset.option]=select.value;
    return {csvBase64:S.source.csvBase64,fileName:S.source.fileName,label:$('batch-label').value,
      productId:selected.id,mapping,reuseRequestIds:$('batch-reuse').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),
      supersedesBatchId:$('batch-supersedes').value||null};
  }
  function renderReview(value){
    $('batch-review-panel').hidden=false;
    facts('batch-review-facts',[['Valid rows',value.validRows],['Invalid rows',value.invalidRows],['Unique queries',value.uniqueQueries],
      ['Estimated fresh queries',value.estimatedFreshQueries],['Retained results to reuse',value.reuse.length],
      ['Product / mode',value.productId+' / '+value.mode],['Review SHA-256',value.reviewSha256]]);
    empty($('batch-review-preview'));
    for(const item of value.preview){
      const row=node('tr');row.append(node('td',item.ordinal+' / '+item.sourceId,'wrap'),
        node('td',item.query?.q??'—','wrap'),node('td',item.error??'Ready','wrap'));$('batch-review-preview').append(row);
    }
    $('batch-review-native').textContent=json(value);syncButtons();
  }
  function listLabel(value){return (value.review?.label??value.label??value.batchId)+' · '+value.batchId;}
  function renderLists(){
    const previous=$('batch-supersedes').value;
    empty($('batch-select'));$('batch-select').append(option('','Choose a retained batch'));
    empty($('batch-supersedes'));$('batch-supersedes').append(option('','New source selection'));
    for(const item of S.batches){
      $('batch-select').append(option(item.batchId,listLabel(item)));$('batch-supersedes').append(option(item.batchId,listLabel(item)));
    }
    $('batch-select').value=S.batchId??'';
    if(S.batches.some(item=>item.batchId===previous))$('batch-supersedes').value=previous;
  }
  async function refreshLists(){
    if(S.readOnly)return;
    S.batches=await api('/api/batches');renderLists();
  }
  function rememberRun(value){
    const key=batchKey(value.batchId),pending=sessionStorage.getItem(key);
    if(value.active)setSession(key,value.active.runId);
    else if(pending&&value.run?.id===pending&&terminalRuns.has(value.run.state))setSession(key,null);
  }
  function clearPoll(){if(S.pollTimer!==null)clearTimeout(S.pollTimer);S.pollTimer=null;}
  function schedulePoll(){
    clearPoll();
    if(S.closed||!S.visible||S.readOnly||S.mode!=='live'||!active()||document.hidden)return;
    S.pollTimer=setTimeout(async()=>{
      S.pollTimer=null;
      if(isBusy()||S.polling){schedulePoll();return;}
      S.polling=true;
      try{await refreshLive({poll:true});}catch(error){notify('Batch status refresh: '+error.message,true);}
      finally{S.polling=false;schedulePoll();}
    },3000);
  }
  function updateList(value){
    const index=S.batches.findIndex(item=>item.batchId===value.batchId);
    const summary={...value,rows:[]};if(index<0)S.batches.push(summary);else S.batches[index]=summary;
  }
  function acceptLive(value){
    S.live=value;S.batchId=value.batchId;S.offset=value.offset;rememberRun(value);updateList(value);renderLists();
    setSession(storageKey('selected'),value.batchId);renderRecords();syncButtons();schedulePoll();
  }
  async function refreshLive({poll=false}={}){
    if(!S.batchId||S.readOnly||S.mode!=='live')return;
    const epoch=++S.batchEpoch,id=S.batchId,offset=S.offset,filter=S.filter;
    const value=await api('/api/batch?'+qs({batchId:id,offset,limit:50,...(filter?{status:filter}:{})}));
    if(epoch!==S.batchEpoch||id!==S.batchId||S.mode!=='live')return;
    const oldSummary=S.rowSummary;
    acceptLive(value);
    if(poll&&S.rowOrdinal){
      const next=value.rows.find(row=>row.ordinal===S.rowOrdinal);
      if(next&&oldSummary&&(next.requestId!==oldSummary.requestId||next.result?.decisionRevision!==oldSummary.result?.decisionRevision||
          next.result?.responseSha256!==oldSummary.result?.responseSha256)){
        $('batch-row-explanation').textContent='This row has a newer retained result. Open the row again to review it; your current unsaved choice is still visible.';
      }
    }
  }
  async function selectBatch(id,provided=null){
    S.batchEpoch++;S.rowEpoch++;S.mode='live';S.batchId=id||null;S.live=null;S.offset=0;S.filter='';
    $('batch-filter').value='';clearRow();clearPoll();
    if(!id){renderRecords();syncButtons();return;}
    if(provided)acceptLive(provided);else await refreshLive();
    await refreshDeliveries();syncButtons();
  }
  function countsBlock(counts,delivered){
    const items=delivered
      ?[['Rows',counts.rows],['Selected',counts.selected],['Exceptions',counts.exceptions],['Invalid',counts.invalid],['Unrun',counts.unexecuted]]
      :[['Rows',S.live?.total],['Ready',counts.READY??0],['Candidates',counts.CANDIDATES??0],['Selected',counts.selected??0],
        ['No results',counts.NO_RESULTS??0],['Exceptions',counts.EXCEPTION??0],['Reconcile',counts.NEEDS_RECONCILIATION??0],['Invalid',counts.INVALID??0]];
    empty($('batch-counts'));
    for(const [title,count] of items){const group=node('div');group.append(node('dt',title),node('dd',count??0));$('batch-counts').append(group);}
  }
  function renderRecords(){
    const value=currentPage(),delivered=S.mode==='delivery';$('batch-empty').hidden=Boolean(value);$('batch-records').hidden=!value;
    $('batch-live-selection').hidden=S.readOnly;$('batch-readonly').hidden=!delivered;
    $('batch-live-actions').hidden=delivered||S.readOnly;$('batch-filter-label').hidden=delivered;
    $('batch-return-live').hidden=!delivered||S.readOnly||!S.batchId;
    $('batch-export-controls').hidden=S.readOnly||delivered;
    $('batch-intake').hidden=S.readOnly;
    if(!value)return;
    const review=value.review,counts=delivered?value.manifest.counts:value.counts;
    $('batch-record-label').textContent=review.label;
    $('batch-record-id').textContent=delivered?value.exportId:review.batchId;
    $('batch-state').textContent=delivered?'SAVED DELIVERY':value.active?.stopRequested?'STOP REQUESTED':value.active?'RUNNING':value.run?.state??'PREPARED';
    $('batch-run-note').textContent=delivered?'Saved batch '+value.manifest.batchId+' · revision '+value.manifest.revision:
      (value.run?'Run '+value.run.id+' · '+(value.run.note??(value.active?'The current provider request retains its original result.':'Last updated '+(value.run.finishedAt??value.run.startedAt))):'The source mapping is retained. Start executes the prepared requests.');
    countsBlock(counts,delivered);
    $('batch-progress-wrap').hidden=delivered;
    if(!delivered){
      const total=value.total,ready=value.counts.READY??0,done=Math.max(0,total-ready);
      $('batch-progress').max=Math.max(1,total);$('batch-progress').value=done;
      $('batch-progress-text').textContent=done+' of '+total+' rows have a retained outcome or source exception; '+ready+' are ready.';
    }
    empty($('batch-rows'));
    for(const entry of value.rows){
      const source=delivered?entry.source:entry,summary=delivered?entry.summary:entry.result;
      const row=node('tr'),cell=node('td'),button=dynamicButton(String(source.ordinal),()=>loadRow(source.ordinal));
      button.setAttribute('aria-label','Review source row '+source.ordinal);cell.append(button,node('div',source.sourceId,'hint wrap'));
      row.classList.toggle('selected',S.rowOrdinal===source.ordinal);
      const selected=summary?.selectedIndex??entry.selectedIndex??null;
      row.append(cell,node('td',source.query?.q??'—','wrap'),node('td',entry.status??source.error??'READY'),
        node('td',summary?.candidateCount??entry.candidateCount??'—'),
        node('td',selected===null?'Unselected':'Candidate '+selected));$('batch-rows').append(row);
    }
    if(!value.rows.length){const row=node('tr'),cell=node('td','No rows in this selection.');cell.colSpan=5;row.append(cell);$('batch-rows').append(row);}
    const total=delivered?value.total:value.filteredTotal;
    $('batch-page-count').textContent=(total?(value.offset+1)+'–'+(value.offset+value.rows.length):'0')+' of '+total+(delivered?' saved rows':' matching rows');
    $('batch-native').textContent=json(delivered?{identity:value.identity,manifest:value.manifest,review:value.review}:
      {review:value.review,revision:value.revision,counts:value.counts,run:value.run,active:value.active});
    syncButtons();
  }
  function rowStatus(){
    if(S.row?.source)return S.row.row.status;
    return S.rowSummary?.status??(S.row?.row.error?'INVALID':S.row?.result?.state.outcome??S.row?.result?.state.state??'READY');
  }
  async function loadRow(ordinal){
    const epoch=++S.rowEpoch,id=S.mode==='delivery'?S.exportId:S.batchId,mode=S.mode;
    const value=await api((mode==='delivery'?'/api/batch-delivery-row?'+qs({exportId:id,ordinal}):
      '/api/batch-row?'+qs({batchId:id,ordinal})));
    if(epoch!==S.rowEpoch||mode!==S.mode||id!==(mode==='delivery'?S.exportId:S.batchId))return;
    S.row=value;S.rowOrdinal=ordinal;S.rowSummary=currentPage()?.rows.find(row=>(row.source?.ordinal??row.ordinal)===ordinal)??null;
    S.chosen=value.result?.decision.current?.index??null;renderRow();renderRecords();
  }
  function renderRow(){
    const selected=currentRow(),source=S.row?.source??S.row?.row,review=currentReview();
    if(!source)return;
    $('batch-row-empty').hidden=true;$('batch-row-content').hidden=false;
    $('batch-row-id').textContent='Source row '+source.ordinal+' · ID '+source.sourceId;
    $('batch-row-query').textContent=source.query?.q??'Source row requires correction';
    $('batch-row-state').textContent=rowStatus();
    $('batch-row-explanation').textContent=source.error?'This row remains in the joined delivery with source error '+source.error+'. Use the retained CSV as a new reviewed source version to correct it.':
      selected?outcomeText(selected):'This valid source row has no provider result yet. Start the retained batch to execute its prepared request.';
    facts('batch-row-facts',[['Request',S.row.requestId??S.row.row.requestId??null],
      ['Attempt',S.row.attempt??S.row.row.attempt??null],['Native HTTP',selected?.state.providerStatus??null],
      ['Candidates',selected?.candidates.length??0],['Decision revision',selected?.decision.revision??null],
      ['Response SHA-256',selected?.responseSha256??null],['Capture identity',selected?.captureIdentity??null]]);
    facts('batch-row-source',source.values.map((value,index)=>[review?.headers[index]??'Extra column '+(index+1),value]));
    empty($('batch-candidates'));
    for(const candidate of selected?.candidates??[]){
      const row=node('tr'),cell=node('td'),radio=node('input');radio.type='radio';radio.name='batch-candidate';radio.value=String(candidate.index);
      radio.checked=S.chosen===candidate.index;radio.setAttribute('aria-label','Choose batch candidate '+candidate.index);
      const choose=()=>{
        if(isBusy()||!mutable())return;S.chosen=candidate.index;
        for(const child of $('batch-candidates').querySelectorAll('input'))child.checked=Number(child.value)===S.chosen;
        for(const child of $('batch-candidates').children)child.classList.toggle('selected',Number(child.dataset.index)===S.chosen);
        syncButtons();
      };
      radio.addEventListener('change',choose);row.addEventListener('click',choose);row.dataset.index=String(candidate.index);
      row.classList.toggle('selected',radio.checked);cell.append(radio);
      const location=node('td');location.append(node('div',candidate.formatted,'address'),node('div',json(candidate.components??{}),'components wrap'));
      row.append(cell,location,node('td',candidate.geometry.lat+', '+candidate.geometry.lng,'mono'),node('td',candidate.confidence+' / 10'));
      $('batch-candidates').append(row);
    }
    $('batch-candidates-wrap').hidden=!selected?.candidates.length;
    $('batch-decision-note').value=selected?.decision.current?.note??'';
    $('batch-decision-controls').hidden=!mutable()||selected?.state.providerStatus!==200;
    const retry=mutable()&&retryStatuses.has(rowStatus());
    $('batch-retry-controls').hidden=!retry;
    const uncertain=Boolean(selected&&!selected.captureIdentity&&selected.state.state!=='PREPARED');
    $('batch-uncertain-label').hidden=!uncertain;$('batch-retry-uncertain').checked=false;$('batch-retry-reason').value='';
    $('batch-open-request').hidden=!mutable()||!selected?.request.id;
    $('batch-row-native').textContent=json(S.row);syncButtons();
  }
  async function saveChoice(index){
    const row=S.row,value=currentRow();if(!row||!value||!mutable())throw Error('Open a current batch row first.');
    const ordinal=row.row.ordinal;
    const result=await api('/api/batch/select',{batchId:S.batchId,ordinal,expectedRequestId:row.requestId,
      responseSha256:value.responseSha256,expectedRevision:value.decision.revision,index,note:$('batch-decision-note').value});
    S.row=result;S.chosen=result.result?.decision.current?.index??null;await refreshLive();renderRow();
    notify('Saved source row '+ordinal+' at decision revision '+result.result.decision.revision+'.');
  }
  function renderDeliveries(){
    empty($('batch-delivery-select'));$('batch-delivery-select').append(option('','Choose a saved delivery'));
    for(const item of S.deliveries)$('batch-delivery-select').append(option(item.exportId,item.exportId+' · '+item.counts.rows+' rows'));
    $('batch-delivery-select').value=S.delivery?.exportId??'';
    $('batch-delivery-select-label').hidden=S.readOnly;
    const value=S.delivery;$('batch-delivery-empty').hidden=Boolean(value);$('batch-delivery-content').hidden=!value;
    if(!value){syncButtons();return;}
    const manifest=value.manifest;
    facts('batch-delivery-facts',[['Export',value.exportId],['Identity',value.identity],['Batch',manifest.batchId],['Revision',manifest.revision],
      ['Rows / selected',manifest.counts.rows+' / '+manifest.counts.selected],['Invalid / exceptions',manifest.counts.invalid+' / '+manifest.counts.exceptions],
      ['Unexecuted',manifest.counts.unexecuted],['Source SHA-256',manifest.sourceSha256],['Retained objects',manifest.objects.count]]);
    empty($('batch-delivery-files'));
    for(const file of manifest.files){
      const row=node('tr'),cell=node('td'),button=dynamicButton('Download',()=>deliveryDownload(file.name));
      button.setAttribute('aria-label','Download '+file.name);
      cell.append(button);row.append(node('td',file.name,'mono wrap'),node('td',file.bytes.toLocaleString()),cell);$('batch-delivery-files').append(row);
    }
    $('batch-delivery-native').textContent=json(manifest);syncButtons();
  }
  async function refreshDeliveries(){
    if(S.readOnly){renderDeliveries();return;}
    const epoch=++S.deliveryEpoch,id=S.batchId;
    const values=await api('/api/batch-deliveries'+(id?'?'+qs({batchId:id}):''));
    if(epoch!==S.deliveryEpoch||id!==S.batchId)return;
    S.deliveries=values;
    if(S.delivery&&!values.some(value=>value.exportId===S.delivery.exportId)&&S.mode!=='delivery')S.delivery=null;
    renderDeliveries();
  }
  async function selectDelivery(exportId,{open=false}={}){
    if(!exportId){S.delivery=null;renderDeliveries();return;}
    const epoch=++S.deliveryEpoch,value=await api('/api/batch-delivery?'+qs({exportId,offset:0,limit:50}));
    if(epoch!==S.deliveryEpoch)return;
    S.delivery=value;renderDeliveries();setSession(storageKey('delivery'),value.exportId);
    if(open)openSavedRows(value);
  }
  function openSavedRows(value){
    S.batchEpoch++;clearPoll();clearRow();S.mode='delivery';S.exportId=value.exportId;S.deliveryPage=value;S.offset=value.offset;
    renderRecords();syncButtons();
  }
  async function deliveryPage(offset){
    const id=S.exportId,epoch=++S.batchEpoch,value=await api('/api/batch-delivery?'+qs({exportId:id,offset,limit:50}));
    if(epoch!==S.batchEpoch||id!==S.exportId||S.mode!=='delivery')return;
    S.deliveryPage=value;S.offset=value.offset;clearRow();renderRecords();
  }
  async function deliveryDownload(name){
    if(!S.delivery)throw Error('Choose a saved delivery.');
    await download('/api/batch-delivery-file?'+qs({exportId:S.delivery.exportId,name}),name.split('/').at(-1));
  }
  async function rowDownload(kind){
    const value=currentRow();if(!value)throw Error('Choose a retained provider result.');
    if(S.mode==='delivery'){
      let hash=value.responseSha256;
      if(kind==='capture'){
        const manifestHash=S.row.row.captureManifestObject;
        if(!manifestHash)throw Error('This row has no retained capture record.');
        const bytes=await readBytes('/api/batch-delivery-file?'+qs({exportId:S.exportId,name:'objects/'+manifestHash}));
        const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        const files=manifest.files?.filter(file=>file.name==='capture.json')??[];
        if(manifest.identity!==value.captureIdentity||files.length!==1||!/^[a-f0-9]{64}$/.test(files[0].sha256))
          throw Error('The saved capture record does not match this row.');
        hash=files[0].sha256;
      }
      if(!hash)throw Error('This row has no retained '+kind+' file.');
      await download('/api/batch-delivery-file?'+qs({exportId:S.exportId,name:'objects/'+hash}),kind==='response'?'response.json':'capture.json');
    }else await download('/api/capture-file?'+qs({id:value.request.id,name:kind==='response'?'response.json':'capture.json'}),kind==='response'?'response.json':'capture.json');
  }
  function syncButtons(){
    const busy=isBusy(),readonly=S.readOnly,live=Boolean(S.live&&S.mode==='live'),result=currentRow(),page=currentPage();
    for(const control of $('view-batches').querySelectorAll('input,select,textarea,button'))control.disabled=busy;
    for(const control of $('batch-intake').querySelectorAll('input,select,textarea,button'))control.disabled=busy||readonly;
    const disable=(id,condition)=>{$(id).disabled=busy||condition;};
    disable('batch-load-source',readonly||!$('batch-file').files[0]);
    disable('batch-review',readonly||!S.source||!product());
    disable('batch-prepare',readonly||!S.review);
    disable('batch-add-address',readonly||!S.source||S.addressColumns.length>=16);
    for(const button of $('batch-address-columns').querySelectorAll('[data-address-up]'))button.disabled=busy||readonly||Number(button.dataset.addressUp)===0;
    for(const button of $('batch-address-columns').querySelectorAll('[data-address-down]'))button.disabled=busy||readonly||Number(button.dataset.addressDown)===S.addressColumns.length-1;
    for(const button of $('batch-address-columns').querySelectorAll('[data-address-remove]'))button.disabled=busy||readonly||S.addressColumns.length<=1;
    disable('batch-start',readonly||!live||anyActive()||!((S.live?.counts.READY??0)>0));
    disable('batch-stop',readonly||!live||!active()||active()?.stopRequested);
    disable('batch-reconcile',readonly||!live||anyActive());
    disable('batch-source-download',readonly||!live);disable('batch-copy-source',readonly||!live);
    disable('batch-export',readonly||!live||anyActive());
    disable('batch-prev',!page||page.offset===0);disable('batch-next',!page||page.nextOffset===null||page.nextOffset===undefined);
    const selectable=mutable()&&result?.state.providerStatus===200;
    for(const radio of $('batch-candidates').querySelectorAll('input'))radio.disabled=busy||!selectable;
    disable('batch-save-choice',!selectable||S.chosen===null);
    disable('batch-clear-choice',!selectable||result?.decision.current?.index==null);
    disable('batch-retry',!mutable()||!retryStatuses.has(rowStatus())||anyActive());
    disable('batch-response-download',!result?.responseSha256);
    disable('batch-capture-download',!result?.captureIdentity);
    disable('batch-open-request',!mutable()||!result?.request.id);
    disable('batch-open-delivery',!S.delivery);disable('batch-download-manifest',!S.delivery);
    queryModeOptions();
  }
  function queryModeOptions(){
    const reverse=product()?.mode==='reverse';
    for(const item of $('batch-query-mode').options)item.disabled=item.value==='address'?reverse:item.value==='coordinates'?!reverse:false;
  }
  function setWorkspace(value){
    const identity=value.identity??value.batchDelivery?.review.workspaceIdentity??null,changed=identity!==S.identity;
    S.workspace=value;S.readOnly=Boolean(value.readOnly);S.identity=identity;
    if(changed){
      S.batchEpoch++;S.deliveryEpoch++;clearRow();S.source=null;S.review=null;S.reviewInput=null;S.live=null;S.batchId=null;
      S.delivery=null;S.deliveryPage=null;S.deliveries=[];S.batches=[];S.mode='live';
      empty($('batch-product'));
      for(const item of value.configuration?.plan.products??[])$('batch-product').append(option(item.id,item.name+' · '+item.mode));
      $('batch-review-panel').hidden=true;$('batch-source-details').hidden=true;renderMapping();
    }
    if(value.batchDelivery){
      S.delivery=value.batchDelivery;S.deliveries=[value.batchDelivery.manifest];S.batchId=value.batchDelivery.manifest.batchId;
      $('batch-title').textContent=value.batchDelivery.review.label;
      $('batch-subtitle').textContent='Saved source rows, original provider results and named candidate decisions.';
      renderDeliveries();openSavedRows(value.batchDelivery);
    }
    $('batch-intake').hidden=S.readOnly;syncButtons();
  }
  async function activate(){
    if(S.readOnly){renderRecords();renderDeliveries();return;}
    await refreshLists();
    const preferred=S.batchId??sessionStorage.getItem(storageKey('selected'));
    if(preferred&&S.batches.some(item=>item.batchId===preferred)){
      if(S.mode==='live')await selectBatch(preferred);
      else {renderRecords();await refreshDeliveries();}
    }else {renderRecords();await refreshDeliveries();}
    schedulePoll();
  }
  async function refresh(){
    if(S.readOnly){
      const id=S.exportId;await selectDelivery(id,{open:true});return;
    }
    await refreshLists();
    if(S.mode==='live')await refreshLive();
    else if(S.exportId)await deliveryPage(S.offset);
    await refreshDeliveries();
  }
  function setVisible(visible){S.visible=visible;if(visible)schedulePoll();else clearPoll();}
  action('batch-load-source',async()=>{const file=$('batch-file').files[0];if(!file)throw Error('Choose a CSV file.');await readSource(await file.arrayBuffer(),file.name);});
  $('batch-file').addEventListener('change',()=>{S.source=null;invalidateReview();$('batch-source-details').hidden=true;$('batch-source-summary').textContent='Read the selected file to map its original columns.';});
  for(const id of ['batch-label','batch-id-column','batch-query-column','batch-latitude','batch-longitude','batch-separator','batch-options','batch-reuse','batch-supersedes'])
    $(id).addEventListener($(id).tagName==='SELECT'?'change':'input',invalidateReview);
  $('batch-query-mode').addEventListener('change',()=>{queryMode();invalidateReview();});
  $('batch-product').addEventListener('change',()=>{renderOptionColumns();queryMode();invalidateReview();});
  action('batch-add-address',()=>{S.addressColumns.push('');renderAddressColumns();invalidateReview();});
  action('batch-review',async()=>{
    const input=reviewedInput(),value=await api('/api/batch/review',input);
    if(value.sourceSha256!==S.source.sourceSha256||value.productId!==input.productId)throw Error('The reviewed source selection changed. Read the source again.');
    S.review=value;S.reviewInput=structuredClone(input);renderReview(value);
    notify('Reviewed '+value.rowCount+' rows and '+value.estimatedFreshQueries+' estimated fresh provider queries.');
  });
  action('batch-prepare',async()=>{
    if(!S.review||!S.reviewInput)throw Error('Review this exact source mapping first.');
    const value=await api('/api/batch/prepare',{...S.reviewInput,expectedReviewSha256:S.review.reviewSha256});
    await refreshLists();await selectBatch(value.batchId,value);notify('Prepared '+value.batchId+'. Start runs its retained requests.');
  });
  action('batch-select',()=>selectBatch($('batch-select').value),'change');
  action('batch-filter',async()=>{S.filter=$('batch-filter').value;S.offset=0;clearRow();await refreshLive();},'change');
  action('batch-refresh',refresh);
  action('batch-start',async()=>{
    const id=S.batchId;if(!id||!mutable())throw Error('Choose a live batch.');
    const key=batchKey(id);let runId=sessionStorage.getItem(key);
    if(!runId)runId='csv-run-'+crypto.randomUUID().replaceAll('-','').slice(0,24);
    setSession(key,runId);
    const result=await api('/api/batch/start',{batchId:id,runId});
    if(result.status)acceptLive(result.status);else await refreshLive();
    notify('Batch run '+result.runId+' · '+result.state+'.');
  });
  action('batch-stop',async()=>{
    const run=active();if(!run)throw Error('This batch has no active run.');
    await api('/api/batch/stop',{batchId:S.batchId,runId:run.runId});await refreshLive();
    notify('Stop requested for '+run.runId+'. The in-flight request retains its original result.');
  });
  action('batch-reconcile',async()=>{await api('/api/batch/reconcile',{batchId:S.batchId});await refreshLive();notify('Reconciled the original retained batch results.');});
  action('batch-source-download',()=>download('/api/batch-source?'+qs({batchId:S.batchId}),'source.csv'));
  action('batch-copy-source',async()=>{
    const review=S.live.review,bytes=await readBytes('/api/batch-source?'+qs({batchId:S.batchId}));
    $('batch-file').value='';$('batch-product').value=review.productId;$('batch-label').value=review.label;
    await readSource(bytes,review.fileName,review.mapping);$('batch-supersedes').value=review.batchId;
    $('batch-reuse').value=review.reuse.map(row=>row.requestId).join('\n');invalidateReview();$('batch-intake').scrollIntoView({block:'start'});
  });
  action('batch-prev',async()=>{const offset=Math.max(0,(currentPage()?.offset??0)-50);if(S.mode==='delivery')await deliveryPage(offset);else {S.offset=offset;clearRow();await refreshLive();}});
  action('batch-next',async()=>{const offset=currentPage()?.nextOffset;if(offset==null)return;if(S.mode==='delivery')await deliveryPage(offset);else {S.offset=offset;clearRow();await refreshLive();}});
  action('batch-save-choice',()=>saveChoice(S.chosen));action('batch-clear-choice',()=>saveChoice(null));
  action('batch-retry',async()=>{
    const value=currentRow(),row=S.row;if(!row||!mutable())throw Error('Choose a current batch row.');
    const result=await api('/api/batch/retry',{batchId:S.batchId,ordinal:row.row.ordinal,expectedRequestId:row.requestId,
      expectedResponseSha256:value?.responseSha256??null,reason:$('batch-retry-reason').value,
      acknowledgeUncertain:$('batch-retry-uncertain').checked});
    S.row=result;S.chosen=null;await refreshLive();S.rowSummary=S.live.rows.find(item=>item.ordinal===row.row.ordinal)??null;renderRow();
    notify('Prepared attempt '+result.attempt+' for source row '+row.row.ordinal+'. Start runs the new request.');
  });
  action('batch-response-download',()=>rowDownload('response'));action('batch-capture-download',()=>rowDownload('capture'));
  action('batch-open-request',()=>openRequest(currentRow().request.id));
  action('batch-refresh-deliveries',refreshDeliveries);
  action('batch-export',async()=>{
    if(!S.live||!mutable())throw Error('Choose a current batch.');
    const mib=Number($('batch-export-limit').value);if(!Number.isSafeInteger(mib)||mib<1||mib>512)throw Error('Choose a delivery limit from 1 to 512 MiB.');
    const result=await api('/api/batch/export',{batchId:S.batchId,expectedRevision:S.live.revision,maxBytes:mib*1048576});
    await refreshDeliveries();await selectDelivery(result.exportId,{open:true});notify('Prepared joined delivery '+result.exportId+'.');
  });
  action('batch-delivery-select',()=>selectDelivery($('batch-delivery-select').value),'change');
  action('batch-open-delivery',()=>openSavedRows(S.delivery));
  action('batch-download-manifest',()=>deliveryDownload('manifest.json'));
  action('batch-return-live',()=>selectBatch(S.batchId));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearPoll();else schedulePoll();});
  window.addEventListener('pagehide',()=>{S.closed=true;clearPoll();});
  window.addEventListener('pageshow',()=>{S.closed=false;schedulePoll();});
  return {setWorkspace,activate,setVisible,syncButtons,refresh};
}
