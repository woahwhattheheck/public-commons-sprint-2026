#!/usr/bin/env node
// MIT. Import an original saved pricing review into the original accounting terms.
import {pathToFileURL} from 'node:url';
import {writePricingReportImport} from './pricing.mjs';

const USAGE='Usage: node pricing-cli.mjs --report /private/pricing/version/report/report.json --out /private/new-pricing-import [--reference "Merchant quote October 2026"]';
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&['--help','-h'].includes(argv[0])){process.stdout.write(USAGE+'\n');return 0;}
  const allowed=new Set(['--report','--out','--reference']),args={};
  for(let index=0;index<argv.length;index+=2){
    if(!allowed.has(argv[index])||Object.hasOwn(args,argv[index])||!argv[index+1])
      throw new TypeError(USAGE);
    args[argv[index]]=argv[index+1];
  }
  if(!args['--report']||!args['--out'])throw new TypeError(USAGE);
  const result=await writePricingReportImport({reportFile:args['--report'],
    outputDirectory:args['--out'],accountingReference:args['--reference']});
  process.stdout.write(JSON.stringify(result)+'\n');
  return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(error=>{
    process.stderr.write(JSON.stringify({status:'PRICING_IMPORT_FAILED',code:error.code??'INVALID_IMPORT',
      message:error.message,details:error.details??{}})+'\n');
    process.exitCode=1;
  });
