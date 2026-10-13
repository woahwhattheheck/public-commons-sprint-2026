import { createForecastCurrencyUI, formatNativeMoney, formatCurrencyValuation } from './forecast_currency.mjs';
import { mountForecastComparison } from './forecast-comparison.mjs';
import { mountForecastWorkbook, validateForecastWorkbookDeskState } from './forecast-workbook-desk.mjs';
import { signature } from './forecast-workbook.mjs';
import { createForecastDraftStore, createForecastWorkbookHost, validateForecastDraftInputs, FORECAST_DRAFT_SCHEMA } from './forecast-workbook-host.mjs';
import { currentStaffContext, staffDeskStorageKey } from './staff-session.mjs';
import {fundingEditor,fundingOpeningEditor,emptyFundingOpening,readFunding,fundingReport,handleFundingReport} from './forecast-customer-funding.mjs';
import {mountForecastCashReview} from './forecast-cash-reconciliation-desk.mjs';
import {validateCashDesk,validateCashReview,applyCashDraft} from './forecast-cash-reconciliation.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = value => value === null || value === undefined ? 'Not entered' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
const today = () => new Date().toISOString().slice(0,10);
const table = (headers, rows) => '<div class="forecast-table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const button = (label, action, attributes='') => '<button type="button" data-forecast-action="'+action+'" '+attributes+'>'+esc(label)+'</button>';
const empty = value => '<p class="forecast-muted">'+esc(value)+'</p>';
function field(label,name,value='',config={}) {
  const attrs=' name="'+esc(name)+'"'+(config.required?' required':'');
  let control;
  if(config.options) control='<select'+attrs+(config.multiple?' multiple size="3"':'')+'>'+config.options.map(([id,title])=>'<option value="'+esc(id)+'"'+((config.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
  else if(config.area) control='<textarea'+attrs+' rows="'+(config.rows||2)+'">'+esc(value)+'</textarea>';
  else control='<input'+attrs+' type="'+(config.type||'text')+'" value="'+esc(value)+'"'+(config.placeholder?' placeholder="'+esc(config.placeholder)+'"':'')+'>';
  return '<label'+(config.wide?' class="forecast-wide"':'')+'>'+esc(label)+control+(config.help?'<small>'+esc(config.help)+'</small>':'')+'</label>';
}
const options=(...items)=>items.map(value=>[value,value.replaceAll('_',' ').toLowerCase()]);
const selectedValues = (root,name) => [...root.querySelector('[name="'+name+'"]').selectedOptions].map(row=>row.value);
const value = (root,name) => root.querySelector('[name="'+name+'"]').value;
const optional = (root,name) => value(root,name).trim() || null;
function download(raw,filename,type='application/json') {
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}

export function mountForecast({container,current,api:transport,mutationId,recordingActor,onSaved,initialForecastId=null,initialInputs=null,onSelection=()=>{}}) {
  const root=document.createElement('section');root.className='operating-forecast';container.replaceChildren(root);
  let active=true,busy=false,hostBusy=false,selected=null,preview=null,editing=true,inputState=null,request=null,comparison=null;
  const blocked=()=>busy||hostBusy||restoring||Boolean(pendingWorkbook)||Boolean(request);
  const available=()=>active&&root.isConnected;
  function requireActive(){if(!available())throw new Error('This forecast view is closed. Reopen its original case to continue.');}
  async function api(...args){requireActive();const result=await transport(...args);requireActive();return result;}
  const path='/api/operations/'+current.program.id;
  const currency=createForecastCurrencyUI({current,field,table,button,usd});
  const sourceOptions=current.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
  const cashOptions=(direction,customer=false)=>current.records.cash.filter(row=>row.state==='OBSERVED'&&row.direction===direction&&row.usdValue!==null&&!row.network.toLowerCase().includes('testnet')&&(customer?row.category==='CUSTOMER':!row.allocations.length)).map(row=>[row.id,row.date+' · '+usd(row.usdValue)+' · '+row.externalRef]);
  const invoiceOptions=current.records.invoices.filter(row=>row.lines.every(line=>line.costId===null)).map(row=>[row.id,row.number+' · '+usd(row.totalUsd)]);
  const costMap=new Map(current.report.packages.map(row=>[row.id,row]));
  const $=selector=>root.querySelector(selector);
  function defaults(){return {name:current.program.name+' — operating forecast',asOfDate:today(),calendarStart:current.program.calendarStart||current.plan.planning.calendarStart||'',
    openingCash:{amountUsd:null,basis:'NOT_ENTERED',sourceIds:[],note:''},packageOverrides:[],invoiceOverrides:[],grantReceipts:[],commercial:[],capacity:{weeklyHours:null,note:''},note:''};}
  function status(message,error=false){if(!available())return;const node=$('[data-forecast-status]');node.textContent=message;node.setAttribute('role',error?'alert':'status');}
  function applyBusy(){if(!available())return;const state=blocked();root.setAttribute('aria-busy',String(busy||hostBusy||restoring));root.querySelectorAll('input,select,textarea,button').forEach(node=>{if(!node.closest('[data-forecast-workbook],[data-forecast-cash-review]'))node.disabled=(recoveryAction(node)?busy||hostBusy||restoring:state)||node.dataset.forecastFixed==='true';});for(const [action,visible] of [['recover-source',!!pendingWorkbook],['recover-save',!!request]]){const control=$('[data-forecast-action='+action+']');if(control)control.hidden=!visible;}comparison?.setHostBusy();workbook?.setHostBusy();cashDesk?.setHostBusy();}
  function setBusy(state){busy=state;applyBusy();}
  function setHostBusy(state){hostBusy=!!state;applyBusy();}
  async function run(task,{recovery=false}={}){if((recovery?busy||hostBusy||restoring:blocked())||!available())return;setBusy(true);try{await task();}catch(error){status(error.message,true);}finally{if(available()){setBusy(false);persistSoon();}}}
  function invalidate(){if(pendingWorkbook||request)return;preview=null;const save=$('[data-forecast-action=save]');if(save){save.disabled=true;save.dataset.forecastFixed='true';}const note=$('[data-forecast-preview-state]');if(note)note.textContent='Inputs changed. Preview this source and these inputs before saving.';}

  const clone=value=>structuredClone(value);
  const pinnedContext=currentStaffContext();
  const draftStore=createForecastDraftStore(staffDeskStorageKey('sf47.forecast-working.'+current.program.id,pinnedContext));
  let workbook=null,workbookState=null,pendingWorkbook=null,workbookHistory={},restoring=true,storeError='';
  let cashDesk=null,cashState=null,renderedFunding=null;
  const fundingOptions=()=>({field,sourceOptions,cashOptions:cashOptions('IN',true)});
  let previousWorking=null,restoreNotice='',rawFields={};
  const recoveryAction=node=>['download-working','recover-source','recover-save'].includes(node.dataset.forecastAction);
  function workbookOptions(){return {caseId:current.program.id,originCaseId:current.program.origin?.programId,
    planContentSha256:current.plan.contentSha256};}
  function currentInputs(){if(request)return clone(request.data.inputs);return editing&&$('[data-forecast-form]')?readEditor():clone(inputState||selected?.inputs||defaults());}
  function rawKey(node){
    const form=$('[data-forecast-form]'),parts=[];
    for(const attr of ['data-forecast-commercial','data-forecast-package','data-forecast-invoice','data-forecast-grant',
      'data-native-price-credit','data-native-cost-credit','data-forecast-funding']){
      const scope=node.closest('['+attr+']');if(scope)parts.push(attr,scope.getAttribute(attr));
    }
    for(const attr of ['data-forecast-fx','data-forecast-receipt']){
      const scope=node.closest('['+attr+']');
      if(scope){const parent=attr==='data-forecast-receipt'?scope.closest('[data-forecast-commercial]'):form;
        parts.push(attr,[...parent.querySelectorAll('['+attr+']')].indexOf(scope));}
    }
    parts.push(node.name);return JSON.stringify(parts);
  }
  function captureRaw(){
    const form=$('[data-forecast-form]');if(!form)return clone(rawFields);
    for(const node of form.querySelectorAll('input[name],select[name],textarea[name]')){
      if(node.type==='file')continue;
      rawFields[rawKey(node)]={value:node.value,checked:!!node.checked,
        ...(node.multiple?{values:[...node.selectedOptions].map(option=>option.value)}:{})};
    }
    return clone(rawFields);
  }
  function restoreRaw(){
    const form=$('[data-forecast-form]');if(!form)return;
    const apply=()=>{for(const node of form.querySelectorAll('input[name],select[name],textarea[name]')){
      if(node.type==='file')continue;const row=rawFields[rawKey(node)];if(!row)continue;
      if(node.multiple){for(const option of node.options)option.selected=(row.values||[]).includes(option.value);}
      else node.value=row.value;
      if(node.type==='checkbox'||node.type==='radio')node.checked=row.checked;
    }};
    apply();root.querySelectorAll('[data-forecast-commercial]').forEach(syncCommercialTiming);
    currency.syncRates(form,{busy:blocked()});apply();
  }
  function validateRaw(value){
    if(value===undefined)return {};
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>20000)
      throw new Error('Retain the complete original forecast form fields.');
    for(const [key,row] of Object.entries(value)){
      let parts;try{parts=JSON.parse(key);}catch{throw new Error('The original forecast field identity is invalid.');}
      if(!Array.isArray(parts)||parts.length>20||parts.some(part=>typeof part!=='string'&&!Number.isSafeInteger(part))||
        !row||typeof row.value!=='string'||row.value.length>100000||typeof row.checked!=='boolean'||
        row.values!==undefined&&(!Array.isArray(row.values)||row.values.length>1000||row.values.some(v=>typeof v!=='string')))
        throw new Error('Retain the original forecast field text and selections.');
    }
    return clone(value);
  }
  function retentionInputs(){return request?clone(request.data.inputs):editing&&$('[data-forecast-form]')?readEditor({forRecovery:true}):clone(inputState||selected?.inputs||defaults());}
  function snapshot(){
    return {schema:FORECAST_DRAFT_SCHEMA,caseId:current.program.id,originCaseId:current.program.origin?.programId||null,
      planContentSha256:current.plan.contentSha256,savedAt:new Date().toISOString(),editing,selectedId:selected?.id||null,
      inputs:retentionInputs(),rawFields:captureRaw(),workbook:workbook?.snapshot()||clone(workbookState),pendingWorkbook:clone(pendingWorkbook),
      workbookHistory:clone(workbookHistory),saveRequest:clone(request),previousWorking:clone(previousWorking),
      ...(cashDesk||cashState?{cashReview:cashDesk?.snapshot()||clone(cashState)}:{})};
  }
  async function persist(){
    if(editing&&$('[data-forecast-form]'))inputState=retentionInputs();
    const value=snapshot();
    try{await draftStore.write(value);storeError='';}
    catch(error){storeError=error.message;status('The complete working forecast remains open. Download the working file before leaving. '+error.message,true);throw error;}
  }
  function persistSoon(){if(restoring||!available())return;void persist().catch(()=>{});}
  function validateWorking(value){
    if(!value||value.schema!==FORECAST_DRAFT_SCHEMA||value.caseId!==current.program.id||
      (value.originCaseId||null)!==(current.program.origin?.programId||null)||
      value.planContentSha256!==current.plan.contentSha256||typeof value.editing!=='boolean'||
      !value.inputs||typeof value.inputs!=='object'||Array.isArray(value.inputs)||
      value.selectedId!==null&&!/^forecast-[a-f0-9]{32}$/.test(value.selectedId))
      throw new Error('Open the complete working forecast in its original retained case and pinned plan.');
    validateForecastDraftInputs(value.inputs);
    if(Object.hasOwn(value,'cashReview'))validateCashDesk(value.cashReview,{caseId:current.program.id});
    if(!value.workbookHistory||typeof value.workbookHistory!=='object'||Array.isArray(value.workbookHistory))throw new Error('Retain the original workbook operation history.');
    if(value.previousWorking!==null&&value.previousWorking!==undefined){if(value.previousWorking.previousWorking)throw new Error('Retain one complete previous working edition.');validateWorking(value.previousWorking);}
    if(value.saveRequest){
      const r=value.saveRequest;
      if(r.action!=='forecast.save'||!Number.isSafeInteger(r.expectedVersion)||r.expectedVersion<1||
        typeof r.actor!=='string'||!r.actor.trim()||typeof r.requestId!=='string'||!r.requestId||
        typeof r.note!=='string'||!/^[a-f0-9]{64}$/.test(r.data?.expectedPreviewSha256)||
        signature(r.data.inputs)!==signature(value.inputs))
        throw new Error('Retain the complete original forecast save request and its exact inputs.');
    }
    if(value.pendingWorkbook&&value.saveRequest)throw new Error('Recover one original forecast request at a time.');
    return {...clone(value),rawFields:validateRaw(value.rawFields)};
  }
  function updateCase(next){
    if(next?.program?.id!==current.program.id||next.plan?.contentSha256!==current.plan.contentSha256)
      throw new Error('The workbook continuation returned another case or pinned plan.');
    Object.assign(current,next);currency.refreshCurrent();costMap.clear();for(const row of current.report.packages)costMap.set(row.id,row);
    sourceOptions.splice(0,sourceOptions.length,...current.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]));
  }
  const workbookHost=createForecastWorkbookHost({
    getCurrent:()=>current,getInputs:currentInputs,api,mutationId,recordingActor,available,
    getJournal:()=>pendingWorkbook,
    setJournal:(value,history)=>{pendingWorkbook=value;if(history)Object.assign(workbookHistory,history);},
    persist,onCase:updateCase,
    adopt:async result=>{
      inputState=clone(result.inputs);rawFields={};selected=null;editing=true;preview=result.preview;request=null;onSelection(null);
      const holder=$('[data-forecast-editor]');if(holder)holder.innerHTML=editor(inputState);
      root.querySelectorAll('[data-forecast-commercial]').forEach(syncCommercialTiming);
      const form=$('[data-forecast-form]');if(form)currency.syncRates(form,{busy:blocked()});
      const report=$('[data-forecast-report]');if(report)report.innerHTML=reportHtml(preview,true);
    }
  });
  async function sendSavedForecast(){
    if(!request)throw new Error('There is no retained forecast save request.');
    await persist();applyBusy();
    const original=request;let result;
    try{result=await api(path+'/command',clone(original));}
    catch(error){
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&![401,403,408,425,429].includes(error.status)){
        workbookHistory.failedSave={request:clone(original),status:error.status,code:error.code||'',message:error.message};
        request=null;preview=null;await persist();
        const next=await api(path);updateCase(next);render();
      }
      throw error;
    }
    if(!/^forecast-[a-f0-9]{32}$/.test(result?.recordId))
      throw new Error('The forecast reply has no original saved identity. Continue the same retained save request.');
    request=null;selected={id:result.recordId};editing=false;await persist();
    onSelection(result.recordId);await onSaved(result);
  }
  async function applyWorkbook(selection){
    if(busy||hostBusy||request)throw new Error('Finish the current forecast operation before applying this workbook.');
    setBusy(true);
    try{
      const result=await workbookHost.apply(selection);
      status(result.adopted?'Retained the original workbook and previewed its reviewed assumptions. Save this forecast to keep the resulting edition.':result.message);
      return result;
    }finally{if(available())setBusy(false);}
  }
  async function receiveCashSources(state){
    if(!state)return;
    const all=[state.review,...(state.history||[]).map(x=>x.review),...(state.retainedReviews||[]).map(x=>x.review)].filter(Boolean),saved=new Map;
    for(const review of all){if(!saved.has(review.baseline.id))saved.set(review.baseline.id,await api(path+'/forecasts/'+review.baseline.id));validateCashReview(review,{caseId:current.program.id,originalSaved:saved.get(review.baseline.id)});}
  }
  async function applyCashReview(selection){
    if(blocked()||!editing)throw new Error('Open an editable Forecast and finish its original request before applying cash decisions.');
    const original=retentionInputs();
    if(signature(original)!==selection.beforeSignature)return {adopted:false,message:'The Forecast changed after review. Reconcile the current complete inputs again.'};
    const verified=applyCashDraft(original,selection.current,selection.entry.review,selection.entry.decisions,{choices:selection.entry.choices,expectedSignature:selection.beforeSignature});
    if(signature(verified)!==signature(selection.inputs))throw new Error('The complete cash proposal differs from its original review.');
    setBusy(true);try{
    previousWorking=snapshot();delete previousWorking.previousWorking;
    // Preserve all unrelated raw controls. Only exact changed native field values get new controls.
    const captured=captureRaw();
    function rowKey(v,key,id){return v?.find(x=>x[key]===id);}
    function atField(inputs,key){
      const p=JSON.parse(key),name=p[p.length-1];let row=inputs;
      for(const [attr,section,idKey] of [['data-forecast-package','packageOverrides','costId'],['data-forecast-commercial','commercial','id'],['data-forecast-invoice','invoiceOverrides','invoiceId'],['data-forecast-grant','grantReceipts','tranche']]){
        const index=p.indexOf(attr);if(index>=0){row=rowKey(inputs[section],idKey,idKey==='tranche'?Number(p[index+1]):p[index+1]);break;}}
      const receipt=p.indexOf('data-forecast-receipt');if(receipt>=0)row=row?.receipts?.[p[receipt+1]];
      return row&&Object.hasOwn(row,name)?{exists:true,value:row[name]}:{exists:false,value:null};
    }
    for(const key of Object.keys(captured)){if(signature(atField(original,key))!==signature(atField(verified,key)))delete captured[key];}
    updateCase(selection.current);inputState=clone(verified);rawFields=captured;selected=null;editing=true;preview=null;request=null;onSelection(null);
    cashState=clone(selection.desk);cashDesk?.dispose();cashDesk=null;render();
    await persist();
    try{await doPreview();await persist();return {adopted:true,preview};}
    catch(error){status('Reviewed cash inputs remain in the current draft. Complete the original native validation before saving: '+error.message,true);return {adopted:true,preview:null,message:error.message};}
    }finally{if(available())setBusy(false);}
  }
  async function receiveWorking(value,{fromFile=false}={}){
    const next=validateWorking(value);
    const recoverySignature=()=>{const state=snapshot();delete state.savedAt;return signature(state);};
    const originalSignature=recoverySignature();
    const checkCurrent=()=>{requireActive();if(recoverySignature()!==originalSignature)throw new Error('The current Forecast changed while the received cash sources were being checked. Both working files remain intact.');};
    await receiveCashSources(next.cashReview);checkCurrent();
    if(next.pendingWorkbook)next.pendingWorkbook=await workbookHost.validateJournal(next.pendingWorkbook);
    if(next.workbook)next.workbook=await validateForecastWorkbookDeskState(next.workbook,{...workbookOptions(),currentInputs:next.inputs});
    checkCurrent();
    let receivedSelection=null;
    if(next.selectedId&&!next.editing){
      receivedSelection=await api(path+'/forecasts/'+next.selectedId);
      checkCurrent();
      if(receivedSelection?.id!==next.selectedId||!receivedSelection.report||
        !/^[a-f0-9]{64}$/.test(receivedSelection.sha256||'')||
        signature(receivedSelection.inputs)!==signature(next.inputs))
        throw new Error('The received working file differs from its original saved Forecast. Current work remains intact.');
    }
    if(fromFile){previousWorking=snapshot();delete previousWorking.previousWorking;}
    workbook?.dispose();workbook=null;
    inputState=clone(next.inputs);rawFields=clone(next.rawFields);selected=null;editing=next.editing;preview=null;request=clone(next.saveRequest);
    pendingWorkbook=clone(next.pendingWorkbook);workbookState=clone(next.workbook);workbookHistory=clone(next.workbookHistory||{});
    cashDesk?.dispose();cashDesk=null;cashState=next.cashReview?clone(next.cashReview):null;
    if(!fromFile)previousWorking=clone(next.previousWorking||null);
    selected=receivedSelection;
    requireActive();onSelection(selected?.id||null);render();restoreRaw();
    if(workbook)await workbook.ready;
    requireActive();await persist();
    status(pendingWorkbook?'Reopened the complete workbook and retained source request. Continue the original source request.':
      request?'Reopened the exact pending forecast save. Continue the original save request.':
      'Reopened the complete forecast inputs, returned workbook and original review.');
  }

  function packageEditor(row){
    const prior=costMap.get(row.costId), direct=cashOptions('OUT');
    return '<fieldset data-forecast-package="'+esc(row.costId)+'"><legend>'+esc(row.costId)+'</legend><p class="forecast-muted">Pinned '+usd(prior.plannedUsd)+' · invoices '+usd(prior.invoicedUsd)+' · paid allocations '+usd(prior.paidUsd)+' · accepted '+esc(prior.acceptedHours)+' / '+esc(prior.plannedHours)+' hours.</p><div class="forecast-fields">'
      +field('Remaining uninvoiced cash (USD)','remainingCostUsd',row.remainingCostUsd,{placeholder:'Calculate from original allocation',help:'Blank keeps the allocation less original invoices and assigned direct payments. Re-estimate completed but unbilled obligations as needed.'})
      +field('Remaining work hours','remainingHours',row.remainingHours,{placeholder:'Pinned hours less accepted work'})
      +field('Work starts','startDate',row.startDate,{type:'date'})+field('Work finishes','endDate',row.endDate,{type:'date'})
      +field('Cash schedule','paymentMode',row.paymentMode||'original',{options:[['original','Original payment schedule'],['accrual','Evenly over remaining dates'],['completion','At remaining work completion']]})
      +field('Actual direct payments assigned to this package','directCashIds',row.directCashIds||[],{options:direct,multiple:true})
      +field('Reason / source for changed estimates or dates','note',row.note||'',{area:true,wide:true})+'</div></fieldset>';
  }
  function invoiceEditor(row){
    const original=current.report.invoices.find(x=>x.id===row.invoiceId);
    return '<tr data-forecast-invoice="'+esc(row.invoiceId)+'"><td>'+esc(original.number)+'<small>'+esc(original.state)+' · source due '+esc(original.dueDate||'undated')+'</small></td><td>'+usd(original.totalUsd)+'</td><td>'+usd(original.paidUsd)+'</td><td>'+usd(original.openUsd)+'</td><td><input aria-label="Expected payment for '+esc(original.number)+'" name="dueDate" type="date" value="'+esc(row.dueDate||'')+'"></td><td><label class="forecast-check"><input name="include" type="checkbox"'+(row.include===false?'':' checked')+'>Include</label></td><td><input aria-label="Timing or exclusion reason for '+esc(original.number)+'" name="note" value="'+esc(row.note||'')+'"></td></tr>';
  }
  function receiptEditor(row,index,native=false){
    return '<tr data-forecast-receipt><td><input name="receiptId" aria-label="Receipt identity" value="'+esc(row.id||'milestone-'+(index+1))+'" required></td><td><input name="receiptLabel" aria-label="Receipt label" value="'+esc(row.label||'')+'" required></td><td>'+currency.receiptFields(row,native)+'</td><td><input name="receiptDate" aria-label="Forecast collection date" type="date" value="'+esc(row.date||'')+'"></td><td data-forecast-timing-only><input name="receiptCondition" aria-label="Original relative collection term" value="'+esc(row.condition||'')+'" placeholder="Before work, or days after accepted handover"></td><td>'+button('Remove','remove-receipt')+'</td></tr>';
  }
  function commercialEditor(row){
    const timed=row.timing?.mode==='EVENT_DEPENDENT', conditions=new Map((row.timing?.receiptConditions||[]).map(item=>[item.receiptId,item.condition]));
    return '<fieldset data-forecast-commercial="'+esc(row.id)+'"><legend>'+esc(row.title||'Customer delivery scenario')+'</legend><div class="forecast-actions">'+button('Remove project','remove-commercial')+'</div><div class="forecast-fields">'
      +field('Project name','title',row.title,{required:true})+field('Original case / offer identity','caseRef',row.caseRef,{required:true})
      +field('Original commercial stage','stage',row.stage||'QUOTED',{options:[['QUOTED','Quoted offer'],['AGREED','Agreed scope'],['IN_PROGRESS','Implementation in progress']]})
      +'<label class="forecast-check"><input name="selected" type="checkbox"'+(row.selected===false?'':' checked')+'>Include this customer delivery scenario</label>'
      +currency.pricingEditor(row,inputState?.fxRates||[])
      +field('Remaining customer-specific hours','remainingHours',row.remainingHours,{required:true})
      +field('Work timing','timingMode',timed?'EVENT_DEPENDENT':'DATED',{options:[['DATED','Dated work window'],['EVENT_DEPENDENT','After an original deposit or other event']]})
      +field('Delivery starts','startDate',row.startDate,{type:'date',required:!timed})+field('Delivery finishes','endDate',row.endDate,{type:'date',required:!timed})
      +'<div data-forecast-timing-only class="forecast-wide"><div class="forecast-fields">'
      +field('Original condition before work can start','timingStartCondition',row.timing?.startCondition||'',{area:true,wide:true,help:'Retain the original deposit, agreed inputs and named review prerequisites. Leave both work dates empty until its reviewed window is known.'})
      +field('Original reviewed trigger date','timingReviewedReleaseDate',row.timing?.reviewedReleaseDate||'',{type:'date',help:'Leave empty while prerequisites are unresolved. Once reviewed, this original date anchors the promised deadline even when resource availability delays work.'})
      +field('Quoted delivery window (business days)','timingDeliveryBusinessDays',row.timing?.deliveryBusinessDays??1,{type:'number',help:'The original Portfolio derives the delivery deadline from the reviewed release date and selected working calendar.'})+'</div></div>'
      +field('Cost timing','paymentMode',row.paymentMode||'accrual',{options:[['accrual','Evenly over delivery dates'],['completion','At delivery completion']]})
      +field('Original offer URL','sourceUrl',row.sourceUrl,{type:'url',wide:true})
      +field('Retained source attachments','sourceIds',row.sourceIds||[],{options:sourceOptions,multiple:true,wide:true})
      +field('Actual collected customer receipts','cashIds',row.cashIds||[],{options:cashOptions('IN',true),multiple:true,help:'Only the selected original observed receipts reduce this price. They remain unchanged.'})
      +field('Original customer-specific invoices','invoiceIds',row.invoiceIds||[],{options:invoiceOptions,multiple:true,help:'Each unplanned invoice may belong to one customer scenario.'})
      +field('Actual direct payments','directCashIds',row.directCashIds||[],{options:cashOptions('OUT'),multiple:true})
      +field('Scope, prerequisites and acceptance','scope',row.scope||'',{area:true,wide:true})
      +field('Source of cost, remaining hours and forecast dates','note',row.note||'',{area:true,required:true,wide:true})
      +'</div>'+currency.creditEditor(row)+'<h5>Original payment milestones and forecast collection dates</h5><p class="forecast-muted">Amounts must sum to the original price. Leave a collection date empty until a date can be forecast. Observed receipts reduce the listed milestones in their original order.</p>'
      +'<div class="forecast-table"><table><thead><tr><th>Identity</th><th>Milestone</th><th data-forecast-receipt-amount-heading>Quoted USD</th><th>Forecast collection</th><th data-forecast-timing-only>Original relative collection term</th><th>Action</th></tr></thead><tbody data-forecast-receipts>'+row.receipts.map((receipt,index)=>receiptEditor({...receipt,condition:conditions.get(receipt.id)||''},index,!!row.nativePricing)).join('')+'</tbody></table></div>'+button('Add receipt milestone','add-receipt')+'</fieldset>';
  }
  function syncCommercialTiming(row){
    const timed=value(row,'timingMode')==='EVENT_DEPENDENT';
    for(const node of row.querySelectorAll('[data-forecast-timing-only]'))node.hidden=!timed;
    for(const name of ['startDate','endDate'])row.querySelector('[name="'+name+'"]').required=!timed;
    for(const node of row.querySelectorAll('[name=timingStartCondition],[name=timingDeliveryBusinessDays],[name=receiptCondition]')){
      node.required=timed;node.disabled=blocked()||!timed;node.dataset.forecastFixed=String(!timed);
    }
    const trigger=row.querySelector('[name=timingReviewedReleaseDate]');trigger.disabled=blocked()||!timed;trigger.dataset.forecastFixed=String(!timed);
  }
  function editor(inputs){
    const packages=new Map(inputs.packageOverrides.map(row=>[row.costId,row]));
    const invoices=new Map(inputs.invoiceOverrides.map(row=>[row.invoiceId,row]));
    const grants=new Map(inputs.grantReceipts.map(row=>[row.tranche,row]));
    return '<form data-forecast-form><div class="forecast-fields">'
      +field('Forecast name','name',inputs.name,{required:true,wide:true})
      +field('As-of date','asOfDate',inputs.asOfDate,{type:'date',required:true,help:'Actual cash and completed work through this date. Forward cash begins the next day.'})
      +field('Explicit plan day-zero date','calendarStart',inputs.calendarStart,{type:'date',required:true,help:'A schedule assumption or actual anchor; selecting it does not record an award.'})
      +field('Available cash at end of as-of date (USD)','openingAmount',inputs.openingCash.amountUsd,{help:'Optional. The original plan’s capital input and net recorded flows are not substituted for a balance.'})
      +field('Opening balance basis','openingBasis',inputs.openingCash.basis,{options:[['NOT_ENTERED','No balance entered'],['OBSERVED_BALANCE','Observed balance'],['PLANNING_ASSUMPTION','Planning assumption']]})
      +field('Opening balance source / assumption','openingNote',inputs.openingCash.note,{area:true,wide:true})
      +field('Opening balance source attachments','openingSources',inputs.openingCash.sourceIds,{options:sourceOptions,multiple:true,wide:true})
      +field('Available weekly team hours','weeklyHours',inputs.capacity.weeklyHours,{help:'Blank uses the pinned contributor capacities when available. This is a shared capacity comparison across selected work.'})
      +field('Capacity source / assumption','capacityNote',inputs.capacity.note,{area:true})
      +field('Forecast decisions and assumptions','forecastNote',inputs.note,{area:true,wide:true})
      +'</div><details open><summary>Remaining grant packages</summary><p>Existing invoices remain separate obligations. Package cash defaults subtract their full recorded amounts; the invoice section then includes only unpaid balances. Accepted work reduces remaining hours.</p>'
      +current.plan.scenario.future_costs.map(row=>packageEditor(packages.get(row.id)||{costId:row.id})).join('')+'</details>'
      +'<details><summary>Unpaid invoices and expected payment dates</summary><p>Overdue or undated balances move to the next day until a new date is entered. Every exclusion needs a reason.</p>'
      +(current.report.invoices.length?'<div class="forecast-table"><table><thead><tr><th>Original invoice</th><th>Total</th><th>Paid</th><th>Open</th><th>Expected payment</th><th>Include</th><th>Reason</th></tr></thead><tbody>'+current.report.invoices.map(row=>invoiceEditor(invoices.get(row.id)||{invoiceId:row.id})).join('')+'</tbody></table></div>':empty('No invoice records in this case.'))+'</details>'
      +'<details><summary>Conditional grant receipt dates</summary><p>A past-due unreceived payout stays outside the cash curve until a new date is entered. Original observed grant receipts reduce their own tranches.</p><div class="forecast-table"><table><thead><tr><th>Tranche</th><th>Conditional total</th><th>Observed</th><th>New forecast receipt</th><th>Include</th><th>Reason</th></tr></thead><tbody>'
      +current.report.tranches.map(row=>{const input=grants.get(row.tranche)||{};return '<tr data-forecast-grant="'+row.tranche+'"><td>'+row.tranche+' · original day '+row.hypotheticalPaidDay+'</td><td>'+usd(row.conditionalPlannedUsd)+'</td><td>'+usd(row.observedGrantUsd)+'</td><td><input name="date" aria-label="Tranche '+row.tranche+' forecast date" type="date" value="'+esc(input.date||'')+'"></td><td><label class="forecast-check"><input name="include" type="checkbox"'+(input.include===false?'':' checked')+'>Include</label></td><td><input name="note" aria-label="Tranche '+row.tranche+' timing source" value="'+esc(input.note||'')+'"></td></tr>';}).join('')+'</tbody></table></div></details>'
      +currency.ratesEditor(inputs)
      +'<details open><summary>Customer delivery scenarios</summary><p>Each project carries the original quote, collection schedule and delivery cost. Add only the customer-specific remaining scope.</p><div data-forecast-commercials>'+inputs.commercial.map(commercialEditor).join('')+'</div>'+button('Add customer project','add-commercial')+'</details>'+fundingEditor(inputs,fundingOptions())
      +'<div class="forecast-actions"><button type="submit">Preview current forecast</button>'+button('Load input JSON','load-inputs')+button('Download input JSON','download-inputs')+'</div><input hidden data-forecast-input-file type="file" accept=".json,application/json"></form>';
  }
  function readEditor({forRecovery=false}={}){
    const form=$('[data-forecast-form]');if(!form)throw new Error('Choose Reforecast current case to edit assumptions.');
    const explicitGrants=new Set(inputState.grantReceipts.map(row=>Number(row.tranche)));
    const inputs={name:value(form,'name'),asOfDate:value(form,'asOfDate'),calendarStart:value(form,'calendarStart'),
      openingCash:{amountUsd:optional(form,'openingAmount'),basis:value(form,'openingBasis'),sourceIds:selectedValues(form,'openingSources'),note:value(form,'openingNote')},
      capacity:{weeklyHours:optional(form,'weeklyHours'),note:value(form,'capacityNote')},note:value(form,'forecastNote'),
      packageOverrides:[...form.querySelectorAll('[data-forecast-package]')].map(row=>({costId:row.dataset.forecastPackage,
        remainingCostUsd:optional(row,'remainingCostUsd'),remainingHours:optional(row,'remainingHours'),
        startDate:optional(row,'startDate'),endDate:optional(row,'endDate'),paymentMode:value(row,'paymentMode'),directCashIds:selectedValues(row,'directCashIds'),note:value(row,'note')})),
      invoiceOverrides:[...form.querySelectorAll('[data-forecast-invoice]')].map(row=>({invoiceId:row.dataset.forecastInvoice,dueDate:optional(row,'dueDate'),include:row.querySelector('[name=include]').checked,note:value(row,'note')})),
      grantReceipts:[...form.querySelectorAll('[data-forecast-grant]')].map(row=>({tranche:Number(row.dataset.forecastGrant),date:optional(row,'date'),include:row.querySelector('[name=include]').checked,note:value(row,'note')})).filter(row=>explicitGrants.has(row.tranche)||row.date!==null||row.include===false||row.note!==''),
      commercial:[...form.querySelectorAll('[data-forecast-commercial]')].map(row=>({id:row.dataset.forecastCommercial,title:value(row,'title'),
        caseRef:value(row,'caseRef'),stage:value(row,'stage'),selected:row.querySelector('[name=selected]').checked,
        ...currency.readPricing(row,{forRecovery}),remainingHours:value(row,'remainingHours'),
        startDate:optional(row,'startDate'),endDate:optional(row,'endDate'),paymentMode:value(row,'paymentMode'),
        ...(value(row,'timingMode')==='EVENT_DEPENDENT'?{timing:{mode:'EVENT_DEPENDENT',
          startCondition:value(row,'timingStartCondition'),reviewedReleaseDate:optional(row,'timingReviewedReleaseDate'),deliveryBusinessDays:Number(value(row,'timingDeliveryBusinessDays')),
          receiptConditions:[...row.querySelectorAll('[data-forecast-receipt]')].map(receipt=>({receiptId:value(receipt,'receiptId'),condition:value(receipt,'receiptCondition')}))}}:{}),
        sourceUrl:value(row,'sourceUrl'),sourceIds:selectedValues(row,'sourceIds'),cashIds:selectedValues(row,'cashIds'),
        invoiceIds:selectedValues(row,'invoiceIds'),directCashIds:selectedValues(row,'directCashIds'),scope:value(row,'scope'),note:value(row,'note'),
        receipts:[...row.querySelectorAll('[data-forecast-receipt]')].map(receipt=>({id:value(receipt,'receiptId'),label:value(receipt,'receiptLabel'),...currency.readReceiptAmount(row,receipt),date:optional(receipt,'receiptDate')}))}))};
    const funding=readFunding(form);if(funding!==undefined)inputs.customerFunding=funding;
    const rates=currency.readRates(form);
    if(rates.length||Object.hasOwn(inputState,'fxRates')||form.dataset.forecastFxTouched==='true')inputs.fxRates=rates;
    return inputs;
  }
  function chart(report){
    const partial=report.currencyValuation?.datedCashComplete===false;
    const series=[['spendingOnly','Existing obligations and grant work',''],['conditionalGrant','With conditional grants','8 4'],[partial?'knownCommercial':'commercial',partial?'Valued portion of selected customer work':'With selected customer work','2 4']];
    const key=report.openingCash.amountUsd===null?'DeltaUsd':'BalanceUsd';
    const numeric=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
    const amounts=report.days.flatMap(day=>series.map(([id])=>numeric(day[id+key]))).filter(value=>value!==null);
    if(!report.days.length||!amounts.length)return empty('No valued dated cash points are available.');
    const low=Math.min(0,...amounts),high=Math.max(1,...amounts),span=high-low||1,w=900,h=260,x0=90,y0=20,plotW=790,plotH=190;
    const x=i=>x0+i*plotW/Math.max(report.days.length-1,1),y=n=>y0+(high-n)/span*plotH;
    const lines=series.map(([id,label,dash],index)=>{
      const segments=[];let segment=[];
      report.days.forEach((day,i)=>{const amount=numeric(day[id+key]);if(amount===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(x(i).toFixed(2)+','+y(amount).toFixed(2));});
      if(segment.length)segments.push(segment);
      return segments.map(points=>'<polyline fill="none" stroke="'+['#151515','#555','#888'][index]+'" stroke-width="2.5" stroke-dasharray="'+dash+'" points="'+points.join(' ')+'"><title>'+esc(label)+'</title></polyline>').join('');
    }).join('');
    return '<figure class="forecast-chart"><figcaption>'+esc(key==='DeltaUsd'?'Cumulative forward cash change (opening cash not entered)':'Forecast available cash including entered opening balance')+'</figcaption>'
      +(partial?'<p class="forecast-valuation-warning">The customer curve shows only its valued portion. Unvalued native amounts and missing credit allocations remain outside this subtotal; the full customer scenario is unresolved.</p>':'')
      +'<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(partial?'Dated forecast with a partial valued customer scenario':'Dated forecast cash scenarios')+'"><line x1="'+x0+'" y1="'+y(0)+'" x2="'+(x0+plotW)+'" y2="'+y(0)+'" stroke="#888"/>'
      +[high,(high+low)/2,low].map(amount=>'<text x="80" y="'+(y(amount)+4)+'" text-anchor="end">'+esc(usd(amount))+'</text>').join('')+lines
      +'<text x="'+x0+'" y="240">'+esc(report.days[0]?.date||'')+'</text><text x="'+(x0+plotW)+'" y="240" text-anchor="end">'+esc(report.lastForecastDate)+'</text></svg>'
      +'<div class="forecast-legend">'+series.map(([id,label],index)=>'<span><i class="forecast-line line-'+index+'"></i>'+esc(label)+'</span>').join('')+'</div></figure>';
  }
  function eventTimingHtml(report){
    const timing=report.eventTiming;if(!timing)return '';
    const amount=value=>report.currencyValuation?formatCurrencyValuation(value):usd(value);
    const knownUndated=(label,value,known)=>value===null&&known!==undefined?'<p class="forecast-valuation-warning">'+esc(label)+': '+esc(usd(known))+' known portion; unvalued original amounts remain unresolved.</p>':'';
    return '<section class="forecast-note"><h5>Event-dependent work and collections</h5><p>'+esc(timing.undatedHours)+' selected work hours await work dates. Undated delivery cost valuation: '+esc(amount(timing.undatedDeliveryCostUsd))+'. Undated quoted collection valuation: '+esc(amount(timing.undatedCustomerReceiptsUsd))+'. The cash and capacity curves cover entered dates; original terms remain below.</p>'
      +knownUndated('Undated delivery costs',timing.undatedDeliveryCostUsd,timing.knownUndatedDeliveryCostUsd)+knownUndated('Undated quoted collections',timing.undatedCustomerReceiptsUsd,timing.knownUndatedCustomerReceiptsUsd)
      +table(['Project','Original start condition','Original reviewed trigger','Delivery working days','Work window','Original collection terms'],timing.projects.map(row=>{
        const original=report.commercial.find(project=>project.id===row.id);
        return [
          esc(row.title)+(row.selected?'':'<small>Excluded from this scenario</small>'),esc(row.startCondition),esc(row.reviewedReleaseDate||'Awaiting original event'),esc(row.deliveryBusinessDays),
          row.startDate?esc(row.startDate)+' — '+esc(row.endDate):'Awaiting reviewed dates',
          row.receipts.map(receipt=>{
            const originalReceipt=original?.receipts?.find(item=>item.id===receipt.id);
            const nativeAmount=receipt.amountNative??originalReceipt?.amountNative;
            const quote=nativeAmount!==undefined?formatNativeMoney(nativeAmount,original?.nativePricing?.price?.currency||original?.currencyValuation?.price?.currency):amount(receipt.amountUsd);
            return esc(receipt.label)+' · '+esc(quote)+(nativeAmount!==undefined?'<small>USD valuation: '+esc(formatCurrencyValuation(receipt.amountUsd??originalReceipt?.amountUsd))+'</small>':'')+' · '+esc(receipt.condition)+'<small>'+(receipt.date?esc(receipt.date):'Collection date not entered')+'</small>';
          }).join('<br>')
        ];
      }))+'<p>'+esc(timing.basis)+'</p></section>';
  }
  function reportHtml(result,isPreview=false){
    const r=result.report,hasCurrency=!!r.currencyValuation;renderedFunding=r.customerFunding||null;
    const valued=value=>hasCurrency?formatCurrencyValuation(value):usd(value);
    const total=(value,known)=>'<strong>'+esc(valued(value))+'</strong>'+((value===null||value===undefined)&&known!==null&&known!==undefined?'<small>Known portion: '+esc(usd(known))+'</small>':'');
    const scenarioRows=[];
    for(const [id,label] of [['spendingOnly','Existing obligations and grant work'],['conditionalGrant','With conditional grant receipts'],['commercial','With selected customer delivery']]){
      const row=r.scenarios[id],partial=id==='commercial'&&row.valuationComplete===false;
      scenarioRows.push([esc(label)+(partial?'<small class="forecast-unvalued">Dated cash valuation incomplete</small>':''),esc(partial?formatCurrencyValuation(row.additionalCashNeededUsd):usd(row.additionalCashNeededUsd)),esc(partial?formatCurrencyValuation(row.gapAfterOpeningCashUsd):usd(row.gapAfterOpeningCashUsd)),esc(row.peakNeedDate||(partial?'Unvalued':'')),esc(partial?formatCurrencyValuation(row.endBalanceUsd):usd(row.endBalanceUsd))]);
      if(partial&&row.valuedPortion){
        const known=row.valuedPortion;
        scenarioRows.push(['<strong>Valued portion of selected customer delivery</strong><small>Partial subtotal; unvalued amounts are excluded</small>',esc(usd(known.additionalCashNeededUsd)),esc(usd(known.gapAfterOpeningCashUsd)),esc(known.peakNeedDate||''),esc(usd(known.endBalanceUsd))]);
      }
    }
    const warnings=r.issues.map(row=>'<li><strong>'+esc(row.code.replaceAll('_',' ').toLowerCase())+'</strong> · '+esc(row.id)+': '+esc(row.message)+(row.amountUsd?' '+usd(row.amountUsd):'')+'</li>').join('');
    return '<section aria-label="Operating forecast result"><div class="forecast-heading"><div><h4>'+esc(result.inputs.name)+'</h4><p>As of '+esc(r.asOfDate)+' · source case version '+result.source.version+' · pinned plan revision '+result.source.planRevision+'</p></div><div class="forecast-actions">'
      +(isPreview?button('Save this forecast','save',current.program.state==='CLOSED'?'disabled data-forecast-fixed="true"':''):button('Download complete forecast','export-forecast')+button('Download original forecast JSON','export-json'))
      +'</div></div>'+(isPreview?'<p data-forecast-preview-state>Preview ready. Saving retains this exact calculation and its original source.</p>':'<p class="forecast-muted">Saved by '+esc(result.actor)+' on '+esc(result.createdAt)+'. '+(result.current?.sourceChanged?'The current operating records differ. This view retains the original saved calculation.':'The retained operating facts still match the current case.')+'</p>')
      +'<div class="forecast-stats"><div><span>Unpaid invoice obligations</span><strong>'+esc(usd(r.totals.openInvoiceUsd))+'</strong></div><div><span>Remaining grant package cash</span><strong>'+esc(usd(r.totals.remainingPackageCostUsd))+'</strong></div><div><span>Selected customer delivery cash</span>'+total(r.totals.selectedCommercialUninvoicedCostUsd,r.totals.knownSelectedCommercialUninvoicedCostUsd)+'</div><div><span>Remaining grant / customer hours</span><strong>'+esc(r.totals.remainingGrantPackageHours+' / '+r.totals.selectedCommercialHours)+'</strong></div></div>'
      +currency.reportCoverage(r)+eventTimingHtml(r)+table(['Scenario','Cash needed before opening balance','Gap after opening balance','Peak need date','Ending available cash'],scenarioRows)+chart(r)
      +'<h5>Remaining delivery capacity</h5><p>'+esc(r.capacity.peakWeeklyEquivalentHours)+' peak weekly-equivalent hours; '+(r.capacity.weeklyHours===null?'available capacity has not been entered.':esc(r.capacity.weeklyHours)+' available weekly hours; '+r.capacity.overloadedDays+' modeled overloaded calendar days.')+'</p>'
      +'<details open><summary>Remaining work packages</summary>'+table(['Package','Invoice / paid USD','Remaining uninvoiced cash','Remaining hours','Dates','Estimate source'],r.packages.map(row=>[esc(row.id),usd(row.invoicedUsd)+' / '+usd(row.paidUsd),usd(row.remainingCostUsd),esc(row.remainingHours),esc(row.startDate)+' — '+esc(row.endDate),esc(row.note||'Pinned allocation less recorded invoices and assigned direct payments')]))+'</details>'
      +'<details open><summary>Customer delivery decisions</summary>'+(r.commercial.length?table(['Project / original stage','Original price / observed receipts','Remaining delivery cash','Uncollected price','Remaining hours / dates','Scenario'],r.commercial.map(row=>{
        const native=currency.nativeSummary(row);
        return [esc(row.title)+'<small>'+esc(row.stage)+' · '+esc(row.caseRef)+'</small>',native?native.price+'<small>Original observed receipts: '+esc(usd(row.observedReceiptsUsd))+'</small>':usd(row.priceUsd)+' / '+usd(row.observedReceiptsUsd),native?native.cost:usd(row.totalRemainingCashCostUsd),native?native.uncollected:usd(row.uncollectedPriceUsd),esc(row.remainingHours)+'<small>'+(row.startDate?esc(row.startDate)+' — '+esc(row.endDate):'Awaiting original start condition')+'</small>',row.selected?'Included':'Excluded'];
      })):empty('No customer scenario selected.'))+currency.projectReports(r)+'</details>'+fundingReport(r.customerFunding)
      +'<details><summary>Conditional grant amounts</summary>'+table(['Tranche','Original conditional amount','Observed receipt','Remaining amount','Forecast date'],r.grants.map(row=>[esc(row.tranche),usd(row.conditionalPlannedUsd),usd(row.observedGrantUsd),usd(row.remainingUsd),esc(row.included?(row.forecastDate||'Needs new date'):'Excluded')]))+'</details>'
      +'<details'+(r.issues.length?' open':'')+'><summary>Source and estimate decisions ('+r.issues.length+')</summary>'+(warnings?'<ul>'+warnings+'</ul>':empty('No outstanding date or allocation decisions.'))+'</details>'
      +'<details><summary>Complete dated cash and work</summary>'+(r.currencyValuation?.datedCashComplete===false?'<p class="forecast-valuation-warning">Customer outflow and collections below are valued subtotals. Unvalued dated amounts are excluded; the complete combined cash change remains unresolved.</p>':'')+table(['Date','Invoice out','Grant work out',r.currencyValuation?.datedCashComplete===false?'Valued customer work out':'Customer work out','Conditional grants',r.currencyValuation?.datedCashComplete===false?'Valued customer collections':'Customer collections','Combined cash change','Hours'],r.days.map(row=>[esc(row.date),usd(row.invoiceOutflowUsd),usd(row.packageOutflowUsd),esc(valued(row.commercialOutflowUsd)),usd(row.conditionalGrantInflowUsd),esc(valued(row.forecastCustomerInflowUsd)),esc(valued(row.commercialDeltaUsd))+(hasCurrency&&row.commercialDeltaUsd===null?'<small>Known portion: '+esc(usd(row.knownCommercialDeltaUsd))+'</small>':''),esc(row.remainingWorkHours)]))+'</details>'
      +'<details><summary>Original source and assumptions</summary><p>'+esc(r.basis)+'</p><p>Opening cash: '+esc(r.openingCash.basis)+' · '+esc(r.openingCash.note)+'</p><p>'+esc(result.inputs.note)+'</p><dl><dt>Original case</dt><dd>'+esc(result.source.programId)+'</dd><dt>Plan content</dt><dd>'+esc(result.source.planContentSha256)+'</dd><dt>Business snapshot</dt><dd>'+esc(result.source.businessSha256)+'</dd><dt>Preview</dt><dd>'+esc(result.previewSha256)+'</dd>'+(result.sha256?'<dt>Complete saved forecast</dt><dd>'+esc(result.sha256)+'</dd>':'')+'</dl></details></section>';
  }
  function render(){
    if(!available())return;
    comparison?.dispose();comparison=null;
    if(cashDesk){cashState=cashDesk.snapshot();cashDesk.dispose();cashDesk=null;}
    if(workbook){workbookState=workbook.snapshot();workbook.dispose();workbook=null;}
    root.innerHTML='<div class="forecast-heading"><div><h3>Operating forecast</h3><p>Replan remaining cash and delivery work from this retained case.</p></div><div class="forecast-actions">'+button('New forecast','new')+(selected?button('Reforecast current case','reforecast'):'')+'</div></div>'
      +'<label class="forecast-saved-label">Saved forecasts<select data-forecast-selection><option value="">Current draft</option>'+current.forecasts.map(row=>'<option value="'+esc(row.id)+'"'+(selected?.id===row.id?' selected':'')+'>'+esc(row.name)+' · '+esc(row.asOfDate)+' · original v'+row.source.version+'</option>').join('')+'</select></label>'
      + '<div data-forecast-comparison></div>'
      +'<div class="forecast-actions">'+button('Download complete working file','download-working')+button('Reopen working file','choose-working')+button('Continue original source request','recover-source')+button('Continue original save request','recover-save')+(previousWorking?button('Download previous working file','download-previous'):'')+'</div><input hidden data-forecast-working-file type="file" accept=".json,application/json">'
      +'<p data-forecast-status role="status" aria-live="polite"></p>'
      +(current.program.state==='CLOSED'?'<p class="forecast-note">This case is closed. You can inspect and preview forecasts; reopen the case in its original controls before saving a new forecast.</p>':'')
      +'<div data-forecast-editor>'+(editing?editor(inputState||defaults()):'')+'</div><div data-forecast-cash-review></div><div data-forecast-workbook></div><div data-forecast-report>'+(selected&&!editing?reportHtml(selected):'')+'</div>';
    comparison=mountForecastComparison({container:$('[data-forecast-comparison]'),caseId:current.program.id,forecasts:current.forecasts,api,available,isBlocked:blocked});
    cashDesk=mountForecastCashReview({container:$('[data-forecast-cash-review]'),getCurrent:()=>current,getInputs:currentInputs,getRecoveryInputs:retentionInputs,api,available,isBlocked:()=>blocked()||!editing,onCurrent:async next=>{updateCase(next);invalidate();},onStateChange:state=>{cashState=clone(state);persistSoon();},onApply:applyCashReview,initialState:cashState});
    if(editing)workbook=mountForecastWorkbook({container:$('[data-forecast-workbook]'),getCurrent:()=>current,getInputs:currentInputs,getRecoveryInputs:retentionInputs,available,isBlocked:blocked,api,initialState:workbookState,onStateChange:state=>{workbookState=clone(state);persistSoon();},applyReviewedInputs:applyWorkbook});
    root.querySelectorAll('[data-forecast-commercial]').forEach(syncCommercialTiming);
    const form=$('[data-forecast-form]');if(form){currency.syncRates(form,{busy:blocked()});restoreRaw();}applyBusy();
  }
  async function loadSaved(id){selected=await api(path+'/forecasts/'+id);editing=false;preview=null;request=null;onSelection(id);render();status('Reopened the original saved forecast.');}
  async function doPreview(){
    inputState=readEditor();preview=await api(path+'/forecast-preview',{expectedVersion:current.program.version,inputs:inputState});
    inputState=preview.inputs;selected=null;request=null;onSelection(null);
    $('[data-forecast-report]').innerHTML=reportHtml(preview,true);status('Current source and dated assumptions are ready to save.');
  }
  root.addEventListener('input',event=>{const form=event.target.closest('[data-forecast-form]');if(form){invalidate();currency.handleChange(event.target,form,{busy:blocked()});captureRaw();persistSoon();workbook?.setHostBusy();}});
  root.addEventListener('change',event=>{
    if(handleFundingReport(event,renderedFunding))return;
    if(event.target.matches('[data-forecast-selection]')){const id=event.target.value;run(async()=>{if(id)await loadSaved(id);else{selected=null;editing=true;onSelection(null);render();}});return;}
    if(event.target.closest('[data-forecast-form]')){invalidate();persistSoon();}
    if(event.target.matches('[name=timingMode]'))syncCommercialTiming(event.target.closest('[data-forecast-commercial]'));
    const form=event.target.closest('[data-forecast-form]');if(form){captureRaw();currency.handleChange(event.target,form,{busy:blocked()});restoreRaw();persistSoon();workbook?.setHostBusy();}
    if(event.target.matches('[data-forecast-working-file]')){
      const file=event.target.files?.[0];if(!file)return;
      run(async()=>{if(file.size>256*1024*1024)throw new Error('Choose the complete working forecast within 256 MiB.');const loaded=JSON.parse(await file.text());requireActive();await receiveWorking(loaded,{fromFile:true});});return;
    }
    if(event.target.matches('[data-forecast-input-file]')){
      const file=event.target.files[0];if(!file)return;
      run(async()=>{if(file.size>8*1024*1024)throw new Error('Forecast inputs must fit the original 8 MiB input bound.');const loaded=JSON.parse(await file.text());requireActive();if(!loaded||typeof loaded!=='object'||Array.isArray(loaded))throw new Error('Load a forecast input object.');
        // The original service normalizes every imported input before any save.
        const candidate=await api(path+'/forecast-preview',{expectedVersion:current.program.version,inputs:loaded});previousWorking=snapshot();delete previousWorking.previousWorking;rawFields={};workbook?.dispose();workbook=null;workbookState=null;inputState=candidate.inputs;selected=null;editing=true;preview=candidate;request=null;onSelection(null);render();$('[data-forecast-report]').innerHTML=reportHtml(candidate,true);status('Loaded and previewed the complete input scenario.');});
    }
  });
  root.addEventListener('submit',event=>{if(!event.target.matches('[data-forecast-form]'))return;event.preventDefault();run(async()=>{await doPreview();});});
  root.addEventListener('click',event=>{
    if(handleFundingReport(event,renderedFunding))return;
    const target=event.target.closest('[data-forecast-action]');if(!target)return;
    const action=target.dataset.forecastAction;
    if(action==='download-working'&&!busy&&!hostBusy&&!restoring){download(JSON.stringify(snapshot(),null,2)+'\n',current.program.id+'-forecast-working.json');status('Downloaded the complete original inputs, workbook source, review and retained request.');return;}
    if(action==='choose-working'&&!blocked()){const input=$('[data-forecast-working-file]');input.value='';input.click();return;}
    if(action==='download-previous'&&!blocked()&&previousWorking){download(JSON.stringify(previousWorking,null,2)+'\n',current.program.id+'-forecast-previous-working.json');return;}
    if(action==='recover-source'){void run(async()=>{const result=await workbookHost.resume();if(result.adopted){const original=workbookHistory.appliedSource.selection.review;workbookState={...(workbook?.snapshot()||workbookState),received:clone(original.received),choices:{},appliedReview:{...clone(original),sourceReceipt:clone(result.sourceReceipt),appliedInputs:clone(result.inputs)}};workbook?.dispose();workbook=null;}else{const original=workbookHistory.savedSource.selection.review;workbookState={...(workbook?.snapshot()||workbookState),received:clone(original.received),choices:{},sourceReceipt:clone(result.sourceReceipt),appliedReview:null};workbook?.dispose();workbook=null;}render();if(workbook)await workbook.ready;if(result.preview)$('[data-forecast-report]').innerHTML=reportHtml(result.preview,true);status(result.adopted?'Continued the original source request and previewed its reviewed assumptions. Save this forecast to retain the resulting edition.':result.message);},{recovery:true});return;}
    if(action==='recover-save'){void run(async()=>{await sendSavedForecast();},{recovery:true});return;}
    if(!blocked()&&currency.handleAction(action,target,$('[data-forecast-form]'),{busy:blocked()})){invalidate();captureRaw();persistSoon();return;}
    if(action==='start-funding'&&!blocked()){inputState=readEditor({forRecovery:true});inputState.customerFunding={enabled:true,opening:inputState.commercial.map(row=>emptyFundingOpening(row.id)),note:''};captureRaw();invalidate();render();persistSoon();return;}
    if(action==='add-commercial'&&!blocked()){invalidate();const row={id:'project-'+crypto.randomUUID(),title:'',caseRef:'',stage:'QUOTED',selected:true,priceUsd:'',totalDeliveryCostUsd:'',remainingHours:'',startDate:'',endDate:'',paymentMode:'accrual',sourceUrl:'',sourceIds:[],cashIds:[],invoiceIds:[],directCashIds:[],scope:'',note:'',receipts:[{id:'kickoff',label:'Kickoff',amountUsd:'',date:null},{id:'acceptance',label:'Acceptance',amountUsd:'',date:null}]};$('[data-forecast-commercials]').insertAdjacentHTML('beforeend',commercialEditor(row));syncCommercialTiming($('[data-forecast-commercials]').lastElementChild);$('[data-forecast-funding-rows]')?.insertAdjacentHTML('beforeend',fundingOpeningEditor(row,null,fundingOptions()));currency.syncRates($('[data-forecast-form]'),{busy:blocked()});captureRaw();persistSoon();return;}
    if(action==='remove-commercial'&&!blocked()){const row=target.closest('[data-forecast-commercial]'),id=row.dataset.forecastCommercial;row.remove();for(const funding of root.querySelectorAll('[data-forecast-funding]'))if(funding.dataset.forecastFunding===id)funding.remove();for(const key of Object.keys(rawFields)){const parts=JSON.parse(key);if(parts.some((part,i)=>['data-forecast-commercial','data-forecast-funding'].includes(part)&&parts[i+1]===id))delete rawFields[key];}invalidate();captureRaw();persistSoon();return;}
    if(action==='add-receipt'&&!blocked()){const body=target.closest('[data-forecast-commercial]').querySelector('[data-forecast-receipts]');body.insertAdjacentHTML('beforeend',receiptEditor({id:'receipt-'+crypto.randomUUID(),label:'',amountUsd:'',amountNative:''},body.children.length,value(body.closest('[data-forecast-commercial]'),'pricingMode')==='NATIVE'));syncCommercialTiming(body.closest('[data-forecast-commercial]'));currency.syncPricing(body.closest('[data-forecast-commercial]'),{busy:blocked()});invalidate();captureRaw();persistSoon();return;}
    if(action==='remove-receipt'&&!blocked()){target.closest('[data-forecast-receipt]').remove();invalidate();captureRaw();persistSoon();return;}
    if(action==='load-inputs'&&!blocked()){const input=$('[data-forecast-input-file]');input.value='';input.click();return;}
    if(action==='download-inputs'&&!blocked()){try{download(JSON.stringify(readEditor(),null,2)+'\n','operating-forecast-inputs.json');}catch(error){status(error.message,true);}return;}
    run(async()=>{
      if(action==='new'){previousWorking=snapshot();delete previousWorking.previousWorking;workbookState=null;workbook?.dispose();workbook=null;rawFields={};inputState=defaults();selected=null;preview=null;request=null;editing=true;onSelection(null);render();return;}
      if(action==='reforecast'){previousWorking=snapshot();delete previousWorking.previousWorking;workbookState=null;workbook?.dispose();workbook=null;rawFields={};inputState=structuredClone(selected.inputs);inputState.name+=' — updated';selected=null;preview=null;request=null;editing=true;onSelection(null);render();return;}
      if(action==='save'){
        if(!preview)throw new Error('Preview the current inputs before saving.');
        if(current.program.state==='CLOSED')throw new Error('Reopen the original case before saving this forecast.');
        const payload={expectedVersion:current.program.version,actor:recordingActor(),note:inputState.note,action:'forecast.save',data:{inputs:inputState,expectedPreviewSha256:preview.previewSha256}};
        if(!request){payload.requestId=await mutationId('operations:'+current.program.id,payload);requireActive();request=payload;}
        await sendSavedForecast();return;
      }
      if(action==='export-forecast'){const response=await api(path+'/forecasts/'+selected.id+'/export.zip',undefined,{download:true});const blob=await response.blob();requireActive();download(blob,selected.id+'.zip','application/zip');status('Downloaded the complete saved forecast and dated cash/work exports.');return;}
      if(action==='export-json'){const body=structuredClone(selected);delete body.current;download(JSON.stringify(body,null,2)+'\n',selected.id+'.json');return;}
    });
  });
  inputState=initialInputs?structuredClone(initialInputs):defaults();render();
  const ready=(async()=>{
    try{
      const retained=await draftStore.read();requireActive();
      if(retained){
        const validated=validateWorking(retained);
        if(initialForecastId&&!initialInputs){
          previousWorking=validated;delete previousWorking.previousWorking;
          await loadSaved(initialForecastId);
        }else if(initialInputs&&signature(initialInputs)!==signature(validated.inputs)){
          if(validated.pendingWorkbook||validated.saveRequest){
            const incoming=clone(initialInputs);await receiveWorking(validated);
            previousWorking={...snapshot(),editing:true,selectedId:null,inputs:incoming,rawFields:{},pendingWorkbook:null,saveRequest:null,workbook:null,workbookHistory:{},previousWorking:null};
            restoreNotice='Resumed the original pending request. The separately selected input scenario is retained in Download previous working file.';
          }else{
            previousWorking=validated;delete previousWorking.previousWorking;
            restoreNotice='Opened the selected input scenario; the earlier complete working file remains available for download.';
          }
        }else await receiveWorking(validated);
      }else if(initialForecastId&&!initialInputs)await loadSaved(initialForecastId);
    }catch(error){storeError=error.message;status(error.message,true);throw error;}
    finally{restoring=false;if(available()){applyBusy();if(restoreNotice)status(restoreNotice);}}
  })();
  return {ready,setHostBusy,draftInputs(){if(!editing||!available())return null;persistSoon();return clone(retentionInputs());},
    dispose(){if(active&&!restoring){try{void persist().catch(()=>{});}catch{}}active=false;comparison?.dispose();workbook?.dispose();cashDesk?.dispose();void draftStore.close();},root};
}
