#!/usr/bin/env node
'use strict';
// Offline captured-tree planning. Provider calls remain in the existing connected caller.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const crypto = require('node:crypto');
const {createGitHubTreeSourceCollector,CAPTURE_FORMAT} = require('./connected_github_source_tree.cjs');
const MAX = 256 * 1024 * 1024;
const usage = 'Usage: node connected_github_tree_source_cli.cjs plan|select CAPTURE.json\n'
  + 'plan prints exact missing immutable Git requests; select requires a complete selection.\n'
  + 'Input may be the original source selection or a retained collector state. No network or source execution.\n';
async function read(path) {
  let h;
  try {
    h=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=await h.stat();
    if(!before.isFile()||before.size>MAX)throw Error('Select a complete regular JSON file within 256 MiB.');
    const chunks=[];let seen=0;
    for(;;){const chunk=Buffer.alloc(Math.min(65536,MAX+1-seen));
      const {bytesRead}=await h.read(chunk,0,chunk.length,null);
      if(!bytesRead)break;seen+=bytesRead;
      if(seen>MAX)throw Error('Captured source exceeds the 256 MiB limit.');
      chunks.push(chunk.subarray(0,bytesRead));}
    const raw=Buffer.concat(chunks,seen),after=await h.stat();
    if(raw.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||
        after.ctimeMs!==before.ctimeMs||after.ino!==before.ino||after.dev!==before.dev)
      throw Error('The captured source file changed while reading.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
    return JSON.parse(text);
  }finally{await h?.close();}
}
async function main(argv=process.argv.slice(2)) {
  if(argv.length===1&&['--help','-h'].includes(argv[0])){process.stdout.write(usage);return 0;}
  if(argv.length!==2||!['plan','select'].includes(argv[0])){process.stderr.write(usage);return 2;}
  try {
    const input=await read(argv[1]),selection=input.schema===CAPTURE_FORMAT?
      {...input.request,commit_response:input.commit_response,tree_responses:input.tree_responses}:input;
    const collector=createGitHubTreeSourceCollector({sourceCodec:{
      utf8:text=>new TextEncoder().encode(text),
      sha1:bytes=>crypto.createHash('sha1').update(bytes).digest('hex')
    }});
    const plan=collector.plan(selection);
    if(argv[0]==='select'&&!plan.complete){
      process.stdout.write(JSON.stringify(plan,null,2)+'\n');return 3;
    }
    process.stdout.write(JSON.stringify(argv[0]==='select'?plan.selection:plan,null,2)+'\n');return 0;
  }catch(error){process.stderr.write(JSON.stringify({ok:false,code:error.code??'TREE_SOURCE_INPUT',
    message:String(error.message??error)})+'\n');return 2;}
}
module.exports={main};
if(require.main===module)main().then(code=>{process.exitCode=code;},error=>{
  process.stderr.write(JSON.stringify({ok:false,code:'TREE_SOURCE_IO',message:String(error.message)})+'\n');process.exitCode=2;
});
