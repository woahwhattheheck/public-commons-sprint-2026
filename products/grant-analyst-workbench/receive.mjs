#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export {main} from './receiving.mjs';
import {main} from './receiving.mjs';
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().then(value=>{if(value?.schema==='stellar-forge.grant-analyst-installed-result.v1')process.stdout.write(JSON.stringify(value)+'\n');}).catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'GRANT_ANALYST_RECEIVING_FAILED',message:e.message}})+'\n');process.exitCode=1;});
