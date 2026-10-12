#!/usr/bin/env node
// MIT. RIS source operations through the original Research workspace client.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {need,parseJson,safeCode} from '../../node/store.mjs';

export const RIS_COMMANDS=['ris-prepare','ris-prepare-source','ris-preview','ris-receive','ris-list',
  'ris-review','ris-request','ris-compare','ris-export','ris-export-comparison'];
const commands={
  'ris-prepare':['input'],'ris-prepare-source':['input','source-file','sha256'],
  'ris-preview':['input'],'ris-receive':['input'],'ris-list':['revision','offset','limit'],
  'ris-review':['edition','revision','offset','limit','record'],'ris-request':['request','revision'],
  'ris-compare':['before','after','revision','section','offset','limit'],
  'ris-export':['edition','revision','format','document','record','out','sha256'],
  'ris-export-comparison':['before','after','revision','format','out','sha256'],
};
export const RIS_USAGE=[
  'Original RIS source review',
  '',
  'Use the existing Research listener and dossier:',
  '  ris-prepare --input files-and-review.json',
  '  ris-prepare-source --input review.json --source-file retained.ris-source.json --sha256 SHA',
  '  ris-preview --input source-and-review.json',
  '  ris-receive --input reviewed-plan.json',
  '  ris-list [--revision N --offset 0 --limit 30]',
  '  ris-review --edition EDITION [--record RECORD --revision N --offset 0 --limit 50]',
  '  ris-request --request ORIGINAL_REQUEST_ID [--revision N]',
  '  ris-compare --before EDITION --after EDITION [--section changed --revision N]',
  '  ris-export --edition EDITION --format edition|source|document|record|selected-ris|csv|html|md --out FILE',
  '  ris-export-comparison --before EDITION --after EDITION --format json|html|md --out FILE',
  '',
  'Every command also requires --connection-file PRIVATE_CONNECTION --directory ORIGINAL_STORE --id DOSSIER.',
  'Files in ris-prepare are absolute original paths with their SHA256, declared encoding and full source/query provenance.',
  'Review every record and duplicate group, preserve the complete returned plan hash, then receive once with its base revision.',
  'The original requestId recovers a lost response even after later dossier edits. Keep that ID and full payload on retry.',
  'Original document/record exports retain bytes. selected-ris is explicitly derived UTF-8; csv protects spreadsheet cells.',
  'The original dossier portable export includes all RIS source editions and review history.',
  ''
].join('\n');
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  const [command,...args]=argv;
  if(!command||['help','--help','-h'].includes(command)){output.write(RIS_USAGE);return;}
  need(RIS_COMMANDS.includes(command),'RIS_COMMAND_UNKNOWN');
  const fields=['connection-file','directory','id','timeout-ms',...commands[command]];
  const {values,tokens}=parseArgs({args,options:Object.fromEntries(fields.map(name=>[name,{type:'string'}])),strict:true,tokens:true});
  const seen=new Set();for(const token of tokens)if(token.kind==='option'){
    need(!seen.has(token.name),'ARGUMENT_REPEATED');seen.add(token.name);
  }
  const required=name=>{need(typeof values[name]==='string'&&values[name].length>0,'RIS_ARGUMENT_REQUIRED');return values[name];};
  const number=name=>{
    if(values[name]===undefined)return undefined;
    need(/^(0|[1-9][0-9]{0,8})$/.test(values[name]),'RIS_INTEGER_ARGUMENT_INVALID');return Number(values[name]);
  };
  const chosen=object=>Object.fromEntries(Object.entries(object).filter(([,value])=>value!==undefined));
  const input=async()=>parseJson(await readResearchHostFile(resolve(required('input')),16*1024*1024));
  const client=new ResearchWorkspaceClient({connectionFile:resolve(required('connection-file')),directory:resolve(required('directory'))},
    values['timeout-ms']===undefined?{}:{timeoutMs:number('timeout-ms')});
  try{
    await client.status();const ris=client.risSources(),id=required('id');
    const page=()=>chosen({revision:number('revision'),offset:number('offset'),limit:number('limit')});
    let result;
    if(command==='ris-prepare')result=await ris.prepareFiles(id,await input());
    if(command==='ris-prepare-source'){
      const data=await input();result=await ris.prepareSourceFile(id,{...data,file:resolve(required('source-file')),sha256:required('sha256')});
    }
    if(command==='ris-preview')result=await ris.preview(id,await input());
    if(command==='ris-receive')result=await ris.receive(id,await input());
    if(command==='ris-list')result=await ris.sources(id,page());
    if(command==='ris-review')result=await ris.sources(id,{...page(),editionId:required('edition'),...chosen({recordId:values.record})});
    if(command==='ris-request')result=await ris.sources(id,{...page(),requestId:required('request')});
    if(command==='ris-compare')result=await ris.compare(id,{...page(),before:required('before'),after:required('after'),
      ...chosen({section:values.section})});
    if(command==='ris-export')result=await ris.export(id,{editionId:required('edition'),file:resolve(required('out')),
      ...chosen({revision:number('revision'),format:values.format,documentId:values.document,recordId:values.record,
        expectedSha256:values.sha256})});
    if(command==='ris-export-comparison')result=await ris.exportComparison(id,{before:required('before'),after:required('after'),
      file:resolve(required('out')),...chosen({revision:number('revision'),format:values.format,expectedSha256:values.sha256})});
    output.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:safeCode(error.code,'RIS_COMMAND_FAILED'),
    ...(Number.isInteger(error.status)?{status:error.status}:{}),
    ...(error.outcomeUnknown?{outcomeUnknown:true,requestId:error.requestId,recovery:error.recovery}:{}),
    ...(error.destinationPublished?{destinationPublished:true,file:error.file}:{})})+'\n');process.exitCode=1;});
}
