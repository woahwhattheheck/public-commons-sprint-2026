// MIT. The original live service owns page receiving, collections and transfer.
export function createCollectionView({root,api,esc,table,notify}) {
  let service=null,serviceIdentity=null,receivedIdentity=null,generation=0,busy=false;
  let selectedPages=[],opened=null,rowOffset=0,nextOffset=null,collectionRows=[];
  const node=id=>root.querySelector('#'+id);
  const query=values=>new URLSearchParams(values).toString();
  const label=page=>page.seenRows+' cumulative rows · '+page.rows+' rows · '+page.id.slice(0,12);
  const complete=page=>page.completion!=='continue'&&!page.nextRequest;
  const scalar=value=>value===null?'<span class="muted">NULL</span>':
    typeof value==='object'?esc(JSON.stringify(value)):esc(value);
  function requireService(){if(!service)throw new Error('Open a prepared live service first.');return service.id;}
  function setBusy(value){busy=value;root.setAttribute('aria-busy',String(value));
    for(const button of root.querySelectorAll('button,input,select'))button.disabled=value;
    if(!value){node('collection-previous').disabled=!opened||rowOffset===0;
      node('collection-next').disabled=!opened||nextOffset===null;}}
  async function run(label,operation){
    if(busy)return;const selected=generation;setBusy(true);notify(label+'…');
    try{await operation(selected);if(selected===generation)notify(label+' completed.');}
    catch(error){notify(error.message,true);}finally{setBusy(false);}
  }
  function pageChoices(){
    const groups=[...new Set((service?.received||[]).map(page=>page.queryFingerprint))].sort();
    const previous=node('collection-query').value;
    node('collection-query').innerHTML=groups.map(value=>'<option value="'+esc(value)+'">'+esc(value.slice(0,24))+'</option>').join('');
    if(groups.includes(previous))node('collection-query').value=previous;
    pageOptions();
    const buyers=service?.buyers||[],prior=node('collection-page-buyer').value;
    node('collection-page-buyer').innerHTML='<option value="">Original service request / previous returned cursor</option>'+
      buyers.map(buyer=>'<option value="'+esc(buyer.id)+'">'+esc(buyer.intentId)+' · '+esc(buyer.id.slice(0,12))+'</option>').join('');
    if(buyers.some(buyer=>buyer.id===prior))node('collection-page-buyer').value=prior;
  }
  function candidates(){const selected=node('collection-query').value;
    return (service?.received||[]).filter(page=>page.queryFingerprint===selected)
      .sort((a,b)=>a.seenRows-b.seenRows||a.id.localeCompare(b.id));}
  function pageOptions(){
    const prior=node('collection-page').value,pages=candidates();
    node('collection-page').innerHTML=pages.map(page=>'<option value="'+esc(page.id)+'">'+esc(label(page))+'</option>').join('');
    if(pages.some(page=>page.id===prior))node('collection-page').value=prior;
    const first=pages[0];node('collection-fields').placeholder=first?.columns?.join(', ')||'All delivered fields';
    node('collection-source-summary').textContent=first
      ?(first.query.select||[]).join(', ')+' · '+pages.length+' retained responses for the selected query'
      :'Receive the original customer response files to select a collection.';
  }
  function drawSelected(){
    const lookup=new Map((service?.received||[]).map(page=>[page.id,page]));
    node('collection-selected-pages').innerHTML=table(['Order','Original response','Request','Change order'],selectedPages.map((item,index)=>{
      const page=lookup.get(item.receivedId),buyer=(service?.buyers||[]).find(value=>value.id===item.buyerId);
      return [esc(index+1),page?esc(label(page)):'Original response '+esc(item.receivedId),
        buyer?esc(buyer.intentId):index===0?'Selected service request':'Previous returned cursor',
        '<button type="button" class="small" data-page-up="'+index+'" aria-label="Move page '+(index+1)+' up">Up</button> '+
        '<button type="button" class="small" data-page-down="'+index+'" aria-label="Move page '+(index+1)+' down">Down</button> '+
        '<button type="button" class="small" data-page-remove="'+index+'">Remove</button>'];
    }));
    node('collection-selected-count').textContent=selectedPages.length+' ordered responses selected';
  }
  function addPage(){
    requireService();const receivedId=node('collection-page').value,buyerId=node('collection-page-buyer').value;
    if(!receivedId)throw new Error('Select an original saved response.');
    if(selectedPages.some(page=>page.receivedId===receivedId))throw new Error('That original response is already selected.');
    selectedPages.push({receivedId,...(buyerId?{buyerId}:{})});drawSelected();
  }
  function chooseChain(){
    requireService();const pages=candidates();
    if(!pages.length)throw new Error('Receive the original response pages first.');
    let seen=0;
    for(let index=0;index<pages.length;index++){
      const page=pages[index];seen+=page.rows;
      if(page.seenRows!==seen||index<pages.length-1&&complete(page)||index===pages.length-1&&!complete(page))
        throw new Error('These responses contain competing or unfinished chains. Select the exact original pages in order.');
    }
    const buyerId=node('collection-page-buyer').value;
    selectedPages=pages.map((page,index)=>({receivedId:page.id,...(index===0&&buyerId?{buyerId}:{})}));drawSelected();
  }
  function downloadLink(path,text=path){
    const parameters={id:service.id,kind:'collection',recordId:opened.id,name:path};
    return '<a href="/api/live/file?'+esc(query(parameters))+'" download>'+esc(text)+'</a>';
  }
  function clearOpened(){
    opened=null;rowOffset=0;nextOffset=null;collectionRows=[];
    node('collection-detail').innerHTML='<p class="muted">Open a completed collection to inspect its original source and downloads.</p>';
    node('collection-rows').innerHTML='';node('collection-row-range').textContent='';
  }
  function drawOpened(){
    const value=opened;
    const acquisition=value.acquisition;
    node('collection-detail').innerHTML=
      '<h3>'+esc(value.title)+'</h3><div class="metric-row">'+
      '<div class="metric"><b>'+esc(value.rows)+'</b><span>RETAINED ROWS</span></div>'+
      '<div class="metric"><b>'+esc(value.pageCount)+'</b><span>ORIGINAL PAGES</span></div>'+
      '<div class="metric"><b>'+esc(value.completion)+'</b><span>COMPLETION</span></div></div>'+
      '<p>Entity '+esc(value.entitySet)+' · keys '+esc(value.keyFields.join(', '))+
      ' · source count '+esc(value.reportedCounts.length?value.reportedCounts.join(', '):'not supplied')+'</p>'+
      '<p class="muted">Received '+esc(acquisition.firstReceivedAt)+' through '+esc(acquisition.lastReceivedAt)+
      '. This acquisition window remains attached to the complete page chain.</p>'+
      (value.countConsistent?'':'<p>The supplier reported different counts during this acquisition. Review the original page counts before comparing this collection with another edition.</p>')+
      '<details><summary>Selected query and original identity</summary><pre>'+esc(JSON.stringify({
        query:value.query,queryFingerprint:value.queryFingerprint,sourceBinding:value.sourceBinding,
        metadataSha256:value.metadataSha256,collectionSha256:value.manifestSha256},null,2))+'</pre></details>'+
      '<h4 class="subheading">Delivered fields</h4><div class="table-wrap">'+
      table(['Source property','Declared type','Dataset column','Key','Null handling'],value.mapping.map(field=>[
        esc(field.path),esc(field.odataType),esc(field.name),field.key?'Key':'',
        'Original value and '+esc(field.name+'_state')]))+'</div>'+
      '<h4 class="subheading">Customer files</h4><div class="toolbar">'+
      ['dataset.csv','rows.jsonl','rows-index.jsonl','collection.json','projection.json'].map(path=>downloadLink(path)).join(' · ')+'</div>'+
      '<p class="muted">CSV keeps exact Decimal and Int64 text. Each field has a separate value/null state. Original rows retain the supplier values and types.</p>'+
      '<details><summary>Analysis source and all retained originals</summary><p>Use the complete workspace backup to transfer this collection. The Analysis source refers to its accompanying files by relative path.</p>'+
      '<div class="table-wrap">'+table(['File','Bytes','SHA-256'],value.retainedFiles.map(file=>[
        downloadLink(file.path),esc(file.bytes),'<code>'+esc(file.sha256)+'</code>']))+'</div></details>'+
      '<p><a href="/api/backup" download="odata-workspace.json">Download complete OData workspace</a> · Select this file with Restore workspace. Transfers up to 64 MiB use the browser; a larger file opens the original native restore command.</p>';
  }
  async function showRows(offset,token=generation){
    const chosen=opened;if(!chosen)return;
    const result=await api('/api/live/collection/rows?'+query({id:service.id,collectionId:chosen.id,offset,limit:100}));
    if(token!==generation||opened!==chosen)return;
    if(result.collectionSha256!==chosen.manifestSha256)throw new Error('The selected collection identity changed. Open it again.');
    rowOffset=result.offset;nextOffset=result.nextOffset;collectionRows=result.rows;
    node('collection-rows').innerHTML=table(['Row',...chosen.mapping.map(field=>field.path)],result.rows.map((row,index)=>[
      esc(result.offset+index+1),...chosen.mapping.map(field=>scalar(row[field.path]))]));
    node('collection-row-range').textContent=result.rows.length
      ?(result.offset+1)+'–'+(result.offset+result.rows.length)+' of '+result.total+' original rows':'0 original rows';
  }
  async function openCollection(id,token=generation){
    const serviceId=requireService();
    const value=await api('/api/live/collection?'+query({id:serviceId,collectionId:id}));
    if(token!==generation)return;opened=value;drawOpened();await showRows(0,token);
  }
  async function refreshCollections(token=generation){
    const values=await api('/api/live/collections?'+query({id:requireService()}));
    if(token!==generation)return;
    node('collection-inventory').innerHTML=table(['Collection','State','Rows','Pages','Open'],values.map(value=>[
      esc(value.title||value.id),esc(value.status),esc(value.rows??''),esc(value.pageCount??''),
      value.status==='READY'?'<button type="button" class="small" data-collection-open="'+esc(value.id)+'">Open</button>':
        'Resume the original selection with collection ID '+esc(value.id)]));
  }
  node('collection-query').onchange=()=>{selectedPages=[];pageOptions();drawSelected();};
  node('collection-add-page').onclick=()=>run('Select page',async()=>addPage());
  node('collection-use-chain').onclick=()=>run('Select complete saved chain',async()=>chooseChain());
  node('collection-clear-pages').onclick=()=>{if(busy)return;selectedPages=[];drawSelected();};
  node('collection-selected-pages').onclick=event=>{
    if(busy)return;const target=event.target.closest('button');if(!target)return;
    for(const [attribute,delta]of [['pageUp',-1],['pageDown',1]])if(target.dataset[attribute]!==undefined){
      const index=Number(target.dataset[attribute]),next=index+delta;
      if(next>=0&&next<selectedPages.length)[selectedPages[index],selectedPages[next]]=[selectedPages[next],selectedPages[index]];
      drawSelected();return;
    }
    if(target.dataset.pageRemove!==undefined){selectedPages.splice(Number(target.dataset.pageRemove),1);drawSelected();}
  };
  node('collection-create').onsubmit=event=>{
    event.preventDefault();
    // Capture the selected controls before run disables the form during the save.
    const data=new FormData(event.target),fields=String(data.get('fields')||'').trim();
    const input={id:service?.id,collectionId:String(data.get('collectionId')||''),pages:structuredClone(selectedPages)};
    if(String(data.get('title')||'').trim())input.title=String(data.get('title')).trim();
    if(fields)input.fields=fields.split(',').map(value=>value.trim()).filter(Boolean);
    void run('Receive complete collection',async token=>{
      requireService();
      if(!input.pages.length)throw new Error('Select the complete original response chain.');
      const result=await api('/api/live/collection',input);
      if(token!==generation)return;
      await refreshCollections(token);await openCollection(result.id,token);
    });
  };
  node('collection-refresh').onclick=()=>run('Open retained collections',refreshCollections);
  node('collection-inventory').onclick=event=>{
    const button=event.target.closest('[data-collection-open]');
    if(button)void run('Open collection',token=>openCollection(button.dataset.collectionOpen,token));
  };
  node('collection-previous').onclick=()=>run('Open original rows',token=>showRows(Math.max(0,rowOffset-100),token));
  node('collection-next').onclick=()=>run('Open original rows',token=>showRows(nextOffset,token));
  function setService(value){
    const identity=value?value.id+':'+value.sourceBinding:null;
    if(identity!==serviceIdentity){
      generation++;serviceIdentity=identity;service=value;receivedIdentity=null;selectedPages=[];clearOpened();
      node('collection-inventory').innerHTML='<p class="muted">Open retained collections to inspect completed customer work.</p>';
      node('collection-id').value='';node('collection-title').value='';node('collection-fields').value='';
    }else service=value;
    node('collection-service').textContent=value?value.name+' · '+value.id:'Open a prepared live service';
    const received=JSON.stringify({pages:(value?.received||[]).map(page=>[page.id,page.queryFingerprint,page.seenRows,page.nextRequest]),
      buyers:(value?.buyers||[]).map(buyer=>buyer.id)});
    if(received!==receivedIdentity){receivedIdentity=received;pageChoices();drawSelected();}
    if(!busy)setBusy(false);
  }
  setService(null);
  return {setService,refresh:()=>run('Open retained collections',refreshCollections)};
}
