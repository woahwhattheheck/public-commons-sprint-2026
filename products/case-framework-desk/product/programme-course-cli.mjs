#!/usr/bin/env node
// Focused production-source course; authored boundaries are labelled in each result.
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runCASEProgrammeCourse} from './programme-course.mjs';
import {runCASEProgrammeUICourse} from './programme-ui-course.mjs';
import {runCASEProgrammeCLICourse} from './programme-cli-course.mjs';
const root=dirname(fileURLToPath(import.meta.url)),files={};
for(const name of ['source-json.mjs','case-source.mjs','case-report.mjs','programme.mjs','programme-host.mjs','programme-app.mjs','programme-boot.mjs','programme-build.mjs','programme-cli.mjs','desk.css'])files['product/'+name]=await readFile(join(root,name),'utf8');
for(const name of ['framework-v1.json','framework-v2.json'])files['examples/'+name]=await readFile(join(root,'../examples',name),'utf8');
const codec={utf8Encode:s=>new TextEncoder().encode(s),utf8Decode:b=>new TextDecoder('utf-8',{fatal:true}).decode(b),sha256:b=>createHash('sha256').update(b).digest('hex')};
const core=await runCASEProgrammeCourse({files,codec}),ui=await runCASEProgrammeUICourse({files,codec});
const cli=await runCASEProgrammeCLICourse({files,codec,workingText:core.selectedProgramme['programme-working.json']});
delete core.selectedProgramme;
process.stdout.write(JSON.stringify({core,ui,cli},null,2)+'\n');
