// MIT. Compare complete original API-pass snapshots without changing their allowance.
export const SERVICE_PERIOD_SCHEMA='stellar-forge.merchant-service-period.v1';
const NATIVE='stellar-forge.sf101.api-pass-export.v1';
const PERIOD_IDENTITY=['orderRef','eventId','routeId','method','network','amountAtomic','assetDigest','recipientDigest',
    'entitledAt','planId','planRevision','planSha256','manifestSha256','unitsPurchased'];
const RESERVED=new Set(['IN_FLIGHT','RECOVERY_REQUIRED']);
const USED=new Set(['COMPLETED','CONSUMED']);
const TRANSITIONS={
  IN_FLIGHT:new Set(['IN_FLIGHT','RECOVERY_REQUIRED','COMPLETED','CONSUMED','RELEASED']),
  RECOVERY_REQUIRED:new Set(['RECOVERY_REQUIRED','COMPLETED','CONSUMED','RELEASED']),
  CONSUMED:new Set(['CONSUMED','COMPLETED']),
  COMPLETED:new Set(['COMPLETED']),
  RELEASED:new Set(['RELEASED'])
};
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const copy=value=>JSON.parse(JSON.stringify(value));
const balance=order=>Object.fromEntries(['unitsPurchased','unitsUsed','unitsReserved','unitsRemaining'].map(key=>[key,order[key]]));
const durable=call=>Object.fromEntries(['requestId','routeId','method','path','requestSha256','units','storedStatus','revision','startedAt','deadlineAt','updatedAt','errorCode','result'].map(key=>[key,call[key]]));
const source=(usage,record)=>({
  id:record?.id??null,sha256:record?.sha256??null,sourceSchema:usage.sourceSchema,
  createdAt:usage.createdAt,revision:usage.revision
});
const amount=(call,kind)=>call&&(kind==='used'?USED:RESERVED).has(call.storedStatus)?BigInt(call.units):0n;
function completeNative(usage,name){
  need(usage?.sourceSchema===NATIVE&&Array.isArray(usage.orders)&&usage.orders.length===1&&
    usage.orders[0].callsComplete===true&&Array.isArray(usage.orders[0].calls),
    'COMPLETE_NATIVE_PERIOD_SOURCE_REQUIRED','Choose the complete original API-pass export for the '+name+' snapshot.');
  return usage.orders[0];
}
/** The exact immutable pass fields compared by the native service-period compiler. */
export function servicePeriodCaptureIdentity(usage){
  const order=completeNative(usage,'selected');
  need(typeof order.eventId==='string'&&typeof order.entitledAt==='string','SERVICE_PERIOD_ENTITLEMENT_REQUIRED',
    'Choose a snapshot of the original entitled API pass.');
  return Object.fromEntries(PERIOD_IDENTITY.map(key=>[key,order[key]]));
}
function callIndex(order){
  const result=new Map();
  for(const call of order.calls){
    need(!result.has(call.requestId),'DUPLICATE_PERIOD_CALL','The original period source repeats a request ID.');
    result.set(call.requestId,call);
  }
  return result;
}
function routeCounters(call){
  return {routeId:call.routeId,method:call.method,path:call.path,routeUnits:call.units,
    openingCalls:0,closingCalls:0,newCalls:0,changedCalls:0,resultRecoveries:0,
    openingUsedUnits:0n,closingUsedUnits:0n,openingReservedUnits:0n,closingReservedUnits:0n,
    admittedUnits:0n,consumedUnits:0n,releasedUnits:0n};
}
export function compileServicePeriod({opening,closing,openingSource=null,closingSource=null}){
  const first=completeNative(opening,'opening'),last=completeNative(closing,'closing');
  const from=Date.parse(opening.createdAt),until=Date.parse(closing.createdAt);
  need(Number.isFinite(from)&&Number.isFinite(until)&&until>from,'SERVICE_PERIOD_ORDER',
    'Choose a closing snapshot captured after the opening snapshot.');
  const identity=PERIOD_IDENTITY;
  need(identity.every(key=>first[key]===last[key]),'SERVICE_PERIOD_IDENTITY_CHANGED',
    'Both snapshots must describe the same original order, entitlement, purchased plan and allowance.');
  need(typeof first.eventId==='string'&&typeof first.entitledAt==='string','SERVICE_PERIOD_ENTITLEMENT_REQUIRED',
    'Choose snapshots of the original entitled API pass.');
  const before=callIndex(first),after=callIndex(last),routes=new Map(),calls=[];
  const counters={openingCalls:before.size,closingCalls:after.size,newCalls:0,changedCalls:0,unchangedCalls:0,
    carriedReservations:0,resultRecoveries:0,admittedUnits:0n,consumedUnits:0n,releasedUnits:0n};
  for(const id of before.keys())need(after.has(id),'SERVICE_PERIOD_CALL_MISSING',
    'The closing snapshot is missing an original opening call. Choose the complete continuation of that pass.');
  for(const [id,next] of after){
    const prior=before.get(id)??null;
    let changed=!prior;
    if(prior){
      for(const key of ['requestId','routeId','method','path','requestSha256','units','startedAt','deadlineAt']){
        need(prior[key]===next[key],'SERVICE_PERIOD_CALL_IDENTITY_CHANGED',
          'An original request changed its purchased route, unit price, request bytes or admission identity.');
      }
      need(TRANSITIONS[prior.storedStatus]?.has(next.storedStatus),'SERVICE_PERIOD_STATUS_REVERSED',
        'The closing call state does not continue the original native state.');
      need(next.revision>=prior.revision,'SERVICE_PERIOD_REVISION_REVERSED',
        'The closing source contains an earlier call revision.');
      changed=!equal(durable(prior),durable(next));
      need(!changed||next.revision>prior.revision,'SERVICE_PERIOD_REVISION_CHANGED',
        'A durable call changed without its original revision advancing.');
      if(['COMPLETED','RELEASED'].includes(prior.storedStatus)){
        need(!changed,'SERVICE_PERIOD_TERMINAL_CHANGED','A completed or released original call was rewritten.');
      }
    }
    const admitted=prior?0n:BigInt(next.units);
    const consumed=amount(next,'used')-amount(prior,'used');
    const released=next.storedStatus==='RELEASED'&&prior?.storedStatus!=='RELEASED'?BigInt(next.units):0n;
    const recovered=prior?.storedStatus==='CONSUMED'&&next.storedStatus==='COMPLETED';
    need(consumed>=0n,'SERVICE_PERIOD_CONSUMPTION_REVERSED','Consumed native allowance cannot disappear from a later snapshot.');
    if(recovered)need(next.result!==null,'SERVICE_PERIOD_RESULT_REQUIRED','The recovered native response metadata is missing.');
    const route=routes.get(next.routeId)??routeCounters(next);
    need(route.method===next.method&&route.path===next.path&&route.routeUnits===next.units,'SERVICE_PERIOD_ROUTE_CHANGED',
      'The period source differs from its immutable purchased route.');
    route.openingCalls+=prior?1:0;route.closingCalls++;
    for(const [key,value] of Object.entries({admittedUnits:admitted,consumedUnits:consumed,releasedUnits:released})){
      counters[key]+=value;route[key]+=value;
    }
    route.openingUsedUnits+=amount(prior,'used');route.closingUsedUnits+=amount(next,'used');
    route.openingReservedUnits+=amount(prior,'reserved');route.closingReservedUnits+=amount(next,'reserved');
    if(!prior){counters.newCalls++;route.newCalls++;}
    else if(changed){counters.changedCalls++;route.changedCalls++;}
    else counters.unchangedCalls++;
    if(recovered){counters.resultRecoveries++;route.resultRecoveries++;}
    if(prior&&RESERVED.has(prior.storedStatus)&&RESERVED.has(next.storedStatus))counters.carriedReservations++;
    routes.set(next.routeId,route);
    if(changed||RESERVED.has(next.storedStatus)){
      calls.push({requestId:id,routeId:next.routeId,method:next.method,path:next.path,units:next.units,
        kind:!prior?'NEW_CALL':recovered?'RESULT_RECOVERED':changed?'DURABLE_CHANGE':'CARRIED_RESERVATION',
        opening:prior?copy(prior):null,closing:copy(next),admittedUnits:admitted.toString(),
        consumedUnits:consumed.toString(),releasedUnits:released.toString(),
        reservedDeltaUnits:(amount(next,'reserved')-amount(prior,'reserved')).toString(),
        availableDeltaUnits:(released-admitted).toString(),resultRecovered:recovered});
    }
  }
  need(opening.revision!==closing.revision||(counters.newCalls===0&&counters.changedCalls===0),
    'SERVICE_PERIOD_SNAPSHOT_CHANGED','Different durable calls cannot share the same original snapshot identity.');
  const usedDelta=BigInt(last.unitsUsed)-BigInt(first.unitsUsed);
  const reservedDelta=BigInt(last.unitsReserved)-BigInt(first.unitsReserved);
  const availableDelta=BigInt(last.unitsRemaining)-BigInt(first.unitsRemaining);
  need(counters.consumedUnits===usedDelta&&counters.admittedUnits-counters.consumedUnits-counters.releasedUnits===reservedDelta&&
    counters.releasedUnits-counters.admittedUnits===availableDelta,'SERVICE_PERIOD_BALANCE_CHANGED',
    'The complete original call changes do not conserve the opening and closing allowance.');
  const stringify=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?value.toString():value]));
  calls.sort((a,b)=>a.closing.updatedAt.localeCompare(b.closing.updatedAt)||a.requestId.localeCompare(b.requestId));
  return {schema:SERVICE_PERIOD_SCHEMA,orderRef:last.orderRef,eventId:last.eventId,planId:last.planId,
    planSha256:last.planSha256,manifestSha256:last.manifestSha256,planLabel:last.planLabel,
    from:opening.createdAt,until:closing.createdAt,timeBasis:'COMPLETE_NATIVE_SNAPSHOT_COMPARISON',
    openingSource:source(opening,openingSource),closingSource:source(closing,closingSource),
    opening:balance(first),closing:balance(last),
    totals:{...stringify(counters),reservedDeltaUnits:reservedDelta.toString(),availableDeltaUnits:availableDelta.toString()},
    routes:[...routes.values()].map(stringify).sort((a,b)=>a.routeId.localeCompare(b.routeId)),calls};
}
const csvCell=value=>{
  let text=value===null||value===undefined?'':String(value);
  if((/^\s*[=+\-@]/.test(text)&&!/^-[0-9]+$/.test(text))||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
export function renderServicePeriodCsv(statement){
  const p=statement.servicePeriod;
  const headers=['statementNumber','customerReference','orderRef','periodFrom','periodUntil','openingSourceSha256','closingSourceSha256',
    'requestId','routeId','method','path','kind','routeUnits','openingStatus','closingStatus','openingRevision','closingRevision',
    'admittedUnits','consumedUnits','releasedUnits','reservedDeltaUnits','availableDeltaUnits','resultRecovered',
    'startedAt','openingUpdatedAt','closingUpdatedAt','requestSha256','responseStatus','responseSha256','responseBytes'];
  return csv([headers,...(p?.calls??[]).map(c=>[
    statement.number??'',statement.customer.reference,p.orderRef,p.from,p.until,p.openingSource.sha256,p.closingSource.sha256,
    c.requestId,c.routeId,c.method,c.path,c.kind,c.units,c.opening?.storedStatus,c.closing.storedStatus,c.opening?.revision,c.closing.revision,
    c.admittedUnits,c.consumedUnits,c.releasedUnits,c.reservedDeltaUnits,c.availableDeltaUnits,c.resultRecovered,
    c.closing.startedAt,c.opening?.updatedAt,c.closing.updatedAt,c.closing.requestSha256,c.closing.result?.status,c.closing.result?.sha256,c.closing.result?.bytes
  ])]);
}
export function renderServicePeriodSummaryCsv(statement){
  const p=statement.servicePeriod;
  const headers=['statementNumber','customerReference','orderRef','periodFrom','periodUntil','routeId','method','path','routeUnits',
    'openingCalls','closingCalls','newCalls','changedCalls','resultRecoveries','openingUsedUnits','closingUsedUnits',
    'openingReservedUnits','closingReservedUnits','admittedUnits','consumedUnits','releasedUnits'];
  return csv([headers,...(p?.routes??[]).map(r=>[
    statement.number??'',statement.customer.reference,p.orderRef,p.from,p.until,
    ...headers.slice(5).map(key=>r[key])
  ])]);
}
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
export function renderServicePeriodHtml(period){
  if(!period)return '';
  const e=escape;
  const balanceRows=[['Purchased allowance','unitsPurchased'],['Consumed allowance','unitsUsed'],['Reserved allowance','unitsReserved'],['Available allowance','unitsRemaining']]
    .map(([title,key])=>'<tr><th>'+title+'</th><td>'+e(period.opening[key])+'</td><td>'+e(period.closing[key])+'</td></tr>').join('');
  const routeRows=period.routes.map(r=>'<tr><td>'+e(r.routeId)+'<small>'+e(r.method)+' '+e(r.path)+'</small></td><td>'+r.newCalls+'</td><td>'+e(r.admittedUnits)+'</td><td>'+e(r.consumedUnits)+'</td><td>'+e(r.releasedUnits)+'</td><td>'+e(r.closingReservedUnits)+'</td></tr>').join('');
  const callRows=period.calls.map(c=>'<tr><td><code>'+e(c.requestId)+'</code><small>'+e(c.method)+' '+e(c.path)+'</small></td><td>'+e(c.kind)+'</td><td>'+e(c.opening?.storedStatus??'Not in opening snapshot')+'</td><td>'+e(c.closing.storedStatus)+'</td><td>'+e(c.admittedUnits)+' / '+e(c.consumedUnits)+' / '+e(c.releasedUnits)+'</td><td>'+e(c.closing.updatedAt)+'</td></tr>').join('');
  return '<section class="summary"><h2>Service activity between snapshots</h2><p>Order <code>'+e(period.orderRef)+'</code>: '+e(period.from)+' to '+e(period.until)+'.</p>'+
    '<p>The opening and closing values come from complete original snapshots. Call timestamps remain their native timestamps. Activity includes earlier reserved calls resolved during this interval.</p>'+
    '<table><thead><tr><th>Allowance in service units</th><th>Opening</th><th>Closing</th></tr></thead><tbody>'+balanceRows+'</tbody></table>'+
    '<p>'+period.totals.newCalls+' new calls; '+e(period.totals.admittedUnits)+' units admitted; '+e(period.totals.consumedUnits)+' units consumed; '+e(period.totals.releasedUnits)+' units released. '+period.totals.resultRecoveries+' original results recovered. '+period.totals.carriedReservations+' opening calls remain reserved.</p>'+
    '<table><thead><tr><th>Purchased route</th><th>New calls</th><th>Admitted</th><th>Consumed</th><th>Released</th><th>Closing reserved</th></tr></thead><tbody>'+routeRows+'</tbody></table>'+
    '<h3>Activity and carried reservations</h3><table><thead><tr><th>Request / route</th><th>Change</th><th>Opening outcome</th><th>Closing outcome</th><th>Admitted / consumed / released</th><th>Native update</th></tr></thead><tbody>'+callRows+'</tbody></table>'+
    '<p>'+period.totals.unchangedCalls+' original calls retain their earlier durable state. Complete source projections and the closing call history accompany the retained document.</p></section>';
}
