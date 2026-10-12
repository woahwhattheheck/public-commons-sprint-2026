// MIT. Original WFS capture and exact feature bytes, plus native WMS rendering.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { bytes, identity, digest, readPrivate, atomicJson } from '../../../postgres/publisher/files.mjs';
import { durableDirectory, parseWfsXml } from '../../../wfs/source.mjs';
import { wfsRequest, wfsItemsUrl, normalizeCrs } from '../../../wfs/protocol.mjs';
import { JsonNumber, readCapture, validateSourceConfig } from '../../../ogc/source.mjs';
import { features } from '../../../ogc/project.mjs';
import { need, same, MiB, receiptBinding } from './contract.mjs';
import { optionalJson } from './journal.mjs';
import { inspectXml } from './xml.mjs';
import { readStep } from './catalog.mjs';
import { retryAt } from './transport.mjs';

const now=()=>new Date().toISOString();
function relative(service,url){
  const base=new URL(service.profile.baseUrl),target=new URL(url);
  need(target.origin===base.origin&&target.pathname.startsWith(base.pathname+'/'),'GEOSERVER_RECEIVING_ORIGIN');
  return target.pathname.slice(base.pathname.length)+target.search;
}
function wmsPath(parameters){
  const query=new URLSearchParams({service:'WMS',version:'1.3.0',...parameters});query.sort();
  return '/ows?'+query;
}
function integer(value){
  const raw=value instanceof JsonNumber?value.text:typeof value==='string'?value:null;
  need(typeof raw==='string'&&/^-?(?:0|[1-9]\d*)$/.test(raw)&&raw!=='-0','GEOSERVER_FEATURE_KEY');
  return raw;
}
function geometry(value,layer){
  if(value===null)return;
  need(value&&typeof value.type==='string','GEOSERVER_FEATURE_GEOMETRY');
  const kind=value.type.toUpperCase();
  need(layer.geometryType==='GEOMETRY'||kind===layer.geometryType,'GEOSERVER_FEATURE_GEOMETRY_TYPE');
  function coordinates(node){
    need(Array.isArray(node),'GEOSERVER_FEATURE_COORDINATES');
    if(!node.length)return;
    if(node.every(item=>item instanceof JsonNumber)){
      need(node.length===layer.dimension&&node.every(item=>Number.isFinite(Number(item.text))),
        'GEOSERVER_FEATURE_COORDINATE_DIMENSION');return;
    }
    need(node.every(Array.isArray),'GEOSERVER_FEATURE_COORDINATES');
    for(const item of node)coordinates(item);
  }
  if(kind==='GEOMETRYCOLLECTION'){
    need(Array.isArray(value.geometries),'GEOSERVER_FEATURE_GEOMETRIES');
    for(const child of value.geometries)geometry(child,{...layer,geometryType:'GEOMETRY'});
  }else coordinates(value.coordinates);
}
function featureSchema(model,layer,selected){
  const observed=model.features.find(row=>row.name===selected.name);
  need(observed?.complexTypeResolved===true,'GEOSERVER_FEATURE_SCHEMA_UNRESOLVED');
  const expected=layer.observedColumns?.map(row=>row.attname)??['sf_id','sf_key',...layer.fields.map(row=>row.name),'geom'];
  const names=observed.properties.map(row=>row.name);
  need(expected.length===names.length&&expected.every(name=>names.includes(name)),'GEOSERVER_PUBLISHED_FIELDS_CHANGED',
    'The native feature schema must expose every accepted stable-view field, including sf_id.');
  need(observed.properties.find(row=>row.name==='geom')?.geometry===true,'GEOSERVER_GEOMETRY_SCHEMA_CHANGED');
  return {targetNamespace:model.targetNamespace,feature:observed.name,
    fields:observed.properties.map(row=>({...row,
      nativeSqlType:layer.observedColumns?.find(column=>column.attname===row.name)?.type??
        layer.fields.find(column=>column.name===row.name)?.type??(row.name==='sf_id'?'bigint':row.name==='sf_key'?'text':'geometry')}))};
}
async function inspectFeatures(directory,capture,layer,selected,signal){
  need(capture.complete===true&&capture.next===null,'GEOSERVER_COMPLETE_FEATURES_REQUIRED');
  const expectedNames=new Set((layer.observedColumns?.map(row=>row.attname)??
    ['sf_id','sf_key',...layer.fields.map(row=>row.name),'geom']).filter(name=>name!=='geom'));
  const keyHash=createHash('sha256'),featureHash=createHash('sha256');let count=0n,last=null,nullGeometry=0n;
  const identifiers=new Set();let firstId=null,lastId=null;
  for await(const {feature} of features(directory,capture)){
    signal?.throwIfAborted();
    need(feature.type==='Feature'&&feature.properties&&typeof feature.properties==='object',
      'GEOSERVER_NATIVE_FEATURE_REQUIRED');
    const names=Object.keys(feature.properties);
    need(names.length===expectedNames.size&&names.every(name=>expectedNames.has(name)),'GEOSERVER_FEATURE_PROPERTIES_CHANGED');
    const id=integer(feature.properties.sf_id),numeric=BigInt(id);
    need(last===null||numeric>last,'GEOSERVER_FEATURE_ORDER_CHANGED','The complete native stream must retain unique sf_id order.');
    need(typeof feature.properties.sf_key==='string','GEOSERVER_SOURCE_FEATURE_KEY');
    need(typeof feature.id==='string'&&feature.id.endsWith('.'+id),'GEOSERVER_NATIVE_FEATURE_ID',
      'The actual WFS FeatureId must retain the accepted sf_id primary key.');
    identifiers.add(feature.id.slice(0,-id.length-1));need(identifiers.size===1,'GEOSERVER_FEATURE_ID_PREFIX_CHANGED');
    geometry(feature.geometry,layer);if(feature.geometry===null)nullGeometry++;
    featureHash.update(JSON.stringify(feature)+'\n');
    keyHash.update(JSON.stringify([id,feature.properties.sf_key])+'\n');
    firstId??=id;lastId=id;last=numeric;count++;
  }
  // The caller compares count to its exact original reader observation below.
  need(BigInt(capture.rows)===count,'GEOSERVER_FEATURE_CAPTURE_COUNT');
  return {rows:String(count),firstId,lastId,featureIdPrefix:[...identifiers][0]??null,
    keySequenceSha256:keyHash.digest('hex'),featureSequenceSha256:featureHash.digest('hex'),
    nullGeometries:String(nullGeometry),coordinateReference:'EPSG:'+layer.srid,
    sourceId:capture.sourceId,pages:capture.pages.length,bytes:capture.totalBytes};
}
function mapSelection(layer,selected,wmsLayer){
  let bbox=selected.map?.bbox;
  if(!bbox&&wmsLayer?.geographicBounds){
    const g=wmsLayer.geographicBounds;bbox=[g.west,g.south,g.east,g.north];
  }
  need(Array.isArray(bbox)&&bbox.length===4&&bbox.every(value=>typeof value==='string'&&Number.isFinite(Number(value)))&&
    Number(bbox[0])<Number(bbox[2])&&Number(bbox[1])<Number(bbox[3]),'GEOSERVER_WMS_MAP_SELECTION',
    'Select an explicit CRS:84 map extent for this layer when its native geographic bounds are empty.');
  return {bbox,width:selected.map?.width??800,height:selected.map?.height??600,crs:'CRS:84'};
}
function png(bytes,width,height){
  need(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)===width&&bytes.readUInt32BE(20)===height,
    'GEOSERVER_NATIVE_MAP_PNG','Receive the original complete PNG at the requested map dimensions.');
  return {width,height,format:'image/png'};
}
export async function receivePublication({journal,service,request,review,state,receipt,signal,verify}){
  const profile=service.profile,root=join(journal.operationDirectory(state.id),'receiving');
  await durableDirectory(root);
  const binding={schema:'starforge.geoserver-service-receiving-request.v1',operationId:state.id,
    requestSha256:state.requestSha256,reviewSha256:state.reviewSha256,
    postgis:receiptBinding(receipt,request.manifestSha256),readers:profile.readers.map(({id,roles})=>({id,roles}))};
  await journal.file(join(root,'request.json'),bytes(binding));
  async function http(name,input,validate){
    const target=join(root,name);await durableDirectory(target);
    const frozen={path:input.path,readerId:input.readerId,maximum:input.maximum??8*MiB};
    await journal.file(join(target,'request.json'),bytes(frozen));
    const existing=await optionalJson(join(target,'result.json'));
    if(existing){
      need(existing.requestSha256===identity(frozen),'GEOSERVER_RECEIVING_REQUEST_CHANGED');
      const raw=await journal.objectBytes(existing.response.body),model=await validate({...existing.response,bytes:raw});
      need(identity(model)===existing.modelSha256,'GEOSERVER_RECEIVING_MODEL_CHANGED');return {...existing,modelReference:existing.model,model};
    }
    const prior=await optionalJson(join(target,'last-response.json'));
    if(prior?.retryAt)need(Date.now()>=Date.parse(prior.retryAt),'GEOSERVER_PROVIDER_COOLDOWN',
      'Continue this original receiving after '+prior.retryAt+'.',429);
    const response=await service.request({...input,signal}),retained=await journal.response(response);
    await atomicJson(target,'last-response.json',{response:retained,retryAt:retryAt(response),at:now()});
    const model=await validate(response),modelReference=await journal.object(bytes(model),{contentType:'application/json'});
    const result={requestSha256:identity(frozen),response:retained,model:modelReference,
      modelSha256:identity(model),receivedAt:now()};
    await journal.file(join(target,'result.json'),bytes(result));return {...result,modelReference:modelReference,model};
  }
  const services=[];
  for(const reader of profile.readers){
    signal.throwIfAborted();const rootName=reader.id;
    const wfs=await http(rootName+'/wfs-capabilities',{readerId:reader.id,
      path:relative(service,wfsRequest(profile.baseUrl+'/ows','GetCapabilities',{},profile))},async response=>{
      need(response.status===200,'GEOSERVER_WFS_HTTP_'+response.status);
      const envelope=await inspectXml(response.bytes,'envelope',{python:profile.python,signal});
      need(envelope.root==='{http://www.opengis.net/wfs/2.0}WFS_Capabilities'&&envelope.version==='2.0.0'&&
        !envelope.exceptions.length,'GEOSERVER_WFS_CAPABILITIES');
      if(envelope.wfsFeatureTypes===0)return {schema:'starforge.geoserver-empty-wfs-capabilities.v1',
        version:'2.0.0',featureTypes:[],envelope};
      return parseWfsXml(response.bytes,'capabilities',{python:profile.python,signal});
    });
    const wms=await http(rootName+'/wms-capabilities',{readerId:reader.id,
      path:wmsPath({request:'GetCapabilities'})},async response=>{
      need(response.status===200,'GEOSERVER_WMS_HTTP_'+response.status);
      return inspectXml(response.bytes,'wms',{python:profile.python,signal});
    });
    const layers=[];
    for(const selected of request.layers){
      signal.throwIfAborted();const layer=receipt.layers.find(row=>row.id===selected.layerId),qualified=profile.workspace+':'+selected.name;
      const advertisedWfs=wfs.model.featureTypes.find(row=>row.name===qualified);
      const advertisedWms=wms.model.layers.find(row=>row.name===qualified);
      if(selected.enabled&&selected.advertised)need(advertisedWfs&&advertisedWms,'GEOSERVER_ADVERTISED_LAYER_MISSING',qualified);
      if(!selected.enabled||!selected.advertised)need(!advertisedWfs&&!advertisedWms,'GEOSERVER_LAYER_VISIBILITY_CHANGED',qualified);
      const item={layerId:layer.id,name:qualified,enabled:selected.enabled,advertised:selected.advertised,
        wfsAdvertised:!!advertisedWfs,wmsAdvertised:!!advertisedWms,databaseRole:profile.database.role,
        serviceRoles:reader.roles,acceptedRowCount:layer.roles.find(row=>row.name===profile.database.role).visibleRows};
      const pathName=rootName+'/layers/'+selected.name;
      if(!selected.enabled){
        const denied=await http(pathName+'/disabled-feature',{readerId:reader.id,
          path:relative(service,wfsRequest(profile.baseUrl+'/ows','GetFeature',
            {typeNames:qualified,count:1,outputFormat:'application/json'},profile))},async response=>{
          if([401,403,404].includes(response.status))return {state:'DISABLED',status:response.status};
          const envelope=await inspectXml(response.bytes,'envelope',{python:profile.python,signal});
          need(envelope.exceptions.some(error=>['InvalidParameterValue','LayerNotDefined','FeatureTypeNotFound'].includes(error.code)),
            'GEOSERVER_DISABLED_LAYER_SERVED');
          return {state:'DISABLED',status:response.status,exceptions:envelope.exceptions};
        });
        item.disabledResponse=denied.response;item.state='DISABLED_CONFIRMED';layers.push(item);continue;
      }
      if(advertisedWfs)need([advertisedWfs.defaultCrs,...advertisedWfs.otherCrs].some(value=>normalizeCrs(value)==='EPSG:'+layer.srid),
        'GEOSERVER_NATIVE_CRS_MISSING');
      const provider=service.wfs(reader.id),schemaDirectory=join(root,pathName,'schema');
      const schema=await provider.captureDocument({directory:schemaDirectory,
        url:wfsRequest(provider.endpoint,'DescribeFeatureType',{typeNames:qualified},profile),kind:'schema',signal});
      item.schema={directory:schemaDirectory.slice(root.length+1),record:schema.record,
        observation:await journal.object(bytes(featureSchema(schema.model,layer,selected)),{contentType:'application/json'}),
        fieldCount:schema.model.features.find(row=>row.name===selected.name)?.properties.length??0};
      const selection={version:'2.0.0',typeName:qualified,srsName:'EPSG:'+layer.srid,
        pageSize:profile.pageSize,sortBy:[{property:'sf_id',direction:'A'}]};
      const config=validateSourceConfig({schema:'stellar-forge.ogc-source.v1',name:qualified,kind:'wfs2',
        itemsUrl:wfsItemsUrl(provider.endpoint,selection,profile),allowLoopback:profile.allowLoopback,wfs:selection,
        pageBytes:profile.pageBytes,totalBytes:profile.totalBytes,maxPages:profile.maxPages,requestTimeoutMs:profile.timeoutMs,
        coordinateDescription:'Original GeoServer WFS response in the accepted EPSG:'+layer.srid+' coordinate reference.'});
      const captureDirectory=join(root,pathName,'features');
      await provider.captureFeatures(captureDirectory,config,{signal});
      const captured=await readCapture(captureDirectory);
      need(same(captured.config,config),'GEOSERVER_CAPTURE_SELECTION_CHANGED');
      item.features={directory:captureDirectory.slice(root.length+1),
        ...await inspectFeatures(captureDirectory,captured,layer,selected,signal)};
      need(item.features.rows===item.acceptedRowCount,'GEOSERVER_DATABASE_FEATURE_COUNT_CHANGED',
        'The complete WFS stream differs from the original accepted database reader.');
      const extent=mapSelection(layer,selected,advertisedWms);
      need(wms.model.operations.GetMap.formats.includes('image/png'),'GEOSERVER_PNG_NOT_ADVERTISED');
      const style=selected.style.workspace===null?selected.style.name:selected.style.workspace+':'+selected.style.name;
      const image=await http(pathName+'/map',{readerId:reader.id,maximum:64*MiB,
        path:wmsPath({request:'GetMap',layers:qualified,styles:style,crs:extent.crs,bbox:extent.bbox.join(','),
          width:String(extent.width),height:String(extent.height),format:'image/png',transparent:'true'})},async response=>{
        need(response.status===200&&/^image\/png(?:;|$)/i.test(response.headers['content-type']??''),'GEOSERVER_MAP_HTTP_'+response.status);
        return {...png(response.bytes,extent.width,extent.height),...extent};
      });
      item.map={selection:extent,response:image.response};item.state='RECEIVED';layers.push(item);
      state.receivingProgress={readerId:reader.id,layerId:layer.id,layers:layers.length,at:now()};await journal.save(state);
    }
    services.push({readerId:reader.id,roles:reader.roles,wfs:{response:wfs.response,model:wfs.modelReference,
      version:wfs.model.version,featureTypes:wfs.model.featureTypes.length},
      wms:{response:wms.response,model:wms.modelReference,version:wms.model.version,layers:wms.model.layers.length},layers});
  }
  for(const step of review.steps){
    const current=await readStep(service,journal,step,{signal});
    const expected=step.kind==='style'?{sha256:step.desired.body.sha256,format:step.desired.format}:step.desired;
    need(same(current.value,expected),'GEOSERVER_RECEIVING_RESOURCE_CHANGED',
      'The selected published resource changed during native receiving.',409);
  }
  await verify('after-native-receiving');
  const result={schema:'starforge.geoserver-service-receiving.v1',operationId:state.id,
    requestSha256:state.requestSha256,reviewSha256:state.reviewSha256,postgis:binding.postgis,
    services,completedAt:now()};
  await atomicJson(root,'result.json',result);delete state.receivingProgress;return result;
}
