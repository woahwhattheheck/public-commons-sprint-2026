import { TextDecoder } from 'node:util';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { assertGitHubActionsExpected } from './github_evidence_contract.mjs';

export class GitHubEvidenceAcquisitionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitHubEvidenceAcquisitionError';
    this.code = code;
  }
}

function fail(code, message) { throw new GitHubEvidenceAcquisitionError(code, message); }
function plain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('BAD_OBJECT', `${name} must be a plain object`);
  return value;
}
function exactKeys(value, keys, name) {
  plain(value, name);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join('\0') !== expected.join('\0')) fail('FIELD_SET_MISMATCH', `${name} must have exactly: ${expected.join(', ')}`);
}
function text(value, name, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail('BAD_STRING', `${name} must be a non-empty string <= ${max} chars`);
  return value;
}
function positiveInt(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail('BAD_INTEGER', `${name} must be a positive safe integer <= ${max}`);
  return value;
}
function nonnegativeInt(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('BAD_INTEGER', `${name} must be a non-negative safe integer <= ${max}`);
  return value;
}
function positiveDecimal(value, name) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) fail('BAD_DECIMAL', `${name} must be a positive decimal string`);
  return value;
}
function digest(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('BAD_DIGEST', `${name} must be lowercase sha256`);
  return value;
}
function commit(value, name) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) fail('BAD_COMMIT', `${name} must be lowercase 40- or 64-hex`);
  return value;
}
function rfc3339(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('BAD_TIMESTAMP', `${name} must be RFC3339 with timezone`);
  return value;
}
function repoName(value) {
  text(value, 'repository', 201);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) fail('BAD_REPOSITORY', 'repository must be owner/name');
  return value.toLowerCase();
}
function workflowPath(value) {
  text(value, 'workflowPath', 300);
  if (!/^\.github\/workflows\/[A-Za-z0-9_.\/-]+\.(?:yml|yaml)$/.test(value) || value.includes('..')) fail('BAD_WORKFLOW_PATH', 'workflowPath must be a safe .github/workflows yml path');
  return value;
}
function bytes(value, name, maxBytes = 4 * 1024 * 1024) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) fail('BAD_BYTES', `${name} must be retained bytes`);
  const out = Buffer.from(value);
  if (out.length === 0 || out.length > maxBytes) fail('BAD_BYTES', `${name} must contain 1..${maxBytes} bytes`);
  return out;
}

export function parseStrictJsonBytes(raw, name = 'raw JSON') {
  const data = bytes(raw, name);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { fail('BAD_UTF8', `${name} must be valid UTF-8`); }
  let i = 0;
  const maxDepth = 64;
  const ws = () => { while (i < source.length && /[\x20\x09\x0a\x0d]/.test(source[i])) i += 1; };
  const parseString = () => {
    if (source[i] !== '"') fail('BAD_JSON', `${name} expected string at byte ${i}`);
    const start = i++;
    let escaped = false;
    while (i < source.length) {
      const ch = source[i++];
      if (!escaped && ch === '"') {
        const token = source.slice(start, i);
        try { return JSON.parse(token); } catch { fail('BAD_JSON', `${name} contains an invalid JSON string`); }
      }
      if (!escaped && ch === '\\') escaped = true;
      else escaped = false;
      if (!escaped && ch.charCodeAt(0) < 0x20) fail('BAD_JSON', `${name} contains a control character in a string`);
    }
    fail('BAD_JSON', `${name} contains an unterminated string`);
  };
  const parseNumber = () => {
    const match = source.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail('BAD_JSON', `${name} contains an invalid number at byte ${i}`);
    i += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) fail('UNSAFE_NUMBER', `${name} numbers must be safe integers`);
    return value;
  };
  const parseValue = (depth) => {
    if (depth > maxDepth) fail('JSON_TOO_DEEP', `${name} exceeds nesting depth ${maxDepth}`);
    ws();
    const ch = source[i];
    if (ch === '"') return parseString();
    if (ch === '{') {
      i += 1; ws();
      const out = {};
      const seen = new Set();
      if (source[i] === '}') { i += 1; return out; }
      let count = 0;
      while (true) {
        ws();
        const key = parseString();
        if (seen.has(key)) fail('DUPLICATE_KEY', `${name} contains duplicate object key ${JSON.stringify(key)}`);
        seen.add(key);
        ws(); if (source[i++] !== ':') fail('BAD_JSON', `${name} expected ':' after object key`);
        out[key] = parseValue(depth + 1);
        if (++count > 10000) fail('JSON_TOO_LARGE', `${name} contains too many object members`);
        ws();
        if (source[i] === '}') { i += 1; return out; }
        if (source[i++] !== ',') fail('BAD_JSON', `${name} expected ',' between object members`);
      }
    }
    if (ch === '[') {
      i += 1; ws();
      const out = [];
      if (source[i] === ']') { i += 1; return out; }
      while (true) {
        out.push(parseValue(depth + 1));
        if (out.length > 10000) fail('JSON_TOO_LARGE', `${name} contains too many array entries`);
        ws();
        if (source[i] === ']') { i += 1; return out; }
        if (source[i++] !== ',') fail('BAD_JSON', `${name} expected ',' between array entries`);
      }
    }
    if (ch === '-' || /[0-9]/.test(ch ?? '')) return parseNumber();
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, i)) { i += literal.length; return value; }
    }
    fail('BAD_JSON', `${name} contains an invalid token at byte ${i}`);
  };
  const value = parseValue(0);
  ws();
  if (i !== source.length) fail('BAD_JSON', `${name} has trailing content at byte ${i}`);
  return value;
}

function normalizeExpected(input) {
  exactKeys(input, ['schema','repository','workflowPath','workflowDigest','headSha','event','runId','attempt','requiredJobs','observedAt','jobsCapture'], 'expected');
  if (input.schema !== 'workseal-github-actions-acquisition-expectation/v1') fail('BAD_SCHEMA', 'unsupported acquisition expectation schema');
  exactKeys(input.jobsCapture, ['perPage','pageCount','totalCount'], 'expected.jobsCapture');
  const requiredJobs = input.requiredJobs;
  if (!Array.isArray(requiredJobs) || requiredJobs.length < 1 || requiredJobs.length > 64) fail('BAD_REQUIRED_JOBS', 'requiredJobs must contain 1..64 names');
  const names = requiredJobs.map((value, index) => text(value, `requiredJobs[${index}]`, 200));
  if (new Set(names).size !== names.length) fail('DUPLICATE_REQUIRED_JOB', 'requiredJobs contains duplicates');
  const perPage = positiveInt(input.jobsCapture.perPage, 'jobsCapture.perPage', 100);
  const totalCount = positiveInt(input.jobsCapture.totalCount, 'jobsCapture.totalCount', 64);
  const pageCount = positiveInt(input.jobsCapture.pageCount, 'jobsCapture.pageCount', 64);
  if (pageCount !== Math.ceil(totalCount / perPage)) fail('INCOMPLETE_CAPTURE', 'pageCount does not cover totalCount at perPage');
  if (totalCount !== names.length) fail('INCOMPLETE_CAPTURE', 'totalCount must equal the pinned complete requiredJobs set');
  return {
    schema: input.schema,
    repository: repoName(input.repository), workflowPath: workflowPath(input.workflowPath), workflowDigest: digest(input.workflowDigest, 'workflowDigest'),
    headSha: commit(input.headSha, 'headSha'), event: text(input.event, 'event', 64), runId: positiveDecimal(input.runId, 'runId'), attempt: positiveDecimal(input.attempt, 'attempt'),
    requiredJobs: [...names].sort(), observedAt: rfc3339(input.observedAt, 'observedAt'), jobsCapture: { perPage, pageCount, totalCount },
  };
}

function providerField(object, key, name) {
  plain(object, name);
  if (!(key in object)) fail('MISSING_PROVIDER_FIELD', `${name}.${key} is required`);
  return object[key];
}
function providerString(object, key, name, max = 1024) { return text(providerField(object,key,name), `${name}.${key}`, max); }
function providerInt(object, key, name) { return positiveInt(providerField(object,key,name), `${name}.${key}`); }
function providerTimestamp(object,key,name) { return rfc3339(providerField(object,key,name), `${name}.${key}`); }

function normalizeRun(run, expected) {
  plain(run, 'run');
  const runId = providerInt(run, 'id', 'run');
  const attempt = providerInt(run, 'run_attempt', 'run');
  const repository = repoName(providerString(plain(providerField(run,'repository','run'),'run.repository'), 'full_name', 'run.repository', 201));
  const expectedApi = `https://api.github.com/repos/${expected.repository}/actions/runs/${expected.runId}`;
  const expectedJobsApi = `${expectedApi}/jobs`;
  const path = providerString(run, 'path', 'run', 300);
  const createdAt = providerTimestamp(run, 'created_at', 'run');
  const updatedAt = providerTimestamp(run, 'updated_at', 'run');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail('TIME_REWIND', 'run.updated_at precedes run.created_at');
  if (Date.parse(expected.observedAt) < Date.parse(updatedAt)) fail('OBSERVED_TOO_EARLY', 'expected.observedAt precedes run.updated_at');
  const normalized = {
    id: String(runId), attempt: String(attempt), repository,
    path, headSha: providerString(run,'head_sha','run',64), event: providerString(run,'event','run',64),
    status: providerString(run,'status','run',32), conclusion: providerString(run,'conclusion','run',32),
    createdAt, updatedAt,
    url: providerString(run,'url','run',500).toLowerCase(), jobsUrl: providerString(run,'jobs_url','run',500).toLowerCase(),
  };
  if (normalized.id !== expected.runId) fail('EXPECTED_MISMATCH', 'run id does not match expectation');
  if (normalized.attempt !== expected.attempt) fail('EXPECTED_MISMATCH', 'run attempt does not match expectation');
  if (normalized.repository !== expected.repository) fail('EXPECTED_MISMATCH', 'run repository does not match expectation');
  if (normalized.path !== expected.workflowPath) fail('EXPECTED_MISMATCH', 'run workflow path does not match expectation');
  if (normalized.headSha !== expected.headSha) fail('EXPECTED_MISMATCH', 'run head SHA does not match expectation');
  if (normalized.event !== expected.event) fail('EXPECTED_MISMATCH', 'run event does not match expectation');
  if (normalized.status !== 'completed') fail('NOT_COMPLETED', 'run status must be completed');
  if (normalized.conclusion !== 'success') fail('NOT_SUCCESS', 'run conclusion must be success');
  if (normalized.url !== expectedApi) fail('BAD_SOURCE_URL', `run.url must equal ${expectedApi}`);
  if (normalized.jobsUrl !== expectedJobsApi) fail('BAD_SOURCE_URL', `run.jobs_url must equal ${expectedJobsApi}`);
  return normalized;
}

function normalizeJob(job, run, index, jobIds, jobNames) {
  plain(job, `job[${index}]`);
  const id = providerInt(job, 'id', `job[${index}]`);
  if (jobIds.has(id)) fail('DUPLICATE_JOB', `duplicate job id ${id}`); jobIds.add(id);
  const runId = providerInt(job, 'run_id', `job[${index}]`);
  if (String(runId) !== run.id) fail('RUN_JOB_MISMATCH', `job ${id} run_id does not match run`);
  const name = providerString(job, 'name', `job[${index}]`, 200);
  if (jobNames.has(name)) fail('DUPLICATE_JOB', `duplicate job name ${name}`); jobNames.add(name);
  if (providerString(job,'status',`job[${index}]`,32) !== 'completed') fail('NOT_COMPLETED', `job ${name} status must be completed`);
  if (providerString(job,'conclusion',`job[${index}]`,32) !== 'success') fail('NOT_SUCCESS', `job ${name} conclusion must be success`);
  const startedAt = providerTimestamp(job,'started_at',`job[${index}]`);
  const completedAt = providerTimestamp(job,'completed_at',`job[${index}]`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) fail('TIME_REWIND', `job ${name} completes before it starts`);
  if (Date.parse(startedAt) < Date.parse(run.createdAt) || Date.parse(completedAt) > Date.parse(run.updatedAt)) fail('JOB_TIME_OUTSIDE_RUN', `job ${name} lies outside run timestamps`);
  const rawSteps = providerField(job,'steps',`job[${index}]`);
  if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > 256) fail('BAD_STEPS', `job ${name} must have 1..256 steps`);
  const numbers = new Set();
  const steps = rawSteps.map((step, stepIndex) => {
    plain(step, `job[${index}].steps[${stepIndex}]`);
    const number = positiveInt(providerField(step,'number',`job[${index}].steps[${stepIndex}]`), 'step.number');
    if (numbers.has(number)) fail('DUPLICATE_STEP', `duplicate step number ${number} in ${name}`); numbers.add(number);
    if (providerString(step,'status',`job[${index}].steps[${stepIndex}]`,32) !== 'completed') fail('NOT_COMPLETED', `step ${number} in ${name} must be completed`);
    if (providerString(step,'conclusion',`job[${index}].steps[${stepIndex}]`,32) !== 'success') fail('NOT_SUCCESS', `step ${number} in ${name} must be success`);
    return { number, name: providerString(step,'name',`job[${index}].steps[${stepIndex}]`,200), conclusion: 'success' };
  }).sort((a,b) => a.number - b.number);
  return { name, conclusion: 'success', startedAt, completedAt, steps };
}

export function compileGitHubActionsAcquisition({ runBytes, jobsPages, workflowBytes, expected }) {
  const exp = normalizeExpected(expected);
  const workflow = bytes(workflowBytes, 'workflowBytes', 2 * 1024 * 1024);
  const actualWorkflowDigest = sha256Hex(workflow);
  if (actualWorkflowDigest !== exp.workflowDigest) fail('EXPECTED_MISMATCH', 'workflow bytes do not match expected.workflowDigest');
  const runRaw = bytes(runBytes, 'runBytes');
  const run = normalizeRun(parseStrictJsonBytes(runRaw, 'runBytes'), exp);
  if (!Array.isArray(jobsPages) || jobsPages.length !== exp.jobsCapture.pageCount) fail('INCOMPLETE_CAPTURE', 'jobsPages length does not match expected pageCount');
  const pageByNumber = new Map();
  for (const descriptor of jobsPages) {
    exactKeys(descriptor, ['page','rawBytes'], 'jobsPages[]');
    const page = positiveInt(descriptor.page, 'jobsPages[].page', exp.jobsCapture.pageCount);
    if (pageByNumber.has(page)) fail('DUPLICATE_PAGE', `duplicate jobs page ${page}`);
    pageByNumber.set(page, bytes(descriptor.rawBytes, `jobs page ${page}`));
  }
  const jobIds = new Set(), jobNames = new Set(), normalizedJobs = [], pageReceipts = [];
  for (let page = 1; page <= exp.jobsCapture.pageCount; page += 1) {
    const raw = pageByNumber.get(page);
    if (!raw) fail('INCOMPLETE_CAPTURE', `missing jobs page ${page}`);
    const body = parseStrictJsonBytes(raw, `jobs page ${page}`);
    plain(body, `jobs page ${page}`);
    const totalCount = nonnegativeInt(providerField(body,'total_count',`jobs page ${page}`), `jobs page ${page}.total_count`, 64);
    if (totalCount !== exp.jobsCapture.totalCount) fail('INCOMPLETE_CAPTURE', `jobs page ${page} total_count does not match expectation`);
    const entries = providerField(body,'jobs',`jobs page ${page}`);
    if (!Array.isArray(entries)) fail('BAD_JOBS', `jobs page ${page}.jobs must be an array`);
    const expectedLength = page < exp.jobsCapture.pageCount ? exp.jobsCapture.perPage : exp.jobsCapture.totalCount - (page - 1) * exp.jobsCapture.perPage;
    if (entries.length !== expectedLength) fail('INCOMPLETE_CAPTURE', `jobs page ${page} has ${entries.length} jobs; expected ${expectedLength}`);
    entries.forEach((job,index) => normalizedJobs.push(normalizeJob(job,run,(page-1)*exp.jobsCapture.perPage+index,jobIds,jobNames)));
    pageReceipts.push({ page, sourceApiUrl: `${run.jobsUrl}?per_page=${exp.jobsCapture.perPage}&page=${page}`, rawDigest: sha256Hex(raw) });
  }
  if (normalizedJobs.length !== exp.jobsCapture.totalCount) fail('INCOMPLETE_CAPTURE', 'retained jobs union is incomplete');
  const evidence = {
    schema:'workseal-github-actions-evidence/v1', repository:exp.repository, workflowPath:exp.workflowPath, workflowDigest:actualWorkflowDigest,
    runId:exp.runId, attempt:exp.attempt, headSha:exp.headSha, event:exp.event, status:'completed', conclusion:'success',
    createdAt:run.createdAt, updatedAt:run.updatedAt, observedAt:exp.observedAt, sourceApiUrl:run.url,
    rawResponseDigest:sha256Hex(runRaw), jobs:normalizedJobs,
  };
  const normalizedEvidence = assertGitHubActionsExpected(evidence, {
    repository:exp.repository, workflowPath:exp.workflowPath, workflowDigest:exp.workflowDigest, headSha:exp.headSha, event:exp.event, requiredJobs:exp.requiredJobs,
  });
  const normalizedEvidenceDigest = sha256Hex(normalizedEvidence);
  const expectationDigest = sha256Hex(exp);
  const manifest = {
    schema:'workseal-github-actions-acquisition-manifest/v1',
    authority:{ integrity:'RAW_CAPTURE_INTEGRITY', providerAuthenticity:'PROVIDER_AUTHENTICITY_NOT_ESTABLISHED' },
    repository:exp.repository, workflowPath:exp.workflowPath, headSha:exp.headSha, runId:exp.runId, attempt:exp.attempt,
    raw:{ runDigest:sha256Hex(runRaw), workflowDigest:actualWorkflowDigest, jobs:pageReceipts },
    capture:exp.jobsCapture, expectationDigest, normalizedEvidenceDigest,
  };
  const receipt = {
    schema:'workseal-github-actions-acquisition-receipt/v1',
    manifestDigest:sha256Hex(manifest), expectationDigest, normalizedEvidenceDigest,
    authority:{ integrity:'RAW_CAPTURE_INTEGRITY', providerAuthenticity:'PROVIDER_AUTHENTICITY_NOT_ESTABLISHED' },
  };
  return { schema:'workseal-github-actions-acquisition-bundle/v1', evidence:normalizedEvidence, manifest, receipt };
}

export function verifyGitHubActionsAcquisitionBundle(bundle, inputs) {
  exactKeys(bundle, ['schema','evidence','manifest','receipt'], 'bundle');
  if (bundle.schema !== 'workseal-github-actions-acquisition-bundle/v1') fail('BAD_SCHEMA', 'unsupported acquisition bundle schema');
  const fresh = compileGitHubActionsAcquisition(inputs);
  if (canonicalJson(fresh) !== canonicalJson(bundle)) fail('STALE_ACQUISITION_BUNDLE', 'bundle does not match retained raw inputs and expectation');
  return fresh.receipt;
}
