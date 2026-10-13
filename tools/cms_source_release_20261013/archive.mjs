#!/usr/bin/env node
/** Native publisher archive intake and independent complete-source receiving. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {inflateRawSync} from "node:zlib";
import {execFileSync} from "node:child_process";
import * as core from "./release_core.mjs";
import * as csv from "./release_csv.mjs";
import {verifyPublisherArchive,buildArchiveIntake,receiveArchiveIntake} from "./archive_core.mjs";
const own=path.dirname(fileURLToPath(import.meta.url)),api={...core,...csv};
const hash=value=>createHash("sha256").update(value).digest("hex");
const services={api,hash,hashBytes:hash,inflateRaw:async(bytes,size)=>new Uint8Array(inflateRawSync(bytes,{maxOutputLength:Math.max(1,size)}))};
const text=file=>new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(file));
const read=file=>JSON.parse(text(file));
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value,{flag:"wx"});}
function writeJSON(file,value){write(file,JSON.stringify(value,null,2)+"\n");}
function child(...args){return execFileSync(process.execPath,[path.join(own,"release.mjs"),...args],{encoding:"utf8",maxBuffer:16*1024*1024});}
async function deliver(result,destination){
  destination=path.resolve(destination);if(fs.existsSync(destination))throw Error("Choose a new destination; original receiving editions are preserved");
  fs.mkdirSync(path.dirname(destination),{recursive:true});const staging=fs.mkdtempSync(path.join(path.dirname(destination),".publisher-archive-"));
  try{
    const packet=result.packet;
    write(path.join(staging,"original-archive",packet.archive.filename),result.archive.bytes);
    writeJSON(path.join(staging,"archive-inventory.json"),packet.inventory);
    writeJSON(path.join(staging,"mapping-request.json"),packet.request);
    writeJSON(path.join(staging,"archive-intake.json"),packet);
    writeJSON(path.join(staging,"selected.release.json"),packet.release);
    child("receive",path.join(staging,"selected.release.json"),path.join(staging,"selected-release"));
    child("verify",path.join(staging,"selected-release"));
    const received=await receiveArchiveIntake(read(path.join(staging,"archive-intake.json")),services);
    if(received.packet.archive_intake_id!==packet.archive_intake_id||hash(fs.readFileSync(path.join(staging,"original-archive",packet.archive.filename)))!==packet.archive.sha256)throw Error("Saved archive receiving differs from its originals");
    write(path.join(staging,"README.txt"),"PUBLISHER ARCHIVE INTAKE\n\nOriginal archive: original-archive/"+packet.archive.filename+"\nArchive SHA-256: "+packet.archive.sha256+"\nSelected original member: "+packet.selected_member+"\nArchive intake: "+packet.archive_intake_id+"\nRelease: "+result.release.manifest.release_id+"\n\narchive-intake.json contains the entire original ZIP, verified inventory, original CSV, mapping and source release. Open the maintained review-desk.html and use Receive a complete archive intake to reconstruct it independently. selected-release/ is accepted unchanged by release.mjs verify, bundle, review and comparison. selected.release.json is the complete CSV-source transfer for ordinary source comparisons; archive-intake.json also carries every original ZIP member.\n\nNative independent receiving:\n  node archive.mjs reopen /absolute/archive-intake.json /new/receiver\nComparison against another actual source edition:\n  node release.mjs comparison /absolute/selected-release /absolute/other-release /new/comparison\n\nSource dates and mappings are the retained request values. ZIP DOS timestamps remain original archive metadata and are not treated as publication dates. All source values remain strings.\n");
    fs.renameSync(staging,destination);return {destination,archive_intake_id:packet.archive_intake_id,archive_bytes:packet.archive.bytes,members:packet.inventory.length,release_id:result.release.manifest.release_id,source_rows:result.release.manifest.source_row_count,selected_rows:result.release.records.length};
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}
const [command,...args]=process.argv.slice(2);
try{
  if(command==="inventory"&&args.length===2){
    const [file,output]=args,archive=await verifyPublisherArchive(new Uint8Array(fs.readFileSync(file)),path.basename(file),services);
    writeJSON(output,{schema:"publisher-archive-inventory/1",filename:archive.filename,bytes:archive.bytes.length,sha256:archive.sha256,members:archive.inventory});
    console.log(JSON.stringify({output,members:archive.inventory.length,bytes:archive.bytes.length,sha256:archive.sha256}));
  }else if(command==="receive"&&args.length===3){
    const [file,requestFile,destination]=args,request=read(requestFile);
    const archive=await verifyPublisherArchive(new Uint8Array(fs.readFileSync(file)),path.basename(file),services);
    const result=await buildArchiveIntake(archive,request.metadata?.archive_member,request,services);
    console.log(JSON.stringify(await deliver(result,destination),null,2));
  }else if(command==="reopen"&&args.length===2){
    const result=await receiveArchiveIntake(read(args[0]),services);
    console.log(JSON.stringify(await deliver(result,args[1]),null,2));
  }else throw Error("Usage: node archive.mjs inventory ORIGINAL_ZIP NEW_JSON | receive ORIGINAL_ZIP MAPPING_REQUEST NEW_DIR | reopen ARCHIVE_INTAKE NEW_DIR");
}catch(error){console.error(error.message);process.exitCode=1;}
