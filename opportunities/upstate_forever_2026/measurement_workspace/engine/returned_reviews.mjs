/**
 * Three-way incorporation of returned Measurements reviews.
 *
 * Inputs are complete native large-file archives. Every input is received through
 * the original receiver; edits use only MeasurementWorkspace.review/mapping.
 * The live sender and returned reviewer project are never mutated. The result is
 * a new complete editable workspace based on the selected current edition.
 */
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {MeasurementWorkspace} from './workspace.mjs';
import {receiveArchive, exportEdition, editionMemberFile} from './large_delivery.mjs';
import {hash, stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
import {atomicJSON, copyVerified, fileDigest, writeAll, withDirectoryLock} from './large_io.mjs';
import {writeReturnedReviewReports} from './returned_review_reports.mjs';

export const RETURN_FORMAT = 'upper-savannah-returned-reviews/v1';
export const DECISION_FORMAT = 'upper-savannah-returned-review-decisions/v1';
const ROLES = ['baseline', 'returned', 'current'];
const READ_JSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const same = (a, b) => stable(a) === stable(b);
const stamp = value => hash(stable(value));
const nonempty = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new InputError(label + ' is required');
  return value.trim();
};
const exists = (db, table, key, value) => Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${key}=?`).get(value));

function ordinaryDirectory(directory) {
  let cursor = path.resolve(directory);
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new InputError('Choose an ordinary directory, not a symbolic-link path');
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path.resolve(directory);
}

export function* readJSONLines(file) {
  const fd = fs.openSync(file, 'r');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const buffer = Buffer.alloc(256 * 1024);
  let pending = '';
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      pending += decoder.decode(buffer.subarray(0, count), {stream: true});
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line) yield JSON.parse(line);
      }
    }
    pending += decoder.decode();
    if (pending) yield JSON.parse(pending);
  } finally { fs.closeSync(fd); }
}

function reviewState(value) {
  const data = value ? (typeof value === 'string' ? JSON.parse(value) : value) : {};
  return {state: data.state || 'pending', reviewer: data.reviewer || '', reason: data.reason || ''};
}

function mappingState(value) {
  if (!value) return null;
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  return {
    stationId: data.stationId, reachId: data.reachId || '',
    reviewer: data.reviewer || '', reason: data.reason || '',
    domainSourceReference: data.domainSourceReference || null,
    coordinateInterpretation: data.coordinateInterpretation || 'Explicit analyst assignment'
  };
}

function groupStatements(db, prefix = '') {
  return {
    rows: db.prepare(`SELECT r.id,r.data,rv.data AS review_data FROM ${prefix}records r
      LEFT JOIN ${prefix}reviews rv ON rv.record_id=r.id
      WHERE r.logical_key=? ORDER BY r.id`),
    selection: db.prepare(`SELECT record_id FROM ${prefix}selected_versions WHERE logical_key=?`)
  };
}

function groupState(statements, key) {
  const rows = [];
  for (const item of statements.rows.iterate(key)) {
    const raw = JSON.parse(item.data);
    rows.push({
      id: item.id, sourceFingerprint: stamp(raw),
      stationId: raw.stationId, parameter: raw.parameter, sampledDate: raw.sampledDate,
      value: raw.value, unit: raw.unit, censor: raw.censor,
      review: reviewState(item.review_data)
    });
  }
  return {records: rows, selectedId: statements.selection.get(key)?.record_id || null};
}

function classify(base, returned, current, blockers) {
  if (same(base, returned)) return 'unchanged';
  if (same(current, returned)) return 'already-current';
  if (blockers.length) return 'source-needed';
  return same(base, current) ? 'apply-return' : 'conflict';
}

function desiredGroup(base, returned, current) {
  const blockers = [];
  let conflicting = false;
  const b = new Map(base.records.map(row => [row.id, row]));
  const r = new Map(returned.records.map(row => [row.id, row]));
  const c = new Map(current.records.map(row => [row.id, row]));
  const changedReviews = new Map();
  for (const row of base.records) {
    if (!r.has(row.id)) blockers.push('Returned edition omits baseline measurement ' + row.id);
  }
  for (const row of returned.records) {
    const original = c.get(row.id), baseline = b.get(row.id);
    if (!original) blockers.push('Current edition needs original-source intake for measurement ' + row.id);
    else if (original.sourceFingerprint !== row.sourceFingerprint) {
      blockers.push('Measurement source differs for retained identity ' + row.id);
    }
    if (baseline && baseline.sourceFingerprint !== row.sourceFingerprint) {
      blockers.push('Returned interpretation differs for baseline identity ' + row.id);
    }
    // Incorporate the returned DELTA, not a replacement of the current group.
    // Independent review of another retained source version stays current.
    if (!same(baseline?.review || reviewState(null), row.review)) {
      changedReviews.set(row.id, row.review);
      if (!row.review.reviewer.trim() || !row.review.reason.trim()) {
        blockers.push('Returned review lacks a native reviewer or rationale for ' + row.id);
      }
      if (original && !same(original.review, baseline?.review || reviewState(null)) &&
          !same(original.review, row.review)) conflicting = true;
    }
  }
  let selectedId = current.selectedId;
  if (returned.selectedId !== base.selectedId) {
    if (current.selectedId !== base.selectedId && current.selectedId !== returned.selectedId) conflicting = true;
    selectedId = returned.selectedId;
    const selected = selectedId && r.get(selectedId);
    if (selectedId && (!selected || selected.review.state !== 'include' || !c.has(selectedId))) {
      blockers.push('Returned selected source version is not an included current original');
    }
  }
  const desired = {
    records: current.records.map(row => changedReviews.has(row.id) ? {...row, review: changedReviews.get(row.id)} : row),
    selectedId
  };
  // The original native review API clears a source selection when its selected
  // observation becomes pending/excluded. Preserve that same native consequence.
  if (desired.selectedId && desired.records.find(row => row.id === desired.selectedId)?.review.state !== 'include') {
    conflicting = true;
    desired.selectedId = null;
  }
  return {desired, blockers, conflicting};
}

function sourceInventory(db) {
  const inventory = {};
  for (const role of ROLES) {
    inventory[role] = {
      recordCount: db.prepare(`SELECT COUNT(*) n FROM ${role}.records`).get().n,
      sourceCount: db.prepare(`SELECT COUNT(*) n FROM ${role}.imports`).get().n,
      stationCount: db.prepare(`SELECT COUNT(*) n FROM ${role}.stations`).get().n,
      reviewCount: db.prepare(`SELECT COUNT(*) n FROM ${role}.reviews`).get().n,
      receivedRevision: db.prepare(`SELECT value FROM ${role}.meta WHERE key='revision'`).get().value
    };
  }
  inventory.returnedOnlyRecords = db.prepare(`SELECT COUNT(*) n FROM returned.records r
    LEFT JOIN current.records c ON c.id=r.id WHERE c.id IS NULL`).get().n;
  inventory.currentOnlyRecords = db.prepare(`SELECT COUNT(*) n FROM current.records c
    LEFT JOIN returned.records r ON r.id=c.id WHERE r.id IS NULL`).get().n;
  inventory.returnedOnlySources = db.prepare(`SELECT COUNT(*) n FROM returned.imports r
    LEFT JOIN current.imports c ON c.id=r.id WHERE c.id IS NULL`).get().n;
  inventory.currentOnlySources = db.prepare(`SELECT COUNT(*) n FROM current.imports c
    LEFT JOIN returned.imports r ON r.id=c.id WHERE r.id IS NULL`).get().n;
  return inventory;
}

/** Create a complete disk-backed three-way plan; no scientist workspace is edited. */
export function planReturnedReviews(inputs, destination, options = {}) {
  const root = ordinaryDirectory(destination);
  const title = options.title || 'Returned measurement reviews';
  const sources = {};
  for (const role of ROLES) {
    const file = path.resolve(nonempty(inputs[role], role + ' complete archive'));
    if (!fs.statSync(file).isFile()) throw new InputError(role + ' must be a complete archive file');
    sources[role] = {file, ...fileDigest(file)};
  }
  const selection = {format: RETURN_FORMAT, title, inputs: Object.fromEntries(ROLES.map(role =>
    [role, {bytes: sources[role].bytes, sha256: sources[role].sha256}]))};
  const id = stamp(selection);
  return withDirectoryLock(root, () => {
    const requestFile = path.join(root, 'request.json');
    if (fs.existsSync(requestFile) && !same(READ_JSON(requestFile), selection)) {
      throw new InputError('This directory retains a different three-way comparison', 409);
    }
    if (!fs.existsSync(requestFile)) {
      const other = fs.readdirSync(root).filter(name => !name.startsWith('operation.lock.sqlite'));
      if (other.length) throw new InputError('Choose an empty comparison directory', 409);
      atomicJSON(requestFile, selection);
    }
    if (fs.existsSync(path.join(root, 'plan.json'))) {
      const plan = openReturnedReviewPlan(root).plan;
      return {...plan, directory: root, reused: true};
    }
    const roles = {};
    for (const role of ROLES) {
      const archive = path.join(root, 'inputs', role + '.zip');
      copyVerified(sources[role].file, archive, sources[role]);
      const directory = ordinaryDirectory(path.join(root, 'captured', role));
      // These are disposable private captures, not editable recipient projects.
      // A process-death retry reconstructs them from the immutable input archive.
      fs.rmSync(directory, {recursive: true, force: true});
      const workspace = new MeasurementWorkspace(directory);
      try { roles[role] = receiveArchive(workspace, archive); }
      finally { workspace.close(); }
    }
    const currentDirectory = path.join(root, 'captured', 'current');
    const domainFile = path.join(currentDirectory, 'reaches.json');
    const domain = new Map((fs.existsSync(domainFile) ? READ_JSON(domainFile) : []).map(x => [x.id, x]));
    const temporary = path.join(root, 'plan-building.sqlite');
    for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(temporary + suffix, {force: true});
    const db = new DatabaseSync(temporary);
    const counts = {'apply-return': 0, conflict: 0, 'already-current': 0, 'source-needed': 0,
      unchangedGroups: 0, unchangedAssignments: 0, comparedGroups: 0, comparedAssignments: 0};
    let inventory;
    try {
      db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA temp_store=FILE;
        PRAGMA cache_size=-16384;
        CREATE TABLE changes(kind TEXT NOT NULL,key TEXT NOT NULL,classification TEXT NOT NULL,
          baseline TEXT NOT NULL,returned TEXT NOT NULL,current TEXT NOT NULL,desired TEXT NOT NULL,
          blockers TEXT NOT NULL,details TEXT NOT NULL,PRIMARY KEY(kind,key));
        CREATE INDEX changes_class ON changes(classification,kind,key);`);
      for (const role of ROLES) db.prepare(`ATTACH DATABASE ? AS ${role}`)
        .run(path.join(root, 'captured', role, 'measurements.sqlite'));
      db.exec('BEGIN');
      inventory = sourceInventory(db);
      const insert = db.prepare('INSERT INTO changes VALUES(?,?,?,?,?,?,?,?,?)');
      const sourceRows = Object.fromEntries(ROLES.map(role => [role, db.prepare(`SELECT data FROM ${role}.records WHERE id=?`)]));
      function originalDetails(role, group) {
        return Object.fromEntries(group.records.map(record => {
          const raw = JSON.parse(sourceRows[role].get(record.id).data);
          return [record.id, Object.fromEntries(['characteristic','reportedValue','reportedUnit','fraction','basis','lower','upper','method','detection','detectionLimits','issues','sampledAt'].map(key => [key, raw[key] ?? null]))];
        }));
      }
      const groups = Object.fromEntries(ROLES.map(role => [role, groupStatements(db, role + '.') ]));
      const keys = db.prepare(`SELECT logical_key FROM baseline.records UNION
        SELECT logical_key FROM returned.records UNION SELECT logical_key FROM current.records ORDER BY logical_key`);
      for (const item of keys.iterate()) {
        counts.comparedGroups++;
        const key = item.logical_key;
        const [base, returned, current] = ROLES.map(role => groupState(groups[role], key));
        const {desired, blockers, conflicting} = desiredGroup(base, returned, current);
        const classification = same(base, returned) ? 'unchanged' : blockers.length ? 'source-needed' :
          same(current, desired) ? 'already-current' : conflicting ? 'conflict' : 'apply-return';
        if (classification === 'unchanged') { counts.unchangedGroups++; continue; }
        counts[classification]++;
        insert.run('measurement', key, classification, stable(base), stable(returned), stable(current), stable(desired), stable(blockers), stable({baseline: originalDetails('baseline', base), returned: originalDetails('returned', returned), current: originalDetails('current', current)}));
      }
      const stations = db.prepare(`SELECT id FROM baseline.stations UNION SELECT id FROM returned.stations
        UNION SELECT id FROM current.stations ORDER BY id`);
      const assignments = Object.fromEntries(ROLES.map(role => [role,
        db.prepare(`SELECT data FROM ${role}.mappings WHERE station_id=?`)]));
      for (const item of stations.iterate()) {
        counts.comparedAssignments++;
        const key = item.id;
        const [base, returned, current] = ROLES.map(role => mappingState(assignments[role].get(key)?.data));
        const blockers = [];
        if (!exists(db, 'current.stations', 'id', key)) blockers.push('Current edition needs the original station source');
        if (!returned && base) blockers.push('Use the native explicit empty-reach assignment instead of removing its history');
        if (returned) {
          if (!returned.reviewer.trim() || !returned.reason.trim()) blockers.push('Returned assignment needs reviewer and rationale');
          const reach = domain.get(returned.reachId);
          if (returned.reachId && !reach) blockers.push('Returned reach is absent from the current retained native domain');
          const sourceSha = returned.domainSourceReference?.sourceSha256;
          if (sourceSha && reach?.sourceSha256 !== sourceSha) blockers.push('Returned assignment references another native source edition');
        }
        const classification = classify(base, returned, current, blockers);
        if (classification === 'unchanged') { counts.unchangedAssignments++; continue; }
        counts[classification]++;
        insert.run('station', key, classification, stable(base), stable(returned), stable(current), stable(returned), stable(blockers), '{}');
      }
      db.exec('COMMIT');
      for (const role of ROLES) db.exec('DETACH DATABASE ' + role);
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally { db.close(); }
    const databaseFile = path.join(root, 'plan.sqlite');
    fs.renameSync(temporary, databaseFile);
    const plan = {
      ...selection, id, createdAt: new Date().toISOString(), counts, inventory,
      sourceRevisions: Object.fromEntries(ROLES.map(role => [role, roles[role].sourceRevision])),
      database: {path: 'plan.sqlite', ...fileDigest(databaseFile)},
      contract: {
        measurementValues: 'unchanged; exact original native identities',
        changes: 'review state, reviewer, rationale, effective source selection and explicit station assignment',
        branchComparison: 'three-way returned deltas; independent current review/version changes stay current; timestamps and historical selectVersion flags are provenance, not conflict keys',
        result: 'new editable current-derived native workspace',
        newReturnedSources: 'reported with full original archives; never silently imported or dropped from the comparison'
      }
    };
    // Human reports are a derived view. Their complete JSONL and SQLite sources
    // remain available even when a particular print renderer is not installed.
    writeReturnedReviewReports(root, plan);
    atomicJSON(path.join(root, 'plan.json'), plan);
    // Inputs and plan retain all scientific evidence; received captures are
    // disposable comparison scratch, not another permanent project copy.
    fs.rmSync(ordinaryDirectory(path.join(root, 'captured')), {recursive: true, force: true});
    return {...plan, directory: root, reused: false};
  });
}

export function openReturnedReviewPlan(directory, {verifyInputs = false} = {}) {
  const root = ordinaryDirectory(directory);
  const plan = READ_JSON(path.join(root, 'plan.json'));
  if (plan.format !== RETURN_FORMAT || stamp({format: plan.format, title: plan.title, inputs: plan.inputs}) !== plan.id) {
    throw new InputError('Unknown or changed returned-review plan', 409);
  }
  if (!same(fileDigest(path.join(root, 'plan.sqlite')), {bytes: plan.database.bytes, sha256: plan.database.sha256})) {
    throw new InputError('The saved comparison database changed', 409);
  }
  if (verifyInputs) for (const role of ROLES) {
    if (!same(fileDigest(path.join(root, 'inputs', role + '.zip')), plan.inputs[role])) {
      throw new InputError('The retained ' + role + ' edition changed', 409);
    }
  }
  return {root, plan};
}

export function reviewDecisionTemplate(directory) {
  const {root, plan} = openReturnedReviewPlan(directory);
  const db = new DatabaseSync(path.join(root, 'plan.sqlite'), {readOnly: true});
  try {
    return {
      format: DECISION_FORMAT, planId: plan.id, reviewer: '', reason: '',
      decisions: [...db.prepare('SELECT kind,key,classification FROM changes ORDER BY kind,key').iterate()].map(row => ({
        kind: row.kind, key: row.key,
        choice: row.classification === 'conflict' ? '' : row.classification === 'apply-return' ? 'return' : 'current'
      }))
    };
  } finally { db.close(); }
}

function readDecisionChoices(db, plan, decisions) {
  if (decisions?.format !== DECISION_FORMAT || decisions.planId !== plan.id || !Array.isArray(decisions.decisions)) {
    throw new InputError('Decisions must name this exact saved three-way plan', 409);
  }
  const reviewer = nonempty(decisions.reviewer, 'Incorporating reviewer');
  const reason = nonempty(decisions.reason, 'Incorporation rationale');
  const choices = new Map();
  for (const entry of decisions.decisions) {
    if (!entry || !['measurement', 'station'].includes(entry.kind) || typeof entry.key !== 'string') {
      throw new InputError('Unknown decision identity');
    }
    const token = stable([entry.kind, entry.key]);
    if (choices.has(token)) throw new InputError('Duplicate review-group decision');
    if (!['current', 'return'].includes(entry.choice)) throw new InputError('Choose current or return for every changed group');
    const row = db.prepare('SELECT classification FROM changes WHERE kind=? AND key=?').get(entry.kind, entry.key);
    if (!row) throw new InputError('Decision names a group outside this saved plan');
    if (row.classification === 'source-needed' && entry.choice === 'return') {
      throw new InputError('This returned group needs its original source/domain intake before a new plan can apply it', 409);
    }
    choices.set(token, entry.choice);
  }
  const total = db.prepare('SELECT COUNT(*) n FROM changes').get().n;
  if (choices.size !== total) throw new InputError('Supply a decision for every changed group, including retained-current choices');
  return {reviewer, reason, choices};
}

function actionTransition(state, id, input) {
  const next = structuredClone(state);
  const row = next.records.find(record => record.id === id);
  if (!row) throw new InputError('Native action names an unknown current original');
  row.review = reviewState(input);
  if (input.selectVersion) next.selectedId = id;
  else if (input.state !== 'include' && next.selectedId === id) next.selectedId = null;
  return next;
}

/** Return native review calls that reach exactly the desired effective choices. */
function nativeGroupActions(key, current, desired, approval) {
  let state = structuredClone(current);
  const actions = [];
  function add(id, input) {
    const next = actionTransition(state, id, input);
    if (!same(state, next)) {
      actions.push({kind: 'measurement', key, entity: id, input, before: stamp(state), after: stamp(next)});
      state = next;
    }
  }
  // The original API clears a selection by marking that result pending/excluded.
  // A transient native pending event is needed only when clearing an included
  // selection while the desired review still includes that same original result.
  if (state.selectedId && !desired.selectedId) {
    const selected = desired.records.find(row => row.id === state.selectedId);
    if (!selected) throw new InputError('Selected current original is absent from the desired group');
    if (selected.review.state === 'include') {
      add(selected.id, {state: 'pending', reviewer: approval.reviewer,
        reason: approval.reason + ' [Native reconciliation: clear the prior explicit source-version choice before restoring its included review.]',
        selectVersion: false});
    }
  }
  for (const record of desired.records) {
    const retained = state.records.find(row => row.id === record.id);
    if (!same(retained.review, record.review)) {
      nonempty(record.review.reviewer, 'Returned native reviewer');
      nonempty(record.review.reason, 'Returned native rationale');
      add(record.id, {...record.review, selectVersion: false});
    }
  }
  if (desired.selectedId && state.selectedId !== desired.selectedId) {
    const record = desired.records.find(row => row.id === desired.selectedId);
    if (!record || record.review.state !== 'include') throw new InputError('The selected returned original must be included');
    nonempty(record.review.reviewer, 'Selected native reviewer');
    nonempty(record.review.reason, 'Selected native rationale');
    add(record.id, {...record.review, selectVersion: true});
  }
  if (!same(state, desired)) throw new InputError('The original native review calls cannot reproduce this desired group', 409);
  return actions;
}

function eventMatches(action, event) {
  if (!event || event.entity !== action.entity) return false;
  const data = JSON.parse(event.data);
  if (action.kind === 'measurement') {
    return event.kind === 'measurement-review' && same(reviewState(data), reviewState(action.input)) &&
      (data.selectVersion === true) === (action.input.selectVersion === true);
  }
  return event.kind === 'station-assignment' && same(mappingState(data), mappingState({...action.input, stationId: action.entity}));
}

function currentActionFingerprint(workspace, action, groups) {
  return action.kind === 'measurement' ? stamp(groupState(groups, action.key)) :
    stamp(mappingState(workspace.db.prepare('SELECT data FROM mappings WHERE station_id=?').get(action.key)?.data));
}

/**
 * Apply explicit choices to a new current-derived recipient. Native revisions and
 * exact native event prefixes recover an interrupted call without replaying it.
 */
export async function incorporateReturnedReviews(directory, decisions, destination) {
  const {root, plan} = openReturnedReviewPlan(directory, {verifyInputs: true});
  const output = ordinaryDirectory(destination);
  if (output === root || output.startsWith(root + path.sep)) throw new InputError('Put the editable result outside the immutable plan');
  const db = new DatabaseSync(path.join(root, 'plan.sqlite'), {readOnly: true});
  let approval;
  try { approval = readDecisionChoices(db, plan, decisions); }
  finally { db.close(); }
  const decisionIdentity = {format: DECISION_FORMAT, planId: plan.id, reviewer: approval.reviewer,
    reason: approval.reason, decisions: [...decisions.decisions].sort((a,b) => stable([a.kind,a.key]).localeCompare(stable([b.kind,b.key])))};
  const operation = {format: RETURN_FORMAT, planId: plan.id, decisionSha256: stamp(decisionIdentity)};
  const operationId = stamp(operation);
  if (fs.existsSync(output)) {
    const file = path.join(output, 'incorporated.json');
    if (!fs.existsSync(file) || READ_JSON(file).operationId !== operationId) {
      throw new InputError('The destination already contains another project', 409);
    }
    return {...READ_JSON(file), directory: output, alreadyCompleted: true};
  }
  const stage = output + '.incorporating-' + operationId.slice(0,24);
  ordinaryDirectory(stage);
  return await withDirectoryLock(stage, async () => {
    const requestFile = path.join(stage, 'incorporation-request.json');
    if (fs.existsSync(requestFile) && !same(READ_JSON(requestFile), {...operation, operationId})) {
      throw new InputError('The retained receiving stage belongs to another operation', 409);
    }
    if (!fs.existsSync(requestFile)) atomicJSON(requestFile, {...operation, operationId});
    const work = path.join(stage, 'measurements');
    const workspace = new MeasurementWorkspace(work);
    try {
      receiveArchive(workspace, path.join(root, 'inputs', 'current.zip'));
      const stateFile = path.join(stage, 'native-actions.json');
      const actionFile = path.join(stage, 'native-actions.jsonl');
      let execution;
      if (!fs.existsSync(stateFile)) {
        fs.rmSync(actionFile, {force: true});
        const fd = fs.openSync(actionFile, 'wx', 0o600);
        const planDB = new DatabaseSync(path.join(root, 'plan.sqlite'), {readOnly: true});
        let count = 0, adoptedGroups = 0, retainedGroups = 0;
        try {
          for (const row of planDB.prepare("SELECT * FROM changes ORDER BY CASE kind WHEN 'station' THEN 0 ELSE 1 END,key").iterate()) {
            if (approval.choices.get(stable([row.kind, row.key])) === 'current') {retainedGroups++; continue;}
            adoptedGroups++;
            const current = JSON.parse(row.current), desired = JSON.parse(row.desired);
            let actions;
            if (row.kind === 'measurement') actions = nativeGroupActions(row.key, current, desired, approval);
            else actions = same(current, desired) ? [] : [{kind:'station',key:row.key,entity:row.key,input:desired,before:stamp(current),after:stamp(desired)}];
            for (const action of actions) writeAll(fd, Buffer.from(stable({...action, ordinal: count++}) + '\n'));
          }
          fs.fsyncSync(fd);
        } finally {fs.closeSync(fd);planDB.close();}
        execution = {operationId, actionCount: count, adoptedGroups, retainedGroups,
          startRevision: workspace.revision(), startEventId: workspace.db.prepare('SELECT COALESCE(MAX(id),0) n FROM events').get().n,
          actions: fileDigest(actionFile)};
        atomicJSON(stateFile, execution);
        atomicJSON(path.join(stage, 'decisions.json'), decisionIdentity);
      } else execution = READ_JSON(stateFile);
      if (execution.operationId !== operationId || !same(fileDigest(actionFile), execution.actions)) {
        throw new InputError('Retained native action sequence changed', 409);
      }
      const appliedEvents = workspace.db.prepare('SELECT * FROM events WHERE id>? ORDER BY id').iterate(execution.startEventId);
      const appliedCount = workspace.db.prepare('SELECT COUNT(*) n FROM events WHERE id>?').get(execution.startEventId).n;
      if (appliedCount > execution.actionCount || workspace.revision() !== execution.startRevision + appliedCount) {
        throw new InputError('The receiving stage has independent edits; preserve it and use a fresh destination', 409);
      }
      const groups = groupStatements(workspace.db);
      const domainFile = path.join(work, 'reaches.json');
      const reachIds = (fs.existsSync(domainFile) ? READ_JSON(domainFile) : []).map(row => row.id);
      let completed = 0;
      for (const action of readJSONLines(actionFile)) {
        if (action.ordinal !== completed) throw new InputError('Native action order is incomplete',409);
        if (completed < appliedCount) {
          const event = appliedEvents.next();
          if (event.done || !eventMatches(action,event.value)) throw new InputError('Retained native event differs from this receiving operation',409);
        } else {
          if (completed === appliedCount) appliedEvents.return?.();
          if (currentActionFingerprint(workspace,action,groups) !== action.before) {
            throw new InputError('A receiving group changed before its native edit: ' + action.key,409);
          }
          const input = {...action.input, expectedRevision: workspace.revision()};
          if (action.kind === 'measurement') workspace.review(action.entity,input);
          else workspace.mapping(action.entity,input,reachIds);
          if (currentActionFingerprint(workspace,action,groups) !== action.after) {
            throw new InputError('The native edit produced a different effective review group',409);
          }
        }
        completed++;
      }
      appliedEvents.return?.();
      if (completed !== execution.actionCount) throw new InputError('The retained native action file is incomplete');
      const provenance = path.join(work,'returned-review-history',operationId);
      fs.mkdirSync(provenance,{recursive:true});
      const metadata = {...operation,operationId,reviewer:approval.reviewer,reason:approval.reason,
        sourceRevisions:plan.sourceRevisions,inputs:plan.inputs,actionCount:execution.actionCount,
        adoptedGroups:execution.adoptedGroups,retainedGroups:execution.retainedGroups,
        startRevision:execution.startRevision,resultRevision:workspace.revision()};
      for (const [name,value] of [['incorporation.json',metadata],['decisions.json',decisionIdentity],['plan.json',plan]]) {
        const target=path.join(provenance,name);
        if(fs.existsSync(target)){if(!same(READ_JSON(target),value))throw new InputError('Retained incorporation provenance changed',409);}
        else atomicJSON(target,value);
      }
      copyVerified(actionFile,path.join(provenance,'native-actions.jsonl'),execution.actions);
      const comparisonDigest=fileDigest(path.join(root,'plan.sqlite'));
      copyVerified(path.join(root,'plan.sqlite'),path.join(provenance,'plan.sqlite'),comparisonDigest);
      const edition=await exportEdition(workspace,{id:hash(operationId+'-complete-edition')});
      const delivery=path.join(stage,'edition');fs.mkdirSync(delivery,{recursive:true});
      for(const member of edition.files)copyVerified(editionMemberFile(workspace,edition.id,member.path).file,path.join(delivery,member.path),member);
      atomicJSON(path.join(delivery,'edition.json'),edition);
      const result={...metadata,format:RETURN_FORMAT,recordCount:edition.recordCount,counts:edition.counts,
        editionId:edition.id,files:edition.files,workspace:'measurements',completeArchive:'edition/project.zip',
        completedAt:new Date().toISOString()};
      atomicJSON(path.join(stage,'incorporated.json'),result);
      fs.writeFileSync(path.join(stage,'RECEIVING.md'),`# ${plan.title}\n\nThis is the new current-derived, independently editable Measurements project.\n\nOpen the existing Measurements application against the **measurements** directory. The complete native **edition/project.zip** can be received with the original large-receive command. Every current measurement, original source, existing review history and retained companion remains present. ${execution.actionCount} original native edit calls incorporated the explicit returned choices.\n\nThe complete comparison and incorporation decisions are preserved inside measurements/returned-review-history/${operationId}/ and travel in future native archives. Input-edition identities name the original complete archives retained in the separate comparison directory. Scientist interpretation remains with the reviewer; a review does not remove native censoring, unit, method or domain restrictions.\n\nRepeating the same operation returns this project without replaying native edits or replacing later independent changes.\n`,'utf8');
      workspace.close();
      fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.renameSync(stage,output);
      return {...result,directory:output,alreadyCompleted:false};
    } finally {if(workspace.db.isOpen)workspace.close();}
  });
}
