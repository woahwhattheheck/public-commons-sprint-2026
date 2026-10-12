#!/usr/bin/env node
// MIT. Operator receiving of an existing complete Timescale package.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {downloadTimescaleExport,inspectTimescaleExport} from './timescale-workspace-download.mjs';
import {failure} from './host-files.mjs';
const HELP='Receive an existing Timescale project\n\n'+
'  starforge timescale-download inspect --url MCP_URL --workspace ALIAS --workspace-id UUID --export-id UUID\n'+
'  starforge timescale-download receive --url MCP_URL --workspace ALIAS --workspace-id UUID --export-id UUID --directory PRIVATE_DIRECTORY\n'+
'    [--expected-manifest-sha256 SHA256] [--chunk-size 196608] [--token-env MCP_ACCESS_TOKEN]\n\n'+
'The receive command downloads all original files; repeat the same arguments and directory to continue.\n'+
'It does not create an export or execute native database work. Reopen the received native package with dataset-timescale receive.\n';
export async function main(argv=process.argv.slice(2)){
  const action=argv.shift();
  if(!action||['help','--help','-h'].includes(action)){process.stdout.write(HELP);return;}
  if(!['inspect','receive'].includes(action))throw failure('TIMESCALE_DOWNLOAD_USAGE','Choose inspect or receive.');
  const options={},names={'--url':'url','--workspace':'workspace','--workspace-id':'workspaceId','--export-id':'exportId',
    '--directory':'directory','--expected-manifest-sha256':'expectedManifestSha256','--chunk-size':'chunkSize','--token-env':'tokenEnv'};
  while(argv.length){const key=argv.shift(),value=argv.shift();if(!Object.hasOwn(names,key)||typeof value!=='string'||!value||value.startsWith('--')||Object.hasOwn(options,names[key]))
      throw failure('TIMESCALE_DOWNLOAD_USAGE','Use each declared option once with its value.');
    options[names[key]]=value;
  }
  for(const key of ['url','workspace','workspaceId','exportId'])
    if(!options[key])throw failure('TIMESCALE_DOWNLOAD_USAGE','Select the original endpoint, workspace identity and export UUID.');
  if(action==='receive'&&!options.directory)throw failure('TIMESCALE_DOWNLOAD_USAGE','Select a private receiving directory.');
  if(action==='inspect'&&['directory','expectedManifestSha256','chunkSize'].some(key=>Object.hasOwn(options,key)))
    throw failure('TIMESCALE_DOWNLOAD_USAGE','Inspection accepts only the original endpoint and export selection.');
  if(options.directory)options.directory=resolve(options.directory);
  if(options.chunkSize!==undefined){if(!/^[1-9][0-9]*$/.test(options.chunkSize))throw failure('TIMESCALE_DOWNLOAD_USAGE','Use a positive integer chunk size.');options.chunkSize=Number(options.chunkSize);}
  const controller=new AbortController(),interrupt=()=>controller.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
    const result=await(action==='inspect'?inspectTimescaleExport({...options,signal:controller.signal}):downloadTimescaleExport({...options,signal:controller.signal}));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write(JSON.stringify({error:issue.code??'TIMESCALE_DOWNLOAD_FAILED',message:issue.message})+'\n');process.exitCode=1;});
