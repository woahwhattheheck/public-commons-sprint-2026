#!/usr/bin/env node
// MIT. Complete SQL Server transfer receiving through the existing merchant downloader.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRetainedDownload, openMerchantFileClient } from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { parseMssqlTransferManifest, MSSQL_TRANSFER_MANIFEST, MSSQL_TRANSFER_FILE_BYTES,
  MSSQL_TRANSFER_MANIFEST_BYTES } from '../workspace/transfer.mjs';
import { ALIAS, UUID, checked, need } from '../workspace/operator-store.mjs';

function receiver(scope) {
  return createRetainedDownload({
    manifestName:MSSQL_TRANSFER_MANIFEST,maximumBytes:MSSQL_TRANSFER_FILE_BYTES,
    maximumManifestBytes:MSSQL_TRANSFER_MANIFEST_BYTES,maximumCheckpointBytes:2*MSSQL_TRANSFER_MANIFEST_BYTES,
    stateSchema:'stellar-forge.mssql-download-state.v1',resultSchema:'stellar-forge.mssql-download-result.v1',
    toolPrefix:'merchant_mssql_export',errorPrefix:'MSSQL',clientName:'starforge-mssql-receiving',nestedFiles:true,
    validateExportId:value=>checked(value,UUID,'export UUID'),
    parseManifest(bytes,exportId){
      const value=parseMssqlTransferManifest(bytes,exportId);
      need(value.workspaceId===scope.workspaceId,'MSSQL_DOWNLOAD_WORKSPACE_CHANGED');return value;
    },
    describe:value=>({workspaceId:value.workspaceId,releaseId:value.releaseId,kind:value.kind,
      packageManifestSha256:value.packageManifestSha256})
  });
}
async function selected(options) {
  const scope={workspace:checked(options.workspace,ALIAS,'workspace alias'),workspaceId:checked(options.workspaceId,UUID,'workspace UUID')};
  need(options.client===undefined||options.url===undefined,'MSSQL_DOWNLOAD_CONFIGURATION');
  const original=options.client??await openMerchantFileClient({...options,errorPrefix:'MSSQL',clientName:'starforge-mssql-receiving'});
  need(original&&typeof original.call==='function'&&typeof original.endpoint==='string','MSSQL_DOWNLOAD_CONFIGURATION');
  const client={endpoint:JSON.stringify([original.endpoint,'mssql',scope.workspace,scope.workspaceId]),
    async call(name,args,requestOptions) {
      const result=await original.call(name,{...args,...scope},requestOptions);
      need(result?.workspace===scope.workspace&&result?.workspaceId===scope.workspaceId&&result.result&&
        typeof result.result==='object','MSSQL_DOWNLOAD_WORKSPACE_CHANGED');
      return result.result;
    }};
  const {url,workspace,workspaceId,...rest}=options;
  return {scope,options:{...rest,client}};
}
export async function inspectMssqlTransfer(options={}) {
  const value=await selected(options);return receiver(value.scope).inspect(value.options);
}
export async function downloadMssqlTransfer(options={}) {
  const value=await selected(options);return receiver(value.scope).download(value.options);
}
const HELP='Receive an existing SQL Server merchant or customer export\n\n'+
'  mssql-download inspect --url MCP_URL --workspace ALIAS --workspace-id UUID --export-id UUID\n'+
'  mssql-download receive --url MCP_URL --workspace ALIAS --workspace-id UUID --export-id UUID --directory PRIVATE_DIRECTORY\n'+
'    [--expected-manifest-sha256 SHA256] [--chunk-size 196608] [--token-env MCP_ACCESS_TOKEN]\n\n'+
'Repeat the same selection and directory to continue its exact original files. An existing export is reused throughout.\n';
export async function main(argv=process.argv.slice(2)) {
  const action=argv[0];
  if(!action||['help','--help','-h'].includes(action)){process.stdout.write(HELP);return;}
  need(['inspect','receive'].includes(action),'MSSQL_DOWNLOAD_USAGE',HELP);
  const names={'--url':'url','--workspace':'workspace','--workspace-id':'workspaceId','--export-id':'exportId',
    '--directory':'directory','--expected-manifest-sha256':'expectedManifestSha256','--chunk-size':'chunkSize','--token-env':'tokenEnv'},options={};
  for(let index=1;index<argv.length;index+=2) {
    const key=argv[index],value=argv[index+1];
    need(Object.hasOwn(names,key)&&typeof value==='string'&&value&&!value.startsWith('--')&&
      !Object.hasOwn(options,names[key]),'MSSQL_DOWNLOAD_USAGE',HELP);
    options[names[key]]=value;
  }
  for(const key of ['url','workspace','workspaceId','exportId'])need(options[key],'MSSQL_DOWNLOAD_USAGE',HELP);
  if(action==='receive')need(options.directory,'MSSQL_DOWNLOAD_USAGE',HELP);
  else need(!['directory','expectedManifestSha256','chunkSize'].some(key=>Object.hasOwn(options,key)),'MSSQL_DOWNLOAD_USAGE',HELP);
  if(options.directory)options.directory=resolve(options.directory);
  if(options.chunkSize!==undefined){need(/^[1-9]\d*$/.test(options.chunkSize),'MSSQL_DOWNLOAD_USAGE');options.chunkSize=Number(options.chunkSize);}
  const controller=new AbortController(),interrupt=()=>controller.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try {
    const result=await(action==='inspect'?inspectMssqlTransfer({...options,signal:controller.signal}):
      downloadMssqlTransfer({...options,signal:controller.signal}));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'MSSQL_DOWNLOAD_FAILED',message:error.message})+'\n');process.exitCode=1;});
