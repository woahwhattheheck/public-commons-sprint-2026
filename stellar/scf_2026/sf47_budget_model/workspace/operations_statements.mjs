import {createStatementDraftAccess,statementDraftToken,statementDraftRequest,validateStatementDraftArchive,statementDraftRecoveryPanel} from './operations_statement_drafts.mjs';
import {statementRuleWork,statementRuleEditor,validateStatementRule,mergeStatementRuleLibraries,saveStatementRulebook,editStatementRulebook,prepareStatementRuleReview,statementRuleReviewCurrent,chooseStatementRule,chooseUnambiguousStatementRules,applyStatementRuleReview,statementRulesPanel} from './operations_statement_rules.mjs';
import {statementReviewWorklist,selectedStatementReview,receiveStatementReviewWork,statementReviewBasis,statementReviewComparisonCurrent,startStatementReviewComparison,chooseStatementReviewField,noteStatementReview,recordStatementReviewApplication,replaceStatementReviewWork,statementReviewWorklistPanel} from './operations_statement_review_worklist.mjs';
import {prepareStatementRecipientPacket,validateStatementRecipientPacket,receiveStatementRecipientReturn,compareStatementRecipientReturn,applyStatementRecipientReturn,statementRecipientPanel,statementRecipientReviewHTML} from './operations_statement_review.mjs';
import {statementCopyIndex,createStatementCopyStore,statementCopiesPanel,compareStatementCopy,prepareStatementCopyArchive} from './operations_statement_copies.mjs';
import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
import {statementSetupPanel,statementSetupComparison,statementSetupSettings,statementSetupLink,sameSetupValue} from './operations_statement_profiles.mjs';
import {statementAllocationBasis,sameStatementAllocationBasis,statementAllocationContext,statementAllocationSuggestedAmount,prepareStatementAllocations,applyStatementAllocations,statementAllocationPanel,statementAllocationSummary} from './operations_statement_allocations.mjs';
import {statementMatchingRows,statementSelection,statementBatchPanel,prepareStatementBatch,applyStatementBatch,undoStatementBatch} from './operations_statement_batch.mjs';
// Statement source mapping and reviewed cash receiving in the existing Operations case.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
const json=value=>JSON.stringify(value,null,2);
const categories=['OTHER','GRANT','INVOICE','CUSTOMER','CAPITAL','REFUND'];
const choice=values=>values.map(value=>[value,value]);
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const maximumSource=8*1024*1024;
const pageSize=50;
const bankFormat=input=>input?.sourceFormat==='OFX'||input?.sourceFormat==='MT940';
const scaleText=value=>Object.entries(value||{USD:2}).map(([currency,places])=>currency+': '+places).join('\n');
export function statementCurrencyScales(value){
  const rows=String(value||'').split(/[,;\n]/).map(row=>row.trim()).filter(Boolean);
  if(!rows.length||rows.length>32)throw new Error('Declare one to 32 original currency precisions, such as USD: 2.');
  const scales={};
  for(const row of rows){const match=/^([A-Z]{3})\s*[:=]\s*([0-6])$/.exec(row);
    if(!match)throw new Error('Use uppercase currency codes and 0 to 6 decimal places, such as EUR: 2.');
    if(Object.hasOwn(scales,match[1]))throw new Error('Declare each source currency precision once.');
    scales[match[1]]=Number(match[2]);
  }
  return scales;
}
const editingInput=value=>{const result=clone(value);if(result.decisions===undefined)result.decisions=[];return result;};
const nativeDefaults=()=>({profile:'TEXT_BODY',encoding:'UTF-8',debitCreditProfile:'CD_ONLY',yearWindowStart:1970,dateBasis:'VALUE_DATE',currencyScales:{USD:2}});
function usableInspection(value,inputs,caseId){
  return !!value&&bankFormat(inputs)&&value.schema==='stellar-forge.sf47-bank-statements.v1'&&value.caseId===caseId&&
    value.source?.sourceFormat===inputs.sourceFormat&&value.source?.filename===inputs.source?.filename&&
    /^[a-f0-9]{64}$/.test(value.inspectionSha256||'')&&Array.isArray(value.statements)&&value.statements.every(row=>
      !!row&&/^[a-f0-9]{64}$/.test(row.id||'')&&typeof row.currency==='string'&&typeof row.label==='string'&&
      typeof row.accountReference==='string'&&typeof row.cashEligible==='boolean'&&Number.isInteger(row.rowCount)&&row.rowCount>=0&&
      Number.isInteger(row.pendingCount)&&row.pendingCount>=0&&Array.isArray(row.findings)&&row.findings.every(item=>
        !!item&&typeof item.message==='string'&&['ERROR','REVIEW','INFO'].includes(item.severity))&&
      (row.balanceSnapshots===undefined||Array.isArray(row.balanceSnapshots)));
}
function draftInput(value,complete=false){
  if(!value||typeof value!=='object'||(value.decisions!==undefined&&!Array.isArray(value.decisions)))return false;
  if(bankFormat(value))return (value.sourceFormat!=='MT940'||!!value.statementOptions&&typeof value.statementOptions==='object')&&(!complete||typeof value.statementId==='string'&&!!value.statementId);
  return (!value.sourceFormat||value.sourceFormat==='CSV')&&!!value.format&&!!value.columns;
}
const statuses={NEW:'New cash movement',EXISTING:'Already recorded',EXCLUDED:'Excluded',CONFLICT:'Needs correction'};
const definitive=error=>[400,409,413,415,422].includes(error?.status)&&typeof error?.code==='string';

export function statementHeaders(raw,delimiter=','){
  const text=String(raw).replace(/^\uFEFF/,'');
  const fields=[];let value='',quoted=false,closed=false,started=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}
      else value+=char;
      continue;
    }
    if(char===delimiter){fields.push(value);value='';closed=false;started=false;continue;}
    if(char==='\r'||char==='\n'){fields.push(value);return checkedHeaders(fields);}
    if(char==='"'&&!started){quoted=true;started=true;continue;}
    if(closed)throw new Error('The header has characters after a closing quote. Check the selected separator or original CSV.');
    value+=char;started=true;
  }
  if(quoted)throw new Error('The CSV header has an unfinished quoted field.');
  fields.push(value);return checkedHeaders(fields);
}
function checkedHeaders(fields){
  if(!fields.length||fields.some(value=>!value.trim()))throw new Error('The statement needs a header with a name for every column.');
  if(new Set(fields).size!==fields.length)throw new Error('The statement header contains duplicate column names.');
  if(fields.length>200)throw new Error('Choose a statement with at most 200 columns.');
  return fields;
}
function base64(buffer){let raw='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
function sourceText(value){const raw=atob(value),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
function download(value,filename,type='application/json'){
  const raw=value instanceof Blob?value:typeof value==='string'?value:json(value)+'\n';
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function field(title,name,value='',config={}){
  const attrs=' name="'+esc(name)+'"'+(config.required?' required':'')+(config.attrs?' '+config.attrs:'');
  let input;
  if(config.options)input='<select'+attrs+'>'+config.options.map(([id,text])=>'<option value="'+esc(id)+'"'+(String(value??'')===String(id)?' selected':'')+'>'+esc(text)+'</option>').join('')+'</select>';
  else if(config.area)input='<textarea'+attrs+' rows="3">'+esc(value)+'</textarea>';
  else input='<input'+attrs+' value="'+esc(value)+'" type="'+(config.type||'text')+'">';
  return '<label class="'+(config.wide?'statement-wide':'')+'">'+esc(title)+input+(config.help?'<small>'+esc(config.help)+'</small>':'')+'</label>';
}
function button(text,action,disabled=false,attrs=''){
  return '<button type="button" data-statement-action="'+action+'" '+attrs+(disabled?' disabled data-statement-fixed="true"':'')+'>'+esc(text)+'</button>';
}
const table=(headers,rows)=>'<div class="statement-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const detail=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(json(value))+'</pre></details>';
const amount=(value,currency)=>esc(value??'—')+(value===null||value===undefined?'':' '+esc(currency));

function draftStore(name='sf47-statement-drafts'){
  let opening;
  function database(){
    if(!opening)opening=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(new Error('Browser draft storage is unavailable.'));return;}
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts');};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Could not open browser draft storage.'));
    });
    return opening;
  }
  const access=createStatementDraftAccess(database);
  access.copies=caseId=>createStatementCopyStore(database,caseId);
  return access;
}
const statementStores=new Map();
function statementStore(context){const name=staffDeskStorageKey('sf47-statement-drafts',context);if(!statementStores.has(name))statementStores.set(name,draftStore(name));return statementStores.get(name);}

export function mountStatements({container,current,api,saveApi,session,mutationId,recordingActor,onCase,onCash,staffContext=currentStaffContext()}){
  const pinnedContext=staffContext?{...staffContext}:null,storeDraft=statementStore(pinnedContext),copyStore=storeDraft.copies(current.program.id);
  const root=document.createElement('section');root.className='statement-desk';root.setAttribute('aria-label','Statement receiving');container.replaceChildren(root);
  if(!document.querySelector('link[data-statement-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_statements.css';link.dataset.statementStyle='true';document.head.append(link);
  }
  if(!document.querySelector('link[data-statement-setup-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_statement_profiles.css';link.dataset.statementSetupStyle='true';document.head.append(link);}
  if(!document.querySelector('link[data-statement-batch-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_statement_batch.css';link.dataset.statementBatchStyle='true';document.head.append(link);}
  if(!document.querySelector('link[data-statement-allocation-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_statement_allocations.css';link.dataset.statementAllocationStyle='true';document.head.append(link);}
  if(!document.querySelector('link[data-statement-rule-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_statement_rules.css';link.dataset.statementRuleStyle='true';document.head.append(link);}
  let active=true,busy=false,hostBusy=false,loading=true,caseValue=current,persistTimer=null;
  session.storageWrites||=Promise.resolve();
  const prefix='/api/operations/'+encodeURIComponent(current.program.id);
  const available=()=>active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  const defaults=()=>({source:null,accountId:'',accountLabel:'',currency:'USD',format:{delimiter:',',decimalMark:'.',groupMark:'',dateFormat:'YYYY-MM-DD',amountMode:'SIGNED',positiveDirection:'IN'},columns:{date:'',reference:'',description:'',amount:'',debit:'',credit:''},defaultCategory:'OTHER',decisions:[]});
  const values={classificationRules:statementRuleWork(session.classificationRules,current.program.id),inputs:defaults(),headers:[],inspection:null,nativeScalesText:'USD: 2',optionsError:'',editRevision:0,preview:null,dirty:true,confirmed:false,page:0,status:'ALL',query:'',appliedQuery:'',pending:null,accepted:null,setupPending:null,setupChoice:'',setupName:'',setupNote:'',inflight:null,error:'',notice:'',allocationRow:null,allocationWorks:{},batchSelection:[],batchChange:{mode:'CLASSIFY',category:'',tranche:'KEEP',reason:''},batchProposal:null,batchUndo:null,batchReviewPage:0,copyIndex:statementCopyIndex(current.program.id),copyLoaded:false,copyName:'',copyNote:'',copyQuery:'',copyAppliedQuery:'',copyPage:0,workingCopyId:null,copySelectedId:'',copySelectedRevision:1,copyDetailPage:0,copyReview:null,recipientName:'',recipientRole:'',recipientPackets:[],recipientReturn:null,recipientHistory:[],recipientComparison:null,recipientChoices:{},recipientPage:0,recipientWorklist:statementReviewWorklist(session,current.program.id),recipientWorkPage:0,recipientIssuedPage:0,recipientWorkQuery:'',recipientWorkStale:''};
  if(!Object.hasOwn(session,'appliedQuery'))session.appliedQuery=session.query||'';
  for(const [key,value] of Object.entries(values))if(!Object.hasOwn(session,key))session[key]=value;
  session.currentCaseVersion=current.program.version;
  const source=()=>session.inputs.source;
  const native=()=>bankFormat(session.inputs);
  const locked=()=>loading||busy||hostBusy||!!session.inflight||!!session.pending||!!session.accepted||!!session.setupPending||!!session.storageConflict||!!session.storageReadFailure;
  const editable=()=>!locked()&&caseValue.program.state==='OPEN';
  const rowDecision=number=>session.inputs.decisions.find(row=>row.rowNumber===number);
  function snapshot(){return {classificationRules:clone(session.classificationRules),recipientWorklist:clone(session.recipientWorklist),recipientName:session.recipientName,recipientRole:session.recipientRole,recipientPackets:clone(session.recipientPackets),recipientReturn:clone(session.recipientReturn),recipientHistory:clone(session.recipientHistory),workingCopyId:session.workingCopyId,copyName:session.copyName,copyNote:session.copyNote,lastReceipt:clone(session.lastReceipt||null),schema:'sf47.statement-draft.v1',caseId:current.program.id,inputs:clone(session.inputs),headers:clone(session.headers),inspection:clone(session.inspection),nativeScalesText:session.nativeScalesText,preview:clone(session.preview),dirty:session.dirty,pending:clone(session.pending),accepted:clone(session.accepted),setupPending:clone(session.setupPending),setupChoice:session.setupChoice,setupName:session.setupName,setupNote:session.setupNote,originalInputHandoff:clone(session.originalInputHandoff||null),batchSelection:clone(session.batchSelection),batchChange:clone(session.batchChange),batchUndo:clone(session.batchUndo),allocationRow:session.allocationRow,allocationWorks:clone(session.allocationWorks)};}
  function draftMeta(reason){return {id:'statement-tab-'+crypto.randomUUID(),savedAt:new Date().toISOString(),reason};}
  async function refreshDraftRecoveries(){session.draftRecoveryIndex=await storeDraft.list(current.program.id);}
  function draftStoragePage(){const failure=session.storageReadFailure?'<section class="statement-panel" aria-label="Unreadable saved statement draft"><h4>Preserve the saved original before recovery</h4><p class="statement-error" role="alert">'+esc(session.storageReadFailure.error)+'</p><p>The complete original remains unchanged. Download it, repair its interpretation in a full recovery file, then explicitly receive that file. Its original pending request and result must stay identical.</p><div class="statement-actions">'+button('Download unreadable saved original','draft-unreadable-export',session.storageReadFailure.unread===true,'data-statement-recovery="true" data-statement-draft-recovery="true"')+button('Open repaired complete draft','draft-unreadable-import',session.storageReadFailure.unread===true,'data-statement-recovery="true" data-statement-draft-recovery="true"')+'</div></section>':'';return failure+statementDraftRecoveryPanel({local:snapshot(),shared:session.storageShared??null,conflict:!!session.storageConflict||!!session.storageReadFailure,comparisonReady:!!session.storageComparisonReady,index:session.draftRecoveryIndex,page:session.draftRecoveryPage||0,detailPage:session.draftDifferencePage||0,selected:session.draftRecoverySelected||null});}
  async function persist(critical=false){
    const value=snapshot();
    const work=session.storageWrites.catch(()=>{}).then(async()=>{
      if(session.storageReadFailure||typeof session.storageToken!=='string')throw new Error('The browser draft has not been read. Reopen the Statements desk before recording a request.');
      const localToken=statementDraftToken(value);
      if(session.storageConflict&&session.storageConflictLocalToken===localToken){
        if(critical)throw new Error('Resolve the changed shared draft before sending this retained request.');
        return;
      }
      const result=await storeDraft.write(current.program.id,value,session.storageToken,draftMeta('Another tab changed the current statement draft'));
      if(!result.saved){
        session.storageConflict=result.record.id;session.storageConflictLocalToken=localToken;session.storageShared=result.current;session.storageComparisonReady=true;
        session.draftRecoverySelected=result.record;await refreshDraftRecoveries();
        session.storageWarning='This tab and the shared draft were both retained. Compare them in Statement drafts in this browser before continuing.';
        if(available())render();
        if(critical)throw new Error('The shared draft changed. This complete request was retained in tab recovery and has not been sent by this action. Open the shared draft before resuming.');
        return;
      }
      session.storageToken=result.token;session.storageConflict=null;session.storageConflictLocalToken=null;session.storageWarning='';
    });
    session.storageWrites=work;
    try{await work;}
    catch(error){
      if(!session.storageConflict)session.storageWarning='This browser could not save the draft. Download a recovery copy before closing this page. '+error.message;
      if(critical)throw error;
    }
  }
  function schedulePersist(){clearTimeout(persistTimer);persistTimer=setTimeout(()=>{persistTimer=null;void persist();},350);}
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(loading||busy||hostBusy||!!session.inflight));
    root.querySelectorAll('button,input,select,textarea').forEach(el=>{
      const recovery=el.dataset.statementRecovery==='true',draftRecovery=el.dataset.statementDraftRecovery==='true'||el.dataset.statementAction==='draft-export';
      el.disabled=el.dataset.statementFixed==='true'||loading||busy||hostBusy||!!session.inflight||(!draftRecovery&&!!(session.storageConflict||session.storageReadFailure))||(!recovery&&!!(session.pending||session.accepted||session.setupPending))||(el.dataset.statementWrite==='true'&&caseValue.program.state!=='OPEN');
    });
    root.querySelectorAll('[data-statement-row-select]').forEach(el=>{el.checked=session.batchSelection.includes(Number(el.dataset.statementRowSelect));el.disabled=!editable()||session.dirty;});
    const importButton=$('[data-statement-action="import"]');
    if(importButton)importButton.disabled=!editable()||session.dirty||!session.confirmed||!session.preview?.canImport;
    const warning=$('[data-statement-stale]');if(warning)warning.hidden=!session.dirty;
  }
  function clearChangedSetup(){
    const selected=session.inputs.statementSetup;if(!selected)return;
    const row=(caseValue.statementSetups||[]).find(item=>sameSetupValue(statementSetupLink(item),selected));
    if(!row||!sameSetupValue(statementSetupSettings(session.inputs),row.settings)){delete session.inputs.statementSetup;session.notice='The account or interpretation changed. Save this mapping as a new setup edition to retain its reusable choice.';}
  }
  function clearBatch(){session.batchSelection=[];session.batchProposal=null;session.batchUndo=null;session.batchReviewPage=0;}
  function changed(keepBatch=false){session.copyReview=null;invalidateRecipientComparison();clearAllocationProposals();if(!keepBatch)clearBatch();session.editRevision++;session.dirty=true;session.confirmed=false;session.error='';schedulePersist();if(!keepBatch)redrawBatch();redrawAllocations();redrawRecipientWork();redrawRules();controls();}
  function setDecision(number,patch){
    let decision=rowDecision(number);
    if(!decision){decision={rowNumber:number,action:'IMPORT'};session.inputs.decisions.push(decision);}
    Object.assign(decision,patch);changed();
  }
  async function run(action,{persistAfter=true}={}){
    if(!available()||loading||busy||hostBusy||session.inflight)return;
    busy=true;session.error='';controls();
    try{await action();}catch(error){session.error=error.message||String(error);}
    finally{busy=false;if(persistAfter)void persist();if(available())render();}
  }
  function headersFromSource(guess=false){
    if(native()){session.headers=[];return;}
    session.headers=source()?statementHeaders(sourceText(source().contentBase64),session.inputs.format.delimiter):[];
    if(!guess&&session.inputs.statementSetup)return;
    const aliases={date:['date','transactiondate','posteddate','bookingdate'],reference:['transactionid','reference','id','fitid','transactionreference'],description:['description','memo','details','narrative'],amount:['amount','transactionamount'],debit:['debit','debits','withdrawal','withdrawals'],credit:['credit','credits','deposit','deposits'],currency:['currency','ccy'],usdValue:['usdvalue','amountusd']};
    const names=session.headers.map(name=>[name,name.toLowerCase().replace(/[^a-z0-9]/g,'')]);
    for(const key of Object.keys(aliases)){
      if(guess||!session.headers.includes(session.inputs.columns[key]))session.inputs.columns[key]=names.find(([,normal])=>aliases[key].includes(normal))?.[0]||'';
    }
  }
  function resetInterpretation(){
    session.inputs.decisions=[];session.preview=null;session.inspection=null;session.page=0;
    clearAllocations();delete session.inputs.statementId;
    delete session.inputs.openingBalance;delete session.inputs.closingBalance;changed();
  }
  function chooseFormat(format){
    if(!['CSV','OFX','MT940'].includes(format))throw new Error('Choose CSV, OFX / QFX or MT940.');
    const input=session.inputs;delete input.statementSetup;input.sourceFormat=format;
    if(format==='CSV'){input.format=clone(defaults().format);input.columns=clone(defaults().columns);delete input.statementOptions;}
    else {delete input.format;delete input.columns;if(format==='MT940'){input.statementOptions=nativeDefaults();session.nativeScalesText=scaleText(input.statementOptions.currencyScales);}else delete input.statementOptions;}
    session.optionsError='';resetInterpretation();headersFromSource(true);
    session.notice=native()?'Inspect the original file and select its source account before previewing.':'Review the original CSV columns and number format.';
  }
  async function chooseFile(file){
    if(!file)return;
    if(file.size===0||file.size>maximumSource)throw new Error('Choose a nonempty original statement file up to 8 MiB.');
    const buffer=await file.arrayBuffer();if(!available())return;
    if(!native())new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    const contentBase64=base64(buffer);
    if(source())await preserveCurrentCopy('Before opening '+file.name);
    session.workingCopyId=null;session.copyName='';session.copyNote='';session.copyReview=null;
    delete session.inputs.statementSetup;
    session.inputs.source={filename:file.name,contentBase64,sourceUrl:'',observedAt:new Date().toISOString()};
    resetInterpretation();headersFromSource(true);
    session.notice=native()?'Read the original bytes. Inspect the native account sections and format choices.':'Read the source file. Review its account, currency and column mapping before previewing.';
    await persist();
  }
  function captureMapping(form){
    const data=new FormData(form),input=session.inputs,oldOptions=JSON.stringify(input.statementOptions);
    for(const name of ['accountId','accountLabel','currency','defaultCategory'])if(data.has(name))input[name]=String(data.get(name)||'').trim();
    input.currency=input.currency.toUpperCase();
    for(const name of ['openingBalance','closingBalance','valuationNote','sourceReviewNote'])if(data.has(name)){const value=String(data.get(name)||'').trim();if(value)input[name]=value;else delete input[name];}
    if(!native()){
      for(const name of ['delimiter','decimalMark','groupMark','dateFormat','amountMode','positiveDirection'])input.format[name]=String(data.get('format.'+name)??input.format[name]);
      for(const key of ['date','reference','description','amount','debit','credit','currency','usdValue']){const value=data.get('columns.'+key);if(value!==null)input.columns[key]=String(value);}
    }else if(input.sourceFormat==='MT940'){
      const options=input.statementOptions||nativeDefaults();
      for(const key of ['profile','encoding','debitCreditProfile'])if(data.has('native.'+key))options[key]=String(data.get('native.'+key));
      if(data.has('native.yearWindowStart'))options.yearWindowStart=Number(data.get('native.yearWindowStart'));
      if(data.has('native.currencyScales'))session.nativeScalesText=String(data.get('native.currencyScales'));
      try{options.currencyScales=statementCurrencyScales(session.nativeScalesText);session.optionsError='';}catch(error){options.currencyScales={};session.optionsError=error.message;}
      options.dateBasis='VALUE_DATE';input.statementOptions=options;
      if(oldOptions!==JSON.stringify(options)){session.inspection=null;delete input.statementId;input.decisions=[];session.preview=null;delete input.openingBalance;delete input.closingBalance;}
    }
    if(input.source&&data.has('sourceUrl'))input.source.sourceUrl=String(data.get('sourceUrl')||'').trim();
    clearChangedSetup();changed();
    const panel=root.querySelector('[aria-label="Saved statement setups"]');if(panel){panel.outerHTML=setupPage();controls();}
  }
  function inspectionInputs(){
    if(!native()||!source())throw new Error('Select an original OFX / QFX or MT940 file.');
    if(session.optionsError)throw new Error(session.optionsError);
    const input={sourceFormat:session.inputs.sourceFormat,source:clone(source())};
    if(input.sourceFormat==='MT940'){
      const options=clone(session.inputs.statementOptions||nativeDefaults());
      options.currencyScales=statementCurrencyScales(session.nativeScalesText);
      if(!Number.isInteger(options.yearWindowStart)||options.yearWindowStart<1900||options.yearWindowStart>2000)throw new Error('Choose a century window start from 1900 through 2000.');
      input.statementOptions=options;
    }
    return input;
  }
  async function inspect(){
    const inputs=inspectionInputs(),expectedVersion=caseValue.program.version,revision=session.editRevision;
    const result=await saveApi(prefix+'/statement-inspect',{expectedVersion,inputs});
    if(!usableInspection(result,inputs,current.program.id)||result.expectedVersion!==expectedVersion)throw new Error('The original bank inspection differs from this case, source or account selection.');
    if(session.editRevision!==revision||session.currentCaseVersion!==expectedVersion)return;
    session.inspection=result;session.preview=null;session.dirty=true;session.confirmed=false;
    if(!result.statements.some(row=>row.id===session.inputs.statementId&&row.cashEligible))delete session.inputs.statementId;
    session.notice='Inspected '+result.statements.length+' original account and currency sections. Select the account to reconcile.';
    await persist();
  }
  function selectAccount(id){
    const inspection=session.inspection,row=inspection?.statements.find(value=>value.id===id);
    resetInterpretation();session.inspection=inspection;
    if(!row){session.notice='Select an inspected original account.';return;}
    // Preserve the original inspection while changing only its selected section.
    if(!row.cashEligible)throw new Error('This original credit account belongs in Supplier accounts.');
    session.inputs.statementId=row.id;session.inputs.currency=row.currency;clearChangedSetup();
    if(row.openingBalance?.amount!==undefined&&row.closingBalance?.amount!==undefined){
      session.inputs.openingBalance=row.openingBalance.amount;session.inputs.closingBalance=row.closingBalance.amount;
    }
    session.notice='Selected '+row.label+'. Review its account alias, movements and original balances.';
  }
  function reviewedInputs(){
    const input=clone(session.inputs);
    if(!input.source)throw new Error('Choose the original statement file.');
    if(!input.accountId||!input.accountLabel)throw new Error('Enter a stable account key and a readable account label.');
    if(!input.currency)throw new Error('Enter the statement’s currency or asset symbol.');
    if(bankFormat(input)){
      const inspected=session.inspection?.statements.find(row=>row.id===input.statementId&&row.cashEligible);
      if(!inspected)throw new Error('Inspect the original file and select a cash account before previewing.');
      if(inspected.currency!==input.currency)throw new Error('The selected account currency changed. Select its original source account again.');
      const original=inspectionInputs();if(original.statementOptions)input.statementOptions=original.statementOptions;else delete input.statementOptions;
      delete input.format;delete input.columns;
    }else{
      if(!input.columns.date||!input.columns.reference)throw new Error('Map the date and original transaction reference columns.');
      if(input.format.amountMode==='SIGNED'&&!input.columns.amount)throw new Error('Map the signed amount column.');
      if(input.format.amountMode==='DEBIT_CREDIT'&&(!input.columns.debit||!input.columns.credit))throw new Error('Map both debit and credit columns.');
    }
    return input;
  }
  async function preview(){
    const inputs=reviewedInputs(),expectedVersion=caseValue.program.version,revision=session.editRevision;
    const result=await saveApi(prefix+'/statement-preview',{expectedVersion,inputs});
    if(result.caseId!==current.program.id||result.expectedVersion!==expectedVersion||result.schema!=='stellar-forge.sf47-statements.v1'||!Array.isArray(result.rows))throw new Error('The preview belongs to another case or version. Refresh the case and preview again.');
    if(session.editRevision!==revision||session.currentCaseVersion!==expectedVersion)return;
    clearBatch();clearAllocationProposals();session.preview=result;session.dirty=false;session.confirmed=false;session.page=0;
    session.notice='Reviewed '+result.rows.length+' source rows against the current cash records.';
    await resumeRecipientWork();await persist();
  }
  async function refresh(){
    const next=await saveApi(prefix);
    if(next.program.id!==current.program.id)throw new Error('The refreshed case has another identity.');
    caseValue=next;session.currentCaseVersion=next.program.version;
    if(session.preview?.expectedVersion!==next.program.version){clearBatch();clearAllocationProposals();session.dirty=true;session.confirmed=false;}
    await resumeRecipientWork();return next;
  }
  async function finishAccepted(){
    const accepted=session.accepted;if(!accepted)return;
    await persist(true);
    const result=accepted.result,next=await refresh();
    if(result.id!==next.program.id||next.program.version<result.version||result.action!=='statement.receive'||result.previewSha256!==accepted.payload.data.expectedPreviewSha256)throw new Error('The original import receipt has not reconciled with this case yet.');
    const ids=new Set((next.records.cash||[]).map(row=>row.id));
    if([...(result.cashIds||[]),...(result.existingCashIds||[])].some(id=>!ids.has(id)))throw new Error('A saved statement cash record is missing from the case readback.');
    const sourceIds=new Set(next.sources.map(row=>row.id));
    if((result.sourceIds||[]).some(id=>!sourceIds.has(id)))throw new Error('A retained statement source is missing from the case readback.');
    const original=next.sources.find(row=>row.id===result.recordId);
    if(!original||original.sha256!==result.statementSha256)throw new Error('The saved statement source differs from the import receipt.');
    clearBatch();clearAllocations();session.lastReceipt=clone(result);session.accepted=null;session.pending=null;session.preview=null;session.dirty=true;session.confirmed=false;
    session.notice='Imported '+(result.cashIds?.length||0)+' cash movements; '+(result.existingCashIds?.length||0)+' existing records reconciled. Case version '+result.version+'.';
    await persist();
    if(available())await onCase(next,result);
  }
  async function sendPending(){
    const pending=session.pending;if(!pending)return;
    assertStaffRequestActor(pending.payload,pinnedContext);
    await persist(true);
    if(!available())return;
    const work=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',pending.payload);
        session.accepted={payload:pending.payload,result};session.pending=null;await persist();return result;
      }catch(error){
        if(definitive(error)){session.pending=null;session.dirty=true;session.confirmed=false;session.notice='The case rejected this request. Your source and mapping are retained for correction.';await persist();}
        throw error;
      }
    })();
    session.inflight=work;controls();
    try{await work;}finally{if(session.inflight===work)session.inflight=null;}
    if(available()&&!session.storageConflict)await finishAccepted();
  }
  async function importReviewed(){
    if(caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.setupPending)throw new Error('Reopen the case and finish its current import before recording another statement.');
    if(!session.preview?.canImport||session.dirty||!session.confirmed)throw new Error('Review a current preview and confirm its cash movements before importing.');
    const payload={expectedVersion:session.preview.expectedVersion,actor:recordingActor(),note:'Imported reviewed statement '+source().filename,action:'statement.receive',data:{inputs:reviewedInputs(),expectedPreviewSha256:session.preview.previewSha256}};
    payload.requestId=await mutationId('operations:'+current.program.id,payload);
    session.pending={payload,createdAt:new Date().toISOString()};await persist(true);
    await sendPending();
  }

  const setupRows=()=>caseValue.statementSetups||[];
  const setupHeaderReader=(file,delimiter)=>statementHeaders(sourceText(file.contentBase64),delimiter);
  function setupPage(){return statementSetupPanel({rows:setupRows(),input:session.inputs,choice:session.setupChoice,name:session.setupName,note:session.setupNote,pending:session.setupPending,readHeaders:setupHeaderReader,open:caseValue.program.state==='OPEN'});}
  function selectedSetup(){
    const row=setupRows().find(item=>item.sourceId===session.setupChoice);
    if(!row)throw new Error('Choose a saved statement setup.');
    return row;
  }
  async function applySetup(){
    const row=selectedSetup(),comparison=statementSetupComparison(row,session.inputs,setupHeaderReader);
    if(!comparison.canApply)throw new Error('Choose the current original file and resolve every missing mapped header before applying this setup.');
    const original=clone(source());
    session.inputs={...clone(row.settings),source:original,decisions:[]};
    resetInterpretation();
    session.inputs.statementSetup=statementSetupLink(row);
    session.headers=comparison.headers;session.nativeScalesText=scaleText(session.inputs.statementOptions?.currencyScales);
    session.optionsError='';session.setupName=row.name;
    session.notice='Applied '+row.name+' edition '+row.revision+'. '+(native()?'Inspect this original file and select its bank account.':'Review this period’s balances and row decisions.');
    await persist(true);
  }
  async function finishSetup(){
    const pending=session.setupPending,result=pending?.result;if(!result)return;
    const next=await refresh(),row=(next.statementSetups||[]).find(item=>item.sourceId===result.recordId);
    if(result.id!==next.program.id||result.action!=='statement-setup.save'||!row||!sameSetupValue(row,result.statementSetup)||next.program.version<result.version)throw new Error('The saved setup receipt has not reconciled with this case yet. Resume the original request.');
    session.setupChoice=row.sourceId;session.setupName=row.name;session.setupNote='';
    if(row.status==='ACTIVE'&&sameSetupValue(statementSetupSettings(session.inputs),row.settings))session.inputs.statementSetup=statementSetupLink(row);
    session.setupPending=null;session.preview=null;session.dirty=true;session.confirmed=false;
    session.notice=(row.status==='ARCHIVED'?'Archived ':'Saved ')+row.name+' edition '+row.revision+'. The complete setup history is retained in this case.';
    await persist(true);if(available())await onCase(next,result);
  }
  async function sendSetup(){
    const pending=session.setupPending;if(!pending)return;
    assertStaffRequestActor(pending.payload,pinnedContext);await persist(true);
    if(!pending.result){
      try{pending.result=await saveApi(prefix+'/command',pending.payload);await persist(true);}
      catch(error){if(definitive(error)){session.setupPending=null;await persist();}throw error;}
    }
    if(available())await finishSetup();
  }
  async function saveSetup(mode){
    if(session.pending||session.accepted||session.setupPending||caseValue.program.state!=='OPEN')throw new Error('Finish the retained request and reopen this case before saving a setup.');
    const mapping=$('[data-statement-mapping]');if(mapping)captureMapping(mapping);
    const prior=mode==='new'?null:selectedSetup();
    const name=String(session.setupName||prior?.name||'').trim(),note=String(session.setupNote||'').trim();
    if(!name||!note)throw new Error('Enter a setup name and a reason for this edition.');
    const data={expectedRevision:prior?.revision||0,name,status:mode==='archive'?'ARCHIVED':'ACTIVE'};
    if(prior)data.id=prior.id;
    if(mode!=='archive')data.inputs=reviewedInputs();
    const payload={expectedVersion:caseValue.program.version,actor:recordingActor(),note,action:'statement-setup.save',data};
    payload.requestId=await mutationId('operations:'+current.program.id,payload);
    session.setupPending={payload,createdAt:new Date().toISOString()};await persist(true);
    await sendSetup();
  }

  function nativeSourcePage(){
    const input=session.inputs,inspection=session.inspection,selected=inspection?.statements.find(row=>row.id===input.statementId);
    let html='';
    if(input.sourceFormat==='MT940'){
      const options=input.statementOptions||nativeDefaults();
      html+='<h4>2. Choose the original MT940 interpretation</h4><div class="statement-fields">'+
        field('Original transport','native.profile',options.profile,{options:[['TEXT_BODY','Statement text body'],['FIN_ENVELOPE','FIN envelope']]})+
        field('Original encoding','native.encoding',options.encoding,{options:choice(['ASCII','UTF-8','ISO-8859-1'])})+
        field('Debit and reversal marks','native.debitCreditProfile',options.debitCreditProfile,{options:[['CD_ONLY','C / D'],['CD_REVERSALS','C / D with RC / RD reversals']]})+
        field('Century window starts','native.yearWindowStart',options.yearWindowStart,{type:'number',attrs:'min="1900" max="2000" step="1"',help:'Resolve original two-digit years within this explicit 100-year window.'})+
        field('Currency decimal places','native.currencyScales',session.nativeScalesText,{area:true,help:'One original precision per currency, such as USD: 2 or JPY: 0. Separate entries with lines or commas.'})+
        '<p class="statement-native-note">The original full value date supplies each cash date. Entry month and day remain separate source fields.</p></div>';
    }else html+='<h4>2. Inspect the original OFX / QFX accounts</h4><p>The native reader uses the file’s original declared encoding, FITID identities and posted dates.</p>';
    html+='<div class="statement-actions">'+button('Inspect original accounts','inspect',!source())+'</div>';
    if(!inspection)return html+'<p class="statement-empty">Inspect the original file to select an account and review its source balances.</p>';
    html+=field('Original account and currency','statementId',input.statementId||'',{wide:true,options:[['','Choose an original cash account'],...inspection.statements.filter(row=>row.cashEligible).map(row=>[row.id,row.label])]});
    html+=table(['Original account','Currency / dates','Posted / pending','Original balances','Use'],inspection.statements.map(row=>[
      '<strong>'+esc(row.label)+'</strong><small>'+esc(row.accountReference)+'</small>',
      esc(row.currency)+'<small>'+esc(row.from||'—')+' → '+esc(row.until||'—')+'</small>',
      esc(row.rowCount)+' posted<small>'+esc(row.pendingCount)+' pending observations</small>',
      (row.openingBalance?'Opening '+amount(row.openingBalance.amount,row.currency)+'<small>'+esc(row.openingBalance.date)+'</small>':'Opening not supplied')+
        (row.closingBalance?'<small>Closing '+amount(row.closingBalance.amount,row.currency)+' · '+esc(row.closingBalance.date)+'</small>':''),
      row.cashEligible?'Cash observations':'Supplier accounts'
    ]));
    if(selected){
      html+='<div class="statement-native-selection"><strong>Selected original account:</strong> '+esc(selected.label)+
        '<p>Review '+esc(selected.rowCount)+' posted movements. '+esc(selected.pendingCount)+' pending observations remain in the original report.</p>'+
        (selected.findings?.length?'<ul>'+selected.findings.map(item=>'<li><strong>'+esc(label(item.severity))+':</strong> '+esc(item.message)+'</li>').join('')+'</ul>':'')+
        (selected.balanceSnapshots?.length?detail('Original dated balance snapshots',selected.balanceSnapshots):'')+'</div>';
    }
    return html;
  }
  function sourcePage(){
    const input=session.inputs,isNative=native(),format=input.format||defaults().format,columns=input.columns||{},options=[['','Select a column'],...session.headers.map(name=>[name,name])];
    const optional=[['','Not mapped'],...session.headers.map(name=>[name,name])];
    const mapping=(text,key,required=true)=>field(text,'columns.'+key,columns[key]||'',{options:required?options:optional,required});
    const accept=input.sourceFormat==='OFX'?'.ofx,.qfx,application/x-ofx':input.sourceFormat==='MT940'?'.mt940,.sta,.stm,.txt,text/plain':'.csv,.tsv,text/csv,text/tab-separated-values';
    const selected=session.inspection?.statements.find(row=>row.id===input.statementId&&row.cashEligible);
    return '<section class="statement-panel"><h4>1. Choose the statement and account</h4>'+
      '<form data-statement-mapping><div class="statement-fields">'+
      field('Original statement format','sourceFormat',input.sourceFormat||'CSV',{options:[['CSV','CSV / delimited text'],['OFX','OFX / QFX'],['MT940','MT940']]})+
      '<label class="statement-wide">Original statement file<input type="file" data-statement-file accept="'+accept+'"><small>'+esc(isNative?'The original bank bytes and complete native reader report are retained when imported.':'UTF-8, including a UTF-8 byte-order mark. The original bytes are retained when imported.')+'</small></label>'+
      (source()?'<p class="statement-file statement-wide"><strong>'+esc(source().filename)+'</strong> · '+esc(isNative?'Original bank source':session.headers.length+' columns loaded')+'.</p>':'<p class="statement-empty statement-wide">Choose the original statement file.</p>')+
      field('Account key','accountId',input.accountId,{required:true,help:'A stable, nonsecret name for this account. Reuse it for overlapping statements and use a different key for each account.'})+
      field('Account label','accountLabel',input.accountLabel,{required:true,help:'A readable label, such as Project operating account.'})+
      field('Statement currency / asset','currency',input.currency,{required:true,attrs:isNative?'readonly':'',help:isNative?'Selected from the original account section below.':'One currency per file. Quantities remain in this original currency.'})+
      field('Original source URL','sourceUrl',source()?.sourceUrl||'',{wide:true,help:'Optional public or authorized source location, without credentials in the URL.'})+
      '</div>'+
      (isNative?nativeSourcePage():'<h4>2. Map the source format</h4><div class="statement-fields">'+
      field('Column separator','format.delimiter',format.delimiter,{options:[[',','Comma'],[';','Semicolon'],['\t','Tab'],['|','Pipe']]})+
      field('Decimal mark','format.decimalMark',format.decimalMark,{options:[['.','Period (1234.56)'],[',','Comma (1234,56)']]})+
      field('Grouping mark','format.groupMark',format.groupMark,{options:[['','None'],[',','Comma'],['.','Period'],[' ','Space'],['\u00a0','Nonbreaking space'],["'","Apostrophe"]]})+
      field('Date format','format.dateFormat',format.dateFormat,{options:choice(['YYYY-MM-DD','MM/DD/YYYY','DD/MM/YYYY','YYYY/MM/DD'])})+
      field('Amount columns','format.amountMode',format.amountMode,{options:[['SIGNED','One signed amount'],['DEBIT_CREDIT','Separate debit and credit']]})+
      field('Positive signed amounts','format.positiveDirection',format.positiveDirection,{options:[['IN','Money received'],['OUT','Money paid']]})+
      mapping('Transaction date','date')+mapping('Original transaction reference','reference')+mapping('Description','description',false)+
      (format.amountMode==='SIGNED'?mapping('Signed amount','amount'):mapping('Debit amount','debit')+mapping('Credit amount','credit'))+
      mapping('Currency column','currency',false)+(input.currency!=='USD'?mapping('Recorded USD value','usdValue',false):'')+'</div>')+
      '<div class="statement-fields">'+field('Default cash category','defaultCategory',input.defaultCategory,{options:categories.map(value=>[value,label(value)])})+
      (input.currency!=='USD'?field('USD valuation basis','valuationNote',input.valuationNote||'',{wide:true,area:true,help:'Retain an explicit source valuation when one is supplied. Original bank currency amounts remain separate.'}):'')+
      (isNative?field('Source review note','sourceReviewNote',input.sourceReviewNote||'',{wide:true,area:true,attrs:'maxlength="4000"',help:'Retain the original correction or source interpretation decision. Row-specific reasons remain with each movement.'}):'')+
      '</div><h4>3. Reconcile the statement balances</h4><div class="statement-fields">'+
      field('Opening balance','openingBalance',input.openingBalance||'',{attrs:'inputmode="decimal"',help:isNative?'Original signed amount, with a period decimal mark and no grouping.':'Optional signed amount in the statement currency and selected number format.'})+
      field('Closing balance','closingBalance',input.closingBalance||'',{attrs:'inputmode="decimal"',help:'Provide both balances to compare the complete supplied movement.'})+
      '</div>'+
      (isNative?'<p class="statement-native-note">Original snapshots keep their own dates. Pending observations stay in the report. OFX totals describe the supplied posted occurrences, including replacements or repeated occurrences.</p>':'')+
      '<div class="statement-actions">'+button('Preview statement','preview',!source()||(isNative&&!selected),'class="statement-primary"')+button('Download recovery copy','draft-export',!source(),'data-statement-recovery="true"')+button('Open recovery copy','draft-import',!!(session.pending||session.accepted||session.setupPending),'data-statement-recovery="true"')+'</div></form></section>';
  }

  function rulesPage(){
    const work=session.classificationRules;
    const panel=statementRulesPanel({library:work.library,editor:work.editor,selected:work.selected,review:work.review,
      draft:snapshot(),caseVersion:caseValue.program.version,query:work.query,appliedQuery:work.appliedQuery,filter:work.filter,page:work.page,rulePage:work.rulePage,open:caseValue.program.state==='OPEN'});
    const pages=Math.max(1,Math.ceil(work.applications.length/20)),page=Math.min(work.applicationPage,pages-1),slice=work.applications.slice(page*20,page*20+20);
    const history=work.applications.length?'<section class="statement-panel"><h4>Retained rule applications</h4><p>Every application keeps its selected rule edition and exact original row changes in this complete working copy. Page '+(page+1)+' of '+pages+'.</p>'+
      table(['Applied','Rulebook','Original source','Rows','Complete original'],slice.map((item,index)=>[
        esc(item.appliedAt)+'<small>'+esc(item.actor)+'</small>',esc(item.edition.name)+' · edition '+item.edition.revision,
        esc(item.source.filename),String(item.applied.length),button('Download application','rules-application-export',false,'data-statement-recovery="true" data-application="'+(page*20+index)+'"')]))+
      '<div class="statement-actions">'+button('Previous applications','rules-previous-application',page===0,'data-statement-recovery="true"')+button('Next applications','rules-next-application',page+1>=pages,'data-statement-recovery="true"')+'</div></section>':'';
    return panel+history;
  }
  function redrawRules(){
    const panel=$('[aria-label="Recurring statement rules"]');if(!panel)return;
    const wasOpen=!!panel.querySelector('[data-rule-editor]')?.open;
    const work=session.classificationRules;
    panel.outerHTML=statementRulesPanel({library:work.library,editor:work.editor,selected:work.selected,review:work.review,
      draft:snapshot(),caseVersion:caseValue.program.version,query:work.query,appliedQuery:work.appliedQuery,filter:work.filter,page:work.page,rulePage:work.rulePage,open:caseValue.program.state==='OPEN'});
    if(wasOpen&&$('[data-rule-editor]'))$('[data-rule-editor]').open=true;controls();
  }
  function rulesEdition(){
    const work=session.classificationRules,edition=work.library.editions.find(value=>value.id+':'+value.revision===work.selected);
    if(!edition)throw new Error('Choose a complete saved rulebook edition.');return edition;
  }
  function captureRuleField(target){
    const key=target.name?.slice(5),work=session.classificationRules,editor=work.editor;
    const book={bookName:'name',accountId:'accountId',currency:'currency',bookNote:'note'};
    if(Object.hasOwn(book,key))editor[book[key]]=key==='currency'?target.value.toUpperCase():target.value;
    else if(Object.hasOwn(editor.rule,key))editor.rule[key]=key==='caseSensitive'?target.value==='true':target.value;
    else if(key==='query')work.query=target.value;
    schedulePersist();
  }
  async function ruleAction(action,target){
    const work=session.classificationRules;
    if(action==='rules-previous-application'){work.applicationPage=Math.max(0,work.applicationPage-1);return;}
    if(action==='rules-next-application'){work.applicationPage++;return;}
    if(action==='rules-application-export'){
      const item=work.applications[Number(target.dataset.application)];if(!item)throw new Error('Choose a retained classification application.');
      download(item,'statement-rule-application-'+target.dataset.application+'.json');return;
    }
    if(action==='rules-export'){download(work.library,'statement-rule-library-'+current.program.id+'.json');return;}
    if(action==='rules-download-review'){download(work.review,'statement-rule-review.json');return;}
    if(action==='rules-filter'){work.appliedQuery=work.query;work.page=0;return;}
    if(action==='rules-previous'){work.page=Math.max(0,work.page-1);return;}
    if(action==='rules-next'){work.page++;return;}
    if(caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.setupPending)
      throw new Error('Finish the original retained request in this open case before editing classification work.');
    if(['rules-new','rules-edit','rules-fork','rules-edit-rule','rules-put-rule','rules-remove-rule'].includes(action))session.rulesEditorOpen=true;
    if(action==='rules-import'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.addEventListener('change',()=>{void run(async()=>{
        const file=input.files?.[0];if(!file)return;if(file.size>64*1024*1024)throw new Error('Choose a complete rule library up to 64 MiB.');
        const incoming=JSON.parse(await file.text());
        if(session.pending||session.accepted||session.setupPending||caseValue.program.state!=='OPEN')throw new Error('Finish the original request before receiving a rule library.');
        session.classificationRules.library=mergeStatementRuleLibraries(session.classificationRules.library,incoming,current.program.id);
        await persist(true);session.notice='Received complete rulebook editions. Select and inspect their conditions before reviewing this statement.';
      });},{once:true});input.click();
    }else if(action==='rules-new'){
      work.editor=statementRuleEditor();work.editor.accountId=session.inputs.accountId;work.editor.currency=session.inputs.currency;work.rulePage=0;
    }else if(action==='rules-edit'||action==='rules-fork'){
      const edition=rulesEdition();work.editor=editStatementRulebook(edition);
      if(action==='rules-fork'){work.editor.id='';work.editor.expectedRevision=0;work.editor.name+=' copy';work.editor.accountId=session.inputs.accountId;work.editor.currency=session.inputs.currency;}
      work.rulePage=0;
    }else if(action==='rules-from-copy'){
      const selected=await selectedCopyEdition(),incoming=statementRuleWork(selected.draft.classificationRules,current.program.id);
      const library=mergeStatementRuleLibraries(work.library,incoming.library,current.program.id);
      if(!incoming.library.editions.length)throw new Error('The selected working-copy edition contains no saved classification rules.');
      work.library=library;session.notice='Received complete rule history from '+selected.name+' edition '+selected.revision+'. The current original file and row decisions are unchanged.';
      await persist(true);
    }else if(action==='rules-put-rule'){
      const value=clone(work.editor.rule);value.id=value.id||'statement-rule-'+crypto.randomUUID();
      const rule=validateStatementRule(value),index=work.editor.rules.findIndex(item=>item.id===rule.id);
      if(index<0){if(work.editor.rules.length>=100)throw new Error('Save at most 100 rules per edition.');work.editor.rules.push(rule);}
      else work.editor.rules[index]=rule;
      work.editor.rule=statementRuleEditor().rule;session.notice='Updated the unfinished rulebook. Save an immutable edition before reviewing a statement.';
    }else if(action==='rules-clear-rule')work.editor.rule=statementRuleEditor().rule;
    else if(action==='rules-edit-rule'){
      const rule=work.editor.rules.find(value=>value.id===target.dataset.ruleId);if(!rule)throw new Error('Choose an original rule in this unfinished edition.');
      work.editor.rule=clone(rule);
    }else if(action==='rules-remove-rule'){
      work.editor.rules=work.editor.rules.filter(value=>value.id!==target.dataset.ruleId);
      if(work.editor.rule.id===target.dataset.ruleId)work.editor.rule=statementRuleEditor().rule;
    }else if(action==='rules-previous-editor')work.rulePage=Math.max(0,work.rulePage-1);
    else if(action==='rules-next-editor')work.rulePage++;
    else if(action==='rules-save'){
      batchReady();const before=clone(work);
      const result=saveStatementRulebook(work.library,snapshot(),work.editor,{id:'statement-rulebook-'+crypto.randomUUID(),actor:recordingActor(),savedAt:new Date().toISOString(),caseVersion:caseValue.program.version});
      work.library=result.library;work.selected=result.edition.id+':'+result.edition.revision;work.editor=editStatementRulebook(result.edition);
      try{await saveCopy({note:'Saved classification rulebook '+result.edition.name+' edition '+result.edition.revision});}
      catch(error){session.classificationRules=before;throw error;}
      session.notice='Saved '+result.edition.name+' edition '+result.edition.revision+' in its complete named working-copy edition. Review this statement before applying any rule.';
      await persist(true);
    }else if(action==='rules-review'){
      batchReady();work.review=prepareStatementRuleReview(snapshot(),rulesEdition(),caseValue.program.version);work.page=0;
      session.notice='Compared every original source row. Choose one matching rule per selected row; protected and unselected rows keep their current decisions.';
      await persist(true);
    }else if(action==='rules-unambiguous'||action==='rules-clear-choices'){
      batchReady();
      if(!statementRuleReviewCurrent(work.review,snapshot(),caseValue.program.version)||JSON.stringify(work.review.edition)!==JSON.stringify(rulesEdition()))throw new Error('Review the current draft with the selected rulebook before choosing rows.');
      if(action==='rules-unambiguous')work.review=chooseUnambiguousStatementRules(work.review);else work.review.choices={};
      await persist(true);
    }else if(action==='rules-apply'){
      batchReady();if(work.applications.length>=1000)throw new Error('Save this complete working copy and start a following copy before adding more than 1,000 retained applications.');
      const before=snapshot(),result=applyStatementRuleReview(before,rulesEdition(),work.review,caseValue.program.version);
      await preserveCurrentCopy('Before applying selected classification rules');
      // Copy metadata can advance during preservation; original financial interpretation cannot.
      const now=snapshot();for(const key of ['workingCopyId','copyName'])now[key]=before[key];
      if(JSON.stringify(now)!==JSON.stringify(before))throw new Error('The current source work changed while preserving it. Review the rule recommendations again.');
      session.inputs.decisions=result.decisions;
      work.applications.push({...result.application,actor:recordingActor(),appliedAt:new Date().toISOString()});
      changed();session.notice='Applied '+result.application.applied.length+' selected rule decisions to the original draft. Preview the updated rows before importing.';
      await persist(true);
    }else if(action==='rules-persist'){
      await saveCopy({note:'Saved complete recurring classification work and unfinished review'});
      await persist(true);
    }
  }

  function batchReady(){
    if(caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.setupPending||session.dirty||!session.preview)
      throw new Error('Preview the current open case and finish its retained request before editing selected rows.');
  }
  function batchPage(){
    return statementBatchPanel({preview:session.preview,selected:session.batchSelection,options:session.batchChange,
      proposal:session.batchProposal,undo:session.batchUndo,dirty:session.dirty,page:session.batchReviewPage,open:caseValue.program.state==='OPEN'});
  }
  function redrawBatch(){
    const panel=$('[aria-label="Review selected statement rows"]');if(panel){panel.outerHTML=batchPage();controls();}
  }
  function selectBatch(numbers){
    batchReady();
    session.batchSelection=statementSelection(session.preview,[...new Set([...session.batchSelection,...numbers])]).map(row=>row.rowNumber);
    session.batchProposal=null;session.batchReviewPage=0;schedulePersist();
  }
  async function batchAction(action){
    if(action==='batch-cancel'){session.batchProposal=null;return;}
    if(action==='batch-export'){download(session.batchProposal,'statement-selected-row-changes.json');return;}
    if(action==='batch-previous'){session.batchReviewPage=Math.max(0,session.batchReviewPage-1);return;}
    if(action==='batch-next'){session.batchReviewPage++;return;}
    if(action==='batch-undo'){
      if(caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.setupPending)throw new Error('Finish the retained request before editing rows.');
      const restored=undoStatementBatch(session.preview,session.inputs,session.batchUndo);
      session.inputs.decisions=restored;changed();session.notice='Restored the exact row decisions from before the last group change. Preview again to review them.';await persist();return;
    }
    batchReady();
    if(action==='batch-page'||action==='batch-matching'){
      const rows=statementMatchingRows(session.preview,session.status,session.appliedQuery);
      const picked=action==='batch-page'?rows.slice(session.page*pageSize,(session.page+1)*pageSize):rows;
      selectBatch(picked.map(row=>row.rowNumber));return;
    }
    if(action==='batch-clear'){session.batchSelection=[];session.batchProposal=null;return;}
    if(action==='batch-prepare'){
      session.batchProposal=prepareStatementBatch(session.preview,session.inputs,session.batchSelection,session.batchChange);
      session.batchReviewPage=0;return;
    }
    if(action==='batch-apply'){
      const proposal=session.batchProposal,result=applyStatementBatch(session.preview,session.inputs,proposal);
      session.inputs.decisions=result.decisions;session.batchUndo=result.undo;session.batchProposal=null;session.batchSelection=[];
      changed(true);session.notice='Applied '+proposal.changes.length+' explicit row decisions to this draft. Preview updated decisions to review native classifications and balances before importing.';await persist();
    }
  }
  function rowState(row){return {rowNumber:row.rowNumber,action:row.action||'IMPORT',category:row.category,tranche:row.tranche,allocations:row.allocations||[],...rowDecision(row.rowNumber)};}
  function rowTable(){
    const preview=session.preview;if(!preview)return '';
    const filtered=statementMatchingRows(preview,session.status,session.appliedQuery);
    const pages=Math.max(1,Math.ceil(filtered.length/pageSize));session.page=Math.min(session.page,pages-1);
    const rows=filtered.slice(session.page*pageSize,(session.page+1)*pageSize);
    return '<div class="statement-review-controls">'+
      field('Review status','reviewStatus',session.status,{options:[['ALL','All rows'],...Object.entries(statuses)]})+
      field('Find reference, description or row','reviewQuery',session.query)+
      '<div class="statement-page">'+button('Apply filter','filter')+button('Previous','previous',session.page===0)+'<span>Page '+(session.page+1)+' of '+pages+' · '+filtered.length+' rows</span>'+button('Next','next',session.page+1>=pages)+'</div></div>'+
      batchPage()+
      (rows.length?table(['Select','Source row / reference','Date / description','Movement','Cash classification','Review / action'],rows.map(row=>{
        const decision=rowState(row),unchanged=row.status==='EXISTING',category=decision.category||row.category;
        return [
          '<label class="statement-batch-check"><input type="checkbox" data-statement-row-select="'+row.rowNumber+'" aria-label="Select source row '+row.rowNumber+'"'+(session.batchSelection.includes(row.rowNumber)?' checked':'')+(session.dirty||caseValue.program.state!=='OPEN'?' disabled data-statement-fixed="true"':'')+'>Select</label>',
          '<strong>Row '+esc(row.rowNumber)+'</strong><small>'+esc(row.reference||'Missing reference')+'</small>'+(row.sourceLine!==undefined?'<small>Original source line '+esc(row.sourceLine)+'</small>':'')+(row.providerReference?'<small>Provider reference '+esc(row.providerReference)+'</small>':''),
          esc(row.date||'—')+'<small>'+esc(row.description||'')+'</small>',
          esc(label(row.direction))+' '+amount(row.amount,row.currency)+(row.currency!=='USD'?'<small>Recorded value: '+amount(row.usdValue,'USD')+'</small>':''),
          '<label>Category<select data-row-category="'+row.rowNumber+'"'+(unchanged?' disabled data-statement-fixed="true"':'')+'>'+categories.map(value=>'<option value="'+value+'"'+(category===value?' selected':'')+'>'+esc(label(value))+'</option>').join('')+'</select></label>'+
          '<label>Tranche<select data-row-tranche="'+row.rowNumber+'"'+(unchanged?' disabled data-statement-fixed="true"':'')+'>'+[['','Unassigned'],['0','0'],['1','1'],['2','2'],['3','3']].map(([value,text])=>'<option value="'+value+'"'+(String(decision.tranche??'')===value?' selected':'')+'>'+text+'</option>').join('')+'</select></label>'+
          button('Invoice allocations','allocations',unchanged,'data-row="'+row.rowNumber+'"')+'<small>'+esc((decision.allocations||row.allocations||[]).length)+' linked invoice allocations</small>',
          '<span class="statement-status">'+esc(statuses[row.status]||row.status)+'</span>'+
          (row.problems||[]).map(problem=>'<small>'+esc(problem)+'</small>').join('')+
          '<label>Use row<select data-row-action="'+row.rowNumber+'"><option value="IMPORT"'+(decision.action!=='EXCLUDE'?' selected':'')+'>Include in review</option><option value="EXCLUDE"'+(decision.action==='EXCLUDE'?' selected':'')+'>Exclude</option></select></label>'+
          '<label>Reason / note<input data-row-reason="'+row.rowNumber+'" value="'+esc(decision.reason||'')+'"></label>'+
          (row.corrected?'<small>Reconciled through the original cash correction.</small>':'')+(row.recordId?detail('Existing cash record',{recordId:row.recordId,...(row.corrected?{originalRecordId:row.originalRecordId,correctionSourceIds:row.correctionSourceIds,current:row.correctedRecord}: {})}):'')+(row.nativeIdentity?detail('Original movement fields',{sourceLine:row.sourceLine,identityBasis:row.identityBasis,providerReference:row.providerReference,identity:row.nativeIdentity}):'')
        ];
      })):'<p class="statement-empty">No statement rows match this filter.</p>');
  }
  function allocationWork(){return session.allocationWorks[String(session.allocationRow)]||null;}
  function clearAllocationProposals(){for(const work of Object.values(session.allocationWorks))work.proposal=null;}
  function clearAllocations(){session.allocationRow=null;session.allocationWorks={};}
  function allocationReady(){
    if(caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.setupPending||session.dirty||!session.preview||session.preview.expectedVersion!==caseValue.program.version)
      throw new Error('Preview this current open case and finish its retained request before reviewing allocations.');
    const work=allocationWork();
    if(!work||!sameStatementAllocationBasis(work.basis,statementAllocationBasis(session.preview,session.allocationRow)))
      throw new Error('The saved working copy belongs to an earlier row interpretation. Download it or start from the current preview.');
    return work;
  }
  function newAllocationWork(number){
    const row=session.preview?.rows.find(item=>item.rowNumber===number);
    if(!row||row.status==='EXISTING')throw new Error('Choose a current source row that has not already been recorded.');
    return {rowNumber:number,basis:statementAllocationBasis(session.preview,number),
      allocations:clone(rowDecision(number)?.allocations||row.allocations||[]),reason:'',query:'',appliedQuery:'',filter:'OPEN',page:0,inspectId:'',proposal:null};
  }
  function allocationPage(){
    if(session.allocationRow===null)return '';
    const work=allocationWork();if(!work)return '';
    const row=session.preview?.rows.find(item=>item.rowNumber===session.allocationRow);
    if(!row)return '<section class="statement-panel statement-allocation-panel"><h4>Retained allocation working copy</h4><p>This source row is absent from the current preview. Its working copy is retained.</p>'+button('Download allocation working copy','allocation-export',false,'data-statement-recovery="true"')+button('Close allocation editor','close-allocations')+'</section>';
    const basisMatches=sameStatementAllocationBasis(work.basis,statementAllocationBasis(session.preview,session.allocationRow));
    const context=statementAllocationContext(caseValue,session.preview,session.inputs,session.allocationRow);
    const stale=session.dirty||session.preview.expectedVersion!==caseValue.program.version||!basisMatches||row.status==='EXISTING';
    const prefix=!basisMatches?'<p class="statement-notice">This working copy retains an earlier original row interpretation. Download it before replacing its allocations.</p>'+button('Start from current preview','allocation-restart',!editable()||session.dirty):'';
    return statementAllocationPanel(context,work,{editable:editable(),stale,canDownload:typeof api==='function'}).replace('<h4>',()=>prefix+'<h4>');
  }
  function redrawAllocations(){
    const panel=$('.statement-allocation-panel');
    if(panel){panel.outerHTML=allocationPage();controls();}
  }
  function restoreAllocationWorks(saved){
    const result={};
    if(saved?.allocationWorks&&typeof saved.allocationWorks==='object'&&!Array.isArray(saved.allocationWorks)){
      for(const [key,value] of Object.entries(saved.allocationWorks).slice(0,5000)){
        if(!value||!Number.isInteger(value.rowNumber)||String(value.rowNumber)!==key||!value.basis||!Array.isArray(value.allocations)||value.allocations.length>200)continue;
        if(value.allocations.some(row=>!row||typeof row.invoiceId!=='string'||row.invoiceId.length>300||typeof row.amountUsd!=='string'||row.amountUsd.length>100))continue;
        result[key]={rowNumber:value.rowNumber,basis:clone(value.basis),allocations:clone(value.allocations),reason:String(value.reason||'').slice(0,4000),
          query:String(value.query||'').slice(0,1000),appliedQuery:String(value.appliedQuery||'').slice(0,1000),filter:['OPEN','MATCHES','ALL'].includes(value.filter)?value.filter:'OPEN',
          page:Number.isInteger(value.page)&&value.page>=0?value.page:0,inspectId:String(value.inspectId||''),proposal:null};
      }
    }
    session.allocationWorks=result;session.allocationRow=Object.hasOwn(result,String(saved?.allocationRow))?saved.allocationRow:null;
  }
  async function allocationAction(action,target){
    const work=allocationWork();
    if(action==='allocation-export'){download({schema:'sf47.statement-allocation-working-copy.v1',caseId:current.program.id,work:clone(work)},'statement-allocation-working-copy.json');return;}
    if(action==='allocation-review-export'){download(work?.proposal,'statement-allocation-review.json');return;}
    if(action==='allocation-source'){
      const id=target.dataset.source,source=caseValue.sources.find(item=>item.id===id);
      if(!source||typeof api!=='function')throw new Error('The original invoice source is unavailable in this case.');
      const response=await api(prefix+'/sources/'+encodeURIComponent(id),undefined,{download:true});
      download(await response.blob(),source.filename||id);return;
    }
    if(!work)throw new Error('Open an original statement row before allocating.');
    if(action==='allocation-inspect'){work.inspectId=target.dataset.invoice;return;}
    if(action==='allocation-filter'){work.appliedQuery=work.query;work.page=0;return;}
    if(action==='allocation-previous'){work.page=Math.max(0,work.page-1);return;}
    if(action==='allocation-next'){work.page++;return;}
    if(action==='allocation-restart'){
      if(session.dirty||caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.setupPending)throw new Error('Preview the current open case before starting its allocations.');
      download({schema:'sf47.statement-allocation-working-copy.v1',caseId:current.program.id,work:clone(work)},'statement-previous-allocation-working-copy.json');
      session.allocationWorks[String(session.allocationRow)]=newAllocationWork(session.allocationRow);return;
    }
    allocationReady();
    const context=statementAllocationContext(caseValue,session.preview,session.inputs,session.allocationRow);
    if(action==='allocation-add'){
      const id=target.dataset.invoice;
      if(!context.invoices.some(item=>item.id===id)||work.allocations.some(item=>item.invoiceId===id)||work.allocations.length>=200)throw new Error('Choose a retained invoice once, up to 200 allocations.');
      work.allocations.push({invoiceId:id,amountUsd:''});work.proposal=null;
    }else if(action==='allocation-remove'){
      const index=Number(target.dataset.index);
      if(!Number.isInteger(index)||index<0||index>=work.allocations.length)throw new Error('Choose an existing allocation.');
      work.allocations.splice(index,1);work.proposal=null;
    }else if(action==='allocation-remaining'){
      const item=work.allocations.find(row=>row.invoiceId===target.dataset.invoice);if(!item)throw new Error('Select this invoice first.');
      item.amountUsd=statementAllocationSuggestedAmount(context,work.allocations,item.invoiceId);work.proposal=null;
    }else if(action==='allocation-review'){
      work.proposal=prepareStatementAllocations(caseValue,session.preview,session.inputs,session.allocationRow,work.allocations,work.reason);
    }else if(action==='allocation-apply'){
      const proposal=work.proposal;
      session.inputs.decisions=applyStatementAllocations(caseValue,session.preview,session.inputs,proposal);
      delete session.allocationWorks[String(session.allocationRow)];session.allocationRow=null;changed();
      session.notice='Applied the reviewed invoice allocations and reason to this draft. Preview updated decisions before importing the original cash movement.';
      await persist();
    }
  }
  function reviewPage(){
    const preview=session.preview;if(!preview)return '';
    const summary=preview.summary,balance=preview.balance,currency=preview.source.currency;
    const totalCards=[['New records',summary.newCount,'From this reviewed selection'],['Already recorded',summary.existingCount,'Original identities retained'],['Excluded',summary.excludedCount,'Rows left out of import'],['Needs correction',summary.conflictCount,'Resolve or explicitly exclude']];
    const balances={MATCH:'Balances match',MISMATCH:'Balance difference to resolve',NOT_PROVIDED:'Opening and closing balances not supplied',UNAVAILABLE:'Balance comparison unavailable'};
    return '<section class="statement-panel"><h4>4. Review the cash movements</h4>'+
      '<p data-statement-stale class="statement-notice"'+(session.dirty?'':' hidden')+'>The mapping, row decisions or case version changed. Preview again to update this review before importing.</p>'+
      '<div class="statement-summary">'+totalCards.map(([name,value,help])=>'<div><span>'+name+'</span><strong>'+esc(value)+'</strong><small>'+help+'</small></div>').join('')+'</div>'+
      '<p><strong>Statement inflow:</strong> '+amount(summary.inflow,currency)+' · <strong>Outflow:</strong> '+amount(summary.outflow,currency)+' · <strong>Net movement:</strong> '+amount(summary.net,currency)+'</p>'+
      '<p><strong>New cash to import:</strong> '+amount(summary.importInflow,currency)+' in · '+amount(summary.importOutflow,currency)+' out.</p>'+
      '<div class="statement-notice"><strong>'+esc(balances[balance.status]||balance.status)+'</strong>'+
      (balance.status==='NOT_PROVIDED'?'':'<p>Opening '+amount(balance.openingBalance,currency)+' · Calculated closing '+amount(balance.calculatedBalance,currency)+' · Source closing '+amount(balance.closingBalance,currency)+' · Difference '+amount(balance.difference,currency)+'</p>')+'</div>'+
      (preview.findings?.length?'<ul>'+preview.findings.map(finding=>'<li>'+esc(finding.rowNumber?'Row '+finding.rowNumber+': ':'')+esc(finding.message)+'</li>').join('')+'</ul>':'')+
      (preview.bank?'<div class="statement-native-selection"><strong>'+esc(preview.bank.sourceFormat)+' original account:</strong> '+esc(preview.bank.accountReference)+'<p>'+esc(preview.bank.pendingCount)+' pending observations retained in the original report.</p>'+(preview.bank.findings?.length?'<ul>'+preview.bank.findings.map(item=>'<li>'+esc(label(item.severity))+': '+esc(item.message)+'</li>').join('')+'</ul>':'')+detail('Original native account and balance interpretation',preview.bank)+'</div>':'')+
      rowTable()+allocationPage()+
      '<label class="statement-confirm"><input type="checkbox" data-statement-confirm'+(session.confirmed?' checked':'')+'>I reviewed the account, currency, source rows and cash classifications shown above.</label>'+
      '<div class="statement-actions">'+button('Preview updated decisions','preview')+button('Import reviewed cash movements','import',!preview.canImport||session.dirty||!session.confirmed,'class="statement-primary" data-statement-write="true"')+button('Download review','review-export',false,'data-statement-recovery="true"')+'</div>'+
      detail('Original source and review identity',{source:preview.source,caseId:preview.caseId,caseVersion:preview.expectedVersion,previewSha256:preview.previewSha256})+'</section>';
  }
  async function openOriginalInputs(){
    const selected=session.originalInputHandoff;if(!selected)return;
    if(session.pending||session.accepted||session.setupPending||session.inflight)throw new Error('Resume the retained original import before opening the selected source. Both complete inputs remain saved.');
    if(selected.caseId!==current.program.id||!selected.inputs?.source?.contentBase64||!draftInput(selected.inputs,true))throw new Error('The selected original statement needs its complete source bytes and interpretation in this case.');
    if(selected.inputs.source.contentBase64.length>(maximumSource+2)*4/3+16)throw new Error('The selected original statement exceeds the native 8 MiB source size.');
    const incoming=editingInput(selected.inputs),headers=bankFormat(incoming)?[]:statementHeaders(sourceText(incoming.source.contentBase64),incoming.format.delimiter);
    if(source()&&JSON.stringify(session.inputs)!==JSON.stringify(incoming))await preserveCurrentCopy('Before opening the retained original source');
    session.workingCopyId=null;session.copyName='';session.copyNote='';session.copyReview=null;
    session.inputs=incoming;session.headers=headers;session.inspection=null;session.nativeScalesText=scaleText(incoming.statementOptions?.currencyScales);
    clearBatch();session.batchChange={mode:'CLASSIFY',category:'',tranche:'KEEP',reason:''};session.optionsError='';session.preview=null;session.dirty=true;session.confirmed=false;session.editRevision++;
    session.page=0;session.status='ALL';session.query='';session.appliedQuery='';clearAllocations();
    session.originalInputHandoff=null;
    await persist();
    if(native())await inspect();
    session.notice='Opened the exact retained statement source and original interpretation. Review corrections against the current case.';
    await persist();
  }
  function originalInputPage(){
    const selected=session.originalInputHandoff;if(!selected)return '';
    return '<section class="statement-panel"><h4>Selected original statement</h4><p>'+esc(selected.inputs?.source?.filename||selected.statementSourceId||'Original source')+' is retained with its complete original interpretation.</p>'+(selected.inputs?.statementSetup?'<p>Saved setup: <strong>'+esc(selected.inputs.statementSetup.name)+'</strong> · edition '+esc(selected.inputs.statementSetup.revision)+'.</p>':'')+'<div class="statement-actions">'+
      button('Open selected original statement','original-input',!!(session.pending||session.accepted||session.setupPending||session.inflight))+
      button('Download selected original inputs','original-input-export',false,'data-statement-recovery="true"')+'</div></section>';
  }
  async function refreshCopies(){
    session.copyIndex=await copyStore.readIndex();session.copyLoaded=true;
    const activeCopy=session.copyIndex.copies.find(row=>row.id===session.workingCopyId);
    if(!activeCopy)session.workingCopyId=null;
    else if(!session.copyName)session.copyName=activeCopy.name;
  }
  function copyIdentity(){return 'statement-copy-'+crypto.randomUUID();}
  function copyName(){return (session.copyName||[session.inputs.accountLabel||session.inputs.accountId,source()?.filename].filter(Boolean).join(' · ')||'Statement working copy').slice(0,160);}
  async function saveCopy({fresh=false,note=session.copyNote}={}){
    if(!session.copyLoaded)await refreshCopies();
    const id=!fresh&&session.workingCopyId?session.workingCopyId:copyIdentity();
    const result=await copyStore.save({id,expectedRevision:session.copyIndex.revision,name:copyName(),note,savedAt:new Date().toISOString(),draft:snapshot()});
    session.copyIndex=result.index;session.workingCopyId=id;session.copyName=result.edition.name;session.copyReview=null;
    session.notice='Saved '+result.edition.name+' · complete edition '+result.edition.revision+'.';
    await persist();
    return result.edition;
  }
  async function preserveCurrentCopy(note){
    if(!source()&&!session.pending&&!session.accepted&&!session.setupPending)return;
    await saveCopy({note});
  }
  function restoreRecipientWork(saved){
    session.classificationRules=statementRuleWork(saved.classificationRules,current.program.id);
    const worklist=statementReviewWorklist(saved,current.program.id);
    session.recipientName=String(saved.recipientName||'').slice(0,160);session.recipientRole=String(saved.recipientRole||'').slice(0,160);
    session.recipientPackets=Array.isArray(saved.recipientPackets)?clone(saved.recipientPackets):[];
    session.recipientReturn=saved.recipientReturn?clone(saved.recipientReturn):null;session.recipientHistory=Array.isArray(saved.recipientHistory)?clone(saved.recipientHistory):[];
    session.recipientWorklist=worklist;session.recipientWorkQuery=session.recipientWorklist.query;
    session.recipientReturn=clone(selectedStatementReview(session.recipientWorklist)?.returned||null);
    session.recipientComparison=null;session.recipientChoices={};session.recipientPage=0;session.recipientWorkPage=0;session.recipientIssuedPage=0;session.recipientWorkStale='';
  }
  function invalidateRecipientComparison(){
    session.recipientComparison=null;session.recipientChoices={};
    if(selectedStatementReview(session.recipientWorklist)?.comparison)session.recipientWorkStale='The current draft changed. Your earlier choices are retained; compare again before applying.';
  }
  function putRecipientWork(entry){session.recipientWorklist=replaceStatementReviewWork(session.recipientWorklist,entry);}
  function recipientWorkBasis(){return statementReviewBasis(snapshot(),caseValue.program.version);}
  async function resumeRecipientWork(){
    const entry=selectedStatementReview(session.recipientWorklist);
    session.recipientReturn=clone(entry?.returned||null);session.recipientComparison=null;session.recipientChoices={};session.recipientWorkStale='';
    if(!entry?.comparison||entry.phase==='APPLIED')return;
    try{
      const {packet,edition}=await recipientSource(entry.returned);
      if(selectedStatementReview(session.recipientWorklist)?.id!==entry.id)return;
      const comparison=compareStatementRecipientReturn(packet,edition,snapshot(),entry.returned);
      if(!statementReviewComparisonCurrent(entry,comparison,recipientWorkBasis()))throw new Error('The draft or case changed since these choices were saved. Compare again; earlier choices remain available below.');
      session.recipientComparison=comparison;session.recipientChoices=clone(entry.choices);
    }catch(error){session.recipientWorkStale=error.message||String(error);}
  }
  function redrawRecipientWork(){
    const panel=$('[aria-label="Returned review worklist"]');if(panel)panel.outerHTML=recipientWorkPage();
    const review=$('[aria-label="Accountant recipient review"]');if(review)review.outerHTML=recipientPage();
  }
  function recipientWorkPage(){return statementReviewWorklistPanel({worklist:session.recipientWorklist,packets:session.recipientPackets,page:session.recipientWorkPage,issuedPage:session.recipientIssuedPage,comparisonPage:session.recipientPage,stale:session.recipientWorkStale,comparisonReady:!!session.recipientComparison});}
  function recipientPage(){
    return statementRecipientPanel({recipient:{name:session.recipientName,role:session.recipientRole},packets:session.recipientPackets,returned:session.recipientReturn,comparison:session.recipientComparison,choices:session.recipientChoices,page:session.recipientPage,notice:session.recipientHistory.length+' applied review decisions retained.',invoices:session.recipientPackets.find(p=>p.id===session.recipientReturn?.packetId)?.invoices||[]});
  }
  function recipientReady(){
    if(session.pending||session.accepted||session.setupPending||session.inflight)throw new Error('Finish the retained original request before recipient review.');
    if(caseValue.program.state!=='OPEN')throw new Error('Open this original case before applying statement review.');
  }
  function recipientActor(){const actor=typeof recordingActor==='function'?recordingActor():recordingActor;return String(actor?.name||actor||pinnedContext?.name||pinnedContext?.staffId||'Preparing operator');}
  async function recipientSource(returned=session.recipientReturn){
    const packet=session.recipientPackets.find(value=>value.id===returned?.packetId);
    if(!packet)throw new Error('Open the complete original working-copy archive containing this issued review first.');
    const edition=await copyStore.readEdition(packet.edition.id,packet.edition.revision);
    return {packet,edition};
  }
  async function recipientAction(action,target){
    if(action.startsWith('recipient-work-')){
      if(action==='recipient-work-save'){session.notice='Saved the complete returned-review progress in this original working draft.';}
      else if(action==='recipient-work-filter'){session.recipientWorklist.query=session.recipientWorkQuery;session.recipientWorkPage=0;session.recipientIssuedPage=0;}
      else if(action==='recipient-work-clear'){session.recipientWorkQuery='';session.recipientWorklist.query='';session.recipientWorklist.filter='ALL';session.recipientWorkPage=0;session.recipientIssuedPage=0;}
      else if(action==='recipient-work-previous')session.recipientWorkPage=Math.max(0,session.recipientWorkPage-1);
      else if(action==='recipient-work-next')session.recipientWorkPage++;
      else if(action==='recipient-work-issued-previous')session.recipientIssuedPage=Math.max(0,session.recipientIssuedPage-1);
      else if(action==='recipient-work-issued-next')session.recipientIssuedPage++;
      else if(action==='recipient-work-choice-previous')session.recipientPage=Math.max(0,session.recipientPage-1);
      else if(action==='recipient-work-choice-next')session.recipientPage++;
      else if(action==='recipient-work-select'){
        const entry=session.recipientWorklist.entries.find(value=>value.id===target.dataset.reviewWorkId);
        if(!entry)throw new Error('Choose a retained return from this worklist.');
        session.recipientWorklist.selectedId=entry.id;session.recipientPage=0;await resumeRecipientWork();
      }else if(action==='recipient-work-return'){download(selectedStatementReview(session.recipientWorklist)?.returned,'statement-recipient-return.json');}
      else if(action==='recipient-work-issued'){
        const packet=session.recipientPackets.find(value=>value.id===target.dataset.reviewPacketId);
        if(!packet)throw new Error('Choose an original issued review.');
        const edition=await copyStore.readEdition(packet.edition.id,packet.edition.revision);
        // The issued packet must still resolve to its complete trusted local edition.
        validateStatementRecipientPacket(packet,edition);
        download(statementRecipientReviewHTML(packet),packet.id+'-offline-review.html','text/html');
      }
      await persist(true);return;
    }
    if(action==='recipient-download-return'){download(session.recipientReturn,'statement-recipient-return.json');return;}
    if(action==='recipient-previous'){session.recipientPage=Math.max(0,session.recipientPage-1);return;}
    if(action==='recipient-next'){session.recipientPage++;return;}
    recipientReady();
    if(action==='recipient-export'){
      if(session.dirty||!session.preview||session.preview.expectedVersion!==caseValue.program.version)throw new Error('Preview the current original statement before preparing the offline review.');
      if(!session.recipientName.trim()||!session.recipientRole.trim())throw new Error('Enter the intended recipient’s name and role.');
      const edition=await saveCopy({note:'Original edition issued for '+session.recipientName});
      const packet=prepareStatementRecipientPacket(edition,caseValue,{id:'statement-review-'+crypto.randomUUID(),recipient:{name:session.recipientName,role:session.recipientRole},issuedBy:{name:recipientActor(),id:String(pinnedContext?.staffId||'')},issuedAt:new Date().toISOString()});
      session.recipientPackets.push(packet);await resumeRecipientWork();
      await persist(true);
      download(statementRecipientReviewHTML(packet),packet.id+'-offline-review.html','text/html');
      session.notice='Saved the original edition and downloaded the complete offline reviewer. Its returned file will be compared against this retained source.';
    }else if(action==='recipient-import'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.addEventListener('change',()=>{void run(async()=>{
        recipientReady();const file=input.files?.[0];if(!file)return;if(file.size>64*1024*1024)throw new Error('Choose a complete returned review up to 64 MiB.');
        const returned=JSON.parse(await file.text()),{packet,edition}=await recipientSource(returned);
        const checked=receiveStatementRecipientReturn(packet,edition,returned),received=receiveStatementReviewWork(session.recipientWorklist,checked,{id:'statement-return-'+crypto.randomUUID(),receivedAt:new Date().toISOString()});
        session.recipientWorklist=received.worklist;session.recipientPage=0;session.recipientWorkPage=0;await resumeRecipientWork();
        await persist(true);session.notice=received.duplicate?'Opened the same retained return and its saved progress.':'Retained this complete attributed return alongside the earlier returns. Compare it with the original edition and current draft.';
      });},{once:true});input.click();
    }else if(action==='recipient-compare'){
      const {packet,edition}=await recipientSource();
      const comparison=compareStatementRecipientReturn(packet,edition,snapshot(),session.recipientReturn);
      const entry=startStatementReviewComparison(selectedStatementReview(session.recipientWorklist),comparison,recipientWorkBasis(),new Date().toISOString());
      putRecipientWork(entry);session.recipientChoices=clone(entry.choices);session.recipientPage=0;session.recipientComparison=comparison;session.recipientWorkStale='';await persist(true);
      session.notice='Compared every returned recommendation with its issued edition and current original draft. Choose explicitly for each changed field.';
    }else if(action==='recipient-apply'){
      const {packet,edition}=await recipientSource(),currentDraft=snapshot();
      const entry=selectedStatementReview(session.recipientWorklist),comparison=compareStatementRecipientReturn(packet,edition,currentDraft,session.recipientReturn);
      if(!statementReviewComparisonCurrent(entry,comparison,statementReviewBasis(currentDraft,caseValue.program.version)))throw new Error('The original draft or case changed. Compare this retained return again before applying its choices.');
      const applied=applyStatementRecipientReturn(packet,edition,currentDraft,comparison,entry.choices,{actor:recipientActor(),appliedAt:new Date().toISOString()});
      await saveCopy({note:'Before applying returned recommendations from '+session.recipientReturn.reviewer.name});
      // Saving updates copy labels only. The reviewed source, decisions and request state must still be exact.
      const afterSave=snapshot();for(const key of ['workingCopyId','copyName'])afterSave[key]=currentDraft[key];
      if(JSON.stringify(afterSave)!==JSON.stringify(currentDraft))throw new Error('The draft changed while preserving its edition. Compare the return again.');
      session.inputs=editingInput(applied.draft.inputs);session.recipientHistory=clone(applied.draft.recipientHistory);putRecipientWork(recordStatementReviewApplication(entry,applied.receipt));session.recipientWorkStale='';
      restoreAllocationWorks(applied.draft);session.batchUndo=null;session.batchSelection=[];session.recipientComparison=null;session.recipientChoices={};
      session.editRevision++;session.dirty=true;session.confirmed=false;session.page=0;
      await persist(true);await saveCopy({note:'Selected recipient recommendations applied; native re-preview required'});
      session.notice='Applied '+applied.receipt.selected.length+' selected fields. Review the original source with the existing native preview before importing any cash.';
    }
  }
  function copiesPage(){
    return statementCopiesPanel({index:session.copyIndex,query:session.copyQuery,appliedQuery:session.copyAppliedQuery,page:session.copyPage,name:session.copyName,note:session.copyNote,
      activeId:session.workingCopyId,review:session.copyReview,selectedId:session.copySelectedId,selectedRevision:session.copySelectedRevision,detailPage:session.copyDetailPage});
  }
  async function selectedCopyEdition(){
    const row=session.copyIndex.copies.find(value=>value.id===session.copySelectedId),revision=session.copySelectedRevision;
    if(!row||!Number.isSafeInteger(revision)||revision<1||revision>row.revision)throw new Error('Choose an available complete saved edition.');
    return copyStore.readEdition(row.id,revision);
  }
  async function copyAction(action,target){
    if(action==='copies-new'||action==='copies-save'){
      if(!source())throw new Error('Open an original statement before saving its complete working copy.');
      if(action==='copies-save'&&!session.workingCopyId)throw new Error('Save a new named copy first.');
      await saveCopy({fresh:action==='copies-new'});session.copyNote='';
    }else if(action==='copies-refresh'){
      await refreshCopies();session.copyReview=null;session.notice='Read the complete current saved-copy list. Your open source and edits are preserved.';
    }else if(action==='copies-filter'){session.copyAppliedQuery=session.copyQuery;session.copyPage=0;}
    else if(action==='copies-previous')session.copyPage=Math.max(0,session.copyPage-1);
    else if(action==='copies-next')session.copyPage++;
    else if(action==='copies-select'){
      const row=session.copyIndex.copies.find(value=>value.id===target.dataset.copyId);
      if(!row)throw new Error('Refresh the saved-copy list to select this copy.');
      session.copySelectedId=row.id;session.copySelectedRevision=row.revision;session.copyReview=null;
    }else if(action==='copies-review'){
      if(session.pending||session.accepted||session.setupPending)throw new Error('Finish the current original request before opening another statement. You can save and download its complete copy meanwhile.');
      session.copyDetailPage=0;session.copyReview=compareStatementCopy(snapshot(),await selectedCopyEdition());
    }else if(action==='copies-details-previous')session.copyDetailPage=Math.max(0,session.copyDetailPage-1);
    else if(action==='copies-details-next')session.copyDetailPage++;
    else if(action==='copies-cancel')session.copyReview=null;
    else if(action==='copies-open'){
      const review=session.copyReview;
      if(!review||JSON.stringify(review.current)!==JSON.stringify(snapshot()))throw new Error('The current work changed. Review the selected edition again before opening it.');
      const selected=await selectedCopyEdition();
      if(JSON.stringify(review.edition)!==JSON.stringify(selected))throw new Error('The selected edition changed. Review it again before opening.');
      await importDraft(new File([JSON.stringify(selected.draft)],'statement-working-copy.json',{type:'application/json'}),{selectedCopy:selected});
      session.notice='Opened '+selected.name+' · edition '+selected.revision+'. The prior complete work is saved; preview this edition against the current case.';
    }else if(action==='copies-download'){
      const edition=await selectedCopyEdition();
      download(edition.draft,edition.id+'-edition-'+edition.revision+'-recovery.json');
    }else if(action==='copies-export'){
      await preserveCurrentCopy(session.copyNote||'Current complete work at archive download');
      download(await copyStore.exportArchive(),'statement-working-copies-'+current.program.id+'.json');
      session.notice='Downloaded every complete saved edition and the current work for this case.';
    }else if(action==='copies-import'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.addEventListener('change',()=>{void run(async()=>{
        const file=input.files?.[0];if(!file)return;
        if(file.size>256*1024*1024)throw new Error('Choose a complete working-copy archive up to 256 MiB.');
        const archive=prepareStatementCopyArchive(JSON.parse(await file.text()),current.program.id);
        if(!session.copyLoaded)await refreshCopies();
        const result=await copyStore.importArchive(archive,session.copyIndex.revision);
        session.copyIndex=result.index;session.copyReview=null;
        session.notice='Received '+result.additions.length+' complete saved editions. Your open statement is preserved; choose an edition to review before opening.';
      });},{once:true});input.click();
    }
  }
  async function compareSharedDraft(){
    clearTimeout(persistTimer);persistTimer=null;await session.storageWrites.catch(()=>{});
    const saved=await storeDraft(current.program.id);
    if(saved!==null)validateDraftRecovery(saved);
    if(session.storageReadFailure?.unread){session.storageReadFailure=null;session.storageToken=statementDraftToken(null);}
    session.storageShared=saved;session.storageComparisonReady=true;session.draftDifferencePage=0;
    if(statementDraftToken(saved)!==session.storageToken){await persist();session.storageShared=await storeDraft(current.program.id);}
    await refreshDraftRecoveries();
  }
  async function draftRecoveryAction(action,target){
    if(action==='draft-export'){download(snapshot(),'statement-recovery.json');return;}
    if(action==='draft-unreadable-export'){download(session.storageReadFailure?.value,'statement-unreadable-original.json');return;}
    if(action==='draft-raw-record-export'){download(session.draftRecoverySelected?.rawShared,'statement-preserved-unreadable-original.json');return;}
    if(action==='draft-unreadable-import'){
      if(!session.storageReadFailure||session.storageReadFailure.unread)throw new Error('Read the current saved original before repairing it.');
      const original=clone(session.storageReadFailure.value),input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.addEventListener('change',()=>{void run(async()=>{
        const file=input.files?.[0];if(!file)return;if(file.size>64*1024*1024)throw new Error('Choose a complete repaired draft up to 64 MiB.');
        const saved=JSON.parse(await file.text());validateDraftRecovery(saved);
        const result=await storeDraft.repair(current.program.id,saved,original,draftMeta('Explicit repaired-copy receiving; complete unreadable original retained'));
        restoreStoredDraft(result.value);session.storageToken=result.token;session.storageReadFailure=null;session.storageConflict=null;session.storageConflictLocalToken=null;session.storageWarning='';
        session.storageComparisonReady=false;session.storageShared=null;session.draftRecoverySelected=result.record;await refreshDraftRecoveries();session.dirty=true;session.confirmed=false;
        session.notice='Received the complete repaired draft and preserved the entire earlier original. Resume its unchanged request or preview current native records.';
      },{persistAfter:false});},{once:true});input.click();return;
    }
    if(action==='draft-sync'){await compareSharedDraft();return;}
    if(action==='draft-shared-export'){if(session.storageShared)download(session.storageShared,'statement-compared-shared-draft.json');return;}
    if(action==='draft-detail-previous'){session.draftDifferencePage=Math.max(0,(session.draftDifferencePage||0)-1);return;}
    if(action==='draft-detail-next'){session.draftDifferencePage=(session.draftDifferencePage||0)+1;return;}
    if(action==='draft-conflict-previous'){session.draftRecoveryPage=Math.max(0,(session.draftRecoveryPage||0)-1);return;}
    if(action==='draft-conflict-next'){session.draftRecoveryPage=(session.draftRecoveryPage||0)+1;return;}
    if(action==='draft-conflict-select'){session.draftRecoverySelected=await storeDraft.record(current.program.id,target.dataset.record);return;}
    if(action==='draft-conflict-local-export'||action==='draft-conflict-shared-export'){
      const selected=session.draftRecoverySelected?.[action==='draft-conflict-local-export'?'local':'shared'];
      if(!selected)throw new Error('Choose the retained complete recovery record.');download(selected,'statement-retained-'+(action==='draft-conflict-local-export'?'local':'shared')+'.json');return;
    }
    if(action==='draft-conflict-export'){download(await storeDraft.archive(current.program.id,snapshot()),'statement-tab-recovery-archive.json');return;}
    if(action==='draft-conflict-import'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.addEventListener('change',()=>{void run(async()=>{
        const file=input.files?.[0];if(!file)return;if(file.size>256*1024*1024)throw new Error('Choose a complete tab-recovery archive up to 256 MiB.');
        const archive=validateStatementDraftArchive(JSON.parse(await file.text()),current.program.id);
        validateDraftRecovery(archive.current);
        for(const record of archive.records){validateDraftRecovery(record.local);if(record.shared)validateDraftRecovery(record.shared);}
        const result=await storeDraft.importArchive(current.program.id,archive);
        session.draftRecoveryIndex=result.index;session.draftRecoverySelected=await storeDraft.record(current.program.id,archive.currentRecordId);
        session.notice='Received '+result.added+' complete tab-recovery records. The current draft and its requests remain selected.';
      },{persistAfter:false});},{once:true});input.click();return;
    }
    if(action==='draft-conflict-open'){
      if(session.storageConflict||session.storageReadFailure)throw new Error('Resolve the shared current draft before opening retained work.');
      const saved=session.draftRecoverySelected?.local;if(!saved)throw new Error('Choose a retained local draft.');
      await importDraft(new File([JSON.stringify(saved)],'statement-retained-tab-draft.json',{type:'application/json'}));return;
    }
    if(action==='draft-use-shared'||action==='draft-use-local'){
      if(session.storageReadFailure)throw new Error('Receive a complete repaired original before choosing another current draft.');
      if(!session.storageComparisonReady)throw new Error('Compare the complete shared draft before choosing.');
      clearTimeout(persistTimer);persistTimer=null;await session.storageWrites.catch(()=>{});
      const local=snapshot(),shared=session.storageShared??null;validateDraftRecovery(local);if(shared)validateDraftRecovery(shared);
      const result=await storeDraft.resolve(current.program.id,local,shared,action==='draft-use-local'?'LOCAL':'SHARED',draftMeta(action==='draft-use-local'?'Explicitly continued this tab; retained the previous shared draft':'Explicitly opened the shared draft; retained this tab'));
      restoreStoredDraft(result.value);session.storageToken=result.token;session.storageConflict=null;session.storageConflictLocalToken=null;session.storageWarning='';
      session.storageShared=null;session.storageComparisonReady=false;session.draftRecoverySelected=result.record;await refreshDraftRecoveries();
      if(!statementDraftRequest(result.value).length){session.dirty=true;session.confirmed=false;}
      session.notice='Both complete drafts are retained. '+(action==='draft-use-shared'?'Opened the shared draft.':'Continued this tab.')+' Resume its exact retained request or preview current native records before importing.';
      await resumeRecipientWork();return;
    }
    throw new Error('Choose an available statement draft-recovery action.');
  }
  function recoveryPage(){
    if(session.accepted)return '<section class="statement-panel"><h4>Import accepted</h4><p>The original import has a server receipt. Read the saved case to finish receiving its cash records and sources.</p><div class="statement-actions">'+button('Read saved case','readback',false,'data-statement-recovery="true"')+button('Download recovery copy','draft-export',false,'data-statement-recovery="true"')+'</div></section>';
    if(session.pending)return '<section class="statement-panel"><h4>Resume the original import</h4><p>The exact reviewed request is retained. Resuming sends the same request identity and payload; the case returns its prior result if already saved.</p><div class="statement-actions">'+button('Resume original import','retry',false,'data-statement-recovery="true"')+button('Download recovery copy','draft-export',false,'data-statement-recovery="true"')+'</div></section>';
    return '';
  }
  function render(){
    if(!available())return;
    const rulesOpen=session.rulesEditorOpen||!!$('[data-rule-editor]')?.open;
    root.innerHTML='<div class="statement-header"><div><h3>Statement receiving</h3><p class="statement-subtitle">Read original CSV, OFX / QFX or MT940 statements, reconcile their balances and import reviewed cash movements into this grant case.</p></div><div class="statement-actions">'+button('Refresh case','refresh',false,'data-statement-recovery="true"')+button('Open cash records','cash',false,'data-statement-recovery="true"')+'</div></div>'+
      (loading?'<p role="status">Opening the retained statement draft…</p>':'')+
      (session.error?'<p class="statement-error" role="alert">'+esc(session.error)+'</p>':'')+
      (session.notice?'<p class="statement-notice" role="status" aria-live="polite">'+esc(session.notice)+'</p>':'')+
      (session.storageWarning?'<p class="statement-notice">'+esc(session.storageWarning)+'</p>':'')+
      (caseValue.program.state==='CLOSED'?'<p class="statement-notice">This case is closed. Reopen the case to import additional cash movements.</p>':'')+
      draftStoragePage()+recoveryPage()+copiesPage()+recipientWorkPage()+recipientPage()+originalInputPage()+sourcePage()+setupPage()+rulesPage()+reviewPage()+
      (session.lastReceipt?detail('Last statement import',session.lastReceipt):'');
    if(rulesOpen&&$('[data-rule-editor]'))$('[data-rule-editor]').open=true;session.rulesEditorOpen=false;
    controls();
  }
  function captureAllocations(form){
    const work=allocationWork();if(!work)return;
    const data=new FormData(form),old=JSON.stringify({allocations:work.allocations,reason:work.reason});
    work.query=String(data.get('allocationQuery')??work.query);work.filter=String(data.get('allocationFilter')??work.filter);
    // Disabled stale controls are absent from FormData; retain those exact working values.
    work.allocations=work.allocations.map((row,i)=>({invoiceId:row.invoiceId,amountUsd:data.has('amount.'+i)?String(data.get('amount.'+i)||'').trim():row.amountUsd}));
    if(data.has('allocationReason'))work.reason=String(data.get('allocationReason')||'');
    if(old!==JSON.stringify({allocations:work.allocations,reason:work.reason})){work.proposal=null;$('.statement-allocation-proposal')?.remove();}
    const row=session.preview?.rows.find(item=>item.rowNumber===session.allocationRow);
    if(row){
      const summary=statementAllocationSummary({usdValue:row.usdValue},work.allocations);
      const total=$('[data-allocation-total]'),remaining=$('[data-allocation-remaining]');
      if(total)total.textContent=summary.total;if(remaining)remaining.textContent=summary.remaining;
    }
    schedulePersist();
  }
  function restoreStoredDraft(saved){
    validateDraftRecovery(saved);
    restoreRecipientWork(saved);session.inputs=editingInput(saved.inputs);session.workingCopyId=saved.workingCopyId||null;session.copyName=saved.copyName||'';session.copyNote=saved.copyNote||'';session.lastReceipt=saved.lastReceipt||null;session.headers=saved.headers||[];session.inspection=usableInspection(saved.inspection,saved.inputs,current.program.id)?saved.inspection:null;session.nativeScalesText=saved.nativeScalesText??scaleText(saved.inputs.statementOptions?.currencyScales);session.preview=saved.preview||null;session.dirty=saved.dirty!==false;session.pending=saved.pending||null;session.accepted=saved.accepted||null;session.setupPending=saved.setupPending||null;session.setupChoice=saved.setupChoice||'';session.setupName=saved.setupName||'';session.setupNote=saved.setupNote||'';session.originalInputHandoff=saved.originalInputHandoff||null;session.batchSelection=statementSelection(session.preview,saved.batchSelection).map(row=>row.rowNumber);if(saved.batchChange&&typeof saved.batchChange==='object')session.batchChange={...session.batchChange,...saved.batchChange};session.batchUndo=saved.batchUndo||null;restoreAllocationWorks(saved);
    session.copyReview=null;session.recipientComparison=null;session.recipientChoices={};session.batchProposal=null;clearAllocationProposals();session.confirmed=false;session.error='';session.page=0;session.status='ALL';session.query='';session.appliedQuery='';session.editRevision++;
  }
  function validateDraftRecovery(saved){
    if(saved.schema!=='sf47.statement-draft.v1'||saved.caseId!==current.program.id||!draftInput(saved.inputs))throw new Error('Choose a statement recovery copy for this original case.');
    statementReviewWorklist(saved,current.program.id);statementRuleWork(saved.classificationRules,current.program.id);
    if(saved.inputs.source?.contentBase64?.length>(maximumSource+2)*4/3+16)throw new Error('The recovery copy contains a statement larger than 8 MiB.');
    if([saved.pending,saved.accepted,saved.setupPending].filter(Boolean).length>1)throw new Error('The recovery copy contains conflicting request states.');
    if(saved.setupPending){const request=saved.setupPending.payload;assertStaffRequestActor(request,pinnedContext);if(request?.action!=='statement-setup.save'||typeof request.requestId!=='string'||!request.data||!['ACTIVE','ARCHIVED'].includes(request.data.status)||request.data.status==='ACTIVE'&&!draftInput(request.data.inputs,true))throw new Error('The retained setup request is incomplete.');}
    assertStaffRequestActor(saved.pending?.payload,pinnedContext);
    assertStaffRequestActor(saved.accepted?.payload,pinnedContext);
    for(const request of [saved.pending?.payload,saved.accepted?.payload].filter(Boolean)){
      if(request.action!=='statement.receive'||typeof request.requestId!=='string'||!request.data?.inputs?.source||!draftInput(request.data.inputs,true)||typeof request.data.expectedPreviewSha256!=='string')throw new Error('The original import request in this recovery copy is invalid.');
      if(request.data.inputs.source.contentBase64?.length>(maximumSource+2)*4/3+16)throw new Error('The retained import contains a statement larger than 8 MiB.');
    }
    if(saved.originalInputHandoff&&(saved.originalInputHandoff.caseId!==current.program.id||!saved.originalInputHandoff.inputs?.source?.contentBase64||!draftInput(saved.originalInputHandoff.inputs,true)||saved.originalInputHandoff.inputs.source.contentBase64.length>(maximumSource+2)*4/3+16))throw new Error('The queued original statement needs its complete source bytes and interpretation in this case.');
    return saved;
  }
  async function importDraft(file,{selectedCopy=null}={}){
    if(!file)return;
    if(session.pending||session.accepted||session.setupPending||session.inflight)throw new Error('Finish the retained request before opening another recovery copy.');
    if(file.size>64*1024*1024)throw new Error('Select a complete statement recovery copy up to 64 MiB.');
    const saved=JSON.parse(await file.text());if(!available())return;
    validateDraftRecovery(saved);
    if(source())await preserveCurrentCopy('Before opening '+(selectedCopy?.name||file.name));
    session.workingCopyId=selectedCopy?.id||null;session.copyName=selectedCopy?.name||'';session.copyNote='';session.copyReview=null;
    session.setupPending=clone(saved.setupPending||null);session.setupChoice=saved.setupChoice||'';session.setupName=saved.setupName||'';session.setupNote=saved.setupNote||'';
    restoreRecipientWork(saved);session.originalInputHandoff=clone(saved.originalInputHandoff||null);session.lastReceipt=clone(saved.lastReceipt||null);
    const original=saved.pending?.payload||saved.accepted?.payload;
    session.inputs=editingInput(original?.data.inputs||saved.inputs);session.pending=clone(saved.pending||null);session.accepted=clone(saved.accepted||null);
    session.inspection=usableInspection(saved.inspection,session.inputs,current.program.id)?clone(saved.inspection):null;
    session.nativeScalesText=original?scaleText(session.inputs.statementOptions?.currencyScales):saved.nativeScalesText??scaleText(session.inputs.statementOptions?.currencyScales);
    clearBatch();session.batchChange=saved.batchChange&&typeof saved.batchChange==='object'?{mode:'CLASSIFY',category:'',tranche:'KEEP',reason:'',...clone(saved.batchChange)}:{mode:'CLASSIFY',category:'',tranche:'KEEP',reason:''};session.optionsError='';session.preview=null;session.dirty=true;session.confirmed=false;session.page=0;session.status='ALL';session.query='';session.appliedQuery='';session.editRevision++;restoreAllocationWorks(saved);headersFromSource();
    session.notice='Opened the original source and interpretation. Resume a retained request or inspect and preview against the current case.';
    await resumeRecipientWork();await persist(true);
  }
  root.addEventListener('input',event=>{
    if(session.storageConflict||session.storageReadFailure)return;
    if(event.target.name?.startsWith('rule.')){captureRuleField(event.target);return;}
    if(event.target.name==='recipientWorkQuery'){session.recipientWorkQuery=event.target.value;return;}
    if(event.target.name==='recipientWorkNote'){
      const entry=selectedStatementReview(session.recipientWorklist);if(entry){putRecipientWork(noteStatementReview(entry,event.target.value));schedulePersist();}return;
    }
    if(['review-recipient-name','review-recipient-role'].includes(event.target.name)){session[event.target.name==='review-recipient-name'?'recipientName':'recipientRole']=event.target.value;schedulePersist();return;}
    if(['copyName','copyNote','copyQuery'].includes(event.target.name)){session[event.target.name]=event.target.value;schedulePersist();return;}
    if(event.target.name==='copyEdition'){session.copySelectedRevision=Number(event.target.value);session.copyReview=null;return;}
    if(event.target.name==='batchReason'){session.batchChange.reason=event.target.value;session.batchProposal=null;$('[class="statement-batch-proposal"]')?.remove();schedulePersist();return;}
    if(event.target.name==='setupName'){session.setupName=event.target.value;schedulePersist();return;}
    if(event.target.name==='setupNote'){session.setupNote=event.target.value;schedulePersist();return;}
    const form=event.target.closest('[data-statement-mapping]');
    if(form&&event.target.tagName!=='SELECT')captureMapping(form);
    if(event.target.dataset.rowReason)setDecision(Number(event.target.dataset.rowReason),{reason:event.target.value});
    if(event.target.closest('[data-statement-allocations]'))captureAllocations(event.target.closest('form'));
    if(event.target.name==='reviewQuery')session.query=event.target.value;
  });
  root.addEventListener('change',event=>{
    if(session.storageConflict||session.storageReadFailure)return;
    if(event.target.dataset.statementRuleChoice){
      try{batchReady();const work=session.classificationRules;
        if(!statementRuleReviewCurrent(work.review,snapshot(),caseValue.program.version)||JSON.stringify(work.review.edition)!==JSON.stringify(rulesEdition()))throw new Error('Review this changed draft and selected rulebook again before choosing rows.');
        work.review=chooseStatementRule(work.review,Number(event.target.dataset.statementRuleChoice),event.target.value);schedulePersist();redrawRules();
      }catch(error){session.error=error.message;render();}return;
    }
    if(event.target.name==='rule.selected'){session.classificationRules.selected=event.target.value;schedulePersist();render();return;}
    if(event.target.name==='rule.filter'){session.classificationRules.filter=event.target.value;session.classificationRules.page=0;schedulePersist();render();return;}
    if(event.target.name?.startsWith('rule.')){captureRuleField(event.target);return;}
    if(event.target.name==='recipientWorkFilter'){session.recipientWorklist.filter=event.target.value;session.recipientWorkPage=0;schedulePersist();render();return;}
    if(event.target.dataset.recipientChoice){
      try{
        recipientReady();const entry=selectedStatementReview(session.recipientWorklist);
        if(!session.recipientComparison||!statementReviewComparisonCurrent(entry,session.recipientComparison,recipientWorkBasis()))throw new Error('Compare the changed draft again before choosing a field.');
        const next=chooseStatementReviewField(entry,event.target.dataset.recipientChoice,event.target.value);putRecipientWork(next);session.recipientChoices=clone(next.choices);schedulePersist();
        const apply=$('[data-statement-action="recipient-apply"]');if(apply){apply.dataset.statementFixed=String(session.recipientComparison.fields.some(row=>!session.recipientChoices[row.key]));controls();}
      }catch(error){session.error=error.message;invalidateRecipientComparison();render();}return;
    }
    if(event.target.dataset.statementRowSelect){
      try{batchReady();const number=Number(event.target.dataset.statementRowSelect);
        if(event.target.checked)selectBatch([number]);else{session.batchSelection=session.batchSelection.filter(value=>value!==number);session.batchProposal=null;schedulePersist();}
        redrawBatch();
      }catch(error){session.error=error.message;render();}return;
    }
    if(['batchMode','batchCategory','batchTranche'].includes(event.target.name)){
      const key={batchMode:'mode',batchCategory:'category',batchTranche:'tranche'}[event.target.name];
      session.batchChange[key]=event.target.value;session.batchProposal=null;schedulePersist();redrawBatch();return;
    }
    if(event.target.name==='setupChoice'){session.setupChoice=event.target.value;session.setupName=setupRows().find(row=>row.sourceId===session.setupChoice)?.name||'';session.setupNote='';schedulePersist();render();return;}
    if(event.target.matches('[data-statement-file]')){void run(()=>chooseFile(event.target.files?.[0]));return;}
    const mapping=event.target.closest('[data-statement-mapping]');
    if(mapping){
      const oldDelimiter=session.inputs.format?.delimiter,oldInspection=session.inspection;captureMapping(mapping);
      if(event.target.name==='sourceFormat'){
        const format=event.target.value;void run(async()=>{await preserveCurrentCopy('Before changing statement source format');chooseFormat(format);});
      }else if(event.target.name==='statementId'){
        try{selectAccount(event.target.value);}catch(error){session.error=error.message;}
        render();
      }else if(!native()&&oldDelimiter!==session.inputs.format.delimiter){
        try{headersFromSource();session.inputs.decisions=[];session.preview=null;}catch(error){session.headers=[];session.preview=null;session.error=error.message;}
        render();
      }else if(['format.amountMode','currency'].includes(event.target.name)||oldInspection!==session.inspection)render();
      return;
    }
    if(event.target.matches('[data-statement-confirm]')){session.confirmed=event.target.checked;controls();return;}
    if(event.target.name==='reviewStatus'){session.status=event.target.value;session.page=0;render();return;}
    if(event.target.dataset.rowAction){setDecision(Number(event.target.dataset.rowAction),{action:event.target.value});return;}
    if(event.target.dataset.rowCategory){setDecision(Number(event.target.dataset.rowCategory),{category:event.target.value});return;}
    if(event.target.dataset.rowTranche){setDecision(Number(event.target.dataset.rowTranche),{tranche:event.target.value===''?null:Number(event.target.value)});return;}
    if(event.target.closest('[data-statement-allocations]')){captureAllocations(event.target.closest('form'));if(event.target.name==='allocationFilter'){allocationWork().page=0;render();}}
  });
  root.addEventListener('submit',event=>{
    if(event.target.matches('[data-statement-mapping]')){event.preventDefault();captureMapping(event.target);void run(native()&&!session.inspection?inspect:preview);}
    if(event.target.matches('[data-statement-allocations]')){
      event.preventDefault();captureAllocations(event.target);void run(()=>allocationAction('allocation-review',event.target));
    }
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-statement-action]');if(!target||target.disabled)return;
    const action=target.dataset.statementAction;
    const draftRecovery=target.dataset.statementDraftRecovery==='true'||action==='draft-export';
    if((session.storageConflict||session.storageReadFailure)&&!draftRecovery)return;
    if(action==='preview'||action==='inspect'){const form=$('[data-statement-mapping]');if(form)captureMapping(form);}
    if(action.startsWith('allocation-')||action==='allocations'||action==='close-allocations'){const form=$('[data-statement-allocations]');if(form)captureAllocations(form);}
    void run(async()=>{
      if(target.dataset.statementDraftRecovery==='true')await draftRecoveryAction(action,target);
      else if(action.startsWith('rules-'))await ruleAction(action,target);
      else if(action.startsWith('recipient-'))await recipientAction(action,target);
      else if(action.startsWith('copies-'))await copyAction(action,target);
      else if(action.startsWith('allocation-'))await allocationAction(action,target);
      else if(action.startsWith('batch-'))await batchAction(action);
      else if(action==='setup-apply')await applySetup();
      else if(action==='setup-new')await saveSetup('new');
      else if(action==='setup-revise')await saveSetup('revise');
      else if(action==='setup-archive')await saveSetup('archive');
      else if(action==='setup-retry')await sendSetup();
      else if(action==='setup-clear'){delete session.inputs.statementSetup;changed();session.notice='Cleared the setup selection. The current file and editable mapping are retained.';}
      else if(action==='inspect')await inspect();
      else if(action==='preview')await preview();
      else if(action==='import')await importReviewed();
      else if(action==='retry')await sendPending();
      else if(action==='readback')await finishAccepted();
      else if(action==='refresh'){await refresh();session.notice='Read the current case. Preview again if its version changed.';}
      else if(action==='cash'){await persist();if(available())await onCash();}
      else if(action==='original-input')await openOriginalInputs();
      else if(action==='original-input-export')download(session.originalInputHandoff,'statement-original-inputs.json');
      else if(action==='draft-export')download(snapshot(),'statement-recovery.json');
      else if(action==='review-export')download(session.preview,'statement-review.json');
      else if(action==='draft-import'){
        const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
        input.addEventListener('change',()=>{void run(()=>importDraft(input.files?.[0]));},{once:true});input.click();
      }
      else if(action==='filter'){session.appliedQuery=session.query;session.page=0;}
      else if(action==='previous')session.page=Math.max(0,session.page-1);
      else if(action==='next')session.page++;
      else if(action==='allocations'){
        const row=session.preview.rows.find(row=>row.rowNumber===Number(target.dataset.row));
        if(!row)throw new Error('The source row is unavailable. Preview the statement again.');
        session.allocationRow=row.rowNumber;
        if(!session.allocationWorks[String(row.rowNumber)])session.allocationWorks[String(row.rowNumber)]=newAllocationWork(row.rowNumber);
      }
      else if(action==='close-allocations')session.allocationRow=null;
    },{persistAfter:!draftRecovery});
  });
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Statement',
    readCopy:()=>statementStore(null)(current.program.id),isBusy:()=>loading||busy||hostBusy||!!session.inflight,setDeskBusy:value=>{busy=value;if(value)controls();else render();},
    describeCopy:value=>(value.inputs?.source?.filename||'Original statement')+' · '+(value.pending?'original import pending':value.accepted?'saved import response retained':'editable interpretation'),
    filename:'statement-earlier-recovery.json',
    openCopy:async value=>{assertStaffRequestActor(value.pending?.payload,pinnedContext);download(snapshot(),'statement-current-recovery.json');await importDraft(new File([JSON.stringify(value)],'statement-earlier-recovery.json',{type:'application/json'}));render();}
  });
  render();
  const ready=(async()=>{
    if(!session.loaded){
      if(!session.loadingDraft)session.loadingDraft=(async()=>{
        let saved;
        try{
          saved=await storeDraft(current.program.id);
          if(saved!==null)restoreStoredDraft(saved);
          session.storageToken=statementDraftToken(saved);session.storageReadFailure=null;
        }catch(error){
          session.storageToken=undefined;
          if(saved!==undefined)session.storageReadFailure={value:clone(saved),error:'The saved original could not be opened: '+error.message};
          session.storageWarning='This browser could not open its saved draft. The original is preserved; ordinary and native writes remain unavailable until it is recovered.';
        }
        session.loaded=true;
      })();
      await session.loadingDraft;
    }
    if(typeof session.storageToken!=='string'&&!session.storageReadFailure){
      try{
        const saved=await storeDraft(current.program.id);
        const plain=saved?{...saved}:null;if(plain)delete plain._storedRevision;
        session.storageToken=saved===null||statementDraftToken(plain)===statementDraftToken(snapshot())?statementDraftToken(saved):statementDraftToken(null);
        if(saved!==null&&session.storageToken!==statementDraftToken(saved))await persist();
      }catch(error){session.storageReadFailure={unread:true,error:'Browser storage could not be read: '+error.message};}
    }
    try{await refreshDraftRecoveries();}catch(error){session.storageWarning='Tab-recovery records could not be opened. '+error.message;}
    try{await refreshCopies();}catch(error){session.storageWarning='Saved working copies could not be opened. Download the current recovery copy before changing source. '+error.message;}
    if(available()&&session.incomingOriginalInputs){
      if(session.originalInputHandoff&&JSON.stringify(session.originalInputHandoff)!==JSON.stringify(session.incomingOriginalInputs))
        download(session.originalInputHandoff,'statement-previous-original-inputs.json');
      session.originalInputHandoff=clone(session.incomingOriginalInputs);delete session.incomingOriginalInputs;await persist();
      if(!session.storageReadFailure&&!session.storageConflict&&!session.pending&&!session.accepted&&!session.setupPending&&!session.inflight){try{await openOriginalInputs();}catch(error){session.error=error.message||String(error);}}
    }
    loading=false;
    if(session.preview?.expectedVersion!==current.program.version){clearBatch();clearAllocationProposals();session.dirty=true;session.confirmed=false;}
    await resumeRecipientWork();
    if(available())render();
    if(session.inflight){try{await session.inflight;}catch{}if(available())render();}
    if(available()&&session.accepted&&!session.storageReadFailure&&!session.storageConflict)await run(finishAccepted);
  })();
  return {root,ready,dispose(){earlier.dispose();active=false;clearTimeout(persistTimer);if(session.loaded)void persist();},setHostBusy(value){hostBusy=!!value;controls();}};
}
