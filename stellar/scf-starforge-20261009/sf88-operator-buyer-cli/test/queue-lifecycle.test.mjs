// MIT — One local filesystem lifecycle; original buyer abort path, no payment.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {initializeQueue, openQueue, saveQueueReport} from '../queue.mjs';
import {renderQueueReport} from '../queue-report.mjs';
import {OperatorApprovedBuyer, checkOperatorTerminal} from '../../sf81-buyer-operator-bridge/bridge.mjs';
import {executeWithEvidence} from '../../sf82-checkout-evidence/evidence.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const dir = await mkdtemp(join(tmpdir(), 'sf88-inbox-'));
await chmod(dir, 0o700);
const root = join(dir, 'inbox'), evidenceDir = join(dir, 'evidence');
await mkdir(evidenceDir, {mode:0o700});
const body = join(dir, 'input.bin'), signer = join(dir, 'signer.mjs'), policy = join(dir, 'policy.json');
await writeFile(body, 'original request bytes', {mode:0o600});
await writeFile(signer, 'export async function sign(){throw new Error("SIGNER_MUST_NOT_BE_CALLED");}\n', {mode:0o600});
await writeFile(policy, '{}\n', {mode:0o600});
const base = {
  operation:{intentId:'local-intake-1', url:'https://operator-owned.invalid/resource', method:'POST',
    bodyFile:body, headers:{'Content-Type':'application/octet-stream'},
    expect:{scheme:'exact',network:'stellar:testnet',asset:'local-asset',payTo:'local-recipient',maxAtomic:'1'}},
  operator:{python:'/usr/bin/python3',actor:'local-operator',service:'local-exercise',policy,ledger:join(dir,'original-ledger.sqlite')},
  signerModule:signer,evidenceDir,captureBody:false,
};
async function input(intentId, patch = {}) {
  const path = join(dir, intentId + '.json');
  const c = {...base, ...patch, operation:{...base.operation,intentId,...patch.operation}};
  await writeFile(path, JSON.stringify(c,null,2)+'\n', {mode:0o600});
  return path;
}
await initializeQueue(root);
const queue = await openQueue(root), configPath = await input('local-intake-1');
const first = await queue.enqueue(configPath);
assert.equal(first.state, 'QUEUED');
assert.equal((await queue.enqueue(configPath)).disposition, 'EXISTING_IDENTICAL_INTENT');
await writeFile(body, 'later changed original file');
assert.equal((await queue.show('local-intake-1')).bodySha256, sha('original request bytes'));
await assert.rejects(queue.enqueue(configPath), {code:'INBOX_INTENT_CONFLICT'});

// Original SF88 loads its trusted signer then refuses absent operator keys.
// Two competing callers must not both enter that original execution path.
const names = ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const saved = names.map(k => process.env[k]);
let terminalAvailable = true;
try { await checkOperatorTerminal('local-intake-1'); }
catch (error) {
  assert.equal(error.code, 'OPERATOR_CONTROLLING_TERMINAL_REQUIRED');
  terminalAvailable = false;
}
for (const key of names) delete process.env[key];
try {
  if (terminalAvailable) {
    const attempts = await Promise.allSettled([queue.run('local-intake-1'), queue.run('local-intake-1')]);
    assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(x => x.status === 'rejected').reason.code, 'INBOX_ATTEMPT_ALREADY_EXISTS');
    assert.equal((await queue.show('local-intake-1')).state, 'ATTEMPT_RECORDED');
    assert.ok((await queue.show('local-intake-1')).lastError);
    await assert.rejects(queue.run('local-intake-1'), {code:'INBOX_ATTEMPT_ALREADY_EXISTS'});
  } else {
    await assert.rejects(queue.run('local-intake-1'), {code:'OPERATOR_CONTROLLING_TERMINAL_REQUIRED'});
    const retained = await queue.show('local-intake-1');
    assert.equal(retained.state, 'QUEUED');
    assert.equal(retained.attempt, null);
  }
} finally {
  names.forEach((key,i) => {if(saved[i] === undefined) delete process.env[key]; else process.env[key]=saved[i];});
}
await queue.enqueue(await input('local-policy-drift'));
await writeFile(policy, '{"operatorChanged":true}\n');
await assert.rejects(queue.run('local-policy-drift'), {code:'INBOX_DEPENDENCY_CHANGED_REVIEW_REQUIRED'});
assert.equal((await queue.show('local-policy-drift')).state, 'QUEUED');
await writeFile(policy, '{}\n');
assert.equal((await queue.cancel('local-policy-drift')).state, 'CANCELLED');
await assert.rejects(queue.run('local-policy-drift'), {code:'INBOX_ATTEMPT_ALREADY_EXISTS'});

// Retained interrupted-attempt state is the recovery input. Produce its evidence
// through ORIGINAL SF81/SF82, whose already-aborted call cannot sign or do I/O.
const interrupted = await queue.enqueue(await input('local-recovery'));
const startedAt = new Date().toISOString(), marker = join(root,'jobs',interrupted.id,'attempt.json');
await writeFile(marker, JSON.stringify({schema:interrupted.schema,kind:'EXECUTE',id:'retained-interrupted-attempt',
  intentId:'local-recovery',configSha256:interrupted.configSha256,startedAt}), {mode:0o600,flag:'wx'});
const aborted = new AbortController(); aborted.abort();
const buyer = new OperatorApprovedBuyer({operator:{...base.operator,
  environment:Object.fromEntries(names.map(k => [k, 'unused-by-aborted-call']))}});
await executeWithEvidence({buyer, call:{intentId:'local-recovery',url:base.operation.url,
  sign(){throw new Error('SIGNER_MUST_NOT_BE_CALLED');},signal:aborted.signal},outputDir:evidenceDir});
assert.equal((await queue.show('local-recovery')).state, 'RUNNING_OR_INTERRUPTED');
const recovered = await queue.recover('local-recovery');
assert.equal(recovered.state,'RECOVERED');
assert.equal(recovered.recovery.originalOutcomeReport.outcomes[0].status,'BLOCKED_BEFORE_SIGNATURE');
assert.equal((await queue.recover('local-recovery')).recovery.evidenceSha256,recovered.recovery.evidenceSha256);
await assert.rejects(queue.run('local-recovery'), {code:'INBOX_ATTEMPT_ALREADY_EXISTS'});

const jobs = await queue.list();
assert.equal(jobs.length,3);
const html = renderQueueReport({jobs,queueRoot:root});
assert.ok(html.includes('local-recovery') && html.includes('BLOCKED_BEFORE_SIGNATURE'));
assert.ok(!html.includes('original request bytes'));
await saveQueueReport(join(dir,'inbox.html'),html);
await assert.rejects(saveQueueReport(join(dir,'inbox.html'),html), {code:'EEXIST'});
const cli = new URL('../queue-cli.mjs',import.meta.url);
const result = spawnSync(process.execPath,[cli.pathname,'list','--root',root], {encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
assert.equal(JSON.parse(result.stdout).length,3);
const source = await readFile(join(root,'jobs',first.id,'request-body.bin'),'utf8');
assert.equal(source,'original request bytes');
console.log(JSON.stringify({status:'PASS',node:process.version,queueRoot:root,report:join(dir,'inbox.html'),
  exercised:['immutable intake','same-intent dedup',
    ...(terminalAvailable ? ['concurrent single attempt','original SF88 setup failure'] : ['controlling terminal absent before attempt']),
    'policy drift before execution','pre-attempt cancellation','original SF81 aborted outcome via SF82 recovery',
    'no replay after recovery','private HTML export','single JSON CLI'],payments:0}));
