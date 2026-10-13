// MIT. Complete editable source drafts for the original Flowable programme compilers.
import {buildFlowableProcessProgramme} from './process-programme.mjs';
import {buildFlowableCaseProgramme} from './case-programme.mjs';
import {buildFlowableDecisionProgramme} from './decision-programme.mjs';

export const PROGRAMME_DRAFT_SCHEMA='stellar-forge.flowable-programme-draft.v1';
export const PROGRAMME_DRAFT_LIMIT=16*1024*1024;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const clone=value=>JSON.parse(JSON.stringify(value));
const forbidden=new Set(['__proto__','prototype','constructor']);
function string(value,max,label){need(typeof value==='string'&&value.length<=max&&!value.includes('\u0000'),label+' must be complete text within its size limit.');}
function fields(value,allowed,label){
 need(plain(value),label+' must be an object.');
 for(const key of Object.keys(value))need(allowed.includes(key)&&!forbidden.has(key),'Unknown '+label+' field: '+key);
}
export function programmeSourcePath(value){
 string(value,1000,'Source path');
 need(value.length>0&&!value.includes('\\')&&!/[:\u0000-\u001f\u007f]/.test(value)&&
  value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!forbidden.has(part)),
  'Use a relative source path without empty, parent or reserved segments.');
 return value;
}
export function programmeUtf8(value){
 // encodeURIComponent rejects unpaired surrogates instead of silently replacing source bytes.
 const encoded=encodeURIComponent(value),bytes=[];
 for(let i=0;i<encoded.length;i++){
  if(encoded[i]==='%'){bytes.push(parseInt(encoded.slice(i+1,i+3),16));i+=2;}
  else bytes.push(encoded.charCodeAt(i));
 }
 return new Uint8Array(bytes);
}
function base64(bytes){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';
 for(let i=0;i<bytes.length;i+=3){
  const a=bytes[i],b=bytes[i+1],c=bytes[i+2],n=(a<<16)|((b??0)<<8)|(c??0);
  result+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(b===undefined?'=':alphabet[(n>>>6)&63])+(c===undefined?'=':alphabet[n&63]);
 }return result;
}
export async function programmeSourceSha256(bytes){
 need(globalThis.crypto?.subtle,'Open the workspace through localhost or HTTPS to calculate complete source identities.');
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function createProgrammeDraft(id){
 string(id,100,'Draft identity');need(/^[A-Za-z0-9_-]+$/.test(id),'Use a distinct draft identity.');
 return{schema:PROGRAMME_DRAFT_SCHEMA,id,title:'Untitled commissioning programme',kind:'process',operation:'',
  tenantId:'',catalogue:'',roles:{operator:'',reviewer:'',specialist:'',approver:''},
  familyKeys:[],migrateKeys:[],delegationKey:'',inputs:{},files:[]};
}
export function validateProgrammeDraft(value){
 fields(value,['schema','id','title','kind','operation','tenantId','catalogue','roles','familyKeys','migrateKeys','delegationKey','inputs','files'],'draft');
 need(value.schema===PROGRAMME_DRAFT_SCHEMA,'Select a complete Flowable source draft.');
 need(/^[A-Za-z0-9_-]{1,100}$/.test(value.id??''),'The draft identity is invalid.');
 for(const[key,max]of [['title',300],['operation',80],['tenantId',200],['catalogue',1000],['delegationKey',120]])string(value[key],max,key);
 need(['process','case','decision'].includes(value.kind),'Select process, case or decision authoring.');
 fields(value.roles,['operator','reviewer','specialist','approver'],'roles');
 for(const key of ['operator','reviewer','specialist','approver'])string(value.roles[key]??'',200,'Role');
 for(const key of ['familyKeys','migrateKeys']){
  need(Array.isArray(value[key])&&value[key].length<=100&&new Set(value[key]).size===value[key].length,'Keep distinct '+key+'.');
  for(const item of value[key]){string(item,120,key);need(!forbidden.has(item),'Invalid family key.');}
 }
 fields(value.inputs,Object.keys(value.inputs??{}),'input mapping');
 for(const[key,path]of Object.entries(value.inputs)){string(key,120,'Family key');if(path)programmeSourcePath(path);}
 need(Array.isArray(value.files)&&value.files.length<=500,'A draft can retain at most five hundred complete source members.');
 const names=new Set();
 for(const file of value.files){
  fields(file,['path','mediaType','text'],'source');
  programmeSourcePath(file.path);need(!names.has(file.path),'Duplicate source path: '+file.path);names.add(file.path);
  string(file.mediaType,200,'Media type');
  need(typeof file.text==='string'&&file.text.length<=PROGRAMME_DRAFT_LIMIT,'Retain complete source text within the draft size limit.');
 }
 const result=clone(value);
 need(programmeUtf8(JSON.stringify(result)).length<=PROGRAMME_DRAFT_LIMIT,'The complete editable draft must fit within 16 MiB.');
 return result;
}
export function parseProgrammeDraft(text){
 need(typeof text==='string'&&programmeUtf8(text).length<=PROGRAMME_DRAFT_LIMIT,'Select a complete draft of at most 16 MiB.');
 return validateProgrammeDraft(JSON.parse(text));
}
export function serializeProgrammeDraft(draft){
 const value=validateProgrammeDraft(draft),text=JSON.stringify(value,null,2)+'\n';
 need(programmeUtf8(text).length<=PROGRAMME_DRAFT_LIMIT,'The complete editable draft must fit within 16 MiB.');
 return text;
}
export function programmeDraftCatalogue(draft){
 const source=draft.files.find(file=>file.path===draft.catalogue);
 need(source,'Select the complete catalogue from the source inventory.');
 const value=JSON.parse(source.text);
 need(plain(value)&&Array.isArray(value.families),'The catalogue must contain its original family collection.');
 return value;
}
export function addProgrammeDraftSources(draft,files,{replace=false}={}){
 const next=validateProgrammeDraft(draft),incoming=new Set();
 for(const file of files){
  programmeSourcePath(file.path);need(!incoming.has(file.path),'The incoming selection contains duplicate paths: '+file.path);incoming.add(file.path);
  const at=next.files.findIndex(item=>item.path===file.path);
  need(at<0||replace,'A source already exists at '+file.path+'. Select that member to edit it or explicitly replace selected paths.');
  if(at<0)next.files.push(clone(file));else next.files[at]=clone(file);
 }
 return validateProgrammeDraft(next);
}
export function renameProgrammeDraftSource(draft,oldPath,newPath){
 programmeSourcePath(newPath);const next=validateProgrammeDraft(draft),source=next.files.find(file=>file.path===oldPath);
 need(source,'Select the original source member.');need(oldPath===newPath||!next.files.some(file=>file.path===newPath),'The new source path already exists.');
 source.path=newPath;if(next.catalogue===oldPath)next.catalogue=newPath;
 for(const[key,path]of Object.entries(next.inputs))if(path===oldPath)next.inputs[key]=newPath;
 // Catalogue references remain visible authored source; never rewrite its JSON or model bytes.
 return validateProgrammeDraft(next);
}
export async function compileProgrammeDraft(draft,{hash=programmeSourceSha256,decisionCompiler=buildFlowableDecisionProgramme}={}){
 const selected=validateProgrammeDraft(draft),catalogue=selected.files.find(file=>file.path===selected.catalogue);
 need(catalogue,'Select the complete original catalogue.');
 const members=Object.create(null);
 for(const file of selected.files){
  const bytes=programmeUtf8(file.text),sha256=await hash(bytes);
  need(/^[a-f0-9]{64}$/.test(sha256),'The complete source identity could not be calculated.');
  members[file.path]={text:file.text,bytes:bytes.length,sha256,mediaType:file.mediaType,contentBase64:base64(bytes)};
 }
 const config={catalogText:catalogue.text,members,operation:selected.operation,roles:clone(selected.roles),
  ...(selected.tenantId?{tenantId:selected.tenantId}:{})};
 let programme;
 if(selected.kind==='process')programme=buildFlowableProcessProgramme({...config,inputs:clone(selected.inputs),
  familyKeys:selected.familyKeys,migrateKeys:selected.migrateKeys,delegationKey:selected.delegationKey||selected.familyKeys[0]});
 else if(selected.kind==='case')programme=buildFlowableCaseProgramme(config);
 else{
  need(typeof decisionCompiler==='function','Install the decision programme compiler before composing this decision draft.');
  programme=decisionCompiler({...config,familyKeys:selected.familyKeys});
 }
 const programmeText=JSON.stringify(programme,null,2)+'\n',bytes=programmeUtf8(programmeText);
 need(bytes.length<=PROGRAMME_DRAFT_LIMIT,'The complete compiled programme exceeds the native 16 MiB intake limit.');
 return{programme,programmeText,bytes:bytes.length,sha256:await hash(bytes),draft: selected};
}

export async function refreshProgrammeCatalogueSources(draft,{hash=programmeSourceSha256}={}){
 const next=validateProgrammeDraft(draft);need(next.kind==='decision','Select a decision source draft.');
 const catalogue=next.files.find(file=>file.path===next.catalogue);need(catalogue,'Select the complete decision catalogue.');
 const value=JSON.parse(catalogue.text);
 need(value.schema==='stellar-forge.flowable-dmn-native-fixtures.v1'&&Array.isArray(value.families),'Use the original complete decision catalogue.');
 for(const family of value.families){
  need(Array.isArray(family.files),'Retain the original model edition collection.');
  for(const model of family.files){
   const paths=[...new Set([model.path,model.filename].filter(path=>typeof path==='string'&&next.files.some(file=>file.path===path)))];
   need(paths.length===1,'Select exactly one complete model member for '+model.filename+'.');
   const source=next.files.find(file=>file.path===paths[0]);need(source!==catalogue,'The catalogue cannot be its own model source.');
   const bytes=programmeUtf8(source.text),sha256=await hash(bytes);
   need(/^[a-f0-9]{64}$/.test(sha256),'The complete source identity could not be calculated.');
   model.bytes=bytes.length;model.sha256=sha256;
  }
 }
 catalogue.text=JSON.stringify(value,null,2)+'\n';
 return validateProgrammeDraft(next);
}
