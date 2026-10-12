// MIT. Fixed offline direct-Node source reader for the original SF36 worker.
import {fileURLToPath} from 'node:url';
import {Buyer} from '../sf88-operator-buyer-cli/node/client.mjs';
import {readNodeAttemptContext} from '../sf88-operator-buyer-cli/node/lost-output.mjs';
const schema='stellar-forge.sf36.node-attempt-context.v1';
try {
  const parts=[];let size=0;
  for await(const part of process.stdin){size+=part.length;if(size>65536)throw Object.assign(new Error(),{code:'NODE_CONTEXT_INPUT_TOO_LARGE'});parts.push(part);}
  const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='intentId,stateDirectory')
    throw Object.assign(new Error(),{code:'NODE_CONTEXT_INPUT_INVALID'});
  const buyer=new Buyer({runtimeDirectory:fileURLToPath(new URL('../sf88-operator-buyer-cli',import.meta.url)),
    stateDirectory:input.stateDirectory});
  const result=await readNodeAttemptContext(buyer.operation(input.intentId));
  process.stdout.write(JSON.stringify(result)+'\n');
} catch(error) {
  const code=/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'ORIGINAL_NODE_CONTEXT_INVALID';
  process.stdout.write(JSON.stringify({schema,error:code})+'\n');process.exitCode=2;
}
