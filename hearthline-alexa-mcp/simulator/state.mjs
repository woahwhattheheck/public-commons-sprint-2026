const ID_RE = /^[A-Za-z0-9._:-]{4,80}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const AUTHORITIES = new Set(['ROUTINE', 'IRREVERSIBLE']);
const STATUSES = new Set([
  'READY',
  'DECISION_REQUIRED',
  'APPROVED',
  'DENIED',
  'EXECUTED',
  'RECONCILIATION_REQUIRED',
]);
const COMMAND_KEYS = {
  approve: ['id', 'type'],
  deny: ['id', 'reason', 'type'],
  execute: ['id', 'outcome', 'type'],
  reconcile: ['finding', 'id', 'type'],
  evidence: ['evidence', 'id', 'type'],
};

function fail(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value, allowed, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exactly: ${expected.join(', ')}`);
  }
}

function boundedText(value, label, max = 240, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max) fail(`${label} is invalid`);
  return text;
}

function safeNow(clock) {
  const raw = typeof clock === 'function' ? clock() : new Date().toISOString();
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) {
    fail('clock must return a UTC ISO-8601 string');
  }
  if (!Number.isFinite(Date.parse(raw))) fail('clock returned an invalid timestamp');
  return raw;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function validateEvidence(value) {
  exactKeys(value, ['capturedAt', 'digest', 'id', 'note'], 'evidence');
  const id = boundedText(value.id, 'evidence.id', 80);
  if (!ID_RE.test(id)) fail('evidence.id is invalid');
  if (typeof value.digest !== 'string' || !DIGEST_RE.test(value.digest)) {
    fail('evidence.digest must be 64 lowercase hex characters');
  }
  const note = boundedText(value.note, 'evidence.note', 300);
  const capturedAt = boundedText(value.capturedAt, 'evidence.capturedAt', 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) {
    fail('evidence.capturedAt must be UTC ISO-8601');
  }
  return { id, digest: value.digest, note, capturedAt };
}

function appendTranscript(operation, entry) {
  return {
    ...operation,
    transcript: [
      ...operation.transcript,
      {
        seq: operation.transcript.length + 1,
        ...entry,
      },
    ],
  };
}

function commandFingerprint(command) {
  return canonicalJson(command);
}

function replayState(operation, command) {
  const existing = operation.commands.find((row) => row.id === command.id);
  if (!existing) return null;
  if (existing.fingerprint !== commandFingerprint(command)) {
    throw new Error(`command id ${command.id} was already used for different input`);
  }
  return { operation: clone(operation), replayed: true };
}

function rememberCommand(operation, command) {
  return {
    ...operation,
    commands: [
      ...operation.commands,
      { id: command.id, fingerprint: commandFingerprint(command) },
    ],
  };
}

function validateCommand(command) {
  if (!isPlainObject(command)) fail('command must be a plain object');
  const type = boundedText(command.type, 'command.type', 24);
  const keys = COMMAND_KEYS[type];
  if (!keys) fail('unsupported command type');
  exactKeys(command, keys, `command.${type}`);
  const id = boundedText(command.id, 'command.id', 80);
  if (!ID_RE.test(id)) fail('command.id is invalid');

  if (type === 'deny') boundedText(command.reason, 'command.reason', 300);
  if (type === 'execute' && !['success', 'unknown'].includes(command.outcome)) {
    fail('command.execute.outcome must be success or unknown');
  }
  if (type === 'reconcile' && !['executed', 'not_executed'].includes(command.finding)) {
    fail('command.reconcile.finding must be executed or not_executed');
  }
  if (type === 'evidence') validateEvidence(command.evidence);
  return clone(command);
}

export function createOperation(input, { clock } = {}) {
  exactKeys(input, ['authority', 'evidence', 'id', 'summary', 'title'], 'operation');
  const id = boundedText(input.id, 'operation.id', 80);
  if (!ID_RE.test(id)) fail('operation.id is invalid');
  const title = boundedText(input.title, 'operation.title', 120);
  const summary = boundedText(input.summary, 'operation.summary', 500);
  if (!AUTHORITIES.has(input.authority)) fail('operation.authority is invalid');
  if (!Array.isArray(input.evidence) || input.evidence.length > 20) fail('operation.evidence must be an array of at most 20 entries');
  const evidence = input.evidence.map(validateEvidence);
  const evidenceIds = new Set();
  for (const item of evidence) {
    if (evidenceIds.has(item.id)) fail('operation.evidence ids must be unique');
    evidenceIds.add(item.id);
  }
  const at = safeNow(clock);
  const status = input.authority === 'IRREVERSIBLE' ? 'DECISION_REQUIRED' : 'READY';
  return {
    schema: 'hearthline/decision-operation/v1',
    id,
    title,
    summary,
    authority: input.authority,
    status,
    attemptGeneration: 1,
    evidence,
    commands: [],
    transcript: [
      {
        seq: 1,
        at,
        type: 'OPERATION_CREATED',
        detail: status,
      },
    ],
  };
}

export function dispatch(operation, rawCommand, { clock } = {}) {
  const command = validateCommand(rawCommand);
  const replay = replayState(operation, command);
  if (replay) return replay;
  const at = safeNow(clock);
  let next = clone(operation);

  if (!STATUSES.has(next.status)) throw new Error('operation has an invalid status');
  if (!Array.isArray(next.commands) || !Array.isArray(next.transcript)) throw new Error('operation history is malformed');

  switch (command.type) {
    case 'approve': {
      if (next.authority !== 'IRREVERSIBLE' || next.status !== 'DECISION_REQUIRED') {
        throw new Error('approval is only valid for an irreversible decision request');
      }
      next.status = 'APPROVED';
      next = appendTranscript(next, { at, type: 'APPROVED', commandId: command.id, detail: 'explicit human approval' });
      break;
    }
    case 'deny': {
      if (next.authority !== 'IRREVERSIBLE' || next.status !== 'DECISION_REQUIRED') {
        throw new Error('denial is only valid for an irreversible decision request');
      }
      next.status = 'DENIED';
      next = appendTranscript(next, { at, type: 'DENIED', commandId: command.id, detail: command.reason.trim() });
      break;
    }
    case 'execute': {
      if (next.status === 'RECONCILIATION_REQUIRED') {
        throw new Error('execution is blocked until the unknown outcome is reconciled');
      }
      const allowed = next.authority === 'ROUTINE' ? next.status === 'READY' : next.status === 'APPROVED';
      if (!allowed) throw new Error('operation is not authorized to execute');
      if (command.outcome === 'success') {
        next.status = 'EXECUTED';
        next = appendTranscript(next, {
          at,
          type: 'EXECUTED',
          commandId: command.id,
          detail: `attempt ${next.attemptGeneration} confirmed successful`,
        });
      } else {
        next.status = 'RECONCILIATION_REQUIRED';
        next = appendTranscript(next, {
          at,
          type: 'UNKNOWN_OUTCOME',
          commandId: command.id,
          detail: `attempt ${next.attemptGeneration} outcome unknown; retry fenced`,
        });
      }
      break;
    }
    case 'reconcile': {
      if (next.status !== 'RECONCILIATION_REQUIRED') {
        throw new Error('reconciliation requires an unknown prior outcome');
      }
      if (command.finding === 'executed') {
        next.status = 'EXECUTED';
        next = appendTranscript(next, {
          at,
          type: 'RECONCILED_EXECUTED',
          commandId: command.id,
          detail: `attempt ${next.attemptGeneration} confirmed executed`,
        });
      } else {
        next.attemptGeneration += 1;
        next.status = next.authority === 'IRREVERSIBLE' ? 'APPROVED' : 'READY';
        next = appendTranscript(next, {
          at,
          type: 'RECONCILED_NOT_EXECUTED',
          commandId: command.id,
          detail: `retry authorized as attempt ${next.attemptGeneration}`,
        });
      }
      break;
    }
    case 'evidence': {
      if (['EXECUTED', 'DENIED'].includes(next.status)) throw new Error('terminal operation evidence is immutable');
      const evidence = validateEvidence(command.evidence);
      if (next.evidence.some((item) => item.id === evidence.id)) throw new Error('evidence id already exists');
      next.evidence.push(evidence);
      next = appendTranscript(next, { at, type: 'EVIDENCE_RECORDED', commandId: command.id, detail: evidence.id });
      break;
    }
    default:
      throw new Error('unsupported command');
  }

  next = rememberCommand(next, command);
  return { operation: next, replayed: false };
}

export function exportOperation(operation) {
  if (!isPlainObject(operation) || operation.schema !== 'hearthline/decision-operation/v1') {
    fail('operation export requires a v1 decision operation');
  }
  return canonicalJson(operation);
}

export function commandForKey(event) {
  if (!event || event.altKey !== true || event.ctrlKey || event.metaKey) return null;
  const key = String(event.key || '').toLowerCase();
  return ({ a: 'approve', d: 'deny', e: 'execute', r: 'reconcile' })[key] || null;
}
