'use strict';

const SCHEMA = 'commons.connected_slack_thread_intake/v1';
const copy = value => JSON.parse(JSON.stringify(value));
const record = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw TypeError(name + ' must be an object');
  return value;
};
const positive = (value, name, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw TypeError(name + ' must be a positive integer');
  return value;
};
const stamp = value => {
  if (typeof value !== 'string' || !/^\d{1,16}\.\d{1,16}$/.test(value)) throw TypeError('Keep the original decimal Slack timestamp');
  const [seconds, fraction] = value.split('.');
  return BigInt(seconds) * 10000000000000000n + BigInt(fraction.padEnd(16, '0'));
};
const compareStamp = (a, b) => stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0;
const errorRecord = error => ({name: String(error?.name || 'Error'), message: String(error?.message || error)});

/**
 * Continue one selected Slack source through canonical resolution, complete
 * retained pages, capture recovery, source-indexed context and later refreshes.
 * Native parsers, destinations and pagination belong to the maintained modules.
 * All captures and context remain private data owned by the calling operation.
 */
function createSlackThreadIntake(request, dependencies = {}, options = {}) {
  record(request, 'intake request'); record(dependencies, 'dependencies'); record(options, 'options');
  if (typeof request.operation_id !== 'string' || !request.operation_id.trim()) throw TypeError('operation_id is required');
  const reader = dependencies.reader || (typeof require === 'function' ? require('./connected_slack_pages.cjs') : null);
  const publisher = dependencies.publisher || (typeof require === 'function' ? require('./connected_slack_publish.cjs') : null);
  const envelope = dependencies.envelope || (typeof require === 'function' ? require('./connected_slack_native_envelope.cjs') : null);
  for (const name of ['projectSlackThreadReference', 'resolveSlackThreadReference', 'collectSlackPages',
    'projectSlackMessages', 'planSlackThreadRecovery', 'visitSlackMessages', 'projectSlackCollectedSearchResults',
    'projectSlackThreadPages']) {
    if (typeof reader?.[name] !== 'function') throw TypeError('The maintained reader must provide ' + name);
  }
  for (const name of ['prepareSlackResultDestination', 'readSlackResultThread']) {
    if (typeof publisher?.[name] !== 'function') throw TypeError('The maintained publisher must provide ' + name);
  }
  if (typeof envelope?.asSlackTextBlocks !== 'function') throw TypeError('The maintained native envelope adapter is required');
  if (options.onState !== undefined && typeof options.onState !== 'function') throw TypeError('onState must be a function');
  const readCoordinator = dependencies.readCoordinator || null;
  if (readCoordinator && typeof readCoordinator.read !== 'function') {
    throw TypeError('readCoordinator must provide read(request, performRead)');
  }
  const original = copy(record(request.source_message, 'source_message'));
  reader.projectSlackThreadReference(original);
  const initialArgs = copy(record(request.args || {}, 'thread args'));
  for (const key of Object.keys(initialArgs)) {
    if (!['oldest', 'latest', 'limit'].includes(key)) throw TypeError('Initial thread args accept oldest, latest and limit');
  }
  for (const name of ['oldest', 'latest']) if (initialArgs[name] !== undefined) stamp(initialArgs[name]);
  if (initialArgs.oldest && initialArgs.latest && compareStamp(initialArgs.oldest, initialArgs.latest) > 0) throw TypeError('Thread window is inverted');
  initialArgs.limit = positive(initialArgs.limit ?? 20, 'thread limit', 100);
  const identity = {operation_id: request.operation_id, source_message: original, args: initialArgs};
  let state = options.state ? copy(options.state) : {
    schema: SCHEMA, request: identity, source_message: original, destination: null,
    status: 'NEW', round: 0, captures: [], pending_capture: null, messages: [],
    resolution_collections: copy(options.retained_collections || []),
    next_resolution_request: null, next_request: null, provider_end_observed: false,
    current_args: initialArgs, issue: null, native_calls: 0, updated_at: null,
    cooldown: null, boundary_strategy: 'verified_timestamp_overlap',
    boundary_version: 2, boundary_upgrade_after_observations: 0,
  };
  if (state.schema !== SCHEMA || JSON.stringify(state.request) !== JSON.stringify(identity)
      || !Array.isArray(state.captures) || !Array.isArray(state.messages)
      || !Array.isArray(state.resolution_collections)) {
    throw TypeError('Resume the original intake request and its retained state');
  }
  if (state.cooldown === undefined) state.cooldown = null;
  if (state.read_coordination === undefined) state.read_coordination = {
    logical_reads: state.native_calls, cache_hits: 0, shared_reads: 0, cooldown_waits: 0,
  };
  let active = false;
  const moduleOptions = {
    projectSlackThreadReference: reader.projectSlackThreadReference,
    resolveSlackThreadReference: reader.resolveSlackThreadReference,
    collectSlackPages: reader.collectSlackPages,
  };
  const checkpoint = async () => {
    state.updated_at = new Date().toISOString();
    if (options.onState) await options.onState(copy(state));
  };
  const sourceObservedAt = () => {
    const times = state.captures.filter(capture => capture.projections?.some(
      projection => ['PROJECTED', 'EMPTY_RENDERING', 'PARTIAL'].includes(projection.status)))
      .map(capture => capture.captured_at).filter(value => Number.isFinite(Date.parse(value)));
    return times.sort((a, b) => Date.parse(a) - Date.parse(b)).pop() || null;
  };
  const cooldownView = () => state.cooldown ? {
    ...copy(state.cooldown),
    remaining_ms: Math.max(0, Date.parse(state.cooldown.not_before) - Date.now()),
    active: Date.parse(state.cooldown.not_before) > Date.now(),
  } : null;
  const applyCooldown = () => {
    const waiting = cooldownView()?.active === true;
    if (waiting && state.status !== 'READY') {
      if (state.status !== 'PROVIDER_COOLDOWN') state.cooldown.resume_status = state.status;
      state.status = 'PROVIDER_COOLDOWN';
    } else if (!waiting && state.status === 'PROVIDER_COOLDOWN') {
      state.status = state.cooldown?.resume_status || 'NATIVE_READ_REQUIRED';
    }
    return waiting;
  };
  const rememberCooldown = captureIndex => {
    const capture = state.captures[captureIndex];
    for (const outcome of capture.read_outcomes || []) {
      const failure = outcome.failure;
      const until = outcome.retry_at_ms ?? failure?.retry_at_ms;
      if (!failure?.rate_limited || !Number.isSafeInteger(until)
          || Math.abs(until) > 8640000000000000
          || (state.cooldown && Date.parse(state.cooldown.not_before) >= until)) continue;
      const observed = failure.observed_at_ms;
      if (!Number.isSafeInteger(observed) || Math.abs(observed) > 8640000000000000) continue;
      state.cooldown = {
        observed_at: new Date(observed).toISOString(),
        not_before: new Date(until).toISOString(),
        retry_after_seconds: Math.max(0, (until - observed) / 1000),
        source_capture_index: captureIndex, native_error: copy(failure),
        source_call_id: outcome.source_call_id || failure.source_call_id || null,
      };
    }
    const collections = [...(capture.result.resolution?.collections || []),
      capture.result.collection].filter(Boolean);
    for (const collection of collections) {
      const failure = collection.summary?.native_error;
      if (!failure || !(failure.http_status === 429 || failure.code === 429
          || failure.error_code === 'RATE_LIMITED')) continue;
      const seconds = failure.retry_after_seconds;
      const observed = Date.parse(collection.finished_at || capture.captured_at);
      const until = observed + seconds * 1000;
      if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(observed)
          || !Number.isFinite(until) || Math.abs(until) > 8640000000000000) continue;
      if (state.cooldown && Date.parse(state.cooldown.not_before) >= until) continue;
      state.cooldown = {
        observed_at: new Date(observed).toISOString(),
        not_before: new Date(until).toISOString(), retry_after_seconds: seconds,
        source_capture_index: captureIndex, native_error: copy(failure),
      };
    }
  };
  // Derive whole-thread coverage from the actual collections already retained
  // by this intake. The native reader owns framing, restarts, cursor progress,
  // repeated terminal-page checks and caller-known message completeness.
  // No saved summary or reconstructed message body establishes completion.
  const reconcileThreadCoverage = () => {
    if (!state.destination) return;
    const args = {...copy(state.current_args), channel_id: state.destination.channel_id,
      message_ts: state.destination.parent_thread_ts, response_format: 'detailed'};
    delete args.cursor;
    const key = value => JSON.stringify(Object.keys(value).sort().map(name => [name, value[name]]));
    const withinWindow = ts => (!args.oldest || compareStamp(ts, args.oldest) >= 0)
      && (!args.latest || compareStamp(ts, args.latest) <= 0);
    const known = original.message_ts !== args.message_ts && withinWindow(original.message_ts)
      ? [original.message_ts] : [];
    const received = {schema: 'commons.connected_slack_thread_pages/v1',
      request: {operation: 'read_thread', args, max_pages: 1, timeout_ms: 30000},
      boundary_strategy: state.boundary_strategy ?? 'native_cursor',
      known_message_ts: known, initial_capture: null, collections: [],
      callback_failures: []};
    const legacyUpgrade = received.boundary_strategy === 'verified_timestamp_overlap' &&
      (state.boundary_version ?? 1) < 2;
    const activateBoundaryVersion = () => {
      if (state.boundary_version !== 2) return;
      const count = received.collections.reduce((total, value) => total + value.pages.length, 0);
      const checkpoint = state.boundary_upgrade_after_observations ?? 0;
      if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) {
        throw TypeError('Keep the intake boundary upgrade checkpoint');
      }
      // Old calls keep their original frontier until the exact saved boundary.
      if (count >= checkpoint) {
        received.boundary_version = 2;
        received.boundary_upgrade_after_observations = checkpoint;
      }
    };
    activateBoundaryVersion();
    let view = reader.projectSlackThreadPages(received);
    const joined = [], unjoined = [];
    for (let index = 0; index < state.captures.length; index++) {
      const capture = state.captures[index];
      if (capture.round !== state.round || !capture.result.collection) continue;
      const collection = capture.result.collection;
      if (!view.next_request || key(collection.request.args) !== key(view.next_request.args)) {
        // Earlier implementations retained overlap-window recovery captures.
        // Keep their full bodies and observations; they cannot certify a
        // different whole-window cursor chain or rewind its current frontier.
        unjoined.push({capture_index: index, reason: 'OUTSIDE_COMPLETE_THREAD_FRONTIER'});
        continue;
      }
      received.collections.push(collection);
      activateBoundaryVersion();
      view = reader.projectSlackThreadPages(received);
      joined.push(index);
    }
    if (legacyUpgrade) {
      state.boundary_version = 2;
      state.boundary_upgrade_after_observations =
        received.collections.reduce((total, value) => total + value.pages.length, 0);
      activateBoundaryVersion();
      view = reader.projectSlackThreadPages(received);
    }
    state.thread_coverage = {schema: 'commons.connected_slack_thread_intake_coverage/v1',
      round: state.round, request: copy(received.request), summary: copy(view.summary),
      joined_capture_indices: joined, unjoined_captures: unjoined,
      observations: copy(view.observations), passes: copy(view.passes)};
    const callLimit = !view.summary.complete && view.summary.retained_native_calls >= 1000;
    if (callLimit) state.thread_coverage.summary.stop_reason = 'RETAINED_COLLECTION_LIMIT';
    state.next_request = copy(view.next_request);
    state.provider_end_observed = view.summary.complete === true
      && view.summary.provider_end_observed === true;
    const stop = view.summary.stop_reason;
    state.status = callLimit ? 'CAPTURE_REQUIRES_SOURCE' : view.summary.complete ? 'READY'
      : stop === 'NATIVE_ERROR' || stop === 'NATIVE_EXCEPTION' ? 'NATIVE_READ_REQUIRED'
      : view.next_request ? stop === 'CAPTURE_RECOVERY_REQUIRED' ? 'RECOVERING_CAPTURE' : 'CONTINUE'
      : 'CAPTURE_REQUIRES_SOURCE';
    state.issue = callLimit ? {code: 'RETAINED_COLLECTION_LIMIT',
      detail: 'The current complete-thread receiving has retained 1000 native calls; keep its original source and frontier.'}
      : view.summary.complete || stop === 'NOT_STARTED' || stop === 'PAGE_BUDGET'
        ? null : copy(view.observations.at(-1)?.issue || {
          code: stop, native_error: view.summary.native_error,
        });
  };
  const finishCapture = async (saved, index) => {
    // A retained older capture may add source observations, but its completion
    // must restore the saved newer frontier even after reopening pending state.
    if (saved.preserved_progress) Object.assign(state, copy(saved.preserved_progress));
    reconcileThreadCoverage();
    rememberCooldown(index);
    state.pending_capture = null; saved.processed = true;
    applyCooldown();
    await checkpoint();
  };
  const summary = () => ({
    schema: SCHEMA, operation_id: state.request.operation_id, status: state.status,
    source_message: {channel_id: original.channel_id, message_ts: original.message_ts},
    destination: copy(state.destination), round: state.round,
    messages: state.messages.length, retained_captures: state.captures.length,
    pending_capture: state.pending_capture, native_calls: state.native_calls,
    read_coordination: copy(state.read_coordination),
    provider_end_observed: state.provider_end_observed,
    thread_coverage: copy(state.thread_coverage || null),
    next_request: copy(state.next_request), next_resolution_request: copy(state.next_resolution_request),
    issue: copy(state.issue), updated_at: state.updated_at,
    observed_at: sourceObservedAt(), cooldown: cooldownView(),
    adopted_captures: state.captures.filter(capture => capture.origin === 'retained').length,
  });
  const observedReference = source => {
    const reference = reader.projectSlackThreadReference(source);
    if (reference.channel_id !== original.channel_id || reference.message_ts !== original.message_ts) {
      throw TypeError('A retained source must identify the original selected message');
    }
    if (!reference.canonical_parent) return false;
    if (state.destination && state.destination.parent_thread_ts !== reference.parent_message_ts) {
      throw TypeError('Native source references identify different parents; retain and inspect both captures');
    }
    state.source_message = copy(source);
    state.destination = copy(publisher.prepareSlackResultDestination({
      operation_id: request.operation_id, source_message: source,
    }, moduleOptions));
    return true;
  };
  const useRetainedSearches = () => {
    observedReference(state.source_message);
    for (const collection of state.resolution_collections) {
      for (let pageIndex = 0; pageIndex < (collection?.pages?.length || 0); pageIndex++) {
        const view = reader.projectSlackCollectedSearchResults(collection, {
          page_index: pageIndex, projection: {
            max_results: 20, max_body_chars: 0, max_total_body_chars: 0,
            max_input_chars: 8388608, include_thread_references: true,
          },
        });
        if (view.status !== 'PROJECTED' || view.projection.status !== 'PROJECTED') continue;
        for (const message of view.projection.results) {
          if (message.channel_id === original.channel_id && message.message_ts === original.message_ts
              && message.thread_reference?.canonical_parent) observedReference(message);
        }
      }
    }
  };
  const captureMessages = (captureIndex, collection, pageIndex) => {
    const page = collection.pages[pageIndex];
    const response = collection.responses[page.response_index];
    const nativeRequest = {operation: 'read_thread', args: page.request_args};
    const projection = reader.projectSlackMessages(response, nativeRequest, {
      header_only: true, max_messages: 1000, max_header_chars: 0,
      max_total_header_chars: 0, max_input_chars: 8388608, allow_incomplete_thread: true,
    });
    if (!['PROJECTED', 'EMPTY_RENDERING', 'PARTIAL'].includes(projection.status)) return projection;
    // The original projector reports whether the provider honored the exact
    // request. Keep a refused response in its capture, outside usable context.
    const window = projection.coverage.request_window;
    if (window && (window.invalid_bounds.length || window.bounds_order === 'inverted'
        || window.outside_compared_bounds > 0)) {
      return {...projection, status: 'REFUSED', issue: {
        code: 'REQUEST_WINDOW_NOT_APPLIED',
        detail: 'Native replies do not establish coverage of the exact selected timestamp window.',
        source_issue: copy(projection.issue),
      }};
    }
    const current = [];
    const visited = reader.visitSlackMessages(response, nativeRequest, message => current.push(message),
      {max_input_chars: 8388608, allow_incomplete_thread: true});
    if (visited.status !== 'VISITED') return {status: 'REFUSED', issue: visited.issue};
    for (const message of current) {
      const location = {capture_index: captureIndex, page_index: pageIndex, source_index: message.source_index};
      const existing = state.messages.find(row => row.channel_id === message.channel_id && row.message_ts === message.message_ts);
      if (existing) {
        if (!existing.observations.some(ref => JSON.stringify(ref) === JSON.stringify(location))) existing.observations.push(location);
        const previous = state.captures[existing.source.capture_index];
        const incoming = state.captures[captureIndex];
        if (Date.parse(incoming.captured_at) >= Date.parse(previous.captured_at)) {
          existing.source = location; existing.kind = message.kind; existing.user = message.user;
        }
      } else state.messages.push({
        channel_id: message.channel_id, message_ts: message.message_ts,
        parent_message_ts: state.destination.parent_thread_ts, kind: message.kind,
        user: message.user, source: location, observations: [location],
      });
    }
    state.messages.sort((a, b) => compareStamp(a.message_ts, b.message_ts));
    return projection;
  };
  const processPending = async () => {
    if (state.pending_capture === null) return;
    // Persist the complete original result before deriving context or advancing.
    await checkpoint();
    const index = state.pending_capture, saved = state.captures[index], result = saved.result;
    if (result.resolution) {
      state.resolution_collections = copy(result.resolution.collections);
      state.next_resolution_request = copy(result.resolution.next_request);
    }
    if (result.result_destination) state.destination = copy(result.result_destination);
    const collection = result.collection;
    if (!collection) {
      state.status = 'RESOLUTION_REQUIRED';
      state.issue = copy(result.resolution?.issue || {code: 'THREAD_REFERENCE_REQUIRED'});
      await finishCapture(saved, index); return;
    }
    for (let pageIndex = 0; pageIndex < collection.pages.length; pageIndex++) {
      const page = collection.pages[pageIndex];
      if (page.response_index === null || page.error) continue;
      const projection = captureMessages(index, collection, pageIndex);
      saved.projections.push({page_index: pageIndex, status: projection.status,
        issue: projection.issue, coverage: projection.coverage});
      if (projection.status !== 'PROJECTED' && projection.status !== 'EMPTY_RENDERING') {
        const recovery = reader.planSlackThreadRecovery(projection,
          {operation: 'read_thread', args: page.request_args});
        saved.projections[saved.projections.length - 1].recovery = copy(recovery);
        state.next_request = recovery.request ? {...copy(recovery.request),
          max_pages: 1, timeout_ms: collection.request.timeout_ms} : null;
        state.status = recovery.request ? 'RECOVERING_CAPTURE' : 'CAPTURE_REQUIRES_SOURCE';
        state.provider_end_observed = false;
        state.issue = copy(projection.issue);
        await finishCapture(saved, index); return;
      }
    }
    const complete = collection.summary.provider_end_observed === true
      && collection.summary.stop_reason === 'PROVIDER_END';
    state.next_request = copy(collection.next_request);
    if (!complete && !state.next_request && collection.pages.length) {
      // A failed/unknown page can be read again at its original request; this is
      // not an inferred provider cursor or a change to the selected window.
      state.next_request = {operation: 'read_thread',
        args: copy(collection.pages[collection.pages.length - 1].request_args),
        max_pages: 1, timeout_ms: collection.request.timeout_ms};
    }
    state.provider_end_observed = complete;
    state.status = complete ? 'READY' : collection.summary.stop_reason === 'PAGE_BUDGET'
      || collection.summary.stop_reason === 'TIME_BUDGET' ? 'CONTINUE' : 'NATIVE_READ_REQUIRED';
    state.issue = complete || state.status === 'CONTINUE' ? null : {
      code: collection.summary.stop_reason, native_error: collection.summary.native_error || null,
    };
    await finishCapture(saved, index);
  };
  const nativeBridge = (tools, originals, outcomes) => {
    const bridge = {};
    for (const name of ['mcp__codex_apps__slack_slack_read_thread',
      'mcp__codex_apps__slack_slack_search_public_and_private', 'mcp__codex_apps__slack_slack_search_public']) {
      if (typeof tools?.[name] !== 'function') continue;
      bridge[name] = async args => {
        let response;
        if (readCoordinator) {
          let outcome;
          try {
            outcome = await readCoordinator.read({binding: name, args: copy(args)}, () => tools[name](args));
          } catch (error) {
            if (error.read_outcome) {
              const retained = {...error.read_outcome, binding: name, args: copy(args)}; delete retained.response;
              outcomes.push(retained);
              if (error.read_outcome.response !== null) originals.push({
                binding: name, args: copy(args), response: copy(error.read_outcome.response),
              });
            }
            throw error;
          }
          const metadata = {...outcome, binding: name, args: copy(args)}; delete metadata.response;
          outcomes.push(metadata);
          if (outcome.status === 'WAIT' || outcome.status === 'ERROR') {
            const error = Error(outcome.error?.message || 'Native read cooldown until ' + outcome.retry_at_ms);
            error.name = outcome.error?.name || 'ConnectedReadCooldown';
            error.retry_at_ms = outcome.retry_at_ms || outcome.failure?.retry_at_ms || null;
            throw error;
          }
          response = outcome.response;
        } else {
          outcomes.push({status: 'FETCHED', native_calls: 1, binding: name, args: copy(args)});
          response = await tools[name](args);
        }
        const adapted = envelope.asSlackTextBlocks(response);
        if (adapted !== response) originals.push({binding: name, args: copy(args), response: copy(response)});
        return adapted;
      };
    }
    return bridge;
  };
  const read = async (tools, limits = {}) => {
    if (active) throw Error('Continue one read at a time for the same intake');
    active = true;
    try {
      record(limits, 'read limits');
      const maxPages = positive(limits.max_pages ?? 4, 'max_pages');
      const timeout = positive(limits.timeout_ms ?? 30000, 'timeout_ms');
      const start = Date.now();
      await checkpoint();
      await processPending();
      reconcileThreadCoverage();
      if (state.status === 'READY') return summary();
      useRetainedSearches();
      reconcileThreadCoverage();
      if (applyCooldown()) { await checkpoint(); return summary(); }
      if (state.status === 'READY' || state.status === 'CAPTURE_REQUIRES_SOURCE') {
        await checkpoint(); return summary();
      }
      let pages = 0;
      while (pages < maxPages && Date.now() - start < timeout) {
        const originals = [], outcomes = [];
        const remaining = Math.max(1, timeout - (Date.now() - start));
        const args = state.next_request ? copy(state.next_request.args) : copy(state.current_args);
        const result = await publisher.readSlackResultThread(nativeBridge(tools, originals, outcomes),
          state.destination || {operation_id: request.operation_id, source_message: state.source_message},
          {args, max_pages: 1, timeout_ms: remaining}, {
            ...moduleOptions, resolution: {
              retained_collections: state.resolution_collections, max_pages: 1, timeout_ms: remaining,
              ...(state.next_resolution_request ? {next_request: state.next_resolution_request} : {}),
            },
          });
        const calls = (result.collection?.summary.calls || 0) + (result.resolution?.summary.native_calls || 0);
        state.native_calls += outcomes.reduce((count, outcome) => count + outcome.native_calls, 0);
        state.read_coordination.logical_reads += calls;
        state.read_coordination.cache_hits += outcomes.filter(outcome => outcome.status === 'CACHE').length;
        state.read_coordination.shared_reads += outcomes.filter(outcome => outcome.shared === true).length;
        state.read_coordination.cooldown_waits += outcomes.filter(outcome => outcome.status === 'WAIT').length;
        pages += Math.max(1, calls);
        const index = state.captures.length;
        const observedTimes = outcomes.filter(outcome =>
          outcome.binding === 'mcp__codex_apps__slack_slack_read_thread'
          && Number.isSafeInteger(outcome.fetched_at_ms)
          && Math.abs(outcome.fetched_at_ms) <= 8640000000000000)
          .map(outcome => outcome.fetched_at_ms);
        state.captures.push({round: state.round, origin: 'native',
          captured_at: observedTimes.length
            ? new Date(Math.max(...observedTimes)).toISOString()
            : result.collection?.finished_at || new Date().toISOString(),
          result: copy(result), original_envelopes: originals, read_outcomes: outcomes,
          projections: [], processed: false});
        state.pending_capture = index;
        await processPending();
        if (!['CONTINUE', 'RECOVERING_CAPTURE'].includes(state.status)) break;
      }
      return summary();
    } finally { active = false; }
  };

  const deliveredMessage = (row, cache) => {
    const location = row.source;
    record(location, 'message source');
    for (const key of ['capture_index', 'page_index', 'source_index']) {
      if (!Number.isSafeInteger(location[key]) || location[key] < 0) {
        throw TypeError('A delivery bookmark must retain its original source indices');
      }
    }
    const key = location.capture_index + ':' + location.page_index;
    if (!cache.has(key)) {
      const capture = state.captures[location.capture_index];
      const collection = capture?.result?.collection;
      const page = collection?.pages?.[location.page_index];
      if (!page || page.response_index === null || !collection.responses[page.response_index]) {
        throw TypeError('A delivery bookmark needs its original retained capture');
      }
      const messages = new Map();
      const visit = reader.visitSlackMessages(collection.responses[page.response_index],
        {operation: 'read_thread', args: page.request_args},
        message => messages.set(message.source_index, message),
        {max_input_chars: 8388608, allow_incomplete_thread: true});
      if (visit.status !== 'VISITED') throw Error('Retained delivery source is unavailable');
      cache.set(key, messages);
    }
    const message = cache.get(key).get(location.source_index);
    if (!message || message.channel_id !== row.channel_id || message.message_ts !== row.message_ts) {
      throw TypeError('A delivery bookmark must identify its original message source');
    }
    return message;
  };
  /**
   * Present only new or changed retained bodies since a caller's last delivery.
   * The returned bookmark advances only delivered bodies and unchanged versions.
   * Saving it is the caller's acknowledgement; this method writes no state.
   */
  const delivery = (bookmark = null, selection = {}) => {
    record(selection, 'delivery selection');
    for (const key of Object.keys(selection)) {
      if (key !== 'limit') throw TypeError('Delivery selection accepts limit');
    }
    const limit = selection.limit === undefined ? state.messages.length
      : positive(selection.limit, 'delivery limit');
    const bookmarkSchema = 'commons.connected_slack_thread_delivery_bookmark/v1';
    const sourceIdentity = {channel_id: original.channel_id, message_ts: original.message_ts};
    const before = new Map(), cache = new Map();
    const rowKey = row => row.channel_id + ':' + row.message_ts;
    const sourceEqual = (a, b) => a.capture_index === b.capture_index
      && a.page_index === b.page_index && a.source_index === b.source_index;
    if (bookmark !== null) {
      record(bookmark, 'delivery bookmark');
      if (bookmark.schema !== bookmarkSchema || bookmark.operation_id !== request.operation_id
          || (bookmark.source_message?.channel_id !== sourceIdentity.channel_id
            || bookmark.source_message?.message_ts !== sourceIdentity.message_ts)
          || !Array.isArray(bookmark.messages)) {
        throw TypeError('Resume the delivery bookmark for this original thread operation');
      }
      const current = new Map(state.messages.map(row => [rowKey(row), row]));
      for (const item of bookmark.messages) {
        record(item, 'delivery bookmark message');
        const key = rowKey(item), row = current.get(key);
        if (!row || before.has(key) || !row.observations.some(source =>
          sourceEqual(source, item.source || {}))) {
          throw TypeError('A delivery bookmark must belong to this retained message history');
        }
        before.set(key, {channel_id: row.channel_id, message_ts: row.message_ts,
          source: copy(item.source)});
      }
    }
    const next = new Map(before), output = [];
    let added = 0, changed = 0, unchanged = 0, pending = 0;
    for (const row of state.messages) {
      const key = rowKey(row), prior = before.get(key);
      let change = 'added', message;
      if (prior && sourceEqual(prior.source, row.source)) {
        unchanged++; continue;
      }
      message = deliveredMessage(row, cache);
      if (prior) {
        const previous = deliveredMessage(prior, cache);
        if (previous.text === message.text && previous.user === message.user
            && previous.kind === message.kind) {
          unchanged++;
          next.set(key, {channel_id: row.channel_id, message_ts: row.message_ts, source: copy(row.source)});
          continue;
        }
        change = 'changed';
      }
      if (change === 'added') added++; else changed++;
      if (output.length >= limit) { pending++; continue; }
      output.push({...copy(message), parent_message_ts: state.destination.parent_thread_ts,
        change, source: copy(row.source), observations: copy(row.observations),
        ...(prior ? {previous_source: copy(prior.source)} : {})});
      next.set(key, {channel_id: row.channel_id, message_ts: row.message_ts, source: copy(row.source)});
    }
    const messages = [...next.values()].sort((a, b) => compareStamp(a.message_ts, b.message_ts));
    return {
      schema: 'commons.connected_slack_thread_delivery/v1',
      operation_id: request.operation_id, destination: copy(state.destination),
      status: state.status, current_window: copy(state.current_args),
      provider_end_observed: state.provider_end_observed,
      thread_coverage: copy(state.thread_coverage || null),
      observed_at: sourceObservedAt(), cooldown: cooldownView(), issue: copy(state.issue),
      messages: output,
      counts: {retained_messages: state.messages.length, added_messages: added,
        changed_messages: changed, unchanged_messages: unchanged,
        delivered_messages: output.length, remaining_messages: pending},
      delivery_complete: pending === 0,
      bookmark: {schema: bookmarkSchema, operation_id: request.operation_id,
        source_message: sourceIdentity, messages},
    };
  };

  // Reopening preserves all source and bookmarks while re-deriving the
  // current completion state from the maintained reader, including old saves.
  reconcileThreadCoverage();

  return Object.freeze({
    read,
    delivery,
    snapshot: () => copy(state),
    summary,
    async retainThread(collection, retention = {}) {
      if (active) throw Error('Retain a thread between reads of the same intake');
      active = true;
      try {
        record(collection, 'original thread collection'); record(retention, 'retention');
        for (const key of Object.keys(retention)) {
          if (!['observed_at', 'source', 'original_envelopes'].includes(key)) {
            throw TypeError('Unsupported thread retention field: ' + key);
          }
        }
        if (collection.schema !== 'commons.connected_slack_pages/v1'
            || collection.operation !== 'read_thread'
            || collection.request?.operation !== 'read_thread'
            || !Array.isArray(collection.pages) || !collection.pages.length
            || !Array.isArray(collection.responses) || !collection.summary) {
          throw TypeError('Supply the complete original native read_thread collection');
        }
        const retained = copy(collection);
        const observedAt = retention.observed_at || retained.finished_at;
        if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
          throw TypeError('Keep the original collection observation time');
        }
        if (retention.original_envelopes !== undefined && !Array.isArray(retention.original_envelopes)) {
          throw TypeError('original_envelopes must be an array');
        }
        await processPending();
        useRetainedSearches();
        if (!state.destination) throw TypeError('Resolve the original selected message parent before retaining its thread');
        // An already accepted exact capture remains the same historical source
        // after its cursor or recovery window has advanced.
        const encoded = JSON.stringify(retained);
        if (state.captures.some(capture => JSON.stringify(capture.result.collection) === encoded)) {
          return summary();
        }
        const selectedArgs = state.next_request?.args || state.current_args;
        const firstArgs = record(retained.request.args, 'retained original request args');
        const sameWindow = (left, right) =>
          (left.oldest ?? null) === (right.oldest ?? null)
          && (left.latest ?? null) === (right.latest ?? null);
        const matchWindow = args => {
          record(args, 'retained request args');
          if (args.channel_id !== state.destination.channel_id
              || args.message_ts !== state.destination.parent_thread_ts
              || !sameWindow(args, firstArgs)
              || args.limit !== firstArgs.limit
              || (args.response_format !== undefined && args.response_format !== 'detailed')) {
            throw TypeError('Keep the retained collection\'s exact thread, parent, window and page size');
          }
          positive(args.limit, 'retained thread limit', 1000);
          for (const name of ['oldest', 'latest']) if (args[name] !== undefined) stamp(args[name]);
          if (args.cursor !== undefined && (typeof args.cursor !== 'string' || !args.cursor)) {
            throw TypeError('Retain an original nonempty opaque cursor');
          }
        };
        matchWindow(firstArgs);
        const firstCursor = firstArgs.cursor ?? null;
        const expectedCursor = selectedArgs.cursor ?? null;
        const joinsSelected = sameWindow(firstArgs, selectedArgs)
          && firstArgs.limit === selectedArgs.limit;
        const restartsOriginal = sameWindow(firstArgs, state.current_args);
        // A returned recovery is a new reader-selected window. Its exact
        // request is already saved in next_request; do not compare it to the
        // original wider window or carry an old cursor into that new window.
        // An earlier full capture can still start the original window at null.
        const historicalRecovery = firstCursor === null && state.captures.some(capture =>
          (capture.projections || []).some(projection => {
            const prior = projection.recovery?.request?.args;
            return prior && sameWindow(firstArgs, prior) && firstArgs.limit === prior.limit
              && prior.channel_id === firstArgs.channel_id && prior.message_ts === firstArgs.message_ts;
          }));
        if (firstCursor === null ? !restartsOriginal && !joinsSelected && !historicalRecovery
            : !joinsSelected || firstCursor !== expectedCursor) {
          throw TypeError('Retained continuation does not join the original window or exact saved recovery request');
        }
        let nextCursor = firstCursor;
        for (let index = 0; index < retained.pages.length; index++) {
          const page = retained.pages[index]; record(page, 'retained page');
          matchWindow(page.request_args);
          if ((page.request_args.cursor ?? null) !== nextCursor
              || (index > 0 && nextCursor === null)) {
            throw TypeError('Retain the original uninterrupted native cursor chain');
          }
          if (page.response_index !== null
              && (!Number.isSafeInteger(page.response_index) || page.response_index < 0
                || page.response_index >= retained.responses.length)) {
            throw TypeError('A retained page is missing its original response');
          }
          if (page.response_index === null && !page.error) {
            throw TypeError('A retained page has neither a response nor its native error');
          }
          nextCursor = page.next_cursor ?? null;
          if (page.error && index + 1 !== retained.pages.length) {
            throw TypeError('A native cursor chain cannot continue beyond its failed page');
          }
        }
        if (retained.next_request) {
          matchWindow(retained.next_request.args);
          const last = retained.pages[retained.pages.length - 1];
          const expectedNext = last.error ? last.request_args.cursor ?? null : nextCursor;
          if ((retained.next_request.args.cursor ?? null) !== expectedNext) {
            throw TypeError('Retained next request does not preserve the original cursor chain');
          }
        }
        const previousObservation = sourceObservedAt();
        const preserveProgress = previousObservation
          && Date.parse(observedAt) < Date.parse(previousObservation)
          ? copy({status: state.status === 'PROVIDER_COOLDOWN'
            ? state.cooldown?.resume_status || 'NATIVE_READ_REQUIRED' : state.status,
            next_request: state.next_request,
            provider_end_observed: state.provider_end_observed, issue: state.issue})
          : null;
        const index = state.captures.length;
        state.captures.push({
          round: state.round, origin: 'retained', captured_at: new Date(Date.parse(observedAt)).toISOString(),
          result: {result_destination: copy(state.destination), collection: retained},
          original_envelopes: copy(retention.original_envelopes || []),
          ...(retention.source !== undefined ? {retained_source: copy(retention.source)} : {}),
          // Persist before processPending's first checkpoint. Cooldown is
          // reapplied from its retained evidence after this progress is restored.
          ...(preserveProgress ? {preserved_progress: preserveProgress} : {}),
          projections: [], processed: false,
        });
        state.pending_capture = index;
        await processPending();
        return summary();
      } finally { active = false; }
    },
    async retainSearch(collection) {
      if (active) throw Error('Retain a search between reads of the same intake');
      record(collection, 'original search collection');
      state.resolution_collections.push(copy(collection));
      useRetainedSearches();
      if (state.destination && state.status === 'RESOLUTION_REQUIRED') {
        state.status = 'CONTINUE'; state.issue = null; state.next_resolution_request = null;
      }
      await checkpoint(); return summary();
    },
    context() {
      const selected = new Map();
      for (const row of state.messages) {
        const {capture_index, page_index} = row.source;
        const key = capture_index + ':' + page_index;
        if (!selected.has(key)) {
          const collection = state.captures[capture_index].result.collection;
          const page = collection.pages[page_index], messages = [];
          reader.visitSlackMessages(collection.responses[page.response_index],
            {operation: 'read_thread', args: page.request_args}, message => messages.push(message),
            {max_input_chars: 8388608, allow_incomplete_thread: true});
          selected.set(key, messages);
        }
      }
      return {operation_id: request.operation_id, destination: copy(state.destination),
        status: state.status, current_window: copy(state.current_args),
        provider_end_observed: state.provider_end_observed,
        thread_coverage: copy(state.thread_coverage || null),
        messages: state.messages.map(row => {
          const ref = row.source, message = selected.get(ref.capture_index + ':' + ref.page_index)
            .find(value => value.source_index === ref.source_index && value.message_ts === row.message_ts);
          if (!message) throw Error('Retained message source is unavailable');
          return {...copy(message), parent_message_ts: state.destination.parent_thread_ts,
            source: copy(ref), observations: copy(row.observations)};
        }),
        next_request: copy(state.next_request), issue: copy(state.issue),
        observed_at: sourceObservedAt(), cooldown: cooldownView()};
    },
    async refresh(tools, limits = {}) {
      if (active || state.pending_capture !== null) throw Error('Finish the current retained page before refreshing');
      record(limits, 'refresh limits');
      const mode = limits.mode ?? 'new_replies';
      if (!['new_replies', 'full'].includes(mode)) throw TypeError('Refresh mode must be new_replies or full');
      const readLimits = {...limits}; delete readLimits.mode;
      reconcileThreadCoverage();
      if (state.status !== 'READY') return read(tools, readLimits);
      const replies = state.messages.filter(row => row.kind !== 'thread_parent');
      const args = copy(initialArgs);
      if (mode === 'new_replies' && replies.length) {
        const last = replies[replies.length - 1].message_ts;
        const [seconds, fractional] = last.split('.');
        const precision = Math.max(6, fractional.length);
        const tick = BigInt(seconds + fractional.padEnd(precision, '0')) - 1n;
        const digits = tick.toString().padStart(precision + 1, '0');
        const overlap = digits.slice(0, -precision) + '.' + digits.slice(-precision);
        if (!args.oldest || compareStamp(overlap, args.oldest) > 0) args.oldest = overlap;
      }
      state.round += 1; state.current_args = args; state.next_request = null;
      state.boundary_strategy = 'verified_timestamp_overlap';
      state.boundary_version = 2; state.boundary_upgrade_after_observations = 0;
      state.provider_end_observed = false; state.status = 'CONTINUE'; state.issue = null;
      await checkpoint(); return read(tools, readLimits);
    },
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = {SCHEMA, createSlackThreadIntake};
