import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import renderer from './customer-renderer.cjs';
import markdown from './customer-markdown.cjs';
import builder from './cohort-builder.cjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=await fs.readFile(path.join(root,'internal','preparation-config.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
const names=builder.editionNames(config);
for(const name of names){
 const data=JSON.parse(await fs.readFile(path.join(root,'customer',name+'.json'),'utf8'));
 for(const [ext,body]of [['html',renderer.renderLeadPackHTML(data)],['csv',renderer.leadPackCSV(data)],['md',markdown.render(data)]]){
  const target=path.join(root,'customer',name+'.'+ext);
  const prior=await fs.readFile(target,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(prior!==null&&prior!==body)throw Error('Existing customer output differs: '+target);
  if(prior===null)await fs.writeFile(target,body,{flag:'wx'});
 }
}
process.stdout.write(names.length===1?'The free customer edition regenerated exactly, including Markdown.\n':'Both customer editions regenerated exactly, including Markdown.\n');
