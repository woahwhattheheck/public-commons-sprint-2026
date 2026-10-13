#!/usr/bin/env node
// Prepare the complete source-bound association report and import it through Workspace.
import { readFile, mkdir, open, rm, realpath } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildAssociationReport } from "./assessment_association_report.mjs";
import { packageAssociationReport } from "./assessment_association_package.mjs";
const app=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const defaults={
  assessments:join(app,"source/station-assessment-context/assessment-records-domain217.csv"),
  crosswalk:join(app,"source_data/wqp_assessment159_additional_two_20261013/assessment159_native_identity_crosswalk.csv"),
  programme:join(app,"source/station-assessment-context/source-priority-assessment-domain217.json"),
  python:"python3"
};
function args(argv) {
  const values={...defaults};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==="--help"){values.help=true;continue;}
    const name=argv[i].replace(/^--/,"");
    if(!argv[i].startsWith("--")||!["assessments","crosswalk","programme","geography","output","workspace","python"].includes(name)||!argv[i+1]||argv[i+1].startsWith("--"))
      throw Error("Expected --assessments, --crosswalk, --programme, --geography, --output, --workspace or --python with a value");
    values[name]=argv[++i];
  }
  return values;
}
async function main() {
  const options=args(process.argv.slice(2));
  if(options.help){process.stdout.write(`Prepare the original192-record /159-site assessment association report.
Usage: node source_tools/assessment_association_report_cli.mjs --output NEW_DIRECTORY [--workspace EXISTING_WORKSPACE] [--python PYTHON]
Optional --assessments CSV --crosswalk CSV --programme JSON override retained input paths.
Optional --geography JSON attaches a completed native assessment context or saved station-geography result.
The new directory contains the readable report, complete JSON/CSVs, exact source inputs,
portable ZIP and sources.json. --workspace invokes the maintained source-import operation.
Output directories must be new; an import error preserves all completed report files.
`);return;}
  if(!options.output)throw Error("--output is required");
  const [assessments,identityCrosswalk,priorities,geography]=await Promise.all([
    readFile(resolve(options.assessments),"utf8"),readFile(resolve(options.crosswalk),"utf8"),
    readFile(resolve(options.programme),"utf8"),options.geography?readFile(resolve(options.geography),"utf8"):Promise.resolve(undefined)
  ]);
  const report=packageAssociationReport(buildAssociationReport({assessments,identityCrosswalk,priorities,geography}));
  const requested=resolve(options.output),parent=await realpath(dirname(requested)),name=basename(requested);
  if(!name||name==="."||name==="..")throw Error("Choose a new report directory");
  const output=join(parent,name);
  await mkdir(output,{mode:0o700});
  let complete=false;
  try{
    for(const [relative,body] of Object.entries(report.files)){
      const path=join(output,...relative.split("/"));
      await mkdir(dirname(path),{recursive:true,mode:0o700});
      const handle=await open(path,"wx",0o600);
      try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
    }
    complete=true;
  }finally{if(!complete)await rm(output,{recursive:true,force:true});}
  const result={output,source_id:report.sourceId,report:"OPEN_ASSESSMENT_ASSOCIATIONS.html",
    source_manifest:join(output,"sources.json"),archive:report.archive,summary:report.result.summary};
  if(options.workspace){
    const command=["-B","-m","model.cli","--workspace",resolve(options.workspace),"source-import",join(output,"sources.json")];
    const received=spawnSync(options.python,command,{cwd:app,encoding:"utf8",maxBuffer:16*1024*1024});
    if(received.error||received.status!==0){
      process.stdout.write(JSON.stringify(result,null,2)+"\n");
      throw Error("Report retained at "+output+"; Workspace source import: "+(received.error?.message||received.stderr||received.stdout||"exit "+received.status));
    }
    try{result.workspace_import=JSON.parse(received.stdout);}catch{throw Error("Report retained at "+output+"; source import returned non-JSON output: "+received.stdout);}
  }
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
main().catch(error=>{process.stderr.write("assessment report: "+error.message+"\n");process.exitCode=1;});
