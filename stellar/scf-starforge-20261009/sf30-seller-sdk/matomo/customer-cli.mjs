#!/usr/bin/env node
// MIT. Installed command for the ORIGINAL Matomo Python customer.
import {spawn} from 'node:child_process';
import {constants as osConstants} from 'node:os';
import {delimiter,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const SDK=dirname(fileURLToPath(new URL('.',import.meta.url)));
const BUYER=fileURLToPath(new URL('../../sf88-operator-buyer-cli/python',import.meta.url));
const COMMANDS=Object.freeze({
  receive:{required:['archive','out'],optional:[]},
  reopen:{required:['out'],optional:[]},
  rows:{required:['out'],optional:[]},
  pack:{required:['scan','operator-evidence','out'],optional:[]},
  'from-scan':{required:['scan','out'],optional:[]}
});
const help=String.raw`Matomo customer receiving

Usage:
  starforge matomo-customer receive --archive HANDOVER_ZIP --out PRIVATE_DIRECTORY
  starforge matomo-customer reopen --out PRIVATE_DIRECTORY
  starforge matomo-customer rows --out PRIVATE_DIRECTORY
  starforge matomo-customer pack --scan ORIGINAL_SCAN_JSON --operator-evidence DIRECTORY --out NEW_ZIP
  starforge matomo-customer from-scan --scan ORIGINAL_SCAN_JSON --out PRIVATE_SOURCE_DIRECTORY

Options:
  --python EXECUTABLE  Existing Python interpreter (default: MATOMO_PYTHON or python3)
  --node EXECUTABLE    Existing Node used by the original SF100 verifier (default: this Node)
  --help, -h          Show this help without opening a workspace or interpreter

receive verifies the original handover, native SF100 page chain, operator evidence
and complete source-file inventory. Repeating it opens the same completed directory
only when the archive identity matches. reopen verifies that retained customer again.
rows streams exact original report JSONL bytes to stdout; summaries and errors retain
the original Python command's format and exit status.

pack preserves the exact operator records behind the finalized scan's evidence hashes.
from-scan restores a verified native DatasetDelivery source-file projection.

The installed command provides the original SDK and Buyer Python import roots.
It installs no dependency and performs no provider request, purchase or settlement.
Use a private destination outside the installed source. Relative paths are interpreted
from the caller's working directory before the original receiver validates them.
`;

function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function executable(value,name) {
  if(typeof value!=='string'||!value.length||/[\x00-\x1f\x7f]/.test(value))
    fail('MATOMO_CUSTOMER_EXECUTABLE_REQUIRED','Choose an existing '+name+' executable.');
  return isAbsolute(value)||value.includes('/')||value.includes('\\')?resolve(value):value;
}
export function prepareMatomoCustomerCommand(argv,{environment=process.env}={}) {
  const {values,positionals,tokens}=parseArgs({args:argv,allowPositionals:true,strict:true,tokens:true,options:{
    archive:{type:'string'},out:{type:'string'},scan:{type:'string'},'operator-evidence':{type:'string'},
    python:{type:'string'},node:{type:'string'},help:{type:'boolean',short:'h'}
  }});
  const seen=new Set();
  for(const token of tokens)if(token.kind==='option'){
    if(seen.has(token.name))fail('MATOMO_CUSTOMER_REPEATED_OPTION','An option may be supplied only once: --'+token.name);
    seen.add(token.name);
  }
  if(values.help||positionals.length===0)return {help};
  const [command]=positionals,definition=Object.hasOwn(COMMANDS,command)?COMMANDS[command]:null;
  if(positionals.length!==1||!definition)fail('MATOMO_CUSTOMER_COMMAND_REQUIRED','Choose receive, reopen, rows, pack or from-scan.');
  const allowed=new Set([...definition.required,...definition.optional,'python','node','help']);
  for(const name of Object.keys(values))if(!allowed.has(name))
    fail('MATOMO_CUSTOMER_UNEXPECTED_OPTION','--'+name+' is not used by '+command+'.');
  const args=['-B','-m','matomo.customer',command];
  for(const name of definition.required){
    const value=values[name];
    if(typeof value!=='string'||!value.length||/[\x00-\x1f\x7f]/.test(value))
      fail('MATOMO_CUSTOMER_PATH_REQUIRED','Supply --'+name+' for '+command+'.');
    args.push('--'+name,resolve(value));
  }
  args.push('--node',executable(values.node??process.execPath,'Node'));
  return {command,executable:executable(values.python??environment.MATOMO_PYTHON??'python3','Python'),args,cwd:SDK,
    environment:{...environment,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:[SDK,BUYER,environment.PYTHONPATH].filter(Boolean).join(delimiter)}};
}
export async function run(argv=process.argv.slice(2)) {
  const prepared=prepareMatomoCustomerCommand(argv);
  if(prepared.help){process.stdout.write(prepared.help);return {exitCode:0};}
  return new Promise((resolveRun,reject)=>{
    let failed=false;
    const child=spawn(prepared.executable,prepared.args,{cwd:prepared.cwd,env:prepared.environment,stdio:'inherit',shell:false,windowsHide:true});
    const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM');
    const detach=()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);};
    process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
    child.once('error',error=>{
      failed=true;detach();
      const wrapped=new Error(error.code==='ENOENT'?'The selected Python executable is unavailable. Choose --python or MATOMO_PYTHON.':'The original Matomo customer process could not start.');
      wrapped.code=error.code==='ENOENT'?'MATOMO_PYTHON_UNAVAILABLE':'MATOMO_CUSTOMER_START_FAILED';
      reject(wrapped);
    });
    child.once('close',(code,signal)=>{
      detach();if(failed)return;
      const exitCode=code??128+(osConstants.signals[signal]??1);
      process.exitCode=exitCode;resolveRun({exitCode,signal:signal??null});
    });
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)run().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'MATOMO_CUSTOMER_COMMAND_FAILED',message:error.message})+'\n');
  process.exitCode=error.code==='MATOMO_PYTHON_UNAVAILABLE'?127:2;
});
