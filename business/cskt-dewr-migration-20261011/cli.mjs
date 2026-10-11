#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Workspace, Problem, requireRole } from './src/store.mjs';
import { importCorpus, workspaceState } from './src/core.mjs';
import { startServer } from './src/server.mjs';
process.umask(0o077);
const [command,...rest]=process.argv.slice(2),options={};
for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw new Error('Use --name value options.');options[rest[i].slice(2)]=rest[i+1];}
const database=resolve(options.database||'workspace/cskt.sqlite');
let workspace;
try{
  if(command==='serve'){
    const running=await startServer({database,host:options.host||'127.0.0.1',port:Number(options.port||33219),origin:options.origin,sourceRoot:options.sources?resolve(options.sources):undefined});
    process.stdout.write(JSON.stringify({listening:running.origin,database})+'\n');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>running.close().then(()=>process.exit(0)));
  }else if(command==='restore'){
    if(existsSync(database))throw new Error('Restore into a new database path.');
    const source=resolve(options.input),check=new DatabaseSync(source,{readOnly:true});const result=check.prepare('PRAGMA quick_check').get();check.close();if(Object.values(result)[0]!=='ok')throw new Error('The supplied database failed its integrity check.');
    mkdirSync(dirname(database),{recursive:true,mode:0o700});copyFileSync(source,database);process.stdout.write(JSON.stringify({restored:database})+'\n');
  }else{
    workspace=new Workspace(database);
    if(command==='user'){
      const password=readFileSync(resolve(options['password-file']),'utf8').replace(/\r?\n$/,'');workspace.createUser({id:options.id,name:options.name,role:options.role,password});process.stdout.write(JSON.stringify({id:options.id,role:options.role,configured:true})+'\n');
    }else if(command==='disable-user'){
      const user=workspace.db.prepare('SELECT id FROM users WHERE id=?').get(options.id);if(!user)throw new Error('That user ID does not exist.');
      workspace.db.exec('BEGIN IMMEDIATE');try{workspace.db.prepare('UPDATE users SET enabled=0 WHERE id=?').run(options.id);workspace.db.prepare('DELETE FROM sessions WHERE user_id=?').run(options.id);workspace.event('local-administrator','user.disabled',options.id);workspace.setMeta('revision',workspace.revision()+1);workspace.db.exec('COMMIT');}catch(error){workspace.db.exec('ROLLBACK');throw error;}
      process.stdout.write(JSON.stringify({id:options.id,enabled:false})+'\n');
    }else if(command==='import'){
      const actor=workspace.db.prepare('SELECT id,name,role,enabled FROM users WHERE id=?').get(options.actor);if(!actor?.enabled)throw new Error('Use a configured administrator identity.');requireRole(actor,'admin');
      const corpus=JSON.parse(readFileSync(resolve(options.input),'utf8'));const result=workspace.mutate(actor,{requestId:randomUUID(),revision:workspace.revision(),corpus},()=>importCorpus(workspace,actor,corpus));process.stdout.write(JSON.stringify(result)+'\n');
    }else if(command==='backup')process.stdout.write(JSON.stringify(workspace.backup(resolve(options.output)))+'\n');
    else if(command==='export-release'){
      const release=workspace.release(options.id);writeFileSync(resolve(options.output),release.bytes);process.stdout.write(JSON.stringify({releaseId:release.id,sha256:release.sha,output:resolve(options.output)})+'\n');
    }else if(command==='status'){
      const actor={id:'local-operator',name:'Local operator',role:'admin'};const state=workspaceState(workspace,actor);process.stdout.write(JSON.stringify({revision:state.revision,summary:state.summary,captures:state.captures.map(x=>({id:x.id,sha:x.sha,capturedAt:x.captured_at})),releases:state.releases},null,2)+'\n');
    }else throw new Error('Commands: user, disable-user, import, serve, status, export-release, backup, restore. See OPERATIONS.md for complete examples.');
  }
}catch(error){process.stderr.write((error.message||String(error))+'\n');process.exitCode=1;}finally{workspace?.close();}
