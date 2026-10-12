#!/usr/bin/env node
// MIT. Native source operation using the same reviewed QuestDB declarations.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readQuestDbSourceFile,openQuestDbSourceFile } from './config.mjs';
import { compileQuestDbReport } from './report.mjs';
import { readQuestDbCapture } from './source.mjs';
import { readJson,createFile,bytes,fault } from '../postgres/publisher/files.mjs';
const HELP=[
'QuestDB native source',
'  questdb inspect SOURCE.json',
'  questdb discover SOURCE.json [--tables trades,quotes]',
'  questdb query SOURCE.json --query NAME --input VALUES.json',
'  questdb capture SOURCE.json --query NAME --input VALUES.json --directory EDITION_DIR',
'                  [--extraction LIMITS.json] [--native-csv]',
'  questdb reopen EDITION_DIR',
'  questdb compile REPORT.json',
'Optional --out NEW.json retains the complete result. Source endpoint and credentials come',
'from declared environment references. An existing complete capture reopens its original files.',
'Use questdb-workspace for browser authoring, questdb-workbench for shared agent operation,',
'and questdb-publisher for the original extraction/review/publication/refresh lifecycle.',''].join('\n');
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){process.stdout.write(HELP);return;}
  const[command,sourcePath,...rest]=args,options={};
  if(!['inspect','discover','query','capture','reopen','compile'].includes(command)||!sourcePath)throw fault('QUESTDB_COMMAND_INVALID',HELP);
  for(let i=0;i<rest.length;i++){
    const key=rest[i];if(key==='--native-csv'){if(options[key])throw fault('QUESTDB_ARGUMENT_INVALID');options[key]=true;continue;}
    if(!['--tables','--query','--input','--directory','--extraction','--out'].includes(key)||!rest[i+1]||rest[i+1].startsWith('--')||Object.hasOwn(options,key))throw fault('QUESTDB_ARGUMENT_INVALID',HELP);
    options[key]=rest[++i];
  }
  let result,opened;
  try{
    if(command==='compile')result=compileQuestDbReport(await readJson(resolve(sourcePath),1048576));
    else if(command==='reopen')result=await readQuestDbCapture(resolve(sourcePath));
    else if(command==='inspect'){const source=await readQuestDbSourceFile(sourcePath);result={sourceHash:source.hash,sourceBytes:source.bytes,config:source.config,queries:source.description};}
    else{
      opened=await openQuestDbSourceFile(sourcePath);
      if(command==='discover')result=await opened.source.discover(options['--tables']?{tables:options['--tables'].split(',').map(x=>x.trim()).filter(Boolean)}:{});
      else{
        if(!options['--query'])throw fault('QUESTDB_QUERY_REQUIRED');
        const input=options['--input']?await readJson(resolve(options['--input']),1048576):{};
        if(command==='query')result=await opened.source.query(options['--query'],input);
        else{
          if(!options['--directory'])throw fault('QUESTDB_CAPTURE_DIRECTORY_REQUIRED');
          const extraction=options['--extraction']?await readJson(resolve(options['--extraction']),16384):{};
          result=await opened.source.capture(options['--query'],input,{...extraction,directory:resolve(options['--directory']),includeNativeCsv:options['--native-csv']===true});
        }
      }
    }
  }finally{await opened?.source.close();}
  if(options['--out'])await createFile(resolve(options['--out']),bytes(result));else process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'QUESTDB_SOURCE')+': '+error.message+'\n');process.exitCode=1;});
