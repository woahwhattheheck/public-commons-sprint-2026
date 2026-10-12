'use strict';

/* Original, dependency-free data utilities for the GridFabric operator application.
 * Published vendor wire contracts remain in contracts/plaid-public-contract.json.
 */
class DomainError extends Error {
  constructor(code, message, details = {}, httpStatus = 400) {
    super(message); this.name = 'DomainError'; this.code = code;
    this.details = details; this.http_status = httpStatus;
  }
}
function fail(code, message, details, status) { throw new DomainError(code, message, details, status); }
function assert(ok, code, message, details, status) { if (!ok) fail(code, message, details, status); }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function canonical(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { assert(Number.isFinite(v), 'INVALID_NUMBER', 'JSON numbers must be finite.'); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  assert(object(v), 'INVALID_JSON_VALUE', 'Expected a JSON value.');
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
function text(v, label, optional = false) {
  if (optional && (v === undefined || v === null || v === '')) return null;
  assert(typeof v === 'string' && v.length > 0, 'INVALID_FIELD', label + ' must be a nonempty string.');
  return v;
}
function integer(v, label, min = 0) {
  assert(Number.isSafeInteger(v) && v >= min, 'INVALID_FIELD', label + ' must be a safe integer >= ' + min + '.');
  return v;
}
function pointer(root, path, required = false) {
  if (path === '') return root;
  assert(typeof path === 'string' && path.startsWith('/'), 'INVALID_POINTER', 'A JSON pointer must be empty or begin with /.', {path});
  let value = root;
  for (const part of path.slice(1).split('/')) {
    assert(!/~(?:[^01]|$)/.test(part), 'INVALID_POINTER', 'A JSON pointer has an invalid escape.', {path});
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) {
      if (required) fail('MISSING_POINTER', 'The original JSON does not contain a required field.', {path});
      return undefined;
    }
    value = value[key];
  }
  return value;
}
function assignPointer(root, path, value) {
  assert(typeof path === 'string' && path.startsWith('/'), 'INVALID_POINTER', 'A response binding requires a non-root pointer.');
  const pieces = path.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = pieces.pop(); let node = root;
  for (const key of pieces) {
    assert(object(node) || Array.isArray(node), 'INVALID_POINTER', 'The response template does not contain the bound path.', {path});
    assert(Object.prototype.hasOwnProperty.call(node, key), 'INVALID_POINTER', 'The response template does not contain the bound path.', {path});
    node = node[key];
  }
  assert((object(node) || Array.isArray(node)) && Object.prototype.hasOwnProperty.call(node, last),
    'INVALID_POINTER', 'The response template does not contain the bound field.', {path});
  node[last] = clone(value); return root;
}
function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const n = a % b; a = b; b = n; } return a; }
function rational(n, d = 1n) {
  assert(d !== 0n, 'ZERO_DENOMINATOR', 'A calculation denominator is zero.');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); return {n:n / g, d:d / g};
}
function decimal(value) {
  assert(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)),
    'INVALID_DECIMAL', 'A measurement must be a decimal string or finite JSON number.');
  const s = String(value).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  assert(m, 'INVALID_DECIMAL', 'A measurement is not a decimal number.', {value:s});
  const exponent = Number(m[4] || 0), fraction = m[3] || '';
  assert(Math.abs(exponent) <= 1000 && m[2].length + fraction.length <= 1000, 'DECIMAL_LIMIT', 'The decimal exceeds the supported exact precision.');
  let n = BigInt(m[2] + fraction); if (m[1] === '-') n = -n;
  const scale = fraction.length - exponent;
  return scale >= 0 ? rational(n, 10n ** BigInt(scale)) : rational(n * 10n ** BigInt(-scale));
}
function add(a, b) { return rational(a.n*b.d+b.n*a.d, a.d*b.d); }
function mul(a, b) { return rational(a.n*b.n, a.d*b.d); }
function div(a, b) { return rational(a.n*b.d, a.d*b.n); }
function equal(a, b) { return a.n*b.d === b.n*a.d; }
function decimalString(value, places = 6) {
  integer(places, 'decimal_places'); assert(places <= 12, 'INVALID_PRECISION', 'At most twelve output decimal places are supported.');
  const scale = 10n ** BigInt(places), negative = value.n < 0n;
  const absolute = negative ? -value.n : value.n, scaled = absolute * scale;
  let rounded = scaled / value.d; const remainder = scaled % value.d;
  // One declared rounding rule: nearest, with exact halves away from zero.
  if (remainder * 2n >= value.d) rounded += 1n;
  let digits = rounded.toString().padStart(places + 1, '0');
  if (places) digits = digits.slice(0, -places) + '.' + digits.slice(-places);
  digits = places ? digits.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return (negative && rounded !== 0n ? '-' : '') + digits;
}
function safeWireNumber(value, places) {
  const value_decimal = decimalString(value, places), wire = Number(value_decimal);
  assert(Number.isFinite(wire) && equal(decimal(String(wire)), decimal(value_decimal)),
    'WIRE_PRECISION_LOSS', 'The requested number cannot be represented faithfully as a JSON number.', {value_decimal});
  return {value:wire, value_decimal, exact_numerator:value.n.toString(), exact_denominator:value.d.toString(), rounding:'nearest_half_away_from_zero'};
}
function microseconds(value, format) {
  if (format === 'epoch_seconds') {
    const r = mul(decimal(value), rational(1000000n));
    assert(r.d === 1n && r.n >= 0n && r.n <= BigInt(Number.MAX_SAFE_INTEGER),
      'INVALID_TIMESTAMP', 'Epoch seconds must resolve to an exact nonnegative microsecond.');
    return Number(r.n);
  }
  assert(format === 'iso8601', 'INVALID_TIMESTAMP_FORMAT', 'timestamp_format must be iso8601 or epoch_seconds.');
  assert(typeof value === 'string', 'INVALID_TIMESTAMP', 'An ISO timestamp must be a string.');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  assert(m, 'INVALID_TIMESTAMP', 'Use an ISO timestamp with seconds and an explicit UTC offset.', {value});
  const y=Number(m[1]), mo=Number(m[2]), day=Number(m[3]), h=Number(m[4]), mi=Number(m[5]), s=Number(m[6]);
  assert(mo>=1 && mo<=12 && day>=1 && day<=31 && h<24 && mi<60 && s<60, 'INVALID_TIMESTAMP', 'The timestamp has an invalid calendar component.', {value});
  const d=new Date(0); d.setUTCFullYear(y,mo-1,day); d.setUTCHours(h,mi,s,0);
  assert(d.getUTCFullYear()===y && d.getUTCMonth()===mo-1 && d.getUTCDate()===day,
    'INVALID_TIMESTAMP', 'The timestamp date does not exist.', {value});
  let offset=0;
  if(m[8]!=='Z') {
    const oh=Number(m[8].slice(1,3)), om=Number(m[8].slice(4,6));
    assert(oh<=23 && om<60, 'INVALID_TIMESTAMP', 'The UTC offset is invalid.', {value});
    offset=(oh*60+om)*60000*(m[8][0]==='+'?1:-1);
  }
  const result=(d.getTime()-offset)*1000+Number((m[7]||'').padEnd(6,'0'));
  assert(Number.isSafeInteger(result) && result>=0, 'INVALID_TIMESTAMP', 'The timestamp is outside the supported exact microsecond range.', {value});
  return result;
}
function seconds(v, label) { return integer(v, label); }
function *csvRecords(raw) {
  assert(typeof raw === 'string', 'INVALID_CSV', 'CSV input must be UTF-8 text.');
  const input=raw.charCodeAt(0)===0xfeff?raw.slice(1):raw;
  let fields=[], field='', quoted=false, afterQuote=false, line=1, startLine=1, touched=false;
  for(let i=0;i<input.length;i++) {
    const ch=input[i]; touched=true;
    if(quoted) {
      if(ch==='"') { if(input[i+1]==='"') { field+='"'; i++; } else {quoted=false;afterQuote=true;} }
      else {field+=ch;if(ch==='\n')line++;}
      continue;
    }
    if(afterQuote && ch!==',' && ch!=='\r' && ch!=='\n') fail('INVALID_CSV','Unexpected characters after a quoted field.',{line});
    if(ch==='"') {assert(field===''&&!afterQuote,'INVALID_CSV','A quote occurs inside an unquoted field.',{line});quoted=true;continue;}
    if(ch===',') {fields.push(field);field='';afterQuote=false;continue;}
    if(ch==='\r'||ch==='\n') {
      if(ch==='\r'&&input[i+1]==='\n')i++;
      fields.push(field);
      yield {fields,line:startLine};
      fields=[];field='';afterQuote=false;touched=false;line++;startLine=line;continue;
    }
    field+=ch;
  }
  assert(!quoted,'INVALID_CSV','An input field has no closing quote.',{line:startLine});
  if(touched||fields.length||field!==''||afterQuote) {fields.push(field);yield {fields,line:startLine};}
}
function *sourceRecords(raw, format, profile) {
  if(format==='csv') {
    let headers=null, index=0;
    for(const record of csvRecords(raw)) {
      if(headers===null) {
        headers=record.fields;
        assert(headers.length && headers.every(h=>h!==''), 'INVALID_CSV_HEADER', 'Every CSV column requires a name.');
        assert(new Set(headers).size===headers.length,'DUPLICATE_CSV_HEADER','CSV column names must be unique.');
        continue;
      }
      index++;
      if(record.fields.length!==headers.length) {yield {index,line:record.line,error:{code:'CSV_COLUMN_COUNT',message:'The row column count differs from the original header.',details:{expected:headers.length,actual:record.fields.length}}};continue;}
      const row=Object.create(null);headers.forEach((h,j)=>{row[h]=record.fields[j];});
      yield {index,line:record.line,row};
    }
    assert(headers!==null,'EMPTY_SOURCE','The CSV has no header.');return;
  }
  assert(format==='json','INVALID_SOURCE_FORMAT','A parsed source must use csv or json.');
  let parsed;try {parsed=JSON.parse(raw);}catch(e){fail('INVALID_JSON','The original source is not valid JSON.',{message:e.message});}
  const rows=pointer(parsed,profile.rows_pointer===undefined?'':profile.rows_pointer,true);
  assert(Array.isArray(rows),'INVALID_SOURCE_ROWS','The configured rows pointer must select an array.');
  for(let i=0;i<rows.length;i++) yield {index:i+1,line:null,row:rows[i]};
}
const UNIT={Wh:{kind:'energy',scale:1},kWh:{kind:'energy',scale:1000},W:{kind:'power',scale:1},kW:{kind:'power',scale:1000},status:{kind:'status',scale:1}};
function normalizeRow(record, format, profile) {
  assert(object(record.row),'INVALID_SOURCE_ROW','Each parsed source row must be an object.');
  const fields=profile.fields||{},constants=profile.constants||{};
  const get=name=>{
    if(Object.prototype.hasOwnProperty.call(constants,name))return constants[name];
    if(!Object.prototype.hasOwnProperty.call(fields,name))return undefined;
    return format==='csv'?record.row[fields[name]]:pointer(record.row,fields[name],false);
  };
  const device_id=text(get('device_id'),'device_id'),channel=text(get('channel'),'channel');
  const kind=text(get('kind'),'kind'),unit=text(get('unit'),'unit');
  assert(UNIT[unit]&&UNIT[unit].kind===kind,'INVALID_UNIT','Declare an exact unit compatible with the source kind.',{kind,unit});
  const start_us=microseconds(get('start'),profile.timestamp_format);
  const hasEnd=get('end')!==undefined&&get('end')!==null&&get('end')!=='';
  let end_us=hasEnd?microseconds(get('end'),profile.timestamp_format):null;
  if(end_us===null&&profile.end_default_seconds!==undefined) end_us=start_us+integer(profile.end_default_seconds,'end_default_seconds',1)*1000000;
  const semantics=typeof profile.value_semantics==='string'?profile.value_semantics:profile.value_semantics&&profile.value_semantics[kind];
  const expected=kind==='energy'?['interval_energy']:kind==='power'?['interval_average_power','instantaneous_power']:['status'];
  assert(expected.includes(semantics),'INVALID_VALUE_SEMANTICS','Declare the original measurement semantics.',{kind,semantics});
  if(semantics==='interval_energy'||semantics==='interval_average_power') assert(Number.isSafeInteger(end_us)&&end_us>start_us,'INVALID_INTERVAL','An interval requires its original end or an explicit positive default duration.');
  else {if(end_us===null)end_us=start_us;assert(end_us>=start_us,'INVALID_INTERVAL','An interval end precedes its start.');}
  const data_quality=get('data_quality');
  if(data_quality!==undefined&&data_quality!==null&&data_quality!=='')text(data_quality,'data_quality');
  let value_decimal=null,status=null;
  if(kind==='status') {
    status=get('status');if(typeof status==='string'){try{status=JSON.parse(status);}catch(e){fail('INVALID_STATUS_JSON','A CSV status must contain its original JSON object.');}}
    assert(object(status),'INVALID_STATUS','A status measurement requires its original status object.');
  } else {const value=get('value');decimal(value);value_decimal=String(value).trim();}
  return {device_id,channel,kind,unit,start_us,end_us,value_decimal,status:clone(status),data_quality:data_quality||null,
    value_semantics:semantics,original_row:clone(record.row),original_record:record.index,original_line:record.line};
}
function envReferences(v, name) {
  if(v===undefined)return {};
  assert(object(v),'INVALID_ENV_REFERENCES',name+' must map header names to environment variable names.');
  const result={};
  for(const [key,value] of Object.entries(v)) {
    assert(/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(key),'INVALID_HEADER','A configured header name is invalid.');
    assert(!['host','content-length','transfer-encoding','connection'].includes(key.toLowerCase()),'FORBIDDEN_HEADER','The HTTP transport owns this header.',{header:key});
    assert(typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value),'INVALID_ENV_REFERENCE','Store an environment variable name, without its secret value.');
    result[key]=value;
  }
  return result;
}
function httpUrl(value, label) {
  text(value,label);
  assert(/^https?:\/\/[^\/?#@\s]+(?:\/[^?#\s]*)?$/.test(value),'INVALID_ENDPOINT',label+' must be an http(s) endpoint without credentials, query or fragment.');
  return value;
}
module.exports={DomainError,fail,assert,clone,object,canonical,text,integer,pointer,assignPointer,
  rational,decimal,add,mul,div,equal,decimalString,safeWireNumber,microseconds,seconds,csvRecords,sourceRecords,normalizeRow,UNIT,envReferences,httpUrl};
