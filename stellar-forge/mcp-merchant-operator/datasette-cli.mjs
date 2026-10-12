#!/usr/bin/env node
// MIT. Original Datasette merchant operations and complete retained receiving.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {datasetteActions,openDatasetteClient,downloadDatasetteExport,inspectDatasetteExport,reopenDatasetteExport,uploadDatasetteFile} from './datasette-client.mjs';

const HELP=[
  'Starforge Datasette MCP customer',
  '',
  '  datasette-mcp tools',
  '  datasette-mcp call --url MCP_URL --action ACTION --arguments PRIVATE_JSON [--workspace ALIAS] [--token-env NAME] [--output NEW_JSON]',
  '  datasette-mcp upload --url MCP_URL --workspace ALIAS --upload-id UUID --file PRIVATE_ARCHIVE --name ORIGINAL_NAME --bytes DECIMAL --sha256 SHA [--chunk-size BYTES] [--token-env NAME] [--output NEW_JSON]',
  '  datasette-mcp upload-status --url MCP_URL --workspace ALIAS --upload-id UUID [--token-env NAME] [--output NEW_JSON]',
  '  datasette-mcp inspect --url MCP_URL --workspace ALIAS --export EXPORT_ID [--token-env NAME] [--output NEW_JSON]',
  '  datasette-mcp download --url MCP_URL --workspace ALIAS --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--token-env NAME] [--chunk-size BYTES] [--output NEW_JSON]',
  '  datasette-mcp reopen --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--output NEW_JSON]',
  '',
  'tools prints the original operation schema plus the complete receiving catalog.',
  'call accepts a short action or its full merchant_datasette_ tool name.',
  'The operation action forwards the original operation/input without automatic replay.',
  'Preserve capture operationId, extraction runId, original edition/review and target identities.',
  'After an uncertain reply inspect the original status and saved operation before continuing.',
  'export_prepare pins existing complete files; run original workspace.export explicitly first',
  'when the receiving package should include an editable native workspace archive.',
  'upload verifies the complete reviewed file, then continues its original UUID and durable native prefix.',
  'A failed chunk stops without replay. Inspect upload-status and explicitly rerun the same upload command.',
  'Only a COMPLETE native upload supplies archiveFile for the unchanged source.receive/workspace.receive.',
  'download resumes the same original manifest and byte ranges. reopen is fully offline.',
  '',
].join('\n');
function fail(message){throw Object.assign(new Error(message),{code:'DATASETTE_CLI'});}
function options(args,allowed,required=[]) {
  const result={};
  for(let index=0;index<args.length;index+=2) {
    const key=args[index],value=args[index+1];
    if(!allowed.includes(key)||typeof value!=='string'||!value||Object.hasOwn(result,key))
      fail('Use every declared option at most once with its value.');
    result[key]=value;
  }
  if(required.some(key=>!Object.hasOwn(result,key)))fail('Supply the required options shown in help.');
  return result;
}
async function argumentsFile(path) {
  const handle=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||(before.mode&0o077n)!==0n||before.size>1048576n)
      fail('Use a complete private regular UTF-8 argument file no larger than 1 MiB.');
    const raw=await handle.readFile(),after=await handle.stat({bigint:true});
    if(raw.length>1048576||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||
       before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
      fail('The reviewed argument file changed while it was read.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  } finally {await handle.close();}
}
async function output(result,path) {
  const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
  if(path) {
    const handle=await open(resolve(path),'wx',0o600);
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    process.stdout.write(JSON.stringify({saved:resolve(path),bytes:bytes.length})+'\n');
  } else process.stdout.write(bytes);
  return result;
}
export async function main(argv=process.argv.slice(2)) {
  const [command,...rest]=argv;
  if(!command||['help','--help'].includes(command)){process.stdout.write(HELP);return;}
  if(command==='tools') {if(rest.length)fail('tools takes no options.');return output(datasetteActions);}
  const shared=['--output'],remote=['--url','--workspace','--token-env'];let args,result;
  if(command==='call') {
    args=options(rest,[...shared,...remote,'--action','--arguments'],['--url','--action','--arguments']);
    const client=await openDatasetteClient({url:args['--url'],tokenEnv:args['--token-env'],workspace:args['--workspace']});
    result=await client.call(args['--action'],await argumentsFile(args['--arguments']));
  } else if(command==='upload') {
    args=options(rest,[...shared,...remote,'--upload-id','--file','--name','--bytes','--sha256','--chunk-size'],
      ['--url','--workspace','--upload-id','--file','--name','--bytes','--sha256']);
    if(args['--chunk-size']!==undefined&&!/^[1-9][0-9]*$/.test(args['--chunk-size']))fail('Use a positive integer chunk size.');
    result=await uploadDatasetteFile({url:args['--url'],workspace:args['--workspace'],tokenEnv:args['--token-env'],
      uploadId:args['--upload-id'],path:args['--file'],name:args['--name'],bytes:args['--bytes'],sha256:args['--sha256'],
      ...(args['--chunk-size']===undefined?{}:{chunkSize:Number(args['--chunk-size'])})});
  } else if(command==='upload-status') {
    args=options(rest,[...shared,...remote,'--upload-id'],['--url','--workspace','--upload-id']);
    const client=await openDatasetteClient({url:args['--url'],tokenEnv:args['--token-env'],workspace:args['--workspace']});
    result=await client.uploadStatus({uploadId:args['--upload-id']});
  } else if(command==='inspect') {
    args=options(rest,[...shared,...remote,'--export'],['--url','--workspace','--export']);
    result=await inspectDatasetteExport({url:args['--url'],tokenEnv:args['--token-env'],
      workspace:args['--workspace'],exportId:args['--export']});
  } else if(command==='download') {
    args=options(rest,[...shared,...remote,'--export','--directory','--manifest-sha256','--chunk-size'],
      ['--url','--workspace','--export','--directory']);
    if(args['--chunk-size']!==undefined&&!/^[1-9][0-9]*$/.test(args['--chunk-size']))fail('Use a positive integer chunk size.');
    result=await downloadDatasetteExport({url:args['--url'],workspace:args['--workspace'],tokenEnv:args['--token-env'],
      exportId:args['--export'],directory:args['--directory'],expectedManifestSha256:args['--manifest-sha256'],
      ...(args['--chunk-size']===undefined?{}:{chunkSize:Number(args['--chunk-size'])})});
  } else if(command==='reopen') {
    args=options(rest,[...shared,'--export','--directory','--manifest-sha256'],['--export','--directory']);
    result=await reopenDatasetteExport({directory:args['--directory'],exportId:args['--export'],
      expectedManifestSha256:args['--manifest-sha256']});
  } else fail('Choose tools, call, upload, upload-status, inspect, download or reopen.');
  return output(result,args['--output']);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write((issue.code??'DATASETTE_CLI')+': '+issue.message+'\n');process.exitCode=2;});
