import {readFile,writeFile} from 'node:fs/promises';
import barn from './barn_work.cjs';
import {buildBarnBundle} from './barn_work_bundle.mjs';
const [command,...args]=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw Error('Use --name value options.');opts[args[i].slice(2)]=args[i+1];}
async function read(path){if(!path)throw Error('Select the complete record file.');const data=JSON.parse(await readFile(path,'utf8'));return barn.validate(data.version==='barn-work.application.v1'?data.record:data);}
async function save(value){if(!opts.out)throw Error('Choose a new output file.');await writeFile(opts.out,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});console.log(JSON.stringify({file:opts.out,revision:value.revision}));}
if(command==='init')await save(barn.create({id:opts.id||'barn-work',name:opts.name||'Daily barn work',timezone:opts.timezone||'America/Los_Angeles'}));
else if(command==='apply'){const record=await read(opts.record);if(!opts.request)throw Error('Select the operation JSON file.');const request=JSON.parse(await readFile(opts.request,'utf8'));const result=barn.apply(record,request,opts.at||new Date().toISOString());await save(result.record);}
else if(command==='build')console.log(JSON.stringify(await buildBarnBundle(await read(opts.record),{out:opts.out}),null,2));
else throw Error('Use init, apply or build. See DAILY_BARN_WORK.md.');
