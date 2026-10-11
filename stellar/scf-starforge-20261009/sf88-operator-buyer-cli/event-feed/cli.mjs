#!/usr/bin/env node
// MIT — Original SF88 event-feed subscriber commands.
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubscription, openSubscription } from './subscriber.mjs';
import { safeCode } from '../node/store.mjs';

const help = [
  'Starforge event-feed buyer',
  '',
  'init --dir DIR --config ORIGINAL_BUYER_JSON --feed FEED [--id NAME]',
  '     [--page-size 100] [--runtime SF88_DIR] [--buyer-state DIR]',
  '     [--cursor CURSOR --after-sequence N]',
  'sync --dir DIR [--max-pages N]',
  'recover --dir DIR',
  'inspect --dir DIR [--limit N]',
  'export --dir DIR --out EVENTS.ndjson',
  'workspace --dir DIR [--port 0]',
  '',
  'sync collects one fixed sequence window through the original buyer.',
  'Another sync collects events received since the last completed window.',
  'recover reads the same recorded operation and retained response.',
  'export writes an immutable NDJSON file and its matching manifest.',
  'The existing operator policy, signer and payment journal govern each page.'
].join('\n');

function options(args,allowed) {
  const selected={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i],value=args[i+1];
    if(!allowed.includes(key)||Object.hasOwn(selected,key)||!value||value.startsWith('--'))
      throw Object.assign(new Error('Invalid option'),{code:'FEED_CLI_OPTION_INVALID'});
    selected[key]=value;
  }
  return selected;
}
function number(value,fallback) {
  if(value===undefined)return fallback;
  if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))
    throw Object.assign(new Error('Invalid number'),{code:'FEED_CLI_NUMBER_INVALID'});
  return Number(value);
}
function required(value) {
  if(!value)throw Object.assign(new Error('Required option missing'),{code:'FEED_CLI_OPTION_REQUIRED'});
  return value;
}
export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args;
  if(!command||command==='--help'||command==='help'||rest.includes('--help')) {
    process.stdout.write(help+'\n'); return;
  }
  const allowed={
    init:['--dir','--config','--feed','--id','--page-size','--runtime','--buyer-state','--cursor','--after-sequence'],
    sync:['--dir','--max-pages'],recover:['--dir'],inspect:['--dir','--limit'],
    export:['--dir','--out'],workspace:['--dir','--port']
  };
  if(!allowed[command])throw Object.assign(new Error('Unknown command'),{code:'FEED_CLI_COMMAND_INVALID'});
  const selected=options(rest,allowed[command]);
  const directory=resolve(required(selected['--dir']));
  if(command==='workspace') {
    const {serveWorkspace}=await import('./workspace.mjs');
    const service=await serveWorkspace({directory,port:number(selected['--port'],0)});
    process.stdout.write(JSON.stringify({url:service.url,directory})+'\n');
    const stop=()=>service.close().catch(()=>{process.exitCode=1;});
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    return;
  }
  let subscription;
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    subscription=command==='init'
      ? await createSubscription({directory,config:resolve(required(selected['--config'])),
          runtimeDirectory:resolve(selected['--runtime']??fileURLToPath(new URL('../',import.meta.url))),
          buyerStateDirectory:resolve(selected['--buyer-state']??join(directory,'original-buyer')),
          id:selected['--id']??required(selected['--feed']),feedId:required(selected['--feed']),
          pageSize:number(selected['--page-size'],100),startCursor:selected['--cursor']??null,
          afterSequence:number(selected['--after-sequence'],0)})
      :await openSubscription(directory);
    const result=command==='sync'
      ?await subscription.collect({signal:controller.signal,maxPages:number(selected['--max-pages'],Number.MAX_SAFE_INTEGER)})
      :command==='recover'?await subscription.recover({signal:controller.signal})
      :command==='export'?await subscription.exportEvents(resolve(required(selected['--out'])))
      :subscription.inspect({limit:number(selected['--limit'],20)});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(command==='sync'&&!['CAUGHT_UP','PAGE_LIMIT_REACHED'].includes(result.state))process.exitCode=2;
  } finally {
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    subscription?.close();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error?.code,'EVENT_FEED_COMMAND_FAILED')})+'\n');
    process.exitCode=1;
  });
