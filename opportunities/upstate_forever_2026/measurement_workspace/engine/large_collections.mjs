/** Large originals in the existing Measurements collection and native edition stores. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {COLLECTION_FORMAT,prepareCollectionSources,collectionMemberPath,retainCollectionMember,collectionRoot,collectionSourceInput} from './collections.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
import {prepareIntake,intakeRoot,intakeStatus,commitIntake,sourceChunks} from './large_intake.mjs';
import {exportEdition,editionInfo} from './large_delivery.mjs';
import {identifier,atomicJSON,readJSON,fileDigest,copyVerified,withDirectoryLock,json} from './large_io.mjs';

const REVIEW='upper-savannah-collection-receiving/v1';
const BINDING='upper-savannah-collection-large-edition/v1';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>stable(a)===stable(b);
function need(ok,message,status=400){if(!ok)throw new InputError(message,status);}
const clone=x=>JSON.parse(JSON.stringify(x));
const lockRoot=(w,id)=>path.join(w.directory,'.large','collection-operations',id);
function integer(value){return Number.isSafeInteger(value)&&value>=0;}
function nativeSource(w,file){
 if(!file.importId)return null;
 const row=w.db.prepare('SELECT id,sha,summary FROM imports WHERE id=?').get(file.importId);
 if(!row)return null;
 need(row.sha===file.sha256,'Native original identity differs: '+file.path,409);
 return row;
}
function prepare(w,input){
 need(input?.format===COLLECTION_FORMAT&&typeof input.title==='string'&&input.title.trim()&&Array.isArray(input.files)&&input.files.length,'A collection requires its original format, title and complete file list');
 const seen=new Set(),members=[];
 for(const item of input.files){
  need(plain(item),'Invalid collection member');const name=collectionMemberPath(item.path);
  need(!seen.has(name)&&![...seen].some(old=>old.startsWith(name+'/')||name.startsWith(old+'/')),'Collection source names overlap: '+name);seen.add(name);
  if(item.intakeId===undefined){
   const one=prepareCollectionSources(w,{format:COLLECTION_FORMAT,title:input.title,files:[item]}).files[0];
   members.push({...one,intakeId:null,normalizerPin:null});continue;
  }
  need(identifier(item.intakeId)&&['wqp','stations'].includes(item.kind),'Select a complete WQP or stations intake');
  need(item.text===undefined&&item.base64===undefined,'A retained intake reference cannot also contain an inline body');
  const preview=prepareIntake(w,item.intakeId),state=intakeStatus(w,item.intakeId);
  need(state.kind===item.kind&&preview.kind===item.kind,'Collection interpretation differs from its retained intake',409);
  need(identifier(item.sha256)&&item.sha256===preview.sourceSha256,'Collection original differs from its prepared source',409);
  need(item.label===state.label&&same(item.mapping,preview.mapping)&&same(item.origin,state.origin),'Collection label, mapping or origin differs from its actual prepared intake',409);
  need(preview.summary.rows>0,'No importable rows in '+name+'; retain it inline as a companion or correct its interpretation');
  const file={path:name,kind:item.kind,sha256:preview.sourceSha256,bytes:preview.bytes,label:state.label,mapping:preview.mapping,origin:state.origin,importId:preview.importId};
  members.push({file,preview,intakeId:item.intakeId,normalizerPin:preview.normalizerPin});
 }
 const document={format:COLLECTION_FORMAT,title:input.title.trim(),files:members.map(m=>m.file)};
 const id=hash(stable(document)),workspaceRevision=w.revision();
 const receiving=members.map(m=>({path:m.file.path,intakeId:m.intakeId,sourceSha256:m.file.sha256,bytes:m.file.bytes,importId:m.file.importId??null,normalizerPin:m.normalizerPin}));
 const inspection=members.map(m=>({path:m.file.path,kind:m.file.kind,bytes:m.file.bytes,preview:m.preview}));
 const reviewSha256=hash(stable({format:REVIEW,id,workspaceRevision,receiving,inspection}));
 return {id,document,members,preview:{id,...document,inspection,workspaceRevision,reviewSha256,receiving}};
}
export function previewLargeCollection(w,input){return prepare(w,input).preview;}
function operationPaths(w,id,op){
 need(identifier(op),'Choose a 64-character hexadecimal receiving operation ID');
 const root=collectionRoot(w,id),directory=path.join(root,'receiving',op);
 return {root,directory,request:path.join(directory,'request.json'),state:path.join(directory,'operation.json')};
}
function requestFingerprint(input){return hash(stable(input));}
function verifyRetainedSource(root,file){
 const target=path.join(root,'sources',collectionMemberPath(file.path));
 need(fs.existsSync(target)&&fs.lstatSync(target).isFile()&&!fs.lstatSync(target).isSymbolicLink(),'A retained collection original is missing: '+file.path,409);
 const digest=fileDigest(target);need(digest.bytes===file.bytes&&digest.sha256===file.sha256,'Retained collection original changed: '+file.path,409);return target;
}
function saveState(file,value){atomicJSON(file,value);return value;}
function response(w,document,state){
 return {id:state.collectionId,operationId:state.operationId,title:document.title,complete:state.phase==='complete',phase:state.phase,workspaceRevision:w.revision(),continuationRevision:state.continuationRevision,files:state.results};
}
export function receiveLargeCollection(w,input){
 need(plain(input)&&identifier(input.expectedId)&&identifier(input.expectedReviewSha256)&&integer(input.expectedRevision),'Receive the exact inspected collection, review hash and workspace revision');
 const p=operationPaths(w,input.expectedId,input.operationId),request=clone(input),fingerprint=requestFingerprint(request);
 return withDirectoryLock(lockRoot(w,input.expectedId),()=>{
  let saved,state;
  if(fs.existsSync(p.request)){
   saved=readJSON(p.request);
   need(saved.format===REVIEW&&saved.fingerprint===fingerprint&&same(saved.input,request),'This receiving operation retains a different original request',409);
   need(saved.collectionId===input.expectedId&&hash(stable(saved.document))===input.expectedId,'Retained collection receiving identity differs',409);
   state=fs.existsSync(p.state)?readJSON(p.state):{format:REVIEW,operationId:input.operationId,collectionId:input.expectedId,fingerprint,phase:'retaining',continuationRevision:input.expectedRevision,results:[],pending:null};
  }else{
   const prepared=prepare(w,input);
   need(prepared.id===input.expectedId&&prepared.preview.reviewSha256===input.expectedReviewSha256,'Collection differs from its complete reviewed inspection',409);
   need(w.revision()===input.expectedRevision,'Workspace changed; inspect the same collection again before a new receiving operation',409);
   saved={format:REVIEW,collectionId:prepared.id,fingerprint,input:request,document:prepared.document,preview:prepared.preview};
   // Preserve the canonical document before publishing this operation under it.
   retainCollectionMember(path.join(p.root,'collection.json'),json(prepared.document));
   retainCollectionMember(p.request,json(saved));
   state={format:REVIEW,operationId:input.operationId,collectionId:prepared.id,fingerprint,phase:'retaining',continuationRevision:input.expectedRevision,results:[],pending:null};
  }
  need(state.fingerprint===fingerprint&&state.operationId===input.operationId&&state.collectionId===input.expectedId,'Retained receiving progress belongs to another request',409);
  if(state.phase==='complete')return response(w,saved.document,state);
  try{
   // Freeze every whole original before the first scientific import. Each source
   // remains an ordinary original collection member in the full native handover.
   for(let index=0;index<saved.document.files.length;index++){
    const file=saved.document.files[index],source=saved.preview.receiving[index],item=saved.input.files[index],target=path.join(p.root,'sources',file.path);
    if(fs.existsSync(target)){verifyRetainedSource(p.root,file);continue;}
    if(source.intakeId){
     const preview=prepareIntake(w,source.intakeId);
     need(preview.sourceSha256===file.sha256&&preview.bytes===file.bytes&&preview.importId===file.importId&&preview.normalizerPin===source.normalizerPin,'The original intake interpretation changed; inspect a new continuation',409);
     copyVerified(path.join(intakeRoot(w,source.intakeId),'original'),target,file);
    }else{
     const member=prepareCollectionSources(w,{format:COLLECTION_FORMAT,title:saved.document.title,files:[item]}).files[0];
     need(same(member.file,file),'Inline original interpretation changed; inspect a new continuation',409);
     retainCollectionMember(target,member.data);
    }
   }
   state.phase='receiving';delete state.error;saveState(p.state,state);
   for(let index=state.results.length;index<saved.document.files.length;index++){
    const file=saved.document.files[index],source=saved.preview.receiving[index],target=verifyRetainedSource(p.root,file);
    if(file.kind==='companion'){
     state.results.push({path:file.path,kind:file.kind,sha256:file.sha256,bytes:file.bytes});
     state.pending=null;saveState(p.state,state);continue;
    }
    const existing=nativeSource(w,file);
    if(state.pending){
     need(state.pending.index===index&&state.pending.importId===file.importId,'Saved receiving step differs from its original collection',409);
    }else{
     need(w.revision()===state.continuationRevision,'Workspace changed during partial receiving; keep this operation and inspect a new continuation',409);
     state.pending={index,importId:file.importId,beforeRevision:state.continuationRevision,alreadyImported:!!existing};
     saveState(p.state,state);
    }
    let result;
    if(existing){
     result={id:file.importId,duplicate:true,...JSON.parse(existing.summary),revision:w.revision()};
    }else if(source.intakeId){
     // The retained intake's original native transaction enforces both reviewed
     // source/normalizer identities and the current selected database revision.
     result=commitIntake(w,source.intakeId,{expectedRevision:state.pending.beforeRevision,expectedSourceSha256:file.sha256,expectedNormalizerPin:source.normalizerPin,expectedImportId:file.importId,expectedSourceDefinitionSha256:hash(stable({kind:file.kind,label:file.label,mapping:file.mapping,origin:file.origin}))});
    }else{
     result=w.import({...collectionSourceInput(file,fs.readFileSync(target)),expectedRevision:state.pending.beforeRevision,expectedImportId:file.importId});
    }
    need(result.id===file.importId,'Native source identity changed during receiving',409);
    state.continuationRevision=state.pending.beforeRevision+(state.pending.alreadyImported?0:1);
    state.results.push({path:file.path,kind:file.kind,sha256:file.sha256,...result});
    state.pending=null;saveState(p.state,state);
   }
   retainCollectionMember(path.join(p.root,'complete.json'),json({id:input.expectedId,files:saved.document.files}));
   state.phase='complete';state.completedRevision=w.revision();delete state.error;saveState(p.state,state);
   return response(w,saved.document,state);
  }catch(error){
   state.error={name:error.name,message:error.message,status:error.status??error.statusCode??null};
   state.phase='interrupted';try{saveState(p.state,state);}catch(saveError){error.receivingSaveError=saveError.message;}throw error;
  }
 });
}
function documentFor(w,id){
 const root=collectionRoot(w,id),file=path.join(root,'collection.json');
 need(fs.existsSync(file),'Collection not found',404);const document=readJSON(file);
 need(document.format===COLLECTION_FORMAT&&hash(stable(document))===id,'Retained collection document changed',409);
 return {root,document};
}
export function largeCollectionEditions(w,id){
 const {root}=documentFor(w,id),directory=path.join(root,'large-editions');
 if(!fs.existsSync(directory))return [];
 return fs.readdirSync(directory).filter(identifier).sort().map(editionId=>{
  const binding=readJSON(path.join(directory,editionId,'selection.json'));
  need(binding.format===BINDING&&binding.collectionId===id&&binding.editionId===editionId,'Retained collection edition binding differs',409);
  let edition=null,conflict=null;try{edition=editionInfo(w,editionId);}catch(error){if(error.status!==404&&error.statusCode!==404)throw error;}
  if(edition&&(!same(edition.collectionBinding,binding)||edition.workspaceRevision!==binding.expectedRevision)){edition=null;conflict='That native edition ID belongs to another original collection selection; retain this binding and publish a newly reviewed ID.';}
  return {collectionId:id,binding,edition,...(conflict?{conflict}:{})};
 });
}
export function largeCollectionStatus(w,id){
 const {root,document}=documentFor(w,id),directory=path.join(root,'receiving');
 const operations=fs.existsSync(directory)?fs.readdirSync(directory).filter(identifier).sort().map(op=>{
  const p=operationPaths(w,id,op);
  if(fs.existsSync(p.state))return readJSON(p.state);
  const request=readJSON(p.request);return {format:REVIEW,operationId:op,collectionId:id,fingerprint:request.fingerprint,phase:'retaining',results:[],pending:null,continuationRevision:request.input.expectedRevision};
 }):[];
 return {id,...document,complete:fs.existsSync(path.join(root,'complete.json')),workspaceRevision:w.revision(),operations,largeEditions:largeCollectionEditions(w,id)};
}
function verifyComplete(w,id){
 const {root,document}=documentFor(w,id),completed=path.join(root,'complete.json');
 need(fs.existsSync(completed)&&same(readJSON(completed),{id,files:document.files}),'Finish the original complete collection before publishing',409);
 for(const file of document.files){
  verifyRetainedSource(root,file);
  if(file.importId){
   const source=nativeSource(w,file);need(source,'Native collection import is missing: '+file.path,409);
   const digest=createHash('sha256');let bytes=0;
   for(const chunk of sourceChunks(w,source)){digest.update(chunk);bytes+=chunk.length;}
   need(bytes===file.bytes&&digest.digest('hex')===file.sha256,'Native original bytes differ: '+file.path,409);
  }
 }
 return {root,document};
}
export async function publishLargeCollection(w,collectionId,input){
 need(plain(input)&&identifier(input.id)&&integer(input.expectedRevision)&&plain(input.filters??{}),'Choose an edition identifier, current workspace revision and native filters');
 return withDirectoryLock(lockRoot(w,collectionId),async()=>{
  const {root,document}=verifyComplete(w,collectionId);
  const binding={format:BINDING,collectionId,editionId:input.id,expectedRevision:input.expectedRevision,filters:input.filters??{},documentSha256:hash(stable(document)),sourcePaths:document.files.map(f=>'collections/'+collectionId+'/sources/'+f.path)};
  const selected=path.join(root,'large-editions',input.id,'selection.json');
  if(fs.existsSync(selected))need(same(readJSON(selected),binding),'This collection edition retains a different original selection',409);
  else{
   let existing=null;try{existing=editionInfo(w,input.id);}catch(error){if(error.status!==404&&error.statusCode!==404)throw error;}
   need(!existing||(same(existing.collectionBinding,binding)&&existing.workspaceRevision===binding.expectedRevision),'This native edition ID already belongs to another original selection',409);
   need(w.revision()===input.expectedRevision,'Workspace changed; select its current revision before publishing',409);
   // The binding is an ordinary immutable companion, copied into the exact same
   // native streaming archive before publication. The selected edition contains
   // the complete workspace; filters select its report populations only.
   retainCollectionMember(selected,json(binding));
  }
  const edition=await exportEdition(w,{id:input.id,filters:binding.filters,expectedRevision:input.expectedRevision,collectionBinding:binding});
  need(edition.workspaceRevision===binding.expectedRevision,'The native edition belongs to another workspace revision',409);
  return {collectionId,binding,edition};
 });
}
