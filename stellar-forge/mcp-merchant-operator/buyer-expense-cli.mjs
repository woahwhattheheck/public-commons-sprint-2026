#!/usr/bin/env node
// MIT. Customer CLI for original SF36 expense operations and receiving.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buyerExpenseActions, openBuyerExpenseClient, downloadBuyerExpenseExport, inspectBuyerExpenseExport, receiveBuyerExpenseProject } from './buyer-expense-client.mjs';

const HELP = [
  'Starforge buyer expense customer',
  '',
  '  expenses tools',
  '  expenses call --url MCP_URL --action ACTION --arguments PRIVATE_JSON [--token-env NAME] [--output NEW_JSON]',
  '  expenses inspect --url MCP_URL --export EXPORT_ID [--token-env NAME]',
  '  expenses download --url MCP_URL --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--token-env NAME]',
  '  expenses receive --archive COMPLETE_PROJECT_ZIP --directory NEW_PRIVATE_DIRECTORY --sha256 SHA [--python ABS_PYTHON]',
  '',
  'Use tools to read each exact action schema. Mutations require workspace, requestId and',
  'expectedRevision. Keep the original private argument JSON after interruption; inspect',
  'the same requestId before retrying. Receiving uses the original trusted receiver and',
  'never imports a ledger, reads a signer or replays a capture.', ''
].join('\n');
function fail(message){throw Object.assign(new Error(message),{code:'BUYER_EXPENSE_CLI'});}
function options(args,allowed){
  const out={};
  for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||!args[i+1]||Object.hasOwn(out,args[i]))fail('Use the declared options once, each with a value.');out[args[i]]=args[i+1];}
  return out;
}
async function argumentsFile(path){
  if(!path)fail('Supply the retained private argument JSON.');
  const h=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await h.stat();if(!s.isFile()||s.size>2_000_000||s.mode&0o077)fail('Use a private regular argument file no larger than 2 MB.');return JSON.parse(await h.readFile('utf8'));}
  finally{await h.close();}
}
export async function main(argv=process.argv.slice(2)){
  const [command,...rest]=argv;
  if(!command||command==='help'||command==='--help'){process.stdout.write(HELP);return;}
  if(command==='tools'){if(rest.length)fail('tools accepts no options.');process.stdout.write(JSON.stringify(buyerExpenseActions,null,2)+'\n');return;}
  const o=options(rest,['--url','--action','--arguments','--token-env','--output','--export','--directory','--manifest-sha256','--archive','--sha256','--python']);
  const transport={url:o['--url'],tokenEnv:o['--token-env']};
  let result;
  if(command==='call'){const client=await openBuyerExpenseClient(transport);result=await client.call(o['--action'],await argumentsFile(o['--arguments']));}
  else if(command==='inspect')result=await inspectBuyerExpenseExport({...transport,exportId:o['--export']});
  else if(command==='download')result=await downloadBuyerExpenseExport({...transport,exportId:o['--export'],directory:o['--directory'],expectedManifestSha256:o['--manifest-sha256']});
  else if(command==='receive')result=await receiveBuyerExpenseProject({archive:o['--archive'],directory:o['--directory'],expectedSha256:o['--sha256'],python:o['--python']});
  else fail('Choose tools, call, inspect, download or receive.');
  const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
  if(o['--output']){const file=await open(resolve(o['--output']),'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}process.stdout.write(JSON.stringify({saved:resolve(o['--output'])})+'\n');}
  else process.stdout.write(bytes);
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'BUYER_EXPENSE_CLI')+': '+error.message+'\n');process.exitCode=2;});
