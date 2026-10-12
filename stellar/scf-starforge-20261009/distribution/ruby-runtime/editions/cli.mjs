#!/usr/bin/env node
// MIT. Original managed application data-edition commissioning and complete receiving.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once as eventOnce } from 'node:events';
import { openRubyRuntime } from '../model.mjs';
import { previewApplicationEditionSource } from './source.mjs';
import { need, regular, directory, absolute, exists, fingerprint, syncParent } from '../files.mjs';

const HELP=`Application data editions

  ruby-application-editions source --format native|baserow --source-directory PACKET
    [--expected-manifest-sha256 SHA]
  ruby-application-editions list --directory RUNTIME --id APPLICATION [--offset 0 --limit 25]
  ruby-application-editions show --directory RUNTIME --id APPLICATION --edition-id EDITION
  ruby-application-editions stage|prepare|commit --directory RUNTIME --input REQUEST_JSON [--wait]
  ruby-application-editions wait --directory RUNTIME --operation-id ORIGINAL_UUID
  ruby-application-editions file --directory RUNTIME --id APPLICATION --edition-id EDITION
    [--review-id ORIGINAL_REVIEW_UUID] --name ORIGINAL_FILE [--out DESTINATION]

Stage input:
  {id,editionId,title,format,directory,expectedManifestSha256,reviewId,operationId,actor}
Prepare input:
  {id,editionId,reviewId,operationId,actor}
Commit input:
  {id,editionId,reviewId,expectedPreviewSha256,operationId,actor}

The input JSON retains original absolute packet paths, manifest and review digests,
operator identity and UUID before dispatch. Use that same file after an interrupted
reply. Stage receives every original byte and prepares the existing Rails preview.
Commit checks the selected preview against the original stream and current target
rows, then retains its complete native receipt in the same transaction.
A later preview needs a new review UUID. Resume and cancel a failed or active job
with the original ruby-runtime operation commands; its operation UUID is unchanged.
Use the Customer workspace Data editions tab for the complete browser workflow.

Applications remain stopped during receiving, review preparation and commit.
Afterwards use ruby-runtime application launch/verify/export and ordinary receive
to operate or move the complete revised application with its source and history.
`;
const OPTIONS={'--directory':'directory','--id':'id','--edition-id':'editionId','--input':'input',
  '--format':'format','--source-directory':'sourceDirectory','--expected-manifest-sha256':'expectedManifestSha256',
  '--offset':'offset','--limit':'limit','--operation-id':'operationId','--review-id':'reviewId',
  '--name':'name','--out':'out','--wait':'wait'};
const ALLOWED={source:['format','sourceDirectory','expectedManifestSha256'],list:['directory','id','offset','limit'],
  show:['directory','id','editionId'],stage:['directory','input','wait'],prepare:['directory','input','wait'],
  commit:['directory','input','wait'],wait:['directory','operationId'],
  file:['directory','id','editionId','reviewId','name','out']};
function options(argv) {
  need(Array.isArray(argv)&&argv.every(value=>typeof value==='string'),'RUBY_EDITION_CLI_ARGUMENTS');
  const words=[...argv],action=words.shift();if(!action||['help','--help','-h'].includes(action))return {action:'help',input:{}};
  need(Object.hasOwn(ALLOWED,action),'RUBY_EDITION_CLI_ACTION',HELP);
  const input={};
  while(words.length) {
    const key=words.shift(),name=OPTIONS[key];
    need(name&&ALLOWED[action].includes(name)&&!Object.hasOwn(input,name),'RUBY_EDITION_CLI_ARGUMENTS','Unknown or repeated '+key);
    if(name==='wait'){input.wait=true;continue;}
    const value=words.shift();need(typeof value==='string'&&!value.includes('\0'),'RUBY_EDITION_CLI_ARGUMENTS','Supply '+key);
    if(['offset','limit'].includes(name)){
      need(/^(?:0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value)),'RUBY_EDITION_CLI_ARGUMENTS');input[name]=Number(value);
    } else input[name]=['directory','input','sourceDirectory','out'].includes(name)?resolve(value):value;
  }
  if(action!=='source')need(input.directory,'RUBY_EDITION_CLI_DIRECTORY');
  return {action,input};
}
async function request(path){
  const raw=await regular(absolute(path),1048576);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{need(false,'RUBY_EDITION_CLI_JSON','Read the original complete request JSON.');}
}
async function waitFor(workspace,key) {
  let cancelled=false,prior='';
  const stop=()=>{cancelled=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
    while(true){
      const value=await workspace.operation({operationId:key});
      const progress=value.phase+' '+(value.stage??'');
      if(progress!==prior){process.stderr.write(progress.trim()+'\n');prior=progress;}
      if(!value.active&&['SUCCEEDED','FAILED','INTERRUPTED','CANCELLED'].includes(value.phase))return value;
      if(cancelled){await workspace.cancel({operationId:key});cancelled=false;}
      await new Promise(done=>setTimeout(done,400));
    }
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
async function receiveFile(workspace,input){
  const file=await workspace.openEditionFile({id:input.id,editionId:input.editionId,reviewId:input.reviewId,name:input.name});
  let temporary;
  try{
    if(!input.out){
      for await(const chunk of file.handle.createReadStream({start:0,autoClose:false}))
        if(!process.stdout.write(chunk))await eventOnce(process.stdout,'drain');
      return null;
    }
    const target=absolute(input.out);await directory(dirname(target));
    if(await exists(target)){
      const old=await fingerprint(target,{privateOnly:true});
      need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_EDITION_RECEIVED_FILE_CHANGED');
      return {file:target,name:file.name,bytes:file.bytes,sha256:file.sha256};
    }
    temporary=target+'.pending-'+randomUUID();
    const output=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    try{
      for await(const chunk of file.handle.createReadStream({start:0,autoClose:false})){
        let at=0;while(at<chunk.length){const wrote=await output.write(chunk,at,chunk.length-at);
          need(wrote.bytesWritten>0,'RUBY_EDITION_FILE_WRITE');at+=wrote.bytesWritten;}
      }
      await output.sync();
    }finally{await output.close();}
    try{await link(temporary,target);}catch(error){
      if(error.code!=='EEXIST')throw error;const old=await fingerprint(target,{privateOnly:true});
      need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_EDITION_RECEIVED_FILE_CHANGED');
    }
    await syncParent(target);return {file:target,name:file.name,bytes:file.bytes,sha256:file.sha256};
  }finally{
    await file.handle.close();
    if(temporary)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout}={}){
  const {action,input}=options(argv);if(action==='help'){stdout.write(HELP);return null;}
  if(action==='source')return previewApplicationEditionSource({format:input.format,directory:input.sourceDirectory,
    expectedManifestSha256:input.expectedManifestSha256});
  const workspace=await openRubyRuntime({directory:input.directory});
  try{
    let result;
    if(action==='list')result=await workspace.applicationEditions({id:input.id,offset:input.offset,limit:input.limit});
    else if(action==='show')result=await workspace.applicationEdition({id:input.id,editionId:input.editionId});
    else if(action==='file')return receiveFile(workspace,input);
    else if(action==='wait')result=await waitFor(workspace,input.operationId);
    else{
      const selected=await request(input.input);
      const method={stage:'stageApplicationEdition',prepare:'prepareApplicationEdition',commit:'commitApplicationEdition'}[action];
      result=await workspace[method](selected);
      if(input.wait)result=await waitFor(workspace,result.id);
    }
    if(['FAILED','INTERRUPTED','CANCELLED'].includes(result?.phase))process.exitCode=1;
    return result;
  }finally{await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(value=>{if(value!==null&&value!==undefined)process.stdout.write(JSON.stringify(value,null,2)+'\n');})
    .catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'RUBY_EDITION_FAILED',message:error.message}})+'\n');process.exitCode=1;});
