// Cohort acceptance review in the original SF47 Operations workspace.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const clone=value=>structuredClone(value);
const choice=(...values)=>values.map(x=>[x,label(x)]);
const empty=text=>'<p class="cohort-empty">'+esc(text)+'</p>';
const pill=(text,tone='')=>'<span class="cohort-pill '+tone+'">'+esc(text)+'</span>';
const button=(text,action,attrs='',disabled=false)=>'<button type="button" data-cohort-action="'+action+'" '+attrs+(disabled?' disabled data-cohort-fixed="true"':'')+'>'+esc(text)+'</button>';
const table=(headers,rows)=>'<div class="cohort-table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const note=text=>'<p class="cohort-note">'+esc(text)+'</p>';
const detail=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
const rate=x=>!x||x.percentage===null?'Unestablished denominator':x.numerator+' / '+x.denominator+' · '+x.percentage+'%';
function field(title,key,value='',options={}){
  const attrs=' name="'+esc(key)+'"'+(options.required?' required':'')+(options.attrs?' '+options.attrs:'');
  let input;
  if(options.options)input='<select'+attrs+(options.multiple?' multiple size="'+(options.size||4)+'"':'')+'>'+options.options.map(([id,name])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>';
  else if(options.check)input='<input'+attrs+' type="checkbox"'+(value?' checked':'')+'>';
  else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'">'+esc(value??'')+'</textarea>';
  else input='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'">';
  return '<label class="'+(options.wide?'cohort-wide':'')+(options.check?' cohort-check':'')+'">'+(options.check?input+esc(title):esc(title)+input)+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const definitive=error=>[400,409,413,415,422].includes(error?.status)&&typeof error?.code==='string';
const DRAFT_SCHEMA='stellar-forge.sf47-cohort-draft.v1';
const localKey=id=>'sf47.cohort.review.'+id;
const nonce=prefix=>prefix+'-'+crypto.randomUUID();

export function mountCohort({container,current,saveApi,session,mutationId,recordingActor,onCase}){
  const root=document.createElement('section');root.className='cohort-desk';root.setAttribute('aria-label','Cohort acceptance review');container.replaceChildren(root);
  if(!document.querySelector('link[data-cohort-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_cohort.css';link.dataset.cohortStyle='true';document.head.append(link);
  }
  if(!session.loaded){
    try{const saved=JSON.parse(sessionStorage.getItem(localKey(current.program.id))||'null');if(saved?.schema==='sf47.cohort-session.v1')Object.assign(session,saved);}catch{}
    session.loaded=true;
  }
  for(const [key,value] of Object.entries({tranche:2,tab:'setup',drafts:{},preview:null,review:null,reviewId:'',dialog:null,editors:{},lastEditorKey:null,pending:null,accepted:null,inflight:null,notice:'',error:'',purchasePage:0,intentPage:0,intentFilter:'all',customerUseIntakes:[],alternateDrafts:[]})){
    if(!Object.hasOwn(session,key))session[key]=value;
  }
  let active=true,busy=false,hostBusy=false,caseValue=current;
  const prefix='/api/operations/'+current.program.id;
  const available=()=>active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  const draft=()=>session.drafts[String(session.tranche)];
  const inputs=()=>draft()?.inputs;
  const editable=()=>available()&&caseValue.program.state==='OPEN'&&!hostBusy&&!busy&&!session.pending&&!session.inflight&&!session.accepted;
  const sources=()=>caseValue.sources.map(x=>[x.id,x.filename+' · '+x.sha256.slice(0,12)]);
  const deps=(role=null)=>(caseValue.records.deployments||[]).filter(x=>!role||x.role===role||x.role==='BOTH');
  const depOptions=(selected=null)=>deps().filter(x=>!selected||selected.includes(x.id)).map(x=>[x.id,x.name+' · '+x.operator+' · '+label(x.participantClass)]);
  const recordName=(kind,id)=>caseValue.records[kind]?.find(x=>x.id===id)?.name||id||'Unassigned';
  const sourceFields=value=>'<fieldset class="cohort-wide"><legend>Retained original evidence</legend><div class="cohort-fields">'+
    field('Attached originals','sourceIds',value.sourceIds||[],{options:sources(),multiple:true,wide:true})+
    field('Original reference and attributed observation','sourceNote',value.sourceNote||'',{area:true,wide:true,help:'Select source bytes already in this case or retain the exact reference and observation. A direct entry stays attributed to the reviewing operator.'})+'</div></fieldset>';
  function retainEditors(){
    const value=draft();if(value)value.editorState={editors:clone(session.editors),lastEditorKey:session.lastEditorKey,
      openEditorKey:session.dialog?.editorKey??null};
  }
  function restoreEditors(value){
    const saved=value?.editorState;
    session.editors=clone(saved?.editors||{});
    const key=saved?.lastEditorKey??saved?.openEditorKey;
    session.lastEditorKey=key&&Object.hasOwn(session.editors,key)?key:null;
    session.dialog=null;
  }
  function draftOrigin(value){
    const originalCaseId=Object.hasOwn(value,'originalCaseId')?value.originalCaseId:caseValue.program.id;
    const sourceVersion=Object.hasOwn(value,'sourceVersion')?value.sourceVersion:value.baseVersion;
    if(typeof originalCaseId!=='string'||originalCaseId.length>100||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(originalCaseId)||
      !Number.isSafeInteger(sourceVersion)||sourceVersion<0)
      throw new Error('Retain the original draft case identity and whole source version.');
    return {originalCaseId,sourceVersion};
  }
  function portableDraft(value){
    retainEditors();
    const selected=value===draft()?draft():value;
    return {schema:DRAFT_SCHEMA,...draftOrigin(selected),reviewCaseId:caseValue.program.id,reviewVersion:selected.baseVersion,
      inputs:clone(selected.inputs),...(selected.customerUse?{customerUse:clone(selected.customerUse)}:{}),
      ...(selected.editorState?{editorState:clone(selected.editorState)}:{})};
  }
  function importedDraft(value,rule){
    if(value.schema!==DRAFT_SCHEMA||![2,3].includes(value.inputs?.tranche))
      throw new Error('Select the exported original Cohort draft.');
    const x=value.inputs;
    if(!['buyerDeploymentIds','merchantDeploymentIds','operations','facilitators','bindings','products','outcomes'].every(key=>Array.isArray(x[key]))||
      !x.coverage||!Array.isArray(x.coverage.gaps)||!x.awardAcceptance)
      throw new Error('The complete Cohort draft must retain its original scope, entries, coverage and award inputs.');
    const origin=draftOrigin({...value,baseVersion:caseValue.program.version});
    if(Object.hasOwn(value,'customerUse')&&(!value.customerUse||typeof value.customerUse!=='object'||Array.isArray(value.customerUse)))
      throw new Error('Retain the complete customer-use source selection.');
    let editorState;
    if(Object.hasOwn(value,'editorState')){
      const state=value.editorState,editors=state?.editors;
      if(!state||typeof state!=='object'||!editors||typeof editors!=='object'||Array.isArray(editors))
        throw new Error('Retain the complete unfinished Cohort entries.');
      const kinds=['operations','facilitators','bindings','products','outcomes','coverage','awardAcceptance','requiredWork'];
      for(const [key,row] of Object.entries(editors)){
        if(!row||row.editorKey!==key||!kinds.includes(row.kind)||!row.data||typeof row.data!=='object'||Array.isArray(row.data)||
          !Array.isArray(row.data.sourceIds)||typeof row.data.sourceNote!=='string'||
          (row.kind==='coverage'&&!Array.isArray(row.data.gaps))||
          (row.kind==='products'&&!Array.isArray(row.data.purchaseIds))||
          (row.kind==='requiredWork'&&!Array.isArray(row.data.workIds)))
          throw new Error('An unfinished Cohort entry is incomplete. Use its complete exported draft.');
      }
      if([state.lastEditorKey,state.openEditorKey].some(key=>key!==null&&key!==undefined&&
        (typeof key!=='string'||!Object.hasOwn(editors,key))))
        throw new Error('The selected unfinished entry is absent from this complete draft.');
      editorState=clone(state);
    }
    return {...origin,inputs:clone(x),rule:clone(rule),baseVersion:caseValue.program.version,dirty:true,
      ...(Object.hasOwn(value,'customerUse')?{customerUse:clone(value.customerUse)}:{}),
      ...(editorState?{editorState}:{})};
  }
  function draftIdentity(value){
    return {inputs:value.inputs,rule:value.rule,baseVersion:value.baseVersion,...draftOrigin(value),
      customerUse:value.customerUse??null,editorState:value.editorState??{editors:{},lastEditorKey:null,openEditorKey:null}};
  }
  function persist(critical=false){
    retainEditors();
    const saved={schema:'sf47.cohort-session.v1',tranche:session.tranche,tab:session.tab,drafts:session.drafts,
      reviewId:session.reviewId,dialog:session.dialog,editors:session.editors,lastEditorKey:session.lastEditorKey,pending:session.pending,accepted:session.accepted,
      purchasePage:session.purchasePage,intentPage:session.intentPage,intentFilter:session.intentFilter,
      customerUseIntakes:session.customerUseIntakes,alternateDrafts:session.alternateDrafts};
    try{
      const raw=JSON.stringify(saved);if(raw.length>2000000)throw new Error('The retained local review exceeds its 2 MB draft bound.');
      sessionStorage.setItem(localKey(current.program.id),raw);
    }catch(error){
      if(critical)throw new Error('The browser could not retain the original request before dispatch. Export the draft or free this site’s session storage, then continue. '+error.message);
      session.storageWarning='This browser could not retain the latest draft across a reload. Export the draft before closing it.';
    }
  }
  function changed(){
    const d=draft();if(d)d.dirty=true;
    session.preview=null;session.error='';persist();
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,textarea,select')){
      const allowed=el.dataset.cohortRecovery==='true';
      el.disabled=el.dataset.cohortFixed==='true'||busy||hostBusy||!!session.inflight||
        ((session.pending||session.accepted)&&!allowed)||
        (el.dataset.cohortWrite==='true'&&caseValue.program.state!=='OPEN');
    }
  }
  async function run(fn){
    if(!available()||busy||hostBusy||session.inflight)return;
    busy=true;session.error='';controls();
    try{return await fn();}catch(error){session.error=error.message||String(error);}
    finally{busy=false;persist();if(available())render();}
  }
  async function reload({adopt=false}={}){
    const next=await saveApi(prefix);
    if(next.program.id!==current.program.id)throw new Error('The returned Operations case changed identity.');
    caseValue=next;
    if(adopt&&draft()){draft().baseVersion=next.program.version;session.preview=null;}
    if(session.preview?.source.version!==next.program.version)session.preview=null;
    return next;
  }
  async function loadDraft(tranche){
    const id=String(tranche);
    if(session.drafts[id])return;
    const seeded=await saveApi(prefix+'/cohort-seed',{expectedVersion:caseValue.program.version,tranche});
    session.drafts[id]={inputs:seeded.inputs,rule:seeded.rule,baseVersion:caseValue.program.version,
      originalCaseId:caseValue.program.id,sourceVersion:caseValue.program.version,dirty:false};
    persist();
  }
  async function showReview(id){
    const review=await saveApi(prefix+'/reviews/'+id);
    if(review.purpose!=='COHORT_EVALUATION')throw new Error('Select an original cohort evaluation.');
    retainEditors();const tranche=review.cohort.inputs.tranche;await loadDraft(tranche);session.tranche=tranche;restoreEditors(draft());
    session.reviewId=id;session.review=review;session.tab='saved';persist();
  }
  async function finishAccepted(){
    if(!session.accepted)return;
    const result=session.accepted.result;
    const next=await reload();
    if(result.id!==next.program.id||next.program.version<result.version)throw new Error('The original saved review has not appeared in this case readback yet.');
    const review=await saveApi(prefix+'/reviews/'+result.recordId);
    if(review.purpose!=='COHORT_EVALUATION'||review.cohort.previewSha256!==session.accepted.payload.data.expectedPreviewSha256)throw new Error('The returned review differs from the original frozen request.');
    session.review=review;session.reviewId=review.id;session.tab='saved';
    session.accepted=null;session.notice='Frozen the original cohort and read back its exact retained result. Its target and coverage findings remain visible.';
    if(draft()){draft().baseVersion=next.program.version;draft().dirty=false;}
    session.preview=null;persist(true);
    if(available())await onCase(next,result);
  }
  async function sendPending(){
    const pending=session.pending;if(!pending)return;
    persist(true);
    if(session.inflight){await session.inflight;return;}
    const work=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',pending.payload);
        session.accepted={payload:pending.payload,result};session.pending=null;persist(true);return result;
      }catch(error){
        if(definitive(error)){
          session.pending=null;session.rejected={payload:pending.payload,code:error.code};
          session.notice='The original request was rejected. The entered draft remains available; refresh its source before previewing again.';
          persist();
        }
        throw error;
      }
    })();
    session.inflight=work;controls();
    try{await work;}finally{if(session.inflight===work)session.inflight=null;}
    await finishAccepted();
  }
  async function freeze(){
    if(!available()||hostBusy||session.pending||session.inflight||session.accepted||caseValue.program.state!=='OPEN'||!session.preview)return;
    if(session.preview.source.version!==draft().baseVersion)throw new Error('Preview the current retained draft source before freezing.');
    const data={inputs:clone(inputs()),expectedPreviewSha256:session.preview.previewSha256};
    const payload={expectedVersion:draft().baseVersion,actor:recordingActor(),action:'cohort.prepare',data,note:inputs().note||inputs().name};
    payload.requestId=await mutationId('operations:cohort.prepare',payload);
    session.pending={payload};persist(true);
    await sendPending();
  }
  function setTab(tab){session.tab=tab;session.dialog=null;persist();render();}
  function selectOptions(list,blank='Unassigned'){return [['',blank],...list];}
  function sourceLinks(ids){
    return (ids||[]).map(id=>'<a href="'+prefix+'/sources/'+encodeURIComponent(id)+'" download>'+esc(caseValue.sources.find(x=>x.id===id)?.filename||id)+'</a>').join('<br>')||'No attached original';
  }
  function receiveCustomerUseDraft(){
    const value=session.requestCustomerUse;if(!value)return;
    if(value.schema!=='stellar-forge.sf47-cohort-evaluation.v1'||value.source?.programId!==caseValue.program.id||
      ![2,3].includes(value.inputs?.tranche)||!value.rule||!value.customerUse)
      throw new Error('Select the complete customer-use draft from this original case.');
    const retained={schema:value.schema,source:clone(value.source),rule:clone(value.rule),inputs:clone(value.inputs),customerUse:clone(value.customerUse)};
    if(!session.customerUseIntakes.some(row=>JSON.stringify(row.value)===JSON.stringify(retained))){
      if(session.customerUseIntakes.length>=20)throw new Error('Export and remove an older retained calendar intake before opening another.');
      session.customerUseIntakes.push({id:crypto.randomUUID(),value:retained});
    }
    delete session.requestCustomerUse;persist();
  }
  function alternateDraft(next,labelText){
    if(session.pending||session.inflight||session.accepted)throw new Error('Continue the original freeze before opening another review draft.');
    if(!next?.inputs||![2,3].includes(next.inputs.tranche)||!next.rule)throw new Error('Select a complete retained Cohort draft.');
    retainEditors();
    const incoming={...clone(next),...draftOrigin(next),dirty:true},tranche=incoming.inputs.tranche;
    const prior=clone({tranche:session.tranche,drafts:session.drafts,alternateDrafts:session.alternateDrafts,
      preview:session.preview,review:session.review,reviewId:session.reviewId,dialog:session.dialog,tab:session.tab,
      editors:session.editors,lastEditorKey:session.lastEditorKey});
    const old=session.drafts[String(tranche)];
    if(old&&JSON.stringify(draftIdentity(old))!==JSON.stringify(draftIdentity(incoming))){
      if(session.alternateDrafts.length>=20)throw new Error('Export and remove an older retained alternate draft before opening another.');
      session.alternateDrafts.push({id:crypto.randomUUID(),label:old.inputs.name||'Earlier review draft',draft:clone(old)});
    }
    session.tranche=tranche;session.drafts[String(tranche)]=incoming;restoreEditors(incoming);
    session.preview=null;session.review=null;session.reviewId='';session.tab='setup';session.purchasePage=0;session.intentPage=0;
    try{persist(true);}catch(error){Object.assign(session,prior);throw error;}
    session.notice=labelText+' Earlier edited drafts and unfinished entries remain available. Evaluate the current original records before freezing.';
  }
  function customerUseIntakes(){
    let output='';
    if(session.customerUseIntakes.length)output+='<section class="cohort-panel"><h3>Saved customer-use selections</h3><p>These inputs retain the exact Installation editions and original receipts. Opening one preserves your previous review draft.</p>'+
      session.customerUseIntakes.map(row=>'<details><summary>'+esc(row.value.inputs.name)+' · source v'+row.value.source.version+'</summary>'+
        detail('Exact saved Installation selection',row.value.customerUse)+
        button('Open as review draft','customer-use-open','data-id="'+esc(row.id)+'" data-cohort-write="true"')+
        button('Export complete draft','customer-use-export','data-id="'+esc(row.id)+'" data-cohort-recovery="true"')+
        button('Remove this local intake','customer-use-remove','data-id="'+esc(row.id)+'"')+'</details>').join('')+'</section>';
    if(session.alternateDrafts.length)output+='<section class="cohort-panel"><h3>Retained edited drafts</h3>'+
      session.alternateDrafts.map(row=>'<div class="cohort-actions"><span>'+esc(row.label)+' · source v'+row.draft.baseVersion+'</span>'+
        button('Open retained draft','alternate-open','data-id="'+esc(row.id)+'" data-cohort-write="true"')+
        button('Export draft','alternate-export','data-id="'+esc(row.id)+'" data-cohort-recovery="true"')+
        button('Remove this local copy','alternate-remove','data-id="'+esc(row.id)+'"')+'</div>').join('')+'</section>';
    return output;
  }
  function header(){
    const d=draft(),stale=d&&d.baseVersion!==caseValue.program.version;
    const pending=session.pending;
    return '<header class="cohort-header"><div><p class="cohort-eyebrow">Deployment evidence · original case</p><h2>Cohort acceptance</h2><p>'+esc(caseValue.program.name)+' · version '+caseValue.program.version+'</p></div><div class="cohort-actions">'+
      field('Original tranche','tranche',session.tranche,{options:[[2,'Tranche 2 · testnet'],[3,'Tranche 3 · mainnet']]})+
      button('Refresh source','refresh','data-cohort-recovery="true"')+
      button('Export draft','draft-export','data-cohort-recovery="true"',!d)+button('Import draft','draft-import')+(session.lastEditorKey&&session.editors[session.lastEditorKey]?button('Resume unfinished entry','resume-editor'):'')+'</div></header>'+
      '<div class="cohort-status">'+pill(label(caseValue.program.mode))+pill('Draft source v'+(d?.baseVersion??'…'),stale?'attention':'')+
      (stale?note('The case has a later version. Refresh source keeps your selections and lets you review the current records before freezing.'):'')+'</div>'+
      (d?note('Draft origin '+esc(d.originalCaseId??caseValue.program.id)+' · source v'+esc(d.sourceVersion??d.baseVersion)+'. Current review source v'+esc(d.baseVersion)+'.'):'')+
      (session.notice?'<p class="cohort-success" role="status">'+esc(session.notice)+'</p>':'')+
      (session.storageWarning?'<p class="cohort-warning">'+esc(session.storageWarning)+'</p>':'')+
      (session.error?'<p class="cohort-error" role="alert">'+esc(session.error)+'</p>':'')+
      (pending?'<aside class="cohort-warning"><h3>Original freeze awaiting a definitive result</h3><p>Request '+esc(pending.payload.requestId)+' retains source version '+pending.payload.expectedVersion+'. Continue this exact request to read its saved result or finish its original transaction.</p>'+button('Continue original freeze','retry','data-cohort-recovery="true"')+detail('Exact retained request',pending.payload)+'</aside>':'')+
      (session.accepted?'<aside class="cohort-warning"><p>The freeze was accepted. Complete readback of the original review.</p>'+button('Read back accepted review','readback','data-cohort-recovery="true"')+'</aside>':'');
  }
  function navigation(){
    return '<nav class="cohort-tabs" aria-label="Cohort review sections">'+
      [['setup','Window & scope'],['participants','Operators & operations'],['purchases','Original purchases'],['outcomes','Products & recovery'],['preview','Evaluate'],['saved','Frozen reviews']].map(([id,name])=>
        '<button type="button" data-cohort-action="tab" data-tab="'+id+'" aria-current="'+(session.tab===id?'page':'false')+'">'+esc(name)+'</button>').join('')+'</nav>';
  }
  function setup(){
    const x=inputs(),rule=draft().rule;
    return '<section class="cohort-panel"><h3>Original proposed tranche '+session.tranche+'</h3><p>'+esc(rule.target.outcome)+'</p>'+
      note(rule.relationToBudget)+
      table(['Proposed target','Required'],Object.entries(rule.target.target_counts).map(([k,v])=>[esc(label(k)),esc(v)]))+
      '<form data-cohort-main><div class="cohort-fields">'+
      field('Review name','name',x.name,{required:true,wide:true})+
      field('First UTC calendar day','windowStart',x.windowStart,{type:'date'})+
      field('Last UTC calendar day','windowEnd',x.windowEnd,{type:'date'})+
      field('Observed through · original timezone','asOfAt',x.asOfAt,{required:true,wide:true,help:'Retain the actual cutoff timestamp. Settlement, output and recovery clocks keep their original precision; later completion is not backdated.'})+
      field('Selected original buyer deployments','buyerDeploymentIds',x.buyerDeploymentIds,{options:deps('BUYER').map(y=>[y.id,y.name+' · '+y.operator+' · '+label(y.participantClass)]),multiple:true,wide:true})+
      field('Selected original merchant installations','merchantDeploymentIds',x.merchantDeploymentIds,{options:deps('MERCHANT').map(y=>[y.id,y.name+' · '+y.operator+' · '+label(y.participantClass)]),multiple:true,wide:true})+
      field('Review note','note',x.note,{area:true,wide:true})+'</div></form>'+
      note('All original purchase rows remain visible. Unselected deployments are reported outside the scope; missing first-attempt clocks remain unplaced. Source classification is preserved on the original purchase.')+
      (draft().customerUse?detail('Retained customer-use source selection',draft().customerUse):'')+'</section>'+
      '<section class="cohort-panel"><div class="cohort-section-heading"><h3>Coverage & actual award clock</h3>'+button('Edit coverage','edit','data-kind="coverage" data-cohort-write="true"')+'</div>'+
      '<p>'+pill(label(x.coverage.state))+' · '+x.coverage.gaps.length+' recorded gaps</p><p>'+esc(x.coverage.sourceNote||'Source coverage has not been established.')+'</p>'+
      table(['Gap start','Gap end','Retained observation'],x.coverage.gaps.map(g=>[esc(g.startAt),esc(g.endAt),esc(g.note)]))+
      '<div class="cohort-section-heading"><h3>Award acceptance</h3>'+button('Record actual award clock','edit','data-kind="awardAcceptance" data-cohort-write="true"')+'</div>'+
      '<p>'+esc(x.awardAcceptance.date||'Actual acceptance date unentered')+'</p>'+note('The original hypothetical planning date and commercial forecasts do not set the actual award clock.')+
      (rule.target.required_work?'<div class="cohort-section-heading"><h3>Required deployed work</h3>'+button('Review required work','edit','data-kind="requiredWork" data-cohort-write="true"')+'</div><p>'+esc(rule.target.required_work)+'</p><p>'+pill(label(x.requiredWork?.state||'UNKNOWN'))+'</p>':'')+'</section>';
  }
  function participants(){
    const x=inputs();
    return '<section class="cohort-panel"><h3>Selected accountable operators</h3>'+table(['Deployment','Accountable identity','Role / network','Original classification','State / source'],
      deps().filter(d=>x.buyerDeploymentIds.includes(d.id)||x.merchantDeploymentIds.includes(d.id)).map(d=>[
        esc(d.name)+'<small>'+esc(d.id)+'</small>',esc(d.operator)+'<small>'+esc(d.operatorId)+'</small>',esc(label(d.role))+' · '+esc(d.environment),
        pill(label(d.participantClass)),esc(label(d.state))+'<small>'+esc(d.sourceNote)+'</small>'+sourceLinks(d.sourceIds)]))+
      note('Distinct accountable operators count once. Multiple hosts, routes, sessions or wallets do not create independent operators. Original team-operated purchases remain team operated.')+'</section>'+
      '<section class="cohort-panel"><div class="cohort-section-heading"><h3>Useful operations</h3>'+button('Add useful operation','edit','data-kind="operations" data-cohort-write="true"')+'</div>'+
      (x.operations.length?table(['Operation / merchant','Agreed scope','Expected complete output','Original evidence','Actions'],x.operations.map(o=>[
        esc(o.label)+'<small>'+esc(o.id)+' · '+esc(recordName('deployments',o.merchantDeploymentId))+'</small>',esc(o.scope),esc(o.expectedOutput),
        esc(o.sourceNote)+'<small>'+sourceLinks(o.sourceIds)+'</small>',button('Edit','edit','data-kind="operations" data-id="'+esc(o.id)+'"')+button('Remove from draft','remove','data-kind="operations" data-id="'+esc(o.id)+'"')])):empty('Add the exact merchant-owned operation and expected useful output used in this review.'))+'</section>'+
      '<section class="cohort-panel"><div class="cohort-section-heading"><h3>Facilitator operators</h3>'+button('Add facilitator','edit','data-kind="facilitators" data-cohort-write="true"')+'</div>'+
      (x.facilitators.length?table(['Service','Accountable operator','Participation','Evidence','Actions'],x.facilitators.map(f=>[
        esc(f.name)+'<small>'+esc(f.serviceUrl)+'</small>',esc(f.operatorId),pill(label(f.participantClass)),esc(f.sourceNote),
        button('Edit','edit','data-kind="facilitators" data-id="'+esc(f.id)+'"')+button('Remove from draft','remove','data-kind="facilitators" data-id="'+esc(f.id)+'"')])):empty('Select real facilitator services and their distinct accountable operators. Similar endpoints alone do not establish independence.'))+'</section>';
  }
  function pager(kind,total,size=25){
    const page=session[kind+'Page']||0,count=Math.ceil(total/size);
    return '<div class="cohort-pager">'+button('Previous',kind+'-page','data-page="'+(page-1)+'"',page<=0)+'<span>Page '+(count?page+1:0)+' of '+count+' · '+total+' rows</span>'+button('Next',kind+'-page','data-page="'+(page+1)+'"',page+1>=count)+'</div>';
  }
  function purchases(){
    const all=caseValue.records.purchases||[],x=inputs();
    session.purchasePage=Math.min(session.purchasePage,Math.max(0,Math.ceil(all.length/25)-1));
    const selected=new Set([...x.buyerDeploymentIds,...x.merchantDeploymentIds]);
    return '<section class="cohort-panel"><h3>Every original purchase observation</h3>'+
      note('Select a row to associate its actual buyer, useful operation and facilitator. Transfer verification and useful-output acceptance are separate explicit observations. This review sends no purchase, recovery or provider request.')+
      pager('purchase',all.length)+table(['Original intent / source','First attempt / completion','Native outcome','Scope & association','Review'],
      all.slice(session.purchasePage*25,session.purchasePage*25+25).map(p=>{
        const b=x.bindings.find(y=>y.purchaseId===p.id),inScope=selected.has(p.deploymentId)||!!b?.buyerDeploymentId;
        return [esc(p.intentId||'Original intent unentered')+'<small>'+esc(p.id)+' · '+esc(p.origin)+'</small>'+pill(label(p.participantClass)),
          esc(p.firstAttemptAt||'First attempt unknown')+'<small>Settled: '+esc(p.settledAt||'unentered')+'<br>Output: '+esc(p.outputCompletedAt||'unentered')+'</small>',
          esc(p.settlementStatus)+' / '+esc(p.outputStatus)+'<small>Order: '+esc(p.orderStatus)+' · '+esc(p.amountStroops)+' atomic<br>'+esc(p.network)+'<br>'+esc(p.deliveredBytes??'Unknown')+' bytes · '+esc(p.deliveredSha256||'No output digest')+'</small>',
          pill(inScope?'Selected scope':'Outside selection')+'<small>'+esc(b?.operationId||'Operation unbound')+'<br>'+esc(b?.facilitatorId||'Facilitator unbound')+'</small>',
          button(b?'Edit association':'Associate original','edit','data-kind="bindings" data-id="'+esc(p.id)+'" data-cohort-write="true"')+
          detail('Complete original observation',p)];
      }))+pager('purchase',all.length)+'</section>';
  }
  function outcomes(){
    const x=inputs();
    return '<section class="cohort-panel"><div class="cohort-section-heading"><h3>Complete parent products</h3>'+button('Add parent product','edit','data-kind="products" data-cohort-write="true"')+'</div>'+
      note('A paid page or part remains its own original intent. Whole-product completion uses the explicitly selected complete expected purchase set and actual completion evidence.')+
      (x.products.length?table(['Product','Original member set','State / completion','Actions'],x.products.map(p=>[
        esc(p.label)+'<small>'+esc(p.id)+'</small>',esc(p.purchaseIds.join('\n')),pill(label(p.state))+'<small>'+esc(p.completedAt)+'</small>',
        button('Edit','edit','data-kind="products" data-id="'+esc(p.id)+'"')+button('Remove','remove','data-kind="products" data-id="'+esc(p.id)+'"')])):empty('No whole-product outcome has been entered.'))+'</section>'+
      '<section class="cohort-panel"><div class="cohort-section-heading"><h3>Deployed recovery, restore & support</h3>'+button('Add original outcome','edit','data-kind="outcomes" data-cohort-write="true"')+'</div>'+
      note('Use existing case/event references and actual fault, alert, acknowledgment and recovery times. Active effort stays separate from elapsed time. These cases use the actual award-to-tranche period; purchase-window membership is reported separately. Name the independent resolving operator for a support handover.')+
      (x.outcomes.length?table(['Original case','Kind / deployment','Actual interval','Result / financial outcome','Actions'],x.outcomes.map(o=>[
        esc(o.reference)+'<small>'+esc(o.id)+'</small>',esc(label(o.kind))+'<small>'+esc(recordName('deployments',o.deploymentId))+'</small>',
        esc(o.startedAt)+'<small>Alert: '+esc(o.alertedAt)+'<br>Acknowledged: '+esc(o.acknowledgedAt)+'<br>Completed: '+esc(o.completedAt)+'<br>Active minutes: '+esc(o.activeMinutes??'unknown')+'</small>',
        esc(o.result)+'<small>'+esc(o.financialOutcome)+'</small>',
        button('Edit','edit','data-kind="outcomes" data-id="'+esc(o.id)+'"')+button('Remove','remove','data-kind="outcomes" data-id="'+esc(o.id)+'"')])):empty('No recovery or support result has been entered.'))+'</section>'+
      '<section class="cohort-panel"><h3>Actual refund cash</h3><form data-cohort-main><div class="cohort-fields">'+
      field('Select retained REFUND observations','refundCashIds',x.refundCashIds,{multiple:true,wide:true,options:caseValue.records.cash.filter(c=>c.category==='REFUND').map(c=>[c.id,c.date+' · '+c.amount+' '+c.currency+' · '+c.direction+' · '+c.externalRef+' · '+c.state])})+
      '</div></form>'+note('Order cancellation or refund status does not create a refund amount. Original currency, network, asset, quantity, date and void status remain separate; no FX conversion is inferred.')+'</section>';
  }
  function resultView(c,frozen=false){
    const metric=c.metrics;
    const metrics=table(['Measure','All selected native intents','Independent useful use','Team operated'],
      [['Approved','approved'],['Payment attempted','attempted'],['Complete in window','complete'],['Gross completion before adjustments','grossComplete'],
       ['Settled with incomplete result','settledIncomplete'],['Attempted, no confirmed settlement','attemptedUnsettled'],
       ['Cancelled before payment','cancelledBeforePayment'],['Cancelled after settlement','cancelledAfterSettlement'],['Refunded after settlement','refundedAfterSettlement'],
       ['Later completion','laterCompletions']].map(([name,key])=>[esc(name),esc(metric.allSelected[key]),esc(metric.independent[key]),esc(metric.teamOperated[key])]));
    let all=c.intents;
    if(session.intentFilter==='exceptions')all=all.filter(x=>x.issues.length||x.unplaced);
    if(session.intentFilter==='independent')all=all.filter(x=>x.independentCompleteInWindow);
    if(session.intentFilter==='team')all=all.filter(x=>x.teamOperated);
    session.intentPage=Math.min(session.intentPage,Math.max(0,Math.ceil(all.length/25)-1));
    const span=c.window.start+' → '+c.window.end+' UTC';
    return '<section class="cohort-panel"><div class="cohort-section-heading"><div><h3>'+esc(c.inputs.name)+'</h3><p>'+esc(span)+' · observed through '+esc(c.window.asOfAt)+'</p></div>'+pill(c.ready?'Proposed targets & coverage met':'Review retains unmet findings',c.ready?'good':'attention')+'</div>'+
      '<div class="cohort-metrics"><article><span>Independent completion</span><strong>'+esc(rate(metric.independent.completionRate))+'</strong></article>'+
      '<article><span>Attempted / approved</span><strong>'+esc(rate(metric.allSelected.attemptRate))+'</strong></article>'+
      '<article><span>Whole products complete</span><strong>'+esc(rate(metric.parentCompletionRate))+'</strong></article>'+
      '<article><span>Unplaced original intents</span><strong>'+esc(metric.unplacedIntents)+'</strong></article></div>'+
      note('The independent completion numerator requires the retained useful-operation, transfer/output and operator review. Native completion and gross history are also shown, with their separate denominators. A zero denominator remains unestablished.')+
      table(['Original proposed target','Required','Observed','Result'],c.targets.map(t=>[esc(label(t.key)),esc(t.expected),esc(t.actual??'Unimplemented rule'),pill(t.met?'Met':'Unmet',t.met?'good':'attention')]))+
      metrics+'<h4>Coverage and retained findings</h4>'+
      (c.issues.length?table(['Finding','Original identity','Effect'],c.issues.map(i=>[esc(i.message),esc(i.id),pill(i.blocking?'Acceptance evidence incomplete':'Retained observation')])):note('No unresolved acceptance finding in this frozen source. This result does not record issuer acceptance.'))+
      '<h4>Exact native quantities</h4>'+table(['Network / payment asset','Unique transactions','Payment atomic amount','Known fee stroops','Unknown fee transactions','Unresolved amount proofs','Settles in window'],c.amounts.map(x=>[
        esc(x.network)+'<small>'+esc(x.asset)+'</small>',esc(x.transactions),esc(x.amountAtomic),esc(x.knownFeesAtomic),esc(x.unknownFeeTransactions),esc(x.unresolvedAmountTransactions??0),esc(x.settledInWindowAtomic)]))+
      '<h4>Same useful operation & returning buyers</h4>'+table(['Operation','Distinct facilitator operators','Original intents'],c.facilitatorComparisons.map(x=>[
        esc(x.operation.label)+'<small>'+esc(x.operation.scope)+'</small>',esc(x.facilitatorOperatorIds.join('\n')),esc(x.intentIds.join('\n'))]))+
      table(['Returning accountable buyer','Distinct UTC completion days'],c.returningBuyers.map(x=>[esc(x.operatorId),esc(x.completionDays.join(', '))]))+
      detail('Original outcome timing and effort',c.outcomes)+detail('Parent products and actual refunds',{products:c.products,refundCash:c.refundCash})+
      '</section><section class="cohort-panel"><div class="cohort-section-heading"><h3>Original intent population</h3>'+field('Show','intentFilter',session.intentFilter,{options:[['all','All original selected intents'],['exceptions','Missing or conflicting observations'],['independent','Independent useful completions'],['team','Team-operated baseline']]})+'</div>'+
      pager('intent',all.length)+table(['Original intent','Window / first attempt','Attempt / settlement','Completion / adjustments','Retained detail'],
      all.slice(session.intentPage*25,session.intentPage*25+25).map(x=>[
        esc(x.intentId||'Intent unentered')+'<small>'+esc(x.buyerOperatorId||'Buyer unbound')+'</small>',
        pill(x.unplaced?'Unplaced':x.inWindow?'In cohort':'Outside window')+'<small>'+esc(x.firstAttemptAt)+'</small>',
        esc(x.attempted?'Attempted':'No recorded attempt')+'<small>'+esc(x.settled?'Settlement recorded':'No confirmed settlement')+'</small>',
        esc(x.completeInWindow?'Native complete in window':'Incomplete in window')+'<small>Independent: '+esc(x.independentCompleteInWindow)+'<br>Gross: '+esc(x.grossCompleteInWindow)+'<br>Refunded: '+esc(x.refundedAfterSettlement)+'</small>',
        detail('Intent and original observations',{intent:x,observations:c.observations.filter(p=>p.groupId===x.id)})]))+
      pager('intent',all.length)+detail('Outside the selected deployment scope',c.excludedObservations)+
      '<small class="cohort-hash">Measurement '+esc(c.source.measurementSha256)+'<br>Preview '+esc(c.previewSha256)+(frozen?'<br>Retained immutable review':'')+'</small></section>';
  }
  function evaluate(){
    return '<section class="cohort-panel"><div class="cohort-section-heading"><div><h3>Evaluate the original retained cohort</h3><p>Preview reads the current case. Freeze retains the complete reviewed inputs, observations, original sources and findings.</p></div><div class="cohort-actions">'+
      button('Evaluate current draft','preview','data-cohort-write="true"')+button('Freeze reviewed cohort','freeze','data-cohort-write="true"',!session.preview||session.preview.source.version!==draft().baseVersion)+'</div></div>'+
      note('An incomplete or unmet result can be frozen truthfully. Selecting it later in Tranche completion exposes those findings and does not mark the proposed criteria as passed.')+'</section>'+
      (session.preview?resultView(session.preview):empty('Set the window and explicit source associations, then evaluate this draft. Unknown values remain visible.'));
  }
  function saved(){
    const rows=(caseValue.reviews||[]).filter(x=>x.purpose==='COHORT_EVALUATION');
    const r=session.review;
    return '<section class="cohort-panel"><h3>Original frozen cohort reviews</h3>'+
      (rows.length?table(['Review','Window','Source / targets','Reopen'],rows.map(x=>[
        esc(x.cohortName)+'<small>'+esc(x.id)+' · '+esc(x.createdAt)+' · '+esc(x.actor)+'</small>',
        esc(x.cohortWindow.start)+' → '+esc(x.cohortWindow.end),
        pill(x.cohortSourceCurrent?'Measurement source current':'Source changed',x.cohortSourceCurrent?'':'attention')+' '+pill(x.cohortReady?'Targets met':'Findings retained'),
        button('Open frozen review','review','data-id="'+esc(x.id)+'"')])):empty('No cohort review has been frozen in this original case.'))+
      note('Tranche completion can select these exact review identities. Its existing payment clock, deliverable assignments, submission record and issuer outcome remain the same original workflow.')+'</section>'+
      (r?'<section class="cohort-panel"><div class="cohort-section-heading"><h3>'+esc(r.id)+'</h3><div class="cohort-actions">'+
      button('Download complete cohort','download-review')+button('Use as new draft','use-review','data-cohort-write="true"')+'</div></div>'+
      '<p>Recorded by '+esc(r.actor)+' · '+esc(r.createdAt)+' · original case version '+esc(r.version)+'</p></section>'+resultView(r.cohort,true):'');
  }

  function editor(kind,id=null){
    const x=inputs(),editorKey=kind+'|'+(id||'new');
    if(session.editors[editorKey]){
      session.dialog=session.editors[editorKey];session.lastEditorKey=editorKey;return;
    }
    const base={sourceIds:[],sourceNote:''};
    let data;
    if(kind==='operations')data=id?x.operations.find(y=>y.id===id):{id:nonce('operation'),label:'',merchantDeploymentId:'',scope:'',expectedOutput:'',...base};
    else if(kind==='facilitators')data=id?x.facilitators.find(y=>y.id===id):{id:nonce('facilitator'),name:'',operatorId:'',serviceUrl:'',participantClass:'TEAM_OPERATED',...base};
    else if(kind==='bindings')data=x.bindings.find(y=>y.purchaseId===id)||{purchaseId:id,buyerDeploymentId:'',operationId:'',facilitatorId:'',transferVerified:false,outputAccepted:false,orderCompletedAt:null,...base};
    else if(kind==='products')data=id?x.products.find(y=>y.id===id):{id:nonce('product'),label:'',purchaseIds:[],state:'UNKNOWN',completedAt:null,...base};
    else if(kind==='outcomes')data=id?x.outcomes.find(y=>y.id===id):{id:nonce('outcome'),kind:'INTERRUPTED_SETTLED_PURCHASE',deploymentId:'',reference:'',startedAt:null,alertedAt:null,acknowledgedAt:null,completedAt:null,activeMinutes:null,operatorId:'',participantClass:'TEAM_OPERATED',result:'',financialOutcome:'',...base};
    else if(['coverage','awardAcceptance','requiredWork'].includes(kind))data=x[kind];
    if(!data)throw new Error('The selected draft entry is unavailable.');
    session.dialog={editorKey,kind,id,data:clone(data)};session.editors[editorKey]=session.dialog;session.lastEditorKey=editorKey;persist();
  }
  function modal(){
    const selected=session.dialog;if(!selected)return '';
    const {kind,data:x}=selected;
    const titles={operations:'Useful merchant operation',facilitators:'Facilitator operator',bindings:'Original purchase association',products:'Whole parent product',outcomes:'Original deployed outcome',coverage:'Retained observation coverage',awardAcceptance:'Actual award acceptance',requiredWork:'Required deployed work'};
    const dt=(title,key,help='')=>field(title,key,x[key],{wide:true,help:help||'Original timestamp with timezone; keep unknown blank.'});
    let fields='';
    if(kind==='operations'){
      fields=field('Stable reviewed operation ID','id',x.id,{required:true})+field('Useful operation label','label',x.label,{required:true})+
        field('Selected original merchant','merchantDeploymentId',x.merchantDeploymentId,{options:selectOptions(depOptions(inputs().merchantDeploymentIds)),required:true,wide:true})+
        field('Same useful scope, contract and complete terms','scope',x.scope,{area:true,wide:true})+
        field('Agreed complete output','expectedOutput',x.expectedOutput,{area:true,wide:true,help:'Preserve any real provider-specific terms differences. Similar route names do not prove one useful operation.'});
    }else if(kind==='facilitators'){
      fields=field('Stable service ID','id',x.id,{required:true})+field('Actual service name','name',x.name,{required:true})+
        field('Accountable operator identity','operatorId',x.operatorId,{required:true,wide:true,help:'Use the same identity across endpoints controlled by one operator.'})+
        field('Original deployed service URL','serviceUrl',x.serviceUrl,{type:'url',wide:true})+
        field('Actual participation','participantClass',x.participantClass,{options:choice('TEAM_OPERATED','INDEPENDENT_OPERATOR','CUSTOMER')});
    }else if(kind==='bindings'){
      const p=caseValue.records.purchases.find(y=>y.id===x.purchaseId);
      fields='<div class="cohort-wide">'+detail('Exact original purchase',p)+'</div>'+
        field('Original purchase ID','purchaseId',x.purchaseId,{attrs:'readonly',wide:true})+
        field('Selected actual buyer','buyerDeploymentId',x.buyerDeploymentId,{options:selectOptions(depOptions(inputs().buyerDeploymentIds)),wide:true})+
        field('Reviewed useful operation','operationId',x.operationId,{options:selectOptions(inputs().operations.map(o=>[o.id,o.label])),wide:true})+
        field('Actual facilitator service','facilitatorId',x.facilitatorId,{options:selectOptions(inputs().facilitators.map(f=>[f.id,f.name+' · '+f.operatorId])),wide:true})+
        field('Matching native transfer independently verified','transferVerified',x.transferVerified,{check:true,wide:true})+
        field('Complete expected useful output reviewed','outputAccepted',x.outputAccepted,{check:true,wide:true})+
        dt('Original applicable order completion','orderCompletedAt','Leave blank for an order that is not applicable or whose actual fulfillment time is unknown. A webhook acknowledgment alone is not fulfillment.');
    }else if(kind==='products'){
      fields=field('Stable parent product ID','id',x.id,{required:true})+field('Original product label','label',x.label,{required:true})+
        field('Complete expected original purchase set','purchaseIds',x.purchaseIds,{options:caseValue.records.purchases.map(p=>[p.id,(p.intentId||p.id)+' · '+p.outputStatus]),multiple:true,wide:true,size:7})+
        field('Observed product state','state',x.state,{options:choice('UNKNOWN','STARTED','COMPLETE')})+dt('Actual complete-product time','completedAt');
    }else if(kind==='outcomes'){
      fields=field('Stable outcome ID','id',x.id,{required:true})+
        field('Original case kind','kind',x.kind,{options:choice('INTERRUPTED_SETTLED_PURCHASE','MERCHANT_DELIVERY_FAILURE','RESTORE_CUTOVER','INDEPENDENT_SUPPORT')})+
        field('Original deployment','deploymentId',x.deploymentId,{options:selectOptions(depOptions()),required:true,wide:true})+
        field('Original case/event reference','reference',x.reference,{wide:true})+
        dt('Original fault or work start','startedAt')+dt('Actual deployed alert','alertedAt')+dt('Actual acknowledgment','acknowledgedAt')+dt('Actual recovery or completion','completedAt')+
        field('Active operator minutes · exact decimal','activeMinutes',x.activeMinutes,{help:'An elapsed interval does not establish active effort.'})+
        field('Resolving operator identity','operatorId',x.operatorId)+
        field('Resolving operator participation','participantClass',x.participantClass,{options:choice('TEAM_OPERATED','INDEPENDENT_OPERATOR','CUSTOMER')})+
        field('Original result and recovery state','result',x.result,{area:true,wide:true})+
        field('Actual financial outcome','financialOutcome',x.financialOutcome,{area:true,wide:true,help:'For a recovery case, retain the original settlement, refund or unresolved result. This form executes no payment.'});
    }else if(kind==='coverage'){
      fields=field('Retained coverage state','state',x.state,{options:choice('UNKNOWN','PARTIAL','COMPLETE'),wide:true})+
        '<div class="cohort-wide"><div class="cohort-section-heading"><h4>Actual gaps or truncation</h4>'+button('Add coverage gap','gap-add')+'</div>'+
        x.gaps.map((g,i)=>'<fieldset><legend>Gap '+(i+1)+'</legend><div class="cohort-fields">'+field('Start timestamp','gaps.'+i+'.startAt',g.startAt)+
          field('End timestamp','gaps.'+i+'.endAt',g.endAt)+field('Original coverage observation','gaps.'+i+'.note',g.note,{area:true,wide:true,required:true})+
          button('Remove gap from draft','gap-remove','data-index="'+i+'"')+'</div></fieldset>').join('')+'</div>';
    }else if(kind==='awardAcceptance'){
      fields=field('Actual acceptance date','date',x.date,{type:'date',wide:true,help:'Use the original award acceptance source. Planning dates, interest acknowledgments and invitations remain separate.'});
    }else if(kind==='requiredWork'){
      fields='<p class="cohort-wide">'+esc(draft().rule.target.required_work||'Original required deployed work')+'</p>'+
        field('Actual work state','state',x.state,{options:choice('UNKNOWN','IN_PROGRESS','COMPLETE')})+
        dt('Actual completion','completedAt')+
        field('Original recorded work','workIds',x.workIds,{multiple:true,wide:true,options:caseValue.records.work.map(w=>[w.id,w.costId+' · '+w.state+' · '+(w.description||w.id)])});
    }
    return '<dialog class="cohort-dialog" aria-labelledby="cohort-dialog-title"><form data-cohort-editor><header><h3 id="cohort-dialog-title">'+esc(titles[kind])+'</h3>'+button('Close · retain entry','close-editor')+'</header>'+
      '<div class="cohort-fields">'+fields+sourceFields(x)+'</div><footer><p>This saves the local review draft. Evaluate and freeze to retain the original case review.</p><button type="submit">Keep in review draft</button></footer></form></dialog>';
  }
  function assign(target,path,value){
    const parts=path.split('.');let cursor=target;
    for(const part of parts.slice(0,-1))cursor=cursor[part];
    cursor[parts.at(-1)]=value;
  }
  function formValue(el){
    if(el.type==='checkbox')return el.checked;
    if(el.multiple)return [...el.selectedOptions].map(x=>x.value);
    return el.value;
  }
  function commitEditor(){
    const d=session.dialog;if(!d)return;
    const kind=d.kind,value=clone(d.data);
    if(['coverage','awardAcceptance','requiredWork'].includes(kind))inputs()[kind]=value;
    else{
      const identity=kind==='bindings'?'purchaseId':'id',oldId=d.id;
      if(kind!=='bindings'&&oldId&&value.id!==oldId)throw new Error('Keep the existing reviewed identity. Add a separate original definition for a different identity.');
      const index=inputs()[kind].findIndex(x=>x[identity]===(oldId||value[identity]));
      if(index<0){
        if(inputs()[kind].some(x=>x[identity]===value[identity]))throw new Error('This reviewed identity already exists.');
        inputs()[kind].push(value);
      }else inputs()[kind][index]=value;
    }
    delete session.editors[d.editorKey];session.dialog=null;session.lastEditorKey=null;
    changed();session.notice='Updated the review draft. Evaluate the original source before freezing.';
  }
  function remove(kind,id){
    const x=inputs();
    if((kind==='operations'||kind==='facilitators')&&x.bindings.some(b=>b[kind==='operations'?'operationId':'facilitatorId']===id))
      throw new Error('This definition has original purchase associations. Update those associations before removing it from the draft.');
    x[kind]=x[kind].filter(v=>v.id!==id);changed();
  }
  function render(){
    if(!available())return;
    const d=draft();
    root.innerHTML=header()+customerUseIntakes()+navigation()+(!d?empty('Opening the original acceptance rule…'):
      session.tab==='setup'?setup():session.tab==='participants'?participants():session.tab==='purchases'?purchases():
      session.tab==='outcomes'?outcomes():session.tab==='preview'?evaluate():saved())+
      (d?modal():'')+'<input type="file" accept=".json,application/json" data-cohort-import hidden>';
    if(session.dialog){const dialog=$('dialog.cohort-dialog');if(dialog&&!dialog.open)dialog.showModal();}
    controls();
  }
  root.addEventListener('input',event=>{
    const el=event.target;if(!el.name||busy||hostBusy||session.pending||session.inflight||session.accepted)return;
    if(el.closest('[data-cohort-editor]')&&session.dialog){
      assign(session.dialog.data,el.name,formValue(el));session.editors[session.dialog.editorKey]=session.dialog;persist();return;
    }
    if(el.closest('[data-cohort-main]')&&inputs()){
      assign(inputs(),el.name,formValue(el));changed();
    }
  });
  root.addEventListener('change',event=>{
    const el=event.target;if(el.name==='tranche'){
      const selected=Number(el.value);
      run(async()=>{retainEditors();await loadDraft(selected);session.tranche=selected;restoreEditors(draft());session.preview=null;session.review=null;session.reviewId='';session.purchasePage=0;});
    }else if(el.name==='intentFilter'){session.intentFilter=el.value;session.intentPage=0;persist();render();}
    else if(el.matches('[data-cohort-import]')){
      const file=el.files?.[0];if(!file)return;
      run(async()=>{
        if(session.pending||session.inflight||session.accepted)throw new Error('Continue the original freeze before importing another review draft.');
        if(file.size>2000000)throw new Error('Select a complete Cohort draft up to 2 MB.');
        const source=JSON.parse(await file.text());
        if(source.schema!==DRAFT_SCHEMA||![2,3].includes(source.inputs?.tranche))throw new Error('Select the exported original Cohort draft.');
        const seeded=await saveApi(prefix+'/cohort-seed',{expectedVersion:caseValue.program.version,tranche:source.inputs.tranche});
        const incoming=importedDraft(source,seeded.rule);
        if(!available()){
          if(session.alternateDrafts.length>=20)throw new Error('Export and remove an older retained alternate draft before importing another.');
          session.alternateDrafts.push({id:crypto.randomUUID(),label:file.name,draft:incoming});
          session.notice='The complete imported Cohort input is available in Retained edited drafts.';persist(true);return;
        }
        alternateDraft(incoming,'Imported the complete review draft from '+incoming.originalCaseId+' at source v'+incoming.sourceVersion+'.');
      });
    }
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-cohort-action]');if(!target||target.disabled)return;
    const action=target.dataset.cohortAction;
    if(action==='draft-import'){$('[data-cohort-import]').click();return;}
    run(async()=>{
      if(action.startsWith('customer-use-')||action.startsWith('alternate-')){
        const incoming=action.startsWith('customer-use-'),list=incoming?session.customerUseIntakes:session.alternateDrafts;
        const row=list.find(item=>item.id===target.dataset.id);if(!row)throw new Error('The selected retained draft is unavailable.');
        const selected=incoming?{inputs:row.value.inputs,rule:row.value.rule,baseVersion:row.value.source.version,
          originalCaseId:row.value.source.programId,sourceVersion:row.value.source.version,customerUse:row.value.customerUse}:row.draft;
        if(action.endsWith('-export')){
          const value=portableDraft(selected);
          download(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),'tranche-'+selected.inputs.tranche+'-cohort-draft.json');return;
        }
        if(action.endsWith('-open')){alternateDraft(selected,'Opened the selected customer-use review input.');return;}
        if(action.endsWith('-remove')){list.splice(list.indexOf(row),1);return;}
      }
      if(action==='tab'){session.tab=target.dataset.tab;session.dialog=null;return;}
      if(action==='refresh'){
        await reload({adopt:true});session.notice='Read the current original case. Your edited selections remain intact; preview them against this source before freezing.';return;
      }
      if(action==='retry'){await sendPending();return;}
      if(action==='readback'){await finishAccepted();return;}
      if(action==='draft-export'){
        const value=portableDraft(draft());
        download(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),'tranche-'+session.tranche+'-cohort-draft.json');return;
      }
      if(action==='preview'){
        session.preview=await saveApi(prefix+'/cohort-preview',{expectedVersion:draft().baseVersion,inputs:clone(inputs())});
        session.tab='preview';session.intentPage=0;session.notice='Evaluated the exact retained source and explicit review inputs.';return;
      }
      if(action==='freeze'){await freeze();return;}
      if(action==='edit'){editor(target.dataset.kind,target.dataset.id||null);return;}
      if(action==='remove'){remove(target.dataset.kind,target.dataset.id);return;}
      if(action==='close-editor'){$('dialog.cohort-dialog')?.close();session.dialog=null;return;}
      if(action==='resume-editor'){session.dialog=session.editors[session.lastEditorKey];return;}
      if(action==='gap-add'){session.dialog.data.gaps.push({startAt:null,endAt:null,note:''});return;}
      if(action==='gap-remove'){session.dialog.data.gaps.splice(Number(target.dataset.index),1);return;}
      if(action==='purchase-page'){session.purchasePage=Number(target.dataset.page);return;}
      if(action==='intent-page'){session.intentPage=Number(target.dataset.page);return;}
      if(action==='review'){await showReview(target.dataset.id);return;}
      if(action==='download-review'){
        const response=await saveApi(prefix+'/cohort-reviews/'+session.reviewId+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())download(blob,session.reviewId+'-cohort.zip');return;
      }
      if(action==='use-review'){
        const r=session.review;if(!r)return;
        alternateDraft({inputs:clone(r.cohort.inputs),rule:clone(r.cohort.rule),baseVersion:caseValue.program.version,
          originalCaseId:r.cohort.source.programId??caseValue.program.id,sourceVersion:r.cohort.source.version,dirty:true},
          'Opened the original frozen inputs as a new review draft.');return;
      }
    });
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-cohort-editor]'))return;event.preventDefault();
    run(async()=>commitEditor());
  });
  root.addEventListener('cancel',event=>{
    if(event.target.matches('dialog.cohort-dialog')){event.preventDefault();if(!session.pending&&!session.inflight){session.dialog=null;persist();render();}}
  },true);
  render();
  const ready=(async()=>{
    receiveCustomerUseDraft();
    if(session.inflight){try{await session.inflight;}catch(error){session.error=error.message;}}
    await loadDraft(session.tranche);
    if(session.accepted)await finishAccepted();
    else if(session.reviewId)await showReview(session.reviewId);
    persist();if(available())render();
  })();
  return {root,ready,setHostBusy(value){hostBusy=!!value;controls();},
    dispose(){persist();active=false;$('dialog.cohort-dialog')?.close();}};
}
