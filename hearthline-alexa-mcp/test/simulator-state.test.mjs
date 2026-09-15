import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalJson,
  commandForKey,
  createOperation,
  dispatch,
  exportOperation,
} from '../simulator/state.mjs';

const BASE_TIME = '2026-09-13T10:45:00Z';
const evidence = {
  id: 'fixture-proof',
  digest: 'a'.repeat(64),
  note: 'Synthetic fixture evidence.',
  capturedAt: BASE_TIME,
};

function make(authority = 'IRREVERSIBLE') {
  return createOperation({
    id: `op-${authority.toLowerCase()}`,
    title: 'Fixture operation',
    summary: 'Tests the local decision authority state machine.',
    authority,
    evidence: [evidence],
  }, { clock: () => BASE_TIME });
}

function apply(operation, command, at = '2026-09-13T10:46:00Z') {
  return dispatch(operation, command, { clock: () => at });
}

test('irreversible operation begins at an explicit decision fence', () => {
  const op = make();
  assert.equal(op.status, 'DECISION_REQUIRED');
  assert.equal(op.authority, 'IRREVERSIBLE');
});

test('routine operation executes without approval', () => {
  const op = make('ROUTINE');
  const { operation } = apply(op, { id: 'cmd-execute-1', type: 'execute', outcome: 'success' });
  assert.equal(operation.status, 'EXECUTED');
});

test('irreversible execution before approval fails closed without mutation', () => {
  const op = make();
  const before = exportOperation(op);
  assert.throws(() => apply(op, { id: 'cmd-execute-1', type: 'execute', outcome: 'success' }), /not authorized/);
  assert.equal(exportOperation(op), before);
});

test('approval enables one irreversible execution path', () => {
  const op = make();
  const approved = apply(op, { id: 'cmd-approve-1', type: 'approve' }).operation;
  assert.equal(approved.status, 'APPROVED');
  const executed = apply(approved, { id: 'cmd-execute-1', type: 'execute', outcome: 'success' }).operation;
  assert.equal(executed.status, 'EXECUTED');
  assert.equal(executed.transcript.at(-1).type, 'EXECUTED');
});

test('denial is terminal and execution stays blocked', () => {
  const denied = apply(make(), { id: 'cmd-deny-0001', type: 'deny', reason: 'No external commitment.' }).operation;
  assert.equal(denied.status, 'DENIED');
  assert.throws(() => apply(denied, { id: 'cmd-execute-1', type: 'execute', outcome: 'success' }), /not authorized/);
});

test('exact command replay is idempotent and does not duplicate transcript', () => {
  const op = make();
  const command = { id: 'cmd-approve-1', type: 'approve' };
  const first = apply(op, command).operation;
  const replay = apply(first, command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.operation.transcript.length, first.transcript.length);
  assert.equal(exportOperation(replay.operation), exportOperation(first));
});

test('conflicting reuse of a command id fails closed', () => {
  const approved = apply(make(), { id: 'cmd-shared-01', type: 'approve' }).operation;
  const before = exportOperation(approved);
  assert.throws(
    () => apply(approved, { id: 'cmd-shared-01', type: 'execute', outcome: 'success' }),
    /already used for different input/,
  );
  assert.equal(exportOperation(approved), before);
});

test('unknown execution outcome fences retries until reconciliation', () => {
  const approved = apply(make(), { id: 'cmd-approve-1', type: 'approve' }).operation;
  const unknown = apply(approved, { id: 'cmd-execute-1', type: 'execute', outcome: 'unknown' }).operation;
  assert.equal(unknown.status, 'RECONCILIATION_REQUIRED');
  assert.equal(unknown.transcript.at(-1).type, 'UNKNOWN_OUTCOME');
  assert.throws(() => apply(unknown, { id: 'cmd-execute-2', type: 'execute', outcome: 'success' }), /reconciled/);
});

test('reconciliation can prove the unknown attempt executed', () => {
  const approved = apply(make(), { id: 'cmd-approve-1', type: 'approve' }).operation;
  const unknown = apply(approved, { id: 'cmd-execute-1', type: 'execute', outcome: 'unknown' }).operation;
  const reconciled = apply(unknown, { id: 'cmd-reconcile-1', type: 'reconcile', finding: 'executed' }).operation;
  assert.equal(reconciled.status, 'EXECUTED');
  assert.equal(reconciled.attemptGeneration, 1);
});

test('not-executed reconciliation advances generation before retry', () => {
  const approved = apply(make(), { id: 'cmd-approve-1', type: 'approve' }).operation;
  const unknown = apply(approved, { id: 'cmd-execute-1', type: 'execute', outcome: 'unknown' }).operation;
  const reconciled = apply(unknown, { id: 'cmd-reconcile-1', type: 'reconcile', finding: 'not_executed' }).operation;
  assert.equal(reconciled.status, 'APPROVED');
  assert.equal(reconciled.attemptGeneration, 2);
  const retried = apply(reconciled, { id: 'cmd-execute-2', type: 'execute', outcome: 'success' }).operation;
  assert.equal(retried.status, 'EXECUTED');
  assert.match(retried.transcript.at(-1).detail, /attempt 2/);
});

test('evidence is digest-bound and terminal evidence cannot mutate', () => {
  const op = make('ROUTINE');
  assert.throws(
    () => apply(op, { id: 'cmd-evidence-1', type: 'evidence', evidence: { ...evidence, id: 'extra-proof', digest: 'not-a-digest' } }),
    /64 lowercase hex/,
  );
  const executed = apply(op, { id: 'cmd-execute-1', type: 'execute', outcome: 'success' }).operation;
  assert.throws(
    () => apply(executed, { id: 'cmd-evidence-1', type: 'evidence', evidence: { ...evidence, id: 'extra-proof' } }),
    /immutable/,
  );
});

test('unknown command fields are rejected instead of silently discarded', () => {
  assert.throws(
    () => apply(make(), { id: 'cmd-approve-1', type: 'approve', approved: true }),
    /keys must be exactly/,
  );
});

test('deterministic export is stable and recursively sorts object keys', () => {
  const a = canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: [{ y: 2, x: 1 }] });
  const b = canonicalJson({ a: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 });
  assert.equal(a, b);
  assert.equal(exportOperation(make()), exportOperation(make()));
});

test('keyboard shortcuts require Alt and reject ctrl/meta chords', () => {
  assert.equal(commandForKey({ altKey: true, ctrlKey: false, metaKey: false, key: 'A' }), 'approve');
  assert.equal(commandForKey({ altKey: true, ctrlKey: false, metaKey: false, key: 'd' }), 'deny');
  assert.equal(commandForKey({ altKey: true, ctrlKey: false, metaKey: false, key: 'E' }), 'execute');
  assert.equal(commandForKey({ altKey: true, ctrlKey: false, metaKey: false, key: 'r' }), 'reconcile');
  assert.equal(commandForKey({ altKey: true, ctrlKey: true, metaKey: false, key: 'a' }), null);
  assert.equal(commandForKey({ altKey: false, ctrlKey: false, metaKey: false, key: 'a' }), null);
});

test('clock and evidence timestamps must be explicit UTC strings', () => {
  assert.throws(() => createOperation({
    id: 'op-clock-bad', title: 'Bad clock', summary: 'Bad clock fixture.', authority: 'ROUTINE', evidence: [],
  }, { clock: () => '2026-09-13 10:45:00' }), /UTC ISO-8601/);

  assert.throws(() => createOperation({
    id: 'op-evidence-bad', title: 'Bad evidence', summary: 'Bad timestamp fixture.', authority: 'ROUTINE',
    evidence: [{ ...evidence, capturedAt: '2026-09-13T10:45:00-04:00' }],
  }, { clock: () => BASE_TIME }), /UTC ISO-8601/);
});
