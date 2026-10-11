// Install beside the original seller service JSON. For local example only.
import {readFileSync} from 'node:fs';
import {createCubePaidHandler} from './adapter.mjs';
const config = JSON.parse(readFileSync(new URL('./cube-adapter.json',import.meta.url),'utf8'));
export const cubeReport = createCubePaidHandler(config,{allowLoopback:true});
