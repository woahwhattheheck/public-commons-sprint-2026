#!/usr/bin/env node
// MIT. One operator surface for the original SDK selection and native buyer lifecycle.
import { parseArgs } from 'node:util';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, readJson, jsonBytes, privateDirectory, safeCode
} from '../../sf88-operator-buyer-cli/node/store.mjs';
import { prepareSafeSelection, preparePalmeraSelection, openSelection, describeSelection, exactWrite
} from './transaction.mjs';
import { prepareSafePurchase, openPreparedPurchase } from './preparation.mjs';
import { SafeSimulationBuyer } from './workspace.mjs';
import { openHandover, describeHandover, receiveHandover } from './handover.mjs';
import { startAnalysisWorkspace } from '../../sf88-operator-buyer-cli/tenderly-analysis/server.mjs';

export const HELP='Safe / Palmera original transaction review\n\n'+
'Capture and prepare\n'+
'  capture --module FILE --context FILE --out DIRECTORY [--label TEXT]\n'+
'  selection --directory DIRECTORY\n'+
'  prepare --selection DIRECTORY --plan FILE --ticket FILE --intent ID --out DIRECTORY\n'+
'  prepared --directory DIRECTORY\n\n'+
'Original native buyer (all require --state DIRECTORY --runtime DIRECTORY)\n'+
'  import --config FILE --selection DIRECTORY --merchant-selection FILE [--operator-profile FILE]\n'+
'  import-prepared --directory DIRECTORY [--operator-profile FILE]\n'+
'  attach --intent ID --selection DIRECTORY --merchant-selection FILE\n'+
'  review --intent ID --out FILE\n'+
'  execute --intent ID --review FILE\n'+
'  recover --intent ID\n'+
'  inspect --intent ID\n'+
'  list\n'+
'  analyze --intent ID --analysis DIRECTORY\n'+
'  compare --before ID --after ID --analysis DIRECTORY [--title TEXT] [--notes FILE]\n'+
'  handover --intent ID --analysis DIRECTORY --out DIRECTORY\n\n'+
'Portable review (no buyer state or operator profile required)\n'+
'  open --directory DIRECTORY\n'+
'  receive --from DIRECTORY --out DIRECTORY --analysis DIRECTORY\n'+
'  serve --analysis DIRECTORY [--port PORT]\n\n'+
'Use absolute paths. The capture module exports async loadTransaction({context}) and returns\n'+
'{palmera, transaction} or {safe, transaction}; optional label, origin and close remain caller-owned.\n'+
'Purchase execution requires the saved original review and the original buyer operator configuration.\n';

const valueOptions=['module','context','out','label','directory','selection','plan','ticket','intent',
  'state','runtime','config','merchant-selection','operator-profile','review','analysis','before',
  'after','title','notes','from','port'];
const native=['state','runtime'];
const permitted={
  capture:['module','context','out','label'],selection:['directory'],
  prepare:['selection','plan','ticket','intent','out'],prepared:['directory'],
  import:[...native,'config','selection','merchant-selection','operator-profile'],
  'import-prepared':[...native,'directory','operator-profile'],
  attach:[...native,'intent','selection','merchant-selection'],
  review:[...native,'intent','out'],execute:[...native,'intent','review'],
  recover:[...native,'intent'],inspect:[...native,'intent'],list:native,
  analyze:[...native,'intent','analysis'],
  compare:[...native,'before','after','analysis','title','notes'],
  handover:[...native,'intent','analysis','out'],
  open:['directory'],receive:['from','out','analysis'],serve:['analysis','port']
};
function required(options,name) { need(typeof options[name]==='string'&&options[name].length>0,'SAFE_CLI_'+name.toUpperCase().replaceAll('-','_')+'_REQUIRED');return options[name]; }
const path=(options,name)=>absolute(required(options,name));
async function outputFile(file,value) {
  file=absolute(file);await privateDirectory(dirname(file));
  await exactWrite(file,jsonBytes(value));return file;
}
function client(options) {
  return new SafeSimulationBuyer({runtimeDirectory:path(options,'runtime'),stateDirectory:path(options,'state'),
    ...(options.analysis?{analysisWorkspace:path(options,'analysis')}:{})});
}
async function withAbort(work) {
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try { return await work(controller.signal); }
  finally { process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop); }
}
async function completed(buyer,id) {
  const result=await buyer.operation(id).recover();
  need(result,'SAFE_COMPLETE_RESULT_REQUIRED');return result;
}
export async function runCLI(argv=process.argv.slice(2),{write=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')}={}) {
  const parsed=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:Object.fromEntries([...valueOptions.map(name=>[name,{type:'string'}]),['help',{type:'boolean',short:'h'}]])});
  const options=parsed.values,command=parsed.positionals[0];
  if(options.help||command===undefined) {process.stdout.write(HELP);return null;}
  need(parsed.positionals.length===1&&Object.hasOwn(permitted,command),'SAFE_CLI_COMMAND_INVALID');
  need(Object.keys(options).every(name=>permitted[command].includes(name)),'SAFE_CLI_OPTION_NOT_USED_BY_COMMAND');
  let result;
  if(command==='capture') {
    const context=Object.freeze(await readJson(path(options,'context')));
    const factory=await import(pathToFileURL(path(options,'module')).href);
    need(typeof factory.loadTransaction==='function','SAFE_CALLER_TRANSACTION_FACTORY_REQUIRED');
    const source=await factory.loadTransaction({context});
    try {
      need(source&&source.transaction&&Boolean(source.palmera)!==Boolean(source.safe),'SAFE_CALLER_TRANSACTION_RESULT_REQUIRED');
      const args={directory:path(options,'out'),transaction:source.transaction,context,
        label:options.label??source.label??'',origin:source.origin??{}};
      const selected=source.palmera?await preparePalmeraSelection({...args,palmera:source.palmera}):
        await prepareSafeSelection({...args,safe:source.safe});
      result=describeSelection(selected);
    } finally { if(typeof source?.close==='function')await source.close(); }
  } else if(command==='selection') result=describeSelection(await openSelection(path(options,'directory')));
  else if(command==='prepare') result=await prepareSafePurchase({selectionDirectory:path(options,'selection'),
    planFile:path(options,'plan'),ticketFile:path(options,'ticket'),intentId:required(options,'intent'),directory:path(options,'out')});
  else if(command==='prepared') result=await openPreparedPurchase(path(options,'directory'));
  else if(command==='open') result=describeHandover(await openHandover(path(options,'directory')));
  else if(command==='receive') result=await receiveHandover(path(options,'from'),{
    directory:path(options,'out'),workspace:path(options,'analysis')});
  else if(command==='serve') {
    const port=options.port===undefined?0:Number(options.port);
    need(Number.isInteger(port)&&port>=0&&port<=65535&&
      (options.port===undefined||/^(0|[1-9][0-9]{0,4})$/.test(options.port)),'SAFE_CLI_PORT_INVALID');
    const active=await startAnalysisWorkspace({workspace:path(options,'analysis'),port});
    write({state:'RUNNING',url:active.url,workspace:path(options,'analysis')});
    await new Promise(resolve=>{
      const close=()=>{process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);resolve();};
      process.once('SIGINT',close);process.once('SIGTERM',close);
    });
    await active.close();return {state:'CLOSED'};
  } else {
    const buyer=client(options);
    if(command==='import') {
      const operation=await withAbort(signal=>buyer.fromConfig(path(options,'config'),{
        selectionDirectory:path(options,'selection'),merchantSelection:path(options,'merchant-selection'),
        ...(options['operator-profile']?{operatorProfile:path(options,'operator-profile')}:{}),signal}));
      result=await operation.inspect();
    } else if(command==='import-prepared') {
      const operation=await withAbort(signal=>buyer.fromPrepared(path(options,'directory'),{
        ...(options['operator-profile']?{operatorProfile:path(options,'operator-profile')}:{}),signal}));
      result=await operation.inspect();
    } else if(command==='attach') result=await (await buyer.attach(required(options,'intent'),{
      selectionDirectory:path(options,'selection'),merchantSelection:path(options,'merchant-selection')})).inspect();
    else if(command==='list') {
      result=[];for await(const operation of buyer.list())result.push(await operation.inspect());
    } else if(command==='compare') {
      let notes='';
      if(options.notes) {
        const {readBytes}=await import('../../sf88-operator-buyer-cli/node/store.mjs');
        const bytes=await readBytes(path(options,'notes'),80000);
        notes=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      }
      result=await buyer.compare(required(options,'before'),required(options,'after'),{title:options.title??'',notes});
    } else {
      const id=required(options,'intent'),operation=buyer.operation(id);
      if(command==='review') {
        const review=await operation.review();
        result={reviewFile:await outputFile(path(options,'out'),review),review};
      } else if(command==='execute') {
        const review=await readJson(path(options,'review'),4*1024*1024);
        const received=await withAbort(signal=>operation.execute({review,signal}));
        result=await received.summary();
      } else if(command==='recover') {
        const received=await operation.recover();
        result=received?await received.summary():{intentId:id,state:'NO_COMPLETED_RESULT'};
      } else if(command==='inspect') result=await operation.inspect();
      else if(command==='analyze') {
        const capture=await (await completed(buyer,id)).analyze();
        result={intentId:id,captureId:capture.record.id,directory:capture.directory,record:capture.record};
      } else if(command==='handover') result=await withAbort(async signal=>
        (await completed(buyer,id)).export(path(options,'out'),{signal}));
    }
  }
  write(result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  runCLI().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'SAFE_REVIEW_COMMAND_FAILED'),
      ...(Number.isInteger(error.exitCode)?{exitCode:error.exitCode}:{})})+'\n');
    process.exitCode=1;
  });
}
