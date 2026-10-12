// MIT. Reusable operation policies in the original API merchant workspace.
import { POLICY_FIELDS, POLICY_UNSET_FIELDS, POLICY_METHODS, OPERATION_POLICY_BYTES, normalizeOperationPolicy, operationPolicyText, normalizeOperationPolicyTargets, normalizeOperationPolicyOverrides } from './operation-policy-model.mjs';
import { routeKey, atomicPrice } from './route-sheet-model.mjs';

const METHODS=POLICY_METHODS;
const FIELDS=Array.isArray(POLICY_FIELDS)?POLICY_FIELDS:Object.keys(POLICY_FIELDS);
const UNSET=new Set(POLICY_UNSET_FIELDS);
const clone=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>plain(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>canonical(a)===canonical(b);
const text=value=>value===undefined?'Not set':typeof value==='string'?value:JSON.stringify(value,null,2);
const routeLabel=value=>typeof value==='string'?value.replace('\u0000',' '):String(value.method||'REF')+' '+value.path;
const priced=row=>{try{atomicPrice(row?.amountAtomic);return true;}catch{return false;}};
const labels={
  serverIndex:'Backend server index',headerEnv:'Header environment references',securityAlternative:'Backend security alternative',
  responseMode:'Response format',responseValidation:'Response validation',publicDescription:'Public description',
  requestExample:'Public request example',querySerialization:'Array query formats',timeoutMs:'Backend timeout, milliseconds',
  maxResponseBytes:'Maximum response bytes',maxRequestBytes:'Maximum request bytes',maxInFlight:'Concurrent backend requests',
  requestHeaders:'Forwarded request headers',cache:'Shared read policy',availability:'Backend availability policy',
  enforceResponseContract:'Legacy response contract choice',oauth2:'OAuth client credentials references',
  oauthConnection:'Saved OAuth connection reference',oauthProfile:'OAuth provider profile',oauthAlias:'OAuth connection alias',
  idempotency:'Durable POST policy',stream:'Streaming response policy',transport:'Backend transport alias'
};
const numbers=new Set(['serverIndex','securityAlternative','timeoutMs','maxResponseBytes','maxRequestBytes','maxInFlight']);
const objects=new Set(['headerEnv','requestExample','querySerialization','requestHeaders','cache','availability','oauth2','oauthConnection','oauthProfile','idempotency','stream']);
const groups=[
  ['Request and response limits',['timeoutMs','maxRequestBytes','maxResponseBytes','maxInFlight','responseMode','responseValidation','requestHeaders','cache','availability','stream']],
  ['Backend and authorization references',['serverIndex','securityAlternative','transport','headerEnv','oauth2','oauthConnection','oauthProfile','oauthAlias']],
  ['Public request and operation settings',['publicDescription','requestExample','querySerialization','idempotency','enforceResponseContract']]
];
const initialValues={
  serverIndex:0,securityAlternative:0,timeoutMs:10000,maxRequestBytes:1048576,maxResponseBytes:1048576,maxInFlight:16,
  responseMode:'json',responseValidation:'declared',headerEnv:{},requestHeaders:[],querySerialization:{},
  cache:{shareAcrossBuyers:true,ttlMs:1000,maxEntries:256,maxBytes:16777216,maxEntryBytes:1048576,maxWaiters:128,sourceTimeoutMs:11000},
  availability:{failureThreshold:3,resetAfterMs:30000,maxResetAfterMs:300000},
  stream:{maxBytes:1048576,maxDurationMs:60000,idleTimeoutMs:15000},requestExample:{pathParams:{},query:{}}
};

/** The callbacks read and write the original merchant form; the server owns compilation and edition storage. */
export function createOperationPolicyPanel({container,make,field,selectField,api,act,notice,context,apply,onSaved,focusRoute}) {
  let locked=false,selected=null,headSha256=null,policies=[],review=null,reviewInput=null,reviewContext=null,
    source=null,targetPage=0,editorError='',savedApplication=null,saveAttempt=null,loadedId=null,refreshing=0,
    historyRows=[],historyNext=null,historyTotal=0,contextError='';
  const targets=new Set(),overrides=new Map(),controls=new Map(),methods=new Map();
  const panel=make('details');panel.id='operation-policy-desk';
  panel.append(make('summary','Reusable operation policies'),
    make('p','Save native API settings as named editions. Choose the exact routes and any route-specific changes, review the compiled result, then save a merchant package.','hint'));
  const status=make('p',undefined,'small');status.id='operation-policy-status';status.setAttribute('role','status');
  const toolbar=make('div',undefined,'inline'),choice=selectField('Saved policy',[['','Choose a saved policy']],''),
    revision=field('Edition SHA, or leave blank for latest',''),open=button('Open policy'),reload=button('Refresh policies'),fresh=button('New policy');
  choice.input.id='operation-policy-choice';revision.input.id='operation-policy-edition';revision.input.maxLength=64;
  revision.input.placeholder='Latest edition';
  toolbar.append(choice.container,revision.container,open,reload,fresh);
  const metadata=make('div',undefined,'fields'),id=field('Policy ID',''),title=field('Policy title',''),
    descriptionLabel=make('label','Description'),description=make('textarea');
  id.input.id='operation-policy-id';id.input.maxLength=64;id.input.placeholder='standard-read-policy';
  title.input.id='operation-policy-title';title.input.maxLength=240;title.input.placeholder='Standard read policy';
  description.id='operation-policy-description';description.rows=3;description.maxLength=4000;descriptionLabel.className='wide';descriptionLabel.append(description);
  metadata.append(id.container,title.container,descriptionLabel);
  const methodHost=make('div',undefined,'inline wide');methodHost.setAttribute('role','group');methodHost.setAttribute('aria-label','Policy HTTP methods');
  for(const method of METHODS){
    const label=make('label',undefined,'check'),input=make('input');input.type='checkbox';input.checked=['GET','HEAD'].includes(method);
    input.setAttribute('aria-label','Policy method '+method);label.append(input,make('span',method));methodHost.append(label);methods.set(method,input);
  }
  metadata.append(methodHost,make('p','The policy replaces each checked top-level setting in full. Unchecked settings keep their route values.','hint wide'));
  const settings=make('div'),seen=new Set();
  for(const [heading,keys] of groups)buildGroup(heading,keys.filter(key=>FIELDS.includes(key)));
  buildGroup('Other native settings',FIELDS.filter(key=>!seen.has(key)));
  const editorStatus=make('p',undefined,'hint');editorStatus.id='operation-policy-editor-status';
  const copyTools=make('div',undefined,'inline'),copySource=selectField('Copy settings from an included route',[['','Choose a route']],''),copy=button('Copy route settings');
  copyTools.append(copySource.container,copy);
  const files=make('div',undefined,'inline'),saveEdition=button('Save policy edition'),download=button('Download selected edition'),
    importLabel=make('label','Import a complete policy file'),file=make('input'),compare=button('Compare editor with selected edition');
  saveEdition.id='operation-policy-save-edition';file.type='file';file.accept='.json,application/json';file.id='operation-policy-import';
  importLabel.append(file);files.append(saveEdition,download,importLabel,compare);
  const comparison=make('div');comparison.id='operation-policy-edition-comparison';
  const historyHost=make('div'),useHead=button('Compare with current saved head');files.append(useHead);
  const targetSection=make('details');targetSection.open=true;targetSection.append(make('summary','Choose routes and overrides'));
  const targetTools=make('div',undefined,'inline'),query=field('Find a route',''),methodFilter=selectField('HTTP method',[['','All methods']],''),targetFilter=selectField('Show',[['','All source routes'],['included','Included in merchant'],['targeted','Policy targets']],'included');
  query.input.type='search';query.input.id='operation-policy-route-query';
  targetTools.append(query.container,methodFilter.container,targetFilter.container);
  const targetActions=make('div',undefined,'inline'),add=button('Target included matching routes'),remove=button('Remove matching targets'),clear=button('Clear targets');
  targetActions.append(add,remove,clear);
  const targetStatus=make('p',undefined,'small'),targetTable=make('div',undefined,'table-wrap'),pager=make('div',undefined,'inline'),
    previous=button('Previous routes'),next=button('Next routes'),pageLabel=make('span',undefined,'small');
  targetTable.id='operation-policy-targets';targetTable.tabIndex=0;targetTable.setAttribute('role','region');targetTable.setAttribute('aria-label','Policy route targets');
  pager.append(previous,pageLabel,next);
  const overrideSection=make('details'),overrideChoice=selectField('Route-specific override',[['','Choose a targeted route']],''),overrideLabel=make('label','Replace these complete top-level settings (JSON object)'),overrideSet=make('textarea'),
    unsetHost=make('div',undefined,'fields'),clearOverride=button('Clear this route override');
  overrideSet.rows=8;overrideSet.spellcheck=false;overrideSet.value='{}';overrideSet.id='operation-policy-override-set';overrideLabel.append(overrideSet);
  overrideSection.append(make('summary','Route-specific settings'),overrideChoice.container,
    make('p','These settings replace the policy values for this route. Removing an optional field restores the original compiler behavior for that field.','hint'),overrideLabel,
    make('p','Remove optional settings from this route:','small'),unsetHost,clearOverride);
  const unsetControls=new Map();
  for(const key of FIELDS.filter(key=>UNSET.has(key))){
    const label=make('label',undefined,'check'),input=make('input');input.type='checkbox';input.setAttribute('aria-label','Remove '+key+' from override route');
    label.append(input,make('span',labels[key]||key));unsetHost.append(label);unsetControls.set(key,input);
  }
  targetSection.append(targetTools,targetActions,targetStatus,targetTable,pager,overrideSection);
  const reviewActions=make('div',undefined,'inline'),reviewButton=button('Review policy changes'),applyButton=button('Apply reviewed policy to editor'),
    packageName=field('New merchant package name',''),savePackage=button('Save reviewed merchant package'),reopenAttempt=button('Reopen submitted package'),downloadReview=button('Download complete review');
  reviewButton.id='operation-policy-review';applyButton.id='operation-policy-apply';savePackage.id='operation-policy-save-package';savePackage.className='primary';
  packageName.input.id='operation-policy-package-name';packageName.input.maxLength=64;packageName.input.placeholder='merchant-with-policy';
  reviewActions.append(reviewButton,packageName.container,savePackage,applyButton,reopenAttempt,downloadReview);
  const reviewHost=make('div'),applicationHost=make('div');reviewHost.id='operation-policy-review-result';applicationHost.id='operation-policy-application';
  panel.append(status,toolbar,metadata,copyTools,settings,editorStatus,files,comparison,historyHost,targetSection,reviewActions,reviewHost,applicationHost);
  container.append(panel);

  function button(label){const node=make('button',label);node.type='button';return node;}
  function disabled(node,value){node.dataset.operationPolicyDisabled=value?'1':'0';node.disabled=locked||value;}
  function safely(work){try{return work();}catch(error){notice(error.message,true);return undefined;}}
  function readContext(){const value=context();if(!value?.specText||!value?.sourceSha256)throw new Error('Load an API source and select its merchant routes first.');return clone(value);}
  function fingerprint(value){return canonical({workspace:value.workspace,specText:value.specText,plan:value.plan,capturedSource:value.capturedSource??null});}
  function groupNode(heading){const details=make('details');details.append(make('summary',heading));settings.append(details);return details;}
  function buildGroup(heading,keys){
    if(!keys.length)return;
    const group=groupNode(heading),fields=make('div',undefined,'fields');
    for(const key of keys){
      seen.add(key);const wrapper=make('div'),label=make('label',undefined,'check'),enabled=make('input');enabled.type='checkbox';
      enabled.setAttribute('aria-label','Set '+key+' in policy');label.append(enabled,make('span',labels[key]||key));
      let input;
      if(objects.has(key)){input=make('textarea');input.rows=key==='idempotency'?8:4;input.spellcheck=false;wrapper.className='wide';}
      else if(key==='responseMode'||key==='responseValidation'||key==='enforceResponseContract'){
        input=make('select');
        const values=key==='responseMode'?['json','bytes','ndjson','sse']:key==='responseValidation'?['declared','none']:['true','false'];
        for(const value of values){const option=make('option',value);option.value=value;input.append(option);}
      }else{input=make('input');input.type=numbers.has(key)?'number':'text';if(numbers.has(key))input.step='1';}
      input.setAttribute('aria-label','Policy '+key);input.dataset.policyField=key;
      const seed=initialValues[key];input.value=seed===undefined?'':objects.has(key)?JSON.stringify(seed,null,2):String(seed);
      wrapper.append(label,input);if(['headerEnv','oauth2','oauthConnection','idempotency'].includes(key))wrapper.append(make('p','Use the original environment, connection and private-directory references.','hint'));
      fields.append(wrapper);controls.set(key,{enabled,input});
      enabled.addEventListener('change',editChanged);input.addEventListener('input',editChanged);input.addEventListener('change',editChanged);
    }
    group.append(fields);
  }
  function documentFromEditor(){
    const settings={};
    for(const [key,{enabled,input}] of controls){
      if(!enabled.checked)continue;
      if(objects.has(key))settings[key]=JSON.parse(input.value);
      else if(numbers.has(key)){if(!input.value.trim())throw new Error((labels[key]||key)+' requires a value.');settings[key]=Number(input.value);}
      else if(key==='enforceResponseContract')settings[key]=input.value==='true';
      else settings[key]=input.value;
    }
    return normalizeOperationPolicy({schema:'stellar-forge.api-operation-policy.v1',id:id.input.value.trim(),title:title.input.value.trim(),
      description:description.value,methods:[...methods].filter(([,input])=>input.checked).map(([method])=>method),settings});
  }
  function documentMatchesSelected(){try{return Boolean(selected&&equal(documentFromEditor(),selected.policy));}catch{return false;}}
  function invalidateReview(message){
    review=null;reviewInput=null;reviewContext=null;
    if(message)reviewHost.replaceChildren(make('p',message,'hint'));
  }
  function editChanged(){
    invalidateReview('Policy settings changed. Save this edition, then review its exact route changes.');
    let doc;
    try{doc=documentFromEditor();editorError='';}catch(error){editorError=error.message;}
    editorStatus.textContent=editorError||(selected&&equal(doc,selected.policy)?'Editor matches saved edition '+selected.sha256+'.':'Edited policy has not been saved as this edition.');
    renderTargets();available(locked);
  }
  function setDocument(value,view=null){
    const document=normalizeOperationPolicy(value);
    id.input.value=document.id;title.input.value=document.title;description.value=document.description||'';
    for(const [method,input] of methods)input.checked=document.methods.includes(method);
    for(const [key,control] of controls){
      control.enabled.checked=Object.hasOwn(document.settings,key);
      const value=document.settings[key]??initialValues[key];
      control.input.value=value===undefined?'':objects.has(key)?JSON.stringify(value,null,2):String(value);
    }
    selected=view?{...view,policy:document}:null;headSha256=view?.headSha256??view?.sha256??null;loadedId=view?document.id:null;
    historyRows=view?.history?.items??[];historyNext=view?.history?.nextOffset??null;historyTotal=view?.history?.total??historyRows.length;renderHistory();
    revision.input.value=view?.sha256??'';comparison.replaceChildren();editChanged();
  }
  function selectedRef(){if(!selected||!documentMatchesSelected())throw new Error('Save the edited policy edition before reviewing routes.');return {id:selected.policy.id,sha256:selected.sha256};}
  async function openPolicy(policyId,sha256){
    const view=await api('operation-policies/load?id='+encodeURIComponent(policyId)+(sha256?'&sha256='+encodeURIComponent(sha256):''));
    if(!plain(view?.policy)||typeof view.sha256!=='string')throw new Error('The saved policy response is incomplete.');
    setDocument(view.policy,view);choice.input.value=view.policy.id;status.textContent='Opened '+view.policy.title+' · '+view.sha256;
    return view;
  }
  async function refresh(){
    const ticket=++refreshing,collected=[],seen=new Set();let offset=0;
    do{
      const result=await api('operation-policies/list?offset='+offset+'&limit=100');if(ticket!==refreshing)return;
      if(!Array.isArray(result?.policies))throw new Error('The policy list is incomplete.');
      for(const item of result.policies){if(seen.has(item.id))throw new Error('The policy list changed while paging. Refresh its current editions.');seen.add(item.id);collected.push(item);}
      if(result.nextOffset===null||result.nextOffset===undefined)break;
      if(!Number.isInteger(result.nextOffset)||result.nextOffset<=offset)throw new Error('The policy list did not advance.');
      offset=result.nextOffset;
    }while(true);
    policies=collected;const current=choice.input.value;choice.input.replaceChildren();
    const empty=make('option','Choose a saved policy');empty.value='';choice.input.append(empty);
    for(const item of policies){const option=make('option',(item.title||item.id)+' · '+String(item.sha256||'').slice(0,12));option.value=item.id;choice.input.append(option);}
    if(policies.some(item=>item.id===current))choice.input.value=current;
    if(!selected)status.textContent=policies.length+' saved policies in this workspace.';
    available(locked);
  }
  function renderHistory(){
    historyHost.replaceChildren();if(!selected)return;
    const details=make('details');details.append(make('summary','Saved editions ('+historyRows.length+' of '+historyTotal+')'));
    for(const item of historyRows){
      const row=make('div',undefined,'route');row.append(make('p',item.title||selected.policy.title),
        make('p',item.sha256+' · '+(item.createdAt||''),'hint wrap'));
      const actions=make('div',undefined,'inline'),load=button('Open this edition'),get=button('Download edition');
      const policyId=selected.policy.id,sha256=item.sha256;
      load.addEventListener('click',()=>act(async()=>{await openPolicy(policyId,sha256);notice('Opened retained edition '+sha256+'.');}));
      get.addEventListener('click',()=>act(async()=>{
        const result=await api('operation-policies/export?id='+encodeURIComponent(policyId)+'&sha256='+encodeURIComponent(sha256));
        if(result.sha256!==sha256||typeof result.file?.text!=='string')throw new Error('The exported edition differs from this selection.');
        downloadFile(result.file.text,result.file.filename);
      }));
      actions.append(load,get);row.append(actions);details.append(row);
    }
    if(historyNext!==null){
      const more=button('Load earlier editions');more.addEventListener('click',()=>act(async()=>{
        const chosen={id:selected.policy.id,sha256:selected.sha256},offset=historyNext;
        const result=await api('operation-policies/load?id='+encodeURIComponent(chosen.id)+'&sha256='+encodeURIComponent(chosen.sha256)+'&historyOffset='+offset+'&historyLimit=100');
        if(selected?.policy.id!==chosen.id||selected?.sha256!==chosen.sha256)return;
        if(result.sha256!==chosen.sha256||!Array.isArray(result.history?.items))throw new Error('The edition history does not match this selection.');
        const seen=new Set(historyRows.map(item=>item.sha256));for(const item of result.history.items)if(!seen.has(item.sha256)){historyRows.push(item);seen.add(item.sha256);}
        const next=result.history.nextOffset??null;if(next!==null&&(!Number.isInteger(next)||next<=offset))throw new Error('Edition history did not advance.');
        historyNext=next;historyTotal=result.history.total;renderHistory();available(locked);
      }));details.append(more);
    }
    historyHost.append(details);
  }
  function downloadFile(value,name){
    const content=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
    const href=URL.createObjectURL(new Blob([content],{type:'application/json'})),link=make('a');link.href=href;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  function renderEditionComparison(){
    const draft=documentFromEditor();comparison.replaceChildren(make('h3','Policy edition changes'));
    if(!selected){comparison.append(make('p','Open a saved edition to compare it with this editor.','hint'));return;}
    const rows=[];
    for(const key of ['id','title','description','methods'])if(!equal(selected.policy[key],draft[key]))rows.push([key,selected.policy[key],draft[key]]);
    for(const key of FIELDS)if(!equal(selected.policy.settings[key],draft.settings[key]))rows.push([key,selected.policy.settings[key],draft.settings[key]]);
    comparison.append(fieldTable(rows));
    if(!rows.length)comparison.append(make('p','The editor matches the selected edition.','hint'));
  }
  function routeRows(){
    if(!source)return[];
    let plan;try{plan=readContext().plan;contextError='';}catch(error){plan=source.plan;contextError=error.message;}
    const included=new Map((plan.operations||[]).map(row=>[routeKey(row),row]));
    const allowed=[...methods].filter(([,input])=>input.checked).map(([method])=>method);
    return(source.operations||[]).map(operation=>{
      const key=routeKey(operation),row=included.get(key);
      const eligible=Boolean(!contextError&&operation.supported&&row&&priced(row)&&allowed.includes(operation.method));
      const reason=contextError?'Complete the merchant form: '+contextError:!operation.supported?(operation.error||'Unsupported source operation'):!row?'Include and price this route in the merchant form.':
        !priced(row)?'Enter a positive atomic price in the merchant form.':!allowed.includes(operation.method)?'This method is outside the policy.':'';
      return{key,operation,row,eligible,reason};
    });
  }
  function filteredRows(){
    const needle=query.input.value.trim().toLocaleLowerCase();
    return routeRows().filter(item=>(!methodFilter.input.value||item.operation.method===methodFilter.input.value)&&
      (!needle||(routeLabel(item.key)+' '+(item.operation.summary||'')).toLocaleLowerCase().includes(needle))&&
      (targetFilter.input.value!=='included'||item.row)&&(targetFilter.input.value!=='targeted'||targets.has(item.key)));
  }
  function renderTargets(){
    const rows=filteredRows(),all=routeRows();targetPage=Math.min(targetPage,Math.max(0,Math.ceil(rows.length/50)-1));
    const currentKeys=new Set(all.map(item=>item.key)),unavailable=[...targets].filter(key=>!all.some(item=>item.key===key&&item.eligible));
    targetStatus.textContent=targets.size+' exact policy targets · '+rows.length+' matching source routes'+
      (unavailable.length?' · '+unavailable.length+' target(s) need route selection, price or method correction.':'');
    const table=make('table'),head=make('thead'),header=make('tr'),body=make('tbody');
    for(const label of ['Target','Operation','Current atomic price','Source and settings'])header.append(make('th',label));head.append(header);table.append(head,body);
    for(const item of rows.slice(targetPage*50,targetPage*50+50)){
      const row=make('tr'),cell=make('td'),input=make('input');input.type='checkbox';input.checked=targets.has(item.key);
      input.setAttribute('aria-label','Policy target '+routeLabel(item.key));disabled(input,!item.eligible&&!input.checked);
      input.addEventListener('change',()=>{captureOverride();if(input.checked)targets.add(item.key);else targets.delete(item.key);targetChanged();});
      cell.append(input);row.append(cell,make('td',routeLabel(item.key)),make('td',item.row?.amountAtomic??'Not included'));
      const info=make('td');info.append(make('p',item.reason||item.operation.summary||'Included merchant route','hint'));
      if(item.operation.supported&&focusRoute){const button=make('button','Open route settings');button.type='button';button.addEventListener('click',()=>focusRoute(item.key));info.append(button);}
      if(overrides.has(item.key))info.append(make('p','Route-specific override retained','hint'));
      row.append(info);body.append(row);
    }
    targetTable.replaceChildren(table);if(!rows.length)targetTable.append(make('p',source?'No routes match this filter.':'Load an API description to choose policy targets.','empty'));
    if([...targets].some(key=>!currentKeys.has(key)))targetTable.append(make('p','Some targets are absent from this source. Clear them or reopen the original source before review.','hint'));
    pageLabel.textContent=rows.length?'Routes '+(targetPage*50+1)+'–'+Math.min((targetPage+1)*50,rows.length)+' of '+rows.length:'0 routes';
    disabled(previous,targetPage===0);disabled(next,(targetPage+1)*50>=rows.length);disabled(add,!rows.some(item=>item.eligible));disabled(remove,!rows.some(item=>targets.has(item.key)));disabled(clear,!targets.size);
    renderOverrideChoices();available(locked);
  }
  function targetChanged(){invalidateReview('Route targets or overrides changed. Review the complete configuration again.');renderTargets();}
  function captureOverride(){
    const key=overrideChoice.input.value;if(!key)return;
    const unset=[...unsetControls].filter(([,input])=>input.checked).map(([name])=>name),setText=overrideSet.value;
    if(setText.trim()!=='{}'||unset.length)overrides.set(key,{setText,unset});else overrides.delete(key);
  }
  function renderOverrideChoices(){
    const previous=overrideChoice.input.value;overrideChoice.input.replaceChildren();
    const empty=make('option','Choose a targeted route');empty.value='';overrideChoice.input.append(empty);
    for(const key of targets){const option=make('option',routeLabel(key));option.value=key;overrideChoice.input.append(option);}
    overrideChoice.input.value=targets.has(previous)?previous:'';
    if(!overrideChoice.input.value){overrideSet.value='{}';for(const input of unsetControls.values())input.checked=false;}
  }
  function selectOverride(){
    const value=overrides.get(overrideChoice.input.value);overrideSet.value=value?.setText??'{}';
    for(const [key,input]of unsetControls)input.checked=value?.unset.includes(key)??false;available(locked);
  }
  function readOverrides(){
    captureOverride();const rows=new Map(routeRows().map(item=>[item.key,item])),result=[];
    for(const key of targets){
      const value=overrides.get(key);if(!value)continue;const set=JSON.parse(value.setText);
      if(!plain(set))throw new Error(routeLabel(key)+': route override must be a JSON object.');
      if(Object.keys(set).some(field=>!FIELDS.includes(field)))throw new Error(routeLabel(key)+': choose native policy settings only.');
      if(value.unset.some(field=>Object.hasOwn(set,field)))throw new Error(routeLabel(key)+': a setting cannot be replaced and removed together.');
      if(Object.keys(set).length||value.unset.length){const row=rows.get(key);result.push({method:row.operation.method,path:row.operation.path,set,unset:[...value.unset]});}
    }
    return normalizeOperationPolicyOverrides(result,exactTargets());
  }
  function exactTargets(){
    const rows=new Map(routeRows().map(item=>[item.key,item]));
    if(!targets.size)throw new Error('Choose the exact routes to receive this policy.');
    return normalizeOperationPolicyTargets([...targets].map(key=>{const row=rows.get(key);if(!row?.eligible)throw new Error(routeLabel(key)+': '+(row?.reason||'reopen its source operation.'));return{method:row.operation.method,path:row.operation.path};}));
  }
  function fieldTable(rows){
    const table=make('table'),head=make('thead'),header=make('tr'),body=make('tbody');
    for(const value of ['Setting','Before','After'])header.append(make('th',value));head.append(header);table.append(head,body);
    for(const [field,before,after] of rows){const row=make('tr');row.append(make('th',labels[field]||field));
      for(const value of [before,after]){const cell=make('td');cell.append(make('pre',text(value),'wrap'));row.append(cell);}body.append(row);}
    const wrapper=make('div',undefined,'table-wrap');wrapper.tabIndex=0;wrapper.append(table);return wrapper;
  }
  function renderReview(){
    reviewHost.replaceChildren();if(!review)return;
    reviewHost.append(make('h3','Compiled policy change review'),make('p',review.changes.length+' changed routes · '+review.preview.routes.length+' compiled merchant routes.','small'),
      make('p','Source '+review.review.sourceSha256+' · Review '+review.review.sha256,'hint wrap'));
    for(const change of review.changes){
      const details=make('details');details.className='revision-route';
      details.append(make('summary',change.method+' '+change.path+' · '+change.kind));
      const keys=change.fields?.length?change.fields:[...new Set([...Object.keys(change.before||{}),...Object.keys(change.after||{})])];
      details.append(fieldTable(keys.map(key=>[key,change.before?.[key],change.after?.[key]])));
      const full=make('details');full.append(make('summary','Complete before and after operation'),make('pre',JSON.stringify({before:change.before,after:change.after},null,2),'wrap'));
      details.append(full);reviewHost.append(details);
    }
    const native=make('details');native.append(make('summary','Complete native merchant review'),make('pre',JSON.stringify(review.preview,null,2),'wrap'));
    const exact=make('details');exact.append(make('summary','Exact candidate plan and policy record'),make('pre',JSON.stringify({plan:review.plan,operationPolicy:review.operationPolicy},null,2),'wrap'));
    reviewHost.append(native,exact);
    if(!review.changes.length)reviewHost.append(make('p','This policy leaves the chosen native operation values unchanged.','hint'));
  }
  function retainedReview(){
    if(!review||!reviewInput||!reviewContext)throw new Error('Review the current policy changes first.');
    if(fingerprint(readContext())!==reviewContext||!equal(selectedRef(),reviewInput.policy))throw new Error('The source, merchant form or policy changed. Review the current configuration.');
    if(!equal(exactTargets(),reviewInput.targets)||!equal(readOverrides(),reviewInput.overrides))throw new Error('Route targets or overrides changed. Review again.');
    return{result:clone(review),input:clone(reviewInput),base:readContext()};
  }
  function renderApplication(){
    applicationHost.replaceChildren();if(!savedApplication)return;
    applicationHost.append(make('h3','Saved package policy'),make('p',(savedApplication.name?'Package '+savedApplication.name+' · ':'')+
      (savedApplication.formMatches?'The editor retains this exact reviewed configuration.':'This package retains its original policy application. Review editor changes before saving another package.'),'small'),
      make('pre',JSON.stringify(savedApplication.operationPolicy,null,2),'wrap'));
  }
  function available(value){
    locked=value;
    for(const node of container.querySelectorAll('input,select,textarea,button'))node.disabled=locked||node.dataset.operationPolicyDisabled==='1';
    for(const {enabled,input}of controls.values())disabled(input,!enabled.checked);
    disabled(open,!choice.input.value);disabled(saveEdition,Boolean(editorError));disabled(download,!selected);disabled(compare,!selected);
    disabled(copy,!copySource.input.value);disabled(useHead,!id.input.value.trim());disabled(reviewButton,!source||Boolean(contextError)||!targets.size||!documentMatchesSelected());
    disabled(applyButton,!review);disabled(savePackage,!review||!packageName.input.value.trim());disabled(downloadReview,!review);
    reopenAttempt.textContent=saveAttempt?'Reopen submitted '+saveAttempt.name:'Reopen submitted package';
    disabled(reopenAttempt,!saveAttempt);disabled(overrideSet,!overrideChoice.input.value);disabled(clearOverride,!overrideChoice.input.value);
    for(const input of unsetControls.values())disabled(input,!overrideChoice.input.value);
  }
  function load(){
    let current;try{current=readContext();source=current;contextError='';}catch(error){source=null;contextError=error.message;}
    invalidateReview('Choose a saved policy edition and exact routes to review this configuration.');
    methodFilter.input.replaceChildren();for(const value of ['',...new Set((source?.operations||[]).map(row=>row.method).filter(Boolean))]){
      const option=make('option',value||'All methods');option.value=value;methodFilter.input.append(option);}
    const previous=copySource.input.value;copySource.input.replaceChildren();const empty=make('option','Choose a route');empty.value='';copySource.input.append(empty);
    for(const row of current?.plan.operations||[]){const key=routeKey(row),option=make('option',routeLabel(row));option.value=key;copySource.input.append(option);}
    copySource.input.value=previous;targetPage=0;renderTargets();
  }
  function changed(){
    if(savedApplication){savedApplication={...savedApplication,formMatches:false};renderApplication();}
    try{source=readContext();contextError='';}catch(error){contextError=error.message;}
    invalidateReview('Merchant settings changed. Review the current source and configuration before saving this policy application.');
    renderTargets();
  }
  function saved(value){
    savedApplication=value?.operationPolicy?clone(value):null;renderApplication();available(locked);
  }
  choice.input.addEventListener('change',()=>{revision.input.value='';available(locked);});
  open.addEventListener('click',()=>act(async()=>{await openPolicy(choice.input.value,revision.input.value.trim());notice('Opened the exact saved policy edition.');}));
  reload.addEventListener('click',()=>act(async()=>{await refresh();notice('Policy editions refreshed.');}));
  fresh.addEventListener('click',()=>{selected=null;headSha256=null;loadedId=null;id.input.value='';title.input.value='';description.value='';
    for(const control of controls.values())control.enabled.checked=false;revision.input.value='';choice.input.value='';comparison.replaceChildren();historyRows=[];historyNext=null;renderHistory();editChanged();panel.open=true;id.input.focus();});
  for(const input of [id.input,title.input,description,...methods.values()])input.addEventListener('input',editChanged);
  saveEdition.addEventListener('click',()=>act(async()=>{
    const policy=documentFromEditor(),expectedHeadSha256=loadedId===policy.id?headSha256:null;
    const result=await api('operation-policies/save',{policy,expectedHeadSha256});
    if(!equal(normalizeOperationPolicy(result.policy),policy))throw new Error('The saved policy response differs from the requested edition.');
    setDocument(result.policy,result);await refresh();choice.input.value=policy.id;notice('Saved policy '+policy.id+' · '+result.sha256+'.');
  }));
  download.addEventListener('click',()=>act(async()=>{
    const chosen=clone(selected);if(!chosen)throw new Error('Open a saved edition first.');
    const result=await api('operation-policies/export?id='+encodeURIComponent(chosen.policy.id)+'&sha256='+encodeURIComponent(chosen.sha256));
    if(result.sha256!==chosen.sha256||!equal(result.policy,chosen.policy)||result.file?.text!==operationPolicyText(result.policy))throw new Error('The selected policy edition changed.');
    downloadFile(result.file.text,result.file.filename);notice('Downloaded the complete selected policy edition.');
  }));
  file.addEventListener('change',()=>act(async()=>{
    const chosen=file.files[0];if(!chosen)return;if(chosen.size>OPERATION_POLICY_BYTES)throw new Error('Choose a complete policy JSON file of at most '+OPERATION_POLICY_BYTES+' bytes.');
    const policy=normalizeOperationPolicy(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await chosen.arrayBuffer())));
    setDocument(policy);file.value='';panel.open=true;notice('Imported the complete policy. Choose its ID and save an edition before applying it.');
  }));
  compare.addEventListener('click',()=>safely(renderEditionComparison));
  useHead.addEventListener('click',()=>act(async()=>{
    const draft=documentFromEditor(),view=await api('operation-policies/load?id='+encodeURIComponent(draft.id));
    if(view.policy?.id!==draft.id||typeof view.headSha256!=='string')throw new Error('The current head response does not match this policy.');
    selected=view;loadedId=draft.id;headSha256=view.headSha256;historyRows=view.history?.items??[];historyNext=view.history?.nextOffset??null;historyTotal=view.history?.total??historyRows.length;
    renderHistory();editChanged();renderEditionComparison();notice('Compared with current saved head. Saving this draft will use that exact observed edition.');
  }));
  copySource.input.addEventListener('change',()=>available(locked));
  copy.addEventListener('click',()=>safely(()=>{
    const row=readContext().plan.operations.find(row=>routeKey(row)===copySource.input.value);if(!row)throw new Error('Choose an included merchant route.');
    for(const[key,control]of controls){control.enabled.checked=Object.hasOwn(row,key);if(control.enabled.checked)control.input.value=objects.has(key)?JSON.stringify(row[key],null,2):String(row[key]);}
    for(const[method,input]of methods)input.checked=method===row.method;editChanged();notice('Copied this route’s native settings into the policy editor.');
  }));
  query.input.addEventListener('input',()=>{targetPage=0;renderTargets();});
  for(const input of [methodFilter.input,targetFilter.input])input.addEventListener('change',()=>{targetPage=0;renderTargets();});
  add.addEventListener('click',()=>{captureOverride();for(const row of filteredRows())if(row.eligible)targets.add(row.key);targetChanged();});
  remove.addEventListener('click',()=>{captureOverride();for(const row of filteredRows())targets.delete(row.key);targetChanged();});
  clear.addEventListener('click',()=>{captureOverride();targets.clear();targetChanged();});
  previous.addEventListener('click',()=>{targetPage--;renderTargets();});next.addEventListener('click',()=>{targetPage++;renderTargets();});
  overrideChoice.input.addEventListener('change',selectOverride);
  overrideSet.addEventListener('input',()=>{captureOverride();invalidateReview('Route override changed. Review the complete configuration again.');available(locked);});
  for(const input of unsetControls.values())input.addEventListener('change',()=>{captureOverride();invalidateReview('Route override changed. Review the complete configuration again.');available(locked);});
  clearOverride.addEventListener('click',()=>{overrides.delete(overrideChoice.input.value);selectOverride();targetChanged();});
  reviewButton.addEventListener('click',()=>act(async()=>{
    const current=readContext(),input={specText:current.specText,plan:current.plan,policy:selectedRef(),targets:exactTargets(),overrides:readOverrides(),
      ...(current.capturedSource?{capturedSource:current.capturedSource}:{})},before=fingerprint(current);
    const result=await api('operation-policies/review',input);
    if(fingerprint(readContext())!==before)throw new Error('The merchant configuration changed during review.');
    if(result?.review?.sourceSha256!==current.sourceSha256||result.review.policySha256!==input.policy.sha256||!plain(result.plan)||!Array.isArray(result.changes)||!Array.isArray(result.preview?.routes))
      throw new Error('The compiled review does not match this source and policy edition.');
    review=result;reviewInput=clone(input);reviewContext=before;renderReview();available(locked);
    notice('The original merchant compiler accepted the policy. Review each change and save its exact package.');
  }));
  packageName.input.addEventListener('input',()=>available(locked));
  savePackage.addEventListener('click',()=>act(async()=>{
    const accepted=retainedReview(),name=packageName.input.value.trim();if(!name)throw new Error('Enter a new merchant package name.');
    saveAttempt={name,input:clone(accepted.input),result:clone(accepted.result)};
    available(locked);
    let result;
    try{result=await api('operation-policies/package',{...accepted.input,name,expectedReviewSha256:accepted.result.review.sha256});}
    catch(error){available(locked);if(error.outcomeUnknown)error.message='The package save response is unavailable. Reopen the submitted package or retry this same name and review. '+error.message;throw error;}
    if(result.name!==name||result.review?.sha256!==accepted.result.review.sha256||!equal(result.operationPolicy,accepted.result.operationPolicy))throw new Error('The package response differs from the reviewed policy application.');
    await onSaved(result,accepted);saveAttempt=null;notice((result.state==='REOPENED'?'Reopened ':'Saved ')+name+' with the complete reviewed policy application.');
  }));
  reopenAttempt.addEventListener('click',()=>act(async()=>{
    if(!saveAttempt)throw new Error('There is no submitted package to reopen.');
    const attempt=clone(saveAttempt),loaded=await api('load?name='+encodeURIComponent(attempt.name));
    if(loaded.specText!==attempt.input.specText||!equal(loaded.plan,attempt.result.plan)||!equal(loaded.operationPolicy,attempt.result.operationPolicy))
      throw new Error('The saved package has different source, plan or policy history. Keep the original name and review selected.');
    await onSaved({...loaded,state:'REOPENED',review:attempt.result.review},attempt);saveAttempt=null;notice('Reopened '+attempt.name+' from its original saved policy application.');
  }));
  applyButton.addEventListener('click',()=>act(async()=>{
    const accepted=retainedReview();await apply(accepted.result,accepted.base);saved({operationPolicy:accepted.result.operationPolicy,formMatches:true});
    notice('Applied the reviewed policy to the existing merchant editor. Save the configuration with the original package controls.');
  }));
  downloadReview.addEventListener('click',()=>safely(()=>{const accepted=retainedReview();downloadFile({schema:'stellar-forge.api-operation-policy-browser-review.v1',
    request:accepted.input,...accepted.result},selected.policy.id+'-review-'+accepted.result.review.sha256.slice(0,12)+'.json');}));
  function target(operation){
    if(locked)return;
    captureOverride();targets.add(routeKey(operation));targetChanged();panel.open=true;
    panel.scrollIntoView({behavior:'smooth',block:'start'});choice.input.focus({preventScroll:true});
    notice('Added '+routeLabel(operation)+' as an explicit target. Select its policy edition and review the complete changes.');
  }
  editChanged();load();
  return{refresh,load,changed,saved,available,openPolicy,target};
}
