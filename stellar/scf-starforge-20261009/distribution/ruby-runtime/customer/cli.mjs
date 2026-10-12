#!/usr/bin/env node
// MIT. Complete retained customer selection, commissioning, receiving and private browser.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once as eventOnce } from 'node:events';
import { openRubyCustomerWorkspace } from './model.mjs';
import { previewSource, previewExisting } from './source.mjs';
import { serveRubyCustomerWorkspace } from './server.mjs';
import { inspectRubyCustomerLaunch, rubyCustomerWorkspaceStartup } from './launch.mjs';
import { need, regular, directory, absolute, exists, fingerprint, syncParent } from '../files.mjs';

const HELP = "Ruby customer commissioning\n\n  ruby-customer-workspace serve --directory RUNTIME [--create] [--port 8475] [--startup-json]\n  ruby-customer-workspace init|inspect --directory RUNTIME\n  ruby-customer-workspace source --kind native|baserow --source-directory ORIGINAL [--expected-sha256 SHA]\n  ruby-customer-workspace existing --output-directory ORIGINAL_CUSTOMER_OUTPUT\n  ruby-customer-workspace select|adopt --directory RUNTIME --input PRIVATE_JSON\n  ruby-customer-workspace list --directory RUNTIME [--offset 0 --limit 25]\n  ruby-customer-workspace customer --directory RUNTIME --id CUSTOMER\n  ruby-customer-workspace commission --directory RUNTIME --id CUSTOMER --selection-sha256 SHA [--wait]\n  ruby-customer-workspace resume --directory RUNTIME --id CUSTOMER --selection-sha256 SHA\n    --phase customer|registration [--wait]\n  ruby-customer-workspace cancel --directory RUNTIME --id CUSTOMER --selection-sha256 SHA\n    --phase customer|registration\n  ruby-customer-workspace file --directory RUNTIME --id CUSTOMER --name ORIGINAL_FILE [--out FILE]\n\nSelect retains exact source hash, original stable keys and customer/runtime/output identities.\nAdopt reads an existing lifecycle-input.json and requires its previewed expectedInputSha256.\nBoth reuse the exact original runtime entry and operation when it already exists.\nCommission advances the same customer run and original application registration. --wait\nfollows that original work to a ready application; Ctrl-C requests its actual cancellation.\nUse ruby-runtime for the same environment installation, operation log, application launch,\nstopped export and complete offline receiving. The browser includes those original controls.\n";
const VALUE={
  '--directory':'directory','--input':'input','--kind':'kind','--source-directory':'sourceDirectory',
  '--output-directory':'outputDirectory','--expected-sha256':'expectedSha256','--id':'id',
  '--selection-sha256':'expectedSelectionSha256','--phase':'phase','--offset':'offset','--limit':'limit',
  '--port':'port','--name':'name','--out':'out',
};
const FLAGS={'--wait':'wait','--create':'create','--startup-json':'startupJson'};
const ALLOWED={
  serve:['directory','create','port','startupJson'],init:['directory'],inspect:['directory'],
  source:['kind','sourceDirectory','expectedSha256'],existing:['outputDirectory'],
  select:['directory','input'],adopt:['directory','input'],list:['directory','offset','limit'],
  customer:['directory','id'],commission:['directory','id','expectedSelectionSha256','wait'],
  resume:['directory','id','expectedSelectionSha256','phase','wait'],
  cancel:['directory','id','expectedSelectionSha256','phase'],file:['directory','id','name','out'],
};
function options(argv) {
  need(Array.isArray(argv) && argv.every(v=>typeof v==='string'),'RUBY_CUSTOMER_CLI_ARGUMENTS');
  const words=[...argv],action=words.shift();
  if(!action || ['help','--help','-h'].includes(action))return {action:'help',input:{}};
  need(Object.hasOwn(ALLOWED,action),'RUBY_CUSTOMER_CLI_ACTION',HELP);
  const input={};
  while(words.length) {
    const key=words.shift(),name=VALUE[key]??FLAGS[key];
    need(name && ALLOWED[action].includes(name) && !Object.hasOwn(input,name),'RUBY_CUSTOMER_CLI_ARGUMENTS',
      'Unknown or repeated option: '+key);
    if(FLAGS[key])input[name]=true;
    else {
      const value=words.shift();
      need(typeof value==='string' && !value.includes('\0'),'RUBY_CUSTOMER_CLI_ARGUMENTS','Supply '+key+'.');
      if(['offset','limit','port'].includes(name)) {
        need(/^(?:0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)),'RUBY_CUSTOMER_CLI_ARGUMENTS');
        input[name]=Number(value);
      } else input[name]=['directory','input','sourceDirectory','outputDirectory','out'].includes(name)?resolve(value):value;
    }
  }
  if(!['source','existing'].includes(action))need(input.directory,'RUBY_CUSTOMER_CLI_DIRECTORY');
  return {action,input};
}
async function selectedInput(path) {
  const raw=await regular(absolute(path),1048576);
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{need(false,'RUBY_CUSTOMER_CLI_JSON','Read the full selected customer JSON file.');}
  return value;
}
async function waitFor(workspace,input) {
  let stopped=false;
  const stop=()=>{stopped=true;};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try {
    let prior='';
    while(true) {
      const value=await workspace.advanceCustomer({id:input.id,expectedSelectionSha256:input.expectedSelectionSha256});
      const phase=value.phase;
      if(phase!==prior){process.stderr.write(phase+'\n');prior=phase;}
      if(phase==='READY' && value.result || ['CUSTOMER_NEEDS_RESUME','REGISTRATION_NEEDS_RESUME'].includes(phase))return value;
      if(stopped) {
        const selected=['REGISTERING','REGISTRATION_NEEDS_RESUME','FINALIZING','READY'].includes(phase)?'registration':'customer';
        await workspace.cancelCustomer({id:input.id,phase:selected,expectedSelectionSha256:input.expectedSelectionSha256});
        stopped=false;
      }
      await new Promise(done=>setTimeout(done,400));
    }
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
async function receiveFile(workspace,input) {
  const file=await workspace.openCustomerFile({id:input.id,name:input.name});
  let temporary;
  try {
    if(!input.out) {
      for await(const chunk of file.handle.createReadStream({start:0,autoClose:false}))
        if(!process.stdout.write(chunk))await eventOnce(process.stdout,'drain');
      return null;
    }
    const target=absolute(input.out);
    await directory(dirname(target));
    if(await exists(target)) {
      const old=await fingerprint(target,{privateOnly:true});
      need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_CUSTOMER_RECEIVED_FILE_CHANGED');
      return {file:target,name:file.name,bytes:file.bytes,sha256:file.sha256};
    }
    temporary=target+'.pending-'+randomUUID();
    const output=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    try {
      for await(const chunk of file.handle.createReadStream({start:0,autoClose:false})) {
        let at=0;
        while(at<chunk.length){const wrote=await output.write(chunk,at,chunk.length-at);
          need(wrote.bytesWritten>0,'RUBY_CUSTOMER_FILE_WRITE');at+=wrote.bytesWritten;}
      }
      await output.sync();
    }finally{await output.close();}
    try{await link(temporary,target);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const old=await fingerprint(target,{privateOnly:true});
      need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_CUSTOMER_RECEIVED_FILE_CHANGED');
    }
    await syncParent(target);
    return {file:target,name:file.name,bytes:file.bytes,sha256:file.sha256};
  }finally{
    await file.handle.close();
    if(temporary)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function serve(input,{stdout}) {
  let workspace,service,stopRequested=false,finish,fail;
  const ended=new Promise((accept,reject)=>{finish=accept;fail=reject;});ended.catch(()=>{});
  const stop=()=>{stopRequested=true;finish();},failed=error=>fail(error);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try {
    workspace=await openRubyCustomerWorkspace({directory:input.directory,create:input.create??false});
    if(stopRequested)return null;
    const launch=await inspectRubyCustomerLaunch({directory:workspace.directory});
    if(stopRequested)return null;
    service=await serveRubyCustomerWorkspace({workspace,port:input.port??8475});
    service.server.on('error',failed);
    if(stopRequested)return null;
    const record=await rubyCustomerWorkspaceStartup({launch,workspace,service});
    if(stopRequested)return null;
    stdout.write(input.startupJson?JSON.stringify(record)+'\n':
      'Ruby customer commissioning\n'+record.url+'\nRuntime: '+record.directory+'\n');
    await ended;return null;
  }finally{
    try{
      if(service){try{await service.close();}finally{service.server.off('error',failed);}}
      else if(workspace)await workspace.close();
    }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout} = {}) {
  const {action,input}=options(argv);
  if(action==='help'){stdout.write(HELP);return null;}
  if(action==='serve')return serve(input,{stdout});
  if(action==='source')return previewSource({kind:input.kind,directory:input.sourceDirectory,expectedSha256:input.expectedSha256});
  if(action==='existing')return previewExisting({directory:input.outputDirectory});
  const workspace=await openRubyCustomerWorkspace({directory:input.directory,create:action==='init'});
  try {
    let result;
    if(action==='init'||action==='inspect')result=await workspace.inspect();
    else if(action==='select'||action==='adopt')result=await workspace[action==='select'?'selectCustomer':'adoptCustomer'](await selectedInput(input.input));
    else if(action==='list')result=await workspace.customers({offset:input.offset,limit:input.limit});
    else if(action==='customer')result=await workspace.customer({id:input.id});
    else if(action==='file')return receiveFile(workspace,input);
    else if(action==='commission')result=await workspace.advanceCustomer({id:input.id,expectedSelectionSha256:input.expectedSelectionSha256});
    else result=await workspace[action==='resume'?'resumeCustomer':'cancelCustomer']({
      id:input.id,expectedSelectionSha256:input.expectedSelectionSha256,phase:input.phase});
    if(input.wait)result=await waitFor(workspace,input);
    if(['CUSTOMER_NEEDS_RESUME','REGISTRATION_NEEDS_RESUME'].includes(result?.phase))process.exitCode=1;
    return result;
  }finally{await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(value=>{if(value!==null&&value!==undefined)process.stdout.write(JSON.stringify(value,null,2)+'\n');})
    .catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'RUBY_CUSTOMER_FAILED',message:error.message}})+'\n');process.exitCode=1;});
