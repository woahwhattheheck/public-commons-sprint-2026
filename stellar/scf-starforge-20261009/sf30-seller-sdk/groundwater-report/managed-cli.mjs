#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {managedSelection,startManagedReportDesk,inspectReportDesk,inspectReportLaunchSource,inspectReportPython,inspectScientificWorkspace} from './managed.mjs';
import {need} from './common.mjs';
export async function main(args=process.argv.slice(2)){
  if(!args.length||args[0]==='--help'){
    process.stdout.write('Groundwater Report Desk managed application\n\n  groundwater-report-managed inspect --desk ABS --source-root ABS --python ABS [--scientific-workspace ABS]\n  groundwater-report-managed serve <the exact retained Applications arguments>\n\nInitialize or receive the original desk with groundwater-report first. Review, save, start, stop and recover through the maintained Applications controls.\n');return;
  }
  if(args[0]==='inspect'){
    need((args.length-1)%2===0,'REPORT_MANAGED_ARGUMENTS','Use explicit named original paths.');
    const v={},allowed=['--desk','--source-root','--python','--scientific-workspace'];
    for(let i=1;i<args.length;i+=2){need(allowed.includes(args[i])&&!Object.hasOwn(v,args[i]),'REPORT_MANAGED_ARGUMENTS','Use the declared original paths.');v[args[i]]=args[i+1];}
    const result={desk:await inspectReportDesk(v['--desk']),source:await inspectReportLaunchSource(v['--source-root']),
      python:await inspectReportPython(v['--python']),
      scientific:v['--scientific-workspace']?await inspectScientificWorkspace(v['--scientific-workspace']):null};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const selected=managedSelection(args);
  return startManagedReportDesk(selected,{onStartup:value=>process.stdout.write(JSON.stringify(value)+'\n')});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'REPORT_APPLICATION_FAILED',message:error.message}})+'\n');process.exitCode=1;});
