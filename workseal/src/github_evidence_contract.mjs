export class GitHubEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubEvidenceError';
    this.code = code;
  }
}

function fail(code, message) { throw new GitHubEvidenceError(code, message); }
function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BAD_OBJECT', `${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join('\0') !== expected.join('\0')) fail('FIELD_SET_MISMATCH', `${name} must have exactly: ${expected.join(', ')}`);
}
function text(value, name, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail('BAD_STRING', `${name} must be a non-empty string <= ${max} chars`);
  return value;
}
function digest(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('BAD_DIGEST', `${name} must be lowercase sha256`);
  return value;
}
function commit(value, name) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) fail('BAD_COMMIT', `${name} must be a lowercase 40- or 64-hex commit id`);
  return value;
}
function positiveDecimal(value, name) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) fail('BAD_DECIMAL', `${name} must be a positive decimal string`);
  return value;
}
function rfc3339(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('BAD_TIMESTAMP', `${name} must be RFC3339 with timezone`);
  return value;
}
function githubRepo(value) {
  text(value, 'repository', 201);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) fail('BAD_REPOSITORY', 'repository must be owner/name');
  return value.toLowerCase();
}
function workflowPath(value) {
  text(value, 'workflowPath', 300);
  if (!/^\.github\/workflows\/[A-Za-z0-9_.\/-]+\.(?:yml|yaml)$/.test(value) || value.includes('..')) fail('BAD_WORKFLOW_PATH', 'workflowPath must be a safe .github/workflows yml path');
  return value;
}
function success(value, name) {
  if (value !== 'success') fail('NOT_SUCCESS', `${name} must be success`);
  return value;
}

export function normalizeGitHubActionsEvidence(input) {
  exactKeys(input, ['schema','repository','workflowPath','workflowDigest','runId','attempt','headSha','event','status','conclusion','createdAt','updatedAt','observedAt','sourceApiUrl','rawResponseDigest','jobs'], 'evidence');
  if (input.schema !== 'workseal-github-actions-evidence/v1') fail('BAD_SCHEMA', 'unsupported GitHub evidence schema');
  const repository = githubRepo(input.repository);
  const runId = positiveDecimal(input.runId, 'runId');
  const attempt = positiveDecimal(input.attempt, 'attempt');
  if (input.status !== 'completed') fail('NOT_COMPLETED', 'workflow run status must be completed');
  success(input.conclusion, 'workflow run conclusion');
  const createdAt = rfc3339(input.createdAt, 'createdAt');
  const updatedAt = rfc3339(input.updatedAt, 'updatedAt');
  const observedAt = rfc3339(input.observedAt, 'observedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail('TIME_REWIND', 'updatedAt precedes createdAt');
  if (Date.parse(observedAt) < Date.parse(updatedAt)) fail('OBSERVED_TOO_EARLY', 'observedAt precedes updatedAt');
  const expectedApi = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  if (input.sourceApiUrl.toLowerCase() !== expectedApi) fail('BAD_SOURCE_URL', `sourceApiUrl must equal ${expectedApi}`);
  if (!Array.isArray(input.jobs) || input.jobs.length === 0 || input.jobs.length > 64) fail('BAD_JOBS', 'jobs must contain 1..64 entries');
  const jobNames = new Set();
  const jobs = input.jobs.map((job, ji) => {
    exactKeys(job, ['name','conclusion','startedAt','completedAt','steps'], `jobs[${ji}]`);
    const name = text(job.name, `jobs[${ji}].name`, 200);
    if (jobNames.has(name)) fail('DUPLICATE_JOB', `duplicate job name: ${name}`);
    jobNames.add(name);
    success(job.conclusion, `jobs[${ji}].conclusion`);
    const startedAt = rfc3339(job.startedAt, `jobs[${ji}].startedAt`);
    const completedAt = rfc3339(job.completedAt, `jobs[${ji}].completedAt`);
    if (Date.parse(completedAt) < Date.parse(startedAt)) fail('TIME_REWIND', `job ${name} completes before it starts`);
    if (Date.parse(startedAt) < Date.parse(createdAt) || Date.parse(completedAt) > Date.parse(observedAt)) fail('JOB_TIME_OUTSIDE_RUN', `job ${name} time falls outside retained run interval`);
    if (!Array.isArray(job.steps) || job.steps.length === 0 || job.steps.length > 256) fail('BAD_STEPS', `job ${name} must have 1..256 steps`);
    const stepNumbers = new Set();
    const steps = job.steps.map((step, si) => {
      exactKeys(step, ['number','name','conclusion'], `jobs[${ji}].steps[${si}]`);
      if (!Number.isSafeInteger(step.number) || step.number < 1) fail('BAD_STEP_NUMBER', 'step number must be a positive safe integer');
      if (stepNumbers.has(step.number)) fail('DUPLICATE_STEP', `duplicate step number ${step.number} in ${name}`);
      stepNumbers.add(step.number);
      return { number: step.number, name: text(step.name, 'step.name', 200), conclusion: success(step.conclusion, 'step.conclusion') };
    }).sort((a,b) => a.number - b.number);
    return { name, conclusion: 'success', startedAt, completedAt, steps };
  }).sort((a,b) => a.name.localeCompare(b.name));
  return {
    schema: 'workseal-github-actions-evidence/v1', repository,
    workflowPath: workflowPath(input.workflowPath), workflowDigest: digest(input.workflowDigest, 'workflowDigest'),
    runId, attempt, headSha: commit(input.headSha, 'headSha'), event: text(input.event, 'event', 64),
    status: 'completed', conclusion: 'success', createdAt, updatedAt, observedAt,
    sourceApiUrl: expectedApi, rawResponseDigest: digest(input.rawResponseDigest, 'rawResponseDigest'), jobs,
  };
}

export function assertGitHubActionsExpected(evidence, expected) {
  exactKeys(expected, ['repository','workflowPath','workflowDigest','headSha','event','requiredJobs'], 'expected');
  const normalized = normalizeGitHubActionsEvidence(evidence);
  const exp = {
    repository: githubRepo(expected.repository), workflowPath: workflowPath(expected.workflowPath),
    workflowDigest: digest(expected.workflowDigest, 'expected.workflowDigest'), headSha: commit(expected.headSha, 'expected.headSha'),
    event: text(expected.event, 'expected.event', 64),
  };
  for (const key of Object.keys(exp)) if (normalized[key] !== exp[key]) fail('EXPECTED_MISMATCH', `${key} does not match the pinned expectation`);
  if (!Array.isArray(expected.requiredJobs) || expected.requiredJobs.length === 0 || expected.requiredJobs.length > 64) fail('BAD_REQUIRED_JOBS', 'requiredJobs must contain 1..64 names');
  const requiredJobs = expected.requiredJobs.map((name, i) => text(name, `expected.requiredJobs[${i}]`, 200));
  if (new Set(requiredJobs).size !== requiredJobs.length) fail('DUPLICATE_REQUIRED_JOB', 'requiredJobs contains duplicates');
  const actualJobs = normalized.jobs.map(job => job.name).sort();
  if (actualJobs.join('\0') !== [...requiredJobs].sort().join('\0')) fail('EXPECTED_JOB_SET_MISMATCH', 'retained job set does not match pinned requiredJobs');
  return normalized;
}
