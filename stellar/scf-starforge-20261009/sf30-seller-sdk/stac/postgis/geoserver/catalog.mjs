// MIT. Selected GeoServer resource snapshots and field-scoped publication plans.
import { bytes, digest, identity, object } from '../../../postgres/publisher/files.mjs';
import { responseJson } from './transport.mjs';
import { need, name, segment, MARKER, REVIEW_SCHEMA, receiptBinding, same, MiB } from './contract.mjs';

const list = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
export function metadataEntries(resource) {
  const entries=list(resource?.metadata?.entry);
  need(entries.every(row=>object(row)&&typeof row['@key']==='string'),'GEOSERVER_METADATA_SHAPE');
  need(new Set(entries.map(row=>row['@key'])).size===entries.length,'GEOSERVER_METADATA_DUPLICATE');
  return structuredClone(entries);
}
export function marker(resource) {
  return metadataEntries(resource).find(row=>row['@key']===MARKER)?.$ ?? null;
}
export function withMarker(resource,value) {
  const entries=metadataEntries(resource).filter(row=>row['@key']!==MARKER);
  if(value!==null)entries.push({'@key':MARKER,$:value});
  return {entry:entries};
}
function styleIdentity(style,workspace=null) {
  if(!style)return null;
  const raw=style.name;
  need(typeof raw==='string','GEOSERVER_STYLE_IDENTITY');
  const declared=typeof style.workspace==='string'?style.workspace:style.workspace?.name;
  if(raw.includes(':')){
    const [ws,key,...extra]=raw.split(':');need(extra.length===0,'GEOSERVER_STYLE_IDENTITY');
    return {name:key,workspace:ws};
  }
  const scoped=/\/rest\/workspaces\/([^/]+)\/styles\//.exec(style.href??'');
  const global=/\/rest\/styles\//.test(style.href??'');
  return {name:raw,workspace:declared??(scoped?decodeURIComponent(scoped[1]):global?null:workspace)};
}
function stableResource(value) {
  if(Array.isArray(value))return value.map(stableResource);
  if(!object(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='href')
    .map(([key,item])=>[key,stableResource(item)]));
}
export function resourceFingerprint(value) {return value===null?null:identity(stableResource(value));}
export function featureScope(value) {
  if(!value)return null;
  return {name:value.name,nativeName:value.nativeName??value.name,title:value.title??'',
    abstract:value.abstract??'',srs:value.srs??null,projectionPolicy:value.projectionPolicy??'NONE',
    enabled:value.enabled!==false,advertised:value.advertised!==false,marker:marker(value)};
}
export function layerScope(value,workspace) {
  if(!value)return null;
  const resource=value.resource?.name;
  return {defaultStyle:styleIdentity(value.defaultStyle,workspace),
    resource:typeof resource==='string'&&!resource.includes(':')?workspace+':'+resource:resource??null};
}
export const accessValue = value => value===undefined||value===null?null:
  String(value).split(',').map(x=>x.trim()).filter(Boolean).sort();
export function paths(profile) {
  const workspace='/rest/workspaces/'+segment(profile.workspace);
  const datastore=workspace+'/datastores/'+segment(profile.datastore);
  return {workspace,datastore,
    feature:name=>datastore+'/featuretypes/'+segment(name)+'.json',
    featureList:datastore+'/featuretypes.json',
    layer:name=>'/rest/layers/'+segment(profile.workspace+':'+name)+'.json',
    style:(name,ws=profile.workspace)=> (ws===null?'/rest':('/rest/workspaces/'+segment(ws)))+'/styles/'+segment(name),
    styles:(ws=profile.workspace)=> (ws===null?'/rest':('/rest/workspaces/'+segment(ws)))+'/styles',
    acl:'/rest/security/acl/layers.json'};
}
async function fetchJson(service,journal,path,{signal,missing=false,private:privateObject=false}={}) {
  const response=await service.request({path,signal});
  const retained=await journal.response(response,{private:privateObject});
  return {document:responseJson(response,{allowMissing:missing}),response:retained};
}
function params(store) {
  const values={};
  for(const entry of list(store?.connectionParameters?.entry)){
    need(object(entry)&&typeof entry['@key']==='string'&&!Object.hasOwn(values,entry['@key']),
      'GEOSERVER_STORE_PARAMETERS');
    values[entry['@key']]=entry.$;
  }
  return values;
}
export function describeDatastore(store) {
  const value=params(store);
  return {name:store.name,enabled:store.enabled!==false,type:store.type??null,
    database:{host:String(value.host??''),port:Number(value.port??5432),name:String(value.database??''),
      schema:String(value.schema??'public'),role:String(value.user??''),
      primaryKeyMetadataTable:String(value['Primary key metadata table']??''),
      exposePrimaryKeys:String(value['Expose primary keys']??'false').toLowerCase()==='true',
      dbtype:String(value.dbtype??'')},
    connectionParameters:Object.fromEntries(Object.entries(value).filter(([key])=>
      !/password|passwd|secret|token|credential/i.test(key)))};
}
export function assertDatastore(profile,receipt,store) {
  const observed=describeDatastore(store),expected=profile.database;
  need(observed.enabled&&['postgis','postgisng'].includes(observed.database.dbtype.toLowerCase()),
    'GEOSERVER_POSTGIS_STORE','Select the existing enabled native PostGIS datastore.');
  for(const key of ['host','port','name','schema','role','primaryKeyMetadataTable'])
    need(observed.database[key]===expected[key],'GEOSERVER_STORE_BINDING_CHANGED',
      'The actual selected datastore differs in '+key+'.',409);
  need(observed.database.exposePrimaryKeys,'GEOSERVER_EXPOSE_PRIMARY_KEYS',
    'Use the existing PostGIS store with its original stable primary keys exposed.',409);
  need(receipt.database.profileId===expected.profileId&&receipt.database.name===expected.name&&
    receipt.database.schema===expected.schema,'GEOSERVER_RECEIPT_DATABASE_CHANGED',undefined,409);
  return observed;
}
function rolesFrom(document) {
  const candidates=Array.isArray(document)?document:
    document?.roles?.role??document?.roles??document?.role;
  const result=list(candidates).map(row=>typeof row==='string'?row:row?.name??row?.roleName);
  need(result.length>0&&result.every(row=>typeof row==='string'),'GEOSERVER_ROLE_LIST');
  return [...new Set(result)].sort();
}
function typesFrom(document) {
  const candidate=document?.list?.featureTypeName??document?.list?.string??document?.featureTypeNames?.featureTypeName??
    document?.featureTypeName??document?.list??document?.featureTypes?.featureType??document;
  const result=list(candidate).map(row=>typeof row==='string'?row:row?.name);
  need(result.every(row=>typeof row==='string'),'GEOSERVER_NATIVE_TYPE_LIST');
  return result;
}
export async function readCatalog(service,journal,receipt,selection,{signal}={}) {
  const profile=service.profile,p=paths(profile);
  const [workspace,datastore,version,rules,roles,available]=await Promise.all([
    fetchJson(service,journal,p.workspace+'.json',{signal}),
    fetchJson(service,journal,p.datastore+'.json',{signal,private:true}),
    fetchJson(service,journal,'/rest/about/version.json',{signal}),
    fetchJson(service,journal,p.acl,{signal}),
    fetchJson(service,journal,'/rest/security/roles.json',{signal}),
    fetchJson(service,journal,p.featureList+'?list=all',{signal}),
  ]);
  need(workspace.document?.workspace?.name===profile.workspace,'GEOSERVER_WORKSPACE_CHANGED');
  need(datastore.document?.dataStore?.name===profile.datastore,'GEOSERVER_DATASTORE_CHANGED');
  const store=assertDatastore(profile,receipt,datastore.document.dataStore);
  need(object(rules.document)&&Object.values(rules.document).every(value=>typeof value==='string'),
    'GEOSERVER_ACCESS_RULES');
  const roleNames=rolesFrom(roles.document),nativeTypes=typesFrom(available.document);
  const resourceVersions=list(version.document?.about?.resource);
  const server=resourceVersions.find(row=>row['@name']==='GeoServer'||row.name==='GeoServer');
  need(server&&typeof server.Version==='string','GEOSERVER_VERSION_OBSERVATION');
  const layers=[];
  for(const selected of selection){
    signal?.throwIfAborted();
    const source=receipt.layers.find(row=>row.id===selected.layerId);
    need(nativeTypes.includes(source.relation),'GEOSERVER_NATIVE_VIEW_MISSING',
      'The selected existing PostGIS store does not advertise the accepted native view '+source.relation+'.',409);
    for(const role of [...selected.access.read,...selected.access.write])
      need(roleNames.includes(role),'GEOSERVER_ROLE_MISSING','The selected GeoServer role is absent: '+role+'.',409);
    const [feature,layer,style]=await Promise.all([
      fetchJson(service,journal,p.feature(selected.name),{signal,missing:true}),
      fetchJson(service,journal,p.layer(selected.name),{signal,missing:true}),
      fetchJson(service,journal,p.style(selected.style.name,selected.style.workspace)+'.json',{signal,missing:true}),
    ]);
    const ft=feature.document?.featureType??null,ly=layer.document?.layer??null,st=style.document?.style??null;
    need(!ft||ft.nativeName===source.relation&&ft.name===selected.name,'GEOSERVER_FEATURE_TARGET_CHANGED',undefined,409);
    need(!ft||ly,'GEOSERVER_EXISTING_LAYER_MISSING',
      'Restore the existing feature type and its original layer before preparing this publication.',409);
    need(!ly||ft,'GEOSERVER_LAYER_NAME_OCCUPIED',undefined,409);
    if(ly)need(ly.resource?.name===profile.workspace+':'+selected.name||
      ly.resource?.name===selected.name,'GEOSERVER_LAYER_RESOURCE_CHANGED',undefined,409);
    let styleBody=null;
    if(st){
      need(!st.format||['sld','se'].includes(String(st.format).toLowerCase()),'GEOSERVER_STYLE_FORMAT',
        'Select the retained SLD or SE style for this native publication.');
      const format=String(st.format??'sld').toLowerCase();
      const response=await service.request({path:p.style(selected.style.name,selected.style.workspace)+'.'+format,
        accept:format==='se'?'application/vnd.ogc.se+xml':'application/vnd.ogc.sld+xml',signal,maximum:8*MiB});
      need(response.status===200,'GEOSERVER_STYLE_HTTP_'+response.status);
      styleBody=await journal.response(response);
    }
    let originalDefaultStyle=null;
    const previousStyle=ly?styleIdentity(ly.defaultStyle,profile.workspace):null;
    if(previousStyle && !same(previousStyle,{name:selected.style.name,workspace:selected.style.workspace})){
      const metadata=await fetchJson(service,journal,p.style(previousStyle.name,previousStyle.workspace)+'.json',{signal});
      const format=String(metadata.document?.style?.format??'sld').toLowerCase();
      need(['sld','se'].includes(format),'GEOSERVER_ORIGINAL_STYLE_FORMAT');
      const raw=await service.request({path:p.style(previousStyle.name,previousStyle.workspace)+'.'+format,
        accept:format==='se'?'application/vnd.ogc.se+xml':'application/vnd.ogc.sld+xml',maximum:8*MiB,signal});
      need(raw.status===200,'GEOSERVER_ORIGINAL_STYLE_HTTP_'+raw.status);
      originalDefaultStyle={identity:previousStyle,metadata:metadata.document.style,metadataResponse:metadata.response,
        response:await journal.response(raw)};
    }
    need(st||selected.style.file,'GEOSERVER_STYLE_NOT_FOUND','Choose an existing style or its complete retained SLD source.',409);
    const access=Object.fromEntries(['read','write'].map((key,index)=>{
      const rule=profile.workspace+'.'+selected.name+'.'+['r','w'][index];
      return [key,{rule,value:accessValue(rules.document[rule])}];
    }));
    layers.push({selection:selected,source,feature:ft,layer:ly,style:st,styleBody,originalDefaultStyle,access,
      responses:{feature:feature.response,layer:layer.response,style:style.response}});
  }
  return {schema:'starforge.geoserver-catalog-snapshot.v1',observedAt:new Date().toISOString(),
    workspace:workspace.document.workspace,datastore:store,version:server.Version,roles:roleNames,
    accessRules:rules.document,workspaceAdministration:Object.fromEntries(Object.entries(rules.document).filter(([key])=>
      key==='*.*.a'||key===profile.workspace+'.*.a')),nativeTypes,layers,
    responses:{workspace:workspace.response,datastore:datastore.response,version:version.response,
      access:rules.response,roles:roles.response,nativeTypes:available.response}};
}
export function stepScope(kind,value,workspace) {
  if(kind==='feature')return featureScope(value);
  if(kind==='layer')return layerScope(value,workspace);
  if(kind==='rule')return accessValue(value);
  if(kind==='style')return value===null?null:{sha256:value.body.sha256,format:value.format};
  throw new Error('Unknown GeoServer publication resource.');
}
export function buildReview(request,receipt,snapshot,styleSources) {
  const profile=request.profile,p=paths(profile),steps=[],styleIds=new Map();
  const owner=identity({operationId:request.operationId,requestSha256:identity(request)});
  // Install explicit scoped access before GeoServer's native POST creates its enabled layer.
  for(const layer of snapshot.layers)for(const key of ['read','write']){
    const before=layer.access[key],desired=layer.selection.access[key];
    steps.push({id:'rule-'+identity(before.rule),kind:'rule',rule:before.rule,path:p.acl,
      before:before.value,desired,layerId:layer.source.id});
  }
  for(const row of snapshot.layers){
    const selected=row.selection,key=[selected.style.workspace,selected.style.name].join(':');
    const supplied=styleSources[key],body=supplied??row.styleBody?.body;
    need(body,'GEOSERVER_RETAINED_STYLE');
    const format=supplied?(selected.style.format??snapshot.layers.find(item=>
      [item.selection.style.workspace,item.selection.style.name].join(':')===key&&item.selection.style.file)?.selection.style.format):
      String(row.style.format??'sld').toLowerCase();
    const old=styleIds.get(key);
    if(old)need(old.desired.body.sha256===body.sha256&&old.desired.format===format,'GEOSERVER_STYLE_SELECTION_CONFLICT');
    else{
      const step={id:'style-'+identity(key),kind:'style',path:p.style(selected.style.name,selected.style.workspace),
        collection:p.styles(selected.style.workspace),name:selected.style.name,workspace:selected.style.workspace,
        before:row.style?{metadata:row.style,format:String(row.style.format??'sld').toLowerCase(),body:row.styleBody.body}:null,
        desired:{format,body},observedOnly:!supplied,layerId:row.source.id};
      steps.push(step);styleIds.set(key,step);
    }
  }
  for(const row of snapshot.layers){
    const source=row.source,selected=row.selection;
    const desired={name:selected.name,nativeName:source.relation,title:selected.title,abstract:selected.abstract,
      srs:'EPSG:'+source.srid,projectionPolicy:'NONE',enabled:selected.enabled,advertised:selected.advertised,marker:owner};
    steps.push({id:'feature-'+identity(selected.name),kind:'feature',path:p.feature(selected.name),
      collection:p.featureList,before:featureScope(row.feature),beforeDocument:row.feature,
      desired,layerId:source.id});
    steps.push({id:'layer-'+identity(selected.name),kind:'layer',path:p.layer(selected.name),
      featurePath:p.feature(selected.name),before:layerScope(row.layer,profile.workspace),beforeDocument:row.layer,
      desired:{defaultStyle:{name:selected.style.name,workspace:selected.style.workspace},
        resource:profile.workspace+':'+selected.name},layerId:source.id,owner});
  }
  return {schema:REVIEW_SCHEMA,operationId:request.operationId,requestSha256:identity(request),kind:request.kind,
    createdAt:new Date().toISOString(),postgis:receiptBinding(receipt,request.manifestSha256),
    target:{profileId:profile.id,baseUrl:profile.baseUrl,workspace:profile.workspace,datastore:profile.datastore},
    snapshot,steps};
}
export async function readStep(service,journal,step,{signal}={}) {
  if(step.kind==='rule'){
    const observed=await fetchJson(service,journal,paths(service.profile).acl,{signal});
    return {value:accessValue(observed.document[step.rule]),response:observed.response,document:observed.document};
  }
  if(step.kind==='style'){
    const observed=await fetchJson(service,journal,step.path+'.json',{signal,missing:true});
    if(!observed.document)return {value:null,response:observed.response,document:null};
    const metadata=observed.document.style,format=String(metadata.format??'sld').toLowerCase();
    need(['sld','se'].includes(format),'GEOSERVER_STYLE_FORMAT_CHANGED');
    const raw=await service.request({path:step.path+'.'+format,accept:format==='se'?
      'application/vnd.ogc.se+xml':'application/vnd.ogc.sld+xml',signal,maximum:8*MiB});
    need(raw.status===200,'GEOSERVER_STYLE_HTTP_'+raw.status);
    const response=await journal.response(raw);
    return {value:{sha256:response.body.sha256,format},document:{metadata,format,body:response.body},response};
  }
  const observed=await fetchJson(service,journal,step.path,{signal,missing:true});
  const document=observed.document?.[step.kind==='feature'?'featureType':'layer']??null;
  return {value:stepScope(step.kind,document,service.profile.workspace),document,response:observed.response};
}
export async function mutationFor(journal,step,observed,{reverse=false}={}) {
  const target=reverse?step.before:step.desired;
  if(step.kind==='rule'){
    const path=target===null?step.path.replace(/\.json$/,'')+'/'+segment(step.rule):step.path;
    return {path,method:target===null?'DELETE':observed.value===null?'POST':'PUT',
      ...(target!==null?{body:bytes({[step.rule]:target.join(',')})}:{})};
  }
  if(step.kind==='style'){
    if(target===null)return {path:step.path+'?purge=true&recurse=false',method:'DELETE'};
    const format=target.format,body=await journal.objectBytes(target.body);
    return {path:observed.value===null?step.collection+'?name='+segment(step.name)+'&raw=true':step.path+'?raw=true',
      method:observed.value===null?'POST':'PUT',contentType:format==='se'?'application/vnd.ogc.se+xml':'application/vnd.ogc.sld+xml',body};
  }
  if(step.kind==='feature'){
    if(target===null)return {path:step.path+'?recurse=false',method:'DELETE'};
    const {marker:owner,...fields}=target;
    const featureType={...fields,metadata:withMarker(observed.document,owner)};
    return {path:observed.document===null?step.collection:step.path+'?recalculate=nativebbox,latlonbbox,attributes',
      method:observed.document===null?'POST':'PUT',body:bytes({featureType})};
  }
  if(target===null)return {path:step.path+'?recurse=false',method:'DELETE'};
  need(observed.document,'GEOSERVER_NATIVE_LAYER_NOT_CREATED');
  const style=target.defaultStyle;
  need(style,'GEOSERVER_ORIGINAL_STYLE_REQUIRED');
  return {path:step.path,method:'PUT',body:bytes({layer:{defaultStyle:{
    name:style.workspace===null?style.name:style.workspace+':'+style.name}}})};
}


export async function describeGeoServerTarget(service,journal,{signal}={}){
  const profile=service.profile,p=paths(profile);
  const [workspace,datastore,roles,scoped,global,available]=await Promise.all([
    fetchJson(service,journal,p.workspace+'.json',{signal}),
    fetchJson(service,journal,p.datastore+'.json',{signal,private:true}),
    fetchJson(service,journal,'/rest/security/roles.json',{signal}),
    fetchJson(service,journal,p.styles()+'.json',{signal}),
    fetchJson(service,journal,p.styles(null)+'.json',{signal}),
    fetchJson(service,journal,p.featureList+'?list=all',{signal})]);
  const styles=[];
  for(const [value,scope] of [[scoped,profile.workspace],[global,null]]){
    const rows=list(value.document?.styles?.style);
    for(const row of rows){need(typeof row.name==='string','GEOSERVER_STYLE_LIST');
      styles.push({name:row.name,workspace:scope});}
  }
  return {workspace:workspace.document.workspace,datastore:describeDatastore(datastore.document.dataStore),
    roles:rolesFrom(roles.document),styles,nativeViews:typesFrom(available.document)};
}
