// MIT. Open-Meteo product identity, exact public requests and original result semantics.
import {createHash} from 'node:crypto';
export const SCHEMA='stellar-forge.open-meteo-operations.v1';
export const MAX_RESPONSE_BYTES=1048576;
export const FAMILIES=Object.freeze({
 forecast:{title:'Operational forecast',origin:'https://api.open-meteo.com',path:'/v1/forecast',
  merchantPath:'/weather/forecast',operation:'weatherForecast',maxDays:16,model:'best_match',
  models:['best_match','icon_seamless','gfs_seamless','ecmwf_ifs025'],
  meaning:'Current stitched operational model forecast; Best Match may combine models.',
  docs:'https://open-meteo.com/en/docs'},
 history:{title:'Historical reanalysis',origin:'https://archive-api.open-meteo.com',path:'/v1/archive',
  merchantPath:'/weather/history',operation:'weatherHistory',maxDays:31,model:'era5',
  models:['era5','era5_land'],
  meaning:'Numerical reanalysis, not a direct local station observation.',
  docs:'https://open-meteo.com/en/docs/historical-weather-api'},
 ensemble:{title:'Ensemble member forecast',origin:'https://ensemble-api.open-meteo.com',path:'/v1/ensemble',
  merchantPath:'/weather/ensemble',operation:'weatherEnsemble',maxDays:35,model:'icon_seamless',
  models:['icon_seamless','gfs_seamless','ecmwf_ifs025','gem_global'],
  meaning:'Individual returned model members; a member fraction is not a calibrated event probability.',
  docs:'https://open-meteo.com/en/docs/ensemble-api'}
});
export const VARIABLES=Object.freeze({
 temperature_2m:{title:'Air temperature at 2 m',dimension:'temperature',interval:'instant'},
 precipitation:{title:'Precipitation',dimension:'precipitation',interval:'preceding-hour-sum'},
 wind_speed_10m:{title:'Wind speed at 10 m',dimension:'wind',interval:'instant'},
 wind_gusts_10m:{title:'Wind gusts at 10 m',dimension:'wind',interval:'preceding-hour-maximum'},
 relative_humidity_2m:{title:'Relative humidity at 2 m',dimension:'percent',interval:'instant'},
 shortwave_radiation:{title:'Shortwave radiation',dimension:'radiation',interval:'preceding-hour-mean'}
});
export function variableInterval(request,variable){
 need(Object.hasOwn(VARIABLES,variable),'VARIABLE_INVALID');
 return variable==='wind_gusts_10m'&&request.family==='history'?'instant':VARIABLES[variable].interval;
}
export const ATTRIBUTION=Object.freeze({provider:'Open-Meteo',url:'https://open-meteo.com/',
 licence:'CC BY 4.0',licenceUrl:'https://creativecommons.org/licenses/by/4.0/',
 modifications:'Original JSON is retained unchanged. Local-time display, unit conversions, coverage, comparisons, threshold evaluations and report layouts are derived by this application.'});
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export function need(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
export function keys(value,allowed,code='UNEXPECTED_FIELD'){need(plain(value)&&Object.keys(value).every(k=>allowed.includes(k)),code);}
export function text(value,name,max=240){need(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),name+'_INVALID');return value.trim();}
export function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){need(Number.isFinite(value),'NONFINITE_JSON');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 need(plain(value),'PLAIN_JSON_REQUIRED');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const encoded=value=>Buffer.from(canonical(value)+'\n');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const clone=value=>JSON.parse(canonical(value));
export function date(value){need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'DATE_INVALID');return value;}
export function zone(value){need(typeof value==='string'&&value.length<=100,'TIMEZONE_INVALID');try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);}catch{need(false,'TIMEZONE_INVALID');}return value;}
const finite=(v,min,max,name)=>{need(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,name+'_INVALID');return v;};
export function normalizeSite(input){
 keys(input,['name','latitude','longitude','timezone','elevation','cellSelection','notes']);
 const site={name:text(input.name,'SITE_NAME',120),latitude:finite(input.latitude,-90,90,'LATITUDE'),
 longitude:finite(input.longitude,-180,180,'LONGITUDE'),timezone:zone(input.timezone),
 cellSelection:input.cellSelection??'land',notes:input.notes===undefined?'':String(input.notes)};
 need(['land','sea','nearest'].includes(site.cellSelection),'CELL_SELECTION_INVALID');
 need(site.notes.length<=5000&&!site.notes.includes('\0'),'SITE_NOTES_INVALID');
 if(input.elevation!==undefined)site.elevation=input.elevation==='nan'?'nan':finite(input.elevation,-500,10000,'ELEVATION');
 return site;
}
export function normalizeRequest(input){
 keys(input,['family','model','latitude','longitude','timezone','elevation','cellSelection','variables','startDate','endDate','units']);
 need(Object.hasOwn(FAMILIES,input.family),'FAMILY_INVALID');const family=FAMILIES[input.family];
 const model=input.model??family.model;need(family.models.includes(model),'MODEL_NOT_IN_PRODUCT');
 const startDate=date(input.startDate),endDate=date(input.endDate);
 const days=(Date.parse(endDate)-Date.parse(startDate))/86400000+1;
 need(Number.isInteger(days)&&days>=1&&days<=family.maxDays,'REQUEST_WINDOW_TOO_LONG_OR_REVERSED');
 need(Array.isArray(input.variables)&&input.variables.length>=1&&input.variables.length<=6&&
  input.variables.every(v=>Object.hasOwn(VARIABLES,v))&&new Set(input.variables).size===input.variables.length,'VARIABLE_SELECTION_INVALID');
 keys(input.units??{},['temperature','wind','precipitation'],'UNITS_INVALID');
 const units={temperature:input.units?.temperature??'celsius',wind:input.units?.wind??'kmh',precipitation:input.units?.precipitation??'mm'};
 need(['celsius','fahrenheit'].includes(units.temperature)&&['kmh','ms','mph','kn'].includes(units.wind)&&['mm','inch'].includes(units.precipitation),'UNITS_INVALID');
 const result={family:input.family,model,latitude:finite(input.latitude,-90,90,'LATITUDE'),
  longitude:finite(input.longitude,-180,180,'LONGITUDE'),timezone:zone(input.timezone),
  cellSelection:input.cellSelection??'land',variables:[...input.variables],startDate,endDate,units};
 need(['land','sea','nearest'].includes(result.cellSelection),'CELL_SELECTION_INVALID');
 if(input.elevation!==undefined)result.elevation=input.elevation==='nan'?'nan':finite(input.elevation,-500,10000,'ELEVATION');
 return result;
}
export function publicQuery(input){
 const r=normalizeRequest(input),p=new URLSearchParams();
 for(const [k,v]of Object.entries({latitude:r.latitude,longitude:r.longitude,timezone:r.timezone,models:r.model,
  start_date:r.startDate,end_date:r.endDate,hourly:r.variables.join(','),timeformat:'unixtime',
  temperature_unit:r.units.temperature,wind_speed_unit:r.units.wind,precipitation_unit:r.units.precipitation,
  cell_selection:r.cellSelection,...(r.elevation===undefined?{}:{elevation:r.elevation})}))p.set(k,String(v));
 return p;
}
export const QUERY_NAMES=['latitude','longitude','timezone','models','start_date','end_date','hourly','timeformat',
 'temperature_unit','wind_speed_unit','precipitation_unit','cell_selection','elevation'];
export function requestFromQuery(family,params){
 need(params instanceof URLSearchParams,'QUERY_REQUIRED');const seen=new Set();
 for(const [k]of params){need(QUERY_NAMES.includes(k)&&!seen.has(k),'UNDECLARED_OR_DUPLICATE_QUERY');seen.add(k);}
 need(params.get('timeformat')==='unixtime','UNIX_TIME_REQUIRED');
 const numeric=k=>{const v=params.get(k);need(v!==null&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v),'COORDINATE_INVALID');return Number(v);};
 const r=normalizeRequest({family,model:params.get('models'),latitude:numeric('latitude'),longitude:numeric('longitude'),
  timezone:params.get('timezone'),startDate:params.get('start_date'),endDate:params.get('end_date'),
  variables:(params.get('hourly')??'').split(','),units:{temperature:params.get('temperature_unit'),wind:params.get('wind_speed_unit'),precipitation:params.get('precipitation_unit')},
  cellSelection:params.get('cell_selection'),...(params.has('elevation')?{elevation:params.get('elevation')==='nan'?'nan':numeric('elevation')}:{})});
 // Keep one exact query representation for review, price, response and replay.
 need(publicQuery(r).toString()===params.toString(),'CANONICAL_WEATHER_QUERY_REQUIRED');return r;
}
export function providerProfile(input={mode:'evaluation'}){
 keys(input,['mode','apiKeyEnv','proxyEnv']);
 need(['evaluation','professional'].includes(input.mode),'PROVIDER_MODE_INVALID');
 if(input.mode==='professional')need(/^[A-Z][A-Z0-9_]{1,127}$/.test(input.apiKeyEnv??''),'PROVIDER_KEY_REFERENCE_REQUIRED');
 else need(input.apiKeyEnv===undefined,'EVALUATION_HAS_NO_PROVIDER_KEY');
 if(input.proxyEnv!==undefined)need(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input.proxyEnv),'PROXY_REFERENCE_INVALID');
 return clone(input);
}
export function providerUrl(request,profile,{env=process.env,credential=false}={}){
 const p=providerProfile(profile),r=normalizeRequest(request),f=FAMILIES[r.family],url=new URL(f.path,f.origin);
 if(p.mode==='professional')url.hostname='customer-'+url.hostname;
 url.search=publicQuery(r).toString();
 if(credential&&p.mode==='professional'){
  const key=env[p.apiKeyEnv];need(typeof key==='string'&&key.length>0&&key.length<=512&&!/[\x00-\x20\x7f]/.test(key),'PROVIDER_KEY_UNAVAILABLE');
  url.searchParams.set('apikey',key);
 }
 return url;
}
export function parsePayload(bytes,request){
 need(bytes instanceof Uint8Array&&bytes.byteLength<=MAX_RESPONSE_BYTES,'WEATHER_RESPONSE_TOO_LARGE');
 const r=normalizeRequest(request);let payload;
 try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'WEATHER_RESPONSE_JSON_INVALID');}
 need(plain(payload)&&!payload.error&&plain(payload.hourly)&&plain(payload.hourly_units),'WEATHER_HOURLY_RESPONSE_REQUIRED');
 need(typeof payload.latitude==='number'&&Number.isFinite(payload.latitude)&&Math.abs(payload.latitude)<=90&&
  typeof payload.longitude==='number'&&Number.isFinite(payload.longitude)&&Math.abs(payload.longitude)<=180,'WEATHER_GRID_INVALID');
 const timezone=zone(payload.timezone);need(Number.isInteger(payload.utc_offset_seconds)&&Math.abs(payload.utc_offset_seconds)<=50400,'WEATHER_OFFSET_INVALID');
 need(payload.hourly_units.time==='unixtime','WEATHER_UNIX_RESPONSE_REQUIRED');
 const times=payload.hourly.time;need(Array.isArray(times)&&times.length>0&&times.length<=24*36+1&&
  times.every((v,i)=>Number.isSafeInteger(v)&&v>=-2208988800&&v<=7258118400&&(i===0||v>times[i-1]&&(v-times[i-1])%3600===0)),'WEATHER_TIME_AXIS_INVALID');
 const columns=[];
 for(const [key,values]of Object.entries(payload.hourly)){
  if(key==='time')continue;
  const variable=r.variables.find(v=>key===v||key.startsWith(v+'_member'));
  need(variable!==undefined,'UNREQUESTED_WEATHER_COLUMN');
  let member=null;
  if(key!==variable){const match=key.slice(variable.length).match(/^_member(\d{1,3})$/);need(r.family==='ensemble'&&match,'WEATHER_MEMBER_INVALID');member=Number(match[1]);}
  else if(r.family==='ensemble')member=0;
  need(Array.isArray(values)&&values.length===times.length&&values.every(v=>v===null||typeof v==='number'&&Number.isFinite(v)),'WEATHER_COLUMN_INVALID');
  const unit=payload.hourly_units[key]??payload.hourly_units[variable];need(typeof unit==='string'&&unit.length<=30,'WEATHER_UNIT_MISSING');
  need(!columns.some(c=>c.variable===variable&&c.member===member),'DUPLICATE_WEATHER_MEMBER');
  columns.push({key,variable,member,unit,values:[...values],interval:variableInterval(r,variable)});
 }
 need(columns.length>=1&&columns.length<=6*128,'WEATHER_COLUMN_COUNT_INVALID');
 return {payload,request:r,times:[...times],columns,metadata:{
  requested:{latitude:r.latitude,longitude:r.longitude,timezone:r.timezone,elevation:r.elevation??null,cellSelection:r.cellSelection},
  grid:{latitude:payload.latitude,longitude:payload.longitude,elevation:payload.elevation??null},
  timezone,apiUtcOffsetSeconds:payload.utc_offset_seconds,family:r.family,model:r.model,meaning:FAMILIES[r.family].meaning,
  generationTimeMs:typeof payload.generationtime_ms==='number'&&Number.isFinite(payload.generationtime_ms)?payload.generationtime_ms:null,
  timeMeaning:'UTC epoch seconds; local display uses the returned IANA zone. The API fixed offset is retained separately.',
  unreturnedVariables:r.variables.filter(v=>!columns.some(c=>c.variable===v)),attribution:ATTRIBUTION
 }};
}
const timeFormatters=new Map();
export function localTimestamp(epochSeconds,timeZone){
 let formatter=timeFormatters.get(timeZone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'});if(timeFormatters.size>=64)timeFormatters.delete(timeFormatters.keys().next().value);timeFormatters.set(timeZone,formatter);}
 const parts=formatter.formatToParts(new Date(epochSeconds*1000));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {utc:new Date(epochSeconds*1000).toISOString(),local:p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute+':'+p.second,offset:p.timeZoneName,timezone:timeZone};
}
