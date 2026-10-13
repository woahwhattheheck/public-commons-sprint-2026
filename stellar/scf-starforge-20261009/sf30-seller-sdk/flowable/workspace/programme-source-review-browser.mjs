// MIT. Complete colleague source review in the original Flowable authoring desk.
import {
 createProgrammeSourceIssue,createProgrammeSourceReturn,compareProgrammeSourceReturn,applyProgrammeSourceReturn,
 createProgrammeSourceReviewWork,validateProgrammeSourceReviewWork,parseProgrammeSourceExchange,
 serializeProgrammeSourceExchange,programmeSourceReviewDraft,exportProgrammeSourceReviewBranch
} from './programme-source-review.mjs';
import {validateProgrammeDraft,serializeProgrammeDraft,programmeUtf8} from './programme-authoring.mjs';

const WORK_FILE_SCHEMA='stellar-forge.flowable-programme-source-review-session.v1';
const WORK_FILE_LIMIT=80*1024*1024;
const EXCHANGE_FILE_LIMIT=64*1024*1024;
const decisions=[['Choose explicitly',''],['Keep current','KEEP_CURRENT'],['Take returned','TAKE_RETURNED'],['Use issued baseline','USE_BASELINE']];
const copy=value=>JSON.parse(JSON.stringify(value));
const stamp=context=>({scope:context.scope,id:context.draft.id,version:context.version,epoch:context.epoch});
const same=(a,b)=>a.scope===b.scope&&a.id===b.id&&a.version===b.version&&a.epoch===b.epoch;
const need=(value,message)=>{if(!value)throw new Error(message);};

export function installProgrammeSourceReview({
 root,node,button,busy,notice,table,pre,download,readSourceFile,getContext,setState,openWorking,flush
}){
 let comparison=null,comparisonStamp=null,renderedIdentity=null;
 const host=node('section',null,{class:'programme-source-review panel'});
 const heading=node('h3','Colleague source review');
 const status=node('p','Issue an editable source draft, receive the colleague’s proposal, and choose the source to keep.',{class:'muted',role:'status','aria-live':'polite'});
 const toolbar=node('div',null,{class:'toolbar'}),issuePanel=node('details'),reviewPanel=node('details'),authorPanel=node('details');
 const issueFields=node('div',null,{class:'form-grid'}),reviewFields=node('div',null,{class:'form-grid'}),authorFields=node('div',null,{class:'form-grid'});
 const comparisonPanel=node('div'),sourcePanel=node('div'),historyPanel=node('details');
 const issueControls={},reviewControls={},authorControls={};
 const current=()=>{const context=getContext();need(context?.draft,'Create or reopen the complete source draft.');return context;};
 const work=context=>context.sourceReview?validateProgrammeSourceReviewWork(context.sourceReview):createProgrammeSourceReviewWork();
 function field(parent,label,control){const wrap=node('label',label);wrap.append(control);parent.append(wrap);return control;}
 function writeText(group,key,label,multiline,controls,parent){
  const input=field(parent,label,node(multiline?'textarea':'input',null,multiline?{rows:'3',maxlength:'4000'}:{maxlength:'300'}));controls[key]=input;
  input.addEventListener('input',()=>{
   const context=current(),next=work(context);next[group][key]=input.value;
   setState(stamp(context),{sourceReview:next});
   if(comparisonStamp&&same(comparisonStamp,stamp(context)))comparisonStamp=stamp(current());
  });return input;
 }
 function select(options,value){
  const input=node('select');for(const[label,key]of options)input.append(node('option',label,{value:key}));input.value=value;return input;
 }
 function guard(captured){need(same(captured,stamp(current())),'The active draft or working review changed while this operation was being prepared. Reopen the current selection and retry.');}
 async function commit(captured,next,changedDraft){
  guard(captured);setState(captured,{sourceReview:validateProgrammeSourceReviewWork(next),...(changedDraft?{draft:validateProgrammeDraft(changedDraft)}:{})});
  await flush();render();
 }
 async function readFile(control,maximum){
  const file=control.files?.[0];if(!file)return null;
  need(file.size<=maximum,'Select the complete source file within the '+(maximum/1024/1024)+' MiB limit.');
  return readSourceFile(file);
 }
 async function localExchange(next){
  need(next.exchangeText,'Issue this draft or reopen its complete review working file first.');
  return parseProgrammeSourceExchange(next.exchangeText);
 }
 function now(){return new Date().toISOString();}
 function filename(value,suffix){return String(value||'programme').replace(/[^A-Za-z0-9_.-]/g,'-').slice(0,100)+suffix;}
 function changedRows(value){return value.rows.filter(row=>row.changed??(row.currentChanged||row.returnedChanged));}
 function clearComparison(message){
  comparison=null;comparisonStamp=null;
  comparisonPanel.replaceChildren(node('p',message||'Compare the returned proposal with the current source draft.',{class:'muted'}));
  sourcePanel.replaceChildren();
 }
 async function issue(){
  await flush();const context=current(),captured=stamp(context),next=work(context);
  const continuation=!!next.exchangeText;
  const {exchange}=await createProgrammeSourceIssue(context.draft,{id:crypto.randomUUID(),at:now(),...next.issue});
  guard(captured);const text=await serializeProgrammeSourceExchange(exchange);guard(captured);
  next.mode='author';next.exchangeText=text;next.incomingText='';next.selectedReturnId='';next.basisSha256='';next.choices={};next.selectedRow='';
  if(continuation)await openWorking({draft:context.draft,sourceReview:next},captured);else await commit(captured,next);
  clearComparison();render();download(text,filename(exchange.issue?.id,'.source-review.json'));
  notice('The complete issued draft is saved with this local draft and downloaded for the named colleague.');
 }
 async function returnProposal(){
  await flush();const context=current(),captured=stamp(context),next=work(context),exchange=await localExchange(next);guard(captured);
  const result=await createProgrammeSourceReturn(exchange,context.draft,{id:crypto.randomUUID(),at:now(),reviewer:next.review.reviewer,note:next.review.note});
  const text=await serializeProgrammeSourceExchange(result.exchange);guard(captured);
  next.mode='reviewer';next.exchangeText=text;next.selectedReturnId=result.returnRecord.id;next.basisSha256='';next.choices={};
  await commit(captured,next);download(text,filename(result.returnRecord.id,'.source-return.json'));
  notice('The full proposal and issued source are downloaded. The author explicitly selects any changes to adopt.');
 }
 async function compare(){
  await flush();const context=current(),captured=stamp(context),next=work(context);
  need(next.incomingText,'Open a returned source proposal.');
  const exchange=await localExchange(next);guard(captured);
  const result=await compareProgrammeSourceReturn(context.draft,exchange,next.incomingText,{...(next.selectedReturnId?{returnId:next.selectedReturnId}:{})});guard(captured);
  if(next.basisSha256!==result.basisSha256)next.choices={};
  next.basisSha256=result.basisSha256;next.selectedReturnId=result.returnRecord.id;
  setState(captured,{sourceReview:next});const committed=stamp(current());await flush();guard(committed);
  comparison=result;comparisonStamp=committed;render();
  notice('Current, issued and returned source are compared. Select a disposition for every changed row before adopting.');
 }
 async function apply(){
  await flush();const context=current(),captured=stamp(context),next=work(context);
  need(comparison&&comparisonStamp&&same(comparisonStamp,captured),'Compare the current source again before adopting changes.');
  const rows=changedRows(comparison);
  need(rows.every(row=>decisions.some(([,value])=>value&&value===next.choices[row.key])),'Choose explicitly for every changed source or configuration row.');
  const exchange=await localExchange(next);guard(captured);
  const result=await applyProgrammeSourceReturn(context.draft,exchange,next.incomingText,{
   basisSha256:next.basisSha256,choices:copy(next.choices),reviewer:next.adoption.reviewer,note:next.adoption.note,
   id:crypto.randomUUID(),at:now(),...(next.selectedReturnId?{returnId:next.selectedReturnId}:{})
  });guard(captured);
  next.exchangeText=await serializeProgrammeSourceExchange(result.exchange);guard(captured);
  next.mode='author';next.basisSha256='';next.choices={};next.selectedRow='';
  await commit(captured,next,result.draft);clearComparison('The selected sources are adopted. Build a fresh complete programme preview before saving for native review.');
  notice('The chosen source and full review history are saved. Use the existing compiler and native review controls to continue.');
 }
 async function downloadWork(){
  const context=current(),value={schema:WORK_FILE_SCHEMA,draft:validateProgrammeDraft(context.draft),sourceReview:work(context)};
  const text=JSON.stringify(value,null,2)+'\n';need(programmeUtf8(text).length<=WORK_FILE_LIMIT,'The complete review working file exceeds 80 MiB.');
  download(text,filename(context.draft.operation||context.draft.id,'.source-review-work.json'));
 }
 toolbar.append(button('Download complete review working file',downloadWork),button('Download retained exchange',async()=>{
  const context=current(),next=work(context),exchange=await localExchange(next);download(await serializeProgrammeSourceExchange(exchange),filename(exchange.issue.id,'.source-review.json'));
 }));
 const reopenWork=field(toolbar,'Reopen complete review working file',node('input',null,{type:'file',accept:'.json,application/json'}));
 reopenWork.addEventListener('change',()=>busy('Reopen complete review working file',async()=>{
  const captured=stamp(current()),selected=await readFile(reopenWork,WORK_FILE_LIMIT);if(selected===null)return;
  const value=JSON.parse(selected);need(value.schema===WORK_FILE_SCHEMA&&Object.keys(value).every(key=>['schema','draft','sourceReview'].includes(key)),'Select a complete review working file.');
  const draft=validateProgrammeDraft(value.draft),sourceReview=validateProgrammeSourceReviewWork(value.sourceReview);
  if(sourceReview.exchangeText)await parseProgrammeSourceExchange(sourceReview.exchangeText);
  guard(captured);await flush();guard(captured);await openWorking({draft,sourceReview},captured);reopenWork.value='';clearComparison();render();
  notice('The complete review is reopened as a separate local draft, preserving its issued source and history.');
 }));
 issuePanel.append(node('summary','1. Issue the current source to a colleague'),issueFields);
 writeText('issue','label','Review title',false,issueControls,issueFields);
 writeText('issue','issuer','Your name',false,issueControls,issueFields);
 writeText('issue','recipient','Colleague name',false,issueControls,issueFields);
 writeText('issue','note','Requested review and instructions',true,issueControls,issueFields);
 issuePanel.append(node('p','The exchange includes every original model, catalogue and input source. A further review round opens a separate saved draft, preserving the previous round. Review names are recorded attribution.',{class:'muted'}),
  button('Issue and download complete source',issue));
 reviewPanel.append(node('summary','2. Edit an issued draft and return a proposal'));
 const openIssue=field(reviewPanel,'Open an issued review as a separate draft',node('input',null,{type:'file',accept:'.json,application/json'}));
 openIssue.addEventListener('change',()=>busy('Open issued source review',async()=>{
  const captured=stamp(current()),text=await readFile(openIssue,EXCHANGE_FILE_LIMIT);if(text===null)return;
  const exchange=await parseProgrammeSourceExchange(text),draft=await programmeSourceReviewDraft(exchange,{});
  const next=createProgrammeSourceReviewWork();next.mode='reviewer';next.exchangeText=await serializeProgrammeSourceExchange(exchange);
  next.review.reviewer=exchange.issue.recipient;next.issue={label:exchange.issue.label,issuer:exchange.issue.issuer,recipient:exchange.issue.recipient,note:exchange.issue.note};
  guard(captured);await flush();guard(captured);await openWorking({draft,sourceReview:next},captured);openIssue.value='';clearComparison();render();
  notice('Edit the actual catalogue, models, typed inputs and configuration below, then return the full proposal.');
 }));
 reviewPanel.append(reviewFields);
 writeText('review','reviewer','Reviewer name',false,reviewControls,reviewFields);
 writeText('review','note','Proposed changes and rationale',true,reviewControls,reviewFields);
 reviewPanel.append(button('Save and download complete proposal',returnProposal));
 authorPanel.append(node('summary','3. Compare a returned proposal and choose changes'));
 const incoming=field(authorPanel,'Open returned source proposal',node('input',null,{type:'file',accept:'.json,application/json'}));
 incoming.addEventListener('change',()=>busy('Open returned source proposal',async()=>{
  const context=current(),captured=stamp(context),text=await readFile(incoming,EXCHANGE_FILE_LIMIT);if(text===null)return;guard(captured);
  const exchange=await parseProgrammeSourceExchange(text);guard(captured);const next=work(context);
  next.incomingText=text;next.selectedReturnId=exchange.selectedReturnId||(exchange.returns.length===1?exchange.returns[0].id:'');
  next.basisSha256='';next.choices={};next.selectedRow='';await commit(captured,next);incoming.value='';render();
 }));
 const returnSelection=field(authorPanel,'Returned edition',node('select'));
 returnSelection.addEventListener('change',()=>{
  const context=current(),next=work(context);next.selectedReturnId=returnSelection.value;next.basisSha256='';next.choices={};
  setState(stamp(context),{sourceReview:next});clearComparison();
 });
 authorPanel.append(button('Compare against my current draft',compare),comparisonPanel,sourcePanel,authorFields);
 writeText('adoption','reviewer','Adopting engineer',false,authorControls,authorFields);
 writeText('adoption','note','Adoption note',true,authorControls,authorFields);
 authorPanel.append(button('Adopt explicitly selected changes',apply));
 historyPanel.append(node('summary','Retained review history'));
 host.append(heading,status,toolbar,issuePanel,reviewPanel,authorPanel,historyPanel);root.append(host);
 const style=document.querySelector('link[data-programme-source-review-style]')||node('link',null,{rel:'stylesheet',href:'./programme-source-review.css','data-programme-source-review-style':'true'});
 if(!style.parentNode)document.head.append(style);
 function showValue(parent,label,value){
  const panel=node('div',null,{class:'programme-review-value'});panel.append(node('h4',label));
  if(value===null||value===undefined)panel.append(node('p','Member absent',{class:'muted'}));
  else if(value&&typeof value==='object'&&typeof value.text==='string'){
   let identity;try{identity=programmeUtf8(value.text).length+' UTF-8 bytes';}catch{identity='Unfinished text: repair UTF-8 before compilation';}
   panel.append(node('p',value.mediaType+' · '+identity,{class:'muted'}));
   const text=node('textarea',null,{rows:'14',readonly:'',spellcheck:'false','aria-label':label+' complete source'});text.value=value.text;panel.append(text);
  }else panel.append(pre(value));parent.append(panel);
 }
 function inspectRow(row){
  sourcePanel.replaceChildren(node('h4',row.label));const columns=node('div',null,{class:'programme-review-columns'});
  showValue(columns,'Issued baseline',row.baseline);showValue(columns,'Current draft',row.current);showValue(columns,'Returned proposal',row.returned);sourcePanel.append(columns);
 }
 function renderComparison(){
  if(!comparison)return;
  const context=current(),next=work(context);
  if(!comparisonStamp||!same(comparisonStamp,stamp(context))){clearComparison('The draft or review choices changed. Compare the current source before adoption.');return;}
  const rows=changedRows(comparison);
  comparisonPanel.replaceChildren(node('p',rows.length+' changed rows · return '+comparison.returnRecord.id));
  const target=node('div');comparisonPanel.append(target);
  table(target,[{label:'Source or configuration',key:'label'},{label:'Comparison',key:'status'},
   {label:'Inspect',render:row=>button('View all three editions',()=>{
    const context=current(),next=work(context);next.selectedRow=row.key;setState(stamp(context),{sourceReview:next});comparisonStamp=stamp(current());inspectRow(row);
   })},
   {label:'Choice',render:row=>{
    const control=select(decisions,next.choices[row.key]||'');
    control.setAttribute('aria-label','Disposition for '+row.label);
    control.addEventListener('change',()=>{
     const context=current(),next=work(context);
     if(control.value)next.choices[row.key]=control.value;else delete next.choices[row.key];
     setState(stamp(context),{sourceReview:next});comparisonStamp=stamp(current());
    });return control;
   }}],rows,{pageSize:15,empty:'The selected proposal has no changed source or configuration. Its review may still be recorded.'});
  const selected=comparison.rows.find(row=>row.key===next.selectedRow);if(selected)inspectRow(selected);
 }
 function render(){
  const context=getContext();host.hidden=!context?.draft;if(!context?.draft)return;
  const next=work(context),identity=context.scope+'|'+context.draft.id+'|'+context.epoch;
  if(renderedIdentity!==identity){renderedIdentity=identity;clearComparison();}
  for(const[group,controls]of [['issue',issueControls],['review',reviewControls],['adoption',authorControls]])for(const[key,input]of Object.entries(controls))input.value=next[group][key]??'';
  issuePanel.open=!next.exchangeText;reviewPanel.open=next.mode==='reviewer';authorPanel.open=next.mode==='author'&&!!next.exchangeText;
  status.textContent=next.exchangeText?'Complete review source and unfinished choices are retained with this browser draft. Download the working file for independent receiving.':'Issue the current draft or open the colleague’s complete issue file.';
  returnSelection.replaceChildren(node('option','Select returned edition',{value:''}));
  let exchange=null,incoming=null;
  // This display reads only already-retained metadata; every operation uses the complete validating parser.
  try{exchange=next.exchangeText?JSON.parse(next.exchangeText):null;}catch{}
  try{incoming=next.incomingText?JSON.parse(next.incomingText):null;}catch{}
  for(const row of (Array.isArray(incoming?.returns)?incoming.returns:[]).filter(row=>row&&typeof row.id==='string'))returnSelection.append(node('option',String(row.reviewer||row.id)+' · '+String(row.at||'')+' · '+row.id,{value:row.id}));
  returnSelection.value=next.selectedReturnId||'';
  const summary=historyPanel.firstChild;historyPanel.replaceChildren(summary);
  if(exchange){
   const branchSelect=node('select',null,{'aria-label':'Retained complete source branch'});
   const add=(label,value)=>branchSelect.append(node('option',label,{value:JSON.stringify(value)}));
   add('Issued baseline',{branch:'baseline'});
   for(const row of (Array.isArray(exchange.returns)?exchange.returns:[]))add('Return '+row.id+' · '+row.reviewer,{returnId:row.id});
   for(const row of (Array.isArray(exchange.adoptions)?exchange.adoptions:[]))for(const branch of ['baseline','current','returned','result'])
    add('Adoption '+row.id+' · '+branch,{adoptionId:row.id,branch});
   const branchTools=node('div',null,{class:'toolbar'});
   field(branchTools,'Retained source edition',branchSelect);
   branchTools.append(button('Download complete selected source branch',async()=>{
    const context=current(),captured=stamp(context),retained=await localExchange(work(context));guard(captured);
    const selection=JSON.parse(branchSelect.value),value=await exportProgrammeSourceReviewBranch(retained,selection);guard(captured);
    download(serializeProgrammeDraft(value),filename(retained.issue.id+'-'+(selection.adoptionId||selection.returnId||'issue')+'-'+(selection.branch||'returned'),'.source-draft.json'));
    notice('The full historical source draft is downloaded. Reopen it as a separate local draft to inspect or edit that edition.');
   }));
   historyPanel.append(branchTools,pre({issue:exchange.issue,returns:Array.isArray(exchange.returns)?exchange.returns:[],adoptions:Array.isArray(exchange.adoptions)?exchange.adoptions:[]}));
  }
  else historyPanel.append(node('p','No source review has been issued yet.',{class:'muted'}));
  renderComparison();
 }
 function sourceChanged(){clearComparison('The source or programme configuration changed. Compare the returned proposal against this current draft again.');}
 return{render,sourceChanged,clearComparison};
}
