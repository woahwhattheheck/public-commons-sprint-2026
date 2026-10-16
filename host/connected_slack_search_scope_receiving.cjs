'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./connected_slack_search_scope.cjs');
const name = api.SEARCH_BINDINGS.search;
const schema = properties => ({name, inputSchema: {type: 'object', properties,
  additionalProperties: false}});
const shared = {cursor: {type: 'string'}, after: {type: 'string'},
  before: {type: 'string'}, include_bots: {type: 'boolean'}};
const structured = schema({...shared, keywords: {type: 'array'}, filters: {type: 'string'},
  limit: {type: 'integer', maximum: 20}});
const legacy = schema({...shared, query: {type: 'string'}, count: {type: 'integer', maximum: 20}});
const original = {keywords: ['status'], filters: 'in:<#C0123>', limit: 7,
  cursor: 'original:opaque/cursor==', after: '1700000000', before: '1700000001', include_bots: true};
const blank = {text: JSON.stringify({results: '# Search Results for: \n\nNo results found.'})};
const correct = {ok: true, query: 'in:<#C0123> status', messages: {matches: [], total: 0}};

(async () => {
  let calls = 0, observations = 0, latestArgs;
  const tools = {[name]: async args => {calls++; latestArgs = args; return calls === 1 ? blank : correct;},
    unchanged_read: () => 'original'};
  const first = api.createScopeCheckedSlackTools(tools, {contracts: {[name]: structured},
    onObservation: () => {observations++;}});
  assert.equal(first.unchanged_read, tools.unchanged_read);
  const failure = await first[name](original);
  assert.equal(calls, 1);
  assert.equal(failure.error_code, 'SEARCH_QUERY_ECHO_EMPTY');
  assert.equal(failure.native_response, blank);
  assert.deepEqual(latestArgs, original);
  assert.throws(() => api.planSlackSearchScopeContinuation(failure, structured),
    {code: 'SEARCH_RECOVERY_UNCHANGED'});
  const plan = api.planSlackSearchScopeContinuation(failure, legacy);
  assert.equal(plan.cursor, original.cursor);
  const second = api.createScopeCheckedSlackTools(tools, {contracts: {[name]: legacy}, continuation: plan,
    onObservation: () => {observations++;}});
  assert.equal(await second[name](plan.args), correct);
  assert.equal(calls, 2);
  assert.equal(latestArgs.query, 'status in:<#C0123>');
  assert.equal(latestArgs.count, 7);
  assert.equal(latestArgs.cursor, original.cursor);
  assert.equal(latestArgs.after, original.after);
  assert.equal(latestArgs.before, original.before);
  assert.equal(latestArgs.keywords, undefined);
  assert.equal((await second[name](plan.args)).error_code, 'SEARCH_RECOVERY_EXHAUSTED');
  assert.equal(calls, 2);
  const repeat = api.createScopeCheckedSlackTools({[name]: async () => blank},
    {contracts: {[name]: legacy}, continuation: plan});
  const repeatedFailure = await repeat[name](plan.args);
  assert.equal(repeatedFailure.error_data.recovery.native_attempts, 2);
  assert.throws(() => api.planSlackSearchScopeContinuation(repeatedFailure, structured),
    {code: 'SEARCH_RECOVERY_UNAVAILABLE'});
  const wrongTool = {...legacy, name: 'different_binding'};
  assert.throws(() => api.planSlackSearchScopeContinuation(failure, wrongTool), {code: 'SEARCH_BINDING_CHANGED'});

  const before = calls;
  const unsupported = api.createScopeCheckedSlackTools(tools,
    {contracts: {[name]: schema({query: {}, count: {}})}});
  assert.equal((await unsupported[name](original)).error_code, 'SEARCH_ARGUMENT_UNSUPPORTED');
  assert.equal(calls, before);
  assert.throws(() => api.compileSlackSearchArgs({query: 'other', keywords: ['status']}, legacy, name),
    {code: 'SEARCH_SCOPE_CONFLICT'});
  assert.throws(() => api.compileSlackSearchArgs({query: 'one OR two'}, structured, name),
    {code: 'SEARCH_SCOPE_NOT_REPRESENTABLE'});
  const nativeError = {ok: false, error_code: 'rate_limited', error: 'provider limit', retry_after: 60};
  let nativeErrors = 0;
  const limits = api.createScopeCheckedSlackTools({[name]: async () => {nativeErrors++; return nativeError;}},
    {contracts: {[name]: structured}});
  assert.equal(await limits[name](original), nativeError);
  assert.equal(nativeErrors, 1);
  const spoof = {ok: true, messages: {matches: [{text: '# Search Results for: status in:<#C0123>'}]}};
  assert.equal(api.inspectSlackSearchScope(spoof, 'status in:<#C0123>').status, 'UNCONFIRMED');
  const lostCustody = api.createScopeCheckedSlackTools({[name]: async () => correct},
    {contracts: {[name]: structured}, onObservation: () => {throw Error('local store unavailable');}});
  const retained = await lostCustody[name](original);
  assert.equal(retained.error_code, 'SEARCH_SCOPE_CUSTODY_FAILED');
  assert.equal(retained.native_response, correct);
  const evidence = {schema: 'commons.slack_search_scope_receiving/v1',
    execution: 'local adapter lifecycle using generic retained-format fixtures',
    completed_at: new Date().toISOString(), status: 'PASSED',
    initial_and_explicit_continuation_native_calls: calls, observations,
    scope: ['structured request retained', 'blank query does not become empty search',
      'fresh legacy descriptor and count translation', 'original cursor and timestamp bounds retained',
      'one continuation invocation', 'repeat scope failure exhausted', 'binding change refused',
      'unsupported scope rejected before native call', 'conflicting/Boolean intent refused',
      'native rate-limit response unchanged', 'message-body heading not accepted',
      'failed response-custody callback retains native response'],
    external_provider_calls: 0};
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
