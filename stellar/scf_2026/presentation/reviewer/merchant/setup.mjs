// MIT. Restartable host setup using the original merchant configuration and release store.
import {mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readSourceFile,writeSourceFile} from '../workspace.mjs';
import {readReviewerConfiguration} from './connection.mjs';
import {privateSupportDirectory} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {need,text,exact,decode,encode,digest,canonical} from './contracts.mjs';
async function retain(path,bytes){
  try{await writeSourceFile(path,bytes);}
  catch(error){if(error.code!=='EEXIST')throw error;
    need((await readSourceFile(path,{privateFile:true})).equals(bytes),'GRANT_REVIEWER_SETUP_CHANGED',
      'This original setup directory belongs to different reviewed inputs.');}
}
async function directory(path){await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await privateSupportDirectory(path);}
export async function initializeReviewerMerchant(options={}){
  exact(options,['directory','connection','name'],['directory','connection']);
  const root=resolve(text(options.directory,'Private merchant directory',4096)),
    connection=resolve(text(options.connection,'Original reviewer connection',4096)),
    name=text(options.name??'Starforge original purchase reviewer','Merchant name'),
    selected=await readReviewerConfiguration(connection);
  await directory(root);
  const names=await readdir(root),intentFile=join(root,'reviewer-merchant-setup.json');
  need(!names.length || names.includes('reviewer-merchant-setup.json'),'GRANT_REVIEWER_SETUP_DIRECTORY_IN_USE',
    'Choose an empty directory or this exact original reviewer merchant setup.');
  const stableSelection=Object.fromEntries(Object.entries(selected.workspaces).map(([key,binding])=>{
    const {workbenchId,selectionSha256,...declared}=binding;return [key,declared];
  }));
  const intent={schema:'stellar-forge.grant-reviewer-merchant-setup.v1',connection,name,
    connectionSha256:digest(await readSourceFile(connection,{privateFile:true,maxBytes:1024*1024})),
    selectionSha256:digest(Buffer.from(JSON.stringify(canonical(stableSelection))))};
  await retain(intentFile,encode(intent));
  const native=await import('../../../../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
  try{await native.readReleaseState(join(root,'releases'));}
  catch(error){if(error.code!=='ENOENT')throw error;await native.initReleaseStore(join(root,'releases'));}
  await directory(join(root,'customer-exports'));
  const config={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},grantReviewerConnection:connection},
    configuration=join(root,'merchant-mcp.json');
  // The normal reader validates this selected provider and every existing host field.
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('../../../../../stellar-forge/mcp-merchant-operator/config.mjs');
  config.schema=CONFIG_SCHEMA;
  await retain(configuration,encode(config));await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,state:'INITIALIZED',configuration,workspaces:Object.keys(selected.workspaces),
    source:'original-reviewer-workbench',newPayments:0};
}
