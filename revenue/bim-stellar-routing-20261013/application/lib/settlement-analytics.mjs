import {assetIdentity,assetKey,amount,aggregateAmounts,executionQuality,reconciliation} from './settlement-exact.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function plain(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_INPUT',label+' is required.');return value;}
function id(value,label){if(typeof value!=='string'||!value||value.length>500||/[\u0000-\u001f]/u.test(value))fail('INVALID_ID',label+' is invalid.');return value;}
function when(value,label,nullable=false){
  if(nullable&&value===null)return null;
  const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if(!match||!Number.isFinite(Date.parse(value)))fail('INVALID_TIME',label+' requires a complete offset timestamp.');
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),days=[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
  if(m<1||m>12||d<1||d>days[m-1]||Number(match[4])>23||Number(match[5])>59||Number(match[6])>59)fail('INVALID_TIME',label+' is not a valid calendar timestamp.');
  return new Date(value).toISOString();
}
function unique(rows,label){if(!Array.isArray(rows))fail('INVALID_INPUT',label+' must be a complete array.');const seen=new Set();for(const row of rows){id(row.id,label+' ID');if(seen.has(row.id))fail('DUPLICATE_RECORD',label+' contains duplicate '+row.id);seen.add(row.id);}return rows;}
function index(rows){return new Map(rows.map(row=>[row.id,row]));}
function grouped(rows,key){const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return [...map.entries()].sort(([a],[b])=>a.localeCompare(b));}
function windowContains(at,selection){if(at===null)return selection.includeUndated;const t=Date.parse(when(at,'Economic time'));return (!selection.from||t>=Date.parse(selection.from))&&(!selection.through||t<=Date.parse(selection.through));}
function csvCell(value){const s=typeof value==='string'?value:JSON.stringify(value??null);return /[",\r\n]/u.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(headers,rows){return headers.map(csvCell).join(',')+'\r\n'+rows.map(row=>headers.map(name=>csvCell(row[name])).join(',')).join('\r\n')+(rows.length?'\r\n':'');}
const htmlEscape=value=>String(value??'').replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function table(title,headers,rows){return '<section><h2>'+htmlEscape(title)+'</h2><p>'+rows.length+' rows</p><div class="scroll"><table><thead><tr>'+headers.map(x=>'<th>'+htmlEscape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+headers.map(name=>'<td>'+htmlEscape(typeof row[name]==='string'?row[name]:JSON.stringify(row[name]??null))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></section>';}
export function normalizeSettlementSelection(value={}){
  plain(value,'Report selection');
  const from=value.from?when(value.from,'From'):null,through=value.through?when(value.through,'Through'):null;
  if(from&&through&&Date.parse(from)>Date.parse(through))fail('INVALID_RANGE','The first economic time is after the final time.');
  const accounts=value.accounts===undefined?[]:value.accounts;
  if(!Array.isArray(accounts)||accounts.length>10000||accounts.some(v=>typeof v!=='string'))fail('INVALID_ACCOUNTS','Selected account IDs must be a bounded array.');
  if(new Set(accounts).size!==accounts.length)fail('DUPLICATE_ACCOUNT','Account selection contains duplicates.');
  for(const a of accounts)id(a,'Account');
  return {schema:'bim.settlement-report-selection.v1',from,through,accounts:[...accounts].sort(),includeUndated:value.includeUndated===true};
}
/**
 * projectSource is the actual read-only original-workspace adapter. It returns complete
 * original row references and derived observations. A full reopen calls it again;
 * normalized facts are never accepted in place of the original source.
 */
export function createSettlementAnalytics({sha256Utf8,projectSource}){
  if(typeof sha256Utf8!=='function'||typeof projectSource!=='function')fail('INVALID_ADAPTER','Exact hash and original source adapter functions are required.');
  const hash=value=>sha256Utf8(JSON.stringify(value));
  function report(original,options={}){
    const selection=normalizeSettlementSelection(options),p={vaultActivities:[],positions:[],...projectSource(original)};
    if(p.schema!=='bim.settlement-source-projection.v1')fail('WRONG_SOURCE','The original source adapter returned another schema.');
    plain(p.source,'Original source identity');id(p.source.workspaceId,'Original workspace');
    if(!/^[a-f0-9]{64}$/u.test(p.source.sha256||''))fail('INVALID_SOURCE_DIGEST','The original workspace digest must be SHA-256.');
    for(const name of ['quotes','selections','executions','vaultActivities','positions','movements','balances','fallbacks','lifecycle','coverage','exceptions','inventory'])unique(p[name],name);
    for(const row of p.inventory)if(!/^[a-f0-9]{64}$/u.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<0)fail('INVALID_SOURCE_INVENTORY','Every original inventory item needs exact bytes and SHA-256.');
    const inventory=index(p.inventory);
    function refs(row){
      if(!Array.isArray(row.sourceRefs)||!row.sourceRefs.length)fail('SOURCE_REFERENCE_MISSING','Original source references are required for '+row.id);
      for(const ref of row.sourceRefs){
        if(!inventory.has(ref.id)||typeof ref.pointer!=='string'||(ref.pointer&&!ref.pointer.startsWith('/')))fail('SOURCE_REFERENCE_INVALID','Original record pointer is invalid for '+row.id);
        if(ref.sha256!==inventory.get(ref.id).sha256)fail('SOURCE_REFERENCE_CHANGED','Source digest changed for '+row.id);
      }
    }
    for(const name of ['quotes','selections','executions','vaultActivities','positions','movements','balances','fallbacks','lifecycle','coverage'])for(const row of p[name])refs(row);
    const selectedAccount=account=>!selection.accounts.length||selection.accounts.includes(account);
    const scoped=row=>selectedAccount(row.accountId)&&windowContains(row.economicAt,selection);
    const quotes=index(p.quotes),allExecutions=index(p.executions),allSelections=index(p.selections);
    const executions=p.executions.filter(scoped),selectedRows=p.selections.filter(row=>selectedAccount(row.accountId)&&windowContains(row.selectedAt,selection)),selections=selectedRows.filter(row=>row.kind!=='ROUTE_ATTEMPT'),routeAttempts=selectedRows.filter(row=>row.kind==='ROUTE_ATTEMPT'),movements=p.movements.filter(scoped),fallbacks=p.fallbacks.filter(row=>selectedAccount(row.accountId)&&windowContains(row.occurredAt,selection));
    const exceptions=p.exceptions.map(clone),confirmed=executions.filter(row=>row.state==='CONFIRMED_SUCCESS'),qualities=[],confirmedIdentities=new Set();
    const completeExecutions=[];
    for(const row of confirmed){
      if(typeof row.confirmedIdentity!=='string'||!row.confirmedIdentity)fail('EXECUTION_IDENTITY_MISSING','An independently confirmed economic execution needs its original unique identity.');
      if(confirmedIdentities.has(row.confirmedIdentity))fail('DUPLICATE_EXECUTION','Duplicate confirmed economic execution '+row.confirmedIdentity);
      confirmedIdentities.add(row.confirmedIdentity);
      if(row.input&&row.output){amount(row.input,{nonnegative:true});amount(row.output,{nonnegative:true});completeExecutions.push(row);}
      else exceptions.push({id:'missing-amounts:'+row.id,kind:'CONFIRMED_AMOUNTS_MISSING',recordId:row.id,sourceRefs:clone(row.sourceRefs),message:'The original confirmation does not carry complete decoded input and output amounts.'});
      const quality=executionQuality(quotes.get(row.selectedQuoteId),row);
      const quoteRefs=quotes.get(row.selectedQuoteId)?.sourceRefs||[];
      const qualityRefs=[...new Map([...quoteRefs,...row.sourceRefs].map(ref=>[JSON.stringify(ref),ref])).values()];
      qualities.push({...quality,protocol:row.protocol||null,economicAt:row.economicAt,sourceRefs:clone(qualityRefs)});
    }
    const volume=[];
    for(const [protocol,rows]of grouped(completeExecutions,row=>row.protocol||'UNKNOWN')){
      for(const side of ['input','output'])for(const total of aggregateAmounts(rows,row=>row[side]))volume.push({protocol,side,...total,executionIds:rows.filter(row=>assetKey(row[side].asset)===assetKey(total.asset)).map(row=>row.id)});
    }
    const selectionDistribution=grouped(selections,row=>row.protocol||'UNKNOWN').map(([protocol,rows])=>({protocol,count:rows.length,denominator:selections.length,selectionIds:rows.map(row=>row.id),outcomes:grouped(rows,row=>row.outcome||'UNKNOWN').map(([outcome,x])=>({outcome,count:x.length}))}));
    const fallbackRows=fallbacks.map(row=>{
      const prior=allSelections.get(row.fromSelectionId),next=row.toSelectionId?allSelections.get(row.toSelectionId):null;
      const reasons=[];
      if(!prior)reasons.push('ORIGINAL_PRIOR_SELECTION_MISSING');
      if(!row.toSelectionId||!next)reasons.push('ORIGINAL_FOLLOWING_SELECTION_MISSING');
      if(!['SIMULATION_FAILED','SOURCE_UNAVAILABLE'].includes(row.reason))reasons.push('ORIGINAL_FALLBACK_REASON_UNRECOGNIZED');
      return {...clone(row),status:reasons.length?'NEEDS_REVIEW':'SOURCE_BOUND',reasons,fromProtocol:prior?.protocol||null,toProtocol:next?.protocol||null};
    });
    const movementIdentities=new Set();
    for(const row of movements){
      amount(row.amount);id(row.confirmedIdentity,'Original movement identity');
      if(row.state!=='CONFIRMED')fail('MOVEMENT_NOT_CONFIRMED','Only independently confirmed movements enter the dated journal.');
      if(movementIdentities.has(row.confirmedIdentity))fail('DUPLICATE_MOVEMENT','Duplicate original economic movement '+row.confirmedIdentity);
      movementIdentities.add(row.confirmedIdentity);
    }
    const accountRows=[];
    const balances=p.balances.filter(row=>selectedAccount(row.accountId));
    const balanceObservations=balances.filter(row=>row.role==='OBSERVATION');
    const groupKeys=new Set([...movements.map(row=>row.accountId+'\n'+assetKey(row.amount.asset)),...balances.map(row=>row.accountId+'\n'+assetKey(row.amount.asset))]);
    for(const key of [...groupKeys].sort()){
      const newline=key.indexOf('\n'),accountId=key.slice(0,newline),asset=JSON.parse(key.slice(newline+1));
      const journal=movements.filter(row=>row.accountId===accountId&&assetKey(row.amount.asset)===assetKey(asset));
      const opening=balances.filter(row=>row.accountId===accountId&&row.role==='OPENING'&&assetKey(row.amount.asset)===assetKey(asset)&&row.rangeFrom===selection.from&&row.rangeThrough===selection.through);
      const closing=balances.filter(row=>row.accountId===accountId&&row.role==='CLOSING'&&assetKey(row.amount.asset)===assetKey(asset)&&row.rangeFrom===selection.from&&row.rangeThrough===selection.through);
      const cover=p.coverage.filter(row=>row.accountId===accountId&&assetKey(row.asset)===assetKey(asset)&&row.rangeFrom===selection.from&&row.rangeThrough===selection.through);
      const explicitRange=selection.from!==null&&selection.through!==null;
      const authority=opening.length===1?opening[0].authority:null;
      const undatedAccountMovements=p.movements.filter(row=>row.accountId===accountId&&assetKey(row.amount.asset)===assetKey(asset)&&row.economicAt===null);
      const datedJournal=undatedAccountMovements.length===0&&journal.every(row=>row.economicAt!==null&&windowContains(row.economicAt,{...selection,includeUndated:false}));
      const valid=explicitRange&&datedJournal&&opening.length===1&&closing.length===1&&cover.length===1&&typeof authority==='string'&&authority.trim().length>0&&authority===closing[0].authority&&cover[0].authority===authority&&!journal.some(row=>row.authority!==authority);
      const bridge=reconciliation({opening:opening.length===1?opening[0].amount:null,closing:closing.length===1?closing[0].amount:null,movements:journal.map(row=>row.amount),coverage:valid?cover[0]:null});
      if(!valid)bridge.reasons.push('ORIGINAL_BALANCE_RANGE_OR_AUTHORITY_NOT_UNIQUE');
      if(!datedJournal)bridge.reasons.push('UNDATED_MOVEMENT_OUTSIDE_AUTHORITATIVE_RANGE');
      if(!explicitRange)bridge.reasons.push('EXPLICIT_ECONOMIC_RANGE_REQUIRED');
      accountRows.push({accountId,asset,...bridge,movementIds:journal.map(row=>row.id),openingIds:opening.map(row=>row.id),closingIds:closing.map(row=>row.id),coverageIds:cover.map(row=>row.id),undatedMovementIds:undatedAccountMovements.map(row=>row.id)});
    }
    const lifecycle=p.lifecycle.filter(row=>selectedAccount(row.accountId)),vaultActivities=p.vaultActivities.filter(scoped),positions=p.positions.filter(row=>selectedAccount(row.accountId));
    const undated={executions:p.executions.filter(row=>selectedAccount(row.accountId)&&row.economicAt===null).map(row=>row.id),movements:p.movements.filter(row=>selectedAccount(row.accountId)&&row.economicAt===null).map(row=>row.id)};
    const result={
      schema:'bim.settlement-analytics-report.v1',source:clone(p.source),selection,
      policy:{volume:'Confirmed execution input and output are separate exact-asset populations.',quality:'Comparable only against the exact original selected quote and quantity; original monetary amounts remain unchanged.',date:'Dated monetary groups use original confirmed economic time; undated facts remain a separate visible population.',coverage:'A retained local inventory does not imply complete provider history.',valuation:'No cross-asset or implicit fiat total.',fallback:'Only source-linked failed simulation or unavailable route events are classified as fallback.',selections:'Original prepared-plan selections are the distribution denominator; the complete route-attempt population is retained separately.',balances:'Observed balances retain their source observation time and do not supply an authoritative range opening or closing.'},
      counts:{sourceQuotes:p.quotes.length,sourceSelections:p.selections.filter(row=>row.kind!=='ROUTE_ATTEMPT').length,sourceRouteAttempts:p.selections.filter(row=>row.kind==='ROUTE_ATTEMPT').length,sourceExecutions:p.executions.length,sourceVaultActivities:p.vaultActivities.length,vaultActivities:vaultActivities.length,positions:positions.length,selectedExecutions:executions.length,confirmedExecutions:confirmed.length,completeAmountExecutions:completeExecutions.length,selectedSelections:selections.length,selectedRouteAttempts:routeAttempts.length,balanceObservations:balanceObservations.length,comparableExecutions:qualities.filter(row=>row.status==='COMPARABLE').length,movements:movements.length,fallbacks:fallbackRows.length,sourceFiles:p.inventory.length},
      volume,selectionDistribution,quality:qualities,executions:clone(executions),vaultActivities:clone(vaultActivities),positions:clone(positions),selections:clone(selections),routeAttempts:clone(routeAttempts),balanceObservations:clone(balanceObservations),movements:clone(movements),accountReconciliation:accountRows,fallbacks:fallbackRows,lifecycle:clone(lifecycle),coverage:clone(p.coverage),undated,exceptions,inventory:clone(p.inventory)
    };
    return {...result,sha256:hash(result)};
  }
  function validateReport(original,selection,saved){const current=report(original,selection);if(JSON.stringify(current)!==JSON.stringify(saved))fail('REPORT_CHANGED','The complete report does not reproduce from its exact original source and selection.');return current;}
  function exportPackage(original,selection){
    const result=report(original,selection),source=clone(original);
    const packet={schema:'bim.settlement-analytics-package.v1',source,result};
    packet.sha256=hash(packet);return packet;
  }
  function receivePackage(packet){
    if(!packet||packet.schema!=='bim.settlement-analytics-package.v1')fail('WRONG_PACKAGE','Select the complete original settlement package.');
    const {sha256,...basis}=packet;if(hash(basis)!==sha256)fail('PACKAGE_CHANGED','Original package digest differs.');
    const result=validateReport(packet.source,packet.result.selection,packet.result);return {source:clone(packet.source),result};
  }
  function reportCreators(original,selection){
    const result=report(original,selection),files={};
    files['report.json']=()=>JSON.stringify(result,null,2)+'\n';
    files['complete-source.json']=()=>JSON.stringify(exportPackage(original,selection),null,2)+'\n';
    files['volume.csv']=()=>csv(['protocol','side','asset','atomic','decimal','count','executionIds'],result.volume);
    files['selections.csv']=()=>csv(['id','protocol','accountId','selectedAt','quoteId','outcome','sourceRefs'],result.selections);
    files['route-attempts.csv']=()=>csv(['id','protocol','accountId','selectedAt','quoteId','outcome','sourceRefs'],result.routeAttempts);
    files['balance-observations.csv']=()=>csv(['id','role','accountId','amount','economicAt','observedAt','authority','sourceRefs'],result.balanceObservations);
    files['vault-activities.csv']=()=>csv(['id','provider','vault','accountId','economicAt','state','sourceStatus','sourceReasons','operation','confirmedIdentity','shareChangeAtomic','sharePrecision','flows','unresolvedContracts','basis','sourceRefs'],result.vaultActivities);
    files['positions.csv']=()=>csv(['id','provider','vault','accountId','status','observedAt','sharesAtomic','sharePrecision','underlying','basis','reasons','sourceRefs'],result.positions);
    files['execution-quality.csv']=()=>csv(['executionId','quoteId','protocol','economicAt','status','mode','asset','expectedAtomic','expectedDecimal','actualAtomic','actualDecimal','actualMinusExpectedAtomic','favorableAtomic','favorableDecimal','quality','limit','reasons','sourceRefs'],result.quality);
    files['movements.csv']=()=>csv(['id','accountId','economicAt','observedAt','role','state','confirmedIdentity','amount','authority','sourceRefs'],result.movements);
    files['reconciliation.csv']=()=>csv(['accountId','asset','status','opening','closing','knownMovementTotals','derivedClosing','difference','reasons','movementIds','openingIds','closingIds','coverageIds'],result.accountReconciliation);
    files['fallbacks.csv']=()=>csv(['id','occurredAt','fromSelectionId','toSelectionId','fromProtocol','toProtocol','reason','status','reasons','sourceRefs'],result.fallbacks);
    files['lifecycle.csv']=()=>csv(['id','provider','providerIdentity','accountId','state','sourceConfirmed','destinationConfirmed','cashPaidOut','refundConfirmed','economicAt','observedAt','sourceRefs'],result.lifecycle);
    files['exceptions.csv']=()=>csv(['id','kind','recordId','message','sourceRefs'],result.exceptions);
    files['report.html']=()=>'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlement and execution report</title><style>body{font:15px system-ui;margin:32px;color:#171717;background:#fff}h1,h2{font-weight:600}section{margin:28px 0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;max-width:620px;overflow-wrap:anywhere}th{background:#eee}code{white-space:pre-wrap}</style><h1>Settlement and execution report</h1><p>Workspace '+htmlEscape(result.source.workspaceId)+'</p><p>Report '+htmlEscape(result.sha256)+'</p><pre>'+htmlEscape(JSON.stringify({selection:result.selection,counts:result.counts,policy:result.policy},null,2))+'</pre>'+
      table('Confirmed protocol volume',['protocol','side','asset','atomic','decimal','count'],result.volume)+
      table('Route selection distribution',['protocol','count','denominator','outcomes'],result.selectionDistribution)+
      table('Original route attempts',['id','protocol','accountId','selectedAt','quoteId','outcome','sourceRefs'],result.routeAttempts)+
      table('Original balance observations',['id','accountId','amount','observedAt','authority','sourceRefs'],result.balanceObservations)+
      table('Original confirmed vault activity',['id','vault','accountId','economicAt','state','sourceStatus','operation','shareChangeAtomic','flows','basis','sourceRefs'],result.vaultActivities)+
      table('Original vault position observations',['id','vault','accountId','status','observedAt','sharesAtomic','underlying','basis','reasons','sourceRefs'],result.positions)+
      table('Execution quality',['executionId','protocol','status','mode','asset','expectedDecimal','actualDecimal','favorableDecimal','quality','limit','reasons'],result.quality)+
      table('Account reconciliation',['accountId','asset','status','opening','closing','derivedClosing','difference','reasons'],result.accountReconciliation)+
      table('Confirmed movements',['id','accountId','economicAt','role','amount','confirmedIdentity','sourceRefs'],result.movements)+
      table('Fallback events',['id','fromProtocol','toProtocol','reason','status','reasons','sourceRefs'],result.fallbacks)+
      table('Provider lifecycle',['id','provider','state','sourceConfirmed','destinationConfirmed','cashPaidOut','refundConfirmed','sourceRefs'],result.lifecycle)+
      table('Source coverage',['id','accountId','asset','rangeFrom','rangeThrough','status','sourceRefs'],result.coverage)+
      table('Exceptions',['id','kind','recordId','message','sourceRefs'],result.exceptions)+
      table('Complete original inventory',['id','kind','sha256','bytes','path'],result.inventory)+
      '<h2>Undated original records</h2><pre>'+htmlEscape(JSON.stringify(result.undated,null,2))+'</pre></html>\n';
    files['manifest.json']=()=>JSON.stringify({schema:'bim.settlement-analytics-files.v1',reportSha256:result.sha256,source:result.source,files:Object.entries(files).filter(([name])=>name!=='manifest.json').map(([name,create])=>({name,sha256:sha256Utf8(create())}))},null,2)+'\n';
    return files;
  }
  function reportFile(original,selection,name){const creators=reportCreators(original,selection);if(!Object.hasOwn(creators,name))fail('REPORT_FILE_UNKNOWN','Choose a named complete report file.');return creators[name]();}
  function reportFiles(original,selection){return Object.fromEntries(Object.entries(reportCreators(original,selection)).map(([name,create])=>[name,create()]));}
  return Object.freeze({report,validateReport,exportPackage,receivePackage,reportFiles,reportFile});
}
