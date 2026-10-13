// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { bytes,createFile,readJson } from '../postgres/publisher/files.mjs';
import { openGleifWorkspace,receiveGleifWorkspace } from './workspace.mjs';
import { GleifClient } from './client.mjs';
import { startGleifServer } from './server.mjs';
import { inspectGleifSource,inspectGleifWorkspace } from './managed.mjs';
import { need } from './core.mjs';
const HELP = 'GLEIF company research\n\n'+
'  gleif init --workspace DIRECTORY --title "Company research"\n'+
'  gleif serve --workspace DIRECTORY [--port 0] [--startup-json]\n'+
'  gleif status --workspace DIRECTORY | --connection FILE\n'+
'  gleif capture --workspace DIRECTORY --plan PLAN.json [--id ORIGINAL_ID]\n'+
'  gleif import-source --workspace DIRECTORY --file ORIGINAL_RESPONSES.json [--id ORIGINAL_ID]\n'+
'  gleif rows --workspace DIRECTORY --capture ID [--offset 0 --limit 50 --search TEXT]\n'+
'  gleif compare --workspace DIRECTORY --before ID --after ID\n'+
'  gleif monitoring-preview --workspace DIRECTORY --selection SELECTION.json\n'+
'  gleif file --workspace DIRECTORY --sha256 ORIGINAL_SHA --out FILE\n'+
'  gleif run --workspace DIRECTORY --request REQUEST.json\n'+
'  gleif operation --workspace DIRECTORY --id ORIGINAL_ID\n'+
'  gleif dataset-query --workspace DIRECTORY --id DATASET_ID [--query QUERY]\n'+
'  gleif export --workspace DIRECTORY --out COMPLETE_PROJECT.json\n'+
'  gleif receive --workspace NEW_DIRECTORY --file COMPLETE_PROJECT.json\n\n'+
'Use --connection instead of --workspace to operate a running Applications project.\n'+
'Reuse the same capture ID and input to resume original pages. A new ID creates a new edition.\n'+
'Review, report and native dataset requests use run; complete request shapes are in products/gleif/OPERATING.md.\n';
function parse(args) {
  const options={};for(let i=0;i<args.length;i++){const key=args[i];need(key.startsWith('--')&&!Object.hasOwn(options,key),'GLEIF_ARGUMENT','Use each named option once.');
    if(['--startup-json','--help'].includes(key))options[key]=true;
    else{need(typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'GLEIF_ARGUMENT','Supply '+key+'.');options[key]=args[++i];}}
  return options;
}
const input=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(resolve(path))));
export async function main(args=process.argv.slice(2)) {
  const [command,...tail]=args;if(!command||command==='--help'||tail.includes('--help')){process.stdout.write(HELP);return;}
  const opts=parse(tail),write=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  if(command==='receive'){need(opts['--workspace']&&opts['--file'],'GLEIF_ARGUMENT');write(await receiveGleifWorkspace({directory:resolve(opts['--workspace']),package:await input(opts['--file'])}));return;}
  if(command==='init'){need(opts['--workspace']&&opts['--title'],'GLEIF_ARGUMENT');const workspace=await openGleifWorkspace({directory:resolve(opts['--workspace']),create:true,title:opts['--title']});try{write(workspace.status());}finally{await workspace.close();}return;}
  need(!!opts['--workspace']!==!!opts['--connection'],'GLEIF_ARGUMENT','Choose one project directory or one running connection.');
  if(command==='serve'){
    need(opts['--workspace'],'GLEIF_ARGUMENT','Serve an initialized project directory.');
    const directory=resolve(opts['--workspace']);await inspectGleifWorkspace(directory,opts['--expected-workspace']);
    const sourceIdentity=await inspectGleifSource(undefined,opts['--expected-source']),workspace=await openGleifWorkspace({directory});
    const server=await startGleifServer({workspace,port:Number(opts['--port']??0),sourceIdentity});
    const {close,...startup}=server;
    process.stdout.write((opts['--startup-json']?JSON.stringify(startup):'Open '+server.url)+'\n');
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;try{await close();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  let api,local;
  if(opts['--connection'])api=await GleifClient.connect(resolve(opts['--connection']));
  else {local=await openGleifWorkspace({directory:resolve(opts['--workspace'])});api=local;}
  try{
    let result;
    if(command==='status')result=await api.status();
    else if(command==='rows')result=await api.rows(opts['--capture'],{offset:Number(opts['--offset']??0),limit:Number(opts['--limit']??50),search:opts['--search']??''});
    else if(command==='compare')result=await api.compare(opts['--before'],opts['--after']);
    else if(command==='monitoring-preview'){need(opts['--selection'],'GLEIF_ARGUMENT');result=await api.monitoringPreview(await input(opts['--selection']));}
    else if(command==='file'){need(opts['--sha256']&&opts['--out'],'GLEIF_ARGUMENT');const raw=await api.object(opts['--sha256']);await createFile(resolve(opts['--out']),raw);result={file:resolve(opts['--out']),sha256:opts['--sha256'],bytes:raw.length};}
    else if(command==='operation')result=await api.operation(opts['--id']);
    else if(command==='dataset-query')result=await(local?api.datasetQuery(opts['--id'],opts['--query']??''):api.query(opts['--id'],opts['--query']??''));
    else if(command==='export'){need(opts['--out'],'GLEIF_ARGUMENT','Choose the complete output file.');const pkg=await(local?api.portable():api.package());await createFile(resolve(opts['--out']),bytes(pkg));result={file:resolve(opts['--out']),sha256:pkg.sha256,workspaceId:pkg.metadata.id};}
    else {
      let request;
      if(command==='run'){need(opts['--request'],'GLEIF_ARGUMENT');request=await input(opts['--request']);}
      else if(command==='capture'){need(opts['--plan'],'GLEIF_ARGUMENT');request={id:opts['--id']??randomUUID(),action:'capture',input:{plan:await input(opts['--plan'])}};}
      else if(command==='import-source'){need(opts['--file'],'GLEIF_ARGUMENT');request={id:opts['--id']??randomUUID(),action:'source.import',input:await input(opts['--file'])};}
      else need(false,'GLEIF_ARGUMENT','Choose a supported command; use --help.');
      await api.start(request);result=await api.wait(request.id);if(result.state!=='COMPLETE')process.exitCode=2;
    }
    write(result);
  }finally{if(local)await local.close();else api.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'GLEIF_FAILED',message:error.message,status:error.status})+'\n');process.exitCode=1;
});
