import { requireValue, fail, text, id, object, array, oneOf, clone, sha, identity, uuid, now, publicError } from './common.mjs';
import { DOCUMENT_LIMIT } from './uploads.mjs';
let selected;
export async function nativeSchema(){
  if(!selected)selected=Promise.all([import('yjs'),import('@tiptap/core'),import('y-prosemirror'),import('../reference/schema.mjs')]).then(([Y,tiptap,prosemirror,shared])=>({Y,tiptap,prosemirror,shared,schema:tiptap.getSchema(shared.createContentExtensions())}));
  return selected;
}
function attributes(value,spec,locator){
  if(value===undefined)return;
  object(value,locator+'.attrs');
  for(const name of Object.keys(value))requireValue(Object.prototype.hasOwnProperty.call(spec?.attrs??{},name),'UNSUPPORTED_ATTRIBUTE','The selected native schema does not support this attribute.',422,{locator,attribute:name});
}
export function validateJSON(value,schema,locator='$'){
  object(value,locator);const type=value.type;requireValue(typeof type==='string'&&schema.nodes[type],'UNSUPPORTED_NODE','The selected native schema does not support this node.',422,{locator,type});
  for(const k of Object.keys(value))requireValue(['type','attrs','content','marks','text'].includes(k),'UNSUPPORTED_NODE_PROPERTY','An original node property has no selected native mapping.',422,{locator,property:k});
  attributes(value.attrs,schema.nodes[type].spec,locator);
  if(value.marks!==undefined)for(const [i,mark] of array(value.marks,locator+'.marks').entries()){
    object(mark,'mark');requireValue(schema.marks[mark.type],'UNSUPPORTED_MARK','The selected native schema does not support this mark.',422,{locator:locator+'.marks['+i+']',type:mark.type});
    for(const k of Object.keys(mark))requireValue(['type','attrs'].includes(k),'UNSUPPORTED_MARK_PROPERTY','An original mark property has no selected native mapping.',422,{locator,property:k});
    attributes(mark.attrs,schema.marks[mark.type].spec,locator+'.marks['+i+']');
  }
  if(value.content!==undefined)for(const [i,child] of array(value.content,locator+'.content').entries())validateJSON(child,schema,locator+'.content['+i+']');
  const node=schema.nodeFromJSON(value);node.check();return node;
}
async function htmlJSON(html,extensions){
  const [{parseFragment},{generateJSON}]=await Promise.all([import('parse5'),import('@tiptap/html/server')]);
  const root=parseFragment(html),tags=new Set(['p','h1','h2','h3','h4','h5','h6','strong','b','em','i','s','strike','del','u','a','code','pre','blockquote','ul','ol','li','br','hr']);
  const inspect=(node)=>{
    if(node.tagName){
      requireValue(tags.has(node.tagName),'UNSUPPORTED_HTML','Original HTML contains an element outside the selected schema.',422,{tag:node.tagName});
      for(const attr of node.attrs??[]){
        const allowed=node.tagName==='a'?['href','target','rel']:node.tagName==='ol'?['start']:node.tagName==='code'?['class']:[];
        requireValue(allowed.includes(attr.name),'UNSUPPORTED_HTML_ATTRIBUTE','Original HTML has an attribute without a selected mapping.',422,{tag:node.tagName,attribute:attr.name});
        if(attr.name==='href')requireValue(/^(https?:|mailto:|\/|#)/i.test(attr.value),'UNSUPPORTED_LINK','Use an explicit supported hyperlink scheme.',422);
        if(attr.name==='class')requireValue(/^language-[A-Za-z0-9_+-]+$/.test(attr.value),'UNSUPPORTED_HTML_ATTRIBUTE','Only the native code language class is mapped.',422);
      }
    }
    for(const child of node.childNodes??[])inspect(child);
  };inspect(root);return generateJSON(html,extensions);
}
function atPath(value,path){
  if(path===''||path===undefined)return value;
  text(path,'arrayPath',{min:1,max:500});let current=value;
  for(const part of path.split('.')){requireValue(part&&!['__proto__','constructor','prototype'].includes(part),'INVALID_MAPPING','Use explicit safe JSON object keys.');current=current?.[part];}
  return current;
}
export async function prepareMigration(store,project,payload){
  const format=oneOf(payload.format,['tiptap_json','html','yjs_update'],'format');
  const source=project.sources.find(s=>s.id===payload.sourceId);requireValue(source,'SOURCE_NOT_FOUND','Retain the original source first.',404);
  const edition=project.editions.find(e=>e.id===payload.editionId);requireValue(edition?.status==='frozen','EDITION_NOT_FROZEN','Use an explicitly frozen schema/configuration edition.',409);
  const mapping=clone(object(payload.mapping,'mapping')),{Y,schema,prosemirror,shared}=await nativeSchema();
  requireValue(mapping.schemaId===edition.schemaId&&mapping.schemaId===shared.SCHEMA_ID&&mapping.field===edition.field&&mapping.field===shared.FIELD_NAME,'SCHEMA_SELECTION','Mapping must select the actual installed shared native schema and field.',409);
  const original=store.objects.read(source.sha256,source.bytes),items=[];
  if(format==='tiptap_json'){
    let json;try{json=JSON.parse(original.toString('utf8'));}catch{fail('INVALID_SOURCE_JSON','The original source is not valid JSON.',422);}
    const rows=atPath(json,mapping.arrayPath);array(rows,'mapped JSON documents',{max:10000});
    for(let i=0;i<rows.length;i++){const value=object(rows[i],'mapped document');items.push({sourceKey:value[mapping.sourceKeyField],title:value[mapping.titleField],tenantId:value[mapping.tenantField]??mapping.defaultTenantId,documentName:value[mapping.documentNameField],content:value[mapping.contentField],locator:(mapping.arrayPath??'$')+'['+i+']'});}
  }else items.push({sourceKey:mapping.sourceKey,title:mapping.title,tenantId:mapping.tenantId,documentName:mapping.documentName,content:original,locator:'complete original source'});
  const seen=new Set(),rows=[];
  for(const item of items){
    const row={id:uuid('row'),sourceKey:String(item.sourceKey??''),title:String(item.title??''),tenantId:String(item.tenantId??''),documentName:String(item.documentName??''),schemaId:edition.schemaId,field:edition.field,sourceSha256:source.sha256,sourceLocator:item.locator,status:'ready',decision:'unreviewed',reason:'',errors:[],targetDocumentId:null,prepared:null};
    let ydoc;
    try{
      text(row.sourceKey,'sourceKey',{min:1,max:300});text(row.title,'document title',{min:1,max:500});id(row.tenantId,'tenantId');id(row.documentName,'documentName');
      requireValue(project.tenants.some(t=>t.id===row.tenantId),'TENANT_NOT_FOUND','Create the explicitly mapped tenant first.',422);
      const key=row.tenantId+'\0'+row.documentName;requireValue(!seen.has(key),'DUPLICATE_DOCUMENT','Two original source rows select the same tenant/document.',422);seen.add(key);
      if(format==='yjs_update'){
        requireValue(original.length<=DOCUMENT_LIMIT,'DOCUMENT_SIZE','The individual original native document exceeds32MiB.',413);
        ydoc=new Y.Doc();Y.applyUpdate(ydoc,original);
        requireValue([...ydoc.share.keys()].every(k=>k===edition.field),'UNSUPPORTED_NATIVE_FIELD','The binary source includes fields outside the selected schema.',422);
        const json=prosemirror.yDocToProsemirrorJSON(ydoc,edition.field);validateJSON(json,schema);
      }else{
        const json=format==='html'?await htmlJSON(original.toString('utf8'),shared.createContentExtensions()):item.content;
        const serialized=Buffer.from(JSON.stringify(json));requireValue(serialized.length<=DOCUMENT_LIMIT,'DOCUMENT_SIZE','The individual original document exceeds32MiB.',413);
        const node=validateJSON(json,schema);ydoc=prosemirror.prosemirrorToYDoc(node,edition.field);
      }
      const bytes=Buffer.from(Y.encodeStateAsUpdate(ydoc)),vector=Buffer.from(Y.encodeStateVector(ydoc));
      requireValue(bytes.length<=edition.config.maxDocumentBytes,'DOCUMENT_SIZE','The native document exceeds this edition limit.',413);
      row.prepared={...store.objects.put(bytes),stateVectorBase64:vector.toString('base64'),stateVectorSha256:sha(vector),format:'yjs-update-v1'};
    }catch(error){row.status='error';row.errors.push(publicError(error));}
    finally{ydoc?.destroy();}
    rows.push(row);
  }
  requireValue(rows.length,'EMPTY_MIGRATION','The selected original mapping returned no documents.',422);
  return {id:uuid('migration'),title:text(payload.title,'title',{min:1,max:300}),editionId:edition.id,sourceId:source.id,format,mapping,rows,status:'planned',jobId:null,createdAt:now(),sourceSha256:source.sha256};
}
export async function inspectBinary(bytes,field='default'){
  const {Y,schema,prosemirror,shared}=await nativeSchema();requireValue(field===shared.FIELD_NAME,'SCHEMA_SELECTION','The binary uses another selected native field.',409);
  const doc=new Y.Doc();try{Y.applyUpdate(doc,bytes);const json=prosemirror.yDocToProsemirrorJSON(doc,field);validateJSON(json,schema);const exact=Buffer.from(Y.encodeStateAsUpdate(doc));return {bytes:exact,vector:Buffer.from(Y.encodeStateVector(doc)),json};}finally{doc.destroy();}
}
