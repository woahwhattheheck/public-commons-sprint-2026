// MIT. Complete original Zotero documents, typed metadata, and edition comparison.
import {SCHEMA,LIMIT,need,plain,parse,json,sha256,clone,key,library,libraryIdentity,collectionScope,text,safeFilename} from './contracts.mjs';
import {createSourceBundle,SOURCE_MANIFEST_SCHEMA} from '../../sf88-operator-buyer-cli/research-dossiers/source-bundle.mjs';

function objectVersion(value) {
  need(Number.isSafeInteger(value)&&value>=0,'ZOTERO_OBJECT_VERSION_INVALID');return value;
}
export function parsePage(bytes,{kind,library:selection}) {
  need(['items','collections','probe'].includes(kind),'ZOTERO_DOCUMENT_KIND_INVALID');
  const raw=Buffer.from(bytes);need(raw.length<=LIMIT.page,'ZOTERO_PAGE_LIMIT');
  const value=parse(raw);library(selection);
  if(kind==='probe'){
    need(plain(value)&&Object.entries(value).every(([k,v])=>/^[A-Z0-9]{8}$/.test(k)&&Number.isSafeInteger(v)&&v>=0),
      'ZOTERO_VERSION_MAP_INVALID');return value;
  }
  need(Array.isArray(value)&&value.length<=LIMIT.items,'ZOTERO_RESPONSE_ARRAY_REQUIRED');
  for(const row of value){
    need(plain(row)&&plain(row.data),'ZOTERO_RESPONSE_OBJECT_INVALID');
    key(row.key);objectVersion(row.version);
    need(row.data.key===row.key && row.data.version===row.version,'ZOTERO_DATA_IDENTITY_MISMATCH',{key:row.key});
    if(row.library!==undefined){
      need(plain(row.library)&&String(row.library.id)===selection.id &&
        row.library.type===(selection.type==='users'?'user':'group'),'ZOTERO_RESPONSE_LIBRARY_MISMATCH');
    }
    if(kind==='collections'){
      text(row.data.name,'ZOTERO_COLLECTION_NAME_REQUIRED',100000);
      need(row.data.parentCollection===false||row.data.parentCollection===null||
        typeof row.data.parentCollection==='string','ZOTERO_PARENT_COLLECTION_INVALID');
      if(row.data.parentCollection)key(row.data.parentCollection);
    }else{
      text(row.data.itemType,'ZOTERO_ITEM_TYPE_REQUIRED',1000);
      if(row.data.parentItem!==undefined&&row.data.parentItem!==false)key(row.data.parentItem);
      if(row.data.collections!==undefined)need(Array.isArray(row.data.collections)&&row.data.collections.every(k=>{key(k);return true;}),'ZOTERO_ITEM_COLLECTIONS_INVALID');
      if(row.data.creators!==undefined)need(Array.isArray(row.data.creators)&&row.data.creators.every(plain),'ZOTERO_CREATORS_INVALID');
      if(row.data.tags!==undefined)need(Array.isArray(row.data.tags)&&row.data.tags.every(plain),'ZOTERO_TAGS_INVALID');
    }
  }
  return value;
}
export function buildEdition({profile,documents,coverage,createdAt,captureId=null,attempt=null}) {
  need(Array.isArray(documents)&&documents.length>0&&documents.length<=LIMIT.pages,'ZOTERO_DOCUMENTS_REQUIRED');
  need(['CAPTURED_LIBRARY','CAPTURED_PROTOCOL_EXERCISE','RETAINED_DOCUMENT_SELECTION'].includes(coverage.mode),'ZOTERO_COVERAGE_INVALID');
  const items=new Map(),collections=new Map(),origins=new Map(),warnings=[],version=coverage.libraryVersion??null;
  let totalBytes=0;
  const seenNames=new Set();
  for(const doc of documents){
    safeFilename(doc.name);need(!seenNames.has(doc.name),'ZOTERO_DOCUMENT_NAME_DUPLICATE');seenNames.add(doc.name);
    need(Buffer.isBuffer(doc.bytes)||doc.bytes instanceof Uint8Array,'ZOTERO_DOCUMENT_BYTES_REQUIRED');
    const bytes=Buffer.from(doc.bytes);totalBytes+=bytes.length;
    need(totalBytes<=profile.maxCaptureBytes,'ZOTERO_CAPTURE_BYTES_LIMIT');
    const rows=parsePage(bytes,{kind:doc.kind,library:profile.library});
    if(doc.kind==='probe')continue;
    const map=doc.kind==='items'?items:collections;
    for(const [rowIndex,row] of rows.entries()){
      const existing=map.get(row.key);
      need(!existing||sha256(json(existing))===sha256(json(row)),'ZOTERO_DUPLICATE_OBJECT_CHANGED',{key:row.key});
      if(!existing)map.set(row.key,clone(row));
      const identity=doc.kind+':'+row.key;
      origins.set(identity,[...(origins.get(identity)??[]),{name:doc.name,sha256:sha256(bytes),index:rowIndex}]);
      if(version!==null)need(row.version<=version,'ZOTERO_OBJECT_NEWER_THAN_LIBRARY',{key:row.key});
    }
  }
  need(items.size<=profile.maxItems,'ZOTERO_ITEM_LIMIT');
  for(const c of collections.values()){
    const seen=new Set([c.key]);let parent=c.data.parentCollection;
    while(parent){need(!seen.has(parent),'ZOTERO_COLLECTION_CYCLE',{key:c.key});seen.add(parent);
      const p=collections.get(parent);if(!p){warnings.push({code:'COLLECTION_PARENT_NOT_RETAINED',key:c.key,parent});break;}parent=p.data.parentCollection;}
  }
  for(const item of items.values()){
    if(item.data.parentItem&&!items.has(item.data.parentItem))warnings.push({code:'ITEM_PARENT_NOT_RETAINED',key:item.key,parent:item.data.parentItem});
    for(const c of item.data.collections??[])if(!collections.has(c))warnings.push({code:'ITEM_COLLECTION_NOT_RETAINED',key:item.key,collection:c});
  }
  if(['CAPTURED_LIBRARY','CAPTURED_PROTOCOL_EXERCISE'].includes(coverage.mode)){
    need(Number.isSafeInteger(version)&&version>=0&&coverage.finalVersion===version&&coverage.complete===true,
      'ZOTERO_CAPTURE_VERSION_NOT_VERIFIED');
    need(coverage.itemCount===items.size&&coverage.collectionCount===collections.size,'ZOTERO_CAPTURE_COUNTS_MISMATCH');
    need(coverage.transport?.mode===(coverage.mode==='CAPTURED_LIBRARY'?'zotero-web-api-v3':'local-protocol-exercise'),
      'ZOTERO_CAPTURE_TRANSPORT_COVERAGE_MISMATCH');
    if(coverage.mode==='CAPTURED_PROTOCOL_EXERCISE')warnings.push({code:'LOCAL_PROTOCOL_EXERCISE_NOT_LIVE_ZOTERO',sourceReference:coverage.transport.sourceReference});
  }else need(coverage.complete===false,'ZOTERO_DOCUMENT_SELECTION_IS_NOT_LIBRARY_CAPTURE');
  const manifest=documents.map(d=>({name:d.name,kind:d.kind,sha256:sha256(d.bytes),bytes:d.bytes.length,
    sourceReference:d.sourceReference??'',headers:d.headers??{},receivedAt:d.receivedAt??null}));
  const identity={library:profile.library,documents:manifest,coverage,sourceTerms:profile.sourceTerms,
    selectedProfile:{title:profile.title,scope:profile.scope,includeTrashed:profile.includeTrashed}};
  return {schema:SCHEMA.edition,id:'edition:'+sha256(json(identity)),library:clone(profile.library),
    libraryIdentity:libraryIdentity(profile.library),label:profile.title,sourceTerms:profile.sourceTerms,
    createdAt,captureId,attempt,coverage:clone(coverage),scope:clone(profile.scope),documents:manifest,
    items:[...items.values()],collections:[...collections.values()],
    origins:Object.fromEntries(origins),warnings,totalBytes,
    counts:{items:items.size,collections:collections.size,documents:documents.length}};
}
export function decodeDocumentSet(input,selectedProfile) {
  const raw=Buffer.from(input);need(raw.length<=LIMIT.transfer,'ZOTERO_DOCUMENT_SET_LIMIT');
  const value=parse(raw);
  need(plain(value)&&value.schema===SCHEMA.documentSet&&Array.isArray(value.documents),'ZOTERO_DOCUMENT_SET_REQUIRED');
  need(libraryIdentity(value.library)===libraryIdentity(selectedProfile.library),'ZOTERO_DOCUMENT_LIBRARY_MISMATCH');
  need(value.documents.length>0&&value.documents.length<=LIMIT.pages,'ZOTERO_DOCUMENTS_REQUIRED');
  const documents=value.documents.map(d=>{
    need(plain(d)&&typeof d.contentBase64==='string','ZOTERO_DOCUMENT_ENCODING_INVALID');
    const bytes=Buffer.from(d.contentBase64,'base64');
    need(bytes.toString('base64')===d.contentBase64,'ZOTERO_DOCUMENT_ENCODING_INVALID');
    if(d.sha256!==undefined)need(d.sha256===sha256(bytes),'ZOTERO_DOCUMENT_HASH_MISMATCH');
    if(d.bytes!==undefined)need(d.bytes===bytes.length,'ZOTERO_DOCUMENT_LENGTH_MISMATCH');
    // Imported headers remain provenance. They cannot certify a live API capture.
    return {name:safeFilename(d.name),kind:d.kind,bytes,
      sourceReference:text(d.sourceReference??value.sourceReference??'Retained document','ZOTERO_SOURCE_REFERENCE_INVALID',4000),
      headers:plain(d.headers)?clone(d.headers):{},receivedAt:null};
  });
  return {raw,documents,coverage:{mode:'RETAINED_DOCUMENT_SELECTION',complete:false,libraryVersion:null,
    declaredVersion:value.declaredVersion??null,sourceReference:value.sourceReference??''}};
}
export function makeDocumentSet({library:selection,documents,sourceReference='',declaredVersion=null}) {
  return json({schema:SCHEMA.documentSet,library:library(selection),sourceReference,declaredVersion,
    documents:documents.map(d=>({name:safeFilename(d.name),kind:d.kind,sourceReference:d.sourceReference??sourceReference,
      headers:d.headers??{},bytes:Buffer.byteLength(d.bytes),sha256:sha256(d.bytes),contentBase64:Buffer.from(d.bytes).toString('base64')}))});
}
export function titleOf(row) {
  const data=row.data;
  return String(data.title??(data.itemType==='note'?'Note '+row.key:data.itemType==='attachment'?'Attachment '+row.key:row.key));
}
export function creatorsOf(row) {
  return (row.data.creators??[]).map(c=>({creatorType:c.creatorType??null,
    ...(c.name!==undefined?{name:c.name}:{firstName:c.firstName??'',lastName:c.lastName??''})}));
}
export function selectedItems(edition,scope=edition.scope) {
  const collections=collectionScope(scope,edition.collections),all=edition.items;
  if(collections.size===0)return all;
  const selected=new Set(all.filter(row=>(row.data.collections??[]).some(c=>collections.has(c))).map(row=>row.key));
  let changed=true;
  while(changed){changed=false;for(const item of all)if(item.data.parentItem&&selected.has(item.data.parentItem)&&!selected.has(item.key)){selected.add(item.key);changed=true;}}
  return all.filter(row=>selected.has(row.key));
}
function differences(before,after,path='',out=[]) {
  if(JSON.stringify(before)===JSON.stringify(after))return out;
  if(plain(before)&&plain(after)){
    for(const k of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()){
      const p=path+'/'+k.replaceAll('~','~0').replaceAll('/','~1');
      if(!Object.hasOwn(before,k)||!Object.hasOwn(after,k))out.push({path:p,before:{present:Object.hasOwn(before,k),value:before[k]??null},
        after:{present:Object.hasOwn(after,k),value:after[k]??null}});
      else differences(before[k],after[k],p,out);
    }
  }else out.push({path:path||'/',before:{present:true,value:before},after:{present:true,value:after}});
  return out;
}
export function compareEditions(before,after) {
  need(before.schema===SCHEMA.edition&&after.schema===SCHEMA.edition&&before.libraryIdentity===after.libraryIdentity,
    'ZOTERO_COMPARE_LIBRARY_MISMATCH');
  const compare=(kind)=>{
    const a=new Map(before[kind].map(x=>[x.key,x])),b=new Map(after[kind].map(x=>[x.key,x]));
    const added=[],removed=[],changed=[];
    for(const k of [...new Set([...a.keys(),...b.keys()])].sort()){
      if(!a.has(k))added.push(clone(b.get(k)));
      else if(!b.has(k))removed.push(clone(a.get(k)));
      else{
        const fields=differences(a.get(k),b.get(k));if(fields.length)changed.push({key:k,
          beforeVersion:a.get(k).version,afterVersion:b.get(k).version,fields});
      }
    }
    return {added,removed,changed};
  };
  const items=compare('items'),collections=compare('collections');
  return {schema:'stellar-forge.zotero-comparison.v1',libraryIdentity:before.libraryIdentity,
    before:{id:before.id,coverage:before.coverage},after:{id:after.id,coverage:after.coverage},
    items,collections,summary:{itemsAdded:items.added.length,itemsRemoved:items.removed.length,
      itemsChanged:items.changed.length,collectionsAdded:collections.added.length,
      collectionsRemoved:collections.removed.length,collectionsChanged:collections.changed.length},
    interpretation:before.coverage.mode==='CAPTURED_LIBRARY'&&after.coverage.mode==='CAPTURED_LIBRARY'&&before.coverage.complete&&after.coverage.complete?
      'Differences between two complete captured live Zotero library editions.':
      before.coverage.mode==='CAPTURED_PROTOCOL_EXERCISE'||after.coverage.mode==='CAPTURED_PROTOCOL_EXERCISE'?
      'Differences include a local protocol exercise. These do not establish a change in any live Zotero library.':
      'Differences between retained document selections; absence does not establish remote deletion.'};
}
export function projectView(project,edition,{offset=0,limit=null,query='',includeOriginal=true}={}) {
  need(Number.isSafeInteger(offset)&&offset>=0&&(limit===null||Number.isSafeInteger(limit)&&limit>=1&&limit<=1000),
    'ZOTERO_PROJECT_PAGE_INVALID');
  text(query,'ZOTERO_PROJECT_QUERY_INVALID',1000,true);
  const matched=selectedItems(edition,project.scope).filter(row=>!query||
    (row.key+' '+titleOf(row)+' '+creatorsOf(row).map(c=>c.name??[c.firstName,c.lastName].join(' ')).join(' ')).toLowerCase().includes(query.toLowerCase()));
  const candidates=matched.slice(offset,limit===null?undefined:offset+limit);
  const byKey=new Map(edition.items.map(x=>[x.key,x]));
  return {project:clone(project),total:matched.length,offset,limit,nextOffset:limit!==null&&offset+candidates.length<matched.length?offset+candidates.length:null,
    edition:{id:edition.id,library:edition.library,coverage:edition.coverage,
    counts:edition.counts,sourceTerms:edition.sourceTerms},collections:clone(edition.collections),
    items:candidates.map(row=>({key:row.key,version:row.version,itemType:row.data.itemType,title:titleOf(row),
      creators:creatorsOf(row),parentItem:row.data.parentItem??null,collections:row.data.collections??[],
      tags:clone(row.data.tags??[]),decision:clone(project.decisions[row.key]??{selected:false,classification:'unreviewed',note:''}),
      ...(includeOriginal?{original:clone(row)}:{}),origins:clone(edition.origins['items:'+row.key]??[])})),
    retiredDecisions:Object.entries(project.decisions).filter(([k])=>!byKey.has(k)).map(([key,decision])=>({key,decision})),
    sourceWarnings:clone(edition.warnings)};
}
export async function researchSourceBundle({project,edition,documents,workspaceId}) {
  const view=projectView(project,edition),files=new Map(),sources=[];
  const original=makeDocumentSet({library:edition.library,documents,sourceReference:'Retained Zotero edition '+edition.id,
    declaredVersion:edition.coverage.libraryVersion});
  files.set('original-zotero-documents.json',original);
  // Use a separately constructed identity so JSON never drops an undefined source field.
  const nativeLineage=json({schema:'stellar-forge.zotero-research-lineage.v1',workspaceId,project,
    edition:{id:edition.id,library:edition.library,libraryIdentity:edition.libraryIdentity,createdAt:edition.createdAt,
      coverage:edition.coverage,sourceTerms:edition.sourceTerms,documents:edition.documents,origins:edition.origins}});
  files.set('zotero-project-lineage.json',nativeLineage);
  sources.push({key:'zotero-original-documents',title:'Original Zotero library documents and project decisions',
    summary:'Complete retained source pages and the exact project revision used for this handoff.',
    selected:false,classification:'unreviewed',note:'This source preserves custody and does not itself assert a research finding.',
    metadata:{provider:'zotero',libraryIdentity:edition.libraryIdentity,editionId:edition.id,projectId:project.id,
      projectRevision:project.revision,coverage:edition.coverage},
    files:['original-zotero-documents.json','zotero-project-lineage.json']});
  for(const item of view.items){
    const name='item-'+item.key+'.json';files.set(name,json(item.original));
    const data=item.original.data;
    const authors=item.creators.map(c=>c.name??[c.firstName,c.lastName].filter(Boolean).join(' '));
    sources.push({key:'zotero:'+edition.libraryIdentity+':'+item.key,title:item.title.slice(0,240),
      summary:typeof data.abstractNote==='string'?data.abstractNote.slice(0,100000):'',
      ...(typeof data.url==='string'&&/^https?:\/\//.test(data.url)?{url:data.url}:{}),
      ...(typeof data.DOI==='string'&&data.DOI?{doi:data.DOI}:{}),authors,
      selected:item.decision.selected,classification:item.decision.classification,note:item.decision.note,
      citation:clone(item.original),metadata:{provider:'zotero',key:item.key,version:item.version,itemType:item.itemType,
        originalParentItem:item.parentItem,originalCollections:item.collections,originalTags:item.tags,sourcePages:item.origins,
        editionId:edition.id,projectId:project.id,projectRevision:project.revision},files:[name]});
  }
  need(sources.length<=2048,'ZOTERO_RESEARCH_BUNDLE_SOURCE_LIMIT',{limit:2047});
  const findings=(project.findings??[]).map(f=>({key:f.id,title:f.title,text:f.text,
    sourceKeys:f.itemKeys.map(k=>'zotero:'+edition.libraryIdentity+':'+k)}));
  const manifest={schema:SOURCE_MANIFEST_SCHEMA,label:project.title,sourceTerms:edition.sourceTerms,
    sourceReference:'Zotero '+edition.libraryIdentity+'; edition '+edition.id+'; project '+project.id+' revision '+project.revision,
    description:project.description,sources,findings};
  return createSourceBundle({manifestBytes:json(manifest),files,manifestName:'zotero-source-manifest.json'});
}
