#!/usr/bin/env node
// MIT. Native MPP operator workflow; launch in the existing governor/key host.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openWorkspace, requireValue, json } from './storage.mjs';
import { merchantConfig, buyerConfig } from './config.mjs';
import { serveWorkspace, serveMerchant, exportResponse } from './server.mjs';
import { preparePurchase, executePurchase, finalizePurchase, purchaseView } from './buyer.mjs';

const HELP='Native Stellar MPP Charge\n\n'+
  'node mpp-charge/cli.mjs runtime-template DEPENDENCY_DIRECTORY\n'+
  'node mpp-charge/cli.mjs init WORKSPACE\n'+
  'node mpp-charge/cli.mjs profile WORKSPACE merchant|buyer CONFIG.json\n'+
  'node mpp-charge/cli.mjs serve WORKSPACE [PORT]\n'+
  'node mpp-charge/cli.mjs merchant WORKSPACE [PORT]\n'+
  'node mpp-charge/cli.mjs prepare WORKSPACE [CHALLENGE_ID]\n'+
  'node mpp-charge/cli.mjs execute|resume|finalize|inspect WORKSPACE PURCHASE_ID\n'+
  'node mpp-charge/cli.mjs recover-delivery WORKSPACE DELIVERY_ID\n'+
  'node mpp-charge/cli.mjs export WORKSPACE purchases|deliveries RECORD_ID ABSOLUTE_OUTPUT\n';
export async function main(argv=process.argv.slice(2)) {
  let workspace;
  try {
    const [command,directory,...rest]=argv;
    if(!command || ['help','--help','-h'].includes(command)){console.log(HELP);return 0;}
    requireValue(typeof directory==='string','MPP_WORKSPACE_REQUIRED');
    if(command==='runtime-template') {
      requireValue(rest.length===0,'MPP_CLI_ARGUMENTS_INVALID');
      const target=resolve(directory);await mkdir(target,{mode:0o700});
      await writeFile(target+'/package.json',await readFile(new URL('./package.json',import.meta.url)),{flag:'wx',mode:0o600});
      await writeFile(target+'/package-lock.json',await readFile(new URL('./package-lock.json',import.meta.url)),{flag:'wx',mode:0o600});
      console.log(json({directory:target,manifest:target+'/package.json',lockfile:target+'/package-lock.json'}));return 0;
    }
    if(command==='serve') {
      requireValue(rest.length<=1,'MPP_CLI_ARGUMENTS_INVALID');
      const app=await serveWorkspace({directory:resolve(directory),port:rest[0]===undefined?8787:Number(rest[0])});
      console.log('Private operator workspace: '+app.url);
      await waitForStop(app.close);return 0;
    }
    workspace=await openWorkspace(resolve(directory),{create:command==='init'});
    let result;
    if(command==='init'){requireValue(rest.length===0,'MPP_CLI_ARGUMENTS_INVALID');result=await workspace.metadata();}
    else if(command==='profile') {
      requireValue(rest.length===2 && ['merchant','buyer'].includes(rest[0]),'MPP_PROFILE_ARGUMENTS_INVALID');
      const raw=await readFile(resolve(rest[1]));requireValue(raw.length<=2*1024*1024,'MPP_PROFILE_TOO_LARGE');
      const input=JSON.parse(raw.toString('utf8'));
      const profile=rest[0]==='merchant'?merchantConfig(input):buyerConfig(input);
      result=await workspace.configure(rest[0],profile,(await workspace.metadata()).revision);
    } else if(command==='merchant') {
      requireValue(rest.length<=1,'MPP_CLI_ARGUMENTS_INVALID');
      const app=await serveMerchant({workspace,profile:await workspace.profile('merchant'),
        port:rest[0]===undefined?8788:Number(rest[0])});
      console.log('Merchant listener: http://127.0.0.1:'+app.port);
      await waitForStop(app.close);return 0;
    } else if(command==='prepare') {
      requireValue(rest.length<=1,'MPP_CLI_ARGUMENTS_INVALID');
      result=await preparePurchase({workspace,profile:await workspace.profile('buyer'),challengeId:rest[0]});
    } else if(['execute','resume','finalize','inspect'].includes(command)) {
      requireValue(rest.length===1,'MPP_PURCHASE_ID_REQUIRED');
      const purchaseId=rest[0];
      if(command==='inspect') result=purchaseView(await workspace.read('purchases',purchaseId));
      else if(command==='finalize') result=await finalizePurchase({workspace,purchaseId});
      else result=await executePurchase({workspace,purchaseId,resume:command==='resume'});
    } else if(command==='recover-delivery') {
      requireValue(rest.length===1,'MPP_DELIVERY_ID_REQUIRED');
      const {createMerchant}=await import('./merchant.mjs');
      const previous=await workspace.read('deliveries',rest[0]);
      requireValue(previous,'MPP_DELIVERY_NOT_FOUND',404);
      const profile=await workspace.read('profiles',previous.profileId);
      requireValue(profile,'MPP_ORIGINAL_MERCHANT_PROFILE_REQUIRED',409);
      const merchant=await createMerchant({workspace,profile});
      const row=await merchant.recover(rest[0]);
      result={id:row.id,state:row.state,transaction:row.transaction,response:row.response?{
        status:row.response.status,bytes:row.response.bytes,sha256:row.response.sha256}:null};
    } else if(command==='export') {
      requireValue(rest.length===3,'MPP_EXPORT_ARGUMENTS_INVALID');
      result=await exportResponse({workspace,group:rest[0],recordId:rest[1],destination:rest[2]});
    } else requireValue(false,'MPP_COMMAND_UNKNOWN');
    console.log(json(result));return 0;
  } catch(error) {
    console.error(JSON.stringify({error:error.code??'MPP_COMMAND_FAILED'}));return 2;
  } finally{await workspace?.close();}
}
function waitForStop(close) {
  return new Promise(resolveStop=>{
    let closing=false;
    const stop=async()=>{if(closing)return;closing=true;await close();resolveStop();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  });
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) process.exitCode=await main();
