#!/usr/bin/env node
// MIT. Reproduce the complete pinned compiled schemas without changing selection.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),yaml=require('./vendor/js-yaml.cjs');
for(const name of ['escala-mock','sdp']){
 const original=await readFile(new URL('./sources/'+name+'-openapi.yaml',import.meta.url),'utf8');
 const expected=await readFile(new URL('./sources/'+name+'-openapi.json',import.meta.url),'utf8');
 const actual=JSON.stringify(yaml.load(original),null,2)+'\n';
 if(actual!==expected)throw new Error('Pinned compiled schema differs: '+name);
 process.stdout.write(name+': complete compiled schema matches original YAML\n');
}
