// MIT. Reconstruct the exact native recording from the complete retained original files.
// This module has no HTTP client and never retrieves the provider again.
import {isAbsolute,resolve,join} from 'node:path';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../stellar-expert/store.mjs';
import {sha,plain} from './contract.mjs';

export const IOTLAB_COMPONENT_OPERATION='SCF_SENSORTHINGS_IOTLAB_COMPONENTS_1B40_20261012';
export const IOTLAB_COMPONENT_ORIGINALS=Object.freeze({filename:'source-manifest.json',bytes:37256,sha256:'5d5d7b25ba8ec913848ee0b49af58b4842013117a9934b5cb5ef6aff3dbabfba'});
export const IOTLAB_COMPONENT_RECORDING=Object.freeze({filename:'native-recording.json',bytes:1946549,sha256:'e1343f86d88e28648a3cd8648923b5471ae0fd31e3bbcb76a15a61916c2d0a04'});
const SOURCE_RECORD={
  "operationId": "SCF_SENSORTHINGS_IOTLAB_COMPONENTS_1B40_20261012",
  "provider": "notion-public-file",
  "serviceUrl": "https://frost.iotlab.com/sensorthings/v1.1/",
  "multiDatastreamId": {
    "type": "number",
    "value": "23"
  },
  "window": {
    "start": "2016-06-20T00:00:00Z",
    "endExclusive": "2016-06-27T00:00:00Z"
  },
  "representation": "COMPLETE_CONNECTOR_UTF8_TEXT",
  "scope": "Complete seven-page historical week for MultiDatastream 23, all 672 original observation entities and full four-component vectors. Property/unit/datatype arrays remain in original source order.",
  "recordedRoleOrder": [
    "iotlab-service-root",
    "iotlab-multi-native-catalogue",
    "iotlab-multi-stream-opening",
    "iotlab-multi-properties",
    "iotlab-multi-sensor",
    "iotlab-multi-thing",
    "iotlab-multi-locations",
    "iotlab-multi-week-page-000",
    "iotlab-multi-week-page-001",
    "iotlab-multi-week-page-002",
    "iotlab-multi-week-page-003",
    "iotlab-multi-week-page-004",
    "iotlab-multi-week-page-005",
    "iotlab-multi-week-page-006",
    "iotlab-multi-stream-closing"
  ],
  "sourceClocks": "Each response retains the actual complete connector return time, with complete original upload/download evidence. No original HTTP status, method or headers are inferred.",
  "nativeExecution": "PENDING",
  "originalsManifest": {
    "filename": "source-manifest.json",
    "bytes": 37256,
    "sha256": "5d5d7b25ba8ec913848ee0b49af58b4842013117a9934b5cb5ef6aff3dbabfba"
  }
};
const fail=(code,message)=>Object.assign(new Error(message),{code:'IOTLAB_COMPONENT_'+code});
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
function safePath(path){if(typeof path!=='string'||!path||isAbsolute(path)||path.includes('\\')||path.split('/').some(s=>!s||s==='.'||s==='..'))throw fail('PATH','Use the original declared relative source path.');return path;}
function toolBody(response){
 if(response?.isError||!Array.isArray(response?.content))throw fail('RECEIPT','The original source request is not a completed connector response.');
 const blocks=response.content.filter(b=>b.type==='text');if(blocks.length!==1)throw fail('RECEIPT','The complete original tool response is unavailable.');
 return JSON.parse(blocks[0].text);
}
export async function assembleIotlabRecording({manifestBytes,readMember}){
 if(typeof readMember!=='function'||manifestBytes.length!==IOTLAB_COMPONENT_ORIGINALS.bytes||sha(manifestBytes)!==IOTLAB_COMPONENT_ORIGINALS.sha256)
  throw fail('MANIFEST','The full selected original source manifest differs.');
 const manifest=parse(manifestBytes);
 if(manifest.schema!=='stellar-forge.sensorthings-multicomponent-originals.v1'||!Array.isArray(manifest.files)||!Array.isArray(manifest.sources))
  throw fail('MANIFEST','Use the original complete source package.');
 const members=new Map();
 for(const f of manifest.files){
  safePath(f.path);if(members.has(f.path))throw fail('MANIFEST','A source file is declared twice.');
  const bytes=await readMember(f.path);
  if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw fail('SOURCE_CHANGED','The original member differs: '+f.path);
  members.set(f.path,bytes);
 }
 const sources=new Map(manifest.sources.map(s=>[s.role,s]));
 if(sources.size!==manifest.sources.length)throw fail('MANIFEST','An original source role is repeated.');
 const responses=[];
 for(const role of SOURCE_RECORD.recordedRoleOrder){
  const original=sources.get(role);if(!original)throw fail('SOURCE_MISSING','The original response is unavailable: '+role);
  const bytes=members.get(original.body.path),receiptBytes=members.get(original.receipt.path);
  if(!bytes||!receiptBytes||bytes.length!==original.body.bytes||sha(bytes)!==original.body.sha256||
     receiptBytes.length!==original.receipt.bytes||sha(receiptBytes)!==original.receipt.sha256)
   throw fail('SOURCE_CHANGED','The indexed original body and receipt differ.');
  const receipt=parse(receiptBytes),uploaded=toolBody(receipt.uploadToolResponse),downloaded=toolBody(receipt.downloadToolResponse),
    originalText=new TextDecoder('utf-8',{fatal:true}).decode(bytes),receivedAt=receipt.downloadCompletedAt;
  if(receipt.schema!=='stellar-forge.sensorthings-connector-acquisition.v1'||receipt.role!==role||receipt.sourceUrl!==original.sourceUrl||
    !plain(receipt.originalHttp)||Object.values(receipt.originalHttp).some(v=>v!==null)||
    uploaded.status!=='uploaded'||uploaded.file_upload_id!==downloaded.file_upload_id||
    uploaded.content_length!==bytes.length||downloaded.content_length!==bytes.length||downloaded.content!==originalText||
    typeof receivedAt!=='string'||!receivedAt||receipt.originalBody.sha256!==original.body.sha256)
   throw fail('RECEIPT','The original connector evidence does not bind the complete received body.');
  responses.push({requestId:role,url:original.sourceUrl,bodyBase64:Buffer.from(bytes).toString('base64'),sha256:original.body.sha256,
   bytes:bytes.length,capturedAt:receivedAt,status:null,headers:{},
   connectorReceipt:{schema:'stellar-forge.sensorthings-connector-source-receipt.v1',operationId:IOTLAB_COMPONENT_OPERATION,role,
    sourceUrl:original.sourceUrl,receivedAt,
    timestampBasis:'Clock after the complete connector download returned; source response timestamp and source HTTP metadata were not exposed.',
    body:{filename:receipt.requestedFilename,bytes:bytes.length,sha256:original.body.sha256},representation:'COMPLETE_CONNECTOR_UTF8_TEXT',
    sourceHttpStatus:null,sourceHttpHeaders:null,method:'Notion create_attachment(source_url), then download_attachment(file_upload_id)',
    request:{source_url:original.sourceUrl,filename:receipt.requestedFilename,content_type:'application/json'},
    connector:{attachment:receipt.uploadToolResponse,download:receipt.downloadToolResponse}}});
 }
 const bytes=Buffer.from(JSON.stringify({schema:'stellar-forge.sensorthings-connector-responses.v1',source:SOURCE_RECORD,responses},null,2)+'\n','utf8');
 if(bytes.length!==IOTLAB_COMPONENT_RECORDING.bytes||sha(bytes)!==IOTLAB_COMPONENT_RECORDING.sha256)
  throw fail('RECORDING_IDENTITY','The assembled recording differs from the selected complete original recording.');
 return {bytes,identity:IOTLAB_COMPONENT_RECORDING,operationId:IOTLAB_COMPONENT_OPERATION,originals:IOTLAB_COMPONENT_ORIGINALS,responses:responses.length};
}
export async function buildIotlabRecording({directory,destination=null}={}){
 if(!isAbsolute(directory??'')||(destination!==null&&!isAbsolute(destination)))throw fail('PATH','Use absolute original-source and output paths.');
 const value=await assembleIotlabRecording({manifestBytes:await readOwned(join(directory,IOTLAB_COMPONENT_ORIGINALS.filename),1024*1024),
  readMember:path=>readOwned(join(directory,safePath(path)),1024*1024)});
 if(destination===null)return value;
 let file;
 try{file=await open(destination,'wx',0o600);}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const existing=await readOwned(destination,8*1024*1024);
  if(existing.length!==value.identity.bytes||sha(existing)!==value.identity.sha256)throw fail('EXISTING_OUTPUT','The existing output is a different file or an interrupted prefix; preserve it for review.');
  return {path:destination,...value.identity,operationId:value.operationId,reused:true};
 }
 try{await file.writeFile(value.bytes);await file.sync();await file.chmod(0o400);}
 finally{await file.close();}
 return {path:destination,...value.identity,operationId:value.operationId,reused:false};
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('node record-multicomponent.mjs --originals ABS --output ABS\nReconstruct the one exact 15-response IoTLab native recording from the complete acquired originals. No network.');return;}
 const p={};for(let i=0;i<args.length;i++){const key=args[i];if(!['--originals','--output'].includes(key)||p[key]||!args[i+1]||args[i+1].startsWith('--'))throw fail('CLI','Use --originals and --output once.');p[key]=args[++i];}
 if(!p['--originals']||!p['--output'])throw fail('CLI','Both original source directory and new output file are required.');
 console.log(JSON.stringify(await buildIotlabRecording({directory:p['--originals'],destination:p['--output']}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({error:e.code??'IOTLAB_COMPONENT_RECORDING',message:e.message}));process.exitCode=1;});
