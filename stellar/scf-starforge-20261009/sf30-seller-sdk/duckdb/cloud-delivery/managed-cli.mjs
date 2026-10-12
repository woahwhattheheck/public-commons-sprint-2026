// MIT. Installed setup for the original source-owned merchant provider.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializeCloudMerchant,readCloudWorkspaceConfiguration} from './managed.mjs';
const HELP='starforge cloud-mcp init --directory PRIVATE_HOST --connection PRIVATE_CONNECTION.json [--name NAME]\n'+
 'starforge cloud-mcp inspect --connection PRIVATE_CONNECTION.json\n'+
 'The connection selects existing original Cloud/DuckDB workspace UUIDs and host-private environment files.\n'+
 'Run the returned configuration through the installed original merchant-mcp command.\n';
export async function main(argv=process.argv.slice(2)){
 if(!argv.length||argv.includes('--help')){process.stdout.write(HELP);return null;}
 const {values:v,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
  directory:{type:'string'},connection:{type:'string'},name:{type:'string'}}});
 if(positionals.length!==1||!['init','inspect'].includes(positionals[0])||!v.connection)
  throw Object.assign(new Error(HELP),{code:'CLOUD_MCP_COMMAND_INVALID'});
 const connection=resolve(v.connection);let result;
 if(positionals[0]==='inspect'){
  const found=await readCloudWorkspaceConfiguration(connection);
  result={schema:found.schema,workspaces:Object.entries(found.workspaces).map(([workspace,value])=>({
   workspace,label:value.label,workspaceId:value.workspaceId,sourceSha256:value.sourceSha256}))};
 }else{
  if(!v.directory)throw Object.assign(new Error('Select the private original merchant host directory.'),{code:'CLOUD_MCP_DIRECTORY_REQUIRED'});
  result=await initializeCloudMerchant({directory:resolve(v.directory),connection,...(v.name?{name:v.name}:{})});
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'CLOUD_MCP_COMMAND_FAILED',message:error.message})+'\n');process.exitCode=1;});
