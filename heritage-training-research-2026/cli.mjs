import {receiveDataset} from './adapters.mjs';
import * as model from './model.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createResearchProject,receiveResearch,summary,upsert,recordReview,saveAnalysis,receiveTableEdition} from './model.mjs';
const [command,...args]=process.argv.slice(2),flags={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined||Object.hasOwn(flags,args[i]))throw Error('Use unique --name value arguments.');flags[args[i]]=args[i+1];}
const read=path=>readFile(resolve(path),'utf8'),json=async path=>JSON.parse(await read(path)),need=k=>{if(!flags[k])throw Error(k+' is required.');return flags[k];};
async function save(project){const out=resolve(need('--out'));await writeFile(out,JSON.stringify(await receiveResearch(project),null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({projectId:project.id,path:out}));}
if(command==='create')await save(await createResearchProject(await json(need('--seed'))));
else{
 const project=await receiveResearch(await read(need('--project')));
 if(command==='show')console.log(JSON.stringify(await summary(project),null,2));
 else if(command==='record')await save(await upsert(project,need('--table'),await json(need('--record'))));
 else if(command==='review')await save(await recordReview(project,await json(need('--review'))));
 else if(command==='analyze')await save(await saveAnalysis(project,await json(need('--definition'))));
 else if(command==='intake')await save(await receiveDataset(project,{filename:need('--csv'),content:await read(need('--csv')),config:await json(need('--mapping'))},model));
 else if(command==='edition')await save(await receiveTableEdition(project,need('--table'),need('--csv'),await read(need('--csv'))));
 else throw Error('Commands: create, show, record, review, analyze, edition, intake. Saves require a new --out path.');
}
