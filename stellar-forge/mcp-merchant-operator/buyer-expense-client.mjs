// MIT. Typed customer operation and retained downloads over the existing MCP transport.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { BUYER_EXPENSE_ACTIONS, validateBuyerExpenseArguments, PREFIX } from './buyer-expense-protocol.mjs';
import { BUYER_EXPENSE_MANIFEST, parseBuyerExpenseExport } from './buyer-expenses.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';

export const buyerExpenseActions = BUYER_EXPENSE_ACTIONS;
export async function openBuyerExpenseClient(options={}) {
  const original=await openMerchantFileClient({...options,errorPrefix:'BUYER_EXPENSE',clientName:'starforge-buyer-expenses'});
  const call=async(action,args,requestOptions)=>{
    validateBuyerExpenseArguments(action,args);
    return original.call(PREFIX+action,args,requestOptions);
  };
  const named=Object.fromEntries(Object.keys(BUYER_EXPENSE_ACTIONS).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={},requestOptions)=>call(action,args,requestOptions)]));
  return Object.freeze({endpoint:original.endpoint,call,...named});
}
const downloads=createRetainedDownload({
  manifestName:BUYER_EXPENSE_MANIFEST,
  parseManifest:parseBuyerExpenseExport,
  maximumBytes:256_000_000,
  stateSchema:'stellar-forge.buyer-expense-download.v1',
  resultSchema:'stellar-forge.buyer-expense-download-result.v1',
  toolPrefix:PREFIX.slice(0,-1),
  errorPrefix:'BUYER_EXPENSE',
  clientName:'starforge-buyer-expense-download',
  describe:manifest=>({workspace:manifest.workspace,workspaceId:manifest.workspaceId,revision:manifest.revision,kind:manifest.kind})
});
export const downloadBuyerExpenseExport=downloads.download;
export const inspectBuyerExpenseExport=downloads.inspect;

/** Fixed native receiver; arguments select an approved original ZIP and a new local destination. */
export async function receiveBuyerExpenseProject({archive,directory,expectedSha256,python='python3'}={}) {
  if(typeof archive!=='string'||typeof directory!=='string'||typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha256))
    throw Object.assign(new Error('Select the exact complete project, reviewed SHA256 and private destination.'),{code:'BUYER_EXPENSE_RECEIVING_ARGUMENTS'});
  if(typeof python!=='string'||python.includes('\0')||(python!=='python3'&&!python.startsWith('/')))
    throw Object.assign(new Error('Select python3 or an absolute Python interpreter path.'),{code:'BUYER_EXPENSE_RECEIVING_ARGUMENTS'});
  const script=fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/receive.py',import.meta.url));
  const child=spawn(python,[script,'--archive',archive,'--directory',directory,'--expected-sha256',expectedSha256],{shell:false,stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
    let out='',err='';child.stdout.on('data',b=>{if(out.length<100000)out+=b.toString('utf8');});
    child.stderr.on('data',b=>{if(err.length<4000)err+=b.toString('utf8');});
    child.once('error',()=>reject(Object.assign(new Error('The selected Python runtime could not start the native receiver.'),{code:'BUYER_EXPENSE_RECEIVING_START'})));
    child.once('exit',code=>{
      if(code!==0){reject(Object.assign(new Error(err.trim()||'Native receiving did not complete; retain its partial destination for the same archive.'),{code:'BUYER_EXPENSE_RECEIVING_FAILED'}));return;}
      try{const result=JSON.parse(out);if(result.state!=='RECEIVED'||result.archive_sha256!==expectedSha256)throw new Error('Result identity');resolve(result);}
      catch{reject(Object.assign(new Error('Native receiving returned an invalid completion record.'),{code:'BUYER_EXPENSE_RECEIVING_RESULT'}));}
    });
  });
}
