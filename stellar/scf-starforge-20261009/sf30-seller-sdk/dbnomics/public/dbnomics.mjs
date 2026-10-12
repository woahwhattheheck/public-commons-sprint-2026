// MIT. Industrial DBnomics analyst workspace beside the original dataset publisher.
import {publisherHost} from '/app.mjs';
const el=(tag,text,props={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const[key,value]of Object.entries(props)){if(key.includes('-'))node.setAttribute(key,String(value));else node[key]=value;}return node;};
const input=(value='',props={})=>el('input',undefined,{value,...props});
const field=(label,node,help)=>{const out=el('label',label);node.setAttribute('aria-label',label);out.append(node);if(help)out.append(el('small',help));return out;};
const code=value=>el('code',String(value??''));
const area=(value='',rows=3)=>el('textarea',undefined,{value,rows});
const select=(items=[])=>{const node=el('select');for(const [value,label]of items)node.append(el('option',label,{value}));return node;};
const root=el('section',undefined,{className:'db-workbench',id:'db-workbench'});
document.querySelector('main').prepend(root);
document.querySelector('h1').textContent='DBnomics economic workbench';
document.title='DBnomics Economic Workbench';
const header=document.querySelector('header p.muted');
if(header)header.textContent='Retain original economic observations. Review source changes. Publish an exact, reusable edition.';
root.append(el('p','Retained sources, analyst decisions and customer editions',{className:'eyebrow'}));
const notice=el('p','Loading the saved workbench…',{className:'db-notice',role:'status','aria-live':'polite'});
root.append(notice);
let saved=null,selectedId=null,selected=null,offset=0,rowPage=null,notesState=null,noteDraft=[],notesDirty=false,
  selectedReport=null,reportData=null,reportOffset=0,compareOffset=0,lastPlan=null,busy=false,activeTab='sources';
const panels=new Map(),nav=el('nav',undefined,{className:'db-tabs','aria-label':'Economic workbench'});
root.append(nav);
const tabs=[['sources','Sources'],['observations','Observations'],['analysis','Analysis and notes'],['compare','Compare editions'],['delivery','Customer edition']];
for(const [name,label]of tabs){
  const panel=el('section',undefined,{className:'db-pane',id:'db-'+name,hidden:name!==activeTab});
  const button=el('button',label,{type:'button'});button.dataset.tab=name;button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-selected',String(name===activeTab));
  button.addEventListener('click',()=>showTab(name));nav.append(button);root.append(panel);panels.set(name,panel);
}
function showTab(name){activeTab=name;for(const [id,p]of panels)p.hidden=id!==name;for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-selected',String(b.dataset.tab===name));}
const message=(text,error=false)=>{notice.textContent=text;notice.classList.toggle('db-error',error);};
async function api(route,value){
  const response=await fetch('/api/dbnomics/'+route,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw Error('The original server returned an incomplete response. Keep the current operation ID.');}
  if(!response.ok){const error=Error(result.message??result.error??'The request failed.');Object.assign(error,result,{status:response.status});throw error;}return result;
}
const action=fn=>async event=>{event?.preventDefault();if(busy)return;busy=true;root.setAttribute('aria-busy','true');
  try{await fn();}catch(error){message(error.message,true);}finally{busy=false;root.removeAttribute('aria-busy');}};
const button=(label,fn)=>{const b=el('button',label,{type:'button'});b.addEventListener('click',action(fn));return b;};
const details=(label,child)=>{const d=el('details');d.append(el('summary',label));if(child)d.append(child);return d;};
const section=(parent,title)=>{const box=el('section',undefined,{className:'db-section'});box.append(el('h3',title));parent.append(box);return box;};
const group=()=>el('div',undefined,{className:'db-fields'});
const row=()=>el('div',undefined,{className:'db-actions'});
const table=(columns,rows,render)=>{
  const wrap=el('div',undefined,{className:'db-table',tabIndex:0}),t=el('table'),head=el('thead'),tr=el('tr');
  for(const label of columns)tr.append(el('th',label));head.append(tr);t.append(head);const body=el('tbody');
  rows.forEach((item,index)=>{const tr=el('tr');for(const value of render(item,index)){const td=el('td');td.append(value instanceof Node?value:document.createTextNode(value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value)));tr.append(td);}body.append(tr);});
  t.append(body);wrap.append(t);return wrap;
};
function pendingKey(slot){return 'dbnomics:'+saved.project.id+':pending:'+slot;}
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
async function write(slot,route,value){
  const key=pendingKey(slot),previous=localStorage.getItem(key),old=previous?JSON.parse(previous):null;
  const encoded=new TextEncoder().encode(canonical(value)),inputHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(old&&(old.inputHash!==inputHash||old.route!==route))throw Error('A saved '+slot+' action has another input. Reconcile or retry it in Retained operations before replacing this draft.');
  const request=old??{id:crypto.randomUUID(),route,inputHash,input:encoded.length<=512*1024?value:null};
  if(!old){try{localStorage.setItem(key,JSON.stringify(request));}catch{request.input=null;localStorage.setItem(key,JSON.stringify(request));}}
  const result=await api(route,{id:request.id,...value});
  localStorage.removeItem(key);return result;
}
const downloads=[];
function refreshDownloads(){
  for(const {node,route} of downloads){
    const target=typeof route==='function'?route():route;
    if(target){node.href='/api/dbnomics/'+target;node.removeAttribute('aria-disabled');node.tabIndex=0;}
    else{node.removeAttribute('href');node.setAttribute('aria-disabled','true');node.tabIndex=-1;}
  }
}
function fileLink(label,route){
  const node=el('a',label,{download:'',className:'db-download'});
  downloads.push({node,route});refreshDownloads();
  node.addEventListener('click',event=>{
    refreshDownloads();
    if(busy||!node.hasAttribute('href')){event.preventDefault();message(busy?'Wait for the selected edition to finish opening.':'Choose a saved source or analyst report.');}
  });
  return node;
}
function ids(select){return [...select.selectedOptions].map(option=>option.value);}
function fillSelect(node,items,current=node.value){node.replaceChildren();for(const [value,label]of items)node.append(el('option',label,{value,selected:value===current}));}
function multiline(value){return value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}
function empty(parent,text){parent.replaceChildren(el('p',text,{className:'muted'}));}
function keepNotes(){return (!notesDirty&&!noteText.value.trim())||window.confirm('This edition has unsaved analyst notes. Keep the current edition by choosing Cancel, or discard this draft to switch sources.');}

// Sources: documented provider discovery and complete retained responses.
const sourcePane=panels.get('sources'),summary=el('div',undefined,{className:'db-metrics'});
sourcePane.append(summary);
const sourceSelection=group(),captureSelect=select();
sourceSelection.append(field('Retained source edition',captureSelect),button('Refresh saved state',()=>refresh()));
sourcePane.append(sourceSelection);
captureSelect.addEventListener('change',action(async()=>{if(!keepNotes()){captureSelect.value=selectedId;return;}await chooseCapture(captureSelect.value);}));
const sourceInfo=el('div'),metadata=el('pre',undefined,{className:'db-pre'});
sourcePane.append(sourceInfo,details('Complete provider metadata, acquisition and reuse terms',metadata));
const openOriginal=row();
openOriginal.append(fileLink('Download complete source capture',()=>selectedId?'capture-export?id='+selectedId:null),
  button('Open captured INSEE example',async()=>{const result=await write('insee-example','seed',{});await refresh(result.captureId);message('Opened the original 468-observation INSEE source. Its source dates and attributes are retained.');}));
sourcePane.append(openOriginal);
const discovery=section(sourcePane,'Find provider datasets and series'),discoveryForm=el('form'),discoverFields=group();
const discoverKind=select([['providers','Providers'],['datasets','Provider datasets'],['series','Dataset series'],['search','Search all series'],['provider','Provider metadata'],['dataset','Dataset metadata']]),
  discoverProvider=input('INSEE'),discoverDataset=input('IPC-2015'),discoverQuery=input('',{placeholder:'Search words'}),discoverLimit=input('20',{type:'number',min:'1',max:'1000'}),
  discoverOffset=input('0',{type:'number',min:'0'}),dimensionFilter=area('{}',2);
discoverFields.append(field('Browse',discoverKind),field('Provider code',discoverProvider),field('Dataset code',discoverDataset),field('Search',discoverQuery),field('Page size',discoverLimit),field('Offset',discoverOffset));
discoveryForm.append(discoverFields,details('Exact dimension filters',field('Provider dimension codes and value arrays',dimensionFilter)),el('button','Read official source',{type:'submit'}));
discovery.append(discoveryForm);
const discoveryResults=el('div');discovery.append(discoveryResults);
discoveryForm.addEventListener('submit',action(async()=>{
  const result=await api('discover',{kind:discoverKind.value,provider:discoverProvider.value,dataset:discoverDataset.value,query:discoverQuery.value,
    limit:Number(discoverLimit.value),offset:Number(discoverOffset.value),...(discoverKind.value==='series'?{dimensions:JSON.parse(dimensionFilter.value)}:{})});
  discoveryResults.replaceChildren(el('p',result.items.length+' returned · '+result.page.total+' provider matches · '+result.receipt.completedAt));
  discoveryResults.append(table(['Source code','Name','Choose'],result.items,item=>{
    const provider=item.provider_code??(discoverKind.value==='providers'?item.code:discoverProvider.value),dataset=item.dataset_code??(discoverKind.value==='datasets'?item.code:discoverDataset.value),
      series=item.series_code,id=series?[provider,dataset,series].join('/'):item.code??item.id??'';
    const use=button(series?'Add series':discoverKind.value==='providers'?'Browse datasets':'Browse series',async()=>{
      if(series){const selected=new Set(multiline(acquireIds.value));selected.add(id);acquireIds.value=[...selected].join('\n');acquireForm.scrollIntoView({behavior:'smooth',block:'center'});}
      else{discoverProvider.value=provider;discoverDataset.value=dataset;discoverKind.value=discoverKind.value==='providers'?'datasets':'series';message('Source selection copied into discovery. Read its official page to continue.');}
    });
    return [id,item.series_name??item.name??item.dataset_name??'',use];
  }));
  if(result.page.next!==null)discoveryResults.append(button('Use next source offset',async()=>{discoverOffset.value=String(result.page.next);message('Next source offset selected. Read official source to load it.');}));
  const raw=el('pre',JSON.stringify(result.data,null,2),{className:'db-pre'});discoveryResults.append(details('Complete discovery response',raw));
}));
const acquisition=section(sourcePane,'Retain an exact source selection'),acquireForm=el('form'),acquireTitle=input('Economic source edition',{required:true,maxLength:160}),
  acquireIds=area('INSEE/IPC-2015/A.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE\nINSEE/IPC-2015/M.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE',4);
acquireForm.append(field('Edition title',acquireTitle),field('Exact series IDs, one per line',acquireIds,'Use provider/dataset/series. The complete original observations and response are retained.'),el('button','Acquire and retain source',{type:'submit'}));
acquireForm.addEventListener('submit',action(async()=>{const result=await write('acquire','acquire',{selection:{title:acquireTitle.value,seriesIds:multiline(acquireIds.value)}});
  await refresh(result.captureId);message('Retained '+result.rowCount+' original observations.');}));
acquisition.append(acquireForm,button('Acquire a new edition of the selected source',async()=>{
  if(!selectedId)throw Error('Choose the original source edition.');const result=await write('source-refresh','refresh',{captureId:selectedId});
  await refresh(result.captureId);message('New source edition retained: '+result.comparison.revised+' revised, '+result.comparison.added+' added, '+result.comparison.removed+' removed observations.');
}));
const imports=section(sourcePane,'Receive complete source files'),importFiles=input('',{type:'file',multiple:true,accept:'.json,application/json'});
imports.append(field('Source capture, source handover, or response-import manifest with all referenced files',importFiles),button('Receive selected files',async()=>{
  if(!importFiles.files.length)throw Error('Choose the complete source files.');
  const files={},parsed=[];let size=0;
  for(const file of importFiles.files){size+=file.size;if(size>50*1024*1024)throw Error('Use the installed CLI to import more than 50 MiB.');
    if(Object.hasOwn(files,file.name))throw Error('Each selected filename must be unique.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());files[file.name]=text;parsed.push(JSON.parse(text));}
  const handover=parsed.find(value=>value.schema==='stellar-forge.dbnomics-source-handover.v1');
  const capture=parsed.find(value=>value.schema==='stellar-forge.dbnomics-capture.v1');
  const manifest=parsed.find(value=>value.schema==='stellar-forge.dbnomics-response-import.v1');
  let result;
  if(handover)result=await write('source-import','source-import',{bundle:handover});
  else if(capture)result=await write('source-import','import',{capture});
  else if(manifest)result=await write('source-import','import',{manifest,files});
  else throw Error('Select the original capture or import manifest with acquisition metadata.');
  await refresh(result.captureId);message('Complete source files received into the current workbench.');
}));

// Full observation pages and source-bound row notes.
const observationsPane=panels.get('observations'),observationControls=group(),observationSeries=select(),observationSearch=input('',{placeholder:'Period, value, label or attribute'}),
  observationRowsNode=el('div'),observationPages=row();
observationControls.append(field('Series',observationSeries),field('Find within retained source',observationSearch),button('Apply row filter',async()=>{offset=0;await showObservations();}));
observationsPane.append(el('h3','Original observations'),observationControls,observationRowsNode,observationPages);
observationSeries.addEventListener('change',action(async()=>{offset=0;await showObservations();}));
async function showObservations(){
  if(!selectedId){empty(observationRowsNode,'Open a source edition to inspect its original rows.');return;}
  const query=new URLSearchParams({id:selectedId,offset:String(offset),limit:'50',search:observationSearch.value});
  if(observationSeries.value)query.set('seriesId',observationSeries.value);
  rowPage=await api('observations?'+query);
  observationRowsNode.replaceChildren(table(['Period','Frequency','Original value','Source series','Observation attributes','Note'],rowPage.records,item=>[
    item.period,item.frequency,item.valueText,item.seriesName,item.attributes,button('Annotate',async()=>{noteObservation.value=item.observationId;noteObservationLabel.textContent=item.seriesName+' · '+item.period;showTab('analysis');noteText.focus();})
  ]));
  observationPages.replaceChildren(el('span',rowPage.page.total+' original rows · '+(rowPage.page.total?offset+1:0)+'–'+(offset+rowPage.page.returned)));
  if(offset>0)observationPages.append(button('Previous rows',async()=>{offset=Math.max(0,offset-50);await showObservations();}));
  if(rowPage.page.next!==null)observationPages.append(button('Next rows',async()=>{offset=rowPage.page.next;await showObservations();}));
}

// Analysts keep an explicit calendar method and an immutable report revision.
const analysisPane=panels.get('analysis'),reportForm=el('form'),analysisFields=group(),reportTitle=input('INSEE consumer price analysis',{required:true,maxLength:160}),
  reportSeries=select(),reportMethod=select([['level','Original level'],['difference','Difference at exact period lag'],['percent-change','Percentage change at exact period lag'],['index-100','Rebase to 100 at a named period']]),
  reportLag=input('1',{type:'number',min:'1',max:'1200'}),reportStart=input('',{type:'date'}),reportEnd=input('',{type:'date'}),reportBase=input('',{placeholder:'Example: 2015 or 2015-01'}),
  reportNote=area('',3);
reportSeries.multiple=true;reportSeries.size=4;
analysisFields.append(field('Report title',reportTitle),field('Retained series',reportSeries),field('Method',reportMethod),field('Lag in original periods',reportLag),
  field('First period starts on or after',reportStart),field('Last period starts on or before',reportEnd),field('Explicit index base period',reportBase));
reportForm.append(analysisFields,field('Interpretation and decisions',reportNote),el('p','A lag is measured in each series’ own frequency. Use 12 for year-on-year monthly change and 1 for annual change. Missing exact prior periods and zero bases remain unavailable. Original values remain separate from calculations.',{className:'muted'}),
  el('button','Save complete analyst report',{type:'submit'}));
analysisPane.append(el('h3','Analysis'),reportForm);
reportForm.addEventListener('submit',action(async()=>{
  if(!selectedId)throw Error('Choose a retained source edition.');if(notesDirty||noteText.value.trim())throw Error('Save or discard the current notes draft before freezing the report.');
  const spec={title:reportTitle.value,seriesIds:ids(reportSeries),method:reportMethod.value,lag:Number(reportLag.value),
    start:reportStart.value||null,end:reportEnd.value||null,basePeriod:reportBase.value||null,note:reportNote.value};
  const result=await write('report','report',{captureId:selectedId,spec,notesRevision:notesState?.revision??0});
  selectedReport=result.reportId;await refresh(undefined,false);await showReport();message('Saved the full '+result.rows+'-observation report with notes revision '+result.notesRevision+'.');
}));
const reportSelection=group(),reportSelect=select(),reportSummary=el('p'),chart=el('div',undefined,{className:'db-chart'}),chartSeries=select(),reportTable=el('div'),reportPages=row(),reportDownloads=row();
reportSelection.append(field('Saved analyst report',reportSelect),field('Chart series',chartSeries));
for(const format of ['html','csv','json'])reportDownloads.append(fileLink('Download '+format.toUpperCase(),()=>selectedReport?'report-export?'+new URLSearchParams({id:selectedReport,format}):null));
analysisPane.append(reportSelection,reportSummary,chart,reportDownloads,reportTable,reportPages);
reportSelect.addEventListener('change',action(async()=>{selectedReport=reportSelect.value;reportOffset=0;await showReport();}));
chartSeries.addEventListener('change',()=>drawChart());
async function showReport(){
  if(!selectedReport){empty(reportTable,'Saved reports appear here with their exact source and notes revision.');return;}
  reportData=await api('report?'+new URLSearchParams({id:selectedReport,offset:'0',limit:'5000'}));
  fillSelect(chartSeries,reportData.series.map(item=>[item.id,item.name+' · '+item.frequency]));
  reportSummary.textContent=reportData.spec.title+' · '+reportData.rowCount+' observations · '+reportData.missingCalculations+' unavailable calculations · notes revision '+reportData.notesRevision+'. '+reportData.methodology;
  drawChart();await showReportRows();refreshDownloads();
}
async function showReportRows(){
  const result=reportOffset<5000&&reportOffset+50<=reportData.rows.length?{...reportData,rows:reportData.rows.slice(reportOffset,reportOffset+50),
    page:{total:reportData.rowCount,next:reportOffset+50<reportData.rowCount?reportOffset+50:null}}:
    await api('report?'+new URLSearchParams({id:selectedReport,offset:String(reportOffset),limit:'50'}));
  reportTable.replaceChildren(table(['Series','Period','Original value','Calculated value','Method / availability','Base period'],result.rows,item=>[
    item.seriesName,item.period,item.valueText,item.calculatedValue===null?'—':String(item.calculatedValue),item.calculationReason??item.calculation,item.basePeriod??''
  ]));
  reportPages.replaceChildren(el('span','Rows '+(result.rowCount?reportOffset+1:0)+'–'+(reportOffset+result.rows.length)+' of '+result.rowCount));
  if(reportOffset>0)reportPages.append(button('Previous report rows',async()=>{reportOffset=Math.max(0,reportOffset-50);await showReportRows();}));
  if(result.page.next!==null)reportPages.append(button('Next report rows',async()=>{reportOffset=result.page.next;await showReportRows();}));
}
function drawChart(){
  chart.replaceChildren();if(!reportData)return;
  const rows=reportData.rows.filter(row=>row.seriesId===chartSeries.value),points=rows.filter(row=>row.calculatedValue!==null&&row.periodOrdinal!==null);
  if(points.length<2){chart.append(el('p','This selected report window has fewer than two calculable calendar observations.'));return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 300');svg.setAttribute('role','img');svg.setAttribute('aria-label',reportData.spec.title+' — '+chartSeries.selectedOptions[0]?.textContent);
  const title=document.createElementNS(ns,'title');title.textContent=reportData.spec.title;svg.append(title);
  const minX=Math.min(...points.map(row=>row.periodOrdinal)),maxX=Math.max(...points.map(row=>row.periodOrdinal)),
    minY=Math.min(...points.map(row=>row.calculatedValue)),maxY=Math.max(...points.map(row=>row.calculatedValue)),spread=maxY-minY||1;
  const x=value=>65+(value-minX)/(maxX-minX||1)*810,y=value=>255-(value-minY)/spread*225;
  const line=(attrs)=>{const node=document.createElementNS(ns,'line');for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));node.setAttribute('class','db-axis');svg.append(node);};
  const label=(x,y,text)=>{const node=document.createElementNS(ns,'text');node.setAttribute('x',x);node.setAttribute('y',y);node.textContent=text;svg.append(node);};
  line({x1:65,y1:255,x2:875,y2:255});line({x1:65,y1:25,x2:65,y2:255});label(5,32,Number(maxY.toPrecision(5)));label(5,255,Number(minY.toPrecision(5)));
  label(65,285,points[0].period);label(795,285,points.at(-1).period);
  let path='',last=null;
  for(const row of rows){
    if(row.calculatedValue===null||row.periodOrdinal===null){last=null;continue;}
    path+=(last!==null&&row.periodOrdinal===last+1?'L':'M')+x(row.periodOrdinal).toFixed(2)+','+y(row.calculatedValue).toFixed(2)+' ';last=row.periodOrdinal;
  }
  const node=document.createElementNS(ns,'path');node.setAttribute('d',path);node.setAttribute('class','db-series');svg.append(node);
  for(const row of points){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',x(row.periodOrdinal));dot.setAttribute('cy',y(row.calculatedValue));dot.setAttribute('r',points.length>200?'1.5':'2.5');dot.setAttribute('class','db-point');
    const tip=document.createElementNS(ns,'title');tip.textContent=row.period+': '+row.calculatedValue+'; original '+row.valueText;dot.append(tip);svg.append(dot);}
  chart.append(svg,el('p',points.length+' calculated source points. Gaps are broken. '+(reportData.rowCount>reportData.rows.length?'Chart coverage: first '+reportData.rows.length+' report rows; the complete exports retain every row.':'This chart uses the complete saved report selection.'),{className:'muted'}));
}

// Notes bind to the actual capture and observation hash, with explicit revision conflict handling.
const notesBox=section(analysisPane,'Source-bound analyst notes'),noteObservation=input('',{type:'hidden'}),noteObservationLabel=el('p','Edition-level note'),noteAuthor=input('',{required:true,placeholder:'Analyst name'}),
  noteTag=input('',{placeholder:'Optional label'}),noteText=area('',3),noteList=el('div'),notesBadge=el('p'),notesActions=row();
notesBox.append(notesBadge,noteObservationLabel,noteObservation,field('Analyst',noteAuthor),field('Label',noteTag),field('Note',noteText));
notesActions.append(button('Add note to draft',async()=>{
  if(!selectedId)throw Error('Choose a source edition.');if(!noteAuthor.value.trim()||!noteText.value.trim())throw Error('Supply the analyst and note text.');
  noteDraft.push({id:crypto.randomUUID(),observationId:noteObservation.value||null,author:noteAuthor.value,tag:noteTag.value,text:noteText.value});notesDirty=true;
  noteText.value='';noteObservation.value='';noteObservationLabel.textContent='Edition-level note';renderNotes();
}),button('Use edition-level note',async()=>{noteObservation.value='';noteObservationLabel.textContent='Edition-level note';}),
button('Save notes revision',async()=>{if(!notesDirty)return;const result=await write('notes','notes',{captureId:selectedId,expectedRevision:notesState.revision,entries:noteDraft});
  notesDirty=false;await loadNotes();message('Saved original notes revision '+result.revision+'; current source notes revision '+notesState.revision+'.');}),
button('Discard unsaved notes draft',async()=>{if(notesDirty&&!window.confirm('Discard the unsaved notes draft?'))return;await loadNotes();}));
notesBox.append(notesActions,noteList);
function renderNotes(){
  notesBadge.textContent='Saved revision '+(notesState?.revision??0)+(notesDirty?' · unsaved draft':'');
  noteList.replaceChildren(table(['Scope','Analyst','Label','Note','Draft edit'],noteDraft,item=>[
    item.observationId?code(item.observationId.slice(0,16)): 'Entire source edition',item.author,item.tag,item.text,
    button('Remove from draft',async()=>{noteDraft=noteDraft.filter(row=>row.id!==item.id);notesDirty=true;renderNotes();})
  ]));
}
async function loadNotes(){if(!selectedId)return;notesState=await api('notes?id='+selectedId);noteDraft=notesState.entries.map(row=>({...row}));notesDirty=false;renderNotes();}


// Python Analysis keeps complete economic records, reviewed workbooks and original source history.
const pythonBox=section(analysisPane,'Python Analysis and editable workbooks');
const pythonTitle=input('Economic source and analyst briefing',{maxLength:160}),pythonReports=select(),
  pythonNotes=input('0',{type:'number',min:'0',step:'1'}),pythonInfo=el('p'),pythonSources=el('div'),pythonResult=el('div');
pythonReports.multiple=true;pythonReports.size=6;
pythonBox.append(el('p','Prepare one complete source for the installed Analysis workspace. Original observations, selected full reports, series descriptions and the exact saved notes revision travel together. The workbook retains original value text and calendar identities.'),
  field('Analysis title',pythonTitle),field('Complete saved reports to include',pythonReports,'Select any combination; each report keeps its own calculation and saved note edition.'),
  field('Source notes revision',pythonNotes,'Use an existing saved revision. Unsaved browser notes remain in their draft.'),
  pythonInfo,button('Prepare Python Analysis source',async()=>{
    if(!selectedId||!selected)throw Error('Choose the original source edition.');
    const revision=Number(pythonNotes.value);
    if(!Number.isSafeInteger(revision)||revision<0)throw Error('Choose a saved nonnegative notes revision.');
    const value={selection:{captureId:selectedId,captureSha256:selected.captureSha256,
      reportIds:ids(pythonReports),notesRevision:revision,title:pythonTitle.value}};
    const result=await write('python-analysis','analysis-source',value);
    pythonResult.replaceChildren(el('p','Prepared '+result.rowCount+' complete analysis records: '+
      result.counts.observation+' original observations, '+result.counts.calculation+' calculations, '+
      result.counts.series+' series and '+result.counts.note+' notes.'),
      el('a','Download complete Python Analysis source',{href:'/api/dbnomics/analysis-export?'+new URLSearchParams({id:result.id}),download:'',className:'db-download'}),
      details('Exact source selection',el('pre',JSON.stringify({id:result.id,documentId:result.documentId,selection:result.selection},null,2),{className:'db-pre'})));
    await refresh(undefined,false);message('The complete Analysis source is saved in this original economic project.');
  }),pythonResult,el('p','The installed Python command builds the complete HTML, JSON and CSV briefing, typed query exports, workbook and editable Analysis archive. Return the Records workbook for an original keyed comparison and review; its review_note cells can be added through the original economic notes revision check.'),
  pythonSources);
function pythonDraftKey(){return 'dbnomics:'+saved.project.id+':analysis-draft:'+selectedId;}
function savePythonDraft(){
  if(!saved||!selectedId)return;
  localStorage.setItem(pythonDraftKey(),JSON.stringify({title:pythonTitle.value,reportIds:ids(pythonReports),notesRevision:pythonNotes.value}));
}
for(const node of [pythonTitle,pythonReports,pythonNotes])node.addEventListener('change',savePythonDraft);
function renderPythonSources(){
  const available=saved?.reports.filter(item=>item.captureId===selectedId)??[];
  let draft=null;try{draft=JSON.parse(localStorage.getItem(pythonDraftKey())??'null');}catch{}
  const chosen=new Set(draft?.reportIds??available.map(item=>item.id));
  pythonReports.replaceChildren();
  for(const report of available)pythonReports.append(el('option',report.title+' · '+report.rowCount+' rows · notes '+report.notesRevision,
    {value:report.id,selected:chosen.has(report.id)}));
  pythonTitle.value=draft?.title??((selected?.selection?.title??'Economic source')+' — complete analyst briefing').slice(0,160);
  pythonNotes.value=draft?.notesRevision??String(notesState?.revision??0);
  pythonInfo.textContent='Current saved notes revision '+(notesState?.revision??0)+'. '+available.length+' complete reports are available for this source.'+
    (notesDirty?' The unsaved notes draft remains separate from this saved selection.':'');
  const retained=(saved?.analysisSources??[]).filter(item=>!selectedId||item.selection.captureId===selectedId);
  if(!retained.length){empty(pythonSources,'Prepared Analysis sources will remain available here after the project reopens.');return;}
  pythonSources.replaceChildren(table(['Saved analysis source','Complete records','Notes revision','Download'],retained,item=>[
    item.selection.title,item.rowCount,item.selection.notesRevision,
    el('a','Complete source',{href:'/api/dbnomics/analysis-export?'+new URLSearchParams({id:item.id}),download:'',className:'db-download'})
  ]));
}

// Full-coordinate revision comparison with explicit metadata changes.
const comparisonPane=panels.get('compare'),before=select(),after=select(),compareControls=group(),comparisonSummary=el('p'),comparisonRows=el('div'),comparisonPages=row(),comparisonMeta=el('pre',undefined,{className:'db-pre'});
compareControls.append(field('Earlier retained edition',before),field('Later retained edition',after),button('Compare original editions',async()=>{compareOffset=0;await compareEditions();}));
comparisonPane.append(el('h3','Source revisions'),el('p','Values compare only within the same provider/dataset/series/period identity. Changed units or dimensions remain visible as meaning changes.'),compareControls,comparisonSummary,comparisonRows,comparisonPages,details('Source metadata changes',comparisonMeta));
async function compareEditions(){
  if(!before.value||!after.value)throw Error('Choose two retained editions.');
  const result=await api('compare?'+new URLSearchParams({before:before.value,after:after.value,offset:String(compareOffset),limit:'50'}));
  comparisonSummary.textContent=result.unchanged+' unchanged · '+result.revised+' revised · '+result.added+' added · '+result.removed+' removed observations · '+result.metadataChanges.length+' series metadata changes.';
  comparisonRows.replaceChildren(table(['Change','Series / period','Earlier exact value','Later exact value','Exact difference','Meaning'],result.changes,item=>[
    item.kind,(item.after??item.before).seriesName+' · '+item.period,item.before?.valueText??'',item.after?.valueText??'',item.delta??'',item.meaningChanged?'Review changed dimensions or frequency':'Same observation identity'
  ]));
  comparisonMeta.textContent=JSON.stringify(result.metadataChanges,null,2);comparisonPages.replaceChildren(el('span',result.page.total+' changed observations'));
  if(compareOffset>0)comparisonPages.append(button('Previous changes',async()=>{compareOffset=Math.max(0,compareOffset-50);await compareEditions();}));
  if(result.page.next!==null)comparisonPages.append(button('Next changes',async()=>{compareOffset=result.page.next;await compareEditions();}));
}

// Reviewed publication enters the original plan/extraction/review/version workflow.
const deliveryPane=panels.get('delivery'),queryForm=el('form'),queryName=input('insee-cpi',{required:true,maxLength:64}),queryReviewer=input('',{required:true}),
  queryReview=area('',3),queryReport=select([['','Original observations']]),includeMissing=input('',{type:'checkbox',checked:true}),queryList=el('div'),querySelect=select(),deliveryStatus=el('p');
const queryFields=group();queryFields.append(field('Saved query name',queryName),field('Source reviewer',queryReviewer),field('Published values',queryReport));
queryForm.append(queryFields,field('Reuse, source and interpretation review',queryReview),field('Retain original missing observations',includeMissing),
  el('p','The source file, original numeric text, dimensions, observation attributes and reuse terms travel with the published edition.',{className:'muted'}),el('button','Save reviewed source query',{type:'submit'}));
deliveryPane.append(el('h3','Customer edition'),queryForm,queryList);
queryForm.addEventListener('submit',action(async()=>{
  if(!selectedId)throw Error('Choose a source edition.');let spec=null;if(queryReport.value){const r=await api('report?id='+encodeURIComponent(queryReport.value)+'&limit=1');if(r.captureId!==selectedId)throw Error('Choose a report from the selected source edition.');spec=r.spec;}
  const query={captureId:selectedId,seriesIds:spec?.seriesIds??selected.series.map(row=>row.id),start:spec?.start??null,end:spec?.end??null,
    includeMissing:includeMissing.checked,analysis:spec,review:{reviewer:queryReviewer.value,note:queryReview.value}};
  const result=await write('query','query',{name:queryName.value,query,expectedHash:saved.sourceHash});await refresh(undefined,false);querySelect.value=result.name;message('Source query saved with its original capture and review.');
}));
const publisherControls=row();
publisherControls.append(field('Saved source query',querySelect),button('Save extraction plan',async()=>{
  const plan=await api('plan-template',{name:querySelect.value}),result=await write('publication-plan','publication-plan',{plan});
  lastPlan=result.plan;deliveryStatus.textContent='Original plan '+lastPlan.id+' saved. Extract this exact plan next.';await publisherHost.refresh();
}),button('Extract saved plan',async()=>{
  if(!lastPlan)throw Error('Save the selected extraction plan first.');
  const result=await write('extraction','extract',{planId:lastPlan.id});await publisherHost.refresh();await publisherHost.openRun(result.id);
  document.getElementById('candidate').scrollIntoView({behavior:'smooth',block:'start'});deliveryStatus.textContent='Original extraction '+result.id+' is '+result.state+'. Inspect, review and publish it in the native publisher below.';
}));
deliveryPane.append(publisherControls,deliveryStatus,row());
const downloadControls=row();downloadControls.append(fileLink('Export sources, reports and note history','source-export'),
  button('Open native publisher',async()=>document.getElementById('configuration').scrollIntoView({behavior:'smooth',block:'start'})));
deliveryPane.append(downloadControls);
const release=details('Package a published edition for the original merchant');
const releaseForm=el('form'),releaseRun=input('',{required:true,placeholder:'Original published extraction UUID'}),releaseDirectory=input('',{required:true}),
  releaseOrigin=input('',{required:true,type:'url',placeholder:'https://your-existing-merchant.example'}),releasePath=input('/data',{required:true}),paymentFile=input('',{type:'file',accept:'.json,application/json'}),releaseResult=el('pre',undefined,{className:'db-pre'});
const releaseFields=group();releaseFields.append(field('Published extraction',releaseRun),field('New package directory',releaseDirectory),field('Existing public merchant origin',releaseOrigin),field('Resource path',releasePath),field('Existing public payment terms JSON',paymentFile));
releaseForm.append(releaseFields,el('button','Prepare complete native release package',{type:'submit'}));
releaseForm.addEventListener('submit',action(async()=>{if(!paymentFile.files[0])throw Error('Choose the merchant’s existing public payment terms.');
  const payment=JSON.parse(await paymentFile.files[0].text()),result=await api('release-prepare',{runId:releaseRun.value,outputDirectory:releaseDirectory.value,origin:releaseOrigin.value,path:releasePath.value,payment});
  releaseResult.textContent=JSON.stringify(result,null,2);message('Prepared the exact published source, dataset, review and seller binding.');}));
release.append(releaseForm,releaseResult,el('p','The installed release-stage, release-activate and release-run commands use the existing SF82 manager. Load its actual seller terms in the native buyer panel below and retain the original buyer configuration.'));
deliveryPane.append(release);
const operations=section(deliveryPane,'Retained operations'),operationRows=el('div');operations.append(operationRows);
async function showOperations(){
  const local=[];
  for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith('dbnomics:'+saved.project.id+':pending:'))local.push({key,...JSON.parse(localStorage.getItem(key))});}
  operationRows.replaceChildren(table(['Operation','State / purpose','Inspect or continue'],saved.operations.slice(-20).reverse(),item=>[
    code(item.id),item.state+' · '+item.kind,button('Read original result',async()=>{const result=await api('operation?id='+item.id);message(JSON.stringify(result));})
  ]));
  if(local.length)operationRows.append(el('h4','Saved browser actions awaiting a returned result'),table(['Action','Original ID','Continuation'],local,item=>[
    item.route,code(item.id),item.input===null?'Reselect the same complete source files and use the original action; its ID and input hash remain saved.':button('Retry exact saved action',async()=>{const result=await api(item.route,{id:item.id,...item.input});localStorage.removeItem(item.key);await refresh();message('Original action returned '+JSON.stringify(result));})
  ]));
}
async function chooseCapture(id){
  selectedId=id;captureSelect.value=id;selected=await api('capture?id='+id);offset=0;noteText.value='';noteObservation.value='';noteObservationLabel.textContent='Edition-level note';
  metadata.textContent=JSON.stringify(selected,null,2);sourceInfo.replaceChildren(el('p',selected.selection.title));
  sourceInfo.append(table(['Series','Frequency','Original observations','Source update'],selected.series,item=>[item.name,item.frequency,item.rowCount,item.sourceUpdatedAt??'Not supplied by source']));
  const terms=el('p',selected.terms.aggregator.attribution+' '+selected.terms.underlying);
  sourceInfo.append(terms,el('p','Retained '+selected.retrievedAt+' · '+selected.sourceMode+' · '+selected.rowCount+' observations / '+selected.missing+' missing values.'));
  const links=row();selected.receipts.forEach((receipt,index)=>links.append(el('a','Original response '+(index+1),{href:'/api/dbnomics/original?'+new URLSearchParams({id,index}),download:''})));sourceInfo.append(links);
  fillSelect(observationSeries,[['','All retained series'],...selected.series.map(item=>[item.id,item.name+' · '+item.frequency])]);
  reportSeries.replaceChildren();for(const item of selected.series)reportSeries.append(el('option',item.name+' · '+item.frequency,{value:item.id,selected:true}));
  await loadNotes();await showObservations();await refreshReportChoices();
}
async function refreshReportChoices(){
  const reports=saved.reports.filter(item=>!selectedId||item.captureId===selectedId);
  fillSelect(reportSelect,reports.map(item=>[item.id,item.title+' · '+item.method]),selectedReport);
  fillSelect(queryReport,[['','Original observations'],...reports.map(item=>[item.id,item.title+' · '+item.method])]);
  if(selectedReport&&!reports.some(item=>item.id===selectedReport)){selectedReport=null;reportData=null;chart.replaceChildren();reportTable.replaceChildren();}
  if(!selectedReport&&reports.length){selectedReport=reports.at(-1).id;reportSelect.value=selectedReport;reportOffset=0;await showReport();}
  renderPythonSources();
}
async function refresh(preferred,loadCapture=true){
  saved=await api('status');summary.replaceChildren();
  for(const [label,value]of [['Retained editions',saved.captures.length],['Original observations',saved.captures.reduce((n,x)=>n+x.rowCount,0)],['Saved reports',saved.reports.length],['Reviewed source queries',Object.keys(saved.queries).length]])
    summary.append(el('div',undefined,{className:'db-metric'}));
  for(const [index,[label,value]]of [['Retained editions',saved.captures.length],['Original observations',saved.captures.reduce((n,x)=>n+x.rowCount,0)],['Saved reports',saved.reports.length],['Reviewed source queries',Object.keys(saved.queries).length]].entries()){
    const box=summary.children[index];box.append(el('strong',String(value)),el('span',label));}
  const choices=saved.captures.map(item=>[item.captureId,item.title+' · '+item.retrievedAt]);
  fillSelect(captureSelect,choices,preferred??selectedId);fillSelect(before,choices);fillSelect(after,choices,choices.at(-1)?.[0]);
  fillSelect(querySelect,Object.keys(saved.queries).map(name=>[name,name]));queryList.replaceChildren(table(['Saved query','Source edition','Analysis','Review'],Object.entries(saved.queries),([name,q])=>[name,code(q.captureId.slice(0,16)),q.analysis?.method??'Original values',q.review.reviewer+' — '+q.review.note]));
  const next=preferred??(saved.captures.some(row=>row.captureId===selectedId)?selectedId:saved.captures.at(-1)?.captureId);
  if(next&&(loadCapture||!selected||next!==selectedId)){if(notesDirty&&next===selectedId)await refreshReportChoices();else await chooseCapture(next);}
  else await refreshReportChoices();
  if(!releaseDirectory.value)releaseDirectory.value=saved.project.directory+'/merchant-package';
  if(!lastPlan&&saved.publisher.plans.length)lastPlan=saved.publisher.plans[0];
  await showOperations();refreshDownloads();message(saved.active?'Active: '+saved.active.kind:'Saved project '+saved.project.id+' · '+saved.captures.length+' complete source editions.');
}
window.addEventListener('beforeunload',event=>{if(notesDirty||noteText.value.trim()){event.preventDefault();event.returnValue='';}});
window.addEventListener('publisher:change',()=>{const run=publisherHost.context().selected;if(run)releaseRun.value=run;});
document.querySelector('footer').textContent='DBnomics original economic sources · Retained analyst editions · Original dataset publisher, merchant and buyer lifecycle';
const schedule=document.getElementById('schedule-panel');
if(schedule){schedule.querySelector('h2').textContent='Publish the reviewed retained source on a schedule';schedule.querySelector('p.muted').textContent='The original scheduler uses the saved immutable source. Acquire and review a new edition, then save its plan to advance the economic source.';}
await action(()=>refresh())();
