#!/usr/bin/env node
/** Local source preparation for the original Property/Installation workflow. */
import {openSync,closeSync,readFileSync,writeFileSync,fstatSync,lstatSync,mkdirSync,
  realpathSync,fsyncSync,linkSync,unlinkSync,constants} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readProfile} from "./profiles.mjs";
import {renderWorkorder} from "./prepare-core.mjs";
import {PROFILE,PROPERTY_SCHEMA,ORIGINAL_COHORT,clone,canonical,propertyWorkshare,propertyTemplate,originalScope,
  inspectPropertySelection,preparePropertyInstallation,propertyReviewTemplate,preparePropertyReturn} from "./property-commissioning-core.mjs";
import {renderPropertyReport,renderPropertyEditor} from "./property-commissioning-view.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const MAX=8*1024*1024;
const usage=[
  "node property-commissioning.mjs workshare --cohort cohort.json --out PRIVATE [--python python3]",
  "node property-commissioning.mjs template --seed ORIGINAL_SEED.json --cohort cohort.json --out PRIVATE",
  "node property-commissioning.mjs revise --seed CURRENT_SEED.json --cohort cohort.json --selection ORIGINAL_SELECTION.json --reason TEXT --out NEW_PRIVATE",
  "node property-commissioning.mjs inspect --selection PROPERTY_SELECTION.json --source-root ORIGINAL_FILES [--previous PREVIOUS_SELECTION.json]",
  "node property-commissioning.mjs prepare --seed ORIGINAL_SEED.json --cohort cohort.json --selection PROPERTY_SELECTION.json --source-root ORIGINAL_FILES [--case-state CURRENT_CASE.json] [--previous PREVIOUS_SELECTION.json] --out PRIVATE",
  "node property-commissioning.mjs review-template --return-seed ORIGINAL_RETURN_SEED.json --installation SAVED_INSTALLATION.json --selection PROPERTY_SELECTION.json --out PRIVATE",
  "node property-commissioning.mjs review --return-seed ORIGINAL_RETURN_SEED.json --installation SAVED_INSTALLATION.json --selection PROPERTY_SELECTION.json --review PROPERTY_REVIEW.json --source-root ORIGINAL_FILES --case-state CURRENT_CASE.json [--previous PREVIOUS_SELECTION.json] --out PRIVATE",
  "node property-commissioning.mjs editor --out PRIVATE"
].join("\n");
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+"\n","utf8");
function parse(argv) {
  const [command,...rest]=argv;
  const required={
    workshare:["cohort","out"],template:["seed","cohort","out"],revise:["seed","cohort","selection","reason","out"],
    inspect:["selection","source-root"],prepare:["seed","cohort","selection","source-root","out"],
    "review-template":["return-seed","installation","selection","out"],
    review:["return-seed","installation","selection","review","source-root","case-state","out"],editor:["out"]};
  if(!Object.hasOwn(required,command))throw new Error(usage);
  const allowed=[...required[command],...(["inspect","prepare","review"].includes(command)?["previous"]:[]),...(command==="prepare"?["case-state"]:[]),...(command==="workshare"?["python"]:[])],args={command};
  for(let i=0;i<rest.length;i+=2) {
    need(rest[i].startsWith("--")&&allowed.includes(rest[i].slice(2))&&rest[i+1]!==undefined&&!Object.hasOwn(args,rest[i].slice(2)),usage);
    args[rest[i].slice(2)]=rest[i+1];
  }
  need(required[command].every(key=>args[key]),usage);return args;
}
function file(path,maximum=MAX) {
  path=resolve(path);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=fstatSync(fd),named=lstatSync(path);
    need(before.isFile()&&!named.isSymbolicLink()&&before.dev===named.dev&&before.ino===named.ino&&before.size<=maximum,
      "Select a complete regular file within its bound: "+path);
    const raw=readFileSync(fd),after=fstatSync(fd),last=lstatSync(path);
    need(raw.length===before.size&&["dev","ino","size","mtimeMs","ctimeMs"].every(key=>before[key]===after[key])&&
      !last.isSymbolicLink()&&last.dev===before.dev&&last.ino===before.ino,
      "The selected original file changed while being read: "+path);
    return {path,raw,bytes:raw.length,sha256:sha(raw)};
  } finally {closeSync(fd);}
}
function parsed(source) {
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(source.raw),(key,item)=>{
    need(typeof item!=="number"||Number.isFinite(item)&&(!Number.isInteger(item)||Number.isSafeInteger(item)),
      "Keep unsafe integer identifiers as original text; this source cannot be interpreted without loss.");
    return item;
  });
  return {...source,value};
}
const read=path=>parsed(file(path));
function privateDirectory(path) {
  path=resolve(path);mkdirSync(path,{recursive:true,mode:0o700});
  const info=lstatSync(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&info.uid===process.getuid()&&realpathSync(path)===path,
    "Use an owned private 0700 directory with no symbolic-link ancestors.");return path;
}
function publish(path,raw) {
  try {
    need(file(path,32*1024*1024).raw.equals(raw),"A retained original output differs: "+path);
  } catch(error) {
    if(error.code!=="ENOENT")throw error;
    const temp=path+"."+randomUUID()+".tmp",fd=openSync(temp,"wx",0o600);
    try {
      writeFileSync(fd,raw);fsyncSync(fd);
      try{linkSync(temp,path);}catch(other){if(other.code!=="EEXIST")throw other;need(file(path,32*1024*1024).raw.equals(raw),"A concurrent output differs.");}
      const dir=openSync(dirname(path),"r");try{fsyncSync(dir);}finally{closeSync(dir);}
    } finally {closeSync(fd);unlinkSync(temp);}
  }
  return {filename:path.slice(path.lastIndexOf("/")+1),path,bytes:raw.length,sha256:sha(raw)};
}
const reserved=new Set(["cohort.json","NATIVE_SEED.json","NATIVE_RETURN_SEED.json","SAVED_INSTALLATION.json",
  "PROPERTY_SELECTION.json","PREVIOUS_SELECTION.json","PROPERTY_REVIEW.json","PROPERTY_PREPARATION.json","CASE_STATE.json",
  "installation-input.json","installation-preview-input.json","installation-return-input.json","bindings.json",
  "WORKORDER.md","PROPERTY_REPORT.html","PREPARATION_REQUEST.json","Property_Commissioning_Editor.html","PROPERTY_WORKSHARE.json"]);
function originals(rows,root) {
  root=resolve(root);need(realpathSync(root)===root&&lstatSync(root).isDirectory(),"Use the selected original source directory.");
  const files=Object.create(null),full=[];let total=0;
  for(const row of rows) {
    need(typeof row.filename==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(row.filename)&&!reserved.has(row.filename),
      "Use distinct original source filenames; a prepared output name is reserved.");
    const source=file(join(root,row.filename));total+=source.bytes;need(total<=24*1024*1024,"The whole selected source exceeds 24 MiB.");
    need(source.bytes===row.bytes&&source.sha256===row.sha256,"The selected original bytes differ: "+row.filename);
    let value;
    if(row.mediaType==="application/json"||row.mediaType.endsWith("+json"))value=parsed(source).value;
    need(!Object.hasOwn(files,row.id),"Select each original source ID once.");
    files[row.id]={filename:row.filename,bytes:source.bytes,sha256:source.sha256,value};full.push({name:row.filename,...source});
  }
  return {files,full};
}
function validateNativeWorkshare(value,python="python3") {
  const path=resolve(here,"../../sf47_budget_model/workspace/workshare_intake.py"),source=file(path);
  const program=[
    "import hashlib,importlib.util,json,sys",
    "from pathlib import Path",
    "path=Path(sys.argv[1]); raw=path.read_bytes()",
    "if hashlib.sha256(raw).hexdigest()!=sys.argv[2]: raise ValueError('The original Workshare normalizer changed.')",
    "spec=importlib.util.spec_from_file_location('property_original_workshare_intake',path)",
    "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)",
    "value=json.load(sys.stdin); rows=module.load_workshares(value,None)",
    "if hashlib.sha256(path.read_bytes()).hexdigest()!=sys.argv[2]: raise ValueError('The original Workshare normalizer changed during preparation.')",
    "print(json.dumps({'cases':[{'caseId':r['caseId'],'planSha256':r['planSha256'],'hours':r['hours'],'phaseCount':r['phaseCount'],'packetPresent':r['packetPresent']} for r in rows]}))"
  ].join("\n");
  const result=spawnSync(python,["-B","-c",program,path,source.sha256],{input:encode(value),encoding:"utf8",maxBuffer:4*1024*1024,
    env:process.env,cwd:dirname(path)});
  if(result.error)throw result.error;
  need(result.status===0,"Original Workshare normalization failed: "+(result.stderr||result.stdout||result.signal||"unknown result").slice(0,12000));
  const validation=JSON.parse(result.stdout);
  need(validation.cases?.length===1&&validation.cases[0].caseId===ORIGINAL_COHORT.caseId&&
    validation.cases[0].planSha256===value.cases[0].plan_sha256&&validation.cases[0].hours==="84"&&
    validation.cases[0].phaseCount===6&&!validation.cases[0].packetPresent,
    "The original normalizer did not retain the exact six-phase customer source.");
  return {source:{path,bytes:source.bytes,sha256:source.sha256},validation};
}
function rawMeta(source){return {path:source.path,bytes:source.bytes,sha256:source.sha256};}
function optionalPrevious(args){return args.previous?read(args.previous):null;}
try {
  const args=parse(process.argv.slice(2));
  if(args.command==="editor") {
    const profile=readProfile(PROFILE);
    const prepare=file(join(here,"prepare-core.mjs")),core=file(join(here,"property-commissioning-core.mjs"));
    const view=file(join(here,"property-commissioning-view.mjs"));
    const coordinator=file(join(here,"property-coordinator.mjs")),coordinatorUi=file(join(here,"property-coordinator-ui.mjs"));
    const out=privateDirectory(args.out);
    const html=renderPropertyEditor({profile:profile.value,prepareSource:prepare.raw.toString("utf8"),
      coreSource:core.raw.toString("utf8"),viewSource:view.raw.toString("utf8"),
      coordinatorSource:coordinator.raw.toString("utf8"),coordinatorUiSource:coordinatorUi.raw.toString("utf8")});
    console.log(JSON.stringify(publish(join(out,"Property_Commissioning_Editor.html"),Buffer.from(html)),null,2));
  } else {
    const sources={},remember=(key,path)=>sources[key]=read(path);
    for(const key of ["seed","cohort","selection","return-seed","installation","review","case-state"])if(args[key])remember(key,args[key]);
    const previous=optionalPrevious(args);if(previous)sources.previous=previous;
    let full=[],result,outputs=[],normalizer=null;
    if(args.command==="workshare") {
      const profile=readProfile(PROFILE),authored=propertyWorkshare(sources.cohort,profile.value);
      const planSha=sha(Buffer.from(canonical(authored.plan),"utf8"));
      const value={version:"dealscout.workshare-commissioning-inputs.v1",cases:[{
        case_id:ORIGINAL_COHORT.caseId,workshare_input:{source:authored.source,plan:authored.plan},
        plan_sha256:planSha,production_effort:authored.production_effort}]};
      normalizer=validateNativeWorkshare(value,args.python||"python3");
      result={schema:"stellar-forge.property-workshare-source-preparation.v1",commissioning:value,normalizer,
        original:{bytes:sources.cohort.bytes,sha256:sources.cohort.sha256},
        proposedPhaseHours:"84",includedUnallocatedContingencyHours:"16",totalEstimatedHours:"100"};
      outputs.push(["PROPERTY_WORKSHARE.json",encode(value)]);
    } else if(args.command==="template"||args.command==="revise") {
      const initial=propertyTemplate(sources.seed.value,sources.cohort);
      if(args.command==="revise") {
        const old=sources.selection.value;
        need(old.schema===PROPERTY_SCHEMA&&old.source.caseId===initial.source.caseId&&old.workshareCaseId===ORIGINAL_COHORT.caseId,
          "Revise the original customer selection in its original native case.");
        need(typeof args.reason==="string"&&args.reason.trim(),"Give the actual selection correction reason.");
        result={...clone(old),edition:old.edition+1,previous:{sha256:sources.selection.sha256,reason:args.reason},
          source:initial.source,selectedBy:"",selectedAt:null};
      } else result=initial;
      outputs.push(["PROPERTY_SELECTION.json",encode(result)]);
    } else if(args.command==="review-template") {
      result=propertyReviewTemplate({nativeSeed:sources["return-seed"].value,installation:sources.installation.value,
        selection:sources.selection.value,selectionSha256:sources.selection.sha256,selectionBytes:sources.selection.bytes});
      outputs.push(["PROPERTY_REVIEW.json",encode(result)],["Property_Selection_"+sources.selection.sha256.slice(0,16)+".json",sources.selection.raw]);
    } else {
      const rows=args.command==="review"?sources.review.value.sourceFiles:sources.selection.value.sourceFiles;
      const loaded=originals(rows,args["source-root"]);full=loaded.full;
      if(args.command==="inspect") {
        const inspected=inspectPropertySelection(sources.selection.value,loaded.files,previous);
        console.log(JSON.stringify({selection:rawMeta(sources.selection),counts:inspected.counts,findings:inspected.findings,
          qualification:inspected.qualification},null,2));
      } else if(args.command==="prepare") {
        const profile=readProfile(PROFILE);
        result=preparePropertyInstallation({seed:sources.seed.value,profile:profile.value,selection:sources.selection.value,
          selectionSha256:sources.selection.sha256,selectionBytes:sources.selection.bytes,caseState:sources["case-state"]?.value??null,
          corpus:sources.cohort,files:loaded.files,previous});
        need(encode(result.document).length<=128*1024,"The full native Installation document exceeds 128 KiB.");
        outputs.push(["Property_Selection_"+sources.selection.sha256.slice(0,16)+".json",sources.selection.raw],["installation-input.json",encode(result.document)],["installation-preview-input.json",encode(result.preview)],
          ["bindings.json",encode(result.bindings)],["WORKORDER.md",Buffer.from(renderWorkorder(result))],
          ["PROPERTY_REPORT.html",Buffer.from(renderPropertyReport(result))]);
      } else {
        result=preparePropertyReturn({nativeSeed:sources["return-seed"].value,installation:sources.installation.value,
          selection:sources.selection.value,selectionSha256:sources.selection.sha256,review:sources.review.value,
          reviewSha256:sources.review.sha256,reviewBytes:sources.review.bytes,caseState:sources["case-state"].value,files:loaded.files,previous});
        outputs.push(["installation-return-input.json",encode(result.inputs)],["PROPERTY_REPORT.html",Buffer.from(renderPropertyReport(result))]);
      }
    }
    if(args.command!=="inspect") {
      const out=privateDirectory(args.out);
      const names={seed:"NATIVE_SEED.json",cohort:"cohort.json",selection:"PROPERTY_SELECTION.json",
        previous:"PREVIOUS_SELECTION.json","return-seed":"NATIVE_RETURN_SEED.json",installation:"SAVED_INSTALLATION.json",review:"PROPERTY_REVIEW.json","case-state":"CASE_STATE.json"};
      const request={schema:"stellar-forge.property-commissioning-source-operation.v1",command:args.command,
        inputs:Object.fromEntries(Object.entries(sources).map(([key,value])=>[key,rawMeta(value)])),
        reason:args.reason??null,normalizer:normalizer?.source??null,originalFiles:full.map(value=>({filename:value.name,...rawMeta(value)}))};
      const receipt=publish(join(out,"PREPARATION_REQUEST.json"),encode(request)),saved=[receipt];
      for(const [key,value] of Object.entries(sources)) {
        // Template/revise output intentionally has another complete selection than its input.
        let name=names[key];
        if(args.command==="revise"&&key==="selection")name="PREVIOUS_SELECTION.json";
        if(outputs.some(([candidate])=>candidate===name))continue;
        saved.push(publish(join(out,name),value.raw));
      }
      for(const value of full)saved.push(publish(join(out,value.name),value.raw));
      for(const [name,raw] of outputs)saved.push(publish(join(out,name),raw));
      const report={schema:"stellar-forge.property-commissioning-source-preparation.v1",state:"PREPARED_SOURCE",
        command:args.command,result,outputs:saved};
      const finished=publish(join(out,"PROPERTY_PREPARATION.json"),encode(report));
      console.log(JSON.stringify({state:report.state,command:args.command,output:finished,outputs:saved,
        findings:result.property?.findings||result.findings||[],nativeActions:0,providerCalls:0},null,2));
    }
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
