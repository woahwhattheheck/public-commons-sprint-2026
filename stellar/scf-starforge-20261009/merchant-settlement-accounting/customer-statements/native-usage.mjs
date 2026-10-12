// MIT. Project the installed original SF101 API-pass export into customer usage.
const SCHEMA='stellar-forge.sf101.api-pass-export.v1';
const HEX=/^[a-f0-9]{64}$/;
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:400});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const count=(value,name,positive=false)=>{
  need(Number.isSafeInteger(value)&&value>=0&&(!positive||value>0),'INVALID_NATIVE_USAGE_INTEGER','Check the original '+name+'.');return value;
};
const digest=(value,name)=>{need(typeof value==='string'&&HEX.test(value),'INVALID_NATIVE_USAGE_DIGEST','Check the original '+name+'.');return value;};
const text=(value,name,max=2048)=>{
  need(typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'INVALID_NATIVE_USAGE_FIELD','Check the original '+name+'.');return value;
};
const time=(value,name)=>{text(value,name,80);need(Number.isFinite(Date.parse(value)),'INVALID_NATIVE_USAGE_TIME','Check the original '+name+'.');return value;};
const statuses=new Set(['IN_FLIGHT','RECOVERY_REQUIRED','COMPLETED','CONSUMED','RELEASED']);
export function projectApiPassExport(value){
  need(object(value)&&value.schema===SCHEMA&&object(value.pass)&&Array.isArray(value.calls)&&value.calls.length<=20000,
    'INVALID_NATIVE_PASS_EXPORT','Import the original complete API-pass export with up to 20,000 calls.');
  const pass=value.pass,native=pass.native,plan=pass.plan,usage=pass.usage;
  need(object(native)&&object(plan)&&plan.schema==='stellar-forge.sf101.api-pass.v1'&&object(usage),
    'INVALID_NATIVE_PASS_EXPORT','The original export must include its pass, native order, purchased plan and durable usage.');
  need(pass.orderRef===native.orderRef,'NATIVE_PASS_ORDER_CHANGED','The exported pass differs from its original native order.');
  const planSha256=digest(pass.planSha256,'plan digest'),manifestSha256=digest(pass.manifestSha256,'purchased manifest digest');
  need(manifestSha256===native.fileSha256,'NATIVE_PASS_MANIFEST_CHANGED','The API pass differs from the original purchased manifest.');
  need(object(value.snapshot)&&Array.isArray(value.actions),'NATIVE_CAPTURE_REQUIRED','Import the original complete API-pass snapshot.');
  const createdAt=value.snapshot.capturedAt,revision=digest(value.snapshot.stateSha256,'durable snapshot identity');
  need(count(value.snapshot.callCount,'snapshot call count')===value.calls.length&&count(value.snapshot.actionCount,'snapshot action count')===value.actions.length,
    'INCOMPLETE_NATIVE_PASS_EXPORT','The captured call and operation counts must match the complete original export.');
  need(typeof createdAt==='string','NATIVE_CAPTURE_TIME_REQUIRED','Export the original API pass with its actual capture timestamp.');
  time(createdAt,'capture timestamp');
  need((typeof revision==='string'&&revision.length>0&&revision.length<=160)||(Number.isSafeInteger(revision)&&revision>=0),
    'NATIVE_CAPTURE_REVISION_REQUIRED','Export the original API pass with its immutable snapshot revision.');
  
  need(Array.isArray(plan.routes)&&plan.routes.length>0,'NATIVE_PASS_ROUTES_REQUIRED','The purchased plan must retain its original routes.');
  const routes=new Map();
  for(const route of plan.routes){
    need(object(route),'INVALID_NATIVE_PASS_ROUTE','Check the original purchased route.');
    const id=text(route.id,'route ID',160);
    need(!routes.has(id),'DUPLICATE_NATIVE_PASS_ROUTE','The purchased plan repeats a route ID.');
    routes.set(id,{id,method:text(route.method,'route method',10),path:text(route.path,'route path'),units:count(route.units,'route units',true)});
  }
  const seen=new Set(),totals={consumedUnits:0n,reservedUnits:0n,completedCalls:0,consumedCallsWithoutResult:0,reservedCalls:0,releasedCalls:0};
  const calls=value.calls.map(call=>{
    need(object(call)&&call.orderRef===pass.orderRef,'NATIVE_CALL_ORDER_CHANGED','A call is bound to a different original order.');
    const requestId=text(call.requestId,'request ID',160);need(!seen.has(requestId),'DUPLICATE_NATIVE_CALL','The original call export repeats a request ID.');seen.add(requestId);
    const route=routes.get(call.routeId),units=count(call.units,'call units',true);
    need(route&&call.method===route.method&&call.path===route.path&&units===route.units,
      'NATIVE_CALL_PLAN_CHANGED','An original call differs from its immutable purchased route or unit price.');
    need(statuses.has(call.storedStatus)&&statuses.has(call.status),'INVALID_NATIVE_CALL_STATUS','Check the original durable call status.');
    need(call.status===call.storedStatus||(call.storedStatus==='IN_FLIGHT'&&call.status==='RECOVERY_REQUIRED'),
      'NATIVE_CALL_STATUS_CHANGED','The displayed call outcome differs from its durable status.');
    if(['IN_FLIGHT','RECOVERY_REQUIRED'].includes(call.storedStatus)){totals.reservedUnits+=BigInt(units);totals.reservedCalls++;}
    else if(call.storedStatus==='COMPLETED'){totals.consumedUnits+=BigInt(units);totals.completedCalls++;}
    else if(call.storedStatus==='CONSUMED'){totals.consumedUnits+=BigInt(units);totals.consumedCallsWithoutResult++;}
    else totals.releasedCalls++;
    let result=null;
    if(call.result!==null&&call.result!==undefined){
      need(object(call.result)&&Number.isInteger(call.result.status)&&call.result.status>=100&&call.result.status<=599,
        'INVALID_NATIVE_CALL_RESULT','Check the original retained response metadata.');
      result={status:call.result.status,contentType:text(call.result.contentType,'response content type',300),
        sha256:digest(call.result.sha256,'response digest'),bytes:count(call.result.bytes,'response bytes')};
    }
    return {requestId,routeId:call.routeId,method:call.method,path:call.path,requestSha256:digest(call.requestSha256,'request digest'),
      units:String(units),consumedUnits:['COMPLETED','CONSUMED'].includes(call.storedStatus)?String(units):'0',
      reservedUnits:['IN_FLIGHT','RECOVERY_REQUIRED'].includes(call.storedStatus)?String(units):'0',status:call.status,storedStatus:call.storedStatus,revision:count(call.revision,'call revision'),
      startedAt:time(call.startedAt,'call start'),deadlineAt:time(call.deadlineAt,'call deadline'),updatedAt:time(call.updatedAt,'call update'),
      errorCode:call.errorCode===null||call.errorCode===undefined?null:text(call.errorCode,'call outcome code',200),result};
  }).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.requestId.localeCompare(b.requestId));
  const allowance=count(usage.allowanceUnits,'allowance units',true),consumed=count(usage.consumedUnits,'consumed units'),
    reserved=count(usage.reservedUnits,'reserved units'),available=count(usage.availableUnits,'available units');
  need(allowance===count(plan.allowanceUnits,'purchased plan allowance',true),'NATIVE_ALLOWANCE_CHANGED','The durable allowance differs from its purchased plan.');
  need(totals.consumedUnits===BigInt(consumed)&&totals.reservedUnits===BigInt(reserved)&&BigInt(consumed)+BigInt(reserved)+BigInt(available)===BigInt(allowance),
    'INCOMPLETE_NATIVE_CALL_EXPORT','The complete original call history must account for every consumed and reserved unit.');
  for(const name of ['completedCalls','consumedCallsWithoutResult','reservedCalls','releasedCalls']){
    need(totals[name]===count(usage[name],name),'INCOMPLETE_NATIVE_CALL_EXPORT','The complete original call history must match its durable call counts.');
  }
  need(value.nextAfter===undefined||value.nextAfter===null,'INCOMPLETE_NATIVE_CALL_EXPORT','Export all remaining native call pages before importing customer usage.');
  return {usage:{schema:'stellar-forge.sf101.service-usage-export.v1',createdAt,revision,orders:[{
    orderRef:native.orderRef,eventId:native.eventId??null,routeId:native.routeId,method:native.method,network:native.network,
    amountAtomic:native.amountAtomic,assetDigest:native.assetDigest,recipientDigest:native.recipientDigest??null,entitledAt:native.entitledAt??null,
    planId:planSha256,planLabel:plan.title,planRevision:manifestSha256,
    unitsPurchased:String(allowance),unitsUsed:String(consumed),unitsReserved:String(reserved),unitsRemaining:String(available)
  }]},extras:{planSha256,manifestSha256,callsComplete:true,calls}};
}
