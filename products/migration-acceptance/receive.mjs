// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export {main} from './receiving.mjs';
import {main} from './receiving.mjs';
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code??'MIGRATION_RECEIVING_FAILED',message:error.message,details:error.details??{}}})+'\n');
    process.exitCode=1;
  });
