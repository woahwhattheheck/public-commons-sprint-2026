// MIT. Private operator profiles and exact native request/result history.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const CONSOLE_SCHEMA = 'stellar-forge.merchant-operator-console.v1';
import { canonical, digest, fail,
  plainConsoleRecord as plain, consoleIdentifier as id, consoleRecordTitle as title, consoleRevision as revision, consoleSha256 as sha } from './records.mjs';
export { canonical, digest, fail } from './records.mjs';
import { installWorkflowTables, archiveWorkflowRows, validateWorkflowRows, importWorkflowRows, reserveWorkflowNative, settleWorkflowNative } from './workflow-records.mjs';
import { installWorkflowRecipeTables, archiveWorkflowRecipeRows, validateWorkflowRecipeRows, importWorkflowRecipeRows } from './workflow-recipes.mjs';
import { installSeriesTables, archiveSeriesRows, validateSeriesRows, importSeriesRows } from './workflow-series-records.mjs';
import { ARCHIVE_SCHEMA, HOST_BINDING_SCHEMA, validateConsoleArchive } from './archive-contract.mjs';
export { ARCHIVE_SCHEMA, HOST_BINDING_SCHEMA, validateConsoleArchive } from './archive-contract.mjs';
const json = value => JSON.stringify(value);
const parse = value => JSON.parse(value);
const now = () => new Date().toISOString();
export class MerchantConsoleStore {
  constructor(directory) {
    this.directory = resolve(directory);this.dispatcherId=randomUUID();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const st = lstatSync(this.directory);
    if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(this.directory) !== this.directory ||
        process.platform !== 'win32' && (st.mode & 0o077 || process.getuid && st.uid !== process.getuid()))
      throw fail('CONSOLE_DIRECTORY', 'Use a private owned operator directory.');
    const path = join(this.directory, 'operator.sqlite');
    try { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw fail('CONSOLE_DATABASE', 'Use the original operator database.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS drafts (id TEXT NOT NULL, revision INTEGER NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), value TEXT NOT NULL, PRIMARY KEY(id,revision))',
      'CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), value TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS drafts_profile ON drafts(profile_id,id,revision)',
      'CREATE INDEX IF NOT EXISTS calls_profile ON calls(profile_id,id)',
      'CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS imports (sha TEXT PRIMARY KEY, profile_id TEXT NOT NULL, imported_at TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS host_bindings (profile_id TEXT NOT NULL REFERENCES profiles(id), revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile_id,revision))'
    ].join(';'));
    installWorkflowTables(this.db);
    installWorkflowRecipeTables(this.db);
    installSeriesTables(this.db);
    this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('schema', CONSOLE_SCHEMA);
    this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('id', randomUUID());
    if (this.db.prepare('SELECT value FROM metadata WHERE key=?').get('schema').value !== CONSOLE_SCHEMA)
      throw fail('CONSOLE_VERSION', 'Use the matching operator workspace version.');
    this.id = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('id').value;
  }
  transaction(fn) {
    const depth=this.transactionDepth??0,savepoint='console_nested_'+depth;
    this.db.exec(depth?'SAVEPOINT '+savepoint:'BEGIN IMMEDIATE');this.transactionDepth=depth+1;
    try { const value=fn();this.db.exec(depth?'RELEASE SAVEPOINT '+savepoint:'COMMIT');return value; }
    catch (error) {
      try {
        this.db.exec(depth ? 'ROLLBACK TO SAVEPOINT ' + savepoint : 'ROLLBACK');
        if (depth) this.db.exec('RELEASE SAVEPOINT ' + savepoint);
      } catch (rollbackError) {
        // SQLite may already have rolled back after a full disk or an I/O error.
        // Preserve the operation failure and retain cleanup details for callers.
        if (error && (typeof error === 'object' || typeof error === 'function')) {
          try { Object.defineProperty(error, 'rollbackError', { value: rollbackError, configurable: true }); }
          catch { /* A frozen thrown value must retain its original identity. */ }
        }
      }
      throw error;
    }
    finally{this.transactionDepth=depth;}
  }
  profiles() {
    return this.db.prepare('SELECT value FROM profiles ORDER BY id').all().map(row => parse(row.value));
  }
  profile(profileId) {
    const row = this.db.prepare('SELECT value FROM profiles WHERE id=?').get(id(profileId));
    if (!row) throw fail('CONSOLE_PROFILE_NOT_FOUND', 'Select a saved operator profile.', 404);
    return parse(row.value);
  }
  hostBindings(profileId) {
    this.profile(profileId);
    return this.db.prepare('SELECT value FROM host_bindings WHERE profile_id=? ORDER BY revision').all(profileId).map(row=>parse(row.value));
  }
  hostBinding(profileId, selectedRevision) {
    this.profile(profileId);
    const row=this.db.prepare('SELECT value FROM host_bindings WHERE profile_id=? AND revision=?').get(profileId,revision(selectedRevision));
    if(!row)throw fail('CONSOLE_HOST_BINDING_NOT_FOUND','Select a retained host-binding revision.',404);
    return parse(row.value);
  }
  #retainHostBinding(profile, origin) {
    const existing=this.db.prepare('SELECT value FROM host_bindings WHERE profile_id=? AND revision=?').get(profile.id,profile.revision);
    if(existing) {
      const value=parse(existing.value);
      if(value.hostFingerprint!==profile.hostFingerprint||canonical(value.host)!==canonical(profile.host))
        throw fail('CONSOLE_HOST_BINDING_CONFLICT','This host-binding revision already retains a different host.');
      return value;
    }
    const body={schema:HOST_BINDING_SCHEMA,profileId:profile.id,revision:profile.revision,workspaceId:this.id,
      recordedAt:now(),origin,hostFingerprint:profile.hostFingerprint,host:profile.host};
    const value={...body,bindingSha256:digest(canonical(body))};
    this.db.prepare('INSERT INTO host_bindings VALUES (?,?,?)').run(profile.id,profile.revision,json(value));
    return value;
  }
  #mergeHostBindings(localProfile, incomingProfile, bindings) {
    let added=0;
    for(const binding of bindings) {
      const row=this.db.prepare('SELECT value FROM host_bindings WHERE profile_id=? AND revision=?').get(localProfile.id,binding.revision);
      if(row) {
        if(canonical(parse(row.value))!==canonical(binding))
          throw fail('CONSOLE_IMPORT_CONFLICT','An immutable host-binding revision has conflicting contents.');
      } else {
        this.db.prepare('INSERT INTO host_bindings VALUES (?,?,?)').run(localProfile.id,binding.revision,json(binding));
        added++;
      }
    }
    if(!bindings.length||(!added&&localProfile.bindingRevision!==undefined))return localProfile;
    const nextRevision=revision(Math.max(localProfile.revision,incomingProfile.revision,...bindings.map(value=>value.revision))+1);
    const value={...localProfile,revision:nextRevision,updatedAt:now()};
    if(value.bindingRevision===undefined) {
      const original=this.hostBindings(localProfile.id).filter(binding=>
        binding.hostFingerprint===localProfile.hostFingerprint&&canonical(binding.host)===canonical(localProfile.host)).at(-1);
      value.bindingRevision=original?.revision??nextRevision;
      if(!original)this.#retainHostBinding(value,'LEGACY_PROFILE');
    }
    this.db.prepare('UPDATE profiles SET revision=?,value=? WHERE id=?').run(value.revision,json(value),value.id);
    return value;
  }
  saveProfile(input, host) {
    const profileId = id(input.id ?? randomUUID());
    const name = title(input.name);
    if (!Array.isArray(input.favorites ?? [])) throw fail('CONSOLE_FAVORITES', 'Choose tool names from the current catalog.', 400);
    const favorites = [...new Set(input.favorites ?? [])];
    if (favorites.length > 200 ||
        favorites.some(value => typeof value !== 'string' || !/^[-A-Za-z0-9_.]{1,128}$/.test(value)))
      throw fail('CONSOLE_FAVORITES', 'Choose tool names from the current catalog.', 400);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT value FROM profiles WHERE id=?').get(profileId);
      const old = row ? parse(row.value) : null;
      if (old && old.revision !== revision(input.expectedRevision))
        throw fail('CONSOLE_REVISION_CONFLICT', 'The profile changed. Reopen its current revision.');
      if (!old && input.expectedRevision !== undefined) throw fail('CONSOLE_REVISION_CONFLICT', 'Create this profile without a prior revision.');
      const value = { id: profileId, name, revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? now(), updatedAt: now(),
        hostFingerprint: old?.hostFingerprint ?? host.configurationFingerprint,
        host: old?.host ?? host, favorites,
        ...(old?.bindingRevision!==undefined?{bindingRevision:old.bindingRevision}:!old?{bindingRevision:1}:{}),
        ...(old?.previousBinding?{previousBinding:old.previousBinding}:{}) };
      this.db.prepare('INSERT INTO profiles(id,revision,value) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value')
        .run(profileId, value.revision, json(value));
      if(!old)this.#retainHostBinding(value,'PROFILE_CREATED');
      return value;
    });
  }
  bindProfile(input, host) {
    return this.transaction(() => {
      const old = this.profile(input.id);
      if (old.revision !== revision(input.expectedRevision)) throw fail('CONSOLE_REVISION_CONFLICT', 'Reopen the current profile revision.');
      if (sha(input.expectedHostFingerprint) !== host.configurationFingerprint)
        throw fail('CONSOLE_HOST_CHANGED', 'Inspect the current host configuration before binding.');
      if(input.expectedCompositionFingerprint!==undefined&&sha(input.expectedCompositionFingerprint)!==host.composition?.fingerprint)
        throw fail('CONSOLE_HOST_CHANGED','Refresh the displayed tool and provider composition before rebinding.');
      if(!this.hostBindings(old.id).length)this.#retainHostBinding(old,'LEGACY_PROFILE');
      const value = { ...old, revision: old.revision + 1, bindingRevision:old.revision+1, updatedAt: now(),
        hostFingerprint: host.configurationFingerprint, host,
        previousBinding: { hostFingerprint: old.hostFingerprint, revision: old.bindingRevision??old.revision } };
      this.db.prepare('UPDATE profiles SET revision=?,value=? WHERE id=?').run(value.revision, json(value), value.id);
      this.#retainHostBinding(value,'PROFILE_BOUND');
      return value;
    });
  }
  drafts(profileId) {
    this.profile(profileId);
    return this.db.prepare('SELECT d.value FROM drafts d JOIN (SELECT id,MAX(revision) AS revision FROM drafts WHERE profile_id=? GROUP BY id) latest ON d.id=latest.id AND d.revision=latest.revision ORDER BY d.id')
      .all(profileId).map(row => parse(row.value));
  }
  draft(draftId, selectedRevision) {
    const row = selectedRevision === undefined
      ? this.db.prepare('SELECT value FROM drafts WHERE id=? ORDER BY revision DESC LIMIT 1').get(id(draftId))
      : this.db.prepare('SELECT value FROM drafts WHERE id=? AND revision=?').get(id(draftId), revision(selectedRevision));
    if (!row) throw fail('CONSOLE_DRAFT_NOT_FOUND', 'Select a saved request draft.', 404);
    return parse(row.value);
  }
  saveDraft(input, definition) {
    if (!plain(input.arguments)) throw fail('CONSOLE_ARGUMENTS', 'Supply a JSON object of native tool arguments.', 400);
    if (!definition || definition.name !== input.tool) throw fail('CONSOLE_TOOL_UNAVAILABLE', 'Select a configured native tool.', 400);
    this.profile(input.profileId);
    const draftId = id(input.id ?? randomUUID()), name = title(input.name), argumentsJson = json(input.arguments);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT value FROM drafts WHERE id=? ORDER BY revision DESC LIMIT 1').get(draftId);
      const old = row ? parse(row.value) : null;
      if (old && (old.profileId !== input.profileId || old.revision !== revision(input.expectedRevision)))
        throw fail('CONSOLE_REVISION_CONFLICT', 'Reopen the current saved request revision.');
      if (!old && input.expectedRevision !== undefined) throw fail('CONSOLE_REVISION_CONFLICT', 'Create this request without a prior revision.');
      const value = { id: draftId, profileId: input.profileId, name, revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? now(), updatedAt: now(), tool: input.tool,
        ...(input.recoveryOf ? { recoveryOf: id(input.recoveryOf) } : old?.recoveryOf ? { recoveryOf: old.recoveryOf } : {}),
        toolSchemaSha256: digest(canonical(definition)), argumentsJson, argumentsSha256: digest(argumentsJson) };
      this.db.prepare('INSERT INTO drafts(id,revision,profile_id,value) VALUES (?,?,?,?)')
        .run(draftId, value.revision, input.profileId, json(value));
      return value;
    });
  }
  calls(profileId) {
    this.profile(profileId);
    return this.db.prepare('SELECT value FROM calls WHERE profile_id=? ORDER BY id').all(profileId)
      .map(row => parse(row.value)).sort((a,b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  }
  call(callId) {
    const row = this.db.prepare('SELECT value FROM calls WHERE id=?').get(id(callId));
    if (!row) throw fail('CONSOLE_CALL_NOT_FOUND', 'Select an original saved request.', 404);
    return parse(row.value);
  }
  reserve(input, draft, host, definition, workflowGuard) {
    return this.transaction(() => {
      const callId = id(input.id), profile = this.profile(input.profileId);
      if (draft.profileId !== profile.id) throw fail('CONSOLE_DRAFT_PROFILE', 'Select a request from this profile.');
      const request = { id: callId, profileId: profile.id, draftId: draft.id, draftRevision: draft.revision,
        tool: draft.tool, toolSchemaSha256: draft.toolSchemaSha256, argumentsJson: draft.argumentsJson,
        argumentsSha256: draft.argumentsSha256, hostFingerprint: sha(input.expectedHostFingerprint) };
      const requestSha256 = digest(canonical(request));
      const prior = this.db.prepare('SELECT value FROM calls WHERE id=?').get(callId);
      if (prior) {
        const value = parse(prior.value);
        if (value.requestSha256 !== requestSha256) throw fail('CONSOLE_REQUEST_CONFLICT', 'This saved call ID belongs to different original arguments.');
        return { existing: true, value };
      }
      if (profile.hostFingerprint !== host.configurationFingerprint ||
          input.expectedHostFingerprint !== host.configurationFingerprint)
        throw fail('CONSOLE_HOST_CHANGED', 'Review and bind the profile to this host before running a saved request.');
      if (digest(canonical(definition)) !== draft.toolSchemaSha256)
        throw fail('CONSOLE_TOOL_CHANGED', 'Review the current native tool schema and save a new draft revision.');
      reserveWorkflowNative(this.db,this.id,this.dispatcherId,request,workflowGuard);
      const value = { ...request, workspaceId: this.id, requestSha256, state: 'RUNNING', startedAt: now(), completedAt: null,
        resultJson: null, resultSha256: null, error: null, origin: 'THIS_WORKSPACE' };
      this.db.prepare('INSERT INTO calls(id,profile_id,value) VALUES (?,?,?)').run(callId, profile.id, json(value));
      return { existing: false, value };
    });
  }
  noteWorkflowCallSettled(callId){return this.transaction(()=>settleWorkflowNative(this.db,this.id,callId));}
  finish(callId, result, error) {
    return this.transaction(() => {
      const old = this.call(callId);
      if (old.state !== 'RUNNING') return old;
      const resultJson = error ? null : json(result ?? null);
      const value = { ...old, state: error ? 'FAILED' : 'COMPLETE', completedAt: now(), resultJson,
        resultSha256: resultJson === null ? null : digest(resultJson),
        error: error ? { code: error.code ?? 'TOOL_ERROR', message: error.message ?? String(error) } : null };
      this.db.prepare('UPDATE calls SET value=? WHERE id=?').run(json(value), old.id);
      return value;
    });
  }
  deliveries(profileId) {
    this.profile(profileId);
    return this.db.prepare('SELECT value FROM deliveries WHERE profile_id=? ORDER BY id').all(profileId).map(row=>parse(row.value));
  }
  delivery(deliveryId) {
    const row=this.db.prepare('SELECT value FROM deliveries WHERE id=?').get(id(deliveryId));
    if(!row)throw fail('CONSOLE_CUSTOMER_NOT_FOUND','Select an original customer receiving record.',404);
    return parse(row.value);
  }
  saveDelivery(value) {
    id(value.id); this.profile(value.profileId);
    const existing=this.db.prepare('SELECT value FROM deliveries WHERE id=?').get(value.id);
    if(existing&&parse(existing.value).identitySha256!==value.identitySha256)
      throw fail('CONSOLE_CUSTOMER_CONFLICT','This customer record belongs to another reviewed export.');
    this.db.prepare('INSERT INTO deliveries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(value.id,value.profileId,json(value));
    return value;
  }
  archive(profileId) {
    return this.transaction(()=>{
    const profile = this.profile(profileId);
    const drafts = this.db.prepare('SELECT value FROM drafts WHERE profile_id=? ORDER BY id,revision').all(profileId).map(row => parse(row.value));
    const calls = this.calls(profileId);
    const deliveries=this.deliveries(profileId);
    const bindings=this.hostBindings(profileId);
    const workflowData=archiveWorkflowRows(this.db,profileId);
    const workflowRecipeData=archiveWorkflowRecipeRows(this.db,profileId);
    const workflowSeriesData=archiveSeriesRows(this.db,profileId);
    const packet = { schema: ARCHIVE_SCHEMA, sourceWorkspaceId: this.id, profile, drafts, calls, deliveries,
      ...(bindings.length?{bindings}:{}),...(workflowData===undefined?{}:{workflowData}),...(workflowRecipeData===undefined?{}:{workflowRecipeData}),...(workflowSeriesData===undefined?{}:{workflowSeriesData}) };
    const contentSha256 = digest(canonical(packet));
    return { ...packet, contentSha256 };
    });
  }
  import(packet, { isActiveCall = () => false } = {}) {
    const {profile,contentSha256,workflowData,workflowRecipeData,workflowSeriesData,bindings}=validateConsoleArchive(packet);
    return this.transaction(() => {
      const imported = this.db.prepare('SELECT profile_id FROM imports WHERE sha=?').get(contentSha256);
      if (imported) return { profile: this.profile(imported.profile_id), reused: true, contentSha256 };
      const existing = this.db.prepare('SELECT value FROM profiles WHERE id=?').get(profile.id);
      if (existing) {
        if (canonical(this.archive(profile.id)) === canonical(packet)) {
          this.db.prepare('INSERT INTO imports VALUES (?,?,?)').run(contentSha256, profile.id, now());
          return { profile: this.profile(profile.id), reused: true, contentSha256 };
        }
        let localProfile=parse(existing.value);
        if(localProfile.createdAt!==profile.createdAt)throw fail('CONSOLE_IMPORT_CONFLICT','This profile identifier has a different original creation.');
        localProfile=this.#mergeHostBindings(localProfile,profile,bindings);
        for(const draft of packet.drafts){
          const owner=this.db.prepare('SELECT profile_id FROM drafts WHERE id=? LIMIT 1').get(draft.id);
          if(owner&&owner.profile_id!==profile.id)throw fail('CONSOLE_IMPORT_CONFLICT','This saved request belongs to a different profile.');
          const row=this.db.prepare('SELECT value FROM drafts WHERE id=? AND revision=?').get(draft.id,draft.revision);
          if(row){if(canonical(parse(row.value))!==canonical(draft))throw fail('CONSOLE_IMPORT_CONFLICT','An immutable saved request revision has conflicting contents.');}
          else this.db.prepare('INSERT INTO drafts VALUES(?,?,?,?)').run(draft.id,draft.revision,profile.id,json(draft));
        }
        for(const incoming of packet.calls){
          const row=this.db.prepare('SELECT value FROM calls WHERE id=?').get(incoming.id);
          if(!row){this.db.prepare('INSERT INTO calls VALUES(?,?,?)').run(incoming.id,profile.id,json(incoming));continue;}
          const old=parse(row.value);
          const requestPart=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['state','completedAt','resultJson','resultSha256','error'].includes(key)));
          if(canonical(requestPart(old))!==canonical(requestPart(incoming)))throw fail('CONSOLE_IMPORT_CONFLICT','This native call has a different original request.');
          if(old.state!=='RUNNING'&&incoming.state!=='RUNNING'&&canonical(old)!==canonical(incoming))
            throw fail('CONSOLE_IMPORT_CONFLICT','Keep both archives: this original native call has different final results.');
          if(old.state==='RUNNING'&&incoming.state!=='RUNNING'&&!isActiveCall(old))
            this.db.prepare('UPDATE calls SET value=? WHERE id=?').run(json(incoming),incoming.id);
        }
        for(const incoming of packet.deliveries){
          const row=this.db.prepare('SELECT value FROM deliveries WHERE id=?').get(incoming.id);
          if(!row){this.db.prepare('INSERT INTO deliveries VALUES(?,?,?)').run(incoming.id,profile.id,json(incoming));continue;}
          const old=parse(row.value);
          if(old.profileId!==profile.id||old.identitySha256!==incoming.identitySha256||canonical(old.identity)!==canonical(incoming.identity))
            throw fail('CONSOLE_IMPORT_CONFLICT','This customer receiving record has a different original selection.');
          if(old.state==='COMPLETE'&&incoming.state==='COMPLETE'&&(canonical(old.files)!==canonical(incoming.files)||canonical(old.manifest)!==canonical(incoming.manifest)))
            throw fail('CONSOLE_IMPORT_CONFLICT','Keep both original customer manifests: their completed file identities differ.');
          if(old.state!=='COMPLETE'&&old.workspaceId!==this.id&&incoming.state==='COMPLETE')
            this.db.prepare('UPDATE deliveries SET value=? WHERE id=?').run(json(incoming),incoming.id);
        }
        importWorkflowRows(this.db,workflowData);
        importWorkflowRecipeRows(this.db,workflowRecipeData);
        importSeriesRows(this.db,workflowSeriesData);
        const merged=this.archive(profile.id);
        validateWorkflowRows(merged.workflowData,{profile:merged.profile,drafts:merged.drafts,calls:merged.calls});
        validateWorkflowRecipeRows(merged.workflowRecipeData,{profile:merged.profile,drafts:merged.drafts,workflowData:merged.workflowData});
        validateSeriesRows(merged.workflowSeriesData,{profile:merged.profile,workflowData:merged.workflowData});
        this.db.prepare('INSERT INTO imports VALUES (?,?,?)').run(contentSha256,profile.id,now());
        return{profile:localProfile,receivedProfile:profile,reused:false,merged:true,contentSha256};
      }
      for (const draft of packet.drafts)
        if (this.db.prepare('SELECT 1 FROM drafts WHERE id=? LIMIT 1').get(draft.id)) throw fail('CONSOLE_IMPORT_CONFLICT', 'A saved request ID already belongs to this workspace.');
      for (const call of packet.calls)
        if (this.db.prepare('SELECT 1 FROM calls WHERE id=?').get(call.id)) throw fail('CONSOLE_IMPORT_CONFLICT', 'An original call ID already belongs to this workspace.');
      this.db.prepare('INSERT INTO profiles VALUES (?,?,?)').run(profile.id, profile.revision, json(profile));
      for(const binding of bindings)this.db.prepare('INSERT INTO host_bindings VALUES (?,?,?)').run(profile.id,binding.revision,json(binding));
      for (const draft of packet.drafts) this.db.prepare('INSERT INTO drafts VALUES (?,?,?,?)').run(draft.id, draft.revision, profile.id, json(draft));
      for (const call of packet.calls) this.db.prepare('INSERT INTO calls VALUES (?,?,?)').run(call.id, profile.id, json(call));
      for(const value of packet.deliveries)this.db.prepare('INSERT INTO deliveries VALUES (?,?,?)').run(value.id,profile.id,json(value));
      importWorkflowRows(this.db,workflowData);
      importWorkflowRecipeRows(this.db,workflowRecipeData);
        importSeriesRows(this.db,workflowSeriesData);
      this.db.prepare('INSERT INTO imports VALUES (?,?,?)').run(contentSha256, profile.id, now());
      return { profile, reused: false, contentSha256 };
    });
  }
  close() { if (this.db) { this.db.close(); this.db = null; } }
}
