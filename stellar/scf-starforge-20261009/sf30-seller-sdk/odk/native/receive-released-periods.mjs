// MIT. Two real Central submission-time periods through the original commissioning engine.
import { mkdir, readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireReleaseLease } from '../../../sf82-seller-pilot/release-process.mjs';
import { atomic, digest, formatted, now, stable, writeNew } from '../../odata/state.mjs';
import { normalizeCentralUrl } from '../source.mjs';
import { verifyFile } from '../store.mjs';
import { restoreCentralArchive } from '../archive.mjs';
import { openCentralCommissioning } from '../commissioning/open.mjs';
import { RELEASED_FIXTURES } from './released-fixtures.mjs';

const SCHEMA='stellar-forge.central-released-period-receiving.v1';
const equal=(a,b)=>stable(a)===stable(b);
const check=(value,code,message)=>{if(!value)throw Object.assign(new Error(message),{code});};
const idFor=(operation,capture,name)=>'receive-period-'+digest(stable([operation,capture,name])).slice(0,40);
const inside=(parent,child)=>{const path=relative(parent,child);return path===''||!isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+(process.platform==='win32'?'\\':'/'));};
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  check(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path)&&
    (process.platform==='win32'||!(info.mode&0o077)),
    'CENTRAL_PERIOD_DIRECTORY','Use the canonical private directory of this original receiving operation.');
}
async function jsonFile(path){
  try{
    const info=await lstat(path);
    check(info.isFile()&&!info.isSymbolicLink()&&info.size<=16*1024*1024,
      'CENTRAL_PERIOD_FILE','Keep a complete bounded regular receiving record.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path)));
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function immutableJSON(path,value){
  const bytes=formatted(value);await privateDirectory(dirname(path));
  try{await writeNew(path,bytes);}catch(error){
    if(error.code!=='EEXIST')throw error;
    check(digest(await readFile(path))===digest(bytes),'CENTRAL_PERIOD_FILE_CHANGED','Preserve the different original receiving record.');
  }
  return {path,bytes:bytes.length,sha256:digest(bytes)};
}
function tableFor(capture,projectId){
  const form=capture.forms.find(item=>String(item.projectId)===String(projectId)&&item.formId==='simple');
  const table=form&&capture.tables.find(item=>item.formKey===form.key&&item.name==='Submissions');
  check(table,'CENTRAL_PERIOD_TABLE','Use the original released simple/Submissions table.');return table;
}
function allRows(workspace,capture,table){
  const result=[],seen=new Set();let after='';
  while(true){
    const page=workspace.rows({id:capture.id,tableId:table.id,after,limit:100});
    check(Array.isArray(page.rows),'CENTRAL_PERIOD_ROWS','The original row page is incomplete.');
    for(const row of page.rows){
      check(typeof row.__id==='string'&&!seen.has(row.__id),'CENTRAL_PERIOD_ROWS','Keep each original source row once.');
      seen.add(row.__id);result.push(row);
    }
    check(result.length<=3,'CENTRAL_PERIOD_ROWS','This released simple fixture has exactly three original roots.');
    if(page.next===null)break;
    check(typeof page.next==='string'&&page.next!==after,'CENTRAL_PERIOD_ROWS','Continue the actual original row cursor.');
    after=page.next;
  }
  check(result.length===table.rowCount,'CENTRAL_PERIOD_ROWS','The native rows and retained table count differ.');
  return result;
}
async function pageSources(workspace,capture,table){
  const selected=[];let after=0;
  while(true){
    const page=workspace.resources({id:capture.id,kind:'odata-page',after,limit:100});
    for(const entry of page.resources){
      if(entry.tableId!==table.id)continue;
      const file=await workspace.sourceFile({hash:entry.sha256});
      check(file.bytes===entry.bytes,'CENTRAL_PERIOD_SOURCE','The original page byte count differs.');
      const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file.path)));
      check(Array.isArray(body.value),'CENTRAL_PERIOD_SOURCE','The original Central page has no OData value array.');
      selected.push({receipt:entry,rows:body.value});
    }
    if(page.next===null)break;
    check(Number.isSafeInteger(page.next)&&page.next>after,'CENTRAL_PERIOD_SOURCE','Continue the original source cursor.');
    after=page.next;
  }
  check(selected.length===table.pageCount,'CENTRAL_PERIOD_SOURCE','Retain every original source page for the selected table.');
  return selected;
}
function timestamp(value){
  check(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&
    Number.isFinite(Date.parse(value)),
    'CENTRAL_PERIOD_TIMESTAMP','Use Central submissionDate at the original supported UTC millisecond precision.');
  const normalized=new Date(value).toISOString();
  check(normalized.slice(0,19)===value.slice(0,19),'CENTRAL_PERIOD_TIMESTAMP','Keep the original valid provider calendar timestamp.');
  return {original:value,normalized,milliseconds:Date.parse(value)};
}
async function observedBoundary(workspace,capture,projectId,sourceReviewId){
  const table=tableFor(capture,projectId),rows=allRows(workspace,capture,table),sources=await pageSources(workspace,capture,table);
  const expected=RELEASED_FIXTURES.expectedSource.simple;
  check(rows.length===3&&equal(rows.map(row=>row.__id).sort(),[...expected.rootIds].sort()),
    'CENTRAL_PERIOD_FIXTURE','Use the completed original three-root simple fixture capture.');
  const byId=new Map(rows.map(row=>[row.__id,row])),observations=[];
  for(let index=0;index<expected.rootIds.length;index++){
    const rowId=expected.rootIds[index],row=byId.get(rowId),time=timestamp(row.__system?.submissionDate);
    check(row.name===expected.names[index]&&String(row.age)===String(expected.ages[index]),
      'CENTRAL_PERIOD_FIXTURE','Preserve the original released name and age values.');
    const matches=sources.flatMap(source=>source.rows.filter(item=>item.__id===rowId)
      .map(item=>({source:source.receipt,row:item})));
    check(matches.length===1&&matches[0].row.__system?.submissionDate===time.original,
      'CENTRAL_PERIOD_SOURCE','The native row time must match exactly one retained original provider page.');
    observations.push({rowId,submissionDate:time.original,normalizedSubmissionDate:time.normalized,
      rowSha256:digest(stable(row)),source:matches[0].source});
  }
  const initial=observations.slice(0,2),following=observations[2],
    first=Math.min(...initial.map(item=>Date.parse(item.normalizedSubmissionDate))),
    lastInitial=Math.max(...initial.map(item=>Date.parse(item.normalizedSubmissionDate))),
    split=Date.parse(following.normalizedSubmissionDate),end=split+1;
  check(lastInitial<split&&Number.isSafeInteger(end),
    'CENTRAL_PERIOD_SEPARATION','The observed provider times must separate roots one/two from three; keep the source and inspect its actual clock values.');
  const periods=[
    {period:0,label:'Initial native submissions',submitted_from:new Date(first).toISOString(),
      submitted_before_exclusive:new Date(split).toISOString(),page_size:2,rowIds:expected.rootIds.slice(0,2),expectedRows:2,expectedMean:'32',expectedSum:'64'},
    {period:1,label:'Following native submission',submitted_from:new Date(split).toISOString(),
      submitted_before_exclusive:new Date(end).toISOString(),page_size:2,rowIds:expected.rootIds.slice(2),expectedRows:1,expectedMean:'38',expectedSum:'38'}
  ];
  for(const period of periods){
    const selected=observations.filter(row=>row.normalizedSubmissionDate>=period.submitted_from&&
      row.normalizedSubmissionDate<period.submitted_before_exclusive).map(row=>row.rowId).sort();
    check(equal(selected,[...period.rowIds].sort()),'CENTRAL_PERIOD_SEPARATION','The exact provider-time predicates select another cohort.');
  }
  return {schema:'stellar-forge.central-native-period-boundary.v1',basis:'retained-original-odata-submissionDate',
    workspaceId:workspace.state().id,captureId:capture.id,sourceReviewId,contentHash:capture.contentHash,projectId:String(projectId),
    formId:'simple',tableId:table.id,table:'Submissions',source:RELEASED_FIXTURES.upstream,
    observations,periods,interpretation:'The first exclusive end and second inclusive start equal root three submissionDate. The final exclusive end is the next supported millisecond after that recorded instant. Values are provider acquisition times, not customer business dates.'};
}
function agreementFor(connection,operationId,boundary){
  return {schema:'stellar-forge.central-source-report-agreement.v1',
    opportunity_id:operationId,name:'Released Central two-period commissioning',
    source_receiving:boundary,commercial_scope:{max_existing_forms:3,delivery_business_days:10},
    processing:{reviewStates:'all',lateEdits:'current-state-at-capture',portableSource:'complete-selected-capture'},
    kickoff:{status:'proposed'},
    customer_decisions:{
      accountable_project_owner:'Commons original Central native fixture operator',
      technical_receiver:'Commons commissioned-source and PostgreSQL receiving operator',
      authorized_central_origin:connection.url,project_id:boundary.projectId,selected_forms:['simple'],
      reporting_timezone:'Etc/UTC',
      late_edit_policy:'Read the current available state and retained original versions of roots selected by their native submissionDate. The first root retains its original one to one2 edit; this is not a reconstruction as of a historical business date.',
      review_state_inclusion:'All original Central review states are captured. Acceptance here records inspection of the released upstream fixture source and the complete native receiving result.',
      media_retention_selection:'The commissioned simple form has no media. The same complete workspace retains the original full five-root capture, its repeat tables and both original binaryType fixture attachments.',
      periods:boundary.periods.map(({period,rowIds,expectedRows,expectedMean,expectedSum,...value})=>value),
      approved_output_fields:[{form_id:'simple',table:'Submissions',name:'Released simple approved reporting source',
        fields:['__id','name','age','__system/submissionDate']}],
      metric_definitions:[
        {form_id:'simple',table:'Submissions',name:'Native submission count',operation:'rows'},
        {form_id:'simple',table:'Submissions',name:'Released mean age',operation:'mean',field:'age'},
        {form_id:'simple',table:'Submissions',name:'Released total age',operation:'sum',field:'age'}
      ],
      cross_form_identity_rules:['Native simple __id identifies each initial submission and remains the period comparison key. The original source contains disjoint two-row and one-row cohorts.']
    }};
}
function reviewBody(boundary,period,tableId){
  return {decision:'accept',reviewer:'Commons original Central receiving operator',
    note:'Reviewed the original released simple source for '+period.label+'. Its exact native submission-time scope and original page hashes are retained in the commissioning agreement.',
    findings:[{title:'Original period boundary',text:period.submitted_from+' <= Central submissionDate < '+period.submitted_before_exclusive+
      '. Native roots: '+period.rowIds.join(', ')+'. Boundary source capture: '+boundary.captureId+'.'},
      {title:'Original source meaning',text:'The source retains current available field values and published/submission history for the selected native roots. The values are the released Central fixtures with their original name and age fields.'}],
    indicators:[{tableId,name:'Native submission count',operation:'rows'},
      {tableId,name:'Released mean age',operation:'mean',field:'age'},
      {tableId,name:'Released total age',operation:'sum',field:'age'}]};
}
async function captureView(workspace,captureId,projectId,reviewId){
  const capture=workspace.edition({id:captureId}),table=tableFor(capture,projectId),rows=allRows(workspace,capture,table),
    boundary=capture.decisions.findIndex(item=>item.id===reviewId);
  check(boundary>=0&&capture.decisions[boundary].decision==='accept'&&capture.decisions[boundary].contentHash===capture.contentHash,
    'CENTRAL_PERIOD_REVIEW','Keep the original accepted source review and its complete prior decision history.');
  const histories=rows.map(row=>({id:row.__id,...workspace.row({id:capture.id,tableId:table.id,rowId:row.__id})}));
  const source=await pageSources(workspace,capture,table);
  return {id:capture.id,contentHash:capture.contentHash,planId:capture.planId,scope:capture.scope,
    table:{id:table.id,name:table.name,rowCount:table.rowCount,pageCount:table.pageCount},
    rows,histories,source:source.map(item=>item.receipt),reviewId,decisions:capture.decisions.slice(0,boundary+1)};
}
async function outputFiles(workspace,record){
  const files=[];
  for(const name of record.files){
    const expected=record.receipts?.[name];
    check(expected&&typeof expected.sha256==='string','CENTRAL_PERIOD_EXPORT','Keep every original native file receipt.');
    const file=await workspace.exportFile({id:record.id,path:name}),actual=await verifyFile(file.path,expected.sha256);
    check(actual.bytes===expected.bytes,'CENTRAL_PERIOD_EXPORT','The original output byte count differs.');
    files.push({name,...actual});
  }
  return {id:record.id,files};
}
async function verifyReport(workspace,report,period){
  const file=await workspace.exportFile({id:report.id,path:'report.json'}),body=await jsonFile(file.path);
  check(body,'CENTRAL_PERIOD_REPORT','The complete original report is missing.');
  for(const [name,value,count]of [['Native submission count',String(period.expectedRows),period.expectedRows],
    ['Released mean age',period.expectedMean,period.expectedRows],['Released total age',period.expectedSum,period.expectedRows]]){
    const indicator=body.indicators.find(item=>item.name===name);
    check(indicator&&String(indicator.value)===value&&indicator.count===count,
      'CENTRAL_PERIOD_REPORT','The original '+name+' differs from this exact native source cohort.');
  }
  return {period:period.period,id:report.id,captureId:report.captureId,indicators:body.indicators,comparison:body.comparison??null};
}
/** Continue the same released provider operation with the actual retained whole capture. */
export async function receiveReleasedCentralPeriods({connection,operationId,sourceCaptureId,sourceReviewId,expectedWorkspaceId,projectId,
  directory,outputDirectory,restoreDirectory,onStage=async()=>{}}={}){
  for(const value of [operationId,sourceCaptureId,sourceReviewId,expectedWorkspaceId,directory,outputDirectory,restoreDirectory])
    check(typeof value==='string'&&value.trim(),'CENTRAL_PERIOD_INPUT','Supply the original operation, workspace, source capture and receiving paths.');
  check(connection&&Object.keys(connection).every(key=>['id','name','url','authEnv','allowLoopback'].includes(key)),
    'CENTRAL_PERIOD_CONNECTION','Use the original host connection references.');
  connection={...connection,url:normalizeCentralUrl(connection.url,{allowLoopback:connection.allowLoopback===true})};
  const root=resolve(directory),output=resolve(outputDirectory),restored=resolve(restoreDirectory);
  check([root,output,restored].every((path,index,paths)=>paths.every((other,j)=>index===j||!inside(path,other)&&!inside(other,path))),
    'CENTRAL_PERIOD_PATHS','Keep the original workspace, period receiving record and independent restore as separate directories.');
  await privateDirectory(output);
  const lease=await acquireReleaseLease(output,'period-receiving.lock');
  check(lease,'CENTRAL_PERIOD_LEASE','Use the existing Linux receiving host and original operation.');
  let owner=null,reopened=null,journal;
  const request={operationId,sourceCaptureId,sourceReviewId,expectedWorkspaceId,projectId:String(projectId),connection,
    directory:root,outputDirectory:output,restoreDirectory:restored,fixtureSha256:digest(stable(RELEASED_FIXTURES))},
    requestSha256=digest(stable(request)),recordPath=join(output,'period-receiving.json'),resultPath=join(output,'result.json'),
    ids={inspection:idFor(operationId,sourceCaptureId,'inspection'),draft:idFor(operationId,sourceCaptureId,'draft'),
      draftRequest:idFor(operationId,sourceCaptureId,'draft-request'),commission:idFor(operationId,sourceCaptureId,'commission'),
      captureRequests:[0,1].map(period=>idFor(operationId,sourceCaptureId,'capture:'+period)),
      delivery:idFor(operationId,sourceCaptureId,'delivery')};
  const checkpoint=async(stage,values={})=>{
    lease.assertHeld();Object.assign(journal,values,{updatedAt:now(),status:'RUNNING'});
    journal.stages.push({stage,at:journal.updatedAt});await atomic(recordPath,journal);
    await onStage({stage,operationId,commissionId:ids.commission,...values});
  };
  try{
    journal=await jsonFile(recordPath);
    if(journal)check(journal.schema===SCHEMA&&journal.requestSha256===requestSha256&&equal(journal.ids,ids),
      'CENTRAL_PERIOD_REQUEST','Continue the exact retained period receiving request.');
    else{
      journal={schema:SCHEMA,request,requestSha256,ids,status:'READY',createdAt:now(),stages:[],reviews:{},captures:[]};
      await immutableJSON(recordPath,journal);
    }
    const completed=await jsonFile(resultPath);
    if(completed){
      check(completed.schema===SCHEMA&&completed.requestSha256===requestSha256&&equal(completed.ids,ids)&&
        completed.workspaceId===expectedWorkspaceId&&equal(completed.original,completed.received)&&
        equal(completed.archive,journal.archive)&&equal(completed.datasets,journal.delivery?.datasets),
        'CENTRAL_PERIOD_RESULT','The original complete period receiving result differs.');
      if(journal.resultSha256)check(journal.resultSha256===digest(stable(completed)),'CENTRAL_PERIOD_RESULT','The completed original result changed.');
      Object.assign(journal,{status:'COMPLETE',completedAt:completed.completedAt,resultSha256:digest(stable(completed)),error:null});
      await atomic(recordPath,journal);return completed;
    }
    owner=await openCentralCommissioning({directory:root,connection});
    const {workspace,commissioning}=owner;
    check(workspace.state().id===expectedWorkspaceId,'CENTRAL_PERIOD_WORKSPACE','Use the existing full-source workspace.');
    const full=workspace.edition({id:sourceCaptureId});
    check(connection.id===full.connectionId,'CENTRAL_PERIOD_CONNECTION','Use the same native connection ID retained by the original complete capture.');
    const fullReview=full.decisions.find(item=>item.id===sourceReviewId);
    check(full.status==='COMPLETE'&&fullReview?.decision==='accept'&&fullReview.contentHash===full.contentHash,
      'CENTRAL_PERIOD_SOURCE','Use the exact accepted source review from the completed original whole receiving receipt.');
    const observed=await observedBoundary(workspace,full,projectId,sourceReviewId);
    if(journal.boundary)check(equal(journal.boundary,observed),'CENTRAL_PERIOD_BOUNDARY','The retained original provider boundary source changed.');
    else await checkpoint('native-boundary',{boundary:observed});
    const boundary=journal.boundary,agreement=agreementFor(connection,operationId,boundary);
    await immutableJSON(join(output,'native-period-boundary.json'),boundary);
    await immutableJSON(join(output,'source-report-agreement.json'),agreement);
    const inspection=await commissioning.inspect({id:ids.inspection,projectId:String(projectId)});
    await checkpoint('inspected',{inspectionId:inspection.id});
    const draft=await commissioning.saveDraft({id:ids.draft,requestId:ids.draftRequest,expectedRevision:0,agreement});
    const commission=await commissioning.prepare({id:ids.commission,draftId:ids.draft,draftRevision:draft.revision,inspectionId:ids.inspection});
    await commissioning.install({id:ids.commission});
    await checkpoint('commission-installed',{commissionId:commission.id,planIds:commission.definition.plans.map(item=>item.id)});
    const captures=[],originalCaptures=[];
    const existingDelivery=commissioning.state().commissions.find(item=>item.id===ids.commission)?.deliveries.find(item=>item.id===ids.delivery);
    for(const period of boundary.periods){
      const begun=await commissioning.capturePeriod({id:ids.commission,period:period.period,requestId:ids.captureRequests[period.period],label:period.label});
      let capture=workspace.edition({id:begun.capture.id});
      if(capture.status!=='COMPLETE'){
        await commissioning.resumeCapture({id:ids.commission,captureId:capture.id});
        await workspace.wait({id:capture.id});capture=workspace.edition({id:capture.id});
      }
      check(capture.status==='COMPLETE',capture.error?.code??'CENTRAL_PERIOD_CAPTURE',capture.error?.message??'Resume this original retained period capture.');
      const table=tableFor(capture,projectId),rows=allRows(workspace,capture,table),quality=workspace.quality({id:capture.id});
      check(equal(rows.map(row=>row.__id).sort(),[...period.rowIds].sort())&&table.rowCount===period.expectedRows,
        'CENTRAL_PERIOD_COHORT','The actual provider filter returned a different original cohort.');
      for(const row of rows){
        const original=full&&workspace.row({id:full.id,tableId:boundary.tableId,rowId:row.__id}).row;
        check(equal(row,original),'CENTRAL_PERIOD_SOURCE_CHANGED','The native source changed after its retained whole capture; preserve both editions before commissioning another source.');
      }
      const allowed=new Set(RELEASED_FIXTURES.acceptedIssueCodes??[]);
      check(quality.issues.every(issue=>allowed.has(issue.code)),'CENTRAL_PERIOD_QUALITY','Review the actual retained source issues before accepting this period.');
      const body=reviewBody(boundary,period,table.id),key=String(period.period);
      if(!journal.reviews[key]){
        journal.reviews[key]={revision:capture.revision,decisionIndex:capture.decisions.length,contentHash:capture.contentHash,body};
        await checkpoint('review-prepared:'+key);
      }
      const intent=journal.reviews[key];
      check(intent.contentHash===capture.contentHash&&equal(intent.body,body),
        'CENTRAL_PERIOD_REVIEW','Keep the original exact source review selection.');
      const prior=capture.decisions[intent.decisionIndex];
      if(prior)check(Object.keys(body).every(name=>equal(prior[name],body[name]))&&prior.contentHash===capture.contentHash,
        'CENTRAL_PERIOD_REVIEW','Another decision occupies the retained original review boundary.');
      else{
        check(capture.revision===intent.revision,'CENTRAL_PERIOD_REVIEW','The original capture changed before its retained review.');
        capture=workspace.review({id:capture.id,expectedRevision:intent.revision,...body});
      }
      const review=capture.decisions[intent.decisionIndex];
      check(existingDelivery||capture.decisions.at(-1)?.id===review.id,
        'CENTRAL_PERIOD_REVIEW','A later original review must be reconciled before a new delivery.');
      captures.push({period:period.period,captureId:capture.id,reviewId:review.id});
      originalCaptures.push(await captureView(workspace,capture.id,projectId,review.id));
      await checkpoint('period-reviewed:'+key,{captures:[...captures]});
    }
    const delivery=await commissioning.deliver({id:ids.commission,requestId:ids.delivery,captures});
    check(delivery.status==='COMPLETE'&&delivery.archive,'CENTRAL_PERIOD_DELIVERY','Continue the original complete commissioning handover.');
    const files=[],reports=[];
    for(const entry of [...delivery.datasets,...delivery.reports])files.push(await outputFiles(workspace,entry));
    for(const report of delivery.reports)reports.push(await verifyReport(workspace,report,boundary.periods[report.period]));
    const archiveFile=await workspace.exportFile({id:delivery.archive.id,path:'central-workspace.tar.gz'}),
      archiveHash=await verifyFile(archiveFile.path,delivery.archive.sha256);
    check(archiveHash.bytes===delivery.archive.bytes,'CENTRAL_PERIOD_ARCHIVE','The complete commissioning archive differs.');
    const archive={id:delivery.archive.id,path:archiveFile.path,...archiveHash};
    const projection={workspaceId:workspace.state().id,source:await captureView(workspace,full.id,projectId,sourceReviewId),
      commission:{id:commission.id,definition:commission.definition,sourceDefinition:commission.sourceDefinition},
      captures:originalCaptures,files};
    if(journal.original)check(equal(journal.original,projection),'CENTRAL_PERIOD_REVIEW','The original review-bound receiving snapshot changed.');
    const original=journal.original??projection;
    await immutableJSON(join(output,'commissioning-delivery.json'),delivery);
    const warehouseInput={schema:'stellar-forge.central-native-warehouse-selection.v1',operationId,
      sourceWorkspace:root,workspaceId:expectedWorkspaceId,commissionId:ids.commission,deliveryId:ids.delivery,
      captures,datasets:delivery.datasets,periods:boundary.periods.map(({period,label})=>({period,label})),
      requestIds:{approvals:[0,1].map(period=>digest(stable([operationId,sourceCaptureId,'warehouse-approval',period])).slice(0,32)),
        reviews:[0,1].map(period=>digest(stable([operationId,sourceCaptureId,'warehouse-review',period])).slice(0,32)),
        imports:[0,1].map(period=>digest(stable([operationId,sourceCaptureId,'warehouse-import',period])).slice(0,32)),
        report:digest(stable([operationId,sourceCaptureId,'warehouse-report'])).slice(0,32)}};
    const warehouseRequest=await immutableJSON(join(output,'warehouse-selections.json'),warehouseInput);
    await checkpoint('commissioning-delivered',{delivery,archive,original,warehouseRequest});
    await owner.close();owner=null;
    const restoredReceipt=await restoreCentralArchive({archive:archive.path,directory:restored,expectedSha256:archive.sha256});
    await checkpoint('commissioning-restored',{restored:restoredReceipt});
    reopened=await openCentralCommissioning({directory:restored,connection});
    check(reopened.workspace.state().id===expectedWorkspaceId,'CENTRAL_PERIOD_REOPEN','The received archive has another original workspace.');
    const restoredCommission=reopened.commissioning.state().commissions.find(item=>item.id===ids.commission);
    check(restoredCommission,'CENTRAL_PERIOD_REOPEN','The original commissioning definition is missing after restore.');
    const receivedFiles=[];
    for(const record of [...delivery.datasets,...delivery.reports])receivedFiles.push(await outputFiles(reopened.workspace,record));
    const received={workspaceId:reopened.workspace.state().id,
      source:await captureView(reopened.workspace,sourceCaptureId,projectId,sourceReviewId),
      commission:{id:restoredCommission.id,definition:restoredCommission.definition,sourceDefinition:restoredCommission.sourceDefinition},
      captures:[],files:receivedFiles};
    for(const capture of captures)received.captures.push(await captureView(reopened.workspace,capture.captureId,projectId,capture.reviewId));
    check(equal(original,received),'CENTRAL_PERIOD_REOPEN','The original source, periods, review history or complete output files changed on receiving.');
    const receivedDelivery=await reopened.commissioning.deliver({id:ids.commission,requestId:ids.delivery,captures});
    check(receivedDelivery.status==='RECEIVED_PORTABLE'&&equal(receivedDelivery.datasets,delivery.datasets)&&
      equal(receivedDelivery.reports,delivery.reports)&&receivedDelivery.receivedArchive?.archiveSha256===archive.sha256,
      'CENTRAL_PERIOD_REOPEN','Reopen the same original portable commissioning handover.');
    await reopened.close();reopened=null;
    const result={schema:SCHEMA,operationId,requestSha256,ids,workspaceId:expectedWorkspaceId,
      sourceWorkspace:root,sourceCaptureId,sourceReviewId,boundary,commissionId:ids.commission,deliveryId:ids.delivery,captures,
      datasets:delivery.datasets,reports:delivery.reports,indicators:reports,archive,restored:restoredReceipt,
      receivedDelivery:{status:receivedDelivery.status,receivedArchive:receivedDelivery.receivedArchive},
      warehouseRequest,original,received,completedAt:now()};
    await immutableJSON(resultPath,result);
    Object.assign(journal,{status:'COMPLETE',resultSha256:digest(stable(result)),completedAt:result.completedAt,error:null});
    await atomic(recordPath,journal);await onStage({stage:'commissioning-complete',operationId,commissionId:ids.commission,
      datasets:result.datasets,archive:result.archive,result:resultPath});return result;
  }catch(error){
    if(journal){Object.assign(journal,{status:'INTERRUPTED',updatedAt:now(),error:{code:error.code??error.name,message:error.message}});
      try{await atomic(recordPath,journal);}catch{}}
    throw error;
  }finally{
    try{await reopened?.close();}finally{try{await owner?.close();}finally{await lease.close();}}
  }
}
export async function main(argv=process.argv.slice(2)){
  const args={};
  for(let index=0;index<argv.length;index+=2){
    check(['--request','--directory','--output','--restore'].includes(argv[index])&&argv[index+1]&&args[argv[index]]===undefined,
      'CENTRAL_PERIOD_ARGUMENT','Use the retained original request and directory arguments once.');
    args[argv[index]]=argv[index+1];
  }
  check(Object.keys(args).length===4,'CENTRAL_PERIOD_ARGUMENT','Supply request, original workspace, output and independent restore.');
  const input=await jsonFile(resolve(args['--request']));
  check(input&&Object.keys(input).every(key=>['connection','operationId','sourceCaptureId','sourceReviewId','expectedWorkspaceId','projectId'].includes(key)),
    'CENTRAL_PERIOD_INPUT','Use the original receiving input identity.');
  const result=await receiveReleasedCentralPeriods({...input,directory:args['--directory'],outputDirectory:args['--output'],restoreDirectory:args['--restore'],
    onStage:async item=>process.stdout.write(JSON.stringify({stage:item.stage,operationId:item.operationId,commissionId:item.commissionId})+'\n')});
  process.stdout.write(JSON.stringify({operationId:result.operationId,commissionId:result.commissionId,datasets:result.datasets,
    result:resolve(args['--output'],'result.json'),warehouseRequest:result.warehouseRequest})+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??error.name,error:error.message})+'\n');process.exitCode=1;});
