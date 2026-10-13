/** Select original source returns for one immutable Measurements result. */
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
const SCHEMA='upper-savannah.result-source-selection/v1';
const need=(ok,message,status=409)=>{if(!ok)throw new InputError(message,status);};
const identity=x=>typeof x==='string'&&x.length>0&&x.length<=256;
/** Read-only: neither re-evaluate a result nor change its source/review edition. */
export function resultSourceSelection(workspace,exportId){
 need(identity(exportId),'Choose an original saved result identity',400);
 return workspace.readConsistent(()=>{
  const row=workspace.db.prepare('SELECT id,kind,created_at,revision,content FROM exports WHERE id=?').get(exportId);
  need(row,'Saved measurement result not found',404);
  const report=JSON.parse(row.content);
  const calibration=report.format==='upper-savannah-calibration-input'&&row.kind==='calibration';
  const paired=report.format==='upper-savannah-paired-loads'&&row.kind==='paired-loads';
  need(report.version===1&&(calibration||paired),'This saved result has no supported original-source selection; its complete JSON remains available',400);
  need(report.workspaceRevision===row.revision,'Saved result and its retained workspace revision differ');
  const sources=new Map(),missing=[],associations=[];
  const currentRevision=workspace.revision(),recordCache=new Map(),referencedRecords=new Set();
  function links(id){
   need(identity(id),'Saved result has an invalid original measurement identity');
   referencedRecords.add(id);
   if(!recordCache.has(id))recordCache.set(id,workspace.recordSources(id));
   return recordCache.get(id);
  }
  function include(reference,recordId,basis,role){
   need(reference&&identity(reference.id),'Saved source reference has no original import identity');
   const matches=links(recordId).filter(x=>x.id===reference.id&&(reference.source_line===undefined||x.source_line===reference.source_line));
   if(!matches.length){missing.push({recordId,sourceId:reference.id,basis,role,reason:'Original measurement-to-source association is unavailable'});return;}
   let item=sources.get(reference.id);
   if(!item){
    let original;try{original=workspace.source(reference.id);}catch(error){if(error.status!==404)throw error;missing.push({recordId,sourceId:reference.id,basis,role,reason:'Original source is unavailable'});return;}
    need(original.id===reference.id&&typeof original.content==='string'&&hash(original.content)===original.sha,'Retained original source content differs from its digest');
    item={id:original.id,label:original.label,kind:original.kind,sha256:original.sha,bytes:Buffer.byteLength(original.content,'utf8'),importedAt:original.created_at,bases:[],recordIds:[],roles:[]};sources.set(item.id,item);
   }
   if(reference.sha!==undefined)need(reference.sha===item.sha256,'Saved source reference differs from the retained original source');
   if(!item.bases.includes(basis))item.bases.push(basis);
   if(!item.recordIds.includes(recordId))item.recordIds.push(recordId);
   if(!item.roles.includes(role))item.roles.push(role);
   for(const match of matches)associations.push({recordId,sourceId:item.id,sourceLine:match.source_line,basis,role});
  }
  function current(id,role){
   const refs=links(id);
   if(!refs.length)missing.push({recordId:id,basis:'current-original-record-association',role,reason:'No retained original source is associated with this immutable measurement'});
   for(const ref of refs)include(ref,id,'current-original-record-association',role);
  }
  if(calibration){
   need(Array.isArray(report.accepted)&&Array.isArray(report.excluded),'Saved input result is incomplete');
   for(const [role,records] of [['accepted',report.accepted],['excluded',report.excluded]])for(const record of records){
    need(identity(record.id),'Saved input has an invalid original measurement identity');referencedRecords.add(record.id);
    if(!Array.isArray(record.sourceReferences)||!record.sourceReferences.length){
     missing.push({recordId:record.id,role,basis:'retained-result-source-reference',reason:'This historical result retains no original source reference for this row'});
     continue;
    }
    for(const ref of record.sourceReferences)include(ref,record.id,'retained-result-source-reference',role);
   }
  }else{
   need(Array.isArray(report.paired)&&Array.isArray(report.unpaired),'Saved paired result is incomplete');
   for(const pair of report.paired){current(pair.measurementId,'paired-chemistry');current(pair.flowMeasurementId,'paired-discharge');}
   for(const sample of report.unpaired)current(sample.measurementId,'unpaired-chemistry');
  }
  const originalSources=[...sources.values()].map(s=>({...s,bases:s.bases.sort(),recordIds:s.recordIds.sort(),roles:s.roles.sort()})).sort((a,b)=>a.id.localeCompare(b.id));
  const notes=calibration?[
   'Source identifiers and digests come from the original saved result references. Source rows and files are read from their retained immutable imports.',
   'The return uses the current workspace and review context, alongside the unchanged historical result and its original revision.'
  ]:[
   'This historical pairing result retains immutable chemistry and paired-discharge record IDs. The source-file associations shown here are resolved from the current retained workspace, not recorded historical source selections.',
   'Unpaired rows retain chemistry identity and exclusion reasons. The historical snapshot does not identify every rejected or ambiguous candidate flow record; no such flow selection is inferred.',
   'The return includes the unchanged historical result and current complete project/context. Later review decisions are not substituted into the saved result.'
  ];
  const result={id:row.id,kind:row.kind,format:report.format,savedAt:row.created_at,createdAt:report.createdAt,workspaceRevision:row.revision,
   contentBytes:Buffer.byteLength(row.content,'utf8'),contentSha256:hash(row.content),snapshotSha256:hash(stable(report)),exportIdInSnapshot:Object.hasOwn(report,'exportId')};
  const value={schema:SCHEMA,result,currentWorkspaceRevision:currentRevision,sources:originalSources,
   associations:[...new Map(associations.map(x=>[stable(x),x])).values()],missing,notes,
   sourceSelectionComplete:missing.length===0,counts:{sources:originalSources.length,records:referencedRecords.size,missing:missing.length}};
  return {...value,selectionSha256:hash(stable(value))};
 });
}
