#!/usr/bin/env node
// MIT. Complete operator and customer-transfer commands over one original workspace.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWebhookFeedClient,openWebhookFeedMerchantClient,reopenWebhookSnapshot} from './client.mjs';
import {initializeWebhookFeedMerchant} from './setup.mjs';
import {restoreWebhookSnapshot} from './receiving.mjs';
import {privateJson} from './connection.mjs';
import {need} from './contracts.mjs';
const HELP=[
 'webhook-operations setup --directory HOST --connection PRIVATE_JSON [--name NAME]',
 'webhook-operations call --connection PRIVATE_JSON --action ACTION [--json PRIVATE_INPUT_JSON]',
 'webhook-operations call --merchant-client PRIVATE_JSON --action ACTION [--json PRIVATE_INPUT_JSON]',
 'webhook-operations download --connection PRIVATE_JSON --workspace ALIAS --snapshot NAME --directory DOWNLOAD [--expected-manifest SHA256] [--chunk-size BYTES]',
 'webhook-operations reopen --directory DOWNLOAD --snapshot NAME [--expected-manifest SHA256]',
 'webhook-operations restore --directory DOWNLOAD --state CUSTOMER --snapshot NAME --expected-manifest SHA256',
 'Use --merchant-client instead of --connection for an existing remote Merchant client.',
 'webhook-operations-workspace --state PRIVATE_DIRECTORY [--runtime-file PRIVATE_JSON] [--port 0]',
 'Actions: workspaces, state, source_save, feed_save, events, event, preview, plan_save, release, snapshot, manifest, file, file_release, receive, retention.'
].join('\n')+'\n';
function argumentsFor(argv,allowed,required=[]){
 need(argv.length%2===0,'WEBHOOK_OPERATIONS_ARGUMENTS_INVALID');const value={};
 for(let index=0;index<argv.length;index+=2){
  const name=argv[index];
  need(allowed.includes(name)&&!Object.hasOwn(value,name)&&typeof argv[index+1]==='string'&&argv[index+1].length>0&&!argv[index+1].startsWith('--'),'WEBHOOK_OPERATIONS_ARGUMENTS_INVALID');
  value[name]=argv[index+1];
 }
 need(required.every(name=>value[name]),'WEBHOOK_OPERATIONS_ARGUMENT_REQUIRED');return value;
}
async function clientFor(flags){
 need(Boolean(flags['--connection'])!==Boolean(flags['--merchant-client']),'WEBHOOK_OPERATIONS_CONNECTION_REQUIRED','Choose one local connection or existing Merchant client configuration.');
 return flags['--connection']
  ?openWebhookFeedClient({connection:resolve(flags['--connection'])})
  :openWebhookFeedMerchantClient(await privateJson(resolve(flags['--merchant-client']),65536));
}
export async function webhookOperationsMain(argv=process.argv.slice(2)){
 if(argv.length===0||argv.length===1&&['--help','help'].includes(argv[0])){process.stdout.write(HELP);return;}
 const [command,...rest]=argv;let result;
 if(command==='setup'){
  const flags=argumentsFor(rest,['--directory','--connection','--name'],['--directory','--connection']);
  result=await initializeWebhookFeedMerchant({directory:resolve(flags['--directory']),connection:resolve(flags['--connection']),...(flags['--name']?{name:flags['--name']}:{})});
 }else if(command==='reopen'){
  const flags=argumentsFor(rest,['--directory','--snapshot','--expected-manifest'],['--directory','--snapshot']);
  result=await reopenWebhookSnapshot({directory:resolve(flags['--directory']),exportId:flags['--snapshot'],expectedManifestSha256:flags['--expected-manifest']});
 }else if(command==='restore'){
  const flags=argumentsFor(rest,['--directory','--state','--snapshot','--expected-manifest'],['--directory','--state','--snapshot','--expected-manifest']);
  result=await restoreWebhookSnapshot({directory:resolve(flags['--directory']),destination:resolve(flags['--state']),exportId:flags['--snapshot'],expectedManifestSha256:flags['--expected-manifest']});
 }else if(command==='call'||command==='download'){
  const flags=command==='call'
   ?argumentsFor(rest,['--connection','--merchant-client','--action','--json'],['--action'])
   :argumentsFor(rest,['--connection','--merchant-client','--workspace','--snapshot','--directory','--expected-manifest','--chunk-size'],['--workspace','--snapshot','--directory']);
  const client=await clientFor(flags),abort=new AbortController(),stop=()=>abort.abort();
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
   if(command==='call'){
    const input=flags['--json']?await privateJson(resolve(flags['--json'])):{};
    result=await client.call(flags['--action'],input,{signal:abort.signal});
   }else{
    let chunkSize;
    if(flags['--chunk-size']!==undefined){need(/^[1-9]\d{0,5}$/.test(flags['--chunk-size']),'WEBHOOK_OPERATIONS_INVALID_CHUNK_SIZE');chunkSize=Number(flags['--chunk-size']);need(chunkSize<=196608,'WEBHOOK_OPERATIONS_INVALID_CHUNK_SIZE');}
    result=await client.downloadSnapshot({workspace:flags['--workspace'],exportId:flags['--snapshot'],directory:resolve(flags['--directory']),expectedManifestSha256:flags['--expected-manifest'],chunkSize,signal:abort.signal});
   }
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await client.close();}
 }else need(false,'WEBHOOK_OPERATIONS_UNKNOWN_COMMAND','Use webhook-operations --help.');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 webhookOperationsMain().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'WEBHOOK_OPERATIONS_FAILED',message:error.message,...(error.status?{status:error.status}:{}),...(error.uncertain?{uncertain:true}:{}),...(error.details?{details:error.details}:{})})+'\n');process.exitCode=1;});
