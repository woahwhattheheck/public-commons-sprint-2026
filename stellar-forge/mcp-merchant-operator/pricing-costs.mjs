// MIT. Native supplier-cost workflow over the merchant's existing authenticated transport.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { PricingCostArchiveReads } from './pricing-cost-files.mjs';
import { MAX_SOURCE, MAX_DOCUMENT } from '../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/economics/common.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>failure('PRICING_COST_'+code,message);
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'};
const hash={type:'string',pattern:'^[0-9a-f]{64}$'},text={type:'string'};
const nullableText={anyOf:[text,{type:'null'}]};
const revision={anyOf:[hash,{type:'null'}]};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const anyObject={type:'object'},base={workspace:alias},read={readOnly:true,idempotent:true},write={idempotent:true};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const delimiter={type:'string',enum:[',','\t',';','|']};
const period=object({from:text,through:text});
const kind={type:'string',enum:['BILL','CREDIT_NOTE','QUOTE','USAGE','ACCOUNTING','SUPPORT']};
const metadata=object({label:text,name:text,kind,supplier:text,reference:text,period:{anyOf:[period,{type:'null'}]},note:text,url:nullableText},['label','name','kind']);
const field={anyOf:[object({column:text,trim:{type:'boolean'}},['column']),object({constant:text,trim:{type:'boolean'}},['constant']),{type:'null'}]};
const mapping=object(Object.fromEntries(['reference','supplier','kind','currency','amount','quantity','unit','description'].map(name=>[name,field])),[]);
const pinnedInput={input:alias,expectedSha256:hash,expectedBytes:{type:'integer',minimum:1,maximum:MAX_DOCUMENT}};
const bookInput={book:anyObject,bookSource:object(pinnedInput)};
const view={type:'string',enum:['routes','routeCosts','units','lines','allocations','issues','groups','coverage','imports','sources','pricingLinks','context']};
const routeIds={type:'array',minItems:1,maxItems:10000,items:text};
const proposal={edition:uuid,basis:{type:'string',enum:['BILLED','QUOTED']},routeIds};
const fileSelection={...base,kind:{type:'string',enum:['source','edition','export']},id:uuid};

/** Native validation owns monetary, period, mapping and allocation semantics. */
export const costToolDefinitions=[
  ['merchant_pricing_cost_state','Read exact native cost/pricing revisions, counts and declared source/booking aliases. Whole source and history lists have separate paged operations.',base,['workspace'],read],
  ['merchant_pricing_cost_list','Page the complete native originals, pricing reviews, cost editions or export receipts. after is the original opaque cursor; it does not change source identities.',{...base,kind:{type:'string',enum:['SOURCES','PRICING','EDITIONS','EXPORTS']},after:nullableText,limit:page.limit},['workspace','kind'],read],
  ['merchant_pricing_cost_inputs','List host-declared original source or complete cost-book files. This reveals aliases and labels; it does not read their contents or expose filesystem paths.',{...base,kind:{type:'string',enum:['SOURCE','BOOK']},...page},['workspace'],read],
  ['merchant_pricing_cost_input','Inspect the exact current SHA-256 and byte count of one host-declared source or complete cost book before selecting it. No source is imported.',{...base,kind:{type:'string',enum:['SOURCE','BOOK']},input:alias},['workspace','kind','input'],read],
  ['merchant_pricing_cost_upload','Retain one inspected original host file in the native immutable source store. Keep the exact expected bytes/hash, metadata and requestId across retry. Confirmed source IDs reopen even after the host file moves.',{...base,...pinnedInput,requestId:uuid,metadata},['workspace','input','expectedSha256','expectedBytes','requestId','metadata'],write],
  ['merchant_pricing_cost_capture','Capture the configured original supplier-usage or accounting file. This retains its native units and independent accounting groups; it does not infer an invoice or FX conversion.',{...base,kind:{type:'string',enum:['USAGE','ACCOUNTING']},requestId:uuid,label:text,reference:text,period:{anyOf:[period,{type:'null'}]},supplier:text,note:text},['workspace','kind','requestId'],write],
  ['merchant_pricing_cost_source','Inspect a retained source with bounded CSV or native source rows. Whole original bytes remain downloadable; oversized display cells are explicitly marked and never rewrite them.',{...base,sourceId:uuid,delimiter,view:{type:'string',enum:['rows','headers','accounts','bindings','routes','options','keys','totals']},...page},['workspace','sourceId'],read],
  ['merchant_pricing_cost_mapping','Apply an explicit original column/constant mapping and page every resulting sourceUUID:row line. The original file remains byte-identical and all row dispositions belong to the next native cost edition.',{...base,sourceId:uuid,delimiter,mapping,...page},['workspace','sourceId','mapping'],read],
  ['merchant_pricing_cost_weights','Use the original exact signed allocation engine with explicit operator weights or retained HTTP-2xx counts. Quota dispatch units and billed money stay separate.',{...base,pricingVersion:uuid,line:object({amount:text,quantity:nullableText},['amount']),basis:{type:'string',enum:['OPERATOR_WEIGHT','HTTP_2XX_WEIGHT']},reason:text,routeIds,weights:{type:'array',minItems:1,maxItems:10000,items:object({routeId:text,weight:text})},...page},['workspace','pricingVersion','line','basis','reason'],read],
  ['merchant_pricing_cost_preview','Review an inline cost book or an exact host-declared complete book through the original native validator. Page full source, route, line, allocation, coverage and issue lists; no edition is saved.',{...base,...bookInput,view,...page},['workspace'],read],
  ['merchant_pricing_cost_save','Save the complete reviewed book as an immutable native edition under the original compare-and-swap. Keep requestId, expectedRevision and the exact book contents across an ambiguous reply; a host book avoids the MCP request-size limit.',{...base,...bookInput,requestId:uuid,expectedRevision:revision},['workspace','requestId','expectedRevision'],write],
  ['merchant_pricing_cost_request','Find a committed native source, cost edition or export by its original requestId. UNKNOWN means no committed match is visible; it does not claim an interrupted write never ran.',{...base,kind:{type:'string',enum:['SOURCE','EDITION','EXPORT']},requestId:uuid},['workspace','kind','requestId'],read],
  ['merchant_pricing_cost_edition','Reopen one exact native cost edition and page its original normalized inputs, report, source binding and pricing links. Complete files remain available through the cost manifest/file operations.',{...base,edition:uuid,view,...page},['workspace','edition'],read],
  ['merchant_pricing_cost_compare','Compare exact retained native cost reports and page changed lines, routes or currency/basis groups. Different input periods and missing amounts remain explicit.',{...base,before:uuid,after:uuid,view:{type:'string',enum:['changes','routes','groups']},...page},['workspace','before','after'],read],
  ['merchant_pricing_cost_proposal','Review original cost-per-fulfilled proposals for explicitly selected routes and either quoted or billed USD. The native hash binds the whole selection; no price or payment term is changed.',{...base,...proposal,view:{type:'string',enum:['changes','originalRoutes','issues']},...page},['workspace','edition','basis','routeIds'],read],
  ['merchant_pricing_cost_apply','Save an explicitly reviewed cost proposal through the original pricing model. Native per-route eligibility, exact proposal hash, original pricing expectedRevision and stable requestId remain authoritative; atomic payment amounts are unchanged.',{...base,...proposal,proposalSha256:hash,requestId:uuid,expectedPricingRevision:revision,label:text},['workspace','edition','basis','routeIds','proposalSha256','requestId','expectedPricingRevision','label'],write],
  ['merchant_pricing_cost_export','Create the original complete cost-edition TAR or closed pricing/cost/scenario workspace backup. Repeat the same requestId and exact selectors after interruption, then download its original immutable archive.',{...base,kind:{type:'string',enum:['COST_EDITION','WORKSPACE_BACKUP']},requestId:uuid,edition:uuid},['workspace','kind','requestId'],write],
  ['merchant_pricing_cost_manifest','Inspect an immutable original source, cost-edition file set or completed native export with exact file bytes and hashes. Export is the requestId from the original native package receipt.',fileSelection,['workspace','kind','id'],read],
  ['merchant_pricing_cost_file','Read a bounded SHA-pinned chunk of the inspected original source, edition or native archive. Preserve kind/id/file/manifest hash, expected file hash, readId and nextOffset when continuing. Archives stream from the native verified descriptor.',{...fileSelection,file:text,expectedManifestSha256:hash,expectedSha256:hash,readId:uuid,offset:page.offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','kind','id','file','expectedManifestSha256'],read],
  ['merchant_pricing_cost_file_release','Release only the selected workspace’s temporary original-file/archive read. This never removes an original or saved package.',{...base,readId:uuid},['workspace','readId'],read],
];

export function normalizePricingCostSources(item,baseDirectory){
  const result={};
  for(const [name,kind]of [['costInputs','SOURCE'],['costBooks','BOOK']]){
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
  const values=settings[kind==='SOURCE'?'costInputs':'costBooks']??{};
  if(!Object.hasOwn(values,input))throw fail('INPUT_NOT_CONFIGURED','Choose a declared '+kind.toLowerCase()+' alias from cost_inputs.');
  return values[input];
}
async function inputHandle(settings,kind,input,expected){
  const selected=declared(settings,kind,input),maximum=kind==='SOURCE'?MAX_SOURCE:MAX_DOCUMENT;
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
async function selectedBook(settings,args){
  if(Object.hasOwn(args,'book')===Object.hasOwn(args,'bookSource'))
    throw fail('BOOK_SELECTION','Choose exactly one complete inline book or inspected bookSource.');
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
  const {input:_,report:__,context:___,sourceSummary:____,binding,pricingLinks,groups:headerGroups,...header}=value;
  return {...header,input:{schema:input.schema,label:input.label,pricingVersion:input.pricingVersion,period:input.period,
      reason:input.reason,periodAlignment:input.periodAlignment,lineCount:input.lines?.length??0,
      importCount:input.imports?.length??0,contextSourceCount:input.contextSourceIds?.length??0},
    report:{...summary,routeCount:routes?.length??0,lineCount:lines?.length??0,issueCount:issues?.length??0,groupCount:groups?.length??0},
    binding:binding?{...binding,sources:undefined,sourceCount:binding.sources.length}:undefined,
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
      original=await model.exportFile(id);
      files={[original.filename]:{bytes:original.bytes,sha256:original.sha256}};
      metadata={requestId:id};
    }
    const manifest={schema:'stellar-forge.merchant-cost-files.v1',kind,id,...metadata,files};
    const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    if(bytes.length>65000)throw fail('MANIFEST_TOO_LARGE','The original selected file descriptor exceeds the retained transport manifest limit.');
    return {manifest,bytes,manifestFile:{name:'manifest.json',bytes:bytes.length,sha256:sha(bytes)}};
  }
  async #request(model,args){
    const kind={SOURCE:'SOURCES',EDITION:'EDITIONS',EXPORT:'EXPORTS'}[args.kind];let after=null;
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
        const {editions,sources,pricingReviews,exports,...state}=await model.state();
        return {...state,hostInputs:Object.keys(this.#settings.costInputs??{}).length,hostBooks:Object.keys(this.#settings.costBooks??{}).length,
          ...this.#archives.summary};
      }
      case 'merchant_pricing_cost_list':{
        const result=await model.list({kind:args.kind,after:args.after,limit:args.limit});
        return {...result,items:result.items.map(row=>{
          const {groups,...value}=row;return {...value,...(groups?{groupCount:groups.length}:{})};
        })};
      }
      case 'merchant_pricing_cost_inputs':{
        const rows=[];for(const kind of ['SOURCE','BOOK']){
          if(args.kind&&args.kind!==kind)continue;
          for(const [input,value]of Object.entries(this.#settings[kind==='SOURCE'?'costInputs':'costBooks']??{}))
            rows.push({kind,input,label:value.label,maximumBytes:kind==='SOURCE'?MAX_SOURCE:MAX_DOCUMENT});
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
      case 'merchant_pricing_cost_preview':return reportView(await model.preview({book:await selectedBook(this.#settings,args)}),args);
      case 'merchant_pricing_cost_save':return model.save({requestId:args.requestId,expectedRevision:args.expectedRevision,book:await selectedBook(this.#settings,args)});
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
          return {file:{name:args.file,...original.manifest.files[args.file]},descriptor:await model.exportFile(args.id)};
        };
        const selectors={scope:workspace,kind:'cost-'+args.kind,key:JSON.stringify([args.kind,args.id,args.file,args.expectedManifestSha256]),
          directory:this.#settings.directory,readId:args.readId,offset,limit,expectedSha256:args.expectedSha256,load};
        const value=await (args.kind==='export'&&args.file!=='manifest.json'?this.#archives.read(selectors):this.#files.read(selectors));
        return {kind:args.kind,id:args.id,manifestSha256:args.expectedManifestSha256,...value};
      }
      case 'merchant_pricing_cost_file_release':
        await Promise.all([this.#files.release(workspace,args.readId),this.#archives.release(workspace,args.readId)]);return {readId:args.readId,released:true};
      default:throw fail('TOOL_NOT_FOUND','Unknown native cost operation.');
    }
  }
}
export {PricingCostArchiveReads};
