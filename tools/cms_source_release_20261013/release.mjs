#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildRelease,stable,csv,parseCsv,REVIEW_COLUMNS,applyReview} from "./release_core.mjs";
import {CSV_RELEASE_VERSION,buildCsvRelease,makeTransfer,receiveTransfer,compareEditions,newChangeReview,applyChangeReview,comparisonCSV,CHANGE_REVIEW_COLUMNS} from "./release_csv.mjs";
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
const read=p=>new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(p));
const json=p=>JSON.parse(read(p));
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v,{encoding:"utf8",flag:"wx"});};
const own=path.dirname(fileURLToPath(import.meta.url));
function safeMember(root,member){
  if(typeof member!=="string"||member.startsWith("/")||member.includes("\\")||member.split("/").some(x=>!x||x==="."||x===".."))throw Error("Unsafe release member");
  const file=path.resolve(root,member),real=fs.realpathSync(file);
  if(!real.startsWith(fs.realpathSync(root)+path.sep)||!fs.statSync(real).isFile())throw Error("Source leaves release directory");
  return real;
}
function originals(root,manifest){
  const descriptors=manifest.schema===CSV_RELEASE_VERSION?[manifest.original_csv]:manifest.original_pages;
  if(!Array.isArray(descriptors)||!descriptors.length)throw Error("Original source inventory is absent");
  return descriptors.map(p=>{
    const text=read(safeMember(root,p.path));
    if(Buffer.byteLength(text,"utf8")!==p.bytes||hash(text)!==p.sha256)throw Error("Original source changed: "+p.path);
    return{...p,text};
  });
}
function open(root){
  const manifest=json(path.join(root,"manifest.json")),sources=originals(root,manifest);
  const packet={schema:"source-release-transfer/1",manifest,records:json(path.join(root,"records.json")),
    fields:json(path.join(root,"fields.json")),summary:json(path.join(root,"summary.json")),originals:sources};
  const rebuilt=receiveTransfer(packet,hash);
  if(hash(read(path.join(root,"data.csv")))!==manifest.data_csv_sha256)throw Error("CSV differs from source");
  return rebuilt;
}
function freshDirectory(destination,writer){
  if(fs.existsSync(destination))throw Error("Choose a new output directory; previous editions are preserved");
  const parent=path.dirname(path.resolve(destination));fs.mkdirSync(parent,{recursive:true});
  const staging=fs.mkdtempSync(path.join(parent,".source-release-"));
  try{writer(staging);fs.renameSync(staging,destination);}catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}
function emitRelease(destination,release,sourceFiles){
  freshDirectory(destination,staging=>{
    for(const p of sourceFiles)write(path.join(staging,p.path),p.text);
    const outputs={"manifest.json":release.manifest,"records.json":release.records,"fields.json":release.fields,"summary.json":release.summary,
      "review.json":{schema:"source-review/1",release_id:release.manifest.release_id,decisions:release.review}};
    for(const [name,value]of Object.entries(outputs))write(path.join(staging,name),JSON.stringify(value,null,2)+"\n");
    write(path.join(staging,"data.csv"),csv(release.records.map(r=>r.original),release.manifest.fields));
    write(path.join(staging,"review.csv"),csv(release.review,REVIEW_COLUMNS));
    open(staging);
  });
}
function transfer(root){const release=open(root);return makeTransfer(release,originals(root,release.manifest));}
function comparisonPacket(before,after){
  const a=receiveTransfer(before,hash),b=receiveTransfer(after,hash),comparison=compareEditions(a,b,hash);
  return{schema:"source-comparison-bundle/1",before,after,comparison,review:applyChangeReview(comparison,newChangeReview(comparison))};
}
function renderComparison(packet){
  const template=read(path.join(own,"comparison-template.html")),token="__CMS_COMPARISON_SOURCE__";
  if(template.split(token).length!==2)throw Error("Comparison template marker differs");
  return template.replace(token,JSON.stringify(packet).replaceAll("<","\\u003c"));
}
function comparisonFiles(packet,destination){
  freshDirectory(destination,staging=>{
    const outputs={"comparison.json":packet.comparison,"comparison-complete.json":packet,"before.release.json":packet.before,
      "after.release.json":packet.after,"change-review.json":packet.review};
    for(const [name,value]of Object.entries(outputs))write(path.join(staging,name),JSON.stringify(value,null,2)+"\n");
    write(path.join(staging,"changes.csv"),comparisonCSV(packet.comparison));
    write(path.join(staging,"change-review.csv"),csv(packet.review.decisions,CHANGE_REVIEW_COLUMNS));
    write(path.join(staging,"comparison-review.html"),renderComparison(packet));
    const reopened=json(path.join(staging,"comparison-complete.json"));
    const checked=comparisonPacket(reopened.before,reopened.after);
    if(stable(checked)!==stable(packet))throw Error("Complete comparison did not reopen exactly");
    write(path.join(staging,"README.txt"),"Open comparison-review.html in a browser. All original source editions are embedded. Export change-review.json or .csv after review. comparison-complete.json retains both complete original sources and exact comparison. Earlier source releases remain unchanged.\n");
  });
}
const [command,...args]=process.argv.slice(2);
try{
  if(command==="verify"&&args.length===1){const r=open(args[0]);console.log(JSON.stringify({release_id:r.manifest.release_id,records:r.records.length,fields:r.manifest.fields.length,original_sources:originals(args[0],r.manifest).length,origin:r.manifest.origin||"official-original-api",source_released:r.manifest.source_released,source_modified:r.manifest.source_modified??null,captured_on:r.manifest.captured_on,archive_date:r.manifest.archive_date??null,archive_date_meaning:r.manifest.archive_date_meaning??null,date_provenance:r.manifest.date_provenance||{}},null,2));}
  else if(command==="rebuild"&&args.length===2){const source=open(args[0]);emitRelease(args[1],source,originals(args[0],source.manifest));console.log("Rebuilt and reopened "+args[1]);}
  else if(command==="ingest"&&args.length===3){
    const[sourceDir,requestFile,destination]=args,request=json(requestFile);
    if(!Array.isArray(request.pages))throw Error("Request must list exact original API pages");
    const pages=request.pages.map(p=>{const text=read(safeMember(sourceDir,p.path));return{...p,text,bytes:Buffer.byteLength(text,"utf8")};});
    const release=buildRelease(pages,request.metadata,hash);emitRelease(destination,release,pages);console.log(release.manifest.release_id);
  }else if(command==="ingest-csv"&&args.length===3){
    const[file,requestFile,destination]=args,request=json(requestFile),text=read(file);
    const source={path:request.original_member||"original/hospital-general-information.csv",text,bytes:Buffer.byteLength(text,"utf8")};
    const release=buildCsvRelease(source,request,hash);emitRelease(destination,release,[source]);console.log(JSON.stringify({release_id:release.manifest.release_id,source_rows:release.manifest.source_row_count,selected_rows:release.records.length,unmapped_columns:release.summary.retained_unmapped_columns}));
  }else if(command==="bundle"&&args.length===2){const packet=transfer(args[0]);write(args[1],JSON.stringify(packet,null,2)+"\n");receiveTransfer(json(args[1]),hash);console.log("Complete release transfer reopened "+args[1]);}
  else if(command==="receive"&&args.length===2){const packet=json(args[0]),release=receiveTransfer(packet,hash);emitRelease(args[1],release,packet.originals);console.log("Received complete original release "+release.manifest.release_id);}
  else if(command==="review"&&args.length===3){
    const[root,input,output]=args,release=open(root);
    const payload=input.toLowerCase().endsWith(".csv")?(()=>{const parsed=parseCsv(read(input));if(stable(parsed.fields)!==stable(REVIEW_COLUMNS))throw Error("Reviewer CSV columns changed");return{schema:"source-review/1",release_id:release.manifest.release_id,decisions:parsed.rows};})():json(input);
    const reviewed=applyReview(release,payload);write(output,JSON.stringify(reviewed,null,2)+"\n");console.log(JSON.stringify(reviewed.summary));
  }else if(command==="compare"&&args.length===3){const result=compareEditions(open(args[0]),open(args[1]),hash);write(args[2],JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result.summary));}
  else if(command==="comparison"&&args.length===3){const packet=comparisonPacket(transfer(args[0]),transfer(args[1]));comparisonFiles(packet,args[2]);console.log(JSON.stringify(packet.comparison.summary));}
  else if(command==="review-changes"&&args.length===3){
    const[bundle,input,output]=args,packet=json(bundle);if(packet.schema!=="source-comparison-bundle/1")throw Error("Use the complete comparison bundle");
    const checked=comparisonPacket(packet.before,packet.after);if(stable(checked.comparison)!==stable(packet.comparison))throw Error("Comparison differs from original sources");
    const payload=input.toLowerCase().endsWith(".csv")?(()=>{const parsed=parseCsv(read(input));if(stable(parsed.fields)!==stable(CHANGE_REVIEW_COLUMNS))throw Error("Change review CSV columns differ");return{schema:"source-change-review/1",comparison_id:packet.comparison.comparison_id,decisions:parsed.rows};})():json(input);
    const reviewed=applyChangeReview(packet.comparison,payload);write(output,JSON.stringify({...checked,review:reviewed},null,2)+"\n");console.log(JSON.stringify(reviewed.summary));
  }else if(command==="render-comparison"&&args.length===2){
    const packet=json(args[0]),checked=comparisonPacket(packet.before,packet.after);if(stable(packet.comparison)!==stable(checked.comparison))throw Error("Comparison source changed");
    checked.review=applyChangeReview(checked.comparison,packet.review||checked.review);write(args[1],renderComparison(checked));console.log("Complete reviewed source comparison rendered");
  }else throw Error("Usage: verify RELEASE | rebuild RELEASE NEW_DIR | ingest SOURCE_DIR REQUEST NEW_DIR | ingest-csv ORIGINAL_CSV REQUEST NEW_DIR | bundle RELEASE NEW_JSON | receive TRANSFER NEW_DIR | review RELEASE REVIEW NEW_JSON | compare BEFORE AFTER NEW_JSON | comparison BEFORE AFTER NEW_DIR | review-changes COMPLETE_BUNDLE REVIEW NEW_BUNDLE | render-comparison COMPLETE_BUNDLE NEW_HTML");
}catch(error){console.error(error.message);process.exitCode=1;}
