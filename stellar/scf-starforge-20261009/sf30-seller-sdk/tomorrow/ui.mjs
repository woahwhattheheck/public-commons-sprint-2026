const $=id=>document.getElementById(id);
const arr=value=>Array.isArray(value)?value:(value&&typeof value==='object'?Object.values(value):[]);
const state={workspace:null,workId:null,editionId:null,detail:null,tab:'plan',review:null,retryReview:null,comparison:null,busy:false,csrf:null,intervalId:null,page:0,filter:'ALL',printing:false,operations:null,operationsKey:null,operationsScope:'workspace',operationsFilter:'ALL',operationsAssignee:'ALL',handoverScope:'current'};
const PREFIX='sf-tomorrow-operator:';
const volatileDrafts=new Map();
const storageScope=()=>state.workspace?.workspaceId||state.workspace?.id||null;
const storageKey=key=>{const scope=storageScope();return scope?PREFIX+scope+':'+key:null;};
const uid=kind=>kind+'-'+crypto.randomUUID();
const readLocal=key=>{const scoped=storageKey(key);if(!scoped)return volatileDrafts.get(key)||null;try{return JSON.parse(localStorage.getItem(scoped)||'null');}catch{return null;}};
const writeLocal=(key,value)=>{const scoped=storageKey(key);if(!scoped){if(value===null)volatileDrafts.delete(key);else volatileDrafts.set(key,value);return;}try{if(value===null)localStorage.removeItem(scoped);else localStorage.setItem(scoped,JSON.stringify(value));}catch{}};
function element(tag,attrs={},...children){
  const node=document.createElement(tag);
  for(const[key,value]of Object.entries(attrs)){
    if(value===null||value===undefined||value===false)continue;
    if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='class')node.className=value;
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(['value','checked','selected','disabled','required','hidden','readOnly','multiple'].includes(key))node[key]=value;
    else node.setAttribute(key,value===true?'':String(value));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
function notice(text,error=false){const node=$('notice');node.hidden=!text;node.textContent=text||'';node.className='notice'+(error?' error':'');}
function replaceContents(node,...children){node.replaceChildren(...children.filter(child=>child!==null&&child!==undefined&&child!==false));}
async function guard(fn){try{return await fn();}catch(error){notice(error.message||String(error),true);}}
function button(label,fn,{primary=false,mutate=false,disabled=false,small=false}={}){
  return element('button',{type:'button',class:(primary?'primary ':'')+(small?'small-button':''),disabled:disabled||(mutate&&state.busy),dataset:mutate?{mutate:'true',permitted:disabled?'no':'yes'}:{},onClick:()=>guard(fn)},label);
}
function setBusy(value,label){
  state.busy=value;$('main').setAttribute('aria-busy',String(value));
  document.querySelectorAll('[data-mutate="true"]').forEach(b=>{b.disabled=value||b.dataset.permitted==='no';});
  if(label)notice(label);
}
function field(label,input,help){
  if(!input.id)input.id=uid('field');
  return element('div',{class:'field'},element('label',{for:input.id},label),input,help?element('p',{class:'help'},help):null);
}
function input(name,value='',attrs={}){return element('input',{name,value:value??'',...attrs});}
function select(name,options,value,attrs={}){
  const node=element('select',{name,...attrs},options.map(option=>{
    const pair=Array.isArray(option)?option:[option,option];
    return element('option',{value:pair[0],selected:String(pair[0])===String(value)},pair[1]);
  }));
  return node;
}
function details(title,value){
  return element('details',{class:'details'},element('summary',{},title),element('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2)));
}
function badge(text,strong=false){return element('span',{class:'badge'+(strong?' badge-strong':'')},String(text||'—').replaceAll('_',' '));}
function table(headers,rows){
  return element('div',{class:'table-wrap'},element('table',{},element('thead',{},element('tr',{},headers.map(h=>element('th',{scope:'col'},h)))),element('tbody',{},rows)));
}
const receivedTime=edition=>edition?.resources?.timeline?.receivedAt||edition?.receivedAt||edition?.capturedAt||edition?.finishedAt||edition?.completedAt;
function sourceLine(edition,availability=edition?.rawAvailability){
  return element('div',{class:'source-strip'},element('a',{href:'https://www.tomorrow.io/',target:'_blank',rel:'noopener noreferrer'},'Powered by Tomorrow.io'),edition?.id?element('code',{},edition.id):null,availability?badge(availability):null);
}
const nativeUnits={temperature:{metric:'°C',imperial:'°F'},windSpeed:{metric:'m/s',imperial:'mph'},windGust:{metric:'m/s',imperial:'mph'},precipitationIntensity:{metric:'mm/hr',imperial:'in/hr'},precipitationProbability:{metric:'%',imperial:'%'},humidity:{metric:'%',imperial:'%'}};
function unitFor(name,units){const declared=state.workspace?.plan?.fieldUnits?.[name]??nativeUnits[name];return typeof declared==='string'?declared:(declared?.[units]??'');}
function formatValue(value,present=true){
  if(!present)return 'Missing';
  if(value===null)return 'Null';
  if(value===undefined)return 'Missing';
  if(typeof value==='number')return Number.isFinite(value)?String(value):'Missing';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}
function reading(value){
  if(value&&typeof value==='object'&&('present'in value||'value'in value))return formatValue(value.value,value.present!==false);
  return formatValue(value,value!==undefined);
}
const workList=()=>arr(state.workspace?.workOrders);
const editionList=()=>arr(state.workspace?.editions);
const currentWork=()=>workList().find(w=>w.id===state.workId);
const editionWorkId=e=>e.workId??e.workOrderId??e.work?.id;
const workEditions=()=>editionList().filter(e=>editionWorkId(e)===state.workId);
function selectedEdition(){return state.detail?.edition||editionList().find(e=>e.id===state.editionId);}
function savedDecision(intervalId){
  return arr(state.detail?.decisions).filter(d=>(!d.editionId||d.editionId===state.editionId)&&d.intervalId===intervalId).at(-1);
}
function pending(){return readLocal('pending');}
async function api(path,{method='GET',body}={}){
  const response=await fetch(path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf||''},body:body===undefined?undefined:JSON.stringify(body)});
  let result;
  try{result=await response.json();}catch{throw new Error('The server returned an unreadable response. Reopen the saved workspace to continue.');}
  if(!response.ok){
    if(response.status===401)showLogin(result.error?.message);
    const error=new Error(result.error?.message||result.message||'The operation could not be completed.');
    error.status=response.status;error.code=result.error?.code;
    throw error;
  }
  return result;
}
async function mutate(path,body,{label='Saving operation…',native=false,retain=true}={}){
  if(state.busy)throw new Error('The current operation is still running.');
  const operation={path,body,label,workId:state.workId,editionId:state.editionId,at:new Date().toISOString()};
  if(retain)writeLocal('pending',operation);
  setBusy(true,label);
  let timer,polling=false;
  if(native)timer=setInterval(()=>guard(async()=>{
    if(polling)return;polling=true;
    try{
      state.workspace=await api('/api/workspace');
      renderSidebar();
      const edition=editionList().find(e=>e.id===operation.editionId);
      if(edition)notice(label+' Saved state: '+edition.state+'.');
    }finally{polling=false;}
  }),1800);
  try{
    const result=await api(path,{method:'POST',body});
    if(retain)writeLocal('pending',null);
    notice('Operation saved.');
    return result;
  }catch(error){
    if(retain&&error.status>=400&&error.status<500)writeLocal('pending',null);
    if(native){
      try{
        state.workspace=await api('/api/workspace');
        if(state.editionId)state.detail=await api('/api/editions/'+encodeURIComponent(state.editionId));
        renderSidebar();render();
      }catch{}
    }
    throw error;
  }finally{
    if(timer)clearInterval(timer);
    setBusy(false);
  }
}
async function refresh({loadDetail=true}={}){
  state.workspace=await api('/api/workspace');
  if(state.workId&&!currentWork()){state.workId=null;state.editionId=null;}
  if(!state.workId&&workList().length)state.workId=workList()[0].id;
  const editions=workEditions();
  if(state.editionId&&!editions.some(e=>e.id===state.editionId))state.editionId=null;
  if(!state.editionId&&editions.length)state.editionId=editions.at(-1).id;
  if(loadDetail&&state.editionId)state.detail=await api('/api/editions/'+encodeURIComponent(state.editionId));
  else if(!state.editionId)state.detail=null;
  if(state.tab==='operations'&&state.workId){state.operations=await api(operationsPath());state.operationsKey=operationsKey();}
  renderSidebar();render();
}
function renderSidebar(){
  $('workspace-title').textContent=state.workspace?.title||'Weather workspace';
  $('work-count').textContent=workList().length;
  const query=$('work-filter').value.toLowerCase();
  const works=workList().filter(w=>(w.title+' '+(w.location?.label||'')).toLowerCase().includes(query));
  $('work-list').replaceChildren(...works.map(work=>element('button',{type:'button',class:'work-link'+(work.id===state.workId?' active':''),'aria-current':work.id===state.workId?'page':null,onClick:()=>guard(async()=>{
    state.workId=work.id;state.editionId=null;state.detail=null;state.review=null;state.comparison=null;state.intervalId=null;state.page=0;state.tab='plan';await refresh();
  })},element('strong',{},work.title||work.id),element('span',{},work.location?.label||[work.location?.latitude,work.location?.longitude].join(', ')),element('span',{},work.window?.startTime||''))));
  if(!works.length)$('work-list').append(element('p',{class:'small muted'},query?'No matching work plans.':'Create the first work plan.'));
  const usage=state.workspace?.plan?.usage;
  $('workspace-mode').textContent=usage?.mode==='licensed-service'?'Licensed service · '+(usage.licenseReference||'Configured customer order'):'Keyless evaluation · saved operating decisions';
}
function pendingPanel(){
  const saved=pending();if(!saved)return null;
  const native=/\/(acquire|recover|retry)$/.test(saved.path);
  return element('section',{class:'panel no-print'},element('h2',{},'Saved browser action'),element('p',{class:'small'},saved.label+' Started '+saved.at+'.'),
    button(native?'Open and recover the same edition':'Resume saved action',async()=>{
      state.workId=saved.workId;state.editionId=saved.editionId;
      if(native){
        await mutate('/api/editions/'+encodeURIComponent(saved.editionId)+'/recover',{}, {label:'Recovering the saved edition…',native:true});
      }else{
        const result=await mutate(saved.path,saved.body,{label:saved.label});
        if(saved.path==='/api/work'){state.workId=saved.body.id;state.editionId=null;}
        if(/\/editions$/.test(saved.path))state.editionId=result.id||result.edition?.id||result.editionId||null;
      }
      await refresh();
    },{mutate:true}),
    button('Dismiss browser action',()=>{writeLocal('pending',null);render();},{small:true}));
}
function render(){
  if(!state.workspace)return;
  const main=$('main'),work=currentWork();
  if(state.tab==='new'){replaceContents(main,pendingPanel(),renderWorkForm(null));return;}
  if(!work){
    replaceContents(main,pendingPanel(),element('section',{class:'panel'},element('h1',{},'Plan weather-sensitive work'),element('p',{},'Choose a location, define the work window and set the conditions staff need to review. The saved request and each returned forecast remain attached to the work plan.'),button('Create work plan',()=>{state.tab='new';render();},{primary:true})));
    return;
  }
  const editions=workEditions();
  const editionSelect=select('edition',editions.map(e=>[e.id,(e.label||e.id)+' · '+(e.state||'Saved')]),state.editionId,{'aria-label':'Forecast edition',onChange:event=>guard(async()=>{
    state.editionId=event.target.value;state.detail=await api('/api/editions/'+encodeURIComponent(state.editionId));state.review=null;state.comparison=null;state.intervalId=null;state.page=0;render();
  })});
  const header=element('section',{class:'page-heading'},element('div',{},element('h1',{},work.title),element('p',{class:'small muted'},(work.location?.label||'Selected point')+' · '+work.location?.latitude+', '+work.location?.longitude)),
    element('div',{class:'toolbar no-print'},editions.length?field('Forecast edition',editionSelect):null));
  const tabs=[['plan','Work plan'],['request','Request review'],['compare','Edition changes'],['history','History'],['operations','Operations'],['handover','Handover'],['setup','Configuration']];
  const nav=element('nav',{class:'tabs no-print','aria-label':'Work plan views'},tabs.map(([key,label])=>element('button',{type:'button',class:'tab',role:'tab','aria-selected':String(state.tab===key),onClick:()=>{state.tab=key;render();if(key==='operations')guard(loadOperations);}},label)));
  const panels={plan:renderPlan,request:renderRequest,compare:renderComparison,history:renderHistory,operations:renderOperations,handover:renderHandover,setup:()=>renderWorkForm(work)};
  const content=(panels[state.tab]||renderPlan)();
  replaceContents(main,pendingPanel(),header,nav,content);
}
function defaultWork(){
  const start=new Date();start.setUTCMinutes(0,0,0);
  return{id:uid('work'),title:'Outdoor operations',location:{label:'Boston operations site',latitude:42.3478,longitude:-71.0466},window:{startTime:start.toISOString(),endTime:new Date(start.getTime()+6*3600000).toISOString(),timezone:'America/New_York',dailyStartHour:0},units:'metric',fields:['temperature','windSpeed','windGust','precipitationIntensity'],timesteps:['1h'],thresholds:[],tile:null};
}
function renderWorkForm(existing){
  const key='draft:'+ (existing?.id||'new');
  const local=readLocal(key);
  const draft=local?.input||(existing?structuredClone(existing):defaultWork());
  const originalRevision=local?.expectedRevision??state.workspace.revision;
  const form=element('form',{class:'panel',onSubmit:event=>{event.preventDefault();guard(save);}});
  const controls={};
  function f(name,label,value,attrs={},help){const node=input(name,value,attrs);controls[name]=node;return field(label,node,help);}
  form.append(element('h2',{},existing?'Work configuration':'New work plan'),element('p',{class:'small muted'},'The saved configuration fixes the point, request window, native units and operator-defined thresholds. A later forecast edition keeps its own configuration.'));
  form.append(element('div',{class:'grid'},
    f('title','Work plan title',draft.title,{required:true,maxlength:180}),
    f('locationLabel','Location label',draft.location?.label,{required:true,maxlength:180}),
    f('latitude','Latitude',draft.location?.latitude,{type:'number',step:'any',min:-90,max:90,required:true}),
    f('longitude','Longitude',draft.location?.longitude,{type:'number',step:'any',min:-180,max:180,required:true}),
    f('startTime','Work window start',draft.window?.startTime,{required:true},'ISO 8601 with an explicit offset, for example 2026-10-12T08:00:00-04:00.'),
    f('endTime','Work window end',draft.window?.endTime,{required:true},'The request offset determines the window.'),
    f('timezone','Response timezone',draft.window?.timezone||'UTC',{required:true},'IANA timezone or auto; this controls the returned representation.'),
    f('dailyStartHour','Daily aggregation starts at',draft.window?.dailyStartHour??0,{type:'number',min:0,max:23,step:1,required:true},'0 means midnight; the native provider default is 06:00.')));
  controls.units=select('units',[['metric','Metric'],['imperial','Imperial']],draft.units||'metric');
  form.append(element('div',{class:'form-section'},field('Native units',controls.units)));
  const known=[...new Set([...Object.keys(nativeUnits),...Object.keys(state.workspace.plan?.fieldUnits||{})])];
  const selected=new Set(draft.fields||[]);
  const checks=element('div',{class:'check-grid'});
  const fieldChecks=[];
  for(const name of known){
    const check=input('nativeField',name,{type:'checkbox',checked:selected.has(name)});fieldChecks.push(check);
    checks.append(element('label',{},check,element('span',{},element('span',{class:'field-caption'},name),element('small',{'data-unit-field':name},unitFor(name,controls.units.value)))));
  }
  controls.customFields=input('customFields',(draft.fields||[]).filter(f=>!known.includes(f)).join(', '));
  form.append(element('section',{class:'form-section'},element('h3',{},'Native fields'),checks,field('Additional native fields',controls.customFields,'Comma-separated native property names. Availability follows the provider account and selected timestep.')));
  const timestepChecks=[];
  const timestepGrid=element('div',{class:'check-grid'});
  for(const timestep of ['current','1m','5m','15m','30m','1h','1d']){
    const check=input('timestep',timestep,{type:'checkbox',checked:(draft.timesteps||['1h']).includes(timestep)});timestepChecks.push(check);
    timestepGrid.append(element('label',{},check,timestep));
  }
  form.append(element('section',{class:'form-section'},element('h3',{},'Requested timesteps'),timestepGrid));
  const ruleContainer=element('div'),rules=[];
  function addRule(rule={id:uid('threshold'),field:(draft.fields||['windSpeed'])[0],operator:'gte',value:'',label:''}){
    const name=input('ruleLabel',rule.label,{placeholder:'e.g. Review lifting work',required:true});
    const nativeField=select('ruleField',[...new Set([...known,...(draft.fields||[])])],rule.field);
    const operator=select('ruleOperator',[['gte','≥'],['gt','>'],['lte','≤'],['lt','<']],rule.operator);
    const threshold=input('ruleValue',rule.value,{type:'number',step:'any',required:true});
    const unit=element('p',{class:'help'},unitFor(nativeField.value,controls.units.value));
    const row=element('div',{class:'rule-row'},field('Decision cue',name),field('Native field',nativeField),field('Comparison',operator),element('div',{class:'field'},element('label',{for:threshold.id||(threshold.id=uid('threshold-value'))},'Threshold'),threshold,unit));
    const record={id:rule.id||uid('threshold'),name,nativeField,operator,threshold,unit,row};
    row.append(button('Remove',()=>{row.remove();rules.splice(rules.indexOf(record),1);persist();},{small:true}));
    nativeField.addEventListener('change',()=>{unit.textContent=unitFor(nativeField.value,controls.units.value);persist();});
    rules.push(record);ruleContainer.append(row);
  }
  (draft.thresholds||[]).forEach(addRule);
  form.append(element('section',{class:'form-section'},element('h3',{},'Operator thresholds'),element('p',{class:'help'},'These are your review conditions. Each returned interval retains the native value, unit and matched rule.'),ruleContainer,button('Add threshold',()=>{addRule();persist();},{small:true})));
  controls.tileEnabled=input('tileEnabled','on',{type:'checkbox',checked:!!draft.tile});
  controls.tileZoom=input('tileZoom',draft.tile?.zoom??8,{type:'number',min:1,max:12,step:1});
  controls.tileField=input('tileField',draft.tile?.field||'precipitationIntensity');
  controls.tileTime=input('tileTime',draft.tile?.time||draft.window?.startTime||'');
  form.append(element('section',{class:'form-section'},element('h3',{},'Native map tile'),element('label',{class:'check-row'},controls.tileEnabled,'Include the tile containing this point'),element('div',{class:'grid three spaced'},field('Zoom',controls.tileZoom,'Native zoom 1–12.'),field('Native layer',controls.tileField),field('Tile time',controls.tileTime,'Explicit ISO time for the selected layer.')),element('p',{class:'help spaced'},'The native PNG is a map preview. Numeric decisions use the returned timeline values.')));
  function gather(){
    return{id:draft.id,title:controls.title.value.trim(),location:{label:controls.locationLabel.value.trim(),latitude:Number(controls.latitude.value),longitude:Number(controls.longitude.value)},window:{startTime:controls.startTime.value.trim(),endTime:controls.endTime.value.trim(),timezone:controls.timezone.value.trim(),dailyStartHour:Number(controls.dailyStartHour.value)},units:controls.units.value,fields:[...new Set([...fieldChecks.filter(c=>c.checked).map(c=>c.value),...controls.customFields.value.split(',').map(v=>v.trim()).filter(Boolean)])],timesteps:timestepChecks.filter(c=>c.checked).map(c=>c.value),thresholds:rules.map(r=>({id:r.id,field:r.nativeField.value,operator:r.operator.value,value:Number(r.threshold.value),label:r.name.value.trim()})),tile:controls.tileEnabled.checked?{zoom:Number(controls.tileZoom.value),field:controls.tileField.value.trim(),time:controls.tileTime.value.trim()}:null};
  }
  function persist(){writeLocal(key,{input:gather(),expectedRevision:originalRevision});}
  form.addEventListener('input',persist);form.addEventListener('change',persist);
  controls.units.addEventListener('change',()=>{
    form.querySelectorAll('[data-unit-field]').forEach(n=>{n.textContent=unitFor(n.dataset.unitField,controls.units.value);});
    rules.forEach(r=>{r.unit.textContent=unitFor(r.nativeField.value,controls.units.value);});
  });
  async function save(){
    if(!form.reportValidity())return;
    const body=gather();
    if(!body.fields.length||!body.timesteps.length)throw new Error('Select at least one native field and one timestep.');
    for(const rule of body.thresholds)if(!body.fields.includes(rule.field))throw new Error('Select the native field '+rule.field+' used by '+rule.label+'.');
    body.expectedRevision=originalRevision;body.requestId=uid('save-work');
    await mutate('/api/work',body,{label:'Saving work configuration…'});
    writeLocal(key,null);state.workId=body.id;state.editionId=null;state.detail=null;state.review=null;state.tab='request';await refresh();
  }
  form.append(element('div',{class:'form-actions'},button('Discard local draft',()=>{writeLocal(key,null);render();},{small:true}),element('button',{type:'submit',class:'primary',dataset:{mutate:'true',permitted:'yes'},disabled:state.busy},'Save work configuration')));
  return form;
}
function prepareForm(){
  const label=input('editionLabel','Forecast '+(workEditions().length+1),{required:true,maxlength:180,'aria-label':'New forecast edition label'});
  const form=element('form',{class:'toolbar no-print',onSubmit:event=>{event.preventDefault();guard(async()=>{
    if(!form.reportValidity())return;
    const result=await mutate('/api/work/'+encodeURIComponent(state.workId)+'/editions',{label:label.value.trim(),requestId:uid('prepare-edition')},{label:'Preparing a fixed forecast request…'});
    state.editionId=result.id||result.edition?.id||result.editionId||null;state.detail=null;state.review=null;state.tab='request';await refresh();
  });}},label,element('button',{type:'submit',dataset:{mutate:'true',permitted:'yes'},disabled:state.busy},'Prepare new edition'));
  return form;
}
function renderRequest(){
  const section=element('section',{class:'panel'},element('div',{class:'section-heading'},element('h2',{},'Request and source acquisition'),prepareForm()));
  const detail=state.detail,edition=selectedEdition();
  if(!edition)return element('div',{},section,element('p',{class:'empty'},'Prepare an edition to inspect the exact fixed native request before it runs.'));
  const work=detail?.work||currentWork();
  section.append(sourceLine(edition),element('dl',{class:'summary-grid'},
    summary('Edition state',edition.state),summary('Requested window',work.window?.startTime+' → '+work.window?.endTime),summary('Native units / timezone',work.units+' / '+work.window?.timezone),summary('Source availability',edition.rawAvailability||'Not captured')));
  const review=state.review;
  if(review){
    section.append(element('p',{class:'small'},'Review '+review.reviewSha256),element('div',{class:'toolbar'},badge(String(review.providerCalls??'Unknown')+' planned provider calls')),details('Usage and selected terms',review.usage||state.workspace.plan?.usage||{}));
    for(const request of arr(review.requests))section.append(element('article',{class:'request-card'},element('h3',{},badge(request.kind),request.method),element('div',{class:'mono'},request.url),request.body!==undefined?details('Native request body',request.body):null));
  }
  const complete=['COMPLETE','PARTIAL','METADATA_ONLY'].includes(edition.state);
  const toolbar=element('div',{class:'toolbar spaced no-print'});
  if(['PREPARED','REVIEWED'].includes(edition.state))toolbar.append(button('Review native request',async()=>{
    state.review=await mutate('/api/editions/'+encodeURIComponent(state.editionId)+'/review',{}, {label:'Opening the saved native request review…'});
    state.detail=await api('/api/editions/'+encodeURIComponent(state.editionId));state.workspace=await api('/api/workspace');render();
  },{mutate:true}));
  if(review?.reviewSha256&&!complete&&['PREPARED','REVIEWED'].includes(edition.state))toolbar.append(button('Acquire reviewed forecast',async()=>{
    await mutate('/api/editions/'+encodeURIComponent(state.editionId)+'/acquire',{reviewSha256:review.reviewSha256},{label:'Acquiring the reviewed native forecast…',native:true});
    state.tab='plan';await refresh();
  },{primary:true,mutate:true}));
  if(['ACQUIRING','RETRYING','INTERRUPTED','FAILED'].includes(edition.state))toolbar.append(button('Recover existing edition',async()=>{
    await mutate('/api/editions/'+encodeURIComponent(state.editionId)+'/recover',{}, {label:'Recovering the existing forecast edition…',native:true});await refresh();
  },{mutate:true}));
  if(complete)toolbar.append(button('Open returned work plan',()=>{state.tab='plan';render();},{primary:true}));
  section.append(...[toolbar,renderResourceRetry(edition),details('Saved source metadata',edition)].filter(Boolean));
  if(edition.error||edition.errors)section.append(details('Provider outcome',edition.error||edition.errors));
  return section;
}
function renderResourceRetry(edition){
  const resource=edition.resources?.tile;
  const retained=state.retryReview?.editionId===edition.id?state.retryReview.review:null;
  if(edition.state==='RETRYING')return element('p',{class:'small'},'A reviewed map retry is in progress. Recover this edition to read its saved outcome.');
  if(resource?.state!=='FAILED')return null;
  const section=element('section',{class:'form-section'},element('h3',{},'Retry a failed map request'));
  const failure=resource?.providerError?.message||resource?.providerDiagnostic?.text||resource?.error||'The map request did not return an available image.';
  section.append(element('p',{class:'small'},failure+(resource?.status?' · HTTP '+resource.status:'')),
    element('p',{class:'help'},'Review one map request for this existing edition. The saved Timeline and staff decisions stay attached to their original source.'));
  const format=select('tileTimeFormat',[['iso-path','Provider ISO timestamp'],['original','Exact saved request'],['whole-seconds','Legacy whole-second spelling']],state.retryReview?.format||state.retryTimeFormat||'iso-path',{onChange:event=>{state.retryTimeFormat=event.target.value;state.retryReview=null;render();}});
  section.append(field('Map timestamp format',format,'Provider format keeps the requested instant, map point and layer. Original reuses the exact saved request; the legacy option removes an all-zero fractional second.'));
  section.append(element('div',{class:'toolbar spaced'},button('Review failed map request',async()=>{
    const editionId=edition.id,body={tileTimeFormat:format.value};
    const review=await mutate('/api/editions/'+encodeURIComponent(editionId)+'/resources/tile/review',body,{label:'Reviewing the single saved map request…'});
    state.retryReview={editionId,format:format.value,review};state.detail=await api('/api/editions/'+encodeURIComponent(editionId));state.workspace=await api('/api/workspace');render();
  },{mutate:true})));
  if(retained){
    section.append(element('div',{class:'toolbar spaced'},badge(String(retained.providerCalls)+' planned provider call')),
      details('Previous map outcome',retained.previousFailure||resource),
      details('Reviewed map request',retained.request),element('p',{class:'small mono'},'Review '+retained.reviewSha256),
      button('Retry reviewed map request',async()=>{
        await mutate('/api/editions/'+encodeURIComponent(edition.id)+'/resources/tile/retry',{reviewSha256:retained.reviewSha256},{label:'Acquiring the reviewed map request…',native:true});
        state.retryReview=null;state.tab='plan';await refresh();
      },{primary:true,mutate:true}));
  }
  return section;
}

function summary(label,value){return element('div',{class:'summary-cell'},element('dt',{},label),element('dd',{},value===null||value===undefined?'Unknown':String(value)));}
function ruleText(rule,unit){
  if(typeof rule==='string')return rule;
  const symbol={gte:'≥',lte:'≤',gt:'>',lt:'<'}[rule.operator]||rule.operator||'';
  const value=rule.value??rule.threshold;
  return(rule.label||rule.id||'Configured threshold')+(value===undefined?'':' · '+symbol+' '+value+(unit?' '+unit:''));
}
function fieldCell(field){
  const label=element('span',{class:'value-item'+(field.present===false||field.value==null?' value-missing':'')},element('span',{class:'mono'},field.field),': '+formatValue(field.value,field.present!==false)+(field.unit?' '+field.unit:''));
  const rules=arr(field.rules);
  const exposure=field.exposure;
  return element('div',{},label,exposure!==undefined&&exposure!==null?element('div',{class:'cell-note'},'Rule result: '+(typeof exposure==='boolean'?(exposure?'Matched':'Not matched'):String(exposure))):null,rules.length?element('div',{class:'cell-note'},rules.map(r=>ruleText(r,field.unit)).join('; ')):null);
}
function renderPlan(){
  const section=element('section',{class:'panel'},element('div',{class:'section-heading'},element('h2',{},'Returned intervals and staff decisions'),button('Print work plan',()=>{state.printing=true;render();requestAnimationFrame(()=>window.print());})));
  const detail=state.detail,edition=selectedEdition();
  if(!detail||!edition)return element('div',{},section,element('p',{class:'empty'},'Prepare and acquire a forecast edition from Request review.'));
  const rows=arr(detail.rows),work=detail.work||currentWork();
  section.append(sourceLine(edition),element('dl',{class:'summary-grid'},summary('Returned intervals',edition.resources?.timeline?.returnedIntervals??rows.length),summary('Intervals with decisions',new Set(arr(detail.decisions).map(decision=>decision.intervalId)).size),summary('Native units',work.units),summary('Received',receivedTime(edition)||'Awaiting source')));
  section.append(element('p',{class:'small muted'},'Interval start times and values below come from this saved source edition. Missing and null values remain visible. Each staff decision applies to its selected interval and source.'));
  if(!rows.length){
    const latest=new Map();for(const decision of arr(detail.decisions))latest.set(decision.intervalId,decision);
    section.append(element('p',{class:'empty'},'This edition has no retained source intervals to display.'));
    if(latest.size)section.append(element('h3',{},'Saved staff work instructions'),table(['Interval / timestep','Assigned staff','Decision','Work instruction'],[...latest.values()].map(decision=>element('tr',{},
      element('td',{},element('span',{class:'mono'},decision.startTime||decision.intervalId),element('span',{class:'cell-note'},decision.timestep||'')),
      element('td',{},decision.assignee),element('td',{},badge(decision.decision)),element('td',{},decision.note||'')))));
    section.append(details('Original edition outcome',edition),button('Open request review',()=>{state.tab='request';render();}));
    appendMap(section,detail,edition,work);
    return section;
  }
  const filtered=state.printing?rows:rows.filter(row=>state.filter==='ALL'||(state.filter==='UNDECIDED'?!savedDecision(row.id):savedDecision(row.id)?.decision===state.filter));
  const pageSize=50,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));state.page=Math.min(state.page,totalPages-1);
  const visible=state.printing?filtered:filtered.slice(state.page*pageSize,(state.page+1)*pageSize);
  const filter=select('decisionFilter',[['ALL','All intervals'],['UNDECIDED','Without a decision'],['REVIEW','Review'],['PROCEED','Proceed'],['RESCHEDULE','Reschedule'],['CANCEL','Cancel']],state.filter,{'aria-label':'Filter intervals by decision',onChange:event=>{state.filter=event.target.value;state.page=0;render();}});
  section.append(element('div',{class:'toolbar no-print'},filter,element('span',{class:'small muted'},filtered.length+' matching intervals'),button('Previous',()=>{state.page--;render();},{small:true,disabled:state.page===0}),element('span',{class:'small'},'Page '+(state.page+1)+' of '+totalPages),button('Next',()=>{state.page++;render();},{small:true,disabled:state.page+1>=totalPages})));
  const rowsTable=table(['Interval start / timestep','Native values and threshold evidence','Staff decision'],visible.map(row=>{
    const decision=savedDecision(row.id);
    return element('tr',{class:row.id===state.intervalId?'selected':''},
      element('td',{},element('span',{class:'cell-label mono'},row.startTime),element('span',{class:'cell-note'},row.timestep),row.withinWindow===false?element('span',{class:'cell-note'},'Outside saved work window'):null,button('Review interval',()=>{state.intervalId=row.id;render();},{small:true})),
      element('td',{},arr(row.fields).map(fieldCell)),
      element('td',{},decision?badge(decision.decision,true):element('span',{class:'muted'},'Undecided'),decision?element('div',{class:'cell-note'},decision.assignee):null,decision?.note?element('div',{class:'cell-note'},decision.note):null));
  }));
  const layout=element('div',{class:'decision-layout'},rowsTable,renderDecision(rows.find(r=>r.id===state.intervalId)||visible[0]));
  section.append(layout);
  appendMap(section,detail,edition,work);
  return section;
}
function appendMap(section,detail,edition,work){
  if(detail.tile?.available)section.append(element('div',{class:'map-layout'},
    element('img',{class:'map-tile',src:'/api/editions/'+encodeURIComponent(edition.id)+'/tile',alt:'Native '+(work.tile?.field||'weather')+' map tile for '+(work.location?.label||'the selected point')}),
    element('div',{},element('h3',{},'Native map tile'),element('p',{class:'small'},(work.tile?.field||'Selected layer')+' · '+(work.tile?.time||'Saved tile time')),element('p',{class:'help'},'The map is a source image. Decisions above use the native timeline values.'),sourceLine(edition,'Map image available'))));
  else if(work.tile){
    const resource=edition.resources?.tile;
    const outcome=resource?.state==='FAILED'?'Request failed'+(resource.status?' · HTTP '+resource.status:''):
      resource?.sha256?'Source image is no longer retained':resource?'Source image is unavailable':'Awaiting acquisition';
    section.append(element('p',{class:'small muted'},'Map tile: '+outcome+'.'));
    if(resource?.error)section.append(details('Map request outcome',resource));
  }
}
function renderDecision(row){
  if(!row)return element('aside',{class:'decision-panel'},element('h2',{},'Interval review'),element('p',{class:'small'},'Select an interval from the returned work plan.'));
  const prior=savedDecision(row.id),key='decision:'+state.editionId+':'+row.id,saved=readLocal(key),draft=saved||prior||{};
  const assignee=input('assignee',draft.assignee||'',{required:true,maxlength:160});
  const decision=select('decision',[['REVIEW','Review'],['PROCEED','Proceed'],['RESCHEDULE','Reschedule'],['CANCEL','Cancel']],draft.decision||'REVIEW');
  const note=element('textarea',{name:'note',value:draft.note||'',rows:4,maxlength:8000});
  const form=element('form',{class:'decision-panel no-print',onSubmit:event=>{event.preventDefault();guard(async()=>{
    if(!form.reportValidity())return;
    await mutate('/api/decisions',{editionId:state.editionId,intervalId:row.id,assignee:assignee.value.trim(),decision:decision.value,note:note.value.trim(),expectedRevision:state.workspace.revision,requestId:uid('decide')},{label:'Saving the source-linked staff decision…'});
    writeLocal(key,null);await refresh();
  });}});
  form.append(element('h2',{},'Interval review'),element('p',{class:'selected-interval mono'},row.startTime+' · '+row.timestep),field('Assigned staff member',assignee),field('Operating decision',decision),field('Reason and work instruction',note),element('button',{type:'submit',class:'primary wide',dataset:{mutate:'true',permitted:'yes'},disabled:state.busy},'Save interval decision'));
  form.addEventListener('input',()=>writeLocal(key,{assignee:assignee.value,decision:decision.value,note:note.value}));
  form.addEventListener('change',()=>writeLocal(key,{assignee:assignee.value,decision:decision.value,note:note.value}));
  if(prior)form.append(element('p',{class:'help spaced'},'The earlier saved decision remains in this edition’s history.'));
  return form;
}
function renderComparison(){
  const section=element('section',{class:'panel'},element('h2',{},'Compare saved forecast editions'),element('p',{class:'small muted'},'Compare matching native field, unit, location, timestep and interval time. Staff decisions remain attached to their original edition.'));
  const editions=workEditions();
  if(editions.length<2){section.append(element('p',{class:'empty'},'Prepare another edition from Request review to compare it with the current saved forecast.'));return section;}
  const before=select('before',editions.map(e=>[e.id,e.label||e.id]),state.comparison?.beforeId||editions.at(-2).id);
  const after=select('after',editions.map(e=>[e.id,e.label||e.id]),state.comparison?.afterId||state.editionId||editions.at(-1).id);
  section.append(element('div',{class:'grid'},field('Earlier saved edition',before),field('Later saved edition',after)),element('div',{class:'toolbar spaced'},button('Compare editions',async()=>{
    state.comparison=await api('/api/compare?before='+encodeURIComponent(before.value)+'&after='+encodeURIComponent(after.value));render();
  },{primary:true})));
  const comparison=state.comparison;
  if(!comparison)return section;
  if(!comparison.comparable){section.append(element('p',{class:'empty spaced'},comparison.reason||'These editions do not have compatible native comparison keys.'));return section;}
  section.append(sourceLine(selectedEdition()),table(['Interval / timestep','Field / unit','Earlier value','Later value','Change / source status'],arr(comparison.rows).map(row=>element('tr',{},
    element('td',{},element('span',{class:'cell-label mono'},row.startTime),element('span',{class:'cell-note'},row.timestep)),
    element('td',{},element('span',{class:'mono'},row.field),element('span',{class:'cell-note'},row.unit||'')),
    element('td',{},row.beforePresent===undefined?reading(row.before):formatValue(row.before,row.beforePresent)),element('td',{},row.afterPresent===undefined?reading(row.after):formatValue(row.after,row.afterPresent)),
    element('td',{},row.change===null||row.change===undefined?'—':reading(row.change),element('div',{class:'cell-note'},row.status||''))))));
  return section;
}
function operationsKey(){return(state.workspace?.workspaceId||'')+':'+(state.operationsScope==='workspace'?'workspace':state.workId);}
function operationsPath(){return '/api/operations'+(state.operationsScope==='workspace'?'':'?workId='+encodeURIComponent(state.workId));}
async function loadOperations(){
  notice('Reading the saved operations workspace…');
  state.operations=await api(operationsPath());state.operationsKey=operationsKey();render();notice('Operations review refreshed.');
}
async function downloadOperations(format){
  setBusy(true,'Preparing the operating report…');
  try{
    const response=await fetch('/api/operations/report',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf||''},
      body:JSON.stringify({format,...(state.operationsScope==='workspace'?{}:{workId:state.workId})})});
    if(!response.ok){const result=await response.json();throw new Error(result.error?.message||'The operating report could not be prepared.');}
    const blob=await response.blob(),filename=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'weather-operations.'+format;
    const url=URL.createObjectURL(blob),link=element('a',{href:url,download:filename});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    notice('Operating report downloaded.');
  }finally{setBusy(false);}
}
async function openOperationsInterval(row){
  state.workId=row.workId;state.editionId=row.editionId;state.intervalId=row.id||row.intervalId;state.review=null;state.comparison=null;
  state.detail=await api('/api/editions/'+encodeURIComponent(row.editionId));state.tab='plan';state.filter='ALL';
  const index=arr(state.detail.rows).findIndex(interval=>interval.id===state.intervalId);state.page=Math.max(0,Math.floor(index/50));
  renderSidebar();render();
}
function renderOperations(){
  const section=element('section',{class:'panel'},element('div',{class:'section-heading'},element('div',{},element('h2',{},'Operations review'),element('p',{class:'small muted'},'Staff assignments and review conditions from the saved forecast editions.')),button('Refresh operations',loadOperations,{small:true})));
  const scope=select('operationsScope',[['workspace','All work plans in this workspace'],['current','Current work plan']],state.operationsScope,{onChange:event=>guard(async()=>{state.operationsScope=event.target.value;state.operationsFilter='ALL';state.operationsAssignee='ALL';await loadOperations();})});
  section.append(element('div',{class:'toolbar spaced'},field('Review scope',scope),button('Download HTML report',()=>downloadOperations('html'),{mutate:true}),button('Download CSV report',()=>downloadOperations('csv'),{mutate:true}),button('Download JSON report',()=>downloadOperations('json'),{mutate:true})));
  if(state.operationsKey!==operationsKey()||!state.operations){section.append(element('p',{class:'empty'},'Open the saved operations review.'),button('Load operations review',loadOperations,{primary:true}));return section;}
  const review=state.operations,counts=review.summary||{},workNames=new Map(arr(review.workPlans).map(work=>[work.id,work.title]));
  section.append(sourceLine(selectedEdition()),element('dl',{class:'summary-grid'},
    summary('Needs review',counts.needsReview??0),summary('Forecast changes',counts.changedIntervals??0),
    summary('Unassigned intervals',counts.unassigned??0),summary('Active intervals',counts.activeIntervals??0),
    summary('Threshold matches',counts.thresholdMatches??0),summary('Missing values',counts.unavailableValues??0)));
  section.append(element('p',{class:'help'},review.definitions?.selection||'The latest acquired edition for each selected work plan is active.'));
  if(!arr(review.editions).length){section.append(element('p',{class:'empty'},'Acquire a Timeline edition from Request review to build the operating queue.'));return section;}
  const queue=arr(review.queue),assignees=[...new Set(queue.map(row=>row.assignee||''))].sort();
  const filter=select('operationsFilter',[['ALL','All review conditions'],['NEEDS_REVIEW','Needs a staff review'],['CHANGED','Forecast changed'],['MISSING','Missing source values'],['MATCHED','Threshold matched']],state.operationsFilter,{onChange:event=>{state.operationsFilter=event.target.value;render();}});
  const assignee=select('operationsAssignee',[['ALL','All assignments'],...assignees.map(name=>[name||'UNASSIGNED',name||'Unassigned'])],state.operationsAssignee,{onChange:event=>{state.operationsAssignee=event.target.value;render();}});
  const filtered=queue.filter(row=>{
    if(state.operationsAssignee!=='ALL'&&(row.assignee||'UNASSIGNED')!==state.operationsAssignee)return false;
    if(state.operationsFilter==='NEEDS_REVIEW')return row.needsReview;
    if(state.operationsFilter==='CHANGED')return arr(row.changes).length>0;
    if(state.operationsFilter==='MISSING')return row.hasMissingValue||arr(row.reasonCodes).includes('MISSING_NATIVE_VALUE');
    if(state.operationsFilter==='MATCHED')return row.hasTriggeredRule;
    return true;
  });
  section.append(element('h3',{class:'spaced'},'Staff review queue'),element('div',{class:'toolbar spaced'},field('Review condition',filter),field('Assigned staff',assignee),element('span',{class:'small muted'},filtered.length+' matching intervals')));
  if(filtered.length)section.append(table(['Work / interval','Review conditions','Assigned staff / decision','Source and work instruction'],filtered.map(row=>element('tr',{},
    element('td',{},element('span',{class:'cell-label'},workNames.get(row.workId)||row.workId),element('span',{class:'cell-note mono'},row.startTime+' · '+row.timestep),button('Open interval',()=>openOperationsInterval(row),{small:true})),
    element('td',{},arr(row.reasonCodes).map(reason=>element('div',{class:'cell-note'},reason)),row.observationAvailability==='RETAINED_DECISION_ONLY'?element('div',{class:'help'},'Saved staff instruction; source values have expired.'):null),
    element('td',{},row.assignee||'Unassigned',row.latestDecision?element('div',{class:'cell-note'},badge(row.latestDecision.decision), ' · revision '+row.latestDecision.revision):null),
    element('td',{},element('span',{class:'cell-note mono'},row.editionId),row.latestDecision?.note?element('p',{class:'small'},row.latestDecision.note):element('span',{class:'small muted'},'Staff review needed.'))))));
  else section.append(element('p',{class:'empty'},'No intervals match the selected review conditions.'));
  section.append(element('h3',{class:'spaced'},'Staff assignments'),table(['Staff member','Active intervals','Needs review','Threshold matches','Forecast changes','Saved decisions'],arr(review.assignments).map(row=>element('tr',{},
    element('td',{},row.assignee||'Unassigned'),element('td',{},row.intervals),element('td',{},row.needsReview),element('td',{},row.triggered),element('td',{},row.changed),
    element('td',{},Object.entries(row.decisionCounts||{}).map(([name,count])=>name+': '+count).join('; ')||'None')))));
  section.append(element('h3',{class:'spaced'},'Selected work plans'),table(['Work plan','Active source received','Intervals / reviewed','Source availability'],arr(review.workPlans).map(work=>element('tr',{},
    element('td',{},work.title,element('span',{class:'cell-note'},work.location?.label||'')),
    element('td',{},work.acquiredAt||'Awaiting source',element('span',{class:'cell-note mono'},work.activeEditionId)),
    element('td',{},work.intervals+' / '+work.reviewed),
    element('td',{},work.sourceAvailable?'Available':(work.retainedDecisionIntervals?'Saved staff decisions available':'No available source intervals'))))));
  if(arr(review.issues).length)section.append(details('Source and decision observations',review.issues));
  section.append(details('Review definitions',review.definitions),element('p',{class:'help'},'Report downloads include the source and staff records permitted by the current workspace retention settings.'));
  return section;
}

function renderHistory(){
  const section=element('section',{class:'panel'},element('h2',{},'Forecast and decision history'));
  const editions=workEditions();
  section.append(table(['Saved edition','State','Received / completed','Source availability'],editions.map(e=>element('tr',{},
    element('td',{},button(e.label||e.id,async()=>{state.editionId=e.id;state.detail=await api('/api/editions/'+encodeURIComponent(e.id));state.review=null;state.tab='plan';render();},{small:true}),element('div',{class:'cell-note mono'},e.id)),
    element('td',{},badge(e.state)),element('td',{class:'mono'},receivedTime(e)||'—'),element('td',{},e.rawAvailability||'—')))));
  const decisions=arr(state.detail?.decisions);
  section.append(element('h3',{class:'spaced'},'Decisions for selected edition'),decisions.length?table(['Interval','Assigned staff','Decision','Note','Revision / recorded'],decisions.map(d=>element('tr',{},
    element('td',{class:'mono'},d.intervalId),element('td',{},d.assignee),element('td',{},badge(d.decision)),
    element('td',{},d.note),element('td',{},d.revision??d.version??'—',element('div',{class:'cell-note'},d.createdAt||d.recordedAt||''))))):element('p',{class:'empty'},'No staff decisions have been saved for this edition.'));
  if(state.detail?.edition)section.append(details('Selected edition source metadata',state.detail.edition));
  return section;
}
function download(name,bundle){
  const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)+'\n'],{type:'application/json'}));
  const link=element('a',{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function renderHandover(){
  const section=element('section',{class:'panel'},element('h2',{},'Customer operating handover'),element('p',{},'Export the selected forecast editions with work configuration, source references and staff decisions. The portable handover can be reopened through the original workspace import.'));
  const usage=state.workspace.plan?.usage||{},editions=state.handoverScope==='workspace'?arr(state.workspace.editions):workEditions(),checks=[];
  const scope=select('handoverScope',[['current','Current work plan'],['workspace','All work plans in this workspace']],state.handoverScope,{onChange:event=>{state.handoverScope=event.target.value;render();}});
  section.append(element('div',{class:'toolbar spaced'},field('Handover scope',scope)));
  const workNames=new Map(arr(state.workspace.workOrders).map(work=>[work.id,work.title]));
  for(const edition of editions){
    const check=input('exportEdition',edition.id,{type:'checkbox',checked:edition.id===state.editionId});
    checks.push(check);
    section.append(element('label',{class:'check-row spaced'},check,element('span',{},state.handoverScope==='workspace'?(workNames.get(edition.workId)||edition.workId)+' · ':null,edition.label||edition.id,element('span',{class:'small muted'},' · '+edition.state+' · '+(edition.rawAvailability||'No retained raw source')))));
  }
  const raw=input('includeRaw','on',{type:'checkbox',checked:false,disabled:usage.exportRaw!==true||usage.mode!=='licensed-service'});
  section.append(element('div',{class:'form-section'},element('label',{class:'check-row'},raw,'Include source attachments permitted by this workspace’s order and retention settings'),element('p',{class:'help'},'The original workspace selects the currently available, authorized attachments.')));
  section.append(element('div',{class:'toolbar spaced'},button('Download operating handover',async()=>{
    const editionIds=checks.filter(c=>c.checked).map(c=>c.value);
    if(!editionIds.length)throw new Error('Select at least one forecast edition.');
    const bundle=await mutate('/api/handover',{editionIds,includeRaw:raw.checked},{label:'Preparing the complete operating handover…',retain:false});
    download('weather-operations-'+state.workId+'.json',bundle);
    notice('Operating handover downloaded.');
  },{primary:true,mutate:true,disabled:!editions.length}),button('Import a handover',()=>$('import-file').click())));
  section.append(details('Workspace usage and retention configuration',usage),sourceLine(selectedEdition()));
  return section;
}
function showLogin(message){
  state.workspace=null;state.csrf=null;
  $('workspace-title').textContent='Browser connection required';$('work-list').replaceChildren();$('work-count').textContent='0';
  const tokenField=input('connectionToken','',{type:'password',required:true,autocomplete:'one-time-code'});
  const form=element('form',{class:'panel auth-panel',onSubmit:event=>{event.preventDefault();guard(async()=>{
    let secret=tokenField.value.trim();
    if(secret.startsWith('http://')||secret.startsWith('https://')){
      const parsed=new URL(secret);secret=new URLSearchParams(parsed.hash.slice(1)).get('session')||'';
    }
    await connect(secret);notice('Browser connected.');
  });}},element('h1',{},'Connect this browser'),element('p',{},message||'Open the private server URL printed by the receiving host, or enter its connection token.'),field('Server connection token or private server URL',tokenField),element('button',{type:'submit',class:'primary'},'Connect browser'));
  $('main').replaceChildren(form);
}
async function connect(secret){
  if(secret){
    const response=await fetch('/api/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:secret})});
    const result=await response.json();if(!response.ok){showLogin(result.error?.message);throw new Error(result.error?.message||'The browser connection failed.');}
    state.csrf=result.csrfToken;
  }else state.csrf=(await api('/api/session')).csrfToken;
  await refresh();
}
$('refresh-workspace').addEventListener('click',()=>guard(async()=>{await refresh();notice('Saved workspace refreshed.');}));
$('new-work').addEventListener('click',()=>{if(!state.workspace)return;state.tab='new';render();});
$('work-filter').addEventListener('input',renderSidebar);
$('import-handover').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',event=>guard(async()=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>20*1024*1024)throw new Error('Choose a handover smaller than 20 MiB.');
    let bundle;try{bundle=JSON.parse(await file.text());}catch{throw new Error('Choose an original JSON operating handover.');}
    await mutate('/api/import',{bundle},{label:'Reopening the imported operating handover…',retain:false});
    state.workId=null;state.editionId=null;state.detail=null;state.review=null;await refresh();
  }finally{event.target.value='';}
}));
window.addEventListener('afterprint',()=>{state.printing=false;render();});
window.addEventListener('unhandledrejection',event=>{notice(event.reason?.message||'The browser operation needs to be reopened.',true);event.preventDefault();});
const initial=new URLSearchParams(location.hash.slice(1)).get('session');
if(initial)history.replaceState(null,'',location.pathname+location.search);
guard(()=>connect(initial));
