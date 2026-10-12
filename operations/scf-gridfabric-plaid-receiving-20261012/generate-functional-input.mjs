#!/usr/bin/env node
import fs from 'node:fs';
import {resolve, dirname, join, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';


export function createFunctionalFiles({hash, canonical, publicExamples, publicContract}) {
  if(typeof hash!=='function'||typeof canonical!=='function')throw Error('The retained SHA-256 implementation and original model.canonical are required.');
  const copy=x=>JSON.parse(JSON.stringify(x));
  const json=x=>JSON.stringify(x)+'\n';
  const pretty=x=>JSON.stringify(x,null,2)+'\n';
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const classification='TOKENJUNKIELABS_AUTHORED_FUNCTIONAL_DATA_NOT_VENDOR_CAPTURE';
  const recipeId='tjl-gridfabric-31-day-functional-v1';
  const startTimet=Date.parse('2026-08-01T00:00:00Z')/1000;
  const period=900,days=31,points=days*96,endTimet=startTimet+(points-1)*period;
  const reviewer='TokenJunkieLabs functional receiving review';
  const instanceId='tjl-functional-plaid-31day';
  const quality='Quality Good - Non Specific';
  const kinds=['power','energy','status'];
  const specifiers={power:'TJL_FUNCTIONAL_POWER_31D',energy:'TJL_FUNCTIONAL_ENERGY_31D',status:'TJL_FUNCTIONAL_STATUS_31D'};
  const devices=Array.from({length:8},(_,d)=>({
    device_id:'tjl-functional-device-'+String(d+1).padStart(2,'0'),
    adapter_id:'tjl-functional-adapter-'+String(d+1).padStart(2,'0'),
    target_ids:{resourceId:['tjl-functional-resource-'+String(d+1).padStart(2,'0')],groupId:[d%2?'tjl-functional-even':'tjl-functional-odd'],venId:['tjl-functional-ven'],partyId:['tjl-functional-party']}
  }));
  const windows=[
    {device_index:0,day_index:6,first_quarter:40,quarters:8,delta_watts:120},
    {device_index:2,day_index:13,first_quarter:56,quarters:8,delta_watts:-80},
    {device_index:4,day_index:20,first_quarter:20,quarters:8,delta_watts:240},
    {device_index:6,day_index:27,first_quarter:72,quarters:8,delta_watts:-160}
  ].map((w,i)=>({...w,key:'correction-window-'+String(i+1),device_id:devices[w.device_index].device_id,startTimet:startTimet+(w.day_index*96+w.first_quarter)*period,endTimet:startTimet+(w.day_index*96+w.first_quarter+w.quarters-1)*period}));
  const correctionByPoint=new Map();
  for(const w of windows)for(let q=0;q<w.quarters;q++)correctionByPoint.set(w.device_index+':'+(w.day_index*96+w.first_quarter+q),w);
  const correctedDeviceIndexes=new Set(windows.map(w=>w.device_index));
  function scaled(integer,places) {
    const negative=integer<0,absolute=Math.abs(integer),s=String(absolute).padStart(places+1,'0');
    return (negative?'-':'')+(places?s.slice(0,-places)+'.'+s.slice(-places):s);
  }
  function watts(d,t) {
    const day=Math.floor(t/96),q=t%96;
    const shape=q<24?120:q<48?340:q<72?620:260;
    return 1200+(d+1)*173+shape+((day+2*d)%7)*19+(q%12)*13;
  }
  function originalStatus(d,t) {
    const q=t%96,day=Math.floor(t/96),override=(day+d)%11===0&&q>=40&&q<44;
    return {schema:'tjl.functional-device-status.v1',available:true,operating_mode:override?'authored-manual-override':q<24?'authored-night':'authored-normal',manual_override:override};
  }
  function point(d,t,kind,corrected) {
    const window=corrected?correctionByPoint.get(d+':'+t):undefined;
    const w=watts(d,t)+(window?window.delta_watts:0);
    if(kind==='status'){
      const value=originalStatus(d,t);
      if(window){value.operating_mode='authored-corrected-control';value.manual_override=!value.manual_override;value.correction_window=window.key;}
      return {unit:'status',status:value};
    }
    const small=d<4;
    if(kind==='power')return {unit:small?'W':'kW',value:small?scaled(w*1000,3):scaled(w,3)};
    return {unit:small?'Wh':'kWh',value:small?scaled(w*25,2):scaled(w*25,5)};
  }
  function row(d,t,kind,corrected=false) {
    const index=((t*8+d)*3+kinds.indexOf(kind))+1;
    const originalId='O/'+String(d+1).padStart(2,'0')+'/'+String(t).padStart(4,'0')+'/'+kind;
    const r={record_id:(corrected?'C':'O')+originalId.slice(1),device:devices[d].device_id,channel:kind,kind,
      start:startTimet+t*period,end:startTimet+(t+1)*period,...point(d,t,kind,corrected),quality};
    if(corrected){r.corrects_record_id=originalId;r.corrects_original_record=index;}
    return r;
  }
  const originalRows=[];
  for(let t=0;t<points;t++)for(let d=0;d<8;d++)for(const kind of kinds)originalRows.push(row(d,t,kind));
  const correctionRows=[];
  for(const w of windows)for(let q=0;q<w.quarters;q++)for(const kind of kinds)correctionRows.push(row(w.device_index,w.day_index*96+w.first_quarter+q,kind,true));
  assert(originalRows.length===71424&&correctionRows.length===96,'The complete original and correction record counts changed.');
  const provenance={classification,author:'TokenJunkieLabs',recipe_id:recipeId,measurement_origin:'Deterministic functional values authored by this generator; no physical meter, device platform, VEN or VTN supplied these readings.',
    measurement_timezone:'UTC',timestamp_format:'epoch_seconds',range:{start:'2026-08-01T00:00:00Z',end_exclusive:'2026-09-01T00:00:00Z',query_end_inclusive:'2026-08-31T23:45:00Z',period_seconds:period},
    value_semantics:{power:'interval_average_power',energy:'interval_energy',status:'status'},status_schema:'tjl.functional-device-status.v1',
    status_schema_scope:'Opaque authored functional object preserved by the original engine. It is not a licensed Plaid telemetry-status schema.',
    recipe:{watts:'1200 + (device_index + 1) * 173 + shape(quarter) + ((day_index + 2 * device_index) % 7) * 19 + (quarter % 12) * 13',
      shape:[{quarters:'0..23',watts:120},{quarters:'24..47',watts:340},{quarters:'48..71',watts:620},{quarters:'72..95',watts:260}],
      energy:'Each interval contains one quarter-hour: exact watt-hours = integer watts / 4.',
      source_units:'Devices 1..4 retain W / Wh; devices 5..8 retain kW / kWh. Mapping explicitly emits W / Wh.',
      decimals:'Original decimal strings retain their zero suffixes; this generator uses integer scaling and performs no binary floating-point energy calculation.',
      correction:'Only four declared two-hour windows differ. Power and interval energy change coherently; the opaque status changes explicitly and retains its original row binding.'}};
  const profile={rows_pointer:'/rows',fields:{device_id:'/device',channel:'/channel',kind:'/kind',start:'/start',end:'/end',value:'/value',unit:'/unit',data_quality:'/quality',status:'/status'},constants:{},timestamp_format:'epoch_seconds',value_semantics:{energy:'interval_energy',power:'interval_average_power',status:'status'}};
  const fileList=[],fileMap=new Map();
  function addFile(key,path,data,{name=path.split('/').at(-1),mime_type='application/json',classification:kind=classification}={}) {
    assert(!fileMap.has(key)&&!fileList.some(f=>f.path===path),'Duplicate input identity.');
    const content=typeof data==='string'?data:json(data),identity=hash(content);
    const file={key,path,name,mime_type,bytes:identity.bytes,sha256:identity.sha256,classification:kind,content};
    fileList.push(file);fileMap.set(key,file);return file;
  }
  const original=addFile('original','sources/functional-original.json',{schema:'stellar-forge.gridfabric-functional-measurements.v1',edition:'ORIGINAL',provenance,rows:originalRows});
  const correction=addFile('correction','sources/functional-correction.json',{schema:'stellar-forge.gridfabric-functional-measurements.v1',edition:'CORRECTION',provenance:{...provenance,corrects_file_sha256:original.sha256,correction_windows:windows},rows:correctionRows});
  const lineage=addFile('lineage','sources/functional-lineage.json',{schema:'stellar-forge.gridfabric-functional-lineage.v1',classification,recipe_id:recipeId,
    original:{file_sha256:original.sha256,bytes:original.bytes,records:originalRows.length,record_pointer:'/rows/{original_record-1}',stable_record_id:'rows[].record_id',record_order:'timestamp, device index, power/energy/status',native_binding:'The unchanged engine retains source_id, source_row_id, original_record and complete original_row.'},
    correction:{file_sha256:correction.sha256,bytes:correction.bytes,records:correctionRows.length,corrects_file_sha256:original.sha256,record_pointer:'/rows/{correction_record-1}'},
    rows:correctionRows.map((r,i)=>({correction_record:i+1,correction_record_id:r.record_id,original_record:r.corrects_original_record,original_record_id:r.corrects_record_id,original_json_pointer:'/rows/'+(r.corrects_original_record-1),correction_json_pointer:'/rows/'+i,device_id:r.device,channel:r.channel,startTimet:r.start,endTimet:r.end,original_value:copy(originalRows[r.corrects_original_record-1]),corrected_value:copy(r)}))});
  const callbackSchema={
    schema:'tjl.functional-plaid-callback-bindings.v1',classification,instance_id:instanceId,
    scope:'All functional event documents and JSON pointers below are authored by TokenJunkieLabs. Only documented header/messageType, callback routes, report registration/query wire fields and semantic target categories come from the public contract. The licensed vendor event/opt/status schemas are not supplied.',
    event_document:{id:'String authored event identifier',revision:'Nonnegative authored revision integer, or deliberately omitted in the unknown-revision exercise',targets:'Optional authored object with resources/groups/ven/parties arrays',description:'Authored description'},
    wrapper:{header:{messageType:'The documented callback type',instanceId:instanceId},functional:{event:'One authored event, when selected',events:'Array of authored events for distribution only',distributionId:'Authored stable distribution identifier',interval:{id:'Authored interval ID',effective_start_timet:'Authored epoch seconds',signal:'Original authored signal object retained unchanged'}}},
    status_object:{schema:'tjl.functional-device-status.v1',available:'boolean',operating_mode:'authored string',manual_override:'boolean',correction_window:'optional authored correction window identity'},
    target_binding:{target_match:'all',target_bindings:[{pointer:'/resources',category:'resourceId'},{pointer:'/groups',category:'groupId'},{pointer:'/ven',category:'venId'},{pointer:'/parties',category:'partyId'}]},
    omitted_claims:['No vendor event wrapper or opt reply schema is claimed.','No provider management response is fabricated.','No callback initiates a management or device HTTP dispatch.','Functional target IDs and adapters do not identify actual physical equipment.']
  };
  addFile('callback_schema','sources/authored-callback-bindings.json',callbackSchema);
  assert(publicExamples&&publicExamples.source&&Array.isArray(publicExamples.response_examples),'Load the exact retained public examples.');
  addFile('public_examples','public/published-management-and-query-examples.json',publicExamples,{classification:'RETAINED_PUBLIC_HISTORICAL_AND_EXPLICITLY_LABELED_EXAMPLES'});
  const historical452=publicExamples.response_examples.find(x=>x.body&&x.body.response&&x.body.response.code===452);
  assert(historical452&&historical452.http_status===200&&historical452.body.status==='OK','The public layered 452 example changed.');
  addFile('public_452','public/published-http200-status-ok-vtn452.json',{schema:'stellar-forge.gridfabric-public-response-receiving.v1',classification:'PUBLISHED_HISTORICAL_EXAMPLE_NOT_AN_EXECUTION_RECEIPT',source:copy(publicExamples.source),response:copy(historical452),expected_interpretation:{http_transport:'HTTP_200',management_status:'OK',vtn_response_code:452,vtn_response_message:'Invalid ID - invalid or inactive',successful_vtn_operation:false}});
  const publicQuery=copy(publicExamples.query_example);
  addFile('public_query','public/documented-query-path-example.json',{schema:'stellar-forge.gridfabric-public-query-paths.v1',classification:'AUTHORED_VALUES_USING_DOCUMENTED_PUBLIC_PATHS_NOT_VENDOR_CAPTURE',example:publicQuery});
  const reference=p=>({$ref:p});
  const sourceRef=key=>reference('steps.'+key+'.source_id');
  const definitions=Object.fromEntries(kinds.map(kind=>[kind,{kind,specifier:specifiers[kind],rIds:devices.map((d,i)=>'TJL_'+kind.toUpperCase()+'_'+String(i+1).padStart(2,'0'))}]));
  function registration() {
    return {onRegisterReportsResponseMessage:{telemetryReports:kinds.map(kind=>({
      duration:{duration:days*24*60,durationModifier:'M'},reportSpecifierId:specifiers[kind],reportName:kind==='status'?'TELEMETRY_STATUS':'TELEMETRY_USAGE',
      intervalDescriptions:devices.map((device,d)=>{
        const interval={rid:definitions[kind].rIds[d],samplingPeriod:{maxSamplingPeriod:15,minSamplingPeriod:15,samplingPeriodModifier:'M',onChange:false},marketContext:'https://example.invalid/tjl-functional-gridfabric',resourceId:device.target_ids.resourceId[0]};
        if(kind!=='status')interval.usageIntervalProperties={readingType:'Direct Read',reportType:'usage',units:{description:kind==='power'?'RealPower':'RealEnergy',siScaleCode:'none',units:kind==='power'?'W':'Wh',unitType:kind==='power'?'POWER_REAL':'ENERGY_REAL'}};
        return interval;
      })
    }))}};
  }
  const registered=registration();addFile('registration','expected/functional-registration-response.json',registered);
  function entries(corrected) {
    return kinds.flatMap(kind=>devices.map((device,d)=>({
      r_id:definitions[kind].rIds[d],report_specifier_id:specifiers[kind],
      source_ids:corrected&&correctedDeviceIndexes.has(d)?[sourceRef('correction'),sourceRef('original')]:[sourceRef('original')],
      device_id:device.device_id,channel:kind,kind,unit:kind==='power'?'W':kind==='energy'?'Wh':'status',
      time_basis:kind==='status'?'instant':'start',period_seconds:period,aggregation:kind==='power'?'power_average':kind==='energy'?'energy_sum':'status',decimal_places:6,allow_resample:false
    })));
  }
  function exactWire(kind,d,t,corrected) {
    const w=watts(d,t)+(corrected&&correctionByPoint.has(d+':'+t)?correctionByPoint.get(d+':'+t).delta_watts:0);
    const wire={dataQuality:quality,dtStartTimet:startTimet+t*period,rId:definitions[kind].rIds[d]};
    if(kind==='status')wire.status=point(d,t,kind,corrected).status;
    else wire.value=kind==='power'?w:w/4;
    return wire;
  }
  function expectedResponse(selected,start,end,corrected) {
    const groups=new Map();
    for(let timestamp=start;timestamp<=end;timestamp+=period)for(const {kind,d} of selected){
      if(!groups.has(specifiers[kind]))groups.set(specifiers[kind],[]);
      groups.get(specifiers[kind]).push(exactWire(kind,d,(timestamp-startTimet)/period,corrected));
    }
    return {onQueryIntervalsResponseMessage:{reports:Array.from(groups,([reportSpecifierId,reportIntervals])=>({...(groups.size>1?{reportIdentifier:{reportSpecifierId}}:{}),reportIntervals}))}};
  }
  const steps=[],checks=[],comparisons=[];
  const addImport=(key,file_key,input)=>steps.push({key,kind:'import',file_key,input});
  const addAction=(key,action,input)=>steps.push({key,kind:'action',action,input});
  const addCheck=(target,equals)=>checks.push({target:reference(target),equals});
  const addCallback=(key,kind,payload)=>{
    const route=publicContract.callbacks.find(x=>x.messageType===kind);assert(route,'The documented callback route is missing.');
    const file=addFile('callback_'+key,'callbacks/'+key+'.json',typeof payload==='string'?payload:payload);
    steps.push({key,kind:'callback',instance_id:instanceId,endpoint:route.endpoint,file_key:file.key});return file;
  };
  for(const key of ['public_examples','public_452','public_query','callback_schema','lineage'])addImport(key,key,{name:fileMap.get(key).name,format:'original',provenance:{classification:fileMap.get(key).classification,source_file_sha256:fileMap.get(key).sha256,source_uri:key.startsWith('public')?publicExamples.source.url:null,recipe_id:key.startsWith('public')?null:recipeId}});
  addImport('original','original',{name:original.name,format:'json',profile,provenance:{...provenance,edition:'ORIGINAL',source_file_sha256:original.sha256}});
  addCheck('steps.original.status','READY');addCheck('steps.original.row_count',71424);addCheck('steps.original.issue_count',0);addCheck('steps.original.valid_rows',71424);
  const baseInstance={instance_id:instanceId,name:'Authored 31-day GridFabric functional portfolio',management_url:'http://127.0.0.1:9',management_headers_env:{},callback_headers_env:{},device_adapter_url:'http://127.0.0.1:9',device_adapter_headers_env:{},schema_source_id:sourceRef('callback_schema'),devices,bindings:{}};
  addAction('instance_unbound','configure_instance',baseInstance);
  const event=(id,revision,targets={},description='Authored functional event')=>({id,...(revision===undefined?{}:{revision}),targets,description});
  const wrap=(kind,body)=>({header:{messageType:kind,instanceId},functional:body});
  addCallback('unmapped_event','OnEvent',wrap('OnEvent',{event:event('tjl-functional-unmapped',0)}));
  addCheck('steps.unmapped_event.processing_status','UNPROJECTED_SCHEMA');
  const common={evidence_source_id:sourceRef('callback_schema'),reviewer,event_pointer:'/functional/event',event_id_pointer:'/id',revision_pointer:'/revision',targets_pointer:'/targets',target_bindings:copy(callbackSchema.target_binding.target_bindings),target_match:'all'};
  const bindings={};
  for(const kind of ['OnEvent','OnEventStart','OnEventCancel','OnEventArchive','OnEventComplete','OnEventRampUp'])bindings[kind]=copy(common);
  bindings.OnEventIntervalStart={...copy(common),interval_id_pointer:'/functional/interval/id',signal_pointer:'/functional/interval/signal',interval_start_pointer:'/functional/interval/effective_start_timet'};
  bindings.OnDistributeEventStart={...copy(common),events_pointer:'/functional/events',distribution_id_pointer:'/functional/distributionId'};delete bindings.OnDistributeEventStart.event_pointer;
  bindings.OnDistributeEventComplete={evidence_source_id:sourceRef('callback_schema'),reviewer,distribution_id_pointer:'/functional/distributionId'};
  addAction('instance_bound','configure_instance',{...baseInstance,bindings});
  addAction('mapping_original','save_mapping',{instance_id:instanceId,name:'Original authored 31-day measurements',reviewer,entries:entries(false),registration_response:registered,source_evidence:[sourceRef('original'),sourceRef('callback_schema'),sourceRef('public_examples')]});
  addAction('activate_original','activate_mapping',{mapping_id:reference('steps.mapping_original.mapping_id'),reviewer});
  for(const w of windows){
    const selected=kinds.map(kind=>({kind,d:w.device_index})),rIds=selected.map(x=>definitions[x.kind].rIds[x.d]),key='original_'+w.key.replaceAll('-','_');
    const expected=addFile('expected_'+key,'expected/'+key+'.json',expectedResponse(selected,w.startTimet,w.endTimet,false));
    addAction(key,'build_report',{instance_id:instanceId,query:{startTimet:w.startTimet,endTimet:w.endTimet,granularityInSeconds:period,rIds}});
    addCheck('steps.'+key+'.status','READY');addCheck('steps.'+key+'.row_count',24);addCheck('steps.'+key+'.issue_count',0);
    comparisons.push({actual_sha256:reference('steps.'+key+'.response_file.sha256'),expected_file_key:expected.key,representation:'json'});
  }
  addImport('correction','correction',{name:correction.name,format:'json',profile,corrects_source_id:sourceRef('original'),provenance:{...provenance,edition:'CORRECTION',source_file_sha256:correction.sha256,corrects_file_sha256:original.sha256,correction_windows:windows}});
  addCheck('steps.correction.status','READY');addCheck('steps.correction.row_count',96);addCheck('steps.correction.issue_count',0);
  addAction('mapping_corrected','save_mapping',{instance_id:instanceId,name:'Reviewed sparse corrections over original 31-day measurements',reviewer,entries:entries(true),registration_response:registered,source_evidence:[sourceRef('original'),sourceRef('correction'),sourceRef('lineage'),sourceRef('callback_schema'),sourceRef('public_examples')]});
  addAction('activate_corrected','activate_mapping',{mapping_id:reference('steps.mapping_corrected.mapping_id'),reviewer});
  addCallback('register_reports','OnRegisterReports',wrap('OnRegisterReports',{}));addCheck('steps.register_reports.http_status',200);addCheck('steps.register_reports.body_utf8',canonical(registered));
  for(const kind of kinds){
    const key='full_'+kind,query={startTimet,endTimet,granularityInSeconds:period,rIds:definitions[kind].rIds,reportSpecifierId:specifiers[kind]};
    const expected=addFile('expected_'+key,'expected/'+key+'.json',expectedResponse(devices.map((_,d)=>({kind,d})),startTimet,endTimet,true));
    addAction(key,'build_report',{instance_id:instanceId,query});
    addCheck('steps.'+key+'.status','READY');addCheck('steps.'+key+'.row_count',23808);addCheck('steps.'+key+'.issue_count',0);
    comparisons.push({actual_sha256:reference('steps.'+key+'.response_file.sha256'),expected_file_key:expected.key,representation:'json'});
  }
  const queryKind='status',callbackQuery={startTimet:windows[0].startTimet,endTimet:windows[0].endTimet,granularityInSeconds:period,rIds:[definitions[queryKind].rIds[0]],reportSpecifierId:specifiers[queryKind]};
  const queryFile=addCallback('query_intervals','OnQueryIntervals',{header:{messageType:'OnQueryIntervals',instanceId},onQueryIntervalsMessage:callbackQuery});
  addCheck('steps.query_intervals.http_status',200);addCheck('steps.query_intervals.body_utf8',canonical(expectedResponse([{kind:queryKind,d:0}],windows[0].startTimet,windows[0].endTimet,true)));
  steps.push({key:'query_intervals_replay',kind:'callback',instance_id:instanceId,endpoint:'queryIntervals',file_key:queryFile.key});addCheck('steps.query_intervals_replay.replayed',true);addCheck('steps.query_intervals_replay.body_utf8',canonical(expectedResponse([{kind:queryKind,d:0}],windows[0].startTimet,windows[0].endTimet,true)));
  const targetA={resources:[devices[0].target_ids.resourceId[0],devices[2].target_ids.resourceId[0],devices[5].target_ids.resourceId[0]],groups:['tjl-functional-odd']};
  const eA=event('tjl-functional-targeted',0,targetA),eB=event('tjl-functional-all-devices',0),eC=event('tjl-functional-opted-out',0,{resources:[devices[7].target_ids.resourceId[0]]});
  for(const [key,e,opt]of [['a',eA,'optIn'],['b',eB,'optIn'],['c',eC,'optOut']])addAction('opt_'+key,'record_opt_decision',{instance_id:instanceId,event_id:e.id,opt_type:opt,opt_reason:'economic',reviewer,source_evidence:[sourceRef('callback_schema')]});
  addCallback('distribution_start','OnDistributeEventStart',wrap('OnDistributeEventStart',{distributionId:'tjl-functional-distribution-01',events:[eA,eB,eC]}));
  addCallback('distribution_complete','OnDistributeEventComplete',wrap('OnDistributeEventComplete',{distributionId:'tjl-functional-distribution-01'}));addCheck('steps.distribution_complete.processing_status','DISTRIBUTION_COMPLETE');
  addCallback('event_definition','OnEvent',wrap('OnEvent',{event:eA}));
  addCallback('ramp_up','OnEventRampUp',wrap('OnEventRampUp',{event:eA}));
  addCallback('event_start','OnEventStart',wrap('OnEventStart',{event:eA}));
  const interval=(id,at,watts)=>({id,effective_start_timet:at,signal:{schema:'tjl.functional-control-signal.v1',operation:'authored-limit-real-power',requested_watts:String(watts)}});
  const firstInterval=addCallback('interval_revision_zero','OnEventIntervalStart',wrap('OnEventIntervalStart',{event:eA,interval:interval('authored-interval-0',windows[0].startTimet,900)}));
  steps.push({key:'interval_revision_zero_replay',kind:'callback',instance_id:instanceId,endpoint:'startEventInterval',file_key:firstInterval.key});addCheck('steps.interval_revision_zero_replay.replayed',true);
  addCheck('steps.interval_revision_zero.projection.events.0.device.actions.length',2);
  const eA1=event(eA.id,1,targetA,'Authored revised event retains original target bindings');
  addCallback('event_revision_one','OnEvent',wrap('OnEvent',{event:eA1}));
  addCallback('interval_revision_one','OnEventIntervalStart',wrap('OnEventIntervalStart',{event:eA1,interval:interval('authored-interval-1',windows[0].startTimet+900,750)}));
  addCheck('steps.interval_revision_one.projection.events.0.device.actions.length',2);
  addCallback('stale_revision','OnEventStart',wrap('OnEventStart',{event:event(eA.id,0,targetA,'Separate authored stale lifecycle delivery')}));addCheck('steps.stale_revision.projection.events.0.status','STALE');
  addCallback('unknown_revision','OnEvent',wrap('OnEvent',{event:event(eA.id,undefined,targetA,'Authored event with unavailable revision')}));addCheck('steps.unknown_revision.projection.events.0.status','REVISION_UNKNOWN');
  addCallback('conflicting_revision','OnEvent',wrap('OnEvent',{event:event(eA.id,1,targetA,'Different authored definition for the same existing revision')}));addCheck('steps.conflicting_revision.projection.events.0.status','CONFLICT');
  addCallback('event_cancel','OnEventCancel',wrap('OnEventCancel',{event:eA1}));addCheck('steps.event_cancel.projection.events.0.status','CANCEL_REQUESTED');addCheck('steps.event_cancel.projection.events.0.device',null);
  addCallback('event_archive','OnEventArchive',wrap('OnEventArchive',{event:eA1}));addCheck('steps.event_archive.projection.events.0.status','ARCHIVED');addCheck('steps.event_archive.projection.events.0.device',null);
  addCallback('event_end','OnEventComplete',wrap('OnEventComplete',{event:eA1}));addCheck('steps.event_end.projection.events.0.device.actions.length',2);
  addCallback('all_devices_interval','OnEventIntervalStart',wrap('OnEventIntervalStart',{event:eB,interval:interval('authored-all-devices',windows[1].startTimet,1000)}));addCheck('steps.all_devices_interval.projection.events.0.device.actions.length',8);
  addCallback('all_devices_end','OnEventComplete',wrap('OnEventComplete',{event:eB}));addCheck('steps.all_devices_end.projection.events.0.device.actions.length',8);
  addCallback('opted_out_interval','OnEventIntervalStart',wrap('OnEventIntervalStart',{event:eC,interval:interval('authored-opted-out',windows[2].startTimet,500)}));addCheck('steps.opted_out_interval.projection.events.0.device.status','OPTED_OUT');addCheck('steps.opted_out_interval.projection.events.0.device.actions.length',0);
  addCallback('periodic_start','OnPeriodicReportStart',wrap('OnPeriodicReportStart',{note:'Authored lifecycle body; undocumented report wrapper fields are not asserted.'}));
  addCallback('periodic_complete','OnPeriodicReportComplete',wrap('OnPeriodicReportComplete',{note:'Authored lifecycle body; no original provider subscription was created.'}));
  addCallback('registration_notice','OnRegister',wrap('OnRegister',{note:'Authored lifecycle notice; no live VTN registration is claimed.'}));
  addCallback('error_notice','OnError',{header:{messageType:'OnError',instanceId},onErrorMessage:{schema:'tjl.functional-error.v1',message:'Explicitly authored source-receiving notice, not a provider fault.'}});
  addCallback('heartbeat','OnHeartbeat','');addCheck('steps.heartbeat.http_status',200);
  const requestExample=publicExamples.management_requests.find(x=>x.body.namespace==='ven.cancelOptSchedule');
  addAction('prepare_public_management','prepare_management',{instance_id:instanceId,reviewer,...copy(requestExample.body),source_evidence:[sourceRef('public_examples'),sourceRef('public_452')]});addCheck('steps.prepare_public_management.status','PREPARED');
  const totals=devices.map((device,d)=>{let sum=0,min=Infinity,max=-Infinity;for(let t=0;t<points;t++){const w=watts(d,t);sum+=w;min=Math.min(min,w);max=Math.max(max,w);}const delta=windows.filter(w=>w.device_index===d).reduce((n,w)=>n+w.delta_watts*w.quarters/4,0);return {device_id:device.device_id,original_energy_wh:sum/4,corrected_energy_wh:sum/4+delta,correction_energy_delta_wh:delta,original_minimum_power_w:min,original_maximum_power_w:max,original_measurements:points*3};});
  const summary={schema:'stellar-forge.gridfabric-functional-expectations.v1',classification,recipe_id:recipeId,
    dataset:{device_count:8,days,points_per_device:points,kinds,original_rows:originalRows.length,correction_rows:correctionRows.length,corrected_device_count:4,correction_windows:windows,source_unit_families:['W','kW','Wh','kWh','status'],output_units:{power:'W',energy:'Wh',status:'status'}},
    report_range:{startTimet,endTimet,granularityInSeconds:period,inclusive:true,rows_per_kind:23808,complete_corrected_rows:71424},
    source_lineage:{original_file_sha256:original.sha256,correction_file_sha256:correction.sha256,lineage_file_sha256:lineage.sha256},
    operating_scope:{original_audit_reports:4,original_audit_rows:96,complete_corrected_reports:3,complete_corrected_rows:71424,
      actual_provider_requests:0,management_dispatches:0,device_dispatches:0,public_452_is_execution_receipt:false,installed_runtime_claim:false},
    portfolio_totals:{devices:totals,original_energy_wh:totals.reduce((n,x)=>n+x.original_energy_wh,0),corrected_energy_wh:totals.reduce((n,x)=>n+x.corrected_energy_wh,0)},
    expected_values:windows.map(w=>({key:w.key,device_id:w.device_id,startTimet:w.startTimet,endTimet:w.endTimet,power_delta_watts_each_interval:w.delta_watts,energy_delta_wh_each_interval:w.delta_watts/4,power_rows:8,energy_rows:8,status_rows:8,total_energy_delta_wh:w.delta_watts*2})),
    receiving_notes:['Import and activate use the unchanged native engine and original UUID/CAS journal.','The public status/HTTP/VTN example is retained as original evidence, never inserted as a completed management receipt.','Unknown event wrappers remain UNPROJECTED_SCHEMA until this explicitly authored local binding is selected.','Cancel/archive callbacks create no synthetic end actions.','Only original OnEventComplete queues END actions.','Queued functional device actions are retained without HTTP dispatch.','Successful duplicate callbacks retain their original response; correction comparison uses new explicit build_report operations.']};
  addFile('expectations','expected/functional-expectations.json',summary);
  const input={schema:'stellar-forge.gridfabric-functional-receiving.v1',classification,files:fileList.map(({key,path,name,mime_type,bytes,sha256})=>({key,path,name,mime_type,bytes,sha256})),steps,checks,file_comparisons:comparisons};
  addFile('receiving_input','gridfabric-functional-input.json',input);
  return {files:fileList,summary,input};
}

function nodeHash(content) {
  const data=Buffer.from(content,'utf8');
  return {bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
}
function writeExact(path,content) {
  const data=Buffer.from(content,'utf8');
  fs.mkdirSync(dirname(path),{recursive:true,mode:0o700});
  if(fs.existsSync(path)) {
    if(!fs.lstatSync(path).isFile()||!fs.readFileSync(path).equals(data))throw Error('An existing generated input differs: '+path);
    return;
  }
  const fd=fs.openSync(path,'wx',0o600);
  try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(!fs.readFileSync(path).equals(data))throw Error('Generated input readback differs: '+path);
}
export function materializeFunctionalInputs(outputDirectory) {
  if(!outputDirectory)throw Error('Usage: node generate-functional-input.mjs /absolute/private/output-directory');
  const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
  const sdk=join(root,'stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid');
  const require=createRequire(import.meta.url),model=require(join(sdk,'model.cjs'));
  const publicExamples=JSON.parse(fs.readFileSync(join(sdk,'contracts/management-examples.json'),'utf8'));
  const publicContract=JSON.parse(fs.readFileSync(join(sdk,'contracts/plaid-public-contract.json'),'utf8'));
  const generated=createFunctionalFiles({hash:nodeHash,canonical:model.canonical,publicExamples,publicContract});
  const declared=JSON.parse(fs.readFileSync(new URL('./functional-input-manifest.json',import.meta.url),'utf8'));
  if(declared.files.length!==generated.files.length)throw Error('The published full input manifest count changed.');
  const output=resolve(outputDirectory);
  for(const file of generated.files){
    const expected=declared.files.find(x=>x.key===file.key);
    if(!expected||expected.path!==file.path||expected.bytes!==file.bytes||expected.sha256!==file.sha256)throw Error('The generated complete input differs from its published identity: '+file.key);
    const path=resolve(output,file.path),inside=relative(output,path);
    if(inside.startsWith('..')||isAbsolute(inside)||inside==='')throw Error('An input path leaves its selected output directory.');
    writeExact(path,file.content);
  }
  writeExact(join(output,'functional-input-manifest.json'),JSON.stringify(declared,null,2)+'\n');
  return {schema:generated.input.schema,classification:generated.input.classification,inputFile:join(output,'gridfabric-functional-input.json'),outputDirectory:output,files:generated.files.length,bytes:generated.files.reduce((n,f)=>n+f.bytes,0),source_rows:generated.summary.dataset.original_rows,correction_rows:generated.summary.dataset.correction_rows,steps:generated.input.steps.length,provider_requests:0,product_owner_opened:false};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const result=materializeFunctionalInputs(process.argv[2]);
  process.stdout.write(JSON.stringify(result)+'\n');
}
