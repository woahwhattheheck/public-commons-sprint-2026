#!/usr/bin/env node
import {readFile,mkdir,open,link,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {importWorkspace} from './engine.mjs';
import {readApplicationSource} from './application-source-node.mjs';
import {createApplicationSource} from './application-source.mjs';
import {sha256Utf8} from './sha256.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const options={};
for(let i=0;i<args.length;i++){const key=args[i];if(!['--out','--workspace'].includes(key)||!args[i+1]||options[key])throw new Error('Usage: node build-standalone.mjs --out /absolute/new/Fixed_Asset_Finance_Workspace.html [--workspace /absolute/workspace.json]');options[key]=args[++i];}
if(!options['--out'])throw new Error('Supply --out for the complete standalone HTML.');
const [engineSource,shaSource,appSource,styles,template,issuerSource,issuerUISource,workOrderSource,workOrderUISource]=await Promise.all(['engine.mjs','sha256.mjs','app.mjs','styles.css','template.html','issuer-annex.mjs','issuer-ui.mjs','work-orders.mjs','work-orders-ui.mjs'].map(p=>readFile(resolve(root,p),'utf8')));
let portable=null;if(options['--workspace']){portable=await readFile(resolve(options['--workspace']),'utf8');importWorkspace(portable);}
const applicationSource=readApplicationSource(root),applicationSourceModule=applicationSource.files.find(f=>f.path==='services/fixed-asset-migration/application-source.mjs').text;
const data={applicationSource,applicationSourceModule,schema:'tjlabs.fixed-asset-finance-browser.v1',copyId:randomUUID(),portable,engineSource,shaSource,appSource,issuerSource,issuerUISource,workOrderSource,workOrderUISource};
createApplicationSource({sha256Utf8}).assertRuntime(applicationSource,data);
const html=template.replace('__STYLES__',()=>styles).replace('__BOOTSTRAP__',()=>JSON.stringify(data).replace(/</g,'\\u003c'));
const destination=resolve(options['--out']);await mkdir(dirname(destination),{recursive:true});const temporary=destination+'.'+randomUUID()+'.candidate';let handle;
try{handle=await open(temporary,'wx',0o600);await handle.writeFile(html,'utf8');await handle.sync();await handle.close();handle=null;await link(temporary,destination);let dir;try{dir=await open(dirname(destination),'r');await dir.sync();}catch(e){if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(e.code))throw e;}finally{if(dir)await dir.close();}}
finally{if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
process.stdout.write(JSON.stringify({path:destination,bytes:Buffer.byteLength(html),workspace:options['--workspace']||null})+'\n');
