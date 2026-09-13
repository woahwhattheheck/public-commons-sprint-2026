import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { evaluateRecipeFlow } from '../src/recipe-contract.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)), fixtureDir=path.resolve(here,'../fixtures');
for (const name of ['buy-success.json','graph-refuse.json','payment-required.json']) { const input=JSON.parse(fs.readFileSync(path.join(fixtureDir,name),'utf8')); console.log(`\n=== ${name} ===`); console.log(JSON.stringify(evaluateRecipeFlow(input),null,2)); }
