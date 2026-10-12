#!/usr/bin/env node
// MIT. Receive complete native profile/catalog files through the installed original MCP host.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectNativeOperatorExport,downloadNativeOperatorExport} from './merchant-download.mjs';
import {requireNative} from './merchant-export-contract.mjs';

const HELP=`Native facilitator receiving

  native-facilitator-receive inspect --operator ALIAS --url MCP_URL --export ID
  native-facilitator-receive download --operator ALIAS --url MCP_URL --export ID --directory DIRECTORY

Options:
  --token-env NAME         Original MCP bearer-token environment name (MCP_ACCESS_TOKEN)
  --manifest-sha256 SHA256 Expected original completion manifest, for download
  --chunk-bytes INTEGER    Original receive chunk size, 1–196608 bytes (default 196608)

Use the same operator alias, export ID, manifest and destination directory to
continue an interrupted receive. Complete files and their original manifest
are published after the original retained-download owner verifies their hashes.
`;
export async function main(argv=process.argv.slice(2)) {
  if(argv.length===0||argv.length===1&&['help','--help'].includes(argv[0])){
    process.stdout.write(HELP);return;
  }
  const [command,...args]=argv,flags=Object.create(null);
  requireNative(['inspect','download'].includes(command),'NATIVE_OPERATOR_RECEIVE_USAGE',HELP);
  const allowed=new Set(['--operator','--url','--export','--token-env','--directory','--manifest-sha256','--chunk-bytes']);
  for(let index=0;index<args.length;index+=2){
    const key=args[index],value=args[index+1];
    requireNative(allowed.has(key)&&!Object.hasOwn(flags,key)&&typeof value==='string'&&value.length>0,
      'NATIVE_OPERATOR_RECEIVE_USAGE',HELP);
    flags[key]=value;
  }
  for(const key of ['--operator','--url','--export'])
    requireNative(Object.hasOwn(flags,key),'NATIVE_OPERATOR_RECEIVE_USAGE',HELP);
  requireNative(command==='download'?Object.hasOwn(flags,'--directory'):
    !['--directory','--manifest-sha256','--chunk-bytes'].some(key=>Object.hasOwn(flags,key)),
  'NATIVE_OPERATOR_RECEIVE_USAGE',HELP);
  const options={operator:flags['--operator'],url:flags['--url'],exportId:flags['--export'],
    ...(flags['--token-env']?{tokenEnv:flags['--token-env']}:{})};
  if(command==='download'){
    options.directory=resolve(flags['--directory']);
    if(flags['--manifest-sha256'])options.expectedManifestSha256=flags['--manifest-sha256'];
    if(flags['--chunk-bytes']){
      requireNative(/^[1-9][0-9]*$/.test(flags['--chunk-bytes']),'NATIVE_OPERATOR_RECEIVE_USAGE',HELP);
      options.chunkSize=Number(flags['--chunk-bytes']);
      requireNative(Number.isSafeInteger(options.chunkSize)&&options.chunkSize<=196608,'NATIVE_OPERATOR_RECEIVE_USAGE',HELP);
    }
  }
  const result=command==='inspect'?await inspectNativeOperatorExport(options):await downloadNativeOperatorExport(options);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{console.error((error.code?error.code+': ':'')+error.message);process.exitCode=1;});
