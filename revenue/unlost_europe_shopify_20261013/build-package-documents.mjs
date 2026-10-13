#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPackageDocuments} from './localization/package-documents.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const input=path.resolve(process.argv[2]||path.join(root,'working-record.json'));
const output=path.resolve(process.argv[3]||path.join(root,'complete-document-output'));
if(fs.existsSync(output))throw Error('Choose a new output directory for the complete documents');
const working=JSON.parse(fs.readFileSync(input,'utf8'));
const result=buildPackageDocuments(working);
fs.mkdirSync(output,{recursive:true,mode:0o700});
for(const[name,value]of Object.entries(result.outputs))fs.writeFileSync(path.join(output,name),value,{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({output,...result.receipt},null,2)+'\n');
