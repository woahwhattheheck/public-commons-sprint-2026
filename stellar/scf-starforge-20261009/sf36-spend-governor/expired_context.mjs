// MIT. Keyless original configuration/Node-source join for SF36 expiry recovery.
import {readFile,lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,execution,need} from '../sf88-operator-buyer-cli/config.mjs';
import {canonical,digest} from '../sf88-operator-buyer-cli/dataset-page.mjs';
import {readAttemptWireCheckpoint} from '../sf88-operator-buyer-cli/attempt-wire.mjs';
import {validateConfig as validateFacilitatorConfig} from '../native-facilitator/config.mjs';

const schema='stellar-forge.sf36.expired-attempt-context.v1';
try {
  const parts=[];let size=0;
  for await(const part of process.stdin) {
    size+=part.length;need(size<=65536,'EXPIRY_NATIVE_CONTEXT_INPUT_TOO_LARGE');parts.push(part);
  }
  const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
  need(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).sort().join(',')==='attemptFile,configurationFile,facilitatorConfigurationFile,sourceKind'&&
    ['dataset','node-operation'].includes(input.sourceKind),'EXPIRY_NATIVE_CONTEXT_INPUT_INVALID');
  for(const p of [input.configurationFile,input.attemptFile,input.facilitatorConfigurationFile])
    need(typeof p==='string'&&resolve(p)===p,'EXPIRY_NATIVE_CONTEXT_PATH_INVALID');
  const raw=await readFile(input.configurationFile),cfg=await config(input.configurationFile);
  const {op}=execution(cfg),attemptRaw=await readFile(input.attemptFile);
  const facilitatorRaw=await readFile(input.facilitatorConfigurationFile);
  const facilitator=validateFacilitatorConfig(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(facilitatorRaw)));
  need(facilitator.signers.length===1&&facilitator.feeBumpSigner===null,
    'EXPIRY_ORIGINAL_SINGLE_NATIVE_SUBMITTER_REQUIRED');
  need(facilitator.network===op.expect.network&&facilitator.payments.assets.includes(op.expect.asset)&&
    facilitator.payments.recipients.includes(op.expect.payTo)&&
    facilitator.payments.paymentFlows.includes('authorization'),'EXPIRY_NATIVE_FACILITATOR_TERMS_MISMATCH');
  const attempt=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(attemptRaw));
  need(attempt.intentId===op.intentId,'EXPIRY_NATIVE_ATTEMPT_ID_MISMATCH');
  const body=op.bodyFile?await readFile(op.bodyFile):Buffer.alloc(0);
  if(input.sourceKind==='dataset') {
    need(attempt.schema==='stellar-forge.sf88.dataset-attempt.v1'&&
      attempt.configurationSha256===digest(canonical(cfg)),'EXPIRY_NATIVE_DATASET_CONFIG_CHANGED');
  } else {
    const {Buyer}=await import('../sf88-operator-buyer-cli/node/client.mjs');
    const directory=dirname(input.configurationFile),stateDirectory=dirname(directory);
    const buyer=new Buyer({runtimeDirectory:fileURLToPath(new URL('../sf88-operator-buyer-cli',import.meta.url)),
      stateDirectory});
    const operation=buyer.operation(op.intentId),bound=await operation._bound();
    need(operation.directory===directory&&operation.configPath===input.configurationFile&&
      input.attemptFile===join(directory,'attempt.json')&&
      canonical(bound.config)===canonical(cfg)&&
      attempt.schema==='stellar-forge.node-buyer.v1'&&attempt.kind===undefined&&
      attempt.configSha256===bound.meta.configSha256&&attempt.bodySha256===bound.meta.bodySha256,
      'EXPIRY_NATIVE_NODE_SOURCE_CHANGED');
  }
  let wire=null;
  const directory=join(cfg.evidenceDir,'wire-'+digest(Buffer.from(op.intentId)));
  try {
    const info=await lstat(directory);need(info.isDirectory()&&!info.isSymbolicLink(),'EXPIRY_NATIVE_WIRE_PATH_INVALID');
    const original=await readAttemptWireCheckpoint({cfg,body});
    need(original.writerActive!==true,'EXPIRY_ORIGINAL_WIRE_WRITER_ACTIVE');
    wire={directory,sha256:digest(canonical(original))};
  } catch(error){if(error.code!=='ENOENT')throw error;}
  process.stdout.write(JSON.stringify({schema,sourceKind:input.sourceKind,intentId:op.intentId,
    configurationSha256:digest(canonical(cfg)),configurationBytesSha256:digest(raw),
    facilitatorConfigurationSha256:digest(facilitatorRaw),feePayer:facilitator.signers[0].address,
    attemptSha256:digest(attemptRaw),attemptStartedAt:attempt.startedAt??attempt.createdAt,
    bodyPresent:op.bodyFile!==undefined,bodyBytes:body.length,bodySha256:digest(body),wire})+'\n');
} catch(error) {
  const code=/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'EXPIRY_ORIGINAL_NATIVE_CONTEXT_INVALID';
  process.stdout.write(JSON.stringify({schema,error:code})+'\n');process.exitCode=2;
}
