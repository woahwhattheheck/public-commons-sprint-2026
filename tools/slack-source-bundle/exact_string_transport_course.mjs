#!/usr/bin/env node
// One focused whole-file/CLI course using an explicitly authored local fixture.
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {createArchiveCodec} from "../../opportunities/upstate_forever_2026/source_tools/archive_codec.mjs";
import {createExactStringTransport,createExactSourceEnvelope} from "./exact_string_transport.mjs";
const codec=createArchiveCodec(),api=createExactSourceEnvelope(codec,createExactStringTransport);
function assert(ok,message){if(!ok)throw Error(message);}
function rejects(fn,message){let rejected=false;try{fn();}catch{rejected=true;}assert(rejected,message);}
const lexical='{\r\n  "precise":9007199254740993, "decimal":12345678901234567890.123456789,\r\n  "escaped":"\\u0061","same":1,"same":2,"unicode":"München 𐍈"\r\n}\r\n';
const shared='function localFixture(value) { return "literal $& " + value; }\n'.repeat(120);
const original='\ufeff'+JSON.stringify({label:"Explicitly authored local acceptance fixture",lexical,first:shared,second:shared,html:'<!doctype html><script>'+shared+'</script>'})+'\r\n';
for(const text of [lexical,original]){
 const restored=api.decode(api.encode(text,"fixture.txt"),codec.sha256(text));
 assert(restored.text===text&&codec.sha256(restored.bytes)===codec.sha256(text),"Full original bytes changed");
}
const envelope=api.encode(original,"fixture.txt");
rejects(()=>api.decode(envelope,"0".repeat(64)),"Wrong original hash was accepted");
const graph=createExactStringTransport(codec,{maxStringChars:16,maxTotalChars:64,maxNodes:16,maxDepth:8});
rejects(()=>graph.unpack({schema:"commons.exact-string-transport/v1",root:0,nodes:[[1,[0]]]}),"Cycle was accepted");
rejects(()=>graph.unpack({schema:"commons.exact-string-transport/v1",root:1,nodes:[[0,"123456789"],[1,[0,0]]]}),"Oversized concatenate was accepted");
const directory=await mkdtemp(join(tmpdir(),"exact-source-course-")),cli=join(dirname(fileURLToPath(import.meta.url)),"exact_string_transport_cli.mjs");
try{
 const input=join(directory,"original.txt"),packed=join(directory,"envelope.json"),output=join(directory,"restored.txt");
 await writeFile(input,codec.utf8Encode(original));
 const invoke=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
 const packedReceipt=invoke("pack",input,packed),inspection=invoke("inspect",packed,"--sha256",codec.sha256(original));
 const received=invoke("unpack",packed,output,"--sha256",codec.sha256(original));
 assert(codec.sha256(await readFile(output))===codec.sha256(original),"CLI changed original bytes");
 rejects(()=>invoke("unpack",packed,output),"Existing output was replaced");
 assert(codec.sha256(await readFile(output))===codec.sha256(original),"Existing output changed after refusal");
 process.stdout.write(JSON.stringify({passed:true,source_bytes:codec.utf8Encode(original).length,source_sha256:codec.sha256(original),transport_bytes:packedReceipt.transport_bytes,inspected:inspection.verified,received:received.verified},null,2)+"\n");
}finally{await rm(directory,{recursive:true,force:true});}
