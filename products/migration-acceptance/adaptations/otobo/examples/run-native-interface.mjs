#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Execute the whole retained authored interface course, without OTOBO or external API access.
import {mkdirSync,writeFileSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runConfigurationInterfaceCourse} from './native-interface-course.mjs';
const json=value=>JSON.stringify(value,null,2)+'\n';
export function runReference(directory){
 if(typeof directory!=='string'||!directory.trim())throw Error('Supply one new private output directory.');
 const result=runConfigurationInterfaceCourse(),root=resolve(directory);
 mkdirSync(dirname(root),{recursive:true,mode:0o700});
 mkdirSync(root,{mode:0o700});
 const written=[];
 function write(path,content){const absolute=join(root,path);mkdirSync(dirname(absolute),{recursive:true,mode:0o700});const fd=openSync(absolute,'wx',0o600);try{writeFileSync(fd,content,'utf8');fsyncSync(fd);}finally{closeSync(fd);}written.push(path);}
 write('complete-interface-result.json',json(result));
 write('reviewed-project.json',result.projectBytes);
 write('original-approval-request.json',json(result.approvalRequest));
 for(const [name,value]of Object.entries(result.reference))write('reference/'+name+'.json',json(value));
 for(const file of result.prepared.files)write('prepared/'+file.path,file.content);
 write('prepared/MANIFEST.json',json(result.prepared.manifest));
 write('compiled-pipeline.json',json(result.compiled));
 write('compiled-acceptance.json',json(result.acceptance));
 write('nonmatching/full-observations.json',json(result.nonmatching.observations));
 write('nonmatching/full-parity.json',json(result.nonmatching.parity));
 write('nonmatching/full-acceptance.json',json(result.nonmatching.report));
 for(const file of result.matching.prepared.files)write('matching/'+file.path,file.content);
 write('matching/MANIFEST.json',json(result.matching.prepared.manifest));
 write('matching/full-observations.json',json(result.matching.observations));
 write('matching/full-parity.json',json(result.matching.parity));
 write('matching/full-acceptance.json',json(result.matching.report));
 write('README.txt','Prepared by TokenJunkieLabs\n\nComplete authored OTOBO configuration interface course\n\nThe original source/baseline/plan/returned reference is explicitly authored. This command executes the actual review model, original project approval/replay/reopen, unchanged dlt and acceptance compilers, and original complete comparator. It does not execute Perl, load DuckDB, import OTOBO, query a customer system or render a browser. Both parity paths retain native_execution_incomplete, including the matching authored return. Native emission and full original Migration Acceptance receiving use native/NATIVE_HELPER.md and NATIVE_RECEIVING.md with the real installed runtime.\n');
 return {directory:root,outcome:result.outcome,files:written};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==3)throw Error('Use node adaptations/otobo/examples/run-native-interface.mjs NEW_PRIVATE_OUTPUT_DIRECTORY');process.stdout.write(json(runReference(process.argv[2])));}
 catch(error){process.stderr.write(json({error:error.code??'OTOBO_INTERFACE_COURSE',message:error.message}));process.exitCode=1;}
}
