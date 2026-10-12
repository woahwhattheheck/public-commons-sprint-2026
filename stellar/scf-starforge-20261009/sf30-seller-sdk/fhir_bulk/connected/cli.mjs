#!/usr/bin/env node
// MIT. Connected FHIR operation through the running native operator or normal merchant host.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readSourceFile} from './files.mjs';
import {openFhirMerchantClient,openFhirLocalClient,downloadFhirExport,inspectFhirExport,reopenFhirExport,
  readFhirValue,fhirActions} from './client.mjs';
import {initializeFhirMerchant} from './setup.mjs';
import {decode,need} from './contracts.mjs';
const help=[
  'starforge merchant-fhir-bulk tools',
  'starforge merchant-fhir-bulk init --directory ABS --connection ABS [--name NAME]',
  'starforge merchant-fhir-bulk call --connection ABS --exports ABS --action ACTION --args ABS_JSON',
  'starforge merchant-fhir-bulk call --url MCP_URL --token-env ENV --action ACTION --args ABS_JSON',
  'starforge merchant-fhir-bulk value CONNECTION_OPTIONS --workspace ALIAS --export-id SHA --manifest-sha256 SHA [--file NAME]',
  'starforge merchant-fhir-bulk inspect CONNECTION_OPTIONS --workspace ALIAS --export-id SHA',
  'starforge merchant-fhir-bulk download CONNECTION_OPTIONS --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA] [--chunk-size BYTES]',
  'starforge merchant-fhir-bulk reopen --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA]',
  '',
  'CONNECTION_OPTIONS selects --connection ABS --exports ABS for local native access, or --url MCP_URL [--token-env ENV] for the normal merchant host.',
  'The local path borrows an operator already opened in Applications or by fhir-bulk serve.',
  'Persistent SDK/MCP clients may use operator_open with allowStart to own the native serve process.',
  'Use the same saved acquisition operation ID after an interrupted reply. The native operator owns polling and provider Retry-After.',
  'download receives every complete original file and resumes its existing directory; reopen verifies local completion.',
].join('\n');
export async function main(argv=process.argv.slice(2),{environment=process.env,signal,write=value=>process.stdout.write(value)}={}){
  const [command,...rest]=argv;
  if(!command || command==='help' || command==='--help'){write(help+'\n');return;}
  const flags=Object.create(null);
  for(let i=0;i<rest.length;i+=2){
    need(/^--[a-z][a-z-]*$/.test(rest[i]??'') && typeof rest[i+1]==='string' &&
      !rest[i+1].startsWith('--') && !Object.hasOwn(flags,rest[i]),'FHIR_BULK_CLI_INPUT',
      'Use one value after each declared option.');
    flags[rest[i]]=rest[i+1];
  }
  const connectionOptions=['connection','exports','url','token-env'];
  const allowed={tools:[],init:['directory','connection','name'],
    call:[...connectionOptions,'action','args','timeout-ms'],
    value:[...connectionOptions,'workspace','export-id','manifest-sha256','file'],
    inspect:[...connectionOptions,'workspace','export-id'],
    download:[...connectionOptions,'workspace','export-id','directory','manifest-sha256','chunk-size'],
    reopen:['workspace','export-id','directory','manifest-sha256']}[command];
  need(allowed && Object.keys(flags).every(key=>allowed.includes(key.slice(2))),'FHIR_BULK_CLI_INPUT',
    'Choose a declared connected FHIR command and options.');
  const required=key=>{need(typeof flags['--'+key]==='string' && flags['--'+key],'FHIR_BULK_CLI_INPUT','Missing --'+key);
    return flags['--'+key];};
  const selected=()=>({workspace:required('workspace'),exportId:required('export-id')});
  let result,client;
  try{
    if(command==='tools')result={tools:Object.values(fhirActions)};
    else if(command==='init')result=await initializeFhirMerchant({directory:resolve(required('directory')),
      connection:resolve(required('connection')),...(flags['--name']?{name:flags['--name']}:{})});
    else if(command==='reopen')result=await reopenFhirExport({...selected(),directory:resolve(required('directory')),
      expectedManifestSha256:flags['--manifest-sha256']});
    else{
      if(flags['--connection']){
        need(!flags['--url'] && !flags['--token-env'],'FHIR_BULK_CLI_INPUT','Select one local connection or one MCP endpoint.');
        client=await openFhirLocalClient({connection:resolve(required('connection')),exportsDirectory:resolve(required('exports'))});
      }else{
        need(!flags['--exports'],'FHIR_BULK_CLI_INPUT');
        client=await openFhirMerchantClient({url:required('url'),tokenEnv:flags['--token-env']??'MCP_ACCESS_TOKEN',environment,signal});
      }
      if(command==='call'){
        const args=decode(await readSourceFile(resolve(required('args')),{maxBytes:262144})),timeout=flags['--timeout-ms'];
        need(timeout===undefined || /^[1-9]\d*$/.test(timeout) && Number(timeout)<=600000,'FHIR_BULK_CLI_INPUT');
        result=await client.call(required('action'),args,timeout?{timeoutMs:Number(timeout)}:undefined);
      }else if(command==='value')result=await readFhirValue({...selected(),client,file:flags['--file']??'original-response.json',
        expectedManifestSha256:required('manifest-sha256')});
      else if(command==='inspect')result=await inspectFhirExport({...selected(),client});
      else{
        const chunk=flags['--chunk-size'];
        need(chunk===undefined || /^[1-9]\d*$/.test(chunk),'FHIR_BULK_CLI_INPUT');
        result=await downloadFhirExport({...selected(),client,signal,directory:resolve(required('directory')),
          expectedManifestSha256:flags['--manifest-sha256'],...(chunk?{chunkSize:Number(chunk)}:{})});
      }
    }
    write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client?.close();}
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Connected FHIR command interrupted.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await main(undefined,{signal:controller.signal});}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??error.name,message:error.message,
    ...(error.details?{details:error.details}:{})}})+'\n');process.exitCode=1;}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
