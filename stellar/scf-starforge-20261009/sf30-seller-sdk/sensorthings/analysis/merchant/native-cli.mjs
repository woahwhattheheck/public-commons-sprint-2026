#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Attach only to the owner's explicitly selected existing Chromium page.
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../../../stellar-expert/store.mjs';
import {parseExactJSON} from '../../../stellar-expert/exact-json.mjs';
import {json,fault} from '../../contract.mjs';
import {runMerchantDelivery} from './native-journey.mjs';
const HELP=[
  'Continue the original reviewed-publication delivery on an existing browser.',
  'node analysis/merchant/native-cli.mjs --input ABS_ORIGINAL_JSON',
  '  [--receiving ABS_SAVED_OUTPUT_JSON] --playwright-module ABS_EXISTING_MODULE',
  '  --browser-endpoint-file ABS_PRIVATE_CDP_URL_FILE --page-origin ORIGINAL_ORIGIN',
  '',
  'The original browser owner must yield the selected page before this command.',
  'Exactly one existing page must match --page-origin. No browser or page is created.',
  'The CDP endpoint is read from its private file and is never printed.',
  'The browser connection is disconnected on completion; the original host remains owner.',
  'For an existing in-process Playwright owner, call runMerchantDelivery(input,{page,...}) directly.',
  'Use the same input/control directory and saved native operation after interruption.'
].join('\n');
function fail(message){throw fault('ANALYSIS_MERCHANT_NATIVE_CLI',message,422);}
async function read(path,max){
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)fail('Use an exact absolute original host file.');
  return new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(path,max));
}
async function input(path){const raw=await read(path,2*1024*1024);parseExactJSON(raw);return JSON.parse(raw);}
export async function main(argv=process.argv.slice(2),{emit=value=>process.stdout.write(json(value)),environment=process.env}={}){
  if(!argv.length||argv.includes('--help')){process.stdout.write(HELP+'\n');return null;}
  const options={},allowed=['input','receiving','playwright-module','browser-endpoint-file','page-origin'];
  for(let i=0;i<argv.length;i+=2){
    if(!argv[i].startsWith('--')||!allowed.includes(argv[i].slice(2))||Object.hasOwn(options,argv[i].slice(2))||!argv[i+1]||argv[i+1].startsWith('--'))fail('Use the advertised exact --name value arguments.');
    options[argv[i].slice(2)]=argv[i+1];
  }
  for(const key of allowed.filter(k=>k!=='receiving'))if(!options[key])fail('Supply --'+key+'.');
  const request=await input(options.input),receiving=options.receiving?await input(options.receiving):null;
  const endpoint=(await read(options['browser-endpoint-file'],4096)).trim(),url=new URL(endpoint);
  if(!['http:','ws:'].includes(url.protocol)||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.hash)
    fail('Use the owner-selected existing loopback Chromium CDP endpoint.');
  const pageOrigin=new URL(options['page-origin']);
  if(pageOrigin.origin!==options['page-origin']||!['http:','https:'].includes(pageOrigin.protocol))fail('Select the exact existing page origin.');
  const modulePath=options['playwright-module'];
  if(!isAbsolute(modulePath)||resolve(modulePath)!==modulePath)fail('Use the actual already installed Playwright module path.');
  const module=await import(pathToFileURL(modulePath).href),chromium=module.chromium??module.default?.chromium;
  if(typeof chromium?.connectOverCDP!=='function')fail('The selected original module has no Chromium CDP connection API.');
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Original continuation interrupted.'));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let browser;
  try{
    controller.signal.throwIfAborted();browser=await chromium.connectOverCDP(endpoint,{timeout:30000});
    const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>{
      try{return new URL(page.url()).origin===pageOrigin.origin;}catch{return false;}
    });
    if(pages.length!==1)fail('The existing browser must contain exactly one page at the selected origin; preserve all original tabs.');
    const result=await runMerchantDelivery(request,{page:pages[0],receiving,signal:controller.signal,
      progress:value=>process.stderr.write(json({progress:value}))});
    emit(result);return result;
  }finally{
    // Closing a connected Playwright Browser disconnects this client.
    // No browser-server process, context or page is explicitly terminated here.
    try{await browser?.close();}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(json({error:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'ANALYSIS_MERCHANT_NATIVE_UNRESOLVED',
    message:'The original continuation did not complete. Retain its control directory, exact request files and original workspace operations.',
    operationId:typeof error.operationId==='string'?error.operationId:null}));process.exitCode=1;
});
