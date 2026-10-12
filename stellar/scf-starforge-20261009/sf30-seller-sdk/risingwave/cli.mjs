#!/usr/bin/env node
// MIT. Native source, review, complete capture and retained recovery commands.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRisingWaveSourceFile } from './config.mjs';
import { readRisingWaveCapture,inspectRisingWaveCapture } from './capture.mjs';
import { compileRisingWaveReport } from './report.mjs';
import { fail,readJson,createFile,bytes,errorValue } from './common.mjs';
const HELP='RisingWave native source (Node22.16+, pg)\n\n'+
 '  inspect --source FILE\n'+
 '  discover --source FILE [--options DISCOVERY.json]\n'+
 '  report --input REPORT.json --out DECLARATION.json\n'+
 '  query --source FILE --query NAME [--input PARAMETERS.json]\n'+
 '  capture --source FILE --query NAME --directory PRIVATE_DIR\n'+
 '          [--input PARAMETERS.json --options EXTRACTION.json --base COMPLETE_CAPTURE_DIR]\n'+
 '  resume --source FILE --directory ORIGINAL_CAPTURE_DIR\n'+
 '  capture-status --directory PRIVATE_DIR\n'+
 '  capture-read --directory COMPLETE_CAPTURE_DIR [--manifest-sha SHA256]\n'+
 '  subscription-inspect --source FILE --query NAME\n'+
 '  subscription-review --source FILE --query NAME --request ID --out REVIEW.json [--retention "1 day"]\n'+
 '  subscription-create --source FILE --review REVIEW.json --request ID --directory PRIVATE_OPERATION_DIR\n\n'+
 'capture/read retain and verify all seven complete artifacts. resume reuses the original request and directory.\n'+
 'Subscription creation requires the exact retained review; discovery only reads the native catalogues.\n'+
 'Use risingwave-publisher for review/publication/schedules and risingwave-workspace for the complete browser.\n';
const allowed={
 inspect:['source'],discover:['source','options'],report:['input','out'],query:['source','query','input'],
 capture:['source','query','directory','input','options','base'],resume:['source','directory'],
 'capture-status':['directory'],'capture-read':['directory','manifest-sha'],
 'subscription-inspect':['source','query'],'subscription-review':['source','query','request','out','retention'],
 'subscription-create':['source','review','request','directory']
};
function parse(argv){
  const [command,...args]=argv,options={};
  if(!Object.hasOwn(allowed,command))throw fail('RISINGWAVE_COMMAND_REQUIRED',HELP);
  for(let index=0;index<args.length;index+=2){
    const name=args[index]?.replace(/^--/,''),value=args[index+1];
    if(!args[index]?.startsWith('--')||!allowed[command].includes(name)||options[name]!==undefined||!value||value.startsWith('--'))
      throw fail('RISINGWAVE_CLI_OPTION_INVALID');
    options[name]=value;
  }
  return {command,options};
}
function required(options,name){if(!options[name])throw fail('RISINGWAVE_CLI_OPTION_REQUIRED','Missing --'+name);return options[name];}
const input=async path=>path?readJson(resolve(path)): {};
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&['--help','help'].includes(argv[0])){process.stdout.write(HELP);return;}
  const {command,options}=parse(argv);let source=null,result;
  const controller=new AbortController(),abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    if(command==='report'){
      result=compileRisingWaveReport(await readJson(resolve(required(options,'input'))));
      const path=resolve(required(options,'out'));await createFile(path,bytes(result));result={created:path,declaration:result};
    }else if(command==='capture-read')result=await readRisingWaveCapture(resolve(required(options,'directory')),
      {expectedManifestSha256:options['manifest-sha']});
    else if(command==='capture-status')result=await inspectRisingWaveCapture(resolve(required(options,'directory')));
    else{
      source=(await openRisingWaveSourceFile(resolve(required(options,'source')))).source;
      if(command==='inspect')result=source.inspect();
      if(command==='discover')result=await source.discover({...await input(options.options),signal:controller.signal});
      if(command==='query')result=await source.query(required(options,'query'),await input(options.input),{signal:controller.signal});
      if(command==='capture')result=await source.capture(required(options,'query'),await input(options.input),{
        ...await input(options.options),directory:resolve(required(options,'directory')),
        ...(options.base?{baseCaptureDirectory:resolve(options.base)}:{}),signal:controller.signal});
      if(command==='resume')result=await source.resumeCapture(resolve(required(options,'directory')),{signal:controller.signal});
      if(command==='subscription-inspect')result=await source.inspectSubscription(required(options,'query'),{signal:controller.signal});
      if(command==='subscription-review'){
        result=await source.prepareSubscription(required(options,'query'),{requestId:required(options,'request'),
          retention:options.retention??'1 day',signal:controller.signal});
        const path=resolve(required(options,'out'));await createFile(path,bytes(result));result={created:path,review:result};
      }
      if(command==='subscription-create')result=await source.createSubscription(await readJson(resolve(required(options,'review'))),
        {requestId:required(options,'request'),directory:resolve(required(options,'directory')),signal:controller.signal});
    }
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await source?.close();process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write(JSON.stringify(errorValue(issue))+'\n');process.exitCode=1;});
