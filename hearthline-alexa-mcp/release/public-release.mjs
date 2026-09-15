#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicRelease } from './gate-lib.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaults={root:path.resolve(here,'..'),manifestPath:path.join(here,'public-release.manifest.json')};
function args(argv){
  const out={...defaults};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i],v=argv[i+1]; if(!v) throw new Error(`missing value for ${k}`);
    if(k==='--dest') out.destination=v;
    else if(k==='--source-commit') out.sourceCommit=v;
    else if(k==='--root'||k==='--manifest') throw new Error(`${k} is disabled in the production release CLI; source root and allowlist are code-owned`);
    else throw new Error(`unknown argument ${k}`);
  }
  return out;
}
if(import.meta.url===`file://${process.argv[1]}`){
  buildPublicRelease(args(process.argv.slice(2))).then(r=>process.stdout.write(`${JSON.stringify(r,null,2)}\n`)).catch(e=>{ console.error(e.message); process.exitCode=1; });
}
