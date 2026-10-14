// SPDX-License-Identifier: MIT
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {composeBranchProjectionWorker,composeBranchProjectionNotices,composeBranchProjectionStale} from './compose_branch_projection.mjs';

const argv=process.argv.slice(2);
const names=['worker','fence','notices','outbox','output'];
const options={};
if(argv.length!==10)throw new Error('Usage: node receive_branch_projection.mjs --worker CURRENT/worker.mjs --fence CURRENT/evaluation_fence.mjs --notices CURRENT/owner_notice_digest.mjs --outbox CURRENT/email_outbox.mjs --output NEW-DIRECTORY');
for(let i=0;i<argv.length;i+=2) {
  const name=argv[i].slice(2);
  if(!argv[i].startsWith('--')||!names.includes(name)||options[name]||!argv[i+1])
    throw new Error('Unknown, repeated or incomplete input option: '+argv[i]);
  options[name]=resolve(argv[i+1]);
}
if(names.some(name=>!options[name]))throw new Error('Every current source input is required.');
const target=options.output;
if(names.slice(0,4).some(name=>dirname(options[name])===target))
  throw new Error('Output must be separate from the current service inputs.');
let entries;try {entries=await readdir(target);}catch(e){if(e.code!=='ENOENT')throw e;entries=[];}
if(entries.length)throw new Error('Output directory must be empty.');
const bytes={},sources={};
for(const name of names.slice(0,4)) {
  bytes[name]=await readFile(options[name]);
  sources[name]=new TextDecoder('utf-8',{fatal:true}).decode(bytes[name]);
}
if(!sources.outbox.includes("from './owner_notice_digest.mjs'"))
  throw new Error('Current outbox no longer delegates to the supplied digest module.');
const worker=composeBranchProjectionWorker(sources.worker);
const notices=composeBranchProjectionNotices(sources.notices);
const stale=composeBranchProjectionStale(sources.fence);
const here=dirname(fileURLToPath(import.meta.url));
const files=new Map([
  ['worker.mjs',Buffer.from(worker.source)],
  ['evaluation_fence.mjs',bytes.fence],
  ['owner_notice_digest.mjs',Buffer.from(notices.source)],
  ['email_outbox.mjs',bytes.outbox],
  ['branch_projection_stale.mjs',Buffer.from(stale.source)]
]);
for(const name of ['branch_projection.mjs','branch_projection_recovery.mjs','branch_projection_notices.mjs'])
  files.set(name,await readFile(join(here,name)));
const identity=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const inputNames={worker:'worker.mjs',fence:'evaluation_fence.mjs',notices:'owner_notice_digest.mjs',outbox:'email_outbox.mjs'};
const manifest={schema:'publication-branch-source/v2',
  base_version:worker.base_version,version:worker.version,
  base_notice_version:notices.base_version,notice_version:notices.version,
  composition:{worker:worker.edits,notices:notices.edits,stale:stale.edits},
  inputs:Object.entries(bytes).map(([name,body])=>({path:inputNames[name],...identity(body)})),
  files:[...files].map(([path,body])=>({path,...identity(body)}))};
await mkdir(target,{recursive:true});
for(const [name,body]of files)await writeFile(join(target,name),body,{flag:'wx',mode:0o600});
for(const [name,body]of files) {
  const returned=await readFile(join(target,name));
  if(!returned.equals(body))throw new Error('Source readback differs: '+name);
  const checked=spawnSync(process.execPath,['--check',join(target,name)],{encoding:'utf8'});
  if(checked.error||checked.status!==0)throw new Error('Native syntax check failed: '+name+'\n'+(checked.stderr||checked.error));
}
manifest.native_syntax_checked=[...files.keys()];
const encoded=JSON.stringify(manifest,null,2)+'\n';
await writeFile(join(target,'source-manifest.json'),encoded,{flag:'wx',mode:0o600});
if((await readFile(join(target,'source-manifest.json'),'utf8'))!==encoded)
  throw new Error('Manifest readback differs.');
process.stdout.write(encoded);
