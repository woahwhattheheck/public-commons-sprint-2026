import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {loadMatch,overlay} from './engine.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const value=(flag,fallback)=>{const ix=args.indexOf(flag);return ix<0?fallback:args[ix+1]};
const file=value('--input',join(root,'fixtures/synthetic-match.jsonl'));
const persona=value('--persona','analyst'),language=value('--lang','en');
const match=await loadMatch(file);
const output={source_sha256:match.sourceHash,synthetic_only:true,frame_count:match.frames.length,
  insights:match.insights.map(x=>({insight:x,overlay:overlay(x,{persona,language})}))};
process.stdout.write(JSON.stringify(output,null,2)+'\n');
