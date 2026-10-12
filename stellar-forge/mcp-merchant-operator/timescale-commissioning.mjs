// MIT. Commissioning inside the existing merchant Timescale resource.
import { exact, failure } from './host-files.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { identity, digest } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import { COMMISSIONING_MANIFEST, COMMISSIONING_SCHEMA, parseCommissioningManifest } from './timescale-commissioning-contract.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const uuid=value=>{if(!UUID.test(value??''))throw failure('INVALID_PARAMS','Use the original lowercase UUID.');return value;};
const hash=value=>{if(!HASH.test(value??''))throw failure('INVALID_PARAMS','Use the original SHA-256.');return value;};
function fields(args,allowed,required=[]){exact(args,['workspace','workspaceId',...allowed],['workspace','workspaceId',...required]);}
function count(value,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<min||value>max)throw failure('INVALID_PARAMS','Use an integer in the declared range.');return value;}
function paging(args){return{offset:count(args.offset??0),limit:count(args.limit??25,1,100)};}
function page(rows,args){const{offset,limit}=paging(args);return{total:rows.length,offset,limit,next:offset+limit<rows.length?offset+limit:null,rows:rows.slice(offset,offset+limit)};}
function selected(model,args,required=false){
  const value=model.commissioning.item(uuid(args.commissioningId));
  if(required&&(args.revision===undefined||args.digest===undefined))throw failure('INVALID_PARAMS','Pin the inspected commissioning revision and digest.');
  if(args.revision!==undefined&&count(args.revision,1)!==value.item.revision||args.digest!==undefined&&hash(args.digest)!==value.digest)
    throw failure('TIMESCALE_COMMISSIONING_REVISION_CHANGED','Open the current original commissioning revision before paging it.');
  return value;
}
function itemView(value,args){
  const item=value.item,section=args.section??'summary',sections=['summary','contract','sources','comparisons','observations','acceptance','history'];
  if(!sections.includes(section))throw failure('INVALID_PARAMS','Select a commissioning section.');
  const {contract,sources,comparisons,observations,acceptance,...rest}=item;
  const result={schema:'stellar-forge.timescale-commissioning-mcp-detail.v1',workspaceId:value.workspaceId,version:value.version,
    digest:value.digest,item:{...rest,contract:Object.keys(contract).length,sources:sources.length,comparisons:comparisons.length,
      observations:observations.length,acceptance:acceptance.length},section,historyCount:value.history.length};
  if(section!=='summary'){
    const rows=section==='contract'?Object.entries(contract).map(([key,row])=>({key,...row})):section==='history'?value.history:item[section];
    result.page=page(rows,args);
  }
  return result;
}
async function sourceFile(model,args){
  uuid(args.commissioningId);
  if(args.kind==='intake'){
    const value=await model.commissioning.intakeFile(args.commissioningId);
    return{file:{name:value.descriptor.filename,bytes:value.descriptor.bytes,sha256:value.descriptor.sha256},content:value.original.content,descriptor:value.descriptor};
  }
  if(args.kind==='source'){
    const value=await model.commissioning.source(args.commissioningId,uuid(args.sourceId));
    return{file:{name:value.descriptor.filename,bytes:value.descriptor.bytes,sha256:value.descriptor.sha256},content:value.original.content,descriptor:value.descriptor,table:value.table};
  }
  if(args.kind==='comparison'){
    const value=await model.commissioning.comparisonOriginal(args.commissioningId,uuid(args.comparisonId));
    const content=JSON.stringify(value.record,null,2)+'\n',bytes=Buffer.from(content,'utf8');
    return{file:{name:'comparison-'+value.descriptor.id+'.json',bytes:bytes.length,sha256:digest(bytes)},content,descriptor:value.descriptor};
  }
  throw failure('INVALID_PARAMS','Choose intake, source or comparison.');
}
function reportManifest(model,exportId){
  const operation=model.operation(uuid(exportId)),result=operation.data.result;
  if(operation.kind!=='commissioning-report'||operation.state!=='COMPLETE'||result?.complete!==true||
      result.workspaceId!==model.settings.id||result.requestId!==exportId)
    throw failure('TIMESCALE_COMMISSIONING_REPORT_NOT_COMPLETE','Select a completed original commissioning report.');
  const manifest={schema:COMMISSIONING_SCHEMA,exportId,workspaceId:result.workspaceId,commissioningId:result.commissioningId,
    revision:result.revision,digest:result.digest,workspaceVersion:result.workspaceVersion,createdAt:result.createdAt,complete:true,
    files:['json','html'].map(format=>{
      const file=result.files.find(row=>row.filename.endsWith('.'+format));
      if(!file)throw failure('TIMESCALE_COMMISSIONING_REPORT_CHANGED','The original report is missing a complete format.');
      return{name:'report.'+format,bytes:file.bytes,sha256:file.sha256};
    })};
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n','utf8');parseCommissioningManifest(bytes,exportId);
  return{manifest,bytes,sha256:digest(bytes)};
}
export async function dispatchTimescaleCommissioning({tool,name,resource,args,exportsDirectory,started,operationView}){
  const model=resource.model,desk=model.commissioning,method=tool.replace(/^merchant_timescale_commissioning_/,'');
  if(!desk)throw failure('TIMESCALE_COMMISSIONING_UNAVAILABLE','Open a Timescale workspace containing the complete commissioning feature.');
  switch(method){
    case'list':{fields(args,['offset','limit','q','status']);const{workspace,workspaceId,...options}=args;return desk.list(options);}
    case'item':{
      fields(args,['commissioningId','revision','digest','section','offset','limit'],['commissioningId']);
      return itemView(selected(model,args,(args.section??'summary')!=='summary'),args);
    }
    case'context':{
      fields(args,['commissioningId','revision','digest','kind','offset','limit'],['commissioningId','revision','digest']);
      const current=selected(model,args,true),result=await desk.context(args.commissioningId,{...paging(args),...(args.kind?{kind:args.kind}:{})});
      if(result.version!==current.version)throw failure('TIMESCALE_COMMISSIONING_REVISION_CHANGED','Reload the original source choices.');
      result.operations.rows=result.operations.rows.map(row=>{
        const original=model.operation(row.id);return{...operationView(original),operationDigest:identity(original)};
      });
      result.plans.rows=result.plans.rows.map(row=>({id:row.id,kind:row.kind,created:row.created,digest:row.digest,title:row.data.title}));
      return result;
    }
    case'source':{
      fields(args,['commissioningId','kind','sourceId','comparisonId','offset','limit'],['commissioningId','kind']);
      const value=await sourceFile(model,args);
      return{file:value.file,descriptor:value.descriptor,...(value.table?{columns:value.table.names,rows:page(value.table.rows,args)}:{})};
    }
    case'comparison':{
      fields(args,['commissioningId','comparisonId','offset','limit'],['commissioningId','comparisonId']);
      return desk.comparison(uuid(args.commissioningId),uuid(args.comparisonId),paging(args));
    }
    case'command':{
      fields(args,['requestId','expectedVersion','action','actor','note','commissioningId','expectedRevision','intake','title','owner','contract',
        'selection','source','role','expectedSourceId','observedSourceId','mapping','operationId','operationDigest','relevance',
        'criterionId','decision','assessment','references','disposition','statement','followUpOwner'],
        ['requestId','expectedVersion','action','actor','note']);
      uuid(args.requestId);count(args.expectedVersion);const{workspace,workspaceId,...input}=args;
      return started(desk.command(input));
    }
    case'reports':{
      fields(args,['commissioningId','offset','limit'],['commissioningId']);
      return desk.reports(uuid(args.commissioningId),paging(args));
    }
    case'report':{
      fields(args,['requestId','expectedVersion','commissioningId','expectedRevision','expectedDigest'],
        ['requestId','expectedVersion','commissioningId','expectedRevision','expectedDigest']);
      const{workspace,workspaceId,...input}=args;return started(desk.publishReport(input));
    }
    case'file':{
      fields(args,['commissioningId','kind','sourceId','comparisonId','expectedSha256','offset','limit','readId'],
        ['commissioningId','kind','expectedSha256']);
      uuid(args.commissioningId);hash(args.expectedSha256);
      if(!['intake','source','comparison'].includes(args.kind))throw failure('INVALID_PARAMS','Choose intake, source or comparison.');
      if(args.kind==='source')uuid(args.sourceId);if(args.kind==='comparison')uuid(args.comparisonId);
      return resource.reads.read({scope:name+':commissioning',key:[args.commissioningId,args.kind,args.sourceId??args.comparisonId??'intake'].join(':'),
        kind:'TIMESCALE_COMMISSIONING_SOURCE',directory:exportsDirectory,expectedSha256:args.expectedSha256,readId:args.readId,
        offset:count(args.offset??0),limit:count(args.limit??65536,1,MAX_RETAINED_CHUNK_BYTES),
        load:async()=>{
          const value=await sourceFile(model,args);
          if(args.expectedSha256!==value.file.sha256)throw failure('TIMESCALE_COMMISSIONING_FILE_CHANGED','Use the inspected complete original file hash.');
          return{bytes:Buffer.from(value.content,'utf8'),name:value.file.name,type:'application/json'};
        });
    }
    case'file_release':{
      fields(args,['readId'],['readId']);await resource.reads.release(name+':commissioning',uuid(args.readId));return{released:true,readId:args.readId};
    }
    case'report_manifest':{
      fields(args,['exportId'],['exportId']);const value=reportManifest(model,args.exportId);
      return{state:'MANIFEST_RETAINED',exportId:args.exportId,commissioningId:value.manifest.commissioningId,
        revision:value.manifest.revision,digest:value.manifest.digest,files:value.manifest.files.length,
        bytes:value.manifest.files.reduce((n,file)=>n+file.bytes,0),
        manifestFile:{name:COMMISSIONING_MANIFEST,bytes:value.bytes.length,sha256:value.sha256}};
    }
    case'report_file':{
      fields(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],
        ['exportId','file','expectedManifestSha256','expectedSha256']);
      const selected=reportManifest(model,args.exportId);
      if(hash(args.expectedManifestSha256)!==selected.sha256)throw failure('TIMESCALE_COMMISSIONING_MANIFEST_CHANGED','Use the complete retained report manifest.');
      const isManifest=args.file===COMMISSIONING_MANIFEST,file=isManifest?{name:COMMISSIONING_MANIFEST,bytes:selected.bytes.length,sha256:selected.sha256}:
        selected.manifest.files.find(file=>file.name===args.file);
      if(!file||hash(args.expectedSha256)!==file.sha256)throw failure('TIMESCALE_COMMISSIONING_FILE_CHANGED','Select an original file declared by this report manifest.');
      const result=await resource.reads.read({scope:name+':commissioning-report:'+args.exportId,key:file.name,
        kind:'TIMESCALE_COMMISSIONING_REPORT',directory:exportsDirectory,expectedSha256:file.sha256,readId:args.readId,
        offset:count(args.offset??0,0,file.bytes),limit:count(args.limit??65536,1,MAX_RETAINED_CHUNK_BYTES),
        load:async()=>({bytes:isManifest?selected.bytes:Buffer.from((await desk.reportFile(args.exportId,file.name.endsWith('.html')?'html':'json')).content,'utf8'),
          name:file.name,type:file.name.endsWith('.html')?'text/html':'application/json'})});
      return{...result,exportId:args.exportId,manifestSha256:selected.sha256};
    }
    case'report_file_release':{
      fields(args,['exportId','readId'],['exportId','readId']);uuid(args.exportId);
      await resource.reads.release(name+':commissioning-report:'+args.exportId,uuid(args.readId));return{released:true,readId:args.readId};
    }
    default:throw failure('TOOL_NOT_FOUND','Choose an original commissioning operation.');
  }
}
