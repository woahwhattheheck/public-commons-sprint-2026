// MIT. Accepted SF74 source → the existing Customer Installation editor.
// All writes continue through that editor's original preview/save/recovery.
const clone=value=>JSON.parse(JSON.stringify(value));
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(left,right)=>JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
const key=row=>row?row.id+':'+row.sha256:'';
const show=value=>value===null||value===undefined||value===''?'—':String(value);
const message=error=>error?.message||error?.error?.message||'The operation could not finish.';
const selectedSource=context=>Array.isArray(context.sources)?context.sources:Object.values(context.sources||{});
const sourceStamp=context=>({workspaceId:context.workspaceId,caseId:context.caseId,version:context.version});
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
const button=(label,action,options={})=>{const node=element('button',label,options.primary?'primary':'');node.type='button';node.disabled=!!options.disabled;node.addEventListener('click',action);return node;};
const field=(title,input,hint)=>{const wrap=element('label',undefined,'cq-field');wrap.append(element('span',title),input);if(hint)wrap.append(element('small',hint));return wrap;};
const select=(items,current,onChange,empty='Select')=>{
  const node=document.createElement('select');const first=element('option',empty);first.value='';node.append(first);
  for(const row of items){const option=element('option',row.label);option.value=row.value;option.disabled=!!row.disabled;node.append(option);}
  node.value=current||'';node.addEventListener('change',()=>onChange(node.value));return node;
};
const details=(title,value)=>{const node=document.createElement('details');node.append(element('summary',title),element('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return node;};
function table(columns,rows,empty='No rows in this selection.'){
  if(!rows.length)return element('p',empty,'cq-muted');
  const wrap=element('div',undefined,'cq-table-wrap'),node=document.createElement('table'),head=document.createElement('thead'),line=document.createElement('tr'),body=document.createElement('tbody');
  for(const column of columns)line.append(element('th',column.label));head.append(line);node.append(head);
  for(const row of rows){const tr=document.createElement('tr');for(const column of columns){const cell=document.createElement('td');const value=column.render?column.render(row):show(row[column.key]);cell.append(value instanceof Node?value:document.createTextNode(show(value)));tr.append(cell);}body.append(tr);}
  node.append(body);wrap.append(node);return wrap;
}
function valueBlock(value){return element('pre',typeof value==='string'?show(value):JSON.stringify(value,null,2),'cq-value');}
function quotedOption(row){return row.title||row.reference||row.id;}
function downloadText(filename,value,type='application/json'){
  const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

/**
 * Required services:
 * context() -> {workspaceId,caseId,version,sources,installations}
 * inventory(body), seed(body), getInstallation(id)
 * currentDraft(id|null) -> {document,expectedRevision,draftKey}|null
 * receiveDraft({scope,installationId,expectedRevision,document,originalDraft,review})
 * openInstallation(id|null), downloadSource(id)
 * receiveDraft applies a local draft only after its current case, selected
 * edition and originalDraft still match. The original editor owns its save.
 */
export function mountCommercialInstallations(root,services,retained={}){
  if(!root||!services||typeof services.context!=='function')throw new Error('Connect the original Installation context.');
  const state=retained;let active=true;
  Object.assign(state,{epoch:0,destroyed:false,busy:false,error:'',notice:'',inventory:null,review:null,target:null,reviewInput:null,
    sourceId:state.sourceId||'',quoteKey:state.quoteKey||'',acceptanceKey:state.acceptanceKey||'',installationId:state.installationId||'',
    resolutions:state.resolutions||{}});
  root.classList.add('commercial-installations');
  let context=clone(services.context()),stamp=sourceStamp(context);
  const source=()=>selectedSource(context).find(row=>row.id===state.sourceId)||null;
  const quotes=()=>state.inventory?.original?.quotes||[];
  const quotation=()=>quotes().find(row=>key(row)===state.quoteKey)||null;
  const acceptance=()=>quotation()?.acceptances?.find(row=>key(row)===state.acceptanceKey)||null;
  const selectedOriginal=()=>{const s=source(),q=quotation(),a=acceptance();return s&&q&&a?{
    sourceId:s.id,expectedSourceSha256:s.sha256,quoteId:q.id,quoteSha256:q.sha256,
    acceptanceId:a.id,acceptanceSha256:a.sha256}:null;};
  function invalidate({inventory=false,target=false}={}){
    state.epoch++;state.review=null;state.reviewInput=null;state.resolutions={};state.error='';state.notice='';
    if(inventory)state.inventory=null;if(target)state.target=null;
  }
  function still(epoch,captured=stamp){return active&&!state.destroyed&&state.epoch===epoch&&same(stamp,captured)&&same(sourceStamp(services.context()),captured);}
  function updateContext(){
    const next=clone(services.context()),nextStamp=sourceStamp(next);
    if(!same(nextStamp,stamp)){context=next;stamp=nextStamp;invalidate({inventory:true,target:true});state.notice='The saved case changed. Read the selected original quotation and current Installation again before reviewing the next draft.';}
    else context=next;
  }
  async function invoke(operation){
    if(!active||state.busy)return;state.busy=true;state.error='';render();
    const epoch=state.epoch;
    try{await operation();}catch(error){if(active&&!state.destroyed&&state.epoch===epoch)state.error=message(error);}
    finally{if(active){state.busy=false;if(!state.destroyed)render();}}
  }
  async function readInventory(){
    updateContext();const s=source();if(!s){state.error='Select the complete original merchant workspace or Support handoff.';render();return;}
    const epoch=++state.epoch,captured=clone(stamp),selected={sourceId:s.id,expectedSourceSha256:s.sha256};
    state.review=null;state.reviewInput=null;state.resolutions={};
    await invoke(async()=>{
      const result=await services.inventory({expectedVersion:captured.version,...selected});
      if(!still(epoch,captured))return;
      if(result?.selection?.sourceId!==selected.sourceId||result.selection.expectedSourceSha256!==selected.expectedSourceSha256)throw new Error('The source reader returned another selected file.');
      state.inventory=result;
      if(!quotes().some(row=>key(row)===state.quoteKey)){state.quoteKey='';state.acceptanceKey='';}
      if(!quotation()?.acceptances?.some(row=>key(row)===state.acceptanceKey))state.acceptanceKey='';
      state.notice=quotes().length?'Select the exact quotation and its recorded customer acceptance.':'This source contains no accepted quotation available for commissioning.';
    });
  }
  async function loadTarget(id){
    if(state.busy)return;
    updateContext();invalidate({target:true});state.installationId=id;const epoch=state.epoch,captured=clone(stamp);
    await invoke(async()=>{
      const local=services.currentDraft?.(id||null);
      const saved=id?await services.getInstallation(id):null;
      if(!still(epoch,captured))return;
      if(saved&&saved.id!==id)throw new Error('The Installation reader returned another saved record.');
      if(local&&saved&&local.expectedRevision!==saved.revision){
        state.notice='The existing editor draft is based on an older Installation edition. Reconcile it in the original editor before receiving accepted scope.';
        state.target={saved,local:clone(local),stale:true};return;
      }
      state.target={saved,local:local?clone(local):null,stale:false};
    });
  }
  function draftSnapshot(){
    const local=services.currentDraft?.(state.installationId||null)||null;
    if(local)return clone(local);
    if(state.target?.saved)return {document:clone(state.target.saved.preview.document),expectedRevision:state.target.saved.revision,draftKey:null};
    return null;
  }
  async function review(){
    if(state.busy)return;
    updateContext();const selected=selectedOriginal();
    if(!selected){state.error='Select an original quotation and recorded customer acceptance.';render();return;}
    if(state.target?.stale){state.error='Reconcile the existing Installation draft first.';render();return;}
    const originalDraft=draftSnapshot();
    const revision=state.installationId?(state.target?.saved?.revision||originalDraft?.expectedRevision):0;
    if(state.installationId&&!revision){state.error='Read the selected Installation before reviewing this accepted source.';render();return;}
    if(originalDraft&&originalDraft.expectedRevision!==revision){state.error='The original Installation edition changed. Reopen it before this review.';render();return;}
    const captured=clone(stamp),epoch=++state.epoch;
    const body={expectedVersion:captured.version,...selected,installationId:state.installationId||null,
      expectedRevision:revision,resolutions:clone(state.resolutions)};
    if(originalDraft)body.document=clone(originalDraft.document);
    state.review=null;state.reviewInput=null;
    await invoke(async()=>{
      const result=await services.seed(body);
      if(!still(epoch,captured))return;
      if(result?.installationId!==body.installationId||result.expectedRevision!==body.expectedRevision||
         result.original?.selected?.quoteId!==selected.quoteId||result.original.selected.acceptanceId!==selected.acceptanceId||
         result.original.source.sha256!==selected.expectedSourceSha256)throw new Error('The review returned a different original selection.');
      state.review=result;state.reviewInput={body,scope:captured,originalDraft};
      state.notice=result.canApply?'Review the resulting task and field changes, then continue in the original Installation editor.':'Choose the fields edited on both sides, then review those choices.';
    });
  }
  function setResolution(name,value){state.resolutions={...state.resolutions};if(value)state.resolutions[name]=value;else delete state.resolutions[name];state.reviewInput=null;state.notice='The selected field choices need a fresh source review.';render();}
  function sameDraftAfterReview(){
    if(!state.reviewInput)return false;
    return same(draftSnapshot(),state.reviewInput.originalDraft);
  }
  async function continueDraft(){
    updateContext();const selected=state.review,input=state.reviewInput;
    if(services.readOnlyReason?.()){state.error=services.readOnlyReason();render();return;}
    if(!selected?.canApply||!input){state.error='Review the current accepted scope and field choices first.';render();return;}
    if(!same(stamp,input.scope)||!sameDraftAfterReview()){
      state.error='The current Installation draft changed after this review. Review accepted scope again to preserve those edits.';render();return;
    }
    const epoch=state.epoch;
    await invoke(async()=>{
      const result=await services.receiveDraft({scope:clone(input.scope),installationId:selected.installationId,
        expectedRevision:selected.expectedRevision,document:clone(selected.document),originalDraft:clone(input.originalDraft),
        review:{sha256:selected.reviewSha256,source:clone(selected.original),resolutions:clone(selected.resolutions)}});
      if(!still(epoch,input.scope))return;
      if(result?.applied===false)throw new Error(result.message||'The original editor retained a changed draft. Review its current work before applying this source.');
      state.notice='The complete accepted scope is in the original Installation draft. Its preview, save and request recovery continue there.';
      await services.openInstallation(selected.installationId);
    });
  }
  function renderSelection(container){
    const choices=element('div',undefined,'cq-grid');
    choices.append(field('Original commercial source',select(selectedSource(context).map(row=>({value:row.id,label:(row.name||row.filename||row.id)+' · '+row.bytes+' bytes'})),
      state.sourceId,id=>{invalidate({inventory:true});state.sourceId=id;state.quoteKey='';state.acceptanceKey='';render();}),
      'Use the complete saved merchant workspace or Support handoff attached to this case.'));
    const installations=Array.isArray(context.installations)?context.installations:Object.values(context.installations||{});
    choices.append(field('Customer Installation',select(installations.map(row=>({value:row.id,label:(row.name||row.title||row.id)+' · edition '+row.revision})),
      state.installationId,id=>void loadTarget(id),'Prepare a new Installation')));
    container.append(choices);
    const controls=element('div',undefined,'cq-actions');
    controls.append(button('Read accepted quotations',()=>void readInventory(),{disabled:state.busy||!source()}));
    if(source())controls.append(button('Download complete original source',()=>void invoke(()=>services.downloadSource(source().id)),{disabled:state.busy}));
    if(state.installationId){
      controls.append(button('Read current Installation',()=>void loadTarget(state.installationId),{disabled:state.busy}));
      controls.append(button('Open existing Installation',()=>void services.openInstallation(state.installationId),{disabled:state.busy}));
    }
    container.append(controls);
    if(!state.inventory)return;
    const original=state.inventory.original;
    if(state.inventory.missingFiles?.length)container.append(element('h4','Referenced files to attach'),table([{label:'Original filename',key:'name'},{label:'Bytes',key:'bytes'},{label:'SHA-256',key:'sha256'}],state.inventory.missingFiles));
    container.append(element('h3',original.case?.name||'Original merchant case'));
    const edition=element('div',undefined,'cq-grid');
    edition.append(field('Saved accepted quotation',select(quotes().map(row=>({value:key(row),label:quotedOption(row)+' · '+(row.reference||row.id)})),
      state.quoteKey,value=>{invalidate();state.quoteKey=value;state.acceptanceKey='';render();})));
    const responses=quotation()?.acceptances||[];
    edition.append(field('Recorded customer acceptance',select(responses.map(row=>({value:key(row),label:[row.observedAt,row.actor,row.reference].filter(Boolean).join(' · ')||row.id})),
      state.acceptanceKey,value=>{invalidate();state.acceptanceKey=value;render();})));
    container.append(edition);
    const quote=quotation(),response=acceptance();
    if(quote){
      const summary=element('section',undefined,'cq-source-summary');
      summary.append(element('h4',quotedOption(quote)));
      if(quote.summary)summary.append(element('p',quote.summary));
      if(quote.customer)summary.append(element('p','Customer: '+quote.customer));
      if(quote.totals)summary.append(details('Original commercial amounts and currency',quote.totals));
      if(quote.unavailableReason)summary.append(element('p',quote.unavailableReason,'cq-warning'));
      container.append(summary);
    }
    if(response){
      container.append(element('p','Customer acceptance recorded '+show(response.observedAt)+' · '+show(response.actor)));
      if(response.reference)container.append(element('p',response.reference));
      container.append(details('Original customer response identity',response));
    }
    container.append(details('Original case and source identity',{caseKey:original.caseKey,case:original.case,source:original.source,reader:original.reader}));
    const actions=element('div',undefined,'cq-actions');
    actions.append(button('Review accepted scope',()=>void review(),{primary:true,disabled:state.busy||!selectedOriginal()||!!state.target?.stale}));
    container.append(actions);
  }
  function renderReview(container){
    const candidate=state.review;if(!candidate)return;
    const selected=candidate.original.selected;
    container.append(element('h3','Accepted scope → Installation'));
    const scope=selected.scope;
    container.append(element('p',scope.summary),element('p','Original commissioning payer: '+show(scope.payer)));
    container.append(details('Agreed commercial terms',scope.terms));
    const changes=candidate.changes;
    container.append(table([{label:'Task',key:'title'},{label:'Change',key:'change'},
      {label:'Previous receiving',key:'previousState'},{label:'Original acceptance criterion',render:row=>row.after?.acceptance||row.before?.acceptance}],
      [...changes.added.map(row=>({...row,change:'Added; open receiving'})),
       ...changes.changed.map(row=>({...row,change:'Changed; new receiving required'})),
       ...changes.unchanged.map(row=>({...row,change:'Unchanged; receiving retained'})),
       ...changes.removed.map(row=>({...row,change:'Removed from this edition; prior edition retained'}))]));
    if(changes.fields.length){container.append(element('h4','Commissioning field changes'),
      table([{label:'Field',key:'field'},{label:'Current draft',render:row=>valueBlock(row.before)},
        {label:'Result',render:row=>valueBlock(row.after)}],changes.fields));}
    if(candidate.conflicts.length){
      container.append(element('h4','Fields edited on both sides'),element('p','Choose which value to retain for each field. The original quotation and customer response remain unchanged.'));
      container.append(table([{label:'Field',key:'key'},{label:'Earlier source',render:row=>valueBlock(row.base)},
        {label:'Current operator value',render:row=>valueBlock(row.current)},{label:'Accepted source value',render:row=>valueBlock(row.accepted)},
        {label:'Keep',render:row=>select([{value:'current',label:'Current operator value'},{value:'accepted',label:'Accepted source value'}],
          state.resolutions[row.key]||row.resolution,value=>setResolution(row.key,value),'Choose')}],candidate.conflicts));
      container.append(button('Review selected choices',()=>void review(),{disabled:state.busy}));
    }
    const actions=element('div',undefined,'cq-actions');
    actions.append(button('Continue in Installation',()=>void continueDraft(),{primary:true,disabled:state.busy||!candidate.canApply||!state.reviewInput||!!services.readOnlyReason?.()}));
    if(selected.quoteText)actions.append(button('Download original customer quotation',()=>downloadText('accepted-customer-quotation.md',selected.quoteText,'text/markdown;charset=utf-8')));
    actions.append(button('Download source review',()=>downloadText('accepted-quotation-installation-review.json',candidate)));
    container.append(actions);
    container.append(details('Complete original accepted quotation',selected.quote),details('Recorded customer acceptance',selected.acceptance),
      details('Prepared complete Installation document',candidate.document));
  }
  function render(){
    if(!active||state.destroyed)return;root.replaceChildren();
    const header=element('header',undefined,'cq-header');
    header.append(element('h2','Accepted customer scope'),element('p','Receive an accepted Merchant Support quotation into the existing Customer Installation. Review later accepted editions against the current operator work.'));
    if(services.close)header.append(button('Return to Installation',()=>services.close()));
    if(services.openSources)header.append(button('Open Sources',()=>services.openSources()));
    root.append(header);
    const reason=services.readOnlyReason?.();if(reason)root.append(element('p',reason,'cq-warning'));
    if(state.error){const error=element('p',state.error,'cq-error');error.setAttribute('role','alert');root.append(error);}
    if(state.notice){const notice=element('p',state.notice,'cq-notice');notice.setAttribute('role','status');root.append(notice);}
    if(state.busy){const busy=element('p','Reading the selected original source…','cq-muted');busy.setAttribute('role','status');root.append(busy);}
    const selection=element('section',undefined,'cq-section');renderSelection(selection);root.append(selection);
    if(state.target?.stale)root.append(element('p','The original editor has an older draft. Its complete contents are retained there. Reconcile that draft before applying a new accepted source.','cq-warning'));
    const result=element('section',undefined,'cq-section');renderReview(result);if(result.childNodes.length)root.append(result);
    if(state.busy)for(const control of root.querySelectorAll('select'))control.disabled=true;
    services.persist?.();
  }
  render();
  if(state.installationId)void loadTarget(state.installationId);
  return {refresh(){updateContext();render();},destroy(){active=false;state.destroyed=true;state.epoch++;root.replaceChildren();}};
}
