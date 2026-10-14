/** One complete retained import; uses the current normalizer and review records. */
import {hash,stable,parseSource} from './normalise.mjs';
import {InputError,sourceLineEndings} from './parse.mjs';
export const NATIVE_CAPTURE_SCHEMA='upstate.measurement-native-source/v1';
export function nativeSourceCatalogue(ws){
 return ws.readConsistent(()=>({revision:ws.revision(),imports:ws.db.prepare("SELECT id,label,sha,created_at,summary FROM imports WHERE kind='wqp' ORDER BY created_at,id").all().map(r=>({...r,summary:JSON.parse(r.summary)}))}));
}
export function nativeSourceCapture(ws,id,expectedRevision){
 if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new InputError('Choose an original measurement import');
 return ws.readConsistent(()=>{
  const revision=ws.revision();
  if(expectedRevision!==undefined&&revision!==expectedRevision)throw new InputError('Measurements changed after review. Inspect this original again.',409);
  const source=ws.source(id);
  if(source.kind!=='wqp')throw new InputError('Choose a chemistry/property import; discharge remains in Daily flow');
  if(hash(source.content)!==source.sha)throw new InputError('Original source checksum differs',409);
  const mapping=JSON.parse(source.mapping),summary=JSON.parse(source.summary),parsed=parseSource({kind:source.kind,text:source.content,mapping,lineEndings:sourceLineEndings(summary)});
  if(hash(stable([source.kind,source.sha,parsed.mapping]))!==source.id)throw new InputError('Original source/mapping identity differs',409);
  if(stable(ws.describe(parsed))!==stable(summary)||stable(parsed.rejected)!==stable(JSON.parse(source.rejected)))throw new InputError('Original source accounting differs',409);
  const links=ws.db.prepare('SELECT record_id,source_line FROM import_records WHERE import_id=? ORDER BY source_line,record_id').all(id);
  const expected=parsed.rows.map(r=>({record_id:hash(stable([r.row.sourceKind,r.row])),source_line:r.line})).sort((a,b)=>a.source_line-b.source_line||(a.record_id<b.record_id?-1:a.record_id>b.record_id?1:0));
  if(stable(links)!==stable(expected))throw new InputError('Original row links differ',409);
  const byIdentity=new Map(parsed.rows.map(r=>[hash(stable([r.row.sourceKind,r.row])),r.row]));
  const rows=links.map(link=>{
   const row=ws.db.prepare('SELECT data FROM records WHERE id=?').get(link.record_id);
   if(!row||stable(JSON.parse(row.data))!==stable(byIdentity.get(link.record_id)))throw new InputError('Retained canonical measurement differs from its original',409);
   const canonical=JSON.parse(row.data),review=ws.db.prepare('SELECT state,data FROM reviews WHERE record_id=?').get(link.record_id);
   const chosen=ws.db.prepare('SELECT record_id FROM selected_versions WHERE logical_key=?').get(canonical.logicalKey);
   const variants=ws.db.prepare('SELECT id FROM records WHERE logical_key=? ORDER BY id').all(canonical.logicalKey).map(r=>r.id);
   return {...link,canonical,review:review?JSON.parse(review.data):{state:'pending'},selected_version:chosen?.record_id||null,variants};
  });
  const value={schema:NATIVE_CAPTURE_SCHEMA,revision,source:{...source,mapping,origin:JSON.parse(source.origin),summary,rejected:JSON.parse(source.rejected)},rows};
  return {...value,id:hash(stable(value))};
 });
}
export function nativeSourceOperation(ws,method,parts,query={}){
 if(method==='GET'&&parts.length===1&&parts[0]==='catalogue')return nativeSourceCatalogue(ws);
 if(method==='GET'&&parts.length===2&&parts[0]==='imports'){
  const expected=query.expected_revision===undefined?undefined:Number(query.expected_revision);
  if(expected!==undefined&&(!Number.isSafeInteger(expected)||expected<0))throw new InputError('Choose the inspected source revision');
  return nativeSourceCapture(ws,parts[1],expected);
 }
 throw new InputError('Unknown native observation handoff operation',404);
}
