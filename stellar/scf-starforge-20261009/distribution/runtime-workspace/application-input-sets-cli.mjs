// MIT. Companion source CLI uses the shared complete-tree source reader.
import {resolve} from 'node:path';
import {need} from './storage.mjs';
import {retainApplicationInputSetDirectory} from './application-input-set-sources.mjs';
export {readApplicationInputSetDirectory,retainApplicationInputSetDirectory} from './application-input-set-sources.mjs';
export const applicationInputSetHelp=[
  '  runtime-workspace input-sets --workspace DIRECTORY [--query TEXT --offset 0 --limit 20]',
  '  runtime-workspace input-set-import --workspace DIRECTORY --directory COMPLETE_SOURCE_FOLDER [--name NAME]',
  '  runtime-workspace input-set-status --workspace DIRECTORY --set-id SHA256',
  '  runtime-workspace input-set-prepare --workspace DIRECTORY --set-id SHA256 --request-id UUID --kind APPLICATION_KIND --field PATH_SETTING [--member RELATIVE_FILE]',
  '  runtime-workspace input-set-selection --workspace DIRECTORY --request-id UUID',
  '  runtime-workspace input-set-export --workspace DIRECTORY --set-id SHA256 --output PRIVATE_EXPORT_DIRECTORY',
].join('\n');
export const applicationInputSetCommands={
  'input-sets':['--workspace','--query','--offset','--limit'],
  'input-set-import':['--workspace','--directory','--name'],
  'input-set-status':['--workspace','--set-id'],
  'input-set-prepare':['--workspace','--set-id','--request-id','--kind','--field','--member'],
  'input-set-selection':['--workspace','--request-id'],
  'input-set-export':['--workspace','--set-id','--output'],
};
export async function runApplicationInputSetCommand(model,command,options) {
  const required=key=>{need(options[key],'APPLICATION_INPUT_SET_ARGUMENT_REQUIRED',key+' is required.');return options[key];};
  if(command==='input-sets')return model.applicationInputSetsState({query:options['--query']??'',offset:Number(options['--offset']??0),limit:Number(options['--limit']??20)});
  if(command==='input-set-import')return retainApplicationInputSetDirectory(model,{directory:resolve(required('--directory')),name:options['--name']});
  if(command==='input-set-status')return model.applicationInputSetInspect({setId:required('--set-id')});
  if(command==='input-set-selection')return model.applicationInputSetSelection({requestId:required('--request-id')});
  if(command==='input-set-prepare')return model.applicationInputSetPrepare({setId:required('--set-id'),requestId:required('--request-id'),
    kind:required('--kind'),field:required('--field'),memberPath:options['--member']??''});
  need(command==='input-set-export','APPLICATION_INPUT_SET_COMMAND_INVALID');
  return model.applicationInputSetExport({setId:required('--set-id'),directory:resolve(required('--output'))});
}
