import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildWqpTables, parseCsv, writeCsv } from './normalize_core.mjs';
const base=path.dirname(fileURLToPath(import.meta.url));
const capture=JSON.parse(fs.readFileSync(path.join(base,'capture.json'),'utf8'));
const sources=capture.sources.map(source=>{
 const content=fs.readFileSync(path.resolve(base,'..',source.source_path),'utf8');
 const bytes=Buffer.byteLength(content,'utf8'),sha=crypto.createHash('sha256').update(content,'utf8').digest('hex');
 if(bytes!==source.bytes||sha!==source.sha256)throw Error('Source body changed: '+source.source_path);
 return {...source,rows:parseCsv(content)};
});
const result=buildWqpTables(sources);
const directory=path.join(base,'derived');fs.mkdirSync(directory,{recursive:true});
for(const key of ['measurements','activities','coverage','calendar','selected_chlorophyll','chlorophyll_summary'])
 fs.writeFileSync(path.join(directory,key+'.csv'),writeCsv(result[key]),'utf8');
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(result.summary,null,2)+'\n','utf8');
process.stdout.write(JSON.stringify(result.summary,null,2)+'\n');
