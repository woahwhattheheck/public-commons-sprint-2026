'use strict';

const labels={source_assets:'Source assets',target_assets:'Target assets',locations:'Locations',requests:'Service requests',work_orders:'Work orders',returns:'Returned updates',roundtrips:'Original round-trip events'};
const tabs={overview:'Overview',publicRefresh:'Public refresh',maximo:'Maximo target',inputs:'Inputs & mapping',records:'Assets & records',review:'Review & repair',workflow:'Work orders',handoff:'Contract & handoff',history:'History'};
let session=null,project=null,tab='overview',recordKind='source_assets',mappingKind='source_assets',query='',page=0,busy=false,pending=null,loadSerial=0,mapSerial=0;
const $=selector=>document.querySelector(selector);
function el(tag,attributes={},...children){const element=document.createElement(tag);for(const [key,value]of Object.entries(attributes)){if(key==='class')element.className=value;else if(key.startsWith('on'))element.addEventListener(key.slice(2),value);else if(value!==false&&value!==null&&value!==undefined)element.setAttribute(key,value===true?'':String(value));}for(const child of children.flat()){if(child===null||child===undefined)continue;element.append(child instanceof Node?child:document.createTextNode(String(child)));}return element;}
const pretty=value=>JSON.stringify(value,null,2);
const human=value=>String(value??'').replaceAll('_',' ');
const short=value=>String(value??'').length>70?String(value).slice(0,67)+'…':String(value??'');
const when=value=>new Date(value*1000).toLocaleString();
const option=(value,text,selected=false)=>el('option',{value,selected},text);
const button=(text,action,attributes={})=>el('button',{type:'button',onclick:action,...attributes},text);
function mutation(text,action,unavailable=false){return button(text,action,{'data-mutation':'','data-unavailable':String(unavailable),disabled:busy||Boolean(pending)||unavailable});}
function notice(message,error=false){const box=$('#notice');box.hidden=false;box.className=error?'error':'';box.replaceChildren(el('span',{},message));if(pending)box.append(el('div',{class:'toolbar'},button('Retry saved action',()=>execute(pending)),button('Refresh and inspect',async()=>{pending=null;setBusy(false);if(project)await loadProject(project.id);notice('Current project loaded. Review its history before making another change.');})));}
function setBusy(value){busy=value;document.querySelectorAll('[data-mutation]').forEach(node=>node.disabled=value||Boolean(pending)||node.dataset.unavailable==='true');}
async function request(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body instanceof Blob?{}:{'Content-Type':'application/json'}),'X-Workspace-CSRF':session?.csrf??'',...options.headers}});const value=await response.json();if(!response.ok){const error=new Error(value.error||'The operation did not complete');error.status=response.status;throw error;}return value;}
async function execute(operation){setBusy(true);pending=null;try{const result=await request(operation.path,operation.options);if(operation.created)await loadProject(result.id);else if(project)await loadProject(project.id);await loadProjects();const detail=result.result?.status==='needs_repair'?result.result.message:operation.success;notice(detail||'Saved.',result.result?.status==='needs_repair');return result;}catch(error){if(!error.status){pending=operation;notice('The connection ended before a result was received. Retry this saved operation to recover its original result.',true);}else{notice(error.message+(error.status===409?' Your form is retained; refresh the project before resubmitting.':''),true);if(error.status===401)showLogin();}return null;}finally{setBusy(false);}}
async function action(name,payload={},success='Saved.'){if(busy||pending)return;return execute({path:`/api/projects/${project.id}/action`,options:{method:'POST',body:JSON.stringify({action:name,payload,revision:project.revision,operation:crypto.randomUUID()})},success});}
async function loadProjects(){const data=await request('/api/projects');$('#projects').replaceChildren(...data.projects.map(item=>button(item.title,()=>loadProject(item.id),{'aria-current':project?.id===item.id?'true':'false'})));}
async function loadProject(id){const serial=++loadSerial;const data=await request(`/api/projects/${id}`);if(serial!==loadSerial)return;project={...data,...data.project};render();await loadProjects();}
async function safely(work){try{return await work();}catch(error){notice(error.message,true);if(error.status===401)showLogin();}}
function showLogin(){refreshViewSerial++;clearTimeout(refreshTimer);session=null;$('#shell').hidden=true;$('#login').hidden=false;$('#session-tools').replaceChildren();}
function showShell(){ $('#login').hidden=true;$('#shell').hidden=false;$('#session-tools').replaceChildren(el('span',{},session.actor),el('a',{href:'/api/backup'},'Workspace backup'),button('Sign out',async()=>{await request('/api/logout',{method:'POST',body:'{}'});showLogin();}));}
function field(text,node,help=''){node.setAttribute('aria-label',text);return el('label',{},text,node,help?el('span',{class:'muted small'},help):null);}
function table(headers,rows){return el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},headers.map(text=>el('th',{scope:'col'},text)))),el('tbody',{},rows.length?rows.map(cells=>el('tr',{},cells.map(cell=>el('td',{},cell)))):el('tr',{},el('td',{colspan:headers.length,class:'empty'},'No records in this view.')))));}
function panel(title,...children){return el('section',{class:'panel'},el('h2',{},title),...children);}
function jsonDetails(title,value){return el('details',{},el('summary',{},title),el('pre',{},pretty(value)));}
function switchTab(next){tab=next;render();}
function render(){mapSerial++;refreshViewSerial++;clearTimeout(refreshTimer);if(!project)return;const main=$('#main');main.replaceChildren(el('div',{class:'project-header'},el('div',{},el('h1',{},project.title),el('div',{class:'toolbar'},el('span',{class:'badge'},({development:'Development records','public-reference':'Public reference records','vendor-authorized':'Vendor-authorized records'})[project.mode]||project.mode),el('span',{class:'muted small'},`Revision ${project.revision}`))),el('div',{class:'toolbar'},button('Refresh project',()=>safely(()=>loadProject(project.id))),el('a',{href:`/api/projects/${project.id}/export`},'Download current handoff'),el('a',{href:`/api/projects/${project.id}/report`},'Complete report'))),el('nav',{class:'tabs','aria-label':'Project sections'},Object.entries(tabs).map(([key,label])=>button(label,()=>switchTab(key),{role:'tab','aria-selected':tab===key}))),el('div',{id:'content'}));({overview,publicRefresh,maximo,inputs,records,review,workflow,handoff,history})[tab]();setBusy(busy);}

let refreshViewSerial=0,refreshTimer=null,refreshSending=false;
const refreshKeyPrefix='municipal-public-refresh:';
function retainedRefreshRequests(projectId){
  const rows=[];
  for(let index=0;index<localStorage.length;index++){
    const key=localStorage.key(index);if(!key.startsWith(refreshKeyPrefix))continue;
    let row;try{row=JSON.parse(localStorage.getItem(key));}catch{continue;}
    if(row.origin===location.origin&&row.actor===session.actor&&row.projectId===projectId)rows.push(row);
  }
  return rows;
}
async function sendRefresh(row){
  if(refreshSending)return;
  refreshSending=true;
  const key=refreshKeyPrefix+row.body.operation;
  try{
    const previous=localStorage.getItem(key),body=JSON.stringify(row);
    if(previous!==null&&previous!==body)throw new Error('This refresh identity belongs to a different retained request.');
    localStorage.setItem(key,body);
    const result=await request('/api/projects/'+row.projectId+'/refresh',{method:'POST',body:JSON.stringify(row.body)});
    if(localStorage.getItem(key)===body)localStorage.removeItem(key);
    notice('Saved public refresh '+result.operation+'. The native operator continues its retained request.');
    if(project?.id===row.projectId&&tab==='publicRefresh')await renderRefreshJobs(row.projectId,refreshViewSerial);
  }catch(error){
    if(error.status&&error.status>=400&&error.status<500&&error.status!==408&&error.status!==429){
      if(localStorage.getItem(key)===JSON.stringify(row))localStorage.removeItem(key);
    }
    notice(error.status?error.message:'The refresh response was interrupted. Retry the retained request below to recover its original operation.',true);
    if(project?.id===row.projectId&&tab==='publicRefresh')await renderRefreshJobs(row.projectId,refreshViewSerial);
  }finally{refreshSending=false;}
}
function newRefresh(sourceOperation=null){
  if(busy||pending||refreshSending)return;
  const unresolved=retainedRefreshRequests(project.id);
  if(unresolved.length){notice('Resolve the saved refresh request below before starting another operation.',true);return;}
  return sendRefresh({origin:location.origin,actor:session.actor,projectId:project.id,
    body:{action:'start',operation:crypto.randomUUID(),revision:project.revision,...(sourceOperation?{source_operation:sourceOperation}:{})}});
}
function resumeRefresh(operation){
  return sendRefresh({origin:location.origin,actor:session.actor,projectId:project.id,body:{action:'resume',operation}});
}
function publicRefresh(){
  const source=project.inputs.find(item=>item.selected&&item.kind==='source_assets'&&
    ['belleville-capture','belleville-geometry-capture'].includes(item.metadata?.format));
  const host=$('#content');
  if(!source){host.append(panel('Public source refresh',el('p',{},'Open the existing Belleville project with its retained original public capture to refresh that source.')));return;}
  const mapped=project.state.mappings.source_assets?.confirmed;
  host.append(panel('Refresh the complete City public source',
    el('p',{},'Receive the full ordered attribute and map population, retain every original provider response, then save a new source edition using this project’s confirmed mapping. The completed operation produces a report, full handoff, editable backup and independently reopened workspace.'),
    el('p',{class:'small muted'},'The service is queried from this local operator. It preserves original OBJECTIDs, typed attributes and published geometry. Continue using the original operation after an interruption.'),
    el('div',{class:'toolbar'},mutation('Start complete refresh',()=>safely(()=>newRefresh()),!mapped),
      button('Reload project & mapping',()=>safely(()=>loadProject(project.id)))),
    !mapped?el('p',{class:'error'},'Review and save the current source mapping before starting.'):null),
    el('section',{id:'refresh-jobs',class:'panel'},el('h2',{},'Saved refresh operations'),el('p',{},'Loading retained operations…')));
  safely(()=>renderRefreshJobs(project.id,refreshViewSerial));
}
async function renderRefreshJobs(projectId,serial){
  clearTimeout(refreshTimer);
  const data=await request('/api/projects/'+projectId+'/refresh');
  if(serial!==refreshViewSerial||project?.id!==projectId||tab!=='publicRefresh'||!session)return;
  const host=$('#refresh-jobs');if(!host)return;
  const retained=retainedRefreshRequests(projectId);
  host.replaceChildren(el('h2',{},'Saved refresh operations'));
  if(retained.length)host.append(panel('Retained requests awaiting their result',...retained.map(row=>
    el('div',{},el('p',{},row.body.operation+' · '+row.body.action),
      button('Retry original request',()=>safely(()=>sendRefresh(row)))))));
  if(!data.refreshes.length)host.append(el('p',{},'No refresh has been started for this project.'));
  for(const job of data.refreshes){
    const links=Object.entries(job.outputs).map(([name,item])=>el('div',{},
      el('a',{href:'/api/projects/'+projectId+'/refresh-file?'+new URLSearchParams({operation:job.operation,name})},human(name)),
      el('span',{class:'small muted'},' · '+item.bytes.toLocaleString()+' bytes · '+item.sha256)));
    const receiving=job.receiving?.reopened;
    host.append(el('article',{},
      el('h3',{},human(job.state)+' · '+job.operation),
      el('p',{},job.stage+' · '+job.attribute_rows+' attribute rows · '+job.geometry_rows+' geometry rows'+
        (job.expected_rows?' / '+job.expected_rows+' source records':'')+' · '+job.received_requests+' retained responses'),
      el('p',{class:'small muted'},'Started '+job.started_utc+' · '+job.actor+' · selected project revision '+job.selected_revision),
      job.source_operation?el('p',{},'Uses the complete saved source from '+job.source_operation):null,
      job.retry_at?el('p',{},'Provider retry time: '+new Date(job.retry_at*1000).toLocaleString()):null,
      job.error?el('p',{class:'error'},job.error):null,
      receiving?el('p',{},'Independent reopening saved revision '+receiving.revision+' with '+receiving.original_rows+' original mapped rows.'):null,
      el('div',{class:'toolbar'},
        job.state!=='completed'&&job.actor===session.actor?button('Resume original operation',()=>safely(()=>resumeRefresh(job.operation))):null,
        job.state==='source-ready'&&job.outputs.capture&&job.outputs.source_archive?
          button('Use saved source with current mapping',()=>safely(()=>newRefresh(job.operation))):null,
        job.state==='completed'?button('Open updated project',()=>safely(()=>loadProject(projectId))):null),
      links.length?el('details',{},el('summary',{},'Complete saved files'),...links):null,
      jsonDetails('Original operation and receiving details',job),el('hr')));
  }
  if(data.refreshes.some(job=>['prepared','running','waiting','receiving'].includes(job.state)))
    refreshTimer=setTimeout(()=>safely(()=>renderRefreshJobs(projectId,serial)),3000);
}

function overview(){const source=captureOverview();if(source)$('#content').append(source);const state=project.state;const cards=[['Source assets',project.counts.source_assets||0],['Target assets',project.counts.target_assets||0],['Errors to repair',project.errors],['Requested updates',state.changes.filter(x=>x.state==='requested').length]];const current=project.native_runs.find(x=>x.id===state.native_run);$('#content').append(el('div',{class:'cards'},cards.map(([label,count])=>el('div',{class:'card'},el('strong',{},count),el('span',{},label)))),el('div',{class:'grid-two'},panel('Move the project forward',el('p',{},'Import the original exports, confirm each mapping, and inspect asset and work-order relationships.'),el('div',{class:'toolbar'},button('Import or map records',()=>switchTab('inputs')),button('Review current differences',()=>switchTab('review'))),el('hr'),el('p',{},'Request a work-order update, then reconcile the returned record against its identifiers and source revision.'),button('Open work orders',()=>switchTab('workflow'))),panel('Handoff status',el('p',{},current?`Last original acceptance run: ${human(current.result.status)}.`:'The original acceptance checker has not been run on this project.'),el('p',{},state.current_release?'An internal release is retained. Each release downloads its original selected version.':'No internal release is retained yet.'),button('Open contract & handoff',()=>switchTab('handoff')),el('p',{class:'small muted'},'A release records your internal handoff decision. The original checker retains its own acceptance statement.'))),panel('Selected datasets',table(['Dataset','Rows','Selected original'],Object.entries(state.inputs).map(([kind,id])=>{const input=project.inputs.find(x=>x.id===id);return [labels[kind],input?.row_count??0,input?.filename??id];}))));}
function captureOverview(){const input=project.inputs.find(item=>item.selected&&item.kind==='source_assets'&&['belleville-capture','belleville-geometry-capture'].includes(item.metadata?.format));if(!input)return null;const m=input.metadata;return panel('Original public source',el('p',{},el('a',{href:m.source,target:'_blank',rel:'noopener'},'Belleville Waterfront Trails layer')),el('p',{},`${input.row_count} original records · ${m.original_requests} attribute provider responses · ${m.original_files} attribute files`),el('p',{},m.identity_rule),el('p',{class:'small muted'},m.coordinate_system),m.geometry_included?el('p',{},`${m.geometry_paths} retained paths · ${m.geometry_positions} coordinate positions · ${m.geometry_absent_rows} records without geometry · ${m.geometry_original_requests} geometry responses · ${m.geometry_original_files} geometry files`):null,table(['Original field','Blank / null','Distinct nonblank','Repeated occurrences'],m.field_observations.map(row=>[row.field,row.blank_or_null,row.distinct_nonblank,row.repeated_nonblank_occurrences])),el('p',{class:'small muted'},'Repeated asset and segment labels stay separate. Condition, risk and replacement values are shown as published; their interpretation belongs to the agreed source mapping.'),jsonDetails('Original source fields',m.original_fields),button('Refresh complete public source',()=>switchTab('publicRefresh')));}
function inputs(){const host=$('#content');const kind=el('select',{name:'kind'},Object.entries(labels).map(([key,label])=>option(key,label,key===mappingKind)));const format=el('select',{name:'format'},['csv','geojson','esri-json','json','jsonl','belleville-capture'].map(value=>option(value,value)));const file=el('input',{name:'file',type:'file',required:true,accept:'.csv,.json,.geojson,.jsonl,.md,.txt'});file.addEventListener('change',()=>{const name=file.files[0]?.name.toLowerCase()??'';format.value=(kind.value==='source_assets'&&(format.value==='belleville-capture'||name.endsWith('.md')||name.endsWith('.txt')))||(name.includes('capture')&&name.endsWith('.json'))?'belleville-capture':name.endsWith('.csv')?'csv':name.endsWith('.geojson')?'geojson':name.endsWith('.jsonl')?'jsonl':'json';if(kind.value==='roundtrips')format.value='jsonl';});kind.addEventListener('change',()=>{if(kind.value==='roundtrips')format.value='jsonl';});const form=el('form',{onsubmit:async event=>{event.preventDefault();if(busy||pending||!file.files[0])return;const selected=file.files[0];mappingKind=kind.value;const params=new URLSearchParams({kind:kind.value,filename:selected.name,format:format.value});await execute({path:`/api/projects/${project.id}/inputs?${params}`,options:{method:'POST',body:selected,headers:{'Content-Type':'application/octet-stream','X-Revision':String(project.revision),'X-Operation-Id':crypto.randomUUID()}},success:'Original input retained. Review and save its explicit field mapping.'});}},el('div',{class:'grid-three'},field('Dataset',kind),field('File format',format),field('Original export',file)),el('button',{type:'submit','data-mutation':''},'Import original input'));
host.append(panel('Import an original export',form,el('p',{class:'small muted'},'CSV, JSON object arrays, GeoJSON, JSONL, Esri feature sets, or a complete Belleville attribute/geometry capture. For a capture, select Source assets and belleville-capture format. Maximum 32 MiB. Every original provider response and attribute value is retained.')));
const versionRows=Object.entries(labels).map(([key,label])=>{const versions=project.inputs.filter(item=>item.kind===key);if(!versions.length)return [label,'—','No original imported',''];const selected=el('select',{'aria-label':`${label} version`},versions.map(item=>option(item.id,`${item.filename} · ${item.row_count} rows`,item.selected)));return [label,project.state.mappings[key]?.confirmed?'Mapped':key==='roundtrips'?'Original JSONL':'Review mapping',selected,el('div',{class:'toolbar'},mutation('Use version',()=>{const reason=prompt('Reason for selecting this original version:');if(reason)action('select_input',{kind:key,input_id:selected.value,reason},'Original version selected.');}),key==='roundtrips'?null:button('Map fields',()=>{mappingKind=key;render();}),mutation('Remove selection',()=>{const reason=prompt('Reason for removing this dataset from the current selection (the original remains retained):');if(reason)action('select_input',{kind:key,input_id:null,reason},'Dataset removed from the current selection.');}))];});host.append(panel('Retained input versions',table(['Dataset','Mapping','Original version','Actions'],versionRows)));
if(mappingKind==='roundtrips'||!project.state.inputs[mappingKind])return;const original=project.inputs.find(x=>x.id===project.state.inputs[mappingKind]);const saved=project.state.mappings[mappingKind].value;const controls={};const grid=el('div',{class:'field-map'});for(const name of project.kinds[mappingKind]){controls[name]=el('select',{'aria-label':`${human(name)} source column`},option('','— Leave empty —'),original.columns.map(column=>option(column,column,saved.fields[name]===column)));grid.append(el('label',{},human(name)+(project.required[mappingKind].includes(name)?' *':''),controls[name]));}const aliases=el('textarea',{name:'aliases',rows:3,class:'mono'},pretty(saved.status_aliases));const trim=el('input',{type:'checkbox',checked:saved.trim_ids});host.append(panel(`Field mapping · ${labels[mappingKind]}`,el('p',{class:'small muted'},'Required fields are marked *. Identifiers keep their exact values unless you explicitly select whitespace trimming.'),el('form',{onsubmit:event=>{event.preventDefault();safely(async()=>{const mapping={fields:Object.fromEntries(Object.entries(controls).filter(([,control])=>control.value).map(([name,control])=>[name,control.value])),trim_ids:trim.checked,status_aliases:JSON.parse(aliases.value)};await action('mapping',{kind:mappingKind,mapping},'Explicit input mapping saved.');});}},grid,el('label',{class:'check'},trim,'Trim surrounding identifier whitespace'),field('Exact status aliases',aliases,'For example {"Active":"active"}. No automatic case or identifier normalization is applied.'),el('button',{type:'submit','data-mutation':''},'Save mapping')),jsonDetails('Original format metadata',original.metadata)));}
async function getRows(kind,search='',number=0,size=50){return request(`/api/projects/${project.id}/records?${new URLSearchParams({kind,query:search,page:String(number),page_size:String(size)})}`);}
async function getRecord(kind,id){const data=await request(`/api/projects/${project.id}/records?${new URLSearchParams({kind,record_id:id,page_size:'2'})}`);return data.rows.length===1?data.rows[0]:undefined;}
function validMappedGeometry(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const position=p=>Array.isArray(p)&&p.length>=2&&p.every(n=>typeof n==='number'&&Number.isFinite(n))&&p[0]>=-180&&p[0]<=180&&p[1]>=-90&&p[1]<=90;
 const line=(points,minimum=2,ring=false)=>Array.isArray(points)&&points.length>=minimum&&points.every(position)&&(!ring||(points[0].length===points[points.length-1].length&&points[0].every((n,i)=>n===points[points.length-1][i])));
 const parts=(items,ring=false)=>Array.isArray(items)&&items.length>0&&items.every(part=>line(part,ring?4:2,ring));
 const c=value.coordinates;
 if(value.type==='Point')return position(c);
 if(value.type==='MultiPoint')return line(c,1);
 if(value.type==='LineString')return line(c);
 if(value.type==='MultiLineString')return parts(c);
 if(value.type==='Polygon')return parts(c,true);
 if(value.type==='MultiPolygon')return Array.isArray(c)&&c.length>0&&c.every(polygon=>parts(polygon,true));
 return false;
}
function geometryMap(rows,select,scope='current record page'){const withGeometry=rows.filter(row=>row.geometry);const values=withGeometry.map(row=>{try{const value=JSON.parse(row.geometry);if(!validMappedGeometry(value))return null;return {row,value};}catch{return null;}}).filter(Boolean);const missing=rows.length-withGeometry.length,invalid=withGeometry.length-values.length;const coverage=`${values.length} mapped geometries · ${missing} records without geometry · ${invalid} invalid or unsupported geometries · ${rows.length} records in ${scope}`;if(!values.length)return el('p',{class:'muted small'},coverage);const positions=[];const collect=value=>{if(Array.isArray(value)&&typeof value[0]==='number')positions.push(value);else if(Array.isArray(value))value.forEach(collect);};values.forEach(item=>collect(item.value.coordinates));let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const point of positions){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1]);}const width=Math.max(maxX-minX,.001),height=Math.max(maxY-minY,.001);minX-=(width-(maxX-minX))/2;minY-=(height-(maxY-minY))/2;const scale=Math.min(730/width,230/height);const projectPoint=p=>[35+(p[0]-minX)*scale,265-(p[1]-minY)*scale];const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 300');svg.setAttribute('class','map');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Mapped WGS84 geometry for ${scope}`);function draw(tag,attrs,row){const node=document.createElementNS(ns,tag);for(const [key,val]of Object.entries(attrs))node.setAttribute(key,String(val));node.setAttribute('class','map-feature'+(tag==='circle'?' map-point':''));node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Open ${row.id}`);node.addEventListener('click',()=>select(row));node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(row);}});const title=document.createElementNS(ns,'title');title.textContent=row.id+(row.label?' · '+row.label:'');node.append(title);svg.append(node);}function path(points,close=false){return points.map((p,i)=>(i?'L':'M')+projectPoint(p).join(',')).join(' ')+(close?' Z':'');}for(const {row,value}of values){const c=value.coordinates;const point=p=>{const [cx,cy]=projectPoint(p);draw('circle',{cx,cy,r:5},row);};if(value.type==='Point')point(c);if(value.type==='MultiPoint')c.forEach(point);if(value.type==='LineString')draw('path',{d:path(c),fill:'none'},row);if(value.type==='MultiLineString')c.forEach(line=>draw('path',{d:path(line),fill:'none'},row));if(value.type==='Polygon')draw('path',{d:c.map(ring=>path(ring,true)).join(' '),'fill-rule':'evenodd'},row);if(value.type==='MultiPolygon')c.forEach(polygon=>draw('path',{d:polygon.map(ring=>path(ring,true)).join(' '),'fill-rule':'evenodd'},row));}return el('div',{},svg,el('p',{class:'small muted'},coverage+' · WGS84 longitude/latitude fitted to this selected extent.'));}
function records(){const host=$('#content');const select=el('select',{'aria-label':'Record dataset'},Object.entries(labels).filter(([key])=>key!=='roundtrips').map(([key,label])=>option(key,label,key===recordKind)));const search=el('input',{type:'search',value:query,placeholder:'Search identifiers or record values','aria-label':'Search records'});const form=el('form',{class:'toolbar',onsubmit:event=>{event.preventDefault();recordKind=select.value;query=search.value;page=0;loadRecordTable();}},select,search,el('button',{type:'submit'},'Search'),button('Map all matching records',()=>safely(loadCompleteMap)));select.addEventListener('change',()=>{recordKind=select.value;query='';page=0;search.value='';loadRecordTable();});host.append(panel('Asset and operational records',form,el('div',{id:'record-table'}),el('div',{id:'record-map'}),el('div',{id:'record-detail'})));safely(loadRecordTable);}
async function loadRecordTable(){const expectedMap=++mapSerial;const expectedProject=project.id,expectedKind=recordKind,expectedQuery=query,expectedPage=page;const data=await getRows(recordKind,query,page);if(project.id!==expectedProject||recordKind!==expectedKind||query!==expectedQuery||page!==expectedPage||!$('#record-table'))return;const columns=recordKind==='returns'?['change_id','work_order_id','status','result']:recordKind==='work_orders'?['id','asset_id','request_id','status','revision']:recordKind==='requests'?['id','asset_id','summary','status']:recordKind==='locations'?['id','label']:['id','label','status','parent_id','location_id'];const previous=button('Previous',()=>{page--;safely(loadRecordTable);},{disabled:page===0});const next=button('Next',()=>{page++;safely(loadRecordTable);},{disabled:(page+1)*data.page_size>=data.total});$('#record-table').replaceChildren(table([...columns.map(human),''],data.rows.map(row=>[...columns.map(name=>short(row[name])),button('Open',()=>recordDetail(row))])),el('div',{class:'pager'},el('span',{class:'small'},`${data.total} records · page ${page+1}`),el('div',{class:'toolbar'},previous,next)));if(expectedMap===mapSerial){$('#record-map').replaceChildren(geometryMap(data.rows,row=>recordDetail(row)));$('#record-detail').replaceChildren();}}
async function loadCompleteMap(){
 const serial=++mapSerial,selectedProject=project.id,revision=project.revision,kind=recordKind,search=query;
 const target=$('#record-map');
 const current=()=>serial===mapSerial&&project?.id===selectedProject&&project.revision===revision&&recordKind===kind&&query===search&&tab==='records'&&target===$('#record-map');
 if(!target)return;
 target.replaceChildren(el('p',{class:'small muted'},'Loading the complete matching population…'));
 try{
 const rows=[];let total=null;
 for(let number=0;;number++){
  if(!current())return;
  const data=await request(`/api/projects/${selectedProject}/records?${new URLSearchParams({kind,query:search,page:String(number),page_size:'200'})}`);
  if(!current())return;
  if(data.revision!==revision)throw new Error('The selected source changed while loading the map. Refresh the project and reopen the complete map.');
  if(!Number.isInteger(data.total)||data.total<0||data.page!==number||data.page_size!==200||!Array.isArray(data.rows))throw new Error('The complete record page is invalid.');
  if(total===null)total=data.total;
  if(data.total!==total||data.rows.length!==Math.min(200,total-rows.length))throw new Error('The complete record population changed while loading the map.');
  rows.push(...data.rows);
  if(rows.length===total)break;
  target.replaceChildren(el('p',{class:'small muted'},`Loading ${rows.length} of ${total} matching records…`));
 }
 if(!current())return;
 target.replaceChildren(geometryMap(rows,row=>recordDetail(row),`all ${total} matching records at revision ${revision}`));
 }catch(error){if(!current())return;target.replaceChildren(el('p',{class:'small'},'Complete map could not be loaded: '+error.message));throw error;}
}
function recordDetail(row){const detail=$('#record-detail');detail.className='record-detail';const entries=Object.entries(row).filter(([key])=>key!=='_row');detail.replaceChildren(el('h3',{},row.id||row.change_id||`Row ${row._row}`),el('dl',{class:'record-values'},entries.flatMap(([key,value])=>[el('dt',{},human(key)),el('dd',{},key==='attributes'?jsonDetails('Original typed attributes',(()=>{try{return JSON.parse(value);}catch{return value;}})()):String(value??''))])));const links=el('div',{class:'toolbar'});for(const [field,kind]of [['asset_id','source_assets'],['parent_id',recordKind],['location_id','locations'],['request_id','requests']])if(row[field])links.append(button(`Open ${human(field)} ${row[field]}`,()=>{recordKind=kind;query=row[field];page=0;render();}));if(recordKind==='source_assets')links.append(button('Related work orders',()=>{recordKind='work_orders';query=row.id;page=0;render();}),button('Related requests',()=>{recordKind='requests';query=row.id;page=0;render();}));if(recordKind==='work_orders')links.append(button('Request a status update',()=>{tab='workflow';render();$('#work-order-id').value=row.id;showWorkOrder(row.id);}));detail.append(links);detail.scrollIntoView({block:'nearest'});}
function review(){const host=$('#content');const filter=el('select',{'aria-label':'Finding severity'},option('all','All findings'),option('error','Errors'),option('warning','Warnings'));const rows=el('div');const detail=el('div',{id:'finding-detail'});function fill(){const found=project.findings.filter(item=>filter.value==='all'||item.severity===filter.value);rows.replaceChildren(el('p',{class:'small muted'},`${found.length} current findings. Showing the first 200; repair or remap the original exports to resolve data errors.`),table(['Dataset / record','Finding','Field','Disposition',''],found.slice(0,200).map(item=>[`${labels[item.kind]||item.kind} · ${item.record_id||'row '+item.row}`,el('div',{},el('strong',{},human(item.code)),el('div',{},item.message)),human(item.field),item.decision?human(item.decision.decision):item.severity,button('Review',()=>safely(()=>findingDetail(item)))])));}filter.addEventListener('change',fill);fill();host.append(panel('Differences and relationship issues',filter,rows,detail));if(project.state.repairs.length)host.append(panel('Retained repair proposals',table(['Dataset','Row / field','Proposed value','Reason'],project.state.repairs.map(item=>[labels[item.kind],`${item.row} · ${item.field}`,short(item.after),item.reason])),el('p',{class:'small muted'},'Proposed CSVs are included in the handoff. Supply the corrected original target export after the vendor applies the repair.')));}
async function findingDetail(finding){const detail=$('#finding-detail');detail.replaceChildren(el('h3',{},human(finding.code)),el('p',{},finding.message));const note=el('textarea',{required:true},finding.decision?.note||'');const disposition=el('select',{},['repair_requested','reviewed','keep_separate'].map(value=>option(value,human(value),finding.decision?.decision===value)));detail.append(el('form',{onsubmit:event=>{event.preventDefault();action('review',{finding_id:finding.id,decision:disposition.value,note:note.value},'Review decision retained.');}},field('Disposition',disposition),field('Review note',note),el('button',{type:'submit','data-mutation':''},'Save review')));if(!project.kinds[finding.kind]||finding.row<1)return;const data=await getRows(finding.kind,'',Math.floor((finding.row-1)/200),200);const row=data.rows.find(item=>item._row===finding.row);if(!row)return;detail.append(jsonDetails('Current mapped record',row));if(finding.code==='field_difference'){const source=await getRecord('source_assets',row.id);detail.append(el('p',{},'Source comparison value: ',el('code',{},source?.[finding.field]??'')));}const fieldChoice=el('select',{},project.kinds[finding.kind].map(value=>option(value,human(value),value===finding.field)));const replacement=el('textarea',{},row[fieldChoice.value]||'');fieldChoice.addEventListener('change',()=>replacement.value=row[fieldChoice.value]||'');detail.append(el('hr'),el('h3',{},'Prepare a repair for the vendor'),el('form',{onsubmit:event=>{event.preventDefault();action('repair',{kind:finding.kind,row_number:finding.row,field:fieldChoice.value,value:replacement.value,reason:note.value},'Repair proposal retained separately from original inputs. Download the handoff for its proposed CSV.');}},field('Mapped field',fieldChoice),field('Proposed replacement',replacement),el('p',{class:'small muted'},'The review note above is retained as the repair reason.'),el('button',{type:'submit','data-mutation':''},'Save repair proposal')));if(finding.kind==='source_assets'&&finding.code==='missing_target')detail.append(el('hr'),mutation('Record approved source omission',()=>action('exclude',{asset_id:row.id,reason:note.value},'Approved omission retained with its named operator and reason.')));detail.scrollIntoView({block:'nearest'});setBusy(busy);}
function workflow(){const host=$('#content');const id=el('input',{id:'work-order-id',required:true,placeholder:'Exact original work-order ID'});id.addEventListener('change',()=>safely(()=>showWorkOrder(id.value)));const status=el('select',{id:'desired-status'},Object.keys(project.state.transitions).map(value=>option(value,human(value))));const note=el('textarea',{required:true,placeholder:'Reason for this status change'});host.append(el('div',{class:'grid-two'},panel('Request a work-order change',el('form',{onsubmit:event=>{event.preventDefault();action('request_status',{work_order_id:id.value,desired_status:status.value,note:note.value},'Local change request retained. Export it in the handoff for the vendor adapter.');}},field('Work order',id),el('div',{id:'work-order-current',class:'small muted'},'Select an imported work order to inspect its current status and revision.'),field('Requested status',status),field('Operator note',note),el('button',{type:'submit','data-mutation':''},'Prepare status request'))),panel('Reconcile returned updates',el('p',{},'Import the vendor’s returned records, save the explicit return mapping, then apply the batch. Each result must match its original change, asset, request, status, and source revision.'),el('div',{class:'toolbar'},button('Import returned records',()=>{mappingKind='returns';switchTab('inputs');}),mutation('Apply selected returns',()=>action('apply_returns',{},'Returned records reconciled. Repeated identical records reuse the retained result.'),!project.state.mappings.returns?.confirmed)),el('p',{class:'small muted'},'The local exchange accepts ok or rejected with a provider reference. A withdrawn local request is retained; any later actual returned result still requires reconciliation.'))));host.append(panel('Change requests and returned results',table(['Change / work order','Status','Expected revision','Result','Action'],project.state.changes.slice().reverse().map(change=>[el('div',{},el('code',{},change.id),el('div',{},change.work_order_id)),`${change.previous_status} → ${change.status}`,change.expected_revision,el('div',{},human(change.state),el('div',{class:'small'},change.provider_reference||'')),change.state==='requested'?mutation('Withdraw locally',()=>{const reason=prompt('Reason for withdrawing this local request (this does not cancel a remote vendor operation):');if(reason)action('withdraw_change',{change_id:change.id,reason},'Local request withdrawn; its original record remains in the handoff.');}):''])),el('a',{href:`/api/projects/${project.id}/export`},'Download requested updates and reconciled work-order CSV')));}
async function showWorkOrder(id){const row=await getRecord('work_orders',id);const target=$('#work-order-current');if(!target||$('#work-order-id')?.value!==id)return;if(!row){target.textContent='No uniquely identified work order matches this value.';return;}target.textContent=`Current: ${row.status} · revision ${row.revision} · asset ${row.asset_id}`;const allowed=project.state.transitions[row.status]||[];$('#desired-status').replaceChildren(...allowed.map(value=>option(value,human(value))));}
function handoff(){const host=$('#content'),state=project.state;const fields=el('div',{class:'grid-three'});const fieldInputs={};for(const name of project.kinds.source_assets.filter(value=>value!=='id')){fieldInputs[name]=el('input',{type:'checkbox',checked:state.comparison_fields.includes(name)});fields.append(el('label',{class:'check'},fieldInputs[name],human(name)));}const source=el('input',{type:'number',min:1,required:true,value:state.expected_source_rows??''});const target=el('input',{type:'number',min:1,required:true,value:state.expected_target_rows??''});const auth={};for(const name of Object.keys(state.attestation))auth[name]=el('input',{value:state.attestation[name],maxlength:1000,required:true});const correlations=el('textarea',{required:true},state.expected_correlation_ids.join('\n'));const transitions=el('textarea',{class:'mono',rows:8},pretty(state.transitions));const form=el('form',{onsubmit:event=>{event.preventDefault();safely(()=>action('settings',{settings:{comparison_fields:Object.entries(fieldInputs).filter(([,node])=>node.checked).map(([name])=>name),expected_source_rows:Number(source.value),expected_target_rows:Number(target.value),attestation:Object.fromEntries(Object.entries(auth).map(([name,node])=>[name,node.value])),expected_correlation_ids:correlations.value.split('\n').map(value=>value.trim()).filter(Boolean),transitions:JSON.parse(transitions.value)}},'Original acceptance and work-order contract saved.'));}},el('h3',{},'Asset comparison fields'),fields,el('div',{class:'grid-two'},field('Declared full source row count',source),field('Declared full target row count',target)),field('Supplier reviewer',auth.supplier_reviewer),field('City data authorization reference',auth.city_data_authorization_ref),field('Vendor work statement reference',auth.vendor_sow_ref),field('Expected recorded round-trip correlations',correlations,'One exact correlation ID per line from the imported original JSONL.'),el('details',{},el('summary',{},'Work-order transition contract'),field('Allowed current → requested status transitions',transitions)),el('button',{type:'submit','data-mutation':''},'Save contract'));
host.append(panel('Comparison and engagement contract',project.mode==='development'?el('p',{class:'legend'},'Development project: retain explicit development labels in the references. These records demonstrate the operator workflow.'):null,form));const latest=project.native_runs.find(item=>item.id===state.native_run);host.append(panel('Original acceptance run',el('p',{},'Runs the existing acceptance/verify.py against the selected mapped source and target exports, approved omissions, and original round-trip JSONL.'),mutation('Run original checker',()=>action('native_check',{},'Original acceptance run retained.')),latest?jsonDetails(`${human(latest.result.status)} · ${when(latest.created_at)}`,latest.result):null));const note=el('textarea',{required:true,placeholder:'Scope, remaining commercial assumptions, and the internal recipient for this version'});host.append(panel('Release an internal handoff',el('form',{onsubmit:event=>{event.preventDefault();action('release',{note:note.value},'Internal handoff released with its original selected records and history.');}},field('Handoff note',note),el('button',{type:'submit','data-mutation':''},'Retain release')),project.errors?el('p',{class:'small'},`${project.errors} current data errors must be repaired for release.`):null,el('p',{class:'small muted'},'The release includes originals, mapped and reconciled records, proposed repairs, change requests, review history, and the unchanged original checker receipt.')));if(Object.keys(state.exclusions).length)host.append(panel('Approved omissions',table(['Asset','Reason','Operator',''],Object.values(state.exclusions).map(item=>[item.source_key,item.reason,item.approved_by,mutation('Remove omission',()=>{const reason=prompt('Reason for restoring this source row to comparison scope:');if(reason)action('exclude',{asset_id:item.source_key,reason,remove:true});})]))));}
function history(){const host=$('#content');host.append(panel('Retained releases',table(['Revision','Created','Operator / note','Download'],project.releases.map(item=>[item.revision,when(item.created_at),el('div',{},item.actor,el('div',{},item.note)),el('a',{href:`/api/projects/${project.id}/export?release=${item.id}`},'Original release ZIP')]))),panel('Project history',el('p',{class:'small muted'},'Restoring a revision creates another history entry. Imported originals remain retained. Applied returned events remain part of the operational record.'),table(['Revision','Action','Operator','Time',''],project.history.map(item=>[item.revision,human(item.action),item.actor,when(item.at),el('div',{},button('Details',()=>{const value=typeof item.detail==='string'?JSON.parse(item.detail):item.detail;const node=$('#history-detail');node.replaceChildren(el('h3',{},`Revision ${item.revision}`),el('pre',{},pretty(value)));}),mutation('Restore selection',()=>{const reason=prompt(`Reason for restoring the selections from revision ${item.revision}:`);if(reason)action('restore_revision',{target_revision:item.revision,reason},'Retained selection restored as a new project revision.');},item.revision===project.revision))])),el('div',{id:'history-detail'})));
}

let maximoSerial=0;
const maximoDraftPrefix='municipal-maximo:';
function maximoRequests(id){
  const result=[];
  for(let index=0;index<localStorage.length;index++){
    const name=localStorage.key(index);
    if(!name?.startsWith(maximoDraftPrefix+location.origin+':'+id+':')||name.endsWith(':load-mapping-draft'))continue;
    try{const value=JSON.parse(localStorage.getItem(name));if(value.project_id===id&&value.actor===session.actor)result.push({name,value});}
    catch{result.push({name,error:'Saved request could not be read. Preserve/export browser storage before removing it.'});}
  }
  return result;
}
async function maximoSend(saved,name){
  if(busy||pending)return;
  setBusy(true);
  try{
    const result=await request('/api/projects/'+saved.project_id+'/maximo',{method:'POST',body:JSON.stringify(saved.payload)});
    localStorage.removeItem(name);
    if(project?.id===saved.project_id)await loadProject(saved.project_id);
    notice('Original Maximo operation retained. Review its source or returned result below.');
    return result;
  }catch(error){notice(error.message+' The complete original request is saved below for the same-operation retry.',true);}
  finally{setBusy(false);}
}
async function maximoStart(payload){
  if(busy||pending||!project)return;
  const saved={project_id:project.id,actor:session.actor,payload:{...payload,revision:project.revision,operation:payload.operation||crypto.randomUUID()}};
  const name=maximoDraftPrefix+location.origin+':'+project.id+':'+saved.payload.operation;
  // One immutable slot per request, including delayed original replies.
  const content=JSON.stringify(saved),prior=localStorage.getItem(name);
  if(prior&&prior!==content)throw new Error('This original operation has a different saved request.');
  localStorage.setItem(name,content);
  return maximoSend(saved,name);
}
function maximo(){
  const host=$('#content'),id=project.id,serial=++maximoSerial;host.replaceChildren();
  const pendingRows=maximoRequests(id);
  if(pendingRows.length)host.append(panel('Saved original requests',...pendingRows.map(item=>el('div',{class:'panel'},
    el('p',{},item.error||item.value.payload.action+' · '+item.value.payload.operation),
    item.error?null:button('Retry this original request',()=>safely(()=>maximoSend(item.value,item.name))),
    button('Download saved request',()=>{const raw=localStorage.getItem(item.name);const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=el('a',{href:url,download:'Maximo-Saved-Request.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})))));
  host.append(panel('Original target intake',el('p',{},'Use the configured tenant profile to retain its actual object schema and every selected asset. Two complete ordinary-page observations must agree before receiving the target edition. Your existing source, mapping, history and project remain selected.')));
  const content=el('div');host.append(content);
  safely(async()=>{
    const data=await request('/api/projects/'+id+'/maximo');
    if(project?.id!==id||tab!=='maximo'||serial!==maximoSerial||!content.isConnected)return;
    const profile=el('select',{},...data.profiles.map(row=>option(row.id,row.label+' · '+row.object_structure)));
    content.append(panel('Capture a configured target',field('Maximo profile',profile),
      el('p',{class:'small'},'Configure actual HTTPS endpoint, org/site, compound identity and source-link mapping with the native maximo_cli profile command. The API key stays in the server environment.'),
      mutation('Capture complete target',()=>safely(()=>maximoStart({action:'start',profile_id:profile.value})),!data.profiles.length)));
    content.append(panel('Retained target observations',
      button('Refresh operation status',()=>maximo()),
      table(['Operation / state','Observed rows','Current step / result','Actions'],data.captures.map(row=>[
        el('div',{},row.id,el('div',{class:'badge'},row.state)),row.rows,
        el('div',{},row.stage,row.error?el('p',{class:'small error'},row.error):null,row.not_before?el('p',{class:'small'},'Original retry time: '+when(row.not_before)):null),
        el('div',{class:'toolbar'},
          ['READY','RECEIVED'].includes(row.state)?el('a',{href:'/api/projects/'+id+'/maximo-file?kind=capture&operation='+encodeURIComponent(row.id)},'Complete original target'):null,
          ['READY','RECEIVED'].includes(row.state)?mutation('Receive target edition',()=>safely(()=>maximoStart({action:'receive',capture_operation:row.id}))):null,
          ['PENDING','RUNNING','DEFERRED'].includes(row.state)?mutation('Continue original read',()=>safely(()=>maximoStart({action:'resume',operation:row.id})),Boolean(row.not_before&&Date.now()/1000<row.not_before)):null)
      ]))));
    const available=data.captures.filter(row=>['READY','RECEIVED'].includes(row.state));
    const capture=el('select',{},...available.map(row=>option(row.id,row.id)));
    const key=maximoDraftPrefix+location.origin+':'+id+':load-mapping-draft';
    const starting={action:'Add',fields:{description:'/label'},constants:{},source_ids:null,allornothing:false,review_reference:''};
    let retained=localStorage.getItem(key);
    const mapping=el('textarea',{rows:14,class:'mono'},retained??pretty(starting));
    mapping.addEventListener('input',()=>{try{localStorage.setItem(key,mapping.value);}catch(error){notice('Draft could not be saved: '+error.message,true);}});
    content.append(panel('Prepare an exact native load',
      el('p',{},'Prepare a reviewed root-scalar Add or Update from the current mapped, nonexcluded source population. The actual object schema governs field types and required fields. Existing native identities are preserved; target requests remain prepared for the prime’s integration.'),
      field('Complete observed target',capture),field('Scalar load mapping',mapping,'Target field → original source JSON pointer. Attributes are available under /attributes. Fill actual org/site/key fields and the prime review reference. Use source_ids for an explicit subset.'),
      mutation('Prepare retained load',()=>safely(()=>maximoStart({action:'prepare-load',capture_operation:capture.value,mapping:JSON.parse(mapping.value)})),!available.length)));
    const loadSelect=el('select',{},...data.loads.map(row=>option(row.id,row.id)));
    const resultFile=el('input',{type:'file',accept:'.json,application/json'});
    let reading=false;
    const receive=mutation('Receive complete provider result',()=>safely(async()=>{
      if(reading||busy||pending)return;
      const file=resultFile.files[0],selectedLoad=loadSelect.value,selectedProject=project.id;
      if(!file)throw new Error('Select the complete saved provider result JSON.');
      if(file.size>12*1024*1024)throw new Error('Complete provider result exceeds12MiB.');
      reading=true;receive.disabled=true;
      try{
        const text=await file.text();
        if(project?.id!==selectedProject||!resultFile.isConnected||resultFile.files[0]!==file||loadSelect.value!==selectedLoad)throw new Error('The selected project/load/file changed; select the current original result again.');
        await maximoStart({action:'receive-load',load_id:selectedLoad,returned:JSON.parse(text)});
      }finally{reading=false;receive.disabled=busy||Boolean(pending);}
    }),!data.loads.length);
    content.append(panel('Original native load results',
      field('Prepared load',loadSelect),field('Complete returned result JSON',resultFile),receive,
      el('p',{class:'small'},'The result must bind the prepared request SHA (method, URL, headers and body) plus the exact body SHA, and retain HTTP status, response headers/body, observation time and original provider reference. Bulk200 is evaluated per resource. Run a fresh target capture to verify the resulting values.'),
      ...data.loads.map(row=>el('details',{},el('summary',{},row.id+' · '+row.rows+' source rows'),
        el('a',{href:'/api/projects/'+id+'/maximo-file?kind=load&operation='+encodeURIComponent(row.id)},'Download complete prepared load'),
        el('p',{class:'mono small'},row.body_sha256),
        ...row.returns.map(received=>jsonDetails('Original result '+received.id+' · '+when(received.at),received.report))))));
  });
}

$('#login-form').addEventListener('submit',event=>{event.preventDefault();safely(async()=>{const form=event.currentTarget;session=await request('/api/login',{method:'POST',body:JSON.stringify({actor:form.elements.actor.value,password:form.elements.password.value})});form.elements.password.value='';$('#notice').hidden=true;showShell();await loadProjects();});});
$('#project-form').addEventListener('submit',event=>{event.preventDefault();if(busy||pending)return;const form=event.currentTarget;execute({path:'/api/projects',options:{method:'POST',body:JSON.stringify({title:form.elements.title.value,mode:form.elements.mode.value,operation:crypto.randomUUID()})},created:true,success:'Project created. Import its original records.'});});
window.addEventListener('unhandledrejection',event=>{event.preventDefault();notice(event.reason?.message||'The page action did not complete.',true);});
(async()=>{try{session=await request('/api/session');showShell();await loadProjects();}catch{showLogin();}})();
