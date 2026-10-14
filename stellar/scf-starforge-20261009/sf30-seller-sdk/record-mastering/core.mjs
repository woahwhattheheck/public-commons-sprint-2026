// MIT. One original-data store and explicit decision writer for record mastering.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseCSV, writeCSV } from './csv.mjs';
import { MasteringProjection } from './projection.mjs';
import { deliveryComparisonResult } from './delivery-comparison.mjs';
export const SCHEMA = 'stellar-forge.record-mastering.v1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString(), id = () => randomUUID(), json = JSON.stringify;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : plain(x) ? '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => json(k) + ':' + canonical(x[k])).join(',') + '}' : json(x);
export class MasteringError extends Error {
    constructor(code, message, status = 400) { super(message); this.name = 'MasteringError'; this.code = code; this.status = status; }
}
export function ensure(ok, code, message, status = 400) { if (!ok)
    throw new MasteringError(code, message, status); }
function text(value, label, max = 1000) { ensure(typeof value === 'string' && value.trim() && value.length <= max, 'INVALID_TEXT', `${label} must contain 1–${max} characters.`); return value; }
function strings(value, label) { ensure(Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string' && x) && new Set(value).size === value.length, 'INVALID_SELECTION', `${label} must be a nonempty, unique list.`); return value; }
function paging(input = {}) { let { offset = 0, limit = 50 } = input; ensure(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500, 'INVALID_PAGE', 'Choose a page size from 1 to 500.'); return { offset, limit }; }
function page(rows, input) { const { offset, limit } = paging(input); return { items: rows.slice(offset, offset + limit), total: rows.length, offset, limit, nextOffset: offset + limit < rows.length ? offset + limit : null }; }
export function normalize(value, mode) {
    if (mode === 'exact')
        return value;
    if (mode === 'fold')
        return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
    if (mode === 'digits')
        return value.replace(/[^0-9]/g, '');
    if (mode === 'email')
        return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (mode === 'domain') {
        let s = value.trim().toLowerCase();
        s = s.includes('@') ? s.slice(s.lastIndexOf('@') + 1) : s.replace(/^https?:\/\//, '').split('/')[0];
        return s.replace(/^www\./, '').replace(/\.$/, '');
    }
    throw new MasteringError('INVALID_NORMALIZER', 'Unknown matching normalization.');
}

// Always attempt every owned cleanup and preserve the original failure object.
function finishOwnedCleanup(primary, actions) {
    const failures = [];
    for (const action of actions) { try { action(); } catch (error) { failures.push(error); } }
    if (primary) {
        if (failures.length && (typeof primary === 'object' || typeof primary === 'function')) {
            try { Object.defineProperty(primary, 'cleanupErrors', { value: [...(primary.cleanupErrors ?? []), ...failures], configurable: true }); } catch {}
        }
        throw primary;
    }
    if (failures.length) { const first = failures.shift(); if (failures.length && first && (typeof first === 'object' || typeof first === 'function')) { try { Object.defineProperty(first, 'cleanupErrors', { value: [...(first.cleanupErrors ?? []), ...failures], configurable: true }); } catch {} } throw first; }
}

export class MasteringWorkspace {
    constructor(directory, { create = false, title = 'Customer records' } = {}) {
        this.directory = resolve(directory);
        const path = join(this.directory, 'mastering.sqlite');
        if (create) {
            ensure(!existsSync(path), 'WORKSPACE_EXISTS', 'This workspace already exists.', 409);
            mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        }
        ensure(existsSync(path) || create, 'WORKSPACE_NOT_FOUND', 'Create or receive a workspace first.', 404);
        if (existsSync(path))
            ensure(statSync(path).isFile(), 'INVALID_WORKSPACE', 'The workspace database must be a regular file.');
        this.db = new DatabaseSync(path, { timeout: 5000 });
        this.closed = false;
        try {
        this.db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
        if (create) {
            this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
            this.db.prepare('INSERT INTO workspace VALUES(?,?,0,?,1)').run(id(), text(title, 'Workspace title', 128), now());
            this.db.prepare('INSERT INTO settings VALUES(?,?)').run('rules', json([]));
            chmodSync(path, 0o600);
        }
        const meta = this.db.prepare('SELECT * FROM workspace').get();
        ensure(meta?.format === 1, 'WORKSPACE_FORMAT', 'Unsupported record-mastering workspace.');
        this.projection = new MasteringProjection(this.db);
        this.groupCache = null;
        } catch (error) { finishOwnedCleanup(error, [() => this.close()]); }
    }
    close() { if (this.closed) return; this.db.close(); this.closed = true; }
    meta() { return { ...this.db.prepare('SELECT * FROM workspace').get(), schema: SCHEMA }; }
    binding() { const m = this.meta(); return { schema: SCHEMA + '.binding', workspaceId: m.id, directory: this.directory, sha256: sha256(canonical({ id: m.id, directory: this.directory, format: m.format })) }; }
    tx(kind, input, perform) {
        ensure(plain(input), 'INVALID_REQUEST', 'An operation object is required.');
        const requestId = text(input.requestId, 'Request ID', 128), payloadSha = sha256(canonical({ kind, input }));
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const prior = this.db.prepare('SELECT request_sha,result FROM operations WHERE id=?').get(requestId);
            if (prior) {
                ensure(prior.request_sha === payloadSha, 'REQUEST_ID_REUSED', 'This request ID was used with different input.', 409);
                this.db.exec('COMMIT');
                return { ...JSON.parse(prior.result), replayed: true };
            }
            const before = this.meta();
            ensure(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision === before.revision, 'REVISION_CHANGED', 'The workspace changed. Refresh and review the current records.', 409);
            const result = perform();
            ensure(!result?.then, 'ASYNC_TRANSACTION', 'An operation must finish inside its transaction.', 500);
            this.db.prepare('UPDATE workspace SET revision=revision+1').run();
            const response = { ...result, revision: before.revision + 1 };
            const recordedInput = input.base64 ? { ...input, base64: undefined, sourceBytes: Buffer.byteLength(input.base64, 'base64'), sourceSha256: sha256(Buffer.from(input.base64, 'base64')) } : input;
            this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)').run(requestId, payloadSha, kind, canonical(recordedInput), json(response), now(), before.revision + 1);
            this.db.exec('COMMIT');
            this.projection.afterMutation(kind,input,before.revision,response.revision);
            if (['feed.create','delivery.create'].includes(kind) && this.groupCache?.revision===before.revision)
                this.groupCache.revision=response.revision;
            else this.groupCache = null;
            return response;
        }
        catch (error) {
            this.projection.invalidate();
            this.groupCache=null;
            try {
                this.db.exec('ROLLBACK');
            }
            catch { }
            throw error;
        }
    }
    inspectCSV(bytes) { const parsed = parseCSV(bytes); return { sha256: sha256(bytes), bytes: bytes.length, headers: parsed.headers, rowCount: parsed.rows.length, preview: parsed.rows.slice(0, 8) }; }
    createFeed(input) {
        return this.tx('feed.create', input, () => {
            const name = text(input.name, 'Source name', 128);
            ensure(plain(input.mapping) && Object.keys(input.mapping).length > 0 && Object.keys(input.mapping).length <= 63, 'INVALID_MAPPING', 'Map 1–63 master fields to source headers.');
            for (const [field, source] of Object.entries(input.mapping)) {
                ensure(/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(field) && !['master_id', 'constructor', 'prototype', '__proto__'].includes(field), 'INVALID_FIELD', 'Use a letter followed by letters, digits or underscores for master fields.');
                text(source, 'Source header', 256);
            }
            strings(input.keyColumns, 'Stable source key columns');
            const feedId = id();
            this.db.prepare('INSERT INTO feeds VALUES(?,?,?,?,NULL,?)').run(feedId, name, json(input.mapping), json(input.keyColumns), now());
            return { feedId, name };
        });
    }
    feeds() { return this.db.prepare('SELECT id,name,mapping,keys_json,active_edition,created FROM feeds ORDER BY created,id').all().map(f => ({ ...f, mapping: JSON.parse(f.mapping), keyColumns: JSON.parse(f.keys_json), editions: this.db.prepare('SELECT id,label,created,sha256,row_count FROM source_editions WHERE feed_id=? ORDER BY created,id').all(f.id) })); }
    importSource(input) {
        const bytes = Buffer.from(text(input.base64, 'CSV contents', 200 * 1024 * 1024), 'base64');
        ensure(bytes.length <= 128 * 1024 * 1024 && bytes.toString('base64') === input.base64, 'INVALID_CSV_BYTES', 'Supply canonical base64 CSV bytes up to 128 MiB.');
        const parsed = parseCSV(bytes), digest = sha256(bytes);
        if (input.sha256)
            ensure(input.sha256 === digest, 'SOURCE_CHANGED', 'The source file digest changed.', 409);
        return this.tx('source.import', input, () => {
            const f = this.db.prepare('SELECT * FROM feeds WHERE id=?').get(input.feedId);
            ensure(f, 'SOURCE_NOT_FOUND', 'Source not found.', 404);
            const mapping = JSON.parse(f.mapping), keys = JSON.parse(f.keys_json), positions = new Map(parsed.headers.map((h, i) => [h, i]));
            for (const h of [...keys, ...Object.values(mapping)])
                ensure(positions.has(h), 'MISSING_HEADER', `The CSV is missing source header “${h}”.`);
            const editionId = id(), seen = new Set();
            this.db.prepare('INSERT INTO source_editions VALUES(?,?,?,?,?,?,?,?)').run(editionId, f.id, text(input.label, 'Edition label', 128), now(), digest, bytes, json(parsed.headers), parsed.rows.length);
            const lookup = this.db.prepare('SELECT id FROM records WHERE feed_id=? AND source_key=?'), insert = this.db.prepare('INSERT INTO records(id,feed_id,source_key,created) VALUES(?,?,?,?)'), observe = this.db.prepare('INSERT INTO observations VALUES(?,?,?,?,?)');
            for (let n = 0; n < parsed.rows.length; n++) {
                const row = parsed.rows[n], kv = keys.map(k => row[positions.get(k)]);
                ensure(kv.every(v => v !== ''), 'EMPTY_SOURCE_KEY', `Source record ${n + 1} has an empty stable key.`);
                const key = json(kv);
                ensure(!seen.has(key), 'DUPLICATE_SOURCE_KEY', `Source record ${n + 1} repeats a stable key. Choose enough source key columns to identify each original record.`);
                seen.add(key);
                let recordId = lookup.get(f.id, key)?.id;
                if (!recordId) {
                    recordId = id();
                    insert.run(recordId, f.id, key, now());
                }
                const raw = Object.fromEntries(parsed.headers.map((h, i) => [h, row[i]])), values = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, row[positions.get(h)]]));
                observe.run(editionId, recordId, n + 1, json(raw), json(values));
            }
            return { editionId, feedId: f.id, rowCount: parsed.rows.length, sha256: digest };
        });
    }
    refreshPlan(editionId, input = {}) {
        const edition = this.db.prepare('SELECT * FROM source_editions WHERE id=?').get(editionId);
        ensure(edition, 'EDITION_NOT_FOUND', 'Source edition not found.', 404);
        const feed = this.db.prepare('SELECT * FROM feeds WHERE id=?').get(edition.feed_id);
        const get = ed => new Map((ed ? this.db.prepare('SELECT record_id,row_number,values_json FROM observations WHERE edition_id=?').all(ed) : []).map(o => [o.record_id, { ...o, values: JSON.parse(o.values_json) }]));
        const before = get(feed.active_edition), after = get(editionId), changes = [];
        let unchanged = 0;
        for (const [recordId, o] of after) {
            const old = before.get(recordId);
            if (!old)
                changes.push({ recordId, kind: 'added', rowNumber: o.row_number, after: o.values });
            else {
                const fields = Object.keys(o.values).filter(k => o.values[k] !== old.values[k]);
                if (fields.length)
                    changes.push({ recordId, kind: 'changed', rowNumber: o.row_number, fields, before: old.values, after: o.values });
                else
                    unchanged++;
            }
        }
        for (const [recordId, o] of before)
            if (!after.has(recordId))
                changes.push({ recordId, kind: 'missing', rowNumber: o.row_number, before: o.values });
        const revision = this.meta().revision, planSha256 = sha256(canonical({ editionId, active: feed.active_edition, revision, changes }));
        return { editionId, feedId: feed.id, feedName: feed.name, label: edition.label, activeEdition: feed.active_edition, revision, planSha256, counts: { added: changes.filter(c => c.kind === 'added').length, changed: changes.filter(c => c.kind === 'changed').length, missing: changes.filter(c => c.kind === 'missing').length, unchanged }, ...page(changes, input) };
    }
    activate(input) {
        return this.tx('source.activate', input, () => {
            const plan = this.refreshPlan(input.editionId, { limit: 1 });
            ensure(input.planSha256 === plan.planSha256, 'PLAN_CHANGED', 'Review the current source refresh before applying it.', 409);
            const rows = this.db.prepare('SELECT o.record_id FROM observations o LEFT JOIN members m ON m.record_id=o.record_id WHERE o.edition_id=? AND m.record_id IS NULL').all(input.editionId);
            const entity = this.db.prepare('INSERT INTO entities(id,created) VALUES(?,?)'), member = this.db.prepare('INSERT INTO members VALUES(?,?)');
            for (const row of rows) {
                const entityId = id();
                entity.run(entityId, now());
                member.run(row.record_id, entityId);
            }
            this.db.prepare('UPDATE feeds SET active_edition=? WHERE id=?').run(input.editionId, plan.feedId);
            return { editionId: input.editionId, feedId: plan.feedId, newEntities: rows.length, counts: plan.counts };
        });
    }
    #projection() {
        const revision=this.meta().revision;
        this.projection.build(revision);
        return {revision,projection:this.projection};
    }
    entities(input = {}) {
        const {revision,projection}=this.#projection();
        return {revision,...projection.page(input,paging)};
    }
    entity(entityId) {
        const {revision,projection}=this.#projection(), e=projection.entity(entityId);
        ensure(e,'ENTITY_NOT_FOUND','Master record not found.',404);
        return {revision,...e};
    }
    status() {
        const {projection}=this.#projection(), m=this.meta();
        return {...m,feeds:this.feeds(),counts:{
            sources:this.db.prepare('SELECT count(*) n FROM feeds').get().n,
            originalEditions:this.db.prepare('SELECT count(*) n FROM source_editions').get().n,
            ...projection.counts(),
            sourceRecords:this.db.prepare('SELECT count(*) n FROM records').get().n,
            deliveries:this.db.prepare('SELECT count(*) n FROM deliveries').get().n
        },rules:this.rules()};
    }
    saveRules(input) {
        return this.tx('rules.save', input, () => {
            ensure(Array.isArray(input.rules) && input.rules.length <= 16, 'INVALID_RULES', 'Choose up to 16 matching rules.');
            const fields = new Set(this.feeds().flatMap(f => Object.keys(f.mapping))), seen = new Set();
            for (const r of input.rules) {
                ensure(plain(r) && fields.has(r.field) && ['exact', 'fold', 'digits', 'email', 'domain'].includes(r.normalize), 'INVALID_RULE', 'Choose a mapped field and a supported normalization.');
                ensure(!seen.has(r.field), 'DUPLICATE_RULE', 'Choose one normalization per field.');
                seen.add(r.field);
            }
            this.db.prepare('UPDATE settings SET value=? WHERE key=?').run(json(input.rules), 'rules');
            return { rules: input.rules };
        });
    }
    rules() { return JSON.parse(this.db.prepare('SELECT value FROM settings WHERE key=?').get('rules').value); }
    #groups() {
        const { revision, projection } = this.#projection();
        if (this.groupCache?.revision === revision)
            return this.groupCache.groups;
        // Index groups, not every pair: a common value never creates an O(n^2) pair list.
        const groups = new Map(), rules = this.rules();
        for (const e of projection.entities())
            for (const r of e.records) {
                if (r.missing || r.excluded)
                    continue;
                for (const rule of rules) {
                    const raw = r.values[rule.field] ?? '', value = normalize(raw, rule.normalize);
                    if (!value)
                        continue;
                    const key = canonical([rule.field, rule.normalize, value]);
                    let g = groups.get(key);
                    if (!g) {
                        g = { field: rule.field, normalize: rule.normalize, value, entities: new Map() };
                        groups.set(key, g);
                    }
                    g.entities.set(e.id, { id: e.id, title: e.title, status: e.status });
                }
            }
        const dismissed = new Set(this.db.prepare('SELECT signature FROM dismissed').all().map(d => d.signature)), result = [];
        for (const [key, g] of groups) {
            if (g.entities.size < 2)
                continue;
            const ids = [...g.entities.keys()].sort(), signature = sha256(key + '\0' + canonical(ids));
            if (dismissed.has(signature))
                continue;
            result.push({ ...g, id: signature, entityCount: ids.length, entities: [...g.entities.values()] });
        }
        result.sort((a, b) => b.entityCount - a.entityCount || a.field.localeCompare(b.field) || a.value.localeCompare(b.value));
        this.groupCache = { revision, groups: result };
        return result;
    }
    groups(input = {}) { return { revision: this.meta().revision, ...page(this.#groups().map(({ entities, ...g }) => g), input) }; }
    group(signature, input = {}) { const group = this.#groups().find(g => g.id === signature); ensure(group, 'MATCH_CHANGED', 'This match group changed. Refresh the matching desk.', 409); return { revision: this.meta().revision, ...group, entities: undefined, ...page(group.entities, input) }; }
    dismiss(input) { return this.tx('match.dismiss', input, () => { const g = this.#groups().find(g => g.id === input.groupId); ensure(g, 'MATCH_CHANGED', 'This match group changed.', 409); this.db.prepare('INSERT INTO dismissed VALUES(?,?,?)').run(g.id, text(input.reason, 'Reason', 2000), now()); return { groupId: g.id }; }); }
    merge(input) {
        return this.tx('entity.merge', input, () => {
            const ids = strings(input.entityIds, 'Master records');
            ensure(ids.length >= 2, 'MERGE_SELECTION', 'Choose at least two master records.');
            const chosen = ids.map(entityId => this.entity(entityId));
            if (input.groupId) {
                const group = this.#groups().find(g => g.id === input.groupId), members = new Set(group?.entities.map(e => e.id) ?? []);
                ensure(group && ids.every(x => members.has(x)), 'MATCH_CHANGED', 'The selected matching group changed.', 409);
            }
            const target = ids[0], reconsider = [];
            for (const from of ids.slice(1)) {
                for (const row of this.db.prepare('SELECT field,decision FROM choices WHERE entity_id=?').all(from)) {
                    const prior = this.db.prepare('SELECT decision FROM choices WHERE entity_id=? AND field=?').get(target, row.field);
                    if (!prior)
                        this.db.prepare('INSERT INTO choices VALUES(?,?,?)').run(target, row.field, row.decision);
                    else if (canonical(JSON.parse(prior.decision)) !== canonical(JSON.parse(row.decision))) {
                        this.db.prepare('UPDATE choices SET decision=? WHERE entity_id=? AND field=?').run(json({ mode: 'review', priorDecisions: [JSON.parse(prior.decision), JSON.parse(row.decision)], note: 'Multiple retained field decisions joined in this merge.' }), target, row.field);
                        reconsider.push(row.field);
                    }
                }
                this.db.prepare('UPDATE members SET entity_id=? WHERE entity_id=?').run(target, from);
                this.db.prepare('DELETE FROM choices WHERE entity_id=?').run(from);
                this.db.prepare('UPDATE entities SET archived=1 WHERE id=?').run(from);
            }
            if (input.label !== undefined)
                this.db.prepare('UPDATE entities SET label=? WHERE id=?').run(text(input.label, 'Record label', 256), target);
            return { entityId: target, merged: chosen.map(e => ({ id: e.id, title: e.title })), fieldsToReview: [...new Set(reconsider)] };
        });
    }
    split(input) {
        return this.tx('entity.split', input, () => {
            const e = this.entity(input.entityId), records = strings(input.recordIds, 'Source records');
            ensure(records.length < e.records.length && records.every(x => e.records.some(r => r.id === x)), 'SPLIT_SELECTION', 'Choose some, but not all, source records from this master.');
            ensure((input.label === undefined || typeof input.label === 'string' && input.label.length <= 256) && (input.note === undefined || typeof input.note === 'string' && input.note.length <= 10000), 'INVALID_NOTE', 'Use a short split label and working note.');
            const entityId = id();
            this.db.prepare('INSERT INTO entities(id,label,note,created) VALUES(?,?,?,?)').run(entityId, input.label ?? '', input.note ?? '', now());
            for (const recordId of records)
                this.db.prepare('UPDATE members SET entity_id=? WHERE record_id=?').run(entityId, recordId);
            // Source-pinned choices follow their selected source record. Custom values remain with the original master.
            for (const [field, f] of Object.entries(e.fields))
                if (f.choice?.mode === 'source' && records.includes(f.choice.recordId)) {
                    this.db.prepare('INSERT INTO choices VALUES(?,?,?)').run(entityId, field, json(f.choice));
                    this.db.prepare('DELETE FROM choices WHERE entity_id=? AND field=?').run(e.id, field);
                }
            return { entityId, originalEntityId: e.id, recordCount: records.length };
        });
    }
    choose(input) {
        return this.tx('field.choose', input, () => {
            const e = this.entity(input.entityId), field = text(input.field, 'Field', 48);
            ensure(own(e.fields, field), 'FIELD_NOT_FOUND', 'This master record does not contain the selected field.', 404);
            if (input.mode === 'auto') {
                this.db.prepare('DELETE FROM choices WHERE entity_id=? AND field=?').run(e.id, field);
                return { entityId: e.id, field };
            }
            let decision;
            if (input.mode === 'source') {
                const r = e.records.find(r => r.id === input.recordId && !r.missing && !r.excluded);
                ensure(r && own(r.values, field), 'VALUE_NOT_FOUND', 'The source value is no longer available.', 409);
                decision = { mode: 'source', recordId: r.id, editionId: r.editionId, value: r.values[field], note: input.note ?? '', selectedAt: now() };
            }
            else {
                ensure(input.mode === 'custom' && typeof input.value === 'string' && input.value.length <= 65536, 'INVALID_CHOICE', 'Choose an original source value or explicit custom text.');
                decision = { mode: 'custom', value: input.value, note: input.note ?? '', selectedAt: now() };
            }
            this.db.prepare('INSERT INTO choices VALUES(?,?,?) ON CONFLICT(entity_id,field) DO UPDATE SET decision=excluded.decision').run(e.id, field, json(decision));
            return { entityId: e.id, field, decision };
        });
    }
    annotate(input) { return this.tx('entity.annotate', input, () => { this.entity(input.entityId); ensure(typeof input.label === 'string' && input.label.length <= 256 && typeof input.note === 'string' && input.note.length <= 10000, 'INVALID_NOTE', 'Use a short label and a note up to 10,000 characters.'); this.db.prepare('UPDATE entities SET label=?,note=? WHERE id=?').run(input.label, input.note, input.entityId); return { entityId: input.entityId }; }); }
    exclude(input) { return this.tx('record.exclude', input, () => { ensure(typeof input.excluded === 'boolean', 'INVALID_EXCLUSION', 'Choose whether to exclude this source record.'); const record = this.db.prepare('SELECT id FROM records WHERE id=?').get(input.recordId); ensure(record, 'RECORD_NOT_FOUND', 'Source record not found.', 404); const reason = input.excluded ? text(input.reason, 'Exclusion reason', 2000) : ''; this.db.prepare('UPDATE records SET excluded=?,reason=? WHERE id=?').run(input.excluded ? 1 : 0, reason, record.id); return { recordId: record.id, excluded: input.excluded }; }); }
    createDelivery(input) {
        return this.tx('delivery.create', input, () => {
            ensure(['all', 'ready'].includes(input.mode), 'INVALID_DELIVERY_MODE', 'Choose all active records or only ready records.');
            const columns = strings(input.columns, 'Delivery fields');
            ensure(columns.length <= 63, 'TOO_MANY_FIELDS', 'Deliver up to 63 mapped fields plus the master identifier.');
            const known = new Set(this.feeds().flatMap(f => Object.keys(f.mapping)));
            ensure(columns.every(c => known.has(c)), 'UNKNOWN_FIELD', 'Choose only mapped fields.');
            const {projection}=this.#projection(), rows=[], provenance=[], conflicts=[];
            let activeCount=0;
            for (const e of projection.entities({activeOnly:true})) {
                activeCount++;
                if (input.mode!=='all' && e.conflicts.length) continue;
                const row = { master_id: e.id };
                for (const field of columns) {
                    const f = e.fields[field] ?? { value: '', status: 'empty', candidates: [] };
                    row[field] = f.value;
                    provenance.push(json({ master_id: e.id, field, value: f.value, status: f.status, sources: f.candidates, decision: f.choice ?? null }));
                    if (['conflict', 'changed', 'review'].includes(f.status))
                        conflicts.push({ master_id: e.id, record: e.title, field, status: f.status, candidate_values: json([...new Set(f.candidates.map(c => c.value))]), retained_value: f.retainedValue ?? '' });
                }
                rows.push(row);
            }
            const title = text(input.title, 'Delivery title', 128), csv = writeCSV(['master_id', ...columns], rows), schema = { schema: 'stellar-forge.csv-dataset.v1', file: 'master.csv', name: title, columns: Object.fromEntries(['master_id', ...columns].map(k => [k, 'string'])), filters: ['master_id'], sorts: ['master_id'], defaultLimit: 50, maxLimit: 250 };
            const doc = { schema: SCHEMA + '.delivery', title, created: now(), sourceRevision: this.meta().revision, mode: input.mode, rowCount: rows.length, omittedRecords: activeCount - rows.length, conflictCount: conflicts.length, columns, sourceEditions: this.feeds().map(f => ({ name: f.name, editionId: f.active_edition, sha256: f.editions.find(e => e.id === f.active_edition)?.sha256 ?? null })), csvSha256: sha256(csv) };
            const files = { 'master.csv': csv.toString('base64'), 'dataset.json': Buffer.from(json(schema) + '\n').toString('base64'), 'delivery.json': Buffer.from(json(doc) + '\n').toString('base64'), 'field-provenance.jsonl': Buffer.from(provenance.join('\n') + '\n').toString('base64'), 'conflicts.csv': writeCSV(['master_id', 'record', 'field', 'status', 'candidate_values', 'retained_value'], conflicts).toString('base64'), 'READING.md': Buffer.from(`# ${title}\n\n${rows.length} master records; ${conflicts.length} unresolved delivered fields.\n\nOpen master.csv with all columns treated as text. Leading zeros, exact decimals and original spelling are preserved. CSV values are exact machine data, including any formula-like text: use your spreadsheet application's text import, not automatic formula evaluation.\n\nThe master_id column is a stable join key. Blank output can mean an empty source value or an unresolved field; conflicts.csv distinguishes unresolved fields. field-provenance.jsonl records the original values and selected field decisions. This package therefore contains the selected records and their field provenance; share it only with the intended recipient. Source files and unrelated private records are held in the separate workspace backup.\n\nDelivery mode: ${input.mode === 'all' ? 'all active records, with unresolved fields left blank' : 'only active master records whose fields are resolved'}. ${activeCount - rows.length} active records were omitted by that mode.\n\nUse dataset.json with the existing dataset seller to serve this exact CSV. It declares text columns and a stable master identifier filter. The seller controls its original payment terms and delivery process.\n`).toString('base64') };
            const deliveryId = id();
            this.db.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?,?,?,?)').run(deliveryId, title, doc.created, doc.sourceRevision, input.mode, rows.length, conflicts.length, json(files));
            return { deliveryId, ...doc };
        });
    }
    deliveries() { return this.db.prepare('SELECT id,title,created,source_revision,mode,row_count,conflict_count FROM deliveries ORDER BY created DESC,id DESC').all(); }
    delivery(deliveryId) { const d = this.db.prepare('SELECT * FROM deliveries WHERE id=?').get(deliveryId); ensure(d, 'DELIVERY_NOT_FOUND', 'Delivery edition not found.', 404); return { ...d, files: JSON.parse(d.files_json), files_json: undefined }; }
    compareDeliveries(input) {
        const meta=this.meta();
        if(input.workspaceId!==undefined) ensure(input.workspaceId===meta.id,'WORKSPACE_CHANGED','Open the original or independently received workspace for this comparison.',409);
        const result=deliveryComparisonResult(meta,this.delivery(input.beforeId),this.delivery(input.afterId));
        if(input.expectedSha256!==undefined) ensure(input.expectedSha256===result.comparison.sha256,'DELIVERY_COMPARISON_CHANGED','The selected comparison differs from its retained original editions.',409);
        return result;
    }
    sourceBytes(editionId) { const e = this.db.prepare('SELECT original,sha256 FROM source_editions WHERE id=?').get(editionId); ensure(e, 'EDITION_NOT_FOUND', 'Source edition not found.', 404); return { bytes: Buffer.from(e.original), sha256: e.sha256 }; }
    history(input = {}) { const { offset, limit } = paging(input), total = this.db.prepare('SELECT count(*) n FROM operations').get().n; return { items: this.db.prepare('SELECT id,kind,created,revision,result FROM operations ORDER BY revision DESC LIMIT ? OFFSET ?').all(limit, offset).map(r => ({ ...r, result: JSON.parse(r.result) })), total, offset, limit, nextOffset: offset + limit < total ? offset + limit : null }; }
    invoke(action, input = {}) {
        const reads = { status: () => this.status(), binding: () => this.binding(), feeds: () => this.feeds(), entities: () => this.entities(input), entity: () => this.entity(input.entityId), groups: () => this.groups(input), group: () => this.group(input.groupId, input), rules: () => this.rules(), refresh: () => this.refreshPlan(input.editionId, input), deliveries: () => this.deliveries(), delivery: () => this.delivery(input.deliveryId), 'delivery.compare': () => this.compareDeliveries(input), history: () => this.history(input), operation: () => { const row = this.db.prepare('SELECT id,kind,revision,result FROM operations WHERE id=?').get(input.requestId); return row ? { found: true, id: row.id, kind: row.kind, revision: row.revision, result: JSON.parse(row.result) } : { found: false }; } };
        const writes = { 'feed.create': 'createFeed', 'source.import': 'importSource', 'source.activate': 'activate', 'rules.save': 'saveRules', 'match.dismiss': 'dismiss', 'entity.merge': 'merge', 'entity.split': 'split', 'field.choose': 'choose', 'entity.annotate': 'annotate', 'record.exclude': 'exclude', 'delivery.create': 'createDelivery' };
        if (own(reads, action)) {
            this.db.exec('BEGIN');
            try {
                const result = structuredClone(reads[action]());
                this.db.exec('COMMIT');
                return result;
            }
            catch (error) {
                this.projection.invalidate();
                this.groupCache=null;
                this.db.exec('ROLLBACK');
                throw error;
            }
        }
        if (own(writes, action))
            return this[writes[action]](input);
        throw new MasteringError('UNKNOWN_OPERATION', 'Unknown record-mastering operation.', 404);
    }
}
