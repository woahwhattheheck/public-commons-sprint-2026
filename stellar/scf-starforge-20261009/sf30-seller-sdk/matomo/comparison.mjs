// MIT. Source-bound comparisons of retained Matomo editions; no provider reads.
import {DatabaseSync} from 'node:sqlite';
import {lstat,unlink,chmod,open,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {privateDirectory,bytes,identity,digest,fault,stamp,syncDirectory} from '../postgres/publisher/files.mjs';
import {identifier,only,text,plain} from './contract.mjs';
import {parseNative,cell,numericIdentity,isNativeNumber} from './values.mjs';
import {writeNew,readRetained} from './store.mjs';

export const COMPARISON_SCHEMA='stellar-forge.matomo-comparison.v1';
const own=(a,k)=>Object.hasOwn(a,k);
function canonical(value) {
  if(isNativeNumber(value))return ['number',numericIdentity(String(value))];
  if(value===null)return ['null'];
  if(Array.isArray(value))return ['array',value.map(canonical)];
  if(typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,canonical(value[k])])];
  return [typeof value,value];
}
function selector(value) {
  only(value,['source','name']);
  if(!['data','metadata','path','report'].includes(value.source))throw fault('MATOMO_COMPARISON_SELECTOR');
  if(['data','metadata'].includes(value.source))return {source:value.source,name:text(value.name,'an exact native field name',1024)};
  if(value.name!==undefined)throw fault('MATOMO_COMPARISON_SELECTOR');
  return {source:value.source};
}
function mapping(value,key=false) {
  only(value,['name','left','right','mode']);
  const mode=value.mode??'native';
  if(!['native','decimal'].includes(mode))throw fault('MATOMO_COMPARISON_MODE');
  return {name:text(value.name,key?'a key name':'a field name',160),left:selector(value.left),right:selector(value.right),mode};
}
function plan(value) {
  only(value,['keys','fields','note']);
  if(!Array.isArray(value.keys)||!value.keys.length||value.keys.length>16||!Array.isArray(value.fields)||value.fields.length>512)
    throw fault('MATOMO_COMPARISON_MAPPING_REQUIRED');
  const result={keys:value.keys.map(x=>mapping(x,true)),fields:value.fields.map(x=>mapping(x)),note:text(value.note,'the comparison mapping and scope note',4000)};
  for(const rows of [result.keys,result.fields])if(new Set(rows.map(x=>x.name)).size!==rows.length)throw fault('MATOMO_COMPARISON_FIELD_DUPLICATE');
  return result;
}
function selected(row,definition) {
  if(definition.source==='report')return {present:true,value:row.report_id};
  if(definition.source==='path') {
    // Path cells already retain native kinds; decimal equivalence applies only to numeric path cells.
    return {present:true,path:true,value:JSON.parse(row.path_json).map(x=>[x.kind,x.kind==='number'?numericIdentity(x.text):x.text])};
  }
  const object=parseNative(definition.source==='data'?row.data_json:row.metadata_json);
  return {present:own(object,definition.name),value:object[definition.name]};
}
function compared(value,mode) {
  if(!value.present)return {cell:{kind:'absent',text:null},identity:'absent'};
  if(value.path)return {cell:{kind:'path',text:JSON.stringify(value.value)},identity:JSON.stringify(['path',value.value])};
  const item=cell(value.value);
  if(mode==='decimal'&&item.kind!=='null') {
    if(!['number','string'].includes(item.kind))return {cell:item,invalid:'DECIMAL_VALUE_REQUIRED'};
    try{return {cell:item,identity:'decimal:'+numericIdentity(item.text)};}catch{return {cell:item,invalid:'DECIMAL_VALUE_INVALID'};}
  }
  return {cell:item,identity:JSON.stringify(canonical(value.value))};
}
function projected(row,side,definition) {
  const keys=definition.keys.map(item=>({name:item.name,...compared(selected(row,item[side]),item.mode)}));
  const fields=definition.fields.map(item=>({name:item.name,...compared(selected(row,item[side]),item.mode)}));
  const invalid=keys.some(x=>x.invalid||['absent','null'].includes(x.cell.kind));
  return {key:invalid?null:JSON.stringify(keys.map(x=>x.identity)),keys:keys.map(({name,cell,invalid})=>({name,...cell,...(invalid?{error:invalid}:{})})),
    fields,ref:{rowId:row.row_id,tableId:row.table_id,sourceRow:row.source_row,sourceRequest:row.source_request,sourceIndex:row.source_index,
      parentRowId:row.parent_row_id||null,path:JSON.parse(row.path_json),reportId:row.report_id}};
}
async function absent(path){try{await lstat(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
async function removeStaging(path) {
  try{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.mode&0o077)throw fault('MATOMO_COMPARISON_STAGING_INVALID');await unlink(path);}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
export function createMatomoComparisons(store,editions) {
  store.db.exec('CREATE TABLE IF NOT EXISTS comparison_reviews(sequence INTEGER PRIMARY KEY,comparison_id TEXT NOT NULL REFERENCES comparisons(id),finding_id TEXT NOT NULL,data TEXT NOT NULL);');
  function get(id) {
    const row=store.db.prepare('SELECT * FROM comparisons WHERE id=?').get(identifier(id,'comparison'));
    if(!row)throw fault('MATOMO_COMPARISON_NOT_FOUND','Choose a retained comparison.',404);
    const result={id:row.id,createdAt:row.created_at,...JSON.parse(row.data)};
    result.reviews=store.db.prepare('SELECT data FROM comparison_reviews WHERE comparison_id=? ORDER BY sequence').all(id).map(x=>JSON.parse(x.data));
    return result;
  }
  function update(id,patch,event) {
    const row=store.db.prepare('SELECT data FROM comparisons WHERE id=?').get(id);
    store.db.prepare('UPDATE comparisons SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),...patch}),id);
    store.event(event,id,patch.state?{state:patch.state}:{});
  }
  function folder(id){return join(store.directory,'comparisons',identifier(id));}
  async function validated(id) {
    const current=get(id);if(current.state!=='COMPLETE')throw fault('MATOMO_COMPARISON_NOT_COMPLETE');
    const raw=await readRetained(join(folder(id),'comparison.json'),16777216);
    if(digest(raw)!==current.manifest.sha256||raw.length!==current.manifest.bytes)throw fault('MATOMO_COMPARISON_MANIFEST_CHANGED');
    const manifest=JSON.parse(raw);
    const db=join(folder(id),'comparison.sqlite'),stat=await lstat(db);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.mode&0o077)throw fault('MATOMO_COMPARISON_DATABASE_CHANGED');
    return {current,manifest,database:db,raw};
  }
  async function build(id,{signal}) {
    const current=get(id),directory=folder(id);await privateDirectory(directory,true);
    const left=await editions.manifest(current.left.id,{database:true}),right=await editions.manifest(current.right.id,{database:true});
    if(left.edition.data.manifest.sha256!==current.left.sha256||right.edition.data.manifest.sha256!==current.right.sha256)throw fault('MATOMO_COMPARISON_EDITION_CHANGED');
    const output=join(directory,'comparison.sqlite'),partial=output+'.partial';let db,report;
    try {
      if(!await absent(output)) {
        db=new DatabaseSync(output,{readOnly:true});
        report=JSON.parse(db.prepare("SELECT value FROM meta WHERE name='report'").get()?.value??'null');
        if(!report||report.id!==id||report.inputHash!==current.inputHash)throw fault('MATOMO_COMPARISON_DATABASE_CHANGED');
        db.close();db=null;
      } else {
        await removeStaging(partial+'-journal');await removeStaging(partial);
        db=new DatabaseSync(partial);await chmod(partial,0o600);
        db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE rows(side TEXT NOT NULL,key TEXT,row_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(side,row_id));CREATE INDEX row_keys ON rows(key,side);CREATE TABLE findings(sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,value TEXT NOT NULL);CREATE TABLE meta(name TEXT PRIMARY KEY,value TEXT NOT NULL);');
        db.exec('BEGIN IMMEDIATE');
        const counts={left:0,right:0,matched:0,changed:0,leftOnly:0,rightOnly:0,duplicateKeys:0,invalidKeys:0,findings:0};
        const insert=db.prepare('INSERT INTO rows(side,key,row_id,value) VALUES(?,?,?,?)');let turns=0;
        for(const [side,item]of [['left',left],['right',right]]) {
          const source=new DatabaseSync(item.database,{readOnly:true});
          try {
            for(const row of source.prepare('SELECT * FROM matomo_rows ORDER BY rowid').iterate()) {
              signal.throwIfAborted();const value=projected(row,side,current.mapping);
              insert.run(side,value.key,row.row_id,JSON.stringify(value));counts[side]++;
              if(++turns%256===0)await nextTurn(undefined,{signal});
            }
          }finally{source.close();}
          if(counts[side]!==item.value.rows)throw fault('MATOMO_COMPARISON_ROWS_CHANGED');
        }
        const add=(kind,key,leftRows,rightRows,changes=[],group=null)=>{
          const finding={id:identity({comparison:id,kind,key,left:leftRows.map(x=>x.ref.rowId),right:rightRows.map(x=>x.ref.rowId)}),kind,key,
            left:leftRows.map(x=>({ref:x.ref,keys:x.keys,cells:x.fields.map(({name,cell,invalid})=>({name,...cell,...(invalid?{error:invalid}:{})}))})),
            right:rightRows.map(x=>({ref:x.ref,keys:x.keys,cells:x.fields.map(({name,cell,invalid})=>({name,...cell,...(invalid?{error:invalid}:{})}))})),changes,...(group?{group}:{})};
          db.prepare('INSERT INTO findings(id,kind,value) VALUES(?,?,?)').run(finding.id,kind,JSON.stringify(finding));counts.findings++;
        };
        for(const item of db.prepare('SELECT side,row_id,value FROM rows WHERE key IS NULL ORDER BY side,row_id').iterate()) {
          const row=JSON.parse(item.value);counts.invalidKeys++;add('invalid-key',null,item.side==='left'?[row]:[],item.side==='right'?[row]:[]);
        }
        const selected=db.prepare('SELECT side,value FROM rows WHERE key=? ORDER BY side,row_id');
        for(const {key}of db.prepare('SELECT DISTINCT key FROM rows WHERE key IS NOT NULL ORDER BY key').iterate()) {
          signal.throwIfAborted();
          const group=Object.fromEntries(db.prepare('SELECT side,COUNT(*) AS n FROM rows WHERE key=? GROUP BY side').all(key).map(x=>[x.side,x.n]));
          if((group.left??0)>1||(group.right??0)>1){
            counts.duplicateKeys++;
            for(const member of selected.iterate(key)){
              const row=JSON.parse(member.value);add('duplicate-key',key,member.side==='left'?[row]:[],member.side==='right'?[row]:[],[],{left:group.left??0,right:group.right??0});
              if(++turns%256===0)await nextTurn(undefined,{signal});
            }
            continue;
          }
          const values=selected.all(key),a=values.filter(x=>x.side==='left').map(x=>JSON.parse(x.value)),b=values.filter(x=>x.side==='right').map(x=>JSON.parse(x.value));
          if(!a.length){counts.rightOnly++;add('right-only',key,a,b);}
          else if(!b.length){counts.leftOnly++;add('left-only',key,a,b);}
          else {
            const changes=a[0].fields.flatMap((value,index)=>{
              const other=b[0].fields[index];
              return value.invalid||other.invalid||value.identity!==other.identity?[{name:value.name,left:value.cell,right:other.cell,error:value.invalid??other.invalid??null}]:[];
            });
            if(changes.length){counts.changed++;add('changed',key,a,b,changes);}else counts.matched++;
          }
          if(++turns%256===0)await nextTurn(undefined,{signal});
        }
        const leftNames=new Set(left.value.fields.map(x=>x.name)),rightNames=new Set(right.value.fields.map(x=>x.name));
        const rightFields=new Map(right.value.fields.map(x=>[x.name,x]));
        report={schema:COMPARISON_SCHEMA,id,inputHash:current.inputHash,createdAt:current.createdAt,completedAt:stamp(),
          left:current.left,right:current.right,mapping:current.mapping,counts,
          schemaChanges:{leftOnly:[...leftNames].filter(x=>!rightNames.has(x)),rightOnly:[...rightNames].filter(x=>!leftNames.has(x)),
            changed:left.value.fields.filter(x=>rightNames.has(x.name)&&identity({types:Object.keys(x.types).sort(),absent:x.absent>0})!==identity({types:Object.keys(rightFields.get(x.name).types).sort(),absent:rightFields.get(x.name).absent>0})).map(x=>({name:x.name,left:x,right:rightFields.get(x.name)}))},
          coverage:{left:left.value.capture.coverage,right:right.value.capture.coverage},
          scope:{left:left.value.capture.selection,right:right.value.capture.selection},
          semantics:{equal:'Equal unique keys and selected typed fields; unselected fields are not compared.',
            missing:'An observed row is present on only one retained side. This does not infer deletion or an absent raw event.',
            numeric:'Native numbers compare by exact decimal value. Numeric strings remain strings unless that mapping explicitly selects decimal.',
            null:'Null and an absent field remain different. Null or absent row keys are invalid.'}};
        db.prepare('INSERT INTO meta(name,value) VALUES(?,?)').run('report',JSON.stringify(report));db.exec('COMMIT');db.close();db=null;
        const handle=await open(partial,'r');try{await handle.sync();}finally{await handle.close();}
        if(!await absent(output))throw fault('MATOMO_COMPARISON_FILE_EXISTS');
        await rename(partial,output);await syncDirectory(directory);
      }
      const raw=bytes(report);await writeNew(join(directory,'comparison.json'),raw);
      store.transaction(()=>update(id,{state:'COMPLETE',counts:report.counts,manifest:{path:'comparisons/'+id+'/comparison.json',bytes:raw.length,sha256:digest(raw)},completedAt:report.completedAt,error:null},'COMPARISON_COMPLETED'));
      return {comparison:get(id)};
    }catch(error){
      try{db?.exec('ROLLBACK');}catch{}
      store.transaction(()=>update(id,{state:signal.aborted?'CANCELLED':'FAILED',error:error.code??'MATOMO_COMPARISON_FAILED'},'COMPARISON_STOPPED'));
      throw error;
    }finally{db?.close();}
  }
  async function compare(input) {
    only(input,['operationId','expectedRevision','leftEditionId','rightEditionId','mapping']);
    const id=identifier(input.operationId),mapping=plan(input.mapping);
    const a=await editions.manifest(input.leftEditionId),b=await editions.manifest(input.rightEditionId);
    const left={id:a.edition.id,sha256:a.edition.data.manifest.sha256},right={id:b.edition.id,sha256:b.edition.data.manifest.sha256};
    const inputHash=identity({left,right,mapping});
    return store.perform('compare-editions',input,async({signal})=>{
      store.transaction(()=>{store.db.prepare('INSERT INTO comparisons(id,data,created_at) VALUES(?,?,?)').run(id,JSON.stringify({state:'PREPARING',left,right,mapping,inputHash}),stamp());store.event('COMPARISON_STARTED',id);});
      return build(id,{signal});
    });
  }
  async function resume(input) {
    only(input,['operationId','expectedRevision','comparisonId']);const current=get(input.comparisonId);
    return store.perform('resume-comparison',input,async({signal})=>current.state==='COMPLETE'?{comparison:current}:build(current.id,{signal}));
  }
  async function page(id,{offset=0,limit=25,kind}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fault('MATOMO_FINDING_PAGE_INVALID');
    if(kind&&!['changed','left-only','right-only','duplicate-key','invalid-key'].includes(kind))throw fault('MATOMO_FINDING_KIND');
    const result=await validated(id),db=new DatabaseSync(result.database,{readOnly:true});
    try{
      const where=kind?'WHERE kind=?':'',args=kind?[kind]:[];
      const total=db.prepare('SELECT COUNT(*) AS n FROM findings '+where).get(...args).n;
      const rows=db.prepare('SELECT value FROM findings '+where+' ORDER BY sequence LIMIT ? OFFSET ?').all(...args,limit,offset).map(x=>JSON.parse(x.value));
      const decisions=new Map(result.current.reviews.filter(x=>x.findingId!=='*').map(x=>[x.findingId,x]));
      return {comparison:result.current,report:result.manifest,findings:rows.map(x=>({...x,review:decisions.get(x.id)??null})),page:{offset,limit,total,next:offset+rows.length<total?offset+rows.length:null}};
    }finally{db.close();}
  }
  async function review(input) {
    only(input,['operationId','expectedRevision','comparisonId','manifestSha256','findingId','reviewer','decision','note']);
    const result=await validated(input.comparisonId);
    if(result.current.manifest.sha256!==input.manifestSha256)throw fault('MATOMO_COMPARISON_REVIEW_CHANGED');
    const findingId=input.findingId??'*';
    if(findingId!=='*'){
      const db=new DatabaseSync(result.database,{readOnly:true});try{if(!db.prepare('SELECT id FROM findings WHERE id=?').get(findingId))throw fault('MATOMO_FINDING_NOT_FOUND');}finally{db.close();}
    }
    if(!['accepted','follow_up','changes_requested'].includes(input.decision))throw fault('MATOMO_COMPARISON_REVIEW_DECISION');
    const reviewer=text(input.reviewer,'a reviewer',160),note=text(input.note,'the review decision note',4000);
    return store.perform('review-comparison',input,async()=>{
      const record={id:input.operationId,comparisonId:input.comparisonId,manifestSha256:input.manifestSha256,findingId,reviewer,decision:input.decision,note,createdAt:stamp()};
      store.transaction(()=>{store.db.prepare('INSERT INTO comparison_reviews(comparison_id,finding_id,data) VALUES(?,?,?)').run(input.comparisonId,findingId,JSON.stringify(record));store.event('COMPARISON_REVIEWED',input.comparisonId,{findingId,decision:record.decision});});
      return {comparison:get(input.comparisonId),review:record};
    });
  }
  async function report(id){return validated(id);}
  async function * findingLines(id) {
    const result=await validated(id),db=new DatabaseSync(result.database,{readOnly:true});
    try{for(const row of db.prepare('SELECT value FROM findings ORDER BY sequence').iterate())yield Buffer.from(row.value+'\n');}finally{db.close();}
  }
  return Object.freeze({get,compare,resume,page,review,report,findingLines});
}
