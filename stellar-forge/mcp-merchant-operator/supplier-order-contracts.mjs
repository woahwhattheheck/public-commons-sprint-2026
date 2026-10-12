// MIT. Exact argument and retained-file identities for the supplier-order operator.
import { supplierOrderTools } from './catalog/supplier-orders.mjs';

export const SUPPLIER_ORDER_EXPORT_SCHEMA='stellar-forge.supplier-order-export.v1';
export const SUPPLIER_ORDER_EXPORT_MANIFEST='supplier-order-manifest.json';
export const SUPPLIER_ORDER_DOWNLOAD_STATE_SCHEMA='stellar-forge.supplier-order-download-state.v1';
export const SUPPLIER_ORDER_DOWNLOAD_RESULT_SCHEMA='stellar-forge.supplier-order-download.v1';
export const MAX_SUPPLIER_ORDER_FILE_BYTES=8*1024*1024*1024;
export const MAX_SUPPLIER_ORDER_MANIFEST_BYTES=65536;
export const SUPPLIER_ORDER_REPLY_BYTES=1024*1024;
export const SUPPLIER_ORDER_REQUEST_BYTES=2*1024*1024;
export const SUPPLIER_ORDER_CLIENT_METHODS=Object.freeze({
  status:'status',open:'open',close:'close',inputs:'inputs',state:'state',
  orders:'orders',order:'order',orderItems:'order_items',orderHistory:'order_history',
  documents:'documents',document:'document',documentLines:'document_lines',
  drafts:'drafts',draft:'draft',draftLines:'draft_lines',newDraft:'new_draft',
  saveDraft:'save_draft',saveDraftInput:'save_draft_input',prepare:'prepare',select:'select',
  receive:'receive',receiveWorkspace:'receive_workspace',exportWorkspace:'export_workspace',
  operation:'operation',exportManifest:'export_manifest',exportFile:'export_file',exportFileRelease:'export_file_release'
});
export const SUPPLIER_ORDER_PAGED_METHODS=Object.freeze([
  'orders','orderItems','orderHistory','documents','documentLines','drafts','draftLines'
]);
export const supplierOrderSpecifications=new Map(supplierOrderTools(
  (name,description,properties,required,annotations)=>({name,description,properties,required,annotations})
).map(value=>[value.name,value]));
export const supplierOrderPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const record=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const flat=value=>typeof value==='string'&&value.length>0&&value.length<=240&&
  !/[\\/\x00-\x1f\x7f]/.test(value)&&value!=='.'&&value!=='..';

/** Copy the complete original JSON request; no decimal strings or optional fields are coerced. */
function jsonValue(value,path,ancestors,depth=0){
  if(depth>512)fail('SUPPLIER_ORDER_ARGUMENTS',path+' exceeds512 JSON levels.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('SUPPLIER_ORDER_ARGUMENTS',path+' must be a finite JSON number.');return;}
  if(!Array.isArray(value)&&!supplierOrderPlain(value))fail('SUPPLIER_ORDER_ARGUMENTS',path+' must contain original JSON values.');
  if(ancestors.has(value))fail('SUPPLIER_ORDER_ARGUMENTS',path+' contains a cycle.');
  ancestors.add(value);
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(!array&&prototype!==Object.prototype&&prototype!==null)fail('SUPPLIER_ORDER_ARGUMENTS',path+' must be a plain JSON object.');
  if(Object.getOwnPropertySymbols(value).length)fail('SUPPLIER_ORDER_ARGUMENTS',path+' contains non-JSON symbol fields.');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors);
  if(array&&keys.length!==value.length+1)fail('SUPPLIER_ORDER_ARGUMENTS',path+' must retain every original array item.');
  for(const key of keys){
    if(array&&key==='length')continue;
    const descriptor=descriptors[key];
    if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length))
      fail('SUPPLIER_ORDER_ARGUMENTS',path+' must contain only original enumerable JSON data fields.');
    jsonValue(descriptor.value,path+'.'+key,ancestors,depth+1);
  }
  ancestors.delete(value);
}
function check(value,schema,path){
  const types=Array.isArray(schema.type)?schema.type:schema.type?[schema.type]:[];
  const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(types.length&&!types.some(type=>type==='integer'?Number.isSafeInteger(value):type===actual))
    fail('SUPPLIER_ORDER_ARGUMENTS',path+' has an unsupported type.');
  if(schema.enum&&!schema.enum.includes(value))fail('SUPPLIER_ORDER_ARGUMENTS',path+' must use a declared value.');
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&value.length<schema.minLength||
       schema.maxLength!==undefined&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern).test(value))
      fail('SUPPLIER_ORDER_ARGUMENTS',path+' differs from its original text or identifier contract.');
  }else if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)
      fail('SUPPLIER_ORDER_ARGUMENTS',path+' is outside its supported range.');
  }else if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems||
       schema.uniqueItems&&new Set(value.map(item=>JSON.stringify(item))).size!==value.length)
      fail('SUPPLIER_ORDER_ARGUMENTS',path+' has an invalid size or repeats a unique value.');
    if(schema.items)for(let i=0;i<value.length;i++)check(value[i],schema.items,path+'['+i+']');
  }else if(supplierOrderPlain(value)){
    for(const key of schema.required??[])if(!Object.hasOwn(value,key))fail('SUPPLIER_ORDER_ARGUMENTS',path+'.'+key+' is required.');
    for(const [key,item]of Object.entries(value)){
      if(Object.hasOwn(schema.properties??{},key))check(item,schema.properties[key],path+'.'+key);
      else if(schema.additionalProperties===false)fail('SUPPLIER_ORDER_ARGUMENTS',path+'.'+key+' is not a declared field.');
      else if(supplierOrderPlain(schema.additionalProperties))check(item,schema.additionalProperties,path+'.'+key);
    }
  }
}
export function validateSupplierOrderArguments(name,args,{maximumBytes=SUPPLIER_ORDER_REQUEST_BYTES}={}){
  const spec=supplierOrderSpecifications.get(name);
  if(!spec)fail('METHOD_NOT_FOUND','Choose an original supplier-order tool.');
  if(!supplierOrderPlain(args))fail('SUPPLIER_ORDER_ARGUMENTS','Tool arguments must be a plain JSON object.');
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>64*1024*1024)
    fail('SUPPLIER_ORDER_ARGUMENTS','Select a supported complete request limit.');
  jsonValue(args,'arguments',new Set());
  check(args,{type:'object',properties:spec.properties,required:spec.required,additionalProperties:false},'arguments');
  const encoded=JSON.stringify(args);
  if(Buffer.byteLength(encoded)>maximumBytes)fail('SUPPLIER_ORDER_REQUEST_TOO_LARGE',
    'The complete request exceeds its selected limit. Retain a full native draft in a host-declared input for save_draft_input.');
  return JSON.parse(encoded);
}
export function validateSupplierOrderExportId(value){
  if(!record(value))fail('SUPPLIER_ORDER_DOWNLOAD_EXPORT_ID','Use the original retained file ID.');
  return value;
}
/** A collision with the private receiving manifest keeps the original filename in metadata. */
export function supplierOrderDownloadName(file){
  if(!flat(file.name))fail('SUPPLIER_ORDER_FILE_NAME','The original retained file needs its complete flat name.');
  const reserved=[SUPPLIER_ORDER_EXPORT_MANIFEST.toLowerCase(),'download-state'];
  if(!reserved.includes(file.name.toLowerCase()))return file.name;
  const extension=file.mimeType==='application/zip'?'.zip':file.mimeType==='application/xml'?'.xml':'.bin';
  return 'original-'+validateSupplierOrderExportId(file.id)+extension;
}
/** The manifest is derived only from one immutable native file and its actual workspace. */
export function parseSupplierOrderExportManifest(bytes,expectedExportId){
  const invalid=message=>fail('SUPPLIER_ORDER_DOWNLOAD_MANIFEST_INVALID',message);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>MAX_SUPPLIER_ORDER_MANIFEST_BYTES)
    invalid('Use the complete retained supplier-order manifest within its declared limit.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{invalid('The retained manifest must contain original UTF-8 JSON.');}
  if(!supplierOrderPlain(value)||value.schema!==SUPPLIER_ORDER_EXPORT_SCHEMA||
      !record(value.exportId)||value.exportId!==expectedExportId||
      typeof value.workspaceId!=='string'||!value.workspaceId||value.workspaceId.length>256||
      typeof value.kind!=='string'||!value.kind||value.kind.length>80||
      typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||
      !Array.isArray(value.files)||value.files.length!==1)
    invalid('The manifest must name its original native file, workspace, kind and creation time.');
  const file=value.files[0];
  if(!supplierOrderPlain(file)||file.id!==value.exportId||!flat(file.name)||!flat(file.originalName)||
      [SUPPLIER_ORDER_EXPORT_MANIFEST.toLowerCase(),'download-state'].includes(file.name.toLowerCase())||
      !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_SUPPLIER_ORDER_FILE_BYTES||
      !hash(file.sha256)||typeof file.type!=='string'||!file.type||file.type.length>200||/[\x00-\x1f\x7f]/.test(file.type))
    invalid('The complete native file needs its original ID, names, byte length, SHA-256 and content type.');
  return value;
}
