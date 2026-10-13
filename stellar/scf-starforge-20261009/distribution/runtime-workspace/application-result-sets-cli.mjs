// MIT. Explicit result file capture in the original Runtime workspace.
import {resolve} from 'node:path';
import {need,readJSON} from './storage.mjs';
import {retainInitializationRecord} from '../../sf88-operator-buyer-cli/initialization.mjs';
export const applicationResultSetHelp=[
 '  runtime-workspace result-sets --workspace DIRECTORY [--application-id ID --offset 0 --limit 20]',
 '  runtime-workspace result-set-review --workspace DIRECTORY --application-id ID --operation-id UUID --directory RESULT_FOLDER --name NAME --actor OPERATOR --note REASON --output NEW_REVIEW_JSON',
 '  runtime-workspace result-set-capture --workspace DIRECTORY --request-id UUID --review ORIGINAL_REVIEW_JSON',
 '  runtime-workspace result-set --workspace DIRECTORY --request-id UUID',
 '  runtime-workspace result-set-export --workspace DIRECTORY --request-id UUID --output NEW_DIRECTORY [--origin capture|received]',
 '  runtime-workspace result-set-receive --workspace DIRECTORY --request-id UUID --directory COMPLETE_HANDOFF_DIRECTORY',
 '  runtime-workspace result-set-received --workspace DIRECTORY --request-id UUID',
].join('\n');
export const applicationResultSetCommands={
 'result-sets':['--workspace','--application-id','--offset','--limit'],
 'result-set-review':['--workspace','--application-id','--operation-id','--directory','--name','--actor','--note','--output'],
 'result-set-capture':['--workspace','--request-id','--review'],
 'result-set':['--workspace','--request-id'],
 'result-set-export':['--workspace','--request-id','--output','--origin'],
 'result-set-receive':['--workspace','--request-id','--directory'],
 'result-set-received':['--workspace','--request-id'],
};
export async function runApplicationResultSetCommand(model,command,options) {
 const required=key=>{need(options[key],'APPLICATION_RESULT_ARGUMENT_REQUIRED',key+' is required.');return options[key];};
 if(command==='result-sets')return model.applicationResultSetsState({
  ...(options['--application-id']?{applicationId:options['--application-id']}:{}),
  ...(options['--offset']!==undefined?{offset:Number(options['--offset'])}:{}),
  ...(options['--limit']!==undefined?{limit:Number(options['--limit'])}:{})});
 if(command==='result-set-review') {
  const output=resolve(required('--output'));
  const result=await model.applicationResultSetReview({applicationId:required('--application-id'),
   operationId:required('--operation-id'),directory:resolve(required('--directory')),name:required('--name'),
   actor:required('--actor'),note:required('--note')});
  // Retain the complete original review before a later capture command. An
  // existing different review file is never overwritten.
  await retainInitializationRecord(output,result,{resume:true});
  return {reviewFile:output,review:result};
 }
 if(command==='result-set-capture')return model.applicationResultSetCapture({
  requestId:required('--request-id'),review:await readJSON(resolve(required('--review')))});
 if(command==='result-set')return model.applicationResultSetRead({requestId:required('--request-id')});
 if(command==='result-set-received')return model.applicationResultSetReceived({requestId:required('--request-id')});
 if(command==='result-set-export')return model.applicationResultSetExport({requestId:required('--request-id'),
  directory:resolve(required('--output')),origin:options['--origin']??'capture'});
 need(command==='result-set-receive','APPLICATION_RESULT_COMMAND_INVALID');
 return model.applicationResultSetReceive({requestId:required('--request-id'),directory:resolve(required('--directory'))});
}
