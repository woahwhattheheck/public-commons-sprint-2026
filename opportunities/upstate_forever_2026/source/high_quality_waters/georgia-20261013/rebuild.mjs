import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {buildGeorgiaRegistry} from './build_registry.mjs';
const read=async name=>{const bytes=await readFile(new URL(name,import.meta.url));return{bytes,value:JSON.parse(bytes),sha256:createHash('sha256').update(bytes).digest('hex')};};
const input=await read('rule-indexed-source.json'),selection=await read('rule-selection.json'),retained=await read('ga.selected-reaches.json');
const actual=buildGeorgiaRegistry(input.value,selection.value);
if(!isDeepStrictEqual(actual,retained.value))throw Error('Rebuilt Georgia source differs from retained registry');
console.log(JSON.stringify({schema:'upstate.georgia-classification-rebuild/v1',records:actual.records.length,source_sha256:input.sha256,selection_sha256:selection.sha256,registry_sha256:retained.sha256,equal:true},null,2));
