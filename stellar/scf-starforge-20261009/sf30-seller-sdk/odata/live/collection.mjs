// MIT. Complete original live OData responses become one retained customer source.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, link, unlink, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { acquireReleaseLease } from '../../../sf82-seller-pilot/release-process.mjs';
import { readRequestFile } from '../../../sf88-operator-buyer-cli/request-body.mjs';
import { operation as buyerOperation, responseFile as buyerResponseFile } from '../../../sf88-operator-buyer-cli/config.mjs';
import { VerifiedFile } from '../../../sf88-operator-buyer-cli/node/result.mjs';
import { prepareDraft } from './client.mjs';
import { buildQuery, validatePage, operationFor, plain, digest } from './contract.mjs';
import { canonical } from '../source.mjs';
import { underlyingType } from '../schema.mjs';
import { json } from './config.mjs';

export const COLLECTION_SCHEMA = 'stellar-forge.odata-live-collection.v1';
export const COLLECTION_INPUT_SCHEMA = 'stellar-forge.odata-live-collection-input.v1';
export const ANALYSIS_DOCUMENT_SCHEMA = 'stellar-forge.analysis-source-document.v1';
const PACKET_SCHEMA = 'stellar-forge.odata-live-original-packet.v1';
const MAX_PAGE_BYTES = 16777216;
const MAX_MANIFEST_BYTES = 16777216;
const PACKET_PLAIN_BYTES = 24 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const MAX_ANALYSIS_ROW_BYTES = 2097152;
const MAX_ANALYSIS_PROJECTED_BYTES = 128 * 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({maxPages:10000,maxRows:1000000,maxSourceBytes:128*1024*1024,maxOutputBytes:128*1024*1024});
const HASH = /^[a-f0-9]{64}$/;
const OUTPUT = /^(?:merchant\.json|projection\.json|dataset\.json|selection\.json|collection\.json|rows\.jsonl|rows-index\.jsonl|analysis-rows\.json|dataset\.csv|pages\/[0-9]{5}\/(?:request|response|buyer|result)\.json|analysis\/source\.json|analysis\/files\/[a-f0-9]{64}\.(?:csv|json|bin))$/;
const need = (condition,code,message) => { if(!condition)throw Object.assign(new Error(message),{code:'ODATA_COLLECTION_'+code}); };
const same = (a,b) => canonical(a)===canonical(b);
const bytes = value => Buffer.from(json(value));
const parse = raw => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const fileIdentity = (path,raw) => ({path,bytes:raw.length,sha256:digest(raw)});
const safeInteger = (value,min,max,label) => {need(Number.isSafeInteger(value)&&value>=min&&value<=max,'LIMIT','Choose a valid '+label+'.');return value;};
function selectedLimits(input={}) {
  need(plain(input)&&Object.keys(input).every(key=>Object.hasOwn(DEFAULT_LIMITS,key)),'LIMIT','Choose supported collection limits.');
  const output={...DEFAULT_LIMITS,...input};
  for(const [key,max]of Object.entries(DEFAULT_LIMITS))safeInteger(output[key],1,max,key);
  return output;
}
function text(value,label,max=128) {
  need(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x1f]/.test(value),'TEXT','Choose a valid '+label+'.');
  return value;
}
async function privateDirectory(path) {
  path=resolve(path);await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&
    (typeof process.getuid!=='function'||info.uid===process.getuid())&&await realpath(path)===path,
    'DIRECTORY','Use an owned private collection directory.');
  return path;
}
async function syncDirectory(path) {
  const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await fd.sync();}finally{await fd.close();}
}
function outputPath(root,relative) {
  need(typeof relative==='string'&&OUTPUT.test(relative),'PATH','Choose a declared collection file.');
  return join(root,relative);
}
async function verifiedBytes(path,identity,limit=MAX_DOCUMENT_BYTES) {
  need(plain(identity)&&Number.isSafeInteger(identity.bytes)&&identity.bytes>=0&&identity.bytes<=limit&&HASH.test(identity.sha256),
    'FILE_IDENTITY','The collection file identity is invalid.');
  const raw=await readRequestFile(resolve(path),limit);
  need(raw.length===identity.bytes&&digest(raw)===identity.sha256,'FILE_CHANGED','A retained collection file changed: '+path);
  return raw;
}
async function retireOwnTemporary(parent,checksum,name) {
  const prefix='.odata-collection-'+name+'-'+checksum+'-';
  for(const name of await readdir(parent))if(name.startsWith(prefix)&&/^[a-f0-9-]{36}\.partial$/.test(name.slice(prefix.length))) {
    const path=join(parent,name),info=await lstat(path);
    if(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&(info.mode&0o077)===0&&
      (typeof process.getuid!=='function'||info.uid===process.getuid()))await unlink(path);
  }
}
/** Retire only our named temporary aliases of this already verified final inode. */
async function settlePublished(target,expected) {
  const parent=dirname(target),final=await lstat(target,{bigint:true});
  need(final.isFile()&&!final.isSymbolicLink()&&(final.mode&0o077n)===0n&&
    (typeof process.getuid!=='function'||final.uid===BigInt(process.getuid())),
    'OUTPUT_FILE','The retained collection output is no longer an owned private file.');
  const prefix='.odata-collection-'+basename(target)+'-'+expected.sha256+'-';let changed=false;
  for(const name of await readdir(parent)) {
    if(!name.startsWith(prefix)||!/^[a-f0-9-]{36}\.partial$/.test(name.slice(prefix.length)))continue;
    const path=join(parent,name);let info;
    try{info=await lstat(path,{bigint:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!info.isFile()||info.isSymbolicLink()||info.dev!==final.dev||info.ino!==final.ino||
      info.nlink<2n||(info.mode&0o077n)!==0n||info.uid!==final.uid)continue;
    const current=await lstat(target,{bigint:true}),again=await lstat(path,{bigint:true});
    need(current.dev===final.dev&&current.ino===final.ino,'OUTPUT_CHANGED','The verified collection output changed during publication recovery.');
    if(again.isFile()&&!again.isSymbolicLink()&&again.dev===current.dev&&again.ino===current.ino){
      await unlink(path);changed=true;
    }
  }
  if(changed)await syncDirectory(parent);
}
async function writer(root,relative,expected) {
  const target=outputPath(root,relative),parent=await privateDirectory(dirname(target));
  await retireOwnTemporary(parent,expected.sha256,basename(target));
  const temporary=join(parent,'.odata-collection-'+basename(target)+'-'+expected.sha256+'-'+randomUUID()+'.partial');
  const file=await open(temporary,'wx',0o600),hash=createHash('sha256');let length=0,closed=false;
  return {
    async write(raw) {
      need(!closed,'WRITER_CLOSED','The collection writer is closed.');
      need(raw.length<=expected.bytes-length,'OUTPUT_CHANGED','The selected output grew during receiving.');
      await file.writeFile(raw);hash.update(raw);length+=raw.length;
    },
    async finish() {
      need(!closed&&length===expected.bytes&&hash.digest('hex')===expected.sha256,
        'OUTPUT_CHANGED','The selected output changed during receiving.');
      await file.sync();await file.close();closed=true;
      try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;await verifiedBytes(target,expected);}
      await unlink(temporary);await settlePublished(target,expected);await syncDirectory(parent);return {...expected,path:relative};
    },
    async abort(){if(!closed){closed=true;await file.close();}await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  };
}
async function writeSame(root,relative,raw) {
  const expected=fileIdentity(relative,raw),target=outputPath(root,relative);
  try{await verifiedBytes(target,expected);await settlePublished(target,expected);return expected;}catch(error){if(error.code!=='ENOENT')throw error;}
  const sink=await writer(root,relative,expected);
  try{await sink.write(raw);return await sink.finish();}finally{await sink.abort();}
}
class RetainedResponse extends VerifiedFile {
  constructor(path,record){super();this.retained={path:resolve(path),bytes:record.bytes,sha256:record.sha256};}
  _metadata(){return this.retained;}
}
function originalBuyer(configRaw,resultRaw,requestRaw,prepared,id) {
  const config=parse(configRaw),savedRecord=parse(resultRaw);
  need(plain(config)&&plain(savedRecord),'BUYER','Choose the original buyer configuration and result.');
  const op=buyerOperation(config.operation),download=buyerResponseFile(config);
  const record=savedRecord.mode==='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'?{native:savedRecord}:savedRecord;
  const native=record.native,merchant=operationFor(prepared.plan,prepared.catalog,id).operation;
  need(plain(native)&&native.mode==='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'&&native.intentId===op.intentId&&
    (record.configSha256===undefined||record.configSha256===digest(configRaw)),
    'BUYER_IDENTITY','The original buyer result belongs to a different configuration or intent.');
  need(op.method==='POST'&&op.url===prepared.plan.publicOrigin+merchant.path&&
    op.bodyBytes===requestRaw.length&&op.bodySha256===digest(requestRaw),
    'BUYER_REQUEST','The original buyer did not select these exact merchant request bytes.');
  need(op.expect.network===prepared.plan.payment.network&&op.expect.asset===prepared.plan.payment.asset&&
    op.expect.payTo===prepared.plan.payment.payTo&&BigInt(op.expect.maxAtomic)>=BigInt(merchant.amountAtomic),
    'BUYER_TERMS','The selected buyer and merchant terms differ.');
  const saved=native.responseFile;
  need(download&&plain(saved)&&saved.status==='SAVED'&&native.httpStatus===200&&typeof saved.path==='string'&&
    resolve(saved.path)===resolve(download.destination)&&Number.isSafeInteger(saved.bytes)&&saved.bytes>=0&&
    saved.bytes<=download.maxBytes&&saved.bytes<=MAX_PAGE_BYTES&&HASH.test(saved.sha256),
    'BUYER_RESPONSE','The original buyer has no complete saved response for this selection.');
  return {saved,context:{kind:'SF88_BUYER_RESPONSE',intentId:op.intentId,configurationSha256:digest(configRaw),
    resultSha256:digest(resultRaw),nativeStatus:native.status??null,paymentStatus:native.paymentStatus??null,
    httpStatus:native.httpStatus,responseFileStatus:saved.status}};
}
function exchangePaths(value) {
  need(plain(value)&&Object.keys(value).every(key=>['requestPath','responsePath','buyerConfigPath','buyerResultPath'].includes(key))&&
    typeof value.requestPath==='string'&&typeof value.responsePath==='string'&&
    (value.buyerConfigPath===undefined)===(value.buyerResultPath===undefined),
    'EXCHANGE','Select each complete request/response pair and both original buyer files when supplied.');
  for(const path of Object.values(value))need(typeof path==='string'&&path&&!path.includes('\0'),'EXCHANGE','Choose regular original exchange files.');
  return Object.fromEntries(Object.entries(value).map(([key,path])=>[key,resolve(path)]));
}
function columnName(path,used) {
  let name=path.replace(/[^A-Za-z0-9_]/g,'_');
  if(!/^[A-Za-z]/.test(name)||['constructor','prototype','__proto__'].includes(name))name='field_'+name;
  name=name.slice(0,35);
  if(used.has(name.toLowerCase())||used.has((name+'_state').toLowerCase()))name=name.slice(0,26)+'_'+digest(path).slice(0,8);
  need(!used.has(name.toLowerCase())&&!used.has((name+'_state').toLowerCase()),'COLUMN','Choose distinct exposed collection columns.');
  used.add(name.toLowerCase());used.add((name+'_state').toLowerCase());return name;
}
function typeFor(catalog,field) {
  const type=underlyingType(catalog,field.type);
  if(['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32'].includes(type))return 'integer';
  if(['Edm.Single','Edm.Double'].includes(type))return 'number';
  if(type==='Edm.Boolean')return 'boolean';
  return 'string';
}
function projection(prepared,id,query,chosen) {
  const {entity}=operationFor(prepared.plan,prepared.catalog,id),available=new Map(entity.fields.map(field=>[field.path,field]));
  need(chosen===undefined||Array.isArray(chosen)&&chosen.length&&new Set(chosen).size===chosen.length,'FIELDS','Select distinct collection fields.');
  const paths=[...new Set([...entity.keyFields,...(chosen??query.select)])],used=new Set();
  need(paths.length<=32&&paths.every(path=>query.select.includes(path)),'FIELDS','Select up to 32 delivered fields, including every entity key.');
  return paths.map(path=>{const field=available.get(path);return {path,name:columnName(path,used),odataType:field.type,
    type:typeFor(prepared.catalog,field),underlyingType:underlyingType(prepared.catalog,field.type),nullable:field.nullable===true,key:entity.keyFields.includes(path),
    precision:field.precision??null,scale:field.scale??null,sourceDefinition:structuredClone(field)};});
}
function csvCell(value) {const str=String(value);return /[",\r\n]/.test(str)?'"'+str.replaceAll('"','""')+'"':str;}
function cell(row,field) {
  const value=row[field.path],state=value===null?'null':'value';
  if(state==='value'){
    if(field.type==='integer')need(typeof value==='number'&&Number.isSafeInteger(value),'INTEGER','A delivered integer is outside the exact dataset range.');
    if(field.type==='number')need(typeof value==='number'&&Number.isFinite(value),'NUMBER','A delivered number is not finite.');
    if(field.type==='boolean')need(typeof value==='boolean','BOOLEAN','A delivered Boolean is not an original Boolean value.');
    if(field.type==='string')need(typeof value==='string'&&value.isWellFormed(),'TEXT_VALUE','A delivered text value differs from its declared OData type or complete Unicode value.');
    if(field.underlyingType==='Edm.Int64')need(/^-?\d+$/.test(value),'EXACT_INTEGER','A delivered Int64 value has an invalid original spelling.');
    if(field.underlyingType==='Edm.Decimal')need(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value),'EXACT_DECIMAL','A delivered Decimal value has an invalid original spelling.');
  }
  return [csvCell(state==='value'?value:''),state];
}
function floorDivide(value,divisor) {const quotient=value/divisor;return value<0n&&value%divisor!==0n?quotient-1n:quotient;}
/** Exact Gregorian day and fractional-second identity; original cell text stays unchanged. */
function temporalKey(value,type) {
  need(typeof value==='string'&&value.length<=1000,'KEY','A declared temporal key is invalid.');
  const clock='(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,12}))?)?';
  let found,year,month,day,sign,offsetHour,offsetMinute,hour=0,minute=0,second=0,fraction='',offset=0,ordinal=0n;
  if(type==='Edm.TimeOfDay'){
    found=new RegExp('^'+clock+'$').exec(value);
    need(found,'KEY','A declared TimeOfDay key has an invalid original spelling.');
    [,hour,minute,second='0',fraction='']=found;
  }else{
    const date='(-?(?:0\\d{3}|[1-9]\\d{3,}))-(\\d{2})-(\\d{2})';
    found=new RegExp('^'+date+(type==='Edm.Date'?'$':'T'+clock+'(Z|([+-])(\\d{2}):(\\d{2}))$'),'i').exec(value);
    need(found,'KEY','A declared date key has an invalid original spelling.');
    [,year,month,day]=found;year=BigInt(year);month=Number(month);day=Number(day);
    const leap=year%4n===0n&&(year%100n!==0n||year%400n===0n);
    const lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    need(month>=1&&month<=12&&day>=1&&day<=lengths[month-1],'KEY','A declared date key has an invalid calendar day.');
    const previous=year-1n;
    ordinal=365n*previous+floorDivide(previous,4n)-floorDivide(previous,100n)+floorDivide(previous,400n)+
      BigInt(lengths.slice(0,month-1).reduce((sum,length)=>sum+length,0)+day-1);
    if(type==='Edm.Date')return [type,ordinal.toString()];
    [, , , ,hour,minute,second='0',fraction='', ,sign,offsetHour='0',offsetMinute='0']=found;
    const zoneHour=Number(offsetHour),zoneMinute=Number(offsetMinute);
    need(zoneHour<=23&&zoneMinute<=59,'KEY','A declared DateTimeOffset key has an invalid offset.');
    offset=(sign==='-'?-1:1)*(zoneHour*60+zoneMinute);
  }
  hour=Number(hour);minute=Number(minute);second=Number(second);
  need(hour<=23&&minute<=59&&second<=60,'KEY','A declared temporal key has an invalid clock value.');
  const seconds=ordinal*86400n+BigInt(hour*3600+minute*60+Math.min(second,59)-offset*60);
  return [type,seconds.toString(),fraction.replace(/0+$/,''),second===60?'leap-second':'ordinary-second'];
}
function keyIdentity(row,entity,catalog) {
  return canonical(entity.keyFields.map(path=>{
    const value=row[path],field=entity.fields.find(field=>field.path===path),type=underlyingType(catalog,field.type);
    need(value!==null&&value!==undefined,'KEY','Every row needs its complete declared non-null key.');
    if(type==='Edm.Guid'){
      need(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value),
        'KEY','A declared Guid key is invalid.');
      return [type,value.toLowerCase()];
    }
    if(['Edm.Date','Edm.TimeOfDay','Edm.DateTimeOffset'].includes(type))return temporalKey(value,type);
    if(type==='Edm.Int64'){need(typeof value==='string'&&/^-?\d+$/.test(value)&&value.length<=1000,'KEY','A declared Int64 key is invalid.');return ['integer',BigInt(value).toString()];}
    if(type==='Edm.Decimal'){
      need(typeof value==='string'&&value.length<=1000&&/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value),'KEY','A declared Decimal key is invalid.');
      const [whole,exp='0']=value.toLowerCase().split('e'),negative=whole.startsWith('-');
      let digits=whole.replace('-','').replace('.','').replace(/^0+/,'')||'0';
      let scale=BigInt(exp)-BigInt((whole.split('.')[1]??'').length);
      if(digits==='0')return ['decimal','0','0'];
      while(digits.endsWith('0')){digits=digits.slice(0,-1);scale++;}
      return ['decimal',(negative?'-':'')+digits,scale.toString()];
    }
    return [type,value];
  }));
}

async function copySame(root,relative,sourcePath,identity) {
  const target=outputPath(root,relative);
  try{await new RetainedResponse(target,identity).verify();await settlePublished(target,identity);return {...identity,path:relative};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const sink=await writer(root,relative,{path:relative,...identity});
  try{for await(const chunk of new RetainedResponse(sourcePath,identity).chunks())await sink.write(chunk);return await sink.finish();}
  finally{await sink.abort();}
}

async function scan(prepared,input,sink={}) {
  need(plain(input),'INPUT','Choose a complete collection input.');
  const id=input.operation??prepared.selection?.operation;
  text(id,'merchant operation',64);
  const limits=selectedLimits(input.limits);
  need(Array.isArray(input.exchanges)&&input.exchanges.length>0&&input.exchanges.length<=limits.maxPages,
    'PAGES','Select the ordered original page exchanges within the collection page limit.');
  const exchanges=input.exchanges.map(exchangePaths),firstRequestRaw=await readRequestFile(exchanges[0].requestPath,65536);
  const firstRequest=parse(firstRequestRaw);
  need(plain(firstRequest)&&!Object.hasOwn(firstRequest,'cursor'),'FIRST_PAGE','Start with the original full query request.');
  const selected=prepareDraft({plan:prepared.plan,catalog:prepared.catalog,selection:{operation:id,request:firstRequest}},
    {allowLoopback:input.allowLoopback===true});
  need(selected.sourceBinding===prepared.sourceBinding,'MERCHANT','The selected original merchant contract changed.');
  const {query,compiled}=buildQuery(selected.plan,selected.catalog,id,firstRequest),{entity}=operationFor(selected.plan,selected.catalog,id);
  const title=text(input.title??selected.plan.title,'collection title');
  const mapping=projection(selected,id,query,input.fields),columns={};
  for(const field of mapping){columns[field.name]={type:field.type,nullable:field.type!=='string'};columns[field.name+'_state']='string';}
  const names=mapping.map(field=>field.name);
  const dataset={schema:'stellar-forge.csv-dataset.v1',name:title,file:'dataset.csv',columns,
    filters:names.slice(0,8),ranges:[],sorts:names.slice(0,8),defaultLimit:50,maxLimit:250};
  const projectionRecord={schema:'stellar-forge.odata-live-projection.v1',mapping,
    source:{kind:'odata-live',provider:'odata4',serviceUrl:selected.catalog.serviceUrl,
      metadataUrl:selected.catalog.metadataUrl,metadataSha256:selected.catalog.receipts.metadata.sha256,
      entitySet:entity.name,entityType:entity.entityType,entityContainer:entity.container??null},
    declarations:{version:selected.catalog.version,entityTypes:structuredClone(selected.catalog.entityTypes),
      complexTypes:structuredClone(selected.catalog.complexTypes),typeDefinitions:structuredClone(selected.catalog.typeDefinitions),
      enumTypes:structuredClone(selected.catalog.enumTypes)},
    keyFields:[...entity.keyFields],states:['value','null'],queryFingerprint:compiled.fingerprint};
  const merchant={schema:'stellar-forge.odata-live-collection-merchant.v1',
    catalog:selected.catalog,plan:selected.plan,sourceBinding:selected.sourceBinding};
  const files={},originalFiles=[],pages=[],keys=new Set(),cursors=new Set(),intents=new Set();
  let sourceBytes=0,seenRows=0,previous=null;
  async function sourceFile(path,raw) {
    sourceBytes+=raw.length;
    need(sourceBytes<=limits.maxSourceBytes,'SOURCE_SIZE','The selected original chain exceeds the collection byte limit.');
    need(!Object.hasOwn(files,path),'FILE_REPEAT','An original collection file occurs twice.');
    const item=fileIdentity(path,raw);files[path]={bytes:item.bytes,sha256:item.sha256};originalFiles.push(path);
    await sink.file?.(path,raw,item);return item;
  }
  await sourceFile('merchant.json',bytes(merchant));
  await sourceFile('projection.json',bytes(projectionRecord));
  await sourceFile('dataset.json',bytes(dataset));
  const analysisOutput={hash:createHash('sha256'),bytes:0,active:true};
  const projectionBudgets={json:{bytes:0,maxRowBytes:0},csv:{bytes:0,maxRowBytes:0}};
  function accountProjection(typed,row) {
    const native=Buffer.byteLength(JSON.stringify(typed)+'\n');
    // Python's explicit number conversion serializes a finite double in <=32 bytes.
    // Keep that conservative bound instead of assuming identical JS/Python float spelling.
    const numberAllowance=mapping.filter(field=>field.type==='number'&&row[field.path]!==null)
      .reduce((sum,field)=>sum+Math.max(0,32-Buffer.byteLength(JSON.stringify(row[field.path]))),0);
    const csv=Object.fromEntries(mapping.flatMap(field=>[[field.name,row[field.path]===null?'':String(row[field.path])],
      [field.name+'_state',row[field.path]===null?'null':'value']]));
    for(const [format,length]of [['json',native+numberAllowance],['csv',Buffer.byteLength(JSON.stringify(csv)+'\n')]]){
      projectionBudgets[format].bytes+=length;
      projectionBudgets[format].maxRowBytes=Math.max(projectionBudgets[format].maxRowBytes,length);
    }
  }
  const outputs=Object.fromEntries(['rows.jsonl','rows-index.jsonl','dataset.csv'].map(path=>[path,{hash:createHash('sha256'),bytes:0}]));
  async function output(path,raw) {
    const file=outputs[path];file.bytes+=raw.length;
    need(file.bytes<=limits.maxOutputBytes,'OUTPUT_SIZE','The selected collection output exceeds its byte limit.');
    file.hash.update(raw);await sink.data?.(path,raw);
  }
  async function analytical(raw) {
    if(!analysisOutput.active)return;
    analysisOutput.bytes+=raw.length;
    if(analysisOutput.bytes>Math.min(32*1024*1024,limits.maxOutputBytes)){analysisOutput.active=false;return;}
    analysisOutput.hash.update(raw);await sink.data?.('analysis-rows.json',raw);
  }
  await analytical(Buffer.from('[\n'));
  await output('dataset.csv',Buffer.from(mapping.flatMap(field=>[field.name,field.name+'_state']).join(',')+'\n'));
  for(let index=0;index<exchanges.length;index++) {
    const exchange=exchanges[index],prefix='pages/'+String(index+1).padStart(5,'0')+'/',raws={};
    raws.request=index===0?firstRequestRaw:await readRequestFile(exchange.requestPath,65536);
    const request=parse(raws.request);
    if(index===0)need(same(buildQuery(selected.plan,selected.catalog,id,request).query,query),'QUERY','The first query changed.');
    else need(previous?.completion==='continue'&&plain(request)&&Object.keys(request).length===1&&request.cursor===previous.next,
      'CHAIN','Each next request must contain only the preceding original returned cursor.');
    let native=null;
    if(exchange.buyerConfigPath!==undefined) {
      raws.buyer=await readRequestFile(exchange.buyerConfigPath,65536);
      raws.result=await readRequestFile(exchange.buyerResultPath,2097152);
      const original=originalBuyer(raws.buyer,raws.result,raws.request,selected,id);
      raws.response=await new RetainedResponse(exchange.responsePath,original.saved).bytes({limit:MAX_PAGE_BYTES});
      native=original.context;
      need(!intents.has(native.intentId),'INTENT_REPEAT','One purchase intent cannot identify two different pages in a collection.');
      intents.add(native.intentId);
    }else raws.response=await readRequestFile(exchange.responsePath,MAX_PAGE_BYTES);
    const page=parse(raws.response),checked=validatePage(page,selected.plan,selected.catalog,id);
    need(same(checked.query,query)&&page.queryFingerprint===compiled.fingerprint,'QUERY','A page belongs to another selected query.');
    need(page.seenRows===seenRows+page.items.length,'ROW_CONTINUITY','The original cumulative row counts do not form one complete chain.');
    need(page.items.length>0||page.completion!=='continue','EMPTY_CONTINUATION','A continuing provider page contains no rows.');
    need(seenRows+page.items.length<=limits.maxRows,'ROWS','The selected collection exceeds its row limit.');
    need(typeof page.receivedAt==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(page.receivedAt)&&Number.isFinite(Date.parse(page.receivedAt)),
      'SOURCE_TIME','A page is missing its original source acquisition time.');
    need(page.etag===null||typeof page.etag==='string','SOURCE_ETAG','A page has an invalid original ETag.');
    if(page.next!==null){need(!cursors.has(page.next),'CURSOR_REPEAT','The original continuation returned an earlier cursor.');cursors.add(page.next);}
    const pageFiles={};
    for(const role of ['request','response','buyer','result'])if(raws[role]!==undefined)pageFiles[role]=await sourceFile(prefix+role+'.json',raws[role]);
    const rowOffset=seenRows;
    for(let rowIndex=0;rowIndex<page.items.length;rowIndex++) {
      const row=page.items[rowIndex],key=keyIdentity(row,entity,selected.catalog);
      need(!keys.has(key),'DUPLICATE_KEY','The live collection repeats a declared entity key. Review the query and its original source pages.');
      keys.add(key);
      const values=mapping.flatMap(field=>cell(row,field));
      const typed=Object.fromEntries(mapping.flatMap(field=>[[field.name,row[field.path]],[field.name+'_state',row[field.path]===null?'null':'value']]));
      accountProjection(typed,row);
      await analytical(Buffer.from((seenRows?',\n':'')+JSON.stringify(typed)));
      await output('dataset.csv',Buffer.from(values.join(',')+'\n'));
      await output('rows.jsonl',Buffer.from(JSON.stringify(row)+'\n'));
      await output('rows-index.jsonl',Buffer.from(JSON.stringify({rowNumber:seenRows+1,page:index+1,pageRow:rowIndex+1,
        key:Object.fromEntries(entity.keyFields.map(field=>[field,row[field]]))})+'\n'));
      seenRows++;
    }
    pages.push({page:index+1,rowOffset,rows:page.items.length,seenRows:page.seenRows,count:page.count,
      completion:page.completion,supplierResponseSha256:page.supplierResponseSha256,receivedAt:page.receivedAt,
      etag:page.etag,files:pageFiles,native});
    previous=page;
  }
  need(previous&&previous.completion!=='continue'&&previous.next===null,'INCOMPLETE','Retain the remaining original page exchanges before receiving a complete collection.');
  await analytical(Buffer.from('\n]\n'));
  if(analysisOutput.active)files['analysis-rows.json']={bytes:analysisOutput.bytes,sha256:analysisOutput.hash.digest('hex')};
  const analysisFormat=analysisOutput.active?'json':'csv',projected=projectionBudgets[analysisFormat];
  need(projected.maxRowBytes<=MAX_ANALYSIS_ROW_BYTES&&projected.bytes<=MAX_ANALYSIS_PROJECTED_BYTES,
    'ANALYSIS_PROJECTION_SIZE','Choose a complete selection within the original Analysis 2 MiB row and 128 MiB projected JSONL limits.');
  const analysisProjection={format:analysisFormat,columns:mapping.length*2,
    bytesUpperBound:projected.bytes,maxRowBytesUpperBound:projected.maxRowBytes,
    exactBytes:analysisFormat==='csv',maxBytes:MAX_ANALYSIS_PROJECTED_BYTES,maxRowBytes:MAX_ANALYSIS_ROW_BYTES};
  for(const [path,file]of Object.entries(outputs))files[path]={bytes:file.bytes,sha256:file.hash.digest('hex')};
  const reportedCounts=[...new Set(pages.map(page=>page.count).filter(value=>value!==null))];
  const selection={sourceBinding:selected.sourceBinding,operation:id,title,query,fields:mapping.map(field=>field.path),limits,
    inputs:pages.map(page=>Object.fromEntries(Object.entries(page.files).map(([role,file])=>[role,{bytes:file.bytes,sha256:file.sha256}])))};
  const manifest={schema:COLLECTION_SCHEMA,selectionSha256:digest(bytes(selection)),title,sourceBinding:selected.sourceBinding,
    metadataSha256:selected.catalog.receipts.metadata.sha256,serviceRoot:selected.catalog.serviceUrl,merchantOrigin:selected.plan.publicOrigin,
    operation:id,entitySet:previous.entitySet,query,queryFingerprint:compiled.fingerprint,keyFields:[...entity.keyFields],
    rows:seenRows,pageCount:pages.length,completion:previous.completion,reportedCounts,countConsistent:reportedCounts.length<=1,
    acquisition:{kind:'live-continuation',firstReceivedAt:pages[0].receivedAt,lastReceivedAt:pages.at(-1).receivedAt},
    mapping,limits,sourceBytes,pages,originalFiles,analysisFormat,analysisProjection,files};
  need(bytes(manifest).length<=MAX_MANIFEST_BYTES,'MANIFEST_SIZE','The selected collection manifest exceeds its retained-file limit.');
  return {manifest,selection,prepared:selected};
}
function retainedExchanges(root,manifest) {
  return manifest.pages.map(page=>({
    requestPath:outputPath(root,page.files.request.path),responsePath:outputPath(root,page.files.response.path),
    ...(page.files.buyer?{buyerConfigPath:outputPath(root,page.files.buyer.path),buyerResultPath:outputPath(root,page.files.result.path)}:{})
  }));
}
function manifestShape(manifest) {
  need(plain(manifest)&&manifest.schema===COLLECTION_SCHEMA&&HASH.test(manifest.selectionSha256)&&
    Array.isArray(manifest.pages)&&manifest.pages.length>0&&manifest.pages.length<=DEFAULT_LIMITS.maxPages&&
    Array.isArray(manifest.mapping)&&Array.isArray(manifest.originalFiles)&&plain(manifest.files),
    'MANIFEST','Choose an original complete live collection.');
  for(const [path,file]of Object.entries(manifest.files)) {
    need(OUTPUT.test(path)&&!path.startsWith('analysis/')&&!['selection.json','collection.json'].includes(path)&&
      plain(file)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_DOCUMENT_BYTES&&HASH.test(file.sha256),
      'MANIFEST_FILE','The collection contains an invalid retained file.');
  }
}
async function verifyCore(directory) {
  const root=resolve(directory),manifestRaw=await readRequestFile(outputPath(root,'collection.json'),MAX_MANIFEST_BYTES),manifest=parse(manifestRaw);
  manifestShape(manifest);
  const original=await verifiedBytes(outputPath(root,'merchant.json'),manifest.files['merchant.json']);
  const merchant=parse(original),first=manifest.pages[0];
  need(merchant.schema==='stellar-forge.odata-live-collection-merchant.v1'&&merchant.sourceBinding===manifest.sourceBinding,
    'MERCHANT','The retained collection merchant differs.');
  const request=parse(await verifiedBytes(outputPath(root,first.files.request.path),first.files.request,65536));
  const allowLoopback=new URL(merchant.catalog.serviceUrl).protocol==='http:';
  const prepared=prepareDraft({catalog:merchant.catalog,plan:merchant.plan,selection:{operation:manifest.operation,request}},{allowLoopback});
  const observed=await scan(prepared,{operation:manifest.operation,title:manifest.title,fields:manifest.mapping.map(field=>field.path),
    limits:manifest.limits,exchanges:retainedExchanges(root,manifest),allowLoopback});
  need(same(observed.manifest,manifest),'RECEIVING_CHANGED','The complete retained collection differs from its original pages or projection.');
  const selectionRaw=await readRequestFile(outputPath(root,'selection.json'),MAX_MANIFEST_BYTES);
  need(digest(selectionRaw)===manifest.selectionSha256&&same(parse(selectionRaw),observed.selection),
    'SELECTION_CHANGED','The original collection selection differs.');
  for(const [path,file]of Object.entries(manifest.files))await new RetainedResponse(outputPath(root,path),file).verify();
  return {root,manifest,manifestRaw,prepared};
}

const TRANSFORM_URL='https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/collection.mjs';
function documentProvenance(manifest,transformSha256) {
  return {kind:'operator-file',publisher:manifest.merchantOrigin,capturedAt:manifest.acquisition.lastReceivedAt,
    scope:manifest.entitySet+'; query '+manifest.queryFingerprint+'; '+manifest.rows+' rows in '+manifest.pageCount+' pages',
    description:'Complete original live OData continuation collection. The source packet retains the prepared merchant catalog, selected projection, every original request and response, and any selected SF88 configuration and result. The collection manifest binds page order, declared keys, exact counts, source times, ETags and each original supplier response digest. The typed JSON projection preserves native nulls and scalar types. CSV columns preserve exact Decimal/Int64 text with a separate value/null state. Source counts and the acquisition window remain visible for this live selection.',
    transform:{name:'Original OData complete collection receiver',sourceUrl:TRANSFORM_URL,sha256:transformSha256}};
}
function documentRecord(identity,extension,contentType,role) {
  return {path:'files/'+identity.sha256+'.'+extension,bytes:identity.bytes,sha256:identity.sha256,contentType,...(role?{role}:{})};
}
async function documentPayloadPath(root,record) {
  need(plain(record)&&typeof record.path==='string'&&new RegExp('^files/'+record.sha256+'\\.(?:json|csv|bin|txt)$').test(record.path)&&
    HASH.test(record.sha256)&&Number.isSafeInteger(record.bytes)&&record.bytes>=0&&record.bytes<=MAX_DOCUMENT_BYTES,
    'DOCUMENT_FILE','The analytical source has an invalid content-addressed file.');
  const parent=join(resolve(root),'files'),info=await lstat(parent);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(parent)===parent,'DOCUMENT_DIRECTORY','The analytical source directory changed.');
  return join(root,record.path);
}
async function documentPayload(root,record){return verifiedBytes(await documentPayloadPath(root,record),record,MAX_DOCUMENT_BYTES);}

async function verifyDocument(sourceRoot,sourceRaw,expectedCore,onOriginal) {
  const source=parse(sourceRaw);
  need(sourceRaw.length<=1048576&&plain(source)&&source.schema===ANALYSIS_DOCUMENT_SCHEMA&&['csv','json'].includes(source.format)&&source.complete===true&&
    Array.isArray(source.originals)&&source.originals.length>=3&&source.originals.length<=32&&plain(source.document)&&
    plain(source.provenance)&&plain(source.provenance.transform),
    'DOCUMENT','Choose the complete original analytical collection handover.');
  const roles=new Map();
  for(const file of source.originals){
    need(typeof file.role==='string'&&!roles.has(file.role)&&file.bytes<=32*1024*1024,'DOCUMENT_ROLE','The analytical source repeats or exceeds an original file role.');
    roles.set(file.role,file);
  }
  const declared=roles.get('collection-manifest'),transform=roles.get('collection-transform');
  need(declared&&transform,'DOCUMENT_ORIGINALS','The analytical source omits its collection manifest or original transformation.');
  const manifestRaw=await documentPayload(sourceRoot,declared),manifest=parse(manifestRaw);
  manifestShape(manifest);
  const documentName=manifest.analysisFormat==='json'?'analysis-rows.json':'dataset.csv';
  const documentType=manifest.analysisFormat==='json'?'application/json':'text/csv; charset=utf-8';
  need(source.title===manifest.title&&source.format===manifest.analysisFormat&&same(source.provenance,documentProvenance(manifest,transform.sha256))&&
    source.document.sha256===manifest.files[documentName]?.sha256&&source.document.bytes===manifest.files[documentName]?.bytes&&
    source.document.path==='files/'+source.document.sha256+'.'+source.format&&source.document.contentType===documentType&&
    (source.format!=='json'||source.document.bytes<=32*1024*1024),
    'DOCUMENT_BINDING','The analytical source belongs to another collection or projection.');
  if(expectedCore)need(manifestRaw.equals(expectedCore.manifestRaw),'DOCUMENT_COLLECTION','The analytical handover changed its complete collection.');
  const unique=new Map();
  for(const file of [source.document,...source.originals]){
    const prior=unique.get(file.path);
    need(!prior||same({bytes:prior.bytes,sha256:prior.sha256,contentType:prior.contentType},
      {bytes:file.bytes,sha256:file.sha256,contentType:file.contentType}),'DOCUMENT_IDENTITY','The analytical source has conflicting file identities.');
    unique.set(file.path,file);
  }
  need([...unique.values()].reduce((total,file)=>total+file.bytes,0)<=MAX_DOCUMENT_BYTES,
    'DOCUMENT_SIZE','The complete analytical source exceeds 256 MiB.');
  const transformRaw=await documentPayload(sourceRoot,transform);
  need(transformRaw.length>0&&transform.contentType==='text/javascript; charset=utf-8',
    'DOCUMENT_TRANSFORM','The original collection transformation is missing.');
  const expected=new Set(manifest.originalFiles),received=new Set();
  const packets=[...roles.keys()].filter(role=>/^page-packet-[0-9]{4}$/.test(role)).sort();
  need(packets.length+2===roles.size&&packets.length>0,'DOCUMENT_PACKETS','The complete original page packets are missing.');
  for(let index=0;index<packets.length;index++){
    const role=packets[index];
    need(role==='page-packet-'+String(index+1).padStart(4,'0'),'DOCUMENT_PACKET_ORDER','The original page packet sequence differs.');
    const record=roles.get(role);
    need(record.contentType==='application/gzip','DOCUMENT_PACKET_TYPE','Use the original compressed page packets.');
    const packed=await documentPayload(sourceRoot,record);
    let unpacked;try{unpacked=gunzipSync(packed,{maxOutputLength:PACKET_PLAIN_BYTES});}
    catch{need(false,'DOCUMENT_PACKET','The original page packet cannot be read within its declared size.');}
    const lines=new TextDecoder('utf-8',{fatal:true}).decode(unpacked).split('\n');
    need(lines.pop()===''&&lines.length>1,'DOCUMENT_PACKET','The original page packet framing differs.');
    const header=JSON.parse(lines.shift());
    need(header.schema===PACKET_SCHEMA&&header.sequence===index+1&&header.collectionSha256===digest(manifestRaw),
      'DOCUMENT_PACKET_BINDING','A page packet belongs to another collection.');
    for(const line of lines){
      const item=JSON.parse(line);
      need(plain(item)&&plain(item.file)&&typeof item.bodyBase64==='string'&&expected.has(item.file.path)&&!received.has(item.file.path)&&
        same(manifest.files[item.file.path],{bytes:item.file.bytes,sha256:item.file.sha256}),
        'DOCUMENT_PACKET_MEMBER','The original page packet repeats or changes a selected source member.');
      const raw=Buffer.from(item.bodyBase64,'base64');
      need(raw.toString('base64')===item.bodyBase64&&raw.length===item.file.bytes&&digest(raw)===item.file.sha256,
        'DOCUMENT_PACKET_BYTES','The original source bytes changed inside their page packet.');
      received.add(item.file.path);await onOriginal?.(item.file.path,raw);
    }
  }
  need(received.size===expected.size,'DOCUMENT_INCOMPLETE','The analytical source omits an original collection member.');
  await new RetainedResponse(await documentPayloadPath(sourceRoot,source.document),source.document).verify();
  return {source,sourceRaw,manifest,manifestRaw,uniqueFiles:[...unique.values()]};
}
async function createDocument(core) {
  const {root,manifest,manifestRaw}=core,path=outputPath(root,'analysis/source.json');
  try{
    const raw=await readRequestFile(path,1048576);
    await verifyDocument(join(root,'analysis'),raw,core);
    return {path:'analysis/source.json',bytes:raw.length,sha256:digest(raw),format:core.manifest.analysisFormat};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const documentName=manifest.analysisFormat==='json'?'analysis-rows.json':'dataset.csv';
  const document=documentRecord(manifest.files[documentName],manifest.analysisFormat,
    manifest.analysisFormat==='json'?'application/json':'text/csv; charset=utf-8');
  await copySame(root,'analysis/'+document.path,outputPath(root,documentName),manifest.files[documentName]);
  const originalManifest=documentRecord(fileIdentity('collection.json',manifestRaw),'json','application/json','collection-manifest');
  await writeSame(root,'analysis/'+originalManifest.path,manifestRaw);
  const {fileURLToPath}=await import('node:url');
  const sourceRaw=await readRequestFile(fileURLToPath(import.meta.url),1048576);
  const transform=documentRecord(fileIdentity('collection.mjs',sourceRaw),'bin','text/javascript; charset=utf-8','collection-transform');
  await writeSame(root,'analysis/'+transform.path,sourceRaw);
  const originals=[originalManifest,transform];let sequence=1,parts=[],size=0;
  function begin(){
    const header=Buffer.from(JSON.stringify({schema:PACKET_SCHEMA,sequence,collectionSha256:digest(manifestRaw)})+'\n');
    parts=[header];size=header.length;
  }
  async function finish(){
    if(parts.length===1)return;
    const packed=gzipSync(Buffer.concat(parts),{level:6});
    need(packed.length<=32*1024*1024&&originals.length<32,'DOCUMENT_SIZE','The original source requires a smaller complete selection for analytical delivery.');
    const record=documentRecord(fileIdentity('',packed),'bin','application/gzip','page-packet-'+String(sequence).padStart(4,'0'));
    await writeSame(root,'analysis/'+record.path,packed);originals.push(record);sequence++;
  }
  begin();
  for(const path of manifest.originalFiles){
    const raw=await verifiedBytes(outputPath(root,path),manifest.files[path]);
    const line=Buffer.from(JSON.stringify({file:{path,...manifest.files[path]},bodyBase64:raw.toString('base64')})+'\n');
    need(line.length+parts[0].length<=PACKET_PLAIN_BYTES,'PACKET_SIZE','One selected original file exceeds the analytical page-packet limit.');
    if(size+line.length>PACKET_PLAIN_BYTES){await finish();begin();}
    parts.push(line);size+=line.length;
  }
  await finish();
  const selected={schema:ANALYSIS_DOCUMENT_SCHEMA,title:manifest.title,format:manifest.analysisFormat,document,originals,
    provenance:documentProvenance(manifest,transform.sha256),complete:true};
  const raw=bytes(selected);
  await verifyDocument(join(root,'analysis'),raw,core);
  await writeSame(root,'analysis/source.json',raw);
  return {path:'analysis/source.json',bytes:raw.length,sha256:digest(raw),format:core.manifest.analysisFormat};
}
async function receiveUnlocked(root,prepared,input) {
  const expected=await scan(prepared,input);
  await writeSame(root,'selection.json',bytes(expected.selection));
  const streams={};
  try{
    for(const path of ['rows.jsonl','rows-index.jsonl','dataset.csv',...(expected.manifest.analysisFormat==='json'?['analysis-rows.json']:[])])streams[path]=await writer(root,path,{path,...expected.manifest.files[path]});
    const actual=await scan(prepared,input,{
      async file(path,raw,identity){
        need(same(expected.manifest.files[path],{bytes:identity.bytes,sha256:identity.sha256}),
          'SOURCE_CHANGED','An original input changed during collection receiving.');
        await writeSame(root,path,raw);
      },
      async data(path,raw){if(streams[path])await streams[path].write(raw);}
    });
    need(same(actual.manifest,expected.manifest),'SOURCE_CHANGED','The original collection changed during receiving.');
    for(const sink of Object.values(streams))await sink.finish();
    const manifestRaw=bytes(expected.manifest);
    await writeSame(root,'collection.json',manifestRaw);
    const core={root,manifest:expected.manifest,manifestRaw,prepared:expected.prepared};
    const analysis=await createDocument(core);
    return {directory:root,...core.manifest,manifestSha256:digest(manifestRaw),analysis};
  }finally{for(const sink of Object.values(streams))await sink.abort();}
}
/** Complete ordered requests/responses, preserving the original buyer and source. */
export async function receiveCollection(prepared,input) {
  need(plain(input)&&typeof input.directory==='string','DIRECTORY','Choose a private receiving directory.');
  const root=await privateDirectory(input.directory),lease=await acquireReleaseLease(root,'collection.lock');
  try{return await receiveUnlocked(root,prepared,input);}finally{await lease.close();}
}
/** Reopen all original pages, compiled meaning, exact outputs and Analysis custody. */
export async function openCollection(directory) {
  const core=await verifyCore(directory),sourceRaw=await readRequestFile(outputPath(core.root,'analysis/source.json'),1048576);
  await verifyDocument(join(core.root,'analysis'),sourceRaw,core);
  return {directory:core.root,...core.manifest,manifestSha256:digest(core.manifestRaw),
    analysis:{path:'analysis/source.json',bytes:sourceRaw.length,sha256:digest(sourceRaw),format:core.manifest.analysisFormat}};
}
/** Restore an Analysis-held source document, including every original paid page. */
export async function restoreCollection({sourceManifest,directory,expectedSha256}={}) {
  need(typeof sourceManifest==='string'&&typeof directory==='string','RESTORE','Select the retained Analysis source manifest and a receiving directory.');
  const selectedPath=resolve(sourceManifest),sourceRoot=dirname(selectedPath),sourceRaw=await readRequestFile(selectedPath,1048576);
  if(expectedSha256!==undefined)need(HASH.test(expectedSha256)&&digest(sourceRaw)===expectedSha256,'RESTORE_IDENTITY','The selected analytical source manifest changed.');
  const checked=await verifyDocument(sourceRoot,sourceRaw),root=await privateDirectory(directory),lease=await acquireReleaseLease(root,'collection.lock');
  try{
    await verifyDocument(sourceRoot,sourceRaw,null,async(path,raw)=>{await writeSame(root,path,raw);});
    for(const file of checked.uniqueFiles)await copySame(root,'analysis/'+file.path,await documentPayloadPath(sourceRoot,file),file);
    await writeSame(root,'analysis/source.json',sourceRaw);
    const merchant=parse(await verifiedBytes(outputPath(root,'merchant.json'),checked.manifest.files['merchant.json']));
    const first=checked.manifest.pages[0],request=parse(await verifiedBytes(outputPath(root,first.files.request.path),first.files.request));
    const allowLoopback=new URL(merchant.catalog.serviceUrl).protocol==='http:';
    const prepared=prepareDraft({catalog:merchant.catalog,plan:merchant.plan,selection:{operation:checked.manifest.operation,request}},{allowLoopback});
    const result=await receiveUnlocked(root,prepared,{operation:checked.manifest.operation,title:checked.manifest.title,
      fields:checked.manifest.mapping.map(field=>field.path),limits:checked.manifest.limits,
      exchanges:retainedExchanges(root,checked.manifest),allowLoopback});
    need(result.manifestSha256===digest(checked.manifestRaw),'RESTORE_CHANGED','The receiving collection differs from its complete original.');
    return {...result,restoredFrom:{sha256:digest(sourceRaw),bytes:sourceRaw.length}};
  }finally{await lease.close();}
}
/** Read a useful page while exhausting the original saved-file hash reader. */
export async function readCollectionRows(directory,{offset=0,limit=100}={}) {
  safeInteger(offset,0,DEFAULT_LIMITS.maxRows,'row offset');safeInteger(limit,1,500,'row page size');
  const collection=await openCollection(directory),rows=[],identity=collection.files['rows.jsonl'];
  const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',count=0;
  function accept(line){if(!line)return;const value=JSON.parse(line);if(count>=offset&&rows.length<limit)rows.push(value);count++;}
  for await(const chunk of new RetainedResponse(outputPath(collection.directory,'rows.jsonl'),identity).chunks()){
    pending+=decoder.decode(chunk,{stream:true});let next;
    while((next=pending.indexOf('\n'))>=0){accept(pending.slice(0,next));pending=pending.slice(next+1);}
    need(Buffer.byteLength(pending)<=MAX_PAGE_BYTES,'ROW_SIZE','One collection row exceeds its original response bound.');
  }
  pending+=decoder.decode();need(!pending,'ROWS_FRAMING','The complete collection row framing changed.');
  need(count===collection.rows,'ROWS_COUNT','The collection row count changed.');
  return {collectionSha256:collection.manifestSha256,offset,total:count,rows,nextOffset:offset+rows.length<count?offset+rows.length:null};
}

/** Original Analysis response-preview input for the retained source registration. */
export function collectionAnalysisMapping(collection,{source,sourceRevision}={}) {
  manifestShape(collection);
  need(typeof source==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(source)&&
    Number.isSafeInteger(sourceRevision)&&sourceRevision>0,'ANALYSIS_SOURCE','Choose the actual registered source name and revision.');
  const pointer=name=>'/'+name.replaceAll('~','~0').replaceAll('/','~1');
  const columns=collection.mapping.flatMap(field=>[
    {name:field.name,pointer:pointer(field.name),type:collection.analysisFormat==='json'?(field.type==='number'?'number':'native'):'text',missing:'error'},
    {name:field.name+'_state',pointer:pointer(field.name+'_state'),type:'text',missing:'error'}]);
  return {source,source_revision:sourceRevision,mapping:{collection:'',sse_data:'text',columns}};
}
