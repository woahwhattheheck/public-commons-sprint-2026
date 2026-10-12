// MIT. Generate a complete customer service-period example from explicit sample inputs.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeUsage,compileCustomerStatement,renderStatementHtml,renderStatementCsv,renderStatementUsageCsv,json,sha} from '../core.mjs';
import {renderServicePeriodCsv,renderServicePeriodSummaryCsv} from '../period-usage.mjs';

export function buildServicePeriodExample(){
  const orderRef='example-api-pass',eventId=sha('example native purchase'),manifestSha256=sha('example purchased manifest');
  const plan={schema:'stellar-forge.sf101.api-pass.v1',title:'Example service allowance',allowanceUnits:100,
    routes:[{id:'lookup',method:'GET',path:'/lookup',units:5},{id:'report',method:'GET',path:'/report',units:10}]};
  const native={orderRef,eventId,routeId:'example-service-plan',method:'GET',network:'stellar:testnet',amountAtomic:'10000000',
    assetDigest:sha('example asset'),recipientDigest:sha('example recipient'),entitledAt:'2026-10-01T09:00:00.000Z',fileSha256:manifestSha256};
  const response=id=>{const body=json({example:id});return {status:200,contentType:'application/json',sha256:sha(body),bytes:Buffer.byteLength(body)};};
  const call=(id,routeId,storedStatus,startedAt,updatedAt,revision=1)=>{
    const route=plan.routes.find(row=>row.id===routeId);
    return {orderRef,requestId:id,routeId,method:route.method,path:route.path,units:route.units,requestSha256:sha('example request '+id),
      storedStatus,status:storedStatus,revision,startedAt,updatedAt,deadlineAt:'2026-10-01T16:30:00.000Z',
      errorCode:storedStatus==='RECOVERY_REQUIRED'?'EXAMPLE_CONNECTION_INTERRUPTED':null,
      result:storedStatus==='COMPLETED'?response(id):null};
  };
  const first=[
    call('completed-earlier','lookup','COMPLETED','2026-10-01T10:00:00.000Z','2026-10-01T10:00:02.000Z',2),
    call('result-awaited','report','CONSUMED','2026-10-01T11:00:00.000Z','2026-10-01T11:03:00.000Z',3),
    call('opening-to-complete','lookup','IN_FLIGHT','2026-10-01T15:59:00.000Z','2026-10-01T15:59:00.000Z'),
    call('opening-to-release','report','RECOVERY_REQUIRED','2026-10-01T15:50:00.000Z','2026-10-01T15:55:00.000Z',2),
    call('carried-reservation','lookup','IN_FLIGHT','2026-10-01T15:59:30.000Z','2026-10-01T15:59:30.000Z')
  ];
  const last=structuredClone(first);
  Object.assign(last[1],{storedStatus:'COMPLETED',status:'COMPLETED',revision:4,updatedAt:'2026-10-01T16:05:00.000Z',result:response('result-awaited')});
  Object.assign(last[2],{storedStatus:'COMPLETED',status:'COMPLETED',revision:2,updatedAt:'2026-10-01T16:10:00.000Z',result:response('opening-to-complete')});
  Object.assign(last[3],{storedStatus:'RELEASED',status:'RELEASED',revision:3,updatedAt:'2026-10-01T16:15:00.000Z'});
  last[4].status='RECOVERY_REQUIRED';
  last.push(
    call('new-consumed','report','COMPLETED','2026-10-01T16:20:00.000Z','2026-10-01T16:20:03.000Z',2),
    call('new-released','lookup','RELEASED','2026-10-01T16:25:00.000Z','2026-10-01T16:25:01.000Z',2),
    {...call('new-reserved','lookup','IN_FLIGHT','2026-10-01T16:59:00.000Z','2026-10-01T16:59:00.000Z'),deadlineAt:'2026-10-01T17:05:00.000Z'}
  );
  const capture=(calls,capturedAt)=>{
    const used=calls.filter(row=>['COMPLETED','CONSUMED'].includes(row.storedStatus)),reserved=calls.filter(row=>['IN_FLIGHT','RECOVERY_REQUIRED'].includes(row.storedStatus));
    const consumedUnits=used.reduce((n,row)=>n+row.units,0),reservedUnits=reserved.reduce((n,row)=>n+row.units,0);
    const usage={allowanceUnits:100,consumedUnits,reservedUnits,availableUnits:100-consumedUnits-reservedUnits,
      completedCalls:calls.filter(row=>row.storedStatus==='COMPLETED').length,
      consumedCallsWithoutResult:calls.filter(row=>row.storedStatus==='CONSUMED').length,
      reservedCalls:reserved.length,releasedCalls:calls.filter(row=>row.storedStatus==='RELEASED').length};
    const pass={orderRef,native,plan,usage,planSha256:sha(json(plan)),manifestSha256};
    return {schema:'stellar-forge.sf101.api-pass-export.v1',pass,calls,actions:[],
      snapshot:{capturedAt,stateSha256:sha(json({pass,calls})),callCount:calls.length,actionCount:0}};
  };
  const openingRaw=capture(first,'2026-10-01T16:00:00.000Z'),closingRaw=capture(last,'2026-10-01T17:00:00.000Z');
  const opening=normalizeUsage(openingRaw),closing=normalizeUsage(closingRaw);
  const openingSource={id:'10000000-0000-4000-8000-000000000001',sha256:sha(json(openingRaw))};
  const closingSource={id:'10000000-0000-4000-8000-000000000002',sha256:sha(json(closingRaw))};
  const report={schema:'stellar-forge.merchant-reconciliation.v1',createdAt:'2026-10-01T17:01:00.000Z',
    ledger:[{...native,orderReferenceDigest:sha(orderRef),origin:'SF98_NATIVE_CAPTURE',at:native.entitledAt,
      receiptFingerprint:sha('example receipt'),optionId:'example-option',termsMatch:true,transfer:'UNMATCHED',
      verificationScope:'TESTNET',delivery:'DELIVERED',exception:null,merchantQuoteUsd:null}]};
  const run={id:'20000000-0000-4000-8000-000000000001',reportSha256:sha(json(report))};
  const customer={id:'30000000-0000-4000-8000-000000000001',reference:'example-customer',name:'Example Customer',email:'',address:'',version:1};
  const draft=compileCustomerStatement({report,run,customer,bindings:[{customerId:customer.id,orderRef,orderReferenceDigest:sha(orderRef),label:'Example purchased API allowance'}],
    usage:closing,usageSource:closingSource,usageOpening:opening,usageOpeningSource:openingSource});
  const document={...draft,number:'EXAMPLE-SERVICE-PERIOD-001',createdAt:'2026-10-01T17:02:00.000Z',example:true};
  const files={
    'statement.html':renderStatementHtml(document),'statement.json':json(document),'statement.csv':renderStatementCsv(document),
    'usage.csv':renderStatementUsageCsv(document),'period.csv':renderServicePeriodCsv(document),'period-summary.csv':renderServicePeriodSummaryCsv(document),
    'usage-opening.json':json({schema:'stellar-forge.merchant-customer-usage-source.v1',source:document.source.usageOpening,usage:opening}),
    'usage-closing.json':json({schema:'stellar-forge.merchant-customer-usage-source.v1',source:document.source.usage,usage:closing})
  };
  const manifest=Object.fromEntries(Object.entries(files).map(([name,content])=>[name,{sha256:sha(content),bytes:Buffer.byteLength(content)}]));
  files['manifest.json']=json({schema:'stellar-forge.merchant-customer-statement-example-files.v1',number:document.number,files:manifest,source:document.source});
  return {document,openingRaw,closingRaw,files,summary:{number:document.number,period:document.servicePeriod.totals,
    opening:document.servicePeriod.opening,closing:document.servicePeriod.closing}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=process.argv[2];
  if(!output)throw new Error('Supply a new private output directory for the complete example.');
  const directory=resolve(output);await mkdir(directory,{mode:0o700});
  const result=buildServicePeriodExample();
  for(const[name,content]of Object.entries(result.files))await writeFile(join(directory,name),content,{flag:'wx',mode:0o600});
  process.stdout.write(json({directory,...result.summary}));
}
