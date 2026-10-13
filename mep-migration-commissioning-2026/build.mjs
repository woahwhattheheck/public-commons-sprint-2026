#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base=dirname(fileURLToPath(import.meta.url));
const C=require('./mep-migration-core.cjs'),E=require('./mep-migration-examples.cjs'),B=require('./mep-migration-build.cjs');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: node build.mjs --output /absolute/new/output-directory');
const output=resolve(args[1]);if(output===base)throw Error('Choose a new output directory, separate from the source project.');
const read=name=>readFile(join(base,name),'utf8');
const [core,examples,ui,template,source]=await Promise.all(['mep-migration-core.cjs','mep-migration-examples.cjs','mep-migration-ui.js','mep-migration.template.html','source-catalogue.json'].map(read));
const result=B.createFiles({C,E,catalogue:JSON.parse(source),core,examples,ui,template});
await mkdir(output,{recursive:false});
for(const file of result.files){const path=join(output,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content,{encoding:'utf8',flag:'wx'});}
for(const name of ['GUIDE.md','API.md','RECEIVING.md','AGENTS.md','LICENSE','source-refresh.json'])await writeFile(join(output,name),await read(name),{encoding:'utf8',flag:'wx'});
process.stdout.write(JSON.stringify({output,files:result.files.length+6,overview:result.overview})+'\n');
