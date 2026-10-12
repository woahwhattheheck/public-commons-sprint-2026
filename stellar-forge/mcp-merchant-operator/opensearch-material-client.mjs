// MIT. Complete typed-client runtime for the original OpenSearch material and supplier tools.
import { openSearchMaterialTools } from './catalog/opensearch-materials.mjs';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { OPENSEARCH_MATERIAL_EXPORT_MANIFEST, MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES,
  MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES, OPENSEARCH_MATERIAL_DOWNLOAD_STATE_SCHEMA,
  OPENSEARCH_MATERIAL_DOWNLOAD_RESULT_SCHEMA, parseOpenSearchMaterialExportManifest } from './opensearch-material-contracts.mjs';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const aliasPattern=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};
const specs=new Map(openSearchMaterialTools((name,description,properties,required,annotations)=>
  ({name,description,properties,required,annotations})).map(value=>[value.name,value]));
for(const [name,properties,required]of [
  ['status',{},[]],['open',{},[]],['close',{},[]],
  ['operation',{requestId:id,includeRequest:{type:'boolean'}},['requestId']]
])specs.set('merchant_opensearch_'+name,{name:'merchant_opensearch_'+name,
  properties:{workspace:{type:'string',pattern:aliasPattern.source},...properties},required:['workspace',...required]});
const pageMethods=Object.freeze({
  materialList:['cursor','nextCursor'],materialHistory:['beforeRevision','nextRevision'],
  materialRows:['offset','nextOffset'],materialChanges:['offset','nextOffset'],
  materialFacets:['offset','nextOffset'],materialSuggest:['offset','nextOffset'],
  supplierList:['cursor','nextCursor'],supplierHistory:['beforeRevision','nextRevision'],
  supplierRows:['offset','nextOffset'],supplierRecipientRows:['offset','nextOffset']
});
export const OPENSEARCH_MATERIAL_CLIENT_METHODS=Object.freeze({
  status:'status',open:'open',close:'close',operation:'operation',
  materialInputs:'material_inputs',materialList:'material_list',materialCatalog:'material_catalog',
  materialHistory:'material_history',materialDecisionGet:'material_decision_get',materialSource:'material_source',
  materialEdition:'material_edition',materialRows:'material_rows',materialChanges:'material_changes',
  materialGet:'material_get',materialFacets:'material_facets',materialSuggest:'material_suggest',
  materialQuantity:'material_quantity',materialSave:'material_save',materialUpload:'material_upload',
  materialPreview:'material_preview',materialSelect:'material_select',materialDecision:'material_decision',
  materialDraft:'material_draft',materialReceive:'material_receive',materialExport:'material_export',
  supplierTemplates:'supplier_templates',supplierList:'supplier_list',supplierPlan:'supplier_plan',
  supplierHistory:'supplier_history',supplierProduct:'supplier_product',
  supplierCorrectionGet:'supplier_correction_get',supplierReviewGet:'supplier_review_get',
  supplierRows:'supplier_rows',supplierRecipientRows:'supplier_recipient_rows',supplierRow:'supplier_row',supplierSave:'supplier_save',
  supplierCorrection:'supplier_correction',supplierReview:'supplier_review',supplierExport:'supplier_export',
  exportManifest:'material_export_manifest',exportFile:'material_export_file',
  exportFileRelease:'material_export_file_release'
});

/** JSON is checked before transmission so exact decimal strings and request fields are never coerced. */
function jsonValue(value,path,ancestors,depth=0){
  if(depth>64)fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' exceeds64 JSON levels.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){
    if(!Number.isFinite(value))fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' must be a finite JSON number.');
    return;
  }
  if(!Array.isArray(value)&&!plain(value))fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' must contain original JSON values.');
  if(ancestors.has(value))fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' contains a cycle.');
  ancestors.add(value);
  if(Array.isArray(value))for(let i=0;i<value.length;i++)jsonValue(value[i],path+'['+i+']',ancestors,depth+1);
  else{
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' must be a plain JSON object.');
    for(const [key,item]of Object.entries(value))jsonValue(item,path+'.'+key,ancestors,depth+1);
  }
  ancestors.delete(value);
}
function check(value,schema,path){
  const types=Array.isArray(schema.type)?schema.type:schema.type?[schema.type]:[];
  const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(types.length&&!types.some(type=>type==='integer'?Number.isSafeInteger(value):type===actual))
    fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' has an unsupported type.');
  if(schema.enum&&!schema.enum.includes(value))fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' must use one declared value.');
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength||
        schema.pattern&&!new RegExp(schema.pattern).test(value))
      fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' does not match its original text or identifier contract.');
  }else if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)
      fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' is outside the supported range.');
  }else if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems||
        schema.uniqueItems&&new Set(value.map(item=>JSON.stringify(item))).size!==value.length)
      fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' has an invalid number of entries or repeats a unique value.');
    if(schema.items)for(let i=0;i<value.length;i++)check(value[i],schema.items,path+'['+i+']');
  }else if(plain(value)){
    for(const key of schema.required??[])if(!Object.hasOwn(value,key))fail('OPENSEARCH_CLIENT_ARGUMENTS',path+'.'+key+' is required.');
    if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties??{},key)))
      fail('OPENSEARCH_CLIENT_ARGUMENTS',path+' contains an unsupported field.');
    for(const [key,item]of Object.entries(value))if(schema.properties?.[key])check(item,schema.properties[key],path+'.'+key);
  }
}
function checkedArguments(name,args,workspace){
  const spec=specs.get(name);
  if(!spec)fail('OPENSEARCH_CLIENT_METHOD','Choose an original OpenSearch material, supplier or lifecycle tool.');
  if(!plain(args)||Object.hasOwn(args,'workspace'))fail('OPENSEARCH_CLIENT_ARGUMENTS','The client owns its selected workspace; pass the remaining original request fields.');
  const selected={workspace,...args};
  jsonValue(selected,'arguments',new Set());
  check(selected,{type:'object',properties:spec.properties,required:spec.required,additionalProperties:false},'arguments');
  const encoded=JSON.stringify(selected);
  if(Buffer.byteLength(encoded)>2097152)fail('OPENSEARCH_CLIENT_REQUEST_TOO_LARGE','The complete request exceeds2 MiB. Transfer original sources through host-declared input aliases.');
  return JSON.parse(encoded);
}
const downloads=createRetainedDownload({
  manifestName:OPENSEARCH_MATERIAL_EXPORT_MANIFEST,parseManifest:parseOpenSearchMaterialExportManifest,
  maximumBytes:MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES,
  maximumManifestBytes:MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES,
  stateSchema:OPENSEARCH_MATERIAL_DOWNLOAD_STATE_SCHEMA,resultSchema:OPENSEARCH_MATERIAL_DOWNLOAD_RESULT_SCHEMA,
  toolPrefix:'merchant_opensearch_material_export',errorPrefix:'OPENSEARCH',
  clientName:'starforge-opensearch-material-client',
  describe:manifest=>({workspaceId:manifest.workspaceId,kind:manifest.kind,selection:manifest.selection})
});

/**
 * One explicit original workspace. Constructing the client initializes only its selected
 * transport; call open() when ready to use the existing workspace and close() when done.
 */
export class OpenSearchMaterialClient {
  #client;#scoped;#callOptions;
  constructor(client,workspace,callOptions={}){
    if(typeof workspace!=='string'||!aliasPattern.test(workspace))fail('OPENSEARCH_CLIENT_CONFIGURATION','Select one host-declared workspace alias.');
    if(!plain(client)||typeof client.call!=='function'||typeof client.endpoint!=='string'||
        !client.endpoint.trim()||client.endpoint.length>3800||/[\x00\r\n]/.test(client.endpoint))
      fail('OPENSEARCH_CLIENT_CONFIGURATION','Use the original merchant client with its stable endpoint identity.');
    this.workspace=workspace;this.endpoint=client.endpoint;this.#client=client;
    if(!plain(callOptions)||Object.keys(callOptions).some(key=>!['requestSignal','timeoutMs'].includes(key)))
      fail('OPENSEARCH_CLIENT_CONFIGURATION','Use the original call timeout and request signal options.');
    this.#callOptions=Object.freeze({...callOptions});
    // The receiving checkpoint must not resume a different alias on the same server.
    this.#scoped=Object.freeze({endpoint:JSON.stringify({endpoint:client.endpoint,workspace}),
      call:(name,args,options)=>this.call(name,args,options)});
    Object.defineProperties(this,{workspace:{writable:false},endpoint:{writable:false}});
  }
  async call(name,args={},options){
    const request=checkedArguments(name,args,this.workspace);
    const result=await this.#client.call(name,request,{...this.#callOptions,...options});
    if(!plain(result))fail('OPENSEARCH_CLIENT_REPLY_INVALID','The original tool returned no structured result.');
    return result;
  }
  /** Yield every complete page; mutable-head collections retain their documented consistency. */
  async *pages(method,args={},options){
    const paging=pageMethods[method];
    if(!paging)fail('OPENSEARCH_CLIENT_PAGINATION','Choose a paged material or supplier method.');
    const [input,output]=paging,selected={...args},seen=new Set();
    if(selected[input]!==undefined)seen.add(selected[input]);
    while(true){
      const page=await this[method](selected,options);
      if(!Object.hasOwn(page,output))fail('OPENSEARCH_CLIENT_PAGINATION','The original page omitted its continuation field.');
      yield page;
      const next=page[output];
      if(next===null)return;
      if(input==='cursor'){
        if(typeof next!=='string'||!next.length)fail('OPENSEARCH_CLIENT_PAGINATION','The original page returned an invalid cursor.');
      }else if(!Number.isSafeInteger(next)||next<(input==='offset'?0:1)||
          input==='offset'&&next<=(selected[input]??0)||
          input==='beforeRevision'&&selected[input]!==undefined&&next>=selected[input])
        fail('OPENSEARCH_CLIENT_PAGINATION','The original page did not advance its saved position.');
      if(seen.has(next))fail('OPENSEARCH_CLIENT_PAGINATION','The original page repeated a continuation token.');
      seen.add(next);selected[input]=next;
    }
  }
  inspectExport(exportId){
    return downloads.inspect({client:this.#scoped,exportId});
  }
  downloadExport({exportId,directory,chunkSize,onProgress,expectedManifestSha256,signal}={}){
    return downloads.download({client:this.#scoped,exportId,directory,chunkSize,onProgress,expectedManifestSha256,signal});
  }
}
for(const [method,suffix]of Object.entries(OPENSEARCH_MATERIAL_CLIENT_METHODS)){
  Object.defineProperty(OpenSearchMaterialClient.prototype,method,{
    value:function(args={},options){return this.call('merchant_opensearch_'+suffix,args,options);},
    writable:false,configurable:false
  });
}

/** Reuse an existing native client, or connect through the maintained merchant MCP transport. */
export async function createOpenSearchMaterialClient({workspace,client,url,tokenEnv,environment,signal,callOptions}={}){
  if(client!==undefined&&url!==undefined)fail('OPENSEARCH_CLIENT_CONFIGURATION','Select one original client or one MCP endpoint.');
  const selected=client??await openMerchantFileClient({url,tokenEnv,environment,signal,
    errorPrefix:'OPENSEARCH',clientName:'starforge-opensearch-material-client'});
  return new OpenSearchMaterialClient(selected,workspace,callOptions);
}
