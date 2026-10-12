#!/usr/bin/env node
// MIT. Complete local Freighter operator workflow.
import { pathToFileURL } from 'node:url';
import { prepareBrowserWallet, inspectWalletWorkspace, executeWalletOperation } from './workspace.mjs';
import { startWalletServer, recoverWalletLock } from './server.mjs';
import { requireValue } from './common.mjs';

export const usage = [
  'browser-wallet prepare --buyer-config /private/operator/operator.json --out /private/new-wallet [--rpc https://rpc.example] [--request-lifetime-ms 120000]',
  'browser-wallet serve --workspace /private/wallet [--port 0]',
  'browser-wallet inspect --workspace /private/wallet',
  'browser-wallet execute --workspace /private/wallet --operator-workspace /private/operator',
  'browser-wallet recover-lock --workspace /private/wallet --instance ORIGINAL_INSTANCE_ID',
].join('\n');
function options(args,allowed) {
  requireValue(args.length%2===0,'WALLET_OPTION_REQUIRES_VALUE');
  const out={};
  for(let i=0;i<args.length;i+=2) {
    requireValue(allowed.includes(args[i]) && !Object.hasOwn(out,args[i]) &&
      typeof args[i+1]==='string' && args[i+1].length>0,'WALLET_OPTION_INVALID');
    out[args[i]]=args[i+1];
  }
  return out;
}
const number=(value,fallback)=>{
  if(value===undefined) return fallback;
  requireValue(/^(0|[1-9][0-9]*)$/.test(value),'WALLET_NUMBER_INVALID');
  const n=Number(value);requireValue(Number.isSafeInteger(n),'WALLET_NUMBER_INVALID');return n;
};
export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args;
  if(!command || ['help','--help','-h'].includes(command)) {
    process.stdout.write(usage+'\n');return {state:'HELP'};
  }
  let result;
  if(command==='prepare') {
    const o=options(rest,['--buyer-config','--out','--rpc','--request-lifetime-ms']);
    result=await prepareBrowserWallet({buyerConfig:o['--buyer-config'],output:o['--out'],
      rpcUrl:o['--rpc'],requestLifetimeMs:number(o['--request-lifetime-ms'],120000)});
  } else if(command==='serve') {
    const o=options(rest,['--workspace','--port']);
    const server=await startWalletServer({directory:o['--workspace'],port:number(o['--port'],0)});
    // URL is a local capability. Print it only in the operator's private terminal.
    process.stdout.write(JSON.stringify({state:'LISTENING',walletId:server.walletId,
      instanceId:server.instanceId,url:server.url,workspace:o['--workspace']},null,2)+'\n');
    let done;
    const stopped=new Promise(resolve=>{done=resolve;});
    const close=()=>{
      server.close().then(done,error=>{
        process.stderr.write((error.code??'WALLET_SHUTDOWN_FAILED')+'\n');process.exitCode=1;done();
      });
    };
    process.once('SIGINT',close);process.once('SIGTERM',close);
    await stopped;
    process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);
    return {state:'CLOSED'};
  } else if(command==='inspect') {
    const o=options(rest,['--workspace']);result=await inspectWalletWorkspace(o['--workspace']);
  } else if(command==='recover-lock') {
    const o=options(rest,['--workspace','--instance']);
    result=await recoverWalletLock(o['--workspace'],o['--instance']);
  } else if(command==='execute') {
    const o=options(rest,['--workspace','--operator-workspace']);
    const controller=new AbortController();
    const interrupt=()=>controller.abort('SIGINT'),terminate=()=>controller.abort('SIGTERM');
    process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
    try {
      result=await executeWalletOperation({directory:o['--workspace'],
        operatorWorkspace:o['--operator-workspace'],signal:controller.signal});
      if(result.exitCode) process.exitCode=result.exitCode;
    } finally {process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);}
  } else throw Object.assign(new Error('WALLET_UNKNOWN_COMMAND'),{code:'WALLET_UNKNOWN_COMMAND'});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{
    process.stderr.write((/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?
      error.code:'WALLET_COMMAND_FAILED')+'\n');process.exitCode=1;
  });
}
