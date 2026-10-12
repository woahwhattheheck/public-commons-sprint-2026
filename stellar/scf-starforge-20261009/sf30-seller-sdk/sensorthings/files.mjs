// MIT. Manifest-selected source, dataset and customer files through the native reader.
import {join,basename} from 'node:path';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {readOwned} from '../stellar-expert/store.mjs';
import {plain,fields,identity,stable,json,sha,fault,WORKSPACE_SCHEMA} from './contract.mjs';
import {validateSourceEdition,openPrivateFile,inspectRetainedFile,TRANSFER_LIMITS} from './portable.mjs';

const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  DATASET=/^dataset-[a-f0-9]{24}$/,COMPARISON=/^comparison-[a-f0-9]{24}$/,
  BUYER=/^buyer-[a-f0-9]{24}$/,TRANSFER=/^[A-Za-z0-9_-]{8,100}$/;
const MAX_FILE=8*1024*1024*1024,MAX_META=16*1024*1024;
const BUYER_FILES=Object.freeze({
  'dataset.csv':{relative:'dataset/dataset.csv',type:'text/csv; charset=utf-8'},
  'dataset.jsonl':{relative:'dataset/dataset.jsonl',type:'application/x-ndjson'},
  'review.html':{relative:'dataset/review.html',type:'text/html; charset=utf-8'},
  'delivery.json':{relative:'delivery.json',type:'application/json'},
  'manifest.json':{relative:'dataset/manifest.json',type:'application/json'}
});
const PUBLISHER_FILES=Object.freeze([
  'draft-csv','draft-review','buyer-config','session-manifest',
  'session-delivery-manifest','session-csv','session-jsonl','session-review'
]);
export const FILE_SELECTION_CONTRACT=Object.freeze({
  schema:'stellar-forge.sensorthings-file-selection.v1',
  kinds:{
    source:{id:'edition ID',sha256:'original member SHA; required for read'},
    edition:{id:'edition ID',file:'edition.json'},
    dataset:{id:'native dataset ID',file:'dataset.csv, dataset.json, source.json, dataset-receipt.json or exact source-manifest member'},
    comparison:{id:'comparison ID',file:'comparison.json or changes.jsonl'},
    transfer:{id:'export or receiving ID',file:'archive, transfer.json, source-receiving.json or original-transfer-manifest.json'},
    buyer:{id:'original buyer receipt ID',file:Object.keys(BUYER_FILES)},
    publisher:{datasetId:'native dataset ID',id:'original draft or buyer-session UUID',file:PUBLISHER_FILES}
  },
  reads:'One stable selection and SHA per native read. Repeat expectedSha256 with every readId or nonzero offset.',
  lifetime:'Four held original reads per file-access instance; idle reads expire after 120 seconds. Reopen immutable files by the same selection/SHA/offset.',
  generatedReview:'draft-review is the original publisher-generated metadata view. Its first read fixes a process-local snapshot; list does not invent a physical SHA before generation.',
  limits:{maxChunkBytes:MAX_RETAINED_CHUNK_BYTES,maxFileBytes:MAX_FILE},
  paths:'Only retained original manifest members and fixed native layouts. No caller filesystem path is accepted.'
});
const media=value=>typeof value==='string'&&value.length<=240&&!/[\u0000-\u001f\u007f]/u.test(value)?value:'application/octet-stream';
const find=(rows,id,label)=>{
  const result=Array.isArray(rows)?rows.find(r=>r.id===id):null;
  if(!result)throw fault('FILE_SELECTION','Choose an existing '+label+'.',404);
  return result;
};
function selection(input,{read=false}={}){
  fields(input,['kind','id','file','sha256','datasetId'],['kind','id']);
  const allowed={
    source:['kind','id','sha256'],edition:['kind','id','file'],dataset:['kind','id','file'],
    comparison:['kind','id','file'],transfer:['kind','id','file'],buyer:['kind','id','file'],
    publisher:['kind','datasetId','id','file']
  };
  if(!allowed[input.kind]||Object.keys(input).some(k=>!allowed[input.kind].includes(k)))
    throw fault('FILE_SELECTION','Use the declared original file-selection fields.');
  const result={kind:input.kind,id:input.id};
  const pattern=['source','edition'].includes(input.kind)?HASH:input.kind==='dataset'?DATASET:
    input.kind==='comparison'?COMPARISON:input.kind==='buyer'?BUYER:input.kind==='publisher'?UUID:TRANSFER;
  if(!pattern.test(input.id??''))throw fault('FILE_SELECTION','Use the displayed original entity identity.');
  if(input.kind==='publisher'){
    if(!DATASET.test(input.datasetId??''))throw fault('FILE_SELECTION','Bind the publisher file to its original dataset.');
    result.datasetId=input.datasetId;
  }
  if(input.kind==='source'){
    if(input.sha256!==undefined){if(!HASH.test(input.sha256))throw fault('FILE_SELECTION','Choose the exact original source member SHA256.');result.sha256=input.sha256;}
    if(read&&!result.sha256)throw fault('FILE_SELECTION','Select one original source member SHA256 for reading.');
  }else{
    if(input.file!==undefined){
      if(typeof input.file!=='string'||!input.file||input.file.length>512||/[\u0000-\u001f\u007f\\]/u.test(input.file))
        throw fault('FILE_SELECTION','Choose a displayed original file name.');
      result.file=input.file;
    }else if(input.kind==='edition')result.file='edition.json';
    if(read&&!result.file)throw fault('FILE_SELECTION','Select one displayed original file before reading.');
  }
  return result;
}
function sourceMember(path){
  if(typeof path!=='string'||path.length>512||!path.startsWith('provenance/')||
      /[\u0000-\u001f\u007f\\]/u.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))
    throw fault('FILE_MANIFEST','The original dataset provenance path is invalid.',409);
  return path;
}
function identityFields(value,maximum=MAX_FILE){
  if(!plain(value)||!HASH.test(value.sha256??'')||!Number.isSafeInteger(value.bytes)||
      value.bytes<0||value.bytes>maximum)
    throw fault('FILE_MANIFEST','The original file has no complete supported SHA256/byte identity.',409);
  return {bytes:value.bytes,sha256:value.sha256};
}
async function small(path,maximum=MAX_META,expected){
  const bytes=await readOwned(path,maximum),sha256=sha(bytes);
  if(expected!==undefined&&sha256!==expected)throw fault('FILE_CHANGED','The retained original manifest changed.',409);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fault('FILE_MANIFEST','The retained original manifest is not a valid UTF-8 JSON document.',409);}
  return {value,bytes:bytes.length,sha256};
}
function publicFile(file){
  const {path,load,...visible}=file;return visible;
}
async function descriptor(path,selected,{name,type='application/octet-stream',bytes,sha256,retention='ORIGINAL_IMMUTABLE_FILE',...extra}){
  if(typeof name!=='string'||!name||name!==basename(name)||name.length>255||/[\u0000-\u001f\u007f\\]/u.test(name))
    throw fault('FILE_NAME','The original output has no safe download name.',409);
  if(sha256!==undefined&&!HASH.test(sha256))throw fault('FILE_MANIFEST','The original file SHA256 is invalid.',409);
  const held=await openPrivateFile(path,{expectedBytes:bytes,maximum:MAX_FILE});
  let observedBytes;try{observedBytes=held.bytes;}finally{await held.handle.close();}
  if(sha256===undefined){const actual=await inspectRetainedFile(path,{expectedBytes:observedBytes,maximum:MAX_FILE});sha256=actual.sha256;}
  return {selection:selected,name,type:media(type),bytes:observedBytes,sha256,retention,
    verification:'COMPLETE_HELD_FD_HASH_BEFORE_FIRST_BYTE',...extra,path};
}
function sameOriginal(value,record,label){
  if(stable(value)!==stable(record))throw fault('FILE_MANIFEST','The original '+label+' no longer matches its retained workspace identity.',409);
}
async function sourceFiles(workspace,selected){
  const edition=await workspace.edition(selected.id);validateSourceEdition(edition);
  const files=[],groups=new Map();
  for(const source of edition.sourceFiles){const group=groups.get(source.sha256)??[];group.push(source);groups.set(source.sha256,group);}
  for(const related of groups.values()){
    const source=related[0];
    if(selected.sha256&&selected.sha256!==source.sha256)continue;
    files.push(await descriptor(join(workspace.store.root,'objects',source.sha256),
      {kind:'source',id:edition.id,sha256:source.sha256},
      {name:'source-'+source.sha256+(source.mediaType?.includes('json')?'.json':'.body'),
        type:source.mediaType,bytes:source.bytes,sha256:source.sha256,
        roles:[...new Set(related.map(r=>r.role).filter(v=>typeof v==='string'))]}));
  }
  if(selected.sha256&&!files.length)throw fault('FILE_SELECTION','That source object is not a member of this original edition.',404);
  return files;
}
async function editionFiles(workspace,selected){
  const edition=await workspace.edition(selected.id);validateSourceEdition(edition);
  const path=join(workspace.store.root,'editions',selected.id+'.json'),original=await small(path,TRANSFER_LIMITS.editionBytes);
  sameOriginal(original.value,edition,'source edition');
  return [await descriptor(path,{kind:'edition',id:selected.id,file:'edition.json'},
    {name:'sensorthings-'+selected.id.slice(0,16)+'-edition.json',type:'application/json',bytes:original.bytes,sha256:original.sha256})];
}
async function datasetFiles(workspace,selected){
  const record=find(workspace.store.read().datasets,selected.id,'native dataset'),
    directory=join(workspace.store.root,'datasets',selected.id),packageDirectory=join(directory,'package');
  if(record.relativeDirectory!=='datasets/'+selected.id||![record.csvSha256,record.sourceConfigSha256,record.sourceManifestSha256].every(v=>HASH.test(v??'')))
    throw fault('FILE_MANIFEST','The native dataset directory binding changed.',409);
  const retained=await small(join(directory,'dataset-receipt.json'));sameOriginal(retained.value,record,'dataset receipt');
  const original=await small(join(packageDirectory,'source.json'),MAX_META,record.sourceManifestSha256),source=original.value;
  if(source.schema!=='stellar-forge.sensorthings-dataset-source.v1'||source.editionId!==record.editionId||
      !Array.isArray(source.sourceFiles)||source.sourceFiles.length>100000)
    throw fault('FILE_MANIFEST','The original SensorThings dataset source manifest is invalid.',409);
  const config=await small(join(packageDirectory,'dataset.json'),1024*1024,record.sourceConfigSha256);
  if(config.value.file!=='dataset.csv')throw fault('FILE_MANIFEST','The native dataset file binding changed.',409);
  const fixed=[
    ['dataset.csv',join(packageDirectory,'dataset.csv'),{type:'text/csv; charset=utf-8',sha256:record.csvSha256}],
    ['dataset.json',join(packageDirectory,'dataset.json'),{type:'application/json',bytes:config.bytes,sha256:config.sha256}],
    ['source.json',join(packageDirectory,'source.json'),{type:'application/json',bytes:original.bytes,sha256:original.sha256}],
    ['dataset-receipt.json',join(directory,'dataset-receipt.json'),{type:'application/json',bytes:retained.bytes,sha256:retained.sha256}]
  ];
  const seen=new Set(fixed.map(r=>r[0]));
  for(const member of source.sourceFiles){
    const path=sourceMember(member.path),exact=identityFields(member,TRANSFER_LIMITS.objectBytes);
    if(seen.has(path))throw fault('FILE_MANIFEST','The original dataset source repeats a member path.',409);
    seen.add(path);fixed.push([path,join(packageDirectory,path),{...exact,type:path.endsWith('.json')?'application/json':'application/octet-stream'}]);
  }
  const output=[];
  for(const [file,path,meta] of fixed){
    if(selected.file&&selected.file!==file)continue;
    output.push(await descriptor(path,{kind:'dataset',id:selected.id,file},{name:basename(file),...meta,member:file,editionId:record.editionId}));
  }
  return output;
}
async function comparisonFiles(workspace,selected){
  const record=find(workspace.store.read().comparisons,selected.id,'edition comparison'),
    directory=join(workspace.store.root,'exports',selected.id),original=await small(join(directory,'comparison.json'));
  sameOriginal(original.value,record,'comparison');
  if(record.file?.filename!=='changes.jsonl'||record.file.relativePath!=='exports/'+selected.id+'/changes.jsonl')
    throw fault('FILE_MANIFEST','The original comparison file binding changed.',409);
  const fixed=[
    ['comparison.json',{name:'comparison.json',type:'application/json',bytes:original.bytes,sha256:original.sha256}],
    ['changes.jsonl',{name:'changes.jsonl',type:'application/x-ndjson',...identityFields(record.file)}]
  ];
  const output=[];
  for(const[file,meta]of fixed)if(!selected.file||selected.file===file)
    output.push(await descriptor(join(directory,file),{kind:'comparison',id:selected.id,file},meta));
  return output;
}
async function transferFiles(workspace,selected){
  const state=workspace.store.read(),record=(state.exports??[]).find(r=>r.id===selected.id),
    incoming=(state.sourceReceipts??[]).find(r=>r.id===selected.id),output=[];
  if(record){
    if(record.schema!=='stellar-forge.sensorthings-transfer-receipt.v1'||record.kind!=='source-edition'||
        typeof record.file?.filename!=='string'||record.file.filename!==basename(record.file.filename)||
        record.file.relativePath!=='exports/'+selected.id+'/'+record.file.filename)
      throw fault('FILE_MANIFEST','The original source transfer file binding changed.',409);
    const directory=join(workspace.store.root,'exports',selected.id),retained=await small(join(directory,'transfer.json'));
    sameOriginal(retained.value,record,'source transfer receipt');
    const fixed=[
      ['archive',record.file.filename,{name:record.file.filename,type:record.file.type??'application/gzip',...identityFields(record.file,TRANSFER_LIMITS.archiveBytes)}],
      ['transfer.json','transfer.json',{name:'transfer.json',type:'application/json',bytes:retained.bytes,sha256:retained.sha256}]
    ];
    for(const[file,path,meta]of fixed)if(!selected.file||selected.file===file)
      output.push(await descriptor(join(directory,path),{kind:'transfer',id:selected.id,file},meta));
    return output;
  }
  if(incoming){
    const directory=join(workspace.store.root,'receipts',selected.id),
      receipt=await small(join(directory,'source-receiving.json')),
      manifest=await small(join(directory,'original-transfer-manifest.json'),TRANSFER_LIMITS.lineBytes);
    // Core may retain a wrapper containing preservedLocalReviewId around its
    // source receipt. The immutable physical receiving receipt remains authority.
    const expected=incoming.receipt??incoming;
    for(const key of ['id','editionId','archive','manifestSha256','receivingWorkspaceId'])
      if(stable(expected[key])!==stable(receipt.value[key]))
        throw fault('FILE_MANIFEST','The original received-source binding changed.',409);
    if(receipt.value.schema!=='stellar-forge.sensorthings-source-receiving.v1'||
        identity(manifest.value)!==receipt.value.manifestSha256||
        manifest.value.edition?.id!==receipt.value.editionId)
      throw fault('FILE_MANIFEST','The original receiving manifest identity changed.',409);
    validateSourceEdition(manifest.value.edition);
    const fixed=[
      ['source-receiving.json',receipt],['original-transfer-manifest.json',manifest]
    ];
    for(const[file,meta]of fixed)if(!selected.file||selected.file===file)
      output.push(await descriptor(join(directory,file),{kind:'transfer',id:selected.id,file},
        {name:file,type:'application/json',bytes:meta.bytes,sha256:meta.sha256}));
    return output;
  }
  throw fault('FILE_SELECTION','Choose an existing original source export or receiving event.',404);
}
async function buyerFiles(workspace,selected){
  const receipt=find(workspace.store.read().receipts,selected.id,'original customer receipt'),
    directory=join(workspace.store.root,'receipts',selected.id,'delivery');
  if(receipt.relativeDirectory!=='receipts/'+selected.id+'/delivery')
    throw fault('FILE_MANIFEST','The original receiving directory binding changed.',409);
  const original=await small(join(directory,'delivery.json'),8*1024*1024,receipt.manifestSha256),
    manifest=original.value;
  if(manifest.schema!=='stellar-forge.sf88.queue-dataset-delivery.v1'||
      stable(manifest.selection?.intents)!==stable(receipt.intentIds)||
      manifest.queueRoot!==(receipt.inboxDirectory??receipt.queueRoot))
    throw fault('FILE_MANIFEST','The original received dataset differs from the retained inbox and intents.',409);
  const native=await small(join(directory,'dataset','manifest.json'),8*1024*1024,manifest.originalDatasetManifest?.sha256);
  if(native.bytes!==manifest.originalDatasetManifest?.bytes)
    throw fault('FILE_MANIFEST','The original customer dataset manifest byte count changed.',409);
  const output=[];
  for(const[file,layout]of Object.entries(BUYER_FILES)){
    if(selected.file&&selected.file!==file)continue;
    const exact=file==='delivery.json'?{bytes:original.bytes,sha256:original.sha256}:
      file==='manifest.json'?{bytes:native.bytes,sha256:native.sha256}:identityFields(native.value.outputs?.[file],TRANSFER_LIMITS.objectBytes);
    const declared=receipt.downloads?.find(r=>r.name===file);
    if(!declared||declared.bytes!==exact.bytes||declared.sha256!==exact.sha256)
      throw fault('FILE_MANIFEST','An original customer file differs from its retained output identity.',409);
    output.push(await descriptor(join(directory,layout.relative),{kind:'buyer',id:selected.id,file},
      {name:file,type:layout.type,...exact}));
  }
  return output;
}
async function publisherFiles(workspace,selected){
  const dataset=find(workspace.store.read().datasets,selected.datasetId,'publisher dataset');
  if(dataset.relativePublisherDirectory!=='datasets/'+selected.datasetId+'/publisher')
    throw fault('FILE_MANIFEST','The original publisher directory binding changed.',409);
  const directory=join(workspace.store.root,'datasets',selected.datasetId,'publisher'),
    draftRoot=join(directory,'drafts'),output=[],chosen=selected.file;
  if(chosen&&!PUBLISHER_FILES.includes(chosen))throw fault('FILE_SELECTION','Choose an original native publisher export.',404);
  const add=async(file,path,meta)=>{
    if(!chosen||chosen===file)output.push(await descriptor(path,{kind:'publisher',datasetId:selected.datasetId,id:selected.id,file},meta));
  };
  const needDraft=!chosen||['draft-csv','draft-review','buyer-config'].includes(chosen);
  if(needDraft){
    const original=await small(join(draftRoot,'workspace.json'),8*1024*1024),drafts=original.value;
    if(drafts.schema!=='stellar-forge.dataset-publisher-workspace.v1'||drafts.datasetDirectory!==join(directory,'dataset')||
        !Array.isArray(drafts.candidates)||!Array.isArray(drafts.buyers))
      throw fault('FILE_MANIFEST','The original publisher draft workspace binding changed.',409);
    const candidate=drafts.candidates.find(r=>r.id===selected.id),buyer=drafts.buyers.find(r=>r.id===selected.id);
    if(candidate){
      if(!HASH.test(candidate.csvHash??'')||!Number.isSafeInteger(candidate.sourceBytes)||
          candidate.sourceBytes<1||candidate.sourceBytes>TRANSFER_LIMITS.objectBytes)
        throw fault('FILE_MANIFEST','The original publisher candidate has no exact file identity.',409);
      await add('draft-csv',join(draftRoot,'candidates',selected.id,'data.csv'),
        {name:'dataset.csv',type:'text/csv; charset=utf-8',bytes:candidate.sourceBytes,sha256:candidate.csvHash});
      if(!chosen||chosen==='draft-review'){
        output.push({selection:{kind:'publisher',datasetId:selected.datasetId,id:selected.id,file:'draft-review'},
          name:'dataset-review.json',type:'application/json',bytes:null,sha256:null,
          retention:'ORIGINAL_GENERATED_READ_SESSION',verification:'SNAPSHOT_SHA_RETURNED_BY_FIRST_READ',
          load:async()=>{
            const result=await workspace.publisherFile(selected.datasetId,'draft-review',selected.id);
            if(!Buffer.isBuffer(result.bytes)||result.bytes.length>MAX_META)
              throw fault('FILE_CAPACITY','The original publisher metadata view exceeds the declared read capacity.',413);
            return {bytes:result.bytes,name:result.filename,type:result.contentType};
          }});
      }
    }
    if(buyer){
      if(!HASH.test(buyer.configSha256??''))throw fault('FILE_MANIFEST','The original buyer configuration identity is missing.',409);
      await add('buyer-config',join(draftRoot,'buyers',selected.id+'.json'),
        {name:'buyer-request.json',type:'application/json',sha256:buyer.configSha256});
    }
  }
  const sessionKind=!chosen||chosen.startsWith('session-');
  if(sessionKind){
    const sessionRoot=join(directory,'sessions',selected.id);
    let binding;
    try{binding=(await small(join(sessionRoot,'binding.json'),1024*1024)).value;}
    catch(error){if(error.code==='ENOENT'&&!chosen)return output;throw error;}
    if(binding.schema!=='stellar-forge.socrata-buyer-session.v1'||binding.buyerId!==selected.id||!HASH.test(binding.snapshot??''))
      throw fault('FILE_MANIFEST','The original customer acquisition binding changed.',409);
    if(!chosen||chosen==='session-manifest'){
      let original;
      try{original=await small(join(sessionRoot,'acquisition-manifest.json'),MAX_META);}
      catch(error){if(error.code!=='ENOENT'||chosen)throw error;}
      if(original){
        if(original.value.status!=='COMPLETE'||original.value.snapshot!==binding.snapshot)
          throw fault('FILE_MANIFEST','The original acquisition export is not a complete matching snapshot.',409);
        await add('session-manifest',join(sessionRoot,'acquisition-manifest.json'),
          {name:'acquisition-manifest.json',type:'application/json',bytes:original.bytes,sha256:original.sha256});
      }
    }
    if(!chosen||chosen!=='session-manifest'){
      let original;
      try{original=await small(join(sessionRoot,'delivery','manifest.json'),MAX_META);}
      catch(error){if(error.code==='ENOENT'&&!chosen)return output;throw error;}
      if(original.value.schema!=='stellar-forge.buyer-delivery-manifest.v1'||original.value.dataset?.snapshot!==binding.snapshot)
        throw fault('FILE_MANIFEST','The original customer output belongs to another dataset snapshot.',409);
      await add('session-delivery-manifest',join(sessionRoot,'delivery','manifest.json'),
        {name:'manifest.json',type:'application/json',bytes:original.bytes,sha256:original.sha256});
      for(const [file,name,type]of [
        ['session-csv','dataset.csv','text/csv; charset=utf-8'],
        ['session-jsonl','dataset.jsonl','application/x-ndjson'],
        ['session-review','review.html','text/html; charset=utf-8']
      ])if(!chosen||chosen===file)
        await add(file,join(sessionRoot,'delivery',name),{name,type,...identityFields(original.value.outputs?.[name],TRANSFER_LIMITS.objectBytes)});
    }
  }
  return output;
}
export function createFileAccess(workspace){
  if(!workspace?.store||typeof workspace.edition!=='function'||typeof workspace.publisherFile!=='function')
    throw fault('FILE_WORKSPACE','Use the existing SensorThings workspace file owner.');
  const initial=workspace.store.read();
  if(initial.schema!==WORKSPACE_SCHEMA||!UUID.test(initial.workspaceId??''))
    throw fault('FILE_WORKSPACE','Use the original SensorThings workspace identity.',409);
  const scope='sensorthings:'+initial.workspaceId,reads=new RetainedFileReads({errorPrefix:'SENSORTHINGS_FILE',maxSnapshotBytes:32*1024*1024});
  let closing=false;
  async function resolveFiles(selected){
    if(closing)throw fault('FILE_CLOSING','The original file owner is closing.',503);
    const resolver={source:sourceFiles,edition:editionFiles,dataset:datasetFiles,comparison:comparisonFiles,
      transfer:transferFiles,buyer:buyerFiles,publisher:publisherFiles}[selected.kind];
    const files=await resolver(workspace,selected);
    const filtered=selected.file?files.filter(f=>f.selection.file===selected.file):files;
    if((selected.file||selected.sha256)&&!filtered.length)
      throw fault('FILE_SELECTION','That file is not a member of the original retained selection.',404);
    return filtered;
  }
  async function list(input){
    const selected=selection(input),files=await resolveFiles(selected);
    return {schema:'stellar-forge.sensorthings-files.v1',workspaceId:initial.workspaceId,
      selection:selected,files:files.map(publicFile),reads:reads.summary,contract:FILE_SELECTION_CONTRACT};
  }
  async function read(input){
    fields(input,['selection','readId','expectedSha256','offset','limit'],['selection']);
    const selected=selection(input.selection,{read:true}),offset=input.offset??0,limit=input.limit??MAX_RETAINED_CHUNK_BYTES;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>MAX_RETAINED_CHUNK_BYTES||
        input.readId!==undefined&&!UUID.test(input.readId)||
        input.expectedSha256!==undefined&&!HASH.test(input.expectedSha256)||
        (offset>0||input.readId)&&!input.expectedSha256)
      throw fault('FILE_RANGE','Use the exact original read identity, SHA256 and bounded byte range.');
    const key=identity(selected);
    let load;
    if(!input.readId){
      const files=await resolveFiles(selected);
      if(files.length!==1)throw fault('FILE_SELECTION','Choose one original file for this range read.');
      const file=files[0];
      if(file.bytes!==null&&offset>file.bytes)throw fault('FILE_RANGE','The selected offset exceeds the complete original file.');
      if(file.sha256!==null&&input.expectedSha256!==undefined&&input.expectedSha256!==file.sha256)
        throw fault('FILE_CHANGED','The selected original file differs from the requested SHA256.',409);
      load=file.load??(async()=>{
        const original=await openPrivateFile(file.path,{expectedBytes:file.bytes,maximum:MAX_FILE});
        // Ownership transfers to the maintained reader, which hashes this same
        // read-only descriptor before returning any bytes or readId.
        return {readonlyFileHandle:original.handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.type};
      });
    }
    const result=await reads.read({scope,key,kind:selected.kind+':'+(selected.file??selected.sha256),
      directory:workspace.store.root,readId:input.readId,expectedSha256:input.expectedSha256,offset,limit,load});
    return {...result,file:{...result.file,type:result.file.contentType}};
  }
  async function release(readId){
    if(!UUID.test(readId??''))throw fault('FILE_READ_ID','Select the original retained readId.');
    await reads.release(scope,readId);return {readId,released:true};
  }
  async function close(){closing=true;await reads.close();}
  return {list,read,release,close,contract:FILE_SELECTION_CONTRACT,
    status:()=>({workspaceId:initial.workspaceId,...reads.status(scope),...reads.summary})};
}
