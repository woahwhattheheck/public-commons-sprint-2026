#!/usr/bin/env node
// MIT. Native original historical source acquisition for the existing receiving operation.
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export const HELP=String.raw`Original ledger interval and source selection

  capture-ledger-interval capture --source-root ROOT --output NEW_DIRECTORY
    --start-ledger FIRST --before-ledger EXCLUSIVE_END
    [--baseline-options ORIGINAL_CAPTURE_OPTIONS.json] [--page-size 8] [--resume]

  capture-ledger-interval reselect --source-root ROOT --output EXISTING_HISTORY
    [--address ORIGINAL_PROVIDER ...] [--account ORIGINAL_ACCOUNT ...]
    [--contract ORIGINAL_GIVECREDIT_CONTRACT ...] [--fetch-closures]

  capture-ledger-interval selected --source-root ROOT --output NEW_DIRECTORY
    --ledger ORIGINAL_LEDGER [--ledger ORIGINAL_LEDGER ...]
    [--selection-file ORIGINAL_NATIVE_SELECTION.json]
    [--baseline-options ORIGINAL_CAPTURE_OPTIONS.json] [--resume]

  selected also accepts --selection-file JSON --selection-pointer /selected
    [--ledger-field ledger] instead of repeated --ledger values.

Shared options:
  --sdk-module EXISTING_STELLAR_SDK.mjs  --rpc-url ORIGINAL_PUBLIC_ARCHIVE_RPC
  --network mainnet|testnet             --network-passphrase ORIGINAL_PASSPHRASE
  --operation ORIGINAL_OPERATION        --timeout-ms 60000
  --account G_ADDRESS ...               --contract C_ADDRESS ...
  --address SOURCE_OBSERVED_ADDRESS ... --options PRIVATE_OPERATION_OPTIONS.json

The interval includes FIRST and excludes EXCLUSIVE_END. Capture retains every
original RPC exchange and follows the provider cursor across the exact interval.
The default archive is the public Lightsail full-history RPC. No transaction is sent.

Reselect reads completed original pages locally; --fetch-closures obtains complete
one-ledger responses for newly selected ledgers. Selected acquires only the actual
ledger list found by an existing native history/checkpoint scan. It retains the full
selection file and each complete original response, keeping source scopes separate.

All output stays under the private received source root and enters the complete
native archive. New outputs are create-only. --resume continues the same selection.
Additional source addresses select original records without adding those addresses
to the GiveCredit contract classification or Horizon account list.

The final capture-options path feeds the existing receive-native.mjs --capture-options
or GiveCredit capture-ledger command. Keep earlier live checkpoints separate when
this source selection changes.
`;

function need(value,message){if(!value)throw new Error(message);}
function parse(args){
  const mode=args[0]&&!args[0].startsWith('--')?args.shift():'capture',options={mode};
  const flags={'--resume':'resume','--fetch-closures':'fetchClosures','--help':'help'};
  const names={'--source-root':'sourceRoot','--output':'output','--sdk-module':'sdkModule',
    '--start-ledger':'startLedger','--before-ledger':'beforeLedger','--page-size':'pageSize',
    '--baseline-options':'baselineOptionsFile','--rpc-url':'rpcUrl','--network':'network',
    '--network-passphrase':'networkPassphrase','--operation':'operation','--timeout-ms':'timeoutMs',
    '--selection-file':'sourceSelectionFile','--selection-pointer':'selectionPointer','--ledger-field':'ledgerField','--options':'optionsFile'};
  const repeated={'--ledger':'ledgers','--address':'addresses','--account':'accounts','--contract':'contractIds'};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(flags[key]){options[flags[key]]=true;continue;}
    need(names[key]||repeated[key],'Choose a named option from --help.');
    const value=args[++i];need(value&&!value.startsWith('--'),'Provide the original value for '+key+'.');
    if(repeated[key])(options[repeated[key]]??=[]).push(value);else options[names[key]]=value;
  }
  return options;
}
function pointer(document,path){
  need(typeof path==='string'&&(path===''||path.startsWith('/')),'Use an exact JSON pointer for the original selection array.');
  let value=document;
  for(const raw of path===''?[]:path.slice(1).split('/')){
    need(!/~(?![01])/.test(raw),'Keep a valid original JSON pointer.');
    const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');
    need(value!==null&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key),'The original selection pointer is absent.');
    value=value[key];
  }
  return value;
}

/** Operate the existing source-owned interval helper; return complete native paths. */
export async function prepareLedgerInterval(options={}){
  let input={};
  if(options.optionsFile){
    input=JSON.parse(await readFile(resolve(options.optionsFile),'utf8'));
    need(input&&typeof input==='object'&&!Array.isArray(input),'Use one native operation option object.');
  }
  const effective={...input,...Object.fromEntries(Object.entries(options).filter(([,value])=>value!==undefined))};
  need(effective.sourceRoot&&effective.output,'Select the original received source root and private historical output directory.');
  const root=resolve(effective.sourceRoot),partner=join(root,'stellar/scf-starforge-20261009/partners/cfce-givecredit-statements');
  const [{captureLedgerInterval,selectLedgerInterval,captureLedgerSelection},{parseNativeJSON}]=await Promise.all([
    import(pathToFileURL(join(partner,'history.mjs')).href),import(pathToFileURL(join(partner,'source.mjs')).href),
  ]);
  if(effective.selectionPointer!==undefined){
    need(effective.sourceSelectionFile&&!effective.ledgers?.length,'Select either the exact original selection array or explicit ledger values.');
    const original=parseNativeJSON(await readFile(resolve(effective.sourceSelectionFile),'utf8'));
    const rows=pointer(original,effective.selectionPointer);
    need(Array.isArray(rows),'The original source selection pointer must resolve to an array.');
    const field=effective.ledgerField||'ledger';
    effective.ledgers=rows.map(row=>{
      const value=row&&typeof row==='object'&&!Array.isArray(row)?row[field]:row;
      need(value!==null&&value!==undefined&&/^[1-9]\d*$/.test(String(value)),'Every original selected row must retain its native ledger.');
      return String(value);
    });
  }
  for(const name of ['pageSize','timeoutMs'])if(effective[name]!==undefined){
    const number=Number(effective[name]);need(Number.isSafeInteger(number)&&number>0,'Use an exact positive '+name+'.');effective[name]=number;
  }
  const mode=effective.mode||'capture';
  need(['capture','reselect','selected'].includes(mode),'Choose capture, reselect or selected.');
  return (mode==='capture'?captureLedgerInterval:mode==='reselect'?selectLedgerInterval:captureLedgerSelection)(effective);
}

export async function main(args=process.argv.slice(2)){
  const options=parse([...args]);
  if(options.help||['help','--help','-h'].includes(options.mode)){process.stdout.write(HELP);return;}
  const abort=new AbortController(),stop=()=>abort.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await prepareLedgerInterval({...options,signal:abort.signal,
      onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||error.name||'HISTORY_SOURCE',
    message:error.message,checkpoint:error.checkpoint||null,rpcCode:error.rpcCode??null,retryAfter:error.retryAfter??null}})+'\n');process.exitCode=1;});
