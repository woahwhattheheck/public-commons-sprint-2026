// MIT. Native file intake and original-byte export through Runtime's maintained model.
import { resolve } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { retainApplicationInputFile } from './application-inputs.mjs';
import { need } from './storage.mjs';
export const applicationInputHelp = [
  '  runtime-workspace input-files --workspace DIRECTORY [--query TEXT --offset 0 --limit 30]',
  '  runtime-workspace input-file-import --workspace DIRECTORY --file ORIGINAL_FILE [--name FILENAME]',
  '  runtime-workspace input-file-status --workspace DIRECTORY --upload-id SHA256',
  '  runtime-workspace input-file-prepare --workspace DIRECTORY --upload-id SHA256 --request-id UUID --kind APPLICATION_KIND --field FILE_SETTING',
  '  runtime-workspace input-file-selection --workspace DIRECTORY --request-id UUID',
  '  runtime-workspace input-file-export --workspace DIRECTORY --upload-id SHA256 --output NEW_FILE',
].join('\n');
export const applicationInputCommands = {
  'input-files':['--workspace','--query','--offset','--limit'],
  'input-file-import':['--workspace','--file','--name'],
  'input-file-status':['--workspace','--upload-id'],
  'input-file-prepare':['--workspace','--upload-id','--request-id','--kind','--field'],
  'input-file-selection':['--workspace','--request-id'],
  'input-file-export':['--workspace','--upload-id','--output'],
};
export async function runApplicationInputCommand(model,command,options) {
  const required=key=>{need(options[key],'APPLICATION_INPUT_ARGUMENT_REQUIRED',key+' is required.');return options[key];};
  if(command==='input-files')return model.applicationInputsState({query:options['--query']??'',
    offset:Number(options['--offset']??0),limit:Number(options['--limit']??30)});
  if(command==='input-file-import')return retainApplicationInputFile(model,
    {path:resolve(required('--file')),name:options['--name']});
  if(command==='input-file-status')return model.applicationInputInspect({uploadId:required('--upload-id')});
  if(command==='input-file-selection')return model.applicationInputSelection({requestId:required('--request-id')});
  if(command==='input-file-prepare')return model.applicationInputPrepare({
    requestId:required('--request-id'),uploadId:required('--upload-id'),kind:required('--kind'),field:required('--field')});
  need(command==='input-file-export','APPLICATION_INPUT_COMMAND_INVALID');
  const target=resolve(required('--output')),source=await model.applicationInputDownload({uploadId:required('--upload-id')});
  let output,created=false,completed=false;
  try {
    output=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);created=true;
    for await(const part of source.stream)await output.writeFile(part);
    await output.sync();completed=true;
    return {path:target,bytes:source.bytes,sha256:source.sha256,uploadId:options['--upload-id']};
  } finally {
    source.stream.destroy();await source.close();if(output)await output.close();
    if(created&&!completed)await unlink(target).catch(()=>{});
  }
}
