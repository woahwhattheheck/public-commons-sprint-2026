// MIT. Published PMTiles bytes on the original SF30 object/payment contract.
import {compileHttpSellerOffer} from '../../seller.mjs';
import {need,plain,HASH,identifier,text,digest,hash,clone,rights} from '../model.mjs';

export const OUTPUT_SOURCE_SCHEMA='starforge.pmtiles-output-source.v1';
export const OUTPUT_PACKAGE_SCHEMA='starforge.pmtiles-output-package.v1';
export const OUTPUT_CATALOG_SCHEMA='starforge.pmtiles-output-catalog.v1';
export const OBJECT_DESCRIPTION_SCHEMA='stellar-forge.object-description.v1';
export const MAX_OUTPUT_BYTES=34359738368;
export const MAX_OUTPUT_OBJECTS=64;
export const MAX_OUTPUT_CHUNKS=131072;
export const MAX_CHUNK_BYTES=1048576;
export const DEFAULT_CHUNK_BYTES=921600;
export const OUTPUT_METADATA_BYTES=16777216;
const ID=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const ATOMIC=/^(0|[1-9][0-9]{0,38})$/;
const MIME={'pmtiles':'application/vnd.pmtiles','style':'application/json','sprite-json':'application/json',
  'sprite-png':'image/png','glyph':'application/x-protobuf','document':'application/octet-stream','operations':'application/zip'};
const EXT={'pmtiles':'pmtiles','style':'json','sprite-json':'json','sprite-png':'png','glyph':'pbf','document':'bin','operations':'zip'};
export function fields(value,allowed,required=[]){
  need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
    'PMTILES_OUTPUT_FIELDS_INVALID');
}
export function outputId(value){need(typeof value==='string'&&ID.test(value),'PMTILES_OUTPUT_ID_INVALID');return value;}
export function outputHash(value){need(typeof value==='string'&&HASH.test(value),'PMTILES_OUTPUT_SHA256_REQUIRED');return value;}
export function outputCount(value,label,min=1,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,'PMTILES_OUTPUT_COUNT_INVALID',label);return value;
}
export function outputOrigin(value){
  const url=new URL(value);
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/',
    'PMTILES_OUTPUT_HTTPS_ORIGIN_REQUIRED');
  return url.origin;
}
export function outputFilename(value){
  need(typeof value==='string'&&value.length<=120&&/^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(value)&&!/[. ]$/.test(value),
    'PMTILES_OUTPUT_FILENAME_INVALID');return value;
}
export function normalizeOutputInput(value){
  const input=clone(value);
  fields(input,['requestId','expectedWorkspaceId','releaseId','releaseManifestSha256','offerId','title','origin',
    'payment','chunkBytes','objects'],['requestId','expectedWorkspaceId','releaseId','releaseManifestSha256',
    'offerId','title','origin','payment','objects']);
  identifier(input.requestId);identifier(input.expectedWorkspaceId);identifier(input.releaseId);
  outputHash(input.releaseManifestSha256);outputId(input.offerId);text(input.title,240);input.origin=outputOrigin(input.origin);
  fields(input.payment,['network','scheme','asset','payTo','maxTimeoutSeconds','extra'],
    ['network','asset','payTo']);
  input.chunkBytes=outputCount(input.chunkBytes??DEFAULT_CHUNK_BYTES,'Chunk bytes',1,MAX_CHUNK_BYTES);
  need(Array.isArray(input.objects)&&input.objects.length>=1&&input.objects.length<=MAX_OUTPUT_OBJECTS,
    'PMTILES_OUTPUT_OBJECTS_REQUIRED');
  const ids=new Set();
  for(const row of input.objects){
    fields(row,['id','resourceId','package','amount','filename'],['id','amount']);
    outputId(row.id);need(!ids.has(row.id),'PMTILES_OUTPUT_DUPLICATE_ID');ids.add(row.id);
    need(typeof row.amount==='string'&&ATOMIC.test(row.amount),'PMTILES_OUTPUT_ATOMIC_PRICE_REQUIRED');
    need((row.resourceId!==undefined)!==(row.package!==undefined),'PMTILES_OUTPUT_ONE_SOURCE_REQUIRED');
    if(row.resourceId!==undefined)identifier(row.resourceId);
    if(row.package!==undefined){
      fields(row.package,['requestId','stagingDirectory','archiveSha256'],['requestId','stagingDirectory','archiveSha256']);
      identifier(row.package.requestId);text(row.package.stagingDirectory,4096);outputHash(row.package.archiveSha256);
    }
    if(row.filename!==undefined)outputFilename(row.filename);
    // The maintained compiler validates the actual native payment fields now.
    compileHttpSellerOffer({method:'GET',description:input.title,url:input.origin+'/maps/'+input.offerId+'/'+row.id,
      payment:{...input.payment,amount:row.amount}});
  }
  return input;
}
export function publicOutputObject(row){
  return {id:row.id,path:row.path,name:row.name,description:row.description,mode:row.mode,
    bytes:row.bytes,maxBytes:row.chunkBytes,contentType:row.contentType,filename:row.filename,
    snapshot:row.snapshot,expectedSha256:row.sha256,
    ...(row.mode==='chunks'?{fixedChunkBytes:row.chunkBytes}:{}),
    product:clone(row.product)};
}
export function outputSnapshot(row){
  return digest({schema:OUTPUT_SOURCE_SCHEMA,id:row.id,bytes:row.bytes,sha256:row.sha256,
    chunkBytes:row.chunkBytes,mode:row.mode,product:row.product});
}
export function makeOutputObject({id,name,kind,bytes,sha256,chunkBytes,amount,filename,offerId,product,chunks}){
  outputId(id);text(name,240);outputCount(bytes,'Output bytes',1,MAX_OUTPUT_BYTES);outputHash(sha256);
  outputCount(chunkBytes,'Chunk bytes',1,MAX_CHUNK_BYTES);need(Object.hasOwn(MIME,kind),'PMTILES_OUTPUT_KIND_INVALID');
  const mode=bytes<=chunkBytes?'whole':'chunks',count=Math.ceil(bytes/chunkBytes);
  need(count<=MAX_OUTPUT_CHUNKS,'PMTILES_OUTPUT_CHUNK_COUNT_LIMIT');
  need(Array.isArray(chunks)&&chunks.length===count&&chunks.every(value=>typeof value==='string'&&HASH.test(value)),
    'PMTILES_OUTPUT_CHUNK_INDEX_INVALID');
  const result={id,name,kind,bytes,sha256,chunkBytes,mode,amount,filename:outputFilename(filename??id+'.'+EXT[kind]),
    contentType:MIME[kind],path:'/maps/'+outputId(offerId)+'/'+id,
    file:'objects/'+sha256,description:name,product:clone(product),chunks:[...chunks]};
  result.snapshot=outputSnapshot(result);
  result.path+='/'+result.snapshot;
  return result;
}
export function validateOutputSource(value){
  const source=clone(value);
  fields(source,['schema','requestSha256','offerId','title','origin','payment','chunkBytes','release','objects'],
    ['schema','requestSha256','offerId','title','origin','payment','chunkBytes','release','objects']);
  need(source.schema===OUTPUT_SOURCE_SCHEMA,'PMTILES_OUTPUT_SOURCE_SCHEMA_INVALID');
  outputHash(source.requestSha256);outputId(source.offerId);text(source.title,240);
  need(source.origin===outputOrigin(source.origin),'PMTILES_OUTPUT_ORIGIN_CHANGED');
  outputCount(source.chunkBytes,'Chunk bytes',1,MAX_CHUNK_BYTES);
  const r=source.release;fields(r,['workspaceId','releaseId','manifestSha256','editionId','editionVersion','runtimeSha256'],
    ['workspaceId','releaseId','manifestSha256','editionId','editionVersion','runtimeSha256']);
  identifier(r.workspaceId);identifier(r.releaseId);identifier(r.editionId);outputCount(r.editionVersion,'Edition version');
  outputHash(r.manifestSha256);outputHash(r.runtimeSha256);
  need(Array.isArray(source.objects)&&source.objects.length>=1&&source.objects.length<=MAX_OUTPUT_OBJECTS,
    'PMTILES_OUTPUT_OBJECTS_REQUIRED');
  const ids=new Set();let total=0,totalChunks=0;
  for(const row of source.objects){
    need(plain(row)&&typeof row.amount==='string'&&ATOMIC.test(row.amount),'PMTILES_OUTPUT_OBJECT_INVALID');
    fields(row.product,['schema','workspaceId','releaseId','manifestSha256','resource','package'],
      ['schema','workspaceId','releaseId','manifestSha256']);
    need(row.product.schema==='starforge.pmtiles-output-product.v1'&&row.product.workspaceId===r.workspaceId&&
      row.product.releaseId===r.releaseId&&row.product.manifestSha256===r.manifestSha256,
      'PMTILES_OUTPUT_RELEASE_BINDING_CHANGED');
    need((row.product.resource!==undefined)!==(row.product.package!==undefined),'PMTILES_OUTPUT_ONE_SOURCE_REQUIRED');
    if(row.product.resource){
      const resource=row.product.resource;fields(resource,['id','kind','name','rights'],['id','kind','name','rights']);
      identifier(resource.id);need(resource.kind===row.kind&&resource.name===row.name,'PMTILES_OUTPUT_RESOURCE_CHANGED');rights(resource.rights);
    }else{
      const pkg=row.product.package;
      fields(pkg,['requestId','packageId','manifestSha256','archiveSha256','workspaceRevision','handoverSha256'],
        ['requestId','packageId','manifestSha256','archiveSha256','workspaceRevision','handoverSha256']);
      identifier(pkg.requestId);identifier(pkg.packageId);outputHash(pkg.manifestSha256);outputHash(pkg.handoverSha256);
      need(row.kind==='operations'&&pkg.archiveSha256===row.sha256,'PMTILES_OUTPUT_PACKAGE_CHANGED');
      outputCount(pkg.workspaceRevision,'Workspace revision',0);
    }
    const expected=makeOutputObject({...row,offerId:source.offerId});
    need(digest(expected)===digest(row)&&row.chunkBytes===source.chunkBytes&&!ids.has(row.id),
      'PMTILES_OUTPUT_OBJECT_CHANGED');
    ids.add(row.id);total+=row.bytes;totalChunks+=row.chunks.length;
  }
  need(total<=MAX_OUTPUT_BYTES,'PMTILES_OUTPUT_TOTAL_SIZE_LIMIT');
  need(totalChunks<=MAX_OUTPUT_CHUNKS,'PMTILES_OUTPUT_CHUNK_COUNT_LIMIT');
  return source;
}
export function compileOutputService(input){
  const source=validateOutputSource(input);
  const routes=source.objects.map((row,index)=>{
    const definition={method:'GET',description:row.description+' Object snapshot: '+row.snapshot+'.',
      serviceName:source.title,tags:['maps','download'],payment:{...source.payment,amount:row.amount},
      ...(row.mode==='chunks'?{queryParameters:[
        {name:'offset',type:'integer',description:'Zero-based byte offset aligned to '+row.chunkBytes+' bytes',example:0},
        {name:'length',type:'integer',description:'Exactly '+row.chunkBytes+' bytes, or the remaining final bytes',example:row.chunkBytes}
      ]}:{})};
    const offer=compileHttpSellerOffer({...definition,url:source.origin+row.path});
    offer.resource.mimeType=row.contentType;
    delete offer.extensions.bazaar.info.output;delete offer.extensions.bazaar.schema.properties.output;
    return {id:row.id,path:row.path,offer,handler:'output'+index,admit:'admit'+index};
  });
  return {schema:'stellar-forge.seller-service.v1',publicOrigin:source.origin,routes};
}
export function outputDocuments(input){
  const source=validateOutputSource(input),service=compileOutputService(source);
  const description={schema:OBJECT_DESCRIPTION_SCHEMA,objects:source.objects.map(publicOutputObject)};
  const offers={schema:'starforge.pmtiles-output-offers.v1',offers:service.routes.map(row=>({id:row.id,seller:row.offer}))};
  const catalog={schema:OUTPUT_CATALOG_SCHEMA,offerId:source.offerId,title:source.title,origin:source.origin,
    release:clone(source.release),objects:source.objects.map((row,index)=>{
      const requests=row.mode==='whole'?1:Math.ceil(row.bytes/row.chunkBytes);
      return {...publicOutputObject(row),url:source.origin+row.path,offer:clone(service.routes[index].offer),
        pricing:{unit:row.mode==='whole'?'whole-object':'chunk',requests,atomicPerRequest:row.amount,
          completeDownloadAtomic:(BigInt(row.amount)*BigInt(requests)).toString()}};
    })};
  return {service,description,offers,catalog};
}
export function selectOutputRange(context,row){
  const fault=(code,status)=>{throw Object.assign(new Error(code),{code,status});};
  if(!plain(context)||context.method!=='GET'||context.body!==null&&context.body!==undefined)fault('PMTILES_OUTPUT_GET_REQUIRED',405);
  if(context.pathParams&&Object.keys(context.pathParams).length)fault('PMTILES_OUTPUT_FIXED_ROUTE_REQUIRED',400);
  const controlled=['range','if-match','if-none-match','if-range','if-modified-since','if-unmodified-since'];
  if(plain(context.headers)&&Object.keys(context.headers).some(key=>controlled.includes(key.toLowerCase())))
    fault('PMTILES_OUTPUT_USE_OFFSET_LENGTH',400);
  const query=context.query??{};
  if(!plain(query)||Object.keys(query).some(key=>!(row.mode==='chunks'?['offset','length']:[]).includes(key)))
    fault('PMTILES_OUTPUT_QUERY_INVALID',400);
  if(row.mode==='whole')return {offset:0,bytes:row.bytes,index:0,status:200};
  const integer=(name,fallback)=>{
    if(!Object.hasOwn(query,name))return fallback;
    const value=query[name];
    if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))
      fault('PMTILES_OUTPUT_QUERY_INVALID',400);
    return Number(value);
  };
  const offset=integer('offset',0),length=integer('length',row.chunkBytes);
  if(offset>=row.bytes)fault('PMTILES_OUTPUT_OFFSET_OUTSIDE_OBJECT',416);
  if(offset%row.chunkBytes!==0)fault('PMTILES_OUTPUT_CHUNK_ALIGNMENT_REQUIRED',400);
  const bytes=Math.min(row.chunkBytes,row.bytes-offset);
  if(length!==row.chunkBytes&&length!==bytes)fault('PMTILES_OUTPUT_FIXED_CHUNK_REQUIRED',400);
  return {offset,bytes,index:offset/row.chunkBytes,status:206,contentRange:'bytes '+offset+'-'+(offset+bytes-1)+'/'+row.bytes};
}
