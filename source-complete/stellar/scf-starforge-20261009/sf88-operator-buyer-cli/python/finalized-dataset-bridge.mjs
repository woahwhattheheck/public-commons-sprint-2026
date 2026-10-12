// SPDX-License-Identifier: MIT
// The original read-only SF100 scanner, reached through the existing Python Runtime.
import {realpath,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {scan} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {initializationDirectory as directory} from '../initialization.mjs';
import {need} from '../config.mjs';

async function main(args){
  need(args.length===2&&args[0]==='--room'&&resolve(args[1])===args[1],
    'FINALIZED_DATASET_ROOM_REQUIRED');
  const room=args[1];await directory(room);await directory(join(room,'pages'));
  const value=await scan(room,{retainPayload:false});
  need(value.finalized===true&&value.nextCursor===null&&value.count===value.total,
    'FINALIZED_DATASET_COMPLETE_ROOM_REQUIRED');
  for(const path of [join(room,'session.json'),join(room,'manifest.json'),
    ...value.pages.map((_,index)=>join(room,'pages',String(index).padStart(5,'0')+'.json'))]){
    const info=await lstat(path);
    need(info.isFile()&&!info.isSymbolicLink()&&await realpath(path)===path,
      'FINALIZED_DATASET_SOURCE_PATH_CHANGED');
  }
  process.stdout.write(JSON.stringify({mode:'SF100_FINALIZED_SCAN',scan:value})+'\n');
}
main(process.argv.slice(2)).catch(error=>{
  const code=/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'FINALIZED_DATASET_SCAN_FAILED';
  process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;
});
