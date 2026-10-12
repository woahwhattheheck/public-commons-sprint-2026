// MIT. Original source, configuration and complete service-workspace files through the installed merchant transport.
import { basename, dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exact, plain, line, identifier, fileBytes, privateSupportDirectory, failure } from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonical, MAX_PACKAGE_BYTES } from '../gis/shared.mjs';

export const SERVICE_CONFIGURATION_HOST_SCHEMA='stellar-forge.open311-service-configuration-host.v1';
const hashPattern=/^[a-f0-9]{64}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(canonical(value));
const requireValue=(ok,message,code='INVALID_PARAMS')=>{if(!ok)throw failure(code,message);};
function pathText(value,label){
  requireValue(typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\x00-\x1f\x7f]/.test(value),'Select the host '+label+'.');return value;
}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export async function readServiceConfigurationWorkspaceConfiguration(path){
  path=resolve(pathText(path,'connection file'));
  const {readPrivateJson}=await import('../../routescan/quota.mjs'),raw=await readPrivateJson(path,1024*1024);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  requireValue(raw.schema===SERVICE_CONFIGURATION_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=128,'Declare one to 128 service configuration workspace aliases.','CONFIGURATION_ERROR');
  const workspaces=Object.create(null),base=dirname(path),directories=new Set();
  for(const [alias,value] of Object.entries(raw.workspaces)){
    identifier(alias,'service configuration workspace alias');exact(value,['label','directory','inputs'],['directory']);
    const directory=resolve(base,pathText(value.directory,'workspace directory'));await privateSupportDirectory(directory);
    requireValue(await realpath(directory)===directory&&!directories.has(directory),'Select distinct original private service configuration workspace directories.','CONFIGURATION_ERROR');directories.add(directory);
    requireValue(plain(value.inputs??{})&&Object.keys(value.inputs??{}).length<=128,'Declare at most 128 host-selected input aliases.','CONFIGURATION_ERROR');
    const entry={label:line(value.label??alias,'service configuration workspace label'),directory,inputs:Object.create(null)};
    for(const [alias,input] of Object.entries(value.inputs??{})){
      identifier(alias,'Input alias');exact(input,['label','path','sha256','kind','format','contentType'],['path','sha256','kind']);
      requireValue(hashPattern.test(input.sha256??''),'Pin each complete original input SHA-256.','CONFIGURATION_ERROR');
      requireValue(['source','profile','workspace'].includes(input.kind),'Choose source, profile or workspace for each original input.','CONFIGURATION_ERROR');
      const format=input.format??'json';
      requireValue(format==='json','Select JSON for original source, profile and complete workspace files.','CONFIGURATION_ERROR');
      const contentType=input.contentType??'application/json';
      requireValue(typeof contentType==='string'&&contentType.length>0&&contentType.length<=200&&!/[\x00-\x1f\x7f]/.test(contentType),'Use one declared media type without control characters.','CONFIGURATION_ERROR');
      entry.inputs[alias]={label:line(input.label??alias,'Input label'),path:resolve(base,pathText(input.path,'input file')),sha256:input.sha256,kind:input.kind,format,contentType};
    }
    workspaces[alias]=entry;
  }
  return freeze({schema:SERVICE_CONFIGURATION_HOST_SCHEMA,path,workspaces});
}
export async function readServiceConfigurationHostInput(entry,alias,expectedSha256){
  const input=entry.inputs[alias];requireValue(input,'Select a configured service configuration input.','OPEN311_SERVICE_CONFIGURATION_INPUT_UNKNOWN');
  if(expectedSha256!==undefined)requireValue(expectedSha256===input.sha256,'The input selection differs from its configured SHA-256.','OPEN311_SERVICE_CONFIGURATION_INPUT_CHANGED');
  const bytes=await fileBytes(input.path,MAX_PACKAGE_BYTES),sha256=digest(bytes);
  requireValue(sha256===input.sha256,'The complete selected input file changed.','OPEN311_SERVICE_CONFIGURATION_INPUT_CHANGED');
  let originalText=null;
  if(input.format==='json'){try{originalText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw failure('OPEN311_SERVICE_CONFIGURATION_INPUT_INVALID','The original selected text file must be valid UTF-8.');}}
  return {input,bytes,sha256,originalText,name:basename(input.path)};
}
function toolValue(result) {
  if (result?.isError) {
    const detail = result.structuredContent?.error;
    const message = detail?.message ?? result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? 'The merchant operation failed.';
    throw Object.assign(new Error(message), { code: detail?.code ?? 'OPEN311_SERVICE_CONFIGURATION_MERCHANT_ERROR', result });
  }
  if (result && Object.hasOwn(result, 'structuredContent') && result.structuredContent !== undefined)
    return result.structuredContent;
  if (Array.isArray(result?.content)) {
    const content = result.content.filter(item => item.type === 'text');
    requireValue(content.length === 1, 'The merchant returned an unexpected tool response.', 'OPEN311_SERVICE_CONFIGURATION_MERCHANT_RESPONSE');
    try { return JSON.parse(content[0].text); }
    catch { throw failure('OPEN311_SERVICE_CONFIGURATION_MERCHANT_RESPONSE', 'The merchant tool response must contain its complete JSON value.'); }
  }
  return result;
}
export class Open311ServiceConfigurationMerchantClient {
  #callTool;#workspace;
  constructor(callTool,workspace){requireValue(typeof callTool==='function','Supply the existing merchant callTool adapter.');this.#callTool=callTool;this.#workspace=identifier(workspace,'service configuration workspace alias');}
  call(name,input={}){
    requireValue(typeof name==='string'&&name.startsWith('merchant_open311_service_configuration_'),'Select a service configuration merchant tool.');
    const args=clone(name==='merchant_open311_service_configuration_workspaces'?input:{...input,workspace:this.#workspace});
    return Promise.resolve().then(()=>this.#callTool(name,args)).then(toolValue);
  }
  workspaces(){return this.call('merchant_open311_service_configuration_workspaces');}
  status(){return this.call('merchant_open311_service_configuration_status');}
  records(kind,input){return this.call('merchant_open311_service_configuration_records',{...input,kind});}
  input(input){return this.call('merchant_open311_service_configuration_input',{input});}
  inspectSource(input){return this.call('merchant_open311_service_configuration_inspect_source',input);}
  importSource(input){return this.call('merchant_open311_service_configuration_import_source',input);}
  source(input){return this.call('merchant_open311_service_configuration_source',input);}
  sourceRows(input){return this.call('merchant_open311_service_configuration_source_rows',input);}
  saveProfile(input){return this.call('merchant_open311_service_configuration_profile_save',input);}
  importProfile(input){return this.call('merchant_open311_service_configuration_profile_import',input);}
  profile(input){return this.call('merchant_open311_service_configuration_profile',input);}
  createPreview(input){return this.call('merchant_open311_service_configuration_preview_create',input);}
  preview(input){return this.call('merchant_open311_service_configuration_preview',input);}
  createRelease(input){return this.call('merchant_open311_service_configuration_release_create',input);}
  release(input){return this.call('merchant_open311_service_configuration_release',input);}
  operation(requestId){return this.call('merchant_open311_service_configuration_operation',{requestId});}
  receive(input){return this.call('merchant_open311_service_configuration_receive',input);}
  readFile(selection,continuation={}){return this.call('merchant_open311_service_configuration_file_read',{...selection,...continuation});}
  releaseFile(readId){return this.call('merchant_open311_service_configuration_file_release',{readId});}
  async downloadFile(selection, { limit = 196608, maximumBytes = 268435456, onChunk } = {}) {
    requireValue(Number.isSafeInteger(maximumBytes) && maximumBytes > 0, 'Set a positive download size limit.');
    requireValue(onChunk === undefined || typeof onChunk === 'function', 'Use an async byte sink for streaming downloads.');
    const chosen = clone(selection), parts = [], hash = createHash('sha256');
    let offset = 0, file, readId, expectedSha256, completed = false;
    try {
      for (;;) {
        const chunk = await this.readFile(chosen, { limit, offset,
          ...(readId ? { readId } : {}), ...(expectedSha256 ? { expectedSha256 } : {}) });
        requireValue(chunk?.encoding === 'base64' && chunk.offset === offset &&
          hashPattern.test(chunk.file?.sha256 ?? '') && Number.isSafeInteger(chunk.file?.bytes) &&
          chunk.file.bytes >= 0 && chunk.file.bytes <= maximumBytes, 'The retained download metadata changed.', 'OPEN311_SERVICE_CONFIGURATION_DOWNLOAD_CHANGED');
        if (!file) { file = clone(chunk.file); expectedSha256 = file.sha256; }
        else requireValue(canonical(file) === canonical(chunk.file),
          'The retained download selection changed.', 'OPEN311_SERVICE_CONFIGURATION_DOWNLOAD_CHANGED');
        readId = chunk.readId;
        const bytes = Buffer.from(chunk.data, 'base64');
        requireValue(bytes.toString('base64') === chunk.data && bytes.length === chunk.bytesRead &&
          offset + bytes.length <= file.bytes, 'The retained download bytes changed.', 'OPEN311_SERVICE_CONFIGURATION_DOWNLOAD_CHANGED');
        hash.update(bytes);
        if (onChunk) await onChunk(bytes, { file, offset }); else parts.push(bytes);
        offset += bytes.length;
        if (chunk.nextOffset === null) {
          requireValue(offset === file.bytes && hash.digest('hex') === file.sha256,
            'The complete downloaded file differs from its source hash.', 'OPEN311_SERVICE_CONFIGURATION_DOWNLOAD_CHANGED');
          completed = true;
          return { file, bytesRead: offset, ...(onChunk ? {} : { bytes: Buffer.concat(parts, offset) }) };
        }
        requireValue(chunk.nextOffset === offset && bytes.length > 0,
          'The retained reader did not advance by its original byte count.', 'OPEN311_SERVICE_CONFIGURATION_DOWNLOAD_CHANGED');
      }
    } catch (error) {
      if (file) error.continuation = { selection: chosen, expectedSha256: file.sha256, offset, file };
      throw error;
    } finally {
      if (!completed && readId) await this.releaseFile(readId).catch(() => {});
    }
  }
}
