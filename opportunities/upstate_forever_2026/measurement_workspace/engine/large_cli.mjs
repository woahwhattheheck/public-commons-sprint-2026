/** Installed original command dispatch: large-import/prepare/commit/export/receive/status. */
import fs from 'node:fs';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {intakeFromFile,prepareIntake,commitIntake,intakeStatus,listIntakes} from './large_intake.mjs';
import {exportEdition,editionMemberFile,receiveArchive,listEditions} from './large_delivery.mjs';
import {copyVerified,atomicJSON} from './large_io.mjs';
import {InputError} from './parse.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function runLargeCLI(command,options,directory){
 const w=new MeasurementWorkspace(directory);let value;
 try{
  if(command==='prepare'||command==='import'){
   if(!options.intake&&!options.file)throw new InputError('Select --file or a retained --intake');
   const intake=options.intake?intakeStatus(w,options.intake):intakeFromFile(w,path.resolve(options.file),{kind:options.kind||'wqp',label:options.label||path.basename(options.file),mapping:options.mapping?JSON.parse(fs.readFileSync(options.mapping,'utf8')):{}});
   const prepared=prepareIntake(w,intake.id);value=command==='prepare'?{...prepared,workspaceRevision:w.revision()}:commitIntake(w,intake.id,{expectedRevision:options['expected-revision']===undefined?undefined:Number(options['expected-revision'])});
  }else if(command==='commit')value=commitIntake(w,options.intake,{expectedRevision:options['expected-revision']===undefined?undefined:Number(options['expected-revision'])});
  else if(command==='status')value=options.intake?intakeStatus(w,options.intake):{intakes:listIntakes(w),editions:listEditions(w)};
  else if(command==='export'){
   if(options['native-workspace'])execFileSync(process.env.MEASUREMENTS_PYTHON||'python3',[fileURLToPath(new URL('../large_context.py',import.meta.url)),path.resolve(options['native-workspace']),directory]);
   const filters=options.filters?JSON.parse(fs.readFileSync(options.filters,'utf8')):{};
   value=await exportEdition(w,{...(options.id?{id:options.id}:{}),filters});
   if(options.output){const target=path.resolve(options.output),meta=path.join(target,'edition.json');if(fs.existsSync(meta)&&fs.readFileSync(meta,'utf8')!==JSON.stringify(value,null,2)+'\n')throw new InputError('Existing edition metadata differs',409);fs.mkdirSync(target,{recursive:true});for(const member of value.files){const {file}=editionMemberFile(w,value.id,member.path);copyVerified(file,path.join(target,member.path),member);}if(!fs.existsSync(meta))atomicJSON(meta,value);value={...value,output:target};}
  }else if(command==='receive'){if(!options.file)throw new InputError('Select --file complete-project.zip');value=receiveArchive(w,path.resolve(options.file));}
  else throw new InputError('Unknown large-file command');
  const text=JSON.stringify(value,null,2)+'\n';if(options.result)fs.writeFileSync(options.result,text,{flag:'wx'});else process.stdout.write(text);return value;
 }finally{w.close();}
}
