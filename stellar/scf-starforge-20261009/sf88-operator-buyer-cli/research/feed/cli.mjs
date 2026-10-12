#!/usr/bin/env node
// MIT. Retained-source feed operator. Node.js 22+ on Linux; no package installation.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openResearchWorkspace} from '../workspace.mjs';
import {startResearchWorkspace} from '../server.mjs';
import {openFeedWorkspace} from './workspace.mjs';
import {inspectFeedRelease,receiveFeedRelease} from './receive.mjs';
import {defaultContract,check} from './contract.mjs';
const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){check(/^--[a-z-]+$/.test(args[i])&&args[i+1]!==undefined,'FEED_ARGUMENT_INVALID');options[args[i].slice(2)]=args[i+1];}
const required=key=>{check(options[key], 'FEED_OPTION_REQUIRED','Supply --'+key+'.');return options[key];};
const number=(key,fallback)=>options[key]===undefined?fallback:Number(options[key]);
const input=()=>({contractId:required('contract'),editionId:required('edition'),contractRevision:number('revision',undefined)});
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
let research;
try{
  if(command==='default')print(defaultContract(options.id));
  else if(command==='inspect')print(await inspectFeedRelease(resolve(required('source'))));
  else if(command==='receive')print(await receiveFeedRelease({sourceDirectory:resolve(required('source')),destination:resolve(required('workspace'))}));
  else if(command==='serve'){
    const server=await startResearchWorkspace({workspace:resolve(required('workspace')),port:number('port',0)});
    process.stdout.write(server.url+'\n');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void server.close().then(()=>process.exit()));
  }else{
    check(['contracts','save-contract','preview','resolve','compare','freeze','releases','export'].includes(command),'FEED_COMMAND_INVALID','Commands: default, contracts, save-contract, preview, resolve, compare, freeze, releases, export, inspect, receive, serve.');
    research=await openResearchWorkspace(resolve(required('workspace')));const feed=await openFeedWorkspace(research);
    if(command==='contracts')print(await feed.contracts());
    if(command==='save-contract')print(await feed.saveContract({contract:JSON.parse(await readFile(resolve(required('file')),'utf8')),expectedRevision:number('expected-revision',0)}));
    if(command==='preview')print(await feed.preview(input()));
    if(command==='resolve')print(await feed.resolveException({...input(),sourceFingerprint:required('source-fingerprint'),expectedRevision:number('expected-revision',0),exceptionId:required('exception'),action:required('action'),note:required('note'),...(options.value!==undefined?{value:JSON.parse(options.value)}:{})}));
    if(command==='compare')print(await feed.compare({...input(),beforeId:required('before')}));
    if(command==='freeze'){
      const p=await feed.preview(input());
      // CLI preview + freeze is one explicit current-input action; API accepts caller revision pins.
      print(await feed.freeze({...input(),beforeId:options.before,sourceFingerprint:p.sourceFingerprint,expectedReviewRevision:p.reviewRevision}));
    }
    if(command==='releases')print(await feed.releases({contractId:options.contract,editionId:options.edition}));
    if(command==='export')print(await feed.exportRelease(required('release'),resolve(required('destination'))));
  }
}catch(error){process.stderr.write(JSON.stringify({error:error.code??'FEED_OPERATION_FAILED',message:error.message})+'\n');process.exitCode=1;}
finally{await research?.close();}
