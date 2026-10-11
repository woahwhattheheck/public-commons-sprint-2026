// MIT. Workbook-edition review inside the original retained publisher workspace.
import { constants } from 'node:fs';
import { open, readFile, mkdir, readdir, rename, rm, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { privateDirectory, readJson, createFile, atomicJson, syncDirectory,
  bytes, digest, identity, fault } from '../../postgres/publisher/files.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const SCHEMA='stellar-forge.workbook-edition-comparison.v1';
const KINDS=new Set(['all','added','removed','changed','source','moved','unchanged','ambiguous']);
const SOURCE_LIMIT=64*1024**2, REPORT_LIMIT=128*1024**2, META_LIMIT=8*1024**2;
const copy=x=>structuredClone(x);
const text=x=>new TextDecoder('utf-8',{fatal:true}).decode(x);
const stamp=()=>new Date().toISOString();
const absent=async path=>{try{await lstat(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
const without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));

function checkedId(value){
  if(!UUID.test(value??''))throw fault('WORKBOOK_COMPARISON_NOT_FOUND','Choose a retained workbook comparison.',404);
  return value;
}
function revision(value,label){
  if(!Number.isSafeInteger(value)||value<1)throw fault('WORKBOOK_REVIEW_REQUIRED','Review the actual '+label+' revision.');
  return value;
}
async function held(path,maximum){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size>maximum)
      throw fault('PRIVATE_WORKBOOK_FILE_REQUIRED','Use the original private retained workbook files within their limits.');
    return file;
  }catch(e){await file.close();throw e;}
}
function planEdition(source,planId,planRevision){
  const current=source.plans.find(x=>x.id===planId);
  const plan=current?.revision===planRevision?current:current?.editions?.find(x=>x.revision===planRevision);
  if(!plan)throw fault('WORKBOOK_PLAN_NOT_FOUND','Choose an exact retained mapping edition.',404);
  if(plan.planSha256!==identity({plan:plan.plan,configHash:plan.configHash,
      expectedSnapshot:plan.expectedSnapshot,expectedRevision:plan.expectedRevision}))
    throw fault('WORKBOOK_PLAN_CHANGED','The retained mapping differs from its reviewed identity.',409);
  return copy(without(plan,'editions'));
}
function summary(source,plan){
  return {sourceId:source.id,filename:source.filename,sha256:source.sha256,
    sourceBytes:source.sourceBytes,sourceRevision:source.revision,
    sheet:plan.plan.sheet,range:plan.plan.range,headerRow:plan.plan.headerRow,
    planId:plan.id??null,planRevision:plan.revision??null,planSha256:plan.planSha256??null};
}
function sourceDescriptor(source,plan,config){
  return {source:{sha256:source.sha256,bytes:source.sourceBytes},plan:copy(plan),config:copy(config)};
}
function workbookChanges(before,after){
  const first=before.workbook?.sheets??[],second=after.workbook?.sheets??[];
  const changes=[];
  for(const sheet of first){
    const next=second.find(x=>x.name===sheet.name);
    if(!next){
      const sameId=second.filter(x=>x.id===sheet.id);
      changes.push({kind:'removed',sheet:sheet.name,before:copy(sheet),after:null,
        possibleRename:sameId.length===1?sameId[0].name:null});
    }else{
      const fields=['state','observedRange','declaredRange','cellCount','rowCount','formulaCells',
        'errorCells','dateCells','hiddenRowCount','columnRanges','mergedRanges','mergedRangeCount','mergedRangesComplete'];
      const changed=fields.filter(name=>identity(sheet[name]??null)!==identity(next[name]??null));
      if(changed.length)changes.push({kind:'changed',sheet:sheet.name,fields:changed,before:copy(sheet),after:copy(next)});
    }
  }
  for(const sheet of second)if(!first.some(x=>x.name===sheet.name))
    changes.push({kind:'added',sheet:sheet.name,before:null,after:copy(sheet)});
  if(before.workbook?.epoch!==after.workbook?.epoch)
    changes.push({kind:'epoch',before:before.workbook?.epoch,after:after.workbook?.epoch});
  if(identity(before.workbook?.calculationProperties??null)!==identity(after.workbook?.calculationProperties??null))
    changes.push({kind:'calculation',before:before.workbook?.calculationProperties??null,after:after.workbook?.calculationProperties??null});
  return changes;
}
function columnChanges(beforeProjection,afterProjection,beforePlan,afterPlan){
  const old=beforeProjection.columns,next=afterProjection.columns;
  const names=[...old.map(x=>x.name),...next.filter(x=>!old.some(y=>y.name===x.name)).map(x=>x.name)];
  return names.map(field=>{
    const before=old.find(x=>x.name===field),after=next.find(x=>x.name===field);
    const first=beforePlan.columns.find(x=>x.name===field),second=afterPlan.columns.find(x=>x.name===field);
    const policies=['blank','formula','error','date','trim','valueMap'].filter(name=>
      identity(first?.[name]??null)!==identity(second?.[name]??null));
    const changes=[];
    if(!before)changes.push('added');
    else if(!after)changes.push('removed');
    else{
      if(before.type!==after.type||before.nullable!==after.nullable)changes.push('schema');
      if(before.sourceColumn!==after.sourceColumn)changes.push('column');
      if(before.sourceHeader!==after.sourceHeader)changes.push('header');
      if(policies.length)changes.push('policy');
    }
    return {field,from:before?.sourceColumn??null,to:after?.sourceColumn??null,
      headerBefore:before?.sourceHeader??null,headerAfter:after?.sourceHeader??null,
      status:changes[0]??'unchanged',changes,policies,before:before??null,after:after??null};
  });
}

/** All source/plan mutations delegate to the original workbook store. Reports
 * are immutable private review artifacts, not another candidate or source index. */
export async function openWorkbookEditions({drafts,sources,python,parserSource,parserSha256,readNative,savePlan}){
  const root=join(drafts.directory,'workbook-comparisons');
  const exports=join(root,'exports');
  await privateDirectory(root,true);await privateDirectory(exports,true);
  for(const name of await readdir(root))if(/^\.pending-[a-f0-9-]{36}$/.test(name))
    await rm(join(root,name),{recursive:true,force:true});
  for(const name of await readdir(exports))if(UUID.test(name))
    await rm(join(exports,name),{recursive:true,force:true});
  const engineSource=await readFile(new URL('./compare.py',import.meta.url));
  if(engineSource.length>256*1024)throw fault('WORKBOOK_COMPARISON_ENGINE_INVALID');
  const engine=text(engineSource),engineSha256=digest(engineSource);
  let tail=Promise.resolve();
  const serial=operation=>{
    const result=tail.then(operation);tail=result.catch(()=>{});return result;
  };
  const paths=id=>{checkedId(id);const directory=join(root,id);return {directory,
    request:join(directory,'request.json'),report:join(directory,'comparison.json'),
    rows:join(directory,'rows.jsonl'),applied:join(directory,'applied.json')};};

  async function worker(request,files){
    const input=Buffer.from(JSON.stringify({...request,parserSha256}));
    if(input.length>2*1024**2)throw fault('WORKBOOK_REQUEST_CAPACITY','Keep the reviewed mapping within 2 MiB.',413);
    return new Promise((resolve,reject)=>{
      let child,problem,total=0,stderr=0;const output=[];
      const stop=error=>{problem??=error;child?.kill('SIGKILL');};
      try{child=spawn(python,['-I','-B','-c',engine],{shell:false,
        stdio:['pipe','pipe','pipe',...files.map(file=>file?file.fd:'ignore')]});}
      catch{reject(fault('WORKBOOK_PYTHON_UNAVAILABLE','Start the original workspace with Python 3.10+.',503));return;}
      const timer=setTimeout(()=>stop(fault('WORKBOOK_COMPARISON_TIMEOUT',
        'The complete workbook comparison exceeded its two-minute processing budget. Select a smaller original range.',422)),120000);
      child.on('error',()=>{problem??=fault('WORKBOOK_PYTHON_UNAVAILABLE','Start the original workspace with Python 3.10+.',503);});
      child.stdin.on('error',()=>{});
      child.stdout.on('data',chunk=>{total+=chunk.length;
        if(total>META_LIMIT)stop(fault('WORKBOOK_COMPARISON_CAPACITY','The workbook comparison metadata exceeds 8 MiB.',422));
        else output.push(chunk);});
      child.stderr.on('data',chunk=>{stderr+=chunk.length;
        if(stderr>65536)stop(fault('WORKBOOK_COMPARISON_FAILED','The original workbook comparison could not complete.',422));});
      child.once('close',code=>{
        clearTimeout(timer);if(problem){reject(problem);return;}
        let envelope;try{envelope=JSON.parse(text(Buffer.concat(output)));}catch{
          reject(fault('WORKBOOK_COMPARISON_FAILED','The workbook comparison returned an incomplete result.',422));return;}
        if(code!==0||envelope.ok!==true){
          const error=fault(/^[A-Z][A-Z0-9_]+$/.test(envelope.error??'')?envelope.error:'WORKBOOK_COMPARISON_FAILED',
            typeof envelope.message==='string'?envelope.message.slice(0,2000):'Review the exact workbook selections.',422);
          if(envelope.details&&bytes(envelope.details).length<=256*1024)error.details=envelope.details;
          reject(error);return;
        }
        resolve(envelope.result);
      });
      child.stdin.end(input);
    });
  }
  async function invoke(before,after,request,output){
    const parser=await sources.retainParser(parserSource),handles=[];
    try{
      const first=await sources.verify(before.id),second=await sources.verify(after.id);
      if(first.record.sha256!==before.sha256||second.record.sha256!==after.sha256)
        throw fault('WORKBOOK_SOURCE_CHANGED','An original workbook changed during review.',409);
      handles.push(await held(first.sourcePath,SOURCE_LIMIT));
      handles.push(await held(second.sourcePath,SOURCE_LIMIT));
      handles.push(output??null);
      handles.push(await held(parser.path,256*1024));
      return await worker(request,handles);
    }finally{await Promise.allSettled(handles.filter(x=>x&&x!==output).map(x=>x.close()));}
  }
  async function report(id){
    const file=paths(id);await privateDirectory(file.directory);
    const comparison=await readJson(file.report,META_LIMIT);
    if(comparison.schema!==SCHEMA||comparison.id!==id||!HASH.test(comparison.sha256??'')||
      comparison.sha256!==identity(without(comparison,'sha256'))||comparison.applied!==null||
      !Number.isSafeInteger(comparison.rows)||comparison.rows<0||
      !Number.isSafeInteger(comparison.rowBytes)||comparison.rowBytes<0||comparison.rowBytes>REPORT_LIMIT||
      !HASH.test(comparison.rowsSha256??'')||!Array.isArray(comparison.rowOffsets))
      throw fault('WORKBOOK_COMPARISON_CHANGED','The retained comparison differs from its original identity.',409);
    const request=await readJson(file.request,META_LIMIT);
    if(identity(request)!==comparison.inputSha256)
      throw fault('WORKBOOK_COMPARISON_CHANGED','The retained comparison request differs from its reviewed identity.',409);
    return {comparison,request,paths:file};
  }
  const rowIdentities=new Map();
  const fileIdentity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
  async function verifiedRows(comparison){
    const file=await held(paths(comparison.id).rows,REPORT_LIMIT);
    try{
      const stat=await file.stat({bigint:true}),signature=fileIdentity(stat);
      if(Number(stat.size)!==comparison.rowBytes)throw fault('WORKBOOK_COMPARISON_CHANGED');
      if(rowIdentities.get(comparison.id)!==signature){
        const hash=createHash('sha256');let offset=0;
        const buffer=Buffer.alloc(1024*1024);
        for(;;){
          const read=await file.read(buffer,0,buffer.length,offset);
          if(!read.bytesRead)break;offset+=read.bytesRead;
          if(offset>comparison.rowBytes)throw fault('WORKBOOK_COMPARISON_CHANGED');
          hash.update(buffer.subarray(0,read.bytesRead));
        }
        if(offset!==comparison.rowBytes||hash.digest('hex')!==comparison.rowsSha256||
          fileIdentity(await file.stat({bigint:true}))!==signature)
          throw fault('WORKBOOK_COMPARISON_CHANGED','The retained row/cell report differs from its completed comparison.',409);
        rowIdentities.set(comparison.id,signature);
      }
      return file;
    }catch(e){await file.close();throw e;}
  }
  function findApplied(comparison){
    let source;try{source=sources.source(comparison.target.sourceId);}catch(e){
      if(e.code==='WORKBOOK_NOT_FOUND')return null;throw e;}
    for(const current of source.plans){
      for(const plan of [current,...(current.editions??[])]){
        if(plan.migration?.comparisonId!==comparison.id)continue;
        const origin=plan.migration;
        if(origin.comparisonSha256!==comparison.sha256||origin.inputSha256!==comparison.inputSha256||
          plan.configHash!==comparison.nativeSchema.configHash||
          plan.expectedSnapshot!==comparison.nativeSchema.snapshot||plan.expectedRevision!==comparison.nativeSchema.revision||
          identity(plan.plan)!==identity(comparison.plan)||plan.planSha256!==identity({
            plan:plan.plan,configHash:plan.configHash,expectedSnapshot:plan.expectedSnapshot,expectedRevision:plan.expectedRevision}))
          throw fault('WORKBOOK_COMPARISON_APPLY_CONFLICT','The saved mapping and its comparison origin disagree.',409);
        return {source,plan:copy(without(plan,'editions')),currentPlanRevision:current.revision};
      }
    }
    return null;
  }
  function receipt(comparison,found){
    return {sourceId:found.source.id,planId:found.plan.id,planRevision:found.plan.revision,
      planSha256:found.plan.planSha256,comparisonId:comparison.id,comparisonSha256:comparison.sha256};
  }
  async function applied(comparison){
    const found=findApplied(comparison);
    if(found)return receipt(comparison,found);
    const path=paths(comparison.id).applied;
    if(await absent(path))return null;
    const saved=await readJson(path,65536);
    if(saved.comparisonId!==comparison.id||saved.comparisonSha256!==comparison.sha256||
      saved.sourceId!==comparison.target.sourceId||!UUID.test(saved.planId??'')||
      !HASH.test(saved.planSha256??'')||!Number.isSafeInteger(saved.planRevision)||saved.planRevision<1)
      throw fault('WORKBOOK_COMPARISON_APPLY_CONFLICT','The retained mapping-adoption receipt needs repair.',409);
    return {...saved,sourceRemoved:true};
  }
  async function publicReport(comparison){
    return {...copy(comparison),applied:await applied(comparison)};
  }
  async function page(comparison,input={}){
    const offset=input.offset??0,limit=input.limit??50,kind=input.kind??'all';
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100||!KINDS.has(kind))
      throw fault('INVALID_WORKBOOK_COMPARISON_PAGE','Choose a row offset, 1–100 rows and a displayed change kind.');
    const total=kind==='all'?comparison.rows:kind==='moved'?comparison.positionsChanged:comparison.counts[kind];
    const rows=[];let nextOffset=null,size=0;
    const file=await verifiedRows(comparison);
    let stream,lines;
    try{
      if(offset>=total)return {rows,offset,limit,kind,total,nextOffset};
      // Offset counts rows in the selected view. Physical/union ordinals stay
      // in each row for provenance and never leak into the pagination cursor.
      stream=file.createReadStream({autoClose:false,start:0});
      lines=createInterface({input:stream,crlfDelay:Infinity});
      let ordinal=0,selected=0;
      for await(const line of lines){
        const row=JSON.parse(line);
        if(row.ordinal!==ordinal++)throw fault('WORKBOOK_COMPARISON_CHANGED','The retained row index is inconsistent.',409);
        if(kind==='moved'?!row.moved:kind!=='all'&&row.kind!==kind)continue;
        if(selected++<offset)continue;
        const length=Buffer.byteLength(line);
        if(rows.length>=limit||size+length>4*1024**2){
          if(!rows.length)throw fault('WORKBOOK_COMPARISON_ROW_TOO_LARGE',
            'This complete row exceeds the screen response limit. Download the full private comparison to inspect it.',422);
          nextOffset=offset+rows.length;break;
        }
        rows.push(row);size+=length;
      }
      return {rows,offset,limit,kind,total,nextOffset};
    }finally{lines?.close();stream?.destroy();await file.close();}
  }
  async function read(input){
    const saved=await report(checkedId(input.id));
    return {comparison:await publicReport(saved.comparison),page:await page(saved.comparison,input)};
  }
  function compareInput(input){
    const result={id:checkedId(input.id),sourceId:checkedId(input.sourceId),planId:checkedId(input.planId),
      planRevision:revision(input.planRevision,'baseline mapping'),targetId:checkedId(input.targetId),
      expectedTargetRevision:revision(input.expectedTargetRevision,'replacement workbook'),
      plan:copy(input.plan),keys:copy(input.keys),expectedSnapshot:input.expectedSnapshot,
      expectedRevision:revision(input.expectedRevision,'native publication')};
    if(!HASH.test(result.expectedSnapshot??'')||!Array.isArray(result.keys)||result.keys.length<1||
      result.keys.length>16||result.keys.some(x=>typeof x!=='string')||new Set(result.keys).size!==result.keys.length)
      throw fault('WORKBOOK_REVIEW_REQUIRED','Review the original publication and select distinct row keys.');
    if(!result.plan||typeof result.plan!=='object'||Array.isArray(result.plan))
      throw fault('INVALID_WORKBOOK_PLAN','Review the complete replacement mapping.');
    for(const [name,maximum,required] of [['name',160,true],['notes',2000,false]]){
      const value=result.plan[name];
      if(typeof value!=='string'||value.length>maximum||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||required&&!value.trim())
        throw fault('INVALID_WORKBOOK_TEXT','Use a clear mapping name and notes within their displayed limits.');
      result.plan[name]=value.trim();
    }
    return result;
  }
  const api={
    async list(){
      const comparisons=[],warnings=[];
      for(const name of await readdir(root)){
        if(!UUID.test(name))continue;
        try{
          const {comparison}=await report(name);
          comparisons.push({id:name,createdAt:comparison.createdAt,baseline:comparison.baseline,target:comparison.target,
            counts:comparison.counts,keys:comparison.keys,sha256:comparison.sha256,applied:await applied(comparison)});
        }catch(e){warnings.push({id:name,code:e.code??'WORKBOOK_COMPARISON_CHANGED'});}
      }
      comparisons.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      return {comparisons,warnings};
    },
    async suggest(input){
      const before=sources.source(input.sourceId),after=sources.source(input.targetId);
      const baseline=planEdition(before,input.planId,revision(input.planRevision,'baseline mapping'));
      const native=await readNative();
      const plan={...copy(baseline.plan),sheet:input.sheet??baseline.plan.sheet,
        range:input.range??baseline.plan.range,headerRow:input.headerRow===undefined?baseline.plan.headerRow:input.headerRow};
      const inspected=await invoke(before,after,{action:'headers',
        baseline:sourceDescriptor(before,baseline.plan,baseline.config),
        target:sourceDescriptor(after,plan,native.current.config)});
      const choices=inspected.target.headers.map(x=>({source:x.source,header:x.header}));
      const columnMappings=[];
      plan.columns=native.summary.columns.map(spec=>{
        const prior=baseline.plan.columns.find(x=>x.name===spec.name);
        const oldHeader=inspected.baseline.headers.find(x=>x.source===prior?.source);
        const matches=oldHeader?.header===null||oldHeader?.header===undefined?[]:
          inspected.target.headers.filter(x=>x.header===oldHeader.header);
        const source=matches.length===1?matches[0].source:'';
        const binding=prior?{...copy(prior),source}:{name:spec.name,source,blank:spec.nullable?'null':'reject',
          formula:'reject',error:'reject',date:'raw',trim:false,valueMap:[]};
        columnMappings.push({field:spec.name,type:spec.type,nullable:spec.nullable,
          beforeSource:prior?.source??null,beforeHeader:oldHeader?.header??null,source,
          status:!prior?'new-field':matches.length===1?(source===prior.source?'matched':'moved'):
            matches.length>1?'ambiguous':'unresolved',choices:copy(choices)});
        return binding;
      });
      return {baseline:summary(before,baseline),target:summary(after,{plan}),
        expectedTargetRevision:after.revision,plan,columnMappings,
        workbookChanges:workbookChanges(before,after),nativeSchema:native.summary};
    },
    compare(input){return serial(async()=>{
      const request=compareInput(input),file=paths(request.id);
      if(!await absent(file.directory)){
        const previous=await report(request.id);
        if(identity(request)!==previous.comparison.inputSha256)
          throw fault('WORKBOOK_COMPARISON_ID_CONFLICT','This comparison ID already belongs to a different reviewed operation.',409);
        return {...await read({id:request.id}),reused:true};
      }
      const before=sources.source(request.sourceId),after=sources.source(request.targetId);
      const baseline=planEdition(before,request.planId,request.planRevision);
      if(after.revision!==request.expectedTargetRevision)
        throw fault('WORKBOOK_REVIEW_CHANGED','The replacement workbook mapping index changed. Reopen it before comparison.',409);
      const native=await readNative();
      if(native.summary.snapshot!==request.expectedSnapshot||native.summary.revision!==request.expectedRevision)
        throw fault('WORKBOOK_NATIVE_REVIEW_CHANGED','The publication changed. Review its current public schema before comparison.',409);
      const pending=join(root,'.pending-'+request.id);await mkdir(pending,{mode:0o700});
      let completed=false,output;
      try{
        output=await open(join(pending,'rows.jsonl'),'wx',0o600);
        const result=await invoke(before,after,{action:'compare',keys:request.keys,maxReportBytes:REPORT_LIMIT,
          baseline:sourceDescriptor(before,baseline.plan,baseline.config),
          target:sourceDescriptor(after,request.plan,native.current.config)},output);
        await output.sync();await output.close();output=null;
        if(result.complete!==true||!HASH.test(result.rowsSha256??'')||
          result.baselineProjection?.sourceSha256!==before.sha256||result.targetProjection?.sourceSha256!==after.sha256)
          throw fault('WORKBOOK_COMPARISON_INCOMPLETE','The original reader did not finish both complete projections.',422);
        const comparison={...result,schema:SCHEMA,id:request.id,requestId:request.id,createdAt:stamp(),
          inputSha256:identity(request),baseline:summary(before,baseline),target:summary(after,{plan:request.plan}),
          expectedTargetRevision:request.expectedTargetRevision,nativeSchema:copy(native.summary),
          plan:copy(request.plan),columnChanges:columnChanges(result.baselineProjection,result.targetProjection,baseline.plan,request.plan),
          workbookChanges:workbookChanges(before,after),parserSha256,engineSha256,applied:null};
        comparison.sha256=identity(comparison);
        if(bytes(comparison).length>META_LIMIT)throw fault('WORKBOOK_COMPARISON_CAPACITY','The complete comparison metadata exceeds 8 MiB.',422);
        await createFile(join(pending,'request.json'),bytes(request));
        await createFile(join(pending,'comparison.json'),bytes(comparison));
        for(const name of ['rows.jsonl','request.json','comparison.json'])await chmod(join(pending,name),0o400);
        await syncDirectory(pending);
        await rename(pending,file.directory);completed=true;await syncDirectory(root);
        return {...await read({id:request.id}),reused:false};
      }finally{await output?.close();if(!completed)await rm(pending,{recursive:true,force:true});}
    });},
    read,
    apply(input){return serial(async()=>{
      const {comparison}=await report(checkedId(input.id));
      if(input.sha256!==comparison.sha256||input.expectedTargetRevision!==comparison.expectedTargetRevision||
        input.expectedSnapshot!==comparison.nativeSchema.snapshot||input.expectedRevision!==comparison.nativeSchema.revision)
        throw fault('WORKBOOK_COMPARISON_REVIEW_CHANGED','Apply the exact displayed comparison and its original review revisions.',409);
      const rows=await verifiedRows(comparison);await rows.close();
      let found=findApplied(comparison),reused=!!found;
      if(!found){
        const after=sources.source(comparison.target.sourceId);
        if(after.sha256!==comparison.target.sha256||after.revision!==comparison.expectedTargetRevision)
          throw fault('WORKBOOK_REVIEW_CHANGED','The replacement workbook changed after comparison. Review a new comparison before adopting its mapping.',409);
        const native=await readNative();
        if(native.summary.snapshot!==comparison.nativeSchema.snapshot||native.summary.revision!==comparison.nativeSchema.revision||
          native.summary.configHash!==comparison.nativeSchema.configHash)
          throw fault('WORKBOOK_NATIVE_REVIEW_CHANGED','The original publication changed after comparison. Review a new comparison before adopting this mapping.',409);
        await savePlan({id:after.id,planId:null,expectedSourceRevision:comparison.expectedTargetRevision,
          expectedPlanRevision:null,expectedSnapshot:comparison.nativeSchema.snapshot,expectedRevision:comparison.nativeSchema.revision,
          plan:copy(comparison.plan)},{
          comparisonId:comparison.id,comparisonSha256:comparison.sha256,inputSha256:comparison.inputSha256,
          baselineSourceId:comparison.baseline.sourceId,baselinePlanId:comparison.baseline.planId,
          baselinePlanRevision:comparison.baseline.planRevision});
        found=findApplied(comparison);
        if(!found)throw fault('WORKBOOK_COMPARISON_APPLY_INCOMPLETE','Reopen this same workspace to recover the original mapping save.',409);
      }
      await atomicJson(paths(comparison.id).directory,'applied.json',receipt(comparison,found));
      return {source:found.source,plan:found.plan,comparison:await publicReport(comparison),reused,
        currentPlanRevision:found.currentPlanRevision};
    });},
    async export(input){
      const {comparison}=await report(checkedId(input.id)),rowFile=await verifiedRows(comparison);
      const id=randomUUID(),directory=join(exports,id);await mkdir(directory,{mode:0o700});
      let file,success=false;
      try{
        file=await open(join(directory,'comparison.json'),'wx+',0o600);
        const document=await publicReport(comparison);
        await file.writeFile('{"comparison":'+JSON.stringify(document)+',"rows":[');
        const stream=rowFile.createReadStream({autoClose:false,start:0});
        const lines=createInterface({input:stream,crlfDelay:Infinity});let count=0;
        try{for await(const line of lines){
          const row=JSON.parse(line);if(row.ordinal!==count)throw fault('WORKBOOK_COMPARISON_CHANGED');
          await file.writeFile((count?',':'')+line);count++;
        }}finally{lines.close();stream.destroy();}
        if(count!==comparison.rows)throw fault('WORKBOOK_COMPARISON_CHANGED');
        await file.writeFile(']}\n');await file.sync();const stat=await file.stat();success=true;
        return {file,filename:'workbook-comparison-'+comparison.id+'.json',contentType:'application/json',length:stat.size,
          dispose:async()=>{await file.close();await rm(directory,{recursive:true,force:true});}};
      }finally{
        await rowFile.close();
        if(!success){await file?.close();await rm(directory,{recursive:true,force:true});}
      }
    },
  };
  return api;
}
