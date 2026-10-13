// MIT. Complete native returned-procedure workbench; original model owns every decision.
const API='/api/directory', SCHEMA='stellar-forge.directory-operating-return-editor.v1';
const now=()=>new Date().toISOString(), clone=x=>JSON.parse(JSON.stringify(x));
function el(tag,props={},...children){
  const n=document.createElement(tag);
  for(const[k,v]of Object.entries(props)){
    if(k==='class')n.className=v;else if(k==='text')n.textContent=v;
    else if(k.startsWith('on')&&typeof v==='function')n.addEventListener(k.slice(2),v);
    else if(v!==undefined&&v!==null)n.setAttribute(k,String(v));
  }
  for(const c of children.flat(Infinity))if(c!==undefined&&c!==null)n.append(c instanceof Node?c:document.createTextNode(String(c)));
  return n;
}
const json=x=>JSON.stringify(x,null,2), short=x=>String(x??'').slice(0,12);
function save(name,value){
  const u=URL.createObjectURL(new Blob([json(value)+'\n'],{type:'application/json'}));
  const a=el('a',{href:u,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
function fold(label,value){return el('details',{class:'dor-details'},el('summary',{},label),el('pre',{},typeof value==='string'?value:json(value)));}
export function mountDirectoryOperatingReturns({root,api,download,getState,notify=()=>{}}){
  if(!(root instanceof HTMLElement)||typeof api!=='function'||typeof download!=='function'||typeof getState!=='function')
    throw new TypeError('Returned procedures require the original Directory host.');
  root.classList.add('directory-operating-returns');
  const S={disposed:false,busy:false,generation:0,workspaceId:null,key:null,record:null,page:null,
    records:[],total:0,nextOffset:null,query:'',plans:[],plansNext:0,plansTotal:0,planQuery:'',
    sourceId:'',incomingText:'',incomingName:'',reviewText:'',reviewName:'',newId:'directory-return-'+crypto.randomUUID(),
    createdAt:now(),reviewer:'',notes:'',actor:'',note:'',choices:{},pending:null,lastResponse:null,
    offset:0,filters:{kind:'',conflict:'',unresolved:''},dirty:false,reviewDirty:false,storageError:'',error:'',message:'',expectedRecordId:''};
  const toolbar=el('header',{class:'dor-toolbar'}),status=el('div',{role:'status','aria-live':'polite',class:'dor-status'}),
    library=el('aside',{class:'dor-library','aria-label':'Returned procedure histories'}),content=el('section',{class:'dor-content'});
  root.replaceChildren(toolbar,status,el('div',{class:'dor-layout'},library,content));
  const btn=(label,fn,test,primary=false)=>el('button',{type:'button',class:primary?'dor-primary':undefined,
    'data-testid':test,onclick:()=>task(fn)},label);
  function noteStatus(){status.replaceChildren(...[
    S.busy?el('p',{},'Reading or saving the complete original review…'):null,
    S.error?el('p',{role:'alert',class:'dor-error'},S.error):null,
    S.message?el('p',{class:'dor-success'},S.message):null,
    S.storageError?el('p',{class:'dor-warning'},S.storageError):null,
    S.dirty?el('p',{class:'dor-warning'},'Working review has unsaved choices. Complete draft text is retained for this browser session.'):null
  ].filter(Boolean));}
  function draft(){return {schema:SCHEMA,workspaceId:S.workspaceId,recordId:S.record?.id??null,sourceId:S.sourceId,
    incomingText:S.incomingText,incomingName:S.incomingName,reviewText:S.reviewText,reviewName:S.reviewName,
    newId:S.newId,createdAt:S.createdAt,reviewer:S.reviewer,notes:S.notes,actor:S.actor,note:S.note,
    choices:S.choices,reviewDirty:S.reviewDirty,pending:S.pending,lastResponse:S.lastResponse,expectedRecordId:S.expectedRecordId,updatedAt:now()};}
  function persist(){
    if(!S.key)return;
    try{sessionStorage.setItem(S.key,json(draft()));S.storageError='';}
    catch{S.storageError='The complete working copy exceeds browser session capacity. Download the full working JSON before leaving; the open editor still retains it.';}
    noteStatus();
  }
  function changed(review=false){S.dirty=true;if(review)S.reviewDirty=true;persist();}
  function valid(){if(S.disposed)throw new Error('This returned-procedure view has closed. Reopen its original saved record.');}
  function freezeControls(){
    root.setAttribute('aria-busy',String(S.busy));
    if(S.busy)for(const input of root.querySelectorAll('input,textarea,select,button'))input.disabled=true;
  }
  async function task(work){
    if(S.busy||S.disposed)return;
    S.busy=true;S.error='';S.message='';freezeControls();noteStatus();
    try{await work();}catch(e){S.error=String(e?.message??e);notify(S.error,'error');}
    finally{S.busy=false;if(!S.disposed){render();persist();}}
  }
  const get=p=>api(p,{method:'GET'});
  const post=(action,body)=>api(API+'/operating-returns/'+action,{method:'POST',body});
  const unsaved=()=>!S.dirty||confirm('Keep the complete working JSON before replacing these unsaved choices. Open the selected saved review?');
  function field(label,key,{multiline=false,rows=3,readOnly=false,review=false,test}={}){
    const input=el(multiline?'textarea':'input',{...(multiline?{rows}:{type:'text'}),'data-testid':test,
      ...(readOnly?{readonly:'readonly'}:{})});input.value=S[key]??'';
    input.addEventListener('input',()=>{if(S.busy||S.disposed)return;S[key]=input.value;changed(review);});
    return el('label',{class:'dor-field'},el('span',{},label),input);
  }
  function picker(label,value,options,set,test){
    const input=el('select',{'aria-label':label,'data-testid':test});
    for(const [v,text]of options)input.append(el('option',{value:v},text));
    input.value=value;input.addEventListener('change',()=>{if(!S.busy&&!S.disposed)set(input.value);});
    return el('label',{class:'dor-field'},el('span',{},label),input);
  }
  async function readFile(file,maximum){
    if(!file||file.size>maximum)throw new Error('Choose a complete original JSON file within its declared receiving limit.');
    const bytes=await file.arrayBuffer();valid();
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  function fileControl(label,kind,max){
    const input=el('input',{type:'file',accept:'.json,application/json','aria-label':label,'data-testid':'dor-'+kind+'-file'});
    input.addEventListener('change',()=>task(async()=>{
      const file=input.files?.[0];if(!file)return;
      const text=await readFile(file,max);JSON.parse(text);valid();
      S[kind+'Text']=text;S[kind+'Name']=file.name;changed();
      S.message='Kept the complete '+file.name+' with its original saved history.';
    }));
    return el('label',{class:'dor-field'},el('span',{},label),input,
      el('small',{},S[kind+'Name']||'No original file selected'));
  }
  async function loadLibrary(reset=true){
    const offset=reset?0:S.nextOffset;if(offset===null)return;
    const p=await get(API+'/operatingPlanReturns?offset='+offset+'&limit=50&query='+encodeURIComponent(S.query));valid();
    if(p.offset!==offset||!Array.isArray(p.rows)||p.nextOffset!==null&&(p.nextOffset!==offset+p.rows.length||p.nextOffset<=offset))
      throw new Error('The original return collection did not return a contiguous complete page.');
    const prior=reset?[]:S.records,ids=new Set(prior.map(x=>x.id));
    if(p.rows.some(x=>ids.has(x.id)))throw new Error('The original return collection repeats a saved record.');
    S.records=[...prior,...p.rows];S.nextOffset=p.nextOffset;S.total=p.total;
  }
  async function loadPlans(reset=true){
    const offset=reset?0:S.plansNext;if(offset===null)return;
    const p=await get(API+'/operatingPlans?offset='+offset+'&limit=100&query='+encodeURIComponent(S.planQuery));valid();
    if(p.offset!==offset||!Array.isArray(p.rows)||p.nextOffset!==null&&(p.nextOffset!==offset+p.rows.length||p.nextOffset<=offset))
      throw new Error('The original plan collection did not return a contiguous complete page.');
    const prior=reset?[]:S.plans;
    S.plans=[...prior,...p.rows];S.plansNext=p.nextOffset;S.plansTotal=p.total;
  }
  async function loadRows(offset=S.offset){
    if(!S.record)return;
    const id=S.record.id, generation=S.generation;
    const q=new URLSearchParams({offset:String(offset),limit:'20'});
    for(const[k,v]of Object.entries(S.filters))if(v!=='')q.set(k,v);
    const p=await get(API+'/operatingPlanReturns/'+id+'/rows?'+q);valid();
    if(generation!==S.generation||S.record.id!==id)return;
    if(p.recordId!==id||p.offset!==offset||!Array.isArray(p.rows)||
      p.nextOffset!==null&&(p.nextOffset!==offset+p.rows.length||p.nextOffset<=offset))throw new Error('The original change page has an unexpected identity or continuation.');
    S.page=p;S.offset=offset;
  }
  async function openRecord(id,{keepWorking=false}={}){
    const record=await get(API+'/operatingPlanReturns/'+id);valid();
    if(record.id!==id||record.workspaceId!==S.workspaceId)throw new Error('The selected returned procedure belongs to another original workspace.');
    S.generation++;S.record=record;S.sourceId=record.currentRecordId;S.offset=0;S.page=null;
    if(!keepWorking){S.reviewer=record.reviewDetails.reviewer;S.notes=record.reviewDetails.notes;S.choices={};S.dirty=false;S.reviewDirty=false;}
    S.actor=S.actor||record.actor;S.expectedRecordId=record.currentRecordId;
    await loadRows();
  }
  async function perform(action,body){
    if(S.pending&&(S.pending.action!==action||JSON.stringify(S.pending.body)!==JSON.stringify(body)))
      throw new Error('Retry or retain the pending original request before replacing its operation.');
    S.pending={action,body:clone(body)};persist();
    const result=await post(action,body);valid();
    if(!result.record?.id)throw new Error('The native return operation did not return its retained record.');
    S.lastResponse=result;persist();
    await openRecord(result.record.id);await loadLibrary();
    S.pending=null;S.lastResponse=null;S.dirty=false;S.reviewDirty=false;persist();
    return result;
  }
  function requestActor(){if(!S.actor.trim())throw new Error('Name the actual author or receiving operator.');return {actor:S.actor,note:S.note};}
  function decisionInput(){
    return Object.entries(S.choices).map(([key,item])=>{
      if(item.take==='automatic')return {key,decision:null};
      if(!['current','incoming','base','custom'].includes(item.take))throw new Error('Choose an explicit source, custom value or automatic handling.');
      let value;
      if(item.take==='custom')value=item.textValue?item.raw:JSON.parse(item.raw);
      return {key,decision:{take:item.take,note:item.note??'',...(item.take==='custom'?{value}:{})}};
    });
  }
  async function saveReview(){
    if(!S.record)throw new Error('Open an original return review.');
    const result=await perform('revise',{recordId:S.record.id,updates:{reviewer:S.reviewer,notes:S.notes},
      decisions:decisionInput(),...requestActor()});
    S.message='Retained the complete reviewed choices as immutable record '+result.record.id+'.';
  }
  function renderLibrary(){
    const find=el('input',{type:'search',placeholder:'Find review, plan or owner','aria-label':'Find returned procedures'});
    find.value=S.query;find.addEventListener('change',()=>task(async()=>{S.query=find.value;await loadLibrary();}));
    library.replaceChildren(el('h2',{},'Return library'),el('p',{},S.records.length+' of '+S.total+' retained records'),find,
      btn('Prepare another return',async()=>{if(S.pending)throw new Error('Retain or retry the pending original request before preparing another return.');if(!unsaved())return;S.generation++;S.record=null;S.page=null;S.choices={};
        S.newId='directory-return-'+crypto.randomUUID();S.createdAt=now();S.dirty=false;S.pending=null;},'dor-new'),
      ...S.records.map(r=>btn((r.summary?.title||r.reviewId)+' · '+r.stage+' · '+short(r.id),async()=>{
        if(unsaved())await openRecord(r.id);
      },'dor-record-'+r.id)),
      ...[S.nextOffset!==null?btn('More saved reviews',()=>loadLibrary(false),'dor-more-records'):null].filter(Boolean));
  }
  function renderIntake(){
    const query=el('input',{placeholder:'Find current plan, customer or ID','aria-label':'Find source plan'});query.value=S.planQuery;
    const plans=el('datalist',{id:'dor-source-plans'},S.plans.filter(r=>r.stage==='saved').map(r=>
      el('option',{value:r.id},(r.summary?.title||r.planId)+' · revision '+r.revision)));
    const source=field('Exact saved current procedure record','sourceId',{test:'dor-current-record'});
    source.querySelector('input').setAttribute('list','dor-source-plans');
    content.append(el('h1',{},'Review returned customer work'),el('p',{},'Receive the complete returned OperatingPlan or an existing review. The original model compares the full shared history and keeps every decision.'),
      el('div',{class:'dor-panel'},el('h2',{},'Select original procedure'),query,
        btn('Find original saved plans',async()=>{S.planQuery=query.value;await loadPlans();},'dor-find-plans'),
        S.plansNext!==null?btn('More original plans',()=>loadPlans(false),'dor-more-plans'):null,
        el('p',{},S.plans.length+' of '+S.plansTotal+' complete source records read'),source,plans),
      el('div',{class:'dor-panel'},el('h2',{},'Prepare from a returned plan'),
        fileControl('Complete returned plan','incoming',32*1024*1024),
        field('Review identity','newId',{test:'dor-review-id'}),field('Reviewing operator','reviewer',{test:'dor-reviewer'}),
        field('Review notes','notes',{multiline:true,test:'dor-notes'}),
        btn('Prepare complete original comparison',async()=>{
          if(!S.sourceId||!S.incomingText)throw new Error('Select the exact current record and a complete original returned plan.');
          await perform('prepare',{recordId:S.sourceId,incoming:JSON.parse(S.incomingText),id:S.newId,
            reviewer:S.reviewer,notes:S.notes,createdAt:S.createdAt,...requestActor()});
          S.message='Prepared the original histories and their actual shared revision.';
        },'dor-prepare',true)),
      el('div',{class:'dor-panel'},el('h2',{},'Receive an existing full review'),
        fileControl('Complete original return review','review',128*1024*1024),
        btn('Receive review and all decisions',async()=>{
          if(!S.sourceId||!S.reviewText)throw new Error('Select the original current plan and its complete review.');
          await perform('receive',{currentRecordId:S.sourceId,review:JSON.parse(S.reviewText),...requestActor()});
          S.message='Received both complete source histories, decisions and any original completed intent.';
        },'dor-receive')));
  }
  function renderRow(row){
    const draftChoice=S.choices[row.key], saved={take:row.reviewed?row.take:'automatic',note:row.note??'',
      raw:typeof row.value==='string'&&(row.kind==='plan-field'||row.kind==='step-field')?row.value:json(row.value),
      textValue:row.kind==='plan-field'||row.kind==='step-field'};
    const item=draftChoice??saved;
    const choose=value=>{
      const next={...item,take:value};S.choices[row.key]=next;changed(true);render();
    };
    const selected=picker('Reviewed choice',item.take,[['automatic','Original automatic handling'],['current','Current work'],
      ['incoming','Returned work'],['base','Shared revision'],['custom','Custom reviewed value']],choose,'dor-choice');
    const note=el('textarea',{rows:2,'aria-label':'Reason for '+row.label,'data-testid':'dor-choice-note'});note.value=item.note;
    note.addEventListener('input',()=>{if(S.busy||S.disposed)return;S.choices[row.key]={...(S.choices[row.key]??item),note:note.value};changed(true);});
    const body=el('article',{class:'dor-row','data-return-key':row.key},el('header',{},el('h3',{},row.label),
      el('p',{},row.key+' · '+(row.conflict?'Conflicting changes':'Compatible changes')+(row.reviewed?' · reviewed':' · proposed'))),
      row.reason?el('p',{class:'dor-warning'},row.reason):null,
      row.stale?el('p',{class:'dor-warning'},'The included steps changed after this order was reviewed. Review the complete order again.'):null,
      el('div',{class:'dor-values'},...['base','current','incoming'].map((k,i)=>el('section',{},
        el('h4',{},['Shared revision','Current work','Returned work'][i]),el('pre',{},typeof row[k]==='string'?row[k]:json(row[k]))))),
      selected,el('label',{class:'dor-field'},'Decision reason',note));
    if(item.take==='custom'){
      const input=el('textarea',{rows:6,'aria-label':'Complete custom value for '+row.label,'data-testid':'dor-custom-value'});input.value=item.raw;
      input.addEventListener('input',()=>{if(S.busy||S.disposed)return;S.choices[row.key]={...(S.choices[row.key]??item),raw:input.value};changed(true);});
      body.append(el('label',{class:'dor-field'},item.textValue?'Complete custom text':'Complete custom JSON value',input),
        el('p',{class:'dor-muted'},item.textValue?'Text is retained exactly.':'Use a complete JSON value. A null whole step removes it; order must contain every included step ID once. Unfinished JSON remains in the working draft.'));
    }
    body.append(fold('Full original comparison row',row));return body;
  }
  async function currentHead(){
    if(!S.record)return;
    let offset=0,rows=[];
    for(;;){
      const p=await get(API+'/operatingPlans?offset='+offset+'&limit=250&query='+encodeURIComponent(S.record.planId));valid();
      if(p.offset!==offset||p.nextOffset!==null&&(p.nextOffset!==offset+p.rows.length||p.nextOffset<=offset))throw new Error('The original history search is not contiguous.');
      rows.push(...p.rows.filter(r=>r.stage==='saved'&&r.planId===S.record.planId));
      if(p.nextOffset===null)break;offset=p.nextOffset;
    }
    const parents=new Set(rows.map(r=>r.predecessorRecordId).filter(Boolean)),heads=rows.filter(r=>!parents.has(r.id));
    if(heads.length!==1)throw new Error('The selected original procedure does not have one complete native saved head.');
    S.expectedRecordId=heads[0].id;persist();
  }
  function renderReview(){
    const r=S.record,p=S.page,done=['completed','applied'].includes(r.stage);
    content.append(el('h1',{},r.summary.title),el('p',{class:'dor-eyebrow'},r.stage.toUpperCase()+' RETURN REVIEW'),
      el('dl',{class:'dor-facts'},...[['Original plan',r.planId],['Review',r.reviewId],
        ['Shared revision',r.summary.commonRevision],['Current revision',r.summary.currentRevision],
        ['Returned revision',r.summary.incomingRevision],['Conflicts',r.summary.conflicts],
        ['Unresolved',r.summary.unresolved],['Original current record',r.currentRecordId]].flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v)])),
      field('Reviewing operator','reviewer',{readOnly:done,review:true,test:'dor-reviewer'}),
      field('Review notes','notes',{multiline:true,readOnly:done,review:true,test:'dor-notes'}));
    if(!done)content.append(el('div',{class:'dor-actions'},
      btn('Save complete reviewed choices',saveReview,'dor-save-review',true),
      btn('Retain completed review intent',async()=>{
        if(S.reviewDirty)throw new Error('Save the complete current choices before completing this review.');
        await perform('complete',{recordId:r.id,savedAt:now(),...requestActor()});
        S.message='Retained the original completed review. The saved procedure has not yet been updated.';
      },'dor-complete')));
    else content.append(el('div',{class:'dor-panel'},el('h2',{},'Receive reviewed work into the original plan'),
      el('p',{},'The completed review is retained before the native plan save. The applied-return receipt is a separate recoverable write. Repeating the same request recognizes the full result within later saved history.'),
      field('Selected current native plan record','expectedRecordId',{test:'dor-expected-record'}),
      btn('Read actual saved head',currentHead,'dor-read-head'),
      btn('Apply retained reviewed result',async()=>{
        if(S.reviewDirty)throw new Error('Retain the changed review choices before applying the saved completed review.');
        const result=await perform('apply',{recordId:r.id,expectedRecordId:S.expectedRecordId,...requestActor()});
        S.message='Received reviewed work at native record '+result.plan.id+'; '+result.record.addedRevisions+' revisions added.';
      },'dor-apply',true)));
    content.append(el('div',{class:'dor-actions'},
      ...[['json','Complete editable review'],['html','Readable review'],...(done?[['plan','Reviewed complete plan']]:[])].map(([format,label])=>
        btn(label,async()=>{
          const out=await post('export',{recordId:r.id,format,...requestActor()});
          await download(API+'/exports/'+out.id+'/file',out.name);S.message='Received the complete '+label.toLowerCase()+'.';
        },'dor-export-'+format)),
      ...['review','comparison','input'].map(kind=>btn('Original '+kind+' file',
        ()=>download(API+'/operatingPlanReturns/'+r.id+'/files/'+kind,'Operating_Return_'+kind+'.json'),'dor-file-'+kind))));
    if(r.predecessorRecordId)content.append(btn('Open original review predecessor',async()=>{if(unsaved())await openRecord(r.predecessorRecordId);},'dor-predecessor'));
    if(r.appliedPlanRecordId)content.append(fold('Actual retained native receiving outcome',{
      appliedPlanRecordId:r.appliedPlanRecordId,addedRevisions:r.addedRevisions,alreadyPresent:r.alreadyPresent}));
    const filter=(key,label,options)=>picker(label,S.filters[key],options,value=>task(async()=>{S.filters[key]=value;await loadRows(0);}));
    content.append(el('div',{class:'dor-filters'},
      filter('kind','Change kind',[['','All changes'],...['plan-field','step-field','step-presence','step-context','step-command','step-progress','step-order'].map(x=>[x,x])]),
      filter('conflict','Conflict',[['','All'],['true','Conflicting'],['false','Compatible']]),
      filter('unresolved','Resolution',[['','All'],['true','Unresolved'],['false','Resolved or automatic']])));
    if(p){
      content.append(el('p',{},p.offset+'–'+(p.offset+p.rows.length)+' of '+p.total+' matching changes · '+p.bytes+' original page bytes'));
      if(p.issues.length)content.append(fold('Items requiring correction',p.issues));
      const rows=el('div',{class:done?'dor-completed-rows':'dor-editable-rows','data-testid':'dor-rows'},
        p.rows.length?p.rows.map(renderRow):el('p',{},'No matching original changes in this selection.'));
      if(done)for(const input of rows.querySelectorAll('input,textarea,select,button'))input.disabled=true;
      content.append(rows,el('div',{class:'dor-actions'},
        p.offset>0?btn('Previous changes',()=>loadRows(Math.max(0,p.offset-20)),'dor-previous'):null,
        p.nextOffset!==null?btn('Next changes',()=>loadRows(p.nextOffset),'dor-next'):null));
    }
    content.append(fold('Complete native review binding and retained file descriptors',r));
  }
  async function restoreDraft(value){
    if(value?.schema!==SCHEMA||value.workspaceId!==S.workspaceId)throw new Error('Choose a complete working review for this original workspace.');
    if(value.recordId!==null&&value.recordId!==undefined&&!(typeof value.recordId==='string'&&/^[0-9a-f]{64}$/.test(value.recordId)))
      throw new Error('Choose the exact original saved review record ID.');
    for(const key of ['sourceId','incomingText','incomingName','reviewText','reviewName','newId','createdAt','reviewer','notes','actor','note','expectedRecordId'])
      if(typeof value[key]!=='string')throw new Error('The complete working review is missing '+key+'.');
    if(!value.choices||typeof value.choices!=='object'||Array.isArray(value.choices))throw new Error('Keep the complete original working choices.');
    for(const item of Object.values(value.choices))if(!item||typeof item.take!=='string'||typeof item.raw!=='string'||typeof item.note!=='string'||typeof item.textValue!=='boolean')
      throw new Error('Keep each complete original choice and unfinished custom text.');
    if(value.pending&&(!['prepare','revise','complete','apply','receive'].includes(value.pending.action)||!value.pending.body))
      throw new Error('The pending original return request is incomplete.');
    // Read or replace saved state only after the entire working shape is valid.
    if(value.recordId)await openRecord(value.recordId);else{S.record=null;S.page=null;}
    for(const key of ['sourceId','incomingText','incomingName','reviewText','reviewName','newId','createdAt','reviewer','notes','actor','note','choices','pending','lastResponse','expectedRecordId'])
      S[key]=clone(value[key]??null);
    S.reviewDirty=value.reviewDirty===true;S.dirty=true;S.message='Reopened the complete working review and original pending request, including unfinished custom values.';
  }
  function render(){
    if(S.disposed)return;
    const working=el('input',{type:'file',accept:'.json,application/json','aria-label':'Open complete working return','data-testid':'dor-open-draft'});
    working.addEventListener('change',()=>task(async()=>{if(!working.files?.[0])return;if(!unsaved())return;
      await restoreDraft(JSON.parse(await readFile(working.files[0],256*1024*1024)));persist();}));
    toolbar.replaceChildren(el('div',{},el('p',{class:'dor-eyebrow'},'HUMAN SERVICES DIRECTORY'),el('h1',{},'Returned procedures')),
      el('div',{class:'dor-actions'},btn('Save complete working JSON',async()=>{persist();save('Directory_Return_Working.json',draft());
        S.message='Received the complete working review, including unfinished choice text.';},'dor-save-draft'),working));
    renderLibrary();content.replaceChildren();
    content.append(el('div',{class:'dor-author'},field('Actual operating owner','actor',{test:'dor-actor'}),
      field('Native action note','note',{test:'dor-action-note'})));
    if(S.pending)content.append(el('div',{class:'dor-panel dor-warning'},el('h2',{},'Retained original request'),
      el('p',{},'The original '+S.pending.action+' request is retained until its native result is reopened.'),
      btn('Retry the exact original request',async()=>{const selected=clone(S.pending);await perform(selected.action,selected.body);
        S.message='Reconciled the original retained request.';},'dor-retry'),
      btn('Keep full request copy and revise working input',async()=>{
        save('Directory_Return_Pending_Request_'+S.pending.action+'.json',draft());
        S.pending=null;S.lastResponse=null;S.dirty=true;persist();
        S.message='Kept the complete prior request and review as a downloadable working copy. Native saved records remain unchanged.';
      },'dor-keep-pending'),
      fold('Exact accepted request',S.pending)));
    if(S.record)renderReview();else renderIntake();noteStatus();freezeControls();
  }
  const beforeUnload=event=>{if(S.disposed)return;persist();if(S.dirty||S.busy||S.pending||S.storageError){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  async function open(){
    await task(async()=>{
      const state=await getState();valid();S.workspaceId=state.workspaceId;
      if(!S.workspaceId||state.directory?.workspaceId!==S.workspaceId)throw new Error('Open the original Directory workspace.');
      S.actor=state.operatingActor||'';S.key='starforge.directory-operating-returns.'+S.workspaceId;
      await loadLibrary();await loadPlans();
      let previous=null;try{previous=JSON.parse(sessionStorage.getItem(S.key)||'null');}catch{}
      if(previous)await restoreDraft(previous);
    });
    if(S.error)throw new Error(S.error);root.dataset.operatingReturnsReady='true';
  }
  function dispose(){persist();S.disposed=true;S.generation++;window.removeEventListener('beforeunload',beforeUnload);root.replaceChildren();}
  render();
  return {open,dispose,busy:()=>S.busy,dirty:()=>S.dirty||Boolean(S.pending)||Boolean(S.storageError)};
}
