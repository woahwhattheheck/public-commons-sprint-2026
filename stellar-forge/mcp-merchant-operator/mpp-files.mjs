// MIT. Original native MPP bytes through the maintained retained-file receiver.
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { regular, privateDirectory, digest, saveJSON, json, plain } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { stable, need, fail, exact, sha } from './mpp-config.mjs';

export const MPP_EXPORT_MANIFEST='mpp-export.json';
export const MPP_EXPORT_SCHEMA='stellar-forge.mpp-file-export.v1';
export const MAX_MPP_EXPORT_BYTES=4*1024*1024;
const fileNames={response:'response.bin',contract:'mpp-contract.json',openapi:'mpp-openapi.json',package:'mpp-package.json'};
export function exportId(value) {
  need(typeof value==='string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'INVALID_PARAMS',
    'Use a stable export ID with one to sixty-four lowercase letters, digits, underscores or hyphens.');
  return value;
}
export function parseMppExportManifest(input,expectedExportId) {
  const raw=Buffer.isBuffer(input)||input instanceof Uint8Array?
    new TextDecoder('utf8',{fatal:true}).decode(input):input;
  const value=typeof raw==='string'?JSON.parse(raw):structuredClone(raw);
  exact(value,['schema','exportId','createdAt','source','files'],['schema','exportId','createdAt','source','files']);
  exportId(value.exportId);
  need(value.schema===MPP_EXPORT_SCHEMA && (!expectedExportId || value.exportId===expectedExportId) &&
    typeof value.createdAt==='string' && Number.isFinite(Date.parse(value.createdAt)) && plain(value.source) &&
    Object.hasOwn(fileNames,value.source.kind) && Array.isArray(value.files) && value.files.length===1,
    'MPP_EXPORT_MANIFEST_INVALID','Use an original native MPP file export.');
  const file=value.files[0];
  exact(file,['name','bytes','sha256','contentType'],['name','bytes','sha256','contentType']);
  need(file.name===fileNames[value.source.kind] && Number.isSafeInteger(file.bytes) &&
    file.bytes>=0 && file.bytes<=MAX_MPP_EXPORT_BYTES && typeof file.contentType==='string',
    'MPP_EXPORT_MANIFEST_INVALID','The original native MPP file selection is invalid.');
  sha(file.sha256);sha(value.source.workspaceIdentity);sha(value.source.sha256);
  need(file.sha256===value.source.sha256,'MPP_EXPORT_MANIFEST_INVALID');
  return value;
}
export function mppFileTools(tool) {
  const id={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},digestSchema={type:'string',pattern:'^[a-f0-9]{64}$'};
  const read={readOnly:true,idempotent:true};
  return [
    tool('merchant_mpp_export_list','List retained native MPP response and customer handoff exports after operator restart.',
      {after:id,limit:{type:'integer',minimum:1,maximum:50}},[],read),
    tool('merchant_mpp_export_manifest','Inspect the saved original MPP file and its completion manifest before a native retained download.',
      {exportId:id},['exportId'],read),
    tool('merchant_mpp_export_file','Read the exact saved MPP payload or manifest through the existing retained-file transport. Preserve manifest SHA256, file SHA256, readId and byte offset.',
      {exportId:id,file:{type:'string',enum:[MPP_EXPORT_MANIFEST,...Object.values(fileNames)]},
        expectedManifestSha256:digestSchema,expectedSha256:digestSchema,readId:{type:'string'},
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
      ['exportId','file','expectedManifestSha256'],read),
    tool('merchant_mpp_export_file_release','Release a temporary native MPP file-read snapshot while retaining its original completed export.',
      {exportId:id,readId:{type:'string'}},['exportId','readId'],read)
  ];
}
export class MppFileExports {
  #directory;#reads=new RetainedFileReads({errorPrefix:'MPP'});
  constructor(directory) {this.#directory=join(directory,'mpp-file-exports');}
  get summary(){return this.#reads.summary;}
  async #ready() {
    await mkdir(this.#directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    return privateDirectory(this.#directory);
  }
  async #read(id,optional=false) {
    exportId(id);await this.#ready();
    let bytes;
    try{bytes=await regular(join(this.#directory,id+'.json'),8*1024*1024);}
    catch(error){if(optional && error.code==='ENOENT')return null;throw error;}
    const record=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
    need(record.schema==='stellar-forge.mpp-file-capture.v1','MPP_EXPORT_CHANGED');
    const manifest=parseMppExportManifest(record.manifest,id),body=Buffer.from(record.data,'base64');
    need(record.data===body.toString('base64') && body.length===manifest.files[0].bytes &&
      digest(body)===manifest.files[0].sha256 && record.manifestSha256===digest(json(manifest)),
      'MPP_EXPORT_CHANGED','The retained native MPP file differs from its original manifest.');
    return {record,manifest,body,manifestBytes:Buffer.from(json(manifest))};
  }
  #view({manifest,manifestBytes}) {
    return {state:'MANIFEST_RETAINED',exportId:manifest.exportId,manifest,
      manifestFile:{name:MPP_EXPORT_MANIFEST,bytes:manifestBytes.length,sha256:digest(manifestBytes)},
      fileReads:this.#reads.status(manifest.exportId)};
  }
  async capture({id,intent,load}) {
    exportId(id);
    const same=original=>need(stable(original.record.intent)===stable(intent),'MPP_EXPORT_ID_ALREADY_BOUND',
      'This export ID already selects different original native MPP bytes.');
    const previous=await this.#read(id,true);
    if(previous){same(previous);return {...this.#view(previous),recovered:true};}
    const original=await load();
    need(Buffer.isBuffer(original.bytes) && original.bytes.length<=MAX_MPP_EXPORT_BYTES &&
      digest(original.bytes)===intent.expectedSha256,'MPP_EXPORT_SOURCE_CHANGED',
      'Read the selected original source and repeat its exact SHA256.');
    need(Object.hasOwn(fileNames,intent.kind),'MPP_EXPORT_SOURCE_INVALID');
    const manifest=parseMppExportManifest({schema:MPP_EXPORT_SCHEMA,exportId:id,
      createdAt:new Date().toISOString(),source:{...original.source,console:intent.console,
        workspaceIdentity:intent.workspaceIdentity,kind:intent.kind,sha256:intent.expectedSha256},
      files:[{name:fileNames[intent.kind],bytes:original.bytes.length,sha256:intent.expectedSha256,
        contentType:original.contentType??(intent.kind==='response'?'application/octet-stream':'application/json')}]},id);
    const record={schema:'stellar-forge.mpp-file-capture.v1',intent,manifest,
      manifestSha256:digest(json(manifest)),data:original.bytes.toString('base64')};
    try{await saveJSON(join(await this.#ready(),id+'.json'),record);}
    catch(error){if(error.code!=='EEXIST')throw error;const winner=await this.#read(id);same(winner);
      return {...this.#view(winner),recovered:true};}
    return {...this.#view({manifest,manifestBytes:Buffer.from(json(manifest))}),recovered:false};
  }
  async call(name,args={}) {
    if(name==='merchant_mpp_export_list') {
      if(args.after!==undefined)exportId(args.after);
      const limit=args.limit??10;
      need(Number.isSafeInteger(limit) && limit>=1 && limit<=50,'INVALID_PARAMS','List one to fifty original exports.');
      const names=(await readdir(await this.#ready())).filter(name=>/^[a-z0-9][a-z0-9_-]{0,63}\.json$/.test(name))
        .map(name=>name.slice(0,-5)).filter(id=>args.after===undefined || id>args.after).sort();
      const entries=[];
      for(const id of names.slice(0,limit))entries.push(this.#view(await this.#read(id)));
      return {schema:'stellar-forge.mpp-export-list.v1',entries,nextAfter:names.length>limit?entries.at(-1).exportId:null};
    }
    const id=exportId(args.exportId);
    if(name==='merchant_mpp_export_manifest')return this.#view(await this.#read(id));
    if(name==='merchant_mpp_export_file_release') {
      need(typeof args.readId==='string','INVALID_PARAMS','Use the original read ID.');
      await this.#reads.release(id,args.readId);return {exportId:id,readId:args.readId,released:true};
    }
    if(name==='merchant_mpp_export_file') {
      sha(args.expectedManifestSha256);
      need([MPP_EXPORT_MANIFEST,...Object.values(fileNames)].includes(args.file),'INVALID_PARAMS','Select an original MPP payload or manifest.');
      const result=await this.#reads.read({scope:id,kind:'mpp-file-export',
        key:stable([id,args.file,args.expectedManifestSha256]),directory:await this.#ready(),
        readId:args.readId,offset:args.offset,limit:args.limit,expectedSha256:args.expectedSha256,
        load:async()=>{
          const {manifest,manifestBytes,body}=await this.#read(id);
          need(digest(manifestBytes)===args.expectedManifestSha256,'MPP_EXPORT_CHANGED','Use the exact original manifest digest.');
          need(args.file===MPP_EXPORT_MANIFEST || args.file===manifest.files[0].name,'MPP_EXPORT_FILE_NOT_FOUND');
          return args.file===MPP_EXPORT_MANIFEST?{name:MPP_EXPORT_MANIFEST,type:'application/json',bytes:manifestBytes}:
            {name:manifest.files[0].name,type:manifest.files[0].contentType,bytes:body};
        }});
      return {exportId:id,manifestSha256:args.expectedManifestSha256,...result};
    }
    fail('TOOL_NOT_FOUND','Unknown retained native MPP file operation.');
  }
  close(){return this.#reads.close();}
}
