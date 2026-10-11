// MIT. Current and hourly adaptation of the linked One Call 4.0 contract.
import {createHash} from 'node:crypto';
export const SOURCE=Object.freeze({url:'https://openweathermap.org/api/one-call-4',retrievedOn:'2026-10-11',
  product:'OpenWeather One Call 4.0',origin:'https://api.openweathermap.org',
  current:'/data/4.0/onecall/current',hourly:'/data/4.0/onecall/timeline/1h',hourlyPageRecords:20});
export const SCHEMA='stellar-forge.openweather-project.v1';
export const DATA_SCHEMA='stellar-forge.openweather-delivery.v1';
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const stable=v=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const digest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:stable(v)).digest('hex');
export const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
export function text(v,label,max=160){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('INVALID_INPUT',label+' must be nonempty text within '+max+' characters');return v.trim();}
export function identifier(v,label='Identifier'){if(typeof v!=='string'||['constructor','prototype','__proto__'].includes(v)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v))fail('INVALID_INPUT',label+' needs 1–64 letters, digits, underscores or hyphens');return v;}
export function integer(v,label,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)fail('INVALID_INPUT',label+' must be an integer from '+min+' to '+max);return v;}
export const epoch=(v,label)=>integer(v,label,-2208988800,7258118400);
function number(v,label,min=-Number.MAX_VALUE,max=Number.MAX_VALUE){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('RESPONSE_CONTRACT',label+' is outside its documented numeric range',502);return v;}
export function settings(v){
  if(!plain(v))fail('INVALID_INPUT','Project settings must be an object');
  const lat=number(v.lat,'Latitude',-90,90),lon=number(v.lon,'Longitude',-180,180);
  if(!['standard','metric','imperial'].includes(v.units))fail('INVALID_INPUT','Choose standard, metric or imperial units');
  const lang=v.lang===undefined||v.lang===''||v.lang===null?null:text(v.lang,'Language',16);
  if(lang!==null&&!/^[A-Za-z_]+$/.test(lang))fail('INVALID_INPUT','Use a provider language code');
  const keyEnv=text(v.keyEnv??'OPENWEATHER_API_KEY','API key environment name',128);
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv))fail('INVALID_INPUT','Use an API key environment-variable name');
  return {label:text(v.label,'Project label'),lat,lon,units:v.units,lang,keyEnv,
    maxPages:integer(v.maxPages??25,'Hourly page limit',1,10000),timeoutMs:integer(v.timeoutMs??20000,'Request deadline',1000,120000)};
}
export function units(mode){
  if(!['standard','metric','imperial'].includes(mode))fail('INVALID_INPUT','Unknown unit mode');
  return {temperature:mode==='standard'?'K':mode==='metric'?'°C':'°F',wind:mode==='imperial'?'mph':'m/s',
    pressure:'hPa',humidity:'%',clouds:'%',visibility:'m',precipitation:'mm/h',probability:'fraction',time:'Unix seconds UTC'};
}
export const FIELD_MAP=Object.freeze([
  ['data[].dt','at','Unix seconds UTC; local display uses the returned IANA time zone'],
  ['data[].temp','temperature','Selected unit mode'],['data[].feels_like','feelsLike','Selected unit mode'],
  ['data[].dew_point','dewPoint','Selected unit mode'],['data[].pressure','pressure','hPa'],
  ['data[].humidity','humidity','Percent'],['data[].clouds','clouds','Percent'],['data[].visibility','visibility','Metres'],
  ['data[].uvi','uvIndex','UV index'],['data[].wind_speed','windSpeed','m/s in standard or metric; mph in imperial'],
  ['data[].wind_gust','windGust','Same wind units; absence retained'],['data[].wind_deg','windDirection','Meteorological degrees'],
  ['data[].rain.1h','rainRate','mm/h in every unit mode; absence retained'],['data[].snow.1h','snowRate','mm/h in every unit mode; absence retained'],
  ['data[].pop','precipitationProbability','Original fraction 0–1; percent display multiplies by 100'],
  ['data[].sunrise / sunset','sunrise / sunset','Unix seconds UTC; polar absence retained'],
  ['data[].weather / alerts','weather / alertIds','Provider conditions and alert identifiers retained']]);
export function requestURL(kind,s,start){
  const u=new URL(SOURCE[kind],SOURCE.origin);u.searchParams.set('lat',String(s.lat));u.searchParams.set('lon',String(s.lon));
  u.searchParams.set('units',s.units);if(s.lang)u.searchParams.set('lang',s.lang);
  if(kind==='hourly')u.searchParams.set('start',String(epoch(start,'Hourly start')));return u.href;
}
/** Follow the provider's continuation while confining the origin, endpoint and selected query. */
export function continuation(value,kind,s){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||value.length>8192)fail('RESPONSE_CONTRACT','Invalid provider continuation',502);
  let u;try{u=new URL(value);}catch{fail('RESPONSE_CONTRACT','Provider continuation must be absolute',502);}
  if(u.origin!==SOURCE.origin||u.pathname!==SOURCE[kind]||u.username||u.password||u.hash)fail('RESPONSE_CONTRACT','Continuation left the selected endpoint',502);
  for(const [name,expected] of [['lat',s.lat],['lon',s.lon]]){
    const values=u.searchParams.getAll(name);
    if(values.length!==1||!Number.isFinite(Number(values[0]))||Math.abs(Number(values[0])-expected)>0.000051)
      fail('RESPONSE_CONTRACT','Provider continuation changed '+name,502);
  }
  for(const [name,expected] of [['units',s.units],['lang',s.lang]]){
    const values=u.searchParams.getAll(name);
    if(values.length>1||values.length&&values[0]!==expected)fail('RESPONSE_CONTRACT','Provider continuation changed '+name,502);
    if(expected!==null&&!values.length)u.searchParams.set(name,expected);
  }
  if(u.searchParams.getAll('appid').length>1)fail('RESPONSE_CONTRACT','Repeated provider appid',502);
  u.searchParams.delete('appid');
  if(kind==='hourly'){
    const starts=u.searchParams.getAll('start');
    if(starts.length!==1||!/^[-]?\d+$/.test(starts[0]))fail('RESPONSE_CONTRACT','Hourly continuation needs one Unix start',502);
    epoch(Number(starts[0]),'Provider continuation start');
  }
  return u.href;
}
export function credential(s,env=process.env){
  const key=env[s.keyEnv];
  if(typeof key!=='string'||!key||key.trim()!==key||/[\s\x00-\x1f\x7f]/.test(key))
    fail('CREDENTIAL_REQUIRED','Set '+s.keyEnv+' in the weather server launch environment',409);
  return key;
}
export function redact(value,key=''){
  const visit=x=>{
    if(typeof x==='string'){let s=key?x.split(key).join('[redacted]'):x;return s.replace(/([?&]appid=)[^&\s"<>]*/gi,'$1[redacted]');}
    if(Array.isArray(x))return x.map(visit);
    if(plain(x))return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k.toLowerCase()==='appid'?'[redacted]':visit(v)]));
    return x;
  };return visit(value);
}
function record(raw){
  if(!plain(raw))fail('RESPONSE_CONTRACT','Weather record must be an object',502);
  const out={at:epoch(raw.dt,'Weather timestamp')};
  const fields={temp:'temperature',feels_like:'feelsLike',dew_point:'dewPoint',pressure:'pressure',humidity:'humidity',
    clouds:'clouds',visibility:'visibility',uvi:'uvIndex',wind_speed:'windSpeed',wind_gust:'windGust',wind_deg:'windDirection',pop:'precipitationProbability'};
  for(const [from,to] of Object.entries(fields))if(Object.hasOwn(raw,from)){
    const range=['humidity','clouds'].includes(from)?[0,100]:from==='pop'?[0,1]:from==='wind_deg'?[0,360]:
      ['pressure','visibility','uvi','wind_speed','wind_gust'].includes(from)?[0,Number.MAX_VALUE]:[];
    out[to]=number(raw[from],from,...range);
  }
  for(const name of ['sunrise','sunset'])if(Object.hasOwn(raw,name))out[name]=epoch(raw[name],name);
  for(const [from,to] of [['rain','rainRate'],['snow','snowRate']])if(raw[from]!==undefined){
    if(!plain(raw[from]))fail('RESPONSE_CONTRACT',from+' must be an object',502);
    if(Object.hasOwn(raw[from],'1h'))out[to]=number(raw[from]['1h'],from+'.1h',0);
  }
  if(raw.weather!==undefined){if(!Array.isArray(raw.weather)||raw.weather.some(v=>!plain(v)||!Number.isSafeInteger(v.id)))fail('RESPONSE_CONTRACT','Invalid weather conditions',502);out.weather=structuredClone(raw.weather);}
  if(raw.alerts!==undefined){if(!Array.isArray(raw.alerts)||raw.alerts.some(v=>typeof v!=='string'))fail('RESPONSE_CONTRACT','Invalid alert identifiers',502);out.alertIds=[...raw.alerts];}
  return out;
}
export function normalizePage(body,kind,s){
  if(!plain(body)||!Array.isArray(body.data)||body.data.length>(kind==='current'?1:SOURCE.hourlyPageRecords))fail('RESPONSE_CONTRACT','One Call 4.0 needs a data array within its documented page size',502);
  if(kind==='current'&&body.data.length!==1)fail('RESPONSE_CONTRACT','Current weather needs its one record',502);
  const lat=number(body.lat,'Response latitude',-90,90),lon=number(body.lon,'Response longitude',-180,180);
  const timezone=text(body.timezone,'Provider time zone',128);
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(0);}catch{fail('RESPONSE_CONTRACT','Provider time zone is not a supported IANA identifier',502);}
  const timezoneOffset=integer(body.timezone_offset,'Provider timezone offset',-86400,86400);
  const rows=body.data.map(record);
  if(rows.some((r,i)=>i>0&&r.at<=rows[i-1].at))fail('RESPONSE_CONTRACT','Page timestamps must be strictly increasing',502);
  return {lat,lon,timezone,timezoneOffset,units:units(s.units),rows,
    next:continuation(body.next,kind,s),prev:continuation(body.prev,kind,s)};
}
export function retryPolicy(status,headers,now=Date.now()){
  const raw=headers.get('retry-after');let retryAt=null;
  if(raw){const t=/^\d+$/.test(raw)?now+Number(raw)*1000:Date.parse(raw);if(Number.isFinite(t))retryAt=new Date(Math.max(t,now)).toISOString();}
  if(status===429)return {state:'RATE_LIMITED',retryable:true,retryAt,message:'Provider call limit reached; reconcile account usage before continuing'};
  if(status===401)return {state:'AUTH_REQUIRED',retryable:false,retryAt:null,message:'Provider rejected the key or One Call subscription'};
  if(status===400)return {state:'INVALID_REQUEST',retryable:false,retryAt:null,message:'Correct the provider parameters before a new acquisition'};
  if(status===404)return {state:'UNAVAILABLE',retryable:false,retryAt:null,message:'Requested provider data is unavailable'};
  return {state:status>=500?'SOURCE_ERROR':'REJECTED',retryable:status>=500,retryAt,message:status>=500?'Provider failed this request; completed pages remain available':'Provider rejected the request'};
}
