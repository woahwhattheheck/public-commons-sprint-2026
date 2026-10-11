// MIT. Source-native USAspending contract and exact research values. Node 22+.
import { createHash } from 'node:crypto';

export const VERSION = 'stellar-forge.usaspending-research.v1';
export const ORIGIN = 'https://api.usaspending.gov';
export const SEARCH_PATH = '/api/v2/search/spending_by_award/';
export const COUNT_PATH = '/api/v2/search/spending_by_award_count/';
export const FIELDS = Object.freeze(['Award ID','generated_internal_id','Recipient Name','Recipient UEI','recipient_id','Recipient DUNS Number','Awarding Agency','Awarding Agency Code','Awarding Sub Agency','Funding Agency','Funding Sub Agency','Start Date','End Date','Base Obligation Date','Last Modified Date','Award Amount','Total Outlays','Description','Contract Award Type','NAICS','PSC','Recipient Location','Primary Place of Performance']);
export const COLUMNS = Object.freeze(['award_key','piid','recipient_name','recipient_uei','recipient_id','parent_recipient_name','parent_recipient_uei','parent_recipient_id','parent_award_key','parent_piid','awarding_agency','awarding_subagency','funding_agency','award_type','description','signed_date','performance_start','performance_end','potential_end','last_modified','award_amount_usd','total_obligation_usd','exercised_usd','potential_usd','outlays_usd','naics','psc','set_aside','subcontracting_plan','source_url','capture_id','source_observed_at','source_query_sha256']);
export const text = (v) => v === undefined || v === null ? null : String(v);
export const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function requireThat(v, code, message, status = 400) {
  if (!v) throw Object.assign(new Error(message ?? code), {code,status});
}
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (plain(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  requireThat(v !== undefined && (typeof v !== 'number' || Number.isFinite(v)), 'VALUE_INVALID');
  return JSON.stringify(v);
}
export const sha = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : canonical(v)).digest('hex');
export const copy = v => JSON.parse(JSON.stringify(v));
export const now = () => new Date().toISOString();
export function string(v, name, max = 1000, empty = false) {
  requireThat(typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0), 'FIELD_INVALID', name + ' is required (maximum ' + max + ' characters)');
  return v;
}
export function id(v, name = 'id') {
  string(v,name,160); requireThat(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v),'ID_INVALID',name + ' has invalid characters'); return v;
}
export function date(v, name) {
  string(v,name,10); requireThat(/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'DATE_INVALID',name + ' must be a valid YYYY-MM-DD date'); return v;
}
export function integer(v, name, min, max) {
  requireThat(Number.isSafeInteger(v) && v>=min && v<=max,'INTEGER_INVALID',name + ' must be an integer between '+min+' and '+max); return v;
}
export function sourceJSON(bytes) {
  const raw = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  // The source-number context is available in the supported Node 22+ runtime.
  // All provider numeric lexemes become strings before any IEEE-754 rounding.
  return JSON.parse(raw,(key,value,context) => {
    if (typeof value !== 'number') return value;
    requireThat(typeof context?.source === 'string','SOURCE_NUMBER_CONTEXT_REQUIRED','Use Node 22+ with JSON.parse source context');
    return context.source;
  });
}
export function decimal(value) {
  if (value === null || value === undefined || value === '') return null;
  const s=String(value), m=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
  requireThat(m,'AMOUNT_INVALID','Invalid original decimal amount');
  const exp=Number(m[4]??0); requireThat(Number.isSafeInteger(exp)&&Math.abs(exp)<=100,'AMOUNT_RANGE');
  const digits=m[2]+(m[3]??''), point=m[2].length+exp;
  let out=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
  let [a,b='']=out.split('.'); a=a.replace(/^0+(?=\d)/,''); b=b.replace(/0+$/,'');
  out=a+(b?'.'+b:''); return (m[1] && /[1-9]/.test(out)?'-':'')+out;
}
export function addDecimals(values) {
  const vs=values.filter(v=>v!==null&&v!==undefined).map(decimal);
  if (!vs.length) return null;
  const scale=vs.reduce((max,v)=>Math.max(max,(v.split('.')[1]??'').length),0);
  const total=vs.reduce((n,v)=>{const neg=v[0]==='-';const [a,b='']=(neg?v.slice(1):v).split('.');return n+(neg?-1n:1n)*BigInt(a+b.padEnd(scale,'0'));},0n);
  const negative=total<0n, digits=(negative?-total:total).toString().padStart(scale+1,'0');
  return decimal((negative?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits));
}
export function difference(a,b) {return a===null||b===null?null:addDecimals([a,decimal(b)==='0'?'0':String(b).startsWith('-')?String(b).slice(1):'-'+b]);}
export function money(v) {
  const s=decimal(v); if(s===null)return '—';
  const [a,b='']=s.split('.'); return (a.startsWith('-')?'-$':'$')+a.replace('-','').replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+b.padEnd(2,'0');
}
function strings(value,name,max=30) {
  requireThat(Array.isArray(value)&&value.length<=max,'FILTER_INVALID',name+' must be an array of at most '+max+' strings');
  const out=value.map(v=>string(v,name,200)); requireThat(new Set(out).size===out.length,'FILTER_DUPLICATE',name+' contains a duplicate'); return out;
}
export function queryDefinition(raw) {
  requireThat(plain(raw),'QUERY_REQUIRED');
  const allowed=['name','startDate','endDate','dateType','keywords','description','recipient','awardIds','agencies','naics','psc','awardTypes','pageSize','maxRows','minimumAwardUsd','maximumAwardUsd'];
  requireThat(Object.keys(raw).every(k=>allowed.includes(k)),'QUERY_FIELD_UNKNOWN');
  const out={name:string(raw.name,'Query name',160),startDate:date(raw.startDate,'Start date'),endDate:date(raw.endDate,'End date'),dateType:raw.dateType??'new_awards_only'};
  requireThat(out.startDate<=out.endDate,'DATE_ORDER');
  requireThat(['new_awards_only','action_date','date_signed','last_modified_date'].includes(out.dateType),'DATE_TYPE_INVALID');
  for(const name of ['keywords','recipient','awardIds','naics','psc'])out[name]=strings(raw[name]??[],name);
  out.description=string(raw.description??'','Description search',2000,true);
  out.awardTypes=strings(raw.awardTypes??['A','B','C','D'],'awardTypes',4);
  requireThat(out.awardTypes.length && out.awardTypes.every(v=>['A','B','C','D'].includes(v)),'PRIME_CONTRACT_TYPES_REQUIRED');
  out.agencies=(raw.agencies??[]).map(a=>{
    requireThat(plain(a)&&['awarding','funding'].includes(a.type)&&['toptier','subtier'].includes(a.tier),'AGENCY_INVALID');
    const item={type:a.type,tier:a.tier,name:string(a.name,'Agency name',200)};
    if(a.toptier_name)item.toptier_name=string(a.toptier_name,'Top tier name',200); return item;
  });
  requireThat(out.agencies.length<=20,'AGENCY_LIMIT');
  for(const name of ['minimumAwardUsd','maximumAwardUsd']) if(raw[name]!==undefined&&raw[name]!==null&&raw[name]!=='') out[name]=integer(typeof raw[name]==='string'?Number(raw[name]):raw[name],name,0,Number.MAX_SAFE_INTEGER);
  requireThat(out.minimumAwardUsd===undefined||out.maximumAwardUsd===undefined||out.minimumAwardUsd<=out.maximumAwardUsd,'AMOUNT_BOUND_ORDER');
  out.pageSize=integer(raw.pageSize??100,'Page size',1,100);
  out.maxRows=integer(raw.maxRows??50000,'Capture row capacity',1,250000);
  return out;
}
export function sourceFilters(q) {
  const filters={award_type_codes:q.awardTypes,time_period:[{start_date:q.startDate,end_date:q.endDate,date_type:q.dateType}]};
  const map={keywords:'keywords',recipient:'recipient_search_text',awardIds:'award_ids',naics:'naics_codes',psc:'psc_codes',agencies:'agencies'};
  for(const [key,target]of Object.entries(map))if(q[key].length)filters[target]=q[key];
  if(q.description)filters.description=q.description;
  if(q.minimumAwardUsd!==undefined||q.maximumAwardUsd!==undefined){const bounds={};if(q.minimumAwardUsd!==undefined)bounds.lower_bound=q.minimumAwardUsd;if(q.maximumAwardUsd!==undefined)bounds.upper_bound=q.maximumAwardUsd;filters.award_amounts=[bounds];}
  return filters;
}
export function searchRequest(q, page = 1, continuation = {}) {
  const body={filters:sourceFilters(q),fields:[...FIELDS],page,limit:q.pageSize,sort:'Award ID',order:'asc',subawards:false,spending_level:'awards'};
  if(continuation.last_record_unique_id!==undefined&&continuation.last_record_unique_id!==null){
    const n=Number(continuation.last_record_unique_id);integer(n,'Provider continuation identity',0,Number.MAX_SAFE_INTEGER);body.last_record_unique_id=n;
  }
  if(continuation.last_record_sort_value!==undefined&&continuation.last_record_sort_value!==null)body.last_record_sort_value=String(continuation.last_record_sort_value);
  return body;
}
export function awardKey(v) {
  string(v,'USAspending award identity',250);
  requireThat(/^[A-Za-z0-9][A-Za-z0-9_.:/% -]*$/.test(v),'AWARD_ID_INVALID');
  return v;
}
export const awardURL = key => 'https://www.usaspending.gov/award/'+encodeURIComponent(awardKey(key));
export function normalizeAward(row, provenance={}) {
  requireThat(plain(row),'AWARD_ROW_INVALID');
  const key=awardKey(text(row.generated_internal_id)??text(row.generated_unique_award_id)??'');
  const detailed=Object.hasOwn(row,'generated_unique_award_id');
  if(detailed)requireThat(row.category==='contract','CONTRACT_DETAIL_REQUIRED');
  const rec=detailed?(row.recipient??{}):{}, perf=detailed?(row.period_of_performance??{}):{}, proc=detailed?(row.latest_transaction_contract_data??{}):{};
  const value={
    award_key:key,piid:text(detailed?row.piid:row['Award ID']),recipient_name:text(detailed?rec.recipient_name:row['Recipient Name']),
    recipient_uei:text(detailed?rec.recipient_uei:row['Recipient UEI']),recipient_id:text(detailed?rec.recipient_hash:row.recipient_id),
    parent_recipient_name:text(rec.parent_recipient_name),parent_recipient_uei:text(rec.parent_recipient_uei),parent_recipient_id:text(rec.parent_recipient_hash),
    parent_award_key:text(row.parent_award?.generated_unique_award_id),parent_piid:text(row.parent_award?.piid),
    awarding_agency:text(detailed?row.awarding_agency?.toptier_agency?.name:row['Awarding Agency']),
    awarding_subagency:text(detailed?row.awarding_agency?.subtier_agency?.name:row['Awarding Sub Agency']),
    funding_agency:text(detailed?row.funding_agency?.toptier_agency?.name:row['Funding Agency']),
    award_type:text(detailed?row.type_description:row['Contract Award Type']),
    description:text(detailed?row.description:row.Description),
    signed_date:text(detailed?row.date_signed:row['Base Obligation Date']),
    performance_start:text(detailed?perf.start_date:row['Start Date']),performance_end:text(detailed?perf.end_date:row['End Date']),
    potential_end:text(perf.potential_end_date)?.slice(0,10)??null,last_modified:text(detailed?perf.last_modified_date:row['Last Modified Date']),
    award_amount_usd:decimal(detailed?row.total_obligation:row['Award Amount']),
    total_obligation_usd:detailed?decimal(row.total_obligation):null,
    exercised_usd:decimal(row.base_exercised_options),potential_usd:decimal(row.base_and_all_options),
    outlays_usd:decimal(detailed?row.total_outlay:row['Total Outlays']),
    naics:text(detailed?proc.naics:row.NAICS),psc:text(detailed?proc.product_or_service_code:row.PSC),
    set_aside:text(proc.type_set_aside_description??proc.type_set_aside),
    subcontracting_plan:text(proc.subcontracting_plan_description??proc.subcontracting_plan),
    source_url:awardURL(key),capture_id:text(provenance.captureId),source_observed_at:text(provenance.observedAt),source_query_sha256:text(provenance.querySha256),
  };
  return {...value,row_sha256:sha(value),source_kind:detailed?'award_detail':'award_search',source_record_sha256:sha(row),raw:copy(row)};
}
export function publicRow(row) {return Object.fromEntries(COLUMNS.map(k=>[k,row[k]??null]));}
export function csv(rows, columns=COLUMNS,{spreadsheet=false}={}) {
  const cell=v=>{let t=v===null||v===undefined?'':String(v);if(spreadsheet&&/^[\x00-\x20]*[=+@-]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};
  return columns.map(cell).join(',')+'\r\n'+rows.map(r=>columns.map(k=>cell(r[k])).join(',')+'\r\n').join('');
}
export function compareRows(before,after) {
  const a=new Map(before.map(v=>[v.award_key,v])), b=new Map(after.map(v=>[v.award_key,v]));
  const fields=COLUMNS.filter(k=>!['capture_id','source_observed_at','source_query_sha256'].includes(k));
  const changes=[];
  for(const key of new Set([...a.keys(),...b.keys()])){
    const prior=a.get(key),current=b.get(key);
    if(!prior||!current){changes.push({award_key:key,kind:prior?'absent_in_later_results':'added',before:prior?publicRow(prior):null,after:current?publicRow(current):null,fields:[]});continue;}
    const deltas=fields.filter(k=>canonical(prior[k]??null)!==canonical(current[k]??null)).map(k=>({field:k,before:prior[k]??null,after:current[k]??null}));
    if(deltas.length)changes.push({award_key:key,kind:'changed',fields:deltas,award_amount_delta_usd:difference(current.award_amount_usd,prior.award_amount_usd)});
  }
  const changedKeys=new Set(changes.map(c=>c.award_key));
  return {before:before.length,after:after.length,unchanged:[...a.keys()].filter(k=>b.has(k)&&!changedKeys.has(k)).length,changes};
}
