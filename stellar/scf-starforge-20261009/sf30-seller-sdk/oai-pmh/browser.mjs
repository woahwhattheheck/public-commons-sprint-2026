// MIT. Industrial operator console, one retained XML/OAI workspace.
const token=document.querySelector('meta[name="oai-session"]').content;
const $=id=>document.getElementById(id), short=id=>String(id??'').slice(0,12);
let state,tab='Repositories',selectedRepo='',selectedOperation='',selectedPreview='',selectedEdition='',selectedBuild='',mappingDraft=null;
const tabs=['Repositories','Harvests','Edition review','Records','Projection','Exports'];
function el(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k in n)n[k]=v;else n.setAttribute(k,v);}for(const child of children.flat(Infinity)){if(child!==null&&child!==undefined)n.append(child instanceof Node?child:document.createTextNode(String(child)));}return n;}
const paragraph=text=>el('p',{},text), pre=value=>el('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2));
const button=(label,fn,primary=false)=>el('button',{class:primary?'primary':'',onclick:()=>work(fn)},label);
const option=(value,label)=>el('option',{value},label);
function field(label,control){return el('div',{},el('label',{},label,control));}
function select(items,id,change,placeholder='Choose…'){const n=el('select',{onchange:e=>change?.(e.target.value)},option('',placeholder),...items.map(([key,label])=>option(key,label)));n.value=id;return n;}
function table(headers,rows){return el('div',{class:'table'},el('table',{},el('thead',{},el('tr',{},...headers.map(x=>el('th',{},x)))),el('tbody',{},...rows.map(row=>el('tr',{},...row.map(x=>el('td',{},x)))))));}
const panel=(title,...body)=>el('section',{},el('h2',{},title),...body);
function notice(message){$('notice').textContent=message;}
async function get(path){const r=await fetch(path,{cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error??r.statusText);return v;}
async function action(action,payload){const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-OAI-Session':token},body:JSON.stringify({action,payload})}),v=await r.json();if(!r.ok)throw Error(v.error??r.statusText);return v;}
async function object(kind,id){return get('/api/object?'+new URLSearchParams({kind,id}));}
async function work(fn){try{notice('');$('activity').textContent='Working';await fn();}catch(e){notice(e.message);}finally{activity();}}
function activity(){if(state)$('activity').textContent=state.running?'Harvest running · '+(state.active??'starting'):'Workspace ready';}
async function refresh(renderView=true){state=await get('/api/state');selectedRepo ||=state.repositories[0]?.id??'';selectedEdition ||=state.editions[0]?.id??'';selectedOperation ||=state.operations[0]?.id??'';selectedPreview ||=state.previews[0]?.id??'';selectedBuild ||=state.builds[0]?.id??'';$('workspace').textContent=state.directory;activity();if(state.workerError)notice(state.workerError);if(renderView)await render();}
function go(name){tab=name;return render();}
async function more(kind){const next=state.pages[kind]?.next;if(next==null)return;const result=await get('/api/history?'+new URLSearchParams({kind,offset:next,limit:50}));state[kind].push(...result.items);state.pages[kind]={...result};delete state.pages[kind].items;return render();}
function moreButton(kind){return state.pages[kind]?.next!=null?button('Load more '+kind,()=>more(kind)):null;}
function repoSelect(fn){return select(state.repositories.map(r=>[r.id,r.label]),selectedRepo,v=>{selectedRepo=v;fn?.(v);});}
function editionSelect(fn){return select(state.editions.map(e=>[e.id,short(e.id)+' · '+e.activeRecords+' records · '+e.selection.metadataPrefix]),selectedEdition,v=>{selectedEdition=v;fn?.(v);});}
function operationSelect(verbs,fn){return select(state.operations.filter(o=>verbs.includes(o.verb)).map(o=>[o.id,o.id+' · '+o.status]),selectedOperation,v=>{selectedOperation=v;fn?.(v);});}
function metrics(values){return el('div',{class:'metrics'},...Object.entries(values).map(([label,value])=>el('div',{class:'metric'},el('b',{},value),el('span',{},label))));}
async function paged(container,path,draw,offset=0){const join=path.includes('?')?'&':'?';const data=await get(path+join+'offset='+offset+'&limit=100');container.replaceChildren(draw(data.items),el('div',{class:'pager'},el('span',{class:'muted'},data.total+' records · '+(data.items.length?offset+1:0)+'–'+(offset+data.items.length)),...(offset?[button('Previous',()=>paged(container,path,draw,Math.max(0,offset-100)))]:[]),...(data.next!==null?[button('Next',()=>paged(container,path,draw,data.next))]:[])));return data;}
async function render(){
 $('navigation').replaceChildren(...tabs.map(name=>el('button',{'aria-current':tab===name?'page':'false',onclick:()=>work(()=>go(name))},name)));
 const root=$('content');root.replaceChildren();
 if(tab==='Repositories')await repositories(root);
 if(tab==='Harvests')await harvests(root);
 if(tab==='Edition review')await reviews(root);
 if(tab==='Records')await records(root);
 if(tab==='Projection')await projection(root);
 if(tab==='Exports')await exportsView(root);
}
async function repositories(root){
 const url=el('input',{type:'url',placeholder:'https://zenodo.org/oai2d'}),label=el('input',{placeholder:'Repository name'}),interval=el('input',{type:'number',min:0,step:0.1,value:2.1});
 const add=panel('Add a repository',paragraph('Use its OAI-PMH base URL. Discovery retains the repository identity, available metadata formats and complete set pages.'),field('Base URL',url),field('Display name',label),field('Minimum seconds between requests',interval),button('Add repository',async()=>{const r=await action('repository',{url:url.value,label:label.value||url.value,interval:Number(interval.value)});selectedRepo=r.id;await refresh();},true));
 const right=panel('Repository discovery',field('Repository',repoSelect(()=>work(()=>render()))),moreButton('repositories'));
 root.append(el('div',{class:'grid'},add,right));
 if(!selectedRepo)return;
 const repo=await object('repository',selectedRepo);
 right.append(paragraph(repo.baseURL),el('div',{class:'actions'},...['Identify','ListMetadataFormats','ListSets'].map(verb=>button(verb,async()=>{const id='discover-'+verb+'-'+Date.now();selectedOperation=id;await action('start',{repositoryId:selectedRepo,verb,arguments:{},operationId:id});await refresh();}))));
 right.append(metrics({Identity:repo.identify?'Saved':'Pending',Formats:repo.formatsComplete?'Complete':'Pending',Sets:repo.setsSupported===false?'Unsupported':repo.setsComplete?'Complete':'Pending'}));
 if(repo.identify)right.append(pre(repo.identify));
 const catalog=panel('Available metadata formats and sets');root.append(catalog);
 for(const kind of ['formats','sets']){const host=el('div');catalog.append(el('h3',{},kind==='formats'?'Metadata formats':'Sets'),host);await paged(host,'/api/catalog?'+new URLSearchParams({repository:selectedRepo,kind}),items=>table(kind==='formats'?['Prefix','XML namespace','Schema']:['Set','Name'],items.map(({value:v})=>kind==='formats'?[v.metadataPrefix,v.metadataNamespace,v.schema]:[v.setSpec,v.setName])));}
}
async function harvests(root){
 const repo=repoSelect(),id=el('input',{value:'harvest-'+Date.now()}),format=el('input',{placeholder:'Exact discovered metadataPrefix'}),set=el('input',{placeholder:'Optional setSpec'}),from=el('input',{placeholder:'YYYY-MM-DD or UTC timestamp'}),until=el('input',{placeholder:'Inclusive final date'}),baseline=select(state.editions.map(e=>[e.id,short(e.id)+' · '+e.activeRecords+' records']),null,null,'Start without a baseline');
 const form=panel('Harvest a selected population',paragraph('The console follows every continuation automatically. From and until are inclusive. A baseline carries forward records absent from this selection; deletion requires an explicit repository notice.'),el('div',{class:'formgrid'},field('Repository',repo),field('Stable operation ID',id),field('Metadata prefix',format),field('Set',set),field('From',from),field('Until',until),el('div',{class:'full'},field('Reviewed baseline edition',baseline))),button('Start complete harvest',async()=>{const args={metadataPrefix:format.value};for(const [k,n]of [['set',set],['from',from],['until',until]])if(n.value)args[k]=n.value;selectedOperation=id.value;await action('start',{repositoryId:repo.value,verb:'ListRecords',arguments:args,operationId:id.value,baseline:baseline.value||null});await refresh();},true));
 root.append(form);
 const history=panel('Retained operations',table(['Operation','Verb / selection','State','Pages','Actions'],state.operations.map(o=>[o.id,el('div',{},o.verb,el('div',{class:'muted'},JSON.stringify(o.selection))),el('div',{},el('span',{class:'tag'},o.status),o.lastError?el('div',{class:'muted'},o.lastError):null),o.pageCount,el('div',{class:'actions'},button('Open',async()=>{selectedOperation=o.id;await render();}),...(!['COMPLETE','FETCHING'].includes(o.status)?[button('Resume',async()=>{await action('run',{id:o.id});await refresh();})]:[]),...(o.status==='COMPLETE'&&o.verb==='ListRecords'?[button('Review edition',async()=>{const p=await action('preview',{operationId:o.id});selectedPreview=p.id;selectedOperation=o.id;await refresh(false);await go('Edition review');})]:[]))])),moreButton('operations'));
 if(state.running)history.append(button('Cancel active harvest',async()=>{await action('cancel',{});await refresh();}));
 root.append(history);
 if(selectedOperation){
  const op=await object('operation',selectedOperation),host=el('div');
  const details=panel('Operation '+op.id,pre(op),host);root.append(details);
  await paged(host,'/api/requests?'+new URLSearchParams({operation:op.id}),items=>table(['Attempt / page','Original request','HTTP / records','Response'],items.map(r=>[r.attempt+' / '+r.ordinal,r.url,(r.http?.status??r.state)+' / '+(r.parsed?.recordCount??'—'),r.response?el('a',{class:'button',href:'/download/response?id='+encodeURIComponent(r.id)},'Download exact body'):r.error??'Awaiting response'])));
  const file=el('input',{type:'file'}),meta=el('textarea',{class:'code',rows:7,placeholder:'{"url":"exact request URL","status":200,"headers":[],"observedAt":"UTC acquisition time"}'});
  const input=el('details',{},el('summary',{},'Import a response acquired on another host'),paragraph('Select the unchanged response body and its observed transport metadata. The request URL must match this operation’s next request.'),field('Original response body (up to 32 MiB)',file),field('Observed HTTP metadata',meta),button('Import original response',async()=>{if(!file.files[0])throw Error('Select the original response file');if(file.files[0].size>32*1024*1024)throw Error('Use the native import-response command for a larger response');const bytes=new Uint8Array(await file.files[0].arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));await action('import',{operationId:op.id,metadata:JSON.parse(meta.value),bodyBase64:btoa(binary)});await refresh();}));
  details.append(input);
 }
}
async function reviews(root){
 const sel=select(state.previews.map(p=>[p.id,short(p.id)+' · '+p.operationId]),selectedPreview,v=>{selectedPreview=v;work(()=>render());});
 root.append(panel('Edition review',field('Saved reconciliation',sel),moreButton('previews'),paragraph('Compare exact repository identifiers and datestamps. Resolve each same-datestamp conflict by choosing a retained observation; the reviewed record edition becomes the input to projection.')));
 if(!selectedPreview)return;
 const p=await object('preview',selectedPreview),choices=structuredClone(p.choices),host=el('div'),reviewer=el('input',{placeholder:'Reviewer name'}),note=el('textarea',{placeholder:'Selection, source rights and reconciliation decision'});
 const body=panel('Reconciliation '+short(p.id),metrics(p.counts),paragraph(p.semantics),host);root.append(body);
 await paged(host,'/api/changes?'+new URLSearchParams({preview:p.id}),items=>table(['Identifier','Change','Retained observations'],items.map(row=>{
  const cell=el('div');
  if(row.conflicts.length){
   const pick=select(row.conflicts.map(o=>[o.id,short(o.id)+' · '+o.datestamp+' · '+o.status]),choices[row.identifier]?.observationId??'',null,'Choose the record to retain'),why=el('input',{placeholder:'Reason for this choice',value:choices[row.identifier]?.note??''});
   cell.append(pick,why,button('Inspect selected',async()=>{if(!pick.value)throw Error('Select an observation');showDetail(await object('observation',pick.value));}),button('Save conflict choice',async()=>{choices[row.identifier]={observationId:pick.value,note:why.value};const value=await action('preview',{operationId:p.operationId,choices});selectedPreview=value.id;await refresh();}));
  }else if(row.after)cell.append(button('Inspect record',async()=>showDetail(await object('observation',row.after))));
  return[row.identifier,row.kind,cell];
 })));
 if(p.ready)body.append(el('hr'),field('Reviewer',reviewer),field('Edition review note',note),button('Approve this complete edition',async()=>{const e=await action('review',{id:p.id,expectedDigest:p.id,reviewer:reviewer.value,note:note.value});selectedEdition=e.id;await refresh(false);await go('Records');},true));
 else body.append(paragraph('Resolve the conflicting identifiers shown above to approve this edition.'));
}
function showDetail(value){let host=$('detail');if(!host){host=el('section',{id:'detail'});$('content').append(host);}host.replaceChildren(el('h2',{},'Retained record'),pre(value));host.scrollIntoView({block:'nearest'});}
async function records(root){
 const query=el('input',{placeholder:'Find an exact identifier or substring'}),host=el('div');
 root.append(panel('Reviewed record editions',field('Edition',editionSelect(()=>work(()=>render()))),moreButton('editions')));
 if(!selectedEdition)return;
 const e=await object('edition',selectedEdition);
 root.append(panel('Edition '+short(e.id),metrics({'Active records':e.activeRecords,'Deleted records':e.deletedRecords}),pre({repository:e.repository.baseURL,selection:e.selection,review:e.review}),field('Identifier search',query),button('Search',load),host,button('Project this edition',()=>go('Projection'),true)));
 async function load(){await paged(host,'/api/records?'+new URLSearchParams({edition:selectedEdition,query:query.value}),items=>table(['Identifier','Datestamp','State','Source'],items.map(r=>[r.identifier,r.datestamp,r.status,button('Inspect source record',async()=>showDetail(await object('observation',r.id)))])));}
 await load();
}
async function projection(root){
 const saved=select(state.mappings.map(m=>[m.id,m.name+' · '+short(m.id)]),'',async value=>{if(value){mappingDraft=await object('mapping',value);editor.value=JSON.stringify(mappingDraft,null,2);}}),editor=el('textarea',{class:'code',rows:23});
 mappingDraft ||=await get('/api/default-mapping');editor.value=JSON.stringify(mappingDraft,null,2);editor.addEventListener('input',()=>{try{mappingDraft=JSON.parse(editor.value);}catch{}});
 const current=selectedEdition?await object('edition',selectedEdition):null;
 const body=panel('Project a reviewed record edition',field('Edition',editionSelect(()=>work(()=>render()))),field('Reuse a saved XML mapping',saved),paragraph('Paths use expanded XML names, such as {namespace URI}title. Repeated values, missing elements, nulls, scalar types, filter fields and edition keys are explicit mapping choices. The complete edition is checked by the existing SF30 dataset engine.'),field('XML mapping',editor),el('div',{class:'actions'},
 button('Save mapping and build full dataset',async()=>{if(!selectedEdition)throw Error('Choose a reviewed edition');mappingDraft=JSON.parse(editor.value);const m=await action('mapping',{plan:mappingDraft});const b=await action('build',{editionId:selectedEdition,planId:m.id});selectedBuild=b.id;await refresh(false);await render();},true),
 button('Use header fields',async()=>{mappingDraft=await get('/api/default-mapping');editor.value=JSON.stringify(mappingDraft,null,2);}),
 ...(current?[button('Use repository metadata fields',async()=>{mappingDraft=await get('/api/metadata-mapping?'+new URLSearchParams({edition:current.id}));editor.value=JSON.stringify(mappingDraft,null,2);})]:[])));
 root.append(body);
 if(current){const data=await get('/api/records?'+new URLSearchParams({edition:current.id,limit:1}));if(data.items[0])body.append(button('Inspect an original record for mapping',async()=>showDetail(await object('observation',data.items[0].id))));}
 const list=panel('Saved native datasets',table(['Build','Rows','Snapshot','Actions'],state.builds.map(b=>[short(b.id),b.rowCount,b.datasetSnapshot,button('Query this dataset',async()=>{selectedBuild=b.id;await showQuery(b);})])),moreButton('builds'));root.append(list);
 if(selectedBuild)await showQuery(await object('build',selectedBuild));
}
async function showQuery(build){
 let host=$('query');if(!host){host=el('section',{id:'query'});$('content').append(host);}
 const parameters=el('input',{value:'limit=20'}),result=el('div');
 host.replaceChildren(el('h2',{},'Original dataset query · '+short(build.id)),field('Query parameters',parameters),button('Run query',run),result,button('Export this dataset',()=>go('Exports')));
 async function run(){const values=Object.fromEntries(new URLSearchParams(parameters.value));const data=await action('query',{buildId:build.id,query:values});result.replaceChildren(pre(data));}
 await run();
}
async function exportsView(root){
 const bsel=select(state.builds.map(b=>[b.id,short(b.id)+' · '+b.rowCount+' rows']),selectedBuild,v=>{selectedBuild=v;work(()=>render());});
 const source=panel('Portable publisher source',field('Native dataset',bsel),moreButton('builds'),paragraph('This package contains the reviewed native dataset, mapping, record lineage and every retained HTTP/XML page in the edition history. Session and authorization header values stay in the private workspace backup. Open source.json with the OAI publisher to prepare, review and publish the same dataset through the existing merchant tools.'));
 if(selectedBuild)source.append(el('a',{class:'button primary',href:'/download/source?'+new URLSearchParams({build:selectedBuild})},'Download complete source package'));
 root.append(source,panel('Complete workspace backup',paragraph('Save repositories, discovery, interrupted and complete harvests, record conflicts, reviewed editions and dataset builds. Restore the archive into a new private workspace and reopen this console.'),el('a',{class:'button',href:'/download/backup'},'Download full workspace'),pre('python cli.py --workspace /absolute/new-workspace restore --archive /absolute/oai-workspace.zip\npython cli.py --workspace /absolute/new-workspace serve')));
}
$('refresh').addEventListener('click',()=>work(()=>refresh()));
await work(()=>refresh());
setInterval(async()=>{if(!state?.running)return;try{const previous=state.running;await refresh(false);const tag=document.activeElement?.tagName;if(!['INPUT','TEXTAREA','SELECT'].includes(tag)&&['Harvests','Repositories'].includes(tab))await render();if(previous&&!state.running)notice('Harvest stopped at its saved state. The operation and retained responses are available.');}catch(e){notice(e.message);}},2500);
