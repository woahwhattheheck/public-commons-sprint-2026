#!/usr/bin/env node
// MIT. Operate the original Crossref merchant and its retained source account.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {compileCrossrefMerchant,readCrossrefConfig,crossrefOpenApi} from './config.mjs';
import {createCrossrefSource} from './source.mjs';
import {startCrossrefMerchant,crossrefNativeFactory,crossrefSourceOptions} from './merchant.mjs';
import {need,json} from './metadata.mjs';

const usage='Crossref research merchant\n\n'+
  '  check --config /private/crossref.json\n'+
  '  openapi --config /private/crossref.json --out /private/crossref-openapi.json\n'+
  '  serve --config /private/crossref.json --state /private/crossref-state [--port 8437] [--operations-port 8438] [--facilitator URL]\n'+
  '  source --config /private/crossref.json --state /private/crossref-state --doi DOI [--updates] [--rows 1000] [--cursor *] [--refresh] [--out /private/result.json]\n'+
  '  capture --config /private/crossref.json --state /private/crossref-state --capture-id ID --out /private/capture.json\n'+
  '  snapshot --config /private/crossref.json --state /private/crossref-state\n';
async function write(path,value){
  const file=await open(resolve(path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(json(value));await file.sync();}finally{await file.close();}
}
export async function main(args=process.argv.slice(2)){
  const command=args[0];
  if(!command||['help','--help','-h'].includes(command)){process.stdout.write(usage);return;}
  const strings=['config','state','port','operations-port','facilitator','doi','rows','cursor','out','capture-id'];
  const {values}=parseArgs({args:args.slice(1),strict:true,options:{
    ...Object.fromEntries(strings.map(key=>[key,{type:'string'}])),updates:{type:'boolean'},refresh:{type:'boolean'},
    'allow-local-facilitator':{type:'boolean'}}});
  need(values.config,'CROSSREF_CONFIG_REQUIRED');
  const compiled=await readCrossrefConfig(values.config);
  if(command==='check'){
    process.stdout.write(json({schema:compiled.config.schema,inputSha256:compiled.inputSha256,products:compiled.products.map(({id,kind,path})=>({id,kind,path}))}));return;
  }
  if(command==='openapi'){
    need(values.out,'CROSSREF_OUTPUT_REQUIRED');await write(values.out,crossrefOpenApi(compiled));
    process.stdout.write(json({file:resolve(values.out),inputSha256:compiled.inputSha256}));return;
  }
  need(values.state,'CROSSREF_SOURCE_DIRECTORY_REQUIRED');
  const sourceDirectory=resolve(values.state);
  if(command==='serve'){
    const nativeFactory=await crossrefNativeFactory(values.facilitator,{allowLocalFacilitator:values['allow-local-facilitator']===true});
    const app=await startCrossrefMerchant(compiled,{sourceDirectory,nativeFactory,
      port:values.port===undefined?8437:Number(values.port),
      ...(values['operations-port']!==undefined?{operationsPort:Number(values['operations-port'])}:{})});
    process.stdout.write(json(await app.snapshot()));
    let closing;const stop=()=>closing??=app.close().then(()=>{process.exitCode=0;},error=>{process.stderr.write(json({error:error.code??'CROSSREF_CLOSE_FAILED'}));process.exitCode=1;});
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  const source=await createCrossrefSource(crossrefSourceOptions(compiled,{sourceDirectory}));
  try{
    if(command==='snapshot'){process.stdout.write(json(await source.snapshot()));return;}
    if(command==='capture'){
      need(values.out&&values['capture-id'],'CROSSREF_CAPTURE_OUTPUT_REQUIRED');
      const capture=await source.readCapture(values['capture-id']);await write(values.out,capture);
      process.stdout.write(json({captureId:values['capture-id'],file:resolve(values.out),bodySha256:capture.bodySha256}));return;
    }
    need(command==='source','CROSSREF_COMMAND_UNKNOWN');
    const kind=values.updates?'updates':'work',input=kind==='work'?{doi:values.doi}:
      {doi:values.doi,rows:values.rows??1000,cursor:values.cursor??'*'};
    const result=await source.edition(kind,input,{refresh:values.refresh===true});
    if(values.out)await write(values.out,result.envelope);
    process.stdout.write(json({captureId:result.captureId,status:result.capture.status,cached:result.cached,
      sourceUrl:result.capture.url,sourceSha256:result.capture.bodySha256,coverage:result.envelope.usage.coverage,
      records:result.envelope.results.length,...(values.out?{file:resolve(values.out)}:{})}));
  }finally{await source.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write(json({error:error.code??'CROSSREF_COMMAND_FAILED'}));process.exitCode=1;});
}
