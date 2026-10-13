'use strict';
/** Original product exports received into the maintained lead customer workspace. */
const FIELDS=['acquisition_intake_sources','acquisition_intake_batches','acquisition_intake_records'];
const VERSION='dealscout.acquisition-intake.v1';
const SOURCE='dealscout.acquisition-intake-source.v1';
const RECORD='dealscout.acquisition-intake-record.v1';
const BATCH='dealscout.acquisition-intake-batch.v1';
const MAPPING='dealscout.acquisition-intake-mapping.v1';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=(message,status=422,details)=>{throw Object.assign(new Error(message),{code:'ACQUISITION_INTAKE',status,...(details?{details}:{})});};
const need=(ok,message,status=422,details)=>{if(!ok)fail(message,status,details);};
const text=(v,label,{required=false,max=4000}={})=>{
  need(typeof v==='string',label+' must be text.');
  need(v.length<=max&&!v.includes('\0'),label+' is too long or contains a null character.');
  need(!required||v.trim(),label+' is required.');return v;
};
const instant=(v,label)=>{
  text(v,label,{required:true,max:80});
  need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v),
    label+' needs an ISO date and time with an explicit UTC offset.');
  const n=Date.parse(v);need(Number.isFinite(n),label+' is not a valid date and time.');
  const [,y,m,d,h,min,sec]=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(v);
  const monthEnd=new Date(0);monthEnd.setUTCFullYear(+y,+m,0);
  need(+m>=1&&+m<=12&&+d>=1&&+d<=monthEnd.getUTCDate()&&+h<24&&+min<60&&+sec<60,
    label+' contains an invalid calendar date or time.');
  return new Date(n).toISOString();
};
function pathParts(value,label){
  need(Array.isArray(value)&&value.length<=20&&value.every(x=>
    (typeof x==='string'&&x.length>0&&x.length<=200&&!['__proto__','prototype','constructor'].includes(x))||
    (Number.isSafeInteger(x)&&x>=0)),label+' must be an explicit JSON path array.');
  return value.slice();
}
function atPath(row,path){
  let value=row;
  for(const part of path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return undefined;value=value[part];}
  return value;
}
function parseCSV(body,delimiter=','){
  need([',',';','\t'].includes(delimiter),'Choose comma, semicolon or tab as the actual separator.');
  const rows=[];let row=[],value='',quoted=false,afterQuote=false,started=false,line=1,startLine=1;
  const cell=()=>{row.push(value);value='';afterQuote=false;started=false;};
  const end=()=>{cell();rows.push({line:startLine,values:row});row=[];startLine=line+1;};
  for(let i=0;i<body.length;i++){
    const c=body[i];
    if(quoted){
      if(c==='"'){if(body[i+1]==='"'){value+='"';i++;}else{quoted=false;afterQuote=true;}}
      else{value+=c;if(c==='\n')line++;}
      continue;
    }
    if(c===delimiter){cell();continue;}
    if(c==='\r'||c==='\n'){
      if(c==='\r'&&body[i+1]==='\n')i++;
      end();line++;continue;
    }
    need(!afterQuote,'Unexpected characters after a closing quote at source line '+line+'.');
    if(c==='"'){need(!started&&!value,'A quote occurs inside an unquoted field at source line '+line+'.');quoted=true;started=true;}
    else{value+=c;started=true;}
  }
  need(!quoted,'A quoted CSV field is unfinished at the end of the original file.');
  if(started||afterQuote||value||row.length)end();
  need(rows.length,'The source file has no header.');
  const header=rows.shift().values;
  need(header.length&&header.every(x=>x.length>0),'Every source column needs its original nonempty header.');
  need(new Set(header).size===header.length,'Repeated CSV headers are ambiguous. Select an export with distinct headers.');
  const records=[],errors=[];
  for(const item of rows){
    if(item.values.length===1&&item.values[0]==='')continue;
    if(item.values.length!==header.length){errors.push({row:item.line,code:'column-count',
      message:'Expected '+header.length+' columns; received '+item.values.length+'.'});continue;}
    records.push({row:item.line,value:Object.fromEntries(header.map((name,i)=>[name,item.values[i]]))});
  }
  return {columns:header,records,errors};
}
function parseJSON(body,label){
  try{return JSON.parse(body,(_,v)=>{
    if(typeof v==='number')need(Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v)),
      label+' contains an integer outside JavaScript’s exact range. Export provider identifiers as strings.');
    return v;
  });}catch(e){if(e.code==='ACQUISITION_INTAKE')throw e;fail(label+' is not valid JSON: '+e.message);}
}
function decimal(v,label){
  const s=typeof v==='string'?v:(typeof v==='number'&&Number.isSafeInteger(v)?String(v):null);
  need(s!==null&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s),
    label+' needs a decimal string (use the original decimal value, not binary floating-point JSON).');
  let n=s.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
  if(/^-?0$/.test(n))n='0';return n;
}
function transform(value,binding){
  const label=binding.target;
  if(value===undefined||value===null||value===''){
    need(!binding.required,label+' is missing.');return null;
  }
  if(binding.values){
    const key=typeof value==='string'?value:String(value);
    need(Object.hasOwn(binding.values,key),label+' has an unmapped source value: '+key);
    value=binding.values[key];
  }
  switch(binding.format){
    case 'text':{text(value,label,{max:10000});const result=binding.trim?value.trim():value;
      need(!binding.required||result.length>0,label+' is empty after the selected transform.');return result;}
    case 'instant':return instant(value,label);
    case 'epoch-seconds':
    case 'epoch-milliseconds':{
      const s=typeof value==='number'?String(value):value;
      need(typeof s==='string'&&/^-?\d+$/.test(s),label+' needs an integral original Unix timestamp.');
      const n=Number(s);need(Number.isSafeInteger(n),label+' exceeds the exact timestamp range.');
      const ms=binding.format==='epoch-seconds'?n*1000:n;
      need(Number.isSafeInteger(ms)&&Math.abs(ms)<=8640000000000000,label+' exceeds the date range.');
      return new Date(ms).toISOString();
    }
    case 'integer':{
      const s=typeof value==='number'?String(value):value;
      need(typeof s==='string'&&/^-?(?:0|[1-9]\d*)$/.test(s)&&Number.isSafeInteger(Number(s)),
        label+' needs an exact integer.');return Number(s);
    }
    case 'decimal':return decimal(value,label);
    case 'boolean':
      need(typeof value==='boolean',label+' needs true/false; map explicit CSV spellings to booleans.');
      return value;
    default:fail('Choose a supported transform for '+label+'.');
  }
}
function normalizedMapping(input){
  need(plain(input)&&input.version===MAPPING,'Use a complete acquisition intake mapping.');
  need(['events','counters','entities'].includes(input.record_kind),'Choose events, counters or entity snapshots.');
  need(Array.isArray(input.bindings)&&input.bindings.length>0&&input.bindings.length<=100,'Select explicit source-field bindings.');
  const bindings=input.bindings.map(b=>{
    need(plain(b)&&typeof b.target==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(b.target),'Use a named destination field.');
    need(['text','instant','epoch-seconds','epoch-milliseconds','integer','decimal','boolean'].includes(b.format),'Choose a supported field transform.');
    need(typeof b.required==='boolean'&&(b.trim===undefined||typeof b.trim==='boolean'),'Retain explicit required/trim choices.');
    const literal=Object.hasOwn(b,'literal');need(literal!==Object.hasOwn(b,'path'),'Choose one original source path or explicit literal per binding.');
    if(literal)need(b.literal===null||['string','number','boolean'].includes(typeof b.literal),'Use a scalar literal.');
    if(b.values)need(plain(b.values)&&Object.values(b.values).every(v=>v===null||['string','number','boolean'].includes(typeof v)),'Value mappings must contain scalar destinations.');
    return {target:b.target,format:b.format,required:b.required,trim:Boolean(b.trim),
      ...(literal?{literal:b.literal}:{path:pathParts(b.path,'Source path')}),
      ...(b.values?{values:clone(b.values)}:{})};
  });
  need(new Set(bindings.map(b=>b.target)).size===bindings.length,'Map each destination field once.');
  need(Array.isArray(input.identity_fields)&&input.identity_fields.length>0&&
    new Set(input.identity_fields).size===input.identity_fields.length&&
    input.identity_fields.every(k=>bindings.some(b=>b.target===k&&b.required)),
    'Select distinct required destination fields as the stable provider record key.');
  text(input.contract_id,'Acquisition contract ID',{required:true,max:200});
  return {version:MAPPING,contract_id:input.contract_id,record_kind:input.record_kind,
    records_path:pathParts(input.records_path||[],'Record array path'),
    delimiter:input.delimiter??',',identity_fields:input.identity_fields.slice(),bindings};
}
function baseSemantics(value,kind){
  if(kind==='events'){
    need(typeof value.event_type==='string'&&value.event_type.trim(),'Map the actual event type.');
    need(typeof value.subject_id==='string'&&value.subject_id.trim(),'Map the original account or creator subject ID.');
    value.occurred_at=instant(value.occurred_at,'Event occurrence time');
  }else if(kind==='counters'){
    need(typeof value.metric==='string'&&value.metric.trim(),'Map the counter metric.');
    need(typeof value.subject_id==='string'&&value.subject_id.trim(),'Map the counter subject.');
    value.observed_at=instant(value.observed_at,'Counter observation time');
    need(typeof value.value==='number'||typeof value.value==='string','Map the actual counter value.');
    value.value=decimal(value.value,'Counter value');
    need(typeof value.unit==='string'&&value.unit.trim(),'State the original counter unit.');
    if(value.period_start!==undefined&&value.period_start!==null)value.period_start=instant(value.period_start,'Counter period start');
    if(value.period_end!==undefined&&value.period_end!==null)value.period_end=instant(value.period_end,'Counter period end');
    if(value.period_start&&value.period_end)need(value.period_start<=value.period_end,'The counter period ends before it starts.');
  }else{
    need(typeof value.entity_type==='string'&&value.entity_type.trim(),'Map the original entity type.');
    value.observed_at=instant(value.observed_at,'Entity observation time');
  }
  return value;
}
function csvCell(v){const s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);
  const safe=/^[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replaceAll('"','""')+'"';}

function createLeadAcquisitionIntake({hash,sha256Utf8,utf8ByteLength,maxSourceBytes=64*1024*1024}){
  need(typeof hash==='function'&&typeof sha256Utf8==='function'&&typeof utf8ByteLength==='function','Use the existing workspace hash functions.');
  const digest=s=>{const value=sha256Utf8(s);return typeof value==='string'?value:value.sha256;};
  const signed=document=>({...document,sha256:hash(document)});
  function verify(row,version){
    need(plain(row)&&row.version===version,'The retained intake record has an unsupported edition.');
    const {sha256,...body}=row;need(sha256===hash(body),'A retained intake source or record changed.');
  }
  function validate(root){
    const packIds=new Set((root.packs||[]).map(x=>x.id));
    for(const key of FIELDS){
      need(root[key]===undefined||Array.isArray(root[key]),'The saved intake collection is incomplete.');
      need(new Set((root[key]||[]).map(x=>x.id)).size===(root[key]||[]).length,'A saved intake collection repeats an ID.');
    }
    const sources=new Map((root.acquisition_intake_sources||[]).map(row=>{
      verify(row,SOURCE);need(packIds.has(row.pack_id),'An original product export lost its customer pack.');
      need(digest(row.body)===row.body_sha256&&utf8ByteLength(row.body)===row.bytes,'The original product export bytes changed.');
      need(row.id==='acquisition-source:'+hash({pack_id:row.pack_id,provider:row.provider,
        account_key:row.account_key,format:row.format,body_sha256:row.body_sha256}),
        'The retained source identity changed.');
      instant(row.acquired_at,'Source acquisition time');return [row.id,row];
    }));
    const records=new Map((root.acquisition_intake_records||[]).map(row=>{
      verify(row,RECORD);need(packIds.has(row.pack_id),'A received record lost its customer pack.');
      need(['events','counters','entities'].includes(row.record_kind),'A received record lost its original semantics.');
      need(sources.get(row.source_id)?.pack_id===row.pack_id,'A received record lost its original source.');
      need(row.id==='acquisition-record:'+hash(row.identity),'The provider record identity changed.');
      need(row.values_sha256===hash(row.values),'The received provider values changed.');
      const source=sources.get(row.source_id);
      need(row.identity.pack_id===row.pack_id&&row.identity.provider===source.provider&&
        row.identity.account_key===source.account_key&&row.identity.record_kind===row.record_kind,
        'The provider record belongs to another source namespace.');
      need(plain(row.identity.provider_key)&&Object.keys(row.identity.provider_key).length&&
        Object.entries(row.identity.provider_key).every(([k,v])=>hash(v)===hash(row.values[k])),
        'The retained provider key differs from its original received values.');
      baseSemantics(clone(row.values),row.record_kind);return [row.id,row];
    }));
    for(const row of root.acquisition_intake_batches||[]){
      verify(row,BATCH);need(sources.get(row.source_id)?.pack_id===row.pack_id,'The intake review lost its original source.');
      need(row.record_ids.every(id=>records.get(id)?.pack_id===row.pack_id),'The intake review lost a received record.');
      need(row.mapping_sha256===hash(normalizedMapping(row.mapping)),'The retained field mapping changed.');
    }
  }
  function readSource(root,input,at){
    need(plain(input)&&plain(input.source),'Select the original export and its customer pack.');
    const pack=(root.packs||[]).find(x=>x.id===input.pack_id);need(pack,'Choose an existing customer pack.',404);
    const s=input.source;need(['csv','json','ndjson'].includes(s.format),'Choose CSV, JSON or newline-delimited JSON.');
    text(s.body,'Original source body',{max:maxSourceBytes});const bytes=utf8ByteLength(s.body);
    need(bytes<=maxSourceBytes,'This file exceeds the configured original-source storage limit.',413);
    text(s.name,'Original filename',{required:true,max:500});text(s.provider,'Provider',{required:true,max:200});
    text(s.account_key,'Provider account namespace',{required:true,max:500});
    const acquired=instant(s.acquired_at,'Source acquisition time');need(acquired<=at,'The source acquisition time is in the future.');
    const url=s.source_url||'';text(url,'Source URL',{max:2000});
    if(url){const u=new URL(url);need(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password,'Use a public source URL without credentials.');}
    const bodyHash=digest(s.body),identity={pack_id:input.pack_id,provider:s.provider,account_key:s.account_key,format:s.format,body_sha256:bodyHash};
    const id='acquisition-source:'+hash(identity);
    const existing=(root.acquisition_intake_sources||[]).find(x=>x.id===id);
    const source=existing||signed({version:SOURCE,id,...identity,name:s.name,body:s.body,bytes,acquired_at:acquired,source_url:url});
    return source;
  }
  function inspect(root,input,at=new Date().toISOString(),options={}){
    validate(root);at=instant(at,'Review time');
    const source=readSource(root,input,at),mapping=normalizedMapping(input.mapping);
    if(options.contract){
      need(options.contract.id===mapping.contract_id&&options.contract.record_kinds.includes(mapping.record_kind),
        'Select the current acquisition component contract and accepted record kind.');
    }
    const body=source.body.replace(/^\uFEFF/,'');let parsed;
    if(source.format==='csv')parsed=parseCSV(body,mapping.delimiter);
    else if(source.format==='json'){
      const doc=parseJSON(body,'Original source'),values=atPath(doc,mapping.records_path);
      need(Array.isArray(values),'The selected original JSON path does not contain a record array.');
      parsed={columns:[],records:values.map((value,i)=>({row:i+1,value})),errors:[]};
    }else{
      parsed={columns:[],records:[],errors:[]};
      body.split(/\r?\n/).forEach((line,i)=>{if(!line.trim())return;
        try{parsed.records.push({row:i+1,value:parseJSON(line,'Source line '+(i+1))});}
        catch(error){parsed.errors.push({row:i+1,code:'json',message:error.message});}});
    }
    const existing=new Map((root.acquisition_intake_records||[]).map(x=>[x.id,x])),seen=new Map(),rows=[];
    for(const item of parsed.records){
      const row={row:item.row,row_id:'source-row:'+hash({source_id:source.id,row:item.row}),status:'invalid',issues:[]};
      try{
        need(plain(item.value),'Select original object records, not scalar rows.');
        const values=Object.fromEntries(mapping.bindings.map(b=>[b.target,transform(Object.hasOwn(b,'literal')?b.literal:atPath(item.value,b.path),b)]));
        baseSemantics(values,mapping.record_kind);
        if(options.validateRecord){const checked=options.validateRecord(clone(values),mapping.record_kind);
          need(!checked||typeof checked.then!=='function','Acquisition validation must complete inside the current transaction.');}
        const key=Object.fromEntries(mapping.identity_fields.map(name=>{need(values[name]!==null&&values[name]!==undefined&&values[name]!=='','The stable key field '+name+' is empty.');return [name,values[name]];}));
        const identity={pack_id:source.pack_id,provider:source.provider,account_key:source.account_key,
          contract_id:mapping.contract_id,record_kind:mapping.record_kind,provider_key:key};
        const recordId='acquisition-record:'+hash(identity),valuesHash=hash(values),old=existing.get(recordId),prior=seen.get(recordId);
        Object.assign(row,{record_id:recordId,identity,values,values_sha256:valuesHash,source_record_sha256:hash(item.value)});
        if(old){row.status=old.values_sha256===valuesHash?'already-received':'conflict';row.existing_sha256=old.values_sha256;
          if(row.status==='conflict')row.issues.push('This provider key already has different received values. Correct the mapping or use the provider’s explicit correction identity.');}
        else if(prior){row.status=prior.values_sha256===valuesHash?'duplicate':'conflict';row.duplicate_of=prior.row_id;
          if(row.status==='conflict'){row.issues.push('The source repeats this provider key with different values.');prior.status='conflict';prior.issues.push('Another source row uses this provider key with different values.');}}
        else row.status='ready';
        if(!prior)seen.set(recordId,row);
      }catch(error){row.issues.push(error.message);}
      rows.push(row);
    }
    for(const error of parsed.errors)rows.push({row:error.row,row_id:'source-row:'+hash({source_id:source.id,row:error.row}),status:'invalid',issues:[error.message]});
    rows.sort((a,b)=>a.row-b.row);
    const counts={total:rows.length,ready:0,'already-received':0,duplicate:0,conflict:0,invalid:0};
    rows.forEach(row=>counts[row.status]++);
    const document={version:VERSION,pack_id:source.pack_id,source_id:source.id,source_sha256:source.body_sha256,
      source_bytes:source.bytes,source_name:source.name,provider:source.provider,account_key:source.account_key,
      mapping,mapping_sha256:hash(mapping),columns:parsed.columns,counts,rows,
      review_basis:{existing_records_sha256:hash(root.acquisition_intake_records||[])},
      semantics:mapping.record_kind==='events'?'Original individual events':mapping.record_kind==='counters'?'Aggregate observations; each row retains its original metric, unit and period':'Observed entity records; observation time and original creation time remain distinct'};
    return {...document,preview_sha256:hash(document),source};
  }
  function apply(root,kind,input,at,options={}){
    need(kind==='acquisition-intake-receive','Choose the original intake receive action.');
    const preview=inspect(root,input,at,options);
    need(input.preview_sha256===preview.preview_sha256,'The source, mapping or received records changed. Preview this exact file again.',409);
    need(Array.isArray(input.selected_row_ids)&&new Set(input.selected_row_ids).size===input.selected_row_ids.length,'Select distinct reviewed source rows.');
    const selected=new Set(input.selected_row_ids),ready=new Map(preview.rows.filter(r=>r.status==='ready').map(r=>[r.row_id,r]));
    need([...selected].every(id=>ready.has(id)),'Select only ready rows from the current reconciliation.');
    need(selected.size||input.retain_review_only===true,'Select ready records or explicitly retain this source review only.');
    const source=preview.source,batchIdentity={source_id:source.id,mapping_sha256:preview.mapping_sha256,
      selected_row_ids:[...selected].sort(),preview_sha256:preview.preview_sha256};
    const batchId='acquisition-intake:'+hash(batchIdentity);
    const previous=(root.acquisition_intake_batches||[]).find(r=>r.id===batchId);
    if(previous)return {pack_id:source.pack_id,batch_id:previous.id,record_ids:previous.record_ids,received:0,replayed:true};
    for(const key of FIELDS)root[key]??=[];
    if(!root.acquisition_intake_sources.some(r=>r.id===source.id))root.acquisition_intake_sources.push(source);
    const records=[...selected].map(id=>{
      const row=ready.get(id);
      return signed({version:RECORD,id:row.record_id,pack_id:source.pack_id,source_id:source.id,
        source_row:row.row,source_record_sha256:row.source_record_sha256,mapping_sha256:preview.mapping_sha256,
        record_kind:preview.mapping.record_kind,identity:row.identity,values:row.values,
        values_sha256:row.values_sha256,received_at:instant(at,'Receiving time')});
    });
    root.acquisition_intake_records.push(...records);
    const {source:_,...report}=preview;
    const batch=signed({version:BATCH,id:batchId,pack_id:source.pack_id,source_id:source.id,
      received_at:instant(at,'Receiving time'),mapping:preview.mapping,mapping_sha256:preview.mapping_sha256,
      record_ids:records.map(x=>x.id),selected_row_ids:[...selected].sort(),report,
      outcome:options.receiveRecords?'received-by-acquisition':'original-records-received'});
    root.acquisition_intake_batches.push(batch);
    const result=options.receiveRecords?options.receiveRecords(root,{source:clone(source),batch:clone(batch),records:clone(records)},at):null;
    need(!result||typeof result.then!=='function','Acquisition receiving must complete inside the current transaction.');
    validate(root);
    return {pack_id:source.pack_id,batch_id:batch.id,source_id:source.id,record_ids:batch.record_ids,
      received:records.length,counts:preview.counts,...(result?{acquisition:result}:{})};
  }
  function forPack(root,packId){
    return Object.fromEntries(FIELDS.filter(k=>root[k]!==undefined).map(k=>[k,clone(root[k].filter(x=>x.pack_id===packId))]));
  }
  function merge(root,bundle,report){
    for(const key of FIELDS)for(const incoming of bundle[key]||[]){
      need(incoming.pack_id===bundle.pack.id,'An intake source belongs to another customer pack.');
      root[key]??=[];const current=root[key].find(r=>r.id===incoming.id);
      report.added[key]??=0;
      if(!current){root[key].push(clone(incoming));report.added[key]++;report.records.push({entity:key,id:incoming.id,name:incoming.id,action:'add'});}
      else if(hash(current)!==hash(incoming))report.conflicts.push({entity:key,id:incoming.id,reason:'The same original intake ID has different retained content.'});
      else{report.unchanged++;report.records.push({entity:key,id:incoming.id,name:incoming.id,action:'unchanged'});}
    }
  }
  function view(root,packId){
    const value=forPack(root,packId);
    return {sources:(value.acquisition_intake_sources||[]).map(({body,...s})=>s),
      batches:value.acquisition_intake_batches||[],records:value.acquisition_intake_records||[],
      counts:{sources:(value.acquisition_intake_sources||[]).length,batches:(value.acquisition_intake_batches||[]).length,
        events:(value.acquisition_intake_records||[]).filter(x=>x.record_kind==='events').length,
        counter_observations:(value.acquisition_intake_records||[]).filter(x=>x.record_kind==='counters').length,
        entity_observations:(value.acquisition_intake_records||[]).filter(x=>x.record_kind==='entities').length}};
  }
  function reportCSV(preview){
    const columns=['source_row','status','record_id','provider_key','normalized_values','issues'];
    return [columns.map(csvCell).join(','),...preview.rows.map(r=>[r.row,r.status,r.record_id,
      r.identity?.provider_key,r.values,r.issues.join(' | ')].map(csvCell).join(','))].join('\r\n')+'\r\n';
  }
  return {FIELDS,VERSION,MAPPING,inspect,apply,validate,forPack,merge,view,reportCSV,normalizedMapping,parseCSV};
}

/** Receive complete original files through the maintained creator programme engine. */
function createCreatorProgrammeIntake({engine,hash,hashText}){
  need(engine&&['validate','apply','state','report','parseSource'].every(k=>typeof engine[k]==='function'),
    'Use the actual maintained creator programme engine.');
  need(typeof hash==='function'&&typeof hashText==='function','Use the maintained source hash functions.');
  const schema='dealscout.creator-source-intake-preview.v1';
  const semantic=e=>Object.fromEntries(Object.entries(e).filter(([k])=>!['original','position'].includes(k)));
  function programme(ledger,id){const root=engine.validate(ledger),p=root.programmes.find(x=>x.id===id);
    need(p,'Choose an existing creator programme.',404);return {root,p};}
  function rows(document){
    if(document.format==='csv'){
      // Match the maintained creator csv() tokenization. Its explicit delimiter
      // accepts every single character except quote/CR/LF and retains empty records.
      const text=document.content,delimiter=document.delimiter;
      need(typeof delimiter==='string'&&delimiter.length===1&&!['"','\r','\n'].includes(delimiter),
        'Choose one explicit CSV delimiter.');
      const out=[];let row=[],field='',quoted=false,closed=false,line=1,startLine=1;
      for(let i=0;i<text.length;i++){
        const c=text[i];
        if(quoted){
          if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}
          else{field+=c;if(c==='\n'||c==='\r'&&text[i+1]!=='\n')line++;}
          continue;
        }
        if(c==='"'){need(field===''&&!closed,'A CSV quote starts inside an unquoted field.');quoted=true;continue;}
        if(c===delimiter){row.push(field);field='';closed=false;continue;}
        if(c==='\r'||c==='\n'){
          row.push(field);out.push({values:row,line:startLine});row=[];field='';closed=false;
          line++;startLine=line;if(c==='\r'&&text[i+1]==='\n')i++;continue;
        }
        need(!closed,'Characters follow a closed CSV field.');field+=c;
      }
      need(!quoted,'The CSV source ends inside a quoted field.');
      if(field!==''||row.length||closed){row.push(field);out.push({values:row,line:startLine});}
      need(out.length>0,'The CSV source has no header.');
      const header=out.shift().values;header[0]=header[0].replace(/^\uFEFF/,'');
      need(header.every(x=>x!==''&&typeof x==='string')&&new Set(header).size===header.length,
        'Use unique nonempty CSV column headings.');
      return out.map((r,i)=>r.values.length===header.length?
        {position:i+2,line:r.line,original:Object.fromEntries(header.map((h,j)=>[h,r.values[j]]))}:
        {position:i+2,line:r.line,original:r.values,
          parse_issue:'CSV parsed record '+(i+2)+' differs from its header width.'});
    }
    need(document.format==='json','Use the creator engine’s original CSV or JSON format.');
    const data=parseJSON(document.content,'Original creator source');
    need(Array.isArray(data),'The creator source requires the original JSON array.');
    return data.map((original,i)=>({position:i+1,line:null,original}));
  }
  function inspect(ledger,input,at=new Date().toISOString()){
    need(plain(input)&&plain(input.document),'Supply the complete original creator source.');
    const {root,p}=programme(ledger,input.programme_id),d=clone(input.document);
    need(d.record_kind===undefined||d.record_kind==='events',
      'This creator source accepts individual events. Keep aggregate counters in their original observation workflow.');
    need(d.sha256===hashText(d.content),'The original creator export bytes changed.');
    const old=p.sources.find(s=>s.id===input.id);
    need((old?.revision||0)===input.expected_revision,'The original source revision changed.',409);
    const parsed=rows(d),review=[],existing=new Map(),seen=new Map();
    need(parsed.length<=100000,'Select at most100,000 complete events per source edition.');
    // Replacing one source reviews the new complete edition against every other current included source.
    for(const source of p.sources.filter(s=>s.id!==input.id&&s.document.state==='included')){
      for(const event of engine.parseSource(source.document,p)){
        const entry={source_id:source.id,source_revision:source.revision,source_sha256:source.document.sha256,
          position:event.position,semantic_sha256:hash(semantic(event))};
        const current=existing.get(event.id)||[];current.push(entry);existing.set(event.id,current);
      }
    }
    for(const row of parsed){
      const result={position:row.position,source_line:row.line,status:'invalid',issues:[],original:clone(row.original)};
      try{
        if(row.parse_issue)throw Error(row.parse_issue);
        // The canonical parser validates this unchanged original object with its actual field map.
        const one=engine.parseSource({...d,format:'json',content:JSON.stringify([row.original])},p)[0];
        const event={...one,position:row.position},value=semantic(event),checksum=hash(value);
        const others=existing.get(event.id)||[],prior=seen.get(event.id)||[];
        Object.assign(result,{event_id:event.id,event,semantic_sha256:checksum,existing_references:others});
        if(others.some(x=>x.semantic_sha256!==checksum)||prior.some(x=>x.semantic_sha256!==checksum)){
          result.status='conflict';result.issues.push('The same native event ID has different original values. The maintained programme report excludes the conflicting event identity.');
          for(const previous of prior){previous.status='conflict';previous.issues.push('Another original source row has different values for this event ID.');}
        }else if(others.length)result.status='already-received';
        else if(prior.length)result.status='duplicate';
        else result.status='ready';
        prior.push(result);seen.set(event.id,prior);
        if(Date.parse(event.occurred_at)>Date.parse(d.observed_at)){
          result.issues.push('Event time follows this export’s observation time; the native programme report excludes it.');
        }
      }catch(error){result.issues.push(error.message);}
      review.push(result);
    }
    const counts={total:review.length,ready:0,'already-received':0,duplicate:0,conflict:0,invalid:0};
    review.forEach(row=>counts[row.status]++);
    let candidate=null,validationError=null;
    if(counts.invalid===0){
      try{
        const operation={kind:'source-save',operation_id:'source-intake-preview:'+hash({input,root_sha256:hash(root)}),
          expected_root_sha256:hash(root),input:clone(input)};
        const applied=engine.apply(ledger,operation,at);
        candidate=engine.state(applied.ledger,p.id).selected;
      }catch(error){validationError=error.message;}
    }
    const currentReport=engine.report(p);
    const document={schema,programme_id:p.id,pack_id:p.pack_id,source_id:input.id,
      expected_revision:input.expected_revision,expected_root_sha256:hash(root),source_sha256:d.sha256,
      source_document_sha256:hash(d),input_sha256:hash(input),rows:review,counts,
      can_save:Boolean(candidate),validation_error:validationError,
      current_report_sha256:currentReport.sha256,
      proposed_report:candidate?.report||null,
      interpretation:'The complete original source becomes one native source revision. Exact duplicates retain all original references and count once. Conflicting identities remain visible in the programme findings and are excluded by its current engine.'};
    return {...document,preview_sha256:hash(document)};
  }
  function prepare(ledger,{input,preview_sha256,operation_id},at=new Date().toISOString()){
    const current=inspect(ledger,input,at);
    need(current.preview_sha256===preview_sha256,'The original source, mapping or programme changed. Review the current complete file again.',409);
    need(current.can_save,current.validation_error||'Correct the invalid original source mapping before receiving it.',422,{rows:current.rows.filter(x=>x.status==='invalid')});
    need(typeof operation_id==='string'&&operation_id,'Retain one original receiving operation ID.');
    return {kind:'source-save',operation_id,expected_root_sha256:current.expected_root_sha256,input:clone(input)};
  }
  function apply(ledger,body,at=new Date().toISOString()){
    // Reuse the exact prepared source-save request, so original engine replay runs before revision checks.
    need(body?.kind==='source-save','Receive the exact prepared original source-save operation.');
    return engine.apply(ledger,body,at);
  }
  function reportCSV(preview){
    return [['position','source_line','status','native_event_id','mapped_event','issues'],
      ...preview.rows.map(r=>[r.position,r.source_line,r.status,r.event_id,r.event,r.issues.join(' | ')])]
      .map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  return Object.freeze({schema,inspect,prepare,apply,reportCSV});
}

module.exports={createLeadAcquisitionIntake,createCreatorProgrammeIntake,FIELDS,VERSION,MAPPING};
