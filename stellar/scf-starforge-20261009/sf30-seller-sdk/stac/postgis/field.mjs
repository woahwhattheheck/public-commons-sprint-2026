// Accepted QField office evidence and reviewed publication, using the original PostGIS transaction.
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {META,need,id,hash,integer,qi,canonical,digest,parseExactJSON,fieldParameter} from './contract.mjs';
import {member,claimDirectory,readJSON,writeJSONOnce,fileRecord,verifyFile,copyVerified,
  privateDirectory,validateSourceMapping} from './files.mjs';

export const FIELD_SOURCE = 'starforge.postgis-accepted-field-source.v1';
const IMPORT = 'field-import', PLAN = 'field-review';
function note(value, label) {
  need(typeof value === 'string' && value.trim() && value.length <= 12000,
    'POSTGIS_FIELD_ATTRIBUTION_REQUIRED', label); return value;
}
function bareFieldNumber(value) {
  // Preserve the original QGIS typed binary representation for the existing codec.
  if (value && value.encoding === 'hex' && typeof value.value === 'string' &&
      Object.keys(value).sort().join(',') === 'encoding,value') {
    need(/^(?:[a-fA-F0-9]{2})*$/.test(value.value), 'POSTGIS_FIELD_BINARY_INVALID');
    return {$vector_binary:Buffer.from(value.value,'hex').toString('base64')};
  }
  return value;
}
async function asRole(client, name, fn) {
  await client.query('SET LOCAL ROLE ' + qi(name));
  let result, problem;
  try { result = await fn(); } catch (error) { problem = error; }
  try { await client.query('SET LOCAL ROLE NONE'); }
  catch (error) { if (!problem) problem = error; else if (error.code !== '25P02') problem.cleanupError = error; }
  if (problem) throw problem;
  return result;
}
export async function runFieldReader(request, {python,signal} = {}) {
  const executable = python || process.env.STARFORGE_VECTOR_PYTHON || 'python3';
  const script = fileURLToPath(new URL('./field_source.py', import.meta.url));
  signal?.throwIfAborted();
  const result = await new Promise((done, fail) => {
    const child = spawn(executable, ['-B',script], {stdio:['pipe','pipe','pipe'],
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true});
    let count=0, stderr='', problem, timer;
    const chunks=[];
    const stop=()=>{problem ||= new Error('POSTGIS_FIELD_READER_CANCELLED'); child.kill('SIGTERM');
      timer ||= setTimeout(()=>child.kill('SIGKILL'),10000); timer.unref();};
    signal?.addEventListener('abort',stop,{once:true});
    if(signal?.aborted)stop();
    child.on('error',error=>{problem=error;});
    child.stdout.on('data',chunk=>{count+=chunk.length;
      if(count<=256*1024*1024)chunks.push(chunk);else {problem=new Error('POSTGIS_FIELD_READER_OUTPUT_LIMIT');stop();}});
    child.stderr.on('data',chunk=>{if(stderr.length<16384)stderr+=chunk.toString();});
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')problem ||= error;});
    child.on('close',(code,signalName)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if(problem){fail(problem);return;}
      let value;
      try{value=parseExactJSON(Buffer.concat(chunks).toString('utf8'));}catch(error){fail(error);return;}
      if(code!==0||value.ok!==true){const error=new Error(value.error?.message||'Accepted field reader did not finish.');
        error.code='POSTGIS_ACCEPTED_FIELD_READ_FAILED';error.detail={original:value.error,code,signal:signalName,stderr};fail(error);}
      else done(value.result);
    });
    child.stdin.end(canonical(request)+'\n');
  });
  return result;
}
export async function openFieldSource(directory, expectedManifestSha256) {
  const root=resolve(directory);
  const manifestFile=await fileRecord(member(root,'accepted-field.json'),'accepted-field.json');
  if(expectedManifestSha256)need(manifestFile.sha256===hash(expectedManifestSha256),'POSTGIS_FIELD_SOURCE_CHANGED');
  const manifest=await readJSON(member(root,'accepted-field.json'));
  need(manifest.schema===FIELD_SOURCE&&Array.isArray(manifest.files),'POSTGIS_ACCEPTED_FIELD_SOURCE_REQUIRED');
  const files=new Map();
  for(const row of manifest.files){need(!files.has(row.path),'POSTGIS_FIELD_FILE_DUPLICATE');files.set(row.path,row);
    await verifyFile(root,row);}
  for(const name of ['context.json','changes.ndjson'])need(files.has(name),'POSTGIS_FIELD_CONTEXT_MISSING',name);
  need(canonical(files.get(manifest.changes.path))===canonical(manifest.changes),'POSTGIS_FIELD_CHANGES_CHANGED');
  const context=await readJSON(member(root,'context.json'));
  need(context.workspaceId===manifest.workspaceId&&context.project.id===manifest.fieldProjectId&&
    context.acceptedEditionSha256===manifest.fieldEditionSha256&&context.acceptance.requestId===manifest.acceptanceRequestId&&
    context.returned.review.sha256===manifest.reviewSha256,'POSTGIS_FIELD_ACCEPTANCE_CHANGED');
  for(const row of context.files){
    const expected={...row,path:'original/'+row.path};
    need(canonical(files.get(expected.path))===canonical(expected),'POSTGIS_FIELD_ORIGINAL_NOT_BOUND',row.path);
  }
  return {directory:root,manifest,manifestFile,context};
}
export async function* fieldChanges(source) {
  const record=source.manifest.changes;
  await verifyFile(source.directory,record);
  const input=createReadStream(member(source.directory,record.path)), lines=createInterface({input,crlfDelay:Infinity});
  const seen=new Set();let count=0,sequence=0;
  try{
    for await(const line of lines){
      const row=parseExactJSON(line);integer(row.sequence,'sequence',1);hash(row.changeId);
      need(row.sequence>sequence&&!seen.has(row.changeId)&&
        digest(parseExactJSON(row.originalBody))===digest(row.change),'POSTGIS_FIELD_CHANGE_IDENTITY_INVALID');
      // Python derives this ID from the original review bytes and native sequence.
      const {createHash}=await import('node:crypto');
      need(row.changeId===createHash('sha256').update(source.manifest.reviewSha256+':'+row.sequence).digest('hex'),
        'POSTGIS_FIELD_ORIGINAL_SEQUENCE_CHANGED');
      seen.add(row.changeId);sequence=row.sequence;count++;yield row;
    }
  }finally{lines.close();input.destroy();}
  need(count===source.manifest.changeCount,'POSTGIS_FIELD_COMPLETE_CHANGES_REQUIRED');
  await verifyFile(source.directory,record);
}
async function copyField(source,destination) {
  await privateDirectory(destination);
  for(const row of [...source.manifest.files,source.manifestFile])
    await copyVerified(source.directory,destination,row);
  return openFieldSource(destination,source.manifestFile.sha256);
}
export async function backupFieldSources({root,output,operations}) {
  const sources=[];
  for(const row of operations){
    if(row.kind!==IMPORT)continue;
    const result=parseExactJSON(row.result_json), selected=result.fieldSource;
    need(selected?.directory==='field-sources/'+result.requestSha256,'POSTGIS_FIELD_SOURCE_DIRECTORY_CHANGED');
    const source=await openFieldSource(member(root,selected.directory),selected.manifest.sha256);
    await copyField(source,member(output,selected.directory));
    sources.push({operationId:row.operation_id,directory:selected.directory,
      manifest:{...source.manifestFile,path:selected.directory+'/'+source.manifestFile.path}});
  }
  return sources;
}
export async function validateBackupFields(directory, manifest, metadata, {destination}={}) {
  const required=metadata.operations.filter(row=>row.kind===IMPORT), records=manifest.fieldSources||[];
  need(records.length===required.length,'POSTGIS_BACKUP_FIELD_SOURCE_CLOSURE');
  const files=new Map(manifest.files.map(row=>[row.path,row]));
  for(const operation of required){
    const result=parseExactJSON(operation.result_json), wanted=result.fieldSource;
    const row=records.find(item=>item.operationId===operation.operation_id);
    need(row&&row.directory===wanted.directory&&row.manifest.sha256===wanted.manifest.sha256&&
      row.manifest.path===row.directory+'/accepted-field.json'&&
      canonical(files.get(row.manifest.path))===canonical(row.manifest),'POSTGIS_BACKUP_FIELD_SOURCE_CHANGED');
    const source=await openFieldSource(member(directory,row.directory),row.manifest.sha256);
    for(const file of source.manifest.files)
      need(canonical(files.get(row.directory+'/'+file.path))===canonical({...file,path:row.directory+'/'+file.path}),
        'POSTGIS_BACKUP_FIELD_MEMBER_MISSING',file.path);
    if(destination)await copyField(source,member(destination,row.directory));
  }
}

export function createFieldWorkflow({db,profile,root,sourceOptions}) {
  const profileSha256=digest(profile);
  const layerOf=idValue=>{const layer=profile.layers.find(x=>x.id===idValue);need(layer,'POSTGIS_FIELD_TARGET_LAYER_REQUIRED');return layer;};
  const roleOf=(layer,name,permission)=>{
    const role=layer.roles.find(x=>x.name===name);
    need(role&&role.permissions.includes('select')&&(!permission||role.permissions.includes(permission)),
      'POSTGIS_FIELD_SELECTED_ROLE_PERMISSION_REQUIRED',{layerId:layer.id,role:name,permission});
    return role;
  };
  async function sourceFromOperation(client,operationId) {
    const saved=await db.committedOperation(client,id(operationId));
    need(saved?.kind===IMPORT,'POSTGIS_FIELD_ORIGINAL_IMPORT_REQUIRED');
    const selected=saved.result.fieldSource;
    need(selected?.directory==='field-sources/'+saved.requestSha256,'POSTGIS_FIELD_SOURCE_DIRECTORY_CHANGED');
    return {operation:saved,source:await openFieldSource(member(root,selected.directory),selected.manifest.sha256)};
  }
  async function targets({layerId,role,offset=0,limit=100,search=''}) {
    integer(offset,'offset');integer(limit,'limit',1);need(limit<=500&&typeof search==='string'&&search.length<=240,'POSTGIS_FIELD_PAGE_INVALID');
    const layer=layerOf(layerId);roleOf(layer,role);
    return db.transaction(async client=>{
      const current=await db.project(client);need(current?.activeEditionId,'POSTGIS_ACCEPTED_EDITION_REQUIRED');
      const edition=await db.edition(client,current.activeEditionId), native=edition.layers.find(x=>x.id===layerId);
      await db.assertView(client,layer,native.liveTable);
      return asRole(client,role,async()=>{
        const where=search?' WHERE sf_key ILIKE $1 OR sf_id::text=$1':'';
        const args=search?[search]:[];
        const total=(await client.query('SELECT count(*)::text AS total FROM '+db.q(layer.relation)+where,args)).rows[0].total;
        const rows=(await client.query("SELECT sf_id::text,sf_key,(to_jsonb(t)-'geom')::text AS attributes_json,"+
          db.rowHashSQL('t')+' AS row_hash FROM '+db.q(layer.relation)+' t'+where+
          ' ORDER BY sf_key COLLATE "C" LIMIT $'+(args.length+1)+' OFFSET $'+(args.length+2),[...args,limit,offset])).rows;
        return {projectId:profile.projectId,revision:current.revision,editionId:current.activeEditionId,layerId,role,total,offset,limit,
          rows:rows.map(r=>({sfId:r.sf_id,rowKey:r.sf_key,rowHash:r.row_hash,attributesJSON:r.attributes_json}))};
      });
    },{readOnly:true,repeatable:true});
  }
  async function importField({operationId,workspaceDirectory,workspaceId,fieldProjectId,fieldEditionSha256,actor,note:reason}) {
    id(operationId);id(workspaceId);id(fieldProjectId);hash(fieldEditionSha256);note(actor,'actor');note(reason,'note');
    need(typeof workspaceDirectory==='string'&&workspaceDirectory===resolve(workspaceDirectory),'POSTGIS_FIELD_ABSOLUTE_WORKSPACE_REQUIRED');
    const request={schema:'starforge.postgis-field-import-request.v1',operationId,projectId:profile.projectId,profileSha256,
      workspaceDirectory,workspaceId,fieldProjectId,fieldEditionSha256,actor,note:reason};
    return db.mutate(operationId,IMPORT,request,async(client,current,requestSha256)=>{
      need(current.activeEditionId,'POSTGIS_ACCEPTED_EDITION_REQUIRED');
      const directory='field-sources/'+requestSha256, output=member(root,directory);
      await claimDirectory(output,{schema:'starforge.postgis-field-retention.v1',sourceRequestSha256:requestSha256,
        workspaceId,fieldProjectId,fieldEditionSha256});
      await runFieldReader({command:'export',directory:output,requestSha256,workspaceDirectory,workspaceId,
        fieldProjectId,fieldEditionSha256},sourceOptions);
      const source=await openFieldSource(output);
      need(source.manifest.workspaceId===workspaceId&&source.manifest.fieldProjectId===fieldProjectId&&
        source.manifest.fieldEditionSha256===fieldEditionSha256,'POSTGIS_FIELD_SELECTED_SOURCE_CHANGED');
      return {schema:'starforge.postgis-field-import-result.v1',projectId:profile.projectId,actor,
        fieldSource:{directory,manifest:source.manifestFile,summary:source.manifest.summary,
          workspaceId,fieldProjectId,fieldEditionSha256,acceptedAt:source.manifest.acceptedAt,
          acceptedBy:source.manifest.acceptedBy,changeCount:source.manifest.changeCount}};
    });
  }
  async function readField({sourceOperationId,offset=0,limit=100}) {
    integer(offset,'offset');integer(limit,'limit',1);need(limit<=500,'POSTGIS_FIELD_PAGE_INVALID');
    return db.transaction(async client=>{
      const {operation,source}=await sourceFromOperation(client,sourceOperationId), rows=[];
      let position=0;
      for await(const row of fieldChanges(source)){if(position>=offset&&rows.length<limit)rows.push(row);position++;}
      return {sourceOperationId,source:source.manifest,manifestFile:source.manifestFile,
        configuration:source.context.configuration,lineage:source.context.acceptedManifest.lineage,
        offset,limit,total:position,rows,originalImport:operation};
    },{readOnly:true});
  }
  async function rowState(client,table,layer,rowKey){
    const row=(await client.query("SELECT sf_id::text,sf_key,(to_jsonb(t)-'geom')::text AS attributes_json,"+
      "encode(ST_AsEWKB(geom),'hex') AS geometry_ewkb,"+db.rowHashSQL('t')+' AS row_hash'+
      (layer.fields.length?','+layer.fields.map((f,i)=>qi(f.name)+'::text AS '+qi('f_'+i)).join(','):'')+
      ' FROM '+db.q(table)+' t WHERE sf_key=$1',[rowKey])).rows[0];
    return row?{sfId:row.sf_id,rowKey:row.sf_key,rowHash:row.row_hash,attributesJSON:row.attributes_json,
      geometryEWKB:row.geometry_ewkb,values:Object.fromEntries(layer.fields.map((f,i)=>[f.name,row['f_'+i]]))}:null;
  }
  async function nativeValue(client,field,value){
    const parameter=fieldParameter(field.type==='bytea'?bareFieldNumber(value):value,true,field);
    const row=(await client.query('SELECT ($1::'+field.type+')::text AS value',[parameter])).rows[0];
    return {input:value,storedText:row.value};
  }
  async function nativeGeometry(client,geometry,sourceSrid,layer){
    if(geometry===null)return null;
    need(geometry&&typeof geometry.wkt==='string'&&typeof geometry.sha256==='string','POSTGIS_FIELD_GEOMETRY_REQUIRED');
    const row=(await client.query('WITH g AS (SELECT ST_Transform(ST_GeomFromText($1,$2),$3) AS geom) '+
      "SELECT encode(ST_AsEWKB(geom),'hex') AS ewkb,ST_NDims(geom)::text AS dimension,"+
      "replace(upper(ST_GeometryType(geom)),'ST_','') AS type,ST_IsValid(geom) AS valid FROM g",
      [geometry.wkt,sourceSrid,layer.geometry.targetSrid])).rows[0];
    need(Number(row.dimension)===layer.geometry.dimension&&
      (layer.geometry.type==='GEOMETRY'||row.type===layer.geometry.type)&&
      (layer.geometry.acceptInvalid||row.valid==='t'),'POSTGIS_FIELD_GEOMETRY_PROFILE_CHANGED',row);
    return row.ewkb;
  }
  async function buildReview(client,current,input){
    const {sourceOperationId,expectedRevision,bindings,actor,note:reason}=input;
    integer(expectedRevision,'expectedRevision');note(actor,'actor');note(reason,'review note');
    need(current?.activeEditionId&&current.revision===expectedRevision,'POSTGIS_PROJECT_REVISION_CHANGED',current?.revision);
    need(current.profileSha256===profileSha256,'POSTGIS_FIELD_CURRENT_PROFILE_REQUIRED');
    need(Array.isArray(bindings),'POSTGIS_FIELD_BINDINGS_REQUIRED');
    const {operation,source}=await sourceFromOperation(client,sourceOperationId);
    const chosen=new Map();
    for(const item of bindings){hash(item.changeId);need(!chosen.has(item.changeId),'POSTGIS_FIELD_DUPLICATE_BINDING');chosen.set(item.changeId,item);}
    const edition=await db.edition(client,current.activeEditionId);
    const records=[],seenTargets=new Set(),crs=new Map();
    const applied=new Set();
    for(const row of (await client.query("SELECT result_json::text FROM "+db.q(META.operations)+
      " WHERE project_id=$1 AND kind='promote'",[profile.projectId])).rows){
      const result=parseExactJSON(row.result_json);
      if(result.fieldCorrection?.sourceManifestSha256===source.manifestFile.sha256)
        for(const item of result.fieldCorrection.changes||[])if(item.disposition==='apply')applied.add(item.changeId);
    }
    for await(const original of fieldChanges(source)){
      const selected=chosen.get(original.changeId), change=original.change;
      need(selected,'POSTGIS_FIELD_COMPLETE_REVIEW_REQUIRED',original.changeId);chosen.delete(original.changeId);
      note(selected.note,'change decision');
      need(['apply','keep'].includes(selected.disposition),'POSTGIS_FIELD_DECISION_REQUIRED');
      if(selected.disposition==='keep'){
        records.push({changeId:original.changeId,sequence:original.sequence,kind:change.kind,fieldLayerId:change.layerId,
          identity:change.identity,disposition:'keep',note:selected.note,original:change});continue;
      }
      need(!applied.has(original.changeId),'POSTGIS_FIELD_CHANGE_ALREADY_PUBLISHED',original.changeId);
      need(['changed','added','deleted'].includes(change.kind),'POSTGIS_FIELD_ATTACHMENT_EVIDENCE_ONLY');
      const target=selected.target;
      need(target&&typeof target==='object','POSTGIS_FIELD_TARGET_REQUIRED');
      const layer=layerOf(target.layerId), permission=change.kind==='added'?'insert':change.kind==='deleted'?'delete':'update';
      roleOf(layer,target.role,permission);
      const physical=edition.layers.find(x=>x.id===layer.id);
      await db.assertView(client,layer,physical.liveTable);
      const targetKey=layer.id+'\0'+(change.kind==='added'?'new:'+original.changeId:target.rowKey);
      need(!seenTargets.has(targetKey),'POSTGIS_FIELD_TARGET_REVIEW_DUPLICATE',targetKey);seenTargets.add(targetKey);
      if(change.kind!=='added')need(typeof target.rowKey==='string'&&target.rowKey.length<=160,'POSTGIS_FIELD_STABLE_KEY_REQUIRED');
      const before=change.kind==='added'?null:await asRole(client,target.role,()=>rowState(client,layer.relation,layer,target.rowKey));
      need(change.kind==='added'||before,'POSTGIS_FIELD_TARGET_NOT_VISIBLE',target.rowKey);
      const fields=[], names=new Set(), sourceNames=new Set();
      need(Array.isArray(selected.fields),'POSTGIS_FIELD_ATTRIBUTE_DECISIONS_REQUIRED');
      for(const mapping of selected.fields){
        need(typeof mapping.sourceName==='string'&&!sourceNames.has(mapping.sourceName),'POSTGIS_FIELD_SOURCE_ATTRIBUTE_DUPLICATE');
        sourceNames.add(mapping.sourceName);
        need(['field','current'].includes(mapping.choice),'POSTGIS_FIELD_ATTRIBUTE_DECISION_REQUIRED');
        if(mapping.choice==='current'){fields.push({...mapping});continue;}
        const field=layer.fields.find(f=>f.name===mapping.targetName);
        need(field&&!names.has(field.name)&&change.after&&Object.hasOwn(change.after.attributes,mapping.sourceName),
          'POSTGIS_FIELD_ATTRIBUTE_MAPPING_INVALID',mapping);names.add(field.name);
        need(change.kind==='added'||change.fields.some(f=>f.field===mapping.sourceName),'POSTGIS_FIELD_UNCHANGED_ATTRIBUTE_SELECTED',mapping.sourceName);
        const next=await nativeValue(client,field,change.after.attributes[mapping.sourceName]);
        let originalValue=null;
        if(change.before&&Object.hasOwn(change.before.attributes,mapping.sourceName))
          originalValue=await nativeValue(client,field,change.before.attributes[mapping.sourceName]);
        fields.push({...mapping,type:field.type,after:next,before:before?.values[field.name]??null,
          fieldBefore:originalValue,baseMatchesCurrent:originalValue?.storedText===before?.values[field.name]});
      }
      if(change.kind==='changed')
        need(change.fields.every(f=>sourceNames.has(f.field))&&sourceNames.size===change.fields.length,
          'POSTGIS_FIELD_COMPLETE_ATTRIBUTE_REVIEW_REQUIRED');
      if(change.kind==='added')need(names.size===layer.fields.length&&selected.fields.every(f=>f.choice==='field'),
        'POSTGIS_FIELD_NEW_ROW_COMPLETE_MAPPING_REQUIRED');
      if(change.kind==='deleted')need(!selected.fields.length,'POSTGIS_FIELD_DELETE_HAS_ATTRIBUTE_PATCH');
      let geometry=null;
      need(['field','current'].includes(selected.geometry),'POSTGIS_FIELD_GEOMETRY_DECISION_REQUIRED');
      if(change.kind==='added')need(selected.geometry==='field','POSTGIS_FIELD_NEW_GEOMETRY_REQUIRED');
      if(change.kind==='deleted')need(selected.geometry==='current','POSTGIS_FIELD_DELETE_GEOMETRY_PATCH');
      if(selected.geometry==='field'){
        integer(target.sourceSrid,'sourceSrid',1);
        const schema=source.context.acceptedManifest.features.layers[change.layerId];
        need(schema&&typeof schema.crs==='string','POSTGIS_FIELD_CRS_MISSING');
        const key=change.layerId+':'+target.sourceSrid+':'+layer.geometry.targetSrid;
        if(!crs.has(key)){
          const selectedProfile={layers:[{...layer,fields:[],geometry:{...layer.geometry,sourceSrid:target.sourceSrid,assignSourceCrs:false}}]};
          const definitions=await db.sridDefinitions(client,selectedProfile);
          crs.set(key,await validateSourceMapping({inspection:{layers:[{id:layer.sourceLayerId,fields:{},crsWkt:schema.crs}]}},
            selectedProfile,definitions,sourceOptions));
        }
        const ewkb=await nativeGeometry(client,change.after.geometry,target.sourceSrid,layer);
        const previous=change.before?await nativeGeometry(client,change.before.geometry,target.sourceSrid,layer):null;
        geometry={sourceSrid:target.sourceSrid,original:change.after.geometry,afterEWKB:ewkb,
          beforeEWKB:before?.geometryEWKB??null,fieldBeforeEWKB:previous,baseMatchesCurrent:previous===before?.geometryEWKB};
      }
      need(change.kind!=='changed'||fields.some(f=>f.choice==='field')||geometry,
        'POSTGIS_FIELD_EMPTY_APPLY_DECISION');
      records.push({changeId:original.changeId,sequence:original.sequence,kind:change.kind,fieldLayerId:change.layerId,
        identity:change.identity,disposition:'apply',note:selected.note,target:{layerId:layer.id,rowKey:before?.rowKey??null,
          role:target.role,permission},before,fields,geometry,original:change});
    }
    need(!chosen.size,'POSTGIS_FIELD_UNKNOWN_CHANGE_BINDING');
    const body={schema:'starforge.postgis-field-review.v1',projectId:profile.projectId,profileSha256,
      sourceOperationId,sourceRequestSha256:operation.requestSha256,sourceManifestSha256:source.manifestFile.sha256,
      fieldEditionSha256:source.manifest.fieldEditionSha256,acceptanceRequestId:source.manifest.acceptanceRequestId,
      expectedRevision,activeEditionId:current.activeEditionId,sourceManifest:edition.source.manifest,
      actor,note:reason,records,crsObservations:[...crs.values()]};
    return {...body,reviewSha256:digest(body),counts:{total:records.length,
      applied:records.filter(r=>r.disposition==='apply').length,retained:records.filter(r=>r.disposition==='keep').length}};
  }
  async function preview(input){
    return db.transaction(async client=>buildReview(client,await db.project(client),input),{readOnly:true,repeatable:true});
  }
  async function saveReview({operationId,reviewSha256,...input}){
    id(operationId);hash(reviewSha256);
    const request={schema:'starforge.postgis-field-review-request.v1',operationId,projectId:profile.projectId,
      profileSha256,reviewSha256,input};
    return db.mutate(operationId,PLAN,request,async(client,current)=>{
      const reviewed=await buildReview(client,current,input);
      need(reviewed.reviewSha256===reviewSha256,'POSTGIS_FIELD_REVIEW_CHANGED',reviewed);
      need(reviewed.counts.applied>0,'POSTGIS_FIELD_NO_APPLIED_CHANGES');
      return {schema:'starforge.postgis-field-review-result.v1',projectId:profile.projectId,review:reviewed};
    });
  }
  async function plan(client,operationId,current,{recheck=true}={}){
    const original=await db.committedOperation(client,id(operationId));
    need(original?.kind===PLAN,'POSTGIS_FIELD_ORIGINAL_REVIEW_REQUIRED');
    const reviewed=original.result.review;
    need(reviewed.profileSha256===profileSha256&&original.request.profileSha256===profileSha256,
      'POSTGIS_FIELD_REVIEW_PROFILE_CHANGED');
    if(recheck){
      const now=await buildReview(client,current,original.request.input);
      need(now.reviewSha256===reviewed.reviewSha256,'POSTGIS_FIELD_REVIEW_CHANGED',now);
    }
    return {operation:original,review:reviewed};
  }
  async function stageSource(reviewOperationId){
    return db.transaction(async client=>{
      const current=await db.project(client), selected=await plan(client,reviewOperationId,current);
      const edition=await db.edition(client,selected.review.activeEditionId);
      return {sourceDirectory:member(root,edition.source.directory),expectedManifestSha256:edition.source.manifest.sha256};
    },{readOnly:true,repeatable:true});
  }
  async function validateStage(client,current,reviewOperationId,sourceManifestSha256){
    const selected=await plan(client,reviewOperationId,current);
    need(selected.review.sourceManifest.sha256===sourceManifestSha256,'POSTGIS_FIELD_ORIGINAL_PUBLISHER_CHANGED');
    return {reviewOperationId,reviewRequestSha256:selected.operation.requestSha256,
      sourceOperationId:selected.review.sourceOperationId,sourceManifestSha256:selected.review.sourceManifestSha256};
  }
  async function apply(client,current,successor){
    const link=successor.source.fieldCorrection;
    if(!link)return null;
    const selected=await plan(client,link.reviewOperationId,current);
    need(selected.operation.requestSha256===link.reviewRequestSha256,'POSTGIS_FIELD_ORIGINAL_REVIEW_CHANGED');
    const changes=[];
    for(const row of selected.review.records){
      if(row.disposition==='keep'){changes.push({changeId:row.changeId,disposition:'keep',note:row.note});continue;}
      const layer=layerOf(row.target.layerId), native=successor.layers.find(x=>x.id===layer.id);
      const result=await asRole(client,row.target.role,async()=>{
        const before=row.kind==='added'?null:await rowState(client,native.liveTable,layer,row.target.rowKey);
        need(row.kind==='added'||before?.rowHash===row.before.rowHash,'POSTGIS_FIELD_SUCCESSOR_BASE_CHANGED',row.changeId);
        const parameters=[],expression=value=>{parameters.push(value);return '$'+parameters.length;};
        const chosen=row.fields.filter(f=>f.choice==='field');
        let statement;
        const geometry=()=>{const param=expression(row.geometry?.afterEWKB??null);
          return 'CASE WHEN '+param+'::text IS NULL THEN NULL ELSE ST_GeomFromEWKB(decode('+param+"::text,'hex')) END";};
        if(row.kind==='added'){
          const names=chosen.map(f=>qi(f.targetName)).concat('geom');
          const values=chosen.map(f=>expression(f.after.storedText)+'::'+f.type).concat(geometry());
          statement='INSERT INTO '+db.q(native.liveTable)+' AS t ('+names.join(',')+') VALUES('+values.join(',')+')';
        }else if(row.kind==='deleted'){
          statement='DELETE FROM '+db.q(native.liveTable)+' AS t WHERE sf_key='+expression(row.target.rowKey);
        }else{
          const sets=chosen.map(f=>qi(f.targetName)+'='+expression(f.after.storedText)+'::'+f.type);
          if(row.geometry)sets.push('geom='+geometry());
          statement='UPDATE '+db.q(native.liveTable)+' AS t SET '+sets.join(',')+' WHERE sf_key='+expression(row.target.rowKey);
        }
        const rows=(await client.query(statement+' RETURNING sf_id::text,sf_key',parameters)).rows;
        need(rows.length===1,'POSTGIS_FIELD_NATIVE_ROW_COUNT_CHANGED',row.changeId);
        const after=row.kind==='deleted'?null:await rowState(client,native.liveTable,layer,rows[0].sf_key);
        for(const field of chosen)need(after?.values[field.targetName]===field.after.storedText,'POSTGIS_FIELD_NATIVE_VALUE_CHANGED',field.targetName);
        if(row.geometry)need(after?.geometryEWKB===row.geometry.afterEWKB,'POSTGIS_FIELD_NATIVE_GEOMETRY_CHANGED');
        return {before,after};
      });
      changes.push({changeId:row.changeId,disposition:'apply',kind:row.kind,fieldLayerId:row.fieldLayerId,
        identity:row.identity,role:row.target.role,note:row.note,layerId:layer.id,...result});
    }
    return {reviewOperationId:selected.operation.operationId,reviewRequestSha256:selected.operation.requestSha256,
      sourceOperationId:selected.review.sourceOperationId,sourceManifestSha256:selected.review.sourceManifestSha256,
      fieldEditionSha256:selected.review.fieldEditionSha256,acceptanceRequestId:selected.review.acceptanceRequestId,
      actor:selected.review.actor,note:selected.review.note,changes};
  }
  async function receivingEvidence(client,selected,output){
    const links=selected.source.fieldCorrections||[];
    if(!links.length)return null;
    const items=[];
    for(const link of links){
      const promotion=await db.committedOperation(client,link.promotionOperationId);
      const correction=promotion?.result.fieldCorrection;
      need(promotion?.kind==='promote'&&correction&&correction.reviewOperationId===link.reviewOperationId,
        'POSTGIS_FIELD_PUBLICATION_EVIDENCE_MISSING');
      const review=await db.committedOperation(client,link.reviewOperationId);
      need(review?.kind===PLAN&&review.requestSha256===correction.reviewRequestSha256,'POSTGIS_FIELD_REVIEW_EVIDENCE_CHANGED');
      const {operation,source}=await sourceFromOperation(client,correction.sourceOperationId);
      const destination='field-sources/'+source.manifestFile.sha256;
      await copyField(source,member(output,destination));
      items.push({promotion,review,sourceImport:operation,source:{...source.manifestFile,path:destination+'/'+source.manifestFile.path}});
    }
    await writeJSONOnce(member(output,'field-evidence.json'),{schema:'starforge.postgis-field-evidence.v1',
      projectId:profile.projectId,editionId:selected.editionId,
      interpretation:'Accepted field decisions in this edition history; later explicit source or customer edits may supersede individual values.',items});
    return fileRecord(member(output,'field-evidence.json'),'field-evidence.json');
  }
  return {targets,importField,readField,preview,saveReview,stageSource,validateStage,plan,apply,receivingEvidence};
}
