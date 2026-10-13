// MIT. Original buyer handoff readers used by the retained SF47 Operations host.
import {inspectHandoff,renderHandoff,MAX_BYTES,need} from '../../../scf-starforge-20261009/sf88-operator-buyer-cli/operations-handoff/contract.mjs';
import {inspectNodeOperations,renderNodeOperations,NODE_ACCOUNTING_EXPORT} from './node_buyer_handoff.mjs';
import {inspectCustomerUseReturn,renderCustomerUseReturn,CUSTOMER_USE_RETURN_SCHEMA,CUSTOMER_USE_RETURN_MAX_BYTES} from '../../../scf-starforge-20261009/sf88-operator-buyer-cli/collection-composer/customer-use-return.mjs';
const chunks=[];let size=0;
try{
  for await(const chunk of process.stdin){size+=chunk.length;need(size<=CUSTOMER_USE_RETURN_MAX_BYTES,'BUYER_HANDOFF_SIZE');chunks.push(chunk);}
  const raw=Buffer.concat(chunks);
  let schema;try{schema=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))?.schema;}catch{need(false,'BUYER_HANDOFF_JSON_INVALID');}
  const calendar=schema===CUSTOMER_USE_RETURN_SCHEMA,node=schema===NODE_ACCOUNTING_EXPORT;
  need(calendar||raw.length<=MAX_BYTES,'BUYER_HANDOFF_SIZE');
  const report=calendar?inspectCustomerUseReturn(raw):node?inspectNodeOperations(raw):inspectHandoff(raw);
  process.stdout.write(JSON.stringify({schema:'scf.operations.buyer-reader.v1',report,
    html:calendar?renderCustomerUseReturn(report):node?renderNodeOperations(report):renderHandoff(report)})+'\n');
}catch(error){process.stdout.write(JSON.stringify({error:{code:error.code??error.message??'BUYER_READER_FAILED'}})+'\n');process.exitCode=2;}
