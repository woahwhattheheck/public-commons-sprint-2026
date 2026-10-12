import { costToolDefinitions, base, read, nullableText, page, alias, pinnedInput, uuid, metadata, write, text, period, delimiter, mapping, object, routeIds, bookInput, view, revision, proposal, hash, fileSelection, kind, field, anyObject } from './catalog/pricing-costs.mjs';
export { costToolDefinitions } from './catalog/pricing-costs.mjs';
// MIT. Native supplier-cost workflow over the merchant's existing authenticated transport.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { PricingCostArchiveReads } from './pricing-cost-files.mjs';
import { MAX_SOURCE, MAX_DOCUMENT } from '../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/economics/common.mjs';
import { MAX_BUNDLE } from '../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/economics/archive.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>failure('PRICING_COST_'+code,message);
const inputKinds={SOURCE:'costInputs',BOOK:'costBooks',PACKAGE:'costPackages'};
const inputLimit=kind=>kind==='SOURCE'?MAX_SOURCE:kind==='PACKAGE'?MAX_BUNDLE:MAX_DOCUMENT;





















/** Native validation owns monetary, period, mapping and allocation semantics. */


export function normalizePricingCostSources(item,baseDirectory){
  const result={};
  for(const [name,kind]of Object.entries(inputKinds).map(([kind,name])=>[name,kind])){
    if(item[name]===undefined)continue;
    if(!plain(item[name])||Object.keys(item[name]).length>64)throw fail('CONFIGURATION','Declare at most 64 named '+kind.toLowerCase()+' inputs per workspace.');
    const inputs=Object.create(null);
    for(const [alias,value]of Object.entries(item[name])){
      identifier(alias,'Cost input alias');exact(value,['label','path'],['path']);
      if(typeof value.path!=='string'||!value.path||value.path.includes('\0'))throw fail('CONFIGURATION','A host input needs its existing local filename.');
      inputs[alias]={label:line(value.label??alias,'Cost input label'),path:resolve(baseDirectory,value.path)};
    }result[name]=inputs;
  }return result;
}
function declared(settings,kind,input){
  const values=settings[inputKinds[kind]]??{};
  if(!Object.hasOwn(values,input))throw fail('INPUT_NOT_CONFIGURED','Choose a declared '+kind.toLowerCase()+' alias from cost_inputs.');
  return values[input];
}
async function inputHandle(settings,kind,input,expected){
  const selected=declared(settings,kind,input),maximum=inputLimit(kind);
  const handle=await open(selected.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0))
    .catch(()=>{throw fail('INPUT_UNAVAILABLE','The selected host input cannot be opened as its original regular file.');});
  try{
    const info=await handle.stat();
    if(!info.isFile()||info.size<1||info.size>maximum||process.platform!=='win32'&&(info.mode&0o077))
      throw fail('INPUT_INVALID','Use a private regular '+kind.toLowerCase()+' file within its declared size limit.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<info.size){
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);
      if(!bytesRead)throw fail('INPUT_CHANGED','The declared input changed while its hash was read.');
      hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    const after=await handle.stat(),metadata={kind,input,label:selected.label,bytes:offset,sha256:hash.digest('hex')};
    if(after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs)
      throw fail('INPUT_CHANGED','The declared input changed while its hash was read.');
    if(expected&&(expected.expectedBytes!==metadata.bytes||expected.expectedSha256!==metadata.sha256))
      throw fail('INPUT_CHANGED','The declared input differs from the explicitly inspected bytes and SHA-256.');
    return {handle,metadata};
  }catch(error){await handle.close();throw error;}
}
async function* exactInput(opened){
  const hash=createHash('sha256');let offset=0;
  while(offset<opened.metadata.bytes){
    const buffer=Buffer.alloc(Math.min(65536,opened.metadata.bytes-offset));
    const {bytesRead}=await opened.handle.read(buffer,0,buffer.length,offset);
    if(!bytesRead)throw fail('INPUT_CHANGED','The original input ended before its inspected byte count.');
    const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);offset+=bytesRead;yield bytes;
  }
  const after=await opened.handle.stat();
  if(after.size!==opened.metadata.bytes||hash.digest('hex')!==opened.metadata.sha256)
    throw fail('INPUT_CHANGED','The original input changed during capture. No altered source is committed.');
}
async function selectedBook(settings,args,model){
  if(['book','bookSource','receivedDraft'].filter(key=>Object.hasOwn(args,key)).length!==1)
    throw fail('BOOK_SELECTION','Choose exactly one complete inline book, inspected bookSource or original receivedDraft.');
  if(args.receivedDraft!==undefined){
    const source=args.receivedDraft;
    const saved=await model.receiving.savedDraft(source.packageId,source.requestId);
    const adjustments=args.bookAdjustments??{};
    if(!plain(adjustments)||Object.keys(adjustments).some(key=>!['label','reason','periodAlignment','coverage'].includes(key)))
      throw fail('BOOK_SELECTION','Received-draft adjustments may set the local label, reason, period alignment and complete route coverage.');
    return {...structuredClone(saved.book),...structuredClone(adjustments)};
  }
  if(args.bookAdjustments!==undefined)throw fail('BOOK_SELECTION','Book adjustments belong to one selected receivedDraft.');
  if(args.book!==undefined){
    if(Buffer.byteLength(JSON.stringify(args.book))>96*1024)
      throw fail('BOOK_INPUT_REQUIRED','Select a host-declared complete book for inputs above 96 KiB; keep the existing MCP transport limit.');
    return args.book;
  }
  const input=args.bookSource,opened=await inputHandle(settings,'BOOK',input.input,input);
  try{
    const chunks=[];for await(const bytes of exactInput(opened))chunks.push(bytes);
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,opened.metadata.bytes)));}
    catch{throw fail('BOOK_INVALID','The selected complete book must be valid UTF-8 JSON.');}
    if(!plain(value))throw fail('BOOK_INVALID','The selected complete book must be one original cost-book object.');
    return value;
  }finally{await opened.handle.close();}
}
function pageOf(items,args={},kind='items'){
  const offset=args.offset??0,limit=args.limit??25;
  const selected=[];let bytes=0;
  for(let index=offset;index<Math.min(items.length,offset+limit);index++){
    const row=items[index],size=Buffer.byteLength(JSON.stringify(row));
    if(selected.length&&bytes+size>750*1024)break;
    if(size>750*1024){
      selected.push({inlineStatus:'ORIGINAL_FILE_REQUIRED',itemIndex:index,originalPayloadBytes:size,
        identity:plain(row)?Object.fromEntries(['id','sourceId','sourceRow','routeId','edition','requestId'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])):null,
        meaning:'This original row exceeds the bounded inline reply. Its complete original file remains available through cost_manifest/cost_file.'});break;
    }
    selected.push(row);bytes+=size;
  }
  return {kind,total:items.length,offset,nextOffset:offset+selected.length<items.length?offset+selected.length:null,items:selected};
}
function lineView(row){const {allocations,...value}=row;return {...value,allocationCount:allocations?.length??0};}
function routeView(row){
  const {costs,...value}=row;return {...value,costGroupCount:costs?.length??0};
}
function contextView(value){
  const {rows,items,headers,keys,accounts,bindings,routes,options,totals,...meta}=value;
  return {...meta,rowCount:meta.rowCount??rows?.length,headerCount:headers?.length,keyCount:keys?.length,
    accountCount:accounts?.length,bindingCount:bindings?.length,routeCount:routes?.length,optionCount:options?.length,
    nativeTotalsAvailable:totals!==undefined};
}
function allocationPage(lines,args){
  const offset=args.offset??0,limit=args.limit??25,items=[];let total=0;
  for(const row of lines)for(const allocation of row.allocations??[]){
    if(total>=offset&&items.length<limit)items.push({lineId:row.id,sourceId:row.sourceId,sourceRow:row.sourceRow,
      kind:row.kind,currency:row.currency,unit:row.unit,...allocation});total++;
  }
  return {kind:'allocations',total,offset,nextOffset:offset+limit<total?offset+limit:null,items};
}
function limitedCells(page){
  let budget=256*1024,truncated=0;
  const show=value=>{
    if(typeof value==='string'){
      const max=Math.min(4096,Math.max(0,budget));budget-=Math.min(max,value.length);
      if(value.length>max){truncated++;return {displayPrefix:value.slice(0,max),characters:value.length,truncated:true};}
      return value;
    }
    if(Array.isArray(value))return value.map(show);
    if(plain(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,show(item)]));
    return value;
  };
  const result={...page,items:page.items.map(show)};
  return {...result,displayTruncatedCells:truncated,originalBytesAvailable:true};
}
function originView(value){
  if(!value)return undefined;
  const {routeMappings,sourceMappings,lineMappings,...header}=value;
  return {...header,routeMappingCount:routeMappings?.length??0,sourceMappingCount:sourceMappings?.length??0,lineMappingCount:lineMappings?.length??0};
}
function reportView(value,args={}){
  const report=value.report,input=value.input??{},selected=args.view??'routes';
  const routeCosts=(report.routes??[]).flatMap(route=>(route.costs??[]).map(cost=>{
    const {lines,units,...value}=cost;return {...value,routeId:route.routeId,lineCount:lines.length,unitCount:units.length};
  }));
  const units=(report.routes??[]).flatMap(route=>(route.costs??[]).flatMap(cost=>(cost.units??[]).map(unit=>({
    routeId:route.routeId,basis:cost.basis,currency:cost.currency,...unit
  }))));
  const lists={routes:(report.routes??[]).map(routeView),routeCosts,units,lines:(report.lines??[]).map(lineView),issues:report.issues??[],
    groups:report.groups??[],coverage:input.coverage??[],imports:input.imports??[],
    sources:value.sourceSummary??value.binding?.sources??[],pricingLinks:value.pricingLinks??[],context:(value.context??[]).map(contextView)};
  const {routes,lines,issues,groups,...summary}=report;
  const {input:_,report:__,context:___,sourceSummary:____,binding,pricingLinks,groups:headerGroups,receivedOrigin,...header}=value;
  return {...header,input:{schema:input.schema,label:input.label,pricingVersion:input.pricingVersion,period:input.period,
      reason:input.reason,periodAlignment:input.periodAlignment,lineCount:input.lines?.length??0,
      importCount:input.imports?.length??0,contextSourceCount:input.contextSourceIds?.length??0},
    report:{...summary,routeCount:routes?.length??0,lineCount:lines?.length??0,issueCount:issues?.length??0,groupCount:groups?.length??0},
    binding:binding?{...binding,receivedFrom:originView(binding.receivedFrom),sources:undefined,sourceCount:binding.sources.length}:undefined,
    receivedOrigin:originView(receivedOrigin),
    page:selected==='allocations'?allocationPage(report.lines??[],args):pageOf(lists[selected]??[],args,selected),
    completeFiles:'Use cost_manifest/cost_file to retain complete original edition files.'};
}
function proposalView(value,args={}){
  const selected=args.view??'changes',review=value.originalReview;
  const {commercial,changes,originalReview,...meta}=value;
  const rows=selected==='changes'?changes:selected==='originalRoutes'?review.routes??[]:review.issues??[];
  return {...meta,commercial:{merchantName:commercial.merchantName,sharedMonthlyFixedUsd:commercial.sharedMonthlyFixedUsd,routeCount:Object.keys(commercial.routes).length},
    originalReview:{schema:review.schema,mode:review.mode,routeCount:review.routes?.length??0,issueCount:review.issues?.length??0},
    page:pageOf(rows,args,selected)};
}

export class MerchantPricingCosts {
  #settings;#model;#files;#archives;
  constructor({settings,model,files,archives}){this.#settings=settings;this.#model=model;this.#files=files;this.#archives=archives;}
  async #native(){const model=this.#model();if(!model?.economics)throw fail('NOT_OPEN','Open the original pricing workspace first.');return model.economics;}
  async #manifest(kind,id){
    const model=await this.#native();let files,metadata,original;
    if(kind==='source'){
      original=await model.sourceDownload(id);
      files={original:{bytes:original.source.bytes,sha256:original.source.sha256}};
      metadata={source:original.source};
    }else if(kind==='edition'){
      const bytes=await model.download(id,'manifest.json'),value=JSON.parse(bytes.toString('utf8'));
      files={...value.files,'edition-manifest.json':{bytes:bytes.length,sha256:sha(bytes)}};
      metadata={edition:id,revision:sha(bytes),requestId:value.requestId,pricingVersion:value.pricingVersion,nativeManifestSha256:sha(bytes)};
    }else{
      original=await (kind==='received'?model.receiving.archiveFile(id):model.exportFile(id));
      files={[original.filename]:{bytes:original.bytes,sha256:original.sha256}};
      metadata={requestId:id};
    }
    const manifest={schema:'stellar-forge.merchant-cost-files.v1',kind,id,...metadata,files};
    const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    if(bytes.length>65000)throw fail('MANIFEST_TOO_LARGE','The original selected file descriptor exceeds the retained transport manifest limit.');
    return {manifest,bytes,manifestFile:{name:'manifest.json',bytes:bytes.length,sha256:sha(bytes)}};
  }
  async #request(model,args){
    const kind={SOURCE:'SOURCES',EDITION:'EDITIONS',EXPORT:'EXPORTS',RECEIVED:'RECEIVED'}[args.kind];let after=null;
    do{
      const result=await model.list({kind,after,limit:100});
      const found=result.items.find(row=>(row.requestId??row.sourceId)===args.requestId);
      if(found)return {status:'COMMITTED',kind:args.kind,requestId:args.requestId,record:found};
      after=result.nextAfter;
    }while(after!==null);
    return {status:'UNKNOWN',kind:args.kind,requestId:args.requestId,
      meaning:'No committed native match is visible. Preserve the original request ID and exact inputs before deciding whether to retry.'};
  }
  async call(name,args){
    const model=await this.#native(),{workspace,offset,limit,view,...input}=args;
    switch(name){
      case 'merchant_pricing_cost_state':{
        const {editions,sources,pricingReviews,exports,receivedPackages,...state}=await model.state();
        return {...state,hostInputs:Object.keys(this.#settings.costInputs??{}).length,hostBooks:Object.keys(this.#settings.costBooks??{}).length,
          hostPackages:Object.keys(this.#settings.costPackages??{}).length,
          ...this.#archives.summary};
      }
      case 'merchant_pricing_cost_list':{
        const result=await model.list({kind:args.kind,after:args.after,limit:args.limit});
        return {...result,items:result.items.map(row=>{
          const {groups,...value}=row;return {...value,...(groups?{groupCount:groups.length}:{})};
        })};
      }
      case 'merchant_pricing_cost_inputs':{
        const rows=[];for(const kind of Object.keys(inputKinds)){
          if(args.kind&&args.kind!==kind)continue;
          for(const [input,value]of Object.entries(this.#settings[inputKinds[kind]]??{}))
            rows.push({kind,input,label:value.label,maximumBytes:inputLimit(kind)});
        }return {page:pageOf(rows,args,'inputs')};
      }
      case 'merchant_pricing_cost_input':{
        const opened=await inputHandle(this.#settings,args.kind,args.input);
        try{return opened.metadata;}finally{await opened.handle.close();}
      }
      case 'merchant_pricing_cost_upload':{
        let previous;try{previous=await model.sourceDownload(args.requestId);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(previous){
          if(previous.source.bytes!==args.expectedBytes||previous.source.sha256!==args.expectedSha256)
            throw fail('REQUEST_CHANGED','The committed source differs from the selected original bytes and hash.');
          return model.upload({requestId:args.requestId,metadata:args.metadata,body:[previous.bytes],origin:'MCP_HOST_SOURCE'});
        }
        const opened=await inputHandle(this.#settings,'SOURCE',args.input,args);
        try{return await model.upload({requestId:args.requestId,metadata:args.metadata,body:exactInput(opened),origin:'MCP_HOST_SOURCE'});}
        finally{await opened.handle.close();}
      }
      case 'merchant_pricing_cost_receive':{
        const prior=await model.receiving.request(args.requestId);
        if(prior.status==='COMMITTED'){
          const row=prior.record;
          if(row.sha256!==args.expectedSha256||row.bytes!==args.expectedBytes||row.label!==args.label||row.name!==args.name)
            throw fail('REQUEST_CHANGED','The committed received package differs from its selected original or label.');
          return {status:'COST_PACKAGE_RECEIVED',...row,replayed:true};
        }
        const opened=await inputHandle(this.#settings,'PACKAGE',args.input,args);
        try{return await model.receiving.receive({...input,body:exactInput(opened)});}
        finally{await opened.handle.close();}
      }
      case 'merchant_pricing_cost_received':{
        if(view==='drafts')return {packageId:args.packageId,page:pageOf((await model.receiving.draftSummaries(args.packageId)).items,args,'drafts')};
        const value=await model.receiving.inspect(args.packageId),{files,sources,pricing,...rest}=value;
        if(view==='files')return {packageId:value.packageId,sha256:value.sha256,bytes:value.bytes,page:pageOf(files,args,'files')};
        return reportView({...rest,sourceSummary:sources},args);
      }
      case 'merchant_pricing_cost_receiving_review':{
        const value=await model.receiving.reviewDraft(input),{book,origin,selection,...rest}=value;
        if(['routeMappings','sourceMappings','lineMappings'].includes(view))
          return {packageId:args.packageId,reviewSha256:value.reviewSha256,origin:originView(origin),page:pageOf(origin[view],args,view)};
        return reportView({...rest,input:book,receivedOrigin:origin},args);
      }
      case 'merchant_pricing_cost_receiving_draft':{
        const result=await model.receiving.importDraft(input),{book,origin,...rest}=result;
        return {...rest,receivedDraft:{packageId:result.packageId,requestId:result.requestId},
          input:{label:book.label,pricingVersion:book.pricingVersion,period:book.period,lineCount:book.lines.length,
            sourceCount:origin.sourceMappings.length,coverage:book.coverage.length},origin:originView(origin)};
      }
      case 'merchant_pricing_cost_capture':return model.capture(input);
      case 'merchant_pricing_cost_source':{
        const selected=await model.inspectSource(args.sourceId,{delimiter:args.delimiter,after:String(offset??0),limit:limit??25});
        const kind=view??(selected.format==='DELIMITED'?'rows':selected.accounts?'accounts':selected.bindings?'bindings':'routes');
        let page;
        if(selected.format==='DELIMITED'&&kind==='rows')page={kind:'rows',total:selected.total,offset:offset??0,nextOffset:selected.nextAfter===null?null:Number(selected.nextAfter),items:selected.items};
        else{
          const rows=kind==='headers'?(selected.headers??[]).map((name,index)=>({column:index,name})):
            kind==='keys'?(selected.keys??[]).map(name=>({name})):
            kind==='totals'?Object.entries(selected.totals??{}).map(([name,value])=>({name,value})):selected[kind]??[];
          page=pageOf(rows,args,kind);
        }
        return {...contextView(selected),nextAfter:undefined,total:undefined,page:limitedCells(page)};
      }
      case 'merchant_pricing_cost_mapping':{
        const {lines,headers,mapping,...result}=await model.mapCharges(input);return {...result,mapping,headerCount:headers.length,page:pageOf(lines,args,'lines')};
      }
      case 'merchant_pricing_cost_weights':{
        const {allocations,...result}=await model.weights(input);return {...result,page:pageOf(allocations,args,'allocations')};
      }
      case 'merchant_pricing_cost_preview':return reportView(await model.preview({book:await selectedBook(this.#settings,args,model)}),args);
      case 'merchant_pricing_cost_save':return model.save({requestId:args.requestId,expectedRevision:args.expectedRevision,book:await selectedBook(this.#settings,args,model)});
      case 'merchant_pricing_cost_request':return this.#request(model,args);
      case 'merchant_pricing_cost_edition':return reportView(await model.edition(args.edition),args);
      case 'merchant_pricing_cost_compare':{
        const result=await model.compare(input),selected=view??'changes';
        const {changes,before,after,...summary}=result;
        const rows=selected==='changes'?changes.map(row=>({...row,before:row.before?lineView(row.before):null,after:row.after?lineView(row.after):null})):
          ['before','after'].flatMap(side=>(result[side][selected]??[]).map(row=>({side,...(selected==='routes'?routeView(row):row)})));
        return {...summary,before:{period:before.period,routeCount:before.routes.length,groupCount:before.groups.length},
          after:{period:after.period,routeCount:after.routes.length,groupCount:after.groups.length},page:pageOf(rows,args,selected)};
      }
      case 'merchant_pricing_cost_proposal':return proposalView(await model.proposal(input),args);
      case 'merchant_pricing_cost_apply':return model.applyPricing(input);
      case 'merchant_pricing_cost_export':
        if((args.kind==='COST_EDITION')!==Object.hasOwn(args,'edition'))
          throw fail('EXPORT_SELECTION','Select edition only for COST_EDITION; WORKSPACE_BACKUP captures the complete original workspace.');
        return model.bundle(input);
      case 'merchant_pricing_cost_manifest':{
        const {manifest,manifestFile}=await this.#manifest(args.kind,args.id);return {kind:args.kind,id:args.id,manifest,manifestFile};
      }
      case 'merchant_pricing_cost_file':{
        if(args.file==='.'||args.file==='..'||!/^[-A-Za-z0-9_.]+$/.test(args.file))
          throw fail('FILE_NOT_FOUND','Choose one exact filename from the cost manifest.');
        const selected=()=>this.#manifest(args.kind,args.id);
        const load=async()=>{
          const original=await selected();
          if(original.manifestFile.sha256!==args.expectedManifestSha256)throw fail('MANIFEST_CHANGED','The selected cost manifest differs from its inspected digest.');
          if(args.file==='manifest.json')return {name:args.file,bytes:original.bytes};
          if(!Object.hasOwn(original.manifest.files,args.file))throw fail('FILE_NOT_FOUND','Choose one exact file from the selected cost manifest.');
          if(args.kind==='source')return {name:args.file,bytes:(await model.sourceDownload(args.id)).bytes};
          if(args.kind==='edition')return {name:args.file,bytes:await model.download(args.id,args.file==='edition-manifest.json'?'manifest.json':args.file)};
          return {file:{name:args.file,...original.manifest.files[args.file]},
            descriptor:await (args.kind==='received'?model.receiving.archiveFile(args.id):model.exportFile(args.id))};
        };
        const selectors={scope:workspace,kind:'cost-'+args.kind,key:JSON.stringify([args.kind,args.id,args.file,args.expectedManifestSha256]),
          directory:this.#settings.directory,readId:args.readId,offset,limit,expectedSha256:args.expectedSha256,load};
        const value=await (['export','received'].includes(args.kind)&&args.file!=='manifest.json'?this.#archives.read(selectors):this.#files.read(selectors));
        return {kind:args.kind,id:args.id,manifestSha256:args.expectedManifestSha256,...value};
      }
      case 'merchant_pricing_cost_file_release':
        await Promise.all([this.#files.release(workspace,args.readId),this.#archives.release(workspace,args.readId)]);return {readId:args.readId,released:true};
      default:throw fail('TOOL_NOT_FOUND','Unknown native cost operation.');
    }
  }
}
export {PricingCostArchiveReads};
