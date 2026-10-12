// MIT. Industrial report operator; all state changes use the retained native workspace.
const $=selector=>document.querySelector(selector);
const root=$('#main'),navigation=$('#navigation'),notice=$('#notice'),activity=$('#activity');
const tabs=[['sources','Sources'],['capture','Captured queries'],['editions','Editions & review'],['compare','Comparison'],['merchant','Merchant'],['buyer','Buyer & receiving'],['operations','Operations']];
let state=null,busy=false,currentOperation=null;
const v={tab:'sources',sourceId:null,captureId:null,editionId:null,merchantId:null,buyerId:null,deliveryId:null,comparisonId:null,
  inventory:null,inventoryKind:'chart',inventoryPage:0,dashboardId:null,detail:null,captureOffset:0,queryOrdinal:0,data:null,query:{limit:'25'},
  comparison:null,changePage:0,offer:null,nativeStatus:null,delivery:null};
const auth=new URLSearchParams(location.hash.slice(1)).get('session');
if(auth)history.replaceState(null,'',location.pathname+location.search);
function h(tag,props={},...children){
  const node=document.createElement(tag);
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  for(const [key,value]of Object.entries(props)){
    if(value===undefined||value===null)continue;
    if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='class')node.className=value;
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(key in node&&!key.includes('-'))node[key]=value;
    else node.setAttribute(key,String(value));
  }
  return node;
}
const text=value=>value===null?'null':value===undefined?'missing':typeof value==='string'?value:JSON.stringify(value);
const short=value=>value?value.slice(0,12)+'…':'—';
const row=(...children)=>h('div',{class:'row'},children);
const tag=value=>h('span',{class:'tag'},value??'—');
const hash=value=>h('span',{class:'hash'},value??'—');
const empty=value=>h('p',{class:'empty'},value);
const details=(label,value)=>h('details',{class:'details'},h('summary',{},label),h('pre',{},JSON.stringify(value,null,2)));
const panel=(title,...children)=>h('section',{class:'panel'},title?h('h3',{},title):null,children);
function button(label,fn,{primary=false,disabled=false,cancel=false}={}){
  return h('button',{type:'button',class:primary?'primary':'',disabled:disabled||(busy&&!cancel),dataset:{cancel:cancel?'true':''},
    onClick:()=>Promise.resolve().then(fn).catch(error=>message(error.message,true))},label);
}
function field(name,label,{value='',type='text',required=false,placeholder='',help='',min,max,step,rows}={}){
  const input=type==='textarea'?h('textarea',{name,value,required,placeholder,rows:rows??3}):h('input',{name,type,value,required,placeholder,min,max,step});
  return h('label',{class:'control'},label,input,help?h('small',{},help):null);
}
function select(name,label,items,value,onChange){
  return h('label',{class:'control'},label,h('select',{name,value,onChange:event=>{
    if(onChange)Promise.resolve(onChange(event.target.value)).catch(error=>message(error.message,true));
  }},items.map(item=>h('option',{value:item.value},item.label))));
}
const check=(name,label,checked=false)=>h('label',{class:'check'},h('input',{type:'checkbox',name,checked}),label);
function form(title,fields,label,submit){
  const node=h('form',{onSubmit:event=>{event.preventDefault();Promise.resolve().then(()=>submit(new FormData(node),node)).catch(error=>message(error.message,true));}},
    fields,h('button',{type:'submit',class:'primary',disabled:busy},label));
  return panel(title,node);
}
function table(headers,rows,kind=''){
  if(!rows.length)return empty('No rows to display.');
  return h('div',{class:'table-scroll '+kind,tabIndex:0,role:'region','aria-label':headers.join(', ')+' table'},
    h('table',{},h('thead',{},h('tr',{},headers.map(x=>h('th',{},x)))),
      h('tbody',{},rows.map(cells=>h('tr',{},cells.map(cell=>h('td',{},cell)))))));
}
function metrics(items){return h('div',{class:'metrics'},items.map(([label,value])=>h('div',{class:'metric'},h('strong',{},value??'—'),h('span',{},label))));}
function heading(title,description,...actions){return h('div',{class:'pane-head'},h('div',{},h('h2',{},title),h('p',{class:'muted'},description)),actions.length?row(actions):null);}
function message(value,error=false){notice.className=error?'error':'';notice.textContent=value??'';}
function setBusy(value){busy=value;document.querySelectorAll('main button').forEach(node=>{if(node.dataset.cancel!=='true')node.disabled=value;});}
async function api(path,{method='GET',body}={}){
  const response=await fetch('api/'+path,{method,credentials:'same-origin',headers:{...(auth?{authorization:'Bearer '+auth}:{}),
    ...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.message??result.error??'The workspace request failed.'),{code:result.error,status:response.status});
  return result;
}
async function download(kind,id){
  const response=await fetch('api/export/'+kind+(id?'/'+encodeURIComponent(id):''),{credentials:'same-origin',headers:auth?{authorization:'Bearer '+auth}:{}});
  if(!response.ok){const result=await response.json();throw new Error(result.message??result.error);}
  const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=h('a',{href:url,download:response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'superset-export'});
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Exported '+(kind==='workspace'?'the complete retained workspace':kind)+' · '+response.headers.get('x-content-sha256'));
}
async function refresh({draw=true}={}){
  state=await api('state');
  const defaults=[['sourceId','sources'],['captureId','captures'],['editionId','editions'],['merchantId','merchants'],['buyerId','buyers'],['deliveryId','deliveries'],['comparisonId','comparisons']];
  for(const [key,kind]of defaults)if(!state[kind].some(x=>x.id===v[key]))v[key]=kind==='editions'?state.selectedEditionId??state[kind].at(-1)?.id??null:state[kind].at(-1)?.id??null;
  $('#identity').replaceChildren(h('strong',{},'Revision '+state.revision),h('span',{class:'mono'},state.workspaceId));
  if(draw)render();
  return state;
}
function renderActivity(operation){
  const last=operation.progress?.at(-1);
  activity.replaceChildren(h('div',{},h('strong',{},operation.status+' · '+operation.id),
    last?h('div',{class:'small muted'},last.label??last.phase??last.status??'Retaining native progress'):null),
    ['QUEUED','RUNNING'].includes(operation.status)?button('Cancel request',async()=>{await api('cancel/'+operation.id,{method:'POST',body:{}});},{cancel:true}):null);
}
async function waitOperation(operationId){
  let operation;
  while(true){
    operation=await api('operations/'+encodeURIComponent(operationId));renderActivity(operation);
    if(!['QUEUED','RUNNING'].includes(operation.status))break;
    await new Promise(done=>setTimeout(done,650));
  }
  return operation;
}
async function perform(action,input,{nextTab}={}){
  if(busy)throw new Error('The current workspace operation is still running.');
  const operationId=input.operationId??action+'-'+crypto.randomUUID(),body={...input,operationId,expectedRevision:input.expectedRevision??state.revision};
  setBusy(true);currentOperation=operationId;message('');
  try{
    sessionStorage.setItem('superset.pending',JSON.stringify({action,input:body}));
    await api('operations/'+action,{method:'POST',body});
    const operation=await waitOperation(operationId);
    sessionStorage.removeItem('superset.pending');
    await refresh({draw:false});
    if(operation.status!=='COMPLETED')throw new Error((operation.error?.code??operation.status)+': '+(operation.error?.message??'The original operation ended.'));
    const record=operation.result?.record,kind=operation.result?.kind;
    if(record){
      const keys={sources:'sourceId',captures:'captureId',editions:'editionId',comparisons:'comparisonId',merchants:'merchantId',buyers:'buyerId',deliveries:'deliveryId'};
      if(keys[kind])v[keys[kind]]=record.id;
    }
    if(nextTab)v.tab=nextTab;
    if(kind==='captures'){v.queryOrdinal=0;v.captureOffset=0;v.detail=await readCapture();}
    if(kind==='editions'){v.data=null;v.query={limit:'25'};}
    if(kind==='comparisons'){v.comparison=null;v.changePage=0;}
    if(kind==='merchants'){v.nativeStatus=null;v.offer=null;}
    message('Saved '+action+' · revision '+state.revision);
    return operation;
  }finally{busy=false;currentOperation=null;render();}
}
async function readCapture(){return v.captureId?api('capture/'+encodeURIComponent(v.captureId)+'?'+new URLSearchParams({queryOrdinal:v.queryOrdinal,offset:v.captureOffset,limit:25})):null;}
async function readInventory(){
  if(!v.sourceId)throw new Error('Register an original Superset source first.');
  v.inventory=await api('inventory',{method:'POST',body:{sourceId:v.sourceId,kind:v.inventoryKind,page:v.inventoryPage,pageSize:25,...(v.dashboardId?{dashboardId:v.dashboardId}:{})}});render();
}
async function readEdition(query=v.query){
  if(!v.editionId)throw new Error('Create a retained edition first.');
  const result=await api('query',{method:'POST',body:{editionId:v.editionId,query}});
  if(result.status!==200)throw new Error(result.body?.message??result.body?.error??'The original dataset rejected this query.');
  v.query=query;v.data=result.body;render();
}
function sourcePicker(onChange=async value=>{v.sourceId=value;v.inventory=null;render();}){
  return select('source','Original source',state.sources.map(x=>({value:x.id,label:x.label})),v.sourceId,onChange);
}
function editionPicker(name='edition',label='Retained edition',value=v.editionId,onChange=async selected=>{v.editionId=selected;v.data=null;render();}){
  return select(name,label,state.editions.map(x=>({value:x.id,label:x.label+' · '+x.rows+' rows · '+short(x.snapshot)})),value,onChange);
}
function renderSources(){
  const registration=form('Register native connection',[
    field('label','Source name',{required:true,placeholder:'Operations reporting'}),
    field('baseUrl','Superset base URL',{type:'url',required:true,placeholder:'https://reports.example.org/'}),
    select('authMode','Native authentication',[{value:'bearer',label:'Bearer access token'},{value:'login',label:'Native database or LDAP login'},{value:'session',label:'Existing native session cookies'}],'bearer'),
    field('tokenEnv','Bearer token environment variable',{value:'SUPERSET_ACCESS_TOKEN'}),
    field('usernameEnv','Username environment variable',{value:'SUPERSET_USERNAME'}),
    field('passwordEnv','Password environment variable',{value:'SUPERSET_PASSWORD'}),
    select('provider','Login provider',[{value:'db',label:'Superset database'},{value:'ldap',label:'Native LDAP'}],'db'),
    field('cookieEnv','Cookie environment variable',{value:'SUPERSET_COOKIE'}),
    check('allowHttp','Use this configured remote HTTP deployment'),
    h('p',{class:'small muted'},'Use the existing native account. Enter environment variable names; its secret values stay on this host.')
  ],'Register source',async f=>{
    const mode=f.get('authMode'),auth={mode,...(mode==='bearer'?{tokenEnv:f.get('tokenEnv')}:mode==='login'?{usernameEnv:f.get('usernameEnv'),passwordEnv:f.get('passwordEnv'),provider:f.get('provider')}:{cookieEnv:f.get('cookieEnv')})};
    await perform('source',{label:f.get('label'),options:{baseUrl:f.get('baseUrl'),auth,allowHttp:f.has('allowHttp')}});
  });
  const list=state.sources.length?panel('Native chart and dashboard inventory',sourcePicker(),
    row(select('kind','Inventory',[{value:'chart',label:'Saved charts'},{value:'dashboard',label:'Dashboards'}],v.inventoryKind,async value=>{
      v.inventoryKind=value;v.inventoryPage=0;v.dashboardId=null;v.inventory=null;await readInventory();
    }),button('Load native inventory',readInventory,{primary:true})),
    v.dashboardId?h('p',{},'Charts in dashboard '+v.dashboardId,' ',button('All charts',async()=>{v.dashboardId=null;v.inventoryKind='chart';await readInventory();})):null,
    v.inventory?table(['Native ID','Name','Type / data source','Action'],v.inventory.items.map(item=>[
      item.id,item.slice_name??item.dashboard_title??item.name??'Untitled',item.viz_type??item.datasource_name_text??'Dashboard',
      v.inventoryKind==='dashboard'&&!v.dashboardId?button('Show charts',async()=>{v.dashboardId=item.id;await readInventory();}):
        button('Capture saved query',()=>perform('capture',{sourceId:v.sourceId,chartId:item.id,label:item.slice_name??'Chart '+item.id,force:false},{nextTab:'capture'}))
    ])):empty('Read the source’s authenticated inventory, then select a saved chart.'),
    v.inventory&&!v.dashboardId?h('div',{class:'pager'},
      button('Previous page',async()=>{v.inventoryPage--;await readInventory();},{disabled:v.inventoryPage===0}),
      h('span',{},'Page '+(v.inventoryPage+1)+' · '+v.inventory.count+' native records'),
      button('Next page',async()=>{v.inventoryPage++;await readInventory();},{disabled:(v.inventoryPage+1)*25>=v.inventory.count})):null):panel('Native source',empty('Register a source to open its chart inventory.'));
  const direct=state.sources.length?form('Capture a known saved chart',[
    field('chartId','Native chart ID',{type:'number',min:1,required:true}),
    field('label','Capture label',{placeholder:'October operating report',required:true}),
    check('force','Ask Superset to refresh the native query cache')
  ],'Capture original result',f=>perform('capture',{sourceId:v.sourceId,chartId:Number(f.get('chartId')),label:f.get('label'),force:f.has('force')},{nextTab:'capture'})):null;
  return [heading('Native sources','Read the saved chart definition and every original result query under the configured account.'),
    h('div',{class:'grid'},registration,h('div',{class:'stack'},list,direct,
      state.connectionRequirements.length?panel('Required host variables',h('p',{class:'mono break'},state.connectionRequirements.join(', '))):null))];
}
function renderCapture(){
  if(!state.captures.length)return[heading('Captured queries','Saved native definitions and exact response bytes.'),empty('Capture an original saved chart in Sources.')];
  const capture=state.captures.find(x=>x.id===v.captureId),d=v.detail?.capture.id===v.captureId?v.detail:null;
  const selection=select('capture','Retained capture',state.captures.map(x=>({value:x.id,label:x.label+' · '+x.capturedAt})),v.captureId,async value=>{
    v.captureId=value;v.queryOrdinal=0;v.captureOffset=0;v.detail=await readCapture();render();
  });
  if(!d)return[heading('Captured queries','The source’s query list, saved limits and original cell values.'),panel(null,selection,
    button('Open captured query',async()=>{v.detail=await readCapture();render();},{primary:true}))];
  const q=d.queries[v.queryOrdinal],columns=q.columns;
  const picks=h('div',{class:'column-picks'},h('table',{},h('thead',{},h('tr',{},['Publish','Native field','Native type','Row key'].map(x=>h('th',{},x)))),
    h('tbody',{},columns.map((column,index)=>h('tr',{},h('td',{},h('input',{type:'checkbox',name:'columns',value:column.name,checked:index<Math.min(8,columns.length),'aria-label':'Publish '+column.name})),
      h('td',{},column.name),h('td',{},column.nativeType),
      h('td',{},h('input',{type:'checkbox',name:'key',value:column.name,'aria-label':'Row key '+column.name})))))));
  const editionForm=form('Create reviewed field selection',[
    field('name','Edition name',{value:capture.label,required:true}),picks,
    h('p',{class:'small muted'},'Select at most 32 source fields. Every field retains value, null and missing states. Choose an explicit unique row key to compare editions by identity.'),
    h('div',{class:'fields'},field('defaultLimit','Default page size',{value:'25',type:'number',min:1,max:250}),field('maxLimit','Maximum page size',{value:'250',type:'number',min:1,max:1000}))
  ],'Create immutable edition',f=>perform('edition',{captureId:v.captureId,selection:{name:f.get('name'),queryOrdinal:v.queryOrdinal,
    columns:f.getAll('columns'),key:f.getAll('key'),defaultLimit:Number(f.get('defaultLimit')),maxLimit:Number(f.get('maxLimit'))}},{nextTab:'editions'}));
  const preview=table(columns.map(c=>c.name),d.rows.map(cells=>cells.map(cell=>h('span',{},h('span',{class:'value'},cell.state==='value'?cell.value:'—'),h('span',{class:'presence'},cell.state)))),'data');
  return[heading('Captured queries','Select the exact query ordinal and native fields that will form the data product.',button('Export capture manifest',()=>download('capture',v.captureId))),
    panel(null,selection,select('ordinal','Native result query',d.queries.map(x=>({value:String(x.ordinal),label:'Query '+x.ordinal+' · '+x.status+' · '+(x.rows??'unknown')+' rows'})),String(v.queryOrdinal),async value=>{
      v.queryOrdinal=Number(value);v.captureOffset=0;v.detail=await readCapture();render();
    }),metrics([['Captured rows',q.rows],['Native rowcount',q.nativeRowCount],['Saved row limit',q.rowLimit===0?'Disabled':q.rowLimit??'Default'],['Saved offset',q.rowOffset]]),
      h('p',{class:'small muted'},'Native account '+d.principal.username+' · chart '+d.metadata.id+' · '+(q.cached?'cached result':'queried result')),
      details('Saved query, filters and resolved time range',{chart:{id:d.metadata.id,uuid:d.metadata.uuid,datasourceId:d.metadata.datasource_id,datasourceUuid:d.metadata.datasource_uuid},
        query:q,originalSavedQueryContext:d.metadata.query_context,originalParams:d.metadata.params,captureSha256:capture.sha256})),
    h('div',{class:'grid'},q.status==='success'?editionForm:panel('Original query outcome',h('p',{},q.error??q.status)),
      panel('Exact original cell preview',h('p',{class:'small muted'},'JSON spelling is preserved here, including exact numeric tokens. The complete capture is retained.'),preview,
        h('div',{class:'pager'},button('Previous rows',async()=>{v.captureOffset=Math.max(0,v.captureOffset-25);v.detail=await readCapture();render();},{disabled:v.captureOffset===0}),
          h('span',{},(d.rows.length?v.captureOffset+1:0)+'–'+(v.captureOffset+d.rows.length)+' of '+(d.total??0)),
          button('Next rows',async()=>{v.captureOffset+=25;v.detail=await readCapture();render();},{disabled:v.captureOffset+d.rows.length>=(d.total??0)}))))];
}
function renderEditions(){
  if(!state.editions.length)return[heading('Edition review','Inspect the original projected dataset and record its distribution basis.'),empty('Select native fields from a retained capture to create an edition.')];
  const edition=state.editions.find(x=>x.id===v.editionId),reviews=state.reviews.filter(x=>x.editionId===edition.id),latest=reviews.at(-1),data=v.data?.dataset?.snapshot===edition.snapshot?v.data:null;
  const queryForm=form('Native dataset query',[
    field('query','Original query parameters',{type:'textarea',value:JSON.stringify(Object.fromEntries(Object.entries(v.query).filter(([k])=>k!=='cursor')),null,2),
      help:'String values use the original fields, where_FIELD, sort and limit parameters. Pagination retains the same selection.'})
  ],'Run original query',f=>readEdition(JSON.parse(f.get('query'))));
  const review=form('Record edition review',[
    h('p',{},'Selected snapshot ',hash(edition.snapshot)),
    field('actor','Reviewer name',{required:true}),
    field('basis','Distribution basis',{type:'textarea',required:true,placeholder:'Identify the source owner, permitted audience and fields approved for this data product.'}),
    field('note','Review note',{type:'textarea',required:true}),
    select('decision','Decision',[{value:'approved',label:'Approve this exact edition'},{value:'rejected',label:'Return this edition for changes'}],'approved')
  ],'Save named review',f=>perform('review',{editionId:edition.id,editionSha256:edition.sha256,actor:f.get('actor'),decision:f.get('decision'),note:f.get('note'),distributionBasis:f.get('basis')}));
  const preview=data?panel('Original typed dataset page',
    metrics([['Matching rows',data.page.total],['Returned rows',data.page.returned],['Selected fields',data.fields.length]]),
    table(data.fields,data.rows.map(r=>data.fields.map((name,index)=>h('span',{class:'value'},text(Array.isArray(r)?r[index]:r[name])))),'data'),
    h('div',{class:'pager'},button('First page',()=>readEdition(Object.fromEntries(Object.entries(v.query).filter(([k])=>k!=='cursor')))),
      h('span',{},data.page.nextCursor?'More original rows available':'Final page'),
      button('Next page',()=>readEdition({...v.query,cursor:data.page.nextCursor}),{disabled:!data.page.nextCursor})),
    details('Native schema, selected meaning and query result scope',{dataset:data.dataset,semantics:data.semantics,filters:data.filters,order:data.order})):panel('Native dataset',button('Open original dataset page',()=>readEdition({limit:'25'}),{primary:true}));
  return[heading('Editions & review','The native snapshot binds exact rows, field types and retained source meaning.',
      button('Export CSV',()=>download('csv',edition.id)),button('Export lineage',()=>download('lineage',edition.id))),
    panel(null,editionPicker(),row(tag(latest?.decision??'Awaiting review'),h('span',{},edition.rows+' rows'),hash(edition.snapshot)),
      h('div',{class:'row'},button('Select current edition',()=>perform('select',{editionId:edition.id})),button('Replay original source',()=>perform('replay',{editionId:edition.id}))),
      latest?details('Latest named review',latest):null),
    h('div',{class:'grid'},h('div',{class:'stack'},queryForm,review),h('div',{class:'stack'},preview,
      reviews.length?panel('Review history',table(['Reviewer','Decision','Recorded','Note'],reviews.map(r=>[r.actor,r.decision,r.createdAt,r.note]))):null))];
}

async function openComparison(id=v.comparisonId){v.comparisonId=id;v.comparison=await api('records/comparisons/'+encodeURIComponent(id));v.changePage=0;render();}
function renderCompare(){
  if(state.editions.length<2)return[heading('Edition comparison','Compare the same query and reviewed field selection across native captures.'),empty('Create a second captured edition with the same query, fields and row key.')];
  const setup=form('Compare retained editions',[
    editionPicker('before','Before edition',state.editions[0].id,null),
    editionPicker('after','After edition',state.editions.at(-1).id,null)
  ],'Compare exact rows',async f=>{await perform('compare',{beforeId:f.get('before'),afterId:f.get('after')});await openComparison();});
  const comparison=v.comparison?.id===v.comparisonId?v.comparison:null;
  const stored=state.comparisons.length?select('comparison','Retained comparison',state.comparisons.map(x=>({value:x.id,label:x.beforeId+' → '+x.afterId})),v.comparisonId,openComparison):null;
  let content;
  if(comparison){
    const c=comparison.comparison,changes=c.changes.slice(v.changePage*30,v.changePage*30+30);
    const cells=(values,fields)=>values?h('div',{},values.map((cell,index)=>h('div',{class:'value'},fields[index]+': '+(cell.state==='value'?cell.text:'—'),
      h('span',{class:'presence'},cell.state)))):'—';
    content=panel('Retained comparison',stored,
      metrics([['Unchanged',c.unchanged],['Changed',c.changed],['Added',c.added],['Removed',c.removed]]),
      h('p',{class:'small muted'},'Matching uses '+(c.keyMode==='selected-native-key'?'the reviewed native row key: '+c.key.join(', '):'the native result order. Row positions are compared because no explicit key was selected.')),
      table(['Native row key','Change','Fields','Before','After'],changes.map(item=>[
        h('span',{class:'mono'},item.key),h('span',{class:'nowrap'},item.change),item.fields.join(', '),cells(item.before,item.fields),cells(item.after,item.fields)
      ]),'changes'),
      h('div',{class:'pager'},button('Previous changes',()=>{v.changePage--;render();},{disabled:v.changePage===0}),
        h('span',{},(changes.length?v.changePage*30+1:0)+'–'+(v.changePage*30+changes.length)+' of '+c.changes.length),
        button('Next changes',()=>{v.changePage++;render();},{disabled:(v.changePage+1)*30>=c.changes.length})),
      row(button('Export full comparison',()=>download('comparison',comparison.id))),
      details('Both retained edition identities',{beforeId:comparison.beforeId,beforeSha256:comparison.beforeSha256,afterId:comparison.afterId,afterSha256:comparison.afterSha256}));
  }else content=panel('Retained comparison',stored,state.comparisons.length?button('Open comparison',()=>openComparison(),{primary:true}):empty('Create a comparison to see exact source changes.'));
  return[heading('Compare editions','Inspect changed values and presence states before publishing the next native snapshot.'),h('div',{class:'grid'},setup,content)];
}
function merchantPicker(){
  return select('merchant','Prepared merchant edition',state.merchants.map(x=>({value:x.id,label:x.label+' · '+short(x.snapshot)})),v.merchantId,async value=>{
    v.merchantId=value;v.offer=null;v.nativeStatus=null;render();
  });
}
async function nativeStatus(){v.nativeStatus=await api('merchant/status',{method:'POST',body:{merchantId:v.merchantId}});render();}
function renderMerchant(){
  if(!state.editions.length)return[heading('Merchant publication','Use the original versioned dataset seller and retained release engine.'),empty('Create and approve a report edition first.')];
  const setup=form('Prepare an original merchant package',[
    editionPicker('edition','Reviewed report edition',v.editionId,null),
    select('target','Version store',[{value:'',label:'New merchant version store'},...state.merchants.map(x=>({value:x.id,label:'Continue '+x.label+' · '+x.versionGroup}))],''),
    field('label','Merchant label',{required:true,placeholder:'Operating report'}),
    field('publicOrigin','Public HTTPS origin',{required:true,type:'url',placeholder:'https://reports.example.org'}),
    field('path','Fixed report route',{required:true,value:'/report-data'}),
    h('h3',{},'Public payment terms'),
    h('div',{class:'fields'},field('scheme','Scheme',{required:true,value:'exact'}),
      field('network','Network',{required:true,placeholder:'Original supported network'}),
      field('asset','Asset identifier',{required:true,placeholder:'Original asset or token contract'}),
      field('amount','Atomic amount per page',{required:true,placeholder:'Integer in the asset’s smallest unit'}),
      field('payTo','Recipient',{required:true}),
      field('timeout','Maximum timeout seconds',{required:true,type:'number',min:1,value:'60'})),
    h('p',{class:'small muted'},'Use the approved deployment terms. Continuing a version store keeps its original route, terms and query contract.')
  ],'Prepare reviewed merchant',f=>perform('prepare-merchant',{editionId:f.get('edition'),...(f.get('target')?{targetMerchantId:f.get('target')}:{ }),
    label:f.get('label'),publicOrigin:f.get('publicOrigin'),path:f.get('path'),payment:{scheme:f.get('scheme'),network:f.get('network'),asset:f.get('asset'),amount:f.get('amount'),payTo:f.get('payTo'),maxTimeoutSeconds:Number(f.get('timeout'))}},{nextTab:'merchant'}));
  const selected=state.merchants.find(x=>x.id===v.merchantId),run=selected?state.merchantRuns.find(x=>x.versionGroup===selected.versionGroup):null;
  const status=v.nativeStatus?.snapshot===selected?.snapshot?v.nativeStatus:null,native=status?.native;
  const operating=selected?panel('Original versioned service',merchantPicker(),
    h('p',{},'Public resource ',h('span',{class:'mono break'},selected.resource)),
    h('p',{},'Prepared snapshot ',hash(selected.snapshot)),
    run?h('p',{},tag(run.mode),h('span',{class:'mono'},' '+run.url)):h('p',{class:'muted'},'Service is stopped.'),
    row(button(run?'Open existing service':'Start original service',async()=>{
      await api('merchant/start',{method:'POST',body:{merchantId:v.merchantId}});await refresh({draw:false});await nativeStatus();
    },{primary:true}),button('Read native version state',nativeStatus),
      button('Stop service',async()=>{await api('merchant/stop',{method:'POST',body:{merchantId:v.merchantId}});v.nativeStatus=null;await refresh();},{disabled:!run})),
    native?panel(null,h('h3',{},'Native version selection'),
      h('p',{},'Current snapshot ',hash(native.current)),h('p',{},'Native revision '+native.revision),
      button('Publish this prepared edition',async()=>{
        await perform('publish',{merchantId:selected.id,expectedSnapshot:native.current,expectedNativeRevision:native.revision});await nativeStatus();
      },{primary:true,disabled:!run||native.current===selected.snapshot}),
      details('Original version store state',native)):null,
    details('Prepared source and review identity',selected),
    button('Continue to buyer review',async()=>{v.tab='buyer';render();})):panel('Original merchant',empty('Prepare an approved edition to configure its native service.'));
  const history=state.publications.length?panel('Retained publications',table(['Edition','Snapshot','Recorded','Original outcome'],state.publications.map(x=>[x.editionId,hash(x.snapshot),x.createdAt,details('Native result',x.native)]))):null;
  return[heading('Merchant','Publish the reviewed report through the existing seller, snapshot selection and recovery engine.'),h('div',{class:'grid equal'},setup,h('div',{class:'stack'},operating,history))];
}
async function buyerReview(query={}){
  v.offer=await api('buyer/review',{method:'POST',body:{merchantId:v.merchantId,query}});v.buyerQuery=query;render();
}
function renderBuyer(){
  const merchant=state.merchants.find(x=>x.id===v.merchantId);
  const run=merchant?state.merchantRuns.find(x=>x.versionGroup===merchant.versionGroup):null;
  const buyer=state.buyers.find(x=>x.id===v.buyerId),delivery=state.deliveries.find(x=>x.id===v.deliveryId);
  let review;
  if(merchant){
    const offer=v.offer?.snapshot===merchant.snapshot?v.offer:null;
    review=panel('Review the original advertised offer',merchantPicker(),
      h('p',{class:'small muted'},'The original buyer receives one selected snapshot and retains its per-page budget, approval and recovery state.'),
      form(null,[field('query','First-page query parameters',{type:'textarea',value:JSON.stringify(v.buyerQuery??{limit:'25'},null,2)})],
        'Load native offer',f=>buyerReview(JSON.parse(f.get('query')))),
      !run?h('p',{class:'small muted'},'Start the original service in Merchant before loading its offer.'):null,
      offer?[
        h('p',{},'Seller mode ',tag(offer.mode)),h('p',{},'Snapshot ',hash(offer.snapshot)),
        h('p',{class:'small'},'Offer SHA256 ',hash(offer.offerSha256)),
        table(['Alternative','Network','Asset','Atomic amount','Recipient'],offer.accepts.map((t,i)=>[i,t.network,t.asset,t.amount,t.payTo])),
        form(null,[field('intentId','Buyer intent ID',{required:true,value:'superset-'+crypto.randomUUID()}),
          select('acceptIndex','Reviewed payment alternative',offer.accepts.map((x,i)=>({value:String(i),label:i+' · '+x.amount+' atomic · '+x.network})),'0')],
          'Prepare original buyer configuration',f=>perform('prepare-buyer',{merchantId:merchant.id,query:v.buyerQuery??{},intentId:f.get('intentId'),
            acceptIndex:Number(f.get('acceptIndex')),offerSha256:offer.offerSha256},{nextTab:'buyer'}))
      ]:null);
  }else review=panel('Original buyer',empty('Prepare and start a reviewed merchant edition first.'));
  const prepared=buyer?panel('Complete the retained acquisition',
    select('buyer','Prepared buyer',state.buyers.map(x=>({value:x.id,label:x.id+' · '+short(x.snapshot)})),v.buyerId,value=>{v.buyerId=value;render();}),
    h('p',{class:'small muted'},'Set the intended total atomic budget in the first command, then use the original terminal approval flow. The browser can stay open while this buyer runs.'),
    ...Object.entries(buyer.commands).map(([name,command])=>h('div',{},h('p',{class:'small'},name),h('pre',{class:'command'},command))),
    button('Read original acquisition status',async()=>{const result=await api('buyer/status',{method:'POST',body:{buyerId:buyer.id}});v.buyerStatus={buyerId:buyer.id,result};render();}),
    v.buyerStatus?.buyerId===buyer.id?details('Original acquisition status',v.buyerStatus.result):null,
    form(null,[check('source','Include original query captures in this customer delivery')],
      'Receive completed customer output',f=>perform('receive-buyer',{buyerId:buyer.id,includeSourceCaptures:f.has('source')},{nextTab:'buyer'}))):null;
  const received=delivery?panel('Delivered customer output',
    select('delivery','Retained delivery',state.deliveries.map(x=>({value:x.id,label:x.id+' · '+x.rows+' rows'})),v.deliveryId,value=>{v.deliveryId=value;v.delivery=null;render();}),
    metrics([['Delivered rows',delivery.rows],['Original pages',delivery.pages]]),
    h('p',{},'Selected snapshot ',hash(delivery.snapshot)),
    row(button('Verify and reopen delivery',async()=>{v.delivery=await api('delivery/inspect',{method:'POST',body:{deliveryId:delivery.id}});render();},{primary:true}),
      button('Download complete workspace',()=>download('workspace'))),
    v.delivery?details('Original delivered outputs and retained identities',v.delivery):null,
    h('p',{class:'small muted'},'The complete workspace carries the original source, reviews, comparisons and all retained delivery members into the receiving command.')):null;
  return[heading('Buyer & receiving','Review the actual original offer, complete the native acquisition, and retain its full delivered data room.'),
    h('div',{class:'grid equal'},review,h('div',{class:'stack'},prepared,received))];
}
async function inspectOperation(id){v.operation=await api('operations/'+encodeURIComponent(id));render();}
function renderOperations(){
  const operation=v.operation;
  const history=panel('Original operation history',h('p',{class:'small muted'},'Showing the latest '+state.operations.length+' of '+state.operationCount+' operations. Every original request and retained source read is included in a complete workspace export.'),
    table(['Operation','Status','Updated','Action'],state.operations.map(x=>[x.id,tag(x.status),x.updated_at,button('Open request',()=>inspectOperation(x.id))])),
    field('lookup','Original operation ID',{value:''}),
    button('Look up retained operation',()=>inspectOperation($('input[name=lookup]').value)));
  let selected;
  if(operation){
    const canRetry=['FAILED','INTERRUPTED','CANCELLED'].includes(operation.status);
    selected=panel('Retained operation '+operation.id,tag(operation.status),
      operation.error?h('p',{class:'break'},operation.error.code+': '+operation.error.message):null,
      details('Original reviewed request',operation.request),details('Retained native progress',operation.progress),details('Original result',operation.result),
      canRetry?row(button('Retry identical original attempt',()=>perform(operation.request.action,{...operation.request.input,retry:true}),{
        primary:true,disabled:operation.request.input.expectedRevision!==state.revision}),
        button('Review again at current revision',()=>perform(operation.request.action,{...operation.request.input,operationId:operation.request.action+'-'+crypto.randomUUID(),expectedRevision:state.revision}))):null,
      ['QUEUED','RUNNING'].includes(operation.status)?button('Follow original operation',async()=>{setBusy(true);try{v.operation=await waitOperation(operation.id);await refresh();}finally{busy=false;render();}}):null);
  }
  const receiving=panel('Complete workspace transfer',h('p',{},'Export the complete retained database. The receiving command checks original response bytes, rebuilds every edition through the dataset engine, restores buyer configurations and verifies completed delivery members.'),
    button('Download complete workspace',()=>download('workspace'),{primary:true}),
    h('pre',{class:'command'},'chmod 600 /path/to/superset-export.sqlite3\nstarforge-merchant superset receive --file /path/to/superset-export.sqlite3 --directory /private/new-report-workspace\nstarforge-merchant superset-workspace --directory /private/new-report-workspace'),
    h('p',{class:'small muted'},'Replaying retained captures and reading delivered output work offline. Set the named host environment variables when you want another live Superset capture.'));
  return[heading('Operations & transfer','Stable operation IDs keep uncertain responses and source progress attached to their original work.'),h('div',{class:'grid equal'},h('div',{class:'stack'},history,receiving),selected??panel('Retained request',empty('Select an original operation to inspect, follow or retry it.')))];
}
function render(){
  if(!state)return;
  navigation.replaceChildren(tabs.map(([id,label])=>h('button',{type:'button','aria-current':v.tab===id?'page':null,
    onClick:async()=>{v.tab=id;message('');render();}},label)));
  const renderers={sources:renderSources,capture:renderCapture,editions:renderEditions,compare:renderCompare,merchant:renderMerchant,buyer:renderBuyer,operations:renderOperations};
  root.replaceChildren(...renderers[v.tab]());
}
$('#refresh').addEventListener('click',()=>refresh().catch(error=>message(error.message,true)));
async function initialize(){
  await refresh();
  let pending;try{pending=JSON.parse(sessionStorage.getItem('superset.pending')??'null');}catch{}
  const active=state.operations.find(x=>['QUEUED','RUNNING'].includes(x.status));
  if(active){
    setBusy(true);
    try{const operation=await waitOperation(active.id);if(pending?.input.operationId===active.id)sessionStorage.removeItem('superset.pending');await refresh({draw:false});
      message('Reconnected to '+operation.id+' · '+operation.status);}
    finally{busy=false;render();}
  }else if(pending){
    activity.replaceChildren(h('span',{},'A previous browser request has retained operation ID '+pending.input.operationId),
      button('Read original outcome',async()=>{const operation=await api('operations/'+encodeURIComponent(pending.input.operationId));v.tab='operations';v.operation=operation;sessionStorage.removeItem('superset.pending');render();}));
  }
}
initialize().catch(error=>{message(error.message,true);root.replaceChildren(empty('Open the current workspace URL, then use Refresh workspace to reconnect.'));});
