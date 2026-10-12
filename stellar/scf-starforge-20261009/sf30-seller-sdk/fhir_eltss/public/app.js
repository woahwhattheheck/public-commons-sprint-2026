// MIT. Native eLTSS care-plan operations, complete source review and receiving.
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pretty=value=>JSON.stringify(value,null,2),copy=value=>structuredClone(value);
const short=value=>String(value??'').length>18?String(value).slice(0,12)+'…':String(value??'');
const bytes=value=>new Intl.NumberFormat().format(Number(value??0))+' bytes';
const label=value=>String(value).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]/g,' ').replace(/^./,ch=>ch.toUpperCase());
const badge=value=>'<span class="badge">'+html(label(value??'—'))+'</span>';
const path=(...parts)=>'/api/'+parts.map(value=>encodeURIComponent(value)).join('/');
const token=location.hash.slice(1);
const state={view:'overview',workspace:null,catalogue:null,auth:[],busy:0,forms:Object.create(null),
  selected:Object.create(null),data:Object.create(null),filters:Object.create(null),pages:Object.create(null),
  activeField:0,profile:null,reviewDraft:null,mapping:null,correctionPreview:null,auto:null,requestGeneration:0};
const views={overview:'Overview',sources:'Original sources',acquisition:'Original acquisition',careplans:'Care plans and references',
  requirements:'Field review',review:'Assessment and decisions',corrections:'Corrections and editions',
  datasets:'Native datasets',delivery:'Delivery and receiving'};
function notice(value){$('#notice').textContent=value??'';}
function errorView(error){const node=$('#error');node.hidden=false;node.textContent=error.message??String(error);}
function clearError(){$('#error').hidden=true;$('#error').textContent='';}
function markBusy(){state.busy++;$('#content').setAttribute('aria-busy','true');}
function unmarkBusy(){state.busy=Math.max(0,state.busy-1);$('#content').setAttribute('aria-busy',String(state.busy>0));}
async function request(url,{method='GET',body,raw=false,headers={},signal}={}){
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,
    ...(body!==undefined&&!raw?{'Content-Type':'application/json'}:{}),...headers},
    ...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{}),signal:signal??AbortSignal.timeout(600000)});
  if(!response.ok){
    let value;try{value=await response.json();}catch{value={error:'HTTP '+response.status};}
    const error=new Error(value.error??value.message??'HTTP '+response.status);error.status=response.status;error.original=value;throw error;
  }
  return response;
}
async function api(url,body){return (await request(url,body===undefined?{}:{method:'POST',body})).json();}
async function perform(action,{refresh=true,success}={}){
  clearError();markBusy();
  try{const value=await action();if(refresh)await refreshWorkspace();if(success)notice(typeof success==='function'?success(value):success);render();return value;}
  catch(error){errorView(error);throw error;}
  finally{unmarkBusy();}
}
async function refreshWorkspace(){
  state.workspace=await api(path('state'));
  $('#connection-state').textContent='Private workspace connected';
  $('#workspace-identity').innerHTML='<strong>Original workspace</strong>'+html(state.workspace.workspaceId);
}
function collection(name){return state.workspace?.[name]??[];}
function findRecord(name,id){return collection(name).find(item=>(item.id??item.operationId)===id);}
function recordName(item){return item?.label??item?.name??item?.connection?.label??item?.request?.label??item?.id??item?.operationId??'';}
function opts(items,selected,{empty='Select…',key='id'}={}){
  return '<option value="">'+html(empty)+'</option>'+items.map(item=>{
    const value=typeof item==='string'?item:item[key],text=typeof item==='string'?label(item):recordName(item);
    return '<option value="'+html(value)+'"'+(value===selected?' selected':'')+'>'+html(text)+(typeof item==='string'?'':' · '+html(short(value)))+'</option>';
  }).join('');
}
function selectControl(key,items,selected,title,extra=''){
  return '<label>'+html(title)+'<select data-select="'+html(key)+'" '+extra+'>'+opts(items,selected)+'</select></label>';
}
function button(action,text,data={},kind=''){
  return '<button type="button" data-action="'+html(action)+'"'+Object.entries(data).map(([key,value])=>' data-'+key+'="'+html(value)+'"').join('')+
    (kind?' class="'+html(kind)+'"':'')+'>'+html(text)+'</button>';
}
function table(columns,rows,{empty='No saved records yet.'}={}){
  if(!rows?.length)return '<div class="empty">'+html(empty)+'</div>';
  return '<div class="table-scroll"><table><thead><tr>'+columns.map(column=>'<th>'+html(column.title)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(column=>'<td'+(column.id?' class="id"':'')+'>'+
      (column.render?column.render(row):html(row[column.key]??''))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function details(title,value){return '<details><summary>'+html(title)+'</summary><pre>'+html(typeof value==='string'?value:pretty(value))+'</pre></details>';}
function pageTitle(title,description){return '<div class="page-heading"><div><h1>'+html(title)+'</h1><p class="lead">'+html(description)+'</p></div></div>';}
function panel(title,body){return '<section class="panel"><h2>'+html(title)+'</h2>'+body+'</section>';}
function savedTable(name,action,columns=[]){
  return table([{title:'Name',render:row=>button(action,recordName(row),{id:row.id??row.operationId},'link')},...columns,
    {title:'Identity',id:true,render:row=>html(short(row.id??row.operationId))}],collection(name));
}
function pager(key,value){
  if(!value)return '';
  const current=value.offset??0,history=state.pages[key]?.history??[];
  return '<div class="pager"><span>'+html((value.total??0)?current+1:0)+'–'+html(current+(value.rows?.length??value.nodes?.length??value.edges?.length??0))+
    ' of '+html(value.total??0)+'</span>'+button('page-previous','Previous',{key},'compact')+
    button('page-next','Next',{key},'compact')+'</div>';
}
function filterBar(key,choices,field='resourceType',extra=''){
  const value=state.filters[key]??{};
  return '<div class="toolbar"><label>'+html(label(field))+'<select data-filter="'+key+'" data-property="'+field+'">'+
    opts(choices,value[field],{empty:'All'})+'</select></label><label class="grow">Search<input data-filter="'+key+
    '" data-property="query" value="'+html(value.query??'')+'"></label>'+extra+button('page-filter','Apply',{key})+'</div>';
}
function rowsOf(value){return value?.rows??value?.nodes??value?.edges??[];}
function pathData(value){return html(encodeURIComponent(JSON.stringify(value)));}
function fromPath(value){return JSON.parse(decodeURIComponent(value));}
function at(object,keys){return keys.reduce((current,key)=>current?.[key],object);}
function setAt(object,keys,value){
  let current=object;
  for(let i=0;i<keys.length-1;i++){const key=keys[i];if(current[key]===undefined||current[key]===null)current[key]=typeof keys[i+1]==='number'?[]:{};current=current[key];}
  current[keys.at(-1)]=value;
}
function defaultValue(definition){
  if(definition.default!==undefined)return copy(definition.default);
  if(definition.nullable)return null;
  if(definition.type==='boolean')return false;
  if(definition.type==='integer')return 0;
  if(definition.type==='enum')return definition.choices?.[0]??'';
  if(definition.type==='object')return defaults(definition.fields??{});
  if(definition.type?.endsWith('-list')||definition.type==='path-tokens'||definition.type==='field-reviews')return [];
  return '';
}
function defaults(fields){return Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,defaultValue(value)]));}
function formDraft(name,schema,initial={}){
  return state.forms[name]??=(Object.assign(defaults(schema.fields??{}),copy(initial)));
}
function choiceItems(definition,form){
  if(definition.type==='auth-profile'){
    const profiles=Array.isArray(state.auth)?state.auth:state.auth.profiles??[];
    return profiles.map(item=>({id:typeof item==='string'?item:item.id??item.name,label:typeof item==='string'?item:item.label??item.name??item.id}));
  }
  if(definition.collection)return collection(definition.collection);
  if(definition.type==='source-profile'||definition.type==='profile')return state.catalogue?.profiles??[];
  if(definition.type==='source-field'||definition.type==='source-field-list')return (state.profile?.fields??[]).map(item=>({id:item.fieldKey??item.key,label:item.label??item.name??item.fieldKey??item.key}));
  if(definition.type==='resource-list'||definition.type==='resource')
    {
      const draft=state.forms[form]??{},edition=findRecord('editions',draft.editionId),sourceId=draft.sourceId??edition?.sourceId,
        graph=state.data.graphsBySource?.[sourceId]??(state.data.graph?.sourceId===sourceId?state.data.graph:null);
      return (graph?.carePlans??[]).filter(item=>!edition?.carePlanIds?.length||edition.carePlanIds.includes(item.recordId))
        .map(item=>({id:item.recordId,label:item.id??item.fullUrl??item.recordId}));
    }
  return [];
}
function fieldControl(form,key,definition,value,keys,required=false){
  const type=definition.type??'string',data=' data-form="'+html(form)+'" data-path="'+pathData(keys)+'" data-type="'+html(type)+'"',
    title=label(key),requiredMark=required?' *':'';
  if(type==='field-review-list'||type==='field-reviews')return '';
  if(type==='object'){
    value??={};
    return '<fieldset class="field-object"><legend>'+html(title)+'</legend><div class="form-grid">'+
      renderFields(form,definition.fields??{},value,keys)+'</div></fieldset>';
  }
  if(type==='object-list'||type==='selector-list'){
    const fields=type==='selector-list'?state.catalogue.schemas.selector.fields:definition.fields??{};
    return '<fieldset class="field-object"><legend>'+html(title)+requiredMark+'</legend>'+
      (value??[]).map((item,index)=>'<div class="repeat-item"><div class="repeat-heading"><strong>'+html(title)+' '+(index+1)+
        '</strong>'+button('form-remove','Remove',{form,path:encodeURIComponent(JSON.stringify(keys)),index},'compact')+
        '</div><div class="form-grid">'+renderFields(form,fields,item,[...keys,index])+'</div></div>').join('')+
      button('form-add','Add '+title.toLowerCase(),{form,path:encodeURIComponent(JSON.stringify(keys)),schema:encodeURIComponent(JSON.stringify({fields}))},'compact')+'</fieldset>';
  }
  if(type==='resource')return '<label>'+html(title)+requiredMark+'<input class="code" list="record-identities"'+data+' value="'+html(value??'')+'"><small>Exact original record identity. Browse a source or reference graph to select its resource.</small></label>';
  if(type==='boolean')return '<label class="check"><input type="checkbox"'+data+(value?' checked':'')+'>'+html(title)+'</label>';
  if(type==='enum')return '<label>'+html(title)+requiredMark+'<select'+data+'>'+opts(definition.choices??[],value,{empty:'Select…'})+'</select></label>';
  if(['reference','auth-profile','source-profile','profile','source-field'].includes(type)){
    return '<label>'+html(title)+requiredMark+'<select'+data+'>'+opts(choiceItems(definition,form),value)+'</select></label>';
  }
  if(['reference-list','resource-list','source-field-list'].includes(type)){
    const selected=new Set(value??[]);
    return '<label class="wide">'+html(title)+requiredMark+'<select multiple'+data+'>'+
      choiceItems(definition,form).map(item=>'<option value="'+html(item.id)+'"'+(selected.has(item.id)?' selected':'')+'>'+html(recordName(item))+'</option>').join('')+
      '</select><small>Select one or more retained records.</small></label>';
  }
  if(type==='string-list')return '<label>'+html(title)+requiredMark+'<textarea'+data+'>'+html((value??[]).join('\n'))+'</textarea><small>One exact value per line.</small></label>';
  if(type==='path-tokens')return '<label>'+html(title)+requiredMark+'<input class="code"'+data+
    ' value="'+html(typeof value==='string'?value:JSON.stringify(value??[]))+'"><small>Ordered JSON tokens, for example ["activity","*","reference"].</small></label>';
  if(type==='json-value')return '<label class="wide">'+html(title)+requiredMark+'<textarea class="code"'+data+'>'+html(value??'')+
    '</textarea><small>Complete JSON value. Numeric and string text is retained exactly.</small></label>';
  if(type==='source-reference-list')return '<label class="wide">'+html(title)+'<textarea class="code"'+data+'>'+html(typeof value==='string'?value:pretty(value??[]))+'</textarea><small>Original source-reference records as a JSON array.</small></label>';
  if(type==='text')return '<label class="wide">'+html(title)+requiredMark+'<textarea'+data+'>'+html(value??'')+'</textarea></label>';
  const inputType=type==='integer'?'number':type==='url'?'url':'text';
  return '<label>'+html(title)+requiredMark+'<input type="'+inputType+'"'+data+' value="'+html(value??'')+'"'+
    (definition.maxLength?' maxlength="'+definition.maxLength+'"':'')+(type==='integer'?' step="1" min="0"':'')+'></label>';
}
function renderFields(form,fields,value,parent=[],required=[]){
  return Object.entries(fields).map(([key,definition])=>fieldControl(form,key,definition,value?.[key],[...parent,key],required.includes(key))).join('');
}
function renderForm(name,schemaKey,action,text,initial={},extra=''){
  const schema=state.catalogue.schemas[schemaKey],draft=formDraft(name,schema,initial);
  return '<form data-submit="'+action+'" data-form-name="'+name+'" data-schema="'+schemaKey+'"><div class="form-grid">'+
    renderFields(name,schema.fields,draft,[],schema.required??[])+'</div>'+extra+'<div class="actions"><button type="submit" class="primary">'+html(text)+'</button></div></form>';
}
function cleanFields(fields,value,required=[]){
  const result={};
  for(const [key,definition] of Object.entries(fields)){
    let item=value?.[key];const type=definition.type;
    if(item===undefined)continue;
    if(item===''&&!required.includes(key)&&!definition.allowEmpty){if(definition.nullable)result[key]=null;continue;}
    if(type==='object')item=cleanFields(definition.fields??{},item??{});
    else if(type==='object-list'||type==='selector-list')item=(item??[]).map(entry=>cleanFields(
      type==='selector-list'?state.catalogue.schemas.selector.fields:definition.fields??{},entry));
    else if(type==='field-review-list'||type==='field-reviews')item=(item??[]).map(entry=>cleanFields(state.catalogue.schemas.fieldReview.fields,entry,state.catalogue.schemas.fieldReview.required));
    else if((type==='path-tokens'||type==='source-reference-list')&&typeof item==='string'){
      item=JSON.parse(item);if(!Array.isArray(item))throw new Error(label(key)+' must be a JSON array.');
    }
    if(required.includes(key)&&(item===null||item===''))throw new Error(label(key)+' is required.');
    result[key]=item;
  }
  return result;
}
function submitted(name,schemaKey){
  const schema=state.catalogue.schemas[schemaKey];
  return cleanFields(schema.fields,state.forms[name],schema.required??[]);
}
function recordDialog(title,value,body=''){
  $('#record-title').textContent=title;$('#record-body').innerHTML=body+details('Complete original record',value);
  const dialog=$('#record-dialog');if(!dialog.open)dialog.showModal();
}
async function download(url,filename){
  notice('Receiving the complete '+filename+'…');
  const response=await request(url),blob=await response.blob(),expected=response.headers.get('content-length');
  if(expected!==null&&blob.size!==Number(expected))throw new Error('The original download ended before its declared byte count.');
  const href=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=href;anchor.download=filename;
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
  notice('Received '+filename+' · '+bytes(blob.size));
}

function installUISchemas(){
  Object.assign(state.catalogue.schemas,{
    graphSelection:{required:['sourceId','referencePolicy'],fields:{
      sourceId:{type:'reference',collection:'sources'},referencePolicy:{type:'enum',choices:['bundle','selected-base'],default:'bundle'},
      baseUrl:{type:'url',allowEmpty:true},decisionIds:{type:'reference-list',collection:'decisions'}}},
    profileAdoption:{required:['profileId','label','actor'],fields:{profileId:{type:'profile'},
      label:{type:'string'},actor:{type:'string'},note:{type:'text'}}},
    editionComparison:{required:['beforeId','afterId','label'],fields:{beforeId:{type:'reference',collection:'editions'},
      afterId:{type:'reference',collection:'editions'},label:{type:'string'}}},
    mappingSelection:{required:['sourceId','resourceType','name'],fields:{sourceId:{type:'reference',collection:'sources'},
      resourceType:{type:'resource-type'},name:{type:'string'}}},
    nativeQuery:{fields:{conditions:{type:'object-list',fields:{operator:{type:'enum',choices:['where','gt','gte','lt','lte']},
      column:{type:'string'},value:{type:'string',allowEmpty:true}}},fields:{type:'string-list'},
      sort:{type:'string'},limit:{type:'integer',default:25}}},
    buildComparison:{required:['beforeId','afterId'],fields:{beforeId:{type:'reference',collection:'builds'},afterId:{type:'reference',collection:'builds'}}}
  });
}
function uploadForm(action,{title='Complete original file',labelName='Source label',accept='.json,.zip',help='',name=action}={}){
  return '<form data-upload="'+html(action)+'" data-upload-name="'+html(name)+'"><div class="form-grid"><label>'+html(title)+
    '<input type="file" name="file" accept="'+html(accept)+'" required></label><label>'+html(labelName)+
    '<input name="label" data-upload-label="'+html(name)+'" value="'+html(state.forms['upload:'+name]??'')+'"></label></div>'+
    (help?'<p class="help">'+html(help)+'</p>':'')+'<div class="actions"><button type="submit" class="primary">Receive complete file</button></div></form>';
}
function stats(items){return '<div class="stats">'+items.map(([name,value])=>'<div><strong>'+html(value??0)+'</strong><span>'+html(name)+'</span></div>').join('')+'</div>';}
function selectedSummary(key,value){return value?details('Complete '+label(key),value):'<p class="empty">Select a saved '+html(label(key))+'.</p>';}
function sourceTypes(){
  const values=new Set(['CarePlan','Patient','RelatedPerson','Practitioner','PractitionerRole','Organization','Goal','Condition',
    'Observation','CareTeam','ServiceRequest','Task','Coverage','Location','QuestionnaireResponse','DocumentReference']);
  for(const row of rowsOf(state.data.sourceRows))if(row.resourceType)values.add(row.resourceType);
  return [...values].sort();
}
function sourceRowsTable(value){
  return table([{title:'Resource',render:row=>button('source-row',row.resourceType+'/'+(row.id??short(row.recordId)),{id:row.recordId},'link')},
    {title:'Original URL',key:'fullUrl'},{title:'Version',key:'versionId'},{title:'Member',key:'memberName'},
    {title:'Exact entry',key:'entryPointer',id:true}],rowsOf(value));
}
function viewOverview(){
  const recent=name=>collection(name).slice().reverse().slice(0,8);
  return pageTitle('eLTSS care-plan operations','Receive complete source records, review the published field set, and carry each selected plan through correction and receiving.')+
    stats([['Original sources',collection('sources').length],['Care-plan editions',collection('editions').length],
      ['Field review sets',collection('reviewSets').length],['Assessments',collection('assessments').length],['Handoffs',collection('handoffs').length]])+
    '<div class="two-column">'+panel('Working sequence','<ol class="workflow"><li>'+button('navigate','Receive an original source',{view:'sources'},'link')+
      ' or '+button('navigate','continue a saved acquisition',{view:'acquisition'},'link')+'.</li><li>'+
      button('navigate','Resolve references and select a CarePlan edition',{view:'careplans'},'link')+'.</li><li>'+
      button('navigate','Review all 56 published fields',{view:'requirements'},'link')+' and '+button('navigate','run the assessment',{view:'review'},'link')+
      '.</li><li>'+button('navigate','Preview and apply a correction',{view:'corrections'},'link')+' when the selected source needs an authored change.</li><li>'+
      button('navigate','Prepare and receive the complete handoff',{view:'delivery'},'link')+'.</li></ol>')+
    panel('Current publication','<p><strong>'+html(state.catalogue.publication.package_id)+' '+html(state.catalogue.publication.version)+
      '</strong></p><p>FHIR '+html(state.catalogue.publication.fhir_version)+' · US Core '+html(state.catalogue.publication.us_core_version)+
      '</p><p>Full source capacity: '+bytes(state.catalogue.limits.sourceBytes)+' · '+html(state.catalogue.limits.resources)+
      ' resources · '+html(state.catalogue.limits.carePlans)+' CarePlans.</p>'+details('Published source notes',state.catalogue.sourceNotes))+'</div>'+
    panel('Recent editions',table([{title:'Edition',render:r=>button('open-edition',r.label,{id:r.id},'link')},
      {title:'CarePlans',render:r=>html(r.carePlanIds?.length??0)},{title:'Owner',key:'owner'},{title:'Created',key:'createdAt'}],recent('editions')))+
    panel('Original acquisitions',table([{title:'Operation',render:r=>button('open-operation',short(r.operationId),{id:r.operationId},'link')},
      {title:'State',render:r=>badge(r.state)},{title:'Resources',key:'resourceCount'},{title:'Original bytes',render:r=>html(bytes(r.receivedBytes))},
      {title:'Updated',key:'updatedAt'}],recent('operations')))+
    panel('Recent receiving results',table([{title:'Receiver',key:'receiver'},{title:'State',render:r=>badge(r.state)},
      {title:'Destination',key:'destinationObjectId'},{title:'Original operation',key:'operationId',id:true}],recent('receivings')));
}
function viewSources(){
  const source=state.data.source;
  return pageTitle('Original sources','Open a complete FHIR resource, Bundle or source archive. Inspect its exact retained members and resource locations.')+
    panel('Receive a complete source',uploadForm('source-upload',{help:'The complete file is retained under its byte identity. Maximum source size: '+bytes(state.catalogue.limits.sourceBytes)+'.'}))+
    panel('Saved sources',selectControl('source',collection('sources'),state.selected.source,'Original source')+
      (source?stats([['Source bytes',bytes(source.bytes)],['Resources',source.inventory?.resourceCount??source.inventory?.resources??'—']])+
        '<div class="actions">'+button('download-source','Download original source',{id:source.id})+
        button('source-to-careplans','Build reference view',{id:source.id})+button('source-to-datasets','Prepare native dataset',{id:source.id})+'</div>'+
        details('Original source inventory',source.inventory)+table([{title:'Original member',key:'name'},{title:'Role',key:'role'},
          {title:'Bytes',render:r=>html(bytes(r.bytes))},{title:'SHA-256',key:'sha256',id:true},
          {title:'Receive',render:r=>button('download-source-member','Download',{id:source.id,member:r.name},'compact')}],state.data.sourceMembers??[]):''))+
    (source?panel('Complete resource index',filterBar('sourceRows',sourceTypes())+sourceRowsTable(state.data.sourceRows)+pager('sourceRows',state.data.sourceRows)):'');
}
function viewAcquisition(){
  const requestRecord=state.data.request,operation=state.data.operation;
  return pageTitle('Original acquisition','Select a source, retain its observed capabilities and advance its original GET request through the complete response graph.')+
    '<div class="two-column">'+panel('Save a source connection',renderForm('connection','connection','connection-save','Save connection',{
      origin:'operator_source'}))+panel('Observe a saved source',selectControl('connection',collection('connections'),state.selected.connection,'Connection')+
      '<div class="actions">'+button('connection-discover','Read actual capabilities')+'</div>'+
      selectedSummary('discovery',state.data.discovery))+'</div>'+
    panel('Prepare the complete request',renderForm('request','request','request-save','Save original request',{
      connectionId:state.selected.connection??'',route:'bundle-url'}))+
    panel('Saved request and original operation',selectControl('request',collection('requests'),state.selected.request,'Original saved request')+
      selectedSummary('request',requestRecord)+(requestRecord?'<div class="toolbar"><label class="grow">Original operation identity<input data-operation-id value="'+
      html(state.selected.operation??'')+'" class="code"></label>'+button('operation-new','Create a new operation identity')+
      button('operation-run','Run complete acquisition',{},'primary')+button('operation-step','Advance one original response')+'</div>':'')+
      selectControl('operation',collection('operations').map(r=>({...r,id:r.operationId,label:r.operationId+' · '+r.state})),state.selected.operation,'Saved operation')+
      (operation?stats([['State',operation.state],['Resources',operation.resourceCount],['Pages',operation.pageCount],['Original bytes',bytes(operation.receivedBytes)]])+
        '<div class="actions">'+button('operation-pause','Pause after current response')+button('operation-resume','Resume original operation')+
        button('operation-refresh','Read current operation')+(operation.sourceId?button('operation-source','Open received source',{id:operation.sourceId}):'')+'</div>'+
        (operation.notBefore?'<p>Provider next request time: <strong>'+html(operation.notBefore)+'</strong></p>':'')+
        (operation.error?details('Original provider result',operation.error):'')+details('Complete original queue, responses and history',operation):''))+
    panel('Acquisition history',savedTable('operations','open-operation',[{title:'State',render:r=>badge(r.state)},{title:'Pages',key:'pageCount'},
      {title:'Resources',key:'resourceCount'},{title:'Updated',key:'updatedAt'}]));
}
function viewCarePlans(){
  const graph=state.data.graph;
  return pageTitle('Care plans and references','Retain source identities, inspect resolved and unresolved references, and select complete CarePlans into an immutable edition.')+
    panel('Select the source and reference policy',renderForm('graphSelection','graphSelection','graph-build','Build reference view',{
      sourceId:state.selected.source??'',referencePolicy:'bundle'}))+
    (graph?panel('Original reference graph',stats(Object.entries(graph.summary??{}).filter(([,v])=>typeof v==='number').map(([k,v])=>[label(k),v]))+
      details('Source and graph identity',{id:graph.id,sourceId:graph.sourceId,policy:graph.policy})+
      table([{title:'CarePlan',render:r=>button('graph-node',r.id??r.fullUrl??short(r.recordId),{id:r.recordId},'link')},
        {title:'Exact record identity',key:'recordId',id:true}],graph.carePlans??[])):'')+
    panel('Save a CarePlan edition',renderForm('edition','edition','edition-save','Save complete edition',{
      sourceId:graph?.sourceId??state.selected.source??'',referencePolicy:graph?.policy?.referencePolicy??'bundle'}))+
    panel('Saved editions',savedTable('editions','open-edition',[{title:'CarePlans',render:r=>html(r.carePlanIds?.length??0)},
      {title:'Owner',key:'owner'},{title:'Created',key:'createdAt'}]))+
    (state.data.edition?panel('Selected edition',selectedSummary('edition',state.data.edition)+'<div class="actions">'+
      button('edition-to-assessment','Assess selected edition',{id:state.data.edition.id})+
      button('edition-to-correction','Prepare a correction',{id:state.data.edition.id})+'</div>'):'')+
    (graph?panel('Original graph resources',filterBar('graphNodes',sourceTypes())+
      table([{title:'Resource',render:r=>button('graph-node',r.resourceType+'/'+(r.id??short(r.recordId)),{id:r.recordId},'link')},
        {title:'Original URL',key:'fullUrl'},{title:'Member',key:'memberName'},{title:'Exact record',key:'recordId',id:true}],rowsOf(state.data.graphNodes))+
      pager('graphNodes',state.data.graphNodes))+panel('Original reference edges',filterBar('graphEdges',['resolved','unresolved','ambiguous','external','logical'],'status')+
        table([{title:'Reference',render:r=>button('edge-view',r.reference??r.pointer,{id:r.id},'link')},{title:'State',render:r=>badge(r.status)},
          {title:'Exact pointer',key:'pointer',id:true},{title:'Reason',key:'reason'},
          {title:'Candidates',render:r=>html((r.candidateRecordIds??r.targetRecordIds??[]).length)}],rowsOf(state.data.graphEdges))+
        pager('graphEdges',state.data.graphEdges)):'');
}
function viewRequirements(){
  const profiles=state.catalogue.profiles??[],profile=state.profile,review=state.forms.reviewSet;
  let editor='';
  if(profile&&review){
    const field=review.fields[state.activeField]??review.fields[0],index=review.fields.indexOf(field),
      original=profile.fields.find(row=>(row.key??row.fieldKey)===field?.fieldKey);
    const statusCounts=review.fields.reduce((m,r)=>(m[r.status]=(m[r.status]??0)+1,m),{});
    editor=panel('Complete 56-field review',stats([['All source fields',review.fields.length],['Reviewed',statusCounts.reviewed??0],
      ['Draft',statusCounts.draft??0],['Needs input',statusCounts.needs_input??0]])+
      '<div class="field-review"><div class="field-list">'+review.fields.map((r,i)=>{
        const source=profile.fields.find(p=>(p.key??p.fieldKey)===r.fieldKey);
        return '<button type="button" data-action="field-select" data-index="'+i+'"'+(i===index?' aria-current="true"':'')+
          '><span>'+html((i+1)+'. '+(source?.label??r.fieldKey))+'</span>'+badge(r.status)+'</button>';
      }).join('')+'</div><div class="field-editor"><p class="eyebrow">'+html(original?.group??'Published source field')+'</p><h3>'+
      html(original?.label??field?.fieldKey)+'</h3><p>'+html(original?.definition??'')+'</p>'+
      details('Original mapping guidance and source reference',original)+
      '<div class="form-grid">'+renderFields('reviewSet',Object.fromEntries(Object.entries(state.catalogue.schemas.fieldReview.fields).filter(([key])=>key!=='fieldKey')),
        field,['fields',index],state.catalogue.schemas.fieldReview.required)+'</div><div class="actions">'+
      button('field-previous','Previous field')+button('field-next','Next field')+'</div></div></div>'+
      renderForm('reviewSet','reviewSet','review-save','Save complete field review',review));
  }
  return pageTitle('Field review','Review every original eLTSS dataset field, retain its source guidance and author exact graph selections and conversion decisions.')+
    '<div class="two-column">'+panel('Published source profile',selectControl('profile',profiles,state.selected.profile??profiles[0]?.id,'Complete source profile')+
      (profile?'<p>'+html(profile.fields.length)+' original fields · '+html(profile.accessoryRequirements?.length??0)+' accessory requirements</p>'+
        details('Original publication and references',{publication:profile.publication,sourceReferences:profile.sourceReferences}):''))+
    panel('Start a complete review',renderForm('profileAdoption','profileAdoption','profile-adopt','Adopt all source fields',{
      profileId:state.selected.profile??profiles[0]?.id??'',label:'eLTSS field review'}))+'</div>'+
    panel('Saved complete reviews',selectControl('reviewSet',collection('reviewSets'),state.selected.reviewSet,'Field review set')+
      savedTable('reviewSets','open-review-set',[{title:'Fields',key:'fieldCount'},{title:'Reviewed',key:'reviewedCount'},{title:'Actor',key:'actor'}]))+
    editor;
}
function viewReview(){
  const assessment=state.data.assessment,cells=state.data.assessmentCells,filters=state.filters.assessmentCells??{};
  const careplans=(state.data.graph?.carePlans??[]).map(r=>({id:r.recordId,label:r.id??r.fullUrl??r.recordId}));
  return pageTitle('Assessment and decisions','Evaluate the selected CarePlans against the complete saved review. Inspect each original value, missing selection and reference finding.')+
    panel('Assess a complete edition',renderForm('assessment','assessment','assessment-create','Run full assessment',{
      editionId:state.selected.edition??'',reviewSetId:state.selected.reviewSet??'',label:'Care-plan field assessment'}))+
    panel('Saved assessments',selectControl('assessment',collection('assessments'),state.selected.assessment,'Assessment')+
      (assessment?stats(Object.entries(assessment.summary??{}).filter(([,v])=>typeof v==='number').map(([k,v])=>[label(k),v]))+
        details('Original selected edition and field review',assessment)+'<div class="actions">'+button('download-assessment','Download complete field cells',{id:assessment.id})+'</div>':''))+
    (assessment?panel('Complete field cells','<div class="toolbar"><label>CarePlan<select data-filter="assessmentCells" data-property="carePlanId">'+opts(careplans,filters.carePlanId,{empty:'All CarePlans'})+
      '</select></label><label>Field<select data-filter="assessmentCells" data-property="fieldKey">'+
      opts((state.profile?.fields??[]).map(f=>({id:f.key??f.fieldKey,label:f.label})),filters.fieldKey,{empty:'All fields'})+'</select></label>'+
      '<label>Result<select data-filter="assessmentCells" data-property="status">'+opts(['present','absent','unresolved','not_applicable','review_pending'],filters.status,{empty:'All results'})+
      '</select></label>'+button('page-filter','Apply',{key:'assessmentCells'})+'</div>'+
      table([{title:'Source field',render:(r)=>button('cell-view',r.label??r.fieldKey,{careplan:r.carePlanId,field:r.fieldKey},'link')},
        {title:'CarePlan',render:r=>html(short(r.carePlanId))},{title:'Result',render:r=>badge(r.status)},
        {title:'Original values',render:r=>html(r.values?.length??0)},{title:'Reference findings',render:r=>html(r.unresolved?.length??0)},
        {title:'Review',render:r=>badge(r.reviewStatus)}],rowsOf(cells))+pager('assessmentCells',cells)):'')+
    panel('Record an explicit decision',renderForm('decision','decision','decision-save','Save decision',{
      assessmentId:state.selected.assessment??null,editionIds:state.selected.edition?[state.selected.edition]:[]}))+
    panel('Original saved decisions',savedTable('decisions','open-decision',[{title:'Kind',key:'kind'},{title:'Outcome',render:r=>badge(r.outcome)},
      {title:'Actor',key:'actor'},{title:'Reason',key:'reason'}]));
}
function viewCorrections(){
  const preview=state.correctionPreview;
  return pageTitle('Corrections and editions','Author precise changes to original resource records, inspect the preview, and retain a complete successor edition.')+
    panel('Prepare an exact correction',renderForm('correction','correction','correction-preview','Preview correction',{
      editionId:state.selected.edition??'',label:'Care-plan correction'}))+
    (preview?panel('Selected correction preview',table([{title:'Original record',key:'recordId',id:true},{title:'Path',render:r=>html(r.pointer??JSON.stringify(r.path))},
      {title:'Before',render:r=>'<pre>'+html(r.beforeJson??r.beforeJsonText??pretty(r.before))+'</pre>'},
      {title:'After',render:r=>'<pre>'+html(r.afterJson??r.afterJsonText??pretty(r.after))+'</pre>'}],preview.changes??[])+
      details('Frozen original correction request',preview)+'<div class="actions">'+button('correction-apply','Apply this exact preview',{id:preview.id,sha:preview.requestSha256},'primary')+'</div>'):'')+
    panel('Saved successor editions',savedTable('corrections','open-correction',[{title:'Actor',key:'actor'},{title:'Reason',key:'reason'},
      {title:'Created',key:'createdAt'}]))+
    panel('Compare complete CarePlan editions',renderForm('editionComparison','editionComparison','edition-compare','Compare editions'))+
    panel('Saved edition comparisons',selectControl('editionComparison',collection('editionComparisons'),state.selected.editionComparison,'Edition comparison')+
      (state.data.editionComparison?details('Complete edition comparison',state.data.editionComparison)+'<div class="actions">'+button('download-edition-comparison','Download complete edition changes',{id:state.selected.editionComparison})+'</div>'+
        table([{title:'Change',render:r=>badge(r.kind??r.type)},{title:'Original identity',render:r=>html(r.identity??r.recordId??r.beforeRecordId??'')},
          {title:'Exact change',render:r=>details('Changed values and original locations',r)}],rowsOf(state.data.editionChanges))+
        pager('editionChanges',state.data.editionChanges):''));
}
function nativeResult(value){
  const response=value?.response??value;let body=response?.body??response;
  if(typeof body==='string')body=JSON.parse(body);
  if(response?.status>=400)throw new Error(body?.message??body?.error?.message??body?.error??'Native dataset HTTP '+response.status);
  return body;
}
function nativeRows(value){
  const body=nativeResult(value);return body?.data??body?.rows??body?.results??[];
}
function viewDatasets(){
  const mapping=state.mapping,build=state.data.build,q=state.data.nativeQuery;
  return pageTitle('Native datasets','Project selected resource fields through the original dataset engine, save the full mapping and receive complete queryable datasets.')+
    panel('Prepare a source mapping',renderForm('mappingSelection','mappingSelection','mapping-create','Prepare native mapping',{
      sourceId:state.selected.source??'',resourceType:'CarePlan',name:'CarePlan dataset'}))+
    (mapping?panel('Review the complete mapping','<label class="wide">Complete native mapping<textarea class="code mapping-editor" data-mapping>'+html(
      typeof mapping==='string'?mapping:pretty(mapping))+'</textarea></label><div class="actions">'+button('mapping-preview','Preview projected rows')+
      button('mapping-save','Save native plan',{},'primary')+'</div>'+
      (state.data.mappingPreview?table((state.data.mappingPreview.columns??[]).map(c=>({title:typeof c==='string'?c:c.name,key:typeof c==='string'?c:c.name})),
        state.data.mappingPreview.rows??[])+details('Full native preview',state.data.mappingPreview):'')):'')+
    panel('Saved mapping and native build',selectControl('plan',collection('plans').map(p=>({...p,label:p.name??p.label??p.id})),state.selected.plan,'Saved plan')+
      '<div class="actions">'+button('plan-open','Open complete mapping')+button('build-create','Build selected source and plan',{},'primary')+'</div>'+
      details('Selected source',{sourceId:state.selected.source??state.forms.mappingSelection?.sourceId,planId:state.selected.plan}))+
    panel('Complete native datasets',selectControl('build',collection('builds').map(b=>({...b,label:b.name??b.label??b.id})),state.selected.build,'Native dataset')+
      (build?details('Original native build',build)+'<div class="actions">'+button('download-dataset','Download complete dataset',{id:build.id})+
        button('download-packet','Download original customer packet',{id:build.id})+'</div>'+
        renderForm('nativeQuery','nativeQuery','native-query','Run native query',{},'<p class="help">Conditions use declared native filter and range columns. Fields and sort use the original saved plan.</p>')+
        (q?'<p>'+html(nativeResult(q.result)?.page?.total??nativeRows(q.result).length)+' matching rows</p>'+
          table(Object.keys(nativeRows(q.result)[0]??{}).map(k=>({title:k,render:r=>html(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])})),nativeRows(q.result))+
          '<div class="actions">'+button('query-previous','Previous page')+button('query-next','Next page')+
          button('query-save','Download exact query result')+'</div>'+details('Original query parameters and response',q):''):'') )+
    panel('Compare original native builds',renderForm('buildComparison','buildComparison','build-compare','Compare builds')+
      selectControl('comparison',collection('comparisons'),state.selected.comparison,'Native comparison')+
      (state.data.comparisonChanges?table([{title:'Complete native change',render:r=>details(r.kind??r.type??'Change',r)}],rowsOf(state.data.comparisonChanges))+
        pager('comparisonChanges',state.data.comparisonChanges)+'<div class="actions">'+button('download-comparison','Download complete changes',{id:state.selected.comparison})+'</div>':''));
}
function viewDelivery(){
  const handoff=state.data.handoff;
  return pageTitle('Delivery and receiving','Prepare the complete selected source and field review, receive an original handoff, and link actual destination results to the same operation.')+
    panel('Prepare a complete CarePlan handoff',renderForm('handoff','handoff','handoff-create','Prepare full handoff',{
      editionId:state.selected.edition??'',reviewSetId:state.selected.reviewSet??'',assessmentId:state.selected.assessment??'',scope:'connected'}))+
    panel('Saved complete handoffs',selectControl('handoff',collection('handoffs'),state.selected.handoff,'Complete handoff')+
      (handoff?details('Original full handoff',handoff)+'<div class="actions">'+button('download-handoff','Download complete handoff',{id:handoff.id},'primary')+'</div>':''))+
    '<div class="two-column">'+panel('Receive a complete handoff',uploadForm('handoff-upload',{accept:'.zip',title:'Complete care-plan handoff',
      help:'Reopen its original source, graph, field review and selected edition in this workspace.'}))+
      panel('Receive a native customer packet',uploadForm('packet-upload',{accept:'.zip',title:'Original dataset customer packet',
        help:'Restore the complete original source, saved plan and native dataset.'}))+'</div>'+
    panel('Retain the actual downstream result',uploadForm('artifact-upload',{accept:'',title:'Original result or attachment',labelName:'Result label'}))+
    panel('Record actual receiving',renderForm('receiving','receiving','receiving-save','Save original receiving result',{
      handoffId:state.selected.handoff??'',operationId:crypto.randomUUID()}))+
    panel('Receiving history',savedTable('receivings','open-receiving',[{title:'Receiver',key:'receiver'},{title:'State',render:r=>badge(r.state)},
      {title:'Destination',key:'destinationObjectId'},{title:'Original operation',key:'operationId',id:true}]))+
    panel('Original retained attachments',savedTable('artifacts','download-artifact',[{title:'Type',key:'contentType'},{title:'Bytes',render:r=>html(bytes(r.bytes))}]))+
    '<div class="two-column">'+panel('Whole editable workspace','<p>Receive all original sources, editions, reviews, requests, operations, datasets and downstream results.</p>'+
      '<div class="actions">'+button('download-workspace','Download complete editable workspace',{},'primary')+'</div>')+
      panel('Restore an editable workspace',uploadForm('workspace-upload',{accept:'.zip',title:'Complete editable workspace',
        help:'Restore into a fresh native workspace. The complete transfer retains its original workspace identity and operation history.'}))+'</div>';
}
function render(){
  if(!state.workspace||!state.catalogue)return;
  const renderers={overview:viewOverview,sources:viewSources,acquisition:viewAcquisition,careplans:viewCarePlans,requirements:viewRequirements,
    review:viewReview,corrections:viewCorrections,datasets:viewDatasets,delivery:viewDelivery};
  $('#content').innerHTML=renderers[state.view]();
  const identities=new Map();
  for(const row of [...(state.data.graph?.carePlans??[]),...rowsOf(state.data.graphNodes),...rowsOf(state.data.sourceRows)])
    if(row.recordId)identities.set(row.recordId,row.resourceType+'/'+(row.id??short(row.recordId)));
  $('#content').insertAdjacentHTML('beforeend','<datalist id="record-identities">'+[...identities].map(([id,name])=>'<option value="'+html(id)+'">'+html(name)+'</option>').join('')+'</datalist>');
  $$('[data-view]').forEach(node=>node.setAttribute('aria-current',node.dataset.view===state.view?'page':'false'));
  $('#section-title').textContent=views[state.view];
}

const pageDefinitions={
  sourceRows:{base:()=>state.selected.source?path('sources',state.selected.source,'rows'):null},
  graphNodes:{base:()=>state.data.graph?path('graphs',state.data.graph.id,'nodes'):null},
  graphEdges:{base:()=>state.data.graph?path('graphs',state.data.graph.id,'edges'):null},
  assessmentCells:{base:()=>state.selected.assessment?path('assessments',state.selected.assessment,'cells'):null},
  editionChanges:{base:()=>state.selected.editionComparison?path('edition-comparisons',state.selected.editionComparison,'changes'):null},
  comparisonChanges:{base:()=>state.selected.comparison?path('comparisons',state.selected.comparison,'changes'):null}
};
async function loadPage(key,{reset=false,offset}={}){
  const definition=pageDefinitions[key],base=definition?.base();if(!base)return;
  if(reset||!state.pages[key]||state.pages[key].base!==base)state.pages[key]={base,offset:0,history:[],generation:0};
  const page=state.pages[key];if(offset!==undefined)page.offset=offset;
  const generation=++page.generation,parameters={offset:String(page.offset),limit:'50'};
  for(const [name,value] of Object.entries(state.filters[key]??{}))if(value!==''&&value!==null&&value!==undefined)parameters[name]=String(value);
  const value=await api(base+'?'+new URLSearchParams(parameters));
  if(state.pages[key]===page&&generation===page.generation&&definition.base()===base)state.data[key]=value;
  return value;
}
async function loadSource(id){
  state.selected.source=id;delete state.data.source;delete state.data.sourceMembers;delete state.data.sourceRows;
  if(state.data.graph&&state.data.graph.sourceId!==id){
    delete state.data.graph;delete state.data.graphNodes;delete state.data.graphEdges;
  }
  if(state.data.edition&&state.data.edition.sourceId!==id){
    state.selected.edition='';delete state.data.edition;
  }
  if(!id)return;
  const [source,members]=await Promise.all([api(path('sources',id)),api(path('sources',id,'members'))]);
  if(state.selected.source!==id)return;
  state.data.source=source;state.data.sourceMembers=members.members??members;
  await loadPage('sourceRows',{reset:true});
}
async function loadGraph(graph){
  state.data.graphsBySource??={};state.data.graphsBySource[graph.sourceId]=graph;
  state.data.graph=graph;
  if(state.selected.source!==graph.sourceId||state.data.source?.id!==graph.sourceId)await loadSource(graph.sourceId);
  if(state.data.graph!==graph||state.selected.source!==graph.sourceId)return;
  await Promise.all([loadPage('graphNodes',{reset:true}),loadPage('graphEdges',{reset:true})]);
}
async function loadEdition(id){
  state.selected.edition=id;if(!id){delete state.data.edition;return;}
  const value=await api(path('editions',id));if(state.selected.edition!==id)return;
  state.data.edition=value;
  if(value.graphId){
    const graph=await api(path('graphs',value.graphId));if(state.selected.edition!==id)return;
    await loadGraph(graph);
  }else if(value.sourceId)await loadSource(value.sourceId);
}
async function loadProfile(id){
  state.selected.profile=id;if(!id){state.profile=null;return;}
  const value=await api(path('profiles',id));if(state.selected.profile===id)state.profile=value;
}
async function loadReview(id,{force=false}={}){
  if(state.selected.reviewSet&&state.forms.reviewSet){
    state.reviewDrafts??={};state.reviewDrafts[state.selected.reviewSet]=copy(state.forms.reviewSet);
  }
  state.selected.reviewSet=id;if(!id){delete state.forms.reviewSet;delete state.data.reviewSet;return;}
  const review=await api(path('review-sets',id));if(state.selected.reviewSet!==id)return;
  await loadProfile(review.profileId);if(state.selected.reviewSet!==id)return;
  state.forms.reviewSet=!force&&state.reviewDrafts?.[id]?state.reviewDrafts[id]:{...copy(review),predecessorId:id};
  state.data.reviewSet=review;state.activeField=Math.max(0,Math.min(state.activeField,review.fields.length-1));
}
async function loadAssessment(id){
  state.selected.assessment=id;if(!id){delete state.data.assessment;delete state.data.assessmentCells;return;}
  const value=await api(path('assessments',id));if(state.selected.assessment!==id)return;
  state.data.assessment=value;
  const editionId=value.editionId??findRecord('assessments',id)?.editionId;
  if(editionId){await loadEdition(editionId);if(state.selected.assessment!==id)return;}
  const reviewId=value.reviewSetId??findRecord('assessments',id)?.reviewSetId;
  if(reviewId){await loadReview(reviewId);if(state.selected.assessment!==id)return;}
  await loadPage('assessmentCells',{reset:true});
}
async function loadOperation(id){
  state.selected.operation=id;if(!id){delete state.data.operation;return;}
  const generation=++state.requestGeneration;
  const value=await api(path('operations',id));
  if(state.selected.operation!==id||generation!==state.requestGeneration)return;
  state.data.operation=value;
  if(value.requestId&&state.selected.request!==value.requestId){
    const requestId=value.requestId;state.selected.request=requestId;
    const selectedRequest=await api(path('requests',requestId));
    if(state.selected.operation===id&&state.selected.request===requestId&&generation===state.requestGeneration)
      state.data.request=selectedRequest;
  }
}
async function loadRequest(id){
  state.selected.request=id;if(!id){delete state.data.request;return;}
  const value=await api(path('requests',id));if(state.selected.request!==id)return;
  state.data.request=value;
  const prior=collection('operations').filter(op=>op.requestId===id).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')).at(-1);
  if(prior)await loadOperation(prior.operationId);
  else{state.selected.operation=crypto.randomUUID();state.requestGeneration++;delete state.data.operation;}
}
async function loadBuild(id){
  state.selected.build=id;delete state.data.build;delete state.data.nativeQuery;state.queryHistory=[];state.queryCursor='';
  if(!id)return;
  const build=await api(path('builds',id));if(state.selected.build!==id)return;
  state.data.build=build;
  const planId=build.planId??build.plan;
  if(planId&&typeof planId==='string'){
    state.selected.plan=planId;const plan=await api(path('plans',planId));
    if(state.selected.build===id&&state.selected.plan===planId)state.data.plan=plan;
  }
}
async function loadSelection(key,id){
  if(key==='source')return loadSource(id);
  if(key==='profile')return loadProfile(id);
  if(key==='reviewSet')return loadReview(id);
  if(key==='edition')return loadEdition(id);
  if(key==='assessment')return loadAssessment(id);
  if(key==='operation')return loadOperation(id);
  if(key==='request')return loadRequest(id);
  if(key==='build')return loadBuild(id);
  state.selected[key]=id;
  const routes={connection:'connections',handoff:'handoffs',editionComparison:'edition-comparisons'};
  if(routes[key]){
    const value=id?await api(path(routes[key],id)):null;if(state.selected[key]!==id)return;
    state.data[key]=value;
  }
  if(key==='editionComparison'&&id)await loadPage('editionChanges',{reset:true});
  if(key==='comparison'&&id)await loadPage('comparisonChanges',{reset:true});
  if(key==='connection'&&id){
    const discovery=collection('discoveries').filter(r=>r.connectionId===id).at(-1);
    const value=discovery?await api(path('discoveries',discovery.id)):null;if(state.selected.connection!==id)return;
    state.data.discovery=value;state.forms.request??=defaults(state.catalogue.schemas.request.fields);
    state.forms.request.connectionId=id;state.forms.request.discoveryId=discovery?.id??'';
  }
}
async function ensureFormGraph(form){
  const draft=state.forms[form],edition=findRecord('editions',draft?.editionId);
  if(form==='edition'&&draft?.sourceId&&!state.data.graphsBySource?.[draft.sourceId]){
    const graph=await api(path('sources',draft.sourceId,'graph'),{referencePolicy:draft.referencePolicy??'bundle',
      baseUrl:draft.baseUrl??'',decisionIds:draft.decisionIds??[]});
    state.data.graphsBySource??={};state.data.graphsBySource[graph.sourceId]=graph;
  }
  if(edition?.graphId){
    const graph=state.data.graphsBySource?.[edition.sourceId]??await api(path('graphs',edition.graphId));
    state.data.graphsBySource??={};state.data.graphsBySource[edition.sourceId]=graph;
  }
}
function currentMapping(){
  const value=typeof state.mapping==='string'?JSON.parse(state.mapping):copy(state.mapping);
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('The complete native mapping must be a JSON object.');
  return value;
}
function nativeQueryParameters({cursor=state.queryCursor??''}={}){
  const query=submitted('nativeQuery','nativeQuery'),parameters={};
  for(const condition of query.conditions??[]){
    if(!condition.column)throw new Error('Select a declared query column for each condition.');
    const name=condition.operator+'.'+condition.column;if(Object.hasOwn(parameters,name))throw new Error('Repeated native query parameter '+name+'.');
    parameters[name]=String(condition.value??'');
  }
  if(query.fields?.length)parameters.fields=query.fields.join(',');
  if(query.sort)parameters.sort=query.sort;
  parameters.limit=String(query.limit??25);if(cursor)parameters.cursor=cursor;
  return parameters;
}
async function runNativeQuery(){
  const buildId=state.selected.build;if(!buildId)throw new Error('Select a saved native dataset.');
  const parameters=nativeQueryParameters(),generation=(state.queryGeneration??0)+1;state.queryGeneration=generation;
  const result=await api(path('builds',buildId,'query')+'?'+new URLSearchParams(parameters));nativeResult(result);
  if(state.selected.build===buildId&&state.queryGeneration===generation)
    state.data.nativeQuery={buildId,parameters,result};
  return result;
}
function stopAutomatic(){
  if(state.auto?.timer)clearTimeout(state.auto.timer);state.auto=null;
}
function queueAutomatic(run){
  if(state.auto!==run)return;
  const op=state.data.operation;
  if(op?.operationId!==run.operationId){stopAutomatic();return;}
  if(['complete','paused','failed'].includes(op.state)){stopAutomatic();notice('Original acquisition '+op.state+'.');return;}
  const notBefore=op.notBefore?Date.parse(op.notBefore):0,delay=Number.isFinite(notBefore)?Math.max(0,notBefore-Date.now()):0;
  run.timer=setTimeout(async()=>{
    if(state.auto!==run)return;
    if(notBefore>Date.now()){queueAutomatic(run);return;}
    try{
      await perform(async()=>{
        await api(path('requests',run.requestId,'advance'),{operationId:run.operationId});
        await loadOperation(run.operationId);
      },{success:()=>state.data.operation?.state==='complete'?'Complete original acquisition received.':'Received original acquisition response.'});
      queueAutomatic(run);
    }catch{stopAutomatic();}
  },Math.min(delay||50,60000));
}
async function runOperation({continuous=false,resume=false}={}){
  const requestId=state.selected.request,operationId=state.selected.operation;
  if(!requestId||!operationId)throw new Error('Select the original request and operation identity.');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(operationId))throw new Error('Use a 1–96 character native operation identity.');
  if(state.auto)stopAutomatic();
  if(resume)await api(path('operations',operationId,'resume'),{});
  await api(path('requests',requestId,'advance'),{operationId});await loadOperation(operationId);
  if(continuous){const run={requestId,operationId,timer:null};state.auto=run;queueAutomatic(run);}
}
async function saveJSON(filename,value){
  const blob=new Blob([pretty(value)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function navigation(view){
  if(!views[view])return;state.view=view;clearError();render();$('#content').focus({preventScroll:true});
}
async function selectContextSource(id){
  await loadSource(id);if(state.selected.source!==id)return;
  state.forms.graphSelection={...defaults(state.catalogue.schemas.graphSelection.fields),sourceId:id};
  state.forms.mappingSelection={...defaults(state.catalogue.schemas.mappingSelection.fields),sourceId:id,resourceType:'CarePlan',name:'CarePlan dataset'};
}
async function formSubmit(action,name,schemaKey){
  const body=submitted(name,schemaKey);
  const plain={ 'connection-save':['connections','connection'],'request-save':['requests','request'],'edition-save':['editions','edition'],
    'decision-save':['decisions','decision'],'handoff-create':['handoffs','handoff'],'receiving-save':['receivings','receiving']};
  if(plain[action]){
    const [route,key]=plain[action],saved=await api(path(route),body);await refreshWorkspace();
    if(['connection','request','edition','handoff'].includes(key))await loadSelection(key,saved.id);
    else state.data[key]=saved;
    if(key==='edition'){state.selected.edition=saved.id;state.forms.assessment={...defaults(state.catalogue.schemas.assessment.fields),editionId:saved.id,
      reviewSetId:state.selected.reviewSet??'',label:'Care-plan field assessment'};}
    if(key==='receiving')state.forms.receiving={...copy(body),operationId:crypto.randomUUID(),correctionOf:saved.id};
    notice('Saved complete '+label(key)+' '+short(saved.id)+'.');return saved;
  }
  if(action==='graph-build'){
    const {sourceId,...request}=body,graph=await api(path('sources',sourceId,'graph'),request);
    await loadGraph(graph);state.forms.edition={...defaults(state.catalogue.schemas.edition.fields),sourceId,referencePolicy:body.referencePolicy,
      baseUrl:body.baseUrl??'',decisionIds:body.decisionIds??[],label:'Care-plan edition',carePlanIds:(graph.carePlans??[]).map(r=>r.recordId)};
    notice('Built original reference view.');return graph;
  }
  if(action==='profile-adopt'){
    const saved=await api(path('review-sets','profile'),body);await refreshWorkspace();await loadReview(saved.id,{force:true});
    notice('Adopted all '+state.forms.reviewSet.fields.length+' published fields.');return saved;
  }
  if(action==='review-save'){
    const original=new Set(state.profile.fields.map(f=>f.key??f.fieldKey)),selected=new Set(body.fields.map(f=>f.fieldKey));
    if(body.fields.length!==original.size||selected.size!==original.size||[...selected].some(k=>!original.has(k)))
      throw new Error('Retain exactly one review for every published field.');
    const saved=await api(path('review-sets'),body);await refreshWorkspace();await loadReview(saved.id,{force:true});
    notice('Saved the complete field review.');return saved;
  }
  if(action==='assessment-create'){
    const value=await api(path('assessments'),body);await refreshWorkspace();await loadAssessment(value.id);
    notice('Completed every selected CarePlan field assessment.');return value;
  }
  if(action==='correction-preview'){
    const value=await api(path('corrections','preview'),body);state.correctionPreview=value;
    notice('Review the complete preview before applying its saved request.');return value;
  }
  if(action==='edition-compare'){
    const value=await api(path('edition-comparisons'),body);await refreshWorkspace();await loadSelection('editionComparison',value.id);
    notice('Compared the complete editions.');return value;
  }
  if(action==='mapping-create'){
    const {sourceId,...request}=body;state.selected.source=sourceId;state.mapping=await api(path('sources',sourceId,'mapping'),request);
    delete state.data.mappingPreview;notice('Prepared the original native mapping.');return state.mapping;
  }
  if(action==='native-query'){state.queryCursor='';state.queryHistory=[];return runNativeQuery();}
  if(action==='build-compare'){
    const value=await api(path('comparisons'),body);await refreshWorkspace();await loadSelection('comparison',value.id);
    notice('Compared complete native builds.');return value;
  }
  throw new Error('Unknown form action '+action+'.');
}
async function upload(action,form){
  const file=form.elements.file?.files?.[0];if(!file)throw new Error('Choose the complete original file.');
  const title=form.elements.label?.value||file.name,
    routes={'source-upload':'sources','artifact-upload':'artifacts','handoff-upload':'handoffs/receive','packet-upload':'packets','workspace-upload':'workspace/packet'},
    route=routes[action];
  if(!route)throw new Error('Unknown original receiving action.');
  const maximum=action==='source-upload'?state.catalogue.limits.sourceBytes:state.catalogue.limits.workspaceBytes;
  if(file.size>maximum)throw new Error('This complete input is '+bytes(file.size)+'; the receiving limit is '+bytes(maximum)+'.');
  const prefix=action==='artifact-upload'?'Artifact':'Source';
  const response=await request('/api/'+route,{method:'POST',body:file,raw:true,headers:{'Content-Type':'application/octet-stream',
    ['X-'+prefix+'-Name']:encodeURIComponent(file.name),['X-'+prefix+'-Label']:encodeURIComponent(title),
    ...(action==='artifact-upload'?{'X-Artifact-Content-Type':file.type||'application/octet-stream'}:{})}});
  const saved=await response.json();await refreshWorkspace();
  if(action==='source-upload'){await selectContextSource(saved.id);state.view='sources';}
  if(action==='artifact-upload'){
    state.forms.receiving??=defaults(state.catalogue.schemas.receiving.fields);state.forms.receiving.artifactId=saved.id;
    notice('Retained the complete original result '+short(saved.id)+'.');
  }else if(action==='workspace-upload'){
    stopAutomatic();state.selected={};state.data={};state.forms={};state.pages={};state.reviewDrafts={};state.mapping=null;state.correctionPreview=null;
    const profileId=state.catalogue.profiles?.[0]?.id;if(profileId)await loadProfile(profileId);
    state.view='overview';notice('Restored complete editable workspace '+state.workspace.workspaceId+'.');
  }else if(action!=='source-upload')recordDialog('Complete receiving result',saved);
  return saved;
}
const viewRecordRoutes={ 'open-decision':'decisions','open-correction':'corrections','open-receiving':'receivings' };
async function handleAction(action,data){
  if(action==='close-record'){$('#record-dialog').close();return;}
  if(action==='navigate'){navigation(data.view);return;}
  if(action==='form-add'||action==='form-remove'){
    const keys=fromPath(data.path),draft=state.forms[data.form],items=at(draft,keys)??[];
    if(action==='form-add'){const schema=JSON.parse(decodeURIComponent(data.schema));items.push(defaults(schema.fields));}
    else items.splice(Number(data.index),1);
    setAt(draft,keys,items);render();return;
  }
  if(action==='field-select'||action==='field-next'||action==='field-previous'){
    const count=state.forms.reviewSet?.fields?.length??0;if(!count)return;
    state.activeField=action==='field-select'?Number(data.index):Math.min(count-1,Math.max(0,state.activeField+(action==='field-next'?1:-1)));
    render();return;
  }
  if(action==='page-filter'){await loadPage(data.key,{reset:true});return;}
  if(action==='page-next'){
    const current=state.data[data.key],page=state.pages[data.key];if(!page||current?.nextOffset===null||current?.nextOffset===undefined)return;
    page.history.push(page.offset);await loadPage(data.key,{offset:current.nextOffset});return;
  }
  if(action==='page-previous'){
    const page=state.pages[data.key];if(!page?.history.length)return;await loadPage(data.key,{offset:page.history.pop()});return;
  }
  if(action==='source-row'){
    const row=await api(path('sources',state.selected.source,'rows',data.id));recordDialog(row.resourceType+'/'+row.id,row,
      '<pre>'+html(row.jsonText??'')+'</pre><div class="actions">'+button('record-to-correction','Use this record in a correction',{id:row.recordId})+'</div>');return;
  }
  if(action==='graph-node'){
    const node=await api(path('graphs',state.data.graph.id,'nodes',data.id)),resource=node.resource;
    recordDialog(resource.resourceType+'/'+resource.id,node,'<pre>'+html(resource.jsonText??'')+'</pre><div class="actions">'+
      button('record-to-correction','Use this record in a correction',{id:resource.recordId})+'</div>');return;
  }
  if(action==='edge-view'){
    const edge=rowsOf(state.data.graphEdges).find(r=>r.id===data.id);
    recordDialog('Original reference',edge,'<div class="actions">'+button('edge-to-decision','Record a decision',{id:data.id})+'</div>');return;
  }
  if(action==='cell-view'){
    const cell=rowsOf(state.data.assessmentCells).find(r=>r.carePlanId===data.careplan&&r.fieldKey===data.field);
    recordDialog(cell?.label??data.field,cell,table([{title:'Exact source value',render:r=>'<pre>'+html(r.jsonText??r.originalJsonText??pretty(r))+'</pre>'},
      {title:'Original record and pointer',render:r=>details('Source location',r)}],cell?.values??[]));return;
  }
  if(viewRecordRoutes[action]){
    let value;
    if(action==='open-correction')value=findRecord('corrections',data.id);
    else value=await api(path(viewRecordRoutes[action],data.id));
    recordDialog(label(action.replace('open-','')),value);return;
  }
  if(action==='source-to-careplans'||action==='source-to-datasets'){
    await selectContextSource(data.id);state.view=action==='source-to-careplans'?'careplans':'datasets';return;
  }
  if(action==='connection-discover'){
    if(!state.selected.connection)throw new Error('Select a saved source connection.');
    state.data.discovery=await api(path('connections',state.selected.connection,'discover'),{});
    state.forms.request??=defaults(state.catalogue.schemas.request.fields);
    state.forms.request.connectionId=state.selected.connection;state.forms.request.discoveryId=state.data.discovery.id;
    return;
  }
  if(action==='operation-new'){
    stopAutomatic();state.selected.operation=crypto.randomUUID();delete state.data.operation;render();return;
  }
  if(action==='operation-run'||action==='operation-step'||action==='operation-resume')
    return runOperation({continuous:action!=='operation-step',resume:action==='operation-resume'});
  if(action==='operation-pause'){
    stopAutomatic();if(!state.selected.operation)throw new Error('Select the original operation.');
    await api(path('operations',state.selected.operation,'pause'),{});return loadOperation(state.selected.operation);
  }
  if(action==='operation-refresh')return loadOperation(state.selected.operation);
  if(action==='operation-source'){await selectContextSource(data.id);state.view='sources';return;}
  if(action==='open-operation'){await loadOperation(data.id);state.view='acquisition';return;}
  if(action==='open-edition'){await loadEdition(data.id);state.view='careplans';return;}
  if(action==='open-review-set'){await loadReview(data.id);state.view='requirements';return;}
  if(action==='edition-to-assessment'){
    state.selected.edition=data.id;state.forms.assessment={...defaults(state.catalogue.schemas.assessment.fields),editionId:data.id,
      reviewSetId:state.selected.reviewSet??'',label:'Care-plan field assessment'};state.view='review';return;
  }
  if(action==='edition-to-correction'){
    state.selected.edition=data.id;state.forms.correction={...defaults(state.catalogue.schemas.correction.fields),editionId:data.id,label:'Care-plan correction'};
    state.view='corrections';return;
  }
  if(action==='record-to-correction'){
    state.forms.correction??={...defaults(state.catalogue.schemas.correction.fields),editionId:state.selected.edition??'',label:'Care-plan correction'};
    const fields=state.catalogue.schemas.correction.fields.patches.fields;
    state.forms.correction.patches??=[];state.forms.correction.patches.push({...defaults(fields),recordId:data.id,path:[],action:'replace'});
    $('#record-dialog').close();state.view='corrections';return;
  }
  if(action==='edge-to-decision'){
    const edge=rowsOf(state.data.graphEdges).find(r=>r.id===data.id);
    state.forms.decision={...defaults(state.catalogue.schemas.decision.fields),kind:'reference',outcome:'resolved',edgeId:data.id,
      editionIds:state.selected.edition?[state.selected.edition]:[],sourceRefs:[{sourceId:state.data.graph.sourceId,recordId:edge.fromRecordId,pointer:edge.pointer}]};
    $('#record-dialog').close();state.view='review';return;
  }
  if(action==='correction-apply'){
    const preview=state.correctionPreview;
    if(!preview||preview.id!==data.id||preview.requestSha256!==data.sha)throw new Error('Select the complete current correction preview.');
    const value=await api(path('corrections'),{previewId:preview.id,expectedRequestSha256:preview.requestSha256});
    await refreshWorkspace();if(value.editionId)await loadEdition(value.editionId);state.correctionPreview=null;
    recordDialog('Saved successor edition',value);notice('Applied the exact saved preview and retained the original source.');return value;
  }
  if(action==='mapping-preview'){
    if(!state.selected.source)throw new Error('Select the original source.');
    state.data.mappingPreview=await api(path('sources',state.selected.source,'preview'),{plan:currentMapping(),limit:25});return;
  }
  if(action==='mapping-save'){
    const value=await api(path('plans'),currentMapping());state.selected.plan=value.id;state.data.plan=value;
    notice('Saved complete native plan '+short(value.id)+'.');return value;
  }
  if(action==='plan-open'){
    if(!state.selected.plan)throw new Error('Select a saved plan.');
    const value=await api(path('plans',state.selected.plan));state.data.plan=value;state.mapping=value.plan;return;
  }
  if(action==='build-create'){
    if(!state.selected.source||!state.selected.plan)throw new Error('Select the original source and saved plan.');
    const value=await api(path('builds'),{sourceId:state.selected.source,planId:state.selected.plan});
    await refreshWorkspace();await loadBuild(value.id);return value;
  }
  if(action==='query-next'){
    const body=state.data.nativeQuery&&nativeResult(state.data.nativeQuery.result),next=body?.page?.nextCursor??body?.page?.next_cursor??body?.nextCursor;
    if(!next)return;state.queryHistory??=[];state.queryHistory.push(state.queryCursor??'');state.queryCursor=next;return runNativeQuery();
  }
  if(action==='query-previous'){
    if(!state.queryHistory?.length)return;state.queryCursor=state.queryHistory.pop();return runNativeQuery();
  }
  if(action==='query-save')return saveJSON('eltss-original-native-query.json',state.data.nativeQuery);
  const downloads={
    'download-assessment':()=>[path('assessments',data.id,'file'),'eltss-complete-assessment-'+data.id+'.jsonl'],
    'download-edition-comparison':()=>[path('edition-comparisons',data.id,'file'),'eltss-complete-edition-changes-'+data.id+'.jsonl'],
    'download-source':()=>[path('sources',data.id,'packet'),(findRecord('sources',data.id)?.name??'eltss-original-source.bin')],
    'download-source-member':()=>[path('sources',data.id,'files',data.member),data.member.split('/').at(-1)],
    'download-dataset':()=>[path('builds',data.id,'dataset'),'eltss-native-dataset-'+data.id+'.zip'],
    'download-packet':()=>[path('builds',data.id,'packet'),'eltss-customer-packet-'+data.id+'.zip'],
    'download-comparison':()=>[path('comparisons',data.id,'file'),'eltss-native-changes-'+data.id+'.jsonl'],
    'download-handoff':()=>[path('handoffs',data.id,'packet'),'eltss-complete-handoff-'+data.id+'.zip'],
    'download-workspace':()=>[path('workspace','packet'),'eltss-editable-workspace-'+state.workspace.workspaceId+'.zip'],
    'download-artifact':()=>[path('artifacts',data.id,'file'),findRecord('artifacts',data.id)?.name??'eltss-original-result.bin']
  };
  if(downloads[action])return download(...downloads[action]());
  if(action==='refresh'){await refreshWorkspace();if(state.selected.operation&&state.view==='acquisition')await loadOperation(state.selected.operation);return;}
  throw new Error('Unknown operator action '+action+'.');
}
function readControl(node){
  if(node.type==='checkbox')return node.checked;
  if(node.multiple)return [...node.selectedOptions].map(option=>option.value);
  if(node.dataset.type==='integer'){
    if(node.value==='')return undefined;const value=Number(node.value);
    if(!Number.isSafeInteger(value))throw new Error('Enter an exact whole number.');return value;
  }
  if(node.dataset.type==='string-list')return node.value.split(/\r?\n/).filter(value=>value!=='');
  return node.value;
}
document.addEventListener('input',event=>{
  const node=event.target;
  if(node.dataset.form){
    try{setAt(state.forms[node.dataset.form],fromPath(node.dataset.path),readControl(node));}
    catch(error){errorView(error);}
  }
  if(node.dataset.filter){state.filters[node.dataset.filter]??={};state.filters[node.dataset.filter][node.dataset.property]=node.value;}
  if(node.hasAttribute('data-mapping'))state.mapping=node.value;
  if(node.hasAttribute('data-operation-id'))state.selected.operation=node.value;
  if(node.dataset.uploadLabel)state.forms['upload:'+node.dataset.uploadLabel]=node.value;
});
document.addEventListener('change',event=>{
  const node=event.target;
  if(node.dataset.select){
    void perform(()=>loadSelection(node.dataset.select,node.value),{refresh:false}).catch(()=>{});return;
  }
  if(node.dataset.form&&['sourceId','editionId'].includes(fromPath(node.dataset.path).at(-1))){
    void perform(()=>ensureFormGraph(node.dataset.form),{refresh:false}).catch(()=>{});
  }
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(!form.dataset.submit&&!form.dataset.upload)return;
  event.preventDefault();
  void perform(()=>form.dataset.upload?upload(form.dataset.upload,form):formSubmit(form.dataset.submit,form.dataset.formName,form.dataset.schema)).catch(()=>{});
});
document.addEventListener('click',event=>{
  const buttonNode=event.target.closest('button');if(!buttonNode)return;
  if(buttonNode.dataset.view){navigation(buttonNode.dataset.view);return;}
  if(buttonNode.dataset.action){
    event.preventDefault();const {action,...data}=buttonNode.dataset;
    if(['form-add','form-remove','field-select','field-next','field-previous','navigate','operation-new','close-record'].includes(action)){
      void handleAction(action,data).catch(errorView);
    }else void perform(()=>handleAction(action,data),{refresh:!['page-next','page-previous','page-filter','source-row','graph-node','cell-view','edge-view',
      'query-next','query-previous','query-save'].includes(action)&&!action.startsWith('download-')}).catch(()=>{});
  }
});
async function boot(){
  markBusy();
  try{
    if(!token)throw new Error('Open the private operator address emitted by the original native workspace.');
    const [catalogue,auth]=await Promise.all([api(path('catalogue')),api(path('auth-profiles'))]);
    state.catalogue=catalogue;state.auth=auth;installUISchemas();await refreshWorkspace();
    if(catalogue.profiles?.[0])await loadProfile(catalogue.profiles[0].id);
    render();notice('Complete native eLTSS workspace ready.');
  }catch(error){errorView(error);}
  finally{unmarkBusy();}
}
window.addEventListener('beforeunload',()=>stopAutomatic());
void boot();
