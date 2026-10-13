// MIT. Source edition commands retain the complete native review and original request.
import {resolve} from 'node:path';
import {need,readJSON} from './storage.mjs';
import {retainInitializationRecord} from '../../sf88-operator-buyer-cli/initialization.mjs';
export const applicationInputEditionHelp=[
 '  runtime-workspace input-set-editions --workspace DIRECTORY [--selection-request-id UUID]',
 '  runtime-workspace input-set-review --workspace DIRECTORY --selection-request-id UUID [--name NAME --output REVIEW_JSON]',
 '  runtime-workspace input-set-capture --workspace DIRECTORY --request-id UUID --review REVIEW_JSON',
 '  runtime-workspace input-set-edition --workspace DIRECTORY --request-id UUID',
 '  runtime-workspace input-set-edition-received --workspace DIRECTORY --request-id UUID',
 '  runtime-workspace input-set-edition-export --workspace DIRECTORY --request-id UUID --output NEW_DIRECTORY',
 '  runtime-workspace input-set-edition-receive --workspace DIRECTORY --request-id UUID --directory COMPLETE_HANDOFF_DIRECTORY',
].join('\n');
export const applicationInputEditionCommands={
 'input-set-editions':['--workspace','--selection-request-id'],
 'input-set-review':['--workspace','--selection-request-id','--name','--output'],
 'input-set-capture':['--workspace','--request-id','--review'],
 'input-set-edition':['--workspace','--request-id'],
 'input-set-edition-received':['--workspace','--request-id'],
 'input-set-edition-export':['--workspace','--request-id','--output'],
 'input-set-edition-receive':['--workspace','--request-id','--directory'],
};
export async function runApplicationInputEditionCommand(model,command,options) {
 const required=key=>{need(options[key],'APPLICATION_INPUT_EDITION_ARGUMENT_REQUIRED',key+' is required.');return options[key];};
 if(command==='input-set-editions')return model.applicationInputSetEditionsState({selectionRequestId:options['--selection-request-id']});
 if(command==='input-set-review') {
  const result=await model.applicationInputSetEditionReview({selectionRequestId:required('--selection-request-id'),name:options['--name']});
  if(options['--output'])await retainInitializationRecord(resolve(options['--output']),result,{resume:true});
  return result;
 }
 if(command==='input-set-capture')return model.applicationInputSetEditionCapture({requestId:required('--request-id'),review:await readJSON(resolve(required('--review')))});
 if(command==='input-set-edition')return model.applicationInputSetEditionRead({requestId:required('--request-id')});
 if(command==='input-set-edition-received')return model.applicationInputSetEditionReceived({requestId:required('--request-id')});
 if(command==='input-set-edition-export')return model.applicationInputSetEditionExport({requestId:required('--request-id'),directory:resolve(required('--output'))});
 need(command==='input-set-edition-receive','APPLICATION_INPUT_EDITION_COMMAND_INVALID');
 return model.applicationInputSetEditionReceive({requestId:required('--request-id'),directory:resolve(required('--directory'))});
}
