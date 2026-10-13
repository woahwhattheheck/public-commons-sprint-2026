import {clone,validatePlan,civil} from './implementation_core.mjs';
import {evidenceSha256,evidenceSafeBasename} from './implementation_evidence.mjs';

export const SITE_VISIT_MAPPING_SCHEMA='upstate.implementation-site-visit-mapping/v1';
export const SITE_VISIT_EDITION='site-visit-portable-intake-20261013-v1';
export const SITE_VISIT_FIELDS=Object.freeze({
 sites:['id','label','candidate_id','source_ref','latitude','longitude','coordinate_reference_system','notes'],
 visits:['id','site_id','monitoring_plan_id','planned_date','visited_at','visited_date','visited_time','utc_offset','observer','status','notes']
});
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const encodings=['utf-8-sig','utf-8','utf-16','cp1252','latin-1'];
const defined=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function stableSiteVisitJSON(value){
 const compare=(left,right)=>{const a=Array.from(left),b=Array.from(right);for(let i=0;i<Math.min(a.length,b.length);i++){const d=a[i].codePointAt(0)-b[i].codePointAt(0);if(d)return d;}return a.length-b.length;};
 const encode=v=>Array.isArray(v)?'['+v.map(x=>x===undefined?'null':encode(x)).join(',')+']':plain(v)?'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort(compare).map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}':JSON.stringify(v);
 return encode(value);
}
const utf8=value=>new TextEncoder().encode(value);
const hashJSON=async value=>evidenceSha256(utf8(stableSiteVisitJSON(value)));
const nonblank=value=>typeof value==='string'&&value.trim()!=='';
function fail(message){throw Error(message);}
function bytesOf(value){if(value instanceof Uint8Array)return value;if(value instanceof ArrayBuffer)return new Uint8Array(value);fail('Use original CSV bytes.');}
export function decodeSiteVisitCSV(value,encoding='utf-8-sig'){
 const bytes=bytesOf(value);if(bytes.length>64*1024*1024)fail('Keep each original CSV within 64 MiB.');
 if(!encodings.includes(encoding))fail('Choose a supported original CSV encoding.');
 if(encoding==='latin-1'){let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));if(out.includes('\0'))fail('The original CSV contains a NUL character.');return out;}
 if(encoding==='utf-16'){
  if(bytes.length<2||!((bytes[0]===255&&bytes[1]===254)||(bytes[0]===254&&bytes[1]===255)))fail('The original UTF-16 CSV needs its byte-order mark.');
  const text=new TextDecoder(bytes[0]===255?'utf-16le':'utf-16be',{fatal:true}).decode(bytes);if(text.includes('\0'))fail('The original CSV contains a NUL character.');return text;
 }
 if(encoding==='cp1252'&&bytes.some(x=>[129,141,143,144,157].includes(x)))fail('The selected Windows-1252 source contains undefined byte values.');
 const text=new TextDecoder(encoding==='cp1252'?'windows-1252':'utf-8',{fatal:true,ignoreBOM:encoding==='utf-8'}).decode(bytes);
 if(text.includes('\0'))fail('The original CSV contains a NUL character.');
 return encoding==='utf-8-sig'?text.replace(/^\uFEFF/,''):text;
}
export function parseSiteVisitCSV(text,delimiter=','){
 if(typeof text!=='string'||typeof delimiter!=='string'||delimiter.length!==1||['"','\r','\n','\0'].includes(delimiter))fail('Choose one actual CSV delimiter.');
 const records=[];let cells=[],cell='',quoted=false,closed=false,line=1,start=1,touched=false;
 const endCell=()=>{cells.push(cell);cell='';closed=false;};
 const endRow=()=>{if(touched||cells.length||cell!==''){endCell();records.push({cells,line_start:start,line_end:line});}cells=[];cell='';closed=false;touched=false;};
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
   else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n'){cell+='\r\n';i++;}else cell+=ch;line++;}
   else cell+=ch;
   continue;
  }
  if(ch===delimiter){endCell();touched=true;continue;}
  if(ch==='\r'||ch==='\n'){endRow();if(ch==='\r'&&text[i+1]==='\n')i++;line++;start=line;continue;}
  if(closed)fail('Unexpected text after a closing CSV quote at line '+line+'.');
  if(ch==='"'){if(cell!==''){cell+=ch;touched=true;continue;}quoted=true;touched=true;continue;}
  cell+=ch;touched=true;
 }
 if(quoted)fail('The original CSV has an unclosed quoted field beginning near line '+start+'.');
 endRow();if(!records.length)fail('The CSV needs its original header row.');
 const headers=records.shift().cells;
 if(headers.some(h=>!h.trim())||new Set(headers).size!==headers.length)fail('Original CSV headers must be nonblank and unique.');
 if(headers.length>1000)fail('Use a CSV within 1,000 original columns.');
 if(records.length>100000)fail('Use a reviewed batch within 100,000 original data records.');
 return {headers,rows:records.map((r,i)=>({record:i+1,line_start:r.line_start,line_end:r.line_end,cell_count:r.cells.length,extra_cells:r.cells.slice(headers.length),values:Object.fromEntries(headers.map((h,j)=>[h,r.cells[j]??'']))}))};
}
export async function inspectPortableSiteVisitCSV(bytes,{delimiter=',',encoding='utf-8-sig',filename='original.csv'}={}){
 bytes=bytesOf(bytes);const parsed=parseSiteVisitCSV(decodeSiteVisitCSV(bytes,encoding),delimiter);
 return {source:{filename,bytes:bytes.length,sha256:await evidenceSha256(bytes)},headers:parsed.headers,row_count:parsed.rows.length,sample_rows:parsed.rows.slice(0,25),sample_rows_truncated:parsed.rows.length>25};
}
export function blankSiteVisitMapping(kind){
 if(!SITE_VISIT_FIELDS[kind])fail('Choose sites or visits.');
 return {schema:SITE_VISIT_MAPPING_SCHEMA,columns:{},constants:{},fallback_columns:{},delimiter:',',encoding:'utf-8-sig',decimal_separator:'.',id_mode:'native',namespace:'',coordinate_mode:'retain_only',crs_values:{},date_format:'iso',time_zone_values:{},status_values:{},site_binding:'native_id',row_actions:{}};
}
export function normalizeSiteVisitMapping(kind,value,headers,count=Infinity){
 if(!plain(value))fail('Supply an explicit original site/visit mapping.');
 const defaults=blankSiteVisitMapping(kind);
 if(Object.keys(value).some(k=>!defined(defaults,k))||value.schema!==undefined&&value.schema!==SITE_VISIT_MAPPING_SCHEMA)fail('The mapping schema or fields differ from the original site/visit contract.');
 const result={...defaults,...clone(value),columns:{},constants:{},fallback_columns:{},row_actions:{}},fields=SITE_VISIT_FIELDS[kind];
 for(const name of ['columns','constants','fallback_columns','crs_values','time_zone_values','status_values','row_actions'])if(!plain(value[name]??{}))fail(name+' must be an explicit mapping object.');
 for(const [field,header] of Object.entries(value.columns||{})){
  if(!fields.includes(field))fail('Unknown '+kind+' field '+field+'.');
  if(header===''||header===null)continue;
  if(typeof header!=='string'||!headers.includes(header))fail('Mapped '+field+' must name one actual original header.');result.columns[field]=header;
 }
 for(const [field,text] of Object.entries(value.constants||{})){
  if(!fields.includes(field)||field==='id'||typeof text!=='string'||text.includes('\0')||defined(result.columns,field))fail('Choose one original column or non-ID text constant for '+field+'.');result.constants[field]=text;
 }
 for(const [field,list] of Object.entries(value.fallback_columns||{})){
  if(!defined(result.columns,field)||defined(result.constants,field)||!Array.isArray(list)||list.some(h=>typeof h!=='string'||!headers.includes(h))||new Set(list).size!==list.length||list.includes(result.columns[field]))fail('Fallback '+field+' must list distinct original headers after its mapped primary column.');
  if(list.length)result.fallback_columns[field]=clone(list);
 }
 if(!['native','stable','source_record'].includes(result.id_mode)||result.id_mode!=='native'&&!nonblank(result.namespace))fail('Stable or source-record IDs require a declared namespace.');
 if(typeof result.namespace!=='string'||result.namespace.includes('\0'))fail('Use the original source namespace as text.');
 if(result.id_mode!=='source_record'&&!defined(result.columns,'id'))fail('Map the original ID, or explicitly choose IDs from exact source records.');
 if(!['geographic','retain_only'].includes(result.coordinate_mode)||!['iso','mdy','dmy'].includes(result.date_format)||!['native_id','source_id'].includes(result.site_binding)||!['.',','].includes(result.decimal_separator))fail('Choose the declared coordinate, calendar, site-ID and decimal conventions.');
 for(const [name,allowed] of [['crs_values',['EPSG:4326','EPSG:4269','EPSG:4267','EPSG:4258']],['status_values',['planned','complete','cancelled']]])if(Object.values(result[name]).some(v=>!allowed.includes(v)))fail('Choose explicit supported '+name+' aliases.');
 for(const [name,value] of Object.entries(result.time_zone_values)){if(typeof value!=='string'||value!==value.trim())fail('A fixed-offset alias must use its exact explicit offset.');result.time_zone_values[name]=offsetCell(value,{});}
 if(!encodings.includes(result.encoding))fail('Choose a supported CSV encoding.');
 if(typeof result.delimiter!=='string'||result.delimiter.length!==1||['"','\r','\n','\0'].includes(result.delimiter))fail('Use a single actual delimiter.');
 for(const [key,raw] of Object.entries(value.row_actions||{})){
  if(!/^[1-9][0-9]*$/.test(key)||Number(key)>count||!plain(raw)||Object.keys(raw).some(k=>!['action','reason','id','target_id','site_id'].includes(k)))fail('Each row decision must identify an original data record.');
  const row={action:raw.action??'import',reason:raw.reason??''},overrides=['id','target_id','site_id'].filter(k=>defined(raw,k));
  if(!['import','skip','replace'].includes(row.action)||typeof row.reason!=='string'||(row.action!=='import'||overrides.length)&&!row.reason.trim())fail('An explicit row override, skip or replacement needs its reason.');
  for(const field of overrides){if(typeof raw[field]!=='string'||!ID.test(raw[field])||field==='site_id'&&kind!=='visits')fail('Select an exact valid native '+field+'.');row[field]=raw[field];}
  if(row.action==='replace'&&!defined(row,'target_id')||row.action!=='replace'&&defined(row,'target_id')||row.action==='replace'&&defined(row,'id')&&row.id!==row.target_id)fail('An explicit replacement needs one matching original target ID.');
  result.row_actions[key]=row;
 }
 return result;
}
function selectedCell(mapping,source,field,selected){
 const header=mapping.columns[field];let value=header===undefined?undefined:source.values[header];
 if(header!==undefined)selected[field]={column:header};
 if(!nonblank(value))for(const fallback of mapping.fallback_columns[field]||[])if(nonblank(source.values[fallback])){value=source.values[fallback];selected[field]={column:fallback};break;}
 if(!nonblank(value)&&defined(mapping.constants,field)){value=mapping.constants[field];selected[field]={constant:value};}
 return value;
}
function numberCell(value,decimal){
 if(!nonblank(value))return null;const text=value.trim();
 if(decimal===','&&text.includes('.')||decimal==='.'&&text.includes(','))fail('Use the declared decimal separator without thousands separators.');
 const normalized=decimal===','?text.replace(',','.'):text;
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)||!Number.isFinite(Number(normalized)))fail('Use an actual finite coordinate value.');
 return Number(normalized);
}
function dateCell(value,format){
 if(!nonblank(value))return null;const text=value.trim();let iso=text;
 if(format!=='iso'){const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);if(!m)fail('Use the declared slash-separated date with a four-digit year.');iso=m[3]+'-'+String(format==='mdy'?m[1]:m[2]).padStart(2,'0')+'-'+String(format==='mdy'?m[2]:m[1]).padStart(2,'0');}
 civil(iso);return iso;
}
function offsetCell(value,aliases){
 if(typeof value!=='string')fail('Select an explicit UTC offset.');
 const text=aliases[value]??value.trim();
 if(text==='Z')return 'Z';
 if(!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(text)||text.slice(1,3)==='14'&&text.slice(4)!=='00')fail('Supply an explicit UTC offset Z or ±HH:MM within 14 hours.');
 return text;
}
function timestampCell(value){
 const text=value.trim(),m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/.exec(text);
 if(!m)fail('An actual visit timestamp needs an ISO date, time and explicit timezone offset.');
 civil(m[1]);if(Number(m[2])>23||Number(m[3])>59||Number(m[4]||0)>59)fail('Actual visit time is outside its clock range.');offsetCell(m[6],{});return text;
}
function visitTime(values,mapping){
 const full=(values.visited_at||'').trim(),day=(values.visited_date||'').trim(),clock=(values.visited_time||'').trim(),rawOffset=values.utc_offset||'';
 const declaredOffset=mapping.time_zone_values[rawOffset]??rawOffset.trim(),offset=declaredOffset?offsetCell(declaredOffset,{}):null;
 let value;
 if(full){
  if(day||clock)fail('Choose full visited_at or separate original date/time fields, not both.');
  value=full;
  if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value))fail('The original actual timestamp is not an ISO date/time.');
   if(!offset)return undefined;value+=offset;
  }
 }else if(day||clock){
  if(day)dateCell(day,mapping.date_format);
  if(!day||!clock||!offset)return undefined;
  value=dateCell(day,mapping.date_format)+'T'+clock+offset;
 }else return null;
 const result=timestampCell(value);
 if(offset){
  const actual=result.endsWith('Z')?'Z':result.slice(-6),minutes=v=>v==='Z'?0:(v[0]==='-'?-1:1)*(Number(v.slice(1,3))*60+Number(v.slice(4)));
  if(minutes(actual)!==minutes(offset))fail('The timestamp and separate original UTC offset disagree.');
 }
 return result;
}

function sourceLink(plan,kind,source,mappingHash,sourceId){
 return {id:sourceId,kind:'local_file',label:'Original '+kind+' CSV — '+source.filename,reference:'implementation/plans/'+plan.id+'/attachments/'+source.sha256+'-'+kind+'-original.csv',sha256:source.sha256,size_bytes:source.bytes,original_filename:source.filename};
}
function recordIssue(severity,code,message,kind,record){return {severity,code,message,kind,record:record.record,line_start:record.line_start,line_end:record.line_end};}
function plainRowSource(row){const copy=clone(row);delete copy.original_source;delete copy.original_station;delete copy.original_visit;return copy;}
export async function previewPortableSiteVisits(plan,inputs){
 const originalIssues=validatePlan(plan);if(originalIssues.length)fail('Open a valid original plan before importing.\n'+originalIssues.map(x=>x.path+': '+x.message).join('\n'));
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>2||new Set(inputs.map(x=>x.kind)).size!==inputs.length||inputs.some(x=>!SITE_VISIT_FIELDS[x.kind]))fail('Choose one original sites CSV, visits CSV or both.');
 const original=clone(plan),candidate=clone(plan),sources=[],mappings={},decisions=[],issues=[],siteSources=new Map(),seenBatch={sites:new Set(),visits:new Set()};
 const addSite=(id,native)=>{if(!siteSources.has(id))siteSources.set(id,new Set());siteSources.get(id).add(native);};
 for(const row of candidate.sites)if(nonblank(row.original_source?.original_identifier))addSite(row.original_source.original_identifier,row.id);
 const summary={record_count:0,source_count:inputs.length,sites:{append:0,replace:0,identical:0,skip:0,error:0},visits:{append:0,replace:0,identical:0,skip:0,error:0},error_count:0,warning_count:0,site_count_before:plan.sites.length,site_count_after:plan.sites.length,visit_count_before:plan.visits.length,visit_count_after:plan.visits.length};
 const retained=[],sourceRows=[];
 for(const input of [...inputs].sort((a,b)=>a.kind==='sites'?-1:b.kind==='sites'?1:0)){
  const kind=input.kind,raw=bytesOf(input.bytes),mappingInput=input.mapping||blankSiteVisitMapping(kind),parsed=parseSiteVisitCSV(decodeSiteVisitCSV(raw,mappingInput.encoding||'utf-8-sig'),mappingInput.delimiter||','),mapping=normalizeSiteVisitMapping(kind,mappingInput,parsed.headers,parsed.rows.length);
  const source={filename:input.filename||kind+'-original.csv',bytes:raw.length,sha256:await evidenceSha256(raw)};
  if(!source.filename||/[\\/\0]/.test(source.filename)||source.filename.length>1024)fail('Use the original ordinary CSV filename.');
  const mappingHash=await hashJSON(mapping),sourceId='field_csv_'+(await hashJSON([plan.id,kind,source.sha256,mapping])).slice(0,24),link=sourceLink(plan,kind,source,mappingHash,sourceId);
  const priorLink=candidate.source_links.find(x=>x.id===sourceId);
  if(priorLink&&stableSiteVisitJSON(priorLink)!==stableSiteVisitJSON(link))fail('An original CSV source ID has different retained metadata.');
  if(!priorLink)candidate.source_links.push(link);
  sources.push({kind,source,headers:parsed.headers,source_link_id:sourceId});mappings[kind]=mapping;retained.push({kind,bytes:raw,link});sourceRows.push({kind,source,headers:clone(parsed.headers),rows:clone(parsed.rows)});
  if(!parsed.rows.length)issues.push({severity:'error',code:'empty_source',message:'The '+kind+' CSV contains no data records.',kind});
  for(const key of Object.keys(mapping.row_actions))if(Number(key)>parsed.rows.length)issues.push({severity:'error',code:'unknown_record',message:'Row choice '+key+' is not in the original '+kind+' CSV.',kind,record:Number(key)});
  for(const record of parsed.rows){
   const choice=mapping.row_actions[String(record.record)],selected={},local=[],values={},decision={kind,record:record.record,line_start:record.line_start,line_end:record.line_end,status:'error',native_id:null,original_identifier:null,row:null,selected_columns:selected,issues:local};
   summary.record_count++;
   try{
    for(const field of SITE_VISIT_FIELDS[kind])values[field]=selectedCell(mapping,record,field,selected);
    decision.original_identifier=values.id??'';decision.action=clone(choice||{action:'import',reason:''});
    if(choice?.action==='skip'){decision.status='skip';decisions.push(decision);summary[kind].skip++;continue;}
    if(record.cell_count!==parsed.headers.length)fail('The record has '+record.cell_count+' cells; its original header has '+parsed.headers.length+'.');
    const originalId=values.id;decision.original_identifier=originalId??'';
    let id;
    if(choice?.id)id=choice.id;
    else if(choice?.action==='replace'&&choice.target_id)id=choice.target_id;
    else if(mapping.id_mode==='source_record')id=(kind==='sites'?'site_':'visit_')+(await hashJSON([kind,mapping.namespace,source.sha256,record.record])).slice(0,24);
    else{
     if(!nonblank(originalId))fail('Map the actual original ID or choose IDs from this exact source row.');
     id=mapping.id_mode==='stable'?(kind==='sites'?'site_':'visit_')+(await hashJSON([kind,mapping.namespace,originalId])).slice(0,24):originalId;
    }
    if(!ID.test(id))fail('The selected native ID must contain 1–96 letters, digits, underscores or hyphens and begin with a letter or digit.');
    decision.native_id=id;
    const existing=original[kind].find(row=>row.id===id),earlier=candidate[kind].find(row=>row.id===id);
    if(choice?.action==='replace'&&!existing)fail('The explicitly selected replacement ID is not in the current plan.');
    if(choice?.target_id&&choice.action!=='replace')fail('A target replacement ID requires the explicit Replace action.');
    const row=existing?clone(existing):kind==='sites'?{id,label:'',latitude:null,longitude:null,notes:''}:{id,site_id:'',observer:'',notes:'',evidence_refs:[],status:''};
    const touched=new Set(['id']);row.id=id;
    const set=(field,value)=>{row[field]=value;touched.add(field);};
    if(kind==='sites'){
     for(const field of ['label','notes'])if(values[field]!==undefined)set(field,values[field]);
     for(const field of ['candidate_id','source_ref'])if(values[field]!==undefined)set(field,values[field]||null);
     if(!existing&&!defined(selected,'source_ref'))set('source_ref',sourceId);
     if(!nonblank(row.label))fail('Every new site needs its actual label.');
     if(mapping.coordinate_mode==='geographic'){
      const latSupplied=values.latitude!==undefined,lonSupplied=values.longitude!==undefined;
      if(values.coordinate_reference_system!==undefined&&(!latSupplied||!lonSupplied))fail('Map the original latitude and longitude together with their CRS.');
      if(latSupplied!==lonSupplied)fail('Map both original latitude and longitude together.');
      if(latSupplied){
       const lat=numberCell(values.latitude,mapping.decimal_separator),lon=numberCell(values.longitude,mapping.decimal_separator);
       if((lat===null)!==(lon===null))fail('Supply latitude and longitude together.');
       if(lat!==null&&(lat< -90||lat>90||lon< -180||lon>180))fail('Geographic source coordinates are outside the native degree ranges.');
       if(lat!==null){
        const declared=values.coordinate_reference_system,crs=mapping.crs_values[declared]??(typeof declared==='string'?declared.trim():'');
        if(!['EPSG:4326','EPSG:4269','EPSG:4267','EPSG:4258'].includes(crs))fail('Declare the original geographic CRS or choose Retain source coordinates only. No datum is inferred or transformed.');
        set('coordinate_reference_system',crs);
       }else{delete row.coordinate_reference_system;touched.add('coordinate_reference_system');local.push(recordIssue('warning','missing_coordinates','Both original coordinates are blank.',kind,record));}
       set('latitude',lat);set('longitude',lon);
      }else if(values.coordinate_reference_system!==undefined&&nonblank(values.coordinate_reference_system)&&row.latitude!==null&&row.latitude!==undefined){
       const declared=values.coordinate_reference_system,crs=mapping.crs_values[declared]??mapping.crs_values[declared.trim()]??declared.trim();
       if(crs!==row.coordinate_reference_system)fail('A changed CRS needs the paired original source coordinates; it cannot relabel existing coordinates.');
      }
     }else if(nonblank(values.latitude)||nonblank(values.longitude))local.push(recordIssue('warning','coordinates_retained_only','Source coordinate cells remain in the original row; native coordinates are not assigned or changed.',kind,record));
    }else{
     const selectedSite=choice?.site_id||values.site_id;
     if(choice?.site_id||mapping.site_binding==='native_id'){
      if(selectedSite!==undefined)set('site_id',selectedSite);
     }else if(selectedSite!==undefined||!existing){
      if(!nonblank(selectedSite))fail('Map the exact original source site identifier.');
      const candidates=[...(siteSources.get(selectedSite)||[])];if(candidates.length!==1)fail(candidates.length?'The original source site identifier is ambiguous. Choose its exact native site ID.':'No accepted site matches the original source site identifier. Include its sites CSV or choose an existing native site ID.');
      set('site_id',candidates[0]);
     }
     if(!ID.test(row.site_id)||!candidate.sites.some(x=>x.id===row.site_id))fail('The visit needs one actual site in this reviewed plan.');
     for(const field of ['observer','notes'])if(values[field]!==undefined)set(field,values[field]);
     if(values.monitoring_plan_id!==undefined)set('monitoring_plan_id',values.monitoring_plan_id||null);
     if(values.planned_date!==undefined)set('planned_date',dateCell(values.planned_date,mapping.date_format));
     if(values.status!==undefined){
      const rawStatus=values.status,tag=mapping.status_values[rawStatus]??rawStatus.trim();
      if(!['planned','complete','cancelled'].includes(tag))fail('Map the actual visit status or enter an explicit planned, complete or cancelled constant.');
      set('status',tag);
     }
     const hasTime=['visited_at','visited_date','visited_time','utc_offset'].some(field=>values[field]!==undefined),visited=hasTime?visitTime(values,mapping):undefined;
     if(hasTime)set('visited_at',visited??null);
     if(hasTime&&visited===undefined)local.push(recordIssue('warning','partial_actual_time','Incomplete actual date/time context stays in the original source. No collection time or timezone is invented.',kind,record));
     if(!['planned','complete','cancelled'].includes(row.status))fail('Select the actual visit status explicitly.');
     if(row.status==='complete'&&!row.visited_at)fail('A completed visit needs its actual timestamp with timezone.');
    }
    const definition=plainRowSource(row),originalDefinition=existing?plainRowSource(existing):null;
    if(seenBatch[kind].has(id)&&stableSiteVisitJSON(plainRowSource(earlier))!==stableSiteVisitJSON(definition))fail('Another source record already selects this native ID with different values. Skip one row or explicitly assign a different ID.');
    if(seenBatch[kind].has(id)||existing&&stableSiteVisitJSON(originalDefinition)===stableSiteVisitJSON(definition)){decision.status='identical';if(seenBatch[kind].has(id))local.push(recordIssue('warning','duplicate_identical','This original record repeats identical selected values; both source rows remain in the audit.',kind,record));}
    else if(existing&&choice?.action!=='replace'){decision.row=clone(row);fail('This native ID already exists with different mapped values. Review and explicitly replace it, keep it by skipping this row, or assign a new ID.');}
    else decision.status=existing?'replace':'append';
    if(decision.status!=='identical'){
     row.original_source={schema:'upstate.implementation-field-csv-row/v1',source_link_id:sourceId,csv_sha256:source.sha256,mapping_sha256:mappingHash,namespace:mapping.namespace,kind,record:record.record,line_start:record.line_start,line_end:record.line_end,original_headers:clone(parsed.headers),original_row:clone(record.values),cell_count:record.cell_count,extra_cells:clone(record.extra_cells),original_identifier:originalId??'',selected_columns:clone(selected),...(choice?{decision:clone(choice)}:{})};
     row[kind==='sites'?'original_station':'original_visit']=clone(record.values);
     if(kind==='sites')Object.assign(row.original_source,{original_latitude:values.latitude||'',original_longitude:values.longitude||'',original_coordinate_reference_system:values.coordinate_reference_system||'',coordinate_mode:mapping.coordinate_mode});
     const rowIndex=candidate[kind].findIndex(x=>x.id===id);if(rowIndex<0)candidate[kind].push(row);else candidate[kind][rowIndex]=row;
    }
    decision.row=clone(decision.status==='identical'?(earlier||existing):row);seenBatch[kind].add(id);
    if(kind==='sites'&&nonblank(originalId))addSite(originalId,id);
    summary[kind][decision.status]++;
   }catch(error){decision.status='error';local.push(recordIssue('error','row_review',error.message||String(error),kind,record));summary[kind].error++;}
   issues.push(...local);decisions.push(decision);
  }
 }
 const validation=validatePlan(candidate);for(const error of validation)issues.push({severity:'error',code:'plan_validation',message:error.path+': '+error.message});
 summary.error_count=issues.filter(x=>x.severity==='error').length;summary.warning_count=issues.filter(x=>x.severity==='warning').length;summary.site_count_after=candidate.sites.length;summary.visit_count_after=candidate.visits.length;
 const planHash=await hashJSON(original),identity={edition:SITE_VISIT_EDITION,plan_id:original.id,base_revision:original.revision,base_document_digest:planHash,sources:sources.map(x=>({kind:x.kind,sha256:x.source.sha256})),mappings};
 const operationId=await hashJSON(identity);
 for(const kind of ['sites','visits'])for(const row of candidate[kind])if(row.original_source&&sources.some(x=>x.source_link_id===row.original_source.source_link_id)&&!original[kind].some(x=>x.id===row.id&&stableSiteVisitJSON(x)===stableSiteVisitJSON(row)))row.original_source.operation_id=operationId;
 for(const d of decisions)if(d.row?.original_source&&['append','replace'].includes(d.status))d.row.original_source.operation_id=operationId;
 return {schema:'upstate.implementation-site-visit-preview/v1',edition:SITE_VISIT_EDITION,operation_id:operationId,plan:{id:plan.id,revision:plan.revision,sha256:planHash,title:plan.title},sources,mappings,summary,decisions,issues,can_import:summary.error_count===0,_candidate:candidate,_retained:retained,_sourceRows:sourceRows,_identity:identity};
}
export async function applyPortableSiteVisits(plan,inputs,{expected_operation_id,vault}={}){
 const preview=await previewPortableSiteVisits(plan,inputs);
 if(!preview.can_import)fail('Resolve all original batch errors before applying.');
 if(preview.operation_id!==expected_operation_id)fail('The plan, original CSV or mapping changed. Preview the complete batch again.');
 const next=clone(preview._candidate),history=next.field12_site_visit_imports||[];
 if(!Array.isArray(history))fail('The original site/visit import history must remain a list.');
 const existing=history.find(x=>x.operation_id===preview.operation_id);
 if(existing)fail('This exact portable import is already retained. Reopen its original plan rather than replaying it as another batch.');
 const audit={schema:'upstate.implementation-site-visit-audit/v1',edition:SITE_VISIT_EDITION,operation_id:preview.operation_id,identity:preview._identity,summary:preview.summary,sources:preview._sourceRows,mappings:preview.mappings,decisions:preview.decisions,issues:preview.issues};
 const auditBytes=utf8(JSON.stringify(audit,null,2)+'\n'),auditHash=await evidenceSha256(auditBytes),auditId='field_csv_audit_'+preview.operation_id.slice(0,24);
 if(auditBytes.length>64*1024*1024)fail('The complete decision audit exceeds the original evidence file limit.');
 const auditLink={id:auditId,kind:'local_file',label:'Site and visit CSV review',reference:'implementation/plans/'+plan.id+'/attachments/'+auditHash+'-site-visit-row-decisions.json',sha256:auditHash,size_bytes:auditBytes.length,original_filename:'site-visit-row-decisions.json',media_type:'application/json'};
 if(next.source_links.some(x=>x.id===auditId))fail('The native source register already contains this portable audit identity.');
 next.source_links.push(auditLink);
 next.field12_site_visit_imports=[...history,{operation_id:preview.operation_id,edition:SITE_VISIT_EDITION,base_revision:plan.revision,base_document_digest:preview.plan.sha256,applied_revision:null,portable_draft:true,source_link_ids:preview.sources.map(x=>x.source_link_id),audit_source_link_id:auditId,mapping_sha256:await hashJSON(preview.mappings),source_sha256:Object.fromEntries(preview.sources.map(x=>[x.kind,x.source.sha256]))}];
 const errors=validatePlan(next);if(errors.length)fail('The complete portable plan is invalid.\n'+errors.map(x=>x.path+': '+x.message).join('\n'));
 const planBytes=utf8(JSON.stringify(next));if(planBytes.length>16*1024*1024)fail('The resulting native-compatible plan exceeds 16 MiB; split the source intake into reviewed plans.');
 if(!vault||typeof vault.putMany!=='function')fail('Open the existing original-file vault before applying this batch.');
 const allLocal=next.source_links.filter(x=>x.kind==='local_file'),unique=new Map();
 for(const x of allLocal)unique.set('evidence/'+x.sha256+'/'+evidenceSafeBasename(x.original_filename),x);
 if(allLocal.length>128||[...unique.values()].some(x=>x.size_bytes>64*1024*1024)||[...unique.values()].reduce((a,x)=>a+x.size_bytes,0)>128*1024*1024)fail('The complete original-file package exceeds its retained file/count limits.');
 await vault.putMany([...preview._retained.map(x=>({sha256:x.link.sha256,size_bytes:x.bytes.length,bytes:x.bytes})),{sha256:auditHash,size_bytes:auditBytes.length,bytes:auditBytes}]);
 return {schema:'upstate.implementation-site-visit-import/v1',operation_id:preview.operation_id,status:'portable_draft',plan:next,base_revision:plan.revision,applied_revision:null,current_revision:plan.revision,source_link_ids:Object.fromEntries(preview.sources.map(x=>[x.kind,x.source_link_id])),audit_source_link_id:auditId,summary:preview.summary};
}
