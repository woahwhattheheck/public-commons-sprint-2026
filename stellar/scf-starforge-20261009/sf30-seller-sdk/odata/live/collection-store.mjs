// MIT. Original live collections in the existing OData service and workspace.
import { lstat,realpath,readdir } from 'node:fs/promises';
import { basename,dirname,join,resolve } from 'node:path';
import { acquireReleaseLease } from '../../../sf82-seller-pilot/release-process.mjs';
import { readRequestFile } from '../../../sf88-operator-buyer-cli/request-body.mjs';
import { readPackage } from './client.mjs';
import { COLLECTION_SCHEMA,ANALYSIS_DOCUMENT_SCHEMA,receiveCollection,openCollection,restoreCollection,readCollectionRows } from './collection.mjs';
import { plain,digest,operationFor } from './contract.mjs';
import { canonical } from '../source.mjs';

const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const CORE=/^(?:merchant\.json|projection\.json|dataset\.json|rows\.jsonl|rows-index\.jsonl|analysis-rows\.json|dataset\.csv|pages\/[0-9]{5}\/(?:request|response|buyer|result)\.json)$/;
const FILE=/^(?:merchant\.json|projection\.json|dataset\.json|selection\.json|collection\.json|rows\.jsonl|rows-index\.jsonl|analysis-rows\.json|dataset\.csv|pages\/[0-9]{5}\/(?:request|response|buyer|result)\.json|analysis\/source\.json|analysis\/files\/[a-f0-9]{64}\.(?:csv|json|bin))$/;
const MAX_FILE=256*1024*1024;
const MAX_MANIFEST=16*1024*1024;
const fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code:'ODATA_COLLECTION_STORE_'+code,status});};
const need=(condition,code,message,status)=>{if(!condition)fail(code,message,status);};
const same=(first,second)=>canonical(first)===canonical(second);
const parse=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const identity=raw=>({bytes:raw.length,sha256:digest(raw)});
const id=value=>{need(typeof value==='string'&&ID.test(value),'ID','Choose a valid collection identifier.',400);return value;};
const hashId=value=>{need(typeof value==='string'&&HASH.test(value),'PAGE_ID','Choose an original saved response or buyer identifier.',400);return value;};

async function privateDirectory(path) {
  path=resolve(path);const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&
    (typeof process.getuid!=='function'||info.uid===process.getuid())&&await realpath(path)===path,
    'DIRECTORY','Open the original private service directory.');
  return path;
}
async function readAt(root,name,limit=MAX_FILE,expected) {
  need(typeof name==='string'&&!name.startsWith('/')&&!name.split('/').some(part=>!part||part==='.'||part==='..'),
    'PATH','Choose an original service file.',400);
  const path=join(root,name);
  await privateDirectory(dirname(path));
  const raw=await readRequestFile(path,limit);
  if(expected)need(HASH.test(expected.sha256)&&raw.length===expected.bytes&&digest(raw)===expected.sha256,
    'FILE_CHANGED','An original collection file changed.');
  return raw;
}
function profileShape(profile) {
  need(plain(profile)&&profile.schema==='stellar-forge.odata-live-profile.v1'&&typeof profile.id==='string'&&ID.test(profile.id)&&
    HASH.test(profile.sourceBinding)&&typeof profile.operation==='string'&&profile.operation&&plain(profile.settings),
    'PROFILE','Choose an original live service profile.',400);
  return profile;
}
async function service({directory,profile}) {
  profileShape(profile);const root=await privateDirectory(directory);
  need(basename(root)===profile.id,'SERVICE_DIRECTORY','The selected directory belongs to another live service.');
  need(same(parse(await readAt(root,'profile.json',1048576)),profile),'PROFILE_CHANGED','The selected live service profile changed.');
  const prepared=await readPackage(join(root,'package'),{allowLoopback:profile.settings.allowLoopback===true});
  need(prepared.sourceBinding===profile.sourceBinding,'SOURCE_CHANGED','The original service package belongs to another source.');
  operationFor(prepared.plan,prepared.catalog,profile.operation);
  return {root,profile,prepared,parent:join(root,'collections')};
}
function bound(collection,selected) {
  need(collection.sourceBinding===selected.profile.sourceBinding&&collection.operation===selected.profile.operation&&
    collection.metadataSha256===selected.prepared.catalog.receipts.metadata.sha256&&
    collection.serviceRoot===selected.prepared.catalog.serviceUrl&&collection.merchantOrigin===selected.prepared.plan.publicOrigin,
    'SOURCE_CHANGED','The collection belongs to another service, operation or source edition.');
  return collection;
}
async function selectedDirectory(selected,identifier) {
  const parent=await privateDirectory(selected.parent),directory=await privateDirectory(join(parent,id(identifier)));
  return directory;
}
async function withCollection(selected,identifier,operation) {
  const directory=await selectedDirectory(selected,identifier),lease=await acquireReleaseLease(directory,'state.lock');
  try{return await operation(directory,bound(await openCollection(directory),selected));}
  finally{await lease?.close();}
}
function summary(identifier,collection) {
  return {id:identifier,status:'READY',title:collection.title,sourceBinding:collection.sourceBinding,operation:collection.operation,
    entitySet:collection.entitySet,query:collection.query,queryFingerprint:collection.queryFingerprint,
    rows:collection.rows,pageCount:collection.pageCount,keyFields:collection.keyFields,completion:collection.completion,
    reportedCounts:collection.reportedCounts,countConsistent:collection.countConsistent,acquisition:collection.acquisition,
    manifestSha256:collection.manifestSha256,analysis:collection.analysis};
}
async function names(selected) {
  let entries;try{await privateDirectory(selected.parent);entries=await readdir(selected.parent,{withFileTypes:true});}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
  const output=[];
  for(const entry of entries){
    need(entry.isDirectory()&&!entry.isSymbolicLink()&&ID.test(entry.name),
      'COLLECTION_ENTRY','The collection directory contains an unsupported entry.');
    output.push(entry.name);
  }
  return output.sort();
}
async function incomplete(directory) {
  for(const name of ['collection.json','analysis/source.json']){
    try{await readAt(directory,name,name==='collection.json'?MAX_MANIFEST:1048576);}
    catch(error){if(error.code==='ENOENT')return true;throw error;}
  }
  return false;
}
async function fileInventory(directory,collection) {
  const rawManifest=await readAt(directory,'collection.json',MAX_MANIFEST);
  need(digest(rawManifest)===collection.manifestSha256,'MANIFEST_CHANGED','The original collection manifest changed.');
  const selection=await readAt(directory,'selection.json',MAX_MANIFEST);
  need(digest(selection)===collection.selectionSha256,'SELECTION_CHANGED','The selected collection request changed.');
  const sourceRaw=await readAt(directory,'analysis/source.json',1048576,collection.analysis),document=parse(sourceRaw);
  const files=new Map(Object.entries(collection.files));
  files.set('collection.json',identity(rawManifest));files.set('selection.json',identity(selection));
  files.set('analysis/source.json',identity(sourceRaw));
  for(const file of [document.document,...document.originals]){
    const path='analysis/'+file.path,previous=files.get(path),record={bytes:file.bytes,sha256:file.sha256};
    need(FILE.test(path)&&(!previous||same(previous,record)),'SOURCE_FILES','The analytical source has conflicting original files.');
    files.set(path,record);
  }
  return [...files].sort(([first],[second])=>first.localeCompare(second)).map(([path,file])=>({path,...file}));
}
async function reviewedDocument(selected,sourceManifest,expectedSha256) {
  const path=resolve(sourceManifest),root=await privateDirectory(dirname(path)),sourceRaw=await readAt(root,basename(path),1048576);
  need(digest(sourceRaw)===expectedSha256,'RESTORE_SOURCE_CHANGED','The selected analytical source manifest changed.');
  const source=parse(sourceRaw);
  need(plain(source)&&source.schema===ANALYSIS_DOCUMENT_SCHEMA&&source.complete===true&&Array.isArray(source.originals),
    'RESTORE_DOCUMENT','Choose an original complete collection source document.',400);
  const originals=source.originals.filter(file=>file?.role==='collection-manifest');
  need(originals.length===1,'RESTORE_DOCUMENT','The source must retain its single original collection manifest.',400);
  const file=originals[0];
  need(HASH.test(file.sha256)&&file.path==='files/'+file.sha256+'.json'&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=MAX_MANIFEST,
    'RESTORE_DOCUMENT','The original collection manifest identity is invalid.',400);
  const manifest=parse(await readAt(root,file.path,MAX_MANIFEST,file));
  need(plain(manifest)&&manifest.schema===COLLECTION_SCHEMA,'RESTORE_DOCUMENT','Select an original complete live collection.',400);
  bound(manifest,selected);
}
async function collectionFiles(selected,identifier) {
  return withCollection(selected,identifier,async(directory,collection)=>{
    const prefix='live/products/'+selected.profile.id+'/collections/'+identifier+'/',files=[];
    for(const item of await fileInventory(directory,collection)){
      const raw=await readAt(directory,item.path,MAX_FILE,item);
      files.push({path:prefix+item.path,bytes:raw.length,sha256:item.sha256,bodyBase64:raw.toString('base64')});
    }
    return {collection:summary(identifier,collection),files};
  });
}

/** Pass the original live-operations sequence; all writes use that same lease. */
export async function openServiceCollections({directory,profile,sequence}={}) {
  need(typeof sequence==='function','SEQUENCE','Use the original live service state sequence.',400);
  const selected=await service({directory,profile});
  async function current(){return service({directory:selected.root,profile:selected.profile});}
  async function list() {
    const selected=await current(),output=[];
    for(const identifier of await names(selected)){
      const directory=await selectedDirectory(selected,identifier);
      if(await incomplete(directory)){output.push({id:identifier,status:'INCOMPLETE',sourceBinding:profile.sourceBinding,operation:profile.operation});continue;}
      output.push(await withCollection(selected,identifier,async(_,collection)=>summary(identifier,collection)));
    }
    return output;
  }
  async function collect(input={}) {
    return sequence(async()=>{
      need(plain(input),'INPUT','Select an original collection operation.',400);
      const selected=await current(),identifier=id(input.id),pages=input.pages;
      need(Array.isArray(pages)&&pages.length>0&&pages.length<=10000&&
        Object.keys(input).every(key=>['id','pages','fields','title','limits'].includes(key)),
        'PAGES','Select the ordered original saved responses for one complete collection.',400);
      let prior=null;const exchanges=[];
      for(const item of pages){
        need(plain(item)&&Object.keys(item).every(key=>['receivedId','buyerId'].includes(key)),
          'PAGE','Select an original response and its optional original buyer request.',400);
        const receivedId=hashId(item.receivedId),parent='receiving/'+receivedId;
        const receiving=parse(await readAt(selected.root,parent+'/receiving.json',1048576));
        need(receiving.schema==='stellar-forge.odata-live-receiving.v1'&&receiving.operation===profile.operation&&
          receiving.metadataSha256===selected.prepared.catalog.receipts.metadata.sha256&&
          receiving.originalResponse?.file==='original-response.json'&&receiving.originalResponse.sha256===receivedId,
          'RECEIVING_CHANGED','The selected response differs from its original service receiving record.');
        await readAt(selected.root,parent+'/original-response.json',16777216,receiving.originalResponse);
        let requestName;
        if(item.buyerId!==undefined){
          const buyerId=hashId(item.buyerId),buyer='buyers/'+buyerId;
          const handoff=parse(await readAt(selected.root,buyer+'/handoff.json',1048576));
          need(handoff.schema==='stellar-forge.odata-live-buyer-handoff.v1'&&handoff.operation===profile.operation&&
            handoff.metadataSha256===selected.prepared.catalog.receipts.metadata.sha256&&HASH.test(handoff.requestSha256),
            'BUYER_CHANGED','The selected buyer request belongs to another operation or source.');
          const raw=await readAt(selected.root,buyer+'/request.json',65536);
          need(digest(raw)===handoff.requestSha256,'BUYER_CHANGED','The original selected buyer request changed.');
          requestName=buyer+'/request.json';
        }else requestName=prior?'receiving/'+prior+'/next-request.json':'package/request.json';
        const requestPath=join(selected.root,requestName);await readAt(selected.root,requestName,65536);
        exchanges.push({requestPath,responsePath:join(selected.root,parent,'original-response.json')});prior=receivedId;
      }
      const result=await receiveCollection(selected.prepared,{directory:join(selected.parent,identifier),
        operation:profile.operation,exchanges,fields:input.fields,title:input.title,limits:input.limits,
        allowLoopback:profile.settings.allowLoopback===true});
      bound(result,selected);return {id:identifier,...result};
    });
  }
  async function restore(input={}) {
    return sequence(async()=>{
      need(plain(input),'INPUT','Select an original collection receiving operation.',400);
      const selected=await current(),identifier=id(input.id);
      need(typeof input.sourceManifest==='string'&&HASH.test(input.expectedSha256)&&
        Object.keys(input).every(key=>['id','sourceManifest','expectedSha256'].includes(key)),
        'RESTORE_INPUT','Select the original analytical source manifest and its reviewed SHA-256.',400);
      await reviewedDocument(selected,input.sourceManifest,input.expectedSha256);
      const result=await restoreCollection({directory:join(selected.parent,identifier),
        sourceManifest:input.sourceManifest,expectedSha256:input.expectedSha256});
      bound(result,selected);return {id:identifier,...result};
    });
  }
  async function inspect(identifier) {
    const selected=await current();
    return withCollection(selected,id(identifier),async(directory,collection)=>({id:identifier,...collection,
      retainedFiles:await fileInventory(directory,collection)}));
  }
  async function rows(identifier,options={}) {
    const selected=await current(),directory=await selectedDirectory(selected,id(identifier));
    const lease=await acquireReleaseLease(directory,'state.lock');
    try{const result=await readCollectionRows(directory,options);bound(result,selected);return result;}
    finally{await lease?.close();}
  }
  async function file(identifier,name) {
    const selected=await current();need(typeof name==='string'&&FILE.test(name),'FILE','Choose a declared collection download.',404);
    return withCollection(selected,id(identifier),async(directory,collection)=>{
      const record=(await fileInventory(directory,collection)).find(file=>file.path===name);
      need(record,'FILE','Choose a declared collection download.',404);
      return {name:basename(name),relative:name,bytes:await readAt(directory,name,MAX_FILE,record),sha256:record.sha256};
    });
  }
  return {list,collect,restore,inspect,rows,file};
}

/** Workspace.backup calls this inside its existing live state lease. */
export async function serviceCollectionFiles({directory,profile}={}) {
  const selected=await service({directory,profile}),files=[],collections=[];
  for(const identifier of await names(selected)){
    need(!await incomplete(await selectedDirectory(selected,identifier)),'INCOMPLETE',
      'Resume the original incomplete collection before exporting this service.');
    const result=await collectionFiles(selected,identifier);files.push(...result.files);collections.push(result.collection);
  }
  return {collections,files};
}

/** Parse only the declared source-owned collection subtree; no path traversal. */
export function parseCollectionTransferPath(path) {
  if(typeof path!=='string')return null;
  const match=path.match(/^live\/products\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/collections\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/(.+)$/);
  return match&&FILE.test(match[3])?{serviceId:match[1],collectionId:match[2],file:match[3]}:null;
}

/** Validate complete original file closure before Workspace.restore writes it. */
export function validateServiceCollectionTransfer({profile,files}={}) {
  profileShape(profile);need(Array.isArray(files),'TRANSFER','Select an original workspace transfer.',400);
  const prefix='live/products/'+profile.id+'/collections/',groups=new Map();
  for(const file of files){
    if(typeof file?.path!=='string'||!file.path.startsWith(prefix))continue;
    const path=parseCollectionTransferPath(file.path);
    need(path&&path.serviceId===profile.id&&HASH.test(file.sha256)&&typeof file.bodyBase64==='string',
      'TRANSFER_PATH','The transfer contains an unsupported collection file.');
    const raw=Buffer.from(file.bodyBase64,'base64');
    need(raw.toString('base64')===file.bodyBase64&&raw.length<=MAX_FILE&&digest(raw)===file.sha256&&
      (file.bytes===undefined||file.bytes===raw.length),'TRANSFER_BYTES','A collection transfer file changed.');
    if(!groups.has(path.collectionId))groups.set(path.collectionId,new Map());
    const group=groups.get(path.collectionId);need(!group.has(path.file),'TRANSFER_DUPLICATE','The collection transfer repeats an original file.');
    group.set(path.file,{raw,sha256:file.sha256,bytes:raw.length});
  }
  const selected=[];
  for(const [identifier,group]of groups){
    const get=(path,limit=MAX_MANIFEST)=>{
      const value=group.get(path);need(value&&value.bytes<=limit,'TRANSFER_MISSING','The transfer omits a complete collection source file.');return value;
    };
    const manifestFile=get('collection.json'),manifest=parse(manifestFile.raw),selection=get('selection.json');
    need(plain(manifest)&&manifest.schema===COLLECTION_SCHEMA&&manifest.sourceBinding===profile.sourceBinding&&
      manifest.operation===profile.operation&&HASH.test(manifest.selectionSha256)&&selection.sha256===manifest.selectionSha256&&
      plain(manifest.files)&&['json','csv'].includes(manifest.analysisFormat),
      'TRANSFER_BINDING','The transferred collection belongs to another service or selected source.');
    const expected=new Map([['collection.json',identity(manifestFile.raw)],['selection.json',identity(selection.raw)]]);
    for(const [path,file]of Object.entries(manifest.files)){
      need(CORE.test(path)&&plain(file)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&HASH.test(file.sha256),
        'TRANSFER_MANIFEST','The original collection declares an unsupported retained file.');
      expected.set(path,{bytes:file.bytes,sha256:file.sha256});
    }
    const sourceFile=get('analysis/source.json',1048576),source=parse(sourceFile.raw);
    need(plain(source)&&source.schema===ANALYSIS_DOCUMENT_SCHEMA&&source.complete===true&&
      source.format===manifest.analysisFormat&&source.title===manifest.title&&plain(source.document)&&
      Array.isArray(source.originals)&&source.originals.length>=3&&source.originals.length<=32,
      'TRANSFER_DOCUMENT','The collection omits its complete original analytical source.');
    expected.set('analysis/source.json',identity(sourceFile.raw));
    const roles=new Map();
    for(const file of source.originals){
      need(plain(file)&&typeof file.role==='string'&&!roles.has(file.role),'TRANSFER_DOCUMENT','The analytical source repeats an original role.');
      roles.set(file.role,file);
    }
    need(roles.has('collection-manifest')&&roles.has('collection-transform'),
      'TRANSFER_DOCUMENT','The analytical source omits the original collection or transformation.');
    const declared=roles.get('collection-manifest');
    need(declared.sha256===manifestFile.sha256&&declared.bytes===manifestFile.bytes,
      'TRANSFER_MANIFEST','The analytical source belongs to another collection.');
    const output=manifest.files[manifest.analysisFormat==='json'?'analysis-rows.json':'dataset.csv'];
    need(output&&source.document.sha256===output.sha256&&source.document.bytes===output.bytes,
      'TRANSFER_DOCUMENT','The analytical projection differs from its original collection.');
    for(const file of [source.document,...source.originals]){
      const path='analysis/'+file.path;
      need(FILE.test(path)&&path==='analysis/files/'+file.sha256+'.'+path.split('.').at(-1)&&
        Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&HASH.test(file.sha256),
        'TRANSFER_DOCUMENT','An analytical source file has an invalid identity.');
      const previous=expected.get(path),record={bytes:file.bytes,sha256:file.sha256};
      need(!previous||same(previous,record),'TRANSFER_DOCUMENT','The analytical source declares conflicting file identities.');
      expected.set(path,record);
    }
    need(group.size===expected.size,'TRANSFER_EXTRA','The collection transfer contains files outside its complete original selection.');
    for(const [path,record]of expected){
      const file=get(path,MAX_FILE);need(file.bytes===record.bytes&&file.sha256===record.sha256,
        'TRANSFER_CHANGED','A retained collection file differs from its original manifest.');
    }
    selected.push({id:identifier,sourceBinding:manifest.sourceBinding,operation:manifest.operation,
      manifestSha256:manifestFile.sha256,files:[...expected.keys()].map(path=>prefix+identifier+'/'+path).sort()});
  }
  return selected.sort((first,second)=>first.id.localeCompare(second.id));
}

/** After writing validated files, before Workspace.restore publishes its state. */
export async function verifyServiceCollections({directory,profile}={}) {
  const selected=await service({directory,profile}),output=[];
  for(const identifier of await names(selected)){
    need(!await incomplete(await selectedDirectory(selected,identifier)),'INCOMPLETE',
      'The receiving workspace lacks a complete original collection.');
    output.push(await withCollection(selected,identifier,async(_,collection)=>summary(identifier,collection)));
  }
  return output;
}
