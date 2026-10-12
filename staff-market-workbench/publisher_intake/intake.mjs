// MIT. Publisher survey intake and peer-cohort preparation for the retained salary workbench.
import { createHash } from 'node:crypto';

export const SCHEMA = 'commons.compensation.publisher-intake.v1';
const FIELDS = [
  'survey_job_code','survey_job_title','job_description','scope_cut','industry','geography',
  'size_band','peer_id','currency','pay_period','unit_multiplier','annual_hours','annual_periods',
  'effective_date','p25','p50','p75','organization_count','incumbent_count'
];
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class IntakeError extends Error {
  constructor(code,message,path='') { super(message);this.name='IntakeError';this.code=code;this.path=path; }
}
function fail(code,message,path='') { throw new IntakeError(code,message,path); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const digest = value => createHash('sha256').update(typeof value === 'string'?value:canonical(value)).digest('hex');
const clone = value => structuredClone(value);
function label(value,name,{required=true,max=1000}={}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('FIELD_REQUIRED',name+' is required',name);return '';
  }
  if (typeof value !== 'string' || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))
    fail('INVALID_TEXT','Invalid '+name,name);
  const text=value.trim().normalize('NFC');if (required&&!text) fail('FIELD_REQUIRED',name+' is required',name);
  return text;
}
function date(value,name,required=true) {
  const text=label(value,name,{required,max:10});if(!text)return '';
  const parsed=new Date(text+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(text)||!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==text)
    fail('INVALID_DATE',name+' must be YYYY-MM-DD',name);
  return text;
}
function decimalString({units,scale}) {
  let text=units.toString();
  if(!scale)return text;
  text=text.padStart(scale+1,'0');
  return text.slice(0,-scale)+'.'+text.slice(-scale);
}
function decimalParts(text) {
  const [whole,fraction='']=text.split('.');
  return {units:BigInt(whole+fraction),scale:fraction.length};
}
function compareDecimal(a,b) {
  const left=a.units*10n**BigInt(b.scale),right=b.units*10n**BigInt(a.scale);
  return left===right?0:left<right?-1:1;
}
function multiplyDecimal(a,b) {
  let units=a.units*b.units,scale=a.scale+b.scale;
  while(scale>0&&units%10n===0n){units/=10n;scale--;}
  return {units,scale};
}
function number(value,name,style,{required=false,integer=false,minimum=0,maximum=1e12}={}) {
  if(value===undefined||value===null||value==='') {if(required)fail('FIELD_REQUIRED',name+' is required',name);return null;}
  let text;
  if(typeof value==='number'){
    if(!Number.isFinite(value)||value<0)fail('INVALID_NUMBER','Out-of-range '+name,name);
    text=String(value);
  }else{
    if(typeof value!=='string')fail('INVALID_NUMBER','Use a decimal for '+name,name);
    text=value.trim();
    if(style==='us' && /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(text))text=text.replaceAll(',','');
    if(style==='eu'){
      if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/u.test(text))
        fail('INVALID_NUMBER','Use the selected numeric format for '+name,name);
      text=text.replaceAll('.','').replace(',','.');
    }
  }
  if(text.length>128)fail('INVALID_NUMBER','Numeric value is too long',name);
  const match=/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(text);
  if(!match)fail('INVALID_NUMBER','Use the selected numeric format for '+name,name);
  const exponent=Number(match[3]??0),fraction=match[2]??'';
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>18)fail('INVALID_NUMBER','Numeric exponent is out of range',name);
  let units=BigInt(match[1]+fraction),scale=fraction.length-exponent;
  if(scale<0){units*=10n**BigInt(-scale);scale=0;}
  while(scale>0&&units%10n===0n){units/=10n;scale--;}
  if(scale>18)fail('NUMERIC_PRECISION','Use at most 18 decimal places',name);
  const decimal={units,scale};
  if(compareDecimal(decimal,decimalParts(String(minimum)))<0||compareDecimal(decimal,decimalParts(String(maximum)))>0||(integer&&scale!==0))
    fail('INVALID_NUMBER','Out-of-range '+name,name);
  const exact=decimalString(decimal);
  return {value:Number(exact),exact,decimal};
}
function sourceRecord(source) {
  if(!plain(source))fail('SOURCE_REQUIRED','Source metadata is required');
  return {
    publisher_id:label(source.publisher_id,'publisher_id',{max:120}),
    publisher_name:label(source.publisher_name,'publisher_name',{max:240}),
    survey_id:label(source.survey_id,'survey_id',{max:120}),
    survey_name:label(source.survey_name,'survey_name',{max:240}),
    edition_id:label(source.edition_id,'edition_id',{max:120}),
    license_reference:label(source.license_reference,'license_reference',{max:2000}),
    source_reference:label(source.source_reference,'source_reference',{max:2000}),
    effective_date:date(source.effective_date,'source.effective_date',false),
    filename:label(source.filename??'survey.csv','filename',{max:240})
  };
}

/** RFC4180-style records, with an explicit delimiter and no inferred number locale. */
export function parsePublisherCsv(csv,{delimiter=','}={}) {
  if(typeof csv!=='string'||Buffer.byteLength(csv,'utf8')>25*1024*1024||csv.includes('\0'))
    fail('INVALID_CSV','Supply a UTF-8 CSV of at most 25 MiB');
  if(![',','\t',';'].includes(delimiter))fail('INVALID_DELIMITER','Use comma, tab or semicolon');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  const pushCell=()=>{if(cell.length>20000)fail('CELL_TOO_LARGE','CSV cell exceeds 20,000 characters');row.push(cell);cell='';closed=false;if(row.length>128)fail('TOO_MANY_COLUMNS','CSV exceeds 128 columns');};
  const pushRow=()=>{pushCell();rows.push(row);row=[];if(rows.length>100001)fail('TOO_MANY_ROWS','CSV exceeds 100,000 data records');};
  const text=csv.charCodeAt(0)===0xfeff?csv.slice(1):csv;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
    if(ch==='"'){if(cell||closed)fail('INVALID_CSV','Quote must begin a CSV field');quoted=true;continue;}
    if(ch===delimiter){pushCell();continue;}
    if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;pushRow();continue;}
    if(closed)fail('INVALID_CSV','Unexpected text after a quoted CSV field');
    cell+=ch;
  }
  if(quoted)fail('INVALID_CSV','Unclosed quoted CSV field');
  if(cell||row.length||closed)pushRow();
  if(!rows.length)fail('EMPTY_CSV','CSV has no header');
  const headers=rows.shift().map(value=>label(value,'column',{max:240}));
  if(new Set(headers).size!==headers.length)fail('DUPLICATE_COLUMNS','CSV headers must be unique');
  return {headers,records:rows.map((values,index)=>({inputRow:index+2,values})).filter(row=>row.values.some(value=>value!==''))};
}

function normalizeRow(raw,source,read,style) {
  const value={};
  for(const field of ['survey_job_code','survey_job_title','job_description','scope_cut','industry','geography','size_band','peer_id']){
    value[field]=label(read(field),field,{required:['survey_job_code','survey_job_title','scope_cut'].includes(field),max:field==='job_description'?20000:1000});
  }
  value.currency=label(read('currency'),'currency',{max:3}).toUpperCase();
  if(!/^[A-Z]{3}$/u.test(value.currency))fail('INVALID_CURRENCY','Use an explicit three-letter currency code','currency');
  value.effective_date=date(read('effective_date')||source.effective_date,'effective_date');
  value.pay_period=label(read('pay_period'),'pay_period',{max:20}).toLowerCase();
  if(!['annual','hourly','monthly','weekly','periodic'].includes(value.pay_period))
    fail('INVALID_PERIOD','Pay period must be annual, hourly, monthly, weekly or periodic','pay_period');
  value.exact={};
  const decimals={};
  const numeric=(field,options,fallback)=>{
    const incoming=read(field)??fallback;
    const parsed=number(incoming,field,read.style?read.style(field):style,options);
    value.exact[field]=parsed?.exact??null;
    decimals[field]=parsed?.decimal??null;
    value[field]=parsed?.value??null;
    return value[field];
  };
  numeric('unit_multiplier',{required:true,minimum:0.000001,maximum:1000000},1);
  numeric('annual_hours',{minimum:1,maximum:10000});
  numeric('annual_periods',{minimum:1,maximum:366});
  if(value.pay_period==='hourly'&&value.annual_hours===null)fail('ANNUAL_HOURS_REQUIRED','Hourly data needs the source annual-hours basis','annual_hours');
  if(['weekly','periodic'].includes(value.pay_period)&&value.annual_periods===null)
    fail('ANNUAL_PERIODS_REQUIRED','Periodic data needs the source periods-per-year basis','annual_periods');
  const periods={annual:decimalParts('1'),hourly:decimals.annual_hours,monthly:decimalParts('12'),weekly:decimals.annual_periods,periodic:decimals.annual_periods}[value.pay_period];
  const factor=multiplyDecimal(decimals.unit_multiplier,periods);
  value.annualization_factor_exact=decimalString(factor);
  value.annualization_factor=Number(value.annualization_factor_exact);
  for(const field of ['p25','p50','p75'])numeric(field,{required:field==='p50',minimum:0.000001});
  if((decimals.p25!==null&&compareDecimal(decimals.p25,decimals.p50)>0)||(decimals.p75!==null&&compareDecimal(decimals.p75,decimals.p50)<0))
    fail('PERCENTILE_ORDER','Reported percentiles must be ordered p25 <= p50 <= p75');
  value.annualized={};value.annualized_exact={};
  for(const field of ['p25','p50','p75']){
    if(decimals[field]===null){value.annualized[field]=null;value.annualized_exact[field]=null;continue;}
    const amount=multiplyDecimal(decimals[field],factor);
    if(compareDecimal(amount,decimalParts('1000000000000'))>0)fail('INVALID_ANNUALIZED_PAY','Annualized pay is out of range',field);
    const divisor=10n**BigInt(amount.scale);
    const cents=(amount.units*100n+divisor/2n)/divisor;
    const exact=decimalString({units:cents,scale:2});
    value.annualized_exact[field]=exact;
    value.annualized[field]=Number(exact);
  }
  numeric('organization_count',{integer:true,minimum:1,maximum:10000000});
  numeric('incumbent_count',{integer:true,minimum:1,maximum:100000000});
  const warnings=[];
  if(!value.job_description)warnings.push({code:'JOB_DESCRIPTION_MISSING',field:'job_description',message:'Review the publisher job content before matching.'});
  if(value.organization_count===null)warnings.push({code:'SAMPLE_COUNT_UNKNOWN',field:'organization_count',message:'Publisher organization count is absent.'});
  if(value.p25===null||value.p75===null)warnings.push({code:'PARTIAL_PERCENTILES',message:'One or both outer percentiles are absent.'});
  return {value,warnings};
}

/** Preview preserves every original row and identifies conflicting repeat keys. */
export function previewPublisherImport({csv,source,mapping={},defaults={},delimiter=',',numberStyle='plain',capturedAt=new Date().toISOString()}={}) {
  const selected=sourceRecord(source);
  if(!plain(mapping)||!plain(defaults))fail('INVALID_MAPPING','Mapping and defaults must be objects');
  if(!['plain','us','eu'].includes(numberStyle))fail('INVALID_NUMBER_STYLE','Select plain, us or eu numeric format');
  for(const key of [...Object.keys(mapping),...Object.keys(defaults)])if(!FIELDS.includes(key))fail('UNKNOWN_FIELD','Unknown intake field: '+key);
  const parsed=parsePublisherCsv(csv,{delimiter});
  for(const [field,column] of Object.entries(mapping))if(column!==null&&!parsed.headers.includes(column))
    fail('UNKNOWN_COLUMN','Mapped column is absent: '+column,field);
  if(typeof capturedAt!=='string'||!Number.isFinite(Date.parse(capturedAt)))fail('INVALID_CAPTURE_TIME','Invalid capture time');
  const sourceSha256=digest(csv), rows=[], keys=new Map();
  for(const record of parsed.records){
    const raw=Object.fromEntries(parsed.headers.map((header,index)=>[header,record.values[index]??'']));
    const row={id:digest(sourceSha256+':'+record.inputRow).slice(0,24),inputRow:record.inputRow,raw,normalized:null,stableKey:null,fingerprint:null,errors:[],warnings:[],duplicateOf:null,conflictWith:[]};
    if(record.values.length!==parsed.headers.length)row.errors.push({code:'COLUMN_COUNT',message:'Record column count differs from header.'});
    else{
      try{
        const read=field=>own(mapping,field)&&mapping[field]!==null ? raw[mapping[field]] : (own(defaults,field)?defaults[field]:undefined);
        read.style=field=>own(mapping,field)&&mapping[field]!==null?numberStyle:'plain';
        const result=normalizeRow(raw,selected,read,numberStyle);row.normalized=result.value;row.warnings=result.warnings;
        row.stableKey=digest([selected.publisher_id,selected.survey_id,result.value.survey_job_code,result.value.scope_cut,result.value.industry,result.value.geography,result.value.size_band,result.value.peer_id,result.value.currency]);
        row.fingerprint=digest(result.value);
      }catch(error){if(!(error instanceof IntakeError))throw error;row.errors.push({code:error.code,field:error.path,message:error.message});}
    }
    rows.push(row);
    if(row.stableKey){const group=keys.get(row.stableKey)??[];group.push(row);keys.set(row.stableKey,group);}
  }
  for(const group of keys.values()){
    const byHash=new Map();
    for(const row of group){if(byHash.has(row.fingerprint))row.duplicateOf=byHash.get(row.fingerprint).id;else byHash.set(row.fingerprint,row);}
    if(byHash.size>1)for(const row of group)row.conflictWith=group.filter(other=>other.id!==row.id).map(other=>other.id);
  }
  const preview={schema:SCHEMA,kind:'preview',source:selected,sourceSha256,sourceBytes:Buffer.byteLength(csv,'utf8'),capturedAt:new Date(capturedAt).toISOString(),
    format:{delimiter,numberStyle},mapping:clone(mapping),defaults:clone(defaults),headers:parsed.headers,rows,
    summary:{rows:rows.length,valid:rows.filter(row=>!row.errors.length).length,invalid:rows.filter(row=>row.errors.length).length,
      duplicate:rows.filter(row=>row.duplicateOf).length,conflicting:rows.filter(row=>row.conflictWith.length).length,
      warnings:rows.reduce((sum,row)=>sum+row.warnings.length,0)}};
  return {...preview,previewHash:digest(preview)};
}
function checkedPreview(preview) {
  if(!plain(preview)||preview.schema!==SCHEMA||preview.kind!=='preview')fail('INVALID_PREVIEW','Original intake preview required');
  const {previewHash,...body}=preview;
  if(previewHash!==digest(body))fail('PREVIEW_CHANGED','Preview contents changed after generation');
  return preview;
}
function checkedEdition(edition) {
  if(!plain(edition)||edition.schema!==SCHEMA||edition.kind!=='reviewed')fail('INVALID_EDITION','Reviewed publisher edition required');
  const {editionHash,...body}=edition;
  if(editionHash!==digest(body))fail('EDITION_CHANGED','Reviewed edition contents changed');
  return edition;
}

/** Parent records the responsible operator identity with the saved review. */
export function reviewPublisherImport(preview,{expectedHash,reviewer,reason,includeRows,reviewedAt=new Date().toISOString()}={}) {
  checkedPreview(preview);
  if(expectedHash!==preview.previewHash)fail('PREVIEW_CHANGED','Review refers to a different preview');
  reviewer=label(reviewer,'reviewer',{max:240});reason=label(reason,'reason',{max:4000});
  if(!Array.isArray(includeRows)||!includeRows.length||new Set(includeRows).size!==includeRows.length)
    fail('ROW_SELECTION_REQUIRED','Select distinct reviewed rows');
  const byId=new Map(preview.rows.map(row=>[row.id,row])),selected=[],keys=new Set(),includedRowIds=new Set(includeRows);
  for(const id of includeRows){
    const row=byId.get(id);if(!row)fail('UNKNOWN_ROW','Selected row is absent from the preview');
    if(row.errors.length)fail('INVALID_ROW','Correct the invalid source row before including it',String(row.inputRow));
    if(keys.has(row.stableKey))fail('DUPLICATE_SELECTION','Choose one source row per publisher job/cut/peer/currency',String(row.inputRow));
    keys.add(row.stableKey);selected.push(clone(row));
  }
  if(typeof reviewedAt!=='string'||!Number.isFinite(Date.parse(reviewedAt)))fail('INVALID_REVIEW_TIME','Invalid review time');
  const result={schema:SCHEMA,kind:'reviewed',source:clone(preview.source),sourceSha256:preview.sourceSha256,sourceBytes:preview.sourceBytes,
    previewHash:preview.previewHash,format:clone(preview.format),mapping:clone(preview.mapping),defaults:clone(preview.defaults),
    rows:selected,review:{reviewer,reason,reviewedAt:new Date(reviewedAt).toISOString(),includedRows:[...includeRows],
      excludedRows:preview.rows.filter(row=>!includedRowIds.has(row.id)).map(row=>({id:row.id,inputRow:row.inputRow,errors:clone(row.errors),duplicateOf:row.duplicateOf,conflictWith:clone(row.conflictWith)}))}};
  return {...result,editionHash:digest(result)};
}

/** Select existing publisher cuts; retains every exclusion and each reported sample count. */
export function selectPeerCohort(edition,{id,label:cohortLabel,reviewer,reason,filters={},minOrganizations=null}={}) {
  checkedEdition(edition);
  id=label(id,'cohort id',{max:120});cohortLabel=label(cohortLabel,'cohort label',{max:240});
  reviewer=label(reviewer,'reviewer',{max:240});reason=label(reason,'reason',{max:4000});
  if(!plain(filters))fail('INVALID_COHORT','Cohort filters must be an object');
  const supported=['industry','geography','size_band','peer_id','scope_cut','currency','survey_job_code'];
  for(const [field,values] of Object.entries(filters)){
    if(!supported.includes(field)||!Array.isArray(values)||!values.length||values.some(value=>typeof value!=='string'||!value.trim()))
      fail('INVALID_COHORT','Use nonempty explicit value lists for '+field,field);
  }
  if(minOrganizations!==null&&(!Number.isSafeInteger(minOrganizations)||minOrganizations<1||minOrganizations>10000000))
    fail('INVALID_COHORT','Minimum organizations must be a positive integer');
  const decisions=edition.rows.map(row=>{
    const reasons=[];
    for(const [field,values] of Object.entries(filters))if(!values.includes(row.normalized[field]))reasons.push({code:'FILTER_MISMATCH',field,value:row.normalized[field]});
    if(minOrganizations!==null){
      if(row.normalized.organization_count===null)reasons.push({code:'SAMPLE_COUNT_UNKNOWN'});
      else if(row.normalized.organization_count<minOrganizations)reasons.push({code:'SAMPLE_BELOW_MINIMUM',actual:row.normalized.organization_count,minimum:minOrganizations});
    }
    return {rowId:row.id,stableKey:row.stableKey,included:!reasons.length,reasons};
  });
  const included=new Set(decisions.filter(row=>row.included).map(row=>row.rowId));
  const result={schema:SCHEMA,kind:'cohort',id,label:cohortLabel,reviewer,reason,editionHash:edition.editionHash,source:clone(edition.source),sourceSha256:edition.sourceSha256,
    filters:clone(filters),minOrganizations,rows:edition.rows.filter(row=>included.has(row.id)).map(clone),decisions,
    summary:{included:included.size,excluded:decisions.length-included.size,unknownSampleCounts:edition.rows.filter(row=>included.has(row.id)&&row.normalized.organization_count===null).length}};
  return {...result,cohortHash:digest(result)};
}

/** Match annual refreshes by explicit publisher/survey/job/cut identity. */
export function compareEditions(previous,current) {
  checkedEdition(previous);checkedEdition(current);
  if(previous.source.publisher_id!==current.source.publisher_id||previous.source.survey_id!==current.source.survey_id)
    fail('SURVEY_LINEAGE_MISMATCH','Select editions of the same publisher and survey');
  const oldRows=new Map(previous.rows.map(row=>[row.stableKey,row])),newRows=new Map(current.rows.map(row=>[row.stableKey,row]));
  const changes=[];
  for(const [key,row] of newRows){
    const before=oldRows.get(key);
    const exactValue=(value,field)=>field==='annualized'?(value.annualized_exact??value.annualized):field==='annualization_factor'?(value.annualization_factor_exact??value.annualization_factor):(value.exact?.[field]??value[field]);
    const fields=before?Object.keys(row.normalized).filter(field=>!['exact','annualized_exact','annualization_factor_exact'].includes(field)&&canonical(exactValue(row.normalized,field))!==canonical(exactValue(before.normalized,field))):[];
    changes.push({stableKey:key,status:!before?'added':row.fingerprint===before.fingerprint?'unchanged':'changed',
      previousRowId:before?.id??null,currentRowId:row.id,survey_job_code:row.normalized.survey_job_code,scope_cut:row.normalized.scope_cut,
      changedFields:fields,previous:before?clone(before.normalized):null,current:clone(row.normalized)});
  }
  for(const [key,row] of oldRows)if(!newRows.has(key))changes.push({stableKey:key,status:'retired',previousRowId:row.id,currentRowId:null,
    survey_job_code:row.normalized.survey_job_code,scope_cut:row.normalized.scope_cut,changedFields:[],previous:clone(row.normalized),current:null});
  return {schema:SCHEMA,kind:'refresh-comparison',previousEditionHash:previous.editionHash,currentEditionHash:current.editionHash,
    previousEdition:previous.source.edition_id,currentEdition:current.source.edition_id,changes,
    summary:Object.fromEntries(['added','unchanged','changed','retired'].map(status=>[status,changes.filter(row=>row.status===status).length]))};
}

export function publisherIntakeCsv(edition) {
  if(edition?.kind==='cohort'){
    const {cohortHash,...body}=edition;if(cohortHash!==digest(body))fail('COHORT_CHANGED','Cohort contents changed');
  }else checkedEdition(edition);
  const headers=['publisher_id','survey_id','edition_id','source_sha256','row_id','row_fingerprint','survey_job_code','survey_job_title','scope_cut','industry','geography','size_band','peer_id',
    'currency','effective_date','pay_period','unit_multiplier','annualization_factor','p25','p50','p75','annualized_p25','annualized_p50','annualized_p75','organization_count','incumbent_count'];
  const cell=value=>{let text=value===null||value===undefined?'':String(value);if(/^\s*[=+@-]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const rows=edition.rows.map(row=>{
    const v=row.normalized;
    return [edition.source.publisher_id,edition.source.survey_id,edition.source.edition_id,edition.sourceSha256??'',row.id,row.fingerprint,
      v.survey_job_code,v.survey_job_title,v.scope_cut,v.industry,v.geography,v.size_band,v.peer_id,v.currency,v.effective_date,
      v.pay_period,v.exact?.unit_multiplier??v.unit_multiplier,v.annualization_factor_exact??v.annualization_factor,v.exact?.p25??v.p25,v.exact?.p50??v.p50,v.exact?.p75??v.p75,v.annualized_exact?.p25??v.annualized.p25,v.annualized_exact?.p50??v.annualized.p50,v.annualized_exact?.p75??v.annualized.p75,v.organization_count,v.incumbent_count];
  });
  return [headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
