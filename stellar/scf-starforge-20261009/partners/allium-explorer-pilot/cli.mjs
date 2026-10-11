// MIT. Operator CLI. Allium acquisition is separate from buyer payment and delivery.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beginRun, collectRun, importResult, readProduct, readRun, recoverRun } from './explorer.mjs';

const HELP=`Allium → original SF30 dataset (Node 22+)
  inspect --product FILE
  import --product FILE --result ALLIUM_JSON --out NEW_DIRECTORY
  start --product FILE --state NEW_DIRECTORY
  collect --state DIRECTORY
  status --state DIRECTORY
  recover --state DIRECTORY --run-id ACTUAL_EXISTING_RUN_ID

start is one authenticated Allium saved-query execution and may consume the
operator's Allium credits. collect reads status once and fetches completed results.
import and status are offline. No command creates a wallet or pays an x402 provider.
Run one operator command at a time for each private run directory.`;
const OPTIONS={inspect:['--product'],import:['--product','--result','--out'],start:['--product','--state'],
  collect:['--state'],status:['--state'],recover:['--state','--run-id']};
export async function main(argv=process.argv.slice(2)) {
  if (argv.length===1 && argv[0]==='--help') {console.log(HELP);return;}
  const [command,...args]=argv, allowed=OPTIONS[command];
  if (!allowed) throw new TypeError(HELP);
  const options={};
  for(let i=0;i<args.length;i+=2) {
    if(!allowed.includes(args[i]) || Object.hasOwn(options,args[i]) || !args[i+1] || args[i+1].startsWith('--'))
      throw new TypeError('Unknown, duplicate or missing option');
    options[args[i]]=args[i+1];
  }
  if(allowed.some(k=>!options[k]))throw new TypeError('Missing required command option');
  let result;
  if(command==='inspect') {
    const c=await readProduct(options['--product']);
    result={schema:c.schema,name:c.name,queryId:c.queryId,sourceTable:c.sourceTable,columns:Object.keys(c.columns),
      rowLimit:c.maxRows,byteLimit:c.maxResponseBytes,acquisition:'Saved Explorer query, X-API-KEY',
      delivery:'Original SF30 dataset engine; no automatic provider calls'};
  } else if(command==='import') result=await importResult(options['--product'],options['--result'],options['--out']);
  else if(command==='start') result=await beginRun(await readProduct(options['--product']),options['--state']);
  else if(command==='collect') result=await collectRun(options['--state']);
  else if(command==='recover') result=await recoverRun(options['--state'],options['--run-id']);
  else {
    const s=await readRun(options['--state']);
    result={status:s.status,runId:s.runId,createdAt:s.createdAt,lastCheckedAt:s.lastCheckedAt ?? null,
      snapshot:s.snapshot ?? null,error:s.error ?? null};
  }
  console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error instanceof TypeError?error.message:(error.code ?? 'ALLIUM_OPERATION_FAILED'));process.exitCode=1;});
