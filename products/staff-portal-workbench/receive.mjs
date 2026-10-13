#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export {main} from './receiving.mjs';
import {main} from './receiving.mjs';
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'STAFF_PORTAL_RECEIVING_FAILED',message:e.message}})+'\n');process.exitCode=1;});
