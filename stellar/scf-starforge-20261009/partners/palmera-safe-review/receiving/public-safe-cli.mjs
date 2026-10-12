#!/usr/bin/env node
// MIT. Installed read/reopen/caller entry for the original public Safe source.
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {absolute,need,safeCode} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {receivePublicSafe,openPublicSafeRecord,describePublicSafeRecord,writePublicSafeCaller,
  publicSafeRPC,DEFAULT_PUBLIC_SAFE_SOURCE,DEFAULT_RPC_ENVIRONMENT} from './public-safe-record.mjs';

export const PUBLIC_SAFE_HELP='Original public Safe source receiving\n\n'+
'  read --caller-root DIRECTORY --out DIRECTORY [--rpc-env NAME | --rpc HTTPS_URL]\n'+
'       [--source FILE] [--label TEXT]\n'+
'  open --directory DIRECTORY\n'+
'  caller --directory DIRECTORY --out FILE [--caller-root DIRECTORY] [--rpc-env NAME]\n\n'+
'Installed aliases: safe-review public-read / public-open / public-caller.\n'+
'Default RPC environment: '+DEFAULT_RPC_ENVIRONMENT+'. All file paths are absolute.\n'+
'read obtains the recorded transaction and receipt through the original caller SDK and saves\n'+
'its context, runtime and original three-file selection. Repeating a complete directory reopens it.\n'+
'open verifies all retained files offline. caller writes a native loadTransaction({context})\n'+
'module outside the receiving directory; it contains paths and an environment name, not an RPC key.\n'+
'Only the bundled original public source (or its exact copy) is accepted by --source.\n';

const options=['caller-root','out','rpc-env','rpc','source','label','directory'];
const allowed={read:['caller-root','out','rpc-env','rpc','source','label'],
  open:['directory'],caller:['directory','out','caller-root','rpc-env']};
function required(values,name){
  need(typeof values[name]==='string'&&values[name].length>0,'PUBLIC_SAFE_CLI_'+name.toUpperCase().replaceAll('-','_')+'_REQUIRED');
  return values[name];
}
const path=(values,name)=>absolute(required(values,name));
export async function runPublicSafeCLI(argv=process.argv.slice(2),{
  write=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'),
  help=text=>process.stdout.write(text)
}={}){
  const parsed=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:Object.fromEntries([...options.map(name=>[name,{type:'string'}]),['help',{type:'boolean',short:'h'}]])});
  const values=parsed.values,command=parsed.positionals[0];
  if(values.help||command===undefined){help(PUBLIC_SAFE_HELP);return null;}
  need(parsed.positionals.length===1&&Object.hasOwn(allowed,command),'PUBLIC_SAFE_CLI_COMMAND_INVALID');
  need(Object.keys(values).every(name=>allowed[command].includes(name)),'PUBLIC_SAFE_CLI_OPTION_NOT_USED_BY_COMMAND');
  let result;
  if(command==='read'){
    need(!(values.rpc&&values['rpc-env']),'PUBLIC_SAFE_CLI_ONE_RPC_SELECTION_REQUIRED');
    const selectedRPC=publicSafeRPC({rpc:values.rpc,rpcEnvironment:values['rpc-env']??DEFAULT_RPC_ENVIRONMENT});
    const record=await receivePublicSafe({directory:path(values,'out'),callerRoot:path(values,'caller-root'),
      rpc:selectedRPC,sourceFile:values.source?path(values,'source'):DEFAULT_PUBLIC_SAFE_SOURCE,
      ...(values.label===undefined?{}:{label:values.label})});
    result=describePublicSafeRecord(record);
  }else if(command==='open'){
    result=describePublicSafeRecord(await openPublicSafeRecord(path(values,'directory')));
  }else{
    result=await writePublicSafeCaller({directory:path(values,'directory'),out:path(values,'out'),
      ...(values['caller-root']?{callerRoot:path(values,'caller-root')}:{}),
      rpcEnvironment:values['rpc-env']??DEFAULT_RPC_ENVIRONMENT});
  }
  write(result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runPublicSafeCLI().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'PUBLIC_SAFE_RECEIVING_FAILED')})+'\n');
    process.exitCode=1;
  });
}
