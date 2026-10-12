#!/usr/bin/env node
// MIT. JSON boundary for the existing workbench; the parent owns storage and authentication.
import { parsePublisherCsv,previewPublisherImport,reviewPublisherImport,selectPeerCohort,compareEditions,publisherIntakeCsv,IntakeError } from './intake.mjs';
const command=process.argv[2];
if(command==='--help'||command==='help'){
  console.log('Publisher intake: columns | preview | review | cohort | compare | csv\nRead one JSON request from stdin. See README.md for the exact request envelopes.');
}else{
  try{
    let raw='';
    for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>64*1024*1024)throw new IntakeError('INPUT_TOO_LARGE','Request exceeds 64 MiB');}
    const input=JSON.parse(raw);
    const actions={
      columns:()=>{const parsed=parsePublisherCsv(input.csv,input);return {headers:parsed.headers,rows:parsed.records.length};},
      preview:()=>previewPublisherImport(input),
      review:()=>reviewPublisherImport(input.preview,input.review),
      cohort:()=>selectPeerCohort(input.edition,input.selection),
      compare:()=>compareEditions(input.previous,input.current),
      csv:()=>publisherIntakeCsv(input.edition),
    };
    if(!Object.prototype.hasOwnProperty.call(actions,command))throw new IntakeError('UNKNOWN_COMMAND','Use columns, preview, review, cohort, compare or csv');
    const result=actions[command]();
    process.stdout.write(command==='csv'?result:JSON.stringify(result)+'\n');
  }catch(error){
    process.stderr.write(JSON.stringify({error:error instanceof IntakeError?error.code:'INVALID_REQUEST',message:error.message,path:error.path??''})+'\n');
    process.exitCode=1;
  }
}
