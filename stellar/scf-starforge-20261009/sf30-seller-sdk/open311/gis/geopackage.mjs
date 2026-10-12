// MIT. OGC GeoPackage 1.4 core point/features/attributes interchange.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, copy, fail, MAX_SOURCE_BYTES, MAX_ROWS } from './shared.mjs';
import { FILE_COLUMNS, flatRow, normalizeGeometry } from './fields.mjs';
const APPLICATION_ID=0x47504b47;
const WGS84='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]';
const quoted=name=>'"'+String(name).replace(/"/g,'""')+'"';
export function encodePoint(geometry){
  if(geometry===null)return null;
  const point=normalizeGeometry(geometry),bytes=Buffer.alloc(29);
  bytes.write('GP',0,'ascii');bytes[2]=0;bytes[3]=1;bytes.writeInt32LE(4326,4);
  bytes[8]=1;bytes.writeUInt32LE(1,9);bytes.writeDoubleLE(point.coordinates[0],13);bytes.writeDoubleLE(point.coordinates[1],21);
  return bytes;
}
export function decodePoint(value){
  if(value===null)return null;
  const bytes=Buffer.from(value);
  if(bytes.length<29||bytes[0]!==0x47||bytes[1]!==0x50||bytes[2]!==0)fail('INVALID_GEOPACKAGE_GEOMETRY','The point does not have a standard GeoPackage binary header.');
  const flags=bytes[3],little=!!(flags&1),envelope=(flags>>1)&7,empty=!!(flags&16);
  if(flags&0xe0||envelope>1)fail('UNSUPPORTED_GEOPACKAGE_GEOMETRY','Use standard two-dimensional point geometry without Z or M.');
  const srs=little?bytes.readInt32LE(4):bytes.readInt32BE(4);
  if(srs!==4326)fail('GEOMETRY_CRS_MISMATCH','The analyst layer must remain WGS84 EPSG:4326.');
  if(empty&&envelope!==0)fail('INVALID_EMPTY_POINT','A GeoPackage empty point must have no envelope.');
  const offset=8+(envelope===1?32:0);
  if(bytes.length!==offset+21||(bytes[offset]!==0&&bytes[offset]!==1))fail('INVALID_POINT_LENGTH','The point WKB is incomplete or has extra dimensions.');
  const wkbLittle=bytes[offset]===1,type=wkbLittle?bytes.readUInt32LE(offset+1):bytes.readUInt32BE(offset+1);
  if(type!==1)fail('UNSUPPORTED_GEOMETRY_TYPE','The original point layer accepts Point geometry only.');
  const x=wkbLittle?bytes.readDoubleLE(offset+5):bytes.readDoubleBE(offset+5),y=wkbLittle?bytes.readDoubleLE(offset+13):bytes.readDoubleBE(offset+13);
  if(empty){
    const qnan=0x7ff8000000000000n;
    const a=wkbLittle?bytes.readBigUInt64LE(offset+5):bytes.readBigUInt64BE(offset+5),b=wkbLittle?bytes.readBigUInt64LE(offset+13):bytes.readBigUInt64BE(offset+13);
    if(a!==qnan||b!==qnan)fail('INVALID_EMPTY_POINT','The empty point coordinates must use the standard quiet NaN encoding.');
    return null;
  }
  const result=normalizeGeometry({type:'Point',coordinates:[x,y]});
  if(envelope===1){
    const numbers=[8,16,24,32].map(at=>little?bytes.readDoubleLE(at):bytes.readDoubleBE(at));
    const [minx,maxx,miny,maxy]=numbers;
    if(numbers.some(v=>!Number.isFinite(v))||minx>maxx||miny>maxy||x<minx||x>maxx||y<miny||y>maxy)fail('POINT_ENVELOPE_MISMATCH','The stored point is outside its GeoPackage envelope.');
  }
  return result;
}
function temporary(directory,fn){
  const root=mkdtempSync(join(directory??tmpdir(),'open311-gis-'));chmodSync(root,0o700);
  try{return fn(join(root,'handoff.gpkg'));}finally{rmSync(root,{recursive:true,force:true});}
}
function attribute(db,table,description,at){
  db.prepare('INSERT INTO gpkg_contents(table_name,data_type,identifier,description,last_change) VALUES(?,?,?,?,?)').run(table,'attributes',table,description,at);
}
export function writeGeoPackage(asset,sources,{directory}={}){
  return temporary(directory,filename=>{
    const db=new DatabaseSync(filename);
    try{
      chmodSync(filename,0o600);
      db.exec("PRAGMA page_size=4096; PRAGMA encoding='UTF-8'; PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA application_id="+APPLICATION_ID+"; PRAGMA user_version=10400;");
      db.exec("BEGIN IMMEDIATE; CREATE TABLE gpkg_spatial_ref_sys(srs_name TEXT NOT NULL,srs_id INTEGER PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT);"+
        "CREATE TABLE gpkg_contents(table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT UNIQUE,description TEXT DEFAULT '',last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER,CONSTRAINT fk_gc_r_srs_id FOREIGN KEY(srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));"+
        "CREATE TABLE gpkg_geometry_columns(table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,CONSTRAINT pk_geom_cols PRIMARY KEY(table_name,column_name),CONSTRAINT uk_gc_table_name UNIQUE(table_name),CONSTRAINT fk_gc_tn FOREIGN KEY(table_name) REFERENCES gpkg_contents(table_name),CONSTRAINT fk_gc_srs FOREIGN KEY(srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));"+
        "CREATE TABLE open311_features(fid INTEGER PRIMARY KEY AUTOINCREMENT,geom POINT,"+FILE_COLUMNS.map(name=>quoted(name)+' TEXT NOT NULL').join(',')+");"+
        "CREATE TABLE open311_handoff(id INTEGER PRIMARY KEY,schema TEXT NOT NULL,payload_json TEXT NOT NULL);"+
        "CREATE TABLE open311_sources(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,source_name TEXT NOT NULL,source_sha256 TEXT NOT NULL,original_text TEXT NOT NULL);"+
        "CREATE TABLE open311_coverage(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,payload_json TEXT NOT NULL);");
      const addSrs=db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES(?,?,?,?,?,?)');
      addSrs.run('Undefined Cartesian',-1,'NONE',-1,'undefined','Undefined Cartesian coordinate reference system');
      addSrs.run('Undefined Geographic',0,'NONE',0,'undefined','Undefined geographic coordinate reference system');
      addSrs.run('WGS 84',4326,'EPSG',4326,WGS84,'WGS84 geographic coordinates; GeoPackage WKB is longitude then latitude.');
      const points=asset.rows.filter(row=>row.geometry!==null).map(row=>normalizeGeometry(row.geometry).coordinates);
      const extent=points.length?points.reduce((v,p)=>[Math.min(v[0],p[0]),Math.min(v[1],p[1]),Math.max(v[2],p[0]),Math.max(v[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]):[null,null,null,null];
      const at=asset.createdAt;
      db.prepare('INSERT INTO gpkg_contents(table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run('open311_features','features',asset.name,
        'Original municipal service requests with source-version identities and separate analyst fields. NULL geometry preserves unlocated requests.',at,...extent,4326);
      db.prepare('INSERT INTO gpkg_geometry_columns VALUES(?,?,?,?,?,?)').run('open311_features','geom','POINT',4326,0,0);
      attribute(db,'open311_handoff','Complete saved handoff or dispatch edition',at);
      attribute(db,'open311_sources','Complete original source collection/report files and attribution',at);
      attribute(db,'open311_coverage','Original provider selection and collected source coverage',at);
      const binding=asset.schema==='commons.open311.gis-dispatch.v1'?{id:asset.handoffId,sha256:asset.handoffSha256}:asset;
      const add=db.prepare('INSERT INTO open311_features(geom,'+FILE_COLUMNS.map(quoted).join(',')+') VALUES('+Array(FILE_COLUMNS.length+1).fill('?').join(',')+')');
      for(const row of asset.rows){const flat=flatRow(binding,row);add.run(encodePoint(row.geometry),...FILE_COLUMNS.map(key=>flat[key]));}
      db.prepare('INSERT INTO open311_handoff VALUES(?,?,?)').run(1,'commons.open311.gis-geopackage.v1',canonical({schema:'commons.open311.gis-geopackage.v1',handoffId:binding.id,handoffSha256:binding.sha256,kind:asset.schema==='commons.open311.gis-dispatch.v1'?'dispatch':'handoff',asset:copy(asset)}));
      const addSource=db.prepare('INSERT INTO open311_sources VALUES(?,?,?,?,?)');
      sources.forEach((source,index)=>addSource.run(index+1,source.id,source.name,source.sha256,source.originalText));
      const addCoverage=db.prepare('INSERT INTO open311_coverage VALUES(?,?,?)');
      (asset.coverage??[]).forEach((value,index)=>addCoverage.run(index+1,value.inputSourceId??value.sourceId??'',canonical(value)));
      db.exec('COMMIT');
      const foreign=db.prepare('PRAGMA foreign_key_check').all(),integrity=db.prepare('PRAGMA integrity_check').all();
      if(foreign.length||integrity.length!==1||Object.values(integrity[0])[0]!=='ok')fail('GEOPACKAGE_WRITE_FAILED','The completed GeoPackage did not pass its native file checks.',500);
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
    return readFileSync(filename);
  });
}
function ordinaryTable(db,name){
  const entry=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE").get(name);
  if(!entry||entry.type!=='table'||/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(entry.sql??''))fail('GEOPACKAGE_TABLE_REQUIRED','The analyst file must use ordinary GeoPackage tables.');
}
export function readGeoPackage(input,{directory}={}){
  const bytes=Buffer.from(input);
  if(bytes.length>MAX_SOURCE_BYTES||bytes.length<100||bytes.subarray(0,16).toString('binary')!=='SQLite format 3\0')fail('INVALID_GEOPACKAGE','Import one complete GeoPackage file of at most 128 MiB.');
  return temporary(directory,filename=>{
    writeFileSync(filename,bytes,{mode:0o600,flag:'wx'});
    let db;
    try{
      db=new DatabaseSync(filename,{readOnly:true,allowExtension:false});
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
      if(db.prepare('PRAGMA application_id').get().application_id!==APPLICATION_ID)fail('INVALID_GEOPACKAGE','The SQLite file is not a GeoPackage 1.x file.');
      const version=db.prepare('PRAGMA user_version').get().user_version;
      if(version<10200||version>=20000)fail('UNSUPPORTED_GEOPACKAGE_VERSION','Use a core GeoPackage 1.2–1.4 point file.');
      for(const table of ['gpkg_contents','gpkg_geometry_columns','gpkg_spatial_ref_sys'])ordinaryTable(db,table);
      const srs=db.prepare('SELECT organization,organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id=4326').get();
      if(!srs||String(srs.organization).toUpperCase()!=='EPSG'||srs.organization_coordsys_id!==4326)fail('GEOMETRY_CRS_MISMATCH','Keep the analyst layer in WGS84 EPSG:4326.');
      const candidates=[];
      for(const item of db.prepare("SELECT table_name,srs_id FROM gpkg_contents WHERE data_type='features' ORDER BY table_name").all()){
        ordinaryTable(db,item.table_name);
        const columns=db.prepare('PRAGMA table_info('+quoted(item.table_name)+')').all(),names=new Set(columns.map(c=>c.name));
        if(FILE_COLUMNS.every(name=>names.has(name))){
          const geometry=db.prepare('SELECT column_name,geometry_type_name,srs_id,z,m FROM gpkg_geometry_columns WHERE table_name=?').get(item.table_name);
          if(geometry&&names.has(geometry.column_name))candidates.push({table:item.table_name,geometry,contentsSrs:item.srs_id});
        }
      }
      const layer=candidates.find(value=>value.table==='open311_features')??(candidates.length===1?candidates[0]:null);
      if(!layer)fail('ANALYST_LAYER_NOT_FOUND','Keep one analyst point layer with the original Open311 source and analyst columns.');
      if(layer.geometry.srs_id!==4326||layer.contentsSrs!==4326||!['POINT','GEOMETRY'].includes(String(layer.geometry.geometry_type_name).toUpperCase()))fail('GEOMETRY_CRS_MISMATCH','Use the original WGS84 point layer.');
      const rows=[],query=db.prepare('SELECT '+FILE_COLUMNS.map(quoted).join(',')+','+quoted(layer.geometry.column_name)+' AS "__geometry" FROM '+quoted(layer.table));
      let rowNumber=0;
      for(const value of query.iterate()){
        if(++rowNumber>MAX_ROWS)fail('RETURN_ROW_LIMIT','An analyst return supports at most 100,000 rows.',413);
        const properties=Object.fromEntries(FILE_COLUMNS.map(key=>[key,value[key]]));let geometry=null,problem=null;
        try{geometry=decodePoint(value.__geometry);}catch(error){if(error.status!==400)throw error;problem={code:error.code,message:error.message};}
        rows.push({rowNumber,properties,geometry,...(problem?{problem}:{})});
      }
      let metadata=null;
      const header=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='open311_handoff'").get();
      if(header){
        ordinaryTable(db,'open311_handoff');
        const value=db.prepare('SELECT payload_json FROM open311_handoff WHERE id=1').get();
        if(value){try{const parsed=JSON.parse(value.payload_json);metadata={handoffId:parsed.handoffId,handoffSha256:parsed.handoffSha256};}catch{fail('INVALID_HANDOFF_HEADER','The GeoPackage handoff metadata is invalid JSON.');}}
      }
      return {rows,metadata,problems:[],layerName:layer.table};
    }catch(error){if(error.status)throw error;fail('INVALID_GEOPACKAGE','The analyst GeoPackage could not be read: '+error.message);}
    finally{db?.close();}
  });
}
