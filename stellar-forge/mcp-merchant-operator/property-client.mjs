// MIT. Property Operations agent SDK over the original merchant HTTP/file clients.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {propertyWorkspaceTools} from './catalog/property-workspace.mjs';
import {openMerchantFileClient,createRetainedDownload} from './retained-download.mjs';
import {exact,failure,identifier} from './host-files.mjs';
import {PROPERTY_DOWNLOAD_MANIFEST,PROPERTY_MAX_FILE_BYTES,PROPERTY_MAX_MANIFEST_BYTES,
  parsePropertyDownloadManifest,validatePropertyExportId} from './property-download-contract.mjs';
const PREFIX='merchant_property_',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const describe=(name,description,properties,required,annotations={})=>({name,description,
  inputSchema:{type:'object',properties,required,additionalProperties:false},annotations});
export const propertyActions=Object.freeze(Object.fromEntries(propertyWorkspaceTools(describe).map(t=>[t.name.slice(PREFIX.length),t])));
function checkedTool(action,args){
  const name=typeof action==='string'?(action.startsWith(PREFIX)?action:PREFIX+action):'',definition=propertyActions[name.slice(PREFIX.length)];
  if(!definition)throw failure('PROPERTY_TOOL_NOT_FOUND','Choose a declared Property Operations tool.');
  exact(args,Object.keys(definition.inputSchema.properties),definition.inputSchema.required);return name;
}
export async function openPropertyClient({workspace,...options}={}){
  if(workspace!==undefined)identifier(workspace,'Original property workspace alias');
  const original=await openMerchantFileClient({...options,errorPrefix:'PROPERTY',clientName:'starforge-property-customer',maximumResponseBytes:128*1024*1024});
  let closing=false,closed=null;
  const pending=new Set();
  function own(work) {
    if(closing)return Promise.reject(failure('PROPERTY_CLIENT_CLOSED','This borrowed Property client is closing.'));
    const job=Promise.resolve().then(work);pending.add(job);
    job.then(()=>pending.delete(job),()=>pending.delete(job));
    return job;
  }
  // This private transport remains available only to already-owned full downloads while close drains.
  const nativeCall=(action,args={},requestOptions)=>{
    const selected={...args},short=typeof action==='string'&&action.startsWith(PREFIX)?action.slice(PREFIX.length):action;
    if(workspace!==undefined&&short!=='workspaces'){
      if(selected.workspace!==undefined&&selected.workspace!==workspace)throw failure('PROPERTY_CLIENT_BINDING','Use the original selected workspace alias.');
      selected.workspace=workspace;
    }
    return original.call(checkedTool(action,selected),selected,requestOptions);
  };
  const call=(action,args={},requestOptions)=>own(()=>nativeCall(action,args,requestOptions));
  const methods=Object.fromEntries(Object.keys(propertyActions).map(name=>[
    name.replace(/_([a-z])/g,(_,v)=>v.toUpperCase()),(args={},requestOptions)=>call(name,args,requestOptions)]));
  const borrowed={endpoint:original.endpoint,call:nativeCall};
  return Object.freeze({endpoint:original.endpoint,call,...methods,
    toolDefinitions:()=>Object.values(propertyActions),
    close() {
      if(!closed){closing=true;closed=(async()=>{while(pending.size)await Promise.allSettled([...pending]);})();}
      return closed;
    },
    download:(args={})=>own(()=>downloadPropertyExport({...args,workspace:args.workspace??workspace,client:borrowed})),
    inspectDownload:(args={})=>own(()=>inspectPropertyExport({...args,workspace:args.workspace??workspace,client:borrowed}))});
}
const downloads = createRetainedDownload({
  manifestName:PROPERTY_DOWNLOAD_MANIFEST, parseManifest:parsePropertyDownloadManifest,
  maximumBytes:PROPERTY_MAX_FILE_BYTES, maximumManifestBytes:PROPERTY_MAX_MANIFEST_BYTES,
  maximumCheckpointBytes:128 * 1024 * 1024, nestedFiles:true,
  stateSchema:'stellar-forge.property-download-state.v1',
  resultSchema:'stellar-forge.property-download-result.v1',
  toolPrefix:'merchant_property_export', errorPrefix:'PROPERTY',
  clientName:'starforge-property-receiving', validateExportId:validatePropertyExportId,
  describe:manifest => ({workspaceId:manifest.workspaceId, native:manifest.native}),
});
async function selectedTransport({client, workspace, url, tokenEnv, environment, signal}) {
  identifier(workspace, 'Property workspace alias');
  if (client !== undefined && url !== undefined)
    throw failure('PROPERTY_DOWNLOAD_CONFIGURATION', 'Supply the original client or its endpoint once.');
  const original = client ?? await openMerchantFileClient({url, tokenEnv, environment, signal,
    errorPrefix:'PROPERTY', clientName:'starforge-property-receiving', maximumResponseBytes:128 * 1024 * 1024});
  if (!original || typeof original.call !== 'function' || typeof original.endpoint !== 'string')
    throw failure('PROPERTY_DOWNLOAD_CONFIGURATION', 'Use one original merchant file client.');
  return {endpoint:original.endpoint + '#property=' + workspace,
    call:(tool, args, options) => original.call(tool, {...args, workspace}, options)};
}
export async function downloadPropertyExport(options = {}) {
  const {workspace, client, url, tokenEnv, environment, signal, ...rest} = options;
  const selected = await selectedTransport({workspace, client, url, tokenEnv, environment, signal});
  return downloads.download({...rest, signal, client:selected});
}
export async function inspectPropertyExport(options = {}) {
  const {workspace, client, url, tokenEnv, environment, signal, ...rest} = options;
  const selected = await selectedTransport({workspace, client, url, tokenEnv, environment, signal});
  return downloads.inspect({...rest, signal, client:selected});
}

/** Verify every original received file with both native and merchant listeners closed. */
export async function reopenPropertyExport({directory, exportId, expectedManifestSha256} = {}) {
  validatePropertyExportId(exportId);
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      expectedManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedManifestSha256))
    throw failure('PROPERTY_DOWNLOAD_CONFIGURATION', 'Select the retained directory and its original manifest identity.');
  const root = resolve(directory), raw = await downloads.bytesAt(join(root, PROPERTY_DOWNLOAD_MANIFEST), PROPERTY_MAX_MANIFEST_BYTES);
  const manifestSha256 = sha(raw), manifest = parsePropertyDownloadManifest(raw, exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256)
    throw failure('PROPERTY_DOWNLOAD_EXPORT_CHANGED', 'The completed manifest differs from its reviewed original digest.');
  return downloads.lockedDownload(root, async context => {
    await downloads.loadContext(context, raw, exportId);
    for (const file of manifest.files) {
      context.lease.assertHeld();
      await downloads.verifiedFile(join(root, file.name), file);
    }
    return {schema:'stellar-forge.property-download-result.v1', state:'REOPENED',
      directory:root, exportId, workspaceId:manifest.workspaceId, native:manifest.native,
      manifestSha256, files:manifest.files.length, bytes:manifest.totalBytes,
      verifiedFiles:manifest.files};
  });
}

