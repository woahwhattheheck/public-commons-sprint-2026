#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function main(argv=process.argv.slice(2)){
  return (await import('./receiving.mjs')).main(argv);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'REPLICATION_RECEIVING_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
