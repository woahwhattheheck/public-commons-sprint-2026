// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat} from 'node:fs/promises';
import {GroundwaterReportDesk} from './desk.mjs';
import {startReportDesk} from './server.mjs';
import {startPublication} from './publication.mjs';
import {read,readJSON,put,json,need,absolute,defaultApplication,MAX_FILE} from './common.mjs';

export const USAGE='groundwater-report <init|serve|reports|report|publish|publication|buyer-prepare|buyer-catalog|capture|preview|receive|receiving|operation|continue|export|restore|serve-publication> --desk /private/desk [--source /original/groundwater] [--input /private/request.json] [--operation ID] [--python /python] [--application /installed/groundwater] [--operations-url-file /private/original-launch.json] [--port 0] [--launch-file /private/new-launch.json] [--facilitator https://original.example]';
export async function privateAccess(file){
  absolute(file,'original private access file');const s=await lstat(file);
  need(s.isFile()&&!s.isSymbolicLink()&&(process.platform==='win32'||(s.mode&0o077)===0&&s.uid===process.getuid()),
    'PRIVATE_ACCESS_FILE','Use the original private access link file.');
  const raw=(await read(file,16384)).toString('utf8').trim();
  return raw.startsWith('{')?JSON.parse(raw).url:raw;
}
export async function originalFactory(url,allowLocal=false){
  if(!url)return null;
  const u=new URL(url);
  need(!u.username&&!u.password&&!u.hash&&!u.search&&(u.protocol==='https:'||
    allowLocal&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)),
    'FACILITATOR_URL','Select the explicit original HTTPS facilitator or explicitly allowed local native facilitator.',422);
  const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../native-factory.mjs')]);
  return compiled=>createNativeSellerServer(compiled,{facilitatorClient:new HTTPFacilitatorClient({url:u.href.replace(/\/$/,'')})});
}
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&args[0]==='--help'){process.stdout.write(USAGE+'\n');return;}
  const [command,...rest]=args,options={};
  const flags=['--desk','--source','--input','--operation','--python','--application','--operations-url-file','--port','--launch-file','--facilitator'];
  for(let i=0;i<rest.length;i++){
    const key=rest[i];need(!Object.hasOwn(options,key),'OPTION_DUPLICATE','An option was supplied twice.',422);
    if(key==='--allow-local-facilitator'){options[key]=true;continue;}
    need(flags.includes(key)&&rest[i+1]&&!rest[i+1].startsWith('--'),'OPTIONS_REQUIRED',USAGE,422);options[key]=rest[++i];
  }
  need(options['--desk'],'DESK_REQUIRED',USAGE,422);
  const desk=new GroundwaterReportDesk({directory:resolve(options['--desk']),
    sourceWorkspace:options['--source']?resolve(options['--source']):null,
    application:options['--application']?resolve(options['--application']):defaultApplication,
    python:options['--python']??'python3',
    operationsAccess:options['--operations-url-file']?await privateAccess(resolve(options['--operations-url-file'])):null});
  await desk.open({create:command==='init'});
  const input=options['--input']?(await readJSON(resolve(options['--input']))).value:{};
  let result;
  if(command==='init')result=await desk.state();
  else if(command==='serve'){
    const nativeFactory=await originalFactory(options['--facilitator'],options['--allow-local-facilitator']);
    const server=await startReportDesk({desk,port:Number(options['--port']??0),nativeFactory,
      launchFile:options['--launch-file']?resolve(options['--launch-file']):null});
    result=server.launch;
  }else if(command==='serve-publication'){
    const nativeFactory=await originalFactory(options['--facilitator'],options['--allow-local-facilitator']);
    const server=await startPublication({desk:await desk.open(),publicationId:options['--operation']??input.publicationId,
      runtime:desk.runtime,port:Number(options['--port']??0),nativeFactory});
    result={url:server.url,mode:server.mode,publicationId:server.publicationId,publicationSha256:server.publicationSha256};
  }else if(command==='reports')result=await desk.reports();
  else if(command==='report')result=await desk.report(options['--operation']??input.reportId);
  else if(command==='publish')result=await desk.publish(input);
  else if(command==='publication')result=await desk.publication(options['--operation']??input.operationId);
  else if(command==='buyer-prepare')result=await desk.prepareBuyer(input);
  else if(command==='buyer-catalog'){
    const {catalogFile,...selected}=input;result=await desk.prepareCatalog({...selected,catalog:await read(resolve(catalogFile),1048576)});
  }
  else if(command==='capture')result=await desk.capture(input);
  else if(command==='preview'||command==='receive'){
    const {catalogFile,handoffFile,responseFile,...original}=input;
    const selected={...original,catalog:await read(resolve(catalogFile),1048576),handoff:await read(resolve(handoffFile),8388608),response:await read(resolve(responseFile),MAX_FILE)};
    result=command==='preview'?await desk.previewReceiving(selected):await desk.receive(selected);
  }else if(command==='receiving')result=await desk.receiving(options['--operation']??input.operationId);
  else if(command==='operation')result=await desk.original(options['--operation']??input.operationId);
  else if(command==='continue')result=await desk.resume(options['--operation']??input.operationId);
  else if(command==='export')result=await desk.export(input);
  else if(command==='restore')result=await desk.restore(input);
  else need(false,'COMMAND_UNKNOWN',USAGE,422);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'REPORT_DESK_ERROR',message:error.message,detail:error.detail??null}})+'\n');process.exitCode=1;});
