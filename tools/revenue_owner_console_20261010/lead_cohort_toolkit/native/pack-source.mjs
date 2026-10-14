#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import archive from '../source/source-archive.cjs';
import publication from '../source/source-publication.cjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const DEFAULT_LIMIT=512*1024*1024;
const args=process.argv.slice(2),positional=[];
let limit=DEFAULT_LIMIT,seenLimit=false;
for(let i=0;i<args.length;i++){
 if(args[i]==='--max-archive-expanded-bytes'){
  if(seenLimit||!/^(0|[1-9][0-9]*)$/.test(args[i+1]||''))throw Error('Supply one nonnegative archive byte budget');
  limit=Number(args[++i]);seenLimit=true;
  if(!Number.isSafeInteger(limit))throw Error('Archive byte budget exceeds supported size');
 }else if(args[i].startsWith('--'))throw Error('Unknown archive option: '+args[i]);
 else positional.push(args[i]);
}
if(positional.length!==2)throw Error('Usage: node native/pack-source.mjs SOURCE_OR_CARRIER_JSON NEW_OUTPUT_DIRECTORY [--max-archive-expanded-bytes BYTES]');
const inputPath=path.resolve(positional[0]),output=path.resolve(positional[1]);
const identify=value=>{const body=Buffer.from(value);return {bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};};
const exactText=(body,label)=>{const value=body.toString('utf8');if(!Buffer.from(value,'utf8').equals(body))throw Error(label+' is not exact UTF-8');return value;};
function checkIdentity(body,record,label){
 const actual=identify(body);
 if(!Number.isSafeInteger(record?.bytes)||record.bytes<0||!/^[a-f0-9]{64}$/.test(record?.sha256||'')||
    actual.bytes!==record.bytes||actual.sha256!==record.sha256)throw Error('Original identity differs: '+label);
}
const inputBytes=await fs.readFile(inputPath);
let sourceBytes=inputBytes,sourceText=exactText(sourceBytes,'Original input'),document=JSON.parse(sourceText);
if(!document||typeof document!=='object'||Array.isArray(document))throw Error('Use a complete source object or carrier');
const codec=document.codec??document.encoding;
if(codec==='gzip+base64'){
 if(typeof document.content_base64!=='string')throw Error('Complete carrier needs canonical Base64');
 const compressed=Buffer.from(document.content_base64,'base64');
 if(compressed.toString('base64')!==document.content_base64)throw Error('Complete carrier needs canonical Base64');
 sourceBytes=gunzipSync(compressed,{maxOutputLength:Math.max(1,limit)});
 checkIdentity(sourceBytes,Object.hasOwn(document,'decoded_bytes')?{bytes:document.decoded_bytes,sha256:document.decoded_sha256}:document,'decoded carrier');
 sourceText=exactText(sourceBytes,'Decoded carrier');document=JSON.parse(sourceText);
}else if(Object.hasOwn(document,'codec'))throw Error('Unsupported complete source carrier codec');
if(document?.schema===archive.SCHEMA){
 sourceText=archive.unpackSource(document,{maxExpandedBytes:limit});
 sourceBytes=Buffer.from(sourceText,'utf8');document=JSON.parse(sourceText);
}
if(!document||typeof document!=='object'||Array.isArray(document)||
   !document.files||typeof document.files!=='object')throw Error('Select a complete source bank with original files');
const inputReal=await fs.realpath(inputPath),toolReal=await fs.realpath(root);
const outputReal=path.join(await fs.realpath(path.dirname(output)),path.basename(output));
if(outputReal===toolReal||outputReal.startsWith(toolReal+path.sep))throw Error('Use an output outside the maintained toolkit');
if(inputReal===outputReal||inputReal.startsWith(outputReal+path.sep))throw Error('Keep original input outside the output');
const packed=archive.packSource(sourceText,{maxExpandedBytes:limit});
const archiveBody=JSON.stringify(packed)+'\n',archiveIdentity=identify(archiveBody);
const compressedArchive=gzipSync(Buffer.from(archiveBody,'utf8'),{level:9,mtime:0});
const roundTrip=gunzipSync(compressedArchive,{maxOutputLength:Math.max(1,archiveIdentity.bytes)});
if(!roundTrip.equals(Buffer.from(archiveBody,'utf8')))throw Error('Packed archive compression differs');
const carrierBody=JSON.stringify({schema:'commons.source-archive-carrier.v1',codec:'gzip+base64',
 ...archiveIdentity,content_base64:compressedArchive.toString('base64')},null,2)+'\n';
const toolPaths=['source/source-archive.cjs','source/source-publication.cjs','native/pack-source.mjs','native/materialize-source.py','source/SOURCE_ARCHIVES.md','runtime/host/connected_sha256.cjs'];
const toolBodies={};
for(const relative of toolPaths)toolBodies[relative]=exactText(await fs.readFile(path.join(root,relative)),relative);
const readme='# Open the complete original source\n\n'
 +'This delivery contains two equivalent archive transports. source-archive.json is the readable content-addressed graph; source-archive.gzip.json is its smaller gzip/Base64 carrier. Both reconstruct the exact original bank, all historical source strings and original file bytes.\n\n'
 +'Use the supplied standalone Python helper and a named source destination:\n\n'
 +'    python3 materialize-source.py source-archive.gzip.json /absolute/Recovered-Source\n\n'
 +'The same command accepts source-archive.json. The output complete-source.json is the exact original decoded bank, so its original native preparation/reopen commands remain available. Read its README and source guides for that product. Exact original output ownership and interrupted continuation are preserved.\n\n'
 +'The default archive expansion budget is 512 MiB across all reconstructed nodes and also bounds the inflated carrier. Select an explicit larger budget when needed:\n\n'
 +'    python3 materialize-source.py source-archive.gzip.json /absolute/Recovered-Source --max-archive-expanded-bytes 1073741824\n\n'
 +'Keep the original input, this archive and the sibling .source-open-state directory while recovery is incomplete. Matching retries resume; conflicting original files are preserved. summary.json records complete source, archive and tool identities and actual byte counts.\n\n'
 +'To repack with the maintained Commons toolkit, run native/pack-source.mjs with the complete original source or either archive transport and a new output directory. The publication can resume an exact same-input/tool/output retry. The toolkit source/SOURCE_ARCHIVES.md describes the full format and receiving course.\n';
const files={'source-archive.json':archiveBody,'source-archive.gzip.json':carrierBody,'materialize-source.py':toolBodies['native/materialize-source.py'],'README.md':readme};
const statistics=archive.archiveStatistics(packed);
const summary={schema:'commons.source-archive-delivery.v1',source:identify(sourceBytes),input:identify(inputBytes),
 archive:archiveIdentity,carrier:identify(carrierBody),gzip:identify(compressedArchive),
 uncompressed_reduction_bytes:sourceBytes.length-archiveIdentity.bytes,
 uncompressed_reduction_fraction:sourceBytes.length?1-archiveIdentity.bytes/sourceBytes.length:0,
 nodes:statistics.nodes,text_nodes:statistics.text_nodes,template_nodes:statistics.template_nodes,
 expanded_node_bytes:statistics.expanded_node_bytes,max_archive_expanded_bytes:limit,
 members:Object.entries(files).map(([path,body])=>({path,...identify(body)})),
 tools:toolPaths.map(path=>({path,...identify(toolBodies[path])}))};
files['summary.json']=JSON.stringify(summary,null,2)+'\n';
const publisher=publication.createPublication({fs,path,hash:identify,encode:(value,encoding)=>Buffer.from(value,encoding),randomId:randomUUID,syncDirectories:process.platform!=='win32'});
const operation=await publisher.open({output,completionPath:'summary.json',
 binding:{schema:'commons.source-archive-publication.v1',input_path:inputReal,input:identify(inputBytes),
 source:summary.source,archive:summary.archive,max_archive_expanded_bytes:limit,tools:summary.tools},
 recordedAt:new Date().toISOString()});
const receipt=await operation.publish(Object.entries(files).map(([path,body])=>({path,body})));
console.log(JSON.stringify({output,source:summary.source,archive:summary.archive,carrier:summary.carrier,
 nodes:summary.nodes,expanded_node_bytes:summary.expanded_node_bytes,publication:receipt},null,2));
