#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runManagedOwnerClosureCourse} from './receiving-owner-closure-course.mjs';
const source=await readFile(fileURLToPath(new URL('./receiving.mjs',import.meta.url)),'utf8');
const result=await runManagedOwnerClosureCourse({'products/replication-workbench/receiving.mjs':source},{utf8Encode:s=>Buffer.from(s,'utf8'),sha256:b=>createHash('sha256').update(b).digest('hex')});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
