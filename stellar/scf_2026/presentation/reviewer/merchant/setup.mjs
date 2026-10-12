// MIT. Restartable host setup using the original merchant configuration and release store.
import {mkdir,mkdtemp,readdir} from 'node:fs/promises';
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
  const selectionFile=join(root,'reviewer-release-store.json');
  let release;
  try{release=decode(await readSourceFile(selectionFile,{privateFile:true,maxBytes:65536}));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const candidates=join(root,'release-candidates');await directory(candidates);
    const stage=await mkdtemp(join(candidates,'native-'));
    // Original initialization receives an absent directory. Only a complete
    // native store is selected; an interrupted unselected candidate is retained.
    await native.initReleaseStore(join(stage,'store'));
    const proposal={schema:'stellar-forge.grant-reviewer-release-selection.v1',
      directory:'./release-candidates/'+stage.split('/').at(-1)+'/store',
      setupSha256:digest(encode(intent))};
    try{await writeSourceFile(selectionFile,encode(proposal));}
    catch(error){if(error.code!=='EEXIST')throw error;}
    release=decode(await readSourceFile(selectionFile,{privateFile:true,maxBytes:65536}));
  }
  need(release.schema==='stellar-forge.grant-reviewer-release-selection.v1' &&
    release.setupSha256===digest(encode(intent)) &&
    /^\.\/release-candidates\/native-[A-Za-z0-9]+\/store$/.test(release.directory??''),
  'GRANT_REVIEWER_SETUP_CHANGED','Use the original completed native release-store selection.');
  await native.readReleaseState(resolve(root,release.directory));
  await directory(join(root,'customer-exports'));
  const config={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:release.directory,
    exportsDirectory:'./customer-exports',sources:{},grantReviewerConnection:connection},
    configuration=join(root,'merchant-mcp.json');
  // The normal reader validates this selected provider and every existing host field.
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('../../../../../stellar-forge/mcp-merchant-operator/config.mjs');
  config.schema=CONFIG_SCHEMA;
  await retain(configuration,encode(config));await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,state:'INITIALIZED',configuration,workspaces:Object.keys(selected.workspaces),
    source:'original-reviewer-workbench',newPayments:0};
}
