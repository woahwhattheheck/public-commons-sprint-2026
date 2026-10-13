#!/usr/bin/env node
/** Local CLI for complete original adoption-plan / frozen-cohort comparisons. */
import {readFile,stat,open,link,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {
  COHORT_DELIVERY_INPUT_SCHEMA,COHORT_DELIVERY_COMPARISON_SCHEMA,
  seedCohortDeliveryComparison,compareCohortDelivery,reopenCohortDeliveryComparison,
  exportCohortDeliveryCsv,exportCohortDeliveryHtml,seedCohortCommercialChoices,inspectCohortOriginalCosts,selectCohortOriginalCosts
} from './cohort_delivery_comparison.mjs';

const MAX=8*1024*1024;
const HELP=[
  'Cohort delivery — saved adoption plan to original frozen review','',
  'Usage:',
  '  grant-cohort-delivery seed --plan original-plan.json --review frozen-cohort.json [--output choices.json]',
  '  grant-cohort-delivery compare --input choices.json [--output comparison.json]',
  '  grant-cohort-delivery reopen --input comparison.json [--output reopened.json]',
  '  grant-cohort-delivery csv --input comparison.json [--output comparison.csv]',
  '  grant-cohort-delivery html --input comparison.json [--output comparison.html]','',
  '  grant-cohort-delivery commercial-seed --input comparison.json [--output commercial-choices.json]',
  '  grant-cohort-delivery commercial --input comparison.json --choices commercial-choices.json [--output reconciled.json]',
  '  grant-cohort-delivery original-costs --input comparison.json [--output original-cost-catalog.json]',
  '  grant-cohort-delivery original-costs-receive --input comparison.json --choices selected-original-costs.json [--output editable-successor.json]',
  'The original-cost catalog includes the full current records, retained selection and changed-source review.',
  'original-costs-receive preserves existing source witnesses; acceptSourceIds explicitly rebinds reviewed selections.',
  'Run compare on the complete editable successor to calculate or report a remaining source constraint.',
  'seed accepts --name TEXT and --note TEXT.',
  'Edit choices.json links and assignments to retain original identity and date associations.',
  'compare also accepts a complete saved comparison and recalculates from its retained input.',
  'reopen, csv and html verify the complete comparison against its retained source documents.',
  'Use --input - for stdin. One complete JSON input is limited to 8 MiB.',
  'Omit --output or use - for stdout. Existing destinations are preserved.',
  'The command reads local source files; the original Operations app owns case journal writes.',''
].join('\n');
function args(argv){
  if(!argv.length||argv.includes('--help')||argv[0]==='help')return{command:'help',options:{}};
  const command=argv[0],options={},allowed=command==='seed'?['plan','review','name','note','output']:
    ['commercial','original-costs-receive'].includes(command)?['input','choices','output']:
    ['compare','reopen','csv','html','commercial-seed','original-costs'].includes(command)?['input','output']:null;
  if(!allowed)throw new Error('Choose seed, compare, reopen, csv, html, commercial-seed, commercial, original-costs or original-costs-receive.');
  for(let i=1;i<argv.length;i+=2){
    const key=argv[i]?.startsWith('--')?argv[i].slice(2):'';
    if(!allowed.includes(key)||Object.hasOwn(options,key)||i+1>=argv.length)throw new Error('Use each documented --option once with its value.');
    options[key]=argv[i+1];
  }
  for(const key of command==='seed'?['plan','review']:['commercial','original-costs-receive'].includes(command)?['input','choices']:['input'])if(!options[key])throw new Error('Supply --'+key+'.');
  if(command==='seed'&&[options.plan,options.review].includes('-'))throw new Error('Seed needs two separate original local files.');
  if(['commercial','original-costs-receive'].includes(command)&&options.input==='-'&&options.choices==='-')throw new Error('Select a separate complete choices file when the comparison comes from stdin.');
  return{command,options};
}
async function input(path){
  let bytes;
  if(path==='-'){
    const chunks=[];let total=0;
    for await(const chunk of process.stdin){const next=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=next.length;if(total>MAX)throw new Error('The input exceeds 8 MiB.');chunks.push(next);}
    bytes=Buffer.concat(chunks);
  }else{
    const name=resolve(path),meta=await stat(name);if(!meta.isFile()||meta.size>MAX)throw new Error('Select a complete JSON file within 8 MiB.');
    bytes=await readFile(name);if(bytes.length>MAX)throw new Error('The input exceeds 8 MiB.');
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function output(path,raw){
  if(!path||path==='-'){process.stdout.write(raw);return;}
  const destination=resolve(path),temp=join(dirname(destination),'.'+basename(destination)+'.'+randomUUID()+'.tmp');
  let handle;
  try{
    handle=await open(temp,'wx',0o600);await handle.writeFile(raw,'utf8');await handle.sync();await handle.close();handle=null;
    await link(temp,destination);
  }finally{if(handle)await handle.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function main(argv=process.argv.slice(2)){
  const {command,options}=args(argv);if(command==='help'){process.stdout.write(HELP);return;}
  let result,raw;
  if(command==='seed')result=seedCohortDeliveryComparison(await input(options.plan),await input(options.review),{title:options.name,note:options.note});
  else{
    const original=await input(options.input);
    if(command==='original-costs')result=inspectCohortOriginalCosts(original);
    else if(command==='original-costs-receive')result=selectCohortOriginalCosts(original,await input(options.choices));
    else if(command==='commercial-seed')result=seedCohortCommercialChoices(original);
    else if(command==='commercial'){
      const candidate=original.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?reopenCohortDeliveryComparison(original).input:original;
      result=compareCohortDelivery({...candidate,commercial:await input(options.choices)});
    }else if(command==='compare'){
      const candidate=original.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?original.input:original;
      if(candidate.schema!==COHORT_DELIVERY_INPUT_SCHEMA)throw new Error('Select complete editable comparison input.');
      result=compareCohortDelivery(candidate);
    }else{
      result=reopenCohortDeliveryComparison(original);
      if(command==='csv')raw=exportCohortDeliveryCsv(result);
      if(command==='html')raw=exportCohortDeliveryHtml(result);
    }
  }
  await output(options.output,raw??JSON.stringify(result,null,2)+'\n');
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code||'COHORT_DELIVERY_ERROR',message:error.message,path:error.path||''})+'\n');process.exitCode=1;});
