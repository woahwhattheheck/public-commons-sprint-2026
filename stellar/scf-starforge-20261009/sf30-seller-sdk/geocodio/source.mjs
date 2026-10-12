// MIT. Address intake and Geocodio match review; native CSV/query engines remain shared.
import {createHash} from 'node:crypto';
import {createCsvRecordParser} from '../dataset-handler.mjs';
import {parseRows,isSourceNumber} from '../socrata/source.mjs';

export const INTAKE_SCHEMA = 'commons.geocodio-address-intake.v1';
export const RESPONSE_SCHEMA = 'stellar-forge.geocodio-response.v1';
export const SOURCE_SCHEMA = 'stellar-forge.geocodio-source.v1';
export const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(sortValue(value));
export const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
export const fail = (code,message,status=400) => Object.assign(new Error(message),{code,status});
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));
  return value;
}
const forbidden = new Set(['__proto__','prototype','constructor']);
const QUERY_FIELDS = ['street','street2','city','county','state_province','postal_code','country'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^q_[a-f0-9]{64}$/;
const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
export function parseJSON(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw fail('GEOCODIO_JSON','Read a complete UTF-8 JSON file.'); }
}
export function readCsvRecords(bytes,{maxRows=1000000,maxCellChars=65536}={}) {
  if (!Buffer.isBuffer(bytes) || bytes.length>256*1024*1024) throw fail('GEOCODIO_CSV','CSV must fit within 256 MiB.');
  const rows=[];let headers=null;
  const parser=createCsvRecordParser(cells=>{
    if (!headers) {
      if (!cells.length || cells.some(v=>!v || forbidden.has(v)) || new Set(cells).size!==cells.length)
        throw fail('GEOCODIO_CSV','CSV headers must be nonempty, unique field names.');
      headers=cells;return;
    }
    if (cells.length!==headers.length) throw fail('GEOCODIO_CSV','CSV record '+(rows.length+2)+' has a different field count.');
    if(rows.length>=maxRows)throw fail('GEOCODIO_CSV','CSV exceeds the configured record limit.');
    rows.push(Object.fromEntries(headers.map((name,i)=>[name,cells[i]])));
  },maxCellChars);
  parser.feed(new TextDecoder('utf-8',{fatal:true}).decode(bytes));parser.end();
  if (!headers) throw fail('GEOCODIO_CSV','The CSV needs a header record.');
  return {headers,rows};
}
export function readJSONSourceRecords(bytes) {
  const retain=value=>isSourceNumber(value)?value.text:Array.isArray(value)?value.map(retain):
    object(value)?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,retain(child)])):value;
  try { return parseRows(bytes).map(retain); }
  catch(error) { throw fail('GEOCODIO_SOURCE_JSON',error.message); }
}
function field(record,path) {
  if (typeof path!=='string' || !path || path.length>256) throw fail('GEOCODIO_MAPPING','Choose a source field name.');
  if (own(record,path)) return record[path];
  let value=record;
  for(const part of path.split('.')) {
    if(forbidden.has(part) || !object(value) || !own(value,part))return undefined;
    value=value[part];
  }
  return value;
}
function textValue(value,label) {
  if(value===undefined||value===null)return '';
  if(typeof value!=='string'&&typeof value!=='number')throw fail('GEOCODIO_MAPPING',label+' must contain scalar address text.');
  if(typeof value==='number' && (!Number.isFinite(value)||!Number.isSafeInteger(value)))
    throw fail('GEOCODIO_MAPPING',label+' must retain its original string value.');
  const result=String(value).trim();
  if(result.length>1000 || /[\x00-\x1f\x7f]/.test(result))throw fail('GEOCODIO_MAPPING',label+' contains unsupported address text.');
  return result;
}
export function normalizeMapping(raw) {
  if(!object(raw)||!object(raw.address))throw fail('GEOCODIO_MAPPING','Declare the original address fields.');
  const address={};
  for(const [name,spec] of Object.entries(raw.address)) {
    if(!QUERY_FIELDS.includes(name)||!object(spec))throw fail('GEOCODIO_MAPPING','Unknown address mapping: '+name);
    if(own(spec,'constant')) {
      if(Object.keys(spec).some(key=>key!=='constant'))throw fail('GEOCODIO_MAPPING','Choose a constant or source columns.');
      address[name]={constant:textValue(spec.constant,name)};
    }else{
      if(!Array.isArray(spec.columns)||!spec.columns.length||spec.columns.length>8||
          spec.columns.some(key=>typeof key!=='string'||!key||key.length>256)||
          Object.keys(spec).some(key=>!['columns','separator'].includes(key)))
        throw fail('GEOCODIO_MAPPING','Use 1–8 source columns for each address component.');
      const separator=spec.separator??' ';
      if(typeof separator!=='string'||separator.length>4||/[\x00-\x1f\x7f]/.test(separator))
        throw fail('GEOCODIO_MAPPING','Use a printable address separator up to four characters.');
      address[name]={columns:[...spec.columns],separator};
    }
  }
  if(!address.street||!address.country||!address.city&&!address.postal_code)
    throw fail('GEOCODIO_MAPPING','Map street, country, and city or postal code.');
  const coordinates=raw.coordinates??{};
  for(const key of Object.keys(coordinates))
    if(!['latitude','longitude'].includes(key)||typeof coordinates[key]!=='string'||!coordinates[key])
      throw fail('GEOCODIO_MAPPING','Coordinate mapping uses latitude and longitude source field names.');
  const identity=raw.identity??[];
  if(!Array.isArray(identity)||identity.length>8||identity.some(key=>typeof key!=='string'||!key))
    throw fail('GEOCODIO_MAPPING','Choose up to eight source identity fields.');
  return {address,coordinates:{...coordinates},identity:[...identity]};
}
export const HPD_MAPPING = Object.freeze({
  address:{street:{columns:['house_number','street_name'],separator:' '},city:{columns:['borough']},
    state_province:{constant:'NY'},country:{constant:'US'}},
  coordinates:{latitude:'latitude_internal',longitude:'longitude_internal'},
  identity:['project_id','building_id','bbl']
});
export const SIMPLYRETS_MAPPING = Object.freeze({
  address:{street:{columns:['address.streetNumberText','address.streetName'],separator:' '},
    street2:{columns:['address.unit']},city:{columns:['address.city']},
    state_province:{columns:['address.state']},postal_code:{columns:['address.postalCode']},country:{columns:['address.country']}},
  coordinates:{latitude:'geo.lat',longitude:'geo.lng'},identity:['mlsId','listingId']
});
export function createAddressIntake({records,source,mapping=HPD_MAPPING,operationId}) {
  if(!Array.isArray(records)||!records.length||records.length>1000000||records.some(row=>!object(row)))
    throw fail('GEOCODIO_INTAKE','Read between one and one million original source records.');
  if(!object(source)||!HASH.test(source.sha256??''))throw fail('GEOCODIO_SOURCE','Retain the source file SHA-256.');
  const normalized=normalizeMapping(mapping),queries={},bindings=[],invalid=[];
  for(const [index,record] of records.entries()){
    const query={};
    try{
      for(const [name,spec] of Object.entries(normalized.address)){
        const value=own(spec,'constant')?spec.constant:spec.columns.map(key=>textValue(field(record,key),key)).filter(Boolean).join(spec.separator);
        if(value)query[name]=value;
      }
      if(!query.street||!query.country||!query.city&&!query.postal_code)
        throw fail('GEOCODIO_ADDRESS','Street, country, and city or postal code are required.');
      if(!['US','USA','UNITED STATES'].includes(query.country.toUpperCase()))
        throw fail('GEOCODIO_COUNTRY','This operator edition is configured for US forward geocoding.');
      const queryId='q_'+hash(canonical(query));
      queries[queryId]=query;
      bindings.push({source_ordinal:index+1,query_id:queryId,source:structuredClone(record)});
    }catch(error){
      if(!error.code?.startsWith('GEOCODIO_'))throw error;
      invalid.push({source_ordinal:index+1,source:structuredClone(record),code:error.code,message:error.message});
    }
  }
  return {schema:INTAKE_SCHEMA,operation_id:operationId??null,source:{...source,rows:records.length},
    mapping:normalized,provider:{endpoint:'https://api.geocod.io/v2/geocode',method:'POST',fields:[],limit:0,lookups:Object.keys(queries).length},
    queries,bindings,invalid};
}
export function inspectAddressIntake(intake) {
  if(!object(intake)||intake.schema!==INTAKE_SCHEMA||!object(intake.queries)||
      !Array.isArray(intake.bindings)||!Array.isArray(intake.invalid)||!object(intake.source)||!HASH.test(intake.source.sha256??''))
    throw fail('GEOCODIO_INTAKE','Expected the retained address intake and source identity.');
  const ids=Object.keys(intake.queries),ordinals=new Set(),used=new Set();
  for(const id of ids){
    const query=intake.queries[id];
    if(!ID.test(id)||!object(query)||!query.street||!query.country||Object.keys(query).some(key=>!QUERY_FIELDS.includes(key))||
       Object.values(query).some(value=>typeof value!=='string'||!value||value.length>1000))
      throw fail('GEOCODIO_QUERY','An address query has an invalid identifier or mapped field.');
    if(!['US','USA','UNITED STATES'].includes(query.country.toUpperCase()))
      throw fail('GEOCODIO_COUNTRY','Use the selected US forward-geocoding profile.');
  }
  if(intake.bindings.some(row=>!ID.test(row?.query_id??'')))throw fail('GEOCODIO_BINDING','Every valid source row must name its original address query.');
  for(const row of [...intake.bindings,...intake.invalid]){
    if(!Number.isSafeInteger(row.source_ordinal)||row.source_ordinal<1||ordinals.has(row.source_ordinal)||!object(row.source))
      throw fail('GEOCODIO_BINDING','Every original source row needs one unique positive ordinal.');
    ordinals.add(row.source_ordinal);
    if(row.query_id){if(!own(intake.queries,row.query_id))throw fail('GEOCODIO_BINDING','A source row names an absent query.');used.add(row.query_id);}
  }
  if(used.size!==ids.length||intake.source.rows!==ordinals.size||
      [...ordinals].some(n=>n>ordinals.size))throw fail('GEOCODIO_BINDING','The retained queries and original row bindings are incomplete.');
  const legacy=canonical(intake.mapping)===canonical({street:['house_number','street_name'],city:'borough',state_province_constant:'NY',country_constant:'US'});
  if(!intake.mapping?.address&&!legacy)throw fail('GEOCODIO_MAPPING','The retained intake needs its explicit original field mapping.');
  const mapping=intake.mapping?.address?normalizeMapping(intake.mapping):structuredClone(HPD_MAPPING);
  return {sourceRows:ordinals.size,validRows:intake.bindings.length,invalidRows:intake.invalid.length,
    uniqueQueries:ids.length,reusedRows:intake.bindings.length-ids.length,mapping};
}
export function inspectBatchResponse({bytes,request,mode='object',queryId}){
  if(!Buffer.isBuffer(bytes)||bytes.length>256*1024*1024)throw fail('GEOCODIO_RESPONSE','Response must fit within 256 MiB.');
  const body=parseJSON(bytes),output={};
  const ids=mode==='single'?[queryId]:Object.keys(request??{});
  if(!ids.length||ids.some(id=>!ID.test(id)))throw fail('GEOCODIO_RESPONSE','Bind the response to its original request identifiers.');
  if(mode==='single'){
    if(!object(body)||!Array.isArray(body.results))throw fail('GEOCODIO_RESPONSE','Expected an original single-address results array.');
    output[queryId]={query:request?.[queryId],response:body};
  }else if(mode==='object'){
    if(!object(body)||!object(body.results))throw fail('GEOCODIO_RESPONSE','Expected the original keyed batch results object.');
    for(const [id,entry] of Object.entries(body.results)){
      if(!ids.includes(id)||!object(entry))throw fail('GEOCODIO_RESPONSE','The batch contains a result outside its original request.');
      output[id]=entry;
    }
  }else if(mode==='array'){
    if(!object(body)||!Array.isArray(body.results)||body.results.length!==ids.length)
      throw fail('GEOCODIO_RESPONSE','An array batch needs its complete original order and result count.');
    for(const [index,entry] of body.results.entries())output[ids[index]]=entry;
  }else throw fail('GEOCODIO_RESPONSE','Choose original object, array, or single response binding.');
  const matches={};
  for(const id of ids){
    const entry=output[id],response=entry?.response;
    if(!entry){matches[id]={status:'MISSING',candidates:[],error:'No response entry for this request key.'};continue;}
    if(!object(response))throw fail('GEOCODIO_RESPONSE','A keyed entry lacks its original response object.');
    if(!Array.isArray(response.results)){
      if(!own(response,'error'))throw fail('GEOCODIO_RESPONSE','An address response lacks results or an original provider error.');
      matches[id]={status:'ERROR',candidates:[],error:response.error};continue;
    }
    const candidates=response.results.map((raw,index)=>{
      if(!object(raw))throw fail('GEOCODIO_RESPONSE','A provider candidate must be an object.');
      return {index,id:hash(canonical(raw)),raw:structuredClone(raw)};
    });
    matches[id]={status:candidates.length?'COMPLETE':'NO_MATCH',candidates,error:response.error??null};
  }
  return {sha256:hash(bytes),bytes:bytes.length,queryCount:ids.length,matches,
    returned:Object.values(matches).filter(item=>item.status!=='MISSING').length,
    missing:ids.filter(id=>matches[id].status==='MISSING')};
}
export const DEFAULT_POLICY=Object.freeze({
  minimumAccuracy:0.9,allowedAccuracyTypes:['rooftop','point'],
  maximumDisplacementMeters:100,ambiguityScoreGap:0.02,
  requireStableAddressKey:true,requireCountryMatch:true
});
export function normalizePolicy(raw={}){
  if(!object(raw))throw fail('GEOCODIO_POLICY','Choose an address-review policy.');
  const value={...DEFAULT_POLICY,...raw};
  if(Object.keys(value).some(key=>!own(DEFAULT_POLICY,key))||
    typeof value.minimumAccuracy!=='number'||value.minimumAccuracy<0||value.minimumAccuracy>1||
    typeof value.ambiguityScoreGap!=='number'||value.ambiguityScoreGap<0||value.ambiguityScoreGap>1||
    typeof value.maximumDisplacementMeters!=='number'||!Number.isFinite(value.maximumDisplacementMeters)||value.maximumDisplacementMeters<0||
    !Array.isArray(value.allowedAccuracyTypes)||!value.allowedAccuracyTypes.length||value.allowedAccuracyTypes.length>20||
    value.allowedAccuracyTypes.some(x=>typeof x!=='string'||!/^[a-z_]{1,64}$/.test(x))||
    typeof value.requireStableAddressKey!=='boolean'||typeof value.requireCountryMatch!=='boolean')
    throw fail('GEOCODIO_POLICY','Review score, accuracy types, coordinate distance, and ambiguity thresholds.');
  return {...value,allowedAccuracyTypes:[...new Set(value.allowedAccuracyTypes)]};
}
function number(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string'&&NUMBER.test(value.trim())){const n=Number(value.trim());return Number.isFinite(n)?n:null;}
  return null;
}
export function coordinatePair(latitude,longitude){
  const lat=number(latitude),lng=number(longitude);
  return lat!==null&&lng!==null&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;
}
export function distanceMeters(a,b){
  if(!a||!b)return null;
  const radians=x=>x*Math.PI/180,dLat=radians(b.lat-a.lat),dLng=radians(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLng/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,Math.max(0,h))),Math.sqrt(Math.max(0,1-h)));
}
export function candidateView(candidate,query,sourceRows,mapping,policy=DEFAULT_POLICY){
  const raw=candidate.raw,components=object(raw.address_components)?raw.address_components:{};
  const location=coordinatePair(raw.location?.lat,raw.location?.lng),score=number(raw.accuracy),reasons=[];
  if(!location)reasons.push('invalid_provider_coordinates');
  if(score===null||score<policy.minimumAccuracy||score>1)reasons.push('accuracy_score');
  if(!policy.allowedAccuracyTypes.includes(raw.accuracy_type))reasons.push('accuracy_type');
  if(policy.requireStableAddressKey&&(typeof raw.stable_address_key!=='string'||!raw.stable_address_key))reasons.push('missing_stable_address_key');
  const sourceCountry=String(query.country??'').toUpperCase(),country=String(components.country??'').toUpperCase();
  if(policy.requireCountryMatch&&!(country===sourceCountry||country==='US'&&['USA','UNITED STATES'].includes(sourceCountry)))
    reasons.push('country_difference');
  const coordinates=sourceRows.map(row=>{
    const latitude=field(row.source,mapping.coordinates.latitude||'latitude_internal');
    const longitude=field(row.source,mapping.coordinates.longitude||'longitude_internal');
    const original=coordinatePair(latitude,longitude),distance=distanceMeters(original,location);
    return {source_ordinal:row.source_ordinal,latitude:latitude??null,longitude:longitude??null,valid:Boolean(original),
      distanceMeters:distance===null?null:Math.round(distance*1000)/1000};
  });
  const distances=coordinates.map(row=>row.distanceMeters).filter(value=>value!==null);
  const maximumDistance=distances.length?distances.reduce((maximum,value)=>Math.max(maximum,value),0):null;
  if(maximumDistance!==null&&maximumDistance>policy.maximumDisplacementMeters)reasons.push('coordinate_disagreement');
  return {index:candidate.index,id:candidate.id,formattedAddress:raw.formatted_address??null,
    addressComponents:components,accuracy:score,accuracyType:raw.accuracy_type??null,matchType:raw.match_type??null,
    stableAddressKey:typeof raw.stable_address_key==='string'?raw.stable_address_key:null,
    providerSource:raw.source??null,location,sourceCoordinates:coordinates,maximumDisplacementMeters:maximumDistance,
    reasons,qualified:reasons.length===0,raw};
}
export function reviewAddressIntake({intake,matches={},decisions={},policy=DEFAULT_POLICY}){
  const inspected=inspectAddressIntake(intake),rules=normalizePolicy(policy),byQuery=new Map();
  for(const row of intake.bindings){if(!byQuery.has(row.query_id))byQuery.set(row.query_id,[]);byQuery.get(row.query_id).push(row);}
  const rows=[],stableGroups=new Map();
  for(const [id,query] of Object.entries(intake.queries)){
    const response=matches[id],linked=byQuery.get(id)??[];
    const candidates=(response?.candidates??[]).map(item=>candidateView(item,query,linked,inspected.mapping,rules));
    const best=candidates[0]??null;
    if(best&&candidates.slice(1).some(candidate=>candidate.accuracy!==null&&best.accuracy!==null&&
        best.accuracy-candidate.accuracy<=rules.ambiguityScoreGap&&
        (candidate.stableAddressKey!==best.stableAddressKey||distanceMeters(candidate.location,best.location)>1))){
      best.reasons.push('multiple_close_candidates');best.qualified=false;
    }
    const decision=decisions[id]??null;
    const chosen=decision?.candidateId?candidates.find(item=>item.id===decision.candidateId):null;
    const decisionCurrent=Boolean(decision && (decision.action==='keep-source'||chosen));
    const state=decisionCurrent?decision.action==='keep-source'?'SOURCE_RETAINED':'ACCEPTED':
      !response?'UNQUERIED':response.status==='NO_MATCH'?'NO_MATCH':
      response.status==='ERROR'||response.status==='MISSING'?'PROVIDER_ATTENTION':
      best?.qualified?'QUALIFIED':'REVIEW';
    const selected=chosen??best;
    if(selected?.stableAddressKey){
      const key=selected.stableAddressKey;
      if(!stableGroups.has(key))stableGroups.set(key,[]);
      stableGroups.get(key).push({queryId:id,sourceRows:linked.length,accuracyType:selected.accuracyType,decisionCurrent});
    }
    rows.push({id,query,sourceRows:linked.length,sourceOrdinals:linked.map(row=>row.source_ordinal),
      providerStatus:response?.status??'UNQUERIED',providerError:response?.error??null,
      state,candidates,recommended:best?.id??null,decision,decisionCurrent,
      reasons:best?.reasons??(response?.status==='NO_MATCH'?['no_match']:[]),
      maximumDisplacementMeters:best?.maximumDisplacementMeters??null});
  }
  const counts=Object.fromEntries(['UNQUERIED','NO_MATCH','PROVIDER_ATTENTION','QUALIFIED','REVIEW','ACCEPTED','SOURCE_RETAINED'].map(key=>[key,0]));
  for(const row of rows)counts[row.state]++;
  return {summary:{...inspected,mapping:undefined,counts,reviewedQueries:counts.ACCEPTED+counts.SOURCE_RETAINED,
    candidateCount:rows.reduce((n,row)=>n+row.candidates.length,0)},
    policy:rules,rows,duplicates:[...stableGroups].filter(([,groups])=>groups.length>1).map(([stableAddressKey,groups])=>({
      stableAddressKey,queries:groups,sourceRows:groups.reduce((n,group)=>n+group.sourceRows,0)}))};
}
export function validateDecision({review,queryId,candidateId,action,coordinateChoice='preserve-source',note}){
  const row=review.rows.find(item=>item.id===queryId);
  if(!row)throw fail('GEOCODIO_REVIEW','Choose an original retained address query.');
  if(!['accept','keep-source'].includes(action)||!['preserve-source','use-provider','fill-missing'].includes(coordinateChoice))
    throw fail('GEOCODIO_REVIEW','Choose a retained candidate and an explicit coordinate policy.');
  const candidate=action==='accept'?row.candidates.find(item=>item.id===candidateId):null;
  if(action==='accept'&&!candidate?.location)throw fail('GEOCODIO_REVIEW','Select a candidate with usable coordinates.');
  if(typeof note!=='string'||!note.trim()||note.length>4000)throw fail('GEOCODIO_REVIEW','Record the reason for this address decision.');
  return {queryId,action,candidateId:candidate?.id??null,coordinateChoice:action==='keep-source'?'preserve-source':coordinateChoice,
    note:note.trim(),policy:review.policy,at:new Date().toISOString()};
}
export function buildReviewedRows({intake,review,sourceColumns=[],scope='all-source'}){
  if(!['all-source','reviewed-only'].includes(scope))throw fail('GEOCODIO_EDITION','Choose all original rows or reviewed rows.');
  if(!Array.isArray(sourceColumns)||sourceColumns.length>32||sourceColumns.some(column=>!object(column)||
    !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(column.name??'')||forbidden.has(column.name)||typeof column.source!=='string'))
    throw fail('GEOCODIO_EDITION','Declare up to 32 original source fields with native output names.');
  const reserved=new Set(['source_ordinal','query_id','review_state','formatted_address','stable_address_key','accuracy','accuracy_type',
    'match_type','provider_source','source_latitude','source_longitude','provider_latitude','provider_longitude','displacement_m',
    'coordinate_choice','selected_latitude','selected_longitude','review_note']);
  if(new Set(sourceColumns.map(c=>c.name)).size!==sourceColumns.length||sourceColumns.some(c=>reserved.has(c.name)))
    throw fail('GEOCODIO_EDITION','Source output names must be unique and distinct from address-review fields.');
  const byId=new Map(review.rows.map(row=>[row.id,row])),mapping=inspectAddressIntake(intake).mapping,rows=[];
  for(const binding of [...intake.bindings,...intake.invalid].sort((a,b)=>a.source_ordinal-b.source_ordinal)){
    const reviewed=byId.get(binding.query_id),decision=reviewed?.decisionCurrent?reviewed.decision:null;
    if(scope==='reviewed-only'&&!decision)continue;
    const candidate=decision?.candidateId?reviewed.candidates.find(c=>c.id===decision.candidateId):null;
    const sourceLat=field(binding.source,mapping.coordinates.latitude||'latitude_internal');
    const sourceLng=field(binding.source,mapping.coordinates.longitude||'longitude_internal');
    const original=coordinatePair(sourceLat,sourceLng),provider=candidate?.location??null;
    const choice=decision?.coordinateChoice??'unreviewed';
    const selected=choice==='use-provider'?provider:choice==='fill-missing'?original??provider:
      choice==='preserve-source'?original:null;
    const rawSource=Object.fromEntries(sourceColumns.map(column=>[column.name,field(binding.source,column.source)??'']));
    if(Object.values(rawSource).some(value=>typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean'))
      throw fail('GEOCODIO_EDITION','Choose scalar original fields for the native CSV projection.');
    rows.push({...rawSource,source_ordinal:binding.source_ordinal,query_id:binding.query_id??'',review_state:reviewed?.state??'INVALID_SOURCE',
      formatted_address:candidate?.formattedAddress??'',stable_address_key:candidate?.stableAddressKey??'',
      accuracy:candidate?.accuracy??null,accuracy_type:candidate?.accuracyType??'',match_type:candidate?.matchType??'',
      provider_source:typeof candidate?.providerSource==='string'?candidate.providerSource:'',
      source_latitude:sourceLat===undefined||sourceLat===null?'':String(sourceLat),
      source_longitude:sourceLng===undefined||sourceLng===null?'':String(sourceLng),
      provider_latitude:provider?.lat??null,provider_longitude:provider?.lng??null,
      displacement_m:distanceMeters(original,provider),coordinate_choice:choice,
      selected_latitude:selected?.lat??null,selected_longitude:selected?.lng??null,review_note:decision?.note??''});
  }
  return rows;
}
export function csvBytes(rows,names){
  const cell=value=>{const text=value===null||value===undefined?'':String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  return Buffer.from([names.map(cell).join(','),...rows.map(row=>names.map(name=>cell(row[name])).join(','))].join('\r\n')+'\r\n');
}
