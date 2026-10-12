// MIT. Receive complete recorded public-source bodies through the original OpenFEMA importer.
// No provider request, alternate store, capture job or payment operation is started here.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TextDecoder} from 'node:util';
import {stable,writeNew,syncDir} from '../stellar-expert/store.mjs';
import {DATASETS,validateScope,validateOpenFemaResponseReceipt,parseOpenFemaJSON} from './capture.mjs';

export const RECORDED_SOURCE_PARTS_SCHEMA='stellar-forge.openfema-recorded-source-parts.v1';
const BUNDLE_SCHEMA='stellar-forge.openfema-source-bundle.v1';
const CONNECTOR_SCHEMA='stellar-forge.openfema-connector-file.v1';
const MAX_BUNDLE=64*1024*1024,MAX_MANIFEST=2*1024*1024,MAX_PART=200*1024;
const SHA=/^[a-f0-9]{64}$/,FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>structuredClone(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function checkedFile(value){
  if(typeof value!=='string'||!FILE.test(value)||value==='.'||value==='..')
    throw fail('OPENFEMA_RECORDED_FILE','Use the original declared flat source filename.');
  return value;
}
/** Build one explicitly qualified receipt from the two complete returned connector objects.
 * These clocks are when this receiver observed the tool results, not FEMA response times.
 * The complete original download content remains unchanged in the evidence and body.
 */
export function recordConnectorResponse({url,requestedAt,uploadReceivedAt,downloadReceivedAt,
  responseIndex,sourceSlot,createAttachment,downloadAttachment}={}){
  const target=new URL(url);
  if(target.origin!=='https://www.fema.gov'||!target.pathname.startsWith('/api/open/')||
     target.username||target.password||target.hash)
    throw fail('OPENFEMA_RECORDED_URL','Record an exact original public OpenFEMA API URL.');
  if(!iso(requestedAt)||!iso(uploadReceivedAt)||!iso(downloadReceivedAt)||!plain(downloadAttachment))
    throw fail('OPENFEMA_RECORDED_CLOCK','Retain the actual request and receiving clocks with both original connector results.');
  const text=downloadAttachment.content;
  if(typeof text!=='string')throw fail('OPENFEMA_RECORDED_TEXT','The complete original connector download content is required.');
  const bytes=Buffer.from(text,'utf8');
  if(bytes.length>MAX_BUNDLE)throw fail('OPENFEMA_RECORDED_SIZE','This original body exceeds the source receiving capacity.');
  const connector={schema:CONNECTOR_SCHEMA,provider:'notion-public-file',sourceUrl:url,
    responseIndex,sourceSlot,requestedAt,uploadReceivedAt,downloadReceivedAt,
    createAttachment:clone(createAttachment),downloadAttachment:clone(downloadAttachment)};
  const receipt={url,status:null,method:null,headers:null,observedAt:downloadReceivedAt,
    observationTiming:'connector-download-received',bytes:bytes.length,sha256:hash(bytes),
    connector,connectorSha256:hash(Buffer.from(stable(connector))),bodyBase64:bytes.toString('base64')};
  validateOpenFemaResponseReceipt(receipt,url,{sourceSlot});
  parseOpenFemaJSON(bytes);
  return receipt;
}
function eachResponse(bundle){
  const result=[];
  for(const kind of Object.keys(DATASETS)){
    const d=bundle.datasets[kind];
    if(!plain(d)||!Array.isArray(d.pages))throw fail('OPENFEMA_RECORDED_DATASET','Retain every complete dataset and its ordered page array.');
    result.push([kind+'/metadata',d.metadata],[kind+'/fields',d.fields]);
    for(const [i,page]of d.pages.entries())result.push([kind+'/page/'+i,page]);
    result.push([kind+'/metadataEnd',d.metadataEnd]);
  }
  return result;
}
/** Verify the transport/body identity. The existing capture importer remains the authority
 * for exact source URL/scope, metadata/field versions, complete paging, order and refresh.
 */
export function inspectRecordedSourceBundle(bundle){
  if(!plain(bundle)||bundle.schema!==BUNDLE_SCHEMA||!plain(bundle.datasets)||
     !/^[a-f0-9]{24}$/.test(bundle.captureId??''))
    throw fail('OPENFEMA_RECORDED_BUNDLE','Choose the complete original three-dataset source bundle.');
  const scope=validateScope(bundle.scope),responses=[];
  let lastConnectorIndex=-1,totalOriginalBytes=0;
  for(const [slot,r]of eachResponse(bundle)){
    if(!plain(r)||typeof r.url!=='string')throw fail('OPENFEMA_RECORDED_RESPONSE','An original response is missing.');
    validateOpenFemaResponseReceipt(r,r.url,{sourceSlot:slot});
    let bytes;
    if(typeof r.bodyBase64==='string'&&r.bodyText===undefined&&
       /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.bodyBase64))
      bytes=Buffer.from(r.bodyBase64,'base64');
    else if(typeof r.bodyText==='string'&&r.bodyBase64===undefined)bytes=Buffer.from(r.bodyText,'utf8');
    else throw fail('OPENFEMA_RECORDED_BODY','Retain exactly one complete original body representation.');
    if(bytes.length!==r.bytes||hash(bytes)!==r.sha256)
      throw fail('OPENFEMA_RECORDED_CHANGED','The exact original body differs from its source receipt.');
    parseOpenFemaJSON(bytes);
    if(r.connector!==undefined){
      if(r.connector.responseIndex<=lastConnectorIndex)
        throw fail('OPENFEMA_RECORDED_ORDER','Retain the original connector response order, including repeated opening and closing URLs.');
      lastConnectorIndex=r.connector.responseIndex;
    }
    totalOriginalBytes+=bytes.length;
    responses.push({sourceSlot:slot,url:r.url,bytes:r.bytes,sha256:r.sha256,
      acquisition:r.connector?'connector-public-file':'direct-http',
      connectorSha256:r.connectorSha256??null});
  }
  return {schema:'stellar-forge.openfema-recorded-source-inspection.v1',captureId:bundle.captureId,
    scope,responseCount:responses.length,totalOriginalBytes,responses,
    providerHttpMetadata:responses.some(r=>r.acquisition==='connector-public-file')?'unexposed-for-connector-responses':'retained-direct-http'};
}
export function assembleRecordedSourceBundle({captureId,scope,label='Original complete OpenFEMA disaster cohort',datasets}={}){
  const bundle={schema:BUNDLE_SCHEMA,captureId,scope:validateScope(scope),label,datasets:clone(datasets)};
  inspectRecordedSourceBundle(bundle);
  return bundle;
}
async function readHeld(path,maximum){
  const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const a=await f.stat({bigint:true});
    if(!a.isFile()||a.size<0n||a.size>BigInt(maximum))throw fail('OPENFEMA_RECORDED_SIZE','Select a complete regular file within the declared receiving bound.');
    const bytes=await f.readFile(),b=await f.stat({bigint:true});
    if(a.dev!==b.dev||a.ino!==b.ino||a.size!==b.size||a.mtimeNs!==b.mtimeNs||a.ctimeNs!==b.ctimeNs||BigInt(bytes.length)!==a.size)
      throw fail('OPENFEMA_RECORDED_CHANGED','An original source file changed during receiving.');
    return bytes;
  }finally{await f.close();}
}
/** Read exact ordered parts retained by a text-only attachment channel. Part sizes/offsets
 * describe the unchanged full bundle, not a new FEMA pagination or subset selection.
 */
export async function readRecordedSourceParts({directory,manifestFile,expectedManifestSha256}={}){
  if(typeof manifestFile!=='string'||!manifestFile)throw fail('OPENFEMA_RECORDED_MANIFEST','Select the original complete part manifest.');
  const manifestPath=resolve(manifestFile),root=resolve(directory??dirname(manifestPath));
  const manifestBytes=await readHeld(manifestPath,MAX_MANIFEST),manifestSha256=hash(manifestBytes);
  if(expectedManifestSha256!==undefined&&(!SHA.test(expectedManifestSha256)||expectedManifestSha256!==manifestSha256))
    throw fail('OPENFEMA_RECORDED_MANIFEST_CHANGED','The selected original manifest differs from its supplied digest.');
  let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}
  catch{throw fail('OPENFEMA_RECORDED_MANIFEST','The original part manifest must be complete UTF-8 JSON.');}
  if(!plain(manifest)||manifest.schema!==RECORDED_SOURCE_PARTS_SCHEMA||manifest.encoding!=='utf-8'||
     !plain(manifest.bundle)||!SHA.test(manifest.bundle.sha256??'')||
     !Number.isSafeInteger(manifest.bundle.bytes)||manifest.bundle.bytes<1||manifest.bundle.bytes>MAX_BUNDLE||
     !Array.isArray(manifest.parts)||!manifest.parts.length||manifest.parts.length>4096)
    throw fail('OPENFEMA_RECORDED_MANIFEST','Choose a complete bounded original-source part manifest.');
  const chunks=[],names=new Set();let offset=0;
  for(const [i,part]of manifest.parts.entries()){
    if(!plain(part))throw fail('OPENFEMA_RECORDED_PARTS','Each original source part needs its complete identity.');
    const name=checkedFile(part.filename);
    if(names.has(name)||part.part!==i+1||part.offset!==offset||
       !Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>MAX_PART||
       offset+part.bytes>manifest.bundle.bytes||!SHA.test(part.sha256??''))
      throw fail('OPENFEMA_RECORDED_PARTS','Original source parts must cover the complete bundle once in their declared order.');
    names.add(name);const bytes=await readHeld(join(root,name),part.bytes);
    if(bytes.length!==part.bytes||hash(bytes)!==part.sha256)throw fail('OPENFEMA_RECORDED_PART_CHANGED','An original source part changed: '+name);
    chunks.push(bytes);offset+=bytes.length;
  }
  if(offset!==manifest.bundle.bytes)throw fail('OPENFEMA_RECORDED_INCOMPLETE','The original source part closure is incomplete.');
  const bytes=Buffer.concat(chunks,offset);
  if(hash(bytes)!==manifest.bundle.sha256)throw fail('OPENFEMA_RECORDED_BUNDLE_CHANGED','The assembled original bundle has a different digest.');
  let bundle;try{bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fail('OPENFEMA_RECORDED_BUNDLE','The complete original bundle is not valid UTF-8 JSON.');}
  const inspection=inspectRecordedSourceBundle(bundle);
  if(manifest.bundle.captureId!==bundle.captureId)
    throw fail('OPENFEMA_RECORDED_CAPTURE','The part manifest names a different original capture.');
  return {manifest,manifestSha256,bytes,bundle,inspection};
}
export async function materializeRecordedSourceParts(options){
  const result=await readRecordedSourceParts(options);
  if(typeof options.out!=='string'||!options.out)throw fail('OPENFEMA_RECORDED_OUTPUT','Select a new output JSON path.');
  const path=resolve(options.out);
  try{await writeNew(path,result.bytes);await syncDir(dirname(path));}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const existing=await readHeld(path,MAX_BUNDLE);
    if(existing.length!==result.bytes.length||hash(existing)!==result.manifest.bundle.sha256)
      throw fail('OPENFEMA_RECORDED_OUTPUT_EXISTS','The chosen output already exists with different or incomplete bytes. Preserve it and choose a new path.');
    return {path,sha256:hash(existing),bytes:existing.length,manifestSha256:result.manifestSha256,reused:true,inspection:result.inspection};
  }
  return {path,sha256:result.manifest.bundle.sha256,bytes:result.bytes.length,manifestSha256:result.manifestSha256,reused:false,inspection:result.inspection};
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){
    process.stdout.write('OpenFEMA recorded-source receiving\n\n  node recorded-source.mjs inspect --manifest ORIGINAL_MANIFEST.json [--directory ORIGINAL_PARTS] [--expected-manifest-sha256 SHA]\n  node recorded-source.mjs assemble --manifest ORIGINAL_MANIFEST.json [--directory ORIGINAL_PARTS] [--expected-manifest-sha256 SHA] --out NEW_BUNDLE.json\n\nThen use the unchanged original CLI: openfema receive-source --workspace PRIVATE_DIR --bundle NEW_BUNDLE.json\nNo provider request or workspace mutation is performed by this receiving command.\n');return;
  }
  const [command,...rest]=args,o={};
  if(!['inspect','assemble'].includes(command))throw fail('OPENFEMA_RECORDED_COMMAND','Use inspect or assemble.');
  const allowed=['--manifest','--directory','--expected-manifest-sha256',...(command==='assemble'?['--out']:[])];
  for(let i=0;i<rest.length;i+=2){
    const key=rest[i];if(!allowed.includes(key)||Object.hasOwn(o,key)||!rest[i+1]||rest[i+1].startsWith('--'))
      throw fail('OPENFEMA_RECORDED_OPTIONS','Use each declared receiving option once with its value.');
    o[key]=rest[i+1];
  }
  const options={manifestFile:o['--manifest'],directory:o['--directory'],expectedManifestSha256:o['--expected-manifest-sha256'],out:o['--out']};
  const result=command==='assemble'?await materializeRecordedSourceParts(options):await readRecordedSourceParts(options).then(r=>({
    manifestSha256:r.manifestSha256,sha256:r.manifest.bundle.sha256,bytes:r.bytes.length,inspection:r.inspection}));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'OPENFEMA_RECORDED_ERROR',message:error.message})+'\n');process.exitCode=1;});
