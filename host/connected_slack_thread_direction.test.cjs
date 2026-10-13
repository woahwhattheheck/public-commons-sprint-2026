'use strict';

// One structural regression for a truncated thread whose displayed reply order
// differs from its native pagination direction. No retained Slack content.
async function checkThreadDirection(reader) {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const parent = '1700000000.000000', channel = 'CTHREAD';
  const all = Array.from({length: 100}, (_, index) => ({
    ts: String(1700000001 + index) + '.000000', text: 'Neutral reply ' + (index + 1),
  }));
  const envelope = (rows, declared, cursor) => ({
    content: [{type: 'text', text: JSON.stringify({
      messages: '=== THREAD PARENT MESSAGE ===\nFrom: Neutral (UNEUTRAL)\nTime: retained\nMessage TS: ' +
        parent + '\nOriginal neutral parent\n\n=== THREAD REPLIES (' + declared + ' total) ===\n\n' +
        rows.map((row, index) => '--- Reply ' + (index + 1) + ' of ' + declared +
          ' ---\nFrom: Neutral (UNEUTRAL)\nTime: retained\nMessage TS: ' + row.ts + '\n' + row.text).join('\n\n') + '\n',
      pagination_info: cursor ? 'There are more messages. Use cursor: `' + cursor + '`\n'
        : 'There are no more messages in this thread.\n',
    })}], isError: false,
  });
  function provider(direction) {
    const cursors = new Map(), calls = [];
    const tool = async args => {
      calls.push({...args});
      let rows = args.cursor ? cursors.get(args.cursor) : all.filter(row =>
        (!args.oldest || row.ts >= args.oldest) && (!args.latest || row.ts <= args.latest));
      if (!rows) throw Error('Native cursor was changed or invented');
      const selected = direction === 'backward' ? rows.slice(-args.limit) : rows.slice(0, args.limit);
      const remaining = direction === 'backward' ? rows.slice(0, -selected.length) : rows.slice(selected.length);
      let cursor = null;
      if (remaining.length) { cursor = 'opaque-' + calls.length; cursors.set(cursor, remaining); }
      return envelope(selected, selected.length, cursor);
    };
    return {tools: {mcp__codex_apps__slack_slack_read_thread: tool}, calls};
  }
  const args = {channel_id: channel, message_ts: parent, oldest: all[0].ts,
    latest: all[99].ts, limit: 100, response_format: 'detailed'};
  const request = {operation: 'read_thread', args, max_pages: 20, timeout_ms: 10000};
  const results = [];
  for (const [declared, rendered] of [[100, 55], [60, 50]]) {
  const partial = envelope(all.slice(0, rendered), declared, 'opaque-unseen-tail');
  for (const direction of ['forward', 'backward']) {
    const native = provider(direction);
    const value = await reader.collectSlackThreadPages(native.tools, request,
      {initial_capture: {request_args: args, response: partial}});
    const rows = [];
    const visited = reader.visitSlackThreadMessages(value, row => {
      if (row.kind === 'thread_reply') rows.push(row.message_ts);
    });
    assert(value.summary.complete && visited.status === 'VISITED', direction + ': receiving incomplete');
    assert(JSON.stringify(rows) === JSON.stringify(all.map(row => row.ts)), direction + ': source replies skipped');
    assert(!native.calls.some(call => call.cursor === 'opaque-unseen-tail'), 'Advanced visibly truncated cursor');
    assert(value.projection.passes.at(-1).overlap_direction === direction, 'Wrong observed page direction');
    results.push({declared, rendered, direction, replies: rows.length, calls: native.calls.length});
  }
  }
  const native = provider('backward');
  const cursorOnly = await reader.collectSlackPages(native.tools,
    {...request, args: {...args, limit: 20}});
  assert(cursorOnly.summary.provider_end_observed && native.calls.length === 5,
    'Ordinary opaque-cursor pagination changed');
  assert(native.calls.slice(1).every(call => call.cursor && call.oldest === args.oldest &&
    call.latest === args.latest), 'Ordinary cursor-only bounds were changed');
  const terminalCalls = [];
  const terminalTools = {mcp__codex_apps__slack_slack_read_thread: async call => {
    terminalCalls.push({...call});
    if (terminalCalls.length === 1) return envelope(all.slice(0, 2), 2, 'opaque-terminal');
    assert(call.cursor === 'opaque-terminal', 'Terminal cursor was changed');
    const empty = envelope([], 0, null);
    const payload = JSON.parse(empty.content[0].text);
    payload.messages = payload.messages.split('=== THREAD REPLIES')[0] + 'No thread messsages\n';
    empty.content[0].text = JSON.stringify(payload);
    return empty;
  }};
  const terminal = await reader.collectSlackThreadPages(terminalTools,
    {...request, args: {...args, limit: 20}});
  assert(terminal.summary.complete && terminalCalls.length === 2,
    'An empty original-cursor terminal page was rejected');
  return {case: 'truncated-thread-and-native-direction', results,
    cursor_only_calls: native.calls.length, empty_terminal_calls: terminalCalls.length};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {checkThreadDirection};
if (typeof require === 'function' && require.main === module) {
  checkThreadDirection(require('./connected_slack_pages.cjs')).then(
    value => process.stdout.write(JSON.stringify(value) + '\n'),
    error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
