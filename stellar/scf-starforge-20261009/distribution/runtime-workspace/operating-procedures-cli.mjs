// MIT. Complete original Runtime procedure input and export commands.
import { resolve } from 'node:path';
import { regular, need } from './storage.mjs';
import { saveTextExport } from '../discovery/write-json.mjs';
import { RUNTIME_PROCEDURE_BODY_MAX_BYTES } from './operating-procedures.mjs';
export const runtimeProcedureHelp = [
  '  runtime-workspace procedure-state --workspace DIRECTORY [--storage-directory PRIVATE_BACKUPS]',
  '  runtime-workspace procedure-open --workspace DIRECTORY --procedure-id UUID',
  '  runtime-workspace procedure-create --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-save --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-record --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-return --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-decide --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-apply --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-receive --workspace DIRECTORY --request COMPLETE_JSON',
  '  runtime-workspace procedure-export --workspace DIRECTORY --procedure-id UUID --format json|html|plan-json|plan-html [--review-id UUID --output NEW_FILE]',
].join('\n');
const methods = {create:'runtimeProcedureCreate',save:'runtimeProcedureSave',record:'runtimeProcedureRecord',
  return:'runtimeProcedureReturn',decide:'runtimeProcedureDecide',apply:'runtimeProcedureApply',receive:'runtimeProcedureReceive'};
export const runtimeProcedureCommands = {
  'procedure-state':['--workspace','--storage-directory'],
  'procedure-open':['--workspace','--procedure-id'],
  ...Object.fromEntries(Object.keys(methods).map(k=>['procedure-'+k,['--workspace','--request']])),
  'procedure-export':['--workspace','--procedure-id','--format','--review-id','--output'],
};
export async function runRuntimeProcedureCommand(model,command,options){
  need(Object.hasOwn(runtimeProcedureCommands,command),'RUNTIME_PROCEDURE_COMMAND');
  if(command==='procedure-state')return model.runtimeProceduresState(
    options['--storage-directory']?{storageDirectory:resolve(options['--storage-directory'])}:{});
  if(command==='procedure-open'){
    need(options['--procedure-id'],'RUNTIME_PROCEDURE_ID_REQUIRED');
    return model.runtimeProcedureRead({procedureId:options['--procedure-id']});
  }
  if(command==='procedure-export'){
    need(options['--procedure-id']&&options['--format'],'RUNTIME_PROCEDURE_EXPORT_SELECTION');
    const value=await model.runtimeProcedureExport({procedureId:options['--procedure-id'],format:options['--format'],
      ...(options['--review-id']?{reviewId:options['--review-id']}:{})});
    if(!options['--output'])return value;
    const output=resolve(options['--output']);await saveTextExport(output,value.content);
    return {output,filename:value.filename,mediaType:value.mediaType,sha256:value.sha256,bytes:value.bytes};
  }
  need(options['--request'],'RUNTIME_PROCEDURE_REQUEST_REQUIRED','Keep the complete original JSON request and its requestId for exact continuation.');
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
    await regular(resolve(options['--request']),RUNTIME_PROCEDURE_BODY_MAX_BYTES)));
  return model[methods[command.slice('procedure-'.length)]](input);
}
