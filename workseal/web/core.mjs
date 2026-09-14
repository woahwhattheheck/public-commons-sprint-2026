import { assertGitHubActionsExpected } from '../src/github_evidence_contract.mjs';

const encoder = new TextEncoder();

function normalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
    return value;
  }
  if (Array.isArray(value)) return value.map((v,i) => normalize(v, `${path}[${i}]`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error(`${path}.${key} is undefined`);
      out[key] = normalize(value[key], `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path} contains unsupported value`);
}
function assertExactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw new Error(`${name} field set mismatch`);
}
export function canonicalJson(value) { return JSON.stringify(normalize(value)); }
export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : encoder.encode(canonicalJson(value));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s=''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
function fromB64(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const raw = atob(value); return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export async function generateEd25519() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign','verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { publicKey: pair.publicKey, privateKey: pair.privateKey, publicKeySpkiBase64: b64(spki), fingerprint: await sha256HexBytes(spki) };
}
async function sha256HexBytes(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function signCanonical(value, privateKey) {
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(canonicalJson(value))));
  return b64(sig);
}
export async function verifyCanonical(value, signatureBase64, publicKeySpkiBase64) {
  const key = await crypto.subtle.importKey('spki', fromB64(publicKeySpkiBase64), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, fromB64(signatureBase64), encoder.encode(canonicalJson(value)));
}
export async function signedAcceptanceDigest(receipt, signatureBase64, authorityFingerprint) {
  return sha256Hex({ schema: 'workseal-signed-acceptance/v1', receiptDigest: await sha256Hex(receipt), receiptAuthorityFingerprint: authorityFingerprint, signatureBase64 });
}
export async function verifyBrowserBundle(bundle) {
  const keys = ['schema','task','result','receipt','signatureBase64','publicKeySpkiBase64','receiptAuthorityFingerprint','githubEvidence','githubExpected','settlementIntent'];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || Object.keys(bundle).sort().join('\0') !== keys.sort().join('\0')) throw new Error('bundle field set mismatch');
  if (bundle.schema !== 'workseal-browser-bundle/v1') throw new Error('bad bundle schema');
  assertExactKeys(bundle.task, ['schema','taskId','buyer','worker','currency','amountAtomic','deadline','acceptancePolicy'], 'task');
  assertExactKeys(bundle.task.buyer, ['id','settlementAddress'], 'task buyer');
  assertExactKeys(bundle.task.worker, ['id','settlementAddress'], 'task worker');
  assertExactKeys(bundle.task.acceptancePolicy, ['verifierId','verifierVersion','requirements'], 'acceptance policy');
  assertExactKeys(bundle.result, ['schema','taskDigest','workerId','generation','artifactDigest','evidence'], 'result');
  assertExactKeys(bundle.receipt, ['schema','taskDigest','resultDigest','generation','verifierId','verifierVersion','acceptedAt','verdict','checksDigest'], 'receipt');
  assertExactKeys(bundle.settlementIntent, ['schema','taskDigest','resultDigest','acceptanceDigest','receiptAuthorityFingerprint','generation','currency','amountAtomic','payer','payee','funding','eventHead'], 'settlement intent');
  assertExactKeys(bundle.settlementIntent.funding, ['chain','reference','currency','amountAtomic'], 'settlement funding');
  if (bundle.task.schema !== 'workseal-task/v1') throw new Error('bad task schema');
  if (bundle.result.schema !== 'workseal-result/v1') throw new Error('bad result schema');
  if (bundle.receipt.schema !== 'workseal-acceptance/v1' || bundle.receipt.verdict !== 'ACCEPT') throw new Error('bad acceptance receipt');
  if (bundle.settlementIntent.schema !== 'workseal-settlement-intent/v1') throw new Error('bad settlement intent schema');

  const taskDigest = await sha256Hex(bundle.task);
  if (bundle.result.taskDigest !== taskDigest) throw new Error('result task digest mismatch');
  if (bundle.result.workerId !== bundle.task.worker?.id) throw new Error('result worker mismatch');
  const resultDigest = await sha256Hex(bundle.result);
  if (bundle.receipt.taskDigest !== taskDigest || bundle.receipt.resultDigest !== resultDigest) throw new Error('receipt task/result digest mismatch');
  if (bundle.receipt.generation !== bundle.result.generation) throw new Error('receipt generation mismatch');

  const spki = fromB64(bundle.publicKeySpkiBase64);
  const fp = await sha256HexBytes(spki);
  if (fp !== bundle.receiptAuthorityFingerprint) throw new Error('authority fingerprint mismatch');
  if (!(await verifyCanonical(bundle.receipt, bundle.signatureBase64, bundle.publicKeySpkiBase64))) throw new Error('acceptance signature invalid');

  const evidence = assertGitHubActionsExpected(bundle.githubEvidence, bundle.githubExpected);
  const evidenceDigest = await sha256Hex(evidence);
  const githubEntries = bundle.result.evidence?.filter(entry => entry?.id === 'github-actions') ?? [];
  if (githubEntries.length !== 1 || githubEntries[0].digest !== evidenceDigest) throw new Error('result evidence digest mismatch');
  const acceptanceDigest = await signedAcceptanceDigest(bundle.receipt, bundle.signatureBase64, fp);

  if (bundle.settlementIntent.taskDigest !== taskDigest || bundle.settlementIntent.resultDigest !== resultDigest) throw new Error('settlement task/result digest mismatch');
  if (bundle.settlementIntent.generation !== bundle.result.generation) throw new Error('settlement generation mismatch');
  if (bundle.settlementIntent.currency !== bundle.task.currency || bundle.settlementIntent.amountAtomic !== bundle.task.amountAtomic) throw new Error('settlement amount/currency mismatch');
  if (bundle.settlementIntent.payer !== bundle.task.buyer.settlementAddress || bundle.settlementIntent.payee !== bundle.task.worker.settlementAddress) throw new Error('settlement party mismatch');
  if (bundle.settlementIntent.funding.currency !== bundle.task.currency || bundle.settlementIntent.funding.amountAtomic !== bundle.task.amountAtomic) throw new Error('settlement funding mismatch');
  if (bundle.settlementIntent.acceptanceDigest !== acceptanceDigest) throw new Error('settlement acceptance digest mismatch');
  if (bundle.settlementIntent.receiptAuthorityFingerprint !== fp) throw new Error('settlement authority mismatch');
  if (bundle.receipt.checksDigest !== await sha256Hex([{ id: 'github-actions', ok: true, evidenceDigest }])) throw new Error('checks digest mismatch');
  return { verdict: 'PASS', taskDigest, resultDigest, evidenceDigest, acceptanceDigest, settlementIntentDigest: await sha256Hex(bundle.settlementIntent), writePerformed: false, externalAuthorityGranted: false };
}

export async function buildDemoBundle() {
  const key = await generateEd25519();
  const rawResponseDigest = await sha256Hex('retained github api response bytes');
  const workflowDigest = await sha256Hex('name: WorkSeal CI\nrun: npm test\n');
  const githubEvidence = {
    schema:'workseal-github-actions-evidence/v1', repository:'Example/WorkSeal', workflowPath:'.github/workflows/workseal.yml', workflowDigest,
    runId:'424242', attempt:'1', headSha:'0123456789abcdef0123456789abcdef01234567', event:'push', status:'completed', conclusion:'success',
    createdAt:'2026-09-14T23:00:00Z', updatedAt:'2026-09-14T23:02:00Z', observedAt:'2026-09-14T23:03:00Z',
    sourceApiUrl:'https://api.github.com/repos/example/workseal/actions/runs/424242', rawResponseDigest,
    jobs:[{name:'test', conclusion:'success', startedAt:'2026-09-14T23:00:10Z', completedAt:'2026-09-14T23:01:50Z', steps:[{number:1,name:'checkout',conclusion:'success'},{number:2,name:'npm test',conclusion:'success'}]}],
  };
  const githubExpected = { repository:'example/workseal', workflowPath:'.github/workflows/workseal.yml', workflowDigest, headSha:githubEvidence.headSha, event:'push', requiredJobs:['test'] };
  const evidence = assertGitHubActionsExpected(githubEvidence, githubExpected);
  const evidenceDigest = await sha256Hex(evidence);
  const task = {
    schema:'workseal-task/v1', taskId:'browser-demo',
    buyer:{id:'buyer:demo',settlementAddress:'DEMO_BUYER_NO_CHAIN_WRITE'},
    worker:{id:'worker:demo',settlementAddress:'DEMO_WORKER_NO_CHAIN_WRITE'},
    currency:'SOL_LAMPORTS', amountAtomic:'25000000', deadline:'2026-10-12T23:59:59Z',
    acceptancePolicy:{verifierId:'workseal-browser-demo',verifierVersion:'1',requirements:[{id:'github-actions',description:'Pinned GitHub Actions evidence passes'}]},
  };
  const taskDigest = await sha256Hex(task);
  const result = {
    schema:'workseal-result/v1', taskDigest, workerId:task.worker.id, generation:1,
    artifactDigest:await sha256Hex('demo artifact'), evidence:[{id:'github-actions',digest:evidenceDigest}],
  };
  const resultDigest = await sha256Hex(result);
  const checks = [{ id:'github-actions', ok:true, evidenceDigest }];
  const receipt = { schema:'workseal-acceptance/v1', taskDigest, resultDigest, generation:1, verifierId:task.acceptancePolicy.verifierId, verifierVersion:task.acceptancePolicy.verifierVersion, acceptedAt:'2026-09-14T23:04:00Z', verdict:'ACCEPT', checksDigest:await sha256Hex(checks) };
  const signatureBase64 = await signCanonical(receipt, key.privateKey);
  const acceptanceDigest = await signedAcceptanceDigest(receipt, signatureBase64, key.fingerprint);
  const settlementIntent = {
    schema:'workseal-settlement-intent/v1', taskDigest, resultDigest, acceptanceDigest, receiptAuthorityFingerprint:key.fingerprint,
    generation:1, currency:task.currency, amountAtomic:task.amountAtomic, payer:task.buyer.settlementAddress, payee:task.worker.settlementAddress,
    funding:{chain:'solana-devnet', reference:'DEMO_ONLY', currency:task.currency, amountAtomic:task.amountAtomic}, eventHead:await sha256Hex('demo event head'),
  };
  return { schema:'workseal-browser-bundle/v1', task, result, receipt, signatureBase64, publicKeySpkiBase64:key.publicKeySpkiBase64, receiptAuthorityFingerprint:key.fingerprint, githubEvidence, githubExpected, settlementIntent };
}
