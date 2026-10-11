// MIT. Inspect retained Tenderly Simulation API output; execution stays with its provider.
export const ANALYSIS_SCHEMA = 'stellar-forge.tenderly-analysis.v1';
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export class AnalysisError extends Error {
  constructor(code, message = code) { super(message); this.name = 'AnalysisError'; this.code = code; }
}
export function requireValue(value, code, message) {
  if (!value) throw new AnalysisError(code, message);
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const part = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
export function atPointer(value, pointer = '') {
  requireValue(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')) && pointer.length <= 2048,
    'PAYLOAD_POINTER_INVALID');
  for (const word of pointer === '' ? [] : pointer.slice(1).split('/')) {
    requireValue(!/~(?![01])/.test(word), 'PAYLOAD_POINTER_INVALID');
    const key = word.replaceAll('~1', '/').replaceAll('~0', '~');
    requireValue((object(value) || Array.isArray(value)) && own(value, key), 'PAYLOAD_POINTER_MISSING');
    value = value[key];
  }
  return value;
}
export function integerString(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : null;
  if (typeof value !== 'string' || value.length > 1024) return null;
  if (/^-?(0|[1-9][0-9]*)$/.test(value)) return BigInt(value).toString();
  if (/^0x[0-9a-f]+$/i.test(value)) return BigInt(value).toString();
  return null;
}
const scalar = value => typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ? value : null;
const text = value => typeof value === 'string' ? value : null;
const array = value => Array.isArray(value) ? value : [];
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : text(value);
const network = value => typeof value === 'string' ? value.trim() ? value : null :
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
const present = (...values) => values.find(v => v !== null && v !== undefined) ?? null;
const status = value => typeof value === 'boolean' ? value : null;
const pick = (value, names) => Object.fromEntries(names.map(name => [name, scalar(value?.[name])]).filter(([, v]) => v !== null));
const delta = (before, after) => before !== null && after !== null ? (BigInt(after) - BigInt(before)).toString() : null;

function sourceArray(candidates) {
  return candidates.find(([v]) => Array.isArray(v)) ?? [[], ''];
}
function traceRows(transaction, base, findings) {
  const nested = transaction.transaction_info?.call_trace;
  const rows = [];
  const roots = object(nested) ? [[nested, '/transaction/transaction_info/call_trace', '0', 0]] :
    array(transaction.call_trace).map((node, i) => [node, '/transaction/call_trace/' + i, String(i), 0]);
  const stack = roots.reverse();
  while (stack.length) {
    requireValue(rows.length < 100000, 'TRACE_ROW_LIMIT', 'This response has more than 100,000 trace calls.');
    const [node, pointer, path, depth] = stack.pop();
    if (!object(node)) { findings.push({code:'TRACE_RECORD_INVALID', pointer:base + pointer}); continue; }
    requireValue(depth < 512, 'TRACE_DEPTH_LIMIT');
    const error = present(text(node.error), text(node.error_message), text(node.revert_reason));
    rows.push({path, depth, type:present(text(node.call_type), text(node.type), text(node.function_op)),
      from:address(node.from), to:address(present(node.to, node.address)),
      method:present(text(node.method), text(node.function_name)), input:text(node.input),
      value:integerString(node.value), gasLimit:integerString(node.gas), gasUsed:integerString(node.gas_used),
      output:text(node.output), error, sourcePointer:base + pointer});
    const calls = array(node.calls);
    for (let i = calls.length - 1; i >= 0; i--) stack.push([calls[i], pointer + '/calls/' + i, path + '.' + i, depth + 1]);
  }
  return {rows, representation:object(nested) ? 'nested' : Array.isArray(transaction.call_trace) ? 'flat' : 'unavailable'};
}
function stateRows(info, transaction, base) {
  const rows = [];
  const [states, statePath] = sourceArray([[info.state_diff, '/transaction/transaction_info/state_diff'],
    [transaction.state_diff, '/transaction/state_diff']]);
  states.forEach((entry, i) => {
    if (!object(entry)) return;
    if (Array.isArray(entry.raw)) {
      entry.raw.forEach((raw, j) => {
        if (object(raw)) rows.push({kind:'storage', address:address(present(raw.address, entry.address)),
          slot:present(text(raw.key), text(raw.slot)), before:scalar(raw.original), after:scalar(raw.dirty),
          sourcePointer:base + statePath + '/' + i + '/raw/' + j});
      });
    } else rows.push({kind:'storage', address:address(entry.address), slot:present(text(entry.key), text(entry.slot)),
      before:scalar(entry.original), after:scalar(entry.dirty), sourcePointer:base + statePath + '/' + i});
  });
  for (const [kind, name] of [['balance','balance_diff'], ['nonce','nonce_diff']]) {
    const [changes, pointer] = sourceArray([[info[name], '/transaction/transaction_info/' + name],
      [transaction[name], '/transaction/' + name]]);
    changes.forEach((entry, i) => {
      if (object(entry)) rows.push({kind, address:address(entry.address), slot:null,
        before:scalar(entry.original), after:scalar(entry.dirty), sourcePointer:base + pointer + '/' + i});
    });
  }
  return rows;
}
function assetRows(info, transaction, base) {
  const rows = [];
  for (const key of ['asset_changes', 'balance_changes']) {
    const [entries, pointer] = sourceArray([[info[key], '/transaction/transaction_info/' + key],
      [transaction[key], '/transaction/' + key]]);
    entries.forEach((entry, i) => {
      if (!object(entry)) return;
      const token = entry.token_info ?? entry.asset_info ?? {};
      const [amountField, amount] = ['raw_amount','amount','change'].map(key => [key,scalar(entry[key])])
        .find(([,value]) => value !== null) ?? [null,null];
      rows.push({kind:key, type:present(text(entry.type), text(entry.change_type)),
        address:address(present(entry.address, entry.owner)), from:address(entry.from), to:address(entry.to),
        asset:address(present(token.contract_address, token.address, entry.contract_address)),
        symbol:present(text(token.symbol), text(entry.symbol)),
        amount, amountField,
        decimals:scalar(token.decimals), tokenId:present(scalar(entry.token_id), scalar(token.token_id)),
        details:entry, sourcePointer:base + pointer + '/' + i});
    });
  }
  return rows;
}
function logRows(info, transaction, base) {
  const [logs, pointer] = sourceArray([[info.logs, '/transaction/transaction_info/logs'], [transaction.logs, '/transaction/logs']]);
  return logs.flatMap((entry, i) => {
    if (!object(entry)) return [];
    const raw = object(entry.raw) ? entry.raw : entry;
    return [{index:i, address:address(raw.address), event:text(entry.name),
      topic0:text(array(raw.topics)[0]), topics:array(raw.topics), data:text(raw.data),
      inputs:array(entry.inputs), sourcePointer:base + pointer + '/' + i}];
  });
}

/** payloadPointer is an explicit RFC 6901 pointer into a merchant envelope. */
export function analyzeSimulation(response, {request = null, payloadPointer = ''} = {}) {
  const payload = atPointer(response, payloadPointer);
  requireValue(object(payload) && object(payload.transaction) && object(payload.simulation),
    'TENDERLY_SIMULATION_RESPONSE_REQUIRED', 'Select the saved Simulation API object containing transaction and simulation.');
  requireValue(request === null || object(request), 'SIMULATION_REQUEST_INVALID');
  const transaction = payload.transaction, simulation = payload.simulation;
  const info = object(transaction.transaction_info) ? transaction.transaction_info : {};
  const findings = [];
  const fields = {network:['network_id', network],
    block:['block_number', integerString], transactionIndex:['transaction_index', integerString],
    from:['from', address], to:['to', address], input:['input', text], value:['value', integerString], gasLimit:['gas', integerString]};
  const context = {}, contextSources = {}, requested = {};
  for (const [name, [key, normalize]] of Object.entries(fields)) {
    const s = normalize(simulation[key]), t = normalize(transaction[name === 'transactionIndex' ? 'index' : key]);
    context[name] = present(s, t);
    contextSources[name] = s !== null ? payloadPointer + '/simulation/' + key : t !== null ?
      payloadPointer + '/transaction/' + (name === 'transactionIndex' ? 'index' : key) : null;
    requested[name] = request && own(request, key) ? normalize(request[key]) : null;
    if (s !== null && t !== null && s !== t) findings.push({code:'RESPONSE_CONTEXT_DIFFERS', field:name,
      simulation:s, transaction:t});
    if (requested[name] !== null && context[name] !== null && requested[name] !== context[name])
      findings.push({code:'REQUEST_RESPONSE_CONTEXT_DIFFERS', field:name, requested:requested[name], observed:context[name]});
  }
  const simulationStatus = status(simulation.status), transactionStatus = status(transaction.status);
  if (simulationStatus !== null && transactionStatus !== null && simulationStatus !== transactionStatus)
    findings.push({code:'RESPONSE_STATUS_DIFFERS', simulation:simulationStatus, transaction:transactionStatus});
  const success = present(simulationStatus, transactionStatus);
  const observedGas = present(integerString(simulation.gas_used), integerString(transaction.gas_used));
  const trace = traceRows(transaction, payloadPointer, findings);
  const state = stateRows(info, transaction, payloadPointer);
  const assets = assetRows(info, transaction, payloadPointer), logs = logRows(info, transaction, payloadPointer);
  const tables = {calls:trace.rows, state, assets, logs};
  return {schema:ANALYSIS_SCHEMA, provider:'Tenderly Simulation API', payloadPointer,
    simulationId:text(simulation.id), transactionHash:text(transaction.hash),
    context, contextSources, requested,
    outcome:{success, status:success === true ? 'SUCCEEDED' : success === false ? 'REVERTED' : 'UNKNOWN',
      gasUsed:observedGas, gasLimit:context.gasLimit,
      error:present(text(transaction.error_message), text(transaction.error), text(simulation.error_message), text(simulation.error))},
    counts:{calls:trace.rows.length, failedCalls:trace.rows.filter(r => r.error !== null).length,
      state:state.length, assets:assets.length, logs:logs.length},
    traceRepresentation:trace.representation,
    availability:{calls:trace.representation !== 'unavailable',
      state:['state_diff','nonce_diff','balance_diff'].some(k => Array.isArray(info[k]) || Array.isArray(transaction[k])),
      assets:['asset_changes','balance_changes'].some(k => Array.isArray(info[k]) || Array.isArray(transaction[k])),
      logs:Array.isArray(info.logs) || Array.isArray(transaction.logs)},
    findings, tables};
}

function compareRows(before, after, identity, project) {
  const keyed = rows => {
    const counts = new Map();
    return new Map(rows.map(row => {
      const key = canonical(identity(row)), occurrence = counts.get(key) ?? 0;
      counts.set(key, occurrence + 1);
      return [key + ':' + occurrence, row];
    }));
  };
  const left = keyed(before), right = keyed(after), result = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key), b = right.get(key);
    if (a && b && canonical(project(a)) === canonical(project(b))) continue;
    result.push({change:!a ? 'ADDED' : !b ? 'REMOVED' : 'CHANGED',
      before:a ?? null, after:b ?? null,
      ...(a && b && own(a, 'gasUsed') ? {gasUsedDelta:delta(a.gasUsed, b.gasUsed)} : {})});
  }
  return result;
}
export function compareSimulations(before, after) {
  requireValue(before?.schema === ANALYSIS_SCHEMA && after?.schema === ANALYSIS_SCHEMA, 'ANALYSIS_REQUIRED');
  const context = [...new Set([...Object.keys(before.context), ...Object.keys(after.context)])].map(field => {
    const a = before.context[field] ?? null, b = after.context[field] ?? null;
    return {field, before:a, after:b, knownBefore:a !== null, knownAfter:b !== null,
      equal:a === null || b === null ? null : a === b};
  });
  const contextComplete = context.every(row => row.knownBefore && row.knownAfter);
  const sameObservedContext = context.some(row => row.equal === false) ? false : contextComplete ? true : null;
  const withoutPointer = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'sourcePointer'));
  const comparable = Object.fromEntries(['calls','state','assets','logs'].map(name =>
    [name,before.availability[name] === true && after.availability[name] === true]));
  const changes = {
    calls:comparable.calls ? compareRows(before.tables.calls, after.tables.calls, r => [r.path,r.type,r.from,r.to,r.input],
      r => pick(r,['method','value','gasLimit','gasUsed','output','error'])) : [],
    state:comparable.state ? compareRows(before.tables.state, after.tables.state, r => [r.kind,r.address,r.slot], r => pick(r,['before','after'])) : [],
    assets:comparable.assets ? compareRows(before.tables.assets, after.tables.assets, r => [r.kind,r.type,r.address,r.from,r.to,r.asset,r.tokenId], withoutPointer) : [],
    logs:comparable.logs ? compareRows(before.tables.logs, after.tables.logs, r => [r.index,r.address,r.topic0], withoutPointer) : [],
  };
  return {schema:'stellar-forge.tenderly-comparison.v1', beforeSimulation:before.simulationId, afterSimulation:after.simulationId,
    context, sameObservedContext, contextComplete,
    requested:{before:before.requested, after:after.requested},
    outcome:{before:before.outcome, after:after.outcome, gasUsedDelta:delta(before.outcome.gasUsed, after.outcome.gasUsed)},
    coverage:{before:before.availability, after:after.availability}, comparable,
    counts:Object.fromEntries(Object.entries(changes).map(([name, rows]) => [name, rows.length])), changes};
}
export const TABLE_COLUMNS = Object.freeze({
  calls:['path','depth','type','from','to','method','value','gasLimit','gasUsed','error','input','output','sourcePointer'],
  state:['kind','address','slot','before','after','sourcePointer'],
  assets:['kind','type','address','from','to','asset','symbol','amount','amountField','decimals','tokenId','sourcePointer'],
  logs:['index','address','event','topic0','topics','data','inputs','sourcePointer'],
});
export function tableCsv(name, rows) {
  requireValue(own(TABLE_COLUMNS, name) && Array.isArray(rows), 'TABLE_NAME_INVALID');
  const cell = value => {
    let result = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@-]/.test(result)) result = "'" + result;
    return '"' + result.replaceAll('"', '""') + '"';
  };
  const columns = TABLE_COLUMNS[name];
  return [columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
