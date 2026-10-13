#!/usr/bin/env node
// MIT. Complete original World Bank programme calls and retained-file receiving.
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMerchantFileClient } from './retained-download.mjs';
import { downloadWorldBankProgramme } from './worldbank-programme-client.mjs';
import { validateWorldBankProgrammeArguments, worldBankProgrammeDefinitions } from './catalog/worldbank-programmes.mjs';
import { writeConsoleWorkflowFile } from './console/client-files.mjs';
import { worldBankNeed as need } from './worldbank-programme-contracts.mjs';
function options(values,allowed){
  const out={};
  for(let i=0;i<values.length;i+=2){const key=values[i],value=values[i+1];
    need(allowed.includes(key)&&!Object.hasOwn(out,key)&&typeof value==='string'&&value&&!value.startsWith('--'),'Use complete distinct documented options.');
    out[key]=value;
  }
  return out;
}
export async function main(argv=process.argv.slice(2)){
  const [command,...tail]=argv;
  if(!command||['help','--help','-h'].includes(command)){
    console.log('World Bank original customer programme\n\n'+
      '  starforge worldbank-programme-agent call --url MCP_URL --tool merchant_worldbank_programme_ACTION --arguments ORIGINAL.json --output RESULT.json [--token-env MCP_ACCESS_TOKEN]\n'+
      '  starforge worldbank-programme-agent download --url MCP_URL --workspace ALIAS --export-id SHA256 --manifest-sha256 SHA256 --directory PRIVATE_DIR [--token-env MCP_ACCESS_TOKEN]\n\n'+
      'Keep the complete arguments file and native operation ID before a write. A failed reply may be outcome-unknown; read that original operation before an exact retry.\n'+
      'Download receives every original file and resumes the same retained directory. Existing differing result files are preserved.');
    return 0;
  }
  if(command==='call'){
    const o=options(tail,['--url','--token-env','--tool','--arguments','--output']);
    need(o['--url']&&o['--tool']&&o['--arguments']&&o['--output'],'Supply the original MCP endpoint, tool, arguments file and output.');
    const raw=await readFile(resolve(o['--arguments']));
    need(raw.length<=1024*1024,'Use the complete original request within one MiB.');
    const args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    validateWorldBankProgrammeArguments(o['--tool'],args);
    const definition=worldBankProgrammeDefinitions.find(value=>value.name===o['--tool']);
    const client=await openMerchantFileClient({url:o['--url'],tokenEnv:o['--token-env']??'MCP_ACCESS_TOKEN',
      maximumResponseBytes:128*1024*1024,errorPrefix:'WORLDBANK',clientName:'starforge-worldbank-programme'});
    let returned=false;
    try{
      const result=await client.call(o['--tool'],args);returned=true;
      await writeConsoleWorkflowFile(resolve(o['--output']),result);
      console.log(JSON.stringify({state:'RESULT_RETAINED',tool:o['--tool'],output:resolve(o['--output'])}));return 0;
    }catch(error){
      if(!definition.readOnly&&!returned&&error.outcomeUnknown!==false&&error.applied!==false)error.outcomeUnknown=true;
      if(returned)error.resultReceived=true;
      throw error;
    }
  }
  if(command==='download'){
    const o=options(tail,['--url','--token-env','--workspace','--export-id','--manifest-sha256','--directory']);
    need(['--url','--workspace','--export-id','--manifest-sha256','--directory'].every(key=>o[key]),'Supply the complete original receiving selection.');
    const result=await downloadWorldBankProgramme({url:o['--url'],tokenEnv:o['--token-env']??'MCP_ACCESS_TOKEN',
      workspace:o['--workspace'],exportId:o['--export-id'],expectedManifestSha256:o['--manifest-sha256'],directory:resolve(o['--directory'])});
    console.log(JSON.stringify(result));return 0;
  }
  need(false,'Choose call or download; use --help for the complete contract.');
}
if(process.argv[1]&&await realpath(resolve(process.argv[1])).then(path=>pathToFileURL(path).href===import.meta.url,()=>false)){
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    console.error(JSON.stringify({error:{code:error.code??'WORLDBANK_CLIENT',message:error.message,
      outcomeUnknown:error.outcomeUnknown??false,resultReceived:error.resultReceived??false,
      status:error.status??null,recovery:'Preserve the original arguments file and operation ID; read the original status before an exact retry.'}}));
    process.exitCode=1;
  });
}
