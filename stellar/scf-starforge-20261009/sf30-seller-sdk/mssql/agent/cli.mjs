#!/usr/bin/env node
// MIT. Original merchant host plus direct source-owner operations.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeMssqlWorkspaceMerchant } from './setup.mjs';
import { MerchantMssqlWorkspaces, readMssqlWorkspaceConfiguration } from './client.mjs';
import { readBytes, decodeJSON, need, exact } from '../workspace/operator-store.mjs';
const HELP='SQL Server agent and operator\n\n'+
'  mssql-agent init --options PRIVATE_SETUP_JSON\n'+
'  mssql-agent serve --config MERCHANT_CONFIG [original merchant host options]\n'+
'  mssql-agent call --connection PRIVATE_CONNECTION --tool merchant_mssql_TOOL --input ORIGINAL_JSON [--release-store PRIVATE_STORE]\n\n'+
'Use one retained workspaceId and operation UUID from the original SQL Server owner. Every call uses the same authenticated browser listener.\n';
export async function main(argv=process.argv.slice(2)) {
  const action=argv[0];
  if(!action||['help','--help','-h'].includes(action)){process.stdout.write(HELP);return;}
  if(action==='serve')return (await import('../../../../../stellar-forge/mcp-merchant-operator/serve.mjs')).main(argv);
  const options=Object.create(null);
  for(let i=1;i<argv.length;i+=2) {
    need(['--options','--connection','--tool','--input','--release-store'].includes(argv[i])&&
      typeof argv[i+1]==='string'&&argv[i+1]&&!argv[i+1].startsWith('--')&&!Object.hasOwn(options,argv[i]),
      'MSSQL_AGENT_USAGE',HELP);
    options[argv[i]]=argv[i+1];
  }
  let result;
  if(action==='init') {
    exact(options,['--options'],['--options']);
    result=await initializeMssqlWorkspaceMerchant(decodeJSON(await readBytes(resolve(options['--options']),1048576)));
  } else if(action==='call') {
    exact(options,['--connection','--tool','--input','--release-store'],['--connection','--tool','--input']);
    const configured=await readMssqlWorkspaceConfiguration(resolve(options['--connection']));
    const args=decodeJSON(await readBytes(resolve(options['--input']),524288));
    const runtime=new MerchantMssqlWorkspaces({mssqlWorkspaces:configured,
      releaseStore:options['--release-store']?resolve(options['--release-store']):undefined});
    try{result=await runtime.call(options['--tool'],args);}finally{await runtime.close();}
  } else need(false,'MSSQL_AGENT_USAGE',HELP);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'MSSQL_AGENT_FAILED',message:error.message,
    ...(error.outcomeUnknown?{outcomeUnknown:true}:{})})+'\n');process.exitCode=1;});
