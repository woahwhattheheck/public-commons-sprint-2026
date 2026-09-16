import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex } from '../src/canonical.mjs';
import { compileGitHubActionsAcquisition, GitHubEvidenceAcquisitionError, parseStrictJsonBytes, verifyGitHubActionsAcquisitionBundle } from '../src/github_evidence_acquire.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const WORKFLOW = Buffer.from('name: CI\non: [push]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n');
function job(id, name='tests') {
  return { id, run_id:123, name, status:'completed', conclusion:'success', started_at:'2026-09-14T22:00:10Z', completed_at:'2026-09-14T22:01:50Z', steps:[{number:1,name:'checkout',status:'completed',conclusion:'success'},{number:2,name:'test',status:'completed',conclusion:'success'}] };
}
function fixture() {
  const run = { id:123, run_attempt:2, head_sha:SHA, event:'push', status:'completed', conclusion:'success', created_at:'2026-09-14T22:00:00Z', updated_at:'2026-09-14T22:02:00Z', path:'.github/workflows/ci.yml', url:'https://api.github.com/repos/owner/repo/actions/runs/123', jobs_url:'https://api.github.com/repos/owner/repo/actions/runs/123/jobs', repository:{full_name:'Owner/Repo'} };
  const expected = { schema:'workseal-github-actions-acquisition-expectation/v1', repository:'owner/repo', workflowPath:'.github/workflows/ci.yml', workflowDigest:sha256Hex(WORKFLOW), headSha:SHA, event:'push', runId:'123', attempt:'2', requiredJobs:['tests'], observedAt:'2026-09-14T22:03:00Z', jobsCapture:{perPage:100,pageCount:1,totalCount:1} };
  return { run, expected, inputs:{runBytes:Buffer.from(JSON.stringify(run)),jobsPages:[{page:1,rawBytes:Buffer.from(JSON.stringify({total_count:1,jobs:[job(1)]}))}],workflowBytes:WORKFLOW,expected} };
}
function code(fn, expected) { assert.throws(fn, error => error instanceof GitHubEvidenceAcquisitionError && error.code === expected); }

test('compiles raw run/jobs/workflow into existing normalized evidence contract', () => {
  const {inputs}=fixture(); const bundle=compileGitHubActionsAcquisition(inputs);
  assert.equal(bundle.evidence.schema,'workseal-github-actions-evidence/v1');
  assert.equal(bundle.evidence.repository,'owner/repo');
  assert.equal(bundle.evidence.jobs[0].name,'tests');
  assert.equal(bundle.receipt.authority.integrity,'RAW_CAPTURE_INTEGRITY');
  assert.equal(bundle.receipt.authority.providerAuthenticity,'PROVIDER_AUTHENTICITY_NOT_ESTABLISHED');
});

test('bundle verification recomputes all retained bytes and pins', () => { const {inputs}=fixture(); const bundle=compileGitHubActionsAcquisition(inputs); assert.equal(verifyGitHubActionsAcquisitionBundle(bundle,inputs).manifestDigest,bundle.receipt.manifestDigest); });
test('jobs pages are canonicalized by page number', () => { const {inputs,expected}=fixture(); expected.requiredJobs=['a','b']; expected.jobsCapture={perPage:1,pageCount:2,totalCount:2}; inputs.jobsPages=[{page:2,rawBytes:Buffer.from(JSON.stringify({total_count:2,jobs:[job(2,'b')]}))},{page:1,rawBytes:Buffer.from(JSON.stringify({total_count:2,jobs:[job(1,'a')]}))}]; const a=compileGitHubActionsAcquisition(inputs); inputs.jobsPages.reverse(); const b=compileGitHubActionsAcquisition(inputs); assert.equal(a.receipt.manifestDigest,b.receipt.manifestDigest); });
test('strict decoder rejects duplicate object keys', () => code(()=>parseStrictJsonBytes(Buffer.from('{"id":1,"id":2}')),'DUPLICATE_KEY'));
test('strict decoder rejects unsafe JSON numbers before precision loss', () => code(()=>parseStrictJsonBytes(Buffer.from('{"id":9007199254740992}')),'UNSAFE_NUMBER'));
test('strict decoder rejects invalid UTF-8', () => code(()=>parseStrictJsonBytes(Buffer.from([0xff])),'BAD_UTF8'));
test('run id drift fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.id=124; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('run attempt drift fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.run_attempt=3; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('repository drift fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.repository.full_name='other/repo'; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('head drift fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.head_sha='f'.repeat(40); inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('event drift fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.event='pull_request'; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('workflow path drift fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.path='.github/workflows/other.yml'; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('workflow byte drift fails pinned digest', () => { const {inputs}=fixture(); inputs.workflowBytes=Buffer.from('different'); code(()=>compileGitHubActionsAcquisition(inputs),'EXPECTED_MISMATCH'); });
test('forged run API locator fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.url='https://api.github.com/repos/owner/repo/actions/runs/999'; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'BAD_SOURCE_URL'); });
test('failed workflow fails closed', () => { const {inputs}=fixture(); const run=JSON.parse(inputs.runBytes); run.conclusion='failure'; inputs.runBytes=Buffer.from(JSON.stringify(run)); code(()=>compileGitHubActionsAcquisition(inputs),'NOT_SUCCESS'); });
test('job from another run fails closed', () => { const {inputs}=fixture(); const page=JSON.parse(inputs.jobsPages[0].rawBytes); page.jobs[0].run_id=999; inputs.jobsPages[0].rawBytes=Buffer.from(JSON.stringify(page)); code(()=>compileGitHubActionsAcquisition(inputs),'RUN_JOB_MISMATCH'); });
test('skipped job fails closed', () => { const {inputs}=fixture(); const page=JSON.parse(inputs.jobsPages[0].rawBytes); page.jobs[0].conclusion='skipped'; inputs.jobsPages[0].rawBytes=Buffer.from(JSON.stringify(page)); code(()=>compileGitHubActionsAcquisition(inputs),'NOT_SUCCESS'); });
test('skipped step fails closed', () => { const {inputs}=fixture(); const page=JSON.parse(inputs.jobsPages[0].rawBytes); page.jobs[0].steps[0].conclusion='skipped'; inputs.jobsPages[0].rawBytes=Buffer.from(JSON.stringify(page)); code(()=>compileGitHubActionsAcquisition(inputs),'NOT_SUCCESS'); });
test('duplicate job ids fail closed across pages', () => { const {inputs,expected}=fixture(); expected.requiredJobs=['a','b']; expected.jobsCapture={perPage:1,pageCount:2,totalCount:2}; inputs.jobsPages=[{page:1,rawBytes:Buffer.from(JSON.stringify({total_count:2,jobs:[job(1,'a')]}))},{page:2,rawBytes:Buffer.from(JSON.stringify({total_count:2,jobs:[job(1,'b')]}))}]; code(()=>compileGitHubActionsAcquisition(inputs),'DUPLICATE_JOB'); });
test('duplicate step numbers fail closed', () => { const {inputs}=fixture(); const page=JSON.parse(inputs.jobsPages[0].rawBytes); page.jobs[0].steps[1].number=1; inputs.jobsPages[0].rawBytes=Buffer.from(JSON.stringify(page)); code(()=>compileGitHubActionsAcquisition(inputs),'DUPLICATE_STEP'); });
test('missing jobs page fails complete-capture gate', () => { const {inputs,expected}=fixture(); expected.requiredJobs=['a','b']; expected.jobsCapture={perPage:1,pageCount:2,totalCount:2}; inputs.jobsPages=[{page:1,rawBytes:Buffer.from(JSON.stringify({total_count:2,jobs:[job(1,'a')]}))}]; code(()=>compileGitHubActionsAcquisition(inputs),'INCOMPLETE_CAPTURE'); });
test('partial jobs page fails complete-capture gate', () => { const {inputs,expected}=fixture(); expected.requiredJobs=['a','b']; expected.jobsCapture={perPage:2,pageCount:1,totalCount:2}; inputs.jobsPages=[{page:1,rawBytes:Buffer.from(JSON.stringify({total_count:2,jobs:[job(1,'a')]}))}]; code(()=>compileGitHubActionsAcquisition(inputs),'INCOMPLETE_CAPTURE'); });
test('provider total_count mismatch fails complete-capture gate', () => { const {inputs}=fixture(); inputs.jobsPages[0].rawBytes=Buffer.from(JSON.stringify({total_count:2,jobs:[job(1)]})); code(()=>compileGitHubActionsAcquisition(inputs),'INCOMPLETE_CAPTURE'); });
test('job time after run completion fails closed', () => { const {inputs}=fixture(); const page=JSON.parse(inputs.jobsPages[0].rawBytes); page.jobs[0].completed_at='2026-09-14T22:04:00Z'; inputs.jobsPages[0].rawBytes=Buffer.from(JSON.stringify(page)); code(()=>compileGitHubActionsAcquisition(inputs),'JOB_TIME_OUTSIDE_RUN'); });
test('observedAt before run updatedAt fails closed', () => { const {inputs,expected}=fixture(); expected.observedAt='2026-09-14T22:01:00Z'; code(()=>compileGitHubActionsAcquisition(inputs),'OBSERVED_TOO_EARLY'); });
test('unknown expectation fields fail closed', () => { const {inputs,expected}=fixture(); expected.extra=true; code(()=>compileGitHubActionsAcquisition(inputs),'FIELD_SET_MISMATCH'); });
test('boolean/int alias in capture metadata fails closed', () => { const {inputs,expected}=fixture(); expected.jobsCapture.pageCount=true; code(()=>compileGitHubActionsAcquisition(inputs),'BAD_INTEGER'); });
test('run raw-byte mutation invalidates stale bundle even with equivalent semantic JSON', () => { const {inputs}=fixture(); const bundle=compileGitHubActionsAcquisition(inputs); inputs.runBytes=Buffer.concat([inputs.runBytes,Buffer.from('\n')]); code(()=>verifyGitHubActionsAcquisitionBundle(bundle,inputs),'STALE_ACQUISITION_BUNDLE'); });
test('normalized evidence transplant invalidates bundle', () => { const {inputs}=fixture(); const bundle=compileGitHubActionsAcquisition(inputs); bundle.evidence.headSha='f'.repeat(40); code(()=>verifyGitHubActionsAcquisitionBundle(bundle,inputs),'STALE_ACQUISITION_BUNDLE'); });
test('jobs raw-byte mutation changes manifest identity', () => { const {inputs}=fixture(); const a=compileGitHubActionsAcquisition(inputs); inputs.jobsPages[0].rawBytes=Buffer.concat([inputs.jobsPages[0].rawBytes,Buffer.from('\n')]); const b=compileGitHubActionsAcquisition(inputs); assert.notEqual(a.receipt.manifestDigest,b.receipt.manifestDigest); });
test('unknown jobs page descriptor fields fail closed', () => { const {inputs}=fixture(); inputs.jobsPages[0].extra=true; code(()=>compileGitHubActionsAcquisition(inputs),'FIELD_SET_MISMATCH'); });
