#!/usr/bin/env node
// MIT. Complete original-workbench actions and portable receiving.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQuestDbWorkbenchClient } from './client.mjs';
import { readJson, createFile, bytes, fault } from '../../postgres/publisher/files.mjs';
const HELP=[
'QuestDB workbench',
'  questdb-workbench serve --state DIRECTORY [--source SOURCE.json --merchant MERCHANT.json]',
'  questdb-workbench status',
'  questdb-workbench revision --revision N',
'  questdb-workbench save|compile|discover|preview|capture|compare|product-create --input INPUT.json',
'  questdb-workbench captures [--limit 20 --offset 0]',
'  questdb-workbench capture-status|capture-cancel|capture-recover --capture ID',
'  questdb-workbench product-status --product ID',
'  questdb-workbench product --product ID --action ACTION [--input INPUT.json]',
'  questdb-workbench seller-start|seller-stop --product ID',
'  questdb-workbench run --product ID --run ID',
'  questdb-workbench buyer-offer --product ID --run ID [--query limit=10]',
'  questdb-workbench buyer-prepare --product ID --input BUYER.json',
'  questdb-workbench receive --capture ID --directory CUSTOMER_EDITION','',
'Use QUESTDB_WORKSPACE_URL or --connection PRIVATE_LAUNCH.json for the running original workbench.',
'Capture input: expectedRevision, query, input, stable captureId, optional extraction/includeNativeCsv.',
'Product actions: source, plan, plan/save, extract, extract/start, cancel, review, publish, recover,',
'schedule/status, schedule/save, schedule/enable, schedule/pause, schedule/run, schedule/continue.',
'Extract and schedule/run wait for original completion. extract/start returns the original run ID.',
'Optional --out NEW.json saves the full result. receive reopens the original partial transfer and',
'verifies every source file before completing. compile input is the structured report declaration.',''].join('\n');
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){process.stdout.write(HELP);return;}
  if(args[0]==='serve'){const{main:serve}=await import('./server.mjs');return serve(args.slice(1));}
  const[command,...rest]=args,options={};
  for(let i=0;i<rest.length;i+=2){
    if(!['--connection','--input','--out','--revision','--capture','--product','--action','--run','--query','--limit','--offset','--directory'].includes(rest[i])||
      !rest[i+1]||rest[i+1].startsWith('--')||Object.hasOwn(options,rest[i]))throw fault('QUESTDB_WORKBENCH_ARGUMENT_INVALID',HELP);
    options[rest[i]]=rest[i+1];
  }
  const required=name=>{if(!options[name])throw fault('QUESTDB_WORKBENCH_OPTION_REQUIRED',name);return options[name];};
  const number=(name,fallback)=>{if(options[name]===undefined)return fallback;if(!/^(0|[1-9][0-9]*)$/.test(options[name])||!Number.isSafeInteger(Number(options[name])))throw fault('INTEGER_OPTION_REQUIRED');return Number(options[name]);};
  const input=options['--input']?await readJson(resolve(options['--input']),1048576):{};
  const client=await createQuestDbWorkbenchClient({connectionFile:options['--connection']});
  const actions={status:()=>client.state(),revision:()=>client.revision(number('--revision')),
    save:()=>client.save(input),compile:()=>client.compileReport(input),discover:()=>client.discover(input),
    preview:()=>client.preview(input),capture:()=>client.capture(input),
    captures:()=>client.captures({limit:number('--limit',20),offset:number('--offset',0)}),
    'capture-status':()=>client.captureRecord(required('--capture')),'capture-cancel':()=>client.cancelCapture(required('--capture')),
    'capture-recover':()=>client.recoverCapture(required('--capture')),compare:()=>client.compareCaptures(input),
    'product-create':()=>client.createPublication(input),'product-status':()=>client.publication(required('--product')),
    product:()=>client.publicationCommand(required('--product'),required('--action'),input),
    'seller-start':()=>client.seller(required('--product'),true),'seller-stop':()=>client.seller(required('--product'),false),
    run:()=>client.run(required('--product'),required('--run')),
    'buyer-offer':()=>client.buyerOffer(required('--product'),required('--run'),options['--query']??''),
    'buyer-prepare':()=>client.prepareBuyer(required('--product'),input),
    receive:()=>client.receiveCapture({captureId:required('--capture'),directory:required('--directory')})};
  if(!actions[command])throw fault('QUESTDB_WORKBENCH_COMMAND_INVALID',HELP);
  const result=await actions[command]();
  if(options['--out'])await createFile(resolve(options['--out']),bytes(result));else process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'QUESTDB_WORKBENCH')+': '+error.message+'\n');process.exitCode=1;});
