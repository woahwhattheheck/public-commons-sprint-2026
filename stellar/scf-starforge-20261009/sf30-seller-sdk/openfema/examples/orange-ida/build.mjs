#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const dir=fileURLToPath(new URL('.',import.meta.url));
const read=p=>readFile(join(dir,p),'utf8');
const exportsOf=s=>[...s.matchAll(/^export (?:const|function)\s+([A-Za-z0-9_]+)/gm)].map(m=>m[1]);
const wrap=(name,s,pre='')=>'const '+name+'=(()=>{'+pre+s.replace(/^import .*;\n/gm,'').replaceAll('export ','')+';return {'+exportsOf(s).join(',')+'};})();';
const [domain,hash,core,ui,template,initial]=await Promise.all(['../../domain.mjs','sha256.mjs','workspace.mjs','ui.js','workspace.template.html','prepared-workspace.json'].map(read));
const code=wrap('Domain',domain)+wrap('Hash',hash)+wrap('Orange',core,'const {stable,decimalMinor,formatMinor,csv}=Domain;const {sha256Utf8,sha256Bytes}=Hash;')+'\nconst INITIAL_WORKSPACE='+JSON.stringify(initial).replaceAll('<','\\u003c')+';\n'+ui;
const html=template.replace('/*__SOURCE__*/',code.replaceAll('</script','<\\/script'));
await writeFile(join(dir,'workspace.html'),html);
console.log(JSON.stringify({file:join(dir,'workspace.html'),bytes:Buffer.byteLength(html)}));
