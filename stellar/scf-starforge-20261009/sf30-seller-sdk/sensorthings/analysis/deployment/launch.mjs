#!/usr/bin/env node
// MIT. Start the original SensorThings listener without printing its private URL.
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {main as originalSensorThingsCli} from '../../cli.mjs';
import {fault,json} from '../../contract.mjs';

export const HELP=[
  'Helgoland analysis on the original SensorThings workspace.',
  '',
  'node analysis/deployment/launch.mjs serve --workspace ABSOLUTE_DIRECTORY',
  '  --session-file ABSOLUTE_PRIVATE_URL_FILE [--host 127.0.0.1|::1] [--port NUMBER]',
  '  [--expected-workspace-id ORIGINAL_UUID] [--source-inbox ABSOLUTE_DIRECTORY]',
  '',
  'This delegates the original CLI, store lease, listener and saved private session.',
  'The startup record contains the origin and session-file path, never the token.',
  'Open /analysis/ on that same origin, preserving the existing private URL fragment.',
  'Use the original CLI connect/action/download commands for every operation.',
  'A running original Desk already owns this workspace; do not start another writer.'
].join('\n');
export async function main(argv=process.argv.slice(2),{emit=value=>process.stdout.write(json(value))}={}){
  if(!argv.length||argv.includes('--help')){process.stdout.write(HELP+'\n');return null;}
  if(argv[0]!=='serve')throw fault('VIEWER_LAUNCH','Use serve here; other commands remain in the original SensorThings CLI.');
  const positions=argv.map((value,index)=>value==='--session-file'?index:-1).filter(index=>index>=0);
  if(positions.length!==1||!argv[positions[0]+1]||!isAbsolute(argv[positions[0]+1]))
    throw fault('VIEWER_LAUNCH','Select one absolute private session-file path before starting the original listener.');
  return originalSensorThingsCli(argv,{emit:record=>{
    if(!record||record.ownership!=='ORIGINAL_SENSORTHINGS_WORKSPACE'||!record.sessionFile)
      throw fault('VIEWER_LAUNCH','The original listener did not retain its selected private session file.',409);
    emit({schema:'stellar-forge.sensorthings-analysis-startup.v1',workspaceId:record.workspaceId,origin:record.origin,
      pid:record.pid,sessionFile:record.sessionFile,analysisPath:'/analysis/',ownership:record.ownership,fileReads:record.fileReads,
      session:'Use the existing local operator and the private session file. No bearer token is included in this startup record.'});
  }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let outputFailure=null,lastWrite=Promise.resolve();
  const failed=error=>{
    outputFailure??=error;
    // The original serve command registered its shutdown owner before emitting.
    // Ask that owner to drain the same listener; never force process.exit().
    if(process.listenerCount('SIGTERM'))process.emit('SIGTERM');
  };
  const write=(stream,bytes)=>new Promise((resolveWrite,reject)=>{
    try{stream.write(bytes,error=>error?reject(error):resolveWrite());}catch(error){reject(error);}
  });
  process.stdout.on('error',failed);process.stderr.on('error',failed);
  main(process.argv.slice(2),{emit:value=>{
    lastWrite=write(process.stdout,json(value));void lastWrite.catch(failed);
  }}).then(async()=>{
    await lastWrite;if(outputFailure)process.exitCode=1;
  }).catch(async error=>{
    if(!outputFailure)await write(process.stderr,json({error:typeof error.code==='string'&&/^SENSORTHINGS_[A-Z_]+$/.test(error.code)?
      error.code:'SENSORTHINGS_VIEWER_LAUNCH_FAILED',
      message:'The original deployment did not complete. Retain its workspace and private session file while resolving this error code.'})).catch(failed);
    process.exitCode=1;
  }).finally(()=>{
    process.stdout.off('error',failed);process.stderr.off('error',failed);
  });
}
