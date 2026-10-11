import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export class Problem extends Error { constructor(status, message, code='invalid_request', detail) { super(message); this.status=status; this.code=code; this.detail=detail; } }
export const requireRole = (actor, ...roles) => { if (!actor || !roles.includes(actor.role)) throw new Problem(403,'This action requires '+roles.join(' or ')+' access.','role_required'); };
export const pack = value => gzipSync(JSON.stringify(value));
export const unpack = value => value ? JSON.parse(gunzipSync(value).toString()) : null;
export const sourceBinding = row => row.present === 0 ? `ABSENT:${row.presence_capture_id}:${row.sha}` : `PRESENT:${row.sha}`;

export class Workspace {
  constructor(filename) {
    this.filename=resolve(filename); mkdirSync(dirname(this.filename),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta VALUES('revision','0');
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,sha TEXT UNIQUE NOT NULL,origin TEXT NOT NULL,captured_at TEXT NOT NULL,imported_at TEXT NOT NULL,actor TEXT NOT NULL,metadata BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS source_versions(sha TEXT PRIMARY KEY,payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS source_heads(id TEXT PRIMARY KEY,kind TEXT NOT NULL,wp_id INTEGER NOT NULL,url TEXT NOT NULL,sha TEXT NOT NULL REFERENCES source_versions(sha),capture_id TEXT NOT NULL REFERENCES captures(id),modified_gmt TEXT,present INTEGER NOT NULL DEFAULT 1,presence_capture_id TEXT);
      CREATE TABLE IF NOT EXISTS capture_items(capture_id TEXT NOT NULL REFERENCES captures(id),source_id TEXT NOT NULL,sha TEXT NOT NULL,PRIMARY KEY(capture_id,source_id));
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,number INTEGER NOT NULL,source_sha TEXT NOT NULL,body BLOB NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,note TEXT NOT NULL,source_binding TEXT NOT NULL,UNIQUE(item_id,number));
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,current_revision TEXT NOT NULL REFERENCES revisions(id),stage TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,revision_id TEXT NOT NULL REFERENCES revisions(id),decision TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,note TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reviews_item ON reviews(item_id,created_at);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,sha TEXT UNIQUE NOT NULL,manifest BLOB NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES releases(id),action TEXT NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,result BLOB,actor TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,detail BLOB NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL,body_sha TEXT NOT NULL,response BLOB NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revision_item ON revisions(item_id,number);`);
    const headColumns=new Set(this.db.prepare('PRAGMA table_info(source_heads)').all().map(row=>row.name));
    if(!headColumns.has('present'))this.db.exec('ALTER TABLE source_heads ADD COLUMN present INTEGER NOT NULL DEFAULT 1');
    if(!headColumns.has('presence_capture_id'))this.db.exec('ALTER TABLE source_heads ADD COLUMN presence_capture_id TEXT');
    if(!this.db.prepare('PRAGMA table_info(revisions)').all().some(row=>row.name==='source_binding'))this.db.exec('ALTER TABLE revisions ADD COLUMN source_binding TEXT');
    this.db.exec("UPDATE revisions SET source_binding='PRESENT:'||source_sha WHERE source_binding IS NULL; UPDATE source_heads SET presence_capture_id=capture_id WHERE presence_capture_id IS NULL;");
  }
  revision() { return Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('revision').value); }
  meta(key, fallback=null) { const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setMeta(key,value) { this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  event(actor,action,entity,detail={}) { this.db.prepare('INSERT INTO audit(actor,action,entity,detail,created_at) VALUES(?,?,?,?,?)').run(actor.id || actor,action,entity,pack(detail),now()); }
  mutate(actor,input,fn,context=null) {
    if (!input || typeof input.requestId!=='string' || input.requestId.length<12 || input.requestId.length>160) throw new Problem(400,'Supply one retained request ID.');
    const bodySha=digest(context===null?input:{context,input}), old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(input.requestId);
    if (old) { if(old.actor!==actor.id || old.body_sha!==bodySha) throw new Problem(409,'This request ID already identifies a different request.','request_conflict'); return {...unpack(old.response),recovered:true}; }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.revision();
      if (input.revision!==current) throw new Problem(409,'The workspace changed. Refresh it before saving this review.','revision_conflict',{currentRevision:current});
      const result=fn() || {};
      if(result && typeof result.then==='function') throw new Error('Workspace transactions must be synchronous.');
      const response={...result,revision:current+1};
      this.setMeta('revision',current+1);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(input.requestId,actor.id,bodySha,pack(response),now());
      this.db.exec('COMMIT'); return response;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createUser({id,name,role,password}) {
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(id) || !name?.trim() || !['admin','reviewer','editor'].includes(role) || password.length<14) throw new Problem(400,'Use a stable user ID, a name, an allowed role, and a password of at least 14 characters.');
    const salt=randomBytes(24).toString('hex'), key=scryptSync(password,salt,64).toString('hex');
    this.db.prepare('INSERT INTO users(id,name,role,salt,password,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,salt=excluded.salt,password=excluded.password,enabled=1').run(id,name,role,salt,key,now());
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    this.event(id,'user.configured',id,{name,role});
  }
  login(id,password) {
    const row=this.db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(String(id));
    const key=scryptSync(String(password),row?.salt || 'missing-user-comparable-cost',64);
    if (!row || !timingSafeEqual(key,Buffer.from(row.password,'hex'))) throw new Problem(401,'The user ID or password was not accepted.','login_failed');
    const token=randomBytes(32).toString('base64url'), csrf=randomBytes(24).toString('base64url'), expiresAt=new Date(Date.now()+8*3600_000).toISOString();
    this.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),row.id,csrf,expiresAt);
    this.event(row.id,'session.started',row.id);
    return {token,csrf,expiresAt,user:{id:row.id,name:row.name,role:row.role}};
  }
  session(token) {
    if(!token) return null;
    const row=this.db.prepare('SELECT s.*,u.name,u.role,u.enabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?').get(digest(token),now());
    return row?.enabled ? {id:row.user_id,name:row.name,role:row.role,csrf:row.csrf,sessionId:row.id,expiresAt:row.expires_at} : null;
  }
  logout(actor) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(actor.sessionId); this.event(actor.id,'session.ended',actor.id); }
  source(id) { const row=this.db.prepare('SELECT h.*,v.payload FROM source_heads h JOIN source_versions v ON v.sha=h.sha WHERE h.id=?').get(id); return row ? {...row,binding:sourceBinding(row),original:unpack(row.payload),payload:undefined} : null; }
  current(id) {
    const row=this.db.prepare('SELECT i.*,r.number,r.source_sha,r.source_binding,r.body,r.actor,r.created_at,r.note,h.sha AS head_sha,h.url AS source_url,h.kind AS source_kind,h.wp_id,h.modified_gmt,h.capture_id,h.present,h.presence_capture_id FROM items i JOIN revisions r ON r.id=i.current_revision JOIN source_heads h ON h.id=i.id WHERE i.id=?').get(id);
    if(!row) throw new Problem(404,'This source item was not found.','item_not_found');
    const binding=sourceBinding({sha:row.head_sha,present:row.present,presence_capture_id:row.presence_capture_id});
    return {id:row.id,revisionId:row.current_revision,revisionNumber:row.number,stage:row.stage,sourceMissing:row.present===0,sourceChanged:row.source_binding!==binding,source:{kind:row.source_kind,wpId:row.wp_id,url:row.source_url,modifiedGmt:row.modified_gmt,sha256:row.source_sha,currentSha256:row.head_sha,captureId:row.capture_id,present:row.present!==0,presenceCaptureId:row.presence_capture_id,binding,reviewedBinding:row.source_binding},draft:unpack(row.body),author:row.actor,createdAt:row.created_at,updatedAt:row.updated_at,note:row.note};
  }
  allItems() { return this.db.prepare('SELECT id FROM items ORDER BY id').all().map(({id})=>this.current(id)); }
  newRevision(actor,id,sourceSha,body,note) {
    const previous=this.db.prepare('SELECT COALESCE(MAX(number),0) AS n FROM revisions WHERE item_id=?').get(id).n;
    const revisionId=randomUUID(),time=now();
    const source=this.source(id);
    if(!source||source.sha!==sourceSha)throw new Problem(409,'The draft source binding changed. Refresh the original source.','source_changed');
    this.db.prepare('INSERT INTO revisions(id,item_id,number,source_sha,body,actor,created_at,note,source_binding) VALUES(?,?,?,?,?,?,?,?,?)').run(revisionId,id,previous+1,sourceSha,pack(body),actor.id,time,note,source.binding);
    this.db.prepare('INSERT INTO items VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET current_revision=excluded.current_revision,stage=excluded.stage,updated_at=excluded.updated_at').run(id,revisionId,'DRAFT',time);
    return revisionId;
  }
  release(id) { const row=this.db.prepare('SELECT * FROM releases WHERE id=?').get(id); if(!row) throw new Problem(404,'This release was not found.'); const manifest=unpack(row.manifest); return {...row,manifest,bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')}; }
  listReleases() { return this.db.prepare('SELECT id,sha,actor,created_at,label FROM releases ORDER BY created_at DESC').all().map(row=>({...row,counts:this.release(row.id).manifest.coverage})); }
  audit(after=0,limit=100) { return this.db.prepare('SELECT * FROM audit WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1).map(row=>({...row,detail:unpack(row.detail)})); }
  backup(filename) { this.db.exec('PRAGMA wal_checkpoint(FULL)'); this.db.prepare('VACUUM INTO ?').run(resolve(filename)); return {filename:resolve(filename),sha256:digest(readFileSync(filename))}; }
  close() { this.db.close(); }
}
