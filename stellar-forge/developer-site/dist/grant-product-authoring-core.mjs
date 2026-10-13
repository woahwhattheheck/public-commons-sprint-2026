// MIT. Editable product source registrations in the original SCF submission draft.
import {GRANT_PRODUCT_REGISTRATION_SCHEMA,validateGrantProductRegistrations,
  receiveGrantProductSources,grantProductChapters} from './grant-product-sources-core.mjs';

export const PRODUCT_AUTHORING_SCHEMA='stellar-forge.grant-product-authoring.v1';
export const MAX_PRODUCT_FILE_BYTES=16*1024*1024;
const clone=value=>JSON.parse(JSON.stringify(value));
const need=(value,message)=>{if(!value)throw new Error(message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identifier=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,119}$/.test(value);
const gitSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const text=(value,label)=>need(typeof value==='string',label+' must be text.');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export function productUtf8Bytes(value){
  let size=0;for(const char of String(value)){const n=char.codePointAt(0);size+=n<=0x7f?1:n<=0x7ff?2:n<=0xffff?3:4;}return size;
}
export function productSourceSelectionOf(draft){
  return draft.productSourceAuthoring?clone(draft.productSourceAuthoring.selection):null;
}
export function emptyProductSourceAuthoring(bundleId=null){
  return {schema:PRODUCT_AUTHORING_SCHEMA,imports:[],selection:{
    bundleId,selectedKey:null,productId:'',chapter:'',note:'',registrations:[],
  }};
}
function validateSelection(value,draft,imports){
  if(value===null||value===undefined)return;
  need(object(value),'Retain the complete product-source working selection.');
  need(value.bundleId===null||(digest(value.bundleId)&&
    (draft.handover?.bundles||[]).some(row=>row.id===value.bundleId)),
    'Retain the four original reviewer files selected for product-source authoring.');
  for(const key of ['productId','chapter','note'])text(value[key],'Product source '+key);
  need(Array.isArray(value.registrations),'Retain every working product registration.');
  const keys=new Set();
  for(const row of value.registrations){
    need(object(row)&&typeof row.key==='string'&&row.key&&!keys.has(row.key),
      'Retain unique working registration identities.');
    keys.add(row.key);text(row.name,'Registration filename');text(row.note,'Registration note');
    need(object(row.document),'Retain the complete editable registration document.');
    need(row.originalSha256===null||imports.has(row.originalSha256),
      'Retain the original registration file used by this working document.');
    // Partial form values are retained; the composer validates the complete
    // registration set when the author requests a preview or declaration export.
    JSON.stringify(row.document);
  }
  need(value.selectedKey===null||keys.has(value.selectedKey),'Select a retained working registration.');
}
export function validateProductSourceAuthoring(draft){
  const value=draft.productSourceAuthoring;
  if(value===undefined){
    need(!(draft.versions||[]).some(row=>row.productSourceSelection),
      'Retain the original product-source project referenced by saved versions.');
    return draft;
  }
  need(object(value)&&value.schema===PRODUCT_AUTHORING_SCHEMA&&Array.isArray(value.imports),
    'Retain the complete product-source authoring project.');
  const imports=new Set();
  for(const file of value.imports){
    need(object(file)&&digest(file.sha256)&&!imports.has(file.sha256),'Retain unique original registration files.');
    imports.add(file.sha256);text(file.name,'Original registration filename');text(file.text,'Complete original registration');
    need(Number.isSafeInteger(file.bytes)&&file.bytes===productUtf8Bytes(file.text)&&file.bytes<=MAX_PRODUCT_FILE_BYTES,
      'Retain the complete original registration bytes.');
    need(typeof file.receivedAt==='string'&&Number.isFinite(Date.parse(file.receivedAt)),
      'Retain the original registration reception date.');
  }
  validateSelection(value.selection,draft,imports);
  for(const version of draft.versions||[])validateSelection(version.productSourceSelection,draft,imports);
  return draft;
}
export async function verifyProductSourceImports(draft,hash){
  validateProductSourceAuthoring(draft);
  for(const file of draft.productSourceAuthoring?.imports||[]){
    need(await hash(file.text)===file.sha256,'An original product registration differs from its retained file.');
  }
  return draft;
}
export function restoreProductSourceSelection(draft,version){
  if(!draft.productSourceAuthoring&&!version.productSourceSelection)return draft;
  draft.productSourceAuthoring||=emptyProductSourceAuthoring();
  draft.productSourceAuthoring.selection=version.productSourceSelection?
    clone(version.productSourceSelection):emptyProductSourceAuthoring().selection;
  return draft;
}
export function beginProductSourceAuthoring(draft,bundleId){
  const result=clone(draft);
  result.productSourceAuthoring||=emptyProductSourceAuthoring(bundleId);
  if(bundleId!==undefined)result.productSourceAuthoring.selection.bundleId=bundleId;
  return validateProductSourceAuthoring(result);
}
export function parseProductRegistration(textValue){
  text(textValue,'Registration JSON');
  need(productUtf8Bytes(textValue)<=MAX_PRODUCT_FILE_BYTES,'Open a complete registration within the 16 MiB draft allowance.');
  const document=JSON.parse(textValue.replace(/^\uFEFF/,''));
  validateGrantProductRegistrations([document]);
  return document;
}
export function registrationForComposer(row){
  need(object(row?.document),'Select a complete working registration.');
  const document=clone(row.document);
  // The existing CLI binds the exact exported file. Keep its old received-file
  // identity in Imports instead of carrying it over to edited declaration bytes.
  delete document.definition;
  return document;
}
export function receiveProductRegistration(draft,file,{key,replaceKey=null}={}){
  validateProductSourceAuthoring(draft);
  need(draft.productSourceAuthoring,'Start product-source authoring in this draft.');
  const document=parseProductRegistration(file.text);
  need(digest(file.sha256)&&file.bytes===productUtf8Bytes(file.text),
    'Read the complete selected registration file before receiving it.');
  const result=clone(draft),project=result.productSourceAuthoring;
  const previous=project.imports.find(row=>row.sha256===file.sha256);
  if(previous)need(previous.text===file.text&&previous.bytes===file.bytes,
    'The retained registration identity refers to different complete bytes.');
  else project.imports.push(clone(file));
  const existing=project.selection.registrations.find(row=>row.document.id===document.id);
  if(replaceKey!==null){
    need(project.selection.registrations.some(row=>row.key===replaceKey),'Choose an existing registration to update.');
    need(!existing||existing.key===replaceKey,'This product is already edited in another registration. Select that document.');
  }else{
    need(!existing,'This product is already in the working set. Select it and use Replace from file to receive another edition.');
    need(typeof key==='string'&&key,'Retain the new working registration identity.');
  }
  const row={key:replaceKey||key,name:file.name,document:clone(document),originalSha256:file.sha256,note:''};
  delete row.document.definition;
  if(replaceKey!==null){
    const at=project.selection.registrations.findIndex(item=>item.key===replaceKey);
    row.note=project.selection.registrations[at].note;project.selection.registrations[at]=row;
  }else project.selection.registrations.push(row);
  project.selection.selectedKey=row.key;
  return validateProductSourceAuthoring(result);
}
export function addProductRegistration(draft,{key,id,heading}={}){
  need(draft.productSourceAuthoring,'Start product-source authoring in this draft.');
  need(typeof key==='string'&&key&&identifier(id),'Enter a stable product ID using lowercase letters, digits, dots, underscores or hyphens.');
  text(heading,'Original chapter heading');need(/^## [^\r\n]+$/.test(heading),'Choose the complete original product chapter.');
  const result=clone(draft),selection=result.productSourceAuthoring.selection;
  need(!selection.registrations.some(row=>row.document.id===id),'This product already has a working registration.');
  selection.registrations.push({key,name:id+'.json',originalSha256:null,note:'',
    document:{schema:GRANT_PRODUCT_REGISTRATION_SCHEMA,id,heading,sources:[]}});
  selection.selectedKey=key;selection.productId='';selection.chapter=heading;
  return validateProductSourceAuthoring(result);
}
export function removeProductRegistration(draft,key){
  const result=clone(draft),selection=result.productSourceAuthoring?.selection;
  need(selection?.registrations.some(row=>row.key===key),'Choose a retained registration.');
  selection.registrations=selection.registrations.filter(row=>row.key!==key);
  if(selection.selectedKey===key)selection.selectedKey=selection.registrations[0]?.key||null;
  return validateProductSourceAuthoring(result);
}
export function productAuthoringContext(index,markdown){
  need(index?.schema==='stellar-forge.grant-reviewer-source-index.v1'&&Array.isArray(index.sources),
    'Select the complete original reviewer source index.');
  text(markdown,'Complete original companion');
  const chapters=grantProductChapters(markdown);
  return {index,markdown,chapters};
}
export function parseImmutableProductSource(value){
  if(typeof value!=='string')return null;
  const match=value.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(blob|tree)\/([a-f0-9]{40})(?:\/([^\s\\?#<>"()\]]*))?(?:#[^\s<>"()\]]*)?$/);
  if(!match||match[2]==='blob'&&!match[4])return null;
  const path=match[4]||'';
  if(path.split('/').some(part=>part==='.'||part==='..'||!part&&path!==''))return null;
  return {repository:match[1],kind:match[2],commit:match[3],path,
    url:'https://github.com/'+match[1]+'/'+match[2]+'/'+match[3]+(path?'/'+path:'')};
}
const sourceKind=source=>source.source_kind==='source-tree'?'tree':'blob';
const identity=source=>[source.repository,source.kind,source.commit,source.path].join('\n');
function usableIndexSource(source){
  return object(source)&&typeof source.repository==='string'&&gitSha(source.commit)&&typeof source.path==='string';
}
export function productChapterSources(context,heading){
  const chapters=context.chapters.filter(chapter=>chapter.heading===heading);
  need(chapters.length===1,'Choose one complete original chapter; resolve repeated headings in its source edition.');
  const found=new Map(),chapter=chapters[0];
  for(const match of chapter.markdown.matchAll(/https:\/\/github\.com\/[^\s<>"()\]]+/g)){
    const candidate=parseImmutableProductSource(match[0]);
    if(candidate)found.set(identity(candidate),candidate);
  }
  const registered=context.index.narrative_source?.composition?.product_source_registrations||[];
  for(const product of registered.filter(row=>row.heading===heading)){
    for(const id of product.source_ids||[]){
      const source=context.index.sources.find(row=>row.id===id);
      if(usableIndexSource(source)){
        const candidate={repository:source.repository,kind:sourceKind(source),commit:source.commit,path:source.path,
          url:source.access==='authenticated-source'?null:source.url||null,access:source.access||null};
        if(!found.has(identity(candidate)))found.set(identity(candidate),candidate);
      }
    }
  }
  return [...found.values()].map(candidate=>{
    const samePath=context.index.sources.filter(source=>usableIndexSource(source)&&source.repository===candidate.repository&&
      source.path===candidate.path&&sourceKind(source)===candidate.kind);
    const exact=samePath.filter(source=>source.commit===candidate.commit);
    return {...candidate,key:identity(candidate),indexedSources:clone(exact.length?exact:samePath)};
  });
}
export function indexedProductRegistrations(context){
  const groups=context.index.narrative_source?.composition?.product_source_registrations||[];
  return groups.filter(group=>identifier(group.id)&&typeof group.heading==='string').map(group=>{
    const sources=(group.source_ids||[]).map(id=>context.index.sources.find(source=>source.id===id))
      .filter(usableIndexSource).map(source=>sourceSpecification({
        repository:source.repository,kind:sourceKind(source),path:source.path,commit:source.commit,
        indexedSources:[source]},source));
    return {schema:GRANT_PRODUCT_REGISTRATION_SCHEMA,id:group.id,heading:group.heading,sources};
  });
}
export function sourceSpecification(candidate,indexed=null,{id='',label=''}={}){
  const source={id:indexed?.id||id,label:indexed?.label||label||candidate.path.split('/').pop()||candidate.repository,
    repository:candidate.repository,kind:candidate.kind,path:candidate.path,commit:candidate.commit};
  const exact=indexed&&indexed.repository===candidate.repository&&indexed.path===candidate.path&&
    indexed.commit===candidate.commit&&sourceKind(indexed)===candidate.kind;
  if(exact&&candidate.kind==='blob'){
    const edition={commit:candidate.commit};
    if(gitSha(indexed.git_blob))edition.git_blob=indexed.git_blob;
    if(digest(indexed.sha256))edition.sha256=indexed.sha256;
    if(Number.isSafeInteger(indexed.bytes)&&indexed.bytes>=0)edition.bytes=indexed.bytes;
    if(Object.keys(edition).length>1)source.editions=[edition];
  }
  return source;
}
export function selectProductSource(row,index,candidate,indexedId=null){
  need(object(row.document)&&Array.isArray(row.document.sources),'Select an editable registration.');
  const indexed=indexedId===null?null:candidate.indexedSources.find(source=>source.id===indexedId);
  need(indexedId===null||indexed,'Select the original indexed source identity.');
  const previous=row.document.sources[index];
  need(object(previous),'Choose a working source row.');
  if(indexed)need(!indexed.source_registration||indexed.source_registration===row.document.id,
    'This source ID belongs to product '+indexed.source_registration+'.');
  const selected=sourceSpecification(candidate,indexed,{id:previous.id,label:previous.label});
  // Keep any extra source metadata, but measured editions belong to one path.
  const samePath=previous.repository===selected.repository&&previous.path===selected.path&&
    (previous.kind||'blob')===selected.kind;
  const next={...previous,...selected};
  if(!samePath&&!selected.editions)delete next.editions;
  else if(samePath&&previous.editions){
    const editions=new Map(previous.editions.map(edition=>[edition.commit,edition]));
    for(const edition of selected.editions||[])editions.set(edition.commit,edition);
    next.editions=[...editions.values()];
  }
  row.document.sources[index]=next;
  return row;
}
export function previewProductSources(context,registrations){
  need(Array.isArray(registrations)&&registrations.length>0,'Add or import a complete product registration.');
  const documents=validateGrantProductRegistrations(registrations.map(registrationForComposer));
  const index=receiveGrantProductSources(clone(context.index),context.markdown,documents);
  const old=new Map(context.index.sources.map(source=>[source.id,source]));
  const sources=index.sources.map(source=>{
    const before=old.get(source.id)||null;
    return {id:source.id,status:before===null?'added':canonical(before)===canonical(source)?'unchanged':'changed',
      before:before?clone(before):null,after:clone(source)};
  });
  const products=documents.map(product=>{
    const chapters=context.chapters.filter(chapter=>chapter.heading===product.heading);
    const received=index.narrative_source?.composition?.product_source_registrations?.find(row=>row.id===product.id);
    return {id:product.id,heading:product.heading,chapterPresent:chapters.length===1,
      sourceIds:chapters.length===1?received?.source_ids||[]:[],
      omittedSourceIds:chapters.length===1?product.sources.map(source=>source.id).filter(id=>!received?.source_ids?.includes(id)):[]};
  });
  return {schema:'stellar-forge.grant-product-preview.v1',index,products,sources,
    counts:{products:products.length,selectedProducts:products.filter(product=>product.chapterPresent).length,
      sources:sources.length,added:sources.filter(source=>source.status==='added').length,
      changed:sources.filter(source=>source.status==='changed').length,
      unchanged:sources.filter(source=>source.status==='unchanged').length}};
}
export function productDeclarationFiles(registrations){
  const documents=validateGrantProductRegistrations(registrations.map(registrationForComposer));
  need(documents.length>0,'Add or import a complete product registration.');
  return documents.sort((a,b)=>a.id.localeCompare(b.id)).map(document=>({
    path:'grant-products/'+document.id+'.json',
    content:JSON.stringify(document,null,2)+'\n',document,
  }));
}
