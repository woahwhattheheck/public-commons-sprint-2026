import {installDocumentCorrections} from './corrections.mjs';
let corrections;
import {installPdfBundles} from './pdf-bundles.mjs';
let pdfBundles;
// MIT. Full document preparation and receiving on the original customer host.
const $=id=>document.getElementById(id);
const state={token:location.hash.slice(1),host:null,payload:null,selected:null,selectedId:null,
  selectedOffset:0,listOffset:0,listEpoch:0,selectionEpoch:0,operation:null,operationTimer:null,
  followId:null,sourceBusy:false,restoreSource:null,pendingReads:0,datasetRead:0,restoreRead:0,exampleRead:0,assembly:null,assemblyEpoch:0,assemblySelected:null,assemblyComposition:null,assemblyStaging:false};
const MiB=1048576,HASH=/^[a-f0-9]{64}$/;
const titles={correct:'Preparing selected replacement document sources',stage:'Preparing complete source documents',restore:'Receiving the original source plan',
  prepare:'Preparing the original merchant price',run:'Rendering the saved document set',
  receive:'Receiving existing paid jobs',export:'Exporting the complete received Collection',
  'assembly-stage':'Preparing the complete ordered PDF bundle','assembly-prepare':'Preparing the original assembly price',
  'assembly-run':'Assembling at the saved price','assembly-receive':'Receiving original assembly jobs',
  'assembly-export':'Exporting the complete PDF bundle'};
function node(tag,text,className){
  const value=document.createElement(tag);if(text!==undefined)value.textContent=text;
  if(className)value.className=className;return value;
}
function clear(value){value.replaceChildren();}
function notice(message,error=false){
  $('notice').hidden=!message;$('notice').textContent=message??'';
  $('notice').classList.toggle('error',error);
}
function readable(error){return error?.message||String(error);}
function human(value){return String(value??'').replaceAll('_',' ').toLowerCase();}
function bytes(value){return Number(value).toLocaleString()+' bytes';}
function linkDownload(label,input){
  const button=node('button',label);button.type='button';
  button.addEventListener('click',()=>guard(()=>download(input)));return button;
}
async function api(path,{method='GET',body}={}){
  const response=await fetch('/api/document-composition/'+path,{method,credentials:'same-origin',
    headers:{Authorization:'Bearer '+state.token,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  let result;try{result=await response.json();}catch{throw Error('The customer workspace returned an unreadable response.');}
  if(!response.ok)throw Object.assign(Error(result.error??'Customer request failed ('+response.status+').'),
    {code:result.error,status:response.status});
  return result;
}
async function guard(action){
  try{notice('');await action();}catch(error){notice(readable(error),true);}
}
function selection(kind,extra={}){
  if(!state.selected)throw Error('Select the saved document set first.');
  return {id:state.selected.id,sourceSha256:state.selected.sourceSha256,kind,...extra};
}
async function download(input){
  const ticket=await api('download',{method:'POST',body:input});
  const target=new URL(ticket.url,location.origin);
  if(target.origin!==location.origin||!/^\/transfer\/[a-f0-9]{48}$/.test(target.pathname))
    throw Error('The original customer download URL is unavailable.');
  const anchor=node('a');anchor.href=target.href;anchor.download='';anchor.hidden=true;
  document.body.append(anchor);anchor.click();anchor.remove();
}
async function hashBytes(raw){
  const hash=await crypto.subtle.digest('SHA-256',raw);
  return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function base64(raw){
  const bytes=new Uint8Array(raw),parts=[];
  for(let index=0;index<bytes.length;index+=32768)
    parts.push(String.fromCharCode(...bytes.subarray(index,index+32768)));
  return btoa(parts.join(''));
}
function decoded(file){
  const binary=atob(file.base64),raw=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)raw[index]=binary.charCodeAt(index);
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
}
async function upload(file,maxBytes){
  if(!file||file.size<1||file.size>maxBytes)throw Error('Select a complete file of at most '+bytes(maxBytes)+'.');
  const raw=await file.arrayBuffer();
  new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  return {name:file.name,bytes:raw.byteLength,sha256:await hashBytes(raw),base64:base64(raw)};
}
async function fileTask(action){
  state.pendingReads++;$('stage-button').disabled=true;
  try{return await action();}finally{state.pendingReads--;$('stage-button').disabled=state.sourceBusy||state.pendingReads>0;}
}
function providerChoice(id){return state.host?.providers?.find(provider=>provider.id===id);}
function stamp(){return new Date().toISOString().replaceAll('-','').replaceAll(':','').replace('T','-').slice(0,15);}
function readRequest(){
  let request;try{request=JSON.parse($('recipe').value);}catch{throw Error('Complete the composition recipe as valid JSON.');}
  if(!request||Array.isArray(request)||typeof request!=='object')throw Error('Use the complete composition recipe object.');
  request.id=$('composition-id').value.trim();request.name=$('composition-name').value.trim();
  request.provider=$('provider').value;request.merchantOrigin=$('merchant-origin').value.trim();
  return request;
}
function fileInfo(file){
  return file?file.name+' · '+bytes(file.bytes)+' · SHA256 '+file.sha256:'Select the complete source file.';
}
function showDataset(){
  const file=state.payload?.dataset;$('dataset-info').textContent=fileInfo(file);
  $('dataset-preview').textContent=file?decoded(file).slice(0,65536):'';
}
function showTemplates(request){
  clear($('template-files'));
  if(!Array.isArray(request.templates)||request.templates.length<1||request.templates.length>8)
    throw Error('The recipe needs one to eight document templates.');
  for(const template of request.templates){
    if(typeof template.id!=='string'||typeof template.source!=='string')throw Error('Each template needs its original ID and source path.');
    const box=node('div',undefined,'template'),heading=node('h3',template.id+' · '+human(template.format));
    const label=node('label','Complete template: '+template.source),input=node('input');input.type='file';
    input.accept=template.format==='markdown'?'.md,.markdown,text/markdown':'.html,.htm,text/html';
    const information=node('p',fileInfo(state.payload.templates[template.id]),'file-info');
    const details=node('details'),summary=node('summary','View template source (up to 64 KiB)');
    const preview=node('pre',undefined,'source-preview');
    const selected=state.payload.templates[template.id];if(selected)preview.textContent=decoded(selected).slice(0,65536);
    let generation=0;
    input.addEventListener('change',()=>guard(()=>fileTask(async()=>{
      const version=++generation,payload=state.payload;delete payload.templates[template.id];
      information.textContent='Reading the selected complete source file…';preview.textContent='';
      const file=await upload(input.files[0],MiB);
      if(version!==generation||payload!==state.payload||!input.isConnected)return;
      payload.templates[template.id]=file;information.textContent=fileInfo(file);preview.textContent=decoded(file).slice(0,65536);
      $('sample-note').hidden=false;$('sample-note').textContent='Selected files are retained as complete original UTF-8 sources.';
    })));

    label.append(input);details.append(summary,preview);box.append(heading,label,information,details);
    $('template-files').append(box);
  }
}
async function loadExample(){
  const version=++state.exampleRead;
  const provider=$('provider').value,kind=$('example-kind').value;
  const previousOrigin=$('merchant-origin').value.trim();
  const result=await api('example?kind='+encodeURIComponent(kind)+'&provider='+encodeURIComponent(provider));
  if(version!==state.exampleRead||provider!==$('provider').value||kind!==$('example-kind').value)return;
  result.request.id=(kind==='reports'?'reports-':'orders-')+stamp();
  result.request.merchantOrigin=previousOrigin||state.host.defaults.merchantOrigin||'';
  state.payload={dataset:result.dataset,templates:Object.assign(Object.create(null),result.templates)};
  $('composition-id').value=result.request.id;$('composition-name').value=result.request.name;
  $('merchant-origin').value=result.request.merchantOrigin;$('recipe').value=JSON.stringify(result.request,null,2);
  $('dataset-file').value='';$('sample-note').hidden=false;
  $('sample-note').textContent='Example records are for trying the workflow. Replace them with the complete customer dataset and templates for production.';
  showDataset();showTemplates(result.request);
}
function updateProvider(){
  const provider=providerChoice($('provider').value);
  const reportOption=$('example-kind').querySelector('option[value="reports"]');
  reportOption.disabled=provider&&!provider.formats.includes('markdown');
  if(reportOption.disabled&&$('example-kind').value==='reports')$('example-kind').value='orders';
  if(!$('recipe').value)return;
  let request;try{request=readRequest();}catch{return;}
  if(provider&&Array.isArray(request.templates))for(const template of request.templates)template.settings=structuredClone(provider.settings);
  $('recipe').value=JSON.stringify(request,null,2);
}
function showNew(){
  pdfBundles?.hide();corrections?.hide();
  state.selected=null;state.selectedId=null;state.followId=null;state.selectionEpoch++;
  $('new-panel').hidden=false;$('saved-panel').hidden=true;
  history.replaceState(null,'','/documents/#'+state.token);
  markSelected();
}
function markSelected(){
  for(const button of $('saved-list').querySelectorAll('button[data-id]'))
    button.classList.toggle('selected',button.dataset.id===state.selectedId);
}
async function refreshList(){
  const epoch=++state.listEpoch;
  const host=await api('state?offset='+state.listOffset+'&limit=20');
  if(epoch!==state.listEpoch)return;
  state.host=host;$('workspace-description').textContent=host.workspaceDirectory;
  clear($('saved-list'));
  const page=host.compositions;
  for(const item of page.items){
    const button=node('button');button.type='button';button.dataset.id=item.id;
    button.append(node('strong',item.name||item.id),node('small',
      item.counts?item.counts.documents+' documents · '+item.counts.parentTasks+' task references':human(item.state)));
    if(item.active)button.append(node('small',titles[item.active.kind]||human(item.active.kind)));
    button.addEventListener('click',()=>guard(()=>loadComposition(item.id)));
    const row=node('li');row.append(button);$('saved-list').append(row);
  }
  if(!page.items.length)$('saved-list').append(node('li','No document sets have been saved here yet.','muted'));
  $('list-page').textContent=page.total?(page.offset+1)+'–'+Math.min(page.offset+page.limit,page.total)+' of '+page.total:'0 saved';
  $('list-previous').disabled=page.offset===0;$('list-next').disabled=page.offset+page.limit>=page.total;
  markSelected();
}
function detailsRow(target,label,value){
  target.append(node('dt',label),node('dd',String(value??'')));
}
function drawCounts(selected){
  clear($('counts'));
  const complete=selected.native?.parentTasks.filter(task=>task.completeDocumentSet).length??0;
  const entries=[['Source records',selected.counts.sourceRecords],['Order or task references',selected.counts.parentTasks],
    ['Documents',selected.counts.documents],['PDFs received',selected.native?.receivedDocuments??0]];
  for(const [label,value]of entries){const tile=node('div',undefined,'count');tile.append(node('strong',Number(value).toLocaleString()),node('span',label));$('counts').append(tile);}
  if(selected.native)$('price-status').textContent=complete+' complete document sets; '+selected.native.receivedDocuments+
    ' of '+selected.native.documents+' PDFs received. The quote below remains attached to these original requests.';
}
function drawPrice(selected){
  clear($('price-totals'));const native=selected.native;
  $('quote-details').hidden=!native;$('price-unit-help').hidden=!native;
  $('price-status').textContent=native?'The saved merchant quote covers the following document requests.':
    'Prepare the original merchant requests to retrieve their current price.';
  if(native){
    $('quote-sha').textContent='Plan SHA256 '+native.planSha256;
    for(const total of native.totals){
      const section=node('div',undefined,'price-total');
      section.append(node('strong',total.maximumAtomic+' atomic units maximum · '+total.documents+' documents'));
      const list=node('dl');detailsRow(list,'Network',total.network);detailsRow(list,'Asset',total.asset);
      detailsRow(list,'Recipient',total.payTo);detailsRow(list,'Payment flow',total.paymentFlow);section.append(list);
      $('price-totals').append(section);
    }
  }
  const busy=selected.active?.state==='RUNNING'||state.operation?.state==='RUNNING'&&state.operation.compositionId===selected.id;
  $('prepare-price').disabled=Boolean(busy);$('prepare-price').textContent=native?'Reopen original price':'Prepare merchant price';
  $('run-documents').disabled=Boolean(!native||busy||native.receivedDocuments===native.documents);
  $('run-documents').textContent=native&&native.receivedDocuments>0?'Continue at this saved price':'Render at this saved price';
  $('receive-documents').disabled=Boolean(!native||busy);
  $('export-documents').disabled=Boolean(!native||busy||native.receivedDocuments===0);
  $('export-documents').textContent=native?'Export '+native.receivedDocuments+' received documents':'Export received documents';
}
function drawDocuments(selected){
  clear($('document-rows'));
  for(const item of selected.documents){
    const row=node('tr'),title=node('td'),task=node('td'),source=node('td'),status=node('td'),pdf=node('td');
    title.append(corrections.checkbox(item),node('strong',item.label),node('small','Record '+item.recordKey+' · '+item.templateId));
    task.textContent=item.taskReference;
    source.append(linkDownload(human(item.format)+' source',selection('source',{file:item.source})),node('small',bytes(item.bytes)));
    const native=item.native;
    status.append(node('span',native?human(native.state):'source prepared'));
    if(native?.error)status.append(node('small',native.error));
    if(native?.jobId)status.append(node('small','Job '+native.jobId));
    if(native?.received)pdf.append(linkDownload('Download PDF',selection('pdf',{documentId:item.id})),
      node('small',native.outputs.files.length+' complete files received'));
    else pdf.append(node('span','Awaiting receiving','muted'));
    row.append(title,task,source,status,pdf);$('document-rows').append(row);
  }
  const page=selected.page;
  $('document-page').textContent=(page.offset+1)+'–'+Math.min(page.offset+page.limit,page.total)+' of '+page.total;
  $('document-previous').disabled=page.offset===0;$('document-next').disabled=page.offset+page.limit>=page.total;
}
function drawExports(selected){
  clear($('exports'));
  for(const saved of selected.exports.slice().reverse()){
    const card=node('div',undefined,'export-card');
    if(saved.state!=='COMPLETE'){
      card.append(node('strong','Continue the original Collection export'),
        node('p',saved.id+' · '+human(saved.state)),
        node('p',saved.error?.message??'The complete native export remains in its original directory.'));
      const resume=node('button','Continue this export');resume.type='button';
      resume.addEventListener('click',()=>guard(()=>startOperation('export',{
        id:selected.id,sourceSha256:selected.sourceSha256,exportId:saved.id})));
      card.append(resume);$('exports').append(card);continue;
    }
    card.append(node('strong',saved.receivedDocuments+' received documents · Collection revision '+saved.collection.revision),
      node('p',new Date(saved.observedAt).toLocaleString()+' · '+bytes(saved.archive.bytes)),
      node('p','Collection SHA256 '+saved.archive.sha256,'mono'));
    const links=node('div',undefined,'download-list');
    for(const [label,file]of [['Download document Collection','documents.tar'],['Complete source plan','composition-plan.json'],
      ['Readable receiving report','batch-review.html'],['CSV results','batch-results.csv'],['JSON results','batch-results.json']])
      links.append(linkDownload(label,selection('export',{exportId:saved.id,file})));
    card.append(links);$('exports').append(card);
  }
}

function assemblySelection(kind,extra={}){
  const selected=state.selected,value=state.assembly;
  if(!selected||!value||state.assemblyComposition!==selected.id)
    throw Error('Open the saved PDF bundle first.');
  return {id:selected.id,sourceSha256:selected.sourceSha256,assemblyId:value.id,
    assemblySha256:value.sourceSha256,kind,...extra};
}
function drawAssemblyList(selected){
  clear($('assembly-list'));
  const changed=state.assemblyComposition!==selected.id;
  if(changed){
    state.assembly=null;state.assemblySelected=null;state.assemblyComposition=selected.id;
    state.assemblyEpoch++;$('assembly-detail').hidden=true;
    $('assembly-id').value='bundle-'+stamp();$('assembly-name').value=selected.name+' — PDF bundle';
    $('assembly-title').value='Invoice and report bundle';$('assembly-task').value=selected.id;
    $('assembly-origin').value=selected.provider==='pdfmint'?selected.merchantOrigin:'';
    $('assembly-order').value='';
  }
  const chosen=$('assembly-template').value;clear($('assembly-template'));
  const all=node('option','All document templates');all.value='';$('assembly-template').append(all);
  for(const template of selected.request.templates??[]){
    const option=node('option',template.id);option.value=template.id;$('assembly-template').append(option);
  }
  if([...$('assembly-template').options].some(option=>option.value===chosen))$('assembly-template').value=chosen;
  for(const item of selected.assemblies??[]){
    const button=node('button',item.name??item.id);button.type='button';
    button.addEventListener('click',()=>guard(()=>loadAssembly(item.id,item.sourceSha256)));
    $('assembly-list').append(button);
  }
  $('assembly-stage').disabled=state.assemblyStaging||!selected.native||Boolean(selected.active);
}
function drawAssembly(value){
  state.assembly=value;$('assembly-detail').hidden=false;
  $('assembly-current-name').textContent=value.request.name;
  $('assembly-counts').textContent=value.counts.originalFiles+' complete source PDFs · '+value.counts.volumes+
    ' ordered volumes · '+value.counts.paidMerges+' paid assemblies · '+value.counts.unchangedVolumes+' unchanged PDF volumes';
  $('assembly-source-sha').textContent='Full source SHA256 '+value.sourceSha256;
  clear($('assembly-price'));
  for(const total of value.native?.totals??[]){
    const box=node('div',undefined,'price-total');
    box.append(node('strong',total.maximumAtomic+' atomic units maximum · '+total.documents+' assembly requests'));
    const details=node('dl');detailsRow(details,'Network',total.network);detailsRow(details,'Asset',total.asset);
    detailsRow(details,'Recipient',total.payTo);detailsRow(details,'Payment flow',total.paymentFlow);
    box.append(details);$('assembly-price').append(box);
  }
  if(!value.counts.paidMerges)$('assembly-price').append(node('p',
    'These volumes retain their original PDFs. No supplier merge or new native purchase is needed.'));
  else if(!value.native)$('assembly-price').append(node('p','Prepare the actual assembly merchant quote before purchasing.'));
  $('assembly-price-sha').textContent=value.native?'Exact native plan SHA256 '+value.native.planSha256:'';
  const busy=state.operation?.state==='RUNNING'&&state.operation.compositionId===state.selectedId;
  $('assembly-prepare').disabled=busy||value.counts.paidMerges===0;
  $('assembly-run').disabled=busy||!value.native||value.complete;
  $('assembly-receive').disabled=busy||!value.native;
  $('assembly-export').disabled=busy||!value.complete;
  clear($('assembly-volumes'));
  for(const volume of value.volumes){
    const row=node('tr'),pdf=node('td');
    if(volume.received)pdf.append(linkDownload('Download volume',assemblySelection('assembly-pdf',{volumeId:volume.id})));
    else pdf.textContent='Awaiting original receiving';
    row.append(node('td',volume.index),node('td',volume.fileIds.join(', ')),
      node('td',volume.kind==='original'?'Original PDF':'Paid assembly'),node('td',human(volume.state)),pdf);
    $('assembly-volumes').append(row);
  }
  clear($('assembly-exports'));
  for(const saved of value.exports??[]){
    const card=node('div',undefined,'export-card');card.append(node('strong',
      saved.complete?'Complete customer PDF bundle':'Continue the original bundle export'));
    if(!saved.complete){
      const button=node('button','Continue this export');button.type='button';
      button.addEventListener('click',()=>guard(()=>assemblyAction('assembly-export',{exportId:saved.id})));
      card.append(node('p',saved.error?.message??saved.id),button);
    }else{
      const links=node('div',undefined,'download-list');
      const files=[['Download complete PDF bundle','complete-pdf-bundle.tar'],['Readable bundle','index.html'],['All original source PDFs','assembly-plan.json'],
        ['Complete delivery JSON','assembly-delivery.json'],['Volume CSV','assembly-results.csv']];
      if(saved.native)files.push(['Original paid Collection','native/documents.tar']);
      for(const [label,file]of files)links.append(linkDownload(label,assemblySelection('assembly-export',{exportId:saved.id,file})));
      for(const file of saved.files.filter(file=>file.path.startsWith('pdfs/')))
        links.append(linkDownload(file.path.split('/').at(-1),assemblySelection('assembly-export',{exportId:saved.id,file:file.path})));
      card.append(links);
    }
    $('assembly-exports').append(card);
  }
}
async function loadAssembly(id,sha256){
  const selected=state.selected;if(!selected)throw Error('Select the saved document set.');
  const row=selected.assemblies?.find(item=>item.id===id);
  sha256=sha256??row?.sourceSha256;if(!HASH.test(sha256??''))throw Error('Receive the complete saved bundle source first.');
  const epoch=++state.assemblyEpoch;state.assemblySelected=id;state.assemblyComposition=selected.id;
  const query=new URLSearchParams({id:selected.id,sourceSha256:selected.sourceSha256,assemblyId:id,assemblySha256:sha256});
  const result=await api('assembly?'+query.toString());
  if(epoch!==state.assemblyEpoch||state.selected?.id!==selected.id||
    state.selected.sourceSha256!==selected.sourceSha256||state.assemblySelected!==id)return;
  drawAssembly(result);
}
async function assemblyAction(kind,extra={}){
  const input=assemblySelection(undefined,extra);delete input.kind;
  if(kind==='assembly-run'){
    if(!HASH.test(state.assembly.native?.planSha256??''))throw Error('Review the original saved assembly price first.');
    input.planSha256=state.assembly.native.planSha256;
  }
  await startOperation(kind,input);
}
async function stageAssembly(){
  if(state.assemblyStaging)throw Error('The original bundle source selection is being read.');
  const request={schema:'stellar-forge.document-assembly.v1',id:$('assembly-id').value.trim(),
    name:$('assembly-name').value.trim(),title:$('assembly-title').value.trim(),
    taskReference:$('assembly-task').value.trim(),merchantOrigin:$('assembly-origin').value.trim(),
    maxVolumeBytes:10000000,settings:{strict:true}};
  const selected=state.selected,epoch=state.selectionEpoch;
  if(!selected?.native)throw Error('Receive the original document PDFs first.');
  const template=$('assembly-template').value;
  const explicit=$('assembly-order').value.trim().split(/\s+/).filter(Boolean);
  state.assemblyStaging=true;$('assembly-stage').disabled=true;
  try{
  const items=[];
  for(let offset=0;offset<selected.page.total;offset+=100){
    const page=await api('composition?'+new URLSearchParams({id:selected.id,sourceSha256:selected.sourceSha256,
      offset:String(offset),limit:'100'}).toString());
    if(epoch!==state.selectionEpoch||state.selected?.id!==selected.id||
      state.selected.sourceSha256!==selected.sourceSha256)throw Error('The selected document set changed. Reopen its bundle.');
    if(page.sourceSha256!==selected.sourceSha256||page.page.total!==selected.page.total)
      throw Error('The original source selection changed.');
    items.push(...page.documents);
  }
  const byId=new Map(items.map(item=>[item.id,item]));
  const ids=explicit.length?explicit:items.filter(item=>!template||item.templateId===template).map(item=>item.id);
  if(!ids.length||new Set(ids).size!==ids.length)throw Error('Select each original PDF once in the required order.');
  for(const id of ids){
    const item=byId.get(id);if(!item||template&&item.templateId!==template)
      throw Error('The selected document is outside this template: '+id);
    if(!item.native?.received)throw Error('Receive the original PDF before assembly: '+item.label);
  }

  state.assemblySelected=request.id;state.assemblyComposition=selected.id;
  await startOperation('assembly-stage',{id:selected.id,sourceSha256:selected.sourceSha256,
    assemblyId:request.id,request,documentIds:ids});
  }finally{state.assemblyStaging=false;
    $('assembly-stage').disabled=!state.selected?.native||Boolean(state.selected?.active);}
}

function drawSelection(selected){
  $('new-panel').hidden=true;$('saved-panel').hidden=false;
  corrections.observe(selected);
  $('saved-title').textContent=selected.name;$('saved-id').textContent=selected.id+' · '+selected.provider+' · '+selected.merchantOrigin;
  clear($('source-details'));
  for(const [label,value]of [['Source SHA256',selected.sourceSha256],['Full source plan',bytes(selected.sourceBytes)],
    ['Original directory',selected.directory],['Grouped records',selected.counts.groupedRecords],
    ['Excluded records',selected.counts.excludedRecords]])
    detailsRow($('source-details'),label,value);
  $('saved-recipe').textContent=JSON.stringify(selected.request,null,2);
  clear($('input-downloads'));
  for(const file of selected.sourceFiles.filter(file=>['dataset','configuration','template'].includes(file.role)))
    $('input-downloads').append(linkDownload('Download '+file.path.split('/').at(-1),selection('source',{file:file.path})));
  drawPrice(selected);drawCounts(selected);drawDocuments(selected);drawExports(selected);drawAssemblyList(selected);markSelected();
}
async function loadComposition(id,offset=0){
  const epoch=++state.selectionEpoch;state.selectedId=id;state.selectedOffset=offset;state.followId=id;
  const selected=await api('composition?id='+encodeURIComponent(id)+'&offset='+offset+'&limit=100');
  if(epoch!==state.selectionEpoch||state.selectedId!==id)return;
  pdfBundles?.hide();state.selected=selected;drawSelection(selected);
  history.replaceState(null,'','/documents/?id='+encodeURIComponent(id)+'#'+state.token);
  if(selected.active)watch(selected.active);
  if(state.assemblySelected&&selected.assemblies?.some(item=>item.id===state.assemblySelected))
    await loadAssembly(state.assemblySelected);
}
function drawOperation(operation){
  $('operation-panel').hidden=Boolean(pdfBundles&&!$('pdf-bundles-panel').hidden);$('operation-title').textContent=titles[operation.kind]||human(operation.kind);
  $('operation-progress').textContent=operation.compositionId+' · '+human(operation.state);
  if(operation.progress){
    const progress=operation.progress;
    let detail=human(progress.stage);
    if(progress.index!==undefined)detail+=' · '+progress.index+' of '+progress.total;
    if(progress.documents!==undefined)detail+=' · '+progress.documents+' documents';
    if(progress.outcome)detail+=' · '+human(progress.outcome.state??progress.outcome.error??'received');
    $('operation-progress').textContent+=' — '+detail;
  }
  $('operation-error').textContent=operation.error?operation.error.message+
    (operation.error.message===operation.error.code?'':' ('+operation.error.code+')'):'';
  $('stop-operation').hidden=operation.state!=='RUNNING';
  clear($('operation-files'));
  const result=operation.result;
  if(result?.report){
    const source={id:operation.compositionId,sourceSha256:result.sourceSha256,kind:'report',reportId:result.report.id};
    for(const [label,file]of [['Full receiving report','batch-review.html'],['CSV results','batch-results.csv'],['JSON results','batch-results.json']])
      $('operation-files').append(linkDownload(label,{...source,file}));
  }
  const busy=operation.kind==='stage'&&operation.state==='RUNNING';
  if(state.sourceBusy!==busy){
    state.sourceBusy=busy;
    for(const control of $('source-form').querySelectorAll('input,select,textarea,button'))control.disabled=busy;
    $('stage-button').disabled=busy||state.pendingReads>0;
  }
  if(state.selected)drawPrice(state.selected);
  if(state.assembly&&state.assemblyComposition===state.selectedId)drawAssembly(state.assembly);
}
function watch(operation){
  if(state.operationTimer){clearTimeout(state.operationTimer);state.operationTimer=null;}
  state.operation=operation;drawOperation(operation);
  if(operation.state==='RUNNING')state.operationTimer=setTimeout(()=>pollOperation(operation.id),1500);
}
async function pollOperation(id){
  if(state.operation?.id!==id)return;
  try{
    const result=await api('operation?operationId='+encodeURIComponent(id));
    if(state.operation?.id!==id)return;
    watch(result);
    if(result.state!=='RUNNING'){
      await refreshList();
      if(result.result?.assemblyId&&state.followId===result.compositionId)state.assemblySelected=result.result.assemblyId;
      if(state.followId===result.compositionId)await loadComposition(result.compositionId,state.selectedOffset);
    }
  }catch(error){
    if(state.operation?.id!==id)return;
    if(error.status===404){
      state.operation=null;$('operation-panel').hidden=true;
      notice('The browser service reopened. Continue this document set from its saved source and original job records.');
      if(state.selectedId)await guard(()=>loadComposition(state.selectedId,state.selectedOffset));
      return;
    }
    notice(readable(error),true);
    state.operationTimer=setTimeout(()=>pollOperation(id),5000);
  }
}
async function startOperation(kind,input){
  const result=await api(kind,{method:'POST',body:input});
  if(input.id!==state.selectedId)state.selectedOffset=0;
  state.followId=input.id;watch(result);await refreshList();
}
async function selectedAction(kind){
  const selected=state.selected;if(!selected)throw Error('Select a saved document set.');
  const input={id:selected.id,sourceSha256:selected.sourceSha256};
  if(kind==='run'){
    if(!HASH.test(selected.native?.planSha256??''))throw Error('Prepare and review the exact saved merchant price first.');
    input.planSha256=selected.native.planSha256;
  }
  await startOperation(kind,input);
}


$('assembly-form').addEventListener('submit',event=>{event.preventDefault();guard(stageAssembly);});
$('assembly-refresh').addEventListener('click',()=>guard(()=>loadAssembly(state.assemblySelected)));
$('assembly-prepare').addEventListener('click',()=>guard(()=>assemblyAction('assembly-prepare')));
$('assembly-run').addEventListener('click',()=>guard(()=>assemblyAction('assembly-run')));
$('assembly-receive').addEventListener('click',()=>guard(()=>assemblyAction('assembly-receive')));
$('assembly-export').addEventListener('click',()=>guard(()=>assemblyAction('assembly-export')));
$('assembly-source').addEventListener('click',()=>guard(()=>download(assemblySelection('assembly-source'))));

$('source-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{
  if(state.pendingReads)throw Error('Wait for the complete selected files to finish loading.');
  const request=readRequest();if(!state.payload?.dataset)throw Error('Select the complete dataset.');
  const templates=Object.create(null);
  if(!Array.isArray(request.templates))throw Error('Complete the template mapping.');
  for(const template of request.templates){
    const file=state.payload.templates[template.id];if(!file)throw Error('Select the complete '+template.id+' template.');
    templates[template.id]=file;
  }
  await startOperation('stage',{id:request.id,request,dataset:state.payload.dataset,templates});
});});
$('dataset-file').addEventListener('change',()=>guard(()=>fileTask(async()=>{
  if(!state.payload)state.payload={dataset:null,templates:Object.create(null)};
  const payload=state.payload,version=++state.datasetRead;payload.dataset=null;showDataset();
  const file=await upload($('dataset-file').files[0],16*MiB);
  if(version!==state.datasetRead||payload!==state.payload)return;
  payload.dataset=file;showDataset();
})));
$('load-example').addEventListener('click',()=>guard(()=>fileTask(loadExample)));
$('provider').addEventListener('change',updateProvider);
$('apply-mapping').addEventListener('click',()=>guard(async()=>{
  const request=readRequest();if(!state.payload)state.payload={dataset:null,templates:Object.create(null)};
  $('recipe').value=JSON.stringify(request,null,2);showTemplates(request);
}));
$('new-work').addEventListener('click',showNew);
$('refresh-list').addEventListener('click',()=>guard(refreshList));
$('refresh-detail').addEventListener('click',()=>guard(()=>loadComposition(state.selectedId,state.selectedOffset)));
$('list-previous').addEventListener('click',()=>guard(async()=>{state.listOffset=Math.max(0,state.listOffset-20);await refreshList();}));
$('list-next').addEventListener('click',()=>guard(async()=>{state.listOffset+=20;await refreshList();}));
$('document-previous').addEventListener('click',()=>guard(()=>loadComposition(state.selectedId,Math.max(0,state.selectedOffset-100))));
$('document-next').addEventListener('click',()=>guard(()=>loadComposition(state.selectedId,state.selectedOffset+100)));
$('prepare-price').addEventListener('click',()=>guard(()=>selectedAction('prepare')));
$('run-documents').addEventListener('click',()=>guard(()=>selectedAction('run')));
$('receive-documents').addEventListener('click',()=>guard(()=>selectedAction('receive')));
$('export-documents').addEventListener('click',()=>guard(()=>selectedAction('export')));
$('download-plan').addEventListener('click',()=>guard(()=>download(selection('source-plan'))));
$('download-preview').addEventListener('click',()=>guard(()=>download(selection('source',{file:'preview.html'}))));
$('download-native-plan').addEventListener('click',()=>guard(()=>download(selection('native-plan'))));
$('stop-operation').addEventListener('click',()=>guard(async()=>{
  if(state.operation)watch(await api('cancel',{method:'POST',body:{operationId:state.operation.id}}));
}));
$('restore-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{
  if(state.pendingReads)throw Error('Wait for the complete selected source plan to finish loading.');
  await startOperation('restore',{
  id:$('restore-id').value.trim(),...(state.restoreSource?{source:state.restoreSource}:{sourceFile:$('restore-file').value.trim()}),
  sourceSha256:$('restore-sha').value.trim().toLowerCase()});});});
$('restore-upload').addEventListener('change',()=>guard(()=>fileTask(async()=>{
  const version=++state.restoreRead;state.restoreSource=null;$('restore-file').disabled=false;
  $('restore-upload-info').textContent='';
  if(!$('restore-upload').files.length)return;
  const file=await upload($('restore-upload').files[0],28*MiB);
  if(version!==state.restoreRead)return;
  const plan=JSON.parse(decoded(file));if(typeof plan.request?.id!=='string')throw Error('Select the complete original source plan.');
  state.restoreSource=file;$('restore-file').value='';$('restore-file').disabled=true;
  $('restore-id').value=plan.request.id;$('restore-sha').value=file.sha256;
  $('restore-upload-info').textContent=fileInfo(file);
})));
for(const [id,path]of [['request-link','/jobs/request/'],['checkout-link','/jobs/checkout/'],
  ['jobs-link','/jobs/'],['library-link','/'],['collections-link','/collections']])
  $(id).href=path+'#'+state.token;

corrections=installDocumentCorrections({api,guard,start:startOperation,onOpen:loadComposition});
pdfBundles=installPdfBundles({api,guard,onOpen(){
  corrections.hide();
  state.selected=null;state.selectedId=null;state.followId=null;state.selectionEpoch++;
  $('new-panel').hidden=true;$('saved-panel').hidden=true;$('operation-panel').hidden=true;markSelected();
}});

await guard(async()=>{
  if(!/^[a-f0-9]{64}$/.test(state.token))throw Error('Open Document production from the current private customer launch URL.');
  await refreshList();$('provider').value=state.host.defaults.provider;
  $('merchant-origin').value=state.host.defaults.merchantOrigin??'';updateProvider();
  const query=new URL(location.href).searchParams,selected=query.get('id');
  if(query.has('pdf'))await pdfBundles.open(query.get('pdf'));
  else if(selected)await loadComposition(selected);else{showNew();await fileTask(loadExample);}
  if(!state.operation&&state.host.active.length)watch(state.host.active[0]);
});
