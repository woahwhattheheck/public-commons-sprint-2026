// MIT. Geoapify generic-batch source, identity and operator review.
import {hash,canonical,json,readCsvRecords,readJSONSourceRecords,coordinatePair,distanceMeters,csvBytes} from '../geocodio/source.mjs';
export {hash,canonical,json,readCsvRecords,readJSONSourceRecords,coordinatePair,distanceMeters,csvBytes};
export const SCHEMA='stellar-forge.geoapify-intake.v1';
export const API='/v1/geocode/search';
export const ENDPOINTS=Object.freeze(['https://api.geoapify.com/v1/batch','https://api-eu.geoapify.com/v1/batch']);
export const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const FORBIDDEN=new Set(['__proto__','prototype','constructor']);
const HASH=/^[a-f0-9]{64}$/;
export function fail(code,message,status=400){return Object.assign(new Error(message),{code:'GEOAPIFY_'+code,status});}
export function parseJSON(raw){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fail('JSON','Read a complete UTF-8 JSON document.');}
}
export function text(value,label,max=4000){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw fail('INPUT',label+' needs nonempty printable text.');
  return value.trim();
}
export function integer(v,label,min,max){
  if(!Number.isSafeInteger(v)||v<min||v>max)throw fail('INPUT',label+' must be an integer from '+min+' through '+max+'.');
  return v;
}
export function field(row,path){
  if(!path)return undefined;
  if(!FORBIDDEN.has(path)&&own(row,path))return row[path];
  let value=row;
  for(const key of path.split('.')){if(FORBIDDEN.has(key)||!object(value)||!own(value,key))return undefined;value=value[key];}
  return value;
}
function columnPath(v){
  if(v===undefined||v===null||v==='')return '';
  if(typeof v!=='string'||v.length>200||v.split('.').some(p=>!p||FORBIDDEN.has(p)))throw fail('MAPPING','Use an original field name or dot-separated object path.');
  return v;
}
export function mapping(raw){
  if(!object(raw))throw fail('MAPPING','Choose explicit original address fields.');
  const keys=['text','name','housenumber','street','postcode','city','state','country','identity','latitude','longitude'];
  if(Object.keys(raw).some(k=>!keys.includes(k)))throw fail('MAPPING','The mapping contains an unknown field.');
  const out=Object.fromEntries(keys.map(k=>[k,columnPath(raw[k])]));
  if(out.text&&keys.slice(1,8).some(k=>out[k]))throw fail('MAPPING','Choose a text address OR structured address fields.');
  if(!out.text&&!keys.slice(1,8).some(k=>out[k]))throw fail('MAPPING','Map the original text address or structured fields.');
  if(Boolean(out.latitude)!==Boolean(out.longitude))throw fail('MAPPING','Map both original coordinate fields together.');
  return out;
}
export function createIntake({records,source,mapping:rawMapping}){
  if(!Array.isArray(records)||!records.length||records.length>1000000||records.some(r=>!object(r)))
    throw fail('SOURCE','Read one through one million original object records.');
  if(!object(source)||!HASH.test(source.sha256??'')||!Number.isSafeInteger(source.bytes)||source.bytes<0)
    throw fail('SOURCE','Retain the original source byte identity.');
  const map=mapping(rawMapping),queries={},rows=[],identityGroups=new Map();
  records.forEach((row,index)=>{
    const params={},problems=[];
    for(const key of ['text','name','housenumber','street','postcode','city','state','country']){
      if(!map[key])continue;
      const value=field(row,map[key]);
      if(value===undefined||value===null||value==='')continue;
      if(!['string','number'].includes(typeof value)||String(value).length>2000){problems.push('invalid_'+key);continue;}
      params[key]=String(value).trim();
    }
    if(!Object.values(params).some(Boolean))problems.push('missing_address');
    const id=problems.length?null:'q_'+hash(canonical(params));
    if(id&&!own(queries,id))queries[id]=params;
    const identity=field(row,map.identity);
    if(identity!==undefined&&identity!==null&&!['string','number','boolean'].includes(typeof identity))problems.push('non_scalar_identity');
    const value={ordinal:index+1,queryId:id,identity:identity==null?null:String(identity),problems,source:structuredClone(row)};
    rows.push(value);
    if(value.identity!==null){const group=identityGroups.get(value.identity)??[];group.push(value.ordinal);identityGroups.set(value.identity,group);}
  });
  return {schema:SCHEMA,source:structuredClone(source),mapping:map,queries,rows,
    duplicateIdentities:[...identityGroups].filter(([,ordinals])=>ordinals.length>1).map(([identity,ordinals])=>({identity,ordinals}))};
}
export function inspectIntake(intake){
  if(!object(intake)||intake.schema!==SCHEMA||!Array.isArray(intake.rows))throw fail('SOURCE','Open the original Geoapify intake.');
  const rebuilt=createIntake({records:intake.rows.map(r=>r.source),source:intake.source,mapping:intake.mapping});
  if(canonical(rebuilt)!==canonical(intake))throw fail('SOURCE_CHANGED','The retained source mapping or original record identities differ.',409);
  return {rows:intake.rows.length,queries:Object.keys(intake.queries).length,
    invalidRows:intake.rows.filter(r=>!r.queryId).length,duplicateIdentityGroups:intake.duplicateIdentities.length};
}
export function requestOptions(raw={}){
  if(!object(raw))throw fail('REQUEST','Use explicit batch options.');
  if(Object.keys(raw).some(k=>!['limit','lang','filter','bias','type','priority','endpoint'].includes(k)))
    throw fail('REQUEST','An unknown geocoding option was supplied.');
  const endpoint=raw.endpoint??ENDPOINTS[0];
  if(!ENDPOINTS.includes(endpoint))throw fail('ENDPOINT','Choose the documented global or EU batch endpoint.');
  const priority=raw.priority??1;
  if(typeof priority!=='number'||!Number.isFinite(priority)||priority<0.5||priority>1)throw fail('PRIORITY','Choose batch priority from0.5 through1.');
  const params={format:'geojson',limit:integer(raw.limit??5,'Candidate limit',1,20),bias:raw.bias??'countrycode:none'};
  for(const key of ['lang','filter','type'])if(raw[key]!==undefined&&raw[key]!=='')params[key]=text(raw[key],key,1000);
  params.bias=text(params.bias,'Explicit geographic bias',1000);
  if(params.lang&&!/^[a-z]{2}$/.test(params.lang))throw fail('LANGUAGE','Use an explicit ISO language code.');
  if(params.type&&!['country','state','city','postcode','street','amenity','locality'].includes(params.type))
    throw fail('TYPE','Choose a documented address level or omit the type filter.');
  return {endpoint,priority,params};
}
export function prepareBatch(intake,queryIds,rawOptions={}){
  inspectIntake(intake);
  if(!Array.isArray(queryIds)||!queryIds.length||queryIds.length>1000||new Set(queryIds).size!==queryIds.length||
      queryIds.some(id=>!own(intake.queries,id)))throw fail('BATCH','Select one through1000 distinct original query IDs.');
  const options=requestOptions(rawOptions);
  return {endpoint:options.endpoint,body:{api:API,priority:options.priority,params:options.params,
    inputs:queryIds.map(id=>({id,params:structuredClone(intake.queries[id])}))}};
}
export function inspectRequest(intake,request){
  if(!object(request)||!object(request.body)||request.body.api!==API||!Array.isArray(request.body.inputs))
    throw fail('REQUEST','Use the exact saved generic-batch request.');
  const {format,...params}=request.body.params??{};
  if(format!=='geojson')throw fail('REQUEST_CHANGED','The original request requires GeoJSON results.',409);
  const rebuilt=prepareBatch(intake,request.body.inputs.map(i=>i.id),{endpoint:request.endpoint,
    priority:request.body.priority,...params});
  // format is fixed by this adapter, not a caller option.
  if(canonical(rebuilt)!==canonical(request))throw fail('REQUEST_CHANGED','The request differs from the original source and fixed GeoJSON contract.',409);
  return request;
}
/** Remove authentication from provider polling URLs, including imported query-auth replies. */
export function sanitizeReply(raw){
  const source=Buffer.isBuffer(raw)?raw:Buffer.from(raw),value=parseJSON(source),redactions=[];
  const walk=(node,path=[])=>{
    if(Array.isArray(node))return node.map((item,index)=>walk(item,[...path,index]));
    if(!object(node))return node;
    const out=Object.create(null);
    for(const [key,val] of Object.entries(node)){
      if(/^(?:api_?key|authorization|access_token|token|secret)$/i.test(key)){
        out[key]='[credential removed]';redactions.push([...path,key].join('.'));continue;
      }
      if(typeof val==='string'&&/^https?:\/\//i.test(val)){
        try{
          const u=new URL(val);let changed=false;
          if(u.username||u.password){u.username='';u.password='';changed=true;}
          for(const param of [...u.searchParams.keys()])if(/key|token|auth|secret/i.test(param)){u.searchParams.delete(param);changed=true;}
          out[key]=changed?u.href:val;if(changed)redactions.push([...path,key].join('.'));
        }catch{out[key]=val;}
      }else out[key]=walk(val,[...path,key]);
    }
    return out;
  };
  const clean=walk(value);
  return {body:clean,bytes:redactions.length?json(clean):source,originalSha256:hash(source),
    originalBytes:source.length,redactions};
}
export function inspectReply({body,request,expectedJobId=null,status=200}){
  if(!object(body))throw fail('PROVIDER_SHAPE','The provider reply must be an object.');
  if(!/^[a-f0-9]{32}$/.test(body.id??'')||expectedJobId&&body.id!==expectedJobId)
    throw fail('JOB_CHANGED','The provider job ID differs from the original retained operation.',409);
  if(body.api!==undefined&&body.api!==API)throw fail('API_CHANGED','The reply belongs to another provider API.',409);
  if(status===202){
    if(body.results!==undefined)throw fail('PROVIDER_SHAPE','A pending response unexpectedly contains completed results.');
    return {jobId:body.id,status:'PENDING',matches:{},issues:[]};
  }
  if(status!==200||!Array.isArray(body.results))throw fail('PROVIDER_SHAPE','A completed generic-batch reply needs its full results array.');
  if(body.params!==undefined&&canonical(body.params)!==canonical(request.body.params))
    throw fail('PARAMS_CHANGED','The provider returned different common geocoding parameters.',409);
  const expected=new Map(request.body.inputs.map(input=>[input.id,input.params])),seen=new Set(),matches={},issues=[];
  for(const item of body.results){
    if(!object(item)||typeof item.id!=='string'||!expected.has(item.id)){issues.push({kind:'FOREIGN_ID',id:item?.id??null});continue;}
    if(seen.has(item.id)){issues.push({kind:'DUPLICATE_ID',id:item.id});matches[item.id]={status:'AMBIGUOUS',candidates:[],error:'Duplicate provider input ID.'};continue;}
    seen.add(item.id);
    if(item.params!==undefined&&canonical(item.params)!==canonical(expected.get(item.id))){
      issues.push({kind:'PARAMS_CHANGED',id:item.id});matches[item.id]={status:'ERROR',candidates:[],error:'Returned parameters differ.'};continue;
    }
    const value=item.result;
    if(!object(value)){matches[item.id]={status:'ERROR',candidates:[],error:'Missing provider result.',raw:structuredClone(item)};continue;}
    if(value.type==='FeatureCollection'&&Array.isArray(value.features)){
      const candidates=value.features.map((feature,index)=>{
        if(!object(feature)||feature.type!=='Feature'||!object(feature.properties))throw fail('CANDIDATE','A geocoding candidate is not a complete Feature.');
        return {id:hash(canonical(feature)),index,raw:structuredClone(feature)};
      });
      matches[item.id]={status:candidates.length?'COMPLETE':'NO_MATCH',candidates,error:null};
    }else matches[item.id]={status:'ERROR',candidates:[],error:structuredClone(value)};
  }
  for(const id of expected.keys())if(!seen.has(id)){matches[id]={status:'MISSING',candidates:[],error:'No result for the original input ID.'};issues.push({kind:'MISSING_ID',id});}
  return {jobId:body.id,status:issues.length?'PARTIAL':'COMPLETE',matches,issues};
}
function candidate(raw,intake,linkedRows){
  const p=raw.raw.properties,g=raw.raw.geometry,coords=g?.type==='Point'&&Array.isArray(g.coordinates)?coordinatePair(g.coordinates[1],g.coordinates[0]):null;
  const props=coordinatePair(p.lat,p.lon),warnings=[];
  if(!coords)warnings.push('invalid_geometry');
  if(coords&&props&&distanceMeters(coords,props)>1)warnings.push('geometry_property_disagreement');
  const confidence=p.rank?.confidence;
  if(typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1)warnings.push('confidence_unavailable');
  const original=linkedRows.map(row=>{
    const location=coordinatePair(field(row.source,intake.mapping.latitude),field(row.source,intake.mapping.longitude));
    return {ordinal:row.ordinal,identity:row.identity,location,distanceMeters:distanceMeters(location,coords)};
  });
  return {...raw,formatted:p.formatted??null,resultType:p.result_type??null,matchType:p.rank?.match_type??null,
    confidence:typeof confidence==='number'&&Number.isFinite(confidence)?confidence:null,
    location:coords,propertyLocation:props,datasource:p.datasource??null,sourceCoordinates:original,warnings};
}
export function reviewIntake({intake,matches={},decisions=[]}){
  const summary=inspectIntake(intake),latest=new Map(decisions.map(d=>[d.queryId,d]));
  const linked=new Map();for(const r of intake.rows){const group=linked.get(r.queryId)??[];group.push(r);linked.set(r.queryId,group);}
  const rows=Object.entries(intake.queries).map(([id,params])=>{
    const m=matches[id],candidates=(m?.candidates??[]).map(c=>candidate(c,intake,linked.get(id)??[])),decision=latest.get(id)??null;
    const current=Boolean(decision&&(decision.action==='keep-source'||decision.responseSha256===m?.responseSha256&&candidates.some(c=>c.id===decision.candidateId)));
    const state=current?(decision.action==='keep-source'?'SOURCE_RETAINED':'ACCEPTED'):m?.status??'UNQUERIED';
    return {id,params,sourceOrdinals:(linked.get(id)??[]).map(r=>r.ordinal),
      state,providerStatus:m?.status??'UNQUERIED',responseSha256:m?.responseSha256??null,
      candidates,error:m?.error??null,decision,decisionCurrent:current};
  });
  const counts={};for(const row of rows)counts[row.state]=(counts[row.state]??0)+1;
  return {schema:'stellar-forge.geoapify-review.v1',source:intake.source,mapping:intake.mapping,
    summary:{...summary,counts,reviewedQueries:(counts.ACCEPTED??0)+(counts.SOURCE_RETAINED??0),
      candidates:rows.reduce((n,row)=>n+row.candidates.length,0)},rows,invalidRows:intake.rows.filter(r=>!r.queryId),
    duplicateIdentities:intake.duplicateIdentities};
}
export function validateDecision({review,queryId,action,candidateId,coordinateChoice='preserve-source',reviewer,note,expectedResponseSha256}){
  const row=review.rows.find(r=>r.id===queryId);
  if(!row)throw fail('QUERY','Choose an original retained query.');
  if(!['accept','keep-source'].includes(action)||!['preserve-source','fill-missing','use-provider'].includes(coordinateChoice))
    throw fail('DECISION','Choose a candidate decision and explicit coordinate policy.');
  const chosen=action==='accept'?row.candidates.find(c=>c.id===candidateId):null;
  if(action==='accept'&&(!chosen?.location||row.responseSha256!==expectedResponseSha256))
    throw fail('REVIEW_CHANGED','Reopen the actual response and select a usable coordinate candidate.',409);
  return {queryId,action,candidateId:chosen?.id??null,responseSha256:row.responseSha256,
    coordinateChoice:action==='keep-source'?'preserve-source':coordinateChoice,
    reviewer:text(reviewer,'Reviewer',200),note:text(note,'Decision reason'),at:new Date().toISOString()};
}
export function buildRows({intake,review,scope='all-source',sourceColumns=[]}){
  if(!['all-source','reviewed-only'].includes(scope))throw fail('EDITION','Choose all source rows or the explicitly reviewed subset.');
  const standard=['source_ordinal','source_identity','query_id','review_state','formatted_address','confidence','result_type','match_type',
    'source_latitude','source_longitude','provider_latitude','provider_longitude','distance_m','coordinate_choice',
    'selected_latitude','selected_longitude','reviewer','review_note','datasource','attribution','licence','datasource_url'];
  if(!Array.isArray(sourceColumns)||sourceColumns.length>32||sourceColumns.some(c=>!object(c)||!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(c.name??'')||
      FORBIDDEN.has(c.name)||standard.includes(c.name)||!columnPath(c.source))||new Set(sourceColumns.map(c=>c.name)).size!==sourceColumns.length)
    throw fail('COLUMNS','Choose up to32 distinct scalar source columns with native output names.');
  const byId=new Map(review.rows.map(r=>[r.id,r])),rows=[],features=[];
  for(const original of intake.rows){
    const reviewed=byId.get(original.queryId),decision=reviewed?.decisionCurrent?reviewed.decision:null;
    if(scope==='reviewed-only'&&!decision)continue;
    const c=decision?.action==='accept'?reviewed.candidates.find(c=>c.id===decision.candidateId):null;
    const lat=field(original.source,intake.mapping.latitude),lon=field(original.source,intake.mapping.longitude);
    const old=coordinatePair(lat,lon),choice=decision?.coordinateChoice??'unreviewed';
    const selected=choice==='use-provider'?c?.location:choice==='fill-missing'?old??c?.location:choice==='preserve-source'?old:null;
    const extras=Object.fromEntries(sourceColumns.map(column=>[column.name,field(original.source,column.source)??'']));
    if(Object.values(extras).some(v=>!['string','number','boolean'].includes(typeof v)))throw fail('COLUMNS','Dataset source columns must contain scalar values.');
    const d=c?.datasource??{};
    const row={...extras,source_ordinal:original.ordinal,source_identity:original.identity??'',query_id:original.queryId??'',
      review_state:reviewed?.state??'INVALID_SOURCE',formatted_address:c?.formatted??'',confidence:c?.confidence??null,
      result_type:c?.resultType??'',match_type:c?.matchType??'',source_latitude:lat==null?'':String(lat),source_longitude:lon==null?'':String(lon),
      provider_latitude:c?.location?.lat??null,provider_longitude:c?.location?.lng??null,distance_m:distanceMeters(old,c?.location),
      coordinate_choice:choice,selected_latitude:selected?.lat??null,selected_longitude:selected?.lng??null,
      reviewer:decision?.reviewer??'',review_note:decision?.note??'',datasource:d.sourcename??'',attribution:d.attribution??'',
      licence:d.license??'',datasource_url:d.url??''};
    rows.push(row);features.push({type:'Feature',id:original.ordinal,geometry:selected?{type:'Point',coordinates:[selected.lng,selected.lat]}:null,
      properties:row});
  }
  return {rows,geojson:{type:'FeatureCollection',features},columns:[...sourceColumns.map(c=>c.name),...standard]};
}
