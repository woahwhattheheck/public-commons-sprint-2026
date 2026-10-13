/** Namespaced small-message transport through the existing authenticated RPC. */
import {InputError} from './parse.mjs';
import {sourceList,sourceFiles,sourceFileChunk} from './large_sources.mjs';
import {beginIntake,putChunk,intakeStatus,listIntakes,prepareIntake,commitIntake,reconfigureIntake} from './large_intake.mjs';
import {exportEdition,listEditions,editionInfo,editionChunk,receiveIntake} from './large_delivery.mjs';
export async function largeOperation(w,method,parts,query,body={}){
 if(parts[0]==='intakes'){
  if(parts.length===1&&method==='GET')return {workspaceRevision:w.revision(),intakes:listIntakes(w)};
  if(parts.length===1&&method==='POST')return beginIntake(w,body);
  const id=parts[1];
  if(parts.length===2&&method==='GET')return {...intakeStatus(w,id),workspaceRevision:w.revision()};
  if(parts.length===2&&method==='PUT')return reconfigureIntake(w,id,body);
  if(parts.length===3&&parts[2]==='chunks'&&method==='PUT')return putChunk(w,id,body);
  if(parts.length===3&&parts[2]==='prepare'&&method==='POST')return {...prepareIntake(w,id),workspaceRevision:w.revision()};
  if(parts.length===3&&parts[2]==='commit'&&method==='POST')return commitIntake(w,id,body);
  if(parts.length===3&&parts[2]==='receive'&&method==='POST')return receiveIntake(w,id);
 }
 if(parts[0]==='sources'){
  if(parts.length===1&&method==='GET')return {sources:sourceList(w)};
  if(parts.length===2&&method==='GET')return sourceFiles(w,parts[1]);
  if(parts.length===5&&parts[2]==='files'&&method==='GET')return sourceFileChunk(w,parts[1],parts[3],Number(parts[4]));
 }
 if(parts[0]==='editions'){
  if(parts.length===1&&method==='GET')return {editions:listEditions(w)};
  if(parts.length===1&&method==='POST')return await exportEdition(w,body);
  if(parts.length===2&&method==='GET')return editionInfo(w,parts[1]);
  if(parts.length===5&&parts[2]==='files'&&method==='GET')return editionChunk(w,parts[1],parts[3],Number(parts[4]));
 }
 throw new InputError('Large-file operation not found',404);
}
