// MIT. Lossless PG text values, exact keys and materialized filter semantics.
import { fail, QueryInputError, object, own, canonical } from './common.mjs';
export const TYPES = ['string','integer','number','boolean','bigint','decimal','timestamp','timestamptz','date','time','interval','uuid','json','bytes'];
const INTEGER_OIDS = new Set([20,21,23]), FLOAT_OIDS = new Set([700,701]);
export const SQL_TYPES = Object.freeze({string:'text',integer:'bigint',number:'double precision',boolean:'boolean',
  bigint:'bigint',decimal:'numeric',timestamp:'timestamp',timestamptz:'timestamptz',date:'date',time:'time',
  interval:'interval',uuid:'uuid',json:'jsonb',bytes:'bytea'});
export function decimalParts(value) {
  const text = String(value);
  if (text.length > 8192) throw fail('RISINGWAVE_DECIMAL_TOO_LARGE');
  const match = /^([+-]?)([0-9]+)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) throw fail('RISINGWAVE_DECIMAL_INVALID');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 8192) throw fail('RISINGWAVE_DECIMAL_EXPONENT_INVALID');
  let coefficient = BigInt((match[1] === '-' ? '-' : '') + match[2] + (match[3] ?? ''));
  let scale = (match[3]?.length ?? 0) - exponent;
  if (coefficient === 0n) return { coefficient:0n,scale:0 };
  while (coefficient % 10n === 0n) { coefficient /= 10n; scale -= 1; }
  return {coefficient,scale};
}
export function compareDecimal(left, right) {
  const a = decimalParts(left), b = decimalParts(right), scale = Math.max(a.scale,b.scale);
  const x = a.coefficient * 10n ** BigInt(scale-a.scale), y = b.coefficient * 10n ** BigInt(scale-b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function integerText(value) {
  const p = decimalParts(value);
  if (p.scale > 0 && p.coefficient % 10n ** BigInt(p.scale) !== 0n) throw fail('RISINGWAVE_INTEGER_NOT_INTEGRAL');
  return String(p.scale <= 0 ? p.coefficient * 10n ** BigInt(-p.scale) : p.coefficient / 10n ** BigInt(p.scale));
}
const floorDiv = (n,d) => n >= 0n ? n/d : (n-d+1n)/d;
function daysFromCivil(year,month,day) {
  let y = BigInt(year); const m = BigInt(month), d = BigInt(day);
  y -= m <= 2n ? 1n : 0n;
  const era=floorDiv(y,400n), yoe=y-era*400n;
  const doy=(153n*(m+(m>2n?-3n:9n))+2n)/5n+d-1n;
  return era*146097n+yoe*365n+yoe/4n-yoe/100n+doy-719468n;
}
function dateParts(text) {
  const m = /^([0-9]{4,6})-([0-9]{2})-([0-9]{2})(?: (BC))?$/.exec(text);
  if (!m) throw fail('RISINGWAVE_DATE_INVALID');
  let year=Number(m[1]); const month=Number(m[2]),day=Number(m[3]);
  if (year === 0) throw fail('RISINGWAVE_DATE_INVALID');
  if (m[4]) year=1-year;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  if(month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1])
    throw fail('RISINGWAVE_DATE_INVALID');
  return {year,month,day};
}
export function temporalValue(value,type) {
  if(typeof value!=='string') throw fail('RISINGWAVE_TEMPORAL_TEXT_REQUIRED');
  if(value==='infinity')return {infinity:1};
  if(value==='-infinity')return {infinity:-1};
  if(type==='date') {
    const d=dateParts(value); return {value:daysFromCivil(d.year,d.month,d.day)*86400000000n};
  }
  const m = type==='time' ? /^(\d{2}):(\d{2}):(\d{2})(?:\.([0-9]{1,6}))?$/.exec(value) :
    /^([0-9]{4,6}-[0-9]{2}-[0-9]{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.([0-9]{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?(?::?\d{2})?)?( BC)?$/.exec(value);
  if(!m)throw fail('RISINGWAVE_TEMPORAL_INVALID');
  const offset=type==='time'?0:1, hour=Number(m[1+offset]),minute=Number(m[2+offset]),second=Number(m[3+offset]);
  const fraction=m[4+offset]??'';
  if(hour>24||minute>59||second>59||hour===24&&(minute!==0||second!==0||/[1-9]/.test(fraction)))
    throw fail('RISINGWAVE_TEMPORAL_INVALID');
  let result=BigInt(hour*3600+minute*60+second)*1000000n+BigInt(fraction.padEnd(6,'0')||'0');
  if(type!=='time'){
    const d=dateParts(m[1]+(m[7]??'')); result+=daysFromCivil(d.year,d.month,d.day)*86400000000n;
    const zone=m[6];
    if(type==='timestamptz'&&!zone)throw fail('RISINGWAVE_TIMEZONE_REQUIRED');
    if(type==='timestamp'&&zone&&zone!=='Z')throw fail('RISINGWAVE_TIMESTAMP_ZONE_NOT_ALLOWED');
    if(zone&&zone!=='Z'){
      const z=/^([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(zone);
      const zh=Number(z[2]),zm=Number(z[3]??0),zs=Number(z[4]??0);
      if(zh>15||zm>59||zs>59)throw fail('RISINGWAVE_TIMEZONE_INVALID');
      result-=BigInt((z[1]==='-'?-1:1)*(zh*3600+zm*60+zs))*1000000n;
    }
  }
  return {value:result};
}
function compareTemporal(a,b,type){
  const x=temporalValue(a,type),y=temporalValue(b,type);
  if(x.infinity||y.infinity){const l=x.infinity??0,r=y.infinity??0;return l<r?-1:l>r?1:0;}
  return x.value<y.value?-1:x.value>y.value?1:0;
}
export function checkedValue(value,spec,field) {
  try {
    if(spec.array){
      if(!Array.isArray(value)||value.length>(spec.maxItems??1000))throw fail('QUERY_PARAMETER_ARRAY_INVALID');
      return value.map(item=>checkedValue(item,{...spec,array:false},field));
    }
    if(value===null){if(!spec.nullable)throw fail('QUERY_PARAMETER_NULL_NOT_ALLOWED');return null;}
    let result;
    switch(spec.type){
      case 'string':
        if(typeof value!=='string'||Buffer.from(value).toString('utf8')!==value||Buffer.byteLength(value)>(spec.maxLength??65536)||value.includes('\0'))
          throw fail('QUERY_PARAMETER_STRING_INVALID');
        result=value;break;
      case 'integer': {
        if(!['number','string'].includes(typeof value))throw fail('QUERY_PARAMETER_INTEGER_INVALID');
        const text=integerText(value),number=Number(text);
        if(!Number.isSafeInteger(number))throw fail('QUERY_PARAMETER_INTEGER_UNSAFE');
        result=number;break;
      }
      case 'number':
        if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw fail('QUERY_PARAMETER_NUMBER_INVALID');
        decimalParts(value);result=Number(value);
        if(!Number.isFinite(result))throw fail('QUERY_PARAMETER_NUMBER_INVALID');
        break;
      case 'bigint': {
        if(typeof value!=='string'&&!(typeof value==='number'&&Number.isSafeInteger(value)))throw fail('QUERY_PARAMETER_BIGINT_TEXT_REQUIRED');
        result=integerText(value);const n=BigInt(result);
        if(n< -9223372036854775808n||n>9223372036854775807n)throw fail('QUERY_PARAMETER_BIGINT_RANGE');
        break;
      }
      case 'decimal':
        if(typeof value!=='string')throw fail('QUERY_PARAMETER_DECIMAL_TEXT_REQUIRED');
        decimalParts(value);result=value;break;
      case 'boolean':
        if(typeof value!=='boolean')throw fail('QUERY_PARAMETER_BOOLEAN_INVALID');result=value;break;
      case 'date':case 'time':case 'timestamp':case 'timestamptz':
        temporalValue(value,spec.type);result=value;break;
      case 'uuid':
        if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw fail('QUERY_PARAMETER_UUID_INVALID');
        result=value.toLowerCase();break;
      case 'json':
        if(typeof value!=='string')throw fail('QUERY_PARAMETER_JSON_TEXT_REQUIRED');
        JSON.parse(value);result=value;break;
      case 'bytes':
        if(typeof value!=='string'||!/^\\x(?:[a-f0-9]{2})*$/i.test(value))throw fail('QUERY_PARAMETER_BYTES_INVALID');
        result=value.toLowerCase();break;
      case 'interval':
        if(typeof value!=='string'||!value||value.length>512||/[\x00-\x1f]/.test(value))throw fail('QUERY_PARAMETER_INTERVAL_INVALID');
        result=value;break;
      default:throw fail('QUERY_PARAMETER_TYPE_INVALID');
    }
    if(spec.enum && !spec.enum.some(item=>canonical(item)===canonical(result)))throw fail('QUERY_PARAMETER_ENUM');
    if(spec.min!==undefined&&compareValue(result,spec.min,spec.type)<0)throw fail('QUERY_PARAMETER_BELOW_MIN');
    if(spec.max!==undefined&&compareValue(result,spec.max,spec.type)>0)throw fail('QUERY_PARAMETER_ABOVE_MAX');
    return result;
  }catch(issue){if(issue instanceof QueryInputError)throw issue;throw new QueryInputError(field,issue.code??'QUERY_PARAMETER_INVALID',issue.message);}
}
export function validateColumnType(spec,field) {
  const oid=Number(field.typeOid??field.dataTypeID);
  const ok=spec.type==='string'||
    spec.type==='integer'&&INTEGER_OIDS.has(oid)||
    spec.type==='bigint'&&INTEGER_OIDS.has(oid)||
    spec.type==='number'&&FLOAT_OIDS.has(oid)||
    spec.type==='decimal'&&(oid===1700||INTEGER_OIDS.has(oid))||
    spec.type==='boolean'&&oid===16||
    spec.type==='timestamp'&&oid===1114||spec.type==='timestamptz'&&oid===1184||
    spec.type==='date'&&oid===1082||spec.type==='time'&&oid===1083||
    spec.type==='interval'&&oid===1186||spec.type==='uuid'&&oid===2950||
    spec.type==='json'&&[114,3802].includes(oid)||spec.type==='bytes'&&oid===17;
  if(!ok)throw fail('RISINGWAVE_COLUMN_TYPE_MISMATCH','The reviewed output type differs from the native source type.',
    {column:field.name,declared:spec.type,typeOid:String(oid)});
}
export function projectValue(value,spec,field){
  validateColumnType(spec,field);
  if(value===null){if(!spec.nullable)throw fail('RISINGWAVE_NULL_NOT_ALLOWED','A non-nullable output received NULL.',{column:field.name});return null;}
  if(typeof value!=='string')throw fail('RISINGWAVE_RAW_TEXT_REQUIRED');
  if(spec.type==='integer'){const n=Number(integerText(value));if(!Number.isSafeInteger(n))throw fail('RISINGWAVE_INTEGER_REQUIRES_BIGINT');return n;}
  if(spec.type==='number'){const n=Number(value);if(!Number.isFinite(n))throw fail('RISINGWAVE_NONFINITE_NUMBER_REQUIRES_STRING');return n;}
  if(spec.type==='boolean'){if(!['t','f','true','false'].includes(value))throw fail('RISINGWAVE_BOOLEAN_INVALID');return value==='t'||value==='true';}
  return value;
}
export function compareValue(a,b,type,oid=null) {
  if(['integer','bigint','decimal'].includes(type))return compareDecimal(a,b);
  if(type==='number'){
    const x=Number(oid)===700?Math.fround(Number(a)):Number(a),y=Number(oid)===700?Math.fround(Number(b)):Number(b);
    if(!Number.isFinite(x)||!Number.isFinite(y))throw fail('RISINGWAVE_FILTER_NONFINITE_NUMBER');
    return x<y?-1:x>y?1:0;
  }
  if(['timestamp','timestamptz','date','time'].includes(type))return compareTemporal(a,b,type);
  if(type==='boolean'){const x=a===true||a==='t'||a==='true',y=b===true||b==='t'||b==='true';return x===y?0:x?1:-1;}
  if(type==='uuid'){a=String(a).toLowerCase();b=String(b).toLowerCase();}
  if(type==='string'){a=String(a);b=String(b);}
  if(!['string','uuid'].includes(type))throw fail('RISINGWAVE_FILTER_TYPE_NOT_COMPARABLE');
  return Math.sign(Buffer.compare(Buffer.from(a),Buffer.from(b)));
}
export function matchesFilters(raw,query,input,fields) {
  const byName=new Map(fields.map((field,index)=>[field.name,{field,index}]));
  for(const filter of query.filters){
    const spec=query.columns[filter.column],source=byName.get(spec.column),value=raw[source.index];
    if(filter.op==='isNull'){if(value!==null)return false;continue;}
    if(filter.op==='isNotNull'){if(value===null)return false;continue;}
    if(!own(input,filter.parameter))continue;
    const parameter=input[filter.parameter];
    if(value===null||parameter===null)return false;
    const eq=item=>item!==null&&compareValue(value,item,spec.type,source.field.typeOid)===0;
    if(filter.op==='in'){if(!parameter.some(eq))return false;continue;}
    if(filter.op==='notIn'){if(parameter.some(item=>item===null)||parameter.some(eq))return false;continue;}
    const c=compareValue(value,parameter,spec.type,source.field.typeOid);
    if(!(filter.op==='eq'?c===0:filter.op==='ne'?c!==0:filter.op==='lt'?c<0:filter.op==='lte'?c<=0:filter.op==='gt'?c>0:c>=0))return false;
  }
  return true;
}
export function projectRecord(raw,query,fields){
  const index=new Map(fields.map((field,i)=>[field.name,{field,i}]));
  return Object.fromEntries(Object.entries(query.columns).map(([alias,spec])=>{
    const item=index.get(spec.column);if(!item)throw fail('RISINGWAVE_SOURCE_COLUMN_MISSING');
    return [alias,projectValue(raw[item.i],spec,item.field)];
  }));
}
export function rowKey(raw,query,fields) {
  const index=new Map(fields.map((field,i)=>[field.name,{field,i}]));
  return canonical(query.key.map(alias=>{
    const spec=query.columns[alias],item=index.get(spec.column),value=raw[item.i],oid=Number(item.field.typeOid);
    if(value===null)throw fail('RISINGWAVE_NULL_KEY','The reviewed visible key contains NULL.',{column:spec.column});
    let normalized=value;
    if(INTEGER_OIDS.has(oid))normalized=integerText(value);
    else if(oid===1700){const p=decimalParts(value);normalized=String(p.coefficient)+'e'+String(-p.scale);}
    else if(FLOAT_OIDS.has(oid)){const n=Number(value);if(!Number.isFinite(n))throw fail('RISINGWAVE_NONFINITE_KEY');normalized=String(Object.is(n,-0)?0:n);}
    else if([1114,1184,1082,1083].includes(oid)){
      const p=temporalValue(value,{1114:'timestamp',1184:'timestamptz',1082:'date',1083:'time'}[oid]);
      normalized=p.infinity?'infinity:'+p.infinity:String(p.value);
    }else if(oid===1042)normalized=value.replace(/ +$/,'');
    else if(oid===2950)normalized=value.toLowerCase();
    else if([114,3802,17,1186].includes(oid))throw fail('RISINGWAVE_KEY_TYPE_UNSUPPORTED','Choose a visible scalar key with native stable equality.');
    return {oid:String(oid),value:normalized};
  }));
}
