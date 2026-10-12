#!/usr/bin/env node
// MIT. Create the entire original analyst/customer edition with one command.
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { launchOecd } from '../client.mjs';
const options = {};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(!['--project','--operation','--title','--python'].includes(key)||!process.argv[i+1]||options[key])throw new Error('Use --project DIR [--operation ID] [--title TITLE] [--python COMMAND]');
  options[key]=process.argv[++i];
}
if(!options['--project'])throw new Error('--project is required');
const directory=resolve(options['--project']);
let create=false;
try{await lstat(join(directory,'oecd-project.json'));}catch(error){if(error.code!=='ENOENT')throw error;create=true;}
const original=await launchOecd({projectDirectory:directory,create,pythonCommand:options['--python']||'python3',
  env:{...process.env,SF30_XML_NODE:process.execPath}});
try{
  const capture=await original.client.seed();
  const saved=await original.client.save({
    operation_id:options['--operation']||'scf-oecd-cli-briefing-20261012',
    capture_id:capture.id,countries:['CAN','DEU','FRA','GBR','ITA','JPN','USA'],
    start_period:'2024-01',end_period:null,title:options['--title']||'OECD leading-indicator briefing · October 2026',
    notes:'Original OECD monthly amplitude-adjusted observations with full retained metadata and exact calendar comparisons.',
  });
  const dataset=await original.client.exportDataset(saved.id);
  const packet=await original.client.exportProject(saved.id);
  const output=join(directory,saved.id+'-original-project.zip');
  try{await writeFile(output,packet.body,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST'||!(await readFile(output)).equals(packet.body))throw error;}
  const reopened=await original.client.importProject(packet.body);
  if(reopened.id!==saved.id)throw new Error('Original project did not reopen as its saved edition');
  process.stdout.write(JSON.stringify({capture,saved,dataset,reopened,
    packet:{path:output,bytes:packet.body.length,sha256:createHash('sha256').update(packet.body).digest('hex')},
    browser:{command:'node',arguments:[resolve(new URL('../cli.mjs',import.meta.url).pathname),'serve','--project',directory]}
  },null,2)+'\n');
}finally{await original.close();}
