#!/usr/bin/env node
import {open,link,unlink} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve,dirname,basename,join} from "node:path";
import {randomUUID} from "node:crypto";
import {createArchiveCodec} from "../../opportunities/upstate_forever_2026/source_tools/archive_codec.mjs";
import {createExactStringTransport,createExactSourceEnvelope} from "./exact_string_transport.mjs";

const usage="Usage: node exact_string_transport_cli.mjs pack INPUT NEW_OUTPUT [--max-bytes N] [--max-transport-bytes N]\n       node exact_string_transport_cli.mjs unpack ENVELOPE NEW_OUTPUT [--sha256 EXPECTED] [--max-bytes N] [--max-transport-bytes N]\n       node exact_string_transport_cli.mjs inspect ENVELOPE [--sha256 EXPECTED] [--max-bytes N] [--max-transport-bytes N]";
const args=process.argv.slice(2),command=args.shift(),pos=[],options={};
for(let i=0;i<args.length;i++){
 const value=args[i];if(!value.startsWith("--")){pos.push(value);continue;}
 if(!["--sha256","--max-bytes","--max-transport-bytes"].includes(value)||options[value]!==undefined||args[i+1]===undefined)throw Error(usage);
 options[value]=args[++i];
}
if(!["pack","unpack","inspect"].includes(command)||pos.length!==(command==="inspect"?1:2)||command==="pack"&&options["--sha256"])throw Error(usage);
const number=(key,fallback)=>{const raw=options[key];if(raw===undefined)return fallback;if(!/^[1-9][0-9]*$/.test(raw))throw Error("Invalid "+key);const n=Number(raw);if(!Number.isSafeInteger(n)||n>0x7fffffff)throw Error("Invalid "+key);return n;};
const maxSourceBytes=number("--max-bytes",33554432),maxTransportBytes=number("--max-transport-bytes",33554432),codec=createArchiveCodec(),api=createExactSourceEnvelope(codec,createExactStringTransport,{maxSourceBytes,maxTransportBytes});
async function readComplete(path,limit){
 const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const info=await handle.stat();if(!info.isFile()||info.size>limit)throw Error("Input must be a complete regular file within the configured byte limit");
  const chunks=[];let size=0;
  for(;;){
   const chunk=new Uint8Array(Math.min(65536,limit-size+1));
   const {bytesRead}=await handle.read(chunk,0,chunk.length,null);
   if(bytesRead===0)break;
   size+=bytesRead;if(size>limit)throw Error("Input grew beyond the configured byte limit");
   chunks.push(chunk.subarray(0,bytesRead));
  }
  const after=await handle.stat();
  if(size!==info.size||size!==after.size||info.mtimeMs!==after.mtimeMs)throw Error("Input changed while being read; receive a stable complete file");
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const text=codec.utf8Decode(bytes);if(codec.sha256(codec.utf8Encode(text))!==codec.sha256(bytes))throw Error("UTF-8 roundtrip changed input bytes");
  return {text,bytes};
 }finally{await handle.close();}
}
async function publishNew(path,bytes){
 const destination=resolve(path),temporary=join(dirname(destination),".exact-source-"+randomUUID()+".partial");
 let handle,created=false,published=false;
 try{
  handle=await open(temporary,"wx",0o600);created=true;await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  await link(temporary,destination);published=true;
  await unlink(temporary);created=false;
  const directory=await open(dirname(destination),"r");try{await directory.sync();}finally{await directory.close();}
  return destination;
 }catch(error){if(published)throw Error("Complete output exists at "+destination+"; publication cleanup or directory synchronization needs inspection: "+error.message);throw error;}
 finally{if(handle)await handle.close();if(created)await unlink(temporary).catch(()=>{});}
}
const input=resolve(pos[0]);let result;
if(command==="pack"){
 const original=await readComplete(input,maxSourceBytes),envelope=api.encode(original.text,basename(input)),restored=api.decode(envelope,codec.sha256(original.bytes));
 if(codec.sha256(restored.bytes)!==codec.sha256(original.bytes))throw Error("Complete source roundtrip changed bytes");
 const body=codec.utf8Encode(JSON.stringify(envelope)+"\n"),output=await publishNew(pos[1],body);
 result={command,input,output,source:envelope.source,envelope:{bytes:body.length,sha256:codec.sha256(body)},transport_bytes:envelope.transport.bytes,verified:true};
}else{
 const limit=Math.min(0x7fffffff,Math.ceil(maxTransportBytes*4/3)+65536),original=await readComplete(input,limit),envelope=JSON.parse(original.text),restored=api.decode(envelope,options["--sha256"]);
 result={command,input,source:restored.source,nodes:restored.nodes,compressed_bytes:restored.compressed_bytes,verified:true};
 if(command==="unpack")result.output=await publishNew(pos[1],restored.bytes);
}
process.stdout.write(JSON.stringify(result,null,2)+"\n");
