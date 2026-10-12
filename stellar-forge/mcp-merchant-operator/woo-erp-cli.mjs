#!/usr/bin/env node
// MIT. Complete installed Woo ERP operations on the original merchant MCP transport.
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openWooErpClient, inspectReceivedWooErp } from './woo-erp-client.mjs';
import { wooErpClientOperations, wooErpToolDefinitions } from './woo-erp-schema.mjs';
import { erpFailure, erpParseJson, readPrivateErpFile, writeWooErpOutput } from './woo-erp-artifacts.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const flag=name=>name.replace(/[A-Z]/g,value=>'-'+value.toLowerCase());
function need(value,message){if(!value)throw erpFailure('CLI_ARGUMENTS',message);}
function parse(argv){
 const command=argv[0]??'help',options=Object.create(null);
 if(command==='help')return {command,topic:argv[1]};
 for(let index=1;index<argv.length;index+=2){
  const key=argv[index],value=argv[index+1];
  need(/^--[a-z][a-z0-9-]*$/.test(key??'')&&typeof value==='string'&&!value.startsWith('--'),'Use --option VALUE pairs. Run help COMMAND for exact fields.');
  need(!Object.hasOwn(options,key.slice(2)),'An option was supplied twice.');
  options[key.slice(2)]=value;
 }
 return {command,options};
}
function help(topic){
 const definition=topic?wooErpToolDefinitions.find(item=>item.name===wooErpClientOperations[topic]):null;
 if(topic&&definition){
  return definition.description+'\n\nstarforge merchant-woo-erp '+topic+' --url MCP_URL --store STORE [--params PRIVATE_JSON] [--out PRIVATE_JSON]\n\n'+
   Object.entries(definition.inputSchema.properties).filter(([name])=>name!=='store').map(([name,schema])=>{
    const required=definition.inputSchema.required.includes(name)?'required':'optional';
    return '  --'+flag(name)+' '+schema.type.toUpperCase()+' ('+required+')'+(schema.enum?' · '+schema.enum.join(' | '):'');
   }).join('\n')+'\n';
 }
 need(topic===undefined||['download','inspect-local'].includes(topic),'Choose a published ERP command.');
 return [
  'WooCommerce ERP merchant operations — Node22+',
  '',
  'starforge merchant-woo-erp COMMAND --url MCP_URL --store STORE [fields]',
  '  --token-env NAME         Incoming merchant MCP bearer-token environment name',
  '  --params PRIVATE_JSON    Complete command fields; named flags cannot replace them',
  '  --out PRIVATE_JSON       Retain the complete result in an existing private directory',
  '',
  ...Object.keys(wooErpClientOperations).map(name=>'  '+name),
  '',
  'download --url MCP_URL --store STORE --kind mapping|project --id NATIVE_SHA',
  '  --export-id EXPORT_ALIAS --directory PRIVATE_DIRECTORY',
  '  --expected-manifest-sha256 SHA [--chunk-size BYTES]',
  'inspect-local --directory PRIVATE_DIRECTORY --expected-manifest-sha256 SHA',
  '',
  'Run help COMMAND for fields. Mapping save uses --expected-current-map-id none',
  'for an initial map. Input names refer to host-declared erpInputs aliases.',
  'Prepare uses revision0 for a new original Woo order; subsequent changes name',
  'the actual retained revision. Approve/deliver name the exact source edition.',
  'Long reasons and provider outcomes can be supplied in --params JSON.',
  '',
  'The original PHP journal owns delivery and recovery. Inspect the same order',
  'after an interrupted mutation; reconcile its existing native attempt before',
  'deciding on another delivery. Download resumes its original private directory.',
  ''
 ].join('\n');
}
function valueFor(schema,text,name){
 if(schema.type==='integer'){
  need(/^(0|[1-9][0-9]*)$/.test(text)&&Number.isSafeInteger(Number(text)),'Use an exact integer for --'+flag(name)+'.');
  return Number(text);
 }
 if(schema.type==='boolean'){
  need(text==='true'||text==='false','Use true or false for --'+flag(name)+'.');
  return text==='true';
 }
 return name==='expectedCurrentMapId'&&text==='none'?'':text;
}
async function commandArguments(command,options){
 const definition=wooErpToolDefinitions.find(item=>item.name===wooErpClientOperations[command]);
 need(definition,'Unknown Woo ERP command. Run help.');
 let args=options.params?erpParseJson(await readPrivateErpFile(options.params,128*1024)):{};
 need(plain(args),'Command parameters must be one complete JSON object.');
 args={...args};
 const allowed=new Map(Object.entries(definition.inputSchema.properties).filter(([name])=>name!=='store').map(([name,schema])=>[flag(name),{name,schema}]));
 for(const [key,value]of Object.entries(options)){
  if(['url','store','token-env','params','out'].includes(key))continue;
  const field=allowed.get(key);need(field,'Unsupported option --'+key+' for '+command+'.');
  need(!Object.hasOwn(args,field.name),'The same field was supplied in both --params and a named option.');
  args[field.name]=valueFor(field.schema,value,field.name);
 }
 return args;
}
async function publish(value,out){
 if(out){const written=await writeWooErpOutput(out,value);process.stdout.write(JSON.stringify({written})+'\n');}
 else process.stdout.write(JSON.stringify(value,null,2)+'\n');
 return value;
}
export async function main(argv=process.argv.slice(2)){
 const parsed=parse(argv);
 if(parsed.command==='help'){process.stdout.write(help(parsed.topic));return;}
 const {command,options}=parsed;
 if(command==='inspect-local'){
  need(Object.keys(options).every(key=>['directory','expected-manifest-sha256','out'].includes(key)),'Use only the original received directory, manifest hash and optional output.');
  return publish(await inspectReceivedWooErp({directory:options.directory,expectedManifestSha256:options['expected-manifest-sha256']}),options.out);
 }
 need(options.url&&options.store,'Select the original merchant MCP URL and configured Woo store alias.');
 const args=command==='download'?null:await commandArguments(command,options);
 const controller=new AbortController(),interrupt=()=>controller.abort(new Error('The operator interrupted this original client call.'));
 process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
 try{
  const client=await openWooErpClient({url:options.url,store:options.store,tokenEnv:options['token-env']??'MCP_ACCESS_TOKEN',signal:controller.signal});
  if(command==='download'){
   need(Object.keys(options).every(key=>['url','store','token-env','kind','id','export-id','directory','expected-manifest-sha256','chunk-size','out'].includes(key)),
    'Use the complete export selection, private receiving directory and original manifest hash.');
   need(/^[a-f0-9]{64}$/.test(options['expected-manifest-sha256']??''),'Retain the export manifest SHA256 before downloading.');
   const chunkSize=options['chunk-size']===undefined?undefined:valueFor({type:'integer'},options['chunk-size'],'chunkSize');
   const result=await client.download({kind:options.kind,id:options.id,exportId:options['export-id'],directory:options.directory,
    expectedManifestSha256:options['expected-manifest-sha256'],...(chunkSize===undefined?{}:{chunkSize}),signal:controller.signal});
   return publish(result,options.out);
  }
  return publish(await client.call(command,args),options.out);
 }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
const entry=process.argv[1];
if(entry&&await realpath(entry).catch(()=>null)===await realpath(fileURLToPath(import.meta.url)).catch(()=>null)){
 main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'WOO_ERP_CLI_FAILED',message:error.message})+'\n');process.exitCode=1;});
}
