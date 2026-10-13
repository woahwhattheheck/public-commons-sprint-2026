// MIT. Connection-private, disk-backed derived views; original SQLite tables remain authoritative.
// No schema migration or additional persistent customer data. Portable snapshots exclude TEMP tables.
export class MasteringProjection {
    constructor(db) {
        this.db = db;
        this.revision = null;
        // This sets only this connection's derived working storage. Never alter another process's files.
        db.exec(`PRAGMA temp_store=FILE; PRAGMA temp.cache_size=-4096;
          CREATE TEMP TABLE mastering_projection (
            id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, status TEXT NOT NULL,
            active_records INTEGER NOT NULL, summary_json TEXT NOT NULL,
            search_json TEXT NOT NULL, detail_json TEXT NOT NULL);
          CREATE INDEX mastering_projection_status ON mastering_projection(status,ordinal);`);
        db.function('mastering_search_contains', { deterministic: true }, (values, query) =>
            JSON.parse(values).some(value => value.includes(JSON.parse(query))) ? 1 : 0);
        this.records = db.prepare(`SELECT r.id AS record_id,r.source_key,r.excluded,r.reason,m.entity_id,f.id AS feed_id,f.name AS feed_name,f.active_edition,o.row_number,o.values_json,o.raw_json,CASE WHEN o.values_json IS NULL THEN (SELECT json_object('editionId',prior.edition_id,'rowNumber',prior.row_number,'values',json(prior.values_json),'raw',json(prior.raw_json)) FROM observations prior JOIN source_editions pe ON pe.id=prior.edition_id WHERE prior.record_id=r.id ORDER BY pe.created DESC,pe.id DESC LIMIT 1) END AS retained_json FROM members m JOIN records r ON r.id=m.record_id JOIN feeds f ON f.id=r.feed_id LEFT JOIN observations o ON o.record_id=r.id AND o.edition_id=f.active_edition WHERE m.entity_id=? ORDER BY f.created,r.created,r.id`);
        this.choices = db.prepare('SELECT field,decision FROM choices WHERE entity_id=?');
        this.insert = db.prepare('INSERT INTO temp.mastering_projection VALUES(?,?,?,?,?,?,?)');
    }
    invalidate() { this.revision = null; }
    build(revision) {
        if (this.revision === revision) return;
        this.revision = null;
        this.db.exec('DELETE FROM temp.mastering_projection');
        let number = 0;
        for (const entity of this.db.prepare('SELECT * FROM entities WHERE archived=0 ORDER BY created,id').iterate()) {
            const e = this.project(entity, ++number);
            this.store(e);
        }
        this.revision = revision;
    }
    store(e) {
        const summary={id:e.id,title:e.title,number:e.number,status:e.status,
            recordCount:e.records.length,activeRecords:e.activeRecords,conflicts:e.conflicts,
            missingRecords:e.missingRecords,excludedRecords:e.excludedRecords,
            values:Object.fromEntries(Object.entries(e.fields).map(([key,field])=>[key,field.value]))};
        const search=[e.title.toLowerCase(),...e.records.flatMap(record=>Object.values(record.values).map(value=>value.toLowerCase()))];
        this.insert.run(e.id,e.number,e.status,e.activeRecords,JSON.stringify(summary),JSON.stringify(search),JSON.stringify(e));
    }
    // Called only after the authoritative transaction commits. Projection failures never
    // change a successful business operation; the next reader rebuilds the disposable view.
    afterMutation(kind,input,previousRevision,revision) {
        if(this.revision!==previousRevision){this.invalidate();return;}
        if(['feed.create','rules.save','match.dismiss','delivery.create'].includes(kind)){
            this.revision=revision;return;
        }
        if(!['entity.annotate','field.choose','record.exclude'].includes(kind)){this.invalidate();return;}
        let savepoint=false;
        try {
            const id=kind==='record.exclude'?this.db.prepare('SELECT entity_id FROM members WHERE record_id=?').get(input.recordId)?.entity_id:input.entityId;
            const prior=id&&this.db.prepare('SELECT ordinal FROM temp.mastering_projection WHERE id=?').get(id);
            const entity=id&&this.db.prepare('SELECT * FROM entities WHERE archived=0 AND id=?').get(id);
            if(!prior||!entity){this.invalidate();return;}
            const detail=this.project(entity,prior.ordinal);
            this.db.exec('SAVEPOINT mastering_projection_update');savepoint=true;
            this.db.prepare('DELETE FROM temp.mastering_projection WHERE id=?').run(id);this.store(detail);
            this.db.exec('RELEASE mastering_projection_update');savepoint=false;this.revision=revision;
        } catch {
            if(savepoint){try{this.db.exec('ROLLBACK TO mastering_projection_update; RELEASE mastering_projection_update');}catch{}}
            this.invalidate();
        }
    }
    project(entity, number) {
        const e = { ...entity, number, records:[], fields:{}, conflicts:[], missingRecords:0, excludedRecords:0 };
        for (const o of this.records.iterate(entity.id)) {
            const retained = o.retained_json ? JSON.parse(o.retained_json) : null;
            const r = { id: o.record_id, sourceKey: JSON.parse(o.source_key), feedId: o.feed_id, sourceName: o.feed_name, editionId: o.values_json ? o.active_edition : retained?.editionId ?? null, rowNumber: o.row_number ?? retained?.rowNumber ?? null, excluded: !!o.excluded, reason: o.reason, missing: !o.values_json, values: o.values_json ? JSON.parse(o.values_json) : retained?.values ?? {}, raw: o.raw_json ? JSON.parse(o.raw_json) : retained?.raw ?? {} };
            e.records.push(r);
            if (r.missing)
                e.missingRecords++;
            if (r.excluded)
                e.excludedRecords++;
            if (r.missing || r.excluded)
                continue;
            for (const [field, value] of Object.entries(r.values)) {
                e.fields[field] ??= { candidates: [], status: 'empty', value: '' };
                if (value !== '')
                    e.fields[field].candidates.push({ value, recordId: r.id, editionId: r.editionId, sourceName: r.sourceName, rowNumber: r.rowNumber });
            }
        }
        const choices = new Map(this.choices.all(entity.id).map(row => [row.field,JSON.parse(row.decision)]));
        for (const [field] of choices.entries())
            e.fields[field] ??= { candidates: [], status: 'empty', value: '' };
        for (const [field, f] of Object.entries(e.fields)) {
            const values = [...new Set(f.candidates.map(c => c.value))], choice = choices.get(field);
            f.choice = choice ?? null;
            if (choice?.mode === 'custom') {
                f.value = choice.value;
                f.status = 'chosen';
            }
            else if (choice?.mode === 'source') {
                const r = e.records.find(r => r.id === choice.recordId && !r.missing && !r.excluded), current = r?.values[field];
                if (r && current === choice.value) {
                    f.value = choice.value;
                    f.status = 'chosen';
                }
                else {
                    f.status = 'changed';
                    f.retainedValue = choice.value;
                    e.conflicts.push(field);
                }
            }
            else if (choice?.mode === 'review') {
                f.status = 'review';
                e.conflicts.push(field);
            }
            else if (values.length === 1) {
                f.value = values[0];
                f.status = 'agreed';
            }
            else if (values.length > 1) {
                f.status = 'conflict';
                e.conflicts.push(field);
            }
        }
        e.activeRecords = e.records.filter(r => !r.missing && !r.excluded).length;
        e.title = e.label || e.fields.name?.value || e.fields.company?.value || e.fields.email?.value || e.records.map(r => r.values.name || r.values.company || r.values.email).find(Boolean) || `Record ${e.number}`;
        e.status = !e.activeRecords ? 'inactive' : e.conflicts.length ? 'review' : 'ready';
        return e;
    }
    page(input, paging) {
        const {offset,limit} = paging(input), args=[], terms=[];
        if (input.status) { terms.push('status=?'); args.push(input.status); }
        if (input.query) { terms.push('mastering_search_contains(search_json,?)'); args.push(JSON.stringify(String(input.query).toLowerCase())); }
        const where = terms.length ? ' WHERE '+terms.join(' AND ') : '';
        const total = this.db.prepare('SELECT count(*) n FROM temp.mastering_projection'+where).get(...args).n;
        const items = this.db.prepare('SELECT summary_json FROM temp.mastering_projection'+where+' ORDER BY ordinal LIMIT ? OFFSET ?')
            .all(...args,limit,offset).map(row => JSON.parse(row.summary_json));
        return {items,total,offset,limit,nextOffset:offset+limit<total?offset+limit:null};
    }
    entity(id) {
        const row=this.db.prepare('SELECT detail_json FROM temp.mastering_projection WHERE id=?').get(id);
        return row?JSON.parse(row.detail_json):null;
    }
    *entities({activeOnly=false}={}) {
        const where=activeOnly?' WHERE active_records>0':'';
        for (const row of this.db.prepare('SELECT detail_json FROM temp.mastering_projection'+where+' ORDER BY ordinal').iterate())
            yield JSON.parse(row.detail_json);
    }
    counts() {
        const result={masterRecords:0,ready:0,review:0,inactive:0};
        for (const row of this.db.prepare('SELECT status,count(*) n FROM temp.mastering_projection GROUP BY status').iterate()) {
            result[row.status]=row.n;result.masterRecords+=row.n;
        }
        return result;
    }
}
