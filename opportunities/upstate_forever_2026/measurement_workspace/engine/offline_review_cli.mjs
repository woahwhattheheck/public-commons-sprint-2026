#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {exportOfflineReview,inspectOfflineChanges,receiveOfflineChanges} from './offline_review.mjs';
import {safeJSON} from './parse.mjs';
const [command='help',...args]=process.argv.slice(2),options={};
try{
  for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1]||Object.hasOwn(options,args[i].slice(2)))throw new Error('Use unique --name value options');options[args[i].slice(2)]=args[i+1];}
  const required=name=>{if(!options[name])throw new Error('--'+name+' is required');return options[name];};
  let result;
  if(command==='export'){
    const workspace=new MeasurementWorkspace(path.resolve(required('workspace')));
    try{result=exportOfflineReview(workspace,required('collection'),required('output'));}finally{workspace.close();}
  }else if(command==='inspect'||command==='receive'){
    const changes=safeJSON(fs.readFileSync(required('changes'),'utf8'));
    result=command==='inspect'?inspectOfflineChanges(required('package'),changes).summary:receiveOfflineChanges(required('package'),changes,required('workspace'));
  }else if(command==='help'){
    console.log('Offline measured-data review — Node >=22.16\n\nexport --workspace ORIGINAL_MEASUREMENTS --collection COLLECTION_ID --output NEW_PACKAGE\ninspect --package ORIGINAL_PACKAGE --changes REVIEW_CHANGES_JSON\nreceive --package ORIGINAL_PACKAGE --changes REVIEW_CHANGES_JSON --workspace NEW_RECIPIENT\n\nOpen review.html offline. Receiving uses the original engine and preserves sender data.');process.exit(0);
  }else throw new Error('Unknown operation: '+command);
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({error:error.message,status:error.status||400}));process.exitCode=1;}
