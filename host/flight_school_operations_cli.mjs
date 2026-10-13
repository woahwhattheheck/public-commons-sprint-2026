#!/usr/bin/env node
// MIT. Full flight-school operations and complete editable delivery.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import E from './flight_school_operations.cjs';
import {buildFlightSchoolBundle} from './flight_school_operations_bundle.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
function options(argv){const out={command:argv[0]||'help'};for(let i=1;i<argv.length;i++){if(!argv[i].startsWith('--')||argv[i+1]===undefined||argv[i+1].startsWith('--'))throw Error('Use named options followed by values.');const key=argv[i].slice(2);if(key in out)throw Error('Repeated option '+key);out[key]=argv[++i];}return out;}
const need=(out,key)=>{if(!out[key])throw Error('Supply --'+key);return out[key];};
async function save(path,value){const target=resolve(path);await writeFile(target,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});return target;}
export async function runFlightSchoolCLI(argv=process.argv.slice(2)){
 const a=options(argv);
 if(a.command==='help')return {commands:['init --source COMPLETE_SOURCE.json --out NEW_RECORD.json','inspect --record RECORD.json','catalogue --record RECORD.json','quote --record RECORD.json --booking BOOKING_INPUT.json','readiness --record RECORD.json --booking-id ID','flight --record RECORD.json --booking-id ID','account --record RECORD.json --student ID','progress --record RECORD.json --student ID','apply --record RECORD.json --action ORIGINAL_ACTION.json --out NEW_RECORD.json','build --record RECORD.json --out NEW_DIRECTORY']};
 if(a.command==='init'){const record=E.create(await read(need(a,'source')));return {path:await save(need(a,'out'),record),...E.summary(record)};}
 const record=E.validateRecord(await read(need(a,'record')));
 if(a.command==='inspect')return E.summary(record);
 if(a.command==='catalogue')return E.catalogue(record);
 if(a.command==='quote')return E.quote(record,await read(need(a,'booking')));
 if(a.command==='readiness')return E.readiness(record,need(a,'booking-id'));
 if(a.command==='flight')return E.flightEstimate(record,need(a,'booking-id'));
 if(a.command==='account')return E.account(record,need(a,'student'),a.on);
 if(a.command==='progress')return E.programmeProgress(record,need(a,'student'));
 if(a.command==='apply'){const result=E.apply(record,await read(need(a,'action'))),next=result.record||result;E.validateRecord(next);return {path:await save(need(a,'out'),next),...E.summary(next)};}
 if(a.command==='build')return buildFlightSchoolBundle(record,{out:need(a,'out')});
 throw Error('Unknown command. Use help.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runFlightSchoolCLI().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
