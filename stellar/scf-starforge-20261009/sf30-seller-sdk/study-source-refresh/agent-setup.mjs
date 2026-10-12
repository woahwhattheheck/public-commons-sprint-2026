// MIT. Host-declared aliases for the same native Study operator and original Merchant.
import { mkdir, lstat, realpath, access, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STUDY_CONNECTION_SCHEMA } from './agent-contracts.mjs';
import { STUDY_HERE, STUDY_MAX_PACKET_BYTES, plain, need, exact, identifier, text, sha, absolute,
  readFile, decode, immutable, json, privateDirectory, inspectStudyBinding } from './agent-local.mjs';

export async function readStudyWorkspaceConfiguration(filename) {
  filename = absolute(filename);
  const value = decode(await readFile(filename,1024*1024,true)),base = dirname(filename);
  exact(value,['schema','workspaces'],['schema','workspaces']);
  need(value.schema === STUDY_CONNECTION_SCHEMA && plain(value.workspaces) &&
    Object.keys(value.workspaces).length >= 1 && Object.keys(value.workspaces).length <= 32,
  'STUDY_CONFIGURATION_INVALID','Declare one through 32 original Study workspace aliases.');
  const workspaces = Object.create(null), selected = new Set();
  for (const [alias,input] of Object.entries(value.workspaces)) {
    identifier(alias);
    exact(input,['label','directory','pythonExecutable','nodeExecutable','allowStart','inputs','acquisitions'],['directory']);
    const binding = await inspectStudyBinding({directory:absolute(input.directory,base),label:input.label ?? alias,
      ...(input.pythonExecutable === undefined?{}:{pythonExecutable:absolute(input.pythonExecutable,base)}),
      ...(input.allowStart === undefined?{}:{allowStart:input.allowStart})});
    need(!selected.has(binding.directory),'STUDY_CONFIGURATION_INVALID','Give each original workspace directory one host alias.');
    selected.add(binding.directory);
    const nodeExecutable=absolute(input.nodeExecutable ?? process.execPath,base);
    await access(nodeExecutable,constants.X_OK);
    const files = input.inputs ?? {}, inputs = Object.create(null);
    need(plain(files) && Object.keys(files).length<=128,'STUDY_CONFIGURATION_INVALID','Declare up to 128 original input-file aliases.');
    for(const [key,item] of Object.entries(files)) {
      identifier(key);
      exact(item,['file','label','kind','provider','sha256','mediaType'],['file']);
      const file=absolute(item.file,base),info=await lstat(file),kind=item.kind ?? 'file';
      need(info.isFile() && !info.isSymbolicLink() && info.size<=STUDY_MAX_PACKET_BYTES && await realpath(file)===file,
        'STUDY_INPUT_INVALID','Declare an original complete regular input file within the native 512 MiB limit.');
      need(['source','scan','document','json','package','file'].includes(kind),'STUDY_INPUT_KIND_INVALID','Use a declared input-file kind.');
      if(item.sha256!==undefined)sha(item.sha256);
      if(item.provider!==undefined)need(['acs','acs_api','bls','hud'].includes(item.provider),'STUDY_PROVIDER_INVALID','Select the original provider.');
      if(kind==='source')need(item.provider!==undefined,'STUDY_PROVIDER_REQUIRED','A source pointer declares its original provider.');
      inputs[key]={file,kind,label:text(item.label??key,240),mediaType:text(item.mediaType??'application/octet-stream',200),
        ...(item.provider===undefined?{}:{provider:item.provider}),...(item.sha256===undefined?{}:{sha256:item.sha256})};
    }
    const declared=input.acquisitions??{},acquisitions=Object.create(null);
    need(plain(declared)&&Object.keys(declared).length<=128,'STUDY_CONFIGURATION_INVALID','Declare up to 128 existing original SF88 sessions.');
    for(const [key,item] of Object.entries(declared)) {
      identifier(key);exact(item,['session','provider','label','checkout'],['session','provider']);
      need(['acs','bls'].includes(item.provider),'STUDY_PROVIDER_INVALID','An original source-files acquisition uses ACS or BLS.');
      const checkout=absolute(item.checkout??resolve(STUDY_HERE,'../../../..'),base),session=absolute(item.session,base);
      need(await realpath(checkout)===resolve(STUDY_HERE,'../../../..'),'STUDY_ORIGINAL_CHECKOUT_REQUIRED',
        'Use the original installed Study checkout for its existing buyer delivery runtime.');
      await privateDirectory(session);
      acquisitions[key]={checkout,session,provider:item.provider,label:text(item.label??key,240)};
    }
    workspaces[alias]={...binding,nodeExecutable,inputs,acquisitions};
  }
  return {schema:STUDY_CONNECTION_SCHEMA,workspaces};
}

/** Publish the normal Merchant configuration only after its original setup is complete. */
export async function initializeStudyWorkspaceMerchant(options) {
  exact(options,['directory','connection','name'],['directory','connection']);
  const root=absolute(options.directory),connection=absolute(options.connection),name=text(options.name??'Study source and property research',240);
  const selected=await readStudyWorkspaceConfiguration(connection),parent=await privateDirectory(dirname(root));
  const configuration=join(root,'merchant-mcp.json');
  const expected={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},studyWorkspaceConnection:connection};
  try {
    const old=decode(await readFile(configuration,1024*1024,true));
    need(JSON.stringify(old)===JSON.stringify(expected),'STUDY_SETUP_CONFLICT','The existing Merchant directory has another configuration.');
    const {readMerchantConfig}=await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs');
    await readMerchantConfig(configuration);
    return {schema:expected.schema,configuration,state:'REOPENED',workspaces:Object.keys(selected.workspaces)};
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  try {await lstat(root);need(false,'STUDY_SETUP_DESTINATION_EXISTS','Select a new Merchant directory or reopen its complete original configuration.');}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  const stage=join(parent,'.study-merchant-'+randomUUID());
  await mkdir(stage,{mode:0o700});
  try {
    const {initReleaseStore}=await import('../../sf82-seller-pilot/releases.mjs');
    await initReleaseStore(join(stage,'releases'));
    await mkdir(join(stage,'customer-exports'),{mode:0o700});
    await immutable(join(stage,'merchant-mcp.json'),json(expected));
    const {readMerchantConfig}=await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs');
    await readMerchantConfig(join(stage,'merchant-mcp.json'));
    await rename(stage,root);
    return {schema:expected.schema,configuration,state:'INITIALIZED',workspaces:Object.keys(selected.workspaces)};
  } catch(error) {await rm(stage,{recursive:true,force:true});throw error;}
}
