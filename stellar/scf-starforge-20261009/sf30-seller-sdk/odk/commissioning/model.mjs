// MIT. Commissioning over the original Central Store, capture and export engines.
import { readFile } from 'node:fs/promises';
import { createCentralSource } from '../source.mjs';
import { identifier, now, fault, stable, formatted, digest } from '../../odata/state.mjs';
import { verifyFile } from '../store.mjs';
import { COMMISSIONING_SCHEMA, normalizeConnection, jsonObject, fingerprint, nativeId,
  agreementReadiness, compileAgreement, resolveCaptureTable } from './agreement.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const describeError=e=>({code:e.code||'CENTRAL_COMMISSIONING_OPERATION',message:e.message||String(e),status:e.status||500});
const nativePlanShape=value=>({id:value.id,name:value.name,connectionId:value.connectionId,forms:value.forms,scope:value.scope});
const cleanReceipt=({raw,value,...rest})=>rest;
const KIND='commissioning';
export function createCentralCommissioning({workspace,store,connection,fetchImpl=globalThis.fetch}={}) {
  if(!workspace?.directory||!store?.transaction||store.directory!==workspace.directory)
    throw fault('CENTRAL_COMMISSIONING_STORE','Compose commissioning with this original workspace and its already-held Store.');
  const selected=connection?normalizeConnection(connection):null;
  let closed=false,closing=false,closePromise=null,faulted=false,queue=Promise.resolve();
  const checked=()=>{if(closed)throw fault('CENTRAL_COMMISSIONING_CLOSED','Reopen the original commissioning operator.');};
  const write=(kind,id,value,expected)=>{
    if(faulted)throw fault('CENTRAL_COMMISSIONING_REOPEN','A storage result was uncertain. Close and reopen the same workspace before resuming.',409);
    try{return store.put(kind,id,value,expected);}
    catch(error){if(!String(error.code||'').startsWith('CENTRAL_'))faulted=true;throw error;}
  };
  const transaction=fn=>{
    if(faulted)throw fault('CENTRAL_COMMISSIONING_REOPEN','Close and reopen the same original workspace after its storage error.',409);
    try{return store.transaction(fn);}
    catch(error){if(!String(error.code||'').startsWith('CENTRAL_'))faulted=true;throw error;}
  };
  const exclusive=fn=>{
    checked();
    if(closing)throw fault('CENTRAL_COMMISSIONING_CLOSING','The original commissioner is settling its accepted operations.',409);
    const pending=queue.then(()=>{checked();return fn();});queue=pending.catch(()=>{});return pending;
  };
  const matching=(kind,id,request)=>{
    const old=store.get(kind,id,false);
    if(old&&stable(old.request)!==stable(request))
      throw fault('CENTRAL_COMMISSIONING_REQUEST_CHANGED','This retained request ID already has another complete selection.',409);
    return old;
  };
  const storeResource=async(owner,key,kind,raw,receipt)=>{
    const bytes=await store.retain(raw),retained={...cleanReceipt(receipt),...bytes};
    return transaction(()=>store.saveResource(owner,key,kind,retained));
  };
  const resourceJson=async(owner,key,path,source)=>{
    let receipt=store.resource(owner,key);
    if(!receipt) {
      const result=await source.json(path);
      receipt=await storeResource(owner,key,'commissioning-observation',result.raw,result);
    }
    return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await store.raw(receipt.sha256))),receipt};
  };
  function state() {
    checked();const original=workspace.state(),identity=store.identity();
    let receivedArchive=null;
    try{receivedArchive=JSON.parse(identity.receivedArchive??'null');}catch{}
    return {schema:COMMISSIONING_SCHEMA,workspaceId:original.id,workspaceDirectory:workspace.directory,
      revision:original.revision,connection:selected,receivedArchive,
      drafts:store.list('commissioning-draft'),
      hostReceipts:store.list('commissioning-host'),
      inspections:store.list('commissioning-inspection').map(({request,project,projects,forms,actor,status,id,revision,sourceIdentity,error})=>
        ({id,revision,status,project,projects,forms,actor,sourceIdentity,error,connectionId:request.connectionId})),
      commissions:store.list(KIND).map(value=>({...value,
        plans:value.definition.plans.map(p=>original.plans.find(x=>x.id===p.id)??null),
        captures:original.captures.filter(x=>value.definition.plans.some(p=>p.id===x.planId)),
        deliveries:store.list('commissioning-delivery').filter(x=>x.request.commissionId===value.id)
          .map(x=>({...x,archive:original.archives.find(a=>a.id===x.archiveId)??null}))})),
      storageReopenRequired:faulted};
  }
  async function recordHost({id,handover}={}) {
    identifier(id,'host handover receipt ID');
    handover=jsonObject(handover,'original Central host handover');
    if(handover.schema!=='stellar-forge.odk-central-host.v1.handover'||typeof handover.operation_id!=='string'||
        !handover.source?.commit||!handover.version||!handover.observed_at||!Array.isArray(handover.container_states))
      throw fault('CENTRAL_COMMISSIONING_HOST_RECEIPT','Use the actual original central-host handover JSON.');
    const handoverConnection=normalizeConnection(handover.connection);
    if(!selected||handoverConnection.url!==selected.url||handoverConnection.authEnv!==selected.authEnv||
        selected.connectionId&&handoverConnection.connectionId!==selected.connectionId)
      throw fault('CENTRAL_COMMISSIONING_HOST_RECEIPT','The host handover must describe this exact private connection.');
    // The original handover is a source/status receipt, never an environment or secret file.
    const allowed=new Set(['schema','operation_id','source','url','mode','version','observed_at','compose_project',
      'runtime','connection','container_states','backup_count','restore','receiving_operation']);
    if(Object.keys(handover).some(key=>!allowed.has(key)))
      throw fault('CENTRAL_COMMISSIONING_HOST_RECEIPT','Use the original host handover output, without additional private configuration.');
    const connectionKeys=new Set(['id','name','url','authEnv','allowLoopback']);
    if(Object.keys(handover.connection).some(key=>!connectionKeys.has(key)))
      throw fault('CENTRAL_COMMISSIONING_HOST_RECEIPT','Host handover connection fields must contain references, not credential values.');
    const request={handover},old=matching('commissioning-host',id,request);
    if(old?.receipt)return old;
    const intent=old??write('commissioning-host',id,{id,request,status:'PREPARED',receivedAt:now()},0),
      owner='commissioning-host:'+id,bytes=formatted(handover);
    let receipt=store.resource(owner,'handover');
    if(receipt&&receipt.sha256!==digest(bytes))throw fault('CENTRAL_COMMISSIONING_HOST_RECEIPT','This retained host receipt ID already has different original bytes.',409);
    if(!receipt)receipt=await storeResource(owner,'handover','commissioning-host',bytes,
      {name:'central-host-handover.json',type:'application/json',receivedAt:intent.receivedAt});
    return write('commissioning-host',id,{...intent,status:'RETAINED',receipt,observedAt:handover.observed_at,
      operationId:handover.operation_id,version:handover.version,connectionId:handoverConnection.connectionId??null},intent.revision);
  }
  async function inspect({id,projectId=null}={}) {
    identifier(id,'inspection request ID');
    if(!selected)throw fault('CENTRAL_COMMISSIONING_CONNECTION','Start with an explicit private connection file.');
    if(projectId!==null&&(typeof projectId!=='string'&&typeof projectId!=='number'))
      throw fault('CENTRAL_COMMISSIONING_PROJECT','Choose an original project ID.');
    const connectionId=selected.connectionId??nativeId('connection',[selected.url,selected.authEnv]),
      request={connection:selected,connectionId,projectId:projectId===null?null:String(projectId)},
      old=matching('commissioning-inspection',id,request);
    if(old?.status==='READY'||old?.status==='PROJECTS')return old;
    let record=old??write('commissioning-inspection',id,{schema:COMMISSIONING_SCHEMA,id,request,status:'INSPECTING',createdAt:now()},0);
    try{
      const source=createCentralSource({...selected,fetchImpl}),owner='commissioning-inspection:'+id,
        actor=await resourceJson(owner,'actor','users/current',source),
        projects=await resourceJson(owner,'projects','projects',source);
      if(!Array.isArray(projects.value)||actor.value===null||typeof actor.value!=='object'||actor.value.id===undefined)
        throw fault('CENTRAL_COMMISSIONING_IDENTITY','The original Central identity/project response is incomplete.',502);
      const project=projectId===null?null:projects.value.find(p=>String(p.id)===String(projectId));
      if(projectId!==null&&!project)throw fault('CENTRAL_COMMISSIONING_PROJECT','This original reader cannot see the selected project.',403);
      const result=project?await resourceJson(owner,'forms','projects/'+encodeURIComponent(String(project.id))+'/forms',source):null;
      if(result&&!Array.isArray(result.value))throw fault('CENTRAL_COMMISSIONING_FORMS','The original form list is not an array.',502);
      const forms=(result?.value??[]).map(f=>({xmlFormId:f.xmlFormId,name:f.name??f.xmlFormId,
        version:f.version,state:f.state,projectId:f.projectId??project?.id,
        createdAt:f.createdAt,updatedAt:f.updatedAt,submissions:f.submissions,lastSubmission:f.lastSubmission}));
      if(forms.some(f=>typeof f.xmlFormId!=='string'||!f.xmlFormId)||new Set(forms.map(f=>f.xmlFormId)).size!==forms.length)
        throw fault('CENTRAL_COMMISSIONING_FORMS','The original form list repeats or omits form IDs.',502);
      const sources={actor:actor.receipt,projects:projects.receipt,...(result?{forms:result.receipt}:{})};
      record=write('commissioning-inspection',id,{...record,status:project?'READY':'PROJECTS',completedAt:now(),
        connectionId,actor:{id:actor.value.id,email:actor.value.email,displayName:actor.value.displayName,type:actor.value.type},
        projects:projects.value.map(p=>({id:p.id,name:p.name,archived:p.archived,forms:p.forms})),
        project:project?{id:project.id,name:project.name,archived:project.archived}:null,forms,sources,
        sourceIdentity:fingerprint({connectionId,url:selected.url,actorId:actor.value.id,projectId:project?.id??null,
          sources:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,v.sha256]))}),error:null},record.revision);
      return record;
    }catch(error){
      if(!faulted)try{write('commissioning-inspection',id,{...store.get('commissioning-inspection',id),status:'FAILED',error:describeError(error)},
        store.get('commissioning-inspection',id).revision);}catch{}
      throw error;
    }
  }
  function saveDraft({id,requestId,expectedRevision,agreement}={}) {
    identifier(id,'agreement draft ID');identifier(requestId,'draft save request ID');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw fault('CENTRAL_COMMISSIONING_REVISION','Retain the current draft revision.');
    agreement=jsonObject(agreement);
    const request={id,expectedRevision,agreement},requestKey='draft:'+requestId,
      prior=matching('commissioning-request',requestKey,request);
    if(prior)return prior.result;
    return transaction(()=>{
      const value=store.writeRecord('commissioning-draft',id,{id,agreement,agreementSha256:fingerprint(agreement),
        readiness:agreementReadiness(agreement),savedAt:now()},expectedRevision);
      store.writeRecord('commissioning-request',requestKey,{request,result:value},0);
      return value;
    });
  }
  function prepare({id,draftId,draftRevision,inspectionId,existingPlanIds}={}) {
    identifier(id,'commissioning version ID');identifier(draftId,'agreement draft ID');identifier(inspectionId,'inspection ID');
    const draft=store.get('commissioning-draft',draftId),inspection=store.get('commissioning-inspection',inspectionId),
      request={draftId,draftRevision,inspectionId,...(existingPlanIds===undefined?{}:{existingPlanIds})},
      previous=matching(KIND,id,request);
    if(previous)return previous;
    if(draft.revision!==draftRevision)throw fault('CENTRAL_COMMISSIONING_REVISION','The agreement draft changed; review its current complete version.',409);
    if(!selected||stable(inspection.request.connection)!==stable(selected))
      throw fault('CENTRAL_COMMISSIONING_CONNECTION','The retained inspection uses another private connection.');
    const definition=compileAgreement(draft.agreement,{inspection,connection:selected,id,existingPlanIds});
    const sourceDefinition={draftId,draftRevision,draftSha256:draft.agreementSha256,
      inspectionId,inspectionRevision:inspection.revision,inspectionSourceIdentity:inspection.sourceIdentity};
    return write(KIND,id,{schema:COMMISSIONING_SCHEMA,id,request,sourceDefinition,definition,
      status:'PREPARED',createdAt:now(),installedPlans:[],connection:selected,error:null},0);
  }
  async function install({id}={}) {
    identifier(id,'commissioning version ID');let record=store.get(KIND,id);
    if(record.status==='INSTALLED') {
      for(const wanted of record.definition.plans) {
        const actual=workspace.state().plans.find(x=>x.id===wanted.id);
        if(!actual||stable(nativePlanShape(actual))!==stable(wanted))
          throw fault('CENTRAL_COMMISSIONING_PLAN_CHANGED','An installed original period plan no longer matches its retained definition.',409);
      }
      return record;
    }
    record=write(KIND,id,{...record,status:'INSTALLING',error:null},record.revision);
    try{
      const inspection=store.get('commissioning-inspection',record.definition.inspectionId),
        con=record.connection,source=createCentralSource({...con,fetchImpl}),
        actor=await resourceJson('commissioning-install:'+id,'actor','users/current',source);
      if(String(actor.value.id)!==String(inspection.actor.id))
        throw fault('CENTRAL_COMMISSIONING_ACTOR','The host credential now resolves to another Central actor. Prepare a new connection/inspection.',409);
      const bound=await workspace.connect({id:record.definition.connectionId,name:con.name,url:con.url,
        authEnv:con.authEnv,allowLoopback:con.allowLoopback});
      if(String(bound.actor.id)!==String(inspection.actor.id))
        throw fault('CENTRAL_COMMISSIONING_ACTOR','This original connection belongs to another Central actor.',409);
      const plans=[];
      for(const wanted of record.definition.plans)plans.push(workspace.createPlan(wanted));
      record=write(KIND,id,{...store.get(KIND,id),status:'INSTALLED',installedAt:now(),installedPlans:plans.map(x=>x.id),
        installActor:actor.receipt,error:null},store.get(KIND,id).revision);
      return record;
    }catch(error){
      if(!faulted)try{const current=store.get(KIND,id);write(KIND,id,{...current,status:'ATTENTION',error:describeError(error)},current.revision);}catch{}
      throw error;
    }
  }
  function capturePeriod({id,period,requestId,label}={}) {
    identifier(id,'commissioning version ID');identifier(requestId,'capture request ID');
    const record=store.get(KIND,id);
    if(record.status!=='INSTALLED')throw fault('CENTRAL_COMMISSIONING_INSTALL','Install the original period plans first.',409);
    if(!Number.isSafeInteger(period)||period<0||period>1)throw fault('CENTRAL_COMMISSIONING_PERIOD','Choose period 0 or 1.');
    const request={commissionId:id,period,planId:record.definition.plans[period].id,
      label:String(label||record.definition.plans[period].name)},key='capture:'+requestId,
      previous=matching('commissioning-request',key,request);
    if(previous?.captureId) {
      const actual=workspace.edition({id:previous.captureId});
      if(actual.planId!==request.planId)throw fault('CENTRAL_COMMISSIONING_CAPTURE_CHANGED','The retained native capture selects another plan.',409);
      return {capture:actual,requestId,reused:true};
    }
    const nativeRequest={id:nativeId('capture',[id,period,requestId]),planId:request.planId,label:request.label};
    if(!previous)write('commissioning-request',key,{request,nativeRequest,status:'PREPARED'},0);
    const capture=workspace.capture(nativeRequest),current=store.get('commissioning-request',key);
    write('commissioning-request',key,{...current,status:'STARTED',captureId:capture.id},current.revision);
    return {capture,requestId,reused:false};
  }
  function resumeCapture({id,captureId}={}) {
    identifier(id,'commissioning version ID');identifier(captureId,'original capture ID');
    const commission=store.get(KIND,id),capture=workspace.edition({id:captureId});
    if(!commission.definition.plans.some(p=>p.id===capture.planId))throw fault('CENTRAL_COMMISSIONING_CAPTURE','This capture belongs to another commissioning plan.');
    return workspace.resume({id:captureId});
  }
  function selectedCaptures(record,selections) {
    if(!Array.isArray(selections)||selections.length!==2)throw fault('CENTRAL_COMMISSIONING_DELIVERY','Select an accepted original capture for each period.');
    return selections.map((selection,index)=>{
      if(!selection||selection.period!==index)throw fault('CENTRAL_COMMISSIONING_DELIVERY','Provide period selections in their original 0,1 order.');
      const capture=workspace.edition({id:selection.captureId}),review=capture.decisions.at(-1);
      if(capture.status!=='COMPLETE'||capture.planId!==record.definition.plans[index].id||
          stable(capture.scope)!==stable(record.definition.periods[index].scope))
        throw fault('CENTRAL_COMMISSIONING_CAPTURE','Choose a complete capture of this exact immutable period plan.',409);
      if(review?.decision!=='accept'||review.id!==selection.reviewId||review.contentHash!==capture.contentHash)
        throw fault('CENTRAL_COMMISSIONING_REVIEW','Choose the current accepted original source review for each period.',409);
      return {period:index,captureId:capture.id,reviewId:review.id,contentHash:capture.contentHash};
    });
  }
  async function nativeOutput(kind,id,expected) {
    const record=store.get(kind,id,false);if(!record)return null;
    const name=kind==='export'?'source.json':'report.json',file=await workspace.exportFile({id,path:name});
    await verifyFile(file.path,record.receipts?.[name]?.sha256);
    const value=JSON.parse(await readFile(file.path,'utf8'));
    if(value.captureId!==expected.captureId||value.review?.id!==expected.reviewId||
        expected.tableId!==undefined&&value.tableId!==expected.tableId||
        expected.baselineId!==undefined&&value.baselineId!==expected.baselineId)
      throw fault('CENTRAL_COMMISSIONING_OUTPUT_CHANGED','An existing native output differs from the retained delivery selection.',409);
    if(kind==='export'&&stable(value.mapping.map(x=>x.path))!==stable(expected.fields))
      throw fault('CENTRAL_COMMISSIONING_OUTPUT_CHANGED','The existing native dataset has another approved projection.',409);
    if(kind==='report'&&stable(value.indicators.map(({tableId,field,operation,name,...x})=>
      ({tableId,field,operation,name,...(Object.hasOwn(x,'equals')?{equals:x.equals}:{})})))!==stable(expected.indicators))
      throw fault('CENTRAL_COMMISSIONING_OUTPUT_CHANGED','The existing native report has another explicit indicator set.',409);
    return record;
  }
  function stillSelected(selection) {
    const capture=workspace.edition({id:selection.captureId}),review=capture.decisions.at(-1);
    if(capture.contentHash!==selection.contentHash||review?.decision!=='accept'||review.id!==selection.reviewId)
      throw fault('CENTRAL_COMMISSIONING_REVIEW_CHANGED',
        'This retained delivery uses an earlier review. Its completed outputs remain available; prepare a new delivery request for the new review.',409);
    return capture;
  }
  async function deliver({id,requestId,captures}={}) {
    identifier(id,'commissioning version ID');identifier(requestId,'handover request ID');
    const commission=store.get(KIND,id);
    if(commission.status!=='INSTALLED')throw fault('CENTRAL_COMMISSIONING_INSTALL','Install the selected period plans first.',409);
    const old=store.get('commissioning-delivery',requestId,false),
      supplied={commissionId:id,captures:jsonObject({captures},'capture selections').captures};
    if(old&&stable(old.selection)!==stable(supplied))
      throw fault('CENTRAL_COMMISSIONING_REQUEST_CHANGED','This handover ID already selects another source/review pair.',409);
    let delivery=old;
    if(!delivery) {
      const selectedCapturesList=selectedCaptures(commission,captures);
      const request={commissionId:id,commissionDefinitionSha256:fingerprint(commission.definition),captures:selectedCapturesList},
        archiveId=nativeId('archive',[requestId,request]);
      delivery=write('commissioning-delivery',requestId,{schema:COMMISSIONING_SCHEMA,id:requestId,selection:supplied,request,archiveId,
        status:'PREPARING',createdAt:now(),datasets:[],reports:[],documents:[],error:null},0);
    }
    const incoming=state().receivedArchive;
    // restore preserves the verified snapshot revision, while every later original
    // Store write advances it. Only a READY row already present in that snapshot
    // can adopt this receiving; a new handover must create its own archive.
    if(delivery.status==='READY_FOR_ARCHIVE'&&incoming&&
        incoming.workspaceId===workspace.state().id&&
        Number.isSafeInteger(delivery.preparedWorkspaceRevision)&&
        Number.isSafeInteger(incoming.workspaceRevision)&&
        delivery.preparedWorkspaceRevision<=incoming.workspaceRevision) {
      return {...delivery,status:'RECEIVED_PORTABLE',archive:null,receivedArchive:incoming};
    }
    if(delivery.status==='COMPLETE') {
      const archive=store.get('archive',delivery.archiveId,false);
      return {...delivery,archive:archive??null,receivedArchive:state().receivedArchive};
    }
    if(delivery.request.commissionDefinitionSha256!==fingerprint(commission.definition))
      throw fault('CENTRAL_COMMISSIONING_DEFINITION_CHANGED','The retained commissioning definition changed.',409);
    try{
      const datasets=[],reports=[];
      for(const selection of delivery.request.captures) {
        const capture=workspace.edition({id:selection.captureId});
        for(const output of commission.definition.outputs) {
          const table=resolveCaptureTable(capture,output),fields=[...new Set([...table.query.keyFields,...(table.relation?[table.relation.parentField]:[]),...output.fields])],
            exportId=nativeId('dataset',[requestId,selection.period,output]),
            expected={captureId:capture.id,reviewId:selection.reviewId,tableId:table.id,fields};
          if(fields.some(path=>!output.fields.includes(path)))throw Object.assign(fault('CENTRAL_COMMISSIONING_NATIVE_KEYS',
            'Explicitly include the original row and parent keys in the approved output fields before delivery.'),
            {details:{formId:output.formId,table:output.table,requiredFields:fields.filter(path=>!output.fields.includes(path))}});
          let result=await nativeOutput('export',exportId,expected);
          if(!result) {
            stillSelected(selection);
            result=await workspace.exportDataset({id:capture.id,tableId:table.id,fields:output.fields,
              name:output.name,exportId});
            await nativeOutput('export',exportId,expected);
          }
          datasets.push({period:selection.period,id:result.id,captureId:capture.id,tableId:table.id,name:output.name,
            files:result.files,receipts:result.receipts});
        }
        const indicators=commission.definition.indicators.map(value=>{
          const table=resolveCaptureTable(capture,value);
          return {tableId:table.id,name:value.name,operation:value.operation,...(value.field?{field:value.field}:{}),
            ...(Object.hasOwn(value,'equals')?{equals:value.equals}:{})};
        }), baselineId=selection.period===1?delivery.request.captures[0].captureId:null,
          reportId=nativeId('report',[requestId,selection.period,indicators]),expected={
            captureId:capture.id,reviewId:selection.reviewId,baselineId,
            indicators:indicators.map(x=>({...x,field:x.field??null}))};
        let report=await nativeOutput('report',reportId,expected);
        if(!report) {
          stillSelected(selection);
          if(baselineId)stillSelected(delivery.request.captures[0]);
          report=await workspace.report({id:capture.id,baselineId,reportId,
            title:(commission.definition.agreement.name||commission.definition.agreement.opportunity_id)+' / '+commission.definition.periods[selection.period].label,
            narrative:reportNarrative(commission),indicators});
          await nativeOutput('report',reportId,expected);
        }
        reports.push({period:selection.period,id:report.id,captureId:capture.id,baselineId,
          files:report.files,receipts:report.receipts});
      }
      const handover=handoverDocument(commission,delivery,datasets,reports),documents=[];
      for(const [name,type,body]of [['commissioning-handover.md','text/markdown; charset=utf-8',Buffer.from(handover)],
        ['source-report-agreement.json','application/json',formatted(commission.definition.agreement)],
        ['commissioning-handover.json','application/json',formatted({schema:COMMISSIONING_SCHEMA,commissionId:id,
          definition:commission.definition,sourceDefinition:commission.sourceDefinition,
          selections:delivery.request.captures,datasets,reports,archiveId:delivery.archiveId})]]) {
        const key='document:'+name,owner='commissioning-delivery:'+requestId,
          oldResource=store.resource(owner,key);
        let receipt=oldResource;
        if(!receipt)receipt=await storeResource(owner,key,'commissioning-handover',body,{name,type,generatedAt:now()});
        else if(receipt.sha256!==digest(body))throw fault('CENTRAL_COMMISSIONING_DOCUMENT_CHANGED','The retained complete handover document changed.',409);
        documents.push({name,type,...receipt});
      }
      const current=store.get('commissioning-delivery',requestId),
        preparedWorkspaceRevision=Number(store.identity().revision)+1;
      if(!Number.isSafeInteger(preparedWorkspaceRevision)||preparedWorkspaceRevision<1)
        throw fault('CENTRAL_COMMISSIONING_ARCHIVE_REVISION','The original workspace revision cannot identify this handover snapshot.',409);
      // No await intervenes between this original revision read and the original
      // synchronous Store transaction that increments it for the READY row.
      delivery=write('commissioning-delivery',requestId,{...current,status:'READY_FOR_ARCHIVE',datasets,reports,documents,
        preparedAt:current.preparedAt??now(),preparedWorkspaceRevision,error:null},current.revision);
      const archive=await workspace.backup({id:delivery.archiveId});
      delivery=write('commissioning-delivery',requestId,{...store.get('commissioning-delivery',requestId),status:'COMPLETE',
        completedAt:now(),archiveReceipt:{id:archive.id,sha256:archive.sha256,bytes:archive.bytes,files:archive.files},error:null},
        store.get('commissioning-delivery',requestId).revision);
      return {...delivery,archive};
    }catch(error){
      if(!faulted)try{const current=store.get('commissioning-delivery',requestId);
        write('commissioning-delivery',requestId,{...current,status:'ATTENTION',error:describeError(error)},current.revision);}catch{}
      throw error;
    }
  }
  function reportNarrative(commission) {
    const a=commission.definition.agreement,d=a.customer_decisions;
    return ['Customer/source agreement '+a.opportunity_id+' / '+commission.definition.agreementSha256,
      'Reporting timezone: '+d.reporting_timezone+'. Boundaries in the saved plan are exact UTC instants; the end is exclusive.',
      'Late-edit interpretation: '+(typeof d.late_edit_policy==='string'?d.late_edit_policy:stable(d.late_edit_policy)),
      'Source review-state interpretation: '+(typeof d.review_state_inclusion==='string'?d.review_state_inclusion:stable(d.review_state_inclusion)),
      'The original source reader retains all review states and current available versions at acquisition. No historical-as-of reconstruction is inferred.',
      'Media agreement: '+(typeof d.media_retention_selection==='string'?d.media_retention_selection:stable(d.media_retention_selection)),
      'The approved CSV projection is delivered with the native complete selected-capture source package. Original rows.jsonl, source pages, XML/media and the portable archive retain the full selected source for the designated receiver.',
      'Complete agreed measure definitions: '+stable(d.metric_definitions),
      'Cross-form/period identity agreement: '+stable(d.cross_form_identity_rules??[])].join('\n\n');
  }
  function handoverDocument(commission,delivery,datasets,reports) {
    const def=commission.definition,a=def.agreement,d=a.customer_decisions;
    const lines=['# Central commissioning handover','',
      'Commission: '+commission.id,'Original opportunity: '+a.opportunity_id,
      'Agreement SHA-256: '+def.agreementSha256,
      'Source inspection: '+def.inspectionId+' / '+def.sourceIdentity,'',
      '## Original operator and source','',
      'Central origin: '+commission.connection.url,
      'Private credential reference: '+commission.connection.authEnv+' (value stays on the host).',
      'Project: '+def.projectId,
      'Accountable project owner: '+String(d.accountable_project_owner),
      'Technical receiver: '+String(d.technical_receiver),'',
      '## Two retained reporting periods',''];
    for(const p of def.periods) {
      const chosen=delivery.request.captures[p.index];
      lines.push(p.label+': '+p.scope.submittedFrom+' through '+p.scope.submittedBefore+' (exclusive).',
        'Original plan '+def.plans[p.index].id+'; capture '+chosen.captureId+'; accepted review '+chosen.reviewId+'.','');
    }
    lines.push('## Approved native outputs','');
    for(const x of datasets)lines.push('- Dataset '+x.id+' — '+x.name+'; '+x.files.length+' complete files.');
    for(const x of reports)lines.push('- Report '+x.id+' — '+def.periods[x.period].label+'; '+x.files.length+' complete files.');
    lines.push('','## Open, correct and recover','',
      '1. Reopen the same original commissioning CLI/browser with its private connection file. Inspect the original saved definition and both plan IDs.',
      '2. Open the original field workspace to inspect rows, XML generations, source/media coverage and the exact accepted reviews.',
      '3. Download the full report and dataset files through their original native output entries. The CSV uses approved fields, while native rows.jsonl/source pages and the portable archive retain the complete selected capture for the designated full-source receiver. Their manifests and source receipts remain authoritative.',
      '4. A later source or interpretation correction uses a new original capture/review and a new handover request. The earlier definition, captures and outputs remain retained.',
      '5. The accompanying original central-workspace.tar.gz contains this complete database, every referenced observation/source/media file and the native output files.',
      '6. Restore it with the original restoreCentralArchive/commissioning restore entry into an independent workspace. Supply its expected SHA-256. Reopen with an appropriate host credential alias; restoring never creates or changes the upstream Central server.',
      '7. The original Central service backup/restore is separately operated through the DCE4 central-host profile. Customer-report portability does not replace the upstream database/secret backup.',
      '','## Delivery calendar','',JSON.stringify(def.schedule,null,2),'',
      'The calendar is an explicit proposal or source-referenced kickoff. This workbench does not book capacity, accept fees, send customer messages or create invoices.',
      '','## Full agreement interpretation','',reportNarrative(commission),'',
      'Archive operation ID: '+delivery.archiveId+'. This document is committed before the native portable snapshot; its archive receipt is returned by that original operation.','');
    return lines.join('\n');
  }
  const api={state,readiness:agreementReadiness,
    recordHost:input=>exclusive(()=>recordHost(input)),
    inspect:input=>exclusive(()=>inspect(input)),
    saveDraft:input=>exclusive(()=>saveDraft(input)),
    prepare:input=>exclusive(()=>prepare(input)),
    install:input=>exclusive(()=>install(input)),
    capturePeriod:input=>exclusive(()=>capturePeriod(input)),
    resumeCapture:input=>exclusive(()=>resumeCapture(input)),
    deliver:input=>exclusive(()=>deliver(input)),
    close(){
      if(closePromise)return closePromise;closing=true;
      closePromise=queue.then(()=>{closed=true;});return closePromise;
    }};
  return Object.freeze(api);
}
