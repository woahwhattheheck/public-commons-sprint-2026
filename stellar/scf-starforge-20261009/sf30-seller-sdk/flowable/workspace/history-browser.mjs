// MIT. Original saved portfolio analysis; complete sources and reports remain downloadable.
export function installFlowableHistory({api,historyAPI,write,busy,button,node,keyValues,notice,reload,openRecord,records,requireEngine,workspaceId,portfolio}){
 const root=document.querySelector('[data-panel="history-analysis"]'),form=root.querySelector('#history-form'),definitions=root.querySelector('#history-definitions'),
 status=root.querySelector('#history-status'),resultBox=root.querySelector('#history-result');
 let generation=0,context=null,capture=null,loadedKey=null,result=null;
 const fields=['title','from','to','asOf','retentionNote'];
 const draftKey=()=> 'flowable-history-draft:'+workspaceId()+':'+requireEngine();
 const currentSelection=()=>Object.fromEntries([...fields.map(name=>[name,form.elements[name].value]),['definitionIds',[...definitions.selectedOptions].map(o=>o.value)]]);
 const selectedInput=()=>({connectionId:requireEngine(),portfolioId:capture?.id,revision:capture?.revision,selection:currentSelection()});
 function persist(){try{sessionStorage.setItem(draftKey(),JSON.stringify(currentSelection()));}catch{notice('This tab could not retain the analysis selection. Download its selection JSON.','error');}}
 function clear(message){result=null;resultBox.replaceChildren(node('p',message));}
 function changed(){generation++;persist();clear('Run the current selection to regenerate the report and downloads.');}
 for(const name of fields)form.elements[name].addEventListener('input',changed);definitions.addEventListener('change',changed);
 function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));const a=node('a',null,{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function table(headers,rows){
  const wrap=node('div',null,{class:'table-wrap'}),table=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');
  for(const title of headers)tr.append(node('th',title,{scope:'col'}));head.append(tr);
  let shown=0;const more=button('Show 100 more rows',()=>append());
  function append(){for(const values of rows.slice(shown,shown+100)){const row=node('tr');for(const value of values)row.append(node('td',value??'—'));body.append(row);}shown=Math.min(shown+100,rows.length);more.hidden=shown>=rows.length;caption.textContent=shown+' of '+rows.length+' rows';}
  const caption=node('p');table.append(head,body);wrap.append(table,caption,more);append();if(!rows.length){const empty=node('tr');empty.append(node('td','No observations in this selection.',{colspan:headers.length}));body.append(empty);}return wrap;
 }
 const hours=ms=>ms==null?'—':(Number(ms)/3600000).toLocaleString(undefined,{maximumFractionDigits:3})+' h';
 function display(value){
  result=value;const r=value.report;resultBox.replaceChildren(node('h2',r.title),
   node('p',r.source.origin==='authored-reference'?'Authored demonstration data — no customer or engine outcome.':'Original saved process-history capture.'),
   keyValues([['Start cohort',r.selection.from+' ≤ start < '+r.selection.to],['As of',r.selection.asOf],['Capture revision',r.source.record.id+' / '+r.source.record.revision],
    ['Selected processes',r.coverage.selectedProcesses],['Bundle SHA-256',value.bundleSha256]]));
  const toolbar=node('div',null,{class:'toolbar'});
  toolbar.append(button('Download source bundle',()=>download('workflow-history.history.json',value.bundleText)),
   button('Download HTML report',()=>download('workflow-history.html',value.html,'text/html')),
   button('Download selection',()=>download('history-selection.json',JSON.stringify(r.selection,null,2)+'\n')));
  for(const kind of ['processes','tasks','activities'])toolbar.append(button('Download '+kind+' CSV',()=>download('history-'+kind+'.csv',value.csv[kind],'text/csv')));
  if(r.source.origin!=='authored-reference')toolbar.append(button('Export complete original workspace',async()=>{
   if(r.source.record.id!==capture?.id||r.source.record.revision!==capture?.revision)throw Error('Select the report original capture before exporting this workspace.');
   const original=await api('getRecord',{kind:'portfolio',id:r.source.record.id,revision:r.source.record.revision});
   if(original.sha256!==r.source.record.sha256)throw Error('This workspace does not contain the report original source revision.');
   const delivery=await write('exportWorkspace',{label:r.title+' complete native source'});await reload();await openRecord(delivery.kind,delivery.id);
  }));
  resultBox.append(toolbar);
  const groups=(title,rows)=>{resultBox.append(node('h3',title),table(['Definition / activity','Observed','Completed','Open','Terminated','Median completed','p90 completed','Oldest open','Repeated processes'],
   rows.map(g=>[(g.key?g.key+' · ':'')+g.processDefinitionId,g.observed,g.completed,g.open,g.terminated,hours(g.completedDuration.medianMillis),hours(g.completedDuration.p90Millis),hours(g.openAge.maximumMillis),g.processesWithRepeatedOccurrences])));};
  groups('Process durations and open age',r.processGroups);groups('Task observations',r.taskGroups);groups('Activity occurrences',r.activityGroups);
  resultBox.append(node('h3','Coverage'),node('p',r.selection.retentionNote),node('p',r.method.coverage),node('p',r.method.durations),node('p',r.method.repetition),
   table(['Collection','Original ID','Source-quality observation'],r.coverage.issues.map(i=>[i.collection,i.id,i.message])));
 }
 form.addEventListener('submit',e=>{e.preventDefault();busy('Analyse saved process history',async()=>{
  if(!capture)throw Error('Select a complete saved process capture.');const input=selectedInput(),frozen=JSON.stringify(input),epoch=++generation;
  status.textContent='Analysing the selected original capture…';const value=await historyAPI('analyse',input);
  if(epoch!==generation||frozen!==JSON.stringify(selectedInput()))throw Error('The selection changed. Run the current selection.');
  display(value);status.textContent='Analysis uses saved capture '+capture.id+' revision '+capture.revision+'.';persist();
 });});
 root.querySelector('#history-example').addEventListener('click',()=>busy('Open authored history reference',async()=>{
  const epoch=++generation,value=await historyAPI('example',{});if(epoch!==generation)return;display(value);
 }));
 root.querySelector('#history-reopen').addEventListener('change',e=>busy('Reopen complete history bundle',async()=>{
  const file=e.target.files[0];if(!file)return;if(file.size>64*1024*1024)throw Error('A history bundle is limited to 64 MiB.');
  const epoch=++generation,bundleText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()),value=await historyAPI('reopen',{bundleText});
  if(epoch!==generation)return;display(value);e.target.value='';notice('Report reproduced from its complete original inventory bytes.');
 }));
 return{async render(){
  const epoch=++generation,nextContext=JSON.stringify([workspaceId(),requireEngine()]),nextCapture=records('portfolio').find(r=>r.id===portfolio()&&r.connectionId===requireEngine()&&r.state==='CAPTURED')??null;
  if(context!==nextContext){context=nextContext;capture=null;loadedKey=null;clear('Select an original process capture, or open the authored reference.');for(const name of fields)form.elements[name].value='';definitions.replaceChildren();
   let saved=null;try{saved=JSON.parse(sessionStorage.getItem(draftKey())??'null');}catch{}
   if(saved){for(const name of fields)form.elements[name].value=saved[name]??'';definitions.dataset.restore=JSON.stringify(saved.definitionIds??[]);}
  }
  const nextKey=JSON.stringify([nextContext,nextCapture?.id,nextCapture?.revision]);
  if(nextKey!==loadedKey){
   capture=nextCapture;clear('Choose exact definition editions and a UTC start-cohort window.');
   const all=[];if(capture){let offset=0;do{const page=await api('readPortfolio',{id:capture.id,revision:capture.revision,collection:'definitions',offset,limit:500});if(epoch!==generation)return;all.push(...page.items);offset=page.nextOffset;}while(offset!=null);}
   if(epoch!==generation)return;
   let prior=[];try{prior=JSON.parse(definitions.dataset.restore??'[]');}catch{};const selected=new Set([...definitions.selectedOptions].map(o=>o.value).concat(prior));definitions.replaceChildren();
   for(const d of all){const option=node('option',(d.name??d.key)+' · '+d.key+' · v'+d.version+' · '+d.id,{value:d.id});option.selected=selected.has(d.id);definitions.append(option);}
   definitions.dataset.restore='[]';loadedKey=nextKey;
   if(capture&&!form.elements.asOf.value){const original=await api('getRecord',{kind:'portfolio',id:capture.id,revision:capture.revision});if(epoch!==generation)return;
    const end=original.portfolio?.startedAt;if(end){const date=new Date(end);form.elements.asOf.value=end;form.elements.to.value=end;form.elements.from.value=new Date(date.valueOf()-30*86400000).toISOString();}}
   if(!form.elements.title.value)form.elements.title.value='Workflow history review';
  }
  status.textContent=capture?'Saved process capture '+capture.id+' revision '+capture.revision+'. Select exact definition editions.':'Refresh the process engine or select a saved process portfolio to analyse its native history.';
 }};
}
