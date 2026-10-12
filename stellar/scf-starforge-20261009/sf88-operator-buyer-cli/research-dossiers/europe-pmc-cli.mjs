// MIT. Europe PMC operator commands through the existing Research workspace.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {writeBytes,readBytes,exists,need} from '../node/store.mjs';

function argumentsFor(argv) {
  const [command='help',...tail]=argv,options={};
  for(let index=0;index<tail.length;index++) {
    const key=tail[index];need(/^--[a-z][a-z0-9-]*$/.test(key)&&!Object.hasOwn(options,key.slice(2)),'EUROPE_PMC_CLI_ARGUMENT_INVALID');
    const value=tail[++index];need(typeof value==='string'&&!value.startsWith('--'),'EUROPE_PMC_CLI_VALUE_REQUIRED');options[key.slice(2)]=value;
  }
  return {command,options};
}
function integer(value,fallback) {if(value===undefined)return fallback;need(/^[0-9]+$/.test(value),'EUROPE_PMC_CLI_INTEGER_INVALID');return Number(value);}
async function inputFile(path) {need(typeof path==='string','EUROPE_PMC_CLI_INPUT_REQUIRED');
 const bytes=await readResearchHostFile(resolve(path),4*1024*1024);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
async function output(value,file) {const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(file){const target=resolve(file);if(await exists(target))need((await readBytes(target,bytes.length)).equals(bytes),'EUROPE_PMC_CLI_OUTPUT_CHANGED');
 else await writeBytes(target,bytes,{exclusive:true});return {file:target,bytes:bytes.length};}
 return value;}
export const EUROPE_PMC_HELP=[
 'Research Europe PMC workspace',
 'Use the original private connection file. No command starts a new Research listener.',
 'node europe-pmc-cli.mjs COMMAND --connection /private/research-connection.json [OPTIONS]',
 '',
 'list [--offset N --limit N]                Saved queries and paged source operations',
 'status | history                         Current selected library and complete mutation history',
 'query --id QUERY                         Complete saved definition and every revision',
 'save-query --input JSON                  Save explicit requestId/actor/expectedRevision and definition',
 'prepare --input JSON                     Prepare exact query revision, label and live/documents mode',
 'inspect --id OPERATION                   Original plan, phase, coverage, source and receive receipts',
 'start --id OPERATION --input JSON        Start/continue exact plan (expectedPlanSha256)',
 'stop --id OPERATION                      Stop the current owned acquisition and retain its pages',
 'seal --id OPERATION --input JSON         Seal retained partial pages without another provider request',
 'continue --id OPERATION --input JSON     New explicitly linked part of the same original query',
 'chain --id OPERATION                     All original parts and whole-query coverage',
 'records --id OPERATION [--offset N --limit N --search TEXT --key SOURCE:ID]',
 'source --id OPERATION --index N [--boundary true]     Original page metadata, index is zero-based',
 'import --id OPERATION --file PACKET --sha256 SHA --plan-sha256 SHA',
 'review --input JSON                      Edition-bound metadata decision and complete note',
 'receive --id OPERATION --input JSON      Append exact source edition to an existing dossier/question',
 'compare --before OP --after OP [--status STATUS --offset N --limit N]',
 'compare-all --before OP --after OP [--status STATUS --out FILE]',
 'export --id OPERATION --format edition|ris|csv|review --file FILE',
 'export-source --id OPERATION --index N --file FILE [--boundary true]',
 'backup --input JSON --file FILE          Retain one exact complete workspace export and download it',
 'download-backup --request-id ID --file FILE',
 'restore --request-id ID --actor NAME --file FILE --sha256 SHA',
 '',
 'A JSON input preserves its original requestId on retries. Revision conflicts require an explicit',
 'new request after reviewing current source; incomplete replies reuse the original request.',
 'Use --out FILE for JSON results. Complete raw input and downloadable files are never clipped.',
].join('\n');
export async function runEuropePmcCli(argv) {
  const {command,options:o}=argumentsFor(argv);
  if(['help','--help'].includes(command))return {help:EUROPE_PMC_HELP};
  need(o.connection,'RESEARCH_CONNECTION_FILE_REQUIRED');
  const client=ResearchWorkspaceClient.fromFile(resolve(o.connection));let result;
  try {
    const service=client.europePmc();await service.list({limit:1});
    const page={offset:integer(o.offset,0),limit:integer(o.limit,30)},input=()=>inputFile(o.input),id=o.id;
    switch(command) {
      case 'list':result=await service.list(page);break;
      case 'status':result=await service.status();break;
      case 'history':result=await service.history();break;
      case 'query':result=await service.query(id);break;
      case 'save-query':result=await service.saveQuery(await input());break;
      case 'prepare':result=await service.prepare(await input());break;
      case 'inspect':result=await service.inspect(id);break;
      case 'start':result=await service.start(id,await input());break;
      case 'stop':result=await service.stop(id);break;
      case 'seal':result=await service.seal(id,await input());break;
      case 'continue':result=await service.continueSearch(id,await input());break;
      case 'chain':result=await service.chain(id);break;
      case 'records':result=await service.records(id,{...page,search:o.search??'',key:o.key??null});break;
      case 'source':result=await service.source(id,integer(o.index,0),{boundary:o.boundary==='true'});break;
      case 'import':result=await service.importFile(id,{file:o.file,sha256:o.sha256,expectedPlanSha256:o['plan-sha256']});break;
      case 'review':result=await service.review(await input());break;
      case 'receive':result=await service.receive(id,await input());break;
      case 'compare':result=await service.comparison({...page,before:o.before,after:o.after,status:o.status??'all'});break;
      case 'compare-all':{
        const items=[];let offset=0,first;
        do{const selected=await service.comparison({before:o.before,after:o.after,status:o.status??'all',offset,limit:100});
          first??=selected;need(first.before.sha256===selected.before.sha256&&first.after.sha256===selected.after.sha256,'EUROPE_PMC_COMPARISON_CHANGED');
          items.push(...selected.items);offset=selected.nextOffset;}while(offset!==null);
        result={...first,items,nextOffset:null};break;
      }
      case 'export':result=await service.exportEdition(id,{file:resolve(o.file),format:o.format??'edition'});break;
      case 'export-source':result=await service.exportSource(id,{file:resolve(o.file),index:integer(o.index,0),boundary:o.boundary==='true'});break;
      case 'backup':{const receipt=await service.exportWorkspace(await input());
        result={receipt,download:await service.downloadWorkspace({requestId:receipt.requestId,file:resolve(o.file),expectedSha256:receipt.sha256})};break;}
      case 'download-backup':result=await service.downloadWorkspace({requestId:o['request-id'],file:resolve(o.file)});break;
      case 'restore':result=await service.restoreFile({requestId:o['request-id'],actor:o.actor,file:resolve(o.file),expectedSha256:o.sha256});break;
      default:throw Object.assign(new Error('Unknown Europe PMC command'),{code:'EUROPE_PMC_CLI_COMMAND_INVALID'});
    }
    return output(result,o.out);
  }finally{await client.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  runEuropePmcCli(process.argv.slice(2)).then(value=>process.stdout.write((value.help??JSON.stringify(value,null,2))+'\n'))
    .catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'EUROPE_PMC_CLI_FAILED'})+'\n');process.exitCode=1;});
}
