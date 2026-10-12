// MIT. Original SEC edition -> retained Analysis source-document input.
// Uses the maintained SEC parser and local SF31 saveBytes writer.
import {readFile,lstat,mkdir,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const PREFIX='stellar/scf-starforge-20261009/';
const SELF_PATH=PREFIX+'sf88-operator-buyer-cli/python/examples/sec_source_document.mjs';
const SEC_PATH=PREFIX+'sf30-seller-sdk/sec-edgar/source.mjs';
const REPOSITORY='woahwhattheheck/public-commons-sprint-2026';
const MAX=32*1024*1024;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const gitBlob=raw=>createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const blobUrl=(repository,blob)=>'https://api.github.com/repos/'+repository+'/git/blobs/'+blob;

export const FACT_COLUMNS=Object.freeze({
 cik:'cik',entity_name:'entityName',taxonomy:'taxonomy',concept:'concept',label:'label',unit:'unit',
 value_text:'value',value_type:'valueType',period_start:'start',period_end:'end',accession:'accession',
 filed:'filed',form:'form',fiscal_year:'fy',fiscal_period:'fp',frame:'frame',
 source_index:'sourceIndex',unit_index:'unitIndex'
});
export const FILING_COLUMNS=Object.freeze({
 cik:'cik',entity_name:'entityName',accession:'accession',filed:'filed',form:'form',
 report_date:'reportDate',acceptance_datetime:'acceptanceDateTime',primary_document:'primaryDocument',
 description:'primaryDocDescription',size_bytes:'size',is_xbrl:'isXBRL',is_inline_xbrl:'isInlineXBRL',
 is_xbrl_numeric:'isXBRLNumeric',core_type:'coreType',items:'items',act:'act',file_number:'fileNumber',
 film_number:'filmNumber',document_url:'documentUrl',source_index:'sourceIndex'
});
export const SOURCE_COLUMNS=Object.freeze([
 'edition_id','source_sha256','source_url','captured_at','capture_scope'
]);

async function regular(path,maximum=MAX){
 const info=await lstat(path);
 need(info.isFile()&&!info.isSymbolicLink()&&info.size<=maximum,'SEC_ANALYSIS_REGULAR_SOURCE_REQUIRED');
 const bytes=await readFile(path);
 need(bytes.length===info.size&&bytes.length<=maximum,'SEC_ANALYSIS_SOURCE_CHANGED');
 return bytes;
}
async function directory(path,{create=false}={}){
 const absolute=resolve(path);
 if(create)await mkdir(absolute,{recursive:true,mode:0o700});
 const info=await lstat(absolute);
 need(info.isDirectory()&&!info.isSymbolicLink(),'SEC_ANALYSIS_DIRECTORY_REQUIRED');
 return realpath(absolute);
}
function scalar(value){
 if(value===undefined||value===null)return null;
 need(['string','number','boolean'].includes(typeof value),'SEC_ANALYSIS_ORIGINAL_SCALAR_REQUIRED');
 if(typeof value==='number')need(Number.isSafeInteger(value),'SEC_ANALYSIS_UNSAFE_ORIGINAL_INTEGER');
 return value;
}
function mappedRows(edition){
 const fields=edition.record.kind==='facts'?FACT_COLUMNS:FILING_COLUMNS;
 return edition.rows.map(row=>{
  const output={};
  for(const [name,original] of Object.entries(fields)){
   const value=row[original];
   // The native SEC parser retains each JSON numeric token for a fact as text.
   // Boolean/string facts retain their type label alongside their exact text.
   output[name]=name==='value_text'?(typeof value==='string'?value:JSON.stringify(value)):scalar(value);
  }
  return {...output,edition_id:edition.record.id,source_sha256:edition.record.sourceSha256,
   source_url:edition.record.sourceUrl,captured_at:edition.record.capturedAt,capture_scope:edition.record.scope};
 });
}
function scopeDescription(record){
 if(record.kind==='facts')return 'Every fact retained in this original companyfacts response. Units, periods, filing dates and repeated reported values remain separate. This capture is the publisher response at the recorded capture time.';
 const history=record.historyFiles??[];
 if(record.scope==='submissions-history')return 'Every filing in this specific original historical submissions file. Other recent or historical submissions files are outside this selected scope.';
 return 'Every filing in this original recent-submissions response. '+
  (history.length?'The source lists '+history.length+' additional historical file(s), retained in the original edition metadata but not acquired by this transformation. '+
   history.map(item=>[item.name,item.filingCount===null?'count unspecified':String(item.filingCount)+' filings',item.filingFrom??'',item.filingTo??''].filter(Boolean).join(' · ')).join('; '):
   'The original source lists no additional historical file in this capture.');
}
async function exactWriter(prepare,destination,bytes,contentType){
 try{
  const old=await regular(destination,Math.max(MAX,bytes.length));
  need(old.equals(bytes),'SEC_ANALYSIS_EXISTING_FILE_CHANGED');
  return;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const writer=await prepare({destination,maxBytes:MAX,timeoutMs:300000,
  expectedBytes:bytes.length,expectedSha256:sha(bytes),expectedContentType:contentType});
 await writer.saveBytes(bytes,{contentType});
}
export async function prepareSecDocument({checkout,store:sourceDirectory,editionId,out,expectedSourceBlob}){
 need(typeof checkout==='string'&&typeof sourceDirectory==='string'&&typeof out==='string',
  'SEC_ANALYSIS_SOURCE_SELECTION_REQUIRED');
 need(typeof editionId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(editionId),'SEC_ANALYSIS_EDITION_REQUIRED');
 const root=await directory(checkout),origin=await directory(sourceDirectory);
 // Read/open is allowed only for an existing original store. Its constructor
 // therefore cannot silently create a new empty capture selection.
 await directory(join(origin,'editions'));await directory(join(origin,'blobs'));
 const nativePath=join(root,SEC_PATH),nativeBytes=await regular(nativePath,1024*1024);
 const nativeBlob=gitBlob(nativeBytes);
 need(expectedSourceBlob===undefined||expectedSourceBlob===nativeBlob,'SEC_ANALYSIS_SELECTED_PARSER_CHANGED');
 const bridgeBytes=await regular(fileURLToPath(import.meta.url),1024*1024);
 const bridgeBlob=gitBlob(bridgeBytes);
 const [{openEdgarStore},{prepareBuyerResponseFile}]=await Promise.all([
  import(pathToFileURL(nativePath)),
  import(pathToFileURL(join(root,PREFIX+'sf31-buyer-client/response-file.mjs')))
 ]);
 const original=await openEdgarStore(origin);
 try{
  const editionPath=join(origin,'editions',editionId+'.json');
  const editionBytes=await regular(editionPath,1024*1024);
  const edition=await original.getEdition(editionId,{includeRows:true});
  need(JSON.stringify(JSON.parse(editionBytes))===JSON.stringify(edition.record),
   'SEC_ANALYSIS_EDITION_CHANGED');
  const capture=await original.readRaw(editionId);
  need(capture.length===edition.record.sourceBytes&&sha(capture)===edition.record.sourceSha256,
   'SEC_ANALYSIS_CAPTURE_CHANGED');
  need(edition.rows.length===edition.record.recordCount,'SEC_ANALYSIS_ROW_COUNT_CHANGED');
  const rows=mappedRows(edition);
  const represented={
   schema:'stellar-forge.sec-analysis-records.v1',
   source:{...edition.record,parser:{path:SEC_PATH,blob:nativeBlob,sha256:sha(nativeBytes)},
    projection:{schema:'stellar-forge.sec-analysis-fields.v1',path:SELF_PATH,blob:bridgeBlob,
     sha256:sha(bridgeBytes),fields:edition.record.kind==='facts'?FACT_COLUMNS:FILING_COLUMNS}},
   rowCount:rows.length,rows
  };
  const document=json(represented);
  need(document.length<=MAX,'SEC_ANALYSIS_DOCUMENT_EXCEEDS_JSON_READER_LIMIT');
  const target=await directory(out,{create:true});await directory(join(target,'files'),{create:true});
  const put=async(bytes,extension,contentType)=>{
   const digest=sha(bytes),path='files/'+digest+'.'+extension;
   await exactWriter(prepareBuyerResponseFile,join(target,path),bytes,contentType);
   return {path,bytes:bytes.length,sha256:digest,contentType};
  };
  const analytical=await put(document,'json','application/json');
  const raw=await put(capture,'json','application/json');
  const recordFile=await put(editionBytes,'json','application/json');
  const parserFile=await put(nativeBytes,'txt','text/plain');
  const bridgeFile=await put(bridgeBytes,'txt','text/plain');
  need((await regular(editionPath,1024*1024)).equals(editionBytes),'SEC_ANALYSIS_EDITION_CHANGED');
  need((await regular(nativePath,1024*1024)).equals(nativeBytes),'SEC_ANALYSIS_PARSER_SOURCE_CHANGED');
  const manifest={
   schema:'stellar-forge.analysis-source-document.v1',
   title:edition.record.entityName.slice(0,100)+' · '+edition.record.kind+' · '+edition.record.id,
   format:'json',document:analytical,
   originals:[
    {...raw,role:'sec-original-capture',sourceUrl:edition.record.sourceUrl},
    {...recordFile,role:'sec-edition-metadata',sourceUrl:edition.record.sourceUrl},
    {...parserFile,role:'sec-native-parser-source',sourceUrl:blobUrl(REPOSITORY,nativeBlob)},
    {...bridgeFile,role:'sec-analysis-bridge-source',sourceUrl:blobUrl(REPOSITORY,bridgeBlob)}
   ],
   provenance:{kind:'public-source',publisher:'U.S. Securities and Exchange Commission',
    capturedAt:edition.record.capturedAt,sourceUrl:edition.record.sourceUrl,
    scope:edition.record.scope+' · CIK'+edition.record.cik,
    description:scopeDescription(edition.record),
    transform:{name:'Original SEC edition to Analysis source-document fields v1',
     sourceUrl:blobUrl(REPOSITORY,bridgeBlob),sha256:sha(bridgeBytes)}},
   complete:true
  };
  const manifestBytes=json(manifest);
  await exactWriter(prepareBuyerResponseFile,join(target,'source.json'),manifestBytes,'application/json');
  return {schema:'stellar-forge.sec-analysis-preparation.v1',edition:edition.record,
   rows:rows.length,fields:[...Object.keys(edition.record.kind==='facts'?FACT_COLUMNS:FILING_COLUMNS),...SOURCE_COLUMNS],
   directory:target,manifest:join(target,'source.json'),documentId:sha(manifestBytes),
   documentBytes:document.length,documentSha256:sha(document),
   parserBlob:nativeBlob,bridgeBlob,scope:manifest.provenance};
 }finally{await original.close();}
}
function argumentsFrom(argv){
 const options={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  need(['--checkout','--store','--edition','--out','--expected-source-blob'].includes(key)&&value!==undefined,
   'SEC_ANALYSIS_CLI_ARGUMENT_INVALID');
  need(!(key in options),'SEC_ANALYSIS_CLI_ARGUMENT_REPEATED');options[key]=value;
 }
 return {checkout:options['--checkout'],store:options['--store'],editionId:options['--edition'],
  out:options['--out'],expectedSourceBlob:options['--expected-source-blob']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--help')){
  process.stdout.write('node sec_source_document.mjs --checkout ORIGINAL_CHECKOUT --store ORIGINAL_SEC_STORE --edition ORIGINAL_EDITION_ID --out PRIVATE_DOCUMENT_DIRECTORY [--expected-source-blob GIT_SHA]\n');
 }else prepareSecDocument(argumentsFrom(process.argv.slice(2)))
  .then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'))
  .catch(error=>{process.stderr.write((error.code??error.message)+'\n');process.exitCode=1;});
}
