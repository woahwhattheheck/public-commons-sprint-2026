// MIT. Immutable report editions for the ORIGINAL SQLite query and dataset publishers.
import {DatabaseSync} from 'node:sqlite';
import {constants} from 'node:fs';
import {open, lstat, unlink, rename, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {privateDirectory, bytes, identity, digest, hashPrivate, syncDirectory, fault, stamp} from '../postgres/publisher/files.mjs';
import {identifier, only, text, plain} from './contract.mjs';
import {parseNative, encodeNative, cell, shown} from './values.mjs';
import {writeNew, readRetained, readRetainedJson} from './store.mjs';

export const EDITION_SCHEMA = 'stellar-forge.matomo-edition.v1';
export const FILES_SCHEMA = 'stellar-forge.matomo-source-files.v1';
export const CHUNK_BYTES = 49152;
export const SOURCE_COLUMNS = Object.freeze(['capture_id','edition_id','report_capture_id','path','file_sha256','file_bytes','chunk_index','chunk_count','chunk_sha256','content_base64']);
export const ROW_COLUMNS = Object.freeze(['row_id','table_id','parent_row_id','report_id','source_row','depth','path_json','source_request','source_index','data_json','metadata_json','cell_types_json']);
const quote = value => '"' + value.replaceAll('"','""') + '"';
const objectRow = row => row ? {...row,data:JSON.parse(row.data)} : null;
const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;
async function exists(path) {try {await lstat(path); return true;} catch(e) {if(e.code==='ENOENT')return false;throw e;}}
async function discardOwned(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077) throw fault('MATOMO_EDITION_STAGING_INVALID');
    await unlink(path);
  } catch(e) {if(e.code!=='ENOENT')throw e;}
}
async function fileHash(path, maximum=1073741824) {
  const value=await hashPrivate(path,maximum); return {bytes:value.bytes,sha256:value.hash};
}
function fieldSchema(store,captureId) {
  const fields=new Map();let rows=0;
  for(const row of store.db.prepare('SELECT data_json FROM report_rows WHERE capture_id=? ORDER BY rowid').iterate(captureId)) {
    rows++;
    for(const [name,value]of Object.entries(parseNative(row.data_json))) {
      let field=fields.get(name);
      if(!field) {
        if(fields.size>=512 || name.length>1024)throw fault('MATOMO_EDITION_FIELD_LIMIT');
        field={name,column:'f_'+digest(Buffer.from(name)).slice(0,24),present:0,types:{}};fields.set(name,field);
      }
      const kind=cell(value).kind;field.present++;field.types[kind]=(field.types[kind]??0)+1;
    }
  }
  return {rows,fields:[...fields.values()].sort((a,b)=>order(a.name,b.name)).map(x=>({...x,absent:rows-x.present,storageType:'TEXT',valueEncoding:'native-value-text-with-cell-types'}))};
}
function sourceReads(store,captureId,catalogId) {
  const requests=store.db.prepare('SELECT * FROM requests WHERE owner IN (?,?) ORDER BY rowid').all('capture/'+captureId,'catalog/'+catalogId);
  return requests.map(row=>({id:row.id,owner:row.owner,kind:row.kind,input:JSON.parse(row.input),state:row.state,acceptedAttempt:row.accepted_attempt,
    attempts:store.db.prepare('SELECT * FROM attempts WHERE request_id=? ORDER BY number').all(row.id).map(a=>({
      number:a.number,state:a.state,request:JSON.parse(a.request),result:a.result?JSON.parse(a.result):null,bodyPath:a.body_path}))}));
}
export function createMatomoEditions(store,captures) {
  store.db.exec('CREATE TABLE IF NOT EXISTS edition_reviews(sequence INTEGER PRIMARY KEY,edition_id TEXT NOT NULL REFERENCES editions(id),data TEXT NOT NULL);');
  function edition(id) {
    const value=objectRow(store.db.prepare('SELECT * FROM editions WHERE id=?').get(identifier(id,'edition')));
    if(!value)throw fault('MATOMO_EDITION_NOT_FOUND','Choose a retained report edition.',404);
    value.reviews=store.db.prepare('SELECT data FROM edition_reviews WHERE edition_id=? ORDER BY sequence').all(id).map(r=>JSON.parse(r.data));
    return value;
  }
  function directory(id){return join(store.directory,'editions',identifier(id,'edition'));}
  function change(id,state,patch,event) {
    const current=edition(id),data={...current.data,...patch};
    store.db.prepare('UPDATE editions SET state=?,data=? WHERE id=?').run(state,JSON.stringify(data),id);
    store.event(event,id,{state});return edition(id);
  }
  async function manifest(id,{database=false}={}) {
    const current=edition(id);
    if(current.state!=='COMPLETE'||!current.data.manifest)throw fault('MATOMO_COMPLETE_EDITION_REQUIRED');
    const raw=await readRetained(join(directory(id),'edition.json'),16777216);
    if(raw.length!==current.data.manifest.bytes||digest(raw)!==current.data.manifest.sha256)throw fault('MATOMO_EDITION_MANIFEST_CHANGED');
    const value=JSON.parse(raw);
    if(value.schema!==EDITION_SCHEMA||value.id!==id||value.capture.id!==current.capture_id||
        value.sourceSha256!==store.settings.sourceSha256)throw fault('MATOMO_EDITION_IDENTITY_CHANGED');
    if(database) {
      const pin=await fileHash(join(directory(id),'edition.sqlite'));
      if(pin.bytes!==value.database.bytes||pin.sha256!==value.database.sha256)throw fault('MATOMO_EDITION_DATABASE_CHANGED');
    }
    return {edition:current,raw,value,database:join(directory(id),'edition.sqlite')};
  }
  async function build(id,{signal}) {
    let current=edition(id);
    const capture=await captures.manifest(current.capture_id), catalog=captures.catalog(capture.value.selection.catalogId);
    if(capture.capture.data.manifest.sha256!==current.data.captureManifestSha256)throw fault('MATOMO_EDITION_CAPTURE_CHANGED');
    const root=directory(id);await privateDirectory(root,true);
    const dbFile=join(root,'edition.sqlite'),partial=dbFile+'.partial',rowsFile=join(root,'report-rows.jsonl');
    let native,semantic;
    try {
      if(await exists(dbFile)) {
        const stat=await lstat(dbFile);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.mode&0o077)throw fault('MATOMO_EDITION_DATABASE_CHANGED');
        native=new DatabaseSync(dbFile,{readOnly:true});
        const saved=native.prepare("SELECT value FROM matomo_meta WHERE name='edition_manifest'").get();
        if(!saved)throw fault('MATOMO_EDITION_COMPLETION_MISSING');
        semantic=JSON.parse(saved.value);
        if(semantic.schema!==EDITION_SCHEMA||semantic.id!==id||semantic.capture.manifestSha256!==current.data.captureManifestSha256||
            semantic.sourceSha256!==store.settings.sourceSha256||semantic.label!==current.data.label||semantic.note!==current.data.note)
          throw fault('MATOMO_EDITION_DATABASE_CHANGED');
        if(native.prepare('SELECT COUNT(*) AS n FROM matomo_rows').get().n!==semantic.rows||
           native.prepare('SELECT COUNT(*) AS n FROM source_files').get().n!==semantic.sourceFiles.rows)throw fault('MATOMO_EDITION_DATABASE_CHANGED');
        native.close();native=null;
      } else {
        signal.throwIfAborted();
        await discardOwned(partial+'-journal');await discardOwned(partial);await discardOwned(rowsFile+'.partial');await discardOwned(rowsFile);
        const schema=fieldSchema(store,current.capture_id);
        const reads=sourceReads(store,current.capture_id,catalog.id);
        const items=new Map();
        const memory=(path,raw,kind,mediaType='application/json')=>{
          raw=Buffer.from(raw);const item={path,bytes:raw.length,sha256:digest(raw),mediaType,kind};
          if(items.has(path)&&items.get(path).sha256!==item.sha256)throw fault('MATOMO_SOURCE_FILE_CONFLICT');
          items.set(path,{...item,raw});
        };
        memory('capture.json',capture.raw,'capture-manifest');
        const catalogRaw=await readRetained(join(store.directory,catalog.data.manifest.path),16777216);
        if(catalogRaw.length!==catalog.data.manifest.bytes||digest(catalogRaw)!==catalog.data.manifest.sha256)throw fault('MATOMO_CATALOG_MANIFEST_CHANGED');
        memory('catalog.json',catalogRaw,'report-catalog');
        memory('source-reads.json',bytes({schema:'stellar-forge.matomo-source-reads.v1',sourceSha256:store.settings.sourceSha256,requests:reads}),'source-read-history');
        for(const read of reads)for(const attempt of read.attempts) {
          if(attempt.bodyPath) {
            const expected='requests/'+read.id+'-'+attempt.number+'.json';
            if(attempt.bodyPath!==expected||!attempt.result)throw fault('MATOMO_SOURCE_READ_IDENTITY_CHANGED');
            const raw=await readRetained(join(store.directory,expected),store.settings.source.maxResponseBytes);
            if(raw.length!==attempt.result.bodyBytes||digest(raw)!==attempt.result.bodySha256)throw fault('MATOMO_RETAINED_RESPONSE_CHANGED');
            // Keep a file reference, not every page in memory during edition construction.
            items.set(expected,{path:expected,bytes:raw.length,sha256:digest(raw),mediaType:'application/json',kind:'native-response',file:join(store.directory,expected)});
            const receiptPath='requests/'+read.id+'-'+attempt.number+'.receipt.json';
            const receipt=await readRetained(join(store.directory,receiptPath),131072);
            const parsed=JSON.parse(receipt);
            if(parsed.requestId!==read.id||parsed.attempt!==attempt.number||parsed.sourceSha256!==store.settings.sourceSha256)throw fault('MATOMO_READ_RECEIPT_CHANGED');
            items.set(receiptPath,{path:receiptPath,bytes:receipt.length,sha256:digest(receipt),mediaType:'application/json',kind:'source-read-receipt',file:join(store.directory,receiptPath)});
          }
        }
        native=new DatabaseSync(partial);await chmod(partial,0o600);
        native.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
        const declaration=ROW_COLUMNS.map(name=>quote(name)+' '+(['source_row','depth','source_index'].includes(name)?'INTEGER':'TEXT')+' NOT NULL');
        declaration[0]+=' PRIMARY KEY';
        native.exec('CREATE TABLE matomo_rows('+[...declaration,...schema.fields.map(f=>quote(f.column)+' TEXT NOT NULL')].join(',')+');'+
          'CREATE INDEX matomo_table_rows ON matomo_rows(table_id,source_row);'+
          'CREATE TABLE matomo_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL);'+
          'CREATE TABLE source_files(capture_id TEXT NOT NULL,edition_id TEXT NOT NULL,report_capture_id TEXT NOT NULL,path TEXT NOT NULL,file_sha256 TEXT NOT NULL,file_bytes INTEGER NOT NULL,chunk_index INTEGER NOT NULL,chunk_count INTEGER NOT NULL,chunk_sha256 TEXT NOT NULL,content_base64 TEXT NOT NULL,PRIMARY KEY(path,chunk_index));');
        const columns=[...ROW_COLUMNS,...schema.fields.map(f=>f.column)];
        const insert=native.prepare('INSERT INTO matomo_rows('+columns.map(quote).join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
        const rowHash=createHash('sha256'),captureRowsHash=createHash('sha256');let rowBytes=0,rowCount=0,rowHandle;
        native.exec('BEGIN IMMEDIATE');
        try {
          rowHandle=await open(rowsFile+'.partial','wx',0o600);
          for(const row of store.db.prepare('SELECT * FROM report_rows WHERE capture_id=? ORDER BY rowid').iterate(current.capture_id)) {
            signal.throwIfAborted();
            captureRowsHash.update(row.id+'\n'+row.data_json+'\n'+row.metadata_json+'\n'+row.context+'\n');
            const data=parseNative(row.data_json),metadata=parseNative(row.metadata_json),context=JSON.parse(row.context);
            const cells=Object.fromEntries(Object.entries(data).map(([name,value])=>[name,cell(value)]));
            const kinds=Object.fromEntries(schema.fields.map(f=>[f.name,cells[f.name]?.kind??'absent']));
            insert.run(row.id,row.table_id,context.parentRowId??'',context.reportId,row.row_index,context.depth,
              JSON.stringify(context.path),row.source_request,row.source_index,row.data_json,row.metadata_json,JSON.stringify(kinds),
              ...schema.fields.map(f=>cells[f.name]?.text??''));
            const line=Buffer.from(encodeNative({id:row.id,tableId:row.table_id,sourceRow:row.row_index,sourceRequest:row.source_request,
              sourceIndex:row.source_index,context,data,metadata})+'\n');
            rowBytes+=line.length;if(rowBytes>1073741824)throw fault('MATOMO_EDITION_ROWS_BYTE_LIMIT');
            await rowHandle.writeFile(line);rowHash.update(line);rowCount++;
            if(rowCount%256===0)await nextTurn(undefined,{signal});
          }
          if(rowCount!==schema.rows||rowCount!==capture.value.coverage.rows)throw fault('MATOMO_EDITION_ROW_COUNT_CHANGED');
          if(captureRowsHash.digest('hex')!==capture.value.rowDigest)throw fault('MATOMO_EDITION_ROWS_CHANGED');
          await rowHandle.sync();await rowHandle.close();rowHandle=null;
          await rename(rowsFile+'.partial',rowsFile);
          items.set('report-rows.jsonl',{path:'report-rows.jsonl',bytes:rowBytes,sha256:rowHash.digest('hex'),
            mediaType:'application/x-ndjson',kind:'native-row-projection',file:rowsFile});
          const inventory=[...items.values()].map(({raw,file,...item})=>item).sort((a,b)=>order(a.path,b.path));
          const sourceManifest={schema:FILES_SCHEMA,editionId:id,reportCaptureId:current.capture_id,
            sourceSha256:store.settings.sourceSha256,createdAt:current.created_at,files:inventory,
            captureManifestSha256:current.data.captureManifestSha256,rows:rowCount,coverage:capture.value.coverage,
            semantics:{source:'Matomo processed reporting API',numericValues:'Original JSON number lexemes; no currency or timezone conversion',
              rows:'report-rows.jsonl records preserve native data, metadata, hierarchy and original page position',
              scope:'Complete retained archive for the selected native report; raw-event completeness is not asserted'}};
          const manifestBytes=bytes(sourceManifest),deliveryCaptureId=digest(manifestBytes);
          items.set('source-files.json',{path:'source-files.json',bytes:manifestBytes.length,sha256:deliveryCaptureId,kind:'source-delivery-manifest',mediaType:'application/json',raw:manifestBytes});
          const insertChunk=native.prepare('INSERT INTO source_files('+SOURCE_COLUMNS.join(',')+') VALUES(?,?,?,?,?,?,?,?,?,?)');
          let chunks=0;
          for(const item of [...items.values()].sort((a,b)=>order(a.path,b.path))) {
            signal.throwIfAborted();
            const count=Math.max(1,Math.ceil(item.bytes/CHUNK_BYTES)),hash=createHash('sha256');let handle,total=0;
            try {
              if(item.file) {
                handle=await open(item.file,constants.O_RDONLY|constants.O_NOFOLLOW);
                const stat=await handle.stat();
                if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size!==item.bytes)throw fault('MATOMO_SOURCE_FILE_CHANGED');
              }
              for(let index=0;index<count;index++) {
                const expected=Math.min(CHUNK_BYTES,item.bytes-index*CHUNK_BYTES);
                let raw;
                if(item.raw)raw=item.raw.subarray(index*CHUNK_BYTES,index*CHUNK_BYTES+expected);
                else {
                  raw=Buffer.alloc(expected);let used=0;
                  while(used<expected){const result=await handle.read(raw,used,expected-used,null);if(!result.bytesRead)throw fault('MATOMO_SOURCE_FILE_CHANGED');used+=result.bytesRead;}
                }
                hash.update(raw);total+=raw.length;
                insertChunk.run(deliveryCaptureId,id,current.capture_id,item.path,item.sha256,item.bytes,index,count,digest(raw),raw.toString('base64'));
                chunks++;if(chunks%128===0)await nextTurn(undefined,{signal});
              }
              if(total!==item.bytes||hash.digest('hex')!==item.sha256)throw fault('MATOMO_SOURCE_FILE_CHANGED');
            } finally {await handle?.close();}
          }
          semantic={schema:EDITION_SCHEMA,id,label:current.data.label,note:current.data.note,createdAt:current.created_at,completedAt:stamp(),
            sourceSha256:store.settings.sourceSha256,capture:{id:current.capture_id,manifestSha256:current.data.captureManifestSha256,
              selection:capture.value.selection,coverage:capture.value.coverage},
            rows:rowCount,fields:schema.fields,tableCount:capture.value.tables.length,
            rowProjection:{table:'matomo_rows',identity:'row_id',columns:[...ROW_COLUMNS,...schema.fields.map(f=>f.column)],
              originalJson:'data_json',sourceMetadata:'metadata_json',kindMap:'cell_types_json',hierarchy:'path_json',
              encoding:'Wide values are exact TEXT; use cell_types_json to distinguish number, string, null and absence. Original JSON remains intact.'},
            sourceFiles:{table:'source_files',manifestPath:'source-files.json',captureId:deliveryCaptureId,rows:chunks,
              fileCount:items.size,bytes:[...items.values()].reduce((n,x)=>n+x.bytes,0),chunkBytes:CHUNK_BYTES,columns:[...SOURCE_COLUMNS]},
            originalReadCount:reads.length};
          native.prepare('INSERT INTO matomo_meta(name,value) VALUES(?,?)').run('edition_manifest',JSON.stringify(semantic));
          native.prepare('INSERT INTO matomo_meta(name,value) VALUES(?,?)').run('source_files_manifest',JSON.stringify(sourceManifest));
          native.exec('COMMIT');
        } catch(error) {try{native.exec('ROLLBACK');}catch{}throw error;}
        finally {await rowHandle?.close();}
        native.close();native=null;
        const handle=await open(partial,'r');try{await handle.sync();}finally{await handle.close();}
        if(await exists(dbFile))throw fault('MATOMO_EDITION_FILE_EXISTS');
        await rename(partial,dbFile);await syncDirectory(root);
      }
      const pin=await fileHash(dbFile);
      const final={...semantic,database:{path:'edition.sqlite',...pin}},raw=bytes(final);
      if(raw.length>16777216)throw fault('MATOMO_EDITION_MANIFEST_LIMIT');
      await writeNew(join(root,'edition.json'),raw);
      store.transaction(()=>change(id,'COMPLETE',{manifest:{path:'editions/'+id+'/edition.json',bytes:raw.length,sha256:digest(raw)},
        database:final.database,rows:final.rows,fields:final.fields,sourceFiles:final.sourceFiles,completedAt:final.completedAt,error:null},'EDITION_COMPLETED'));
      return {edition:edition(id)};
    } catch(error) {
      store.transaction(()=>change(id,signal.aborted?'CANCELLED':'FAILED',{error:error.code??'MATOMO_EDITION_FAILED'},'EDITION_STOPPED'));
      throw error;
    } finally {native?.close();}
  }
  async function prepare(input) {
    only(input,['operationId','expectedRevision','captureId','label','note']);
    const id=identifier(input.operationId,'edition'),captureId=identifier(input.captureId,'capture');
    const label=text(input.label,'an edition label',160),note=text(input.note,'the source and intended-use note',4000);
    const selected=await captures.manifest(captureId);
    return store.perform('prepare-edition',input,async({signal})=>{
      store.transaction(()=>{
        store.db.prepare('INSERT INTO editions(id,capture_id,state,data,created_at) VALUES(?,?,?,?,?)').run(id,captureId,'PREPARING',
          JSON.stringify({label,note,captureManifestSha256:selected.capture.data.manifest.sha256}),stamp());
        store.event('EDITION_STARTED',id,{captureId});
      });
      return build(id,{signal});
    });
  }
  async function resume(input) {
    only(input,['operationId','expectedRevision','editionId']);const selected=edition(input.editionId);
    return store.perform('resume-edition',input,async({signal})=>selected.state==='COMPLETE'?{edition:selected}:build(selected.id,{signal}));
  }
  async function review(input) {
    only(input,['operationId','expectedRevision','editionId','editionSha256','reviewer','decision','note']);
    const selected=await manifest(input.editionId,{database:true});
    if(input.editionSha256!==selected.edition.data.manifest.sha256)throw fault('MATOMO_REVIEW_EDITION_CHANGED');
    if(!['approved','changes_requested'].includes(input.decision))throw fault('MATOMO_REVIEW_DECISION');
    const reviewer=text(input.reviewer,'the reviewer',160),note=text(input.note,'the review note',4000);
    return store.perform('review-edition',input,async()=>{
      const record={id:input.operationId,editionId:input.editionId,editionSha256:input.editionSha256,reviewer,decision:input.decision,note,createdAt:stamp()};
      store.transaction(()=>{
        store.db.prepare('INSERT INTO edition_reviews(edition_id,data) VALUES(?,?)').run(input.editionId,JSON.stringify(record));
        store.event('EDITION_REVIEWED',input.editionId,{decision:record.decision,reviewId:record.id});
      });
      return {edition:edition(input.editionId),review:record};
    });
  }
  async function sample(id,{offset=0,limit=25,tableId}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>250)throw fault('MATOMO_ROW_PAGE_INVALID');
    const selected=await manifest(id);const native=new DatabaseSync(selected.database,{readOnly:true});
    try{
      const clause=tableId?'WHERE table_id=?':'',args=tableId?[tableId]:[];
      const total=native.prepare('SELECT COUNT(*) AS n FROM matomo_rows '+clause).get(...args).n;
      const rows=native.prepare('SELECT * FROM matomo_rows '+clause+' ORDER BY rowid LIMIT ? OFFSET ?').all(...args,limit,offset).map(row=>({
        id:row.row_id,tableId:row.table_id,sourceRow:row.source_row,sourceRequest:row.source_request,sourceIndex:row.source_index,
        parentRowId:row.parent_row_id||null,depth:row.depth,path:JSON.parse(row.path_json),
        cells:Object.fromEntries(Object.entries(parseNative(row.data_json)).map(([key,value])=>[key,cell(value)])),metadata:shown(parseNative(row.metadata_json))}));
      return {editionId:id,rows,page:{offset,limit,total,next:offset+rows.length<total?offset+rows.length:null}};
    }finally{native.close();}
  }
  async function sourceFilesManifest(id) {
    const selected=await manifest(id,{database:true}),native=new DatabaseSync(selected.database,{readOnly:true});
    try{return JSON.parse(native.prepare("SELECT value FROM matomo_meta WHERE name='source_files_manifest'").get().value);}finally{native.close();}
  }
  return Object.freeze({edition,manifest,prepare,resume,review,sample,sourceFilesManifest,directory});
}
