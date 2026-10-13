// MIT. Complete Turbolong operating-period analysis and portable report editions.
import {createHash} from 'node:crypto';
import {parseTurbolongOriginalJSON} from './native.mjs';
import {TURBOLONG_ORIGINAL} from './catalogue.mjs';

const DAY=86400000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
function need(value,message){if(!value)throw Object.assign(new TypeError(message),{code:'INVALID_PERIOD_INPUT'});}
function parseTime(value,{allowEpoch=false}={}){
  if(allowEpoch&&(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))){const n=Number(value);if(Number.isFinite(n))return Math.abs(n)<100000000000?n*1000:n;}
  if(typeof value!=='string')return null;
  let s=value.trim();
  if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(s))s=s.replace(' ','T')+'Z';
  if(!/(?:[zZ]|[+-]\d\d:\d\d)$/.test(s))return null;
  const n=Date.parse(s);return Number.isFinite(n)?n:null;
}
function iso(value){const n=parseTime(value,{allowEpoch:true});return n===null?null:new Date(n).toISOString();}
function daysBetween(start,end){const rows=[];for(let n=Math.floor(start/DAY)*DAY;n<end;n+=DAY)rows.push({date:new Date(n).toISOString().slice(0,10),startsAt:new Date(Math.max(start,n)).toISOString(),endsAt:new Date(Math.min(end,n+DAY)).toISOString(),start:Math.max(start,n),end:Math.min(end,n+DAY),fullDay:start<=n&&end>=n+DAY});return rows;}
function positiveInteger(value,name,minimum=1){need(Number.isSafeInteger(value)&&value>=minimum,name+' must be a safe integer of at least '+minimum);return value;}
function decimal(value){if(typeof value==='string'&&/^-?\d+$/.test(value))return value;if(Number.isSafeInteger(value))return String(value);return null;}
function finite(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
function exactPositive(value){const d=decimal(value);return d!==null&&BigInt(d)>0n;}
function metric(values){const selected=values.filter(x=>typeof x==='number'&&Number.isFinite(x));if(!selected.length)return {count:0,minimum:null,maximum:null,mean:null,median:null};const sorted=[...selected].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return {count:selected.length,minimum:sorted[0],maximum:sorted.at(-1),mean:selected.reduce((a,b)=>a+b,0)/selected.length,median:sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};}
function makeIssue(code,message,detail={}){return {id:'issue-'+hash(canonical({code,message,detail})),code,message,...detail};}
export function validateTurbolongPeriod(definition){
  need(plain(definition),'period must be an object');
  const start=parseTime(definition.startsAt),end=parseTime(definition.endsAt);
  need(start!==null&&end!==null,'period startsAt and endsAt require valid timestamps with explicit UTC offsets');
  need(start<end,'period endsAt must be later than startsAt');
  const network=definition.network||'mainnet';need(['mainnet','testnet'].includes(network),'period network must be mainnet or testnet');
  const cadence=positiveInteger(definition.expectedSnapshotIntervalSeconds??900,'expectedSnapshotIntervalSeconds');
  const surfaceCadence=definition.expectedSurfaceIntervalSeconds===undefined?null:positiveInteger(definition.expectedSurfaceIntervalSeconds,'expectedSurfaceIntervalSeconds');
  const healthCadence=definition.expectedHealthIntervalSeconds===undefined?null:positiveInteger(definition.expectedHealthIntervalSeconds,'expectedHealthIntervalSeconds');
  const surfaces=(definition.surfaces||[]).map(s=>typeof s==='string'?s:s?.id);
  need(surfaces.every(s=>typeof s==='string'&&s.length)&&new Set(surfaces).size===surfaces.length,'period surfaces must contain unique IDs');
  const dimensions=definition.healthDimensions||['keeper','alerts','snapshots','flows'];
  need(Array.isArray(dimensions)&&dimensions.every(s=>typeof s==='string'&&s.length)&&new Set(dimensions).size===dimensions.length,'healthDimensions must contain unique names');
  const thresholds={executedMainnetHarvests:50,rateHistoryDays:30,consecutiveGreenDays:14,...definition.acceptance};
  for(const [key,value]of Object.entries(thresholds))positiveInteger(value,'acceptance.'+key,0);
  return {...clone(definition),name:typeof definition.name==='string'&&definition.name.trim()?definition.name.trim():'Turbolong operating period',network,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),expectedSnapshotIntervalSeconds:cadence,...(surfaceCadence===null?{}:{expectedSurfaceIntervalSeconds:surfaceCadence}),...(healthCadence===null?{}:{expectedHealthIntervalSeconds:healthCadence}),surfaces,healthDimensions:dimensions,acceptance:thresholds};
}
function parseMaterial(source,index,issues){
  const id=String(source.id||source.sourceId||'source-'+index),observedAt=iso(source.observedAt||source.createdAt),declaredHash=source.sha256||source.contentSha256||null;
  let content=source.content??source.parsed??source.data,bytes=null,bodyHash=null,parseErrors=[];
  const body=source.bodyBase64??source.response?.bodyBase64;
  if(body!==undefined){
    need(typeof body==='string','source '+id+' bodyBase64 must be a string');
    bytes=Buffer.from(body,'base64');bodyHash=hash(bytes);
    const expected=source.response?.sha256||source.bodySha256||(source.bodyBase64?declaredHash:null);
    if(expected&&expected!==bodyHash){issues.push(makeIssue('SOURCE_HASH_MISMATCH','Selected source bytes do not match their retained identity',{sourceId:id,expected,actual:bodyHash}));return {id,source,invalid:true,content:null,index:{id,declaredSha256:declaredHash,sha256:bodyHash,bytes:bytes.length,observedAt,kind:source.kind||null,invalid:true}};}
  }
  if(content===undefined&&bytes)content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(typeof content==='string'){
    if(!bytes){bytes=Buffer.from(content,'utf8');bodyHash=hash(bytes);}
    try{content=parseTurbolongOriginalJSON(content).value;}catch{
      const rows=[];let line=0;const originalText=content,declaredJsonl=/jsonl|history/.test(String(source.kind||'')+' '+String(source.contentType||''));
      for(const raw of content.split(/\r?\n/)){line++;if(!raw.trim())continue;const selected=raw.startsWith('[route] ')?raw.slice(8):raw;if(!declaredJsonl&&!selected.trim().startsWith('{'))continue;
        try{const row=parseTurbolongOriginalJSON(selected).value;need(plain(row),'Each original history line must contain a JSON object');rows.push({...row,__sourceLine:line});}
        catch(error){parseErrors.push({line,message:error.message,rawLineSha256:hash(raw)});}
      }
      content=rows.length||declaredJsonl?{kind:source.kind||'keeper.history',rows,errors:parseErrors}:{kind:source.kind||'unstructured',text:originalText};
    }
  }
  if(!plain(content)&&!Array.isArray(content)){issues.push(makeIssue('SOURCE_NOT_STRUCTURED','Selected source does not contain structured operating records',{sourceId:id}));content={kind:source.kind||'unstructured',value:content??null};}
  return {id,source,invalid:false,content,parseErrors,index:{id,declaredSha256:declaredHash,sha256:bodyHash||hash(canonical(content)),contentSha256:hash(canonical(content)),bytes:bytes?.length??null,observedAt,kind:source.kind||content.kind||null,network:source.network||content.network||null,action:source.action||content.action||null,acquisitionId:source.acquisitionId||null,operationId:source.operationId||content.executionId||null,original:source.original||null,coverage:source.coverage||content.coverage||null,parseErrors,request:source.request?{method:source.request.method,url:source.request.url||null,path:source.request.path||null,endpointSha256:source.request.endpointSha256||null}:null}};
}
function classify(row,hint){
  if(!plain(row))return null;
  if(row.recorded_at!==undefined&&row.pool_id!==undefined&&row.asset_symbol!==undefined)return 'snapshot';
  if(row.chosen!==undefined&&(row.strategy_id!==undefined||row.amount_in!==undefined))return 'route';
  if(row.surfaceId!==undefined&&typeof row.healthy==='boolean')return 'surface';
  if(row.dimension!==undefined&&typeof row.healthy==='boolean')return 'health';
  if(row.action!==undefined&&(row.strategy!==undefined||row.vault!==undefined||hint?.includes('rebalance')))return 'keeper';
  if((hint?.includes('transaction')||row.kind==='transaction.record')&&(row.hash||row.txHash))return 'transaction';
  if(row.ledger!==undefined&&row.topic!==undefined&&(row.txHash||row.contractId))return 'event';
  return null;
}
function extractRows(material,issues){
  const rows=[],aggregates=[],other=[],source=material.source,visited=new Set();
  function visit(content,hint,context={},path='content'){
    if(content===null||content===undefined)return;
    if(Array.isArray(content)){for(let i=0;i<content.length;i++)visit(content[i],hint,context,path+'['+i+']');return;}
    if(!plain(content))return;
    if(visited.has(content))return;visited.add(content);
    const kind=content.kind||hint||source.kind||'',scope={...context,network:content.network||context.network||source.network||null,coverage:content.coverage||context.coverage||source.coverage||null,original:content.original||context.original||source.original||(content.executionId?{action:content.action||null,executionId:content.executionId}:null)};
    if(content.report&&Array.isArray(content.rows))aggregates.push({sourceId:material.id,kind:'all-time-route-aggregate',report:clone(content.report),coverage:scope.coverage});
    const actual=classify(content,kind);
    if(actual){
      const copy=clone(content),line=copy.__sourceLine;delete copy.__sourceLine;
      const operationId=source.operationId||context.operationId||scope.original?.executionId||null;
      rows.push({recordId:'row-'+hash(canonical({sourceId:material.id,path,row:copy})),kind:actual,row:copy,sourceId:material.id,sourceSha256:material.index.sha256,sourcePath:path,line:line??null,observedAt:material.index.observedAt,network:copy.network||scope.network||null,coverage:scope.coverage,original:scope.original,operationId,action:source.action||scope.original?.action||context.action||null});
      return;
    }
    const arrays=[['snapshots','rates.snapshots'],['rows',kind],['events','network.events'],['observations',kind],['records',kind]];
    let handled=false;
    for(const [key,nextHint]of arrays)if(Array.isArray(content[key])){handled=true;for(let i=0;i<content[key].length;i++)visit(content[key][i],nextHint,{...scope,operationId:content.executionId||content.operationId||context.operationId,action:content.action||context.action},path+'.'+key+'['+i+']');}
    if(Array.isArray(content.operating?.health)){handled=true;visit(content.operating.health,'operating.health',scope,path+'.operating.health');}
    if(content.content!==undefined){handled=true;visit(content.content,kind,scope,path+'.content');}
    if(content.parsed!==undefined){handled=true;visit(content.parsed,kind,{...scope,operationId:content.executionId||content.operationId||context.operationId,action:content.action||context.action},path+'.parsed');}
    if(content.errors?.length)for(const error of content.errors)issues.push(makeIssue('ORIGINAL_RECORD_ERROR','Original operating source contains an error or unfinished line',{sourceId:material.id,path,error}));
    if(!handled)other.push({sourceId:material.id,path,kind,content:clone(content)});
  }
  if(!material.invalid)visit(material.content,source.kind);
  return {rows,aggregates,other};
}
function rowTime(record){
  const row=record.row;
  if(record.kind==='snapshot')return parseTime(row.recorded_at,{allowEpoch:true});
  if(record.kind==='event')return parseTime(row.ledgerClosedAt||row.closed_at,{allowEpoch:true});
  if(record.kind==='transaction')return parseTime(row.record?.created_at||row.record?.createdAt||row.createdAt,{allowEpoch:true});
  return parseTime(row.ts??row.timestamp??row.observedAt??row.created_at,{allowEpoch:true});
}
function originalKey(record){
  const row=record.row,net=record.network||'unknown';
  if(record.kind==='snapshot')return [net,'snapshot',row.pool_id,row.asset_symbol,String(row.id??row.recorded_at)].join('|');
  if(record.kind==='route'){
    const tx=row.tx_hash||row.txHash,normalized=typeof tx==='string'&&/^[a-fA-F0-9]{64}$/.test(tx)?tx.toLowerCase():null;
    if(normalized)return [net,'route-transaction',normalized,row.strategy_id||row.strategy||'',row.asset_symbol||'',row.chosen||'',decimal(row.amount_in)||''].join('|');
    if(row.id!==undefined)return [net,'route-id',record.original?.repository||'worker',String(row.id)].join('|');
    return net+'|route-row|'+hash(canonical(row));
  }
  if(record.kind==='event')return [net,'event',row.id||hash(canonical(row))].join('|');
  if(record.kind==='transaction')return [net,'transaction',String(row.hash||row.txHash).toLowerCase()].join('|');
  if(record.kind==='surface')return [net,'surface',row.surfaceId,row.observedAt].join('|');
  if(record.kind==='health')return [net,'health',row.dimension,row.strategyId||row.vaultId||'',row.observedAt].join('|');
  return net+'|'+record.kind+'|'+hash(canonical(row));
}
function comparable(record){
  const r=record.row;
  if(record.kind==='route')return {network:record.network,strategy:r.strategy_id||r.strategy||null,asset:r.asset_symbol||null,chosen:r.chosen,status:r.status,amountIn:decimal(r.amount_in),brokerQuote:decimal(r.broker_quote),soroswapQuote:decimal(r.soroswap_quote),minimumOut:decimal(r.amount_out_min),executedOut:decimal(r.executed_out),upliftBps:r.uplift_bps??null,slippageBps:r.slippage_bps??null,txHash:(r.tx_hash||r.txHash||'').toLowerCase()};
  if(record.kind==='transaction')return {network:record.network,hash:(r.hash||r.txHash||'').toLowerCase(),status:r.status,successful:r.successful??(r.status==='SUCCESS'?true:r.status==='FAILED'?false:null)};
  if(record.kind==='snapshot'){const v={...r};if(v.id!==undefined)v.id=String(v.id);return v;}
  return r;
}
function deduplicate(records,issues){
  const map=new Map();
  for(const record of records){
    const key=originalKey(record),fingerprint=hash(canonical(comparable(record))),existing=map.get(key);
    const occurrence={recordId:record.recordId,sourceId:record.sourceId,sourceSha256:record.sourceSha256,sourcePath:record.sourcePath,line:record.line,observedAt:record.observedAt,operationId:record.operationId,action:record.action,original:record.original,row:record.row};
    if(!existing)map.set(key,{...record,key,fingerprint,occurrences:[occurrence],conflicted:false,excluded:false,annotations:[]});
    else{
      existing.occurrences.push(occurrence);
      const oldTerminal=existing.kind==='transaction'&&['SUCCESS','FAILED'].includes(existing.row.status),newTerminal=record.kind==='transaction'&&['SUCCESS','FAILED'].includes(record.row.status);
      const transactionProgress=record.kind==='transaction'&&(!oldTerminal||!newTerminal);
      if(transactionProgress&&newTerminal&&!oldTerminal){existing.row=record.row;existing.sourceId=record.sourceId;existing.fingerprint=fingerprint;existing.original=record.original;}
      if(existing.fingerprint!==fingerprint&&!transactionProgress){existing.conflicted=true;issues.push(makeIssue('CONFLICTING_ORIGINAL_ROWS','The same original record has conflicting retained values',{kind:record.kind,key,sourceIds:[...new Set(existing.occurrences.map(x=>x.sourceId))]}));}
      if(!transactionProgress&&rowTime(record)!==null&&(rowTime(existing)===null||rowTime(record)<rowTime(existing))){existing.row=record.row;existing.sourceId=record.sourceId;existing.sourcePath=record.sourcePath;existing.line=record.line;}
    }
  }
  return [...map.values()];
}
function applyCorrections(records,corrections,sourceIds,issues){
  const outcomes=[],dataActions=new Set(['exclude','include','annotate','link-harvest','replace-source']),completed=new Set(['IMPLEMENTED','VERIFIED','APPLIED']),pending=new Set(['PROPOSED','IN_PROGRESS','AWAITING_OUTCOME','REJECTED']);
  const ordered=corrections.map((input,i)=>{
    need(plain(input),'Each selected correction must be an object');
    const history=Array.isArray(input.history)?input.history.filter(plain):[],latest=history.at(-1)||{};
    const current={...latest,...input,__inputOrder:i};
    current.__effectiveAt=current.appliedAt||current.verifiedAt||current.updatedAt||latest.at||current.createdAt||null;
    return current;
  }).sort((a,b)=>(parseTime(a.__effectiveAt)||0)-(parseTime(b.__effectiveAt)||0)||a.__inputOrder-b.__inputOrder);
  for(const correction of ordered){
    const id=correction.id||'correction-'+correction.__inputOrder,action=correction.action||correction.operation||null,status=correction.status===undefined?null:String(correction.status).toUpperCase();
    const stored={...correction,id,action,applied:false,application:'RECORDED',matchedRecordIds:[]};delete stored.__inputOrder;delete stored.__effectiveAt;
    outcomes.push(stored);
    const problem=(code,message,detail={})=>{stored.application='INVALID';issues.push(makeIssue(code,message,{correctionId:id,...detail}));};
    if(status!==null&&pending.has(status)){stored.application=status==='REJECTED'?'REJECTED':'PENDING';continue;}
    if(status!==null&&!completed.has(status)){problem('UNKNOWN_CORRECTION_STATUS','Correction status must describe recorded, implemented or verified work',{status});continue;}
    if(action===null)continue;
    if(!dataActions.has(action)){problem('UNKNOWN_CORRECTION','Correction action is not supported',{action});continue;}
    const target=correction.target??{sourceId:correction.sourceId,sourceIds:correction.sourceIds,key:correction.rowKey,rowId:correction.rowId};
    if(!plain(target)){problem('CORRECTION_TARGET_INVALID','Correction target must select retained source or row identifiers');continue;}
    const selectedSources=target.sourceId?[target.sourceId]:(target.sourceIds||[]),selectedRows=target.rowId?[target.rowId]:(target.rowIds||[]);
    if(!Array.isArray(selectedSources)||!selectedSources.every(v=>typeof v==='string'&&v)||!Array.isArray(selectedRows)||!selectedRows.every(v=>typeof v==='string'&&v)){problem('CORRECTION_TARGET_INVALID','Correction source and row identifiers must be explicit strings');continue;}
    const sourceSet=new Set(selectedSources),rowSet=new Set(selectedRows);
    const selectedOccurrence=o=>(!sourceSet.size||sourceSet.has(o.sourceId))&&(!rowSet.size||rowSet.has(o.recordId));
    const hasTarget=!!target.key||sourceSet.size>0||rowSet.size>0;
    if(!hasTarget){if(action==='annotate')continue;problem('CORRECTION_TARGET_REQUIRED','A row-changing correction must select an exact retained source or row');continue;}
    const reason=correction.reason||correction.note;
    if(typeof reason!=='string'||!reason.trim()){problem('CORRECTION_REASON_REQUIRED','An applied operating correction requires its explanation');continue;}
    const matched=records.filter(r=>(!target.kind||target.kind===r.kind)&&(!target.key||target.key===r.key)&&r.occurrences.some(selectedOccurrence));
    if(!matched.length){problem('CORRECTION_TARGET_MISSING','Correction target is outside this selected source edition',{target});continue;}
    if(action==='replace-source'){
      if(!sourceIds.has(correction.replacementSourceId)){problem('REPLACEMENT_SOURCE_MISSING','Replacement requires its complete selected source',{replacementSourceId:correction.replacementSourceId||null});continue;}
      if(matched.some(r=>r.occurrences.some(o=>o.sourceId===correction.replacementSourceId&&selectedOccurrence(o)))){problem('REPLACEMENT_SOURCE_IS_TARGET','Replacement must preserve the separately selected replacement source',{replacementSourceId:correction.replacementSourceId});continue;}
    }
    if(action==='link-harvest'&&(typeof correction.harvestId!=='string'||!correction.harvestId.trim())){problem('HARVEST_LINK_REQUIRED','Harvest correlation requires its retained group identifier');continue;}
    for(const record of matched){
      if(action==='exclude'||action==='replace-source'||action==='include'){
        for(const occurrence of record.occurrences.filter(selectedOccurrence))occurrence.excluded=action!=='include';
        const active=record.occurrences.filter(o=>!o.excluded);
        record.excluded=active.length===0;record.conflicted=false;
        if(active.length){
          const fingerprints=new Set(active.map(o=>hash(canonical(comparable({...record,row:o.row})))));
          const terminal=record.kind==='transaction'?active.filter(o=>['SUCCESS','FAILED'].includes(o.row.status)):[];
          record.conflicted=record.kind==='transaction'?new Set(terminal.map(o=>o.row.status)).size>1:fingerprints.size>1;
          const chosen=terminal.at(-1)||active[0];
          for(const key of ['row','sourceId','sourceSha256','sourcePath','line','original','operationId','action'])record[key]=chosen[key]??null;
          record.fingerprint=hash(canonical(comparable(record)));
        }
      }
      if(action==='link-harvest')record.correctedHarvestId=correction.harvestId;
      record.annotations.push({correctionId:id,action,reason,status,effectiveAt:correction.__effectiveAt,createdAt:correction.createdAt||null,harvestId:correction.harvestId||null,replacementSourceId:correction.replacementSourceId||null});
    }
    stored.applied=true;stored.application='APPLIED';stored.matchedRecordIds=matched.map(r=>r.recordId);stored.target=clone(target);
  }
  for(const issue of issues.filter(i=>i.code==='CONFLICTING_ORIGINAL_ROWS')){
    const record=records.find(r=>r.key===issue.key);
    issue.active=!!record?.conflicted;
    if(!issue.active)issue.resolvedBy=[...new Set((record?.annotations||[]).filter(a=>['exclude','include','replace-source'].includes(a.action)).map(a=>a.correctionId))];
  }
  return outcomes;
}
function selectedIncident(input){
  need(plain(input),'Each selected incident must be an object');
  const history=Array.isArray(input.history)?input.history.filter(plain):[],latest=history.at(-1)||{},current={...latest,...input};
  if(!current.startedAt&&!current.openedAt){
    const originalStart=history.find(entry=>entry.startedAt||entry.openedAt);
    current.startedAt=originalStart?.startedAt||originalStart?.openedAt||history[0]?.at||current.createdAt||null;
    current.startedAtBasis=originalStart?'original recorded incident time':'recorded opening event';
  }
  if(String(current.status||'').toUpperCase()==='RESOLVED'&&!current.resolvedAt&&!current.closedAt){
    let resolution=null;
    for(const entry of history){if(String(entry.status||'').toUpperCase()==='RESOLVED'){if(!resolution)resolution=entry;}else if(entry.status)resolution=null;}
    current.resolvedAt=resolution?.resolvedAt||resolution?.closedAt||resolution?.at||current.updatedAt||null;
    current.resolvedAtBasis='recorded resolution event';
  }
  return current;
}

function coverageStats(times,start,end,cadenceSeconds){
  const duration=end-start,sorted=[...new Set(times.filter(t=>t>=start&&t<end))].sort((a,b)=>a-b);
  if(!cadenceSeconds)return {observations:sorted.length,firstAt:sorted.length?new Date(sorted[0]).toISOString():null,lastAt:sorted.length?new Date(sorted.at(-1)).toISOString():null,expectedSlots:null,observedSlots:null,coverageRatio:null,missing:[]};
  const interval=cadenceSeconds*1000,expected=Math.ceil(duration/interval),slots=[...new Set(sorted.map(t=>Math.floor((t-start)/interval)))].sort((a,b)=>a-b),missing=[];
  let prior=-1;
  for(const slot of [...slots,expected]){
    if(slot>prior+1){const a=start+(prior+1)*interval,b=Math.min(end,start+slot*interval);missing.push({startsAt:new Date(a).toISOString(),endsAt:new Date(b).toISOString(),missingSlots:slot-prior-1,durationSeconds:(b-a)/1000});}
    prior=slot;
  }
  return {observations:sorted.length,firstAt:sorted.length?new Date(sorted[0]).toISOString():null,lastAt:sorted.length?new Date(sorted.at(-1)).toISOString():null,expectedSlots:expected,observedSlots:slots.length,coverageRatio:expected?slots.length/expected:1,missing};
}
function dailyStats(records,dates,cadenceSeconds,predicate=()=>true){
  const byDay=new Map();
  for(const record of records){const t=record.time;if(t===null||t===undefined)continue;const key=new Date(t).toISOString().slice(0,10);if(!byDay.has(key))byDay.set(key,[]);byDay.get(key).push(record);}
  return dates.map(day=>{const selected=byDay.get(day.date)||[],pass=selected.filter(predicate),stats=coverageStats(selected.map(r=>r.time),day.start,day.end,cadenceSeconds);return {date:day.date,startsAt:day.startsAt,endsAt:day.endsAt,fullDay:day.fullDay,...stats,passingObservations:pass.length,failingObservations:selected.length-pass.length,green:stats.expectedSlots!==null&&stats.observedSlots===stats.expectedSlots&&selected.length>0&&pass.length===selected.length};});
}
function longestDays(days,predicate){
  let current=0,best=0,from=null,bestFrom=null,bestTo=null;
  for(const day of days){if(day.fullDay&&predicate(day)){current++;if(from===null)from=day.date;if(current>best){best=current;bestFrom=from;bestTo=day.date;}}else{current=0;from=null;}}
  return {days:best,startsOn:bestFrom,endsOn:bestTo};
}
function rateAnalysis(records,vaults,period,dates,issues){
  const groups=new Map(),required=new Set();
  for(const vault of vaults){const pool=vault.poolId||vault.pool_id,asset=vault.assetSymbol||vault.asset_symbol||vault.symbol;if(pool&&asset){const key=pool+'|'+asset;required.add(key);if(!groups.has(key))groups.set(key,{poolId:pool,assetSymbol:asset,records:[]});}}
  for(const record of records.filter(r=>r.kind==='snapshot')){
    const row=record.row,key=row.pool_id+'|'+row.asset_symbol;
    if(!groups.has(key))groups.set(key,{poolId:row.pool_id,assetSymbol:row.asset_symbol,records:[]});
    groups.get(key).records.push(record);
  }
  const fields=['net_supply_apr','net_borrow_cost','interest_supply_apr','interest_borrow_apr','blnd_supply_apr','blnd_borrow_apr','util','c_factor'],series=[];
  for(const [key,group]of groups){
    const ordered=group.records.sort((a,b)=>a.time-b.time),stats=coverageStats(ordered.map(r=>r.time),Date.parse(period.startsAt),Date.parse(period.endsAt),period.expectedSnapshotIntervalSeconds),daily=dailyStats(ordered,dates,period.expectedSnapshotIntervalSeconds);
    const values={};for(const field of fields)values[field]=metric(ordered.map(r=>finite(r.row[field])));
    for(const record of ordered)for(const field of fields)if(record.row[field]!==undefined&&record.row[field]!==null&&finite(record.row[field])===null)issues.push(makeIssue('INVALID_RATE_VALUE','Original rate field is not a finite numeric observation',{recordId:record.recordId,sourceId:record.sourceId,field,value:record.row[field]}));
    const first=ordered[0]?.time,last=ordered.at(-1)?.time,span=first===undefined?0:Math.min(Date.parse(period.endsAt),last+period.expectedSnapshotIntervalSeconds*1000)-first;
    series.push({key,poolId:group.poolId,assetSymbol:group.assetSymbol,required:required.has(key),...stats,availableHistoryDays:span/DAY,observedUtcDays:daily.filter(d=>d.observations>0).length,longestDailyHistory:longestDays(daily,d=>d.observations>0),longestCompleteDailyHistory:longestDays(daily,d=>d.green),daily,fields:values,records:ordered.map(r=>r.recordId)});
  }
  return {kind:'rate-history',cadenceSeconds:period.expectedSnapshotIntervalSeconds,series,requiredSeries:[...required],scope:required.size?'declared vault pool and asset pairs':'observed pool and asset pairs',units:'APR, utilization and collateral factor values retain the original source units',sourceRows:records.filter(r=>r.kind==='snapshot').length};
}
function transactionRegistry(records){
  const map=new Map();
  for(const record of records.filter(r=>r.kind==='transaction'&&!r.conflicted&&!r.excluded)){
    const row=record.row,hashValue=String(row.hash||row.txHash||'').toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(hashValue))continue;
    const value={hash:hashValue,network:record.network,status:row.status,successful:row.successful??(row.status==='SUCCESS'?true:row.status==='FAILED'?false:null),sourceId:record.sourceId,recordId:record.recordId,provider:row.provider||null,time:rowTime(record),original:row.record||row};
    const key=record.network+'|'+hashValue,previous=map.get(key);
    if(!previous||value.successful!==null&&previous.successful===null)map.set(key,value);
  }
  return map;
}
function harvestGroup(record){
  if(record.correctedHarvestId)return {id:record.network+'|correlation|'+record.correctedHarvestId,basis:'recorded correction',corrections:record.annotations.filter(a=>a.action==='link-harvest').map(a=>a.correctionId)};
  const row=record.row,provided=row.harvest_id||row.harvestId||row.claim_tx||row.harvest_claim_tx;
  if(typeof provided==='string'&&provided.length)return {id:record.network+'|original-harvest|'+provided,basis:'original harvest or claim identifier'};
  for(const occurrence of record.occurrences){
    const original=occurrence.original||{},action=occurrence.action||original.action,executionId=original.executionId||occurrence.operationId;
    if(action==='keeper.harvest.execute'&&executionId&&!original.argv?.includes('--loop'))return {id:record.network+'|native-pass|'+executionId+'|'+(row.strategy_id||row.strategy||''),basis:'original single-pass execution and strategy',executionId};
  }
  return null;
}
function routeAnalysis(records,registry,period,issues){
  const entries=[],groups=new Map(),totals=new Map(),verifiedTransactions=new Set(),eligibleTransactions=new Set();
  for(const record of records.filter(r=>r.kind==='route')){
    const row=record.row,hashValue=typeof(row.tx_hash||row.txHash)==='string'?(row.tx_hash||row.txHash).toLowerCase():null,tx=hashValue?registry.get(record.network+'|'+hashValue):null;
    const executed=row.status==='executed',hasBothQuotes=exactPositive(row.broker_quote)&&exactPositive(row.soroswap_quote),verified=executed&&tx?.successful===true,group=harvestGroup(record);
    const amountIn=decimal(row.amount_in),executedOut=decimal(row.executed_out),minimumOut=decimal(row.amount_out_min),broker=decimal(row.broker_quote),soro=decimal(row.soroswap_quote);
    if(amountIn===null)issues.push(makeIssue('INVALID_ROUTE_AMOUNT','Route input amount is not an exact integer string',{recordId:record.recordId,sourceId:record.sourceId,value:row.amount_in}));
    let quoteSelectionMatchesMaximum=null;
    if(row.status==='quote_only'&&broker!==null&&soro!==null&&BigInt(broker)>0n&&BigInt(soro)>0n)quoteSelectionMatchesMaximum=row.chosen===(BigInt(broker)>BigInt(soro)?'broker':'soroswap');
    if(quoteSelectionMatchesMaximum===false)issues.push(makeIssue('QUOTE_SELECTION_DIFFERS','Original quote-only selection differs from its retained quotes',{recordId:record.recordId,reason:row.reason||null}));
    let floorCheck='UNAVAILABLE';
    if(executedOut!==null&&minimumOut!==null&&row.chosen==='soroswap')floorCheck=BigInt(executedOut)>=BigInt(minimumOut)?'SATISFIED':'BELOW_RECORDED_FLOOR';
    if(row.chosen==='broker')floorCheck='ORIGINAL_PARTIAL_FILL_CONTEXT';
    if(floorCheck==='BELOW_RECORDED_FLOOR')issues.push(makeIssue('SETTLEMENT_FLOOR_DIFFERENCE','Soroswap output is below the recorded minimum; inspect the complete original transaction and row',{recordId:record.recordId,txHash:hashValue,executedOut,minimumOut}));
    if(executed&&tx?.successful===false)issues.push(makeIssue('EXECUTION_STATUS_CONFLICT','An executed route row resolves to a failed original transaction',{recordId:record.recordId,txHash:hashValue,transactionRecordId:tx.recordId}));
    const entry={recordId:record.recordId,sourceId:record.sourceId,key:record.key,network:record.network,strategyId:row.strategy_id||row.strategy||null,assetSymbol:row.asset_symbol||null,at:record.time===null?null:new Date(record.time).toISOString(),timestampBasis:record.timestampBasis||'original row',status:row.status||null,chosen:row.chosen||null,reason:row.reason||null,amountIn,brokerQuote:broker,soroswapQuote:soro,minimumOut,executedOut,upliftBps:finite(row.uplift_bps),slippageBps:finite(row.slippage_bps),txHash:hashValue,transactionStatus:tx?.status||null,transactionRecordId:tx?.recordId||null,transactionVerified:verified,hasBothQuotes,harvestGroup:group,quoteSelectionMatchesMaximum,settlementFloorCheck:floorCheck,originalMetricsPreserved:true};
    entries.push(entry);
    if(verified){
      verifiedTransactions.add(hashValue);
      if(record.network==='mainnet'&&hasBothQuotes)eligibleTransactions.add(hashValue);
      const asset=entry.assetSymbol||'unknown';if(!totals.has(asset))totals.set(asset,{assetSymbol:asset,inputBlnd:'0',outputUnderlying:'0',rows:0,amountRows:0});
      const total=totals.get(asset);total.rows++;if(amountIn!==null)total.inputBlnd=(BigInt(total.inputBlnd)+BigInt(amountIn)).toString();if(executedOut!==null){total.outputUnderlying=(BigInt(total.outputUnderlying)+BigInt(executedOut)).toString();total.amountRows++;}
    }
    if(group){
      if(!groups.has(group.id))groups.set(group.id,{...group,network:record.network,strategyId:entry.strategyId,records:[],transactionHashes:[],verifiedEligibleTransactions:[],recordedStatuses:[]});
      const g=groups.get(group.id);g.records.push(record.recordId);if(hashValue&&!g.transactionHashes.includes(hashValue))g.transactionHashes.push(hashValue);if(verified&&record.network==='mainnet'&&hasBothQuotes&&!g.verifiedEligibleTransactions.includes(hashValue))g.verifiedEligibleTransactions.push(hashValue);if(!g.recordedStatuses.includes(row.status))g.recordedStatuses.push(row.status);
    }
  }
  const harvests=[...groups.values()].map(g=>({...g,eligible:g.network==='mainnet'&&g.verifiedEligibleTransactions.length>0}));
  const linkedTransactions=new Set(harvests.flatMap(g=>g.verifiedEligibleTransactions));
  return {kind:'harvest-routing',rows:entries.length,recordedExecutedRows:entries.filter(r=>r.status==='executed').length,quoteOnlyRows:entries.filter(r=>r.status==='quote_only').length,failedRows:entries.filter(r=>r.status==='failed').length,verifiedSettlementTransactions:verifiedTransactions.size,verifiedMainnetTransactionsWithBothQuotes:eligibleTransactions.size,verifiedGroupedMainnetHarvests:harvests.filter(g=>g.eligible).length,unlinkedEligibleTransactions:[...eligibleTransactions].filter(tx=>!linkedTransactions.has(tx)),brokerSelections:entries.filter(r=>r.chosen==='broker').length,soroswapSelections:entries.filter(r=>r.chosen==='soroswap').length,upliftBps:metric(entries.filter(r=>r.transactionVerified).map(r=>r.upliftBps)),slippageBps:metric(entries.filter(r=>r.transactionVerified).map(r=>r.slippageBps)),amountsByAsset:[...totals.values()],entries,harvests,metricSemantics:'Preserve original uplift and slippage. Broker partial-fill rows can retain a full-claim quote while amount_in records only the filled portion. Exact amounts are added only within their asset and original units.'};
}
function keeperAnalysis(records,registry,dates,period){
  const rows=records.filter(r=>r.kind==='keeper').map(record=>{
    const r=record.row,hashValue=typeof r.tx==='string'?r.tx.toLowerCase():typeof r.tx_hash==='string'?r.tx_hash.toLowerCase():null,tx=hashValue?registry.get(record.network+'|'+hashValue):null;
    return {recordId:record.recordId,sourceId:record.sourceId,at:record.time===null?null:new Date(record.time).toISOString(),network:record.network,strategyId:r.strategy||r.strategy_id||null,assetSymbol:r.vault||r.asset_symbol||null,action:r.action,status:r.status||null,reason:r.reason||null,healthFactor:finite(r.hf),minimumHealthFactor:finite(r.min_hf),orangeHealthFactor:finite(r.orange_hf),targetHealthFactor:finite(r.target_hf),beforeHealthFactor:finite(r.before_hf),afterHealthFactor:finite(r.after_hf),configSource:r.config_source||r.configSource||null,repaid:decimal(r.repaid),borrowed:decimal(r.borrowed),txHash:hashValue,transactionStatus:tx?.status||null,transactionVerified:tx?.successful===true,error:r.error||null};
  });
  const byAction={};for(const row of rows)byAction[row.action]=(byAction[row.action]||0)+1;
  return {kind:'keeper-operations',rows:rows.length,byAction,verifiedMainnetRebalances:rows.filter(r=>r.network==='mainnet'&&r.action==='rebalance'&&r.transactionVerified).length,verifiedReleverages:rows.filter(r=>r.action==='releverage'&&r.transactionVerified).length,belowMinimumObservations:rows.filter(r=>r.healthFactor!==null&&r.minimumHealthFactor!==null&&r.healthFactor<r.minimumHealthFactor).length,errorRows:rows.filter(r=>r.error||['read_error','error'].includes(r.action)||['failed','timeout'].includes(r.status)).length,entries:rows,policy:'Original contract configuration, simulation, target and cooldown determine keeper actions.'};
}
function monitoringAnalysis(records,period,dates,incidents,rates){
  const observedSurfaces=[...new Set(records.filter(r=>r.kind==='surface').map(r=>r.row.surfaceId))],selected=period.surfaces.length?period.surfaces:observedSurfaces;
  const surfaces=selected.map(id=>{const rows=records.filter(r=>r.kind==='surface'&&r.row.surfaceId===id),daily=dailyStats(rows,dates,period.expectedSurfaceIntervalSeconds,r=>r.row.healthy===true);return {id,scopeDeclared:period.surfaces.includes(id),observations:rows.length,healthyObservations:rows.filter(r=>r.row.healthy===true).length,unhealthyObservations:rows.filter(r=>r.row.healthy!==true).length,daily,longestGreenDays:longestDays(daily,d=>d.green),latencyMs:metric(rows.map(r=>finite(r.row.durationMs)))};});
  const dimensions=period.healthDimensions.map(dimension=>{const rows=records.filter(r=>r.kind==='health'&&r.row.dimension===dimension),daily=dailyStats(rows,dates,period.expectedHealthIntervalSeconds,r=>r.row.healthy===true);return {dimension,observations:rows.length,healthyObservations:rows.filter(r=>r.row.healthy).length,daily};});
  const daily=dates.map((day,index)=>{
    const badIncidents=incidents.filter(i=>{
      const a=parseTime(i.startedAt||i.createdAt||i.openedAt),b=parseTime(i.resolvedAt||i.closedAt)||Infinity;
      const severe=['critical','high','p0','p1'].includes(String(i.severity||i.priority||'').toLowerCase());
      return severe&&a!==null&&a<day.end&&b>day.start;
    }).map(i=>i.id||null);
    const surfacesGreen=surfaces.length>0&&surfaces.every(s=>s.daily[index].green);
    const dimensionsGreen=dimensions.length>0&&dimensions.every(d=>d.daily[index].green);
    const selectedSeries=rates.requiredSeries.length?rates.series.filter(s=>s.required):rates.series;
    const snapshotsGreen=selectedSeries.length>0&&selectedSeries.every(s=>s.daily[index].green);
    return {date:day.date,startsAt:day.startsAt,endsAt:day.endsAt,fullDay:day.fullDay,surfacesGreen,dimensionsGreen,snapshotsGreen,incidentIds:badIncidents,operatingGreen:period.surfaces.length>0&&surfacesGreen&&dimensionsGreen&&snapshotsGreen&&!badIncidents.length,missingSurfaces:surfaces.filter(s=>!s.daily[index].green).map(s=>s.id),missingDimensions:dimensions.filter(d=>!d.daily[index].green).map(d=>d.dimension)};
  });
  return {kind:'operating-watch',surfaceCadenceSeconds:period.expectedSurfaceIntervalSeconds||null,healthCadenceSeconds:period.expectedHealthIntervalSeconds||null,declaredSurfaces:period.surfaces,observedSurfaces,surfaces,healthDimensions:dimensions,daily,longestGreenSurfaceRun:longestDays(daily,d=>d.surfacesGreen),longestGreenOperatingRun:longestDays(daily,d=>d.operatingGreen),semantics:'Point observations establish their recorded time only. A full green day requires all declared cadence slots, original health dimensions, rate snapshots and no overlapping high-severity incident.'};
}
function acquisitionCoverage(materials){
  const groups=new Map(),files=[],windows=[];
  for(const m of materials){
    const c=m.index.coverage;
    if(c?.kind==='selected-original-file')files.push({sourceId:m.id,...c});
    if(c?.kind==='latest-window')windows.push({sourceId:m.id,...c});
    if(c?.kind!=='cursor-history')continue;
    let before=null;try{before=new URL(m.index.request?.url).searchParams.get('before');}catch{}
    const key=canonical({network:c.network,query:c.query||{}});if(!groups.has(key))groups.set(key,{network:c.network,query:c.query||{},pages:[]});
    groups.get(key).pages.push({sourceId:m.id,before,next:c.providerCursor===null?null:String(c.providerCursor),complete:c.complete===true,rows:c.returnedRows??null});
  }
  const histories=[...groups.values()].map(group=>{
    const byBefore=new Map();for(const page of group.pages){const key=page.before===null?'FIRST':String(page.before);if(!byBefore.has(key))byBefore.set(key,[]);byBefore.get(key).push(page);}
    const visited=new Set(),sourceIds=[],problems=[];let cursor='FIRST',complete=false;
    while(byBefore.has(cursor)){
      if(visited.has(cursor)){problems.push({code:'CURSOR_CYCLE',cursor});break;}visited.add(cursor);
      const candidates=byBefore.get(cursor),signatures=new Set(candidates.map(p=>canonical({next:p.next,rows:p.rows})));
      if(signatures.size>1){problems.push({code:'PAGE_GENERATIONS_DIFFER',cursor,sourceIds:candidates.map(p=>p.sourceId)});break;}
      const page=candidates[0];sourceIds.push(...candidates.map(p=>p.sourceId));
      if(page.next===null){complete=page.complete;break;}cursor=page.next;
    }
    if(!complete&&!problems.length)problems.push({code:cursor==='FIRST'?'FIRST_PAGE_NOT_SELECTED':'CONTINUATION_NOT_SELECTED',cursor});
    return {...group,complete,selectedChainSourceIds:sourceIds,problems};
  });
  return {snapshotHistories:histories,originalFiles:files,latestRouteWindows:windows};
}

export function analyseTurbolongPeriod({period,vaults=[],sources=[],incidents=[],corrections=[]}={}){
  const definition=validateTurbolongPeriod(period);need(Array.isArray(vaults)&&Array.isArray(sources)&&Array.isArray(incidents)&&Array.isArray(corrections),'vaults, sources, incidents and corrections must be arrays');
  const start=Date.parse(definition.startsAt),end=Date.parse(definition.endsAt),dates=daysBetween(start,end),issues=[];
  const selectedIncidents=incidents.map(selectedIncident);
  const materials=sources.map((source,index)=>{need(plain(source),'Each selected source must be an object');return parseMaterial(source,index,issues);});
  need(new Set(materials.map(m=>m.id)).size===materials.length,'Selected source IDs must be unique');
  const extracted=materials.map(m=>extractRows(m,issues)),allRows=extracted.flatMap(e=>e.rows),records=deduplicate(allRows,issues);
  const appliedCorrections=applyCorrections(records,corrections,new Set(materials.map(m=>m.id)),issues);
  const registry=transactionRegistry(records.filter(r=>r.network===definition.network));
  for(const record of records){
    let time=rowTime(record);record.timestampBasis='original row';
    if(record.kind==='route'&&record.row.status==='executed'){
      const txHash=String(record.row.tx_hash||record.row.txHash||'').toLowerCase(),transaction=registry.get(record.network+'|'+txHash);
      if(transaction?.successful!==null&&transaction?.time!==null&&transaction?.time!==undefined){time=transaction.time;record.timestampBasis='original transaction ledger time';}
    }
    record.time=time;record.at=time===null?null:new Date(time).toISOString();
    record.inPeriod=time!==null&&time>=start&&time<end;
    record.inNetwork=record.network===definition.network;
    record.included=record.inPeriod&&record.inNetwork&&!record.conflicted&&!record.excluded;
    record.selectionReasons=[...(time===null?['NO_ORIGINAL_TIME']:[]),...(!record.inPeriod&&time!==null?['OUTSIDE_PERIOD']:[]),...(!record.inNetwork?['OTHER_OR_UNDECLARED_NETWORK']:[]),...(record.conflicted?['CONFLICTING_ORIGINAL_VALUES']:[]),...(record.excluded?['RECORDED_CORRECTION']:[])];
    if(time===null&&record.kind!=='transaction')issues.push(makeIssue('ORIGINAL_TIMESTAMP_MISSING','Operating row needs its original event time for period totals',{recordId:record.recordId,sourceId:record.sourceId,kind:record.kind}));
    if(record.network===null)issues.push(makeIssue('SOURCE_NETWORK_UNDECLARED','Operating row has no retained network binding',{recordId:record.recordId,sourceId:record.sourceId}));
  }
  const included=records.filter(r=>r.included),rates=rateAnalysis(included,vaults,definition,dates,issues),routing=routeAnalysis(included,registry,definition,issues),keeper=keeperAnalysis(included,registry,dates,definition),monitoring=monitoringAnalysis(included,definition,dates,selectedIncidents,rates),coverage=acquisitionCoverage(materials);
  const selectedSeries=rates.requiredSeries.length?rates.series.filter(s=>s.required):rates.series,historyDays=selectedSeries.length?Math.min(...selectedSeries.map(s=>s.availableHistoryDays)):0;
  const targets=definition.acceptance;
  const acceptance=[
    {id:'executed-mainnet-harvests',name:'Executed mainnet harvests with both route quotes',target:targets.executedMainnetHarvests,observed:routing.verifiedGroupedMainnetHarvests,unit:'correlated harvests',status:definition.network==='mainnet'&&routing.verifiedGroupedMainnetHarvests>=targets.executedMainnetHarvests?'MET':'PROGRESS',details:{verifiedSettlementTransactions:routing.verifiedSettlementTransactions,verifiedTransactionsWithBothQuotes:routing.verifiedMainnetTransactionsWithBothQuotes,unlinkedEligibleTransactions:routing.unlinkedEligibleTransactions},source:{repository:TURBOLONG_ORIGINAL.repository,commit:TURBOLONG_ORIGINAL.commit,path:'docs/mainnet-go-live-runbook.md',section:'6. Stand up the keeper'}},
    {id:'rate-history',name:'Rate history across the selected series',target:targets.rateHistoryDays,observed:historyDays,unit:'days of available sampled history',status:selectedSeries.length>0&&historyDays>=targets.rateHistoryDays?'MET':'PROGRESS',details:{series:selectedSeries.map(s=>({key:s.key,availableHistoryDays:s.availableHistoryDays,observedUtcDays:s.observedUtcDays,coverageRatio:s.coverageRatio})),cadenceSeconds:definition.expectedSnapshotIntervalSeconds},source:{url:'https://communityfund.stellar.org/submissions/rec3XPXsjkWBdR107',section:'T2 historical APY acceptance'}},
    {id:'operating-watch',name:'Consecutive green days in the declared operating scope',target:targets.consecutiveGreenDays,observed:monitoring.longestGreenOperatingRun.days,unit:'complete UTC days',status:monitoring.longestGreenOperatingRun.days>=targets.consecutiveGreenDays?'MET':'PROGRESS',details:{run:monitoring.longestGreenOperatingRun,surfaceRun:monitoring.longestGreenSurfaceRun,surfaces:definition.surfaces,healthDimensions:definition.healthDimensions,surfaceCadenceSeconds:definition.expectedSurfaceIntervalSeconds||null,healthCadenceSeconds:definition.expectedHealthIntervalSeconds||null},source:{repository:TURBOLONG_ORIGINAL.repository,commit:TURBOLONG_ORIGINAL.commit,path:'docs/scf-t3-completion-report.md',section:'Mainnet-gated launch watch'}}
  ];
  const nextOperations=[],seenOperations=new Set();
  const offer=(action,args,reason,sourceIds=[])=>{const key=canonical({action,args});if(seenOperations.has(key))return;seenOperations.add(key);nextOperations.push({id:'operation-plan-'+hash(key),action,args,reason,sourceIds});};
  for(const entry of routing.entries)if(entry.status==='executed'&&entry.txHash&&/^[a-f0-9]{64}$/.test(entry.txHash)&&entry.transactionStatus!=='SUCCESS'&&entry.transactionStatus!=='FAILED')offer('transaction.inspect',{hash:entry.txHash,network:definition.network},'Resolve the retained executed route transaction',[entry.sourceId]);
  for(const entry of keeper.entries)if(entry.txHash&&/^[a-f0-9]{64}$/.test(entry.txHash)&&entry.transactionStatus!=='SUCCESS'&&entry.transactionStatus!=='FAILED')offer('transaction.inspect',{hash:entry.txHash,network:definition.network},'Resolve the retained original keeper transaction',[entry.sourceId]);
  for(const history of coverage.snapshotHistories)if(!history.complete){
    const gap=history.problems.find(p=>p.code==='FIRST_PAGE_NOT_SELECTED'||p.code==='CONTINUATION_NOT_SELECTED');
    if(gap){const args={network:definition.network,limit:500,startsAt:definition.startsAt,endsAt:definition.endsAt};if(history.query.pool_id)args.pool_id=history.query.pool_id;if(history.query.asset)args.asset=history.query.asset;if(gap.cursor!=='FIRST')args.before=gap.cursor;offer('snapshots.list',args,'Continue the exact retained snapshot cursor chain',history.pages.map(p=>p.sourceId));}
  }
  for(const series of rates.series)if(!series.observations)offer('snapshots.list',{pool_id:series.poolId,asset:series.assetSymbol,network:definition.network,limit:500,startsAt:definition.startsAt,endsAt:definition.endsAt},'Acquire the selected vault rate series');
  const sourceIndex=materials.map(m=>m.index),selection={period:definition,vaults:clone(vaults),sources:clone(sourceIndex),incidents:clone(incidents),corrections:clone(corrections)},selectionSha256=hash(canonical(selection));
  const observations=sourceIndex.map(s=>parseTime(s.observedAt)).filter(n=>n!==null),analysedAt=observations.length?new Date(observations.reduce((a,b)=>Math.max(a,b),-Infinity)).toISOString():definition.endsAt;
  return {schema:'stellar-forge.turbolong-operations-period-analysis.v1',id:'analysis-'+selectionSha256,selectionSha256,analysedAt,period:definition,original:TURBOLONG_ORIGINAL,vaults:clone(vaults),sourceIndex,coverage,summary:{selectedSources:sourceIndex.length,originalRows:allRows.length,distinctRecords:records.length,includedRecords:included.length,duplicateOccurrences:allRows.length-records.length,conflictingRecords:records.filter(r=>r.conflicted).length,correctedExclusions:records.filter(r=>r.excluded).length,outsidePeriodRecords:records.filter(r=>!r.inPeriod).length,rateSeries:rates.series.length,recordedExecutedRouteRows:routing.recordedExecutedRows,verifiedSettlementTransactions:routing.verifiedSettlementTransactions,verifiedGroupedMainnetHarvests:routing.verifiedGroupedMainnetHarvests,verifiedMainnetRebalances:keeper.verifiedMainnetRebalances,longestGreenOperatingDays:monitoring.longestGreenOperatingRun.days,issues:issues.filter(issue=>issue.active!==false).length,historicalIssues:issues.length,appliedCorrections:appliedCorrections.filter(c=>c.applied).length,recordedCorrections:appliedCorrections.length},acceptance,rates,routing,keeper,monitoring,transactions:[...registry.values()],events:included.filter(r=>r.kind==='event').map(r=>({recordId:r.recordId,sourceId:r.sourceId,network:r.network,...r.row})),incidents:clone(selectedIncidents),corrections:appliedCorrections,issues,allTimeRouteAggregates:extracted.flatMap(e=>e.aggregates),otherOriginalMaterial:extracted.flatMap(e=>e.other),records,nextOperations};
}
function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function csvCell(value){let text=value===null||value===undefined?'':typeof value==='object'?json(value):String(value);if(/^[=+@\t\r]/.test(text)||/^-.*[a-zA-Z(]/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;}
function csv(columns,rows){return '\ufeff'+[columns.map(c=>csvCell(c.title||c.key)).join(','),...rows.map(row=>columns.map(c=>csvCell(typeof c.value==='function'?c.value(row):row[c.key])).join(','))].join('\r\n')+'\r\n';}
function number(value,digits=3){if(typeof value!=='number'||!Number.isFinite(value))return value??'—';const text=value.toFixed(digits);return text.includes('.')?text.replace(/\.?0+$/,''):text;}
function ratio(value){return value===null||value===undefined?'—':number(value*100,2)+'%';}
function table(columns,rows){return '<div class="table"><table><thead><tr>'+columns.map(c=>'<th>'+escapeHTML(c.title||c.key)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+escapeHTML(typeof c.value==='function'?c.value(row):row[c.key]).replace(/\n/g,'<br>')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function plotRates(analysis,series){
  const records=analysis.records.filter(r=>r.included&&r.kind==='snapshot'&&r.row.pool_id===series.poolId&&r.row.asset_symbol===series.assetSymbol&&finite(r.row.net_supply_apr)!==null).sort((a,b)=>a.time-b.time);
  if(!records.length)return '';
  const width=760,height=180,left=52,right=18,top=16,bottom=30,start=Date.parse(analysis.period.startsAt),end=Date.parse(analysis.period.endsAt),values=records.map(r=>r.row.net_supply_apr),minimum=values.reduce((a,b)=>Math.min(a,b),Infinity),maximum=values.reduce((a,b)=>Math.max(a,b),-Infinity),span=maximum-minimum||Math.abs(maximum)*0.05||1;
  const x=t=>left+(t-start)/(end-start)*(width-left-right),y=v=>top+(maximum-v)/span*(height-top-bottom),paths=[];
  let current=[],previous=null;
  for(const record of records){if(previous!==null&&record.time-previous>analysis.period.expectedSnapshotIntervalSeconds*1500){if(current.length)paths.push(current.join(' '));current=[];}current.push(x(record.time).toFixed(2)+','+y(record.row.net_supply_apr).toFixed(2));previous=record.time;}
  if(current.length)paths.push(current.join(' '));
  return '<figure><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+escapeHTML(series.assetSymbol+' original net supply APR observations')+'"><path d="M'+left+' '+top+'V'+(height-bottom)+'H'+(width-right)+'" fill="none" stroke="#999"/>'+paths.map(points=>'<polyline points="'+points+'" fill="none" stroke="#222" stroke-width="1.2"/>').join('')+'<text x="4" y="'+(top+7)+'">'+escapeHTML(number(maximum,5))+'</text><text x="4" y="'+(height-bottom)+'">'+escapeHTML(number(minimum,5))+'</text><text x="'+left+'" y="'+(height-7)+'">'+escapeHTML(analysis.period.startsAt.slice(0,10))+'</text><text x="'+(width-right)+'" y="'+(height-7)+'" text-anchor="end">'+escapeHTML(analysis.period.endsAt.slice(0,10))+'</text></svg><figcaption>'+escapeHTML(series.assetSymbol+' · '+series.poolId+' · original net_supply_apr values; gaps remain open')+'</figcaption></figure>';
}
export function renderTurbolongReport(analysis,{name}={}){
  need(plain(analysis)&&analysis.schema==='stellar-forge.turbolong-operations-period-analysis.v1','A complete Turbolong period analysis is required');
  const title=typeof name==='string'&&name.trim()?name.trim():analysis.period.name,files=[];
  const add=(path,content,contentType)=>{const bytes=Buffer.byteLength(content,'utf8');files.push({path,content,contentType,bytes,sha256:hash(Buffer.from(content,'utf8'))});};
  add('period-analysis.json',JSON.stringify(analysis,null,2)+'\n','application/json');
  const basic=[{key:'recordId'},{key:'kind'},{key:'sourceId'},{key:'sourceSha256'},{key:'at'},{key:'network'},{key:'included'},{key:'conflicted'},{key:'excluded'},{key:'selectionReasons'},{key:'row',title:'original_json'},{key:'occurrences',title:'all_source_occurrences_json'},{key:'annotations',title:'correction_annotations_json'}];
  add('original-records.csv',csv(basic,analysis.records),'text/csv; charset=utf-8');
  add('source-index.csv',csv(['id','sha256','contentSha256','declaredSha256','bytes','kind','network','action','observedAt','operationId','coverage','original','request'].map(key=>({key})),analysis.sourceIndex),'text/csv; charset=utf-8');
  add('rate-snapshots.csv',csv([{key:'recordId'},{key:'sourceId'},{key:'network'},{key:'at'},{key:'included'},...['id','pool_id','asset_symbol','recorded_at','net_supply_apr','net_borrow_cost','interest_supply_apr','interest_borrow_apr','blnd_supply_apr','blnd_borrow_apr','util','c_factor'].map(key=>({key,value:r=>r.row[key]})),{key:'row',title:'original_json'}],analysis.records.filter(r=>r.kind==='snapshot')),'text/csv; charset=utf-8');
  add('harvest-routing.csv',csv(['recordId','sourceId','network','strategyId','assetSymbol','at','timestampBasis','status','chosen','reason','amountIn','brokerQuote','soroswapQuote','minimumOut','executedOut','upliftBps','slippageBps','txHash','transactionStatus','transactionVerified','hasBothQuotes','harvestGroup','settlementFloorCheck'].map(key=>({key})),analysis.routing.entries),'text/csv; charset=utf-8');
  add('keeper-operations.csv',csv(['recordId','sourceId','at','network','strategyId','assetSymbol','action','status','reason','healthFactor','minimumHealthFactor','orangeHealthFactor','targetHealthFactor','beforeHealthFactor','afterHealthFactor','configSource','repaid','borrowed','txHash','transactionStatus','transactionVerified','error'].map(key=>({key})),analysis.keeper.entries),'text/csv; charset=utf-8');
  add('operating-watch.csv',csv(['date','fullDay','surfacesGreen','dimensionsGreen','snapshotsGreen','operatingGreen','missingSurfaces','missingDimensions','incidentIds'].map(key=>({key})),analysis.monitoring.daily),'text/csv; charset=utf-8');
  add('transactions.csv',csv(['hash','network','status','successful','provider','sourceId','recordId','time','original'].map(key=>({key})),analysis.transactions),'text/csv; charset=utf-8');
  add('incidents-and-corrections.json',JSON.stringify({incidents:analysis.incidents,corrections:analysis.corrections,issues:analysis.issues},null,2)+'\n','application/json');
  add('next-operations.json',JSON.stringify({schema:'stellar-forge.turbolong-operations-follow-through.v1',analysisId:analysis.id,selectionSha256:analysis.selectionSha256,operations:analysis.nextOperations},null,2)+'\n','application/json');
  const rateDaily=analysis.rates.series.flatMap(s=>s.daily.map(d=>({poolId:s.poolId,assetSymbol:s.assetSymbol,...d})));
  add('rate-history-daily.csv',csv(['poolId','assetSymbol','date','observations','expectedSlots','observedSlots','coverageRatio','firstAt','lastAt','green','missing'].map(key=>({key})),rateDaily),'text/csv; charset=utf-8');
  const links=files.map(f=>'<li><a href="'+escapeHTML(f.path)+'">'+escapeHTML(f.path)+'</a> · '+f.bytes+' bytes</li>').join('');
  const period=analysis.period;
  let html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHTML(title)+'</title><style>body{font:14px/1.55 system-ui,sans-serif;color:#222;background:#fff;margin:0}main{max-width:1180px;margin:auto;padding:36px}h1{font-size:28px;line-height:1.2;margin:0 0 12px}h2{font-size:21px;border-top:1px solid #bbb;padding-top:24px;margin-top:36px}h3{font-size:16px}p,li{max-width:100ch}small,figcaption,.meta{color:#555}a{color:inherit;text-decoration:underline}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:12px}th,td{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{background:#f1f1f1;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ddd;padding:14px;background:#f7f7f7}code{overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:24px 0}.metric{border:1px solid #ccc;padding:15px}.metric strong{display:block;font-size:23px}.metric span{font-size:12px}figure{margin:24px 0}svg{display:block;width:100%;border:1px solid #ddd;font:10px system-ui,sans-serif}figcaption{font-size:12px;margin-top:6px}details{margin:14px 0}summary{cursor:pointer;font-weight:650}@media print{main{padding:0}.table{overflow:visible}h2{break-after:avoid}tr,figure,.metric{break-inside:avoid}a{text-decoration:none}details{display:block}} </style></head><body><main><header><p class="meta">TURBOLONG · OPERATIONS</p><h1>'+escapeHTML(title)+'</h1><p>'+escapeHTML(period.startsAt)+' to '+escapeHTML(period.endsAt)+' · '+escapeHTML(period.network)+' · end exclusive</p><p class="meta">Selected source edition: <code>'+escapeHTML(analysis.selectionSha256)+'</code><br>Latest selected observation: '+escapeHTML(analysis.analysedAt)+'</p></header>';
  html+='<section class="grid">'+[['Selected sources',analysis.summary.selectedSources],['Included operating records',analysis.summary.includedRecords],['Verified settlement transactions',analysis.routing.verifiedSettlementTransactions],['Correlated mainnet harvests',analysis.routing.verifiedGroupedMainnetHarvests],['Verified mainnet rebalances',analysis.keeper.verifiedMainnetRebalances],['Consecutive operating days',analysis.monitoring.longestGreenOperatingRun.days]].map(([label,value])=>'<div class="metric"><strong>'+escapeHTML(value)+'</strong><span>'+escapeHTML(label)+'</span></div>').join('')+'</section>';
  html+='<h2>Operating targets</h2>'+table([{key:'name',title:'Target'},{key:'observed',title:'Observed',value:r=>number(r.observed)},{key:'target',title:'Required'},{key:'unit',title:'Basis'},{key:'status',title:'Status'}],analysis.acceptance);
  html+='<h2>Rate history</h2><p>Snapshot cadence: '+period.expectedSnapshotIntervalSeconds+' seconds. Each series retains its complete original rows, provider pages and daily gaps. APR values use the original source units.</p>'+table([{key:'assetSymbol',title:'Asset'},{key:'poolId',title:'Pool'},{key:'observations',title:'Observations'},{key:'availableHistoryDays',title:'Available days',value:r=>number(r.availableHistoryDays)},{key:'coverageRatio',title:'Cadence coverage',value:r=>ratio(r.coverageRatio)},{title:'Net supply APR range',value:r=>number(r.fields.net_supply_apr.minimum,5)+' to '+number(r.fields.net_supply_apr.maximum,5)}],analysis.rates.series)+analysis.rates.series.map(s=>plotRates(analysis,s)).join('');
  html+='<h2>Harvest routing and settlement</h2><p>'+escapeHTML(analysis.routing.metricSemantics)+'</p><p>Verified mainnet settlement transactions with both quotes: '+analysis.routing.verifiedMainnetTransactionsWithBothQuotes+'. Correlated harvests: '+analysis.routing.verifiedGroupedMainnetHarvests+'. Transactions awaiting an original harvest correlation: '+analysis.routing.unlinkedEligibleTransactions.length+'.</p>'+table([{key:'at',title:'Time'},{key:'assetSymbol',title:'Asset'},{key:'chosen',title:'Route'},{key:'status',title:'Original status'},{key:'amountIn',title:'BLND input units'},{key:'executedOut',title:'Underlying output units'},{key:'slippageBps',title:'Original slippage bps'},{key:'transactionStatus',title:'Transaction'},{key:'txHash',title:'Hash'}],analysis.routing.entries);
  html+='<h2>Keeper operations</h2><p>'+escapeHTML(analysis.keeper.policy)+'</p>'+table([{key:'at',title:'Time'},{key:'assetSymbol',title:'Vault'},{key:'action',title:'Action'},{key:'status',title:'Original status'},{key:'healthFactor',title:'HF'},{key:'orangeHealthFactor',title:'Original orange HF'},{key:'configSource',title:'Threshold source'},{key:'transactionStatus',title:'Transaction'},{key:'txHash',title:'Hash'}],analysis.keeper.entries);
  html+='<h2>Operating watch</h2><p>'+escapeHTML(analysis.monitoring.semantics)+'</p>'+table([{key:'date',title:'UTC day'},{key:'fullDay',title:'Full day'},{key:'surfacesGreen',title:'Surfaces'},{key:'dimensionsGreen',title:'Operating dimensions'},{key:'snapshotsGreen',title:'Snapshots'},{key:'operatingGreen',title:'Complete day'},{key:'missingSurfaces',title:'Surface coverage',value:r=>r.missingSurfaces.join(', ')},{key:'missingDimensions',title:'Operating coverage',value:r=>r.missingDimensions.join(', ')},{key:'incidentIds',title:'Incidents',value:r=>r.incidentIds.join(', ')}],analysis.monitoring.daily);
  html+='<h2>Acquisition and source scope</h2>'+table([{title:'Query',value:r=>json(r.query)},{key:'complete',title:'Complete cursor chain'},{title:'Pages',value:r=>r.pages.length},{title:'Continuation details',value:r=>json(r.problems)}],analysis.coverage.snapshotHistories)+'<p>Original keeper files selected: '+analysis.coverage.originalFiles.length+'. Latest route windows selected: '+analysis.coverage.latestRouteWindows.length+'. Server route aggregates retain their all-time scope in the JSON edition.</p>';
  html+='<h2>Incidents and corrections</h2>'+table([{key:'code',title:'Finding'},{key:'active',title:'Active',value:row=>row.active===false?'Resolved':'Active'},{key:'message',title:'Detail'},{key:'sourceId',title:'Source'},{key:'recordId',title:'Record'},{key:'resolvedBy',title:'Resolved by correction'}],analysis.issues)+'<details><summary>Complete incident and correction history</summary><pre>'+escapeHTML(JSON.stringify({incidents:analysis.incidents,corrections:analysis.corrections},null,2))+'</pre></details>';
  html+='<h2>Prepared follow-through</h2>'+table([{key:'action',title:'Operation'},{key:'reason',title:'Purpose'},{title:'Selected arguments',value:r=>json(r.args)}],analysis.nextOperations);
  html+='<h2>Complete report files</h2><ul>'+links+'</ul><p class="meta">Original programme source: '+escapeHTML(TURBOLONG_ORIGINAL.repository)+' at <code>'+TURBOLONG_ORIGINAL.commit+'</code>. Exact original captures are retained under the source IDs in this edition and in its full workspace export.</p></main></body></html>\n';
  add('report.html',html,'text/html; charset=utf-8');
  const manifest={schema:'stellar-forge.turbolong-operations-report-members.v1',analysisId:analysis.id,selectionSha256:analysis.selectionSha256,name:title,files:files.map(({content,...f})=>f)};
  add('report-members.json',JSON.stringify(manifest,null,2)+'\n','application/json');
  return {schema:'stellar-forge.turbolong-operations-rendered-report.v1',name:title,analysisId:analysis.id,selectionSha256:analysis.selectionSha256,files,summary:clone(analysis.summary)};
}
