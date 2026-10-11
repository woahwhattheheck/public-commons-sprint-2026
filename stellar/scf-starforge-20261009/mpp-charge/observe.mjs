// MIT. Fixed read-only SF86 observer called by the original-key operator worker.
import { loadNative } from './runtime.mjs';
import { observeTransfer } from './transfer.mjs';
import { requireValue } from './storage.mjs';
try {
  const chunks=[]; let length=0;
  for await(const chunk of process.stdin) {
    length+=chunk.length; requireValue(length<=300000,'MPP_OBSERVER_INPUT_TOO_LARGE'); chunks.push(chunk);
  }
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const native=await loadNative(input.dependencyRoot);
  console.log(JSON.stringify(await observeTransfer({...input,native})));
} catch(error) {
  console.log(JSON.stringify({outcome:'OBSERVATION_FAILED',error:error.code??'MPP_OBSERVER_EXECUTION_FAILED'}));
  process.exitCode=2;
}
