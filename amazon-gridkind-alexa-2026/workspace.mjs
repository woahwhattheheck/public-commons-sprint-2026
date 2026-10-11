import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,lstatSync,existsSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DEMO,inputs} from './engine.mjs';

const FORMAT='gridkind-household/v1';
const KINDS=new Set(['scenario','plan','approval','execution','cancel','comparison','restore']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clone=value=>structuredClone(value);
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
export const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export class WorkspaceError extends Error{
  constructor(message,status=400){super(message);this.status=status;}
}
function requireValue(ok,message,status=400){if(!ok)throw new WorkspaceError(message,status);}
function label(value,fallback='Saved scenario'){
  const text=String(value??fallback).trim();
  requireValue(text.length>0&&text.length<=100&&!/[\x00-\x1f\x7f]/.test(text),'Use a name of 1–100 printable characters.');
  return text;
}
function parsed(value){return JSON.parse(value);}
function summary(record){
  return {id:record.id,sequence:record.sequence,kind:record.kind,label:record.label,createdAt:record.createdAt,
    parentId:record.parentId,planId:record.state?.proposal?.id??null,
    cost:record.state?.proposal?.optimized?.cost??null,approved:record.state?.approved===true,
    simulated:record.state?.receipt?.simulated===true,alternatives:record.detail?.report?.alternatives?.length??0};
}

/** The original planner's durable household records; this module never dispatches. */
export function openHouseholdWorkspace({directory,sourcePins={}}){
  const root=resolve(directory);
  mkdirSync(root,{recursive:true,mode:0o700});
  requireValue(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'Workspace must be a local directory.');
  const filename=join(root,'households.sqlite3');
  if(existsSync(filename))requireValue(lstatSync(filename).isFile()&&!lstatSync(filename).isSymbolicLink(),'Workspace database must be a regular file.');
  const db=new DatabaseSync(filename);
  chmodSync(filename,0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visitors(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,selected_id TEXT);
    CREATE TABLE IF NOT EXISTS households(id TEXT PRIMARY KEY,visitor_id TEXT NOT NULL REFERENCES visitors(id),
      name TEXT NOT NULL,scenario_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,origin_json TEXT);
    CREATE TABLE IF NOT EXISTS records(household_id TEXT NOT NULL REFERENCES households(id),id TEXT NOT NULL,
      sequence INTEGER NOT NULL,data_json TEXT NOT NULL,sha256 TEXT NOT NULL,
      PRIMARY KEY(household_id,id),UNIQUE(household_id,sequence));
    CREATE INDEX IF NOT EXISTS household_owner ON households(visitor_id);
    CREATE INDEX IF NOT EXISTS record_order ON records(household_id,sequence);`);
  const schema=db.prepare('SELECT value FROM metadata WHERE key=?').get('schema');
  requireValue(!schema||schema.value===FORMAT,'This workspace uses a different storage version.');
  db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('schema',FORMAT);
  let closed=false;
  function transaction(fn){
    requireValue(!closed,'Workspace is closed.',503);
    db.exec('BEGIN IMMEDIATE');
    try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}
  }
  function visitor(id){
    requireValue(UUID.test(id),'Invalid browser workspace.');
    const row=db.prepare('SELECT * FROM visitors WHERE id=?').get(id);
    requireValue(row,'Browser workspace not found.',404);return row;
  }
  function household(owner,id){
    const row=db.prepare('SELECT * FROM households WHERE visitor_id=? AND id=?').get(owner,id);
    requireValue(row,'Household not found in this browser workspace.',404);return row;
  }
  function record(owner,householdId,id){
    household(owner,householdId);
    const row=db.prepare('SELECT data_json,sha256 FROM records WHERE household_id=? AND id=?').get(householdId,id);
    requireValue(row,'Saved record not found.',404);
    const data=parsed(row.data_json);
    requireValue(digest(data)===row.sha256,'Saved record integrity check failed.',409);
    return {...data,sha256:row.sha256};
  }
  function nextSequence(householdId){return Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM records WHERE household_id=?').get(householdId).next);}
  function append(householdId,{kind,scenario,state=null,detail={},name,parentId=null}){
    requireValue(KINDS.has(kind),'Unknown household record type.');
    const data={id:randomUUID(),sequence:nextSequence(householdId),kind,label:label(name,kind==='plan'?'Schedule proposal':'Saved '+kind),
      createdAt:new Date().toISOString(),parentId,scenario:inputs(scenario),state:clone(state),detail:clone(detail),sourcePins:clone(sourcePins)};
    const hash=digest(data);
    db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(householdId,data.id,data.sequence,JSON.stringify(data),hash);
    db.prepare('UPDATE households SET updated_at=? WHERE id=?').run(data.createdAt,householdId);
    return {...data,sha256:hash};
  }
  function create(owner,name,scenario=DEMO,origin=null){
    const id=randomUUID(),now=new Date().toISOString(),safe=inputs(scenario);
    db.prepare('INSERT INTO households VALUES (?,?,?,?,?,?,?)').run(id,owner,label(name,'My household'),JSON.stringify(safe),now,now,origin?JSON.stringify(origin):null);
    db.prepare('UPDATE visitors SET selected_id=? WHERE id=?').run(id,owner);
    return id;
  }
  function ensure(id){
    requireValue(UUID.test(id),'Invalid browser workspace.');
    if(db.prepare('SELECT id FROM visitors WHERE id=?').get(id))return;
    transaction(()=>{
      if(db.prepare('SELECT id FROM visitors WHERE id=?').get(id))return;
      db.prepare('INSERT INTO visitors VALUES (?,0,NULL)').run(id);
      const first=create(id,'My household',DEMO);
      append(first,{kind:'scenario',scenario:DEMO,name:'Example household'});
    });
  }
  function assertRevision(id,expected){
    const row=visitor(id);
    if(expected!==undefined)requireValue(Number.isSafeInteger(expected)&&expected===row.revision,
      'The saved workspace changed. Refresh its current state before repeating this action.',409);
    return row;
  }
  function current(id){
    const owner=visitor(id),row=household(id,owner.selected_id);
    return {id:row.id,name:row.name,scenario:inputs(parsed(row.scenario_json)),revision:owner.revision,
      initialRevision:nextSequence(row.id)-1,origin:row.origin_json?parsed(row.origin_json):null};
  }
  function history(id,{householdId=visitor(id).selected_id,offset=0,limit=20}={}){
    household(id,householdId);
    requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'Invalid history page.');
    const total=Number(db.prepare('SELECT COUNT(*) AS total FROM records WHERE household_id=?').get(householdId).total);
    const rows=db.prepare('SELECT data_json,sha256 FROM records WHERE household_id=? ORDER BY sequence DESC LIMIT ? OFFSET ?').all(householdId,limit,offset);
    const records=rows.map(row=>{const data=parsed(row.data_json);requireValue(digest(data)===row.sha256,'Saved record integrity check failed.',409);return summary(data);});
    return {householdId,offset,limit,total,records,hasMore:offset+records.length<total};
  }
  function view(id){
    const owner=visitor(id),selected=current(id);
    const households=db.prepare('SELECT h.id,h.name,h.created_at,h.updated_at,COUNT(r.id) AS count FROM households h LEFT JOIN records r ON r.household_id=h.id WHERE h.visitor_id=? GROUP BY h.id ORDER BY h.created_at,h.id').all(id)
      .map(row=>({id:row.id,name:row.name,createdAt:row.created_at,updatedAt:row.updated_at,recordCount:Number(row.count)}));
    return {revision:owner.revision,selectedId:selected.id,selectedName:selected.name,households,history:history(id),origin:selected.origin};
  }
  function mutate(id,expected,fn){
    return transaction(()=>{
      const owner=assertRevision(id,expected);
      let selectedId=owner.selected_id;
      const context={
        get selectedId(){return selectedId;},
        current:()=>({id:selectedId,...household(id,selectedId)}),
        record:spec=>append(selectedId,spec),
        readRecord:recordId=>record(id,selectedId,recordId),
        setScenario:scenario=>db.prepare('UPDATE households SET scenario_json=? WHERE id=?').run(JSON.stringify(inputs(scenario)),selectedId),
        create:(name,scenario)=>{selectedId=create(id,name,scenario);return selectedId;},
        select:householdId=>{household(id,householdId);selectedId=householdId;db.prepare('UPDATE visitors SET selected_id=? WHERE id=?').run(householdId,id);},
        rename:name=>db.prepare('UPDATE households SET name=?,updated_at=? WHERE id=?').run(label(name),new Date().toISOString(),selectedId),
      };
      const result=fn(context);
      db.prepare('UPDATE visitors SET revision=revision+1 WHERE id=?').run(id);
      return result;
    });
  }
  function exportHousehold(id,householdId=visitor(id).selected_id){
    return transaction(()=>{
      const row=household(id,householdId);
      const records=db.prepare('SELECT data_json,sha256 FROM records WHERE household_id=? ORDER BY sequence').all(householdId).map(row=>{
        const data=parsed(row.data_json);requireValue(digest(data)===row.sha256,'Saved record integrity check failed.',409);return {...data,sha256:row.sha256};
      });
      const payload={household:{id:row.id,name:row.name,scenario:parsed(row.scenario_json),createdAt:row.created_at,updatedAt:row.updated_at,origin:row.origin_json?parsed(row.origin_json):null},records};
      return {schema:FORMAT,exportedAt:new Date().toISOString(),payload,sha256:digest(payload)};
    });
  }
  function inspectImport(bundle){
    requireValue(bundle&&bundle.schema===FORMAT&&bundle.payload&&digest(bundle.payload)===bundle.sha256,'The household file is incomplete or its content has changed.');
    const {household:home,records}=bundle.payload;
    requireValue(home&&UUID.test(home.id)&&Array.isArray(records)&&records.length>0&&records.length<=5000,'Invalid household history.');
    label(home.name);inputs(home.scenario);
    const ids=new Set();let sequence=0;
    for(const row of records){
      const {sha256,...data}=row??{};
      requireValue(UUID.test(data.id)&&!ids.has(data.id)&&Number.isSafeInteger(data.sequence)&&data.sequence>sequence&&KINDS.has(data.kind),'Invalid saved record order or identity.');
      requireValue(digest(data)===sha256,'A saved record has changed.');
      requireValue(typeof data.createdAt==='string'&&Number.isFinite(Date.parse(data.createdAt)),'Invalid saved record date.');
      requireValue(data.parentId===null||ids.has(data.parentId),'A saved record refers to a missing earlier record.');
      label(data.label);inputs(data.scenario);
      if(data.state!==null){
        requireValue(data.state&&typeof data.state==='object'&&Array.isArray(data.state.history),'Invalid saved agent view.');
        inputs(data.state.scenario);
        requireValue(digest(inputs(data.state.scenario))===digest(inputs(data.scenario)),'Saved plan inputs do not match its household record.');
        if(data.state.proposal)requireValue(typeof data.state.proposal.id==='string'&&Number.isSafeInteger(data.state.proposal.revision)&&data.state.proposal.revision>=1,'Invalid saved proposal.');
      }
      if(data.kind==='comparison')requireValue(data.detail?.report?.schema==='gridkind-rate-robustness-v1'&&Array.isArray(data.detail.report.alternatives),'Invalid saved tariff comparison.');
      ids.add(data.id);sequence=data.sequence;
    }
    return {name:home.name,records:records.length,plans:records.filter(r=>r.kind==='plan').length,comparisons:records.filter(r=>r.kind==='comparison').length,sourceId:home.id,sha256:bundle.sha256};
  }
  function importHousehold(id,expected,bundle,name){
    const preview=inspectImport(bundle);
    return transaction(()=>{
      assertRevision(id,expected);
      const home=bundle.payload.household;
      const newId=create(id,name||home.name.slice(0,89)+' (restored)',home.scenario,{householdId:home.id,sha256:bundle.sha256,restoredAt:new Date().toISOString()});
      for(const row of bundle.payload.records){const {sha256,...data}=row;db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(newId,data.id,data.sequence,JSON.stringify(data),sha256);}
      db.prepare('UPDATE visitors SET revision=revision+1 WHERE id=?').run(id);
      return {...preview,householdId:newId};
    });
  }
  function close(){if(!closed){db.close();closed=true;}}
  return {directory:root,ensure,current,view,record,history,mutate,assertRevision,exportHousehold,inspectImport,importHousehold,close};
}
