import * as selection from './selection.mjs';
import * as capture from './capture.mjs';
import * as report from './report.mjs';
import checks from './source-checks.cjs';
import {readFileSync} from 'node:fs';
const example=JSON.parse(readFileSync(new URL('./selection.example.json',import.meta.url),'utf8'));
const anchors=JSON.parse(readFileSync(new URL('./SOURCE_ANCHORS.json',import.meta.url),'utf8'));
const{illustrativeCapture,...result}=await checks.runCommissioningSourceChecks({...selection,...capture,...report},example,anchors);
console.log(JSON.stringify(result,null,2));
