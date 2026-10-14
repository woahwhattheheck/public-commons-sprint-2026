// SPDX-License-Identifier: MIT
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {composeBranchProjectionWorker} from './compose_branch_projection.mjs';

const args=process.argv.slice(2);
if(args.length!==4 || args[0]!=='--worker' || args[2]!=='--output')
  throw new Error('Usage: node receive_branch_projection.mjs --worker /current/service/worker.mjs --output /private/new-source-directory');
const original=resolve(args[1]),target=resolve(args[3]);
if(dirname(original)===target)throw new Error('Output must be separate from the installed service.');
let entries;try { entries=await readdir(target); } catch(e){if(e.code!=='ENOENT')throw e;entries=[];}
if(entries.length)throw new Error('Output directory must be empty.');
const bytes=await readFile(original);
const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const composed=composeBranchProjectionWorker(source);
const here=dirname(fileURLToPath(import.meta.url));
const files=new Map([['worker.mjs',Buffer.from(composed.source)]]);
for(const name of ['branch_projection.mjs','branch_projection_recovery.mjs'])
  files.set(name,await readFile(join(here,name)));
const identity=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const manifest={schema:'publication-branch-source/v1',base_version:composed.base_version,
  version:composed.version,source_worker:identity(bytes),
  files:[...files].map(([path,body])=>({path,...identity(body)}))};
await mkdir(target,{recursive:true});
for(const [name,body]of files)await writeFile(join(target,name),body,{flag:'wx',mode:0o600});
await writeFile(join(target,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
for(const [name,body]of files) {
  const returned=await readFile(join(target,name));
  if(!returned.equals(body))throw new Error('Source readback differs: '+name);
}
process.stdout.write(JSON.stringify(manifest,null,2)+'\n');
