#!/usr/bin/env node
// MIT. Complete native operator and same-writer console commands.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { digest } from '../../../postgres/publisher/files.mjs';
import { openGeoServerOperator, readGeoServerConfiguration } from './adapter.mjs';
import { startGeoServerConsole } from './server.mjs';
import { openGeoServerConsoleClient } from './console-client.mjs';
import { inspectGeoServerReceiving, adoptGeoServerReceiving } from './handover.mjs';
import { createGeoServerArchive } from './archive.mjs';
import { verifyFile } from './journal.mjs';
import { need, absolute, operationId, hash, nativeBytes, parseExactJSON, MiB } from './contract.mjs';

export const HELP="GeoServer publication operator\n\nOpen one native writer:\n  starforge geoserver serve --workspace DIR --profile FILE --reader FILE [--port 0]\n\nUse that same running writer:\n  starforge geoserver target --connection DIR/console-connection.json\n  starforge geoserver inspect --connection FILE [--operation ID]\n  starforge geoserver prepare --connection FILE --request FILE\n  starforge geoserver apply --connection FILE --operation ID --review-sha256 SHA256\n  starforge geoserver reconcile --connection FILE --operation ID\n  starforge geoserver rollback-prepare --connection FILE --request FILE\n  starforge geoserver receive --connection FILE --operation ID\n  starforge geoserver export --connection FILE --operation ID --out DIR [--archive FILE]\n  starforge geoserver cancel --connection FILE --operation ID\n  starforge geoserver source --connection FILE --directory DIR [--manifest-sha256 SHA256]\n\nFor a closed operator, replace --connection with:\n  --workspace DIR --profile FILE --reader FILE\nOptional source pins: --profile-sha256 SHA256 --reader-sha256 SHA256\n\nInspect, adopt and archive the complete portable operator:\n  starforge geoserver inspect-handover --directory DIR [--manifest-sha256 SHA256]\n  starforge geoserver adopt --directory DIR --out DIR --manifest-sha256 SHA256\n  starforge geoserver archive --directory DIR --out FILE --manifest-sha256 SHA256 [--python PATH]\n  starforge geoserver inspect-config --profile FILE --reader FILE\n\nPrepare request:\n  {\"operationId\":\"publish-edition-1\",\"kind\":\"publish\",\n   \"receivingDirectory\":\"/original/postgis-receiving\",\"manifestSha256\":\"...\",\n   \"expectedPublication\":null,\"layers\":[...]}\n\nRollback request:\n  {\"operationId\":\"restore-edition-1\",\"publicationId\":\"publish-edition-1\",\n   \"receivingDirectory\":\"/original/current-postgis-receiving\",\"manifestSha256\":\"...\"}\n\nA request file retains all selected layers, styles and existing read/write roles.\nThe review hash names the exact native before/after review accepted by apply.\nSIGINT/SIGTERM cancel the current command and drain its retained owners.\n";
const HOST=['workspace','profile','reader','profile-sha256','reader-sha256','connection'];
const OPTIONS={
  serve:[...HOST,'port'],target:HOST,inspect:[...HOST,'operation'],
  prepare:[...HOST,'request'],apply:[...HOST,'operation','review-sha256'],
  reconcile:[...HOST,'operation'],'rollback-prepare':[...HOST,'request'],
  receive:[...HOST,'operation'],export:[...HOST,'operation','out','archive'],
  cancel:['connection','operation'],source:['connection','directory','manifest-sha256'],
  'inspect-handover':['directory','manifest-sha256'],adopt:['directory','out','manifest-sha256'],
  archive:['directory','out','manifest-sha256','python'],
  'inspect-config':['profile','reader','profile-sha256','reader-sha256']};
function parse(argv){
  if(argv.length===0||['help','--help','-h'].includes(argv[0]))return {command:'help',values:{}};
  const command=argv[0];need(Object.hasOwn(OPTIONS,command),'GEOSERVER_COMMAND',HELP);
  const values={};
  for(let i=1;i<argv.length;i+=2){
    need(argv[i].startsWith('--')&&i+1<argv.length&&!argv[i+1].startsWith('--'),'GEOSERVER_COMMAND_ARGUMENT');
    const key=argv[i].slice(2);need(OPTIONS[command].includes(key)&&!Object.hasOwn(values,key),'GEOSERVER_COMMAND_ARGUMENT');
    values[key]=argv[i+1];
  }
  return {command,values};
}
async function write(stream,value,{plain=false}={}){
  const data=plain?String(value):nativeBytes(value);
  await new Promise((resolve,reject)=>{
    const failure=error=>{stream.removeListener('error',failure);reject(error);};
    stream.once('error',failure);
    try{stream.write(data,error=>{stream.removeListener('error',failure);error?reject(error):resolve();});}
    catch(error){stream.removeListener('error',failure);reject(error);}
  });
}
async function requestFile(path,signal){
  absolute(path);const selected=await verifyFile(path,{maximum:2*MiB,signal});
  const raw=await readFile(path,{signal});need(raw.length===selected.bytes&&digest(raw)===selected.sha256,'GEOSERVER_REQUEST_FILE_CHANGED');
  const value=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(value&&typeof value==='object'&&!Array.isArray(value),'GEOSERVER_REQUEST_OBJECT');return value;
}
export async function runGeoServerCli(argv=process.argv.slice(2),{environment=process.env,
  stdout=process.stdout,stderr=process.stderr,signal:externalSignal,processSignals=true}={}){
  const {command,values}=parse(argv);if(command==='help'){await write(stdout,HELP,{plain:true});return {help:true};}
  const required=key=>{need(typeof values[key]==='string'&&values[key].length>0,'GEOSERVER_COMMAND_REQUIRED','Supply --'+key+'.');return values[key];};
  const lifetime=new AbortController();let signalNumber=0,owner=null,primary=null,result,closeIssue=null;
  let releaseStop;const stopped=new Promise(resolve=>{releaseStop=resolve;});
  const stop=number=>{signalNumber||=number;lifetime.abort(Object.assign(new Error('GeoServer command cancelled.'),
    {code:'GEOSERVER_CANCELLED'}));releaseStop();};
  const onInt=()=>stop(2),onTerm=()=>stop(15);
  const external=()=>{lifetime.abort(externalSignal.reason??new Error('GeoServer command cancelled.'));releaseStop();};
  const outputError=error=>{primary??=error;lifetime.abort(error);releaseStop();};
  if(processSignals){process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);}
  externalSignal?.addEventListener('abort',external,{once:true});if(externalSignal?.aborted)external();
  stdout.on('error',outputError);
  const signal=lifetime.signal;
  const host=()=>({directory:absolute(required('workspace')),profileFile:absolute(required('profile')),
    readerFile:absolute(required('reader')),environment,signal,
    ...(values['profile-sha256']?{expectedProfileSha256:hash(values['profile-sha256'])}:{}),
    ...(values['reader-sha256']?{expectedReaderSha256:hash(values['reader-sha256'])}:{})});
  try{
    signal.throwIfAborted();
    if(command==='inspect-handover')result=await inspectGeoServerReceiving(absolute(required('directory')),
      {expectedManifestSha256:values['manifest-sha256']&&hash(values['manifest-sha256']),signal});
    else if(command==='adopt')result=await adoptGeoServerReceiving({directory:absolute(required('directory')),
      outputDirectory:absolute(required('out')),expectedManifestSha256:hash(required('manifest-sha256')),signal});
    else if(command==='archive')result=await createGeoServerArchive({directory:absolute(required('directory')),
      archiveFile:absolute(required('out')),manifestSha256:hash(required('manifest-sha256')),signal,
      ...(values.python?{python:values.python}:{})});
    else if(command==='inspect-config'){
      const configuration=await readGeoServerConfiguration({profileFile:absolute(required('profile')),readerFile:absolute(required('reader')),
        expectedProfileSha256:values['profile-sha256'],expectedReaderSha256:values['reader-sha256'],signal});
      result={profileFile:configuration.profileFile,readerFile:configuration.readerFile,nativeBinding:configuration.nativeBinding,
        profile:configuration.profile};
    }else if(command==='serve'){
      need(!values.connection,'GEOSERVER_SERVE_ORIGINAL_WORKSPACE');
      owner=await startGeoServerConsole({...host(),port:values.port===undefined?0:Number(values.port)});
      signal.throwIfAborted();const {close,finished,...launch}=owner;await write(stdout,launch);
      await Promise.race([stopped,owner.finished]);result={state:'CLOSED',workspace:owner.workspace};
    }else{
      if(values.connection){
        need(!HOST.filter(name=>name!=='connection').some(name=>values[name]),'GEOSERVER_CONNECTION_OR_WORKSPACE',
          'Use the running connection file or the original workspace configuration.');
        owner=await openGeoServerConsoleClient({connectionFile:absolute(values.connection),signal});
      }else owner=await openGeoServerOperator(host());
      const attached=Boolean(values.connection),invoke=(action,input)=>attached?owner.run(action,input,{signal}):owner[action](input,{signal});
      if(command==='inspect')result=await owner.inspect(values.operation&&operationId(values.operation),{signal});
      else if(command==='target')result=attached?await owner.target({signal}):await owner.describe();
      else if(command==='source'){need(attached,'GEOSERVER_CONNECTION_REQUIRED');result=await owner.source({
        directory:absolute(required('directory')),...(values['manifest-sha256']?{manifestSha256:hash(values['manifest-sha256'])}:{})},{signal});}
      else if(command==='cancel'){need(attached,'GEOSERVER_CONNECTION_REQUIRED');result=await owner.cancel({operationId:operationId(required('operation'))},{signal});}
      else if(command==='prepare'||command==='rollback-prepare')result=await invoke(command==='prepare'?'prepare':'prepareRollback',
        await requestFile(required('request'),signal));
      else if(command==='apply')result=await invoke('apply',{operationId:operationId(required('operation')),reviewSha256:hash(required('review-sha256'))});
      else if(command==='reconcile'||command==='receive')result=await invoke(command,{operationId:operationId(required('operation'))});
      else if(command==='export')result=await invoke('exportReceiving',{operationId:operationId(required('operation')),
        directory:absolute(required('out')),...(values.archive?{archiveFile:absolute(values.archive)}:{})});
    }
  }catch(error){primary??=error;if(!owner&&typeof error.close==='function')owner={close:error.close};}
  // The same owner and handlers remain present until all retained native work
  // has drained, including a retryable first close failure.
  try{
    if(owner)while(true){
      try{await owner.close();break;}
      catch(error){closeIssue??=error;await pause(250);}
    }
    primary??=closeIssue;
    if(!primary&&command!=='serve')await write(stdout,result);
  }catch(error){primary??=error;}
  finally{
    stdout.removeListener('error',outputError);
    if(processSignals){process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}
    externalSignal?.removeEventListener('abort',external);
  }
  if(primary){if(signalNumber)primary.exitCode=128+signalNumber;throw primary;}
  return {...(result&&typeof result==='object'?result:{result}),exitCode:signalNumber?128+signalNumber:0};
}
export async function main(argv=process.argv.slice(2)){
  try{const result=await runGeoServerCli(argv);process.exitCode=result.exitCode??0;return result;}
  catch(error){
    try{process.stderr.write(JSON.stringify({error:{code:error.code??error.name,message:error.message,
      ...(error.cancellationError?{cancellationError:error.cancellationError}:{}),...(error.cleanupError?{cleanupError:error.cleanupError}:{})}})+'\n');}catch{}
    process.exitCode=error.exitCode??2;return {error,exitCode:process.exitCode};
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
