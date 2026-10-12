#!/usr/bin/env node
// MIT. Native plan templates plus the original publisher/serve/schedule commands.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openRisingWavePublisher } from './model.mjs';
import { risingWavePublicationTemplate } from './plan.mjs';
import { createFile,bytes,fail } from '../common.mjs';
export async function main(argv=process.argv.slice(2)){
  if(argv[0]!=='template')return publisherMain(argv,{openPublisher:openRisingWavePublisher,sourceName:'RisingWave',defaultPort:8471});
  const values={};
  for(let index=1;index<argv.length;index+=2){
    const name=argv[index],value=argv[index+1];
    if(!['--workspace','--query','--out'].includes(name)||values[name]!==undefined||!value||value.startsWith('--'))throw fail('PUBLISHER_TEMPLATE_OPTION_INVALID');
    values[name]=value;
  }
  if(['--workspace','--query','--out'].some(name=>!values[name]))throw fail('PUBLISHER_TEMPLATE_OPTIONS_REQUIRED');
  const publisher=await openRisingWavePublisher({directory:resolve(values['--workspace'])});
  try{
    const value=risingWavePublicationTemplate(await publisher.source(),values['--query']),path=resolve(values['--out']);
    await createFile(path,bytes(value));const result={created:path};process.stdout.write(JSON.stringify(result)+'\n');return result;
  }finally{await publisher.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write((issue.code??'RISINGWAVE_PUBLISHER')+': '+(issue.code?issue.message:'Review the selected source and plan.')+'\n');process.exitCode=1;});
