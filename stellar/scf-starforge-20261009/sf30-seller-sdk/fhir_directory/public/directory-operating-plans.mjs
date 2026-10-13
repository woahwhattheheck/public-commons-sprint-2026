// MIT. Complete Directory procedures using the native original OperatingPlan model.
const API = '/api/directory';
const KINDS = { editionId:'editions', mappingId:'mappings', previewId:'mappingPreviews',
  conversionId:'sourceConversions', selectionId:'selections', referralJoinId:'referralJoins', handoffId:'handoffs' };
const FIELD_LABELS = { editionId:'Original source edition', mappingId:'Reviewed mapping',
  previewId:'Saved mapping preview', conversionId:'Native FHIR conversion', selectionId:'Reviewed service choice',
  referralJoinId:'Original referral assignment', handoffId:'Complete receiving handoff' };
const STATES = ['planned','in-progress','completed','skipped'];
const clone = value => JSON.parse(JSON.stringify(value));
const idPart = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
const now = () => new Date().toISOString();
function node(tag, props={}, ...children) {
  const el = document.createElement(tag);
  for (const [key,value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2),value);
    else if (value !== null && value !== undefined) el.setAttribute(key,String(value));
  }
  for (const item of children.flat(Infinity)) if (item !== null && item !== undefined)
    el.append(item instanceof Node ? item : document.createTextNode(String(item)));
  return el;
}
function button(label, action, primary=false, props={}) {
  return node('button',{type:'button',class:primary?'dop-primary':'',onclick:action,...props},label);
}
function details(title,value,open=false) {
  const el=node('details',{class:'dop-details'},node('summary',{},title),node('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2)));
  if(open)el.open=true; return el;
}
function fileJSON(name,value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const a=node('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function plain(value){return value && typeof value==='object'&&!Array.isArray(value);}

/**
 * The host retains its existing authenticated JSON API and complete file
 * download path. Drafts live only in this browser session until saved natively.
 */
export function mountDirectoryOperatingPlans({root,api,download,notify=()=>{},getState}) {
  if(!(root instanceof HTMLElement)||typeof api!=='function'||typeof download!=='function'||typeof getState!=='function')
    throw new TypeError('Operating Plans requires the original Directory host API and root.');
  root.classList.add('directory-operating-plans');
  const S={active:false,disposed:false,busy:false,state:null,workspaceId:null,key:null,
    records:[],nextOffset:null,total:0,query:'',record:null,document:null,draft:null,
    selectedStep:null,revision:null,create:null,preview:null,basis:null,catalog:null,
    mode:'create',dirty:false,message:'',error:'',storageError:'',comparison:null,recordedAt:null,
    receivedText:'',stepRegistration:'',sourceSearch:{},rawInputs:{continuations:null,argv:{}}};
  const status=node('div',{class:'dop-status','role':'status','aria-live':'polite'});
  const content=node('div',{class:'dop-content'});
  const list=node('aside',{class:'dop-library','aria-label':'Saved procedure histories'});
  const toolbar=node('header',{class:'dop-toolbar'});
  const shell=node('section',{class:'dop-shell'},toolbar,status,node('div',{class:'dop-layout'},list,content));
  root.replaceChildren(shell);
  const currentDraft=()=>({schema:'stellar-forge.directory-operating-editor.v1',workspaceId:S.workspaceId,
    mode:S.mode,recordId:S.record?.id??null,create:S.create,draft:S.draft,
    selectedStep:S.selectedStep,previewRecordId:S.preview?.record?.id??null,
    receivedText:S.receivedText,rawInputs:S.rawInputs,updatedAt:now()});
  function originalRawInputs(value){
    if(value===undefined)return {continuations:null,argv:{}};
    if(!plain(value)||Object.keys(value).some(key=>!['continuations','argv'].includes(key))||
      !(value.continuations===null||value.continuations===undefined||typeof value.continuations==='string')||
      !plain(value.argv??{})||Object.values(value.argv??{}).some(text=>typeof text!=='string'))
      throw new Error('Keep the complete original working JSON text and step argument text.');
    return {continuations:value.continuations??null,argv:{...(value.argv??{})}};
  }
  function argumentValue(text){
    const value=JSON.parse(text);
    if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))
      throw new Error('Use the exact JSON string array.');
    return value;
  }
  function validateRawInputs(){
    if(S.mode==='create'&&typeof S.rawInputs.continuations==='string'){
      const value=JSON.parse(S.rawInputs.continuations);
      if(!Array.isArray(value))throw new Error('Choose an array of complete continuation steps.');
      S.create.continuations=value;
    }
    if(S.mode==='edit')for(const step of S.draft.content.steps){
      if(Object.hasOwn(S.rawInputs.argv,step.id))step.argv=argumentValue(S.rawInputs.argv[step.id]);
    }
  }
  function persist() {
    if(!S.key)return;
    try { sessionStorage.setItem(S.key,JSON.stringify(currentDraft()));S.storageError=''; }
    catch { S.storageError='This complete draft exceeds available browser session storage. It remains in this open editor; download the full draft before leaving.'; }
    renderStatus();
  }
  function changed({create=false}={}) {
    S.dirty=true;if(create){S.preview=null;S.comparison=null;}persist();
  }
  function renderStatus() {
    status.replaceChildren();
    if(S.busy)status.append(node('p',{},'Reading or saving the complete native record…'));
    if(S.error)status.append(node('p',{class:'dop-error',role:'alert'},S.error));
    if(S.message)status.append(node('p',{class:'dop-success'},S.message));
    if(S.storageError)status.append(node('p',{class:'dop-warning'},S.storageError));
    if(S.dirty)status.append(node('p',{class:'dop-draft-state'},'Working draft has unsaved changes.'));
  }
  async function job(work) {
    if(S.busy||S.disposed)return;
    S.busy=true;S.error='';S.message='';renderStatus();
    try { await work(); }
    catch(error){S.error=String(error?.message??error);notify(S.error,'error');}
    finally{S.busy=false;if(!S.disposed){render();persist();}}
  }
  async function get(path){return api(path,{method:'GET'});}
  async function post(action,body){return api(API+'/operating-plans/'+action,{method:'POST',body});}
  function field(label,value,set,{multiline=false,type='text',rows=3,help='',required=false,testid}={}) {
    const input=node(multiline?'textarea':'input',{...(multiline?{rows}:{type}),
      'data-testid':testid??undefined,required:required?'required':undefined});
    input.value=value??'';
    input.addEventListener('input',()=>set(input.value));
    return node('label',{class:multiline?'dop-field dop-wide':'dop-field'},node('span',{},label),input,help?node('small',{},help):null);
  }
  function selectField(label,value,options,set,testid) {
    const input=node('select',{'data-testid':testid});
    for(const [id,title]of options)input.append(node('option',{value:id},title));
    input.value=value??'';
    input.addEventListener('change',()=>set(input.value));
    return node('label',{class:'dop-field'},node('span',{},label),input);
  }
  function actor() { return S.create?.actor||S.draft?.content?.owner||S.record?.actor||''; }
  function defaultInput() {
    const state=S.state;
    return {id:'directory-procedure-'+idPart(),title:'Directory source, service and receiving procedure',
      customer:'',purpose:'Continue the reviewed directory source, service selection and complete receiving workflow.',
      period:'',owner:state?.operatingActor??'',receiving:'',savedAt:now(),outputDirectory:typeof (state?.workspace??state?.root)==='string' && (state.workspace??state.root).startsWith('/') ? (state.workspace??state.root)+'/procedure-exports' : '',
      recorded:true,basis:{editionId:''},continuations:[],actor:state?.operatingActor??'',notes:'',note:''};
  }
  function countLabel(kind) {
    const rows=S.state?.directory?.[kind]??[];
    const total=S.state?.directory?.collections?.[kind]?.total??rows.length;
    return rows.length===total?String(total):rows.length+' of '+total+' shown';
  }
  function recordPicker(fieldName) {
    const kind=KINDS[fieldName],value=S.create.basis[fieldName]??'';
    const listId='dop-'+fieldName+'-'+S.workspaceId;
    const original=S.state?.directory?.[kind]??[];
    const found=S.sourceSearch[fieldName]?.rows??[];
    const rows=[...new Map([...original,...found].map(r=>[r.id,r])).values()];
    const input=node('input',{list:listId,placeholder:fieldName==='editionId'?'Required exact edition ID':'Optional exact original ID',
      'data-testid':'dop-'+fieldName});input.value=value;
    input.addEventListener('input',()=>{S.create.basis[fieldName]=input.value||null;if(fieldName==='editionId'&&input.value==='')S.create.basis.editionId='';changed({create:true});});
    const dl=node('datalist',{id:listId});
    for(const r of rows)dl.append(node('option',{value:r.id},r.label??r.summary?.title??r.id));
    const search=node('input',{placeholder:'Find original label or ID','aria-label':'Find '+FIELD_LABELS[fieldName]});
    const result=node('small',{},countLabel(kind)+' original records. Enter an exact ID or search the native collection.');
    const find=button('Find',()=>job(async()=>{
      const page=await get(API+'/'+kind+'?offset=0&limit=100&query='+encodeURIComponent(search.value));
      S.sourceSearch[fieldName]=page;
      S.message='Read '+page.rows.length+' of '+page.total+' matching '+FIELD_LABELS[fieldName].toLowerCase()+'. Exact IDs remain selectable.';
    }));
    return node('div',{class:'dop-field'},node('label',{},FIELD_LABELS[fieldName],input),dl,
      node('div',{class:'dop-find'},search,find),result);
  }
  async function loadRecords(reset=true) {
    const offset=reset?0:S.nextOffset;
    if(offset===null)return;
    const page=await get(API+'/operatingPlans?offset='+offset+'&limit=100&query='+encodeURIComponent(S.query));
    if(!Array.isArray(page.rows)||page.offset!==offset)throw new Error('The complete native procedure page has an unexpected identity.');
    const previous=reset?[]:S.records;
    const ids=new Set(previous.map(r=>r.id));
    if(page.rows.some(r=>ids.has(r.id)))throw new Error('The native procedure page repeats a retained record.');
    S.records=[...previous,...page.rows];S.total=page.total;S.nextOffset=page.nextOffset;
  }
  function leaveWorking(){
    if(!S.dirty&&!S.storageError)return true;
    return window.confirm('This procedure has an unsaved working draft. Download it before replacing it if you need to keep it. Continue with the selected history?');
  }
  function renderList() {
    const query=node('input',{placeholder:'Find plan, customer or ID','aria-label':'Find saved procedure'});
    query.value=S.query;query.addEventListener('change',()=>{S.query=query.value;job(()=>loadRecords());});
    list.replaceChildren(node('h3',{},'Procedure library'),node('p',{class:'dop-muted'},S.records.length+' of '+S.total+' retained records'),query,
      node('div',{class:'dop-actions'},button('New procedure',()=>job(async()=>{if(!leaveWorking())return;persist();S.create=defaultInput();S.record=null;S.document=null;S.draft=null;S.preview=null;S.basis=null;S.mode='create';S.rawInputs=originalRawInputs();S.dirty=false;})),
        button('Refresh',()=>job(()=>loadRecords()))));
    const nav=node('nav',{'aria-label':'Retained procedure records'});
    for(const r of S.records) {
      const selected=S.record?.id===r.id;
      nav.append(button('',()=>job(()=>leaveWorking()?openRecord(r.id):undefined),false,{'aria-current':selected?'true':'false',
        'data-record-id':r.id,'data-stage':r.stage}));
      const b=nav.lastElementChild;b.classList.add('dop-record');
      b.append(node('strong',{},r.summary?.title??r.planId),
        node('span',{},r.stage==='prepared'?'Prepared preview':('Revision '+r.revision+' · saved')),
        node('small',{},r.summary?.customer??''),node('code',{},r.id.slice(0,16)));
    }
    if(!S.records.length)nav.append(node('p',{class:'dop-muted'},'Prepare a procedure from an original source edition, or receive a complete OperatingPlan JSON.'));
    list.append(nav);
    if(S.nextOffset!==null)list.append(button('Load next records',()=>job(()=>loadRecords(false)),false,{'data-testid':'dop-next-records'}));
  }
  async function openRecord(id) {
    persist();
    const record=await get(API+'/operatingPlans/'+encodeURIComponent(id));
    const [document,basis]=await Promise.all([get(API+'/operatingPlans/'+id+'/document'),get(API+'/operatingPlans/'+id+'/basis')]);
    if(document.schema!=='stellar-forge.operating-plan.v1'||document.id!==record.planId||document.revisions.length!==record.revision)
      throw new Error('The complete saved document and native record disagree.');
    S.record=record;S.document=document;S.basis=basis;S.comparison=null;S.revision=document.revisions.length;S.rawInputs=originalRawInputs();
    if(record.stage==='prepared') {
      S.create=await get(API+'/operatingPlans/'+id+'/input');
      S.preview={record,document,basis,summary:record.summary};
      S.mode='create';S.draft=null;
    } else {
      S.draft=await get(API+'/operatingPlans/'+id+'/draft');
      S.mode='edit';S.preview=null;S.selectedStep=S.draft.content.steps[0]?.id??null;
    }
    S.dirty=false;
    S.message=record.stage==='prepared'?'Opened the exact retained preview and its original input.':'Opened the complete original procedure history.';
  }
  function renderCreate() {
    const input=S.create??(S.create=defaultInput());
    const set=(key,value)=>{input[key]=value;changed({create:true});};
    content.append(node('h2',{},'Prepare a Directory procedure'),node('p',{class:'dop-lead'},
      'Select the original source and reviewed decisions. The first revision describes the procedure; an optional second revision records the native records already present.'));
    const fields=node('div',{class:'dop-fields'},
      field('Procedure ID',input.id,v=>set('id',v),{required:true,testid:'dop-plan-id'}),
      field('Title',input.title,v=>set('title',v),{required:true,testid:'dop-title'}),
      field('Customer or operating team',input.customer,v=>set('customer',v),{required:true,testid:'dop-customer'}),
      field('Period or recurrence',input.period,v=>set('period',v),{testid:'dop-period'}),
      field('Operating owner',input.owner,v=>set('owner',v),{required:true,testid:'dop-owner'}),
      field('Record author',input.actor,v=>set('actor',v),{required:true,testid:'dop-actor'}),
      field('Useful result',input.purpose,v=>set('purpose',v),{multiline:true,testid:'dop-purpose'}),
      field('Receiving owner and continuation',input.receiving,v=>set('receiving',v),{multiline:true,required:true,testid:'dop-receiving'}),
      field('Original plan creation time (UTC)',input.savedAt,v=>set('savedAt',v),{testid:'dop-saved-at'}),
      field('Explicit future export directory',input.outputDirectory,v=>set('outputDirectory',v),{required:true,testid:'dop-output'}),
      field('Procedure notes',input.notes,v=>set('notes',v),{multiline:true,testid:'dop-notes'}));
    content.append(fields,node('h3',{},'Original native basis'));
    const picks=node('div',{class:'dop-fields'});
    for(const key of Object.keys(KINDS))picks.append(recordPicker(key));
    content.append(picks);
    const advanced=node('details',{class:'dop-details'},node('summary',{},'Context sources, comparisons and explicit continuations'));
    for(const [key,label]of [['contextSourceIds','Additional original source IDs'],['comparisonIds','Original edition comparison IDs'],
      ['conformanceAssessmentIds','Retained conformance assessment IDs'],['receivingReviewIds','Actual receiving review IDs']]){
      advanced.append(field(label,(input.basis[key]??[]).join('\n'),v=>{
        input.basis[key]=v.split(/\s+/).filter(Boolean);changed({create:true});
      },{multiline:true,help:'One exact native record ID per line. Complete records remain in the original workspace.'}));
    }
    const continuation=node('textarea',{rows:8,'data-testid':'dop-continuations','aria-label':'Explicit continuation steps JSON'});
    continuation.value=S.rawInputs.continuations??JSON.stringify(input.continuations??[],null,2);
    const readContinuation=()=>{
      S.rawInputs.continuations=continuation.value;
      try{const v=JSON.parse(continuation.value);if(!Array.isArray(v))throw new Error('Choose an array of complete steps.');input.continuations=v;continuation.setCustomValidity('');}
      catch(error){continuation.setCustomValidity(error.message);S.error='Keep valid complete JSON for the continuation steps.';}
      changed({create:true});
    };
    continuation.addEventListener('input',readContinuation);
    try{const v=JSON.parse(continuation.value);if(!Array.isArray(v))throw new Error('Choose an array of complete steps.');}
    catch(error){continuation.setCustomValidity(error.message);}
    advanced.append(node('label',{class:'dop-field'},'Optional original recurring programme or other manual continuation',continuation),
      node('small',{},'Keep the actual programme path, workspace, input SHA and authority in each step. Adding a step does not execute it or start another cycle.'));
    content.append(advanced);
    const recorded=node('input',{type:'checkbox','data-testid':'dop-recorded'});recorded.checked=input.recorded!==false;
    recorded.addEventListener('change',()=>set('recorded',recorded.checked));
    content.append(node('label',{class:'dop-check'},recorded,'Append the actual retained-record observation as revision 2'));
    content.append(node('div',{class:'dop-actions'},
      button('Prepare complete preview',()=>job(async()=>{
        validateRawInputs();if(!continuation.checkValidity())throw new Error(continuation.validationMessage);
        const preview=await post('preview',clone(input));S.preview=preview;S.record=preview.record;S.document=preview.document;S.basis=preview.basis;
        S.dirty=false;S.message='The complete original preview is retained. Review its steps and findings before saving.';await loadRecords();
      }),true,{'data-testid':'dop-preview'}),
      button('Download complete draft',()=>{persist();fileJSON(input.id+'-directory-draft.json',currentDraft());})));
    if(S.preview) {
      renderSummary(S.preview.summary);
      content.append(node('p',{class:'dop-muted'},'Prepared record '+S.preview.record.id),details('Original native basis and unresolved findings',S.preview.basis),
        details('Complete original OperatingPlan JSON',S.preview.document),
        node('ol',{class:'dop-preview-steps'},S.preview.document.revisions.at(-1).steps.map(step=>node('li',{},
          node('strong',{},step.title),node('span',{class:'dop-badge'},step.status),node('p',{},step.instruction),
          step.recordedResult?details('Recorded original observation',step.recordedResult):null))));
      content.append(node('div',{class:'dop-actions'},button('Save this exact preview',()=>job(async()=>{
        const result=await post('create',{...clone(input),previewRecordId:S.preview.record.id});
        await loadRecords();await openRecord(result.record.id);
        S.message=result.reused?'Reopened the existing exact saved procedure.':'Saved the exact reviewed preview and its complete original history.';
      }),true,{'data-testid':'dop-create'})));
    }
    content.append(node('hr'),renderReceive());
  }
  function renderSummary(summary) {
    const counts=node('dl',{class:'dop-counts'},node('dt',{},'Saved revisions'),node('dd',{},summary.revisions??summary.revision),
      node('dt',{},'Steps'),node('dd',{},summary.steps));
    for(const state of STATES)counts.append(node('dt',{},state.replace('-',' ')),node('dd',{},summary.counts?.[state]??0));
    content.append(counts);
  }
  async function saveDraft() {
    if(!S.record||!S.draft)throw new Error('Open the original saved procedure first.');
    validateRawInputs();const invalid=content.querySelector('textarea:invalid');
    if(invalid)throw new Error(invalid.validationMessage);
    persist();
    const result=await post('save',{recordId:S.record.id,draft:clone(S.draft),savedAt:now(),
      actor:actor(),note:'Operator saved the complete reviewed procedure draft.'});
    await loadRecords();await openRecord(result.record.id);
    S.message=result.reused?'The complete draft matches the saved history; no extra revision was created.':'Saved a new revision while retaining every original revision.';
  }
  function renderStepEditor() {
    const steps=S.draft.content.steps;
    if(!steps.some(s=>s.id===S.selectedStep))S.selectedStep=steps[0]?.id??null;
    const navigation=node('ol',{class:'dop-step-list','aria-label':'Operating step order'});
    steps.forEach((step,index)=>navigation.append(node('li',{},button((index+1)+'. '+step.title,()=>{
      S.selectedStep=step.id;persist();render();
    },false,{'aria-current':S.selectedStep===step.id?'step':'false','data-step-id':step.id}),
    node('span',{class:'dop-badge'},step.status))));
    const editor=node('section',{class:'dop-step-editor'});
    const step=steps.find(s=>s.id===S.selectedStep);
    if(step) {
      const set=(key,value)=>{step[key]=value;changed();};
      editor.append(node('h3',{},'Selected step'),node('code',{},step.id),
        field('Title',step.title,v=>set('title',v),{testid:'dop-step-title'}),
        selectField('Recorded state',step.status,STATES.map(v=>[v,v]),v=>set('status',v),'dop-step-status'),
        field('Operating owner',step.owner,v=>set('owner',v),{testid:'dop-step-owner'}),
        field('Due date',step.due,v=>set('due',v),{type:'date',testid:'dop-step-due'}),
        field('Work',step.instruction,v=>set('instruction',v),{multiline:true,rows:5,testid:'dop-step-work'}),
        field('Exact inputs and original identities',step.inputs,v=>set('inputs',v),{multiline:true,rows:7,testid:'dop-step-inputs'}),
        field('Expected result',step.expectedResult,v=>set('expectedResult',v),{multiline:true,testid:'dop-step-expected'}),
        field('Recorded result',step.recordedResult,v=>set('recordedResult',v),{multiline:true,rows:6,testid:'dop-step-result',
          help:'Record actual observed work. A saved step or command selection does not execute its arguments.'}));
      const argv=node('textarea',{rows:4,'data-testid':'dop-step-argv','aria-label':'Exact command argument array'});
      argv.value=S.rawInputs.argv[step.id]??JSON.stringify(step.argv,null,2);
      argv.addEventListener('input',()=>{
        S.rawInputs.argv[step.id]=argv.value;
        try{step.argv=argumentValue(argv.value);argv.setCustomValidity('');}
        catch(error){argv.setCustomValidity(error.message);S.error=error.message;}
        changed();
      });
      try{argumentValue(argv.value);}catch(error){argv.setCustomValidity(error.message);}
      editor.append(node('label',{class:'dop-field'},'Exact argument array',argv),
        details('Retained original command registration',step.selection));
      const at=steps.indexOf(step);
      const move=amount=>{if(at+amount<0||at+amount>=steps.length)return;steps.splice(at,1);steps.splice(at+amount,0,step);changed();render();};
      editor.append(node('div',{class:'dop-actions'},
        button('Move up',()=>move(-1),false,{disabled:at===0?'disabled':undefined,'data-testid':'dop-step-up'}),
        button('Move down',()=>move(1),false,{disabled:at===steps.length-1?'disabled':undefined,'data-testid':'dop-step-down'}),
        button('Duplicate step',()=>{const copied=clone(step);copied.id='step-'+idPart();copied.title=step.title+' — copy';copied.status='planned';copied.recordedResult='';steps.splice(at+1,0,copied);S.selectedStep=copied.id;changed();render();}),
        button('Remove from this draft',()=>{steps.splice(at,1);S.selectedStep=steps[at]?.id??steps.at(-1)?.id??null;changed();render();})));
    } else editor.append(node('p',{},'Add a selected registered command or a manual operating step.'));
    return node('div',{class:'dop-step-layout'},navigation,editor);
  }
  function renderReceive() {
    const section=node('section',{class:'dop-receive'},node('h3',{},'Receive an original OperatingPlan'));
    const file=node('input',{type:'file',accept:'.json,application/json','data-testid':'dop-import-file'});
    file.addEventListener('change',()=>job(async()=>{
      const original=file.files?.[0];if(!original)return;
      if(original.size>32*1024*1024)throw new Error('The complete OperatingPlan JSON maximum is 32 MiB.');
      S.receivedText=await original.text();JSON.parse(S.receivedText);S.dirty=true;
      S.message='Read the complete selected JSON. Review its identity and choose the current saved record or an explicit new basis before receiving.';
    }));
    const text=node('textarea',{rows:8,'data-testid':'dop-import-json','aria-label':'Complete original OperatingPlan JSON'});
    text.value=S.receivedText;text.addEventListener('input',()=>{S.receivedText=text.value;changed();});
    section.append(file,text,node('p',{class:'dop-muted'},'Receive preserves every shared revision. A different original identity or divergent edit is rejected; keep both documents and use a new copy ID.'));
    section.append(button('Receive complete history',()=>job(async()=>{
      const document=JSON.parse(S.receivedText);
      if(document.schema!=='stellar-forge.operating-plan.v1')throw new Error('Choose a complete original OperatingPlan JSON, not a draft or export index.');
      const same=S.record?.stage==='saved'&&S.record.planId===document.id;
      const payload={document,expectedRecordId:same?S.record.id:null,actor:actor(),
        note:'Operator selected this complete original OperatingPlan history for native receiving.'};
      if(!same){if(!S.create?.basis?.editionId)throw new Error('Choose the original Directory basis in New procedure for this newly received plan.');payload.basis=clone(S.create.basis);}
      const result=await post('receive',payload);await loadRecords();await openRecord(result.record.id);
      S.receivedText='';S.message=result.reused?'The received complete history is already retained.':'Received '+result.addedRevisions+' additional original revisions.';
    }),false,{'data-testid':'dop-receive'}));
    return section;
  }
  function renderEdit() {
    const doc=S.document,draft=S.draft,record=S.record;
    if(!doc||!draft)return;
    content.append(node('h2',{},draft.content.title),node('p',{class:'dop-lead'},'Complete editable procedure · '+doc.id+
      ' · original revision '+draft.baseRevision),node('p',{class:'dop-muted'},'Native record '+record.id));
    renderSummary(record.summary);
    const set=(key,value)=>{draft.content[key]=value;changed();};
    const identity=node('details',{class:'dop-details'},node('summary',{},'Customer, owner and receiving scope'),
      node('div',{class:'dop-fields'},
        field('Title',draft.content.title,v=>set('title',v),{testid:'dop-edit-title'}),
        field('Customer',draft.content.customer,v=>set('customer',v)),
        field('Operating owner',draft.content.owner,v=>set('owner',v)),
        field('Period or recurrence',draft.content.period,v=>set('period',v)),
        field('Useful result',draft.content.purpose,v=>set('purpose',v),{multiline:true}),
        field('Receiving and continuation',draft.content.receiving,v=>set('receiving',v),{multiline:true}),
        field('Notes and original scope',draft.content.notes,v=>set('notes',v),{multiline:true,rows:7})));
    content.append(identity);
    const history=selectField('Original saved revision',String(S.revision),doc.revisions.map(r=>[String(r.revision),'Revision '+r.revision+' · '+r.savedAt]),value=>job(async()=>{
      if(!leaveWorking())return;persist();S.revision=Number(value);S.draft=await get(API+'/operatingPlans/'+record.id+'/draft?revision='+value);S.rawInputs=originalRawInputs();
      S.selectedStep=S.draft.content.steps[0]?.id??null;S.dirty=true;
      S.message='Opened that original revision as a draft against the current selected saved history. Saving retains the intervening revisions.';
    }),'dop-history');
    content.append(node('div',{class:'dop-actions'},history,
      button('Save new revision',()=>job(saveDraft),true,{'data-testid':'dop-save'}),
      button('Download complete draft',()=>{persist();fileJSON(doc.id+'-draft.json',currentDraft());},false,{'data-testid':'dop-download-draft'}),
      button('Discard working edits',()=>job(()=>openRecord(record.id)))));
    const commands=(S.catalog?.items??[]).filter(x=>x.kind==='command');
    const command=selectField('Add a registered command',S.stepRegistration,[['','Manual operating step'],...commands.map(i=>[i.id,i.name+' — '+i.description])],v=>{S.stepRegistration=v;},'dop-registration');
    content.append(node('div',{class:'dop-actions'},command,button('Add step',()=>job(async()=>{
      const step=await post('step',{id:'step-'+idPart(),...(S.stepRegistration?{itemId:S.stepRegistration}:{}),
        ...(S.stepRegistration?{}:{title:'Manual operating step'}),owner:draft.content.owner});
      draft.content.steps.push(step);S.selectedStep=step.id;changed();
    }),false,{'data-testid':'dop-add-step'})));
    content.append(renderStepEditor());
    const copyId=node('input',{'aria-label':'New copy plan ID',placeholder:'New unique plan ID','data-testid':'dop-copy-id'});
    const copyTitle=node('input',{'aria-label':'New copy title',placeholder:'Optional title for the copy'});
    content.append(node('h3',{},'Full history and handoff'),node('div',{class:'dop-actions'},
      ...[['json','Editable JSON'],['markdown','Readable Markdown'],['html','Printable HTML']].map(([format,label])=>button(label,()=>job(async()=>{
        const exported=await post('export',{recordId:record.id,format,revision:S.revision,actor:actor()});
        await download(API+'/exports/'+exported.id+'/file',exported.name);
        S.message='Received the complete '+label.toLowerCase()+' through the original native file route.';
      }),false,{'data-testid':'dop-export-'+format})),
      button('Compare current registrations',()=>job(async()=>{S.comparison=await post('compare',{recordId:record.id,revision:S.revision});}),false,{'data-testid':'dop-compare'})));
    content.append(node('div',{class:'dop-actions'},copyId,copyTitle,button('Copy complete saved history',()=>job(async()=>{
      const result=await post('copy',{recordId:record.id,id:copyId.value,savedAt:now(),actor:actor(),
        ...(copyTitle.value?{title:copyTitle.value}:{}),note:'Explicit new procedure ID; original complete saved history retained.'});
      await loadRecords();await openRecord(result.record.id);S.message='Saved the new copy with its complete original history and origin.';
    }),false,{'data-testid':'dop-copy'})));
    if(S.comparison)content.append(details('Current registration and original Directory binding comparison',S.comparison,true));
    content.append(details('Original native basis',S.basis),details('Complete saved OperatingPlan history',doc),
      details('Original history identity',{id:doc.id,createdAt:doc.createdAt,origin:doc.origin,revisions:doc.revisions.length}),renderReceive());
  }
  function draftImport() {
    const input=node('input',{type:'file',accept:'.json,application/json','aria-label':'Open complete working draft','data-testid':'dop-open-draft'});
    input.addEventListener('change',()=>job(async()=>{
      const original=input.files?.[0];if(!original)return;
      if(original.size>64*1024*1024)throw new Error('Keep a complete working draft within 64 MiB.');
      const value=JSON.parse(await original.text());
      if(value.schema==='stellar-forge.directory-operating-editor.v1') {
        if(value.workspaceId!==S.workspaceId)throw new Error('This working draft belongs to a different original workspace.');
        if(value.recordId)await openRecord(value.recordId);
        if(plain(value.create))S.create=value.create;
        if(value.draft) {
          if(value.draft.schema!=='stellar-forge.operating-plan-draft.v1'||value.draft.planId!==S.record?.planId||
            !plain(value.draft.content)||!Array.isArray(value.draft.content.steps))throw new Error('Keep the original complete procedure draft and selected history.');
          S.draft=value.draft;S.mode='edit';
        } else {S.mode='create';S.preview=null;if(!value.recordId){S.record=null;S.document=null;S.basis=null;}}
        S.selectedStep=value.selectedStep??S.selectedStep;S.receivedText=value.receivedText??'';S.rawInputs=originalRawInputs(value.rawInputs);
      } else if(value.schema==='stellar-forge.operating-plan-draft.v1') {
        if(value.planId!==S.record?.planId||S.record?.stage!=='saved'||!plain(value.content)||!Array.isArray(value.content.steps))
          throw new Error('Open the original saved procedure before receiving this full working draft.');
        S.draft=value;S.mode='edit';S.selectedStep=value.content.steps[0]?.id??null;S.rawInputs=originalRawInputs();
      } else if(plain(value.basis)&&typeof value.id==='string'&&value.outputDirectory!==undefined) {
        S.create=value;S.mode='create';S.record=null;S.document=null;S.draft=null;S.preview=null;S.rawInputs=originalRawInputs();
      } else throw new Error('Choose a complete Directory procedure input or original OperatingPlan working draft.');
      S.dirty=true;S.message='Opened the complete working draft. Its original revision remains subject to the native save guard.';persist();
    }));
    return node('label',{class:'dop-field'},'Open complete working draft',input);
  }
  function render() {
    if(S.disposed)return;
    toolbar.replaceChildren(node('div',{},node('p',{class:'dop-eyebrow'},'HUMAN SERVICES DIRECTORY'),node('h1',{},'Operating plans')),
      node('p',{},'Reviewed procedures · full history · complete receiving'));
    toolbar.append(draftImport());
    renderStatus();renderList();content.replaceChildren();
    if(!S.workspaceId){content.append(node('p',{},'Open the original Directory workspace to prepare or receive its procedures.'));return;}
    if(S.mode==='edit'&&S.draft)renderEdit();else renderCreate();
  }
  const beforeUnload=event=>{
    if(S.disposed||!S.active)return;persist();
    if(S.busy||S.dirty||S.storageError){event.preventDefault();event.returnValue='';}
  };
  window.addEventListener('beforeunload',beforeUnload);
  async function open() {
    if(S.disposed)throw new Error('This Operating Plans editor has been disposed.');
    S.active=true;root.hidden=false;
    await job(async()=>{
      S.state=await getState();S.workspaceId=S.state.workspaceId??S.state.directory?.workspaceId;
      if(!S.workspaceId||S.state.directory?.workspaceId!==S.workspaceId)throw new Error('Open the original Directory workspace first.');
      S.key='starforge.directory-operating-plans.'+S.workspaceId;
      S.catalog=await get(API+'/operating-plans/catalog');
      await loadRecords();if(!S.create)S.create=defaultInput();
      let restored=null;try{restored=JSON.parse(sessionStorage.getItem(S.key)||'null');}catch{}
      if(restored?.schema==='stellar-forge.directory-operating-editor.v1'&&restored.workspaceId===S.workspaceId){
        if(restored.recordId)await openRecord(restored.recordId);
        if(restored.create&&plain(restored.create))S.create=restored.create;
        if(restored.draft?.schema==='stellar-forge.operating-plan-draft.v1'&&restored.draft.planId===S.record?.planId){
          S.draft=restored.draft;S.mode='edit';S.dirty=true;
          S.message='Reopened the complete browser draft with its original base revision. Native saving will check whether that saved history advanced.';
        }
        S.selectedStep=restored.selectedStep??S.selectedStep;S.receivedText=restored.receivedText??'';S.rawInputs=originalRawInputs(restored.rawInputs);S.dirty=true;
      }
    });
    if(S.error)throw new Error(S.error);
    root.dataset.operatingPlansReady='true';
  }
  function close(){persist();S.active=false;root.hidden=true;}
  function dispose(){persist();S.disposed=true;S.active=false;window.removeEventListener('beforeunload',beforeUnload);root.replaceChildren();}
  render();
  return {open,close,dirty:()=>S.dirty||Boolean(S.storageError),busy:()=>S.busy,dispose};
}
