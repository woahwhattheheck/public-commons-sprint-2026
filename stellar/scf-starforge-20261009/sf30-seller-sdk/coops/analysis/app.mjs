import {ANALYSIS_VERSION, INPUT_SCHEMA, WORKBOOK_SCHEMA, prepareInput, analyse, saveWorkbook, openWorkbook, residualCsv, episodesCsv, unplacedCsv} from './core.mjs';
const $ = selector => document.querySelector(selector);
const state = {input:null,prepared:null,result:null,notes:{},createdAt:null,localId:null,page:0,dirty:false,busy:false};
const PAGE_SIZE=100;
const el=(name,value,cls)=>{const node=document.createElement(name);if(value!==undefined)node.textContent=String(value);if(cls)node.className=cls;return node;};
const clear=node=>{node.replaceChildren();return node;};
const number=(value,digits=4)=>value===null||value===undefined?'Unavailable':Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const time=value=>value?.replace('T',' ').replace('Z','')||'Unavailable';
function message(value,error=false){const node=$('#message');node.textContent=value;node.classList.toggle('error',error);}
function listen(selector,event,operation){$(selector).addEventListener(event,async e=>{if(event==='submit')e.preventDefault();if(state.busy)return;try{state.busy=true;await operation(e);}catch(error){message(error.message||String(error),true);}finally{state.busy=false;}});}
function button(label,action){const node=el('button',label);node.type='button';node.addEventListener('click',async()=>{if(state.busy)return;try{state.busy=true;await action();}catch(error){message(error.message||String(error),true);}finally{state.busy=false;}});return node;}
function download(body,name,type='application/json'){
  const url=URL.createObjectURL(new Blob([body],{type})),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function detail(title,value){$('#source-title').textContent=title;$('#source-detail').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);$('#source-dialog').showModal();}
function table(headers,records,{numeric=[]}={}){
  const node=el('table'),head=el('thead'),hr=el('tr'),body=el('tbody');
  headers.forEach((header,index)=>{const cell=el('th',header,numeric.includes(index)?'numeric':undefined);cell.scope='col';hr.append(cell);});head.append(hr);node.append(head,body);
  records.forEach(record=>{const tr=el('tr');record.forEach((value,index)=>{const td=el('td',undefined,numeric.includes(index)?'numeric':undefined);if(value instanceof Node)td.append(value);else td.textContent=value===null||value===undefined?'—':String(value);tr.append(td);});body.append(tr);});
  if(!records.length){const tr=el('tr'),td=el('td','No rows for this selection.');td.colSpan=headers.length;tr.append(td);body.append(tr);}
  return node;
}
function metric(label,value,unit){const node=el('dl',undefined,'metric');node.append(el('dt',label));const dd=el('dd',value);if(unit)dd.append(el('small',unit));node.append(dd);return node;}
function setIdentity(){
  const p=state.prepared,c=p.common,node=clear($('#identity')),dl=el('dl',undefined,'identity-grid');
  for(const [label,value] of [['Station',c.station],['Source unit / datum',c.unitLabel+' / '+c.datum],['Time / cadence','GMT / 6 minutes'],['Observation edition',p.observations.editionId],['Prediction edition',p.predictions.editionId],['Datum epoch',c.datumEpoch||'Not reported']]){const block=el('div');block.append(el('dt',label),el('dd',value));dl.append(block);}
  node.append(dl,el('p','Retained metadata: '+c.datumEpochStatus,'hint'),el('p','Analysis source '+p.sourceId,'hash'));
  const parent=clear($('#source-files'));
  for(const role of ['observations','predictions']){
    parent.append(el('h3',role==='observations'?'Original observation files':'Original prediction files'));
    if(state.input[role].original)parent.append(button('Original edition and source availability',()=>detail('Retained '+role+' edition',state.input[role].original)));
    const series=state.input[role],selection=state.prepared[role].selection;
    const selected=button('View original request selection',()=>detail(role+' selection',series.selection));parent.append(selected);
    for(const [kind,entries] of [['response',series.pages],['metadata',series.metadata||[]],['failed response',series.failedResponses||[]]])entries.forEach((file,index)=>{
      const row=el('div',undefined,'source-file'),description=el('div'),name=file.name||role+'-'+kind+'-'+(index+1)+'.json';
      description.append(el('p',name),el('p',file.sha256,'hash'));
      if(file.receipt?.url)description.append(el('p',file.receipt.url,'hash'));
      if(file.receipt?.unavailable || kind==='failed response')
        description.append(el('p',(file.receipt?.unavailable?'Unavailable original source: ':'Original failed response: ')+(file.receipt?.reason||file.receipt?.error?.message||file.receipt?.parseState||'See retained response'),'hint'));
      const actions=el('div',undefined,'toolbar');
      actions.append(button('Inspect',()=>{
        let original;try{original=JSON.parse(file.body.replace(/^\uFEFF/,''));}catch{original=file.body;}
        detail(name,{selection,receipt:file.receipt||{},sha256:file.sha256,original});
      }),
        button('Original response',()=>download(file.body,name,'application/octet-stream')));
      row.append(description,actions);parent.append(row);
    });
  }
  document.querySelectorAll('.unit').forEach(node=>node.textContent='('+c.unitLabel+')');
}
function fillSelection(options){
  const form=$('#selection-form');
  for(const [key,value] of Object.entries(options)){
    const input=form.elements.namedItem(key);if(!input)continue;
    if(input.type==='checkbox')input.checked=value;else input.value=(key==='begin'||key==='end')?value.slice(0,16):value??'';
  }
  form.elements.begin.min=state.prepared.common.begin.slice(0,16);form.elements.begin.max=state.prepared.common.end.slice(0,16);
  form.elements.end.min=form.elements.begin.min;form.elements.end.max=form.elements.begin.max;
  state.dirty=false;$('#pending-selection').textContent='';
}
function optionsFromForm(){
  const form=$('#selection-form');if(!form.reportValidity())throw new Error('Complete the analysis selection fields.');
  const values=Object.fromEntries(new FormData(form));
  return {begin:values.begin+':00Z',end:values.end+':00Z',quality:values.quality,excludeInferred:form.elements.excludeInferred.checked,excludeToleranceFlags:form.elements.excludeToleranceFlags.checked,maxSigma:values.maxSigma,upperThreshold:values.upperThreshold,lowerThreshold:values.lowerThreshold};
}
function notesFromForm(){return Object.fromEntries(new FormData($('#notes-form')));}
function fillNotes(notes){for(const key of ['name','project','question','interpretation','followUp'])$('#notes-form').elements.namedItem(key).value=notes[key]||'';}
function requireApplied(){if(state.dirty)throw new Error('Apply the changed analysis selection before saving or exporting.');if(!state.result)throw new Error('Open the retained coastal source first.');}
function svgNode(name,attributes={},label){
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));if(label!==undefined)node.textContent=label;return node;
}
// Reduce only for display: preserve first/last and each screen bucket's extrema in time order.
function displayPoints(points,x){
  if(points.length<=3000)return points;
  const buckets=new Map();
  points.forEach((point,index)=>{const key=Math.floor(x(point.timeMs)),bucket=buckets.get(key);if(!bucket)buckets.set(key,{first:index,last:index,min:index,max:index});else{bucket.last=index;if(point.value<points[bucket.min].value)bucket.min=index;if(point.value>points[bucket.max].value)bucket.max=index;}});
  const indices=new Set();for(const bucket of buckets.values())for(const key of ['first','min','max','last'])indices.add(bucket[key]);
  return [...indices].sort((a,b)=>a-b).map(index=>points[index]);
}
function drawChart(container,series,{residual=false}={}){
  clear(container);const result=state.result,width=1000,height=280,left=74,right=22,top=30,bottom=52;
  const begin=Date.parse(result.options.begin),end=Date.parse(result.options.end);
  const finiteValues=[];
  for(const line of series)for(const row of result.rows){const value=line.pick(row);if(value!==null&&Number.isFinite(value))finiteValues.push(value);}
  if(residual)finiteValues.push(0,...[result.options.upperThreshold,result.options.lowerThreshold].filter(v=>v!==null));
  if(!finiteValues.length){container.append(el('p','No finite source values are available for this selection.'));return;}
  let min=Infinity,max=-Infinity;for(const value of finiteValues){min=Math.min(min,value);max=Math.max(max,value);}
  const pad=Math.max((max-min)*.08,.01);min-=pad;max+=pad;
  const x=t=>left+(width-left-right)*(t-begin)/Math.max(360000,end-begin),y=v=>top+(height-top-bottom)*(max-v)/(max-min);
  const svg=svgNode('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':residual?'Included observed-minus-predicted residual in '+result.context.unitLabel:'Original observed water level and tidal prediction in '+result.context.unitLabel});
  svg.append(svgNode('title',{},residual?'Residual on the exact source time grid':'Original source water levels'));
  for(let index=0;index<=4;index++){const value=min+(max-min)*index/4,py=y(value);svg.append(svgNode('line',{x1:left,x2:width-right,y1:py,y2:py,class:'grid'}),svgNode('text',{x:left-9,y:py+4,'text-anchor':'end'},number(value,3)));}
  svg.append(svgNode('text',{x:left,y:16},result.context.unitLabel+' relative to '+(residual?'tidal prediction':result.context.datum)));
  for(let index=0;index<=4;index++){const t=begin+(end-begin)*index/4,px=x(t);svg.append(svgNode('text',{x:px,y:height-bottom+21,'text-anchor':index===0?'start':index===4?'end':'middle'},new Date(t).toISOString().slice(5,16).replace('T',' ')));}
  svg.append(svgNode('text',{x:width-right,y:height-7,'text-anchor':'end'},'GMT'));
  if(residual){
    svg.append(svgNode('line',{x1:left,x2:width-right,y1:y(0),y2:y(0),class:'zero'}));
    for(const [name,value]of [['Upper',result.options.upperThreshold],['Lower',result.options.lowerThreshold]])if(value!==null){svg.append(svgNode('line',{x1:left,x2:width-right,y1:y(value),y2:y(value),class:'threshold'}),svgNode('text',{x:width-right-4,y:y(value)-5,'text-anchor':'end'},name+' '+number(value,4)));}
  }
  for(const line of series){
    let segment=[],last=null;
    const flush=()=>{if(!segment.length)return;const points=displayPoints(segment,x);
      if(points.length===1)svg.append(svgNode('circle',{cx:x(points[0].timeMs),cy:y(points[0].value),r:2,fill:line.class==='predicted'?'#777':'#111'}));
      else svg.append(svgNode('path',{d:points.map((point,index)=>(index?'L':'M')+x(point.timeMs).toFixed(2)+' '+y(point.value).toFixed(2)).join(' '),class:line.class}));
      segment=[];};
    for(const row of result.rows){const value=line.pick(row);if(value===null||!row.onGrid){flush();last=null;continue;}if(last!==null&&row.timeMs-last!==360000)flush();segment.push({timeMs:row.timeMs,value});last=row.timeMs;}
    flush();
  }
  container.append(svg);
}
function renderSummary(){
  const r=state.result,c=r.coverage,node=clear($('#coverage'));
  node.append(metric('Expected six-minute slots',number(c.expectedSlots,0)),metric('Finite unique pairs',number(c.pairedFinite,0),number(c.pairedFinitePercent,2)+'% of expected'),metric('Included after selection',number(c.included,0),number(c.includedPercent,2)+'% of expected'),metric('Missing observations',number(c.missingObservationSlots,0)),metric('Missing predictions',number(c.missingPredictionSlots,0)),metric('Ambiguous timestamp slots',number(c.ambiguousObservationSlots+c.ambiguousPredictionSlots,0)));
  const quality=clear($('#quality-summary'));quality.append(el('p','Original observation rows in this window: '+number(c.qualityCounts.verified,0)+' verified; '+number(c.qualityCounts.preliminary,0)+' preliminary; '+number(c.qualityCounts.unreported,0)+' with unreported quality.'));
  quality.append(el('p','Flag detail: '+number(c.flagCounts.inferred,0)+' inferred verified rows; '+number(c.flagCounts.flat,0)+' flat, '+number(c.flagCounts.rate,0)+' rate and '+number(c.flagCounts.height,0)+' height tolerance flags; '+number(c.flagCounts.unknown,0)+' unavailable flag sets. Preliminary outside-band one-second sample count: '+number(c.flagCounts.preliminarySamplesOutsideBand,0)+'.','hint'));
  if(c.offGridTimestamps||c.unplacedSourceRows)quality.append(el('p',number(c.offGridTimestamps,0)+' off-grid timestamps and '+number(c.unplacedSourceRows,0)+' invalid-timestamp source rows are retained outside the included analysis. The complete exports preserve them.','hint'));
  clear($('#gaps')).append(table(['Reason','First expected sample GMT','Last expected sample GMT','Slots','First-to-last min'],r.gaps.slice(0,200).map(v=>[v.reason,time(v.first),time(v.last),number(v.count,0),number(v.sampleSpanMinutes,0)]),{numeric:[3,4]}));
  if(r.gaps.length>200)$('#gaps').append(el('p','Showing the first 200 of '+r.gaps.length+' spans. The analysis JSON includes every span.','hint'));
  const stats=clear($('#statistics')),s=r.statistics,unit=r.context.unitLabel;
  for(const [label,value]of [['Mean residual',s.mean],['Median residual',s.median],['5th percentile',s.p05],['95th percentile',s.p95],['Sample standard deviation',s.sampleStandardDeviation],['RMS residual',s.rmsResidual],['Minimum residual',s.minimum?.value],['Maximum residual',s.maximum?.value]])stats.append(metric(label,number(value),unit));
  const o=r.options;$('#applied-selection').textContent=time(o.begin)+' through '+time(o.end)+' GMT, inclusive. Quality: '+o.quality+'. '+(o.excludeInferred?'Inferred verified and unknown inference excluded. ':'')+(o.excludeToleranceFlags?'Tolerance flags and unknown flag detail excluded. ':'')+(o.maxSigma!==null?'Maximum sigma '+number(o.maxSigma)+' '+unit+'. ':'');
  const episodes=clear($('#episodes'));episodes.append(table(['Threshold','First qualifying GMT','Last qualifying GMT','Samples','Span min','Peak residual','Peak GMT','Ended by'],r.episodes.slice(0,200).map(v=>[v.direction+' '+number(v.threshold)+' '+unit,time(v.first),time(v.last),number(v.samples,0),number(v.sampleSpanMinutes,0),number(v.peak.value)+' '+unit,time(v.peak.time),v.endReason]),{numeric:[3,4,5]}));
  if(r.episodes.length>200)episodes.append(el('p','Showing the first 200 of '+r.episodes.length+' episodes. The episodes CSV includes every episode.','hint'));
  if(o.upperThreshold===null&&o.lowerThreshold===null)episodes.append(el('p','Set an analyst threshold to identify corresponding residual episodes.','hint'));
  drawChart($('#level-chart'),[{class:'observed',pick:row=>row.observations.length===1?row.observed:null},{class:'predicted',pick:row=>row.predictions.length===1?row.predicted:null}]);
  drawChart($('#residual-chart'),[{class:'observed',pick:row=>row.residual}],{residual:true});
  const methods=clear($('#methods')),dl=el('dl');for(const[key,value]of Object.entries(r.method)){dl.append(el('dt',key[0].toUpperCase()+key.slice(1)),el('dd',value));}methods.append(dl,el('p','Calculator version '+r.version+' · source '+r.sourceId,'hash'));
}
function visibleRows(){
  const filter=$('#row-filter').value,search=$('#row-search').value.trim().replace(' ','T');
  return state.result.rows.filter(row=>(filter==='all'||(filter==='included'?row.status==='included':row.status!=='included'))&&(!search||row.time.includes(search)));
}
function renderRows(){
  const rows=visibleRows(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));state.page=Math.min(state.page,pages-1);
  const start=state.page*PAGE_SIZE;
  const records=rows.slice(start,start+PAGE_SIZE).map(row=>{const open=button(time(row.time),()=>detail('Original rows at '+time(row.time)+' GMT',{sourceId:state.result.sourceId,context:state.result.context,...row}));open.className='row-time';
    return[open,row.status,number(row.observed),number(row.predicted),number(row.rawResidual),number(row.residual),row.observations.length===1?row.observations[0].quality.label:row.observations.length>1?'Ambiguous':'Unavailable'];});
  clear($('#rows')).append(table(['Time GMT','Status','Observed','Predicted','Raw residual','Included residual','Observation quality'],records,{numeric:[2,3,4,5]}));
  $('#page-label').textContent=rows.length?number(start+1,0)+'–'+number(Math.min(start+PAGE_SIZE,rows.length),0)+' of '+number(rows.length,0):'0 rows';
  $('#previous').disabled=state.page===0;$('#next').disabled=state.page>=pages-1;
}
function render(){renderSummary();renderRows();$('#loaded').hidden=false;$('#empty-state').hidden=true;}
async function acceptDocument(document){
  message('Opening and checking the original source files…');
  let prepared,result,notes={},createdAt=null,input=document;
  if(document.schema===WORKBOOK_SCHEMA){const opened=await openWorkbook(document);prepared=opened.prepared;result=opened.result;notes=opened.document.analyst;createdAt=opened.document.createdAt;input=opened.document.input;}
  else if(document.schema===INPUT_SCHEMA){prepared=await prepareInput(document);result=analyse(prepared);}
  else throw new Error('Choose the original CO-OPS analysis input or a portable analysis workbook.');
  state.input=input;state.prepared=prepared;state.result=result;state.notes=notes;state.createdAt=createdAt||new Date().toISOString();state.localId=prepared.sourceId+'-'+state.createdAt;state.page=0;
  setIdentity();fillSelection(result.options);fillNotes(notes);render();message('Opened station '+prepared.common.station+' with '+number(result.coverage.included,0)+' included pairs. Original response hashes are verified'+(document.schema===WORKBOOK_SCHEMA?' and the saved calculation recomputes exactly.':'; the calculation uses the selected original rows.'));
}
async function currentWorkbook(){requireApplied();state.notes=notesFromForm();return saveWorkbook(state.input,state.result.options,state.notes,{createdAt:state.createdAt});}
function fileStem(){return 'coops-'+state.prepared.common.station+'-'+state.result.options.begin.slice(0,10)+'-'+state.prepared.sourceId.slice(0,12);}
async function database(){
  if(!globalThis.indexedDB)throw new Error('Device storage is unavailable in this browser. Download a portable workbook to retain this review.');
  return new Promise((yes,no)=>{const request=indexedDB.open('stellar-forge-coops-analysis',1);request.onupgradeneeded=()=>request.result.createObjectStore('workbooks',{keyPath:'id'});request.onsuccess=()=>yes(request.result);request.onerror=()=>no(new Error('Device storage could not be opened. Download a portable workbook.'));});
}
async function dbOperation(mode,operation){
  const db=await database();
  try{return await new Promise((yes,no)=>{const transaction=db.transaction('workbooks',mode);let result;
    const request=operation(transaction.objectStore('workbooks'));request.onsuccess=()=>result=request.result;request.onerror=()=>no(request.error);transaction.oncomplete=()=>yes(result);transaction.onabort=()=>no(transaction.error||new Error('The device save did not complete.'));transaction.onerror=()=>no(transaction.error);});}finally{db.close();}
}
async function showSaved(){
  const entries=await dbOperation('readonly',store=>store.getAll()),parent=clear($('#saved-items'));
  if(!entries.length)parent.append(el('p','No coastal workbooks have been saved on this device.'));
  entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).forEach(entry=>{
    const item=el('div',undefined,'saved-item'),description=el('div'),wb=entry.workbook;
    description.append(el('strong',(wb.analyst.project||'Coastal review')+' · station '+wb.input.observations.selection.station),el('p','Saved '+entry.updatedAt.replace('T',' ').slice(0,19)+' GMT'),el('p',wb.sourceId,'hash'));
    const actions=el('div',undefined,'toolbar');actions.append(button('Open',async()=>{await acceptDocument(wb);state.localId=entry.id;$('#saved-dialog').close();}),
      button('Download',()=>download(JSON.stringify(wb,null,2)+'\n','coops-workbook-'+wb.sourceId.slice(0,12)+'.json')),
      button('Remove device copy',async()=>{if(!confirm('Remove this device copy? Downloaded portable files remain available.'))return;await dbOperation('readwrite',store=>store.delete(entry.id));item.remove();}));
    item.append(description,actions);parent.append(item);
  });$('#saved-dialog').showModal();
}
function preparePrint(){
  for(const input of $('#notes-form').querySelectorAll('input,textarea')){
    let preview=input.parentElement.querySelector('.print-value');if(!preview){preview=el('div',undefined,'print-value');input.parentElement.append(preview);}preview.textContent=input.value||'—';
  }
}
listen('#open-file','change',async event=>{const file=event.target.files[0];if(!file)return;if(file.size>256*1024*1024)throw new Error('Choose a workbook of up to 256 MB.');await acceptDocument(JSON.parse(await file.text()));event.target.value='';});
listen('#selection-form','submit',async event=>{event.preventDefault();const options=optionsFromForm();state.result=analyse(state.prepared,options);state.page=0;fillSelection(state.result.options);render();message('Applied the analysis selection. '+number(state.result.coverage.included,0)+' finite source pairs are included.');});
$('#selection-form').addEventListener('input',()=>{state.dirty=true;$('#pending-selection').textContent='Selection changes not applied';});
listen('#reset-selection','click',async()=>{state.result=analyse(state.prepared);state.page=0;fillSelection(state.result.options);render();message('Applied the full overlapping source window and all reported quality levels.');});
listen('#row-filter','change',async()=>{state.page=0;renderRows();});
listen('#row-search','input',async()=>{state.page=0;renderRows();});
listen('#previous','click',async()=>{state.page--;renderRows();});
listen('#next','click',async()=>{state.page++;renderRows();});
listen('#device-list','click',showSaved);
listen('#save-device','click',async()=>{const workbook=await currentWorkbook();await dbOperation('readwrite',store=>store.put({id:state.localId,updatedAt:new Date().toISOString(),workbook}));message('Saved the original source, analysis selection and interpretation on this device.');});
listen('#export-workbook','click',async()=>{const workbook=await currentWorkbook();download(JSON.stringify(workbook,null,2)+'\n',fileStem()+'-workbook.json');message('Downloaded the complete portable workbook. It can reopen and recompute from its embedded original source.');});
listen('#export-csv','click',async()=>{requireApplied();download(residualCsv(state.result),fileStem()+'-paired.csv','text/csv;charset=utf-8');});
listen('#export-episodes','click',async()=>{requireApplied();download(episodesCsv(state.result),fileStem()+'-episodes.csv','text/csv;charset=utf-8');});
listen('#export-json','click',async()=>{requireApplied();download(JSON.stringify(state.result,null,2)+'\n',fileStem()+'-analysis.json');});
listen('#export-unplaced','click',async()=>{requireApplied();download(unplacedCsv(state.result),fileStem()+'-unplaced.csv','text/csv;charset=utf-8');});
listen('#print','click',async()=>{requireApplied();preparePrint();window.print();});
window.addEventListener('beforeprint',preparePrint);
$('#version').textContent=ANALYSIS_VERSION;
const initial=$('#initial-source');
if(initial?.textContent.trim())acceptDocument(JSON.parse(initial.textContent)).catch(error=>message(error.message,true));
