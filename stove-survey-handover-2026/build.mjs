#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const template=await readFile(join(root,'stove-operations-template.html'),'utf8');
const core=await readFile(join(root,'stove-operations-core.cjs'),'utf8');
const examples=await readFile(join(root,'stove-operations-examples.cjs'),'utf8');
const ui=await readFile(join(root,'stove-operations-ui.js'),'utf8');
const catalogue=JSON.parse(await readFile(join(root,'source-catalogue.json'),'utf8'));
function safeScript(s){return s.replace(/<\/script/gi,'<\\/script');}
let html=template;
for(const [key,value]of Object.entries({__CORE_JS__:safeScript(core),__EXAMPLES_JS__:safeScript(examples),__CATALOGUE_JSON__:JSON.stringify(catalogue).replaceAll('<','\\u003c'),__UI_JS__:safeScript(ui)})){
 if(html.split(key).length!==2)throw Error('Expected one exact template slot: '+key);
 html=html.replace(key,()=>value);
}
const output=resolve(process.argv[2]??join(root,'index.rebuilt.html'));
await writeFile(output,html,{flag:'wx'});
process.stdout.write(JSON.stringify({path:output,bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex')})+'\n');
