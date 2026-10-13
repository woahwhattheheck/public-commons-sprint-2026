#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export async function main(argv=process.argv.slice(2),options={}){
  return (await import('./receiving.mjs')).main(argv,options);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'HIVE_RECEIVING_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
