'use strict';

const M = require('./model.cjs');
const {assert,fail,clone,object,canonical,text,integer,pointer,assignPointer,
  rational,decimal,add,mul,div,safeWireNumber,sourceRecords,normalizeRow,UNIT,envReferences,httpUrl}=M;
const TABLES=Object.freeze(['instances','instance_editions','sources','source_rows','source_issues','mappings',
  'callbacks','callback_deliveries','events','event_revisions','distributions','opt_decisions','device_actions',
  'reports','report_rows','management_operations','management_receipts','operations']);
const ACTIONS=Object.freeze(['configure_instance','import_source','save_mapping','activate_mapping','record_opt_decision',
  'build_report','reconcile_distribution','prepare_management','begin_management','finish_management',
  'reconcile_management','begin_device_action','finish_device_action','reconcile_device_action','recover_dispatches','project_event_history','resume_event_callback']);
const SCHEMA='stellar-forge.gridfabric-plaid.workspace.v1';
const TERMINAL_DEVICE=new Set(['ACKNOWLEDGED','RECONCILED_COMPLETE','RECONCILED_NOT_APPLIED','SUPERSEDED']);
function createEngine({store,files,sha256Utf8,now,newId,publicContract}) {
  for(const name of ['get','put','scan','count','transaction'])assert(store&&typeof store[name]==='function','INVALID_STORE','Missing synchronous store method '+name+'.');
  assert(files&&typeof files.put==='function'&&typeof files.read==='function','INVALID_FILES','A content-addressed files adapter is required.');
  assert(typeof sha256Utf8==='function'&&typeof now==='function'&&typeof newId==='function','INVALID_RUNTIME','Hash, UTC clock and identity functions are required.');
  assert(publicContract&&Array.isArray(publicContract.callbacks)&&publicContract.management,'INVALID_PUBLIC_CONTRACT','Load the preserved published Plaid contract.');
  const callbackKinds=new Map(publicContract.callbacks.map(x=>[x.messageType,x]));
  const namespaces=new Map(publicContract.management.operations.map(x=>[x.namespace,x]));
  const digest=value=>sha256Utf8(typeof value==='string'?value:canonical(value)).sha256;
  const recordId=(...parts)=>digest(canonical(parts));
  const get=(table,id)=>clone(store.get(table,id));
  const put=(table,id,data,meta={})=>{store.put(table,id,clone(data),{scope:meta.scope||'',sort:meta.sort||data.created_at||data.updated_at||'',tag:meta.tag||data.status||''});return data;};
  function *rows(table,filter={}) {
    let offset=0;
    for(;;) {const page=store.scan(table,{...filter,offset,limit:1000,order:filter.order||'asc'});assert(Array.isArray(page),'INVALID_STORE','scan must return a record array.');
      for(const row of page)yield clone(row);offset+=page.length;if(page.length<1000)return;}
  }
  const collect=(table,filter={})=>Array.from(rows(table,filter)).map(x=>({id:x.id,...x.data}));
  const workspace=()=>{const w=get('meta','workspace');assert(w&&w.schema===SCHEMA,'WORKSPACE_NOT_INITIALIZED','Initialize or restore this application workspace.',{},409);return w;};
  function rawFile(raw,name,mime='application/json') {
    assert(typeof raw==='string','INVALID_FILE','A retained file must contain exact UTF-8 text.');
    const expected=sha256Utf8(raw),saved=files.put(raw,{name,mime_type:mime});
    assert(saved&&saved.sha256===expected.sha256&&saved.bytes===expected.bytes,'FILE_IDENTITY_MISMATCH','The files adapter did not preserve the original bytes.',{name});
    return {sha256:expected.sha256,bytes:expected.bytes,name,mime_type:mime};
  }
  function readFile(hash) {assert(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash),'INVALID_FILE_SHA','Use an exact SHA-256 file identity.');const raw=files.read(hash);assert(typeof raw==='string'&&digest(raw)===hash,'FILE_IDENTITY_MISMATCH','The source file is missing or differs from its identity.',{sha256:hash});return raw;}
  function must(table,id) {text(id,table+' id');const value=get(table,id);assert(value,'RECORD_NOT_FOUND','The requested record is absent.',{collection:table,id},404);return value;}
  function initialize({name}={}) {
    return store.transaction(()=>{const existing=get('meta','workspace');if(existing){assert(existing.schema===SCHEMA,'UNSUPPORTED_WORKSPACE','The restored workspace schema is incompatible.');return state();}
      const w={schema:SCHEMA,workspace_id:newId(),name:name||'GridFabric operations',revision:0,created_at:now(),updated_at:now()};
      put('meta','workspace',w);return state();});
  }
  function state() {const w=workspace();return {...w,collections:Object.fromEntries(TABLES.map(table=>[table,store.count(table,{})]))};}
  function page(collection,filter={}) {
    assert(TABLES.includes(collection),'UNKNOWN_COLLECTION','The collection is not exposed by this application.');
    const offset=filter.offset===undefined?0:integer(filter.offset,'offset'),limit=filter.limit===undefined?100:integer(filter.limit,'limit',1);
    assert(limit<=1000,'PAGE_LIMIT','A page may contain up to1000 records.');
    const selected={};for(const key of ['scope','tag','gte','lt'])if(filter[key]!==undefined)selected[key]=text(filter[key],key);
    const order=filter.order||'asc';assert(['asc','desc'].includes(order),'INVALID_ORDER','order must be asc or desc.');
    const total=store.count(collection,selected),result=store.scan(collection,{...selected,offset,limit,order});
    return {collection,total,offset,limit,next_offset:offset+result.length<total?offset+result.length:null,
      rows:result.map(row=>({id:row.id,...clone(row.data)}))};
  }
  function detail(collection,id) {assert(TABLES.includes(collection),'UNKNOWN_COLLECTION','The collection is not exposed by this application.');return {collection,id,record:must(collection,id)};}
  function sourceEvidence(ids,required=false) {
    assert(Array.isArray(ids)&&(!required||ids.length>0),'INVALID_EVIDENCE','Provide an array of retained source IDs.');
    return ids.map(id=>{const s=must('sources',id);return {source_id:id,file_sha256:s.file.sha256};});
  }
  function validateBindings(bindings) {
    if(bindings===undefined)return {};
    assert(object(bindings),'INVALID_BINDINGS','bindings must map documented callback kinds to reviewed JSON pointers.');
    const result={};
    for(const [kind,b] of Object.entries(bindings)) {
      assert(callbackKinds.has(kind)&&object(b),'INVALID_BINDING','A binding must name a documented callback kind.',{kind});
      must('sources',text(b.evidence_source_id,'binding.evidence_source_id'));text(b.reviewer,'binding.reviewer');
      for(const key of ['events_pointer','event_pointer','event_id_pointer','revision_pointer','targets_pointer','interval_id_pointer','signal_pointer','interval_start_pointer','distribution_id_pointer','distribution_complete_pointer','opt_type_pointer']) {
        if(b[key]!==undefined)assert(typeof b[key]==='string'&&(b[key]===''||b[key].startsWith('/')),'INVALID_POINTER','A configured binding is not a JSON pointer.',{kind,key});
      }
      assert(!(b.events_pointer!==undefined&&b.event_pointer!==undefined),'INVALID_BINDING','Select either a single event or an event array.',{kind});
      if(b.response_template!==undefined){assert(object(b.response_template),'INVALID_RESPONSE_TEMPLATE','A callback response template must be an original JSON object.');if(b.opt_type_pointer!==undefined)pointer(b.response_template,b.opt_type_pointer,true);}
      if(b.target_bindings!==undefined){
        assert(Array.isArray(b.target_bindings),'INVALID_TARGET_BINDINGS','target_bindings must be an explicit array.');
        for(const target of b.target_bindings){assert(object(target),'INVALID_TARGET_BINDING','A target binding must be an object.');text(target.pointer,'target pointer');assert(['venId','resourceId','groupId','partyId'].includes(target.category),'INVALID_TARGET_CATEGORY','Use a documented semantic target category.');}
      }
      result[kind]=clone(b);
    }
    return result;
  }
  function configureInstance(input) {
    const id=text(input.instance_id,'instance_id'),old=get('instances',id);
    const result={instance_id:id,name:text(input.name,'name'),management_url:httpUrl(input.management_url,'management_url'),
      management_headers_env:envReferences(input.management_headers_env,'management_headers_env'),
      callback_headers_env:envReferences(input.callback_headers_env,'callback_headers_env'),
      callback_basic_user_env:null,callback_basic_password_env:null,
      device_adapter_url:input.device_adapter_url?httpUrl(input.device_adapter_url,'device_adapter_url'):null,
      device_adapter_headers_env:envReferences(input.device_adapter_headers_env,'device_adapter_headers_env'),
      plugin_api_version:input.plugin_api_version||null,plugin_version:input.plugin_version||null,
      schema_source_id:input.schema_source_id||null,bindings:validateBindings(input.bindings),
      devices:clone(input.devices||[]),active_mapping_id:old?old.active_mapping_id:null,
      created_at:old?old.created_at:now(),updated_at:now(),status:'CONFIGURED',
      last_callback_at:old?old.last_callback_at:null,last_header:old?old.last_header:null,configuration_revision:old?old.configuration_revision+1:1};
    for(const key of ['callback_basic_user_env','callback_basic_password_env'])if(input[key]!==undefined&&input[key]!==null){assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(input[key]),'INVALID_ENV_REFERENCE','Callback basic credentials must be environment variable names.');result[key]=input[key];}
    assert(Boolean(result.callback_basic_user_env)===Boolean(result.callback_basic_password_env),'INCOMPLETE_CALLBACK_AUTH','Configure both HTTP basic credential references.');
    if(result.schema_source_id)must('sources',result.schema_source_id);
    assert(Array.isArray(result.devices),'INVALID_DEVICES','devices must be an array of explicit physical adapter mappings.');
    if(result.devices.length)assert(result.device_adapter_url,'DEVICE_ADAPTER_NOT_CONFIGURED','An instance with device mappings requires its configured adapter endpoint.');
    const seen=new Set();
    for(const device of result.devices){
      text(device.device_id,'device_id');assert(!seen.has(device.device_id),'DUPLICATE_DEVICE','Device IDs must be unique within an instance.');seen.add(device.device_id);
      assert(device.target_ids===undefined||object(device.target_ids),'INVALID_DEVICE_TARGETS','target_ids maps semantic categories to arrays of exact provider identifiers.');
      for(const [category,ids] of Object.entries(device.target_ids||{})){assert(['venId','resourceId','groupId','partyId'].includes(category)&&Array.isArray(ids)&&ids.every(x=>typeof x==='string'),'INVALID_DEVICE_TARGETS','Invalid explicit target mapping.');}
      if(device.adapter_id!==undefined)text(device.adapter_id,'adapter_id');
    }
    const edition_id=newId();put('instance_editions',edition_id,{...result,edition_id},{scope:id,sort:String(result.configuration_revision).padStart(12,'0')});
    result.edition_id=edition_id;put('instances',id,result);return {instance_id:id,edition_id,configuration_revision:result.configuration_revision};
  }
  function importSource(input) {
    const raw=readFile(input.file_sha256),format=input.format;
    assert(['csv','json','original'].includes(format),'INVALID_SOURCE_FORMAT','Source format must be csv, json or original.');
    const name=text(input.name,'source name'),id=newId(),created_at=now();
    assert(object(input.provenance),'INVALID_SOURCE_PROVENANCE','Retain an explicit provenance object with each original source.');
    if(input.corrects_source_id)must('sources',input.corrects_source_id);
    const source={source_id:id,name,format,file:{sha256:input.file_sha256,bytes:sha256Utf8(raw).bytes,name,mime_type:format==='csv'?'text/csv':format==='json'?'application/json':'text/plain'},
      profile:format==='original'?null:clone(input.profile),provenance:clone(input.provenance),corrects_source_id:input.corrects_source_id||null,
      created_at,status:format==='original'?'ORIGINAL':'IMPORTING',row_count:0,valid_rows:0,issue_count:0,device_channels:[]};
    put('sources',id,source);if(format==='original')return {source_id:id,status:source.status,row_count:0,issue_count:0,file:source.file};
    assert(object(input.profile)&&object(input.profile.fields)&&object(input.profile.constants),'INVALID_SOURCE_PROFILE','A parsed source requires explicit fields and constants.');
    const unique=new Map(),channels=new Map(),invalidRows=new Set();
    function issue(record,error){const issue_id=newId();source.issue_count++;if(record&&record.index)invalidRows.add(record.index);
      put('source_issues',issue_id,{issue_id,source_id:id,record_number:record?record.index:null,line:record?record.line:null,code:error.code||'SOURCE_ERROR',message:error.message,details:clone(error.details||{}),created_at},{scope:id,sort:String(record&&record.index||0).padStart(16,'0'),tag:error.code||'SOURCE_ERROR'});}
    try {
      for(const record of sourceRecords(raw,format,input.profile)) {
        source.row_count++;
        if(record.error){issue(record,record.error);continue;}
        try {
          const row=normalizeRow(record,format,input.profile),row_id=id+':'+String(record.index).padStart(12,'0');
          const signature=canonical([row.device_id,row.channel,row.start_us,row.end_us]),prior=unique.get(signature);
          const data={source_row_id:row_id,source_id:id,...row,measurement_status:clone(row.status),created_at,status:'VALID'};
          const scope=id+'\u0000'+row.device_id+'\u0000'+row.channel,sort=String(row.start_us).padStart(16,'0');
          if(prior) {
            data.status='DUPLICATE';issue(record,{code:'DUPLICATE_INTERVAL',message:'Two original source rows describe the same device, channel and interval.',details:{prior_row_id:prior.row_id}});
            const p=must('source_rows',prior.row_id);if(p.status==='VALID'){p.status='DUPLICATE';put('source_rows',prior.row_id,p,{scope,sort,tag:'DUPLICATE'});source.valid_rows--;issue({index:p.original_record,line:p.original_line},{code:'DUPLICATE_INTERVAL',message:'Another original source row repeats this interval.',details:{other_row_id:row_id}});}
          } else {unique.set(signature,{row_id});source.valid_rows++;}
          put('source_rows',row_id,data,{scope,sort,tag:data.status==='VALID'?row.kind:data.status});
          const key=canonical([row.device_id,row.channel,row.kind,row.unit]);
          const group=channels.get(key)||{device_id:row.device_id,channel:row.channel,kind:row.kind,unit:row.unit,rows:0,start_us:row.start_us,end_us:row.end_us};
          group.rows++;group.start_us=Math.min(group.start_us,row.start_us);group.end_us=Math.max(group.end_us,row.end_us);channels.set(key,group);
        } catch(e) {if(!(e instanceof M.DomainError))throw e;issue(record,e);}
      }
    } catch(e) {if(!(e instanceof M.DomainError))throw e;issue(null,e);}
    source.device_channels=Array.from(channels.values());source.status=source.issue_count?'NEEDS_CORRECTION':source.row_count?'READY':'EMPTY';
    source.invalid_rows=invalidRows.size;put('sources',id,source);
    return {source_id:id,status:source.status,row_count:source.row_count,valid_rows:source.valid_rows,issue_count:source.issue_count,device_channels:source.device_channels,file:source.file};
  }
  function saveMapping(input) {
    const instance=must('instances',input.instance_id);text(input.name,'mapping name');text(input.reviewer,'reviewer');
    assert(Array.isArray(input.entries)&&input.entries.length>0,'EMPTY_MAPPING','A reporting mapping requires entries.');
    const entries=[],seen=new Set();
    for(const entry of input.entries) {
      const e=clone(entry);text(e.r_id,'r_id');text(e.report_specifier_id,'report_specifier_id');text(e.device_id,'device_id');text(e.channel,'channel');
      assert(!seen.has(e.r_id),'DUPLICATE_RID','Each rId must have a single explicit source mapping.');seen.add(e.r_id);
      assert(UNIT[e.unit]&&UNIT[e.unit].kind===e.kind,'INVALID_UNIT','The output unit must match the requested measurement kind.');
      assert(['start','end','instant'].includes(e.time_basis),'INVALID_TIME_BASIS','Declare start, end or instant time labels.');
      integer(e.period_seconds,'period_seconds',1);integer(e.decimal_places,'decimal_places');assert(e.decimal_places<=12,'INVALID_PRECISION','At most twelve decimal places are supported.');
      const allowed=e.kind==='energy'?['energy_sum']:e.kind==='power'?['power_average','sample']:['status'];
      assert(allowed.includes(e.aggregation),'INVALID_AGGREGATION','The aggregation is incompatible with the source kind.');
      assert(typeof e.allow_resample==='boolean','INVALID_RESAMPLING','Declare allow_resample explicitly.');
      if(e.aggregation==='sample'||e.aggregation==='status')assert(e.time_basis==='instant','INVALID_TIME_BASIS','Sample and status reports require instant time labels.');
      else assert(e.time_basis!=='instant','INVALID_TIME_BASIS','Aggregated intervals require start or end time labels.');
      if(e.allow_resample)text(e.resampled_data_quality,'resampled_data_quality');
      if(e.default_data_quality!==undefined)text(e.default_data_quality,'default_data_quality');
      assert(Array.isArray(e.source_ids)&&e.source_ids.length&&new Set(e.source_ids).size===e.source_ids.length,'INVALID_MAPPING_SOURCES','List original source IDs once, in highest-precedence-first order.');
      for(const source_id of e.source_ids)must('sources',source_id);
      entries.push(e);
    }
    const evidence=sourceEvidence(input.source_evidence||[],false),response=clone(input.registration_response);
    assert(object(response)&&object(response.onRegisterReportsResponseMessage)&&Array.isArray(response.onRegisterReportsResponseMessage.telemetryReports),'INVALID_REGISTRATION_RESPONSE','Provide the complete reviewed onRegisterReportsResponseMessage.telemetryReports response.');
    const registered=new Map();
    for(const report of response.onRegisterReportsResponseMessage.telemetryReports){
      text(report.reportSpecifierId,'reportSpecifierId');assert(Array.isArray(report.intervalDescriptions),'INVALID_REGISTRATION_RESPONSE','Each report requires intervalDescriptions.');
      for(const interval of report.intervalDescriptions){text(interval.rid,'registration rid');assert(!registered.has(interval.rid),'DUPLICATE_REGISTRATION_RID','A registered rid appears more than once.');registered.set(interval.rid,{report,interval});}
    }
    assert(registered.size===entries.length,'REGISTRATION_MAPPING_MISMATCH','Every registered rid must have exactly one source mapping.');
    for(const e of entries){const r=registered.get(e.r_id);assert(r&&r.report.reportSpecifierId===e.report_specifier_id,'REGISTRATION_MAPPING_MISMATCH','The source mapping differs from the reviewed registration response.',{r_id:e.r_id});
      if(e.kind==='status')assert(r.interval.usageIntervalProperties===undefined,'INVALID_STATUS_REGISTRATION','A telemetry status registration omits usageIntervalProperties.');
      const u=r.interval.usageIntervalProperties&&r.interval.usageIntervalProperties.units;
      if(u&&u.units!==undefined)assert(u.units===e.unit,'REGISTRATION_UNIT_MISMATCH','The registered unit differs from the mapped output unit.',{r_id:e.r_id});}
    const mapping_id=newId(),created_at=now(),mapping={mapping_id,instance_id:instance.instance_id,name:input.name,reviewer:input.reviewer,
      entries,registration_response:response,registration_response_file:rawFile(canonical(response),'Plaid_Report_Registration_'+mapping_id+'.json'),source_evidence:evidence,status:'DRAFT',created_at,activated_at:null};
    put('mappings',mapping_id,mapping,{scope:instance.instance_id});return {mapping_id,status:'DRAFT',entry_count:entries.length};
  }
  function activateMapping(input) {
    const mapping=must('mappings',input.mapping_id),instance=must('instances',mapping.instance_id);text(input.reviewer,'reviewer');
    for(const e of mapping.entries)for(const source_id of e.source_ids){const s=must('sources',source_id);assert(s.status==='READY','SOURCE_NOT_READY','Resolve original source issues before using this mapping.',{source_id,status:s.status},409);
      assert(s.device_channels.some(c=>c.device_id===e.device_id&&c.channel===e.channel&&c.kind===e.kind),'MAPPING_SOURCE_MISMATCH','The source does not contain the declared device, channel and kind.',{source_id,r_id:e.r_id});}
    if(instance.active_mapping_id&&instance.active_mapping_id!==mapping.mapping_id){const old=must('mappings',instance.active_mapping_id);old.status='SUPERSEDED';put('mappings',old.mapping_id,old,{scope:instance.instance_id});}
    mapping.status='ACTIVE';mapping.activated_at=now();mapping.activation_reviewer=input.reviewer;put('mappings',mapping.mapping_id,mapping,{scope:instance.instance_id});
    instance.active_mapping_id=mapping.mapping_id;instance.updated_at=now();put('instances',instance.instance_id,instance);return {mapping_id:mapping.mapping_id,status:'ACTIVE',instance_id:instance.instance_id};
  }
  function queryShape(query) {
    assert(object(query),'INVALID_QUERY','Provide the original report query object.');
    integer(query.startTimet,'startTimet');integer(query.endTimet,'endTimet');integer(query.granularityInSeconds,'granularityInSeconds');
    assert(query.endTimet>=query.startTimet,'INVALID_QUERY_RANGE','endTimet precedes startTimet.');
    assert(query.endTimet<=Math.floor(Number.MAX_SAFE_INTEGER/1000000),'INVALID_QUERY_RANGE','The query exceeds exact microsecond arithmetic.');
    assert(Array.isArray(query.rIds)&&query.rIds.length>0&&query.rIds.every(x=>typeof x==='string'&&x.length)&&new Set(query.rIds).size===query.rIds.length,'INVALID_QUERY_RIDS','The query requires unique original rIds.');
    if(query.reportSpecifierId!==undefined)text(query.reportSpecifierId,'reportSpecifierId');
    return clone(query);
  }
  function prepareCandidateIndex(entry,query) {
    const instant=entry.aggregation==='sample'||entry.aggregation==='status',period=query.granularityInSeconds||entry.period_seconds;
    const low=query.startTimet*1000000-(instant||entry.time_basis==='start'?0:period*1000000);
    const high=query.endTimet*1000000+(instant||entry.time_basis==='end'?0:period*1000000),items=[];
    for(let priority=0;priority<entry.source_ids.length;priority++){
      const source_id=entry.source_ids[priority],source=must('sources',source_id);
      assert(source.status==='READY','SOURCE_NOT_READY','The mapped source is no longer ready.',{source_id},409);
      const scope=source_id+'\u0000'+entry.device_id+'\u0000'+entry.channel;
      for(const row of rows('source_rows',{scope,tag:entry.kind,lt:String(high+1).padStart(16,'0')})){
        const r=row.data;if(instant?!(r.start_us>=low&&r.start_us<=high):!(r.end_us>low&&r.start_us<high))continue;
        items.push({source_id:r.source_id,source_row_id:r.source_row_id,start_us:r.start_us,end_us:r.end_us,
          kind:r.kind,unit:r.unit,value_decimal:r.value_decimal,status:r.status,value_semantics:r.value_semantics,
          data_quality:r.data_quality,priority,measurement_status:clone(r.measurement_status)});
      }
    }
    items.sort((a,b)=>a.start_us-b.start_us||a.priority-b.priority);
    const maximum=[];let last=-1;for(const item of items){last=Math.max(last,item.end_us);maximum.push(last);}
    function lower(value){let lo=0,hi=items.length;while(lo<hi){const mid=(lo+hi)>>1;if(items[mid].start_us<value)lo=mid+1;else hi=mid;}return lo;}
    return (start,end)=>{
      if(instant){const result=[];for(let i=lower(start);i<items.length&&items[i].start_us===start;i++)result.push(items[i]);return result;}
      const result=[];for(let i=lower(end)-1;i>=0&&maximum[i]>start;i--)if(items[i].end_us>start)result.push(items[i]);
      return result;
    };
  }
  function measurement(entry,timestamp,period,lookup) {
    const at=timestamp*1000000;
    if(entry.aggregation==='sample'||entry.aggregation==='status') {
      const candidates=lookup(at,at),priority=candidates.length?Math.min(...candidates.map(r=>r.priority)):null;
      const selected=candidates.filter(r=>r.priority===priority);
      assert(selected.length===1,'MISSING_OR_AMBIGUOUS_SAMPLE','An exact timestamp requires one original measurement at the selected source precedence.',{r_id:entry.r_id,dtStartTimet:timestamp,source_rows:selected.map(r=>r.source_row_id)});
      const row=selected[0];
      if(entry.aggregation==='sample')assert(row.value_semantics==='instantaneous_power','SOURCE_SEMANTICS_MISMATCH','An instantaneous report cannot reinterpret an interval average as a point measurement.');
      const quality=row.data_quality||entry.default_data_quality;assert(quality,'MISSING_DATA_QUALITY','Declare data quality from the source or the reviewed mapping.',{r_id:entry.r_id});
      const wire={dataQuality:quality,dtStartTimet:timestamp,rId:entry.r_id};
      let calculation={method:entry.aggregation,source_rows:[{source_id:row.source_id,source_row_id:row.source_row_id}],time_basis:'instant',output_unit:entry.unit};
      if(entry.kind==='status')wire.status=clone(row.measurement_status);
      else {const exact=mul(decimal(row.value_decimal),rational(BigInt(UNIT[row.unit].scale),BigInt(UNIT[entry.unit].scale)));const number=safeWireNumber(exact,entry.decimal_places);wire.value=number.value;calculation={...calculation,...number};}
      return {wire,calculation};
    }
    const length=period*1000000,start=entry.time_basis==='start'?at:at-length,end=start+length;
    assert(start>=0&&Number.isSafeInteger(end),'INVALID_REPORT_INTERVAL','The mapped reporting interval is outside the timestamp range.');
    const candidates=lookup(start,end),points=new Set([start,end]);
    for(const row of candidates){points.add(Math.max(start,row.start_us));points.add(Math.min(end,row.end_us));}
    const edges=Array.from(points).sort((a,b)=>a-b),segments=[],used=new Map(),qualities=new Set(),selectedSegments=[];
    let exact=rational(0n),resampled=false;
    for(let i=0;i<edges.length-1;i++){
      const left=edges[i],right=edges[i+1];if(right===left)continue;
      const covering=candidates.filter(r=>r.start_us<=left&&r.end_us>=right);
      assert(covering.length,'MISSING_SOURCE_INTERVAL','The requested interval has a gap in original measurements.',{r_id:entry.r_id,start_us:left,end_us:right});
      const priority=Math.min(...covering.map(r=>r.priority)),selected=covering.filter(r=>r.priority===priority);
      assert(selected.length===1,'OVERLAPPING_SOURCE_INTERVALS','The selected source has overlapping measurements.',{r_id:entry.r_id,start_us:left,end_us:right,source_rows:selected.map(r=>r.source_row_id)});
      const row=selected[0],previous=selectedSegments[selectedSegments.length-1];
      if(previous&&previous.row.source_row_id===row.source_row_id&&previous.end===left)previous.end=right;
      else selectedSegments.push({start:left,end:right,row});
    }
    for(const segment of selectedSegments){
      const {start:left,end:right,row}=segment,partial=left!==row.start_us||right!==row.end_us;
      assert(!partial||entry.allow_resample,'RESAMPLING_REQUIRES_REVIEW','The requested interval cuts an original measurement; explicitly review resampling and its quality first.',{r_id:entry.r_id,source_row_id:row.source_row_id});
      resampled=resampled||partial;
      const quality=row.data_quality||entry.default_data_quality;assert(quality,'MISSING_DATA_QUALITY','Declare data quality from the source or the reviewed mapping.',{r_id:entry.r_id});qualities.add(quality);
      let contribution=mul(decimal(row.value_decimal),rational(BigInt(UNIT[row.unit].scale),BigInt(UNIT[entry.unit].scale)));
      if(entry.aggregation==='energy_sum'){assert(row.value_semantics==='interval_energy','SOURCE_SEMANTICS_MISMATCH','Energy aggregation requires original interval energy.');contribution=mul(contribution,rational(BigInt(right-left),BigInt(row.end_us-row.start_us)));}
      else {assert(row.value_semantics==='interval_average_power','SOURCE_SEMANTICS_MISMATCH','Time-weighted power requires original interval average power.');contribution=mul(contribution,rational(BigInt(right-left),BigInt(length)));}
      exact=add(exact,contribution);used.set(row.source_row_id,{source_id:row.source_id,source_row_id:row.source_row_id,unit:row.unit,original_value_decimal:row.value_decimal});
      segments.push({start_us:left,end_us:right,source_row_id:row.source_row_id,numerator:contribution.n.toString(),denominator:contribution.d.toString()});
    }
    assert(qualities.size===1||entry.resampled_data_quality,'MIXED_DATA_QUALITY','An aggregation of different source qualities needs a reviewed output quality.');
    const number=safeWireNumber(exact,entry.decimal_places),quality=(resampled||qualities.size>1)?entry.resampled_data_quality:Array.from(qualities)[0];
    assert(quality,'MISSING_DATA_QUALITY','The aggregation has no declared output quality.');
    return {wire:{dataQuality:quality,dtStartTimet:timestamp,rId:entry.r_id,value:number.value},
      calculation:{method:entry.aggregation,...number,time_basis:entry.time_basis,start_us:start,end_us:end,period_seconds:period,output_unit:entry.unit,resampled,
        source_rows:Array.from(used.values()),segments,source_data_qualities:Array.from(qualities)}};
  }
  function buildReport(input,callback_id=null) {
    const instance=must('instances',input.instance_id),query=queryShape(input.query);
    assert(instance.active_mapping_id,'NO_ACTIVE_MAPPING','Activate a reviewed source mapping before answering a report callback.',{},409);
    const mapping=must('mappings',instance.active_mapping_id),selected=query.rIds.map(r_id=>{
      const e=mapping.entries.find(x=>x.r_id===r_id&&(query.reportSpecifierId===undefined||x.report_specifier_id===query.reportSpecifierId));
      assert(e,'UNKNOWN_RID','The requested rId/specifier has no active source mapping.',{r_id,reportSpecifierId:query.reportSpecifierId||null});return e;});
    const report_id=newId(),created_at=now(),report={report_id,instance_id:instance.instance_id,mapping_id:mapping.mapping_id,callback_id,
      query,query_file:rawFile(canonical(query),'Plaid_Report_Query_'+report_id+'.json'),created_at,status:'BUILDING',row_count:0,issue_count:0,response_file:null,issues:[]};
    put('reports',report_id,report,{scope:instance.instance_id});
    const intervals=[],groups=new Map(),step=query.granularityInSeconds,indexes=new Map(selected.map(entry=>[entry.r_id,prepareCandidateIndex(entry,query)]));
    for(let timestamp=query.startTimet;timestamp<=query.endTimet;timestamp+=step) {
      for(const entry of selected) {
        const report_row_id=report_id+':'+String(report.row_count+1).padStart(12,'0');report.row_count++;
        let record;
        try {const measured=measurement(entry,timestamp,step||entry.period_seconds,indexes.get(entry.r_id));
          record={report_row_id,report_id,r_id:entry.r_id,report_specifier_id:entry.report_specifier_id,dtStartTimet:timestamp,status:'READY',...measured,created_at};intervals.push(measured.wire);if(!groups.has(entry.report_specifier_id))groups.set(entry.report_specifier_id,[]);groups.get(entry.report_specifier_id).push(measured.wire);}
        catch(e){if(!(e instanceof M.DomainError))throw e;const issue={code:e.code,message:e.message,details:clone(e.details),r_id:entry.r_id,dtStartTimet:timestamp};
          report.issue_count++;if(report.issues.length<100)report.issues.push(issue);
          record={report_row_id,report_id,r_id:entry.r_id,report_specifier_id:entry.report_specifier_id,dtStartTimet:timestamp,status:'NEEDS_SOURCE',issue,created_at};}
        put('report_rows',report_row_id,record,{scope:report_id,sort:String(timestamp).padStart(16,'0')+'\u0000'+entry.r_id,tag:record.status});
      }
      if(step===0||timestamp+step>query.endTimet)break;
    }
    report.status=report.issue_count?'NEEDS_SOURCE':'READY';
    if(report.status==='READY'){const reports=Array.from(groups,([specifier,reportIntervals])=>({...((groups.size>1)?{reportIdentifier:{reportSpecifierId:specifier}}:{}),reportIntervals}));report.response_file=rawFile(canonical({onQueryIntervalsResponseMessage:{reports}}),'Plaid_Report_Response_'+report_id+'.json');}
    put('reports',report_id,report,{scope:instance.instance_id});
    if(report.status==='READY')put('meta','report-cache:'+recordId(instance.instance_id,mapping.mapping_id,query),{report_id,mapping_id:mapping.mapping_id,response_file:report.response_file,created_at:now()});
    return {report_id,status:report.status,row_count:report.row_count,issue_count:report.issue_count,response_file:report.response_file,issues:report.issues};
  }

  function selectedDevices(instance,targets,binding) {
    if(targets===undefined||targets===null||(Array.isArray(targets)&&targets.length===0)||(object(targets)&&Object.keys(targets).length===0))return instance.devices;
    assert(Array.isArray(binding.target_bindings)&&binding.target_bindings.length,'UNBOUND_EVENT_TARGETS','Bind the original vendor target object before queuing device actions.');
    assert(['any','all'].includes(binding.target_match),'UNREVIEWED_TARGET_MATCH','Declare the reviewed any/all combination of target categories.');
    const groups=[];
    for(const b of binding.target_bindings) {
      const value=pointer(targets,b.pointer,false);if(value===undefined||value===null)continue;
      const ids=Array.isArray(value)?value:[value];
      assert(ids.every(x=>typeof x==='string'),'INVALID_EVENT_TARGETS','A bound target selector must contain provider identifier strings.');
      if(ids.length)groups.push({category:b.category,ids});
    }
    assert(groups.length,'UNPROJECTED_EVENT_TARGETS','The bound target object contains no recognized identifiers.');
    return instance.devices.filter(d=>{
      const matches=groups.map(g=>g.ids.some(id=>(d.target_ids&&d.target_ids[g.category]||[]).includes(id)));
      return binding.target_match==='all'?matches.every(Boolean):matches.some(Boolean);
    });
  }
  function eventKey(instance_id,event_id) {return recordId('event',instance_id,event_id);}
  function optFor(instance_id,event_id,resource_ids=[]) {
    const list=collect('opt_decisions',{scope:eventKey(instance_id,event_id)}).filter(d=>d.resource_id===''||resource_ids.includes(d.resource_id));
    list.sort((a,b)=>(b.decision_revision||0)-(a.decision_revision||0)||(a.created_at<b.created_at?1:a.created_at>b.created_at?-1:0));
    return list.length?list[0]:null;
  }
  function recordOpt(input) {
    const instance=must('instances',input.instance_id);text(input.event_id,'event_id');text(input.reviewer,'reviewer');
    assert(input.resource_id===undefined||typeof input.resource_id==='string','INVALID_RESOURCE_ID','resource_id must be an exact string or omitted for the whole event.');
    assert(publicContract.management.opt_types.includes(input.opt_type),'INVALID_OPT_TYPE','Use optIn or optOut.');
    text(input.opt_reason,'opt_reason');const evidence=sourceEvidence(input.source_evidence||[],true),id=newId();
    const event=get('events',eventKey(instance.instance_id,input.event_id));
    const record={opt_decision_id:id,instance_id:instance.instance_id,event_id:input.event_id,event_revision:event?event.current_revision:null,
      opt_type:input.opt_type,opt_reason:input.opt_reason,resource_id:input.resource_id||'',reviewer:input.reviewer,source_evidence:evidence,decision_revision:workspace().revision+1,created_at:now(),status:'REVIEWED'};
    put('opt_decisions',id,record,{scope:eventKey(instance.instance_id,input.event_id),sort:record.created_at+'\u0000'+id});
    return {opt_decision_id:id,event_id:input.event_id,opt_type:input.opt_type,status:'REVIEWED'};
  }
  function queueDevice(instance,event,kind,raw,callback_id,binding,eventDocument) {
    const effective=kind==='END'?null:(binding.interval_start_pointer===undefined?undefined:pointer(raw,binding.interval_start_pointer,false));
    const intervalId=kind==='END'?'complete':binding.interval_id_pointer===undefined?undefined:pointer(raw,binding.interval_id_pointer,false);
    if(kind!=='END'){assert(intervalId!==undefined||effective!==undefined,'UNBOUND_INTERVAL_ID','Bind the original interval identity or effective start before queuing device actions.');if(effective!==undefined)integer(effective,'effective interval start');}
    const signal=kind==='END'?null:binding.signal_pointer===undefined?undefined:pointer(raw,binding.signal_pointer,false);
    if(kind!=='END')assert(signal!==undefined,'UNBOUND_EVENT_SIGNAL','Bind and preserve the original signal payload before queuing a device action.');
    const targets=binding.targets_pointer===undefined?undefined:pointer(eventDocument,binding.targets_pointer,false);
    const devices=selectedDevices(instance,targets,binding),actions=[],needs_decision=[],opted_out=[];
    for(const device of devices) {
      const resource_ids=device.target_ids&&device.target_ids.resourceId||[],decision=optFor(instance.instance_id,event.event_id,resource_ids);
      if(kind!=='END'&&decision&&decision.opt_type==='optOut'){opted_out.push({device_id:device.device_id,opt_decision_id:decision.opt_decision_id});continue;}
      if(kind!=='END'&&(!decision||decision.opt_type!=='optIn')){needs_decision.push(device.device_id);continue;}
      const id=recordId('device',instance.instance_id,event.event_id,event.current_revision===null?{revision:null,definition:event.definition_sha256||null,signal_sha256:digest(signal===undefined?null:signal)}:event.current_revision,kind,intervalId===undefined?null:intervalId,effective===undefined?null:effective,device.device_id);
      const existing=get('device_actions',id);if(existing){assert(canonical(existing.signal)===canonical(signal===undefined?null:signal),'CONFLICTING_INTERVAL_SIGNAL','The same event edition and interval identity contain conflicting original signal payloads.',{device_action_id:id},409);actions.push(id);continue;}
      const request={schema:'stellar-forge.plaid-device-action.v1',device_action_id:id,instance_id:instance.instance_id,event_id:event.event_id,
        event_revision:event.current_revision,device_id:device.device_id,adapter_id:device.adapter_id||device.device_id,device_resource_ids:clone(resource_ids),
        action_kind:kind,interval_id:intervalId===undefined?null:clone(intervalId),effective_start_timet:effective===undefined?null:effective,
        signal:clone(signal===undefined?null:signal),targets:clone(targets===undefined?null:targets),callback_id,opt_decision_id:decision?decision.opt_decision_id:null};
      const body=canonical(request),created_at=now();
      put('device_actions',id,{...request,status:'QUEUED',endpoint:instance.device_adapter_url,
        header_env:clone(instance.device_adapter_headers_env),instance_edition_id:instance.edition_id,
        request_file:rawFile(body,'Device_Action_'+id+'.json'),created_at,updated_at:created_at,attempt_id:null,receipt:null,reconciliation:null},
        {scope:eventKey(instance.instance_id,event.event_id)});
      actions.push(id);
    }
    return {actions,needs_decision,opted_out,status:needs_decision.length?'NEEDS_REVIEW':actions.length?'ACTIONS_QUEUED':opted_out.length?'OPTED_OUT':'NO_CONFIGURED_DEVICES'};
  }
  function eventProjection(instance,kind,payload,callback,binding,{queue_devices=true,preserve_distributions=false}={}) {
    const selected=binding.events_pointer!==undefined?pointer(payload,binding.events_pointer,true):[pointer(payload,binding.event_pointer===undefined?'':binding.event_pointer,true)];
    assert(Array.isArray(selected),'INVALID_BOUND_EVENTS','The reviewed events pointer must select an array.');
    const projected=[],issues=[];
    for(const document of selected) {
      assert(object(document),'INVALID_BOUND_EVENT','A selected original event must be an object.');
      const event_id=text(pointer(document,binding.event_id_pointer,true),'bound event_id');
      const revisionValue=binding.revision_pointer===undefined?undefined:pointer(document,binding.revision_pointer,false);
      const revision=revisionValue===undefined||revisionValue===null?null:integer(revisionValue,'event_modification_number');
      const key=eventKey(instance.instance_id,event_id),old=get('events',key),edition_id=newId(),created_at=now();
      // A revision denotes the external edition. Callback kind is a separate lifecycle transition.
      // Only event/distribution content establishes the edition identity; later lifecycle payloads can differ.
      const definition=['OnEvent','OnDistributeEventStart'].includes(kind),document_hash=digest(document);
      let state='CURRENT';
      if(old&&old.current_revision!==null&&revision!==null&&revision<old.current_revision)state='STALE';
      if(old&&old.current_revision!==null&&revision===null)state='REVISION_UNKNOWN';
      if(old&&definition&&revision===old.current_revision&&old.definition_by_kind&&old.definition_by_kind[kind]&&old.definition_by_kind[kind]!==document_hash)state='CONFLICT';
      const edition={event_revision_id:edition_id,event_key:key,instance_id:instance.instance_id,event_id,revision,callback_id:callback.callback_id,kind,
        document_sha256:document_hash,document:clone(document),created_at,status:state};
      put('event_revisions',edition_id,edition,{scope:key});
      if(state!=='CURRENT'){projected.push({event_id,revision,status:state,event_revision_id:edition_id});if(state!=='STALE')issues.push({event_id,code:'EVENT_'+state,message:'The retained event edition cannot replace the current projection without resolving its original revision information.'});continue;}
      const event={...(old||{}),event_key:key,instance_id:instance.instance_id,event_id,current_revision:revision,
        current_edition_id:edition_id,created_at:old?old.created_at:created_at,updated_at:created_at,last_callback_id:callback.callback_id,last_callback_kind:kind,
        definition_sha256:definition?document_hash:old?old.definition_sha256||null:null,
        definition_by_kind:{...(old&&old.current_revision===revision?old.definition_by_kind||{}:{}),...(definition?{[kind]:document_hash}:{})},
        original_event:clone(document),status:old?old.status:'RECEIVED',last_projection_status:'PROJECTED'};
      if(['OnEvent','OnDistributeEventStart'].includes(kind))event.status=old&&old.current_revision===revision?old.status:'RECEIVED';
      if(kind==='OnEventStart'||kind==='OnEventIntervalStart')event.status='ACTIVE';
      if(kind==='OnEventStart'){event.last_interval_callback_id=null;event.last_interval_identity=null;}
      if(kind==='OnEventIntervalStart'){event.last_interval_callback_id=callback.callback_id;const iid=binding.interval_id_pointer===undefined?null:pointer(payload,binding.interval_id_pointer,false),effective=binding.interval_start_pointer===undefined?null:pointer(payload,binding.interval_start_pointer,false),signal=binding.signal_pointer===undefined?null:pointer(payload,binding.signal_pointer,false);event.last_interval_identity={interval_id:iid===undefined?null:clone(iid),effective_start_timet:effective===undefined?null:effective,signal_sha256:digest(signal===undefined?null:signal)};}
      if(kind==='OnEventRampUp')event.status='RAMPING';
      if(kind==='OnEventCancel')event.status='CANCEL_REQUESTED';
      if(kind==='OnEventArchive')event.status='ARCHIVED';
      if(kind==='OnEventComplete')event.status='COMPLETE';
      put('events',key,event,{scope:instance.instance_id});
      if(old&&revision!==null&&old.current_revision!==null&&revision>old.current_revision){
        for(const action of collect('device_actions',{scope:key,tag:'QUEUED'})){action.status='SUPERSEDED';action.superseded_by_event_revision_id=edition_id;action.updated_at=now();put('device_actions',action.device_action_id,action,{scope:key});}
      }
      let device=null;
      if(queue_devices&&(kind==='OnEventIntervalStart'||kind==='OnEventComplete')){
        try{device=queueDevice(instance,event,kind==='OnEventComplete'?'END':'SET',payload,callback.callback_id,binding,document);if(device.needs_decision.length){const issue={event_id,code:'OPT_DECISION_REQUIRED',message:'Some selected devices need a reviewed opt decision.',details:{device_ids:device.needs_decision}};issues.push(issue);event.last_projection_status='NEEDS_REVIEW';event.projection_issue=issue;put('events',key,event,{scope:instance.instance_id});}}
        catch(e){if(!(e instanceof M.DomainError))throw e;const issue={event_id,code:e.code,message:e.message,details:e.details};issues.push(issue);event.last_projection_status='NEEDS_REVIEW';event.projection_issue=issue;put('events',key,event,{scope:instance.instance_id});}
      }
      projected.push({event_id,revision,status:event.status,event_revision_id:edition_id,device});
    }
    if(kind==='OnDistributeEventStart'){
      const external=binding.distribution_id_pointer===undefined?null:pointer(payload,binding.distribution_id_pointer,false);
      const distribution_id=external===undefined||external===null?newId():recordId('distribution',instance.instance_id,external);
      const previous=get('distributions',distribution_id);
      if(preserve_distributions&&previous)return {events:projected,issues,distribution_id,status:issues.length?'NEEDS_REVIEW':'PROJECTED'};
      put('distributions',distribution_id,{distribution_id,instance_id:instance.instance_id,external_id:clone(external===undefined?null:external),
        callback_id:callback.callback_id,event_ids:projected.map(e=>e.event_id),status:'OPEN',created_at:previous?previous.created_at:now(),updated_at:now(),source_complete:false},
        {scope:instance.instance_id});
      return {events:projected,issues,distribution_id,status:issues.length?'NEEDS_REVIEW':'PROJECTED'};
    }
    return {events:projected,issues,status:issues.length?'NEEDS_REVIEW':'PROJECTED'};
  }

  function applyDistributionAbsence(instance_id,distribution_id,event_ids) {
    const present=new Set(event_ids),absent=[];
    for(const event of collect('events',{scope:instance_id})){
      if(present.has(event.event_id)||['COMPLETE','ARCHIVED'].includes(event.status))continue;
      event.status='ABSENT_FROM_COMPLETE_DISTRIBUTION';event.absent_distribution_id=distribution_id;event.updated_at=now();
      put('events',event.event_key,event,{scope:instance_id});absent.push(event.event_id);
      for(const action of collect('device_actions',{scope:event.event_key,tag:'QUEUED'})){
        if(action.action_kind==='END')continue;action.status='SUPERSEDED';action.superseded_by_distribution_id=distribution_id;action.updated_at=now();
        put('device_actions',action.device_action_id,action,{scope:event.event_key});}
    }
    return absent;
  }
  function reconcileDistribution(input) {
    const distribution=must('distributions',input.distribution_id);text(input.reviewer,'reviewer');
    const evidence=sourceEvidence(input.source_evidence||[],true);
    assert(input.complete===true,'INCOMPLETE_DISTRIBUTION','An absence reconciliation requires a reviewed complete event distribution.');
    assert(Array.isArray(input.event_ids)&&input.event_ids.every(x=>typeof x==='string'&&x.length)&&new Set(input.event_ids).size===input.event_ids.length,'INVALID_DISTRIBUTION_IDS','Provide the complete unique event identifier array.');
    const absent=applyDistributionAbsence(distribution.instance_id,distribution.distribution_id,input.event_ids);
    distribution.status='RECONCILED';distribution.source_complete=true;distribution.event_ids=clone(input.event_ids);distribution.absent_event_ids=absent;
    distribution.reviewer=input.reviewer;distribution.source_evidence=evidence;distribution.reconciled_at=now();distribution.updated_at=now();
    put('distributions',distribution.distribution_id,distribution,{scope:distribution.instance_id});
    return {distribution_id:distribution.distribution_id,status:'RECONCILED',absent_event_ids:absent};
  }
  function validateManagement(namespace,p) {
    assert(namespaces.has(namespace),'UNKNOWN_MANAGEMENT_NAMESPACE','Choose a preserved published Plaid management operation.',{namespace});
    assert(object(p),'INVALID_MANAGEMENT_PARAMETERS','Management parameters must be an original JSON object.');
    const required={
      'ven.createPartyRegistration':['includeIds'],'ven.setVenId':['venId'],
      'ven.createOptSchedule':['optId','optType','optReason','marketContext','endDeviceAsset','availability'],
      'ven.cancelOptSchedule':['optId'],'ven.eventOpt':['optId','eventId','optType','optReason','requestId'],
      'ven.createdEvent':['eventId','optType','scheduleEvent'],'ven.adhocReport':['reportRequestId']
    }[namespace]||[];
    for(const key of required)assert(Object.prototype.hasOwnProperty.call(p,key),'MISSING_MANAGEMENT_PARAMETER','The published operation requires '+key+'.');
    for(const [key,value] of Object.entries(p)){
      if(['includeIds','scheduleEvent'].includes(key))assert(typeof value==='boolean','INVALID_MANAGEMENT_PARAMETER',key+' must be boolean.');
      if(['optId','eventId','venId','optReason','requestId','reportRequestId','marketContext','endDeviceAsset'].includes(key))text(value,key);
      if(key==='resourceId')assert(typeof value==='string','INVALID_MANAGEMENT_PARAMETER','resourceId must be a string; the empty string denotes the whole VEN.');
      if(key==='optType')assert(publicContract.management.opt_types.includes(value),'INVALID_OPT_TYPE','optType must be optIn or optOut.');
    }
    if(namespace==='ven.createOptSchedule'){
      assert(Array.isArray(p.availability)&&p.availability.length,'INVALID_AVAILABILITY','Provide availability entries with original epoch seconds and integer hours.');
      for(const a of p.availability){assert(object(a),'INVALID_AVAILABILITY','Each availability entry must be an object.');integer(a.dtstart,'availability.dtstart');integer(a.duration,'availability.duration',1);}
    }
    if(namespace==='ven.adhocReport'){
      if(p.reports!==undefined)assert(object(p.reports)&&object(p.reports.onQueryIntervalsResponseMessage),'INVALID_ADHOC_REPORT','The data variant requires reports.onQueryIntervalsResponseMessage.');
      else {assert(p.start!==undefined&&p.end!==undefined,'INVALID_ADHOC_WINDOW','Provide either the existing report data envelope or an explicit start/end window.');integer(p.start,'start');integer(p.end,'end');assert(p.end>=p.start,'INVALID_ADHOC_WINDOW','end precedes start.');}
    }
  }
  function prepareManagement(input) {
    const instance=must('instances',input.instance_id);text(input.reviewer,'reviewer');validateManagement(input.namespace,input.parameters);
    const operation_id=newId(),body=canonical({namespace:input.namespace,parameters:input.parameters}),created_at=now();
    const record={operation_id,instance_id:instance.instance_id,instance_edition_id:instance.edition_id,namespace:input.namespace,parameters:clone(input.parameters),
      endpoint:instance.management_url,header_env:clone(instance.management_headers_env),request_file:rawFile(body,'Plaid_Management_Request_'+operation_id+'.json'),
      reviewer:input.reviewer,source_evidence:sourceEvidence(input.source_evidence||[],false),status:'PREPARED',created_at,updated_at:created_at,
      attempt_id:null,receipt:null,reconciliation:null};
    put('management_operations',operation_id,record,{scope:instance.instance_id});
    return {operation_id,status:'PREPARED',namespace:record.namespace,endpoint:record.endpoint,request_file:record.request_file};
  }
  function beginManagement(input) {
    const operation=must('management_operations',input.operation_id);
    assert(operation.status==='PREPARED','DISPATCH_ALREADY_STARTED','This original management operation has already left PREPARED.',{operation_id:operation.operation_id,status:operation.status},409);
    operation.status='SENDING';operation.attempt_id=newId();operation.started_at=now();operation.updated_at=now();
    put('management_operations',operation.operation_id,operation,{scope:operation.instance_id});
    return {operation_id:operation.operation_id,attempt_id:operation.attempt_id,instance_id:operation.instance_id,namespace:operation.namespace,
      endpoint:operation.endpoint,method:'POST',header_env:clone(operation.header_env),request_body_utf8:readFile(operation.request_file.sha256),
      request_body_sha256:operation.request_file.sha256,request_body_bytes:operation.request_file.bytes,status:'SENDING'};
  }
  function classifyManagement(http_status,body_utf8,transport_error) {
    if(transport_error)return {status:'UNKNOWN',layer:'transport',transport_error:clone(transport_error)};
    if(!Number.isSafeInteger(http_status))return {status:'UNKNOWN',layer:'transport',message:'No HTTP status was returned.'};
    let body;try{body=JSON.parse(body_utf8);}catch(e){return {status:'UNPARSEABLE_RESPONSE',layer:'body',http_status,message:'The original response is not valid JSON.'};}
    if(http_status<200||http_status>=300)return {status:'HTTP_ERROR',layer:'http',http_status,body:clone(body)};
    if(!object(body))return {status:'UNPARSEABLE_RESPONSE',layer:'body',http_status,body:clone(body)};
    if(Object.prototype.hasOwnProperty.call(body,'exception'))return {status:'EXCEPTION',layer:'operation',http_status,exception:clone(body.exception),body:clone(body)};
    if(body.status!=='OK')return {status:'LOCAL_STATUS_ERROR',layer:'local',http_status,body:clone(body)};
    if(body.response!==undefined){
      if(!object(body.response))return {status:'UNCLASSIFIED_RESPONSE',layer:'operation',http_status,body:clone(body)};
      const code=typeof body.response.code==='string'&&/^\d+$/.test(body.response.code)?Number(body.response.code):body.response.code;
      if(code===200)return {status:'VTN_ACCEPTED',layer:'vtn',http_status,vtn_code:code,body:clone(body)};
      if(Number.isSafeInteger(code)&&code>=400&&code<500)return {status:'VTN_REJECTED',layer:'vtn',http_status,vtn_code:code,body:clone(body)};
      if(code!==undefined)return {status:'VTN_ERROR',layer:'vtn',http_status,vtn_code:clone(code),body:clone(body)};
    }
    return {status:'PROCESSED',layer:'local',http_status,body:clone(body)};
  }
  function finishManagement(input) {
    const operation=must('management_operations',input.operation_id);text(input.attempt_id,'attempt_id');
    assert(input.attempt_id===operation.attempt_id,'DISPATCH_ATTEMPT_MISMATCH','The receipt belongs to another dispatch attempt.',{},409);
    assert(typeof input.body_utf8==='string','INVALID_RESPONSE_BODY','Preserve the exact original UTF-8 response body, including an empty body.');
    const identity=digest({attempt_id:input.attempt_id,http_status:input.http_status===undefined?null:input.http_status,
      headers:input.headers||{},body_utf8:input.body_utf8,transport_error:input.transport_error||null});
    if(operation.receipt&&operation.receipt.receipt_sha256===identity)return {operation_id:operation.operation_id,status:operation.status,receipt_id:operation.receipt.receipt_id,duplicate_receipt:true};
    assert(!operation.receipt||operation.status==='UNKNOWN','CONFLICTING_DISPATCH_RECEIPT','A different definitive result already exists for this original attempt.',{},409);
    assert(['SENDING','UNKNOWN'].includes(operation.status),'INVALID_DISPATCH_STATE','Only an original dispatched or uncertain operation can receive a result.',{},409);
    const result=classifyManagement(input.http_status,input.body_utf8,input.transport_error),receipt_id=newId(),created_at=now();
    const receipt={receipt_id,operation_id:operation.operation_id,attempt_id:input.attempt_id,receipt_sha256:identity,
      http_status:input.http_status===undefined?null:input.http_status,headers:clone(input.headers||{}),
      body_file:rawFile(input.body_utf8,'Plaid_Management_Response_'+receipt_id+'.txt','text/plain'),transport_error:clone(input.transport_error||null),classification:result,created_at};
    put('management_receipts',receipt_id,receipt,{scope:operation.operation_id,tag:result.status});
    operation.receipt_history=[...(operation.receipt_history||[]),{receipt_id,receipt_sha256:identity,status:result.status}];operation.receipt={receipt_id,receipt_sha256:identity};operation.status=result.status;operation.updated_at=now();operation.finished_at=now();
    put('management_operations',operation.operation_id,operation,{scope:operation.instance_id});
    return {operation_id:operation.operation_id,receipt_id,status:operation.status,classification:result,body_file:receipt.body_file};
  }

  function beginDevice(input) {
    const action=must('device_actions',input.device_action_id);
    assert(action.status==='QUEUED','DISPATCH_ALREADY_STARTED','This original device action has already left QUEUED.',{device_action_id:action.device_action_id,status:action.status},409);
    assert(action.endpoint,'DEVICE_ADAPTER_NOT_CONFIGURED','Configure the device adapter before the native callback queues a device action.',{},409);
    const event=must('events',eventKey(action.instance_id,action.event_id));
    if(action.action_kind!=='END')assert(event.current_revision===action.event_revision&&['ACTIVE','RAMPING'].includes(event.status),'EVENT_NO_LONGER_ACTIVE','This queued action belongs to a superseded or inactive event.',{status:event.status},409);
    if(action.action_kind!=='END'){assert(event.last_interval_identity&&canonical(event.last_interval_identity)===canonical({interval_id:action.interval_id,effective_start_timet:action.effective_start_timet,signal_sha256:digest(action.signal)}),'INTERVAL_NO_LONGER_CURRENT','A newer native interval supersedes this queued device setting.',{device_action_id:action.device_action_id,current_interval_callback_id:event.last_interval_callback_id||null},409);const edition=must('instance_editions',action.instance_edition_id),device=edition.devices.find(d=>d.device_id===action.device_id),resources=action.device_resource_ids||(device&&device.target_ids&&device.target_ids.resourceId)||[],decision=optFor(action.instance_id,action.event_id,resources);assert(decision&&decision.opt_type==='optIn','OPT_DECISION_CHANGED','The applicable current decision no longer permits this queued device setting.',{device_action_id:action.device_action_id,opt_decision_id:decision?decision.opt_decision_id:null},409);action.dispatch_opt_decision_id=decision.opt_decision_id;}
    action.status='SENDING';action.attempt_id=newId();action.started_at=now();action.updated_at=now();
    put('device_actions',action.device_action_id,action,{scope:eventKey(action.instance_id,action.event_id)});
    return {device_action_id:action.device_action_id,attempt_id:action.attempt_id,instance_id:action.instance_id,action_kind:action.action_kind,
      endpoint:action.endpoint,method:'POST',header_env:clone(action.header_env),request_body_utf8:readFile(action.request_file.sha256),
      request_body_sha256:action.request_file.sha256,request_body_bytes:action.request_file.bytes,status:'SENDING'};
  }
  function finishDevice(input) {
    const action=must('device_actions',input.device_action_id);
    assert(input.attempt_id===action.attempt_id,'DISPATCH_ATTEMPT_MISMATCH','The receipt belongs to another device attempt.',{},409);
    assert(typeof input.body_utf8==='string','INVALID_RESPONSE_BODY','Preserve the exact original device response body.');
    const identity=digest({attempt_id:input.attempt_id,http_status:input.http_status===undefined?null:input.http_status,headers:input.headers||{},body_utf8:input.body_utf8,transport_error:input.transport_error||null});
    if(action.receipt&&action.receipt.receipt_sha256===identity)return {device_action_id:action.device_action_id,status:action.status,receipt:action.receipt,duplicate_receipt:true};
    assert(!action.receipt||action.status==='UNKNOWN','CONFLICTING_DISPATCH_RECEIPT','A different definitive result already exists for this device attempt.',{},409);
    assert(['SENDING','UNKNOWN'].includes(action.status),'INVALID_DISPATCH_STATE','Only an original dispatched or uncertain device action can receive a result.',{},409);
    const status=input.transport_error||!Number.isSafeInteger(input.http_status)?'UNKNOWN':input.http_status>=200&&input.http_status<300?'ACKNOWLEDGED':'HTTP_ERROR';
    const receipt={receipt_id:newId(),receipt_sha256:identity,attempt_id:input.attempt_id,http_status:input.http_status===undefined?null:input.http_status,
      headers:clone(input.headers||{}),body_file:rawFile(input.body_utf8,'Device_Response_'+action.device_action_id+'_'+newId()+'.txt','text/plain'),
      transport_error:clone(input.transport_error||null),status,meaning:status==='ACKNOWLEDGED'?'The configured adapter returned HTTP success; its original response records the device-specific result.':null,created_at:now()};
    action.receipt_history=[...(action.receipt_history||[]),receipt];action.receipt=receipt;action.status=status;action.finished_at=now();action.updated_at=now();
    put('device_actions',action.device_action_id,action,{scope:eventKey(action.instance_id,action.event_id)});
    return {device_action_id:action.device_action_id,status,receipt};
  }
  function reconcileDispatch(input,type) {
    const device=type==='device',table=device?'device_actions':'management_operations',key=device?'device_action_id':'operation_id';
    const record=must(table,input[key]);text(input.reviewer,'reviewer');text(input.reason,'reason');
    assert(!['PREPARED','QUEUED','SENDING'].includes(record.status),'DISPATCH_NOT_RECONCILABLE','Finish or recover the existing attempt before recording its observed disposition.',{status:record.status},409);
    assert(['complete','not_applied','still_unknown'].includes(input.disposition),'INVALID_DISPOSITION','Choose complete, not_applied or still_unknown.');
    const evidence=sourceEvidence(input.source_evidence||[],true),reconciliation_id=newId();
    const reconciliation={reconciliation_id,original_status:record.status,attempt_id:record.attempt_id,disposition:input.disposition,
      reviewer:input.reviewer,reason:input.reason,source_evidence:evidence,created_at:now()};
    record.reconciliations=[...(record.reconciliations||[]),reconciliation];record.reconciliation=reconciliation;
    record.status=input.disposition==='still_unknown'?'UNKNOWN':input.disposition==='complete'?'RECONCILED_COMPLETE':'RECONCILED_NOT_APPLIED';record.updated_at=now();
    put(table,input[key],record,{scope:device?eventKey(record.instance_id,record.event_id):record.instance_id});
    return {[key]:input[key],status:record.status,reconciliation_id};
  }
  function recoverDispatches(input) {
    text(input.reviewer,'reviewer');text(input.reason,'reason');const recovered=[];
    for(const [table,key] of [['management_operations','operation_id'],['device_actions','device_action_id']]){
      for(const record of collect(table,{tag:'SENDING'})){
        record.status='UNKNOWN';record.updated_at=now();record.recoveries=[...(record.recoveries||[]),{reviewer:input.reviewer,reason:input.reason,attempt_id:record.attempt_id,created_at:now()}];
        put(table,record[key],record,{scope:table==='device_actions'?eventKey(record.instance_id,record.event_id):record.instance_id});
        recovered.push({collection:table,id:record[key],attempt_id:record.attempt_id,status:'UNKNOWN'});
      }
    }
    return {recovered};
  }

  function projectHistory(input) {
    const instance=must('instances',input.instance_id);text(input.reviewer,'reviewer');
    const evidence=sourceEvidence(input.source_evidence||[],true),projection_id=newId(),created_at=now();
    const eventKinds=new Set(['OnDistributeEventStart','OnEvent','OnEventStart','OnEventIntervalStart','OnEventCancel','OnEventArchive','OnEventComplete','OnEventRampUp']);
    const saved=collect('callbacks',{scope:instance.instance_id}).filter(c=>eventKinds.has(c.kind)&&c.header);
    saved.sort((a,b)=>(a.first_received_revision||0)-(b.first_received_revision||0)||(a.created_at<b.created_at?-1:a.created_at>b.created_at?1:a.callback_id<b.callback_id?-1:1));
    const unbound=saved.filter(c=>!instance.bindings[c.kind]||instance.bindings[c.kind].event_id_pointer===undefined);
    assert(unbound.length===0,'INCOMPLETE_HISTORY_BINDINGS','Bind every retained event callback kind before rebuilding the current event projection.',{callback_kinds:Array.from(new Set(unbound.map(c=>c.kind)))},409);
    for(const old of collect('events',{scope:instance.instance_id})){
      const event={...old,current_revision:null,current_edition_id:null,definition_sha256:null,definition_by_kind:{},
        status:'REPROJECTING',last_interval_callback_id:null,last_interval_identity:null,last_callback_id:null,last_callback_kind:null,updated_at:created_at};
      put('events',event.event_key,event,{scope:instance.instance_id});
    }
    const timeline=saved.map(callback=>({kind:'callback',revision:callback.first_received_revision||0,created_at:callback.created_at,callback}));
    for(const operation of collect('operations',{})){
      if(operation.action!=='reconcile_distribution')continue;
      const distribution=get('distributions',operation.input.distribution_id);
      if(distribution&&distribution.instance_id===instance.instance_id)timeline.push({kind:'reconciliation',revision:operation.result.revision,created_at:operation.created_at,operation});
    }
    timeline.sort((a,b)=>a.revision-b.revision||(a.created_at<b.created_at?-1:a.created_at>b.created_at?1:0));
    let projected=0,reapplied_reconciliations=0;const issues=[];
    for(const item of timeline) {
      if(item.kind==='reconciliation'){applyDistributionAbsence(instance.instance_id,item.operation.input.distribution_id,item.operation.input.event_ids);reapplied_reconciliations++;continue;}
      const callback=item.callback;
      const payload=JSON.parse(readFile(callback.request_file.sha256)),binding=instance.bindings[callback.kind];
      const result=eventProjection(instance,callback.kind,payload,callback,binding,{queue_devices:false,preserve_distributions:true});projected++;
      for(const issue of result.issues)issues.push({callback_id:callback.callback_id,...issue});
      callback.projection_history=[...(callback.projection_history||[]),{projection_id,instance_edition_id:instance.edition_id,created_at,result}];
      put('callbacks',callback.callback_id,callback,{scope:instance.instance_id,tag:callback.processing_status});
    }
    return {projection_id,instance_id:instance.instance_id,instance_edition_id:instance.edition_id,projected_callbacks:projected,reapplied_reconciliations,
      reviewer:input.reviewer,source_evidence:evidence,issue_count:issues.length,issues,status:issues.length?'NEEDS_REVIEW':'PROJECTED'};
  }
  function resumeEventCallback(input) {
    const callback=must('callbacks',input.callback_id),instance=must('instances',callback.instance_id);
    text(input.reviewer,'reviewer');text(input.event_id,'event_id');const evidence=sourceEvidence(input.source_evidence||[],true);
    assert(callback.kind==='OnEventIntervalStart'&&callback.header,'INVALID_CALLBACK_CONTINUATION','Only an original accepted interval-start context can prepare its device settings.',{},409);
    const binding=instance.bindings.OnEventIntervalStart;
    assert(binding&&binding.event_id_pointer!==undefined,'UNPROJECTED_SCHEMA','Configure the reviewed interval binding first.',{},409);
    const payload=JSON.parse(readFile(callback.request_file.sha256));
    const documents=binding.events_pointer!==undefined?pointer(payload,binding.events_pointer,true):[pointer(payload,binding.event_pointer===undefined?'':binding.event_pointer,true)];
    assert(Array.isArray(documents),'INVALID_BOUND_EVENTS','The reviewed event selector must produce an array.');
    const matches=documents.filter(d=>pointer(d,binding.event_id_pointer,false)===input.event_id);
    assert(matches.length===1,'AMBIGUOUS_CALLBACK_EVENT','The retained callback must contain exactly one selected event.');
    const event=must('events',eventKey(instance.instance_id,input.event_id));
    assert(Object.prototype.hasOwnProperty.call(input,'expected_event_revision')&&input.expected_event_revision===event.current_revision,
      'EVENT_REVISION_CHANGED','The current event edition differs from the reviewed continuation.',{current_revision:event.current_revision},409);
    assert(event.status==='ACTIVE'&&event.last_interval_callback_id===callback.callback_id,
      'INTERVAL_NO_LONGER_CURRENT','Project the saved event history and select its still-active latest native interval before continuing.',{status:event.status,current_interval_callback_id:event.last_interval_callback_id||null},409);
    const originalRevision=binding.revision_pointer===undefined?null:pointer(matches[0],binding.revision_pointer,false);
    assert((originalRevision===undefined?null:originalRevision)===event.current_revision,'CALLBACK_REVISION_MISMATCH','The original callback edition is not the current event edition.',{},409);
    if(binding.interval_id_pointer!==undefined){
      assert(Object.prototype.hasOwnProperty.call(input,'expected_interval_id'),'MISSING_INTERVAL_ID','Retain the reviewed original interval identity.');
      assert(canonical(input.expected_interval_id)===canonical(pointer(payload,binding.interval_id_pointer,true)),'INTERVAL_ID_CHANGED','The reviewed interval identity differs from the original callback.',{},409);
    }
    if(binding.interval_start_pointer!==undefined){
      assert(input.expected_effective_start_timet===pointer(payload,binding.interval_start_pointer,true),'INTERVAL_START_CHANGED','The reviewed effective start differs from the original callback.',{},409);
    }
    const result=queueDevice(instance,event,'SET',payload,callback.callback_id,binding,matches[0]),continuation_id=newId(),created_at=now();
    const continuation={continuation_id,instance_edition_id:instance.edition_id,event_id:event.event_id,event_revision:event.current_revision,
      reviewer:input.reviewer,source_evidence:evidence,created_at,result};
    callback.continuations=[...(callback.continuations||[]),continuation];
    put('callbacks',callback.callback_id,callback,{scope:instance.instance_id,tag:callback.processing_status});
    event.last_projection_status=result.status==='NEEDS_REVIEW'?'NEEDS_REVIEW':'PROJECTED';event.last_continuation_id=continuation_id;event.updated_at=created_at;
    put('events',event.event_key,event,{scope:instance.instance_id});
    return {continuation_id,callback_id:callback.callback_id,event_id:event.event_id,status:result.status,device_actions:result.actions,needs_decision:result.needs_decision,opted_out:result.opted_out};
  }
  function callbackResponse(instance,kind,payload,record) {
    if(kind==='OnHeartbeat')return {http_status:200,body_utf8:'',processing_status:'RECORDED'};
    if(kind==='OnRegisterReports') {
      if(!instance.active_mapping_id)return {http_status:503,body_utf8:'',processing_status:'NEEDS_MAPPING'};
      const mapping=must('mappings',instance.active_mapping_id);
      return {http_status:200,body_utf8:readFile(mapping.registration_response_file.sha256),processing_status:'REGISTERED_RESPONSE',mapping_id:mapping.mapping_id};
    }
    if(kind==='OnQueryIntervals') {
      const query=queryShape(payload.onQueryIntervalsMessage),cached=instance.active_mapping_id?get('meta','report-cache:'+recordId(instance.instance_id,instance.active_mapping_id,query)):null;
      const result=cached?{report_id:cached.report_id,status:'READY',response_file:cached.response_file,issue_count:0}:buildReport({instance_id:instance.instance_id,query},record.callback_id);
      return {http_status:result.status==='READY'?200:503,body_utf8:result.response_file?readFile(result.response_file.sha256):'',
        processing_status:result.status,report_id:result.report_id,issue_count:result.issue_count};
    }
    const binding=instance.bindings[kind];
    if(kind==='OnDistributeEventComplete'&&binding&&binding.distribution_id_pointer!==undefined) {
      const external=pointer(payload,binding.distribution_id_pointer,true),id=recordId('distribution',instance.instance_id,external),distribution=must('distributions',id);
      distribution.status='COMPLETE';distribution.complete_callback_id=record.callback_id;distribution.updated_at=now();
      // Only an explicit full-list/source review establishes source_complete for absence reconciliation.
      put('distributions',id,distribution,{scope:instance.instance_id});
      return {http_status:200,body_utf8:'',processing_status:'DISTRIBUTION_COMPLETE',distribution_id:id};
    }
    const eventKinds=['OnDistributeEventStart','OnEvent','OnEventStart','OnEventIntervalStart','OnEventCancel','OnEventArchive','OnEventComplete','OnEventRampUp'];
    if(eventKinds.includes(kind)) {
      if(!binding||binding.event_id_pointer===undefined)return {http_status:200,body_utf8:'',processing_status:'UNPROJECTED_SCHEMA'};
      const projected=eventProjection(instance,kind,payload,record,binding);let body='';
      if(binding.response_template!==undefined) {
        const response=clone(binding.response_template);
        if(binding.opt_type_pointer!==undefined) {
          assert(projected.events.length===1,'AMBIGUOUS_OPT_RESPONSE','A single opt response pointer requires exactly one bound event.');
          const decision=optFor(instance.instance_id,projected.events[0].event_id);
          if(decision)assignPointer(response,binding.opt_type_pointer,decision.opt_type);
        }
        body=canonical(response);
      }
      return {http_status:200,body_utf8:body,processing_status:projected.status,projection:projected};
    }
    return {http_status:200,body_utf8:'',processing_status:'RECORDED'};
  }
  function handleCallback(instance_id,raw_utf8,{callback_kind}={}) {
    assert(typeof raw_utf8==='string','INVALID_CALLBACK_BODY','Preserve the exact callback UTF-8 body.');
    return store.transaction(()=>{
      const w=workspace(),instance=must('instances',instance_id);
      assert(callbackKinds.has(callback_kind),'UNKNOWN_CALLBACK','The endpoint must select a documented callback kind.');
      const input_file=rawFile(raw_utf8,'Plaid_Callback_'+newId()+'.json'),callback_id=recordId('callback',instance_id,callback_kind,input_file.sha256),
        delivery_id=newId(),created_at=now(),old=get('callbacks',callback_id);
      const basis=canonical([instance.edition_id,instance.active_mapping_id]);
      let record=old||{callback_id,instance_id,kind:callback_kind,request_file:input_file,created_at,first_received_revision:w.revision+1,delivery_count:0,attempts:[],header:null};
      record.delivery_count++;record.last_delivery_at=created_at;
      const reusable=old&&(old.http_status===200||old.processing_basis===basis);
      let replayed=false;
      if(reusable){replayed=true;}
      else {
        let payload=null,result;
        try {
          if(raw_utf8===''){assert(callback_kind==='OnHeartbeat','EMPTY_CALLBACK','Only the explicit heartbeat endpoint accepts an empty body.');}
          else {
            try{payload=JSON.parse(raw_utf8);}catch(e){fail('INVALID_CALLBACK_JSON','The callback is not valid JSON.',{message:e.message});}
            assert(object(payload)&&object(payload.header),'INVALID_CALLBACK_HEADER','A nonempty callback requires its original header object.');
            assert(payload.header.messageType===callback_kind,'CALLBACK_KIND_MISMATCH','The endpoint and original header.messageType differ.');
            if(payload.header.instanceId!==undefined)assert(payload.header.instanceId===instance_id,'CALLBACK_INSTANCE_MISMATCH','The original callback belongs to another configured instance.');
            record.header=clone(payload.header);
          }
          result=callbackResponse(instance,callback_kind,payload,record);
        } catch(e) {
          if(!(e instanceof M.DomainError))throw e;
          const invalid=['INVALID_CALLBACK_JSON','INVALID_CALLBACK_HEADER','CALLBACK_KIND_MISMATCH','CALLBACK_INSTANCE_MISMATCH','EMPTY_CALLBACK'].includes(e.code);
          result={http_status:invalid?400:503,body_utf8:'',processing_status:invalid?'INVALID_CALLBACK':'NEEDS_REVIEW',issue:{code:e.code,message:e.message,details:e.details}};
        }
        const response_file=rawFile(result.body_utf8,'Plaid_Callback_Response_'+callback_id+'_'+record.attempts.length+'.txt','text/plain');
        const attempt={attempt_id:newId(),created_at,http_status:result.http_status,processing_status:result.processing_status,response_file,
          processing_basis:basis,...Object.fromEntries(Object.entries(result).filter(([key])=>!['http_status','body_utf8','processing_status'].includes(key)))};
        record={...record,...attempt,created_at:record.created_at,attempts:[...record.attempts,attempt]};
      }
      put('callbacks',callback_id,record,{scope:instance_id,tag:record.processing_status});
      const delivery={delivery_id,callback_id,instance_id,kind:callback_kind,request_file:input_file,created_at,replayed,http_status:record.http_status,
        processing_status:record.processing_status,response_file:record.response_file};
      put('callback_deliveries',delivery_id,delivery,{scope:callback_id,tag:record.processing_status});
      instance.last_callback_at=created_at;if(record.header)instance.last_header=record.header;instance.updated_at=created_at;put('instances',instance_id,instance);
      w.revision++;w.updated_at=created_at;put('meta','workspace',w);
      return {http_status:record.http_status,body_utf8:readFile(record.response_file.sha256),callback_id,delivery_id,replayed,
        processing_status:record.processing_status,report_id:record.report_id||null,projection:record.projection||null,revision:w.revision};
    });
  }
  const handlers={
    configure_instance:configureInstance,import_source:importSource,save_mapping:saveMapping,activate_mapping:activateMapping,
    record_opt_decision:recordOpt,build_report:buildReport,reconcile_distribution:reconcileDistribution,
    prepare_management:prepareManagement,begin_management:beginManagement,finish_management:finishManagement,
    reconcile_management:input=>reconcileDispatch(input,'management'),
    begin_device_action:beginDevice,finish_device_action:finishDevice,reconcile_device_action:input=>reconcileDispatch(input,'device'),
    recover_dispatches:recoverDispatches,project_event_history:projectHistory,resume_event_callback:resumeEventCallback
  };
  function execute(action,input,{request_id,expected_revision}={}) {
    assert(ACTIONS.includes(action),'UNKNOWN_ACTION','The requested action is not available.');
    text(request_id,'request_id');assert(object(input),'INVALID_ACTION_INPUT','Action input must be a JSON object.');
    const input_sha256=digest({action,input});
    return store.transaction(()=>{
      const existing=get('operations',request_id);
      if(existing){assert(existing.action===action&&existing.input_sha256===input_sha256,'REQUEST_ID_CONFLICT','This operation identity was already used for different input.',{request_id},409);return {...clone(existing.result),replayed:true};}
      const w=workspace();integer(expected_revision,'expected_revision');
      assert(w.revision===expected_revision,'WORKSPACE_REVISION_CONFLICT','Refresh the workspace before applying this change.',{expected_revision,actual_revision:w.revision},409);
      const result=handlers[action](clone(input));w.revision++;w.updated_at=now();put('meta','workspace',w);
      const response={...result,workspace_id:w.workspace_id,revision:w.revision,request_id,action,replayed:false};
      put('operations',request_id,{request_id,action,input_sha256,input:clone(input),result:response,status:'COMPLETE',created_at:now()},{scope:w.workspace_id});
      return response;
    });
  }
  return Object.freeze({initialize,state,page,detail,execute,handleCallback});
}
module.exports={createEngine,TABLES,ACTIONS,SCHEMA,DomainError:M.DomainError};
