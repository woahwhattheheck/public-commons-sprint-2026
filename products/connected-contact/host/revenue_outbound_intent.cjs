'use strict';

// Cross-seat, provider-atomic reservation for one commercial outreach intent.
// Side-effect scope: create ONE new Git branch ref, never send mail or edit source.
// The caller MUST first reconcile existing sent/draft mail for this opportunity.
const crypto = require('node:crypto');
const SCHEMA = 'commons-revenue-outbound-intent/v1';
const DEFAULT_REPO = 'woahwhattheheck/commons';
const SHA = /^[0-9a-f]{40}$/;

function slug(input, name) {
  if (typeof input !== 'string' || !input.trim() || /[\x00-\x1f\x7f]/.test(input)) {
    throw new TypeError(`${name} must be printable nonempty text`);
  }
  const value = input.normalize('NFKC').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (value.length < 2 || value.length > 160) throw new TypeError(`${name} must normalize to 2–160 characters`);
  return value;
}

function fingerprint({prospect_org, opportunity_id, touchpoint}) {
  const fields = [slug(prospect_org, 'prospect_org'), slug(opportunity_id, 'opportunity_id'),
    slug(touchpoint, 'touchpoint')];
  // No sender, email address, subject or body: different writers/drafts share one intent.
  const key = crypto.createHash('sha256').update(JSON.stringify([SCHEMA, ...fields])).digest('hex');
  return {schema: SCHEMA, key, branch: `outbound-intent/v1/${key}`};
}

function validateRepo(repo) {
  if (typeof repo !== 'string' || !/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repo)
      || repo.split('/').some(part => part === '.' || part === '..')) {
    throw new TypeError('repository must be owner/name');
  }
  return repo;
}

function validateBase(base) {
  if (typeof base !== 'string' || !/^[a-z\d][a-z\d/._-]{0,100}$/i.test(base)
      || base.includes('..') || base.includes('//') || base.endsWith('/')) {
    throw new TypeError('invalid base ref');
  }
  return base;
}

function refPath(repo, branch) {
  return `/repos/${repo}/git/ref/heads/${branch}`;
}

function repoBranchUrl(repo, branch) {
  return `https://github.com/${repo}/tree/${branch}`;
}

async function readRef(request, repo, branch) {
  const r = await request('GET', refPath(repo, branch));
  if (r.status === 404) return null;
  if (r.status !== 200 || !SHA.test(r.body?.object?.sha || '')) {
    throw new Error(`ref lookup failed: HTTP ${r.status}; no send authorization`);
  }
  return r.body.object.sha;
}

async function inspectIntent(spec, {request, repository = DEFAULT_REPO} = {}) {
  if (typeof request !== 'function') throw new TypeError('request function required');
  const repo = validateRepo(repository);
  const id = fingerprint(spec);
  const sha = await readRef(request, repo, id.branch);
  return {...id, repo, status: sha ? 'ALREADY_RESERVED' : 'NOT_RESERVED',
    ref_sha: sha, url: repoBranchUrl(repo, id.branch)};
}

async function reserveIntent() {
  throw Object.assign(new Error('Select the original shared local coordinator through createConnectedFirstContact; private Git intent writes are disabled.'),
    {code:'CONTACT_LOCAL_STORAGE_REQUIRED'});
}

function githubRequest(token, fetchFn = globalThis.fetch) {
  if (!token || typeof token !== 'string' || !token.trim()) throw new Error('GITHUB_TOKEN required');
  if (typeof fetchFn !== 'function') throw new TypeError('fetch required');
  return async (method, path, payload) => {
    if(method!=='GET')throw Object.assign(new Error('Historical Git source access is read-only.'),{code:'CONTACT_LOCAL_STORAGE_REQUIRED'});
    const response = await fetchFn(`https://api.github.com${path}`, {
      method,
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'commons-revenue-intent/1',
        ...(payload === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(payload === undefined ? {} : {body: JSON.stringify(payload)}),
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.text();
    let json = {};
    if (body) { try { json = JSON.parse(body); } catch { throw new Error(`non-JSON GitHub response HTTP ${response.status}`); } }
    return {status: response.status, body: json};
  };
}

async function cli(argv = process.argv.slice(2), env = process.env) {
  const [action, org, opportunity, touchpoint, repo = DEFAULT_REPO] = argv;
  if (!['plan', 'status', 'reserve'].includes(action) || !org || !opportunity || !touchpoint) {
    process.stderr.write('Usage: node revenue_outbound_intent.cjs plan|status|reserve PROSPECT_ORG OPPORTUNITY_ID TOUCHPOINT [owner/repo]\n');
    return 2;
  }
  const spec = {prospect_org: org, opportunity_id: opportunity, touchpoint};
  try {
    const id = fingerprint(spec);
    let result;
    if (action === 'plan') result = {...id, repo: validateRepo(repo), status: 'PLAN_ONLY'};
    else {
      const request = githubRequest(env.GITHUB_TOKEN);
      result = action === 'status'
        ? await inspectIntent(spec, {request, repository: repo})
        : await reserveIntent(spec, {request, repository: repo});
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return ['RESERVED', 'PLAN_ONLY', 'NOT_RESERVED'].includes(result.status) ? 0 : 3;
  } catch (error) {
    process.stderr.write(error.message + '\n');
    return 1;
  }
}

module.exports = {fingerprint, inspectIntent, reserveIntent, githubRequest, cli};
if (require.main === module) cli().then(code => {process.exitCode = code;});
