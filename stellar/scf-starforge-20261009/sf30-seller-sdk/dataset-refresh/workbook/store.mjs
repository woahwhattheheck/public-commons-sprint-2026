// MIT. Workbook originals and reviewed plans under the ORIGINAL publisher lock.
import { mkdir, readdir, rename, rm, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readPrivate, readJson, createFile, syncDirectory,
  bytes, digest, identity, hashPrivate, fault } from '../../postgres/publisher/files.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const SOURCE='stellar-forge.workbook-source.v1';
const stamp=()=>new Date().toISOString();
const copy=value=>structuredClone(value);
const absent=async path=>{try{await lstat(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
const label=(value,max,required=false)=>{
  if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||required&&!value.trim())
    throw fault('INVALID_WORKBOOK_TEXT','Use a clear name and notes within their displayed limits.');
  return value.trim();
};
function validateSource(value){
  if(value?.schema!==SOURCE||!UUID.test(value.id??'')||!HASH.test(value.sha256??'')||
    !Number.isSafeInteger(value.sourceBytes)||value.sourceBytes<1||value.sourceBytes>64*1024**2||
    !Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.plans)||
    value.workbook?.sourceSha256!==value.sha256||value.workbook?.sourceBytes!==value.sourceBytes)
    throw fault('SAVED_WORKBOOK_INVALID','The retained original workbook metadata needs repair.');
  label(value.filename,160,true);
  return value;
}
export function validateWorkbookOrigin(value){
  if(value===undefined)return;
  if(value?.schema!=='stellar-forge.workbook-candidate-origin.v1'||
    !UUID.test(value.sourceId??'')||!HASH.test(value.sourceSha256??'')||
    !UUID.test(value.planId??'')||!Number.isSafeInteger(value.planRevision)||value.planRevision<1||
    !HASH.test(value.planSha256??'')||!HASH.test(value.preparationKey??'')||
    !HASH.test(value.parserSha256??'')||!HASH.test(value.projectionSha256??'')||
    !HASH.test(value.rowMapSha256??'')||!Number.isSafeInteger(value.rowMapBytes)||value.rowMapBytes<0)
    throw fault('SAVED_WORKBOOK_ORIGIN_INVALID','The candidate workbook origin needs repair.');
}
export async function openWorkbookSources({directory,getState,save,capacity,maxSources=32,maxSourceBytes}){
  const roots={sources:join(directory,'workbooks'),staging:join(directory,'workbook-staging'),parsers:join(directory,'workbook-parsers')};
  for(const root of Object.values(roots))await privateDirectory(root,true);
  if(getState().workbookSources===undefined||getState().removedWorkbookIds===undefined)
    await save(next=>{next.workbookSources??=[];next.removedWorkbookIds??=[];});
  if(!Array.isArray(getState().workbookSources)||!Array.isArray(getState().removedWorkbookIds)||
    getState().removedWorkbookIds.some(id=>!UUID.test(id))||
    new Set(getState().workbookSources.map(x=>x.id)).size!==getState().workbookSources.length)
    throw fault('SAVED_WORKBOOK_INVALID','The original workbook index needs repair.');
  getState().workbookSources.forEach(validateSource);
  const warnings=[];
  function paths(id){
    if(!UUID.test(id??''))throw fault('WORKBOOK_NOT_FOUND','Choose an original workbook.',404);
    const root=join(roots.sources,id);
    return {directory:root,sourcePath:join(root,'original.xlsx'),metadataPath:join(root,'source.json')};
  }
  function source(id){
    const row=UUID.test(id??'')&&getState().workbookSources.find(x=>x.id===id);
    if(!row)throw fault('WORKBOOK_NOT_FOUND','Choose one of this workspace’s original workbooks.',404);
    return copy(row);
  }
  function plan(id,planId,revision){
    const item=source(id).plans.find(x=>x.id===planId);
    if(!item)throw fault('WORKBOOK_PLAN_NOT_FOUND','Choose a saved mapping for this original workbook.',404);
    if(revision!==undefined&&revision!==item.revision)
      throw fault('WORKBOOK_PLAN_CHANGED','This mapping changed. Reopen its actual saved edition before preparing it.',409);
    if(!HASH.test(item.planSha256??'')||!HASH.test(item.configHash??'')||
      item.planSha256!==identity({plan:item.plan,configHash:item.configHash,
        expectedSnapshot:item.expectedSnapshot,expectedRevision:item.expectedRevision}))
      throw fault('WORKBOOK_PLAN_CHANGED','The retained mapping differs from its original reviewed identity.',409);
    return copy(item);
  }
  async function verify(id){
    const row=source(id),file=paths(id);
    await privateDirectory(file.directory);
    const observed=await hashPrivate(file.sourcePath,Math.min(maxSourceBytes,64*1024**2));
    if(observed.hash!==row.sha256||observed.bytes!==row.sourceBytes)
      throw fault('WORKBOOK_SOURCE_CHANGED','The original workbook differs from its retained byte identity.',409);
    return {record:row,...file};
  }
  for(const entry of await readdir(roots.sources,{withFileTypes:true})){
    if(!UUID.test(entry.name)||getState().workbookSources.some(x=>x.id===entry.name))continue;
    if(getState().removedWorkbookIds.includes(entry.name)){
      await rm(paths(entry.name).directory,{recursive:true,force:true});continue;
    }
    let recovered;
    try{
      await privateDirectory(paths(entry.name).directory);
      recovered=validateSource(await readJson(paths(entry.name).metadataPath,4*1024**2));
      if(recovered.id!==entry.name)throw fault('SAVED_WORKBOOK_INVALID');
      const observed=await hashPrivate(paths(entry.name).sourcePath,64*1024**2);
      if(observed.hash!==recovered.sha256||observed.bytes!==recovered.sourceBytes)throw fault('WORKBOOK_SOURCE_CHANGED');
    }catch(e){warnings.push({kind:'Workbook',id:entry.name,code:e.code??'SAVED_WORKBOOK_INVALID'});continue;}
    await save(next=>next.workbookSources.push({...recovered,recoveredAt:stamp()}));
  }
  for(const name of await readdir(roots.staging))if(UUID.test(name))
    await rm(join(roots.staging,name),{recursive:true,force:true});
  return {
    source,plan,paths,verify,warnings,
    async stage(){
      if(getState().workbookSources.length>=maxSources)
        throw fault('WORKBOOK_CAPACITY','Export and remove an unused workbook, or increase the original retained-source capacity.',409);
      capacity(0,{candidate:false});
      const id=randomUUID(),root=join(roots.staging,id);
      await mkdir(root,{mode:0o700});return {id,directory:root,sourcePath:join(root,'original.xlsx')};
    },
    async adopt(staged,input){
      if(staged.directory!==join(roots.staging,staged.id))throw fault('INVALID_WORKBOOK_STAGE');
      const previous=getState().workbookSources.find(x=>x.sha256===input.sha256&&x.sourceBytes===input.sourceBytes);
      if(previous){await rm(staged.directory,{recursive:true,force:true});return source(previous.id);}
      capacity(input.sourceBytes,{candidate:false});
      const record=validateSource({...input,schema:SOURCE,id:staged.id,revision:1,plans:[],createdAt:stamp()});
      await createFile(join(staged.directory,'source.json'),bytes(record));
      await chmod(staged.sourcePath,0o400);await chmod(join(staged.directory,'source.json'),0o400);
      await syncDirectory(staged.directory);
      await rename(staged.directory,paths(staged.id).directory);await syncDirectory(roots.sources);
      await save(next=>next.workbookSources.push(record));
      return source(staged.id);
    },
    async savePlan(id,{planId,expectedSourceRevision,expectedPlanRevision,plan:input,config,configHash,expectedSnapshot,expectedRevision,migration}){
      const row=source(id);
      if(!HASH.test(configHash??'')||!HASH.test(expectedSnapshot??'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        throw fault('WORKBOOK_NATIVE_REVIEW_REQUIRED','Review the actual current public schema and revision.');
      const normalized={...copy(input),name:label(input.name,160,true),notes:label(input.notes,2000)};
      // Comparison adoption is a new original mapping, with its recovery identity
      // inside this same state transaction. A lost reply must not create a second plan.
      if(migration!==undefined){
        const keys=['comparisonId','comparisonSha256','inputSha256','baselineSourceId','baselinePlanId','baselinePlanRevision'];
        if(!migration||typeof migration!=='object'||Array.isArray(migration)||
          Object.keys(migration).length!==keys.length||keys.some(key=>!(key in migration))||planId!==null||
          !UUID.test(migration.comparisonId??'')||!HASH.test(migration.comparisonSha256??'')||
          !HASH.test(migration.inputSha256??'')||!UUID.test(migration.baselineSourceId??'')||
          !UUID.test(migration.baselinePlanId??'')||!Number.isSafeInteger(migration.baselinePlanRevision)||migration.baselinePlanRevision<1)
          throw fault('INVALID_WORKBOOK_MIGRATION','Use the exact retained comparison as this mapping’s origin.');
        for(const current of row.plans)for(const edition of [current,...(current.editions??[])]){
          if(edition.migration?.comparisonId!==migration.comparisonId)continue;
          if(identity(edition.migration)!==identity(migration)||identity(edition.plan)!==identity(normalized)||
            edition.configHash!==configHash||identity(edition.config)!==identity(config)||
            edition.expectedSnapshot!==expectedSnapshot||edition.expectedRevision!==expectedRevision||
            edition.planSha256!==identity({plan:edition.plan,configHash,expectedSnapshot,expectedRevision}))
            throw fault('WORKBOOK_COMPARISON_APPLY_CONFLICT','This comparison already belongs to another retained mapping operation.',409);
          return {source:row,plan:copy(Object.fromEntries(Object.entries(edition).filter(([key])=>key!=='editions'))),
            reused:true,currentPlanRevision:current.revision};
        }
      }
      if(!Number.isSafeInteger(expectedSourceRevision)||row.revision!==expectedSourceRevision)
        throw fault('WORKBOOK_REVIEW_CHANGED','Another action changed this workbook’s saved mappings. Refresh before saving.',409);
      let prior;
      if(planId!==null){
        if(!UUID.test(planId??''))throw fault('WORKBOOK_PLAN_NOT_FOUND');
        prior=plan(id,planId,expectedPlanRevision);
      }else if(expectedPlanRevision!==null)throw fault('WORKBOOK_PLAN_CHANGED');
      if(!prior&&row.plans.length>=128)throw fault('WORKBOOK_PLAN_CAPACITY','Keep up to 128 distinct mappings per workbook.');
      const current={id:prior?.id??randomUUID(),revision:(prior?.revision??0)+1,createdAt:prior?.createdAt??stamp(),
        updatedAt:stamp(),plan:normalized,config:copy(config),configHash,expectedSnapshot,expectedRevision};
      if(migration!==undefined)current.migration=copy(migration);
      current.planSha256=identity({plan:current.plan,configHash,expectedSnapshot,expectedRevision});
      const editions=prior?[...(prior.editions??[]),Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='editions'))]:[];
      if(editions.length>=256)throw fault('WORKBOOK_PLAN_CAPACITY','This mapping has 256 retained editions; create a separately named mapping for continued work.');
      current.editions=editions;
      await save(next=>{
        const position=next.workbookSources.findIndex(x=>x.id===id),item=next.workbookSources[position];
        item.revision++;item.updatedAt=stamp();
        const old=item.plans.findIndex(x=>x.id===current.id);
        if(old<0)item.plans.push(current);else item.plans[old]=current;
      });
      return {source:source(id),plan:plan(id,current.id)};
    },
    async retainParser(content){
      const sha256=digest(content),path=join(roots.parsers,sha256+'.py');
      if(await absent(path)){await createFile(path,content);await chmod(path,0o400);await syncDirectory(roots.parsers);}
      const retained=await readPrivate(path,256*1024);
      if(digest(retained)!==sha256)throw fault('WORKBOOK_PARSER_CHANGED','The retained parser source differs from its identity.',409);
      return {sha256,path,bytes:retained.length};
    },
    async parser(sha256){
      if(!HASH.test(sha256??''))throw fault('WORKBOOK_PARSER_CHANGED');
      const path=join(roots.parsers,sha256+'.py'),content=await readPrivate(path,256*1024);
      if(digest(content)!==sha256)throw fault('WORKBOOK_PARSER_CHANGED');
      return {sha256,path,bytes:content.length};
    },
    async remove(id,expectedSourceRevision){
      const row=source(id);
      if(row.revision!==expectedSourceRevision)throw fault('WORKBOOK_REVIEW_CHANGED','Refresh the saved workbook before removing it.',409);
      if(getState().candidates.some(x=>x.workbookSource?.sourceId===id))
        throw fault('WORKBOOK_IN_USE','A retained candidate still uses this original workbook. Export and explicitly remove that candidate first.',409);
      await save(next=>{next.workbookSources=next.workbookSources.filter(x=>x.id!==id);next.removedWorkbookIds.push(id);});
      await rm(paths(id).directory,{recursive:true,force:true});await syncDirectory(roots.sources);
    },
  };
}
