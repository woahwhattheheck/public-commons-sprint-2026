// MIT. Retained recurrence over the original publisher, never a second extractor.
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fault, identity, object, stamp } from './files.mjs';

const opened = new WeakSet();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const codeOf = issue => [issue?.code, issue?.message].find(value =>
  typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value)) ?? 'SCHEDULE_OPERATION_FAILED';
const contract = ({ snapshot, rowCount, ...value }) => identity(value);
const count = (value, minimum, maximum, name) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw fault('SCHEDULE_LIMIT_INVALID', name + ' must be an integer from ' + minimum + ' through ' + maximum + '.');
  return value;
};
const text = (value, maximum, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw fault('SCHEDULE_TEXT_REQUIRED', 'Enter ' + name + '.');
  return value.trim();
};
const only = (value, keys) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault('SCHEDULE_INPUT_INVALID');
};
const decode = row => row ? { ...row, data: JSON.parse(row.data) } : null;
const binding = target => ({ snapshot: target.versions.current, revision: target.versions.revision,
  rows: target.dataset.rowCount, contract: contract(target.dataset) });

/** The original publisher must remain open: its existing kernel lock owns both
 * native work and this policy journal. Read-only commands do not start timers. */
export async function openPostgresSchedule({ publisher } = {}) {
  if (!publisher || typeof publisher.startExtraction !== 'function' || opened.has(publisher))
    throw fault('OPEN_PUBLISHER_REQUIRED');
  opened.add(publisher);
  let db;
  try {
    const path = join(publisher.directory, 'schedule.sqlite');
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077)
        throw fault('PRIVATE_SCHEDULE_REQUIRED');
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    db = new DatabaseSync(path); await chmod(path, 0o600);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;' +
      'CREATE TABLE IF NOT EXISTS policies(id TEXT PRIMARY KEY,created TEXT NOT NULL,data TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS occurrences(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,' +
      'policy TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);');
    db.prepare('INSERT OR IGNORE INTO control(id,data) VALUES(1,?)').run(JSON.stringify({
      revision: 0, policyId: null, enabled: false, nextAt: null, expected: null, pendingId: null, lastId: null,
    }));
    let timer, started = false, closed = false, closing, active = null, controlPromise = null;
    const meta = () => JSON.parse(db.prepare('SELECT data FROM control WHERE id=1').get().data);
    const policy = id => {
      const row = decode(db.prepare('SELECT * FROM policies WHERE id=?').get(id));
      if (!row) throw fault('SCHEDULE_POLICY_REQUIRED', 'Save a publication policy first.', 409);
      return row;
    };
    const occurrence = id => {
      if (typeof id !== 'string' || !UUID.test(id)) throw fault('SCHEDULE_RUN_NOT_FOUND', 'Select a retained refresh.', 404);
      const row = decode(db.prepare('SELECT * FROM occurrences WHERE id=?').get(id));
      if (!row) throw fault('SCHEDULE_RUN_NOT_FOUND', 'Select a retained refresh.', 404);
      return row;
    };
    function transaction(action) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = action(); db.exec('COMMIT'); return result; }
      catch (issue) { db.exec('ROLLBACK'); throw issue; }
    }
    function saveMeta(patch, revise = false) {
      const current = meta(), next = { ...current, ...patch,
        revision: current.revision + (revise ? 1 : 0) };
      db.prepare('UPDATE control SET data=? WHERE id=1').run(JSON.stringify(next)); return next;
    }
    function expected(revision) {
      if (closed) throw fault('SCHEDULE_CLOSED');
      const current = meta();
      if (!Number.isSafeInteger(revision) || revision !== current.revision)
        throw fault('SCHEDULE_REVISION_CHANGED', 'Refresh the publication policy before changing it.', 409);
      return current;
    }
    function control(action) {
      if (closed) return Promise.reject(fault('SCHEDULE_CLOSED'));
      if (controlPromise) return Promise.reject(fault('SCHEDULE_CONTROL_BUSY', 'A policy change is still running.', 409));
      controlPromise = Promise.resolve().then(action).finally(() => { controlPromise = null; wake(); });
      return controlPromise;
    }
    function update(id, state, patch = {}) {
      return transaction(() => {
        const old = occurrence(id), now = stamp();
        const transitions = old.data.transitions ?? [];
        const data = { ...old.data, ...patch,
          transitions: old.state === state ? transitions : [...transitions, { at: now, state }] };
        db.prepare('UPDATE occurrences SET state=?,updated=?,data=? WHERE id=?')
          .run(state, now, JSON.stringify(data), id);
        return occurrence(id);
      });
    }
    function status({ limit = 25, offset = 0 } = {}) {
      if (closed && !closing) throw fault('SCHEDULE_CLOSED');
      count(limit, 1, 100, 'Page size'); count(offset, 0, Number.MAX_SAFE_INTEGER, 'History offset');
      const current = meta(), total = db.prepare('SELECT COUNT(*) AS total FROM occurrences').get().total;
      return { schema: 'stellar-forge.postgres-publication-schedule.v1', ...current,
        policy: current.policyId ? policy(current.policyId) : null,
        running: started && !closed, active: active ? occurrence(active.id) : null,
        pending: current.pendingId ? occurrence(current.pendingId) : null,
        last: current.lastId ? occurrence(current.lastId) : null,
        history: db.prepare('SELECT * FROM occurrences ORDER BY seq DESC LIMIT ? OFFSET ?').all(limit, offset).map(decode),
        page: { limit, offset, total, previous: offset > 0 ? Math.max(0, offset - limit) : null,
          next: offset + limit < total ? offset + limit : null } };
    }
    function sameTarget(observed, wanted) {
      if (!observed.connected) throw fault('SCHEDULE_TARGET_OFFLINE', 'Start the original dataset seller before this refresh.', 409);
      if (!wanted || observed.versions.current !== wanted.snapshot || observed.versions.revision !== wanted.revision)
        throw fault('SCHEDULE_TARGET_CHANGED', 'The dataset changed outside this schedule. Review its current version before enabling again.', 409);
      if (contract(observed.dataset) !== wanted.contract)
        throw fault('SCHEDULE_CONTRACT_CHANGED', 'The target no longer has the configured dataset contract.', 409);
    }
    async function configure(input) {
      return control(async () => {
        only(input, ['revision', 'referenceRun', 'planDigest', 'expectedSnapshot', 'expectedRevision',
          'intervalSeconds', 'minimumRows', 'maximumRows', 'maximumDropPercent', 'onError', 'reviewer', 'note']);
        const current = expected(input.revision);
        if (active || current.pendingId || publisher.status().active)
          throw fault('SCHEDULE_REFRESH_ACTIVE', 'Finish the current refresh before replacing its policy.', 409);
        const run = publisher.run(input.referenceRun), plan = publisher.plan(run.plan);
        if (run.state !== 'PUBLISHED' || input.planDigest !== plan.data.digest)
          throw fault('SCHEDULE_PUBLISHED_BASELINE_REQUIRED', 'Choose a published extraction and its exact saved plan.', 409);
        const candidate = await publisher.candidate(run.id), target = await publisher.target();
        if (!target.connected || input.expectedSnapshot !== target.versions.current ||
            input.expectedRevision !== target.versions.revision || target.versions.current !== candidate.manifest.dataset.snapshot)
          throw fault('SCHEDULE_BASELINE_CHANGED', 'Choose the published extraction that is current in the running dataset.', 409);
        const maximumRows = count(input.maximumRows, 1, plan.data.extraction.maxRows, 'Maximum published rows');
        const minimumRows = count(input.minimumRows, 0, maximumRows, 'Minimum published rows');
        const maximumDropPercent = input.maximumDropPercent === null ? null :
          count(input.maximumDropPercent, 0, 100, 'Maximum row decrease percent');
        if (target.dataset.rowCount < minimumRows || target.dataset.rowCount > maximumRows)
          throw fault('SCHEDULE_BASELINE_OUTSIDE_LIMITS', 'The reviewed baseline must fit the publication row limits.');
        if (!['pause', 'next-interval'].includes(input.onError)) throw fault('SCHEDULE_ERROR_POLICY_REQUIRED');
        const value = { schema: 'stellar-forge.postgres-publication-policy.v1',
          plan: run.plan, planDigest: plan.data.digest, referenceRun: run.id,
          referenceCandidate: candidate.manifest.candidateDigest, contract: contract(candidate.manifest.dataset),
          intervalSeconds: count(input.intervalSeconds, 30, 2592000, 'Refresh interval seconds'),
          minimumRows, maximumRows, maximumDropPercent, onError: input.onError,
          reviewer: text(input.reviewer, 80, 'the responsible operator name'),
          note: text(input.note, 1200, 'the publication policy note') };
        value.digest = identity(value);
        expected(input.revision);
        const id = randomUUID();
        transaction(() => {
          db.prepare('INSERT INTO policies(id,created,data) VALUES(?,?,?)').run(id, stamp(), JSON.stringify(value));
          saveMeta({ policyId: id, enabled: false, nextAt: null, expected: binding(target) }, true);
        });
        return status();
      });
    }
    async function enable(input) {
      return control(async () => {
        only(input, ['revision', 'expectedSnapshot', 'expectedRevision']);
        const current = expected(input.revision), selected = policy(current.policyId);
        if (active || current.pendingId) throw fault('SCHEDULE_REFRESH_ACTIVE', 'Continue the retained refresh first.', 409);
        const target = await publisher.target();
        if (!target.connected || target.versions.current !== input.expectedSnapshot ||
            target.versions.revision !== input.expectedRevision)
          throw fault('SCHEDULE_BASELINE_CHANGED', 'Refresh the displayed target before enabling the schedule.', 409);
        if (contract(target.dataset) !== selected.data.contract)
          throw fault('SCHEDULE_CONTRACT_CHANGED', 'This policy does not match the current dataset contract.', 409);
        if (target.dataset.rowCount < selected.data.minimumRows || target.dataset.rowCount > selected.data.maximumRows)
          throw fault('SCHEDULE_BASELINE_OUTSIDE_LIMITS');
        expected(input.revision);
        transaction(() => saveMeta({ enabled: true, nextAt: Date.now() + selected.data.intervalSeconds * 1000,
          expected: binding(target) }, true));
        return status();
      });
    }
    function pause(input) {
      return control(() => {
        only(input, ['revision']); expected(input.revision);
        transaction(() => saveMeta({ enabled: false, nextAt: null }, true));
        return status();
      });
    }
    function finish(id, state, { result = null, error = null, target = null, pending = false } = {}) {
      const row = occurrence(id), selected = policy(row.policy).data;
      update(id, state, { result, error, completedAt: pending ? null : stamp() });
      transaction(() => {
        const current = meta();
        const conflict = ['SCHEDULE_TARGET_CHANGED', 'SCHEDULE_CONTRACT_CHANGED'].includes(error);
        const paused = pending || conflict || error && selected.onError === 'pause';
        const enabled = current.enabled && !paused;
        const interval = selected.intervalSeconds * 1000, now = Date.now();
        // Collapse missed slots into one current refresh; never replay a backlog.
        const due = row.data.dueAt;
        const nextAt = enabled ? due + (Math.max(0, Math.floor((now - due) / interval)) + 1) * interval : null;
        saveMeta({ pendingId: pending ? id : null, lastId: id, enabled, nextAt,
          ...(target ? { expected: target } : {}) }, current.enabled && paused);
      });
      return occurrence(id);
    }
    async function perform(id, allowPublicationRetry) {
      const row = occurrence(id), selected = policy(row.policy).data;
      let original;
      try { original = publisher.run(row.data.runId); }
      catch (issue) { if (issue.code !== 'RUN_NOT_FOUND') throw issue; }
      if (!original) {
        if (!['RESERVED', 'WAITING'].includes(row.state)) throw fault('SCHEDULE_NATIVE_RUN_MISSING');
        if (closed) return update(id, 'WAITING', { error: 'SCHEDULE_PROCESS_STOPPED' });
        sameTarget(await publisher.target(), meta().expected);
        if (publisher.status().active) return update(id, 'WAITING');
        const run = publisher.startExtraction(selected.plan, { id: row.data.runId });
        update(id, 'EXTRACTING');
        original = await run.completion;
      }
      if (['INTERRUPTED', 'FAILED', 'CANCELLED'].includes(original.state)) {
        // Only a complete original committed manifest can recover this run.
        try { original = await publisher.recover(original.id); }
        catch (issue) {
          return finish(id, original.state, { error: original.data.error ?? codeOf(issue),
            result: { runId: original.id, nativeState: original.state } });
        }
      }
      if (original.state === 'PUBLICATION_UNKNOWN') {
        original = await publisher.recover(original.id);
        if (original.state !== 'PUBLISHED' && !allowPublicationRetry)
          return finish(id, 'PUBLICATION_UNKNOWN', { pending: true, error: 'PUBLICATION_OUTCOME_NOT_RECORDED',
            result: { runId: original.id, nativeState: original.state } });
      }
      const candidate = await publisher.candidate(original.id), manifest = candidate.manifest;
      if (publisher.plan(original.plan).data.digest !== selected.planDigest ||
          manifest.planDigest !== selected.planDigest || contract(manifest.dataset) !== selected.contract)
        throw fault('SCHEDULE_CANDIDATE_CHANGED');
      if (original.state === 'PUBLISHED') {
        const publication = original.data.publication;
        return finish(id, 'PUBLISHED', { target: { snapshot: publication.snapshot, revision: publication.revision,
          rows: manifest.dataset.rowCount, contract: selected.contract },
          result: { runId: original.id, candidateDigest: manifest.candidateDigest, publication } });
      }
      const target = await publisher.target(), expectedTarget = meta().expected;
      sameTarget(target, expectedTarget);
      const rows = manifest.dataset.rowCount;
      if (rows < selected.minimumRows || rows > selected.maximumRows ||
          selected.maximumDropPercent !== null &&
          (expectedTarget.rows - rows) * 100 > expectedTarget.rows * selected.maximumDropPercent)
        throw fault('SCHEDULE_ROW_POLICY_REFUSED', 'The candidate is retained for inspection; it falls outside the configured publication row limits.', 409);
      if (manifest.dataset.snapshot === target.versions.current)
        return finish(id, 'UNCHANGED', { target: binding(target),
          result: { runId: original.id, candidateDigest: manifest.candidateDigest, snapshot: manifest.dataset.snapshot, rows } });
      if (closed) return update(id, 'WAITING', { error: 'SCHEDULE_PROCESS_STOPPED' });
      update(id, 'REVIEWING', { candidateDigest: manifest.candidateDigest });
      const reviewed = await publisher.review(original.id, {
        reviewer: 'Schedule: ' + selected.reviewer,
        note: 'Automatic publication under saved policy ' + row.policy + ' (' + selected.digest + '). ' +
          'Plan ' + selected.plan + '; rows ' + rows + ' within ' + selected.minimumRows + '–' + selected.maximumRows +
          '; maximum decrease ' + (selected.maximumDropPercent === null ? 'not configured' : selected.maximumDropPercent + '%') +
          '. Operator policy: ' + selected.note,
        expectedSnapshot: target.versions.current, expectedRevision: target.versions.revision,
      });
      if (closed) return update(id, 'WAITING', { error: 'SCHEDULE_PROCESS_STOPPED' });
      update(id, 'PUBLISHING', { reviewId: reviewed.data.review.id });
      const published = await publisher.publish(original.id, reviewed.data.review.id);
      if (published.state === 'PUBLISHED') {
        const publication = published.data.publication;
        return finish(id, 'PUBLISHED', { target: { snapshot: publication.snapshot, revision: publication.revision,
          rows, contract: selected.contract },
          result: { runId: original.id, candidateDigest: manifest.candidateDigest, publication } });
      }
      return finish(id, published.state === 'PUBLICATION_UNKNOWN' ? 'PUBLICATION_UNKNOWN' : 'REFUSED', {
        error: published.data.error ?? 'SCHEDULE_PUBLICATION_REFUSED', pending: published.state === 'PUBLICATION_UNKNOWN',
        result: { runId: original.id, nativeState: published.state } });
    }
    function drive(id, allowPublicationRetry = false) {
      if (active) return active.promise;
      const operation = { id, promise: null }; active = operation;
      operation.promise = Promise.resolve().then(() => perform(id, allowPublicationRetry)).catch(issue => {
        if (issue.code === 'PUBLISHER_BUSY') return update(id, 'WAITING');
        const runId = occurrence(id).data.runId;
        let original;
        try { original = publisher.run(runId); } catch {}
        // A failed candidate/target inspection cannot resolve an earlier
        // uncertain publication. Preserve its original pending identity.
        const pending = original?.state === 'PUBLICATION_UNKNOWN';
        return finish(id, pending ? 'PUBLICATION_UNKNOWN' : 'FAILED', { pending, error: codeOf(issue),
          result: { runId, ...(original ? { nativeState: original.state } : {}) } });
      }).finally(() => { if (active === operation) active = null; wake(); });
      return operation.promise;
    }
    function reserve(trigger, dueAt, id = randomUUID()) {
      if (!UUID.test(id)) throw fault('SCHEDULE_REQUEST_ID_INVALID');
      const current = meta();
      policy(current.policyId);
      if (current.pendingId) throw fault('SCHEDULE_REFRESH_ACTIVE', 'Continue the retained refresh before starting another.', 409);
      transaction(() => {
        const now = stamp();
        db.prepare('INSERT INTO occurrences(id,policy,created,updated,state,data) VALUES(?,?,?,?,?,?)')
          .run(id, current.policyId, now, now, 'RESERVED', JSON.stringify({
            trigger, dueAt, runId: id, transitions: [{ at: now, state: 'RESERVED' }],
          }));
        saveMeta({ pendingId: id });
      });
      return id;
    }
    function runNow(input) {
      only(input, ['revision', 'requestId']);
      const current = expected(input.revision);
      if (controlPromise) throw fault('SCHEDULE_CONTROL_BUSY');
      if (input.requestId && db.prepare('SELECT id FROM occurrences WHERE id=?').get(input.requestId)) {
        const prior = occurrence(input.requestId);
        if (prior.policy !== current.policyId) throw fault('SCHEDULE_REQUEST_POLICY_CHANGED', 'This request belongs to an earlier saved policy.', 409);
        return { id: prior.id, completion: current.pendingId === prior.id ? drive(prior.id) : Promise.resolve(prior) };
      }
      const id = reserve('operator', current.nextAt && current.nextAt < Date.now() ? current.nextAt : Date.now(), input.requestId);
      return { id, completion: drive(id) };
    }
    function continueRun(input) {
      only(input, ['revision']);
      const current = expected(input.revision);
      if (controlPromise) throw fault('SCHEDULE_CONTROL_BUSY');
      if (!current.pendingId) throw fault('SCHEDULE_NO_PENDING_REFRESH', 'There is no retained unfinished refresh.', 409);
      return { id: current.pendingId, completion: drive(current.pendingId, true) };
    }
    function wake() {
      clearTimeout(timer);
      if (closed || !started || active || controlPromise) return;
      const current = meta();
      if (!current.enabled || !current.policyId) return;
      const delay = current.pendingId ? 1000 : Math.max(0, Math.min(2147483647, current.nextAt - Date.now()));
      timer = setTimeout(() => {
        if (closed || active || controlPromise) return wake();
        const latest = meta();
        if (!latest.enabled) return;
        if (publisher.status().active) { timer = setTimeout(wake, 1000); return; }
        if (!latest.pendingId && latest.nextAt > Date.now()) return wake();
        const id = latest.pendingId ?? reserve('interval', latest.nextAt);
        drive(id);
      }, delay);
    }
    function start() {
      if (closed) throw fault('SCHEDULE_CLOSED');
      started = true; wake(); return status();
    }
    function close() {
      if (closing) return closing;
      closed = true; started = false; clearTimeout(timer);
      const owned = active && occurrence(active.id);
      if (owned && publisher.status().active?.kind === 'extraction' &&
          publisher.status().active.id === owned.data.runId) publisher.cancel(owned.data.runId);
      closing = (async () => {
        try { await Promise.allSettled([active?.promise, controlPromise].filter(Boolean)); }
        finally { db.close(); opened.delete(publisher); }
      })();
      return closing;
    }
    return Object.freeze({ status, configure, enable, pause, runNow, continueRun, start, close });
  } catch (issue) { db?.close(); opened.delete(publisher); throw issue; }
}
