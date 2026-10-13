// Field-level mapping reconciliation inside the original Source Desk working copy.
// The native planner owns assembly; the original Source Desk journal owns apply.
const WORK='stellar-forge.installation-mapping-work.v1';
const COMPARE='stellar-forge.installation-mapping-comparison.v1';
const PLAN='stellar-forge.installation-mapping-plan.v1';
const RECEIPT='stellar-forge.installation-mapping-reconciliation.v1';
const EDITION='stellar-forge.installation-source-edition-transition.v1';
const PAGE=40;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const seal=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const pointer=x=>typeof x==='string'&&(x===''||x.startsWith('/'))&&!/~(?![01])/u.test(x);
const ref=x=>object(x)&&typeof x.draftId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(x.draftId)&&Number.isSafeInteger(x.revision)&&x.revision>0&&seal(x.sha256);
const choices=['','source','target','custom','absent'];
const own=(x,k)=>Object.hasOwn(x,k);

export function parseExactMappingJSON(text){
  if(typeof text!=='string')throw new Error('Retain the complete original native JSON text.');
  let value;try{value=JSON.parse(text);}catch{throw new Error('The original native JSON text is incomplete.');}
  const ranges=new Map(),members=[],length=text.length;let pos=0;
  const ws=()=>{while(pos<length&&/\s/u.test(text[pos]))pos++;};
  function string(){
    const start=pos++;while(pos<length){if(text[pos]==='\\'){pos+=2;continue;}if(text[pos++]==='"')return text.slice(start,pos);}
    throw new Error('Keep the complete original JSON string.');
  }
  function scan(path,depth){
    if(depth>160)throw new Error('Keep the complete original native JSON within its depth limit.');
    ws();const start=pos,token=text[pos];
    if(token==='{'){
      pos++;ws();const keys=new Set();
      if(text[pos]!=='}')for(;;){
        ws();const keyStart=pos,key=JSON.parse(string());
        if(keys.has(key))throw new Error('Keep each original native JSON field once.');keys.add(key);
        ws();if(text[pos++]!==':')throw new Error('Keep the original JSON field separator.');
        scan(path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);
        if(path==='')members.push({key,start:keyStart,end:pos});
        ws();if(text[pos]!==',')break;pos++;
      }
      if(text[pos++]!=='}')throw new Error('Keep the complete original JSON object.');
    }else if(token==='['){
      pos++;ws();let index=0;
      if(text[pos]!==']')for(;;){scan(path+'/'+index++,depth+1);ws();if(text[pos]!==',')break;pos++;}
      if(text[pos++]!==']')throw new Error('Keep the complete original JSON array.');
    }else if(token==='"')string();
    else{while(pos<length&&!/[,\]}\s]/u.test(text[pos]))pos++;if(pos===start)throw new Error('Keep the complete original JSON value.');}
    if(path===''||/^\/(?:sha256|sourceSelection|targetSelection|selection|editionPlan|plan|editionTransition|result|draft|mappingReconciliations)(?:\/(?:sha256|selection|resultFiles|files|findings))?$/u.test(path)||
       /^\/rows\/[0-9]+\/(?:source|target)$/u.test(path)||/^\/mappingReconciliations\/[0-9]+$/u.test(path))ranges.set(path,[start,pos]);
  }
  scan('',0);ws();if(pos!==length)throw new Error('Keep exactly one complete original native JSON value.');
  return {value,text,at(path){const range=ranges.get(path);if(!range)throw new Error('The native JSON is missing original value '+path+'.');return text.slice(range[0],range[1]);},
    unsigned(){return '{'+members.filter(row=>row.key!=='sha256').map(row=>text.slice(row.start,row.end)).join(',')+'}';}};
}
export function prettyExactMappingJSON(text){
  let result='',depth=0,pos=0;const line=()=>'\n'+'  '.repeat(depth);
  while(pos<text.length){
    const token=text[pos];
    if(token==='"'){
      const start=pos++;while(pos<text.length){if(text[pos]==='\\'){pos+=2;continue;}if(text[pos++]==='"')break;}
      result+=text.slice(start,pos);continue;
    }
    if(token==='{'||token==='['){
      result+=token;pos++;
      if(text[pos]===(token==='{'?'}':']')){result+=text[pos++];continue;}
      depth++;result+=line();continue;
    }
    if(token==='}'||token===']'){depth--;result+=line()+token;pos++;continue;}
    if(token===','){result+=','+line();pos++;continue;}
    if(token===':'){result+=': ';pos++;continue;}
    if(/\s/u.test(token)){pos++;continue;}
    result+=token;pos++;
  }
  return result;
}

const keyOrder=(a,b)=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;};
export const nativeJSONCanonical=value=>Array.isArray(value)?'['+value.map(nativeJSONCanonical).join(',')+']':
  object(value)?'{'+Object.keys(value).sort(keyOrder).map(key=>JSON.stringify(key)+':'+nativeJSONCanonical(value[key])).join(',')+'}':JSON.stringify(value);
export function readMappingWire(wire,hash,stable=nativeJSONCanonical){
  if(!object(wire)||wire.schema!=='stellar-forge.installation-mapping-wire.v1'||typeof wire.canonicalJSON!=='string'||
     !seal(wire.sha256)||hash(wire.canonicalJSON)!==wire.sha256)
    throw new Error('Keep the exact original native JSON wire response and its complete identity.');
  const result=parseExactMappingJSON(wire.canonicalJSON);
  if(own(wire,'value')&&stable(wire.value)!==stable(result.value))throw new Error('The displayed native response differs from its exact original JSON.');
  return result;
}

function exact(value,depth=0){
  if(depth>128)throw new Error('Keep mapping values within 128 nested levels.');
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('Keep decimal amounts as exact JSON text strings and whole numbers within the safe integer range.');
  if(value&&typeof value==='object')for(const child of Object.values(value))exact(child,depth+1);
  return value;
}
function custom(text){
  let value;try{value=parseExactMappingJSON(text).value;}catch{throw new Error('Enter one complete JSON value without repeated field names for each custom choice. Use null for a present null value, or choose Absent to remove it.');}
  return exact(value);
}
function assertComparison(value,caseId){
  if(!object(value)||value.schema!==COMPARE||value.caseId!==caseId||!ref(value.source)||!ref(value.target)||
     !own(value,'sourceSelection')||!own(value,'targetSelection')||!Array.isArray(value.rows)||value.rows.length>20000||
     !Array.isArray(value.arrays)||!Array.isArray(value.expandedArrays)||!value.expandedArrays.every(pointer)||!seal(value.sha256))
    throw new Error('Keep the complete native mapping comparison and its exact original revisions.');
  const seen=new Set();
  for(const row of value.rows){
    if(!object(row)||!pointer(row.pointer)||seen.has(row.pointer)||typeof row.sourcePresent!=='boolean'||typeof row.targetPresent!=='boolean'||
       typeof row.sourceType!=='string'||typeof row.targetType!=='string'||!own(row,'source')||!own(row,'target'))
      throw new Error('Keep every complete, unique native mapping comparison row.');
    seen.add(row.pointer);
  }
  for(const row of value.arrays)if(!object(row)||!pointer(row.pointer)||typeof row.expanded!=='boolean'||
    !Number.isSafeInteger(row.sourceLength)||row.sourceLength<0||!Number.isSafeInteger(row.targetLength)||row.targetLength<0)
      throw new Error('Keep the complete native array comparison positions.');
  return value;
}
function assertPlan(value,caseId){
  if(!object(value)||value.schema!==PLAN||value.caseId!==caseId||!ref(value.source)||!ref(value.target)||
     !Array.isArray(value.expandedArrays)||!value.expandedArrays.every(pointer)||!Array.isArray(value.decisions)||
     !Array.isArray(value.arrayChanges)||!own(value,'selection')||!seal(value.selectionSha256)||!seal(value.comparisonSha256)||!seal(value.sha256)||
     !object(value.editionPlan)||value.editionPlan.schema!=='stellar-forge.installation-source-edition-plan.v1'||
     !Array.isArray(value.editionPlan.resultFiles)||!Array.isArray(value.editionPlan.findings)||!seal(value.editionPlan.sha256))
    throw new Error('Keep the complete native mapping preview, file decisions and resulting selection.');
  return value;
}
function assertReceipt(value,caseId,draftId){
  if(!object(value)||value.schema!==RECEIPT||value.state!=='RECONCILED_SOURCE_MAPPING'||value.caseId!==caseId||value.draftId!==draftId||
     !Number.isSafeInteger(value.draftRevision)||!seal(value.sha256)||!object(value.editionTransition)||value.editionTransition.schema!==EDITION)
    throw new Error('Keep the complete saved mapping reconciliation and its original edition transition.');
  assertPlan(value.plan,caseId);return value;
}
function validateReview(value,{caseId,draftId}){
  if(!object(value)||value.schema!==WORK||value.targetDraftId!==draftId||!object(value.decisions)||
     !Array.isArray(value.expandedArrays)||!value.expandedArrays.every(pointer)||typeof value.dirty!=='boolean'||!object(value.views))
    throw new Error('Keep all unfinished mapping choices and their original target draft.');
  for(const [key,row]of Object.entries(value.decisions))
    if(!pointer(key)||!object(row)||!choices.includes(row.choice)||typeof row.customText!=='string')
      throw new Error('Keep every field choice and its exact unfinished custom editor text.');
  for(const row of Object.values(value.views))
    if(!object(row)||typeof row.search!=='string'||!Number.isSafeInteger(row.page)||row.page<0||typeof row.onlyUnresolved!=='boolean')
      throw new Error('Keep the mapping review table position and filter.');
  if(value.comparison)assertComparison(value.comparison,caseId);
  for(const [key,textKey] of [['comparison','comparisonJSON'],['plan','planJSON'],['applied','appliedJSON'],['appliedPlan','appliedPlanJSON']]){
    if(value[key]&&(typeof value[textKey]!=='string'||nativeJSONCanonical(parseExactMappingJSON(value[textKey]).value)!==nativeJSONCanonical(value[key])))
      throw new Error('Keep the exact original native JSON for '+key+'.');
  }
  if(value.appliedResponseJSON!==null&&value.appliedResponseJSON!==undefined)parseExactMappingJSON(value.appliedResponseJSON);
  if(value.plan)assertPlan(value.plan,caseId);
  if(value.applied)assertReceipt(value.applied,caseId,draftId);
  if(value.appliedPlan)assertPlan(value.appliedPlan,caseId);
}
export function validateMappingReconciliationWork(value,context){
  if(value===null||value===undefined)return;
  validateReview(value,context);
  if(!Array.isArray(value.history))throw new Error('Keep the complete earlier mapping reviews.');
  for(const row of value.history){
    if(!object(row)||typeof row.savedAt!=='string'||typeof row.reason!=='string'||!object(row.review)||own(row.review,'history'))
      throw new Error('Keep each complete earlier mapping review with its reason and original time.');
    validateReview(row.review,context);
  }
}
export function createMappingReconciliationDesk(H){
  const E=H.esc,P=H.pretty,S=H.stable;
  const title=p=>p===''?'Entire mapping':p;
  const button=(label,action,attrs='',disabled=false,mutates=false)=>H.btn(label,action,attrs+(mutates?' data-source-edit':''),disabled);
  const detail=(label,value,open=false)=>'<details'+(open?' open':'')+'><summary>'+E(label)+'</summary><pre>'+E(P(value))+'</pre></details>';
  const heading=(label,description)=>'<div class="source-desk-heading"><div><h3>'+E(label)+'</h3><p>'+E(description)+'</p></div></div>';
  function initial(){return {schema:WORK,targetDraftId:H.currentDraft().id,comparison:null,comparisonJSON:null,comparisonInput:null,
    expandedArrays:[],decisions:{},plan:null,planJSON:null,planInput:null,views:{},dirty:false,history:[],applied:null,appliedJSON:null,appliedPlan:null,appliedPlanJSON:null,appliedResponseJSON:null};}
  function work(create=false){
    const edition=H.editionWork();
    if(edition&&!edition.mappingWork&&create){edition.mappingWork=initial();H.changed();}
    return edition?.mappingWork||null;
  }
  function mark(){const w=work();if(w)w.dirty=true;const edition=H.editionWork();if(edition)edition.dirty=true;H.changed();}
  function writable(){
    if(H.readonly())throw new Error('The operating workspace is currently read only.');
    if(H.pending())throw new Error('Recover the original pending source request before editing mapping choices.');
    if(H.historic())throw new Error('Open the current target revision to reconcile its mapping.');
  }
  function input(expanded=work()?.expandedArrays||[]){
    if(!H.comparisonCurrent())throw new Error('Compare the exact customer source editions against the current target revision first.');
    const c=H.editionWork().comparison;
    return {source:clone(c.source.ref),target:clone(c.target.ref),expandedArrays:clone(expanded)};
  }
  function current(w=work()){
    if(!w?.comparison||!w.comparisonInput)return false;
    try{return S(w.comparisonInput)===S(input(w.expandedArrays));}catch{return false;}
  }
  function body(){
    const w=work();if(!current(w))throw new Error('Compare the current complete mappings before previewing field choices.');
    const decisions=w.comparison.rows.map(row=>{
      const choice=w.decisions[row.pointer];
      if(!choice||!choices.slice(1).includes(choice.choice))throw new Error('Choose a result for '+title(row.pointer)+'.');
      return {pointer:row.pointer,choice:choice.choice,value:choice.choice==='custom'?custom(choice.customText):null};
    });
    return {...input(),decisions,files:H.fileChoices()};
  }
  function planCurrent(){
    const w=work();if(!w?.plan||!w.planInput||!current(w))return false;
    try{return S(w.planInput)===S(body());}catch{return false;}
  }
  function canPreview(){try{body();return true;}catch{return false;}}
  const exactCache=new Map();
  function exactView(text){
    if(!exactCache.has(text)){exactCache.set(text,parseExactMappingJSON(text));if(exactCache.size>2)exactCache.delete(exactCache.keys().next().value);}
    return exactCache.get(text);
  }
  function hashCheck(view){
    if(!seal(view.value.sha256)||H.hash(view.unsigned())!==view.value.sha256)
      throw new Error('The exact original native mapping content differs from its recorded identity.');
  }
  const exactDetail=(label,text,open=false)=>'<details'+(open?' open':'')+'><summary>'+E(label)+'</summary><pre>'+E(prettyExactMappingJSON(text))+'</pre></details>';
  function archive(w,reason){
    const review=clone(w);delete review.history;
    w.history.push({savedAt:new Date().toISOString(),reason,review});
  }
  async function compare(expanded=work(true).expandedArrays,reason='Before comparing complete source mappings'){
    writable();const w=work(true),request=input(expanded);
    await H.parkWorking(reason);
    const wire=readMappingWire(await H.api(w.targetDraftId,'/mappings/compare-wire',request),H.hash,S);
    const value=assertComparison(wire.value,H.caseId);
    if(S(value.source)!==S(request.source)||S(value.target)!==S(request.target)||S(value.expandedArrays)!==S(request.expandedArrays))
      throw new Error('The mapping comparison returned different source revisions or array choices.');
    hashCheck(wire);
    const old=new Map((w.comparison?.rows||[]).map((row,index)=>[row.pointer,{row,index}])),decisions={};
    for(const [index,row] of value.rows.entries())decisions[row.pointer]=old.has(row.pointer)&&S(old.get(row.pointer).row)===S(row)&&w.comparisonJSON&&
      exactView(w.comparisonJSON).at('/rows/'+old.get(row.pointer).index+'/source')===wire.at('/rows/'+index+'/source')&&
      exactView(w.comparisonJSON).at('/rows/'+old.get(row.pointer).index+'/target')===wire.at('/rows/'+index+'/target')&&own(w.decisions,row.pointer)?
      clone(w.decisions[row.pointer]):{choice:'',customText:''};
    if(w.comparison||Object.keys(w.decisions).length||w.plan)archive(w,reason);
    w.comparison=value;w.comparisonJSON=wire.text;w.comparisonInput=clone(request);w.expandedArrays=clone(value.expandedArrays);w.decisions=decisions;w.views={};mark();
    H.state().notice='Compared '+value.rows.length+' differing mapping fields. Earlier reviews and custom text remain in this working copy.';
  }
  async function preview(){
    writable();const w=work(true),request=body();
    const wire=readMappingWire(await H.api(w.targetDraftId,'/mappings/preview-wire',request),H.hash,S);
    const value=assertPlan(wire.value,H.caseId);
    if(S(value.source)!==S(request.source)||S(value.target)!==S(request.target)||S(value.expandedArrays)!==S(request.expandedArrays)||
       S(value.decisions)!==S(request.decisions)||value.comparisonSha256!==w.comparison.sha256||
       S(value.editionPlan.files)!==S(request.files)||S(value.editionPlan.selection)!==S(value.selection)||
       value.editionPlan.selectionSha256!==value.selectionSha256||H.hash(wire.at('/selection'))!==value.selectionSha256)
      throw new Error('The native preview differs from the complete field choices, original files or resulting mapping.');
    hashCheck(wire);hashCheck(exactView(wire.at('/editionPlan')));
    if(wire.at('/selection')!==exactView(wire.at('/editionPlan')).at('/selection'))throw new Error('The exact successor selection differs from the original native edition plan.');
    w.plan=value;w.planJSON=wire.text;w.planInput=clone(request);mark();
    H.state().notice='Previewed the complete reconciled mapping and '+value.editionPlan.resultFiles.length+' resulting files. Review findings and array positions before saving.';
  }
  async function apply(){
    writable();H.requireEdit();const w=work();
    if(!planCurrent())throw new Error('Preview all current field and file choices against the latest saved target revision.');
    if(H.mappingDirty()&&!confirm('Archive your complete unsaved source mapping and Installation fields, then adopt this reconciled mapping?'))return;
    await H.parkWorking('Before applying the complete reconciled source mapping');
    return H.issue('mapping.apply',{planJSON:w.planJSON},w.plan.target.revision);
  }
  function originalPlan(original){
    if(typeof original?.body?.data?.planJSON==='string')return exactView(original.body.data.planJSON);
    throw new Error('Retain the exact original native mapping plan with the original browser request.');
  }
  function verifyReceipt(value,original){
    if(original?.body?.action!=='mapping.apply')return false;
    const response=readMappingWire(value.nativeMapping,H.hash,S),plain=clone(value);delete plain.nativeMapping;
    if(S(response.value)!==S(plain))throw new Error('The complete source response differs from its original native JSON.');
    const result=exactView(response.at('/result')),receipt=assertReceipt(result.value,H.caseId,original.draftId),plan=originalPlan(original);
    const transition=receipt.editionTransition,nativeDraft=response.value.draft;
    if(receipt.requestId!==original.body.requestId||receipt.draftRevision!==nativeDraft.revision||
       result.at('/plan')!==plan.text||S(receipt.source)!==S(plan.value.source)||S(receipt.target)!==S(plan.value.target)||
       transition.state!=='EDITABLE_SOURCE_EDITION'||transition.caseId!==H.caseId||transition.draftId!==original.draftId||
       transition.requestId!==original.body.requestId||transition.draftRevision!==nativeDraft.revision||transition.planSha256!==plan.value.editionPlan.sha256||
       !Array.isArray(nativeDraft.mappingReconciliations)||!nativeDraft.mappingReconciliations.some(x=>S(x)===S(receipt)))
      throw new Error('The saved mapping reconciliation differs from its complete original request and retained draft proof.');
    hashCheck(result);hashCheck(plan);hashCheck(exactView(result.at('/editionTransition')));return true;
  }
  function adoptNativeDraft(value){
    if(!value.nativeMapping||value.draft?.id!==H.state().draftId)return;
    const response=readMappingWire(value.nativeMapping,H.hash,S),plain=clone(value);delete plain.nativeMapping;
    if(S(response.value)!==S(plain))throw new Error('The accepted draft differs from its original native response.');
    const draftView=exactView(response.at('/draft')),selectionJSON=draftView.at('/selection');
    if(draftView.value.id!==value.draft.id||draftView.value.caseId!==H.caseId||draftView.value.revision!==value.draft.revision)
      throw new Error('The original native draft belongs to another accepted revision.');
    H.state().nativeDraftJSON=draftView.text;
    if(H.state().work&&!H.state().work.dirty&&H.state().work.baseRevision===value.draft.revision){
      H.state().work.selectionText=selectionJSON==='null'?'':prettyExactMappingJSON(selectionJSON);
      H.state().work.nativeSelectionJSON=selectionJSON;
    }
  }
  function adoptReceipt(value,original){
    if(original?.body?.action!=='mapping.apply'||value.draft?.id!==H.state().draftId)return false;
    verifyReceipt(value,original);const w=work(true),response=readMappingWire(value.nativeMapping,H.hash,S),result=exactView(response.at('/result')),plan=originalPlan(original);
    w.applied=clone(result.value);w.appliedJSON=result.text;w.appliedPlan=clone(plan.value);w.appliedPlanJSON=plan.text;w.appliedResponseJSON=response.text;w.dirty=false;
    H.editionWork().dirty=false;
    adoptNativeDraft(value);
    H.state().notice='Saved reconciled source revision '+value.draft.revision+'. Open Source mapping to review the complete native preparation inputs.';
    H.state().tab='editions';return true;
  }
  async function exactDraft(draft){
    const wire=readMappingWire(await H.api(draft.id,'/mappings/draft-wire',{revision:draft.revision}),H.hash,S);
    if(wire.value.id!==draft.id||wire.value.caseId!==H.caseId||wire.value.revision!==draft.revision)
      throw new Error('The exact original source JSON belongs to another retained draft revision.');
    const selectionJSON=wire.at('/selection');H.state().nativeDraftJSON=wire.text;
    if(H.state().work?.draftId===draft.id&&!H.state().work.dirty&&H.state().work.baseRevision===draft.revision){
      H.state().work.selectionText=selectionJSON==='null'?'':prettyExactMappingJSON(selectionJSON);
      H.state().work.nativeSelectionJSON=selectionJSON;H.changed();
    }
    return {value:wire.value,selectionJSON,selectionSha256:H.hash(selectionJSON)};
  }
  function field(label,key,value,{options=null,area=false,data='',help='',edit=true}={}){
    const attrs=' data-source-mapping-field="'+E(key)+'"'+(edit?' data-source-edit':'')+' '+data;
    const control=options?'<select'+attrs+'>'+options.map(([v,t])=>'<option value="'+E(v)+'"'+(value===v?' selected':'')+'>'+E(t)+'</option>').join('')+'</select>':
      area?'<textarea'+attrs+' rows="6" spellcheck="false">'+E(value)+'</textarea>':'<input'+attrs+' value="'+E(value)+'">';
    return '<label'+(area?' class="source-desk-wide"':'')+'><span>'+E(label)+'</span>'+control+(help?'<small>'+E(help)+'</small>':'')+'</label>';
  }
  function tableView(key,label,all,heads,rowFn){
    const w=work(true),view=w.views[key]||{search:'',page:0,onlyUnresolved:false},needle=view.search.trim().toLocaleLowerCase();
    const positions=key==='fields'?new Map(all.map((row,index)=>[row.pointer,index])):null;
    const searchText=row=>positions?row.pointer+' '+row.sourceType+' '+row.targetType+' '+
      exactView(w.comparisonJSON).at('/rows/'+positions.get(row.pointer)+'/source')+' '+
      exactView(w.comparisonJSON).at('/rows/'+positions.get(row.pointer)+'/target'):P(row);
    const filtered=all.filter(row=>(!needle||searchText(row).toLocaleLowerCase().includes(needle))&&
      (key!=='fields'||!view.onlyUnresolved||!w.decisions[row.pointer]?.choice));
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE)),page=Math.min(view.page,pages-1),start=page*PAGE,selected=filtered.slice(start,start+PAGE);
    return '<section><h4>'+E(label)+'</h4><div class="source-desk-fields">'+
      field('Find within '+label,'search',view.search,{data:'data-view="'+E(key)+'"',edit:false,help:'Search covers every retained row; downloads retain all rows.'})+
      (key==='fields'?field('Show fields','onlyUnresolved',view.onlyUnresolved?'yes':'no',{edit:false,data:'data-view="fields"',options:[['no','All differing fields'],['yes','Unresolved fields only']]}):'')+'</div>'+
      '<p>'+filtered.length+' matching of '+all.length+' total'+(selected.length?' · showing '+(start+1)+'–'+(start+selected.length):'')+'</p>'+
      (selected.length?H.table(heads,selected.map(rowFn)):H.empty(all.length?'No fields match this view.':'The complete mappings have no differences in this section.'))+
      '<div class="source-desk-actions">'+button('Previous','edition-mapping-page','data-view="'+E(key)+'" data-page="'+(page-1)+'"',page===0)+
      '<span>Page '+(page+1)+' of '+pages+'</span>'+button('Next','edition-mapping-page','data-view="'+E(key)+'" data-page="'+(page+1)+'"',page===pages-1)+'</div></section>';
  }
  function shown(present,text,type){return present?'<span>'+E(type)+'</span>'+exactDetail('Complete value',text):'<span>Absent</span>';}
  function render(){
    const w=work(true),c=w.comparison,ready=current(w),remaining=(c?.rows||[]).filter(row=>!w.decisions[row.pointer]?.choice).length;
    let result=heading('Reconcile mapping fields','Choose the source, target, a custom JSON value or absence for every differing field. Unchanged values stay exact.')+
      H.hint('Arrays are whole values unless you explicitly expand them by position. Position 0 stays the original position 0 throughout review; removals compact only after all original positions have been resolved.')+
      '<div class="source-desk-actions">'+button('Compare complete mappings','edition-mapping-compare','',!H.comparisonCurrent()||!H.editing(),true)+
      button('Download complete mapping review','edition-download-mapping-review')+'</div>';
    if(c){
      if(!ready)result+=H.hint('This complete review belongs to earlier edition inputs. Compare against the current source and target before previewing or saving; the earlier review remains available below.');
      result+='<p>'+c.rows.length+' differing fields · '+remaining+' unresolved · '+c.expandedArrays.length+' expanded arrays</p>'+
        exactDetail('Complete source mapping',exactView(w.comparisonJSON).at('/sourceSelection'))+exactDetail('Complete target mapping',exactView(w.comparisonJSON).at('/targetSelection'))+
        tableView('arrays','Array review',c.arrays,['Original array location','Positions','Review mode'],row=>[
          '<code>'+E(title(row.pointer))+'</code>',E('Source '+row.sourceLength+' · Target '+row.targetLength),
          button(row.expanded?'Collapse to whole array':'Expand by original position','edition-mapping-array',
            'data-pointer="'+E(row.pointer)+'" data-expand="'+String(!row.expanded)+'"',!ready||!H.editing(),true)
        ])+
        tableView('fields','Differing mapping fields',c.rows,['Mapping location','Source value','Target value','Result choice','Custom value'],row=>{
          const d=w.decisions[row.pointer]||{choice:'',customText:''},data='data-pointer="'+E(row.pointer)+'"';
          return ['<code>'+E(title(row.pointer))+'</code>',shown(row.sourcePresent,exactView(w.comparisonJSON).at('/rows/'+c.rows.indexOf(row)+'/source'),row.sourceType),shown(row.targetPresent,exactView(w.comparisonJSON).at('/rows/'+c.rows.indexOf(row)+'/target'),row.targetType),
            field('Result for '+title(row.pointer),'choice',d.choice,{data,options:[['','Choose result'],['source',row.sourcePresent?'Source value':'Source absence'],['target',row.targetPresent?'Target value':'Target absence'],['custom','Custom JSON value'],['absent','Absent / remove']]}),
            d.choice==='custom'?field('Custom JSON for '+title(row.pointer),'customText',d.customText,{area:true,data,help:'Strings need quotes. Decimal amounts remain exact text. null is present; Absent removes the field.'}):
              d.customText?detail('Retained earlier custom editor text',d.customText):'<span>No custom value selected.</span>'];
        })+
        '<div class="source-desk-actions">'+button('Use source for all unresolved','edition-mapping-fill','data-choice="source"',!remaining||!ready||!H.editing(),true)+
        button('Use target for all unresolved','edition-mapping-fill','data-choice="target"',!remaining||!ready||!H.editing(),true)+
        button('Preview complete reconciled successor','edition-mapping-preview','',!canPreview()||!H.editing(),true)+'</div>';
    }
    if(w.plan){
      const p=w.plan,ep=p.editionPlan;
      result+=heading('Complete reconciliation preview','Review the resulting mapping, file choices, findings and array position changes together.')+
        (!planCurrent()?H.hint('This retained preview predates the current choices or target revision. Preview again before saving.'):'')+
        exactDetail('Complete resulting mapping',exactView(w.planJSON).at('/selection'),true)+exactDetail('Complete resulting file metadata',exactView(w.planJSON).at('/editionPlan/resultFiles'))+
        detail('Every file decision',ep.files)+detail('Native mapping findings',ep.findings,true)+detail('Original to resulting array positions',p.arrayChanges,true)+
        '<div class="source-desk-actions">'+button('Download complete reconciliation plan','edition-download-mapping-plan')+
        button('Save reconciled successor','edition-mapping-apply','',!planCurrent()||!H.editing(),true)+'</div>';
    }
    const saved=H.draft()?.mappingReconciliations||[],latest=w.applied||saved.at(-1);
    const latestJSON=w.appliedJSON||(saved.length&&H.state().nativeDraftJSON?exactView(H.state().nativeDraftJSON).at('/mappingReconciliations/'+(saved.length-1)):null);
    if(latest)result+=heading('Saved mapping reconciliations','The original source history retains each complete field decision and native edition transition.')+
      (latestJSON?exactDetail('Complete latest reconciliation',latestJSON):detail('Complete latest reconciliation',latest))+
      (H.state().nativeDraftJSON?exactDetail('Complete original saved draft and all reconciliations',H.state().nativeDraftJSON):detail('All retained mapping reconciliations',saved))+
      '<div class="source-desk-actions">'+button('Download recorded reconciliation','edition-download-mapping-receipt')+button('Open source mapping','edition-open-mapping')+'</div>';
    if(w.history.length)result+=heading('Earlier complete mapping reviews','Restore exact unfinished choices, custom text and array expansion. Restoring archives the current review first.')+
      tableView('history','Saved mapping reviews',w.history.map((r,index)=>({index,savedAt:r.savedAt,reason:r.reason,source:r.review.comparison?.source,target:r.review.comparison?.target})),
        ['Saved time','Reason and exact editions','Open'],r=>[E(r.savedAt),E(r.reason)+detail('Original revisions',{source:r.source,target:r.target}),
          button('Restore complete review','edition-mapping-restore','data-index="'+r.index+'"',!H.editing(),true)]);
    return result;
  }
  function edit(target){
    if(!target?.matches?.('[data-source-mapping-field]'))return false;
    const w=work(true),key=target.dataset.sourceMappingField;
    if(['search','onlyUnresolved'].includes(key)){
      const view=target.dataset.view;if(!['fields','arrays','history'].includes(view))throw new Error('Choose an original mapping table.');
      const next=w.views[view]||(w.views[view]={search:'',page:0,onlyUnresolved:false});
      if(key==='search')next.search=target.value;else next.onlyUnresolved=target.value==='yes';
      next.page=0;H.changed();return true;
    }
    writable();
    const p=target.dataset.pointer;
    if(!['choice','customText'].includes(key)||!w.comparison?.rows.some(row=>row.pointer===p))throw new Error('Choose a retained mapping field.');
    if(key==='choice'&&!choices.includes(target.value))throw new Error('Choose source, target, custom or absent.');
    const row=w.decisions[p]||(w.decisions[p]={choice:'',customText:''});row[key]=target.value;mark();return true;
  }
  async function action(name,target){
    if(!name.startsWith('edition-mapping-')&&!name.startsWith('edition-download-mapping-'))return false;
    const w=work(true);
    if(name==='edition-download-mapping-review'){H.download(P(w),'source-mapping-reconciliation-review.json');return true;}
    if(name==='edition-download-mapping-plan'){if(!w.plan)throw new Error('Preview the complete reconciliation first.');H.download(w.planJSON,'source-mapping-reconciliation-plan.json');return true;}
    if(name==='edition-download-mapping-receipt'){
      const value=w.applied||(H.draft()?.mappingReconciliations||[]).at(-1);
      if(!value)throw new Error('Open a saved mapping reconciliation first.');
      const saved=H.draft()?.mappingReconciliations||[];
      const text=w.appliedJSON||(H.state().nativeDraftJSON&&saved.length?exactView(H.state().nativeDraftJSON).at('/mappingReconciliations/'+(saved.length-1)):null);
      if(!text)throw new Error('Reopen the exact retained source draft before downloading its complete native reconciliation.');
      H.download(text,'source-mapping-reconciliation-receipt.json');return true;
    }
    if(name==='edition-mapping-page'){
      const view=target.dataset.view,page=Number(target.dataset.page);
      if(!['fields','arrays','history'].includes(view)||!Number.isSafeInteger(page)||page<0)throw new Error('Choose a valid original mapping review page.');
      w.views[view]={search:w.views[view]?.search||'',onlyUnresolved:!!w.views[view]?.onlyUnresolved,page};H.changed();return true;
    }
    writable();
    if(name==='edition-mapping-compare'){await compare();return true;}
    if(name==='edition-mapping-preview'){await preview();return true;}
    if(name==='edition-mapping-apply'){await apply();return true;}
    if(name==='edition-mapping-array'){
      if(!current(w))throw new Error('Compare the current complete mappings first.');
      const p=target.dataset.pointer,expand=target.dataset.expand==='true';
      if(!w.comparison.arrays.some(row=>row.pointer===p))throw new Error('Choose an original native array.');
      if(!confirm((expand?'Expand '+title(p)+' by original position?':'Collapse '+title(p)+' to a whole-array decision?')+' The current complete review will be retained. Changed decision groups will need review.'))return true;
      const expanded=expand?[...new Set([...w.expandedArrays,p])].sort(keyOrder):w.expandedArrays.filter(x=>x!==p&&!x.startsWith(p+'/'));
      await compare(expanded,expand?'Before expanding '+title(p):'Before collapsing '+title(p));return true;
    }
    if(name==='edition-mapping-fill'){
      if(!current(w)||!['source','target'].includes(target.dataset.choice))throw new Error('Choose source or target for unresolved current fields.');
      await H.parkWorking('Before choosing '+target.dataset.choice+' for all unresolved mapping fields');
      archive(w,'Before choosing '+target.dataset.choice+' for all unresolved mapping fields');
      for(const row of w.comparison.rows)if(!w.decisions[row.pointer]?.choice){
        const d=w.decisions[row.pointer]||(w.decisions[row.pointer]={choice:'',customText:''});d.choice=target.dataset.choice;
      }
      mark();return true;
    }
    if(name==='edition-mapping-restore'){
      const index=Number(target.dataset.index);
      if(!Number.isSafeInteger(index)||index<0||!w.history[index])throw new Error('Choose a complete retained mapping review.');
      const review=clone(w.history[index].review);validateReview(review,{caseId:H.caseId,draftId:w.targetDraftId});
      await H.parkWorking('Before restoring earlier complete mapping choices');
      archive(w,'Before restoring review '+(index+1));review.history=w.history;
      H.editionWork().mappingWork=review;mark();
      H.state().notice='Restored complete earlier mapping choices. Compare again if the saved source or target revisions have advanced.';return true;
    }
    throw new Error('Choose an installed mapping reconciliation action.');
  }
  return {render,edit,action,verifyReceipt,adoptReceipt,adoptNativeDraft,exactDraft,canPreview,canApply:planCurrent};
}
