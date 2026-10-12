// MIT. Directus 12.5 native capture and retained content-version operations.
import {SOURCE_SCHEMA,DIRECTUS_UPSTREAM,inspectDirectusSource,directusBase,collectionName,
  normalizeDirectusQuery,directusItemsURL} from './source.mjs';
import {MAX_SOURCE_BYTES,hash,canonical,fault,object,text,safeInputJSON,parseNativeJSON,nativeJSON,
  nativePlain,canonicalNative,nativeContains,responseData,nativeCount} from './semantics.mjs';
export const NATIVE_EVENT_SCHEMA='stellar-forge.directus-native-event.v1';
const ID=/^[A-Za-z0-9_.:-]{8,128}$/;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const now=()=>new Date().toISOString();
const errors=error=>({code:error.code??'DIRECTUS_NATIVE_ERROR',message:error.message});
function scalar(value,label){
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value))throw fault('DIRECTUS_KEY_PRECISION','Use the original textual item key.');
    value=String(value);
  }
  return text(value,label,512);
}
function dataObject(read,label){
  if(read.data?.type!=='object')throw fault('DIRECTUS_NATIVE_SHAPE',label+' requires the original native object.');
  return nativePlain(read.data);
}
function rawVersion(version){
  if(!object(version)||typeof version.id!=='string'||typeof version.collection!=='string'||
    !(version.item===null||typeof version.item==='string'||typeof version.item==='number'))
    throw fault('DIRECTUS_VERSION_RESPONSE','The original version identity is incomplete.');
  return version;
}
class NativeOperation{
  constructor(options,action,input){
    this.options=options;this.action=action;this.base=directusBase(options.baseUrl);
    if(!ID.test(options.operationId??''))throw fault('DIRECTUS_OPERATION_ID','Use a stable operationId of 8–128 letters, digits or . _ : -.');
    this.operationId=options.operationId;this.intent={action,baseUrl:this.base,expectedVersion:'12.5.0',...input};
    this.requestSha256=hash(canonical(this.intent));this.history=[];
    if(!Array.isArray(options.history??[]))throw fault('DIRECTUS_NATIVE_HISTORY','Pass the original operation event array.');
    for(const event of options.history??[]){
      if(!object(event)||event.schema!==NATIVE_EVENT_SCHEMA||event.operationId!==this.operationId||
        event.requestSha256!==this.requestSha256||event.action!==action||event.sequence!==this.history.length+1)
        throw fault('DIRECTUS_NATIVE_HISTORY','Original event sequence or operation input changed.',409);
      if(event.phase==='prepared'&&canonical(event.intent)!==canonical(this.intent))
        throw fault('DIRECTUS_NATIVE_HISTORY','The original native intent changed.',409);
      if(event.response){
        const r=event.response;
        if(typeof r.body_text!=='string'||Buffer.byteLength(r.body_text)!==r.body_bytes||hash(r.body_text)!==r.body_sha256)
          throw fault('DIRECTUS_NATIVE_HISTORY','A retained native response failed its exact byte identity.',409);
      }
      this.history.push(structuredClone(event));
    }
    if(this.history.length&&this.history[0].phase!=='prepared')throw fault('DIRECTUS_NATIVE_HISTORY','Original native history must start with prepared.');
    if(!['capture','compare-draft','read-item'].includes(action)&&typeof options.onEvent!=='function')
      throw fault('DIRECTUS_EVENT_WRITER','Native mutations require the original durable onEvent writer.');
    this.onEvent=options.onEvent??(async()=>{});
    if(typeof this.onEvent!=='function')throw new TypeError('onEvent must be callable');
    this.fetch=options.fetchImpl??globalThis.fetch;
    this.timeout=options.timeoutMs??30000;
    if(typeof this.fetch!=='function'||!Number.isSafeInteger(this.timeout)||this.timeout<100||this.timeout>120000)
      throw fault('DIRECTUS_TRANSPORT','Use an HTTP fetch function and a timeout from 100 to 120000 ms.');
    this.initialLength=this.history.length;
  }
  async emit(phase,fields={}){
    const event={schema:NATIVE_EVENT_SCHEMA,operationId:this.operationId,requestSha256:this.requestSha256,
      sequence:this.history.length+1,action:this.action,phase,recorded_at:now(),...fields};
    // The caller commits the event before this operation can cross the next HTTP boundary.
    await this.onEvent(structuredClone(event));this.history.push(event);return event;
  }
  previous(id,phase='received'){
    return this.history.findLast(v=>v.phase===phase&&v.request?.id===id);
  }
  invoked(id){return this.history.some(v=>v.phase==='invoking'&&v.request?.id===id);}
  async token(){
    const token=typeof this.options.token==='function'?await this.options.token():this.options.token;
    if(typeof token!=='string'||!token||token.length>16384||/[\r\n]/.test(token))
      throw fault('DIRECTUS_AUTH','Supply the original private Bearer token to the native transport.');
    return token;
  }
  async request(id,method,relative,{bodyText=null,reuse=true,allowEmpty=false}={}){
    const url=new URL(relative,this.base);
    if(url.origin!==new URL(this.base).origin||!url.pathname.startsWith(new URL(this.base).pathname)||
      url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>/token|password|secret/i.test(k)))
      throw fault('DIRECTUS_NATIVE_URL','A native operation must stay on its selected Directus service.');
    const request={id,method,url:url.href,body_bytes:bodyText===null?0:Buffer.byteLength(bodyText),
      body_sha256:bodyText===null?null:hash(bodyText),...(bodyText===null?{}:{body_text:bodyText})};
    const prior=reuse?this.previous(id):null;
    if(prior){
      if(canonical(prior.request)!==canonical(request))throw fault('DIRECTUS_NATIVE_REQUEST_CHANGED','A retained native step has different inputs.',409);
      return this.decode(prior.response,request,allowEmpty);
    }
    if(method!=='GET'&&this.invoked(id))
      throw fault('DIRECTUS_RECONCILE_REQUIRED','Reconcile the original invoked mutation before another write.',409);
    const token=await this.token();
    await this.emit('invoking',{request});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeout);
    try{
      const response=await this.fetch(url,{method,headers:{accept:'application/json',authorization:'Bearer '+token,
        ...(bodyText===null?{}:{'content-type':'application/json'})},body:bodyText??undefined,
        redirect:'error',signal:controller.signal});
      const stated=response.headers.get('content-length');
      if(stated!==null&&(!/^\d+$/.test(stated)||BigInt(stated)>BigInt(MAX_SOURCE_BYTES)))
        throw fault('DIRECTUS_RESPONSE_SIZE','The native response exceeds the supported source size.');
      const chunks=[];let length=0;
      if(response.body)for await(const chunk of response.body){
        const b=Buffer.from(chunk);length+=b.length;
        if(length>MAX_SOURCE_BYTES)throw fault('DIRECTUS_RESPONSE_SIZE','The native response exceeds the supported source size.');
        chunks.push(b);
      }
      const bytes=Buffer.concat(chunks);let body_text;
      try{body_text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
      catch{throw fault('DIRECTUS_RESPONSE_ENCODING','The native API response is not complete UTF-8.');}
      const retained={status:response.status,content_type:response.headers.get('content-type'),
        received_at:now(),body_finished_at:now(),body_text,body_bytes:bytes.length,body_sha256:hash(bytes),
        response_headers:Object.fromEntries(['content-type','etag','last-modified','date'].map(k=>[k,response.headers.get(k)]).filter(([,v])=>v!==null))};
      await this.emit('received',{request,response:retained});
      return this.decode(retained,request,allowEmpty);
    }catch(error){
      if(!this.previous(id))await this.emit(method==='GET'?'failed':'uncertain',{request,error:errors(error)});
      throw error;
    }finally{clearTimeout(timer);controller.abort();}
  }
  decode(response,request,allowEmpty){
    if(response.status<200||response.status>299){
      const error=fault('DIRECTUS_HTTP_'+response.status,'The native Directus '+request.method+' returned HTTP '+response.status+'.',response.status);
      error.response=response;throw error;
    }
    if(!response.body_text){
      if(!allowEmpty)throw fault('DIRECTUS_NATIVE_EMPTY','The native read returned an empty response.');
      return {request,response,node:null,data:null};
    }
    const node=parseNativeJSON(response.body_text);
    return {request,response,node,data:responseData(node)};
  }
  get(id,relative,reuse=true){return this.request(id,'GET',relative,{reuse});}
  async authenticate(){
    const prior=this.history.find(v=>v.phase==='principal');
    const read=await this.get('authenticated-user-'+(this.initialLength||'initial'),'users/me?fields=id%2Crole%2Cstatus',false);
    const principal=dataObject(read,'Authenticated principal');
    const serverRead=await this.get('authenticated-server-'+(this.initialLength||'initial'),'server/info',false);
    const server=dataObject(serverRead,'Directus server information');
    if(server.version!=='12.5.0')throw fault('DIRECTUS_SERVER_VERSION','This native source contract requires actual Directus 12.5.0. Observed: '+String(server.version??'missing')+'.',409);
    if(typeof principal.id!=='string'||!principal.id)throw fault('DIRECTUS_PRINCIPAL','The native token must identify its original user.');
    if(prior&&canonical(prior.principal)!==canonical(principal))
      throw fault('DIRECTUS_PRINCIPAL_CHANGED','This retained operation belongs to a different native user or role.',409);
    if(!prior)await this.emit('principal',{principal,server:{version:server.version,queryLimit:server.queryLimit??null,license:server.license??null}});
    return principal;
  }
  async run(fn){
    const completed=this.history.findLast(v=>v.phase==='complete');
    if(completed)return {...structuredClone(completed.result),replayed:true};
    if(!this.history.length)await this.emit('prepared',{intent:this.intent});
    await this.authenticate();
    const result=await fn();
    await this.emit('complete',{result});return result;
  }
  async reconcile(result,requestId){
    await this.emit('reconciled',{requestId,result});return result;
  }
  receipt(id,kind){
    const e=this.previous(id);
    if(!e)throw fault('DIRECTUS_CAPTURE_STEP','Missing original capture response '+id);
    return {id,kind,method:e.request.method,url:e.request.url,...e.response};
  }
  fresh(prefix){return prefix+'-'+this.history.length;}
}
async function lookupDraft(op,input,label){
  const filter={collection:{_eq:input.collection},key:{_eq:input.key},
    item:input.item===null?{_null:true}:{_eq:input.item},name:{_eq:input.nativeName}};
  const url=new URL('versions',op.base);url.searchParams.set('filter',safeInputJSON(filter));
  url.searchParams.set('fields','*');url.searchParams.set('limit','2');url.searchParams.set('meta','filter_count');
  const read=await op.get(label,url.href,false);
  if(read.data.type!=='array'||read.node.value.meta?.type!=='object')throw fault('DIRECTUS_DRAFT_LOOKUP','Retain the native filtered version lookup.');
  const count=nativeCount(read.node.value.meta.value.filter_count,'version filter_count');
  if(count>1||read.data.value.length!==count)throw fault('DIRECTUS_DRAFT_AMBIGUOUS','The original native draft lookup is ambiguous or clipped.',409);
  return count?rawVersion(nativePlain(read.data.value[0])):null;
}
async function getVersion(op,id,label,reuse=true){
  const read=await op.get(label,'versions/'+encodeURIComponent(id),reuse);
  const version=rawVersion(dataObject(read,'Version'));
  if(version.id!==id)throw fault('DIRECTUS_VERSION_CHANGED','The native version response has a different ID.',409);
  return {read,version,versionSha256:hash(canonicalNative(read.data))};
}
function versionResult(version,extra={}){
  return {versionId:version.id,collection:version.collection,item:version.item,version,...extra};
}

export async function captureDirectusSource(options={}){
  const collection=collectionName(options.collection),selected_query=options.query??{};
  safeInputJSON(selected_query);
  const name=options.name??'Directus '+collection,pageSize=options.pageSize??100;
  text(name,'Source name',128);
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>10000)throw fault('DIRECTUS_PAGE_SIZE','Use a pageSize from 1 to 10000.');
  const op=new NativeOperation(options,'capture',{collection,query:selected_query,name,pageSize});
  const result=await op.run(async()=>{
    const ids=[],retain=async(id,relative)=>{
      const read=await op.get(id,relative);ids.push(id);return read;
    };
    await retain('principal-before','users/me?fields=id%2Crole%2Cstatus');
    await retain('server-before','server/info');
    const c=await retain('collection-before','collections/'+encodeURIComponent(collection));
    const f=await retain('fields-before','fields/'+encodeURIComponent(collection));
    await retain('relations-before','relations/'+encodeURIComponent(collection));
    const collectionInfo=dataObject(c,'Collection');
    if(f.data.type!=='array')throw fault('DIRECTUS_SCHEMA','The native field response must be an array.');
    const fields=f.data.value.map(nativePlain),primary=fields.filter(v=>v.schema?.is_primary_key===true);
    if(primary.length!==1)throw fault('DIRECTUS_PRIMARY_KEY','Select a collection with its caller-visible original primary-key field.');
    const pk=primary[0].field,query=normalizeDirectusQuery(selected_query,pk),passes=[];
    for(let pass=1;pass<=2;pass++){
      let offset=0,total=null,ended=false;const pageIds=[];
      for(let page=0;page<50000;page++){
        const id='items-pass-'+pass+'-page-'+page;
        const read=await retain(id,directusItemsURL(op.base,collection,query,pageSize,offset));pageIds.push(id);
        if(read.node.value.meta?.type!=='object')throw fault('DIRECTUS_COUNT','The native page did not return filter_count.');
        const count=nativeCount(read.node.value.meta.value.filter_count,'filter_count');
        if(total===null)total=count;
        if(total!==count)throw fault('DIRECTUS_COUNT_CHANGED','Native result count changed during the same capture.',409);
        const n=collectionInfo.meta?.singleton===true?(read.data.type==='null'?0:read.data.type==='object'?1:null):
          read.data.type==='array'?read.data.value.length:null;
        if(n===null||n>pageSize)throw fault('DIRECTUS_ITEMS','The native item page has an unexpected shape or size.');
        offset+=n;
        if(offset>total||offset>1000000)throw fault('DIRECTUS_COUNT_CHANGED','The native result window changed or exceeds the original dataset capacity.',409);
        if(collectionInfo.meta?.singleton===true||n===0){ended=true;break;}
      }
      if(!ended||offset!==total)throw fault('DIRECTUS_PAGINATION_INCOMPLETE','The original source did not reach its counted terminal page.');
      passes.push(pageIds);
    }
    await retain('collection-after','collections/'+encodeURIComponent(collection));
    await retain('fields-after','fields/'+encodeURIComponent(collection));
    await retain('relations-after','relations/'+encodeURIComponent(collection));
    await retain('principal-after','users/me?fields=id%2Crole%2Cstatus');
    await retain('server-after','server/info');
    const capture={schema:SOURCE_SCHEMA,name,base_url:op.base,recorded_at:now(),
      protocol:{provider:'directus',contractVersion:'12.5',upstreamCommit:DIRECTUS_UPSTREAM},
      scope:{collection,selected_query,query,primary_key:pk,page_size:pageSize},
      pagination:{strategy:'counted-offset-two-pass',passes},
      requests:ids.map(id=>op.receipt(id,id.split('-').slice(0,2).join('-'))),
      native_operation:{operationId:op.operationId,requestSha256:op.requestSha256}};
    const bytes=Buffer.from(JSON.stringify(capture));
    inspectDirectusSource(bytes);return {capture};
  });
  const bytes=Buffer.from(JSON.stringify(result.capture));
  return {capture:result.capture,bytes,source:inspectDirectusSource(bytes),replayed:result.replayed??false,
    operationId:op.operationId,requestSha256:op.requestSha256};
}

export async function createDirectusDraft(options={}){
  const collection=collectionName(options.collection),item=options.item===null||options.item===undefined?null:scalar(options.item,'Original item key');
  const key=text(options.key??(item===null?'draft':''),'Version key',128);
  if(key==='published'||item===null&&key!=='draft')throw fault('DIRECTUS_VERSION_KEY','The native reserved key rules require draft for a new item and disallow published.');
  const name=options.name==null?null:text(options.name,'Draft name',100);
  const nativeName=(name??'SF30 draft')+' ['+options.operationId+']';
  const input={collection,item,key,name,nativeName};
  const op=new NativeOperation(options,'create-draft',input);
  return op.run(async()=>{
    const current=await lookupDraft(op,input,op.fresh('draft-lookup'));
    if(current)return op.reconcile(versionResult(current,{resolution:'original-named-version-readback'}),'create-version');
    if(op.invoked('create-version'))
      throw fault('DIRECTUS_DRAFT_UNCERTAIN','The original create was invoked, but its exact named version is not yet visible. Preserve this operation and reconcile its native outcome.',409);
    const body={key,name:nativeName,collection,...(item===null?{}:{item})};
    let response;
    try{response=await op.request('create-version','POST','versions',{bodyText:safeInputJSON(body),allowEmpty:true});}
    catch(error){
      if(error.response?.status>=400&&error.response.status<500)throw error;
      const found=await lookupDraft(op,input,op.fresh('draft-after-error'));
      if(found)return op.reconcile(versionResult(found,{resolution:'original-named-version-readback'}),'create-version');
      throw error;
    }
    const found=await lookupDraft(op,input,op.fresh('draft-created'));
    if(!found)throw fault('DIRECTUS_DRAFT_READBACK','The created version requires its exact named native readback.',409);
    if(response.data?.type==='object'&&nativePlain(response.data).id!==found.id)
      throw fault('DIRECTUS_DRAFT_CHANGED','The returned version ID differs from its native lookup.',409);
    return versionResult(found,{resolution:'returned-and-readback',responseSha256:response.response.body_sha256});
  });
}

function patchBody(options){
  if(options.patchJson!==undefined&&options.patch!==undefined)throw fault('DIRECTUS_PATCH','Select patch or exact patchJson once.');
  const body=options.patchJson!==undefined?options.patchJson:safeInputJSON(options.patch);
  if(typeof body!=='string'||Buffer.byteLength(body)>16*1024*1024)throw fault('DIRECTUS_PATCH','Use a complete native patch object up to 16 MiB.');
  const node=parseNativeJSON(body);
  if(node.type!=='object'||!Object.keys(node.value).length)throw fault('DIRECTUS_PATCH','Use a nonempty native patch object.');
  return {body,node};
}
export async function saveDirectusDraft(options={}){
  const versionId=scalar(options.versionId,'Version ID'),patch=patchBody(options),patchRevision=options.patchRevision??false;
  if(typeof patchRevision!=='boolean')throw fault('DIRECTUS_PATCH','patchRevision must be boolean.');
  const op=new NativeOperation(options,'save-draft',{versionId,patchJson:patch.body,patchRevision});
  return op.run(async()=>{
    const before=await getVersion(op,versionId,'version-before-save');
    const relative='versions/'+encodeURIComponent(versionId)+'/save'+(patchRevision?'?patchRevision=true':'');
    if(op.invoked('save-version')&&!op.previous('save-version')){
      const current=await getVersion(op,versionId,op.fresh('save-reconcile'),false);
      const delta=current.read.data.value.delta;
      if(delta&&nativeContains(delta,patch.node))
        return op.reconcile(versionResult(current.version,{resolution:'native-delta-matches-original-patch',patchSha256:hash(patch.body)}),'save-version');
      throw fault('DIRECTUS_SAVE_UNCERTAIN','The original save has no response and its retained patch is not visible in the version; reconcile the same native operation.',409);
    }
    let response;
    try{response=await op.request('save-version','POST',relative,{bodyText:patch.body});}
    catch(error){
      if(error.response?.status>=400&&error.response.status<500)throw error;
      const current=await getVersion(op,versionId,op.fresh('save-after-error'),false);
      const delta=current.read.data.value.delta;
      if(delta&&nativeContains(delta,patch.node))
        return op.reconcile(versionResult(current.version,{resolution:'native-delta-matches-original-patch',patchSha256:hash(patch.body)}),'save-version');
      throw error;
    }
    const current=await getVersion(op,versionId,op.fresh('saved-version'),false);
    if(current.version.collection!==before.version.collection||String(current.version.item)!==String(before.version.item))
      throw fault('DIRECTUS_VERSION_CHANGED','The version moved to a different native item during save.',409);
    return versionResult(current.version,{resolution:'returned-and-readback',responseSha256:response.response.body_sha256,
      savedJson:response.data?nativeJSON(response.data):null,patchSha256:hash(patch.body),patchRevision});
  });
}

export async function compareDirectusDraft(options={}){
  const versionId=scalar(options.versionId,'Version ID'),op=new NativeOperation(options,'compare-draft',{versionId});
  return op.run(async()=>{
    const selected=await getVersion(op,versionId,'version-before-compare');
    if(selected.version.item===null)return versionResult(selected.version,{versionSha256:selected.versionSha256,kind:'itemless-draft',mainHash:null,
      current:selected.version.delta??{},currentJson:selected.read.data.value.delta?nativeJSON(selected.read.data.value.delta):'{}',
      main:null,mainJson:null,comparisonSupported:false});
    const compared=await op.get('compare-version','versions/'+encodeURIComponent(versionId)+'/compare');
    const result=dataObject(compared,'Native version comparison');
    if(typeof result.mainHash!=='string'||typeof result.outdated!=='boolean'||compared.data.value.current?.type!=='object'||compared.data.value.main?.type!=='object')
      throw fault('DIRECTUS_COMPARE_RESPONSE','Retain native outdated, mainHash, current and main.');
    return versionResult(selected.version,{versionSha256:selected.versionSha256,...result,currentJson:nativeJSON(compared.data.value.current),
      mainJson:nativeJSON(compared.data.value.main),comparisonSupported:true,responseSha256:compared.response.body_sha256});
  });
}
async function readPromoted(op,versionId,label,returnedKey){
  const current=await getVersion(op,versionId,label+'-version',false);
  const item=returnedKey??current.version.item;
  if(item===null||item===undefined)return {current,item:null,read:null};
  if(current.version.item!==null&&String(current.version.item)!==String(item))
    throw fault('DIRECTUS_PROMOTE_KEY','The returned item key differs from the original version readback.',409);
  const read=await op.get(label+'-item','items/'+encodeURIComponent(current.version.collection)+'/'+encodeURIComponent(String(item)),false);
  dataObject(read,'Promoted item');
  return {current,item:String(item),read};
}
export async function promoteDirectusDraft(options={}){
  const versionId=scalar(options.versionId,'Version ID'),mainHash=options.mainHash??null;
  if(mainHash!==null&&(typeof mainHash!=='string'||!mainHash))throw fault('DIRECTUS_MAIN_HASH','Use the exact native compare mainHash.');
  const fields=options.fields===undefined?null:options.fields;
  if(fields!==null&&(!Array.isArray(fields)||!fields.length||fields.some(v=>typeof v!=='string'||!v)||new Set(fields).size!==fields.length))
    throw fault('DIRECTUS_PROMOTE_FIELDS','Choose unique original fields to promote.');
  const expectedVersionSha256=options.expectedVersionSha256??null;
  if(expectedVersionSha256!==null&&!/^[a-f0-9]{64}$/.test(expectedVersionSha256))throw fault('DIRECTUS_VERSION_DIGEST','Use the reviewed native version digest.');
  const op=new NativeOperation(options,'promote-draft',{versionId,mainHash,fields,expectedVersionSha256});
  return op.run(async()=>{
    const before=await getVersion(op,versionId,'version-before-promote');
    if(expectedVersionSha256!==null&&before.versionSha256!==expectedVersionSha256)
      throw fault('DIRECTUS_VERSION_CHANGED','The native draft changed after its original comparison.',409);
    if(!op.invoked('promote-version')){
      const fresh=await getVersion(op,versionId,op.fresh('version-promotion-boundary'),false);
      if(fresh.versionSha256!==before.versionSha256)throw fault('DIRECTUS_VERSION_CHANGED','The draft changed before the native promotion boundary.',409);
    }
    if(before.version.item!==null&&mainHash===null)throw fault('DIRECTUS_MAIN_HASH','An existing-item promotion requires the native mainHash.');
    const resultOf=(observed,extra)=>{
      if(observed.current.version.collection!==before.version.collection)throw fault('DIRECTUS_VERSION_CHANGED','The original version moved to another collection.',409);
      return versionResult(observed.current.version,{
      item:observed.item,itemJson:nativeJSON(observed.read.data),itemReadback:nativePlain(observed.read.data),
      itemSha256:hash(canonicalNative(observed.read.data)),...extra});};
    const reconcile=async()=>{
      const observed=await readPromoted(op,versionId,op.fresh('promote-reconcile'),null);
      if(!observed.read)return null;
      if(before.version.item===null&&observed.current.version.item!==null)
        return op.reconcile(resultOf(observed,{resolution:'original-version-now-linked-to-native-item'}),'promote-version');
      const delta=before.read.data.value.delta;
      if(delta?.type==='object'){
        const entries=Object.entries(delta.value).filter(([k])=>k!=='_user'&&k!=='_date'&&(fields===null||fields.includes(k)));
        const selected={...delta,value:Object.fromEntries(entries)};
        if(entries.length&&nativeContains(observed.read.data,selected))
          return op.reconcile(resultOf(observed,{resolution:'native-item-matches-retained-draft-fields'}),'promote-version');
      }
      return null;
    };
    if(op.invoked('promote-version')&&!op.previous('promote-version')){
      const found=await reconcile();if(found)return found;
      throw fault('DIRECTUS_PROMOTE_UNCERTAIN','The invoked native promotion has no response or matching item readback; preserve and reconcile the same operation.',409);
    }
    const body={...(mainHash===null?{}:{mainHash}),...(fields===null?{}:{fields})};
    let response;
    try{response=await op.request('promote-version','POST','versions/'+encodeURIComponent(versionId)+'/promote',{bodyText:safeInputJSON(body)});}
    catch(error){if(error.response?.status>=400&&error.response.status<500)throw error;const found=await reconcile();if(found)return found;throw error;}
    // Native 12.5 returns the item key, not the updated item.
    let returnedKey=null;
    if(response.data&&['string','number'].includes(response.data.type))returnedKey=response.data.value;
    else if(response.data?.type!=='null')throw fault('DIRECTUS_PROMOTE_RESPONSE','The original native promotion did not return an item key.');
    const observed=await readPromoted(op,versionId,op.fresh('promoted'),returnedKey);
    if(!observed.read)throw fault('DIRECTUS_PROMOTE_READBACK','Read the native item linked to the promoted version.',409);
    return resultOf(observed,{resolution:'returned-key-and-readback',returnedItemKey:returnedKey,
      responseSha256:response.response.body_sha256,mainHash,fields});
  });
}
export async function readDirectusItem(options={}){
  const collection=collectionName(options.collection),item=scalar(options.item,'Item key'),fields=options.fields??['*'];
  if(!Array.isArray(fields)||!fields.length||fields.some(v=>typeof v!=='string'||!v||v.includes(',')))
    throw fault('DIRECTUS_FIELDS','Use original native field names for item readback.');
  const op=new NativeOperation(options,'read-item',{collection,item,fields});
  return op.run(async()=>{
    const url=new URL('items/'+encodeURIComponent(collection)+'/'+encodeURIComponent(item),op.base);
    url.searchParams.set('fields',fields.join(','));
    const read=await op.get('read-item',url.href);
    const value=dataObject(read,'Original item');
    return {collection,item,itemJson:nativeJSON(read.data),itemReadback:value,itemSha256:hash(canonicalNative(read.data)),
      responseSha256:read.response.body_sha256};
  });
}
