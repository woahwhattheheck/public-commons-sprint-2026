#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFINITIONS,buildCustomerDocuments} from './package-documents.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.length!==3)throw Error('Use node build.mjs NEW_OUTPUT_DIRECTORY');
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{mode:0o700});
const results=[];
for(const key of Object.keys(DEFINITIONS)){
 const working=JSON.parse(fs.readFileSync(path.join(here,'originals',key,'working-record.json'),'utf8'));
 const result=buildCustomerDocuments(key,working);
 for(const [name,body]of Object.entries(result.outputs))fs.writeFileSync(path.join(out,name),body,{flag:'wx',mode:0o600});
 results.push(result.receipt);
}
fs.writeFileSync(path.join(out,'complete-customer-receiving.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({out,customers:results.map(r=>({customer:r.customer,packages:r.packages.length,members:r.packages.reduce((n,p)=>n+p.files.length,0)}))}));
