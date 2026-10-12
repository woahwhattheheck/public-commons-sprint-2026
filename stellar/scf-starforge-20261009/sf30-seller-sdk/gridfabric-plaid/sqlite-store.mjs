// MIT. SQLite storage for the original GridFabric Plaid domain engine.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,lstatSync,chmodSync,realpathSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';

function fail(code,message) { return Object.assign(new Error(message),{code}); }
function text(value,label,{empty=true,allowNul=false}={}) {
  if (typeof value!=='string' || (!allowNul&&value.includes('\0')) || value.length>8192 || (!empty&&!value))
    throw fail('GRIDFABRIC_STORE_ARGUMENT','Use a valid '+label+'.');
  return value;
}
export function privateDirectory(directory,{create=true}={}) {
  const absolute=resolve(directory);
  if (create) mkdirSync(absolute,{recursive:true,mode:0o700});
  const stat=lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o077) ||
      (typeof process.getuid==='function'&&stat.uid!==process.getuid()) || realpathSync(absolute)!==absolute)
    throw fail('GRIDFABRIC_PRIVATE_DIRECTORY','Use a real owner-private workspace directory.');
  return absolute;
}
function privateDatabase(path) {
  if (!existsSync(path)) return;
  const stat=lstatSync(path);
  if (!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)||
      (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
    throw fail('GRIDFABRIC_PRIVATE_DATABASE','Keep the original owner-private SQLite database.');
}
const COLUMNS='table_name,id,scope,sort_key,tag,data_utf8';
const decode=row=>({id:row.id,data:JSON.parse(row.data_utf8),scope:row.scope,sort:row.sort_key,tag:row.tag});
function filter(table,options={}) {
  const clauses=['table_name=?'],values=[text(table,'table',{empty:false})];
  for (const [name,column] of [['scope','scope'],['tag','tag']]) if (options[name]!==undefined) {
    clauses.push(column+'=?');values.push(text(options[name],name,{allowNul:name==='scope'}));
  }
  for (const [name,operator] of [['gte','>='],['lt','<']]) if (options[name]!==undefined) {
    clauses.push('sort_key'+operator+'?');values.push(text(options[name],name,{allowNul:true}));
  }
  return {where:clauses.join(' AND '),values};
}
function pageArguments(options={}) {
  const offset=options.offset??0,limit=options.limit??100,order=options.order??'asc';
  if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>10000||
      !['asc','desc'].includes(order))
    throw fail('GRIDFABRIC_STORE_PAGE','Use a nonnegative offset, a limit from 1 to 10000, and asc or desc order.');
  return {offset,limit,order:order.toUpperCase()};
}
export async function openGridFabricStore({directory,create=true}={}) {
  const root=privateDirectory(directory,{create});
  const lease=await acquireStateLease(root);
  let database,closed=false,depth=0,savepoint=0;
  try {
    const path=join(root,'gridfabric.sqlite');
    if (!create&&!existsSync(path)) throw fail('GRIDFABRIC_WORKSPACE_NOT_FOUND','The original workspace does not exist.');
    privateDatabase(path);
    database=new DatabaseSync(path,{enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false});
    chmodSync(path,0o600);
    database.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
    const version=database.prepare('PRAGMA user_version').get().user_version;
    if (version!==0&&version!==1) throw fail('GRIDFABRIC_STORE_VERSION','This workspace needs its original compatible application version.');
    database.exec(
      'CREATE TABLE IF NOT EXISTS gridfabric_records ('+
      'table_name TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL,sort_key TEXT NOT NULL,'+
      'tag TEXT NOT NULL,data_utf8 TEXT NOT NULL,PRIMARY KEY(table_name,id)) WITHOUT ROWID;'+
      'CREATE INDEX IF NOT EXISTS gridfabric_scope ON gridfabric_records(table_name,scope,sort_key,id);'+
      'CREATE INDEX IF NOT EXISTS gridfabric_tag ON gridfabric_records(table_name,tag,sort_key,id);'+
      'CREATE INDEX IF NOT EXISTS gridfabric_scope_tag ON gridfabric_records(table_name,scope,tag,sort_key,id);'+
      'PRAGMA user_version=1;');
    const check=()=>{if(closed)throw fail('GRIDFABRIC_STORE_CLOSED','The original workspace is closed.');lease.assertHeld();};
    const getStatement=database.prepare('SELECT '+COLUMNS+' FROM gridfabric_records WHERE table_name=? AND id=?');
    const putStatement=database.prepare(
      'INSERT INTO gridfabric_records(table_name,id,scope,sort_key,tag,data_utf8) VALUES(?,?,?,?,?,?) '+
      'ON CONFLICT(table_name,id) DO UPDATE SET scope=excluded.scope,sort_key=excluded.sort_key,'+
      'tag=excluded.tag,data_utf8=excluded.data_utf8');
    const store={
      directory:root,path,
      assertHeld:check,
      get(table,id) {
        check();const row=getStatement.get(text(table,'table',{empty:false}),text(id,'record identity',{empty:false}));
        return row?JSON.parse(row.data_utf8):null;
      },
      put(table,id,data,options={}) {
        check();text(table,'table',{empty:false});text(id,'record identity',{empty:false});
        const encoded=JSON.stringify(data);
        if (encoded===undefined) throw fail('GRIDFABRIC_STORE_DATA','Retain JSON-compatible original data.');
        const previous=getStatement.get(table,id);
        const scope=text(options.scope??previous?.scope??'','scope',{allowNul:true});
        const sort=text(options.sort??previous?.sort_key??'','sort',{allowNul:true});
        const tag=text(options.tag??previous?.tag??'','tag');
        putStatement.run(table,id,scope,sort,tag,encoded);
        return JSON.parse(encoded);
      },
      scan(table,options={}) {
        check();const selected=filter(table,options),paging=pageArguments(options);
        return database.prepare('SELECT '+COLUMNS+' FROM gridfabric_records WHERE '+selected.where+
          ' ORDER BY sort_key '+paging.order+',id '+paging.order+' LIMIT ? OFFSET ?')
          .all(...selected.values,paging.limit,paging.offset).map(decode);
      },
      count(table,options={}) {
        check();const selected=filter(table,options);
        const result=database.prepare('SELECT COUNT(*) AS total FROM gridfabric_records WHERE '+selected.where).get(...selected.values).total;
        if (!Number.isSafeInteger(result)) throw fail('GRIDFABRIC_STORE_COUNT','The original record count exceeds the supported integer range.');
        return result;
      },
      transaction(fn) {
        check();if(typeof fn!=='function')throw fail('GRIDFABRIC_STORE_TRANSACTION','Supply the original synchronous operation.');
        const name='gridfabric_'+(++savepoint),nested=depth>0;
        database.exec(nested?'SAVEPOINT '+name:'BEGIN IMMEDIATE');depth++;
        try {
          const result=fn();
          if(result&&typeof result.then==='function') {
            result.catch?.(()=>{});
            throw fail('GRIDFABRIC_ASYNC_TRANSACTION','Complete external work outside the original SQLite transaction.');
          }
          database.exec(nested?'RELEASE SAVEPOINT '+name:'COMMIT');return result;
        } catch(error) {
          try {database.exec(nested?'ROLLBACK TO SAVEPOINT '+name+'; RELEASE SAVEPOINT '+name:'ROLLBACK');} catch {}
          throw error;
        } finally {depth--;}
      },
      *entries() {
        check();
        for(const row of database.prepare('SELECT '+COLUMNS+' FROM gridfabric_records ORDER BY table_name,id').iterate())
          yield {table:row.table_name,...decode(row)};
      },
      resetForRestore() {
        check();if(depth)throw fail('GRIDFABRIC_RESTORE_TRANSACTION','Start native restoration outside another operation.');
        database.exec('BEGIN IMMEDIATE; DELETE FROM gridfabric_records; COMMIT');
      },
      snapshot(destination) {
        check();if(depth)throw fail('GRIDFABRIC_SNAPSHOT_TRANSACTION','Finish the original operation before creating its portable snapshot.');
        const target=resolve(destination);
        if(existsSync(target))throw fail('GRIDFABRIC_EXPORT_EXISTS','Use a new native snapshot path.');
        database.prepare('VACUUM INTO ?').run(target);chmodSync(target,0o600);return target;
      },
      async close() {
        if(closed)return;
        if(depth)throw fail('GRIDFABRIC_STORE_BUSY','Drain the original operation before closing its owner.');
        check();database.close();closed=true;await lease.close();
      }
    };
    return store;
  } catch(error) {
    try{database?.close();}catch{} await lease.close();throw error;
  }
}
export function openGridFabricSnapshot(path) {
  privateDatabase(path);
  const database=new DatabaseSync(path,{readOnly:true,enableDoubleQuotedStringLiterals:false});
  let closed=false;
  return {
    *records() {
      if(closed)throw fail('GRIDFABRIC_SNAPSHOT_CLOSED','The original snapshot is closed.');
      for(const row of database.prepare('SELECT '+COLUMNS+' FROM gridfabric_records ORDER BY table_name,id').iterate())
        yield {table:row.table_name,...decode(row)};
    },
    close(){if(!closed){database.close();closed=true;}}
  };
}
