// MIT. Durable keyed rows and complete-boundary change deltas.
// Replay compares exact per-key event multiplicities, not ordering between native keys.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { fail, canonical, identity, epochMs, now } from './common.mjs';
import { rowKey, matchesFilters, projectRecord } from './scalars.mjs';
export class RisingWaveMirror {
  constructor(filename,{query,fields,rawBindingHash,create=false}){
    this.query=query;this.fields=fields;this.closed=false;
    this.db=new DatabaseSync(filename);this.statements=new Map();
    try{
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if(create){
        this.db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);'+
          'CREATE TABLE records (row_key TEXT PRIMARY KEY,body TEXT NOT NULL);'+
          'CREATE TABLE boundary (row_key TEXT NOT NULL,ordinal INTEGER NOT NULL,event_hash TEXT NOT NULL,event TEXT NOT NULL,PRIMARY KEY(row_key,ordinal));'+
          'CREATE INDEX boundary_events ON boundary(row_key,event_hash);'+
          'CREATE TABLE deltas (row_key TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL,delta INTEGER NOT NULL,PRIMARY KEY(row_key,body_hash));'+
          'CREATE TABLE replay_expected (row_key TEXT NOT NULL,event_hash TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(row_key,event_hash));'+
          'CREATE TABLE replay_seen (row_key TEXT NOT NULL,event_hash TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(row_key,event_hash));');
        this.set('schema','stellar-forge.risingwave-mirror.v1');this.set('rawBindingHash',rawBindingHash);
        this.set('fields',fields);this.set('snapshotComplete',false);this.set('lastTimestamp',null);this.set('snapshotEpoch',null);
        this.set('events',0);this.set('appliedEvents',0);this.set('replayedEvents',0);this.set('attempts',0);
        this.set('updateDeletes',0);this.set('updateInserts',0);
      }
      if(this.get('schema')!=='stellar-forge.risingwave-mirror.v1'||this.get('rawBindingHash')!==rawBindingHash||
          identity(this.get('fields'))!==identity(fields))throw fail('RISINGWAVE_MIRROR_SOURCE_MISMATCH');
    }catch(issue){this.close();throw issue;}
  }
  statement(sql){let value=this.statements.get(sql);if(!value){value=this.db.prepare(sql);this.statements.set(sql,value);}return value;}
  get(key){const row=this.statement('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  set(key,value){this.statement('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  rowCount(){return this.statement('SELECT count(*) AS n FROM records').get().n;}
  beginCursor(mode,initial){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.set('complete',false);this.set('attempts',(this.get('attempts')??0)+1);
      this.db.exec('DELETE FROM replay_expected; DELETE FROM replay_seen;');
      if(mode==='changes'){
        if(!this.get('lastTimestamp')||!this.get('snapshotComplete'))throw fail('RISINGWAVE_CHECKPOINT_NOT_RESUMABLE');
        this.db.exec('INSERT INTO replay_expected(row_key,event_hash,event,count) SELECT row_key,event_hash,event,count(*) FROM boundary GROUP BY row_key,event_hash;');
        this.set('replaying',true);
      }else{
        if(this.rowCount()||this.get('events'))throw fail('RISINGWAVE_FULL_RESTART_REQUIRES_FRESH_MIRROR');
        this.set('snapshotEpoch',initial.state.epoch);this.set('replaying',false);
      }
      this.set('cursorInitial',initial);this.set('cursorMode',mode);this.set('cursorStartedAt',now());
      this.db.exec('COMMIT');
    }catch(issue){this.db.exec('ROLLBACK');throw issue;}
  }
  assertReplayComplete(){
    const missing=this.statement('SELECT e.row_key,e.count,coalesce(s.count,0) AS seen FROM replay_expected e '+
      'LEFT JOIN replay_seen s ON s.row_key=e.row_key AND s.event_hash=e.event_hash WHERE coalesce(s.count,0)<e.count LIMIT 1').get();
    if(missing)throw fail('RISINGWAVE_REPLAY_PREFIX_MISSING','Inclusive replay omitted exact retained events from the previous timestamp boundary.',
      {keyHash:identity(missing.row_key),expected:missing.count,seen:missing.seen});
  }
  flushDeltas(maxRows){
    if(this.get('updateDeletes')!==this.get('updateInserts'))throw fail('RISINGWAVE_UPDATE_PAIR_INCOMPLETE',
      'The complete native timestamp still has unmatched update before/after images.',
      {deletes:this.get('updateDeletes'),inserts:this.get('updateInserts')});
    const keys=this.statement('SELECT DISTINCT row_key FROM deltas ORDER BY row_key');
    for(const item of keys.iterate()){
      const key=item.row_key,prior=this.statement('SELECT body FROM records WHERE row_key=?').get(key);
      const values=new Map();
      if(prior)values.set(prior.body,1);
      for(const change of this.statement('SELECT body,delta FROM deltas WHERE row_key=?').iterate(key))
        values.set(change.body,(values.get(change.body)??0)+change.delta);
      let next=null,count=0;
      for(const [body,n]of values){
        if(n<0)throw fail('RISINGWAVE_BEFORE_IMAGE_MISMATCH','The complete native changes remove an image absent from the retained source.',{keyHash:identity(key)});
        if(n>0){count+=n;next=body;}
      }
      if(count>1)throw fail('RISINGWAVE_KEY_NOT_UNIQUE','The reviewed visible key is not unique at the complete source boundary.',{keyHash:identity(key)});
      this.statement('DELETE FROM records WHERE row_key=?').run(key);
      if(next!==null)this.statement('INSERT INTO records(row_key,body) VALUES(?,?)').run(key,next);
    }
    this.db.exec('DELETE FROM deltas;');
    this.set('updateDeletes',0);this.set('updateInserts',0);
    if(this.rowCount()>maxRows)throw fail('RISINGWAVE_CAPTURE_ROW_LIMIT','The complete raw mirror exceeds its declared row budget.',{maxRows});
  }
  applyBatch(rows,{maxRows,eventOffset,observation}){
    let applied=0,replayed=0;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const event of rows){
        const {row,op,timestamp}=event;
        if(!Array.isArray(row)||row.length!==this.fields.length||row.some(value=>value!==null&&typeof value!=='string'))throw fail('RISINGWAVE_EVENT_ROW_INVALID');
        if(!['Insert','Delete','UpdateDelete','UpdateInsert'].includes(op))throw fail('RISINGWAVE_OPERATION_UNKNOWN','The native change operation is unsupported.',{op});
        const key=rowKey(row,this.query,this.fields),body=canonical(row);
        if(Buffer.byteLength(key)>65536)throw fail('RISINGWAVE_KEY_TOO_LARGE');
        if(timestamp===null){
          if(this.get('cursorMode')!=='full'||this.get('lastTimestamp')!==null||op!=='Insert')throw fail('RISINGWAVE_SNAPSHOT_EVENT_INVALID');
          if(this.statement('SELECT 1 FROM records WHERE row_key=?').get(key))throw fail('RISINGWAVE_KEY_NOT_UNIQUE','The reviewed visible source key is not unique.');
          this.statement('INSERT INTO records(row_key,body) VALUES(?,?)').run(key,body);applied+=1;
          continue;
        }
        if(typeof timestamp!=='string'||!/^[0-9]+$/.test(timestamp))throw fail('RISINGWAVE_CHANGE_TIMESTAMP_INVALID');
        const last=this.get('lastTimestamp');
        if(last!==null&&BigInt(timestamp)<BigInt(last))throw fail('RISINGWAVE_CHANGE_ORDER_INVALID');
        if(last===null||BigInt(timestamp)>BigInt(last)){
          this.assertReplayComplete();this.flushDeltas(maxRows);
          this.db.exec('DELETE FROM boundary; DELETE FROM replay_expected; DELETE FROM replay_seen;');
          this.set('lastTimestamp',timestamp);this.set('replaying',false);
        }
        const eventText=canonical({op,row,timestamp}),eventHash=identity({op,row,timestamp});
        const expected=this.statement('SELECT count,event FROM replay_expected WHERE row_key=? AND event_hash=?').get(key,eventHash);
        const seen=this.statement('SELECT count FROM replay_seen WHERE row_key=? AND event_hash=?').get(key,eventHash)?.count??0;
        if(expected&&seen<expected.count){
          if(expected.event!==eventText)throw fail('RISINGWAVE_EVENT_HASH_COLLISION');
          this.statement('INSERT INTO replay_seen(row_key,event_hash,count) VALUES(?,?,?) ON CONFLICT(row_key,event_hash) DO UPDATE SET count=excluded.count').run(key,eventHash,seen+1);
          replayed+=1;continue;
        }
        const bodyHash=identity(row),delta=op==='Insert'||op==='UpdateInsert'?1:-1;
        const current=this.statement('SELECT body,delta FROM deltas WHERE row_key=? AND body_hash=?').get(key,bodyHash);
        if(current&&current.body!==body)throw fail('RISINGWAVE_ROW_HASH_COLLISION');
        this.statement('INSERT INTO deltas(row_key,body_hash,body,delta) VALUES(?,?,?,?) ON CONFLICT(row_key,body_hash) DO UPDATE SET delta=excluded.delta')
          .run(key,bodyHash,body,(current?.delta??0)+delta);
        if(op==='UpdateDelete')this.set('updateDeletes',this.get('updateDeletes')+1);
        if(op==='UpdateInsert')this.set('updateInserts',this.get('updateInserts')+1);
        const ordinal=(this.statement('SELECT max(ordinal) AS n FROM boundary WHERE row_key=?').get(key)?.n??0)+1;
        this.statement('INSERT INTO boundary(row_key,ordinal,event_hash,event) VALUES(?,?,?,?)').run(key,ordinal,eventHash,eventText);
        applied+=1;
      }
      if(this.rowCount()>maxRows)throw fail('RISINGWAVE_CAPTURE_ROW_LIMIT');
      if(observation.state.kind==='InitLogStoreQuery'||observation.state.kind==='Fetch'&&!observation.state.snapshot)this.set('snapshotComplete',true);
      this.set('events',this.get('events')+rows.length);this.set('appliedEvents',this.get('appliedEvents')+applied);
      this.set('replayedEvents',this.get('replayedEvents')+replayed);this.set('eventOffset',eventOffset);
      this.set('cursorObservation',observation);this.set('updatedAt',now());
      this.db.exec('COMMIT');
      return {applied,replayed,rows:this.rowCount(),events:this.get('events')};
    }catch(issue){this.db.exec('ROLLBACK');throw issue;}
  }
  completeBoundary(observation,nativeEof,maxRows){
    if(!nativeEof||observation.state.kind!=='InitLogStoreQuery'||!this.get('snapshotComplete'))throw fail('RISINGWAVE_COMPLETE_BOUNDARY_REQUIRED');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.assertReplayComplete();this.flushDeltas(maxRows);
      this.set('barrier',observation);this.set('replaying',false);this.set('complete',true);
      this.db.exec('COMMIT');return this.checkpoint();
    }catch(issue){this.db.exec('ROLLBACK');throw issue;}
  }
  checkpoint(){
    const hash=createHash('sha256');let boundaryEvents=0,keys=0,lastKey=null;
    for(const row of this.statement('SELECT row_key,ordinal,event FROM boundary ORDER BY row_key,ordinal').iterate()){
      hash.update(canonical(row)+'\n');boundaryEvents+=1;if(row.row_key!==lastKey){keys+=1;lastKey=row.row_key;}
    }
    const last=this.get('lastTimestamp'),snapshotEpoch=this.get('snapshotEpoch');
    return {schema:'stellar-forge.risingwave-checkpoint.v1',rawBindingHash:this.get('rawBindingHash'),
      replay:'inclusive-exact-event-multiplicity-per-key',snapshotComplete:this.get('snapshotComplete'),
      snapshotEpoch,snapshotUnixMs:snapshotEpoch?epochMs(snapshotEpoch):null,lastTimestamp:last,
      resumeAvailable:!!(last&&snapshotEpoch&&BigInt(last)>BigInt(epochMs(snapshotEpoch))),
      boundary:{events:boundaryEvents,keys,sha256:hash.digest('hex')},rows:this.rowCount(),events:this.get('events'),
      appliedEvents:this.get('appliedEvents'),replayedEvents:this.get('replayedEvents'),eventOffset:this.get('eventOffset')??0,
      pendingDeltas:this.statement('SELECT count(*) AS n FROM deltas').get().n,
      pendingUpdates:{deletes:this.get('updateDeletes'),inserts:this.get('updateInserts')},
      barrier:this.get('barrier'),complete:this.get('complete')===true};
  }
  progress(){return {rows:this.rowCount(),events:this.get('events'),lastTimestamp:this.get('lastTimestamp'),snapshotComplete:this.get('snapshotComplete'),replaying:this.get('replaying'),pendingDeltas:this.statement('SELECT count(*) AS n FROM deltas').get().n};}
  *records(input){
    for(const record of this.statement('SELECT row_key,body FROM records ORDER BY row_key').iterate()){
      const raw=JSON.parse(record.body);
      if(matchesFilters(raw,this.query,input,this.fields))yield {key:record.row_key,row:projectRecord(raw,this.query,this.fields)};
    }
  }
  close(){if(this.closed)return;this.db.close();this.closed=true;}
}
