// MIT. Complete received supplier-cost packages on the original native cost stores.
import { open, readdir, rename, rm, link, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectBundle, MAX_BUNDLE } from './archive.mjs';
import { normalizeBook, costReport } from './engine.mjs';
import { sourceMetadata } from './inputs.mjs';
import { UUID, SHA, MAX_SOURCE, MAX_DOCUMENT, plain, canonical, encode, digest, fault, string,
  id, privateDir, readPrivate, writeOnce, hashPrivate, checkedFile, syncDir, utf8 } from './common.mjs';

const PART_BYTES=8*1024*1024;
const RECEIPT='stellar-forge.received-cost-package.v1';
const DRAFT='stellar-forge.received-cost-draft.v1';
const originSchema='stellar-forge.received-cost-origin.v1';
const sourceOrigin='COST_PACKAGE_RECEIVING';
const fileName=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const fail=(code,message,status=422)=>fault('COST_RECEIVING_'+code,message,status);
const json=bytes=>JSON.parse(utf8(bytes,'Received cost JSON'));
const nativePath=name=>typeof name==='string'&&name.split('/').every(x=>fileName.test(x)&&x!=='.'&&x!=='..');

function allowed(name){
  if(!nativePath(name))return false;
  const parts=name.split('/');
  if(parts[0]==='cost')return parts.length===2;
  if(parts[0]==='pricing')return parts.length>=2;
  if(parts[0]==='originals')return parts.length===3&&UUID.test(parts[1])&&['original','source.json'].includes(parts[2]);
  if(parts[0]==='lineage'&&UUID.test(parts[1])){
    return parts.length===3&&parts[2]==='receipt.json'||
      parts.length===4&&parts[2]==='parts'&&/^[0-9]{6}\.part$/.test(parts[3])||
      parts.length===4&&parts[2]==='drafts'&&UUID.test(parts[3].replace(/\.json$/,''))&&parts[3].endsWith('.json');
  }
  return false;
}
function sourceIdentity(source){
  const value=digest('stellar-forge.received-cost-source.v1\n'+source.sourceId+'\n'+source.receiptSha256).slice(0,32);
  return value.slice(0,8)+'-'+value.slice(8,12)+'-8'+value.slice(13,16)+'-a'+value.slice(17,20)+'-'+value.slice(20);
}
function requireHash(value,label){
  if(!SHA.test(value??''))throw fail('HASH_REQUIRED','Use the original '+label+' SHA-256.');return value;
}
async function atomicJson(path,value,temporaryRoot){
  const temporary=join(temporaryRoot,'draft-'+randomUUID());
  try{
    await writeOnce(temporary,encode(value));
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;return false;}
    await syncDir(join(path,'..'));return true;
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
}
async function descriptorFiles(root,prefix,manifest,files){
  if(!plain(manifest.files))throw fail('MANIFEST_INVALID','The original edition file manifest is incomplete.');
  for(const [name,expected]of Object.entries(manifest.files)){
    if(!nativePath(name)||!plain(expected)||!Number.isSafeInteger(expected.bytes)||!SHA.test(expected.sha256??''))
      throw fail('MANIFEST_INVALID','An original edition file has an invalid descriptor.');
    const actual=files.get(prefix+name);
    if(!actual||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)
      throw fail('MANIFEST_CHANGED','The received original file differs from its edition manifest: '+prefix+name);
  }
}
async function originalPackage(root,result){
  const descriptor=result.descriptor,files=new Map(result.manifest.files.map(row=>[row.name,row]));
  if(descriptor.schema!=='stellar-forge.merchant-cost-export.v1'||descriptor.kind!=='COST_EDITION'||
      !UUID.test(descriptor.edition??'')||!SHA.test(descriptor.revision??'')||!UUID.test(descriptor.pricingVersion??'')||
      !UUID.test(descriptor.requestId??'')||!SHA.test(descriptor.requestSha256??''))
    throw fail('EDITION_REQUIRED','Choose a complete original COST_EDITION TAR from Supplier costs.');
  async function bytes(name,max=MAX_DOCUMENT){return checkedFile(root,name,files.get(name),max);}
  const manifestBytes=await bytes('cost/manifest.json'),manifest=json(manifestBytes);
  if(manifest.schema!=='stellar-forge.merchant-cost-edition.v1'||manifest.edition!==descriptor.edition||
      manifest.pricingVersion!==descriptor.pricingVersion||digest(manifestBytes)!==descriptor.revision)
    throw fail('EDITION_CHANGED','The original cost edition and package descriptor disagree.');
  await descriptorFiles(root,'cost/',manifest,files);
  const [input,report,binding,sourceIndex,pricingManifest]=await Promise.all([
    'cost/input.json','cost/report.json','cost/binding.json','cost/source-index.json','pricing/manifest.json'
  ].map(async name=>json(await bytes(name))));
  if(binding.schema!=='stellar-forge.merchant-cost-binding.v1'||binding.pricingVersion!==descriptor.pricingVersion||
      input.pricingVersion!==descriptor.pricingVersion||pricingManifest.version!==descriptor.pricingVersion||
      digest(await bytes('pricing/manifest.json'))!==binding.pricingRevision||
      pricingManifest.sellerSha256!==binding.sellerSha256||
      !Array.isArray(binding.sources)||!Array.isArray(sourceIndex))
    throw fail('PRICING_CHANGED','The received cost edition lacks its exact original pricing/source binding.');
  await descriptorFiles(root,'pricing/',pricingManifest,files);
  const pricingBytes=await bytes('pricing/report/report.json'),pricing=json(pricingBytes);
  if(digest(pricingBytes)!==binding.pricingReportSha256||
      digest(await bytes('cost/original-pricing-report.json'))!==binding.pricingReportSha256)
    throw fail('PRICING_CHANGED','The original pricing report no longer matches the cost source.');
  const originals=[],seen=new Set(),sourceIndexById=new Map(sourceIndex.map(row=>[row.sourceId,row]));
  for(const source of binding.sources){
    if(!plain(source)||!UUID.test(source.sourceId??'')||seen.has(source.sourceId)||
        !SHA.test(source.sha256??'')||!SHA.test(source.receiptSha256??'')||
        !Number.isSafeInteger(source.bytes)||source.bytes<1||source.bytes>MAX_SOURCE)
      throw fail('SOURCE_INVALID','The original cost-source binding is invalid.');
    seen.add(source.sourceId);
    const receiptBytes=await bytes('originals/'+source.sourceId+'/source.json'),receipt=json(receiptBytes);
    const actual=files.get('originals/'+source.sourceId+'/original'),indexed=sourceIndexById.get(source.sourceId);
    if(receipt.schema!=='stellar-forge.merchant-cost-source.v1'||receipt.sourceId!==source.sourceId||
        receipt.bytes!==source.bytes||receipt.sha256!==source.sha256||digest(receiptBytes)!==source.receiptSha256||
        !actual||actual.bytes!==source.bytes||actual.sha256!==source.sha256||
        !indexed||canonical(indexed)!==canonical({...receipt,receiptSha256:source.receiptSha256}))
      throw fail('SOURCE_CHANGED','A retained supplier original no longer matches its exact source binding.');
    const metadata=sourceMetadata(receipt.metadata);
    if(canonical(metadata)!==canonical(receipt.metadata)||
        receipt.requestSha256!==digest(canonical({metadata,sha256:receipt.sha256,bytes:receipt.bytes,origin:receipt.origin})))
      throw fail('SOURCE_CHANGED','An original source metadata/request identity is inconsistent.');
    originals.push({...receipt,receiptSha256:source.receiptSha256,localSourceId:sourceIdentity(source)});
  }
  if(sourceIndex.length!==originals.length||result.manifest.files.some(row=>
      row.name.startsWith('originals/')&&!seen.has(row.name.split('/')[1])))
    throw fail('SOURCE_INVALID','The complete package original set must match its cost edition.');
  const sourceMap=new Map(originals.map(row=>[row.sourceId,row]));
  const normalized=normalizeBook(input,pricing,sourceMap);
  // Preserve the original saved arithmetic. Native validation confirms that the
  // complete input still obeys the same monetary/source/coverage contract.
  if(canonical({...input,receivedFrom:undefined})!==canonical(normalized))
    throw fail('INPUT_CHANGED','The saved cost input is not the complete normalized native edition.');
  if(report.schema!=='stellar-forge.merchant-route-cost-report.v1'||report.pricingVersion!==descriptor.pricingVersion)
    throw fail('REPORT_CHANGED','The selected report belongs to a different cost/pricing source.');
  return {descriptor,manifest,input,report,binding,pricing,originals,files:result.manifest.files};
}
async function extract(path,directory,expectedHash){
  await privateDir(directory,true);
  const result=await inspectBundle(path,{onStart:descriptor=>{
    if(descriptor?.kind!=='COST_EDITION')throw fail('EDITION_REQUIRED','Choose an original COST_EDITION TAR.');
  },onFile:async entry=>{
    if(!allowed(entry.name))throw fail('MEMBER_INVALID','The package contains an unsupported cost-review member.');
    let parent=directory;const parts=entry.name.split('/');
    for(const part of parts.slice(0,-1)){parent=join(parent,part);await privateDir(parent,true);}
    const handle=await open(join(parent,parts.at(-1)),'wx',0o600);let closed=false;
    return {write:bytes=>handle.writeFile(bytes),close:async()=>{await handle.sync();await handle.close();closed=true;},
      abort:async()=>{if(!closed)await handle.close().catch(()=>{});}};
  }});
  if(expectedHash!==undefined&&result.sha256!==expectedHash)
    throw fail('ARCHIVE_CHANGED','The received package differs from the reviewed complete archive.',409);
  const original=await originalPackage(directory,result);await syncDir(directory);
  return {result,original};
}

export async function openCostReceiving({root,sources,pricingSource}){
  await privateDir(root,true);
  const records=join(root,'records'),pending=join(root,'pending');
  await privateDir(records,true);await privateDir(pending,true);
  const inflight=new Map();
  const folder=packageId=>join(records,id(packageId,'Received package'));
  async function record(packageId){
    const value=json(await readPrivate(join(folder(packageId),'receipt.json')));
    if(value.schema!==RECEIPT||value.packageId!==packageId||value.requestId!==packageId||
        !SHA.test(value.sha256??'')||!Number.isSafeInteger(value.bytes)||value.bytes<1024||value.bytes>MAX_BUNDLE||
        !Array.isArray(value.parts)||!value.parts.length||value.parts.length>Math.ceil(MAX_BUNDLE/PART_BYTES)||
        !Array.isArray(value.files)||!plain(value.descriptor))
      throw fail('RECEIPT_CHANGED','The received package record is invalid.');
    const names=new Set();
    if(value.files.length>100000)throw fail('RECEIPT_CHANGED','The received file set exceeds its native limit.');
    for(const file of value.files){
      if(!plain(file)||!allowed(file.name)||names.has(file.name)||!Number.isSafeInteger(file.bytes)||
          file.bytes<0||file.bytes>64*1024*1024||!SHA.test(file.sha256??''))
        throw fail('RECEIPT_CHANGED','The received original file set is inconsistent.');
      names.add(file.name);
    }
    let count=0;
    for(let index=0;index<value.parts.length;index++){
      const part=value.parts[index];
      if(part.name!=='parts/'+String(index).padStart(6,'0')+'.part'||!SHA.test(part.sha256??'')||
          !Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>PART_BYTES||
          index<value.parts.length-1&&part.bytes!==PART_BYTES)throw fail('RECEIPT_CHANGED','The complete archive parts are invalid.');
      count+=part.bytes;
    }
    if(count!==value.bytes)throw fail('RECEIPT_CHANGED','The retained archive parts are incomplete.');
    return value;
  }
  function summary(value){return {packageId:value.packageId,requestId:value.requestId,label:value.label,name:value.name,
    receivedAt:value.receivedAt,sha256:value.sha256,bytes:value.bytes,fileCount:value.files.length,
    edition:value.descriptor.edition,revision:value.descriptor.revision,pricingVersion:value.descriptor.pricingVersion,
    sourceCount:value.sourceCount,lineCount:value.lineCount,period:value.period,
    download:'/cost-files/received/'+value.packageId};}
  async function list(){
    const rows=[];
    for(const item of await readdir(records,{withFileTypes:true})){
      if(!item.isDirectory()||!UUID.test(item.name))throw fail('DIRECTORY_CHANGED','Unexpected received package entry.');
      rows.push(summary(await record(item.name)));
    }
    return rows.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.packageId.localeCompare(b.packageId));
  }
  async function archiveFile(packageId){
    const selected=await record(packageId),base=folder(packageId),path=join(base,'archive.tar');
    try{
      const current=await hashPrivate(path,MAX_BUNDLE);
      if(current.bytes!==selected.bytes||current.sha256!==selected.sha256)throw fail('ARCHIVE_CHANGED','The cached original archive has changed.');
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      const temporary=join(pending,'archive-'+randomUUID()),handle=await open(temporary,'wx',0o600),hash=createHash('sha256');
      let bytes=0,closed=false;
      try{
        for(const part of selected.parts){
          const raw=await checkedFile(base,part.name,part,PART_BYTES);hash.update(raw);bytes+=raw.length;await handle.writeFile(raw);
        }
        if(bytes!==selected.bytes||hash.digest('hex')!==selected.sha256)
          throw fail('ARCHIVE_CHANGED','The retained parts do not reconstruct the original archive.');
        await handle.sync();await handle.close();closed=true;
        try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;
          const winner=await hashPrivate(path,MAX_BUNDLE);
          if(winner.bytes!==selected.bytes||winner.sha256!==selected.sha256)throw fail('ARCHIVE_CHANGED','The original archive cache differs.');}
        await syncDir(base);
      }finally{if(!closed)await handle.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});}
    }
    return {path,bytes:selected.bytes,sha256:selected.sha256,filename:packageId+'.tar'};
  }
  async function ensureFiles(packageId){
    const target=join(folder(packageId),'files');
    try{await privateDir(target);return target;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(inflight.has(packageId))return inflight.get(packageId);
    const operation=(async()=>{
      const selected=await record(packageId),archive=await archiveFile(packageId),temporary=join(pending,'files-'+randomUUID());
      let moved=false;
      try{
        const {result}=await extract(archive.path,temporary,selected.sha256);
        if(canonical(result.descriptor)!==canonical(selected.descriptor)||canonical(result.manifest.files)!==canonical(selected.files))
          throw fail('RECEIPT_CHANGED','The original archive no longer matches its received record.');
        try{await rename(temporary,target);moved=true;}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;await privateDir(target);}
        await syncDir(folder(packageId));return target;
      }finally{if(!moved)await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
    })();
    inflight.set(packageId,operation);
    try{return await operation;}finally{if(inflight.get(packageId)===operation)inflight.delete(packageId);}
  }
  async function original(packageId){
    const selected=await record(packageId),base=await ensureFiles(packageId);
    return originalPackage(base,{descriptor:selected.descriptor,manifest:{files:selected.files}});
  }
  async function inspect(packageId){
    const selected=await record(packageId),value=await original(packageId);
    return {...summary(selected),input:value.input,report:value.report,pricing:value.pricing,binding:value.binding,
      sources:value.originals,files:selected.files.map(row=>({...row,download:'/cost-files/received/'+packageId+'/'+row.name.split('/').map(encodeURIComponent).join('/')}))};
  }
  async function download(packageId,name){
    const selected=await record(packageId),member=selected.files.find(row=>row.name===name);
    if(!member||!allowed(name))throw fail('FILE_NOT_FOUND','Choose a complete original member from this package.',404);
    const base=await ensureFiles(packageId);
    return {bytes:await checkedFile(base,name,member,64*1024*1024),name:name.split('/').at(-1),sha256:member.sha256};
  }
  async function receive({requestId,label,name,body,expectedSha256,expectedBytes}){
    id(requestId,'Receiving request');label=string(label,'Received review name',160);name=string(name,'Original archive filename',180);
    if(expectedSha256!==undefined)requireHash(expectedSha256,'archive');
    if(expectedBytes!==undefined&&(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>MAX_BUNDLE))
      throw fail('SIZE_INVALID','The selected archive must be within 512 MiB.');
    const temporary=join(pending,'receive-'+randomUUID());await privateDir(temporary,true);let moved=false;
    try{
      const path=join(temporary,'archive.tar'),handle=await open(path,'wx',0o600),hash=createHash('sha256');let bytes=0;
      try{
        for await(const chunk of body){const raw=Buffer.from(chunk);bytes+=raw.length;
          if(bytes>MAX_BUNDLE)throw fail('TOO_LARGE','Complete cost packages are limited to 512 MiB.',413);
          hash.update(raw);await handle.writeFile(raw);}
        await handle.sync();
      }finally{await handle.close();}
      const sha256=hash.digest('hex');
      if(expectedSha256!==undefined&&expectedSha256!==sha256||expectedBytes!==undefined&&expectedBytes!==bytes)
        throw fail('ARCHIVE_CHANGED','The uploaded original differs from its selected bytes or SHA-256.',409);
      const requestSha256=digest(canonical({sha256,bytes,label,name}));
      try{
        const previous=await record(requestId);
        if(previous.requestSha256!==requestSha256)throw fail('REQUEST_CHANGED','This receiving request already identifies another original archive or label.',409);
        return {status:'COST_PACKAGE_RECEIVED',...summary(previous),replayed:true};
      }catch(error){if(error.code!=='ENOENT')throw error;}
      const {result,original:value}=await extract(path,join(temporary,'files'),sha256);
      const partsRoot=join(temporary,'parts');await privateDir(partsRoot,true);
      const archive=await open(path,constants.O_RDONLY),parts=[];let offset=0;
      try{
        while(offset<bytes){
          const raw=Buffer.alloc(Math.min(PART_BYTES,bytes-offset));let used=0;
          while(used<raw.length){const read=await archive.read(raw,used,raw.length-used,offset+used);
            if(!read.bytesRead)throw fail('ARCHIVE_CHANGED','The original archive ended while retaining its parts.');used+=read.bytesRead;}
          const partName='parts/'+String(parts.length).padStart(6,'0')+'.part';
          await writeOnce(join(temporary,partName),raw);parts.push({name:partName,bytes:raw.length,sha256:digest(raw)});offset+=raw.length;
        }
      }finally{await archive.close();}
      await syncDir(partsRoot);await privateDir(join(temporary,'drafts'),true);
      const receipt={schema:RECEIPT,packageId:requestId,requestId,requestSha256,label,name,
        receivedAt:new Date().toISOString(),sha256,bytes,descriptor:result.descriptor,files:result.manifest.files,parts,
        sourceCount:value.originals.length,lineCount:value.input.lines.length,period:value.input.period};
      await writeOnce(join(temporary,'receipt.json'),encode(receipt));
      // The exact immutable parts preserve all bytes; extracted files are a
      // verified reading cache. A download reconstructs one original TAR.
      await rm(path);await syncDir(temporary);
      try{await rename(temporary,folder(requestId));moved=true;}
      catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;const winner=await record(requestId);
        if(winner.requestSha256!==requestSha256)throw fail('REQUEST_CHANGED','Another package owns this receiving request.',409);
        return {status:'COST_PACKAGE_RECEIVED',...summary(winner),replayed:true};}
      await syncDir(records);return {status:'COST_PACKAGE_RECEIVED',...summary(receipt),replayed:false};
    }finally{if(!moved)await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
  }
  async function reviewDraft(input){
    id(input.packageId,'Received package');requireHash(input.expectedPackageSha256,'received package');
    id(input.pricingVersion,'Local saved pricing review');requireHash(input.expectedPricingReportSha256,'local pricing report');
    const selected=await record(input.packageId),value=await original(input.packageId),pricing=await pricingSource(input.pricingVersion);
    if(selected.sha256!==input.expectedPackageSha256||digest(pricing.reportBytes)!==input.expectedPricingReportSha256)
      throw fail('SELECTION_CHANGED','Reopen the exact received package and selected local pricing review.',409);
    if(!Array.isArray(input.routeMappings)||input.routeMappings.length!==value.pricing.routes.length)
      throw fail('ROUTES_REQUIRED','Map every original route to one distinct local route or explicitly leave it unassigned.');
    const originalRoutes=new Map(value.pricing.routes.map(row=>[row.routeId,row]));
    const localRoutes=new Set(pricing.report.routes.map(row=>row.routeId)),mapping=new Map(),used=new Set();
    for(const row of input.routeMappings){
      if(!plain(row)||!originalRoutes.has(row.from)||mapping.has(row.from)||row.to!==null&&(!localRoutes.has(row.to)||used.has(row.to)))
        throw fail('ROUTE_MAPPING_INVALID','Use each original route once and each selected local route at most once.');
      mapping.set(row.from,row.to);if(row.to!==null)used.add(row.to);
    }
    const sourceMappings=value.originals.map(row=>({originalSourceId:row.sourceId,originalReceiptSha256:row.receiptSha256,
      localSourceId:row.localSourceId,sha256:row.sha256,bytes:row.bytes}));
    const sourceMap=new Map(value.originals.map(row=>[row.sourceId,row.localSourceId]));
    const book=structuredClone(value.input);delete book.receivedFrom;
    book.pricingVersion=input.pricingVersion;book.label=string(input.label,'Local cost review name',160);
    book.reason=string(input.reason,'Receiving and allocation reason',2000);
    book.periodAlignment={confirmed:false,reason:''};
    book.coverage=pricing.report.routes.map(row=>({routeId:row.routeId,state:'UNKNOWN',note:'',zeroCostConfirmed:false}));
    book.contextSourceIds=book.contextSourceIds.map(sourceId=>sourceMap.get(sourceId));
    book.imports=book.imports.map(row=>({...row,sourceId:sourceMap.get(row.sourceId)}));
    const lineMappings=[];
    book.lines=book.lines.map(row=>{
      const localSourceId=sourceMap.get(row.sourceId),lineId=localSourceId+':'+
        (row.sourceRow===null?'manual-'+digest(row.id).slice(0,24):row.sourceRow);
      lineMappings.push({originalLineId:row.id,localLineId:lineId,originalSourceId:row.sourceId,localSourceId});
      return {...row,id:lineId,sourceId:localSourceId,allocations:row.allocations.flatMap(allocation=>{
        const routeId=mapping.get(allocation.routeId);
        return routeId===null?[]:[{...allocation,routeId,basis:'EXPLICIT_AMOUNT',weight:null}];
      })};
    });
    const localSources=new Map(value.originals.map(row=>[row.localSourceId,{...row,sourceId:row.localSourceId}]));
    const normalized=normalizeBook(book,pricing.report,localSources);
    const origin={schema:originSchema,packageId:input.packageId,archiveSha256:selected.sha256,
      originalEdition:value.descriptor.edition,originalEditionRevision:value.descriptor.revision,
      originalPricingVersion:value.descriptor.pricingVersion,originalPricingReportSha256:value.binding.pricingReportSha256,
      pricingVersion:input.pricingVersion,pricingReportSha256:input.expectedPricingReportSha256,
      routeMappings:input.routeMappings.map(row=>({from:row.from,to:row.to})),sourceMappings,lineMappings,
      period:normalized.period,reason:normalized.reason};
    const selection={packageId:input.packageId,expectedPackageSha256:input.expectedPackageSha256,
      pricingVersion:input.pricingVersion,expectedPricingReportSha256:input.expectedPricingReportSha256,
      routeMappings:origin.routeMappings,label:normalized.label,reason:normalized.reason};
    return {selection,origin,book:normalized,report:costReport(normalized,pricing.report,localSources),
      sourceSummary:value.originals.map(row=>({sourceId:row.sourceId,localSourceId:row.localSourceId,metadata:row.metadata,sha256:row.sha256,bytes:row.bytes})),
      reviewSha256:digest(canonical({selection,origin,book:normalized})),
      sellerChanged:pricing.sellerChanged};
  }
  async function savedDraft(packageId,requestId){
    id(requestId,'Received draft request');
    const selected=await record(packageId),value=json(await readPrivate(join(folder(packageId),'drafts',requestId+'.json'),64*1024*1024));
    if(value.schema!==DRAFT||value.requestId!==requestId||value.packageId!==packageId||
        value.archiveSha256!==selected.sha256||!plain(value.book)||!plain(value.origin)||
        value.origin.schema!==originSchema||value.origin.archiveSha256!==selected.sha256||
        value.book.receivedFrom?.packageId!==packageId||value.book.receivedFrom?.draftId!==requestId)
      throw fail('DRAFT_CHANGED','The retained receiving draft has a different original source.');
    return value;
  }
  async function importDraft(input){
    id(input.requestId,'Received draft request');id(input.packageId,'Received package');requireHash(input.reviewSha256,'received draft review');
    const requestSha256=digest(canonical(input));
    try{
      const previous=await savedDraft(input.packageId,input.requestId);
      if(previous.requestSha256!==requestSha256)throw fail('REQUEST_CHANGED','The receiving draft request identifies different reviewed inputs.',409);
      return {status:'COST_DRAFT_RECEIVED',requestId:input.requestId,packageId:input.packageId,
        book:previous.book,origin:previous.origin,replayed:true};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const reviewed=await reviewDraft(input);
    if(reviewed.reviewSha256!==input.reviewSha256)throw fail('REVIEW_CHANGED','Review the exact route/source mapping before receiving a local draft.',409);
    const value=await original(input.packageId),base=await ensureFiles(input.packageId);
    for(const source of value.originals){
      const raw=await checkedFile(base,'originals/'+source.sourceId+'/original',{bytes:source.bytes,sha256:source.sha256},MAX_SOURCE);
      const adopted=await sources.upload({requestId:source.localSourceId,metadata:source.metadata,body:[raw],origin:sourceOrigin});
      if(adopted.sha256!==source.sha256||adopted.bytes!==source.bytes)
        throw fail('SOURCE_CHANGED','The native local source adoption differs from its original.');
    }
    const book={...reviewed.book,receivedFrom:{packageId:input.packageId,draftId:input.requestId}};
    const draft={schema:DRAFT,requestId:input.requestId,requestSha256,packageId:input.packageId,
      archiveSha256:input.expectedPackageSha256,createdAt:new Date().toISOString(),selection:reviewed.selection,
      origin:reviewed.origin,book};
    if(encode(draft).length>64*1024*1024)throw fail('DRAFT_TOO_LARGE','The complete received draft exceeds the original 64 MiB member limit.');
    const drafts=join(folder(input.packageId),'drafts');await privateDir(drafts,true);
    if(!await atomicJson(join(drafts,input.requestId+'.json'),draft,pending)){
      const winner=await savedDraft(input.packageId,input.requestId);
      if(winner.requestSha256!==requestSha256)throw fail('REQUEST_CHANGED','Another received draft owns this request.',409);
      return {status:'COST_DRAFT_RECEIVED',requestId:input.requestId,packageId:input.packageId,book:winner.book,origin:winner.origin,replayed:true};
    }
    return {status:'COST_DRAFT_RECEIVED',requestId:input.requestId,packageId:input.packageId,book,origin:reviewed.origin,replayed:false};
  }
  async function origin(link,pricingVersion){
    if(!plain(link)||Object.keys(link).some(key=>!['packageId','draftId'].includes(key)))throw fail('ORIGIN_INVALID','Retain the original received draft identity.');
    const saved=await savedDraft(link.packageId,link.draftId);
    if(saved.origin.pricingVersion!==pricingVersion)throw fail('PRICING_CHANGED','Receive a new explicit mapping for a different local pricing source.');
    return {...saved.origin,draftId:link.draftId,receivingRequestSha256:saved.requestSha256};
  }
  async function drafts(packageId){
    await record(packageId);const dir=join(folder(packageId),'drafts');let names;
    try{names=await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const rows=[];
    for(const name of names){
      if(!/^[a-f0-9-]{36}\.json$/.test(name)||!UUID.test(name.slice(0,-5)))throw fail('DRAFT_CHANGED','Unexpected received draft record.');
      rows.push(await savedDraft(packageId,name.slice(0,-5)));
    }
    return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async function items(packageId,{draftId}={}){
    const selected=await record(packageId),base=folder(packageId);
    const result=[{name:'receipt.json',read:()=>readPrivate(join(base,'receipt.json'))},
      ...selected.parts.map(part=>({name:part.name,read:()=>checkedFile(base,part.name,part,PART_BYTES)}))];
    for(const draft of await drafts(packageId)){
      if(draftId!==undefined&&draft.requestId!==draftId)continue;
      result.push({name:'drafts/'+draft.requestId+'.json',read:()=>readPrivate(join(base,'drafts',draft.requestId+'.json'),64*1024*1024)});
    }
    if(draftId!==undefined&&!result.some(row=>row.name==='drafts/'+draftId+'.json'))
      throw fail('DRAFT_CHANGED','The selected original receiving draft is missing.');
    return result;
  }
  async function request(packageId){
    try{return {status:'COMMITTED',record:summary(await record(packageId))};}
    catch(error){if(error.code!=='ENOENT')throw error;return {status:'UNKNOWN',packageId};}
  }
  async function draftSummaries(packageId){
    return {items:(await drafts(packageId)).map(value=>({requestId:value.requestId,packageId,
      label:value.book.label,pricingVersion:value.book.pricingVersion,createdAt:value.createdAt}))};
  }
  async function reopenDraft(packageId,requestId){
    const value=await savedDraft(packageId,requestId);
    return {status:'COST_DRAFT_RECEIVED',packageId,requestId,book:value.book,origin:value.origin,replayed:true};
  }
  return {root,records,list,record,inspect,download,receive,archiveFile,reviewDraft,importDraft,origin,drafts,
    savedDraft,items,request,draftSummaries,reopenDraft};
}
