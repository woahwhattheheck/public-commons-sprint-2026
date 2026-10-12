import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../vendor/dspace-mcp');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'UPSTREAM.json'),'utf8'));
let files=0;
for(const entry of manifest.files){
 const p=path.join(root,entry.path),b=fs.readFileSync(p);
 const sha=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
 if(sha!==entry.git_blob)throw new Error('Original upstream source changed: '+entry.path);
 if(!entry.path.startsWith('src/')||!entry.path.endsWith('.ts'))continue;
 const out=path.join(root,'dist',entry.path.slice(4).replace(/\.ts$/,'.js'));
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,stripTypeScriptTypes(b.toString('utf8'),{mode:'transform',sourceUrl:p}));
 files++;
}
console.log(JSON.stringify({upstream_commit:manifest.commit,source_tree:manifest.tree,compiled_modules:files,node:process.version}));

