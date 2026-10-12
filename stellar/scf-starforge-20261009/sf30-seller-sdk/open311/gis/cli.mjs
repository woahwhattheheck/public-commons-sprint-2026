#!/usr/bin/env node
// MIT. Installed GIS handoff, analyst-review, dispatch and receiving commands.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fail, parseJson } from './shared.mjs';

export const HELP = 'open311-gis <init|state|inspect-source|import|source|source-rows|handoff|handoff-show|row|return|return-show|decision|dispatch|dispatch-show|export|receive|operation|serve>\n'+
  'Choose --workspace DIR for every saved-workspace command. inspect-source only needs --file FILE.\n'+
  'import --file COLLECTION-OR-REPORT.json [--report ID] [--name NAME]\n'+
  'handoff --file DEFINITION.json; decision --file SELECTION.json; dispatch --file DEFINITION.json\n'+
  'return --handoff ID --analyst NAME --file FILE [--format gpkg|geojson|csv|json] [--name NAME]\n'+
  'Mutations accept --request-id ID and --expected-revision N. Omission creates one ID and reads the current revision.\n'+
  'Keep the printed request ID to recover the exact action with operation --request-id ID.\n'+
  'source/source-rows/handoff-show/return-show/dispatch-show use --id ID; row uses --handoff ID --key KEY.\n'+
  'source-rows and handoff-show support --q TEXT --offset N --limit 1..1000.\n'+
  'export --kind workspace|json|geojson|csv|gpkg|html|source|returned --out NEW_FILE\n'+
  '  Select --handoff ID, --dispatch ID, --source ID or --return ID for the requested file; workspace exports everything.\n'+
  'receive --file COMPLETE-GIS-WORKSPACE.json initializes an empty destination.\n'+
  'serve --host 127.0.0.1 --port 0 [--expected-workspace-id UUID --expected-binding-sha256 SHA]\n';
const optionNames=new Set(['workspace','file','report','name','handoff','analyst','format','request-id','expected-revision','id','key','q','offset','limit','kind','out','dispatch','source','return','host','port','expected-workspace-id','expected-binding-sha256']);
function args(argv){
  const [command,...rest]=argv,values={};
  for(let i=0;i<rest.length;i+=2){
    const key=rest[i]?.slice(2),value=rest[i+1];
    if(!rest[i]?.startsWith('--')||!optionNames.has(key)||typeof value!=='string'||Object.hasOwn(values,key))fail('INVALID_ARGUMENT','Use one explicit value for each supported option. '+(rest[i]??''));
    values[key]=value;
  }
  return {command,values};
}
function required(values,key){if(!values[key])fail('MISSING_ARGUMENT','Supply --'+key+'.');return values[key];}
function revision(value){if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))fail('INVALID_REVISION','Use a nonnegative integer --expected-revision.');return Number(value);}
async function textFile(filename){const bytes=await readFile(filename);try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8','The selected input file is not complete UTF-8.');}}
export async function main(argv=process.argv.slice(2),{output=value=>process.stdout.write(typeof value==='string'?value:JSON.stringify(value)+'\n')}={}){
  const {command,values}=args(argv);
  if(!command||command==='help'||command==='--help'){output(HELP);return null;}
  if(command==='inspect-source'){
    const {inspectSource}=await import('./source.mjs'),result=inspectSource(await textFile(required(values,'file')),{...(values.report?{reportId:values.report}:{})});output(result);return result;
  }
  const directory=resolve(required(values,'workspace'));
  if(command==='serve'){
    const {serveGIS}=await import('./server.mjs'),running=await serveGIS({directory,host:values.host??'127.0.0.1',port:values.port??0,
      expectedWorkspaceId:values['expected-workspace-id'],expectedBindingSha256:values['expected-binding-sha256']});
    output(JSON.stringify(running.startup)+'\n');
    const stop=async()=>{await running.close();process.exitCode=0;};process.once('SIGINT',stop);process.once('SIGTERM',stop);return running;
  }
  const {openWorkspace}=await import('./workspace.mjs'),workspace=openWorkspace(directory,{create:command==='init'||command==='receive'});
  try{
    let result;
    const paging={q:values.q??'',...(values.offset!==undefined?{offset:Number(values.offset)}:{}),...(values.limit!==undefined?{limit:Number(values.limit)}:{})};
    if(command==='init'||command==='state')result=workspace.state();
    else if(command==='operation')result=workspace.operation(required(values,'request-id'));
    else if(command==='source')result=workspace.source(required(values,'id'));
    else if(command==='source-rows')result=workspace.sourceRows({id:required(values,'id'),...paging});
    else if(command==='handoff-show')result=workspace.handoff({id:required(values,'id'),...paging});
    else if(command==='row')result=workspace.row({handoffId:required(values,'handoff'),key:required(values,'key')});
    else if(command==='return-show')result=workspace.returned(required(values,'id'));
    else if(command==='dispatch-show')result=workspace.dispatch(required(values,'id'));
    else if(command==='export'){
      const input={kind:required(values,'kind')};
      for(const [option,field] of [['handoff','handoffId'],['dispatch','dispatchId'],['source','sourceId'],['return','returnId']])if(values[option])input[field]=values[option];
      if(values['expected-revision']!==undefined)input.expectedRevision=revision(values['expected-revision']);
      const file=workspace.exportFile(input),filename=resolve(required(values,'out'));await mkdir(dirname(filename),{recursive:true,mode:0o700});
      await writeFile(filename,file.body,{flag:'wx',mode:0o600});result={filename,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256};
    }else{
      const control={requestId:values['request-id']??randomUUID(),expectedRevision:values['expected-revision']===undefined?workspace.state().revision:revision(values['expected-revision'])};
      if(command==='return'){
        const filename=required(values,'file'),format=values.format??extname(filename).slice(1).toLowerCase();
        const original=format==='gpkg'?{contentBase64:(await readFile(filename)).toString('base64')}:{originalText:await textFile(filename)};
        result=workspace.importReturn({...control,handoffId:required(values,'handoff'),analyst:required(values,'analyst'),...(values.name?{name:values.name}:{}),format,...original});
      }else if(['import','handoff','decision','dispatch','receive'].includes(command)){
        const originalText=await textFile(required(values,'file'));
        if(command==='import')result=workspace.importSource({...control,originalText,...(values.report?{reportId:values.report}:{}),...(values.name?{name:values.name}:{})});
        else if(command==='receive')result=workspace.receive({...control,originalText});
        else if(command==='handoff')result=workspace.putHandoff({...control,definition:parseJson(originalText,'Handoff definition')});
        else if(command==='decision')result=workspace.putDecision({...control,selection:parseJson(originalText,'Decision selection')});
        else result=workspace.putDispatch({...control,definition:parseJson(originalText,'Dispatch definition')});
      }else fail('UNKNOWN_COMMAND','Unknown GIS command. Use open311-gis help.');
    }
    output(result);return result;
  }finally{workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(JSON.stringify({code:error.code??'GIS_ERROR',message:error.message,details:error.details??null})+'\n');process.exitCode=1;
});
