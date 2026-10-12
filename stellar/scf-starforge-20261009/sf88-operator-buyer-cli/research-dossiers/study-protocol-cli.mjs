#!/usr/bin/env node
// MIT. Terminal entrypoint for the original protocol capture and receiving arm.
import {parseArgs} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need} from '../node/store.mjs';
import {captureStudyProtocol,inspectStudyProtocolCapture} from './study-protocol-source.mjs';
import {receiveStudyProtocol,inspectStudyProtocolReceiving} from './study-protocol-receiving.mjs';

export async function runStudyProtocolCommand(argv){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{
    directory:{type:'string'},'study-file':{type:'string'},capture:{type:'string'},
    connection:{type:'string'},'workspace-id':{type:'string'},dossier:{type:'string'},question:{type:'string'},
    'base-revision':{type:'string'},operation:{type:'string'},pdftotext:{type:'string'},pdfinfo:{type:'string'},
    'engine-source':{type:'string'},help:{type:'boolean'}
  }});
  if(values.help||!positionals.length)return {commands:{
    capture:'capture --study-file ABS_REGISTRY --directory ABS_CAPTURE [--operation ID]',
    receive:'receive --capture ABS_CAPTURE --directory ABS_RECEIVING --connection ABS_CONNECTION --workspace-id ID --dossier ID --question ID --base-revision N [--operation ID]',
    run:'run --study-file ABS_REGISTRY --directory ABS_OPERATION --connection ABS_CONNECTION --workspace-id ID --dossier ID --question ID --base-revision N [--operation ID]',
    inspect:'inspect-capture --directory ABS_CAPTURE | inspect-receiving --directory ABS_RECEIVING',
    engine:'receive or run accepts --engine-source ABS_COMPLETE_ENGINE_MANIFEST; an omitted option resumes the saved selection or uses the original frozen engine'
  }};
  need(positionals.length===1&&typeof values.directory==='string','PROTOCOL_COMMAND_DIRECTORY_REQUIRED');
  const command=positionals[0],directory=resolve(values.directory);
  const operation=values.operation??'DBC61-SCF-STUDY-EXTRACTION-20261012-PROTOCOL';
  if(command==='inspect-capture')return (await inspectStudyProtocolCapture(directory)).complete;
  if(command==='inspect-receiving')return inspectStudyProtocolReceiving(directory);
  need(['capture','receive','run'].includes(command),'PROTOCOL_COMMAND_INVALID');
  const captureDirectory=command==='run'?join(directory,'capture'):
    command==='capture'?directory:values.capture?resolve(values.capture):null;
  if(command==='capture'||command==='run'){
    need(typeof values['study-file']==='string','PROTOCOL_ORIGINAL_STUDY_FILE_REQUIRED');
    const captured=await captureStudyProtocol({studyFile:resolve(values['study-file']),directory:captureDirectory,operation,
      ...(values.pdftotext?{pdftotext:values.pdftotext}:{}),...(values.pdfinfo?{pdfinfo:values.pdfinfo}:{})});
    if(command==='capture')return captured;
  }
  need(captureDirectory&&typeof values.connection==='string'&&
    typeof values['base-revision']==='string'&&/^[1-9][0-9]*$/.test(values['base-revision']),
    'PROTOCOL_EXISTING_CONNECTION_SELECTION_REQUIRED');
  return receiveStudyProtocol({captureDirectory,directory:command==='run'?join(directory,'receiving'):directory,
    connectionFile:resolve(values.connection),expectedWorkspaceId:values['workspace-id'],
    dossierId:values.dossier,questionId:values.question,baseRevision:Number(values['base-revision']),operation,
    ...(values['engine-source']?{engineSourceFile:resolve(values['engine-source'])}:{})});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await runStudyProtocolCommand(process.argv.slice(2));process.stdout.write(JSON.stringify(result,null,2)+'\n');}
  catch(error){process.stderr.write(JSON.stringify({error:error.code??error.message,
    ...(error.details?{details:error.details}: {})})+'\n');process.exitCode=1;}
}
