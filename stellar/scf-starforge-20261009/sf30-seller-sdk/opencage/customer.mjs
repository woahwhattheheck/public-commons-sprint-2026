// MIT. Consume original SF88 results and preserve native geocoding data in customer deliveries.
import { join,resolve } from 'node:path';
import { readGeocodeResponse } from './source.mjs';
import { compileGeocodePlan,productFor,bindGeocodeQuery,API_ORIGIN,API_PATH,PARAMETERS,object,fail } from './config.mjs';
import { readBytes,jsonBytes,digest,readBundle,publishBundle } from '../twelvedata/files.mjs';
export const DELIVERY='stellar-forge.opencage-delivery.v1';
const decoder=new TextDecoder('utf-8',{fatal:true});
function csvCell(value,{text=false}={}) {
  let encoded=value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if(text && /^[\s]*[=+@-]/.test(encoded)) encoded="'"+encoded;
  return '"'+encoded.replaceAll('"','""')+'"';
}
function csv(rows,columns,textColumns=[]) {
  const textual=new Set(textColumns);
  return Buffer.from(columns.map(value=>csvCell(value)).join(',')+'\r\n'+rows.map(row=>
    columns.map(column=>csvCell(row[column],{text:textual.has(column)})).join(',')).join('\r\n')+(rows.length?'\r\n':''));
}
function decisionOf(value,responseSha,count) {
  if(value === null || value === undefined) return {revision:0,current:null,history:[]};
  if(!object(value) || !Number.isSafeInteger(value.revision) || value.revision<0 || !Array.isArray(value.history))
    fail('GEOCODE_DECISION_INVALID');
  if(value.history.length !== value.revision) fail('GEOCODE_DECISION_HISTORY_INVALID');
  let current=null;
  for(const [offset,item] of value.history.entries()) {
    if(!object(item) || item.revision !== offset+1 || item.responseSha256 !== responseSha ||
        item.index !== null && (!Number.isInteger(item.index)||item.index<0||item.index>=count) ||
        typeof item.note !== 'string' || typeof item.at !== 'string') fail('GEOCODE_DECISION_IDENTITY_CHANGED');
    current=item;
  }
  if(JSON.stringify(current) !== JSON.stringify(value.current)) fail('GEOCODE_DECISION_CURRENT_CHANGED');
  return structuredClone(value);
}
export class GeocodeDelivery {
  constructor({bytes,request,provenance,decision=null,attachments=new Map()}) {
    if(!(bytes instanceof Uint8Array) || bytes.length>1048576 || !object(request) || !object(provenance))
      fail('GEOCODE_DELIVERY_INVALID');
    if(!Object.hasOwn(PARAMETERS,request.mode) || !object(request.query))fail('GEOCODE_DELIVERY_REQUEST_INVALID');
    const checked=bindGeocodeQuery({mode:request.mode,options:PARAMETERS[request.mode].filter(name=>name!=='q'),defaults:{}},request.query);
    if(digest(jsonBytes(checked))!==digest(jsonBytes(request.query)))fail('GEOCODE_DELIVERY_QUERY_CHANGED');
    this._bytes=Buffer.from(bytes);this.responseSha256=digest(this._bytes);
    this.request=structuredClone(request);this.provenance=structuredClone(provenance);
    this.parsed=readGeocodeResponse(this._bytes,{httpStatus:200,mode:request.mode,query:request.query});
    this.decision=decisionOf(decision,this.responseSha256,this.parsed.candidates.length);
    this.attachments=new Map([...attachments].map(([name,value])=>[name,Buffer.from(value)]));
    this.identity=digest(jsonBytes({request:this.request,provenance:this.provenance,responseSha256:this.responseSha256,
      decision:this.decision,attachments:[...this.attachments].map(([name,value])=>({name,sha256:digest(value)}))}));
  }
  inspect() {
    const selected=this.decision.current?.index ?? null;
    return {schema:DELIVERY,identity:this.identity,request:structuredClone(this.request),
      provenance:structuredClone(this.provenance),responseSha256:this.responseSha256,responseBytes:this._bytes.length,
      state:this.parsed.state,semantics:structuredClone(this.parsed.semantics),
      decision:structuredClone(this.decision),selectedIndex:selected,
      candidates:this.parsed.candidates.map((candidate,index)=>({...structuredClone(candidate),index,selected:index===selected}))};
  }
  bytes(){return Buffer.from(this._bytes);}
  json(){return JSON.parse(decoder.decode(this._bytes));}
  entries() {
    const selected=this.decision.current?.index ?? null;
    const rows=this.parsed.candidates.map((candidate,index)=>({
      request_id:this.request.id ?? '',product_id:this.request.productId,query:this.request.query.q,
      candidate_index:index,selected:index===selected,formatted:candidate.formatted,
      latitude:candidate.geometry.lat,longitude:candidate.geometry.lng,confidence:candidate.confidence,
      components_json:candidate.components ?? null,bounds_json:candidate.bounds ?? null,
      annotations_json:candidate.annotations ?? null,response_sha256:this.responseSha256,
    }));
    const features=this.parsed.candidates.map((candidate,index)=>({type:'Feature',
      id:(this.request.id ?? this.responseSha256)+':'+index,
      geometry:{type:'Point',coordinates:[candidate.geometry.lng,candidate.geometry.lat]},
      properties:{requestId:this.request.id ?? null,query:this.request.query.q,candidateIndex:index,
        selected:index===selected,responseSha256:this.responseSha256,formatted:candidate.formatted,
        confidence:candidate.confidence,confidenceMeaning:'SPATIAL_PRECISION_NOT_CORRECTNESS',
        components:candidate.components ?? null,bounds:candidate.bounds ?? null,annotations:candidate.annotations ?? null}}));
    const columns=['request_id','product_id','query','candidate_index','selected','formatted','latitude','longitude',
      'confidence','components_json','bounds_json','annotations_json','response_sha256'];
    const metadata={schema:DELIVERY,identity:this.identity,request:this.request,provenance:this.provenance,
      responseSha256:this.responseSha256,responseBytes:this._bytes.length,semantics:this.parsed.semantics,
      decision:this.decision,csv:{encoding:'UTF-8',lineEnding:'CRLF',
        textFormulaProtection:'Leading spreadsheet formula text receives one apostrophe; original strings remain in response.json.',
        absentProjectionFields:'Empty CSV cells; null in GeoJSON. Native response preserves absence.'},
      sources:['https://opencagedata.com/api','https://opencagedata.com/terms']};
    const entries=[
      ['response.json',this._bytes],['delivery.json',jsonBytes(metadata)],['request.json',jsonBytes(this.request)],
      ['decision.json',jsonBytes(this.decision)],['licenses.json',jsonBytes({licenses:this.parsed.semantics.licenses})],
      ['candidates.jsonl',Buffer.from(this.parsed.candidates.map((candidate,index)=>
        JSON.stringify({index,selected:index===selected,candidate})).join('\n')+(rows.length?'\n':''))],
      ['candidates.csv',csv(rows,columns,['request_id','product_id','query','formatted'])],
      ['candidates.geojson',jsonBytes({type:'FeatureCollection',features})],
      ['selected.csv',csv(rows.filter(row=>row.selected),columns,['request_id','product_id','query','formatted'])],
      ['selected.geojson',jsonBytes({type:'FeatureCollection',features:features.filter(feature=>feature.properties.selected)})],
      ...[...this.attachments].map(([name,value])=>['source/'+name,value]),
    ];
    return entries;
  }
  async export(directory) {
    return publishBundle(resolve(directory),DELIVERY,this.identity,this.entries(),{responseSha256:this.responseSha256,
      candidateCount:this.parsed.candidates.length,selectedIndex:this.decision.current?.index??null,decisionRevision:this.decision.revision});
  }
  static async open(directory) {
    const bundle=await readBundle(directory,{schema:DELIVERY});
    if(!bundle.files.has('delivery.json')||!bundle.files.has('response.json'))fail('GEOCODE_DELIVERY_INCOMPLETE');
    const metadata=JSON.parse(bundle.files.get('delivery.json'));
    const attachments=new Map([...bundle.files].filter(([name])=>name.startsWith('source/')).map(([name,value])=>[name.slice(7),value]));
    const result=new GeocodeDelivery({bytes:bundle.files.get('response.json'),request:metadata.request,
      provenance:metadata.provenance,decision:metadata.decision,attachments});
    if(result.identity !== bundle.manifest.identity || metadata.identity !== result.identity ||
        metadata.responseSha256 !== result.responseSha256) fail('GEOCODE_DELIVERY_IDENTITY_CHANGED');
    const expected=new Map(result.entries());
    if(expected.size!==bundle.files.size)fail('GEOCODE_DELIVERY_FILE_SET_CHANGED');
    for(const [name,bytes] of expected)if(!bundle.files.has(name)||digest(bundle.files.get(name))!==digest(bytes))
      fail('GEOCODE_DELIVERY_PROJECTION_CHANGED');
    return result;
  }
  static async fromBuyerResult(result,{request,provenance={}}={}) {
    if(!result || typeof result.bytes !== 'function' || typeof result.raiseForStatus !== 'function')
      fail('GEOCODE_BUYER_RESULT_REQUIRED');
    result.raiseForStatus();
    const bytes=await result.bytes({limit:1048576}),native=jsonBytes(result.record);
    if(result.delivery?.sha256 !== digest(bytes) || result.native?.httpStatus !== 200) fail('GEOCODE_BUYER_DELIVERY_CHANGED');
    return new GeocodeDelivery({bytes,request,provenance:{...provenance,kind:'ORIGINAL_SF88_BUYER_RESULT',
      nativeHttpStatus:result.native.httpStatus,nativeResultSha256:digest(native)},
      attachments:new Map([['buyer-result.json',native]])});
  }
  static async fromOperation(operation,{plan:raw,productId,publicOrigin}={}) {
    if(!operation || typeof operation.recover !== 'function' || typeof operation.configPath !== 'string')
      fail('GEOCODE_BUYER_OPERATION_REQUIRED');
    const plan=compileGeocodePlan(raw),product=productFor(plan,productId);
    const result=await operation.recover();
    const bytes=await readBytes(operation.configPath,65536),config=JSON.parse(bytes);
    if(digest(bytes) !== result.record.configSha256) fail('GEOCODE_BUYER_CONFIG_CHANGED');
    let url;try{url=new URL(config.operation?.url);}catch{fail('GEOCODE_BUYER_URL_INVALID');}
    if(config.operation?.method !== 'GET' || url.origin !== publicOrigin || url.pathname !== product.path ||
        url.username || url.password || url.hash) fail('GEOCODE_BUYER_PRODUCT_MISMATCH');
    const query=bindGeocodeQuery(product,url.searchParams);
    return GeocodeDelivery.fromBuyerResult(result,{request:{id:result.record.operationId ?? null,
      planId:plan.id,planSha256:digest(jsonBytes(plan)),productId,mode:product.mode,query,
      method:'GET',url:url.href},provenance:{configSha256:digest(bytes),publicOrigin}});
  }
}
export { decisionOf };
