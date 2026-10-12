// MIT. Native exports use the original complete merchant receiving client and checkpoint.
import {createRetainedDownload, openMerchantFileClient} from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {nativeAlias, requireNative, parseNativeOperatorManifest, NATIVE_OPERATOR_MANIFEST,
  NATIVE_OPERATOR_MAX_FILE_BYTES, NATIVE_OPERATOR_MAX_MANIFEST_BYTES} from './merchant-export-contract.mjs';
import {nativeOperatorToolPrefix} from './merchant-tools.mjs';

const receiving=createRetainedDownload({
  manifestName:NATIVE_OPERATOR_MANIFEST,parseManifest:parseNativeOperatorManifest,
  maximumBytes:NATIVE_OPERATOR_MAX_FILE_BYTES,maximumManifestBytes:NATIVE_OPERATOR_MAX_MANIFEST_BYTES,
  stateSchema:'stellar-forge.native-operator-download-state.v1',
  resultSchema:'stellar-forge.native-operator-download.v1',
  toolPrefix:nativeOperatorToolPrefix,errorPrefix:'NATIVE_OPERATOR',clientName:'starforge-native-operator-receive',
  describe:manifest=>({operator:manifest.operator,kind:manifest.kind,source:manifest.source}),
});
async function boundOptions(options={}) {
  const {operator,url,client,tokenEnv,environment,signal,...rest}=options;
  nativeAlias(operator);
  requireNative(!(client&&url!==undefined),'NATIVE_OPERATOR_DOWNLOAD_CONFIGURATION',
    'Supply one original merchant client or its endpoint URL.');
  const original=client??await openMerchantFileClient({url,tokenEnv,environment,signal,
    errorPrefix:'NATIVE_OPERATOR',clientName:'starforge-native-operator-receive'});
  requireNative(original&&typeof original.call==='function'&&typeof original.endpoint==='string'&&original.endpoint.length>0,
    'NATIVE_OPERATOR_DOWNLOAD_CONFIGURATION');
  const selected=Object.freeze({endpoint:original.endpoint+'#native-operator='+operator,
    call:(name,args,request)=>original.call(name,{...args,operator},request)});
  return {...rest,signal,client:selected};
}
/** Inspect the original manifest through one host-declared operator alias. */
export async function inspectNativeOperatorExport(options) {
  return receiving.inspect(await boundOptions(options));
}
/** Receive or resume the exact original manifest and files in the same local directory. */
export async function downloadNativeOperatorExport(options) {
  return receiving.download(await boundOptions(options));
}
