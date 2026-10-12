// MIT. Fixed offline reader of the original SF88 Dataset attempt contract.
// The original reader verifies the complete retained page/cursor lineage.
// This entry has no signer, ledger mutation, purchase or HTTP operation.
import {canonical, digest, object} from '../sf88-operator-buyer-cli/dataset-page.mjs';
const MAX_INPUT=65536;
const need=(value,code)=>{if(!value){const error=new Error(code);error.code=code;throw error;}};
let count=0;const chunks=[];
try {
  for await (const chunk of process.stdin) {
    count+=chunk.length;need(count<=MAX_INPUT,'DATASET_CONTEXT_INPUT_TOO_LARGE');chunks.push(chunk);
  }
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  need(object(input)&&typeof input.directory==='string'&&Number.isSafeInteger(input.index),
    'DATASET_CONTEXT_SELECTION_REQUIRED');
  const {readRetainedDatasetAttempt}=await import('../sf88-operator-buyer-cli/dataset-session.mjs');
  need(typeof readRetainedDatasetAttempt==='function','ORIGINAL_DATASET_READER_UNAVAILABLE');
  const {definition,cfg,attempt,sourceHashes,responseState}=
    await readRetainedDatasetAttempt(input.directory,input.index);
  const result={
    schema:'stellar-forge.sf36.dataset-attempt-context.v1',
    sessionId:definition.config.operation.intentId,
    sessionConfigurationSha256:definition.configurationSha256,
    pageConfigurationSha256:digest(canonical(cfg)),
    attemptCanonicalSha256:digest(canonical(attempt)),
    attemptId:sourceHashes.attempt,
    intentId:attempt.intentId,index:input.index,attemptStartedAt:attempt.startedAt,
    responsePath:cfg.responseFile.destination,
    evidenceDirectory:cfg.evidenceDir,
    requestUrl:cfg.operation.url,requestMethod:cfg.operation.method,
    requestBodyPresent:cfg.operation.bodyFile!==undefined,
    workspaceDirectory:definition.workspaceDirectory??null,
    sourceHashes,responseState
  };
  const output=JSON.stringify(result);
  need(Buffer.byteLength(output)<=4_000_000,'DATASET_CONTEXT_RESULT_TOO_LARGE');
  console.log(output);
} catch(error) {
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code)?
    error.code:'DATASET_CONTEXT_INVALID';
  console.log(JSON.stringify({error:code}));process.exitCode=2;
}
