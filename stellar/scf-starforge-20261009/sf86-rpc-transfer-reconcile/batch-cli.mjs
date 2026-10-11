#!/usr/bin/env node
// MIT. Original operator file -> retained RPC collection -> merchant proof directory.
import {prepareBatch,inspectBatch,collectBatch,exportBatch} from './batch.mjs';
import {ReconciliationError} from './terms.mjs';
import {reportBatch} from './batch-report.mjs';

const help=`SF86 retained transfer reconciliation
  prepare --plan /private/plan.json --directory /private/new-collection
  status --directory /private/collection
  collect --directory /private/collection [--retry JOB_ID ...]
  export --directory /private/collection --output /private/new-export
  report --directory /private/collection --outbox /private/sf98 --terms /private/prices.json --output /private/review [--resume]

collect resumes unattempted reads. --retry explicitly rechecks unsuccessful jobs.
export writes the original SF86 proof files in OUTPUT/proofs for merchant accounting.
report also runs the original merchant accounting writer into OUTPUT/accounting.
`;
export async function main(argv=process.argv.slice(2)) {
  if(argv.length===0||argv[0]==='--help'){process.stdout.write(help);return 0;}
  const command=argv[0],allowed={prepare:['--plan','--directory'],status:['--directory'],
    collect:['--directory','--retry'],export:['--directory','--output'],
    report:['--directory','--outbox','--terms','--output','--resume']}[command];
  if(!allowed)throw new ReconciliationError('COLLECTION_COMMAND_INVALID');
  const args={},retryIds=[];
  for(let i=1;i<argv.length;i++) {
    const key=argv[i];
    if(!allowed.includes(key)||(key!=='--retry'&&args[key]!==undefined))
      throw new ReconciliationError('COLLECTION_ARGUMENT_INVALID');
    if(key==='--resume'){args[key]=true;continue;}
    const value=argv[++i];
    if(!value||value.startsWith('--'))throw new ReconciliationError('COLLECTION_ARGUMENT_INVALID');
    if(key==='--retry')retryIds.push(value);else args[key]=value;
  }
  if(allowed.filter(key=>!['--retry','--resume'].includes(key)).some(key=>!args[key]))
    throw new ReconciliationError('COLLECTION_ARGUMENT_REQUIRED');
  const directory=args['--directory'];let result;
  if(command==='prepare')result=await prepareBatch({planFile:args['--plan'],directory});
  else if(command==='status')result=await inspectBatch({directory});
  else if(command==='export')result=await exportBatch({directory,output:args['--output']});
  else if(command==='report')result=await reportBatch({directory,output:args['--output'],
    outboxDir:args['--outbox'],termsFile:args['--terms'],resume:Boolean(args['--resume'])});
  else {
    const controller=new AbortController(),cancel=()=>controller.abort();
    process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
    try{result=await collectBatch({directory,retryIds,signal:controller.signal,
      onResult:job=>process.stderr.write(JSON.stringify({jobId:job.id,verdict:job.verdict,attempt:job.attempts})+'\n')});}
    finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
  }
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.cancelled)return 130;
  return command==='collect'&&(result.totals.unresolved||result.totals.unattempted)?2:0;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main()
  .then(code=>{process.exitCode=code;})
  .catch(error=>{
    const io={EEXIST:'COLLECTION_OUTPUT_ALREADY_EXISTS',ENOENT:'COLLECTION_INPUT_NOT_FOUND',
      EACCES:'COLLECTION_PERMISSION_DENIED',ENOSPC:'COLLECTION_STORAGE_FULL',
      SF98_DELIVERY_BUSY:'COLLECTION_BUSY'};
    process.stderr.write(JSON.stringify({error:error instanceof ReconciliationError?
      error.code:io[error.code]??'COLLECTION_OPERATION_FAILED'})+'\n');process.exitCode=2;
  });
