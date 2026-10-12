import { DatabaseSync } from 'node:sqlite';
import { promises as fs, createReadStream, constants as FS } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA = 'lightdash.commissioning-workspace.v1';
export const VERSION = '1.0.0';
const OMIT_DIRS = new Set(['.git', '.venv', 'venv', 'node_modules', 'dbt_packages', 'target', 'logs', '.lightdash']);
const OMIT_FILES = new Set();
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw new TypeError('A complete JSON value is required.');
}
export function problem(message, status = 400, code = 'INVALID_INPUT') {
  return Object.assign(new Error(message), {status, code});
}
function text(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw problem(label + ' is required.');
  return value;
}
function identity(value, label = 'Identity') {
  text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(value)) throw problem(label + ' has unsupported characters.');
  return value;
}
export function relativeFile(value) {
  text(value, 'File path');
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value) ||
      value.split('/').some(p => !p || p === '.' || p === '..')) throw problem('Select a path inside the project.');
  return value;
}
function isExcluded(rel) {
  const parts = rel.split('/');
  const name = parts.at(-1);
  return parts.slice(0, -1).some(p => OMIT_DIRS.has(p)) || OMIT_FILES.has(name) || name === '.env' || name.startsWith('.env.');
}
function credentialFree(value, location = 'connection') {
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (/^(token|api[_-]?key|password|secret|authorization|access[_-]?token|refresh[_-]?token)$/i.test(key) && v != null && v !== '') {
      throw problem('Keep ' + location + '.' + key + ' in a host environment variable or private profile; enter its environment-variable name.');
    }
    if (v && typeof v === 'object') credentialFree(v, location + '.' + key);
  }
}
async function fileHash(filename) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); bytes += chunk.length; }
  return {bytes, sha256: hash.digest('hex')};
}
async function writeJSON(filename, value) {
  const body = JSON.stringify(value, null, 2) + '\n';
  await fs.mkdir(path.dirname(filename), {recursive: true, mode: 0o700});
  const temporary = filename + '.' + uuid() + '.tmp';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, filename);
  return {bytes: Buffer.byteLength(body), sha256: sha256(body)};
}
async function scan(root, {copyTo = null, excludeProfiles = false} = {}) {
  const entries = [], excluded = [];
  async function visit(rel) {
    const dirname = rel ? path.join(root, rel) : root;
    for (const item of (await fs.readdir(dirname, {withFileTypes: true})).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = rel ? rel + '/' + item.name : item.name;
      if ((item.isDirectory() && OMIT_DIRS.has(item.name)) || isExcluded(name) || (excludeProfiles && ['profiles.yml','profiles.yaml'].includes(item.name))) {
        excluded.push({path: name, reason: 'Host credentials or reproducible runtime output'}); continue;
      }
      const filename = path.join(root, name);
      if (item.isSymbolicLink()) throw problem('Source contains a symbolic link: ' + name + '. Select its actual project files.');
      if (item.isDirectory()) { await visit(name); continue; }
      if (!item.isFile()) throw problem('Source contains a non-file entry: ' + name);
      const before = await fs.stat(filename);
      let selected = filename;
      if (copyTo) {
        selected = path.join(copyTo, name);
        await fs.mkdir(path.dirname(selected), {recursive: true, mode: 0o700});
        await fs.copyFile(filename, selected, FS.COPYFILE_EXCL);
        await fs.chmod(selected, 0o600 | (before.mode & 0o111));
      }
      const digest = await fileHash(selected);
      const after = await fs.stat(filename);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || digest.bytes !== before.size) {
        throw problem('Project changed while reading ' + name + '. Reopen the source selection.', 409, 'SOURCE_CHANGED');
      }
      entries.push({path: name, ...digest, executable: Boolean(before.mode & 0o111)});
    }
  }
  await visit('');
  return {files: entries.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), excluded};
}
function compareFiles(left, right) {
  const a = new Map(left.map(f => [f.path, f])), b = new Map(right.map(f => [f.path, f]));
  return Array.from(new Set([...a.keys(), ...b.keys()])).sort().flatMap(p => {
    const before = a.get(p), after = b.get(p);
    if (before?.sha256 === after?.sha256 && before?.executable === after?.executable) return [];
    return [{path:p, change:!before?'ADDED':!after?'REMOVED':'CHANGED', before:before??null, after:after??null}];
  });
}
function parseRow(row) { return row ? JSON.parse(row.body) : null; }

export class CommissioningWorkspace {
  constructor(root, database, engine) { this.root = root; this.db = database; this.engine = engine; this.inflight = new Map(); }
  static async open(directory, {create = false, label = 'Lightdash commissioning', engine = null} = {}) {
    const absolute = path.resolve(directory);
    if (create) await fs.mkdir(absolute, {recursive:true, mode:0o700});
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw problem('Select an existing canonical workspace directory.');
    const root = await fs.realpath(absolute);
    const databasePath = path.join(root, 'commissioning.sqlite');
    const databaseStat = await fs.lstat(databasePath).catch(()=>null);
    if(databaseStat && (!databaseStat.isFile() || databaseStat.isSymbolicLink()))throw problem('Use this workspace’s regular SQLite file.');
    const exists = Boolean(databaseStat);
    if (!exists && !create) throw problem('This directory has no Lightdash commissioning workspace.',404,'WORKSPACE_NOT_FOUND');
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec('CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, base_edition_id TEXT NOT NULL REFERENCES editions(id), created_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS draft_files (draft_id TEXT NOT NULL REFERENCES drafts(id), path TEXT NOT NULL, content TEXT, removed INTEGER NOT NULL, bytes INTEGER, sha256 TEXT, executable INTEGER NOT NULL, PRIMARY KEY(draft_id,path));' +
      'CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);');
    if (!db.prepare('SELECT id FROM meta WHERE id=1').get()) {
      if (!create) { db.close(); throw problem('Workspace metadata is missing.'); }
      const metadata = {schema:SCHEMA, version:VERSION, id:uuid(), label:text(label,'Workspace name'), createdAt:now(), connection:{}, editionSettings:{projectDir:'.',profilesDir:'profiles',profile:'',target:'',includeProfileFiles:false}, source:null, baselineEditionId:null, selectedEditionId:null, draft:{id:null,baseEditionId:null,changedAt:null}};
      db.prepare('INSERT INTO meta(id,revision,body) VALUES(1,0,?)').run(JSON.stringify(metadata));
    }
    const ws = new CommissioningWorkspace(root, db, engine);
    if (ws.metadata().schema !== SCHEMA) { db.close(); throw problem('This workspace has a different schema.'); }
    for (const name of ['editions','operations','handover']) await fs.mkdir(path.join(root,name),{recursive:true,mode:0o700});
    await fs.chmod(databasePath,0o600);
    return ws;
  }
  close() { this.db.close(); }
  metadata() {
    const row=this.db.prepare('SELECT revision,body FROM meta WHERE id=1').get();
    return {...JSON.parse(row.body),revision:Number(row.revision)};
  }
  transaction(expectedRevision, mutate) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.metadata();
      if (expectedRevision !== undefined && (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision)!==current.revision)) throw problem('Workspace changed. Reload the current edition and preserve your draft.',409,'REVISION_CONFLICT');
      const next=mutate(current)??current;
      const revision=current.revision+1;
      delete next.revision;
      this.db.prepare('UPDATE meta SET revision=?,body=? WHERE id=1').run(revision,JSON.stringify(next));
      this.db.exec('COMMIT');
      return {...next,revision};
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async state() {
    const metadata=this.metadata();
    const editions=this.db.prepare('SELECT body FROM editions ORDER BY created_at,id').all().map(parseRow);
    const reviews=this.db.prepare('SELECT body FROM reviews ORDER BY created_at,id').all().map(parseRow);
    const operations=this.db.prepare('SELECT body FROM operations ORDER BY created_at DESC,id').all().map(parseRow).map(o=>({id:o.id,action:o.action,editionId:o.editionId,status:o.status,createdAt:o.createdAt,updatedAt:o.updatedAt,requestSha256:o.requestSha256,resultSummary:o.resultSummary??null}));
    const engine=this.engine?await this.engine.describeEngine():null;
    const drafts=this.db.prepare('SELECT d.id,d.base_edition_id AS baseEditionId,d.created_at AS createdAt,COUNT(f.path) AS changeCount FROM drafts d LEFT JOIN draft_files f ON f.draft_id=d.id GROUP BY d.id ORDER BY d.created_at DESC').all();
    const handovers=[];
    for(const item of await fs.readdir(path.join(this.root,'handover'),{withFileTypes:true})){
      if(!item.isDirectory()||!/^[a-f0-9-]{36}$/.test(item.name))continue;
      const directory=path.join(this.root,'handover',item.name);
      const read=async name=>{try{return JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
      const request=await read('request.json'),intent=request?null:await read('intent.json');
      const result=await read('result.json'),status=await read('status.json'),selection=request??intent;
      if(selection&&selection.id===item.name&&selection.workspaceId===metadata.id&&['lightdash.commissioning-handover-request.v1','lightdash.commissioning-handover-intent.v1'].includes(selection.schema))handovers.push({id:item.name,createdAt:selection.createdAt,workspaceRevision:request?.workspaceRevision??null,selectionPending:!request,state:request?(result?.state??status?.state??'PENDING'):'PENDING',includeOperatorPrivate:selection.includeOperatorPrivate,result,status});
    }
    handovers.sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
    return {metadata,editions,reviews,operations,drafts,handovers,engine,pendingOperationIds:[...this.inflight.keys()],root:this.root};
  }
  configure({label,connection,editionSettings},expectedRevision) {
    credentialFree(connection);
    return this.transaction(expectedRevision,current=>{
      if(label!==undefined) current.label=text(label,'Workspace name');
      if(connection!==undefined) { if(!connection||Array.isArray(connection)||typeof connection!=='object')throw problem('Connection must be an object.'); current.connection=connection; if(current.receiving&&Object.keys(connection).length)current.receiving={...current.receiving,connectionDetached:false,attachedAt:now()}; }
      if(editionSettings!==undefined) { credentialFree(editionSettings,'editionSettings'); current.editionSettings=editionSettings; }
      return current;
    });
  }
  edition(id) {
    identity(id,'Edition');
    const value=parseRow(this.db.prepare('SELECT body FROM editions WHERE id=?').get(id));
    if(!value)throw problem('Edition not found.',404,'EDITION_NOT_FOUND');
    return value;
  }
  async editionManifest(id) {
    this.edition(id);
    return JSON.parse(await fs.readFile(path.join(this.root,'editions',id,'manifest.json'),'utf8'));
  }
  async nativeEdition(id) {
    const edition=this.edition(id), metadata=this.metadata();
    const manifestPath=path.join(this.root,'editions',id,'manifest.json');
    const {includeProfileFiles,...settings}=metadata.editionSettings;
    return {...settings,id,directory:path.join(this.root,'editions',id,'source'),manifestFile:manifestPath,
      manifestSha256:edition.manifestSha256,sourceSha256:edition.sourceSha256};
  }
  async captureProject({projectRoot,label='Initial baseline',note='',operationId},expectedRevision) {
    identity(operationId,'Source operation');text(label,'Edition name');text(note,'Note',true);
    const originalMetadata=this.metadata(), selectedRevision=expectedRevision??originalMetadata.revision;
    const canonicalRoot=await fs.realpath(text(projectRoot,'Project directory'));
    const selection={projectRoot:canonicalRoot,label,note,settings:originalMetadata.editionSettings};
    const selectionSha256=sha256(canonical(selection));
    const prior=this.db.prepare('SELECT body FROM editions').all().map(parseRow).find(e=>e.sourceOperationId===operationId);
    if(prior) {
      if(prior.selectionSha256!==selectionSha256)throw problem('This source operation already names a different selection.',409,'OPERATION_CONFLICT');
      return {edition:prior,metadata:this.metadata(),replayed:true};
    }
    if(canonicalRoot===this.root || canonicalRoot.startsWith(this.root+path.sep) || this.root.startsWith(canonicalRoot+path.sep)) throw problem('Keep the source project and receiving workspace in separate directories.');
    const settings=originalMetadata.editionSettings, projectDir=settings.projectDir??'.';
    if(projectDir!=='.')relativeFile(projectDir);
    const projectFile=path.join(canonicalRoot,projectDir,'dbt_project.yml');
    if(!(await fs.stat(projectFile).catch(()=>null))?.isFile())throw problem('The selected source must contain its actual dbt_project.yml.');
    const id=uuid(), destination=path.join(this.root,'editions',id);
    await fs.mkdir(path.join(destination,'source'),{recursive:true,mode:0o700});
    try {
      const captured=await scan(canonicalRoot,{copyTo:path.join(destination,'source'),excludeProfiles:!settings.includeProfileFiles});
      const sourceSha256=sha256(canonical(captured.files));
      const manifest={schema:'lightdash.source-edition.v1',id,createdAt:now(),files:captured.files,excluded:captured.excluded,sourceSha256};
      const saved=await writeJSON(path.join(destination,'manifest.json'),manifest);
      const edition={id,label,note,createdAt:manifest.createdAt,kind:'BASELINE',fileCount:captured.files.length,bytes:captured.files.reduce((n,f)=>n+f.bytes,0),manifestSha256:saved.sha256,sourceSha256,sourceOperationId:operationId,originalProjectRoot:canonicalRoot,selectionSha256};
      const metadata=this.transaction(selectedRevision,current=>{
        this.db.prepare('INSERT INTO editions(id,created_at,body) VALUES(?,?,?)').run(id,edition.createdAt,JSON.stringify(edition));
        current.source={projectRoot:canonicalRoot,observedAt:manifest.createdAt,operationId};
        current.baselineEditionId=id;current.selectedEditionId=id;return current;
      });
      return {edition,metadata};
    } catch(error) {
      if(!this.db.prepare('SELECT id FROM editions WHERE id=?').get(id))await fs.rm(destination,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }
  selectEditions({baselineId,selectedId},expectedRevision) {
    if(baselineId!==undefined)this.edition(baselineId);
    if(selectedId!==undefined)this.edition(selectedId);
    return this.transaction(expectedRevision,current=>{
      if(baselineId!==undefined)current.baselineEditionId=baselineId;
      if(selectedId!==undefined)current.selectedEditionId=selectedId;
      return current;
    });
  }
  async createDraft(editionId,expectedRevision) {
    const edition=this.edition(editionId), id=uuid(), createdAt=now();
    const metadata=this.transaction(expectedRevision,current=>{
      this.db.prepare('INSERT INTO drafts(id,base_edition_id,created_at) VALUES(?,?,?)').run(id,edition.id,createdAt);
      current.draft={id,baseEditionId:edition.id,changedAt:createdAt,retainedPreviousDraft:current.draft.id??null};return current;
    });
    return {metadata,draft:await this.draftManifest()};
  }
  selectDraft(id,expectedRevision) {
    identity(id,'Draft');
    return this.transaction(expectedRevision,current=>{
      const draft=this.db.prepare('SELECT * FROM drafts WHERE id=?').get(id);
      if(!draft)throw problem('Draft not found.',404,'DRAFT_NOT_FOUND');
      current.draft={id,baseEditionId:draft.base_edition_id,changedAt:now(),retainedPreviousDraft:current.draft.id??null};return current;
    });
  }
  async draftManifest({expectedDraftId}={}) {
    const metadata=this.metadata();
    if(expectedDraftId!==undefined&&expectedDraftId!==metadata.draft.id)throw problem('The selected draft changed. Reopen its complete source inventory.',409,'DRAFT_CHANGED');
    if(!metadata.draft.id)return null;
    const changes=this.db.prepare('SELECT path,removed,bytes,sha256,executable FROM draft_files WHERE draft_id=?').all(metadata.draft.id);
    const baseline=await this.editionManifest(metadata.draft.baseEditionId);
    const files=new Map(baseline.files.map(f=>[f.path,f]));
    for(const item of changes) {
      if(item.removed)files.delete(item.path);
      else files.set(item.path,{path:item.path,bytes:Number(item.bytes),sha256:item.sha256,executable:Boolean(item.executable)});
    }
    const selected=Array.from(files.values()).sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return {id:metadata.draft.id,revision:metadata.revision,files:selected,excluded:baseline.excluded,sourceSha256:sha256(canonical(selected)),changes:compareFiles(baseline.files,selected),baseEditionId:metadata.draft.baseEditionId};
  }
  async editDraft({path:filename,content,remove=false,expectedFileSha256,expectedDraftId},expectedRevision) {
    const rel=relativeFile(filename);
    if(isExcluded(rel))throw problem('Host credentials and generated runtime files stay outside source editions.');
    const current=this.metadata();
    if(!current.draft.id)throw problem('Create a working draft from an existing edition.');
    if(expectedDraftId!==undefined&&expectedDraftId!==current.draft.id)throw problem('The selected draft changed. Your unsaved complete file is still in the editor.',409,'DRAFT_CHANGED');
    if(['profiles.yml','profiles.yaml'].includes(path.posix.basename(rel))&&!current.editionSettings.includeProfileFiles)throw problem('This source selection keeps private profiles on the host.');
    const baseline=await this.editionManifest(current.draft.baseEditionId), baseFile=baseline.files.find(f=>f.path===rel);
    if(!remove)text(content,'Complete file contents',true);
    const metadata=this.transaction(expectedRevision,meta=>{
      if(meta.draft.id!==current.draft.id)throw problem('The selected draft changed.',409,'REVISION_CONFLICT');
      const prior=this.db.prepare('SELECT * FROM draft_files WHERE draft_id=? AND path=?').get(meta.draft.id,rel);
      const beforeSha=prior?(prior.removed?null:prior.sha256):(baseFile?.sha256??null);
      if(expectedFileSha256!==undefined&&expectedFileSha256!==beforeSha)throw problem('That source file changed. Reload it before saving.',409,'SOURCE_CHANGED');
      if(remove&&beforeSha===null)throw problem('The selected source file does not exist.',404,'SOURCE_NOT_FOUND');
      this.db.prepare('INSERT INTO draft_files(draft_id,path,content,removed,bytes,sha256,executable) VALUES(?,?,?,?,?,?,?) ON CONFLICT(draft_id,path) DO UPDATE SET content=excluded.content,removed=excluded.removed,bytes=excluded.bytes,sha256=excluded.sha256,executable=excluded.executable').run(meta.draft.id,rel,remove?null:content,remove?1:0,remove?null:Buffer.byteLength(content),remove?null:sha256(content),baseFile?.executable?1:0);
      meta.draft.changedAt=now();return meta;
    });
    return {metadata,file:remove?null:{path:rel,bytes:Buffer.byteLength(content),sha256:sha256(content)}};
  }
  async sealDraft({label,note='',expectedDraftId},expectedRevision) {
    text(label,'Edition name');text(note,'Note',true);
    const current=this.metadata();
    if(!current.draft.id)throw problem('Create a draft first.');
    if(expectedDraftId!==undefined&&expectedDraftId!==current.draft.id)throw problem('Select the intended draft before sealing.',409,'DRAFT_CHANGED');
    const selectedRevision=expectedRevision??current.revision;
    const changes=this.db.prepare('SELECT * FROM draft_files WHERE draft_id=? ORDER BY path').all(current.draft.id);
    const id=uuid(), destination=path.join(this.root,'editions',id), source=path.join(destination,'source');
    await fs.mkdir(source,{recursive:true,mode:0o700});
    try {
      const baseline=this.edition(current.draft.baseEditionId);
      const original=await scan(path.join(this.root,'editions',baseline.id,'source'),{copyTo:source});
      if(sha256(canonical(original.files))!==baseline.sourceSha256)throw problem('The baseline edition changed. Recover its original source first.',409,'SOURCE_CHANGED');
      for(const item of changes.filter(f=>f.removed))await fs.unlink(path.join(source,relativeFile(item.path))).catch(e=>{if(e.code!=='ENOENT')throw e;});
      for(const item of changes.filter(f=>!f.removed)){
        const target=path.join(source,relativeFile(item.path));
        await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
        await fs.writeFile(target,item.content,{mode:0o600|(item.executable?0o100:0)});
      }
      const captured=await scan(source), sourceSha256=sha256(canonical(captured.files));
      const manifest={schema:'lightdash.source-edition.v1',id,createdAt:now(),files:captured.files,excluded:(await this.editionManifest(baseline.id)).excluded,sourceSha256};
      const saved=await writeJSON(path.join(destination,'manifest.json'),manifest);
      const edition={id,label,note,createdAt:manifest.createdAt,kind:'CANDIDATE',parentEditionId:baseline.id,draftId:current.draft.id,fileCount:captured.files.length,bytes:captured.files.reduce((n,f)=>n+f.bytes,0),manifestSha256:saved.sha256,sourceSha256};
      const metadata=this.transaction(selectedRevision,meta=>{
        this.db.prepare('INSERT INTO editions(id,created_at,body) VALUES(?,?,?)').run(id,edition.createdAt,JSON.stringify(edition));
        meta.selectedEditionId=id;return meta;
      });
      return {metadata,edition};
    } catch(error) {
      if(!this.db.prepare('SELECT id FROM editions WHERE id=?').get(id))await fs.rm(destination,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }
  async compare(baselineId,candidateId) {
    const [baseline,candidate]=await Promise.all([this.editionManifest(baselineId),this.editionManifest(candidateId)]);
    return {baselineId,candidateId,baselineSha256:baseline.sourceSha256,candidateSha256:candidate.sourceSha256,changes:compareFiles(baseline.files,candidate.files)};
  }
  async readSource({editionId,draft=false,expectedDraftId,path:filename}) {
    const rel=relativeFile(filename);let draftId=null;
    if(isExcluded(rel))throw problem('This is a host/runtime file.');
    if(draft) {
      const selected=this.metadata().draft;
      if(expectedDraftId!==undefined&&expectedDraftId!==selected.id)throw problem('The selected draft changed. Reopen the original file in its draft.',409,'DRAFT_CHANGED');
      if(!selected.id)throw problem('Create a draft first.');
      draftId=selected.id;editionId=selected.baseEditionId;
      const override=this.db.prepare('SELECT * FROM draft_files WHERE draft_id=? AND path=?').get(selected.id,rel);
      if(override){
        if(override.removed)throw problem('This file was removed in the current draft.',404,'SOURCE_NOT_FOUND');
        return {path:rel,draftId,editionId,content:override.content,bytes:Number(override.bytes),sha256:override.sha256};
      }
      editionId=selected.baseEditionId;
    }
    this.edition(editionId);
    const root=path.join(this.root,'editions',editionId,'source'), target=path.join(root,rel), real=await fs.realpath(target);
    if(!real.startsWith(root+path.sep))throw problem('The selected file is outside this source edition.');
    const stat=await fs.stat(real);if(!stat.isFile())throw problem('Select a regular source file.');
    return {path:rel,draftId,editionId,absolutePath:real,...await fileHash(real)};
  }
  saveReview({baselineId,candidateId,reviewedBy,note,decisions=[]},expectedRevision) {
    const baseline=this.edition(baselineId), candidate=this.edition(candidateId), originalMetadata=this.metadata();
    const selectedRevision=expectedRevision??originalMetadata.revision;
    if(!Array.isArray(decisions))throw problem('Source decisions must be an array.');
    const review={id:uuid(),createdAt:now(),baselineId,candidateId,baselineSha256:baseline.sourceSha256,candidateSha256:candidate.sourceSha256,connectionSha256:sha256(canonical(originalMetadata.connection)),reviewedBy:text(reviewedBy,'Reviewer'),note:text(note,'Review note'),decisions};
    const metadata=this.transaction(selectedRevision,current=>{this.db.prepare('INSERT INTO reviews(id,created_at,body) VALUES(?,?,?)').run(review.id,review.createdAt,JSON.stringify(review));return current;});
    return {metadata,review};
  }
  operation(id) {
    identity(id,'Operation');
    const operation=parseRow(this.db.prepare('SELECT body FROM operations WHERE id=?').get(id));
    if(!operation)throw problem('Operation not found.',404,'OPERATION_NOT_FOUND');
    return operation;
  }
  async plan({operationId,action,editionId,input={}},expectedRevision) {
    if(!this.engine)throw problem('Install the selected original native integration before planning an operation.',503,'ENGINE_UNAVAILABLE');
    identity(operationId,'Operation');text(action,'Action');this.edition(editionId);
    const metadata=this.metadata(), selectedRevision=expectedRevision??metadata.revision, edition=await this.nativeEdition(editionId);
    const request={operationId,action,connection:metadata.connection,edition,input};
    const requestSha256=sha256(canonical(request));
    const existing=parseRow(this.db.prepare('SELECT body FROM operations WHERE id=?').get(operationId));
    if(existing){if(existing.requestSha256!==requestSha256)throw problem('This operation already has a different reviewed input.',409,'OPERATION_CONFLICT');return {operation:existing,metadata,replayed:true};}
    const planned=await this.engine.planOperation(request);
    const operation={id:operationId,action,editionId,input,requestSha256,connectionSha256:sha256(canonical(metadata.connection)),sourceSha256:edition.sourceSha256,plan:planned,status:'PLANNED',createdAt:now(),updatedAt:now()};
    try {
      const saved=this.transaction(selectedRevision,current=>{
        this.db.prepare('INSERT INTO operations(id,request_sha256,created_at,updated_at,status,body) VALUES(?,?,?,?,?,?)').run(operationId,requestSha256,operation.createdAt,operation.updatedAt,operation.status,JSON.stringify(operation));return current;
      });
      return {operation,metadata:saved};
    } catch(error) {
      const raced=parseRow(this.db.prepare('SELECT body FROM operations WHERE id=?').get(operationId));
      if(raced?.requestSha256===requestSha256)return {operation:raced,metadata:this.metadata(),replayed:true};
      if(raced)throw problem('This operation was concurrently bound to a different selection.',409,'OPERATION_CONFLICT');
      throw error;
    }
  }
  storeOperation(operation) {
    operation.updatedAt=now();
    let saved=operation;
    this.transaction(undefined,current=>{
      const prior=this.operation(operation.id);
      if(prior.requestSha256!==operation.requestSha256)throw problem('The operation input changed.',409,'OPERATION_CONFLICT');
      if(['SUCCEEDED','FAILED'].includes(prior.status)&&['PLANNED','RUNNING','BUSY','INTERRUPTED'].includes(operation.status)){saved=prior;return current;}
      const updated=this.db.prepare('UPDATE operations SET updated_at=?,status=?,body=? WHERE id=? AND request_sha256=?').run(operation.updatedAt,operation.status,JSON.stringify(operation),operation.id,operation.requestSha256);
      if(Number(updated.changes)!==1)throw problem('The operation could not be retained.',409,'OPERATION_CONFLICT');
      return current;
    });
    return saved;
  }
  async execute(operationId,{inspect=false}={}) {
    if(this.inflight.has(operationId))return this.inflight.get(operationId);
    const promise=(async()=>{
      const operation=this.operation(operationId),terminal=['SUCCEEDED','FAILED'].includes(operation.status);
      if(!inspect&&terminal)return {operation,replayed:true};
      if(inspect&&terminal){
        const journal=path.join(this.root,'operations',operationId,'native','plan.json');
        let info;try{info=await fs.lstat(journal);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(!info){
          operation.inspection={observedAt:now(),available:false,code:'ORIGINAL_NATIVE_JOURNAL_UNAVAILABLE',message:'The original private execution journal is not present in this workspace. The completed native result is retained. Attach the original journal before provider reconciliation.'};
          return {operation:this.storeOperation(operation),replayed:true,inspection:operation.inspection};
        }
        if(!info.isFile()||info.isSymbolicLink())throw problem('The original native execution journal must be its regular file.',409,'NATIVE_JOURNAL_CHANGED');
      }
      if(this.metadata().receiving?.connectionDetached)throw problem('Configure the receiving host before executing or inspecting a native operation.',409,'RECEIVING_HOST_DETACHED');
      if(!this.engine)throw problem('The selected native integration is unavailable.',503,'ENGINE_UNAVAILABLE');
      if(!inspect){
        const metadata=this.metadata();
        if(sha256(canonical(metadata.connection))!==operation.connectionSha256)throw problem('Connection selection changed. Retain this operation and plan against the current target.',409,'CONNECTION_CHANGED');
        const current=await scan(path.join(this.root,'editions',operation.editionId,'source'));
        if(sha256(canonical(current.files))!==operation.sourceSha256)throw problem('The retained source edition changed. Recover its original complete files before execution.',409,'SOURCE_CHANGED');
      }
      const operationDir=path.join(this.root,'operations',operationId);
      await fs.mkdir(operationDir,{recursive:true,mode:0o700});
      await writeJSON(path.join(operationDir,'workspace-operation.json'),{id:operation.id,requestSha256:operation.requestSha256,plan:operation.plan});
      const fn=inspect?this.engine.inspectOperation:this.engine.executeOperation;
      if(typeof fn!=='function')throw problem('The selected engine does not expose this original operation.');
      operation.status=inspect?operation.status:'RUNNING';this.storeOperation(operation);
      try{
        const result=await fn({workspaceDir:this.root,operationDir,operation:operation.plan,refresh:inspect});
        if(inspect&&terminal&&(result.status??result.state)==='PLANNED'&&result.dispatched===false){
          operation.inspection={observedAt:now(),available:false,code:'ORIGINAL_NATIVE_JOURNAL_UNAVAILABLE',message:'The native inspector could not find the original execution journal. The completed native result is retained.'};
          return {operation:this.storeOperation(operation),replayed:true,inspection:operation.inspection};
        }
        if(inspect)operation.inspection={observedAt:now(),available:true};
        operation.nativeResult=result;
        operation.status=result.status??result.state??'RETURNED';
        operation.resultSummary=result.summary??result.message??null;
        await writeJSON(path.join(operationDir,'workspace-result.json'),{operationId,requestSha256:operation.requestSha256,returnedAt:now(),result});
        const saved=this.storeOperation(operation);
        return {operation:saved};
      }catch(error){
        operation.status='INTERRUPTED';
        operation.lastError={message:String(error.message??error),code:error.code??null,observedAt:now()};
        await writeJSON(path.join(operationDir,'workspace-interruption.json'),operation.lastError);
        this.storeOperation(operation);throw error;
      }
    })();
    this.inflight.set(operationId,promise);
    try{return await promise;}catch(error){
      try{const retained=this.operation(operationId);retained.lastError={message:String(error.message??error),code:error.code??null,observedAt:now()};this.storeOperation(retained);}catch{}
      throw error;
    }finally{this.inflight.delete(operationId);}
  }
  async contentExports(operationId) {
    const operation=this.operation(operationId), result=operation.nativeResult;
    if(!Array.isArray(result?.contentExports))return [];
    const originalRoot=result.artifactManifest?.path?path.dirname(result.artifactManifest.path):null;
    const root=path.join(this.root,'operations',operationId,'native');
    const rows=[];
    for(const selected of result.contentExports){
      try{
        if(!originalRoot)throw problem('The original native artifact root is missing.');
        const rebase=filename=>{
          if(typeof filename!=='string'||!path.isAbsolute(filename))throw problem('The original content path is missing.');
          const rel=path.relative(originalRoot,filename);
          if(!rel||rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))throw problem('This export is outside its original native operation.');
          return path.join(root,relativeFile(rel.split(path.sep).join('/')));
        };
        const directory=rebase(selected.directory),manifestFile=rebase(selected.manifestFile);
        const actual=await fileHash(manifestFile);
        if(actual.sha256!==selected.manifestSha256)throw problem('The original content manifest changed.',409,'CONTENT_CHANGED');
        if(!(await fs.stat(directory)).isDirectory())throw problem('The complete original export directory is missing.');
        rows.push({directory,manifestFile,manifestSha256:selected.manifestSha256,sourceProjectUuid:selected.sourceProjectUuid,
          ...(selected.sourceOperationId?{sourceOperationId:selected.sourceOperationId}:{sourceEditionId:selected.sourceEditionId})});
      }catch(error){rows.push({error:{message:error.message,code:error.code??null},original:selected});}
    }
    return rows;
  }
  async exportSnapshot() {
    const state=await this.state();
    const editions=[];
    for(const edition of state.editions)editions.push({...edition,manifest:await this.editionManifest(edition.id)});
    const operations=this.db.prepare('SELECT body FROM operations ORDER BY created_at,id').all().map(parseRow);
    const drafts=this.db.prepare('SELECT * FROM drafts ORDER BY created_at,id').all().map(d=>({...d,files:this.db.prepare('SELECT * FROM draft_files WHERE draft_id=? ORDER BY path').all(d.id)}));
    return {schema:'lightdash.commissioning-handover.v1',exportedAt:now(),metadata:state.metadata,editions,reviews:state.reviews,drafts,operations,engine:state.engine};
  }
  async saveSnapshot() {
    const snapshot=await this.exportSnapshot();
    const id=uuid(), destination=path.join(this.root,'handover',id);
    await fs.mkdir(destination,{recursive:true,mode:0o700});
    const file=path.join(destination,'workspace.json'), digest=await writeJSON(file,snapshot);
    return {id,directory:destination,file,...digest,snapshot};
  }
}
