#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
const index=args.indexOf('--python');
let python=process.env.STARFORGE_GROUNDWATER_PYTHON||'python3';
if(index>=0){if(!args[index+1])throw new Error('--python requires the configured executable');python=args[index+1];args.splice(index,2);}
const child=spawn(python,['-B',fileURLToPath(new URL('./workspace.py',import.meta.url)),...args],{stdio:'inherit'});
let closing=false;
const stop=signal=>{if(!closing){closing=true;child.kill(signal);}};
process.on('SIGTERM',()=>stop('SIGTERM'));process.on('SIGINT',()=>stop('SIGINT'));
child.once('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
child.once('close',(code,signal)=>{process.exitCode=code??(signal?130:1);});
