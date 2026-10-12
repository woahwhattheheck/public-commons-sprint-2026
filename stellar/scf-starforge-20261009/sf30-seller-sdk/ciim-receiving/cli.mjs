#!/usr/bin/env node
// MIT. Continue the same source-native CIIM receiving operation.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformCapture, createPageReader, digest } from './capture.mjs';
import { openJavaTransform, createEndpointTransform } from './runtime.mjs';
import { CONFIG, XML_SPEC, buildProfile, CONTRACT } from './profile.mjs';
import { buildDcProfile, DC_FIELDS } from './dc-profile.mjs';

function argumentsOf(argv) {
  const command=argv[0]&&!argv[0].startsWith('--')?argv.shift():'transform';
  const options={};
  const allowed=new Set(['source','out','operation','runtime','endpoint','endpoint-runtime',
    'endpoint-headers-file','receiving-target','oai-source-module','oai-python-directory',
    'python','java','heap-mib','timeout-ms','help']);
  for(let index=0;index<argv.length;index++){
    const key=argv[index].replace(/^--/,'');
    if(!argv[index].startsWith('--')||!allowed.has(key)||Object.hasOwn(options,key))
      throw new Error('Unknown or duplicate option: '+argv[index]);
    if(key==='help'){options.help=true;continue;}
    if(index+1>=argv.length||argv[index+1].startsWith('--'))throw new Error('Missing value for --'+key);
    options[key]=argv[++index];
  }
  return {command,options};
}
const help=[
  'CIIM metadata receiving through the original Proteus engine',
  '',
  'Portable specifications:',
  '  node cli.mjs specs --out /absolute/profile-directory',
  '',
  'Run or resume the reviewed OAI capture:',
  '  node cli.mjs transform --source /absolute/source.json',
  '    --oai-source-module /original/oai-pmh/source.mjs',
  '    --oai-python-directory /original/oai-pmh',
  '    --runtime /original/proteus/runtime.json',
  '    --out /absolute/receiving-operation --operation ciim-source-edition-01',
  '',
  'Alternatively supply the existing --endpoint URL ending /proteus/transform',
  'and --endpoint-runtime with the installed deployment reference.',
  'Optional --receiving-target points to the agreed institutional profile and',
  'authority configuration. Identity and deletion always follow the OAI header.',
  ''
].join('\n');
async function readJson(path) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(resolve(path))));
}
async function main() {
  const {command,options}=argumentsOf(process.argv.slice(2));
  if(options.help){process.stdout.write(help);return;}
  if(!options.out)throw new Error('Supply --out with an absolute receiving directory');
  const directory=resolve(options.out);
  await mkdir(directory,{recursive:true,mode:0o700});
  if(command==='specs'){
    const files={
      'datacite.spec.json':buildProfile(),
      'dublin-core.spec.json':buildDcProfile(),
      'xml-to-json.spec.json':XML_SPEC,
      'config.json':CONFIG,
      'profile-contract.json':{...CONTRACT,dublinCoreFields:DC_FIELDS}
    };
    const saved=[];
    for(const [name,value]of Object.entries(files)){
      const body=Buffer.from(JSON.stringify(value,null,2)+'\n');
      await writeFile(join(directory,name),body,{mode:0o600});
      saved.push({file:name,bytes:body.length,sha256:digest(body)});
    }
    process.stdout.write(JSON.stringify({directory,files:saved})+'\n');return;
  }
  if(command!=='transform')throw new Error('Choose transform or specs');
  if(!options.source||!options.operation)throw new Error('Supply --source and --operation');
  if(Boolean(options.runtime)===Boolean(options.endpoint))throw new Error('Choose one original Java runtime or existing Rosetta endpoint');
  const own=dirname(fileURLToPath(import.meta.url));
  const oaiSourceModule=resolve(options['oai-source-module']??join(own,'..','oai-pmh','source.mjs'));
  const oaiDirectory=resolve(options['oai-python-directory']??dirname(oaiSourceModule));
  const timeoutMs=Number(options['timeout-ms']??120000);
  const receiving=options['receiving-target']?await readJson(options['receiving-target']):{
    processing_profile:null,institutional_authorities:null,receiving_environment:null
  };
  let transform;
  try{
    if(options.runtime){
      transform=await openJavaTransform({runtimeFile:options.runtime,
        workDirectory:join(directory,'jvm'),java:options.java??'/usr/bin/java',
        heapMiB:Number(options['heap-mib']??128),timeoutMs});
    }else{
      if(!options['endpoint-runtime'])throw new Error('Supply the existing deployment reference with --endpoint-runtime');
      transform=createEndpointTransform({endpoint:options.endpoint,
        runtime:await readJson(options['endpoint-runtime']),
        headers:options['endpoint-headers-file']?await readJson(options['endpoint-headers-file']):{},timeoutMs});
    }
    const result=await transformCapture({
      sourceFile:resolve(options.source),oaiSourceModule,directory,operationId:options.operation,
      receiving,transform,pageReader:createPageReader({oaiDirectory,python:options.python??'python3'}),
      onProgress:progress=>process.stderr.write(JSON.stringify(progress)+'\n')
    });
    process.stdout.write(JSON.stringify({status:result.manifest.status,directory,
      records:result.manifest.counts,export:result.manifest.records,report:result.manifest.report,
      manifest:join(directory,'manifest.json')})+'\n');
  }finally{if(transform)await transform.close();}
}
main().catch(error=>{
  process.stderr.write(JSON.stringify({code:error.code??'RECEIVING_ERROR',message:error.message,details:error.details??{}})+'\n');
  process.exitCode=1;
});
