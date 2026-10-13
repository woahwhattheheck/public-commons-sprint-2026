// MIT. Host setup declares the original native operator connection and private receiving.
import {mkdir, open} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {exact, line, writePrivate} from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {CONFIG_SCHEMA, readMerchantConfig} from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import {initReleaseStore} from '../../sf82-seller-pilot/releases.mjs';
import {readNativeOperatorConfiguration} from './merchant-connection.mjs';
import {privateDirectory} from './store.mjs';
import {requireNative} from './merchant-export-contract.mjs';

async function syncDirectory(path) {
  const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
}
export async function initializeNativeFacilitatorMerchant(options) {
  exact(options,['directory','connection','name'],['directory','connection']);
  requireNative(typeof options.directory==='string'&&options.directory.trim()&&
    typeof options.connection==='string'&&options.connection.trim(),'NATIVE_OPERATOR_SETUP_INVALID');
  const directory=resolve(options.directory),connection=resolve(options.connection);
  const name=line(options.name??'Starforge native facilitator','Merchant name');
  await privateDirectory(dirname(directory));
  const selected=await readNativeOperatorConfiguration(connection);
  await mkdir(directory,{mode:0o700});
  await privateDirectory(directory);
  await syncDirectory(dirname(directory));
  await initReleaseStore(join(directory,'releases'));
  await mkdir(join(directory,'customer-exports'),{mode:0o700});
  const configuration=join(directory,'merchant-mcp.json');
  await writePrivate(configuration,{schema:CONFIG_SCHEMA,name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},nativeFacilitatorOperatorConnection:connection});
  await syncDirectory(directory);
  await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',nativeFacilitatorOperatorsConfigured:true,
    operators:Object.entries(selected.operators).map(([operator,value])=>({operator,label:value.label})),
    hostOwnership:'ORIGINAL_NATIVE_FACILITATOR_OPERATOR'};
}
