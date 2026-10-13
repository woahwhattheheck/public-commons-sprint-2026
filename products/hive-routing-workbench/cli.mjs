#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {HiveClient,readJson,need} from './connection.mjs';
export async function main(argv=process.argv.slice(2),{stdout=process.stdout}={}){
  if(!argv.length||['--help','help'].includes(argv[0])){
    stdout.write('Hive Routing Workbench\n\nhive-routing-workbench status --connection /private/hive/connection.json\nhive-routing-workbench state --connection /private/hive/connection.json\nhive-routing-workbench action --connection /private/hive/connection.json --request /private/hive/exact-action.json\n\nThe action file is the original {action,data}. Keep the exact request and full returned body; recover native programme/entity effects before repeating an interrupted mutation. Agent tools provide the persistent request journal and declared host inputs.\n');return;
  }
  const [command,...rest]=argv,options={};
  need(['status','state','action'].includes(command),'HIVE_COMMAND','Choose status, state or action.');
  for(let i=0;i<rest.length;i+=2){need(['--connection','--request'].includes(rest[i])&&typeof rest[i+1]==='string'&&!Object.hasOwn(options,rest[i]),'HIVE_ARGUMENT','Use each complete argument once.');options[rest[i]]=rest[i+1];}
  need(options['--connection'],'HIVE_ARGUMENT','Select the managed connection.');
  need((command==='action')===Object.hasOwn(options,'--request'),'HIVE_ARGUMENT','Only action selects the complete request file.');
  const client=await HiveClient.connect(options['--connection']);
  try{
    let result;
    if(command==='status')result=await client.info();
    else if(command==='state')result=await client.state();
    else{const r=(await readJson(options['--request'])).value;need(r&&typeof r.action==='string'&&r.data&&typeof r.data==='object'&&!Array.isArray(r.data),'HIVE_ARGUMENT','Use original action and complete data.');result=await client.action(r.action,r.data);}
    stdout.write(result.bytes);if(!result.bytes.length||result.bytes.at(-1)!==10)stdout.write('\n');
    if(result.ok===false)process.exitCode=1;return result;
  }finally{await client.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'HIVE_CLI_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
