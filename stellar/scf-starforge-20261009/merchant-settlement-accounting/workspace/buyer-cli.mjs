// MIT. Complete buyer-issued startup over the original Store and accountant engine.
import {open,lstat,link,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {accountingWorkspaceBinding} from './binding.mjs';
import {readBuyerStartup,buyerStartupView} from './buyer-startup.mjs';

export const BUYER_HELP=`Buyer-issued accountant startup:
  buyer init --workspace ABS --source ABS --operator NAME [--source-sha256 SHA256] [--source-name NAME]
  buyer inspect --workspace ABS
  buyer prepare --workspace ABS
  buyer handoff --workspace ABS --name NAME --operator NAME --revision N --source-sha256 SHA256
  buyer source --workspace ABS --output ABS
  buyer download --workspace ABS --handoff UUID --file NAME --output ABS [--revision-id UUID]

Run these with node workspace/server.mjs buyer ... or node workspace/buyer-cli.mjs ...
init retains the exact issued buyer source without merchant source directories.
prepare returns the original source preview, current revision and retained handoff ID.
handoff uses that same ID on every retry; accepted requests recover before revision checks.
download uses the original accountant file allowlist, including buyer-return.json.

Reopen the browser with node workspace/server.mjs --workspace ABS.
Use the original review/snapshot/verify/restore recovery commands for complete encrypted operating state.
No provider call or payment is performed by these commands.
`;
const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const field=(value,name)=>{need(typeof value==='string'&&value.trim(),'BUYER_CLI_ARGUMENT','Provide '+name+'.');return value;};
const absolute=(value,name)=>{field(value,name);need(isAbsolute(value)&&resolve(value)===value&&value!=='/','BUYER_CLI_PATH','Use an absolute normalized '+name+'.');return value;};
const commands=new Set(['init','inspect','prepare','handoff','source','download']);
const keys=new Set(['--workspace','--source','--source-sha256','--source-name','--operator','--name','--revision','--handoff','--file','--output','--revision-id']);
function args(argv){
  if(argv.length===0||argv.length===1&&argv[0]==='--help')return null;
  const [command,...rest]=argv;need(commands.has(command),'BUYER_CLI_COMMAND',BUYER_HELP);
  const values={};for(let i=0;i<rest.length;i++){
    const key=rest[i];need(keys.has(key)&&!Object.hasOwn(values,key)&&typeof rest[i+1]==='string'&&!rest[i+1].startsWith('--'),'BUYER_CLI_ARGUMENT',BUYER_HELP);
    values[key]=rest[++i];
  }
  const allowed={init:['--workspace','--source','--source-sha256','--source-name','--operator'],
    inspect:['--workspace'],prepare:['--workspace'],
    handoff:['--workspace','--name','--operator','--revision','--source-sha256'],
    source:['--workspace','--output'],download:['--workspace','--handoff','--file','--output','--revision-id']}[command];
  need(Object.keys(values).every(key=>allowed.includes(key)),'BUYER_CLI_ARGUMENT','Use only the declared fields for buyer '+command+'.');
  return {command,values};
}
async function output(path,bytes){
  absolute(path,'output path');const directory=dirname(path),info=await lstat(directory);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),'BUYER_CLI_PRIVATE','Write the selected private output inside an owner-private directory.');
  const stage=join(directory,'.buyer-output-'+randomUUID()+'.pending'),file=await open(stage,'wx',0o600);
  try{
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await link(stage,path);
    const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}
  }finally{await rm(stage,{force:true});}
}
export async function buyerMain(argv){
  const selected=args(argv);if(!selected){process.stdout.write(BUYER_HELP);return;}
  const {command,values}=selected,directory=absolute(values['--workspace'],'workspace');
  const startup=command==='init'?{buyerSourceFile:absolute(values['--source'],'issued source file'),
    buyerSourceSha256:values['--source-sha256'],buyerSourceName:values['--source-name'],
    buyerOperator:field(values['--operator'],'the source operator')}:{};
  const workspace=await openAccountingWorkspace({directory,...startup});
  try{
    const original=await readBuyerStartup(directory,workspace.state),accountant=new AccountantWorkspace(workspace);
    let result={schema:'stellar-forge.buyer-accounting-operation.v1',operation:command,
      binding:accountingWorkspaceBinding(directory,workspace.state),workspaceRevision:workspace.state.revision,
      source:buyerStartupView(directory,workspace.state)};
    if(command==='prepare'){
      result.preview=await accountant.prepareBuyer({buyerStartup:{sha256:original.descriptor.sha256}});
      result.handoffId=original.descriptor.handoffId;
    }else if(command==='handoff'){
      need(values['--source-sha256']===original.descriptor.sha256,'BUYER_STARTUP_CHANGED','Use the exact SHA256 returned by the retained source preview.',409);
      need(/^[1-9]\d*$/.test(values['--revision']??'')&&Number.isSafeInteger(Number(values['--revision'])),'BUYER_CLI_REVISION','Use the original displayed workspace revision.');
      result.accepted=await accountant.create({id:original.descriptor.handoffId,
        revision:Number(values['--revision']),name:field(values['--name'],'handoff name'),actor:field(values['--operator'],'reviewer'),
        labels:[],buyerStartup:{sha256:original.descriptor.sha256}});
      result.workspaceRevision=workspace.state.revision;
      result.source=buyerStartupView(directory,workspace.state);
    }else if(command==='source'){
      const path=absolute(values['--output'],'output file');await output(path,original.bytes);
      result.output={path,bytes:original.bytes.length,sha256:original.descriptor.sha256};
    }else if(command==='download'){
      const file=await accountant.file(field(values['--handoff'],'handoff ID'),field(values['--file'],'retained filename'),
        values['--revision-id']?{revisionId:values['--revision-id']}:{});
      const path=absolute(values['--output'],'output file');await output(path,file.bytes);
      result.output={path,bytes:file.bytes.length,name:file.name,type:file.type};
    }
    process.stdout.write(JSON.stringify(result)+'\n');return result;
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  buyerMain(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'BUYER_ACCOUNTING_FAILED',message:error.message})+'\n');process.exitCode=1;});
