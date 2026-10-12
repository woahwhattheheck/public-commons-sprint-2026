#!/usr/bin/env node
// MIT. Create and reopen the complete original analyst/customer edition.
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
const directory=resolve(options['--project']), pythonCommand=options['--python']||'python3';
const operation=options['--operation']||'scf-oecd-cli-briefing-20261012';
if(operation.length>110)throw new Error('Use an operation identity of at most 110 characters');
async function needsCreate(projectDirectory){
  try{await lstat(join(projectDirectory,'oecd-project.json'));return false;}
  catch(error){if(error.code!=='ENOENT')throw error;return true;}
}
const original=await launchOecd({projectDirectory:directory,create:await needsCreate(directory),pythonCommand,
  env:{...process.env,SF30_XML_NODE:process.execPath}});
try{
  const capture=await original.client.seed();
  const initial=await original.client.save({
    operation_id:operation,capture_id:capture.id,countries:['CAN','DEU','FRA','GBR','ITA','JPN','USA'],
    start_period:'2024-01',end_period:null,title:options['--title']||'OECD leading-indicator briefing · October 2026',
    notes:'Original OECD monthly amplitude-adjusted observations with full retained metadata and exact calendar comparisons.',
  });
  const saved=await original.client.save({...initial.selection,operation_id:operation+':customer-handover',
    project_id:initial.project_id,expected_revision:initial.project_revision,
    notes:initial.selection.notes+'\n\nCustomer handover: the complete source responses, original monthly series and report files are retained together for reopening.'});
  if(saved.project_id!==initial.project_id||saved.project_revision!==initial.project_revision+1)throw new Error('Original editorial revision did not retain the source project');
  const dataset=await original.client.exportDataset(saved.id), packet=await original.client.exportProject(saved.id);
  const output=join(directory,saved.id+'-original-project.zip');
  try{await writeFile(output,packet.body,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST'||!(await readFile(output)).equals(packet.body))throw error;}
  const reopenedDirectory=join(directory,'reopened-customer-project');
  const customer=await launchOecd({projectDirectory:reopenedDirectory,create:await needsCreate(reopenedDirectory),
    pythonCommand,env:{...process.env,SF30_XML_NODE:process.execPath}});
  let reopened,customerState;
  try{
    const originState=await original.client.state();customerState=await customer.client.state();
    if(customerState.project.id===originState.project.id)throw new Error('Reopen requires the separate customer workspace');
    reopened=await customer.client.importProject(packet.body);
    if(reopened.id!==saved.id||reopened.project_revision!==saved.project_revision||
      reopened.catalog_edition_id!==saved.catalog_edition_id)throw new Error('Revised original project did not reopen as its saved edition');
    for(const name of ['briefing.html','briefing.json','observations.csv']){
      if(!(await original.client.reportFile(saved.id,name)).body.equals((await customer.client.reportFile(reopened.id,name)).body))throw new Error('Reopened original report differs: '+name);
    }
    const expected=await original.client.sourceRows(saved.id),actual=await customer.client.sourceRows(reopened.id);
    if(JSON.stringify(actual.rows)!==JSON.stringify(expected.rows)||actual.snapshot!==expected.snapshot)throw new Error('Reopened original observations differ');
  }finally{await customer.close();}
  process.stdout.write(JSON.stringify({capture,initial,saved,dataset,reopened,
    packet:{path:output,bytes:packet.body.length,sha256:createHash('sha256').update(packet.body).digest('hex')},
    customerWorkspace:{directory:reopenedDirectory,id:customerState.project.id},
    browser:{command:process.execPath,arguments:[new URL('../cli.mjs',import.meta.url).pathname,'serve','--project',directory]},
    customerBrowser:{command:process.execPath,arguments:[new URL('../cli.mjs',import.meta.url).pathname,'serve','--project',reopenedDirectory]}
  },null,2)+'\n');
}finally{await original.close();}
